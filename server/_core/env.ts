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
  appId: serverEnv.VITE_APP_ID,
  cookieSecret: serverEnv.JWT_SECRET,
  jwtAccessTokenExpiresIn: serverEnv.JWT_ACCESS_TOKEN_EXPIRES_IN,
  passwordHashAlgorithm: serverEnv.PASSWORD_HASH_ALGORITHM,
  databaseUrl: serverEnv.DATABASE_URL,
  baseUrl: serverEnv.BASE_URL,
  isProduction: serverEnv.NODE_ENV === "production",

  // ── Google OAuth 2.0 ──────────────────────────────────────
  googleClientId: serverEnv.GOOGLE_CLIENT_ID,
  googleClientSecret: serverEnv.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: serverEnv.GOOGLE_REDIRECT_URI,

  // ── 管理員信箱清單 ────────────────────────────────────────
  adminEmails: serverEnv.ADMIN_EMAILS,

  // ── 郵件發送 SMTP（AIDV-434）────────────────────────────
  smtpHost: serverEnv.SMTP_HOST,
  smtpPort: serverEnv.SMTP_PORT,
  smtpSecure: serverEnv.SMTP_SECURE,
  smtpUser: serverEnv.SMTP_USER,
  smtpPass: serverEnv.SMTP_PASS,
  smtpFrom: serverEnv.SMTP_FROM,

  // ── Google Cloud / Vertex AI ──────────────────────────────
  gcpProjectId: serverEnv.GOOGLE_CLOUD_PROJECT_ID,
  gcsBucketName: serverEnv.GCS_BUCKET_NAME,
  geminiApiKey: serverEnv.GEMINI_API_KEY,

  // ── Brave Search ────────────────────────────────────────
  braveSearchApiKey: serverEnv.BRAVE_SEARCH_API_KEY,
  perplexityApiKey: serverEnv.PERPLEXITY_API_KEY,

  // ── MiniMax M2.7 via NVIDIA NIM（光球 AI 代理人）───────────
  nvidaApi: serverEnv.NVIDIA_API,

  // ── Anthropic Claude（光球 AI 代理人主引擎，最佳 tool use）─
  anthropicApiKey: serverEnv.ANTHROPIC_API_KEY,

  // ── OpenRouter（統一 LLM 閘道，推薦的單一入口）──────────
  openRouterApiKey: serverEnv.OPENROUTER_API_KEY,
  openRouterBaseUrl: serverEnv.OPENROUTER_BASE_URL,
  openRouterHttpReferer: serverEnv.OPENROUTER_HTTP_REFERER,
  openRouterXTitle: serverEnv.OPENROUTER_X_TITLE,

  // ── GitHub 整合 ──────────────────────────────────────────
  githubToken: serverEnv.GITHUB_TOKEN,
  githubRepo: serverEnv.GITHUB_REPO,

  // ── 向後相容：Manus Forge API（遷移完成後可移除）─────────
  oAuthServerUrl: serverEnv.OAUTH_SERVER_URL,
  ownerOpenId: serverEnv.OWNER_OPEN_ID,
  forgeApiUrl: serverEnv.BUILT_IN_FORGE_API_URL,
  forgeApiKey: serverEnv.BUILT_IN_FORGE_API_KEY,

  // ── FreeLLM API（免費 LLM 備援引擎，最低優先，無需 API 金鑰）─────────
  freeLlmApiEnabled: serverEnv.FREE_LLM_API_ENABLED,
  freeLlmApiUrl: serverEnv.FREE_LLM_API_URL,
};
