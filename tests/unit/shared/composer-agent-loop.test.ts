/**
 * Unit tests for shared/composer-agent-loop.ts
 *
 * 編編 (composer) 的 agent loop 短期記憶 + continuation 決策 + recovery 決策。
 */

import { describe, expect, it } from "vitest";
import {
  createComposerAgentState,
  captureTurn,
  planContinuation,
  summarizeForPrompt,
  decideRecovery,
  rememberHandoff,
  MAX_TURNS,
  type ComposerTurnRecord,
} from "../../../shared/composer-agent-loop";
import type { AgentAction } from "../../../shared/agent-actions";
import type { PerceptionVerdict } from "../../../shared/orb-perception-loop";

function mkTurn(overrides: Partial<ComposerTurnRecord> = {}): ComposerTurnRecord {
  return {
    startedAt: 1_000_000,
    userText: "test",
    snapshotPath: "/image-studio",
    actions: [],
    dispatchOk: null,
    verdicts: [],
    ...overrides,
  };
}

describe("ComposerAgentState — capture history", () => {
  it("starts empty", () => {
    const s = createComposerAgentState();
    expect(s.history).toEqual([]);
  });

  it("captures turns most-recent-first", () => {
    let s = createComposerAgentState();
    s = captureTurn(s, mkTurn({ userText: "first" }));
    s = captureTurn(s, mkTurn({ userText: "second" }));
    expect(s.history[0].userText).toBe("second");
    expect(s.history[1].userText).toBe("first");
  });

  it("caps history at MAX_TURNS", () => {
    let s = createComposerAgentState();
    for (let i = 0; i < MAX_TURNS + 3; i++) {
      s = captureTurn(s, mkTurn({ userText: `turn-${i}` }));
    }
    expect(s.history).toHaveLength(MAX_TURNS);
    // Most recent should be the last we pushed
    expect(s.history[0].userText).toBe(`turn-${MAX_TURNS + 2}`);
  });

  it("rememberHandoff stores the target", () => {
    const s = rememberHandoff(createComposerAgentState(), "critic");
    expect(s.lastHandoffTo).toBe("critic");
  });
});

describe("planContinuation", () => {
  const setModel: AgentAction = { type: "setModel", modelId: "fal-ai/flux-pro/v1.1" };
  const fillPrompt: AgentAction = { type: "fillPrompt", text: "a cat" };
  const submit: AgentAction = { type: "submit" };

  it("returns 'new' when history is empty", () => {
    const plan = planContinuation(createComposerAgentState(), "再試一次");
    expect(plan.kind).toBe("new");
  });

  it("returns 'retry' for retry keywords when prior turn had actions", () => {
    const s = captureTurn(createComposerAgentState(), mkTurn({
      actions: [setModel, fillPrompt, submit],
      dispatchOk: true,
    }));
    const plan = planContinuation(s, "再試一次");
    expect(plan.kind).toBe("retry");
    expect(plan.actions.map(a => a.type)).toEqual(["setModel", "fillPrompt", "submit"]);
  });

  it("returns 'cheaper' and swaps flux-pro → schnell", () => {
    const s = captureTurn(createComposerAgentState(), mkTurn({
      actions: [setModel, fillPrompt, submit],
      dispatchOk: true,
    }));
    const plan = planContinuation(s, "改省點的");
    expect(plan.kind).toBe("cheaper");
    const setModelAction = plan.actions.find(a => a.type === "setModel");
    if (setModelAction?.type === "setModel") {
      expect(setModelAction.modelId).toBe("fal-ai/flux/schnell");
    }
  });

  it("returns 'cheaper' and swaps kling-pro → wan", () => {
    const kling: AgentAction = {
      type: "setModel",
      modelId: "fal-ai/kling-video/v2.1/pro/image-to-video",
    };
    const s = captureTurn(createComposerAgentState(), mkTurn({
      actions: [kling, submit],
      dispatchOk: true,
    }));
    const plan = planContinuation(s, "便宜一點");
    expect(plan.kind).toBe("cheaper");
    const setModelAction = plan.actions.find(a => a.type === "setModel");
    if (setModelAction?.type === "setModel") {
      expect(setModelAction.modelId).toBe("fal-ai/wan-i2v");
    }
  });

  it("falls through to 'new' when 'cheaper' has no expensive model to swap", () => {
    const schnell: AgentAction = { type: "setModel", modelId: "fal-ai/flux/schnell" };
    const s = captureTurn(createComposerAgentState(), mkTurn({
      actions: [schnell, submit],
      dispatchOk: true,
    }));
    const plan = planContinuation(s, "便宜一點");
    expect(plan.kind).toBe("new");
  });

  it("returns 'escalate' with quality-coach for dissatisfaction keywords", () => {
    const s = captureTurn(createComposerAgentState(), mkTurn({
      actions: [submit],
      dispatchOk: true,
    }));
    const plan = planContinuation(s, "這張不行");
    expect(plan.kind).toBe("escalate");
    expect(plan.escalateTo).toBe("quality-coach");
  });

  it("returns 'new' when last turn had no actions (nothing to continue)", () => {
    const s = captureTurn(createComposerAgentState(), mkTurn({ actions: [] }));
    const plan = planContinuation(s, "再試一次");
    expect(plan.kind).toBe("new");
  });
});

