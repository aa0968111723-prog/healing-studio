import { describe, it, expect } from "vitest";
import { getModelsForTask, pickDefaultModelForTask, validateModelCanRunTask } from "../../../shared/model-capability-registry";

describe("model capability registry", () => {
  it("resolves models for task", () => expect(getModelsForTask("voice").length).toBeGreaterThan(0));
  it("has default model", () => expect(pickDefaultModelForTask("shot_image")?.id).toBeTruthy());
  it("validates model-task mapping", () => expect(validateModelCanRunTask("internal-image-draft", "voice").ok).toBe(false));
});
