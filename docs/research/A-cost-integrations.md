# A — 營運成本 × 外部整合(Phase 2-A)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`
- 依據:00/01/02 號文件 + 本次深讀(`server/jobs/` 全部 24 支 cron、`server/_core/llm*.ts`、`railway.toml`、`.env.example`、各供應商 client 檔逐一實讀,證據附 `檔案:行號`)
- **本文件所有金額層級判斷均屬「架構推估」**:凡需實際數字處一律標「待補」。計費模式只描述各供應商官方公開的計費「方式」,不填任何具體單價。
- 詞彙依 `00-overview.md`(光球、15 精靈、導演 AI、資料庫=Teaching Archive 等)。

---

## 1. 對外依賴地圖

### 1.1 生成媒體供應商(變動成本大宗)

| 服務 | 用途 | 主要呼叫點 | 計費模式(官方公開模式) |
|---|---|---|---|
| **fal.ai** | 全站生成主力:圖(23 模型)、影(13+)、音/語音(30+)、LoRA 訓練、圖轉 3D;queue API + webhook | `server/services/falQueueClient.ts`、`falDispatcher.ts`(統一派工)、`falTrainer.ts`(訓練)、`server/routers/imageStudio.ts`/`videoStudio.ts`/`proStudio.ts`/`generate.ts`/`director.ts`(批次生成鏈)、回呼 `server/routes/webhookFal.ts` | 預儲值、按次/按產出計價:圖依張數×解析度、影依秒數×模型檔次、訓練依運算量。模型間單價差可達數十倍(如 Veo3 Pro/Sora 級 vs SDXL 級) |
| **Replicate** | LoRA 訓練預設引擎(flux-dev-lora-trainer)+ 訓練狀態輪詢 | `server/services/replicateClient.ts`、`server/jobs/modelTrainingWorker.ts`(每 5 分輪詢)、回呼 `webhookReplicate.ts` | 按硬體秒數計價(GPU 時間),訓練一次一結 |
| **ElevenLabs** | 三條管道:①fal 管道 `fal-ai/elevenlabs/tts/*`(計入 fal 帳)②直連 SDK TTS(`eleven_v3`)③**Scribe 轉錄**(`scribe_v1/v2_flash`,資料庫音/影檔進 RAG 前轉文字) | `server/services/elevenLabsExtended.ts:231,459`;轉錄消費端 `teachingArchiveIngest.ts`;開機健康檢查 `_core/index.ts:402`;訂閱快照 `jobs/providerSnapshotJob.ts:38` | 月訂閱制+字元配額(TTS 按字元、Scribe 按音訊時長);超額另計。fal 管道部分則按 fal 計價 |
| **Suno** | 完整歌曲生成(v3.5/v4)。**經第三方 proxy `apibox.erweima.ai`(sunoapi.org),非官方 API** | `server/services/modelClients.ts:394`(baseUrl)、`proStudio.ts:2014-2134`、回呼 `webhookSuno.ts`;credit 快照 `providerSnapshotJob.ts:73`(打 `api.sunoapi.org`) | 第三方 proxy 預儲 credit、按首計價。**供應鏈風險:非官方、合約條款與存續性不受控**,2026-05 已發生過一次回應契約變更(modelClients.ts:434 註解) |

### 1.2 LLM 供應商(經 `server/_core/llmRouter.ts` 統一路由)

