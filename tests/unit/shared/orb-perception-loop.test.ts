/**
 * tests/unit/shared/orb-perception-loop.test.ts
 *
 * Module 1 — perception loop:
 *   1. diffSnapshots correctly flags page / model / mode / state changes.
 *   2. evaluateStepOutcome translates (action, before, after, result) into
 *      a verdict + recommendation that the orchestrator can route on.
 *   3. New warnings always trigger a replan recommendation.
 *   4. Orchestrator integration: ctx.observeAfterStep returning "abort" /
 *      "retry" / "replan" / "proceed" produces the matching control flow.
 */
import { describe, expect, it, vi } from "vitest";
import type {
  AgentActionResult,
  PageAgentSnapshot,
  RunWorkflowAction,
} from "../../../shared/agent-actions";
import type { GlobalAgentExecutionContext } from "../../../shared/global-agent-orchestrator";
import { executeGlobalWorkflow } from "../../../shared/global-agent-orchestrator";
import {
  diffSnapshots,
  evaluateStepOutcome,
  expectedDeltaForAction,
  summarizePerceptionForPrompt,
} from "../../../shared/orb-perception-loop";

function makeSnapshot(over: Partial<PageAgentSnapshot> = {}): PageAgentSnapshot {
  return {
    pageId: "studio",
    pageLabel: "Studio",
    pagePath: "/studio",
    capabilities: [],
    state: {},
    ...over,
  };
}

function makeCtx(overrides: Partial<GlobalAgentExecutionContext> = {}): GlobalAgentExecutionContext {
  return {
    navigate: vi.fn(),
    dispatch: vi.fn(async (): Promise<AgentActionResult> => ({ ok: true })),
    waitAfterNavigateMs: 0,
    ...overrides,
  };
}

describe("diffSnapshots", () => {
  it("flags page + model + state changes", () => {
    const before = makeSnapshot({
      pagePath: "/studio",
      activeModel: "fal-ai/flux",
      state: { isGenerating: false },
    });
    const after = makeSnapshot({
      pagePath: "/video-studio",
      pageId: "video-studio",
      activeModel: "fal-ai/kling",
      state: { isGenerating: true },
    });
    const delta = diffSnapshots(before, after);
    expect(delta.pageChanged).toBe(true);
    expect(delta.modelChanged).toBe(true);
    expect(delta.changedStateKeys).toContain("isGenerating");
    expect(delta.anyChange).toBe(true);
  });

  it("returns zero-delta when either snapshot is missing", () => {
    expect(diffSnapshots(null, makeSnapshot()).anyChange).toBe(false);
    expect(diffSnapshots(makeSnapshot(), undefined).anyChange).toBe(false);
  });

  it("flags new + resolved warnings independently", () => {
    const before = makeSnapshot({ warnings: ["warn-a"] });
    const after = makeSnapshot({ warnings: ["warn-b"] });
    const d = diffSnapshots(before, after);
    expect(d.newWarnings).toEqual(["warn-b"]);
    expect(d.resolvedWarnings).toEqual(["warn-a"]);
    expect(d.anyChange).toBe(true);
  });
});

describe("expectedDeltaForAction", () => {
  it("requires page change for navigate", () => {
    expect(
      expectedDeltaForAction({ type: "navigate", path: "/x" }).expectedField
    ).toBe("pageChanged");
  });
  it("does not expect immediate change for submit", () => {
    expect(expectedDeltaForAction({ type: "submit" }).expectsChange).toBe(false);
  });
  it("expects modelChanged for setModel", () => {
    expect(
      expectedDeltaForAction({ type: "setModel", modelId: "x" }).expectedField
    ).toBe("modelChanged");
  });
});

describe("evaluateStepOutcome", () => {
  it("returns succeeded/proceed when expected field flipped", () => {
    const before = makeSnapshot({ activeModel: "old" });
    const after = makeSnapshot({ activeModel: "new" });
    const v = evaluateStepOutcome({
      action: { type: "setModel", modelId: "new" },
      before,
      after,
      dispatchResult: { ok: true },
      now: 1000,
    });
    expect(v.outcome).toBe("succeeded");
    expect(v.recommendation).toBe("proceed");
    expect(v.observedAt).toBe(1000);
  });

  it("returns no-effect/retry when expected field didn't change", () => {
    const snap = makeSnapshot({ activeModel: "stuck" });
    const v = evaluateStepOutcome({
      action: { type: "setModel", modelId: "new" },
      before: snap,
      after: snap,
      dispatchResult: { ok: true },
    });
    expect(v.outcome).toBe("no-effect");
    expect(v.recommendation).toBe("retry");
  });

  it("triggers replan when a new warning surfaced", () => {
    const before = makeSnapshot();
    const after = makeSnapshot({ warnings: ["quota exceeded"] });
    const v = evaluateStepOutcome({
      action: { type: "submit" },
      before,
      after,
      dispatchResult: { ok: true },
    });
    expect(v.outcome).toBe("diverged");
    expect(v.recommendation).toBe("replan");
    expect(v.reason).toMatch(/quota/);
  });

  it("returns unknown/proceed when no snapshots provided", () => {
    const v = evaluateStepOutcome({
      action: { type: "setModel", modelId: "x" },
      before: null,
      after: null,
      dispatchResult: { ok: true },
    });
    expect(v.outcome).toBe("unknown");
    expect(v.recommendation).toBe("proceed");
  });

  it("treats dispatch failure as diverged with retry/replan based on warnings", () => {
    const v = evaluateStepOutcome({
      action: { type: "fillPrompt", text: "x" },
      before: makeSnapshot(),
      after: makeSnapshot({ warnings: ["api key invalid"] }),
      dispatchResult: { ok: false, reason: "boom" },
    });
    expect(v.outcome).toBe("diverged");
    expect(v.recommendation).toBe("replan");
  });
});

