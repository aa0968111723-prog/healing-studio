# V2 — 光球任務執行引擎逐行深挖(對抗式找新 bug)

- 產生日期:2026-07-03
- 依據 commit:`7f4417da`
- 波次:**逐檔深挖 wave V**
- 承接(不重複其已確認內容,只找新問題):`E-ai-agents.md`(17 階段管線總圖)、`G3-orb-tools-spirits.md`(178 個精靈工具 executor 不可達)、`U2-ai-chat-orchestration-deepdive.md`(execute_task/execute_generate_image 繞過四道防線)、`K3-data-integrity.md`(orbTaskStateMachine FSM 為記憶體 Map、重啟遺失)、`Q3-alignment-gate-spec.md`(對齊門規格,不重複其五問設計)
- 方法:單一代理逐行實讀 `server/services/orbTaskStateMachine.ts`(796 行全讀)、`orbTaskOrchestrator.ts`(1046 行全讀)、`orbTaskChainRunner.ts`(609 行全讀)、`orbTaskObserver.ts`(516 行全讀)、`orbTaskRecoveryPolicy.ts`(40 行全讀)、`orbTaskExecutor.ts`(132 行全讀)、`orbWorkflowEngine.ts`(1057 行全讀),交叉讀 `client/src/hooks/useOrbTaskObservations.ts`(303 行全讀,1.5s 輪詢邏輯)、`server/routers/_aiHelpers.ts`(driveOrbTaskInBackground/orbAutoDriverInFlight)、`server/routers/ai.ts` 的 `orbTask.approve/retry/cancel` 三個 mutation(:3060-3220)、`server/services/orbTaskStore.ts`(approve/approveStep 片段);用 grep 佐證「全 repo 唯一呼叫點」「零呼叫」等否定性主張,禁止子代理,全程單線程實讀。**未讀完聲明見文末。**

---

## 0. 三套執行引擎的關係(先講清楚,避免下方發現互相混淆)

本波確認 codebase 裡有**三套彼此獨立、互不知情**的任務執行引擎:

1. **orbTaskStateMachine.ts + orbTaskOrchestrator.ts**(FSM + 驅動):`taskStore`(記憶體 Map,K3 已載)存 `OrbAgentTask`(稽核/記憶用),真正驅動執行進度的是**另一個**持久化的 `OrbTaskStore`(`server/services/orbTaskStore.ts`,legacy per-step store);`runOrbTaskToCompletion` 的主迴圈讀 `store.get()`(legacy)決定要不要往下跑,只在每步成功/失敗後**同步呼叫** FSM 的 `completeOrbAgentStep`/`failOrbAgentStep` 把稽核事件同步過去——這是原始設計注釋自己承認的「兩個 state holder」。
2. **orbTaskChainRunner.ts + orbTaskObserver.ts**(post-mortem 觀察 + 續跑鏈):包在 (1) 外層,失敗後請 LLM 寫觀察結論、決定要不要 replan 產生新任務並鏈接 `predecessorTaskId`。
3. **orbWorkflowEngine.ts**(完全獨立的第三套):DB-backed(`orb_workflow_executions`/`orb_workflow_step_executions`),給「使用者/範本」明確建立的多步驟 workflow 用,同樣底層呼叫 `executeOrbToolCalls`,但**與 (1)(2) 完全沒有共用任何程式碼路徑**(自己的 pause/cancel/resume,自己的重試迴圈,自己的 DB 表)。

下面的發現依所屬引擎分組。除非特別註明,皆為本波首次指出(標「新發現」);標「確認」的是先前文件已提過、本波僅補充細節位置。

---

## 1. FSM + Orchestrator(orbTaskStateMachine.ts / orbTaskOrchestrator.ts)

### 1.1 【嚴重-新發現】FSM 層「自動重試+逾時退避」機制(Gap19/Gap6 註解自稱)全鏈死碼,production 從未觸發過一次

