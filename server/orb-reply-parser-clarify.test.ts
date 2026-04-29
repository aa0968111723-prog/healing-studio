/**
 * orb-reply-parser-clarify.test.ts
 *
 * Verifies the clarification surface area of `parseOrbReply`:
 *
 * 1. JSON shouldAskClarification=true → needsClarification=true,
 *    actions cleared, clarificationQuestion / clarificationOptions extracted.
 * 2. JSON plannerOutput.decision.mode==="clarification" → same effect.
 * 3. Marker fallback `[CLARIFY:...]` recognised.
 * 4. No clarification signal → needsClarification=false, actions preserved.
 * 5. Clarification forces askBeforeAct=true and drops actions even if LLM
 *    accidentally also sent destructive ones.
 */

import { describe, expect, it } from "vitest";
import { parseOrbReply } from "./services/orbReplyParser";

describe("parseOrbReply clarification handling", () => {
  it("extracts clarificationQuestion + options from JSON shouldAskClarification", () => {
    const raw = JSON.stringify({
      reply: "我需要先確認你想做的事情。",
      shouldAskClarification: true,
      clarificationQuestion: "你想要圖片、影片，還是腳本？",
      clarificationOptions: ["圖片", "影片", "腳本"],
      actions: [
        // Even if LLM sneaks in actions, they must be dropped in clarify mode.
        { type: "navigate", path: "/studio" },
      ],
    });

    const parsed = parseOrbReply(raw);
    expect(parsed.needsClarification).toBe(true);
    expect(parsed.clarificationQuestion).toBe("你想要圖片、影片，還是腳本？");
    expect(parsed.clarificationOptions).toEqual(["圖片", "影片", "腳本"]);
    expect(parsed.actions).toEqual([]);
    expect(parsed.askBeforeAct).toBe(true);
  });

  it("recognises plannerOutput.decision.mode === 'clarification'", () => {
    const raw = JSON.stringify({
      reply: "再多告訴我一點？",
      plannerOutput: {
        plan: {
          decision: { mode: "clarification" },
          clarificationQuestion: "你想做幾秒的短片？",
          clarificationOptions: ["5秒", "10秒"],
        },
      },
      actions: [],
    });

    const parsed = parseOrbReply(raw);
    expect(parsed.needsClarification).toBe(true);
    expect(parsed.clarificationQuestion).toBe("你想做幾秒的短片？");
    expect(parsed.clarificationOptions).toEqual(["5秒", "10秒"]);
    expect(parsed.askBeforeAct).toBe(true);
  });

  it("recognises [CLARIFY:question|opt1|opt2] marker fallback", () => {
    const raw =
      "好的，先讓我確認一下。 [CLARIFY:你想要做圖片還是影片？|圖片|影片] [INTENT:確認需求]";

    const parsed = parseOrbReply(raw);
    expect(parsed.needsClarification).toBe(true);
    expect(parsed.clarificationQuestion).toBe("你想要做圖片還是影片？");
    expect(parsed.clarificationOptions).toEqual(["圖片", "影片"]);
    expect(parsed.intent).toBe("確認需求");
    expect(parsed.actions).toEqual([]);
    expect(parsed.askBeforeAct).toBe(true);
    expect(parsed.reply).not.toContain("[CLARIFY");
  });

  it("returns needsClarification=false when no clarification signal exists", () => {
    const raw = JSON.stringify({
      reply: "我幫你跳到創作工作室。",
      actions: [{ type: "navigate", path: "/studio" }],
    });

    const parsed = parseOrbReply(raw);
    expect(parsed.needsClarification).toBe(false);
    expect(parsed.clarificationQuestion).toBeUndefined();
    expect(parsed.clarificationOptions).toBeUndefined();
    expect(parsed.actions).toHaveLength(1);
  });

  it("clarification mode wins over destructive action confirmation gate", () => {
    // LLM accidentally returns both shouldAskClarification AND a submit action.
    // Parser must drop the action, force askBeforeAct=true, and surface the question.
    const raw = JSON.stringify({
      reply: "我需要先確認後再執行。",
      shouldAskClarification: true,
      clarificationQuestion: "你確定要送出嗎？",
      actions: [{ type: "submit" }],
    });

    const parsed = parseOrbReply(raw);
    expect(parsed.needsClarification).toBe(true);
    expect(parsed.actions).toEqual([]);
    expect(parsed.askBeforeAct).toBe(true);
  });

  it("ignores empty CLARIFY payload gracefully", () => {
    const raw = "Hello [CLARIFY:] world";
    const parsed = parseOrbReply(raw);
    expect(parsed.needsClarification).toBe(false);
    expect(parsed.clarificationQuestion).toBeUndefined();
  });
});
