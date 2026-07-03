# B — 基礎設施 × 環境變數 × DB × 安全 × 測試 × 可觀測性(Phase 2-B)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`(工作樹 HEAD `ad1b9c7` 僅多出 docs/research 文件 commits,程式碼與基準相同)
- 方法:全部由單一代理實讀檔案完成(無子代理);認證/RBAC/credits 接線引用 `01-features.md` §3.8 與 `02-fullstack.md` §4,不重做
- 圖例:🔴 高風險 / 🟡 中風險 / 🟢 已妥善處理

---

## 1. 環境變數盤點

### 1.1 三層架構(單一真相源與其漏洞)

```
.env.example(376 行,約 96 個變數,含大量操作註解)
  → server/_core/env.validated.ts(939 行):selfRepairEnv() 前置修補
      → zod fullSchema(coreSchema + multimodalSchema,共 134 個 key)
      → OARS 軟警告(缺 key 不 crash、印「觀察/影響/建議/提示」)
      → export serverEnv(singleton)+ assertApiKey()/getApiKey()
  → server/_core/env.ts:ENV 物件(向後相容 façade,舊碼繼續用)
  → server/lib/config-check.ts:validateEnvConfig() 只警告 3 個棄用
      GoTrue 變數(GOTRUE_JWT_ADMIN_GROUP_NAME 等,AIDV-261/342),不 throw
```

**selfRepair 自動修補**(env.validated.ts:86-258,開機時就地改 `process.env` 並印修復報告):

| 修補 | 內容 |
|---|---|
| 別名改名 | `AUTH_SECRET→JWT_SECRET`、`FAL_KEY→FAL_API_KEY`、錯字 `NTHROPIC_API_KEY`/`ANTROPIC_API_KEY`/`NVIDA_API`(:90-97) |
| JWT trim | JWT_SECRET 去前後空白,原值保留 `JWT_SECRET_RAW` 供舊 session/加密向後相容(AIDV-59,:119-133) |
| Pinecone 索引名 | 非 `[a-z0-9-]` 強制重設 `ai-director-memories`(:136-150) |
| TTL 非數字 | JWT_ACCESS_TOKEN_EXPIRES_IN 還原 2592000(30 天)(:153-163) |
| GAC JSON | 非合法 JSON 視為未設(:166-176) |
| 佔位符清掃 | 20 個 key 偵測 `your-xxx-api-key`/`changeme` 直接清空,避免 401 噪音(:181-215) |
| LangSmith 格式 | 非 `lsv2_(pt|sk)_` 開頭視為未設(:220-231) |
| Railway 模板 | DATABASE_URL 為未展開 `${{...}}` 視為未設(:235-246) |

### 1.2 分類(依 zod schema 134 key + .env.example)

