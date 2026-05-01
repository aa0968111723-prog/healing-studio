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

// ─── Pre-validation Self-Repair ────────────────────────────────────────────
// 在 zod 解析之前先掃描 process.env，把幾個常見的人為錯誤就地修補：
//   • 變數名稱拼錯（例：NTHROPIC_API_KEY → ANTHROPIC_API_KEY）
//   • Pinecone 索引名含有非法字元 → 自動清洗
//   • JWT_ACCESS_TOKEN_EXPIRES_IN 寫成非數字 → 還原預設
//   • GOOGLE_APPLICATION_CREDENTIALS_JSON 不是 JSON → 視為未設定

interface SelfRepairLog {
  varName: string;
  action:
    | "renamed"
    | "sanitized"
    | "reset_to_default"
    | "ignored_invalid"
    | "ignored_placeholder";
  before: string;
  after: string;
  reason: string;
}

const selfRepairLog: SelfRepairLog[] = [];

function isLikelyJson(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * 是否為「明顯的佔位符」字串（例如 .env.example 中常見的 `your-xxx-api-key`、
 * `<your-key-here>`、`changeme` 等）。這類值若進到下游會引發 401/403 而非
 * 「未設定」的軟警告，反而比空值更難排查。
 */
function isPlaceholder(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.length === 0) return false;
  // 常見模板字串：以 `your-` / `your_` 開頭並帶 -api / -key / -token 等關鍵字
  if (/^<?your[-_].*(key|token|secret|id|url|credential)/i.test(v)) return true;
  // 以尖括號包起來的範本：<your-xxx>
  if (/^<.*>$/.test(v) && /your|placeholder|fillme|changeme/.test(v)) return true;
  // 純粹寫 changeme / placeholder
  if (["changeme", "placeholder", "fillme", "todo", "tbd"].includes(v)) return true;
  return false;
}

