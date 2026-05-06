import { describe, expect, it } from "vitest";
import {
  IMAGE_UPSCALE_MODEL_REGISTRY,
  pickBestImageUpscaleModel,
  rankImageUpscaleModelsByPrompt,
} from "../../../shared/imageUpscaleModelRegistry";

describe("imageUpscaleModelRegistry", () => {
  it("contains a non-empty model registry", () => {
    expect(IMAGE_UPSCALE_MODEL_REGISTRY.length).toBeGreaterThan(0);
  });

  it("ranks quality-focused prompt toward SeedVR", () => {
    const ranked = rankImageUpscaleModelsByPrompt("Please enhance this photoreal portrait to 4K and restore detail");
    expect(ranked[0]?.modelId).toBe("fal-ai/seedvr/upscale/image");
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  it("falls back to default model when no keyword is matched", () => {
    const picked = pickBestImageUpscaleModel("xyz nonsemantic token");
    expect(picked.modelId).toBe("fal-ai/seedvr/upscale/image");
    expect(picked.score).toBe(0);
  });
});
