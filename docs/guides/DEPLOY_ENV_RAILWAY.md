# Railway 環境變數設定清單

> 部署到 Railway 後，在 **Variables** 分頁逐一貼入以下變數。
> 完整變數定義與預設值見 `server/_core/env.validated.ts` 與 `client/src/lib/env.validated.ts`。

---

## 🔴 必填（沒有就無法啟動）

| 變數名稱       | 值                               | 說明                       |
| -------------- | -------------------------------- | -------------------------- |
| `NODE_ENV`     | `production`                     | 固定填這個                 |
| `PORT`         | `3000`                           | Railway 會自動覆蓋，但先填 |
| `JWT_SECRET`   | _(32+ 字元隨機字串)_             | `openssl rand -base64 32`   |
| `DATABASE_URL` | `${{MySQL.MYSQL_URL}}`           | Railway MySQL 服務參照      |

### 生成 JWT_SECRET

```bash
openssl rand -base64 32
```

> 💡 也可改用別名 `AUTH_SECRET`（self-repair 會自動 rename 成 `JWT_SECRET`），任設一個即可。
>
> 🔒 **AIDV-59（H4 JWT 硬化）**：正式環境（`NODE_ENV=production`）必填且至少 16 字元。
> 若缺失／空白／太弱，server 會在**開機時 fail-fast（throw）**，不會靜默退回弱／空密鑰。
> 正確設定 32+ 字元密鑰的部署不受影響。

---

## 🟡 Google OAuth（登入功能用）

| 變數名稱               | 說明                                         |
| ---------------------- | -------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | 從 Google Cloud Console 取得                 |
| `GOOGLE_CLIENT_SECRET` | 從 Google Cloud Console 取得                 |
| `GOOGLE_REDIRECT_URI`  | `https://你的網址/api/oauth/callback`        |

---

## 🟢 LLM 引擎（推薦：用 OpenRouter 一支金鑰打所有家）

| 變數名稱            | 取得網址                                  | 備註                       |
| ------------------- | ----------------------------------------- | -------------------------- |
| `OPENROUTER_API_KEY`| https://openrouter.ai/keys                | 推薦：統一閘道             |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys | 光球代理首選 tool use      |
| `GEMINI_API_KEY`    | https://aistudio.google.com/apikey        | 圖片/影片/語音多模態必需   |
| `LLM_ENGINE`        | `auto`                                    | 智慧路由（不要寫死成單一引擎）|

> `LLM_ENGINE=auto` 的優先序：`openrouter > anthropic > gemini > nvidia > vertex > forge`，
> 任一引擎失敗會自動降級（`server/_core/llmRouter.ts`）。

---

## 🟢 多模態 API（依啟用模組設定）

| 變數名稱               | 取得網址                                    | 模組         |
| ---------------------- | ------------------------------------------- | ------------ |
| `FAL_API_KEY`          | https://fal.ai/dashboard/keys               | 圖片/影片    |
| `FAL_WEBHOOK_SECRET`   | `openssl rand -hex 32`（**不可與 FAL_API_KEY 同值**） | webhook 簽章 |
| `REPLICATE_API_TOKEN`  | https://replicate.com/account/api-tokens    | LoRA 訓練    |
| `ELEVENLABS_API_KEY`   | https://elevenlabs.io/app/settings/api-keys | TTS          |
| `SUNO_API_KEY`         | Suno 開發者控制台                           | 音樂生成     |
| `PINECONE_API_KEY`     | https://app.pinecone.io                     | RAG 記憶     |
| `PINECONE_ENVIRONMENT` | `us-east-1`                                 |              |
| `PINECONE_INDEX_NAME`  | `ai-director-memories`                      |              |
| `NEWS_API_KEY`         | https://newsapi.org/account                 | 新聞研究     |
| `NEWSDATA_API_KEY`     | https://newsdata.io                         | 新聞研究     |
| `BRAVE_SEARCH_API_KEY` | https://brave.com/search/api/               | 網路搜尋     |
| `PERPLEXITY_API_KEY`   | https://www.perplexity.ai/settings/api      | 網路研究     |

---

## 🟢 GitHub 整合（AI 自動建立 Issue）

