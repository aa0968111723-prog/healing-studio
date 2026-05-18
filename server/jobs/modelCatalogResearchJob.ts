/**
 * modelCatalogResearchJob.ts — AI 模型情報專區的週期性自動研究
 *
 * 模式：仿照 newsFetcher.ts 的 cron 排程模式（node-cron + dedup lock）。
 *
 * 排程（2026-05 改版）：
 *   - 每天 03:30 跑「研究 = 發現」：discoverNewAIReleases() 找新模型 / 新論文 /
 *     既有模型的重大更新；discovery 是研究的主要任務。
 *   - 接著跑 researchAndFactCheckStaleModels() — 只對 stale / pending 模型做事實
 *     查核，*不再* 每天 re-validate 已驗證的 64 個模型。
 *   - 容器啟動 90 秒後跑一次首輪（首次部署立刻有資料）。
 *
 * 政策變更：
 *   - 以前：每天叫 researchAndFactCheckAllModels() → 64 個模型全部呼叫 LLM →
 *     一旦節流或 key 缺失就會「64 個模型全部驗證失敗」。
 *   - 現在：研究的主軸是「發現」。re-validate 只在 discovery 發現某模型有更新
 *     時觸發（discoveryStore 會把該模型 flagModelStale，下次 stale 補抓自動撿）。
 *
 * 設計重點：
 *   1. Dedup lock：避免兩個 worker 同時跑（記憶體鎖 + active run promise）
 *   2. 容錯：每個模型獨立失敗，不影響其他模型
 *   3. 節流：透過 perplexityThrottle 統一管控
 *   4. 退場：DISABLE_MODEL_RESEARCH_CRON=1 即可關閉這個 cron
 */

import * as cron from "node-cron";
import { logger } from "../_core/logger";
import {
  researchAndFactCheckAllModels,
  researchAndFactCheckStaleModels,
  discoverNewAIReleases,
  getResearchStats,
} from "../services/modelResearcher";

const CRON_SCHEDULE = "30 3 * * *"; // 每天 03:30：先 discovery，再 stale-only 補抓
const WARMUP_DELAY_MS = 90_000; // 啟動 90 秒後跑首輪（避開 server 啟動高峰）

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
    logger.info("[ModelResearchCron] starting run (discovery + stale)", {
      trigger,
    });
    // Step 1: discovery — research's main job is to find NEW models/papers
    const discovery = await discoverNewAIReleases({
      userId: null,
      days: 7,
    });
    logger.info("[ModelResearchCron] discovery done", {
      trigger,
      found: discovery.found,
      durationMs: discovery.durationMs,
      error: discovery.error,
    });
    // Step 2: stale-only validation — only models flagged stale (incl. by
    // discovery) get re-validated; verified models are left alone for 60 days.
    const result = await researchAndFactCheckStaleModels({
      concurrency: 2,
      userId: null,
    });
    logger.info("[ModelResearchCron] stale-refresh done", {
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

/**
 * Trigger an immediate FULL run (admin "手動執行完整研究").
 *
 * 與排程不同：這個會 force=true 把所有 64 個模型強制重抓 — 管理員確認需要
 * 完整刷新時才用，比 stale-only + discovery 貴很多。
 */
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
  isRunning = true;
  void (async () => {
    const started = Date.now();
    try {
      logger.info("[ModelResearchCron] starting full force run", {
        trigger: "manual-full",
      });
      const result = await researchAndFactCheckAllModels({
        force: true,
        concurrency: 2,
        userId: null,
      });
      logger.info("[ModelResearchCron] full force run finished", {
        durationMs: Date.now() - started,
        modelsTried: result.modelsTried,
        modelsSucceeded: result.modelsSucceeded,
        errorCount: result.errors.length,
      });
    } catch (err) {
      logger.error("[ModelResearchCron] full force run failed", {
        err: (err as Error).message,
      });
    } finally {
      isRunning = false;
    }
  })();
  return { ok: true, message: "Full research run started in background." };
}

/** Admin: trigger a discovery-only run (no validation). */
export async function triggerDiscoveryNow(): Promise<{
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
    try {
      const result = await discoverNewAIReleases({ userId: null, days: 7 });
      logger.info("[ModelResearchCron] manual discovery finished", {
        found: result.found,
        durationMs: result.durationMs,
        error: result.error,
      });
    } catch (err) {
      logger.error("[ModelResearchCron] manual discovery failed", {
        err: (err as Error).message,
      });
    } finally {
      isRunning = false;
    }
  })();
  return { ok: true, message: "Discovery run started in background." };
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
