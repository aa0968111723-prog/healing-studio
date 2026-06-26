/**
 * rateLimiter.ts — Tiered rate limiting middleware
 *
 * Provides per-IP and per-user rate limiting with different limits for
 * different endpoint tiers. Built on top of express-rate-limit (already
 * a project dependency) with a custom in-memory store that supports
 * per-user keying via JWT context.
 *
 * Tiers:
 *   auth      — Login / registration endpoints (strict: 10 req / 15 min)
 *   llm       — LLM / AI generation endpoints (moderate: 60 req / 15 min)
 *   api       — General API endpoints (relaxed: 300 req / 15 min)
 *   upload    — File upload endpoints (strict: 20 req / 15 min)
 *   health    — Health check endpoints (unlimited)
 *
 * Graceful degradation:
 *   When a user is rate-limited, the response includes Retry-After and
 *   X-RateLimit-* headers so clients can back off gracefully.
 *
 * Usage:
 *   import { rateLimiters } from "./_core/rateLimiter";
 *   app.use("/api/trpc/llm", rateLimiters.llm);
 *   app.use("/api/auth", rateLimiters.auth);
 */

import rateLimit, { ipKeyGenerator, type Options as RateLimitOptions } from "express-rate-limit";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { logger } from "./logger";
import { getRedisClient, isRedisConfigured } from "./redisClient";
import { RedisRateLimitStore } from "./redisRateLimitStore";
import { serverEnv } from "./env.validated";

// ─── Types ─────────────────────────────────────────────────────────────────

export type RateLimitTier = "auth" | "llm" | "api" | "upload" | "health" | "proxyDownload";

export interface TierConfig {
  /** Rolling window duration in milliseconds */
  windowMs: number;
  /** Maximum requests per window per key */
  max: number;
  /** Human-readable description for logging */
  description: string;
}

// ─── Tier Configurations ───────────────────────────────────────────────────

const TIER_CONFIGS: Record<RateLimitTier, TierConfig> = {
  auth: {
    windowMs: 15 * 60 * 1_000, // 15 minutes
    max: 10,
    description: "Auth endpoints (login/register)",
  },
  llm: {
    windowMs: 15 * 60 * 1_000, // 15 minutes
    max: 60,
    description: "LLM / AI generation endpoints",
  },
  api: {
    windowMs: 15 * 60 * 1_000, // 15 minutes
    max: 300,
    description: "General API endpoints",
  },
  upload: {
    windowMs: 15 * 60 * 1_000, // 15 minutes
    max: 20,
    description: "File upload endpoints",
  },
  health: {
    windowMs: 60 * 1_000, // 1 minute
    max: 120,
    description: "Health check endpoints",
  },
  proxyDownload: {
    windowMs: 15 * 60 * 1_000, // 15 minutes
    max: 30,
    description: "Proxy-download endpoint (bandwidth cost per hit)",
  },
};

// ─── Key Generator ─────────────────────────────────────────────────────────

/**
 * Generate a rate-limit key that combines IP address with user ID when
 * available. This prevents a single authenticated user from exhausting
 * the shared IP quota (e.g. behind a corporate NAT).
 *
 * Key format:
 *   Authenticated : "user:<userId>"
 *   Anonymous     : "ip:<ipAddress>"
 */
function buildRateLimitKey(req: Request): string {
  // Attempt to extract user ID from the request context.
  // The tRPC context attaches `user` to req after authentication.
  const userId = (req as Request & { user?: { id?: number } }).user?.id;
  if (userId) return `user:${userId}`;

  // Fall back to IP address — use ipKeyGenerator to properly handle IPv6 addresses
  const ip = ipKeyGenerator(req.ip ?? "unknown");
  return `ip:${ip}`;
}

// ─── Redis Store Factory ───────────────────────────────────────────────────

/**
 * Build a Redis-backed store for express-rate-limit when REDIS_URL is set.
 * Returns undefined when Redis is not configured; the caller falls back to
 * express-rate-limit's built-in MemoryStore.
 *
 * Key prefix: `<REDIS_KEY_PREFIX>rl:<tier>:` (e.g. "healing-studio:rl:auth:")
 * This namespaces per-tier counters and avoids collisions with the
 * generation-lock keys already in Redis.
 */
function buildRedisStore(tier: RateLimitTier): RedisRateLimitStore | undefined {
  if (!isRedisConfigured()) return undefined;
  const client = getRedisClient();
  if (!client) return undefined;
  const prefix = `${serverEnv.REDIS_KEY_PREFIX}rl:${tier}:`;
  return new RedisRateLimitStore(client, prefix);
}

// ─── Rate Limit Factory ────────────────────────────────────────────────────