| 服務 | 用途 | 呼叫點 | 計費模式 |
|---|---|---|---|
| **OpenRouter** | 推薦單一閘道;auto 優先序第一;裸 `claude-*`/`vertex/*` 模型 ID 自動改寫為 OpenRouter 路徑 | `llmRouter.ts:629-638`;全站 25 個非測試檔呼叫 `invokeLLM`(見 §2.3) | 預儲值、按 token 計價(各模型透傳原廠價+平台抽成) |
| **Anthropic 直連** | 選用;未設 key 時 claude-* 全走 OpenRouter | `llmRouter.ts`(anthropic 分支);`.env.example:100-106` | 按 token(MTok 輸入/輸出分計);程式內建估價表 `_core/llm.ts:615-629`(僅內部成本歸屬用,需人工跟原廠對價) |
| **Gemini(AI Studio)** | ①新聞 OARS 柔化(Flash 批次)②精準度抽測③**RAG embedding(`gemini-embedding-001`,3072 維)**④媒體生成 fallback(Imagen/Veo/Lyria/TTS) | `jobs/newsFetcher.ts:549`、`services/brainAutoRepair.ts:2535`、`services/ragMemory.ts:23-43`、`services/geminiMedia.ts` | 免費額度+付費按 token/按媒體產出;embedding 按 token |
| **Vertex AI** | 企業級 Gemini 部署路徑(選用,未設走 OpenRouter) | `llmRouter.ts:726` | GCP 帳單,按 token/媒體秒數 |
| **NVIDIA NIM** | MiniMax M2.7 等第三方模型 | `llmRouter.ts:744`;env `NVIDIA_API`(env.validated.ts:701) | 按 token(有免費開發額度) |
| **Perplexity Sonar** | 導演 chat 研究引擎(`perplexity/sonar-pro`,costarService.ts:166)、模型情報 discovery、webSearch/新聞/learn 三處 fallback;**全站經 `perplexityThrottle.ts` 集中節流(per-user 時/日+全站每分鐘,env 可調)** | `services/perplexityDeepSearch.ts`、`modelResearcher.ts`、`braveLearnFetcher.ts:185`;直連 key 已淘汰,預設走 OpenRouter sonar | 按請求+token(sonar 系含搜尋 grounding 附加費) |

### 1.3 資料/儲存層

| 服務 | 用途 | 呼叫點 | 計費模式 |
|---|---|---|---|
| **Cloudflare R2**(S3 相容,主儲存) | 媒體上傳(`uploads/`)、生成品歸檔(`generated/studio/…`)、LoRA 訓練 ZIP、**每日 DB 備份(`db-backups/`)**、用量快照 | `server/storage.ts:5-15,462-484`(優先序 R2→GCS→proxy→local)、`uploadRoute.ts`、`mediaArchivalService.ts`、`dbSnapshotJob.ts`、`r2SnapshotJob.ts` | 儲存 GB-月 + Class A(寫/列)/Class B(讀)操作次數;**egress 免費**(R2 的核心定價特徵,對媒體平台有利) |
| **GCS** | 第二順位儲存 fallback | `storage.ts`、`GOOGLE_APPLICATION_CREDENTIALS_JSON` | 儲存 GB-月 + 操作 + **egress 計費**(與 R2 不同) |
| **MySQL(主庫)** | Drizzle 102 表;host 由 `DATABASE_URL` 決定(.env.example 建議 Cloud SQL/PlanetScale,實際供應商**待補**) | 全站 | 依供應商:instance 月費或用量計價 |
| **Supabase Postgres** | prod 第二資料面:`system_alerts` 正式監控告警、`agent_tasks`+`creator_job_throttle` DB trigger 限流、2 個 edge functions | `providerHealthProbeJob.ts`(寫 alerts)、`goTrueHealthMonitor.ts:46`(auth 健康)、`supabase/` | 方案制(Free/Pro)+ 超額用量(DB 大小、MAU、egress、edge function 呼叫);實際 plan **待補** |
| **Pinecone** | RAG 向量庫:index `ai-director-memories`(3072 維),資料庫素材切片+光球長期記憶 | `services/teachingArchiveRag.ts`、`ragMemory.ts`;gate=`RAG_MEMORY`(有 PINECONE_API_KEY 即開,失敗靜默降級 LIKE) | serverless 按讀/寫單位+向量儲存 GB-月;或 pod 制固定月費;實際 plan **待補** |
| **Redis** | 選填:生成防重複鎖、rate-limit store、creator quota、modelResearcher enrichment write-through 暖啟動 | `_core/redisClient.ts` 等 5 檔;Railway addon 自動注入 `REDIS_URL` | Railway addon 按 RAM/用量計;未設=記憶體版(單機免費) |

### 1.4 搜尋/資料來源

| 服務 | 用途 | 呼叫點 | 計費模式 |
|---|---|---|---|
| **Brave Search** | 光球 ai.chat 爬網研究(`ENABLE_ORB_WEB_RESEARCH=true`)+ 每日 learn 文件抓取(10 固定主題) | `jobs/braveLearnFetcher.ts:98`、webSearch 服務 | 月方案制,按查詢數分級(有免費層) |
| **NewsAPI.org** | 新聞抓取第一順位 | `jobs/newsFetcher.ts:140` | 免費開發層(有請求上限)/付費月訂閱 |
| **NewsData.io** | 新聞第二順位 | `newsFetcher.ts:191` | credit 制方案(每 credit 一批結果) |

### 1.5 可觀測性/協作/其他

