# E — AI 代理架構(本案重點文件)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`
- 共同依據:`00-overview.md`(詞彙表/技術棧)、`01-features.md`(功能現況)、`02-fullstack.md`(接線地圖;光球前端接線、orbTask in-memory FSM、slash commands 已盤於 §7,本文不重複)
- 方法:實讀 `server/routers/ai.ts`(3,366 行)、`server/services/`(orb*/spirit*/agent*/director/ 等 40+ 檔)、`server/_core/llmRouter.ts`/`llm.ts`、`shared/`(agent-plan-schema、orb-agent-roles、global-agent-* 等)、`server/eval/`;證據一律附 `檔案:行號`

---

## 1. 代理清單與職責

本站的「AI 代理」實際上是**四層系統**:①光球全域代理(ai.chat 主管線)、②25 位精靈(spirits,含具名角色)、③導演 AI(Director,獨立雙引擎管線,見 §2)、④多代理協作層(collaboration,預設 OFF)。

### 1.1 光球(Orb)全域代理 — `ai.chat` 完整後端管線

入口:`ai.chat`(brainProcedure mutation,`server/routers/ai.ts:434`)。單一 handler 內串起整條管線(依實際執行順序):

| # | 階段 | 實作 | 證據 |
|---|---|---|---|
| 1 | 冪等鎖 | `x-request-id`/`input.requestId` → `checkAndLock`/`getResult`(in-memory) | ai.ts:537-551 |
| 2 | 速率閘 | per-user 20 RPM chat token(AIDV-215,tRPC 層自管因 express-rate-limit 看不到 ctx.user) | ai.ts:553-561 |
| 3 | 月度預算閘 | `enforceMonthlyBudgetGate()`(AIDV-124,旗標 `ENABLE_ORB_BUDGET_GUARD` **預設 OFF**) | ai.ts:563-565;orbBudgetGuard.ts:1-17 |
| 4 | 進度時間軸 | `emitOrbChatProgress`(in-memory ring buffer,前端 `ai.chatProgress` 輪詢):received → calling_specialist → researching_web/analyzing_terms → selecting_provider → planning → materializing_task → finalizing | ai.ts:569 起 |
| 5 | 精靈挑選 | `selectRoleForIntent`(關鍵字+pageSnapshot+回合數,尊重 mutedSpirits)決定**領頭精靈**;`composeRoleChain` 產「協作團隊」chip 名單 — **注意:chain 純 UI 建議,executor 只跑 lead**(M4 註解) | ai.ts:602-655 |
| 6 | 旗標矩陣 | 讀 12+ 個 env 旗標(見 §8.4 表) | ai.ts:940-1003 |
| 7 | 記憶組裝 | Tier A 任務記憶摘要、Tier B/C 長期記憶(`buildOrbMemorySummaryForPlanner` → `guardOrbMemorySummary` AIDV-69 包裹)、DB `orb_feedback_events` 最近 10 筆與前端 recentFeedback 合併、資產庫摘要、對話偏好抽取回寫 `recordOrbMemory`、specialist 工具履歷+`agent_model_picks` 聚合、`users.orbMemorySummary`、pageSnapshot 世界觀摘要 | ai.ts:1005-1248 |
| 8 | 系統提示 | `buildOrbSystemPrompt`(siteKnowledge.ts;帶 pageSnapshot capabilities、身分、記憶偏好、API 工具表)+ `summarizeSiteKnowledgeForPlanner` | ai.ts:1252-1290 |
| 9 | 大腦槽路由 | `pickReasoningSlotForOrbChat`(關鍵字→ director/analyst/storyteller/technician/curator 五槽,_aiHelpers.ts:292)→ `ctx.brain.getBrain(slot)`;**混合大腦保險**:選中 Sonar 槽但 schema-first planner 開啟時,規劃階段改用 director 槽的 tool-use 模型(Sonar 不支援 function calling) | ai.ts:1307-1339 |
| 10 | 網路研究 | 並行兩路:`runOrbWebResearch`(Brave→GitHub fallback,`mode:"agent"`,per-user 節流)+ `analyzeOrbPromptForContextLookup`(快 LLM 判專有名詞,如「淡大禪學社」)→命中則 `runOrbDeepSearch`(Perplexity)組【主題背景研究】block;澄清回合以 regex 跳過省 4s | ai.ts:1341-1509 |
| 11 | 附件/供應商 | attachmentGuard 判 pdf/multimodal → `selectProvider`(providerRouter 目錄:gemini/default_llm/claudeCode/codex/fal/elevenlabs/suno/minimax/disabled,健康感知+fallback chain);多模態不可用時**伺服端抽 PDF 文字**(含 injection trigger 遮蔽)降級成純文字路由 | ai.ts:1730-1860;providerRouter.ts:83-232 |
| 12 | 配額閘 | `checkAndConsumeQuota`(rapid/planner 類別;旗標 `ENABLE_ORB_QUOTA_GUARD` **預設 OFF**) | ai.ts:1643-1720 |
| 13 | Planner | `runSchemaFirstAgentPlanner` 或 `...WithCritique`(使用者偏好 criticEnabled 才啟用;見 §3);注入腦力激盪 arc 狀態、quotaSnapshot、siteKnowledgeSummary、記憶摘要 | ai.ts:1931-2130 |
| 14 | 結果分流 | `converted`(taskDraft)/`clarification`(結構化反問)/`blocked`(moderation/safety)/invalid → 落到 legacy fallback | ai.ts:2128-2340 |
| 15 | 任務物化 | `createOrbAgentTaskFromPlanner`(FSM)+ `orbTaskRepository.create`(legacy,同 taskId 雙寫)、`setOrbTaskPlannerContext` 暫存 planner 輸入供 continuation replan;`estimateOrbTaskCost` 成本分級(`ENABLE_ORB_COST_GUARD` 預設 ON);code capability 偵測→`createOrbCodeTask`(claudeCode/codex,filesForbidden 含 `.env`/`**/secrets/**`) | ai.ts:2398-2578 |
| 16 | Legacy fallback | 直接 `invokeLLM` + `parseOrbReply`([ACTION:...] 文字標記)+ `moderateOrbContent`(Gap 17:阻擋時連 actions 一起剝掉) | ai.ts:2652-2930 |
| 17 | 統一收尾 | `finalizeIdempotentResponse`:每條回覆路徑統一掛 userIdentity/rememberedPreferences/webSources/agentRole/spiritTeam/reasoningChain(思考步驟面板),存冪等結果 | ai.ts:657-727 |

