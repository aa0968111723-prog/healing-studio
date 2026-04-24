import { describe, expect, it } from "vitest";
import {
  adaptAgentPlanToActions,
  extractJsonObjectFromText,
} from "../shared/agent-plan-adapter";

describe("agent-plan-adapter", () => {
  it("extracts JSON from fenced planner output", () => {
    const json = extractJsonObjectFromText("hello```json\n{\"ok\":true}\n```bye");
    expect(json).toEqual({ ok: true });
  });

  it("converts a valid executable AgentPlan into a runWorkflow action", () => {
    const result = adaptAgentPlanToActions({
      schemaVersion: "agent-plan.v1",
      intent: "make poster",
      confidence: 0.9,
      summaryForUser: "我會幫你填入提示詞。",
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
          action: { type: "fillPrompt", text: "電影感海報" },
        },
      ],
    });

    expect(result.status).toBe("converted");
    expect(result.ok).toBe(true);
    expect(result.askBeforeAct).toBe(false);
    expect(result.actions[0]).toMatchObject({
      type: "runWorkflow",
      name: "make poster",
    });
  });

  it("returns clarification instead of actions", () => {
    const result = adaptAgentPlanToActions({
      schemaVersion: "agent-plan.v1",
      intent: "unclear request",
      confidence: 0.4,
      summaryForUser: "我需要更多資訊。",
      shouldAskClarification: true,
      clarificationQuestion: "你想做圖片還是影片？",
      warnings: [],
      steps: [],
    });

    expect(result.status).toBe("clarification");
    expect(result.ok).toBe(true);
    expect(result.actions).toEqual([]);
    expect(result.reply).toContain("圖片還是影片");
  });

  it("blocks unsafe high-risk plans", () => {
    const result = adaptAgentPlanToActions({
      schemaVersion: "agent-plan.v1",
      intent: "submit without approval",
      confidence: 0.9,
      summaryForUser: "我要送出。",
      shouldAskClarification: false,
      warnings: [],
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
    });

    expect(result.status).toBe("blocked");
    expect(result.ok).toBe(false);
    expect(result.askBeforeAct).toBe(true);
    expect(result.blockers.map(issue => issue.reason)).toContain("high_risk_without_approval");
  });

  it("marks approved submit plans as converted but requiring askBeforeAct", () => {
    const result = adaptAgentPlanToActions({
      schemaVersion: "agent-plan.v1",
      intent: "submit with approval",
      confidence: 0.9,
      summaryForUser: "我要送出。",
      shouldAskClarification: false,
      warnings: [],
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
    });

    expect(result.status).toBe("converted");
    expect(result.ok).toBe(true);
    expect(result.askBeforeAct).toBe(true);
    expect(result.actions[0]?.type).toBe("runWorkflow");
  });

  it("returns invalid for non-json planner output", () => {
    const result = adaptAgentPlanToActions("not json at all");
    expect(result.status).toBe("invalid");
    expect(result.ok).toBe(false);
    expect(result.actions).toEqual([]);
  });
});
