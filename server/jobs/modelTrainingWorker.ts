/**
 * modelTrainingWorker.ts — 背景任務消費者 Worker
 *
 * 解決三個問題：
 *   1. 無 Worker 消費：定時掃描 queued 狀態的 model_training 任務並啟動訓練
 *   2. 伺服器重啟任務丟失：偵測 processing 狀態超過 15 分鐘的卡住任務，嘗試恢復或標記失敗
 *   3. queued 任務積壓：每 5 分鐘自動消費，確保不會永久積壓
 *
 * 模式：仿照 newsFetcher.ts 的 cron 排程模式
 */

import * as cron from "node-cron";
import {
  getQueuedJobsByType,
  getStuckJobsByType,
  updateBackgroundJob,
  updateFineTunedModel,
  getFineTunedModel,
} from "../db.js";
import type { LoraTrainingJobInput } from "../services/loraTrainer.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const LOG_PREFIX = "[ModelTrainingWorker]";
const JOB_TYPE = "model_training";
const STUCK_THRESHOLD_MINUTES = 15;
const MAX_QUEUED_PER_TICK = 5;
const MAX_STUCK_PER_TICK = 3;

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false; // Prevent overlapping executions

// ─── Logger ─────────────────────────────────────────────────────────────────

function log(level: "info" | "warn" | "error", message: string): void {
  const timestamp = new Date().toISOString();
  const icon = level === "info" ? "ℹ️" : level === "warn" ? "⚠️" : "❌";
  console[level](`${LOG_PREFIX} ${timestamp} ${icon}  ${message}`);
}

// ─── Core: Process Queued Jobs ──────────────────────────────────────────────

async function processQueuedJobs(): Promise<number> {
  const queuedJobs = await getQueuedJobsByType(JOB_TYPE, MAX_QUEUED_PER_TICK);

  if (queuedJobs.length === 0) return 0;

  log("info", `發現 ${queuedJobs.length} 個待處理的訓練任務`);

  let launched = 0;

  for (const job of queuedJobs) {
    try {
      // Extract modelId from resultJson
      const resultJson = job.resultJson as Record<string, any> | null;
      const modelId = resultJson?.modelId as number | undefined;

      if (!modelId) {
        log("warn", `任務 #${job.id} 缺少 modelId，標記為失敗`);
        await updateBackgroundJob(job.id, {
          status: "failed",
          errorMessage: "任務缺少 modelId 參數",
          progressMessage: "任務配置錯誤",
        });
        continue;
      }

      // Fetch the model record to get training parameters
      const model = await getFineTunedModel(modelId);
      if (!model) {
        log("warn", `任務 #${job.id} 對應的模型 #${modelId} 不存在，標記為失敗`);
        await updateBackgroundJob(job.id, {
          status: "failed",
          errorMessage: `模型 #${modelId} 不存在`,
          progressMessage: "模型記錄不存在",
        });
        continue;
      }

      // Check REPLICATE_API_TOKEN
      if (!process.env.REPLICATE_API_TOKEN) {
        log("warn", `REPLICATE_API_TOKEN 未設定，跳過任務 #${job.id}（保持 queued）`);
        break; // No point processing more if token is missing
      }

      // Extract training parameters from model's configJson
      const config = (model.configJson as Record<string, any>) || {};
      const datasetImages = config.datasetImages as Array<{ url: string }> | undefined;

      if (!datasetImages || datasetImages.length < 3) {
        log("warn", `任務 #${job.id} 的模型 #${modelId} 訓練圖片不足 3 張，標記為失敗`);
        await updateBackgroundJob(job.id, {
          status: "failed",
          errorMessage: "訓練圖片不足 3 張",
          progressMessage: "資料集不足",
        });
        await updateFineTunedModel(modelId, { status: "failed" });
        continue;
      }

      // Build LoraTrainingJobInput
      const trainingInput: LoraTrainingJobInput = {
        userId: job.userId,
        modelId,
        jobId: job.id,
        modelName: (resultJson?.modelName as string) || model.name || "unnamed",
        triggerWord: config.triggerWord || "",
        epochs: config.epochs ?? 20,
        learningRate: config.learningRate ?? 0.0001,
        imageUrls: datasetImages.map((img: { url: string }) => img.url),
      };

      // Launch training in background (non-blocking)
      log("info", `啟動任務 #${job.id} → 模型 #${modelId} "${trainingInput.modelName}" (${trainingInput.imageUrls.length} 張圖片)`);

      import("../services/loraTrainer.js").then(({ runLoraTrainingJob }) => {
        runLoraTrainingJob(trainingInput).catch((err: any) => {
          log("error", `任務 #${job.id} 背景執行失敗: ${err.message}`);
        });
      });

      launched++;
    } catch (err: any) {
      log("error", `處理任務 #${job.id} 時發生錯誤: ${err.message}`);
      try {
        await updateBackgroundJob(job.id, {
          status: "failed",
          errorMessage: err.message,
          progressMessage: "Worker 處理錯誤",
        });
      } catch (dbErr: any) {
        log("error", `無法更新任務 #${job.id} 狀態: ${dbErr.message}`);
      }
    }
  }

  return launched;
}

