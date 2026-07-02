/**
 * modelTrainingWorker.ts — 模型訓練背景任務消費者 Worker
 *
 * 解決三個問題：
 *   1. 無 Worker 消費：定時掃描 queued 狀態的 model_training 任務並啟動訓練
 *   2. 伺服器重啟任務丟失：偵測 processing 狀態超過 15 分鐘的卡住任務，嘗試 Replicate 狀態恢復
 *   3. queued 任務積壓：每 5 分鐘自動消費，確保不會永久積壓
 *
 * 模式：仿照 newsFetcher.ts 的 cron 排程模式
 */

import * as cron from "node-cron";
import { getReplicateTrainingStatus } from "../services/replicateClient.js";
import { checkAndSyncFalTraining } from "../services/falTrainer.js";
import {
  getQueuedJobsByType,
  getStuckJobsByType,
  updateBackgroundJob,
  updateFineTunedModel,
  getFineTunedModel,
} from "../db.js";
import type { LoraTrainingJobInput } from "../services/loraTrainer.js";
import { CircuitBreaker } from "./circuitBreaker.js";

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface TrainingJobResultJson {
  modelId?: number;
  modelName?: string;
  predictionId?: string;
  /** AIDV-45：models.create / agentToolExecutor 建 job 時寫入的訓練引擎 */
  engine?: string;
  /** AIDV-45：fal 路徑提交後寫入的真實 fal request id */
  falRequestId?: string;
}

interface ModelConfigJson {
  triggerWord?: string;
  epochs?: number;
  learningRate?: number;
  /** AIDV-45：fal 引擎模型一定有 falModelId（legacy 引擎判定用） */
  falModelId?: string;
  datasetImages?: Array<{
    url: string;
    fileKey?: string;
    angle?: string;
    caption?: string;
  }>;
}

// ─── AIDV-45 引擎守門 ───────────────────────────────────────────────────────
// 本 Worker 只服務 Replicate 訓練。fal 引擎的 model_training 任務絕不可進
// Replicate 派工（雙重派工＝雙重計費，且 Replicate 回寫會覆蓋 fal 的
// replicatePredictionId，摧毀輪詢回寫閉環）。
// 判定來源（任一命中即視為 fal）：
//   1. job.resultJson.engine === "fal"（models.create / agentToolExecutor 寫入）
//   2. job.resultJson.falRequestId 存在（fal 提交後寫入）
//   3. 模型列 trainingEngine === "fal" 或 configJson.falModelId（legacy 防禦）

function isFalEngineJob(
  resultJson: TrainingJobResultJson,
  model?: {
    trainingEngine?: string | null;
    configJson?: unknown;
  } | null
): boolean {
  if (resultJson.engine === "fal" || resultJson.falRequestId) return true;
  if (!model) return false;
  const config = (model.configJson ?? {}) as ModelConfigJson;
  return model.trainingEngine === "fal" || !!config.falModelId;
}

// ─── State ──────────────────────────────────────────────────────────────────

let cronTask: cron.ScheduledTask | null = null;

// ─── Circuit Breaker — Stops retrying when Replicate API fails repeatedly ────
const replicateBreaker = new CircuitBreaker("ReplicateTraining", {
  failureThreshold: 3,
  cooldownMs: 10 * 60_000, // 10 minutes cooldown
});

// ─── Deduplication Lock — Prevents overlapping cron runs ─────────────────────
let isWorkerRunning = false;

// ─── Logger ─────────────────────────────────────────────────────────────────

function logWorker(level: "info" | "warn" | "error", message: string): void {
  const icon = level === "info" ? "✅" : level === "warn" ? "⚠️" : "❌";
  console[level](`[ModelTrainingWorker] ${icon} ${message}`);
}

// ─── Function 1: processQueuedTrainingJobs ──────────────────────────────────

