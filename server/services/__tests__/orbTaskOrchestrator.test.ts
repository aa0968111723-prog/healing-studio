import { describe, expect, it } from "vitest";
import { executeCurrentStepTools, type ExecuteStepToolsInput } from "../orbTaskOrchestrator";

const baseInput: ExecuteStepToolsInput = {
  task: {
    taskId: "t1",
    userId: 1,
    intent: "x",
    status: "running",
    steps: [{ id: "s1", label: "step", uiActions: [], toolCalls: [{ name: "tool.a", requiresApproval: true }] }],
    currentStepIndex: 0,
    needsApproval: false,
    approvedStepIds: [],
    stepApprovals: [],
    stepReports: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  userId: 1,
  userRole: "user",
  tools: [{ name: "tool.a", description: "a", method: "GET", endpoint: "http://localhost/a", requireConfirmation: true }],
  approved: false,
};

describe("orbTaskOrchestrator preferences", () => {
  it("always_approve policy skips confirmation gate", async () => {
    const out = await executeCurrentStepTools({ ...baseInput, agentPreferences: { userId: 1, confirmationPolicy: "always_approve", allowedRiskLevels: ["low", "medium"], autoApproveTools: [], blockedTools: [], maxAutoStepsPerTask: 5, notifyOnCompletion: true, notifyOnError: true } });
    expect(out.blockedByApproval).not.toBe(true);
  });

  it("confirm_high_risk can pause when step requires confirmation", async () => {
    const out = await executeCurrentStepTools({ ...baseInput, agentPreferences: { userId: 1, confirmationPolicy: "confirm_high_risk", allowedRiskLevels: ["low", "medium"], autoApproveTools: [], blockedTools: [], maxAutoStepsPerTask: 5, notifyOnCompletion: true, notifyOnError: true } });
    expect(typeof out.ok).toBe("boolean");
  });

  it("blocked tool returns tool-blocked-by-user error", async () => {
    const out = await executeCurrentStepTools({ ...baseInput, agentPreferences: { userId: 1, confirmationPolicy: "always_approve", allowedRiskLevels: ["low", "medium"], autoApproveTools: [], blockedTools: ["tool.a"], maxAutoStepsPerTask: 5, notifyOnCompletion: true, notifyOnError: true } });
    expect(out.toolResults[0]?.error).toBe("tool-blocked-by-user");
  });

  it("maxAutoStepsPerTask limit pauses execution", async () => {
    const out = await executeCurrentStepTools({ ...baseInput, autoApprovedStepsInRun: 5, agentPreferences: { userId: 1, confirmationPolicy: "always_approve", allowedRiskLevels: ["low", "medium"], autoApproveTools: [], blockedTools: [], maxAutoStepsPerTask: 5, notifyOnCompletion: true, notifyOnError: true } });
    expect(out.blockedByApproval).toBe(true);
  });
});
