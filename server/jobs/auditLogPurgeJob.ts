/**
 * auditLogPurgeJob.ts — AIDV-63 / H9 log 保留政策（每日自動清理）
 *
 * 為什麼存在：
 *   login_history 與 global_audit_log 每次登入/操作都寫一列；無清理政策的話
 *   日積月累會佔用大量 DB 空間。本 cron 每天凌晨 03:17 UTC 刪除 90 天以前的紀錄，
 *   保留最近 90 天供安全稽核與異常偵測使用。
 *
 * 安全鐵則：
 *   1. ENABLE_AUDIT_LOG_PURGE 預設 **OFF** — 不誤刪已上站的紀錄；Bruce 明確開才生效。
 *   2. 失敗只記 log + Sentry，不 throw、不讓 app crash。
 *   3. 防重入：上一輪還在跑時新一輪跳過。
 */

import * as cron from "node-cron";
import { purgeOldLoginHistory, purgeOldAuditLog } from "../db";
import { captureError } from "../_core/errorTracking.js";
import { logger } from "../_core/logger";

const PURGE_SCHEDULE = "17 3 * * *"; // 每天 03:17 UTC
const RETENTION_DAYS = 90;

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;

const ENABLED = process.env.ENABLE_AUDIT_LOG_PURGE === "true";

export async function runAuditLogPurge(): Promise<{ loginHistoryDeleted: number; auditLogDeleted: number }> {
  if (!ENABLED) {
    logger.debug("[AuditLogPurge] Skipped — ENABLE_AUDIT_LOG_PURGE not set");
    return { loginHistoryDeleted: 0, auditLogDeleted: 0 };
  }

  const [loginHistoryDeleted, auditLogDeleted] = await Promise.all([
    purgeOldLoginHistory(RETENTION_DAYS),
    purgeOldAuditLog(RETENTION_DAYS),
  ]);

  logger.info("[AuditLogPurge] Purge complete", { loginHistoryDeleted, auditLogDeleted, retentionDays: RETENTION_DAYS });
  return { loginHistoryDeleted, auditLogDeleted };
}

export function initAuditLogPurgeCron(): void {
  if (cronTask) return;
  cronTask = cron.schedule(PURGE_SCHEDULE, async () => {
    if (isRunning) {
      logger.debug("[AuditLogPurge] Previous run still active, skipping");
      return;
    }
    isRunning = true;
    try {
      await runAuditLogPurge();
    } catch (err) {
      logger.error("[AuditLogPurge] Unexpected error", { err });
      captureError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      isRunning = false;
    }
  });
  logger.info("[AuditLogPurge] Cron scheduled", { schedule: PURGE_SCHEDULE, enabled: ENABLED });
}

export function stopAuditLogPurgeCron(): void {
  cronTask?.stop();
  cronTask = null;
}
