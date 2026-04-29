/**
 * global-agent-orchestrator-preferences.test.ts
 *
 * Verifies confirmationPolicy plumbing into shouldAskBeforeAct:
 *
 *   - confirm_all       → every action confirmed.
 *   - manual            → every action confirmed (kill-switch safety net).
 *   - confirm_high_risk → only destructive / multi-step workflows confirmed.
 *   - always_approve    → safe single actions auto-pass; destructive still gate;
 *                         multi-step workflows still gate.
 *
 * Plus isToolAutoApproved / isToolBlocked behaviour with wildcard.
 */

import { describe, expect, it } from "vitest";
import {
  shouldAskBeforeAct,
  isToolAutoApproved,
  isToolBlocked,
  type OrchestratorPreferences,
} from "../shared/global-agent-orchestrator";
import type { AgentAction } from "../shared/agent-actions";

const safeAction: AgentAction = { type: "fillPrompt", text: "hello" };
const navigateAction: AgentAction = { type: "navigate", path: "/studio" };
const submitAction: AgentAction = { type: "submit" };
const resetAction: AgentAction = { type: "reset" };
const singleStepWorkflow: AgentAction = {
  type: "runWorkflow",
  name: "single safe step",
  steps: [{ label: "Open studio", actionType: "navigate", payload: "/studio" }],
};
const multiStepWorkflow: AgentAction = {
  type: "runWorkflow",
  name: "multi step",
  steps: [
    { label: "Open studio", actionType: "navigate", payload: "/studio" },
    { label: "Set cfg", actionType: "setParam", payload: "cfg:7" },
  ],
};

describe("shouldAskBeforeAct(actions, preferences)", () => {
  it("default behaviour (no preferences) matches confirm_high_risk", () => {
    expect(shouldAskBeforeAct([safeAction])).toBe(false);
    expect(shouldAskBeforeAct([submitAction])).toBe(true);
  });

  it("confirm_all forces every action through confirmation", () => {
    const prefs: OrchestratorPreferences = { confirmationPolicy: "confirm_all" };
    expect(shouldAskBeforeAct([safeAction], prefs)).toBe(true);
    expect(shouldAskBeforeAct([navigateAction], prefs)).toBe(true);
    expect(shouldAskBeforeAct([submitAction], prefs)).toBe(true);
    expect(shouldAskBeforeAct([], prefs)).toBe(false);
  });

  it("manual policy treats every action as needing confirmation (safety net)", () => {
    const prefs: OrchestratorPreferences = { confirmationPolicy: "manual" };
    expect(shouldAskBeforeAct([safeAction], prefs)).toBe(true);
    expect(shouldAskBeforeAct([], prefs)).toBe(false);
  });

  it("confirm_high_risk skips safe actions and gates destructive ones", () => {
    const prefs: OrchestratorPreferences = { confirmationPolicy: "confirm_high_risk" };
    expect(shouldAskBeforeAct([safeAction, navigateAction], prefs)).toBe(false);
    expect(shouldAskBeforeAct([resetAction], prefs)).toBe(true);
    expect(shouldAskBeforeAct([submitAction], prefs)).toBe(true);
  });

  it("always_approve auto-passes safe actions but still gates destructive", () => {
    const prefs: OrchestratorPreferences = { confirmationPolicy: "always_approve" };
    expect(shouldAskBeforeAct([safeAction], prefs)).toBe(false);
    expect(shouldAskBeforeAct([navigateAction], prefs)).toBe(false);
    // submit / reset / applyPreset — safety floor preserved.
    expect(shouldAskBeforeAct([submitAction], prefs)).toBe(true);
    expect(shouldAskBeforeAct([resetAction], prefs)).toBe(true);
  });

  it("multi-step workflow always gates regardless of policy", () => {
    const policies: OrchestratorPreferences["confirmationPolicy"][] = [
      "always_approve",
      "confirm_high_risk",
      "confirm_all",
      "manual",
    ];
    for (const policy of policies) {
      const prefs: OrchestratorPreferences = { confirmationPolicy: policy };
      expect(shouldAskBeforeAct([multiStepWorkflow], prefs)).toBe(true);
    }
  });

  it("single-step safe workflow only gates under confirm_all / manual", () => {
    expect(
      shouldAskBeforeAct([singleStepWorkflow], { confirmationPolicy: "always_approve" })
    ).toBe(false);
    expect(
      shouldAskBeforeAct([singleStepWorkflow], { confirmationPolicy: "confirm_high_risk" })
    ).toBe(false);
    expect(
      shouldAskBeforeAct([singleStepWorkflow], { confirmationPolicy: "confirm_all" })
    ).toBe(true);
    expect(
      shouldAskBeforeAct([singleStepWorkflow], { confirmationPolicy: "manual" })
    ).toBe(true);
  });
});

describe("isToolAutoApproved / isToolBlocked", () => {
  it("auto-approves listed tools", () => {
    expect(
      isToolAutoApproved("fal.imagine", { autoApproveTools: ["fal.imagine"] })
    ).toBe(true);
    expect(
      isToolAutoApproved("fal.imagine", { autoApproveTools: ["other"] })
    ).toBe(false);
  });

  it("supports wildcard '*' for auto-approve", () => {
    expect(isToolAutoApproved("anything", { autoApproveTools: ["*"] })).toBe(true);
  });

  it("blocks listed tools", () => {
    expect(isToolBlocked("danger.tool", { blockedTools: ["danger.tool"] })).toBe(true);
    expect(isToolBlocked("safe.tool", { blockedTools: ["danger.tool"] })).toBe(false);
  });

  it("returns false when preferences are absent", () => {
    expect(isToolAutoApproved("anything", null)).toBe(false);
    expect(isToolBlocked("anything", null)).toBe(false);
  });
});