**證據鏈(grep 逐層確認)**:
- `failOrbAgentStep`(`orbTaskStateMachine.ts:450-508`)只有在 `opts.allowAutoRetry === true` 時才會走「排程重試 + 指數退避 + task.retryBudget 遞減」這條路(:469-485,`step.retry_scheduled` 事件);否則直接硬性把整個 task 判 `failed`(:487-521)。
- `opts.isTimeout`/`allowAutoRetry: true` **唯一**的呼叫來源是 `runStepWithTimeout`(:663-692)——這個函式本身是為了「用 AbortController 包住工具呼叫,逾時(`DEFAULT_STEP_TIMEOUT_MS=60_000`)就 abort + 標記 `step.timeout` + 觸發自動重試」而寫的,文件注釋明講「the orchestrator never hangs forever on a slow provider」。
- 但 grep 全 repo(`server/**`)`runStepWithTimeout` 除了它自己的定義行,**沒有任何其他呼叫點**——真正驅動任務的 `orbTaskOrchestrator.ts` 完全不用它,`executeCurrentStepTools` 直接 `await executeOrbToolCalls(...)`,沒有任何 timeout 包裝。
- 反向確認:全 repo 呼叫 `failOrbAgentStep(` 的 5 個生產呼叫點——`orbTaskOrchestrator.ts:966`、`ai.ts:3307`、`ai.ts:3336`、`_aiHelpers.ts:80`、`_aiHelpers.ts:247`——**沒有一個傳入 `opts`**(全部只傳 `taskId, stepId, reason` 三個必要參數),因此 `allowAutoRetry` 永遠是 `undefined`。

**觸發**:任何多步驟任務,只要有一步工具呼叫失敗(不論任何原因),`task.retryBudget`(初始值 2,`orbTaskStateMachine.ts:190`)**從未在生產路徑上被真正消耗過**——因為唯一會讀它、遞減它的分支(:469 `task.retryBudget > 0`)只在 `allowAutoRetry:true` 時才進得去,而這個旗標永遠是 false。

**後果**:文件/注釋描述的「先自動重試幾次、指數退避、逾時才真的判失敗」的韌性設計,在真實請求流程中**完全不存在**——第一次工具失敗就直接是整個任務的終局失敗(`task.status="failed"`)。使用者體感等同於「沒有重試」,即使 UI/文件暗示系統會自動重試。與此同時,`DEFAULT_STEP_TIMEOUT_MS`(60 秒)這道「工具呼叫不會無限掛住」的保護也從未生效——單一步驟能掛多久,完全取決於 `executeOrbToolCalls` 內部個別工具自己有沒有做 timeout(G3 已載 fal 類工具有 120 秒 `awaitFalForOrb` 預算,但 `db.*`/`research.*`/未來新工具是否都有對應保護,本波未逐一查證)。

**與現行「真正生效」的重試機制的落差**:真正在生產路徑上跑的重試是 `executeCurrentStepTools` 內建的 `stepRetryBudget`(`orbTaskOrchestrator.ts:285-372`,硬上限 2 次),但那個機制**只對「verifier 判定為軟失敗」的成功回應**生效(`result.ok===true` 但 `verifyToolResult` 判失敗),對於 `executeOrbToolCalls` 直接回傳 `ok:false` 的硬失敗(逾時、provider 錯誤、approval 擋下)**完全不會重試**,一次就終局失敗。

**path**:`server/services/orbTaskStateMachine.ts:450-508`(fail 函式本體)、`:663-692`(死碼 `runStepWithTimeout`);呼叫點 `server/services/orbTaskOrchestrator.ts:966`、`server/routers/ai.ts:3307,3336`、`server/routers/_aiHelpers.ts:80,247`。

---

### 1.2 【嚴重-新發現】`ai.orbTask.retry` 對「已完成」任務缺終態守衛,會把成功任務逆轉成合成的「no-current-step」失敗紀錄