| 服務 | 用途 | 呼叫點 | 計費模式 |
|---|---|---|---|
| **LangSmith** | LLM tracing(有 key 才啟用,無 key 完全 no-op) | `services/langsmithTracer.ts:6`;前台 `/dashboard?section=langsmith` 真連 API | 方案制:免費層+按 trace 數/席次 |
| **PostHog** | 前端分析(VITE_POSTHOG_KEY)+ 伺服端 aiProxy 事件雙寫 | `routes/aiProxy.ts:97`(`/capture/`)、vite 注入 | 按事件量計價(大免費額度) |
| **Slack webhook** | API 用量告警(15 分 cron) | `jobs/apiUsageAlertJob.ts:41-46`(`ALERT_SLACK_WEBHOOK`) | 免費 |
| **Discord webhook** | 健康巡檢+GoTrue 監控告警 | `apiHealthMonitor.ts:31`、`goTrueHealthMonitor.ts:32` | 免費 |
| **GitHub Issues** | AI 全站研究提案 → 自動建 Issue | `services/githubIssueClient.ts`(fine-grained PAT) | 免費 |
| **Google Drive/OAuth** | 登入 OAuth + Drive 唯讀資產庫(檔案留 Drive 不搬) | `_core/googleAuth`、`services/googleDrive.ts:25-29` | 免費(API 配額制) |
| **SMTP** | 密碼重設信(未設 SMTP_HOST=console 假發送) | `services/auth/emailService.ts:4-9`(SendGrid/SES/Gmail 任選) | 依供應商按封數/月方案 |
| **Sentry** | 錯誤追蹤(選填,未設 no-op) | `_core/errorTracking`;`SENTRY_DSN` | 免費層+按事件量 |
| **Stripe** | 收款 webhook **骨架**(handler 全 TODO,無購買 UI)→ 目前**零營收、零手續費** | `routes/stripeWebhook.ts` | (未啟用) |
| **Railway** | 部署平台:單一 Dockerfile 服務+healthcheck 600s | `railway.toml` | 按 vCPU/RAM×時間用量計價+egress;實際月費**待補** |

---

## 2. 成本驅動因子(程式碼證據)

### 2.1 cron 常駐 baseline(24 支,`_core/index.ts:173-294` 註冊;單 replica、24/7)

