import { describe, expect, it } from "vitest";
import {
  approveOrbAgentTask,
  cancelOrbAgentTask,
  completeOrbAgentStep,
  createOrbAgentTaskFromPlanner,
  failOrbAgentStep,
  getOrbAgentTaskEvents,
  pauseOrbAgentTask,
  resumeOrbAgentTask,
  retryOrbAgentTask,
} from "./services/orbTaskStateMachine";
import { parseAndGatePlan } from "../shared/agent-plan-adapter";
import {
  getRecentOrbTaskMemory,
  summarizeRecentOrbTaskMemoryForPlanner,
} from "./services/orbTaskMemory";

function buildTaskedPlan(overrides: Record<string, unknown> = {}) {
  return parseAndGatePlan({
    schemaVersion: "agent-plan.v3",
    planId: "plan_tasked",
    traceId: "trace_tasked",
    intent: "build short video",
    summaryForUser: "我會幫你分步完成。",
    decision: { mode: "tasked" },
    routing: { preferredEngine: "claudeCode", capabilities: ["code"], pageScope: "single" },
    attachments: [],
    safety: { riskLevel: "medium", requiresHuman: true, reasons: [] },
    taskPolicy: { needsApproval: true, isolation: "code", autoStart: false },
    steps: [
      {
        id: "s1",
        label: "first",
        pagePath: "/director",
        riskLevel: "medium",
        requiresApproval: true,
        undoable: false,
        action: { type: "fillPrompt", text: "hello" },
      },
    ],
    warnings: [],
    ...overrides,
  });
}

describe("orb task state machine", () => {
  it("tasked plan creates OrbTask in awaiting_approval with claudeCode isolation", () => {
    const task = createOrbAgentTaskFromPlanner(buildTaskedPlan());
    expect(task).toBeTruthy();
    expect(task?.status).toBe("awaiting_approval");
    expect(task?.approvalRequired).toBe(true);
    expect(task?.preferredEngine).toBe("claudeCode");
    expect(task?.isolation).toBe("code");
  });

  it("approve moves task to approved/executing and starts step", () => {
    const task = createOrbAgentTaskFromPlanner(buildTaskedPlan());
    const approved = approveOrbAgentTask(task!.taskId);
    expect(["approved", "executing"]).toContain(approved?.status);
    expect(approved?.currentStepId).toBeTruthy();
  });

  it("cancelled task cannot continue execution", () => {
    const task = createOrbAgentTaskFromPlanner(buildTaskedPlan());
    cancelOrbAgentTask(task!.taskId, "manual");
    const completed = completeOrbAgentStep(task!.taskId, task!.steps[0].id);
    expect(completed?.status).toBe("cancelled");
  });

  it("failed step records events and retry consumes budget", () => {
    const task = createOrbAgentTaskFromPlanner(buildTaskedPlan());
    approveOrbAgentTask(task!.taskId);
    failOrbAgentStep(task!.taskId, task!.steps[0].id, "provider failed");
    const retry1 = retryOrbAgentTask(task!.taskId, { enableRecovery: true });
    expect(retry1.task?.retryBudget).toBe(1);
    retryOrbAgentTask(task!.taskId, { enableRecovery: true });
    const retry3 = retryOrbAgentTask(task!.taskId, { enableRecovery: true });
    expect(retry3.task?.status).toBe("recovering");
    expect(retry3.recoveryPlan?.status).toBe("clarification");

    const events = getOrbAgentTaskEvents(task!.taskId).map(e => e.type);
    expect(events).toContain("step.failed");
    expect(events).toContain("task.recovering");
  });

  it("AIDV-890: paused task can be resumed and re-enters executing", () => {
    const task = createOrbAgentTaskFromPlanner(buildTaskedPlan());
    approveOrbAgentTask(task!.taskId);
    const paused = pauseOrbAgentTask(task!.taskId);
    expect(paused?.status).toBe("paused");

    const resumed = resumeOrbAgentTask(task!.taskId);
    expect(resumed?.status).toBe("executing");

    const events = getOrbAgentTaskEvents(task!.taskId).map(e => e.type);
    expect(events).toContain("task.paused");
    expect(events).toContain("task.resumed");
  });

  it("AIDV-890: retryOrbAgentTask does not consume budget on paused task", () => {
    const task = createOrbAgentTaskFromPlanner(buildTaskedPlan());
    approveOrbAgentTask(task!.taskId);
    const budgetBefore = task!.retryBudget;
    pauseOrbAgentTask(task!.taskId);

    const result = retryOrbAgentTask(task!.taskId, { enableRecovery: true });
    expect(result.task?.status).toBe("paused");
    expect(result.task?.retryBudget).toBe(budgetBefore);
    expect(result.recoveryPlan).toBeNull();
  });

  it("AIDV-890: resumeOrbAgentTask is a no-op on non-paused tasks", () => {
    const task = createOrbAgentTaskFromPlanner(buildTaskedPlan());
    approveOrbAgentTask(task!.taskId);
    const result = resumeOrbAgentTask(task!.taskId);
    expect(result?.status).toBe("executing");
  });

  it("completed and failed tasks are written into task memory summary", () => {
    const successTask = createOrbAgentTaskFromPlanner(buildTaskedPlan({ planId: "plan_success" }));
    approveOrbAgentTask(successTask!.taskId);
    completeOrbAgentStep(successTask!.taskId, successTask!.steps[0].id);

    const failedTask = createOrbAgentTaskFromPlanner(buildTaskedPlan({ planId: "plan_failure" }));
    approveOrbAgentTask(failedTask!.taskId);
    failOrbAgentStep(failedTask!.taskId, failedTask!.steps[0].id, "network timeout");

    const recent = getRecentOrbTaskMemory(10);
    expect(recent.length).toBeGreaterThan(1);
    const summary = summarizeRecentOrbTaskMemoryForPlanner(10);
    expect(summary).toContain("plan_success");
    expect(summary).toContain("plan_failure");
    expect(summary).not.toContain("GEMINI_API_KEY");
  });
});
