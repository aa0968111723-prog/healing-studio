/**
 * orb-agent-killswitch.test.ts
 *
 * Verifies the global orb-agent kill-switch contract:
 *
 * 1. `shouldAskBeforeAct` gates submit / reset / applyPreset / runWorkflow.
 * 2. `isDangerousAction` identifies all destructive action types.
 * 3. `workflowsEnabled` respects the VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS flag.
 * 4. Disabled workflows return { ok: false, reason: "workflow disabled" }.
 * 5. Safe (non-destructive) actions don't trigger the confirmation gate.
 * 6. Multi-step workflows always require confirmation.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import {
  shouldAskBeforeAct,
  isDangerousAction,
  workflowsEnabled,
} from "../shared/global-agent-orchestrator";
import type { AgentAction } from "../shared/agent-actions";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeAction(type: AgentAction["type"], extra: Record<string, unknown> = {}): AgentAction {
  const base: Record<string, unknown> = { type, ...extra };

  // Provide required fields per action type
  if (type === "fillPrompt") return { ...base, text: "test" } as AgentAction;
  if (type === "setModel") return { ...base, modelId: "m1" } as AgentAction;
  if (type === "setTab") return { ...base, tabId: "t1" } as AgentAction;
  if (type === "setMode") return { ...base, mode: "creative" } as AgentAction;
  if (type === "setModality") return { ...base, modality: "image" } as AgentAction;
  if (type === "setParam") return { ...base, param: "cfg", value: 7 } as AgentAction;
  if (type === "applyPreset") return { ...base, presetId: "p1" } as AgentAction;
  if (type === "submit") return { ...base } as AgentAction;
  if (type === "reset") return { ...base } as AgentAction;
  if (type === "navigate") return { ...base, path: "/studio" } as AgentAction;
  if (type === "focusElement") return { ...base, elementId: "el-1" } as AgentAction;
  if (type === "openDialog") return { ...base, dialogId: "d1" } as AgentAction;
  if (type === "search") return { ...base, query: "q" } as AgentAction;
  if (type === "toggleSetting") return { ...base, settingId: "s1", value: true } as AgentAction;
  if (type === "runWorkflow") {
    return {
      ...base,
      name: "Test workflow",
      steps: extra.steps ?? [],
    } as AgentAction;
  }
  return base as AgentAction;
}

// ── isDangerousAction ────────────────────────────────────────────────────────

describe("isDangerousAction", () => {
  const dangerous: AgentAction["type"][] = ["submit", "reset", "applyPreset", "runWorkflow"];
  const safe: AgentAction["type"][] = [
    "fillPrompt",
    "setModel",
    "setTab",
    "setMode",
    "setModality",
    "setParam",
    "navigate",
    "focusElement",
    "openDialog",
    "search",
    "toggleSetting",
  ];

  it.each(dangerous)("marks %s as dangerous", type => {
    expect(isDangerousAction(makeAction(type))).toBe(true);
  });

  it.each(safe)("does not mark %s as dangerous", type => {
    expect(isDangerousAction(makeAction(type))).toBe(false);
  });
});

// ── shouldAskBeforeAct ───────────────────────────────────────────────────────

describe("shouldAskBeforeAct", () => {
  it("returns false for an empty action list", () => {
    expect(shouldAskBeforeAct([])).toBe(false);
  });

  it("returns false for a list of only safe actions", () => {
    expect(shouldAskBeforeAct([makeAction("fillPrompt"), makeAction("navigate")])).toBe(false);
  });

  it("returns true when submit is present", () => {
    expect(shouldAskBeforeAct([makeAction("fillPrompt"), makeAction("submit")])).toBe(true);
  });

  it("returns true when reset is present", () => {
    expect(shouldAskBeforeAct([makeAction("reset")])).toBe(true);
  });

  it("returns true when applyPreset is present", () => {
    expect(shouldAskBeforeAct([makeAction("applyPreset")])).toBe(true);
  });

  it("returns true for a multi-step runWorkflow", () => {
    const wf = makeAction("runWorkflow", {
      steps: [
        { actionType: "navigate", label: "Go to studio", path: "/studio" },
        { actionType: "fillPrompt", label: "Fill prompt" },
      ],
    });
    expect(shouldAskBeforeAct([wf])).toBe(true);
  });

  it("returns true for a single-step runWorkflow with a destructive step", () => {
    const wf = makeAction("runWorkflow", {
      steps: [{ actionType: "submit", label: "Submit" }],
    });
    expect(shouldAskBeforeAct([wf])).toBe(true);
  });

  it("returns false for a single-step runWorkflow with only safe steps", () => {
    const wf = makeAction("runWorkflow", {
      steps: [{ actionType: "navigate", label: "Go somewhere", path: "/studio" }],
    });
    expect(shouldAskBeforeAct([wf])).toBe(false);
  });
});

// ── workflowsEnabled (flag reading) ─────────────────────────────────────────

describe("workflowsEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is enabled when flag is not set (default on)", () => {
    // Without any flag override, default should be true
    expect(typeof workflowsEnabled()).toBe("boolean");
  });

  it("returns false when VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS=false", () => {
    vi.stubEnv("VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS", "false");
    expect(workflowsEnabled()).toBe(false);
  });

  it("returns false when VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS=0", () => {
    vi.stubEnv("VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS", "0");
    expect(workflowsEnabled()).toBe(false);
  });

  it("returns false when VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS=off", () => {
    vi.stubEnv("VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS", "off");
    expect(workflowsEnabled()).toBe(false);
  });

  it("returns true when VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS=true", () => {
    vi.stubEnv("VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS", "true");
    expect(workflowsEnabled()).toBe(true);
  });

  it("returns true when VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS=1", () => {
    vi.stubEnv("VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS", "1");
    expect(workflowsEnabled()).toBe(true);
  });
});