| 頻率 | Job | 外部消耗(每次執行) | Gate/備註 |
|---|---|---|---|
| **每 1 分** | goTrueHealthMonitor | 1×GET Supabase `/auth/v1/health`(goTrueHealthMonitor.ts:14,49)| 免費端點;失敗→Discord |
| 每 1 分 | staleJobChecker | 0(純 DB 掃 background_jobs 逾時)(staleJobChecker.ts:128) | — |
| 每 1 分 | teachingArchiveIngestionWorker | 平時 0(DB 掃描);**有進料時**:unpdf 本地抽文/ElevenLabs Scribe 轉錄+Gemini embedding+Pinecone upsert(批 5)(teachingArchiveIngestionWorker.ts:134) | 消耗與上傳量線性 |
| 每 2 分 | costAttributionOutboxJob | 0(outbox→ledger,DB) | — |
| **每 3 分** | apiHealthMonitor(runHealthPatrol) | ~6×供應商 metadata GET(gemini/nvidia/fal/elevenlabs/replicate/…,免費端點,brainAutoRepair.ts:280-320);**每 20 tick(~60 分)另跑 5 次真 Gemini generateContent 精準度抽測**(≤256 output tokens/次,brainAutoRepair.ts:2468-2545;apiHealthMonitor.ts:69-72);每 ~360 分 runFullCodeScan(**本地檔案掃描,無 LLM**) | 間隔 1-60 分可經 admin API 調,但**存記憶體、重啟歸 3 分**(apiHealthMonitor.ts:80,247) |
| 每 5 分 | mediaArchivalCron | 有待歸檔資產時:下載供應商 CDN→PUT R2(Class A 寫)(mediaArchivalCron.ts:20) | 與生成量線性 |
| 每 5 分 | modelTrainingWorker | 有進行中訓練才輪詢 Replicate(無任務早退,modelTrainingWorker.ts:69)| CircuitBreaker 保護 |
| 每 5 分 | agentDlqPoller | 0(DB) | — |
| **每 10 分** | providerHealthProbeJob | 6×供應商探測 GET(fal/elevenlabs/replicate/anthropic/gemini/openrouter,providerHealthProbeJob.ts:32-91,114);連續 2 敗寫 Supabase system_alerts | 免費 metadata 端點 |
| **每 15 分** | providerSnapshotJob | 1×ElevenLabs subscription GET+1×Suno proxy credit GET(providerSnapshotJob.ts:38,73)→provider_snapshots | 免費端點 |
| 每 15 分 | apiUsageAlertJob | DB 聚合+超標時 Slack POST(apiUsageAlertJob.ts:263) | `ENABLE_BUDGET_ALERTS` 預設 ON(:255);`AI_MONTHLY_BUDGET_USD` 預設 500 |
| 每 15 分 | userAutoCreditJob | 0(DB 發內部點數) | — |
| 每 30 分 | costLedgerReconcileJob | 0(DB) | `ENABLE_COST_LEDGER` 預設 **OFF** |
| 每小時 :17 | assetCleanupJob | 過期資產 R2 DELETE+DB 清列(assetCleanupJob.ts:27) | 依 expiresAt 保留政策(目前無 UI 設定→實際近乎 no-op) |
| **每 6 小時** | newsFetcher | NewsAPI→NewsData→Sonar 三級備援抓新聞+**1 次 Gemini Flash 批次柔化(整批一次送,newsFetcher.ts:14)**→寫 news_articles;**開機 30 秒後另跑一次**(:1046-1056) | 每日 4 次+每次重啟 1 次 |
| 每日 02:00 | dbSnapshotJob | mysqldump→gzip(約 1-3MB,dbSnapshotJob.ts:25)→PUT R2 `db-backups/` | **時間戳累積、程式不清舊檔**,靠 R2 lifecycle rule(:27-28 註解) |
| 每日 03:00 | loginHistoryPurgeJob | 0(DB) | — |
| 每日 03:17 | auditLogPurgeJob | 0(DB) | — |
| **每日 03:30** | modelCatalogResearchJob | discovery(Perplexity/OpenRouter Sonar 找新模型)+stale-only 事實查核(併發 2)(modelCatalogResearchJob.ts:35,86-102);**開機 90 秒後必跑一輪 warmup**(:36,134-136) | 2026-05 已從「每日 64 模型全驗」降為 stale-only;`DISABLE_MODEL_RESEARCH_CRON=1` 可整支關;排程可用 env `MODEL_RESEARCH_CRON_SCHEDULE` 覆寫 |
| **每日 04:00** | braveLearnFetcher | 10 固定主題×Brave Search(fallback Sonar)+LLM 整理(braveLearnFetcher.ts:98,300,508)→**僅寫記憶體**(01 §2.1) | 產出重啟即丟=這筆外呼花費「可揮發」 |
| 每日 04:23 | backgroundJobPurgeJob | 0(DB) | — |
| 每日 09:00 | credentialExpiryAlertJob | 0(DB+告警) | — |
| 每日 18:00 | r2SnapshotJob | **全 bucket ListObjectsV2 逐頁掃描**(Class A 操作,r2SnapshotJob.ts:17,71)→r2_storage_snapshots/r2_object_catalog | 操作次數隨物件總數線性成長 |
| 週一 03:00 | learnDocSyncer | 近 7 天新聞→Gemini 合成 ≤3 篇(learnDocSyncer.ts:396)→**僅記憶體** | 同上,產出可揮發 |

**結論:零使用時每天仍固定發出**約 480×供應商探測 GET(免費)、1440×Supabase health GET(免費)、~120 次 Gemini 小型付費呼叫(精準度抽測)、4 次新聞管線(2 個新聞 API 配額+4 次 Gemini 批次)、1 次 Sonar 模型研究、10 次 Brave 查詢+~10 次 LLM 整理、1 次 mysqldump 上傳、1 次全 bucket 列舉。付費呼叫的絕對量小,但**它不為零、且隨重啟次數增加**。

### 2.2 boot-time model-research storm(railway.toml 註解的主角)

- `railway.toml:11-13`:healthcheckTimeout 由 120→600 秒,原因即「boot-time model-research storm + migrations」。
- 每次部署/重啟固定觸發:+30s newsFetcher 首抓(newsFetcher.ts:1046)、+30s apiHealthMonitor 首巡(apiHealthMonitor.ts:270)、+90s modelCatalogResearch warmup(discovery+stale 查核,modelCatalogResearchJob.ts:36)、開機即刻 ElevenLabs 健康檢查(_core/index.ts:402)。
- modelResearcher enrichment 有 **Redis write-through 暖啟動**(modelResearcher.ts:18,77-80):**有設 REDIS_URL 時重啟不必重打 LLM**;未設 Redis 則 enrichment 全失、下輪 research 重花錢。→ 部署越頻繁,這筆「重啟稅」越高。

