# EH3 — fire-and-forget/浮動 promise
- 產生日期:2026-07-03
- 依據 commit:812fb6fd（工作目錄目前 HEAD 實際為 `0cb8a860`，同 EH1 註記的版本差異，不影響本輪結論）
- 稽核範圍:未 await 的非同步呼叫、無 `.catch` 的浮動 promise、背景工作失敗不可見

## 方法
以 `void <expr>`、裸 `<expr>.then(` / `import(...).then(`（不接 `void`、不接尾端 `.catch`）為關鍵字掃描 `server/` 全庫（排除 `__tests__`/`*.test.ts`），逐一開啟被呼叫函式的定義，判斷：①函式本身是否可能同步/非同步拋錯、②呼叫端是否吞下該錯誤、③失敗後系統/使用者能否從別的管道發現。只有「函式可能拋錯 + 呼叫端無 catch」才算數,單純呼叫「內部已自我 try/catch、保證 resolve」的函式不計入(視為安全,列入 negative results)。

---

## 發現(依嚴重度排序)

### 1〔HIGH｜fire-and-forget，缺外層 catch〕LoRA/Fal 訓練啟動走 `import(...).then(...)`，只有內層 catch，import 本身失敗會變成無主 unhandled rejection、backgroundJob 卡在 queued/processing 永不轉 failed
- **檔案**:`server/routers/models.ts:249-263`(重新訓練)、`:449-467`(建立模型-fal 引擎)、`:482-499`(建立模型-replicate 引擎)、`server/jobs/modelTrainingWorker.ts:151-155`(cron worker 消費 queued 任務)
- **失敗情境**:四處寫法一致：
  ```
  import("../services/loraTrainer").then(({ runLoraTrainingJob }) => {
    runLoraTrainingJob({...}).catch(err => { console.error(...) });
  });
  ```
  這裡的 `.catch` 只掛在**內層** `runLoraTrainingJob(...)` 回傳的 promise 上；**外層** `import(...).then(...)` 這條 promise 鏈本身完全沒有 `.catch`，也沒有 `void` 標記告知這是刻意 fire-and-forget。若動態 `import()` 本身失敗(模組載入錯誤、建置後遺失 chunk、記憶體壓力導致的暫時性載入失敗等),或 `.then` callback 在呼叫到 `.catch()` 之前就同步拋錯,這個外層 rejection 完全無人接手,變成 process 等級的 unhandled rejection。對照同檔案 `server/services/agentToolExecutor.ts:7671-7712` 的同款「動態 import 啟動訓練」寫法——那裡明確加了外層 `.catch(async err => {...})`,並在註解寫明這是修過的「F3」bug:「fal trainer 起動失敗只 console.error,backgroundJob 永遠卡 queued/0%」,還會把對應 job 標成 `failed` 好讓 UI 顯示真實狀態。`models.ts` 與 `modelTrainingWorker.ts` 這四處**沒有套用同樣的修法**,是同一類缺口在不同呼叫點的回歸/遺漏。
- **被吞後的壞狀態**:使用者按下「開始訓練」/「重新訓練」,backgroundJob 已寫入 `queued`(models.ts)或已改為 `processing`(modelTrainingWorker.ts 啟動前會先標記 processing 防重複派工),但訓練實際上從未真正開始。models.ts 兩處(建立/重新訓練)的路徑完全沒有「stale job」回收機制去掃描這個特定失敗——需靠 `staleJobChecker.ts` 或 `modelTrainingWorker.ts` 的巡檢覆蓋,但 `staleJobChecker.ts` 明確排除 `model_training`(檔頭註解:「model_training 有自己的 worker」)。`modelTrainingWorker.ts` 自己的 `recoverStuckTrainingJobs`(15 分鐘 stale 判定)雖然會把「找不到 predictionId」的卡住任務重置回 `queued`(第 274-286 行)讓下一輪重新派工,但**沒有 retryCount/上限**——若 import 失敗是永久性的(例如壞版本部署導致 `loraTrainer.js`/`falTrainer.js` 載入必定失敗),此路徑會無限重置成 queued→processing→stale→reset,永遠不會被標成 `failed`、永遠不會通知使用者,形成無終態的重試迴圈。使用者只會看到「訓練中」卡住不動,「我的模型」頁面永遠顯示 training/pending。
- **建議**:比照 `agentToolExecutor.ts` 已修過的寫法,四處都補上外層 `.catch`(或整段包 `void (async () => {...})().catch(...)`),失敗時明確把 backgroundJob/fineTunedModel 標成 `failed` 並帶錯誤訊息;`recoverStuckTrainingJobs` 的「重置為 queued」分支也應該加 retryCount 上限,超過後改標 `failed` 並透過 SSE/通知讓使用者知道,而非無限重試。

