# U2 — ai.chat 編排主體逐行深挖(對抗式找隱藏問題)

- 產生日期:2026-07-03
- 依據 commit:`7f4417da`(工作樹 HEAD 對應 `aef4214178`/`1b50a89e` 系列 docs commits,程式碼同源)
- 波次:**逐檔深挖 wave U**
- 承接(不重複其已確認內容,只找新問題):`E-ai-agents.md`(17 階段管線總圖/入口/旗標矩陣)、`G3-orb-tools-spirits.md`(178 個精靈工具 executor 不可達)、`R2-rag-memory-deepdive.md`(記憶五層/RAG 雙引擎)、`R3-eval-planner-deepdive.md`(eval 系統/planner 鐵則/replan 迴圈)
- 方法:逐行實讀 `server/routers/ai.ts` 的 `ai.chat`(:434-2994)+ `ai.chatProgress`(:3002-3016)全部程式碼(非摘要),交叉讀 `server/services/orbIdempotency.ts`、`server/services/orbChatProgress.ts`、`server/services/orbTaskExecutor.ts`、`server/services/falDispatcher.ts`(TIMEOUT_OVERRIDES/dispatchFalTask)、`shared/agent-plan-schema.ts`、`shared/agent-plan-adapter.ts`、`shared/agent-plan-safety.ts`(evaluateAgentPlanV3Risk 全文)、`server/services/agentPlanner.ts`(applyModerationGate)、`server/db.ts`(getSiteWideModelUsageSnapshot/createApiUsageLog)全文對照;以 grep 佐證「全 repo 唯一呼叫點」等否定性主張(非猜測)。

**未讀完聲明**(先講在前面):`ai.chat` handler 本體(434-2994,共約 2,560 行)已逐行讀完;`orbTask.approve`/`driveOrbTaskInBackground`/`orbTaskOrchestrator`/`orbTaskChainRunner` 之後的執行鏈本波**沒有**重讀(E 文件已涵蓋,本波只讀到「tasked 分支把 task 交出去之前」為止);`agentPlanner.ts` 只針對 `applyModerationGate` 與其呼叫序做定點驗證,未逐行覆讀全 1,163 行(R3 已逐行讀過,本波信任其結論並疊加新交叉點)。

---

## 核心發現(本波最重要的新問題,對應任務項 2+3:工具執行接點/confirmation 閘/成本 moderation quota 在鏈上位置)

### 【嚴重】新發現:`execute_task` / `execute_generate_image` 在「converted」與「legacy fallback」分支內同步內嵌執行,完全繞過成本守衛、生成配額、逐欄內容審核、使用者工具黑名單——四層防線同時失守

**位置**:`server/routers/ai.ts:2179-2249`(schema-first planner「converted」分支)與 `ai.ts:2742-2809`(legacy fallback 分支)。兩處程式碼幾乎逐行相同(明顯是複製貼上)。

**觸發路徑**:
1. `runSchemaFirstAgentPlanner` 對某輪對話判定 `decision.mode = "direct"`(→ adapter 產出 `status: "converted"`,`shared/agent-plan-adapter.ts:773-807`)。
2. Planner system prompt 只在**文字層級**要求「Switch to decision.mode='direct' only for single-page low-risk fillPrompt-style requests」(`agentPlanner.ts:494`)——但這條規則**沒有任何 schema/風控程式碼強制**:
   - `AgentActionTypeSchema`(`shared/agent-plan-schema.ts:7-23`)裡 `execute_task` 是合法的 step action 之一,沒有被限定只能出現在 `decision.mode==="tasked"`。
   - `evaluateAgentPlanV3Risk`(`shared/agent-plan-safety.ts:395-589`)的 `HIGH_RISK_ACTION_TYPES` 只有 `submit`/`reset`/`applyPreset`(:337-341),`execute_task` 不在其中,不會被自動升級風險或強制 `requiresApproval`。
   - `decisionMode` 只在「有 blocker」「needsClaudeCode」「跨頁多步驟」三種情況才會被升級成 `"tasked"`(:554-561)——**單頁單步驟的生成請求不會觸發任何一條**,LLM 一旦(哪怕違反 prompt 指示)把 `decision.mode` 判成 `"direct"` 並塞一個 `execute_task`(生圖/生影片/生音樂)的 step,風控層完全放行。
