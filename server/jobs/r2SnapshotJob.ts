/**
 * r2SnapshotJob.ts — 每日 Cloudflare R2 儲存空間快照（AIDV-66 M3 加強版）
 *
 * 每天凌晨 2 點（UTC+8 = 18:00 UTC）執行兩層快照：
 *   1. 彙總層：掃描整個 bucket，統計各類型大小，寫 r2_storage_snapshots（原有）
 *   2. 物件層（AIDV-66 新增）：列舉 archived/ 前綴的物件，逐一記錄
 *      key/size/etag/category/lastModified 到 r2_object_catalog。
 *      若任何物件日後消失，可透過 catalog 偵測遺失並嘗試從 sourceUrl 回溯。
 *
 * ENABLE_R2_CATALOG 旗標（預設 ON）可透過 env 關閉物件層快照：
 *   ENABLE_R2_CATALOG=false  → 僅跑彙總層
 *
 * 鐵則：金鑰只走 env（S3_*）；失敗只 console.warn，不 throw、不讓 app crash。
 */

import * as cron from "node-cron";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getDb } from "../db.js";
import { r2StorageSnapshots, r2ObjectCatalog } from "../../drizzle/schema.js";

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

export function classifyKey(key: string): string {
  for (const [prefix, category] of Object.entries(PREFIX_CATEGORIES)) {
    if (key.startsWith(prefix)) return category;
  }
  return "other";
}

// ─── 旗標 ─────────────────────────────────────────────────────────────────────

/**
 * ENABLE_R2_CATALOG — 物件層快照開關，預設 ON。
 * 明確設為 "false"/"0"/"off"/"no" 才關閉（大小寫不拘、前後空白忽略）。
 */
export function isR2CatalogEnabled(): boolean {
  const v = (process.env.ENABLE_R2_CATALOG ?? "").trim().toLowerCase();
  return v !== "false" && v !== "0" && v !== "off" && v !== "no";
}

// ─── 最大物件數上限（防止超大 bucket 耗盡 DB write 額度）────────────────────
const CATALOG_MAX_OBJECTS = 5_000;

// ─── State ───────────────────────────────────────────────────────────────────
let cronTask: cron.ScheduledTask | null = null;

// ─── 物件層快照（AIDV-66）────────────────────────────────────────────────────

/**
 * 掃描 archived/ 前綴，逐物件寫入 r2_object_catalog。
 * 最多捕捉 CATALOG_MAX_OBJECTS 個物件（防止超大 bucket 爆寫）。
 * 失敗只 console.warn，不 throw。
 *
 * @returns 實際寫入的物件數
 */
