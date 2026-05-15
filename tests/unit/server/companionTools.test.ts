/**
 * Unit tests for companionTools — 暖暖（companion）從「純 LLM 人格」升級成
 * 真實 AI agent 的四個工具：
 *   1. detectMood          — 文字 → 情緒標籤 + 強度
 *   2. clarifyIntent       — 文字 → 結構化 (modality / urgency / 信心 / 下一步)
 *   3. recommendNextSpirit — 情緒 + 意圖 → 下一棒精靈或 null
 *   4. calmBreak           — 情緒 → 3 步穩定方案
 *
 * 所有工具是純函式：無 I/O、無 DB、無 fal 呼叫 — 全部走確定性路徑測試。
 */
import { describe, expect, it } from "vitest";
import {
  detectMood,
  clarifyIntent,
  recommendNextSpirit,
  calmBreak,
} from "../../../server/services/spiritTools/companionTools";

describe("detectMood", () => {
  it("returns neutral for empty / whitespace text", () => {
    expect(detectMood({ text: "" }).primary).toBe("neutral");
    expect(detectMood({ text: "   " }).primary).toBe("neutral");
  });

  it("returns neutral for chatty text with no emotion words", () => {
    const r = detectMood({ text: "嗨，今天天氣不錯欸" });
    expect(r.primary).toBe("neutral");
    expect(r.intensity).toBe(0);
    expect(r.signals).toEqual([]);
    expect(r.shouldOfferCalmBreak).toBe(false);
  });

  it("detects 累 / tired with non-zero intensity", () => {
    const r = detectMood({ text: "今天好累，有點疲倦想休息" });
    expect(r.primary).toBe("tired");
    expect(r.intensity).toBeGreaterThan(0);
    expect(r.signals[0].matchedKeywords.length).toBeGreaterThan(0);
  });

  it("detects 卡住 / stuck", () => {
    const r = detectMood({ text: "我卡關了，搞不定，弄不出來" });
    expect(r.primary).toBe("stuck");
    expect(r.intensity).toBeGreaterThan(0);
  });

  it("detects 沒靈感 / uninspired", () => {
    const r = detectMood({ text: "完全沒靈感、想不出來" });
    expect(r.primary).toBe("uninspired");
  });

  it("detects anxious / 焦慮 + offers calmBreak when intensity is high", () => {
    const r = detectMood({ text: "我超焦慮，趕時間，壓力大，壓力好大" });
    expect(r.primary).toBe("anxious");
    expect(r.intensity).toBeGreaterThanOrEqual(0.5);
    expect(r.shouldOfferCalmBreak).toBe(true);
  });

  it("detects happy without recommending calmBreak", () => {
    const r = detectMood({ text: "好開心終於做出來了，太棒了" });
    expect(r.primary).toBe("happy");
    expect(r.shouldOfferCalmBreak).toBe(false);
  });

  it("picks the strongest signal when multiple are present", () => {
    // tired 命中 4 個關鍵字 vs anxious 命中 1 → primary = tired
    const r = detectMood({
      text: "我累、好累、疲倦、沒力，有點壓力大",
    });
    expect(r.primary).toBe("tired");
    expect(r.signals.length).toBe(2);
    expect(r.signals[0].label).toBe("tired");
  });

  it("matches English emotion words too", () => {
    expect(detectMood({ text: "I'm exhausted and burned out" }).primary).toBe("tired");
    expect(detectMood({ text: "I'm so stressed and overwhelmed" }).primary).toBe("anxious");
    expect(detectMood({ text: "stuck on this — no idea how to continue" }).primary).toBe("stuck");
  });
});

describe("clarifyIntent", () => {
  it("returns low confidence for super short text", () => {
    const r = clarifyIntent({ text: "嗨" });
    expect(r.confidence).toBeLessThan(0.4);
    // suggestedNextSteps 應該包含「陪你慢慢說」（handoffTo=null）
    expect(r.suggestedNextSteps.some(s => s.handoffTo === null)).toBe(true);
  });

  it("detects image modality with high confidence on 圖 + 畫 hint", () => {
    const r = clarifyIntent({ text: "我想畫一張海報圖片" });
    expect(r.modality).toBe("image");
    expect(r.confidence).toBeGreaterThanOrEqual(0.55);
    expect(r.suggestedNextSteps.some(s => s.handoffTo === "image-specialist")).toBe(true);
  });

  it("detects video modality", () => {
    const r = clarifyIntent({ text: "想做一支短影片動畫" });
    expect(r.modality).toBe("video");
    expect(r.suggestedNextSteps[0].handoffTo).toBe("video-specialist");
  });

  it("detects learning modality + recommends learning-specialist", () => {
    const r = clarifyIntent({ text: "教學一下怎麼用，新手不會" });
    expect(r.modality).toBe("learning");
    expect(r.suggestedNextSteps[0].handoffTo).toBe("learning-specialist");
  });

  it("detects high urgency", () => {
    const r = clarifyIntent({ text: "趕時間，馬上要一張圖片！deadline" });
    expect(r.urgency).toBe("high");
  });

  it("detects low urgency", () => {
    const r = clarifyIntent({ text: "之後有空再說吧，慢慢來" });
    expect(r.urgency).toBe("low");
  });

  it("falls back to page-derived modality when text has no modal hint", () => {
    const r = clarifyIntent({ text: "再試一次看看", pagePath: "/image-studio" });
    expect(r.modality).toBe("image");
  });

  it("returns unknown modality when nothing matches and no page hint", () => {
    const r = clarifyIntent({ text: "嗯嗯好的然後呢" });
    expect(r.modality).toBe("unknown");
  });

  it("reorders to director-first when urgency is high + intent is vague", () => {
    const r = clarifyIntent({ text: "趕著要馬上 deadline" });
    expect(r.urgency).toBe("high");
    expect(r.suggestedNextSteps[0].handoffTo).toBe("director");
  });
});

