# X0 — 地毯掃描 wave X 綜合彙整(驗證後)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 性質:X1-X17 逐檔深挖經對抗式驗證後的坐實發現彙整;refuted 者已剔除

---

## 1. 一句話總結與涵蓋範圍

**本波(X1-X17)對 17 個高風險檔案/子系統做逐檔深挖,經對抗式驗證後坐實 40 條 critical/high 發現、1 條待執行期驗證的 uncertain 項目、另有 9 條經查證後推翻剔除(內容未附於本輪輸入,故本報告不重列);本次彙整過程中額外對 1 組發現做了交叉查證並修正其結論(詳見第 3 節)。**

涵蓋的北極星支柱/子系統(依 wave 對應檔案):

| Wave | Label | 涉及檔案(主) | Confirmed 數 |
|---|---|---|---|
| X1 | spine(專案骨幹) | shared/video-state-machines.ts、server/routers/creativeProject.ts | 3 |
| X2 | tool-exec(AI 工具執行) | server/services/agentToolExecutor.ts | 1(+1 uncertain) |
| X3 | pricing(計費定價) | server/services/modelPricing.ts | 3 |
| X4 | compose(影片合成) | server/services/videoCompiler.ts | 1 |
| X5 | brain-router(AI光球後台) | server/routers/brain.ts | 4 |
| X6 | learnhub(學習中心) | server/routers/learnHub.ts | 3 |
| X7 | showcase(作品展示) | server/routers/showcase.ts | 1 |
| X8 | wb-router(世界觀建構) | server/routers/worldbuilding.ts | 2 |
| X9 | own-db(教學檔案庫/RAG) | server/routers/realEarth.ts、server/routers/teachingArchive.ts | 4 |
| X10 | connectors(外部連接器) | server/routers/drive.ts | 1 |
| X11 | rbac-teams(權限/團隊) | server/routers/rbac.ts、teams.ts 等 | 0(本波 critical/high 清單無條目,詳第 5 節) |
| X12 | output-assets(輸出/資產) | server/routers/assets.ts、videoProject.ts | 0(同上) |
| X13 | api-usage(API 用量分析) | server/routers/apiUsage.ts | 3 |
| X14 | training(模型訓練/計費) | server/routers/loraTrainer.ts、server/services/falTrainer.ts | 4 |
| X15 | automation(自動化工作流) | server/services/orbWorkflowEngine.ts | 3(+關聯 1 條 uncertain,見第3節) |
| X16 | collab(多代理協作) | server/services/agentCollaborationOrchestrator.ts | 3 |
| X17 | models(模型客戶端) | server/routers/models.ts、server/services/modelClients.ts | 4 |

---

## 2. 依 cluster 分節的 confirmed 發現

> 表中「嚴重度」欄為「原始標記 → 對抗式驗證後訂正」;凡訂正欄與原始不同,代表驗證過程中發現佐證有誇大/機制描述有誤/可達性範圍需收斂,但核心缺陷本身仍然坐實(verdict=confirmed)。

### 2.1 billing(計費/退款)— 14 條,本波規模最大的 cluster