任務核准後的執行(`ai.orbTask.approve` → `driveOrbTaskInBackground`,ai.ts:3098,3177,3215):

```
runOrbTaskWithOptionalMultiAgent (multiAgentIntegration.ts:244;ORB_MULTI_AGENT_ENABLED 預設 OFF→單代理)
  └ runOrbTaskWithContinuationLoop (orbTaskChainRunner.ts:331;agent loop v2「continue」半邊,
      觀察者續跑受 ORB_OBSERVATION_LOOP=1 控制、預設 OFF;maxIterations 預設 2)
      └ runOrbTaskToCompletion (orbTaskOrchestrator.ts;伺服端逐步執行)
          ├ executeOrbToolCalls (agentToolExecutor.ts:533;真打 fal / 內部工具)
          ├ resolveStepRefsInArgs(step N 引用 step N-1 輸出)+ verifyToolResult + reflectOnStepResult(自省)
          └ 失敗→重試耗盡→onRequestReplan → orbTaskReplanIntegration
              → deterministicReplan 先行,再 orbLLMReplan(ReAct 觀察→重規劃;帶失敗觀察、
                工具/模型註冊表、RAG 歷史失敗記憶 — 經 buildReplanMemorySection 安檢)
```

recovery policy(`orbTaskRecoveryPolicy.ts`,全檔 40 行):5 類錯誤碼→6 種恢復動作 — validation_error→補欄位、selector_not_found→重定位、timeout→指數退避重試、policy_blocked→請人確認、provider_error→換供應商或 replan。

### 1.2 25 位精靈(spirits)

`shared/orb-agent-roles.ts:19-45` 定義的 `AgentRole` union(**勘誤:G3 實數為 25 值**),按 `SPIRIT_FAMILY`(:1114)分三族(原「15 精靈=6 通用+6 專精+3 主動」,後擴至 25):

| 族 | 成員(暱稱) |
|---|---|
| **role**(通用,10) | director 導導、composer 編編、critic 品品、researcher 查查、navigator 路路、companion 暖暖、chief-orchestrator 總總、notes-curator 記記、settings-detail 細細、plan-executor 步步 |
| **specialist**(專精,9) | image 圖圖、video 影影、music 音音、voice 聲聲、training 練練、learning 學學、community-manager 群群、inspiration 靈靈、anatomy 體體 |
| **proactive**(主動,6) | accountant 財財、quality-coach 巧巧、inspector 守守、legal-advisor 律律、security-guard 安安、onboarding-coach 帶帶 |

- **觸發**:①`ai.chat` 每回合 `selectRoleForIntent`(orb-agent-roles.ts:1164,關鍵字規則)自動選 lead;②使用者 `@暱稱` 顯式點名(`detectSpiritMention`:1055);③`trpc.spirit.*` 直呼。
- **LLM slot**:`SPIRIT_PREFERRED_PROVIDER`(:1808)— 多模態/推理型精靈偏好 `gemini`,輕量角色(編編/路路/暖暖/學學/財財/帶帶/記記/細細)走 `default_llm`;僅為 hint,selectProvider 的 fallback 鏈仍生效。
- **工具**:`server/services/spiritTools/` **30 檔**(accountant/anatomy/clarificationEngine/communityManager/companion/composer/critic/director/featureDiscovery/image/inspiration/learning/legal/memoryManager/music/notesCurator/onboarding/orchestrator/planExecutor/qualityCoach/researcher/securityGuard/settingsDetail/systemMonitor/training/video/voice/workflowAutomation/workflowEngine + errorHumanizer),經 `agentToolExecutor.executeOrbToolCalls` 以 `<spirit>.<tool>` 命名派發(如 `critic.review`、`accountant.budgetForecast`、`anatomySpecialist.buildMultiViewBatch`)。
- **生成授權**:`spiritDispatcher.invokeSpiritModel`(spiritDispatcher.ts:117)三步 — 查 fal 目錄 category → 缺必要輸入 fail-fast(M15:image-to-* 要 imageUrl 等)→ `canSpiritCallFalModel` 類別白名單(`SPIRIT_MODEL_CAPABILITIES`,orb-agent-roles.ts:1913)→ 通過才 `dispatchFalTask`(真扣點/降級鏈/LangSmith)。tRPC 端點:`spirit.listModels/invoke/plan/run/status/control/replan/listRuns/runStep`(spiritRouter.ts,全 protectedProcedure)。
- **交接協議**:`shared/spirit-handoff-protocol.ts` — HandoffReason 6 種(task_complete/needs_expertise/error_escalation/user_request/parallel_work/quality_review)、SharedAsset 資產續傳、`SPIRIT_COLLAB_PROTOCOL`(orb-agent-roles.ts:2043)定義每角色下游接棒表,`pickBestHandoff` 選最佳下一棒。
- **精靈記憶**:`spiritMemoryManager.ts`(spirit_memories 表,(userId, agentId, memoryKey) 維度)+ `specializedAgentMemoryStore.ts`(事件流稽核)。

### 1.3 具名代理(tRPC 直達)