// ─── Core: Recover Stuck Jobs ───────────────────────────────────────────────

async function recoverStuckJobs(): Promise<number> {
  const stuckJobs = await getStuckJobsByType(JOB_TYPE, STUCK_THRESHOLD_MINUTES, MAX_STUCK_PER_TICK);

  if (stuckJobs.length === 0) return 0;

  log("warn", `發現 ${stuckJobs.length} 個卡住的訓練任務（超過 ${STUCK_THRESHOLD_MINUTES} 分鐘未更新）`);

  let recovered = 0;

  for (const job of stuckJobs) {
    try {
      const resultJson = job.resultJson as Record<string, any> | null;
      const modelId = resultJson?.modelId as number | undefined;

      // Check if there's a Replicate predictionId we can resume polling
      let hasPredictionId = false;
      if (modelId) {
        const model = await getFineTunedModel(modelId);
        const config = (model?.configJson as Record<string, any>) || {};
        hasPredictionId = !!config.predictionId;
      }

      if (hasPredictionId && process.env.REPLICATE_API_TOKEN) {
        // The job has a predictionId — it was submitted to Replicate but polling was interrupted.
        // Reset to queued so the next tick picks it up and re-polls.
        // Note: runLoraTrainingJob will detect the existing predictionId and resume polling
        // rather than re-submitting. For now, mark as failed with a clear message.
        log("warn", `任務 #${job.id} 有 predictionId 但輪詢中斷 — 標記為失敗（需手動重試）`);
        await updateBackgroundJob(job.id, {
          status: "failed",
          errorMessage: "伺服器重啟導致訓練輪詢中斷。Replicate 訓練可能仍在進行中，請檢查 Replicate Dashboard 或重新提交。",
          progressMessage: "訓練中斷（伺服器重啟）",
        });
        if (modelId) {
          await updateFineTunedModel(modelId, { status: "failed" });
        }
      } else {
        // No predictionId — job got stuck before submitting to Replicate
        // Safe to mark as failed
        log("warn", `任務 #${job.id} 卡在 processing 且無 predictionId — 標記為失敗`);
        await updateBackgroundJob(job.id, {
          status: "failed",
          errorMessage: `任務卡住超過 ${STUCK_THRESHOLD_MINUTES} 分鐘未更新，已自動標記為失敗。`,
          progressMessage: "任務超時（自動清理）",
        });
        if (modelId) {
          await updateFineTunedModel(modelId, { status: "failed" });
        }
      }

      recovered++;
    } catch (err: any) {
      log("error", `恢復卡住任務 #${job.id} 時發生錯誤: ${err.message}`);
    }
  }

  return recovered;
}

// ─── Main Worker Tick ───────────────────────────────────────────────────────

async function runWorkerTick(): Promise<void> {
  if (isRunning) {
    log("info", "上一輪尚未完成，跳過本次執行");
    return;
  }

  isRunning = true;

  try {
    log("info", "═══ Worker 掃描開始 ═══");

    // Phase 1: Recover stuck jobs
    const recoveredCount = await recoverStuckJobs();

    // Phase 2: Process queued jobs
    const launchedCount = await processQueuedJobs();

    if (recoveredCount === 0 && launchedCount === 0) {
      log("info", "無待處理或卡住的任務");
    } else {
      log("info", `本輪結果 — 啟動: ${launchedCount} 個, 恢復/清理: ${recoveredCount} 個`);
    }

    log("info", "═══ Worker 掃描完成 ═══");
  } catch (err: any) {
    log("error", `Worker 執行異常: ${err.message}`);
  } finally {
    isRunning = false;
  }
}

// ─── Cron Initialization ────────────────────────────────────────────────────

/**
 * Initialize the model training worker cron job.
 * Runs every 5 minutes to consume queued tasks and recover stuck ones.
 */
export function initModelTrainingWorkerCron(): void {
  if (!process.env.REPLICATE_API_TOKEN) {
    log("warn", "REPLICATE_API_TOKEN 未設定 — 模型訓練 Worker 將以降級模式運行（僅清理卡住任務）");
  }

  // Schedule: every 5 minutes
  cronTask = cron.schedule("*/5 * * * *", async () => {
    try {
      await runWorkerTick();
    } catch (err: any) {
      log("error", `排程執行異常: ${err.message}`);
    }
  });

  log("info", "模型訓練 Worker 排程已註冊 — 每 5 分鐘執行一次");

  // Initial scan after 60s delay (let DB and server warm up)
  setTimeout(async () => {
    log("info", "伺服器啟動後首次 Worker 掃描...");
    try {
      await runWorkerTick();
    } catch (err: any) {
      log("error", `首次掃描異常: ${err.message}`);
    }
  }, 60_000);
}

/**
 * Stop the cron job (for graceful shutdown).
 */
export function stopModelTrainingWorkerCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    log("info", "模型訓練 Worker 排程已停止");
  }
}
