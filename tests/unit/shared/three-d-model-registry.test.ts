import { describe, expect, it } from "vitest";
import {
  inferThreeDModeFromPrompt,
  recommendThreeDModels,
  THREE_D_MODEL_REGISTRY,
} from "../../../shared/threeDModelRegistry";

describe("threeDModelRegistry", () => {
  it("contains seeded 3D model profiles", () => {
    expect(THREE_D_MODEL_REGISTRY.length).toBeGreaterThan(0);
    expect(THREE_D_MODEL_REGISTRY.some(m => m.modelId === "fal-ai/trellis")).toBe(true);
  });

  it("infers image-to-3d when prompt includes image hints", () => {
    const mode = inferThreeDModeFromPrompt("Convert this photo into a 3D asset");
    expect(mode).toBe("image-to-3d");
  });

  it("recommends character-friendly model for avatar prompts", () => {
    const models = recommendThreeDModels("make a stylized avatar character for game", 2);
    expect(models[0]?.modelId).toBe("fal-ai/hyper3d/rodin");
  });
});
