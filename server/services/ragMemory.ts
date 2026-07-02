/**
 * ragMemory.ts — RAG 向量記憶系統 (Phase 14 / AIDV-907)
 *
 * 實作白皮書第十四階段：
 * - 將用戶的生成歷史 & 偏好轉化為向量存入向量庫
 * - 每次生成前檢索最相關的 3 筆記憶
 * - 將記憶注入 System Prompt，讓 AI 記住用戶品味
 *
 * 後端選型（AIDV-907）：Supabase pgvector 取代 Pinecone。
 *
 *   backend 解析順序（resolveRagVectorBackend）：
 *     1. RAG_MEMORY 旗標關閉 → none（完全跳過）
 *     2. FEATURE_RAG_PINECONE=true 且有 PINECONE_API_KEY → pinecone（強制遺留）
 *     3. Supabase 已接線（SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY）→ pgvector
 *     4. 只有 PINECONE_API_KEY → pinecone（遺留降級，維持既有行為）
 *     5. 都沒有 → none
 *
 *   失敗安全（過渡期，不需資料搬遷）：
 *     - pgvector 查詢丟錯（如 migration 尚未套用、42P01）→ 回退 Pinecone（若有 key）
 *     - pgvector 查詢成功但為空、且 Pinecone key 存在 → read-through 讀舊資料
 *     - pgvector 寫入丟錯 → 回退寫 Pinecone（若有 key），避免記憶遺失
 *     - 全部失敗 → 靜默回空 / 跳過，絕不影響主生成流程
 *
 * 架構：
 *   用戶輸入 → text-embedding（既有 Gemini provider）→ pgvector upsert
 *   生成前   → text-embedding → pgvector RPC top-K → System Prompt
 */

import { serverEnv } from "../_core/env.validated";
import { featureFlags } from "../_core/featureFlags";
import { OrbMemorySchema, type OrbMemory } from "../../shared/orb-memory";
import {
  isPgvectorConfigured,
  queryMemoryVectorsPg,
  upsertMemoryVectorPg,
} from "./pgvectorRag";

// ─── 向量後端解析（AIDV-907）──────────────────────────────────────────────

export type RagVectorBackend = "pgvector" | "pinecone" | "none";

/**
 * 解析目前應使用的 RAG 向量後端。
 * Pinecone 呼叫點由 FEATURE_RAG_PINECONE 旗標切換，預設 OFF；
 * pgvector 未接線時保留 Pinecone 遺留路徑以不破壞既有部署。
 */
export function resolveRagVectorBackend(): RagVectorBackend {
  if (!featureFlags.isEnabled("RAG_MEMORY")) return "none";
  const hasPinecone = Boolean(serverEnv.PINECONE_API_KEY);
  if (featureFlags.isEnabled("RAG_PINECONE") && hasPinecone) return "pinecone";
  if (isPgvectorConfigured()) return "pgvector";
  if (hasPinecone) return "pinecone";
  return "none";
}

// ─── Pinecone 設定（遺留後端，FEATURE_RAG_PINECONE 預設 OFF）─────────────

const PINECONE_API_BASE = "https://api.pinecone.io";
const INDEX_NAME = serverEnv.PINECONE_INDEX_NAME || "ai-director-memories";
// ⚠️ 重要：dimension 必須與向量庫建立時的設定一致
// 使用 Gemini gemini-embedding-001（正式版），原生輸出 3072 維
// - pgvector：supabase/migrations/20260702_aidv907_pgvector_rag.sql 的 vector(3072)
// - Pinecone：index `ai-director-memories` 必須建立為 dimension=3072, metric=cosine
export const EMBEDDING_DIM = 3072; // gemini-embedding-001 維度

export function getPineconeHeaders() {
  const apiKey = serverEnv.PINECONE_API_KEY;
  if (!apiKey) throw new Error("PINECONE_API_KEY 未設定，Pinecone 遺留後端無法運作");
  return {
    "Api-Key": apiKey,
    "Content-Type": "application/json",
  };
}

