/**
 * teachingArchiveRag.ts — 資料庫向量檢索（Phase 2 RAG）
 *
 * 把 teaching_materials.textContent（由 ingestion worker 抽取 / 轉文字後產生）
 * 切片 → 透過 gemini-embedding-001 嵌入 → 寫進 Pinecone namespace
 * `teaching-{userId}`。光球 / search endpoint 之後可用語意搜尋而非 LIKE。
 *
 * 跟 ragMemory.ts 共用同一個 Pinecone index（ai-director-memories）但走獨立
 * namespace，所以光球的「同時查記憶 + 資料庫」是兩條平行 query 結果合併，
 * 不會互相污染。
 *
 * Chunk 策略：
 *   - 1200 字元為主、200 字元 overlap
 *   - 句子 / 段落界線優先（看到 \n\n 或 。 \n 就停）
 *   - 太短的文本（< 200 字元）整段當一個 chunk，不切
 *
 * 失敗策略：
 *   - 任何環節失敗（embedding API down / Pinecone down）都 silent return，
 *     讓 LIKE fallback 接手。RAG 是錦上添花，不是必需。
 */

import {
  EMBEDDING_DIM,
  getEmbedding,
  getIndexHost,
  getPineconeHeaders,
} from "./ragMemory";
import { serverEnv } from "../_core/env.validated";
import { featureFlags } from "../_core/featureFlags";
import type { TeachingMaterial } from "../../drizzle/schema";

const CHUNK_TARGET_CHARS = 1200;
const CHUNK_OVERLAP_CHARS = 200;
const MIN_CHUNK_CHARS = 200;
const NS_PREFIX = "teaching-";

function namespaceForUser(userId: number): string {
  return `${NS_PREFIX}${userId}`;
}

/**
 * 把長文切片。盡量在句號 / 換行 / 空白等自然斷點切，避免把名詞切成兩半。
 *
 * 故意做成 deterministic：同一段文字總是切出一樣的 chunks。重新 upsert 時
 * 可以用 chunkIndex 取代舊向量，不會留 orphan。
 */
export function chunkTextForEmbedding(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (cleaned.length <= MIN_CHUNK_CHARS) {
    return cleaned.length > 0 ? [cleaned] : [];
  }

  const chunks: string[] = [];
  let pos = 0;
  while (pos < cleaned.length) {
    const remaining = cleaned.length - pos;
    if (remaining <= CHUNK_TARGET_CHARS) {
      chunks.push(cleaned.slice(pos).trim());
      break;
    }
    // 先框出 target window；在 window 末段找最近的「自然斷點」收尾。
    let end = pos + CHUNK_TARGET_CHARS;
    const lookbackWindow = cleaned.slice(end - 100, end + 100);
    const breakOffsets = [
      lookbackWindow.lastIndexOf("\n\n"),
      lookbackWindow.lastIndexOf("。"),
      lookbackWindow.lastIndexOf("\n"),
      lookbackWindow.lastIndexOf(" "),
    ].filter(i => i >= 0);
    if (breakOffsets.length > 0) {
      const best = Math.max(...breakOffsets);
      end = end - 100 + best + 1;
    }
    chunks.push(cleaned.slice(pos, end).trim());
    pos = Math.max(end - CHUNK_OVERLAP_CHARS, pos + 1);
  }
  return chunks.filter(c => c.length > 0);
}

/**
 * Upsert 一份資料庫素材的所有 chunks 到 Pinecone。
 * vectorId 格式：teaching-{userId}-mat-{materialId}-c{chunkIndex}
 * 後續呼叫會用同一組 id 覆寫，所以重新跑 ingestion 不會留垃圾向量。
 */
export async function upsertTeachingMaterialVectors(
  material: TeachingMaterial
): Promise<{ chunksUpserted: number; skipped?: string }> {
  if (!featureFlags.isEnabled("RAG_MEMORY")) {
    return { chunksUpserted: 0, skipped: "RAG_MEMORY disabled" };
  }
  if (!serverEnv.PINECONE_API_KEY) {
    return { chunksUpserted: 0, skipped: "PINECONE_API_KEY missing" };
  }
  const text = material.textContent?.trim();
  if (!text) return { chunksUpserted: 0, skipped: "empty textContent" };

  const chunks = chunkTextForEmbedding(text);
  if (chunks.length === 0) return { chunksUpserted: 0, skipped: "no chunks" };

  try {
    const host = await getIndexHost();
    const namespace = namespaceForUser(material.userId);

    // batch embeddings — Gemini API 不接受 batch，逐個 call 但並發 4 條控住流量
    const embeddings: Array<{ values: number[]; chunk: string; idx: number }> = [];
    const BATCH = 4;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (chunk, j) => {
          const values = await getEmbedding(chunk);
          return { values, chunk, idx: i + j };
        })
      );
      embeddings.push(...results);
    }

    // 一次 upsert（Pinecone 一次最多 1000 個 vector，這裡上限遠低於那個）
    const vectors = embeddings.map(e => ({
      id: `teaching-${material.userId}-mat-${material.id}-c${e.idx}`,
      values: e.values,
      metadata: {
        materialId: material.id,
        userId: material.userId,
        teamId: material.teamId ?? 0,
        visibility: material.visibility,
        mediaType: material.mediaType,
        title: material.title.slice(0, 200),
        lineage: material.lineage ?? "",
        topic: material.topic ?? "",
        speaker: material.speaker ?? "",
        sourceType: material.sourceType,
        chunkIndex: e.idx,
        chunkText: e.chunk.slice(0, 1000), // 留前 1000 字當 snippet 直接回顯
        timestamp: Date.now(),
      },
    }));

    await fetch(`${host}/vectors/upsert`, {
      method: "POST",
      headers: getPineconeHeaders(),
      body: JSON.stringify({ vectors, namespace }),
    });

    return { chunksUpserted: vectors.length };
  } catch (err) {
    console.warn(
      `[teachingArchiveRag] upsert failed material=${material.id}:`,
      err instanceof Error ? err.message : err
    );
    return { chunksUpserted: 0, skipped: "upsert error" };
  }
}

