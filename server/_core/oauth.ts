/**
 * oauth.ts — Google OAuth 2.0 路由
 *
 * 替換 Manus 專屬 OAuth 流程，改用標準 Google OAuth 2.0。
 *
 * 路由：
 *   GET /api/oauth/google/start  → 重定向至 Google 登入頁
 *   GET /api/oauth/callback      → Google 回呼，換取 Token，建立 Session
 *   POST /api/oauth/logout       → 清除 Session Cookie
 */

import { COOKIE_NAME, THIRTY_DAYS_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { parse as parseCookie } from "cookie";
import { timingSafeEqual } from "crypto";
import * as db from "../db";
import { ENV } from "./env";
import { getSessionCookieOptions, getOAuthStateCookieOptions } from "./cookies";
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  getGoogleUserInfo,
  createSessionToken,
  verifySessionToken,
  isDemoMode,
  DEMO_USER,
  GoogleTokenExchangeError,
  hashSessionToken,
  isRefreshTokenRotationEnabled,
  generateOAuthStateNonce,
  isOAuthLoginStateCheckEnabled,
  OAUTH_STATE_COOKIE,
} from "./googleAuth";
import {
  insertRefreshToken,
  revokeRefreshToken,
} from "../db";
import {
  buildDriveAuthUrl,
  exchangeDriveCode,
  saveDriveTokens,
} from "../services/googleDrive";
import { decodeOAuthState, encodeOAuthState } from "./oauthState";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * AIDV-59（H4 JWT 硬化）：解析 session token 壽命（毫秒）。
 *
 * 改為遵循 JWT_ACCESS_TOKEN_EXPIRES_IN（秒，預設 2592000 = 30 天），與 localAuth /
 * AuthFacade 一致；移除原本 Google／demo 流程硬寫死 ONE_YEAR_MS 的不一致。
 * env 無效（非數字／<=0）時退回 30 天，而非 1 年。
 */
function getAccessTokenLifetimeMs(): number {
  const sec = Number(ENV.jwtAccessTokenExpiresIn);
  if (!Number.isFinite(sec) || sec <= 0) return THIRTY_DAYS_MS;
  return Math.floor(sec * 1000);
}

function getRedirectFromState(state?: string): string {
  const parsed = decodeOAuthState(state);
  return isSafeRedirectPath(parsed.redirect) ? parsed.redirect : "/";
}

/**
 * AIDV-580: constant-time compare for the login `state` nonce vs the
 * `oauth_state` cookie. Both absent/blank → false (never treat a missing
 * nonce as a match). Length-guarded because timingSafeEqual throws on
 * unequal-length buffers.
 */
