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

import { eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  digitalAssetLibrary,
  type DigitalAsset,
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
