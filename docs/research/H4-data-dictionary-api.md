# H4 — 資料表字典 × 對外 API × 端點總表(補充 wave H)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`
- 定位:給 NotebookLM 的 data dictionary(求全不求深)。依據 `drizzle/schema.ts`(4758 行,102 張 mysqlTable,全檔實讀)、`supabase/migrations/`(23 支實掃)、`server/routes/*` + `server/_core/index.ts` 掛載點實讀。DB 治理結論(0 FK、290 索引、migration 守門、雙 DB 風險)引 `B-infra.md` §2,不重做;SSE/WS 引 `02-fullstack.md` §8。
- 量級圖例:🔥 高流量(每次生成/事件即寫)/ ✏️ 低流量(使用者 CRUD)/ 📌 近似靜態(設定/目錄,行數個位~百位)

---

## 1. MySQL 102 表逐表字典(Drizzle,`drizzle/schema.ts`)

> 通則:全庫 **無 `.references()` FK 宣告**(B §2.1;例外:`prompt_assets` 與 teaching-archive 的 DB 層 FK 由 migration 0075/0055 以 ALTER TABLE 補,schema 檔仍不宣告)。「寫入者/讀取者」為 `server/` 內實際 import 該 drizzle export 的檔案(grep 實測);多數 CRUD 經 `server/db.ts` 資料層轉手,表中標 `db.ts(<router>)` 表示由該 router 經 db helper 讀寫。

### 1.1 Users / 認證(6 表)

| 表名 | 用途 | 關鍵欄位 | 索引 | 寫入者 | 讀取者 | 量級 |
|---|---|---|---|---|---|---|
| users | 全站帳號主表+credits 熱欄位 | id int PK、openId varchar64 UQ、email、passwordHash、twoFactorSecret/Enabled、role enum(user/leader/admin)、quotaJson、remainingGenerations int(default 50,原子扣點)、autoCredit* 5 欄、icsFeedToken UQ、orbMemorySummary text、deletedAt(軟刪) | email/role/autoCreditNextAt idx、icsFeedToken UQ | localAuth、googleAuth(oauth)、db.ts 扣/退點、userAutoCreditJob、admin.updateQuota/Role | 幾乎全站:trpc context、brainContext、falDispatcher 扣點、icsFeed、accountantTools… | ✏️(列少但 remainingGenerations 高頻 UPDATE) |
| refresh_tokens | session JWT 撤銷/輪替(AIDV-230;旗標預設 OFF) | tokenHash varchar64 UQ(sha256)、userId、status enum(active/revoked)、expiresAt | tokenHash UQ、userId+status、expiresAt | db.ts(localAuth /api/auth/refresh,旗標 ON 時) | 同左 | ✏️(旗標 OFF≈空表) |
| login_history | 登入成功/失敗軌跡(含裝置/地理) | userId、email、success bool、ipAddress varchar45、userAgent、device/browser/os/country/city、failureReason | userId、userId+createdAt、email | localAuth(每次登入嘗試) | passwordResetRoutes GET login-history、admin、loginHistoryPurgeJob 清理 | 🔥 |
| email_verification_tokens | 換綁 email 驗證 token(sha256) | userId、newEmail、tokenHash UQ、expiresAt、used | userId/tokenHash/expiresAt | **server/ 零引用(schema-only 死表;email 驗證未接線,01 §3.8)** | 無 | 📌(空) |
| password_reset_tokens | 忘記密碼 token(sha256、1h 單次) | userId、tokenHash UQ、expiresAt、used | userId/tokenHash/expiresAt | db.ts(passwordResetRoutes) | 同左+brainPipeline(健檢統計) | ✏️ |
| user_google_oauth_tokens | 增量 OAuth token(Drive/Calendar),(userId,purpose) 唯一 | userId、purpose(default "drive")、accessToken/refreshToken text、scope、expiresAt | user idx、user+purpose UQ | db.ts(googleAuth 增量授權) | drive router、contextPackets/connectionService | ✏️ |

### 1.2 生成 / 影片(6 表)

| 表名 | 用途 | 關鍵欄位 | 索引 | 寫入者 | 讀取者 | 量級 |
|---|---|---|---|---|---|---|
| background_jobs | 全站非同步任務佇列(生成/訓練/RAG 進料/ZIP) | userId、jobType enum(image/video/audio/voice/zip_export/multimodal/model_training/teaching_archive_ingestion)、status enum(queued→processing→completed/failed/cancelled)、progress int、resultJson json(prompt/modelId/request_id/statusUrl/chargedPoints…)、errorMessage、expiresAt | userId+status、userId+createdAt | generate/director/proStudio 各生成 mutation、webhookFal/webhookSuno 回填、teachingArchiveIngest、staleJobChecker、postGenActions | generate.activeJobs/myJobs(前端 5s 輪詢)、SSE generationBus、backgroundJobPurgeJob | 🔥 |
| generation_history | 生成結果歷史(供 History 頁/評分/歸檔) | userId、modality enum(4)、prompt/compiledPrompt text、parameterSnapshot json、resultUrl/thumbnailUrl、userRating、isBookmarked、costCredits、sourceUrl/provider/archivedAt/expiresAt/archivalChecksum(0058 歸檔鏈) | userId+createdAt、userId+modality、userId+isBookmarked、(archivedAt IS NULL,createdAt) 函式索引 | postGenActions(doPostGenComplete 三表之一)、mediaArchivalService 回填 | history router、showcase、download route | 🔥 |
| video_projects | 影片專案(AIDV-252;/api/v1 與 /api/video 的標的) | userId、creativeProjectId、title、aspect_ratio enum(16:9/9:16/1:1)、output_spec json{resolution,fps,codec}、input_assets json(VideoInputAsset[],AIDV-270)、version int(樂觀鎖)、priority_class enum(standard/express/critical)、output_storage_path/output_signed_url/output_expires_at(AIDV-684 快取) | vp_userId | db.ts(videoRoute REST、v1.ts、tRPC videoProject) | videoAnalyticsRouter、agentCapabilityRouter、unifiedSse/agentEventsRoute;**Supabase 另有同名概念表(uuid),身分未打通(B §2.4)** | ✏️ |
| video_analytics | 影片播放事件(90 天滾動;匿名 visitorId sha256) | videoProjectId、userId(null=opt-out)、visitor_id varchar64、event_type enum(play/pause/pct25/50/75/complete)、duration_watched int | videoProjectId、createdAt | videoAnalyticsRouter.track | videoAnalyticsRouter 統計 | 🔥 |
| project_snapshots | 專案快照(AIDV-253,undo/稽核) | project_id、snapshot json(全量)、source varchar20(auto/manual) | project+createdAt | db.ts(videoProject/spine) | 同左 | ✏️ |
| user_workflows | 使用者自訂工作流步驟(AIDV-43;每人一筆) | userId UQ、stepsJson json(步驟陣列 id/name/required/enabled/canvasMode) | PK/UQ | db.ts(workflow router) | 同左 | ✏️ |

