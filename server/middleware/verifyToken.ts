import type { NextFunction, Request, Response } from "express";
import { parse as parseCookie } from "cookie";
import {
  verifySessionToken,
  hashSessionToken,
  isRefreshTokenRotationEnabled,
} from "../_core/googleAuth";
import { COOKIE_NAME, type UserRole } from "@shared/const";
import { getUserByOpenId, isRefreshTokenActive } from "../db";
import { logger } from "../_core/logger";

type AuthenticatedRequest = Request & {
  auth?: {
    sub: string;
    name: string;
    email?: string;
  };
  user?: {
    id: number;
    openId: string;
    role: UserRole;
    email: string | null;
    name: string | null;
  };
};

function getRequestToken(req: Request): string {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const cookies = parseCookie(req.headers.cookie || "");
  const cookieToken = cookies[COOKIE_NAME] || "";
  return bearerToken || cookieToken;
}

async function hydrateRequestAuth(req: Request, token: string): Promise<boolean> {
  const payload = await verifySessionToken(token);
  if (!payload?.sub) return false;

  // AIDV-230: server-side revocation check (only when flag is ON)
  if (isRefreshTokenRotationEnabled()) {
    const active = await isRefreshTokenActive(hashSessionToken(token));
    if (!active) return false;
  }

  const authReq = req as AuthenticatedRequest;
  authReq.auth = {
    sub: payload.sub,
    name: payload.name,
    email: payload.email,
  };

  try {
    const user = await getUserByOpenId(payload.sub);
    if (user) {
      if (user.deletedAt) {
        logger.warn("[Auth] Rejected login for soft-deleted account", { userId: user.id });
        return false;
      }
      authReq.user = {
        id: user.id,
        openId: user.openId,
        role: user.role,
        email: user.email ?? null,
        name: user.name ?? null,
      };
    }
  } catch (err) {
    // AIDV-258: DB unavailable (ECONNREFUSED / timeout) — fail closed.
    // Returning true without a hydrated user would allow JWT-only access,
    // bypassing role and soft-delete checks that live only in the DB record.
    logger.warn("[Auth] DB unavailable — failing closed, rejecting request", {
      sub: payload.sub,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
  return true;
}

export async function verifyToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = getRequestToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const ok = await hydrateRequestAuth(req, token);
  if (!ok) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  next();
}

export async function optionalVerifyToken(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const token = getRequestToken(req);
  if (!token) {
    next();
    return;
  }
  await hydrateRequestAuth(req, token).catch(() => {});
  next();
}