| Wave | 檔案:行號 | 嚴重度(原→訂) | 主張摘要 | 建議 |
|---|---|---|---|---|
| X3 | server/services/modelPricing.ts:3301-3314,3389-3401,1552-1566,1613-1628 | critical→high | 「每N秒/每分鐘」計費模型缺 `freeSecondsInBase`,時長費+起跳費雙重計費。原稱21筆,查證後 disabled 模型排除,實際 **9 個真實可分派 live 模型**受影響(如 fal-ai/wan/v2.1/video-to-video 5秒影片正確應收15pts、實收約30pts),經 `spiritRouter.invoke→falDispatcher` 真實扣點,非僅報表問題。原稱「reconcileCredits雙重扣款」機制不成立(該分支現行是死碼),實際是單次但公式本身膨脹。 | 補齊 `freeSecondsInBase` 欄位;為 9 個受影響 live 模型逐一核算正確基準值;移除/修正死碼分支的誤導性註解。 |
| X3 | server/services/costAnalytics.ts:39-47 | critical(不變) | `ai_usage_events` 只由 `aiProxy.ts` 兩處寫入;`server/_core/llm.ts` 的 `invokeLLM`(被~30個後端檔案呼叫,含 orb 對話、導演腳本生成、世界觀生成等主流量)經 `providerFacade.ts` 直連供應商,完全繞過該表。LangSmith 估算成本僅寫入外部 LangSmith run metadata(且需 `LANGSMITH_API_KEY` 才啟用),從未寫回 `costLedger`。costAnalytics 的對帳/目錄比對函式對此類別成本結構性看不到。 | 在 `invokeLLM` 出口統一寫入 `ai_usage_events`(或等價 ledger),不可只依賴 aiProxy 這條窄路徑;需求覆蓋所有伺服端發起的 LLM 呼叫,非僅 reasoning 類別。 |
| X3 | server/services/modelPricing.ts:3279-3288 | high(不變) | 目錄查無的 modelId 一律回退固定 5pts,與真實生成成本脫鉤;`FAL_MODEL_CATALOG`(dispatch用)與 `MODEL_PRICING_CATALOG`(計費用)是兩份獨立目錄,鍵不同步即計費失真。實測發現 `fal-ai/tripo3d`、`fal-ai/flux/dev/controlnet` 等 live 模型確有缺口。原引用 12 處「補:」註解經核實**全部屬影片類別**(已有 CI 防護),與敘述「集中在音訊/語音」矛盾,屬佐證誤引;7 個 DEF- 缺陷編號屬音訊類的部分佐證方向正確。`videoCatalogConsistency.test.ts` 僅覆蓋影片類別,音訊/3D/訓練/reasoning 無等效 CI 守門。 | 建一份跨全部模態的 catalog↔dispatcher 一致性測試(比照 videoCatalogConsistency.test.ts 但涵蓋 3D/訓練/reasoning);對已知缺口(tripo3d、flux/dev/controlnet)立即補條目。 |
| X5 | server/routers/brain.ts:731-791 | high(不變) | `orbVoicePreview` 為 `protectedProcedure`,直接呼叫 ElevenLabs TTS,全檔搜尋 charge/deduct/refund/points/balance 對此端點零命中,未用 `audioGenerationProcedure`;僅靠全站泛用 300req/15min 限流(比同類付費 `proStudio.elevenLabsTTS` 的 10req/60s 寬鬆約30倍),且完全不扣點。 | 改掛 `audioGenerationProcedure` 並接入既有 `chargeForFalTask` 計費流程。 |
| X9 | server/routers/teachingArchive.ts:240-244,297-304 | high(不變) | 教材 ingestion 入口(create 觸發/自動觸發轉錄)使用裸 `protectedProcedure`,未比照同倉庫已有的 `requireAudioGenerationLimit` 先例做速率限制;`enqueueTeachingIngestion` 對同 materialId 無「已有 queued/processing job」冪等檢查,可重複觸發真實付費 ElevenLabs Scribe 轉錄。 | 加上 per-user 速率限制與 enqueue 端冪等檢查(同 materialId 已有 queued/processing job 時跳過)。 |
| X13 | server/routers/apiUsage.ts:530-604 | high→medium | `deepCost` 已另開不受 50k 截斷的 `trueTotalCostUsd` 正確填入 `window.totalCostUsd`,但傳給 `reconcileWithProviderInvoices` 的 `events` 陣列仍是受 `.limit(50_000)` 截斷的版本,`truth.totalUsd` 在視窗事件數≥5萬時會與同回應內的 `window.totalCostUsd` 互相矛盾且偏低。 | `reconcileWithProviderInvoices` 改吃已無截斷限制的 SUM 結果,或對 `events` 加上分頁彙總而非一次性 50k limit。 |
| X13 | server/routers/apiUsage.ts:282-309 | high→medium | `overview.totalBalance`/`providerBalances[].balanceUsd` 用 `?? 0` 顯示,但 `providerSnapshotJob.ts` 從未對任何供應商寫入 `balanceUsd`(fal_ai/gemini 的 quota/remaining/nextInvoice 亦為明確 TODO 佔位),四供應商餘額恆為 $0.00 假顯示,無任何提示標明是估計值。 | 前端明確標示「未實作」或直接隱藏此欄位,直到 job 端補上真實查詢。 |
| X14 | server/services/falTrainer.ts:328-345 | critical(不變) | fal.ai 訓練呼叫 `client.subscribe()` 未傳入 timeout/onEnqueue/abortSignal,60分鐘本地逾時只是我方停止等待,遠端任務與計費繼續進行;`falRequestId` 全程停在字串 "pending",逾時後無法回頭查詢/取消/回收產出,且此路徑與其他 fal 呼叫(有 webhookUrl 機制)不一致。 | 傳入 `onEnqueue` 擷取真實 `requestId` 並持久化,逾時後改用該 id 主動查詢/取消遠端任務,或補上 webhook 收尾機制。 |
| X14 | server/routers/loraTrainer.ts:178-191(暨 models.ts create/retrain) | critical(不變,範圍擴大) | `loraTrainer.ts`/`falTrainer.ts` 全文搜尋 deductUserPoints/refundUserPoints/costPoints 零命中;`checkTrpcRateLimit` 是 process 內記憶體 Map,重啟/多實例即失效,且行178-191 之外還有一道 DB 併發上限(≤2 pending/training)這道是持久生效的,原始敘述「唯一防線」有誇大。**更嚴重之處**:`server/routers/models.ts` 的 `create`(訓練分派 fal/replicate)與 `retrain` 兩個 protectedProcedure **完全沒有**速率限制、併發上限或任何計費,是比 loraTrainer.ts 更寬鬆的等價入口,可無限觸發真實 GPU 訓練零計費。 | 為 `models.ts` 的 create/retrain 補上與 `loraTrainer.trainWithReplicate` 對等的速率限制+併發上限+計費掛勾,不能只修一條路徑。 |
| X15 | server/services/orbWorkflowEngine.ts:522-538 | critical→high(且可達性有爭議,詳見第3節) | `runWorkflow` 對每一步呼叫 `executeOrbToolCalls` 時硬編碼 `approved:true`,無視 `requiresHuman` 高成本工具核准閘門。原稱 agentToolExecutor.ts 全檔「零計費邏輯」不成立(實際 17 筆 credit/charge/cost 相關命中,且 `checkAndConsumeQuota` 對生成類工具有獨立額度閘門未被繞過);真正暴露的是非生成類高風險工具(github.createPR、deploy.preview、code.modifyWithClaudeCode)。**本節條目可達性與 X2-uncertain 條目直接衝突,已於第3節裁決。** | 待第3節裁決後,若判定可達則需在 `runWorkflow` 內對 `requiresHuman` 工具補上真實核准流程。 |
| X15 | server/services/orbWorkflowEngine.ts:436-556 | high(不變) | 暫停/取消偵測只在步驟外層迴圈的「下一步開始前」檢查點生效,重試 `while` 迴圈內部全程不重新查詢執行狀態;`maxRetries` 無上限校驗,取消動作最壞情況要等指數退避重試耗盡才真正停止後續付費工具呼叫。 | 在重試迴圈內部加入定期狀態輪詢(或以 AbortController 廣播取消訊號);對 `maxRetries` 加上合理上限校驗。 |
| X16 | server/routers/agentCollaborationRouter.ts:13,31,426-508 | high(不變) | `startCollaboration`/`startAutoDiscussion` 只掛 `protectedProcedure`,未用站內既有 `checkTrpcRateLimit` 模式,也未查 `getUserSessions()` 做併發協作數檢查;`startAutoDiscussion` 每次觸發最多5輪序列 LLM 呼叫且為 fire-and-forget。唯一防線是全站通用 300req/15min 限流(tRPC 層退化為 per-IP,非本端點專屬設計),換算仍可讓單一 IP 15分鐘內誘發約1500次真實 LLM 呼叫,且無併發上限。 | 為 `startCollaboration`/`startAutoDiscussion` 補上專屬 per-user rate limit 與併發協作數上限(呼叫既有 `getUserSessions()`)。 |
| X17 | server/routers/models.ts:270-503,202-268,505-558,569-717 | critical(不變) | `create`/`retrain`/`captionImages`/`autofillAngles` 四個會觸發真實 Replicate/fal.ai 訓練、圖片生成、LLM vision 標註計費行為的 mutation,全部只掛 `protectedProcedure`,全檔搜尋 checkTrpcRateLimit/deductUserPoints/deductUserQuota/chargeForFalTask 零命中;`dispatchImageGeneration` 呼叫甚至未傳 `userId`,連 retry-storm 防護都繞過。 | 統一補上速率限制、併發上限與計費掛勾,可直接複用 `loraTrainer.ts`/`proStudio.ts` 既有模式。 |
| X17 | server/services/modelClients.ts:148-205 | high→medium | `safeApiCall` 逾時後 `Promise.race` 不取消底層 `fn()`,重試迴圈可能對供應商疊加送出多次真實請求。查證後發現 `ModelOrchestrator`/`FalClient`/`ElevenLabsClient`/`ReplicateClient` 四個用戶端中三個(Fal/ElevenLabs/Replicate-in-this-file)在正式流程中**無任何呼叫者、屬死碼**(圖片/影片走 falDispatcher、TTS 走 elevenLabsExtended、訓練走另一支 replicateClient.ts);唯一confirmed可達路徑是 `SunoClient.generateMusic`(經 `proStudio.ts`/`agentToolExecutor.ts` 音樂功能),且使用者端點數是呼叫前就已扣款,重複風險是「我方對 Suno 供應商端可能重複送出任務」的營運成本外洩,非使用者被重複收費。 | 若保留此檔案的 Suno 呼叫路徑,補上 AbortController;其餘三個用戶端類別建議與 X17-deadcode 條目一併處理(刪除或明確標記為未接線)。 |