// ─── Gemini Embedding（文字轉向量）────────────────────────────────────────

export async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = serverEnv.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 未設定，無法生成向量");

  // 使用 Gemini gemini-embedding-001（正式版，輸出 3072 維）
  // text-embedding-004 已廢棄（返回 404），請勿使用
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text: text.slice(0, 2000) }] }, // 限制長度
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API 失敗: ${response.status} — ${err}`);
  }

  const data = (await response.json()) as { embedding: { values: number[] } };
  const raw = data.embedding.values; // 3072 維（gemini-embedding-001 原生輸出）

  // gemini-embedding-001 原生輸出恰好 3072 維，理論上不需要補零或截斷
  // 保留防禦性程式碼以應對邊緣情況
  if (EMBEDDING_DIM > raw.length) {
    return [...raw, ...new Array(EMBEDDING_DIM - raw.length).fill(0)];
  }
  return raw.slice(0, EMBEDDING_DIM);
}

// ─── Pinecone Index 管理（遺留）───────────────────────────────────────────

export async function ensurePineconeIndex(): Promise<void> {
  const headers = getPineconeHeaders();

  // 檢查 index 是否存在
  const listResp = await fetch(`${PINECONE_API_BASE}/indexes`, { headers });
  if (!listResp.ok) return;

  const { indexes } = (await listResp.json()) as {
    indexes: Array<{ name: string }>;
  };
  const exists = indexes.some(idx => idx.name === INDEX_NAME);

  if (!exists) {
    // 建立 serverless index（免費層）
    await fetch(`${PINECONE_API_BASE}/indexes`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: INDEX_NAME,
        dimension: EMBEDDING_DIM,
        metric: "cosine",
        spec: {
          serverless: {
            cloud: "aws",
            region: serverEnv.PINECONE_ENVIRONMENT || "us-east-1",
          },
        },
      }),
    });
    console.info(`[RAG] Pinecone index "${INDEX_NAME}" 已建立`);
  }
}

// ─── 取得 Index Host URL（遺留）───────────────────────────────────────────

async function getIndexHost(): Promise<string> {
  const headers = getPineconeHeaders();
  const resp = await fetch(`${PINECONE_API_BASE}/indexes/${INDEX_NAME}`, {
    headers,
  });
  if (!resp.ok) throw new Error(`無法取得 Pinecone index 資訊: ${resp.status}`);
  const data = (await resp.json()) as { host: string };
  return `https://${data.host}`;
}

/** Re-export 給 teachingArchiveRag 等 module 共用 host URL，省一次 round-trip。 */
export { getIndexHost };

// ─── 記憶存入（Upsert）────────────────────────────────────────────────────

export interface MemoryRecord {
  userId: number;
  generationId: number;
  prompt: string;
  generationType: string; // image / video / audio / voice
  resultSummary?: string; // 生成結果摘要
  vibeCardIds?: string[];
  rating?: number;
}

/** Pinecone 遺留寫入路徑；embedding 由呼叫端算好傳入，fallback 時不用重算。 */
async function upsertMemoryPinecone(
  record: MemoryRecord,
  embedding: number[]
): Promise<void> {
  const host = await getIndexHost();
  const vectorId = `user-${record.userId}-gen-${record.generationId}`;

  await fetch(`${host}/vectors/upsert`, {
    method: "POST",
    headers: getPineconeHeaders(),
    body: JSON.stringify({
      vectors: [
        {
          id: vectorId,
          values: embedding,
          metadata: {
            userId: record.userId,
            generationId: record.generationId,
            prompt: record.prompt.slice(0, 500),
            generationType: record.generationType,
            vibeCardIds: record.vibeCardIds?.join(",") || "",
            rating: record.rating ?? 0,
            timestamp: Date.now(),
          },
        },
      ],
      namespace: `user-${record.userId}`,
    }),
  });
}

