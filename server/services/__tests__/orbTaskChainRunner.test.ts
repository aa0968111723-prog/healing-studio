import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runOrbTaskWithContinuationLoop } from "../orbTaskChainRunner";
import {
  _resetOrbTaskPlannerContextStoreForTests,
  setOrbTaskPlannerContext,
} from "../orbTaskPlannerContextStore";
import type { RunOrbTaskResult } from "../orbTaskOrchestrator";
import type { TaskObservation } from "../orbTaskObserver";
import type { OrbApiTool } from "../agentToolExecutor";

const tools: OrbApiTool[] = [];
const userId = 42;
const userRole = "user";

function makeRunResult(
  partial: Partial<RunOrbTaskResult> = {}
): RunOrbTaskResult {
  return {
    taskId: "t-x",
    outcome: "completed",
    stepsRun: 1,
    perStepToolResults: [],
    finalTask: null,
    finalAgentTask: null,
    ...partial,
  };
}

beforeEach(() => {
  _resetOrbTaskPlannerContextStoreForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("runOrbTaskWithContinuationLoop", () => {
  it("stops after a single iteration when observer says complete", async () => {
    const runTask = vi.fn(async () => makeRunResult({ taskId: "t1" }));
    const invokeObserver = vi.fn(async () => ({
      kind: "complete" as const,
      userMessage: "done",
    } satisfies TaskObservation));
    const invokePlanner = vi.fn();

    const out = await runOrbTaskWithContinuationLoop({
      initialTaskId: "t1",
      userId,
      userRole,
      tools,
      runTask,
      invokeObserver,
      invokePlanner,
    });

    expect(out.stopReason).toBe("completed");
    expect(out.iterations).toHaveLength(1);
    expect(out.finalTaskId).toBe("t1");
    expect(invokePlanner).not.toHaveBeenCalled();
  });

  it("stops with abort when observer says abort", async () => {
    const runTask = vi.fn(async () =>
      makeRunResult({ taskId: "t1", outcome: "failed", reason: "tool" })
    );
    const invokeObserver = vi.fn(async () => ({
      kind: "abort" as const,
      userMessage: "broken",
      failureCategory: "tool_error" as const,
    } satisfies TaskObservation));
    const invokePlanner = vi.fn();

    const out = await runOrbTaskWithContinuationLoop({
      initialTaskId: "t1",
      userId,
      userRole,
      tools,
      runTask,
      invokeObserver,
      invokePlanner,
    });

    expect(out.stopReason).toBe("abort");
    expect(out.iterations).toHaveLength(1);
    expect(invokePlanner).not.toHaveBeenCalled();
  });

  it("stops with needs_user when observer says needs_user", async () => {
    const runTask = vi.fn(async () =>
      makeRunResult({ taskId: "t1", outcome: "awaiting_approval" })
    );
    const invokeObserver = vi.fn(async () => ({
      kind: "needs_user" as const,
      question: "你想要哪一種？",
    } satisfies TaskObservation));
    const out = await runOrbTaskWithContinuationLoop({
      initialTaskId: "t1",
      userId,
      userRole,
      tools,
      runTask,
      invokeObserver,
      invokePlanner: vi.fn(),
    });
    expect(out.stopReason).toBe("needs_user");
  });

  it("exits no_continuation_context when planner context not stashed", async () => {
    const runTask = vi.fn(async () =>
      makeRunResult({ taskId: "t1", outcome: "failed", reason: "x" })
    );
    const invokeObserver = vi.fn(async () => ({
      kind: "continue" as const,
      reason: "retry with different model",
      suggestedNextAction: "switch model",
    } satisfies TaskObservation));
    const invokePlanner = vi.fn();

    const out = await runOrbTaskWithContinuationLoop({
      initialTaskId: "t1",
      userId,
      userRole,
      tools,
      runTask,
      invokeObserver,
      invokePlanner,
    });
    expect(out.stopReason).toBe("no_continuation_context");
    expect(invokePlanner).not.toHaveBeenCalled();
  });

  it("hits max_iterations when observer keeps saying continue but cap is 1", async () => {
    setOrbTaskPlannerContext("t1", {
      userId,
      userRole,
      messages: [{ role: "user", content: "幫我做" }],
    });
    const runTask = vi.fn(async () =>
      makeRunResult({ taskId: "t1", outcome: "failed", reason: "x" })
    );
    const invokeObserver = vi.fn(async () => ({
      kind: "continue" as const,
      reason: "should retry",
      suggestedNextAction: "do it again",
    } satisfies TaskObservation));

    const out = await runOrbTaskWithContinuationLoop({
      initialTaskId: "t1",
      userId,
      userRole,
      tools,
      runTask,
      invokeObserver,
      invokePlanner: vi.fn(),
      maxIterations: 1,
    });

    expect(out.stopReason).toBe("max_iterations");
    expect(out.iterations).toHaveLength(1);
  });

  it("exits planner_no_task when replan planner returns clarification", async () => {
    setOrbTaskPlannerContext("t1", {
      userId,
      userRole,
      messages: [{ role: "user", content: "做圖" }],
    });
    const runTask = vi.fn(async () =>
      makeRunResult({ taskId: "t1", outcome: "failed", reason: "x" })
    );
    const invokeObserver = vi.fn(async () => ({
      kind: "continue" as const,
      reason: "should retry",
      suggestedNextAction: "do it again",
    } satisfies TaskObservation));
    // Planner returns clarification (status=clarification ≠ tasked) → no new task
    const invokePlanner = vi.fn(async () => ({
      status: "clarification",
      task: null,
      actions: [],
      warnings: [],
      preferredEngine: undefined,
      version: "agent-plan.v3",
      plan: null,
      rawContent: "{}",
      plannerUsed: true,
      usedMultimodalPlanner: false,
    })) as unknown as Parameters<typeof runOrbTaskWithContinuationLoop>[0]["invokePlanner"];

    const out = await runOrbTaskWithContinuationLoop({
      initialTaskId: "t1",
      userId,
      userRole,
      tools,
      runTask,
      invokeObserver,
      invokePlanner,
      maxIterations: 2,
    });

    expect(out.stopReason).toBe("planner_no_task");
    expect(out.iterations).toHaveLength(1);
  });

  it("clamps maxIterations to hard cap", async () => {
    const runTask = vi.fn(async () => makeRunResult({ outcome: "completed" }));
    const invokeObserver = vi.fn(async () => ({
      kind: "complete" as const,
      userMessage: "ok",
    } satisfies TaskObservation));
    const out = await runOrbTaskWithContinuationLoop({
      initialTaskId: "t1",
      userId,
      userRole,
      tools,
      runTask,
      invokeObserver,
      invokePlanner: vi.fn(),
      maxIterations: 9999,
    });
    expect(out.iterations).toHaveLength(1);
    expect(out.stopReason).toBe("completed");
  });

  it("survives observer crash and exits with abort", async () => {
    const runTask = vi.fn(async () => makeRunResult({ outcome: "completed" }));
    const invokeObserver = vi.fn(async () => {
      throw new Error("obs broke");
    });
    const out = await runOrbTaskWithContinuationLoop({
      initialTaskId: "t1",
      userId,
      userRole,
      tools,
      runTask,
      invokeObserver,
      invokePlanner: vi.fn(),
    });
    expect(out.stopReason).toBe("abort");
    expect(out.iterations).toHaveLength(1);
    expect(out.iterations[0].observation).toBeNull();
  });
});
