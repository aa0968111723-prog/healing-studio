/**
 * ragMemory.ts — Pinecone RAG 向量記憶系統 (Phase 14)
 *
 * 實作白皮書第十四階段：
 * - 將用戶的生成歷史 & 偏好轉化為向量存入 Pinecone
 * - 每次生成前從 Pinecone 檢索最相關的 3 筆記憶
 * - 將記憶注入 System Prompt，讓 AI 記住用戶品味
 *
 * 架構：
 *   用戶輸入 → text-embedding → Pinecone upsert
 *   生成前   → text-embedding → Pinecone query → top-3 記憶 → System Prompt
 */

import { serverEnv } from "../_core/env.validated";

// ─── Pinecone 設定 ────────────────────────────────────────────────────────

const PINECONE_API_BASE = "https://api.pinecone.io";
const INDEX_NAME = serverEnv.PINECONE_INDEX_NAME || "ai-director-memories";
// ⚠️ 重要：dimension 必須與 Pinecone index 建立時的設定一致
// 使用 Gemini gemini-embedding-001（正式版），原生輸出 3072 維
// Pinecone index `ai-director-memories` 必須建立為 dimension=3072, metric=cosine
const EMBEDDING_DIM = 3072; // gemini-embedding-001 維度（Pinecone index: ai-director-memories）

function getPineconeHeaders() {
  const apiKey = serverEnv.PINECONE_API_KEY;
  if (!apiKey) throw new Error("PINECONE_API_KEY 未設定，RAG 記憶系統無法運作");
  return {
    "Api-Key": apiKey,
    "Content-Type": "application/json",
  };
}

// ─── Gemini Embedding（文字轉向量）────────────────────────────────────────

async function getEmbedding(text: string): Promise<number[]> {
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

// ─── Pinecone Index 管理 ──────────────────────────────────────────────────

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

// ─── 取得 Index Host URL ──────────────────────────────────────────────────

async function getIndexHost(): Promise<string> {
  const headers = getPineconeHeaders();
  const resp = await fetch(`${PINECONE_API_BASE}/indexes/${INDEX_NAME}`, {
    headers,
  });
  if (!resp.ok) throw new Error(`無法取得 Pinecone index 資訊: ${resp.status}`);
  const data = (await resp.json()) as { host: string };
  return `https://${data.host}`;
}

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

export async function upsertMemory(record: MemoryRecord): Promise<void> {
  try {
    const apiKey = serverEnv.PINECONE_API_KEY;
    if (!apiKey) return; // RAG 未啟用時靜默跳過

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
}

export async function queryMemories(
  userId: number,
  currentPrompt: string,
  topK = 3
): Promise<MemoryMatch[]> {
  try {
    const apiKey = serverEnv.PINECONE_API_KEY;
    if (!apiKey) return []; // RAG 未啟用

    const embedding = await getEmbedding(currentPrompt);
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
    }));
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
