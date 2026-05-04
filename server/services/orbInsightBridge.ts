/**
 * server/services/orbInsightBridge.ts
 *
 * 數據洞察橋接服務 — 讓光球代理在任何頁面都能查詢數據洞察。
 *
 * 解決的核心問題：
 *   dashboard.insights 和 dashboard.myStats 只在使用者位於 /dashboard 頁面時
 *   才透過 pageAgent state 暴露給光球。本服務讓光球在任何頁面都能主動查詢。
 *
 * 支援的查詢：
 *   1. getUsageStats — 取得使用統計摘要
 *   2. getAIInsights — 取得 AI 洞察分析（成本趨勢、異常偵測、建議）
 *   3. getCostBreakdown — 取得成本分布明細
 *   4. getDailyTrend — 取得每日趨勢數據
 *   5. getInsightsSummaryForOrb — 取得光球可讀的洞察摘要文字
 */

import {
  computeDashboardInsights,
  type DashboardInsights,
} from "../../shared/dashboard-insights";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UsageStats {
  remainingGenerations: number;
  totalRequests: number;
  totalCost: number;
  todayRequests: number;
  todayCost: number;
  modalityBreakdown: Array<{
    requestType: string;
    count: number;
    totalCost: number;
  }>;
}

export interface CostBreakdown {
  byModality: Array<{
    requestType: string;
    count: number;
    totalCost: number;
    share: number;
  }>;
  byProvider: Array<{
    apiProvider: string;
    count: number;
    totalCost: number;
    share: number;
    successRate: number | null;
  }>;
  totalCost: number;
}

export interface DailyTrendPoint {
  date: string;
  count: number;
  totalCost: number;
  totalTokens?: number;
}

export interface InsightQueryOptions {
  userId: number;
  remainingGenerations: number;
  /** 取得每日趨勢的天數上限 */
  trendDays?: number;
}

// ─── Implementation ─────────────────────────────────────────────────────────

/**
 * 取得使用統計摘要。
 */
