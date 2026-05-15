/**
 * server/services/spiritTools/accountantTools.ts
 *
 * 財財 (accountant) 的真實工具集 — 把「主動全站成本控制」精算師從
 * 「system prompt 嘴砲粗估」升級成「會呼叫實際 modelPricing / apiUsageLogs
 * 的 AI agent」。
 *
 * 之前的問題：
 *   - shared/agent-skills.ts:179 寫 `tools: []` → 財財沒有任何工具
 *   - system prompt 寫的點數範圍是手動維護的字面數字（會跟 modelPricing 漂移）
 *   - 「本月用到哪」「下一筆會花多少」「有沒有更省的做法」三件事
 *     都要靠 LLM 自己編，不會去查 server 端 catalog
 *
 * 本檔提供四個工具，全部走純函式（不寫 DB），只讀：
 *   - estimateCost(modelId, params)       — 精算單次任務點數
 *   - compareModels(category, durationSec) — 列出同類別 N 個替代品（依點數遞增）
 *   - getMonthlyUsage(userId)              — 近 30 天用量摘要（總點數 / 模態 / Top 模型）
 *   - suggestSavings(modelId, params)      — 對單一模型給可替換的省法 + 預估省多少
 */

import { logger } from "../../_core/logger";
import {
  MODEL_PRICING_CATALOG,
  estimatePoints,
  getModelPricing,
  type ModelPricing,
  type ModelCategory,
} from "../modelPricing";
import {
  getUserAccountInfo,
  getUserCostSummary,
  getUserDailyTrendRange,
  getUserModalityBreakdown,
  getUserTopModelRecent,
} from "../../db";

/** USD → 點數的轉換倍率。模型 catalog 的 baseCostUsd / estimatedCostUsd 一律
 *  以美元計，使用者看到的卻是點數（pts）。1 USD ≈ 100 pts 是站內公定匯率。
 *  這裡集中常數，未來要調倍率只改一處。 */
const POINTS_PER_USD = 100;

// ─── 估算單次任務點數 ────────────────────────────────────────────────────────

export interface EstimateCostInput {
  modelId: string;
  durationSec?: number;
  charCount?: number;
  imageCount?: number;
  trainingSteps?: number;
}

export interface EstimateCostResult {
  modelId: string;
  /** 該模型的 label / provider / category（找不到 catalog 條目時為 null） */
  label: string | null;
  provider: string | null;
  category: ModelCategory | null;
  /** 估算總點數（已套 minPoints / maxPoints clamp） */
  totalPoints: number;
  basePoints: number;
  /** 中文逐項說明 */
  breakdown: string;
  /** 找不到 modelId 時為 true — 表示走「未知模型 5 pts」備援 */
  isUnknownModel: boolean;
}

/**
 * 精算單次呼叫的點數。直接走 modelPricing.estimatePoints，
 * 但額外帶回 label / provider / category 讓 LLM 可以同時講「Kling 2.1 Pro」
 * 而不是只給一串 modelId。
 */
export function estimateCost(input: EstimateCostInput): EstimateCostResult {
  const pricing = getModelPricing(input.modelId);
  const est = estimatePoints(input.modelId, {
    durationSec: input.durationSec,
    charCount: input.charCount,
    imageCount: input.imageCount,
    trainingSteps: input.trainingSteps,
  });
  return {
    modelId: input.modelId,
    label: pricing?.label ?? null,
    provider: pricing?.provider ?? null,
    category: pricing?.category ?? null,
    totalPoints: est.totalPoints,
    basePoints: est.basePoints,
    breakdown: est.breakdown,
    isUnknownModel: !pricing,
  };
}

// ─── 同類別模型比較 ────────────────────────────────────────────────────────

export interface CompareModelsInput {
  /** ModelCategory（"text-to-image" / "image-to-video" / "text-to-speech" …） */
  category: ModelCategory;
  /** 估算用：影片 / 音檔長度（秒） */
  durationSec?: number;
  /** 估算用：TTS / LLM 字符數 */
  charCount?: number;
  /** 估算用：圖片張數 */
  imageCount?: number;
  /** 回傳幾筆（預設 5，最多 10） */
  limit?: number;
}

export interface CompareModelsRow {
  modelId: string;
  label: string;
  provider: string;
  tier: string;
  totalPoints: number;
  breakdown: string;
  /** 對 cheapest 而言這欄是 0；其他每筆是「比最便宜貴幾點」 */
  premiumOverCheapest: number;
  /** 對 cheapest 而言這欄是 100；其他每筆是「百分比成本（>100 表示比最便宜貴）」 */
  pctOfCheapest: number;
}