export async function takeR2ObjectCatalog(
  snapshotId: number,
  s3: S3Client,
  bucketName: string
): Promise<number> {
  const db = await getDb();
  if (!db) {
    console.warn("[R2Catalog] ⚠️  DB 不可用，跳過物件層快照。");
    return 0;
  }

  console.log("[R2Catalog] 🔍 開始列舉 archived/ 前綴物件（最多", CATALOG_MAX_OBJECTS, "個）");

  const rows: (typeof r2ObjectCatalog.$inferInsert)[] = [];
  let continuationToken: string | undefined;
  let totalScanned = 0;

  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: "archived/",
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      });
      const response = await s3.send(command);

      for (const obj of response.Contents ?? []) {
        if (totalScanned >= CATALOG_MAX_OBJECTS) break;
        const key = obj.Key ?? "";
        const category = classifyKey(key);
        rows.push({
          snapshotId,
          objectKey: key,
          fileSizeBytes: obj.Size ?? 0,
          etag: obj.ETag?.replace(/"/g, "").slice(0, 64) ?? null,
          category,
          lastModified: obj.LastModified ?? null,
        });
        totalScanned++;
      }

      continuationToken =
        response.IsTruncated && totalScanned < CATALOG_MAX_OBJECTS
          ? response.NextContinuationToken
          : undefined;
    } while (continuationToken);
  } catch (err) {
    console.warn("[R2Catalog] ⚠️  列舉 archived/ 物件失敗:", err);
    return 0;
  }

  if (rows.length === 0) {
    console.log("[R2Catalog] ℹ️  archived/ 前綴無物件，跳過寫入。");
    return 0;
  }

  // 批次寫入（每批 200 筆，避免單一 insert 過大）
  const BATCH = 200;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    try {
      await db.insert(r2ObjectCatalog).values(batch);
      written += batch.length;
    } catch (err) {
      console.warn(
        `[R2Catalog] ⚠️  批次寫入第 ${i}–${i + batch.length} 筆失敗:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(`[R2Catalog] ✅ 物件層快照完成：寫入 ${written} 筆（掃描 ${totalScanned} 個）`);
  return written;
}

// ─── 核心邏輯 ─────────────────────────────────────────────────────────────────

/**
 * 執行一次 R2 儲存空間快照：
 * 1. 掃描整個 bucket（分頁列舉）→ 彙總統計 → 寫 r2_storage_snapshots
 * 2. （若 ENABLE_R2_CATALOG=ON）列舉 archived/ 物件 → 寫 r2_object_catalog
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

  // ── 建立 S3Client（指向 Cloudflare R2）────────────────────────────────────
  const s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  // AIDV-780：cron 每日執行，S3Client 用畢必須 destroy 釋放連線池，
  // 否則長期累積 socket/handle 洩漏。try/finally 覆蓋所有 early return。
  try {
    await takeR2SnapshotWithClient(s3, bucketName);
  } finally {
    s3.destroy();
  }
}

/** 實際快照邏輯（S3Client 生命週期由 takeR2Snapshot 管理） */
async function takeR2SnapshotWithClient(
  s3: S3Client,
  bucketName: string
): Promise<void> {
  const startTime = Date.now();

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
  const storageCostUsd = totalGB * R2_STORAGE_PRICE_PER_GB;
  const classAOpsCostUsd =
    (pageCount / 1_000_000) * R2_CLASS_A_OPS_PRICE_PER_MILLION;
  const estimatedMonthlyCostUsd = storageCostUsd + classAOpsCostUsd;

  // ── 格式化輸出 ────────────────────────────────────────────────────────────
  const now = new Date();
  const snapshotDate = now;
  const snapshotDateStr = now.toISOString().slice(0, 10);
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

  // ── 寫入彙總快照 DB ───────────────────────────────────────────────────────
  let snapshotId: number | null = null;
  try {
    const db = await getDb();
    if (!db) {
      console.warn("[R2Snapshot] ⚠️  DB 不可用，僅輸出 console.log。");
      return;
    }

    const result = await db.insert(r2StorageSnapshots).values({
      snapshotDate,
      totalBytes,
      totalObjects,
      bytesByType,
      objectsByType,
      estimatedMonthlyCostUsd: estimatedMonthlyCostUsd.toFixed(4),
    });
    snapshotId = result[0].insertId ?? null;
    console.log(
      `[R2Snapshot] ✅ 彙總快照已寫入 r2_storage_snapshots（date=${snapshotDateStr}, id=${snapshotId}）`
    );
  } catch (dbErr) {
    console.warn(
      "[R2Snapshot] ⚠️  無法寫入 DB（表可能尚未建立），快照資料已透過 console.log 輸出。",
      dbErr instanceof Error ? dbErr.message : dbErr
    );
    return;
  }

  // ── 物件層快照（AIDV-66，僅當旗標 ON 且彙總快照寫入成功）──────────────────
  if (snapshotId !== null && isR2CatalogEnabled()) {
    try {
      await takeR2ObjectCatalog(snapshotId, s3, bucketName);
    } catch (catalogErr) {
      console.warn(
        "[R2Snapshot] ⚠️  物件層快照失敗（不影響彙總快照）:",
        catalogErr instanceof Error ? catalogErr.message : catalogErr
      );
    }
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
