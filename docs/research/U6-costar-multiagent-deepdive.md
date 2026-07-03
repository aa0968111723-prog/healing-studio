# U6 — Director CO-STAR 雙引擎與多代理協作內部逐行深挖(對抗式)

- 產生日期:2026-07-03
- 依據 commit:`7f4417da`
- 屬性:「逐檔深挖 wave U」— 對抗式挑錯,不重複 `E-ai-agents.md`/`G3-orb-tools-spirits.md`/`R3-eval-planner-deepdive.md` 已列項目,只列**新發現**(每條標注新舊)
- 逐行讀的檔案:`server/services/director/costarService.ts`(322 行,全讀)、`server/services/director/personality.ts`(126 行,全讀)、`server/routers/director.ts`(chat 端點與 world-context 載入,約 300 行)、`server/services/perplexityThrottle.ts`(全讀)、`server/services/security/ragInjectionGuard.ts`(全讀)、`server/services/agentCommunicationBus.ts`(全讀,369 行)、`server/services/agentDiscussionRunner.ts`(全讀,434 行)、`server/services/agentCollaborationOrchestrator.ts`(全讀,889 行)、`server/services/collaborativeTaskPlanner.ts`(全讀,406 行)、`server/services/multiAgentDetector.ts`(全讀,309 行)、`server/services/multiAgentIntegration.ts`(全讀,273 行)、`server/routers/_aiHelpers.ts`(driveOrbTaskInBackground 段)、`server/routers/agentCollaborationRouter.ts`(startAutoDiscussion/getCollaborationMessages/executeProtocolHandoff 段)、`shared/orb-agent-roles.ts`(SPIRIT_COLLAB_PROTOCOL 全表,2043-2295 行)、`shared/agent-communication-protocol.ts`(deadline/createCollaborationRequestMessage 段)

---

## 發現清單(依嚴重度排序,每條:【嚴重度/類型】問題 → 證據 → 影響 → 新/舊)

### 1.【高/安全】CO-STAR Step 2 把 Step 1 的即時網路研究結果原樣塞進 system prompt,完全不經 RAG 注入 guard —— 即使旗標開了也一樣

- **證據**:`costarService.ts:211-213` 抽出 `researchContent`(Perplexity Sonar 帶 web grounding 的真實回覆,含使用者可能觸發到的任意網頁內容);`costarService.ts:216-229` Step 2 呼叫 `invokeLLM` 時,system prompt 直接寫 `${fullDirectorPrompt}${worldSection}\n\n基於以下研究資料...\n${researchContent}` —— `researchContent` **沒有**經過 `guardRetrievedContext`/`neutralizeInjectionMarkers` 任何一步,對照同檔案裡 `memoryContext`/`worldContext` 都有 `guardOn` 分支(:100-105、:125-128)。
- 交叉核對 `ragInjectionGuard.ts` 檔頭「⚠️ 目前實際接線範圍」明文列出「✅ 已接線:Director 三條 RAG 記憶／世界框架注入路徑(costarService / planningService / scriptGenerationService)」——這份自我盤點**遺漏了 Step1→Step2 這條路徑**,而它是全站唯一一處把「即時網路檢索全文」直接餵給下一輪 LLM 當 system prompt 的地方(其他注入點都是使用者歷史 prompt/RAG 記憶,不是即時抓來的網頁內容)。
- **影響**:攻擊面是「使用者問一個會讓 Sonar 檢索到惡意頁面(含 prompt injection 樣式,如 "ignore previous instructions...")的問題」→ Sonar 若在回覆中重現該樣式 → Step 2 的創作階段系統提示詞直接被污染,可能導致 CO-STAR 腳本被劫持(例如竄改 visualPrompt/audioScript 內容,或讓模型忽略人格/安全提示詞)。這是全案唯一「未過旗標保護傘」的真實外部資料注入點。
- **新/舊**:**新發現**(E 文件 §5.3 注入點總表只列了 director 的 RAG 記憶段+世界框架段,未提及 Step1 研究輸出這條路徑;ragInjectionGuard.ts 檔頭自身的「已接線」聲明也漏掉了它)。

### 2.【高/嚴重】`ORB_MULTI_AGENT_ENABLED=1` 打開後,判定要協作的任務會被靜默放棄執行,而非「協作團隊只有 lead 真跑」

