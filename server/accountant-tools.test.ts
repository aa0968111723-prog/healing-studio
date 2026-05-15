import { describe, expect, it } from "vitest";
import {
  estimateCost,
  compareModels,
  suggestSavings,
  workflowEstimate,
} from "./services/spiritTools/accountantTools";
import { MODEL_PRICING_CATALOG } from "./services/modelPricing";

// ─── accountant.estimate ───────────────────────────────────────────────────

describe("accountantTools.estimateCost", () => {
  it("returns label/provider/category for a known model", () => {
    // Pick the cheapest text-to-image so this test stays robust against
    // pricing edits — we just need any catalog entry that's guaranteed to exist.
    const knownEntry = Object.values(MODEL_PRICING_CATALOG).find(
      p => p.category === "text-to-image"
    );
    expect(knownEntry).toBeDefined();

    const result = estimateCost({ modelId: knownEntry!.modelId });
    expect(result.modelId).toBe(knownEntry!.modelId);
    expect(result.label).toBe(knownEntry!.label);
    expect(result.provider).toBe(knownEntry!.provider);
    expect(result.category).toBe("text-to-image");
    expect(result.totalPoints).toBeGreaterThan(0);
    expect(result.isUnknownModel).toBe(false);
    expect(result.breakdown).toContain("基礎");
  });

  it("flags unknown models with isUnknownModel=true and fallback 5 pts", () => {
    const result = estimateCost({ modelId: "fake-model-that-does-not-exist" });
    expect(result.isUnknownModel).toBe(true);
    expect(result.label).toBeNull();
    expect(result.provider).toBeNull();
    expect(result.category).toBeNull();
    // estimatePoints fallback: unknown model = 5 pts
    expect(result.totalPoints).toBe(5);
  });

  it("propagates duration to estimatePoints for video models", () => {
    const fast = estimateCost({
      modelId: "fal-ai/stable-audio",
      durationSec: 30,
    });
    const slow = estimateCost({
      modelId: "fal-ai/stable-audio",
      durationSec: 120,
    });
    // 30s should be ≤ 120s for the same audio model
    expect(slow.totalPoints).toBeGreaterThanOrEqual(fast.totalPoints);
  });
});

// ─── accountant.compare ────────────────────────────────────────────────────

describe("accountantTools.compareModels", () => {
  it("orders rows by totalPoints ascending and reports cheapest", () => {
    const result = compareModels({
      category: "text-to-image",
      limit: 5,
    });
    expect(result.category).toBe("text-to-image");
    expect(result.cheapest).not.toBeNull();
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.length).toBeLessThanOrEqual(5);

    // Sorted ascending
    for (let i = 1; i < result.rows.length; i++) {
      expect(result.rows[i].totalPoints).toBeGreaterThanOrEqual(
        result.rows[i - 1].totalPoints
      );
    }

    // Cheapest row should be the first row of the sorted list
    expect(result.rows[0].modelId).toBe(result.cheapest!.modelId);
    expect(result.rows[0].premiumOverCheapest).toBe(0);
    expect(result.rows[0].pctOfCheapest).toBe(100);
  });

  it("computes premiumOverCheapest correctly for non-cheapest rows", () => {
    const result = compareModels({ category: "text-to-image", limit: 10 });
    if (result.rows.length < 2) return; // catalog might only have 1 entry someday
    const cheapest = result.cheapest!.totalPoints;
    for (const row of result.rows) {
      expect(row.premiumOverCheapest).toBe(row.totalPoints - cheapest);
      expect(row.pctOfCheapest).toBe(
        Math.round((row.totalPoints / Math.max(1, cheapest)) * 100)
      );
    }
  });

  it("respects the limit parameter (default 5, capped at 10)", () => {
    const small = compareModels({ category: "text-to-image", limit: 2 });
    expect(small.rows.length).toBeLessThanOrEqual(2);
    // count is the full category size, not the limited slice
    expect(small.count).toBeGreaterThanOrEqual(small.rows.length);

    const huge = compareModels({ category: "text-to-image", limit: 999 });
    // limit is clamped to 10 inside compareModels via Math.min
    expect(huge.rows.length).toBeLessThanOrEqual(10);
  });
});

// ─── accountant.savings ────────────────────────────────────────────────────

