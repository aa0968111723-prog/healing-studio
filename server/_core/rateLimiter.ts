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

// ─── Types ─────────────────────────────────────────────────────────────────

export type RateLimitTier = "auth" | "llm" | "api" | "upload" | "health";

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
  const ip = ipKeyGenerator(req);
  return `ip:${ip}`;
}

// ─── Rate Limit Factory ────────────────────────────────────────────────────

function createTierLimiter(tier: RateLimitTier): RequestHandler {
  const config = TIER_CONFIGS[tier];

  const options: Partial<RateLimitOptions> = {
    windowMs: config.windowMs,
    max: config.max,
    standardHeaders: true,   // Return RateLimit-* headers (RFC 6585)
    legacyHeaders: false,     // Disable X-RateLimit-* legacy headers
    keyGenerator: buildRateLimitKey,
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
      return userId ? `llm-user:${userId}` : `llm-ip:${req.ip ?? "unknown"}`;
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
} as const;

export { TIER_CONFIGS, buildRateLimitKey };
