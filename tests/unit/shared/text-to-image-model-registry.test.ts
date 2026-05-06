import { describe, expect, it } from "vitest";
import {
  pickBestTextToImageModel,
  rankTextToImageModelsByPrompt,
  TEXT_TO_IMAGE_MODEL_REGISTRY,
} from "../../../shared/textToImageModelRegistry";

describe("textToImageModelRegistry", () => {
  it("contains a non-empty model registry", () => {
    expect(TEXT_TO_IMAGE_MODEL_REGISTRY.length).toBeGreaterThan(0);
  });

  it("ranks realistic prompt toward FLUX Pro", () => {
    const ranked = rankTextToImageModelsByPrompt("A photoreal cinematic product shot with studio lighting");
    expect(ranked[0]?.modelId).toBe("fal-ai/flux-pro/v1.1");
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  it("falls back to default model when no keyword is matched", () => {
    const picked = pickBestTextToImageModel("xyz nonsemantic token");
    expect(picked.modelId).toBe("fal-ai/flux-pro/v1.1");
    expect(picked.score).toBe(0);
  });
});
