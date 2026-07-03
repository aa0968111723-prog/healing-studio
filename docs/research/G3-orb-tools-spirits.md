# G3 — 光球工具全清單 × 25 精靈能力表 × 光球前端子功能(補洞 wave G)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`(工作樹 HEAD `fb4358d8` 僅多出 docs/research commits,程式碼同源)
- 波次:**補洞 wave G**
- 共同依據:`00-overview.md`(詞彙)、`02-fullstack.md` §7(光球前後端接線,不重複)、`E-ai-agents.md`(ai.chat 管線/邊界結論,不重做)
- 方法:實讀 `server/services/agentToolExecutor.ts`(8,087 行)、`shared/global-agent-tools.ts`、`server/services/spiritTools/`(30 檔)、`server/services/spiritDispatcher.ts`、`shared/orb-agent-roles.ts` / `spirit-chat-tools.ts` / `spirit-handoff-protocol.ts`、`spiritMemoryManager.ts`、`client/src/components/orb/`(12 檔)+ `OrbGuidePanel.tsx`(4,883 行)+ `ProactiveOrbWidget.tsx`(4,160 行);**關鍵路由結論以臨時 vitest probe 實測驗證**(對 `executeOrbToolCalls` 直接餵工具呼叫觀察回傳,probe 檔已刪不留 repo)

---

## 0. 本文件最重要的一個發現(先講結論)

**agentToolExecutor.ts 的 194 個 case 工具中,只有 37 個真的可達;其餘 178 個 `<spirit>.<tool>` 橋接是「寫好了但入口沒接」的孤兒程式碼。**

`executeOrbToolCalls`(:533,全系統唯一工具執行入口;呼叫者=orbTaskOrchestrator:290、ai.executeTools:3032、orbWorkflowEngine:530、planExecutorTools:311)的路由分支**只有六條**(:545-744,經逐行+node 掃描確認):

1. `call.name === "research.deepSearch"` → Perplexity 深搜(含 orbToolRetry 重試)
2. `call.name === "research.compareModels"` → 站內模型目錄結構化比較(純資料)
3. `call.name === "inspiration.fetch"` → Perplexity Sonar 靈感/時事
4. `startsWith("db.")` → `dispatchDatabaseTool` → orbDatabaseTools 安全查詢(13 個模板)
5. `startsWith("studio.")` / `startsWith("director.")` → `dispatchStudioTool` / `dispatchDirectorTool`
6. 其餘 → 外部工具 registry(`ORB_TOOL_REGISTRY_JSON` env 宣告,**預設空**)→ 查無即 `tool-not-found`

而 `dispatchStudioTool` 內的巨型 switch(:1048-2829)除了 16 個 `studio.*`,還寫了 **178 個精靈工具 case**(`accountant.*`、`critic.*`、`orchestrator.*`、`notesCurator.*`…)——但入口 gate 只放行 `studio.`/`director.` 前綴,這些 case **永遠不會被命中**。實測證據(vitest probe,已復現):

| 呼叫 | 實測回傳 |
|---|---|
| `studio.generateImage`(approved:false) | `confirmation-required` ✅ 有到橋接、風險閘生效 |
| `critic.review` | **`tool-not-found`** ❌ |
| `accountant.estimate` | **`tool-not-found`** ❌ |
| `orchestrator.getTeamStatus` | **`tool-not-found`** ❌ |
| `teachingArchive.search` | **`tool-not-found`** ❌ |
| `db.list_my_assets` | `DB unavailable`(測試環境無 DB)✅ 有到 db dispatcher |

`git log -L` 追該 gate 行歷史:從 `f1c9a838`(只有 studio.)到 `7fd4fe96`(加 director.)**從未**包含精靈前綴;後續各「Make XX a real AI agent」commit(如 915e4901 品品)只往 switch 加 case、沒改 gate。相關單元測試(tests/unit/server/planExecutorTools.test.ts 等)全部 **mock 掉 executeOrbToolCalls**,所以測不到這個斷點。

**後果鏈**:
- `shared/orb-agent-roles.ts` 的人格切片明文教 LLM「說『我來看看』就要真的呼叫 critic.review,否則只是空話」(:1349-1356)、`spiritPromptEnhancer.ts:105` 教總總呼叫 `orchestrator.getTeamStatus` —— LLM 照做後,planner 會通過(115 個此類工具**有註冊**在 global-agent-tools registry,`isKnownGlobalAgentTool` 放行),**執行時卻 tool-not-found**。
- 63 個 case 連 registry 都沒註冊(orchestrator/videoSpecialist/voiceSpecialist/learningSpecialist/legalAdvisor/securityGuard/communityManager/onboardingCoach/companion/teachingArchive),即使修好 gate 也會先撞 `dispatchStudioTool` 開頭的 `studio-tool-not-registered` 檢查(:991-997)——**雙重孤兒**。
- 反向缺口:registry 另有 9 個工具(`media.*` 5、`github.*` 2、`deploy.preview`、`code.modifyWithClaudeCode`)**沒有任何 executor case**。`code./github./deploy.` 由 ai.ts:2500 偵測後改走 claudeCode 任務交接(有活路);但 `media.*` 完全沒有執行路徑——而 **agentPlanner.ts:529-530 的 prompt 還在教 LLM 串 `media.transcribe → media.caption`**。
- 部分能力有「替代活路」不受影響:@精靈聊天直呼 `trpc.spirit.invoke`(spiritDispatcher→fal,不經這些 case)、財財/音音的 tRPC router(accountant.ts / musicSpecialist.ts 與 spiritTools 共用實作)、步步的 `trpc.spirit.plan/run`(planExecutorTools 自己執行,只把**步驟內**工具送 executeOrbToolCalls——所以步步計畫裡的 studio.* 步驟能跑、critic.* 步驟會失敗)。

