# 00 — 專案總覽地圖(Phase 0)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`(`origin/main` 合併列車 Wave-1 之後)
- 依據來源:實際讀取 `AGENTS.md`、`README.md`、`.mcp.json`、`package.json`、`railway.toml`、`.nixpacks.toml`、`.env.example`、`client/src/App.tsx`、`client/src/shells/shellRouteTable.ts`、`server/routers.ts`、`server/_core/index.ts`、`drizzle/schema.ts` 等檔案
- 本文件是後續 01/02/A–F 各份研究文件的**目錄與詞彙依據**

---

## 1. 真實技術棧

| 層 | 技術 | 證據 |
|---|---|---|
| 前端框架 | React 19 + TypeScript,Vite 7 建置 | `package.json` |
| 前端路由 | **wouter**(非 react-router),有 patch(`patches/wouter@3.7.1.patch`) | `client/src/App.tsx` |
| UI | Tailwind CSS 4 + Radix UI 全家桶 + shadcn 式 `components/ui` + framer-motion + lucide-react | `package.json`、`components.json` |
| 3D/視覺 | three.js + @react-three/fiber/drei(光球動畫)、@xyflow/react + dagre(流程圖)、recharts(圖表)、d3 | `package.json` |
| 狀態管理 | TanStack React Query(伺服器狀態)+ React Context(大量 Provider)+ xstate(狀態機)+ `client/src/stores` | `App.tsx`、`package.json` |
| API 層 | **tRPC v11**(superjson transformer)掛在 Express 4 上;另有多條純 REST/SSE 路由 | `server/_core/index.ts`、`server/routers.ts` |
| 後端執行 | Node 20+,`tsx` 開發、esbuild 打包成 `dist/index.js` | `package.json` scripts |
| ORM / DB | **雙資料庫並存**:Drizzle ORM(`mysqlTable`,MySQL,102 張表)+ **Supabase Postgres(prod 實際線上庫,RLS 已開,23 個 migrations)** | `drizzle/schema.ts`、`supabase/migrations/`、`AGENTS.md` |
| 快取/鎖 | Redis(ioredis;選填──生成防重複鎖、rate-limit store、quota store;未設則退回記憶體版) | `server/_core/redis*` |
| 物件儲存 | S3 相容(Cloudflare R2 為主)、Google Cloud Storage、Google Drive 整合 | `.env.example`、`server/storage.ts`、`server/services/googleDrive.ts` |
| 向量庫 | Pinecone(RAG 記憶系統) | `.env.example` §向量資料庫 |
| LLM 供應商 | **OpenRouter 為統一閘道(優先)**,直連可選:Anthropic Claude、Google AI Studio(Gemini)、Vertex AI、NVIDIA NIM、Manus Forge(向後相容)。auto 優先序 `openrouter > anthropic > gemini > nvidia > vertex > forge` | `.env.example`、`server/_core/llmRouter.ts` |
| 生成媒體供應商 | **fal.ai**(圖/影主力+LoRA 訓練)、Replicate、ElevenLabs(語音)、Suno(音樂,webhook)、Gemini/Vertex(Imagen、Veo、Lyria、TTS) | `package.json`、`server/routes/webhook*.ts`、`server/services/fal*.ts` |
| 可觀測性 | LangSmith(LLM tracing)、PostHog(前後端分析)、Slack webhook 告警 | `.env.example`、`server/services/langsmithTracer.ts` |
| 收款 | Stripe webhook(骨架,`server/routes/stripeWebhook.ts`) | 同左 |
| 測試 | Vitest(單元)、Playwright(e2e)、`npm run eval`(agent planner regression,`server/eval/runEval.ts`)、多支 `scripts/check-*`/`audit-*`/`simulate-*` 自動掃描 | `package.json` scripts |
| 部署 | Railway,**builder=DOCKERFILE**(railway.toml 明示不用 Nixpacks;`.nixpacks.toml` 僅為 fallback),healthcheck `/api/health`(timeout 600s),migration fail-closed | `railway.toml`、`Dockerfile`、`AGENTS.md` |
| MCP(repo 內) | 只有 `gitnexus`(程式碼知識圖譜查詢)。Atlassian/GitHub MCP 是**開發環境層級**接的,不在 repo `.mcp.json` | `.mcp.json` |

## 2. 整體系統架構與資料流

