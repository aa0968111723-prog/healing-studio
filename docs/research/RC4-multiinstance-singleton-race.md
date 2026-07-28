# RC4 — 多實例/單例/快取競態
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:orbTask FSM(in-memory)、learnHub/siteKnowledge 快取、worker process-local 鎖、任何 module-level 可變狀態/單例

---

## 0. 前置已知(prior,僅確認現況,不重複分析)

以下為呼叫端交付的既有結論,本輪逐行核對後**現況不變**:

- `server/services/orbTaskStateMachine.ts:73` `const taskStore = new Map<string, OrbAgentTask>()` — R15,純 in-memory、**零持久化**(無 disk fallback、無 DB),多實例部署下同一 `taskId` 只活在建立它的那個 process。現況不變。
- W9:`modelTrainingWorker`/`teachingArchiveIngestionWorker`/`assetCleanupJob`/`mediaArchivalCron` 等 4 個 worker 僅靠 process-local `isRunning`/`isRun` boolean 防重入(`docs/research/RC1-billing-quota-race.md` 已記錄,`db.ts` 的 `getQueuedJobsByType`/`updateBackgroundJob` 仍無 `WHERE status='queued'` 式 CAS)——現況不變,本文件不重跑分析。
- `server/services/brainAutoRepair.ts:199-204`(`apiAlerts`/`errorTraces`/`reflectionProposals`/`webResearchResults`/`accuracyTests` 五個 module-level 陣列,注解自陳「同 learnHub 模式」)+ `:253-268`(`persistState()` debounced 1.5s 寫一次 `.brain-state.json`)+ `:953-954`(`errorTraces.unshift(full)` / 超過 `MAX_TRACES` 用 `.length=` 截斷)——確認現況不變;`server/routers/brain.ts:915` 的 `errorTraces` procedure 即讀這個陣列。**新確認的細節**:落地機制(`server/services/brainStatePersistence.ts:104-105` `fsPromises.writeFile(tmpPath,...)` → `fsPromises.rename(tmpPath, filePath)`)是**正確的 tmp+rename 原子寫入**(檔頭 `:12` 註解「避免半寫入損毀」與實作一致)——這點比下面發現 5 的 `orbTaskStore.ts` 落地機制更安全,列入「已正確保護」對照組。
- `server/services/siteKnowledge.ts:81-116` `learnHubOrbIndexCache`(以為 `learnHub.ts` 的 `docs` 陣列「模組載入時是靜態」的快取,`getLearnHubOrbIndex()`/`__resetLearnHubOrbIndexCacheForTests()`)——`docs/research/W6-siteknowledge-deepdive.md` 與 `docs/research/X6-learnhub-router-deepdive.md` 已完整記錄「靜態假設已被證偽(`learnHub.ts:50` 是 `let docs`,`create`/`update`/`delete`/`importDocs` 四條寫入路徑皆直接改動,`:620/663-670/701/789`)、快取永不失效、且第二個獨立快取 `server/services/spiritTools/learningSpecialistTools.ts:74` `cachedLearnHub` 有相同問題」。本輪逐行核對 `learnHub.ts:50,620,663-670,701,789` 與 `learningSpecialistTools.ts:74,91,105-106,111-112,117,125,136` —— **現況不變**,兩個快取仍未接上任何 invalidation,生產路徑無任何呼叫 `__resetLearnHubOrbIndexCacheForTests()`。不重複展開,詳見 W6 §「learnHubOrbIndexCache 的『靜態陣列』假設已被證偽」與 X6 §「寫入端…從未讓下游至少兩個獨立記憶體快取失效」。

---

## 1. 發現總表(依嚴重度排序)

### 1.【高・cluster: multi-instance・無保護】`orbIdempotency.ts` 的請求去重/任務去重是純 process-local Map,水平擴展下同一次使用者送出可在不同副本各自被判定為「新請求」,重複觸發昂貴的生成任務與 LLM 呼叫

**競態窗口(行號)**

