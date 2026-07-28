# CC4 — 剩餘 orb 服務深挖
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/services/orbClarificationEngine.ts(778)、orbFeatureDiscovery.ts(791)、orbUnifiedSearch.ts(593)、orbReplyParser.ts(494)、orbTaskChainRunner.ts(609)、orbTaskStore.ts(516)

> 核對:`git diff 812f6fdb HEAD -- <本波六檔>` 為空,六檔在兩個 commit 間內容完全一致,以下行號對兩個 commit 均有效。

## 0. 六檔角色速覽(先摸清角色再深入)

| 檔案 | 角色 | 對外暴露面 |
|---|---|---|
| `orbClarificationEngine.ts` | 意圖識別(LLM 分類)＋澄清問題生成/記錄＋使用者回答模式學習＋統計,寫入 `orbIntentLogs`/`orbClarificationHistory`/`orbUserAnswerPatterns` 三表 | `spiritTools/clarificationEngineTools.ts` → `agentToolExecutor.ts` 的 `clarificationEngine.*` 工具族;另被 `orbConversationEnhancer.ts`(經 `orbConversationsRouter.ts`)呼叫 |
| `orbFeatureDiscovery.ts` | 功能使用/發現路徑記錄＋推薦(AIDV-548 純函式核心已實作)＋5 個仍是 TODO 的 stub procedure | `spiritTools/featureDiscoveryTools.ts` → `agentToolExecutor.ts` 的 `featureDiscovery.*` 工具族 |
| `orbUnifiedSearch.ts` | 跨 4 來源(asset/note/history/tutorial)統一搜尋,per-source timeout + 短 TTL cache,純函式 `scoreMatch`/`bigramSimilarity`/`diversifyByKind` 可單測 | `orbProxyRouter.ts` 的 `orb.unifiedSearch`(protectedProcedure) |
| `orbReplyParser.ts` | 把 LLM 原始回覆(JSON 或 `[ACTION:...]` marker 語法)解析成結構化 action/toolCall/clarification/citation,含三個白名單(`ORB_ALLOWED_ACTIONS`/`ORB_DESTRUCTIVE_ACTIONS`/`ORB_ALLOWED_TOOL_NAME`) | 純函式,被 `ai.ts` legacy fallback 分支呼叫 |
| `orbTaskChainRunner.ts` | Agent loop v2「continue」半迴圈:包住 `runOrbTaskToCompletion`+`observeOrbTaskOutcome`,失敗時呼叫 planner replan、串鏈新任務,上限 `maxIterations`(預設 2,硬頂 4) | `ORB_OBSERVATION_LOOP=1` 旗標開啟時由 `driveOrbTaskInBackground` 呼叫(預設關) |
| `orbTaskStore.ts` | **舊版(legacy)**光球任務儲存,Map-based,建構子支援可選 file persistence(`ORB_TASK_STORE_FILE`,預設空字串);與 `orbTaskStateMachine.ts` 的 FSM(純 in-memory Map,見下)平行存在,經 `orbTaskRepository` 對外暴露 | `ai.ts` 的 `ai.orbTask.*` 全族(task/approveTask/approveStep/reportTaskStep/events 等) |

R15 對照(orbTaskStore vs FSM in-memory)已由既有研究(`docs/research/P6-data-persistence-rag.md`、`K3-data-integrity.md`、`N3-priority-decisions.md`)定位:`orbTaskStateMachine.ts:73` 的 `taskStore = new Map()` **完全沒有**持久化選項,而本波稽核的 `orbTaskStore.ts` 才是掛著(但預設關閉的)`ORB_TASK_STORE_FILE` 選項的那個「舊版/次要」store。本波在既有結論之上新增的驗證與發現見 §1(P1)。

---

## 1.【嚴重 / persistence】`orbTaskStore.ts` 把「持久化」實作成「每次讀取都整表同步落地」,使既有「開現成開關就好」的 R15 止血建議失真

