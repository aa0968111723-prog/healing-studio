# K2 — 生成鏈 × 扣點/退款正確性:對抗式 bug 獵人報告(深挖 wave K)

- 產生日期:2026-07-03
- 依據 commit:`4d137bdb907d67e6708ca360a66e89de0a6f2c2e`
- 波次:**深挖 wave K:生成/扣點正確性**
- 前置依據(不重複其結論):`02-fullstack.md` §1 生成統一管線、`A-cost-integrations.md`(cron/成本地圖)、`G3-orb-tools-spirits.md`(178 case 不可達 = 178 個精靈工具入口斷點,已由 G3 完整記錄,本文件不重寫,僅在涉及扣點/退款交集處引用)
- 方法:逐行讀 `server/db.ts`(扣點/退款/quota 原子函式)、`server/services/postGenActions.ts`、`server/services/refundStatus.ts`、`server/services/orbCostGuard.ts`、`server/jobs/staleJobChecker.ts`、`server/jobs/mediaArchivalCron.ts`、`server/services/mediaArchivalService.ts`、`server/routers/generate.ts`(1-1550 行,含 `multimodal`/`submitMultimodalAsync`)、`server/routers/imageStudio.ts`/`videoStudio.ts`/`proStudio.ts` 的 `checkXxxStatus`、`server/routes/webhookFal.ts`/`webhookSuno.ts`、`server/services/falDispatcher.ts`(charge/reconcile 段)、`server/services/orbQuota.ts`、Supabase `creator_job_throttle` 相關 2 個 migration;全 repo grep seed/cursor/falsy 模式。

---

## 發現總表(依嚴重度排序)

### 1.【嚴重・CONFIRMED】`generate.multimodal` 同步生成失敗會**雙重退款**(每個模態、每種失敗路徑皆中獎)

**觸發情境**:使用者呼叫 `generate.multimodal`(Studio.tsx 主要生成路徑,brainProcedure,`server/routers/generate.ts:342`)。整段生成邏輯(圖/影/音/語音四模態)包在同一個 `try { … } catch (error) { … }` 區塊內——`try` 起於 `generate.ts:676`,對應的 `catch` 在 `generate.ts:1491-1533`,該 catch **無條件**對任何冒出的例外執行 `db.refundUserPoints(userId, _genEstimate.totalPoints)`(:1498)。

但四個模態各自的失敗分支(fal dispatch 回傳 `success:false`,或回傳成功卻抽不到媒體 URL)在**同一個 try 區塊內部**已經自己呼叫過一次 `refundUserPoints`,然後緊接著 `throw new TRPCError(...)`——例如:
- 圖片:`generate.ts:902-908`(dispatch 失敗退款)、`:914-920`(URL 缺失退款)
- 影片:`generate.ts:1002-1008`、`:1014-1020`
- 音樂:`generate.ts:1103-1109`、`:1115-1121`
- 語音:同款結構(:1212 起,`refund` 呼叫緊接 `throw`)

由於這些 throw 都沒有跳出外層 try——它們會被 `catch (error)`(:1491)接住,而該 catch **不檢查是否已經退過款**,直接再退一次相同金額(:1498)。

**錯誤結果**:使用者的一次失敗生成 = 兩次 `refundUserPoints(userId, _genEstimate.totalPoints)`,點數餘額憑空多出一倍。可穩定重現(故意送一個會讓 fal.ai dispatch 失敗的請求,例如無效 `modelId` 或已失效的參考圖 URL),且四個模態、內部至少 8 個分支(902/914/1003/1016/1104/1117/1212/1225 一帶)全部中獎,是系統性而非單點問題。經濟影響方向對平台不利(可被使用者反覆刷退點套利:故意生成失敗→退兩倍→重複)。

**證據 path:line**:
- `server/routers/generate.ts:676`(外層 try 起點)
- `server/routers/generate.ts:1491-1533`(外層 catch,無條件二次退款)
- `server/routers/generate.ts:902-908,914-920`(圖片內部退款+throw)
- `server/routers/generate.ts:1002-1008,1014-1020`(影片內部退款+throw)
- `server/routers/generate.ts:1103-1109,1115-1121`(音樂內部退款+throw)