- **財財(accountant)**:`routers/accountant.ts` — estimate/compare/savings(publicProcedure 唯讀報價)、usage(protected,個人 apiUsageLogs);與 LLM 工具 `accountant.*` 共用 `spiritTools/accountantTools` 同一份實作(檔頭 :5-18 明言對齊 ground truth)。
- **音音(musicSpecialist)**:`routers/musicSpecialist.ts` — recommendEngine/listEngines/estimate(public)、getRecentAssets(protected);同樣與 `musicSpecialist.*` LLM 工具共實作。

### 1.4 多代理協作層(預設 OFF)

| 模組 | 職責 | 持久化 |
|---|---|---|
| `agentCollaborationOrchestrator.ts`(888 行) | session 生命週期、依 `SPIRIT_COLLAB_PROTOCOL` + `orb-specialized-agents` capability 表執行 handoff | `agent_collaboration_sessions`/`_handoffs` 表 |
| `agentDiscussionRunner.ts` | 「自動討論」:同一 prompt 連跑 N 棒精靈(**上限 3 輪/4 位、序列 invokeLLM**),回覆 publish 到 bus,前端輪詢 `getCollaborationMessages`;入口 `agentCollaboration.startAutoDiscussion`(agentCollaborationRouter.ts:426) | bus history |
| `agentCommunicationBus.ts` | in-memory 訂閱/路由/歷史(**1,000 則、24h 保留、單機**) | 無 |
| `collaborativeTaskPlanner.ts` | 任務分解→SubTask(assignedAgent/dependsOn)→ExecutionPlan(sequential/parallel/mixed stages) | 無 |
| `multiAgentDetector.ts` | 純啟發式:「一條龍/自動執行」→步步接管(confidence 0.9)、「總管/整體進度」→總總、訓練+生成、複雜創作 regex | — |
| `multiAgentIntegration.ts` | 統一入口 `runOrbTaskWithOptionalMultiAgent`;**`ORB_MULTI_AGENT_ENABLED` 預設 OFF → 永走單代理鏈**(:237-247) | — |

### 1.5 shared/ 全域登記簿(planner 的「世界模型」)

