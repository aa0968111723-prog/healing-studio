import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runOrbTaskWithContinuationLoop } from "../orbTaskChainRunner";
import {
  _resetOrbTaskPlannerContextStoreForTests,
  setOrbTaskPlannerContext,
} from "../orbTaskPlannerContextStore";
import type { RunOrbTaskResult } from "../orbTaskOrchestrator";
import type { TaskObservation } from "../orbTaskObserver";
import type { OrbApiTool } from "../agentToolExecutor";
import { setGenerationEventBusForTests } from "../../generationEvents";
import type { GenerationEvent } from "../../generationEvents";
import { getRecentOrbTaskMemory } from "../orbTaskMemory";
import {
  _resetOrbTaskPageStateStoreForTests,
  appendOrbTaskPageState,
} from "../orbTaskPageStateStore";

const tools: OrbApiTool[] = [];
const userId = 42;
const userRole = "user";

/**
 * Install a fresh EventEmitter so each test can read exactly what the
 * chain runner emitted without cross-talk from singleton state.
 * Returns an array that captures every emitted GenerationEvent and a
 * teardown that restores the previous bus.
 */
function captureGenerationEvents(): {
  events: GenerationEvent[];
  restore: () => void;
} {
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const events: GenerationEvent[] = [];
  bus.on("generation", (event: GenerationEvent) => {
    events.push(event);
  });
  setGenerationEventBusForTests(bus);
  return {
    events,
    restore: () => setGenerationEventBusForTests(new EventEmitter()),
  };
}

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
  _resetOrbTaskPageStateStoreForTests();
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

describe("orbTaskChainRunner telemetry", () => {
  it("emits chain_started and chain_completed with completed stopReason", async () => {
    const cap = captureGenerationEvents();
    try {
      const runTask = vi.fn(async () => makeRunResult({ taskId: "t1" }));
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
        maxIterations: 2,
      });

      const started = cap.events.find(e => e.type === "chain_started");
      const completed = cap.events.find(e => e.type === "chain_completed");
      expect(started).toBeDefined();
      expect(completed).toBeDefined();
      // Type-narrow for assertions on shape
      if (started?.type === "chain_started") {
        expect(started.taskId).toBe("t1");
        expect(started.userId).toBe(userId);
        expect(started.maxIterations).toBe(2);
      }
      if (completed?.type === "chain_completed") {
        expect(completed.stopReason).toBe("completed");
        expect(completed.iterations).toBe(1);
        expect(completed.taskId).toBe("t1");
        expect(completed.finalTaskId).toBe(out.finalTaskId);
        expect(completed.durationMs).toBeGreaterThanOrEqual(0);
      }
    } finally {
      cap.restore();
    }
  });

  it("clamps maxIterations in chain_started telemetry", async () => {
    const cap = captureGenerationEvents();
    try {
      await runOrbTaskWithContinuationLoop({
        initialTaskId: "t1",
        userId,
        userRole,
        tools,
        runTask: vi.fn(async () => makeRunResult()),
        invokeObserver: vi.fn(async () => ({
          kind: "complete" as const,
          userMessage: "ok",
        } satisfies TaskObservation)),
        invokePlanner: vi.fn(),
        maxIterations: 9999, // hard-cap is 4
      });
      const started = cap.events.find(e => e.type === "chain_started");
      if (started?.type === "chain_started") {
        expect(started.maxIterations).toBeLessThanOrEqual(4);
      } else {
        throw new Error("chain_started not emitted");
      }
    } finally {
      cap.restore();
    }
  });

  it("emits chain_completed with planner_no_task when replan returns clarification", async () => {
    setOrbTaskPlannerContext("t1", {
      userId,
      userRole,
      messages: [{ role: "user", content: "x" }],
    });
    const cap = captureGenerationEvents();
    try {
      await runOrbTaskWithContinuationLoop({
        initialTaskId: "t1",
        userId,
        userRole,
        tools,
        runTask: vi.fn(async () =>
          makeRunResult({ taskId: "t1", outcome: "failed", reason: "x" })
        ),
        invokeObserver: vi.fn(async () => ({
          kind: "continue" as const,
          reason: "retry",
          suggestedNextAction: "do",
        } satisfies TaskObservation)),
        invokePlanner: vi.fn(async () => ({
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
        })) as unknown as Parameters<typeof runOrbTaskWithContinuationLoop>[0]["invokePlanner"],
        maxIterations: 2,
      });
      const completed = cap.events.find(e => e.type === "chain_completed");
      if (completed?.type === "chain_completed") {
        expect(completed.stopReason).toBe("planner_no_task");
      } else {
        throw new Error("chain_completed not emitted");
      }
    } finally {
      cap.restore();
    }
  });
});

