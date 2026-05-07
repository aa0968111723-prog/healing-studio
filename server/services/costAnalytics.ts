/**
 * costAnalytics.ts — 站台呼叫成本深度分析輔助函式
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 提供 admin 後台「深度成本」面板所需的純資料計算邏輯：
 *
 *   基礎拆解：
 *   - categorizeEndpoint / summarizeByCategory：模態（LLM / 圖片 / 影片 / TTS …）
 *   - summarizeByEndpoint / summarizeByUser：Top-N 端點 / 使用者
 *   - summarizeByStatus：成功 / 失敗 / 逾時 / 速率受限
 *   - latencyStats / hourlyHeatmap：延遲與時段熱力圖
 *   - calculateWasteCost：失敗呼叫浪費金額
 *   - projectMonthlyCost：月底費用線性投影
 *   - compareCatalogVsActual：catalog 預估價 vs 實際扣費
 *
 *   進階分析（更深度）：
 *   - dailyEndpointTrends：每端點 7-day 序列 + 異常標記（>2× rolling avg）
 *   - perCallCostDistribution：單次成本 P50/P95/P99/max + 離群值
 *   - detectRetryChains：偵測「同 user+endpoint 60 秒內重試風暴」
 *   - summarizeByFeature：依功能模組（image-studio / video-studio / lora …）拆解
 *   - suggestSavings：對 Top 端點推薦同 category 內最便宜的 catalog 替代品
 *
 * 設計原則：
 *   1. 純函式、無資料庫依賴 → 方便單元測試與後端兩邊呼叫
 *   2. 數值統一以 USD 為單位（保留 6 位小數）
 *   3. 所有分組鍵都使用顯式字串，以避免 enum 變動造成壞行為
 */

import {
  MODEL_PRICING_CATALOG,
  type ModelCategory,
} from "./modelPricing";

// ─── Types ────────────────────────────────────────────────────────────────

export type UsageStatus = "success" | "failed" | "timeout" | "rate_limited";

export interface UsageEventLike {
  provider: string;
  endpoint: string;
  status: UsageStatus;
  costUsd: number;
  latencyMs?: number | null;
  userId?: number | null;
  createdAt: Date;
}

export interface CategoryBreakdown {
  category: ModelCategory | "unknown";
  label: string;
  callCount: number;
  successCount: number;
  failedCount: number;
  costUsd: number;
  avgCostPerCall: number;
  share: number;
}

export interface EndpointBreakdown {
  provider: string;
  endpoint: string;
  category: ModelCategory | "unknown";
  callCount: number;
  costUsd: number;
  avgCostPerCall: number;
  errorRate: number;
}

export interface UserBreakdown {
  userId: number;
  callCount: number;
  costUsd: number;
  avgCostPerCall: number;
  topEndpoint: string | null;
}

export interface StatusBreakdown {
  status: UsageStatus;
  callCount: number;
  costUsd: number;
  share: number;
}

