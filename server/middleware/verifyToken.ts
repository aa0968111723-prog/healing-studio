import type { NextFunction, Request, Response } from "express";
import { parse as parseCookie } from "cookie";
import { verifySessionToken } from "../_core/googleAuth";
import { COOKIE_NAME } from "@shared/const";
import { getUserByOpenId } from "../db";
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
    role: "user" | "admin";
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

  const authReq = req as AuthenticatedRequest;
  authReq.auth = {
    sub: payload.sub,
    name: payload.name,
    email: payload.email,
  };

  try {
    const user = await getUserByOpenId(payload.sub);
    if (user) {
      authReq.user = {
        id: user.id,
        openId: user.openId,
        role: user.role,
        email: user.email ?? null,
        name: user.name ?? null,
      };
    }
  } catch (err) {
    logger.warn("[Auth] Failed to hydrate user from DB, falling back to JWT payload", {
      sub: payload.sub,
      err,
    });
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