**發現**:`persistToDisk()`(`server/services/orbTaskStore.ts:103-111`)用同步 `writeFileSync` 把**整個** `tasks` Map 重新序列化寫檔。`cleanup(now)`(:113-118)**無條件**在結尾呼叫 `persistToDisk()`——就算這次呼叫沒有任何任務被 TTL 淘汰也一樣寫。而 `cleanup()` 又被幾乎所有讀寫方法在最前面呼叫,其中包含純讀取的 `get()`(:143-149,:144 呼叫 `this.cleanup(now)`)。

連鎖效應:
- `getTaskSyncMeta()`(:151-168)內部呼叫 `this.get(...)`(:156)**再**呼叫 `this.getTimeline(...)`(:158),而 `getTimeline()`(:383-466)本身在 :410 又呼叫一次 `this.get(...)`——單一個 `getTaskSyncMeta()` 呼叫觸發 **2 次** `cleanup→persistToDisk`。
- `server/routers/ai.ts:227-228` 的 `ai.orbTask.task` query 對同一個 taskId **同時**呼叫 `orbTaskRepository.get(...)` 與 `orbTaskRepository.getTaskSyncMeta(...)`——單一次前端輪詢就疊加到 **3 次**整表同步寫檔。
- `getTimelinePage()`(:468-513)內部呼叫 `getTimeline()`,同樣連帶 1 次。

**影響**:目前 `ORB_TASK_STORE_FILE` 預設空字串(`server/_core/env.validated.ts:613`),`persistToDisk()` 的 `if (!this.persistenceFile) return;`(:104)讓上述連鎖在**今天**是 no-op,尚未造成生產事故——這點與既有 R15/K3/P6/N3 文件的「開現成開關成本極低」判斷並不衝突於「有沒有問題」,但衝突於「成本有多低」:既有文件(`P6-data-persistence-rag.md:29`、`N3-priority-decisions.md:37,112`)建議的止血步驟是「直接把 `ORB_TASK_STORE_FILE` 接上」,但以**目前实作**直接打開這個開關,會讓「一個正在跑的任務,前端每次輪詢進度」都變成同步阻塞式整表磁碟寫入——寫入量與**目前活躍任務總數**成正比,而非與「這次呼叫是否真的有狀態改變」成正比。若光球任務並行度稍高、輪詢頻率如 V2 深挖文件描述的「同一個死掉的 taskId 十分鐘內產生 400 次查詢」,Node 事件迴圈會被同步 I/O 反覆卡住。

**建議**:在真的把 `ORB_TASK_STORE_FILE` 接上(或依 R15/P6 建議搬到 FSM)之前,至少要:(a) 讓 `cleanup()` 只在真的刪除了任務時才呼叫 `persistToDisk()`;(b) 讓純讀取路徑(`get`/`getTimeline`/`getTaskSyncMeta`/`getTimelinePage`)不觸發任何寫入;(c) `persistToDisk` 本身改成非同步(`writeFile`)並加上 debounce/合併批次寫入,避免每次 mutation 都整表重寫。

---

## 2.【高 / security-idor】`orbClarificationEngine.recordAnswer` 更新澄清紀錄時完全沒有 userId 所有權檢查,任何使用者可覆寫他人的澄清答案並污染其學習模型

**發現**:`recordAnswer(clarificationId, userAnswer)`(`server/services/orbClarificationEngine.ts:517-575`)只用 `eq(orbClarificationHistory.id, clarId)` 當 WHERE 條件(:527-533),沒有任何 `userId` 範圍限定,即使 `orbClarificationHistory` 表本身有 `userId` 欄位與對應索引(`drizzle/schema.ts:2965,2991` `userIdx`)。