### 1.3 光球 orb_*(20 表)+ 光球周邊(2 表)

| 表名 | 用途 | 關鍵欄位(擇要) | 索引 | 寫/讀 | 量級 |
|---|---|---|---|---|---|
| agent_preferences | 光球代理偏好(每 user 一筆 PK=userId):確認政策/工具白黑名單/語音/成本上限/禁用頁清單/精靈靜音星標/stayOnPageMode/proactiveTriggerSettings | confirmationPolicy enum(4)、allowedRiskLevels/autoApproveTools/blockedTools json、maxAutoStepsPerTask、costBudget json、mutedSpirits/favoriteSpirits json、disabledActionsByPage json | userId | 寫:agentPreferencesRouter;讀:ai router、orbTaskOrchestrator/ChainRunner、orbScheduler、webhooks/orb | ✏️ |
| orb_scheduled_jobs | 光球使用者級 cron(重啟後由本表重建 node-cron) | id varchar128 PK、userId、cronExpression、taskDescription、enabled、lastRunAt/lastError/lastResult/lastRunStatus | userId | 寫/讀:orbScheduler、orbSchedulerRouter、orbDatabaseTools | ✏️ |
| orb_conversations | 光球多分頁對話 session 清單 | conversation_id varchar48 PK、userId、title、pinned、archivedAt、lastMessageAt、messageCount | user+updated、user+archived | orbConversationsRouter(client 每回合持久化;`ai.chat` 本身 stateless 不讀) | ✏️ |
| orb_conversation_messages | 光球對話逐則訊息 | message_id bigint PK、conversationId、role enum(user/orb)、text、at bigint(client ts)、metadata json | conv+at、user+conv | orbConversationsRouter | 🔥 |
| orb_long_term_memories | 跨 session 長期記憶(7 類 memoryType) | memoryType enum(user_fact/preference/skill_learned/workflow_pattern/error_solution/success_recipe/context_snippet)、content text、importanceScore dec(3,2)、**embeddingVector json(向量存 MySQL JSON,非向量庫)**、accessCount、expiresAt | user、user+type、importance、spirit、accessed、expires(6 個) | orbLongTermMemory service | 🔥 |
| orb_memory_associations | 記憶關聯圖(from→to,6 種關聯) | fromMemoryId/toMemoryId bigint、associationType enum(6)、strength dec | (from,to,type) UQ | orbLongTermMemory | ✏️ |
| orb_intent_logs | 意圖偵測記錄 | conversationId、userInput、detectedIntents json、primaryIntent、ambiguityScore、needsClarification、spiritAssigned | 5 個 | orbClarificationEngine | 🔥 |
| orb_clarification_history | 澄清問答歷史 | intentLogId、clarificationQuestion、questionType enum(6)、options json、userAnswer、resolvedIntent | 5 個 | orbClarificationEngine | ✏️ |
| orb_user_answer_patterns | 使用者常見回答模式(學習預設值) | questionType、commonAnswers json、defaultPreference、confidenceScore、sampleCount | user、user+confidence | orbClarificationEngine;orbProxyRouter(清偏好) | ✏️ |
| orb_feature_usage_stats | 功能使用統計(每 user×feature 一筆) | featureId、usageCount/successCount/failureCount、proficiencyScore | (user,feature) UQ+4 | orbFeatureDiscovery | ✏️ |
| orb_feature_discovery_paths | 功能發現路徑(7 種 discoveryMethod) | featureId、discoveryMethod enum、fromFeatureId、timeToFirstUse | 4 個 | orbFeatureDiscovery | ✏️ |
| orb_feature_recommendations | 功能推薦與點擊/採納追蹤 | featureId、reason、relevanceScore、presentedAt/clickedAt/usedAt/dismissedAt、feedbackRating | 4 個 | orbFeatureDiscovery | ✏️ |
| orb_workflow_templates | 工作流模板(steps json:spiritId+toolName+conditions) | creatorUserId、category、isPublic/isVerified、steps json、inputSchema/outputSchema、difficulty、usageCount、avgRating、version | creator/category/public/usage | orbWorkflowEngine | ✏️ |
| orb_workflow_executions | 模板執行實例 FSM | templateId、status enum(pending/running/paused/completed/failed/cancelled)、inputs/outputs json、currentStepIndex/totalSteps、durationSeconds | template/user/status/conv | orbWorkflowEngine | ✏️ |
| orb_workflow_step_executions | 逐步執行紀錄(+Skill 稽核欄) | executionId、stepIndex、spiritId、toolName、status enum(5)、retryCount、**skillId/skillVersion/inputSnapshot/permissionSnapshot(AIDV-126)** | (exec,stepIndex) UQ+4 | orbWorkflowEngine、skillOrchestrator | 🔥 |
| orb_workflow_template_ratings | 模板評分(1-5 星,每 user 一票) | templateId、rating、comment、wasHelpful、completedSuccessfully | (template,user) UQ | orbWorkflowEngine | ✏️ |
| orb_spirit_collaboration_metrics | 精靈間交棒日聚合 | date、fromSpiritId/toSpiritId、handoffCount、successfulHandoffs/failed、userSatisfactionScore | (date,from,to) UQ | orbSystemMonitor | ✏️ |
| orb_system_health_metrics | 光球系統健康度量(7 種 metricType) | metricType enum、spiritId、value/threshold dec、isHealthy、unit | 4 個 | orbSystemMonitor | 🔥 |
| orb_cost_attribution | 光球成本歸屬日聚合(user×spirit×tool) | date、userId、spiritId、toolName、usageCount、totalTokens bigint、estimatedCostUsd dec(10,4) | (date,user,spirit,tool) UQ+4 | orbSystemMonitor;讀:apiUsage costAttribution | 🔥 |
| orb_system_alerts | 光球/供應商告警 —— **schema 註解自稱 MYSQL LEGACY(live 表=Supabase system_alerts),但 providerHealthProbeJob 實際仍寫本表**(B §5.4 矛盾實證) | alertType enum(6)、severity enum(4)、spiritId、metricType/metricValue/threshold、isResolved/resolvedAt/resolvedBy | 4 個 | 寫:providerHealthProbeJob、orbSystemMonitor;讀:brainPipeline/admin | ✏️ |
| orb_feedback_events | 使用者對光球建議的逐筆反應(Phase 3c 記憶) | pageId、actionType、status enum(accepted/edited/cancelled/completed/failed)、note varchar512、actionSummary | user+createdAt、user+actionType | db.ts(ai router 記錄;LLM 讀回最新 N 筆入 prompt) | 🔥 |
| agent_model_picks | 「誰在哪個介面為哪個模態選了哪個模型」單一真相源(導演 AI+光球共學) | modality varchar32、modelId、source enum(9:director_ai/global_orb/各 studio/history…)、accepted bool(事後回填)、context json | user+modality、user+model、createdAt | 寫:agentModelPicks service、postGenActions、history/agentModelPicksRouter;讀:ai router 推薦、siteKnowledge | 🔥 |

