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

function isUnresolvedRailwayTemplate(value: string): boolean {
  const v = value.trim();
  // Railway variable-reference syntax, e.g. `${{MySQL.MYSQL_URL}}`.
  return /^\$\{\{[^}]+\}\}$/.test(v);
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
    // ── 認證密鑰別名：AUTH_SECRET 為使用者習慣命名，內部統一用 JWT_SECRET ──
    AUTH_SECRET: "JWT_SECRET",
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

  // 1b) JWT_SECRET 正規化（AIDV-59，H4 JWT 硬化）：去除前後空白。
  //     env 值是逐字存的，複製貼上常帶尾端換行（Railway/.env 常見），
  //     若不集中正規化，session 層、webhookTokens、sdk、secretCrypto 會對
  //     「同一密鑰」有不同解讀（trim 與否派生出不同簽章/加密金鑰）。
  //     在 zod 解析前就地 trim，讓 serverEnv.JWT_SECRET / process.env.JWT_SECRET
  //     自始即為單一真值，所有下游一致；同時把原始（未 trim）值保留在
  //     JWT_SECRET_RAW，供 session 驗證做向後相容 fallback（見 googleAuth）。
  const jwtRaw = env.JWT_SECRET;
  if (jwtRaw && jwtRaw !== jwtRaw.trim()) {
    // 保留原值供驗證 fallback；只在實際有差異時設定，避免污染無空白的常態。
    env.JWT_SECRET_RAW = jwtRaw;
    env.JWT_SECRET = jwtRaw.trim();
    selfRepairLog.push({
      varName: "JWT_SECRET",
      action: "sanitized",
      before: `(${jwtRaw.length} chars, 含前後空白)`,
      after: `(${env.JWT_SECRET.length} chars, 已 trim)`,
      reason:
        "JWT_SECRET 含前後空白，已正規化（trim）以統一所有下游簽章/加密；" +
        "原值保留於 JWT_SECRET_RAW 供既有 session token 向後相容驗證（AIDV-59）",
    });
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
      after: "2592000",
      reason: "TTL 必須是整數秒數；偵測到非數字，已還原預設 2592000 秒（30 天，AIDV-59）",
    });
    env.JWT_ACCESS_TOKEN_EXPIRES_IN = "2592000";
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

  // 7) DATABASE_URL 若仍是 Railway 模板字串（未被平台展開），視為未設定。
  //    否則 mysql2 會嘗試用字面 `${{...}}` 連線，啟動時產生誤導性的連線錯誤。
  const databaseUrl = env.DATABASE_URL;
  if (databaseUrl && isUnresolvedRailwayTemplate(databaseUrl)) {
    selfRepairLog.push({
      varName: "DATABASE_URL",
      action: "ignored_invalid",
      before: databaseUrl,
      after: "(empty)",
      reason:
        "偵測到未展開的 Railway 模板字串，已視為未設定；請確認 Variables 引用是否成功展開",
    });
    env.DATABASE_URL = "";
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
  // AIDV-59（H4 JWT 硬化）：新發 token 預設壽命 30 天（2592000 秒），由 ~1 年縮短而來。
  // 已簽發舊 token 各自帶 exp，不受此變更影響（不會大規模登出）。
  JWT_ACCESS_TOKEN_EXPIRES_IN: z.string().optional().default("2592000"),
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

  // ── 分散式快取 / 鎖（沒設則 fallback 到記憶體版）──────────
  // AIDV-20：REDIS_URL 一旦設定（Railway Redis 服務注入），開機時
  //   initGenerationLockBackend() 會把「生成防重複鎖」從 per-process 記憶體版
  //   升級為跨實例的 Redis 版（SET NX PX + Lua CAS-del），多 replica 也能防重複。
  //   未設＝維持記憶體版（單機正確、零行為改變）。Redis 不可用一律 fail-open。
  //   cache.ts / rateLimiter.ts 目前仍是記憶體版，可日後共用同一 client 升級。
  REDIS_URL: z.string().optional().default(""),
  // 鎖鍵會再前綴此值（例 healing-studio:gen-lock:...），與專案 Redis 命名空間共存。
  REDIS_KEY_PREFIX: z.string().optional().default("healing-studio:"),

  // ── 生成防重複提交鎖（AIDV-20）────────────────────────────
  // ENABLE_GENERATION_LOCK：預設 ON（"" / 任何非 "false"/"0" 皆視為開啟）。
  // 這是「防同一使用者把同一個生成請求重複併發提交」的便利鎖，不是安全控制。
  // fail-open：鎖後端（目前記憶體版，沒接 Redis）不可用 / 逾時 / 出錯時一律放行
  // 生成、只記 warning——絕不能因為鎖有問題讓使用者無法生成。設 "false" 完全停用
  // （行為等同永遠放行）。詳見 server/_core/generationLock.ts。
  ENABLE_GENERATION_LOCK: z.string().optional().default("true"),

  // AIDV-67：刪資產時連動刪掉 R2/儲存物件（避免孤兒長期占空間）。預設 ON。
  // best-effort：刪物件失敗只記 log、不阻塞刪除（最壞退回「留孤兒」舊行為）。
  // 設 "false"/"0"/"off" 可即時關（無需重部署）。詳見 routers asset.delete。
  ENABLE_ASSET_R2_CASCADE_DELETE: z.string().optional().default("true"),

  // ── 健康巡檢警報（沒設則靜默跳過）────────────────────────
  DISCORD_WEBHOOK_URL: z.string().optional().default(""),

  // ── 錯誤追蹤 Sentry（AIDV-58 H3；未設 = 完全 no-op，不報錯、不阻塞）────────
  // SENTRY_DSN：Sentry 專案 DSN（https://<key>@<org>.ingest.sentry.io/<project>）。
  //   留空 → 不初始化 Sentry client，錯誤只走既有 logger / globalErrorHandler。
  // SENTRY_ENVIRONMENT：上報時標記的環境（production/staging/development）；留空時退回 NODE_ENV。
  // SENTRY_TRACES_SAMPLE_RATE：效能追蹤取樣率字串，預設 "0.1"（10%）；下游 parseFloat 後使用。
  // 注意：@sentry/node 為「選用」相依——若 Railway 未安裝該套件，errorTracking.ts
  //   會 catch 動態 import 失敗並 no-op，不影響開機與請求路徑。
  SENTRY_DSN: z.string().optional().default(""),
  SENTRY_ENVIRONMENT: z.string().optional().default(""),
  SENTRY_TRACES_SAMPLE_RATE: z.string().optional().default("0.1"),

  // ── SSE 訂閱鎖門開關（AIDV-58 H3）──────────────────────────────────────────
  // 預設「安全 = ON」：SSE generation/training 事件訂閱前強制登入＋擁有權檢查（修 IDOR）。
  // 僅當鎖門意外擋到合法擁有者、需緊急回退時，把此值設為 "false"/"0" 暫時放行
  //   （仍保留登入要求，只略過擁有權比對）。預設與留空皆為鎖門 ON。
  // demo（getDb()===null）一律安全降級，不受此旗標影響。
  SSE_OWNERSHIP_LOCKDOWN: z.string().optional().default("true"),

  // ── Migration fail-closed 開機門（AIDV-61 H6）─────────────────────────────
  // 預設「OFF = fail-open，維持現狀」（風險最低）：migration「真的套用失敗」時
  //   記錄 [Database] Migration failed 後照常服務（現有 prod 行為，零變化）。
  // 設為 "true"/"1"/"on"/"yes" → fail-closed ON：migration 真實 apply 失敗時印出
  //   清楚的致命 log（含哪個 migration、錯誤）後 **擋啟動**（throw 往上傳，由
  //   bootstrap fatal handler process.exit(1)），讓 /api/health 失敗、Railway
  //   偵測不健康 → 自動重啟（restartPolicyMaxRetries）或人工回滾到上一個正常版本。
  // demo / 無 DATABASE_URL 完全不受影響：該情境本就跳過 runMigrations（getDb()
  //   回 null、applyMigrations 不被呼叫），fail-closed 只在「真的嘗試套用且失敗」
  //   時才生效，旗標 ON 也絕不會讓 demo 開不了機。
  // fail-closed 只對「真實 apply 錯誤」生效，不對「冪等重跑/已套用」誤判（既有
  //   migration 都用 information_schema 守門、重跑會成功，不進 catch）。
  MIGRATION_FAIL_CLOSED: z.string().optional().default("false"),

  // ── 內容審核 fail-closed 安全門（AIDV-65）─────────────────────────────────
  // 預設「ON = fail-closed」（safety > availability）：checkSafety（server/routers.ts
  //   的 LLM 內容審核）在「逾時／錯誤／無法可靠解析」時 **擋下** 內容（回
  //   { safe:false, reason }），不放行未經審核的內容；fal 生成呼叫的
  //   enable_safety_checker 在唯一 live 注入點（videoStudio.wanTextToVideo）開回 true。
  // 與一般可用性鎖（預設 OFF）方向相反：這是內容審核**安全控制**，刻意預設 fail-closed。
  // 緊急回退是「明確人工決定」而非預設：明確設為 "false"/"0"/"off"/"no" 才回退 fail-open
  //   （checkSafety 失敗放行、fal enable_safety_checker 維持現值），其餘（含留空、未設、
  //   "true"/"1"/"on"/"yes"）皆為 fail-closed ON。
  // 與 LLM 不可用的交互（誠實揭露 — 勿再寫成「無新增負面影響」）：checkSafety 透過
  //   invokeLLM 走同一條 LLM 路由，LLM 無額度／金鑰失效時必然逾時/錯誤 → fail-closed
  //   會擋下 generate.multimodal / submitMultimodalAsync 的生成。注意其**下游**
  //   compileElitePrompt 對 LLM 故障是 graceful fallback（回退原始 prompt 後**照樣產圖**），
  //   故舊 fail-open 在 LLM 掛掉時仍會出圖；fail-closed **確實新增**擋下這兩端點的生成
  //   ——這是刻意的安全取捨（不放行未審內容），**非無影響**。合理 timeout＋一次重試避免
  //   「審核服務一抖動就永久卡死所有生成」；緊急回退設 CONTENT_SAFETY_FAIL_CLOSED=false。
  CONTENT_SAFETY_FAIL_CLOSED: z.string().optional().default("true"),

  // ── API 用量告警（沒設則靜默跳過）─────────────────────────
  // ALERT_SLACK_WEBHOOK：Slack incoming webhook URL，每 15 分鐘 cron 觸發
  // ALERT_EMAIL_RECIPIENTS：逗號分隔，目前 cron 只實作 Slack；保留欄位以便未來擴充
  // AI_MONTHLY_BUDGET_USD：當月 AI 預算（美金），預設 500；用於 budget alert
  ALERT_SLACK_WEBHOOK: z.string().optional().default(""),
  ALERT_EMAIL_RECIPIENTS: z.string().optional().default(""),
  AI_MONTHLY_BUDGET_USD: z.string().optional().default("500"),

  // ── 效能調節（皆為純數字字串，下游 parseInt 後使用）─────────
  // CACHE_TTL_SECONDS：LRU 快取預設 TTL（秒），cache.ts 的 DEFAULT_TTL_SECONDS
  // LLM_TIMEOUT_SECONDS：所有 LLM 呼叫的 AbortSignal timeout（秒），llm.ts 全域生效
  // MAX_CONCURRENT_LLM_CALLS：同時並行的 LLM 呼叫上限，超過排隊（_core/llmConcurrency.ts）
  // SENSE_INTENT_TIMEOUT_SECONDS：Sense intent 推論的 withTimeout 上限（秒），預設 45
  CACHE_TTL_SECONDS: z.string().optional().default("300"),
  LLM_TIMEOUT_SECONDS: z.string().optional().default("60"),
  MAX_CONCURRENT_LLM_CALLS: z.string().optional().default("5"),
  SENSE_INTENT_TIMEOUT_SECONDS: z.string().optional().default("45"),

  // ── Stripe 收款 ─────────────────────────────────────────
  // STRIPE_SECRET_KEY：Stripe API 私鑰（建立訂單／訂閱）。
  // STRIPE_WEBHOOK_SECRET：webhook 簽章用 signing secret（whsec_...），驗 HMAC。
  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  // AIDV-159：STRIPE_WEBHOOK_SECRET 未設定時是否 fail-closed（拒絕未驗證的 webhook）。
  //   只管「密鑰留空」這個情境；密鑰有設時簽章不符一律拒絕，與此旗標無關。
  //   留空／未設（預設）→ 只有 production fail-closed；dev/test 放行骨架以利本機開發。
  //   明確 "false"/"0"/"off"/"no" → 一律 fail-open（緊急回退，連 prod 也放行）。
  //   明確 "true"/"1"/"on"/"yes"  → 一律 fail-closed（連 dev 也拒絕，方便 staging 演練）。
  STRIPE_WEBHOOK_FAIL_CLOSED: z.string().optional().default(""),

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
  // AIDV-158（FAL webhook 資安硬化）：/api/webhook/fal 的「嚴格模式」總開關。
  // **預設 ON＝fail-closed**（safety > availability），與 CONTENT_SAFETY_FAIL_CLOSED 同向。
  // 旗標 ON（預設／留空／"true"/"1"/"on"/"yes"）時：
  //   1. per-job capability token 強制驗證（缺/錯 token 一律 4xx 拒絕）— 防偽造回呼
  //      用攻擊者可控的 URL 把別人的 job 標 completed。token 由 JWT_SECRET 簽，
  //      JWT_SECRET 未設（純本機 dev）時 token 驗證自動 skip，不影響本機自測。
  //   2. FAL_WEBHOOK_SECRET 在 production 未設時，簽章驗證 fail-closed 拒絕
  //      （而非舊的 fail-open 放行）。prod 已設 FAL_WEBHOOK_SECRET，故不影響現狀。
  // 緊急回退（明確人工決定）：設 "false"/"0"/"off"/"no" → token 強制與簽章 fail-closed
  //   都退回寬鬆（緊急用，例如部署當下有舊版「無 token」的 in-flight 回呼被擋時）。
  FAL_WEBHOOK_FAIL_CLOSED: z.string().optional().default("true"),
  REPLICATE_API_TOKEN: z.string().min(1).optional().default(""),

  // ── 音訊 / 語音生成 ──────────────────────────────────────
  ELEVENLABS_API_KEY: z.string().min(1).optional().default(""),
  SUNO_API_KEY: z.string().min(1).optional().default(""),

  // ── Cloudflare AI Gateway（統一供應商門面，W1-2）────────
  // 形如 https://gateway.ai.cloudflare.com/v1/<account>/<gateway>。
  // 設定後，有 CF slug 的供應商改走閘道（快取/觀測/告警）；留空＝全部直連。
  // 實際解析在 _core/providerFacade.ts（lazy 讀 process.env）。
  CF_AI_GATEWAY_BASE_URL: z.string().optional().default(""),
  // CF「Authenticated Gateway」的 token；以 cf-aig-authorization 標頭送出。
  CF_AI_GATEWAY_TOKEN: z.string().optional().default(""),
  // 逗號分隔白名單（providerFacade 的鍵）；留空＝支援的供應商全走閘道。
  CF_AI_GATEWAY_PROVIDERS: z.string().optional().default(""),

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
  // 模型 ID 格式：<provider>/<model>，例：anthropic/claude-sonnet-4.6、google/gemini-2.5-pro
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
  /** AIDV-204: LLM engine fallback chain — when OFF, single-engine mode (no auto-retry to next provider). Default ON. */
  ENABLE_LLM_FALLBACK: z.string().optional().default("true"),
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

  /**
   * AIDV-121 資料層 RBAC enforcement 旗標。預設 "false"（OFF）＝零行為變化：
   * 所有 query/mutation 與現狀位元相同，canAccess 完全不在資料路徑被呼叫。
   * 設為 "true"（ON）時，被接線的讀取 procedure（如 assets.teamAssets）會
   * 經統一授權層 canAccess 過濾，A 看不到 B 未共享的資源。先在代表性接點
   * 示範，全站接線為後續卡範圍。
   */
  ENABLE_DATA_RBAC: z.string().optional().default("false"),

  /**
   * File path where the in-memory orb task store flushes its tasks/timeline.
   * When set, OrbTaskStore loads on boot and writes on every mutation, so
   * in-flight long workflows survive a server restart. Leave blank in test
   * (state should be ephemeral); in production point this at a persistent
   * volume mount, e.g. `/data/orb-task-store.json`. Without persistence the
   * store is in-memory only and a restart drops all running tasks.
   */
  ORB_TASK_STORE_FILE: z.string().optional().default(""),

  // ── MiniMax M2.7 via NVIDIA NIM（光球 AI 代理人引擎）──────────────────────

  // ── Brave Search API ──────────────────────────────────────
  BRAVE_SEARCH_API_KEY: z.string().min(1).optional().default(""),
  PERPLEXITY_API_KEY: z.string().min(1).optional().default(""),

  // ── Perplexity 開關 + 節流（混合搭配時控制成本 / 啟停） ─────────────
  // 主開關：關掉後所有走 Perplexity 的功能（director research、inspiration
  // tool、webSearch native、newsFetcher fallback、braveLearnFetcher fallback）
  // 都會直接跳過 Perplexity 走原本的 fallback 鏈。
  ENABLE_PERPLEXITY: z.string().optional().default("true"),
  // 子開關：個別功能開關（主開關開啟時才生效；任一關閉就停掉該入口）
  ENABLE_PERPLEXITY_DIRECTOR_RESEARCH: z.string().optional().default("true"),
  ENABLE_PERPLEXITY_INSPIRATION: z.string().optional().default("true"),
  ENABLE_PERPLEXITY_WEB_SEARCH: z.string().optional().default("true"),
  ENABLE_PERPLEXITY_NEWS_FALLBACK: z.string().optional().default("true"),
  ENABLE_PERPLEXITY_LEARN_FALLBACK: z.string().optional().default("true"),
  // 節流：per-user / global rate limits（防止單一使用者或整體流量爆衝）
  // 0 / 空字串 = 不限制（謹慎使用）
  PERPLEXITY_PER_USER_PER_HOUR: z.string().optional().default("30"),
  PERPLEXITY_PER_USER_PER_DAY: z.string().optional().default("100"),
  PERPLEXITY_GLOBAL_PER_MINUTE: z.string().optional().default("60"),

  // ── Prompt ↔ Asset 關聯（prompt_assets junction, migration 0075）─────────
  // 寫入開關：ON 時 postGenActions.doPostGenComplete 在寫完 prompt_library 與
  // digital_asset_library 後自動補建 relation=derived 的關聯邊。預設 OFF —
  // 讀取 procedure（promptLibrary.linkedAssets / assets.linkedPrompts）不受
  // 此旗標影響，空表回空陣列，先跑 migration 後開旗標是安全順序。
  ENABLE_PROMPT_ASSET_LINKS: z.string().optional().default("false"),

  // ── Signed-URL 直傳（AIDV-15：廢 base64，大檔不再過 tRPC/HTTP body）────────
  // ON（預設）時 client 大檔上傳改走「presign → 直接 PUT 到 R2 → finalize 落庫」
  // 三段式流程，檔案位元組完全不進 Node 記憶體（不過 express.json body-parser，
  // 不 Buffer.from(base64)），解決 Railway 記憶體被 ~1.33× base64 膨脹打爆的問題。
  // OFF，或 presign 不可用（無 R2 env / demo / getDb 為 null）時，自動回退既有
  // base64 `/api/upload` 路徑——既有上傳零破壞、位元相容。presign 端點 auth-gated、
  // key 以 userId 命名空間隔離、限 content-type/size、短期效期（5 分鐘），杜絕
  // 未授權上傳/覆寫。不新增金鑰：重用 storage.ts / r2SnapshotJob 既有的 S3_* 設定。
  ENABLE_SIGNED_URL_UPLOAD: z.string().optional().default("true"),

  // ── 成本帳本（AIDV-153 cost_ledger append-only 複式分錄, migration 0076）────
  // 寫入開關：ON 時在現有落帳點（aiProxy usage event）「額外」寫一筆【平衡的複式
  // 分錄】（debit member:<id> / credit expense:ai-cost），並行於 cost_aggregations、
  // 不取代、不改既有餘額/聚合寫法。預設 OFF — OFF＝完全不寫 cost_ledger、現有成本
  // 流程位元相同（零行為變化）。先跑 migration 0076 後開旗標是安全順序。
  //
  // 首次啟用的對帳基準差（誠實揭露）：cost_aggregations 由 providerSnapshotJob 對
  // 「歷來所有 aiUsageEvents」SUM（無啟用時間界），而 cost_ledger 自旗標啟用當下才
  // 累積、且無 backfill。對帳 job 已用「ledger 最早寫入日」把 aggregations 限縮到
  // 同一日期窗比較以消除此結構性差；若要更嚴謹的歷史對齊，需另補 backfill。
  //
  // OPEN DECISIONS（待 Bruce 拍板，本基礎版尚未實作）：
  //   1) 切權威時機：ledger 何時取代 users.remainingGenerations 成為「餘額真相」。
  //      需先補 hold/credit 全流程接線與一致性保證後才能切（目前 ledger 僅為旁觀
  //      帳本，不參與實際扣點/授權）。
  //   2) 退款接線：refundUserPoints（server/db.ts）目前【未接 ledger】，production
  //      不會寫出任何 credit 列（holdEntry/postTransaction credit/computeBalance 已
  //      有碼有測但生產零接線）。接線前需先定義單位換算：ledger 記 USD、
  //      remainingGenerations 記點數，單位不同，須先定換算或拆兩本帳。
  ENABLE_COST_LEDGER: z.string().optional().default("false"),

  // ── 內部成本歸屬可視（AIDV-14 cost attribution, migration 0079）────────────
  // 旗標：ENABLE_COST_ATTRIBUTION。預設 ON（fallback=true）— 與 #940 ledger 旗標
  // （預設 OFF）不同：本卡是「內部用、不對使用者收費」的觀測能力，預設開啟才能讓
  // cost_aggregations 立刻有真實 TWD 數字、ledger 帶 project/member/workflow 維度。
  // demo-safe-skip：getDb()===null（demo/無 DB）時歸屬落帳整段跳過＝線上現況零破壞。
  // 落帳為生成/用量結果產出後的 best-effort 後置副作用（try/catch 不阻塞請求路徑、
  // 失敗走 outbox 補），不改既有扣款/餘額、不對使用者收費。
  ENABLE_COST_ATTRIBUTION: z.string().optional().default("true"),

  // 匯率：USD → TWD。新增 TWD_PER_USD（規格名，預設約 32）。讀取時與既有
  // USD_TO_TWD_RATE 對齊（見 shared/currency.ts resolveTwdPerUsd）：TWD_PER_USD 優先，
  // 未設時退回 USD_TO_TWD_RATE，再退回 DEFAULT_USD_TO_TWD_RATE。架構上保留日後接
  // 即時匯率的空間（落帳/彙總時凍結當下匯率寫入稽核欄位）。
  TWD_PER_USD: z.string().optional().default(""),

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

  // ── 功能旗標（featureFlags.ts 讀取 FEATURE_* 前綴）─────────────────────
  // selfRepairEnv() 會把使用者設定的 ENABLE_ADVANCED_SEARCH / ENABLE_RAG_MEMORY /
  // ENABLE_RESEARCH_MODE 自動重命名為以下三個標準名稱，因此兩種寫法皆可生效。
  // 明確設定 "false" 或 "0" 可停用對應功能；留空則由 featureFlags.ts 的
  // defaultResolver（依 API 金鑰是否存在）自動決定。
  FEATURE_ADVANCED_SEARCH: z.string().default(""),
  FEATURE_RAG_MEMORY: z.string().default(""),
  FEATURE_RESEARCH_MODE: z.string().default(""),
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