- **密鑰(secrets)**:JWT_SECRET(+別名 AUTH_SECRET/JWT_SECRET_RAW)、CREDENTIAL_ENCRYPTION_KEY(+`_k2`/`_ACTIVE` 版本化)、GOOGLE_CLIENT_SECRET、GOOGLE_APPLICATION_CREDENTIALS_JSON、S3_SECRET_ACCESS_KEY、OPENROUTER/ANTHROPIC/GEMINI/FAL/REPLICATE/ELEVENLABS/SUNO/PINECONE/NEWS/NEWSDATA/LANGSMITH/BRAVE/PERPLEXITY/NVIDIA/GITHUB/POSTHOG 各家 API key、FAL_WEBHOOK_SECRET、ORB_WEBHOOK_SECRET、AGENT_SIGNING_KEY(AIDV-333 代理互信 JWT)、STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET、SMTP_PASS、SUPABASE_SERVICE_ROLE_KEY、CF_AI_GATEWAY_TOKEN、SENTRY_DSN、ALERT_SLACK_WEBHOOK、DISCORD_WEBHOOK_URL、FRONTEND_FORGE_API_KEY
- **連線/端點**:DATABASE_URL(MySQL)、REDIS_URL(+REDIS_KEY_PREFIX)、SUPABASE_URL、S3_ENDPOINT/BUCKET/REGION/PUBLIC_URL(+舊名 S3_PUBLIC_DOMAIN)、GCS_BUCKET_NAME、OPENROUTER_BASE_URL、LANGCHAIN_ENDPOINT、POSTHOG_HOST、SMTP_HOST/PORT、FREE_LLM_API_URL、CF_AI_GATEWAY_BASE_URL
- **設定(tuning)**:JWT_ACCESS_TOKEN_EXPIRES_IN、PASSWORD_HASH_ALGORITHM(scrypt/bcrypt/argon2)、CACHE_TTL_SECONDS、LLM_TIMEOUT_SECONDS、MAX_CONCURRENT_LLM_CALLS、SENSE_INTENT_TIMEOUT_SECONDS、AI_MONTHLY_BUDGET_USD、USD_TO_TWD_RATE/TWD_PER_USD、SENTRY_TRACES_SAMPLE_RATE、PERPLEXITY_* 節流三值、ORB_VOICE_MAX_*、SSE_MAX_CONNECTIONS_PER_USER、ADMIN_EMAILS、LLM_ENGINE、PREFER_CHEAP_MODELS(economy/balanced/premium)
- **旗標(flags)**:~50 個 ENABLE_*/FEATURE_*/*_FAIL_CLOSED(後端 runtime)+ 前端 VITE_*(build-time,見 02 §9);安全向 fail-closed 旗標:CONTENT_SAFETY_FAIL_CLOSED(ON)、FAL_WEBHOOK_FAIL_CLOSED(ON)、SSE_OWNERSHIP_LOCKDOWN(ON)、MIGRATION_FAIL_CLOSED(schema 預設 OFF、**prod 已人工設 true**,證據 server/orphan-migrations-journal.test.ts:24)、STRIPE_WEBHOOK_FAIL_CLOSED(空=僅 prod 拒絕)

### 1.3 `.env.production` 在 repo 內 —— 檢查結果 🟢(但有一個隱藏後果)

- 內容**只有 7 個 VITE_* 公開建置旗標,無任何密鑰**(檔頭自我聲明「切勿放密鑰,本檔會進 git」)。Vite build 時自動載入,經 Dockerfile `COPY . .` 生效,無需 Railway 後台設定。
- ⚠️ 重要副作用:它設 `VITE_ENABLE_4SHELL=1`、`VITE_SHELL_SOCIAL=1`、`VITE_ENABLE_VIDEO_COCKPIT=1`。**01-features 以「程式碼預設值」判定 SHELL_SOCIAL=OFF,但 production build 實際是 ON** —— /social 四頁(含 SocialPublish 的 mock 發佈 adapter、SocialBrand 的假儲存)在線上是可達的。研判 01 §5「預設整殼停用」的現況判定對 director.today 不成立,線上使用者能踩到 mock 發文流程。

### 1.4 風險清單

| # | 風險 | 等級 | 證據 |
|---|---|---|---|
| E1 | **admin email allowlist 硬編碼**:`isAdminEmail()` 內寫死 `["aa0968111723@gmail.com"]`,與 ENV.adminEmails 聯集;.env.example:86 又把同一信箱當 ADMIN_EMAILS 範例預設。任何人拿到此 Gmail 即拿到 prod admin;移轉/移交專案時無法用 env 撤銷 | 🔴 | server/routes/localAuth.ts:89-97 |
| E2 | **Suno 第三方 proxy 網域硬編碼**:`baseUrl = "https://apibox.erweima.ai"`(非官方 Suno,無簽章 API);webhook 靠自家 capability token 補強,但供應商本體不可 env 切換、倒站即音樂功能全斷 | 🟡 | server/services/modelClients.ts:394;server/_core/webhookTokens.ts:12 |
| E3 | **命名不一致/雙名並存**:AUTH_SECRET↔JWT_SECRET(靠 self-repair);`USD_TO_TWD_RATE`(舊)vs `TWD_PER_USD`(AIDV-14 規格名)雙變數,解析順序在 shared/currency.ts resolveTwdPerUsd(:52);S3_PUBLIC_URL vs S3_PUBLIC_DOMAIN;NVIDIA_API(不帶 _KEY 後綴,曾有 NVIDA_API 錯字事故 DEF-13) | 🟡 | env.validated.ts:90-97、:694;shared/currency.ts |
| E4 | **zod schema 覆蓋缺口**:server/ 內直讀 `process.env.X` 的 distinct 變數共 **140 個**,其中 **~68 個不在 env.validated schema**(例:CSRF_PROTECTION、ENABLE_RATE_LIMIT、ENABLE_REFRESH_TOKEN_ROTATION、UNIFIED_SSE_ROUTER、UNIFIED_GEN_EVENT_BUS、ENABLE_RAG_INJECTION_GUARD、ENABLE_DB_BACKUP、CSP_ENFORCEMENT、ORB_* 十餘個、USD_TO_TWD_RATE、FAL_JWKS_URL、UPLOAD_SNIFF_FAIL_CLOSED…)。這些享受不到 self-repair/佔位符清掃/OARS 警告,也不會出現在 admin「env key 狀態燈」 | 🟡 | grep 統計;env.validated.ts |
| E5 | **JWT_SECRET 身兼多職**:session 簽章 + webhook capability token(webhookTokens.ts:51)+ secretCrypto 加密金鑰 fallback(secretCrypto.ts:44-49)。輪替 JWT_SECRET 若未先設 CREDENTIAL_ENCRYPTION_KEY,將使 data_source_connections 既存加密憑證**永久無法解密**;金鑰用途未分離 | 🟡 | secretCrypto.ts、webhookTokens.ts |
| E6 | 大量服務繞過 serverEnv 直讀 process.env(ELEVENLABS_API_KEY 55 處、FAL_API_KEY 42 處),雙讀取路徑日後易漂移 | 🟡 | grep 統計 |
| E7 | 效能調節變數皆為字串、下游各自 parseInt,無範圍驗證(USD_TO_TWD_RATE 有 1–1000 防呆是少數例外) | 🟢/🟡 | .env.example:26-34 |
| E8 | `ORB_TOOL_ALLOWED_ORIGINS` .env.example 預設值即真站網域 `https://director.today,https://api.director.today`(把 prod 拓撲寫進範本);prod 空值+有 registry 時會 fail-fast 拒開機(良好) | 🟢 | .env.example:263;_core/index.ts:415-433 |

---

## 2. 資料庫

### 2.1 MySQL(Drizzle)健康度

- `drizzle/schema.ts` 4758 行、**102 張 `mysqlTable`**。
- **外鍵:0**。全 schema 無任何 `.references()`/`foreignKey`(grep 計數 0)——不只 01 提到的 teams,**整庫都沒有 FK**;參照完整性全靠應用層(如 team_memberships「應用層防 phantom」)。孤兒列風險由各 purge/cleanup cron 與級聯刪除程式碼兜底。
- **索引:290 個 `index()`/`uniqueIndex()` 定義**,平均每表近 3 個,覆蓋面在水準之上(熱路徑如 background_jobs、generation_history、orb_cost_attribution 皆有複合索引);未做過線上 slow-query 對帳(logger 有 logSlowQuery 但無彙整報表)。
- **Migrations**:`drizzle/*.sql` 共 111 支;journal(`drizzle/meta/_journal.json`)111 entries、idx 0→**121**(00-overview 寫「journal idx 至 91」已過時;idx 跳號是孤兒補登記的痕跡)。最後五支:0102_agent_dlq → 0106_video_input_assets。
- **Migration 治理(repo 內有三支守門測試,等級很高)**:
  - `server/orphan-migrations-journal.test.ts`(AIDV-17):歷史上多支 .sql 寫好**忘了登記 journal**(0033/0039–0044/0067/0071–0074),導致生產 schema 靜默缺表;補登記必須用「大於最後一筆的 `when`」追加,否則 drizzle 永遠跳過。
  - `server/migration-prod-pending-block.test.ts`:強制每支 migration 用 `--> statement-breakpoint` 分段、每 chunk 僅一語句、**檔尾不得殘留 breakpoint**(會切出空語句 → MySQL ER_EMPTY_QUERY 1065 → 部署卡死,2026-06-29 真站事故)、不得用 MySQL 不支援的 `CREATE INDEX IF NOT EXISTS`。
  - `server/migration-fail-closed.test.ts`(AIDV-61):`MIGRATION_FAIL_CLOSED` schema 預設 "false",**prod 已開 true** —— apply 真失敗 → 印致命 log → `process.exit(1)` → Railway 健檢失敗自動重啟/人工回滾(SOP:docs/guides/MIGRATION_FAILURE_SOP.md)。
- **開機順序(AIDV 事故修正後)**:先 `server.listen()` 綁 port,migrations/LearnHub/OrbScheduler 移到 deferred boot init 背景跑;`bootReady` gate 讓 /api/health 在 init 完成前回 503 "booting"(_core/index.ts:435-496)——健檢永遠有回應、真流量不會打進未 migrate 的 DB。

### 2.2 Supabase Postgres —— 23 個 migrations 逐一掃描

全部集中在 2026-06-26 ~ 07-02(AIDV-318~834 波段),**主題只有一個:多代理影片生成管線的執行面 + 平台監控**。

**repo 內 CREATE TABLE 的表(3 張)**:

| 表 | 用途 | migration |
|---|---|---|
| `agent_capability_registry` | 代理心跳/能力/負載註冊表(heartbeat 寫入) | 20260626_agent_heartbeat_cron_auth |
| `agent_handoff_log` | 代理間交棒紀錄(from_task→to_task),RLS:creator 讀自己、service_role 寫 | 20260629_aidv318 |
| `video_pipeline_slo` | 管線 SLO 門檻表(RLS: authenticated 可讀) | 20260630_aidv482 |

**只被 ALTER/引用、但基底 DDL 不在 repo 的表(⚠ schema drift)**:`agent_tasks`、`video_projects`(含 `creator_id uuid`)、`video_segments`、`system_alerts`、`creator_job_throttle`,以及函式 `check_creator_job_rate_limit()`(migration 註解自承「existed since aidv_501 but was never called」——aidv_501 不在 repo)。**這些是管線的核心表,卻是經 Supabase dashboard/MCP 直接施作的**,repo 無法重建完整 Supabase schema。

**函式(16 個)**:`dispatch_task`(派工;AIDV-522 跨供應商重試、AIDV-528 限流回 429)、`complete_task`(AIDV-666 記 provider_used)、`write_handoff_from_task_dispatch`(trigger fn,AIDV-829 修過)、`detect_pipeline_stall`、`detect_stalled_tasks`、`enforce_agent_task_rate_limit`、`auto_close_video_project`、`notify_video_project_closed`、`write_segment_from_completed_task`(段落組裝 trigger)、`coerce_provider_used_not_null`(backfill 守門)、`update_task_checkpoint`/`get_task_checkpoint`/`emit_segment_resume_events`(AIDV-526 斷點續跑)、`clear_checkpoint_on_terminal`、`get_task_slo_status`/`get_project_slo_report`。

**Triggers(6 個)**:`agent_task_rate_limit_trigger`(BEFORE INSERT agent_tasks → 20 tasks/hr/creator,AIDV-742 才真正接上——`creator_job_throttle` 之前一直 0 rows)、`trg_log_agent_handoff`、`trg_assemble_video_segment`、`trg_auto_close_video_project`+`trg_notify_video_project_closed`(全段完成→關案+通知)、`trg_coerce_provider_used`、`trg_clear_checkpoint_on_terminal`。

**RLS/權限硬化軌跡**(顯示 Supabase 側經歷過一輪安全補課):AIDV-375 移除 SECURITY DEFINER view(agent_task_dlq 重建)、AIDV-409 把 `TO public` policy 全面收斂為 `TO authenticated`(agent_tasks/video_projects/video_segments)、AIDV-721/722 + 318b 對 SECURITY DEFINER 函式 REVOKE anon/authenticated EXECUTE、AIDV-718 補 system_alerts service_role-only insert policy、AIDV-834 active alert 去重唯一索引、AIDV-747/729 清無用索引、AIDV-403 補查詢索引。

**pg_cron(3 支,DB 內排程,不經 Node)**:`agent-heartbeat`(每 1 分,pg_net POST edge function,以 `app.settings.service_role_key` DB 設定帶認證——**service role key 存在 DB setting/Vault,repo 外又一份密鑰面**)、`check-heartbeat-liveness`(每 5 分,heartbeat 斷流寫 system_alerts)、`rate-limit-bypass-probe`(每 15 分,自我驗證限流 trigger 沒被繞過)。

**Edge Functions(2 個)**:`supabase/functions/agent-heartbeat`(接收心跳→upsert agent_capability_registry;x-agent-secret 應用層驗證)、`tts-liveness-probe`。

### 2.3 「Supabase 到底管什麼」—— 與 MySQL 的分工

| 面向 | MySQL(Drizzle,102 表) | Supabase Postgres |
|---|---|---|
| 角色 | **主應用 OLTP**:users/認證/credits、九工作室生成鏈、資產/prompt/LoRA、orb 對話與記憶、帳務、審計 | **多代理影片管線的執行資料面 + 平台級監控**:agent_tasks 派工/checkpoint/SLO/handoff/限流、agent 心跳、system_alerts |
| 誰在寫 | Node(tRPC/REST/cron) | 主要是 **DB 自身(trigger+pg_cron)+ edge functions + 外部代理(service role)**;Node 只有少數接點 |
| Node 接點 | 全部 | `handoffTraceRoute`(service role 讀 handoff)、`brainPipeline`、pipelineSlo router、`goTrueHealthMonitor`(Supabase Auth 健檢)、providerHealthProbeJob 探測 `${SUPABASE_URL}/auth/v1/health` |
| 身分模型 | users.id(int)+ JWT(自簽) | `creator_id uuid` + Supabase Auth(GoTrue)/service role |

### 2.4 雙庫並存的風險

1. 🔴 **雙告警表已實際分裂**:`drizzle/schema.ts:3411-3416` 註解宣告「orb_system_alerts 是 MYSQL LEGACY,live 表是 Supabase system_alerts,providerHealthProbeJob 經 Supabase SDK 寫入」——但 **providerHealthProbeJob.ts 實際 import 的是 Drizzle `orbSystemAlerts`、寫 MySQL**(providerHealthProbeJob.ts:12,224-280)。即:供應商健康告警進 MySQL、管線停滯/心跳告警進 Supabase,**註解與程式碼互相矛盾、監控視野切成兩半**(AIDV-726/730 只記錄了 naming gap,未收斂)。
2. 🔴 **Supabase 基底 DDL 不在版控**:agent_tasks/video_projects/video_segments/system_alerts/creator_job_throttle 等核心表無 repo migration;`mcp list_migrations` 才是真相,環境重建與 code review 都缺依據。
3. 🟡 **身分未打通**:MySQL int userId ↔ Supabase uuid creator_id 無對照表;跨庫無交易、無一致性保證(video_projects 在兩庫都有同名概念,02 §12)。
4. 🟡 **兩套限流互不知情**:MySQL 側 orbQuota(記憶體 40 次/天)vs Supabase trigger(20 tasks/hr);使用者體感的「額度」有兩本帳。
5. 🟡 **密鑰面翻倍**:SUPABASE_SERVICE_ROLE_KEY 在 Railway env + Supabase DB setting(`app.settings.service_role_key`)各一份,輪替要記得兩處。

### 2.5 `db/` 目錄與 `.manus/db`

- `db/migrations/20260510_add_orb_memory_summary.ts`:單檔孤兒——為修 OAuth upsert 的 ER_BAD_FIELD_ERROR 而寫的 `ALTER TABLE users ADD COLUMN orbMemorySummary`,**全 repo 零引用**(grep 無 import、無 runner 讀取),Manus 時期遺物,可刪或併入 drizzle migration 流程。
- `.manus/db/`:19 個 `db-query-<timestamp>.json` = Manus 開發環境當年執行 DDL 的查詢紀錄(內容是 CREATE TABLE 原文快照),純開發遺物、非 runtime 依賴;可作考古比對但不應留在 repo 根。

---

## 3. 安全防護層總盤(server/_core)

### 3.1 請求管線順序(_core/index.ts:498-1010)

```
trust proxy(1)
→ requestTraceMiddleware(traceId/AsyncLocalStorage)
→ helmet(helmetOptions) + Permissions-Policy
→ compression(>1KB)
→ rateLimitContextMiddleware(degraded-mode helper)
→ 分層限流:auth 路由 10/15min;/api/upload 20/15min(finalize 豁免到 api 層);/api/* 300/15min
→ express.json 4MB(/api/upload,rawBody 保留)+ urlencoded 4MB
→ 全域 CSRF origin guard(AIDV-558:非 GET/HEAD/OPTIONS、非 /api/trpc、非 /api/webhook/*
   → Origin/Referer 必須等於 VITE_SITE_URL,否則 403;kill-switch CSRF_PROTECTION=0)
→ 各 REST/webhook/SSE 路由(webhook 另掛 rawBody json parser)
→ /api/trpc:express.json 4MB(AIDV-572 修 body-parser 吞 body 事故)
   → jsonDepthGuard(32)(AIDV-293 防 Billion-Laughs)
   → x-trpc-source header CSRF 檢查(AIDV-219,POST 缺 header 403)
   → tRPC appRouter
→ errorTrackingExpressErrorHandler(Sentry)→ globalErrorHandler
```

### 3.2 各防護件現況

| 元件 | 內容 | 評註 |
|---|---|---|
| securityHeaders.ts | CSP(default 'self';img/media https:;connect https:/wss:;frame-ancestors 'none')、HSTS 1 年+preload、X-Frame-Options DENY、Referrer-Policy strict-origin-when-cross-origin、Permissions-Policy 關 camera/mic/geo/payment/usb;prod 與測試共用同一 options(防漂移) | 🟡 `scriptSrc 'unsafe-inline'`(Vite/SPA 需要)+ `connectSrc https:`(等於允許打任何 https)——CSP 防禦力被這兩項稀釋 |
| csrfOriginGuard | 兩層:全域 Origin 比對(上表)+ tRPC 自訂標頭;測試檔 csrfOriginGuard.test.ts | 🟢 雙保險;localhost site URL 自動略過 |
| inputGuard.ts | jsonDepthGuard(32 層巢狀上限,早退演算法) | 🟢 |
| xssInputGuard | 非中央模組——實作為各 router 的 zod `refine(v => !/[<>]/.test(v))` 於 title 類欄位;腳本內容欄位刻意放行 HTML(創作自由);xssInputGuard.test.ts(AIDV-250)鎖住此契約 | 🟡 靠約定而非中央 sanitizer,新欄位易漏 |
| ssrfGuard.ts | 同步 assertSafeExternalUrl(協定白名單、private IPv4/IPv6/IMDS/metadata/IPv4-mapped-IPv6)+ **async DNS 解析版防 DNS-rebinding**(AIDV-638,解析失敗 fail-closed)+ isExactOriginAllowed | 🟢 水準以上 |
| fetchGuard.ts | **不是安全層**——只把缺協定的 URL 自動補 https:// 的全域 fetch monkey-patch | 🟡 名稱誤導;自動補協定可能掩蓋設定錯誤 |
| rateLimiter.ts | 6 tier(auth10/llm60/api300/upload20/health120/proxyDownload30 每 15min);REDIS_URL 時自動換 RedisRateLimitStore(跨 replica),否則記憶體;per-user key(登入後)/per-IP;另有 tRPC 層 in-process bucket:ai.chat 20 RPM、feedback 10/h | 🟡 in-process bucket 在多 replica 不共享;ENABLE_RATE_LIMIT=false 全域 kill-switch |
| secretCrypto.ts | AES-256-GCM + scrypt 導鑰;v2 金鑰版本化(CREDENTIAL_ENCRYPTION_KEY_k2 + _ACTIVE 零停機輪替);fallback 鏈 CREDENTIAL_ENCRYPTION_KEY→JWT_SECRET_RAW→JWT_SECRET | 🟡 見風險 E5(JWT_SECRET fallback) |
| webhookTokens.ts | per-job HMAC capability token(`scope:id` 簽 JWT_SECRET)防偽造回呼;fal 另有 nonce 模式(URL 先於 jobId 存在);無 secret 時 dev skip、**prod 一律強制**;FAL_WEBHOOK_FAIL_CLOSED 預設 ON(AIDV-158) | 🟢 補足 Suno 無簽章 API 的洞 |
| oauthState.ts + googleAuth | state 帶 purpose/redirect/**anti-CSRF nonce**(AIDV-580,鏡射 oauth_state cookie 於 callback 驗證);JWT 硬化 AIDV-59:prod 開機 assertJwtSecretReady() fail-fast(≥16 字元)、TTL 由 1 年縮至 30 天、AIDV-319 加 `aud:"healing-studio"`;refresh token 輪替程式完整但預設 OFF | 🟢(rotation OFF 為已知半成品,見 01 §3.8) |
| agentScopeGuard / agentCreatorQuota | 代理角色範圍強制(預設 ON,可切 log-only)、per-creator 並發配額(Redis 可升級,AIDV-923) | 🟢 |

### 3.3 contentModeration + ragInjectionGuard(實作內容)

- **contentModeration.ts(AIDV-65)**:113 行,本體只有旗標解析——`CONTENT_SAFETY_FAIL_CLOSED` 預設 ON=fail-closed:checkSafety(LLM 審核)逾時/錯誤/解析失敗一律回 `{safe:false}` 擋下。檔頭誠實揭露**涵蓋邊界**:(1) 只接 routers.ts checkSafety 的兩個 generate.* 端點;(2) fal `enable_safety_checker` 只有 videoStudio.wanTextToVideo 一個 live 注入點開回 true;**falDispatcher 主 dispatch 路徑(光球主要出圖/出影)完全不設 safety_checker**,靠上游 moderateOrbContent gate。LLM 全掛時 fail-closed 會把這兩端點的生成一起擋死(刻意取捨,有 timeout+一次重試+回退旗標)。
- **ragInjectionGuard.ts(AIDV-69)**:447 行純函式,三段處理(注入樣式中和/長度筆數上限/「視為資料非指令」邊界包裹),永不 throw、出錯 fallback 原文。已接線:Director 三條 RAG 注入路徑(costar/planning/scriptGeneration)+ 四條記憶側門(buildMemoryContext、orbLLMReplan、orb planner memory summary ×2 消費端、spiritPromptEnhancer);教材庫 search snippet 明確不接(不進 LLM prompt)。⚠️ **旗標 `ENABLE_RAG_INJECTION_GUARD` 預設 OFF**(且不在 zod schema)——防護寫好了、線上未必開。

### 3.4 已知風險點(基建層)

| # | 風險 | 等級 | 證據 |
|---|---|---|---|
| S1 | **Stripe webhook**:secret 有設→真驗章;未設→prod fail-closed(503)、dev 放行;但 **6 個事件 handler 全是 TODO**(checkout.session.completed/invoice.paid/…只 log 不寫 userSubscriptions)——驗章正確、業務空轉 | 🟡 | routes/stripeWebhook.ts:166-315 |
| S2 | **proxy-download 白名單過寬**:`endsWith(".amazonaws.com")` 允許**任何人的 S3 bucket**、`r2.cloudflarestorage.com` 允許任何 Cloudflare 帳號的 R2;登入使用者可把此端點當任意檔案中繼(100MB/次、30 次/15min)。auth+限流+byte cap 皆在(AIDV-265/311),但 allowlist 語意是「供應商網域」而非「我們的 bucket」 | 🟡 | _core/index.ts:325-351,792-881 |
| S3 | SSE:ownership lockdown 預設 ON(IDOR 修補)、per-user 並發 5(AIDV-632)、demo 安全降級;回退旗標 SSE_OWNERSHIP_LOCKDOWN=false 仍要求登入 | 🟢(回退旗標存在即殘餘風險) | env.validated.ts:365-372 |
| S4 | /api/metrics、/api/health/detail、provider health 皆 admin fail-closed(AIDV-58/614 修過匿名洩漏);/api/health 公開但只回布林;/api/version 公開回 commit SHA(刻意,AIDV-952) | 🟢 | _core/metricsRoute.ts |
| S5 | maps proxy(/api/maps/proxy/*)無 auth,但 path 白名單只放 `maps/api/js`、query key 白名單、key 由後端注入 | 🟢 | _core/index.ts:687-757 |
| S6 | 密碼:scrypt 預設、強度規則、防枚舉、登入失敗三維度計數(email/email+IP/IP);2FA TOTP;帳號刪除需 literal 確認字串 | 🟢 | localAuth.ts(01 §3.8) |

---

## 4. 測試與 CI/CD

### 4.1 測試資產盤點

| 類型 | 數量/位置 | 內容 |
|---|---|---|
| Vitest 單元/契約 | **~610 個 .test/.spec 檔**:server 內聯 365、client 內聯 130、shared 4、tests/unit/ 103(client/server/shared 三夾) | vitest.config.ts include 內聯+集中兩式;node env 預設、per-file jsdom;含大量「守門型」測試(migration 規則、header 防漂移、fail-closed 行為、SSRF/CSRF/IDOR 收斂測試如 ssrfJwtConvergence、videoIdorConvergence) |
| Playwright e2e | tests/e2e/ **8 個 spec**(agent-preferences、image/video/pro-studio 生成流、orb 25 精靈、routes smoke、trpc transport smoke);chromium only;`E2E_BASE_URL`(預設 localhost:5173);刻意避開 LLM 依賴 | **不在 CI 內**,需人工起 dev server 跑 |
| npm run eval | server/eval/runEval.ts → agentEvalRunner;**6 個 built-in case**:basicImageGen、delegationFromDirector、blockedUnknownTool(封鎖未知工具)、multimodalImageToVideo、loraTrainingRequest、multiStepWorkflow;支援 tag 過濾 | agent planner regression;**不在 CI 內** |
| scripts/check-* 全套 | check-deps(--typecheck)=`npm run check`、scan-routes、scan-shell-routes、scan-learn-wiring、scan-settings-wiring、smoke-routes、check-agent-health、check-internal-navigation;audit-12-roles/audit-25-spirits/audit-music-voice;simulate-director-orb/simulate-full-site-orb/simulate-orb-studio-25;verify-auth-fail-closed.sh、verify-redis-generation-lock.ts;browser-audit/、model-harness/ | 靜態接線掃描+模擬器文化很強;多數只在本機/技能流程手動跑 |

### 4.2 CI(.github/workflows)

- **唯一 workflow:`pr-gate.yml`(AIDV-56)四關**:`tsc --noEmit` → `npm run check:routes` → `npm run check:navigation` → `npx vitest run`(全量)。ubuntu-latest、Node 20、npm ci、timeout 20 分、`permissions: contents: read`、concurrency 取消舊 run。
- ⚠️ **目前所有 CI run 約 3 秒即死 —— 已確認為 runner 層問題(GitHub runner/計費/組織設定層),非程式問題**;四關在本機可全綠。這代表「PR gate 擋壞碼」的保證此刻實際失效,合併只剩人工把關,修復 runner 是最高優先的流程債。
- 缺席項:e2e、eval、build 驗證、`check:smoke`、secret scanning、依賴稽核皆未進 CI。

### 4.3 Dockerfile 建置流程

兩階段 node:20-alpine:
1. **builder**:apk 加 python3/make/g++(native addons)+ pip 升 cryptography(CVE-2024-0727);`NODE_OPTIONS=--max-old-space-size=4096` 防 Vite OOM;`npm ci --legacy-peer-deps`;`npm run build`(vite build + esbuild server → dist/index.js)。
2. **runner**:`NODE_ENV=production`;apk 加 **mariadb-client + mariadb-connector-c**(dbSnapshotJob 的 mysqldump;connector-c 是 MySQL 8 caching_sha2_password 認證必需,否則備份 0-byte——檔內註解記錄了這個事故);COPY node_modules/dist/drizzle;⚠️ 另 **COPY server/、client/src/、shared/ 原始碼進 prod 容器**(+10MB)——因 AI 全站研究系統 siteCodeScanner 要在 runtime 讀 TS 原始碼。體積與資訊暴露面(容器內含全部後端原始碼)是刻意取捨。

### 4.4 railway.toml

- `builder = "DOCKERFILE"`(明示避開 Nixpacks 自動注入 npm ci;.nixpacks.toml 僅 fallback)。
- `healthcheckPath = "/api/health"`、**`healthcheckTimeout = 600`**(自 120→300→600 一路放寬:開機期 model-research 風暴+migrations 曾把 readiness 推超過 120s 造成健檢誤殺;現搭配 bootReady-503 模式,健檢重試到 init 完成)。
- `restartPolicyType = "ON_FAILURE"`、`restartPolicyMaxRetries = 3`;startCommand `node dist/index.js`。
- 與 MIGRATION_FAIL_CLOSED 組成部署安全網:migration 壞 → exit(1) → 3 次重啟 → 停在失敗狀態等人工回滾。

---

## 5. 錯誤處理與可觀測性

### 5.1 基礎件

| 件 | 內容 |
|---|---|
| logger(_core/logger.ts) | 自製 structured logger + **AsyncLocalStorage trace context**(traceId/orbTraceId/requestId);requestTraceMiddleware 接受上游 x-request-id(AIDV-289,headless 代理可傳);DB 專用 helpers:logDbError(transient 自動降 warn)、logSlowQuery(截 500 字)、logCircuitBreaker |
| errorTracking(AIDV-58) | Sentry env-gated:無 DSN 完全 no-op;@sentry/node 為**選用相依且目前不在 package.json** → **線上 Sentry 實際是 no-op**,錯誤只進 logger;beforeSend 剝除 cookie/authorization/x-orb-webhook-secret 等標頭、關 sendDefaultPii |
| error_handler | AppError(statusCode/errorCode/isOperational)+ globalErrorHandler(回 traceId;non-operational 遮蔽為 "Internal server error");**registerFatalErrorHandlers:uncaughtException 一律 fatal(優雅關機);unhandledRejection 只記 log,超過風暴閾值才 fatal**(error_handler.ts:95-145)——比「一律 crash」溫和、比「靜默吞」可觀測 |
| metrics + metricsRoute | in-process 滾動視窗(1min/15min 延遲百分位、per-endpoint 錯誤率、per-model token);零外部後端;/api/metrics + /api/health/detail + provider health 三端點同一 requireAdmin fail-closed 門;關機時 flush 最終快照進 log |
| /api/health | 公開;no-store;demo 短路;bootReady 門(503 booting);DB ping 3s timeout + JWT secret 長度雙探測;503 給 UptimeRobot/Railway |
| /api/version(AIDV-952) | 公開回 RAILWAY_GIT_COMMIT_SHA,供 qa-explore/sec-patrol 比對 prod 部署新舊 |

### 5.2 生成失敗 retry/refund 鏈(全鏈路)

```
扣點(原子,users.remainingGenerations)→ fal/gemini 派工
├─ 供應商層:falRecoveryPolicy(ADP-2)三層分類
│    transient(429/timeout/網路)→ 退避重試 ≤3(base 2s, cap 30s)
│    content(審核拒絕/壞輸出)→ 改 prompt 重試 ≤2
│    hard(模型不可用/永久 4xx)→ 降級模型重試 ≤1
│    超限 → degraded=true 結束(工作流不中止);未知錯誤預設 transient(安全側)
├─ 工具層:orbToolRetry.withToolRetry(指數退避、retryable/nonRetryable 錯誤碼
│    清單、重試遙測、onRetry 回調)包 research.deepSearch 等外部工具
├─ 卡死兜底:staleJobChecker(每 1 分):processing>5min → retryCount<3 重新
│    排隊、否則標 failed + SSE job_failed + Redis DLQ(dlq:video_jobs);
│    queued>10min 亦處理;涵蓋 image/video/audio/voice
├─ 代理驗證門失敗:agentDlq.insertDlqEntry → MySQL agent_dlq 表
│    (retry/decision/escalate 路由 + correlationId 串 log,AIDV-926);
│    agentDlqPoller cron 心跳監控(ENABLE_AGENT_DLQ 預設 ON)
├─ 退款:refundUserPoints claim-then-refund 原子退款(02 §1.1);
│    退款狀態可查 credits.jobRefundStatus;⚠ cost_ledger 未接退款
│    (production 零 credit 分錄,env.validated.ts:672-678 誠實揭露)
└─ 使用者可見:genErrorToast 單一 toast 契約(AIDV-160)——cost-blocked
     (AdapterCostBlockedError)顯示冷靜的「未扣點、請改引擎」toast 且抑制
     第二個通用失敗 toast;SSE 斷線降級輪詢 + SSEFallbackBanner
```

### 5.3 外部觀測面

- **LangSmith**:langsmithTracer lazy 載入(無 key→null client;key 格式 self-repair 驗證);dashboard `/dashboard?section=langsmith` 真連 API(01 §3.6)。
- **PostHog**:前端 VITE_POSTHOG_KEY(build-time 注入,未設 no-op);後端 POSTHOG_API_KEY 只接 **aiProxy 用量事件雙寫**(routes/aiProxy.ts:92)一個點。
- **Slack**:apiUsageAlertJob 每 15 分 cron 讀 api_usage_logs+alert_configs → POST ALERT_SLACK_WEBHOOK(受 ENABLE_BUDGET_ALERTS);ALERT_EMAIL_RECIPIENTS 保留欄位**未實作**。
- **Discord**:DISCORD_WEBHOOK_URL 供 API 健康巡檢告警。
- **Sentry**:接線完成、套件未裝 → 實際 no-op(見 5.1)。

### 5.4 Supabase `system_alerts` vs MySQL `orb_system_alerts` 雙表問題(彙整)

- 寫入面:**providerHealthProbeJob(Node)→ MySQL orb_system_alerts**(連續 2 敗告警、自動 resolve);**pg_cron detect_pipeline_stall / check-heartbeat-liveness + AIDV-718 各寫入路徑 → Supabase system_alerts**(service_role-only policy + AIDV-834 active 去重索引)。
- schema.ts:3411-3416 註解宣稱 orb_system_alerts 是 legacy、「providerHealthProbeJob writes there via Supabase client SDK」——**與實碼不符**(該 job import Drizzle orbSystemAlerts)。
- 後果:admin/監控 UI 讀哪張表就看見哪半邊;告警去重、resolve 生命週期、保留策略兩套各自演化。這是雙 DB 風險(§2.4 #1)最具體的病灶,建議收斂為單一告警面(Supabase)+ MySQL 側改寫轉接層。

---

## 6. 技術債清單 + 優化路徑

### 6.1 基建層技術債(承接 01 §7 死碼/半成品清單,以下為本文件新增/深化)

| # | 債項 | 證據 | 影響面 |
|---|---|---|---|
| D1 | **記憶體態資料五處**:learnHub 文件/影片/測驗主資料(learnHub.ts:50;cron 產文不落 DB)、aiModels enrichment Map+研究排程(modelResearcher.ts:71-88;aiModels.ts:221)、**orbTask FSM in-memory Map**(orbTaskStateMachine.ts:73;`ORB_TASK_STORE_FILE` 檔案持久化選項存在但預設空、需掛 volume)、chat/feedback in-process 限流桶(rateLimiter.ts:235-284)、orbQuota 生成配額(40/天,記憶體) | env.validated.ts:606-613 | redeploy 掉資料/掉任務;多 replica 水平擴展被鎖死(限流與 FSM 不共享);Redis 只救了 generation lock/rate-limit store/creator quota 三件 |
| D2 | **雙 DB 治理債**(§2.4 全部):雙告警表+註解與實碼矛盾、Supabase 基底 DDL 不在版控、身分未打通、雙限流帳 | schema.ts:3411;providerHealthProbeJob.ts:12 | 監控盲區、環境不可重建、稽核困難 |
| D3 | **雙 SSE bus**:generationBus/legacy adminEvents bus vs 統一 /api/sse(UNIFIED_SSE_ROUTER 預設雙端 OFF);UNIFIED_GEN_EVENT_BUS=true 時 admin legacy 通道靜默失效;agent-events 兩通道前端死碼 | 02 §8;_core/index.ts:641-644 | 事件面三套並存,新功能不知接哪條 |
| D4 | **雙導航 chrome**(AidvShellChrome vs AppleDock 白名單 4 頁)+ appRegistry admin group 死碼 + SIDEBAR_GROUPS=[] | 01 §6 | UI 改版要改兩處,舊 chrome 逐漸腐化 |
| D5 | **CI runner 3 秒死**:pr-gate 四關全部失效中(runner 層,非程式) | .github/workflows/pr-gate.yml | 合併零自動把關——所有其他測試投資此刻無法兌現 |
| D6 | **監控半接線**:Sentry 套件未裝(no-op)、ALERT_EMAIL 未實作、PostHog 後端僅 aiProxy 一點、cost_ledger 旗標 OFF 且退款未接 ledger、ENABLE_RAG_INJECTION_GUARD 預設 OFF | package.json;env.validated.ts:672-679 | 「看起來有」與「實際在跑」有落差,事故時才發現 |
| D7 | env schema 覆蓋缺口 ~68 變數 + 服務繞過 serverEnv 直讀(E4/E6) | grep 統計 | 設定錯誤靜默、admin 狀態燈不準 |
| D8 | 硬編碼三處:admin email(E1)、Suno proxy 網域(E2)、proxy-download 白名單過寬(S2) | localAuth.ts:89;modelClients.ts:394;index.ts:325 | 安全/供應商切換 |
| D9 | 孤兒檔:db/migrations 單檔零引用、.manus/db 19 個查詢紀錄、.env.example 的 OPENPOSE_API_KEY 等佔位變數、Manus Forge 向後相容變數群 | §2.5 | 認知負擔;新人誤判 migration 流程 |
| D10 | e2e/eval/simulate 全套不在 CI;Playwright 只 8 支 smoke;eval 只 6 case | §4.1 | 回歸保護集中在 vitest,行為級回歸靠人工 |
| D11 | Dockerfile 把 server/client/shared 原始碼複製進 prod 容器(siteCodeScanner 需求) | Dockerfile | 映像體積+原始碼暴露面(容器被攻破即拿到全部後端碼) |
| D12 | .env.production 使 SHELL_SOCIAL=1 上線,但 /social 發佈鏈是 mock(01 §5) | .env.production:24 | 線上使用者可踩到假發文流程,體驗債 |
| D13 | 訂閱/收款鏈斷裂:Stripe handler 全 TODO、plans 無購買 UI、email 驗證未接、refresh rotation OFF(引 01 §3.8) | stripeWebhook.ts | 商業化前置全是半成品 |

### 6.2 優化路徑

**近期(1–2 週,低風險高回報)**
1. 修 CI runner(D5)——其他一切測試投資的前提;順手把 `npm run eval` 與 `check:smoke` 加進 pr-gate(便宜且已存在)。
2. 移除 admin email 硬編碼 → 純 ADMIN_EMAILS(E1);Suno baseUrl 抽成 SUNO_API_BASE_URL(E2);proxy-download 白名單改精確 bucket host(S2)。
3. 收斂雙告警表第一步:providerHealthProbeJob 改寫 Supabase system_alerts(或至少修正 schema.ts 註解與實碼的矛盾),admin UI 單一讀取面(D2)。
4. 裝 @sentry/node(接線已完成,裝上即生效);決定 ENABLE_RAG_INJECTION_GUARD 是否轉 ON(防護已寫好+有測試)。
5. 刪 db/migrations 孤兒檔與 .manus/db;把 ~68 個 schema 外變數補進 env.validated(D7/D9)。

**中期(1–2 月)**
6. 記憶體態資料落地(D1):learnHub 文件/影片/測驗全量進 learn_modules(cron 產文落 DB);aiModels enrichment 落表;orbTask FSM 掛 `ORB_TASK_STORE_FILE` volume 或改 DB/Redis——這是「多 replica 水平擴展」的前置。
7. Supabase schema 治理:用 `supabase db pull` 把 agent_tasks 等基底 DDL 補進 repo migrations,建立「repo 為準」的施作紀律(D2)。
8. 金鑰分離:CREDENTIAL_ENCRYPTION_KEY 獨立設置(脫離 JWT_SECRET fallback)、webhook token 换獨立 secret;制定 JWT_SECRET 輪替 SOP(E5)。
9. 統一事件面:完成 UNIFIED_SSE_ROUTER 切換、刪 legacy adminEvents/agent-events 死碼(D3);拆掉 AppleDock 舊 chrome(D4)。
10. e2e 進 CI(build + preview server + Playwright smoke);eval case 擴充到覆蓋 15 精靈主要路徑。

**長期(一季+)**
11. 雙 DB 戰略決策:要嘛 (a) Supabase 只留「多代理管線+監控」並打通身分對照(userId↔uuid),要嘛 (b) 併庫。現狀「兩本帳+兩套限流+跨庫無交易」不可長期維持(D2)。
12. credits/帳務單一真相:cost_ledger 補退款接線與 backfill 後開旗標,逐步取代 users.remainingGenerations 原子欄位(env.validated OPEN DECISIONS 已列待拍板項)。
13. CSP 去 unsafe-inline(Vite nonce/hash 方案)、connectSrc 收斂到具名網域(S 系列)。
14. MySQL 補 FK(以新表先行、舊表配合資料清洗分批),或正式文件化「無 FK+應用層完整性」為架構決策並補孤兒列掃描 job。
15. 商業化鏈路補完(D13):Stripe handler 實作 → plans 購買 UI → email 驗證接線 → refresh rotation 開啟。

---

## 7. 缺讀聲明

- `server/db.ts`(runMigrations/applyMigrations 內部、refundUserPoints 實作)只讀了 fail-closed 判定點(:215)與外部引用,未逐行。
- `server/routes/aiProxy.ts`(llm/llmPerUser 限流掛載、PostHog 雙寫細節)、`server/routes/uploadRoute.ts`(magic byte 驗證)僅依 02 與 grep 證據引用。
- Supabase 23 支 migration 以 DDL 語句層級掃過(CREATE/ALTER/POLICY/TRIGGER/cron 全列),函式 body 僅重點閱讀(dispatch_task 429、rate_limit trigger、heartbeat cron);edge function index.ts 內文未逐行。
- metrics.ts 中後段(百分位實作)、ragInjectionGuard 中後段(sanitize 規則明細)、orbToolRetry/falRecoveryPolicy 中後段、logger 中段(write/flush)未逐行;結論以檔頭契約+已讀片段為限。
- 線上 Railway/Supabase 實際 env 值、CI runner 死因(GitHub 端)無法從 repo 得知。
