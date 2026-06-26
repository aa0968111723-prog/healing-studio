import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";
import { computeDashboardInsights } from "../../shared/dashboard-insights";

// ─── User Dashboard ───────────────────────────────────────────────────────────

export const dashboardRouter = router({
  myStats: protectedProcedure.query(async ({ ctx }) => {
    const [costSummary, recentLogs, modalityBreakdown, dailyTrend] =
      await Promise.all([
        db.getUserCostSummary(ctx.user.id),
        db.getUsageLogsByUser(ctx.user.id, 10),
        db.getUserModalityBreakdown(ctx.user.id),
        db.getUserDailyTrend(ctx.user.id),
      ]);
    return {
      remainingGenerations: ctx.user.remainingGenerations,
      ...costSummary,
      recentLogs,
      modalityBreakdown: modalityBreakdown.map(r => ({
        requestType: r.requestType,
        count: r.count,
        totalCost: parseFloat(r.totalCost || "0"),
      })),
      dailyTrend: dailyTrend.map(r => ({
        date: r.date,
        count: r.count,
        totalCost: parseFloat(r.totalCost || "0"),
        totalTokens: r.totalTokens,
      })),
    };
  }),

  myUsageLogs: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ ctx, input }) => {
      return db.getUsageLogsByUser(ctx.user.id, input.limit);
    }),

  /**
   * Phase 4b — AI insights derived from the same usage data myStats returns.
   * Pure logic lives in shared/dashboard-insights.ts so it's identical when
   * surfaced in the UI card and when fed into the Orb assistant context.
   */
  insights: protectedProcedure.query(async ({ ctx }) => {
    const [costSummary, modalityBreakdown, providerBreakdown, dailyTrend] =
      await Promise.all([
        db.getUserCostSummary(ctx.user.id),
        db.getUserModalityBreakdown(ctx.user.id),
        db.getUserProviderBreakdown(ctx.user.id),
        db.getUserDailyTrend(ctx.user.id),
      ]);
    return computeDashboardInsights({
      remainingGenerations: ctx.user.remainingGenerations,
      totalRequests: costSummary.totalRequests,
      totalCost: costSummary.totalCost,
      modalityBreakdown: modalityBreakdown.map(r => ({
        requestType: r.requestType,
        count: r.count,
        totalCost: parseFloat(r.totalCost || "0"),
      })),
      providerBreakdown: providerBreakdown.map(r => ({
        apiProvider: r.apiProvider,
        count: r.count,
        totalCost: parseFloat(r.totalCost || "0"),
        successCount: r.successCount,
        failedCount: r.failedCount,
      })),
      dailyTrend: dailyTrend.map(r => ({
        date: r.date,
        count: r.count,
        totalCost: parseFloat(r.totalCost || "0"),
        totalTokens: r.totalTokens,
      })),
    });
  }),
});
