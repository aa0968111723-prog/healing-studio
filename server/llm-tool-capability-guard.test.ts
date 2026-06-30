/**
 * llm-tool-capability-guard.test.ts — AIDV-887
 *
 * 驗證：engineConfig.supportsToolCalling=false 時，invokeLLM 不把
 * tools / tool_choice 送進 HTTP payload，避免 freellmapi 等不支援
 * tool calling 的 provider 收到非法欄位而靜默失敗。
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.FREE_LLM_API_ENABLED = "true";
  process.env.FREE_LLM_API_URL = "https://api.freellmapi.com";
});

import { invokeLLM } from "./_core/llm";

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

function mockFreellmapiFetch(response: object): {
  fetchMock: ReturnType<typeof vi.fn>;
  captured: CapturedRequest[];
} {
  const captured: CapturedRequest[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    captured.push({
      url: url as string,
      body: JSON.parse((init?.body as string) ?? "{}"),
    });
    return {
      ok: true,
      status: 200,
      json: async () => response,
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, captured };
}

const DUMMY_TOOL = {
  type: "function" as const,
  function: {
    name: "get_weather",
    description: "Get current weather",
    parameters: {
      type: "object",
      properties: { location: { type: "string" } },
      required: ["location"],
    },
  },
};

const FREELLMAPI_RESPONSE = {
  id: "chatcmpl-test",
  object: "chat.completion",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hello from free LLM" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe("AIDV-887: tool calling capability guard", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("freellmapi（supportsToolCalling=false）不在 payload 送出 tools", async () => {
    const { captured } = mockFreellmapiFetch(FREELLMAPI_RESPONSE);

    await invokeLLM({
      messages: [{ role: "user", content: "Hello" }],
      tools: [DUMMY_TOOL],
      toolChoice: "auto",
      engine: "freellmapi",
    });

    expect(captured).toHaveLength(1);
    const payload = captured[0]!.body;
    expect(payload).not.toHaveProperty("tools");
    expect(payload).not.toHaveProperty("tool_choice");
  });

  it("freellmapi 沒有 tools 的正常呼叫仍正常運作", async () => {
    const { captured } = mockFreellmapiFetch(FREELLMAPI_RESPONSE);

    const result = await invokeLLM({
      messages: [{ role: "user", content: "Hello" }],
      engine: "freellmapi",
    });

    expect(captured).toHaveLength(1);
    expect(result.choices[0]?.message.content).toBe("Hello from free LLM");
  });
});
