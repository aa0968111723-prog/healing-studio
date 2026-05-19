/**
 * mediaArchivalService.ts — 把外部媒體 URL 歸檔到內部儲存。
 *
 * 為什麼需要：
 *   AI 提供商（fal.ai、replicate、suno…）回傳的 URL 多半是 24h 或 7 天就過期
 *   的 presigned link。資產庫直接存這個 URL，過了保存期就壞圖。歸檔流程把
 *   檔案搬到自家 S3/R2/GCS，更新 fileUrl 指向新位置，並把原始 URL 留在
 *   sourceUrl 以便回溯。
 *
 * 兩個入口：
 *   - archiveAsset(asset)               — 對單一 digital_asset_library row 操作
 *   - archiveBackgroundJobMedia(jobId)  — 把某個 backgroundJob 產生的所有
 *                                         資產一併歸檔
 *
 * Idempotency：以 archivedAt 欄位判斷。任何 archivedAt !== null 的 row 都
 * 直接 skip，所以重複呼叫（例如 webhook + polling 都觸發）不會重複下載。
 */

import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "../db";
import {
  digitalAssetLibrary,
  generationHistory,
  type DigitalAsset,
  type GenerationHistoryItem,
} from "../../drizzle/schema";
import { detectStorageBackend } from "../storage";
import { isInternalUrl, persistExternalMediaUrl } from "./internalMedia";

type MediaCategory = "image" | "video" | "audio" | "voice" | "binary";

function categoryForAssetType(assetType: DigitalAsset["assetType"]): MediaCategory {
  switch (assetType) {
    case "image":
    case "video":
    case "audio":
    case "voice":
      return assetType;
    default:
      return "binary";
  }
}

function providerLabel(): string | null {
  const backend = detectStorageBackend();
  return backend === "none" ? null : backend;
}

export interface ArchiveAssetResult {
  archived: boolean;
  reason?: "already-archived" | "no-file-url" | "already-internal";
  fileUrl?: string;
  sourceUrl?: string | null;
}

export async function archiveAsset(
  asset: DigitalAsset
): Promise<ArchiveAssetResult> {
  if (asset.archivedAt) {
    return { archived: false, reason: "already-archived" };
  }

  const originalUrl = asset.fileUrl?.trim();
  const db = await getDb();
  if (!db) return { archived: false, reason: "no-file-url" };

  const now = new Date();
  const provider = providerLabel();

  if (!originalUrl) {
    await db
      .update(digitalAssetLibrary)
      .set({ archivedAt: now, ...(provider ? { provider } : {}) })
      .where(eq(digitalAssetLibrary.id, asset.id));
    return { archived: true, reason: "no-file-url" };
  }

  if (isInternalUrl(originalUrl)) {
    await db
      .update(digitalAssetLibrary)
      .set({ archivedAt: now, ...(provider ? { provider } : {}) })
      .where(eq(digitalAssetLibrary.id, asset.id));
    return {
      archived: true,
      reason: "already-internal",
      fileUrl: originalUrl,
    };
  }

  const category = categoryForAssetType(asset.assetType);
  const prefix = `archived/${category}/${asset.userId}`;
  const internalUrl = await persistExternalMediaUrl(originalUrl, {
    category,
    prefix,
  });

  await db
    .update(digitalAssetLibrary)
    .set({
      fileUrl: internalUrl,
      fileKey: internalUrl,
      sourceUrl: originalUrl,
      archivedAt: now,
      ...(provider ? { provider } : {}),
    })
    .where(eq(digitalAssetLibrary.id, asset.id));

  return {
    archived: true,
    fileUrl: internalUrl,
    sourceUrl: originalUrl,
  };
}

export interface ArchiveBackgroundJobMediaResult {
  jobId: number;
  total: number;
  archived: number;
  skipped: number;
  failed: number;
}

export async function archiveBackgroundJobMedia(
  jobId: number
): Promise<ArchiveBackgroundJobMediaResult> {
  const db = await getDb();
  if (!db) {
    return { jobId, total: 0, archived: 0, skipped: 0, failed: 0 };
  }

  const assets = await db
    .select()
    .from(digitalAssetLibrary)
    .where(eq(digitalAssetLibrary.backgroundJobId, jobId));

  let archived = 0;
  let skipped = 0;
  let failed = 0;

  for (const asset of assets) {
    try {
      const result = await archiveAsset(asset);
      if (result.archived) archived += 1;
      else skipped += 1;
    } catch {
      failed += 1;
    }
  }

  return { jobId, total: assets.length, archived, skipped, failed };
}

export interface EnqueueMediaArchivalTaskInput {
  userId: number;
  backgroundJobId?: number | null;
  resultUrl: string;
  modality: "image" | "video" | "audio" | "voice";
}