> 修法(一行級):把 gate 改成 `isKnownGlobalAgentTool(call.name)` 或補齊前綴白名單,並把 63 個未註冊工具補進 GLOBAL_AGENT_TOOL_REGISTRY;同時給 executeOrbToolCalls 補「不 mock 的路由 reachability 測試」。

---

## 1. 光球工具全清單(agentToolExecutor.ts,8,087 行)

### 1.1 執行層共通機制(所有工具共享)

| 機制 | 實作 | 證據 |
|---|---|---|
| 封鎖清單 | `opts.blockedTools` 逐呼叫檢查 → `tool-blocked-by-user` | :546 等每分支 |
| 稽核 | 每次呼叫(成敗皆)發 `onAuditEvent` → orbToolCallLogStore + specialist 互動記憶 | :558-571 |
| 生成額度 | `GENERATION_SLOT_TOOLS`(15 個 studio.*)過 `checkAndConsumeQuota("generation")` | :15-31、:1015 |
| 每步內容審核 | DEF-AG3:step 的 prompt/text/script/lyrics/negative_prompt 逐欄過 `moderateOrbContent`,block 直接擋(否則原文進 fal/Suno/ElevenLabs) | :1028-1046 |
| 引擎解析 | `resolveOrbEngine`:呼叫端指定 modelId > 使用者大腦 slot(image/video/audio/voiceEngine)> hardcoded fallback | :58-74 |
| fal 等待 | `awaitFalForOrb`:120s 預算等 queue 完成,逾時回 `pending`+request_id;完成後 postgen 寫資產庫/歷史(F2/F6) | :41、:108-238 |
| 外部工具 | env `ORB_TOOL_REGISTRY_JSON`(zod,≤64 個,riskLevel/allowedRoles/requireConfirmation/fallbackTools);連外必過 `ORB_TOOL_ALLOWED_ORIGINS`(prod fail-closed);`executeWithRecovery` 指數退避重試(上限 8s)+ fallbackTools 降級;啟動自檢 `runOrbToolExecutorStartupSelfCheck` | :348-530 |

### 1.2 實際可達的內建工具(37 個)——權威表

#### studio.*(16 個,`dispatchStudioTool`;風險級取自 GLOBAL_AGENT_TOOL_REGISTRY)

| 工具 | 用途 | 風險/需確認 | 對應服務/資料表 |
|---|---|---|---|
| studio.generateImage | 文生圖/圖生圖/編輯/放大/骨骼姿勢(依 args 走 `resolveImageGenRouting` 自動分流),支援 LoRA 注入(`${stepN.lora_url}`)/ControlNet/seed | medium/**要確認**;耗 generation 額度 | falDispatcher→fal.ai;postgen 寫 digital_asset_library、generation_history |
| studio.generate3D | 圖生 3D / 文生 3D | medium/要確認;耗額度 | falDispatcher |
| studio.generateVideo | 文生影/圖生影(t2v/i2v),modelId 缺省讀大腦 videoEngine | medium/要確認;耗額度 | falDispatcher;background_jobs |
| studio.enhanceVideo | 影片畫質增強/放大 | medium/要確認;耗額度 | falDispatcher |
| studio.generateAudio | 音樂生成;requestedModel 以 `suno` 開頭時改走 SunoClient(建 background_jobs、webhook 回寫) | medium/要確認;耗額度 | falDispatcher / SunoClient+webhookSuno;background_jobs |
| studio.generateSfx | 音效生成 | medium/要確認;耗額度 | falDispatcher |
| studio.generateVoice | TTS 配音(ElevenLabs/Qwen-TTS 經 fal;特判 fal-ai/elevenlabs/tts/*) | medium/要確認;耗額度 | falDispatcher |
| studio.cloneVoice | 聲音複製 | medium/要確認;耗額度 | falDispatcher |
| studio.designVoice | 聲音設計(文字描述→聲線) | medium/要確認;耗額度 | falDispatcher |
| studio.separateStems | 分離人聲/樂器 stems | medium/要確認;耗額度 | falDispatcher |
| studio.isolateAudio | 人聲隔離/降噪 | medium/要確認;耗額度 | falDispatcher |
| studio.mergeAudios | 多段音檔合併(strategy=concatenate 對白接龍) | medium/要確認;耗額度 | falDispatcher |
| studio.changeVoice | 變聲(voice-to-voice) | medium/要確認;耗額度 | falDispatcher |
| studio.animateSpeaker | 靜態人像→說話影片(對嘴) | medium/要確認;耗額度 | falDispatcher |
| studio.transcribe | 語音轉文字 | low/免確認(不耗額度) | falDispatcher(audio-to-text) |
| studio.trainLora | LoRA 訓練:先寫 fine_tuned_models+background_jobs 再非同步輪詢回寫(`dispatchTrainingTool`,STEPS_PER_EPOCH=100) | **high**/要確認;耗額度 | falDispatcher(training);fine_tuned_models、background_jobs |

#### director.*(5 個,`dispatchDirectorTool`;導導的規劃工具,全部 low/免確認、不耗額度)

| 工具 | 用途 | 對應服務 |
|---|---|---|
| director.suggestPlan | 一句話→invokeLLM 產工作室執行計畫(唯一打 LLM 的 director 工具,:7499) | invokeLLM |
| director.composeWorkflow | 純資料組多步跨頁 workflow(brief→steps+下一棒 handoffs) | spiritTools/directorTools.composeWorkflow |
| director.estimateBudget | 估整條 workflow 總點數+省錢替代 | directorTools(接 modelPricing) |
| director.suggestHandoff | 依 SPIRIT_COLLAB_PROTOCOL 挑下游精靈 | directorTools |
| director.refineWorkflow | 依回饋修既有 workflow | directorTools |

#### db.*(13 個,`dispatchDatabaseTool` → orbDatabaseTools.ts,629 行;**全部 user-scoped、預定義模板、只允許 SELECT**,低風險免確認)