**觸發路徑(逐行追出的具體機制)**:
1. `retryOrbAgentTask`(`orbTaskStateMachine.ts:570-616`)的終態排除表只有 `"blocked" | "cancelled" | "paused"`(:576)——**`"completed"` 和 `"failed"` 都不在排除清單內**。
2. router 層(`ai.ts:3124-3182` 的 `orbTask.retry` mutation)同樣**沒有**像 `approve` mutation 那樣做 `completed/failed/cancelled` 的終態擋(對比 :3079-3085 approve 有做,retry 完全沒有對應檢查,只驗證 ownership)。
3. 若使用者對一個**已成功完成**的任務按下(或前端因競態重複觸發)重試:`retryOrbAgentTask` 因為 `task.retryBudget`(預設 2,且 1.1 已證明生產路徑幾乎不會消耗)通常 > 0,直接把 `task.status` 設回 `"approved"`/`"awaiting_approval"`(:612)並 push `"task.approved"` 事件——**FSM 端「已完成」的事實被抹除**。
4. 更嚴重的是 caller 端接著做的事(`ai.ts:3176-3179`):`orbTaskRepository.approve(input.taskId, ctx.user.id, true)`——這是**legacy `OrbTaskStore`**(真正驅動 orchestrator 主迴圈的那份),其 `approve()` 實作(`orbTaskStore.ts:170-179`)**無條件** `this.setStatus(task, "running")`,不檢查目前狀態是不是已經是 `"done"`,也不重置 `currentStepIndex`。
5. 接著 `void driveOrbTaskInBackground(...)` 被呼叫——此時 `orbAutoDriverInFlight` Map(`_aiHelpers.ts:29`)裡**沒有**這個 taskId(上一輪驅動早已在任務完成時正常結束並清除),所以這次呼叫**不會**被防重入機制擋下,會真的重新進入 `runOrbTaskToCompletion` 主迴圈。
6. 主迴圈第一件事是 `const step = task.steps[task.currentStepIndex]`——但 `currentStepIndex` 早就等於 `steps.length`(全部步驟已跑完),`step` 是 `undefined` → 命中「防禦性」分支(`orbTaskOrchestrator.ts:746-772`):合成一個 `stepId: "synthetic_${currentStepIndex}"`、`errorCode:"no-current-step"` 的失敗步驟報告,把 legacy store 的任務**直接標記為 `failed`**。

**後果**:一個貨真價實已經成功完成、生成物已產出的任務,只因為使用者(或前端 bug/雙擊/網路重試)對它按了一次「重試」,就會被系統**回頭改判為失敗**——`orbTaskMemory`/`recordOrbTaskMemory` 也會因此寫入一筆 `outcome:"failure"` 的紀錄(污染財財/觀察員未來讀取的歷史紀錄,U2 已述觀察員的「歷史紀錄」區塊會影響下一輪決策,這裡等於餵給它一筆假的失敗案例)。這比 G3/U2 描述的任何一個現有問題都更直接:**沒有攻擊性操作、純粹按鈕誤觸就能把「成功」竄改成「失敗」**。

**path**:`server/services/orbTaskStateMachine.ts:570-616`(`retryOrbAgentTask` 終態排除清單缺漏);`server/routers/ai.ts:3124-3182`(retry mutation 無終態守衛,對比 :3079-3085 approve 有);`server/services/orbTaskStore.ts:170-179`(legacy store `approve()` 無條件覆寫 status);`server/services/orbTaskOrchestrator.ts:746-772`(no-current-step 合成失敗分支)。

---

### 1.3 【中-新發現】`approveOrbAgentTask` 對「executing 中」任務同樣缺守衛,重複核准會讓 FSM 稽核軌跡假性倒退回 step 0(執行本身因 `orbAutoDriverInFlight` 不會真的重跑,但觀測資料失真)

`approveOrbAgentTask`(`orbTaskStateMachine.ts:247-271`)的終態排除只有 `cancelled/completed/failed`(:249),**不含 `executing`**;router 層 `ai.ts:3079-3085` 的 guard 註解明講是為了擋「double-clicked approve 重跑背景驅動」,但同樣只排除了 completed/failed/cancelled,漏了 executing。重複呼叫時,`approveOrbAgentTask` 會**無條件**把 `task.status` 設回 `"executing"`、把 **`task.steps[0]`**(永遠是第 0 步,不是 `task.currentStepId` 對應的真正當前步驟)的狀態設回 `"running"`、`currentStepId` 也跟著指回第 0 步,並補推一次 `task.approved`/`step.started` 稽核事件——即使真正的執行進度早已跑到第 3、4 步。

因為真正驅動執行的是 legacy `OrbTaskStore`(其 `approve()` 對已在跑的任務只是把 status 從 `"running"` 設回同一個 `"running"`,不動 `currentStepIndex`),且 `orbAutoDriverInFlight`(`_aiHelpers.ts:28-50`,10 分鐘 TTL)會擋下第二次 `driveOrbTaskInBackground`,**實際生成/派工不會重跑**——這點與 1.2 的完成任務案例不同(1.2 之所以會真的重跑,是因為第一輪驅動已經自然結束、in-flight 標記已被清除)。但 FSM 的稽核軌跡(`getOrbAgentTask`/`ai.orbTask.events`,前端 SSE 與 `orbTaskMemory` 都讀這份)會出現「倒退回第一步」的假象,任何信任這條軌跡的下游(觀察員的「歷史紀錄」摘要、UI 進度顯示)都會讀到失真資料。

