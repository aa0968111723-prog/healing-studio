import { describe, expect, it } from "vitest";
import {
  approveOrbAgentTask,
  completeOrbAgentStep,
  createOrbAgentTaskFromPlanner,
  getOrbAgentTask,
} from "../orbTaskStateMachine";
import { parseAndGatePlan } from "../../../shared/agent-plan-adapter";

function buildTaskedPlanWithSteps(steps: unknown[]) {
  return parseAndGatePlan({
    schemaVersion: "agent-plan.v3",
    planId: `plan_${Math.random().toString(36).slice(2, 8)}`,
    traceId: "trace_conditional",
    intent: "conditional run",
    summaryForUser: "conditional",
    decision: { mode: "tasked" },
    routing: { preferredEngine: "gemini", capabilities: ["tooling"], pageScope: "single" },
    attachments: [],
    safety: { riskLevel: "low", requiresHuman: false, reasons: [] },
    taskPolicy: { needsApproval: false, isolation: "tool", autoStart: true },
    steps,
    warnings: [],
  });
}

describe("orbTaskStateMachine conditional branching", () => {
  it("step with passing condition executes normally", () => {
    const result = buildTaskedPlanWithSteps([
      { id: "s1", label: "one", riskLevel: "low", requiresApproval: false, undoable: false, action: { type: "fillPrompt", text: "a" } },
      { id: "s2", label: "two", riskLevel: "low", requiresApproval: false, undoable: false, action: { type: "fillPrompt", text: "b" }, condition: { field: "previousStep.output.status", operator: "eq", value: undefined, onFail: "skip" } },
    ]);
    const task = createOrbAgentTaskFromPlanner(result)!;
    approveOrbAgentTask(task.taskId);
    completeOrbAgentStep(task.taskId, "s1");
    expect(getOrbAgentTask(task.taskId)?.currentStepId).toBe("s2");
  });

  it("failing condition + skip marks step skipped", () => {
    const result = buildTaskedPlanWithSteps([
      { id: "s1", label: "one", riskLevel: "low", requiresApproval: false, undoable: false, action: { type: "fillPrompt", text: "a" } },
      { id: "s2", label: "two", riskLevel: "low", requiresApproval: false, undoable: false, action: { type: "fillPrompt", text: "b" }, condition: { field: "previousStep.output.status", operator: "eq", value: "success", onFail: "skip" } },
      { id: "s3", label: "three", riskLevel: "low", requiresApproval: false, undoable: false, action: { type: "fillPrompt", text: "c" } },
    ]);
    const task = createOrbAgentTaskFromPlanner(result)!;
    approveOrbAgentTask(task.taskId);
    completeOrbAgentStep(task.taskId, "s1");
    expect(getOrbAgentTask(task.taskId)?.steps.find(s => s.id === "s2")?.status).toBe("skipped");
    expect(getOrbAgentTask(task.taskId)?.currentStepId).toBe("s3");
  });

  it("failing condition + goto jumps to target step", () => {
    const result = buildTaskedPlanWithSteps([
      { id: "s1", label: "one", riskLevel: "low", requiresApproval: false, undoable: false, action: { type: "fillPrompt", text: "a" } },
      { id: "s2", label: "two", riskLevel: "low", requiresApproval: false, undoable: false, action: { type: "fillPrompt", text: "b" }, condition: { field: "previousStep.output.status", operator: "eq", value: "success", onFail: "goto", gotoStepId: "s4" } },
      { id: "s3", label: "three", riskLevel: "low", requiresApproval: false, undoable: false, action: { type: "fillPrompt", text: "c" } },
      { id: "s4", label: "four", riskLevel: "low", requiresApproval: false, undoable: false, action: { type: "fillPrompt", text: "d" } },
    ]);
    const task = createOrbAgentTaskFromPlanner(result)!;
    approveOrbAgentTask(task.taskId);
    completeOrbAgentStep(task.taskId, "s1");
    expect(getOrbAgentTask(task.taskId)?.currentStepId).toBe("s4");
  });

  it("parseAndGatePlan rejects invalid gotoStepId", () => {
    const result = buildTaskedPlanWithSteps([
      { id: "s1", label: "one", riskLevel: "low", requiresApproval: false, undoable: false, action: { type: "fillPrompt", text: "a" }, condition: { field: "previousStep.output.status", operator: "eq", value: "success", onFail: "goto", gotoStepId: "missing" } },
    ]);
    expect(result.status).toBe("invalid");
    expect(result.reason).toContain("invalid condition.gotoStepId");
  });
});