function nonceMatches(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a, "utf-8");
  const bb = Buffer.from(b, "utf-8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

async function getCurrentUserOpenIdFromCookie(
  req: Request
): Promise<string | null> {
  const cookies = parseCookie(req.headers.cookie || "");
  const sessionToken = cookies[COOKIE_NAME];
  if (!sessionToken) return null;
  const payload = await verifySessionToken(sessionToken);
  return payload?.sub ?? null;
}

function appendErrorParam(path: string, reason: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}error=${encodeURIComponent(reason)}`;
}

function redirectWithAuthError(
  res: Response,
  reason: string,
  state?: string
): void {
  const targetPath = getRedirectFromState(state);
  res.redirect(302, appendErrorParam(targetPath, reason));
}

/**
 * Validate that a redirect path is a safe, relative path.
 * Blocks absolute URLs, protocol-relative URLs, encoded slash bypasses, etc.
 */
function isSafeRedirectPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  // Block protocol-relative URLs (//evil.com) and encoded variants
  if (/^\/[\\/]/.test(path)) return false;
  // Block encoded slashes that could decode to //
  if (/%2f/i.test(path.slice(0, 3))) return false;
  // Block URLs containing protocol markers
  if (/[a-z]+:/i.test(path)) return false;
  return true;
}

function isTransientDbError(error: unknown): boolean {
  const maybeCode =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    maybeCode === "ER_LOCK_WAIT_TIMEOUT" ||
    maybeCode === "ER_LOCK_DEADLOCK" ||
    maybeCode === "PROTOCOL_CONNECTION_LOST" ||
    maybeCode === "ECONNRESET" ||
    maybeCode === "ETIMEDOUT" ||
    message.includes("deadlock") ||
    message.includes("lock wait timeout") ||
    message.includes("connection lost")
  );
}

async function upsertUserWithOneRetry(input: Parameters<typeof db.upsertUser>[0]): Promise<void> {
  try {
    await db.upsertUser(input);
  } catch (error) {
    if (!isTransientDbError(error)) throw error;
    console.warn("[OAuth] Transient DB error during upsert; retrying once...", {
      code: typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined,
      message: error instanceof Error ? error.message : String(error),
    });
    await new Promise(resolve => setTimeout(resolve, 300));
    await db.upsertUser(input);
  }
}

export function registerOAuthRoutes(app: Express) {
  // ── 1. 啟動 Google 登入流程 ───────────────────────────────
  app.get("/api/oauth/google/start", (req: Request, res: Response) => {
    // Demo mode has no database — Google sub would be unresolvable; use demo login instead
    if (isDemoMode()) {
      res.redirect(302, "/api/oauth/demo/start");
      return;
    }
    try {
      let redirectAfter = getQueryParam(req, "redirect") || "/";
      // Only allow safe relative paths — block absolute URLs, protocol-relative URLs, etc.
      if (!isSafeRedirectPath(redirectAfter)) {
        redirectAfter = "/";
      }
      // AIDV-580: mint a one-time anti-CSRF nonce, mirror it into a short-lived
      // first-party cookie, and embed it in the `state`. The callback later
      // refuses any `state` whose nonce doesn't match this cookie (login CSRF /
      // session fixation defence). Always set — enforcement is flag-gated.
      const nonce = generateOAuthStateNonce();
      res.cookie(OAUTH_STATE_COOKIE, nonce, {
        ...getOAuthStateCookieOptions(req),
        maxAge: 10 * 60 * 1000, // 10 minutes — a login round-trip is short-lived
      });
      const authUrl = buildGoogleAuthUrl(redirectAfter, req, nonce);
      res.redirect(302, authUrl);
    } catch (error) {
      console.error("[OAuth] Failed to build Google auth URL", error);
      redirectWithAuthError(res, "oauth_config_error");
    }
  });

  // ── 1b. 啟動 Google Drive 增量授權 ─────────────────────────
  // 必須已登入；piggy-back 在 /api/oauth/callback URI 上，靠 state 內的
  // purpose 區分回來時要走 login 還是 drive 分支。
  app.get(
    "/api/oauth/google/drive/start",
    async (req: Request, res: Response) => {
      const openId = await getCurrentUserOpenIdFromCookie(req);
      if (!openId) {
        res.redirect(302, "/login?redirect=/assets");
        return;
      }
      let redirectAfter = getQueryParam(req, "redirect") || "/assets";
      if (!isSafeRedirectPath(redirectAfter)) redirectAfter = "/assets";

      try {
        const state = encodeOAuthState({
          redirect: redirectAfter,
          purpose: "drive",
          userOpenId: openId,
        });
        const authUrl = buildDriveAuthUrl(state, req);
        res.redirect(302, authUrl);
      } catch (error) {
        console.error("[OAuth] Failed to build Drive auth URL", error);
        redirectWithAuthError(res, "drive_oauth_config_error");
      }
    }
  );

  // ── 2. Google 回呼處理 ────────────────────────────────────
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const errorParam = getQueryParam(req, "error");

    console.info("[OAuth] Callback received", {
      hasCode: !!code,
      hasState: !!state,
      errorParam: errorParam || "none",
      hostname: req.hostname,
      protocol: req.protocol,
      forwardedProto: req.headers["x-forwarded-proto"],
    });

    // 用戶拒絕授權
    if (errorParam) {
      console.warn("[OAuth] User denied access:", errorParam);
      redirectWithAuthError(res, "auth_denied", state);
      return;
    }

    if (!code) {
      console.error("[OAuth] Missing authorization code");
      redirectWithAuthError(res, "missing_code", state);
      return;
    }

    const decodedState = decodeOAuthState(state);
    if (decodedState.purpose === "drive") {
      await handleDriveCallback(req, res, code, decodedState.redirect, decodedState.userOpenId);
      return;
    }

    // AIDV-580: login CSRF / session fixation guard. The `state` nonce must
    // match the one-time `oauth_state` cookie minted at `/start`. A forged
    // code+state replayed from an attacker's own Google account carries no
    // matching cookie, so it is refused BEFORE the code is exchanged — no
    // attacker session is ever minted into the victim's browser. The cookie
    // is always cleared here (one-time use); enforcement is flag-gated so the
    // merge is a zero-behaviour change until Bruce flips OAUTH_LOGIN_STATE_CSRF.
    const cookieNonce = parseCookie(req.headers.cookie || "")[OAUTH_STATE_COOKIE];
    if (cookieNonce !== undefined) {
      res.clearCookie(OAUTH_STATE_COOKIE, {
        ...getOAuthStateCookieOptions(req),
        maxAge: 0,
      });
    }
    if (isOAuthLoginStateCheckEnabled()) {
      if (!nonceMatches(decodedState.nonce, cookieNonce)) {
        console.warn("[OAuth] Login state nonce mismatch — refusing callback", {
          hasStateNonce: !!decodedState.nonce,
          hasCookieNonce: !!cookieNonce,
        });
        redirectWithAuthError(res, "oauth_state_mismatch", state);
        return;
      }
    }

    let stage: "token" | "userinfo" | "db" | "session" = "token";
    try {
      // 換取 Google Access Token
      console.info("[OAuth] Exchanging code for tokens...");
      const tokens = await exchangeCodeForTokens(code, req);
      console.info("[OAuth] Token exchange successful");

      // 取得用戶資訊
      stage = "userinfo";
      console.info("[OAuth] Fetching user info...");
      const userInfo = await getGoogleUserInfo(tokens.access_token);
      console.info("[OAuth] User info retrieved", {
        sub: userInfo.sub,
        email: userInfo.email,
        emailVerified: userInfo.email_verified,
      });

      if (!userInfo.sub) {
        console.error("[OAuth] Missing Google user ID (sub)");
        redirectWithAuthError(res, "missing_google_user_id", state);
        return;
      }

      // 寫入 / 更新資料庫
      stage = "db";
      console.info("[OAuth] Upserting user to database...", {
        openId: userInfo.sub,
        email: userInfo.email,
      });
      await upsertUserWithOneRetry({
        openId: userInfo.sub,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });
      console.info("[OAuth] User upserted successfully");

      // 建立 JWT Session Token
      stage = "session";
      console.info("[OAuth] Creating session token...");
      // AIDV-59：壽命改由 env 決定（預設 30 天），不再硬寫死 1 年。
      const sessionLifetimeMs = getAccessTokenLifetimeMs();
      const sessionToken = await createSessionToken(userInfo.sub, {
        name: userInfo.name || "",
        email: userInfo.email,
        expiresInMs: sessionLifetimeMs,
      });

      // 設定 Session Cookie
      const cookieOptions = getSessionCookieOptions(req);
      console.info("[OAuth] Setting session cookie", {
        cookieOptions,
        cookieName: COOKIE_NAME,
        maxAge: sessionLifetimeMs,
      });
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: sessionLifetimeMs,
      });

      // AIDV-230: record token in DB when rotation is enabled
      if (isRefreshTokenRotationEnabled()) {
        const user = await db.getUserByOpenId(userInfo.sub);
        if (user) {
          const expiresAt = new Date(Date.now() + sessionLifetimeMs);
          insertRefreshToken({
            tokenHash: hashSessionToken(sessionToken),
            userId: user.id,
            expiresAt,
          }).catch(err => console.error("[OAuth] Failed to record refresh token", err));
        }
      }

      // 解碼 state 取得重定向路徑（僅允許安全的相對路徑，防止 Open Redirect 攻擊）
      const redirectTo = getRedirectFromState(state);
      console.info("[OAuth] Login successful, redirecting to:", redirectTo);

      // Append welcome flag so the client can show a login orb animation
      const separator = redirectTo.includes("?") ? "&" : "?";
      res.redirect(302, `${redirectTo}${separator}welcome=1`);
    } catch (error) {
      console.error("[OAuth] Callback failed with error:", {
        stage,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        code: code ? "present" : "missing",
        state: state ? "present" : "missing",
      });
      // Map the failure stage to a reason the client can localize precisely.
      let reason: string;
      if (
        error instanceof GoogleTokenExchangeError &&
        error.googleError === "redirect_uri_mismatch"
      ) {
        reason = "oauth_redirect_mismatch";
      } else if (stage === "token") {
        reason = "oauth_token_exchange_failed";
      } else if (stage === "userinfo") {
        reason = "oauth_userinfo_failed";
      } else if (stage === "db") {
        reason = "oauth_db_error";
      } else {
        reason = "oauth_failed";
      }
      redirectWithAuthError(res, reason, state);
    }
  });

  // ── 2b. Drive 授權 callback handler ───────────────────────
  // 拆成獨立函式而不是 inline 在大 callback 裡，是因為 Drive 流程要
  // 「綁定到目前已登入的使用者」，跟 login 流程的 upsertUser 完全是兩條路。
  async function handleDriveCallback(
    req: Request,
    res: Response,
    code: string,
    redirectAfter: string,
    expectedOpenId: string | undefined
  ) {
    try {
      const sessionOpenId = await getCurrentUserOpenIdFromCookie(req);
      if (!sessionOpenId) {
        redirectWithAuthError(res, "drive_session_required");
        return;
      }
      // Defence-in-depth: state MUST carry the user it was issued for, and
      // it MUST match the cookie's user. Refusing missing `expectedOpenId`
      // closes the gap where a forged state with `purpose:"drive"` but no
      // user id would otherwise let an attacker bind tokens minted for
      // their own Google account to whichever victim cookie is active.
      if (!expectedOpenId) {
        redirectWithAuthError(res, "drive_state_unbound");
        return;
      }
      if (expectedOpenId !== sessionOpenId) {
        redirectWithAuthError(res, "drive_session_mismatch");
        return;
      }
      const user = await db.getUserByOpenId(sessionOpenId);
      if (!user) {
        redirectWithAuthError(res, "drive_user_not_found");
        return;
      }

      const tokens = await exchangeDriveCode(code, req);
      // Google sometimes silently scopes-down — verify the user actually
      // approved Drive scope before saving.
      if (!tokens.scope.includes("drive")) {
        redirectWithAuthError(res, "drive_scope_missing");
        return;
      }
      await saveDriveTokens(user.id, tokens);

      const target = isSafeRedirectPath(redirectAfter) ? redirectAfter : "/assets";
      const separator = target.includes("?") ? "&" : "?";
      res.redirect(302, `${target}${separator}drive_connected=1`);
    } catch (error) {
      console.error("[OAuth] Drive callback failed", error);
      redirectWithAuthError(res, "drive_oauth_failed");
    }
  }

  // ── 3. 登出 ───────────────────────────────────────────────
  app.post("/api/oauth/logout", async (req: Request, res: Response) => {
    // AIDV-230: revoke the current session token in DB (when flag ON)
    if (isRefreshTokenRotationEnabled()) {
      const cookies = parseCookie(req.headers.cookie || "");
      const sessionToken = cookies[COOKIE_NAME];
      if (sessionToken) {
        revokeRefreshToken(hashSessionToken(sessionToken))
          .catch(err => console.error("[OAuth] Failed to revoke token on logout", err));
      }
    }
    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: 0 });
    res.json({ success: true, message: "已登出" });
  });

  // ── 4. 向後相容：舊版 Manus OAuth 路由（重定向至新路由）──
  app.get("/api/oauth/manus/start", (req: Request, res: Response) => {
    res.redirect(302, "/api/oauth/google/start");
  });

  // ── 5. Demo 登入（無 DATABASE_URL 時使用，允許訪客體驗）──
  app.get("/api/oauth/demo/start", async (req: Request, res: Response) => {
    if (!isDemoMode()) {
      // 有真實 DB 時，重定向至 Google 登入
      res.redirect(302, "/api/oauth/google/start");
      return;
    }
    try {
      // AIDV-59：demo 流程同樣改用 env 壽命（預設 30 天）。
      const sessionLifetimeMs = getAccessTokenLifetimeMs();
      const sessionToken = await createSessionToken(DEMO_USER.openId, {
        name: DEMO_USER.name || "訪客創作者",
        email: DEMO_USER.email,
        expiresInMs: sessionLifetimeMs,
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: sessionLifetimeMs,
      });
      res.redirect(302, "/studio?welcome=1");
    } catch (error) {
      console.error("[Demo OAuth] Failed", error);
      redirectWithAuthError(res, "demo_oauth_failed");
    }
  });
}