**串接既有重點群 — 計費失效群組(K2/R1/R4/W2/W3/W5)**:本波 billing cluster 的 14 條發現與該既有群組同屬「估算/計費/對帳環節出現結構性盲區或雙重計費」主題延續。惟本任務輸入未附上 K2/R1/R4/W2/W3/W5 各自的原始內容,本報告僅標注**主題與代號的延續關係**,不對其具體內容做引用或比對,避免臆測;若需交叉核對,應查閱各自的原始來源文件。

### 2.2 security-idor(跨用戶存取/授權)— 11 條

| Wave | 檔案:行號 | 嚴重度(原→訂) | 主張摘要 | 建議 |
|---|---|---|---|---|
| X9 | server/routers/realEarth.ts:294-300 | critical(不變) | `getLinkedMaterials({id})` 只需登入即可呼叫,完全繞過 `teachingArchiveAccess.ts` 的三層授權矩陣(owner/team_shared+membership/public_disciples),直接回傳任意使用者(含 visibility=private)教材的完整 `textContent`/`fileUrl`/`fileKey`。攻擊鏈:枚舉 `realEarthId` → 呼叫本端點 → 取得他人私有教材全文,無需 admin。 | 在 `getLinkedMaterials` 內插入與 `loadMaterialForRead` 相同的授權檢查,對每筆結果依 visibility 過濾。 |
| X16 | server/services/agentCollaborationOrchestrator.ts:387-410 | critical(不變) | `startCollaboration` 的 `sharedContext.userId`/`collaborationId` 為客戶端可控欄位(`z.record` 無白名單),`baseContext.userId ?? request.userId` 讓客戶端值優先於伺服器信任的 `ctx.user.id`;`userId` 為循序自增可枚舉,任何登入使用者可偽造協作紀錄記到任意他人帳下。 | `startCollaboration` 內部應始終使用 `ctx.user.id`,忽略/拒絕 `sharedContext` 中的 `userId`/`collaborationId` 欄位覆寫。 |
| X16 | server/services/agentCollaborationOrchestrator.ts:603-691 | critical(不變) | `executeProtocolHandoff` 的 `extraContext` 完全無過濾,可覆寫合併後 context 的 `collaborationId`;`executeHandoff` 內部改用偽造值重新掃描 `activeSessions`(全程無 userId 比對),命中受害者真實 session 後整段覆寫其 `currentAgent`/`participatingAgents`/`sharedContext`,並持久化進 DB 與訊息匯流排,受害者查詢時會看到被竄改內容,無任何錯誤提示。 | 對 `extraContext` 做欄位白名單(禁止覆寫 `collaborationId`/`userId`);`executeHandoff` 比對 session 時應同時核對 `userId`。 |
| X5 | server/routers/brain.ts:915-926,955-962,1272-1276 | critical(不變) | `errorTraces`/`diagnoseError`/`generationLogs` 只掛 `protectedProcedure`(僅需登入,非 admin),底層對模組級全域陣列完全不依 `userId` 過濾,任何一般登入帳號可讀到全站其他使用者的生成 prompt、錯誤訊息、`resultUrl`;`diagnoseError` 對任意 `traceId` 無歸屬檢查,形同 IDOR。 | 三端點改掛 `adminProcedure`,或在服務層對回傳結果依 `ctx.user.id` 過濾。 |
| X17 | server/routers/models.ts:20-22,31-36,47-52 | critical(不變) | `teamModels`/`getById`/`getAnalysis` 對 `team_shared` 可見性的判斷只查 `visibility` 欄位,未核對 `teamId` 是否等於呼叫者所屬團隊;`getTeamSharedModels()` 的 SQL 只 `WHERE visibility='team_shared'`,無 `teamId` 過濾。任何登入者對自己模型呼叫 `toggleVisibility` 設為 `team_shared`(該模型 `teamId` 恆為 null,因 create 從未寫入)即可讓其被全站任何登入者讀取,洩漏 `trainedLoraUrl`、訓練圖網址等敏感資料。與並存的 `trainingTrackService.listTeamModels()`(有 `assertTeamMember` 正確檢查)形成新舊 API 不一致。 | `getTeamSharedModels`/`getById`/`getAnalysis` 一律加上 `teamId` 比對,或統一改走 `trainingTrackService` 的正確路徑並淘汰舊 API。 |
| X14 | server/routers/loraTrainer.ts:152-168 | critical(不變) | `trainWithReplicate` 的 zod schema 允許 `modelType:"portrait_lora"`,但全函式/全檔搜尋 consent 零命中;`models.ts` 的 create mutation 有肖像權同意書門檻(router 層手動實作,非 DB/共用 middleware 強制),`trainWithReplicate` 完全繞過,任何一般使用者可直接訓練人像 LoRA 不需簽署同意書。 | 在 `trainWithReplicate` 複製/共用 `models.ts create` 的 consent 檢查邏輯,或抽成共用 middleware 避免兩處實作漂移。 |
| X1 | server/routers/creativeProject.ts:170-262 | high→medium | `create`/`update` 直接把客戶端傳入的 `worldFrameworkId`/`worldStoryboardId`/`directorSessionId`/`worldviewId`/`scriptId` 寫入 DB,無擁有權驗證,與同檔案 `link` 端點(有完整擁有權檢查)行為不對稱。下游各讀取端(`projectContextService.ts`、`projectContextAdapters.ts`、`director.ts`)各自重做 userId 檢查作為事實上的補救,目前無已知直接外洩鏈。 | 於 `create`/`update` 補上與 `link` 相同的擁有權驗證,避免依賴每個下游讀取端各自補洞。 |
| X2 | server/services/agentToolExecutor.ts:828-849 | high(不變) | 主工具的 `requireConfirmation` 檢查只保護主工具本身;`fallbackTool` 只驗證 SSRF(`assertAllowedEndpoint`)與 `allowedRoles`,完全不查 `fallbackTool.requireConfirmation`,只要低風險工具的 `fallbackTools` 列了高風險工具,即可無確認執行。上游 `orbTaskOrchestrator.ts` 的核准判斷也只查主工具旗標,無法補這個洞。 | fallback 候選篩選時應一併檢查 `fallbackTool.requireConfirmation`,與主工具同等對待。 |
| X7 | server/routers/showcase.ts:173-180,355-409 | high(不變) | `generation_history` 無 `isPublic`/`visibility` 欄位;showcase 的四個 `publicProcedure`(無需登入)在精選庫湊不滿頁時,把使用者對自己私人生成紀錄的「收藏」或「4-5星評分」當成公開發布同意,用負值 id 包裝原始 prompt 與 `resultUrl` 回傳給任何訪客,且查詢**無 userId 範圍限制**(會撈出任何使用者的紀錄);前端書籤/星等 UI 無任何公開告知。作者已知此問題(AIDV-609 註解)但只求 `getById`/`list` 述詞一致,未修根本問題。 | 在 `generationHistory` schema 補上明確的 `isPublic`/`visibility` 欄位,由使用者主動選擇公開,不可用書籤/評分隱性推定同意。 |
| X8 | server/routers/worldbuilding.ts:688-719 | high→medium | `checkConsistency` 對 `timelineFrameId` 無擁有權檢查,`db.updateTimelineFrameConsistency` 的 UPDATE WHERE 只有 `id`,無 `userId` 過濾;對照同檔案 `deleteTimelineFrame` 有 `and(id, userId)` 雙重條件,證實此為遺漏而非刻意設計。任何登入使用者提供他人 `timelineFrameId` 即可覆寫該筆 `consistencyCheckJson`/`updatedAt`。 | `updateTimelineFrameConsistency` 的 WHERE 子句補上 `userId` 條件,比照 `deleteTimelineFrame`。 |
| X9 | server/routers/teachingArchive.ts:100-101,127-152 | high(不變,cluster標記為injection但本質屬授權缺口) | `visibility:"public_disciples"`(全 workspace 公開)在 create/update 完全無角色/審核門檻,任何新註冊帳號(僅需登入)可立即發佈自由文字內容並自填 `speaker` 姓名,`teachingMaterials` 表無任何審核狀態欄位,汙染全站教材庫檢索與 RAG 語料。 | 對 `visibility:"public_disciples"` 的 create/update 加上角色門檻(如 `leaderOrAdminProcedure`)或人工審核佇列。 |

