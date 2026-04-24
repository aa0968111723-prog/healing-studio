import { describe, expect, it } from "vitest";
import {
  AGENT_PLAN_JSON_SCHEMA,
  actionRequiresApproval,
  agentPlanToWorkflowAction,
  inferRiskLevelForAction,
  safeParseAgentPlan,
  AgentPlanSchema,
} from "../shared/agent-plan-schema";

describe("agent-plan-schema", () => {
  it("accepts a valid executable plan and converts it to a workflow", () => {
    const parsed = AgentPlanSchema.parse({
      schemaVersion: "agent-plan.v1",
      intent: "create a 30 second short video",
      confidence: 0.88,
      summaryForUser: "我會先產生腳本，再切到圖像頁建立關鍵視覺。",
      shouldAskClarification: false,
      warnings: [],
      steps: [
        {
          id: "script",
          label: "導演 AI：產生腳本",
          pagePath: "/director",
          riskLevel: "low",
          requiresApproval: false,
          undoable: true,
          action: {
            type: "fillPrompt",
            text: "請產生 30 秒短片腳本",
          },
        },
        {
          id: "send",
          label: "送出腳本生成",
          pagePath: "/director",
          riskLevel: "high",
          requiresApproval: true,
          undoable: false,
          action: {
            type: "submit",
          },
        },
      ],
    });

    const workflow = agentPlanToWorkflowAction(parsed);
    expect(workflow).toMatchObject({
      type: "runWorkflow",
      name: "create a 30 second short video",
    });
    expect(workflow?.steps).toHaveLength(2);
    expect(workflow?.steps[0]).toEqual({
      path: "/director",
      label: "導演 AI：產生腳本",
      actionType: "fillPrompt",
      payload: "請產生 30 秒短片腳本",
    });
    expect(workflow?.steps[1]).toMatchObject({
      actionType: "submit",
      payload: "",
    });
  });

  it("allows clarification-only plans with no executable steps", () => {
    const result = safeParseAgentPlan({
      schemaVersion: "agent-plan.v1",
      intent: "unclear video request",
      confidence: 0.3,
      summaryForUser: "我需要先釐清你的短片用途。",
      shouldAskClarification: true,
      clarificationQuestion: "這支短片要用在哪個平台？",
      steps: [],
      warnings: [],
    });

    expect(result.ok).toBe(true);
    expect(result.plan?.clarificationQuestion).toContain("平台");
  });

  it("rejects non-clarification plans without steps", () => {
    const result = safeParseAgentPlan({
      schemaVersion: "agent-plan.v1",
      intent: "make something",
      confidence: 0.7,
      summaryForUser: "我會幫你做。",
      shouldAskClarification: false,
      steps: [],
      warnings: [],
    });

    expect(result.ok).toBe(false);
    expect(result.issues?.join("\n")).toContain("steps");
  });

  it("rejects unknown actions", () => {
    const result = safeParseAgentPlan({
      schemaVersion: "agent-plan.v1",
      intent: "unsafe action",
      confidence: 0.9,
      summaryForUser: "不應該接受未知 action。",
      shouldAskClarification: false,
      warnings: [],
      steps: [
        {
          id: "bad",
          label: "Bad",
          riskLevel: "low",
          requiresApproval: false,
          undoable: false,
          action: { type: "deleteAccount", now: true },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.issues?.join("\n")).toContain("Invalid input");
  });

  it("infers risk and approval requirements for dangerous actions", () => {
    expect(inferRiskLevelForAction({ type: "fillPrompt" })).toBe("low");
    expect(inferRiskLevelForAction({ type: "setModality" })).toBe("medium");
    expect(inferRiskLevelForAction({ type: "submit" })).toBe("high");
    expect(actionRequiresApproval({ type: "fillPrompt" })).toBe(false);
    expect(actionRequiresApproval({ type: "submit" })).toBe(true);
  });

  it("exports a strict JSON schema descriptor for future structured LLM output", () => {
    expect(AGENT_PLAN_JSON_SCHEMA.name).toBe("agent_plan_v1");
    expect(AGENT_PLAN_JSON_SCHEMA.strict).toBe(true);
    expect(AGENT_PLAN_JSON_SCHEMA.schema.required).toContain("steps");
  });
});
