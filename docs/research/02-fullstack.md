# 02 — 全端接線地圖(Phase 1-2)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`
- 讀法:本文件是「UI → tRPC/REST → 驗證 → 資料表 → 儲存」的接線總表;功能與現況判定見 `01-features.md`。缺讀範圍同 01 §8。

---

## 1. 共通底盤(全站生成/儲存統一鏈)

### 1.1 生成統一管線(所有工作室共用)

```
前端表單 state
  → tRPC mutation(generationProcedure/protectedProcedure + zod)
  → checkSafety(內容安全,_generateHelpers.ts:170)
  → 大腦選引擎:讀 user_ai_brain(resolveFalEnginesFromRow,falDispatcher.ts:1312)
      未設 → DEFAULT_FAL_ENGINES(falDispatcher.ts:1290-1307)
  → estimatePoints(modelPricing)→ 原子扣點(users.remainingGenerations)
  → createBackgroundJob(background_jobs,schema.ts:286)
  → 分支 A:fal.ai queue(dispatchFalQueueTask + signWebhookToken)
       完成:webhook /api/webhook/fal?jobId= 或 3s 輪詢 checkXxxStatus
  → 分支 B:Gemini/Vertex 同步(geminiMedia.ts)→ storeBase64Media → R2
  → doPostGenComplete(postGenActions.ts:265)統一落三表:
       prompt_library + digital_asset_library.fileUrl + generation_history.resultUrl
  → 失敗:原子退款 refundUserPoints(claim-then-refund;退款狀態 credits.jobRefundStatus)
```

**儲存事實**:DB 無 blob 欄位、**base64 不進 DB**。fal 路徑=外部 CDN URL 先進 DB,再由 `enqueueMediaArchivalTask`(postGenActions.ts:470-482)背景搬 R2、回填 sourceUrl/archivedAt/archivalChecksum。R2 key 慣例 `generated/studio/<userId>/<studio>/<modelId>`。storage 優先序 R2/S3(手簽 SigV4)→GCS→proxy→local fs(server/storage.ts:5-15,462-484)。

**四模態預設引擎**(falDispatcher.ts:1290-1307):image `fal-ai/flux-pro/v1.1`(參考圖→flux/dev/image-to-image;LoRA→強制 `fal-ai/lora`);video `fal-ai/kling-video/v2.1/pro/text-to-video`(i2v→pro/image-to-video);audio `fal-ai/stable-audio`;voice `fal-ai/elevenlabs/tts/turbo-v2.5`。Gemini 分支:imagen-3.0、veo-2.0/veo-3.0-preview、lyria-002/musicfx-001、gemini-2.5-flash/pro-preview-tts。

### 1.2 檔案上傳鏈(全站共用)
`client/src/lib/upload.ts`:`POST /api/upload/presign` → XHR PUT 直傳 R2 → `/api/upload/finalize`;失敗回退 base64 `POST /api/upload`(uploadRoute.ts:493-560,手動驗證+magic byte)→ 伺服端仍 storagePut 落 R2。R2 key `uploads/<uid>/…`。

### 1.3 tRPC 傳輸層與 CSRF
兩個 client:main.tsx React client + adapters/trpcClient.ts vanilla(命令式)。共同:superjson、splitLink(heavy 走 httpLink 不批次)、cookie 認證(credentials:include)、**CSRF=自訂標頭 `x-trpc-source:"web"`,缺標頭 mutation 全 403**(trpcClient.ts:41,48;main.tsx:209,217)。React Query:staleTime 30s、focus refetch off、mutation retry 0。

### 1.4 procedure 權限階梯
`publicProcedure` → `protectedProcedure`(登入)→ `generationProcedure`(登入+生成限流,trpc.ts:162-180)→ `brainProcedure`(注入 user_ai_brain context)→ `leaderOrAdminProcedure` / `adminProcedure`(trpc.ts:52-114)。

---

## 2. video shell 接線表

### 2.1 DirectorAI

