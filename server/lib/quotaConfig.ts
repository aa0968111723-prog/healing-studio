/**
 * quotaConfig.ts — AIDV-277 Creator 用量配額透明層（純函式核心）
 *
 * 收斂自 AIDV-273（配額透明度）。本檔只放**純計算**：方案配額表、方案識別解析、
 * 當月配額狀態推導、預生成費用估算。所有 I/O（DB 讀取、tRPC）在
 * server/routers/creatorDashboard.ts，本檔完全可單元測試、突變即紅。
 *
 * 【計費鐵則】本檔絕不參與任何「實際扣款」路徑。ESTIMATED_USD_PER_VIDEO /
 * CREDITS_PER_VIDEO 僅為**透明化估算常數**（給創作者「預估消耗」提示用），
 * 不改動 modelPricing 的真實計費，也不寫入任何餘額。真實 Fal.ai 逐次成本
 * 待 creator_usage_events 寫入點（follow-up）落帳後再取代此估算。
 */

/** Creator 配額方案層級（收斂自 AIDV-273 卡上 PLAN_QUOTAS）。 */
export const CREATOR_PLAN_TIERS = ["free", "starter", "pro", "unlimited"] as const;
export type CreatorPlanTier = (typeof CREATOR_PLAN_TIERS)[number];

export interface PlanQuota {
  /** 每月可生成影片數；unlimited 為 Infinity。 */
  videosPerMonth: number;
  /** 方案月費估算（USD）；unlimited 為 null（客製報價）。 */
  costEstimateUsd: number | null;
}

/**
 * 方案配額定義。數值沿用 AIDV-273 卡上收斂設計，作為前端透明度顯示基準。
 * （非計費真相源；真實計費仍由 subscription_plans.quotaAllocation / modelPricing 決定。）
 */
export const PLAN_QUOTAS: Record<CreatorPlanTier, PlanQuota> = {
  free: { videosPerMonth: 5, costEstimateUsd: 0 },
  starter: { videosPerMonth: 20, costEstimateUsd: 9.99 },
  pro: { videosPerMonth: 100, costEstimateUsd: 39.99 },
  unlimited: { videosPerMonth: Infinity, costEstimateUsd: null },
};

/** 預設超限預警門檻（%）。卡上設計為使用者可調（預設 80）；持久化為 follow-up。 */
export const DEFAULT_ALERT_THRESHOLD_PCT = 80;

/** 每部影片的透明化估算成本（USD）。非實際扣款；見檔頭計費鐵則。 */
export const ESTIMATED_USD_PER_VIDEO = 0.15;

/** 每部影片估算消耗的額度點數。 */
export const CREDITS_PER_VIDEO = 1;

/**
 * 把訂閱 planId（varchar，可能是 'free'/'starter'/'pro'/'enterprise' 或未知字串）
 * 正規化成配額層級。
 *   - enterprise / unlimited / ultra → unlimited（ultra 為既有 4K 守門錯誤訊息
 *     載明的付費方案詞彙，見 server/services/videoOutputSpec.ts）
 *   - premium → pro（同上，premium 為既有付費守門測試 fixture 使用的實際詞彙）
 *   - 明確 starter / pro → 對應層級
 *   - null / 空字串 / 'free' → free（fail-closed 到最小配額）
 *   - 其餘未知且非 free 的 planId（如 stripe price id）→ starter（有意識映射到
 *     最低付費層級：純顯示、不做強制；比顯示成 free 5 部/月＋不實超限預警安全）
 */
export function resolvePlanTier(planId: string | null | undefined): CreatorPlanTier {
  const p = (planId ?? "").trim().toLowerCase();
  if (p === "unlimited" || p === "enterprise" || p === "ultra") return "unlimited";
  if (p === "pro" || p === "premium") return "pro";
  if (p === "starter") return "starter";
  if (p === "" || p === "free") return "free";
  return "starter";
}

/**
 * 由完整訂閱列（planId + status）解析配額層級，鏡像既有付費守門語意
 * （server/services/videoOutputSpec.ts isPaidPlan / server/routes/videoRoute.ts
 * isPaidFor4K）：status 非 active/trialing（cancelled / past_due / null…）一律
 * 視為 free，避免與計費強制層漂移出第二套判定。
 *   - 查不到訂閱（null/undefined）→ free（fail-closed）
 */
export function resolveSubscriptionTier(
  sub: { planId: string; status: string | null } | null | undefined
): CreatorPlanTier {
  if (!sub) return "free";
  if (sub.status !== "active" && sub.status !== "trialing") return "free";
  return resolvePlanTier(sub.planId);
}

/** 指定時刻所在月份的 UTC 月初（含當日 00:00:00.000）。 */
export function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** 指定時刻的「下個月 1 號 UTC 00:00」＝配額重置時間。 */
export function firstDayOfNextMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