### 1.4 代理協作(agent_*,7 表)

| 表名 | 用途 | 關鍵欄位 | 索引 | 寫/讀 | 量級 |
|---|---|---|---|---|---|
| agent_collaboration_sessions | 多代理協作 session(含計畫狀態+樂觀鎖 version) | collaboration_id varchar64 PK、taskDescription、status enum(4)、initiating/currentAgent、participatingAgents json、planStatus enum(5)、planData json、version int(AIDV-323/316) | 5 個 | agentCollaborationOrchestrator、agentCollaborationRouter;SSE agentEventsRoute 讀 | ✏️ |
| agent_collaboration_steps | 協作逐步(工具+依賴+重試) | step_id PK、collaborationId、stepOrder、agentRole、toolName/toolArgs、dependencies json、status enum(5)、retryCount/maxRetries | 4 個 | **server/ 無直接引用(orchestrator 未落此表;schema-only)** | 📌 |
| agent_collaboration_messages | 代理間訊息(7 種 messageType) | messageId PK、from/toAgent、messageType enum(7)、priority enum(4)、content json、correlationId | 5 個 | **server/ 無直接引用(schema-only)** | 📌 |
| agent_collaboration_handoffs | 代理交棒紀錄 | handoffId PK、collaborationId、from/toAgent、handoffReason、contextTransferred json | 2 個 | agentCollaborationOrchestrator | ✏️ |
| agent_performance_metrics | 代理日績效聚合 | agentRole、metricDate、totalCollaborations、successful/failedSteps、toolSuccessRate dec | agent+date | **server/ 無直接引用(schema-only)** | 📌 |
| agent_dynamic_registry | 外部/長期代理能力註冊(MySQL 側;與 Supabase agent_capability_registry 平行) | agentId UQ、capabilities json、allowedEndpoints json(AIDV-331 scope)、costPerToken dec(16,10)、currentLoad/maxLoad dec、isActive、lastHeartbeatAt | isActive+load | agentCapabilityRouter、agentStatusRoute | ✏️ |
| agent_dlq | 驗證門失敗死信佇列(AIDV-346/926) | issueKey、failureType enum(lint/test/build/unknown)、routingAction enum(retry/decision/escalate)、payload json、retryCount、correlationId、resolvedAt/By/Note | issueKey、(routingAction,resolvedAt)、correlation | 寫:agentDlq service;讀:agentDlqPoller cron、agentWorkflowRouter | ✏️ |

### 1.5 世界觀 / 專案 / Commander(8 表)

| 表名 | 用途 | 關鍵欄位 | 索引 | 寫/讀 | 量級 |
|---|---|---|---|---|---|
| worldbuilding_frameworks | 世界觀主表(角色/場景/物件/風格/配樂全 JSON 欄,schema 由 shared/worldbuilding-types 定義) | name、genre/era、charactersJson/scenesJson json NOT NULL、objectsJson、linkedModelIds json(→fine_tuned_models)、styleProfilesJson/musicThemesJson、researchEntriesJson/soundLibraryJson/uploadedAssetsJson(v4)、globalNegativePrompt | userId、user+createdAt | db.ts(worldbuilding router;逐欄細節見 G2) | ✏️ |
| world_storyboards | 秒級動畫分鏡時間軸(一世界多分鏡) | worldId、totalDurationSec、fps(24)、aspectRatio、scenesJson json、productionStatus varchar32(default planning)、finalVideoUrl、pipelinePlanJson/jobsJson(管線步驟狀態) | userId、worldId、user+createdAt | db.ts(worldStoryboard router、director queueForVideo) | ✏️ |
| timeline_frames | 時間軸圖幀(keyframe/概念圖/最終渲染) | storyboard_id、scene_id、time_offset_sec dec、image_url、frame_type enum(5)、consistency_check_json | storyboard/scene/user/time | db.ts(worldStoryboard) | ✏️ |
| scene_compositions | 多角色多場景構圖畫布 | world_id、storyboard_id、canvas_width/height(1920×1080)、background_image_url、elements_json NOT NULL、ai_suggestions_json | world/storyboard/user | db.ts | ✏️ |
| creative_projects | 創作專案(綁 director session+world+storyboard;刻意無 FK 便於重綁) | title、directorSessionId(→project_notes_calendar)、worldFrameworkId、worldStoryboardId、worldviewId/scriptId(Phase1 alias)、status enum(concept/production/review/complete)、metadata json、version int(樂觀鎖 AIDV-316) | userId、user+updatedAt、worldFramework、worldStoryboard | db.ts(creativeProject router);contextPacketService 讀 | ✏️ |
| orchestration_runs | Commander 任務入口紀錄(M1-B) | projectId(nullable)、teamId、mode enum(create/director/video/assets/database)、intent text、status enum(7)、commander enum(fallback/perplexity/subq/orb/codex/claude)、planJson/toolCallsJson/citationsJson、priority enum(urgent/normal/background)、estimated/actualCostUsd | user/project/±createdAt 4 個 | orchestrationRunsRouter、db.ts(commander.createIntent) | ✏️ |
| context_packets | TTL 上下文包(M4;project/team/user scope) | projectId、scope enum(3)、sourceRefsJson json、summaryMarkdown **mediumtext**、tokenEstimate、createdByModel、expiresAt(TTL) | project/±createdAt/user/team/expiresAt | contextPacketService/Router、trainingTrack、projectContext;ragInjectionGuard 消費 | ✏️ |
| project_data_access_rules | 資料來源存取規則(M4;projectId null=team 預設) | teamId、projectId、materialId/connectionId/collectionId、accessLevel enum(none/summary_only/chunk_access/full_reference)、allowedModesJson | team/project/material/team+project | db.ts(teamData router) | 📌 |

### 1.6 資產 / 工具(13 表)

