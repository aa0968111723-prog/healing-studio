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

import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  getGoogleUserInfo,
  createSessionToken,
  isDemoMode,
  DEMO_USER,
} from "./googleAuth";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function getRedirectFromState(state?: string): string {
  if (!state) return "/";
  try {
    const decoded = Buffer.from(state, "base64").toString("utf-8") || "/";
    return isSafeRedirectPath(decoded) ? decoded : "/";
  } catch {
    return "/";
  }
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
      const authUrl = buildGoogleAuthUrl(redirectAfter);
      res.redirect(302, authUrl);
    } catch (error) {
      console.error("[OAuth] Failed to build Google auth URL", error);
      redirectWithAuthError(res, "oauth_config_error");
    }
  });

  // ── 2. Google 回呼處理 ────────────────────────────────────
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const errorParam = getQueryParam(req, "error");

    // 用戶拒絕授權
    if (errorParam) {
      console.warn("[OAuth] User denied access:", errorParam);
      redirectWithAuthError(res, "auth_denied", state);
      return;
    }

    if (!code) {
      redirectWithAuthError(res, "missing_code", state);
      return;
    }

    try {
      // 換取 Google Access Token
      const tokens = await exchangeCodeForTokens(code);

      // 取得用戶資訊
      const userInfo = await getGoogleUserInfo(tokens.access_token);

      if (!userInfo.sub) {
        redirectWithAuthError(res, "missing_google_user_id", state);
        return;
      }

      // 寫入 / 更新資料庫
      await db.upsertUser({
        openId: userInfo.sub,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });

      // 建立 JWT Session Token
      const sessionToken = await createSessionToken(userInfo.sub, {
        name: userInfo.name || "",
        email: userInfo.email,
        expiresInMs: ONE_YEAR_MS,
      });

      // 設定 Session Cookie
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      // 解碼 state 取得重定向路徑（僅允許安全的相對路徑，防止 Open Redirect 攻擊）
      const redirectTo = getRedirectFromState(state);

      // Append welcome flag so the client can show a login orb animation
      const separator = redirectTo.includes("?") ? "&" : "?";
      res.redirect(302, `${redirectTo}${separator}welcome=1`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[OAuth] Callback failed:", detail);
      redirectWithAuthError(res, "oauth_failed", state);
    }
  });

  // ── 3. 登出 ───────────────────────────────────────────────
  app.post("/api/oauth/logout", (req: Request, res: Response) => {
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
      const sessionToken = await createSessionToken(DEMO_USER.openId, {
        name: DEMO_USER.name || "訪客創作者",
        email: DEMO_USER.email,
        expiresInMs: ONE_YEAR_MS,
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });
      res.redirect(302, "/studio?welcome=1");
    } catch (error) {
      console.error("[Demo OAuth] Failed", error);
      redirectWithAuthError(res, "demo_oauth_failed");
    }
  });
}
