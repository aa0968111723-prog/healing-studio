/**
 * tests/unit/shared/orb-script-structure.test.ts
 *
 * Covers the long-script structure extractor: format/modality, duration
 * (Chinese + English + half-minute variants), subject, styles, platforms,
 * purpose, scene markers, and the dimension-signal converter that the
 * clarification wizard uses to skip already-covered questions.
 */
import { describe, expect, it } from "vitest";
import {
  extractScriptStructure,
  parseDurationToSeconds,
  scriptStructureDimensionCount,
  structureToDimensionSignals,
  summarizeScriptStructure,
} from "../../../shared/orb-script-structure";

describe("parseDurationToSeconds", () => {
  it("parses Chinese seconds", () => {
    expect(parseDurationToSeconds("30 秒")).toBe(30);
    expect(parseDurationToSeconds("十秒")).toBe(10);
    expect(parseDurationToSeconds("二十秒")).toBe(20);
  });

  it("parses Chinese minutes including 兩 / 半 variants", () => {
    expect(parseDurationToSeconds("1 分鐘")).toBe(60);
    expect(parseDurationToSeconds("兩分鐘")).toBe(120);
    expect(parseDurationToSeconds("一分半")).toBe(90);
    expect(parseDurationToSeconds("三分")).toBe(180);
  });

  it("parses Chinese hours", () => {
    expect(parseDurationToSeconds("1 小時")).toBe(3600);
    expect(parseDurationToSeconds("半小時")).toBe(1800);
  });

  it("parses English forms", () => {
    expect(parseDurationToSeconds("30 sec")).toBe(30);
    expect(parseDurationToSeconds("1 min")).toBe(60);
    expect(parseDurationToSeconds("2 mins")).toBe(120);
    expect(parseDurationToSeconds("1.5 minutes")).toBe(90);
    expect(parseDurationToSeconds("2 hrs")).toBe(7200);
  });

  it("returns null for nonsense", () => {
    expect(parseDurationToSeconds("")).toBeNull();
    expect(parseDurationToSeconds("一杯咖啡")).toBeNull();
  });
});

describe("extractScriptStructure", () => {
  it("returns an empty structure for blank input", () => {
    const s = extractScriptStructure("");
    expect(s.format).toBeNull();
    expect(s.modality).toBe("unknown");
    expect(s.durationSec).toBeNull();
    expect(s.subject).toBeNull();
    expect(s.styles).toEqual([]);
    expect(s.platforms).toEqual([]);
    expect(s.purpose).toBeNull();
    expect(s.scenes).toBe(0);
    expect(s.coverage).toBe(0);
    expect(scriptStructureDimensionCount(s)).toBe(0);
  });

  it("detects video format + Chinese duration + subject", () => {
    const s = extractScriptStructure(
      "我想做一支 30 秒的短片，主題是森林，療癒風格，目標放上 IG Reel 9:16，給品牌粉絲看。"
    );
    expect(s.format).toBe("短片");
    expect(s.modality).toBe("video");
    expect(s.durationSec).toBe(30);
    expect(s.durationLabel).toContain("30");
    expect(s.subject).toBe("森林");
    expect(s.styles).toContain("療癒");
    expect(s.platforms.some(p => p.includes("ig") || p.includes("9:16"))).toBe(true);
    expect(s.purpose).toBe("品牌行銷");
  });

  it("detects long video with scene markers", () => {
    const s = extractScriptStructure(
      [
        "我要做一支關於台灣茶道的長片，總長 5 分鐘。",
        "場景一：清晨採茶。鏡頭掃過竹林。",
        "場景二：奉茶。長者倒水。",
        "場景三：分享茶湯，主角微笑。",
      ].join("\n")
    );
    expect(s.format).toBe("長片");
    expect(s.modality).toBe("video");
    expect(s.durationSec).toBe(300);
    expect(s.scenes).toBeGreaterThanOrEqual(3);
  });

  it("detects English-language briefs", () => {
    const s = extractScriptStructure(
      "Generate a cinematic poster for a brand campaign, watercolor style, for Instagram 1:1."
    );
    expect(s.modality).toBe("image");
    expect(s.format).toBe("海報");
    expect(s.styles.some(x => /cinematic|watercolor/i.test(x))).toBe(true);
    expect(s.platforms.some(x => /instagram|1:1/i.test(x))).toBe(true);
    expect(s.purpose).toBe("品牌行銷");
  });

  it("detects podcast format → voice modality", () => {
    const s = extractScriptStructure(
      "幫我做一集 podcast 節目集，30 分鐘長，主題是台灣茶道，配給社群聽眾。"
    );
    expect(s.format).toBe("podcast");
    expect(s.modality).toBe("voice");
    expect(s.durationSec).toBe(1800);
  });

  it("rejects single-char-repeated runs as a subject", () => {
    // Residual stripping artefacts ("做做做做…") should not satisfy the
    // wizard's subject check.
    const s = extractScriptStructure("做做做做做做做做做做做做做做做做做做做做做做做做做做做做做做做做做做做做做做做做做做做做");
    expect(s.subject).toBeNull();
  });

  it("rejects time units / style fragments masquerading as subject", () => {
    const s = extractScriptStructure(
      "幫我做一個 30 分鐘 podcast 節目集，配療癒風格的旁白。"
    );
    // "分鐘" and "配療癒風格的" should not slip through as the topic.
    if (s.subject !== null) {
      expect(s.subject).not.toBe("分鐘");
      expect(s.subject).not.toMatch(/風格/);
    }
  });
});

describe("structureToDimensionSignals", () => {
  it("flips hasLength / hasSubject / hasStyle when fields populated", () => {
    const s = extractScriptStructure(
      "我要 30 秒的森林短片，療癒風格，給 IG Reel。" +
        // Padding to push past the dimension-count threshold.
        "希望整體偏自然輕快，配上鳥叫白噪音，旁白用溫柔女聲。"
    );
    const sig = structureToDimensionSignals(s);
    expect(sig.hasLength).toBe(true);
    expect(sig.hasSubject).toBe(true);
    expect(sig.hasStyle).toBe(true);
    expect(sig.hasPlatform).toBe(true);
  });

  it("returns all-falsey signals for an empty parse", () => {
    const sig = structureToDimensionSignals(extractScriptStructure(""));
    expect(sig.hasLength).toBe(false);
    expect(sig.hasSubject).toBe(false);
    expect(sig.hasStyle).toBe(false);
    expect(sig.hasPlatform).toBe(false);
    expect(sig.hasPurpose).toBe(false);
  });
});

describe("summarizeScriptStructure", () => {
  it("includes every populated dimension as a bullet", () => {
    const s = extractScriptStructure(
      "我要做一支 30 秒的森林短片，療癒風格，目標投放 IG Reel，給品牌粉絲看。"
    );
    const summary = summarizeScriptStructure(s, 60);
    expect(summary).toContain("成品");
    expect(summary).toContain("長度");
    expect(summary).toContain("主題");
    expect(summary).toContain("風格");
    expect(summary).toContain("這樣開始");
  });

  it("skips dimensions that aren't populated", () => {
    const s = extractScriptStructure("我想做一支 podcast，30 分鐘。");
    const summary = summarizeScriptStructure(s, 16);
    expect(summary).toContain("podcast");
    expect(summary).not.toContain("• 風格：");
  });
});