**path**:`server/services/orbTaskStateMachine.ts:247-271`;`server/routers/ai.ts:3060-3103`;對照 `server/services/orbTaskStore.ts:170-179`(真正驅動用的 store 不受影響)、`server/routers/_aiHelpers.ts:28-50`(防重入證明執行本身不會重跑)。

---

### 1.4 【中-新發現】`classifyOrbStepError` 正則優先序錯誤,`validation_error` 分支對常見措辭基本打不到,recovery_action 系統性誤判且污染 circuit-breaker 計數

`orbTaskRecoveryPolicy.ts:16-23`:
```ts
if (/approval|required|blocked|forbidden|policy/.test(value)) return "policy_blocked";      // 第一條
if (/selector|element|not found|unresolved-step-ref/.test(value)) return "selector_not_found";
if (/timeout|timed out|etimedout|abort/.test(value)) return "timeout";
if (/validation|invalid|required field|schema/.test(value)) return "validation_error";       // 第四條
```
`policy_blocked` 的正則裡有一個**裸字** `required`(沒有限定「required field」這種完整片語),而幾乎所有欄位缺失類錯誤訊息(不論來源是 fal.ai 回傳、`buildDeterministicRetryPatch` 判斷用的 issue 文字、或任何工具的驗證訊息)都會用「XXX is required」這種措辭。因為 `policy_blocked` 排在第一條,**任何包含裸字 `required` 的錯誤,不論是不是真的跟審核/授權有關,一律先被分類成 `policy_blocked`**,第四條的 `validation_error`(對應 `recoveryActionFor` 回傳的 `backfill_required_fields`——語意是「可自動回填修正」)實質上**幾乎永遠打不到**,除非錯誤訊息剛好完全不含 `required`/`approval`/`blocked`/`forbidden`/`policy` 這些詞卻含 `validation`/`invalid`/`schema`。

**後果**:
1. 多步驟任務裡「缺必填參數」這種**本可用既有 `buildDeterministicRetryPatch` 自動修正**(`orbTaskOrchestrator.ts:119-137`,已知會補 `image_size`/`duration`/`prompt`)的錯誤,在 `error_code`/`recovery_action` 這層metadata 被系統性誤標成「需要人工確認」(`request_human_confirmation`),即使實際的自動修正邏輯(在別的程式碼路徑)可能已經生效——兩邊各自判斷、彼此不一致,前端/dashboard 若依賴 `recovery_action` 顯示提示文字,會顯示錯誤的「需要你確認」而非「已自動修正重試中」。
2. 更隱蔽的是這會污染 `runOrbTaskToCompletion` 的 circuit-breaker 判斷(`orbTaskOrchestrator.ts:880-889`,`MAX_SAME_ERROR_STREAK=3`,靠比對連續 `error_code` 是否相同)——三個**本質完全不同**的錯誤(例如一次是真的審核擋下、一次是解析度缺失、一次是 prompt 缺失)只要訊息裡都含 `required`,就會被算成「連續 3 次同一種錯誤」,誤觸發 circuit breaker 走向 replan/`handoff_to_human` 路徑,即使實際上是三個不相關、原本各自可能一次重試就過的獨立小問題。

**path**:`server/services/orbTaskRecoveryPolicy.ts:16-23`;受影響的下游:`server/services/orbTaskOrchestrator.ts:846-848`(`error_code`/`recovery_action` 計算)、`:880-889`(circuit-breaker streak 計數)。

---

## 2. Chain Runner + Observer(orbTaskChainRunner.ts / orbTaskObserver.ts / 前端輪詢)

### 2.1 【嚴重-新發現】observer 輪詢:至少 4 條 chain 終止路徑不會產生 terminal-kind 事件,前端假性「繼續中」卡到 10 分鐘硬上限才停

`client/src/hooks/useOrbTaskObservations.ts` 的 `TERMINAL_KINDS`(:207-211)只有 `complete`/`abort`/`needs_user` 三種,`isPolling` 只在看到這三種之一時才會被設 `false`(:288-290);其餘一律每 `POLL_INTERVAL_MS=1_500`ms(:78)繼續打 `ai.orbTask.events`,直到 `MAX_POLL_MS=10 分鐘`(:81)才強制停。

