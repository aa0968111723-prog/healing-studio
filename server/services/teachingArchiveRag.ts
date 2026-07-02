/**
 * teachingArchiveRag.ts — 資料庫向量檢索（Phase 2 RAG / AIDV-907）
 *
 * 把 teaching_materials.textContent（由 ingestion worker 抽取 / 轉文字後產生）
 * 切片 → 透過 gemini-embedding-001 嵌入 → 寫進向量庫。光球 / search
 * endpoint 之後可用語意搜尋而非 LIKE。
 *
 * 後端（AIDV-907）：Supabase pgvector（rag_teaching_chunks 表）為主，
 * 遺留 Pinecone（namespace `teaching-{userId}`）由 FEATURE_RAG_PINECONE
 * 旗標強制切回，預設 OFF。後端解析共用 ragMemory.resolveRagVectorBackend；
 * pgvector 失敗回退 Pinecone、pgvector 空結果 read-through Pinecone，
 * 過渡期不需資料搬遷。
 *
 * 跟 ragMemory.ts 共用同一個向量庫但走獨立表 / namespace，所以光球的
 * 「同時查記憶 + 資料庫」是兩條平行 query 結果合併，不會互相污染。
 *
 * Chunk 策略：
 *   - 1200 字元為主、200 字元 overlap
 *   - 句子 / 段落界線優先（看到 \n\n 或 。 \n 就停）
 *   - 太短的文本（< 200 字元）整段當一個 chunk，不切
 *
 * 失敗策略：
 *   - 任何環節失敗（embedding API down / 向量庫 down）都 silent return，
 *     讓 LIKE fallback 接手。RAG 是錦上添花，不是必需。
 */

import {
  getEmbedding,
  getIndexHost,
  getPineconeHeaders,
  resolveRagVectorBackend,
  EMBEDDING_DIM,
} from "./ragMemory";
import {
  deleteTeachingChunksPg,
  isPgvectorConfigured,
  queryTeachingChunksPg,
  upsertTeachingChunksPg,
  type PgTeachingChunkRow,
} from "./pgvectorRag";
import { serverEnv } from "../_core/env.validated";
import type { TeachingMaterial } from "../../drizzle/schema";

const CHUNK_TARGET_CHARS = 1200;
const CHUNK_OVERLAP_CHARS = 200;
const MIN_CHUNK_CHARS = 200;
const NS_PREFIX = "teaching-";

function namespaceForUser(userId: number): string {
  return `${NS_PREFIX}${userId}`;
}

