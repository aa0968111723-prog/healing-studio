/**
 * shared/videoDraftRefinePipeline.ts — 雙層「草稿 → 精修」影片生成管線 SSOT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * AIDV-16：fal.ai 雙層生影片。
 *
 * 概念：
 *  - draft（草稿）層：便宜的模型（Seedance Lite / Wan）先快速出多個 take，
 *    讓創作者在 shot 畫布上比較、挑選、核准。成本刻意壓低。
 *  - refine（精修）層：核准後才用旗艦模型（Veo 3.1）把「已核准的 take」
 *    重跑一次高品質版本。成本高，因此只在使用者明確核准後才允許。
 *
 * 驗收（卡上留言 ⑨ / wave-4 認領）：
 *  1. draft 成本 ≤ refine 的 1/5（由 server 端定價守門測試釘住，
 *     見 server/services/__tests__/draftRefinePricing.test.ts）。
 *  2. 未核准的 take 送 refine 一律拒 422（由 videoStudio router 守門，
 *     見 server/routers/__tests__/videoStudioDraftRefine.router.test.ts）。
 *     核准狀態在 server 端可強制：除了本檔的契約檢查外，router 還要求
 *     server/services/videoTakeApproval.ts 簽發的 HMAC 核准憑證
 *     （綁 takeId＋userId＋時效），客戶端自報 status:"approved" 無法繞過。
 *
 * 這份檔案只放「純資料 + 純函式」，不 import 任何 server 模組，UI 與 server
 * 兩邊都能引用同一份 tier 定義，避免草稿/精修模型 id 在兩處漂移。
 *
 * ⚠️ 模型 id 以 fal 帳號頁為準（卡上避雷）：實作日 fal 端點命名如與此不同，
 *    只需更新這裡的常數 + modelPricing.ts + falModels.ts 三處對齊即可。
 */

/** 影片生成的兩個層級。 */
export type VideoTier = "draft" | "refine";

/**
 * 草稿層模型 id（便宜、快速、可多 take）。
 * 每一個都被 draftRefinePricing 測試釘住「成本 ≤ 任一 refine 模型的 1/5」。
 */
export const DRAFT_TIER_MODEL_IDS = [
  "fal-ai/bytedance/seedance/v1/lite/text-to-video",
  "fal-ai/wan-t2v",
] as const;

/**
 * 精修層模型 id（旗艦品質，僅在 take 核准後允許）。
 */
export const REFINE_TIER_MODEL_IDS = [
  "fal-ai/veo3.1",
] as const;

/** 前端「快速草稿」預設模型。 */
export const DEFAULT_DRAFT_MODEL_ID: (typeof DRAFT_TIER_MODEL_IDS)[number] =
  "fal-ai/bytedance/seedance/v1/lite/text-to-video";

/** 前端「高品質」精修預設模型。 */
export const DEFAULT_REFINE_MODEL_ID: (typeof REFINE_TIER_MODEL_IDS)[number] =
  "fal-ai/veo3.1";

/**
 * draft 成本相對 refine 的最大比例。draft ≤ refine × (1/DRAFT_REFINE_MAX_COST_RATIO)。
 * 卡上驗收：draft 成本 ≤ refine 1/5 → ratio = 5。
 */
export const DRAFT_REFINE_MAX_COST_RATIO = 5;

const DRAFT_SET: ReadonlySet<string> = new Set(DRAFT_TIER_MODEL_IDS);
const REFINE_SET: ReadonlySet<string> = new Set(REFINE_TIER_MODEL_IDS);

/** 回傳某 modelId 屬於哪一層；不在雙層管線中則回 null。 */
export function tierOfModel(modelId: string): VideoTier | null {
  if (DRAFT_SET.has(modelId)) return "draft";
  if (REFINE_SET.has(modelId)) return "refine";
  return null;
}

export function isDraftModel(modelId: string): boolean {
  return DRAFT_SET.has(modelId);
}

export function isRefineModel(modelId: string): boolean {
  return REFINE_SET.has(modelId);
}

// ─── take 核准狀態 ────────────────────────────────────────────────────────────

/**
 * 一個草稿 take 的核准狀態。
 *  - draft：剛生成、尚未被創作者檢視/核准。
 *  - approved：創作者在 shot 畫布上核准，可送精修。
 *  - rejected：創作者否決，不可送精修。
 */
export type TakeApprovalStatus = "draft" | "approved" | "rejected";

/** shot 畫布上一個草稿 take 的最小契約（送精修時攜帶）。 */
export interface DraftTakeRef {
  /** take 的唯一識別（同一 shot 下多個 take 用來區分）。 */
  takeId: string;
  /** 核准狀態。只有 "approved" 才允許送精修。 */
  status: TakeApprovalStatus;
  /** 草稿產出的影片 URL（精修時作為 refine 的參考/來源，可選）。 */
  sourceVideoUrl?: string;
}

/** 未核准 take 送精修時的拒絕訊息（router 會用此組 422 錯誤）。 */
export const REFINE_UNAPPROVED_MESSAGE =
  "此 take 尚未核准，無法送精修。請先在 shot 畫布上核准草稿 take 再進行高品質精修。";

/**
 * 判斷一個 take 是否可送精修：必須有非空 takeId 且 status === "approved"。
 * 純函式，不 throw；router 端據此決定是否拋 422。
 */
export function isTakeApprovedForRefine(
  take: DraftTakeRef | null | undefined
): boolean {
  if (!take) return false;
  if (typeof take.takeId !== "string" || take.takeId.trim().length === 0) {
    return false;
  }
  return take.status === "approved";
}

/**
 * 驗證「draft 成本 ≤ refine × (1/ratio)」。純函式，供定價守門測試使用。
 * @returns true 表示 draft 成本在預算內（合規）。
 */
export function isDraftWithinRefineBudget(
  draftPoints: number,
  refinePoints: number,
  ratio: number = DRAFT_REFINE_MAX_COST_RATIO
): boolean {
  if (!Number.isFinite(draftPoints) || !Number.isFinite(refinePoints)) {
    return false;
  }
  if (ratio <= 0) return false;
  // draft ≤ refine / ratio，等價於 draft × ratio ≤ refine（避免浮點除法誤差）。
  return draftPoints * ratio <= refinePoints;
}