| 工具 | 查什麼(對應資料表) |
|---|---|
| db.list_my_assets / db.search_my_assets / db.get_recent_assets | digital_asset_library |
| db.list_my_notes / db.search_my_notes / db.get_calendar_events | project_notes_calendar |
| db.get_generation_history / db.get_recent_generations | generation_history |
| db.list_my_jobs / db.get_active_jobs | background_jobs |
| db.list_my_models | fine_tuned_models |
| db.get_my_brain_config | user_ai_brain |
| db.list_my_scheduled_jobs | orb_scheduled_jobs |
| db.search_prompts(唯一非 user-scoped) | prompt_library |

#### 具名研究工具(3 個,main loop 直判)

| 工具 | 用途 | 風險 | 對應服務 |
|---|---|---|---|
| research.deepSearch | Perplexity 深度網搜(查查),含 withToolRetry 重試 | low | dispatchDeepSearchTool→perplexity;過 perplexityThrottle |
| research.compareModels | 站內 MODEL_PRICING_CATALOG 結構化比較(純資料不打 LLM) | low | dispatchCompareModelsTool→modelPricing |
| inspiration.fetch | Perplexity Sonar 即時靈感/時事/社群偏好(靈靈) | low | dispatchInspirationTool→inspirationFetcher |

### 1.3 已寫好但入口不通的 178 個精靈工具(完整清單,依檔內分區)

> 「註冊」= 在 GLOBAL_AGENT_TOOL_REGISTRY(148 entries)有 riskLevel/requiresHuman 定義,planner 看得見。「─」= 未註冊(雙重孤兒)。所有用途取自各 dispatch 函式 docstring 與 spiritTools 檔頭。

**accountant.*(財財,9 個,全註冊 low;dispatchAccountantTool→spiritTools/accountantTools,接 modelPricing+apiUsageLogs,全唯讀)**
estimate(精算單次任務點數)、compare(同類別全模型點數比較)、usage(近 30 天用量摘要)、savings(可替換省法+省點估算+tier 風險)、workflowEstimate(整條 workflow 估價)、budgetForecast(預算預測)、budget(預算檢視)、trend(用量趨勢)、forecast(花費預測)。⚠️ 前 4 個與 `trpc.accountant.*` 共用同一實作(該 router 可用,故財財對「使用者」仍有活路;死的是「LLM 自主呼叫」)。

**critic.*(品品,5 個,全註冊 low;dispatchCriticTool→criticTools,純確定性 rubric 不打 LLM)**
review(模態 rubric→亮點+改進+分維分數+建議交棒)、score(0-100 加權分+弱維度)、compare(多輪迭代排名+進退步維度)、suggestRewrite(1-3 條可貼提示詞改寫,每條只動 1-2 維)、planHandoff(評審後交棒決策)。

**orchestrator.*(總總,11 個,**未註冊**;dispatchOrchestratorTool→orchestratorTools)**
getTeamStatus(25 精靈即時狀態+卡點)、getSpiritStatus(單精靈狀態)、delegateTask(派工)、queryProgress(查進度)、escalateIssue(升級問題)、getStatistics(統計)、decomposeGoal(目標拆解)、recommendSpirit(推薦精靈)、analyzeBottlenecks(瓶頸分析)、retryWithFallback(降級重試)、setDeadline(設期限)。

**notesCurator.*(記記,14 個,全註冊;deleteNote=medium 其餘 low;→notesCuratorTools,同源 project_notes_calendar+digital_asset_library)**
createNote/searchNotes/listNotes/updateNote/updateNoteStatus/deleteNote(筆記 CRUD)、scheduleTask/scheduleEvent/listUpcoming(待辦/行事曆)、summarizeRecent(近況摘要)、tagAssets/categorizeAsset/searchAssets/getAssetStatistics(素材庫管理)。

**settingsDetail.*(細細,13 個,全註冊;update/bulk/applyPreset/reset=medium 其餘 low;→settingsDetailTools,讀寫使用者偏好)**
getPreferences/getAllSettings/searchSettings/explainSetting(讀+解釋)、updatePreference/bulkUpdate/resetPreference/applyPreset/listPresets(寫+預設組)、validatePreference/previewDiff(改前驗證/預覽)、detectInconsistencies/recommendOptimizations(健檢)。

**imageSpecialist.*(圖圖,7 個,全註冊;generate/edit/upscale=medium 其餘 low;→imageSpecialistTools→dispatchGenerationJob)**
generate(文生圖)、edit(圖編輯)、upscale(放大)、getModels(真實 catalog 模型清單)、recommendModel(選模)、enhancePrompt(提示詞強化)、getTips(技巧)。

**videoSpecialist.*(影影,9 個,**未註冊**;→videoSpecialistTools,自動辨識 t2v/i2v/v2v/對嘴/畫質)**
generate(主入口,自動選 t2v/i2v/v2v,等完成回 video_url)、imageToVideo、enhance、lipSync、planWorkflow(影片工作流規劃)、estimateCost、getModels、recommendModel、getTips。

**voiceSpecialist.*(聲聲,12 個,**未註冊**;→voiceSpecialistTools,懂語言/性別/情緒/語速選聲線)**
generateSpeech(主入口,自動依語言挑引擎+情緒標籤)、cloneVoice、designVoice、changeVoice、generateSfx、transcribe、getVoices/pickVoice(聲線庫+挑選)、getEmotionTags、planVoiceover(配音規劃)、recommendModel、getTips。

**musicSpecialist.*(音音,9 個,全註冊;generate/generateSoundEffect=medium 要確認,其餘 low;→musicSpecialistTools)**
generate、generateSoundEffect、recommendEngine(挑引擎)、listEngines、buildPrompt(model-specific 提示詞)、estimateCost、getRecentAssets(掃素材庫)、getOptions、getTips。⚠️ recommendEngine/listEngines/estimate/getRecentAssets 與 `trpc.musicSpecialist.*` 共用實作(router 活路)。

