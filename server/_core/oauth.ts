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
} from "./googleAuth";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  // ── 1. 啟動 Google 登入流程 ───────────────────────────────
  app.get("/api/oauth/google/start", (req: Request, res: Response) => {
    try {
      const redirectAfter = getQueryParam(req, "redirect") || "/";
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

      // 解碼 state 取得重定向路徑
      let redirectTo = "/";
      if (state) {
        try {
          redirectTo = Buffer.from(state, "base64").toString("utf-8") || "/";
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
}
