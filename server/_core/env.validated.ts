/**
 * env.validated.ts — Zod-based environment variable validation with OARS-style warnings
 *
 * OARS (Observe → Acknowledge → Recommend → Suggest) pattern ensures that
 * missing API keys produce friendly, actionable console warnings instead of
 * hard crashes. This lets future developers onboard multimodal APIs (Fal,
 * Gemini, Pinecone, Suno, ElevenLabs) without wasting debugging credits.
 *
 * Usage: import { serverEnv } from "./env.validated";
 *        — all downstream code should read keys from serverEnv.*
 */

import { z } from "zod";

// ─── OARS Warning Formatter ────────────────────────────────────────────────
// Observe → Acknowledge → Recommend → Suggest

function oarsWarn(varName: string, module: string, howToFix: string): void {
  const divider = "─".repeat(60);
  console.warn(`
${divider}
⚠️  環境變數缺失提醒 — ${varName}
${divider}
【觀察】 偵測到 ${varName} 未設定或為空值。
【影響】 ${module} 模組將無法正常運作，但系統不會因此崩潰。
【建議】 ${howToFix}
【提示】 您可以在 Manus 管理介面的「Settings → Secrets」中設定此變數，
        或透過 .env 檔案在本地開發環境中配置。
${divider}
`);
}

// ─── Schema Definitions ────────────────────────────────────────────────────

/**
 * Core platform variables — required for the app to function at all.
 * These will emit a CRITICAL warning if missing but still won't crash.
 */
const coreSchema = z.object({
  VITE_APP_ID:              z.string().min(1).optional().default(""),
  JWT_SECRET:               z.string().min(1).optional().default(""),
  DATABASE_URL:             z.string().min(1).optional().default(""),
  OAUTH_SERVER_URL:         z.string().url().optional().default(""),
  OWNER_OPEN_ID:            z.string().min(1).optional().default(""),
  BUILT_IN_FORGE_API_URL:   z.string().url().optional().default(""),
  BUILT_IN_FORGE_API_KEY:   z.string().min(1).optional().default(""),
  NODE_ENV:                 z.string().optional().default("development"),
  PORT:                     z.string().optional().default("3000"),
});

/**
 * Multimodal API keys — optional, only needed when the corresponding
 * module is activated. Missing keys produce soft OARS warnings.
 */
const multimodalSchema = z.object({
  // Google Gemini (vision, multimodal reasoning)
  GEMINI_API_KEY:                       z.string().min(1).optional().default(""),
  GOOGLE_APPLICATION_CREDENTIALS_JSON:  z.string().min(1).optional().default(""),

  // Fal.ai (image/video generation)
  FAL_API_KEY:                          z.string().min(1).optional().default(""),

  // Suno (music generation)
  SUNO_API_KEY:                         z.string().min(1).optional().default(""),

  // ElevenLabs (voice synthesis)
  ELEVENLABS_API_KEY:                   z.string().min(1).optional().default(""),

  // Pinecone (vector database)
  PINECONE_API_KEY:                     z.string().min(1).optional().default(""),
  PINECONE_ENVIRONMENT:                 z.string().min(1).optional().default(""),

  // Replicate (model hosting)
  REPLICATE_API_TOKEN:                  z.string().min(1).optional().default(""),
});

// Combined schema
const fullSchema = coreSchema.merge(multimodalSchema);

// ─── Validation & Warning Emission ─────────────────────────────────────────

type ServerEnvResult = z.infer<typeof fullSchema>;