### 2〔HIGH｜fire-and-forget，缺外層 catch，可能引發全站當機〕`runPostGenForJob`/`refundJobIfBilled` 全部以 `void` 呼叫且無 `.catch`,函式開頭又有未受 try 保護的 DB 呼叫，DB 抖動時的 unhandled rejection 在多任務併發下可能觸發 storm 閾值拖垮整個 process
- **檔案**:呼叫端(全部 `void`、無 `.catch`):`server/routers/generate.ts:2022,2205,2301,2330,2350`、`server/routers/proStudio.ts:1776,2209`、`server/routers/videoStudio.ts:1718`、`server/routers/director.ts:3306`；被呼叫函式:`server/services/postGenActions.ts:494-499`(`runPostGenForJob` 開頭 `await db.getBackgroundJob(jobId)` 未包 try)、`:575-595`(`refundJobIfBilled` 開頭 `await db.getBackgroundJob(jobId)` 與 `await db.atomicClaimJobRefund(jobId, points)` 均未包 try，try 區塊從第 597 行才開始)
- **失敗情境**:`db.getBackgroundJob`(`server/db.ts:2204-2213`)是裸 Drizzle 查詢,沒有自己的 try/catch,DB 連線暫時性錯誤(逾時/瞬斷/鎖等待)會直接讓這個 `await` 拋出。由於呼叫端全部寫成 `void runPostGenForJob(job.id);` / `void refundJobIfBilled(job.id);`,**沒有任何一處接 `.catch`**,這個拋出會變成 process 級 unhandled rejection。`server/_core/error_handler.ts:132-154` 的全域 handler 設計是「單一 unhandled rejection 只 log(非致命),但 60 秒內累積達 `stormThreshold`(預設 50 次)就觸發 `doFatal`→執行 shutdown→`process.exit(1)`」。這些呼叫點正是 webhookFal/webhookReplicate/webhookSuno/checkStudioJob 輪詢/座艙生成完成後最常觸發的路徑,若同一波 DB 抖動(EH1 第 1、3 項已記錄的確切失敗模式)同時打中多個使用者、多個工作室的完成回呼,短時間內湊出 50 次以上的 unhandled rejection 並非不可能。
- **被吞後的壞狀態**:輕則——單次 DB 抖動被 log 成一行「Unhandled promise rejection (non-fatal)」,**沒有帶 jobId/userId**(因為全域 handler 只拿到裸 `reason`),排查時無法對應回是哪個生成任務,屬於 lost-error-context;重則——若同時段觸發次數衝過 storm 閾值,會讓**整個伺服器行程**因為這幾個原本只是「資產庫/退款」這種盡力而為的背景收尾動作而重啟,牽連當下所有使用者的所有連線與進行中任務,是嚴重度與觸發原因完全不成比例的過度反應。此為需執行期驗證項目:實際 DB 抖動下,這些呼叫點在 60 秒窗口內能否真的湊到 50 次觸發全站重啟,但程式碼層面「這幾個呼叫完全沒有 `.catch`,且函式開頭確實有未受保護的 DB 呼叫」屬於已讀碼確認的事實。
- **建議**:①至少幫這幾個 `void` 呼叫加上 `.catch(err => console.error(...))`,避免它們貢獻到 storm 計數;②`runPostGenForJob`/`refundJobIfBilled` 開頭的 `db.getBackgroundJob`/`atomicClaimJobRefund` 呼叫應納入函式自己的 try/catch,讓函式本身永不拋出(這樣才符合這兩個函式在其餘部分展現出的「盡力而為、吞錯」設計原則,目前只有開頭兩行是例外)。