describe("summarizeForPrompt", () => {
  it("returns empty string when history is empty", () => {
    expect(summarizeForPrompt(createComposerAgentState())).toBe("");
  });

  it("renders recent N turns with action types + status", () => {
    let s = createComposerAgentState();
    s = captureTurn(s, mkTurn({
      userText: "畫一隻貓",
      actions: [{ type: "fillPrompt", text: "貓" }, { type: "submit" }],
      dispatchOk: true,
    }));
    const summary = summarizeForPrompt(s);
    expect(summary).toContain("編編最近");
    expect(summary).toContain("fillPrompt");
    expect(summary).toContain("submit");
    expect(summary).toContain("ok");
  });

  it("clips long history to the requested window", () => {
    let s = createComposerAgentState();
    for (let i = 0; i < 5; i++) {
      s = captureTurn(s, mkTurn({ userText: `turn-${i}` }));
    }
    const lines = summarizeForPrompt(s, 2).split("\n");
    // 1 header + 2 turns = 3 lines max
    expect(lines.length).toBeLessThanOrEqual(3);
  });
});

describe("decideRecovery", () => {
  const baseVerdict: PerceptionVerdict = {
    outcome: "succeeded",
    recommendation: "proceed",
    reason: "ok",
    observedAt: 0,
    delta: {
      pageChanged: false,
      modelChanged: false,
      modeChanged: false,
      modalityChanged: false,
      promptChanged: false,
      presetChanged: false,
      newWarnings: [],
      resolvedWarnings: [],
      changedStateKeys: [],
      anyChange: false,
    },
  };

  it("noop on succeeded", () => {
    const d = decideRecovery({ ...baseVerdict, outcome: "succeeded", recommendation: "proceed" }, 0);
    expect(d.kind).toBe("noop");
  });

  it("noop on null verdict", () => {
    const d = decideRecovery(null, 0);
    expect(d.kind).toBe("noop");
  });

  it("auto-retry on retry recommendation when attempt = 0", () => {
    const d = decideRecovery(
      { ...baseVerdict, outcome: "no-effect", recommendation: "retry" },
      0,
    );
    expect(d.kind).toBe("auto-retry");
  });

  it("does NOT auto-retry past attempt = 1 (cap at one retry)", () => {
    const d = decideRecovery(
      { ...baseVerdict, outcome: "no-effect", recommendation: "retry" },
      1,
    );
    expect(d.kind).not.toBe("auto-retry");
  });

  it("ask-user with chips on replan recommendation", () => {
    const d = decideRecovery(
      { ...baseVerdict, outcome: "diverged", recommendation: "replan" },
      0,
    );
    expect(d.kind).toBe("ask-user");
    if (d.kind === "ask-user") {
      expect(d.chips.length).toBeGreaterThan(0);
      // At least one chip should target a real spirit
      const hasSpiritChip = d.chips.some(c => c.startsWith("@"));
      expect(hasSpiritChip).toBe(true);
    }
  });

  it("escalates to inspector on abort recommendation", () => {
    const d = decideRecovery(
      { ...baseVerdict, outcome: "diverged", recommendation: "abort" },
      0,
    );
    expect(d.kind).toBe("escalate");
    if (d.kind === "escalate") {
      expect(d.to).toBe("inspector");
    }
  });
});
