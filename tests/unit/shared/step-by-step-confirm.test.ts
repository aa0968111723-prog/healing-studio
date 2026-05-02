/**
 * tests/unit/shared/step-by-step-confirm.test.ts
 *
 * Task 4 — verify step-level confirmation cards:
 *   1. confirmationMode: "step-by-step" calls ctx.confirmStep before each step.
 *   2. "skip" decision continues with the next step.
 *   3. "abort" decision stops the workflow with a typed reason.
 *   4. confirmationMode: "high-risk-only" only stops on dangerous steps.
 *   5. No confirmationMode → no confirmStep calls (backward compat).
 */
import { describe, expect, it, vi } from "vitest";
import type {
  AgentActionResult,
  AgentWorkflowStep,
  RunWorkflowAction,
} from "../../../shared/agent-actions";
import type { GlobalAgentExecutionContext } from "../../../shared/global-agent-orchestrator";
import { executeGlobalWorkflow } from "../../../shared/global-agent-orchestrator";

function makeCtx(overrides: Partial<GlobalAgentExecutionContext> = {}): GlobalAgentExecutionContext {
  return {
    navigate: vi.fn(),
    dispatch: vi.fn(async (): Promise<AgentActionResult> => ({ ok: true })),
    waitAfterNavigateMs: 0,
    ...overrides,
  };
}

describe("step-by-step confirmation", () => {
  it("calls confirmStep for every step when mode is step-by-step", async () => {
    const confirmStep = vi.fn(async () => "proceed" as const);
    const dispatch = vi.fn(async (): Promise<AgentActionResult> => ({ ok: true }));
    const ctx = makeCtx({ dispatch, confirmStep });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "step-by-step",
      confirmationMode: "step-by-step",
      steps: [
        { path: "/studio", actionType: "fillPrompt", payload: "a", label: "fill" },
        { path: "/studio", actionType: "submit", payload: "", label: "submit" },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(true);
    expect(confirmStep).toHaveBeenCalledTimes(2);
    // First call: index=0, total=2, step has fillPrompt actionType.
    const firstCall = confirmStep.mock.calls[0];
    expect(firstCall[1]).toBe(0);
    expect(firstCall[2]).toBe(2);
    expect((firstCall[0] as AgentWorkflowStep).actionType).toBe("fillPrompt");
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("skips the step when confirmStep returns 'skip'", async () => {
    const confirmStep = vi.fn(async (_step, index: number) => {
      return index === 0 ? "skip" : "proceed";
    }) as unknown as GlobalAgentExecutionContext["confirmStep"];
    const dispatch = vi.fn(async (): Promise<AgentActionResult> => ({ ok: true }));
    const ctx = makeCtx({ dispatch, confirmStep });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "skip first",
      confirmationMode: "step-by-step",
      steps: [
        { path: "/studio", actionType: "fillPrompt", payload: "a", label: "fill" },
        { path: "/studio", actionType: "submit", payload: "", label: "submit" },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(true);
    // First step skipped — dispatch only fires once (for the submit).
    expect(dispatch).toHaveBeenCalledTimes(1);
    // Skip surfaces as a successful "skipped by user" result.
    expect(res.results[0]).toEqual(
      expect.objectContaining({ ok: true, message: expect.stringMatching(/skipped/i) })
    );
  });

  it("aborts the workflow when confirmStep returns 'abort'", async () => {
    const confirmStep = vi.fn(async () => "abort" as const);
    const dispatch = vi.fn(async (): Promise<AgentActionResult> => ({ ok: true }));
    const ctx = makeCtx({ dispatch, confirmStep });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "abort first",
      confirmationMode: "step-by-step",
      steps: [
        { path: "/studio", actionType: "fillPrompt", payload: "a", label: "fill" },
        { path: "/studio", actionType: "submit", payload: "", label: "submit" },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(res.reason).toMatch(/aborted/);
  });

  it("high-risk-only only confirms on submit/reset/applyPreset", async () => {
    const confirmStep = vi.fn(async () => "proceed" as const);
    const dispatch = vi.fn(async (): Promise<AgentActionResult> => ({ ok: true }));
    const ctx = makeCtx({ dispatch, confirmStep });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "risky only",
      confirmationMode: "high-risk-only",
      steps: [
        { path: "/studio", actionType: "fillPrompt", payload: "safe", label: "fill" },
        { path: "/studio", actionType: "setModel", payload: "fal-ai/flux", label: "model" },
        { path: "/studio", actionType: "submit", payload: "", label: "submit" },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(true);
    // Only the submit step is high-risk → confirmStep fires once.
    expect(confirmStep).toHaveBeenCalledTimes(1);
    expect((confirmStep.mock.calls[0][0] as AgentWorkflowStep).actionType).toBe("submit");
  });

  it("does not call confirmStep when confirmationMode is undefined", async () => {
    const confirmStep = vi.fn(async () => "proceed" as const);
    const dispatch = vi.fn(async (): Promise<AgentActionResult> => ({ ok: true }));
    const ctx = makeCtx({ dispatch, confirmStep });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "no mode",
      steps: [
        { path: "/studio", actionType: "fillPrompt", payload: "a", label: "fill" },
        { path: "/studio", actionType: "submit", payload: "", label: "submit" },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(true);
    expect(confirmStep).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