### 3〔MEDIUM｜swallowed-error + fire-and-forget〕影片編輯器自動快照儲存完全空 catch,零 log,失敗使用者/開發者都無從得知
- **檔案**:`server/routers/videoProject.ts:405-409`(呼叫端)、`server/db.ts:5624-5637`(`createProjectSnapshot`)
- **失敗情境**:`update` mutation 在成功更新專案後,若帶了 `snapshotData`,會呼叫:
  ```
  void db.createProjectSnapshot(input.id, input.snapshotData, snapshotSource).catch(() => {});
  ```
  `createProjectSnapshot`(`server/db.ts:5624-5637`)本身完全沒有內部錯誤處理,DB 寫入失敗會直接拋出;呼叫端的 `.catch(() => {})` 是**完全空的**——沒有 `console.*`,沒有 `logger.*`,對照本檔其他 fire-and-forget(如 EH1、EH3 其餘各項)幾乎都至少留一行警告,這是本次掃描中唯一「連一個字都不記」的浮動 promise。
- **被吞後的壞狀態**:這是編輯器的自動存檔/undo 歷史快照(`snapshotSource` 為 `"auto"` 或 `"agent:<id>"`),使用者編輯座艙專案時預期每次更新都留一個可回復的快照點。DB 暫時故障時,這次快照靜默消失,使用者當下完全不會發現(mutation 本身已經成功回傳,ETag 也已更新),只有等到真的需要「回復到某個版本」卻發現該時間點的快照不存在時才會察覺——而且日誌裡連一條線索都留不下,無法回溯到底是哪次寫入失敗、失敗了幾次。
- **建議**:至少改成 `.catch(err => console.warn("[videoProject] snapshot 儲存失敗", { projectId: input.id, err }))`,方便之後排查「使用者说快照不見了」之類的客訴;若快照被視為關鍵的資料保護機制,可考慮加入輕量重試或告警。

### 4〔MEDIUM｜fire-and-forget，缺 catch，但屬 fail-open 設計〕`modelResearcher` 模組載入時 Redis 熱身呼叫無 `.catch`
- **檔案**:`server/services/modelResearcher.ts:75-84`
- **失敗情境**:模組頂層(process 啟動載入此檔案時執行一次)：
  ```
  void loadAllEnrichmentsFromRedis<EnrichmentRecord>().then(records => {
    for (const r of records) enrichmentStore.set(r.modelId, r);
    ...
  });
  ```
  只有 `.then`,完全沒有 `.catch`。若 Redis 在啟動當下不可用而導致 `loadAllEnrichmentsFromRedis` reject,會在伺服器啟動階段直接產生一個 unhandled rejection。
- **被吞後的壞狀態**:功能面是安全的——註解明講「fail-open,Redis 不可用時 Map 從空的開始,行為與過去相同」,`enrichmentStore` 保持空集合並不影響其餘邏輯正確性。但這個 promise 本身確實沒人接手,會在啟動時於日誌留下一條不帶模組名稱、不帶「這是 modelResearcher Redis 熱身」語意的裸 unhandled rejection 訊息,且與發現 2 一樣會計入全域 storm 計數器。若未來某次部署 Redis 剛好在啟動窗口不穩定,這類頂層無 catch 的呼叫可能與其他呼叫點的 rejection 一起湊數,增加誤觸 storm 閾值的機率。
- **建議**:補上 `.catch(err => logger.warn("[modelResearcher] Redis warmup failed", { err }))`,消除裸 unhandled rejection、順便留下可追溯的訊息。