但 `orbTaskChainRunner.ts` 至少有 **4 種會讓 chain 徹底結束、卻不會讓前端看到 terminal-kind 事件**的路徑:

| 伺服器端 stopReason | 寫入的稽核事件 | 前端 `eventToObservation` 映射結果 | 是否 terminal |
|---|---|---|---|
| observer 拋例外(:392-401) | `task.observed`,`metadata:{error:true}`(**不含** `observation` 欄位) | 命中 fallback 分支(:140-149),`kind:"continue"` | **否** |
| replan 失敗 `planner_no_task`(:450-461) | `task.observed`,`metadata:{plannerStatus, reason}`(同樣不含 `observation`) | 同上 fallback,`kind:"continue"` | **否** |
| `no_continuation_context`(:434-438) | **完全沒有寫任何稽核事件** | 無新事件,沿用上一筆(通常是觀察員自己寫的 `"continue"`) | **否** |
| `max_iterations`,且最後一次真實觀察 kind 就是 `"continue"`(:428-432,在嘗試 replan **之前**先判斷是否已達上限就 break) | 最後一筆有效事件仍是**觀察員自己**寫的、真正 kind 為 `"continue"` 的 `task.observed` | 正常映射為 `kind:"continue"` | **否**(這個是「合法」的 continue,但伺服器已經決定不會再有下一輪) |

**觸發**:任何一次 continuation chain 在到達最大迭代數(預設 2,`env` 可調到硬上限 4)前最後一輪的觀察是 `"continue"`(技術上合理,LLM 說「這個還能繼續」但迭代預算用完)、或 replan 呼叫失敗(planner 這輪沒吐出合法計畫)、或 observer LLM 呼叫本身拋錯、或找不到 `getOrbTaskPlannerContext`(通常是伺服器重啟或該記憶體 store TTL 過期,K3 已述同類記憶體態問題)——這些都是正常運行中會發生的情況,不是邊角案例。

**後果**:使用者盯著光球的「思考鏈」面板,看到的最後一條訊息永遠是「光球準備繼續」或「光球觀察到狀況,但沒有完整資訊」這種**暗示還在動作中**的文字,但伺服器端這條 chain 已經徹底結束、`currentTaskId` 不會再有任何新事件。前端會繼續每 1.5 秒打一次 `ai.orbTask.events`(對已經死掉的 taskId),直到 10 分鐘超時才悄悄停止 polling——這 10 分鐘內使用者得到的體驗是「卡住的進度條」,且沒有任何 UI 訊息告訴他「其實已經結束了,需要你自己重新開口」。這也表示同一個死掉的 taskId 在 10 分鐘內會產生 400 次(600000ms / 1500ms)無意義的 tRPC 查詢。

**path**:`client/src/hooks/useOrbTaskObservations.ts:207-211`(TERMINAL_KINDS)、:131-149(fallback 映射)、:78,81(輪詢/逾時常數);`server/services/orbTaskChainRunner.ts:392-401`(observer 拋例外)、:450-461(replan 失敗)、:434-438(no_continuation_context)、:428-432(max_iterations 提前 break)。

---

### 2.2 【低-新發現】`resolveRecentTaskMemory` 的「歷史紀錄」注入與 1.2 的假性失敗紀錄疊加,會讓 observer 系統性偏向提早判 abort

`orbTaskObserver.ts:245-257` 明確把「最近的相關 chain 結果」餵給觀察 LLM,且系統提示詞(:309-311)教它「如果發現使用者最近已經連續多次卡在同一個 trap,就傾向回 abort 而不是繼續 continue」。這個設計本身合理,但疊加 **1.2 發現的假性失敗紀錄**(重試已完成任務產生的 `outcome:"failure"`)之後,`getRecentOrbTaskMemoryForUser` 撈到的「最近失敗」樣本可能**本身就是假的**(任務其實成功過,只是被誤觸的 retry 打成失敗紀錄),觀察員因此更容易對後續同類任務提早判定 `abort`,即使沒有真正的重複失敗模式。屬於 1.2 的下游放大效應,不單獨列嚴重度。

**path**:`server/services/orbTaskObserver.ts:245-257,309-311`;根因見 §1.2。

---

## 3. orbWorkflowEngine(第三套獨立引擎)

### 3.1 【嚴重-新發現】pause/cancel 只在步驟邊界檢查,終端寫入不驗證當前狀態,使用者的取消動作可被同時完成/失敗的步驟結果覆蓋

