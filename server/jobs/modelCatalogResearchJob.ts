/**
 * modelCatalogResearchJob.ts — AI 模型情報專區的週期性自動研究
 *
 * 模式：仿照 newsFetcher.ts 的 cron 排程模式（node-cron + dedup lock）。
 *
 * 排程：
 *   - 每天凌晨 3:30（伺服器時區）跑一次 catalog 研究
 *     · researchAndFactCheckModel 內建 24h cache，已驗證模型不會重複呼叫 LLM
 *     · 結果是：「最新動態」每天都會嘗試補上，但已驗證的模型不會重抓 pricing
 *   - 容器啟動 60 秒後也跑一次（讓首次部署立刻有資料）
 *
 * 設計重點：
 *   1. Dedup lock：避免兩個 worker 同時跑（記憶體鎖 + active run promise）
 *   2. 容錯：每個模型獨立失敗，不影響其他模型；錯誤累積到 stats
 *   3. 節流：透過 perplexityThrottle 統一管控，cron 不算 user 配額
 *   4. 退場：DISABLE_MODEL_RESEARCH_CRON=1 即可關閉這個 cron（測試環境）
 */

import * as cron from "node-cron";
import { logger } from "../_core/logger";
import {
  researchAndFactCheckAllModels,
  researchAndFactCheckStaleModels,
  getResearchStats,
} from "../services/modelResearcher";

const CRON_SCHEDULE = "30 3 * * *"; // 每天 03:30，依 24h cache 自動跳過剛驗過的
const WARMUP_DELAY_MS = 60_000; // 啟動 60 秒後跑首次研究

let cronTask: cron.ScheduledTask | null = null;
let warmupTimer: NodeJS.Timeout | null = null;
let isRunning = false;

function isDisabled(): boolean {
  const flag = process.env.DISABLE_MODEL_RESEARCH_CRON;
  if (!flag) return false;
  return ["1", "true", "yes", "on"].includes(flag.trim().toLowerCase());
}

async function runOnce(trigger: "cron" | "warmup" | "manual"): Promise<void> {
  if (isRunning) {
    logger.info("[ModelResearchCron] previous run still active — skipping", {
      trigger,
    });
    return;
  }
  isRunning = true;
  const started = Date.now();
  try {
    logger.info("[ModelResearchCron] starting run", { trigger });
    const result = await researchAndFactCheckAllModels({
      force: false,
      concurrency: 2,
      userId: null,
    });
    logger.info("[ModelResearchCron] run finished", {
      trigger,
      durationMs: Date.now() - started,
      modelsTried: result.modelsTried,
      modelsSucceeded: result.modelsSucceeded,
      errorCount: result.errors.length,
    });
  } catch (err) {
    logger.error("[ModelResearchCron] run failed", {
      trigger,
      err: (err as Error).message,
    });
  } finally {
    isRunning = false;
  }
}

export function initModelCatalogResearchCron(): void {
  if (cronTask) {
    logger.info("[ModelResearchCron] already initialized");
    return;
  }
  if (isDisabled()) {
    logger.info("[ModelResearchCron] disabled via DISABLE_MODEL_RESEARCH_CRON");
    return;
  }

  cronTask = cron.schedule(CRON_SCHEDULE, () => {
    void runOnce("cron");
  });

  warmupTimer = setTimeout(() => {
    void runOnce("warmup");
  }, WARMUP_DELAY_MS);

  logger.info("[ModelResearchCron] initialized", {
    schedule: CRON_SCHEDULE,
    warmupDelayMs: WARMUP_DELAY_MS,
  });
}

export function stopModelCatalogResearchCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
  if (warmupTimer) {
    clearTimeout(warmupTimer);
    warmupTimer = null;
  }
  logger.info("[ModelResearchCron] stopped");
}

/** Trigger an immediate run (used by admin tooling and `aiModels.refreshAll` tRPC mutation). */
export async function triggerModelResearchRunNow(): Promise<{
  ok: boolean;
  message: string;
}> {
  if (isRunning) {
    return {
      ok: false,
      message:
        "Research run already in progress; check stats endpoint for status.",
    };
  }
  void runOnce("manual");
  return { ok: true, message: "Research run started in background." };
}

/**
 * Trigger a stale-only refresh (used by `aiModels.refreshStale` admin mutation).
 * 只重新查核 stale / pending / error 的模型 — 比 refreshAll 便宜很多。
 */
export async function triggerStaleRefreshNow(): Promise<{
  ok: boolean;
  message: string;
}> {
  if (isRunning) {
    return {
      ok: false,
      message:
        "Research run already in progress; check stats endpoint for status.",
    };
  }
  isRunning = true;
  void (async () => {
    const started = Date.now();
    try {
      logger.info("[ModelResearchCron] starting stale-only refresh", {
        trigger: "manual-stale",
      });
      const result = await researchAndFactCheckStaleModels({
        concurrency: 2,
        userId: null,
      });
      logger.info("[ModelResearchCron] stale-only refresh finished", {
        durationMs: Date.now() - started,
        modelsTried: result.modelsTried,
        modelsSucceeded: result.modelsSucceeded,
        errorCount: result.errors.length,
      });
    } catch (err) {
      logger.error("[ModelResearchCron] stale-only refresh failed", {
        err: (err as Error).message,
      });
    } finally {
      isRunning = false;
    }
  })();
  return {
    ok: true,
    message: "Stale-only refresh started in background.",
  };
}

export function getCronStatus(): {
  scheduled: boolean;
  isRunning: boolean;
  schedule: string;
  stats: ReturnType<typeof getResearchStats>;
} {
  return {
    scheduled: cronTask !== null,
    isRunning,
    schedule: CRON_SCHEDULE,
    stats: getResearchStats(),
  };
}
