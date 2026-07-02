/**
 * ragBackendSwitch.test.ts — AIDV-907 向量後端切換與降級矩陣
 *
 * 驗收核心承諾：
 *   1. Supabase pgvector 已接線時為預設後端（Pinecone 呼叫點不被觸發）
 *   2. FEATURE_RAG_PINECONE 旗標（預設 OFF）可強制切回 Pinecone
 *   3. pgvector 未接線 → 遺留 Pinecone 路徑維持既有行為（零回歸）
 *   4. pgvector 失敗（如 migration 未套用）→ 自動回退 Pinecone；
 *      pgvector 空結果且 Pinecone 可用 → read-through 舊資料（免搬遷）
 *   5. 全部不可用 → 靜默降級（回空 / 跳過），不影響主流程
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({
  envMock: {
    GEMINI_API_KEY: "gemini-test-key",
    SUPABASE_URL: "https://demo-project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
    PINECONE_API_KEY: "pinecone-test-key",
    PINECONE_ENVIRONMENT: "us-east-1",
    PINECONE_INDEX_NAME: "ai-director-memories",
  } as Record<string, string>,
}));
vi.mock("../../_core/env.validated", () => ({ serverEnv: envMock }));

import { featureFlags } from "../../_core/featureFlags";
import {
  queryMemories,
  resolveRagVectorBackend,
  upsertMemory,
} from "../ragMemory";
import {
  deleteTeachingVectorsByMaterial,
  queryTeachingArchiveVectors,
  upsertTeachingMaterialVectors,
} from "../teachingArchiveRag";
import type { TeachingMaterial } from "../../../drizzle/schema";

// ─── fetch 路由 stub ───────────────────────────────────────────────────────

const fetchMock = vi.fn();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface StubState {
  /** rpc/rag_match_memories 與 rpc/rag_match_teaching_chunks 的回應 */
  pgRpcRows: unknown[] | { errorStatus: number };
  /** PostgREST 表寫入（upsert / delete）回應狀態碼 */
  pgWriteStatus: number;
}

const state: StubState = { pgRpcRows: [], pgWriteStatus: 201 };

function installFetchRouter() {
  fetchMock.mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = String(input);

    // Gemini embedding（既有 provider，沿用）
    if (url.includes("generativelanguage.googleapis.com")) {
      return json({ embedding: { values: [0.1, 0.2, 0.3] } });
    }

    // Supabase PostgREST
    if (url.startsWith("https://demo-project.supabase.co/rest/v1/rpc/")) {
      if (!Array.isArray(state.pgRpcRows)) {
        return json({ message: "relation missing" }, state.pgRpcRows.errorStatus);
      }
      return json(state.pgRpcRows);
    }
    if (url.startsWith("https://demo-project.supabase.co/rest/v1/")) {
      if (state.pgWriteStatus >= 400) {
        return json({ message: "write failed" }, state.pgWriteStatus);
      }
      return new Response(null, { status: state.pgWriteStatus });
    }

    // Pinecone control plane
    if (url === "https://api.pinecone.io/indexes/ai-director-memories") {
      return json({ host: "index.pinecone.test" });
    }
    // Pinecone data plane
    if (url.startsWith("https://index.pinecone.test/query")) {
      return json({
        matches: [
          {
            id: "user-7-gen-1",
            score: 0.77,
            metadata: {
              prompt: "pinecone 舊記憶",
              generationType: "image",
              vibeCardIds: "warm",
              rating: 4,
              timestamp: 1749990000000,
              materialId: 3,
              chunkIndex: 0,
              chunkText: "pinecone chunk",
              title: "舊教材",
              lineage: "",
              topic: "",
            },
          },
        ],
      });
    }
    if (url.startsWith("https://index.pinecone.test/vectors/list")) {
      return json({ vectors: [{ id: "teaching-7-mat-3-c0" }] });
    }
    if (url.startsWith("https://index.pinecone.test/vectors/")) {
      return json({ upsertedCount: 1 });
    }

    throw new Error(`unexpected fetch: ${url} ${init?.method ?? "GET"}`);
  });
}

function calledUrls(): string[] {
  return fetchMock.mock.calls.map(c => String(c[0]));
}

function pineconeTouched(): boolean {
  return calledUrls().some(
    u => u.includes("api.pinecone.io") || u.includes("index.pinecone.test")
  );
}

beforeEach(() => {
  envMock.GEMINI_API_KEY = "gemini-test-key";
  envMock.SUPABASE_URL = "https://demo-project.supabase.co";
  envMock.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  envMock.PINECONE_API_KEY = "pinecone-test-key";
  state.pgRpcRows = [];
  state.pgWriteStatus = 201;
  fetchMock.mockReset();
  installFetchRouter();
  vi.stubGlobal("fetch", fetchMock);
  featureFlags.clearAllOverrides();
  featureFlags.setOverride("RAG_MEMORY", true);
});

