/**
 * Unit tests for inspirationSpecialistTools (靈靈) — verifies that 靈靈
 * 從 mock-only 升級為真的 AI agent 後，每個工具都會依輸入動態回傳結果，
 * 並能在外部 Sonar API 不可用時 graceful fallback 到策展風格庫。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// inspirationFetcher 會打 Perplexity / OpenRouter — mock 掉，所以測試
// 不依賴外部網路且能驗證 fallback 行為。
vi.mock("../../../server/services/inspirationFetcher", () => ({
  fetchInspiration: vi.fn(),
}));

import { fetchInspiration } from "../../../server/services/inspirationFetcher";
import {
  __internals,
  analyzeReference,
  buildMoodBoard,
  getCreativeSuggestions,
  getStyleAtlas,
  getStyleMixingSuggestions,
  rankStylesByIntent,
  refinePromptVariants,
  searchTrends,
} from "../../../server/services/spiritTools/inspirationSpecialistTools";

const fetchInspirationMock = vi.mocked(fetchInspiration);

const sonarSuccess = {
  ok: true as const,
  provider: "perplexity-native" as const,
  cards: [
    {
      title: "霓虹夜城",
      promptKeywords: "cyberpunk neon city, rain reflections, holographic signs",
      rationale: "夜晚都市最熱門",
      sourceUrl: "https://example.com/a",
      sourceTitle: "example.com",
    },
    {
      title: "粉彩日系",
      promptKeywords: "lofi pastel anime, soft watercolor, dreamy slice-of-life",
      rationale: "粉彩風格在 IG 持續發燒",
      sourceUrl: "https://example.com/b",
      sourceTitle: "example.com",
    },
  ],
  sources: [
    { title: "example.com", url: "https://example.com/a" },
    { title: "example.com", url: "https://example.com/b" },
  ],
  summary: "夜晚都市與粉彩日系是當下兩大方向",
};

const sonarEmpty = {
  ok: false as const,
  provider: "none" as const,
  cards: [],
  sources: [],
  summary: "",
  error: "PERPLEXITY_API_KEY 未設定",
};

beforeEach(() => {
  fetchInspirationMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("searchTrends", () => {
  it("returns real Sonar cards when fetcher succeeds", async () => {
    fetchInspirationMock.mockResolvedValue(sonarSuccess);
    const result = await searchTrends({ category: "image" });
    expect(result.success).toBe(true);
    expect(result.provider).toBe("perplexity-native");
    expect(result.trends).toHaveLength(2);
    expect(result.trends[0].sourceUrl).toBe("https://example.com/a");
    expect(result.sources).toHaveLength(2);
  });

  it("falls back to curated atlas when Sonar unavailable, never returning empty", async () => {
    fetchInspirationMock.mockResolvedValue(sonarEmpty);
    const result = await searchTrends({ category: "image" });
    expect(result.success).toBe(true);
    expect(result.provider).toBe("atlas-fallback");
    expect(result.trends.length).toBeGreaterThan(0);
    expect(result.warning).toContain("PERPLEXITY_API_KEY");
  });

  it("falls back when fetcher throws", async () => {
    fetchInspirationMock.mockRejectedValue(new Error("network error"));
    const result = await searchTrends({ category: "video" });
    expect(result.success).toBe(true);
    expect(result.provider).toBe("atlas-fallback");
    expect(result.warning).toMatch(/network error/);
  });

  it("passes userId to fetcher for throttle accounting", async () => {
    fetchInspirationMock.mockResolvedValue(sonarSuccess);
    await searchTrends({ category: "image", userId: 42 });
    expect(fetchInspirationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, modality: "image", angle: "trending" })
    );
  });

  it("maps trend category 'music' to inspiration modality 'audio'", async () => {
    fetchInspirationMock.mockResolvedValue(sonarSuccess);
    await searchTrends({ category: "music" });
    expect(fetchInspirationMock).toHaveBeenCalledWith(
      expect.objectContaining({ modality: "audio" })
    );
  });
});

describe("getCreativeSuggestions", () => {
  it("rejects empty intent", () => {
    const r = getCreativeSuggestions({ intent: "  " });
    expect(r.success).toBe(false);
    expect(r.suggestions).toHaveLength(0);
  });

  it("returns N suggestions whose prompts include the user intent verbatim", () => {
    const r = getCreativeSuggestions({
      intent: "賽博龐克 街景",
      modality: "image",
      count: 3,
    });
    expect(r.success).toBe(true);
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.suggestions.length).toBeLessThanOrEqual(3);
    for (const s of r.suggestions) {
      expect(s.prompt).toContain("賽博龐克 街景");
      expect(s.handoffSpirit).toBe("image-specialist");
    }
  });

  it("ranks intent-matching styles to the top", () => {
    const r = getCreativeSuggestions({
      intent: "我想做一張霓虹未來的圖",
      modality: "image",
      count: 1,
    });
    expect(r.suggestions[0].styleId).toBe("cyberpunk-neon");
  });

  it("routes audio modality to music-specialist handoff", () => {
    const r = getCreativeSuggestions({
      intent: "我想做 lofi 環境音",
      modality: "audio",
      count: 2,
    });
    expect(r.suggestions[0].handoffSpirit).toBe("music-specialist");
  });

  it("varies output between different intents (not mock-locked)", () => {
    const a = getCreativeSuggestions({
      intent: "賽博龐克 夜城",
      modality: "image",
      count: 1,
    });
    const b = getCreativeSuggestions({
      intent: "水彩插畫 治癒",
      modality: "image",
      count: 1,
    });
    expect(a.suggestions[0].styleId).not.toBe(b.suggestions[0].styleId);
  });
});

describe("getStyleMixingSuggestions", () => {
  it("returns multiple combinations by default", () => {
    const r = getStyleMixingSuggestions();
    expect(r.success).toBe(true);
    expect(r.combinations.length).toBeGreaterThanOrEqual(2);
    for (const c of r.combinations) {
      expect(c.styleIds).toHaveLength(2);
      expect(c.styles).toHaveLength(2);
    }
  });

  it("uses seedStyle as the first half of every pair", () => {
    const r = getStyleMixingSuggestions({ seedStyle: "cyberpunk-neon", count: 3 });
    expect(r.combinations.length).toBe(3);
    for (const c of r.combinations) {
      expect(c.styleIds[0]).toBe("cyberpunk-neon");
      expect(c.styleIds[1]).not.toBe("cyberpunk-neon");
    }
  });

  it("accepts a natural-language seedStyle by fuzzy matching", () => {
    const r = getStyleMixingSuggestions({ seedStyle: "霓虹", count: 2 });
    expect(r.combinations[0].styleIds[0]).toBe("cyberpunk-neon");
  });
});

describe("analyzeReference", () => {
  it("rejects empty imageUrl", async () => {
    const r = await analyzeReference({ imageUrl: "" });
    expect(r.success).toBe(false);
    expect(r.provider).toBe("none");
  });

  it("returns structured analysis when Sonar succeeds", async () => {
    fetchInspirationMock.mockResolvedValue({
      ...sonarSuccess,
      cards: [
        {
          title: "Neon night",
          promptKeywords:
            "cyberpunk neon, magenta cyan color palette, low angle, dramatic mood",
          rationale: "matches reference",
          sourceUrl: "https://example.com/x",
          sourceTitle: "example.com",
        },
      ],
    });
    const r = await analyzeReference({ imageUrl: "https://cdn.example.com/ref.jpg" });
    expect(r.success).toBe(true);
    expect(r.provider).toBe("perplexity-native");
    expect(r.analysis).toBeDefined();
    expect(r.analysis!.similarStyles.length).toBeGreaterThan(0);
  });

  it("returns checklist fallback when Sonar empty", async () => {
    fetchInspirationMock.mockResolvedValue(sonarEmpty);
    const r = await analyzeReference({
      imageUrl: "https://cdn.example.com/ref.jpg",
      userHint: "霓虹夜景",
    });
    expect(r.success).toBe(true);
    expect(r.provider).toBe("atlas-checklist");
    expect(r.analysis!.similarStyles.length).toBeGreaterThan(0); // 用 hint 對 atlas 打分
  });
});

describe("buildMoodBoard", () => {
  it("rejects empty topic", async () => {
    fetchInspirationMock.mockResolvedValue(sonarSuccess);
    const r = await buildMoodBoard({ topic: "" });
    expect(r.success).toBe(false);
  });

  it("composes Sonar cards + atlas cards up to size", async () => {
    fetchInspirationMock.mockResolvedValue(sonarSuccess);
    const r = await buildMoodBoard({ topic: "夜晚街景", modality: "image", size: 5 });
    expect(r.success).toBe(true);
    expect(r.cards.length).toBe(5);
    // 至少一張卡片帶 sourceUrl（來自 Sonar）+ 至少一張帶 styleId（來自 atlas）
    expect(r.cards.some(c => c.sourceUrl)).toBe(true);
    expect(r.cards.some(c => c.styleId)).toBe(true);
  });

  it("emits handoff spirit + promptSeed for the next stage", async () => {
    fetchInspirationMock.mockResolvedValue(sonarSuccess);
    const r = await buildMoodBoard({ topic: "賽博龐克", modality: "image" });
    expect(r.handoff.spirit).toBe("image-specialist");
    expect(r.handoff.promptSeed).toContain("賽博龐克");
  });

  it("falls back gracefully to atlas-only when Sonar dies", async () => {
    fetchInspirationMock.mockResolvedValue(sonarEmpty);
    const r = await buildMoodBoard({ topic: "lofi pastel", modality: "image", size: 4 });
    expect(r.success).toBe(true);
    expect(r.cards.length).toBeGreaterThan(0);
    expect(r.provider).toBe("atlas-fallback");
    expect(r.palette.length).toBeGreaterThan(0); // palette 仍從 atlas 取得
  });
});

describe("refinePromptVariants", () => {
  it("rejects empty draftPrompt", () => {
    const r = refinePromptVariants({ draftPrompt: "" });
    expect(r.success).toBe(false);
    expect(r.variants).toHaveLength(0);
  });

  it("emits N variants that each embed the original draft", () => {
    const r = refinePromptVariants({
      draftPrompt: "a lonely robot in the rain",
      modality: "image",
      count: 3,
    });
    expect(r.success).toBe(true);
    expect(r.variants).toHaveLength(3);
    for (const v of r.variants) {
      expect(v.prompt).toContain("a lonely robot in the rain");
      expect(v.handoffSpirit).toBe("image-specialist");
    }
    // 三個變體應該是三個不同的風格
    const ids = new Set(r.variants.map(v => v.styleId));
    expect(ids.size).toBe(3);
  });

  it("honors excludeStyles", () => {
    const r = refinePromptVariants({
      draftPrompt: "霓虹城市 夜景",
      modality: "image",
      count: 3,
      excludeStyles: ["cyberpunk-neon"],
    });
    for (const v of r.variants) {
      expect(v.styleId).not.toBe("cyberpunk-neon");
    }
  });
});

describe("rankStylesByIntent", () => {
  it("returns ranked entries with reasons", () => {
    const r = rankStylesByIntent({
      intent: "我想做一張霓虹未來感的圖",
      modality: "image",
      limit: 5,
    });
    expect(r.success).toBe(true);
    expect(r.rankings.length).toBeLessThanOrEqual(5);
    expect(r.rankings[0].styleId).toBe("cyberpunk-neon");
    expect(r.rankings[0].reasons.length).toBeGreaterThan(0);
    expect(r.rankings[0].score).toBeGreaterThan(0);
  });

  it("rejects empty intent", () => {
    const r = rankStylesByIntent({ intent: "" });
    expect(r.success).toBe(false);
    expect(r.rankings).toHaveLength(0);
  });
});

describe("getStyleAtlas", () => {
  it("returns the full atlas when no modality filter is given", () => {
    const r = getStyleAtlas();
    expect(r.success).toBe(true);
    expect(r.totalCount).toBeGreaterThanOrEqual(30);
    expect(r.entries.length).toBe(r.totalCount);
  });

  it("filters atlas by modality", () => {
    const r = getStyleAtlas({ modality: "audio" });
    expect(r.success).toBe(true);
    for (const e of r.entries) {
      expect(e.modalities.includes("audio") || e.modalities.includes("general")).toBe(true);
    }
  });
});

describe("STYLE_ATLAS curation invariants", () => {
  it("has unique styleIds", () => {
    const ids = __internals.STYLE_ATLAS.map(s => s.styleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each entry declares at least one modality and one matchKeyword", () => {
    for (const e of __internals.STYLE_ATLAS) {
      expect(e.modalities.length).toBeGreaterThan(0);
      expect(e.matchKeywords.length).toBeGreaterThan(0);
      expect(e.englishKeywords.length).toBeGreaterThan(5);
      expect(e.popularity).toBeGreaterThanOrEqual(0);
      expect(e.popularity).toBeLessThanOrEqual(100);
    }
  });

  it("scoreStyleForIntent rewards modality match + keyword hit", () => {
    const cyberpunk = __internals.STYLE_ATLAS.find(s => s.styleId === "cyberpunk-neon")!;
    const matchScore = __internals.scoreStyleForIntent(cyberpunk, {
      intent: "cyberpunk neon city",
      modality: "image",
    });
    const irrelevantScore = __internals.scoreStyleForIntent(cyberpunk, {
      intent: "watercolor flower",
      modality: "audio",
    });
    expect(matchScore).toBeGreaterThan(irrelevantScore);
  });
});