呼叫鏈確認可從一般使用者對話觸達:`server/services/spiritTools/clarificationEngineTools.ts:56-86` 的 `recordClarificationAnswer()` 原封不動把 `input.clarificationId`(字串,無 userId 參數)轉傳進 `orbClarificationEngine.recordAnswer`;再往上,`server/services/agentToolExecutor.ts:6802-6822`(`clarificationEngine.recordAnswer` 工具分派)把 `args.clarificationId` 直接取自工具呼叫參數(LLM 產出、可被使用者對話內容引導),同樣沒有中途插入 userId 檢查。`orbClarificationHistory.id` 是 `bigint autoincrement`(`drizzle/schema.ts:2963`),跨全站使用者共用同一序列,可枚舉。

對照同檔案群組內**正確**做法:`server/services/orbFeatureDiscovery.ts:553-563` 的 `recordRecommendationInteraction` 明確在 UPDATE 的 WHERE 子句同時比對 `id` 與 `userId`(:559-562),並留有中文註解說明「所有權範圍…防止跨用戶寫入他人的推薦互動列」——顯示團隊清楚這個模式該怎麼做,`orbClarificationEngine.recordAnswer` 的缺漏更像是遺漏而非刻意設計。

**影響**:任何登入使用者(或誘導光球代理呼叫此工具的提示注入)只要猜到/列舉一個屬於別人的 `clarificationId`,就能覆寫該筆紀錄的 `userAnswer`/`answeredAt`。更嚴重的是 `recordAnswer` 內部緊接著呼叫 `updateAnswerPattern(clarification)`(:560,私有方法 :580-650),而 `updateAnswerPattern` 讀的是**被覆寫那筆紀錄自帶的 `clarification.userId`**(即受害者的 userId),因此這次攻擊者塞入的假答案會被寫進**受害者**的 `orbUserAnswerPatterns` 學習模型(:619-627 或 :629-636),當該假答案佔比超過 50% 門檻(:617-618 `sorted[0].frequency / totalFreq > 0.5`)時,未來受害者的澄清問題可能被攻擊者植入的偏好**靜默跳過詢問、直接套用**(:359-366 `generateClarification` 的 `pattern.confidenceScore > 0.8` 分支)。這是跨租戶未授權寫入 + 下游偏好污染的組合風險。

**建議**:`recordAnswer` 簽名加入 `userId`,WHERE 子句改成 `and(eq(id, clarId), eq(userId, callerUserId))`,並在 `agentToolExecutor.ts`/`clarificationEngineTools.ts` 的呼叫鏈中把 `opts.userId`/`ctx.user.id` 一路傳進來(其餘三個 `clarificationEngine.*` 工具——`identifyIntent`/`getPattern`/`getStats`——都已經正確地用 `opts.userId` 而非參數值,可比照辦理)。

---

## 3.【高 / contract-mismatch】`identifyIntent` 的 `primaryIntent` 欄位宣告後從未賦值,意圖分類結果對所有下游消費者永遠是空的

**發現**:`identifyIntent()`(`server/services/orbClarificationEngine.ts:207-335`)在 :213 宣告 `let primaryIntent: string | undefined;`,之後無論走「多意圖」分支(:264-272,只算 `ambiguityScore`)還是「單意圖」分支(:273-276,只算 `intentConfidence`),**都沒有任何一行把 LLM 分類出的意圖字串(如 `detectedIntents[0].intent`)指派給 `primaryIntent`**。這個永遠是 `undefined` 的變數接著被寫進 DB insert(:284)、也被包進回傳的 `IntentLog`(:322),對應的 `orbIntentLogs.primaryIntent` 欄位因此永遠是 NULL。

已確認的下游消費點:
- `server/services/spiritTools/clarificationEngineTools.ts:33` 把 `intentLog.primaryIntent` 原樣回傳給呼叫方(光球代理自己呼叫 `clarificationEngine.identifyIntent` 工具時看到的結果)。
- `server/services/orbConversationEnhancer.ts:85`(經 `orbConversationsRouter.ts:504` 呼叫 `processConversationTurn`)同樣把這個永遠是 `undefined` 的欄位塞進 `EnhancedConversationResult.intentLog.primaryIntent`。