afterEach(() => {
  featureFlags.clearAllOverrides();
  vi.unstubAllGlobals();
});

// ─── 1. 後端解析矩陣 ───────────────────────────────────────────────────────

describe("resolveRagVectorBackend", () => {
  it("RAG_MEMORY 關閉 → none", () => {
    featureFlags.setOverride("RAG_MEMORY", false);
    expect(resolveRagVectorBackend()).toBe("none");
  });

  it("pgvector 已接線且 RAG_PINECONE 預設 OFF → pgvector（即使有 Pinecone key）", () => {
    expect(resolveRagVectorBackend()).toBe("pgvector");
  });

  it("FEATURE_RAG_PINECONE 開啟且有 key → 強制 pinecone", () => {
    featureFlags.setOverride("RAG_PINECONE", true);
    expect(resolveRagVectorBackend()).toBe("pinecone");
  });

  it("RAG_PINECONE 開啟但無 Pinecone key → 仍用 pgvector（失敗安全）", () => {
    featureFlags.setOverride("RAG_PINECONE", true);
    envMock.PINECONE_API_KEY = "";
    expect(resolveRagVectorBackend()).toBe("pgvector");
  });

  it("pgvector 未接線、有 Pinecone key → 遺留 pinecone（零回歸）", () => {
    envMock.SUPABASE_URL = "";
    expect(resolveRagVectorBackend()).toBe("pinecone");
  });

  it("兩個後端都不可用 → none", () => {
    envMock.SUPABASE_URL = "";
    envMock.PINECONE_API_KEY = "";
    expect(resolveRagVectorBackend()).toBe("none");
  });
});

// ─── 2. 記憶查詢 dispatch ──────────────────────────────────────────────────

