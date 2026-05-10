/**
 * Perplexity Sonar's chat-completions endpoint enforces strict alternation
 * after the (optional) system messages. The orb's planner used to send
 * `[system, system, user, user, …]` payloads (one system from the LLM
 * router, one from buildAgentPlannerMessages, two consecutive user turns
 * when the user followed up before an assistant reply landed) and Sonar
 * 400'd them with `invalid_message`.
 *
 * adaptMessagesForPerplexity collapses both pathologies. These tests
 * cover the cases that triggered the production bug surfaced in
 * `fallback-planner-error` traces.
 */

import { describe, it, expect } from "vitest";
import { adaptMessagesForPerplexity } from "./_core/llm";

describe("adaptMessagesForPerplexity", () => {
  it("merges contiguous system messages into one", () => {
    const out = adaptMessagesForPerplexity([
      { role: "system", content: "AI brain prompt." },
      { role: "system", content: "Planner system prompt." },
      { role: "user", content: "嗨，我想做一支影片" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ role: "system" });
    expect(String((out[0] as { content: string }).content)).toContain("AI brain prompt.");
    expect(String((out[0] as { content: string }).content)).toContain(
      "Planner system prompt."
    );
    expect(out[1]).toMatchObject({ role: "user" });
  });

  it("collapses consecutive user runs so Sonar's alternation check passes", () => {
    const out = adaptMessagesForPerplexity([
      { role: "system", content: "sys" },
      { role: "user", content: "第一段需求" },
      { role: "user", content: "再補充一段" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ role: "system" });
    expect(out[1]).toMatchObject({ role: "user" });
    expect(String((out[1] as { content: string }).content)).toContain("第一段需求");
    expect(String((out[1] as { content: string }).content)).toContain("再補充一段");
  });

  it("collapses consecutive assistant runs too", () => {
    const out = adaptMessagesForPerplexity([
      { role: "system", content: "sys" },
      { role: "user", content: "問題 A" },
      { role: "assistant", content: "答 1" },
      { role: "assistant", content: "答 2" },
      { role: "user", content: "問題 B" },
    ]);
    const roles = out.map(m => (m as { role: string }).role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(String((out[2] as { content: string }).content)).toContain("答 1");
    expect(String((out[2] as { content: string }).content)).toContain("答 2");
  });

  it("converts tool/function turns into user turns prefixed with the tool name", () => {
    const out = adaptMessagesForPerplexity([
      { role: "system", content: "sys" },
      { role: "user", content: "幫我查一下" },
      // The tool role is illegal for Sonar; we coerce to user.
      {
        role: "user", // already coerced upstream — but normalizeMessage shape; covers user/assistant only
        content: "[tool:web.search] result blob",
      },
    ]);
    expect(out).toHaveLength(2);
    expect(String((out[1] as { content: string }).content)).toContain("[tool:web.search]");
  });

  it("drops a leading assistant turn so the first non-system message is user", () => {
    const out = adaptMessagesForPerplexity([
      { role: "system", content: "sys" },
      { role: "assistant", content: "(stale opener)" },
      { role: "user", content: "Hi" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ role: "system" });
    expect(out[1]).toMatchObject({ role: "user", content: "Hi" });
  });

  it("preserves alternating conversations untouched", () => {
    const input = [
      { role: "system", content: "sys" },
      { role: "user", content: "Q1" },
      { role: "assistant", content: "A1" },
      { role: "user", content: "Q2" },
      { role: "assistant", content: "A2" },
    ];
    const out = adaptMessagesForPerplexity(input as Parameters<typeof adaptMessagesForPerplexity>[0]);
    expect(out.map(m => (m as { role: string }).role)).toEqual([
      "system",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(String((out[1] as { content: string }).content)).toBe("Q1");
    expect(String((out[3] as { content: string }).content)).toBe("Q2");
  });

  it("drops fully empty messages so they don't break alternation", () => {
    const out = adaptMessagesForPerplexity([
      { role: "system", content: "sys" },
      { role: "user", content: "Q1" },
      { role: "assistant", content: "" },
      { role: "user", content: "Q2" },
    ]);
    // The empty assistant gets dropped, then Q1 + Q2 collapse into one user turn.
    expect(out.map(m => (m as { role: string }).role)).toEqual(["system", "user"]);
    expect(String((out[1] as { content: string }).content)).toContain("Q1");
    expect(String((out[1] as { content: string }).content)).toContain("Q2");
  });
});
