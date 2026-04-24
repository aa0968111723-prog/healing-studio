/**
 * orb-router.test.ts
 *
 * Router round-trip 測試：確保前端 `ChatAttachment[]` 進入
 * `ai.chat` tRPC 路由時，不會在 zod 解析或 planner 派發過程被
 * 退化成純文字。
 *
 * 覆蓋的 contract：
 *   - 前端透過 `chatMessageToLLMContent({ text, attachments })` 構造的
 *     multimodal content 陣列必須通過 router input zod schema (`OrbChatRouterMessageSchema`)
 *     並保留 image_url / file_url 結構。
 *   - parsed 後的 messages 餵給 `runSchemaFirstAgentPlanner` 時，
 *     `hasMultimodalPlannerInput` 必須回 true，讓 LLM 路由到 Gemini
 *     (`preferEngine: "gemini"`)。
 *   - 不支援格式由前端 helper (`assertSupportedOrbAttachmentMimeType`)
 *     直接以 friendly fallback 拒絕，連 router 都進不去。
 */

import { describe, expect, it } from "vitest";
import {
  OrbChatRouterMessageSchema,
  ORB_UNSUPPORTED_ATTACHMENT_MESSAGE,
  assertSupportedOrbAttachmentMimeType,
  chatMessageToLLMContent,
  type OrbChatAttachment,
  type OrbChatLLMMessagePart,
} from "../shared/orb-chat-multimodal";
import {
  collectMultimodalParts,
  hasMultimodalPlannerInput,
  runSchemaFirstAgentPlanner,
} from "./services/agentPlanner";
import type { InvokeParams, InvokeResult, Message } from "./_core/llm";

function buildChatAttachment(overrides: Partial<OrbChatAttachment>): OrbChatAttachment {
  return {
    id: "att",
    name: "file",
    url: "https://cdn.test/file",
    mimeType: "image/png",
    kind: "image",
    ...overrides,
  } as OrbChatAttachment;
}

