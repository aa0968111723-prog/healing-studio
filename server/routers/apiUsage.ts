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
import { router, adminProcedure, protectedProcedure } from "../_core/trpc";
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
import { getTwdPerUsd } from "../services/cost/costAttribution";
import { TRPCError } from "@trpc/server";
import { serverEnv } from "../_core/env.validated";
import { isEngineAvailable } from "../_core/llmRouter";
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
    const mediaProviders = AI_PROVIDERS.map(provider => {
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
    const textLlmProviders = [
      {
        provider: "openrouter",
        envVar: "OPENROUTER_API_KEY",
        configured: typeof serverEnv.OPENROUTER_API_KEY === "string" && serverEnv.OPENROUTER_API_KEY.trim().length > 0,
        applyGuideUrl: "https://openrouter.ai/keys",
      },
      {
        provider: "anthropic",
        envVar: "ANTHROPIC_API_KEY",
        configured: typeof serverEnv.ANTHROPIC_API_KEY === "string" && serverEnv.ANTHROPIC_API_KEY.trim().length > 0,
        applyGuideUrl: "https://console.anthropic.com/",
      },
    ];
    return { mediaProviders, textLlmProviders };
  }),

  /** 給一般創作者（非 admin）查文字 LLM 是否在線的輕量端點。
   *  AIDV-204: 同時考慮斷路器狀態（circuit breaker）才能反映真實健康度。
   *  openrouter 斷路 → degraded；兩者都斷或都未設定 → offline。
   */
  textLlmStatus: protectedProcedure.query(() => {
    const orConfigured = typeof serverEnv.OPENROUTER_API_KEY === "string" && serverEnv.OPENROUTER_API_KEY.trim().length > 0;
    const anConfigured = typeof serverEnv.ANTHROPIC_API_KEY === "string" && serverEnv.ANTHROPIC_API_KEY.trim().length > 0;
    // Circuit-breaker-aware: key configured AND engine not in OPEN circuit state
    const orHealthy = orConfigured && isEngineAvailable("openrouter");
    const anHealthy = anConfigured && isEngineAvailable("anthropic");
    const status: "online" | "degraded" | "offline" =
      orHealthy ? "online"
      : anHealthy ? "degraded"
      : "offline";
    return { status, openrouter: orConfigured, anthropic: anConfigured };
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

      // 1 query: latest snapshot per provider (subquery pattern, same as `overview`)
      const snapshots = await db
        .select()
        .from(providerSnapshots)
        .where(
          sql`(${providerSnapshots.provider}, ${providerSnapshots.snapshotAt}) IN (
            SELECT provider, MAX(snapshot_at) FROM ${providerSnapshots} GROUP BY provider
          )`
        );
      const snapshotMap = new Map(snapshots.map(s => [s.provider, s]));

      // 2 query: all daily costs in one pass, GROUP BY provider+date, slice per provider in JS
      const costConditions: ReturnType<typeof eq>[] = [];
      if (input?.provider) costConditions.push(eq(costAggregations.provider, input.provider));
      if (input?.startDate) costConditions.push(gte(costAggregations.date, new Date(input.startDate)));
      if (input?.endDate) costConditions.push(lte(costAggregations.date, new Date(input.endDate)));
      if (input?.endpoint) costConditions.push(eq(costAggregations.endpoint, input.endpoint));

      const allCosts = await db
        .select({
          provider: costAggregations.provider,
          date: costAggregations.date,
          callCount: sql<number>`SUM(${costAggregations.callCount})`,
          totalCostUsd: sql<number>`SUM(${costAggregations.totalCostUsd})`,
        })
        .from(costAggregations)
        .where(costConditions.length > 0 ? and(...costConditions) : undefined)
        .groupBy(costAggregations.provider, costAggregations.date)
        .orderBy(costAggregations.provider, desc(costAggregations.date));

      const costMap = new Map<string, typeof allCosts>();
      for (const row of allCosts) {
        const list = costMap.get(row.provider) ?? [];
        list.push(row);
        costMap.set(row.provider, list);
      }

      const result = providers.map(provider => ({
        provider,
        latestSnapshot: snapshotMap.get(provider) ?? null,
        recentCosts: (costMap.get(provider) ?? []).slice(0, 30).map(c => ({
          date: c.date,
          callCount: Number(c.callCount),
          totalCostUsd: Number(c.totalCostUsd),
        })),
      }));

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

      // AIDV-191：真實視窗總成本用獨立 SUM 聚合（同 WHERE、不受 50k 取樣截斷）
      const [aggRow] = await db
        .select({
          totalCostUsd: sql<number>`COALESCE(SUM(${aiUsageEvents.costUsd}), 0)`,
        })
        .from(aiUsageEvents)
        .where(whereClause);
      const trueTotalCostUsd = Number(aggRow?.totalCostUsd ?? 0);

      // 月底投影：以「當月 cost_aggregations 的累積金額」做為 MTD
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const [mtdRow] = await db
        .select({
          totalCost: sql<number>`COALESCE(SUM(${costAggregations.totalCostUsd}), 0)`,
        })
        .from(costAggregations)
        .where(gte(costAggregations.date, monthStart));

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
          totalCostUsd: Math.round(trueTotalCostUsd * 1_000_000) / 1_000_000,
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
  // ＝全部維度。AIDV-191：改 SQL GROUP BY 推聚合＋加 startDate/endDate 窗（預設當月）。
  costAttribution: adminProcedure
    .input(
      z
        .object({
          dimension: z.enum(["project", "member", "workflow"]).optional(),
          limit: z.number().int().min(1).max(500).default(100),
          startDate: dateStr.optional(),
          endDate: dateStr.optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await requireDb();
      const rate = getTwdPerUsd();
      const now = new Date();

      // 預設視窗：當月迄今（比照 deepCost）
      const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const start = input?.startDate ? new Date(input.startDate) : defaultStart;
      const end = input?.endDate ? new Date(input.endDate) : now;
      if (input?.endDate) end.setDate(end.getDate() + 1);

      const conditions = [
        eq(costLedger.status, "posted"),
        gte(costLedger.createdAt, start),
        lte(costLedger.createdAt, end),
      ];

      // AIDV-191：GROUP BY accountKey — debit 加、credit（退款沖銷）減 → 淨額。
      // 只回聚合列，不拉整段帳本進 Node；對手科目 expense:ai-cost 在 JS 端過濾掉。
      // amountTwd 優先用列上凍結值；null（舊資料）fallback 用 amount × rate 現算。
      const groupRows = await db
        .select({
          accountKey: costLedger.accountKey,
          netUsd: sql<string>`SUM(CASE WHEN ${costLedger.entryType} = 'debit' THEN ${costLedger.amount} ELSE -${costLedger.amount} END)`,
          netTwd: sql<string>`SUM(CASE WHEN ${costLedger.entryType} = 'debit' THEN COALESCE(${costLedger.amountTwd}, ${costLedger.amount} * ${rate}) ELSE -COALESCE(${costLedger.amountTwd}, ${costLedger.amount} * ${rate}) END)`,
          entries: sql<number>`SUM(CASE WHEN ${costLedger.entryType} = 'debit' THEN 1 ELSE 0 END)`,
        })
        .from(costLedger)
        .where(and(...conditions))
        .groupBy(costLedger.accountKey);

      const summary = groupRows
        .map(r => {
          const sep = r.accountKey.indexOf(":");
          if (sep < 0) return null;
          const type = r.accountKey.slice(0, sep);
          const id = r.accountKey.slice(sep + 1);
          if (type !== "project" && type !== "member" && type !== "workflow") return null;
          if (input?.dimension && type !== input.dimension) return null;
          const costUsd = Math.max(0, Number(r.netUsd ?? 0));
          const costTwd = Math.max(0, Number(r.netTwd ?? 0));
          const entries = Number(r.entries ?? 0);
          if (entries === 0 && costUsd === 0 && costTwd === 0) return null;
          return {
            type,
            id,
            costUsd: Number(costUsd.toFixed(6)),
            costTwd: Number(costTwd.toFixed(4)),
            entries,
          };
        })
        .filter(
          (r): r is { type: string; id: string; costUsd: number; costTwd: number; entries: number } =>
            r !== null
        )
        .sort((a, b) => b.costTwd - a.costTwd);

      const limited = summary.slice(0, input?.limit ?? 100);
      return {
        rate,
        dimension: input?.dimension ?? "all",
        window: { start: start.toISOString(), end: end.toISOString() },
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
