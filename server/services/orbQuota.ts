export interface OrbQuotaContext {
  userId: number;
  sessionId?: string;
  providerId?: string;
  retryCount?: number;
}

export type OrbQuotaCategory =
  | "planner"
  | "generation"
  | "multimodal_analysis"
  | "code_task"
  | "rapid_click"
  | "provider_rate"
  | "task_retry";

export interface OrbQuotaResult {
  allowed: boolean;
  reason?: string;
  category: OrbQuotaCategory;
}

const userDailyCounters = new Map<string, number>();
const sessionClicks = new Map<string, number[]>();
const providerRateCounters = new Map<string, number[]>();

const DAILY_LIMITS: Record<string, number> = {
  planner: 200,
  generation: 40,
  multimodal_analysis: 30,
  code_task: 12,
};

function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function key(userId: number, category: string) {
  return `${userId}:${dayKey()}:${category}`;
}

function pruneWindow(values: number[], windowMs: number) {
  const cutoff = Date.now() - windowMs;
  while (values.length && values[0] < cutoff) values.shift();
}

// Evict stale entries so the Maps don't grow unbounded across days / sessions.
// Runs every 5 minutes; .unref() lets the process exit without waiting for it.
if (process.env.NODE_ENV !== "test") {
  setInterval(() => {
    const today = dayKey();
    // userDailyCounters key format: `${userId}:${YYYY-MM-DD}:${category}`
    for (const k of userDailyCounters.keys()) {
      if (k.split(":")[1] !== today) userDailyCounters.delete(k);
    }
    for (const [k, v] of sessionClicks) {
      pruneWindow(v, 10_000);
      if (!v.length) sessionClicks.delete(k);
    }
    for (const [k, v] of providerRateCounters) {
      pruneWindow(v, 60_000);
      if (!v.length) providerRateCounters.delete(k);
    }
  }, 5 * 60 * 1000).unref();
}

export function checkAndConsumeQuota(category: OrbQuotaCategory, ctx: OrbQuotaContext): OrbQuotaResult {
  if (category === "task_retry") {
    if ((ctx.retryCount ?? 0) > 1) {
      return { allowed: false, reason: "retry_limit_exceeded", category };
    }
    return { allowed: true, category };
  }

  if (category === "rapid_click") {
    const sessionKey = ctx.sessionId ?? `user:${ctx.userId}`;
    const clicks = sessionClicks.get(sessionKey) ?? [];
    clicks.push(Date.now());
    pruneWindow(clicks, 10_000);
    sessionClicks.set(sessionKey, clicks);
    if (clicks.length > 6) {
      return { allowed: false, reason: "rapid_click_throttle", category };
    }
    return { allowed: true, category };
  }

  if (category === "provider_rate") {
    const provider = ctx.providerId ?? "unknown";
    const bucket = providerRateCounters.get(provider) ?? [];
    bucket.push(Date.now());
    pruneWindow(bucket, 60_000);
    providerRateCounters.set(provider, bucket);
    if (bucket.length > 120) {
      return { allowed: false, reason: "provider_rate_limited", category };
    }
    return { allowed: true, category };
  }

  const limit = DAILY_LIMITS[category];
  if (!limit) return { allowed: true, category };
  const counterKey = key(ctx.userId, category);
  const next = (userDailyCounters.get(counterKey) ?? 0) + 1;
  if (next > limit) {
    return { allowed: false, reason: `daily_${category}_quota_exceeded`, category };
  }
  userDailyCounters.set(counterKey, next);
  return { allowed: true, category };
}

export function __unsafe_resetOrbQuotaForTests() {
  userDailyCounters.clear();
  sessionClicks.clear();
  providerRateCounters.clear();
}

export interface OrbQuotaCategorySnapshot {
  category: keyof typeof DAILY_LIMITS;
  used: number;
  limit: number;
  remaining: number;
}

export interface OrbQuotaSnapshot {
  userId: number;
  dayKey: string;
  categories: OrbQuotaCategorySnapshot[];
}

/**
 * Read-only snapshot of remaining daily quotas for a user. Used by the
 * 全站光球代理 planner so it can budget its plan into stages instead of
 * proposing more generation steps than the day allows.
 */
export function getOrbQuotaSnapshot(userId: number): OrbQuotaSnapshot {
  const day = dayKey();
  const categories: OrbQuotaCategorySnapshot[] = (
    Object.keys(DAILY_LIMITS) as Array<keyof typeof DAILY_LIMITS>
  ).map(category => {
    const used = userDailyCounters.get(`${userId}:${day}:${category}`) ?? 0;
    const limit = DAILY_LIMITS[category];
    return {
      category,
      used,
      limit,
      remaining: Math.max(0, limit - used),
    };
  });
  return { userId, dayKey: day, categories };
}

/**
 * Compact human-readable summary used by the planner system prompt. Lists
 * each category as `category: remaining/limit (used N)` so the LLM can plan
 * around the cap.
 */
export function summarizeOrbQuotaForPlanner(snapshot: OrbQuotaSnapshot): string {
  if (!snapshot.categories.length) return "未取得配額資料。";
  const parts = snapshot.categories.map(
    entry =>
      `${entry.category}: 剩餘 ${entry.remaining}/${entry.limit}（今日已用 ${entry.used}）`
  );
  return `今日剩餘配額（${snapshot.dayKey}）：\n${parts.join("\n")}`;
}
