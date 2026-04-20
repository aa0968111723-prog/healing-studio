/**
 * apiUsage.ts — Admin API Usage & Cost Management tRPC Router
 * ──────────────────────────────────────────────────────────────────────────
 * Provides admin-only procedures for the /admin/api-usage dashboard:
 *   - overview         : KPI cards + daily cost chart data
 *   - usageByProvider  : Per-provider usage breakdown
 *   - usageEvents      : Paginated event log
 *   - rateLimits       : CRUD for rate limit rules
 *   - alerts           : CRUD for alert configurations
 *   - billing          : Aggregated billing for CSV export
 *   - snapshots        : Recent provider status snapshots
 */

import { z } from "zod";
import { eq, desc, sql, and, gte, lte } from "drizzle-orm";
import { router, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  aiUsageEvents,
  providerSnapshots,
  costAggregations,
  rateLimitRules,
  alertConfigs,
  AI_PROVIDERS,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

// ─── Shared Zod Schemas ──────────────────────────────────────────────────────

const providerEnum = z.enum(AI_PROVIDERS);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ─── Helper: ensure DB ───────────────────────────────────────────────────────

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB 不可用",
    });
  }
  return db;
}

// ─── Sub-routers ─────────────────────────────────────────────────────────────

const rateLimitRouter = router({
  list: adminProcedure.query(async () => {
    const db = await requireDb();
    return db
      .select()
      .from(rateLimitRules)
      .orderBy(desc(rateLimitRules.createdAt));
  }),

  upsert: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        ruleType: z.enum(["per_user", "per_api_key", "global"]),
        targetId: z.string().max(128).optional(),
        provider: z.string().max(32).optional(),
        dailyCallLimit: z.number().int().min(0).optional(),
        dailyCostLimitUsd: z.number().min(0).optional(),
        monthlyCostLimitUsd: z.number().min(0).optional(),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      if (input.id) {
        await db
          .update(rateLimitRules)
          .set({
            ruleType: input.ruleType,
            targetId: input.targetId ?? null,
            provider: input.provider ?? null,
            dailyCallLimit: input.dailyCallLimit ?? null,
            dailyCostLimitUsd: input.dailyCostLimitUsd?.toString() ?? null,
            monthlyCostLimitUsd: input.monthlyCostLimitUsd?.toString() ?? null,
            isActive: input.isActive,
          })
          .where(eq(rateLimitRules.id, input.id));
        return { id: input.id };
      }
      const [inserted] = await db.insert(rateLimitRules).values({
        ruleType: input.ruleType,
        targetId: input.targetId ?? null,
        provider: input.provider ?? null,
        dailyCallLimit: input.dailyCallLimit ?? null,
        dailyCostLimitUsd: input.dailyCostLimitUsd?.toString() ?? null,
        monthlyCostLimitUsd: input.monthlyCostLimitUsd?.toString() ?? null,
        isActive: input.isActive,
      });
      return { id: inserted.insertId };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.delete(rateLimitRules).where(eq(rateLimitRules.id, input.id));
      return { success: true };
    }),
});

const alertConfigRouter = router({
  list: adminProcedure.query(async () => {
    const db = await requireDb();
    return db
      .select()
      .from(alertConfigs)
      .orderBy(desc(alertConfigs.createdAt));
  }),

  upsert: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        alertType: z.enum(["budget", "quota", "anomaly"]),
        provider: z.string().max(32).optional(),
        thresholdPct: z.number().min(0).max(100).optional(),
        monthlyBudgetUsd: z.number().min(0).optional(),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      if (input.id) {
        await db
          .update(alertConfigs)
          .set({
            alertType: input.alertType,
            provider: input.provider ?? null,
            thresholdPct: input.thresholdPct?.toString() ?? null,
            monthlyBudgetUsd: input.monthlyBudgetUsd?.toString() ?? null,
            isActive: input.isActive,
          })
          .where(eq(alertConfigs.id, input.id));
        return { id: input.id };
      }
      const [inserted] = await db.insert(alertConfigs).values({
        alertType: input.alertType,
        provider: input.provider ?? null,
        thresholdPct: input.thresholdPct?.toString() ?? null,
        monthlyBudgetUsd: input.monthlyBudgetUsd?.toString() ?? null,
        isActive: input.isActive,
      });
      return { id: inserted.insertId };
    }),
});