- `server/services/orbIdempotency.ts:17-18`:`store`(`IdempotentRecord`,90s TTL)、`requestIdStore`(`RequestIdStoreRecord`,60s TTL)——兩個模組層級 `Map`,**沒有 Redis/DB 後援**,僅靠 `setInterval(cleanExpired, 30_000).unref()`(`:43`)做本地清理。
- 路徑 A(整個 chat mutation 去重):`server/routers/ai.ts:537-551`——`checkAndLock(idempKey)`(`orbIdempotency.ts:50-63`)靠 `x-request-id`/`input.requestId` 判斷「new / in-progress / duplicate」,決定要不要真的跑完整套多模態 LLM 對話與精靈路由。
- 路徑 B(生成型任務去重):`server/routers/ai.ts:1582-1601`——對「附件或生成/deploy/GitHub 類意圖」文字算 `buildOrbIdempotencyKey`,`findDuplicateTask(idempotencyKey)`(`orbIdempotency.ts:111-114`)在 5 秒窗內判定重複才短路,否則 `rememberTaskKey`(`:116-128`)記錄後放行去建立真正的 orb 任務(可能觸發 fal.ai/Replicate 等外部付費生成呼叫)。
- 單 process 內部:路徑 A、B 內「讀判斷→寫鎖定」之間**全程無 `await`**(純同步),JS run-to-completion 語意下不會被同 process 的其他呼叫交錯打斷——**單一 instance 內部安全**。

**交錯後果**

- 若站方以 N 個 process/replica 對外服務(容器化水平擴展、Railway 多副本、或使用者網路重試 + 負載平衡器把重試路由到不同 replica),同一個 `x-request-id`/同一份文字+附件在 5 秒內先後落在 replica A 與 replica B 上時,兩邊的 `Map` 各自為政:A 的 `checkAndLock`/`findDuplicateTask` 看不到 B 剛寫入的紀錄,兩邊都判定「new」並各自跑完整套流程——結果是同一次使用者操作觸發兩次(或以上)LLM 呼叫與/或兩個獨立的生成任務(各自呼叫外部付費 API、各自扣一次相關配額/點數,若對應扣點路徑本身有 CAS 保護則點數不會被「雙扣同一筆」但仍是「兩筆各自合法扣款」的重複消費)。
- 對使用者體驗而言更明顯的是路徑 A:客戶端斷線重試同一 `requestId` 落到另一 replica,得到的不是預期的 `{status:"duplicate", cached result}`,而是重新完整跑一次(可能產生第二筆不同的 AI 回覆,與第一個 replica 已完成的回覆不一致)。

**建議**:把 `store`/`requestIdStore` 改成 Redis-backed(`SET key value NX PX <ttlMs>` 做 `checkAndLock` 的原子 new/duplicate 判斷,`GET`/`SET` 做 `storeResult`/`getResult`),與本檔案已經在用的 `hashIntentSignature`(`providerRouter.ts`)介面不變、只換底層儲存;`findDuplicateTask`/`rememberTaskKey` 同理。若暫不接 Redis,至少在 README/部署文件註明「該去重機制僅在單 instance 或有 sticky session(同一 requestId 落同一 worker)時有效」,比照 `serverDeploymentMode.ts` 的 `warnIfMultiInstanceSingleton` 模式在 boot 時警告。

**hasProtection**:否(process-local Map,無 CAS/鎖/交易的跨 instance 版本;單 instance 內因無 await 交錯而安全,不代表多 instance 安全)。

---

### 2.【高・cluster: multi-instance・無保護,且未被現有警告機制涵蓋】`orbCodeTask.ts` 的 `codeTaskStore` 是純 in-memory Map,沒有走 `orbTaskStore.ts` 的 disk fallback,也沒有呼叫 `warnIfMultiInstanceSingleton`——Claude Code / Codex 子代理任務狀態在多實例/重啟後直接消失,且 operator 完全看不到警告

**競態窗口(行號)**

