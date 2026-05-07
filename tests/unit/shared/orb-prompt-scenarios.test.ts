/**
 * tests/unit/shared/orb-prompt-scenarios.test.ts
 *
 * Covers the edge-case detectors that GlobalOrbChatContext consults before
 * forwarding a user prompt to the planner. Each scenario gets at least one
 * positive case, plus a negative case to guard against false positives.
 */
import { describe, expect, it } from "vitest";
import {
  ORB_PROMPT_MAX_CHARS,
  countMeaningfulChars,
  detectOrbPromptScenario,
} from "../../../shared/orb-prompt-scenarios";

describe("countMeaningfulChars", () => {
  it("counts CJK ideographs", () => {
    expect(countMeaningfulChars("你好")).toBe(2);
  });

  it("counts ASCII letters and digits", () => {
    expect(countMeaningfulChars("abc123")).toBe(6);
  });

  it("ignores whitespace, punctuation, and emoji", () => {
    expect(countMeaningfulChars("！！！")).toBe(0);
    expect(countMeaningfulChars("🤔🤔🤔")).toBe(0);
    expect(countMeaningfulChars("   ")).toBe(0);
    expect(countMeaningfulChars("...???")).toBe(0);
  });

  it("counts kana and hangul as meaningful", () => {
    expect(countMeaningfulChars("こんにちは")).toBe(5);
    expect(countMeaningfulChars("안녕하세요")).toBe(5);
  });
});

describe("detectOrbPromptScenario — boundary input", () => {
  it("returns boundary-empty when text is blank and no attachments", () => {
    const out = detectOrbPromptScenario({ text: "   ", hasAttachments: false });
    expect(out?.scenario).toBe("boundary-empty");
    expect(out?.suggestions?.length ?? 0).toBeGreaterThan(0);
  });

  it("returns attachment-only-hint when text is blank but attachments exist", () => {
    const out = detectOrbPromptScenario({ text: "", hasAttachments: true });
    expect(out?.scenario).toBe("attachment-only-hint");
  });

  it("returns boundary-noise for punctuation-only or emoji-only input", () => {
    expect(detectOrbPromptScenario({ text: "！！！", hasAttachments: false })?.scenario).toBe(
      "boundary-noise"
    );
    expect(detectOrbPromptScenario({ text: "🤔🤔", hasAttachments: false })?.scenario).toBe(
      "boundary-noise"
    );
  });

  it("returns boundary-too-short for a single meaningful char", () => {
    expect(detectOrbPromptScenario({ text: "圖", hasAttachments: false })?.scenario).toBe(
      "boundary-too-short"
    );
    expect(detectOrbPromptScenario({ text: "a", hasAttachments: false })?.scenario).toBe(
      "boundary-too-short"
    );
  });

  it("returns boundary-too-long when input exceeds the hard ceiling", () => {
    const text = "好".repeat(ORB_PROMPT_MAX_CHARS + 1);
    const out = detectOrbPromptScenario({ text, hasAttachments: false });
    expect(out?.scenario).toBe("boundary-too-long");
    expect(out?.reply).toContain(ORB_PROMPT_MAX_CHARS.toLocaleString());
  });

  it("does not flag normal-length prompts", () => {
    const out = detectOrbPromptScenario({
      text: "幫我做一張寧靜森林的封面",
      hasAttachments: false,
    });
    expect(out).toBeNull();
  });
});

describe("detectOrbPromptScenario — emotional intents", () => {
  it("recognises cancel-style prompts", () => {
    for (const text of ["算了", "不要了", "停", "取消", "cancel", "Stop", "nevermind"]) {
      const out = detectOrbPromptScenario({ text, hasAttachments: false });
      expect(out?.scenario, `expected emotional-cancel for ${text}`).toBe("emotional-cancel");
    }
  });

  it("recognises thanks-style prompts", () => {
    for (const text of ["謝謝", "謝啦", "感謝", "thanks", "Thank you", "TY"]) {
      const out = detectOrbPromptScenario({ text, hasAttachments: false });
      expect(out?.scenario, `expected emotional-thanks for ${text}`).toBe("emotional-thanks");
    }
  });

  it("recognises frustration phrases", () => {
    for (const text of ["你好煩", "這個爛死了", "useless", "this is stupid"]) {
      const out = detectOrbPromptScenario({ text, hasAttachments: false });
      expect(out?.scenario, `expected emotional-frustration for ${text}`).toBe(
        "emotional-frustration"
      );
    }
  });

  it("does not classify benign mention of cancel/stop words inside a real request", () => {
    const out = detectOrbPromptScenario({
      text: "幫我做一支關於停下腳步的療癒短片",
      hasAttachments: false,
    });
    expect(out).toBeNull();
  });
});

describe("detectOrbPromptScenario — self-help & history reference", () => {
  it("recognises 'what does this site do' style questions", () => {
    for (const text of [
      "這個網站能做什麼？",
      "這網站可以幹嘛",
      "有什麼功能",
      "What can you do?",
      "How do I use this",
      "help",
      "?",
    ]) {
      const out = detectOrbPromptScenario({ text, hasAttachments: false });
      expect(out?.scenario, `expected self-help for ${text}`).toBe("self-help");
      expect(out?.followUp).toBe("show-feature-summary");
    }
  });

  it("recognises history reference prompts", () => {
    for (const text of ["你剛剛說什麼", "上一句是什麼", "前面提過的那個", "what did you say"]) {
      const out = detectOrbPromptScenario({ text, hasAttachments: false });
      expect(out?.scenario, `expected history-reference for ${text}`).toBe("history-reference");
    }
  });
});