| UI 欄位 | 前端 state | procedure | 驗證 | 表.欄位 | 儲存 |
|---|---|---|---|---|---|
| 聊天送出 | messages,personality | `director.chat` | director.ts:222-243 | (saveToNotes 時)project_notes_calendar | LLM=perplexity/sonar-pro(costarService.ts:166)+大腦 slot |
| 對話存檔(≤2MB) | saveDialog.sessionData | `director.saveSession` | :382-393 | project_notes_calendar(noteType=script,content=`gz:`+gzip+base64,:96-102,419-425) | MySQL TEXT |
| 批次生成選項 | batchGenerationOptions | `director.autoGenerateFromSegments` | :2024-2094 | 讀 user_ai_brain 引擎槽+users.remainingGenerations 預檢 | 任務清單回前端 |
| 逐任務執行 | generationTasks[i] | `director.executeGenerationTask` | :2751-2767 | 扣點(:2838);background_jobs.resultJson{prompt,modelId,request_id,statusUrl,chargedPoints,sourceStudio:"director"}(:2871-2897) | fal queue+webhook |
| 3s 輪詢 | pollQuery | `director.pollGenerationTask` | :3105-3109 | 完成→resultUrl+runPostGenForJob 三表;失敗原子退款(:3061) | R2 `generated/studio/<uid>/director/<modelId>` |
| 分鏡板/佇列 | importedSegments | `worldStoryboard.createFromSegments/queueForVideo` | worldStoryboard.ts:403-536(segments≤60) | world_storyboards.scenesJson/productionStatus | MySQL JSON |
| 偏好 | personality/preferredFormat | `director.preferences.update` | :484-494 | ai_director_preferences(schema.ts:770) | MySQL |

### 2.2 Studio(generate.submitMultimodalAsync 欄位對應)

| 表單欄位 | zod(generate.ts:1562-1604) | 落點 |
|---|---|---|
| prompt/generationType/mode/seed | string.min(1)/enum(image,video,audio,voice)/enum(lightning,deep_precision)/optional | background_jobs.resultJson.prompt、jobType |
| 圖:aspectRatio/negativePrompt/styleReferenceUrl/vibeReferenceUrl | string/nullable url | resultJson 參數快照(aspectRatioToImageSize 換算) |
| 影:videoDurationSeconds/firstFrameUrl/lastFrameUrl/characterRefUrl/cameraMotion{pan,zoom,tilt} | nullable;cameraMotion 物件(:1578-1584) | applyCameraMotionToPrompt 併入 prompt |
| 音:musicStyle/isInstrumental/audioDuration | string/boolean/number | resultJson |
| 語音:voiceModelId/voiceText/voiceSpeed/voiceStability/voiceEmotionType/voiceEmotionIntensity | string/number | resultJson |
| vaultCharacterId/vaultSceneId | number(consistency_vault 注入,:1645-1677) | 參考圖 URL 注入 prompt 管線 |
| fineTunedModelId/loraWeight(0-1)/overrideModelId/modelParams | number/min0max1/record | 強制 fal-ai/lora(:1778)+db.incrementModelUsage |

其他:報價=`brain.pricingSummary`(brain.ts:571,input{durationSec?,charCount?},回四模態 modelId/estimatedPoints/estimatedUsd+rateNote「1 USD≈100pts」);任務列表=`generate.activeJobs`(:2371,無 input,drizzle 查 userId+近 24h,limit 50);版本/配方=`studio.versions/recipes`(studio.ts:12-113)→studio_versions(payload json)/studio_recipes;導演建議=`director.askForStudioPlan`(:3429,brainProcedure,invokeLLM json_object→{actions,rationale})。

### 2.3 ImageStudio / VideoStudio / ProStudio
共同模式:每模型一支 mutation(generationProcedure+zod)→ `falQueueRun` 回 `{request_id,is_async_polling:true}` → 前端輪詢 `checkImageStatus/checkVideoStatus/checkAudioStatus`(防冒認 videoStudio.ts:1680)→ 伺服端完成時 localizeResultUrls→R2→doPostGenComplete 三表。模型 id 全表見 01-features §1.7-1.9(23+13+30 個 fal model id 含行號)。Suno 特例:`proStudio.generateMusicSuno`→background_jobs→第三方 proxy(modelClients.ts:394)→webhook `/api/webhook/suno`→R2 `generated/studio/<uid>/suno/<taskId>`→三表。