- `server/services/orbCodeTask.ts:11`:`const codeTaskStore = new Map<string, OrbCodeTask>()`;`:12` `codeTaskTelemetry: Array<Record<string, unknown>>` 同為模組層級陣列(cap 1000 筆,`:49` `.shift()`)。
- 全部讀寫(`createOrbCodeTask` `:105`、`getOrbCodeTask` `:121`、`listOrbCodeTasks` `:125`、以及狀態變更函式 `:131/150/169/189/213/234/275`)都直接操作這個 Map,**沒有任何 disk persistence、沒有 DB 表、沒有 Redis**。
- 唯一匯入端是 `server/routers/ai.ts:100`——即所有 Claude Code / Codex 任務的建立、查詢、狀態更新(含 PR ready / merged / blocked 等)全部經由 tRPC mutation/query 打到這個 process-local Map。
- 對照組:同樣「process-local in-memory 且已知多實例風險」的 `orbScheduler.ts:51`(`jobRegistry`)與 `planExecutorTools.ts:165`(`PLAN_STORE`)都在 boot 時呼叫 `warnIfMultiInstanceSingleton`(`orbScheduler.ts:536-543` 標 L4、`planExecutorTools.ts:50-57` 標 H6)——`orbCodeTask.ts` **沒有**匯入或呼叫 `serverDeploymentMode.ts` 的任何函式(全庫 grep 只有 `orbScheduler.ts`、`planExecutorTools.ts` 兩處呼叫點),代表這個一樣屬於「H6/L4 類」的子系統目前完全遊離在既有的多實例警告清單之外。

**交錯後果**

- 使用者在 replica A 上建立一個 Claude Code 任務(`createOrbCodeTask`),之後前端輪詢任務狀態的請求被負載平衡器路由到 replica B——`getOrbCodeTask(codeTaskId)` 在 B 上回傳 `null`(找不到任務),前端會看到任務「消失」或誤判為錯誤,即使 A 上的任務其實仍在正常執行/已完成。
- 任一 replica 重啟(部署捲動更新、記憶體限制重啟、崩潰重啟皆屬常態)會讓該 replica 上所有進行中的 code task 狀態瞬間全部消失且無法恢復——沒有 disk fallback,連 `orbTaskStore.ts` 那種「至少寫過 `.json` 檔」的最低限度容錯都沒有。
- 因為沒有呼叫 `warnIfMultiInstanceSingleton`,operator 在多實例部署下完全不會在 stdout 看到任何提示,是本輪掃描中「風險等級與 H6/L4 相同、但完全沒有既有緩解措施覆蓋」的個案。

**建議**:短期——在 `orbCodeTask.ts` 模組載入時比照 `orbScheduler.ts`/`planExecutorTools.ts` 呼叫一次 `warnIfMultiInstanceSingleton("orbCodeTask", "in-memory codeTaskStore → Claude Code/Codex 任務狀態跨 worker 不可見,重啟即遺失")`,成本極低、立即讓 operator 知道限制。中期——比照 `orbTaskStore.ts` 的模式接上 `ORB_TASK_STORE_FILE` 風格的 disk fallback,或直接搬進既有 `orb_scheduled_jobs`/`orbScheduledJobs` 一類的 DB 表(`codeTaskId` 做主鍵),讓子代理任務狀態能跨 worker/跨重啟存活。

**hasProtection**:否(無警告、無持久化、無跨 instance 共享)。

---

### 3.【中高・cluster: multi-instance・部分保護(僅 log 警告,無實際鎖)】`orbScheduler.ts` jobRegistry(L4)與 `planExecutorTools.ts` PLAN_STORE(H6)——程式碼自身已標註並在 boot 時警告,但截至本次稽核仍未接上 leader election / sticky session,多實例下 cron 仍會 N 倍觸發、plan 查詢仍會跨 worker 404

**競態窗口(行號)**

- `server/services/orbScheduler.ts:51` `const jobRegistry = new Map<string, ScheduledJobRecord>()`;`:535-543` `startOrbScheduler()` 開頭即呼叫 `warnIfMultiInstanceSingleton("orbScheduler", "in-memory jobRegistry → every worker fires cron jobs independently (double-trigger / N-trigger risk)")`,註解明確寫「L4:…同 tick 被觸發 N 次(N = worker 數)」;`:556-563` 每個 worker 各自對同一批 DB 讀出的 `persisted` job 呼叫 `cron.schedule(...)`,**沒有 leader election、沒有分散式鎖**搶執行權。
- `server/services/spiritTools/planExecutorTools.ts:165` `const PLAN_STORE = new Map<string, PlanRecord>()`;`:50-57` module load 時即呼叫 `warnIfMultiInstanceSingleton("planExecutor", "in-memory PLAN_STORE → plans created on one worker are invisible to other workers (cross-worker 404 risk; needs sticky session)")`,註解明確標「H6」。
- `server/services/serverDeploymentMode.ts:74-112` `warnIfMultiInstanceSingleton` 的偵測(`:44-64`)靠讀取 `NODE_APP_INSTANCE`/`PM2_INSTANCE_ID`/`K8S_POD_NAME`/`KUBERNETES_PORT`/`NODE_CLUSTER_WORKERS`/`WORKER_ID`/`INSTANCE_ID` 等環境變數——若實際部署環境(例如 Railway)不設這些變數但仍水平擴展多個 process,偵測會**假陰性**(`:56` `isLikelyMultiInstance = signals.length > 0`),完全不印警告,這點**需執行期驗證**(需要實際確認 Railway/現行部署平台是否會設置上述任一變數;若都不設,連這道最後防線的 log 警告都不會觸發)。

