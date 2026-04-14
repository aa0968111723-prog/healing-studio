/**
 * env.validated.ts — Zod-based environment variable validation with OARS-style warnings
 *
 * OARS (Observe → Acknowledge → Recommend → Suggest) pattern ensures that
 * missing API keys produce friendly, actionable console warnings instead of
 * hard crashes.
 *
 * Usage: import { serverEnv } from "./env.validated";
 *        — all downstream code should read keys from serverEnv.*
 */

import { z } from "zod";

// ─── OARS Warning Formatter ────────────────────────────────────────────────

function oarsWarn(varName: string, module: string, howToFix: string): void {
  const divider = "─".repeat(60);
  console.warn(`
${divider}
⚠️  環境變數缺失提醒 — ${varName}
${divider}
【觀察】 偵測到 ${varName} 未設定或為空值。
【影響】 ${module} 模組將無法正常運作，但系統不會因此崩潰。
【建議】 ${howToFix}
【提示】 請在 .env 檔案中設定此變數，參考 .env.example 範本。
${divider}
`);
}

// ─── Schema Definitions ────────────────────────────────────────────────────

/**
 * Core platform variables — required for the app to function at all.
 */
const coreSchema = z.object({
  NODE_ENV:    z.string().optional().default("development"),
  PORT:        z.string().optional().default("3000"),
  JWT_SECRET:  z.string().min(1).optional().default(""),
  DATABASE_URL: z.string().min(1).optional().default(""),

  // ── Google OAuth 2.0（替換 Manus OAuth）──────────────────
  GOOGLE_CLIENT_ID:     z.string().min(1).optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional().default(""),
  GOOGLE_REDIRECT_URI:  z.string().optional().default("http://localhost:3000/api/oauth/callback"),

  // ── Google Cloud Platform ─────────────────────────────────
  GOOGLE_CLOUD_PROJECT_ID:             z.string().min(1).optional().default(""),
  GOOGLE_CLOUD_LOCATION:               z.string().optional().default("us-central1"),
  GOOGLE_APPLICATION_CREDENTIALS_JSON: z.string().min(1).optional().default(""),
  GCS_BUCKET_NAME:                     z.string().min(1).optional().default(""),

  // ── S3 相容儲存（Cloudflare R2 / AWS S3 / MinIO 等）──────
  // 在 Railway 環境變數中設定以下四個即可啟用 Cloudflare R2：
  //   S3_ENDPOINT          = https://<ACCOUNT_ID>.r2.cloudflarestorage.com
  //   S3_ACCESS_KEY_ID     = <R2 Access Key ID>
  //   S3_SECRET_ACCESS_KEY = <R2 Secret Access Key>
  //   S3_BUCKET_NAME       = <bucket 名稱>
  //   S3_PUBLIC_URL        = https://pub-xxxx.r2.dev  （選填，R2 公開網域）
  //   S3_REGION            = auto                      （選填，R2 固定 auto）
  S3_ENDPOINT:           z.string().optional().default(""),
  S3_ACCESS_KEY_ID:      z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY:  z.string().optional().default(""),
  S3_BUCKET_NAME:        z.string().optional().default(""),
  S3_PUBLIC_URL:         z.string().optional().default(""),
  S3_REGION:             z.string().optional().default("auto"),

  // ── 管理員信箱（逗號分隔，登入時自動設為 admin）─────────
  ADMIN_EMAILS:           z.string().optional().default(""),

  // ── 向後相容：Manus Forge API（遷移完成後可移除）─────────
  VITE_APP_ID:            z.string().optional().default(""),
  OAUTH_SERVER_URL:       z.string().optional().default(""),
  OWNER_OPEN_ID:          z.string().optional().default(""),
  BUILT_IN_FORGE_API_URL: z.string().optional().default(""),
  BUILT_IN_FORGE_API_KEY: z.string().optional().default(""),
});

/**
 * Multimodal API keys — optional, only needed when the corresponding
 * module is activated. Missing keys produce soft OARS warnings.
 */
const multimodalSchema = z.object({
  // ── Vertex AI / Gemini（LLM 主引擎）─────────────────────
  GEMINI_API_KEY: z.string().min(1).optional().default(""),

  // ── 圖片 / 影片生成 ──────────────────────────────────────
  FAL_API_KEY:          z.string().min(1).optional().default(""),
  REPLICATE_API_TOKEN:  z.string().min(1).optional().default(""),

  // ── 音訊 / 語音生成 ──────────────────────────────────────
  ELEVENLABS_API_KEY: z.string().min(1).optional().default(""),
  SUNO_API_KEY:       z.string().min(1).optional().default(""),

  // ── 向量資料庫（RAG 記憶系統）───────────────────────────
  PINECONE_API_KEY:    z.string().min(1).optional().default(""),
  PINECONE_ENVIRONMENT: z.string().min(1).optional().default("us-east-1"),
  PINECONE_INDEX_NAME: z.string().min(1).optional().default("ai-director-memories"),

  // ── 新聞資料來源 ─────────────────────────────────────────
  NEWS_API_KEY:    z.string().min(1).optional().default(""),
  NEWSDATA_API_KEY: z.string().min(1).optional().default(""),

  // ── AI 監控（LangSmith）──────────────────────────────────
  LANGSMITH_API_KEY:      z.string().min(1).optional().default(""),
  LANGSMITH_PROJECT:      z.string().optional().default("ai-director"),
  LANGCHAIN_TRACING_V2:   z.string().optional().default("false"),
  LANGCHAIN_ENDPOINT:     z.string().optional().default("https://api.smith.langchain.com"),

  // ── Brave Search API ──────────────────────────────────────
  BRAVE_SEARCH_API_KEY:   z.string().min(1).optional().default(""),

  // ── 姿勢估測 ─────────────────────────────────────────────
  OPENPOSE_API_KEY: z.string().min(1).optional().default(""),
});