```
瀏覽器(React 19 + wouter + React Query)
  │  tRPC(superjson, /api/trpc) + REST(/api/*) + SSE(進度/事件)+ WebSocket(server/ws)
  ▼
Express(server/_core/index.ts)
  ├─ 安全層:helmet、CSRF origin guard、rate limiter、input/XSS guard、SSRF guard、JWT 認證(jose)
  ├─ tRPC appRouter(server/routers.ts,60+ 命名空間)
  ├─ REST 路由:upload、download、webhookFal/Suno/Replicate/Stripe、videoRoute、icsFeed、
  │            localAuth/googleAuth/passwordReset、orbTasks、aiProxy、v1(對外 API)
  ├─ 服務層 server/services/(180+ 檔):orb* 光球代理、spirit* 精靈、director/、
  │            fal*/replicate/elevenLabs/gemini 生成、memory/、cost/、security/、authz/
  ├─ 排程 server/jobs/(30+ cron):newsFetcher、modelTrainingWorker、dbSnapshot、
  │            r2Snapshot、apiUsageAlert、costLedgerReconcile、providerHealthProbe…
  ▼                                    ▼
資料層(雙軌)                      外部服務
  ├─ MySQL(Drizzle,102 表)        ├─ LLM:OpenRouter / Anthropic / Gemini / Vertex / NVIDIA
  ├─ Supabase Postgres(prod、RLS、  ├─ 媒體:fal.ai、Replicate、ElevenLabs、Suno
  │   edge functions、triggers)      ├─ 儲存:Cloudflare R2(S3)、GCS、Google Drive
  ├─ Redis(選填:鎖/quota/限流)     ├─ RAG:Pinecone
  └─ R2 物件儲存(媒體、DB 備份)     └─ 其他:Brave Search、NewsAPI/NewsData、LangSmith、
                                          PostHog、Slack、GitHub Issues、Stripe
```

關鍵事實(常被舊文件誤述,以此為準):

1. **雙 DB 是本專案最大的架構特徵**:`drizzle/schema.ts`(MySQL、`orb_*` 等 102 表)與 Supabase Postgres(prod 線上庫)並存。同名概念表名可能不同(例:MySQL `orb_system_alerts` vs Supabase `system_alerts`)。新監控/告警代碼寫 Supabase;詳見 `AGENTS.md`。
2. **部署走 Dockerfile,不是 Nixpacks**(railway.toml `builder="DOCKERFILE"`)。
3. **LLM 一律經 `server/_core/llmRouter.ts` 路由**,OpenRouter 是推薦單一入口;裸 `claude-*`/`vertex/*` 模型 ID 會自動改寫為 OpenRouter 等效路徑。
4. 應用層有兩套獨立速率限制:MySQL 側 `server/services/orbQuota.ts`(記憶體內,生成 40 次/天)與 Supabase 側 `creator_job_throttle`(DB trigger,20 tasks/hr)。

## 3. 路由/頁面清單

路由定義於 `client/src/App.tsx`(頂層)+ `client/src/shells/shellRouteTable.ts`(4-shell 收編表,由 `ENABLE_4SHELL` 旗標控制,舊路徑自動轉向)。頁面元件在 `client/src/pages/`,全部 lazy 載入(首頁除外)。

### 3.1 4-shell canonical 路由(旗標 ON 時)