### 2.3 LLM 呼叫熱點(25 個非測試檔呼叫 `invokeLLM`)

| 熱點 | 模型/證據 | 成本特性 |
|---|---|---|
| **光球 ai.chat**(全站代理) | `brainProcedure` 走 user_ai_brain director slot——**4/5 個推理 slot 預設 `anthropic/claude-opus-4.7`(最貴檔)**(drizzle/schema.ts user_ai_brain 預設值;analyst 預設 sonar-pro);對話摘要另用 `gpt-4o-mini`(ai.ts:754) | **最大單一 LLM 成本槓桿**:未改組態的使用者每次光球對話都走 Opus 檔 |
| 導演 AI | chat 引擎 `perplexity/sonar-pro`(costarService.ts:166,經 perplexityThrottle);腳本加工/逐段 CO-STAR/批次規劃共 6 處 invokeLLM(director.ts) | 隨導演使用量線性;sonar 含搜尋附加費 |
| 世界觀生成 | worldbuildingGeneration.ts(純文字 LLM ×2) | 線性 |
| 光球周邊 | orbContextLookup/orbClarificationEngine(**僅有的 2 處 `cacheable:true`**)、orbLLMReplan、orbVoiceProcessor、orbGuide、agentToolExecutor、agentDiscussionRunner(多代理討論) | LLM_CACHE 旗標雖預設 ON(_core/featureFlags.ts:119),**覆蓋面極窄** |
| 生成管線 | _generateHelpers(安全檢查/prompt 處理 ×2)、sense.ts(意圖推論)、models.ts(圖片標註輔助) | 隨生成量線性 |
| 評測 | `npm run eval` 跑 `runSchemaFirstAgentPlanner`→**真 invokeLLM(auto 引擎)**(eval/agentEvalRunner.ts:2;agentPlanner.ts:681-684);evaluate router 另有 prompt-judge/inspiration-chips 兩處(evaluate.ts:22,178) | **CI/本地每跑一次 eval 都是真 token 花費**,頻率需控管 |
| cron 類 | newsFetcher(每日 4 批)、braveLearnFetcher(每日 ~10)、learnDocSyncer(每週 ≤3)、modelResearcher(每日+重啟) | 固定燒,見 §2.1 |
| 併發控制 | `MAX_CONCURRENT_LLM_CALLS=5`、`LLM_TIMEOUT_SECONDS=60`(.env.example:26-33) | 天花板保護存在 |

內部估價:`_core/llm.ts:615+` 硬編碼各模型 USD/MTok 估價表,供 cost_attribution/admin 成本頁換算(TWD_PER_USD=32)——**是估帳不是真帳單**,需定期人工對價。

### 2.4 媒體儲存與搬運

- **R2 為主**(storage.ts 優先序),egress 免費是本架構最大的儲存紅利;成本主體=儲存存量(只增不減)+Class A 操作。
- **mediaArchival「雙存」**:生成品先以供應商 CDN URL 入庫,再由 5 分鐘 cron 搬進 R2 並回填 sourceUrl(postGenActions.ts:470-482;mediaArchivalService.ts:63-111)。R2 副本是必要的(fal CDN 檔案非永久),但意味**每筆生成 = 1 次下載 + 1 次 R2 寫入 + 永久存量增加**;`digital_asset_library.expiresAt` 保留欄位已存在(0058 migration)而**保留政策未實際設定**→ assetCleanupJob 形同空轉,存量無出口。
- **DB 備份累積**:db-backups/ 每日 +1 檔(1-3MB),程式不清舊檔(dbSnapshotJob.ts:27-28)。
- **r2SnapshotJob 每日全 bucket 列舉**:物件數越多,Class A 操作費越高(線性)。
- generation_history 同時保留供應商 URL 與 R2 URL,前端下載走 `/api/proxy-download`(100MB 上限)——下載流量經 Railway(**Railway egress 計費**),不是直接 R2 公開網域,量大時是隱形流量費。

### 2.5 資料庫 × Redis