describe("orbTaskChainRunner memory integration", () => {
  it("records a chain-level memory entry on completion", async () => {
    const before = getRecentOrbTaskMemory(50).length;
    await runOrbTaskWithContinuationLoop({
      initialTaskId: "t-mem-success",
      userId,
      userRole,
      tools,
      runTask: vi.fn(async () => makeRunResult()),
      invokeObserver: vi.fn(async () => ({
        kind: "complete" as const,
        userMessage: "ok",
      } satisfies TaskObservation)),
      invokePlanner: vi.fn(),
    });
    const recent = getRecentOrbTaskMemory(50);
    expect(recent.length).toBeGreaterThan(before);
    // The newest entry is unshifted to the front; find the one from this run.
    const ours = recent.find(r => r.taskId === "t-mem-success");
    expect(ours).toBeDefined();
    expect(ours?.outcome).toBe("success");
  });

  it("records failure with merged failedReason on abort", async () => {
    await runOrbTaskWithContinuationLoop({
      initialTaskId: "t-mem-fail",
      userId,
      userRole,
      tools,
      runTask: vi.fn(async () =>
        makeRunResult({ outcome: "failed", reason: "tool-broke" })
      ),
      invokeObserver: vi.fn(async () => ({
        kind: "abort" as const,
        userMessage: "stopped",
        failureCategory: "tool_error" as const,
      } satisfies TaskObservation)),
      invokePlanner: vi.fn(),
    });
    const ours = getRecentOrbTaskMemory(50).find(r => r.taskId === "t-mem-fail");
    expect(ours?.outcome).toBe("failure");
    expect(ours?.failedReason).toContain("observer:tool_error");
  });

  it("records blocked on needs_user", async () => {
    await runOrbTaskWithContinuationLoop({
      initialTaskId: "t-mem-needs-user",
      userId,
      userRole,
      tools,
      runTask: vi.fn(async () =>
        makeRunResult({ outcome: "awaiting_approval" })
      ),
      invokeObserver: vi.fn(async () => ({
        kind: "needs_user" as const,
        question: "你想要哪一種？",
      } satisfies TaskObservation)),
      invokePlanner: vi.fn(),
    });
    const ours = getRecentOrbTaskMemory(50).find(r => r.taskId === "t-mem-needs-user");
    expect(ours?.outcome).toBe("blocked");
  });

  it("clamps maxIterations from env when caller doesn't override", async () => {
    const prev = process.env.ORB_OBSERVATION_LOOP_MAX_ITERATIONS;
    process.env.ORB_OBSERVATION_LOOP_MAX_ITERATIONS = "3";
    // We can't directly observe maxIterations, but emitted chain_started
    // carries the clamped value.
    const cap = captureGenerationEvents();
    try {
      await runOrbTaskWithContinuationLoop({
        initialTaskId: "t-env",
        userId,
        userRole,
        tools,
        runTask: vi.fn(async () => makeRunResult()),
        invokeObserver: vi.fn(async () => ({
          kind: "complete" as const,
          userMessage: "ok",
        } satisfies TaskObservation)),
        invokePlanner: vi.fn(),
        // No maxIterations passed — env default takes over.
      });
      const started = cap.events.find(e => e.type === "chain_started");
      if (started?.type === "chain_started") {
        expect(started.maxIterations).toBe(3);
      } else {
        throw new Error("chain_started not emitted");
      }
    } finally {
      cap.restore();
      if (prev === undefined) {
        delete process.env.ORB_OBSERVATION_LOOP_MAX_ITERATIONS;
      } else {
        process.env.ORB_OBSERVATION_LOOP_MAX_ITERATIONS = prev;
      }
    }
  });

  it("attaches per-iteration page-state snapshots and threads them into memory failedReason", async () => {
    appendOrbTaskPageState("t-snap", {
      at: 1,
      pageId: "video-studio",
      actionType: "fillPrompt",
      state: { promptApplied: false, promptQueuedForTab: "v2v" },
    });
    appendOrbTaskPageState("t-snap", {
      at: 2,
      pageId: "video-studio",
      actionType: "submit",
      state: { submitted: false, waitingFor: "tab" },
    });

    const out = await runOrbTaskWithContinuationLoop({
      initialTaskId: "t-snap",
      userId,
      userRole,
      tools,
      runTask: vi.fn(async () =>
        makeRunResult({
          outcome: "failed",
          taskId: "t-snap",
          reason: "queued",
        })
      ),
      invokeObserver: vi.fn(async () => ({
        kind: "abort" as const,
        userMessage: "stuck",
        failureCategory: "missing_input" as const,
      } satisfies TaskObservation)),
      invokePlanner: vi.fn(),
    });

    // Snapshots attached to the last iteration.
    expect(out.iterations[0].pageStateSnapshots).toBeDefined();
    expect(out.iterations[0].pageStateSnapshots).toHaveLength(2);

    // Threaded into the recorded memory's failedReason so a future
    // planner invocation can recognise the trap.
    const ours = getRecentOrbTaskMemory(50).find(r => r.taskId === "t-snap");
    expect(ours?.failedReason).toContain("page:[#0");
    expect(ours?.failedReason).toContain("video-studio");
  });
});