describe("queryMemories — backend dispatch", () => {
  it("pgvector 命中 → 回 pgvector 結果且完全不碰 Pinecone", async () => {
    state.pgRpcRows = [
      {
        id: "user-7-gen-42",
        score: 0.9,
        prompt: "茶園日出",
        generation_type: "image",
        vibe_card_ids: "warm",
        rating: 5,
        ts: 1750000000000,
      },
    ];

    const matches = await queryMemories(7, "茶園", 3);

    expect(matches).toHaveLength(1);
    expect(matches[0].backend).toBe("pgvector");
    expect(matches[0].prompt).toBe("茶園日出");
    expect(matches[0].timestamp).toBe(1750000000000);
    expect(pineconeTouched()).toBe(false);
  });

  it("pgvector 失敗（migration 未套用）→ 回退 Pinecone", async () => {
    state.pgRpcRows = { errorStatus: 404 };

    const matches = await queryMemories(7, "茶園", 3);

    expect(matches).toHaveLength(1);
    expect(matches[0].backend).toBe("pinecone");
    expect(matches[0].prompt).toBe("pinecone 舊記憶");
  });

  it("pgvector 空結果且 Pinecone 可用 → read-through 舊資料", async () => {
    state.pgRpcRows = [];

    const matches = await queryMemories(7, "茶園", 3);

    expect(matches).toHaveLength(1);
    expect(matches[0].backend).toBe("pinecone");
  });

  it("pgvector 空結果且無 Pinecone key → 回空（不丟錯）", async () => {
    envMock.PINECONE_API_KEY = "";
    state.pgRpcRows = [];

    const matches = await queryMemories(7, "茶園", 3);

    expect(matches).toEqual([]);
    expect(pineconeTouched()).toBe(false);
  });

  it("pgvector 失敗且無 Pinecone key → 靜默回空", async () => {
    envMock.PINECONE_API_KEY = "";
    state.pgRpcRows = { errorStatus: 500 };

    const matches = await queryMemories(7, "茶園", 3);
    expect(matches).toEqual([]);
  });

  it("FEATURE_RAG_PINECONE 強制 → 直接查 Pinecone，不碰 Supabase", async () => {
    featureFlags.setOverride("RAG_PINECONE", true);

    const matches = await queryMemories(7, "茶園", 3);

    expect(matches[0].backend).toBe("pinecone");
    expect(calledUrls().some(u => u.includes("supabase.co"))).toBe(false);
  });

  it("RAG_MEMORY 關閉 → 完全不發任何請求", async () => {
    featureFlags.setOverride("RAG_MEMORY", false);
    const matches = await queryMemories(7, "茶園", 3);
    expect(matches).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── 3. 記憶寫入 dispatch ──────────────────────────────────────────────────

describe("upsertMemory — backend dispatch", () => {
  const record = {
    userId: 7,
    generationId: 42,
    prompt: "茶園日出",
    generationType: "image",
    vibeCardIds: ["warm"],
    rating: 5,
  };

  it("pgvector 寫入成功 → 不碰 Pinecone", async () => {
    await upsertMemory(record);

    expect(
      calledUrls().some(u => u.includes("/rest/v1/rag_memory_vectors"))
    ).toBe(true);
    expect(pineconeTouched()).toBe(false);
  });

  it("pgvector 寫入失敗 → 回退寫 Pinecone（記憶不遺失）", async () => {
    state.pgWriteStatus = 500;

    await upsertMemory(record);

    expect(
      calledUrls().some(u => u.startsWith("https://index.pinecone.test/vectors/upsert"))
    ).toBe(true);
  });

  it("pgvector 寫入失敗且無 Pinecone key → 靜默吞錯不外拋", async () => {
    envMock.PINECONE_API_KEY = "";
    state.pgWriteStatus = 500;

    await expect(upsertMemory(record)).resolves.toBeUndefined();
  });
});

// ─── 4. 教材向量 dispatch ──────────────────────────────────────────────────

const material = {
  id: 3,
  userId: 7,
  teamId: null,
  visibility: "private",
  mediaType: "pdf",
  title: "茶道講義",
  lineage: "line-a",
  topic: "tea",
  speaker: "師傅",
  sourceType: "upload",
  textContent: "第一段內容：茶葉的萎凋與發酵原理。",
} as unknown as TeachingMaterial;

describe("teachingArchive — backend dispatch", () => {
  it("upsertTeachingMaterialVectors 走 pgvector：upsert ＋ 孤兒 chunk 清理", async () => {
    const result = await upsertTeachingMaterialVectors(material);

    expect(result.chunksUpserted).toBe(1);
    const urls = calledUrls();
    expect(
      urls.some(u => u.includes("/rest/v1/rag_teaching_chunks?on_conflict=id"))
    ).toBe(true);
    // 文本變短的孤兒清理：chunk_index >= chunks.length
    expect(urls.some(u => u.includes("chunk_index=gte.1"))).toBe(true);
    expect(pineconeTouched()).toBe(false);
  });

  it("pgvector upsert 失敗 → 回退 Pinecone upsert", async () => {
    state.pgWriteStatus = 500;

    const result = await upsertTeachingMaterialVectors(material);

    expect(result.chunksUpserted).toBe(1);
    expect(
      calledUrls().some(u => u.startsWith("https://index.pinecone.test/vectors/upsert"))
    ).toBe(true);
  });

  it("後端全不可用 → skipped，不發網路請求", async () => {
    envMock.SUPABASE_URL = "";
    envMock.PINECONE_API_KEY = "";

    const result = await upsertTeachingMaterialVectors(material);

    expect(result.chunksUpserted).toBe(0);
    expect(result.skipped).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("queryTeachingArchiveVectors 走 pgvector 命中", async () => {
    state.pgRpcRows = [
      {
        material_id: 3,
        score: 0.85,
        chunk_index: 0,
        chunk_text: "萎凋與發酵",
        title: "茶道講義",
        lineage: "line-a",
        topic: "tea",
      },
    ];

    const hits = await queryTeachingArchiveVectors(7, "發酵", 5);

    expect(hits).toHaveLength(1);
    expect(hits[0].materialId).toBe(3);
    expect(hits[0].chunkText).toBe("萎凋與發酵");
    expect(pineconeTouched()).toBe(false);
  });

  it("queryTeachingArchiveVectors pgvector 失敗 → 回退 Pinecone", async () => {
    state.pgRpcRows = { errorStatus: 404 };

    const hits = await queryTeachingArchiveVectors(7, "發酵", 5);

    expect(hits).toHaveLength(1);
    expect(hits[0].chunkText).toBe("pinecone chunk");
  });

  it("deleteTeachingVectorsByMaterial 兩邊接線就兩邊都砍", async () => {
    await deleteTeachingVectorsByMaterial(7, 3);

    const urls = calledUrls();
    expect(
      urls.some(
        u =>
          u.includes("/rest/v1/rag_teaching_chunks?") &&
          u.includes("material_id=eq.3")
      )
    ).toBe(true);
    expect(
      urls.some(u => u.startsWith("https://index.pinecone.test/vectors/list"))
    ).toBe(true);
    expect(
      urls.some(u => u.startsWith("https://index.pinecone.test/vectors/delete"))
    ).toBe(true);
  });
});