export interface CompareModelsResult {
  category: ModelCategory;
  count: number;
  cheapest: CompareModelsRow | null;
  rows: CompareModelsRow[];
}

/**
 * 列出同一 category 內所有模型，依「在這個 params 下會花多少點」遞增排序。
 * 用途：使用者說「Kling Pro 影片要多少？」→ 財財同時列出「Wan / PixVerse」便宜替代品。
 */
export function compareModels(input: CompareModelsInput): CompareModelsResult {
  const limit = Math.max(1, Math.min(10, Math.trunc(input.limit ?? 5)));
  const inCategory: ModelPricing[] = Object.values(MODEL_PRICING_CATALOG).filter(
    p => p.category === input.category
  );

  const rows: CompareModelsRow[] = inCategory.map(p => {
    const est = estimatePoints(p.modelId, {
      durationSec: input.durationSec,
      charCount: input.charCount,
      imageCount: input.imageCount,
    });
    return {
      modelId: p.modelId,
      label: p.label,
      provider: p.provider,
      tier: p.tier,
      totalPoints: est.totalPoints,
      breakdown: est.breakdown,
      premiumOverCheapest: 0,
      pctOfCheapest: 0,
    };
  });

  rows.sort((a, b) => a.totalPoints - b.totalPoints);

  const cheapest = rows[0] ?? null;
  if (cheapest) {
    const cheapestPts = Math.max(1, cheapest.totalPoints);
    for (const r of rows) {
      r.premiumOverCheapest = r.totalPoints - cheapest.totalPoints;
      r.pctOfCheapest = Math.round((r.totalPoints / cheapestPts) * 100);
    }
  }

  return {
    category: input.category,
    count: rows.length,
    cheapest,
    rows: rows.slice(0, limit),
  };
}

// ─── 使用者本月用量摘要 ────────────────────────────────────────────────────

export interface MonthlyUsageResult {
  totalRequests: number;
  totalCostUsd: number;
  /** 對齊 modelPricing：1 USD ≈ 100 pts → 把 USD 轉成 pts，讓 LLM 一句話講得出來 */
  totalCostPoints: number;
  /** 按模態（image / video / audio / voice / text…）拆解的次數 + 成本（USD） */
  modalityBreakdown: Array<{
    requestType: string;
    count: number;
    totalCostUsd: number;
  }>;
  /** 近 30 天花最多的模型（依花費 USD 加總；無資料時為 null） */
  topModel: {
    modelId: string;
    totalCalls: number;
    totalCostUsd: number;
  } | null;
}

/**
 * 取近 30 天的使用摘要 — 給 LLM 一份具體數字，不用再瞎猜。
 * 任何一個底層 DB 查詢失敗都不會炸：返回零值，由 LLM 處理「沒資料」文案。
 *
 * BUG-FIX：之前這裡呼叫的 getUserCostSummary / getUserModalityBreakdown 沒帶
 * date filter，會回傳「所有歷史紀錄」而不是 30 天。LLM 在使用者問「本月用到哪」
 * 時就會講出全期累計值，與 dashboard /credits 頁互相矛盾。現在統一帶
 * { days: 30 } 確保語意一致。
 */
export async function getMonthlyUsage(userId: number): Promise<MonthlyUsageResult> {
  try {
    const [summary, modality, top] = await Promise.all([
      getUserCostSummary(userId, { days: 30 }).catch(() => ({
        totalCost: 0,
        totalRequests: 0,
      })),
      getUserModalityBreakdown(userId, { days: 30 }).catch(() => []),
      getUserTopModelRecent(userId, { days: 30 }).catch(() => null),
    ]);

    const totalCostUsd = Number(summary.totalCost) || 0;
    const modalityBreakdown = (modality ?? []).map(row => ({
      requestType: String(row.requestType ?? "unknown"),
      count: Number(row.count) || 0,
      totalCostUsd: parseFloat(String(row.totalCost ?? "0")) || 0,
    }));

    return {
      totalRequests: Number(summary.totalRequests) || 0,
      totalCostUsd,
      totalCostPoints: Math.round(totalCostUsd * POINTS_PER_USD),
      modalityBreakdown,
      topModel: top
        ? {
            modelId: top.model,
            totalCalls: top.totalCalls,
            totalCostUsd: top.totalCostUsd,
          }
        : null,
    };
  } catch (err) {
    logger.warn("[AccountantTools] getMonthlyUsage failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      totalRequests: 0,
      totalCostUsd: 0,
      totalCostPoints: 0,
      modalityBreakdown: [],
      topModel: null,
    };
  }
}