// ─── Main Router ─────────────────────────────────────────────────────────────

export const apiUsageRouter = router({
  // ── Overview KPIs + chart data ────────────────────────────────────────────
  overview: adminProcedure.query(async () => {
    const db = await requireDb();

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yesterday24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Monthly call count & cost from cost_aggregations
    const [monthStats] = await db
      .select({
        totalCalls: sql<number>`COALESCE(SUM(${costAggregations.callCount}), 0)`,
        totalCost: sql<number>`COALESCE(SUM(${costAggregations.totalCostUsd}), 0)`,
      })
      .from(costAggregations)
      .where(gte(costAggregations.date, monthStart));

    // 24h error rate from usage events
    const [errorStats] = await db
      .select({
        totalEvents: sql<number>`COUNT(*)`,
        errorEvents: sql<number>`SUM(CASE WHEN ${aiUsageEvents.status} != 'success' THEN 1 ELSE 0 END)`,
      })
      .from(aiUsageEvents)
      .where(gte(aiUsageEvents.createdAt, yesterday24h));

    // Latest snapshot per provider for balances
    const latestSnapshots = await db
      .select()
      .from(providerSnapshots)
      .where(
        sql`(${providerSnapshots.provider}, ${providerSnapshots.snapshotAt}) IN (
          SELECT provider, MAX(snapshotAt) FROM ${providerSnapshots} GROUP BY provider
        )`
      );

    const totalBalance = latestSnapshots.reduce((sum, s) => {
      return sum + Number(s.balanceUsd ?? 0);
    }, 0);

    // Daily costs for chart (last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dailyCosts = await db
      .select({
        date: costAggregations.date,
        provider: costAggregations.provider,
        cost: sql<number>`SUM(${costAggregations.totalCostUsd})`,
      })
      .from(costAggregations)
      .where(gte(costAggregations.date, thirtyDaysAgo))
      .groupBy(costAggregations.date, costAggregations.provider)
      .orderBy(costAggregations.date);

    // Provider balance bars
    const providerBalances = latestSnapshots.map(s => ({
      provider: s.provider,
      tier: s.tier,
      quota: Number(s.quota ?? 0),
      remaining: Number(s.remaining ?? 0),
      balanceUsd: Number(s.balanceUsd ?? 0),
      pct: s.quota && Number(s.quota) > 0
        ? Math.round((Number(s.remaining ?? 0) / Number(s.quota)) * 100)
        : null,
    }));

    return {
      monthCalls: Number(monthStats?.totalCalls ?? 0),
      monthCost: Number(monthStats?.totalCost ?? 0),
      totalBalance: Math.round(totalBalance * 100) / 100,
      errorRate24h:
        errorStats && Number(errorStats.totalEvents) > 0
          ? Math.round(
              (Number(errorStats.errorEvents) / Number(errorStats.totalEvents)) * 10000
            ) / 100
          : 0,
      dailyCosts: dailyCosts.map(d => ({
        date: d.date,
        provider: d.provider,
        cost: Number(d.cost ?? 0),
      })),
      providerBalances,
    };
  }),

  // ── Usage by Provider ─────────────────────────────────────────────────────
  usageByProvider: adminProcedure
    .input(
      z.object({
        provider: providerEnum.optional(),
        startDate: dateStr.optional(),
        endDate: dateStr.optional(),
        endpoint: z.string().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = await requireDb();

      const providers: Array<(typeof AI_PROVIDERS)[number]> = input?.provider
        ? [input.provider]
        : [...AI_PROVIDERS];

      const result = await Promise.all(
        providers.map(async provider => {
          // Latest snapshot
          const [latestSnapshot] = await db
            .select()
            .from(providerSnapshots)
            .where(eq(providerSnapshots.provider, provider))
            .orderBy(desc(providerSnapshots.snapshotAt))
            .limit(1);

          // Recent daily costs
          const conditions = [eq(costAggregations.provider, provider)];
          if (input?.startDate) conditions.push(gte(costAggregations.date, new Date(input.startDate)));
          if (input?.endDate) conditions.push(lte(costAggregations.date, new Date(input.endDate)));
          if (input?.endpoint) conditions.push(eq(costAggregations.endpoint, input.endpoint));

          const recentCosts = await db
            .select({
              date: costAggregations.date,
              callCount: sql<number>`SUM(${costAggregations.callCount})`,
              totalCostUsd: sql<number>`SUM(${costAggregations.totalCostUsd})`,
            })
            .from(costAggregations)
            .where(and(...conditions))
            .groupBy(costAggregations.date)
            .orderBy(desc(costAggregations.date))
            .limit(30);

          return {
            provider,
            latestSnapshot: latestSnapshot ?? null,
            recentCosts: recentCosts.map(c => ({
              date: c.date,
              callCount: Number(c.callCount),
              totalCostUsd: Number(c.totalCostUsd),
            })),
          };
        })
      );

      return { providers: result };
    }),

  // ── Paginated Usage Events ────────────────────────────────────────────────
  usageEvents: adminProcedure
    .input(
      z.object({
        provider: providerEnum.optional(),
        status: z.enum(["success", "failed", "timeout", "rate_limited"]).optional(),
        startDate: dateStr.optional(),
        endDate: dateStr.optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [];
      if (input?.provider) conditions.push(eq(aiUsageEvents.provider, input.provider));
      if (input?.status) conditions.push(eq(aiUsageEvents.status, input.status));
      if (input?.startDate) conditions.push(gte(aiUsageEvents.createdAt, new Date(input.startDate)));
      if (input?.endDate) {
        const end = new Date(input.endDate);
        end.setDate(end.getDate() + 1);
        conditions.push(lte(aiUsageEvents.createdAt, end));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [countResult] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(aiUsageEvents)
        .where(whereClause);

      const events = await db
        .select()
        .from(aiUsageEvents)
        .where(whereClause)
        .orderBy(desc(aiUsageEvents.createdAt))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);

      return {
        events,
        total: Number(countResult?.total ?? 0),
      };
    }),

  // ── Rate Limit Rules ──────────────────────────────────────────────────────
  rateLimits: rateLimitRouter,

  // ── Alert Configs ─────────────────────────────────────────────────────────
  alerts: alertConfigRouter,

  // ── Billing (for CSV export) ──────────────────────────────────────────────
  billing: adminProcedure
    .input(
      z.object({
        startDate: dateStr.optional(),
        endDate: dateStr.optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions = [];
      if (input?.startDate) conditions.push(gte(costAggregations.date, new Date(input.startDate)));
      if (input?.endDate) conditions.push(lte(costAggregations.date, new Date(input.endDate)));

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select({
          provider: costAggregations.provider,
          endpoint: costAggregations.endpoint,
          date: costAggregations.date,
          callCount: costAggregations.callCount,
          totalUnits: costAggregations.totalUnits,
          totalCostUsd: costAggregations.totalCostUsd,
        })
        .from(costAggregations)
        .where(whereClause)
        .orderBy(desc(costAggregations.date), costAggregations.provider);

      return {
        rows: rows.map(r => ({
          provider: r.provider,
          endpoint: r.endpoint,
          date: r.date,
          callCount: r.callCount,
          totalUnits: Number(r.totalUnits),
          totalCostUsd: Number(r.totalCostUsd),
        })),
      };
    }),

  // ── Provider Snapshots ────────────────────────────────────────────────────
  snapshots: adminProcedure
    .input(
      z.object({
        provider: providerEnum,
        limit: z.number().int().min(1).max(100).default(24),
      })
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      return db
        .select()
        .from(providerSnapshots)
        .where(eq(providerSnapshots.provider, input.provider))
        .orderBy(desc(providerSnapshots.snapshotAt))
        .limit(input.limit);
    }),
});