3. `ai.ts` 的「converted」分支對 `convertedActions` 逐一掃描,只要 `type === "execute_task"`,就**直接 `await executeOrbTask(ctx.user.id, taskAction.task)`**(:2230),完全在回傳給前端之前、在同一個 tRPC mutation 內同步跑完。Legacy fallback 分支(orbReplyParser 解析 `[ACTION:execute_task:...]`/`[ACTION:execute_generate_image:...]` marker 的情況)是完全一樣的模式(:2793 `await executeOrbTask(...)`、:2759 `await executeGenerateImage(...)`)。

**後果鏈(四道防線,`tasked→approve→orchestrator→agentToolExecutor` 才有,這裡全部沒有)**:

| 防線 | tasked 分支(approve 後) | converted / legacy fallback 分支 |
|---|---|---|
| 成本分級 | `estimateOrbTaskCost`(`ai.ts:2398-2411`,`costGuardEnabled` 預設 ON),high tier 要求 `requiresHuman` | **完全沒有呼叫**——grep `costGuardEnabled`/`estimateOrbTaskCost` 全檔只出現在 tasked 分支這一處 |
| 生成配額 | `agentToolExecutor.ts` 內 `GENERATION_SLOT_TOOLS` 過 `checkAndConsumeQuota("generation", ...)`(G3 §1.1 已載) | **完全沒有**——grep `ai.ts` 內 `checkAndConsumeQuota(` 只有三處呼叫:`"rapid_click"`(:1644)、`"planner"`(:1684)、`"code_task"`(:2508),`"generation"` 類別從未在 `ai.ts` 出現 |
| 逐欄內容審核 | `agentToolExecutor.ts` 的 DEF-AG3 機制對每步 `prompt`/`negative_prompt`/`lyrics` 逐欄過 `moderateOrbContent`(G3 §1.1) | `orbTaskExecutor.ts`(`executeOrbTask`/`executeGenerateImage` 本體)grep `moderateOrbContent` **零匹配**;上游 `applyModerationGate`(`agentPlanner.ts:638-663`)只 `moderateOrbContent(gated.reply ?? "")`——**只審「使用者看到的自然語言回覆」,不審 `task.params.prompt`/`toolArgs.prompt` 這個真正會送進 fal.ai 的字串**。LLM 完全可能寫一句無害的 `summaryForUser`(「我幫你做一張圖」),同時在 `task.params.prompt` 裡塞入使用者原文(可能含注入/擦邊內容),兩者從未交叉檢查。 |
| 使用者工具黑名單 | `agentToolExecutor.ts` 的 `opts.blockedTools` 逐呼叫檢查(G3 §1.1) | `preferences.blockedTools` 在 `ai.ts` 全檔只出現 2 次(:495 型別註解、:503 zod schema 宣告),**從未被讀取比對**——使用者就算在設定頁封鎖了 `studio.generateVideo`,這條路徑完全不受影響 |
| 「先確認再執行」 | `askBeforeAct: true` 是在**建立 taskDraft 之後、尚未執行任何生成前**回傳,使用者按下核准才觸發 orchestrator | `askBeforeAct`(:2253-2256)是在 `executeOrbTask` **已經 `await` 執行完畢之後**才計算並塞進回傳值——此時 fal 請求早已送出、額度早已消耗(若計費的話),「先問後做」的語意已經失效,`askBeforeAct` 純粹淪為顯示用欄位 |

**嚴重度**:最嚴重——同時命中安全(未經審核內容送外部 API)、成本(繞過 tier 估價與 requiresHuman)、配額(可無限次繞過每日 40 次 generation 上限)、產品承諾(preferences.blockedTools 是使用者可見設定,卻是死開關)四個面向,且是 planner 自己決定要不要走這條路(LLM 一句 `decision.mode` 判斷就能決定走哪個分支),沒有任何伺服端二次判準把關。

**與既有文件的關係**:E-ai-agents.md §8.3 描述的「成本三守衛」與 §8.1 的「內建工具...`moderateOrbContent` 亦在執行層 import 使用」隱含地假設所有生成都走 `agentToolExecutor`;本波逐行讀 `ai.ts` 後發現這個假設對「converted」與「legacy fallback」兩條分支不成立——這是先前 E/G3 兩份文件都沒有具體點出的架構縫隙(E 文件的 15 階管線表把「任務物化」與「legacy fallback」分開列,但沒有指出 legacy fallback 与 converted 分支同樣可以直接執行生成且不受守衛保護)。

