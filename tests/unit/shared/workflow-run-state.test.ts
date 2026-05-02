/**
 * tests/unit/shared/workflow-run-state.test.ts
 *
 * Task 3 — verify run-state persistence + resume:
 *   1. Pure helpers (createWorkflowRunState, markStepCompleted, appendToolResult).
 *   2. Orchestrator persists state after each step (success / fail).
 *   3. resumeFromRunId skips already-completed steps.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  AgentActionResult,
  RunWorkflowAction,
} from "../../../shared/agent-actions";
import type { GlobalAgentExecutionContext } from "../../../shared/global-agent-orchestrator";
import { executeGlobalWorkflow } from "../../../shared/global-agent-orchestrator";
import {
  appendToolResult,
  createWorkflowRunState,
  isStepCompleted,
  markStepCompleted,
  type WorkflowRunState,
} from "../../../shared/workflow-run-state";

function makeCtx(overrides: Partial<GlobalAgentExecutionContext> = {}): GlobalAgentExecutionContext {
  return {
    navigate: vi.fn(),
    dispatch: vi.fn(async (): Promise<AgentActionResult> => ({ ok: true })),
    waitAfterNavigateMs: 0,
    ...overrides,
  };
}

describe("workflow run-state pure helpers", () => {
  it("createWorkflowRunState seeds empty completedStepIds + perStepToolResults", () => {
    const state = createWorkflowRunState({
      runId: "run_1",
      workflowName: "test",
      totalSteps: 3,
      startedAt: 1000,
    });
    expect(state).toEqual({
      runId: "run_1",
      workflowName: "test",
      totalSteps: 3,
      completedStepIds: [],
      perStepToolResults: [],
      startedAt: 1000,
      updatedAt: 1000,
    });
  });

  it("markStepCompleted dedups and bumps updatedAt", () => {
    const a = createWorkflowRunState({ runId: "r", workflowName: "n", totalSteps: 2, startedAt: 1 });
    const b = markStepCompleted(a, "step1", 5);
    expect(b.completedStepIds).toEqual(["step1"]);
    expect(b.updatedAt).toBe(5);
    const c = markStepCompleted(b, "step1", 9);
    // No duplicate, but updatedAt bumps.
    expect(c.completedStepIds).toEqual(["step1"]);
    expect(c.updatedAt).toBe(9);
  });

  it("appendToolResult merges into the existing entry per stepId", () => {
    let s: WorkflowRunState = createWorkflowRunState({
      runId: "r",
      workflowName: "n",
      totalSteps: 1,
      startedAt: 1,
    });
    s = appendToolResult(s, "step1", { ok: true, data: { v: 1 } }, 2);
    s = appendToolResult(s, "step1", { ok: false }, 3);
    expect(s.perStepToolResults).toHaveLength(1);
    expect(s.perStepToolResults[0]).toEqual({
      stepId: "step1",
      toolResults: [
        { ok: true, data: { v: 1 } },
        { ok: false },
      ],
    });
    expect(s.updatedAt).toBe(3);
  });

  it("isStepCompleted handles null state", () => {
    expect(isStepCompleted(null, "x")).toBe(false);
    expect(isStepCompleted(undefined, "x")).toBe(false);
    const s = markStepCompleted(
      createWorkflowRunState({ runId: "r", workflowName: "n", totalSteps: 1, startedAt: 1 }),
      "y",
    );
    expect(isStepCompleted(s, "y")).toBe(true);
    expect(isStepCompleted(s, "z")).toBe(false);
  });
});

describe("workflow run-state orchestrator integration", () => {
  it("persistRunState fires after each successful step", async () => {
    const persistRunState = vi.fn(async () => {});
    const callTool = vi.fn(async () => ({ ok: true, data: { ok: true } }));
    const ctx = makeCtx({ callTool, persistRunState });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "persist test",
      steps: [
        {
          id: "step1",
          actionType: "",
          payload: "",
          label: "first",
          toolName: "media.transcribe",
          toolArgs: { url: "a" },
        },
        {
          id: "step2",
          actionType: "",
          payload: "",
          label: "second",
          toolName: "media.caption",
          toolArgs: { transcript: "x" },
        },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(true);
    // Two persist calls for two successful steps.
    expect(persistRunState.mock.calls.length).toBeGreaterThanOrEqual(2);
    const lastCall = persistRunState.mock.calls.at(-1)?.[0] as WorkflowRunState;
    expect(lastCall.completedStepIds).toEqual(["step1", "step2"]);
    expect(lastCall.perStepToolResults).toHaveLength(2);
  });

  it("persistRunState records failedAt + failReason on abort", async () => {
    const persistRunState = vi.fn(async () => {});
    const callTool = vi.fn(async () => ({ ok: false, reason: "boom" }));
    const ctx = makeCtx({ callTool, persistRunState });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "fail-persist test",
      steps: [
        {
          id: "step1",
          actionType: "",
          payload: "",
          label: "fail me",
          toolName: "media.transcribe",
          toolArgs: { url: "a" },
        },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(false);
    const lastCall = persistRunState.mock.calls.at(-1)?.[0] as WorkflowRunState;
    expect(lastCall.failedAt).toBe("step1");
    expect(lastCall.failReason).toMatch(/boom/);
  });

  it("resumeFromRunId skips already-completed steps", async () => {
    const callTool = vi.fn(async () => ({ ok: true, data: { ok: true } }));
    const persisted: WorkflowRunState = {
      runId: "old-run",
      workflowName: "resume test",
      totalSteps: 2,
      completedStepIds: ["step1"],
      perStepToolResults: [
        { stepId: "step1", toolResults: [{ ok: true, data: { transcript: "cached" } }] },
      ],
      startedAt: 1,
      updatedAt: 1,
    };
    const loadRunState = vi.fn(async (id: string) => (id === "old-run" ? persisted : null));
    const persistRunState = vi.fn(async () => {});
    const ctx = makeCtx({
      callTool,
      loadRunState,
      persistRunState,
      resumeFromRunId: "old-run",
    });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "resume test",
      steps: [
        {
          id: "step1",
          actionType: "",
          payload: "",
          label: "should be skipped",
          toolName: "media.transcribe",
          toolArgs: { url: "a" },
        },
        {
          id: "step2",
          actionType: "",
          payload: "",
          label: "runs fresh — uses cached step1 result",
          toolName: "media.caption",
          toolArgs: { transcript: "${step1.transcript}" },
        },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(true);
    expect(loadRunState).toHaveBeenCalledWith("old-run");
    expect(callTool).toHaveBeenCalledTimes(1);
    // The single tool call should be step2, with the resolved transcript from
    // the persisted step1 result.
    expect(callTool).toHaveBeenCalledWith("media.caption", { transcript: "cached" });
  });
});
