/**
 * shared/videoModelCatalog.ts — 影片創作室「canonical model id」單一真實來源
 *
 * 這是 docs/audits/brain-config-gap-audit-2026-04-20.md 標的 P0 SSOT 修復。
 * UI（VideoStudio.tsx）、router（videoStudio.ts）、middleware
 * （brainContext.ts）、dispatcher（falDispatcher.ts）都應以這份為準，
 * 避免 `fal/...` 與 `fal-ai/...` 風格漂移。
 *
 * 任何新增影片模型應同步：
 *   1. 在這裡加 canonical id
 *   2. server/services/falModels.ts 註冊 catalog（schema/timeout）
 *   3. server/services/modelPricing.ts 註冊定價
 *   4. server/routers/brain.ts GENERATION_ENGINE_CATALOG.videoEngine 補入
 *
 * 一致性會由 server/services/__tests__/videoCatalogConsistency.test.ts 守住。
 */

/**
 * `videoStudio.ts` router 真的會送進 fal queue 的 modelId。
 * 用來檢查 pricing 與 falModels 都對齊。
 */
export const T2V_ROUTER_IDS = [
  "fal-ai/kling-video/v2.1/standard/text-to-video",
  "fal-ai/wan-t2v",
  "fal-ai/minimax/hailuo-02/pro/text-to-video",
  "fal-ai/veo3",
  "fal-ai/veo3/pro",
  "fal-ai/ltx-video-13b-distilled",
  "fal-ai/sora",
  // AIDV-16：雙層生影片管線 —— 草稿層 Seedance Lite（便宜）＋精修層 Veo 3.1（旗艦）。
  // 兩者都由 videoStudio.ts 的 seedanceTextToVideo / veo31RefineSegment 真的送 fal，
  // 故列在 router id 集合，並由 videoCatalogConsistency 守住 pricing/falModels 對齊。
  "fal-ai/bytedance/seedance/v1/lite/text-to-video",
  "fal-ai/veo3.1",
] as const;

/**
 * AIDV-16：雙層「草稿 → 精修」管線的 tier 分組。SSOT 是
 * shared/videoDraftRefinePipeline.ts（server 精修守門實際 import 之處）；
 * 這裡只 re-export 同一份常數供 catalog 使用端引用，避免第二份手抄清單漂移。
 */
export {
  DRAFT_TIER_MODEL_IDS as DRAFT_TIER_ROUTER_IDS,
  REFINE_TIER_MODEL_IDS as REFINE_TIER_ROUTER_IDS,
} from "./videoDraftRefinePipeline";

export const I2V_ROUTER_IDS = [
  "fal-ai/kling-video/v2.1/standard/image-to-video",
  "fal-ai/kling-video/v2.1/pro/image-to-video",
  "fal-ai/wan-i2v",
  "fal-ai/runway-gen4-turbo/image-to-video",
  "fal-ai/pixverse/v4.5/image-to-video",
  "fal-ai/minimax/hailuo-02/pro/image-to-video",
  "fal-ai/ltx-video/image-to-video",
] as const;

export const V2V_ROUTER_IDS = [
  "fal-ai/wan/v2.1/video-to-video",
  "fal-ai/kling-video/v2.1/standard/video-to-video",
  "fal-ai/animatediff-v2v",
] as const;

/**
 * 畫質優化（enhance）：videoStudio.ts 的 videoUpscale / frameInterpolation /
 * topazEnhance 真的會送進 fal queue 的 modelId。
 * 雖然 fal 把這些歸在 video-to-video 類別，但語義上是「後處理」，獨立列出。
 */
export const ENHANCE_ROUTER_IDS = [
  "fal-ai/bytedance/upscaler/video",
  "fal-ai/rife-v4.6/video",
  "fal-ai/topaz/video-enhance",
] as const;

/**
 * 進階控制（control）：videoStudio.ts 的 camMaster / depthCrafter /
 * viduReferenceToVideo / animateDiff 真的會送進 fal queue 的 modelId。
 * animateDiff 也屬 v2v；這裡列出獨立的三個。
 */
export const CONTROL_ROUTER_IDS = [
  "fal-ai/cammaster",
  "fal-ai/depthcrafter",
  "fal-ai/vidu/q1/reference-to-video",
] as const;

/** control 模型在 falModels 對應的類別（i2v 還是 v2v）。 */
export const CONTROL_CATEGORY_BY_ID: Record<string, "image-to-video" | "video-to-video"> = {
  "fal-ai/cammaster": "image-to-video",
  "fal-ai/depthcrafter": "video-to-video",
  "fal-ai/vidu/q1/reference-to-video": "image-to-video",
};

/**
 * `VideoStudio.tsx` 用 `modelId="..."` 顯示在 ModelCard 上的 ID。
 * 這些不是 router 直接呼叫的，但 UI 會用 `getModelPricing(modelId)`
 * 顯示積分價格，所以同樣需要在 pricing 裡有對應。
 */
export const VIDEO_UI_ONLY_IDS = [
  "fal-ai/wan-ai/wan2.1-t2v-720p",
  "fal-ai/wan-ai/wan2.1-i2v-720p",
  "fal-ai/wan-ai/wan2.1-v2v-480p",
  "fal-ai/kling-video/v1.6/standard/video-to-video",
  "fal-ai/minimax/video-01",
  "fal-ai/minimax/video-01/image-to-video",
] as const;

export const ALL_VIDEO_ROUTER_IDS: readonly string[] = [
  ...T2V_ROUTER_IDS,
  ...I2V_ROUTER_IDS,
  ...V2V_ROUTER_IDS,
  ...ENHANCE_ROUTER_IDS,
  ...CONTROL_ROUTER_IDS,
];

export const ALL_VIDEO_PRICING_IDS: readonly string[] = [
  ...ALL_VIDEO_ROUTER_IDS,
  ...VIDEO_UI_ONLY_IDS,
];

export type VideoCategory = "text-to-video" | "image-to-video" | "video-to-video";
