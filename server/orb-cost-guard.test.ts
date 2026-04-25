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
});
