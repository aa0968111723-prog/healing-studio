/**
 * video-draft-refine-pipeline.test.ts — AIDV-16 雙層管線 SSOT 純函式守門
 *
 * 錨定 shared/videoDraftRefinePipeline.ts 的 tier 分組與核准守門邏輯。
 * 任一常數 / 判斷突變即紅（例如把 "approved" 改成其他值、把草稿模型移出集合）。
 */
import { describe, it, expect } from "vitest";
import {
  DRAFT_TIER_MODEL_IDS,
  REFINE_TIER_MODEL_IDS,
  DEFAULT_DRAFT_MODEL_ID,
  DEFAULT_REFINE_MODEL_ID,
  DRAFT_REFINE_MAX_COST_RATIO,
  tierOfModel,
  isDraftModel,
  isRefineModel,
  isTakeApprovedForRefine,
  isDraftWithinRefineBudget,
  type DraftTakeRef,
} from "../../../shared/videoDraftRefinePipeline";

describe("AIDV-16 tier 分組", () => {
  it("Seedance Lite 與 Wan 屬草稿層、Veo 3.1 屬精修層", () => {
    expect(isDraftModel("fal-ai/bytedance/seedance/v1/lite/text-to-video")).toBe(true);
    expect(isDraftModel("fal-ai/wan-t2v")).toBe(true);
    expect(isRefineModel("fal-ai/veo3.1")).toBe(true);

    expect(tierOfModel("fal-ai/bytedance/seedance/v1/lite/text-to-video")).toBe("draft");
    expect(tierOfModel("fal-ai/veo3.1")).toBe("refine");
  });

  it("draft 與 refine 集合互斥、無交集", () => {
    const draft = new Set<string>(DRAFT_TIER_MODEL_IDS);
    for (const id of REFINE_TIER_MODEL_IDS) {
      expect(draft.has(id)).toBe(false);
    }
  });

  it("預設草稿/精修模型分別落在對應集合內", () => {
    expect(isDraftModel(DEFAULT_DRAFT_MODEL_ID)).toBe(true);
    expect(isRefineModel(DEFAULT_REFINE_MODEL_ID)).toBe(true);
  });

  it("不在雙層管線中的模型回 null", () => {
    expect(tierOfModel("fal-ai/kling-video/v2.1/pro/text-to-video")).toBeNull();
    expect(tierOfModel("fal-ai/unknown")).toBeNull();
  });
});

describe("AIDV-16 take 核准守門 isTakeApprovedForRefine", () => {
  const base: DraftTakeRef = { takeId: "t-1", status: "approved" };

  it("已核准且有非空 takeId → 允許", () => {
    expect(isTakeApprovedForRefine(base)).toBe(true);
  });

  it("狀態非 approved → 拒絕", () => {
    expect(isTakeApprovedForRefine({ ...base, status: "draft" })).toBe(false);
    expect(isTakeApprovedForRefine({ ...base, status: "rejected" })).toBe(false);
  });

  it("takeId 空 / 空白 → 拒絕（即使 status=approved）", () => {
    expect(isTakeApprovedForRefine({ takeId: "", status: "approved" })).toBe(false);
    expect(isTakeApprovedForRefine({ takeId: "   ", status: "approved" })).toBe(false);
  });

  it("null / undefined → 拒絕", () => {
    expect(isTakeApprovedForRefine(null)).toBe(false);
    expect(isTakeApprovedForRefine(undefined)).toBe(false);
  });
});

describe("AIDV-16 draft ≤ refine × 1/5 預算不變式", () => {
  it("ratio 常數為 5（驗收：draft 成本 ≤ refine 1/5）", () => {
    expect(DRAFT_REFINE_MAX_COST_RATIO).toBe(5);
  });

  it("draft × 5 ≤ refine → 合規", () => {
    expect(isDraftWithinRefineBudget(6, 90)).toBe(true); // 6×5=30 ≤ 90
    expect(isDraftWithinRefineBudget(18, 90)).toBe(true); // 邊界：18×5=90 ≤ 90
  });

  it("draft × 5 > refine → 不合規", () => {
    expect(isDraftWithinRefineBudget(19, 90)).toBe(false); // 19×5=95 > 90
    expect(isDraftWithinRefineBudget(30, 90)).toBe(false);
  });

  it("非有限數 / 非正 ratio → 不合規（fail-closed）", () => {
    expect(isDraftWithinRefineBudget(Number.NaN, 90)).toBe(false);
    expect(isDraftWithinRefineBudget(6, Number.POSITIVE_INFINITY)).toBe(false);
    expect(isDraftWithinRefineBudget(6, 90, 0)).toBe(false);
  });
});

describe("AIDV-16 tier 集合單一 SSOT（videoModelCatalog 只 re-export，不得漂移）", () => {
  it("videoModelCatalog 的 DRAFT/REFINE_TIER_ROUTER_IDS 與 pipeline SSOT 逐元素相等", async () => {
    const catalog = await import("../../../shared/videoModelCatalog");
    expect([...catalog.DRAFT_TIER_ROUTER_IDS]).toEqual([...DRAFT_TIER_MODEL_IDS]);
    expect([...catalog.REFINE_TIER_ROUTER_IDS]).toEqual([...REFINE_TIER_MODEL_IDS]);
  });
});
