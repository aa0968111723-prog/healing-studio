/**
 * perplexityThrottle.ts — Perplexity 統一開關 + 節流
 *
 * 集中管理「全站每一個會打 Perplexity API 的入口」的：
 *   1. 主 / 子開關（env: ENABLE_PERPLEXITY*）
 *   2. Per-user 每小時 / 每日次數上限
 *   3. 全站每分鐘總上限
 *
 * 為什麼集中：Perplexity 會出現在五個地方（director research、
 * inspiration.fetch、webSearch native、newsFetcher fallback、
 * braveLearnFetcher fallback）。若散落各處的 throttle，營運時要調整
 * 上限就要改 5 個檔案。集中之後改 env 就生效。
 *
 * 設計：
 *   - In-memory rolling window（與 server/_core/llmRouter.ts 的 circuit
 *     breaker、orbQuota 同模式，零外部依賴）
 *   - 失敗時回 reason 讓呼叫端決定要 fallback 還是直接回錯
 *   - exposeStatus() 給 admin / UI 看當前可用配額
 */

import { serverEnv } from "../_core/env.validated";

export type PerplexityFeature =
  | "director_research"
  | "inspiration"
  | "web_search"
  | "news_fallback"
  | "learn_fallback";

export type ThrottleDenyReason =
  | "feature_disabled"
  | "user_hour_limit"
  | "user_day_limit"
  | "global_minute_limit"
  | "no_api_key";

export interface ThrottleCheckInput {
  feature: PerplexityFeature;
  /** Cron / 系統呼叫填 null（只受全站節流限制，user 配額不算） */
  userId: number | null;
}

export interface ThrottleCheckResult {
  allowed: boolean;
  reason?: ThrottleDenyReason;
  /** 拒絕時：建議多少秒後再試（給 UI 顯示「30 秒後再來」） */
  retryAfterSec?: number;
  /** debug 用：套用的限制值（0 = 不限制） */
  limits: {
    perUserPerHour: number;
    perUserPerDay: number;
    globalPerMinute: number;
  };
}

// ─── 環境變數讀取（lazy；測試可重設 process.env 後立即生效） ─────────────────

function flagOn(value: string | undefined, defaultEnabled = true): boolean {
  if (value === undefined || value === null || value.trim() === "")
    return defaultEnabled;
  const normalized = value.trim().toLowerCase();
  return !["0", "false", "off", "no", "disabled"].includes(normalized);
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === null || value.trim() === "")
    return fallback;
  const n = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function isMasterEnabled(): boolean {
  return flagOn(
    process.env.ENABLE_PERPLEXITY ?? serverEnv.ENABLE_PERPLEXITY,
    true
  );
}

function isFeatureEnabled(feature: PerplexityFeature): boolean {
  if (!isMasterEnabled()) return false;
  switch (feature) {
    case "director_research":
      return flagOn(
        process.env.ENABLE_PERPLEXITY_DIRECTOR_RESEARCH ??
          serverEnv.ENABLE_PERPLEXITY_DIRECTOR_RESEARCH,
        true
      );
    case "inspiration":
      return flagOn(
        process.env.ENABLE_PERPLEXITY_INSPIRATION ??
          serverEnv.ENABLE_PERPLEXITY_INSPIRATION,
        true
      );
    case "web_search":
      return flagOn(
        process.env.ENABLE_PERPLEXITY_WEB_SEARCH ??
          serverEnv.ENABLE_PERPLEXITY_WEB_SEARCH,
        true
      );
    case "news_fallback":
      return flagOn(
        process.env.ENABLE_PERPLEXITY_NEWS_FALLBACK ??
          serverEnv.ENABLE_PERPLEXITY_NEWS_FALLBACK,
        true
      );
    case "learn_fallback":
      return flagOn(
        process.env.ENABLE_PERPLEXITY_LEARN_FALLBACK ??
          serverEnv.ENABLE_PERPLEXITY_LEARN_FALLBACK,
        true
      );
  }
}