function selfRepairEnv(): void {
  const env = process.env;

  // 1) 修補常見變數名稱錯字（aliases → 標準名稱）
  const ALIASES: Record<string, string> = {
    NTHROPIC_API_KEY: "ANTHROPIC_API_KEY", // 缺前綴 A
    ANTROPIC_API_KEY: "ANTHROPIC_API_KEY", // 少一個 H
    NVIDA_API: "NVIDIA_API",                // 少一個 I
    FAL_KEY: "FAL_API_KEY",                  // 別名
  };
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    const aliasVal = env[alias];
    if (aliasVal && aliasVal.trim().length > 0 && !env[canonical]) {
      env[canonical] = aliasVal;
      selfRepairLog.push({
        varName: alias,
        action: "renamed",
        before: alias,
        after: canonical,
        reason: `偵測到拼字錯誤的別名 ${alias}，已自動映射到 ${canonical}`,
      });
    }
  }

  // 2) Pinecone 索引名只允許 [a-z0-9-]；若含非法字元就強制重設預設值
  const idx = env.PINECONE_INDEX_NAME;
  if (idx && idx.trim().length > 0) {
    const cleaned = idx.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!/^[a-z0-9-]+$/.test(idx) || cleaned.length === 0) {
      const replacement = "ai-director-memories";
      selfRepairLog.push({
        varName: "PINECONE_INDEX_NAME",
        action: "sanitized",
        before: idx,
        after: replacement,
        reason: "Pinecone 索引名只允許小寫英數與連字號，已重置為安全預設值",
      });
      env.PINECONE_INDEX_NAME = replacement;
    }
  }

  // 3) JWT_ACCESS_TOKEN_EXPIRES_IN 必須是純數字（秒數）
  const ttl = env.JWT_ACCESS_TOKEN_EXPIRES_IN;
  if (ttl && ttl.trim().length > 0 && !/^\d+$/.test(ttl.trim())) {
    selfRepairLog.push({
      varName: "JWT_ACCESS_TOKEN_EXPIRES_IN",
      action: "reset_to_default",
      before: ttl,
      after: "31536000",
      reason: "TTL 必須是整數秒數；偵測到非數字，已還原預設 31536000 秒（1 年）",
    });
    env.JWT_ACCESS_TOKEN_EXPIRES_IN = "31536000";
  }

  // 4) GOOGLE_APPLICATION_CREDENTIALS_JSON 必須是合法 JSON
  const gac = env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (gac && gac.trim().length > 0 && !isLikelyJson(gac)) {
    selfRepairLog.push({
      varName: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      action: "ignored_invalid",
      before: gac.length > 30 ? `${gac.slice(0, 30)}…(${gac.length} chars)` : gac,
      after: "(empty)",
      reason: "不是合法 JSON 格式，視為未設定以避免 Vertex AI 啟動時崩潰",
    });
    env.GOOGLE_APPLICATION_CREDENTIALS_JSON = "";
  }

  // 5) 清掃明顯的佔位符值（your-xxx-api-key / <your-key> / changeme …）
  //    若放著不處理，下游會在第一次呼叫 API 時拿到 401/403，看起來像
  //    「金鑰失效」其實是「根本沒填」。直接視為未設定，讓 OARS 軟警告生效。
  const PLACEHOLDER_CANDIDATES = [
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "FAL_API_KEY",
    "REPLICATE_API_TOKEN",
    "ELEVENLABS_API_KEY",
    "SUNO_API_KEY",
    "PINECONE_API_KEY",
    "PERPLEXITY_API_KEY",
    "OPENPOSE_API_KEY",
    "BRAVE_SEARCH_API_KEY",
    "NEWS_API_KEY",
    "NEWSDATA_API_KEY",
    "LANGSMITH_API_KEY",
    "POSTHOG_API_KEY",
    "VITE_POSTHOG_KEY",
    "NVIDIA_API",
    "GITHUB_TOKEN",
    "DISCORD_WEBHOOK_URL",
    "REDIS_URL",
  ];
  for (const key of PLACEHOLDER_CANDIDATES) {
    const value = env[key];
    if (value && isPlaceholder(value)) {
      selfRepairLog.push({
        varName: key,
        action: "ignored_placeholder",
        before: value,
        after: "(empty)",
        reason: `偵測到範本字串（${value}），視為未設定以避免 401/403 噪音`,
      });
      env[key] = "";
    }
  }

  // 6) LangSmith 金鑰必須以 `lsv2_pt_` 或 `lsv2_sk_` 開頭；其他格式（例如
  //    `id:xxxx-xxx`）會在第一次 trace 時收到 403 Forbidden。直接視為未設定，
  //    避免 LangChain SDK 一直噴錯。
  const ls = env.LANGSMITH_API_KEY;
  if (ls && ls.trim().length > 0 && !/^lsv2_(pt|sk)_/.test(ls.trim())) {
    selfRepairLog.push({
      varName: "LANGSMITH_API_KEY",
      action: "ignored_invalid",
      before: ls.length > 20 ? `${ls.slice(0, 20)}…` : ls,
      after: "(empty)",
      reason:
        "LangSmith 金鑰必須以 lsv2_pt_ 或 lsv2_sk_ 開頭，偵測到非標準格式，視為未設定",
    });
    env.LANGSMITH_API_KEY = "";
  }

  if (selfRepairLog.length > 0 && env.NODE_ENV !== "test") {
    const divider = "─".repeat(60);
    console.warn(`\n${divider}\n🩹  環境變數自動修復報告（${selfRepairLog.length} 項）\n${divider}`);
    for (const entry of selfRepairLog) {
      console.warn(`  • [${entry.action}] ${entry.varName}: ${entry.reason}`);
    }
    console.warn(`${divider}\n`);
  }
}

selfRepairEnv();

/** 暴露自我修復記錄供大腦組態觀察用（不含敏感原值） */
export function getEnvSelfRepairLog(): ReadonlyArray<{
  varName: string;
  action: SelfRepairLog["action"];
  reason: string;
}> {
  return selfRepairLog.map(({ varName, action, reason }) => ({
    varName,
    action,
    reason,
  }));
}

// ─── Schema Definitions ────────────────────────────────────────────────────

/**
 * Core platform variables — required for the app to function at all.
 */