| 變數名稱       | 格式 / 來源                              |
| -------------- | ---------------------------------------- |
| `GITHUB_TOKEN` | `github_pat_*` 或 `ghp_*`（**不是 Pinecone `pcsk_*`**） |
| `GITHUB_REPO`  | `owner/repo`，例 `aa0968111723-prog/healing-studio` |

> 到 https://github.com/settings/tokens 建立 fine-grained PAT，授予 `Issues: Read & write`。

---

## 🟢 站點與 Webhook 路徑

| 變數名稱       | 值                          | 用途                             |
| -------------- | --------------------------- | -------------------------------- |
| `VITE_SITE_URL`| `https://director.today`    | webhook callback URL 構造        |
| `BASE_URL`     | `https://director.today`    | 後端絕對 URL（email 連結等）     |
| `ORB_TOOL_ALLOWED_ORIGINS` | `https://director.today,https://api.director.today` | 光球工具白名單（不設則全擋） |
| `ORB_TOOL_REGISTRY_JSON`   | `[]` 或 JSON 工具陣列     | 光球可呼叫的外部工具定義         |
| `ORB_WEBHOOK_SECRET`       | `openssl rand -hex 32`     | n8n / Zapier 觸發 orb 共享密鑰   |

---

## 🟢 監控與分析

| 變數名稱            | 值                                  | 模組               |
| ------------------- | ----------------------------------- | ------------------ |
| `VITE_POSTHOG_KEY`  | PostHog Project key (`phc_*`)       | 前端分析（build time 注入） |
| `VITE_POSTHOG_HOST` | `https://us.i.posthog.com`          | 前端分析           |
| `POSTHOG_API_KEY`   | PostHog server-side key             | AI Proxy 後端事件  |
| `POSTHOG_HOST`      | `https://us.i.posthog.com`          | 後端事件 endpoint  |
| `LANGSMITH_API_KEY` | `lsv2_pt_*` 或 `lsv2_sk_*`          | LLM 追蹤（非此格式會被自動清空）|
| `LANGSMITH_PROJECT` | `healing-studio-prod`               |                    |
| `LANGCHAIN_TRACING_V2` | `true`                           |                    |
| `LANGCHAIN_ENDPOINT` | `https://api.smith.langchain.com`  |                    |

---

## 🟢 儲存（Cloudflare R2 / S3 相容）

| 變數名稱                | 值                                                            |
| ----------------------- | ------------------------------------------------------------- |
| `S3_ENDPOINT`           | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`              |
| `S3_ACCESS_KEY_ID`      | _(R2 token)_                                                   |
| `S3_SECRET_ACCESS_KEY`  | _(R2 secret)_                                                 |
| `S3_BUCKET_NAME`        | _(bucket 名稱)_                                                |
| `S3_PUBLIC_DOMAIN`      | `https://pub-xxxx.r2.dev`（或自訂網域）                       |

---

## 🟡 選用（依場景補上）

| 變數名稱                | 用途                                                    |
| ----------------------- | ------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | Stripe 收款（`sk_live_*`）                              |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook 驗章（`whsec_*`）                        |
| `REDIS_URL`             | 分散式快取/排程鎖（單機可不設，多機必填）              |
| `DISCORD_WEBHOOK_URL`   | 健康巡檢告警                                            |
| `ALERT_SLACK_WEBHOOK`   | API 用量告警（每 15 分鐘 cron）                         |
| `AI_MONTHLY_BUDGET_USD` | 月預算上限（預設 500）                                  |
| `OPENROUTER_HTTP_REFERER` | OpenRouter dashboard 識別來源                         |
| `ADMIN_EMAILS`          | 逗號分隔，登入時自動設為 admin                          |
| `NVIDIA_API`            | MiniMax M2.7 via NVIDIA NIM                            |
| `GEMINI_LIVE_API_KEY`   | Gemini Live Voice 即時對話                              |
| `MIGRATION_FAIL_CLOSED` | DB migration 失敗時是否擋啟動。預設 `false`＝fail-open（log 後照常服務，維持現狀）；設 `true` 時 migration 真實套用失敗會 `process.exit(1)` 擋啟動、令 `/api/health` 失敗讓 Railway 偵測不健康。詳見 [`MIGRATION_FAILURE_SOP.md`](./MIGRATION_FAILURE_SOP.md)（AIDV-61 H6）|

