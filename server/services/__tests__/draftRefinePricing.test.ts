/**
 * draftRefinePricing.test.ts — AIDV-16 驗收 #1：draft 成本 ≤ refine 1/5
 *
 * 錨定真實定價目錄（modelPricing.ts）：對每一個 (draft, refine) 模型組合、
 * 在多個時長點驗證 estimatePoints(draft) × 5 ≤ estimatePoints(refine)。
 * 任何把草稿模型漲價或把精修模型降價到破壞此比例的突變都會立刻變紅。
 */
import { describe, it, expect } from "vitest";
import { estimatePoints, getModelPricing, MODEL_PRICING_CATALOG } from "../modelPricing";
import {
  DRAFT_TIER_MODEL_IDS,
  REFINE_TIER_MODEL_IDS,
  DRAFT_REFINE_MAX_COST_RATIO,
  isDraftWithinRefineBudget,
} from "../../../shared/videoDraftRefinePipeline";

const DURATIONS_SEC = [5, 6, 10, 20];

describe("AIDV-16 雙層定價一致性", () => {
  it("每個草稿/精修模型在定價目錄中都有條目", () => {
    for (const id of [...DRAFT_TIER_MODEL_IDS, ...REFINE_TIER_MODEL_IDS]) {
      expect(getModelPricing(id), `pricing missing for ${id}`).not.toBeNull();
    }
  });

  it("草稿模型皆為 fal provider 且需要 FAL_API_KEY（沿用既有計費/金鑰路徑）", () => {
    for (const id of [...DRAFT_TIER_MODEL_IDS, ...REFINE_TIER_MODEL_IDS]) {
      const p = MODEL_PRICING_CATALOG[id];
      expect(p.provider).toBe("fal");
      expect(p.requiresKey).toBe(true);
      expect(p.keyEnvVar).toBe("FAL_API_KEY");
    }
  });

  it("驗收 #1：每個 (draft, refine) 組合在各時長下 draft 成本 ≤ refine × 1/5", () => {
    for (const draftId of DRAFT_TIER_MODEL_IDS) {
      for (const refineId of REFINE_TIER_MODEL_IDS) {
        for (const durationSec of DURATIONS_SEC) {
          const draftPts = estimatePoints(draftId, { durationSec }).totalPoints;
          const refinePts = estimatePoints(refineId, { durationSec }).totalPoints;
          expect(
            isDraftWithinRefineBudget(draftPts, refinePts, DRAFT_REFINE_MAX_COST_RATIO),
            `draft ${draftId} (${draftPts}pts) 超過 refine ${refineId} (${refinePts}pts) 的 1/${DRAFT_REFINE_MAX_COST_RATIO} @ ${durationSec}s`
          ).toBe(true);
        }
      }
    }
  });

  it("即使 draft 打到 maxPoints、refine 也仍 ≥ draft × 5（封頂邊界安全）", () => {
    for (const draftId of DRAFT_TIER_MODEL_IDS) {
      const draftMax = MODEL_PRICING_CATALOG[draftId].maxPoints;
      for (const refineId of REFINE_TIER_MODEL_IDS) {
        const refineMax = MODEL_PRICING_CATALOG[refineId].maxPoints;
        expect(
          draftMax * DRAFT_REFINE_MAX_COST_RATIO,
          `draft max ${draftId}=${draftMax} × 5 > refine max ${refineId}=${refineMax}`
        ).toBeLessThanOrEqual(refineMax);
      }
    }
  });
});
