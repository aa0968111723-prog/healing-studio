/**
 * Unit tests for the upgraded plan-executor (步步) engine.
 *
 * Covers the in-memory plan store + step executor pipeline:
 *   - createPlan persists steps with stable ids and toolResultBindings
 *   - runPlan dispatches step toolNames through a mock OrbToolCall executor
 *     and propagates outputs via `${stepId.path}` refs to subsequent steps
 *   - retry policy: failed step honours maxAttempts + backoff
 *   - skipOnFail: failure converts to "skipped" without throwing
 *   - controlPlan(pause/cancel) flips the runner without mutating completed steps
 *   - getStatus reflects per-step state after a run
 *
 * We monkey-patch `executeOrbToolCalls` via dependency injection at module
 * scope so the real HTTP path never fires. The planFromGoal path (which
 * needs the LLM planner) is exercised in agent-planner.test.ts; here we
 * focus on the deterministic runner contract.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the global tool registry check + the executor BEFORE importing the
// module under test. The runner consults isKnownGlobalAgentTool, so we mark
// our mock tool names as known to keep the gate happy.
vi.mock("../../../shared/global-agent-tools", () => ({
  isKnownGlobalAgentTool: (name: string) => name.startsWith("studio.") || name.startsWith("mock."),
  getGlobalAgentTool: (name: string) => ({
    name,
    riskLevel: name.includes("high") ? "high" : "low",
    requiresHuman: false,
    allowedArgsSchema: {},
    executionTarget: "server-side",
  }),
}));

const executeOrbToolCallsMock = vi.fn();

vi.mock("../../../server/services/agentToolExecutor", () => ({
  executeOrbToolCalls: (...args: unknown[]) => executeOrbToolCallsMock(...args),
}));

// Don't actually run the LLM planner in this suite — planFromGoal flows
// through agentPlanner which is exercised separately.
vi.mock("../../../server/services/agentPlanner", () => ({
  runSchemaFirstAgentPlannerWithCritique: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
import {
  createPlan,
  runPlan,
  getStatus,
  controlPlan,
  executeStep,
  listRuns,
  _resetPlanStoreForTest,
  _getPlanForTest,
} from "../../../server/services/spiritTools/planExecutorTools";

beforeEach(() => {
  _resetPlanStoreForTest();
  executeOrbToolCallsMock.mockReset();
});

describe("createPlan", () => {
  it("rejects an empty step list", () => {
    const r = createPlan({ userId: 1, goal: "x", steps: [] });
    expect(r.success).toBe(false);
  });

  it("assigns stable ids and a default toolResultBinding", () => {
    const r = createPlan({
      userId: 1,
      goal: "test",
      steps: [
        { toolName: "studio.generateImage", toolArgs: { prompt: "hi" } },
        { toolName: "studio.generateVideo", toolArgs: { source: "${step1.url}" } },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.preview?.steps).toHaveLength(2);
    expect(r.preview?.steps[0].id).toBe("step1");
    expect(r.preview?.steps[1].id).toBe("step2");
    expect(r.preview?.steps[0].toolResultBinding).toBe("step1");
  });

  it("counts high-risk steps in the preview message", () => {
    const r = createPlan({
      userId: 1,
      goal: "test",
      steps: [
        { toolName: "studio.high-risk" },
        { toolName: "studio.generateImage" },
      ],
    });
    expect(r.highRiskCount).toBe(1);
  });
});

describe("runPlan", () => {
  it("executes each step's toolName via executeOrbToolCalls and marks completed", async () => {
    executeOrbToolCallsMock.mockResolvedValueOnce([
      { name: "studio.generateImage", ok: true, data: { url: "https://img.test/1.png" } },
    ]);
    executeOrbToolCallsMock.mockResolvedValueOnce([
      { name: "studio.generateVideo", ok: true, data: { url: "https://vid.test/1.mp4" } },
    ]);

    const created = createPlan({
      userId: 7,
      goal: "image then video",
      steps: [
        { toolName: "studio.generateImage", toolArgs: { prompt: "cat" } },
        { toolName: "studio.generateVideo", toolArgs: { source: "${step1.url}" } },
      ],
    });
    expect(created.success).toBe(true);

    await runPlan({ userId: 7, planId: created.planId!, async: false });
    const plan = _getPlanForTest(created.planId!);
    expect(plan?.status).toBe("completed");
    expect(plan?.steps[0].status).toBe("completed");
    expect(plan?.steps[1].status).toBe("completed");

    // Second call should have received the resolved `${step1.url}` as a
    // concrete URL string from step1's outputs.
    const secondCallArgs = executeOrbToolCallsMock.mock.calls[1][0];
    expect(secondCallArgs.calls[0].args).toEqual({ source: "https://img.test/1.png" });
  });

  it("rejects an unknown tool before dispatching it", async () => {
    const created = createPlan({
      userId: 7,
      goal: "test",
      steps: [{ toolName: "definitely.not.registered", toolArgs: {} }],
    });
    await runPlan({ userId: 7, planId: created.planId!, async: false });
    const plan = _getPlanForTest(created.planId!);
    expect(plan?.status).toBe("failed");
    expect(plan?.steps[0].error).toMatch(/unknown tool/);
    expect(executeOrbToolCallsMock).not.toHaveBeenCalled();
  });

  it("retries a transient failure up to maxAttempts before giving up", async () => {
    executeOrbToolCallsMock
      .mockResolvedValueOnce([{ name: "studio.generateImage", ok: false, error: "rate-limited" }])
      .mockResolvedValueOnce([{ name: "studio.generateImage", ok: false, error: "rate-limited" }])
      .mockResolvedValueOnce([
        { name: "studio.generateImage", ok: true, data: { url: "ok.png" } },
      ]);

    const created = createPlan({
      userId: 1,
      goal: "retry test",
      steps: [
        {
          toolName: "studio.generateImage",
          toolArgs: { prompt: "x" },
          retryPolicy: { maxAttempts: 3, backoffMs: 1 },
        },
      ],
    });
    await runPlan({ userId: 1, planId: created.planId!, async: false });
    const plan = _getPlanForTest(created.planId!);
    expect(plan?.status).toBe("completed");
    expect(plan?.steps[0].attempts).toBe(3);
  });

  it("skipOnFail converts a tool failure into a skipped step (no abort)", async () => {
    executeOrbToolCallsMock
      .mockResolvedValueOnce([{ name: "studio.generateImage", ok: false, error: "boom" }])
      .mockResolvedValueOnce([{ name: "studio.generateVideo", ok: true, data: { url: "v.mp4" } }]);

    const created = createPlan({
      userId: 1,
      goal: "skip test",
      steps: [
        {
          toolName: "studio.generateImage",
          retryPolicy: { maxAttempts: 1, skipOnFail: true },
        },
        { toolName: "studio.generateVideo" },
      ],
    });
    await runPlan({ userId: 1, planId: created.planId!, async: false });
    const plan = _getPlanForTest(created.planId!);
    expect(plan?.steps[0].status).toBe("skipped");
    expect(plan?.steps[1].status).toBe("completed");
    expect(plan?.status).toBe("completed");
  });

  it("a UI-only step (no toolName) marks completed without calling executor", async () => {
    const created = createPlan({
      userId: 1,
      goal: "ui only",
      steps: [
        { label: "Go to /image-studio", path: "/image-studio", actionType: "navigate", payload: "" },
        { toolName: "studio.generateImage" },
      ],
    });
    executeOrbToolCallsMock.mockResolvedValueOnce([
      { name: "studio.generateImage", ok: true, data: { url: "ok.png" } },
    ]);
    await runPlan({ userId: 1, planId: created.planId!, async: false });
    const plan = _getPlanForTest(created.planId!);
    expect(plan?.steps[0].status).toBe("completed");
    expect(plan?.steps[1].status).toBe("completed");
    // Only the tool step should have hit the executor.
    expect(executeOrbToolCallsMock).toHaveBeenCalledTimes(1);
  });

  it("denies access when userId does not match", async () => {
    const created = createPlan({ userId: 1, goal: "x", steps: [{ toolName: "studio.generateImage" }] });
    const r = await runPlan({ userId: 999, planId: created.planId!, async: false });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/權限/);
  });
});

describe("getStatus + listRuns", () => {
  it("returns per-step status and progress percentage", async () => {
    executeOrbToolCallsMock.mockResolvedValueOnce([
      { name: "studio.generateImage", ok: true, data: { url: "ok.png" } },
    ]);
    const created = createPlan({
      userId: 5,
      goal: "status test",
      steps: [{ toolName: "studio.generateImage" }],
    });
    await runPlan({ userId: 5, planId: created.planId!, async: false });
    const s = getStatus({ userId: 5, planId: created.planId! });
    expect(s.success).toBe(true);
    expect(s.totalSteps).toBe(1);
    expect(s.progress).toBe(100);
    expect(s.steps?.[0].outputs).toEqual({ url: "ok.png" });
  });

  it("listRuns returns plans for the matching user only", async () => {
    createPlan({ userId: 1, goal: "a", steps: [{ toolName: "studio.generateImage" }] });
    createPlan({ userId: 2, goal: "b", steps: [{ toolName: "studio.generateImage" }] });
    const own = listRuns({ userId: 1 });
    expect(own.runs).toHaveLength(1);
    expect(own.runs[0].goal).toBe("a");
  });
});

describe("controlPlan", () => {
  it("cancel on a draft plan marks it cancelled immediately", () => {
    const created = createPlan({ userId: 3, goal: "x", steps: [{ toolName: "studio.generateImage" }] });
    const r = controlPlan({ userId: 3, planId: created.planId!, action: "cancel" });
    expect(r.success).toBe(true);
    expect(r.status).toBe("cancelled");
  });

  it("pause is rejected when plan is not running", () => {
    const created = createPlan({ userId: 3, goal: "x", steps: [{ toolName: "studio.generateImage" }] });
    const r = controlPlan({ userId: 3, planId: created.planId!, action: "pause" });
    expect(r.success).toBe(false);
  });
});

describe("high-risk approval gate (P1 review fix)", () => {
  it("refuses to run a high-risk plan without explicit approveHighRisk", async () => {
    const created = createPlan({
      userId: 11,
      goal: "high-risk",
      steps: [{ toolName: "studio.high-risk-thing" }],
    });
    const r = await runPlan({ userId: 11, planId: created.planId!, async: false });
    expect(r.success).toBe(false);
    expect(r.status).toBe("awaiting_approval");
    expect(r.highRiskCount).toBe(1);
    // Critically: the executor must NOT have dispatched anything.
    expect(executeOrbToolCallsMock).not.toHaveBeenCalled();
  });

  it("runs a high-risk plan once approveHighRisk is supplied", async () => {
    executeOrbToolCallsMock.mockResolvedValueOnce([
      { name: "studio.high-risk-thing", ok: true, data: { url: "ok" } },
    ]);
    const created = createPlan({
      userId: 12,
      goal: "approved high-risk",
      steps: [{ toolName: "studio.high-risk-thing" }],
    });
    const r = await runPlan({
      userId: 12,
      planId: created.planId!,
      async: false,
      approveHighRisk: true,
    });
    expect(r.success).toBe(true);
    expect(r.status).toBe("completed");
    // The dispatched call should have approved=true (the only path that
    // reaches the executor for a high-risk step).
    expect(executeOrbToolCallsMock).toHaveBeenCalledTimes(1);
    expect(executeOrbToolCallsMock.mock.calls[0][0].approved).toBe(true);
  });

  it("low-risk-only plans run without approveHighRisk", async () => {
    executeOrbToolCallsMock.mockResolvedValueOnce([
      { name: "studio.generateImage", ok: true, data: { url: "ok" } },
    ]);
    const created = createPlan({
      userId: 13,
      goal: "low-risk only",
      steps: [{ toolName: "studio.generateImage" }],
    });
    const r = await runPlan({ userId: 13, planId: created.planId!, async: false });
    expect(r.success).toBe(true);
    expect(r.status).toBe("completed");
    // Low-risk step: approved is the negation of isStepHighRisk, so still true.
    expect(executeOrbToolCallsMock.mock.calls[0][0].approved).toBe(true);
  });
});

describe("executeStep (single-step debug)", () => {
  it("runs one step in isolation and reports its status", async () => {
    executeOrbToolCallsMock.mockResolvedValueOnce([
      { name: "studio.generateImage", ok: true, data: { url: "single.png" } },
    ]);
    const created = createPlan({
      userId: 8,
      goal: "single step",
      steps: [
        { toolName: "studio.generateImage", toolArgs: { prompt: "x" } },
        { toolName: "studio.generateVideo" },
      ],
    });
    const r = await executeStep({ userId: 8, planId: created.planId!, stepIndex: 0 });
    expect(r.success).toBe(true);
    expect(r.status).toBe("completed");
    expect(r.outputs).toEqual({ url: "single.png" });
    // Second step should remain pending — executeStep only runs the asked one.
    const status = getStatus({ userId: 8, planId: created.planId! });
    expect(status.steps?.[1].status).toBe("pending");
  });
});
