import { describe, expect, it } from "vitest";
import {
  attachCodeTaskPr,
  approveCodeTask,
  cancelCodeTask,
  createOrbCodeTask,
  getCodeTask,
  markCodeTaskFailed,
  markCodeTaskMerged,
  markCodeTaskRunning,
  __unsafe_clearCodeTaskStoreForTests,
  getCodeTaskTelemetry,
} from "./services/orbCodeTask";
import { buildClaudeCodeTaskPrompt, buildCodexTaskPrompt } from "../shared/orb-code-task";
import { __unsafe_clearAllOrbMemoryForTests, getRecentOrbMemories } from "./services/orbMemory";

describe("orb code task", () => {
  it("code AgentPlan creates CodeTask", () => {
    __unsafe_clearCodeTaskStoreForTests();
    const task = createOrbCodeTask({
      taskId: "orb_1",
      planId: "plan_1",
      traceId: "trace_1",
      provider: "claudeCode",
      repository: "healing-studio",
      title: "Refactor",
      objective: "refactor router",
      acceptanceCriteria: ["tests pass"],
      riskLevel: "medium",
      summary: "summary",
      rollbackPlan: "git revert",
    });
    expect(task.codeTaskId).toBeTruthy();
    expect(task.status).toBe("awaiting_approval");
  });

  it("code task requires approval and cannot run before approval", () => {
    __unsafe_clearCodeTaskStoreForTests();
    const task = createOrbCodeTask({ taskId: "orb_2", planId: "plan_2", traceId: "trace_2", provider: "claudeCode", repository: "repo", title: "T", objective: "O", acceptanceCriteria: ["A"], riskLevel: "medium", summary: "S", rollbackPlan: "R" });
    const runningBeforeApprove = markCodeTaskRunning(task.codeTaskId);
    expect(runningBeforeApprove?.status).toBe("awaiting_approval");
    approveCodeTask(task.codeTaskId);
    const running = markCodeTaskRunning(task.codeTaskId);
    expect(running?.status).toBe("running");
  });

  it("cancelled code task cannot run", () => {
    const task = createOrbCodeTask({ taskId: "orb_3", planId: "plan_3", traceId: "trace_3", provider: "claudeCode", repository: "repo", title: "T", objective: "O", acceptanceCriteria: ["A"], riskLevel: "medium", summary: "S", rollbackPlan: "R" });
    cancelCodeTask(task.codeTaskId, "stop");
    const running = markCodeTaskRunning(task.codeTaskId);
    expect(running?.status).toBe("cancelled");
  });

  it("attachPr validates GitHub URL", () => {
    const task = createOrbCodeTask({ taskId: "orb_4", planId: "plan_4", traceId: "trace_4", provider: "claudeCode", repository: "repo", title: "T", objective: "O", acceptanceCriteria: ["A"], riskLevel: "medium", summary: "S", rollbackPlan: "R" });
    expect(() => attachCodeTaskPr(task.codeTaskId, "https://example.com/pr/1")).toThrow();
    const attached = attachCodeTaskPr(task.codeTaskId, "https://github.com/org/repo/pull/123");
    expect(attached?.status).toBe("pr_created");
    expect(attached?.prNumber).toBe(123);
  });

  it("high-risk code task requiresHuman", () => {
    const task = createOrbCodeTask({ taskId: "orb_5", planId: "plan_5", traceId: "trace_5", provider: "claudeCode", repository: "repo", title: "Auth change", objective: "change auth", acceptanceCriteria: ["A"], riskLevel: "high", summary: "S", rollbackPlan: "R" });
    expect(task.requiresHuman).toBe(true);
    expect(task.riskLevel).toBe("high");
  });

  it("code task prompt includes acceptance criteria and excludes secrets", () => {
    const task = createOrbCodeTask({ taskId: "orb_6", planId: "plan_6", traceId: "trace_6", provider: "claudeCode", repository: "repo", title: "Task", objective: "use apiKey=abc", acceptanceCriteria: ["no secret"], riskLevel: "medium", summary: "S", rollbackPlan: "R" });
    const prompt = buildClaudeCodeTaskPrompt({ agentPlanSummary: "summary", orbTaskSummary: "orb", codeTask: task });
    expect(prompt).toContain("Acceptance criteria");
    expect(prompt).not.toContain("apiKey=abc");
  });

  it("ClaudeCode task uses isolation code semantics via provider", () => {
    const task = createOrbCodeTask({ taskId: "orb_7", planId: "plan_7", traceId: "trace_7", provider: "claudeCode", repository: "repo", title: "Task", objective: "obj", acceptanceCriteria: ["A"], riskLevel: "medium", summary: "S", rollbackPlan: "R" });
    expect(task.provider).toBe("claudeCode");
  });

  it("Codex task uses provider codex", () => {
    const task = createOrbCodeTask({ taskId: "orb_8", planId: "plan_8", traceId: "trace_8", provider: "codex", repository: "repo", title: "Task", objective: "obj", acceptanceCriteria: ["A"], riskLevel: "medium", summary: "S", rollbackPlan: "R" });
    const prompt = buildCodexTaskPrompt({ agentPlanSummary: "summary", orbTaskSummary: "orb", codeTask: task });
    expect(task.provider).toBe("codex");
    expect(prompt).toContain("Codex");
  });

  it("merged task cannot be modified", () => {
    const task = createOrbCodeTask({ taskId: "orb_9", planId: "plan_9", traceId: "trace_9", provider: "claudeCode", repository: "repo", title: "Task", objective: "obj", acceptanceCriteria: ["A"], riskLevel: "medium", summary: "S", rollbackPlan: "R" });
    approveCodeTask(task.codeTaskId);
    markCodeTaskRunning(task.codeTaskId);
    markCodeTaskMerged(task.codeTaskId, "abc1234");
    const after = attachCodeTaskPr(task.codeTaskId, "https://github.com/org/repo/pull/222");
    expect(after?.status).toBe("merged");
  });

  it("failed task records memory", () => {
    __unsafe_clearAllOrbMemoryForTests();
    const task = createOrbCodeTask({ taskId: "orb_10", planId: "plan_10", traceId: "trace_10", provider: "claudeCode", repository: "repo", title: "Task", objective: "obj", acceptanceCriteria: ["A"], riskLevel: "medium", summary: "S", rollbackPlan: "R" });
    markCodeTaskFailed(task.codeTaskId, "tests failed");
    const memories = getRecentOrbMemories({ limit: 20 });
    expect(memories.some(memory => memory.summary.includes("Code task failed"))).toBe(true);
  });

  it("completed task records memory", () => {
    __unsafe_clearAllOrbMemoryForTests();
    const task = createOrbCodeTask({ taskId: "orb_11", planId: "plan_11", traceId: "trace_11", provider: "claudeCode", repository: "repo", title: "Task", objective: "obj", acceptanceCriteria: ["A"], riskLevel: "medium", summary: "S", rollbackPlan: "R" });
    approveCodeTask(task.codeTaskId);
    markCodeTaskRunning(task.codeTaskId);
    markCodeTaskMerged(task.codeTaskId, "def5678");
    const memories = getRecentOrbMemories({ limit: 20 });
    expect(memories.some(memory => memory.summary.includes("Code task merged"))).toBe(true);
  });

  it("telemetry excludes secrets", () => {
    const task = createOrbCodeTask({ taskId: "orb_12", planId: "plan_12", traceId: "trace_12", provider: "claudeCode", repository: "repo", title: "Task", objective: "token=abc", acceptanceCriteria: ["A"], riskLevel: "medium", summary: "S", rollbackPlan: "R" });
    approveCodeTask(task.codeTaskId);
    const telemetry = getCodeTaskTelemetry(10);
    expect(JSON.stringify(telemetry)).not.toContain("token=");
  });

  it("rollback plan is required", () => {
    expect(() =>
      createOrbCodeTask({ taskId: "orb_13", planId: "plan_13", traceId: "trace_13", provider: "claudeCode", repository: "repo", title: "Task", objective: "obj", acceptanceCriteria: ["A"], riskLevel: "medium", summary: "S", rollbackPlan: "" })
    ).toThrow();
  });
});
