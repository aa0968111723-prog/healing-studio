import { describe, expect, it } from "vitest";
import {
  pickBestSkeletalModel,
  rankSkeletalModelsByPrompt,
  SKELETAL_MODEL_REGISTRY,
} from "../../../shared/skeletalModelRegistry";

describe("skeletalModelRegistry", () => {
  it("contains a non-empty model registry", () => {
    expect(SKELETAL_MODEL_REGISTRY.length).toBeGreaterThan(0);
  });

  it("ranks environment prompt toward world model", () => {
    const ranked = rankSkeletalModelsByPrompt("Create an environment world terrain level layout for previsualization");
    expect(ranked[0]?.modelId).toBe("fal-ai/hunyuan_world/image-to-world");
    expect(ranked[0]?.score).toBeGreaterThan(0);
  });

  it("falls back to default model when no keyword is matched", () => {
    const picked = pickBestSkeletalModel("xyz nonsemantic token");
    expect(picked.modelId).toBe("fal-ai/hunyuan3d-v3/image-to-3d");
    expect(picked.score).toBe(0);
  });
});
