/**
 * server/agent-planner-critique.test.ts
 *
 * Integration: `runSchemaFirstAgentPlannerWithCritique` runs the critic
 * against the converted workflow and, when `shouldRefine` is true, fires
 * one extra LLM round trip with the refine prompt before returning.
 */
import { describe, expect, it } from "vitest";
import type { InvokeParams, InvokeResult, Message } from "./_core/llm";
import { runSchemaFirstAgentPlannerWithCritique } from "./services/agentPlanner";

function invokeResult(content: string): InvokeResult {
  return {
    id: "test",
    created: Date.now(),
    model: "test-model",
    choices: [
      { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
    ],
  };
}

const cleanPlan = {
  schemaVersion: "agent-plan.v3",
  planId: "test-plan-clean",
  intent: "make poster",
  confidence: 0.9,
  summaryForUser: "我會帶你到 /studio 並填入提示詞。",
  decision: { mode: "tasked", reason: "tasked work" },
  warnings: [],
  routing: { preferredEngine: "auto", capabilities: ["multimodal"], pageScope: "single" },
  safety: { riskLevel: "low", requiresHuman: false, reasons: [] },
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
    {
      id: "submit",
      label: "送出",
      pagePath: "/studio",
      riskLevel: "high",
      requiresApproval: true,
      undoable: false,
      action: { type: "submit" },
    },
  ],
};

const dirtyPlan = {
  ...cleanPlan,
  steps: [
    {
      id: "submit",
      label: "送出",
      pagePath: "/studio",
      riskLevel: "high",
      requiresApproval: true,
      undoable: false,
      action: { type: "submit" }, // submit-without-prompt warning
    },
  ],
};

describe("runSchemaFirstAgentPlannerWithCritique", () => {
  it("does not run a refine pass when enableCritique is false", async () => {
    let calls = 0;
    const messages: Message[] = [{ role: "user", content: "做海報" }];
    const result = await runSchemaFirstAgentPlannerWithCritique({
      messages,
      enableCritique: false,
      invoke: async () => {
        calls += 1;
        return invokeResult(JSON.stringify(cleanPlan));
      },
    });
    expect(calls).toBe(1);
    expect(result.critique).toBeNull();
    expect(result.critiqueRefined).toBe(false);
  });

  it("runs a refine pass when the draft has issues and enableCritique=true", async () => {
    const calls: InvokeParams[] = [];
    const messages: Message[] = [{ role: "user", content: "幫我送出" }];
    const result = await runSchemaFirstAgentPlannerWithCritique({
      messages,
      enableCritique: true,
      // submit-without-prompt is a warning (score 92); raise the floor
      // so any warning forces a refine.
      critiqueRefineBelow: 95,
      invoke: async params => {
        calls.push(params);
        const round = calls.length;
        return invokeResult(JSON.stringify(round === 1 ? dirtyPlan : cleanPlan));
      },
    });
    expect(calls.length).toBe(2);
    expect(result.critiqueRefined).toBe(true);
    // Refine call's user message should contain the critique prompt.
    const refineMessages = calls[1].messages;
    const lastUserMsg = refineMessages.filter(m => m.role === "user").pop();
    expect(String(lastUserMsg?.content ?? "")).toMatch(/分數：/);
    expect(String(lastUserMsg?.content ?? "")).toMatch(/原始計畫/);
  });

  it("skips refine when the draft is healthy (score >= refineBelow)", async () => {
    let calls = 0;
    const messages: Message[] = [{ role: "user", content: "做海報" }];
    const result = await runSchemaFirstAgentPlannerWithCritique({
      messages,
      enableCritique: true,
      invoke: async () => {
        calls += 1;
        return invokeResult(JSON.stringify(cleanPlan));
      },
    });
    expect(calls).toBe(1);
    expect(result.critique).not.toBeNull();
    expect(result.critique?.shouldRefine).toBe(false);
    expect(result.critiqueRefined).toBe(false);
  });

  it("skips refine for non-converted statuses (clarification / blocked / invalid)", async () => {
    let calls = 0;
    const messages: Message[] = [{ role: "user", content: "..." }];
    const clarifyPlan = {
      ...cleanPlan,
      decision: { mode: "clarification", reason: "ambiguous" },
      clarificationQuestion: "你想做哪一種？",
    };
    const result = await runSchemaFirstAgentPlannerWithCritique({
      messages,
      enableCritique: true,
      invoke: async () => {
        calls += 1;
        return invokeResult(JSON.stringify(clarifyPlan));
      },
    });
    expect(calls).toBe(1);
    expect(result.critique).toBeNull();
    expect(result.critiqueRefined).toBe(false);
  });
});
