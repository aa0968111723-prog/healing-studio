/**
 * r2SnapshotJob.ts — 每日 Cloudflare R2 儲存空間快照
 * 每天凌晨 2 點（UTC+8 = 18:00 UTC）執行
 * 掃描 R2 bucket，統計各類型媒體大小，寫入 r2_storage_snapshots 資料表
 */

import * as cron from "node-cron";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getDb } from "../db.js";
import { r2StorageSnapshots } from "../../drizzle/schema.js";

// ─── R2 定價常數 ──────────────────────────────────────────────────────────────
/** $0.015 per GB per month */
const R2_STORAGE_PRICE_PER_GB = 0.015;
/** $0.36 per million Class A operations */
const R2_CLASS_A_OPS_PRICE_PER_MILLION = 0.36;

// ─── 路徑前綴分類定義 ──────────────────────────────────────────────────────────
const PREFIX_CATEGORIES: Record<string, string> = {
  "images/": "images",
  "videos/": "videos",
  "audio/": "audio",
  "voice/": "voice",
  "models/": "models",
};

function classifyKey(key: string): string {
  for (const [prefix, category] of Object.entries(PREFIX_CATEGORIES)) {
    if (key.startsWith(prefix)) return category;
  }
  return "other";
}

// ─── State ───────────────────────────────────────────────────────────────────
let cronTask: cron.ScheduledTask | null = null;

// ─── 核心邏輯 ─────────────────────────────────────────────────────────────────

/**
 * 執行一次 R2 儲存空間快照：
 * 1. 掃描整個 bucket（分頁列舉）
 * 2. 依路徑前綴分類統計
 * 3. 計算估算月費
 * 4. 寫入 DB 或 console.log
 */
export async function takeR2Snapshot(): Promise<void> {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const bucketName = process.env.S3_BUCKET_NAME;

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName) {
    console.warn(
      "[R2Snapshot] ⚠️  R2 環境變數未設定（S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_BUCKET_NAME），跳過快照。"
    );
    return;
  }

  console.log("[R2Snapshot] 🔍 開始掃描 R2 bucket:", bucketName);
  const startTime = Date.now();

  // ── 建立 S3Client（指向 Cloudflare R2）────────────────────────────────────
  const s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  // ── 分類統計容器 ──────────────────────────────────────────────────────────
  let totalBytes = 0;
  let totalObjects = 0;
  const bytesByType: Record<string, number> = {};
  const objectsByType: Record<string, number> = {};

  // 初始化各類別
  for (const category of [...Object.values(PREFIX_CATEGORIES), "other"]) {
    bytesByType[category] = 0;
    objectsByType[category] = 0;
  }

  // ── 分頁列舉 bucket 中的所有物件 ──────────────────────────────────────────
  let continuationToken: string | undefined;
  let pageCount = 0;

  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      });

      const response = await s3.send(command);
      pageCount++;

      for (const obj of response.Contents ?? []) {
        const key = obj.Key ?? "";
        const size = obj.Size ?? 0;
        const category = classifyKey(key);

        totalBytes += size;
        totalObjects += 1;
        bytesByType[category] = (bytesByType[category] ?? 0) + size;
        objectsByType[category] = (objectsByType[category] ?? 0) + 1;
      }

      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);
  } catch (err) {
    console.error("[R2Snapshot] ❌ 掃描 bucket 時發生錯誤:", err);
    return;
  }

  const elapsedMs = Date.now() - startTime;
  const totalGB = totalBytes / (1024 ** 3);

  // ── 計算估算月費 ──────────────────────────────────────────────────────────
  // Storage cost: $0.015/GB
  // Class A operations (ListObjectsV2 計為 Class A): $0.36/百萬次
  // 本次執行使用的 Class A ops = pageCount (每頁一次 ListObjectsV2)
  const storageCostUsd = totalGB * R2_STORAGE_PRICE_PER_GB;
  const classAOpsCostUsd =
    (pageCount / 1_000_000) * R2_CLASS_A_OPS_PRICE_PER_MILLION;
  const estimatedMonthlyCostUsd = storageCostUsd + classAOpsCostUsd;

  // ── 格式化輸出 ────────────────────────────────────────────────────────────
  const now = new Date();
  const snapshotDate = now; // Drizzle date() 欄位需要 Date 物件
  const snapshotDateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD 用於 log 輸出
  const summaryLines = [
    `[R2Snapshot] 📸 快照完成（${elapsedMs}ms, ${pageCount} 頁）`,
    `  日期：${snapshotDateStr}`,
    `  總物件數：${totalObjects.toLocaleString()}`,
    `  總大小：${(totalBytes / (1024 ** 2)).toFixed(2)} MB (${totalGB.toFixed(4)} GB)`,
    `  估算月費：$${estimatedMonthlyCostUsd.toFixed(4)} USD`,
    `  各類型分布：`,
    ...Object.entries(bytesByType)
      .filter(([, bytes]) => bytes > 0)
      .map(
        ([type, bytes]) =>
          `    ${type}: ${objectsByType[type]} 個物件, ${(bytes / (1024 ** 2)).toFixed(2)} MB`
      ),
  ];
  summaryLines.forEach(line => console.log(line));

  // ── 嘗試寫入 DB ───────────────────────────────────────────────────────────
  try {
    const db = await getDb();
    if (!db) {
      console.warn("[R2Snapshot] ⚠️  DB 不可用，僅輸出 console.log。");
      return;
    }

    // 確認 r2StorageSnapshots 表存在（由 schema 匯入驗證，若未定義會在 import 階段報錯）
    await db.insert(r2StorageSnapshots).values({
      snapshotDate,
      totalBytes,
      totalObjects,
      bytesByType,
      objectsByType,
      estimatedMonthlyCostUsd: estimatedMonthlyCostUsd.toFixed(4),
    });

    console.log(
      `[R2Snapshot] ✅ 快照已寫入 r2_storage_snapshots（date=${snapshotDateStr}）`
    );
  } catch (dbErr) {
    // r2_storage_snapshots 表不存在或 DB 錯誤時，降級為僅 console.log
    console.warn(
      "[R2Snapshot] ⚠️  無法寫入 DB（表可能尚未建立），快照資料已透過 console.log 輸出。",
      dbErr instanceof Error ? dbErr.message : dbErr
    );
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * 啟動每日 R2 快照 cron。
 * 執行時間：每天 18:00 UTC（= UTC+8 凌晨 02:00）
 */
export function initR2SnapshotCron(): void {
  if (cronTask) {
    console.warn("[R2Snapshot] Cron already initialized, skipping.");
    return;
  }

  // 18:00 UTC = 凌晨 2:00 UTC+8
  cronTask = cron.schedule("0 18 * * *", () => {
    takeR2Snapshot().catch(err =>
      console.error("[R2Snapshot] Cron error:", err)
    );
  });

  console.log(
    "[R2Snapshot] ✅ Cron initialized (daily at 18:00 UTC / 02:00 UTC+8)"
  );
}

/**
 * 停止 R2 快照 cron。
 */
export function stopR2SnapshotCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log("[R2Snapshot] 🛑 Cron stopped");
  }
}