**串接既有重點群 — 安全群組(U5/U6/V1/V3/W1)**:本波 security-idor cluster 的 11 條(尤其 X9 的教材外洩、X16 的協作 session 偽造/劫持、X5 的跨用戶 prompt 外洩)與既有安全群組(U5/U6/V1/V3/W1)同屬「擁有權檢查缺失/客戶端可控識別欄位覆寫伺服端信任值」的重複模式。本任務輸入未附上述代號的原始內容,僅標注主題延續性,具體比對請查閱各自來源文件。

**背景任務(background job)IDOR 共同根因 — 本次額外查證**:任務要求串接此根因,經直接讀碼確認:`server/db.ts:2141-2148`(`updateBackgroundJob`)與 `server/db.ts:2204-2213`(`getBackgroundJob`)兩個核心 DB 輔助函式,其 SQL 條件確實**只有 `WHERE id = ?`,完全不含 `userId` 過濾**——與本波 X1(`checkConsistency`)、X8(同上)反覆出現的「先寫入/先讀取,擁有權檢查責任完全下放給呼叫端」模式同源。本波 40 條 confirmed 發現中沒有任何一條直接以 `getBackgroundJob`/`updateBackgroundJob` 為佐證,故不將其列為本波 confirmed 條目;但抽查一個實際呼叫點 `server/routers/models.ts:104-109`(`trainingStatus`)發現該處**有**正確補上 `job.userId !== ctx.user.id` 檢查。由於全站至少有 30+ 處呼叫這兩個函式(`webhookFal.ts`、`webhookSuno.ts`、`generate.ts`、`director.ts`、`export.ts`、`proStudio.ts`、`agentToolExecutor.ts` 等),是否每一處都補上等價檢查**未在本波逐一驗證**,建議後續作為獨立稽核主題(對這兩個函式的全部呼叫點做一次性擁有權稽核),不宜假設已全部修補,也不宜未經逐點驗證就列為 confirmed。

