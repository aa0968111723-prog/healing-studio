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

  // ── Phantom-plan reclassification ────────────────────────────────
  // The LLM sometimes describes a multi-step plan in chat then asks
  // "你比較想從哪個步驟開始？". That's the exact moment the orb should
  // switch to a structured clarification — otherwise the user gets a
  // wall of text with no quick-pick. parseOrbReply now catches this
  // pattern and surfaces context-aware options derived from userText.
  it("reclassifies a phantom plan reply as clarification with topic-aware options", () => {
    const raw = [
      "**步驟 1** → 導演 AI 規劃腳本（用 CO-STAR 框架構思製茶故事線）",
      "**步驟 2** → 圖片工作室生成關鍵製茶場景（寫實風格）",
      "**步驟 3** → 影片工作室製作動態影片（用 Kling 2.1 最高品質）",
      "**步驟 4** → 音樂配音創作室添加背景音樂（可選茶道相關音樂）",
      "",
      "你比較想從哪個步驟開始？還是有其他想法呢？✨",
    ].join("\n");
    const parsed = parseOrbReply(raw, { userText: "幫我做一支關於茶的療癒短片" });
    expect(parsed.needsClarification).toBe(true);
    expect(parsed.clarificationQuestion).toContain("從哪個步驟");
    expect(parsed.actions).toEqual([]);
    expect(parsed.askBeforeAct).toBe(true);
    expect(parsed.clarificationOptions).toBeTruthy();
    // Options should echo the user's own topic word rather than fall back
    // to generic "我先看流程再決定" placeholders.
    const joined = (parsed.clarificationOptions ?? []).join(" ");
    expect(joined).toMatch(/茶|短片|秒|分鐘/);
    // Always includes an open-input escape hatch so users aren't trapped.
    expect(parsed.clarificationOptions).toContain("我自己描述一下");
  });

  it("does NOT reclassify when reply has steps but no question", () => {
    const raw = [
      "**步驟 1** → 規劃腳本",
      "**步驟 2** → 生成圖片",
      "**步驟 3** → 套上音樂",
    ].join("\n");
    const parsed = parseOrbReply(raw, { userText: "做一支茶的影片" });
    expect(parsed.needsClarification).toBe(false);
  });

  it("does NOT reclassify when reply has actions (real plan was emitted)", () => {
    const raw = JSON.stringify({
      reply: "**步驟 1** → 切到 t2i\n**步驟 2** → 填入提示詞\n你想從哪一步開始？",
      actions: [{ type: "fillPrompt", payload: "夜晚電影感" }],
    });
    const parsed = parseOrbReply(raw, { userText: "做夜晚電影感的圖" });
    expect(parsed.needsClarification).toBe(false);
    expect(parsed.actions.length).toBeGreaterThan(0);
  });

  it("backfills topic-aware options when planner clarification ships empty options", () => {
    const raw = JSON.stringify({
      reply: "我先確認一下你想做的方向。",
      shouldAskClarification: true,
      clarificationQuestion: "想做什麼類型的茶影片？",
      clarificationOptions: [],
    });
    const parsed = parseOrbReply(raw, { userText: "想做關於茶的短片" });
    expect(parsed.needsClarification).toBe(true);
    expect(parsed.clarificationOptions).toBeTruthy();
    expect(parsed.clarificationOptions!.length).toBeGreaterThan(0);
    const joined = (parsed.clarificationOptions ?? []).join(" ");
    expect(joined).toMatch(/茶|短片|秒|分鐘/);
  });
});