| 表名 | 用途 | 關鍵欄位 | 索引 | 寫/讀 | 量級 |
|---|---|---|---|---|---|
| digital_asset_library | 全站資產庫(R2 URL+key;三表落庫之一) | title、assetType enum(6 含 script/zip_bundle)、fileUrl/fileKey、mimeType、fileSizeBytes、visibility enum(private/team_shared)、rewardCredits、tags/category(記記 0045)、sourceStudio/modelId/backgroundJobId(0047 來源)、sourceUrl/provider/archivedAt/expiresAt/archivalChecksum(0058) | 6 個含 (archivedAt IS NULL,createdAt) 函式索引 | postGenActions、assets router(upload)、mediaArchivalService、notesCuratorTools | 🔥 |
| consistency_vault | 一致性錨點(角色/場景參考圖) | name、itemType enum(character/scene)、imageUrl NOT NULL、fileKey、tags/metadata json | user、user+itemType | db.ts(vault router);generate 注入參考圖 | ✏️ |
| project_notes_calendar | 筆記/腳本/行事曆三合一(導演對話 gzip 存檔也在此) | title、content text(`gz:`+gzip+base64 可壓縮)、scriptJson、noteType enum(note/script/calendar_event)、status enum(todo/in_progress/done)、scheduledDate/endDate、reminderMinutes、location json、meetingUrl、category | 5 個 | db.ts(notes/schedule router、director.saveSession)、notesCuratorTools | ✏️ |
| drive_asset_libraries | 釘選的 Google Drive 資料夾(僅存 metadata) | label、kind enum(shoot/personal/other)、driveFolderId/Name | user、user+kind | db.ts(drive router) | 📌 |
| prompt_library | 提示詞庫(生成鏈自動落+手動) | title、content text、category、isFavorite/isPublic、useCount、modelHint、language(zh)、generationMode | user/category/generationMode | postGenActions(自動)、promptLibrary router | 🔥 |
| prompt_assets | prompt↔asset junction(0075 有 DB 層 FK+CASCADE,全庫唯二) | promptId、assetId、relation enum(derived/variant/rewrite/extended) | (prompt,asset,relation) UQ 冪等 | db.ts(postGen 完成鏈;ENABLE_PROMPT_ASSET_LINKS ON) | 🔥 |
| prompt_collection | 提示詞收藏(可 team_shared;來源回連 25 精靈/樣板) | title、content、sourceType varchar32(agent_role/proactive_trigger/model_template/image_studio/site_prompt/manual)、sourceRef/sourceLabel、visibility enum、teamId、(user,sourceType,sourceRef) UQ | 5 個 | promptCollection router | ✏️ |
| custom_blocks | 自訂積木(單顆 prompt 片段) | modality enum(4)、category、label、prompt varchar512、emoji | user+modality | db.ts(customBlocks);voiceCompiler/proStudio 消費 | ✏️ |
| block_combos | 積木組合(存 blockIds 參照) | name、modality、blockIds json NOT NULL、customBlockIds/vibeCardIds json | user、user+modality | db.ts(blockCombos router) | ✏️ |
| custom_blocks_combo | S-S-L-C-M 完整積木 JSON 存檔(含編譯後 prompt/大腦快照;可策展) | subjectBlock/styleBlock/lightingBlock/cameraBlock/moodBlock json、extraBlocks、compiledPrompt、brainConfigSnapshot、isCurated/isPublic、forkCount/likeCount/useCount | user、user+modality、isCurated+isPublic | db.ts(learnHub.seed 種子;combo router) | ✏️ |
| studio_recipes | 創作工作室配方(SavedRecipe 整包 JSON) | name、modality enum(image/video/music/voice)、payload json NOT NULL | user、user+modality | studio router | ✏️ |
| studio_versions | 創作工作室版本歷史(client versionKey 對齊) | modality、versionKey varchar64、pinned、payload json | user、user+modality、user+versionKey | studio router | ✏️ |
| featured_showcase(+comments) | 首頁精選展示(情緒矩陣 vibeParameters+完全解構積木配方可一鍵複製)/其評論 | generatedItemId、imageUrl、vibeParameters json(warmth/energy/mystery/serenity/whimsy/intensity)、completelyDeconstructedBlocks json、sortWeight、isActive、likeCount/forkCount/commentCount;comments:showcaseId/userId/content | isActive+sort、modality、curator;comments:showcase+created、user | showcase router | ✏️ |

### 1.7 知識 / 學習(6 表)

| 表名 | 用途 | 關鍵欄位 | 索引 | 寫/讀 | 量級 |
|---|---|---|---|---|---|
| teaching_materials | 「資料庫」訓練素材池(RAG 源) | teamId、mediaType enum(7)、fileUrl/fileKey/fileName、**textContent mediumtext(~16MB,抽文/轉錄回填)**、transcriptionStatus enum(5)、lineage/sourceType enum(7)/sourceDate/topic/speaker、realEarthRefs json、visibility enum(private/team_shared/public_disciples)、isFeatured | 9 個(user×5、team+visibility 等) | db.ts(teachingArchive router)、teachingArchiveIngestionWorker 回填 | ✏️(textContent 大) |
| teaching_material_access_log | 素材存取稽核(view/download/search_hit/reingest/update/delete) | materialId、userId、action enum(6)、metadata json | material/user/action ×createdAt | db.ts(teachingArchive 各操作) | 🔥 |
| learn_modules | LearnHub 管理員文件(AIDV-214;主資料仍在記憶體,DB 為持久層) | id varchar128 PK、category、title、summary varchar500、content mediumtext、difficulty enum、readingMinutes、featured、attachments json | featured | learnHub router(admin 寫;啟動 initLearnHubFromDb 併回記憶體) | 📌 |
| news_articles | 首頁新聞(OARS 柔化摘要;sourceUrl 去重) | title varchar512、oarsSummary text、bodyMarkdown、sourceName/sourceUrl、category enum(5)、isPinned/isPublished、publishedAt、viewCount | isPublished+isPinned+publishedAt、category、publishedAt | newsFetcher cron(6h)、learnDocSyncer 讀 | ✏️ |
| real_earth_entries | 真實地球資訊(台灣深化;20 類 category) | title varchar500、category enum(20)、summary、content mediumtext、locationJson、historicalPeriod、citationsJson、qualityJson(credibility)、isTaiwanFocused、language | 6 個含 title+summary FULLTEXT | db.ts(realEarth router) | 📌 |
| user_ai_brain | 每 user 一筆的 AI 大腦組態:5 推理腦(director/analyst/storyteller/technician/curator 各 model/temp/topP/systemPrompt/enabled)+4 生成引擎(image/video/audio/voice 各 engine+params json)+**16 個 fal 任務引擎欄**(falTextToImageEngine…falVideoToVideoEngine) | userId UQ;預設 anthropic/claude-opus-4.7、perplexity/sonar-pro、fal-ai/flux-pro/v1.1、fal-ai/wan-t2v、fal-ai/ace-step、fal-ai/elevenlabs/tts/turbo-v2.5 | userId UQ | brain router(upsert/switchModel);讀:brainContext middleware、falDispatcher、generate、director | ✏️(欄超寬 100+) |

