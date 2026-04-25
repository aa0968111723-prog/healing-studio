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