### 2.4 AnimationStudio / CreationHub
worldbuilding CRUD→`worldbuilding_frameworks`(JSON 欄存 characters/locations…);AI 生成=worldbuildingGeneration(invokeLLM 純文字);分鏡=`world_storyboards`+`timeline_frames`+`scene_compositions`。CreationHub:`creativeProject.list/create`→creative_projects(metadata{type:"video"});意圖=`commander.createIntent`(1-4000 字)→orchestration_runs(status=pending,plan/toolCalls null);active 專案 id=localStorage `healing-studio.current-project-id`。

---

## 3. learn shell 接線表(擇要)

| 頁 | procedure | 表 | 儲存備註 |
|---|---|---|---|
| LearnHub 文件 | `learnHub.list/categories/getById`(public);`create/update/delete/importDocs`(admin) | learn_modules(僅 admin 寫;DB 失敗僅 warn) | **主資料=伺服器記憶體陣列**(learnHub.ts:50);cron 產文不落 DB |
| LearnHub 影片/測驗 | `learnHub.videoList/quizList…` | **無表** | 記憶體,redeploy 丟失 |
| AIModelsHub | `aiModels.list/getById`+admin research 系列 | **無表** | 硬編碼 catalog+記憶體 Map+Redis 暖啟動 |
| ModelWishlist | `modelWishes.list/create/vote/unvote/updateStatus` | model_wishes+model_wish_votes(唯一索引 wishId,userId) | 投票=交易+SELECT…FOR UPDATE |
| MyBrain | `brainPipeline.getMyGraph`(展示);CRUD 走 `brain.get/catalog/pricingSummary/upsert/switchModel` | user_ai_brain(switchModel 同交易寫 user_model_switch_logs) | 消費端:generate/director/falDispatcher 直讀此表選模型 |
| TeachingArchive | `teachingArchive.list/create/delete/reingest/search`;`loraTrainer.trainWithReplicate` | teaching_materials(textContent MEDIUMTEXT)+teaching_material_access_log | RAG 鏈見 §6 |
| Teams | `teams.list/create/get/members/addMember/removeMember/leave/delete` | teams+team_memberships(無 FK,應用層防 phantom) | transferOwnership/updateMemberRole 前端未接 |
| Feedback | `feedback.myFeedbacks/create`(rate limit 10/h) | user_feedback_reports | 擴充欄位由 QuickFeedback 浮鈕送 |

---

## 4. settings/admin/認證 接線表(擇要)

| 區塊 | 接線 |
|---|---|
| Settings 偏好 | PersonalSettingsContext→`settings.get/update`→system_settings(無列時回程式預設) |
| AgentPreferences | `agentPreferences.getPreferences/updatePreferences/getDistilledProfile`+`orbScheduler.listJobs/scheduleJob/unscheduleJob`→agent_preferences、orb_scheduled_jobs |
| AdminPage | `admin.*`(systemStats/allUsers(Paginated)/updateQuota/updateRole/updateAutoCreditPolicy/runAutoCreditNow/userActivity/apiProviderBreakdown/apiKeysStatus/teamCostSummary/allGenerationHistory/allBackgroundJobs)+`feedback.all/updateStatus`+`brain.*`(組態/健康/研究/GitHub)+`skillRegistry.*`+`auditLog.events/export`(→global_audit_log,唯讀) |
| AdminApiUsage | `apiUsage.overview/usageByProvider/deepCost/snapshots/costAttribution/billing/providerReadiness`+`apiUsage.rateLimits.*`(→rate_limit_rules)+`apiUsage.alerts.*`(→alert_configs;cron 評估受 ENABLE_BUDGET_ALERTS) |
| BrainPipeline | `brainPipeline.getGraph(admin)/getMyGraph/getSummary/runPatrol`;providerHealth 真探測=providerHealthProbeJob(連續 2 敗寫 orb_system_alerts;**正式監控表是 Supabase system_alerts**,schema.ts:3413-3416 註解) |
| Dashboard | `dashboard.myStats/insights`(api_usage_logs 聚合)+`credits.pricingCatalog/myBalance`+`langsmith.*`(真連 LangSmith API) |
| 認證 REST | `/api/oauth/google/*`(JWT HS256 30d,cookie app_session_id)、`/api/auth/register|login`(scrypt)、`/api/auth/2fa/*`(TOTP RFC6238)、`/api/auth/forgot-password|reset-password|verify-reset-token`(sha256 token 1h 單次)、`/api/auth/refresh`(預設 403;ENABLE_REFRESH_TOKEN_ROTATION ON 時寫 refresh_tokens)、`PATCH /api/auth/profile`、`GET /api/auth/login-history` | 
| 帳號 tRPC | `profile.exportData/deleteAccount(z.literal "DELETE MY ACCOUNT")/updateQuotaJson`;`auth.me/updateAvatar` |
| Credits | users.remainingGenerations 原子增減(db.ts:688-910);orbCostGuard.deductCredits/reconcileCredits(falDispatcher.ts:484,622);自動給點 runDueAutoCreditGrant;Stripe webhook=真驗章+TODO handler;plans 無前端呼叫 |