// ─── 預算 / 訂閱餘額 ─────────────────────────────────────────────────────

export interface BudgetResult {
  /** 用戶目前剩下幾點（站內統一以 remainingGenerations 為「點數帳本」） */
  remainingPoints: number;
  /** 各模態的可用份額（從 users.quotaJson 讀；null 代表沒有設定） */
  perModalityQuota: {
    image: number;
    video: number;
    audio: number;
    voice: number;
  } | null;
  /** 自動加值是否啟用 + 下一次加值時間 + 金額（pts） */
  autoCredit: {
    enabled: boolean;
    amountPoints: number;
    intervalDays: number;
    nextAtIso: string | null;
  };
  /** 資料庫不可用 / 用戶不存在時 true，由 LLM 處理 fallback 文案 */
  noDataAvailable: boolean;
}

/**
 * 給財財一份「使用者錢包」現況：剩餘點數 + 各模態份額 + 自動加值節奏。
 *
 * 健康度規則供 LLM 判讀：
 *   - remainingPoints < 20 → 提醒接近見底，建議買點或開自動加值
 *   - autoCredit.enabled && nextAtIso 在 7 天內 → 一切正常，不用主動勸購
 *   - perModalityQuota 某一項 < 10 → 該模態快用完，建議節流或升級
 */
export async function getBudget(userId: number): Promise<BudgetResult> {
  try {
    const info = await getUserAccountInfo(userId).catch(() => null);
    if (!info) {
      return {
        remainingPoints: 0,
        perModalityQuota: null,
        autoCredit: {
          enabled: false,
          amountPoints: 0,
          intervalDays: 0,
          nextAtIso: null,
        },
        noDataAvailable: true,
      };
    }
    return {
      remainingPoints: info.remainingGenerations,
      perModalityQuota: info.quotaJson,
      autoCredit: {
        enabled: info.autoCreditEnabled,
        amountPoints: info.autoCreditAmount,
        intervalDays: info.autoCreditIntervalDays,
        nextAtIso: info.autoCreditNextAt
          ? info.autoCreditNextAt.toISOString()
          : null,
      },
      noDataAvailable: false,
    };
  } catch (err) {
    logger.warn("[AccountantTools] getBudget failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      remainingPoints: 0,
      perModalityQuota: null,
      autoCredit: {
        enabled: false,
        amountPoints: 0,
        intervalDays: 0,
        nextAtIso: null,
      },
      noDataAvailable: true,
    };
  }
}

// ─── 每日趨勢 + 預測 ─────────────────────────────────────────────────────

export interface DailyTrendDay {
  date: string;
  requests: number;
  costPoints: number;
}

export interface DailyTrendResult {
  windowDays: number;
  daysObserved: number;
  series: DailyTrendDay[];
  /** 平均每天花多少點（只算有資料的天，避免被休息日稀釋） */
  avgPointsPerActiveDay: number;
  /** 有沒有出現「單日成本 > 平均 × 3」的尖峰 */
  hasSpike: boolean;
  /** 最貴那一天的 ISO date + 點數，沒資料時 null */
  peakDay: { date: string; costPoints: number } | null;
}

/**
 * 取使用者最近 N 天每日成本（預設 14）。輸出已轉成「點數」，並附簡單
 * 異常標記讓 LLM 不用自己算統計：
 *   - hasSpike：最高日 > 平均 × 3
 *   - peakDay：最貴那一天
 */
export async function getDailyTrend(
  userId: number,
  args?: { days?: number }
): Promise<DailyTrendResult> {
  const windowDays = Math.max(1, Math.min(90, Math.trunc(args?.days ?? 14)));
  try {
    const rows = await getUserDailyTrendRange(userId, { days: windowDays }).catch(
      () => []
    );
    const series: DailyTrendDay[] = (rows ?? []).map(row => ({
      date: String(row.date ?? ""),
      requests: Number(row.count ?? 0),
      costPoints: Math.round((parseFloat(String(row.totalCost ?? "0")) || 0) * POINTS_PER_USD),
    }));
    const totalPoints = series.reduce((sum, d) => sum + d.costPoints, 0);
    const avgPointsPerActiveDay = series.length > 0 ? Math.round(totalPoints / series.length) : 0;
    let peakDay: DailyTrendResult["peakDay"] = null;
    for (const d of series) {
      if (!peakDay || d.costPoints > peakDay.costPoints) {
        peakDay = { date: d.date, costPoints: d.costPoints };
      }
    }
    const hasSpike =
      avgPointsPerActiveDay > 0 &&
      peakDay !== null &&
      peakDay.costPoints > avgPointsPerActiveDay * 3;
    return {
      windowDays,
      daysObserved: series.length,
      series,
      avgPointsPerActiveDay,
      hasSpike,
      peakDay,
    };
  } catch (err) {
    logger.warn("[AccountantTools] getDailyTrend failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      windowDays,
      daysObserved: 0,
      series: [],
      avgPointsPerActiveDay: 0,
      hasSpike: false,
      peakDay: null,
    };
  }
}