export async function processQueuedTrainingJobs(): Promise<void> {
  const jobs = await getQueuedJobsByType("model_training", 5);

  if (jobs.length === 0) return;

  logWorker("info", `發現 ${jobs.length} 個待處理的訓練任務`);

  for (const job of jobs) {
    try {
      // Parse resultJson
      const resultJson = (job.resultJson ?? {}) as TrainingJobResultJson;
      const modelId = resultJson.modelId;

      // ── AIDV-45 引擎守門（resultJson 層）：fal 任務絕不進 Replicate 派工 ──
      if (isFalEngineJob(resultJson)) {
        logWorker(
          "info",
          `任務 #${job.id} — fal 引擎任務，跳過 Replicate Worker（保持 queued，由 fal 流程/輪詢回寫接手）`
        );
        continue;
      }

      if (!modelId) {
        logWorker(
          "warn",
          `任務 #${job.id} — resultJson 缺少 modelId，標記為 failed`
        );
        await updateBackgroundJob(job.id, {
          status: "failed",
          errorMessage: "resultJson 缺少 modelId",
        });
        continue;
      }

      // Fetch model record
      const model = await getFineTunedModel(modelId);
      if (!model) {
        logWorker(
          "warn",
          `任務 #${job.id} — 模型 #${modelId} 不存在，標記為 failed`
        );
        await updateBackgroundJob(job.id, {
          status: "failed",
          errorMessage: `模型 #${modelId} 不存在`,
        });
        continue;
      }

      // ── AIDV-45 引擎守門（模型層防禦）：legacy job 的 resultJson 可能
      // 沒有 engine 欄位（如 retrain 建立的），再以模型列判定一次。
      // fal 任務不可走下面的 datasetImages<3 → failed 邏輯（會把還在
      // fal 上訓練中的模型直接摧毀），也不可被 Replicate 派工。
      if (isFalEngineJob(resultJson, model)) {
        logWorker(
          "info",
          `任務 #${job.id} — 模型 #${modelId} 為 fal 引擎，跳過 Replicate Worker`
        );
        continue;
      }

      // Parse configJson
      const config = (model.configJson ?? {}) as ModelConfigJson;
      const datasetImages = config.datasetImages;

      if (!datasetImages || datasetImages.length < 3) {
        logWorker(
          "warn",
          `任務 #${job.id} — 模型 #${modelId} 訓練圖片不足 3 張，標記為 failed`
        );
        await updateBackgroundJob(job.id, {
          status: "failed",
          errorMessage: "訓練圖片不足 3 張",
        });
        await updateFineTunedModel(modelId, { status: "failed" });
        continue;
      }

      // Check REPLICATE_API_TOKEN
      if (!process.env.REPLICATE_API_TOKEN) {
        logWorker(
          "warn",
          `REPLICATE_API_TOKEN 未設定，跳過任務 #${job.id}（保持 queued）`
        );
        continue;
      }

      // Mark as processing BEFORE launching (idempotency: prevents duplicate launches)
      await updateBackgroundJob(job.id, {
        status: "processing",
        progress: 5,
        progressMessage: "Worker 已接管，準備啟動訓練...",
      });

      // Build LoraTrainingJobInput
      const trainingInput: LoraTrainingJobInput = {
        userId: job.userId,
        modelId,
        jobId: job.id,
        modelName: resultJson.modelName || model.name || "unnamed",
        triggerWord: config.triggerWord || "",
        epochs: config.epochs ?? 20,
        learningRate: config.learningRate ?? 0.0001,
        imageUrls: datasetImages.map(img => img.url),
      };

      // Fire-and-forget: dynamic import, do NOT await runLoraTrainingJob
      import("../services/loraTrainer.js").then(({ runLoraTrainingJob }) => {
        runLoraTrainingJob(trainingInput).catch((err: Error) => {
          logWorker("error", `任務 #${job.id} 背景執行失敗: ${err.message}`);
        });
      });

      logWorker(
        "info",
        `已啟動任務 #${job.id} → 模型 #${modelId} "${trainingInput.modelName}" (${trainingInput.imageUrls.length} 張圖片)`
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWorker("error", `處理任務 #${job.id} 時發生錯誤: ${message}`);
      try {
        await updateBackgroundJob(job.id, {
          status: "failed",
          errorMessage: message,
        });
      } catch {
        logWorker("error", `無法更新任務 #${job.id} 狀態`);
      }
    }
  }
}

// ─── Function 2: recoverStuckTrainingJobs ───────────────────────────────────

export async function recoverStuckTrainingJobs(): Promise<void> {
  const stuckJobs = await getStuckJobsByType("model_training", 15, 3);

  if (stuckJobs.length === 0) return;

  logWorker(
    "warn",
    `發現 ${stuckJobs.length} 個卡住的訓練任務（超過 15 分鐘未更新）`
  );

  for (const job of stuckJobs) {
    try {
      const resultJson = (job.resultJson ?? {}) as TrainingJobResultJson;
      const predictionId = resultJson.predictionId;
      const modelId = resultJson.modelId;

      // ── AIDV-45 引擎守門：fal 任務不可重置 queued（會被下一輪
      // processQueuedTrainingJobs 以 Replicate 重派工 → 雙重派工雙重計費），
      // 也不可拿 fal request id 去問 Replicate。改呼叫 checkAndSyncFalTraining
      // 做輪詢回寫收尾；未到終態則 touch updatedAt 重置卡住計時器。
      const model = modelId ? await getFineTunedModel(modelId) : undefined;
      if (isFalEngineJob(resultJson, model)) {
        if (model && (model.status === "ready" || model.status === "failed")) {
          // 模型已終態但 job 沒收尾（例如 in-process 輪詢超時前模型已被
          // 其他入口同步）— 對帳收尾 job，讓佇列面板不再顯示訓練中。
          await updateBackgroundJob(job.id, {
            status: model.status === "ready" ? "completed" : "failed",
            ...(model.status === "ready" ? { progress: 100 } : {}),
            progressMessage:
              model.status === "ready"
                ? "訓練完成（Worker 對帳收尾）"
                : "訓練失敗（Worker 對帳收尾）",
            ...(model.status === "failed"
              ? { errorMessage: "fal 訓練失敗（模型已標記 failed）" }
              : {}),
          });
          logWorker(
            "info",
            `任務 #${job.id} — fal 模型 #${modelId} 已是 ${model.status}，job 對帳收尾`
          );
          continue;
        }

        let synced = false;
        if (model) {
          const sync = await checkAndSyncFalTraining(model).catch(() => null);
          synced = !!sync?.synced;
          logWorker(
            "info",
            `任務 #${job.id} — fal 引擎卡住任務改走輪詢回寫（queueStatus=${sync?.queueStatus ?? "N/A"}, synced=${synced}）`
          );
        }
        if (!synced) {
          // touch updatedAt：重置卡住計時器，等待 fal 完成或下一輪再同步。
          await updateBackgroundJob(job.id, {
            progressMessage:
              "Fal.ai 訓練確認中（Worker 已跳過 Replicate 恢復，等待輪詢回寫）",
          });
        }
        continue;
      }

      if (predictionId && process.env.REPLICATE_API_TOKEN) {
        // Has predictionId — try to recover by checking Replicate status
        logWorker(
          "info",
          `任務 #${job.id} — 嘗試恢復 Replicate 預測 ${predictionId}`
        );

        try {
          const prediction = await getReplicateTrainingStatus(predictionId);

          if (prediction.status === "succeeded") {
            // Training completed while we were down — extract weights URL
            const out = prediction.output as unknown;
            const output =
              typeof out === "string"
                ? out
                : Array.isArray(out)
                  ? (out[0] as string | undefined)
                  : out && typeof out === "object" && "weights" in (out as object)
                    ? (out as { weights?: string }).weights
                    : undefined;
            logWorker(
              "info",
              `任務 #${job.id} — Replicate 訓練已成功完成！output: ${output}`
            );

            if (modelId) {
              await updateFineTunedModel(modelId, {
                status: "ready",
                fileUrl: output || "",
              });
            }
            await updateBackgroundJob(job.id, {
              status: "completed",
              progress: 100,
              progressMessage: "訓練完成（Worker 恢復）",
            });
          } else if (
            prediction.status === "failed" ||
            prediction.status === "canceled"
          ) {
            const errorDetail = prediction.error || prediction.status;
            logWorker(
              "warn",
              `任務 #${job.id} — Replicate 訓練 ${prediction.status}: ${errorDetail}`
            );

            if (modelId) {
              await updateFineTunedModel(modelId, { status: "failed" });
            }
            await updateBackgroundJob(job.id, {
              status: "failed",
              errorMessage: `Replicate ${prediction.status}: ${errorDetail}`,
              progressMessage: `訓練${prediction.status === "failed" ? "失敗" : "已取消"}`,
            });
          } else if (
            prediction.status === "starting" ||
            prediction.status === "processing"
          ) {
            // Still running — reset the stuck timer by touching updatedAt
            logWorker(
              "info",
              `任務 #${job.id} — Replicate 仍在 ${prediction.status}，重置計時器`
            );
            await updateBackgroundJob(job.id, {
              progressMessage: `訓練中（${prediction.status}，Worker 已確認仍在執行）`,
            });
          }
        } catch (replicateErr: unknown) {
          const msg =
            replicateErr instanceof Error
              ? replicateErr.message
              : String(replicateErr);
          logWorker(
            "error",
            `任務 #${job.id} — Replicate API 查詢失敗: ${msg}`
          );
          // Don't mark as failed — might be a transient error, let next tick retry
          continue;
        }
      } else {
        // No predictionId — job got stuck before submitting to Replicate
        // Reset to queued so processQueuedTrainingJobs picks it up next tick
        logWorker(
          "warn",
          `任務 #${job.id} — 無 predictionId，重置為 queued 等待重試`
        );
        await updateBackgroundJob(job.id, {
          status: "queued" as any,
          progress: 0,
          progressMessage: "Worker 已重置，等待重新處理",
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWorker("error", `恢復卡住任務 #${job.id} 時發生錯誤: ${message}`);
    }
  }
}

// ─── Function 3: runModelTrainingWorker ─────────────────────────────────────

async function runModelTrainingWorker(): Promise<void> {
  // Deduplication: prevent overlapping runs
  if (isWorkerRunning) {
    logWorker("warn", "前一輪 Worker 仍在執行中，跳過本次排程。");
    return;
  }

  // Circuit breaker: stop hammering Replicate when it's down
  if (!replicateBreaker.canExecute()) {
    logWorker(
      "warn",
      `Circuit breaker OPEN（狀態: ${replicateBreaker.getState()}），跳過本次排程。`
    );
    return;
  }

  isWorkerRunning = true;
  logWorker("info", "═══ 模型訓練 Worker 開始執行 ═══");
  try {
    await recoverStuckTrainingJobs(); // 先恢復卡住任務
    await processQueuedTrainingJobs(); // 再處理新任務
    replicateBreaker.recordSuccess();
    logWorker("info", "═══ 模型訓練 Worker 完成 ═══");
  } catch (err: unknown) {
    replicateBreaker.recordFailure();
    throw err;
  } finally {
    isWorkerRunning = false;
  }
}

// ─── Cron Initialization ────────────────────────────────────────────────────

/**
 * Initialize the model training worker cron job.
 * Runs every 5 minutes to consume queued tasks and recover stuck ones.
 */
export function initModelTrainingWorkerCron(): void {
  // Schedule: every 5 minutes
  cronTask = cron.schedule("*/5 * * * *", async () => {
    try {
      await runModelTrainingWorker();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWorker("error", `排程執行異常: ${message}`);
    }
  });

  logWorker("info", "模型訓練 Worker 排程已註冊 — 每 5 分鐘執行一次");

  // Initial scan after 10s delay (let DB and server warm up)
  setTimeout(async () => {
    logWorker("info", "伺服器啟動後首次 Worker 掃描...");
    try {
      await runModelTrainingWorker();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWorker("error", `首次掃描異常: ${message}`);
    }
  }, 10_000);
}

/**
 * Stop the cron job (for graceful shutdown).
 */
export function stopModelTrainingWorkerCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logWorker("info", "模型訓練 Worker 排程已停止");
  }
}
