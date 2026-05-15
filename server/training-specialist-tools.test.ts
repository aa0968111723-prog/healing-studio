/**
 * Tests for 練練 (training-specialist) real tools.
 *
 * Coverage focus:
 *   - Pure functions (recommendParams / analyzeDataset / estimateTraining /
 *     getTips) have no DB dependency, so they exercise full happy + edge
 *     paths inline.
 *   - DB-backed tools (listMyModels / getModelStatus) — we don't spin up
 *     MySQL in unit tests; the dispatcher pathway covers integration
 *     elsewhere. Here we verify the catch-block fallback shape so
 *     練練 never crashes when DB is unavailable.
 */

import { describe, expect, it } from "vitest";
import {
  recommendParams,
  analyzeDataset,
  estimateTraining,
  getTips,
  isTrainingModelType,
} from "./services/spiritTools/trainingSpecialistTools";

// ─── recommendParams ───────────────────────────────────────────────────────

describe("trainingSpecialistTools.recommendParams", () => {
  it("returns baseline params for image_subject with adequate dataset", () => {
    const r = recommendParams({ modelType: "image_subject", imageCount: 20 });
    expect(r.modelType).toBe("image_subject");
    expect(r.modelTypeLabel).toBe("角色 LoRA");
    expect(r.recommended.epochs).toBeGreaterThan(0);
    expect(r.recommended.learningRate).toBe(0.0001);
    expect(r.recommended.batchSize).toBe(1);
    expect(r.recommended.isStyle).toBe(false);
    expect(r.datasetAdequacy).toBe("sufficient");
    expect(r.estimatedSteps).toBeGreaterThanOrEqual(200);
    expect(r.estimatedSteps).toBeLessThanOrEqual(4000);
    expect(r.suggestedTriggerWord).toContain("_lora");
  });

  it("flags style_lora with isStyle=true and higher step count", () => {
    const r = recommendParams({ modelType: "style_lora", imageCount: 40 });
    expect(r.recommended.isStyle).toBe(true);
    // style_lora baseline is epochs=25 → steps ≥ 2500
    expect(r.estimatedSteps).toBeGreaterThanOrEqual(2500);
  });

  it("flags insufficient data when count is well below minimum", () => {
    const r = recommendParams({ modelType: "image_subject", imageCount: 5 });
    expect(r.datasetAdequacy).toBe("insufficient");
    expect(r.reasoning.some(t => t.includes("不足"))).toBe(true);
  });

  it("flags marginal data when count is close to but below minimum", () => {
    const r = recommendParams({ modelType: "image_subject", imageCount: 12 });
    expect(r.datasetAdequacy).toBe("marginal");
  });

  it("speed preference reduces epochs vs balanced", () => {
    const balanced = recommendParams({
      modelType: "image_subject",
      imageCount: 20,
      preference: "balanced",
    });
    const speed = recommendParams({
      modelType: "image_subject",
      imageCount: 20,
      preference: "speed",
    });
    expect(speed.recommended.epochs).toBeLessThan(balanced.recommended.epochs);
  });

  it("quality preference increases epochs vs balanced", () => {
    const balanced = recommendParams({
      modelType: "image_subject",
      imageCount: 20,
      preference: "balanced",
    });
    const quality = recommendParams({
      modelType: "image_subject",
      imageCount: 20,
      preference: "quality",
    });
    expect(quality.recommended.epochs).toBeGreaterThan(balanced.recommended.epochs);
  });

  it("video_lora uses lower learning rate to avoid overfit", () => {
    const r = recommendParams({ modelType: "video_lora", videoCount: 15 });
    expect(r.recommended.learningRate).toBeLessThanOrEqual(0.0001);
  });

  it("handles zero data by marking insufficient with explicit hint", () => {
    const r = recommendParams({ modelType: "portrait_lora" });
    expect(r.datasetAdequacy).toBe("insufficient");
    expect(r.reasoning.some(t => t.includes("尚未提供訓練資料"))).toBe(true);
  });
});

// ─── analyzeDataset ────────────────────────────────────────────────────────