export interface ForecastResult {
  /** 觀察視窗（預設 14 天）— 用來估「每天平均花多少」的 baseline */
  observationDays: number;
  daysObserved: number;
  /** 觀察期內每天平均花多少點（用「視窗總點數 / 視窗天數」算，包含零花費的天） */
  avgPointsPerDay: number;
  /** 距離本月結束還有幾天（含今天） */
  daysRemainingInMonth: number;
  /** 預計到月底還會再花的點數（avgPointsPerDay × daysRemainingInMonth） */
  forecastPointsRemaining: number;
  /** 本月（自然月 1 號開始）到目前為止實際已花的點數 */
  monthToDatePoints: number;
  /** 預估整月總點數（mtd + forecastRemaining） */
  forecastMonthTotalPoints: number;
  /** 若有 budget.remainingPoints，估計會在 N 天內見底；null = 不會見底或沒設預算 */
  daysUntilDepletion: number | null;
  /** baseline 資料不足（< 3 天）時 true，LLM 應提示「資料還不夠下定論」 */
  insufficientData: boolean;
}

/**
 * 用最近 N 天的平均日花費，預測到月底會用多少點。
 * 設計上保守：
 *   - 用「視窗總點數 / 視窗天數」（含零花費日），避免拿活躍日均值高估月底
 *   - 觀察期不足 3 天時 insufficientData=true，LLM 要主動提示
 *   - daysUntilDepletion 用 remainingPoints / avgPointsPerDay，沒有 budget 時為 null
 */
export async function getForecast(
  userId: number,
  args?: { observationDays?: number }
): Promise<ForecastResult> {
  const observationDays = Math.max(1, Math.min(30, Math.trunc(args?.observationDays ?? 14)));

  try {
    const [trend, mtdSummary, budget] = await Promise.all([
      getDailyTrend(userId, { days: observationDays }),
      getUserCostSummary(userId, { days: daysSinceMonthStart() }).catch(() => ({
        totalCost: 0,
        totalRequests: 0,
      })),
      getBudget(userId),
    ]);

    const windowTotalPoints = trend.series.reduce((s, d) => s + d.costPoints, 0);
    // 用整個視窗的天數做分母（含零花費日），不是只算活躍日
    const avgPointsPerDay =
      observationDays > 0 ? Math.round(windowTotalPoints / observationDays) : 0;

    const today = new Date();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const daysRemainingInMonth = Math.max(0, daysInMonth - today.getDate() + 1);

    const forecastPointsRemaining = avgPointsPerDay * daysRemainingInMonth;
    const monthToDatePoints = Math.round((Number(mtdSummary.totalCost) || 0) * POINTS_PER_USD);
    const forecastMonthTotalPoints = monthToDatePoints + forecastPointsRemaining;

    const daysUntilDepletion =
      budget.noDataAvailable || avgPointsPerDay <= 0 || budget.remainingPoints <= 0
        ? null
        : Math.max(0, Math.floor(budget.remainingPoints / avgPointsPerDay));

    return {
      observationDays,
      daysObserved: trend.daysObserved,
      avgPointsPerDay,
      daysRemainingInMonth,
      forecastPointsRemaining,
      monthToDatePoints,
      forecastMonthTotalPoints,
      daysUntilDepletion,
      insufficientData: trend.daysObserved < 3,
    };
  } catch (err) {
    logger.warn("[AccountantTools] getForecast failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      observationDays,
      daysObserved: 0,
      avgPointsPerDay: 0,
      daysRemainingInMonth: 0,
      forecastPointsRemaining: 0,
      monthToDatePoints: 0,
      forecastMonthTotalPoints: 0,
      daysUntilDepletion: null,
      insufficientData: true,
    };
  }
}

