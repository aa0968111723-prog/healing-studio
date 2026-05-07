/**
 * orb-proxy-deep-optimize.test.ts
 *
 * Pure-function tests for the second wave of orb-proxy improvements:
 *   - Smarter scoreMatch (fuzzy + token weighting)
 *   - bigramSimilarity edge cases
 *   - Recency multiplier curve
 *   - diversifyByKind round-robin guarantee
 *   - Multi-dim wizard skipping remembered dimensions
 *   - Clarification → preference memory shape
 */

import { describe, expect, it } from "vitest";
import {
  bigramSimilarity,
  diversifyByKind,
  recencyMultiplier,
  scoreMatch,
  type UnifiedSearchResultItem,
} from "./services/orbUnifiedSearch";
import {
  buildMultiDimWizardClarification,
  countMissingHighSignalDimensions,
  inferConversationDimensions,
} from "../shared/orb-clarification-options";
import {
  buildClarificationPickMemory,
  dimensionToMetadataKey,
  normalizePickValue,
  rememberedDimensionCoverage,
} from "../shared/orb-clarification-memory";

describe("scoreMatch — smarter scoring", () => {
  it("title hit beats body hit", () => {
    const titleHit = scoreMatch("forest", "Forest Morning", "no body");
    const bodyHit = scoreMatch("forest", "Untitled", "deep forest morning");
    expect(titleHit).toBeGreaterThan(bodyHit);
  });

  it("tolerates single-character typos via bigram fuzzy", () => {
    // Drop a char in the middle: 'forst morning' vs 'Forest Morning'
    const fuzzy = scoreMatch("forst morning", "Forest Morning", "");
    const exact = scoreMatch("forest morning", "Forest Morning", "");
    // Fuzzy should land somewhere meaningful even though it's not a perfect hit.
    expect(fuzzy).toBeGreaterThan(0.25);
    expect(exact).toBeGreaterThan(fuzzy);
  });

  it("rewards rare/long tokens more than short common tokens", () => {
    // "雨後森林" (4 chars) should score higher in title than just "的" (1 char,
    // filtered) — tokens of length ≥ 4 carry more weight per the new model.
    const longToken = scoreMatch("雨後森林", "雨後森林清晨", "");
    const tinyToken = scoreMatch("森林", "雨後森林清晨", "");
    // Long-token query has both substring + token overlap → ≥ tiny token's
    // single-token bonus alone.
    expect(longToken).toBeGreaterThanOrEqual(tinyToken);
  });

  it("returns 0 for empty query", () => {
    expect(scoreMatch("", "anything", "anything")).toBe(0);
    expect(scoreMatch("   ", "anything", "anything")).toBe(0);
  });

  it("caps score at 1.0", () => {
    const s = scoreMatch("forest", "forest forest forest forest forest", "forest forest forest");
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe("bigramSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(bigramSimilarity("forest", "forest")).toBe(1);
  });
  it("returns 0 for empty input", () => {
    expect(bigramSimilarity("", "forest")).toBe(0);
    expect(bigramSimilarity("forest", "")).toBe(0);
  });
  it("returns positive similarity for near-misses", () => {
    expect(bigramSimilarity("forest", "forst")).toBeGreaterThan(0.5);
  });
  it("returns low similarity for unrelated strings", () => {
    expect(bigramSimilarity("forest", "calm bgm")).toBeLessThan(0.3);
  });
});

describe("recencyMultiplier", () => {
  const NOW = new Date("2026-05-07T10:00:00Z").getTime();
  const days = (n: number) => NOW - n * 24 * 60 * 60 * 1000;

  it("boosts items < 7 days old", () => {
    expect(recencyMultiplier(days(3), NOW)).toBe(1.2);
  });
  it("mild boost for items 7..30 days old", () => {
    expect(recencyMultiplier(days(20), NOW)).toBe(1.05);
  });
  it("neutral for 30..90 days", () => {
    expect(recencyMultiplier(days(60), NOW)).toBe(1.0);
  });
  it("decay below 1 for >90 days", () => {
    expect(recencyMultiplier(days(120), NOW)).toBeLessThan(1);
  });
  it("returns 1 when at is undefined (e.g. tutorials)", () => {
    expect(recencyMultiplier(undefined, NOW)).toBe(1);
  });
});

describe("diversifyByKind", () => {
  const mk = (kind: UnifiedSearchResultItem["kind"], score: number, title: string): UnifiedSearchResultItem =>
    ({ kind, id: `${kind}-${title}`, title, snippet: "", path: "/x", score });

  it("returns input as-is when under limit", () => {
    const items = [mk("asset", 1, "a"), mk("note", 0.5, "b")];
    expect(diversifyByKind(items, 5)).toEqual(items);
  });

  it("interleaves kinds so all categories surface in the first slots", () => {
    const items = [
      mk("asset", 0.9, "a1"),
      mk("asset", 0.85, "a2"),
      mk("asset", 0.8, "a3"),
      mk("asset", 0.75, "a4"),
      mk("note", 0.7, "n1"),
      mk("tutorial", 0.6, "t1"),
    ];
    const out = diversifyByKind(items, 4);
    const kinds = out.map(i => i.kind);
    expect(kinds).toContain("note");
    expect(kinds).toContain("tutorial");
    // Top-scored asset should still come first.
    expect(out[0].id).toBe("asset-a1");
  });

  it("preserves stable order within a kind", () => {
    const items = [
      mk("asset", 0.9, "a1"),
      mk("asset", 0.85, "a2"),
      mk("asset", 0.8, "a3"),
    ];
    const out = diversifyByKind(items, 3);
    expect(out.map(i => i.id)).toEqual(["asset-a1", "asset-a2", "asset-a3"]);
  });
});

describe("multi-dim wizard — remembered coverage suppression", () => {
  it("skips style + platform when both are remembered", () => {
    const remembered = rememberedDimensionCoverage({
      styles: ["電影感"],
      platforms: ["IG Reel"],
    });
    const sig = inferConversationDimensions(
      "做一支 30 秒影片",
      "video",
      remembered
    );
    expect(sig.hasStyle).toBe(true);
    expect(sig.hasPlatform).toBe(true);
  });

  it("suppresses multi-dim card entirely when only purpose still missing", () => {
    const remembered = rememberedDimensionCoverage({
      styles: ["電影感"],
      platforms: ["IG Reel"],
      outputs: ["品牌行銷"],
    });
    // Subject still missing → 1 missing → no multi-dim trigger.
    const multi = buildMultiDimWizardClarification(
      "做一支 30 秒影片",
      "video",
      remembered
    );
    expect(multi).toBeNull();
  });

  it("countMissingHighSignalDimensions drops to 1 when 3 of 4 remembered", () => {
    const remembered = rememberedDimensionCoverage({
      styles: ["電影感"],
      platforms: ["IG"],
      outputs: ["品牌"],
    });
    const count = countMissingHighSignalDimensions(
      "做一支 30 秒影片",
      "video",
      remembered
    );
    expect(count).toBe(1); // only subject still missing
  });
});

describe("clarification picks → preference memory", () => {
  it("maps style/platform/purpose to the metadata keys aggregator reads", () => {
    expect(dimensionToMetadataKey("style")).toBe("styles");
    expect(dimensionToMetadataKey("platform")).toBe("platforms");
    expect(dimensionToMetadataKey("audience")).toBe("platforms");
    expect(dimensionToMetadataKey("purpose")).toBe("outputs");
    expect(dimensionToMetadataKey("usecase")).toBe("outputs");
  });

  it("returns null for non-durable dimensions", () => {
    expect(dimensionToMetadataKey("subject")).toBeNull();
    expect(dimensionToMetadataKey("duration")).toBeNull();
    expect(dimensionToMetadataKey("format")).toBeNull();
  });

  it("normalizes verbose chip labels", () => {
    expect(normalizePickValue("IG Reel（9:16）")).toBe("IG Reel");
    expect(normalizePickValue("品牌行銷／業績轉換")).toBe("品牌行銷");
    expect(normalizePickValue("電影感運鏡，")).toBe("電影感運鏡");
  });

  it("builds a memory draft with metadata + tags + summary", () => {
    const draft = buildClarificationPickMemory([
      { dimension: "style", value: "電影感運鏡" },
      { dimension: "platform", value: "IG Reel（9:16）" },
      { dimension: "purpose", value: "品牌行銷／業績轉換" },
      { dimension: "subject", value: "茶道" }, // dropped — non-durable
    ]);
    expect(draft).not.toBeNull();
    expect(draft!.metadata.styles).toContain("電影感運鏡");
    expect(draft!.metadata.platforms).toContain("IG Reel");
    expect(draft!.metadata.outputs).toContain("品牌行銷");
    expect(draft!.metadata.styles).toHaveLength(1);
    expect(draft!.tags.some(t => t.startsWith("style:"))).toBe(true);
    expect(draft!.tags.some(t => t.startsWith("platform:"))).toBe(true);
    expect(draft!.tags.some(t => t.startsWith("output:"))).toBe(true);
    expect(draft!.summary).toContain("style=電影感運鏡");
  });

  it("returns null when only non-durable dimensions are picked", () => {
    const draft = buildClarificationPickMemory([
      { dimension: "subject", value: "茶道" },
      { dimension: "duration", value: "30 秒" },
    ]);
    expect(draft).toBeNull();
  });

  it("rememberedDimensionCoverage maps prefs → coverage flags", () => {
    expect(rememberedDimensionCoverage({ styles: ["電影感"] })).toEqual({
      hasStyle: true,
      hasPlatform: false,
      hasPurpose: false,
    });
    expect(rememberedDimensionCoverage({})).toEqual({
      hasStyle: false,
      hasPlatform: false,
      hasPurpose: false,
    });
    expect(rememberedDimensionCoverage(null)).toEqual({
      hasStyle: false,
      hasPlatform: false,
      hasPurpose: false,
    });
  });
});