### 1.8 模型 / 訓練(6 表)

| 表名 | 用途 | 關鍵欄位 | 索引 | 寫/讀 | 量級 |
|---|---|---|---|---|---|
| fine_tuned_models | LoRA/自訓模型 | modelType enum(6:image_subject/voice_clone/style_lora/scene_lora/video_lora/portrait_lora)、status enum(pending/training/ready/failed)、trainedLoraUrl(.safetensors)、replicatePredictionId、trainingEngine enum(replicate/fal)、configJson(triggerWord/steps/datasetImages…)、usageCount、visibility、teamId | user+status、user+createdAt、teamId | models/loraTrainer router、modelTrainingWorker、webhookReplicate | ✏️ |
| model_training_consents | 肖像權/照片使用數位同意書(訓練前置) | subjectType enum(self/real_person/copyrighted)、consentType、subjectName/IdLast4、signerRelation enum(4)、usageScope enum(training_only/personal_output/public_display/commercial)、validFrom/Until、termsVersion+termsSnapshot text、signatureDataUrl(Base64 PNG)、revokedAt | user、user+subjectName、revokedAt | models router(create 必驗有效 consent) | ✏️ |
| fine_tuned_model_consents | consent↔model 多對多 junction | modelId、consentId | 各單欄 | db.ts(models.create) | ✏️ |
| model_wishes | 模型許願池 | modelName、provider、modality enum(9)、reason、voteCount(去正規化)、status enum(pending/under_review/planned/added/rejected)、adminNote | status、voteCount、user | modelWishesRouter | ✏️ |
| model_wish_votes | 去重投票 | wishId、userId | (wish,user) UQ | db.ts(交易+FOR UPDATE) | ✏️ |
| user_model_switch_logs | 大腦/引擎切換日誌 | brainSlot enum(9)、fromModel/toModel、from/toParams json、switchSource enum(manual/soul_recommendation/auto_fallback/ab_test) | user+switchedAt、user+brainSlot | brain.switchModel(同交易) | ✏️ |

### 1.9 團隊 / 權限 / 資料接入(5 表)

| 表名 | 用途 | 關鍵欄位 | 索引 | 寫/讀 | 量級 |
|---|---|---|---|---|---|
| teams | 團隊 | name、ownerId | ownerId | teams router | 📌 |
| team_memberships | 團隊成員(owner/admin/member;UNIQUE 防 race) | teamId、userId、role enum(3)、invitedBy | (team,user) UQ | teams router;promptCollection 過濾讀 | 📌 |
| resource_shares | 顯式共享 SSOT(AIDV-121 RBAC;旗標 OFF 時不查) | resourceType enum(project/asset/prompt/material)、resourceId、sharedWithType enum(user/team)、sharedWithId、role enum(viewer/editor)、sharedByUserId | (type,id,withType,withId) UQ+2 | db.ts(canAccess;assets.teamAssets 過濾) | ✏️ |
| data_source_connections | 外部資料來源連接(Drive/Notion/mcp;AES 加密憑證) | kind enum(cloud/notes/mcp/external_api)、provider、authType enum(oauth/api_key/none)、encryptedCredentialRef text、configJson、status enum(4)、expiresAt/expireWarnedAt(AIDV-68 到期告警) | owner/team/project/owner+provider | connectionService;credentialExpiryAlertJob 讀 | 📌 |
| specialized_agent_memory / _interactions | 專職代理記憶(user×agent 偏好/模式)與互動遙測 | memory:agentId、memoryType enum(4)、memoryKey/Value json、confidence;interactions:interactionType enum(5)、toolName、userSatisfaction enum(3)、durationMs | memory 3 個;interactions 3 個 | SpiritMemoryRepository / specializedAgentMemoryStore | ✏️/🔥 |

### 1.10 帳務 / 用量 / API(12 表)

| 表名 | 用途 | 關鍵欄位 | 索引 | 寫/讀 | 量級 |
|---|---|---|---|---|---|
| api_usage_logs | 每次 AI 呼叫的用量+成本 log(dashboard 主來源) | requestType enum(7)、apiProvider、tokensUsed/videoSeconds/audioCharacters/sunoCredits、estimatedCostUsd dec(10,6)、responseStatus enum(4)、generationsDeducted、model、input/outputTokens、costCredits、durationMs | user+createdAt、user+provider | 各生成鏈+db.ts logApiUsage | dashboard.myStats、accountant、apiUsage、apiUsageAlertJob | 🔥 |
| ai_usage_events | AI Provider 事件級紀錄(4 provider enum:fal_ai/gemini/elevenlabs/suno) | provider enum、endpoint、apiKeyId、status enum(4)、units dec+unitType enum(6)、costUsd dec(12,6)、latencyMs、requestMeta json | provider/user/status ×createdAt | aiProxy、usageCost service | apiUsage router、providerSnapshotJob、cost/ledger | 🔥 |
| provider_snapshots | 供應商配額/餘額每小時快照 | provider enum、tier、quota/remaining dec、nextInvoice json、balanceUsd、concurrency | provider+snapshotAt | providerSnapshotJob | apiUsage、costAnalytics | ✏️ |
| cost_aggregations | 每日費用聚合(+AIDV-14 TWD 凍結匯率) | provider、endpoint、date、callCount、totalUnits/totalCostUsd、totalCostTwd dec(16,4)、exchangeRate | provider+date、date | providerSnapshotJob/costLedgerReconcileJob | apiUsage、orbBudgetGuard | ✏️ |
| cost_ledger | append-only 雙分錄成本帳本(AIDV-153;**旗標 ENABLE_COST_LEDGER 預設 OFF**) | accountKey varchar128("type:id")、entryType enum(debit/credit)、amount dec(12,6)≥0、status enum(pending/posted/archived)、idempotencyKey UQ、refType/refId、projectId/workflowId、sourceCurrency/exchangeRate/amountTwd、provider/model、costSource(provider/catalog)、skillId/skillVersion(AIDV-130) | idempotencyKey UQ+6 | cost/ledger service、costLedgerReconcileJob | apiUsage | 🔥(旗標 ON 後) |
| cost_attribution_outbox | 不漏帳 outbox(AIDV-14;pending→done/dead 重試) | idempotencyKey UQ(aue:<id>)、status enum(3)、payloadJson NOT NULL、attempts、lastError | idempotencyKey UQ、status+createdAt | cost/costAttribution(寫入+drain cron) | 同左 | 🔥 |
| rate_limit_rules | 動態限流規則(per_user/per_api_key/global) | ruleType enum(3)、targetId、provider、dailyCallLimit、daily/monthlyCostLimitUsd、isActive | PK | apiUsage.rateLimits admin CRUD | aiProxy checkRateLimit | 📌 |
| alert_configs | 預算/配額/異常告警設定 | alertType enum(budget/quota/anomaly)、provider、thresholdPct、monthlyBudgetUsd、lastTriggeredAt | PK | apiUsage.alerts admin CRUD | apiUsageAlertJob(15min→Slack) | 📌 |
| subscription_plans | 訂閱方案目錄(free/starter/pro/enterprise) | name、tier enum、priceMonthly、quotaAllocation json、features json、isActive | PK | admin seed | plans router(前端無購買 UI) | 📌 |
| user_subscriptions | 使用者 Stripe 訂閱(每 user 一筆) | userId UQ、stripeCustomerId/SubscriptionId、planId、status enum(active/past_due/cancelled/trialing)、currentPeriodStart/End、cancelAtPeriodEnd | stripeCustomer/Subscription/status | stripeWebhook(**handler 全 TODO,實際不寫**) | brainPipeline | 📌 |
| external_service_subscriptions | 外部服務訂閱台帳(admin 管理 fal/Suno 等自家訂閱) | serviceName、planName、monthlyCostUsd、billingCycle enum(3)、nextRenewalDate、apiKeyEnvVar、apiKeyStatus enum(3)、riskLevel | PK | externalServices router | 同左 | 📌 |
| api_keys | 對外 API 金鑰(AIDV-276;`aidv_` 前綴) | name、key_hash varchar64 UQ(sha256)、key_prefix varchar12、scopes json(如 video:create/video:read)、last_used_at、revoked_at | user、keyHash UQ | apiKeyRouter(建立/撤銷) | routes/v1.ts 逐請求驗證 | 📌 |