- **雙庫並存 = 雙份固定月費**:MySQL(102 表,主交易面)+ Supabase(監控告警/agent_tasks/限流 trigger/edge functions)。Supabase 在生成主鏈上零呼叫(02 §12),但正式監控告警寫在那裡,不能裸關。
- Redis 選填:未設時鎖/quota/limiter 全記憶體(單機正確);設了才有跨 replica 正確性+modelResearcher 暖啟動。**若永遠單 replica,Redis 的主要價值是省下重啟後的 research 重跑費**。
- 大量狀態存記憶體(learnHub 文件、AIModelsHub enrichment、orbTask FSM、研究排程覆寫、apiHealthMonitor 間隔設定):**省 DB 費用的代價是重啟重算(部分要重花 LLM 錢)與資料揮發**。

### 2.6 應用內配額(成本天花板現況)

- `users.remainingGenerations` 預設 50 點,1 USD≈100pts 報價換算(brain.pricingSummary rateNote);原子扣點+失敗退款。
- `orbQuota.ts:29`:生成 40 次/天/人(記憶體版);Supabase `creator_job_throttle` 20 tasks/hr(DB trigger)。
- 但 **ENABLE_ORB_QUOTA_GUARD / ORB_BUDGET_GUARD / ORB_IDEMPOTENCY_GUARD 預設 OFF**(02 §9.3)→ 光球代理的 LLM 消耗面沒有硬性預算閘,只有 15 分鐘 Slack 告警(被動)。

---

## 3. 各情境月費結構推估(全部屬架構推估;實際數字待補)

> 讀法:「固定」=不隨使用量;「cron 燒」=零使用也發生的變動小額;「線性」=隨用量;「尖峰」=單事件即可觀。

### 3.1 零使用常駐 baseline(平台開著、沒人用)

| 成本塊 | 性質 | 相對量級(推估) |
|---|---|---|
| Railway 單服務 24/7 compute(+選填 Redis addon) | 固定 | 主要固定成本之一;RAM 常駐水位受記憶體快取/enrichment 影響,峰值**待補** |
| MySQL 託管 | 固定 | 固定;供應商與規格**待補** |
| Supabase plan | 固定 | 固定;plan**待補** |
| Pinecone index 存量 | 固定(serverless 則近似「存量費+零查詢費」) | 小~中;plan**待補** |
| R2 儲存存量 | 固定(且**單調遞增**,無清理出口) | 隨歷史累積;現值可查 r2_storage_snapshots,線上值**待補** |
| cron 付費外呼(§2.1:Gemini 抽測 ~120 次/日、新聞 4 批/日、Sonar 研究 1 輪/日、Brave 10 查/日) | cron 燒 | 絕對額小(多為 Flash/小 token 呼叫),但恆常存在 |
| LangSmith/PostHog/Sentry | 固定(免費層可容納低量) | 近零~小 |
| **合計結構** | | **固定底座(Railway+雙 DB+Pinecone+R2 存量)≫ cron 燒**。降到真零的唯一方法是停機,cron 燒可用旗標壓到近零(§5) |

### 3.2 低度使用(個位數人偶爾用)

= baseline + 少量線性:光球對話(注意 Opus 預設檔)、少量 fal 生成(圖為主則便宜)、embedding/Pinecone 寫入零星、R2 增量小。**結構上與 baseline 幾乎相同,固定底座仍是大頭**。

### 3.3 15-20 人常態使用(團隊日常)

| 成本塊 | 驅動 | 相對量級 |
|---|---|---|
| **fal.ai 生成** | 每人 40 次/天上限 → 全團隊理論上限 600-800 次/天;實際命中率**待補**(可查 api_usage_logs/generation_history) | **變動成本第一大宗**;影片類單次成本可為圖片數十倍 |
| **LLM(光球+導演)** | 對話輪數×Opus 預設檔;導演 sonar-pro | 第二大宗;與「預設模型檔次」強相關(§5 槓桿) |
| ElevenLabs 直連(TTS/Scribe) | 語音生成+資料庫音影轉錄量 | 中;訂閱配額制,超量跳級 |
| Suno proxy credit | 歌曲數 | 中;按首 |
| Replicate | LoRA 訓練次數 | 突發;每次訓練一筆 GPU 時數費 |
| R2 增量+mediaArchival 搬運 | 生成量×檔案大小 | 存量持續墊高固定費 |
| Pinecone 讀寫 | 上傳素材量+RAG 檢索量 | 小~中 |
| Railway egress(proxy-download) | 團隊下載量 | 小~中,量大會浮現 |
| 固定底座 | 同 3.1 | 佔比被變動成本稀釋 |