### 5〔LOW｜race，非崩潰風險，需執行期驗證〕ProStudio/VideoStudio/Generate 對 `doPostGenComplete` 的 fire-and-forget 呼叫,回應可能早於資產庫/歷史寫入完成
- **檔案**:`server/routers/proStudio.ts:1776-1790`、`server/routers/videoStudio.ts:1718`、`server/routers/generate.ts:2022`(對照:`server/services/postGenActions.ts:265-483` `doPostGenComplete` 本體)
- **失敗情境**:`doPostGenComplete` 本身經 EH1 稽核確認每個子步驟都有自己的 try/catch、且末尾的媒體歸檔用 `.catch` 接住,函式本身**保證 resolve、不會拋出**,所以這裡不是「錯誤消失」的問題,而是「時序」問題:呼叫端寫成 `void doPostGenComplete({...});` 之後**立刻** `return { status: "COMPLETED", ... }` 給前端(例如 `proStudio.ts:1793-1799`),完全不等資產庫/歷史寫入完成。
- **被吞後的壞狀態**:使用者看到 tRPC 回應 `status: "COMPLETED"` 的瞬間,資產庫(`digital_asset_library`)、生成歷史(`generation_history`)的對應列可能還沒寫入(通常只差幾十毫秒,但 DB 較慢或負載高時可能拉長)。若前端在收到 COMPLETED 後立刻導頁到「我的資產」或歷史頁,有極小機率看不到剛生成的項目,需重新整理才會出現。這與已知「ProStudio AvatarVideoTab FAILED 零回饋」是不同問題(那個是 FAILED 狀態零回饋,這個是 COMPLETED 狀態下的資料落地時序),且因為視窗極短、通常不會被使用者實際感知到,列為 LOW,實際發生機率與影響需執行期壓測驗證。
- **建議**:若前端有「完成後立即導頁並讀取資產列表」的邏輯,可考慮讓關鍵寫入(至少歷史/資產這兩步)在回應前 `await`,非關鍵的監控/回填/歸檔才繼續 fire-and-forget;或前端對「剛完成」的資產列表查詢加上短暫重試。

---

## 已正確處理錯誤(negative results)

