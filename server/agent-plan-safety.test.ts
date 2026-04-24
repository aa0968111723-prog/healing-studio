import { describe, expect, it } from "vitest";
import type { AgentPlan } from "../shared/agent-plan-schema";
import {
  evaluateAgentPlanSafety,
  evaluateWorkflowSafety,
  getAgentPlanBlockers,
  isSafeInternalPath,
  shouldAskBeforeExecutingAgentPlan,
} from "../shared/agent-plan-safety";

describe("agent-plan-safety", () => {
  const basePlan: AgentPlan = {
    schemaVersion: "agent-plan.v1",
    intent: "create poster",
    confidence: 0.9,
    summaryForUser: "Fill prompt only.",
    shouldAskClarification: false,
    warnings: [],
    steps: [
      {
        id: "fill",
        label: "填入提示詞",
        pagePath: "/studio",
        riskLevel: "low",
        requiresApproval: false,
        undoable: true,
        action: { type: "fillPrompt", text: "一張電影感海報" },
      },
    ],
  };

  it("allows low-risk plans to execute after normal flow", () => {
    const evaluation = evaluateAgentPlanSafety(basePlan);
    expect(evaluation.askBeforeAct).toBe(false);
    expect(evaluation.okToExecute).toBe(true);
    expect(evaluation.maxRiskLevel).toBe("low");
    expect(evaluation.issues).toEqual([]);
  });

  it("blocks high-risk submit steps when approval is missing", () => {
    const plan: AgentPlan = {
      ...basePlan,
      steps: [
        {
          id: "submit",
          label: "送出生成",
          pagePath: "/studio",
          riskLevel: "high",
          requiresApproval: false,
          undoable: false,
          action: { type: "submit" },
        },
      ],
    };

    const evaluation = evaluateAgentPlanSafety(plan);
    expect(evaluation.askBeforeAct).toBe(true);
    expect(evaluation.okToExecute).toBe(false);
    expect(getAgentPlanBlockers(plan).map(issue => issue.reason)).toContain("high_risk_without_approval");
  });

  it("requires confirmation but does not block approved high-risk plans", () => {
    const plan: AgentPlan = {
      ...basePlan,
      steps: [
        {
          id: "submit",
          label: "送出生成",
          pagePath: "/studio",
          riskLevel: "high",
          requiresApproval: true,
          undoable: false,
          action: { type: "submit" },
        },
      ],
    };

    const evaluation = evaluateAgentPlanSafety(plan);
    expect(evaluation.askBeforeAct).toBe(true);
    expect(evaluation.okToExecute).toBe(false);
    expect(evaluation.issues.some(issue => issue.severity === "blocker")).toBe(false);
    expect(shouldAskBeforeExecutingAgentPlan(plan)).toBe(true);
  });

  it("rejects unsafe paths", () => {
    expect(isSafeInternalPath("/studio")).toBe(true);
    expect(isSafeInternalPath("//evil.com")).toBe(false);
    expect(isSafeInternalPath("https://evil.com")).toBe(false);
    expect(isSafeInternalPath("/javascript:alert(1)")).toBe(false);
    expect(isSafeInternalPath("/foo\\bar")).toBe(false);
  });

  it("blocks plans with too many submit steps", () => {
    const plan: AgentPlan = {
      ...basePlan,
      steps: Array.from({ length: 7 }, (_, index) => ({
        id: `submit-${index}`,
        label: `送出 ${index}`,
        pagePath: "/studio",
        riskLevel: "high" as const,
        requiresApproval: true,
        undoable: false,
        action: { type: "submit" as const },
      })),
    };

    const evaluation = evaluateAgentPlanSafety(plan);
    expect(evaluation.issues.map(issue => issue.reason)).toContain("too_many_submits");
  });

  it("turns clarification-only plans into presentable but non-executable plans", () => {
    const plan: AgentPlan = {
      ...basePlan,
      shouldAskClarification: true,
      clarificationQuestion: "你想做哪種比例？",
      steps: [],
    };

    const evaluation = evaluateAgentPlanSafety(plan);
    expect(evaluation.okToPresent).toBe(true);
    expect(evaluation.okToExecute).toBe(false);
    expect(evaluation.summary).toContain("比例");
  });

  it("evaluates legacy runWorkflow actions for submit risk", () => {
    const evaluation = evaluateWorkflowSafety({
      type: "runWorkflow",
      name: "legacy workflow",
      steps: [
        { path: "/studio", actionType: "fillPrompt", payload: "test", label: "填提示詞" },
        { path: "/studio", actionType: "submit", payload: "", label: "送出" },
      ],
    });

    expect(evaluation.askBeforeAct).toBe(true);
    expect(evaluation.submitCount).toBe(1);
  });
});