- **證據**:`server/routers/_aiHelpers.ts:104-138`(`driveOrbTaskInBackground`)—— `if (isMultiAgentRoutingEnabled() && plannerContext) { ... const multiAgentResult = await runOrbTaskWithOptionalMultiAgent({...}); if (multiAgentResult.mode === "multi-agent-collaboration") { console.log("multi-agent collaboration completed: ..."); } ... }`。這是 `if / else if (ORB_OBSERVATION_LOOP) / else` 三選一結構,一旦進入這個分支,原本驅動任務真正執行的 `runOrbTaskToCompletion(...)`(在 `else` 分支,:198-221)**完全不會被呼叫**。
- 追進 `multiAgentIntegration.ts:140-200`(`runOrbTaskWithAutoRouting` Phase 3):偵測到 `shouldCollaborate` 後只做了 `await AgentCollaborationOrchestrator.startCollaboration(collaborationRequest)` 然後 `return { mode: "multi-agent-collaboration", collaborationSession, ... }`。`startCollaboration`(`agentCollaborationOrchestrator.ts:379-457`)只是建一筆 `status:"active"` 的 session(記憶體 Map + DB insert)就回傳 —— **沒有任何後續程式碼呼叫 `executeHandoff`、`runAutoDiscussion`,或把 `collaborativeTaskPlanner` 的分解結果接進來**。
- **影響**:原本這個 orb task 的 FSM(`orbTaskStateMachine`)在核准後應該被 `runOrbTaskToCompletion` 驅動一步步跑完(工具呼叫、扣點、資產寫入);打開這個旗標後,只要 heuristic 判定要協作,任務就會**卡在「已核准但沒人執行」的狀態,永遠不會完成,也不會被標記失敗**(`_aiHelpers.ts` 的 `catch` 區塊只在丟出例外時才把任務標 failed,這裡沒有例外,是「正常返回但什麼都沒做」)。日誌卻印出「multi-agent collaboration **completed**」這種讓維運誤判「已完工」的訊息(實際上只是「已啟動」)。
- **新/舊**:**新發現、且比 E 文件已知結論更嚴重**。E 文件 §9.2-4 說的是「協作團隊 chip 只有 lead 真跑」(那是 `ai.chat` 主聊天回合裡的 UI 展示層,和這裡是不同機制);這裡是**任務核准後的背景驅動層**,結論是「協作團隊誰都沒跑,任務直接卡死」。這正面回答任務項 6(「開了會怎樣」)——答案是:會讓一部分任務(被 heuristic 判定為需要協作的)從「單代理能跑完」退化成「完全跑不動」。

### 3.【高/架構】`collaborativeTaskPlanner.ts` 全站零呼叫者 —— 整個「任務分解→執行計畫」模組是孤兒程式碼

- **證據**:`grep -rln "collaborativeTaskPlanner\|CollaborativeTaskPlanner"` 在整個 repo(server/client/tests)只命中它自己的檔案 `server/services/collaborativeTaskPlanner.ts`。無 router 掛載、無 service 呼叫、無測試引用。
- 檔案本體邏輯完整:`decomposeTask()` → `analyzeTaskType()`(關鍵字判模態)→ `generateSubtasks()`(按模態分派 subtask 給對應 specialist)→ `createExecutionPlan()`(依 `dependsOn` 拓樸分層出 `sequential/parallel/mixed` stage)→ `createCollaborationRequests()`(轉成可送進 orchestrator 的 request),寫得像是要接進 `AgentCollaborationOrchestrator`,但從未被接上。
- **影響**:直接回答任務項 3(「與 agentPlanner 的關係、重複?」)——兩者**不重複**,因為 `collaborativeTaskPlanner` 根本沒有在跑;它是一個平行世界的「多代理任務分解」草案,和真正在跑的 `agentPlanner.ts`(schema-first,單代理 plan)完全沒有交集。若團隊誤以為「多代理協作已經有一套任務分解在用」,實際上那套程式碼從未被執行過一次。
- **新/舊**:**新發現**(E 文件 §1.4 表格列出這個模組的「職責」欄,但沒有指出它是死代碼;本文件補上這個關鍵事實)。

### 4.【中/單位錯誤,潛伏於死代碼內】`deadline` 欄位被塞入「持續時間」而非「絕對時間戳」