**影響**:`orbClarificationEngine` 存在的**核心目的**就是「識別意圖」,但 LLM 明明已經成功回傳排序過的意圖清單(:245-253),分類結果的「贏家是誰」這個最基本的輸出卻從未落地——無論是寫進 DB 供之後分析,還是回傳給呼叫方(含光球代理自己)做路由決策,`primaryIntent` 永遠是空的。這比先前已修復的 `getStats`「恆回零」(AIDV-196,見 :142-148 註解)是同一類「造假式空實作」問題,但發生在更上游、影響面更廣的位置,且目前看起來從未被標記或修復。

**建議**:在兩個分支各自算完 `ambiguityScore`/`intentConfidence` 後,補上 `primaryIntent = detectedIntents[0]?.intent`(多意圖分支用排序後最高信心度那個;單意圖分支就是 `detectedIntents[0].intent`)。順手替 `orbIntentLogs` 加一筆針對既有 NULL 資料的資料修補評估(此表既有資料的 `primaryIntent` 是否需要回填,超出本檔範圍,未驗證)。

---

## 4.【中 / injection、contract-mismatch】JSON 模式回覆的 `toolCalls[].name` 略過了 marker 模式強制的格式白名單

**發現**:`orbReplyParser.ts` 對同一個「LLM 工具呼叫」概念,JSON 結構化回覆與 legacy marker 語法套用了不同的驗證規則:
- Marker 語法路徑(`[TOOL:name:payload]`,:284-304)在 :288 明確 `if (!ORB_ALLOWED_TOOL_NAME.test(name)) continue;`,用正規表示式(`ORB_ALLOWED_TOOL_NAME`,:103,`/^[a-z][a-z0-9_.-]{1,63}$/i`)過濾工具名稱格式。
- JSON 模式路徑(:161-171)的 `toolCalls` 篩選只檢查 `typeof (t as {name?:unknown}).name === "string"`,**完全沒有**套用 `ORB_ALLOWED_TOOL_NAME`,任何字串(含空字串以外的任意內容)都會被接受成 `name`。

**影響**:這個落差目前有多大實際攻擊面**未在本檔驗證**——`agentToolExecutor.ts` 的工具分派看起來是以 `switch(call.name)`/精確字串比對逐一分派(如本檔核對過的 `dispatchClarificationEngineTool`,`server/services/agentToolExecutor.ts:6764-6863`),若下游對未知工具名一律回「unknown tool」錯誤,則此處格式驗證主要是防禦縱深而非唯一關卡,實際可利用性偏低;但只要有任何消費者假設 `OrbParsedReply.toolCalls[].name` 已經符合 `ORB_ALLOWED_TOOL_NAME`(例如拿去做日誌格式化、正則比對、或未來新增的動態分派邏輯時未重新檢查),兩條解析路徑對同一欄位的信任等級不一致就可能被繞過。

**建議**:讓 JSON 模式的 `toolCalls` 過濾也套用 `ORB_ALLOWED_TOOL_NAME.test(t.name)`,兩條路徑收斂成同一組驗證規則。

---

## 5.【中 / deadcode、northstar】`orbFeatureDiscovery` 五個「未實作 stub」中,唯一真的被使用者觸達的那個反而沒有 telemetry 警告

**發現**:`orbFeatureDiscovery.ts:93-101` 定義了 `warnNotImplemented()`,用來在 stub procedure 第一次被呼叫時印一次 deprecation 警告,讓 staging/prod telemetry 看得到「有人在呼叫沒實作的功能」。這個警告確實掛在 `findSimilarFeatures`(:631)、`getProficiencyProgression`(:670)、`searchFeatures`(:713)、`getLeaderboard`(:761)四個方法上——但這四個經全文檢索(`grep -rn` 於 `server/`)**完全沒有任何外部呼叫者**,是真正的死碼。