export interface TeachingVectorHit {
  materialId: number;
  score: number;
  chunkIndex: number;
  chunkText: string;
  title: string;
  lineage: string;
  topic: string;
}

/**
 * 對使用者的 teaching namespace 做語意搜尋。回傳依分數遞減的命中 chunks；
 * 同一個 materialId 可能命中多個 chunk，呼叫端要去重 / 合併。
 *
 * 跟 ragMemory.queryMemories 一樣失敗就靜默回 []，由 LIKE fallback 接手。
 */
export async function queryTeachingArchiveVectors(
  userId: number,
  query: string,
  topK = 20
): Promise<TeachingVectorHit[]> {
  if (!featureFlags.isEnabled("RAG_MEMORY")) return [];
  if (!serverEnv.PINECONE_API_KEY) return [];
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const embedding = await getEmbedding(trimmed);
    const host = await getIndexHost();

    const resp = await fetch(`${host}/query`, {
      method: "POST",
      headers: getPineconeHeaders(),
      body: JSON.stringify({
        vector: embedding,
        topK: Math.max(1, Math.min(topK, 50)),
        includeMetadata: true,
        namespace: namespaceForUser(userId),
      }),
    });
    if (!resp.ok) return [];

    const data = (await resp.json()) as {
      matches: Array<{
        id: string;
        score: number;
        metadata: Record<string, unknown>;
      }>;
    };

    return data.matches.map(m => ({
      materialId: Number(m.metadata.materialId ?? 0),
      score: m.score,
      chunkIndex: Number(m.metadata.chunkIndex ?? 0),
      chunkText: String(m.metadata.chunkText ?? ""),
      title: String(m.metadata.title ?? ""),
      lineage: String(m.metadata.lineage ?? ""),
      topic: String(m.metadata.topic ?? ""),
    }));
  } catch (err) {
    console.warn("[teachingArchiveRag] query failed:", err);
    return [];
  }
}

/**
 * 砍掉某個 material 的所有向量（material 被刪 / 重跑 ingestion 之前）。
 * 用 metadata filter 砍，比 by-id 簡單；Pinecone serverless 支援 delete by metadata。
 */
export async function deleteTeachingVectorsByMaterial(
  userId: number,
  materialId: number
): Promise<void> {
  if (!featureFlags.isEnabled("RAG_MEMORY")) return;
  if (!serverEnv.PINECONE_API_KEY) return;
  try {
    const host = await getIndexHost();
    // Pinecone serverless 不支援 deleteAll + filter；用 prefix 列出後一次砍。
    // 預期一份 material 一般 1~50 個 chunk，影響不大。
    const listResp = await fetch(
      `${host}/vectors/list?prefix=${encodeURIComponent(
        `teaching-${userId}-mat-${materialId}-`
      )}&namespace=${encodeURIComponent(namespaceForUser(userId))}`,
      { headers: getPineconeHeaders() }
    );
    if (!listResp.ok) return;
    const { vectors } = (await listResp.json()) as {
      vectors: Array<{ id: string }>;
    };
    const ids = vectors.map(v => v.id);
    if (ids.length === 0) return;

    await fetch(`${host}/vectors/delete`, {
      method: "POST",
      headers: getPineconeHeaders(),
      body: JSON.stringify({
        ids,
        namespace: namespaceForUser(userId),
      }),
    });
  } catch (err) {
    console.warn(
      `[teachingArchiveRag] delete failed material=${materialId}:`,
      err
    );
  }
}

export const __teachingArchiveRagInternals = {
  chunkTextForEmbedding,
  namespaceForUser,
  CHUNK_TARGET_CHARS,
  MIN_CHUNK_CHARS,
  EMBEDDING_DIM,
};