function createTierLimiter(tier: RateLimitTier): RequestHandler {
  const config = TIER_CONFIGS[tier];

  const redisStore = buildRedisStore(tier);

  const options: Partial<RateLimitOptions> = {
    windowMs: config.windowMs,
    max: config.max,
    standardHeaders: true,   // Return RateLimit-* headers (RFC 6585)
    legacyHeaders: false,     // Disable X-RateLimit-* legacy headers
    keyGenerator: buildRateLimitKey,
    ...(redisStore ? { store: redisStore } : {}),
    handler: (req: Request, res: Response) => {
      const key = buildRateLimitKey(req);
      logger.warn("[RateLimit] Request blocked", {
        tier,
        key,
        path: req.originalUrl,
        method: req.method,
        ip: req.ip,
      });

      res.status(429).json({
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: `Too many requests. Please wait ${Math.ceil(config.windowMs / 60_000)} minutes before retrying.`,
          tier,
          retryAfterSeconds: Math.ceil(config.windowMs / 1_000),
        },
      });
    },
    skip: (req: Request) => {
      // Always allow health checks from Railway's internal network
      if (tier === "health") return false;
      // Skip rate limiting in test environments
      if (process.env.NODE_ENV === "test") return true;
      return false;
    },
  };

  return rateLimit(options);
}

// ─── Per-User Rate Limiter (stricter, for LLM endpoints) ──────────────────

/**
 * A stricter per-user limiter for LLM endpoints that enforces a lower
 * limit for authenticated users to prevent individual abuse while
 * keeping the shared IP limit higher for anonymous users.
 *
 * Authenticated users: 30 LLM calls / 15 min
 * Anonymous (IP-based): 10 LLM calls / 15 min
 */
function createUserAwareLlmLimiter(): RequestHandler {
  const authenticatedLimiter = rateLimit({
    windowMs: 15 * 60 * 1_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const userId = (req as Request & { user?: { id?: number } }).user?.id;
      if (userId) return `llm-user:${userId}`;
      // express-rate-limit's validator requires ipKeyGenerator for IPv6 safety
      return `llm-ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
    },
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        success: false,
        error: {
          code: "LLM_RATE_LIMITED",
          message: "LLM request limit reached. Please wait before sending more AI requests.",
          retryAfterSeconds: 900,
        },
      });
    },
    skip: () => process.env.NODE_ENV === "test",
  });

  return authenticatedLimiter;
}

// ─── Graceful Degradation Middleware ──────────────────────────────────────

/**
 * Middleware that adds rate-limit context headers to all responses,
 * enabling clients to implement proactive back-off before hitting limits.
 */
export function rateLimitContextMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  // Attach a helper that downstream handlers can call to signal degraded mode
  (res as Response & { degraded?: (reason: string) => void }).degraded = (reason: string) => {
    res.setHeader("X-Degraded-Mode", "true");
    res.setHeader("X-Degraded-Reason", reason);
    logger.warn("[RateLimit] Degraded mode activated", { reason, path: _req.originalUrl });
  };
  next();
}

// ─── Per-User Chat Rate Limiter (in-process, tRPC-layer) ─────────────────────
//
// express-rate-limit runs before tRPC auth, so req.user is unavailable at the
// Express middleware layer for tRPC routes. This in-process bucket gives a true
// per-user 20 RPM guard on ai.chat — call tryConsumeChatToken inside the
// mutation handler, after brainProcedure has verified ctx.user.

const _chatRateLimitStore = new Map<number, { count: number; resetAt: number }>();

export const CHAT_RATE_LIMIT_MAX = 20;          // requests per window
export const CHAT_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

/**
 * Consume one token from the caller's per-user chat bucket.
 * Returns true when the request should proceed, false when it should be
 * rejected (429). Test environments always return true.
 */
export function tryConsumeChatToken(userId: number): boolean {
  if (process.env.NODE_ENV === "test") return true;
  const now = Date.now();
  const entry = _chatRateLimitStore.get(userId);
  if (!entry || now >= entry.resetAt) {
    _chatRateLimitStore.set(userId, { count: 1, resetAt: now + CHAT_RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= CHAT_RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ─── Singleton Exports ─────────────────────────────────────────────────────

export const rateLimiters = {
  /** Strict limiter for auth endpoints (10 req / 15 min) */
  auth: createTierLimiter("auth"),
  /** Moderate limiter for LLM/AI endpoints (60 req / 15 min) */
  llm: createTierLimiter("llm"),
  /** Per-user LLM limiter (30 req / 15 min per user) */
  llmPerUser: createUserAwareLlmLimiter(),
  /** Relaxed limiter for general API endpoints (300 req / 15 min) */
  api: createTierLimiter("api"),
  /** Strict limiter for file upload endpoints (20 req / 15 min) */
  upload: createTierLimiter("upload"),
  /** Lenient limiter for health check endpoints (120 req / min) */
  health: createTierLimiter("health"),
  /** Strict limiter for proxy-download endpoint (30 req / 15 min) */
  proxyDownload: createTierLimiter("proxyDownload"),
} as const;

export { TIER_CONFIGS, buildRateLimitKey };