describe("summarizePerceptionForPrompt", () => {
  it("returns empty string for empty history", () => {
    expect(summarizePerceptionForPrompt([])).toBe("");
  });

  it("focuses on the last interesting (diverged) verdict and trailing entries", () => {
    const ok = (i: number) => ({
      outcome: "succeeded" as const,
      recommendation: "proceed" as const,
      reason: "ok",
      observedAt: i,
      delta: { ...emptyDelta(), anyChange: true, changedStateKeys: ["k"] },
    });
    const bad = (i: number) => ({
      outcome: "diverged" as const,
      recommendation: "replan" as const,
      reason: "warning surfaced",
      observedAt: i,
      delta: emptyDelta(),
    });
    const out = summarizePerceptionForPrompt([ok(1), ok(2), bad(3), ok(4)], 3);
    expect(out).toContain("diverged");
    expect(out).toContain("warning surfaced");
  });
});

describe("orchestrator integration with observeAfterStep", () => {
  it("aborts the workflow when observation returns abort", async () => {
    const observeAfterStep = vi.fn(async () => ({
      recommendation: "abort" as const,
      reason: "user disabled",
    }));
    const dispatch = vi.fn(async (): Promise<AgentActionResult> => ({ ok: true }));
    const ctx = makeCtx({ dispatch, observeAfterStep });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "abort via perception",
      steps: [
        { path: "/studio", actionType: "fillPrompt", payload: "x", label: "fill" },
        { path: "/studio", actionType: "submit", payload: "", label: "submit" },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(false);
    expect(observeAfterStep).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(res.reason).toMatch(/perception/);
  });

  it("triggers replan via ctx.replan when observation returns replan", async () => {
    let observed = 0;
    const observeAfterStep = vi.fn(async () => {
      observed += 1;
      return observed === 1
        ? { recommendation: "replan" as const, reason: "no-effect" }
        : { recommendation: "proceed" as const };
    });
    const replan = vi.fn(async () => [
      { actionType: "fillPrompt", payload: "fallback", label: "fallback fill", path: "/studio" },
    ]);
    const dispatch = vi.fn(async (): Promise<AgentActionResult> => ({ ok: true }));
    const ctx = makeCtx({ dispatch, observeAfterStep, replan });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "replan via perception",
      steps: [
        { path: "/studio", actionType: "fillPrompt", payload: "x", label: "fill" },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(true);
    expect(replan).toHaveBeenCalledOnce();
    // Original step + fallback step.
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("retries the step once when observation returns retry", async () => {
    const calls: string[] = [];
    let observations = 0;
    const observeAfterStep = vi.fn(async () => {
      observations += 1;
      // First observation says retry, second says proceed.
      return observations === 1
        ? { recommendation: "retry" as const }
        : { recommendation: "proceed" as const };
    });
    const dispatch = vi.fn(async (): Promise<AgentActionResult> => {
      calls.push("dispatch");
      return { ok: true };
    });
    const ctx = makeCtx({ dispatch, observeAfterStep });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "retry via perception",
      steps: [
        { path: "/studio", actionType: "fillPrompt", payload: "x", label: "fill" },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(true);
    expect(calls.length).toBe(2);
    expect(observations).toBeGreaterThanOrEqual(1);
  });

  it("proceeds without intervention when observation returns proceed (or null)", async () => {
    const observeAfterStep = vi.fn(async () => null);
    const dispatch = vi.fn(async (): Promise<AgentActionResult> => ({ ok: true }));
    const ctx = makeCtx({ dispatch, observeAfterStep });

    const workflow: RunWorkflowAction = {
      type: "runWorkflow",
      name: "proceed via perception",
      steps: [
        { path: "/studio", actionType: "fillPrompt", payload: "x", label: "fill" },
        { path: "/studio", actionType: "submit", payload: "", label: "submit" },
      ],
    };

    const res = await executeGlobalWorkflow(workflow, ctx);
    expect(res.ok).toBe(true);
    expect(observeAfterStep).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});

function emptyDelta() {
  return {
    pageChanged: false,
    modelChanged: false,
    modeChanged: false,
    modalityChanged: false,
    promptChanged: false,
    presetChanged: false,
    newWarnings: [] as string[],
    resolvedWarnings: [] as string[],
    changedStateKeys: [] as string[],
    anyChange: false,
  };
}
