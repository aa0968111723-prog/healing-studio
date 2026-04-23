import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { ENV } from "../_core/env";
import { verifyToken } from "../middleware/verifyToken";
import { logger } from "../_core/logger";
import { AuthFacade, authFacade } from "../services/auth/AuthFacade";

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

type LocalAuthDeps = {
  facade: AuthFacade;
};

export function createLocalAuthRouter(
  deps: LocalAuthDeps = {
    facade: authFacade,
  }
) {
  const router = Router();

  router.post("/api/auth/register", async (req: Request, res: Response) => {
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

  router.post("/api/auth/login", async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Invalid login payload", details: parsed.error.flatten() });
      return;
    }

    const email = normalizeEmail(parsed.data.email);

    try {
      const result = await deps.facade.loginWithPassword({
        email,
        password: parsed.data.password,
      });

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