### 1.11 平台 / 稽核 / 其他(7 表)

| 表名 | 用途 | 關鍵欄位 | 索引 | 寫/讀 | 量級 |
|---|---|---|---|---|---|
| system_settings | 每 user 全域偏好(主題/隱私 consent/備份/生成預設/通知/locale) | userId UQ、uiTheme/accentColor/fontScale、analyticsConsent 等 4 隱私欄、autoBackup* 4 欄、defaultModality/CreativeMode、nsfwFilter、locale(zh-TW)/timezone(Asia/Taipei)、extraSettings json | userId UQ | settings router | 同左 | ✏️ |
| global_audit_log | 全站 append-only 稽核(AIDV-123;best-effort 不阻斷) | actorUserId、actorRole、action varchar100(`<domain>.<verb>`)、targetType/targetId、result enum(success/failure)、ipAddress、metadata json;無 updatedAt | actor/action/target/純 createdAt 4 個 | audit/auditLog service(各關鍵寫入點) | auditLog.events/export(admin 唯讀)、auditLogPurgeJob | 🔥 |
| user_feedback_reports | 使用者回饋(+AIDV-864 快速情境欄) | category enum(4)、title、status enum(4)、priority enum(4)、feature_area、page_context json(route/shell/viewport)、landmark json、screenshot_key | user+status、user+createdAt | feedback router(10/h 限流) | admin | ✏️ |
| skill_registry | Skill 安裝註冊(Wave S/AIDV-129) | skillId UQ、version、trust enum(official/reviewed/community)、grantedConnectors json、grantedMaterials/CrossProject bool、status enum(active/disabled)、manifestChecksum、needsReaudit tinyint | skillId UQ、trust、status | skillRegistryService、skillRegistry router | 同左 | 📌 |
| webhook_subscriptions | 使用者自訂 outbound webhook(AIDV-269;非供應商 inbound) | url varchar2048、events json、secret varchar64、active | userId+active | webhook router | webhookDispatcher | 📌 |
| webhook_delivery_history | outbound webhook 投遞歷史 | subscriptionId、event、payload json、statusCode、attempt、succeeded、errorMessage | subId+createdAt | webhookDispatcher | webhook router | ✏️ |
| r2_storage_snapshots / r2_object_catalog | R2 儲存每日總量快照 / per-object 目錄(AIDV-66 M3) | snapshots:snapshotDate、totalBytes bigint、bytesByType json、estimatedMonthlyCostUsd;catalog:snapshotId、objectKey varchar1024、fileSizeBytes bigint、etag、category | catalog:snapshotId、objectKey | r2SnapshotJob cron | apiUsage/admin | ✏️/🔥(catalog 隨物件數) |
| ai_director_preferences | 導演 AI 偏好(personality/格式) | personality enum(calm/creative/technical)、preferredFormat enum(co-star/sslcm/selcm/free)、customSystemPrompt、onboardingSteps json | userId | director.preferences | director router | ✏️ |

---

## 2. Supabase Postgres 表字典(`supabase/migrations/` 23 支)

> 分工(B §2.3):Supabase=多代理影片管線執行面+平台監控;寫入者主要是 **DB 自身(trigger+pg_cron)+edge functions+外部代理(service_role)**,Node 只有 handoffTraceRoute/brainPipeline/goTrueHealthMonitor 等少數接點。身分模型為 `creator_id uuid`(Supabase Auth),與 MySQL int userId 無對照表。

### 2.1 基底 DDL 在 repo 的表(3 張)

| 表名 | 用途 | 欄位 | RLS / trigger | 量級 |
|---|---|---|---|---|
| agent_capability_registry | 代理心跳/能力/負載註冊(edge function `agent-heartbeat` upsert) | id bigint identity PK、agent_id text UQ、capabilities jsonb、current_load int(0)、max_load int(5)、status text(idle)、last_seen timestamptz、metadata jsonb | 索引 idx_acr_last_seen(last_seen DESC);migration 未見 RLS 宣告(edge function 以 x-agent-secret 應用層驗證) | ✏️(心跳每分 upsert) |
| agent_handoff_log | 代理交棒紀錄(from_task→to_task,含 payload_hash 完整性追溯) | id uuid PK、project_id uuid **FK→video_projects CASCADE**、from_task_id/to_task_id uuid **FK→agent_tasks**、from_agent/to_agent text、payload_hash text(md5)、handoff_at、status text CHECK(initiated/completed/failed)、creator_id uuid(去正規化供 RLS) | RLS ON:`ahl_creators_read_own`(creator 讀自己)、`ahl_service_role_insert`;trigger `trg_log_agent_handoff`(由 `write_handoff_from_task_dispatch()` 於 agent_tasks 派工時自動寫,AIDV-829 修過);索引 project/to_task/from_task/handoff_at | 🔥 |
| video_pipeline_slo | 管線 per-agent SLO 門檻(target/alert 秒數) | agent_type text PK、target_seconds int CHECK>0、alert_seconds int CHECK>target、description、updated_at | RLS ON:`slo_read_authenticated`(authenticated 可讀)、僅 service_role 寫 | 📌 |