export async function upsertMemory(record: MemoryRecord): Promise<void> {
  try {
    // FEATURE_RAG_MEMORY（別名 ENABLE_RAG_MEMORY）關閉、或無任何後端可用時
    // 直接跳過向量寫入。
    const backend = resolveRagVectorBackend();
    if (backend === "none") return;

    // 組合要向量化的文字（包含 prompt + 情境）
    const textToEmbed = [
      record.prompt,
      record.generationType ? `模態：${record.generationType}` : "",
      record.vibeCardIds?.length
        ? `風格：${record.vibeCardIds.join(", ")}`
        : "",
      record.resultSummary ? `結果：${record.resultSummary}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const embedding = await getEmbedding(textToEmbed);

    if (backend === "pgvector") {
      try {
        await upsertMemoryVectorPg({
          id: `user-${record.userId}-gen-${record.generationId}`,
          userId: record.userId,
          generationId: record.generationId,
          prompt: record.prompt.slice(0, 500),
          generationType: record.generationType,
          vibeCardIds: record.vibeCardIds?.join(",") || "",
          rating: record.rating ?? 0,
          embedding,
        });
        return;
      } catch (err) {
        // migration 未套用 / Supabase 暫時故障 → 回退寫 Pinecone（若有 key），
        // 避免過渡期記憶遺失。
        if (!serverEnv.PINECONE_API_KEY) throw err;
        console.warn(
          "[RAG] pgvector upsert 失敗，回退 Pinecone：",
          err instanceof Error ? err.message : err
        );
      }
    }

    await upsertMemoryPinecone(record, embedding);
  } catch (err) {
    // RAG 記憶失敗不影響主生成流程
    console.warn("[RAG] upsertMemory 失敗（不影響生成）:", err);
  }
}

// ─── 記憶檢索（Query）─────────────────────────────────────────────────────

export interface MemoryMatch {
  id: string;
  score: number;
  prompt: string;
  generationType: string;
  vibeCardIds: string;
  rating: number;
  timestamp: number;
  /** 命中來源後端（AIDV-907 加性欄位；舊呼叫端可忽略） */
  backend?: Exclude<RagVectorBackend, "none">;
}

/** Pinecone 遺留查詢路徑；embedding 由呼叫端算好傳入。 */
async function queryMemoriesPinecone(
  userId: number,
  embedding: number[],
  topK: number
): Promise<MemoryMatch[]> {
  const host = await getIndexHost();

  const resp = await fetch(`${host}/query`, {
    method: "POST",
    headers: getPineconeHeaders(),
    body: JSON.stringify({
      vector: embedding,
      topK,
      includeMetadata: true,
      namespace: `user-${userId}`,
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
    id: m.id,
    score: m.score,
    prompt: String(m.metadata.prompt || ""),
    generationType: String(m.metadata.generationType || ""),
    vibeCardIds: String(m.metadata.vibeCardIds || ""),
    rating: Number(m.metadata.rating || 0),
    timestamp: Number(m.metadata.timestamp || 0),
    backend: "pinecone" as const,
  }));
}

export async function queryMemories(
  userId: number,
  currentPrompt: string,
  topK = 3
): Promise<MemoryMatch[]> {
  try {
    // FEATURE_RAG_MEMORY（別名 ENABLE_RAG_MEMORY）關閉時靜默回空，
    // 上游 buildMemoryContext / queryRagMemory 會自動跳過記憶注入。
    const backend = resolveRagVectorBackend();
    if (backend === "none") return [];

    const embedding = await getEmbedding(currentPrompt);

    if (backend === "pgvector") {
      const hasPineconeFallback = Boolean(serverEnv.PINECONE_API_KEY);
      try {
        const rows = await queryMemoryVectorsPg(userId, embedding, topK);
        if (rows.length > 0) {
          return rows.map(r => ({
            id: r.id,
            score: Number(r.score) || 0,
            prompt: String(r.prompt || ""),
            generationType: String(r.generation_type || ""),
            vibeCardIds: String(r.vibe_card_ids || ""),
            rating: Number(r.rating || 0),
            timestamp: Number(r.ts || 0),
            backend: "pgvector" as const,
          }));
        }
        // pgvector 為空、Pinecone key 存在 → read-through 讀遺留資料，
        // 讓切換 pgvector 後舊記憶不會瞬間消失（免資料搬遷）。
        if (hasPineconeFallback) {
          return await queryMemoriesPinecone(userId, embedding, topK);
        }
        return [];
      } catch (err) {
        // migration 未套用 / Supabase 暫時故障 → 回退 Pinecone（若有 key）
        if (!hasPineconeFallback) return [];
        console.warn(
          "[RAG] pgvector query 失敗，回退 Pinecone：",
          err instanceof Error ? err.message : err
        );
        return await queryMemoriesPinecone(userId, embedding, topK);
      }
    }

    return await queryMemoriesPinecone(userId, embedding, topK);
  } catch {
    return []; // 檢索失敗靜默降級
  }
}

// ─── 組裝記憶注入的 System Prompt 片段 ────────────────────────────────────

export async function buildMemoryContext(
  userId: number,
  currentPrompt: string
): Promise<string> {
  const memories = await queryMemories(userId, currentPrompt, 3);
  if (!memories.length) return "";

  const lines = memories.map((m, i) => {
    const stars = m.rating > 0 ? ` ⭐${m.rating}` : "";
    const vibe = m.vibeCardIds ? ` [${m.vibeCardIds}]` : "";
    return `${i + 1}. [${m.generationType}${vibe}${stars}] ${m.prompt}`;
  });

  return `\n\n## 用戶歷史創作偏好（RAG 記憶）\n以下是該用戶過去的創作紀錄，請參考其風格偏好：\n${lines.join("\n")}\n`;
}

// ─── OrbMemory 適配層（給 orbMemory.searchOrbMemoriesWithRag 使用）──────────

export interface QueryRagMemoryArgs {
  query: string;
  userId?: number;
  limit?: number;
}

/**
 * Vector-search adapter that returns vector-store matches shaped as
 * OrbMemory[], so the orb planner can transparently merge keyword and RAG
 * hits. Backed by Supabase pgvector（預設）或遺留 Pinecone（AIDV-907）。
 *
 * Returns [] when RAG is unavailable, when userId is missing (vectors are
 * scoped per user), or when the vector store returns no matches.
 */
export async function queryRagMemory(args: QueryRagMemoryArgs): Promise<OrbMemory[]> {
  const query = args.query?.trim();
  if (!query) return [];
  if (!args.userId) return [];

  const topK = Math.max(1, Math.min(args.limit ?? 10, 50));
  const matches = await queryMemories(args.userId, query, topK);
  if (!matches.length) return [];

  const out: OrbMemory[] = [];
  for (const m of matches) {
    const summary = (m.prompt || "RAG memory match").slice(0, 600);
    const tags = [m.generationType, ...(m.vibeCardIds ? m.vibeCardIds.split(",").filter(Boolean) : [])]
      .filter((t): t is string => Boolean(t))
      .slice(0, 20)
      .map(t => t.slice(0, 64));
    const confidence = Number.isFinite(m.score) ? Math.max(0, Math.min(1, m.score)) : 0;
    const createdAt = m.timestamp && Number.isFinite(m.timestamp) ? m.timestamp : Date.now();

    const parsed = OrbMemorySchema.safeParse({
      memoryId: m.id,
      userId: args.userId,
      traceId: m.id,
      type: "prompt_pattern",
      summary,
      source: m.backend === "pinecone" ? "rag-pinecone" : "rag-pgvector",
      confidence,
      tags,
      createdAt,
      metadata: {
        score: m.score,
        generationType: m.generationType,
        vibeCardIds: m.vibeCardIds,
        rating: m.rating,
      },
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