/**
 * 保底入庫任務：把 doPostGenComplete 寫進資產庫的外部 URL 拉回自家儲存。
 *
 * 目前是同進程版本 —— 回傳的 Promise 真正執行歸檔（呼叫方用 .catch 吞錯，
 * 不 await 也不阻塞主流程）。優先用 backgroundJobId 走 archiveBackgroundJobMedia,
 * 沒有就以 (userId, fileUrl) 反查 digital_asset_library 找到剛寫入的 row。
 *
 * 若哪天要改成真正持久化的 queue（process 重啟可恢復），把 body 換成
 * createBackgroundJob({ jobType: "media_archival", ... }) 即可，呼叫端不必動。
 */
export async function enqueueMediaArchivalTask(
  input: EnqueueMediaArchivalTaskInput
): Promise<void> {
  const { userId, backgroundJobId, resultUrl, modality: _modality } = input;
  if (!resultUrl || isInternalUrl(resultUrl)) return;

  if (typeof backgroundJobId === "number") {
    await archiveBackgroundJobMedia(backgroundJobId);
    return;
  }

  const db = await getDb();
  if (!db) return;
  const rows = await db
    .select()
    .from(digitalAssetLibrary)
    .where(
      and(
        eq(digitalAssetLibrary.userId, userId),
        eq(digitalAssetLibrary.fileUrl, resultUrl)
      )
    )
    .limit(1);
  const asset = rows[0];
  if (asset) await archiveAsset(asset);
}

/**
 * 對單一 generation_history row 做歸檔 —— 和 archiveAsset 對稱，但寫
 * 不同欄位（resultUrl 而非 fileUrl，無 fileKey）。Idempotency 一樣靠
 * archivedAt 把關。
 */
export async function archiveHistoryEntry(
  entry: GenerationHistoryItem
): Promise<ArchiveAssetResult> {
  if (entry.archivedAt) {
    return { archived: false, reason: "already-archived" };
  }

  const originalUrl = entry.resultUrl?.trim();
  const db = await getDb();
  if (!db) return { archived: false, reason: "no-file-url" };

  const now = new Date();
  const provider = providerLabel();

  if (!originalUrl) {
    await db
      .update(generationHistory)
      .set({ archivedAt: now, ...(provider ? { provider } : {}) })
      .where(eq(generationHistory.id, entry.id));
    return { archived: true, reason: "no-file-url" };
  }

  if (isInternalUrl(originalUrl)) {
    await db
      .update(generationHistory)
      .set({ archivedAt: now, ...(provider ? { provider } : {}) })
      .where(eq(generationHistory.id, entry.id));
    return {
      archived: true,
      reason: "already-internal",
      fileUrl: originalUrl,
    };
  }

  const category = categoryForAssetType(entry.modality);
  const prefix = `archived/${category}/${entry.userId}`;
  const internalUrl = await persistExternalMediaUrl(originalUrl, {
    category,
    prefix,
  });

  await db
    .update(generationHistory)
    .set({
      resultUrl: internalUrl,
      sourceUrl: originalUrl,
      archivedAt: now,
      ...(provider ? { provider } : {}),
    })
    .where(eq(generationHistory.id, entry.id));

  return {
    archived: true,
    fileUrl: internalUrl,
    sourceUrl: originalUrl,
  };
}

export interface RunMediaArchivalResult {
  assets: { total: number; archived: number; skipped: number; failed: number };
  history: { total: number; archived: number; skipped: number; failed: number };
}

/**
 * 掃描 digital_asset_library + generation_history 裡 archivedAt IS NULL 且
 * 有 URL 的 row，逐筆呼叫 archiveAsset / archiveHistoryEntry。為了避免一次
 * 拉太多，每張表各取 `batchSize` 筆（預設 20）。被 mediaArchivalCron 定期呼叫，
 * 也可供測試 / 手動腳本直接使用。
 */
export async function runMediaArchival(batchSize = 20): Promise<RunMediaArchivalResult> {
  const result: RunMediaArchivalResult = {
    assets: { total: 0, archived: 0, skipped: 0, failed: 0 },
    history: { total: 0, archived: 0, skipped: 0, failed: 0 },
  };

  const db = await getDb();
  if (!db) return result;

  const assets = await db
    .select()
    .from(digitalAssetLibrary)
    .where(
      and(
        isNull(digitalAssetLibrary.archivedAt),
        isNotNull(digitalAssetLibrary.fileUrl)
      )
    )
    .orderBy(asc(digitalAssetLibrary.createdAt))
    .limit(batchSize);
  result.assets.total = assets.length;
  for (const asset of assets) {
    try {
      const r = await archiveAsset(asset);
      if (r.archived) result.assets.archived += 1;
      else result.assets.skipped += 1;
    } catch {
      result.assets.failed += 1;
    }
  }

  const history = await db
    .select()
    .from(generationHistory)
    .where(
      and(
        isNull(generationHistory.archivedAt),
        isNotNull(generationHistory.resultUrl)
      )
    )
    .orderBy(asc(generationHistory.createdAt))
    .limit(batchSize);
  result.history.total = history.length;
  for (const entry of history) {
    try {
      const r = await archiveHistoryEntry(entry);
      if (r.archived) result.history.archived += 1;
      else result.history.skipped += 1;
    } catch {
      result.history.failed += 1;
    }
  }

  return result;
}
