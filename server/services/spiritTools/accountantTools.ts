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
  getUserCostSummary,
  getUserDailyTrend,
  getUserModalityBreakdown,
  getUserTopModelRecent,
} from "../../db";

// `getUserCostSummary` 仍由 getMonthlyUsage 使用（接受 lifetime aggregate
// 因為它就是要顯示「累計用量」）。getBudgetForecast 故意不用它 —
// lifetime 數字當不了 30 天 baseline，請看下面 PR review 修補。

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
 */
export async function getMonthlyUsage(userId: number): Promise<MonthlyUsageResult> {
  try {
    const [summary, modality, top] = await Promise.all([
      getUserCostSummary(userId).catch(() => ({ totalCost: 0, totalRequests: 0 })),
      getUserModalityBreakdown(userId).catch(() => []),
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
      totalCostPoints: Math.round(totalCostUsd * 100),
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

// ─── 多步驟工作流總點數估算 ────────────────────────────────────────────────

export interface WorkflowStep {
  /** 步驟標籤（給使用者看的），如「①出圖」「②生影片」。 */
  label?: string;
  modelId: string;
  durationSec?: number;
  charCount?: number;
  imageCount?: number;
  trainingSteps?: number;
}

export interface WorkflowEstimateRow {
  index: number;
  label: string;
  modelId: string;
  modelLabel: string | null;
  category: ModelCategory | null;
  totalPoints: number;
  breakdown: string;
  isUnknownModel: boolean;
}

export interface WorkflowEstimateResult {
  totalPoints: number;
  rows: WorkflowEstimateRow[];
  /** 整條鏈內哪一步最貴（給 LLM 一句話講「最大一筆是 ___」）。 */
  mostExpensive: WorkflowEstimateRow | null;
  /** 出現未知 modelId 的步驟數 — 用來給警示文案。 */
  unknownStepCount: number;
}

/**
 * 把多步驟工作流（步步 / 導導 規劃出來的 plan）整條算出總點數。
 *
 * 之前 LLM 要分別呼叫 N 次 accountant.estimate 再自己加總，會偷工漏算。
 * 工作流估算唯讀，不會 mutate DB；對未知 modelId 走 estimatePoints 的
 * 5 pts fallback 並標記 isUnknownModel:true 讓 LLM 老實提示使用者。
 */
export function workflowEstimate(input: {
  steps: WorkflowStep[];
}): WorkflowEstimateResult {
  const rows: WorkflowEstimateRow[] = (input.steps ?? []).map((step, idx) => {
    const pricing = getModelPricing(step.modelId);
    const est = estimatePoints(step.modelId, {
      durationSec: step.durationSec,
      charCount: step.charCount,
      imageCount: step.imageCount,
      trainingSteps: step.trainingSteps,
    });
    return {
      index: idx + 1,
      label: step.label ?? `Step ${idx + 1}`,
      modelId: step.modelId,
      modelLabel: pricing?.label ?? null,
      category: pricing?.category ?? null,
      totalPoints: est.totalPoints,
      breakdown: est.breakdown,
      isUnknownModel: !pricing,
    };
  });

  const totalPoints = rows.reduce((sum, r) => sum + r.totalPoints, 0);
  let mostExpensive: WorkflowEstimateRow | null = null;
  for (const row of rows) {
    if (!mostExpensive || row.totalPoints > mostExpensive.totalPoints) {
      mostExpensive = row;
    }
  }
  const unknownStepCount = rows.filter(r => r.isUnknownModel).length;

  return {
    totalPoints,
    rows,
    mostExpensive,
    unknownStepCount,
  };
}

// ─── 本月支出預測 ──────────────────────────────────────────────────────────

export interface BudgetForecastResult {
  /** 本月已過幾天（含今天） */
  daysElapsedInMonth: number;
  /** 本月還剩幾天（不含今天） */
  daysRemainingInMonth: number;
  /** 近 7 天每日平均點數（總點數 ÷ 7 calendar days，零用量天也算進去） */
  recent7dAvgPoints: number;
  /** 近 30 天總點數（從時間範圍真正限定的 daily trend 加總，USD × 100） */
  last30dTotalPoints: number;
  /** 近 30 天每日平均點數（總點數 ÷ 30 calendar days） */
  last30dAvgPoints: number;
  /** 線性預測：以近 7 天日均推算到月底還會花多少 */
  projectedMonthEndAddPoints: number;
  /** 趨勢：on-track（接近 30 天均值）/ high（>20%）/ low（<−20%）/ no-data */
  trajectory: "on-track" | "high" | "low" | "no-data";
  /** 給 LLM 一段直接可講的中文摘要 */
  humanSummary: string;
}

/**
 * 從近 7 天日均推算到月底總花費，讓財財能主動講「按這節奏到月底再花 ___ 點」。
 *
 * 邏輯：
 *   1. 取近 30 天 daily trend → 加總得 30 天總點數 → 除 30 calendar days 得日均
 *      （**不用 getUserCostSummary**，那是 lifetime 累加沒時間範圍限制，會把
 *       老用戶的歷史全堆進來導致 baseline 失真）
 *   2. 取近 7 天 daily trend → 加總得 7 天總點數 → 除 7 calendar days 得日均
 *      （**用 7 calendar days 不是 rows.length** — daily trend 會跳過零用量天，
 *       用 row count 當分母會在「7 天只跑 1 天」這種稀疏分布下把日均高估 7 倍）
 *   3. 比較 7d avg / 30d avg：>20% 上揚 → "high"；<−20% 下降 → "low"；其餘 "on-track"
 *   4. 用「7 天日均 × 月底剩餘天數」算 projectedMonthEndAddPoints
 *
 * 沒資料時不會炸：回 "no-data" 並全 0，由 LLM 給「我還沒有足夠數據估」的文案。
 */
function sumPointsFromDailyRows(
  rows: Array<{ totalCost?: string | number | null }>
): number {
  return rows.reduce((sum, row) => {
    const usd = parseFloat(String(row?.totalCost ?? "0")) || 0;
    return sum + Math.round(usd * 100);
  }, 0);
}

export async function getBudgetForecast(userId: number): Promise<BudgetForecastResult> {
  const now = new Date();
  const daysElapsedInMonth = now.getUTCDate();
  const lastDayOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const daysRemainingInMonth = Math.max(0, lastDayOfMonth - daysElapsedInMonth);

  try {
    // 兩份 daily trend：30d 當 baseline、7d 當當前節奏。getUserDailyTrend
    // 內部已經 clamp days 到 1..90，並且 rows 只回有用量的日期，所以兩個
    // 查詢都安全。Promise.all 並行抓 — 一邊掛掉另一邊還能用。
    const [d30, d7] = await Promise.all([
      getUserDailyTrend(userId, { days: 30 }).catch(() => [] as Array<{
        date: string;
        count: number;
        totalCost: string;
        totalTokens: number;
      }>),
      getUserDailyTrend(userId, { days: 7 }).catch(() => [] as Array<{
        date: string;
        count: number;
        totalCost: string;
        totalTokens: number;
      }>),
    ]);

    const last30dTotalPoints = sumPointsFromDailyRows(d30 ?? []);
    const last30dAvgPoints = Math.round(last30dTotalPoints / 30);

    const recent7dTotalPoints = sumPointsFromDailyRows(d7 ?? []);
    // 用 7 calendar days 當分母 — 零用量天也算進日均，避免稀疏資料把日均高估。
    const recent7dAvgPoints = Math.round(recent7dTotalPoints / 7);

    if (recent7dAvgPoints === 0 && last30dTotalPoints === 0) {
      return {
        daysElapsedInMonth,
        daysRemainingInMonth,
        recent7dAvgPoints: 0,
        last30dTotalPoints: 0,
        last30dAvgPoints: 0,
        projectedMonthEndAddPoints: 0,
        trajectory: "no-data",
        humanSummary: "你還沒有足夠的歷史用量讓我推算月底花費 — 跑幾筆任務後我會主動回報。",
      };
    }

    const projectedMonthEndAddPoints = recent7dAvgPoints * daysRemainingInMonth;

    let trajectory: BudgetForecastResult["trajectory"] = "on-track";
    if (last30dAvgPoints > 0) {
      const ratio = recent7dAvgPoints / last30dAvgPoints;
      if (ratio > 1.2) trajectory = "high";
      else if (ratio < 0.8) trajectory = "low";
    } else if (recent7dAvgPoints > 0) {
      // 30 天沒資料但 7 天有 → 算「剛開始用」，視為 on-track 不誤判 high/low。
      trajectory = "on-track";
    }

    const trajectoryLabel = {
      "on-track": "節奏跟近 30 天差不多",
      high: "本週節奏比近 30 天均值高 20% 以上 — 留意一下",
      low: "本週節奏比平常低 20% 以上 — 你少跑了，挺省的",
      "no-data": "資料不足",
    }[trajectory];

    return {
      daysElapsedInMonth,
      daysRemainingInMonth,
      recent7dAvgPoints,
      last30dTotalPoints,
      last30dAvgPoints,
      projectedMonthEndAddPoints,
      trajectory,
      humanSummary:
        `近 7 天日均 ${recent7dAvgPoints} 點 · ${trajectoryLabel}。` +
        `照這節奏到月底還會再花 ${projectedMonthEndAddPoints} 點（剩 ${daysRemainingInMonth} 天）。`,
    };
  } catch (err) {
    logger.warn("[AccountantTools] getBudgetForecast failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      daysElapsedInMonth,
      daysRemainingInMonth,
      recent7dAvgPoints: 0,
      last30dTotalPoints: 0,
      last30dAvgPoints: 0,
      projectedMonthEndAddPoints: 0,
      trajectory: "no-data",
      humanSummary: "目前抓不到用量資料，等資料回來我再算一次給你看。",
    };
  }
}