- `global-agent-registry.ts`:全站 PageAgentSnapshot 登記 + 與 `APP_PAGE_REGISTRY` 的漂移偵測(pageId/path 不符回 reason)。
- `global-agent-capabilities.ts`:每頁 action 能力表(riskLevel/requiresApproval/inputSchema),planner prompt 的「capability registry summary」來源 — navigate 路徑硬約束靠它。
- `global-agent-tools.ts`:**148 個**工具定義(勘誤:G3 精算;另見 G3 重大發現——registry 有註冊≠可執行,executor 只路由 37 個內建工具,178 個精靈工具 case 不可達)(name/riskLevel/requiresHuman/allowedArgsSchema/executionTarget=ui-only|server-side|claudeCode|external-provider)。
- `global-agent-workflows.ts`:runWorkflow 輕量步驟→嚴格 AgentAction 展開 + wizard 澄清(`buildWizardClarification`)。
- `global-agent-orchestrator.ts`(1,611 行):**client 端** DOM 編排器 — 與 server 端 `orbTaskOrchestrator` 是刻意的雙編排器分割(兩檔檔頭互相說明;邊界由 `tests/unit/shared/orchestrator-boundary.test.ts` 強制,client 檔不得 import server/**)。

---

## 2. Director AI / CO-STAR 雙引擎

實作:`server/services/director/costarService.ts`(322 行)`runDirectorAI()`,由 `director.chat`(director.ts:221-273)呼叫。

**「雙引擎」的正確定義**:director.ts:4 自稱「CO-STAR 導演 AI 協作路由 — 雙引擎 RAG(事實研究 + 創意編排)」;siteKnowledge.ts:223 對 LLM 的自我描述同。即:

- **引擎 1 — 事實研究(Step 1)**:優先 `perplexity/sonar-pro`(內建 web grounding,temperature 0.2,90s timeout);gate 三層 — PERPLEXITY/OPENROUTER key 存在 + `perplexityThrottle.checkAndConsumePerplexity`(feature=director_research,per-user+全站節流,env `ENABLE_PERPLEXITY_DIRECTOR_RESEARCH`);被節流/無 key 自動降回使用者大腦 `brainConfig.model`(costarService.ts:151-210)。system prompt 注入 persona.researchStyle + 全站模型/工作流知識 + RAG 記憶段 + 世界框架段,要求「來源:[標題](URL)」引用。
- **引擎 2 — 創意編排(Step 2)**:用使用者大腦 slot(`brainConfig`,預設 `anthropic/claude-opus-4.7`)吃 Step 1 的研究輸出,`response_format: json_schema (strict)` 產出結構化腳本(45s timeout,costarService.ts:216-280);解析失敗有 fenced-JSON 撈回 + 全空防呆(不渲染空白 CO-STAR 卡)。

**CO-STAR 欄位實況**:`CoStarScript` = `context / situation / task / action / result`(5 個敘事欄位)+ `visualPrompt / audioScript / musicVibe / proactiveQuestion`(4 個生產欄位)(costarService.ts:28-38)。⚠️ 這**不是**教科書 CO-STAR(Context-Objective-Style-Tone-Audience-Response)六要素 — 本案是 C-S-T-A-R 五欄位變體;文件引用時勿寫「六要素」。

其他:
- **RAG 注入**:`buildMemoryContext(userId, lastUserMsg)`(ragMemory→Pinecone top-3)組【用戶歷史偏好記憶】段;worldContext(AIDV-152,`ENABLE_DIRECTOR_WORLD_CONTEXT` 預設 OFF)組【世界框架一致性】段;兩者皆 untrusted,旗標 `ENABLE_RAG_INJECTION_GUARD` ON 時過 `guardRetrievedContext` 包裹(預設 OFF=位元相同,costarService.ts:93-132)。
- **三人格 × 四層 prompt**:`director/personality.ts` — calm/creative/technical 各有 researchStyle(給引擎 1)、directorStyle(給引擎 2)、proactiveHint(輸入太模糊時的主動提問規則)、systemPreamble(給 buildDirectorSystemPrompt)。
- 同目錄還有 planningService(規劃里程碑)、scriptAnalysisService、scriptGenerationService(皆接 ragInjectionGuard)、exportFormats(含 CSV injection 防護測試)、templates(withTimeout/extractMessageJson 共用)。
- saveToNotes=true 時研究全文+腳本 JSON 落 `project_notes_calendar`(noteType=script)。

---

## 3. Planner / Orchestration

### 3.1 Plan schema(shared/agent-plan-schema.ts,793 行)

- **v1**(`agent-plan.v1`):intent/reply/shouldAskClarification/clarificationQuestion+2-4 options/steps(≤12,每步 AgentExecutableAction 16 種 discriminated union、riskLevel、requiresApproval、undoable);superRefine 強制「非澄清必有 steps、澄清必有問題」(:161-172)。
- **v3**(`agent-plan.v3`,:378 起,production-grade):`decision.mode` 四態(clarification/direct/tasked/blocked)、`routing`(preferredEngine auto/gemini/minimax/claudeCode + capabilities + pageScope)、attachments、`safety`(riskLevel/requiresHuman/reasons)、taskPolicy(needsApproval/isolation ui|tool|code/autoStart)、rollbackPolicy(manual/auto-on-failure/none + compensationSteps)、每步 confidenceScore/approvalGate/toolName+toolArgs/condition(eq…onFail skip|abort|goto)/timeoutMs/`dependsOn`(**DAG 欄位已定義但今日 orchestrator 仍序列執行**,:456-461 註解)。
- 版本偵測 `normalizeAgentPlanVersion()` + 統一 gating `parseAndGatePlan()`(agent-plan-adapter);舊 `parseOrbReply` 保留為第三層 fallback。

### 3.2 runSchemaFirstAgentPlanner(agentPlanner.ts,1,163 行)

- `buildAgentPlannerMessages`(:362)組合:composer 模式指令、**wizard 澄清鐵則**(強制 MIN 3 輪澄清問完 主題/時長/風格/平台 才能 tasked;「急件/直接做」regex 逃生門 `URGENT_MARKERS`:401 可跳過;禁止「你想從哪步開始?」牆文;禁止通用澄清選項)、**配額分階段規則**(剩餘 generation 額度不足時切 Stage 1 + followUpStages 文字,:460)、navigate 路徑硬約束(只能用 capability registry 列出的路徑,:429)、四份模型註冊表摘要(t2i/i2i/skeletal/upscale)、LoRA 訓練非同步規則(:523 不得同 plan 鏈下游生成)。
- 產出後三道閘:`parseAndGatePlan`(schema+safety)→ `checkModalityCoherence`(:860,模態不一致再叫一次 LLM 修)→ `moderateOrbContent`(:643,阻擋→status:"blocked")。多模態輸入時 `preferEngine:"gemini"`。
- **critique 迴圈**:`runSchemaFirstAgentPlannerWithCritique`(:1039)— `critiquePlan` 評分低於 `critiqueRefineBelow` 時帶定向批評重呼 planner,**最多 2 輪**;由使用者偏好 criticEnabled(Phase D)觸發。
- `plannerResultShouldFallback`(:963)判定何時退 legacy。

### 3.3 狀態機與閉環

- **orbTaskStateMachine.ts**:11 狀態 — `idle → planning → awaiting_approval → approved → executing ⇄ paused / recovering → completed | failed | cancelled | blocked`(shared/orb-task-state-machine.ts:1-13);28 種 audit event(含 task.replanning/replanned/replan_failed/replan_error、claudeCode.*、agent.message、moderation.flagged);**儲存=module-level `taskStore: Map`(orbTaskStateMachine.ts:74),重啟即失**;步驟啟動前過 agentScopeGuard(AIDV-879,toolName→scope action 映射,:26-72)。
- **shared/closed-loop-plan.ts**:泛用閉環 `executeClosedLoopPlan` — planNextStep→execute→observe 迴圈,maxSteps 預設 14(上限 50),success_criteria/fallback 內建於 PlanStep。
- **shared/composer-agent-loop.ts**:編編的 chat 內 agent loop(observe→think→act→verify→recover)— 純資料 6 輪短期記憶,`planContinuation` 把「再試一次/改便宜的/不行」解析成 retry/cheaper/escalate/new,與 FSM 互不相干(檔頭 :24-30 明言)。

### 3.4 `npm run eval`(planner 回歸測試)

`server/eval/runEval.ts` → `runAgentEval`(agentEvalRunner.ts):對 **6 個內建 case**(cases/:basicImageGen、blockedUnknownTool、delegationFromDirector、loraTrainingRequest、multiStepWorkflow、multimodalImageToVideo,各 1 case)逐一**真呼叫** `runSchemaFirstAgentPlanner`,檢查:minSteps/maxSteps、requiredActionTypes/forbiddenActionTypes(比對 step.toolName 或 action.type)、shouldBeBlocked/shouldNotBeBlocked、expectedRouting 逐鍵 JSON 比對。**pass = violations 為 0**;score = 通過檢查數/總檢查數;任一 case fail → process.exit(1)。支援 `--tags=` 過濾。⚠️ 依賴真實 LLM(非確定性、有成本),且僅 6 案例。

---

## 4. 多 Provider LLM 抽象層

### 4.1 llmRouter.ts(944 行)

- 引擎:`openrouter | anthropic | perplexity | gemini | vertex | forge | nvidia | freellmapi`。
- **auto 實際優先序**(llmRouter.ts:525-536):`openrouter > anthropic > perplexity > gemini > nvidia > vertex > forge > freellmapi`(依 key 存在+circuit breaker 健康)。⚠️ 檔頭註解(:13)還寫舊版「anthropic > gemini > nvidia > vertex > forge」— **註解漂移,以代碼為準**。
- 健康感知:`recordEngineSuccess/Failure` + circuit breaker(`getCircuitBreakerStatus`),`getEngineFallbackChain`(:578)供跨引擎降級。
- **`inferEngineFromModelIdSafe`(:411)**:先按 prefix 推引擎(vertex/、nvidia/|minimaxai/、anthropic/|claude-、gemini-、sonar…),再做安全改寫 — 推得 vertex/anthropic/gemini/perplexity 但該引擎不可用且 OpenRouter 可用時,**改路由 OpenRouter**(:428-437)。
- 各引擎預設模型:openrouter=`anthropic/claude-opus-4.7`(:645,「全站光球代理首選」)、anthropic 原生=`claude-haiku-4-5-20251001`(派工/澄清用,:665)、perplexity=`sonar-pro`(supportsToolCalling:**false**,:687-694)、gemini=`gemini-2.5-flash`。

### 4.2 normalizeModelForEngine(llm.ts:915)

按引擎名重寫 model id:OpenRouter — 顯式 remap 表 → 去 `openrouter/` 前綴 → 裸名補 provider 前綴(claude-→anthropic/、gemini-→google/、sonar→perplexity/…)→ **未知裸名安全降級 `anthropic/claude-sonnet-4.6`**;Perplexity 原生 — 剝 `perplexity/` 前綴+白名單驗證,未知降 `sonar-pro`;Anthropic — remap 或降 haiku;NVIDIA NIM — `nvidia/minimax-m2.7`→`minimaxai/minimax-m2.7`;Gemini — 剝 `vertex/` + remap。另有 Gemini JSON Schema 簡化器(深度≤3、每層≤20 屬性、剝 anyOf/oneOf,llm.ts:1000 起)防 400 "too many states"。

### 4.3 周邊

- `fallbackPolicy.ts`:統一降級鏈單一來源 — `PER_MODEL_FALLBACK`(LLM 模型)+ `PER_CATEGORY_FALLBACK`(fal 任務類別),`resolveFallbackChain(modelId, category)`。
- `llmConcurrency.ts`:全域 semaphore,`MAX_CONCURRENT_LLM_CALLS` 預設 5,FIFO,所有 invokeLLM 都過。
- `providerFacade.ts`:8 供應商 base URL 單一路由表;設 `CF_AI_GATEWAY_BASE_URL` 後可整批切 Cloudflare AI Gateway(host 置換),未設=直連零變化。
- `modelRegistry.ts`:引擎/模型合法性註冊(engine-model-ids 測試對其鎖定;本輪未逐行讀)。

### 4.4 user_ai_brain 5 slot 的消費鏈

`user_ai_brain` 每使用者一列:5 個推理大腦 slot + 4 生成引擎 + 16 個 fal 任務引擎欄(schema.ts:1337-1547,見 01-features §2)。預設(`brainContext.ts:139-160`):

| slot | 預設模型 | temp/topP | 消費者 |
|---|---|---|---|
| director | anthropic/claude-opus-4.7 | 0.4/0.9 | 光球預設、CO-STAR 引擎 2、混合大腦保險的替補 |
| analyst | **perplexity/sonar-pro** | 0.3/0.8 | 數據/統計類問題(即時 web grounding) |
| storyteller | anthropic/claude-opus-4.7 | 0.9/0.95 | 腳本/分鏡/對白 |
| technician | anthropic/claude-opus-4.7 | 0.2/0.7 | code/deploy/除錯 |
| curator | anthropic/claude-opus-4.7 | 0.8/0.9 | 偏好/記憶/「上次」類 |

路由:`brainProcedure` 注入 `ctx.brain` → 光球每回合 `pickReasoningSlotForOrbChat` 關鍵字選槽(_aiHelpers.ts:286-291 註解列規則)→ `ctx.brain.getBrain(slot)`;生成端 4 引擎槽由 `resolveOrbEngine`(agentToolExecutor.ts:59)/`resolveFalEnginesFromRow`(falDispatcher)讀取。另有 `PREFER_CHEAP_MODELS` 三層(economy/balanced/premium,AIDV-938,未知值安全退 economy)。

---

## 5. RAG「雙引擎」查證與記憶體系

**結論:「雙引擎」不是指兩套 RAG。** 全 repo 僅 director 系(director.ts:4、siteKnowledge.ts:223)使用此詞,指 CO-STAR 的「事實研究引擎(Sonar)+ 創意編排引擎(大腦模型)」(§2)。「雙引擎 RAG」= 這條雙引擎管線上掛了 RAG 記憶注入,而非兩個檢索引擎。

### 5.1 向量層(單一 Pinecone)

- `ragMemory.ts`:Pinecone index `ai-director-memories`,embedding=**gemini-embedding-001(3072 維)**(text-embedding-004 已 404 廢棄,:40-45);寫入=生成歷史/偏好向量化 upsert;讀取=`buildMemoryContext(userId, query)` 檢索 top-3 組 prompt 段;失敗一律靜默降級(gate:`RAG_MEMORY` 旗標=PINECONE_API_KEY 存在)。
- `teachingArchiveRag.ts`:教材庫 RAG — 同 index、namespace `teaching-{userId}`,切片 1200 字/200 overlap 句界優先;檢索 vector 優先→visibility 過濾→LIKE fallback(全鏈見 02-fullstack §6.1)。

### 5.2 記憶三層(server/services/memory/MEMORY_TIERS.md — 官方分層文件)

| Tier | 模組 | 儲存 | 用途 |
|---|---|---|---|
| A 任務便箋 | orbTaskMemory | RAM + 可選 `orb_task_memory_events` | step1→step2 穿針引線;`summarizeRecentOrbTaskMemoryForPlanner` |
| B-1 對話記憶 | orbMemory | RAM + RAG index(重啟 RAM 清空、RAG 持久) | 偏好/觀察/安全事件;`buildOrbMemorySummaryForPlanner` |
| B-2 使用者摘要 | orbUserMemory | `users.orbMemorySummary`(一句話) | LLM 啟動上下文 |
| C-1 長期記憶 | orbLongTermMemory | `orb_long_term_memories`+associations | user_fact/skill_learned/error_solution/success_recipe,含 importanceScore/關聯圖 |
| C-2 精靈記憶 | spiritMemoryManager | `spirit_memories` | 每(使用者×精靈)個性化學習 |
| C-3 專家事件 | specializedAgentMemoryStore | `specialized_agent_interactions` | 工具使用事件流,skill router tiebreaker |

### 5.3 注入點總表(哪些 prompt 會帶記憶/知識)

| 注入點 | 內容 | 安檢 |
|---|---|---|
| ai.chat 主 planner contextBlock | `buildOrbMemorySummaryForPlanner` 摘要(每回合) | `guardOrbMemorySummary`(AIDV-69,主路徑已接) |
| orbTaskChainRunner replan 路徑 | 同上(observation loop 觸發時) | 同 guard |
| buildOrbSystemPrompt | 站點知識(siteKnowledge)+ pageSnapshot + 資產庫 + 偏好 profile + specialist hints + agent_model_picks + `users.orbMemorySummary` | 站點知識為 trusted;記憶段屬 untrusted |
| director costarService / planningService / scriptGenerationService | RAG 記憶段+世界框架段 | `guardRetrievedContext`(第一階段接線) |
| routers.ts compileElitePrompt | 使用者歷史 prompt 原文 | `guardCreativeMemoryContext` |
| orbLLMReplan | RAG 歷史失敗記憶 | `buildReplanMemorySection` |
| spiritPromptEnhancer(總總) | formatMemoriesForPrompt 記憶段 | `guardSpiritMemorySection` |
| 教材庫 search snippet | **不進 LLM prompt**(只回前端 OrbSearchCard)— 明文判定不接 guard | ragInjectionGuard.ts:33-41 |

以上 guard 全部由 `ENABLE_RAG_INJECTION_GUARD` 控制,**預設 OFF**(ragInjectionGuard.ts:54-64)。

---

## 6. 生成流程被代理串接

1. **光球鏈**:tasked plan step(toolName=`studio.generateImage` 等)→ approve → orchestrator → `agentToolExecutor`:`resolveOrbEngine`(讀大腦引擎槽,agentToolExecutor.ts:59)→ falDispatcher 派 queue → `awaitFalQueueResult`(預設等 120s,超時回 pending+request_id,:36-41)→ `runFalWithRecovery` 降級策略;`GENERATION_SLOT_TOOLS`(15 個 studio.* 工具,:15-31)消耗每日 generation 配額;輸出 URL 由 `resolveStepRefsInArgs` 餵給下一步(t2i→i2v 級聯)。
- **精靈鏈**:`spirit.invoke` → `invokeSpiritModel`(授權白名單+輸入檢查)→ `dispatchFalTask`;spiritTools 內的 `imageSpecialist.generate` 等經 `generationJobDispatcher` 薄門面(generationJobDispatcher.ts:1-9)轉 falDispatcher 各模態 helper。
- **導演批次鏈**:`director.autoGenerateFromSegments`(額度預檢)→ N × `executeGenerationTask`(扣點→fal queue→webhook+3s 輪詢→失敗原子退款)→ 資產三表入庫;i2v 自動級聯在前端 useEffect(01-features §1.2)。
- **輔助代理**:`orbCreativeModelHints.ts` — 從 `shared/aiModelsCatalog` 每模態抽 ≤3 個真實模型組 ~600 token block 注入 planner,防 LLM 幻想不存在的模型;`compositionSuggestionService.ts`(AIDV-847)— 構圖畫布元素佈局→LLM 產 1-5 條 layout/balance/focus/depth/color_harmony 建議(失敗 throw、router 降級空陣列);`qualityCoachEngine`(shared)經 `spiritTools/qualityCoachTools` 提供巧巧 4 個**純函式**工具(diagnose 7 維度 0-100 分/rewrite/compare/getTemplates — 不打 LLM、不寫 DB)。

## 7. MCP 整合現況

- `.mcp.json` 僅一個 server:`gitnexus`(`npx -y gitnexus@latest mcp`)— 程式碼知識圖譜查詢,服務對象是**開發期的 Claude Code / agent 會話**,不是產品 runtime。
- `npm run gitnexus` → `scripts/gitnexus-launcher.mjs`:只嘗試本機/全域 binary 啟 `gitnexus serve`,失敗提示 `npm install -g gitnexus`(不做 registry fetch)。
- 引用處:`package.json:28`、`docs/plan/AIDV-master-plan.md`、`docs/4shell-handoff/交接包/*`(交接文件要求代理用 gitnexus 查關係);**AGENTS.md 本身沒有提到 gitnexus**(grep 證實)。
- **產品程式碼內沒有任何 MCP client**:server/ 與 package.json 無 `@modelcontextprotocol`/McpClient 蹤跡。光球的「工具」是自建的 ORB_TOOL_REGISTRY_JSON(外部 HTTP 工具)+ 內建 spiritTools 派發,非 MCP 協議。Atlassian/GitHub MCP 是開發環境層級(00-overview §1)。

---

## 8. 安全 / Moderation 邊界

### 8.1 工具執行邊界(agentToolExecutor.ts,8,087 行)

- **外部工具**:僅能由 `ORB_TOOL_REGISTRY_JSON` env 宣告(zod 驗證,≤64 個,riskLevel/allowedRoles/retryPolicy/requireConfirmation;`config/orbToolRegistry.ts`,**預設空**);連外必須通過 `ORB_TOOL_ALLOWED_ORIGINS` — **production 一律不預設放行、必須顯式列 origin(fail-closed)**;設了 registry 卻沒設 origins 會 warn「暫時不允許光球代理連外 API」(agentToolExecutor.ts:330-410)。
- **內建工具**:30 個 spiritTools 檔內的 `<spirit>.<tool>`,伺服端白名單派發;生成類工具吃 `GENERATION_SLOT_TOOLS` 配額;`moderateOrbContent` 亦在執行層 import 使用。

### 8.2 角色授權(agentScopeGuard)

`_core/agentScopeGuard.ts`(AIDV-326):15 種 scope action(read/write:project/script/voice/image/…、publish:project、delete:project…),`ROLE_SCOPES` 最小權限表 — 破壞性操作(delete/publish)僅 orchestrator/director 級。FSM 每步啟動前 `checkStepScope`(orbTaskStateMachine.ts:48-72,AIDV-879):`ENABLE_AGENT_SCOPE_GUARD` **預設 ON(enforce)**;task 缺 agentRole 時 fail-open 只記 log(rollout 安全)。

### 8.3 成本三守衛

| 守衛 | 旗標 | 預設 | 行為 |
|---|---|---|---|
| orbCostGuard | ENABLE_ORB_COST_GUARD | **ON** | `estimateOrbTaskCost` 五級 tier(free→high),LoRA/fine-tune 工具強制 high;high→requiresHuman/askBeforeAct;另 `checkRetryChainCost` 防重試鏈燒錢(ENABLE_ORB_RETRY_CHAIN_COST_GUARD ON) |
| orbQuota | ENABLE_ORB_QUOTA_GUARD | **OFF** | 每日 planner 200 / generation 40 / multimodal_analysis 30 / code_task 12(orbQuota.ts:28-31);quotaSnapshot 也餵 planner 做分階段規劃 |
| orbBudgetGuard | ENABLE_ORB_BUDGET_GUARD | **OFF** | 月度 `AI_MONTHLY_BUDGET_USD` 硬閘,超限全站 TOO_MANY_REQUESTS(檔頭明言風險高需 Bruce 顯式開) |

### 8.4 代理鏈上的 moderation 與其他預設值

- **contentModeration 位置**:三處 — ①planner 內部(`runSchemaFirstAgentPlanner` gated 後 `moderateOrbContent`,block→status:"blocked",agentPlanner.ts:643-651);②legacy fallback 回覆(Gap 17,ai.ts:2710-2720,**block 連 actions 一起剝**);③工具執行層。實作為 `shared/orb-content-moderation.ts` **純 regex**(violence/hate/explicit/self-harm 中英 pattern),檔頭自承非 managed moderation API 替代品。另有 `server/services/security/contentModeration.ts` 服務於生成鏈 checkSafety(02-fullstack §1.1)。
- **ragInjectionGuard**(AIDV-69):純函式三段處理(注入樣式中和/長度上限/「視為資料非指令」包裹),7 個接線點(§5.3),`ENABLE_RAG_INJECTION_GUARD` **預設 OFF**。
- **agent-plan-safety**(shared):8 種 block reason(empty_plan/too_many_steps/too_many_submits/missing_page_path/unknown_action/unsafe_navigation_path/high_risk_without_approval/destructive_without_approval)→ okToPresent/okToExecute/askBeforeAct 三閘輸出。
- **Skill 三件套**(Wave S):`skillSandbox`(node:vm 隔離 — 無 fetch/fs/process、5s timeout、白名單 API、fail-closed SandboxViolation)、`skillSupplyChain`(manifest SHA-256 checksum + 升版權限擴張偵測 → fail-closed disable+needsReaudit)、`skillValidator`(manifest schema + 權限範圍 + step 實例化驗證)。
- **PDF/附件**:extractPdfAttachmentsToText 帶 injection trigger 遮蔽 telemetry(ai.ts:1775-1781);orbAttachmentGuard 判 kind/bytes。
- **代理相關旗標預設一覽**(ai.ts:940-1003 + 各檔):ON — ENABLE_ORB_AGENT、ENABLE_SCHEMA_FIRST_PLANNER、GLOBAL_AGENT_WORKFLOWS、ORB_TASK_STATE_MACHINE/TASK_MEMORY/LONG_TERM_MEMORY、CAPABILITY/TOOL_REGISTRY、ORB_PROVIDER_ROUTER、ORB_COST_GUARD、ORB_CODE_COLLABORATION、AGENT_SCOPE_GUARD;**OFF** — ORB_QUOTA_GUARD、ORB_IDEMPOTENCY_GUARD、ORB_BUDGET_GUARD、ORB_MULTI_AGENT_ENABLED、ORB_OBSERVATION_LOOP、ENABLE_RAG_INJECTION_GUARD、ENABLE_DIRECTOR_WORLD_CONTEXT、ENABLE_CODEX_TASKS、ENABLE_COST_LEDGER。

---

## 9. 優缺點與優化建議

### 9.1 優點(有證據的工程亮點)

1. **Schema-first 規劃 + 多道閘**:v3 plan schema(decision.mode/safety/rollback)+ parseAndGatePlan + modality coherence 修復 + moderation + critique 迴圈,比「LLM 吐自由文字再 parse」穩健一個世代;legacy 路徑保留為三層 fallback。
2. **雙編排器刻意分割**:server(tRPC 工具)/client(DOM)兩編排器邊界由測試強制,避免 SPA 導航與伺服端工具派發耦合。
3. **ReAct 閉環已落地**:verify→reflect→deterministicReplan→LLM replan→continuation loop,error code→recovery action 決策表化。
4. **LLM 抽象層成熟**:8 引擎、健康感知 circuit breaker、模型 id 三層正規化(inferSafe→normalize→remap)、統一降級鏈、全域併發 semaphore、供應商門面可一鍵切 CF Gateway。
5. **記憶分層有文件**(MEMORY_TIERS.md)且 planner 注入點/安檢覆蓋範圍有逐點誠實標注(ragInjectionGuard 檔頭)。
6. **權限最小化設計**:精靈 fal 類別白名單、agentScopeGuard 角色 scope、外部工具 fail-closed origins、code task filesForbidden、skill 供應鏈防升版奪權。
7. **成本意識內建於規劃**:quotaSnapshot 餵 planner 做分階段、cost tier→人工核准、retry-chain 守衛。

### 9.2 缺點 / 風險(依嚴重度)

1. **任務 FSM 純 in-memory**(orbTaskStateMachine.ts:74 Map;orbTaskRepository 亦同):Railway 重啟/重佈署即丟所有進行中任務;audit event 也一起消失 — 與「production-grade v3 schema」的雄心不匹配。
2. **安全/成本旗標大面積預設 OFF**:quota/budget/idempotency/RAG injection guard/多代理全關 — 文件與行銷描述的能力(多代理協作、預算守門、注入防護)在 prod 實際上多半未啟用;護欄真的被打開前形同紙上。
3. **`ai.chat` 單 handler 巨石**:~2,500 行在一個 mutation 內(閉包變數跨 2,000 行引用,finalizeIdempotentResponse 靠 call-time 解析註解自辯),回歸風險高、無法單測子階段。
4. **「協作團隊」是展示性的**:composeRoleChain 產的多精靈 chip 只有 lead 真正執行(ai.ts:638-640 M4 註解自認),UI 暗示與後端事實有落差;多代理真路徑(discussionRunner/orchestrator)又在旗標後面。
5. **意圖路由全靠關鍵字啟發式**:selectRoleForIntent、pickReasoningSlotForOrbChat、multiAgentDetector 都是 regex/includes — 中文口語變體很容易漏接或誤接(例:「幫我看看這段效果」不含任何關鍵字)。
6. **eval 覆蓋極薄且非確定**:6 個 case、真打 LLM、pass 判準只看結構性質;planner prompt 上千行規則(MIN 3 輪澄清、額度分階段、navigate 硬約束)幾乎沒有對應 case。
7. **雙任務儲存並存**(FSM store + legacy orbTaskRepository 同 taskId 雙寫,ai.ts:2435-2456 註解自述曾因不同步卡 pending):同步負擔長期存在。
8. **AgentCommunicationBus 單機 in-memory**:多實例部署時協作訊息不互通;collaboration session 有 DB 表但 bus 歷史沒有。
9. **moderation 純 regex**:檔頭自承;對繁中變體/諧音繞過脆弱。
10. **註解漂移**:llmRouter 檔頭 auto 優先序與代碼不符;「CO-STAR」名實不符(實為 C-S-T-A-R 五欄)— 文件級 debt。
11. **v3 dependsOn DAG 欄位已收未用**:仍序列執行,規劃者(LLM)可能誤以為可並行。

### 9.3 優化建議(對應上表)

1. **FSM 持久化**:最小改動 = taskStore 寫穿 Redis(已有 ioredis 基建)或 `orb_*` 表(audit event 已有 schema 感);至少做「重啟後標記 orphan 任務並通知使用者」。
2. **分批開旗標**:先開 ENABLE_ORB_QUOTA_GUARD(有 per-category 限額+planner 已認得 quotaSnapshot,風險低)與 ENABLE_RAG_INJECTION_GUARD(純包裹、各注入點旗標 OFF 位元相同已驗證),再帶監控開 budget guard。
3. **拆 ai.chat**:按管線階段抽 service(memoryAssembly/researchStage/plannerStage/materialization),閉包變數改顯式 context 物件 — 也解鎖子階段單測。
4. **精靈協作補實或收斂 UI**:要嘛把 spiritTeam chain 接到 discussionRunner 真跑(它已支援序列接棒),要嘛把 chip 標示為「建議路徑」。
5. **意圖路由升級**:用既有 default_llm(haiku 級)做 3-way 分類器替代 regex,或用 gemini-embedding 對 role 描述做相似度 — 成本可控且已有基建。
6. **eval 擴編**:每條 planner 鐵則至少 1 case(澄清輪數、額度分階段、navigate 白名單、urgent 逃生門);加 mock-LLM 確定性模式讓 CI 可 gate;把 `npm run eval` 掛進 aidv-workflow 三門。
7. **統一任務儲存**:以 FSM 為單一真相源,orbTaskRepository 退化為 FSM 的 view/adapter。
8. **bus 加 Redis pub/sub 後端**(多實例前必做);collaboration message 順手落 `agent_collaboration_*`。
9. **moderation 換 managed API**(檔頭已預留 call site 註解),regex 降級為 API 不可用時的 fallback。
10. **修註解漂移 + 詞彙統一**:llmRouter 檔頭、CO-STAR 命名(對外文件改稱「CSTAR 腳本框架」或補 objective/style 欄位)。

---

## 缺讀聲明

- `agentToolExecutor.ts`(8,087 行)只讀了頭部/registry/白名單區與工具名派發樣式,約 200 個內建工具 handler 本體未逐行讀。
- `_core/modelRegistry.ts`、`orbTaskOrchestrator.ts` 中段(步驟迴圈細節)、`orbWorkflowEngine.ts` 模板 CRUD 本體、`orbClarificationEngine.ts` identifyIntent 的 LLM prompt、`global-agent-orchestrator.ts`/`global-agent-tools.ts` 全文(僅讀頭部+計數)、`agentCollaborationOrchestrator.ts` 中段 handoff 執行細節、`spiritTools/` 各檔本體(僅 qualityCoach 與工具名清單)未逐行讀。
- Supabase 側 `agent_tasks`/`agent-heartbeat` edge function 與代理系統的交互未深挖(歸子代理 B 範圍)。