而 `getDiscoveryInsights`(:582-615)——同樣是「TODO: Aggregate data from database」尚未實作、永遠回傳全零統計的 stub——**沒有呼叫 `warnNotImplemented()`**。但這個方法已確認是唯一真的被接上使用者可觸達路徑的一個:`server/services/spiritTools/featureDiscoveryTools.ts:174,185` 呼叫它,再經 `server/services/agentToolExecutor.ts:6887,6974` 的 `featureDiscovery.getInsights` 工具分派,讓光球代理可以在真實對話中呼叫。

**影響**:五個「假 stub」裡,telemetry 警告精準覆蓋了四個**永遠不會被呼叫**的死碼,卻漏掉了那個**真的會被使用者觸發**的方法——正好與「哪裡最需要監控可見度」的優先順序相反。使用者若透過光球問「我的功能發現進度如何」之類問題,得到的永遠是「發現 0 個功能、使用 0 個功能」這種全零假資料,而 ops 端沒有任何日誌訊號能察覺這件事在發生。

**建議**:在 `getDiscoveryInsights` 內補上 `warnNotImplemented("getDiscoveryInsights")` 呼叫,並評估是否該把这个方法優先真正實作(它是五個裡面唯一有實際流量的)。

---

## 6.【低 / injection,已作保留判斷】`orbTaskChainRunner` 的 replan recap 訊息不經過與同源記憶體字串相同的注入防護包裝——但這是團隊已記錄在案的刻意決策,非本波發現的新缺口

**發現**:`tryReplanAndCreateTask()`(`orbTaskChainRunner.ts:178-318`)把觀察員(`observeOrbTaskOutcome`)產出的 `observation.reason`/`observation.suggestedNextAction`,以及 `prevRunResult.outcome`/`prevRunResult.reason`,原樣塞進 `buildReplanRecapMessage()`(:152-169)組出的文字,並以 `{ role: "user", content: recap }`(:190)的身分附加進對話歷史,重新丟給 planner。同一函式緊接著在 :215-217 把**另一個**欄位(`memoryContext.summary`,RAG 檢索出的長期記憶)包上 `guardOrbMemorySummary()` 才賦值——程式碼註解(:209-214)明確寫著這是刻意的:「`buildReplanRecapMessage` 拼的執行狀態/觀察員輸出是內部受信任、另走 recap 不在此包」。

進一步核對 `server/services/security/ragInjectionGuard.ts` 檔頭(非本波稽核清單內檔案,僅輔助佐證)確認同一句話:「buildReplanRecapMessage 拼的受信任執行狀態不在此包」是團隊在 AIDV-69 就已經明確評估、記錄在案的範圍決策,不是本波才發現的疏漏。

**影響(保留判斷,未升級為缺陷)**:`observeOrbTaskOutcome` 組出的 transcript(`orbTaskObserver.ts:195-208`,非本波稽核清單內檔案,未逐行深挖)包含每個工具呼叫的 `tool.data`/`tool.error` 預覽——如果任務鏈中有工具會抓取外部/第三方內容(例如網頁搜尋類工具的回傳文字),理論上存在「外部內容→observer LLM 摘要→回灌下一輪 planner 對話」的間接注入路徑,是否真的成立取決於(a) 當前接線的工具清單裡有沒有這類會引入外部不可信文字的工具,(b) observer 系統提示詞(:293-311)對「不要照抄」的約束在實務上是否足夠——這兩點都**未在本次稽核的六個檔案範圍內驗證**。由於此鏈路多半發生在同一使用者自己的任務執行結果上(非跨租戶),就算真的可利用,影響範圍預期也侷限在使用者自己的任務鏈,而非資料外洩到其他帳號。

**建議**:若要徹底排除疑慮,建議盤點目前掛在 orb 工具白名單裡、真的會引入外部/第三方文字內容的工具(如果有的話),確認 `orbTaskObserver.ts` 的 `summarizeExecutionForLLM` 是否有對應的長度/內容防護,而不是僅信賴系統提示詞的「不要照抄」約束。此項為問題浮現(surface),非確認缺陷。

---

## 7.【低 / other】`orbTaskStore.reportStep` 對「同一步驟重複回報」沒有幂等處理,可能把重試請求誤判為步驟不符而讓成功任務假性失敗