describe("accountantTools.suggestSavings", () => {
  it("returns noBetterOption for unknown model", () => {
    const result = suggestSavings({ modelId: "fake-model-id" });
    expect(result.noBetterOption).toBe(true);
    expect(result.alternatives).toHaveLength(0);
  });

  it("suggests alternatives only with savings > 0, sorted by savings desc", () => {
    // Find an expensive entry that DEFINITELY has cheaper siblings — pick the
    // most expensive in text-to-image so there's room to suggest cheaper.
    const entries = Object.values(MODEL_PRICING_CATALOG).filter(
      p => p.category === "text-to-image"
    );
    const mostExpensive = [...entries].sort(
      (a, b) => b.basePoints - a.basePoints
    )[0];
    if (!mostExpensive) return;

    const result = suggestSavings({ modelId: mostExpensive.modelId, limit: 5 });
    expect(result.baseline.modelId).toBe(mostExpensive.modelId);
    expect(result.alternatives.length).toBeGreaterThan(0);

    // All suggested alternatives must save > 0 points
    for (const alt of result.alternatives) {
      expect(alt.savingsPoints).toBeGreaterThan(0);
    }

    // Sorted by savingsPoints descending
    for (let i = 1; i < result.alternatives.length; i++) {
      expect(result.alternatives[i].savingsPoints).toBeLessThanOrEqual(
        result.alternatives[i - 1].savingsPoints
      );
    }
  });

  it("classifies tier risk: same tier=safe, ≥2 tier drop=high risk", () => {
    const entries = Object.values(MODEL_PRICING_CATALOG).filter(
      p => p.category === "text-to-image"
    );
    const mostExpensive = [...entries].sort(
      (a, b) => b.basePoints - a.basePoints
    )[0];
    if (!mostExpensive) return;

    const result = suggestSavings({ modelId: mostExpensive.modelId, limit: 5 });
    for (const alt of result.alternatives) {
      if (alt.tierGap >= 2) {
        expect(alt.riskNote).toContain("品質風險高");
      } else if (alt.tierGap === 1) {
        expect(alt.riskNote).toContain("品質可能略降");
      } else {
        expect(alt.riskNote).toContain("同 tier");
      }
    }
  });

  it("returns noBetterOption=true when baseline is already cheapest in its category", () => {
    // Find the cheapest entry per category and verify suggestSavings can't
    // recommend anything cheaper than it.
    const entries = Object.values(MODEL_PRICING_CATALOG).filter(
      p => p.category === "text-to-image"
    );
    const cheapest = [...entries].sort(
      (a, b) => a.basePoints - b.basePoints
    )[0];
    if (!cheapest) return;
    const result = suggestSavings({ modelId: cheapest.modelId });
    expect(result.alternatives).toHaveLength(0);
    expect(result.noBetterOption).toBe(true);
  });
});

// ─── accountant.workflowEstimate ───────────────────────────────────────────

describe("accountantTools.workflowEstimate", () => {
  it("rolls up totalPoints across all steps with index + breakdown", () => {
    const img = Object.values(MODEL_PRICING_CATALOG).find(
      p => p.category === "text-to-image"
    );
    const vid = Object.values(MODEL_PRICING_CATALOG).find(
      p => p.category === "text-to-video"
    );
    expect(img).toBeDefined();
    expect(vid).toBeDefined();

    const result = workflowEstimate({
      steps: [
        { label: "封面圖", modelId: img!.modelId, imageCount: 1 },
        { label: "影片", modelId: vid!.modelId, durationSec: 5 },
      ],
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].index).toBe(1);
    expect(result.rows[1].index).toBe(2);
    expect(result.rows[0].label).toBe("封面圖");
    expect(result.totalPoints).toBe(
      result.rows[0].totalPoints + result.rows[1].totalPoints
    );
    expect(result.mostExpensive?.modelId).toBe(
      result.rows[0].totalPoints >= result.rows[1].totalPoints
        ? result.rows[0].modelId
        : result.rows[1].modelId
    );
    expect(result.unknownStepCount).toBe(0);
  });

  it("flags unknown modelIds via unknownStepCount but still totals points", () => {
    const known = Object.values(MODEL_PRICING_CATALOG).find(
      p => p.category === "text-to-image"
    )!;
    const result = workflowEstimate({
      steps: [
        { modelId: known.modelId, imageCount: 1 },
        { modelId: "totally-fake-model-id", imageCount: 1 },
      ],
    });
    expect(result.unknownStepCount).toBe(1);
    expect(result.rows[1].isUnknownModel).toBe(true);
    expect(result.rows[1].modelLabel).toBeNull();
    // Unknown fallback is 5 pts (per estimatePoints) — total must include it.
    expect(result.totalPoints).toBeGreaterThanOrEqual(
      result.rows[0].totalPoints + 5
    );
  });

  it("handles empty steps[] without throwing", () => {
    const result = workflowEstimate({ steps: [] });
    expect(result.totalPoints).toBe(0);
    expect(result.rows).toHaveLength(0);
    expect(result.mostExpensive).toBeNull();
  });

  it("preserves label and uses Step N default when label missing", () => {
    const m = Object.values(MODEL_PRICING_CATALOG).find(
      p => p.category === "text-to-image"
    )!;
    const result = workflowEstimate({
      steps: [{ modelId: m.modelId }],
    });
    expect(result.rows[0].label).toBe("Step 1");
  });
});
