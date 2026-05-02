/**
 * orb-clarification-options.test.ts
 *
 * Verifies the shared clarification quick-pick generator. These options
 * power both the legacy fallback path in `parseOrbReply` and the client's
 * `inferClarificationIntentCards` — getting them right is the difference
 * between "請問你想做什麼" generic chips and "茶道體驗短片（30 秒）"-style
 * topic-aware options that actually help the user commit.
 */

import { describe, expect, it } from "vitest";
import {
  buildContextualClarificationOptions,
  extractTopicWord,
  extractPhantomPlanQuestion,
  inferModalityFromText,
  isPhantomPlanReply,
} from "../shared/orb-clarification-options";

describe("inferModalityFromText", () => {
  it("detects video keywords", () => {
    expect(inferModalityFromText("幫我做一支療癒短片")).toBe("video");
    expect(inferModalityFromText("我要 Reel 影片")).toBe("video");
  });
  it("detects image keywords", () => {
    expect(inferModalityFromText("幫我做一張海報")).toBe("image");
    expect(inferModalityFromText("生成插畫風格的圖片")).toBe("image");
  });
  it("detects voice keywords", () => {
    expect(inferModalityFromText("幫我做旁白配音")).toBe("voice");
  });
  it("detects music keywords", () => {
    expect(inferModalityFromText("我想要一段配樂 BGM")).toBe("music");
  });
  it("detects script keywords", () => {
    expect(inferModalityFromText("幫我寫一個腳本")).toBe("script");
  });
  it("returns 'unknown' when no modality cue is present", () => {
    expect(inferModalityFromText("幫我做一個茶")).toBe("unknown");
  });
});

describe("extractTopicWord", () => {
  it("extracts the user's topic from a Chinese prompt", () => {
    const word = extractTopicWord("幫我做一支關於茶的療癒短片");
    expect(word).not.toBeNull();
    // Should reflect the user's domain (subject 茶 or mood 療癒) and never
    // be just the modality noun "短片".
    expect(word).toMatch(/茶|療癒/);
    expect(word).not.toBe("短片");
  });

  it("strips common modality / verb stopwords", () => {
    // When the user says nothing but "幫我做影片", there's no real topic.
    // Should NOT return "影片" (modality), should be null or a fragment.
    const word = extractTopicWord("幫我做影片");
    expect(word === null || !/^影片$/.test(word!)).toBe(true);
  });

  it("returns null for completely empty text", () => {
    expect(extractTopicWord("")).toBeNull();
    expect(extractTopicWord("   ")).toBeNull();
  });

  it("extracts an English-ish topic when the prompt has no Chinese", () => {
    const word = extractTopicWord("video about coffee shop");
    // No Chinese chars — should fall through to English path and surface
    // SOMETHING (exact word doesn't matter, just not null and not the
    // modality noun "video").
    expect(word).not.toBeNull();
    expect(word).not.toBe("video");
  });
});

describe("buildContextualClarificationOptions", () => {
  it("echoes the user's topic in video format options", () => {
    const pack = buildContextualClarificationOptions({
      userText: "幫我做關於茶的短片",
      dimension: "format",
    });
    expect(pack.modality).toBe("video");
    const joined = pack.options.join(" ");
    // At least one option must reference the user's own topic word.
    expect(joined).toMatch(/茶/);
    // Always includes an open-input escape hatch.
    expect(pack.options).toContain("我自己描述一下");
  });

  it("returns image-format options for image requests", () => {
    const pack = buildContextualClarificationOptions({
      userText: "幫我做咖啡店的海報",
      dimension: "format",
    });
    expect(pack.modality).toBe("image");
    const joined = pack.options.join(" ");
    expect(joined).toMatch(/海報|封面|插畫|寫實/);
  });

  it("falls back to format dimension when requested dimension is empty", () => {
    const pack = buildContextualClarificationOptions({
      userText: "幫我做關於茶的圖",
      modality: "image",
      dimension: "duration", // image has no duration options
    });
    // Should fall back to format-style options instead of returning empty.
    expect(pack.options.length).toBeGreaterThan(1);
  });

  it("provides reasonable defaults when modality cannot be inferred", () => {
    const pack = buildContextualClarificationOptions({
      userText: "幫我",
      dimension: "format",
    });
    expect(pack.modality).toBe("unknown");
    expect(pack.options.length).toBeGreaterThan(0);
  });

  it("never returns more than 4 options", () => {
    const pack = buildContextualClarificationOptions({
      userText: "幫我做關於茶的療癒短片",
      dimension: "format",
    });
    expect(pack.options.length).toBeLessThanOrEqual(4);
  });
});

describe("isPhantomPlanReply", () => {
  it("detects '步驟 1 / 步驟 2 + 從哪個步驟開始' pattern", () => {
    const reply = [
      "**步驟 1** → 導演 AI 規劃腳本",
      "**步驟 2** → 圖片工作室生成場景",
      "**步驟 3** → 影片工作室製作影片",
      "你比較想從哪個步驟開始？還是有其他想法呢？",
    ].join("\n");
    expect(isPhantomPlanReply(reply)).toBe(true);
  });

  it("detects English 'Step 1 / Step 2 / which step?' pattern", () => {
    const reply = [
      "Step 1 → plan the script",
      "Step 2 → generate the imagery",
      "Step 3 → render the video",
      "Which step do you want to start with?",
    ].join("\n");
    expect(isPhantomPlanReply(reply)).toBe(true);
  });

  it("returns false for a regular reply with no numbered list", () => {
    expect(isPhantomPlanReply("好，幫你把它做出來。")).toBe(false);
  });

  it("returns false when the question marker is missing", () => {
    const reply = [
      "**步驟 1** → 規劃",
      "**步驟 2** → 生成",
    ].join("\n");
    expect(isPhantomPlanReply(reply)).toBe(false);
  });

  it("returns false for a single-step reply with a question", () => {
    expect(isPhantomPlanReply("你比較想從哪個步驟開始？")).toBe(false);
  });
});

describe("extractPhantomPlanQuestion", () => {
  it("returns the trailing question line", () => {
    const reply = [
      "**步驟 1** → 規劃",
      "**步驟 2** → 生成",
      "你比較想從哪個步驟開始？",
    ].join("\n");
    const q = extractPhantomPlanQuestion(reply);
    expect(q).toContain("從哪個步驟");
  });

  it("strips bold markers around the line", () => {
    const reply = "**你想做什麼？**";
    const q = extractPhantomPlanQuestion(reply);
    expect(q).toBe("你想做什麼？");
  });

  it("falls back to the last line when no question mark is present", () => {
    const reply = "想做什麼\n再告訴我";
    const q = extractPhantomPlanQuestion(reply);
    expect(q).toBe("再告訴我");
  });

  it("caps long questions to 160 chars", () => {
    const longLine = "你" + "啊".repeat(200) + "？";
    const q = extractPhantomPlanQuestion(longLine);
    expect(q).not.toBeNull();
    expect(q!.length).toBeLessThanOrEqual(160);
  });
});