**交錯後果**

- orbScheduler:若確實多副本執行且警告有觸發(或平台未設偵測變數而警告未觸發但仍在跑多副本),同一條使用者定義的 cron 排程會被 N 個 worker 各自 `cron.schedule` 註冊,同一個 tick 觸發 N 次 `runScheduledOrbJob(job)`,對應到「這個 cron 任務描述的動作」被實際執行 N 次(若動作本身是生成類、發信類、下單類等有副作用的操作,即是重複副作用/重複扣款)。
- planExecutor:使用者透過 `planFromGoal` 在 worker 1 建立的 plan,後續 `getStatus`/`resumePlan`/`cancelPlan` 等查詢若被路由到 worker 2,會直接查無此 plan(cross-worker 404),使用者看到的是「計畫消失」或操作對一個不存在的 ID 生效(no-op),而非計畫真的被取消/繼續。

**建議**:與程式碼註解已寫的方向一致——orbScheduler 需要 leader election(例如用 DB `SELECT ... FOR UPDATE` 或 Redis `SET NX` 搶一個 `scheduler:leader` 鎖,只有搶到鎖的 worker 真的呼叫 `cron.schedule`);planExecutor 需要 sticky session(同一使用者的 plan 相關請求固定路由到建立該 plan 的 worker)或把 `PLAN_STORE` 搬到 Redis/DB。在此之前,`detectDeploymentMode()` 的環境變數清單應該加入實際部署平台(如 Railway 的 `RAILWAY_REPLICA_ID`/`RAILWAY_DEPLOYMENT_ID` 等,若存在)以避免假陰性——**需執行期驗證目前平台是否會設置這類變數**。

**hasProtection**:部分(有 boot-time console 警告提示 operator,但無實際鎖/leader election/sticky session;警告本身若部署平台未觸發偵測訊號也可能靜默失效,需執行期驗證)。

---

### 4.【中・cluster: multi-instance・架構半遷移】`orbTaskStateMachine.ts` 的 `taskStore`(R15)雖已知,但本輪額外確認:排程順序已遷到 Redis-backed `priorityQueue.ts`,任務本體卻仍留在 process-local Map——是「一半共享狀態、一半不共享」的不一致架構,而且消費端 `dequeuePriorityJob` 目前全庫零呼叫

**競態窗口(行號)**

- `server/services/orbTaskStateMachine.ts:73`(`taskStore` Map,R15 已知)、`:232` `void enqueuePriorityJob(task.taskId, priority)`——任務建立後把「排隊順序」寫進 Redis Sorted Set(`server/services/priorityQueue.ts:15` `getRedisClient()`、`:26-34` `enqueuePriorityJob` 用 `redis.zadd`),這部分**正確共享**、多 instance 下 Redis 裡的隊列順序是一致的。
- 但 `priorityQueue.ts` 的 `dequeuePriorityJob`(約 `:41-50`,`redis.zpopmin`)全庫 grep(`server/**/*.ts`)**只有定義處這一個匹配**,沒有任何呼叫端——代表目前沒有任何 worker 真的去 Redis 裡把這個佇列「彈出」來消費;`taskStore` 裡的實際任務物件(`OrbAgentTask`,含 steps/狀態/審計事件)仍然只活在建立它的那個 process 記憶體裡。
- 若未來有程式接上 `dequeuePriorityJob` 做真正的跨 worker 任務分派(這是這支 Redis 佇列存在的合理目的),會立即撞上:worker X 從 Redis 彈出 `taskId`,但該 `taskId` 對應的完整任務物件只存在於原本呼叫 `createOrbAgentTaskFromPlanner` 的 worker Y 的 `taskStore` Map 裡,worker X 的 `getOrbAgentTask(taskId)` 回傳 `null`——排程「知道」該執行哪個任務,卻拿不到任務內容。