| Shell | 路由 | 頁面元件 | 說明 |
|---|---|---|---|
| **video**(創作) | `/video/director` (index) | `DirectorAI` | 導演 AI 對話式創作 |
| | `/video/create` | `CreationHub` | 創作中樞 |
| | `/video/studio` | `Studio` | 工作室 |
| | `/video/playground` | `Playground` | 試驗場 |
| | `/video/animation(/:storyboardId)` | `AnimationStudio` | 動畫/世界觀分鏡 |
| | `/video/image` | `ImageStudio` | 圖片工作室 |
| | `/video/video` | `VideoStudio` | 影片工作室 |
| | `/video/pro` | `ProStudio` | 專業工作室 |
| | `/video/light-orb` | `LightOrbCreationStudio` | 光球創作工作室 |
| **learn**(學習) | `/learn` (index) | `LearnHub` | 學習中樞 |
| | `/learn/ai-models` | `AIModelsHub` | AI 模型百科 |
| | `/learn/model-wishlist` | `ModelWishlistPage` | 模型許願 |
| | `/learn/my-brain` | `MyBrainPage` | 個人大腦 |
| | `/learn/codex` | `AgentCodexPage` | 代理 Codex |
| | `/learn/teaching-archive` | `TeachingArchive` | 資料庫(教學素材池) |
| | `/learn/teams` | `TeamsPage` | 團隊 |
| | `/learn/feedback` | `FeedbackPage` | 回饋 |
| **settings** | `/settings` (index) | `SettingsPage` | 設定 |
| | `/settings/agent` | `AgentPreferencesPage` | 代理偏好 |
| | `/settings/admin` | `AdminPage` | 管理後台 |
| | `/settings/admin/api-usage` | `AdminApiUsagePage` | API 用量/成本 |
| | `/settings/admin/brain-pipeline` | `AiBrainPipelinePage` | AI 大腦管線 |
| **social**(旗標 `SHELL_SOCIAL`,預設 OFF) | `/social` (index) | `SocialCockpit` | 社群駕駛艙 |
| | `/social/studio` | `SocialStudio` | 社群工作室 |
| | `/social/brand` | `SocialBrand` | 品牌 |
| | `/social/publish` | `SocialPublish` | 發佈 |

### 3.2 跨 shell 頂層路由(不收編,`CROSS_SHELL_TOPLEVEL`)

| 路由 | 頁面 | 備註 |
|---|---|---|
| `/` | `Home` | 公開 landing(唯一非 lazy 頁) |
| `/assets` | `AssetsLibrary` | 數位資產庫(`?section=vault/history/tasks/prompts/collection` 聚合多個舊頁) |
| `/models` | `ModelsPage` | 微調模型(LoRA;`/lora-trainer` 已轉向此) |
| `/shared` | `SharedSpace` | 團隊共享空間(共享模型、直送工作室) |
| `/notes` | `NotesPage` | 筆記(`/calendar` 已轉向此) |
| `/dashboard` | `DashboardPage` | 個人儀表板(`?section=langsmith/credits`) |
| `/creative-projects` | `CreativeProjectPage` | 創作專案(舊 world-builder 主控台) |
| `/projects`、`/projects/:id` | `ProjectsListPage` / `ProjectDetailPage` | 新版專案骨架(與 creative-projects 併行過渡) |
| `/agent` | `AgentChat` | 全域代理(光球)對話全頁 |
| `/focus-flow` | `FocusFlowPage` | 專注流 |
| `/unorganized` | `UnorganizedArea` | 未整理區 |
| `/tutorial-overview` | `TutorialOverviewPage` | 教學總覽 |
| `/process` | `ProcessViewerPage` | standalone 流程檢視 |
| `/account-settings`、`/forgot-password`、`/reset-password` | 對應頁 | standalone 認證/帳號頁 |
| `/404`、fallback | `NotFound` | |

### 3.3 舊路徑轉向(擇要)

`/director→/video/director` 等 4-shell 收編轉向共 21 條(`LEGACY_REDIRECTS`);另有 App 層轉向:`/worldbuilding→/animation`、`/vault|/history|/background-tasks|/prompt-library|/prompt-collection→/assets?section=…`、`/calendar→/notes`、`/langsmith|/credits→/dashboard?section=…`、`/lora-trainer→/models`、`/settings/ai-brain→/admin`。

## 4. 全域元件與 Provider 樹

`App.tsx` Provider 順序(外→內):`ErrorBoundary → MotionConfig → SpineProvider(4-shell 脊椎) → ThemeProvider → PersonalSettings → Personality → NotesDrawer → AssetsDrawer → ShowcaseTransfer → SiteOnboarding → FocusFlow → Ambient(環境音) → OrbGuide → PageAgent → OrbState → WorldContext → Projects → GlobalOrbChat → IntentCard → Tooltip`。

全域掛載元件:`SkipToContent`、`Toaster`(sonner)、`OAuthErrorToast`、`OfflineBanner`、`AuthExpiredModal`、`LoginOrbAnimation`、`ProjectNotesDrawer`、`AssetsQuickDrawer`、`SiteOnboardingOverlay`、`CommandPalette`。

