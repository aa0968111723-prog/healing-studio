import { describe, expect, it } from "vitest";
import { estimateOrbTaskCost } from "./services/orbCostGuard";

describe("orb cost guard", () => {
  it("high-cost video task requires approval", () => {
    const estimate = estimateOrbTaskCost({
      providerId: "gemini",
      modality: "video",
      attachmentBytes: 25 * 1024 * 1024,
      expectedOutput: "video",
      estimatedDurationSec: 240,
      crossPageSteps: 2,
    });
    expect(estimate.tier).toBe("high");
    expect(estimate.requiresHuman).toBe(true);
    expect(estimate.askBeforeAct).toBe(true);
  });

  it("code task requires approval", () => {
    const estimate = estimateOrbTaskCost({
      providerId: "claudeCode",
      modality: "code",
      expectedOutput: "code",
      crossPageSteps: 1,
    });
    expect(estimate.tier).toBe("high");
    expect(estimate.requiresHuman).toBe(true);
  });

  it("LoRA training plan forces high tier even with a single asset", () => {
    // Without this rule the asset-count heuristic (assets >= 3) treats
    // a one-step training job as low-cost, so the orb auto-approves
    // the run and the user gets surprise charges + a 5–30 minute GPU
    // job they didn't explicitly confirm.
    const estimate = estimateOrbTaskCost({
      providerId: "fal",
      modality: "image",
      expectedOutput: "image",
      estimatedAssetCount: 1,
      toolNames: ["studio.trainLora"],
    });
    expect(estimate.tier).toBe("high");
    expect(estimate.requiresHuman).toBe(true);
    expect(estimate.reasons).toContain("model_training_workload");
  });

  it("normal image generation (no training tool) is not bumped", () => {
    const estimate = estimateOrbTaskCost({
      providerId: "fal",
      modality: "image",
      expectedOutput: "image",
      estimatedAssetCount: 1,
      toolNames: ["studio.generateImage"],
    });
    expect(estimate.tier).toBe("low");
    expect(estimate.requiresHuman).toBe(false);
  });
});