**交錯後果**:**目前**(`dequeuePriorityJob` 零消費端)不構成可觸發的併發缺陷,只是死碼/尚未接線的佇列基礎設施,不影響現行行為——**需執行期驗證**是否有本 repo 之外的 worker/service 在消費這個 Redis key(`QUEUE_KEY`),若有則上述跨 worker 任務內容缺失會直接發生。若未來要接上真正的多 worker 任務分派,必須先把 `taskStore` 遷到與 `priorityQueue` 同等級的共享儲存(Redis Hash / DB),否則排隊機制形同虛設。

**建議**:在把 `dequeuePriorityJob` 接上任何消費端之前,先把 `taskStore`(`OrbAgentTask` 全物件)遷到 Redis/DB,或至少讓 `enqueuePriorityJob` 的呼叫端明確記錄「這個佇列目前只反映建立順序,不代表可跨 worker 執行」,避免未來的人誤以為排隊即代表可分派。

**hasProtection**:部分(佇列順序層有 Redis 保護;任務內容層完全沒有,是不對稱的半遷移狀態)。

---

### 5.【中・cluster: multi-instance / persistence・已由 CC4 記錄,本輪確認現況不變】`orbTaskStore.ts`(legacy FSM)每次 mutation 都整表 `writeFileSync` 落地,且該檔案本身是模組層級單例,無跨 instance 共享

**競態窗口(行號)**

- `server/services/orbTaskStore.ts:40-45`(`class OrbTaskStore` 內部 `private tasks = new Map<string, OrbTask>()`)、`:516`(`export const orbTaskStore = new OrbTaskStore(process.env.ORB_TASK_STORE_FILE)`)——模組層級單例,`ORB_TASK_STORE_FILE` 預設為空字串(未設定時整個 disk fallback 不啟用,純記憶體)。
- `:103-111` `persistToDisk()`:`writeFileSync(this.persistenceFile, JSON.stringify(Array.from(this.tasks.values())), "utf8")`——**同步、非原子**(不像 `brainStatePersistence.ts:104-105` 用 tmp 檔 + `rename`),且 `create`/`approve`/`approveStep`/`reportStep`/`injectRevisedSteps` 等**幾乎每個 mutation** 都呼叫一次,`get`/`getTimeline` 等純讀取路徑也經 `cleanup()`(`:113-118`)在 TTL 到期時觸發整表重寫。

**交錯後果**(`docs/research/CC4-remaining-orb-services.md` §1 已完整記錄,本輪核對現況不變,不重新展開):即使 `ORB_TASK_STORE_FILE` 真的被設定為共享路徑,多個 process 同時 `writeFileSync` 整份 JSON 到同一檔案時,寫入不是原子的(無 rename 中介),進程若在寫入中途被中斷(OOM/滾動部署 SIGTERM)會留下截斷的 JSON,下次 `loadFromDisk()`(`:82-101`)`JSON.parse` 會直接拋錯並被 catch 吞掉(`:98-100`),等同該次啟動整份任務歷史遺失。且該檔案未設定時(目前預設)則是純記憶體、與 `taskStore`(R15)同樣的多 instance 分歧問題。

**建議**:同 CC4 既有建議——`persistToDisk` 改用 `brainStatePersistence.ts` 已驗證的 tmp+rename 原子寫入 pattern;純讀取路徑不應觸發任何寫入;`persistToDisk` 本身應非同步化並加 debounce。

**hasProtection**:否(`writeFileSync` 非原子;disk fallback 預設關閉時退化為純記憶體,與 R15 同根因)。

---

### 6.【低中・cluster: cache-race・已由 W6/X6 完整記錄,本輪僅確認現況不變】`learnHubOrbIndexCache`(`siteKnowledge.ts`)+ `cachedLearnHub`(`learningSpecialistTools.ts`)兩個獨立快取皆未對 `docs`/`videos`/`quizzes` 的寫入做失效

