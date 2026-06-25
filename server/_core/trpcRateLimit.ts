/**
 * trpcRateLimit.ts — AIDV-211
 *
 * In-memory sliding-window per-user rate limiter for tRPC procedures.
 * No Redis dependency — sufficient for single-process Railway deploy.
 * Skips in test environment to match the express-rate-limit skip pattern.
 */

import { TRPCError } from "@trpc/server";

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
 */
export function checkTrpcRateLimit(
  userId: number,
  opts: { limit: number; windowMs: number; label: string }
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
