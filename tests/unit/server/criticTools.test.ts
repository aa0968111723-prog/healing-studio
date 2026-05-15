/**
 * Unit tests for critic (品品) tools.
 *
 * These exercise the deterministic review / scoring / rewriting / comparison /
 * handoff layer:
 *   - reviewAsset:          modality rubric → highlights + improvements + score
 *   - scoreAsset:           weak-dimension surfacing
 *   - compareIterations:    winner + improved / regressed dims
 *   - suggestPromptRewrite: 1-3 vouchsafe rewrites with promptPatch
 *   - planHandoff:          critique-type → spirit
 *
 * All tools are pure — no DB, no LLM — so the tests don't need any mocks.
 */

import { describe, expect, it } from "vitest";
import {
  reviewAsset,
  scoreAsset,
  compareIterations,
  suggestPromptRewrite,
  planHandoff,
} from "../../../server/services/spiritTools/criticTools";

describe("reviewAsset", () => {
  it("returns 2 highlights and up to 3 improvements with rubric for image modality", () => {
    const review = reviewAsset({
      modality: "image",
      prompt: "a cat",
      goal: "IG post",
      iteration: 1,
    });

    expect(review.highlights.length).toBeLessThanOrEqual(2);
    expect(review.highlights.length).toBeGreaterThanOrEqual(1);
    expect(review.improvements.length).toBeLessThanOrEqual(3);
    expect(review.improvements.length).toBeGreaterThanOrEqual(1);
    expect(review.rubric.length).toBeGreaterThan(0);
    // image rubric should include composition / lighting / subject_clarity
    const keys = review.rubric.map(r => r.key);
    expect(keys).toContain("composition");
    expect(keys).toContain("lighting");
    expect(keys).toContain("subject_clarity");
    // Each rubric entry must have a Chinese label
    review.rubric.forEach(r => {
      expect(r.label.length).toBeGreaterThan(0);
    });
  });

  it("attaches a promptPatch to most improvements (so quality-coach can chain)", () => {
    const review = reviewAsset({
      modality: "image",
      prompt: "a cat",
      iteration: 1,
    });
    const withPatch = review.improvements.filter(i => i.promptPatch);
    expect(withPatch.length).toBeGreaterThan(0);
  });

  it("detects 'blurry' user feedback and ups subject_clarity priority", () => {
    const review = reviewAsset({
      modality: "image",
      prompt: "a cat",
      userFeedback: "好像有點模糊",
      iteration: 1,
    });
    const clarity = review.improvements.find(i => i.dimension === "subject_clarity");
    expect(clarity).toBeDefined();
    expect(clarity!.priority).toBe("high");
  });

  it("returns deterministic scores for same input", () => {
    const a = reviewAsset({ modality: "image", prompt: "test prompt", iteration: 1 });
    const b = reviewAsset({ modality: "image", prompt: "test prompt", iteration: 1 });
    expect(a.overallScore).toBe(b.overallScore);
    expect(a.dimensionScores).toEqual(b.dimensionScores);
  });

  it("flags aspect mismatch with goal as a composition issue", () => {
    const review = reviewAsset({
      modality: "image",
      prompt: "a sunset",
      aspect: "1:1",
      goal: "IG Reels vertical short",
      iteration: 1,
    });
    const comp = review.improvements.find(i => i.dimension === "composition");
    expect(comp).toBeDefined();
    expect(comp!.priority).toBe("high");
  });

  it("routes to quality-coach when most improvements have promptPatch", () => {
    const review = reviewAsset({
      modality: "video",
      prompt: "a video",
      iteration: 1,
    });
    // Most video improvements have promptPatch → handoff to quality-coach
    expect(["quality-coach", "composer"]).toContain(review.suggestedHandoff.to);
  });

  it("suggests video-specific dimensions when modality is video", () => {
    const review = reviewAsset({
      modality: "video",
      prompt: "a 5 second video",
      iteration: 1,
    });
    const keys = review.rubric.map(r => r.key);
    expect(keys).toContain("pacing");
    expect(keys).toContain("camera_stability");
    expect(keys).toContain("hook_strength");
  });

  it("suggests emotion_match for music with no emotion keyword", () => {
    const review = reviewAsset({
      modality: "music",
      prompt: "a song",
      iteration: 1,
    });
    const emotion = review.improvements.find(i => i.dimension === "emotion_match");
    expect(emotion).toBeDefined();
  });

  it("escalates a low-priority weakness to high on iteration >= 3", () => {
    const review = reviewAsset({
      modality: "image",
      prompt: "a vibrant photo with golden hour, cinematic, ultra-detailed",
      iteration: 3,
    });
    // iter 3 should push the first improvement to high priority
    if (review.improvements.length > 0) {
      expect(review.improvements[0].priority).toBe("high");
    }
  });

  it("always provides at least one improvement (fallback path)", () => {
    const review = reviewAsset({
      modality: "image",
      // Very rich prompt that should pass all heuristic checks
      prompt:
        "a cat at golden hour with cinematic rim light, shallow depth of field, ultra-detailed cinematic photograph, wide shot composition",
      iteration: 1,
    });
    expect(review.improvements.length).toBeGreaterThanOrEqual(1);
  });
});

