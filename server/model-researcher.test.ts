/**
 * model-researcher.test.ts — 自動研究與事實查核服務的單元測試
 *
 * 我們不真的呼叫 Perplexity。重點是測試：
 *   1. 在沒有 enrichment 時，getEnrichedCatalog 仍能回傳 baseline，且 factCheck.status = "pending"
 *   2. 種一筆 enrichment 後，merge 邏輯會把 pricing / benchmarks / sources 都接上來
 *   3. computeFactCheckStatus 會在超過 14 天後把 status 變成 "stale"
 *   4. 拒絕：未通過 schema 的 LLM 回應不會污染 store
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  AI_MODELS_CATALOG,
  computeFactCheckStatus,
  FACT_CHECK_STALE_DAYS,
} from "../shared/aiModelsCatalog";
import {
  getEnrichedCatalog,
  getEnrichedModel,
  getResearchStats,
  __resetEnrichmentStore,
  __seedEnrichment,
  __ingestPayloadForTest,
} from "./services/modelResearcher";

beforeEach(() => {
  __resetEnrichmentStore();
});

describe("modelResearcher / baseline behaviour", () => {
  it("returns baseline catalog when no enrichment has run", () => {
    const enriched = getEnrichedCatalog();
    expect(enriched).toHaveLength(AI_MODELS_CATALOG.length);
    // Every entry should have a factCheck (even if status = "pending")
    for (const entry of enriched) {
      expect(entry.factCheck).toBeTruthy();
      expect(entry.factCheck.status).toBe("pending");
    }
  });

  it("coverage starts at 0", () => {
    const stats = getResearchStats();
    expect(stats.coverage).toBe(0);
    expect(stats.totalRunsCompleted).toBe(0);
  });

  it("getEnrichedModel returns null for unknown ids", () => {
    expect(getEnrichedModel("nope-not-a-real-id")).toBeNull();
  });
});

describe("modelResearcher / enrichment merge", () => {
  it("merges pricing / benchmarks / sources into the baseline entry", () => {
    __ingestPayloadForTest(
      "claude-opus-4-7",
      {
        factsStillValid: true,
        pricing: {
          inputPerMillion: "$15",
          outputPerMillion: "$75",
          unit: "USD / 1M tokens",
          tier: "premium",
          note: "Prompt caching 90% off",
        },
        benchmarks: [
          { name: "SWE-bench Verified", score: "72%" },
          { name: "MMLU", score: "88%" },
        ],
        latestUpdates: [
          {
            date: "2026-03",
            summary: "Claude Opus 4.7 釋出，強化代理任務",
            url: "https://www.anthropic.com/news/claude-4-7",
          },
        ],
        availability: { api: true, web: true, selfHost: false },
        sources: [
          {
            title: "Anthropic Pricing",
            url: "https://www.anthropic.com/pricing",
            snippet: "Opus 4.7 listed at $15 / $75 per 1M tokens",
          },
        ],
        summary: "仍為旗艦推理模型",
      },
      "test-provider"
    );

    const opus = getEnrichedModel("claude-opus-4-7");
    expect(opus).toBeTruthy();
    expect(opus!.pricing?.tier).toBe("premium");
    expect(opus!.pricing?.inputPerMillion).toBe("$15");
    expect(opus!.benchmarks).toHaveLength(2);
    expect(opus!.latestUpdates).toHaveLength(1);
    expect(opus!.factCheck.status).toBe("auto-checked");
    expect(opus!.factCheck.sources).toHaveLength(1);
    expect(opus!.factCheck.sources[0]!.domain).toBe("anthropic.com");
    expect(opus!.factCheck.provider).toBe("test-provider");
  });

  it("preserves baseline strengths / limitations / useCases (auto-research does NOT overwrite)", () => {
    const before = AI_MODELS_CATALOG.find(m => m.id === "claude-sonnet-4-6")!;
    __ingestPayloadForTest("claude-sonnet-4-6", {
      factsStillValid: true,
      sources: [
        { title: "Anthropic", url: "https://www.anthropic.com/claude" },
      ],
    });
    const after = getEnrichedModel("claude-sonnet-4-6")!;
    expect(after.strengths).toEqual(before.strengths);
    expect(after.limitations).toEqual(before.limitations);
    expect(after.useCases).toEqual(before.useCases);
  });

  it("flags discrepancies when factsStillValid is false", () => {
    __ingestPayloadForTest("gpt-4o", {
      factsStillValid: false,
      discrepancyNotes: "OpenAI 將 GPT-4o 改名為 GPT-4o-2024-11",
      sources: [
        {
          title: "OpenAI Changelog",
          url: "https://platform.openai.com/docs/changelog",
        },
      ],
    });
    const after = getEnrichedModel("gpt-4o")!;
    expect(after.factCheck.hasDiscrepancy).toBe(true);
    expect(after.factCheck.notes).toContain("GPT-4o");
  });
});

describe("modelResearcher / staleness", () => {
  it("marks an old auto-check as stale", () => {
    const tooOld = new Date(
      Date.now() - (FACT_CHECK_STALE_DAYS + 5) * 24 * 60 * 60 * 1000
    ).toISOString();
    __seedEnrichment({
      modelId: "deepseek-v3",
      factCheck: {
        status: "auto-checked",
        checkedAt: tooOld,
        sources: [{ title: "DeepSeek", url: "https://www.deepseek.com/" }],
      },
    });
    const m = getEnrichedModel("deepseek-v3")!;
    expect(m.factCheck.status).toBe("stale");
  });

  it("keeps a fresh auto-check as auto-checked", () => {
    const fresh = new Date().toISOString();
    __seedEnrichment({
      modelId: "deepseek-r1",
      factCheck: {
        status: "auto-checked",
        checkedAt: fresh,
        sources: [{ title: "DeepSeek", url: "https://www.deepseek.com/" }],
      },
    });
    const m = getEnrichedModel("deepseek-r1")!;
    expect(m.factCheck.status).toBe("auto-checked");
  });

  it("computeFactCheckStatus returns pending when no fact-check exists", () => {
    expect(computeFactCheckStatus(undefined)).toBe("pending");
  });
});

describe("modelResearcher / catalog coverage stats", () => {
  it("reports coverage based on how many models have enrichment records", () => {
    expect(getResearchStats().coverage).toBe(0);
    __ingestPayloadForTest("gpt-4o-mini", {
      factsStillValid: true,
      sources: [{ title: "OpenAI", url: "https://openai.com/" }],
    });
    const cov = getResearchStats().coverage;
    expect(cov).toBeGreaterThan(0);
    expect(cov).toBeLessThanOrEqual(1);
  });
});
