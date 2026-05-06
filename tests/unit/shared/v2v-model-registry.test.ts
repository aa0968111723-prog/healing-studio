import { describe, it, expect } from "vitest";
import {
  V2V_MODEL_REGISTRY,
  rankV2VModelsByPrompt,
  pickBestV2VModel,
  getV2VModelsByUseCase,
} from "../../../shared/v2vModelRegistry";

describe("V2VModelRegistry", () => {
  it("should have all required fields for each model", () => {
    V2V_MODEL_REGISTRY.forEach((model) => {
      expect(model.modelId).toBeTruthy();
      expect(model.label).toBeTruthy();
      expect(model.provider).toBe("fal");
      expect(["standard", "premium", "ultra"]).toContain(model.tier);
      expect(Array.isArray(model.strengths)).toBe(true);
      expect(Array.isArray(model.avoidWhen)).toBe(true);
      expect(Array.isArray(model.promptKeywords)).toBe(true);
      expect(model.description).toBeTruthy();
    });
  });

  it("should rank models by keyword matches", () => {
    const prompt = "我想要快速風格遷移測試";
    const ranked = rankV2VModelsByPrompt(prompt);

    expect(ranked[0].score).toBeGreaterThan(0);
    expect(ranked[0].matchedKeywords.length).toBeGreaterThan(0);
  });

  it("should detect style transfer keywords", () => {
    const prompt = "將影片轉換成藝術風格";
    const ranked = rankV2VModelsByPrompt(prompt);

    const topMatch = ranked[0];
    expect(topMatch.matchedKeywords).toContain("風格");
  });

  it("should detect quality enhancement keywords", () => {
    const prompt = "需要提升影片畫質和超解析度";
    const ranked = rankV2VModelsByPrompt(prompt);

    const topMatch = ranked[0];
    expect(topMatch.modelId).toContain("upscaler");
  });

  it("should detect frame interpolation keywords", () => {
    const prompt = "想要增加幀率做慢動作";
    const ranked = rankV2VModelsByPrompt(prompt);

    const topMatch = ranked[0];
    expect(topMatch.modelId).toContain("rife");
  });

  it("should detect advanced control keywords", () => {
    const prompt = "需要骨架姿態精準控制";
    const ranked = rankV2VModelsByPrompt(prompt);

    const topMatch = ranked[0];
    expect(topMatch.modelId).toContain("animatediff");
  });

  it("should fallback to WAN V2V when no keywords match", () => {
    const prompt = "影片處理";
    const best = pickBestV2VModel(prompt);

    expect(best.modelId).toBe("fal-ai/wan/v2.1/video-to-video");
    expect(best.rationale).toContain("回退到通用預設");
  });

  it("should return best match when keywords are found", () => {
    const prompt = "需要 Topaz 專業級品質提升";
    const best = pickBestV2VModel(prompt);

    expect(best.modelId).toContain("topaz");
    expect(best.score).toBeGreaterThan(0);
  });

  it("should filter models by style-transfer use case", () => {
    const models = getV2VModelsByUseCase("style-transfer");

    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.modelId.includes("kling"))).toBe(true);
    expect(models.some((m) => m.modelId.includes("wan"))).toBe(true);
  });

  it("should filter models by quality-enhance use case", () => {
    const models = getV2VModelsByUseCase("quality-enhance");

    expect(models.length).toBe(3);
    expect(models.some((m) => m.modelId.includes("upscaler"))).toBe(true);
    expect(models.some((m) => m.modelId.includes("rife"))).toBe(true);
    expect(models.some((m) => m.modelId.includes("topaz"))).toBe(true);
  });

  it("should filter models by advanced-control use case", () => {
    const models = getV2VModelsByUseCase("advanced-control");

    expect(models.length).toBe(1);
    expect(models[0].modelId).toBe("fal-ai/animatediff-v2v");
  });

  it("should handle mixed English and Chinese keywords", () => {
    const prompt = "I need fast style transfer 快速風格轉換";
    const ranked = rankV2VModelsByPrompt(prompt);

    expect(ranked[0].score).toBeGreaterThan(1); // Should match multiple keywords
  });

  it("should prioritize premium models for quality keywords", () => {
    const prompt = "高品質精細風格化處理";
    const ranked = rankV2VModelsByPrompt(prompt);

    const topMatch = ranked[0];
    expect(["premium", "ultra"]).toContain(topMatch.modelId);
  });

  it("should prioritize fast models for speed keywords", () => {
    const prompt = "需要快速預覽測試";
    const ranked = rankV2VModelsByPrompt(prompt);

    const topMatches = ranked.filter((m) => m.score > 0);
    const fastModel = topMatches.find((m) =>
      V2V_MODEL_REGISTRY.find(
        (model) => model.modelId === m.modelId && model.tier === "standard"
      )
    );
    expect(fastModel).toBeDefined();
  });
});