describe("scoreAsset", () => {
  it("flags weak dimensions when prompt is very short", () => {
    const score = scoreAsset({
      modality: "image",
      prompt: "cat",
      iteration: 1,
    });
    expect(score.overallScore).toBeGreaterThan(0);
    expect(score.overallScore).toBeLessThanOrEqual(100);
    // Some dimensions will be in 50-65 range; surfacing happens at < 60
    expect(Array.isArray(score.weakDimensions)).toBe(true);
  });

  it("returns higher overall score for a rich, detailed prompt", () => {
    const weak = scoreAsset({ modality: "image", prompt: "cat", iteration: 1 });
    const strong = scoreAsset({
      modality: "image",
      prompt:
        "a cat at golden hour with cinematic rim light, shallow depth of field, ultra-detailed cinematic photograph, wide shot composition, rule of thirds",
      iteration: 1,
    });
    expect(strong.overallScore).toBeGreaterThan(weak.overallScore);
  });
});

describe("compareIterations", () => {
  it("picks the highest-scoring iteration as winner", () => {
    const result = compareIterations({
      iterations: [
        {
          id: "v1",
          modality: "image",
          prompt: "cat",
          iteration: 1,
        },
        {
          id: "v2",
          modality: "image",
          prompt:
            "a cat at golden hour with cinematic rim light, shallow depth of field, ultra-detailed",
          iteration: 2,
        },
      ],
    });
    expect(result.winnerId).toBe("v2");
    expect(result.rankings.length).toBe(2);
    expect(result.rankings[0].overallScore).toBeGreaterThanOrEqual(
      result.rankings[1].overallScore
    );
  });

  it("reports improved dimensions when latest is stronger", () => {
    const result = compareIterations({
      iterations: [
        { id: "v1", modality: "image", prompt: "cat", iteration: 1 },
        {
          id: "v2",
          modality: "image",
          prompt:
            "a cat at golden hour with cinematic rim light, shallow depth of field",
          iteration: 2,
        },
      ],
    });
    expect(result.improvedDimensions.length).toBeGreaterThan(0);
  });

  it("recommends going back when an earlier version is better", () => {
    const result = compareIterations({
      iterations: [
        {
          id: "v1",
          modality: "image",
          prompt:
            "a cat at golden hour with cinematic rim light, shallow depth of field, ultra-detailed",
          iteration: 1,
        },
        { id: "v2", modality: "image", prompt: "cat", iteration: 2 },
      ],
    });
    expect(result.winnerId).toBe("v1");
    expect(result.recommendation).toMatch(/回頭/);
  });

  it("returns empty result safely when no iterations provided", () => {
    const result = compareIterations({ iterations: [] });
    expect(result.winnerId).toBe("");
    expect(result.rankings).toEqual([]);
    expect(result.recommendation).toMatch(/沒有/);
  });
});

