import { describe, expect, it } from "vitest";
import type { InvokeParams, InvokeResult, Message } from "./_core/llm";
import {
  buildAgentPlannerMessages,
  collectMultimodalParts,
  hasMultimodalPlannerInput,
  plannerResultShouldFallback,
  runSchemaFirstAgentPlanner,
  summarizeMultimodalInputsForPlanner,
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
      recentTaskMemorySummary: "recent-memory-summary",
      recentOrbMemorySummary: "recent-orb-memory-summary",
      siteKnowledgeSummary: "Current page: /studio",
    });

    expect(built[0].role).toBe("system");
    expect(String(built[0].content)).toContain("agent-plan.v3");
    expect(String(built[0].content)).toContain("recent-memory-summary");
    expect(String(built[0].content)).toContain("recent-orb-memory-summary");
    expect(String(built[0].content)).toContain("Site knowledge summary");
    expect(built.at(-1)?.content).toBe("幫我做海報");
  });

  it("detects and summarizes multimodal message parts", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "請分析這張照片" },
          { type: "image_url", image_url: { url: "https://cdn.test/photo.png" } },
          { type: "file_url", file_url: { url: "https://cdn.test/audio.mp3", mime_type: "audio/mpeg" } },
          { type: "file_url", file_url: { url: "https://cdn.test/video.mp4", mime_type: "video/mp4" } },
          { type: "file_url", file_url: { url: "https://cdn.test/doc.pdf", mime_type: "application/pdf" } },
        ],
      },
    ];

    const parts = collectMultimodalParts(messages);
    expect(parts.map(part => part.kind)).toEqual(["image", "audio", "video", "pdf"]);
    expect(hasMultimodalPlannerInput(messages)).toBe(true);
    expect(summarizeMultimodalInputsForPlanner(messages)).toContain("audio");
  });

  it("routes multimodal planner calls to Gemini", async () => {
    let captured: InvokeParams | null = null;
    const result = await runSchemaFirstAgentPlanner({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "請把這張圖做成影片" },
            { type: "image_url", image_url: { url: "https://cdn.test/photo.png" } },
          ],
        },
      ],
      invoke: async params => {
        captured = params;
        return invokeResult(JSON.stringify(validPlan));
      },
    });

    expect(result.usedMultimodalPlanner).toBe(true);
    expect(result.status).toBe("converted");
    expect(captured?.preferEngine).toBe("gemini");
    expect(captured?.runName).toBe("orb-agent-gemini-multimodal-planner");
  });

  it("runs LLM planner and converts valid plan into workflow", async () => {
    let captured: InvokeParams | null = null;
    const result = await runSchemaFirstAgentPlanner({
      messages: [{ role: "user", content: "幫我做海報" }],
      invoke: async params => {
        captured = params;
        return invokeResult(JSON.stringify(validPlan));
      },
    });

    expect(result.plannerUsed).toBe(true);
    expect(result.usedMultimodalPlanner).toBe(false);
    expect(result.status).toBe("converted");
    expect(result.actions[0]?.type).toBe("runWorkflow");
    expect(captured?.response_format?.type).toBe("json_schema");
    expect(
      (captured?.response_format as { json_schema?: { name?: string } } | undefined)?.json_schema?.name
    ).toBe("agent_plan_v3");
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

  it("v3 code task is materialised as tasked OrbTask draft + claudeCode engine", async () => {
    const v3CodePlan = {
      schemaVersion: "agent-plan.v3",
      planId: "task_code_001",
      intent: "scaffold a new tRPC router",
      summaryForUser: "我會幫你產生骨架。",
      decision: { mode: "tasked" },
      routing: { preferredEngine: "auto", capabilities: ["code"], pageScope: "single" },
      attachments: [],
      safety: { riskLevel: "medium", requiresHuman: true, reasons: [] },
      steps: [
        {
          id: "scaffold",
          label: "scaffold",
          pagePath: "/director",
          riskLevel: "medium",
          requiresApproval: true,
          undoable: false,
          action: { type: "fillPrompt", text: "scaffold tRPC router" },
        },
      ],
      taskPolicy: { needsApproval: true, isolation: "code", autoStart: false },
      warnings: [],
    };

    const result = await runSchemaFirstAgentPlanner({
      messages: [{ role: "user", content: "幫我寫一個 tRPC 路由" }],
      invoke: async () => invokeResult(JSON.stringify(v3CodePlan)),
    });

    expect(result.status).toBe("tasked");
    expect(result.preferredEngine).toBe("claudeCode");
    expect(result.task?.taskId).toBe("task_code_001");
    expect(result.actions).toEqual([]);
  });

  it("v3 multimodal plan upgrades preferredEngine to gemini even when LLM said auto", async () => {
    const v3MultimodalPlan = {
      schemaVersion: "agent-plan.v3",
      planId: "plan_mm_001",
      intent: "analyse user upload",
      summaryForUser: "我會幫你分析這個附件。",
      decision: { mode: "direct" },
      routing: { preferredEngine: "auto", capabilities: ["multimodal"], pageScope: "single" },
      attachments: [
        { kind: "image", mimeType: "image/png", url: "https://cdn.test/photo.png" },
      ],
      safety: { riskLevel: "medium", requiresHuman: false, reasons: [] },
      steps: [
        {
          id: "fill",
          label: "fill prompt",
          pagePath: "/studio",
          riskLevel: "medium",
          requiresApproval: false,
          undoable: true,
          action: { type: "fillPrompt", text: "describe upload" },
        },
      ],
      warnings: [],
    };

    const result = await runSchemaFirstAgentPlanner({
      messages: [{ role: "user", content: "幫我分析這張圖" }],
      invoke: async () => invokeResult(JSON.stringify(v3MultimodalPlan)),
    });

    expect(result.preferredEngine).toBe("gemini");
    expect(["medium", "high"]).toContain(result.riskEvaluation?.riskLevel);
    if (result.version === "agent-plan.v3") {
      expect(result.plan.routing.capabilities).toContain("multimodal");
    }
  });

  it("v3 blocked plan returns no actions and asks for confirmation", async () => {
    const v3BlockedPlan = {
      schemaVersion: "agent-plan.v3",
      planId: "plan_blocked",
      intent: "submit",
      summaryForUser: "我要送出。",
      decision: { mode: "direct" },
      routing: { preferredEngine: "auto", capabilities: [], pageScope: "single" },
      attachments: [],
      safety: { riskLevel: "high", requiresHuman: true, reasons: [] },
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
      warnings: [],
    };

    const result = await runSchemaFirstAgentPlanner({
      messages: [{ role: "user", content: "送出" }],
      invoke: async () => invokeResult(JSON.stringify(v3BlockedPlan)),
    });

    expect(result.status).toBe("blocked");
    expect(result.actions).toEqual([]);
    expect(result.askBeforeAct).toBe(true);
  });
});