**修法方向(僅供參考,未實作)**:內部分支的 throw 改用一個「已退款」旗標(或直接不在內部退款、統一交給外層 catch 處理),或外層 catch 改用與 `atomicClaimJobRefund` 同款的冪等鎖(即使這條路徑沒有 `jobId` 可掛,也可以用一個 request-scoped boolean 變數擋第二次)。

---

### 2.【高・CONFIRMED】`orbCostGuard.deductCredits`/`reconcileCredits` 吞掉扣款失敗結果——生成後的「真實成本補收」可能靜默收不到錢

**觸發情境**:光球 15 精靈經 `dispatchFalTask`(`server/services/falDispatcher.ts`)呼叫 fal 模型完成生成後,依實際 `inference_time`/輸出量算出 `actualCost`,呼叫 `reconcileCredits(userId, estimatedCredits, actualCost)`(:482)或 `deductCredits(userId, actualCost)`(:484)做「事後找補」。此時媒體**已經生成完成、使用者已經拿到成品**。

`reconcileCredits`/`deductCredits`(`server/services/orbCostGuard.ts:153-173`)內部呼叫 `db.deductUserPoints(userId, cost)`,但完全不檢查其回傳值 `{ success, actualDeducted, ... }`——`deductUserPoints` 在餘額不足時回傳 `success:false` 且**不拋例外**(`server/db.ts:851-861`),此時 `deductCredits` 視同「呼叫過了就當作扣到了」,沒有任何 log、重試或人工稽核標記。

**錯誤結果**:若使用者當下餘額不足以支付「實際成本 > 預估成本」的差額,這筆差額永遠收不到,且完全無感——沒有錯誤、沒有 log、沒有稽核旗標,對帳時 `api_usage_logs`/成本歸屬會顯示「應收 X」但 `users.remainingGenerations` 從未真的扣到,形成靜默的營收缺口。

**證據 path:line**:
- `server/services/orbCostGuard.ts:153-157`(`deductCredits` 不查回傳值)
- `server/services/orbCostGuard.ts:159-173`(`reconcileCredits` 呼叫 `deductCredits` 一樣不查)
- `server/services/falDispatcher.ts:480-485`(生成完成後呼叫點,成品已交付)
- 對照:`server/services/postGenActions.ts:594-615` 的 `refundJobIfBilled` 有正確處理 `refundUserPoints` 失敗(寫 `refundRestoreFailed` 供稽核)——同一支 `db.ts` 函式家族,退款側有防護、扣款側(這裡)沒有,防護不對稱。

---

### 3.【高・CONFIRMED】`staleJobChecker` 從未呼叫退款——卡住的任務扣了點永遠不退

**觸發情境**:`background_jobs` 進入 `processing` 超過 5 分鐘(fal.ai/Suno webhook 未送達,且使用者已關閉分頁/停止輪詢,或前端輪詢本身因網路問題斷線),`staleJobChecker`(`server/jobs/staleJobChecker.ts`,每 1 分鐘 cron)偵測到後:重試 3 次仍卡住 → 直接 `updateBackgroundJob(job.id, { status: "failed", ... })`(:68-71)。`queued` 超過 10 分鐘同理直接標 `failed`(:107-110)。

**該檔案從頭到尾沒有 import 或呼叫 `refundJobIfBilled`/`refundUserPoints`**(全文 grep 為零命中)。且一旦狀態被寫成 `failed`,後續：
- `webhookFal.ts:208-217` 的「終態短路」邏輯會直接忽略遲到的 webhook(不論該 webhook 事後帶來的是 OK 還是 ERROR),不會再觸發 `refundJobIfBilled`。
- 前端輪詢端點(`generate.ts:2184` `if (job.status !== "processing") return job;`)一樣直接回傳、不再檢查 fal 真實狀態,自然也不會呼叫 `refundJobIfBilled`。