版面:`DashboardLayout`(所有 dashboard 頁的殼,含側欄)+ `PageSidebar`;4-shell 下另有 `ShellFrame`/`AidvShellChrome`/`AidvOrbMount`(`client/src/shells/`)。光球(全域 AI 代理)前端:`OrbFloatButton`、`OrbUnifiedAssistant`、`ProactiveOrbWidget`、`OrbGuidePanel`、`OrbTaskObservationStrip`、`components/orb/`、`components/orb-agent/`、`client/src/agent/useGlobalOrbExecutor.ts`。

## 5. 後端結構

### 5.1 tRPC appRouter 命名空間(`server/routers.ts`,60+ 個)

依領域分組(完整清單見 02-fullstack.md,Phase 1 產出):

- **生成/工作室**:`generate`、`imageStudio`、`videoStudio`、`proStudio`、`studio`、`spirit`(15 精靈直呼 fal.ai)、`loraTrainer`、`models`、`export`(ZIP)
- **導演/世界觀/專案**:`director`、`directorPreferences`、`worldbuilding`、`worldbuildingGeneration`、`worldStoryboard`、`creativeProject`、`videoProject`、`videoAnalytics`
- **光球代理(Orb)**:`ai`、`orbGuide`、`orbMemory`、`orbTraces`、`orbCapabilities`、`orbProxy`、`orbConversations`、`orbScheduler`、`agentPreferences`、`agentModelPicks`、`agentCollaboration`、`agentCapability`、`agentWorkflow`、`orchestrationRuns`
- **Commander/資料接入(M 系列)**:`commander`、`contextPacket`、`teamData`、`dataConnections`、`teamTraining`
- **知識/學習**:`learnHub`、`teachingArchive`、`realEarth`、`aiModels`、`modelWishes`、`modelConsents`、`brain`、`brainPipeline`、`news`、`sense`
- **資產/工具**:`assets`、`vault`、`history`、`promptLibrary`、`promptCollection`、`customBlocks`、`blockCombos`、`workflow`、`notes`、`schedule`、`drive`、`showcase`
- **帳務/後台**:`credits`、`accountant`(財財)、`musicSpecialist`(音音)、`plans`、`apiUsage`、`apiKey`、`auditLog`、`admin`、`adminEval`、`settings`、`profile`、`dashboard`、`langsmith`、`externalServices`、`webhook`、`feedback`、`evaluate`、`skillRegistry`、`rbac`、`teams`、`auth`、`system`

### 5.2 REST/SSE/WS 路由(`server/routes/` + `_core/index.ts` 掛載)

upload、download(媒體)、`webhookFal`/`webhookSuno`/`webhookReplicate`/`stripeWebhook`(供應商回呼)、`webhooks`(orb 觸發)、`videoRoute`/`videoOutputRoute`、`icsFeed`、`localAuth`/`googleAuth`/`passwordResetRoutes`、`orbTasks`、`aiProxy`、`v1`(對外 API)、`adminEvents`、`agentStatusRoute`、`handoffTraceRoute`、`toolsModels`;SSE:`sseRoute`、`agentEventsRoute`、`unifiedSseRoute`;WS:`server/ws/`。

### 5.3 排程任務(`server/jobs/`,node-cron)

newsFetcher、modelTrainingWorker(LoRA 訓練輪詢)、teachingArchiveIngestionWorker(RAG 進料)、learnDocSyncer、braveLearnFetcher、apiHealthMonitor、providerHealthProbeJob、providerSnapshotJob、apiUsageAlertJob(15 分,Slack)、costLedgerReconcileJob、costAttributionOutboxJob、userAutoCreditJob、dbSnapshotJob(每日 02:00 mysqldump→R2)、r2SnapshotJob、assetCleanupJob、mediaArchivalCron、staleJobChecker、agentDlqPoller、auditLogPurgeJob、backgroundJobPurgeJob、loginHistoryPurgeJob、credentialExpiryAlertJob、goTrueHealthMonitor、modelCatalogResearchJob、circuitBreaker。

### 5.4 資料層