### 2.3 persistence(狀態持久化/race)— 5 條

| Wave | 檔案:行號 | 嚴重度(原→訂) | 主張摘要 | 建議 |
|---|---|---|---|---|
| X1 | shared/video-state-machines.ts:113-116 | critical→high | `world_storyboards.productionStatus` 同時被 7 個管線階段值與 6 個 session 狀態值共用;`canTransitionSession()` 對不在 `SESSION_NEXT_STATES` 字典內的 `from` 值,索引結果為 `undefined` 再呼叫 `.includes()` 會拋未攔截 TypeError。`worldStoryboard.ts` create/update 把客戶端輸入原封寫入 DB(無 enum/check 約束),`director.ts` 的 `batchGenerateWithSession`(僅需登入)之後會把該值丟進 `canTransitionSession` 觸發崩潰。tRPC 會攔截例外格式化成 500(非全站當機),使用者可再呼叫 update 設回合法值自我修復,屬可恢復但真實可重現的健壯性缺陷。 | `canTransitionSession` 加上與 `canTransitionSegment` 一致的 `allowed ? ... : false` 防護;或在 DB 層/schema 層分離兩套狀態值,不共用同一欄位。 |
| X1 | server/routers/creativeProject.ts:292-326 | high(不變) | `duplicate()` 只複製 `worldStoryboardId` 指標值(非深拷貝),`worldStoryboardId` 欄位無 uniqueIndex,兩個 creativeProjects row 可指向同一顆 `world_storyboards`;`worldStoryboard.update`/`delete` 只按自身 id 查找+userId 檢查,無專案範圍鎖,編輯「複本」分鏡會直接改到原專案。 | `duplicate()` 應深拷貝 storyboard 為新記錄,不可共用同一 `worldStoryboardId`。 |
| X6 | server/routers/learnHub.ts:620,663-670,701,789 | high→medium | create/update/delete/importDocs 四個 mutation 都沒有讓下游快取失效;`siteKnowledge.ts` 的 learnHubOrbIndexCache(W6已記錄)與本次額外核實的 `learningSpecialistTools.ts` 的 `cachedLearnHub` 都是永不失效的獨立快取,無 TTL/pub-sub,直到程序重啟才會更新。原稱「zero test coverage」不準確——測試有用 `__setLearnHubForTest` 做初始化,但確實沒有測到「create 後快取是否失效」這個情境。影響侷限於 AI 學習推薦內容新鮮度,非資料遺失/安全問題。 | 在 create/update/delete/importDocs 完成後呼叫快取失效函式(或改為 TTL/事件驅動更新)。 |
| X6 | server/routers/learnHub.ts:596-620,672-691,695-712,753-789 | high(不變) | create/update/delete/importDocs 的 DB 寫入包在 try/catch,失敗只 `console.warn`,不 rethrow、不回滾記憶體變更,回應仍宣告成功;`delete` 尤其是先 splice 記憶體再嘗試 DB delete,失敗則下次重啟 `initLearnHubFromDb` 會把已刪除文件重新灌回,造成刪除復活/新增消失/編輯被還原,且失敗期間管理員收到的是「成功」假象。 | DB 寫入失敗應 rethrow 並回滾記憶體變更,不可讓管理端看到假成功。 |
| X14 | server/routers/loraTrainer.ts:241-281 | high(不變) | `startReplicateTraining` 成功後(真實付費任務已啟動),若 Step4 的 `db.updateFineTunedModel` 拋錯,catch 區塊只把 status 設為 failed 且不補寫 `trainingId`,導致真實任務永久無法追蹤;稍後送達的成功 webhook 會被 `webhookReplicate.ts` 的終態守門(`status==="failed"` 即丟棄)吞掉。`activeCount` 只算 pending/training,failed 記錄不佔併發額度,使用者可立即重新排一個新的付費任務。 | catch 區塊應區分「Step3已啟動但Step4寫入失敗」的情境,至少保留 `trainingId`/`replicatePredictionId` 供事後對帳,不應與「從未啟動」的失敗一視同仁。 |

### 2.4 injection(注入/上下文污染)— 5 條