describe("suggestPromptRewrite", () => {
  it("returns 1-3 rewrites each appending a real patch", () => {
    const result = suggestPromptRewrite({
      modality: "image",
      originalPrompt: "a cat",
      limit: 3,
    });
    expect(result.options.length).toBeGreaterThanOrEqual(1);
    expect(result.options.length).toBeLessThanOrEqual(3);
    result.options.forEach(opt => {
      expect(opt.rewrittenPrompt.length).toBeGreaterThan("a cat".length);
      expect(opt.touchedDimensions.length).toBeGreaterThan(0);
    });
  });

  it("honours targetDimensions when caller supplies them", () => {
    const result = suggestPromptRewrite({
      modality: "image",
      originalPrompt: "a cat",
      targetDimensions: ["lighting"],
      limit: 1,
    });
    expect(result.options.length).toBe(1);
    expect(result.options[0].touchedDimensions).toContain("光線/光影");
  });

  it("clamps limit to 1..3", () => {
    const tooMany = suggestPromptRewrite({
      modality: "image",
      originalPrompt: "a cat",
      limit: 99,
    });
    expect(tooMany.options.length).toBeLessThanOrEqual(3);

    const tooFew = suggestPromptRewrite({
      modality: "image",
      originalPrompt: "a cat",
      limit: -5,
    });
    expect(tooFew.options.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to a deduplication option when original already has every patch", () => {
    const result = suggestPromptRewrite({
      modality: "image",
      originalPrompt:
        "a cat, rule of thirds, dynamic composition, leading lines, shallow depth of field, cinematic rim light, ultra-detailed, single coherent art style",
      limit: 3,
    });
    expect(result.options.length).toBeGreaterThanOrEqual(1);
  });
});

describe("planHandoff", () => {
  it("routes prompt-level critique to quality-coach", () => {
    const result = planHandoff({
      modality: "image",
      critiqueType: "prompt-level",
    });
    expect(result.to).toBe("quality-coach");
    expect(result.requiresUserConfirmation).toBe(true);
  });

  it("routes settings-level critique to composer", () => {
    const result = planHandoff({
      modality: "image",
      critiqueType: "settings-level",
    });
    expect(result.to).toBe("composer");
  });

  it("routes model-level critique to researcher", () => {
    const result = planHandoff({
      modality: "video",
      critiqueType: "model-level",
    });
    expect(result.to).toBe("researcher");
  });

  it("routes creative-direction critique to inspiration-specialist", () => {
    const result = planHandoff({
      modality: "music",
      critiqueType: "creative-direction",
    });
    expect(result.to).toBe("inspiration-specialist");
  });

  it("clears requiresUserConfirmation when userAcceptedFix is true", () => {
    const result = planHandoff({
      modality: "image",
      critiqueType: "prompt-level",
      userAcceptedFix: true,
    });
    expect(result.requiresUserConfirmation).toBe(false);
  });

  it("prefers the suggestedHandoff override when provided", () => {
    const result = planHandoff({
      modality: "image",
      critiqueType: "prompt-level",
      suggestedHandoff: { to: "composer", reason: "override" },
    });
    expect(result.to).toBe("composer");
    expect(result.reason).toBe("override");
  });

  it("produces a modality-appropriate intentSummary", () => {
    const image = planHandoff({ modality: "image", critiqueType: "prompt-level" });
    const video = planHandoff({ modality: "video", critiqueType: "prompt-level" });
    expect(image.intentSummary).toMatch(/圖片/);
    expect(video.intentSummary).toMatch(/影片/);
  });
});