- **MySQL(Drizzle,`drizzle/schema.ts`,4758 行,102 張表)**,大類:users/auth(users、refresh_tokens、login_history、email_verification_tokens、password_reset_tokens、user_google_oauth_tokens)、生成(generation_history、background_jobs、video_projects、video_analytics)、光球(orb_* 20 張:conversations、messages、long_term_memories、workflow_*、scheduled_jobs、cost_attribution、system_alerts…)、代理協作(agent_collaboration_*、agent_dlq、agent_dynamic_registry、specialized_agent_*)、世界觀(worldbuilding_frameworks、world_storyboards、timeline_frames、scene_compositions、creative_projects、project_snapshots)、資產(digital_asset_library、consistency_vault、prompt_*、studio_recipes/versions、drive_asset_libraries、r2_object_catalog)、知識(teaching_materials、teaching_material_access_log、learn_modules、news_articles、real_earth_entries、user_ai_brain)、模型(fine_tuned_models、model_training_consents、fine_tuned_model_consents、model_wishes、model_wish_votes、user_model_switch_logs)、團隊/權限(teams、team_memberships、resource_shares、project_data_access_rules、data_source_connections、context_packets)、帳務(cost_ledger、cost_aggregations、cost_attribution_outbox、ai_usage_events、api_usage_logs、api_keys、subscription_plans、user_subscriptions、external_service_subscriptions)、平台(system_settings、global_audit_log、rate_limit_rules、alert_configs、webhook_*、skill_registry、featured_showcase*、orchestration_runs、user_feedback_reports、user_workflows、custom_blocks*、block_combos)
- **Supabase Postgres**(`supabase/migrations/` 23 個 + `supabase/functions/` 2 個 edge functions:`agent-heartbeat`、`tts-liveness-probe`):prod 線上庫,RLS 已開,`agent_tasks`/`creator_job_throttle`/`system_alerts` 等表、DB trigger 限流
- **R2/S3**:媒體上傳、DB 備份、用量快照;**Pinecone**:RAG 向量

## 6. 資料夾導覽

```
client/src/
  pages/        50+ 頁面元件(social/、admin/、settings/ 子目錄)
  shells/       4-shell 殼層(VideoShell、LearnShell、SettingsShell、SocialShell、shellRouteTable)
  components/   全域+領域元件(ui/=shadcn、orb/、orb-agent/、director/、create/、workspaces/、
                design-kit/(tokens)、learn-hub/、teams/、social/、promptVault/、brain-pipeline/…)
  contexts/     17+ 個 React Context(App.tsx Provider 樹)
  adapters/     tRPC client 與各領域 adapter(trpcClient、dataStore、commander、promptVault…)
  agent/        前端光球執行器(useGlobalOrbExecutor)
  spine/        4-shell 脊椎(跨 shell 狀態)
  app/          ShellRoutes、lazyPages、navigation
  config/       appRegistry(頁面註冊表)、featureFlags、sidebarIcons
  hooks/ lib/ stores/ data/ types/
server/
  _core/        Express 入口、tRPC、認證(googleAuth/oauth)、llmRouter、安全 guard、
                rateLimiter、redis、featureFlags、logger、metrics
  routers/      60+ tRPC router
  routes/       REST/webhook 路由
  services/     180+ 服務(orb* 光球、spirit* 精靈、director/、fal*、memory/、cost/、
                security/(contentModeration、ragInjectionGuard)、authz/、auth/、audit/)
  jobs/         30+ cron
  subsystems/   commander、contextPackets、projectContext、trainingTrack
  repositories/資料存取層(mysql/、base/)
  eval/         agent planner regression(npm run eval)
  ws/           WebSocket
shared/         前後端共用:unifiedModelRegistry、各 modality 模型註冊表、agent-plan-schema、
                worldbuilding-*(型別/流程)、slash-commands、skills/
drizzle/        MySQL schema + migrations(journal idx 至 91)
supabase/       Postgres migrations + edge functions
db/             (另一組 migrations,Phase 1 查證用途)
scripts/        check-*/scan-*/audit-*/simulate-* 自動化掃描
tests/          Playwright e2e
docs/           大量既有文件(僅供交叉比對,部分已過時)
.claude/skills/ aidv-* 開發工作流技能(autodev、longloop、board、optimize、plan、qa-explore、workflow)
```

## 7. 本專案正確詞彙表(取代背景推測用語)

