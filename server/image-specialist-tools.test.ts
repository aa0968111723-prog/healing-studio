/**
 * Unit tests for the upgraded 圖圖 (image-specialist) toolkit.
 *
 * Focus on the **cognitive** tools — recommendModel / enhancePrompt /
 * getImageModels — since the generate / edit / upscale paths exercise
 * dispatchGenerationJob which is covered separately.
 */

import { describe, expect, it } from "vitest";
import {
  getImageModels,
  recommendModel,
  enhancePrompt,
} from "./services/spiritTools/imageSpecialistTools";
import { MODEL_PRICING_CATALOG, getModelPricing } from "./services/modelPricing";

// ─── imageSpecialist.getImageModels ───────────────────────────────────────

describe("imageSpecialistTools.getImageModels", () => {
  it("returns all text-to-image and image-to-image models when category=all", () => {
    const result = getImageModels("all");
    expect(result.success).toBe(true);
    expect(result.category).toBe("all");

    const expectedCount = Object.values(MODEL_PRICING_CATALOG).filter(
      p => p.category === "text-to-image" || p.category === "image-to-image"
    ).length;
    expect(result.count).toBe(expectedCount);
    expect(result.models.length).toBe(expectedCount);
  });

  it("filters to text-to-image only when requested", () => {
    const result = getImageModels("text-to-image");
    expect(result.category).toBe("text-to-image");
    for (const m of result.models) {
      expect(m.category).toBe("text-to-image");
    }
    // catalog has > 1 text-to-image
    expect(result.models.length).toBeGreaterThan(1);
  });

  it("sorts by tier then basePoints ascending — cheapest first", () => {
    const result = getImageModels("text-to-image");
    const tierRank: Record<string, number> = {
      free: 0,
      economy: 1,
      standard: 2,
      premium: 3,
      ultra: 4,
    };
    for (let i = 1; i < result.models.length; i++) {
      const prev = result.models[i - 1];
      const curr = result.models[i];
      const prevTier = tierRank[prev.tier] ?? 99;
      const currTier = tierRank[curr.tier] ?? 99;
      if (prevTier === currTier) {
        expect(curr.basePoints).toBeGreaterThanOrEqual(prev.basePoints);
      } else {
        expect(currTier).toBeGreaterThanOrEqual(prevTier);
      }
    }
  });

  it("pointsForOneImage is positive and matches estimatePoints clamp", () => {
    const result = getImageModels("text-to-image");
    for (const m of result.models) {
      expect(m.pointsForOneImage).toBeGreaterThan(0);
      expect(m.pointsForOneImage).toBeLessThanOrEqual(m.maxPoints);
    }
  });
});

// ─── imageSpecialist.recommendModel ───────────────────────────────────────

describe("imageSpecialistTools.recommendModel", () => {
  it("returns a real catalog modelId for every known intent", () => {
    const intents = [
      "realistic",
      "draft",
      "illustration",
      "brand",
      "lora",
      "edit",
      "upscale",
      "text-design",
      "anatomy",
      "anime",
    ] as const;

    for (const intent of intents) {
      const { result } = recommendModel({ intent });
      expect(result.intent).toBe(intent);
      // Recommendation must be a real catalog entry — that's the whole
      // point of the upgrade (no more LLM-hallucinated model IDs).
      expect(getModelPricing(result.recommendation.modelId)).not.toBeNull();
      expect(result.recommendation.pointsForOneImage).toBeGreaterThan(0);
      expect(result.recommendation.reasoning.length).toBeGreaterThan(0);
    }
  });

  it("for intent=draft, head recommendation is the cheapest catalog model", () => {
    const { result } = recommendModel({ intent: "draft" });
    // Schnell / fast-sdxl / imagen-3-fast — all should be < 2 pts/image
    expect(result.recommendation.pointsForOneImage).toBeLessThanOrEqual(2);
  });

  it("for intent=realistic, head recommendation is premium tier", () => {
    const { result } = recommendModel({ intent: "realistic" });
    expect(["premium", "ultra"]).toContain(result.recommendation.tier);
  });

  it("alternatives all exist in catalog and aren't identical to head", () => {
    const { result } = recommendModel({ intent: "realistic" });
    for (const alt of result.alternatives) {
      expect(getModelPricing(alt.modelId)).not.toBeNull();
      expect(alt.modelId).not.toBe(result.recommendation.modelId);
    }
  });
});

// ─── imageSpecialist.enhancePrompt ────────────────────────────────────────

describe("imageSpecialistTools.enhancePrompt", () => {
  it("keeps original prompt as a substring of enhanced", () => {
    const { result } = enhancePrompt({ prompt: "一隻橘貓" });
    expect(result.enhanced).toContain("一隻橘貓");
    expect(result.original).toBe("一隻橘貓");
  });

  it("adds style keywords when style is provided", () => {
    const { result } = enhancePrompt({ prompt: "森林", style: "watercolor" });
    expect(result.enhanced.toLowerCase()).toMatch(/watercolor/);
    expect(result.addedDimensions).toContain("style:watercolor");
  });

  it("adds mood keywords when mood is provided", () => {
    const { result } = enhancePrompt({ prompt: "海", mood: "dramatic" });
    expect(result.enhanced.toLowerCase()).toMatch(/dramatic/);
    expect(result.addedDimensions).toContain("mood:dramatic");
  });

  it("maps useCase keywords to suggested aspect ratio", () => {
    expect(enhancePrompt({ prompt: "封面", useCase: "IG story" }).result.suggestedAspect).toBe("9:16");
    expect(enhancePrompt({ prompt: "封面", useCase: "YouTube" }).result.suggestedAspect).toBe("16:9");
    expect(enhancePrompt({ prompt: "封面", useCase: "poster" }).result.suggestedAspect).toBe("3:4");
    expect(enhancePrompt({ prompt: "封面", useCase: "instagram" }).result.suggestedAspect).toBe("1:1");
  });

  it("provides a non-empty negative prompt baseline", () => {
    const { result } = enhancePrompt({ prompt: "海" });
    expect(result.suggestedNegative.length).toBeGreaterThan(0);
    expect(result.suggestedNegative.toLowerCase()).toMatch(/blurry|low quality/);
  });

  it("does not duplicate composition / quality if user already wrote them", () => {
    const { result } = enhancePrompt({
      prompt: "a balanced composition with rule of thirds, ultra detail",
    });
    expect(result.addedDimensions).not.toContain("composition");
    expect(result.addedDimensions).not.toContain("quality");
  });
});