> 🔁 **`MIGRATION_FAIL_CLOSED`（AIDV-61 H6）**：預設關＝**對現有 prod 零行為改變**。
> demo / 沒設 `DATABASE_URL` 不受影響（沒 DB 就不跑 migration，旗標 ON 也不會讓 demo 開不了機）。
> 旗標只在「真的去套用某個 migration 而失敗」時才擋啟動，冪等重跑不誤判。
> 何時該開、失敗怎麼判讀、Railway 怎麼回滾 → 看 [Migration 失敗判讀與回滾 SOP](./MIGRATION_FAILURE_SOP.md)。

---

## 🔧 效能調節（純整數，皆有預設值，可選填）

| 變數名稱                 | 預設 | 用途                                                              |
| ------------------------ | ---- | ----------------------------------------------------------------- |
| `CACHE_TTL_SECONDS`      | 300  | `_core/cache.ts` LRU 快取的預設 TTL（秒）                          |
| `LLM_TIMEOUT_SECONDS`    | 60   | 所有 LLM HTTP 呼叫的 AbortSignal timeout（秒）                     |
| `MAX_CONCURRENT_LLM_CALLS` | 5  | 全域同時並行的 LLM 呼叫上限（`_core/llmConcurrency.ts` semaphore）  |

> 突發流量（光球同時跑多個 research query）會排隊而非一次打爆 provider rate limit。

---

## 🔁 變數別名（self-repair 自動 rename，可任填一邊）

啟動時 `_core/env.validated.ts` 會把下列「使用者習慣命名」rename 成「程式碼內部命名」：

| 設定的名稱（也接受） | 內部實際名稱             | 用途                            |
| -------------------- | ------------------------ | ------------------------------- |
| `AUTH_SECRET`        | `JWT_SECRET`             | JWT 簽名（任設一個即可）         |
| `NTHROPIC_API_KEY` / `ANTROPIC_API_KEY` | `ANTHROPIC_API_KEY` | typo 修補         |
| `NVIDA_API`          | `NVIDIA_API`             | typo 修補                       |
| `FAL_KEY`            | `FAL_API_KEY`            | typo 修補                       |

> 功能旗標請直接使用 `FEATURE_ADVANCED_SEARCH`、`FEATURE_RAG_MEMORY`、`FEATURE_RESEARCH_MODE`（`ENABLE_*` 別名已移除）。

---

## 📋 Railway MySQL 設定步驟

1. Railway Dashboard → **+ New** → **Database** → **MySQL**
2. 建立完後點擊 MySQL 服務 → **Variables**
3. 在你的 App 服務的 Variables 加上 `DATABASE_URL=${{MySQL.MYSQL_URL}}` 即可參照

---

## 🌐 Google OAuth URI 填法

Railway 部署完成後填入 Google Cloud Console：

- **已授權的 JavaScript 來源**：`https://你的網址`
- **已授權的重新導向 URI**：`https://你的網址/api/oauth/callback`

---

## 🩹 自我修復機制（程式碼自動處理）

啟動時若偵測到下列狀況會自動修補並警告（`server/_core/env.validated.ts:80-210`）：

| 偵測 | 動作 |
|------|------|
| `NTHROPIC_API_KEY` / `ANTROPIC_API_KEY` | rename → `ANTHROPIC_API_KEY` |
| `NVIDA_API` | rename → `NVIDIA_API` |
| `FAL_KEY` | rename → `FAL_API_KEY` |
| `PINECONE_INDEX_NAME` 含非法字元 | sanitize 為小寫英數連字號 |
| `JWT_ACCESS_TOKEN_EXPIRES_IN` 非數字 | 還原預設 2592000（30 天，AIDV-59）|
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` 非合法 JSON | 視為未設定 |
| `LANGSMITH_API_KEY` 非 `lsv2_*` 格式 | 視為未設定 |
| 範本字串（`your-xxx-api-key` 等） | 視為未設定 |