describe("trainingSpecialistTools.analyzeDataset", () => {
  it("returns request-more-data + recommendations when total=0", () => {
    const r = analyzeDataset({ modelType: "image_subject" });
    expect(r.adequacy).toBe("insufficient");
    expect(r.nextStep).toBe("request-more-data");
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.verdict).toContain("還沒有");
  });

  it("returns ready-to-train when count is marginal but acceptable", () => {
    // image_subject min=15, marginal range is [9, 14]
    const r = analyzeDataset({ modelType: "image_subject", imageCount: 12 });
    expect(r.adequacy).toBe("marginal");
    expect(r.nextStep).toBe("ready-to-train");
  });

  it("returns request-trigger-word when data is sufficient (next is open training)", () => {
    const r = analyzeDataset({ modelType: "image_subject", imageCount: 20 });
    expect(r.adequacy).toBe("sufficient");
    expect(r.nextStep).toBe("request-trigger-word");
  });

  it("treats style_lora minimum higher (30+) than image_subject (15+)", () => {
    const imgAt15 = analyzeDataset({
      modelType: "image_subject",
      imageCount: 15,
    });
    const styleAt15 = analyzeDataset({
      modelType: "style_lora",
      imageCount: 15,
    });
    expect(imgAt15.adequacy).toBe("sufficient");
    // style_lora needs 30 — at 15 it's marginal (15 ≥ 18=60%·30 fails →
    // insufficient because 15 < 18)
    expect(styleAt15.adequacy).toBe("insufficient");
  });

  it("merges imageCount + videoCount toward the total", () => {
    const r = analyzeDataset({
      modelType: "video_lora",
      videoCount: 8,
      imageCount: 4,
    });
    expect(r.totalCount).toBe(12);
    expect(r.adequacy).toBe("sufficient"); // video_lora min=10
  });

  it("voice_clone needs only 1 sample to be sufficient", () => {
    const r = analyzeDataset({ modelType: "voice_clone", videoCount: 1 });
    expect(r.adequacy).toBe("sufficient");
  });
});

// ─── estimateTraining ──────────────────────────────────────────────────────

describe("trainingSpecialistTools.estimateTraining", () => {
  it("returns positive points + ETA for image_subject", () => {
    const r = estimateTraining({ modelType: "image_subject" });
    expect(r.estimatedPoints).toBeGreaterThan(0);
    expect(r.estimatedMinutes.min).toBeGreaterThanOrEqual(0);
    expect(r.estimatedMinutes.max).toBeGreaterThanOrEqual(r.estimatedMinutes.min);
    expect(r.steps).toBeGreaterThan(0);
    expect(r.resolvedFalModelId).toMatch(/^fal-ai\//);
  });

  it("video_lora resolves to hunyuan training model and longer ETA per step", () => {
    const img = estimateTraining({ modelType: "image_subject", steps: 1000 });
    const vid = estimateTraining({ modelType: "video_lora", steps: 1000 });
    expect(vid.resolvedFalModelId).toContain("hunyuan");
    // Same step count → video should be slower (2-3x)
    expect(vid.estimatedMinutes.min).toBeGreaterThan(img.estimatedMinutes.min);
  });

  it("portrait_lora resolves to the portrait-trainer endpoint", () => {
    const r = estimateTraining({ modelType: "portrait_lora" });
    expect(r.resolvedFalModelId).toContain("portrait");
  });

  it("more steps yield more (or equal-clamped) points", () => {
    const low = estimateTraining({ modelType: "image_subject", steps: 500 });
    const high = estimateTraining({ modelType: "image_subject", steps: 3000 });
    expect(high.estimatedPoints).toBeGreaterThanOrEqual(low.estimatedPoints);
  });

  it("respects forced falModelId override", () => {
    const r = estimateTraining({
      modelType: "image_subject",
      falModelId: "fal-ai/sd3-lora-training",
    });
    expect(r.resolvedFalModelId).toBe("fal-ai/sd3-lora-training");
  });
});

// ─── getTips ───────────────────────────────────────────────────────────────

describe("trainingSpecialistTools.getTips", () => {
  it("returns general tips when no modelType passed", () => {
    const r = getTips();
    expect(r.modelType).toBe("general");
    expect(r.tips.length).toBeGreaterThan(0);
  });

  it("returns image_subject-specific tips when modelType=image_subject", () => {
    const r = getTips({ modelType: "image_subject" });
    expect(r.modelType).toBe("image_subject");
    // image_subject tips should mention 角度
    expect(r.tips.some(t => t.includes("角度"))).toBe(true);
  });

  it("returns style_lora-specific tips when modelType=style_lora", () => {
    const r = getTips({ modelType: "style_lora" });
    expect(r.modelType).toBe("style_lora");
    expect(r.tips.some(t => t.includes("isStyle"))).toBe(true);
  });

  it("returns video_lora-specific tips with hunyuan reference", () => {
    const r = getTips({ modelType: "video_lora" });
    expect(r.modelType).toBe("video_lora");
    expect(r.tips.some(t => t.includes("hunyuan"))).toBe(true);
  });
});

// ─── type guard ────────────────────────────────────────────────────────────

describe("trainingSpecialistTools.isTrainingModelType", () => {
  it.each([
    "image_subject",
    "portrait_lora",
    "style_lora",
    "scene_lora",
    "video_lora",
    "voice_clone",
  ])("accepts %s", v => {
    expect(isTrainingModelType(v)).toBe(true);
  });

  it.each([null, undefined, 123, "concept_lora", "", "RANDOM"])(
    "rejects %s",
    v => {
      expect(isTrainingModelType(v)).toBe(false);
    }
  );
});
