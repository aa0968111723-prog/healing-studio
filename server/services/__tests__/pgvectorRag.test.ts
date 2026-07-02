/**
 * pgvectorRag.test.ts — AIDV-907 Supabase pgvector 儲存層契約測試
 *
 * 鎖定 PostgREST 請求形狀（URL / headers / body / on_conflict / RPC 參數），
 * 這些是跟 supabase/migrations/20260702_aidv907_pgvector_rag.sql 的表與
 * RPC 簽名對齊的「線上契約」，改了任何一邊都要同步改另一邊。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { envMock } = vi.hoisted(() => ({
  envMock: {
    SUPABASE_URL: "https://demo-project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
  } as { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string },
}));
vi.mock("../../_core/env.validated", () => ({ serverEnv: envMock }));

import {
  deleteTeachingChunksPg,
  isPgvectorConfigured,
  queryMemoryVectorsPg,
  queryTeachingChunksPg,
  toVectorLiteral,
  upsertMemoryVectorPg,
  upsertTeachingChunksPg,
} from "../pgvectorRag";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  envMock.SUPABASE_URL = "https://demo-project.supabase.co";
  envMock.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isPgvectorConfigured", () => {
  it("需要 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 同時存在", () => {
    expect(isPgvectorConfigured()).toBe(true);
    envMock.SUPABASE_URL = "";
    expect(isPgvectorConfigured()).toBe(false);
    envMock.SUPABASE_URL = "https://demo-project.supabase.co";
    envMock.SUPABASE_SERVICE_ROLE_KEY = "";
    expect(isPgvectorConfigured()).toBe(false);
  });
});

describe("toVectorLiteral", () => {
  it("輸出 pgvector 字面量格式", () => {
    expect(toVectorLiteral([0.1, -0.2, 3])).toBe("[0.1,-0.2,3]");
    expect(toVectorLiteral([])).toBe("[]");
  });
});

describe("upsertMemoryVectorPg", () => {
  it("POST 到 rag_memory_vectors，帶 on_conflict=id 與 merge-duplicates", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([], 201));

    await upsertMemoryVectorPg({
      id: "user-7-gen-42",
      userId: 7,
      generationId: 42,
      prompt: "溫暖的茶園日出",
      generationType: "image",
      vibeCardIds: "warm,sunrise",
      rating: 5,
      embedding: [0.5, 0.25],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://demo-project.supabase.co/rest/v1/rag_memory_vectors?on_conflict=id"
    );
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe("service-role-test-key");
    expect(headers.Authorization).toBe("Bearer service-role-test-key");
    expect(headers.Prefer).toContain("resolution=merge-duplicates");

    const body = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: "user-7-gen-42",
      user_id: 7,
      generation_id: 42,
      prompt: "溫暖的茶園日出",
      generation_type: "image",
      vibe_card_ids: "warm,sunrise",
      rating: 5,
      embedding: "[0.5,0.25]",
    });
  });

  it("Supabase 回非 2xx 時 throw（讓上層走降級路徑）", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: 'relation "rag_memory_vectors" does not exist' }, 404)
    );
    await expect(
      upsertMemoryVectorPg({
        id: "user-1-gen-1",
        userId: 1,
        generationId: 1,
        prompt: "p",
        generationType: "image",
        vibeCardIds: "",
        rating: 0,
        embedding: [1],
      })
    ).rejects.toThrow(/404/);
  });

  it("Supabase 未接線時 throw 而非發出請求", async () => {
    envMock.SUPABASE_SERVICE_ROLE_KEY = "";
    await expect(
      upsertMemoryVectorPg({
        id: "user-1-gen-1",
        userId: 1,
        generationId: 1,
        prompt: "p",
        generationType: "image",
        vibeCardIds: "",
        rating: 0,
        embedding: [1],
      })
    ).rejects.toThrow(/SUPABASE/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("queryMemoryVectorsPg", () => {
  it("呼叫 rpc/rag_match_memories 並回傳 rows", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: "user-7-gen-42",
          score: 0.91,
          prompt: "茶園",
          generation_type: "image",
          vibe_card_ids: "warm",
          rating: 5,
          ts: 1750000000000,
        },
      ])
    );

    const rows = await queryMemoryVectorsPg(7, [0.1, 0.2], 3);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://demo-project.supabase.co/rest/v1/rpc/rag_match_memories"
    );
    expect(JSON.parse(String(init.body))).toEqual({
      p_user_id: 7,
      p_embedding: "[0.1,0.2]",
      p_top_k: 3,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("user-7-gen-42");
    expect(rows[0].score).toBeCloseTo(0.91);
  });

  it("非陣列回應回空陣列（防禦）", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ unexpected: true }));
    const rows = await queryMemoryVectorsPg(7, [0.1], 3);
    expect(rows).toEqual([]);
  });
});

describe("teaching chunks", () => {
  it("upsertTeachingChunksPg 空陣列不發請求", async () => {
    await upsertTeachingChunksPg([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upsertTeachingChunksPg 送出 snake_case rows 到 rag_teaching_chunks", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([], 201));
    await upsertTeachingChunksPg([
      {
        id: "teaching-7-mat-3-c0",
        userId: 7,
        materialId: 3,
        teamId: 0,
        visibility: "private",
        mediaType: "pdf",
        title: "茶道講義",
        lineage: "line-a",
        topic: "tea",
        speaker: "師傅",
        sourceType: "upload",
        chunkIndex: 0,
        chunkText: "第一段內容",
        embedding: [0.3, 0.4],
      },
    ]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://demo-project.supabase.co/rest/v1/rag_teaching_chunks?on_conflict=id"
    );
    const body = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
    expect(body[0]).toMatchObject({
      id: "teaching-7-mat-3-c0",
      user_id: 7,
      material_id: 3,
      chunk_index: 0,
      chunk_text: "第一段內容",
      embedding: "[0.3,0.4]",
    });
  });

  it("queryTeachingChunksPg 呼叫 rpc/rag_match_teaching_chunks", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          material_id: 3,
          score: 0.8,
          chunk_index: 1,
          chunk_text: "chunk",
          title: "t",
          lineage: "",
          topic: "",
        },
      ])
    );
    const rows = await queryTeachingChunksPg(7, [0.1], 20);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://demo-project.supabase.co/rest/v1/rpc/rag_match_teaching_chunks"
    );
    expect(JSON.parse(String(init.body))).toEqual({
      p_user_id: 7,
      p_embedding: "[0.1]",
      p_top_k: 20,
    });
    expect(rows[0].material_id).toBe(3);
  });

  it("deleteTeachingChunksPg 用 eq filter DELETE；fromChunkIndex 加 gte", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await deleteTeachingChunksPg(7, 3);
    let [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(url).toContain("rag_teaching_chunks?");
    expect(url).toContain("user_id=eq.7");
    expect(url).toContain("material_id=eq.3");
    expect(url).not.toContain("chunk_index");

    await deleteTeachingChunksPg(7, 3, { fromChunkIndex: 5 });
    [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("chunk_index=gte.5");
  });
});
