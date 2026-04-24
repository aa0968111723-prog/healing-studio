import { describe, expect, it } from "vitest";
import type { InvokeResult, Message } from "./_core/llm";
import {
  buildAgentPlannerMessages,
  plannerResultShouldFallback,
  runSchemaFirstAgentPlanner,
  summarizePageSnapshotForPlanner,
} from "./services/agentPlanner";

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

const validPlan = {
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
};

describe("agentPlanner", () => {
  it("summarizes page capabilities for planner prompt", () => {
    const summary = summarizePageSnapshotForPlanner({
      pageId: "studio",
      pageLabel: "創作工作室",
      pagePath: "/studio",
      capabilities: [
        {
          action: "fillPrompt",
          label: "填提示詞",
          options: [{ id: "main", label: "主提示詞" }],
        },
      ],
      state: { modality: "image" },
    });

    expect(summary).toContain("studio");
    expect(summary).toContain("fillPrompt");
  });

  it("builds planner messages with system prompt and conversation", () => {
    const messages: Message[] = [{ role: "user", content: "幫我做海報" }];
    const built = buildAgentPlannerMessages({
      messages,
      context: "current page /studio",
      personality: "creative",
    });

    expect(built[0].role).toBe("system");
    expect(String(built[0].content)).toContain("schema-first planning layer");
    expect(built.at(-1)?.content).toBe("幫我做海報");
  });

  it("runs LLM planner and converts valid plan into workflow", async () => {
    const result = await runSchemaFirstAgentPlanner({
      messages: [{ role: "user", content: "幫我做海報" }],
      invoke: async () => invokeResult(JSON.stringify(validPlan)),
    });

    expect(result.plannerUsed).toBe(true);
    expect(result.status).toBe("converted");
    expect(result.actions[0]?.type).toBe("runWorkflow");
    expect(plannerResultShouldFallback(result)).toBe(false);
  });

  it("marks invalid planner output as fallback-worthy", async () => {
    const result = await runSchemaFirstAgentPlanner({
      messages: [{ role: "user", content: "幫我做海報" }],
      invoke: async () => invokeResult("not json"),
    });

    expect(result.status).toBe("invalid");
    expect(plannerResultShouldFallback(result)).toBe(true);
  });
});
