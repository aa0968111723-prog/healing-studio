/**
 * ai-models-router.test.ts — tRPC router for the AI Models Hub
 *
 * 我們直接呼叫 router caller，不啟動完整 Express 伺服器。重點驗證：
 *   1. list 回傳 meta 中的 total / verifiedCount / staleCount 都是合理數字
 *   2. list 支援 modality / provider / tier 過濾
 *   3. getById 對不存在的 id 會丟 NOT_FOUND
 *   4. researchStats 至少回傳一個包含 scheduled / isRunning 的物件
 */

import { describe, expect, it, beforeEach } from "vitest";
import { aiModelsRouter } from "./routers/aiModels";
import { AI_MODELS_CATALOG } from "../shared/aiModelsCatalog";
import {
  __resetEnrichmentStore,
  __ingestPayloadForTest,
} from "./services/modelResearcher";

function caller() {
  return aiModelsRouter.createCaller({
    user: null,
    sessionId: null,
    isOrbTrace: false,
  } as any);
}

beforeEach(() => {
  __resetEnrichmentStore();
});

describe("aiModelsRouter / list", () => {
  it("returns every baseline model with meta", async () => {
    const result = await caller().list();
    expect(result.models).toHaveLength(AI_MODELS_CATALOG.length);
    expect(result.meta.total).toBe(AI_MODELS_CATALOG.length);
    // No enrichment yet → verifiedCount = 0, staleCount = 0 (all pending)
    expect(result.meta.verifiedCount).toBe(0);
    expect(result.meta.staleCount).toBe(0);
  });

  it("counts a freshly auto-checked model toward verifiedCount", async () => {
    __ingestPayloadForTest("gpt-4o", {
      factsStillValid: true,
      sources: [{ title: "OpenAI", url: "https://openai.com/" }],
    });
    const result = await caller().list();
    expect(result.meta.verifiedCount).toBe(1);
  });

  it("filters by modality", async () => {
    const result = await caller().list({ modality: "video" });
    expect(result.models.length).toBeGreaterThan(0);
    expect(result.models.every(m => m.modality === "video")).toBe(true);
    expect(result.meta.total).toBe(AI_MODELS_CATALOG.length);
    expect(result.meta.shown).toBe(result.models.length);
  });

  it("filters by provider", async () => {
    const result = await caller().list({ provider: "Anthropic" });
    expect(result.models.every(m => m.provider === "Anthropic")).toBe(true);
  });

  it("filters by tier", async () => {
    const result = await caller().list({ tier: "open-source" });
    expect(result.models.every(m => m.tier === "open-source")).toBe(true);
  });

  it("ignores 'all' filter values", async () => {
    const result = await caller().list({
      modality: "all",
      provider: "all",
      tier: "all",
    });
    expect(result.models).toHaveLength(AI_MODELS_CATALOG.length);
  });
});

describe("aiModelsRouter / getById", () => {
  it("returns a known model", async () => {
    const result = await caller().getById({ id: "claude-opus-4-7" });
    expect(result.model.name).toBe("Claude Opus 4.7");
  });

  it("throws NOT_FOUND for an unknown id", async () => {
    await expect(
      caller().getById({ id: "totally-fake-model" })
    ).rejects.toThrow(/找不到模型/);
  });
});

describe("aiModelsRouter / researchStats", () => {
  it("returns a status shape that the UI relies on", async () => {
    const result = await caller().researchStats();
    expect(result).toHaveProperty("scheduled");
    expect(result).toHaveProperty("isRunning");
    expect(result).toHaveProperty("totalModels");
    expect(result).toHaveProperty("stats");
    expect(result.totalModels).toBe(AI_MODELS_CATALOG.length);
  });
});
