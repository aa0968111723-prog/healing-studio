/**
 * env.ts — Server environment variables
 *
 * Re-exports validated environment values from env.validated.ts.
 * The ENV shape is preserved for backward compatibility.
 * New code should import directly from "./env.validated".
 */

import { serverEnv } from "./env.validated";

export const ENV = {
  // ── 核心 ──────────────────────────────────────────────────
  appId:          serverEnv.VITE_APP_ID,
  cookieSecret:   serverEnv.JWT_SECRET,
  databaseUrl:    serverEnv.DATABASE_URL,
  isProduction:   serverEnv.NODE_ENV === "production",

  // ── Google OAuth 2.0 ──────────────────────────────────────
  googleClientId:     serverEnv.GOOGLE_CLIENT_ID,
  googleClientSecret: serverEnv.GOOGLE_CLIENT_SECRET,
  googleRedirectUri:  serverEnv.GOOGLE_REDIRECT_URI,

  // ── 管理員信箱清單 ────────────────────────────────────────
  adminEmails:        serverEnv.ADMIN_EMAILS,

  // ── Google Cloud / Vertex AI ──────────────────────────────
  gcpProjectId:   serverEnv.GOOGLE_CLOUD_PROJECT_ID,
  gcsBucketName:  serverEnv.GCS_BUCKET_NAME,
  geminiApiKey:   serverEnv.GEMINI_API_KEY,

  // ── Brave Search ────────────────────────────────────────
  braveSearchApiKey: serverEnv.BRAVE_SEARCH_API_KEY,

  // ── MiniMax M2.7 via NVIDIA NIM（光球 AI 代理人）───────────
  nvidaApi: serverEnv.NVIDA_API,

  // ── 向後相容：Manus Forge API（遷移完成後可移除）─────────
  oAuthServerUrl: serverEnv.OAUTH_SERVER_URL,
  ownerOpenId:    serverEnv.OWNER_OPEN_ID,
  forgeApiUrl:    serverEnv.BUILT_IN_FORGE_API_URL,
  forgeApiKey:    serverEnv.BUILT_IN_FORGE_API_KEY,
};