export interface LatencyStats {
  sampleCount: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface MonthlyProjection {
  daysElapsed: number;
  daysInMonth: number;
  monthToDateUsd: number;
  averageDailyUsd: number;
  projectedMonthEndUsd: number;
  remainingDays: number;
}

export interface CatalogVsActual {
  endpoint: string;
  callCount: number;
  expectedUsd: number;
  actualUsd: number;
  deltaUsd: number;
  deltaPct: number | null;
}

// ─── Category labels (zh-Hant) ────────────────────────────────────────────

export const CATEGORY_LABELS: Record<ModelCategory | "unknown", string> = {
  "audio-to-text": "語音轉文字",
  "image-to-3d": "圖生 3D",
  "image-to-image": "圖生圖",
  "image-to-json": "圖像理解",
  "image-to-video": "圖生影片",
  "json": "結構化輸出",
  "llm": "語言模型",
  "text-to-3d": "文字生 3D",
  "text-to-audio": "文字生音樂",
  "text-to-image": "文字生圖",
  "text-to-json": "文字結構化",
  "text-to-speech": "文字轉語音",
  "text-to-video": "文字生影片",
  "training": "模型訓練",
  "video-to-audio": "影片轉音訊",
  "video-to-text": "影片轉文字",
  "video-to-video": "影片轉影片",
  "reasoning": "推理模型",
  "embedding": "嵌入向量",
  "unknown": "未分類",
};

// ─── Helpers ──────────────────────────────────────────────────────────────

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 將 endpoint（通常是 modelId）對應到 catalog 內的 category。
 * 找不到就回傳 "unknown"。
 */
export function categorizeEndpoint(
  endpoint: string
): ModelCategory | "unknown" {
  if (!endpoint) return "unknown";
  const direct = MODEL_PRICING_CATALOG[endpoint];
  if (direct) return direct.category;

  // endpoint 可能含尾綴（例如 "/run", "?stream=1"）；嘗試前綴匹配 catalog key
  const trimmed = endpoint.split(/[?#]/)[0];
  if (MODEL_PRICING_CATALOG[trimmed]) return MODEL_PRICING_CATALOG[trimmed].category;

  for (const key of Object.keys(MODEL_PRICING_CATALOG)) {
    if (trimmed.startsWith(key)) return MODEL_PRICING_CATALOG[key].category;
  }
  return "unknown";
}

/**
 * 依 ModelCategory 彙總（含模態歸類，未分類者歸 "unknown"）。
 */
export function summarizeByCategory(
  events: UsageEventLike[]
): CategoryBreakdown[] {
  const map = new Map<
    string,
    {
      callCount: number;
      successCount: number;
      failedCount: number;
      costUsd: number;
    }
  >();

  let totalCost = 0;
  for (const e of events) {
    const cat = categorizeEndpoint(e.endpoint);
    const slot = map.get(cat) ?? {
      callCount: 0,
      successCount: 0,
      failedCount: 0,
      costUsd: 0,
    };
    slot.callCount += 1;
    if (e.status === "success") slot.successCount += 1;
    else slot.failedCount += 1;
    slot.costUsd += Number(e.costUsd) || 0;
    totalCost += Number(e.costUsd) || 0;
    map.set(cat, slot);
  }

  const rows: CategoryBreakdown[] = [];
  for (const [cat, slot] of map.entries()) {
    rows.push({
      category: cat as ModelCategory | "unknown",
      label: CATEGORY_LABELS[cat as ModelCategory | "unknown"] ?? cat,
      callCount: slot.callCount,
      successCount: slot.successCount,
      failedCount: slot.failedCount,
      costUsd: round6(slot.costUsd),
      avgCostPerCall: slot.callCount > 0 ? round6(slot.costUsd / slot.callCount) : 0,
      share: totalCost > 0 ? round2((slot.costUsd / totalCost) * 100) : 0,
    });
  }
  return rows.sort((a, b) => b.costUsd - a.costUsd);
}

/**
 * 取最花錢的前 N 個端點。
 */
export function summarizeByEndpoint(
  events: UsageEventLike[],
  topN = 20
): EndpointBreakdown[] {
  const map = new Map<
    string,
    {
      provider: string;
      endpoint: string;
      callCount: number;
      errorCount: number;
      costUsd: number;
    }
  >();

  for (const e of events) {
    const key = `${e.provider}|${e.endpoint}`;
    const slot = map.get(key) ?? {
      provider: e.provider,
      endpoint: e.endpoint,
      callCount: 0,
      errorCount: 0,
      costUsd: 0,
    };
    slot.callCount += 1;
    if (e.status !== "success") slot.errorCount += 1;
    slot.costUsd += Number(e.costUsd) || 0;
    map.set(key, slot);
  }

  return Array.from(map.values())
    .map(s => ({
      provider: s.provider,
      endpoint: s.endpoint,
      category: categorizeEndpoint(s.endpoint),
      callCount: s.callCount,
      costUsd: round6(s.costUsd),
      avgCostPerCall: s.callCount > 0 ? round6(s.costUsd / s.callCount) : 0,
      errorRate: s.callCount > 0 ? round2((s.errorCount / s.callCount) * 100) : 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, topN);
}

/**
 * 取最花錢的前 N 個使用者。
 */
export function summarizeByUser(
  events: UsageEventLike[],
  topN = 20
): UserBreakdown[] {
  const map = new Map<
    number,
    {
      callCount: number;
      costUsd: number;
      endpointCounts: Map<string, number>;
    }
  >();

  for (const e of events) {
    if (e.userId == null) continue;
    const slot = map.get(e.userId) ?? {
      callCount: 0,
      costUsd: 0,
      endpointCounts: new Map<string, number>(),
    };
    slot.callCount += 1;
    slot.costUsd += Number(e.costUsd) || 0;
    slot.endpointCounts.set(
      e.endpoint,
      (slot.endpointCounts.get(e.endpoint) ?? 0) + 1
    );
    map.set(e.userId, slot);
  }

  const rows: UserBreakdown[] = [];
  for (const [userId, slot] of map.entries()) {
    let topEndpoint: string | null = null;
    let topCount = 0;
    for (const [ep, c] of slot.endpointCounts.entries()) {
      if (c > topCount) {
        topEndpoint = ep;
        topCount = c;
      }
    }
    rows.push({
      userId,
      callCount: slot.callCount,
      costUsd: round6(slot.costUsd),
      avgCostPerCall: slot.callCount > 0 ? round6(slot.costUsd / slot.callCount) : 0,
      topEndpoint,
    });
  }
  return rows.sort((a, b) => b.costUsd - a.costUsd).slice(0, topN);
}

/**
 * 依狀態（success / failed / timeout / rate_limited）拆解費用。
 */
export function summarizeByStatus(events: UsageEventLike[]): StatusBreakdown[] {
  const allStatuses: UsageStatus[] = ["success", "failed", "timeout", "rate_limited"];
  const map = new Map<UsageStatus, { callCount: number; costUsd: number }>();
  let totalCost = 0;
  for (const s of allStatuses) map.set(s, { callCount: 0, costUsd: 0 });
  for (const e of events) {
    const slot = map.get(e.status);
    if (!slot) continue;
    slot.callCount += 1;
    slot.costUsd += Number(e.costUsd) || 0;
    totalCost += Number(e.costUsd) || 0;
  }
  return allStatuses.map(status => {
    const slot = map.get(status)!;
    return {
      status,
      callCount: slot.callCount,
      costUsd: round6(slot.costUsd),
      share: totalCost > 0 ? round2((slot.costUsd / totalCost) * 100) : 0,
    };
  });
}

/**
 * 浪費費用 = 失敗 / 逾時 / rate_limited 但仍計費的金額總和。
 */
export function calculateWasteCost(events: UsageEventLike[]): {
  wastedUsd: number;
  wastedCalls: number;
  wastedShare: number;
} {
  let wastedUsd = 0;
  let wastedCalls = 0;
  let totalUsd = 0;
  for (const e of events) {
    const cost = Number(e.costUsd) || 0;
    totalUsd += cost;
    if (e.status !== "success") {
      wastedCalls += 1;
      wastedUsd += cost;
    }
  }
  return {
    wastedUsd: round6(wastedUsd),
    wastedCalls,
    wastedShare: totalUsd > 0 ? round2((wastedUsd / totalUsd) * 100) : 0,
  };
}

/**
 * 延遲統計（avg / p50 / p95 / p99 / max）。
 * 僅統計 latencyMs > 0 的事件；空樣本回傳全 0。
 */
export function latencyStats(events: UsageEventLike[]): LatencyStats {
  const samples: number[] = [];
  for (const e of events) {
    const ms = Number(e.latencyMs);
    if (Number.isFinite(ms) && ms > 0) samples.push(ms);
  }
  if (samples.length === 0) {
    return { sampleCount: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  }
  samples.sort((a, b) => a - b);
  const sum = samples.reduce((s, v) => s + v, 0);
  const pickPercentile = (p: number) => {
    const idx = Math.min(samples.length - 1, Math.max(0, Math.ceil(samples.length * p) - 1));
    return samples[idx];
  };
  return {
    sampleCount: samples.length,
    avgMs: Math.round(sum / samples.length),
    p50Ms: pickPercentile(0.5),
    p95Ms: pickPercentile(0.95),
    p99Ms: pickPercentile(0.99),
    maxMs: samples[samples.length - 1],
  };
}

/**
 * 7 × 24 熱力圖：[weekday][hour] = { calls, costUsd }。
 * weekday: 0 = 週日 ... 6 = 週六
 */
export function hourlyHeatmap(events: UsageEventLike[]): Array<{
  weekday: number;
  hour: number;
  callCount: number;
  costUsd: number;
}> {
  const grid = new Map<string, { weekday: number; hour: number; callCount: number; costUsd: number }>();
  for (const e of events) {
    const d = e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt);
    if (Number.isNaN(d.getTime())) continue;
    const weekday = d.getDay();
    const hour = d.getHours();
    const key = `${weekday}-${hour}`;
    const slot = grid.get(key) ?? { weekday, hour, callCount: 0, costUsd: 0 };
    slot.callCount += 1;
    slot.costUsd += Number(e.costUsd) || 0;
    grid.set(key, slot);
  }
  // 補齊全 168 格
  const rows: Array<{ weekday: number; hour: number; callCount: number; costUsd: number }> = [];
  for (let w = 0; w < 7; w++) {
    for (let h = 0; h < 24; h++) {
      const slot = grid.get(`${w}-${h}`) ?? { weekday: w, hour: h, callCount: 0, costUsd: 0 };
      rows.push({
        weekday: slot.weekday,
        hour: slot.hour,
        callCount: slot.callCount,
        costUsd: round6(slot.costUsd),
      });
    }
  }
  return rows;
}

/**
 * 月底費用線性投影：以「至今每日均費」推估當月底總額。
 *   projected = MTD + avgDaily × remainingDays
 */
export function projectMonthlyCost(
  monthToDateUsd: number,
  now: Date = new Date()
): MonthlyProjection {
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysElapsed = Math.max(1, now.getDate());
  const remainingDays = Math.max(0, daysInMonth - daysElapsed);
  const averageDailyUsd = monthToDateUsd / daysElapsed;
  const projectedMonthEndUsd = monthToDateUsd + averageDailyUsd * remainingDays;
  return {
    daysElapsed,
    daysInMonth,
    monthToDateUsd: round6(monthToDateUsd),
    averageDailyUsd: round6(averageDailyUsd),
    projectedMonthEndUsd: round6(projectedMonthEndUsd),
    remainingDays,
  };
}

/**
 * 比對 catalog 預估價 vs 實際扣費。
 *   - expectedUsd 用 catalog basePoints / 100 推導（1 USD = 100 pts）
 *   - 若 catalog 找不到該 endpoint，跳過該筆
 */
export function compareCatalogVsActual(
  events: UsageEventLike[]
): CatalogVsActual[] {
  const map = new Map<
    string,
    { provider: string; endpoint: string; callCount: number; actualUsd: number }
  >();
  for (const e of events) {
    const key = `${e.provider}|${e.endpoint}`;
    const slot = map.get(key) ?? {
      provider: e.provider,
      endpoint: e.endpoint,
      callCount: 0,
      actualUsd: 0,
    };
    slot.callCount += 1;
    slot.actualUsd += Number(e.costUsd) || 0;
    map.set(key, slot);
  }
  const out: CatalogVsActual[] = [];
  for (const slot of map.values()) {
    const pricing = MODEL_PRICING_CATALOG[slot.endpoint];
    if (!pricing) continue;
    const expectedPerCall = pricing.baseCostUsd ?? pricing.basePoints / 100;
    const expectedUsd = expectedPerCall * slot.callCount;
    const deltaUsd = slot.actualUsd - expectedUsd;
    const deltaPct = expectedUsd > 0 ? round2((deltaUsd / expectedUsd) * 100) : null;
    out.push({
      endpoint: slot.endpoint,
      callCount: slot.callCount,
      expectedUsd: round6(expectedUsd),
      actualUsd: round6(slot.actualUsd),
      deltaUsd: round6(deltaUsd),
      deltaPct,
    });
  }
  return out.sort((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd));
}

// ─── Deep Layer 1: Daily Endpoint Trends + Anomaly Detection ──────────────

export interface DailyEndpointTrend {
  provider: string;
  endpoint: string;
  series: Array<{ date: string; callCount: number; costUsd: number }>;
  baselineAvgUsd: number;
  todayUsd: number;
  spikeRatio: number; // todayUsd / baselineAvgUsd（baselineAvg=0 → 0）
  isAnomaly: boolean; // spikeRatio >= 2 且 todayUsd >= 0.01
}

const toDateKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/**
 * 對「Top-N 花錢端點」逐一產生 7-day 日序列 + 異常檢測。
 * 異常規則：今日費用 >= 2 × 過去 (windowDays-1) 天均費，且金額 >= $0.01。
 *
 * 注意：events 必須包含足夠歷史（建議 >= 7 天）。
 */
export function dailyEndpointTrends(
  events: UsageEventLike[],
  topN = 10,
  windowDays = 7,
  now: Date = new Date()
): DailyEndpointTrend[] {
  // 先用 summarizeByEndpoint 鎖定 Top-N
  const top = summarizeByEndpoint(events, topN).map(e => `${e.provider}|${e.endpoint}`);
  const topSet = new Set(top);

  // 建立 endpoint × date 二維 map
  const cells = new Map<string, Map<string, { calls: number; cost: number }>>();
  for (const e of events) {
    const key = `${e.provider}|${e.endpoint}`;
    if (!topSet.has(key)) continue;
    const dateKey = toDateKey(
      e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt)
    );
    const inner = cells.get(key) ?? new Map<string, { calls: number; cost: number }>();
    const slot = inner.get(dateKey) ?? { calls: 0, cost: 0 };
    slot.calls += 1;
    slot.cost += Number(e.costUsd) || 0;
    inner.set(dateKey, slot);
    cells.set(key, inner);
  }

  // 補齊 windowDays 連續日期軸
  const dates: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(toDateKey(d));
  }
  const todayKey = dates[dates.length - 1];

  const out: DailyEndpointTrend[] = [];
  for (const key of top) {
    const [provider, endpoint] = key.split("|");
    const inner = cells.get(key) ?? new Map();
    const series = dates.map(d => {
      const slot = inner.get(d);
      return {
        date: d,
        callCount: slot?.calls ?? 0,
        costUsd: round6(slot?.cost ?? 0),
      };
    });
    const todayUsd = series[series.length - 1].costUsd;
    const past = series.slice(0, -1).map(s => s.costUsd);
    const baselineAvgUsd =
      past.length > 0 ? round6(past.reduce((s, v) => s + v, 0) / past.length) : 0;
    const spikeRatio =
      baselineAvgUsd > 0 ? round2(todayUsd / baselineAvgUsd) : 0;
    const isAnomaly = spikeRatio >= 2 && todayUsd >= 0.01;
    out.push({
      provider,
      endpoint,
      series,
      baselineAvgUsd,
      todayUsd,
      spikeRatio,
      isAnomaly,
    });
    if (todayKey === todayKey) {
      // (no-op; just to keep todayKey referenced for clarity in jsdoc)
    }
  }
  return out;
}

// ─── Deep Layer 2: Per-Call Cost Distribution + Outliers ──────────────────

export interface CostDistribution {
  sampleCount: number;
  p50Usd: number;
  p90Usd: number;
  p95Usd: number;
  p99Usd: number;
  maxUsd: number;
  outliers: Array<{
    provider: string;
    endpoint: string;
    userId: number | null;
    costUsd: number;
    latencyMs: number | null;
    createdAt: string;
  }>;
}

/**
 * 單次呼叫成本分佈 + 離群值。
 *   離群定義：單次費用 > p99 × outlierMultiplier（預設 1.5）。
 */
export function perCallCostDistribution(
  events: UsageEventLike[],
  outlierMultiplier = 1.5,
  outlierLimit = 20
): CostDistribution {
  const samples = events
    .map(e => Number(e.costUsd) || 0)
    .filter(v => v > 0)
    .sort((a, b) => a - b);

  if (samples.length === 0) {
    return {
      sampleCount: 0,
      p50Usd: 0,
      p90Usd: 0,
      p95Usd: 0,
      p99Usd: 0,
      maxUsd: 0,
      outliers: [],
    };
  }

  const pick = (p: number) => {
    const idx = Math.min(samples.length - 1, Math.max(0, Math.ceil(samples.length * p) - 1));
    return samples[idx];
  };

  const p99 = pick(0.99);
  const threshold = p99 * outlierMultiplier;

  const outlierEvents = events
    .filter(e => (Number(e.costUsd) || 0) > threshold)
    .sort((a, b) => Number(b.costUsd) - Number(a.costUsd))
    .slice(0, outlierLimit)
    .map(e => ({
      provider: e.provider,
      endpoint: e.endpoint,
      userId: e.userId ?? null,
      costUsd: round6(Number(e.costUsd) || 0),
      latencyMs: e.latencyMs ?? null,
      createdAt: (e.createdAt instanceof Date
        ? e.createdAt
        : new Date(e.createdAt)
      ).toISOString(),
    }));

  return {
    sampleCount: samples.length,
    p50Usd: round6(pick(0.5)),
    p90Usd: round6(pick(0.9)),
    p95Usd: round6(pick(0.95)),
    p99Usd: round6(p99),
    maxUsd: round6(samples[samples.length - 1]),
    outliers: outlierEvents,
  };
}

// ─── Deep Layer 3: Retry Chain Detection ──────────────────────────────────

export interface RetryChain {
  userId: number;
  endpoint: string;
  attempts: number;
  totalCostUsd: number;
  finalStatus: UsageStatus;
  windowSec: number;
  startedAt: string;
}

/**
 * 偵測「同 userId + 同 endpoint 在 windowSec 內連續呼叫」的重試風暴。
 *   - 任何相鄰呼叫間隔 <= windowSec → 視為同一鏈
 *   - attempts >= 2 才回傳
 *   - 排序：依 totalCostUsd 降冪
 */
export function detectRetryChains(
  events: UsageEventLike[],
  windowSec = 60,
  topN = 30
): RetryChain[] {
  // 先依 (userId, endpoint) 群組並按時間排序
  const buckets = new Map<string, UsageEventLike[]>();
  for (const e of events) {
    if (e.userId == null) continue;
    const key = `${e.userId}|${e.endpoint}`;
    const arr = buckets.get(key) ?? [];
    arr.push(e);
    buckets.set(key, arr);
  }

  const chains: RetryChain[] = [];
  for (const [key, arr] of buckets.entries()) {
    arr.sort((a, b) => {
      const at = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      const bt = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
      return at - bt;
    });

    let chainStart = 0;
    for (let i = 1; i <= arr.length; i++) {
      const prevTime =
        arr[i - 1].createdAt instanceof Date
          ? (arr[i - 1].createdAt as Date).getTime()
          : new Date(arr[i - 1].createdAt).getTime();
      const curTime =
        i < arr.length
          ? arr[i].createdAt instanceof Date
            ? (arr[i].createdAt as Date).getTime()
            : new Date(arr[i].createdAt).getTime()
          : Infinity;

      const gapSec = (curTime - prevTime) / 1000;
      if (gapSec > windowSec || i === arr.length) {
        const slice = arr.slice(chainStart, i);
        if (slice.length >= 2) {
          const [userIdStr] = key.split("|");
          const totalCost = slice.reduce((s, e) => s + (Number(e.costUsd) || 0), 0);
          const startTime =
            slice[0].createdAt instanceof Date
              ? (slice[0].createdAt as Date)
              : new Date(slice[0].createdAt);
          const endTime =
            slice[slice.length - 1].createdAt instanceof Date
              ? (slice[slice.length - 1].createdAt as Date)
              : new Date(slice[slice.length - 1].createdAt);
          chains.push({
            userId: Number(userIdStr),
            endpoint: slice[0].endpoint,
            attempts: slice.length,
            totalCostUsd: round6(totalCost),
            finalStatus: slice[slice.length - 1].status,
            windowSec: Math.round((endTime.getTime() - startTime.getTime()) / 1000),
            startedAt: startTime.toISOString(),
          });
        }
        chainStart = i;
      }
    }
  }

  return chains.sort((a, b) => b.totalCostUsd - a.totalCostUsd).slice(0, topN);
}

// ─── Deep Layer 4: Feature-Level Breakdown ────────────────────────────────

export interface FeatureBreakdown {
  feature: string;
  callCount: number;
  costUsd: number;
  share: number;
  topEndpoint: string | null;
}

/**
 * 從 endpoint 字串推斷功能模組（feature）。
 *   優先順序：
 *     1. requestMeta.feature（呼叫端可顯式標記）— 留給 caller 在 UsageEventLike 多帶
 *     2. endpoint 前綴匹配已知 prefix → known feature
 *     3. 其他 → "general"
 */
const FEATURE_PREFIX_RULES: Array<{ prefix: string; feature: string }> = [
  { prefix: "fal-ai/flux", feature: "image-studio" },
  { prefix: "fal-ai/stable-diffusion", feature: "image-studio" },
  { prefix: "fal-ai/aura-flow", feature: "image-studio" },
  { prefix: "fal-ai/kling", feature: "video-studio" },
  { prefix: "fal-ai/veo", feature: "video-studio" },
  { prefix: "fal-ai/luma", feature: "video-studio" },
  { prefix: "fal-ai/runway", feature: "video-studio" },
  { prefix: "fal-ai/lora", feature: "lora-trainer" },
  { prefix: "fal-ai/flux-lora", feature: "lora-trainer" },
  { prefix: "fal-ai/whisper", feature: "audio-transcribe" },
  { prefix: "fal-ai/elevenlabs", feature: "tts-studio" },
  { prefix: "elevenlabs", feature: "tts-studio" },
  { prefix: "suno", feature: "music-studio" },
  { prefix: "gemini", feature: "ai-brain" },
  { prefix: "anthropic", feature: "ai-brain" },
  { prefix: "openai", feature: "ai-brain" },
  { prefix: "perplexity", feature: "ai-brain" },
];

export function inferFeature(endpoint: string): string {
  if (!endpoint) return "general";
  for (const rule of FEATURE_PREFIX_RULES) {
    if (endpoint.startsWith(rule.prefix)) return rule.feature;
  }
  return "general";
}

export function summarizeByFeature(events: UsageEventLike[]): FeatureBreakdown[] {
  const map = new Map<
    string,
    { callCount: number; costUsd: number; endpointCounts: Map<string, number> }
  >();
  let total = 0;
  for (const e of events) {
    const feature = inferFeature(e.endpoint);
    const slot = map.get(feature) ?? {
      callCount: 0,
      costUsd: 0,
      endpointCounts: new Map<string, number>(),
    };
    slot.callCount += 1;
    slot.costUsd += Number(e.costUsd) || 0;
    slot.endpointCounts.set(e.endpoint, (slot.endpointCounts.get(e.endpoint) ?? 0) + 1);
    total += Number(e.costUsd) || 0;
    map.set(feature, slot);
  }

  const rows: FeatureBreakdown[] = [];
  for (const [feature, slot] of map.entries()) {
    let topEndpoint: string | null = null;
    let topCount = 0;
    for (const [ep, c] of slot.endpointCounts.entries()) {
      if (c > topCount) {
        topEndpoint = ep;
        topCount = c;
      }
    }
    rows.push({
      feature,
      callCount: slot.callCount,
      costUsd: round6(slot.costUsd),
      share: total > 0 ? round2((slot.costUsd / total) * 100) : 0,
      topEndpoint,
    });
  }
  return rows.sort((a, b) => b.costUsd - a.costUsd);
}

// ─── Deep Layer 5: What-If Savings Suggester ──────────────────────────────

export interface SavingsSuggestion {
  endpoint: string;
  category: ModelCategory | "unknown";
  callCount: number;
  currentCostUsd: number;
  suggestedEndpoint: string;
  suggestedCostUsd: number;
  monthlySavingsUsd: number;
  savingsPct: number;
  riskNote: string;
}

const TIER_RANK: Record<string, number> = {
  free: 0,
  economy: 1,
  standard: 2,
  premium: 3,
  ultra: 4,
};

/**
 * 對 Top 端點推薦同 category 內最便宜的 catalog 替代品。
 *   - 跳過已在最低 tier（economy / free）的端點
 *   - savingsPct < minSavingsPct 不推
 *   - riskNote 標示 tier 落差以提醒品質風險
 */
export function suggestSavings(
  events: UsageEventLike[],
  topN = 10,
  minSavingsPct = 30
): SavingsSuggestion[] {
  // 取 Top-N 花錢端點
  const top = summarizeByEndpoint(events, topN);

  // 建立 category → cheapest catalog entry
  const cheapestPerCategory = new Map<string, { modelId: string; baseCostUsd: number; tier: string }>();
  for (const [modelId, p] of Object.entries(MODEL_PRICING_CATALOG)) {
    const cur = cheapestPerCategory.get(p.category);
    if (!cur || p.baseCostUsd < cur.baseCostUsd) {
      cheapestPerCategory.set(p.category, {
        modelId,
        baseCostUsd: p.baseCostUsd,
        tier: p.tier,
      });
    }
  }

  const out: SavingsSuggestion[] = [];
  for (const ep of top) {
    const currentPricing = MODEL_PRICING_CATALOG[ep.endpoint];
    if (!currentPricing) continue;
    const cheap = cheapestPerCategory.get(currentPricing.category);
    if (!cheap || cheap.modelId === ep.endpoint) continue;
    if (cheap.baseCostUsd >= currentPricing.baseCostUsd) continue;

    const currentCallCost = currentPricing.baseCostUsd;
    const suggestedCallCost = cheap.baseCostUsd;
    const savingsPerCall = currentCallCost - suggestedCallCost;
    if (savingsPerCall <= 0) continue;
    // 推估月省：以「視窗內 callCount」乘 savingsPerCall（保守，未做日均放大）
    const monthlySavings = savingsPerCall * ep.callCount;
    const savingsPct =
      currentCallCost > 0 ? round2((savingsPerCall / currentCallCost) * 100) : 0;
    if (savingsPct < minSavingsPct) continue;

    const tierGap =
      (TIER_RANK[currentPricing.tier] ?? 0) - (TIER_RANK[cheap.tier] ?? 0);
    const riskNote =
      tierGap >= 2
        ? `品質風險高（${currentPricing.tier} → ${cheap.tier}，建議先 A/B 測試）`
        : tierGap === 1
        ? `品質可能略降（${currentPricing.tier} → ${cheap.tier}）`
        : "同 tier，安全替換";

    out.push({
      endpoint: ep.endpoint,
      category: currentPricing.category,
      callCount: ep.callCount,
      currentCostUsd: round6(ep.costUsd),
      suggestedEndpoint: cheap.modelId,
      suggestedCostUsd: round6(suggestedCallCost * ep.callCount),
      monthlySavingsUsd: round6(monthlySavings),
      savingsPct,
      riskNote,
    });
  }

  return out.sort((a, b) => b.monthlySavingsUsd - a.monthlySavingsUsd);
}

// ─── Deep Layer 6: Real-Cost Reconciliation ───────────────────────────────
//
// 將「平台記錄成本（aiUsageEvents.costUsd 總和）」與「供應商側帳單」對帳。
// 供應商側資料來自最近一次 providerSnapshots.nextInvoice.amountUsd。
//
// 用途：
//   - 偵測平台漏記呼叫（gapPct > 0 且 invoice > recorded）
//   - 偵測平台超扣（gapPct < 0）
//   - 月底結算時與帳單核對

export interface ProviderRecon {
  provider: string;
  recordedCostUsd: number;
  providerInvoiceUsd: number | null;
  gapUsd: number | null;
  gapPct: number | null;
  lastSnapshotAt: string | null;
}

export interface ReconciliationReport {
  perProvider: ProviderRecon[];
  totalRecordedUsd: number;
  totalInvoicedUsd: number;
  totalGapUsd: number;
  totalGapPct: number | null;
  /** 全站「真實成本」單一數值 = 供應商帳單總和（若有缺失 fallback 到記錄總和） */
  truthTotalUsd: number;
}

export interface ProviderInvoiceInfo {
  provider: string;
  invoiceUsd: number | null;
  snapshotAt: Date | null;
}

export function reconcileWithProviderInvoices(
  events: UsageEventLike[],
  invoices: ProviderInvoiceInfo[]
): ReconciliationReport {
  // 平台側：每 provider 累計 costUsd
  const recordedByProvider = new Map<string, number>();
  for (const e of events) {
    recordedByProvider.set(
      e.provider,
      (recordedByProvider.get(e.provider) ?? 0) + (Number(e.costUsd) || 0)
    );
  }

  // 整併兩邊鍵
  const allProviders = new Set<string>([
    ...recordedByProvider.keys(),
    ...invoices.map(i => i.provider),
  ]);

  let totalRecorded = 0;
  let totalInvoiced = 0;
  const rows: ProviderRecon[] = [];

  for (const provider of allProviders) {
    const recorded = recordedByProvider.get(provider) ?? 0;
    const inv = invoices.find(i => i.provider === provider);
    const invoiceUsd = inv?.invoiceUsd ?? null;
    const gapUsd = invoiceUsd != null ? round6(invoiceUsd - recorded) : null;
    const gapPct =
      invoiceUsd != null && invoiceUsd > 0
        ? round2((gapUsd! / invoiceUsd) * 100)
        : null;

    rows.push({
      provider,
      recordedCostUsd: round6(recorded),
      providerInvoiceUsd: invoiceUsd,
      gapUsd,
      gapPct,
      lastSnapshotAt: inv?.snapshotAt ? inv.snapshotAt.toISOString() : null,
    });

    totalRecorded += recorded;
    if (invoiceUsd != null) totalInvoiced += invoiceUsd;
  }

  const totalGap = totalInvoiced - totalRecorded;
  const totalGapPct =
    totalInvoiced > 0 ? round2((totalGap / totalInvoiced) * 100) : null;

  // 真實成本：以「最大值」為準（任一邊較高都代表至少要付那麼多）
  const truthTotalUsd = round6(Math.max(totalRecorded, totalInvoiced));

  return {
    perProvider: rows.sort((a, b) => b.recordedCostUsd - a.recordedCostUsd),
    totalRecordedUsd: round6(totalRecorded),
    totalInvoicedUsd: round6(totalInvoiced),
    totalGapUsd: round6(totalGap),
    totalGapPct,
    truthTotalUsd,
  };
}

// ─── Deep Layer 7: CSV Report Export ──────────────────────────────────────
//
// 匯出完整深度成本報表，純 string，由前端打 Blob 觸發下載。
// 包含 sections，每段以 "## SECTION" 標題分隔，方便在 Excel 內分頁解析。

export interface DeepCostReportInput {
  windowStart: string;
  windowEnd: string;
  reconciliation: ReconciliationReport;
  byCategory: CategoryBreakdown[];
  byFeature: FeatureBreakdown[];
  byStatus: StatusBreakdown[];
  topEndpoints: EndpointBreakdown[];
  topUsers: UserBreakdown[];
  catalogVsActual: CatalogVsActual[];
  retryChains: RetryChain[];
  savingsSuggestions: SavingsSuggestion[];
  costDistribution: CostDistribution;
  waste: { wastedUsd: number; wastedCalls: number; wastedShare: number };
  projection: MonthlyProjection;
}

const csvEscape = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const csvLine = (cells: unknown[]): string => cells.map(csvEscape).join(",");

export function buildDeepCostCsvReport(input: DeepCostReportInput): string {
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push(`# Healing Studio 深度成本報表`);
  push(`# 視窗：${input.windowStart} → ${input.windowEnd}`);
  push(`# 真值來源：ai_usage_events.costUsd（平台側）+ provider_snapshots.nextInvoice（供應商側）`);
  push("");

  push("## 帳單對帳（Reconciliation）");
  push(csvLine(["Provider", "RecordedUsd", "ProviderInvoiceUsd", "GapUsd", "GapPct", "LastSnapshotAt"]));
  for (const r of input.reconciliation.perProvider) {
    push(
      csvLine([
        r.provider,
        r.recordedCostUsd,
        r.providerInvoiceUsd ?? "",
        r.gapUsd ?? "",
        r.gapPct ?? "",
        r.lastSnapshotAt ?? "",
      ])
    );
  }
  push(
    csvLine([
      "TOTAL",
      input.reconciliation.totalRecordedUsd,
      input.reconciliation.totalInvoicedUsd,
      input.reconciliation.totalGapUsd,
      input.reconciliation.totalGapPct ?? "",
      "",
    ])
  );
  push(`# 真實總成本（取較高側）：$${input.reconciliation.truthTotalUsd.toFixed(6)}`);
  push("");

  push("## 模態拆解（Category）");
  push(csvLine(["Category", "Label", "Calls", "Success", "Failed", "CostUsd", "AvgCostPerCall", "Share%"]));
  for (const c of input.byCategory) {
    push(
      csvLine([
        c.category,
        c.label,
        c.callCount,
        c.successCount,
        c.failedCount,
        c.costUsd,
        c.avgCostPerCall,
        c.share,
      ])
    );
  }
  push("");

  push("## 功能模組拆解（Feature）");
  push(csvLine(["Feature", "Calls", "CostUsd", "Share%", "TopEndpoint"]));
  for (const f of input.byFeature) {
    push(csvLine([f.feature, f.callCount, f.costUsd, f.share, f.topEndpoint ?? ""]));
  }
  push("");

  push("## 狀態拆解（Status）");
  push(csvLine(["Status", "Calls", "CostUsd", "Share%"]));
  for (const s of input.byStatus) {
    push(csvLine([s.status, s.callCount, s.costUsd, s.share]));
  }
  push(
    `# 浪費於失敗呼叫：$${input.waste.wastedUsd.toFixed(6)}（${input.waste.wastedCalls} 次，${input.waste.wastedShare}%）`
  );
  push("");

  push("## Top 端點");
  push(csvLine(["Provider", "Endpoint", "Category", "Calls", "CostUsd", "AvgCostPerCall", "ErrorRate%"]));
  for (const e of input.topEndpoints) {
    push(
      csvLine([
        e.provider,
        e.endpoint,
        e.category,
        e.callCount,
        e.costUsd,
        e.avgCostPerCall,
        e.errorRate,
      ])
    );
  }
  push("");

  push("## Top 使用者");
  push(csvLine(["UserId", "Calls", "CostUsd", "AvgCostPerCall", "TopEndpoint"]));
  for (const u of input.topUsers) {
    push(csvLine([u.userId, u.callCount, u.costUsd, u.avgCostPerCall, u.topEndpoint ?? ""]));
  }
  push("");

  push("## Catalog 預估 vs 實際");
  push(csvLine(["Endpoint", "Calls", "ExpectedUsd", "ActualUsd", "DeltaUsd", "DeltaPct%"]));
  for (const c of input.catalogVsActual) {
    push(
      csvLine([
        c.endpoint,
        c.callCount,
        c.expectedUsd,
        c.actualUsd,
        c.deltaUsd,
        c.deltaPct ?? "",
      ])
    );
  }
  push("");

  push("## 重試鏈");
  push(csvLine(["StartedAt", "UserId", "Endpoint", "Attempts", "TotalCostUsd", "WindowSec", "FinalStatus"]));
  for (const r of input.retryChains) {
    push(
      csvLine([
        r.startedAt,
        r.userId,
        r.endpoint,
        r.attempts,
        r.totalCostUsd,
        r.windowSec,
        r.finalStatus,
      ])
    );
  }
  push("");

  push("## 節費建議");
  push(
    csvLine([
      "Endpoint",
      "Category",
      "Calls",
      "CurrentCostUsd",
      "SuggestedEndpoint",
      "SuggestedCostUsd",
      "MonthlySavingsUsd",
      "SavingsPct",
      "Risk",
    ])
  );
  for (const s of input.savingsSuggestions) {
    push(
      csvLine([
        s.endpoint,
        s.category,
        s.callCount,
        s.currentCostUsd,
        s.suggestedEndpoint,
        s.suggestedCostUsd,
        s.monthlySavingsUsd,
        s.savingsPct,
        s.riskNote,
      ])
    );
  }
  push("");

  push("## 單次呼叫成本分佈");
  push(csvLine(["Metric", "Usd"]));
  push(csvLine(["sampleCount", input.costDistribution.sampleCount]));
  push(csvLine(["p50", input.costDistribution.p50Usd]));
  push(csvLine(["p90", input.costDistribution.p90Usd]));
  push(csvLine(["p95", input.costDistribution.p95Usd]));
  push(csvLine(["p99", input.costDistribution.p99Usd]));
  push(csvLine(["max", input.costDistribution.maxUsd]));
  push("");

  push("## 月底投影");
  push(csvLine(["Metric", "Value"]));
  push(csvLine(["daysElapsed", input.projection.daysElapsed]));
  push(csvLine(["daysInMonth", input.projection.daysInMonth]));
  push(csvLine(["monthToDateUsd", input.projection.monthToDateUsd]));
  push(csvLine(["averageDailyUsd", input.projection.averageDailyUsd]));
  push(csvLine(["projectedMonthEndUsd", input.projection.projectedMonthEndUsd]));
  push(csvLine(["remainingDays", input.projection.remainingDays]));

  return lines.join("\n");
}