見前置已知 §0 最後一項,`docs/research/W6-siteknowledge-deepdive.md`、`docs/research/X6-learnhub-router-deepdive.md` 已有完整競態窗口/建議(module-level `docsVersion` + `${limit}:${docsVersion}` 快取鍵)。本輪僅補充:兩個快取在**多實例**部署下的疊加效應——即使照 W6/X6 建議加上 `docsVersion` 讓單一 process 內快取正確失效,`docsVersion` 本身仍是模組層級計數器,不同 instance 的 `docsVersion` 互不同步(instance A 上管理員新增一篇文件,`docsVersion` 在 A 上 +1,但 B 上的 `docsVersion` 不變)——修法時若只做「同 process 內版本鍵」,多實例下 B 的光球知識庫仍會對 A 剛新增/編輯的文件視而不見直到 B 重啟或也收到同一次寫入(目前架構下 B 完全不會收到,因為 `docs` 本身也是各 instance 各自的記憶體副本,只在各自 boot 時透過 `initLearnHubFromDb()` 從 DB 拉一次)。

**建議**(疊加 W6/X6 既有建議):`docsVersion` 式修法只解決「單 process 內快取陳舊」,不解決「多 instance 知識庫不同步」;後者需要 `docs`/`videos`/`quizzes` 本身改為每次讀取都查 DB(有各自的快取層),或透過 pub/sub(Redis `PUBLISH`)在任一 instance 寫入後廣播使其他 instance 的記憶體副本失效重拉。

**hasProtection**:否(單 process 快取失效與多 instance 資料同步都缺)。

---

### 7.【低中・cluster: multi-instance・同根因擴散,未逐一深挖】除 `orbQuota.ts`(已由 `docs/research/RC1-billing-quota-race.md` 發現 4 記錄)外,至少 4 個同形狀的 process-local 限流/配額 Map 未被涵蓋

**確認清單(僅列行號,不逐一展開競態敘事,root cause 與 RC1 發現 4 相同)**:

- `server/_core/rateLimiter.ts:235` `_chatRateLimitStore`、`:267` `_feedbackRateLimitStore` — 每使用者聊天/回饋速率限制,per-instance 計數。
- `server/_core/trpcRateLimit.ts:22` `windows`、`:84` `agentWindows` — tRPC 層級通用速率窗口,per-instance。
- `server/services/perplexityThrottle.ts:139` `userTimestamps` — Perplexity 呼叫節流,per-instance。

**交錯後果**:與 RC1 發現 4 相同——多副本部署下,同一使用者的請求分散到 N 個 replica 時,實際可用速率上限從設計值變成「設計值 × N」(每個 replica 各自允許到上限才擋),且任一 replica 重啟即讓該 replica 的計數歸零。因為 orbQuota.ts 已有 RC1 逐行分析,本文件不重複展開;此處僅確認**同一根因在程式碼庫內至少還有 4 個獨立實例**,提醒修法時應該做「共用一套 Redis-backed 限流元件」的系統性修復,而非只修 orbQuota 一處。

**hasProtection**:否(皆為 process-local Map,無 Redis/DB 後援)。

---

## 2. 已正確保護 / 單實例安全,不構成缺陷(negative results)

以下項目經逐行核對,判定為「設計上已考慮多實例/快取失效風險並正確處理」或「本質上單實例安全,多實例僅為效能退化而非資料錯誤」,不列為缺陷:

1. **`server/routers/brainPipeline.ts:3292-3333` `responseCache`**——`Map<"admin"|"personal", CachedGraphEntry>` 用「版本鍵(`getProviderHealthVersion()`.`getHealthCacheVersion()`.`getAutoRepairVersion()` 組合)+ 5 秒 TTL」雙重失效機制,任一來源版本 bump 立刻讓快取失效,TTL 是極端情況的兜底上限。多實例下雖然各 instance 的版本計數器互不同步,但這正是**正確語意**——這是「每個 instance 自己的健康觀測快取」,本來就該反映各自的即時本地狀態,不需要跨 instance 一致。

