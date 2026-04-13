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

export function registerOAuthRoutes(app: Express) {
  // ── 1. 啟動 Google 登入流程 ───────────────────────────────
  app.get("/api/oauth/google/start", (req: Request, res: Response) => {
    try {
      let redirectAfter = getQueryParam(req, "redirect") || "/";
      // Only allow relative paths — block absolute URLs, protocol-relative URLs
      if (!redirectAfter.startsWith("/") || redirectAfter.startsWith("//")) {
        redirectAfter = "/";
      }
      const authUrl = buildGoogleAuthUrl(redirectAfter);
      res.redirect(302, authUrl);
    } catch (error) {
      console.error("[OAuth] Failed to build Google auth URL", error);
      res.status(500).json({ error: "OAuth 設定錯誤，請檢查 GOOGLE_CLIENT_ID" });
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
      res.redirect(302, "/?error=auth_denied");
      return;
    }

    if (!code) {
      res.status(400).json({ error: "缺少 authorization code" });
      return;
    }

    try {
      // 換取 Google Access Token
      const tokens = await exchangeCodeForTokens(code);

      // 取得用戶資訊
      const userInfo = await getGoogleUserInfo(tokens.access_token);

      if (!userInfo.sub) {
        res.status(400).json({ error: "無法取得 Google 用戶 ID" });
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

      // 解碼 state 取得重定向路徑（僅允許相對路徑，防止 Open Redirect 攻擊）
      let redirectTo = "/";
      if (state) {
        try {
          const decoded = Buffer.from(state, "base64").toString("utf-8") || "/";
          // Only allow relative paths — block absolute URLs, protocol-relative URLs, etc.
          if (decoded.startsWith("/") && !decoded.startsWith("//")) {
            redirectTo = decoded;
          }
        } catch {
          redirectTo = "/";
        }
      }

      res.redirect(302, redirectTo);
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth 認證失敗，請稍後再試" });
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
      res.redirect(302, "/studio");
    } catch (error) {
      console.error("[Demo OAuth] Failed", error);
      res.status(500).json({ error: "Demo 登入失敗" });
    }
  });
}
