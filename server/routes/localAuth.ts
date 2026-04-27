import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { ENV } from "../_core/env";
import { verifyToken } from "../middleware/verifyToken";
import { logger } from "../_core/logger";
import { AuthFacade, authFacade } from "../services/auth/AuthFacade";
import { loginHistoryService } from "../services/auth/loginHistoryService";

// ── Auth-specific rate limiters ────────────────────────────────────────────
// Stricter than the global /api/ limiter (300/15min).
// Login: 10 attempts per 15 min per IP to slow brute-force without blocking
// legitimate users who may retry after mistyping.
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

// Register: 5 attempts per 15 min per IP.
const registerRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many registration attempts. Please try again later." },
});

// How many recent per-email failures within the lockout window block the account
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 15;

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

function isStrongPassword(password: string): boolean {
  return (
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isAdminEmail(email: string): boolean {
  const hardcoded = ["aa0968111723@gmail.com"];
  const fromEnv = (ENV.adminEmails || "")
    .split(",")
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
  const allowList = new Set([...hardcoded, ...fromEnv]);
  return allowList.has(email.toLowerCase());
}

function getAccessTokenLifetimeMs(): number {
  const raw = ENV.jwtAccessTokenExpiresIn;
  const sec = Number(raw);
  if (!Number.isFinite(sec) || sec <= 0) return ONE_YEAR_MS;
  return Math.floor(sec * 1000);
}

/** Minimal contract for login history operations used by this router */
interface LoginHistoryGateway {
  getFailedAttemptsByEmail(email: string, withinMinutes: number): Promise<number>;
  recordLoginAttempt(attempt: { userId: number; email?: string; success: boolean; ipAddress?: string; userAgent?: string; failureReason?: string }): Promise<void>;
}

type LocalAuthDeps = {
  facade: AuthFacade;
  loginHistory?: LoginHistoryGateway;
};

export function createLocalAuthRouter(
  deps: LocalAuthDeps = {
    facade: authFacade,
  }
) {
  const history = deps.loginHistory ?? loginHistoryService;
  const router = Router();

  router.post("/api/auth/register", registerRateLimiter, async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({
          error: "Invalid register payload",
          details: parsed.error.flatten(),
        });
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    if (!isStrongPassword(parsed.data.password)) {
      res.status(400).json({
        error:
          "Password must include uppercase, lowercase, number, and symbol",
      });
      return;
    }

    try {
      const result = await deps.facade.registerWithPassword({
        email,
        password: parsed.data.password,
        name: parsed.data.name,
        role: isAdminEmail(email) ? "admin" : "user",
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, result.token, {
        ...cookieOptions,
        maxAge: getAccessTokenLifetimeMs(),
      });

      res.status(201).json({
        success: true,
        token: result.token,
        user: result.user,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "EMAIL_ALREADY_REGISTERED") {
        res.status(409).json({ error: "Email already registered" });
        return;
      }
      logger.error("[LocalAuth] register failed", { err: error, email });
      res.status(500).json({ error: "Register failed" });
    }
  });

  router.post("/api/auth/login", loginRateLimiter, async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid login payload", details: parsed.error.flatten() });
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    const ipAddress = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket.remoteAddress;
    const userAgent = req.headers["user-agent"];

    // ── Per-email brute-force check ──────────────────────────────────────
    // Query the login_history table for recent failures. If the DB is down
    // this call will throw; we catch and allow the request through so a DB
    // hiccup never locks out legitimate users.
    try {
      const recentFailures = await history.getFailedAttemptsByEmail(
        email,
        LOCKOUT_WINDOW_MINUTES
      );
      if (recentFailures >= MAX_FAILED_ATTEMPTS) {
        res.status(429).json({
          error: "Too many failed login attempts. Please try again later or reset your password.",
        });
        return;
      }
    } catch (err) {
      logger.warn("[LocalAuth] Could not check failed attempts (DB unavailable), proceeding", { err });
    }

    try {
      const result = await deps.facade.loginWithPassword({
        email,
        password: parsed.data.password,
      });

      // Record successful login — fire-and-forget so any DB hiccup never
      // blocks the login response or prevents the session cookie from being set.
      history.recordLoginAttempt({
        userId: result.userId,
        email,
        success: true,
        ipAddress,
        userAgent,
      }).catch(err => logger.error("[LocalAuth] Failed to record login history", { err }));

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, result.token, {
        ...cookieOptions,
        maxAge: getAccessTokenLifetimeMs(),
      });

      res.json({
        success: true,
        token: result.token,
        user: result.user,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_CREDENTIALS") {
        // Try to get userId from email for failed attempt logging
        try {
          const failedUser = await deps.facade.findUserByEmail(email);
          if (failedUser) {
            await history.recordLoginAttempt({
              userId: failedUser.id,
              email,
              success: false,
              ipAddress,
              userAgent,
              failureReason: "Invalid credentials",
            });
          }
        } catch (logError) {
          logger.error("[LocalAuth] Failed to log failed attempt", { err: logError });
        }

        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      logger.error("[LocalAuth] login failed", { err: error, email });
      res.status(500).json({ error: "Login failed" });
    }
  });

  router.get("/api/auth/me", verifyToken, async (req: Request, res: Response) => {
    const authReq = req as Request & {
      auth?: { sub: string; name: string; email?: string };
      user?: {
        id: number;
        openId: string;
        role: "user" | "admin";
        email: string | null;
        name: string | null;
      };
    };
    res.json({ user: authReq.user ?? authReq.auth ?? null });
  });

  return router;
}

export const localAuthRouter = createLocalAuthRouter();
