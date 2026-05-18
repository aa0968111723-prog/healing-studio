/**
 * teachingArchiveIngestionWorker.ts — 資料庫抽文 / 轉文字 背景任務 Worker
 *
 * 為什麼存在：之前 router 用 `setImmediate(() => scheduleTeachingIngestion(id))`
 * fire-and-forget — process 重啟 / crash 後在 processing 狀態的 row 會永久卡住，
 * pending 的也不會有人撿起來。
 *
 * 改成 backgroundJobs queue + cron worker（仿 modelTrainingWorker）：
 *   1. router 建素材時不再 setImmediate，而是 createBackgroundJob({
 *        jobType: "teaching_archive_ingestion",
 *        status: "queued",
 *        resultJson: { materialId },
 *      })
 *   2. 本 cron 每 60 秒掃 queued + stuck 任務
 *   3. 每個任務都標 processing → run → completed/failed，配合 row 上的
 *      transcriptionStatus 同步更新
 *
 * Stuck 偵測：超過 15 分鐘還在 processing 的視為卡住（PDF 抽文應 < 10 秒；
 * 語音轉文字最多幾分鐘）。卡住的 job 標 failed 並把 material 也標 failed
 * 讓使用者按「重跑」可重排。
 */

import * as cron from "node-cron";
import {
  getQueuedJobsByType,
  getStuckJobsByType,
  updateBackgroundJob,
  getTeachingMaterial,
  updateTeachingMaterial,
} from "../db.js";
import { runTeachingIngestion } from "../services/teachingArchiveIngest.js";

const JOB_TYPE = "teaching_archive_ingestion";
const STUCK_AFTER_MINUTES = 15;
const MAX_BATCH = 5;

let cronTask: cron.ScheduledTask | null = null;
let isWorkerRunning = false;

function logWorker(level: "info" | "warn" | "error", message: string): void {
  const icon = level === "info" ? "✅" : level === "warn" ? "⚠️" : "❌";
  console.log(`${icon} [teachingArchiveIngestion] ${message}`);
}

interface IngestionJobResult {
  materialId?: number;
  error?: string;
}

export async function runTeachingArchiveIngestionWorker(): Promise<void> {
  if (isWorkerRunning) {
    logWorker("info", "已有實例運行中，跳過此次排程");
    return;
  }
  isWorkerRunning = true;
  try {
    // ── 1. 復原 stuck 任務（processing > 15 min 視為卡住）─────────────────
    const stuck = await getStuckJobsByType(JOB_TYPE, STUCK_AFTER_MINUTES, MAX_BATCH);
    for (const job of stuck) {
      const result = (job.resultJson as IngestionJobResult | null) ?? {};
      logWorker(
        "warn",
        `卡住任務 jobId=${job.id} materialId=${result.materialId ?? "?"} → 標 failed`
      );
      await updateBackgroundJob(job.id, {
        status: "failed",
        resultJson: { ...result, error: "stuck > 15min, recovered by worker" },
      }).catch(() => {});
      if (result.materialId) {
        await updateTeachingMaterial(result.materialId, {
          transcriptionStatus: "failed",
        }).catch(() => {});
      }
    }

    // ── 2. 消費 queued 任務 ───────────────────────────────────────────────
    const jobs = await getQueuedJobsByType(JOB_TYPE, MAX_BATCH);
    for (const job of jobs) {
      const payload = (job.resultJson as IngestionJobResult | null) ?? {};
      const materialId = payload.materialId;
      if (!materialId) {
        await updateBackgroundJob(job.id, {
          status: "failed",
          resultJson: { error: "missing materialId in resultJson" },
        }).catch(() => {});
        continue;
      }

      const material = await getTeachingMaterial(materialId);
      if (!material) {
        await updateBackgroundJob(job.id, {
          status: "failed",
          resultJson: { ...payload, error: "material not found" },
        }).catch(() => {});
        continue;
      }

      await updateBackgroundJob(job.id, { status: "processing" }).catch(() => {});

      try {
        await runTeachingIngestion(material);
        await updateBackgroundJob(job.id, {
          status: "completed",
          resultJson: payload,
        });
        logWorker(
          "info",
          `完成抽文 jobId=${job.id} materialId=${materialId} type=${material.mediaType}`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logWorker(
          "error",
          `抽文失敗 jobId=${job.id} materialId=${materialId}: ${message}`
        );
        await updateBackgroundJob(job.id, {
          status: "failed",
          resultJson: { ...payload, error: message },
        }).catch(() => {});
        // material row 的 status 由 runTeachingIngestion 內部 catch 已標 failed；
        // 沒走到那裡也保險再標一次
        await updateTeachingMaterial(materialId, {
          transcriptionStatus: "failed",
        }).catch(() => {});
      }
    }
  } finally {
    isWorkerRunning = false;
  }
}

/** 每 60 秒跑一次 — 比 modelTraining 的 5 分鐘更積極，因為 PDF 抽文很快。 */
export function initTeachingArchiveIngestionWorkerCron(): void {
  cronTask = cron.schedule("*/1 * * * *", async () => {
    try {
      await runTeachingArchiveIngestionWorker();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWorker("error", `排程執行異常: ${message}`);
    }
  });
  logWorker("info", "資料庫抽文 Worker 排程已註冊 — 每 60 秒執行一次");

  // 啟動後 5 秒掃一次，讓重啟後 stuck 的任務盡快被偵測
  setTimeout(async () => {
    try {
      await runTeachingArchiveIngestionWorker();
    } catch {
      // first-run 異常已在 runner 內 log
    }
  }, 5_000);
}

export function stopTeachingArchiveIngestionWorkerCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logWorker("info", "Worker 排程已停止");
  }
}
