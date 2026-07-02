/**
 * pgvectorRag.ts — Supabase pgvector 向量儲存層（AIDV-907）
 *
 * 取代 Pinecone 的 RAG 向量後端：沿用既有 Supabase 接線
 * （serverEnv.SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY，PostgREST REST API，
 * 與 handoffTraceRoute.ts 同一模式），對
 * supabase/migrations/20260702_aidv907_pgvector_rag.sql 建立的兩張表讀寫：
 *
 *   rag_memory_vectors   — 用戶生成記憶（原 Pinecone namespace user-{userId}）
 *   rag_teaching_chunks  — 教材切片（原 Pinecone namespace teaching-{userId}）
 *
 * 相似度查詢走 RPC（rag_match_memories / rag_match_teaching_chunks），
 * upsert / delete 走 PostgREST 表端點。embedding 以 pgvector 字面量字串
 * （"[0.1,0.2,...]"）傳輸，避免 JSON 陣列型別推斷差異。
 *
 * 失敗策略：本層丟出 Error，由呼叫端（ragMemory.ts / teachingArchiveRag.ts）
 * 決定降級路徑（回退 Pinecone 或靜默回空）。本層自己不吞錯，才能讓
 * migration 未套用（42P01 relation missing）時上層正確 fallback。
 */

import { serverEnv } from "../_core/env.validated";

const REQUEST_TIMEOUT_MS = 15_000;

// ─── 接線判斷 ────────────────────────────────────────────────────────────

/** Supabase pgvector 後端是否已接線（沿用既有 env，不新增金鑰）。 */
export function isPgvectorConfigured(): boolean {
  return Boolean(serverEnv.SUPABASE_URL && serverEnv.SUPABASE_SERVICE_ROLE_KEY);
}

function restUrl(path: string): string {
  const base = serverEnv.SUPABASE_URL.replace(/\/+$/, "");
  return `${base}/rest/v1/${path}`;
}

function pgvectorHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = serverEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!serverEnv.SUPABASE_URL || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 未設定，pgvector RAG 後端無法運作"
    );
  }
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/** number[] → pgvector 字面量（"[0.1,0.2,...]"）。 */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

async function pgvectorFetch(
  url: string,
  init: RequestInit & { headers: Record<string, string> }
): Promise<Response> {
  const resp = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(
      `[pgvectorRag] Supabase 回應 ${resp.status}: ${body.slice(0, 300)}`
    );
  }
  return resp;
}

// ─── 用戶記憶向量（rag_memory_vectors）──────────────────────────────────

export interface PgMemoryVectorRow {
  /** Pinecone 相容 id：user-{userId}-gen-{generationId} */
  id: string;
  userId: number;
  generationId: number | null;
  prompt: string;
  generationType: string;
  vibeCardIds: string;
  rating: number;
  embedding: number[];
}

export async function upsertMemoryVectorPg(row: PgMemoryVectorRow): Promise<void> {
  await pgvectorFetch(restUrl("rag_memory_vectors?on_conflict=id"), {
    method: "POST",
    headers: pgvectorHeaders({
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify([
      {
        id: row.id,
        user_id: row.userId,
        generation_id: row.generationId,
        prompt: row.prompt,
        generation_type: row.generationType,
        vibe_card_ids: row.vibeCardIds,
        rating: row.rating,
        embedding: toVectorLiteral(row.embedding),
        updated_at: new Date().toISOString(),
      },
    ]),
  });
}

export interface PgMemoryMatchRow {
  id: string;
  score: number;
  prompt: string;
  generation_type: string;
  vibe_card_ids: string;
  rating: number;
  /** epoch ms */
  ts: number;
}

export async function queryMemoryVectorsPg(
  userId: number,
  embedding: number[],
  topK: number
): Promise<PgMemoryMatchRow[]> {
  const resp = await pgvectorFetch(restUrl("rpc/rag_match_memories"), {
    method: "POST",
    headers: pgvectorHeaders(),
    body: JSON.stringify({
      p_user_id: userId,
      p_embedding: toVectorLiteral(embedding),
      p_top_k: topK,
    }),
  });
  const rows = (await resp.json()) as PgMemoryMatchRow[];
  return Array.isArray(rows) ? rows : [];
}

// ─── 教材 chunk 向量（rag_teaching_chunks）──────────────────────────────

export interface PgTeachingChunkRow {
  /** Pinecone 相容 id：teaching-{userId}-mat-{materialId}-c{chunkIndex} */
  id: string;
  userId: number;
  materialId: number;
  teamId: number;
  visibility: string;
  mediaType: string;
  title: string;
  lineage: string;
  topic: string;
  speaker: string;
  sourceType: string;
  chunkIndex: number;
  chunkText: string;
  embedding: number[];
}

export async function upsertTeachingChunksPg(
  rows: PgTeachingChunkRow[]
): Promise<void> {
  if (rows.length === 0) return;
  await pgvectorFetch(restUrl("rag_teaching_chunks?on_conflict=id"), {
    method: "POST",
    headers: pgvectorHeaders({
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify(
      rows.map(r => ({
        id: r.id,
        user_id: r.userId,
        material_id: r.materialId,
        team_id: r.teamId,
        visibility: r.visibility,
        media_type: r.mediaType,
        title: r.title,
        lineage: r.lineage,
        topic: r.topic,
        speaker: r.speaker,
        source_type: r.sourceType,
        chunk_index: r.chunkIndex,
        chunk_text: r.chunkText,
        embedding: toVectorLiteral(r.embedding),
        updated_at: new Date().toISOString(),
      }))
    ),
  });
}

export interface PgTeachingMatchRow {
  material_id: number;
  score: number;
  chunk_index: number;
  chunk_text: string;
  title: string;
  lineage: string;
  topic: string;
}

export async function queryTeachingChunksPg(
  userId: number,
  embedding: number[],
  topK: number
): Promise<PgTeachingMatchRow[]> {
  const resp = await pgvectorFetch(restUrl("rpc/rag_match_teaching_chunks"), {
    method: "POST",
    headers: pgvectorHeaders(),
    body: JSON.stringify({
      p_user_id: userId,
      p_embedding: toVectorLiteral(embedding),
      p_top_k: topK,
    }),
  });
  const rows = (await resp.json()) as PgTeachingMatchRow[];
  return Array.isArray(rows) ? rows : [];
}

/**
 * 刪除某教材的 chunk 向量。
 * fromChunkIndex 給「re-ingest 後文本變短」的孤兒清理用：只刪 >= 該 index 的舊 chunk。
 */
export async function deleteTeachingChunksPg(
  userId: number,
  materialId: number,
  opts?: { fromChunkIndex?: number }
): Promise<void> {
  const params = new URLSearchParams({
    user_id: `eq.${userId}`,
    material_id: `eq.${materialId}`,
  });
  if (opts?.fromChunkIndex !== undefined) {
    params.set("chunk_index", `gte.${opts.fromChunkIndex}`);
  }
  await pgvectorFetch(restUrl(`rag_teaching_chunks?${params.toString()}`), {
    method: "DELETE",
    headers: pgvectorHeaders({ Prefer: "return=minimal" }),
  });
}
