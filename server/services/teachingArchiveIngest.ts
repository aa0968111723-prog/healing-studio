/**
 * teachingArchiveIngest.ts
 *
 * 資料庫上傳後的內容抽取：填 `textContent` + `transcriptionStatus`，
 * 讓 Phase 2 RAG 檢索能依內容搜尋，而非只看 title/description。
 *
 * Strategy:
 *   - PDF        → `extractPdfTextFromUrl` (unpdf, fast)
 *   - audio/video → `transcribeMedia` (ElevenLabs Scribe — minutes for long files)
 *   - text/document/image/presentation → 不處理（image/PPT/Word 需要其他抽取器，先留空）
 *
 * 兩個入口：
 *   - `enqueueTeachingIngestion(materialId)` — 給 router 用，建一筆 background
 *     job 入 queue；worker (teachingArchiveIngestionWorker) 會撿起來跑。
 *   - `runTeachingIngestion(material)` — 真正執行抽取的同步函式，worker 內呼叫。
 *
 * 之前的 `scheduleTeachingIngestion` 用 setImmediate fire-and-forget，process
 * 重啟會丟任務；改成 backgroundJobs queue 後重啟可恢復。
 */

import * as db from "../db";
import { extractPdfTextFromUrl } from "./pdfTextExtractor";
import { transcribeMedia } from "./mediaTranscriber";
import { upsertTeachingMaterialVectors } from "./teachingArchiveRag";
import type { TeachingMaterial } from "../../drizzle/schema";

const MAX_TEXT_CHARS = 200_000; // 跟 schema 上的 textContent TEXT 欄位上限差一截，留 buffer

type IngestableMediaType = "pdf" | "audio" | "video";

function isIngestable(
  mediaType: TeachingMaterial["mediaType"]
): mediaType is IngestableMediaType {
  return mediaType === "pdf" || mediaType === "audio" || mediaType === "video";
}

/**
 * 把 ingestion 任務排進 backgroundJobs queue。回傳 jobId（給上層測試 / debug 用）。
 * 真正的執行由 teachingArchiveIngestionWorker cron 撿起來；process 重啟也不會丟。
 */
export async function enqueueTeachingIngestion(
  materialId: number,
  userId: number
): Promise<number | null> {
  const row = await db.getTeachingMaterial(materialId);
  if (!row) return null;
  if (!isIngestable(row.mediaType)) return null;
  if (!row.fileUrl) return null;
  // 已有手填文字稿就不再排隊，直接標 completed。
  if (row.textContent && row.textContent.trim().length > 0) {
    if (row.transcriptionStatus !== "completed") {
      await db.updateTeachingMaterial(materialId, {
        transcriptionStatus: "completed",
      });
    }
    return null;
  }

  await db.updateTeachingMaterial(materialId, {
    transcriptionStatus: "pending",
  });

  const jobId = await db.createBackgroundJob({
    jobType: "teaching_archive_ingestion",
    status: "queued",
    userId,
    resultJson: { materialId },
  });
  return jobId;
}

/**
 * 同步執行單一素材的抽取流程；worker 內呼叫。把 row 標 processing → 跑抽取
 * → 完成後寫回 textContent + status；失敗則標 failed 並 throw 讓 worker 紀錄。
 */
export async function runTeachingIngestion(
  row: TeachingMaterial
): Promise<void> {
  if (!row.fileUrl || !isIngestable(row.mediaType)) return;

  // 標 processing — worker 也會在外層標一次，這裡再保險（萬一是直接被呼叫）。
  if (row.transcriptionStatus !== "processing") {
    await db.updateTeachingMaterial(row.id, {
      transcriptionStatus: "processing",
    });
  }
  await doExtraction(row);
}

async function doExtraction(row: TeachingMaterial): Promise<void> {
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

  // ── 向量索引（Pinecone）— 失敗不擋主流程 ────────────────────────────
  // 重抓 row 以便用最新的 textContent / pageCount 餵 embedding。
  // 不 await — 但要捕捉錯誤避免 unhandled rejection。
  const fresh = await db.getTeachingMaterial(row.id);
  if (fresh) {
    upsertTeachingMaterialVectors(fresh).catch(err => {
      console.warn(
        `[teachingArchiveIngest] vector upsert non-fatal failure for material=${row.id}:`,
        err
      );
    });
  }
}

/** 給測試用：對外露出 isIngestable 純函式 */
export const __teachingArchiveIngestInternals = {
  isIngestable,
  MAX_TEXT_CHARS,
};
