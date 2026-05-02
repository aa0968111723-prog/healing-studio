/**
 * tests/unit/shared/orb-cost-governor.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import type {
  AgentActionResult,
  AgentWorkflowStep,
  RunWorkflowAction,
} from "../../../shared/agent-actions";
import type { GlobalAgentExecutionContext } from "../../../shared/global-agent-orchestrator";
import { executeGlobalWorkflow } from "../../../shared/global-agent-orchestrator";
import {
  estimateWorkflowCost,
  formatCostEstimateForUser,
  shouldRequireBudgetConfirm,
  type CostEntry,
  type CostTable,
} from "../../../shared/orb-cost-governor";

const TEST_TABLE: CostTable = new Map<string, CostEntry>([
  ["studio.generateImage", { credits: 10, durationMs: 12_000, tier: "cheap" }],
  ["studio.generateVideo", { credits: 60, durationMs: 90_000, tier: "expensive" }],
  ["studio.trainLora", { credits: 200, durationMs: 600_000, tier: "premium" }],
]);

const wf = (steps: AgentWorkflowStep[]): RunWorkflowAction => ({
  type: "runWorkflow",
  name: "test",
  steps,
});

describe("estimateWorkflowCost", () => {
  it("sums credits + duration and tracks max tier across tool steps", () => {
    const e = estimateWorkflowCost(
      [
        {
          actionType: "",
          payload: "",
          label: "image",
          toolName: "studio.generateImage",
          toolArgs: { prompt: "x" },
        },
        {
          actionType: "",
          payload: "",
          label: "video",
          toolName: "studio.generateVideo",
          toolArgs: { prompt: "x" },
        },
      ],
      TEST_TABLE
    );
    expect(e.totalCredits).toBe(70);
    expect(e.totalDurationMs).toBe(102_000);
    expect(e.maxTier).toBe("expensive");
    expect(e.hasBillableStep).toBe(true);
    expect(e.breakdown).toHaveLength(2);
  });

  it("treats UI submit as a billable cheap step", () => {
    const e = estimateWorkflowCost(
      [
        { path: "/studio", actionType: "fillPrompt", payload: "x", label: "fill" },
        { path: "/studio", actionType: "submit", payload: "", label: "submit" },
      ],
      TEST_TABLE
    );
    expect(e.hasBillableStep).toBe(true);
    expect(e.breakdown[0].source).toBe("ui-other");
    expect(e.breakdown[1].source).toBe("ui-submit");
  });

  it("UI-only flows (no submit, no tool) are NOT billable", () => {
    const e = estimateWorkflowCost(
      [
        { path: "/studio", actionType: "fillPrompt", payload: "x", label: "fill" },
        { path: "/studio", actionType: "setModel", payload: "fal-ai/flux", label: "model" },
      ],
      TEST_TABLE
    );
    expect(e.hasBillableStep).toBe(false);
    expect(e.totalCredits).toBe(0);
  });

  it("falls back to medium tier for known but un-priced tools", () => {
    const e = estimateWorkflowCost(
      [
        {
          actionType: "",
          payload: "",
          label: "x",
          toolName: "studio.generateAudio", // priced in DEFAULT but not in TEST_TABLE
          toolArgs: { prompt: "x" },
        },
      ],
      TEST_TABLE
    );
    expect(e.breakdown[0].cost.tier).toBe("medium"); // known tool fallback
  });
});

describe("shouldRequireBudgetConfirm", () => {
  const baseEstimate = estimateWorkflowCost(
    [
      {
        actionType: "",
        payload: "",
        label: "video",
        toolName: "studio.generateVideo",
        toolArgs: { prompt: "x" },
      },
    ],
    TEST_TABLE
  );

  it("requires confirm when remaining credits < estimate", () => {
    const r = shouldRequireBudgetConfirm(baseEstimate, { remainingCredits: 30 });
    expect(r.required).toBe(true);
    expect(r.reason).toMatch(/超過剩餘/);
  });

  it("requires confirm when total exceeds per-workflow cap", () => {
    const r = shouldRequireBudgetConfirm(baseEstimate, { perWorkflowCap: 50 });
    expect(r.required).toBe(true);
    expect(r.reason).toMatch(/單次上限/);
  });

  it("requires confirm when tier-floor crosses the threshold", () => {
    const r = shouldRequireBudgetConfirm(baseEstimate, { confirmAtTierOrAbove: "medium" });
    expect(r.required).toBe(true);
    expect(r.reason).toMatch(/最高風險/);
  });

  it("alwaysAllow short-circuits", () => {
    const r = shouldRequireBudgetConfirm(baseEstimate, { alwaysAllow: true });
    expect(r.required).toBe(false);
  });

  it("UI-only flows pass without confirmation", () => {
    const e = estimateWorkflowCost(
      [{ path: "/x", actionType: "fillPrompt", payload: "x", label: "x" }],
      TEST_TABLE
    );
    const r = shouldRequireBudgetConfirm(e, { perWorkflowCap: 0 });
    expect(r.required).toBe(false);
  });
});

describe("formatCostEstimateForUser", () => {
  it("includes credits + minutes + max tier and step lines", () => {
    const e = estimateWorkflowCost(
      [
        {
          actionType: "",
          payload: "",
          label: "video",
          toolName: "studio.generateVideo",
          toolArgs: { prompt: "x" },
        },
      ],
      TEST_TABLE
    );
    const text = formatCostEstimateForUser(e);
    expect(text).toMatch(/預估費用/);
    expect(text).toMatch(/分鐘/);
    expect(text).toMatch(/昂貴/);
    expect(text).toMatch(/video/);
  });
});

describe("orchestrator integration with estimateAndConfirmBudget", () => {
  function makeCtx(overrides: Partial<GlobalAgentExecutionContext> = {}): GlobalAgentExecutionContext {
    return {
      navigate: vi.fn(),
      dispatch: vi.fn(async (): Promise<AgentActionResult> => ({ ok: true })),
      waitAfterNavigateMs: 0,
      ...overrides,
    };
  }

  it("aborts the workflow when the gate returns abort", async () => {
    const dispatch = vi.fn(async (): Promise<AgentActionResult> => ({ ok: true }));
    const ctx = makeCtx({
      dispatch,
      estimateAndConfirmBudget: vi.fn(async () => ({
        decision: "abort" as const,
        reason: "out of credits",
      })),
    });
    const res = await executeGlobalWorkflow(
      wf([{ path: "/studio", actionType: "fillPrompt", payload: "x", label: "fill" }]),
      ctx
    );
    expect(res.ok).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(res.reason).toMatch(/out of credits/);
  });

  it("upgrades to step-by-step when the gate returns confirm", async () => {
    const dispatch = vi.fn(async (): Promise<AgentActionResult> => ({ ok: true }));
    const confirmStep = vi.fn(async () => "skip" as const);
    const ctx = makeCtx({
      dispatch,
      confirmStep,
      estimateAndConfirmBudget: vi.fn(async () => ({ decision: "confirm" as const })),
    });
    const res = await executeGlobalWorkflow(
      wf([
        { path: "/studio", actionType: "fillPrompt", payload: "x", label: "fill" },
        { path: "/studio", actionType: "submit", payload: "", label: "submit" },
      ]),
      ctx
    );
    expect(res.ok).toBe(true);
    // confirmStep should have been called for both steps because we
    // upgraded to step-by-step.
    expect(confirmStep).toHaveBeenCalledTimes(2);
  });

  it("proceeds without intervention when the gate returns proceed", async () => {
    const dispatch = vi.fn(async (): Promise<AgentActionResult> => ({ ok: true }));
    const ctx = makeCtx({
      dispatch,
      estimateAndConfirmBudget: vi.fn(async () => ({ decision: "proceed" as const })),
    });
    const res = await executeGlobalWorkflow(
      wf([
        { path: "/studio", actionType: "fillPrompt", payload: "x", label: "fill" },
        { path: "/studio", actionType: "submit", payload: "", label: "submit" },
      ]),
      ctx
    );
    expect(res.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
