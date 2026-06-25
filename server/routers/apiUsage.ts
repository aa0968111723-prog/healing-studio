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
  costLedger,
  rateLimitRules,
  alertConfigs,
  AI_PROVIDERS,
} from "../../drizzle/schema";
import {
  summarizeAttribution,
  getTwdPerUsd,
  type LedgerRowForSummary,
} from "../services/cost/costAttribution";
import { TRPCError } from "@trpc/server";
import { serverEnv } from "../_core/env.validated";
import {
  summarizeByCategory,
  summarizeByEndpoint,
  summarizeByUser,
  summarizeByStatus,
  latencyStats,
  hourlyHeatmap,
  calculateWasteCost,
  projectMonthlyCost,
  compareCatalogVsActual,
  dailyEndpointTrends,
  perCallCostDistribution,
  detectRetryChains,
  summarizeByFeature,
  suggestSavings,
  reconcileWithProviderInvoices,
  type UsageEventLike,
  type ProviderInvoiceInfo,
} from "../services/costAnalytics";

// ─── Shared Zod Schemas ──────────────────────────────────────────────────────

const providerEnum = z.enum(AI_PROVIDERS);
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const PROVIDER_APPLY_GUIDE: Record<(typeof AI_PROVIDERS)[number], string> = {
  fal_ai: "https://fal.ai/dashboard/keys",
  gemini: "https://aistudio.google.com/apikey",
  elevenlabs: "https://elevenlabs.io/app/settings/api-keys",
  suno: "https://suno.com/",
};
const PROVIDER_ENV_MAP: Record<(typeof AI_PROVIDERS)[number], keyof typeof serverEnv> = {
  fal_ai: "FAL_API_KEY",
  gemini: "GEMINI_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
  suno: "SUNO_API_KEY",
};

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

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.delete(alertConfigs).where(eq(alertConfigs.id, input.id));
      return { success: true };
    }),
});

// ─── Main Router ─────────────────────────────────────────────────────────────

