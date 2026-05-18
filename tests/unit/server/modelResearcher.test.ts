/**
 * Unit tests for modelResearcher — auto-research / fact-check service.
 *
 * 涵蓋之前會靜默失敗導致前端「64 個模型全部驗證失敗」的場景：
 *   - 兩個 API key 都沒設定時，bulk run 必須一次回報「都未設定」，
 *     而不是對 64 個模型各寫一筆 "All research providers failed"。
 *   - 單一模型的 researchAndFactCheckModel 在 key 缺失時，reason 必須點明
 *     是哪個 key 缺失（不是含糊的「All research providers failed」）。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  researchAndFactCheckAllModels,
  researchAndFactCheckModel,
  discoverNewAIReleases,
  getDiscoveries,
  __resetEnrichmentStore,
  __seedDiscovery,
} from "../../../server/services/modelResearcher";

const ORIGINAL_PERPLEXITY = process.env.PERPLEXITY_API_KEY;
const ORIGINAL_OPENROUTER = process.env.OPENROUTER_API_KEY;

beforeEach(() => {
  __resetEnrichmentStore();
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
});

afterEach(() => {
  if (ORIGINAL_PERPLEXITY === undefined) delete process.env.PERPLEXITY_API_KEY;
  else process.env.PERPLEXITY_API_KEY = ORIGINAL_PERPLEXITY;
  if (ORIGINAL_OPENROUTER === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = ORIGINAL_OPENROUTER;
});

describe("researchAndFactCheckAllModels — provider preflight", () => {
  it("aborts the whole bulk run with a single explanatory error when neither API key is set", async () => {
    const result = await researchAndFactCheckAllModels({
      concurrency: 2,
      userId: null,
    });

    expect(result.modelsTried).toBe(0);
    expect(result.modelsSucceeded).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ modelId: "*" });
    expect(result.errors[0].reason).toMatch(/PERPLEXITY_API_KEY/);
    expect(result.errors[0].reason).toMatch(/OPENROUTER_API_KEY/);
  });
});

describe("researchAndFactCheckModel — provider failure surfacing", () => {
  it("returns an actionable reason naming the missing keys (not the generic 'All research providers failed')", async () => {
    const result = await researchAndFactCheckModel(
      "claude-opus-4-7", // any real id from the catalog
      { force: true, userId: null }
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).not.toBe("All research providers failed");
    expect(result.reason).toMatch(/PERPLEXITY_API_KEY/);
    expect(result.reason).toMatch(/OPENROUTER_API_KEY/);
  });

  it("respects the 7-day failure backoff — does not retry a recently-failed model", async () => {
    // First call: fails because no keys
    const first = await researchAndFactCheckModel("gpt-4o", {
      userId: null,
    });
    expect(first.ok).toBe(false);

    // Second call (no force): should be skipped due to backoff
    const second = await researchAndFactCheckModel("gpt-4o", {
      userId: null,
    });
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/backoff/);
  });
});

describe("discoverNewAIReleases", () => {
  it("returns a clear error when neither provider key is set", async () => {
    const result = await discoverNewAIReleases({ userId: null, days: 7 });
    expect(result.found).toBe(0);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/PERPLEXITY_API_KEY/);
    expect(result.error).toMatch(/OPENROUTER_API_KEY/);
  });
});

describe("getDiscoveries", () => {
  it("returns seeded discoveries sorted by discoveredAt desc", () => {
    __seedDiscovery({
      id: "disc_a",
      kind: "new-model",
      title: "Test Model A",
      summary: "synthetic",
      url: "https://example.com/a",
      date: "2026-05-01",
      discoveredAt: "2026-05-01T00:00:00.000Z",
      provider: "TestLab",
    });
    __seedDiscovery({
      id: "disc_b",
      kind: "new-paper",
      title: "Test Paper B",
      summary: "synthetic",
      url: "https://example.com/b",
      date: "2026-05-15",
      discoveredAt: "2026-05-15T00:00:00.000Z",
    });
    const { items, stats } = getDiscoveries(10);
    expect(items.map(i => i.id)).toEqual(["disc_b", "disc_a"]);
    expect(stats.totalRunsCompleted).toBe(0);
  });
});
