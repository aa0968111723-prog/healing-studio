import { describe, it, expect } from "vitest";
import { AudioCompiler, getAudioCompiler } from "./services/audioCompiler";
import type { AudioBlock, AudioCompilerInput } from "./services/audioCompiler";

describe("AudioCompiler", () => {
  const compiler = new AudioCompiler();

  // ─── 輔助工廠 ─────────────────────────────────────────────

  const mkBlock = (
    category: AudioBlock["category"],
    prompt: string,
    label?: string
  ): AudioBlock => ({
    id: `test_${category}_${prompt.slice(0, 8)}`,
    category,
    label: label || prompt,
    prompt,
  });

  // ─── Tag Stacking Limit ───────────────────────────────────

  describe("Tag Stacking Limit", () => {
    it("should enforce max 4 elements per section", () => {
      const blocks: AudioBlock[] = [
        mkBlock("instrument", "piano"),
        mkBlock("instrument", "guitar"),
        mkBlock("instrument", "violin"),
        mkBlock("instrument", "flute"),
        mkBlock("instrument", "drums"),
        mkBlock("instrument", "harp"),
        mkBlock("genre", "jazz"),
        mkBlock("genre", "pop music"),
      ];

      const result = compiler.compile({ blocks });

      // 每個段落的元素數量不應超過 4
      for (const section of result.sections) {
        expect(section.elements.length).toBeLessThanOrEqual(4);
      }
    });

    it("should log trimming when elements exceed limit", () => {
      const blocks: AudioBlock[] = [
        mkBlock("instrument", "piano"),
        mkBlock("instrument", "acoustic guitar"),
        mkBlock("instrument", "synthesizer"),
        mkBlock("instrument", "orchestral ensemble"),
        mkBlock("instrument", "violin"),
        mkBlock("genre", "pop music"),
        mkBlock("genre", "jazz"),
        mkBlock("tempo", "fast tempo, upbeat"),
        mkBlock("ambiance", "spacious reverb, wide soundstage"),
      ];

      const result = compiler.compile({ blocks });

      // 應該有段落被裁剪
      const trimmedSections = result.sections.filter(s => s.wasTrimmed);
      expect(trimmedSections.length).toBeGreaterThan(0);
      expect(result.stackingLog.length).toBeGreaterThan(0);
    });

    it("should prioritize genre over ambiance when trimming", () => {
      const blocks: AudioBlock[] = [
        mkBlock("genre", "jazz"),
        mkBlock("instrument", "piano"),
        mkBlock("instrument", "guitar"),
        mkBlock("tempo", "slow tempo, adagio"),
        mkBlock("ambiance", "spacious reverb, wide soundstage"),
        mkBlock("ambiance", "warm analog tone"),
      ];

      const result = compiler.compile({ blocks, forceStructure: "ballad" });

      // 在被裁剪的段落中，genre 應該被保留
      for (const section of result.sections) {
        if (section.wasTrimmed) {
          // jazz 應在保留元素中
          const hasGenre = section.elements.some(e => e.includes("jazz"));
          expect(hasGenre).toBe(true);
        }
      }
    });

    it("should not trim when elements are within limit", () => {
      const blocks: AudioBlock[] = [
        mkBlock("genre", "ambient music"),
        mkBlock("instrument", "piano"),
      ];

      const result = compiler.compile({ blocks });

      const trimmedSections = result.sections.filter(s => s.wasTrimmed);
      expect(trimmedSections.length).toBe(0);
      expect(result.stackingLog.length).toBe(0);
    });

    it("should support custom max elements via constructor", () => {
      const strictCompiler = new AudioCompiler(2);

      const blocks: AudioBlock[] = [
        mkBlock("genre", "pop music"),
        mkBlock("instrument", "piano"),
        mkBlock("instrument", "guitar"),
        mkBlock("ambiance", "warm analog tone"),
      ];

      const result = strictCompiler.compile({ blocks });

      for (const section of result.sections) {
        expect(section.elements.length).toBeLessThanOrEqual(2);
      }
    });
  });

  // ─── 時間軸結構生成 ───────────────────────────────────────

  describe("Timeline Structure", () => {
    it("should generate [Verse 1], [Chorus] etc. for pop template", () => {
      const result = compiler.compile({
        blocks: [mkBlock("genre", "pop music")],
        forceStructure: "pop",
      });

      const tags = result.sections.map(s => s.tag);
      expect(tags).toContain("[Intro]");
      expect(tags).toContain("[Verse 1]");
      expect(tags).toContain("[Chorus]");
      expect(tags).toContain("[Outro]");
    });

    it("should generate [Drop] for EDM template", () => {
      const result = compiler.compile({
        blocks: [mkBlock("genre", "electronic music")],
        forceStructure: "edm",
      });

      const tags = result.sections.map(s => s.tag);
      expect(tags).toContain("[Drop]");
      expect(tags).toContain("[Build Up]");
      expect(tags).toContain("[Breakdown]");
    });

    it("should generate [Movement 1] for ambient template", () => {
      const result = compiler.compile({
        blocks: [mkBlock("genre", "ambient music")],
        forceStructure: "ambient",
      });

      const tags = result.sections.map(s => s.tag);
      expect(tags).toContain("[Movement 1]");
      expect(tags).toContain("[Transition]");
      expect(tags).toContain("[Fade Out]");
    });

    it("should generate [Climax] for cinematic template", () => {
      const result = compiler.compile({
        blocks: [mkBlock("genre", "classical music")],
        forceStructure: "cinematic",
      });

      const tags = result.sections.map(s => s.tag);
      expect(tags).toContain("[Opening]");
      expect(tags).toContain("[Climax]");
      expect(tags).toContain("[Denouement]");
    });

    it("should auto-infer EDM template from electronic blocks", () => {
      const result = compiler.compile({
        blocks: [
          mkBlock("genre", "electronic music"),
          mkBlock("instrument", "synthesizer"),
        ],
      });

      const tags = result.sections.map(s => s.tag);
      expect(tags).toContain("[Drop]");
    });

    it("should auto-infer ambient template from ambient blocks", () => {
      const result = compiler.compile({
        blocks: [mkBlock("genre", "ambient music")],
        moodKeywords: ["meditation"],
      });

      const tags = result.sections.map(s => s.tag);
      expect(tags).toContain("[Movement 1]");
    });

    it("should auto-infer lofi template from lo-fi blocks", () => {
      const result = compiler.compile({
        blocks: [mkBlock("genre", "lo-fi chill beats")],
      });

      const tags = result.sections.map(s => s.tag);
      expect(tags).toContain("[Loop A]");
    });

    it("should auto-infer ballad template from slow blocks", () => {
      const result = compiler.compile({
        blocks: [
          mkBlock("instrument", "piano"),
          mkBlock("tempo", "slow tempo, adagio"),
        ],
      });

      const tags = result.sections.map(s => s.tag);
      expect(tags).toContain("[Verse 1]");
      // ballad 沒有 Drop
      expect(tags).not.toContain("[Drop]");
    });
  });

  // ─── 風格衝突偵測 ─────────────────────────────────────────

  describe("Style Conflict Resolution", () => {
    it("should detect fast vs slow tempo conflict", () => {
      const blocks: AudioBlock[] = [
        mkBlock("tempo", "fast tempo, upbeat"),
        mkBlock("tempo", "slow tempo, adagio"),
      ];

      const { resolvedBlocks, conflicts } = compiler.resolveConflicts(blocks);
      expect(conflicts.length).toBe(1);
      expect(conflicts[0]).toContain("調和");
      expect(resolvedBlocks.length).toBe(1);
    });

    it("should detect electronic vs classical conflict", () => {
      const blocks: AudioBlock[] = [
        mkBlock("genre", "electronic music"),
        mkBlock("genre", "classical music"),
      ];

      const { conflicts } = compiler.resolveConflicts(blocks);
      expect(conflicts.length).toBe(1);
      expect(conflicts[0]).toContain("fusion");
    });

    it("should detect lo-fi vs crystal clear conflict", () => {
      const blocks: AudioBlock[] = [
        mkBlock("genre", "lo-fi chill beats"),
        mkBlock("ambiance", "crystal clear, bright mix"),
      ];

      const { conflicts } = compiler.resolveConflicts(blocks);
      expect(conflicts.length).toBe(1);
    });

    it("should not report conflicts for compatible styles", () => {
      const blocks: AudioBlock[] = [
        mkBlock("genre", "jazz"),
        mkBlock("instrument", "piano"),
        mkBlock("ambiance", "warm analog tone"),
      ];

      const { conflicts } = compiler.resolveConflicts(blocks);
      expect(conflicts.length).toBe(0);
    });

    it("should set hasConflictResolution flag in compile result", () => {
      const conflicting = compiler.compile({
        blocks: [
          mkBlock("tempo", "fast tempo, upbeat"),
          mkBlock("tempo", "slow tempo, adagio"),
        ],
      });
      expect(conflicting.hasConflictResolution).toBe(true);

      const compatible = compiler.compile({
        blocks: [mkBlock("genre", "jazz"), mkBlock("instrument", "piano")],
      });
      expect(compatible.hasConflictResolution).toBe(false);
    });
  });

  // ─── 提示詞組裝 ───────────────────────────────────────────

  describe("Prompt Assembly", () => {
    it("should include section tags in output prompt", () => {
      const result = compiler.compile({
        blocks: [mkBlock("genre", "pop music")],
        forceStructure: "pop",
      });

      expect(result.prompt).toContain("[Intro]");
      expect(result.prompt).toContain("[Verse 1]");
      expect(result.prompt).toContain("[Chorus]");
    });

    it("should include [Instrumental] tag when instrumental is true", () => {
      const result = compiler.compile({
        blocks: [mkBlock("genre", "ambient music")],
        instrumental: true,
      });

      expect(result.prompt).toContain("[Instrumental]");
    });

    it("should include BPM override", () => {
      const result = compiler.compile({
        blocks: [mkBlock("genre", "pop music")],
        bpmOverride: 128,
      });

      expect(result.prompt).toContain("[BPM: 128]");
    });

    it("should include free prompt as Style Note", () => {
      const result = compiler.compile({
        blocks: [mkBlock("genre", "jazz")],
        freePrompt: "smooth and relaxing",
      });

      expect(result.prompt).toContain("[Style Note] smooth and relaxing");
    });

    it("should include mood keywords", () => {
      const result = compiler.compile({
        blocks: [mkBlock("genre", "ambient music")],
        moodKeywords: ["peaceful", "healing"],
      });

      expect(result.prompt).toContain("[Mood] peaceful, healing");
    });

    it("should insert lyrics into verse/chorus sections", () => {
      const result = compiler.compile({
        blocks: [mkBlock("genre", "pop music")],
        forceStructure: "pop",
        lyrics:
          "First verse lyrics here\n\nSecond verse lyrics\n\nChorus lyrics go here",
      });

      expect(result.prompt).toContain("First verse lyrics here");
      expect(result.prompt).toContain("Chorus lyrics go here");
    });
  });

  // ─── 風格標籤 ─────────────────────────────────────────────

  describe("Style Tag", () => {
    it("should build style tag from genre blocks", () => {
      const result = compiler.compile({
        blocks: [mkBlock("genre", "jazz"), mkBlock("genre", "pop music")],
      });

      expect(result.styleTag).toContain("jazz");
      expect(result.styleTag).toContain("pop music");
    });

    it("should include mood in style tag", () => {
      const result = compiler.compile({
        blocks: [mkBlock("genre", "ambient music")],
        moodKeywords: ["healing"],
      });

      expect(result.styleTag).toContain("healing");
    });

    it("should include instrumental in style tag", () => {
      const result = compiler.compile({
        blocks: [mkBlock("genre", "jazz")],
        instrumental: true,
      });

      expect(result.styleTag).toContain("instrumental");
    });

    it("should limit style tag to max 4 elements", () => {
      const result = compiler.compile({
        blocks: [
          mkBlock("genre", "jazz"),
          mkBlock("genre", "pop music"),
          mkBlock("genre", "rock"),
          mkBlock("tempo", "fast tempo"),
        ],
        moodKeywords: ["energetic"],
        instrumental: true,
      });

      const parts = result.styleTag.split(", ");
      expect(parts.length).toBeLessThanOrEqual(4);
    });
  });

  // ─── 快速編譯 ─────────────────────────────────────────────

  describe("compileQuick", () => {
    it("should compile from prompt strings directly", () => {
      const prompt = compiler.compileQuick(
        ["piano", "jazz", "slow tempo"],
        "relaxing",
        true
      );

      expect(prompt).toContain("[Instrumental]");
      expect(prompt).toContain("piano");
      expect(prompt).toContain("[Mood] relaxing");
    });

    it("should infer categories from prompt text", () => {
      const prompt = compiler.compileQuick(["synthesizer", "electronic music"]);
      // 應推斷為 EDM 模板
      expect(prompt).toContain("[Drop]");
    });
  });

  // ─── 工具方法 ─────────────────────────────────────────────

  describe("Utility Methods", () => {
    it("should return all available templates", () => {
      const templates = compiler.getAvailableTemplates();
      expect(templates.length).toBe(7);
      expect(templates.some(t => t.id === "pop")).toBe(true);
      expect(templates.some(t => t.id === "edm")).toBe(true);
      expect(templates.some(t => t.id === "ambient")).toBe(true);
      expect(templates.every(t => t.sectionCount > 0)).toBe(true);
    });

    it("should preview a specific template", () => {
      const sections = compiler.previewTemplate("edm");
      expect(sections).not.toBeNull();
      expect(sections!.some(s => s.tag === "[Drop]")).toBe(true);
    });

    it("should return null for invalid template", () => {
      const sections = compiler.previewTemplate("nonexistent" as any);
      expect(sections).toBeNull();
    });

    it("should return max elements per section", () => {
      expect(compiler.getMaxElementsPerSection()).toBe(4);
    });

    it("should validate blocks for conflicts", () => {
      const valid = compiler.validateBlocks([
        mkBlock("genre", "jazz"),
        mkBlock("instrument", "piano"),
      ]);
      expect(valid.valid).toBe(true);

      const invalid = compiler.validateBlocks([
        mkBlock("tempo", "fast tempo, upbeat"),
        mkBlock("tempo", "slow tempo, adagio"),
      ]);
      expect(invalid.valid).toBe(false);
      expect(invalid.conflicts.length).toBeGreaterThan(0);
    });
  });

  // ─── 編譯日誌 ─────────────────────────────────────────────

  describe("Compilation Log", () => {
    it("should produce compilation log entries", () => {
      const result = compiler.compile({
        blocks: [mkBlock("genre", "pop music")],
      });

      expect(result.compilationLog.length).toBeGreaterThanOrEqual(4);
      expect(result.compilationLog[0]).toContain("開始編譯");
      expect(result.compilationLog[result.compilationLog.length - 1]).toContain(
        "編譯完成"
      );
    });

    it("should log conflict resolution", () => {
      const result = compiler.compile({
        blocks: [
          mkBlock("tempo", "fast tempo, upbeat"),
          mkBlock("tempo", "slow tempo, adagio"),
        ],
      });

      expect(result.compilationLog.some(l => l.includes("衝突調和"))).toBe(
        true
      );
    });
  });

  // ─── 複合場景 ─────────────────────────────────────────────

  describe("Complex Scenarios", () => {
    it("should handle full healing studio music compilation", () => {
      const result = compiler.compile({
        blocks: [
          mkBlock("instrument", "piano"),
          mkBlock("instrument", "harp"),
          mkBlock("genre", "ambient music"),
          mkBlock("tempo", "slow tempo, adagio"),
          mkBlock("ambiance", "ethereal, dreamy atmosphere"),
          mkBlock("ambiance", "spacious reverb, wide soundstage"),
        ],
        moodKeywords: ["healing", "peaceful"],
        instrumental: true,
        targetDurationSec: 180,
        freePrompt: "gentle and soothing meditation music",
      });

      expect(result.prompt).toContain("[Instrumental]");
      expect(result.sectionCount).toBeGreaterThanOrEqual(4);
      expect(result.estimatedDurationSec).toBe(180);
      // 每段不超過 4 元素
      for (const s of result.sections) {
        expect(s.elements.length).toBeLessThanOrEqual(4);
      }
      expect(result.styleTag).toBeTruthy();
    });

    it("should handle empty blocks gracefully", () => {
      const result = compiler.compile({ blocks: [] });
      expect(result.prompt).toBeTruthy();
      expect(result.sectionCount).toBeGreaterThan(0);
    });

    it("should handle single block", () => {
      const result = compiler.compile({
        blocks: [mkBlock("instrument", "piano")],
      });
      expect(result.prompt).toContain("piano");
      expect(result.sectionCount).toBeGreaterThan(0);
    });
  });

  // ─── Singleton ────────────────────────────────────────────

  describe("getAudioCompiler", () => {
    it("should return singleton instance", () => {
      const a = getAudioCompiler();
      const b = getAudioCompiler();
      expect(a).toBe(b);
    });
  });
});
