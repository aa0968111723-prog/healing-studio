/**
 * backgroundJobPurgeJob.ts — AIDV-231 Gap B: background_jobs TTL 清理
 *
 * 為什麼存在：
 *   background_jobs 每次 AI 任務都寫一列；completed/failed/cancelled 的舊工作
 *   長期累積會佔用 DB 空間。本 cron 每天凌晨 04:23 UTC 刪除已設 expiresAt 且已到期、
 *   且狀態為已結束的工作，避免干擾活躍工作（queued/processing）。
 *
 * 線上開啟政策（2026-06-16）：預設 ON；可透過 BACKGROUND_JOB_PURGE_ENABLED=false 關閉。
 * 防重入：上一輪還在跑時新一輪跳過。
 */

import * as cron from "node-cron";
import { purgeExpiredBackgroundJobs } from "../db";
import { captureError } from "../_core/errorTracking.js";
import { logger } from "../_core/logger";

const PURGE_SCHEDULE = "23 4 * * *"; // 每天 04:23 UTC

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;

const ENABLED = process.env.BACKGROUND_JOB_PURGE_ENABLED !== "false";

export async function runBackgroundJobPurge(): Promise<{ deleted: number }> {
  if (!ENABLED) {
    logger.debug("[BackgroundJobPurge] Skipped — BACKGROUND_JOB_PURGE_ENABLED=false");
    return { deleted: 0 };
  }

  const deleted = await purgeExpiredBackgroundJobs();
  logger.info("[BackgroundJobPurge] Purge complete", { deleted });
  return { deleted };
}

export function initBackgroundJobPurgeCron(): void {
  if (cronTask) return;
  cronTask = cron.schedule(PURGE_SCHEDULE, async () => {
    if (isRunning) {
      logger.debug("[BackgroundJobPurge] Previous run still active, skipping");
      return;
    }
    isRunning = true;
    try {
      await runBackgroundJobPurge();
    } catch (err) {
      logger.error("[BackgroundJobPurge] Unexpected error", { err });
      captureError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      isRunning = false;
    }
  });
  logger.info("[BackgroundJobPurge] Cron scheduled", { schedule: PURGE_SCHEDULE, enabled: ENABLED });
}

export function stopBackgroundJobPurgeCron(): void {
  cronTask?.stop();
  cronTask = null;
}