export async function getUsageStats(
  opts: InsightQueryOptions
): Promise<UsageStats> {
  try {
    const db = await import("../db");
    const [costSummary, modalityBreakdown, dailyTrend] = await Promise.all([
      db.getUserCostSummary(opts.userId),
      db.getUserModalityBreakdown(opts.userId),
      db.getUserDailyTrend(opts.userId),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const todayRow = dailyTrend.find(
      (r: Record<string, unknown>) => r.date === today
    );

    return {
      remainingGenerations: opts.remainingGenerations,
      totalRequests: (costSummary as Record<string, unknown>).totalRequests
        ? Number((costSummary as Record<string, unknown>).totalRequests)
        : 0,
      totalCost: (costSummary as Record<string, unknown>).totalCost
        ? Number((costSummary as Record<string, unknown>).totalCost)
        : 0,
      todayRequests: todayRow
        ? Number((todayRow as Record<string, unknown>).count ?? 0)
        : 0,
      todayCost: todayRow
        ? parseFloat(
            String((todayRow as Record<string, unknown>).totalCost ?? "0")
          )
        : 0,
      modalityBreakdown: modalityBreakdown.map(
        (r: Record<string, unknown>) => ({
          requestType: String(r.requestType ?? ""),
          count: Number(r.count ?? 0),
          totalCost: parseFloat(String(r.totalCost ?? "0")),
        })
      ),
    };
  } catch (err) {
    console.error("[orbInsightBridge] getUsageStats failed:", err);
    return {
      remainingGenerations: opts.remainingGenerations,
      totalRequests: 0,
      totalCost: 0,
      todayRequests: 0,
      todayCost: 0,
      modalityBreakdown: [],
    };
  }
}

/**
 * 取得 AI 洞察分析。
 * 重用 shared/dashboard-insights.ts 的 computeDashboardInsights 函數。
 */
export async function getAIInsights(
  opts: InsightQueryOptions
): Promise<DashboardInsights> {
  try {
    const db = await import("../db");
    const [costSummary, modalityBreakdown, providerBreakdown, dailyTrend] =
      await Promise.all([
        db.getUserCostSummary(opts.userId),
        db.getUserModalityBreakdown(opts.userId),
        db.getUserProviderBreakdown(opts.userId),
        db.getUserDailyTrend(opts.userId),
      ]);

    return computeDashboardInsights({
      remainingGenerations: opts.remainingGenerations,
      totalRequests: Number(
        (costSummary as Record<string, unknown>).totalRequests ?? 0
      ),
      totalCost: Number(
        (costSummary as Record<string, unknown>).totalCost ?? 0
      ),
      modalityBreakdown: modalityBreakdown.map(
        (r: Record<string, unknown>) => ({
          requestType: String(r.requestType ?? ""),
          count: Number(r.count ?? 0),
          totalCost: parseFloat(String(r.totalCost ?? "0")),
        })
      ),
      providerBreakdown: providerBreakdown.map(
        (r: Record<string, unknown>) => ({
          apiProvider: String(r.apiProvider ?? ""),
          count: Number(r.count ?? 0),
          totalCost: parseFloat(String(r.totalCost ?? "0")),
          successCount: Number(r.successCount ?? 0),
          failedCount: Number(r.failedCount ?? 0),
        })
      ),
      dailyTrend: dailyTrend.map((r: Record<string, unknown>) => ({
        date: String(r.date ?? ""),
        count: Number(r.count ?? 0),
        totalCost: parseFloat(String(r.totalCost ?? "0")),
        totalTokens: r.totalTokens ? Number(r.totalTokens) : undefined,
      })),
    });
  } catch (err) {
    console.error("[orbInsightBridge] getAIInsights failed:", err);
    return computeDashboardInsights({
      remainingGenerations: opts.remainingGenerations,
      totalRequests: 0,
      totalCost: 0,
      modalityBreakdown: [],
      dailyTrend: [],
    });
  }
}

/**
 * 取得成本分布明細。
 */
export async function getCostBreakdown(
  opts: InsightQueryOptions
): Promise<CostBreakdown> {
  try {
    const db = await import("../db");
    const [modalityBreakdown, providerBreakdown] = await Promise.all([
      db.getUserModalityBreakdown(opts.userId),
      db.getUserProviderBreakdown(opts.userId),
    ]);

    const totalModalityCost = modalityBreakdown.reduce(
      (s: number, r: Record<string, unknown>) =>
        s + parseFloat(String(r.totalCost ?? "0")),
      0
    );
    const totalProviderCost = providerBreakdown.reduce(
      (s: number, r: Record<string, unknown>) =>
        s + parseFloat(String(r.totalCost ?? "0")),
      0
    );
    const totalCost = Math.max(totalModalityCost, totalProviderCost);

    return {
      byModality: modalityBreakdown.map((r: Record<string, unknown>) => {
        const cost = parseFloat(String(r.totalCost ?? "0"));
        return {
          requestType: String(r.requestType ?? ""),
          count: Number(r.count ?? 0),
          totalCost: cost,
          share: totalModalityCost > 0 ? cost / totalModalityCost : 0,
        };
      }),
      byProvider: providerBreakdown.map((r: Record<string, unknown>) => {
        const cost = parseFloat(String(r.totalCost ?? "0"));
        const attempts =
          Number(r.successCount ?? 0) + Number(r.failedCount ?? 0);
        return {
          apiProvider: String(r.apiProvider ?? ""),
          count: Number(r.count ?? 0),
          totalCost: cost,
          share: totalProviderCost > 0 ? cost / totalProviderCost : 0,
          successRate:
            attempts > 0 ? Number(r.successCount ?? 0) / attempts : null,
        };
      }),
      totalCost,
    };
  } catch (err) {
    console.error("[orbInsightBridge] getCostBreakdown failed:", err);
    return { byModality: [], byProvider: [], totalCost: 0 };
  }
}

/**
 * 取得每日趨勢數據。
 */
export async function getDailyTrend(
  opts: InsightQueryOptions
): Promise<DailyTrendPoint[]> {
  const maxDays = opts.trendDays ?? 30;
  try {
    const db = await import("../db");
    const dailyTrend = await db.getUserDailyTrend(opts.userId);

    return dailyTrend
      .slice(-maxDays)
      .map((r: Record<string, unknown>) => ({
        date: String(r.date ?? ""),
        count: Number(r.count ?? 0),
        totalCost: parseFloat(String(r.totalCost ?? "0")),
        totalTokens: r.totalTokens ? Number(r.totalTokens) : undefined,
      }));
  } catch (err) {
    console.error("[orbInsightBridge] getDailyTrend failed:", err);
    return [];
  }
}

/**
 * 取得光球可讀的洞察摘要文字。
 * 用於注入到系統提示詞中，讓光球了解使用者的使用概況。
 */
export async function getInsightsSummaryForOrb(
  opts: InsightQueryOptions
): Promise<string> {
  try {
    const insights = await getAIInsights(opts);
    const stats = await getUsageStats(opts);

    const lines: string[] = [];
    lines.push("【使用者數據洞察概況】");
    lines.push(
      `剩餘積分：${stats.remainingGenerations} 點 | 總請求：${stats.totalRequests} 次 | 總成本：$${stats.totalCost.toFixed(4)}`
    );
    lines.push(
      `今日請求：${stats.todayRequests} 次 | 今日成本：$${stats.todayCost.toFixed(4)}`
    );

    if (insights.orbSummary) {
      lines.push(`AI 摘要：${insights.orbSummary}`);
    }

    if (insights.anomalies.length > 0) {
      lines.push(
        `警示（${insights.riskLevel}）：${insights.anomalies.map((a) => a.message).join("；")}`
      );
    }

    if (insights.recommendations.length > 0) {
      lines.push(`建議：${insights.recommendations.join("；")}`);
    }

    if (stats.modalityBreakdown.length > 0) {
      const top3 = [...stats.modalityBreakdown]
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      lines.push(
        `主要模態：${top3.map((m) => `${m.requestType}(${m.count}次)`).join("、")}`
      );
    }

    return lines.join("\n");
  } catch (err) {
    console.error("[orbInsightBridge] getInsightsSummaryForOrb failed:", err);
    return "【使用者數據洞察概況】查詢失敗，請稍後再試。";
  }
}
