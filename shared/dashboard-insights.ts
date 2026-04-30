/**
 * dashboard-insights.ts — Phase 4b
 *
 * Pure functions that turn raw usage stats into actionable insights for the
 * Dashboard UI and the Orb assistant. No DB / no IO — easy to unit test and
 * safe to reuse from server (`dashboard.insights` endpoint) and from client
 * (PageAgent state) alike.
 */

export interface InsightsModalityRow {
  requestType: string;
  count: number;
  totalCost: number;
}

export interface InsightsDailyRow {
  date: string;
  count: number;
  totalCost: number;
  totalTokens?: number;
}

export interface DashboardInsightsInput {
  remainingGenerations: number;
  totalRequests: number;
  totalCost: number;
  modalityBreakdown: InsightsModalityRow[];
  dailyTrend: InsightsDailyRow[];
  /** ISO date (YYYY-MM-DD); defaults to today UTC. Injected for testability. */
  today?: string;
  /** Daily cost (USD) above which we emit a "high spend" warning. */
  dailyCostWarnUsd?: number;
  /** Remaining-credits threshold for the low-credit warning. */
  lowCreditsThreshold?: number;
}

export type RiskLevel = "ok" | "info" | "warn" | "high";

export interface CostTrend {
  /** USD spent today. */
  todayCost: number;
  /** Average daily USD over the trailing window (excluding today). */
  avgDailyCost: number;
  /** Day-over-day percentage change vs. previous day; null if no prior day. */
  dayOverDayPct: number | null;
  /** True when today's cost is materially above the trailing average. */
  anomaly: boolean;
}

export interface DashboardInsightsAnomaly {
  code:
    | "cost_spike"
    | "low_credits"
    | "daily_spend_high"
    | "single_modality_dominant";
  severity: RiskLevel;
  message: string;
}

export interface DashboardInsights {
  riskLevel: RiskLevel;
  costTrend: CostTrend;
  topModality: { requestType: string; count: number; share: number } | null;
  topProvider: null; // reserved for future — apiProvider not in modalityBreakdown
  anomalies: DashboardInsightsAnomaly[];
  recommendations: string[];
  /** Short Chinese summary suitable to ship to the Orb assistant context. */
  orbSummary: string;
}

const DEFAULT_DAILY_COST_WARN_USD = 1.0;
const DEFAULT_LOW_CREDITS_THRESHOLD = 5;
const SPIKE_FACTOR = 1.5;
const SPIKE_MIN_USD = 0.05;

function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function round(n: number, decimals = 4): number {
  const m = 10 ** decimals;
  return Math.round(n * m) / m;
}

export function computeDashboardInsights(
  input: DashboardInsightsInput
): DashboardInsights {
  const today = input.today ?? todayUtcIso();
  const warnDaily = input.dailyCostWarnUsd ?? DEFAULT_DAILY_COST_WARN_USD;
  const lowCredits = input.lowCreditsThreshold ?? DEFAULT_LOW_CREDITS_THRESHOLD;

  const todayRow = input.dailyTrend.find(r => r.date === today);
  const todayCost = todayRow?.totalCost ?? 0;

  const trailing = input.dailyTrend.filter(r => r.date !== today);
  const avgDailyCost =
    trailing.length > 0
      ? trailing.reduce((s, r) => s + r.totalCost, 0) / trailing.length
      : 0;

  const sortedTrail = [...trailing].sort((a, b) => a.date.localeCompare(b.date));
  const yesterdayCost = sortedTrail.at(-1)?.totalCost ?? null;
  const dayOverDayPct =
    yesterdayCost === null || yesterdayCost === 0
      ? null
      : round(((todayCost - yesterdayCost) / yesterdayCost) * 100, 1);

  const spikeBaseline = Math.max(avgDailyCost, SPIKE_MIN_USD);
  const anomaly = todayCost > spikeBaseline * SPIKE_FACTOR && todayCost >= SPIKE_MIN_USD;

  const totalModalityCount = input.modalityBreakdown.reduce(
    (s, r) => s + r.count,
    0
  );
  const topRow = [...input.modalityBreakdown].sort(
    (a, b) => b.count - a.count
  )[0];
  const topModality =
    topRow && topRow.count > 0
      ? {
          requestType: topRow.requestType,
          count: topRow.count,
          share:
            totalModalityCount > 0
              ? round(topRow.count / totalModalityCount, 3)
              : 0,
        }
      : null;

  const anomalies: DashboardInsightsAnomaly[] = [];
  const recommendations: string[] = [];

  if (anomaly) {
    anomalies.push({
      code: "cost_spike",
      severity: "warn",
      message:
        dayOverDayPct !== null
          ? `今日成本較昨日上升 ${dayOverDayPct}%（$${round(todayCost, 4)} vs $${round(
              yesterdayCost ?? 0,
              4
            )}）`
          : `今日成本 $${round(todayCost, 4)} 高於近期均值 $${round(avgDailyCost, 4)}`,
    });
    recommendations.push(
      "建議先用較經濟的模型（例如 Stable Diffusion / Wan）做試稿，再用旗艦模型完稿。"
    );
  }

  if (todayCost >= warnDaily) {
    anomalies.push({
      code: "daily_spend_high",
      severity: "warn",
      message: `今日已花費 $${round(todayCost, 4)}（>= $${round(warnDaily, 2)}）`,
    });
  }

  if (input.remainingGenerations <= lowCredits) {
    anomalies.push({
      code: "low_credits",
      severity: input.remainingGenerations <= 0 ? "high" : "warn",
      message: `剩餘積分僅 ${input.remainingGenerations} 點，建議盡快補充。`,
    });
    recommendations.push("到「積分帳戶」頁面儲值或檢查訂閱狀態。");
  }

  if (topModality && topModality.share >= 0.7 && totalModalityCount >= 5) {
    anomalies.push({
      code: "single_modality_dominant",
      severity: "info",
      message: `${topModality.requestType} 佔 ${(topModality.share * 100).toFixed(0)}% 的請求，可考慮多元化工作流。`,
    });
  }

  const severityRank: Record<RiskLevel, number> = {
    ok: 0,
    info: 1,
    warn: 2,
    high: 3,
  };
  const riskLevel: RiskLevel = anomalies.reduce<RiskLevel>(
    (acc, a) => (severityRank[a.severity] > severityRank[acc] ? a.severity : acc),
    "ok"
  );

  const orbSummaryParts: string[] = [];
  orbSummaryParts.push(
    `今日成本 $${round(todayCost, 4)}，近 ${trailing.length} 天均值 $${round(avgDailyCost, 4)}`
  );
  if (dayOverDayPct !== null) {
    orbSummaryParts.push(`日對比 ${dayOverDayPct >= 0 ? "+" : ""}${dayOverDayPct}%`);
  }
  if (topModality) {
    orbSummaryParts.push(
      `主要模態：${topModality.requestType}（${(topModality.share * 100).toFixed(0)}%）`
    );
  }
  orbSummaryParts.push(`剩餘積分：${input.remainingGenerations}`);
  if (anomalies.length > 0) {
    orbSummaryParts.push(`警示：${anomalies.map(a => a.code).join(",")}`);
  }
  const orbSummary = orbSummaryParts.join("；");

  return {
    riskLevel,
    costTrend: {
      todayCost: round(todayCost, 4),
      avgDailyCost: round(avgDailyCost, 4),
      dayOverDayPct,
      anomaly,
    },
    topModality,
    topProvider: null,
    anomalies,
    recommendations,
    orbSummary,
  };
}