`pauseExecution`/`cancelExecution`(`orbWorkflowEngine.ts:705-780`)只做一次 DB `UPDATE ... SET status = 'paused'/'cancelled'`,**沒有任何機制中斷已經在 `await` 中的工具呼叫**。`runWorkflow` 主迴圈(:393-626)只在**每次迭代最開頭**重新查一次 `status`(:436-449),若是 `paused`/`cancelled` 就 `return`——但這代表:

- 若使用者在 step *i* 的 `executeOrbToolCalls` await 期間按下取消,取消請求會立刻把 DB 狀態改成 `"cancelled"`,但 `runWorkflow` 對此**完全不知情**,繼續等 step *i* 跑完。
- step *i* 跑完後:
  - 若成功 → 繼續寫 `outputs[step.stepId]`、更新 `currentStepIndex`,進入下一輪迴圈**才**檢查到 `cancelled` 並 return——這段時間內 step *i* 已經真的執行完(例如已經真的呼叫了 fal.ai 生成),使用者的取消沒有真正省下這步的成本,只是擋住了「下一步」。
  - 若失敗(重試 `maxRetries` 次後仍失敗)→ 拋出的 `Error` 被外層 `catch`(:607-625)接住,**無條件** `db.update(...).set({status:"failed", ...})`——**直接覆蓋掉使用者剛剛下的 `"cancelled"`**,使用者主動取消的任務在資料庫裡最終顯示為系統判定的「失敗」,而非「已取消」。
  - 對稱地,若使用者取消發生在**最後一步**執行期間,該步成功後迴圈自然結束、落到 (:589-601) 的「completed」寫入——同樣無條件覆蓋掉 `"cancelled"`,使用者以為自己取消了,結果 workflow 顯示「已完成」。

**後果**:workflow 執行紀錄(`orb_workflow_executions.status`,使用者歷史紀錄頁面 `getUserWorkflowHistory` 直接讀這欄)無法正確反映「使用者主動取消」這個事實,一律被同一時間窗內完成/失敗的步驟結果覆寫;若後續有計費/用量統計依 `status` 分類(例如「取消不計費、失敗計費、完成計費」這類邏輯,本波未逐一查證是否存在),這個覆寫會讓歸類錯誤。

**path**:`server/services/orbWorkflowEngine.ts:436-449`(僅迭代開頭檢查)、:589-601(完成無條件覆寫)、:607-625(失敗無條件覆寫)、:705-780(pause/cancel 僅寫 DB,無中斷機制)。

---

### 3.2 【嚴重-新發現】orbWorkflowEngine 對同一 executionId 完全沒有並發鎖(對照 orbTaskOrchestrator 有 `orbAutoDriverInFlight`),重複觸發會雙重執行、雙重扣點

`executeWorkflow`(:290-388)建立執行紀錄後 fire-and-forget 呼叫 `this.runWorkflow(execution.id)`(:372-377,`.catch` 只是記 log,不追蹤是否已有一個相同 id 的迴圈在跑);`resumeExecution`(:728-753)同樣 fire-and-forget 再呼叫一次 `this.runWorkflow(executionId)`(:740-745)。**兩者都沒有任何 in-memory Set / DB 樂觀鎖 / advisory lock** 去檢查「這個 executionId 目前是否已經有一個 `runWorkflow` 迴圈在跑」。

對比同樣「fire-and-forget 背景驅動」的 `orbTaskOrchestrator` 側,`_aiHelpers.ts:28-50` 明確定義了 `orbAutoDriverInFlight`(帶 10 分鐘 TTL 的 in-memory Map)防止「approve 點兩下」重複進入驅動迴圈——這是一個**已知需要防範的問題模式**,但 `orbWorkflowEngine.ts` 完全沒有對應機制。

**觸發**:使用者連點兩次「恢復」按鈕(網路延遲下很常見的使用者行為)、或前端因為 loading 狀態管理 bug 重複送出 `resumeExecution` mutation、或 `executeWorkflow` 剛建立完紀錄使用者立刻手動呼叫一次 `resumeExecution`(理論上該 workflow status 是 `"pending"`,不是 `"paused"`,但 `resumeExecution` 本身**不檢查目前狀態就直接改成 `"running"` 並跑**,見:733-736——沒有防呆判斷「這個 execution 是不是本來就該被恢復」)。

