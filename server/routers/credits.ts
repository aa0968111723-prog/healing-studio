import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { getAllPricingByCategory } from "../services/modelPricing";
import { getUserTopModelRecent } from "../db";
import * as db from "../db";

export const creditsRouter = router({
  /** 取得所有模型的定價分類表（公開，無需登入） */
  pricingCatalog: publicProcedure.query(() => {
    const byCategory = getAllPricingByCategory();
    // Transform to serializable format
    const result: Record<
      string,
      Array<{
        modelId: string;
        label: string;
        provider: string;
        tier: string;
        basePoints: number;
        unit: string;
        minPoints: number;
        maxPoints: number;
        pointsPerSecond?: number;
        pointsPer1kChars?: number;
        pointsPerImage?: number;
        pointsPerStep?: number;
      }>
    > = {};
    for (const [cat, models] of Object.entries(byCategory)) {
      result[cat] = models.map(m => ({
        modelId: m.modelId,
        label: m.label,
        provider: m.provider,
        tier: m.tier,
        basePoints: m.basePoints,
        unit: m.unit,
        minPoints: m.minPoints,
        maxPoints: m.maxPoints,
        pointsPerSecond: m.pointsPerSecond,
        pointsPer1kChars: m.pointsPer1kChars,
        pointsPerImage: m.pointsPerImage,
        pointsPerStep: m.pointsPerStep,
      }));
    }
    return result;
  }),

  /** 取得使用者目前積分餘額（需登入）+ 近 30 天用量摘要，給「財財」精靈
   *  的低餘額提醒 / monthly_spend_threshold 真實 usedPct 計算用。
   *
   *  usedPct 算法：spent / (spent + remaining) — 不需要平台「monthly allowance」
   *  欄位，就能算出「在你目前的支出與餘額之間，花掉多少」的相對比例。新使用者
   *  spent=0 → usedPct=0；老使用者花完所有點數 → usedPct=100。 */
  myBalance: protectedProcedure.query(async ({ ctx }) => {
    let topModel: string | null = null;
    let totalSpentPoints = 0;
    try {
      const top = await getUserTopModelRecent(ctx.user.id, { days: 30 });
      if (top?.model) topModel = top.model;
    } catch {
      // DB 不可用或表為空 — 落在 null，前端會給「最近的高耗模型」備援文案。
    }
    try {
      const summary = await db.getUserCostSummary(ctx.user.id);
      // 1 USD ≈ 100 pts（與 modelPricing 的換算基準一致）。
      totalSpentPoints = Math.round((Number(summary.totalCost) || 0) * 100);
    } catch {
      // 落在 0 — 前端會把 usedPct 算成 0%，避免 publish 假警示。
    }
    const remaining = ctx.user.remainingGenerations ?? 0;
    const denominator = totalSpentPoints + remaining;
    const usedPct = denominator > 0
      ? Math.min(100, Math.round((totalSpentPoints / denominator) * 100))
      : 0;
    return {
      remaining,
      topModel,
      totalSpentPoints,
      usedPct,
    };
  }),
});
