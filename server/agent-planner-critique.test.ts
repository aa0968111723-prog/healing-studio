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

// Plans with N submit-without-prompt warnings. critiquePlan scores
// `100 - warnings*8`, so 1→92, 2→84, 3→76 — a deterministic, strictly
// descending ladder we use to drive the bounded-iteration tests. Each
// submit gets a distinct delayMs so consecutive steps are never flagged
// redundant (redundant-step would add extra warnings and skew the score).
function submitOnlyPlan(planId: string, submitCount: number) {
  return {
    ...cleanPlan,
    planId,
    steps: Array.from({ length: submitCount }, (_unused, i) => ({
      id: `submit_${i}`,
      label: `送出 ${i}`,
      pagePath: "/studio",
      riskLevel: "high",
      requiresApproval: true,
      undoable: false,
      action: { type: "submit", delayMs: i * 10 },
    })),
  };
}
const oneWarnPlan = submitOnlyPlan("plan-1warn", 1); // score 92
const twoWarnPlan = submitOnlyPlan("plan-2warn", 2); // score 84
const threeWarnPlan = submitOnlyPlan("plan-3warn", 3); // score 76

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

  // ── Bounded-iterative refine (Reflection pattern, AIDV-657) ──────────────

  it("達標即停: stops as soon as the critic is satisfied, even with rounds left", async () => {
    // Healthy draft (score 100 ≥ default refineBelow 75) → no refine fires
    // regardless of how high maxRefineRounds is set.
    let calls = 0;
    const result = await runSchemaFirstAgentPlannerWithCritique({
      messages: [{ role: "user", content: "做海報" }],
      enableCritique: true,
      maxRefineRounds: 3,
      invoke: async () => {
        calls += 1;
        return invokeResult(JSON.stringify(cleanPlan));
      },
    });
    expect(calls).toBe(1);
    expect(result.critiqueRounds).toBe(0);
    expect(result.critiqueRefined).toBe(false);
    expect(result.critique?.shouldRefine).toBe(false);
  });

  it("觸頂即停: keeps refining while improving, then stops at maxRefineRounds", async () => {
    // refineBelow 95 keeps every plan below the satisfaction bar; scores
    // climb 76 → 84 → 92 so the no-improvement guard never trips, and the
    // loop is bounded by maxRefineRounds=2 (1 draft + 2 refine = 3 calls).
    const calls: InvokeParams[] = [];
    const sequence = [threeWarnPlan, twoWarnPlan, oneWarnPlan]; // 76, 84, 92
    const result = await runSchemaFirstAgentPlannerWithCritique({
      messages: [{ role: "user", content: "幫我送出" }],
      enableCritique: true,
      critiqueRefineBelow: 95,
      maxRefineRounds: 2,
      invoke: async () => {
        const plan = sequence[Math.min(calls.length, sequence.length - 1)];
        calls.push({} as InvokeParams);
        return invokeResult(JSON.stringify(plan));
      },
    });
    expect(calls.length).toBe(3);
    expect(result.critiqueRounds).toBe(2);
    expect(result.critiqueRefined).toBe(true);
    expect(result.critique?.score).toBe(92); // best (last) plan returned
  });

  it("無改善即停: bails before the cap when a refine fails to beat the best score", async () => {
    // Draft scores 92; every refine returns the same 92 plan → the
    // no-improvement guard stops after a single refine even though
    // maxRefineRounds=3.
    const calls: InvokeParams[] = [];
    const result = await runSchemaFirstAgentPlannerWithCritique({
      messages: [{ role: "user", content: "幫我送出" }],
      enableCritique: true,
      critiqueRefineBelow: 95,
      maxRefineRounds: 3,
      invoke: async () => {
        calls.push({} as InvokeParams);
        return invokeResult(JSON.stringify(oneWarnPlan)); // always 92
      },
    });
    expect(calls.length).toBe(2); // 1 draft + 1 refine, then bail
    expect(result.critiqueRounds).toBe(1);
    expect(result.critique?.score).toBe(92);
  });

  it("best-of: returns the highest-scoring plan, never a later regression", async () => {
    // 84 (draft) → 92 (improves, adopted) → 76 (regresses, rejected).
    // The returned plan must be the 92 one, not the final 76 round.
    const calls: InvokeParams[] = [];
    const sequence = [twoWarnPlan, oneWarnPlan, threeWarnPlan]; // 84, 92, 76
    const result = await runSchemaFirstAgentPlannerWithCritique({
      messages: [{ role: "user", content: "幫我送出" }],
      enableCritique: true,
      critiqueRefineBelow: 95,
      maxRefineRounds: 3,
      invoke: async () => {
        const plan = sequence[Math.min(calls.length, sequence.length - 1)];
        calls.push({} as InvokeParams);
        return invokeResult(JSON.stringify(plan));
      },
    });
    expect(calls.length).toBe(3); // draft + 2 refine (2nd regresses → stop)
    expect(result.critiqueRounds).toBe(2);
    expect(result.critique?.score).toBe(92); // kept the best, dropped the 76
  });
});