| Wave | 檔案:行號 | 嚴重度(原→訂) | 主張摘要 | 建議 |
|---|---|---|---|---|
| X5 | server/routers/brain.ts:929-942,981-1009 | high→medium | `createProposal`/`reportError` 皆為 `protectedProcedure`(與文件註解「供其他 router 呼叫或管理員手動回報」不符),任何登入用戶可提交任意 `codeSnippet`;`proposalToIssueBody` 對 code fence 未跳脫,若管理員核准會逐字寫入真實 GitHub Issue,構成 Markdown 注入(code-fence breakout/格式偽造)。`approveProposal` 需 adminProcedure 且需人工核准,非直接無門檻寫入;前端用 JSX 插值渲染,不構成瀏覽器端 XSS。 | `proposalToIssueBody` 對 codeSnippet 內容跳脫反引號/程式碼圍欄字元;`reportError`/`createProposal` 若確實只該供內部呼叫,應收緊為非公開 procedure 或內部函式呼叫。 |
| X6 | server/routers/learnHub.ts:753-761 | high→medium | `importDocs` 跳過 create/update 都有的 `sanitizePlainText`/`sanitizeRichText`;若匯入項目帶 `featured:true`,`title`/`summary` 會原樣進入 `buildLearnHubIndexKnowledge` 組成的光球系統提示詞。此路徑需先取得 admin 權限才能呼叫 `importDocs`,且 sanitize 函式本身只防 HTML 標籤,對純文字型 prompt injection 本就無阻擋效果——即使補回呼叫也堵不住核心風險,只能防 HTML/script 型態下游 XSS。 | `importDocs` 補回與 create/update 一致的 sanitize 呼叫(消除不一致性);但需知道這無法解決純文字 prompt injection,應另評估對 `buildLearnHubIndexKnowledge` 輸入內容的語意層防護。 |
| X8 | server/routers/worldbuilding.ts:256-286,579-610 | high→medium | `importFull` 匯入他人分享 JSON 時對 `description`/`backstory`/`notes` 等自由文字零內容消毒,經 `summarizeFrameworkForPrompt` 組進 `generateVideoScript` 的 system prompt(不受 `ENABLE_DIRECTOR_WORLD_CONTEXT` 旗標把關,那旗標只管另一條路徑)。已有專用清洗層 `ragInjectionGuard.ts`(AIDV-69)接線在此注入點,但其開關 `ENABLE_RAG_INJECTION_GUARD` **預設 OFF**,故現況等同無防護。影響侷限於攻擊者需誘使受害使用者自己匯入惡意 JSON 並用該 frameworkId,爆炸半徑侷限於受害者自身工作流,未見可觸發跨用戶提權或工具呼叫副作用。 | 將 `ENABLE_RAG_INJECTION_GUARD` 預設改為 ON,或在 `importFull` 匯入時就做內容消毒,不要等到組 prompt 時才依賴一個預設關閉的旗標。 |
| X9 | server/routers/teachingArchive.ts:100-101,127-152 | high(不變,見2.2節重複列示) | (同 2.2 節說明,cluster 標記為 injection——任何登入者可冒名發佈全站公開內容汙染教材庫/RAG語料。) | 同上。 |
| X15 | server/services/orbWorkflowEngine.ts:512-530 | high(不變) | `orbWorkflowEngine.ts` 呼叫與 `orbTaskOrchestrator.ts` 相同的 `resolveStepRefsInArgs` 解析步驟參照,但完全沒有 `orbTaskOrchestrator.ts` 那樣的 unresolved-placeholder 檢查(`collectUnresolvedStepRefs`);若前置步驟失敗或欄位名寫錯,字面 `${step.path}` 字串會被當成真實參數(如 `image_url`)原樣送給外部付費 API。此路徑經一般 orb 使用者可觸發的 `workflowEngine.executeWorkflow` 工具(**但其可達性與 X15-billing 條目共用同一爭議,見第3節**)。 | 移植 `orbTaskOrchestrator.ts` 的 `collectUnresolvedStepRefs` 檢查到 `orbWorkflowEngine.ts`,解析後發現殘留 `${...}` 應直接判定該步驟失敗,不應送出。 |

### 2.5 northstar(北極星能力缺口)— 2 條

| Wave | 檔案:行號 | 嚴重度(原→訂) | 主張摘要 | 建議 |
|---|---|---|---|---|
| X4 | server/services/videoCompiler.ts:467-655,1128-1146,1300-1308,1386-1392 | high→medium | `CAMERA_VECTORS` 每個模式的 `allowedTransitions` 都不含自身 id,多鏡頭中間鏡頭沿用首鏡頭運鏡片段,>8秒的多鏡頭合成必定觸發至少一次「視角跳躍阻擋」誤判(`jumpBlockCount` 會回傳給前端,是可觀察的假陽性指標);Step7 的「修正」只改寫從未被 `assemblePrompt()` 讀取的 `cameraMotion` 欄位,對送給 AI 影片模型的 prompt 字串**無實際影響**。因 `getEndingCameraMode` 的配對設計保證真正跨模式轉場(首→尾)永遠合法,現行程式碼中沒有「本該修正卻被靜默放行的真實跳躍」個案——此機制目前只是自我矛盾的死碼/誤導性診斷計數,不影響實際影片輸出品質。 | 修正 `allowedTransitions` 讓每個模式包含自身 id(消除自我轉場假陽性);若保留 Step7 修正邏輯,應改寫 `assemblePrompt` 實際讀取的欄位,否則應直接刪除這段死碼避免誤導。 |
| X9 | server/routers/teachingArchive.ts:240-244 | high(不變) | 以 `mediaType:"text"` 建立的教材(教材庫最主要內容型態)因 `needsIngestion` 判斷排除 text 類型,永遠不會呼叫 `upsertTeachingMaterialVectors`;`update` 對 textContent 的修改也不觸發向量化。全庫僅一處呼叫該函式(`teachingArchiveIngest.ts:131`,經 pdf/audio/video 專屬佇列觸發)。語意檢索(RAG)對此類型完全失效,只能靠 LIKE 關鍵字比對這個 fallback。觸發條件是一般使用者建立文字教材的預設路徑,非邊角案例。 | 對 `mediaType:"text"` 的 create/update 也觸發向量化(可直接呼叫 `upsertTeachingMaterialVectors`,不需經過 ingestion 佇列這套為 pdf/audio/video 設計的流程)。 |