const coreSchema = z.object({
  NODE_ENV: z.string().optional().default("development"),
  PORT: z.string().optional().default("3000"),
  BASE_URL: z.string().optional().default(""),
  JWT_SECRET: z.string().min(1).optional().default(""),
  JWT_ACCESS_TOKEN_EXPIRES_IN: z.string().optional().default("31536000"),
  PASSWORD_HASH_ALGORITHM: z
    .enum(["scrypt", "bcrypt", "argon2"])
    .default("scrypt"),
  DATABASE_URL: z.string().min(1).optional().default(""),

  // ── Google OAuth 2.0（替換 Manus OAuth）──────────────────
  GOOGLE_CLIENT_ID: z.string().min(1).optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional().default(""),
  // Empty default → server derives `<proto>://<host>/api/oauth/callback`
  // from the request, so production works without manual env setup.
  GOOGLE_REDIRECT_URI: z.string().optional().default(""),

  // ── Google Cloud Platform ─────────────────────────────────
  GOOGLE_CLOUD_PROJECT_ID: z.string().min(1).optional().default(""),
  GOOGLE_CLOUD_LOCATION: z.string().optional().default("us-central1"),
  GOOGLE_APPLICATION_CREDENTIALS_JSON: z.string().min(1).optional().default(""),
  GCS_BUCKET_NAME: z.string().min(1).optional().default(""),

  // ── S3 相容儲存（Cloudflare R2 / AWS S3 / MinIO 等）──────
  // 在 Railway 環境變數中設定以下四個即可啟用 Cloudflare R2：
  //   S3_ENDPOINT          = https://<ACCOUNT_ID>.r2.cloudflarestorage.com
  //   S3_ACCESS_KEY_ID     = <R2 Access Key ID>
  //   S3_SECRET_ACCESS_KEY = <R2 Secret Access Key>
  //   S3_BUCKET_NAME       = <bucket 名稱>
  //   S3_PUBLIC_URL        = https://pub-xxxx.r2.dev  （選填，R2 公開網域）
  //   S3_PUBLIC_DOMAIN     = 同上，向後相容別名
  //   S3_REGION            = auto                      （選填，R2 固定 auto）
  S3_ENDPOINT: z.string().optional().default(""),
  S3_ACCESS_KEY_ID: z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
  S3_BUCKET_NAME: z.string().optional().default(""),
  S3_PUBLIC_URL: z.string().optional().default(""),
  S3_PUBLIC_DOMAIN: z.string().optional().default(""),
  S3_REGION: z.string().optional().default("auto"),

  // ── 管理員信箱（逗號分隔，登入時自動設為 admin）─────────
  ADMIN_EMAILS: z.string().optional().default(""),

  // ── 分散式快取 / 排程鎖（沒設則 fallback 到記憶體版）─────
  REDIS_URL: z.string().optional().default(""),
  REDIS_KEY_PREFIX: z.string().optional().default("healing-studio:"),

  // ── 健康巡檢警報（沒設則靜默跳過）────────────────────────
  DISCORD_WEBHOOK_URL: z.string().optional().default(""),

  // ── API 用量告警（沒設則靜默跳過）─────────────────────────
  // ALERT_SLACK_WEBHOOK：Slack incoming webhook URL，每 15 分鐘 cron 觸發
  // ALERT_EMAIL_RECIPIENTS：逗號分隔，目前 cron 只實作 Slack；保留欄位以便未來擴充
  // AI_MONTHLY_BUDGET_USD：當月 AI 預算（美金），預設 500；用於 budget alert
  ALERT_SLACK_WEBHOOK: z.string().optional().default(""),
  ALERT_EMAIL_RECIPIENTS: z.string().optional().default(""),
  AI_MONTHLY_BUDGET_USD: z.string().optional().default("500"),

  // ── Stripe 收款（沒設則跳過 webhook 簽章驗證 / 不建立訂單）─
  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),

  // ── 向後相容：Manus Forge API（遷移完成後可移除）─────────
  VITE_APP_ID: z.string().optional().default(""),
  OAUTH_SERVER_URL: z.string().optional().default(""),
  OWNER_OPEN_ID: z.string().optional().default(""),
  BUILT_IN_FORGE_API_URL: z.string().optional().default(""),
  BUILT_IN_FORGE_API_KEY: z.string().optional().default(""),
  FRONTEND_FORGE_API_URL: z
    .string()
    .optional()
    .default("https://forge.butterfly-effect.dev"),
  FRONTEND_FORGE_API_KEY: z.string().optional().default(""),
});

/**
 * Multimodal API keys — optional, only needed when the corresponding
 * module is activated. Missing keys produce soft OARS warnings.
 */