---

## 其他發現(依嚴重度)

### 【嚴重-確認】對應 R1「LLM 成本沒計入」:ai.chat 全鏈 LLM 呼叫零筆寫入 `api_usage_logs`,且該表被同一支 handler 讀回來當「站內模型使用快照」注入 planner

- grep 確認:`createApiUsageLog`(`server/db.ts:1875`)全 repo 只被 `server/routers/generate.ts` 呼叫(以及若干測試檔案),`server/_core/llm.ts`、`server/_core/llmRouter.ts` 完全沒有任何寫入 `apiUsageLogs` 的程式碼路徑。
- `ai.chat` 一輪對話最少呼叫 `invokeLLM` **2 次**(schema-first planner 一次 + `finalizeIdempotentResponse` 內 fire-and-forget 的 `gpt-4o-mini` 記憶摘要一次,:753),常見情境(mode-contract/navigate/modality replan、`chat-only` kill-switch 路徑、legacy fallback、`analyzeOrbPromptForContextLookup`、critique/refine)可疊加到 **4-6 次**——這些呼叫全部不記錄成本。
- 反諷之處(新發現):`ai.ts:1494` 的 `getSiteWideModelUsageSnapshot({days:14, limit:8})` 讀的正是這張從未含 LLM 聊天成本的表,產出的「【站內模型使用快照】」區塊還會**注入回 planner 自己的 prompt**(:1498-1507)——系統對自己「哪個模型正在燒錢」的認知,結構性地只看得到 fal 生成花費,完全看不到每輪 2-6 次的規劃/摘要/研究類 LLM 呼叫,而後者在對話量大時很可能是更大的成本來源。
- 財財(accountant)的 `usage`/`budgetForecast` 系列工具(E 文件 §1.3 已載)同樣讀 `apiUsageLogs`,因此使用者在「用量」頁看到的數字同樣系統性低估。

### 【中-新發現】`getSiteWideModelUsageSnapshot` 無條件跑在每一輪 ai.chat,不受任何 intent gate 保護

- 位置:`ai.ts:1494-1507`。
- `server/db.ts:3051-3089` 顯示這是一條 `GROUP BY model` 的全站聚合查詢(過去 14 天、`api_usage_logs` 表,無 `userId` 過濾),對比同一 handler 內的網路研究(`webResearchEnabled` + `classifyOrbResearchIntent` 判斷才觸發搜尋)、世界觀查詢(需要 `pageSnapshot.state.currentWorldFrameworkId` 才觸發)等其他「有條件」的輔助查詢,這條完全沒有 intent gate——不論使用者問的是「幫我寫一句文案」還是「什麼模型最新」,每輪都會跑一次全站聚合。
- 後果:全站流量越大這條查詢的 QPS 越接近使用者發訊息的 QPS(而非「使用者問模型比較」的頻率),若 `api_usage_logs` 沒有 `(createdAt, model)` 複合索引,隨資料量增長會是全表掃描熱點。

### 【中-新發現】`rememberTaskKey` 永遠寫入 `taskId: undefined`,內容去重命中後回傳 `taskId: null`

- 位置:`server/services/orbIdempotency.ts:116-128`(函式定義)、`ai.ts:1601`(全 repo 唯一呼叫點,grep 確認)。
- `rememberTaskKey(idempotencyKey, { taskId: undefined })` 之後,程式**從未**在真正建立任務(`stateMachineTask.taskId` 產生之後,:2433/:2464)回頭補寫這筆記錄的 `taskId`。
- 觸發條件:`ENABLE_ORB_IDEMPOTENCY_GUARD`(旗標,`idempotencyGuardEnabled`,:999-1003)**目前預設 OFF**(dormant bug,不影響現行生產行為),但一旦開啟,任何 5 秒內內容雜湊相同的第二次請求(常見於雙擊送出/手機網路重試)都會命中 `findDuplicateTask`(:1589)並回傳 `{duplicate:true, taskId: null}`(:1596-1599)——前端若想根據 `taskId` 導向或輪詢原任務會直接落空。