export interface QuotaStatusResult {
  tier: CreatorPlanTier;
  videosGenerated: number;
  /** 每月配額；unlimited 為 Infinity。 */
  quotaLimit: number;
  isUnlimited: boolean;
  /** 0–100，已用百分比（顯示用，封頂 100）；unlimited 恆為 0。 */
  quotaUsedPct: number;
  /** 剩餘可生成數；unlimited 為 Infinity。 */
  remaining: number;
  /** 是否已達或超過配額（unlimited 恆 false）。 */
  quotaExceeded: boolean;
  /** 本月已花費（USD，來自 usage ledger）。 */
  costUsdSoFar: number;
  /** 用完剩餘配額的估算成本（USD，透明化估算）；unlimited 為 0。 */
  costEstimateRemaining: number;
  alertThresholdPct: number;
  /** 已用百分比是否達到預警門檻（unlimited 恆 false）。 */
  alertActive: boolean;
  /** ISO 字串：下個月 1 號配額重置時間。 */
  quotaResetsAt: string;
}

/** 把值封在 [min, max] 區間。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 由方案層級 + 當月已生成數 + 已花費，推導完整配額狀態（純函式）。
 */
export function computeQuotaStatus(args: {
  tier: CreatorPlanTier;
  videosGenerated: number;
  costUsdSoFar: number;
  now?: Date;
  alertThresholdPct?: number;
}): QuotaStatusResult {
  const now = args.now ?? new Date();
  const alertThresholdPct = args.alertThresholdPct ?? DEFAULT_ALERT_THRESHOLD_PCT;
  const videosGenerated = Math.max(0, Math.floor(args.videosGenerated));
  const quotaLimit = PLAN_QUOTAS[args.tier].videosPerMonth;
  const isUnlimited = !Number.isFinite(quotaLimit);

  const quotaUsedPct = isUnlimited
    ? 0
    : clamp(Math.round((videosGenerated / quotaLimit) * 100), 0, 100);
  const remaining = isUnlimited ? Infinity : Math.max(0, quotaLimit - videosGenerated);
  const quotaExceeded = !isUnlimited && videosGenerated >= quotaLimit;
  const costEstimateRemaining = isUnlimited
    ? 0
    : Math.round(remaining * ESTIMATED_USD_PER_VIDEO * 100) / 100;
  const alertActive = !isUnlimited && quotaUsedPct >= alertThresholdPct;

  return {
    tier: args.tier,
    videosGenerated,
    quotaLimit,
    isUnlimited,
    quotaUsedPct,
    remaining,
    quotaExceeded,
    costUsdSoFar: Math.round(Math.max(0, args.costUsdSoFar) * 1_000_000) / 1_000_000,
    costEstimateRemaining,
    alertThresholdPct,
    alertActive,
    quotaResetsAt: firstDayOfNextMonthUtc(now).toISOString(),
  };
}

export interface CostEstimateResult {
  credits: number;
  costUsdEstimate: number;
}

/**
 * 預生成費用估算（透明化，非實際扣款）。目前為固定估算：1 點額度 / $0.15。
 * aspectRatio / outputSpec 先保留為輸入介面，供 follow-up 接 Fal.ai 逐規格報價
 * （AIDV-252 派發成本點）時分規格細化，屆時呼叫端不動。
 *
 * 【範圍註記】本函式目前為純函式先行、**不對外掛 tRPC 端點**：既有
 * generate.estimateCost（generationType:"video"，以 modelPricing 為源）已是
 * 唯一的預生成估價端點，避免兩套不一致的估價來源並存。「生成流程步驟 0
 * 顯示預估費用」的 UI 接線為 follow-up，屆時應接 generate.estimateCost。
 */
export function estimateGenerationCost(_args?: {
  aspectRatio?: string;
  outputSpec?: Record<string, unknown> | null;
}): CostEstimateResult {
  return {
    credits: CREDITS_PER_VIDEO,
    costUsdEstimate: ESTIMATED_USD_PER_VIDEO,
  };
}

export interface QuotaAfterResult {
  /** 生成後剩餘配額；unlimited 為 Infinity。 */
  remaining: number;
  /** 此次生成是否會超出配額（unlimited 恆 false）。 */
  willExceed: boolean;
}

/**
 * 在既有當月用量上，疊加一次 `credits` 消耗後的配額投影（純函式）。
 */
export function projectQuotaAfter(args: {
  tier: CreatorPlanTier;
  videosGenerated: number;
  credits: number;
}): QuotaAfterResult {
  const quotaLimit = PLAN_QUOTAS[args.tier].videosPerMonth;
  const isUnlimited = !Number.isFinite(quotaLimit);
  const projected = Math.max(0, Math.floor(args.videosGenerated)) + Math.max(0, args.credits);
  if (isUnlimited) {
    return { remaining: Infinity, willExceed: false };
  }
  return {
    remaining: Math.max(0, quotaLimit - projected),
    willExceed: projected > quotaLimit,
  };
}