### 2.2 基底 DDL **不在 repo** 的表(⚠ schema drift,僅由 ALTER/trigger/函式反推;B §2.2)

| 表名 | 用途 | 可反推欄位(自 migrations) | 掛在其上的 trigger / 索引 | 量級 |
|---|---|---|---|---|
| agent_tasks ⚠ | 多代理影片管線派工主表(dispatch_task 寫入) | id uuid、project_id uuid、task_type text、capability、priority int、payload jsonb、status(…→completed)、assigned_agent、provider_used text(AIDV-666/687 補 NOT NULL+backfill)、checkpoint_data jsonb(AIDV-526 斷點續跑)、started_at | trigger:`agent_task_rate_limit_trigger`(BEFORE INSERT,20 tasks/hr/creator,AIDV-742)、`trg_assemble_video_segment`(completed→寫 video_segments)、`trg_coerce_provider_used`、`trg_clear_checkpoint_on_terminal`、`trg_log_agent_handoff`;RLS `creators_read_own_tasks`(AIDV-409 收斂 TO authenticated);索引 assigned_agent、started_at | 🔥 |
| video_projects ⚠ | 管線側影片專案(uuid;與 MySQL video_projects 同名不同庫) | id uuid、creator_id uuid、status(auto_close 會轉 completed) | trigger:`trg_auto_close_video_project`+`trg_notify_video_project_closed`(全段完成→關案+通知,AIDV-665);RLS `creators_own_projects`(TO authenticated);索引 creator_id | ✏️ |
| video_segments ⚠ | 影片段落組裝結果(script/voice/visual/final) | project_id uuid、segment_index int、content_type text CHECK(script/voice/visual/final)、content、created_by_agent、creator_id uuid NOT NULL | 由 `write_segment_from_completed_task()` trigger 寫入;RLS `creators_own_segments`;索引 project_id、(project,content_type)(AIDV-403) | 🔥 |
| system_alerts ⚠ | 平台級監控告警(**正式告警面;與 MySQL orb_system_alerts 分裂,見 B §5.4**) | agent(或 details->>'provider')、alert_type(pipeline_stall/heartbeat…)、details jsonb、resolved、created_at | RLS `system_alerts_service_role_insert`(AIDV-718 service_role-only);UNIQUE `idx_system_alerts_active_agent_dedup`(AIDV-834 active 去重);寫入:pg_cron `detect_pipeline_stall`/`check-heartbeat-liveness`;dispatch_task 讀它做跨供應商 failover(AIDV-522) | ✏️ |
| creator_job_throttle ⚠ | 限流計數(20 tasks/hr;AIDV-742 前一直 0 rows) | creator_id、視窗計數欄 | 由 `check_creator_job_rate_limit()` 維護(函式源自 repo 外的 aidv_501) | ✏️ |
| agent_registry_live ⚠(view) | dispatch_task 選派代理用的 view(capabilities/status/current_load/max_load) | — | 基底定義不在 repo(AIDV-375 曾重建 agent_task_dlq view 移除 SECURITY DEFINER) | — |

### 2.3 函式 / trigger / pg_cron / edge functions(B §2.2 已列,摘要)

- **函式 16**:dispatch_task(擁有權守門 AIDV-380+無代理可用回 retry_after+跨供應商重試 AIDV-522+限流 429 AIDV-528)、complete_task、write_handoff_from_task_dispatch、write_segment_from_completed_task、auto_close_video_project、notify_video_project_closed、enforce_agent_task_rate_limit、check_creator_job_rate_limit(repo 外)、coerce_provider_used_not_null、update/get_task_checkpoint、emit_segment_resume_events、clear_checkpoint_on_terminal、detect_pipeline_stall、detect_stalled_tasks、get_task_slo_status/get_project_slo_report。SECURITY DEFINER 函式已 REVOKE anon/authenticated(AIDV-721/722/318b)。
- **pg_cron 3**:`agent-heartbeat`(每 1 分 pg_net POST edge function,認證 key 存 DB setting)、`check-heartbeat-liveness`(每 5 分→system_alerts)、`rate-limit-bypass-probe`(每 15 分自驗限流)。
- **Edge functions 2**:`agent-heartbeat`(upsert agent_capability_registry;x-agent-secret)、`tts-liveness-probe`。

---

## 3. HTTP 端點總表

### 3.1 `/api/v1` 對外程式化 API(`server/routes/v1.ts`,AIDV-276)

認證:`Authorization: Bearer aidv_<key>` → SHA-256 對 `api_keys.key_hash` 查表(排除 revoked)+ scopes 檢查;逐請求回填 `last_used_at`。**目前僅 2 個端點**:

| 端點 | 方法 | 用途 | 認證/scope | 輸入 → 輸出 |
|---|---|---|---|---|
| /api/v1/videos | POST | 建立影片專案(MySQL video_projects) | api_keys + `video:create` | body zod{title≤255 default「未命名影片」, aspectRatio enum(16:9/9:16/1:1)} → 201 {id, project}(input_assets null→[] 正規化);400 body 錯/401 key 錯/403 缺 scope/503 無 DB |
| /api/v1/videos/:id | GET | 取得影片專案(僅本人 key 的 userId) | api_keys + `video:read` | :id int → {project};404 不存在/403 非本人 |

### 3.2 全部 REST 端點清單(`server/routes/*` + `server/_core/index.ts` 掛載,實掃)

**認證圖例**:JWT=cookie/Bearer session(verifyToken);admin=JWT+role admin;HMAC=簽章/capability token;公開=無認證。

