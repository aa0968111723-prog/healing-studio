/**
 * trpcRateLimit.ts — AIDV-211 / AIDV-292 / AIDV-354
 *
 * In-memory sliding-window per-user rate limiter for tRPC procedures.
 * No Redis dependency — sufficient for single-process Railway deploy.
 * Skips in test environment to match the express-rate-limit skip pattern.
 * Sets Retry-After HTTP header (RFC 6585) on the response when available.
 *
 * AIDV-354: checkAgentRateLimit — limits per-user agent-originated mutations
 * (X-Agent-Id header present) to prevent a single creator's agents from
 * exhausting shared LLM capacity. Human calls pass through unchecked.
 */

import { TRPCError } from "@trpc/server";
import type { Response } from "express";

interface WindowEntry {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowEntry>();

/** Exported only for tests — clears all window state between tests. */
export function _resetWindowsForTest(): void {
  windows.clear();
}

/**
 * Check (and increment) a per-user sliding-window counter.
 * Throws TRPCError(TOO_MANY_REQUESTS) if the user exceeds `limit` within `windowMs`.
 * label keeps separate buckets for different endpoint groups (e.g. "aichat" vs "gen").
 * Pass `res` to also set the RFC 6585 Retry-After HTTP header on the response.
 */
export function checkTrpcRateLimit(
  userId: number,
  opts: { limit: number; windowMs: number; label: string },
  res?: Response
): void {
  if (process.env.NODE_ENV === "test") return;

  const now = Date.now();
  const key = `${opts.label}:u${userId}`;
  const entry = windows.get(key);

  if (!entry || now >= entry.resetAt) {
    windows.set(key, { count: 1, resetAt: now + opts.windowMs });
    return;
  }

  entry.count += 1;
  if (entry.count > opts.limit) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    res?.setHeader("Retry-After", String(retryAfterSec));
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `速率超限，請 ${retryAfterSec} 秒後重試。`,
    });
  }
}

// Periodically evict expired entries so the Map doesn't grow unbounded.
// Runs every 5 minutes; negligible cost (iterates only expired entries).
if (process.env.NODE_ENV !== "test") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows) {
      if (now >= entry.resetAt) windows.delete(key);
    }
  }, 5 * 60 * 1000).unref();
}

// ─── Agent Call Rate Limiter (AIDV-354) ──────────────────────────────────────
//
// Only activates when the X-Agent-Id request header is present (agent call).
// Human-triggered mutations are never counted against this quota.

/** Max agent-originated mutations per hour per user. Override via AGENT_RATE_LIMIT_MAX env var. */
export const AGENT_RATE_LIMIT_MAX = parseInt(process.env.AGENT_RATE_LIMIT_MAX ?? "20", 10);

/** Sliding-window size for agent rate limiting: 1 hour. */
export const AGENT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1_000;

const agentWindows = new Map<number, WindowEntry>();

/** Exported only for tests — clears agent window state between tests. */
export function _resetAgentWindowsForTest(): void {
  agentWindows.clear();
}

/**
 * Returns the current agent-call quota for a user without incrementing the counter.
 * Used by the videoProject.agentQuota query to power the frontend quota bar.
 */
export function getAgentQuota(userId: number): {
  used: number;
  max: number;
  resetAt: number | null;
} {
  const entry = agentWindows.get(userId);
  const now = Date.now();
  if (!entry || now >= entry.resetAt) {
    return { used: 0, max: AGENT_RATE_LIMIT_MAX, resetAt: null };
  }
  return { used: entry.count, max: AGENT_RATE_LIMIT_MAX, resetAt: entry.resetAt };
}

/**
 * Check (and increment) the per-user agent call rate limit.
 *
 * Only activates when the X-Agent-Id request header is present. Non-agent
 * mutations are not counted. Throws TRPCError(TOO_MANY_REQUESTS) when the
 * per-hour limit is exceeded. Sets RFC 6585 Retry-After + RateLimit-*
 * headers on the Express response when provided.
 *
 * No-ops in test environment or when ENABLE_RATE_LIMIT=false.
 */
export function checkAgentRateLimit(
  userId: number,
  req?: { headers?: Record<string, string | string[] | undefined> },
  res?: Response
): void {
  if (process.env.NODE_ENV === "test") return;
  if (process.env.ENABLE_RATE_LIMIT === "false") return;

  // Only count agent-originated calls.
  if (!req?.headers?.["x-agent-id"]) return;

  const now = Date.now();
  const entry = agentWindows.get(userId);

  if (!entry || now >= entry.resetAt) {
    const resetAt = now + AGENT_RATE_LIMIT_WINDOW_MS;
    agentWindows.set(userId, { count: 1, resetAt });
    if (res) {
      res.setHeader("RateLimit-Remaining", String(AGENT_RATE_LIMIT_MAX - 1));
      res.setHeader("RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
    }
    return;
  }

  entry.count += 1;
  const remaining = AGENT_RATE_LIMIT_MAX - entry.count;

  if (remaining < 0) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    if (res) {
      res.setHeader("Retry-After", String(retryAfterSec));
      res.setHeader("RateLimit-Remaining", "0");
      res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
    }
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `本小時代理呼叫額度已用完（上限 ${AGENT_RATE_LIMIT_MAX} 次），請 ${Math.ceil(retryAfterSec / 60)} 分鐘後重試。`,
    });
  }

  if (res) {
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
  }
}

// Periodically evict expired agent entries.
if (process.env.NODE_ENV !== "test") {
  setInterval(() => {
    const now = Date.now();
    for (const [userId, entry] of agentWindows) {
      if (now >= entry.resetAt) agentWindows.delete(userId);
    }
  }, 5 * 60 * 1_000).unref();
}
