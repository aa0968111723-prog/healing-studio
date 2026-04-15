import { describe, it, expect } from "vitest";
import { VideoCompiler, getVideoCompiler } from "./services/videoCompiler";
import type { VideoBlock, CameraModeId } from "./services/videoCompiler";

describe("VideoCompiler", () => {
  const compiler = new VideoCompiler();

  const mkBlock = (
    category: VideoBlock["category"],
    prompt: string,
    label?: string
  ): VideoBlock => ({
    id: `test_${category}_${prompt.slice(0, 8)}`,
    category,
    label: label || prompt,
    prompt,
  });

  // ═══════════════════════════════════════════════════════════════
  // 1. 情感→物理動作翻譯
  // ═══════════════════════════════════════════════════════════════

  describe("Emotion-to-Action Translation", () => {
    it("should translate sadness to physical action verbs", () => {
      const map = compiler.translateEmotion("sadness");
      expect(map.emotion).toBe("sadness");
      expect(map.actionVerbs).toContain("drooping");
      expect(map.actionVerbs).toContain("wilting");
      expect(map.actionVerbs).toContain("sinking");
      expect(map.subjectBehaviors.length).toBeGreaterThan(0);
      expect(map.environmentalCues.length).toBeGreaterThan(0);
    });

    it("should translate joy to physical action verbs", () => {
      const map = compiler.translateEmotion("joy");
      expect(map.actionVerbs).toContain("blooming");
      expect(map.actionVerbs).toContain("sparkling");
      expect(
        map.subjectBehaviors.some(
          b => b.includes("sunflower") || b.includes("cherry blossom")
        )
      ).toBe(true);
    });

    it("should translate all 14 supported emotions", () => {
      const emotions = compiler.getSupportedEmotions();
      expect(emotions.length).toBe(14);
      for (const em of emotions) {
        const map = compiler.translateEmotion(em);
        expect(map.actionVerbs.length).toBeGreaterThanOrEqual(3);
        expect(map.subjectBehaviors.length).toBeGreaterThanOrEqual(3);
        expect(map.environmentalCues.length).toBeGreaterThanOrEqual(3);
        expect(map.suggestedCamera.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("should fallback to serenity for unknown emotions", () => {
      const map = compiler.translateEmotion("xyzunknown");
      expect(map.emotion).toBe("serenity");
    });

    it("should fuzzy match partial emotion names", () => {
      // melancholic → melancholy via common prefix match (≥5 chars)
      const map = compiler.translateEmotion("melancholic");
      expect(map.emotion).toBe("melancholy");
    });

    it("should batch translate multiple emotions", () => {
      const translations = compiler.translateEmotions([
        "sadness",
        "joy",
        "wonder",
      ]);
      expect(translations.length).toBe(3);
      expect(translations[0].from).toBe("sadness");
      expect(translations[0].to.length).toBeGreaterThan(0);
      expect(translations[1].from).toBe("joy");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. 相機運鏡約束 (Camera Vectors)
  // ═══════════════════════════════════════════════════════════════

  describe("Camera Vector Binding", () => {
    it("should return 16 camera modes", () => {
      const modes = compiler.getAvailableCameraModes();
      expect(modes.length).toBe(16);
    });

    it("should have stability scores between 1-5", () => {
      const modes = compiler.getAvailableCameraModes();
      for (const m of modes) {
        expect(m.stabilityScore).toBeGreaterThanOrEqual(1);
        expect(m.stabilityScore).toBeLessThanOrEqual(5);
      }
    });

    it("should validate legal camera transitions", () => {
      const result = compiler.validateCameraTransition("static", "dolly_in");
      expect(result.valid).toBe(true);
    });

    it("should block illegal camera transitions (jump prevention)", () => {
      // handheld → aerial_ascent is not in allowedTransitions
      const result = compiler.validateCameraTransition(
        "handheld",
        "aerial_ascent"
      );
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("視角跳躍阻擋");
    });

    it("should plan safe camera sequences", () => {
      const plan = compiler.planCameraSequence("static", [
        "dolly_in",
        "orbit",
        "static",
      ]);
      expect(plan.sequence.length).toBeGreaterThanOrEqual(2);
      // All transitions in the sequence should be valid
      for (let i = 1; i < plan.sequence.length; i++) {
        const v = compiler.validateCameraTransition(
          plan.sequence[i - 1],
          plan.sequence[i]
        );
        expect(v.valid).toBe(true);
      }
    });

    it("should find bridge transitions for blocked paths", () => {
      // handheld → aerial_ascent is blocked, but should find a bridge
      const plan = compiler.planCameraSequence("handheld", ["aerial_ascent"]);
      expect(plan.blocked.length).toBe(1);
      // Should have inserted a bridge or kept current
      expect(plan.sequence.length).toBeGreaterThanOrEqual(2);
    });

    it("should suggest camera mode based on emotion", () => {
      const sadCamera = compiler.suggestCameraMode("sadness");
      expect(["dolly_out", "crane_down", "static", "tilt_down"]).toContain(
        sadCamera
      );

      const joyCamera = compiler.suggestCameraMode("joy");
      expect(["dolly_in", "crane_up", "orbit", "tracking"]).toContain(
        joyCamera
      );
    });

    it("should generate camera stability report", () => {
      const report = compiler.getCameraStabilityReport([
        "static",
        "dolly_in",
        "orbit",
      ]);
      expect(report.averageStability).toBeGreaterThan(0);
      expect(report.transitions.length).toBe(2);
      expect(report.transitions[0].from).toBe("static");
      expect(report.transitions[0].to).toBe("dolly_in");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. 首尾幀錨定 (Frame Anchoring)
  // ═══════════════════════════════════════════════════════════════

  describe("Frame Anchoring", () => {
    it("should build first frame anchor with image URL", () => {
      const anchor = compiler.buildFirstFrameAnchor(
        { blocks: [], firstFrameUrl: "https://example.com/first.jpg" },
        "serenity"
      );
      expect(anchor.type).toBe("first");
      expect(anchor.imageUrl).toBe("https://example.com/first.jpg");
      expect(anchor.cameraPosition).toBeTruthy();
      expect(anchor.lightingState).toBeTruthy();
    });

    it("should build first frame anchor from emotion when no image", () => {
      const anchor = compiler.buildFirstFrameAnchor({ blocks: [] }, "sadness");
      expect(anchor.type).toBe("first");
      expect(anchor.imageUrl).toBeUndefined();
      expect(anchor.description).toBeTruthy();
      expect(anchor.description.length).toBeGreaterThan(10);
    });

    it("should build last frame anchor with image URL", () => {
      const anchor = compiler.buildLastFrameAnchor(
        { blocks: [], lastFrameUrl: "https://example.com/last.jpg" },
        "joy"
      );
      expect(anchor.type).toBe("last");
      expect(anchor.imageUrl).toBe("https://example.com/last.jpg");
    });

    it("should build last frame anchor with text description", () => {
      const anchor = compiler.buildLastFrameAnchor(
        { blocks: [], lastFrameDesc: "A peaceful sunset over the ocean" },
        "serenity"
      );
      expect(anchor.type).toBe("last");
      expect(anchor.description).toBe("A peaceful sunset over the ocean");
    });

    it("should include frame anchors in compile result", () => {
      const result = compiler.compile({
        blocks: [mkBlock("mood", "dreamy")],
        firstFrameUrl: "https://example.com/first.jpg",
        lastFrameDesc: "Fade to soft light",
      });
      expect(result.firstFrameAnchor).toBeDefined();
      expect(result.firstFrameAnchor!.imageUrl).toBe(
        "https://example.com/first.jpg"
      );
      expect(result.lastFrameAnchor).toBeDefined();
      expect(result.lastFrameAnchor!.description).toBe("Fade to soft light");
    });

    it("should include frame anchor references in prompt", () => {
      const result = compiler.compile({
        blocks: [],
        firstFrameUrl: "https://example.com/first.jpg",
        lastFrameUrl: "https://example.com/last.jpg",
      });
      expect(result.prompt).toContain("[First Frame Reference:");
      expect(result.prompt).toContain("[Last Frame Reference:");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. 【相機運動+主體+具體動作+環境光影】公式
  // ═══════════════════════════════════════════════════════════════

  describe("Shot Formula Compilation", () => {
    it("should follow the formula: camera + subject + action + environment", () => {
      const result = compiler.compile({
        blocks: [
          mkBlock("subject", "a lone tree on a hilltop"),
          mkBlock("action", "swaying gently in the wind"),
          mkBlock("environment", "golden hour sunlight with long shadows"),
          mkBlock("camera", "dolly_in"),
        ],
      });

      const shot = result.shots[0];
      expect(shot.cameraMotion).toBeTruthy();
      expect(shot.subject).toContain("lone tree");
      expect(shot.action).toContain("swaying");
      expect(shot.environment).toContain("golden hour");
      expect(shot.prompt).toContain("lone tree");
      expect(shot.prompt).toContain("swaying");
    });

    it("should use emotion-derived actions when no action blocks provided", () => {
      const result = compiler.compile({
        blocks: [mkBlock("mood", "sad")],
      });

      const shot = result.shots[0];
      // Should have emotion-derived action verbs
      expect(shot.action).toBeTruthy();
      expect(shot.action.length).toBeGreaterThan(0);
    });

    it("should use emotion-derived environment when no env blocks provided", () => {
      const result = compiler.compile({
        blocks: [mkBlock("mood", "dreamy")],
      });

      const shot = result.shots[0];
      expect(shot.environment).toBeTruthy();
    });

    it("should include style in prompt", () => {
      const result = compiler.compile({
        blocks: [mkBlock("style", "anime")],
      });

      expect(result.prompt).toContain("[Style: anime]");
    });

    it("should apply slow motion modifier", () => {
      const result = compiler.compile({
        blocks: [mkBlock("mood", "serenity")],
        slowMotion: true,
      });

      expect(result.shots[0].prompt).toContain("slow motion");
    });

    it("should include aspect ratio in prompt", () => {
      const result = compiler.compile({
        blocks: [],
        aspectRatio: "9:16",
      });

      expect(result.prompt).toContain("[Aspect Ratio: 9:16]");
      expect(result.aspectRatio).toBe("9:16");
    });

    it("should include free prompt as additional direction", () => {
      const result = compiler.compile({
        blocks: [],
        freePrompt: "ethereal and dreamlike quality",
      });

      expect(result.prompt).toContain(
        "[Additional Direction] ethereal and dreamlike quality"
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. 視角跳躍阻擋
  // ═══════════════════════════════════════════════════════════════

  describe("Jump Block Mechanism", () => {
    it("should count blocked jumps in compile result", () => {
      const result = compiler.compile({
        blocks: [mkBlock("mood", "energy")],
        targetDurationSec: 20,
      });

      // jumpBlockCount should be a number (may be 0 if no jumps detected)
      expect(typeof result.jumpBlockCount).toBe("number");
      expect(result.jumpBlockCount).toBeGreaterThanOrEqual(0);
    });

    it("should log jump blocks in compilation log", () => {
      const result = compiler.compile({
        blocks: [mkBlock("mood", "mystery")],
        targetDurationSec: 20,
      });

      expect(result.compilationLog.length).toBeGreaterThan(0);
      expect(result.compilationLog[0]).toContain("開始編譯");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 6. 多鏡頭分配
  // ═══════════════════════════════════════════════════════════════

  describe("Multi-Shot Distribution", () => {
    it("should create single shot for ≤5s duration", () => {
      const result = compiler.compile({
        blocks: [mkBlock("mood", "serenity")],
        targetDurationSec: 5,
      });

      expect(result.shotCount).toBe(1);
    });

    it("should create multiple shots for >5s duration", () => {
      const result = compiler.compile({
        blocks: [mkBlock("mood", "wonder")],
        targetDurationSec: 15,
      });

      expect(result.shotCount).toBeGreaterThan(1);
      expect(result.shotCount).toBeLessThanOrEqual(5);
    });

    it("should cap at 5 shots maximum", () => {
      const result = compiler.compile({
        blocks: [mkBlock("mood", "energy")],
        targetDurationSec: 60,
      });

      expect(result.shotCount).toBeLessThanOrEqual(5);
    });

    it("should distribute duration evenly across shots", () => {
      const result = compiler.compile({
        blocks: [mkBlock("mood", "joy")],
        targetDurationSec: 20,
      });

      const totalDuration = result.shots.reduce(
        (sum, s) => sum + s.durationSec,
        0
      );
      expect(totalDuration).toBeCloseTo(20, 0);
    });

    it("should anchor first and last shots", () => {
      const result = compiler.compile({
        blocks: [mkBlock("mood", "nostalgia")],
        targetDurationSec: 15,
      });

      expect(result.shots[0].frameAnchor?.type).toBe("first");
      expect(result.shots[result.shots.length - 1].frameAnchor?.type).toBe(
        "last"
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 7. 情緒解析優先級
  // ═══════════════════════════════════════════════════════════════

  describe("Emotion Resolution Priority", () => {
    it("should prioritize mood blocks over keywords", () => {
      const result = compiler.compile({
        blocks: [mkBlock("mood", "dreamy")],
        moodKeywords: ["energy"],
      });

      // dreamy → serenity, not energy
      expect(result.emotionTranslations[0].from).toBe("serenity");
    });

    it("should use moodKeywords when no mood blocks", () => {
      const result = compiler.compile({
        blocks: [mkBlock("subject", "a mountain")],
        moodKeywords: ["peaceful"],
      });

      expect(result.emotionTranslations[0].from).not.toBe("energy");
    });

    it("should infer from freePrompt as last resort", () => {
      const result = compiler.compile({
        blocks: [mkBlock("subject", "a bird")],
        freePrompt: "sad and melancholic atmosphere",
      });

      expect(["sadness", "melancholy"]).toContain(
        result.emotionTranslations[0].from
      );
    });

    it("should default to serenity when no emotion cues", () => {
      const result = compiler.compile({
        blocks: [mkBlock("subject", "a rock")],
      });

      expect(result.emotionTranslations[0].from).toBe("serenity");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 8. 複合場景
  // ═══════════════════════════════════════════════════════════════

  describe("Complex Scenarios", () => {
    it("should handle full healing studio video compilation", () => {
      const result = compiler.compile({
        blocks: [
          mkBlock("subject", "a serene lake surrounded by mountains"),
          mkBlock("action", "mist slowly rising from the water surface"),
          mkBlock("environment", "dawn light with pink and gold tones"),
          mkBlock("mood", "serene"),
          mkBlock("style", "cinematic"),
        ],
        moodKeywords: ["healing", "peaceful"],
        targetDurationSec: 10,
        aspectRatio: "16:9",
        firstFrameDesc: "Wide establishing shot of the lake at dawn",
        lastFrameDesc: "Close-up of water ripples catching golden light",
      });

      expect(result.prompt).toBeTruthy();
      expect(result.shotCount).toBeGreaterThanOrEqual(1);
      expect(result.cameraStabilityScore).toBeGreaterThanOrEqual(1);
      expect(result.styleTag).toBeTruthy();
      expect(result.firstFrameAnchor).toBeDefined();
      expect(result.lastFrameAnchor).toBeDefined();
      expect(result.compilationLog.length).toBeGreaterThan(5);
    });

    it("should handle empty blocks gracefully", () => {
      const result = compiler.compile({ blocks: [] });
      expect(result.prompt).toBeTruthy();
      expect(result.shotCount).toBeGreaterThan(0);
      expect(result.cameraMode).toBeTruthy();
    });

    it("should handle single mood block", () => {
      const result = compiler.compile({
        blocks: [mkBlock("mood", "wonder")],
      });

      expect(result.prompt).toBeTruthy();
      expect(result.emotionTranslations[0].from).toBe("wonder");
    });

    it("should handle forced camera mode", () => {
      const result = compiler.compile({
        blocks: [mkBlock("mood", "sadness")],
        forceCameraMode: "crane_up",
      });

      expect(result.cameraMode).toBe("crane_up");
      expect(result.shots[0].cameraMotion).toContain("crane");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 9. 工具方法
  // ═══════════════════════════════════════════════════════════════

  describe("Utility Methods", () => {
    it("should preview emotion translation", () => {
      const preview = compiler.previewEmotionTranslation("wonder");
      expect(preview).not.toBeNull();
      expect(preview!.emotion).toBe("wonder");
      expect(preview!.actionVerbs.length).toBeGreaterThan(0);
    });

    it("should return null for unknown emotion preview", () => {
      const preview = compiler.previewEmotionTranslation("xyzunknown");
      expect(preview).toBeNull();
    });

    it("should return all supported emotions", () => {
      const emotions = compiler.getSupportedEmotions();
      expect(emotions).toContain("sadness");
      expect(emotions).toContain("joy");
      expect(emotions).toContain("serenity");
      expect(emotions).toContain("wonder");
      expect(emotions).toContain("freedom");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 10. Singleton
  // ═══════════════════════════════════════════════════════════════

  describe("getVideoCompiler", () => {
    it("should return singleton instance", () => {
      const a = getVideoCompiler();
      const b = getVideoCompiler();
      expect(a).toBe(b);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 11. 編譯日誌
  // ═══════════════════════════════════════════════════════════════

  describe("Compilation Log", () => {
    it("should produce structured compilation log", () => {
      const result = compiler.compile({
        blocks: [mkBlock("mood", "joy"), mkBlock("subject", "flowers")],
      });

      expect(result.compilationLog.length).toBeGreaterThanOrEqual(5);
      expect(result.compilationLog[0]).toContain("開始編譯");
      expect(result.compilationLog.some(l => l.includes("情緒解析"))).toBe(
        true
      );
      expect(result.compilationLog.some(l => l.includes("動作翻譯"))).toBe(
        true
      );
      expect(result.compilationLog.some(l => l.includes("相機模式"))).toBe(
        true
      );
      expect(result.compilationLog[result.compilationLog.length - 1]).toContain(
        "編譯完成"
      );
    });
  });
});
