import { describe, it, expect } from "vitest";
import { buildAgentWorkflowFromGenerationTasks } from "../../../shared/worldbuilding-agent-workflow";

describe("worldbuilding agent workflow", () => {
  it("converts tasks to workflow", () => {
    const wf = buildAgentWorkflowFromGenerationTasks({ tasks: [{ id: "1", type: "character_image", title: "x", recommendedModels: [], executionMode: "dry_run", status: "ready", blockers: [], requiresConfirmation: true, payload: {} }] as any });
    expect(wf.steps.length).toBeGreaterThan(0);
  });
});