---

## 5. 跨 shell 脊椎接線表(擇要)

| 頁/功能 | procedure | 表 | 儲存 |
|---|---|---|---|
| AssetsLibrary | `assets.myAssets/teamAssets(infinite)/upload/toggleVisibility/delete` | digital_asset_library(fileUrl/fileKey/visibility/sourceStudio/archivedAt) | R2 key+URL;刪除級聯 storageDelete;首次共享 +2 credits(assets.ts:261) |
| 團隊資產 RBAC | teamAssets 內 resource_shares 過濾(assets.ts:140-159,受 ENABLE_DATA_RBAC) | resource_shares | — |
| Vault 一致性錨點 | `vault.list/create/update/delete/exportToAssets` | consistency_vault(imageUrl/fileKey) | R2;exportToAssets 跨寫資產庫 |
| History | `history.list/bookmarked/toggleBookmark/rate/delete` | generation_history | 供應商 URL+mediaArchival 歸檔 R2 |
| 背景任務 | `generate.activeJobs/myJobs`(BackgroundTasksContext 5s 輪詢+SSE) | background_jobs | resultJson 內 fal URL |
| PromptLibrary/Collection | `promptLibrary.*`/`promptCollection.*`(listMine/listTeam/siteCatalog/collect…) | prompt_library/prompt_collection | MySQL |
| Models/LoRA | `models.myModels/teamModels/create/toggleVisibility/delete/syncReplicateStatus/captionImages/autofillAngles`+`loraTrainer.*` | fine_tuned_models+model_training_consents+fine_tuned_model_consents+background_jobs | 訓練圖 ZIP 上 R2(falTrainer.ts:5-18);LoRA 權重=外部 URL |
| SharedSpace 直送 | 無後端:sessionStorage payload+routeForModality(lib/send-to-studio.ts:1-25);`agentModelPicks.recordPick`→agent_model_picks | — | sessionStorage |
| Notes/Calendar | `notes.list/summary/create/update/delete/exportIcs`+`schedule.icsFeed/rotateIcsFeed/revokeIcsFeed`(REST /api/ics/<token>.ics) | project_notes_calendar;users.icsFeedToken | MySQL 純文字 |
| CreativeProject | `creativeProject.list/listPaginated/get/getContextSummary/create/update/delete/duplicate/link` | creative_projects | MySQL |
| Drive | `drive.status/listLibraries/addLibrary/listFolder` | drive_asset_libraries(僅 pin folderId) | 檔案留 Google Drive |
| ZIP 匯出 | 前端 JSZip+`GET /api/proxy-download`(auth+限流+白名單+100MB,_core/index.ts:792) | — | 瀏覽器 Blob 下載 |

---

## 6. RAG / 知識管線接線

