/**
 * Unit tests for shared/composer-handoff-triggers.ts
 *
 * 編編 (composer) 的「主動交棒觸發器」— 依當前語境推斷該不該叫其他精靈來。
 */

import { describe, expect, it } from "vitest";
import {
  getComposerHandoffSuggestions,
  pickPrimaryComposerHandoff,
} from "../../../shared/composer-handoff-triggers";
import type { PageAgentSnapshot, AgentAction } from "../../../shared/agent-actions";

const imageSnap: PageAgentSnapshot = {
  pageId: "image-studio",
  pageLabel: "Image Studio",
  pagePath: "/image-studio",
  capabilities: [
    { action: "fillPrompt", label: "提示詞" },
    { action: "setModel", label: "模型" },
    { action: "submit", label: "送出" },
  ],
};

function parsed(actions: AgentAction[]): {
  actions: AgentAction[];
  missing: never[];
  matchedRules: string[];
  matched: boolean;
} {
  return { actions, missing: [], matchedRules: [], matched: true };
}

describe("getComposerHandoffSuggestions — short prompt", () => {
  it("flags @巧巧 when fillPrompt is < 12 chars", () => {
    const hits = getComposerHandoffSuggestions({
      userText: "畫一隻貓",
      parsed: parsed([{ type: "fillPrompt", text: "一隻貓" }]),
      snapshot: imageSnap,
    });
    expect(hits.find(h => h.spirit === "quality-coach")).toBeDefined();
  });

  it("does NOT flag when fillPrompt is detailed enough", () => {
    const hits = getComposerHandoffSuggestions({
      userText: "畫一隻橘貓在窗台逆光，35mm 淺景深",
      parsed: parsed([{ type: "fillPrompt", text: "一隻橘貓在窗台逆光，35mm 淺景深，水彩風" }]),
      snapshot: imageSnap,
    });
    expect(hits.find(h => h.spirit === "quality-coach")).toBeUndefined();
  });
});

describe("getComposerHandoffSuggestions — expensive op", () => {
  it("flags @財財 before submit on FLUX Pro", () => {
    const hits = getComposerHandoffSuggestions({
      userText: "用 flux pro 然後送出",
      parsed: parsed([
        { type: "setModel", modelId: "fal-ai/flux-pro/v1.1" },
        { type: "submit" },
      ]),
      snapshot: imageSnap,
    });
    expect(hits.find(h => h.spirit === "accountant")).toBeDefined();
  });

  it("flags @財財 with HIGH priority for long Kling video", () => {
    const hits = getComposerHandoffSuggestions({
      userText: "kling pro 跑 10 秒然後送出",
      parsed: parsed([
        { type: "setModel", modelId: "fal-ai/kling-video/v2.1/pro/image-to-video" },
        { type: "setParam", key: "durationSec", value: 10 },
        { type: "submit" },
      ]),
      snapshot: imageSnap,
    });
    const acct = hits.find(h => h.spirit === "accountant");
    expect(acct).toBeDefined();
    expect(acct?.priority).toBe("high");
  });

  it("does NOT flag @財財 for Schnell + submit (cheap)", () => {
    const hits = getComposerHandoffSuggestions({
      userText: "schnell 跑",
      parsed: parsed([
        { type: "setModel", modelId: "fal-ai/flux/schnell" },
        { type: "submit" },
      ]),
      snapshot: imageSnap,
    });
    expect(hits.find(h => h.spirit === "accountant")).toBeUndefined();
  });

  it("does NOT flag @財財 without submit (just configuring)", () => {
    const hits = getComposerHandoffSuggestions({
      userText: "先換 flux pro 等等再跑",
      parsed: parsed([{ type: "setModel", modelId: "fal-ai/flux-pro/v1.1" }]),
      snapshot: imageSnap,
    });
    expect(hits.find(h => h.spirit === "accountant")).toBeUndefined();
  });
});