export const apiUsageRouter = router({
  providerReadiness: adminProcedure.query(async () => {
    return AI_PROVIDERS.map(provider => {
      const envVar = PROVIDER_ENV_MAP[provider];
      const value = serverEnv[envVar];
      const configured = typeof value === "string" && value.trim().length > 0;
      return {
        provider,
        envVar,
        configured,
        applyGuideUrl: PROVIDER_APPLY_GUIDE[provider],
      };
    });
  }),

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

  // ── Deep Cost Analytics（深度成本分析）─────────────────────────────────────
  // 為 admin 後台的「深度成本」面板提供進階拆解：
  //   • 模態（LLM / TTS / 圖片 / 影片 / 訓練 …）
  //   • Top-N 端點 / 使用者
  //   • 狀態（success / failed / timeout / rate_limited）
  //   • 延遲統計（p50 / p95 / p99）
  //   • 7×24 熱力圖
  //   • 浪費於失敗呼叫的金額
  //   • 月底成本投影（線性外推）
  //   • Catalog 預估 vs 實際扣費差異
  deepCost: adminProcedure
    .input(
      z
        .object({
          provider: providerEnum.optional(),
          startDate: dateStr.optional(),
          endDate: dateStr.optional(),
          topN: z.number().int().min(1).max(100).default(20),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      const now = new Date();

      // 預設視窗：當月迄今
      const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const start = input?.startDate ? new Date(input.startDate) : defaultStart;
      const end = input?.endDate ? new Date(input.endDate) : now;
      // 結束日含當天
      if (input?.endDate) end.setDate(end.getDate() + 1);

      const conditions = [
        gte(aiUsageEvents.createdAt, start),
        lte(aiUsageEvents.createdAt, end),
      ];
      if (input?.provider) conditions.push(eq(aiUsageEvents.provider, input.provider));

      const whereClause = and(...conditions);

      // 限制掃描量級：最多 50,000 筆事件，避免 admin dashboard 拖垮 DB
      const rows = await db
        .select({
          provider: aiUsageEvents.provider,
          endpoint: aiUsageEvents.endpoint,
          status: aiUsageEvents.status,
          costUsd: aiUsageEvents.costUsd,
          latencyMs: aiUsageEvents.latencyMs,
          userId: aiUsageEvents.userId,
          createdAt: aiUsageEvents.createdAt,
        })
        .from(aiUsageEvents)
        .where(whereClause)
        .orderBy(desc(aiUsageEvents.createdAt))
        .limit(50_000);

      const events: UsageEventLike[] = rows.map(r => ({
        provider: r.provider,
        endpoint: r.endpoint,
        status: r.status,
        costUsd: Number(r.costUsd ?? 0),
        latencyMs: r.latencyMs ?? null,
        userId: r.userId ?? null,
        createdAt: r.createdAt,
      }));

      // 月底投影：以「當月 cost_aggregations 的累積金額」做為 MTD
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const [mtdRow] = await db
        .select({
          totalCost: sql<number>`COALESCE(SUM(${costAggregations.totalCostUsd}), 0)`,
        })
        .from(costAggregations)
        .where(gte(costAggregations.date, monthStart));

      const totalCost = events.reduce((s, e) => s + (Number(e.costUsd) || 0), 0);

      // 帳單對帳：取每 provider 最新一次 snapshot 的 nextInvoice.amountUsd
      const latestSnapshots = await db
        .select()
        .from(providerSnapshots)
        .where(
          sql`(${providerSnapshots.provider}, ${providerSnapshots.snapshotAt}) IN (
            SELECT provider, MAX(snapshotAt) FROM ${providerSnapshots} GROUP BY provider
          )`
        );
      const invoices: ProviderInvoiceInfo[] = latestSnapshots.map(s => ({
        provider: s.provider,
        invoiceUsd:
          s.nextInvoice && typeof s.nextInvoice.amountUsd === "number"
            ? s.nextInvoice.amountUsd
            : null,
        snapshotAt: s.snapshotAt ?? null,
      }));
      const reconciliation = reconcileWithProviderInvoices(events, invoices);

      return {
        window: {
          start: start.toISOString(),
          end: end.toISOString(),
          eventCount: events.length,
          totalCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
          truncated: events.length >= 50_000,
        },
        // 真實成本單一真值（取「平台記錄」與「供應商帳單」的較高值）
        truth: {
          source: "ai_usage_events.costUsd + provider_snapshots.nextInvoice",
          totalUsd: reconciliation.truthTotalUsd,
        },
        reconciliation,
        byCategory: summarizeByCategory(events),
        byStatus: summarizeByStatus(events),
        topEndpoints: summarizeByEndpoint(events, input?.topN ?? 20),
        topUsers: summarizeByUser(events, input?.topN ?? 20),
        latency: latencyStats(events),
        heatmap: hourlyHeatmap(events),
        waste: calculateWasteCost(events),
        projection: projectMonthlyCost(Number(mtdRow?.totalCost ?? 0), now),
        catalogVsActual: compareCatalogVsActual(events).slice(0, input?.topN ?? 20),
        // ── Deep layers ──
        endpointTrends: dailyEndpointTrends(events, 10, 7, now),
        costDistribution: perCallCostDistribution(events, 1.5, 20),
        retryChains: detectRetryChains(events, 60, 30),
        byFeature: summarizeByFeature(events),
        savingsSuggestions: suggestSavings(events, 10, 30),
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

  // ── AIDV-14：成本歸屬彙總（唯讀，以 TWD）───────────────────────────────────
  // 依 project / member / workflow 維度彙總 cost_ledger 的 posted debit 真實成本，
  // 以 TWD 呈現（優先用列上凍結的 amountTwd，舊資料 fallback 現算）。dimension 不傳
  // ＝全部維度。純彙總邏輯在 summarizeAttribution（已單測）。
  costAttribution: adminProcedure
    .input(
      z
        .object({
          dimension: z.enum(["project", "member", "workflow"]).optional(),
          limit: z.number().int().min(1).max(500).default(100),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      const rate = getTwdPerUsd();
      // AIDV-14：取 posted 的 debit ＋ credit 兩種 entryType——summarizeAttribution 會把
      // 同維度 credit（退款沖銷）從 debit 扣除算「淨額」，避免有退款時前台高估成本（毛額）。
      // 對手科目 expense:ai-cost 的 credit 不是歸屬維度、會被 summarize 自動略過。
      const rows = (await db
        .select({
          accountKey: costLedger.accountKey,
          entryType: costLedger.entryType,
          amount: costLedger.amount,
          amountTwd: costLedger.amountTwd,
          provider: costLedger.provider,
          model: costLedger.model,
        })
        .from(costLedger)
        .where(eq(costLedger.status, "posted"))) as LedgerRowForSummary[];

      const summary = summarizeAttribution(rows, rate, input?.dimension);
      const limited = summary.slice(0, input?.limit ?? 100);
      return {
        rate,
        dimension: input?.dimension ?? "all",
        totalCostTwd: Number(
          limited.reduce((s, r) => s + r.costTwd, 0).toFixed(4)
        ),
        totalCostUsd: Number(
          limited.reduce((s, r) => s + r.costUsd, 0).toFixed(6)
        ),
        rows: limited,
      };
    }),
});