**錯誤結果**:凡是「扣點後進入 processing、之後既沒有 webhook 也沒有人繼續輪詢直到 stale 超時」的任務,使用者被扣的點數**永久遺失**,沒有任何路徑會退款。更值得注意的是:`server/routers/proStudio.ts:2118-2124` 的註解明文寫著「此 job 已寫 costPoints,之後會被 staleJobChecker/輪詢標 failed」「防與 webhookSuno / stale 路徑的 refundJobIfBilled 雙退」——**開發者自己以為 stale 路徑會呼叫 refundJobIfBilled,但實際程式碼從未這樣做**,這是文件/註解與實作的落差,而非單純的遺漏死角。

**證據 path:line**:
- `server/jobs/staleJobChecker.ts:46-94`(整支邏輯,無 refund 呼叫)
- `server/routes/webhookFal.ts:204-217`(終態短路,遲到 webhook 不會補退款)
- `server/routers/generate.ts:2184`(輪詢端終態短路)
- `server/routers/proStudio.ts:2118-2124`(誤以為 stale 路徑會退款的註解)

---

### 4.【中高・CONFIRMED】冒認防護不對稱:videoStudio 有 owner 檢查,imageStudio/proStudio 的輪詢端點沒有

**觸發情境**:`videoStudio.checkVideoStatus`(`server/routers/videoStudio.ts:1671-1685`)在查詢 fal 狀態前,先用 `db.getBackgroundJobByRequestId(input.requestId)` 反查是否有 `backgroundJobs` 記錄且 `userId` 相符,不符即擋(AIDV-244 修復,註解明確寫著「Prevents doPostGenComplete from attributing another user's completed video to ctx.user.id」)。

但同款輪詢端點在另外兩個工作室**完全沒有這道檢查**:
- `imageStudio.checkImageStatus`(`server/routers/imageStudio.ts:1419-1480`)——直接拿 `requestId`+`modelId` 查 fal 狀態,完成即以 `ctx.user.id` 呼叫 `doPostGenComplete`(:1463-1479),無任何所有權驗證。
- `proStudio.checkAudioStatus`(`server/routers/proStudio.ts:1688 起`)——同樣直接查 fal,無所有權驗證。

**錯誤結果**:只要能取得別人的 `request_id`(這是 fal.ai 回傳、可能出現在瀏覽器 network log、分享連結、或被動觀察到的 URL 參數),攻擊者用自己的帳號呼叫 `checkImageStatus`/`checkAudioStatus`,即可:①看到受害者的生成內容(資訊外洩),②觸發 `doPostGenComplete` 把該資產寫進**攻擊者自己的** `digital_asset_library`/`generation_history`(資產歸屬竊取,且攻擊者完全沒付出對應點數,因為扣點發生在原始提交者身上)。

**證據 path:line**:
- `server/routers/videoStudio.ts:1679-1685`(有 owner 檢查,對照組)
- `server/routers/imageStudio.ts:1419-1480`(`checkImageStatus`,無檢查)
- `server/routers/proStudio.ts:1688-1730`(`checkAudioStatus`,無檢查)

---

### 5.【中・PLAUSIBLE】`runPostGenForJob` 的 `postGenComplete` 旗標是 TOCTOU 而非原子 CAS——webhook 與輪詢併發時可能各跑一次

**觸發情境**:`webhookFal.ts`(:303)、`webhookSuno.ts`(:274)、`generate.ts` checkStudioJob 輪詢(:2330)、`director.ts` 輪詢(:3306)都會呼叫 `runPostGenForJob(jobId)`。該函式(`server/services/postGenActions.ts:494-560`)的冪等保護是:先 `getBackgroundJob` 讀 `meta.postGenComplete`,若非 `true` 就繼續執行 `doPostGenComplete`,執行完才用 `mergeBackgroundJobResultJson` 補寫旗標(:550-557)。**這是「讀取判斷→執行→寫回旗標」三步驟,中間沒有任何鎖**,與同檔案退款側 `refundJobIfBilled` 採用的 `atomicClaimJobRefund`(`db.ts:2160-2181`,`UPDATE ... WHERE NOT refunded` 單陳述式 CAS)手法明顯不同、防護等級較弱。

雪上加霜:`runPostGenForJob` 呼叫 `doPostGenComplete` 時**沒有帶 `dedupeMarker`**(`postGenActions.ts:537-548` 逐一列出的參數裡沒有這一項),而 `doPostGenComplete` 內建的「以 `dedupeMarker` 查 `generation_history.compiledPrompt` 存在即整段跳過」保護(:294-319)只在呼叫端主動傳入時才生效——這條保護只覆蓋 `imageStudio/videoStudio` 自家 `checkXxxStatus` 直接呼叫 `doPostGenComplete` 的路徑(那些路徑確實有傳 `dedupeMarker`),不覆蓋經過 `runPostGenForJob` 的 webhook/輪詢/director 路徑。

**錯誤結果**:若 webhook 與同一使用者的輪詢(或使用者開兩個分頁同時輪詢)在極短視窗內(兩者都在對方尚未寫回 `postGenComplete` 旗標前完成各自的讀取判斷)同時抵達,`doPostGenComplete` 會執行兩次:`digital_asset_library`、`generation_history` 各多寫一列(prompt_library 有 `findOrCreatePromptByContent` 去重、`prompt_assets` junction 有唯一鍵可擋,但資產庫/歷史本身沒有等效去重),`enqueueMediaArchivalTask` 也會被觸發兩次(其下游有 `archivedAt` idempotency 擋,但仍是兩次不必要的判斷/下載嘗試)。雖不造成金錢損失(扣點只在提交時發生一次),但造成「我的資產」出現重複項目,使用者觀感上是資料錯誤。

**證據 path:line**:
- `server/services/postGenActions.ts:494-560`(`runPostGenForJob` 全文,TOCTOU 三步驟)
- `server/services/postGenActions.ts:537-548`(呼叫 `doPostGenComplete` 未帶 `dedupeMarker`)
- `server/services/postGenActions.ts:294-319`(dedupe-before-check,僅呼叫端主動傳入 `dedupeMarker` 才生效)
- 對照:`server/db.ts:2160-2181`(`atomicClaimJobRefund` 的正確 CAS 手法)

---

### 6.【中・CONFIRMED】Supabase `creator_job_throttle` 用固定時鐘整點窗口,邊界可雙倍超限

**觸發情境**:`agent_tasks` 表的 `BEFORE INSERT` 觸發器 `enforce_agent_task_rate_limit`(`supabase/migrations/20260629_aidv742_rate_limit_trigger.sql:11-39`)呼叫 `check_creator_job_rate_limit(creator_id, 20)`,號稱「20 tasks/hour」。但對應的監控 probe(`supabase/migrations/20260629_aidv742_rate_limit_bypass_probe.sql:17-21,29-32`)顯示視窗鍵是 `window_start = date_trunc('hour', now())`——這是**固定時鐘整點窗口**(fixed window),不是滑動窗口(sliding window)。

**錯誤結果**:同一 creator 可以在 `xx:59:59` 送滿 20 筆、再於 `xx:00:01` 立刻再送 20 筆,兩秒內達成標稱「每小時 20 筆」限制的 2 倍吞吐量,邊界處限流形同虛設。這對「批次生成放大器」情境(導演批次生成鏈,60 段×4 模態,見 `A-cost-integrations.md` §3.4)是真實的尖峰壓力風險——只要卡在整點附近提交,理論尖峰吞吐可達額定值的 2 倍。

**證據 path:line**:
- `supabase/migrations/20260629_aidv742_rate_limit_bypass_probe.sql:17-21,29-32`(`date_trunc('hour', now())` 固定窗口)
- `supabase/migrations/20260629_aidv742_rate_limit_trigger.sql:11-39`(觸發器主體)
- 補充事實:`02-fullstack.md` §12 已載明前台九工作室生成鏈本身不呼叫 Supabase,此觸發器只保護 `agent_tasks`/`video_projects` 這條(疑似 AI-agent 專案)管線,不覆蓋 studio 端 `background_jobs` 主生成鏈——即 studio 端批次生成完全不受此限流保護,只靠下一條(#7)的記憶體版配額。

---

### 7.【中・PLAUSIBLE】`orbQuota`/`ENABLE_ORB_IDEMPOTENCY_GUARD` 雙雙預設記憶體/OFF——同一生成重複提交的實際扣點次數 = 提交次數

**觸發情境**:`ENABLE_ORB_IDEMPOTENCY_GUARD` 預設 `false`(`server/_core/env.validated.ts:573`;`ai.ts:999-1003` 讀取)。這面旗標唯一守護的是 `ai.chat`(光球對話)路徑裡對「疑似生成請求」的 5 秒內重複偵測(`ai.ts:1577-1602`,`buildOrbIdempotencyKey`+`findDuplicateTask`)。旗標關閉時,此路徑**完全沒有任何去重機制**——使用者對光球說兩次「幫我生成一張貓的圖」(雙擊送出、雙分頁、網路重試造成的重送)會各自形成獨立的 planner 呼叫,各自走 `studio.generateImage` 扣點一次。即使打開旗標,`findDuplicateTask`/`rememberTaskKey` 也只是 in-memory Map(`ai.ts` 引用,無 Redis 後援),多 replica 部署下每個 replica 各自一份狀態,防護只在單一 replica 內、5 秒視窗內有效。

同源問題:`orbQuota.ts`(`userDailyCounters`/`sessionClicks`/`providerRateCounters`,:22-24)全部是 `Map`,無 Redis 持久化;`ENABLE_ORB_QUOTA_GUARD` 本身還預設 `false`(`02-fullstack.md` §9.3)。兩個旗標疊加的後果:光球代理的「40 次/天」配額在**當前預設組態下完全不生效**(guard 未開),就算未來打開,只要是多 replica 就等於「40 次/天 × replica 數」,且每次 redeploy 全部歸零。

**錯誤結果**:同一句生成請求重複提交會扣幾次點數 → 答案是「提交幾次就扣幾次」,沒有任何伺服端層級的去重或節流兜底(工作室分頁的手動生成按鈕另有其自身的一次性 mutation,不在此範圍,但同樣沒有 idempotency key,雙擊/雙分頁一樣可造成雙重扣點,只是本節聚焦光球對話路徑,因其影響面最廣——所有 15 精靈的生成呼叫都經過 `ai.chat`)。

**證據 path:line**:
- `server/_core/env.validated.ts:573`(`ENABLE_ORB_IDEMPOTENCY_GUARD` 預設 false)
- `server/routers/ai.ts:999-1003,1577-1602`(guard 邏輯與 5 秒視窗)
- `server/services/orbQuota.ts:22-24`(純記憶體 Map)
- `02-fullstack.md` §9.3(`ENABLE_ORB_QUOTA_GUARD` 預設 OFF,交叉引用非重複)

---

### 8.【低中・PLAUSIBLE,檔案自承】`findOrCreatePromptByContent` 併發雙插入

**觸發情境**:`postGenActions.ts:107-197`(`findOrCreatePromptByContent`)以「先 SELECT 既有 (userId, category, content) 列、查無才 INSERT」做 upsert-by-content 去重,**沒有 DB 唯一鍵**兜底。檔案自身註解已經承認(:82-84):「並發 race(無 DB 唯一鍵)已知缺口:兩條並發鏈同 content 同時查不到 → 都 insert → 偶發多一列」。

**錯誤結果**:使用者短時間內用完全相同的 prompt 觸發兩次生成(例如快速重骰兩次相同文字),兩條請求的 `findOrCreatePromptByContent` 都可能在對方 insert 完成前完成自己的 SELECT,各自 insert 一列,造成 `prompt_library` 出現重複列、`useCount` 統計分散到兩列而非收斂到一列。非破壞性,但污染「提示詞去重」的核心承諾。

**證據 path:line**:`server/services/postGenActions.ts:82-84`(檔案自述缺口),`:107-197`(實作)

---

### 9.【低・CONFIRMED】seed=0 truthy 丟棄——H2 已發現 fluxKontext,本次擴大確認範圍與精確行號

**觸發情境**:`client/src/pages/ImageStudio.tsx` 內大部分模型分支已用正確寫法 `...(seedNum !== undefined && { seed: seedNum })`(:3426,3501,3516,3586),但仍有分支殘留 truthy 寫法:
- `:3557`、`:3572` — `...(seedNum && { seed: seedNum })`
- `:3610`、`:3629`、`:3642` — `...(sdSeed && { seed: parseInt(sdSeed) })`

伺服端 `server/services/modelClients.ts:271` 有同款寫法 `...(params.seed && { seed: params.seed })`,但此 `FalClient.generateImage` 僅被 `ModelOrchestrator.generate()`(:994)呼叫,而全站對 `getOrchestrator()` 的呼叫點(`agentToolExecutor.ts:1427-1428`、`proStudio.ts:2028-2029,2147-2148`)全部只取用其 `.suno` 存取器,`.generate()`/`.fal` 路徑未見任何呼叫端引用——這條 seed bug 疑似死碼,列出以求完整但標註為低可達性。

**錯誤結果**:受影響的 ImageStudio 分支中,使用者填 seed=0(意圖「使用第 0 號可重現種子」)實際仍會送出「不帶 seed」給 fal(等同隨機),與使用者預期不符,且與同檔案其他分支的正確行為不一致(修復不完整,H2 判定為「功能性死值」,本次確認影響行數不只 H2 原記錄的單一分支)。

**證據 path:line**:
- `client/src/pages/ImageStudio.tsx:3557,3572,3610,3629,3642`(bug 分支)
- `client/src/pages/ImageStudio.tsx:3426,3501,3516,3586`(同檔正確寫法,對照組)
- `server/services/modelClients.ts:271`(伺服端同款 bug,推定死碼)

---

### 10.【低・PLAUSIBLE】`orbTaskStateMachine` in-memory Map 重啟遺失,無對應退款/恢復路徑

**觸發情境**:`02-fullstack.md` §7 已載明 `orbTaskStateMachine`(`orbTaskStateMachine.ts:73`)是純記憶體 Map,「重啟即失」。使用者在光球任務執行中途(`ai.orbTask.approve/retry` 等)若遇到 Railway 重啟/redeploy,FSM 狀態全部消失。

**錯誤結果**:`staleJobChecker` 只掃描 `background_jobs` 表且僅覆蓋 `jobType ∈ {image, video, audio, voice}`(`staleJobChecker.ts:23`),與 `orbTaskStateMachine` 的記憶體狀態是兩套不同的資料模型——若光球任務已扣點但其記憶體態在重啟時遺失,**沒有任何背景 job 記錄可讓 staleJobChecker 接手**,使用者既看不到任務(前端輪詢拿不到 FSM 狀態)也沒有自動退款觸發路徑,只能等待人工介入或使用者自行申訴。

**證據 path:line**:`02-fullstack.md` §7(`orbTaskStateMachine.ts:73` 記憶體 Map);`server/jobs/staleJobChecker.ts:23`(覆蓋範圍不含光球任務 FSM)

---

### 11.【低・PLAUSIBLE】`mediaArchivalService` 的 fire-and-forget 版本無行鎖,可能與 5 分鐘 cron 併發重複下載

**觸發情境**:`enqueueMediaArchivalTask`(`postGenActions.ts:470-482`)是「同進程版本」——`mediaArchivalService.ts:163-168` 明確自述其非持久化 queue,呼叫端 `.catch` 吞錯即返回,真正的下載/上傳在背景 Promise 內執行。`mediaArchivalCron.ts` 每 5 分鐘另外掃描 `archivedAt IS NULL` 的資產補刀(:1-15)。`archiveAsset`(`mediaArchivalService.ts:56-113`)僅以 `asset.archivedAt` 是否為 null 判斷是否要動作,**沒有 `SELECT ... FOR UPDATE` 或等效行鎖**。

**錯誤結果**:若 in-process 的 fire-and-forget 任務尚在下載中(此時 DB 裡 `archivedAt` 仍是 null)、同時 cron 掃描到同一筆資產,兩邊會各自呼叫 `persistExternalMediaUrl` 對同一個外部 URL 下載一次、各自 PUT 一次 R2——非資料損毀(最終 `archivedAt`/`fileUrl` 會被其中一次寫入覆蓋,結果一致),但造成重複下載/重複 R2 Class A 寫入,浪費頻寬與成本(對照 `A-cost-integrations.md` §2.4 已指出 R2 操作數與生成量線性相關,此為額外放大因子)。

**證據 path:line**:`server/services/mediaArchivalService.ts:56-113,163-168`;`server/jobs/mediaArchivalCron.ts:1-21`

---

## 未查完部分(誠實聲明)

- **未做壓力/併發實測**:#1(雙重退款)、#5(postGenComplete TOCTOU)、#6(整點窗口邊界)均以程式碼路徑推理確認邏輯必然發生(#1)或視窗存在(#5/#6),但未實際起併發請求量測真實命中率;#1 是「每次都會發生」的邏輯必然結果(非機率性 race),信心最高。
- **`server/routers/generate.ts` 的 `submitMultimodalAsync`(背景任務模式,:1561 起)與 `checkStudioJob`(:2176 起)本次已讀,但 `director.ts`/`proStudio.ts` 各自數千行的其餘生成分支(除已引用段落外)未逐行核對是否有同款「內部退款+throw 又被外層 catch 二次退款」模式——#1 目前僅確認發生在 `generate.ts:676-1533` 這個 `multimodal` mutation,**未排除** `director.executeGenerationTask`(:2751 起)、`proStudio.ts` 各生成 mutation 是否有結構相似的外層 catch。建議下一輪針對這兩處做同款「outer try 範圍 vs 內部 refund-then-throw 分支」逐一核對。
- **agentDlq(`server/services/agentDlq.ts`)**:讀過後判定這是 AIDV 開發工作流驗證門失敗佇列(Jira 卡片流程),非生成/扣點鏈路的一部分,`pollDlq` 為唯讀監控、不執行重試副作用,故未列入 bug 清單;但未逐行核對其消費端(routeValidationFailure 呼叫方)是否有獨立的重試迴圈風險。
- **`checkAndConsumeQuota("generation")`(`agentToolExecutor.ts:1015-1024`)與 `orbQuota.ts` 的關係**:已確認底層是記憶體 Map(#7),但未實際檢查 `GENERATION_SLOT_TOOLS` 15 個工具是否每個都正確接了這道檢查(僅讀了呼叫框架,未逐一核對 15 個工具內部是否有繞過路徑)。
- **`falDispatcher.ts` 降級鏈(fallback chain)重試次數與 `reconcileCredits` 的交互**:確認了成功路徑的扣款吞錯問題(#2),但降級重試多次失敗、最終仍全部失敗時的退款路徑(是否也呼叫 `refundJobIfBilled` 或類似機制)未深入追蹤,可能是額外的退款覆蓋缺口,留待下一輪。
- **seed=0 全 repo 掃描**(#9)已涵蓋 `server/`+`client/src` 的 `seed`/`cursor`/常見金額欄位 grep,但未對 `shared/`、`drizzle/` 之外的每一個模型參數(如 `guidance_scale`/`strength`/`loraWeight` 等)做窮舉性人工核對,只做了關鍵字抽樣,不排除仍有零星漏網之魚。
