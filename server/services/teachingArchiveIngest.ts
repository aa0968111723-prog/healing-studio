/**
 * teachingArchiveIngest.ts
 *
 * Background ingestion for newly-uploaded teaching materials. Fills the
 * `textContent` + `transcriptionStatus` columns so Phase 2 RAG retrieval can
 * search by content, not just title/description.
 *
 * Strategy:
 *   - PDF        → `extractTextFromPdf` (unpdf, fast, sync-able)
 *   - audio/video → `transcribeMedia` (ElevenLabs Scribe — minutes for long files)
 *   - text/document/image/presentation → 不處理（image/PPT/Word 需要其他抽取器，先留空，狀態維持 not_applicable）
 *
 * Called fire-and-forget from the `teachingArchive.create` mutation. The
 * Express request returns immediately; the row's `transcriptionStatus`
 * updates asynchronously and the client polls `get` to see when it lands.
 */

import * as db from "../db";
import { extractPdfTextFromUrl } from "./pdfTextExtractor";
import { transcribeMedia } from "./mediaTranscriber";
import type { TeachingMaterial } from "../../drizzle/schema";

const MAX_TEXT_CHARS = 200_000; // 跟 schema 上的 textContent TEXT 欄位上限差一截，留 buffer

type IngestableMediaType = "pdf" | "audio" | "video";

function isIngestable(
  mediaType: TeachingMaterial["mediaType"]
): mediaType is IngestableMediaType {
  return mediaType === "pdf" || mediaType === "audio" || mediaType === "video";
}

/**
 * 啟動指定教材的內容抽取流程（PDF 抽文 / 語音轉文字）。
 *
 * - 同步把狀態改成 `processing` 後立即 return；
 * - 真正的抽取工作在 background promise 裡跑，完成後寫回 textContent + status；
 * - 失敗時把 status 標 `failed`，錯誤訊息寫進 transcript 欄位前綴方便除錯。
 *
 * 呼叫端用 `.catch(() => {})` 包起來避免 unhandled rejection。
 */
export async function scheduleTeachingIngestion(
  materialId: number
): Promise<void> {
  const row = await db.getTeachingMaterial(materialId);
  if (!row) return;
  if (!isIngestable(row.mediaType)) return;
  if (!row.fileUrl) return;
  // 已經有 textContent 的情況：使用者手動貼上文字稿，不需要再跑抽取。
  if (row.textContent && row.textContent.trim().length > 0) {
    if (row.transcriptionStatus !== "completed") {
      await db.updateTeachingMaterial(materialId, {
        transcriptionStatus: "completed",
      });
    }
    return;
  }

  await db.updateTeachingMaterial(materialId, {
    transcriptionStatus: "processing",
  });

  // Fire-and-forget — caller doesn't await.
  void runIngestion(row).catch(async err => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[teachingArchiveIngest] material=${materialId} failed:`,
      message
    );
    await db
      .updateTeachingMaterial(materialId, {
        transcriptionStatus: "failed",
      })
      .catch(() => {});
  });
}

async function runIngestion(row: TeachingMaterial): Promise<void> {
  if (!row.fileUrl || !isIngestable(row.mediaType)) return;

  let text: string;
  let pageCount: number | undefined;

  if (row.mediaType === "pdf") {
    const result = await extractPdfTextFromUrl(row.fileUrl, {
      maxChars: MAX_TEXT_CHARS,
    });
    if (!result) {
      // 抽取失敗 / 跳過（PDF 拒絕或抓不到）— 標 failed 讓使用者可以重跑
      throw new Error("PDF 抽文回傳 null（可能是檔案無法存取或格式異常）");
    }
    text = result.text;
    pageCount = result.pageCount;
  } else {
    const result = await transcribeMedia({
      userId: row.userId,
      mediaUrl: row.fileUrl,
    });
    text = result.transcript;
  }

  // 超過上限就裁切，留個結尾標記讓使用者知道有截斷
  const truncated = text.length > MAX_TEXT_CHARS;
  const stored = truncated
    ? text.slice(0, MAX_TEXT_CHARS) + "\n\n…（內容已截斷）"
    : text;

  await db.updateTeachingMaterial(row.id, {
    textContent: stored,
    transcriptionStatus: "completed",
    ...(pageCount !== undefined ? { pageCount } : {}),
  });
}

/** 給測試用：對外露出 isIngestable 純函式 */
export const __teachingArchiveIngestInternals = {
  isIngestable,
  MAX_TEXT_CHARS,
};
