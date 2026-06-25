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
import { COOKIE_NAME, THIRTY_DAYS_MS } from "@shared/const";
import * as db from "../db";
import { logger } from "./logger";

// ─── Google OAuth 端點 ─────────────────────────────────────────────────────

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

// ─── JWT 工具 ──────────────────────────────────────────────────────────────

const DEV_FALLBACK_SECRET = "healing-studio-dev-fallback-secret-NOT-FOR-PRODUCTION";

/**
 * AIDV-59（H4 JWT 硬化）：session 簽章密鑰的最小長度。
 * `openssl rand -base64 32` 產生約 44 字元，遠高於此門檻。
 */
export const MIN_JWT_SECRET_LENGTH = 16;

/**
 * 解析並驗證 JWT 簽章密鑰（fail-fast）。
 *
 * 讀取順序：`process.env.JWT_SECRET`（含 AUTH_SECRET 別名於 env.validated 已映射）
 * → `ENV.cookieSecret`（同樣是 JWT_SECRET）。
 *
 * 硬化規則：
 * - 正式環境（NODE_ENV==="production"）若密鑰缺失／空白／< 16 字元 → 直接 throw，
 *   絕不靜默使用弱／空密鑰或開發用 fallback（避免用 in-repo 公開常數簽章 1 年 token）。
 * - 非正式環境（dev/test）保留開發用 fallback，讓本機與測試在未設密鑰時仍可運作。
 *
 * 注意：JWT_SECRET 的 `.trim()` 正規化已集中於 env.validated.selfRepairEnv（開機期），
 * 因此 process.env.JWT_SECRET / ENV.cookieSecret 自始即為 trim 後的單一真值，
 * 所有下游（webhookTokens、sdk、secretCrypto）一致。此處仍對讀到的值再 trim 一次，
 * 作為防禦性保險（測試直接覆寫 process.env.JWT_SECRET、未經 selfRepairEnv 時亦正確）。
 */
export function getJwtSecret(): Uint8Array {
  // Read from process.env directly to avoid ESM module evaluation order issues
  const raw = process.env.JWT_SECRET || ENV.cookieSecret || "";
  const secret = raw.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    if (isProduction) {
      throw new Error(
        secret.length === 0
          ? "[Auth] JWT_SECRET（或別名 AUTH_SECRET）未設定。正式環境必須設定，" +
              "請用 `openssl rand -base64 32` 產生後設定 JWT_SECRET。"
          : `[Auth] JWT_SECRET 太短（${secret.length} 字元），正式環境至少需 ${MIN_JWT_SECRET_LENGTH} 字元。` +
              "請用 `openssl rand -base64 32` 重新產生。"
      );
    }
    // 非正式環境：保留開發用 fallback（dev/test 可在未設密鑰時運作）。
    if (process.env.NODE_ENV !== "test") {
      logger.warn(
        "[Auth] ⚠️  JWT_SECRET 未設定或太短，使用開發用暫時密鑰。" +
          "請在正式環境設定 JWT_SECRET（openssl rand -base64 32）！"
      );
    }
    return new TextEncoder().encode(DEV_FALLBACK_SECRET);
  }
  return new TextEncoder().encode(secret);
}

/**
 * AIDV-59（非破壞性相容）：取得「未 trim 的原始密鑰」供既有 session token 驗證 fallback。
 *
 * 背景：舊版（main）以未 trim 的 JWT_SECRET 簽 token；本版集中正規化（trim）後簽/驗。
 * 若正式環境的 JWT_SECRET 帶前後空白，舊 token 以「原值」簽、新程式以「trim 後值」驗 →
 * 簽章不符 → 既有 session 全失效（大規模登出）。為避免此邊界破壞，selfRepairEnv 會在
 * 偵測到空白時把原值保留於 JWT_SECRET_RAW；驗證失敗時用此原值再驗一次（雙金鑰過渡）。
 *
 * 回傳 null 代表「沒有與 trim 後不同的原值」（常態：JWT_SECRET 本就無空白），此時無需 fallback。
 */
function getRawJwtSecretForCompat(): Uint8Array | null {
  const raw = process.env.JWT_SECRET_RAW;
  if (!raw) return null;
  if (raw.trim() === raw) return null; // 與 trim 後相同 → fallback 無意義
  return new TextEncoder().encode(raw);
}

/**
 * AIDV-59：開機期顯式驗證 JWT 密鑰（fail-fast at boot）。
 *
 * 由 server 啟動流程呼叫；正式環境若密鑰缺失／太弱會直接 throw，讓部署「響亮地」失敗，
 * 而不是先啟動再用弱密鑰簽 token。dev/test 不會崩潰（沿用 getJwtSecret 的 fallback 分支）。
 */
export function assertJwtSecretReady(): void {
  // 透過 getJwtSecret() 觸發同一套檢查；正式環境弱密鑰會在此 throw。
  getJwtSecret();
}

/**
 * AIDV-319：JWT audience 宣告，防止跨服務 token 重放攻擊。
 * 新發 token 帶 aud: JWT_AUDIENCE；驗證時先嚴格驗 aud，舊 token（無 aud）可相容過渡。
 */
export const JWT_AUDIENCE = "healing-studio";

export type SessionPayload = {
  sub: string; // Google sub (openId)
  name: string;
  email?: string;
  aud?: string | string[];
  iat?: number;
  exp?: number;
};

export async function createSessionToken(
  googleSub: string,
  opts: { name: string; email?: string; expiresInMs?: number }
): Promise<string> {
  const secret = getJwtSecret();
  // AIDV-59：安全短壽命（30 天）為簽章邊界的預設值，不依賴每個呼叫端記得覆寫。
  const expiresInSecs = Math.floor((opts.expiresInMs ?? THIRTY_DAYS_MS) / 1000);

  return new SignJWT({ sub: googleSub, name: opts.name, email: opts.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiresInSecs}s`)
    .setAudience(JWT_AUDIENCE) // AIDV-319：鎖定 audience，防跨服務重放攻擊
    .sign(secret);
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  const secret = getJwtSecret();

  // AIDV-319：先嚴格驗 aud（新 token 路徑）。
  try {
    const { payload } = await jwtVerify(token, secret, { audience: JWT_AUDIENCE });
    return payload as SessionPayload;
  } catch {
    // AIDV-319 過渡相容：舊 token 不含 aud，aud 驗證失敗時改用無 aud 驗證，
    // 避免現有 session 因加 aud 硬化而大規模失效（同 AIDV-59 雙金鑰過渡模式）。
    // 數週後待舊 token 自然過期即可移除此 fallback。
    try {
      const { payload } = await jwtVerify(token, secret);
      // 若舊 token 帶了不正確的 aud（非本站發的），仍應拒絕。
      if (payload.aud !== undefined && payload.aud !== JWT_AUDIENCE &&
          !(Array.isArray(payload.aud) && payload.aud.includes(JWT_AUDIENCE))) {
        return null;
      }
      return payload as SessionPayload;
    } catch {
      // AIDV-59 非破壞性 fallback：密鑰正規化（trim）前後相容。
      const rawSecret = getRawJwtSecretForCompat();
      if (rawSecret) {
        try {
          const { payload } = await jwtVerify(token, rawSecret);
          return payload as SessionPayload;
        } catch {
          return null;
        }
      }
      return null;
    }
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