2. **`server/services/orbTaskPlannerContextStore.ts:47-48`(`store` Map,30 分鐘 TTL)與 `server/services/orbTaskPageStateStore.ts:20-41`(`store` Map,30 分鐘 TTL,ring buffer cap 16)**——兩者程式碼註解(`orbTaskPlannerContextStore.ts:16-19`、`orbTaskPageStateStore.ts:12-14`)明確自陳「in-memory only,process 重啟或跨 instance 遺失時退化為『觀察者無額外上下文,直接把結果呈現給使用者,不自動重試』」,即缺失時是**優雅降級**而非資料錯亂或例外。已核對呼叫端(`orbTaskChainRunner.ts`)確實把「找不到 context」當成合法分支處理,不視為缺陷。

3. **`server/_core/llmRouter.ts:129` `circuitBreakers`(`Map<LLMEngine, CircuitBreakerEntry>`)**——per-instance 斷路器狀態。多實例下的影響僅是「每個 replica 需要各自累積 3 次失敗才會跳斷路」,即斷路收斂速度變慢(最壞情況下故障 provider 被多打 N 倍的重試流量),但不會導致資料損毀或狀態不一致——且斷路器本來就該是「保護單一 process 呼叫路徑」的機制,語意上不需要跨 instance 共享。**低嚴重度,設計取捨,非缺陷**。

4. **`server/services/brainStatePersistence.ts:104-105`**——`fsPromises.writeFile(tmpPath, json)` → `fsPromises.rename(tmpPath, filePath)`,正確的原子寫入 pattern,與發現 5 的 `orbTaskStore.ts` 形成直接對照,值得作為修復發現 5 時的參考實作。

5. **`server/services/priorityQueue.ts` 的 Redis Sorted Set 排隊順序**——`enqueuePriorityJob`/`getRedisClient()` 走 Redis,是本次掃描中少數「正確做到跨 instance 共享」的狀態,只是消費端（`dequeuePriorityJob`）目前零呼叫(見發現 4),尚未產生實際效益也未產生實際缺陷。

---

## 3. 總結:哪些會在 prod 多實例真的出事、哪些單實例安全

| 子系統 | 多實例會出事? | 已有緩解 | 嚴重度 |
|---|---|---|---|
| `orbIdempotency.ts`(chat + task 去重) | 會 — 重複觸發付費生成/LLM呼叫 | 無 | 高 |
| `orbCodeTask.ts` codeTaskStore | 會 — 任務狀態消失/跨 worker 不可見,且無 boot 警告 | 無 | 高 |
| `orbScheduler.ts` jobRegistry(L4) | 會 — cron N 倍觸發 | 部分(log 警告) | 中高 |
| `planExecutorTools.ts` PLAN_STORE(H6) | 會 — plan 跨 worker 404 | 部分(log 警告) | 中高 |
| `orbTaskStateMachine.ts` taskStore(R15) | 會(已知)+ 佇列/內容半遷移不一致 | 無(佇列層有 Redis,內容層無) | 中(佇列消費端未接線,現階段非活躍風險) |
| `orbTaskStore.ts`(legacy)disk 落地 | 若設定共享路徑會(非原子寫入);未設定時同 R15 | 否 | 中 |
| `learnHubOrbIndexCache`/`cachedLearnHub` | 會(單 process 內快取永不失效;多 instance 額外疊加「知識庫本身不同步」) | 否(W6/X6 已有建議未落地) | 中低 |
| `orbQuota.ts` + rateLimiter/trpcRateLimit/perplexityThrottle 系列 | 會 — 限流上限被乘以副本數 | 否 | 中低(orbQuota 已由 RC1 詳列) |
| `brainAutoRepair.ts` errorTraces 等 | 多實例下各自獨立(不共享是可接受的診斷資料,非交易一致性需求),落地機制安全 | 是(tmp+rename) | 低,單實例安全 |
| `brainPipeline.ts` responseCache | 單實例/多實例皆安全(語意上本就該各自反映本地狀態) | 是 | 無 |
| `orbTaskPlannerContextStore`/`orbTaskPageStateStore` | 多實例下優雅降級,非缺陷 | 是(設計如此) | 無 |
| `llmRouter.ts` circuitBreakers | 多實例僅收斂變慢,非資料錯誤 | 是(可接受取捨) | 低 |
