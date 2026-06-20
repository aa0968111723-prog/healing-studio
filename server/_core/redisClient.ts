/**
 * redisClient.ts — Shared ioredis client (lazy singleton)
 *
 * Purpose
 * ───────
 * The project historically had **no** Redis client wired: cache.ts and
 * rateLimiter.ts are pure in-memory, and REDIS_URL was declared in env but never
 * instantiated. This module fills that gap with a single shared ioredis client,
 * built once from `serverEnv.REDIS_URL`. It is intentionally minimal and
 * dependency-light so other in-memory subsystems (cache / rate limiter) can be
 * upgraded onto the same client later — but for now its only consumer is the
 * generation dedup lock (see redisGenerationLockStore.ts).
 *
 * Availability-first by design (the lock that uses it is fail-open)
 * ────────────────────────────────────────────────────────────────
 *   - `REDIS_URL` unset / empty  → `getRedisClient()` returns `null`. Consumers
 *     fall back to their in-memory backend. This is the single-instance / demo
 *     path and the default everywhere REDIS_URL is not provided.
 *   - `REDIS_URL` set but Redis unreachable → the client is still returned, but
 *     every command rejects fast (offline queue disabled). The lock layer treats
 *     a rejected command as "backend unavailable" and **fails open** (allows the
 *     operation). A misconfigured / down Redis therefore degrades dedup to
 *     best-effort; it can NEVER block a user or crash the process.
 *
 * Why these options
 * ─────────────────
 *   - `enableOfflineQueue: false` — when not connected, commands reject
 *     immediately instead of buffering. We want the lock to fail open quickly,
 *     not wait on a queue that may never drain. (Availability > dedup.)
 *   - `maxRetriesPerRequest: 1` — a single command never retries across multiple
 *     reconnects; it surfaces an error fast so the caller can fail open.
 *   - `retryStrategy` — the *connection* keeps reconnecting with capped backoff
 *     so the client auto-heals when Redis comes back (separate from per-command
 *     retries above).
 *   - an `error` listener is attached **immediately** so an unreachable Redis
 *     emits a handled event rather than crashing Node with an unhandled `error`.
 *
 * No secrets in code: REDIS_URL is read from the validated env only (set in
 * Railway). This module never logs the URL.
 */

import { Redis, type RedisOptions } from "ioredis";
import { logger } from "./logger";
import { serverEnv } from "./env.validated";

/** Public type alias so consumers don't import ioredis directly. */
export type RedisClient = Redis;

// ─── Singleton state ─────────────────────────────────────────────────────────

let client: Redis | null = null;
let initialized = false;
/** Throttle reconnect-error logging so a sustained outage doesn't flood logs. */
let lastErrorLogAt = 0;
const ERROR_LOG_THROTTLE_MS = 30_000;

/** Whether a non-empty REDIS_URL is configured (i.e. we should use Redis). */
export function isRedisConfigured(): boolean {
  return serverEnv.REDIS_URL.trim().length > 0;
}

function buildOptions(): RedisOptions {
  return {
    // Reject commands immediately when not connected → caller fails open fast.
    enableOfflineQueue: false,
    // A single command must not retry across reconnects; surface the error fast.
    maxRetriesPerRequest: 1,
    // Bound the initial connect so boot never hangs on an unreachable Redis.
    connectTimeout: 3_000,
    // Keep the *connection* reconnecting (capped backoff) so it auto-heals.
    // Returning a number = retry after that many ms; never give up.
    retryStrategy: (times: number) => Math.min(times * 200, 2_000),
    // Re-establish the connection after a failover-style READONLY error.
    reconnectOnError: (err: Error) => /READONLY/.test(err.message),
    // Don't spam connection attempts in the foreground at boot.
    lazyConnect: false,
  };
}

/**
 * Get the shared Redis client, or `null` when REDIS_URL is not configured.
 *
 * Lazily constructs the client on first call and memoizes it. Construction is
 * cheap and never throws on an unreachable host — connection happens in the
 * background and errors are handled via the attached `error` listener.
 */
export function getRedisClient(): RedisClient | null {
  if (initialized) return client;
  initialized = true;

  if (!isRedisConfigured()) {
    client = null;
    return null;
  }

  try {
    const c = new Redis(serverEnv.REDIS_URL, buildOptions());

    // MUST be attached before any error can fire — otherwise an unreachable
    // Redis emits an unhandled 'error' event and crashes the process.
    c.on("error", (err: Error) => {
      const now = Date.now();
      if (now - lastErrorLogAt >= ERROR_LOG_THROTTLE_MS) {
        lastErrorLogAt = now;
        logger.warn("[Redis] client error (degrading to fail-open until reconnect)", {
          err: err.message,
        });
      }
    });
    c.on("ready", () => {
      logger.info("[Redis] connection ready");
    });
    c.on("end", () => {
      logger.warn("[Redis] connection closed");
    });

    client = c;
    return client;
  } catch (err) {
    // Construction itself failing (e.g. malformed URL) must not crash boot —
    // treat as "no Redis" so consumers use their in-memory fallback.
    logger.warn("[Redis] failed to construct client, falling back to in-memory", {
      err: err instanceof Error ? err.message : String(err),
    });
    client = null;
    return null;
  }
}

/**
 * Gracefully close the shared client (called during server shutdown). Safe to
 * call when no client exists. Uses `quit()` (waits for pending replies) with a
 * `disconnect()` fallback so shutdown never hangs.
 */
export async function closeRedis(): Promise<void> {
  if (!client) return;
  const c = client;
  client = null;
  initialized = false;
  try {
    await c.quit();
  } catch {
    try {
      c.disconnect();
    } catch {
      /* already gone */
    }
  }
}

/** Test-only: reset the memoized singleton so a fresh client is built next call. */
export function _resetRedisClientForTest(): void {
  client = null;
  initialized = false;
  lastErrorLogAt = 0;
}