**後果**:兩個 `runWorkflow()` promise 同時對同一個 `execution.currentStepIndex` 起跑,各自重複呼叫 `executeOrbToolCalls`(可能對同一步驟重複觸發生成、重複消耗 `GENERATION_SLOT_TOOLS` 額度——G3 已載此額度檢查在 `executeOrbToolCalls` 內部生效,兩個並發呼叫各自都會真的過一次額度扣點),各自重複寫入 `orbWorkflowStepExecutions` 列(同一 `stepIndex` 出現兩筆不同 `id` 的紀錄,`getExecutionStatus` 讀出來的步驟列表會有重複/交錯),且各自執行 `db.update(...).set({currentStepIndex: i+1})`——後寫入的那次會覆蓋先寫入的,若兩者步進速度不同步,可能導致 `currentStepIndex` 實際上「跳過」了某個尚未真正記錄完成的步驟。

**path**:`server/services/orbWorkflowEngine.ts:372-377`(executeWorkflow fire-and-forget)、:728-753(resumeExecution 無狀態檢查、無鎖);對照 `server/routers/_aiHelpers.ts:28-50`(同類問題在另一套引擎已有防範,證明這裡不是「沒想過會發生」而是「這條路徑漏做了」)。

---

### 3.3 【中-新發現】orbWorkflowEngine 是三套執行引擎中唯一沒有殭屍/逾時偵測的一套

`server/jobs/staleJobChecker.ts`(檔頭:「每 1 分鐘掃描 `background_jobs` 表中狀態為 processing 且超過 5 分鐘未更新的任務」)grep 確認**完全不涉及** `orb_workflow_executions`/`orb_workflow_step_executions` 這兩張表(零交集)。`runWorkflow` 本體(:393-626)對 `executeOrbToolCalls` 呼叫(:530)**沒有任何 timeout/AbortController 包裝**,重試迴圈(:522-556)裡的等待只是「重試之間」的指數退避 sleep,不是「單次呼叫」的逾時保護。

**後果**:若某一步驟的工具呼叫因為底層 provider 卡住不回應(尤其是非 fal 類工具——G3 已載 fal 類工具在 `agentToolExecutor` 內部有 `awaitFalForOrb` 120 秒預算,但 `db.*`/未來新增工具是否都有等效保護,本波未逐一查證每個 dispatch 函式),該 execution 會**永久**停在 `status="running"`,沒有任何自動化機制發現、標記、或清理它;使用者只能人工看資料庫或永遠盯著一個不會再動的進度條。這是三套引擎裡(1)FSM+Orchestrator 有 `orbAutoDriverInFlight` TTL 自癒、(3)workflowEngine 完全沒有等效物 的具體落差。

**path**:`server/services/orbWorkflowEngine.ts:393-626`(runWorkflow 全函式)、:522-556(重試迴圈);對照 `server/jobs/staleJobChecker.ts`(檔頭範圍只涵蓋 `background_jobs`)。

---

### 3.4 【中-新發現】`WorkflowStep.conditions.retryOn` 欄位定義了但從未被讀取,一切錯誤都無差別套用 `maxRetries` 重試

`WorkflowStep` 型別(:27-38)定義了 `conditions.retryOn?: string[]`,語意應是「只有這些錯誤碼才重試,其他錯誤直接判失敗」,是範本作者(`workflowEngineTools`/`workflowAutomationTools`,見 G3 §1.3)理論上可以用來精細控制重試行為的欄位。但 `runWorkflow` 的重試迴圈(:522-556)**只讀 `step.conditions?.maxRetries`**(:480),`retryOn` 全檔案 grep **零引用**。

**後果**:即使某個錯誤本質上重試也不會改善(例如「工具未知」`Unknown tool: ${step.toolName}`、或使用者權限不足這類邏輯性錯誤),只要 `maxRetries > 0`,迴圈一律會用指數退避(`Math.pow(2, retryCount) * 1000` 毫秒,:554)傻等重試到底才放棄——若範本設 `maxRetries=3`,單一本質不可恢復的步驟就要浪費 `2+4+8=14` 秒真實牆鐘時間才判定失敗,且視工具而定可能每次重試都是一次真實的外部呼叫(若已通過額度檢查,見 §3.5)。

**path**:`server/services/orbWorkflowEngine.ts:27-38`(欄位定義)、:480-556(重試迴圈只用 `maxRetries`)。