- **`server/services/langsmithTracer.ts:39-86`(`traceToolRun`)**:全庫數十處 `void traceToolRun({...})`(`falDispatcher.ts`、`loraTrainer.ts`、`proStudio.ts`、`imageStudio.ts`、`videoStudio.ts` 等)呼叫的都是這個函式——內部完整 try/catch,任何失敗都吞下且不重丟,函式保證 resolve。這是全庫中量最大的一批 `void` 呼叫,但都安全,不計入發現。
- **`server/services/agentToolExecutor.ts:7671-7730`**:與發現 1 完全同款的「動態 import 啟動訓練」寫法,但這裡有外層 `.catch`,失敗時明確把 backgroundJob 標成 `failed` 並記錄雙重失敗(連標記失敗都失敗會再印一行 error)。這是本次掃描中「正確示範」的版本,建議發現 1 的四處都比照此處補齊。
- **`server/routers/_aiHelpers.ts:63-277`(`driveOrbTaskInBackground`)**:雖然在 `server/routers/ai.ts` 多處以 `void driveOrbTaskInBackground({...})` 呼叫且無 `.catch`,但函式本體用 `try/catch/finally` 完整包住:crash 時會把錯誤鏡射進 FSM(讓前端看到「task failed: 原因」而非卡死轉圈)與稽核日誌,`finally` 保證釋放 `orbAutoDriverInFlight` 與並發配額;而配額釋放本身呼叫的 `releaseCreatorSlot`(`server/_core/agentCreatorQuota.ts:188-198`)又設計成「永不拋出,失敗只 log 並讓 TTL 自癒」。三層防護下,即使發生非預期錯誤,`driveOrbTaskInBackground` 本身仍保證 resolve,是很紮實的 fire-and-forget 範例。
- **`server/services/orbScheduler.ts`**:`void runScheduledOrbJob(job)`(第 379、559 行)呼叫的函式對「上一輪未跑完」做鎖並記錄 `skipped:in_flight` 狀態(而非靜默跳過),真正執行邏輯包在內層 try/catch 把錯誤寫回 `job.lastError`/`lastRunStatus` 供 UI 顯示;`void deleteJobRow(jobId)`(第 405 行)的實作本身也有 try/catch。整份檔案的 fire-and-forget 呼叫都經過設計、有留痕。
- **`server/services/webhookDispatcher.ts:51-98`(`deliverWithRetry`)/`:105-118`(`deliverDirectToSubscription`)**:重試迴圈與最終結果都包在 try/catch 內,`recordDelivery` 另有自己的 try/catch,兩者組合下 `deliverWithRetry`/`deliverDirectToSubscription` 實務上不會拋出(除非 payload 含無法 `JSON.stringify` 的資料,如循環參照,此為理論邊界情況,需執行期驗證是否真的會發生,未列入正式發現)。`server/services/webhookDispatcher.ts:165` 與 `server/routers/webhook.ts:215` 的 `void` 呼叫因此可視為安全。
- **`server/routers/agentCollaborationRouter.ts:493-508`(`void runAutoDiscussion({...}).catch(err => logger.error(...))`)**:正確接了 `.catch` 並帶 `userId`/`collaborationId` 記錄,失敗的討論輪次仍可讓使用者從既有訊息/最後狀態經 UI polling 得知,設計註解也明講這是刻意的 fire-and-forget。
- **`server/jobs/credentialExpiryAlertJob.ts:22`、`server/jobs/userAutoCreditJob.ts:7-22`、`server/jobs/loginHistoryPurgeJob.ts:7-20`**:三個 cron tick 函式都自帶 `isRunning` 鎖 + `try/catch/finally`,排程呼叫端(`void executeXxxTick()`)因此安全,失敗會印出帶前綴的 `console.error`。
- **`server/services/spiritTools/planExecutorTools.ts:513-641`(`runPlan`)**:`controlPlan` 的 `resume` 分支以 `void runPlan({...})` 重新接手執行,`runPlan` 內部用一個自執行 async IIFE 包住整個步驟迴圈,外層再包一層 `try/catch` 把任何未預期例外標成 `plan.status = "failed"` 並 `logger.error`,保證 `runPlan` 本身 resolve、不會拋出。
- **`server/services/orbTaskChainRunner.ts:589-602`(`persistOrbTaskMemoryEvent`)/`server/services/orbTaskStateMachine.ts:232`(`enqueuePriorityJob`)**:两個被 `void` 呼叫的函式各自內部都有完整 try/catch(`orbTaskMemory.ts:113-150`、`priorityQueue.ts:26-38`),Redis/DB 不可用時是 fail-open 設計,不會拋出。
- **`server/services/specializedAgentMemoryStore.ts:81-111`(`recordSpecialistInteraction`)、`server/services/brainStatePersistence.ts:99-110`(`writeStateOnce`)、`server/services/agentModelPicks.ts:68-95`(`recordModelPick`)、`server/services/teachingArchiveAccess.ts:143-162`(`logAccess`)**:四者都是「best-effort 統計/稽核寫入」,各自內部都有 try/catch 並搭配 `logger.warn`/`console.error` 留痕,呼叫端用 `void`(或 `.catch` 已內建)呼叫都安全。
- **`server/_core/index.ts:402-413`(`checkElevenLabsHealth().then().catch()`)、`:1061-1063`(`runDeferredBootInit().catch()`)、`:1073`(`handleOrbVoiceConnection`)**:前兩者都正確接了 `.catch`;`handleOrbVoiceConnection`(`server/ws/orbVoiceGateway.ts:20-133`)雖然外層沒有 try/catch,但函式內唯一可能失敗的 `verifySessionToken` 本身保證回傳 `null`(絕不拋出,`server/_core/googleAuth.ts:179-210` 多層 try/catch),訊息處理迴圈(`ws.on("message", ...)`)也自帶 try/catch/finally 並把錯誤回送給前端,實務上這個函式極難拋錯,風險極低,未列入正式發現。
- **`server/_core/DatabaseManager.ts:151-196`(`startHealthCheck`/`runHealthCheck`)**:`void this.runHealthCheck()` 呼叫的函式完整 try/catch,失敗會更新健康狀態、記錄連續失敗次數並觸發斷路器,不會拋出。
- **`server/_core/error_handler.ts:98-157`**:全域 `unhandledRejection`/`uncaughtException` handler 本身設計良好——單次 rejection 只 log 不致命,有 rolling window 的 storm 偵測門檻;但正因為存在這個「多次觸發即致命」的機制,發現 2 所列缺 catch 的呼叫點才格外值得補上,避免無謂貢獻到這個計數器。