| 正確詞彙 | 意義 | 背景線索修正 |
|---|---|---|
| **光球(Orb)/ 全域代理** | 全站 AI 代理人系統:前端 OrbFloatButton/OrbUnifiedAssistant + 後端 60+ `orb*` 服務(任務狀態機、規劃、記憶、排程、工具執行、成本守門) | 這是本專案的核心 AI 代理,背景未提及此詞 |
| **15 精靈(Spirits)** | 15 個專職生成代理(圖圖只打圖、影影只打影…),經 `spiritDispatcher.ts` 直呼 fal.ai;另有「財財」(accountant)、「音音」(musicSpecialist)等具名角色 router | 背景未提及;docs 有 15/25-spirits 文件 |
| **導演 AI(Director AI)** | `server/services/director/` + `directorRouter`;CO-STAR 框架實作於 `director/costarService.ts` ✓(背景線索正確) | ✓ 存在 |
| **4-shell** | 由 `ENABLE_4SHELL` 旗標控制的資訊架構重構:video/learn/settings/social 四殼收編舊路由,`shellRouteTable.ts` 為單一真相源 | 背景未提及 |
| **世界觀(Worldbuilding)** | 導演 AI 自訂世界觀架構器(多角色/場景 + LoRA 連結);**World Storyboard** = 秒級動畫分鏡時間軸(t2i→refine→i2v→music→voice→final compose 管線) | 背景未提及 |
| **創作專案(Creative Project)** | 綁定 Director session + Worldbuilding framework + World Storyboard 的創作單位,供全站光球與各 Studio 共享上下文 | 背景未提及 |
| **Commander / Context Packets / Team Data(M 系列)** | 任務總指揮入口(記錄創作意圖→orchestration run)+ 團隊內部資料接入創作上下文(TTL 上下文包)+ 資料來源存取規則 | 背景未提及 |
| **資料庫(Teaching Archive)** | UI 名「資料庫」= training-data 素材池(文字/PDF/圖/影/語音上傳、分類、RAG 切片) | 非一般意義的 DB |
| **RBAC** | `users.role` 三級:`user / leader / admin`;另有資料層 RBAC(`resource_shares`、`ENABLE_DATA_RBAC` 旗標、AIDV-121) | ✓ 存在,兩層 |
| **Safety moderation** | `server/services/security/contentModeration.ts` + `ragInjectionGuard.ts` | ✓ 存在 |
| **ZIP 匯出** | `exportRouter` + jszip | ✓ 存在 |
| **雙引擎 RAG** | 「雙引擎」一詞出現於 `siteKnowledge.ts` 等;實際 RAG 相關:`ragMemory.ts`、`teachingArchiveRag.ts`、`orbLongTermMemory/orbMemory`、Pinecone。確切「雙引擎」定義待 Phase 2-E 深挖 | ⚠ 需查證細節 |
| **Veo 3.1 / Suno V5** | Veo 經 Gemini/Vertex 管道(`.env.example` 列 Veo 2/3);Suno 有 webhook(`webhookSuno.ts`)。「3.1/V5」版本號待 Phase 1 對實際 model id 查證 | ⚠ 版本號待查 |
| **Gamification** | 僅在 `orbFeatureDiscovery.ts` 出現相關概念;**沒有**成形的 gamification 子系統。另有 credits/積分(creditsRouter) | ✗ 背景線索誇大 |
| **Nixpacks 部署** | 錯誤:實際 builder=DOCKERFILE,Nixpacks 僅 fallback | ✗ 修正 |
| **AIDV** | Jira 專案 key,單一真實任務佇列;`.claude/skills/aidv-*` 為開發工作流;`MIGRATION_FAIL_CLOSED=true` 已開 | ✓ |
| **director.today** | 線上站域名(QA bot 實測對象,見 AGENTS.md) | 背景未提及 |

## 8. 既有舊分析文件(僅供交叉比對)

`docs/` 內已有大量歷史稽核/架構文件(如 `ARCHITECTURE.md`、`fullstack-*-2026-04-29`、`15/25-spirits-*`、`global-orb-*` 系列、`director-ai-architecture.md`、`audits/`、`reports/`)。**日期多在 2026-04~05,早於現況**;後續各份研究引用時一律標注「與現況不符」處,不照抄。

## 9. Phase 0 待補清單(無法從 repo 得知)

- Railway 實際用量:RAM 峰值、DB 大小、egress、目前月費(→ 子代理 A 彙整)
- 各外部 API 目前實際單價與帳單(fal.ai、OpenRouter、ElevenLabs、Suno、Pinecone…)
- 團隊 15–20 人實際使用回饋(→ 子代理 C/D)
- Supabase 專案實際 plan 與用量
