import { describe, expect, it } from "vitest";
import {
  IMAGE_TO_VIDEO_MODEL_REGISTRY,
  pickBestImageToVideoModel,
  rankImageToVideoModelsByPrompt,
} from "../../../shared/imageToVideoModelRegistry";

describe("imageToVideoModelRegistry", () => {
  it("contains a non-empty model registry", () => {
    expect(IMAGE_TO_VIDEO_MODEL_REGISTRY.length).toBeGreaterThan(0);
  });

  it("ranks cinematic prompt toward Kling 2.1 Pro", () => {
    const ranked = rankImageToVideoModelsByPrompt("A realistic cinematic camera move with dramatic slow motion");
    expect(ranked[0]?.modelId).toBe("fal-ai/kling-video/v2.1/pro/image-to-video");
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  it("falls back to default model when no keyword is matched", () => {
    const picked = pickBestImageToVideoModel("xyz nonsemantic token");
    expect(picked.modelId).toBe("fal-ai/kling-video/v2.1/pro/image-to-video");
    expect(picked.score).toBe(0);
  });
});