### 【中-新發現】`{duplicate:true}` 早退路徑完全繞過 `finalizeIdempotentResponse`,打破「每條回覆都帶 userIdentity/agentRole/reasoningChain」的不變量

- 位置:`ai.ts:1596-1600`。
- `finalizeIdempotentResponse` 檔頭註解(:658-662)明言「every reply path...carries the same context without each call site needing to remember」,但 `{ duplicate: true, taskId: duplicate.taskId ?? null }` 是**唯一**一處直接 `return` 而不經過 `finalizeIdempotentResponse` 的路徑——沒有 `userIdentity`/`rememberedPreferences`/`agentRole`/`spiritTeam`/`reasoningChain` 欄位,也不會 `storeResult` 進 idempotency 快取(但因為 `idempotencyFinalized` 仍是 `false`,外層 `finally` 會正常 `releaseRequestLock`,不會卡鎖——這點沒有問題,F1 修復涵蓋了)。若前端曾經假設「所有 `ai.chat` 回覆都有 `reasoningChain`」而做非防禦性存取,這條路徑會是唯一的反例來源。
- 與上一條疊加:即使修好 `taskId` 的 bug,這條路徑仍然是格式不一致的例外。

### 【中-新發現】`ai.chatProgress` 查詢完全沒有擁有權檢查,隔離性 100% 依賴 requestId 的保密性/熵

- 位置:`ai.ts:3002-3016`(`protectedProcedure`,只驗證「已登入」,不驗證「這個 requestId 是不是你發起的」)、`server/services/orbChatProgress.ts:39-53`(`OrbChatProgressEvent`/`ProgressBucket` 型別完全沒有 `userId` 欄位)。
- 任何已登入使用者,只要取得(或猜到)另一位使用者當輪的 `requestId`(即 `x-request-id` header 或 `input.requestId`,由前端自訂產生,**伺服端從不驗證其格式/熵**),就能呼叫 `ai.chatProgress({requestId})` 看到對方即時進度細節——包含挑中的精靈角色、選用的 LLM 供應商、`analyzing_terms`/`researching_web` 階段帶出的搜尋關鍵字、`error` 階段截斷到 240 字的失敗原因。
- 嚴重度取決於前端 `requestId` 產生方式(若已用 `crypto.randomUUID()` 等高熵值,實務暴力枚舉不可行);但程式碼層級**零防禦深度**——沒有第二層 `ctx.user.id` 綁定檢查,一旦 requestId 生成邏輯未來被改成較低熵(例如摻入時間戳/遞增計數器供除錯用),會立刻變成可利用的跨使用者資訊外洩。

### 【中-新發現】`finalizeIdempotentResponse` 的記憶摘要 fire-and-forget 對「被閘擋的回覆」一樣會觸發,浪費隱藏、不計成本的 LLM 呼叫

- 位置:`ai.ts:728-777`,尤其 `if (!replyText) return;`(:739)這個唯一的短路條件。
- `attachment_blocked`/`quota_limited`/`provider_unavailable`/`agent_disabled` 這些「擋下你的請求」分支的 `reply` 都是非空字串(例如「你操作得有點快,我先幫你保護額度」),所以 `replyText` 非空,每一次「擋下」都仍然會觸發一次額外的 `gpt-4o-mini` 摘要呼叫(:753-768)。
- 疊加前述「LLM 成本不入帳」發現:這是又一筆不進 `api_usage_logs` 的隱藏成本,且發生在「系統剛判定要保護額度」的場景下最為諷刺——使用者被判定「操作太快」,系統卻還是多打了一次 LLM。

### 【低-新發現】converted 分支的 `execute_generate_image` 特判區塊是死碼

- 位置:`ai.ts:2181-2216`(schema-first「converted」分支內)。
- `shared/agent-plan-schema.ts:7-23` 的 `AgentActionTypeSchema` 沒有字面值 `"execute_generate_image"`;`shared/agent-plan-adapter.ts:293-330`(`v3StepToUiAction`)只會把 v3 plan 的 `execute_task` 動作映射成 `{type:"execute_task", payload:{...}}`——`plannerResult.actions` 結構上**不可能**出現 `execute_generate_image` 這個 type。
- 這段程式碼明顯是從 legacy fallback 分支(`ai.ts:2742-2776`,搭配 `orbReplyParser.ts:84/100` 定義的舊版 `[ACTION:execute_generate_image:...]` marker,這裡是真的可達)複製貼上到 converted 分支,但沒人核對 converted 分支的動作類型集合根本不包含它。純維護負擔/誤導性,非功能性風險。