### 2.6 deadcode(死碼/契約不符)— 1 條(獨立條目,另有多條在其他 cluster 內因驗證而發現局部死碼,已於各自表格內註記)

| Wave | 檔案:行號 | 嚴重度(原→訂) | 主張摘要 | 建議 |
|---|---|---|---|---|
| X17 | server/services/modelClients.ts:972-1164 | medium(訂正,原標記high) | 檔頭宣稱「四模態統一路由」,但 `getOrchestrator().fal`/`.replicate`/`.elevenlabs` 全 repo 搜尋從未被存取;`ModelOrchestrator.generate()`/`healthCheckAll()`/`getAvailableModalities()` 從未被呼叫;`routers.ts`/`ai.ts` 對 `getOrchestrator` 的 import 本身也是死 import(僅解構出 `{ suno }`)。與既有稽核文件(X17-models-clients-deepdive.md 發現5)結論一致。 | 清理死碼或在檔頭文件更新為「僅 Suno 音樂生成實際使用此橘接層,其餘模態走 falDispatcher」,避免新進開發者誤信檔頭文件。 |

### 2.7 other(其他)— 2 條

| Wave | 檔案:行號 | 嚴重度(原→訂) | 主張摘要 | 建議 |
|---|---|---|---|---|
| X10 | server/routers/drive.ts:18-19,31-34,56 | high(不變) | `user_google_oauth_tokens.accessToken`/`refreshToken` 為明文 `text` 欄位,`saveDriveTokens`/`upsertGoogleOauthToken` 全程無 `encryptSecret` 呼叫;對照姊妹系統(Notion 憑證經 `connectionService.ts` 呼叫 `encryptSecret`/`decryptSecret`)形成同產品內兩套外部憑證儲存標準不一致。任何完成 Drive OAuth 連結的一般使用者,其 token 就會明文落地,一旦 DB 被讀取(SQL injection/備份外洩/內部人員)即可直接取得長效 `refresh_token`。 | 對 `user_google_oauth_tokens` 的 accessToken/refreshToken 欄位套用與 Notion 憑證相同的 `encryptSecret`/`decryptSecret` 機制。 |
| X13 | server/routers/apiUsage.ts:352-354 | high→medium | `usageByProvider` 原生 SQL 子查詢寫 `MAX(snapshot_at)`,DB 實際欄位是 `snapshotAt`(camelCase,非底線分隔,MySQL 不分大小寫規則救不回),對照同檔案 `overview` procedure 正確寫法 `MAX(snapshotAt)`,此子查詢無條件式篩選,呼叫 `usageByProvider` 必定觸發 `Unknown column` SQL 錯誤,後台「依供應商拆解」分頁必定 500。前端有優雅降級(顯示「載入失敗」文字),影響侷限於 admin 專屬分析頁籤。 | 修正 SQL 子查詢欄位名為 `snapshotAt`。 |

---

## 3. 本次彙整過程中新增的交叉驗證與裁決(X15-confirmed vs X2-uncertain 的矛盾)

輸入的 JSON 本身存在一組**互相矛盾**的條目,皆指向同一段程式碼:

- **X15(confirmed,critical→high)**:「`orbWorkflowEngine.ts:522-538` 硬編碼 `approved:true`」,其 reasoning 主張此路徑「經 `agentToolExecutor.ts:2788-2793` 與 7070 行的 `workflowEngine.executeWorkflow` 是一般 orb 使用者可經聊天觸發的工具(非 admin-only)」。
- **X2(uncertain,corrected→low)**:同一段程式碼(:522-538)的 reasoning 主張「`agentToolExecutor.ts:2788-2793` 這個 case 語法上巢狀在 `dispatchStudioTool` 的 switch 內,而 `dispatchStudioTool` 只在 `call.name` 以 `\"studio.\"`/`\"director.\"` 開頭時才會被呼叫,`\"workflowEngine.executeWorkflow\"` 不符合任一前綴,故此 case 是死碼」,並指出 `workflowAutomationTools.ts`(另一呼叫點)是全 repo 零 import 的孤兒檔。

**本報告額外直接讀碼裁決**(超出原輸入 JSON 範圍,獨立驗證):

1. `server/services/agentToolExecutor.ts:708` 確認守門條件為 `call.name.startsWith("studio.") || call.name.startsWith("director.")`;`"workflowEngine.executeWorkflow"` 確實不匹配任一前綴。
2. `dispatchWorkflowEngineTool`(定義於 `agentToolExecutor.ts:7007`)在全 repo(server/client/shared)搜尋,**唯一呼叫點**是 `agentToolExecutor.ts:2794`,而該行正位於上述第1點的守門區塊內部——故 `dispatchWorkflowEngineTool` 及其內部對 `workflowEngineTools.executeWorkflow`(:7070)的呼叫,目前對 `"workflowEngine.*"` 系列工具名**無法被觸發**。
3. `server/services/spiritTools/workflowEngineTools.ts` 全 repo 搜尋,**唯一的 import 者**是 `agentToolExecutor.ts`(即上述已確認不可達的路徑)。
4. `server/services/spiritTools/workflowAutomationTools.ts`(另一個呼叫 `orbWorkflowEngine.executeWorkflow` 的檔案)全 repo 搜尋**零 import 者**,是孤兒檔。
5. `server/services/spiritTools/planExecutorTools.ts` 雖然檔名相關且在 grep 中命中 `orbWorkflowEngine` 字樣,但核實只是**註解文字**提及,並無實際呼叫。