**trainingSpecialist.*(練練,6 個,全註冊 low;→trainingSpecialistTools)**
listMyModels(已訓模型)、getModelStatus、analyzeDataset(資料集夠不夠)、recommendParams(訓練參數)、estimateTraining(估時/估點,對齊 executor STEPS_PER_EPOCH 算法)、getTips。

**learningSpecialist.*(學學,9 個,**未註冊**;→learningSpecialistTools,真搜 LearnHub docs/videos/quizzes)**
searchLearningContent、getTutorial/listTutorials、explainConcept、generateLearningPath、getNextLearningStep、getUserLearningProgress、recommendForContext、getQuickTips。

**legalAdvisor.*(律律,3 個,**未註冊**;→legalAdvisorTools)** checkCompliance(內容合規)、checkLicense(素材授權)、getGuidelines(法遵指引)。
**securityGuard.*(安安,4 個,**未註冊**;→securityGuardTools)** checkHealth、scanSecurity、reportIssue、getRecommendations。
**communityManager.*(群群,7 個,**未註冊**;→communityManagerTools,6 純函式+1 平台元資料)** buildPostPlan、formatCaption、recommendHashtags、planWeeklySchedule、critiqueHook、nextClarification、listPlatforms(IG/TikTok/小紅書/YT/FB/LinkedIn × 年齡層)。
**onboardingCoach.*(帶帶,3 個,**未註冊**;→onboardingCoachTools)** startOnboarding、trackProgress、getQuickStart。
**companion.*(暖暖,4 個,**未註冊**;→companionTools,結構化情緒/意圖)** detectMood、clarifyIntent、recommendNextSpirit、calmBreak。
**qualityCoach.*(巧巧,4 個,全註冊 low;→qualityCoachTools,接 shared/qualityCoachEngine 確定性診斷)** diagnose、rewrite、compare、getTemplates。
**inspirationSpecialist.*(靈靈,8 個,全註冊 low;→inspirationSpecialistTools,searchTrends 真接 Perplexity)** searchTrends、getSuggestions、analyzeReference、buildMoodBoard、getStyleAtlas、getStyleMixing、refinePromptVariants、rankStylesByIntent。
**anatomySpecialist.*(體體,8 個,全註冊 low;→anatomySpecialistTools)** parseIntent、nextClarification、buildPrompt、buildMultiViewBatch(多視角批次)、labelChecklist(標註檢查表)、verifyResult、recommendModels、summarize。
**planExecutor.*(步步,9 個,全註冊;planFromGoal/createPlan/runPlan/replanOnFailure=medium 要確認;→planExecutorTools)** planFromGoal(自然語言→AgentPlanV3,呼叫 agentPlanner)、createPlan、runPlan、executeStep、getStatus、controlPlan(pause/resume/cancel)、listRuns、replanOnFailure、getTemplates。⚠️ 真正活路是 `trpc.spirit.plan/run/status/control/replan`(spiritRouter 直呼 planExecutorTools,不經 executor case)。
**memoryManager.*(4 個,註冊 low;→memoryManagerTools;無對應 AgentRole 的共用工具組)** storeMemory、searchMemories、getStats、consolidate。
**clarificationEngine.*(4 個,註冊 low;意圖澄清與使用者模式學習)** identifyIntent、recordAnswer、getPattern、getStats。
**featureDiscovery.*(5 個,註冊 low;功能使用追蹤/推薦)** recordUsage、recordDiscovery、getStats、getRecommendations、getInsights。
**workflowEngine.*(6 個,註冊;createTemplate/executeWorkflow/controlWorkflow=medium;→workflowEngineTools→orbWorkflowEngine)** createTemplate、getTemplates、executeWorkflow、getStatus、controlWorkflow、getHistory。
**systemMonitor.*(4 個,註冊 low;監控/成本分析)** getHealth、getCostAnalysis、getCollaborationStats、getPerformanceTrends。
**teachingArchive.search(1 個,**未註冊**;→teachingArchiveSearch,RAG 素材池檢索;檔頭自述「給 router.search 和 orb tool 用」——router 半邊活、orb tool 半邊死)**

### 1.4 registry 有、executor 沒有的 9 個(planner 看得到、執行層無 case)

| 工具 | 風險 | executionTarget | 實際去向 |
|---|---|---|---|
| media.transcribe / media.caption / media.storyboard / media.summarizePdf / media.extractPrompt | medium×4+low | external/server-side | **無任何執行路徑**;agentPlanner.ts:529 卻教 LLM 串 media.transcribe→caption |
| github.review / github.pr.create / deploy.preview / code.modifyWithClaudeCode | 全 high/要確認 | claudeCode/external | ai.ts:2500 偵測到即改走 createOrbCodeTask(claudeCode 交接),不進 executor |

> 統計:executor case 194(studio 16+精靈/共用 178)+ director 5(if-chain)+ db 13 + 具名 3 = 215 個內建工具面;GLOBAL_AGENT_TOOL_REGISTRY 148(E 文寫 151,實數 148,勘誤);兩邊交集且可達=37。

---

## 2. 25 精靈能力表

### 2.1 總表(名字×模態×路徑×模型×工具×交棒)

先修正詞彙:`AgentRole` union 實為 **25 值**(E 文寫「26 值」為誤植);`SPIRIT_FAMILY` 三族 = 原「15 精靈」(6 專精+6 通用+3 主動)+ 10 位新增。@聊天路徑取自 `shared/spirit-chat-tools.ts`(客戶端 `@暱稱` 攔截表);LLM hint 取自 `SPIRIT_PREFERRED_PROVIDER`(僅偏好,selectProvider fallback 鏈仍生效);fal 白名單取自 `SPIRIT_MODEL_CAPABILITIES`(spiritDispatcher.canSpiritCallFalModel 強制);工具欄「✗入口」= §1.3 的不可達橋接。