function getLimits(): ThrottleCheckResult["limits"] {
  return {
    perUserPerHour: readPositiveInt(
      process.env.PERPLEXITY_PER_USER_PER_HOUR ??
        serverEnv.PERPLEXITY_PER_USER_PER_HOUR,
      30
    ),
    perUserPerDay: readPositiveInt(
      process.env.PERPLEXITY_PER_USER_PER_DAY ??
        serverEnv.PERPLEXITY_PER_USER_PER_DAY,
      100
    ),
    globalPerMinute: readPositiveInt(
      process.env.PERPLEXITY_GLOBAL_PER_MINUTE ??
        serverEnv.PERPLEXITY_GLOBAL_PER_MINUTE,
      60
    ),
  };
}

// ─── In-memory rolling counters ──────────────────────────────────────────────

// 每個 user 的時間戳陣列（毫秒）。最多保留 24 小時內的紀錄。
const userTimestamps = new Map<number, number[]>();
// 全站時間戳陣列（最多保留 1 分鐘）
const globalTimestamps: number[] = [];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60 * 1000;

function pruneBefore(arr: number[], cutoff: number): void {
  // arr 是 monotonic increasing；從頭砍掉早於 cutoff 的紀錄
  let removeCount = 0;
  while (removeCount < arr.length && arr[removeCount] < cutoff) {
    removeCount++;
  }
  if (removeCount > 0) arr.splice(0, removeCount);
}

function countInWindow(arr: number[], windowMs: number, now: number): number {
  const cutoff = now - windowMs;
  let count = 0;
  // arr 已 pruned，所以從尾巴往前數比較快（多數元素都會落在 window 內）
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] >= cutoff) count++;
    else break;
  }
  return count;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * 檢查是否允許打 Perplexity；不修改 counter。
 * 若 allowed=true，呼叫端必須在實際送出請求前 / 後呼叫 recordCall(...)
 * 來累計配額。
 */
export function checkPerplexityThrottle(
  input: ThrottleCheckInput
): ThrottleCheckResult {
  const limits = getLimits();
  const now = Date.now();

  if (!isFeatureEnabled(input.feature)) {
    return { allowed: false, reason: "feature_disabled", limits };
  }

  // 全站每分鐘
  if (limits.globalPerMinute > 0) {
    pruneBefore(globalTimestamps, now - MINUTE_MS);
    const count = countInWindow(globalTimestamps, MINUTE_MS, now);
    if (count >= limits.globalPerMinute) {
      const oldest = globalTimestamps[0] ?? now;
      const retryAfterSec = Math.max(
        1,
        Math.ceil((oldest + MINUTE_MS - now) / 1000)
      );
      return {
        allowed: false,
        reason: "global_minute_limit",
        retryAfterSec,
        limits,
      };
    }
  }

  // Per-user（cron / 系統呼叫 userId=null 時跳過）
  if (input.userId !== null) {
    const userArr = userTimestamps.get(input.userId) ?? [];
    pruneBefore(userArr, now - DAY_MS);
    if (limits.perUserPerDay > 0) {
      const dayCount = countInWindow(userArr, DAY_MS, now);
      if (dayCount >= limits.perUserPerDay) {
        const oldest = userArr[0] ?? now;
        return {
          allowed: false,
          reason: "user_day_limit",
          retryAfterSec: Math.max(
            1,
            Math.ceil((oldest + DAY_MS - now) / 1000)
          ),
          limits,
        };
      }
    }
    if (limits.perUserPerHour > 0) {
      const hourCount = countInWindow(userArr, HOUR_MS, now);
      if (hourCount >= limits.perUserPerHour) {
        // 找到一小時 window 內最早的一筆，作為 retry 推算基準
        const cutoff = now - HOUR_MS;
        const earliestInWindow =
          userArr.find(t => t >= cutoff) ?? now;
        return {
          allowed: false,
          reason: "user_hour_limit",
          retryAfterSec: Math.max(
            1,
            Math.ceil((earliestInWindow + HOUR_MS - now) / 1000)
          ),
          limits,
        };
      }
    }
    userTimestamps.set(input.userId, userArr); // 把 pruned 結果寫回
  }

  return { allowed: true, limits };
}