- **證據**:`collaborativeTaskPlanner.ts:369-382`(`createCollaborationRequests`)—— `deadline: subtask.estimatedDurationMs`,而 `estimatedDurationMs` 是像 `30000`(30 秒,ms 相對值)這種數字。對照 `shared/agent-communication-protocol.ts:200` `deadline?: number` 及其唯一消費處 `createCollaborationRequestMessage`(:394-421):`priority: request.deadline ? "high" : "normal"` —— 這裡只把 deadline 當「有沒有設」的布林旗標用,尚未出事;但如果未來有任何消費端把 `deadline` 當「絕對到期時間戳」比較(`Date.now() > deadline`),`30000` 這種值換算成日期是 1970 年 1 月 1 日,等於「一開始就已經過期」。
- **影響**:因為 #3 已確認 `collaborativeTaskPlanner` 是死代碼,此 bug 目前不會在 production 咬人;但若日後有人把它接上(例如接進 `AgentCollaborationOrchestrator.startCollaboration` 的 `requiredCapabilities`/`deadline` 語意),會直接複製這個單位錯誤,且因為現在唯一的消費邏輯只做布林判斷,不會有測試/型別系統攔下它。
- **新/舊**:**新發現**(死代碼內的潛伏 bug,獨立於 #3)。

### 5.【中/一致性】自動討論 `maxRounds` 三個數字互相矛盾:文件說 3、router 允許到 24、runner 實際硬夾到 5

- **證據**:
  - `agentDiscussionRunner.ts:84`(`DEFAULT_MAX_ROUNDS = 3`)+ `:271`(`Math.max(1, Math.min(input.maxRounds ?? DEFAULT_MAX_ROUNDS, 5))`)—— 實際硬性上限是 **5**,不是 3。
  - `agentCollaborationRouter.ts:434`(zod `maxRounds: z.number().int().min(1).max(24).optional()`)+ 註解「最多 24」—— API 合約允許使用者要求到 **24** 輪。
  - `agentCollaborationRouter.ts:514,522` 把 `input.maxRounds ?? 3` **原樣 echo 回前端**當作回應欄位,前端如果依此顯示「已設定 24 輪討論」,實際 runner 會在第 5 輪被硬性砍斷,使用者收到的回應宣稱值與真實行為不一致。
  - E 文件 §1.4/G3 的既有描述是「上限 3 輪」,與程式碼實際的 5 也對不上。
- **影響**:三個數字(3 / 5 / 24)沒有一個地方是全部一致的單一事實來源;使用者體感是「我明明設定了更多輪,怎麼提早結束」,且 API 回應本身就會誤導前端。
- **新/舊**:**新發現**(具體揪出三方數字矛盾,E 文件只籠統寫「上限 3 輪」)。

### 6.【中/設計缺陷】靜音/白名單排除會偷偷吃掉一輪討論預算

- **證據**:`agentDiscussionRunner.ts:302-314`——`for (let round = 0; round < maxRounds; round += 1) { const skipReason = muted.includes(currentAgent) || (allowedSet && !allowedSet.has(currentAgent)); if (skipReason) { const next = pickNextAgent(...); if (!next) { stoppedReason = "no-handoff"; break; } currentAgent = next; continue; } ... }`。`continue` 会觸發 for 迴圈的 `round += 1`,所以「被跳過、換下一位候選人」跟「真的請一位精靈發言」消耗的是同一份 `round` 預算。
- **影響**:使用者靜音的精靈越多(或 `allowedFamilies`/`allowedRoles` 篩得越窄),第一棒/中途換人的次數就越多,每換一次就少一輪「真正的發言」,但使用者要求的 `maxRounds` 數字完全沒變——最終產出的討論輪次會系統性地少於預期,且沒有任何欄位告知「這輪其實是在跳過某人」。
- **新/舊**:**新發現**。

### 7.【中/併發缺陷,目前死代碼】`AgentCommunicationBus.query()` 用 `Date.now()` 當 ID、且完全不檢查 correlationId

- **證據**:`agentCommunicationBus.ts:298-361`(`query()`)—— `messageId: \`query_${Date.now()}\``(:326)、`correlationId: \`query_${Date.now()}\``(:336);訂閱端比對邏輯(:306-311)只檢查 `message.messageType === "response" && message.fromAgent === toAgent && !resolved`,**完全沒有比對 correlationId**。
- **影響**:若同一對 `(fromAgent, toAgent)` 同時有兩個以上併發的 `query()` 呼叫(例如兩個不同 UI 面板同時問同一位精靈),先到的回覆會被任一個尚未 resolve 的訂閱「認領」,造成兩筆查詢的回答互相錯配;`Date.now()` 在同一毫秒內併發呼叫也會產生相同 ID。目前 `grep -rn "AgentCommunicationBus.query("` 全站零呼叫者,暫不影響 production,但這是一段已經寫好、一旦被接上就會咬人的併發 bug。
- **新/舊**:**新發現**(bus 本身的 in-memory/單機限制是已知,但 `query()` 這個併發邏輯漏洞是新的)。

### 8.【中/生命週期】`AgentCollaborationOrchestrator.activeSessions` 只讀記憶體、無 DB fallback,且「卡住」的 session 永遠不會被清理

- **證據**:`agentCollaborationOrchestrator.ts:53`(`private activeSessions: Map<string, CollaborationSession>`)——`getSession`/`getSessionStatus`(:786-797)、`executeHandoff`(:629-640)、`executeProtocolHandoff`(:562-565)全部只查這個記憶體 Map,從不 fallback 查 `agentCollaborationSessions` 表(唯一查 DB 的地方是 router 層 `getCollaborationMessages` 為了驗證 owner,:341-365,但只讀 `userId` 不會把 session 復原進記憶體)。
- 清理機制只在 `completeCollaboration` 成功呼叫後才設 1 小時 `setTimeout` 刪除(:778-780);**如果一個 session 從未走到 complete/cancel(例如呼叫端邏輯漏掉、process 中途重啟),它會永遠留在 Map 裡**,沒有任何 TTL/GC 掃過期 session。
- **影響**:①Railway 重啟/重佈署後,所有進行中的協作 session 從 orchestrator 角度徹底消失,但 DB row 仍卡在 `status:"active"` 永遠不會被標記完成/失敗(殭屍 session,`listUserCollaborations` 之類的查詢若走 DB 會一直看到假的「進行中」);②長期運行下,任何未正常收尾的 session 都會無界累積在記憶體,是資源洩漏風險。
- **新/舊**:**新發現**(病灶類型與 E 文件已知的 `orbTaskStateMachine` in-memory 問題相同,但這是完全獨立的另一個子系統,且多了「無限累積卡住 session」這個更具體的新問題,E/G3/R3 均未提及)。

### 9.【中/回答任務項 5】協作能力註冊表宣告的部分 `availableTools` 依 G3 已證實的 gate 規則其實不可達

- **證據**:`agentCollaborationOrchestrator.ts` 的 `initializeAgentCapabilities()` 給多個角色登記了 `availableTools`,例如 `accountant`(:183-190,6 個 `accountant.*`)、`quality-coach`(:204-209,4 個 `qualityCoach.*`)、`legal-advisor`/`community-manager`(:235,261,`research.deepSearch`)。而 `agentToolExecutor.ts:708`(`if (call.name.startsWith("studio.") || call.name.startsWith("director."))`)是 `dispatchStudioTool` 巨型 switch 的唯一入口閘門 —— 這與 G3 文件已證實的「194 個 case 只有 37 個可達,178 個 `<spirit>.<tool>` 橋接是孤兒」完全對應:`accountant.*`/`qualityCoach.*`/`research.deepSearch` 這些名稱都不是 `studio.`/`director.` 前綴,因此若真的透過這條 executor 路徑呼叫,一律不可達。
- **影響**:`findBestAgent()`(:462-526)的評分邏輯會拿這些「其實打不到」的工具名字去給 agent 加分、決定「誰最適合接這個任務」,但這個分數與工具實際能不能執行完全脫鉤;若協作路徑（一旦 #2 的問題被修好、真的開始執行）依賴這份 capability 表去派工,踩到這些工具名稱時會靜默失敗或需要额外一層轉譯(例如靠 `@暱稱` 聊天走 `spirit.invoke` 而非這裡列的 `availableTools`)。
- **新/舊**:**新發現的組合**(G3 的 178-工具-不可達本身是已知結論,但把它具體對應到「多代理協作能力註冊表用來排序/選人的工具清單」這個新的受害面,是本文件新補上的)。

### 10.【低/資料一致性】`SPIRIT_COLLAB_PROTOCOL` 表尾語法瑕疵 + 總總(chief-orchestrator)是純入口節點

- **證據**:`shared/orb-agent-roles.ts:2295` 結尾是 `};;`(多一個分號,語法上無害但顯示未過 lint-fix / 格式化)。掃過全表 25 個角色的 `handoffs`,沒有任何一條 `{ to: "chief-orchestrator", ... }`(`chief-orchestrator.receivedFrom` 本身也明寫 `[]`,:2240)。
- **影響**:「總總」在真實 handoff 圖裡只能被當成**討論/協作的起始角色**(由 `multiAgentDetector` Heuristic 0b 或使用者 `@總總` 觸發),永遠不會被其他精靈在流程中自然交棒進來——即使某些情境語意上該由其他精靈主動交給它(例如「多任務並行需要總覽」),協定裡沒有這條邊,只能靠使用者自己想到要點總總。這是文件（`receivedFrom` 欄）與圖本身互相印證但可能非預期的設計限制。
- **新/舊**:**新發現**(細節層級,標為低嚴重度)。

### 11.【中/性能與體感】CO-STAR 雙引擎嚴格序列,無串流/進度回報,worst-case ~135 秒使用者盯著空白

- **證據**:`costarService.ts` Step 1(`withTimeout(..., 90_000, "導演AI研究")`,:168-210)完全 `await` 完才進 Step 2(`withTimeout(..., 45_000, "導演AI創作")`,:216-280)——兩段是純序列而非並行/串流,worst case 為 90s + 45s = 135s。對照 `ai.chat` 主管線有 `emitOrbChatProgress` 進度時間軸(received→calling_specialist→researching_web→...→finalizing,E 文件 §1.1 已載),`director.chat` 這條路徑**沒有任何等效的分階段進度回報**——前端只能整個等 `mutation` resolve,中途沒有「研究中/創作中」的中間狀態可顯示。
- **影響**:在 Sonar 端本身就有「25-45s 是常態」的既有背景（程式碼註解自陳)的前提下，把兩段串起來變成 up to 135s 的單次無回饋等待，比 `ai.chat` 的體驗明顯倒退一個世代。
- **新/舊**:**新發現**(E 文件只記錄了 90s 這個數字本身的由來,沒有指出兩段相加的 worst-case 與缺乏進度回報的落差)。

