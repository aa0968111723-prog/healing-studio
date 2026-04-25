export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/**
 * 取得 Google OAuth 登入 URL
 * 點擊後重定向至後端 /api/oauth/google/start，再由後端導向 Google 登入頁。
 */
export const getLoginUrl = () => {
  const currentPath = window.location.pathname + window.location.search;
  return `/api/oauth/google/start?redirect=${encodeURIComponent(currentPath)}`;
};

/** Demo 模式：直接以訪客身分體驗（無需 Google OAuth） */
export const getDemoLoginUrl = () => `/api/oauth/demo/start`;
