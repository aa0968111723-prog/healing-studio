/**
 * costAnalytics.ts — 站台呼叫成本深度分析輔助函式
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 提供 admin 後台「深度成本」面板所需的純資料計算邏輯：
 *
 *   - categorizeEndpoint：將 endpoint 對應到 MODEL_PRICING_CATALOG 內的 category
 *   - summarizeByCategory：依模態（LLM / 圖片 / 影片 / TTS …）彙總呼叫數與費用
 *   - summarizeByEndpoint / summarizeByUser：Top-N 端點 / 使用者
 *   - summarizeByStatus：成功 / 失敗 / 逾時 / 速率受限的成本拆解
 *   - latencyStats：延遲統計（avg / p50 / p95 / p99）
 *   - hourlyHeatmap：7 × 24 小時熱力圖
 *   - calculateWasteCost：浪費於失敗呼叫的金額
 *   - projectMonthlyCost：依日均成本估算當月底的最終費用
 *   - compareCatalogVsActual：對比 catalog 預估價與實際扣款，揪出成本漂移
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