### 6.1 TeachingArchive RAG 全鏈
①上傳(presign→R2)→②`teachingArchive.create`(fileUrl 強制 http(s);text 必填 textContent;team_shared 必填 teamId)→teaching_materials→③enqueueTeachingIngestion→background_jobs(jobType=teaching_archive_ingestion)→④worker cron 每 60s(批 5;stuck>15min 標 failed):PDF=unpdf 抽文、audio/video=**ElevenLabs Scribe** 轉錄,截 200k 字回填→⑤`upsertTeachingMaterialVectors`:切片 1200 字/200 overlap 句界優先→**gemini-embedding-001(3072 維)**→**Pinecone** index `ai-director-memories`、namespace `teaching-{userId}`(gate:RAG_MEMORY=有 PINECONE_API_KEY;失敗靜默)→⑥檢索 `searchTeachingArchive`:vector 優先→visibility 過濾→LIKE fallback→命中寫 search_hit 稽核→⑦刪除同步清 Pinecone(prefix list)。

### 6.2 news / learn 文件管線
newsFetcher(每 6h):NewsAPI→NewsData.io→Perplexity Sonar 備援→Gemini 柔化→news_articles(sourceUrl 去重)。learnDocSyncer(週一 03:00):近 7 天 news→Gemini 合成 ≤3 篇→**僅記憶體**。braveLearnFetcher(每日 04:00):10 固定主題 Brave Search(fallback Sonar)→LLM 整理→**僅記憶體**。啟動時 initLearnHubFromDb 把 learn_modules 併回記憶體。

---

## 7. 光球(Orb)前後端接線

| 環節 | 接線 | 持久化 |
|---|---|---|
| 掛載 | DashboardLayout:943-951(ProactiveOrbWidget,`user && !=/agent`)→OrbGuidePanel→OrbUnifiedAssistant | — |
| 對話 | GlobalOrbChatContext.sendMessage→`ai.chat`(brainProcedure,ai.ts:434);進度=`ai.chatProgress` 輪詢(in-memory ring buffer) | orb_conversations+orb_conversation_messages(orbConversations.*) |
| 任務 FSM | `ai.orbTask.{events,approve,cancel,retry,completeStep,failStep,updateStepStatus,reportPageState}`;前端 useGlobalOrbExecutor(pageAgent.dispatch+wouter 導航)+useOrbTaskObservations(1.5s 輪詢) | **in-memory Map(orbTaskStateMachine.ts:73),重啟即失** |
| 精靈 | `spirit.invoke/plan/run/control/replan`(spiritDispatcher→fal) | background_jobs |
| 多代理 | `agentCollaboration.startAutoDiscussion` | agent_collaboration_* |
| 記憶 | PageAgentContext 寫 `orbMemory.append`;長期記憶 orbLongTermMemory 服務 | orb_long_term_memories 等 orb_* 表 |
| 站內搜尋 | `orbProxy.unifiedSearch/persistClarificationPicks/clearAllPreferenceMemory` | — |
| 語音 | WS `/ws/orb-voice`(token 驗證、64KB frame、per-user 3 連線) | 無 |
| slash commands | 前端翻譯(slashCommandRunner),無專屬後端 | — |

---

## 8. SSE/WS 即時通道總表

| 通道 | 後端 | 前端訂閱者 | 現況 |
|---|---|---|---|
| /api/generation-events/:jobId | sseRoute.ts:82(generationBus) | BackgroundTasksContext:400-479 | 完整 |
| /api/model-training-events/:modelId | sseRoute.ts:202(webhookReplicate emitTraining) | LoraTrainer.tsx:382-421 | 完整 |
| /api/agent-events/:collaborationId、/api/agent-project-events/:projectId | agentEventsRoute.ts:24,96 | **無** | 前端死碼 |
| /api/agents/heartbeat | agentStatusRoute.ts:147(30s DB 快照) | AgentStatusBar→VideoCockpit | 完整 |
| /api/admin/events/stream | adminEvents.ts:12(legacy bus) | AdminPage:338 | 完整(UNIFIED_GEN_EVENT_BUS=true 時靜默失效) |
| /api/sse(統一多工) | unifiedSseRoute.ts:47 | 旗標 ON 才切換 | 預設雙端 OFF |
| WS /ws/orb-voice | orbVoiceGateway.ts:20 | useOrbVoice→OrbVoiceButton | 完整 |

