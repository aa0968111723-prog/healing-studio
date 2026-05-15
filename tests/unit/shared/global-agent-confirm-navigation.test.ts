/**
 * tests/unit/shared/global-agent-confirm-navigation.test.ts
 *
 * 自動跳頁修復 — verifies the orchestrator's pre-navigation gate:
 *
 *   1. When `ctx.requireConfirmation` is true and `ctx.confirmNavigation`
 *      is provided, the hook is awaited BEFORE `ctx.navigate()` runs.
 *   2. A "proceed" decision lets the run continue and `dispatch` fires.
 *   3. An "abort" decision short-circuits with a typed failure reason and
 *      `ctx.navigate()` is never called — the SPA stays where it was.
 *   4. With `requireConfirmation: false` (or no hook), the gate is a no-op
 *      and navigation happens immediately (legacy behaviour preserved).
 *   5. Same-page steps never call the hook even when confirmation is on.
 *   6. The workflow path applies the same gate (inside executeStepOnce).
 */
import { describe, expect, it, vi } from "vitest";
import type {
  AgentAction,
  AgentActionResult,
  RunWorkflowAction,
} from "../../../shared/agent-actions";
import type { GlobalAgentExecutionContext } from "../../../shared/global-agent-orchestrator";
import {
  executeGlobalAction,
  executeGlobalWorkflow,
} from "../../../shared/global-agent-orchestrator";

function makeCtx(
  overrides: Partial<GlobalAgentExecutionContext> = {}
): GlobalAgentExecutionContext {
  return {
    navigate: vi.fn(async () => {}),
    dispatch: vi.fn(async (): Promise<AgentActionResult> => ({ ok: true })),
    waitAfterNavigateMs: 0,
    currentPath: "/agent",
    ...overrides,
  };
}

describe("orchestrator confirmNavigation gate", () => {
  it("awaits confirmNavigation before cross-page navigate (executeGlobalAction)", async () => {
    const events: string[] = [];
    const confirmNavigation = vi.fn(async () => {
      events.push("confirm");
      return "proceed" as const;
    });
    const navigate = vi.fn(async () => {
      events.push("navigate");
    });
    const ctx = makeCtx({
      navigate,
      confirmNavigation,
      requireConfirmation: true,
    });

    const action: AgentAction = { type: "navigate", path: "/director" };
    const res = await executeGlobalAction(action, ctx);

    expect(res.ok).toBe(true);
    expect(confirmNavigation).toHaveBeenCalledOnce();
    expect(confirmNavigation).toHaveBeenCalledWith(
      expect.objectContaining({ targetPath: "/director", fromPath: "/agent" })
    );
    expect(navigate).toHaveBeenCalledOnce();
    // Critically, confirmation MUST run before navigate.
    expect(events).toEqual(["confirm", "navigate"]);
  });

  it("aborts the run and skips navigate when the hook returns 'abort'", async () => {
    const navigate = vi.fn(async () => {});
    const confirmNavigation = vi.fn(async () => "abort" as const);
    const ctx = makeCtx({
      navigate,
      confirmNavigation,
      requireConfirmation: true,
    });

    const action: AgentAction = { type: "navigate", path: "/director" };
    const res = await executeGlobalAction(action, ctx);

    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/navigation declined/i);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("skips the hook when requireConfirmation is false", async () => {
    const navigate = vi.fn(async () => {});
    const confirmNavigation = vi.fn(async () => "abort" as const);
    const ctx = makeCtx({
      navigate,
      confirmNavigation,
      requireConfirmation: false,
    });

    const action: AgentAction = { type: "navigate", path: "/director" };
    const res = await executeGlobalAction(action, ctx);

    expect(res.ok).toBe(true);
    expect(confirmNavigation).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("skips the hook for same-page navigates even when confirmation is on", async () => {
    const navigate = vi.fn(async () => {});
    const confirmNavigation = vi.fn(async () => "proceed" as const);
    const ctx = makeCtx({
      navigate,
      confirmNavigation,
      requireConfirmation: true,
      currentPath: "/director",
    });

    const action: AgentAction = { type: "navigate", path: "/director" };
    const res = await executeGlobalAction(action, ctx);

    expect(res.ok).toBe(true);
    expect(confirmNavigation).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("applies the same gate inside a workflow's cross-page step", async () => {
    const navigate = vi.fn(async () => {});
    const confirmNavigation = vi.fn(async () => "abort" as const);
    const dispatch = vi.fn(async (): Promise<AgentActionResult> => ({ ok: true }));
    const ctx = makeCtx({
      navigate,
      dispatch,
      confirmNavigation,
      requireConfirmation: true,
    });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "cross-page workflow",
      steps: [
        {
          id: "go",
          path: "/voice-studio",
          actionType: "fillPrompt",
          payload: "hi",
          label: "fill prompt on voice studio",
        },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);

    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/navigation declined/i);
    expect(navigate).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
