import { describe, it, expect } from "vitest";
import { VoiceCompiler, getVoiceCompiler, parseVoiceBlockPrompt } from "./services/voiceCompiler";
import type { VoiceCompilerInput, MoodBlock } from "./services/voiceCompiler";

describe("VoiceCompiler", () => {
  const compiler = new VoiceCompiler();

  // ─── 情緒解析 ─────────────────────────────────────────────

  describe("resolveEmotion", () => {
    it("should resolve emotion from moodBlock.blockId", () => {
      const input: VoiceCompilerInput = {
        script: "測試文字",
        moodBlock: {
          blockId: "serene",
          label: "寧靜",
          prompt: "",
          isCustom: false,
        },
      };
      const { profile, source } = compiler.resolveEmotion(input);
      expect(profile.name).toBe("寧靜");
      expect(source).toContain("moodBlock.blockId");
    });

    it("should resolve emotion from moodBlock.label when blockId not found", () => {
      const input: VoiceCompilerInput = {
        script: "測試文字",
        moodBlock: {
          blockId: "custom_123",
          label: "joyful energy",
          prompt: "",
          isCustom: true,
        },
      };
      const { profile } = compiler.resolveEmotion(input);
      expect(profile.name).toBe("歡愉");
    });

    it("should infer emotion from moodBlock.prompt keywords", () => {
      const input: VoiceCompilerInput = {
        script: "測試文字",
        moodBlock: {
          blockId: "custom_456",
          label: "my custom mood",
          prompt: "悲傷的憂鬱氛圍",
          isCustom: true,
        },
      };
      const { profile, source } = compiler.resolveEmotion(input);
      expect(profile.name).toBe("憂鬱");
      expect(source).toContain("moodBlock.prompt inferred");
    });

    it("should resolve emotion from vibeCardIds", () => {
      const input: VoiceCompilerInput = {
        script: "測試文字",
        vibeCardIds: ["dreamy", "warm"],
      };
      const { profile } = compiler.resolveEmotion(input);
      expect(profile.name).toBe("夢幻");
    });

    it("should infer emotion from script content as last resort", () => {
      const input: VoiceCompilerInput = {
        script: "這是一個充滿希望和光明的故事",
      };
      const { profile, source } = compiler.resolveEmotion(input);
      expect(profile.name).toBe("希望");
      expect(source).toContain("script content inferred");
    });

    it("should fall back to default neutral emotion", () => {
      const input: VoiceCompilerInput = {
        script: "普通的測試文字",
      };
      const { profile, source } = compiler.resolveEmotion(input);
      expect(profile.name).toBe("中性");
      expect(source).toBe("default (neutral)");
    });

    // ─── AIDV-216: 自訂語音 preset ────────────────────────────

    it("uses resolvedCustomProfile when moodBlock.isCustom === true", () => {
      const input: VoiceCompilerInput = {
        script: "冥想引導文字",
        moodBlock: {
          blockId: "cb_42",
          label: "我的冥想語調",
          prompt: '{"rate":"80%","pitch":"-5%","styleHint":"meditative"}',
          isCustom: true,
          customBlockId: 42,
        },
        resolvedCustomProfile: { rate: "80%", pitch: "-5%", styleHint: "meditative" },
      };
      const { profile, source } = compiler.resolveEmotion(input);
      expect(profile.rate).toBe("80%");
      expect(profile.pitch).toBe("-5%");
      expect(profile.styleHint).toBe("meditative");
      expect(source).toContain("customBlock:42");
      expect(source).toContain("我的冥想語調");
    });

    it("resolvedCustomProfile overrides built-in profile for isCustom block", () => {
      const input: VoiceCompilerInput = {
        script: "測試覆蓋",
        moodBlock: {
          blockId: "warm",
          label: "我改版的 warm",
          prompt: '{"rate":"70%"}',
          isCustom: true,
          customBlockId: 7,
        },
        resolvedCustomProfile: { rate: "70%" },
      };
      const { profile } = compiler.resolveEmotion(input);
      // rate should come from custom profile, not the built-in warm (95%)
      expect(profile.rate).toBe("70%");
      // other fields fall back to DEFAULT_EMOTION
      expect(profile.emphasisLevel).toBe("none");
    });

    it("falls back to normal resolution when resolvedCustomProfile is absent", () => {
      const input: VoiceCompilerInput = {
        script: "測試",
        moodBlock: {
          blockId: "cb_99",
          label: "joyful energy",
          prompt: "",
          isCustom: true,
          customBlockId: 99,
        },
        // resolvedCustomProfile intentionally omitted (custom block was deleted)
      };
      const { profile } = compiler.resolveEmotion(input);
      // Should fall through to label matching → joyful
      expect(profile.name).toBe("歡愉");
    });

    it("ignores resolvedCustomProfile when moodBlock.isCustom is false", () => {
      const input: VoiceCompilerInput = {
        script: "測試",
        moodBlock: {
          blockId: "serene",
          label: "寧靜",
          prompt: "",
          isCustom: false,
        },
        resolvedCustomProfile: { rate: "999%" },
      };
      const { profile } = compiler.resolveEmotion(input);
      // resolvedCustomProfile must NOT be applied; built-in serene should win
      expect(profile.name).toBe("寧靜");
      expect(profile.rate).toBe("90%");
    });
  });

  // ─── AIDV-216: parseVoiceBlockPrompt ─────────────────────────────────────

  describe("parseVoiceBlockPrompt", () => {
    it("parses valid JSON with all fields", () => {
      const json = JSON.stringify({
        rate: "85%",
        pitch: "-3%",
        volume: "soft",
        emphasisLevel: "reduced",
        sentenceBreakMs: 700,
        paragraphBreakMs: 1800,
        hesitationBreakMs: 1900,
        styleHint: "calm",
        name: "我的冥想語調",
      });
      const result = parseVoiceBlockPrompt(json);
      expect(result.rate).toBe("85%");
      expect(result.pitch).toBe("-3%");
      expect(result.volume).toBe("soft");
      expect(result.emphasisLevel).toBe("reduced");
      expect(result.sentenceBreakMs).toBe(700);
      expect(result.styleHint).toBe("calm");
      expect(result.name).toBe("我的冥想語調");
    });

    it("returns empty object for invalid JSON", () => {
      expect(parseVoiceBlockPrompt("not json")).toEqual({});
      expect(parseVoiceBlockPrompt("")).toEqual({});
    });

    it("ignores invalid emphasisLevel values", () => {
      const result = parseVoiceBlockPrompt(JSON.stringify({ emphasisLevel: "maximum" }));
      expect(result.emphasisLevel).toBeUndefined();
    });

    it("ignores non-string rate/pitch values", () => {
      const result = parseVoiceBlockPrompt(JSON.stringify({ rate: 0.9, pitch: -5 }));
      expect(result.rate).toBeUndefined();
      expect(result.pitch).toBeUndefined();
    });

    it("handles partial JSON with only some fields", () => {
      const result = parseVoiceBlockPrompt(JSON.stringify({ rate: "90%", styleHint: "gentle" }));
      expect(result.rate).toBe("90%");
      expect(result.styleHint).toBe("gentle");
      expect(result.pitch).toBeUndefined();
    });
  });

  // ─── SSML 編譯 ────────────────────────────────────────────

  describe("compile", () => {
    it("should produce valid SSML with <speak> wrapper", () => {
      const result = compiler.compile({
        script: "你好，歡迎來到療癒工作室。",
        moodBlock: {
          blockId: "warm",
          label: "溫暖",
          prompt: "",
          isCustom: false,
        },
      });
      expect(result.ssml).toMatch(/^<speak>/);
      expect(result.ssml).toMatch(/<\/speak>$/);
    });

    it("should inject break tags for sentence boundaries", () => {
      const result = compiler.compile({
        script: "第一句話。第二句話。第三句話。",
        moodBlock: {
          blockId: "serene",
          label: "寧靜",
          prompt: "",
          isCustom: false,
        },
      });
      expect(result.ssml).toContain("<break time=");
      expect(result.breakCount).toBeGreaterThanOrEqual(3);
    });

    it("should inject hesitation breaks for ellipsis", () => {
      const result = compiler.compile({
        script: "我在想……也許我們可以試試看。",
        enableHesitation: true,
      });
      expect(result.ssml).toContain("<break time=");
      // 省略號應被替換為 break
      expect(result.ssml).not.toContain("……");
    });

    it("should inject breaks for dash transitions", () => {
      const result = compiler.compile({
        script: "這個世界——充滿了可能性。",
        enableHesitation: true,
      });
      expect(result.ssml).toContain("<break time=");
    });

    it("should inject comma micro-breaks for natural breathing", () => {
      const result = compiler.compile({
        script: "在這裡，我們可以放鬆，感受當下。",
        enableHesitation: true,
      });
      // 逗號後應有微停頓
      const commaBreaks = (result.ssml.match(/，<break/g) || []).length;
      expect(commaBreaks).toBeGreaterThanOrEqual(1);
    });

    it("should handle paragraph breaks with longer pauses", () => {
      const result = compiler.compile({
        script: "第一段的內容。\n\n第二段的內容。",
        moodBlock: {
          blockId: "serene",
          label: "寧靜",
          prompt: "",
          isCustom: false,
        },
      });
      // 段落間停頓應比句間停頓長
      expect(result.ssml).toContain("1500ms");
    });

    it("should apply prosody for exclamation sentences", () => {
      const result = compiler.compile({
        script: "太棒了！這真的太美了！",
      });
      // 感嘆句應有 pitch="+15%" 和 volume="loud"
      expect(result.ssml).toContain('pitch="+15%"');
      expect(result.ssml).toContain('volume="loud"');
    });

    it("should apply prosody for question sentences", () => {
      const result = compiler.compile({
        script: "你覺得這樣好嗎？",
      });
      expect(result.ssml).toContain('pitch="+10%"');
    });

    it("should wrap quoted text in emphasis tags", () => {
      const result = compiler.compile({
        script: "她說「你好美」然後離開了。",
        moodBlock: {
          blockId: "warm",
          label: "溫暖",
          prompt: "",
          isCustom: false,
        },
      });
      expect(result.ssml).toContain("<emphasis");
      expect(result.ssml).toContain("你好美");
    });

    it("should respect rateOverride", () => {
      const result = compiler.compile({
        script: "測試語速覆寫。",
        rateOverride: "120%",
      });
      expect(result.ssml).toContain('rate="120%"');
    });

    it("should disable hesitation when enableHesitation is false", () => {
      const result = compiler.compile({
        script: "我在想……也許可以。",
        enableHesitation: false,
      });
      // 省略號不應被替換
      // break count 應該只有句間停頓，不包含微停頓
      const resultWithHesitation = compiler.compile({
        script: "我在想……也許可以。",
        enableHesitation: true,
      });
      expect(result.breakCount).toBeLessThan(resultWithHesitation.breakCount);
    });

    it("should handle custom breakpoints", () => {
      const result = compiler.compile({
        script: "第一部分[PAUSE]第二部分[PAUSE]第三部分。",
        customBreakpoints: ["[PAUSE]"],
      });
      // 自訂斷點應產生額外的 pause break
      expect(result.breakCount).toBeGreaterThanOrEqual(2);
    });

    it("should return correct segment count (excluding pauses)", () => {
      const result = compiler.compile({
        script: "第一句。第二句。\n\n第三句。",
      });
      expect(result.segmentCount).toBe(3);
    });

    it("should estimate duration based on character count and rate", () => {
      const result = compiler.compile({
        script: "這是一段大約二十個字的測試文字用來計算時長。",
        moodBlock: {
          blockId: "serene",
          label: "寧靜",
          prompt: "",
          isCustom: false,
        },
      });
      expect(result.estimatedDurationSec).toBeGreaterThan(0);
    });

    it("should produce compilation log entries", () => {
      const result = compiler.compile({
        script: "測試日誌。",
      });
      expect(result.compilationLog.length).toBeGreaterThanOrEqual(4);
      expect(result.compilationLog[0]).toContain("開始編譯");
      expect(result.compilationLog[result.compilationLog.length - 1]).toContain(
        "編譯完成"
      );
    });

    it("should escape SSML special characters in text", () => {
      const result = compiler.compile({
        script: "A < B & C > D。",
      });
      expect(result.ssml).toContain("&lt;");
      expect(result.ssml).toContain("&amp;");
      expect(result.ssml).toContain("&gt;");
    });
  });

  // ─── 快速編譯 ─────────────────────────────────────────────

  describe("compileToSSML", () => {
    it("should return SSML string directly", () => {
      const ssml = compiler.compileToSSML("你好世界。", "warm");
      expect(ssml).toMatch(/^<speak>/);
      expect(ssml).toMatch(/<\/speak>$/);
    });

    it("should work without emotion parameter", () => {
      const ssml = compiler.compileToSSML("測試。");
      expect(ssml).toContain("<speak>");
    });
  });

  // ─── 工具方法 ─────────────────────────────────────────────

  describe("getAvailableEmotions", () => {
    it("should return all available emotion profiles", () => {
      const emotions = compiler.getAvailableEmotions();
      expect(emotions.length).toBeGreaterThanOrEqual(14);
      expect(emotions.some(e => e.id === "serene")).toBe(true);
      expect(emotions.some(e => e.id === "dramatic")).toBe(true);
      expect(emotions.every(e => e.id && e.name && e.styleHint)).toBe(true);
    });
  });

  describe("previewEmotion", () => {
    it("should return emotion profile for valid ID", () => {
      const profile = compiler.previewEmotion("mystical");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("神秘");
      expect(profile!.rate).toBe("80%");
    });

    it("should return null for invalid ID", () => {
      const profile = compiler.previewEmotion("nonexistent");
      expect(profile).toBeNull();
    });
  });

  // ─── Singleton ────────────────────────────────────────────

  describe("getVoiceCompiler", () => {
    it("should return singleton instance", () => {
      const a = getVoiceCompiler();
      const b = getVoiceCompiler();
      expect(a).toBe(b);
    });
  });

  // ─── 複合場景 ─────────────────────────────────────────────

  describe("complex scenarios", () => {
    it("should compile a full CoStar audioScript with mood block", () => {
      const result = compiler.compile({
        script: `歡迎來到療癒工作室。

在這裡，你可以放下所有的疲憊……讓心靈回到最純粹的狀態。

「每一次呼吸，都是一次重生。」

準備好了嗎？讓我們開始今天的創作旅程！`,
        moodBlock: {
          blockId: "serene",
          label: "寧靜",
          prompt: "平靜安詳的氛圍",
          isCustom: false,
        },
        vibeCardIds: ["serene", "nature"],
        enableHesitation: true,
      });

      expect(result.ssml).toContain("<speak>");
      expect(result.ssml).toContain("</speak>");
      expect(result.emotionProfile.name).toBe("寧靜");
      expect(result.segmentCount).toBeGreaterThanOrEqual(4);
      expect(result.breakCount).toBeGreaterThanOrEqual(5);
      expect(result.estimatedDurationSec).toBeGreaterThan(5);
      // 省略號應被替換為 break
      expect(result.ssml).not.toContain("……");
      // 引號內容應有 emphasis
      expect(result.ssml).toContain("<emphasis");
      // 感嘆句應有特殊 prosody
      expect(result.ssml).toContain('pitch="+15%"');
      // 疑問句應有特殊 prosody
      expect(result.ssml).toContain('pitch="+10%"');
    });

    it("should reject empty script with COMPILER_INPUT_INVALID (AIDV-172)", () => {
      expect(() => compiler.compile({ script: "" })).toThrow(
        /script 不能為空|COMPILER_INPUT_INVALID/
      );
    });

    it("should handle script with only punctuation", () => {
      const result = compiler.compile({ script: "。。。" });
      expect(result.ssml).toContain("<speak>");
    });
  });
});