---

### 3.5 【中-確認+新增後果】orbWorkflowEngine 觸及 G3 已載的「178 個孤兒工具」時,要先浪費真實秒數指數退避才整條 workflow 失敗

`runWorkflow`(:527)呼叫工具前只檢查 `isKnownGlobalAgentTool(step.toolName)`——這個函式只代表「這個工具名稱在 GLOBAL_AGENT_TOOL_REGISTRY 有註冊」,G3 §0 已證實 148 筆註冊工具中有 115 個在 `agentToolExecutor.executeOrbToolCalls` 的實際 dispatch 層仍是 `tool-not-found`(只有 `studio.`/`director.`/`db.`/三個具名研究工具前綴會被放行)。若某個 workflow 範本(不論是使用者自建、或 LLM 透過 `workflowEngineTools.createTemplate` 生成)裡有一步是 `critic.review`/`accountant.estimate` 這類「已註冊但不可達」的工具,`isKnownGlobalAgentTool` 檢查會通過,實際送進 `executeOrbToolCalls` 才拿到 `tool-not-found`,被本引擎的重試迴圈當一般失敗處理——若該步驟 `maxRetries` 設為預設值以上,會先花 §3.4 描述的指數退避時間陪跑,才 throw 讓**整條 workflow**(即使後續步驟與這個孤兒工具完全無關)被標記為 `failed`。

這是 G3 根因(executor 178 孤兒工具)在**第三套執行引擎**上的具體代價,先前 G3/U2 文件都只分析了 `ai.chat`/`orbTaskOrchestrator` 這條路徑,沒有涵蓋 `orbWorkflowEngine`。

**path**:`server/services/orbWorkflowEngine.ts:522-556`;根因見 `docs/research/G3-orb-tools-spirits.md` §0。

---

## 4. 未查證 / 未讀完部分

1. **`server/services/orbTaskStore.ts`** 只讀了 `approve()`/`approveStep()` 兩個片段(:170-210),`reportStep`/`hasUnexpiredStepApproval`/`isStepApproved`/`persistToDisk` 等其餘方法及其並發安全性未逐行讀完——§1.2/1.3 的結論依賴 `approve()` 的行為,若其餘方法有額外的狀態一致性檢查,可能部分緩解(但目前讀到的程式碼沒有跡象顯示有)。
2. **`server/services/orbTaskPlannerContextStore.ts`/`orbTaskPageStateStore.ts`/`orbTaskReplanIntegration.ts`/`orbTaskMemory.ts`** 只透過 `orbTaskChainRunner.ts` 的呼叫點間接讀到介面簽章,未逐行讀各自實作本體(尤其 `orbTaskReplanIntegration.ts` 的 `createReplanCallback`,是 `runOrbTaskToCompletion` 的 `onRequestReplan` 實際實作,§1 的 verifier-failure replan / circuit-breaker replan 分支只驗證了呼叫端邏輯,沒有驗證 replan 本身如何修改 legacy store 的 steps)。
3. **`server/services/multiAgentIntegration.ts`/`multiAgentDetector.ts`** 完全未讀(`driveOrbTaskInBackground` 有一條「Multi-agent routing path」分支,`_aiHelpers.ts:98` 起,本波只讀到分支入口沒有深入,§1 的所有發現只涵蓋單代理 lead-only 路徑,`ORB_MULTI_AGENT_ENABLED` 開啟後的行為未涵蓋)。
4. **`agentToolExecutor.ts` 內各工具 dispatch 函式是否都有逾時保護**(§3.3 提到 fal 類工具有 120 秒預算,`db.*`/`research.*`/未來新工具是否都有等效保護)——本波未逐一核對,是基於 G3 既有結論的推論延伸,非本波直接證實。
5. **orbWorkflowEngine 的計費/用量統計是否依 `status` 欄位分類**(§3.1 提到「若後續有計費邏輯依 status 分類」)——本波沒有查證是否存在這樣的下游消費邏輯,是條件式推論。
6. **實際跑測試/整合環境驗證**——本波全部基於逐行讀碼 + grep 交叉否證,沒有起服務或跑 vitest probe 實際觸發任何一個發現(對比 G3 用 vitest probe 實測驗證路由層,本波受限於「禁止子代理、只寫研究文件」的任務限制,全部停留在讀碼證據層級,信心度仍高但屬於「讀碼確認」而非「實跑確認」)。