守則:SSE handler 內做登入+擁有權(SSE_OWNERSHIP_LOCKDOWN 預設 ON)、15s heartbeat、per-user 並發 5;前端斷線不重連,降級 tRPC 輪詢+SSEFallbackBanner。**光球 chatProgress/orbTask 皆為輪詢,非 SSE**。

---

## 9. featureFlags 全表(現況判定的依據)

### 9.1 前端 build-time(client/src/config/featureFlags.ts;優先序:URL runtime 覆寫>VITE_* env>預設)
ENABLE_4SHELL(**ON**:58)、SHELL_SOCIAL(OFF:64)、SHELL_LEARN(ON:70)、ENABLE_AIDV_CHROME(ON:127)、ORB_SMILEY_ONLY(ON:146)、FEATURE_EXPORT_CHAIN(ON:155)、UNIFIED_SSE_ROUTER(OFF:165)、ENABLE_ORB_ONBOARDING(ON:173)、FEATURE_ONBOARDING_BRANCH(ON:180)、FEATURE_LEARN_BEGINNER_PATH(ON:188)、FEATURE_PROMPT_DIAGNOSTIC(ON:196)、FEATURE_BEGINNER_PATH_PERSONAS(ON:207)、ENABLE_QUICK_FEEDBACK(ON:214)。

附屬:videoFlags.ts——ENABLE_VIDEO_COCKPIT(ON)、VIDEO_SPINE_MOCK(OFF)、ENABLE_WORLD_STYLE_INJECTION(OFF)、ENABLE_PROJECT_HUB(OFF)、ENABLE_VIDEO_GATE_KIT(OFF)、ENABLE_VOICE_MUSIC_WORKFLOW(OFF)、ENABLE_SUBSYSTEM_REAL_DATA(OFF);projectFlags.ts——ENABLE_PROJECT_SSOT(ON,受 4SHELL);promptVaultFlags.ts——ENABLE_PROMPT_VAULT(OFF);teamsFlags.ts——TEAMS_COLLAB(OFF);learnFlags.ts——SHELL_LEARN_RICH(ON)。

### 9.2 後端 runtime(server/_core/featureFlags.ts;FEATURE_* env 覆寫,預設多依 API key 有無)
RAG_MEMORY(Pinecone key)、RESEARCH_MODE、ADVANCED_SEARCH、LLM_CACHE(非 test ON)、REQUEST_DEDUP、PERFORMANCE_METRICS(ON)、IMAGE_GENERATION(Fal/Replicate)、VIDEO_GENERATION(Fal)、AUDIO_GENERATION(Suno)、VOICE_CLONING(ElevenLabs)、MODEL_TRAINING、ORB_SCHEDULER(true)。

### 9.3 後端 orb/安全 env 旗標(env.validated.ts:555-585、ai.ts:943-1003)
ON:ENABLE_ORB_AGENT、ENABLE_SCHEMA_FIRST_PLANNER、GLOBAL_AGENT_WORKFLOWS、ORB_TASK_STATE_MACHINE/TASK_MEMORY/TASK_RECOVERY/TASK_EXECUTOR/LONG_TERM_MEMORY/CODE_COLLABORATION、ENABLE_CLAUDE_CODE_TASKS、ORB_PROVIDER_ROUTER/COST_GUARD/LLM_FALLBACK/RETRY_CHAIN_COST_GUARD、AGENT_DLQ/SCOPE_GUARD、PERPLEXITY×5、GENERATION_LOCK、BUDGET_ALERTS、SIGNED_URL_UPLOAD、PROMPT_ASSET_LINKS、COST_ATTRIBUTION。
**OFF**:ENABLE_ORB_QUOTA_GUARD、ENABLE_ORB_IDEMPOTENCY_GUARD、ENABLE_ORB_BUDGET_GUARD、ENABLE_COST_LEDGER、ENABLE_DATA_RBAC、ENABLE_CODEX_TASKS、ENABLE_REFRESH_TOKEN_ROTATION、ENABLE_DIRECTOR_WORLD_CONTEXT。

