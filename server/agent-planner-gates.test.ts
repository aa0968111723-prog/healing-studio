/**
 * agent-planner-gates.test.ts — Phase 2 Planner-side modality + moderation gate.
 *
 * `runSchemaFirstAgentPlanner` now applies two safety gates after parseAndGatePlan:
 *   1. Modality coherence — when the user declared "video" but the plan
 *      navigated to /image-studio, replan once with an explicit refine prompt.
 *   2. Content moderation — when the planner reply hits violence/hate/explicit,
 *      flip status to "blocked" and replace the reply with a safe redirect.
 *
 * These tests pin the three E2E scenarios from
 * `docs/agent/light-ball-agent-enhancement-plan.md` §3.
 */

import { describe, expect, it } from "vitest";
import type { InvokeParams, InvokeResult } from "./_core/llm";
import { runSchemaFirstAgentPlanner } from "./services/agentPlanner";

function invokeResult(content: string): InvokeResult {
  return {
    id: "test",
    created: Date.now(),
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  };
}

function makeV1Plan(opts: {
  pagePath: string;
  summary?: string;
  intent?: string;
  actionText?: string;
}) {
  return {
    schemaVersion: "agent-plan.v1",
    intent: opts.intent ?? "make ig reels",
    confidence: 0.9,
    summaryForUser: opts.summary ?? "我會幫你產出 30 秒影片。",
    shouldAskClarification: false,
    warnings: [],
    steps: [
      {
        id: "navigate-target",
        label: "前往工作室",
        pagePath: opts.pagePath,
        riskLevel: "low",
        requiresApproval: false,
        undoable: true,
        action: { type: "fillPrompt", text: opts.actionText ?? "30 秒影片" },
      },
    ],
  };
}

describe("Phase 2 — Planner safety gates", () => {
  it("IG Reels 30s happy path: video declared + video plan = no replan, no block", async () => {
    let callCount = 0;
    const result = await runSchemaFirstAgentPlanner({
      messages: [
        { role: "user", content: "幫我做一支 30 秒 IG Reels 預告片" },
      ],
      invoke: async (_params: InvokeParams) => {
        callCount += 1;
        return invokeResult(
          JSON.stringify(makeV1Plan({ pagePath: "/video-studio" }))
        );
      },
    });

    expect(callCount).toBe(1); // no replan
    expect(result.status).toBe("converted");
    expect(
      result.warnings.some(w => w.startsWith("Modality replan triggered:"))
    ).toBe(false);
    expect(
      result.warnings.some(w => w.startsWith("Content moderation"))
    ).toBe(false);
  });

  it("Modality mismatch: video declared but /image-studio selected → single-pass replan", async () => {
    const responses = [
      makeV1Plan({ pagePath: "/image-studio" }), // 1st call: wrong modality
      makeV1Plan({ pagePath: "/video-studio" }), // replan: corrected
    ];
    let callCount = 0;
    const result = await runSchemaFirstAgentPlanner({
      messages: [
        { role: "user", content: "幫我做一支 30 秒 IG Reels 預告片" },
      ],
      invoke: async (_params: InvokeParams) => {
        const reply = responses[Math.min(callCount, responses.length - 1)];
        callCount += 1;
        return invokeResult(JSON.stringify(reply));
      },
    });

    expect(callCount).toBe(2); // replan happened exactly once
    expect(result.status).toBe("converted");
    expect(
      result.warnings.some(w => w.startsWith("Modality replan triggered:"))
    ).toBe(true);
  });

  it("Modality replan caps at one extra LLM call even when replan still mismatches", async () => {
    let callCount = 0;
    const result = await runSchemaFirstAgentPlanner({
      messages: [
        { role: "user", content: "幫我做一支 30 秒 IG Reels 預告片" },
      ],
      invoke: async (_params: InvokeParams) => {
        callCount += 1;
        return invokeResult(
          JSON.stringify(makeV1Plan({ pagePath: "/image-studio" }))
        );
      },
    });

    expect(callCount).toBe(2); // replanned once, then accepted whatever came back
    expect(result.status).toBe("converted");
  });

  it("Moderation block: planner reply with violence pattern → status='blocked', actions cleared", async () => {
    const result = await runSchemaFirstAgentPlanner({
      messages: [{ role: "user", content: "幫我寫個故事" }],
      invoke: async () =>
        invokeResult(
          JSON.stringify(
            makeV1Plan({
              pagePath: "/studio",
              summary: "Sure, I will kill them all in the next scene.",
              intent: "story",
            })
          )
        ),
    });

    expect(result.status).toBe("blocked");
    expect(result.actions).toEqual([]);
    expect(
      result.warnings.some(w => w.startsWith("Content moderation blocked reply"))
    ).toBe(true);
    expect(result.reply).toContain("抱歉");
  });

  it("No modality signal in user text → gate is silent (no false-positive replan)", async () => {
    let callCount = 0;
    const result = await runSchemaFirstAgentPlanner({
      messages: [{ role: "user", content: "你好" }],
      invoke: async () => {
        callCount += 1;
        return invokeResult(
          JSON.stringify(makeV1Plan({ pagePath: "/image-studio" }))
        );
      },
    });

    expect(callCount).toBe(1);
    expect(result.status).toBe("converted");
    expect(
      result.warnings.some(w => w.startsWith("Modality replan triggered:"))
    ).toBe(false);
  });
});