function validateAndWarn(): ServerEnvResult {
  // Parse with defaults — never throws, always returns a value
  const result = fullSchema.safeParse(process.env);

  if (!result.success) {
    // This shouldn't happen with all .optional().default("") but just in case
    console.warn("⚠️ 環境變數解析異常，使用預設空值繼續運行。");
    console.warn(result.error.format());
  }

  const env = result.success ? result.data : fullSchema.parse({});

  // ── Core variable warnings ──
  const coreWarnings: Array<[string, string, string, string]> = [
    ["DATABASE_URL",             env.DATABASE_URL,             "資料庫連線",     "請設定 DATABASE_URL 為有效的 MySQL/TiDB 連線字串。"],
    ["JWT_SECRET",               env.JWT_SECRET,               "JWT 認證",      "請設定 JWT_SECRET 用於 Session Cookie 簽名。"],
    ["VITE_APP_ID",              env.VITE_APP_ID,              "OAuth 認證",    "請設定 VITE_APP_ID 為 Manus OAuth 應用程式 ID。"],
    ["OAUTH_SERVER_URL",         env.OAUTH_SERVER_URL,         "OAuth 認證",    "請設定 OAUTH_SERVER_URL 為 Manus OAuth 後端基礎 URL。"],
    ["BUILT_IN_FORGE_API_URL",   env.BUILT_IN_FORGE_API_URL,   "LLM / 圖片生成", "請設定 BUILT_IN_FORGE_API_URL 為 Manus 內建 API 端點。"],
    ["BUILT_IN_FORGE_API_KEY",   env.BUILT_IN_FORGE_API_KEY,   "LLM / 圖片生成", "請設定 BUILT_IN_FORGE_API_KEY 為 Manus 內建 API 金鑰。"],
  ];

  for (const [name, value, module, fix] of coreWarnings) {
    if (!value) {
      oarsWarn(name, module, fix);
    }
  }

  // ── Multimodal API key warnings (soft, informational) ──
  const multimodalWarnings: Array<[string, string, string, string]> = [
    ["GEMINI_API_KEY",          env.GEMINI_API_KEY,          "Google Gemini（多模態推理）",    "前往 https://aistudio.google.com/apikey 取得金鑰。"],
    ["FAL_API_KEY",             env.FAL_API_KEY,             "Fal.ai（圖片/影片生成）",       "前往 https://fal.ai/dashboard/keys 取得金鑰。"],
    ["SUNO_API_KEY",            env.SUNO_API_KEY,            "Suno（AI 音樂生成）",          "前往 Suno 開發者後台取得 API 金鑰。"],
    ["ELEVENLABS_API_KEY",      env.ELEVENLABS_API_KEY,      "ElevenLabs（語音合成）",       "前往 https://elevenlabs.io/app/settings/api-keys 取得金鑰。"],
    ["PINECONE_API_KEY",        env.PINECONE_API_KEY,        "Pinecone（向量資料庫）",       "前往 https://app.pinecone.io 建立專案並取得 API 金鑰。"],
    ["REPLICATE_API_TOKEN",     env.REPLICATE_API_TOKEN,     "Replicate（模型託管）",        "前往 https://replicate.com/account/api-tokens 取得 Token。"],
  ];

  // Only warn about multimodal keys in development (don't spam production logs)
  if (env.NODE_ENV === "development") {
    const missingMultimodal = multimodalWarnings.filter(([, value]) => !value);
    if (missingMultimodal.length > 0) {
      console.info(`\n💡 多模態 API 金鑰狀態：${multimodalWarnings.length - missingMultimodal.length}/${multimodalWarnings.length} 已設定`);
      for (const [name, , module, fix] of missingMultimodal) {
        console.info(`   ◦ ${name} — ${module} — ${fix}`);
      }
      console.info("   以上金鑰為選用，僅在啟用對應模組時需要設定。\n");
    }
  }

  return env;
}

// ─── Singleton Export ──────────────────────────────────────────────────────

/** Validated server environment — safe to destructure, never undefined */
export const serverEnv = validateAndWarn();

// ─── Helper: Runtime key check for lazy-loaded modules ─────────────────────

/**
 * Check if a specific API key is available at runtime.
 * Use this in module entry points to provide early feedback.
 *
 * @example
 * if (!assertApiKey("ELEVENLABS_API_KEY", "ElevenLabs 語音合成")) return fallback;
 */
export function assertApiKey(
  keyName: keyof ServerEnvResult,
  moduleName: string
): boolean {
  const value = serverEnv[keyName];
  if (value && value.trim().length > 0) return true;

  oarsWarn(
    keyName,
    moduleName,
    `此功能需要 ${keyName}。請在環境變數中設定後重啟伺服器。`
  );
  return false;
}

/**
 * Get an API key value, returning undefined if not set.
 * Pairs with assertApiKey for guard-then-use patterns.
 */
export function getApiKey(keyName: keyof ServerEnvResult): string | undefined {
  const value = serverEnv[keyName];
  return value && value.trim().length > 0 ? value : undefined;
}