describe("detectOrbPromptScenario — repeat-loop detection", () => {
  it("fires when the same prompt is sent 3 times in a row", () => {
    const text = "幫我生圖";
    const out = detectOrbPromptScenario({
      text,
      hasAttachments: false,
      recentUserTexts: [text, text],
    });
    expect(out?.scenario).toBe("loop");
    expect(out?.followUp).toBe("reset-conversation");
  });

  it("treats whitespace and case differences as the same prompt", () => {
    const out = detectOrbPromptScenario({
      text: "  Help me",
      hasAttachments: false,
      recentUserTexts: ["help me", "HELP ME"],
    });
    // Identical prompts triple-repeated → loop wins over self-help "help" match.
    expect(out?.scenario).toBe("loop");
  });

  it("does not fire when the user changes their phrasing", () => {
    const out = detectOrbPromptScenario({
      text: "幫我生圖",
      hasAttachments: false,
      recentUserTexts: ["幫我生圖", "幫我生影片"],
    });
    expect(out).toBeNull();
  });

  it("requires at least 2 prior messages to fire", () => {
    const out = detectOrbPromptScenario({
      text: "幫我生圖",
      hasAttachments: false,
      recentUserTexts: ["幫我生圖"],
    });
    expect(out).toBeNull();
  });
});

describe("detectOrbPromptScenario — priority ordering", () => {
  it("loop detection wins over self-help when both match", () => {
    const out = detectOrbPromptScenario({
      text: "help",
      hasAttachments: false,
      recentUserTexts: ["help", "help"],
    });
    expect(out?.scenario).toBe("loop");
  });

  it("attachment-only beats boundary-empty when attachments are present", () => {
    const out = detectOrbPromptScenario({ text: "  ", hasAttachments: true });
    expect(out?.scenario).toBe("attachment-only-hint");
  });

  it("too-long beats every other scenario", () => {
    const text = `算了 ${"x".repeat(ORB_PROMPT_MAX_CHARS)}`;
    const out = detectOrbPromptScenario({ text, hasAttachments: false });
    expect(out?.scenario).toBe("boundary-too-long");
  });
});

describe("detectOrbPromptScenario — long-script summary", () => {
  const longBrief = [
    "我想做一支 30 秒的短片，主題是森林清晨採茶體驗，",
    "整支片走療癒、寫實風格，鏡頭從竹林開始，由遠至近最後落在主角的茶杯，",
    "中段帶過茶具與水滾煙霧，整體節奏緩慢沉靜，色調偏暖綠。",
    "目標放上 IG Reel，9:16 直式構圖，搭配輕慢的鋼琴前奏與鳥鳴白噪音，",
    "片頭打上品牌 logo，片尾用淡入轉場帶到網店連結卡。",
    "給品牌粉絲觀看，做品牌行銷曝光，輔助本季秋冬上新的銷售檔期。",
    "字幕用繁體中文、淺米色襯底框，避免擋住主視覺。",
    "整體希望可以延伸成 3 張 IG 主視覺與 1 篇貼文文案。",
    "場景一：竹林空鏡，鳥鳴白噪音，主角從畫面右側緩步入鏡。",
    "場景二：主角採茶，慢動作特寫指尖摘下嫩芽，背景虛化。",
    "場景三：泡茶與分享，配溫柔旁白，最後鏡頭落在主角微笑的側臉。",
  ].join("");

  it("fires long-script-summarised when text is long with substantive structure", () => {
    expect(longBrief.length).toBeGreaterThanOrEqual(280);
    const out = detectOrbPromptScenario({
      text: longBrief,
      hasAttachments: false,
    });
    expect(out?.scenario).toBe("long-script-summarised");
    expect(out?.reply).toContain("成品");
    expect(out?.reply).toContain("長度");
    expect(out?.reply).toContain("主題");
    expect(out?.parsedStructure?.format).toBe("短片");
    expect(out?.parsedStructure?.durationSec).toBe(30);
    expect(out?.parsedStructure?.scenes).toBeGreaterThanOrEqual(3);
    expect(out?.suggestions?.[0]).toBe("這樣開始");
  });

  it("does NOT fire when text is long but parser can't extract structure", () => {
    // 400+ chars of meandering chitchat with no concrete dimensions.
    const meandering = "今天天氣真的很好啊我想說來跟你聊聊天，".repeat(20);
    expect(meandering.length).toBeGreaterThanOrEqual(280);
    const out = detectOrbPromptScenario({
      text: meandering,
      hasAttachments: false,
    });
    // Either pass-through (null) or some other scenario, but NOT long-script.
    expect(out?.scenario).not.toBe("long-script-summarised");
  });

  it("boundary-too-long now also embeds extracted summary when it can", () => {
    const giant = `我要做一支 30 秒的森林短片，主題是森林。${"x".repeat(13_000)}`;
    const out = detectOrbPromptScenario({ text: giant, hasAttachments: false });
    expect(out?.scenario).toBe("boundary-too-long");
    expect(out?.reply).toContain("成品");
    expect(out?.parsedStructure).toBeDefined();
  });
});

describe("detectOrbPromptScenario — pass-through cases", () => {
  it("returns null for a normal creation request", () => {
    expect(
      detectOrbPromptScenario({
        text: "幫我做一支 30 秒的療癒森林短片",
        hasAttachments: false,
      })
    ).toBeNull();
  });

  it("returns null for an English creation request", () => {
    expect(
      detectOrbPromptScenario({
        text: "Generate a watercolor poster of a quiet forest",
        hasAttachments: false,
      })
    ).toBeNull();
  });

  it("returns null when text is short but attachments carry the meaning", () => {
    // Normal flow handles "拿這張延伸成短片" + image. We only hint when text is empty.
    expect(
      detectOrbPromptScenario({
        text: "延伸成短片",
        hasAttachments: true,
      })
    ).toBeNull();
  });
});