### 【中-新發現】ai.chat 端對「規劃了但執行不到」(G3 178 孤兒工具)完全不可視,失敗只會在 approve 之後才現形

- 交叉驗證 G3 §0 的核心發現(178 個 `<spirit>.<tool>` executor case 不可達,只有 `studio.`/`director.` 前綴放行)在 `ai.ts` 這端的具體位置:`executeOrbToolCalls` 的呼叫點(`orbTaskOrchestrator.ts:290`/`ai.executeTools`(:3032,獨立 adhoc 端點)/`orbWorkflowEngine.ts:530`/`planExecutorTools.ts:311`)**沒有一個在 `ai.chat` mutation 本體內**——`ai.chat` 的 tasked 分支(:2373-2626)只負責建立 `taskDraft`/`stateMachineTask`(schema/風控層通過即可,`isKnownGlobalAgentTool` 認得 115 個已註冊但 executor 不可達的精靈工具名),完全沒有「執行前預檢這個 `toolName` 是否真的有 executor case」這一步。
- 後果:使用者在 `ai.chat` 當輪拿到的是一張「看起來完全合法」的任務卡(`toolName` 通過 registry 檢查、風控只看 riskLevel/requiresApproval),要等到使用者按下核准、`ai.orbTask.approve` 觸發 orchestrator 真正呼叫 `executeOrbToolCalls` 時才會撞見 `tool-not-found`——這個「規劃了執行不到」的斷點在 chat 階段是完全不可視的空窗,前端使用者從卡片本身看不出任何警訊。此為對 G3 發現的具體管線位置補完,非重複發現。

### 【中-確認/補充】混合大腦保險的失敗重試只認 `gemini`,其餘引擎失敗直接放棄整個 schema-first planner

- 位置:`ai.ts:2052-2106`(schema-first planner 的 `invoke` 閉包)。
- `catch` 區塊內只有 `if (providerRouterEnabled && preferred === "gemini")` 這一個分支會嘗試 `selectProvider({..., preferredProviderId:"default_llm"})` 做手動 fallback 重試(:2076-2103);若 `preferred` 是 `openrouter`/`anthropic`/`perplexity` 等任何其他引擎,呼叫失敗會直接 `throw error`(:2104),被外層 `try/catch`(:2111-2125)接住變成 `plannerException`,**整個 schema-first planner 放棄**、退回品質較低、無 v3 schema/風控的 legacy fallback(parseOrbReply 文字協定)。
- 換句話說:「除了 Gemini 這一種引擎,planner 本身沒有為其他引擎的呼叫失敗做任何特化重試」,容錯完全依賴 `invokeLLM` 內部 `llmRouter` 是否會做多引擎降級——但這裡因為呼叫時已經明確指定 `model: director.model`(非 `auto`),`llmRouter` 內部的引擎降級鏈是否對已鎖定 model 字串的呼叫生效,本波未逐行驗證(見下方「未查證」)。

### 【低-新發現】三個獨立語意的旗標被 AND 耦合成一個「全有全無」開關

- 位置:`ai.ts:1931`(`if (schemaFirstPlannerEnabled && capabilityRegistryEnabled && toolRegistryEnabled)`)、`ai.ts:2860`(fallback 判斷讀同一組旗標)。
- `ENABLE_SCHEMA_FIRST_PLANNER`、`ENABLE_GLOBAL_AGENT_CAPABILITY_REGISTRY`、`ENABLE_GLOBAL_AGENT_TOOL_REGISTRY` 三者語意上分別是「要不要用 schema-first 規劃」「要不要開能力登記表」「要不要開工具登記表」,但程式碼把三者用 `&&` 綁死——運維若只是想暫時關掉工具登記表做維護,會意外讓全站掉回 legacy fallback(舊版 `[ACTION:]` 文字協定,無 v3 schema/風控/critique),而非只影響工具呼叫本身。`warnings` 訊息雖然有分開列出各旗標關閉原因(:2869-2872),但決策當下沒有任何「只關一個仍可折衷運作」的路徑。