const multimodalSchema = z.object({
  // ── Vertex AI / Gemini（LLM 主引擎）─────────────────────
  GEMINI_API_KEY: z.string().min(1).optional().default(""),

  // ── 圖片 / 影片生成 ──────────────────────────────────────
  FAL_API_KEY: z.string().min(1).optional().default(""),
  // Fal.ai Webhook 簽章共享密鑰（HMAC-SHA256 驗證 webhook payload）
  // 必須與 FAL_API_KEY 不同；建議用 `openssl rand -hex 32` 生成獨立隨機值
  FAL_WEBHOOK_SECRET: z.string().optional().default(""),
  REPLICATE_API_TOKEN: z.string().min(1).optional().default(""),

  // ── 音訊 / 語音生成 ──────────────────────────────────────
  ELEVENLABS_API_KEY: z.string().min(1).optional().default(""),
  SUNO_API_KEY: z.string().min(1).optional().default(""),

  // ── 向量資料庫（RAG 記憶系統）───────────────────────────
  PINECONE_API_KEY: z.string().min(1).optional().default(""),
  PINECONE_ENVIRONMENT: z.string().min(1).optional().default("us-east-1"),
  PINECONE_INDEX_NAME: z
    .string()
    .min(1)
    .optional()
    .default("ai-director-memories"),

  // ── 新聞資料來源 ─────────────────────────────────────────
  NEWS_API_KEY: z.string().min(1).optional().default(""),
  NEWSDATA_API_KEY: z.string().min(1).optional().default(""),

  // ── AI 監控（LangSmith）──────────────────────────────────
  LANGSMITH_API_KEY: z.string().min(1).optional().default(""),
  LANGSMITH_PROJECT: z.string().optional().default("網站"),
  LANGCHAIN_TRACING_V2: z.string().optional().default("true"),
  LANGCHAIN_ENDPOINT: z
    .string()
    .optional()
    .default("https://api.smith.langchain.com"),

  // ── LLM 引擎路由選擇 ──────────────────────────────────────
  // auto      = 偵測 OPENROUTER_API_KEY 並優先使用，否則退回到舊的多引擎路由
  // openrouter = 強制走 OpenRouter（推薦：一支金鑰即可使用 Claude / Gemini / GPT 等所有家）
  // 其他選項保留向後相容；若您想全面遷移到 OpenRouter，把 OPENROUTER_API_KEY 設好即可
  LLM_ENGINE: z
    .enum(["auto", "openrouter", "gemini", "vertex", "forge", "nvidia", "anthropic"])
    .optional()
    .default("auto"),

  // ── OpenRouter（統一 LLM 閘道，OpenAI 相容）─────────────
  // 取得金鑰：https://openrouter.ai/keys
  // 模型 ID 格式：<provider>/<model>，例：anthropic/claude-sonnet-4.5、google/gemini-2.5-pro
  OPENROUTER_API_KEY: z.string().min(1).optional().default(""),
  OPENROUTER_BASE_URL: z
    .string()
    .optional()
    .default("https://openrouter.ai/api/v1"),
  OPENROUTER_HTTP_REFERER: z.string().optional().default(""),
  OPENROUTER_X_TITLE: z.string().optional().default("Healing Studio"),
  ENABLE_SCHEMA_FIRST_PLANNER: z.string().optional().default("true"),
  VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS: z.string().optional().default("true"),
  VITE_ENABLE_GLOBAL_AGENT_TELEMETRY: z.string().optional().default("false"),
  ENABLE_ORB_TASK_STATE_MACHINE: z.string().optional().default("true"),
  ENABLE_ORB_TASK_MEMORY: z.string().optional().default("true"),
  ENABLE_ORB_TASK_RECOVERY: z.string().optional().default("true"),
  ENABLE_ORB_TASK_EXECUTOR: z.string().optional().default("true"),
  ENABLE_ORB_LONG_TERM_MEMORY: z.string().optional().default("true"),
  ENABLE_ORB_CODE_COLLABORATION: z.string().optional().default("true"),
  ENABLE_CLAUDE_CODE_TASKS: z.string().optional().default("true"),
  ENABLE_CODEX_TASKS: z.string().optional().default("false"),
  ENABLE_ORB_PROVIDER_ROUTER: z.string().optional().default("true"),
  ENABLE_ORB_COST_GUARD: z.string().optional().default("true"),
  ENABLE_ORB_QUOTA_GUARD: z.string().optional().default("false"),
  ENABLE_ORB_IDEMPOTENCY_GUARD: z.string().optional().default("false"),
  /**
   * Whether the orb's `ai.chat` route runs a web-research stage (Brave +
   * GitHub fallback) for research-style user questions. Defaults to "true";
   * set to "false" to disable network calls without removing the code path.
   */
  ENABLE_ORB_WEB_RESEARCH: z.string().optional().default("true"),
  ENABLE_GLOBAL_AGENT_CAPABILITY_REGISTRY: z.string().optional().default("true"),
  ENABLE_GLOBAL_AGENT_TOOL_REGISTRY: z.string().optional().default("true"),

  // ── MiniMax M2.7 via NVIDIA NIM（光球 AI 代理人引擎）──────────────────────

  // ── Brave Search API ──────────────────────────────────────
  BRAVE_SEARCH_API_KEY: z.string().min(1).optional().default(""),
  PERPLEXITY_API_KEY: z.string().min(1).optional().default(""),

  // ── 姿勢估測 ─────────────────────────────────────────────
  OPENPOSE_API_KEY: z.string().min(1).optional().default(""),

  // ── NVIDIA NIM（MiniMax M2.7 等第三方模型） ────────────────────────
  // DEF-13 修正：統一定義 NVIDIA_API（注意：Railway 變數名稱必須為 NVIDIA_API，而非 NVIDA_API）
  NVIDIA_API: z.string().min(1).optional().default(""),

  // ── Anthropic Claude（光球 AI 代理人主引擎，最佳 tool use）──────────
  ANTHROPIC_API_KEY: z.string().min(1).optional().default(""),

  // ── GitHub 整合（AI 全站研究系統 → 自動建立 Issue / PR）─────────────
  GITHUB_TOKEN: z.string().min(1).optional().default(""),
  GITHUB_REPO: z.string().optional().default(""),

  // ── PostHog 後端事件追蹤（前端走 VITE_POSTHOG_KEY） ─────────────────
  POSTHOG_API_KEY: z.string().min(1).optional().default(""),
  POSTHOG_HOST: z.string().optional().default("https://us.i.posthog.com"),

  // ── Orb Webhook（n8n / Zapier / Make 觸發 POST /api/webhooks/orb）─────
  // 共享密鑰：請求 header `x-orb-webhook-secret` 必須等於此值，否則 401
  ORB_WEBHOOK_SECRET: z.string().optional().default(""),
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
  const isTestEnv = env.NODE_ENV === "test";

  // ── Core variable warnings ──
  const coreWarnings: Array<[string, string, string, string]> = [
    [
      "DATABASE_URL",
      env.DATABASE_URL,
      "資料庫連線",
      "請設定 DATABASE_URL 為有效的 MySQL 連線字串。",
    ],
    [
      "JWT_SECRET",
      env.JWT_SECRET,
      "JWT 認證",
      "請設定 JWT_SECRET（建議用 openssl rand -base64 32 生成）。",
    ],
    [
      "GOOGLE_CLIENT_ID",
      env.GOOGLE_CLIENT_ID,
      "Google OAuth",
      "前往 https://console.cloud.google.com/apis/credentials 建立 OAuth 用戶端。",
    ],
    [
      "GOOGLE_CLIENT_SECRET",
      env.GOOGLE_CLIENT_SECRET,
      "Google OAuth",
      "同上，建立後複製用戶端密鑰。",
    ],
    [
      "GEMINI_API_KEY",
      env.GEMINI_API_KEY,
      "Gemini LLM",
      "前往 https://aistudio.google.com/apikey 取得金鑰。",
    ],
  ];

  for (const [name, value, module, fix] of coreWarnings) {
    if (!value && !isTestEnv) oarsWarn(name, module, fix);
  }

  // ── Multimodal API key status summary ──
  const multimodalWarnings: Array<[string, string, string, string]> = [
    [
      "OPENROUTER_API_KEY",
      env.OPENROUTER_API_KEY,
      "OpenRouter（統一 LLM 閘道，推薦）",
      "前往 https://openrouter.ai/keys 取得；用一支金鑰即可呼叫 Claude / Gemini / GPT 等所有家。",
    ],
    [
      "FAL_API_KEY",
      env.FAL_API_KEY,
      "Fal.ai（圖片/影片）",
      "前往 https://fal.ai/dashboard/keys 取得。",
    ],
    [
      "REPLICATE_API_TOKEN",
      env.REPLICATE_API_TOKEN,
      "Replicate（LoRA）",
      "前往 https://replicate.com/account/api-tokens 取得。",
    ],
    [
      "ELEVENLABS_API_KEY",
      env.ELEVENLABS_API_KEY,
      "ElevenLabs（語音）",
      "前往 https://elevenlabs.io/app/settings/api-keys 取得。",
    ],
    [
      "SUNO_API_KEY",
      env.SUNO_API_KEY,
      "Suno（音樂）",
      "前往 Suno 開發者後台取得。",
    ],
    [
      "PINECONE_API_KEY",
      env.PINECONE_API_KEY,
      "Pinecone（RAG 記憶）",
      "前往 https://app.pinecone.io 取得。",
    ],
    [
      "NEWS_API_KEY",
      env.NEWS_API_KEY,
      "NewsAPI（新聞）",
      "前往 https://newsapi.org/account 取得。",
    ],
    [
      "NEWSDATA_API_KEY",
      env.NEWSDATA_API_KEY,
      "NewsData.io（新聞）",
      "前往 https://newsdata.io 取得。",
    ],
    [
      "LANGSMITH_API_KEY",
      env.LANGSMITH_API_KEY,
      "LangSmith（監控）",
      "前往 https://smith.langchain.com 取得。",
    ],
    [
      "BRAVE_SEARCH_API_KEY",
      env.BRAVE_SEARCH_API_KEY,
      "Brave Search（網路搜尋）",
      "前往 https://brave.com/search/api/ 取得。",
    ],
    [
      "PERPLEXITY_API_KEY",
      env.PERPLEXITY_API_KEY,
      "Perplexity API（研究/搜尋）",
      "前往 https://www.perplexity.ai/settings/api 取得。",
    ],
    [
      "GCS_BUCKET_NAME",
      env.GCS_BUCKET_NAME,
      "GCS 儲存（媒體檔案）",
      "在 Google Cloud Console 建立 Storage Bucket。",
    ],
    [
      "GITHUB_TOKEN",
      env.GITHUB_TOKEN,
      "AI 全站研究 → GitHub Issue 自動建立",
      "前往 https://github.com/settings/tokens 建立 fine-grained PAT，授予 Issues: Read & write 權限。",
    ],
    [
      "GITHUB_REPO",
      env.GITHUB_REPO,
      "AI 全站研究目標倉庫",
      "格式 owner/repo，例如 your-org/healing-studio。",
    ],
    [
      "POSTHOG_API_KEY",
      env.POSTHOG_API_KEY,
      "PostHog 後端事件追蹤",
      "前往 https://us.posthog.com/settings/project 取得 Project API Key。",
    ],
    [
      "DISCORD_WEBHOOK_URL",
      env.DISCORD_WEBHOOK_URL,
      "API 健康巡檢 Discord 告警",
      "在 Discord server 設定 → 整合 → Webhook 取得；不需要則保持空白。",
    ],
    [
      "REDIS_URL",
      env.REDIS_URL,
      "分散式快取 / 排程鎖",
      "Railway 加 Redis plugin 後會自動注入；單機部署可保持空白（fallback 到記憶體）。",
    ],
  ];

  if (env.NODE_ENV === "development") {
    const set = multimodalWarnings.filter(([, v]) => v.length > 0);
    const missing = multimodalWarnings.filter(([, v]) => !v);
    console.info(
      `\n💡 API 金鑰狀態：${set.length}/${multimodalWarnings.length} 已設定`
    );
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
  oarsWarn(
    keyName,
    moduleName,
    `此功能需要 ${keyName}。請在 .env 中設定後重啟伺服器。`
  );
  return false;
}

export function getApiKey(keyName: keyof ServerEnvResult): string | undefined {
  const value = serverEnv[keyName];
  return value && value.trim().length > 0 ? value : undefined;
}