**發現**:`reportStep()`(`orbTaskStore.ts:333-381`)比對 `task.steps[task.currentStepIndex].id` 是否等於 `input.stepId`(:339-340);若任務已經因為第一次成功的回報把 `currentStepIndex` 往前推進,同一個 `stepId` 的**重複**回報(例如網路逾時後客戶端重試同一個 tRPC mutation)會落入「步驟不符」分支(:340-346),直接把任務標記為 `failed`,且不會在 `stepReports` 留下任何說明這次失敗其實是「回報重複」的紀錄。

**影響**:這個行為在「客戶端從未重試」的理想情況下沒有問題;一旦上層(`server/routers/ai.ts` 的 `reportTaskStep` mutation,或更上游的 `executeCurrentStepTools`/`agentToolExecutor.ts`,均非本波稽核清單內檔案)沒有對重複請求做幂等去重,一次良性的網路重試就可能讓原本會成功的任務被判定失敗。**是否有上層去重機制,未在本波六個檔案範圍內驗證**——`agentToolExecutor.ts` 內看到的 `requestId` 目前看起來只用於稽核事件關聯(`server/services/agentToolExecutor.ts:541-542` 未提供時會用亂數現生成一個),沒有觀察到用它做「同一 requestId 已處理過就跳過」的邏輯,但未逐行確認整個工具執行路徑。

**建議**:若要處理,可在 `reportStep` 增加「若 `input.stepId` 對應到**已經**成功回報過的步驟(存在於 `stepReports` 且 `ok:true`),視為重複回報並回傳目前任務狀態而非強制轉 failed」的幂等短路。

---

## 8.【低 / other】`orbClarificationEngine.getStats` 對單一使用者的澄清紀錄查詢沒有筆數上限

**發現**:`getStats(userId)`(`orbClarificationEngine.ts:697-743`)的兩個查詢(:702-710 選 `orbClarificationHistory`、:712-718 選 `orbUserAnswerPatterns`)都只用 `where(eq(..., userId))`,沒有 `.limit()`。對照同檔案的 `getHistory(conversationId, limit = 20)`(:655-692)有明確預設上限。長期重度使用者的澄清紀錄若持續累積,`getStats` 這種「每次呼叫都撈全表」的模式會隨使用時間線性變重。

**影響**:目前規模下影響有限,屬於效能債而非正確性缺陷。

**建議**:視資料量成長情況評估是否要加時間窗或筆數上限(例如只聚合近 N 天/近 M 筆)。

---

## 附:與本檔六個服務相關、已在其他既有研究文件記錄過的發現(交叉引用,非本波重複計入)

以下項目在深挖本波六檔時有直接接觸到對應程式碼,但**已由既有研究文件以更完整的追蹤定位過**,本文件僅標註「本檔可見的佐證」,不重複列入上方嚴重度排序,以避免灌水:

1. **`execute_task` 未被列入 `ORB_DESTRUCTIVE_ACTIONS`**——`orbReplyParser.ts:92-101` 的 `ORB_DESTRUCTIVE_ACTIONS` 集合包含 `execute_generate_image` 但不包含 `execute_task`,代表光球若讓 LLM 直接生成一個 `execute_task` 動作、且沒有明確 `[CONFIRM:true]`,`askBeforeAct` 的「破壞性動作自動要求確認」保險絲(:330-332)不會被觸發。此落差在本檔可獨立驗證,但根因與更完整的影響鏈已由 `docs/research/U2-ai-chat-orchestration-deepdive.md`(§「execute_task / execute_generate_image 在converted與legacy fallback分支內同步內嵌執行,完全繞過成本守衛…」,標記【嚴重】)定位到 `ai.ts`/`shared/agent-plan-safety.ts` 層級的具體行號,判定為「四層防線同時失守」的更根本問題。本文件不重複列為新發現,僅記錄本檔(`orbReplyParser.ts`)是這個落差的其中一個可見症狀。

