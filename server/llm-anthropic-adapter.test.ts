/**
 * llm-anthropic-adapter.test.ts — Anthropic /v1/messages adapter
 *
 * Verifies that invokeLLM, when routed to the Anthropic engine, correctly:
 *   1. Hits api.anthropic.com/v1/messages with x-api-key + anthropic-version
 *   2. Lifts system messages out of `messages` into a top-level `system` field
 *   3. Converts OpenAI-style tools → Anthropic tools (input_schema, no nested function)
 *   4. Converts the response (content blocks) back into the InvokeResult shape
 *      that the rest of the codebase consumes — including tool_calls round-trip
 *
 * These tests mock fetch (no network) so they're safe to run in CI.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
});

import { invokeLLM } from "./_core/llm";

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function mockAnthropicFetch(response: object): {
  fetchMock: ReturnType<typeof vi.fn>;
  captured: CapturedRequest[];
} {
  const captured: CapturedRequest[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    captured.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, captured };
}

describe("llm anthropic adapter", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("hits /v1/messages with x-api-key + anthropic-version headers", async () => {
    const { captured } = mockAnthropicFetch({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5-20251001",
      content: [{ type: "text", text: "hi" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 2 },
    });

    await invokeLLM({
      engine: "anthropic",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(captured[0].headers["x-api-key"]).toBe("test-anthropic-key");
    expect(captured[0].headers["anthropic-version"]).toBe("2023-06-01");
    // Crucially: no Bearer auth — Anthropic rejects that with 401.
    expect(captured[0].headers.authorization).toBeUndefined();
  });

  it("lifts system messages into top-level system field, drops them from messages", async () => {
    const { captured } = mockAnthropicFetch({
      id: "msg_2",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5-20251001",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });

    await invokeLLM({
      engine: "anthropic",
      messages: [
        { role: "system", content: "you are an orb agent" },
        { role: "user", content: "do thing" },
      ],
    });

    const body = captured[0].body;
    expect(body.system).toBe("you are an orb agent");
    expect(body.messages).toEqual([{ role: "user", content: "do thing" }]);
  });

  it("converts OpenAI-style tools to Anthropic tools (input_schema, flat shape)", async () => {
    const { captured } = mockAnthropicFetch({
      id: "msg_3",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5-20251001",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });

    await invokeLLM({
      engine: "anthropic",
      messages: [{ role: "user", content: "do" }],
      tools: [
        {
          type: "function",
          function: {
            name: "navigate",
            description: "Navigate to a path",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        },
      ],
      toolChoice: "auto",
    });

    const tools = captured[0].body.tools as unknown as Array<{
      name: string;
      description?: string;
      input_schema: Record<string, unknown>;
    }>;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("navigate");
    expect(tools[0].description).toBe("Navigate to a path");
    expect(tools[0].input_schema).toMatchObject({
      type: "object",
      properties: { path: { type: "string" } },
    });
    // Anthropic does NOT use the nested OpenAI shape:
    expect(tools[0]).not.toHaveProperty("function");
    expect(captured[0].body.tool_choice).toEqual({ type: "auto" });
  });

  it("converts Anthropic content blocks back to InvokeResult choices[]", async () => {
    mockAnthropicFetch({
      id: "msg_4",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5-20251001",
      content: [{ type: "text", text: "hello, world" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 4 },
    });

    const result = await invokeLLM({
      engine: "anthropic",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.role).toBe("assistant");
    expect(result.choices[0].message.content).toBe("hello, world");
    expect(result.choices[0].finish_reason).toBe("stop");
    expect(result.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 4,
      total_tokens: 14,
    });
  });

  it("converts tool_use blocks back to OpenAI-style tool_calls (orb dispatch path)", async () => {
    mockAnthropicFetch({
      id: "msg_5",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5-20251001",
      content: [
        { type: "text", text: "I'll navigate." },
        {
          type: "tool_use",
          id: "tu_1",
          name: "navigate",
          input: { path: "/studio" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 8, output_tokens: 6 },
    });

    const result = await invokeLLM({
      engine: "anthropic",
      messages: [{ role: "user", content: "take me to studio" }],
      tools: [
        {
          type: "function",
          function: {
            name: "navigate",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        },
      ],
    });

    expect(result.choices[0].finish_reason).toBe("tool_calls");
    const toolCalls = result.choices[0].message.tool_calls;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls?.[0].function.name).toBe("navigate");
    expect(JSON.parse(toolCalls?.[0].function.arguments ?? "{}")).toEqual({
      path: "/studio",
    });
  });

  it("remaps gemini-2.5-flash → claude-haiku-4-5 when caller forces anthropic", async () => {
    const { captured } = mockAnthropicFetch({
      id: "msg_6",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5-20251001",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
    });

    await invokeLLM({
      engine: "anthropic",
      messages: [{ role: "user", content: "hi" }],
      // Caller asked for a Gemini model id, but engine is anthropic — adapter
      // must remap so we don't send "gemini-2.5-flash" to api.anthropic.com.
      model: "gemini-2.5-flash",
    });

    expect(captured[0].body.model).toContain("claude-haiku");
    expect(captured[0].body.model).not.toContain("gemini");
  });
});
