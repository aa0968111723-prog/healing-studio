# 01 — 完整功能清單(Phase 1-1)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`
- 方法:5 個研究代理逐頁實讀程式碼(頁面檔 + 對應 router + schema),現況判定一律附證據(`檔案:行號`);未逐行讀完的區段在各節「缺讀聲明」明列
- 現況圖例:**完整**=前後端接線+資料表齊備/**半成品**=mock、僅前端、僅後端、flag OFF、ephemeral/**停用**=不可達或 hidden
- 詞彙依 `00-overview.md`

---

## 0. 先讀:全站路由的三個真相

1. **`ENABLE_4SHELL` 預設 ON**(`client/src/config/featureFlags.ts:58`),線上實際走 4-shell 路由;所有舊平路徑由 `shellRouteTable.ts` 相容轉向。
2. **`/video`、`/video/director` 預設由 VideoCockpit 接管**:`ENABLE_VIDEO_COCKPIT` 預設 ON(`videoFlags.ts:45`),`COCKPIT_PATHS` 攔截後 **DirectorAI.tsx 這一頁在預設旗標下任何 URL 都到不了**(`VideoCockpitFrame.tsx:25,40-44`)——導演功能經 Cockpit 介面觸達,DirectorAI 頁本體是旗標後備。
3. `client/src/adapters/` 的 mock/trpc 接縫只服務 social 生成/發文流程;**主要頁面全部直連 `@/lib/trpc`,不經 adapter**。

## 0.1 背景線索查證結果(重要修正)

| 背景宣稱 | 實際(以程式碼為準) |
|---|---|
| Veo 3.1 影片生成 | **無 `veo-3.1` 字串**。實際:`fal-ai/veo3`、`fal-ai/veo3/pro`(videoStudio.ts:723,776);Vertex 路徑 `veo-2.0-generate-001`/`veo-3.0-generate-preview`(geminiMedia.ts:48,139)。DirectorAI 卡片上的「Veo 2.0」徽章是寫死裝飾文案(DirectorAI.tsx:2356-2363) |
| Suno V5 配樂 | **無 V5**。Suno 僅 v3.5/v4,經第三方 proxy `apibox.erweima.ai`(proStudio.ts:2015-2025;modelClients.ts:394,442-450) |
| ElevenLabs 配音 | ✓ 屬實:fal 管道 `fal-ai/elevenlabs/tts/*` 四引擎 + 直連 SDK(TTS 預設 `eleven_v3`,轉錄 `scribe_v1/v2_flash`) |
| CO-STAR Director AI | ✓ 屬實(`director/costarService.ts`,chat 引擎 `perplexity/sonar-pro` :166 + 使用者大腦 slot 預設 `anthropic/claude-opus-4.7`) |
| ZIP 匯出 | ✓ 但**純前端 JSZip**(HistoryPage/Studio 匯出鈕);`export` router 是無人呼叫的死端點(export.ts:25-55) |
| 後台儀表板、RBAC、safety moderation | ✓ 存在(AdminPage 11 分頁;三級角色+資料層 RBAC 旗標 OFF;contentModeration/ragInjectionGuard) |
| gamification | ✗ 不存在(僅 credits 點數) |

---

## 1. video shell(創作工具,9 頁)

### 1.1 VideoCockpit(/video、/video/director 預設實際入口)
`ENABLE_VIDEO_COCKPIT` 預設 ON 時的導演座艙(`shells/video/VideoCockpitFrame.tsx`),整合 AgentStatusBar(SSE `/api/agents/heartbeat`)、導演台抽屜(ConsoleDrawers,含「真實地球研究 I-5」= realEarth.search 唯一 UI 入口)。細節盤點見 02-fullstack(Cockpit 本身未逐行讀完,屬缺讀範圍)。

### 1.2 DirectorAI(/video/director,旗標後備頁)

| 功能 | 用途 | 進入點 | 現況 | 證據 |
|---|---|---|---|---|
| 導演對話(CO-STAR) | 聊出腳本 | chat 分頁 | 完整 | DirectorAI.tsx:3348;director.ts:221-273 |
| 腳本微調/匯入拆分鏡/brief 生成 | 腳本加工 | refineScript/importScript/generateVideoScript | 完整(LLM,結果留前端 state) | director.ts:276-369,504-542,555-651 |
| 逐段討論+單段/批次 CO-STAR | 分鏡優化 | discussSegment 等 | 完整;前端不傳 storyboardId→session 分支永走純 LLM fallback | director.ts:654-785,859-1024 |
| 對話/規劃 session 存讀刪 | 持久化 | saveSession 等 | 完整(gzip+base64 存 notes) | director.ts:381-425,1896-1967 |
| 匯出腳本(json/csv/md/fdx/srt) | 下載 | exportScript→前端 Blob | 完整,不落 DB | director.ts:788-856 |
| 建分鏡板/送影片佇列 | 交棒 /animation、/video-studio | worldStoryboard.createFromSegments/queueForVideo | 完整 | worldStoryboard.ts:402-608 |
| **批次生成鏈** | 分鏡→圖/影/音/語音/SFX | autoGenerateFromSegments→N×executeGenerationTask→3s 輪詢 | 完整(扣點→fal 派工→webhook+輪詢→失敗原子退款→資產入庫) | director.ts:2023-3417 |
| i2v 自動級聯/單鏡重生成 | 圖完成自動當首幀 | useEffect+regenerateSegment | 完整 | DirectorAI.tsx:3278-3334 |
| 批次下載鏈(AIDV-237) | 下載素材 | GenerationProgressPanel | 完整(FEATURE_EXPORT_CHAIN 預設 ON) | DirectorAI.tsx:1691-1874 |
| 快速生成管道 | 選模型交棒各 studio | sessionStorage `sendToStudio` | 完整(交棒式) | DirectorAI.tsx:985-1545 |
| 規劃里程碑→行事曆 | 建 calendar notes | planningCreateMilestones | **半成品**:mutation 宣告了但無呼叫點;後端完整 | DirectorAI.tsx:3341;director.ts:1970-2015 |
| chat 世界脈絡注入 | 世界摘要進 system prompt | server 旗標 | **停用**(ENABLE_DIRECTOR_WORLD_CONTEXT 預設 OFF;前端 chat 也不傳 projectId) | director.ts:150-155 |
| 語音克隆欄位 | 批次 voice 帶克隆聲線 | zod 有 | 半成品(前端無 UI 入口) | director.ts:2086-2089 |

### 1.3 CreationHub(/video/create)

| 功能 | 用途 | 進入點 | 現況 | 證據 |
|---|---|---|---|---|
| 影片專案列表/切換/建立 | type=video 專案管理 | switcher+NewVideoProjectForm | 完整(樂觀更新+回滾) | CreationHub.tsx:198-397 |
| 專案卡(進度/綁定/下一步) | binding 顯示 | VideoProjectCard | 完整(顯示);「+新增」僅導航不寫綁定 | CreationHub.tsx:134-152,406-408 |
| IntentComposer 意圖收件匣 | 意圖→pending orchestration run | commander.createIntent | **半成品(skeleton)**:只寫 pending run,無 AI 分類、無下游編排 | IntentComposer.tsx:52,57;commanderService.ts:82-121 |
| 頁面代理註冊 | 光球識別 | useRegisterPageAgent | 半成品(capabilities 空、handle no-op) | CreationHub.tsx:295-302 |

### 1.4 Studio(/video/studio,四模態統一工作室)

| 功能 | 用途 | 現況 | 證據 |
|---|---|---|---|
| 四模態生成提交(背景任務) | prompt→圖/影/音/語音;安全檢查→大腦選引擎→Vault 注入→扣點→fal queue | 完整 | Studio.tsx:627;generate.ts:1561-1677 |
| 積木式 prompt 編譯(blocks/思考島/負向詞) | compiledPrompt | 完整(純前端) | Studio.tsx:564-594 |
| 引擎+點數報價 | brain.pricingSummary | 完整 | Studio.tsx:610-620 |
| 背景任務輪詢/完成通知 | activeJobs 5s 輪詢 | 完整 | generate.ts:2371 |
| 版本歷史/配方庫 | studio_versions/studio_recipes 快照 | 完整 | Studio.tsx:486-503;schema.ts:2774,2806 |
| 導演規劃建議 | director.askForStudioPlan(LLM 回 actions) | 完整 | Studio.tsx:1341;director.ts:3429 |
| ZIP 匯出包 | 前端 JSZip(成品+parameters.txt+metadata.json) | 完整 | Studio.tsx:3312-3503 |
| 頁內結果直出欄位 | resultUrl/thoughtChain | **半成品**:從未寫入實值,結果全走背景任務抽屜 | Studio.tsx:2337-2338 |

### 1.5 Playground(/video/playground)
純 8 分頁容器(lazy 掛 Studio/ImageStudio/VideoStudio/ProStudio/ModelsPage/LoraTrainer/Dashboard/PromptLibrary),`?tab=` URL 同步、頁面代理 setTab/navigate。自身零後端。完整。(Playground.tsx:29-237)

### 1.6 AnimationStudio(/video/animation)

| 功能 | 現況 | 證據 |
|---|---|---|
| 世界觀 CRUD+匯出/匯入 | 完整 | AnimationStudio.tsx:4689-5434;worldbuilding_frameworks(schema.ts:3470) |
| 可連結語音/微調模型 | 完整 | :5357-5358 |
| AI 生成角色/場景/分鏡 | 完整(**純文字 LLM,無圖像生成**) | worldbuildingGeneration.ts:17,173,266 |
| 分鏡板 CRUD/骨架/管線規劃/鏡頭表匯出 | 完整 | worldStoryboard.ts:230,284;world_storyboards(schema.ts:3548) |
| 深連結 /video/animation/:storyboardId | 完整 | shellRouteTable.ts:45 |

### 1.7 ImageStudio(/video/image,23 個 fal 模型)

| 功能 | 現況 | 證據 |
|---|---|---|
| 文生圖 4 模型(nano-banana-2/pro、seedream v4、imagen4) | 完整 | imageStudio.ts:429-557 |
| 圖片編輯 9 模型(nano-banana 系、seedream v4.5/v5、grok、gpt-image-1.5、flux kontext/flux-2-pro) | 完整 | imageStudio.ts:567-905 |
| 放大(SeedVR)/骨骼(DWPose)/SD 系列(SD3.5/fast-sdxl/lora)/圖轉 3D 5 模型(trellis-2/sam-3/hunyuan3d/rodin/hunyuan_world) | 完整 | imageStudio.ts:915-1390 |
| 前端同步結果回存+recordGenResult | **死碼**(後端只回 request_id,前端 isAsyncResult 永真提早 return;落庫全靠伺服端 webhook/輪詢) | ImageStudio.tsx:3718-3724;imageStudio.ts:302-310 |
| 歷史面板(伺服器+localStorage 合併) | 完整 | ImageStudio.tsx:1205-1443 |
| LoRA 套用 | 完整 | ImageStudio.tsx:2139 |
| 導演/光球 sessionStorage 交接 | 完整 | :3193-3237 |
| 素材庫抽屜鈕/模型細膩導覽 | **停用**(className="hidden") | :4408-4414,4460-4461 |
| 自動存提示詞庫 | **停用**(ENABLE_PROMPT_VAULT 預設 OFF) | promptVaultFlags.ts:40 |
| nanoBanana2Edit 4K | 半成品(後端有付費 gate,前端未暴露 resolution) | imageStudio.ts:834-841 |

### 1.8 VideoStudio(/video/video)

| 功能 | 現況 | 證據 |
|---|---|---|
| 文生影 7 模型(Kling v2.1、Wan、MiniMax、LTX、Sora、Veo3、Veo3 Pro) | 完整 | videoStudio.ts:563-867 |
| 圖生影 6 模型(Kling std/pro、Wan、Runway gen4-turbo、Pixverse v4.5、MiniMax hailuo-02) | 完整 | videoStudio.ts:917-996;falModels.ts:662-698 |
| 影生影(Wan/Kling v2v) | 完整 | videoStudio.ts:1177,1214 |
| 後處理(放大/補幀/Topaz)+特殊工具(CamMaster/AnimateDiff/DepthCrafter/Vidu) | 完整 | VideoStudio.tsx:3077-3487 |
| 運鏡編譯器 | 完整 | :4098-4102 |
| 任務輪詢(防冒認)+模型可用性灰化+輸出規格權益(AIDV-255) | 完整 | videoStudio.ts:1680,1718;VideoStudio.tsx:877,5010 |
| Director 佇列承接(?queue= 讀分鏡板) | 完整 | :4417 |

### 1.9 ProStudio(/video/pro,音訊中心 7 分頁)

| 功能 | 現況 | 證據 |
|---|---|---|
| 音樂生成 fal 4 模型(Sonauto/ACE-Step/Stable Audio/MusicGen) | 完整 | proStudio.ts:522-673 |
| Suno 完整歌曲(Custom Mode 歌詞) | 完整但需 SUNO_API_KEY;**僅 v3.5/v4** | proStudio.ts:2014-2134 |
| 音效生成 | 完整;UI 標「AudioLDM 2」實際路由 `fal-ai/mmaudio-v2`(audioldm2 已下架) | proStudio.ts:389-399,693-776 |
| TTS(ElevenLabs 4 引擎+Qwen3-TTS) | 完整;flash-v2.5 壞掉自動替換 turbo;`speed` state **未送後端** | proStudio.ts:878-889;ProStudio.tsx:1886-1896 |
| 聲音克隆×5(Qwen 克隆/Dia 多說話者/Qwen 語音設計/ElevenLabs IVC/Kling 語音) | 完整(voice_id 只顯示不落 DB) | proStudio.ts:1011-1226 |
| 音訊處理×4(Demucs 分軌/隔離/合併/變聲)+ASR(Nemotron) | 完整(ASR 文字不進資產庫) | proStudio.ts:1241-1439 |
| AI 形像影片×6(Wan s2v/EchoMimic/Stable Avatar/LongCat/LTX-2/Dubbing) | 完整 | proStudio.ts:1445-1639 |
| 素材庫抽屜鈕/模型導覽 | **停用**(hidden) | ProStudio.tsx:4747-4753 |
| qwenCloneVoice/compiledTextToMusic/voiceStyles/jobStatus | 半成品(後端有、本頁無入口) | proStudio.ts:502,984,1646,1832 |

### 1.10 LightOrbCreationStudio(/video/light-orb)
**整頁半成品/純演示**:檔頭明言「沒有真實 API 呼叫」;0 個 tRPC/fetch;4 phase 假時間軸動畫、假的「已存到素材庫」台詞;prompt 不儲存。(LightOrbCreationStudio.tsx:1-13,222-238)

---

## 2. learn shell(8 頁 + 知識系統)

### 2.1 LearnHub(/learn → LearnHome 七分頁)

| 功能 | 現況 | 證據 |
|---|---|---|
| 七分頁富首頁(新手路徑/研究代理/模型情報/學習中心/積分/API金鑰/新聞) | 完整(SHELL_LEARN_RICH 預設 ON) | LearnHome.tsx:25-38 |
| 文件列表/搜尋/分類/詳情 Modal/深連結 | 完整 | LearnHub.tsx:2202-2215 |
| 管理員文件 CRUD+批次匯入 | 完整 | :2217-2264 |
| 提示詞庫分頁(靜態精選+一鍵存個人庫) | 完整(靜態資料) | PromptReferenceTab.tsx:37 |
| 影片學習區 CRUD | **半成品(ephemeral)**:僅伺服器記憶體,redeploy 即丟(AIDV-190) | learnHub.ts:839 |
| 測驗區 CRUD+作答 | **半成品**:題庫記憶體;**作答成績不落任何儲存** | LearnHub.tsx:1270-1275,1983 |
| 學習文件資料層 | **半成品**:主資料是伺服器記憶體陣列;admin 建立走記憶體+MySQL 雙寫,但 cron 自動文件(learnDocSyncer/braveLearnFetcher)**只進記憶體不落 DB** | learnHub.ts:50,599-616;learnDocSyncer.ts:315;braveLearnFetcher.ts:437 |

### 2.2 AIModelsHub(/learn/ai-models)

| 功能 | 現況 | 證據 |
|---|---|---|
| 115+ 模型情報目錄+篩選+詳情+比較(2-4 款) | 完整 | AIModelsHub.tsx:3201,3188-3194 |
| 本期新發現/自動研究面板+admin 觸發研究/改排程 | 完整(admin);**排程只存記憶體,跨重啟需 env** | aiModels.ts:221 |
| 資料層 | **全線非 DB**:硬編碼 catalog(shared/aiModelsCatalog.ts:751)+enrichment 記憶體 Map+Redis 暖啟動 | modelResearcher.ts:71-88 |
| 模型新聞流 | 完整(本頁唯一落 DB 的資料:news_articles) | news.ts:69 |

### 2.3 ModelWishlistPage(/learn/model-wishlist)
許願 CRUD+投票(交易+FOR UPDATE+唯一索引)+admin 治理,全 MySQL 接線完整。(modelWishesRouter.ts:84-99;schema.ts:3941-3997)

### 2.4 MyBrainPage(/learn/my-brain)
**純展示頁**(唯一呼叫 brainPipeline.getMyGraph);真正 CRUD `user_ai_brain` 的 UI 在 AdminPage brain 分頁(AiBrainSettings)。user_ai_brain=每使用者一列:5 推理大腦 slot(director/analyst/storyteller/technician/curator,預設 director=`anthropic/claude-opus-4.7`)+4 生成引擎+16 個 Fal 任務引擎欄(schema.ts:1337-1547)。完整(as designed)。

### 2.5 AgentCodexPage(/learn/codex)
**零後端**(建置時聚合 6 個登記簿,可離線);搜尋/深連結/複製/光球預填全完整。(agent-codex.ts:25-49)

### 2.6 TeachingArchive「資料庫」(/learn/teaching-archive)

| 功能 | 現況 | 證據 |
|---|---|---|
| 素材列表+四視野(全部/我的/團隊/公開)+五維篩選 | 完整(pending 時 3s 輪詢) | TeachingArchive.tsx:188-448 |
| 批次上傳(拖拉+進度)/純文字輸入 | 完整 | :788-1001 |
| 詳情+轉文字狀態+手動 reingest | 完整 | :1574-1690 |
| 存取稽核紀錄(view/download/search_hit…) | 完整 | :1823-1878;teaching_material_access_log |
| 選圖訓練 LoRA(≥4 張→Replicate flux-dev-lora-trainer) | 完整 | :464,1420 |
| RAG 全鏈(上傳→ingest worker→切片→Pinecone→檢索) | 完整(RAG_MEMORY=有 PINECONE_API_KEY 即開;失敗靜默降級 LIKE) | 見 02-fullstack §RAG |
| RealEarth 連結 procedures | **僅後端,無 UI** | teachingArchive.ts:462-527 |
| 語意搜尋 search procedure | 完整(供光球;頁內搜尋走 LIKE) | :432-459 |

### 2.7 TeamsPage(/learn/teams)
teams/team_memberships CRUD 完整;**缺口**:transferOwnership/updateMemberRole 後端有前端未接(teams.ts:198,229);TEAMS_COLLAB flag 預設 OFF,ON 時看板 tasks 恆空=半成品;加成員僅 userId 輸入(Phase 2 簡化);DB 無 FK。

### 2.8 FeedbackPage(/learn/feedback)
建立/列表完整(rate limit 10 次/時);擴充欄位(featureArea/pageContext/screenshotKey)本頁不送,由 ENABLE_QUICK_FEEDBACK 浮鈕(預設 ON)使用;光球可代填代送。

### 2.9 TutorialOverviewPage(/tutorial-overview)
100% 靜態零後端;五軌分站導覽+welcome tour 完整;進度存 client(SiteOnboarding)。

### 2.10 知識系統橫斷
- **news**:newsFetcher 每 6h(NewsAPI→NewsData→Perplexity Sonar 三級備援→Gemini 柔化→去重入 MySQL);入口=首頁 IntelBentoGrid、/learn 新聞分頁、AIModelsHub NewsStrip、admin ContentTab。完整。
- **RealEarth**:13 procedures 全 protected+FULLTEXT 索引表;**唯一 UI 入口在 video 導演台抽屜「真實地球研究 I-5」(僅 search)**;CRUD/stats/getRelated 僅後端。半成品(接線面)。

---

## 3. settings / admin / dashboard(+認證頁)

### 3.1 SettingsPage(/settings,8 分頁)
profile(含 AvatarStudio)/appearance/notifications/onboarding 重置(清 localStorage)完整;dashboard、data(LangSmith)、feedback 三分頁為**內嵌其他頁**;admin 分頁=導航卡(role=admin 才顯示)。設定存 `system_settings`(經 PersonalSettingsContext)。

### 3.2 AgentPreferencesPage(/settings/agent)
光球代理偏好全套完整:行為模式/確認策略(always_approve~manual)、風險白名單、工具允許/封鎖、成本守門員、外觀、「光球記得你」蒸餾檔案、排程任務管理 → `agent_preferences` 表。

### 3.3 AdminPage(/admin,11 分頁,leader 僅見 users/costs)

| 分頁 | 子功能 | 現況 |
|---|---|---|
| overview | 系統統計卡、每日趨勢 | 完整 |
| users | 列表(cursor 分頁防 OOM)、改配額、改角色、自動給點政策、立即發放 | 完整 |
| activity | 使用者活躍摘要 | 完整 |
| api | 供應商用量拆解、13 個 env key 狀態燈(只回 boolean) | 完整 |
| costs | 團隊成本彙總(USD→TWD) | 完整(leaderOrAdmin) |
| generations / jobs | 全站生成歷史/背景任務 | 完整 |
| feedback | 回饋狀態流轉 | 完整 |
| brain(大腦組態) | 內嵌 AiBrainSettings:模型組態 CRUD、目錄、供應商健康、定價、ping、監控摘要 | 完整 |
| ai-research | 提案審批、全站程式掃描研究、研究轉 LearnHub、GitHub Issue 整合 | 完整 |
| skills | 技能註冊表(列表/安裝/信任/啟停) | 完整 |

### 3.4 AdminApiUsagePage(/admin/api-usage,5 分頁)
overview/providers/deep-cost/rate-limit(rate_limit_rules CRUD)/billing 全完整;告警規則(alert_configs)CRUD 完整但 **cron 評估受 ENABLE_BUDGET_ALERTS gate**。

### 3.5 AiBrainPipelinePage(/admin/brain-pipeline)
六層全站健康關係圖(四視圖)+30s 自動刷新+runPatrol 真實 ping 巡檢。完整。本質=靜態站點/供應商目錄+即時探測(brainPipeline.ts 3401 行)。

### 3.6 DashboardPage(/dashboard)
個人用量統計/AI 洞察/credits(pricingCatalog+myBalance)/langsmith(**真連 LangSmith API**,未設 key 顯示未設定)。完整。

### 3.7 認證頁(standalone)
AccountSettings(改名/改密碼/2FA/登入記錄/資料匯出/刪帳)、ForgotPassword(防枚舉+限流)、ResetPassword(token 驗證+強度計)全完整;NotFound 靜態。

### 3.8 認證/RBAC/Credits 體系現況(細節見 02-fullstack)
- Google OAuth ✓、本地帳密(scrypt)✓、2FA TOTP ✓、密碼重設 ✓(email 無 SMTP 時僅 console 預覽)
- **Email 驗證=半成品未接線**(表+模板存在,無任何路由呼叫)
- **refresh token 輪替=程式完整、預設 OFF**
- **admin 角色來自 email allowlist(含硬編碼)**(localAuth.ts:89-97)
- 資料層 RBAC(resource_shares):寫入已上線,**enforcement 旗標 ENABLE_DATA_RBAC 預設 OFF**
- Credits=內部點數(users.remainingGenerations,default 50);**Stripe webhook 為骨架(handler 全 TODO)、plans 無購買 UI→訂閱體系未啟用**

---

## 4. 跨 shell 脊椎頁

### 4.1 AssetsLibrary(/assets)

| 功能 | 現況 | 證據 |
|---|---|---|
| 數位資產庫(my/team、篩選、無限捲動、上傳、共享、刪除含 R2 級聯) | 完整 | AssetsLibrary.tsx:317-555 |
| 個人資料庫分頁(?top=personal_db) | 完整 | :477-482 |
| **?section= 聚合(prompts/collection/vault/tasks/drive)** | **死碼**:getInitialSection() 寫死回 "assets",五個分支永不觸發——`/vault` `/history` `/prompt-library` 等舊路由 redirect 進來後**落在預設資產頁,不會開對應分頁** | AssetsLibrary.tsx:241-244,474 |
| history 檢視(?view=) | 半成品(HistoryPage 死 lazy import,無 render 分支) | assetsLibraryRouteState.ts:44-48 |

被 redirect 的五個舊頁(HistoryPage/VaultPage/PromptLibraryPage/PromptCollectionPage/BackgroundTasksPage)**本體功能各自完整**,但除 Playground 掛 PromptLibraryPage 外,經 UI 已不可達(接線落差)。

### 4.2 ModelsPage(/models,LoRA 中心)
我的/團隊模型、雙引擎訓練(replicate 預設/fal)、**Consent 同意書閘門**(人像/版權素材必附有效同意,model_training_consents)、重訓/狀態同步、圖片自動標註/補角度(fal nano-banana/edit)全完整;LoraTrainer 舊頁仍被 ModelsPage 內部 lazy 復用。

### 4.3 SharedSpace(/shared)
團隊共享資產+模型總覽、直送工作室(sessionStorage payload+routeForModality)完整;模型偏好記錄 agent_model_picks。

### 4.4 NotesPage(/notes)
筆記/腳本/行事曆三型 CRUD+ICS 匯出/訂閱(feed token 可輪替)完整 → `project_notes_calendar`;CalendarPage 被頁內分頁復用(/calendar 路由已 redirect)。

### 4.5 CreativeProjectPage(/creative-projects)+ ProjectsList/Detail(/projects)
創作專案 CRUD/複製/資源連結+世界觀/分鏡關聯完整 → `creative_projects`;/projects 雙頁與 /creative-projects 同資料不同視角(過渡並存,App.tsx:261-263 註解自承)。

### 4.6 AgentChat(/agent)
全頁光球:聊天/工具/多代理/精靈/對話持久化完整;**「串流」為輪詢模擬非 SSE**;navigate 真導航、submit 走確認閘。

### 4.7 FocusFlow(/focus-flow)、Unorganized(/unorganized)、ProcessViewer(/process)
三頁皆純前端零後端:FocusFlow 番茄鐘/呼吸/想法(重整即失);Unorganized=appRegistry 導航頁;ProcessViewer=?spec= base64 流程檢視器。前端層面完整。

---

## 5. social shell(4 頁,預設整殼停用)

`SHELL_SOCIAL` 預設 OFF → ShellFrame 顯示「🚫 已關閉」佔位。

| 頁 | 現況 |
|---|---|
| SocialCockpit(/social) | 真後端接縫(news/director/promptLibrary),頁面預設不可達 |
| SocialStudio(/social/studio) | 真後端接縫(生成+recordGenResult) |
| SocialBrand(/social/brand) | **半成品**:純客戶端 state+靜態 STYLE_COMBOS,save 只 toast |
| SocialPublish(/social/publish) | **Mock**:posting adapter 預設 mock(記憶體 Map、假 permalink);postiz stub 丟錯「尚未接線」;server 無任何 posting router |

---

## 6. 全域系統(細節接線見 02-fullstack)

| 子系統 | 現況摘要 |
|---|---|
| 光球本體(ProactiveOrbWidget→OrbGuidePanel→OrbUnifiedAssistant) | 完整;第二顆 AidvOrbMount=視覺半成品;OrbFloatButton=死碼;4 張 orb-agent 卡(CostGate/PerceptionVerdict/StepByStepConfirm/PreferenceNudge)=孤兒 |
| 光球對話/任務 | ai.chat(brainProcedure)+chatProgress 輪詢;orbTask FSM **in-memory(重啟即失)**;slash commands 25 精靈指令(無專屬後端,翻譯成既有方法) |
| 導航 chrome | 雙軌:AidvShellChrome(預設)vs AppleDock(舊,僅白名單 4 頁);appRegistry admin group=死碼 |
| CommandPalette / SiteOnboarding / FocusFlow / Ambient / Theme / Personality | 完整,幾乎全純前端(localStorage);Ambient 為程序化合成音(外部音檔佔位) |
| WorldContext / ProjectsProvider | 完整,真接 creativeProject/worldbuilding |
| 抽屜(Notes/Assets/BackgroundTasks) | Notes/Assets 完整;BackgroundTasksDrawer 元件孤兒(Context 完整運作) |
| SSE/WS | generation/model-training/heartbeat/admin 四通道完整;agent-events 兩通道**前端死碼**;統一 /api/sse 預設雙端 OFF;WS 僅 orb-voice |
| Quick Feedback 浮鈕 | 完整(ENABLE_QUICK_FEEDBACK 預設 ON) |

## 7. 全站「非完整」項目彙總(給後續 C/D/F 引用)

**死碼/孤兒**:OrbFloatButton;AssetsLibrary section 聚合(5 分支)+HistoryPage view;App.tsx 死 lazy import(CalendarPage/LoraTrainer);ImageStudio 前端同步落庫鏈;export router;agent-events SSE×2;BackgroundTasksDrawer;appRegistry admin group 過濾;4 張 orb-agent 卡;DashboardLayout AppleDock 群組 flyout(SIDEBAR_GROUPS=[])。

**半成品**:LightOrbCreationStudio 整頁(純演示);Commander/IntentComposer(skeleton);LearnHub 影片/測驗(ephemeral)+cron 文件不落 DB;AIModelsHub 研究排程(記憶體);TeamsPage 看板+成員治理缺口;SocialBrand/SocialPublish;Email 驗證;Stripe/訂閱;DirectorAI 里程碑/世界注入/語音克隆;RealEarth 前端接線;AidvOrbMount;Ambient 外部音檔;ProStudio TTS speed 未送後端;feedback 擴充欄位本頁不送。

**預設 OFF 的整塊功能**(旗標):SHELL_SOCIAL、ENABLE_DATA_RBAC(enforcement)、ENABLE_REFRESH_TOKEN_ROTATION、UNIFIED_SSE_ROUTER、ENABLE_PROMPT_VAULT、TEAMS_COLLAB、VIDEO_SPINE_MOCK 相關 7 個 video 旗標(WORLD_STYLE_INJECTION/PROJECT_HUB/GATE_KIT/VOICE_MUSIC_WORKFLOW/SUBSYSTEM_REAL_DATA)、ENABLE_ORB_QUOTA_GUARD/IDEMPOTENCY_GUARD/BUDGET_GUARD、ENABLE_COST_LEDGER、ENABLE_CODEX_TASKS、ENABLE_DIRECTOR_WORLD_CONTEXT。

## 8. 缺讀聲明(彙總)
VideoCockpitFrame 內部、Studio.tsx 積木編輯器 UI、AnimationStudio 時間軸 UI、VideoStudio 佇列面板 UI、AdminPage 各 TabsContent 完整 JSX、Home.tsx 展示區、CalendarPage/LoraTrainer 內部子功能、OrbGuidePanel/ProactiveOrbWidget/GlobalOrbChatContext 內部全部子功能、ai.chat 主體(ai.ts:434-1900)、components/orb/ 12 檔、learnHub.seed.ts 種子內容——以上未逐行讀;各節結論皆以已讀部分+行號證據為限。