---

## 與既有文件的關係總結

| 本文件發現 | 與 E/G3/R2/R3 的關係 |
|---|---|
| execute_task/execute_generate_image 繞過四道防線 | **全新**——E §8.3/§8.1 的守衛描述隱含假設不成立,本波首次指出並定位到具體行號 |
| LLM 成本零計入 api_usage_logs | **確認 + 深化**——任務書指定「R1 說 LLM 成本沒計入,這裡確認」,本波用 grep 佐證唯一寫入點、列舉 ai.chat 每輪實際呼叫次數、並發現該表被同一 handler 讀回來注入 prompt 形成自我矛盾的閉環 |
| getSiteWideModelUsageSnapshot 無條件執行 | 全新,前三份文件都沒有點出這個查詢的觸發條件(或無條件)問題 |
| rememberTaskKey taskId 永遠 undefined | 全新,dormant(旗標預設 OFF),前三份文件都是讀到旗標矩陣層級,沒有逐行讀 orbIdempotency.ts 本體 |
| {duplicate:true} 繞過 finalizeIdempotentResponse | 全新,E 文件只點出「finalizeIdempotentResponse 靠 call-time 解析註解自辯」(§9.2-3)是風險,本波找到具體打破不變量的實例 |
| chatProgress 無擁有權檢查 | 全新,前三份文件都沒有讀過 ai.chatProgress/orbChatProgress.ts |
| fire-and-forget 記憶摘要對閘擋回覆也觸發 | 全新,細節層級 |
| execute_generate_image converted 分支死碼 | 全新,純代碼考古 |
| 178 孤兒工具在 chat 端不可視 | **補完 G3**——G3 已定位 executor 斷點本體,本波補上「ai.chat 這端完全看不到,只能等 approve 後現形」這個使用者體感層的具體位置 |
| gemini-only 重試 | 部分確認(E §4.1 已描述 llmRouter 有 fallback chain),本波指出 planner 專屬 invoke 閉包的手動重試邏輯只覆蓋一種引擎 |
| 三旗標 AND 耦合 | 全新,E 文件只列了旗標矩陣,沒有指出耦合關係 |

---

## 未查證 / 未讀完部分

1. **`llmRouter` 對已鎖定 `model` 字串的呼叫是否仍會做引擎降級**——本波發現 planner 的 `invoke` 閉包手動重試只覆蓋 gemini,但沒有逐行重讀 `llmRouter.ts` 確認「當 `model` 已指定具體字串(非 `auto`)時,`preferEngine` 失敗是否仍觸發跨引擎 fallback」,這決定了 finding「gemini-only 重試」的實際嚴重度上限。
2. **前端 `x-request-id`/`requestId` 的產生方式與熵**——`chatProgress` 無擁有權檢查的實際可利用性完全取決於此,本波未讀前端程式碼確認是否為 `crypto.randomUUID()`。
3. **`orbTask.approve` 之後,使用者在核准後撞見 `tool-not-found`(178 孤兒工具)時前端實際顯示什麼**——本波只確認了 chat 階段的不可視性,approve 之後的錯誤呈現屬於 orchestrator/前端範圍,不在本波讀檔清單內。
4. **`api_usage_logs` 是否有 `(createdAt, model)` 複合索引**——本波只讀了查詢語句本身,未查 drizzle schema/migration 確認索引是否存在,「全表掃描」是基於查詢結構的推論而非已證實的效能量測。
5. **`orbTaskExecutor.ts` 的 `dispatchImageGeneration`/`dispatchVideoGeneration`/`dispatchAudioGeneration` 呼叫鏈完整逐行**——本波只讀到 `dispatchFalTask` 的 `timeoutMs` 決定邏輯與 `TIMEOUT_OVERRIDES` 表以佐證「converted 分支可能同步阻塞 HTTP 請求長達 240-600 秒」的推論,沒有實測驗證 Railway/反向代理的實際 gateway timeout 數值,也沒有確認是否有更外層的請求級 timeout 會提早中斷(若有,則「阻塞」會提早變成「使用者看到逾時但伺服器端仍在跑」,後果性質不同但同樣是問題)。