---

## 10. 導航/全域元件接線

- **雙 chrome**:ENABLE_AIDV_CHROME ON=AidvShellChrome(Rail/TopBar/⌘K,SHELL_META 四殼);OFF=AppleDock(僅白名單 4 頁 create/assets/director/teaching-archive;SIDEBAR_GROUPS=[] 群組已清空)。appRegistry 8 group ≈40 頁(orb3/create9/train1/project9/assets7/learn9/settings9/admin0)。
- **DashboardLayout 副作用**:agentPreferences.getPreferences(:510)、credits.myBalance+點數警示(:564-599)、首登 welcome tour(:721-730)、光球↔抽屜 window 事件橋(pin-to-notes/open-notes-drawer/add-to-calendar,:761-787)。
- **純前端(localStorage)子系統**:SiteOnboarding(site-tour-*)、FocusFlow(focus-flow-*)、Theme(hs-appearance-mode)、IntentCard、WorldContext active id(healing-studio.current-project-id)、Personality(XState,不持久)、Ambient(程序化合成)。
- **spine**:SpineProvider 包全 App;projectGateway 聚合 creativeProject+worldbuilding+worldStoryboard(vanilla client);gate.ts 純函式確認門;VIDEO_SPINE_MOCK 預設 OFF=真資料。

---

## 11. cron 排程 → 資料表對應(啟動註冊於 server/_core/index.ts)

| Job | 頻率 | 讀/寫 |
|---|---|---|
| newsFetcher | 6h | 寫 news_articles |
| modelTrainingWorker | cron | 輪詢 Replicate→fine_tuned_models/background_jobs |
| teachingArchiveIngestionWorker | 60s | teaching_materials 抽文/轉錄+Pinecone upsert |
| learnDocSyncer | 週一 03:00 | news→LLM→記憶體 docs |
| braveLearnFetcher | 每日 04:00 | Brave/Sonar→LLM→記憶體 docs |
| apiHealthMonitor / providerHealthProbeJob / providerSnapshotJob | 週期 | provider_snapshots;連續 2 敗寫 orb_system_alerts(正式=Supabase system_alerts) |
| apiUsageAlertJob | 15min | 讀 api_usage_logs+alert_configs→Slack(受 ENABLE_BUDGET_ALERTS) |
| costAttributionOutboxJob / costLedgerReconcileJob | 週期 | cost_attribution_outbox→cost_ledger(受 ENABLE_COST_LEDGER,預設 OFF) |
| userAutoCreditJob | 週期 | users.autoCredit*→remainingGenerations |
| dbSnapshotJob | 每日 02:00 | mysqldump→gzip→R2 db-backups/(ENABLE_DB_BACKUP 預設 ON) |
| r2SnapshotJob | 週期 | r2_storage_snapshots/r2_object_catalog |
| assetCleanupJob / mediaArchivalCron / staleJobChecker / agentDlqPoller / 各 purge job | 週期 | digital_asset_library 歸檔、background_jobs 逾時、agent_dlq、log 清理 |
| modelCatalogResearchJob | env 排程 | aiModels 記憶體 enrichment |

---

## 12. Supabase 側(與 MySQL 並行的第二資料面)

- `supabase/migrations/`(23 個)+edge functions `agent-heartbeat`、`tts-liveness-probe`。
- 已證實接點:`system_alerts`(正式監控告警,providerHealthProbeJob 用 Supabase client SDK 寫)、`agent_tasks`+`creator_job_throttle`(DB trigger 限流 20 tasks/hr)+`video_projects.creator_id`、rate-limit-bypass-probe cron(AGENTS.md)。
- 前台九工作室生成鏈**未見任何 Supabase 呼叫**(全 MySQL+R2);Supabase 究竟服務哪些執行面(agent heartbeat/監控/實驗)由子代理 B 深挖。