| 精靈 | role | 族 | @聊天路徑 | LLM hint | fal 類別白名單 | 專屬工具(數/註冊/可達) | 交棒下游(SPIRIT_COLLAB_PROTOCOL 前 3) |
|---|---|---|---|---|---|---|---|
| 導導 | director | 通用 | llm-persona | gemini | LLM/JSON(不生內容) | director.* 5/✓/**✓可達** | 步步、編編、財財 |
| 編編 | composer | 通用 | **page-execution**(當頁解析一句話→AgentAction[] dispatch;≥4 字) | default_llm | **全類別**(ALL_CATEGORIES) | page.*(客戶端);composerTools 檔頭自述「無 router wiring、給未來端點」→**未接線** | 品品、巧巧、財財 |
| 品品 | critic | 通用 | llm-persona | gemini | LLM/JSON+圖像/影片/音訊分析類 | critic.* 5/✓/✗入口 | 編編、巧巧 |
| 查查 | researcher | 通用 | **search**(≥3 字打 orbProxy.unifiedSearch) | gemini | LLM/JSON | research.deepSearch+compareModels 2/✓/**✓可達** | 導導、財財、記記 |
| 路路 | navigator | 通用 | **navigate**(intentBased,detectNavIntent 推目的地) | default_llm | 僅 llm | 無 | 編編、學學、導導 |
| 暖暖 | companion | 通用 | llm-persona | default_llm | 僅 llm | companion.* 4/─/✗入口 | 導導、路路、學學…(下游最多樣,11 個) |
| 圖圖 | image-specialist | 專精 | **fal-generation**(≥6 字直打 trpc.spirit.invoke) | gemini | t2i、i2i、i23d、t23d、image-to-json | imageSpecialist.* 7/✓/✗入口 | 編編、影影、品品 |
| 影影 | video-specialist | 專精 | fal-generation | gemini | t2v、i2v、v2v、video-to-text、video-to-audio | videoSpecialist.* 9/─/✗入口 | 聲聲、音音、品品 |
| 音音 | music-specialist | 專精 | fal-generation | gemini | text-to-audio | musicSpecialist.* 9/✓/✗入口(4 個另有 tRPC router 活路) | 影影、品品 |
| 聲聲 | voice-specialist | 專精 | fal-generation | gemini | text-to-speech、audio-to-text | voiceSpecialist.* 12/─/✗入口 | 影影、音音 |
| 練練 | training-specialist | 專精 | fal-generation | gemini | training | trainingSpecialist.* 6/✓/✗入口;studio.trainLora 可達 | 圖圖、品品、編編 |
| 學學 | learning-specialist | 專精 | **navigate**(→/learn-hub,passPromptAsSearch 帶 ?search=) | default_llm | LLM/JSON | learningSpecialist.* 9/─/✗入口 | 路路、暖暖、體體 |
| 財財 | accountant | 主動 | llm-persona | default_llm | LLM/JSON | accountant.* 9/✓/✗入口(4 個另有 public tRPC 活路) | 查查、編編、細細 |
| 巧巧 | quality-coach | 主動 | llm-persona | gemini | LLM/JSON | qualityCoach.* 4/✓/✗入口 | 編編、品品、圖圖 |
| 守守 | inspector | 主動 | llm-persona | gemini | LLM/JSON | **無專屬檔**(securityGuardTools 檔頭誤標「守守」實屬安安) | 路路、學學、導導 |
| 律律 | legal-advisor | 主動 | llm-persona | gemini | LLM/JSON | legalAdvisor.* 3/─/✗入口 | 巧巧、查查、細細 |
| 安安 | security-guard | 主動 | llm-persona | gemini | LLM/JSON | securityGuard.* 4/─/✗入口 | 細細、守守 |
| 群群 | community-manager | 專精類 | llm-persona | gemini | LLM/JSON+image-to-json/video-to-text+**t2i/t2v**(可產社群素材) | communityManager.* 7/─/✗入口 | 圖圖、影影、記記 |
| 總總 | chief-orchestrator | 通用類 | llm-persona | gemini | LLM/JSON(純規劃不執行) | orchestrator.* 11/─/✗入口 | **全員 20 個下游**(調度表最長) |
| 帶帶 | onboarding-coach | 主動 | llm-persona | default_llm | LLM/JSON | onboardingCoach.* 3/─/✗入口 | 路路、學學、守守 |
| 記記 | notes-curator | 通用類 | **navigate**(→/notes) | default_llm | LLM/JSON | notesCurator.* 14/✓/✗入口 | 編編、查查、財財 |
| 細細 | settings-detail | 通用類 | llm-persona | default_llm | LLM/JSON | settingsDetail.* 13/✓/✗入口 | 安安、財財 |
| 步步 | plan-executor | 通用類 | **agent-plan**(≥6 字:spirit.plan 預演卡→▶開跑→1.5s 輪詢 status→失敗給替代/跳過/中止按鈕打 replan) | gemini | **全類別**(workflow owner) | planExecutor.* 9/✓/✗入口;但 spirit.plan/run tRPC 直達可用 | 財財、編編、品品 |
| 靈靈 | inspiration-specialist | 專精類 | llm-persona | gemini | LLM/JSON | inspirationSpecialist.* 8/✓/✗入口;inspiration.fetch 可達 | 圖圖、影影、音音 |
| 體體 | anatomy-specialist | 專精類 | fal-generation | gemini | t2i、i2i、image-to-json、t23d、i23d | anatomySpecialist.* 8/✓/✗入口 | 品品、編編、導導 |

### 2.2 生成授權與呼叫鏈(「圖圖只能打圖」的強制點)

`spiritDispatcher.invokeSpiritModel`(spiritDispatcher.ts:117)三道閘,**這裡才是真正生效的模態限制**:

1. 缺 modelId → `pickDefaultModelForSpirit`(有 imageUrl 偏好 image-to-*,否則 text-to-*);挑不到(暖暖/路路這種無 fal 模型的精靈)直接 fail-fast「精靈 X 沒有可呼叫的 fal 模型」。
2. M15 fail-fast:category 需要的輸入缺了就先擋(image-to-* 要 imageUrl、video-to-* 要 videoUrl、audio-to-text 要 audioUrl),不讓使用者等 30 秒拿到不相干輸出。
3. `canSpiritCallFalModel`(查 SPIRIT_MODEL_CAPABILITIES 類別白名單)→ 通過才 `dispatchFalTask`(真扣點、降級鏈、LangSmith)。

tRPC 面:`spirit.listModels/invoke/plan/run/status/control/replan/listRuns/runStep`(spiritRouter.ts,226 行,全 protectedProcedure;檔內註明 plan「真的會花點數/動工具」所以不做 public)。

### 2.3 精靈記憶

- `spiritMemoryManager.ts`(362 行,**Tier C 持久記憶**):`spirit_memories` 表,維度 (userId, agentId, memoryKey),4 型別 `preference / pattern / context / feedback`,confidence 0.00-1.00 隨使用成敗 ±weight(預設 0.1)調整,usageCount/lastUsedAt 追蹤;經 SpiritMemoryRepository(MySQL)。
- `specializedAgentMemoryStore.ts`:精靈互動事件流稽核(executor 的 onAuditEvent 也回灌:`recordToolAuditAsSpecialistInteraction`)。
- 分層依據:`server/services/memory/MEMORY_TIERS.md`(E 文 §5.2 已盤,不重複)。

### 2.4 交接協議(handoff)

- `shared/spirit-handoff-protocol.ts`(385 行,純 shared 資料結構):HandoffReason 6 種(task_complete/needs_expertise/error_escalation/user_request/parallel_work/quality_review)、HandoffStatus 5 態、`SharedAsset`(image/video/audio/voice/3d/text/lora,含 createdBy/purpose → 資產跨棒續傳)、`HandoffTaskContext`(originalIntent/completedSteps/remainingSteps/constraints)、HandoffChain/HandoffHistoryRecord/HandoffStatistics + createHandoff/validateHandoff 工具函式。消費者:agentCollaborationOrchestrator(執行)、總總(監控)、前端(顯示)。
- `SPIRIT_COLLAB_PROTOCOL`(orb-agent-roles.ts:2043 起):每角色「做完交給誰」明文表(见 §2.1 最後一欄;完整下游見程式碼,總總 20 個、導導 15 個、暖暖 11 個),三個讀者:AgentChat hint chip、collaborationOrchestrator 預設順序、主動精靈回合後 ping 下一棒。**純 data,實跑仍由 orchestrator 決定**(而多代理任務路徑 `ORB_MULTI_AGENT_ENABLED` 預設 OFF,E 文 §1.4)。
- @聊天側的輕量交棒:spirit-chat-tools 檔頭 —— 非 llm-persona 工具完成後,依 SPIRIT_COLLAB_PROTOCOL 給「下一棒建議按鈕」,按了把 `@下一位 …` 拼進輸入框。

### 2.5 暱稱漂移勘誤(文件/註解 vs 權威 SPIRIT_NICKNAMES)

| 檔案 | 寫的 | 正確(orb-agent-roles.ts:975) |
|---|---|---|
| legalAdvisorTools.ts 檔頭 | 「法法」 | legal-advisor=**律律** |
| onboardingCoachTools.ts 檔頭 | 「導導」(撞名 director!) | onboarding-coach=**帶帶** |
| agentToolExecutor.ts:6010 區段註解 | 「引引(onboarding-coach)」 | **帶帶** |
| securityGuardTools.ts 檔頭 | 「守守」 | security-guard=**安安**(守守=inspector) |
| memoryManagerTools.ts/executor:6641 | 「記記(memory-manager)」 | 記記=notes-curator;**memory-manager 不是 AgentRole**(共用工具組) |

另:`workflowAutomationTools.ts` 與 `workflowEngineTools.ts` 都包 orbWorkflowEngine,前者在 spiritTools 外**零 import**(孤兒重複);`errorHumanizer.ts` 是工具錯誤訊息中文化 helper(非工具)。

---

## 3. 光球前端子功能補完

掛載鏈(實證):DashboardLayout:944 `<ProactiveOrbWidget>`(user && 非 /agent)→ ProactiveOrbWidget:2680 `<OrbGuidePanel fullscreen>` → OrbGuidePanel:4319 `<OrbUnifiedAssistant>`(2,448 行)。全頁版 = /agent 的 AgentChat.tsx。

### 3.1 components/orb/ 12 檔逐檔

| 檔(行數) | 功能 | 現況 | 證據 |
|---|---|---|---|
| CollaborativeDiscussionLauncher(372) | 多代理「自動討論」設定面板:maxRounds slider、家族/個別精靈白名單、起跑精靈、額外 mute;進行中變「停止討論」;摺疊時只露 chip | **完整**(僅掛在 AgentChat 全頁,浮動面板沒有);後端 startAutoDiscussion 上限 3 輪/4 位、bus in-memory 單機(E §1.4) | 檔頭;AgentChat.tsx import;GlobalOrbChatContext:5910 |
| CollaborativeProgressPanel(243) | 討論進度視覺化:精靈頭像 pill(最近發言脈衝環/已發言全亮/未發言半透明)、第 X/Y 棒進度條、「下一位思考中…」打字指示、停止鈕 | **完整**;資料=collaborativeDiscussionMeta(discussion_turn 事件即時更新) | 檔頭;GlobalOrbChatContext:2291 |
| ConversationTabs(490) | 平行光球對話 tab bar:可捲動 tabs+⋯overflow dropdown+「+新對話」固定右側;同名「新對話」自動編 #2/#3(依建立順序穩定) | **完整**(僅 AgentChat 用;orbConversations 持久化) | 檔頭;AgentChat import |
| OrbActionFlow(285) | 把光球回覆的 AgentAction[] 渲染成「圖示流程圖」,替代抽象文字描述 | **完整**;Widget+GuidePanel 雙掛 | 檔頭;兩處 import |
| OrbCapabilitiesView(252) | 「光球能做什麼」能力卡手風琴+「試用」按鈕;資料=**靜態** `data/creativeCapabilities`,導航/auth 由父層負責 | **完整但純靜態**(非後端 capability registry;與 orbCapabilities router 無關,注意同名混淆) | :1-30 |
| OrbFeatureSpotlight(268) | 旋轉提示卡曝光隱形功能(搜尋快捷詞/PDF 匯出/shareViaLink/記憶儀表板);開 orb 一段時間才出現、一次一張、可略過/永久關、localStorage 跨 session | **完整**(純 React 無外部 hook) | 檔頭 |
| OrbMemoryDashboard(276) | 記憶儀表板:風格/平台/用途/偏好模型 chips,單顆 ✕ 刪除、「全部清掉」;信任感+控制感設計 | **完整**;orbProxy.getRememberedPreferences/listLearnedPatterns/removePreferenceValue/clearAllPreferenceMemory;三處掛載(Widget/AgentPreferencesPage/slash) | :67-82 |
| OrbSearchResultsCard(455) | unifiedSearch 結果 kind-tagged grid,點擊 wouter SPA 導航(繞過 chat 無 markdown parser 的限制) | **完整**;Widget+AgentChat 雙掛 | 檔頭 |
| OrbThinkingStepsPanel(334) | 歷史訊息的推理鏈滑入面板:①思考步驟卡(chain.sections)②行動軌跡 timeline(chain.actions,sanitize→research→plan→specialist→finalize);純展示零成本 | **完整**;資料已在 ChatMessage 上 | 檔頭 |
| OrbThinkingTimeline(131) | 進行中規劃的 inline 進度(Phase-1 thinking UX):ai.chatProgress ring buffer 400ms 輪詢,「檢查訊息中→規劃步驟中→整理回應」+specialist 交接 | **完整** | 檔頭;ai.ts chatProgress |
| OrbVoiceButton(98) | 語音對話按鈕:useOrbVoice 開 WS `/ws/orb-voice?token=`;色彩狀態機(紅=錯誤/紫=說話/藍=聆聽/橘=連線);transcript/回應/錯誤三種浮泡;voiceEnabled 偏好 gate(false 不 render 省連線)、voiceAutoActivate 一次性自動開麥 | **半成品邊緣**:①註解稱「Gemini Live socket」,實際後端 orbVoiceProcessor = **批次** whisper-1 STT→invokeLLM→ElevenLabs eleven_turbo_v2_5 TTS(turn-based,非 Live 串流);②client 監聽 `toolCall` 訊息型別但 gateway(133 行)從不發→`lastToolCall` 死欄位;③toggleMute 已寫、按鈕未接 | OrbVoiceButton:7-10;useOrbVoice:106;orbVoiceProcessor:21-118;orbVoiceGateway 全文 |
| OrbWorkflowDAG(224) | WorkflowExecutionState 以 @xyflow/react 垂直節點鏈視覺化:pending 淡出/running 青色脈衝/completed 綠勾/failed 紅 X/完成邊動畫,取代 5+ 步的線性列表 | **完整**;GlobalOrbChatContext 掛載 | 檔頭 |

語音底層補記:MediaRecorder webm/opus 250ms 切片上傳;gateway 驗 session token(拒 client 傳 userId)、64KB frame 上限、per-user 3 連線+全站 100、session 10 分鐘上限——與 02 §7 一致;新增事實:**這條語音鏈完全不接 15 精靈與工具執行**(generateOrbReply 只是裸 invokeLLM)。

### 3.2 OrbGuidePanel.tsx(4,883 行)— 先前未讀的內部子功能

| 子功能 | 內容 | 現況 |
|---|---|---|
| 引導流(wizard) | OrbGuideContext(1,147 行):step `idle→ask_detail→confirming→arrived`;`INTENT_CONFIGS` 7 個意圖(image/video/music/voice/script/lora/explore)各帶題組;答完產 GuidePlan(orbMessage+autoFillPrompt+目標頁)→confirmAndNavigate;到站 arrival banner+手動步驟 checklist(completedManualStepIds 可勾) | **完整**;:675 自註「下一步改 registry 驅動,逐步移除 INTENT_CONFIGS 重複定義」(known debt) |
| Phase 3d-hybrid LLM 軟化 | 每個 step 以 `trpc.orbGuide.step` 請 LLM 改寫題目語氣/補選項(mergedOptions=stock+extra)/建議跳題(canSkipNext→用第一個 stock option 推進,保證 prompt 合法);per-stepKey cache 防重 fire;LLM 失敗完全 fallback stock 不打擾 UX;最終步可 patchPlan 覆寫 orbMessage/autoFillPrompt | **完整且防禦性好** |
| Studio 深度操作面板 | 依 pageAgent.snapshot 分派:ImageStudio 5 分頁(t2i/edit/upscale/pose/sd——各自模型+模板+比例+LoRA+ControlNet 面板)、VideoStudio 5 分頁(t2v/i2v/v2v/enhance/control,含 17 鏡頭 ControlNet、Topaz 倍率/fps)、ProStudio 7 分頁共用架構;每格直接 dispatch pageAgent AgentAction(fillPrompt/setModel/setParam/submit),不繞 LLM | **完整**(檔案 3,100+ 行都在這;是「引導=真的幫你按」的核心) |
| 協作連結列 | StudioCollaborationRow/LinkGrid:link.directAction 有設→`dispatchMetaAction` 純客戶端直發(避免「API 深度連結」卡在思考中);否則 chatPrompt 進自由聊天 | **完整** |
| 面板模式 | `panelMode` **鎖死 "unified"**:guide/chat 分頁已隱藏、setPanelMode 改 no-op,「底下未走到的 guide/chat 程式碼保留維持型別正確」→ 內部渲染 OrbUnifiedAssistant | **帶死分支的完整**(數百行 chat-mode 代碼成殭屍,重構標的) |
| 附件 | useOrbAttachments hook(與 Widget/AgentChat 三處共用) | 完整,見 3.3 |
| 到站緊湊卡 | 跳頁中/到站後縮成緊湊卡片不擋目標頁(:4633);mobile 全螢幕 bottom-sheet wrapper(:3899) | 完整 |

### 3.3 ProactiveOrbWidget.tsx(4,160 行)— 先前未讀的內部子功能

| 子功能 | 內容 | 現況 |
|---|---|---|
| 位置/拖曳 | localStorage 持久化位置(clampDragOffset 防拖出視窗)、角落偏好(orbCorner)、resize 重算 | 完整 |
| 隨機飛行 | orbRandomFly 偏好開啟時 8-18s 隨機漂移(半徑 160×120)→停 2-4s→回家;mobile/引導中/面板開啟時暫停 | 完整(純裝飾) |
| 90 秒 onboarding | ONBOARDING_STEPS 4 步定時指向 `proactive-orb-anchor`→`prompt-builder-area`→`modality-tabs`→`generate-button`(各 ~17s,mm:ss 倒數徽章);isOnboarded/markOnboarded localStorage 一次性;可跳過 | 完整;**依賴目標頁存在這 4 個 elementId**(不在創作頁時步驟指空——弱點) |
| 問候/主動建議 | mood-based+page-aware greetings 隨機;`proactiveActions`(頁面別快速動作大表 :522-1011)每頁第一次露「🧭 建議先試試『…』」nudge(PROACTIVE_NUDGE_KEY 記已看,quietMode 可關) | 完整;**「主動」僅到 toast 建議層級**,沒有伺服端主動推播 |
| 拖放筆記 | 把頁面元素拖到光球上:dataTransfer text/plain 解析(JSON 或純文字)→onSaveToNotes(project_notes_calendar)+人格色 dropFlash+「已擷取至筆記 ✓」 | 完整 |
| 面板 5 視圖 | panelView main/chat/inspiration/focus-flow/capabilities;chat 狀態全接 GlobalOrbChatContext(input/messages/suggestions 共享,和 GuidePanel/AgentChat 同一條對話) | 完整 |
| 15 精靈視覺 | pageDefaultSpirit:依當前頁 findSkillForPage 顯示常駐精靈提示(純視覺;selectRoleForIntent 仍照後端分派);對話 >1 則後隱藏 | 完整 |
| slash 指令 | 輸入 `/` 開頭→runSlashCommand 直接執行(繞過 sendMessage/LLM);shared/slash-commands 前端翻譯 | 完整(02 §7 已註「無專屬後端」) |
| 附件 | ORB_UPLOAD_ACCEPT=`image/*,video/*,audio/*,.pdf,.txt,.md,.docx`;txt/md/docx **客戶端抽文字**(JSZip 解 docx word/document.xml,extractedText 隨訊息進 LLM——「file_url parts LLM 看不到 script」的補償);其餘 uploadFileToS3 傳 URL;上傳中 disable 送出 | 完整(與 ai.ts 伺服端 PDF 抽字互補) |
| 思考 UX | OrbThinkingTimeline(進行中)+OrbThinkingStepsPanel(事後,thinkingPanelMessageAt 控制)+intent-card+quick-reply suggestions+feedback toast | 完整 |
| guideTo/PageAgent bus | OrbGuideContext 整合(guiding/guideMessage 氣泡);Phase 1 bus:消費 autoFillPrompt/autoTabId(引導計畫抵達目標頁後真的填 prompt/切 tab) | 完整 |
| 語音 | OrbVoiceButton 兩處掛載(:3117 面板、:3700 全螢幕) | 見 3.1 語音欄 |

### 3.4 前端小結

12 個 orb/ 子元件**無 import 級孤兒**、品質整齊(每檔都有動機式檔頭);真正的債在兩顆巨石(4,160+4,883 行)與三個「名實不符」:①OrbVoiceButton 註解說 Gemini Live 實為批次 whisper→11Labs、toolCall 通道半邊死;②OrbCapabilitiesView 是靜態行銷卡不是 capability registry;③OrbGuidePanel 的 guide/chat 殭屍分支。多代理討論 UI(Launcher+ProgressPanel)只在 /agent 全頁,浮動面板使用者摸不到。

---

## 4. 缺讀聲明

- agentToolExecutor.ts 8,087 行:主入口/gate/共通機制/db/studio/director 橋接與各 dispatch 函式頭部+case 表逐一讀畢;**各 spiritTools 檔內部函式本體**(共 ~15,000 行)只讀檔頭與代表性實作(criticTools/accountantTools/planExecutorTools/composerTools/directorTools/trainingSpecialistTools),其餘 24 檔以檔頭+executor docstring 概括,單一工具的參數細節未逐一核對。
- OrbUnifiedAssistant.tsx(2,448 行)僅確認掛載鏈與角色,內部未逐行(02 §7 已有接線)。
- OrbGuidePanel 的 5+5+7 個 studio 深度面板逐格參數(模型清單/模板文案)未逐一比對 shared 模型註冊表。
- SPIRIT_COLLAB_PROTOCOL 每條 when 條件全文、agent-skills.ts 的 skill↔工具映射全表未展開。
- 實測 probe 僅覆蓋 6 個代表工具的路由層;未在有 DB 的環境驗證 db.*/studio.* 的端到端成功路徑。
