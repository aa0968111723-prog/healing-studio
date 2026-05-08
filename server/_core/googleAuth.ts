/**
 * googleAuth.ts — Google OAuth 2.0 認證系統
 *
 * 替換 Manus 專屬的 sdk.ts OAuth 流程。
 * 使用 Google 標準 OAuth 2.0 Authorization Code Flow。
 *
 * 流程：
 * 1. 前端點擊登入 → /api/oauth/google/start → 重定向至 Google
 * 2. Google 認證完成 → /api/oauth/callback?code=...&state=...
 * 3. 後端換取 tokens → 取得用戶資訊 → 建立 JWT Session → 設定 Cookie
 */

import { SignJWT, jwtVerify } from "jose";
import type { Request } from "express";
import { parse as parseCookie } from "cookie";
import { ENV } from "./env";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import * as db from "../db";
import { logger } from "./logger";

// ─── Google OAuth 端點 ─────────────────────────────────────────────────────

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

// ─── JWT 工具 ──────────────────────────────────────────────────────────────

const DEV_FALLBACK_SECRET = "healing-studio-dev-fallback-secret-NOT-FOR-PRODUCTION";

function getJwtSecret(): Uint8Array {
  // Read from process.env directly to avoid ESM module evaluation order issues
  const secret = process.env.JWT_SECRET || ENV.cookieSecret;
  if (!secret) {
    if (process.env.NODE_ENV !== "test") {
      logger.warn(
        "[Auth] ⚠️  JWT_SECRET 未設定，使用開發用暫時密鑰。" +
          "請在正式環境設定 JWT_SECRET（openssl rand -base64 32）！"
      );
    }
    return new TextEncoder().encode(DEV_FALLBACK_SECRET);
  }
  return new TextEncoder().encode(secret);
}

export type SessionPayload = {
  sub: string; // Google sub (openId)
  name: string;
  email?: string;
  iat?: number;
  exp?: number;
};

