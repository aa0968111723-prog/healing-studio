export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * 取得 Google OAuth 登入 URL
 * 點擊後重定向至後端 /api/oauth/google/start，再由後端導向 Google 登入頁。
 * 向後相容：若環境中仍有 VITE_OAUTH_PORTAL_URL 則使用舊版 Manus OAuth。
 */
export const getLoginUrl = () => {
  const legacyOauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const legacyAppId = import.meta.env.VITE_APP_ID;

  // 向後相容：若舊版 Manus OAuth 環境變數存在，繼續使用
  if (legacyOauthPortalUrl && legacyAppId) {
    const redirectUri = `${window.location.origin}/api/oauth/callback`;
    const state = btoa(redirectUri);
    const url = new URL(`${legacyOauthPortalUrl}/app-auth`);
    url.searchParams.set("appId", legacyAppId);
    url.searchParams.set("redirectUri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("type", "signIn");
    return url.toString();
  }

  // 新版：Google OAuth 2.0（透過後端代理）
  const currentPath = window.location.pathname + window.location.search;
  return `/api/oauth/google/start?redirect=${encodeURIComponent(currentPath)}`;
};

/** Demo 模式：直接以訪客身分體驗（無需 Google OAuth） */
export const getDemoLoginUrl = () => `/api/oauth/demo/start`;
