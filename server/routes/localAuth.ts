import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS, type UserRole } from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { ENV } from "../_core/env";
import { verifyToken } from "../middleware/verifyToken";
import { logger } from "../_core/logger";
import { AuthFacade, authFacade } from "../services/auth/AuthFacade";
import { loginHistoryService } from "../services/auth/loginHistoryService";

// ── Auth-specific rate limiters ────────────────────────────────────────────
// Stricter than the global /api/ limiter (300/15min). Built per-router so that
// tests get fresh limiter state and so a future multi-instance setup can scope
// limits independently.
function buildLoginRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many login attempts. Please try again later." },
  });
}

function buildRegisterRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many registration attempts. Please try again later." },
  });
}

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
  totpToken: z.string().regex(/^\d{6}$/).optional(),
});

const twoFactorTokenSchema = z.object({
  token: z.string().regex(/^\d{6}$/),
});

/**
 * Heuristic: was this error caused by the DB being unavailable, the connection
 * pool refusing, a timeout, or a known mysql2/AppError DB code? Used to
 * surface a 503 with a retry-friendly errorCode rather than a generic 500
 * that the user reads as "the website is broken".
 */
function isDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const e = error as Error & {
    code?: string;
    errno?: number;
    errorCode?: string;
  };
  if (e.errorCode === "DATABASE_ERROR") return true;
  if (
    e.code === "ECONNREFUSED" ||
    e.code === "ETIMEDOUT" ||
    e.code === "PROTOCOL_CONNECTION_LOST" ||
    e.code === "ER_CON_COUNT_ERROR" ||
    e.code === "ER_ACCESS_DENIED_ERROR" ||
    e.code === "ENOTFOUND"
  ) return true;
  if (typeof e.code === "string" && e.code.startsWith("ER_")) return true;
  if (typeof e.message === "string" &&
      /database|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|connection lost|pool/i.test(e.message))
    return true;
  return false;
}

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
  const loginRateLimiter = buildLoginRateLimiter();
  const registerRateLimiter = buildRegisterRateLimiter();

  router.post("/api/auth/register", registerRateLimiter, async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const fieldErrors = flat.fieldErrors;
      // Surface a precise reason so the client can localize ("invalid email"
      // vs "password too short" vs unknown) instead of a generic 400.
      let code = "INVALID_PAYLOAD";
      if (fieldErrors.email?.length) code = "INVALID_EMAIL";
      else if (fieldErrors.password?.length) code = "PASSWORD_TOO_SHORT";
      res.status(400).json({
        error: "Invalid register payload",
        errorCode: code,
        details: flat,
      });
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    if (!isStrongPassword(parsed.data.password)) {
      res.status(400).json({
        error: "Password must include uppercase, lowercase, number, and symbol",
        errorCode: "PASSWORD_WEAK",
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
        // Signal whether this registration linked a password to a pre-existing
        // Google-only account (no new row) so the UI can show the right copy.
        linkedExisting: result.linkedExisting === true,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "EMAIL_ALREADY_REGISTERED") {
        res.status(409).json({
          error: "Email already registered",
          errorCode: "EMAIL_ALREADY_REGISTERED",
        });
        return;
      }
      // Database unavailable should not look identical to a programming bug —
      // tell the client so it can prompt a retry instead of "Register failed".
      const errCode = isDatabaseError(error) ? "DATABASE_UNAVAILABLE" : "REGISTER_FAILED";
      logger.error("[LocalAuth] register failed", { err: error, email, errCode });
      res.status(errCode === "DATABASE_UNAVAILABLE" ? 503 : 500).json({
        error: "Register failed",
        errorCode: errCode,
      });
    }
  });

  router.post("/api/auth/login", loginRateLimiter, async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      let code = "INVALID_PAYLOAD";
      if (flat.fieldErrors.email?.length) code = "INVALID_EMAIL";
      else if (flat.fieldErrors.password?.length) code = "PASSWORD_REQUIRED";
      else if (flat.fieldErrors.totpToken?.length) code = "INVALID_2FA_FORMAT";
      res.status(400).json({
        error: "Invalid login payload",
        errorCode: code,
        details: flat,
      });
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
          errorCode: "ACCOUNT_LOCKED",
          retryAfterMinutes: LOCKOUT_WINDOW_MINUTES,
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
        totpToken: parsed.data.totpToken,
      });

      // 2FA gate: password OK but TOTP code is required to finish login.
      if ("requiresTwoFactor" in result) {
        res.status(200).json({
          success: false,
          requiresTwoFactor: true,
        });
        return;
      }

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
      if (error instanceof Error && error.message === "INVALID_2FA_CODE") {
        res.status(401).json({
          error: "Invalid 2FA code",
          errorCode: "INVALID_2FA_CODE",
          requiresTwoFactor: true,
        });
        return;
      }
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

        res.status(401).json({
          error: "Invalid email or password",
          errorCode: "INVALID_CREDENTIALS",
        });
        return;
      }
      if (error instanceof Error && error.message === "OAUTH_ONLY_ACCOUNT") {
        // The email exists but only as a Google OAuth row — guide the user to
        // sign in with Google instead of letting them think their password
        // is wrong.
        res.status(409).json({
          error: "This account uses Google sign-in. Please log in with Google.",
          errorCode: "OAUTH_ONLY_ACCOUNT",
        });
        return;
      }
      const errCode = isDatabaseError(error) ? "DATABASE_UNAVAILABLE" : "LOGIN_FAILED";
      logger.error("[LocalAuth] login failed", { err: error, email, errCode });
      res.status(errCode === "DATABASE_UNAVAILABLE" ? 503 : 500).json({
        error: "Login failed",
        errorCode: errCode,
      });
    }
  });

  router.get("/api/auth/me", verifyToken, async (req: Request, res: Response) => {
    const authReq = req as Request & {
      auth?: { sub: string; name: string; email?: string };
      user?: {
        id: number;
        openId: string;
        role: UserRole;
        email: string | null;
        name: string | null;
      };
    };
    res.json({ user: authReq.user ?? authReq.auth ?? null });
  });

  // ── 2FA management (all require an authenticated session) ───────────────────
  type AuthedReq = Request & {
    user?: { id: number; openId: string; email: string | null };
  };

  router.get("/api/auth/2fa/status", verifyToken, async (req: AuthedReq, res: Response) => {
    if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      const status = await deps.facade.getTwoFactorStatus(req.user.id);
      res.json(status);
    } catch (err) {
      logger.error("[LocalAuth] 2fa status failed", { err });
      res.status(500).json({ error: "Failed to load 2FA status" });
    }
  });

  router.post("/api/auth/2fa/setup", verifyToken, async (req: AuthedReq, res: Response) => {
    if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      const result = await deps.facade.beginTwoFactorSetup(req.user.id);
      res.json(result);
    } catch (err) {
      logger.error("[LocalAuth] 2fa setup failed", { err });
      res.status(500).json({ error: "Failed to start 2FA setup" });
    }
  });

  router.post("/api/auth/2fa/verify", verifyToken, async (req: AuthedReq, res: Response) => {
    if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const parsed = twoFactorTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid 2FA code format" });
      return;
    }
    try {
      await deps.facade.confirmTwoFactor({
        userId: req.user.id,
        token: parsed.data.token,
      });
      res.json({ success: true });
    } catch (err) {
      if (err instanceof Error && err.message === "INVALID_2FA_CODE") {
        res.status(401).json({ error: "Invalid 2FA code" });
        return;
      }
      if (err instanceof Error && err.message === "TWO_FACTOR_NOT_INITIALIZED") {
        res.status(400).json({ error: "Run /api/auth/2fa/setup first" });
        return;
      }
      logger.error("[LocalAuth] 2fa verify failed", { err });
      res.status(500).json({ error: "Failed to verify 2FA" });
    }
  });

  router.post("/api/auth/2fa/disable", verifyToken, async (req: AuthedReq, res: Response) => {
    if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
    const parsed = twoFactorTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid 2FA code format" });
      return;
    }
    try {
      await deps.facade.disableTwoFactor({
        userId: req.user.id,
        token: parsed.data.token,
      });
      res.json({ success: true });
    } catch (err) {
      if (err instanceof Error && err.message === "INVALID_2FA_CODE") {
        res.status(401).json({ error: "Invalid 2FA code" });
        return;
      }
      if (err instanceof Error && err.message === "TWO_FACTOR_NOT_ENABLED") {
        res.status(400).json({ error: "2FA is not enabled" });
        return;
      }
      logger.error("[LocalAuth] 2fa disable failed", { err });
      res.status(500).json({ error: "Failed to disable 2FA" });
    }
  });

  return router;
}

export const localAuthRouter = createLocalAuthRouter();