function vectorIdFor(userId: number, materialId: number, chunkIndex: number): string {
  return `teaching-${userId}-mat-${materialId}-c${chunkIndex}`;
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

/** 逐 chunk 產 embedding；Gemini API 不接受 batch，逐個 call 但並發 4 條控住流量。 */
async function embedChunks(
  chunks: string[]
): Promise<Array<{ values: number[]; chunk: string; idx: number }>> {
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
  return embeddings;
}

/** Pinecone 遺留寫入路徑（FEATURE_RAG_PINECONE 或 pgvector 故障時）。 */
async function upsertChunksPinecone(
  material: TeachingMaterial,
  embeddings: Array<{ values: number[]; chunk: string; idx: number }>
): Promise<void> {
  const host = await getIndexHost();
  const namespace = namespaceForUser(material.userId);

  // 一次 upsert（Pinecone 一次最多 1000 個 vector，這裡上限遠低於那個）
  const vectors = embeddings.map(e => ({
    id: vectorIdFor(material.userId, material.id, e.idx),
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
}

/** pgvector 寫入路徑：merge-duplicates upsert ＋ 清掉文本變短後的孤兒 chunk。 */
async function upsertChunksPgvector(
  material: TeachingMaterial,
  embeddings: Array<{ values: number[]; chunk: string; idx: number }>
): Promise<void> {
  const rows: PgTeachingChunkRow[] = embeddings.map(e => ({
    id: vectorIdFor(material.userId, material.id, e.idx),
    userId: material.userId,
    materialId: material.id,
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
    embedding: e.values,
  }));
  await upsertTeachingChunksPg(rows);
  // deterministic 切片 → 同 id 覆寫；文本變短時舊的高 index chunk 會變孤兒，
  // pgvector 端可以精準砍掉（Pinecone 版做不到，這是換後端的加分項）。
  await deleteTeachingChunksPg(material.userId, material.id, {
    fromChunkIndex: embeddings.length,
  });
}

/**
 * Upsert 一份資料庫素材的所有 chunks 到向量庫。
 * vectorId 格式：teaching-{userId}-mat-{materialId}-c{chunkIndex}
 * 後續呼叫會用同一組 id 覆寫，所以重新跑 ingestion 不會留垃圾向量。
 */
export async function upsertTeachingMaterialVectors(
  material: TeachingMaterial
): Promise<{ chunksUpserted: number; skipped?: string }> {
  const backend = resolveRagVectorBackend();
  if (backend === "none") {
    return { chunksUpserted: 0, skipped: "RAG vector backend unavailable" };
  }
  const text = material.textContent?.trim();
  if (!text) return { chunksUpserted: 0, skipped: "empty textContent" };

  const chunks = chunkTextForEmbedding(text);
  if (chunks.length === 0) return { chunksUpserted: 0, skipped: "no chunks" };

  try {
    const embeddings = await embedChunks(chunks);

    if (backend === "pgvector") {
      try {
        await upsertChunksPgvector(material, embeddings);
        return { chunksUpserted: embeddings.length };
      } catch (err) {
        // migration 未套用 / Supabase 暫時故障 → 回退 Pinecone（若有 key）
        if (!serverEnv.PINECONE_API_KEY) throw err;
        console.warn(
          `[teachingArchiveRag] pgvector upsert 失敗，回退 Pinecone material=${material.id}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    await upsertChunksPinecone(material, embeddings);
    return { chunksUpserted: embeddings.length };
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

/** Pinecone 遺留查詢路徑；embedding 由呼叫端算好傳入。 */
async function queryChunksPinecone(
  userId: number,
  embedding: number[],
  topK: number
): Promise<TeachingVectorHit[]> {
  const host = await getIndexHost();

  const resp = await fetch(`${host}/query`, {
    method: "POST",
    headers: getPineconeHeaders(),
    body: JSON.stringify({
      vector: embedding,
      topK,
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
}

/**
 * 對使用者的教材向量做語意搜尋。回傳依分數遞減的命中 chunks；
 * 同一個 materialId 可能命中多個 chunk，呼叫端要去重 / 合併。
 *
 * 跟 ragMemory.queryMemories 一樣失敗就靜默回 []，由 LIKE fallback 接手。
 */
export async function queryTeachingArchiveVectors(
  userId: number,
  query: string,
  topK = 20
): Promise<TeachingVectorHit[]> {
  const backend = resolveRagVectorBackend();
  if (backend === "none") return [];
  const trimmed = query.trim();
  if (!trimmed) return [];

  const boundedTopK = Math.max(1, Math.min(topK, 50));

  try {
    const embedding = await getEmbedding(trimmed);

    if (backend === "pgvector") {
      const hasPineconeFallback = Boolean(serverEnv.PINECONE_API_KEY);
      try {
        const rows = await queryTeachingChunksPg(userId, embedding, boundedTopK);
        if (rows.length > 0) {
          return rows.map(r => ({
            materialId: Number(r.material_id ?? 0),
            score: Number(r.score) || 0,
            chunkIndex: Number(r.chunk_index ?? 0),
            chunkText: String(r.chunk_text ?? ""),
            title: String(r.title ?? ""),
            lineage: String(r.lineage ?? ""),
            topic: String(r.topic ?? ""),
          }));
        }
        // pgvector 空、Pinecone key 存在 → read-through 讀遺留索引（過渡期）
        if (hasPineconeFallback) {
          return await queryChunksPinecone(userId, embedding, boundedTopK);
        }
        return [];
      } catch (err) {
        if (!hasPineconeFallback) throw err;
        console.warn(
          "[teachingArchiveRag] pgvector query 失敗，回退 Pinecone：",
          err instanceof Error ? err.message : err
        );
        return await queryChunksPinecone(userId, embedding, boundedTopK);
      }
    }

    return await queryChunksPinecone(userId, embedding, boundedTopK);
  } catch (err) {
    console.warn("[teachingArchiveRag] query failed:", err);
    return [];
  }
}

/**
 * 砍掉某個 material 的所有向量（material 被刪 / 重跑 ingestion 之前）。
 * pgvector / Pinecone 兩邊「有接線就都砍」（各自獨立 try），確保不論
 * 旗標怎麼切都不會留 stale 向量洩漏已刪素材的內容。
 */
export async function deleteTeachingVectorsByMaterial(
  userId: number,
  materialId: number
): Promise<void> {
  if (resolveRagVectorBackend() === "none") return;

  if (isPgvectorConfigured()) {
    try {
      await deleteTeachingChunksPg(userId, materialId);
    } catch (err) {
      console.warn(
        `[teachingArchiveRag] pgvector delete failed material=${materialId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

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