/** 取「本月 1 號到今天」共幾天，供 month-to-date 查詢用。 */
function daysSinceMonthStart(): number {
  const today = new Date();
  // 用 today.getDate() 直接拿「今天是這個月的第幾天」；getUserCostSummary
  // 會用 DATE_SUB(NOW(), INTERVAL N DAY)，把 N=getDate() 帶進去剛好覆蓋
  // 本月 00:00:00 到現在的區間（小誤差 < 1 天，acceptable for forecast）。
  return Math.max(1, today.getDate());
}

// ─── 對單一模型給省法建議 ──────────────────────────────────────────────────

export interface SuggestSavingsInput {
  modelId: string;
  durationSec?: number;
  charCount?: number;
  imageCount?: number;
  /** 最多回幾筆替代品（預設 3，最多 5） */
  limit?: number;
}

export interface SavingsRow {
  modelId: string;
  label: string;
  tier: string;
  totalPoints: number;
  savingsPoints: number;
  savingsPct: number;
  /** 替代品 tier 比原本低多少階；越大表示品質差距越大 */
  tierGap: number;
  /** 給使用者看的風險摘要（同 tier=安全；差 2 階以上=A/B 測試） */
  riskNote: string;
}

export interface SuggestSavingsResult {
  baseline: {
    modelId: string;
    label: string;
    tier: string;
    totalPoints: number;
  };
  /** 同類別下，比 baseline 便宜的選項（依省最多排序） */
  alternatives: SavingsRow[];
  /** baseline 找不到、或同類別沒有更便宜選項時為 true */
  noBetterOption: boolean;
}

const TIER_RANK: Record<string, number> = {
  free: 0,
  economy: 1,
  standard: 2,
  premium: 3,
  ultra: 4,
};

function describeRisk(baselineTier: string, candidateTier: string): { gap: number; note: string } {
  const gap = (TIER_RANK[baselineTier] ?? 0) - (TIER_RANK[candidateTier] ?? 0);
  if (gap <= 0) return { gap: 0, note: "同 tier，安全替換" };
  if (gap === 1) return { gap, note: `品質可能略降（${baselineTier} → ${candidateTier}）` };
  return { gap, note: `品質風險高（${baselineTier} → ${candidateTier}，建議先 A/B 測試）` };
}

/**
 * 給定一個「正要跑的模型 + 參數」，列出同類別內所有更便宜的替代品 +
 * 風險評估 + 估算可省點數。
 *
 * 風險評估規則（tier rank）：
 *   - 同 tier 或更高（gap ≤ 0）→「安全替換」
 *   - 低 1 tier（gap = 1）→「品質可能略降」
 *   - 低 ≥ 2 tier（gap ≥ 2）→「品質風險高，建議先 A/B」
 */
export function suggestSavings(input: SuggestSavingsInput): SuggestSavingsResult {
  const limit = Math.max(1, Math.min(5, Math.trunc(input.limit ?? 3)));
  const baseline = getModelPricing(input.modelId);

  if (!baseline) {
    return {
      baseline: {
        modelId: input.modelId,
        label: input.modelId,
        tier: "unknown",
        totalPoints: estimatePoints(input.modelId).totalPoints,
      },
      alternatives: [],
      noBetterOption: true,
    };
  }

  const baselineEst = estimatePoints(input.modelId, {
    durationSec: input.durationSec,
    charCount: input.charCount,
    imageCount: input.imageCount,
  });

  const candidates: SavingsRow[] = Object.values(MODEL_PRICING_CATALOG)
    .filter(p => p.category === baseline.category && p.modelId !== baseline.modelId)
    .map(p => {
      const est = estimatePoints(p.modelId, {
        durationSec: input.durationSec,
        charCount: input.charCount,
        imageCount: input.imageCount,
      });
      const savingsPoints = baselineEst.totalPoints - est.totalPoints;
      const savingsPct =
        baselineEst.totalPoints > 0
          ? Math.round((savingsPoints / baselineEst.totalPoints) * 100)
          : 0;
      const risk = describeRisk(baseline.tier, p.tier);
      return {
        modelId: p.modelId,
        label: p.label,
        tier: p.tier,
        totalPoints: est.totalPoints,
        savingsPoints,
        savingsPct,
        tierGap: risk.gap,
        riskNote: risk.note,
      };
    })
    .filter(row => row.savingsPoints > 0)
    .sort((a, b) => b.savingsPoints - a.savingsPoints);

  return {
    baseline: {
      modelId: baseline.modelId,
      label: baseline.label,
      tier: baseline.tier,
      totalPoints: baselineEst.totalPoints,
    },
    alternatives: candidates.slice(0, limit),
    noBetterOption: candidates.length === 0,
  };
}