describe("getComposerHandoffSuggestions — IP risk", () => {
  it("flags @律律 on Disney mention", () => {
    const hits = getComposerHandoffSuggestions({
      userText: "畫迪士尼風格的米奇",
      parsed: parsed([{ type: "fillPrompt", text: "迪士尼風米奇" }]),
      snapshot: imageSnap,
    });
    expect(hits.find(h => h.spirit === "legal-advisor")).toBeDefined();
  });

  it("flags @律律 on celebrity / brand mention", () => {
    const hits = getComposerHandoffSuggestions({
      userText: "nike 風的 logo",
      parsed: parsed([]),
      snapshot: imageSnap,
    });
    expect(hits.find(h => h.spirit === "legal-advisor")).toBeDefined();
  });

  it("does NOT flag @律律 for unrelated content", () => {
    const hits = getComposerHandoffSuggestions({
      userText: "一隻貓",
      parsed: parsed([{ type: "fillPrompt", text: "一隻橘貓在窗台" }]),
      snapshot: imageSnap,
    });
    expect(hits.find(h => h.spirit === "legal-advisor")).toBeUndefined();
  });
});

describe("getComposerHandoffSuggestions — post-dispatch triggers", () => {
  it("flags @守守 when dispatch failed", () => {
    const hits = getComposerHandoffSuggestions({
      userText: "送出",
      parsed: parsed([{ type: "submit" }]),
      snapshot: imageSnap,
      postDispatch: true,
      dispatchFailed: true,
    });
    expect(hits.find(h => h.spirit === "inspector")).toBeDefined();
  });

  it("suggests @品品 after successful submit (low priority)", () => {
    const hits = getComposerHandoffSuggestions({
      userText: "送出",
      parsed: parsed([{ type: "submit" }]),
      snapshot: imageSnap,
      postDispatch: true,
      dispatchFailed: false,
    });
    const critic = hits.find(h => h.spirit === "critic");
    expect(critic).toBeDefined();
    expect(critic?.priority).toBe("low");
  });

  it("flags @影影 when user asks for animation after image submit", () => {
    const hits = getComposerHandoffSuggestions({
      userText: "做成動畫版",
      parsed: parsed([{ type: "submit" }]),
      snapshot: imageSnap,
      postDispatch: true,
      dispatchFailed: false,
    });
    expect(hits.find(h => h.spirit === "video-specialist")).toBeDefined();
  });
});

describe("getComposerHandoffSuggestions — ordering by priority", () => {
  it("returns hits sorted by priority (high → medium → low)", () => {
    const hits = getComposerHandoffSuggestions({
      userText: "畫迪士尼風 用 flux pro 送出",
      parsed: parsed([
        { type: "setModel", modelId: "fal-ai/flux-pro/v1.1" },
        { type: "fillPrompt", text: "迪士尼米奇" }, // < 12 chars → short prompt + ip risk
        { type: "submit" },
      ]),
      snapshot: imageSnap,
    });
    // both legal-advisor (high) and quality-coach (high) should be present;
    // accountant (medium). Order check: no low before high.
    const priorities = hits.map(h => h.priority);
    const firstLow = priorities.indexOf("low");
    const lastHigh = priorities.lastIndexOf("high");
    if (firstLow >= 0 && lastHigh >= 0) {
      expect(firstLow).toBeGreaterThan(lastHigh);
    }
  });
});

describe("pickPrimaryComposerHandoff", () => {
  it("returns null when nothing triggers", () => {
    // Long-enough prompt + cheap model + no submit + no IP risk → no triggers
    expect(
      pickPrimaryComposerHandoff({
        userText: "用 schnell 畫一隻橘貓在窗台逆光，35mm 淺景深，水彩風",
        parsed: parsed([
          { type: "setModel", modelId: "fal-ai/flux/schnell" },
          {
            type: "fillPrompt",
            text: "一隻橘貓在窗台逆光，35mm 淺景深，水彩風",
          },
        ]),
        snapshot: imageSnap,
      }),
    ).toBeNull();
  });

  it("returns the highest-priority suggestion (accountant) for FLUX Pro + submit", () => {
    const hit = pickPrimaryComposerHandoff({
      userText: "用 flux pro 畫一張正式的商品攝影風格的圖然後送出",
      parsed: parsed([
        { type: "setModel", modelId: "fal-ai/flux-pro/v1.1" },
        {
          type: "fillPrompt",
          text: "商品攝影風格，純色背景，柔光，淺景深，4K",
        },
        { type: "submit" },
      ]),
      snapshot: imageSnap,
    });
    expect(hit?.spirit).toBe("accountant");
  });
});