export async function createSessionToken(
  googleSub: string,
  opts: { name: string; email?: string; expiresInMs?: number }
): Promise<string> {
  const secret = getJwtSecret();
  const expiresInSecs = Math.floor((opts.expiresInMs ?? ONE_YEAR_MS) / 1000);

  return new SignJWT({ sub: googleSub, name: opts.name, email: opts.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiresInSecs}s`)
    .sign(secret);
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const secret = getJwtSecret();
    const { payload } = await jwtVerify(token, secret);
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

// ─── Google OAuth URL 生成 ─────────────────────────────────────────────────

const DEFAULT_REDIRECT_URI = "http://localhost:3000/api/oauth/callback";

/**
 * Resolve the OAuth redirect URI.
 *
 * Preference order:
 *   1. `GOOGLE_REDIRECT_URI` if explicitly set (non-empty, non-default).
 *   2. Derived from the incoming request (`<proto>://<host>/api/oauth/callback`)
 *      — uses x-forwarded-proto/host so it works behind Railway's proxy.
 *   3. The localhost default (only for local dev when no request context).
 *
 * Both `/api/oauth/google/start` and `/api/oauth/callback` resolve the URI
 * the same way, so the values match — Google rejects the token exchange if
 * they don't.
 */
export function resolveRedirectUri(req?: Request): string {
  const fromEnv = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (fromEnv && fromEnv !== DEFAULT_REDIRECT_URI) {
    return fromEnv;
  }

  if (req) {
    const forwardedProto = req.headers["x-forwarded-proto"];
    const protoHeader = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto?.split(",")[0]?.trim();
    const proto = protoHeader || req.protocol || "http";

    const forwardedHost = req.headers["x-forwarded-host"];
    const hostHeader = Array.isArray(forwardedHost)
      ? forwardedHost[0]
      : forwardedHost?.split(",")[0]?.trim();
    const host = hostHeader || req.get?.("host") || req.hostname;

    if (host) {
      return `${proto}://${host}/api/oauth/callback`;
    }
  }

  return fromEnv || DEFAULT_REDIRECT_URI;
}

export function buildGoogleAuthUrl(
  redirectAfter?: string,
  req?: Request
): string {
  const clientId = ENV.googleClientId;
  if (!clientId) {
    logger.error("[GoogleAuth] GOOGLE_CLIENT_ID not configured");
    throw new Error("GOOGLE_CLIENT_ID 未設定");
  }

  const redirectUri = resolveRedirectUri(req);

  logger.info("[GoogleAuth] Building Google auth URL", {
    redirectUri,
    redirectAfter: redirectAfter || "/",
    hasClientId: !!clientId,
    source: process.env.GOOGLE_REDIRECT_URI ? "env" : "request",
  });

  const state = redirectAfter
    ? Buffer.from(redirectAfter).toString("base64")
    : "";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "select_account",
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ─── 授權碼換取 Token ──────────────────────────────────────────────────────

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

export class GoogleTokenExchangeError extends Error {
  readonly status: number;
  readonly googleError?: string;

  constructor(status: number, googleError: string | undefined, message: string) {
    super(message);
    this.name = "GoogleTokenExchangeError";
    this.status = status;
    this.googleError = googleError;
  }
}

export async function exchangeCodeForTokens(
  code: string,
  req?: Request
): Promise<GoogleTokenResponse> {
  const clientId = ENV.googleClientId;
  const clientSecret = ENV.googleClientSecret;
  const redirectUri = resolveRedirectUri(req);

  if (!clientId || !clientSecret) {
    const error = new Error("GOOGLE_CLIENT_ID 或 GOOGLE_CLIENT_SECRET 未設定");
    logger.error("[GoogleAuth] Missing OAuth credentials", {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
    });
    throw error;
  }

  logger.info("[GoogleAuth] Exchanging code for tokens", {
    redirectUri,
    codeLength: code.length,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("[GoogleAuth] Token exchange failed", {
      status: response.status,
      statusText: response.statusText,
      error: errorText,
      redirectUri,
    });

    let googleError: string | undefined;
    try {
      googleError = JSON.parse(errorText)?.error;
    } catch {
      // not JSON — leave undefined
    }

    throw new GoogleTokenExchangeError(
      response.status,
      googleError,
      `Google token exchange failed: ${response.status} — ${errorText}`
    );
  }

  return response.json() as Promise<GoogleTokenResponse>;
}

// ─── 取得 Google 用戶資訊 ──────────────────────────────────────────────────

export interface GoogleUserInfo {
  sub: string; // Google 唯一 ID（用作 openId）
  name?: string;
  email?: string;
  picture?: string;
  email_verified?: boolean;
}

export async function getGoogleUserInfo(
  accessToken: string
): Promise<GoogleUserInfo> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Google userinfo failed: ${response.status}`);
  }

  return response.json() as Promise<GoogleUserInfo>;
}

// ─── Demo 用戶（無 DB 時使用）────────────────────────────────────────────────

export const DEMO_USER = {
  id: 1,
  openId: "demo-user-001",
  name: "訪客創作者",
  email: "demo@ai-director.art",
  loginMethod: "demo",
  role: "user" as const,
  quotaJson: { image: 100, video: 50, audio: 50, voice: 50 },
  remainingGenerations: 999,
  onboardingDone: true,
  avatarUrl: null,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
  lastSignedIn: new Date(),
};

export function isDemoMode(): boolean {
  // 在測試環境中強制關閉 demo mode，避免略過扣點/建任務等真實流程
  // 導致整合測試與生產邏輯漂移。
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
    return false;
  }
  return !process.env.DATABASE_URL;
}

// ─── 從 Request 驗證 Session ───────────────────────────────────────────────

export async function authenticateRequest(req: Request) {
  const cookieHeader = req.headers.cookie || "";
  const cookies = parseCookie(cookieHeader);
  const sessionToken = cookies[COOKIE_NAME];

  logger.info("[Auth] Authenticating request", {
    hasCookie: !!cookieHeader,
    hasSessionToken: !!sessionToken,
    isDemoMode: isDemoMode(),
    hostname: req.hostname,
  });

  // Demo mode: no DATABASE_URL → auto-login as demo user when demo cookie exists
  if (isDemoMode()) {
    if (sessionToken) {
      try {
        const payload = await verifySessionToken(sessionToken);
        if (payload?.sub === "demo-user-001") {
          logger.info("[Auth] Demo mode: authenticated as demo user");
          return DEMO_USER as import("../../drizzle/schema").User;
        }
      } catch {
        // fall through
      }
    }
    logger.info("[Auth] Demo mode: no valid session");
    return null;
  }

  if (!sessionToken) {
    logger.info("[Auth] No session token found");
    return null;
  }

  const payload = await verifySessionToken(sessionToken);
  if (!payload?.sub) {
    logger.warn("[Auth] Invalid session token - no sub in payload");
    return null;
  }

  // 從資料庫取得完整用戶資料
  logger.info("[Auth] Fetching user from database", { openId: payload.sub });
  const user = await db.getUserByOpenId(payload.sub);

  if (user) {
    logger.info("[Auth] User authenticated successfully", {
      userId: user.id,
      email: user.email,
      loginMethod: user.loginMethod,
    });
  } else {
    logger.warn("[Auth] User not found in database", { openId: payload.sub });
  }

  return user ?? null;
}