function fakeInvokeResult(content: string): InvokeResult {
  return {
    id: "rt-test",
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

const validPlanJson = JSON.stringify({
  schemaVersion: "agent-plan.v1",
  intent: "analyse upload",
  confidence: 0.9,
  summaryForUser: "我已收到附件並準備分析。",
  shouldAskClarification: false,
  warnings: [],
  steps: [
    {
      id: "analyse",
      label: "分析附件",
      pagePath: "/studio",
      riskLevel: "low",
      requiresApproval: false,
      undoable: true,
      action: { type: "fillPrompt", text: "請依附件描述生成分析報告" },
    },
  ],
});

describe("ai.chat router round-trip with ChatAttachment[]", () => {
  it("preserves image_url parts after zod parsing", () => {
    const attachment = buildChatAttachment({
      id: "img",
      name: "photo.png",
      url: "https://cdn.test/photo.png",
      mimeType: "image/png",
      kind: "image",
    });

    const wirePayload = {
      role: "user" as const,
      content: chatMessageToLLMContent({ text: "看圖", attachments: [attachment] }),
    };

    const parsed = OrbChatRouterMessageSchema.parse(wirePayload);

    expect(Array.isArray(parsed.content)).toBe(true);
    const parts = parsed.content as OrbChatLLMMessagePart[];
    expect(parts).toEqual(wirePayload.content);
    const imagePart = parts.find(p => p.type === "image_url");
    expect(imagePart).toBeDefined();
    expect(imagePart).toEqual({
      type: "image_url",
      image_url: { url: "https://cdn.test/photo.png", detail: "auto" },
    });
  });

  it("preserves audio/video/pdf file_url parts (no flattening to text)", () => {
    const attachments: OrbChatAttachment[] = [
      buildChatAttachment({
        id: "aud",
        name: "voice.mp3",
        url: "https://cdn.test/voice.mp3",
        mimeType: "audio/mpeg",
        kind: "audio",
      }),
      buildChatAttachment({
        id: "vid",
        name: "clip.mp4",
        url: "https://cdn.test/clip.mp4",
        mimeType: "video/mp4",
        kind: "video",
      }),
      buildChatAttachment({
        id: "pdf",
        name: "doc.pdf",
        url: "https://cdn.test/doc.pdf",
        mimeType: "application/pdf",
        kind: "pdf",
      }),
    ];

    const parsed = OrbChatRouterMessageSchema.parse({
      role: "user",
      content: chatMessageToLLMContent({ text: "整理一下", attachments }),
    });

    expect(typeof parsed.content).not.toBe("string");
    const parts = parsed.content as OrbChatLLMMessagePart[];
    const filePartMimeTypes = parts
      .filter(p => p.type === "file_url")
      .map(p => (p as Extract<OrbChatLLMMessagePart, { type: "file_url" }>).file_url.mime_type);
    expect(filePartMimeTypes).toEqual(["audio/mpeg", "video/mp4", "application/pdf"]);
  });

  it("rejects payloads that smuggle unsupported MIME types", () => {
    const result = OrbChatRouterMessageSchema.safeParse({
      role: "user",
      content: [
        { type: "text", text: "看一下這個檔" },
        {
          type: "file_url",
          file_url: { url: "https://cdn.test/archive.zip", mime_type: "application/zip" },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("client-side guard returns the friendly fallback for application/zip", () => {
    expect(() => assertSupportedOrbAttachmentMimeType("application/zip")).toThrow(
      ORB_UNSUPPORTED_ATTACHMENT_MESSAGE
    );
  });

  it("string-only ChatMessage stays as a plain string (no false multimodal)", () => {
    const parsed = OrbChatRouterMessageSchema.parse({
      role: "user",
      content: chatMessageToLLMContent({ text: "純文字訊息" }),
    });
    expect(typeof parsed.content).toBe("string");
    expect(parsed.content).toBe("純文字訊息");

    const plannerMessages: Message[] = [
      { role: "user", content: parsed.content as string },
    ];
    expect(hasMultimodalPlannerInput(plannerMessages)).toBe(false);
  });

  it("planner sees multimodal parts and routes the call to Gemini", async () => {
    const attachments: OrbChatAttachment[] = [
      buildChatAttachment({
        id: "img",
        name: "photo.png",
        url: "https://cdn.test/photo.png",
        mimeType: "image/png",
        kind: "image",
      }),
      buildChatAttachment({
        id: "aud",
        name: "voice.mp3",
        url: "https://cdn.test/voice.mp3",
        mimeType: "audio/mpeg",
        kind: "audio",
      }),
      buildChatAttachment({
        id: "vid",
        name: "clip.mp4",
        url: "https://cdn.test/clip.mp4",
        mimeType: "video/mp4",
        kind: "video",
      }),
      buildChatAttachment({
        id: "pdf",
        name: "doc.pdf",
        url: "https://cdn.test/doc.pdf",
        mimeType: "application/pdf",
        kind: "pdf",
      }),
    ];

    const wireMessage = OrbChatRouterMessageSchema.parse({
      role: "user",
      content: chatMessageToLLMContent({ text: "請統整這四個附件", attachments }),
    });

    const plannerMessages: Message[] = [
      {
        role: "user",
        content: wireMessage.content as Exclude<typeof wireMessage.content, string>,
      },
    ];

    expect(hasMultimodalPlannerInput(plannerMessages)).toBe(true);
    expect(collectMultimodalParts(plannerMessages).map(p => p.kind)).toEqual([
      "image",
      "audio",
      "video",
      "pdf",
    ]);

    let captured: InvokeParams | null = null;
    const result = await runSchemaFirstAgentPlanner({
      messages: plannerMessages,
      invoke: async params => {
        captured = params;
        return fakeInvokeResult(validPlanJson);
      },
    });

    expect(result.usedMultimodalPlanner).toBe(true);
    expect(result.status).toBe("converted");
    expect(captured?.preferEngine).toBe("gemini");
    expect(captured?.runName).toBe("orb-agent-gemini-multimodal-planner");
  });

  it("text-only planner call does NOT force preferEngine: gemini", async () => {
    let captured: InvokeParams | null = null;
    const result = await runSchemaFirstAgentPlanner({
      messages: [{ role: "user", content: "幫我做一張海報" }],
      invoke: async params => {
        captured = params;
        return fakeInvokeResult(validPlanJson);
      },
    });

    expect(result.usedMultimodalPlanner).toBe(false);
    expect(captured?.preferEngine).toBeUndefined();
    expect(captured?.runName).toBe("orb-agent-schema-first-planner");
  });
});