### 3.4 生成尖峰(活動日/批次產片)

- 導演批次生成鏈(director.autoGenerateFromSegments:一個分鏡板=N 段×圖+影+音+語音)是**單一操作放大器**:60 段上限×4 模態,一次點擊可觸發上百筆 fal 任務(worldStoryboard segments≤60)。
- 影片模型(Veo3/Pro、Sora、Kling Pro)按秒計價,是尖峰日的成本主體;LoRA 訓練若同日疊加,Replicate GPU 時數同步放大。
- 防護現況:每人 40 次/天+20 tasks/hr throttle+點數扣款(50 點預設);**但點數不對應真錢(Stripe 未啟用),等於「內部限流」而非「成本回收」**。
- 尖峰月的帳單形狀:fal ≫ LLM > ElevenLabs/Suno > 其他;絕對值**待補**。

---

## 4. 待補清單(僅能從 Railway/供應商儀表板取得)

1. Railway:目前月費、RAM 峰值/常駐水位、vCPU 用量、egress GB、是否掛 Redis addon 及其規格。
2. MySQL:實際供應商(Cloud SQL/PlanetScale/Railway MySQL?)、規格月費、DB 大小(可先看每日備份 gzip 檔大小趨勢)。
3. Supabase:實際 plan(Free/Pro)、DB 大小、MAU、edge function 呼叫量、egress。
4. Pinecone:plan(serverless/pod)、向量總數、月讀寫單位量。
5. R2:bucket 總 GB、物件數、Class A/B 月操作數、目前月費——`r2_storage_snapshots`/`r2_object_catalog` 表已在收資料(r2SnapshotJob 每日寫入),**值需線上查**;`provider_snapshots` 表同理(ElevenLabs 訂閱餘額、Suno credit 每 15 分快照)。
6. 各 API 實際單價與月用量:fal.ai 帳單(分模型)、OpenRouter 用量頁(分模型 token)、Anthropic/Gemini 直連帳單、ElevenLabs 訂閱層級與字元用量、Suno proxy 儲值紀錄、Replicate 帳單、Brave/NewsAPI/NewsData 方案、Perplexity(若直連)。
7. LangSmith/PostHog/Sentry:目前 plan 與事件/trace 月量。
8. 內部對帳:`api_usage_logs`/`cost_ledger`(旗標 OFF,資料可能空)/`ai_usage_events` 的實際填充率——admin「API 用量」頁數字與真帳單的偏差率。
9. 團隊實際行為:40 次/天配額命中率、光球對話量、eval 執行頻率(CI 設定)。

---

## 5. 降本建議

### 5.1 架構推估可直接做(改 env/預設值,低風險)

