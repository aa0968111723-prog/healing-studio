/**
 * assetCleanupJob.ts — AIDV-67 / M4 儲存清理 cron（過期資產 → 刪 R2 物件＋DB 列）。
 *
 * 為什麼存在：
 *   資產列上有 `expiresAt`（保留期，0058 migration 加的冷儲存/保留欄位）。一旦有
 *   保留政策替資產設定到期時間，過期的資產應被清掉以回收 R2 儲存空間與 DB 列。
 *   本 cron 每小時掃一批過期資產，刪掉其儲存物件（沒被其他列共用時）與 DB 列。
 *
 * 安全鐵則（破壞性 job 的紀律）：
 *   1. ENABLE_ASSET_TTL_CLEANUP 預設 **OFF** ＝ 正式站零行為變化；需 Bruce 明確開。
 *   2. 即使開了旗標，ASSET_TTL_CLEANUP_DRY_RUN 預設 **ON（演練）**＝ 只統計、不刪。
 *      兩段式安全閥：開旗標 → 先看演練數字 → 確認無誤再關 dry-run 真刪。
 *   3. fail-never：任何失敗只記 log + Sentry，永不 throw、不讓 app crash。
 *   4. 防重入：上一輪還在跑時新一輪直接跳過。
 *   5. 共用 key 守門：fileKey 被其他資產列共用時不刪物件（免得刪一列害其他列壞圖）。
 *
 * Pattern：仿 mediaArchivalCron / dbSnapshotJob（node-cron + isRunning 防重疊 +
 * 旗標純函式 + 委派純邏輯給 assetCleanupService 便於單測）。
 */

import * as cron from "node-cron";
import * as db from "../db";
import { storageDelete } from "../storage";
import { runAssetCleanup } from "../services/assetCleanupService";
import { captureError } from "../_core/errorTracking.js";

const SWEEP_SCHEDULE = "17 * * * *"; // 每小時第 17 分（錯開其他 maintenance job）
const MAX_BATCH = 50;

let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;

/**
 * ENABLE_ASSET_TTL_CLEANUP — 預設 OFF（破壞性：會刪 R2 物件＋DB 列）。
 * 只有明確設成 "true"/"1"/"on"/"yes"（大小寫不拘）才開啟；其餘（含未設、留空、
 * "false"）皆關閉。對應安全鐵則：破壞性行為預設關，需明確開啟。
 */
export function isAssetTtlCleanupEnabled(): boolean {
  const raw = (process.env.ENABLE_ASSET_TTL_CLEANUP ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "on" || raw === "yes";
}

/**
 * ASSET_TTL_CLEANUP_DRY_RUN — 預設 ON（演練）。即使開了 ENABLE_ASSET_TTL_CLEANUP，
 * 預設仍只「演練」（統計＋log、不刪）。要真刪需明確設 "false"/"0"/"off"/"no"。
 */
export function isAssetTtlCleanupDryRun(): boolean {
  const raw = (process.env.ASSET_TTL_CLEANUP_DRY_RUN ?? "").trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off" || raw === "no") return false;
  return true;
}

function logWorker(level: "info" | "warn" | "error", message: string): void {
  const icon = level === "info" ? "✅" : level === "warn" ? "⚠️" : "❌";
  console.log(`${icon} [assetCleanup] ${message}`);
}

export async function runAssetCleanupSweep(): Promise<void> {
  // 旗標關＝零行為變化（連 DB 都不碰）。
  if (!isAssetTtlCleanupEnabled()) return;
  if (isRunning) {
    logWorker("info", "已有實例運行中，跳過此次排程");
    return;
  }
  isRunning = true;
  const dryRun = isAssetTtlCleanupDryRun();
  try {
    const result = await runAssetCleanup(
      { limit: MAX_BATCH, dryRun },
      {
        listExpired: (limit, asOf) => db.listExpiredDigitalAssets(limit, asOf),
        countOthersByFileKey: (fileKey, excludeId) =>
          db.countOtherDigitalAssetsByFileKey(fileKey, excludeId),
        deleteStorageObject: async fileKey => {
          await storageDelete(fileKey);
        },
        deleteAssetRow: id => db.deleteDigitalAsset(id),
      }
    );
    if (result.scanned === 0) return;
    logWorker(
      "info",
      `${dryRun ? "[演練] " : ""}掃描=${result.scanned} 刪物件=${result.storageDeleted} ` +
        `刪列=${result.rowsDeleted} 共用key跳過=${result.skippedSharedKey} 失敗=${result.errors}`
    );
  } finally {
    isRunning = false;
  }
}

export function initAssetCleanupCron(): void {
  if (cronTask) return;
  cronTask = cron.schedule(SWEEP_SCHEDULE, async () => {
    try {
      await runAssetCleanupSweep();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logWorker("error", `排程執行異常: ${message}`);
      captureError(err instanceof Error ? err : new Error(message));
    }
  });
  const enabled = isAssetTtlCleanupEnabled();
  logWorker(
    "info",
    `儲存清理 Worker 排程已註冊（每小時）— 旗標 ${
      enabled ? (isAssetTtlCleanupDryRun() ? "ON/演練" : "ON/真刪") : "OFF"
    }`
  );
}

export function stopAssetCleanupCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logWorker("info", "Worker 排程已停止");
  }
}