### 12.【中/成本】Perplexity 節流配額在「請求發出前」就先扣,失敗/超時不退還

- **證據**:`costarService.ts:158-164`——`const throttleCheck = apiKeyAvailable ? checkAndConsumePerplexity({ feature: "director_research", userId }) : ...`,而 `checkAndConsumePerplexity`(`perplexityThrottle.ts:264-270`)在 `allowed=true` 時立刻呼叫 `recordPerplexityCall` 累計計數器 —— 這發生在真正的 `invokeLLM` 呼叫(:168-210)**之前**;若該次呼叫因為 Step 1 本身的 90s timeout(見 #11,程式碼註解自陳「舊 30s 上限造成頻繁超時」是真實發生過的生產問題)而失敗,配額仍然被算掉,沒有任何退還機制。
- **影響**:在研究階段本來就容易超時的前提下(這是程式碼自己承認的既有現象),每一次超時都會不聲不響地消耗使用者的每小時/每日 Perplexity 額度(預設 30/hr、100/day,`perplexityThrottle.ts:118-127`),使用者可能在還沒拿到任何一次成功的導演研究結果之前就先撞到「今天的查詢已達上限」。
- **新/舊**:**新發現**。

---

## 未讀完 / 缺讀聲明

- `orb-agent-roles.ts` 中 `pickBestHandoff`/`getRoleSystemPromptSlice`/`getFamilyForRole` 等輔助函式本體只讀了呼叫端用法,未逐行核對其評分演算法(`busyRoles`/`recentRoles` 扣分細節)。
- `agentCollaborationOrchestrator.ts` 的 DB persist 分支(`agentCollaborationSessions`/`agentCollaborationHandoffs` 表 schema、`version` 樂觀鎖欄位)未深入核對是否真的能在 #8 的「重啟後復原」情境派上用場(目前結論是「即使 DB 有資料,讀路徑也沒接上」,但 DB 表本身的欄位完整度未逐一核對)。
- `scriptAnalysisService.ts`/`scriptGenerationService.ts`/`planningService.ts`(director 同目錄其他服務)未逐行讀,只在 E 文件既有基礎上確認它們同樣接 `ragInjectionGuard`(檔頭聲明),未驗證是否也有類似 #1 的「Step 間 handoff 內容未過 guard」問題。
- `spiritStatusMonitor.ts`(`agentCollaborationOrchestrator.ts` 用來查 `busyRoles`)未讀,無法評論其「busy」判定是否即時準確。
- `agentEventBus.ts`(collaboration 完成/取消時 emit 的事件匯流排)未讀,未確認前端是否真的訂閱這些事件或只是輪詢。