| # | 建議 | 證據/入口 | 預期效果 |
|---|---|---|---|
| 1 | **把 user_ai_brain 推理 slot 預設值從 `anthropic/claude-opus-4.7` 降檔**(如 sonnet/haiku 級),Opus 留給使用者自選 | schema.ts user_ai_brain 4/5 slot 預設 Opus;消費端 ai.chat/director | LLM 大宗直接砍檔次價差(Opus vs Haiku 官方牌價差一個數量級);只影響未自訂者 |
| 2 | 設 `REDIS_URL`(若尚未)讓 modelResearcher enrichment 暖啟動生效 | modelResearcher.ts:18,77 | 每次部署省一輪 research LLM 費+縮短 boot storm |
| 3 | 用 env 調降/關閉研究型 cron:`DISABLE_MODEL_RESEARCH_CRON=1` 或 `MODEL_RESEARCH_CRON_SCHEDULE` 改每週;braveLearnFetcher/learnDocSyncer 產出**只進記憶體、重啟即丟**(01 §2.1),在落 DB 之前這兩支的外呼費近乎白燒,可先停 | modelCatalogResearchJob.ts:23,45;braveLearnFetcher.ts:437 | 砍掉「可揮發產出」的固定燒 |
| 4 | 精準度抽測降頻:ACCURACY_TEST_INTERVAL 目前 ~60 分 5 次 Gemini 真呼叫;改 6-24 小時一輪,或加 env gate | brainAutoRepair.ts:2468;apiHealthMonitor.ts:69-72 | 每日 ~120 次付費呼叫 → ~10-40 次 |
| 5 | 擴大 `LLM_CACHE` 覆蓋:旗標預設 ON 但全站僅 2 處 `cacheable:true`;可判定 deterministic 的呼叫(站內知識查詢、模型目錄問答、prompt-judge 同題重評)逐點加上 | llm.ts:1649-1652,1888;orbContextLookup.ts:153 | 重複問答零成本命中 |
| 6 | 設定 R2 lifecycle rule:db-backups/ 保留 N 天、為 digital_asset_library 啟用 expiresAt 保留政策讓 assetCleanupJob 真正回收 | dbSnapshotJob.ts:27-28;assetCleanupJob.ts:5-6 | 止住儲存存量單調遞增 |
| 7 | 開 `ENABLE_ORB_BUDGET_GUARD`/`ENABLE_ORB_QUOTA_GUARD`(預設 OFF)並設 `ALERT_SLACK_WEBHOOK`+校準 `AI_MONTHLY_BUDGET_USD` | 02 §9.3;apiUsageAlertJob.ts:255 | 從「被動告警」升級「主動閘」 |
| 8 | Perplexity 節流已集中在 perplexityThrottle(env 可調 per-user 時/日+全站每分鐘)——依實際用量收緊 | perplexityThrottle.ts:1-18 | 控 sonar 附加費 |
| 9 | eval 頻率治理:`npm run eval` 是真 LLM 花費,CI 上限定 nightly/PR-label 觸發而非每 push | eval/agentEvalRunner.ts | 控 CI token 燒 |
| 10 | 直連 key 收斂:OpenRouter 已能透傳 Anthropic/Gemini/Vertex;若直連帳戶只為冗餘,可留 key 但把預算集中單一儀表板管理 | llmRouter.ts:525-537 | 減少多帳戶最低儲值/對帳成本 |

### 5.2 需實測後決定(先拿 §4 數字)

| # | 決策 | 需要的數字 | 理由 |
|---|---|---|---|
| 1 | Railway 規格右調/左調、是否多 replica | RAM 峰值(記憶體 store+enrichment+ring buffer 常駐)、CPU 曲線 | 記憶體資料策略(§2.5)直接決定最低 RAM 水位;多 replica 前必須先接 Redis(鎖/quota 才跨機正確) |
| 2 | 雙 DB 收斂(把 Supabase 面併回 MySQL 或反向) | 兩邊帳單+Supabase 實際承載面(B 文件深挖結果) | 若 Supabase 只剩告警+限流 trigger,固定費/維運費可能大於價值;反之若要用 RLS/edge functions 則往 Supabase 靠 |
| 3 | mediaArchival 是否改「熱冷分層」(近期 R2、久遠轉 IA 級儲存或刪) | R2 GB 曲線+資產存取頻率(teaching_material_access_log 模式可借鏡) | R2 無 egress 費,冷層價差主要在儲存單價 |
| 4 | Pinecone serverless vs pod、是否縮維(3072→更小 embedding) | 向量數、查詢 QPS、召回品質基準 | 縮維省儲存+讀寫單位,但需 eval 驗證 RAG 品質 |
| 5 | Suno proxy 去留(換官方合作管道或第二 proxy 備援) | 每月歌曲量+proxy 穩定性紀錄(provider_snapshots) | 第三方 proxy 是計費+存續雙風險點(§1.1) |
| 6 | 影片模型預設檔次(Kling pro→std、Veo3→Veo3 fast 類) | 分模型用量與滿意度回饋 | 影片是 fal 帳單大頭,預設檔次是槓桿 |
| 7 | proxy-download 流量是否改走 R2 公開網域(S3_PUBLIC_URL) | Railway egress GB | R2 egress 免費 vs Railway egress 計費,量大時差距顯著;需权衡簽名/權限控制 |
| 8 | LangSmith/PostHog 取樣率 | trace/事件月量 vs 免費層上限 | 超層前先取樣 |

---

## 6. 缺讀聲明

- 未逐行讀:`falDispatcher.ts` 全文(僅讀派工/預設引擎段)、`brainAutoRepair.ts` 2500 行以外段落、`ai.ts` chat 主體(434-1900,僅取樣模型選擇點)、`perplexityDeepSearch.ts`、`langsmithTracer.ts` 批次行為細節、Supabase 23 個 migrations 內文(承接 00/02 結論)、`scripts/` 之下是否有額外外呼腳本。
- Railway 服務拓撲(是否另有 worker service、cron service 分離)無法從 repo 確認,以 railway.toml 單服務假設推估。