// Combined schema
const fullSchema = coreSchema.merge(multimodalSchema);

// ─── Validation & Warning Emission ─────────────────────────────────────────

type ServerEnvResult = z.infer<typeof fullSchema>;

function validateAndWarn(): ServerEnvResult {
  const result = fullSchema.safeParse(process.env);

  if (!result.success) {
    console.warn("⚠️ 環境變數解析異常，使用預設空值繼續運行。");
    console.warn(result.error.format());
  }

  const env = result.success ? result.data : fullSchema.parse({});

  // ── Core variable warnings ──
  const coreWarnings: Array<[string, string, string, string]> = [
    ["DATABASE_URL",       env.DATABASE_URL,       "資料庫連線",    "請設定 DATABASE_URL 為有效的 MySQL 連線字串。"],
    ["JWT_SECRET",         env.JWT_SECRET,         "JWT 認證",     "請設定 JWT_SECRET（建議用 openssl rand -base64 32 生成）。"],
    ["GOOGLE_CLIENT_ID",   env.GOOGLE_CLIENT_ID,   "Google OAuth", "前往 https://console.cloud.google.com/apis/credentials 建立 OAuth 用戶端。"],
    ["GOOGLE_CLIENT_SECRET", env.GOOGLE_CLIENT_SECRET, "Google OAuth", "同上，建立後複製用戶端密鑰。"],
    ["GEMINI_API_KEY",     env.GEMINI_API_KEY,     "Gemini LLM",  "前往 https://aistudio.google.com/apikey 取得金鑰。"],
  ];

  for (const [name, value, module, fix] of coreWarnings) {
    if (!value) oarsWarn(name, module, fix);
  }

  // ── Multimodal API key status summary ──
  const multimodalWarnings: Array<[string, string, string, string]> = [
    ["FAL_API_KEY",         env.FAL_API_KEY,         "Fal.ai（圖片/影片）",   "前往 https://fal.ai/dashboard/keys 取得。"],
    ["REPLICATE_API_TOKEN", env.REPLICATE_API_TOKEN, "Replicate（LoRA）",    "前往 https://replicate.com/account/api-tokens 取得。"],
    ["ELEVENLABS_API_KEY",  env.ELEVENLABS_API_KEY,  "ElevenLabs（語音）",   "前往 https://elevenlabs.io/app/settings/api-keys 取得。"],
    ["SUNO_API_KEY",        env.SUNO_API_KEY,        "Suno（音樂）",         "前往 Suno 開發者後台取得。"],
    ["PINECONE_API_KEY",    env.PINECONE_API_KEY,    "Pinecone（RAG 記憶）", "前往 https://app.pinecone.io 取得。"],
    ["NEWS_API_KEY",        env.NEWS_API_KEY,        "NewsAPI（新聞）",      "前往 https://newsapi.org/account 取得。"],
    ["NEWSDATA_API_KEY",    env.NEWSDATA_API_KEY,    "NewsData.io（新聞）",  "前往 https://newsdata.io 取得。"],
    ["LANGSMITH_API_KEY",   env.LANGSMITH_API_KEY,   "LangSmith（監控）",    "前往 https://smith.langchain.com 取得。"],
    ["BRAVE_SEARCH_API_KEY", env.BRAVE_SEARCH_API_KEY, "Brave Search（網路搜尋）", "前往 https://brave.com/search/api/ 取得。"],
    ["GCS_BUCKET_NAME",     env.GCS_BUCKET_NAME,     "GCS 儲存（媒體檔案）", "在 Google Cloud Console 建立 Storage Bucket。"],
  ];

  if (env.NODE_ENV === "development") {
    const set = multimodalWarnings.filter(([, v]) => v.length > 0);
    const missing = multimodalWarnings.filter(([, v]) => !v);
    console.info(`\n💡 API 金鑰狀態：${set.length}/${multimodalWarnings.length} 已設定`);
    if (missing.length > 0) {
      for (const [name, , module, fix] of missing) {
        console.info(`   ◦ ${name} — ${module} — ${fix}`);
      }
    }
    console.info("   以上金鑰為選用，僅在啟用對應模組時需要設定。\n");
  }

  return env;
}

// ─── Singleton Export ──────────────────────────────────────────────────────

/** Validated server environment — safe to destructure, never undefined */
export const serverEnv = validateAndWarn();

// ─── Helper: Runtime key check for lazy-loaded modules ─────────────────────

export function assertApiKey(
  keyName: keyof ServerEnvResult,
  moduleName: string
): boolean {
  const value = serverEnv[keyName];
  if (value && value.trim().length > 0) return true;
  oarsWarn(keyName, moduleName, `此功能需要 ${keyName}。請在 .env 中設定後重啟伺服器。`);
  return false;
}

export function getApiKey(keyName: keyof ServerEnvResult): string | undefined {
  const value = serverEnv[keyName];
  return value && value.trim().length > 0 ? value : undefined;
}