/**
 * 累計一次 Perplexity 呼叫（在實際送出 fetch 之前或之後都可以；建議成功
 * 後呼叫，避免錯誤呼叫吃配額）。
 */
export function recordPerplexityCall(input: ThrottleCheckInput): void {
  if (!isFeatureEnabled(input.feature)) return;
  const now = Date.now();
  globalTimestamps.push(now);
  pruneBefore(globalTimestamps, now - MINUTE_MS);
  if (input.userId !== null) {
    const userArr = userTimestamps.get(input.userId) ?? [];
    userArr.push(now);
    pruneBefore(userArr, now - DAY_MS);
    userTimestamps.set(input.userId, userArr);
  }
}

/** 一行式 helper：先 check，allowed 才 record，回傳 check 結果。 */
export function checkAndConsumePerplexity(
  input: ThrottleCheckInput
): ThrottleCheckResult {
  const check = checkPerplexityThrottle(input);
  if (check.allowed) recordPerplexityCall(input);
  return check;
}

/**
 * 給 admin / 使用者前端看當前配額剩餘量。不會改變 counter。
 * userId=null 時只回全站狀態。
 */
export function getPerplexityThrottleStatus(userId: number | null): {
  masterEnabled: boolean;
  features: Record<PerplexityFeature, boolean>;
  limits: ThrottleCheckResult["limits"];
  globalUsedLastMinute: number;
  user: {
    usedLastHour: number;
    usedLastDay: number;
    remainingHour: number;
    remainingDay: number;
  } | null;
} {
  const now = Date.now();
  const limits = getLimits();
  pruneBefore(globalTimestamps, now - MINUTE_MS);
  const status: ReturnType<typeof getPerplexityThrottleStatus> = {
    masterEnabled: isMasterEnabled(),
    features: {
      director_research: isFeatureEnabled("director_research"),
      inspiration: isFeatureEnabled("inspiration"),
      web_search: isFeatureEnabled("web_search"),
      news_fallback: isFeatureEnabled("news_fallback"),
      learn_fallback: isFeatureEnabled("learn_fallback"),
    },
    limits,
    globalUsedLastMinute: countInWindow(globalTimestamps, MINUTE_MS, now),
    user: null,
  };
  if (userId !== null) {
    const userArr = userTimestamps.get(userId) ?? [];
    pruneBefore(userArr, now - DAY_MS);
    userTimestamps.set(userId, userArr);
    const usedLastHour = countInWindow(userArr, HOUR_MS, now);
    const usedLastDay = countInWindow(userArr, DAY_MS, now);
    status.user = {
      usedLastHour,
      usedLastDay,
      remainingHour:
        limits.perUserPerHour > 0
          ? Math.max(0, limits.perUserPerHour - usedLastHour)
          : Number.POSITIVE_INFINITY,
      remainingDay:
        limits.perUserPerDay > 0
          ? Math.max(0, limits.perUserPerDay - usedLastDay)
          : Number.POSITIVE_INFINITY,
    };
  }
  return status;
}

/** 測試用：清空所有 counter。 */
export function resetPerplexityThrottleForTest(): void {
  userTimestamps.clear();
  globalTimestamps.length = 0;
}

/** 翻譯 deny reason → 給使用者看的繁中訊息（UI 用）。 */
export function describeThrottleReason(reason: ThrottleDenyReason): string {
  switch (reason) {
    case "feature_disabled":
      return "Perplexity 功能已被管理者關閉";
    case "user_hour_limit":
      return "你這個小時的 Perplexity 查詢已達上限，請稍後再試";
    case "user_day_limit":
      return "你今天的 Perplexity 查詢已達上限，請明天再試";
    case "global_minute_limit":
      return "全站 Perplexity 查詢過於頻繁，請稍後再試";
    case "no_api_key":
      return "PERPLEXITY_API_KEY 未設定";
  }
}