2. **orbTaskChainRunner 的 chain 終止事件對前端不可見**——`docs/research/V2-orb-task-engine-deepdive.md` §2.1 已定位至少 4 條 `orbTaskChainRunner.ts` 的 stopReason 路徑(observer 拋例外 :392-401、replan 失敗 :450-461、`no_continuation_context` :434-438、`max_iterations` 提前 break :428-432)不會產生前端可辨識的 terminal-kind 事件,判定為【嚴重-新發現】。本波重讀同一檔案時行為一致,不重複列入。

3. **`resolveRecentTaskMemory` 疊加假性失敗紀錄的下游放大效應**——`docs/research/V2-orb-task-engine-deepdive.md` §2.2 已記錄,本波未發現與此矛盾或補充的新事實。

---

## 負向結果(verified negative — 找過但沒發現問題的地方)

- **`orbUnifiedSearch.ts` 的四個資料來源皆正確以 `ctx.user.id` 範圍限定**:呼叫端 `server/routers/orbProxyRouter.ts:171-182` 用 `protectedProcedure`,`userId` 來自 session 而非用戶輸入;結果快取鍵(`buildResultCacheKey`,:494-503)包含 `u${userId}`,未發現跨用戶快取污染。
- **`orbTaskStore.ts` 自身的 `approve`/`approveStep`/`isStepApproved`/`hasUnexpiredStepApproval`/`reportStep`/`injectRevisedSteps`/`getTimeline`/`getTimelinePage` 均先呼叫 `this.get(taskId, userId, now)` 做所有權檢查**,未發現與 §2 同類的 IDOR(§2 的問題僅存在於 `orbClarificationEngine.recordAnswer`,並非同一批服務普遍存在的模式)。
- **`orbTaskStore.injectRevisedSteps` 直接對 `task.status` 賦值繞過 `canTransition`**(:326,`failed→running`)是程式碼註解(:284-290)明確記載的「replan 路徑的既定例外」,已核對非疏漏。
- **本波六檔均未發現觸碰計費/扣款邏輯**:`orbFeatureDiscovery.ts:108` 自述「純加性、唯讀真實使用資料,不觸碰任何計費/扣款路徑」,逐行核對後未發現與此矛盾的程式碼;`orbClarificationEngine.ts`/`orbUnifiedSearch.ts`/`orbReplyParser.ts`/`orbTaskStore.ts`/`orbTaskChainRunner.ts` 同樣未見配額扣減或計費呼叫(配額/預算閘門邏輯位於 `ai.ts` 等本波範圍外的檔案)。
- **`orbTaskChainRunner` 的迴圈上限確實有界**:`clampMaxIterations`(:141-144)保證落在 `[1, HARD_CAP_ITERATIONS=4]`(:125),`for` 迴圈(:357)以此為界,未發現可以繞過硬頂造成無限重試/無限 LLM 呼叫的路徑。
- **`orbFeatureDiscovery.generateRecommendations` 的跨用戶熱度聚合只回傳 `featureId`/`totalUsage`/`userCount` 彙總值**(:454-462),未發現逐筆洩漏其他使用者身份或個別紀錄的路徑。
- **`orbTaskPlannerContextStore.ts`/`orbTaskPageStateStore.ts`(orbTaskChainRunner 的兩個相依 store,非本波稽核清單內檔案但為理解 R15 對照而檢視)確認同為純 in-memory(30 分鐘 TTL Map),程式碼註解明確承認「process 重啟即遺失是可接受的 fallback」**——這代表就算日後把 R15 的 FSM 持久化補上,`ORB_OBSERVATION_LOOP=1` 這條 continuation chain 在重啟後仍無法恢復續跑所需的 planner 上下文,是 R15 修復範圍需要額外納入考慮、但目前尚未被既有文件(P6/K3/N3)點名的相依面;本波僅止於確認其存在與其設計文件自述的「可接受」判斷,未進一步評估是否需要修正。
