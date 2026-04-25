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
      console.warn(
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

export function buildGoogleAuthUrl(redirectAfter?: string): string {
  const clientId = ENV.googleClientId;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID 未設定");

  const redirectUri =
    ENV.googleRedirectUri || "http://localhost:3000/api/oauth/callback";
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

export async function exchangeCodeForTokens(
  code: string
): Promise<GoogleTokenResponse> {
  const clientId = ENV.googleClientId;
  const clientSecret = ENV.googleClientSecret;
  const redirectUri =
    ENV.googleRedirectUri || "http://localhost:3000/api/oauth/callback";

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID 或 GOOGLE_CLIENT_SECRET 未設定");
  }

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
    const error = await response.text();
    throw new Error(
      `Google token exchange failed: ${response.status} — ${error}`
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

  // Demo mode: no DATABASE_URL → auto-login as demo user when demo cookie exists
  if (isDemoMode()) {
    if (sessionToken) {
      try {
        const payload = await verifySessionToken(sessionToken);
        if (payload?.sub === "demo-user-001") {
          return DEMO_USER as import("../../drizzle/schema").User;
        }
      } catch {
        // fall through
      }
    }
    return null;
  }

  if (!sessionToken) return null;

  const payload = await verifySessionToken(sessionToken);
  if (!payload?.sub) return null;

  // 從資料庫取得完整用戶資料
  const user = await db.getUserByOpenId(payload.sub);
  return user ?? null;
}
