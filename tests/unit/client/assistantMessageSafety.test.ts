import { describe, expect, it } from "vitest";
import { safeRenderAssistantMessage } from "../../../client/src/lib/assistantMessageSafety";

describe("safeRenderAssistantMessage", () => {
  it("only renders final_user_message", () => {
    const result = safeRenderAssistantMessage({
      final_user_message: { text: "hello" },
      raw_model_output: "SHOULD_NOT_RENDER",
      tool_trace: [{ secret: 1 }],
    });
    expect(result.text).toBe("hello");
    expect(result.fallback).toBe(false);
  });

  it("falls back on suspicious serialized strings", () => {
    const longGarbage = "eyJ" + "A".repeat(500);
    const result = safeRenderAssistantMessage({
      final_user_message: { text: longGarbage },
      traceId: "trace_123",
    });
    expect(result.fallback).toBe(true);
    expect(result.text).toContain("系統繁忙");
    expect(result.traceId).toBe("trace_123");
  });
});