**裁決**:X2-uncertain 條目的「目前休眠/死碼」結論與本報告獨立驗證結果一致,應採信;X15-confirmed 條目中「一般 orb 使用者可經聊天觸發,非 admin-only」的可達性主張**不成立**,應予訂正。正確表述應為:**`approved:true` 硬編碼本身是真實存在的邏輯缺陷(若日後任何入口被接通,會立即繞過 `requiresHuman` 核准閘門,屬於「修 gate 即引爆」的地雷),但截至本次查證,repo 中沒有任何已知的、可達的呼叫路徑能觸發它**——建議將此條目的優先級對齊 X2-uncertain 的 corrected severity(low/待執行期驗證),而非 X15 標記的 critical/high。此為本綜合報告在彙整階段主動發現並修正的一處輸入內部矛盾,供後續處理時參考,不代表原 X15/X2 深挖文件本身互斥錯誤(可能是兩次深挖從不同進入點分析同一段程式碼所致)。

同一段程式碼中 `orbWorkflowEngine.ts:512-530`(2.4節 injection cluster 的「unresolved step refs」條目)、`:436-556`(2.1節 billing cluster 的「暫停/取消偵測」條目)由於同樣是 `runWorkflow`/`executeWorkflow` 執行路徑的一部分,**可達性同樣存疑**,建議一併重新評估其觸發優先級,而非視為獨立於此爭議之外。

---

## 4. Uncertain 清單(待執行期驗證)

| Wave | 檔案:行號 | 嚴重度(原→訂) | 主張摘要 | 待驗證方式 |
|---|---|---|---|---|
| X2 | server/services/orbWorkflowEngine.ts:530-538 | high→low | 同第3節裁決:approved:true 硬編碼是真實邏輯缺陷,但目前已知呼叫路徑(`agentToolExecutor.ts:2788-2793`/`workflowAutomationTools.ts`)皆不可達,屬於「修好路由 gate 才會引爆」的休眠地雷。 | 若未來修復 `agentToolExecutor.ts:708` 的路由 gate 缺口(或任何新增的 workflowEngine 呼叫入口)使其可達,需在該次修復的同一 PR 內一併補上 `requiresHuman` 檢查,並執行期驗證確實會擋下未核准的高成本工具呼叫。 |

---

## 5. 推翻聲明與 Negative Results(避免誇大)

**推翻計數**:輸入聲明本波共有 **9 條** 發現經對抗式驗證後被判定 `refuted`(已剔除,不列入本報告)。本次任務輸入僅提供 `refutedCount: 9` 這個總數,**未附上被推翻條目的具體內容或所屬 wave**,故本報告依規則 2 不臆測、不重建其細節,僅如實記錄推翻數量。

**本波兩個「零 confirmed/uncertain 條目」的檔案,不代表無發現**:

- **X11(rbac-teams)**:本波輸入的 critical/high JSON 中無任何 X11 條目。查核 `docs/research/X11-rbac-teams-deepdive.md` 原文,該深挖文件實際記錄了多項發現,例如 M3(northstar 分級):`teams.transferOwnership`/`updateMemberRole` 後端邏輯完整且測試齊全,但前端零呼叫,導致團隊 owner 事實上永久無法離隊——此為 **northstar 能力缺口**,分級落在本次 critical/high 篩選門檻之下,故未出現在本報告。X11 文件本身另有 7 項「已驗證排除的疑慮」(如 `requireOwner`/`validateShareTarget`/`teams.ts` 跨團隊 IDOR 防護等均查證屬實無問題),顯示該檔案安全機制整體紮實。
- **X12(output-assets)**:同樣本波 critical/high JSON 中無 X12 條目。查核 `docs/research/X12-output-assets-deepdive.md` 原文,該文件記錄的發現分級多落在 medium(例如 `assets.ts` 的 `title`/`description` 欄位缺 `sanitizePlainText` 造成潛在 stored XSS 縱深防禦缺口;`toggleVisibility` 的獎勵點數發放存在 TOCTOU race condition,併發呼叫可能重複發放 2 點×N),故未進入本次 critical/high 彙整範圍。文件同時記錄 9 項「已驗證排除的疑慮」(owner 檢查一致性、簽章 URL 機制、SQL 注入面等均查證無問題)。

**結論**:X11/X12 應理解為「本波未產生 critical/high 等級發現」,而非「零發現」或「已徹底排除風險」;其 medium 級發現(尤其 X12 的 TOCTOU 重複發獎)仍建議排入後續修復序列,只是優先級低於本報告列出的 40 條。

---

## 6. 優先處理建議(依本報告訂正後的嚴重度與影響面排序,節錄)

1. **X9 / server/routers/realEarth.ts:294-300** — 任意登入使用者可讀取他人私有教材全文,無需 admin,建議最優先修補(critical,security-idor)。
2. **X16 / server/services/agentCollaborationOrchestrator.ts:387-410 與 603-691** — 協作 session 可被偽造/劫持並竄改他人資料且無錯誤提示,兩條均 critical(security-idor)。
3. **X5 / server/routers/brain.ts:915-926,955-962,1272-1276** — 全站使用者 prompt/錯誤訊息跨用戶外洩(critical,security-idor)。
4. **X3 / server/services/costAnalytics.ts:39-47** — 成本分析對主流量 LLM 呼叫結構性失明,影響财务对帐可信度(critical,billing)。
5. **X17 / server/routers/models.ts(teamModels IDOR,critical) 與 X14 訓練計費/consent 缺口(critical ×2)** — 模型訓練子系統同時存在跨團隊資料外洩、零計費、繞過肖像權同意書三個 critical 缺陷,建議作為單一整治批次一併處理,避免修一處漏一處。

---

（本報告不含任何真實密鑰值;所有連接器/憑證相關描述僅涉及機制與欄位型別,未輸出任何 sk-/AKIA/-----BEGIN 等敏感內容。）