describe("recommendNextSpirit", () => {
  it("keeps companion (handoffTo=null) when mood=anxious — calm first, don't push", () => {
    const r = recommendNextSpirit({ text: "想做一張圖", mood: "anxious" });
    expect(r.handoffTo).toBeNull();
    expect(r.reason).toMatch(/mood=anxious/);
  });

  it("keeps companion when mood=tired regardless of intent", () => {
    const r = recommendNextSpirit({ text: "我想畫一張圖片", mood: "tired" });
    expect(r.handoffTo).toBeNull();
  });

  it("hands off to image-specialist on clear image intent + neutral mood", () => {
    const r = recommendNextSpirit({ text: "畫一張海報的圖片" });
    expect(r.handoffTo).toBe("image-specialist");
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.greetingTemplate).toContain("圖圖");
  });

  it("hands off to inspiration-specialist when mood=uninspired (no clear intent)", () => {
    const r = recommendNextSpirit({ text: "不知道做什麼", mood: "uninspired" });
    expect(r.handoffTo).toBe("inspiration-specialist");
    expect(r.greetingTemplate).toContain("靈靈");
  });

  it("skips muted spirits and falls back", () => {
    // 把 image-specialist 靜音 → 即使是 image 意圖也不該交棒給圖圖
    const r = recommendNextSpirit({
      text: "畫一張海報的圖片",
      mutedSpirits: ["image-specialist"],
    });
    // 應該找下一個白名單內的選項（inspiration-specialist 或 director）；
    // 至少不能是 image-specialist
    expect(r.handoffTo).not.toBe("image-specialist");
  });

  it("returns null when nothing clear AND mood is neutral", () => {
    const r = recommendNextSpirit({ text: "嗨" });
    expect(r.handoffTo).toBeNull();
    expect(r.greetingTemplate).toContain("暖暖");
  });

  it("never recommends a spirit outside the companion handoff whitelist", () => {
    // 試各種輸入，最多看到的下一棒一定要在白名單內
    const whitelisted = new Set([
      "director",
      "navigator",
      "inspiration-specialist",
      "learning-specialist",
      "onboarding-coach",
      "image-specialist",
      "video-specialist",
      "music-specialist",
      "voice-specialist",
      "quality-coach",
    ]);
    const inputs: string[] = [
      "畫一張圖",
      "做一支影片",
      "配音樂",
      "錄旁白",
      "教我",
      "趕時間",
      "嗨",
      "我累了",
    ];
    for (const text of inputs) {
      const r = recommendNextSpirit({ text });
      if (r.handoffTo !== null) {
        expect(whitelisted.has(r.handoffTo)).toBe(true);
      }
    }
  });
});

describe("calmBreak", () => {
  it("returns 3-step preset for anxious", () => {
    const r = calmBreak({ mood: "anxious" });
    expect(r.steps.length).toBe(3);
    expect(r.opening).toContain("暖暖");
    expect(r.steps[0].title).toMatch(/^1\./);
    expect(r.shouldSuggestNewConversation).toBe(false);
  });

  it("returns 3-step preset for stuck", () => {
    const r = calmBreak({ mood: "stuck" });
    expect(r.steps.length).toBe(3);
  });

  it("returns 3-step preset for tired", () => {
    const r = calmBreak({ mood: "tired" });
    expect(r.steps.length).toBe(3);
  });

  it("returns shorter preset for happy / neutral (still has steps)", () => {
    expect(calmBreak({ mood: "happy" }).steps.length).toBeGreaterThan(0);
    expect(calmBreak({ mood: "neutral" }).steps.length).toBeGreaterThan(0);
  });

  it("suggests a new conversation when turnCount >= 6", () => {
    expect(calmBreak({ mood: "anxious", turnCount: 6 }).shouldSuggestNewConversation).toBe(true);
    expect(calmBreak({ mood: "neutral", turnCount: 12 }).shouldSuggestNewConversation).toBe(true);
  });

  it("does not suggest new conversation for short sessions", () => {
    expect(calmBreak({ mood: "anxious", turnCount: 2 }).shouldSuggestNewConversation).toBe(false);
    expect(calmBreak({ mood: "stuck" }).shouldSuggestNewConversation).toBe(false);
  });
});
