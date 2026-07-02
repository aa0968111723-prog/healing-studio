/**
 * creatorDashboard.ts — AIDV-277 Creator 可見性智能層（唯讀端點）
 *
 * 收斂 AIDV-273（配額透明度）的後端讀取層。唯讀端點：
 *   quotaStatus — 當月用量 / 配額百分比 / 已花費 / 重置時間 / 80% 預警旗標
 *
 * 【預生成估價】不在本 router 另開 estimateCost：既有 generate.estimateCost
 * （generationType:"video"，以 modelPricing 為源）已是唯一的預生成估價端點，
 * 「生成流程步驟 0 顯示預估費用」的 UI 接線為 follow-up（接 generate.estimateCost），
 * 避免兩套不一致的估價端點並存。
 *
 * 純計算全部在 server/lib/quotaConfig.ts（可單元測試、突變即紅）；本檔只負責
 * 「讀 DB → 餵純函式 → 回形狀」。擁有權一律以 ctx.user.id 為界（鏡像
 * videoAnalyticsRouter），無跨用戶洩漏。
 *
 * 【資料來源說明 / 誠實範圍】
 *   - videosGenerated：以 video_projects 當月建立數為真實計量（立即有真資料）。
 *   - costUsdSoFar：讀 creator_usage_events 當月 cost_usd 加總（本卡建表 + 唯讀；
 *     「生成成功後寫入一筆」的寫入點為 follow-up，故落地初期為 0）。
 *   - 不碰任何實際扣款（見 quotaConfig 檔頭計費鐵則）。
 */

import { router, protectedProcedure } from "../_core/trpc";
import { and, eq, gte, count, sum } from "drizzle-orm";
import { getDb, getUserSubscription } from "../db";
import { creatorUsageEvents, videoProjects } from "../../drizzle/schema";
import {
  resolveSubscriptionTier,
  computeQuotaStatus,
  startOfMonthUtc,
  type CreatorPlanTier,
} from "../lib/quotaConfig";

/** 讀當月（UTC 月初起）該使用者建立的影片專案數＝當月已生成計量。 */
async function countVideosThisMonth(userId: number, monthStart: Date): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ total: count() })
    .from(videoProjects)
    .where(and(eq(videoProjects.userId, userId), gte(videoProjects.createdAt, monthStart)));
  return Number(row?.total ?? 0);
}

/** 讀當月 creator_usage_events 的 cost_usd 加總（無寫入點時為 0）。 */
async function sumCostThisMonth(userId: number, monthStart: Date): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ total: sum(creatorUsageEvents.costUsd) })
    .from(creatorUsageEvents)
    .where(
      and(
        eq(creatorUsageEvents.userId, userId),
        gte(creatorUsageEvents.createdAt, monthStart),
        eq(creatorUsageEvents.eventType, "video_generated")
      )
    );
  return Number(row?.total ?? 0);
}

/**
 * 解析使用者的配額層級。鏡像既有付費守門語意（videoOutputSpec.isPaidPlan）：
 * 查不到訂閱或 status 非 active/trialing（cancelled / past_due…）→ free。
 */
async function resolveTierForUser(userId: number): Promise<CreatorPlanTier> {
  const sub = await getUserSubscription(userId);
  return resolveSubscriptionTier(sub);
}

export const creatorDashboardRouter = router({
  /**
   * 當月配額狀態（唯讀）。回傳配額百分比、剩餘、已花費、重置時間與 80% 預警旗標。
   */
  quotaStatus: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const monthStart = startOfMonthUtc(now);
    const [tier, videosGenerated, costUsdSoFar] = await Promise.all([
      resolveTierForUser(ctx.user.id),
      countVideosThisMonth(ctx.user.id, monthStart),
      sumCostThisMonth(ctx.user.id, monthStart),
    ]);

    const status = computeQuotaStatus({ tier, videosGenerated, costUsdSoFar, now });

    return {
      plan: tier,
      currentMonth: {
        videosGenerated: status.videosGenerated,
        // Infinity 不可序列化為 JSON；unlimited 時回 null 讓前端顯示「∞」。
        quotaLimit: status.isUnlimited ? null : status.quotaLimit,
        isUnlimited: status.isUnlimited,
        quotaUsedPct: status.quotaUsedPct,
        remaining: status.isUnlimited ? null : status.remaining,
        quotaExceeded: status.quotaExceeded,
        costUsdSoFar: status.costUsdSoFar,
        costEstimateRemaining: status.costEstimateRemaining,
      },
      alertThresholdPct: status.alertThresholdPct,
      alertActive: status.alertActive,
      quotaResetsAt: status.quotaResetsAt,
    };
  }),
});