| 路徑 | 方法 | 認證 | 用途 |
|---|---|---|---|
| **上傳/下載** | | | |
| /api/upload | POST | JWT | base64 回退上傳(4MB body、magic-byte 驗證)→R2 |
| /api/upload/presign | POST | JWT | 簽 R2 直傳 URL(SIGNED_URL_UPLOAD 鏈第 1 步) |
| /api/upload/finalize | POST | JWT | 直傳完成回報落帳(豁免 upload 層限流) |
| /api/media/download | GET | JWT | 媒體代理下載(download.ts;查 asset/history 擁有權) |
| /api/proxy-download | GET | JWT+30/15min 限流 | 任意白名單網域檔案中繼(≤100MB;白名單過寬風險 B S2) |
| **供應商 webhook(inbound)** | | | |
| /api/webhook/fal | POST | HMAC capability token(FAL_WEBHOOK_FAIL_CLOSED ON) | fal queue 完成回呼→background_jobs 回填+postGen 三表 |
| /api/webhook/suno | POST | 自家 capability token(Suno proxy 無簽章) | Suno 音樂完成回呼(先回 200 再處理) |
| /api/webhook/replicate | POST | 簽章驗證 | LoRA 訓練狀態回呼→fine_tuned_models+SSE emitTraining |
| /api/webhooks/stripe | POST | Stripe 簽章(rawBody HMAC;未設 secret 時 prod 503) | 訂閱事件(6 個 handler 全 TODO,只 log) |
| /api/webhooks/orb | POST | body.webhookSecret timingSafeEqual ORB_WEBHOOK_SECRET+10/min 限流 | 外部觸發光球任務(202 回 taskId→planner+executor 背景跑) |
| **認證系列** | | | |
| /api/auth/google, /google/start, /google/callback, /google/status | GET | 公開(OAuth state+nonce) | Google OAuth 登入流程(JWT HS256 30d、cookie app_session_id) |
| /api/oauth/google/* | GET | 公開 | 同上(oauth.ts 掛於 googleAuthRouter 之前,_core/index.ts:614) |
| /api/auth/register, /api/auth/login | POST | 公開+auth 限流 10/15min | 本地帳密(scrypt;登入失敗三維度計數) |
| /api/auth/me | GET | JWT | 目前使用者 |
| /api/auth/2fa/status·setup·verify·disable | GET/POST×3 | JWT | TOTP 2FA |
| /api/auth/refresh | POST | 公開(旗標 OFF 預設 403) | refresh token 輪替(ENABLE_REFRESH_TOKEN_ROTATION) |
| /api/auth/forgot-password, /verify-reset-token, /reset-password | POST/GET/POST | 公開+auth 限流 | 密碼重設(sha256 token 1h 單次) |
| /api/auth/change-password | POST | JWT+auth 限流 | 改密碼 |
| /api/auth/profile | PATCH | JWT | 改個資 |
| /api/auth/login-history | GET | JWT | 登入歷史(login_history) |
| **光球/代理** | | | |
| /api/tasks/:taskId/status | GET | JWT | 光球任務 FSM 狀態(in-memory Map) |
| /api/tasks/:taskId/stream | GET | JWT | 光球任務 SSE 串流 |
| /api/agents/status | GET | JWT | 代理快照(agent_dynamic_registry) |
| /api/agents/metrics | GET | admin | Prometheus 格式代理指標 |
| /api/agents/heartbeat | GET(SSE) | JWT | 30s 代理快照 SSE(上限 1h) |
| /api/video/project/:projectId/handoff-trace | GET | authenticateRequest+專案擁有權 | 讀 Supabase agent_handoff_log(service_role) |
| **AI 代理轉發** | | | |
| /api/ai/:provider/* | ALL | JWT+llm/llmPerUser 限流 | 後端注入 API key 的供應商 proxy(rate_limit_rules fail-closed;PostHog 雙寫;無 key 回 503+申請指引) |
| **影片 REST(AIDV-252)** | | | |
| /api/video | GET/POST | JWT(router 級 verifyToken) | 列表/建立 video_projects |
| /api/video/:id | GET/PUT | JWT+擁有權 | 讀/改(PUT 帶 version 樂觀鎖) |
| /api/video/:id | DELETE | JWT | **501 stub**(無 deletedAt 欄) |
| /api/video/:id/process | POST | JWT | **501 stub**(指向 tRPC videoStudio.*) |
| /api/video-output | GET | JWT | 影片輸出簽名 URL(output_signed_url 快取) |
| **其他** | | | |
| /api/ics/:token.ics | GET | icsFeedToken(URL 內 opaque token) | 行事曆 ICS 訂閱 feed(rotate 即撤銷) |
| /api/tools/models | GET | **公開** | fal 模型目錄(FAL_MODEL_CATALOG 依 category 查詢) |
| /api/admin/events/stream | GET(SSE) | JWT+role admin | legacy 管理事件流(UNIFIED_GEN_EVENT_BUS=true 時靜默失效) |
| /api/maps/proxy/* | GET | 公開(path/query 白名單) | Google Maps JS 代理(後端注入 key) |
| /api/metrics, /api/health/detail, /api/provider-health | GET | admin fail-closed | in-process 指標/詳細健檢/供應商健康 |
| /api/health | GET | 公開 | 布林健檢(bootReady 前 503 booting;DB ping 3s) |
| /api/version | GET | 公開 | RAILWAY_GIT_COMMIT_SHA(AIDV-952,QA 比對用) |
| /api/trpc/* | POST/GET | cookie JWT+x-trpc-source header CSRF | 60+ tRPC namespace(見 02 §1.3-1.4) |

### 3.3 SSE / WS(已盤於 02 §8,引用)

/api/generation-events/:jobId、/api/model-training-events/:modelId、/api/agent-events/:collaborationId(前端死碼)、/api/agent-project-events/:projectId(死碼)、/api/agents/heartbeat、/api/admin/events/stream、/api/sse(統一多工,旗標雙端 OFF)、WS /ws/orb-voice。守則:SSE handler 內登入+擁有權(SSE_OWNERSHIP_LOCKDOWN ON)、15s heartbeat、per-user 並發 5;光球 chatProgress/orbTask 為輪詢非 SSE。

---

## 4. 缺讀聲明

- 各表「讀取者」以 `grep -w <drizzleExport> server/` 檔案級命中為準,未逐行區分同檔內讀 vs 寫;經 `server/db.ts` helper 轉手的呼叫端(尤其世界觀 5 表、notes、vault)以 02-fullstack 的接線表補標,未再逐一開 router 檔核對。
- Supabase `agent_tasks`/`video_projects`/`video_segments`/`system_alerts`/`creator_job_throttle` 欄位為 migration 函式體反推(dispatch_task/write_segment 等),非完整 DDL;`agent_registry_live` view 與 `check_creator_job_rate_limit()` 本體不在 repo。
- `server/routes/aiProxy.ts` 中段(provider 白名單完整清單、用量雙寫細節)、`uploadRoute.ts` 1-490 行(presign/finalize 實作)未逐行;`localAuth.ts`/`passwordResetRoutes.ts` 僅讀端點骨架與 B/01 既有結論。
- tRPC 60+ namespace 的 procedure 級清單不在本文件範圍(見 02-fullstack)。
