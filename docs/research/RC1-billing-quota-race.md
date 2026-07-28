# RC1 — 計費/點數/配額 mutation 競態
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:server/db.ts(點數/配額/job 狀態相關)、server/services/orbQuota.ts、credits/postGenActions

---

## 0. 前置已知(prior,僅確認現況,不重複分析)

以下為呼叫端交付的既有結論,本輪逐行核對後**現況不變**:

- `db.ts:808-893` `deductUserPoints`/`refundUserPoints`:`db.transaction` 包住 `SELECT ... FOR UPDATE` → 檢查 → `UPDATE`,悲觀鎖原子操作,**健康**。
- `db.ts:2160-2181` `atomicClaimJobRefund`:`UPDATE background_jobs SET resultJson=JSON_SET(...) WHERE (refunded IS NULL OR refunded != 'true')`,CAS 搶鎖,`affectedRows` 判定成功,**健康**,`refundJobIfBilled`(`postGenActions.ts:575-618`)正確使用它防雙退款。
- `director.ts` world_storyboards.jobsJson 讀-改-寫全程無鎖(W1 已記錄)——**現況不變**,本文件範圍(`server/db.ts`)內另有 `updateWorldStoryboardJobAtomic`(`db.ts:3255-3267`,`JSON_SET` 單路徑局部寫入)屬於**已正確保護**的對照組,與 director.ts 整包覆寫的 world_storyboards 主更新路徑是两个不同函式,不构成矛盾。
- `assets.ts`/`models.ts` `toggleVisibility` 首次公開 +2 credits 的 TOCTOU 重複發獎(X12 已記錄)——grep 確認 `toggleVisibility` 於 `server/routers/models.ts:719`、`server/routers/assets.ts` 仍存在,**現況不變**,不在本文件範圍(routers,非 db.ts/orbQuota.ts/postGenActions)內重跑分析。
- `admin.ts:37` → `db.ts:591-598` `updateUserQuota(userId, amount)`:無交易、無鎖的絕對值 `SET remainingGenerations = amount`——grep 確認全 repo 唯一呼叫點仍是 `admin.updateQuota` mutation,**現況不變**。
- W9:4 個 worker(`modelTrainingWorker`/`teachingArchiveIngestionWorker`/`assetCleanupJob`/`mediaArchivalCron` 等)僅靠 process-local `isRunning`/`isRun` boolean 防重入,多實例部署下同一批 `queued` job 可被兩個 process 同時認領——**現況不變**(`db.ts:2779-2821` 的 `getQueuedJobsByType`/`getStuckJobsByType` 仍是純 `SELECT`,`updateBackgroundJob` 仍是無條件 `UPDATE`,未見補上 `WHERE status='queued'` 式 CAS)。

---

## 1. 發現總表(依嚴重度排序)

### 1.【嚴重・cluster: lost-update・無 CAS/交易保護】`profile.updateQuotaJson` 自助配額重分配與 `deductUserPoints`/`refundUserPoints`/`runDueAutoCreditGrant` 對同一 `remainingGenerations` 欄位競爭,可讓使用者的扣點被無聲復活或蓋掉並發到帳的自動給點

**競race窗口(行號)**:
- 讀:`server/routers/profile.ts:8-19` `updateQuotaJson` mutation —— 直接把使用者輸入的 `{image,video,audio,voice}`(僅 `z.number().min(0)`,**無上限、無「總量需等於目前配額」的校驗**)傳給 `db.updateUserQuotaJson`。
- 寫:`server/db.ts:932-944` `updateUserQuotaJson` —— `const total = image+video+audio+voice; UPDATE users SET quotaJson=?, remainingGenerations=total WHERE id=userId`。**沒有 `db.transaction`、沒有 `SELECT ... FOR UPDATE`、沒有讀回目前 `remainingGenerations` 再做差量調整** —— 是純粹依「使用者這次表單填了什麼」計算出的絕對值 SET。
- 對照:同一 `users.remainingGenerations` 欄位另有三條**有鎖**的寫入路徑——`deductUserPoints`(`db.ts:830-879`)、`refundUserPoints`(`db.ts:898-921`)、`runDueAutoCreditGrant`(`db.ts:649-697`)——三者皆用 `db.transaction` + `FOR UPDATE` 序列化,但 `updateUserQuotaJson` 完全不在這個保護傘內。

**交錯後果**:MySQL InnoDB 的行鎖會讓 `updateUserQuotaJson` 的 `UPDATE` 在 `deductUserPoints`/`refundUserPoints` 交易未提交前**排隊等待**(不是髒讀),但排隊之後誰先誰後決定最終值,而 `updateUserQuotaJson` 寫入的是「呼叫當下讀到/填入的絕對值」,不感知期間發生的扣款/退款/自動給點:
- 情境 A(復活已扣點數):使用者分頁 1 開著「配額設定」表單(頁面載入時 image=20/video=20/audio=5/voice=5,總 50),分頁 2 同時觸發一次生成扣點(`deductUserPoints` 扣 3 點,50→47)。若扣款交易先提交、之後使用者在分頁 1 按下「儲存」(送出的還是載入時的舊值,總 50),`updateUserQuotaJson` 會把 `remainingGenerations` 蓋回 **50**——扣掉的 3 點被無聲復活,等同免費多拿 3 次生成額度。
- 情境 B(蓋掉自動給點):`runDueAutoCreditGrant`(每輪 cron)剛好在使用者送出配額表單前一刻幫該使用者 +N 點,`updateQuotaJson` 送出的絕對值不含這 N 點,提交順序若後於自動給點,會把剛發的點數整批蓋掉。

**建議**:`updateUserQuotaJson` 改成與 `deductUserPoints` 同款 `db.transaction` + `SELECT ... FOR UPDATE`,寫入時用「目前 `remainingGenerations` + (新 total − 舊 total)」的差量更新,而非絕對值 SET;或改成純比例重分配(不觸碰 `remainingGenerations` 總量,只調整 `quotaJson` 四模態的相對配比)。此外 zod schema 應加上「四模態總和不得超過使用者當前 `remainingGenerations`」的伺服器端校驗(目前 `z.number().min(0)` 無上限,理論上使用者可對自己的帳號送出任意大的 image/video/audio/voice 值把 `remainingGenerations` 拉高,建議與後端額度上限對齊做二次防護,即使此點非本次併發稽核主軸)。

**hasProtection**:否(此欄位另 3 條寫入路徑皆有 `FOR UPDATE` 交易鎖,本路徑完全裸寫)。

---

### 2.【高・cluster: toctou / read-modify-write・部分保護】`background_jobs` 有 4+ 條並發「完成」路徑(webhook / polling / staleJobChecker)透過同一個無 CAS 的 `updateBackgroundJob` 互相覆蓋終態與 `resultJson`

**競race窗口(行號)**:
- 根因:`server/db.ts:2141-2148` `updateBackgroundJob(id, data)` 是無條件 `UPDATE background_jobs SET ... WHERE id=?`——**沒有 `WHERE status='processing'` 之類的狀態守衛,沒有版本欄位,沒有交易**。
- 路徑 A(webhook):`server/routes/webhookFal.ts:198` 先 `getBackgroundJob(jobId)` 讀一次 job、`:208-217` 檢查是否已是終態(`completed/failed/cancelled`)才決定要不要短路,但**這次讀取與後面 `:259/:288/:330/:352` 的 `updateBackgroundJob` 寫入之間沒有任何鎖或重新檢查** —— 中間還插了 `localizeResultUrls`(下載外部媒體、上傳 R2,可達數百 ms 到數秒)。
- 路徑 B(polling):`server/routers/generate.ts:2179-2184` `checkStudioJob` 同樣先讀 `job.status !== "processing"` 才短路(:2184),之後對 fal.ai 發外部 HTTP 查詢(`:2235` 起)才寫回 `updateBackgroundJob`(:2198/2291/2321/2345)——讀取與寫入間同樣有外部網路 I/O 的空窗期。
- 路徑 C(staleJobChecker):`server/jobs/staleJobChecker.ts:49` `getStuckJobsByType` 的 SELECT 條件是 `status='processing' AND updatedAt < cutoff`(`db.ts:2801-2821`),之後在迴圈裡逐筆 `await updateBackgroundJob(job.id, {status:"queued"|"failed", resultJson:{...舊 resultJson,...}})`(:61-71/:107-110)——**寫入時用的 `resultJson` 是迴圈開頭那次 SELECT 讀到的舊快照,不是寫入當下重新查的值**,且同樣無 `WHERE status='processing'` 條件式更新。

**交錯後果**:當 webhook(路徑 A)、polling(路徑 B)、或 staleJobChecker(路徑 C)在「讀取判斷終態」與「寫入新終態」之間的空窗期重疊時(webhook/fal 外部延遲 + staleJobChecker 每分鐘掃描,窗口可達秒級到分鐘級),後寫者整包覆蓋先寫者:
- webhook 剛把 job 標成 `completed` 並寫入含 `resultUrl` 的 `resultJson`(A 的 `:288-298`),但若此時 staleJobChecker 的這一輪掃描是在 A 寫入**之前**就已經 SELECT 到該 job(status 仍是 processing、且已超過 5 分鐘),其迴圈稍後才執行到的 `updateBackgroundJob(..., {status:"queued", resultJson:{...舊快照,retryCount}})` 會**用舊快照整包覆寫**,直接抹掉 webhook 剛寫入的 `resultUrl`/媒體連結,使用者已經生成完成的成品從資產庫「消失」,且任務被錯誤打回 `queued`(可能被 worker 重新提交,產生對 fal.ai/Suno 的重複計費)。
- webhook 重送(fal 對同一事件可能重試多次,程式碼註解自陳)與 staleJobChecker 或 polling 同時抵達時,兩條路徑各自的終態檢查(`:208-217`/`:2184`)都可能在對方寫入前通過,兩邊都執行完整的「寫 completed + `runPostGenForJob`」——`runPostGenForJob` 的重入保護見發現 #3,本身也有相同形狀的競態,並非完全兜底。

**建議**:把 `updateBackgroundJob` 用於「終態轉移」的呼叫點,改成條件式 `UPDATE background_jobs SET status=?,... WHERE id=? AND status IN ('queued','processing')`(參考已有的 `atomicClaimJobRefund` CAS 手法),依 `affectedRows` 判斷是否真的搶到寫入權,搶輸就跳過後續副作用(`runPostGenForJob`/`refundJobIfBilled`);`staleJobChecker` 對 `resultJson` 的合併也應改用 `mergeBackgroundJobResultJson`(`db.ts:2190-2202` 的 `JSON_MERGE_PATCH`,本檔案已有現成函式)而非帶入迴圈開頭讀到的舊快照整包覆寫。此建議與 W9 既有建議(`getQueuedJobsByType`/`updateBackgroundJob` 缺 CAS)同根因,本發現是把同一根因的影響面從「多 worker 認領同一 queued job」擴大到「webhook / polling / stale-timeout 三條完成路徑互相覆蓋終態與結果」。

**hasProtection**:否(`updateBackgroundJob` 本身零保護;下游的 `refundJobIfBilled` 因為走 `atomicClaimJobRefund` CAS 而不受影響——即使狀態覆蓋競態發生,不會導致雙重退款,只會導致資料/使用者體驗層面的錯誤,如上述)。

---

### 3.【中高・cluster: toctou・app 層檢查無 DB 唯一鍵支撐】`runPostGenForJob`/`doPostGenComplete` 的 `postGenComplete` 旗標檢查與內部 dedupe 檢查皆是「先讀後寫」,兩次幾乎同時的完成觸發可各自通過檢查、各自寫入重複的資產/歷史列

**競race窗口(行號)**:
- `server/services/postGenActions.ts:494-499` `runPostGenForJob`:`const job = await db.getBackgroundJob(jobId); ... if (meta.postGenComplete === true) return false;`——讀取「是否已跑過」的旗標與後面實際執行 `doPostGenComplete` + 寫回旗標(`:554` `mergeBackgroundJobResultJson(jobId, {postGenComplete:true})`)之間,**沒有鎖、沒有交易**;`doPostGenComplete` 內部走完整套 `findOrCreatePromptByContent`(可能一次 SELECT + 一次 INSERT)、`createDigitalAsset`(INSERT)、`createHistoryEntry`(INSERT)等多次 await,耗時可達數十至數百 ms。
- `doPostGenComplete` 內建的第一層 dedupe(`postGenActions.ts:294-319`,step 1-0)同樣是「先 SELECT `generation_history` 是否已有相同 `compiledPrompt` → 沒有才繼續」,但這個 SELECT 讀到的「已存在」判斷所依賴的 INSERT 要等到 `:407` step 1-3b 才真正執行——**檢查點與該檢查試圖防範的寫入點之間隔了 1-2(prompt)、1-3a(asset)兩個完整步驟**,且 `generation_history` 表(`drizzle/schema.ts:935-990`)與 `digital_asset_library` 表(`drizzle/schema.ts:331-405`)皆**沒有** `(userId, compiledPrompt)` 或 `(backgroundJobId)` 唯一鍵/唯一索引兜底。
- 觸發來源:發現 #2 已證實 webhook / polling / stale-checker 三條路徑都可能在「job 剛完成」的瞬間各自呼叫 `runPostGenForJob(jobId)`(`webhookFal.ts:303`、`generate.ts:2330`、以及 webhook 重送情境),這些呼叫都用 `void`(fire-and-forget)發出,彼此獨立、互不等待。

**交錯後果**:兩次(或以上)`runPostGenForJob(jobId)` 幾乎同時被觸發(典型情境:fal webhook 與 5 秒輪詢幾乎同時抵達;或 webhook 因 fal 重試機制對同一 `request_id` 送達兩次)時,兩次呼叫都可能在對方寫入 `postGenComplete=true` 之前完成 `job.resultJson` 的讀取與旗標判斷,於是都進入 `doPostGenComplete`——結果是 `digital_asset_library` 多出一列指向同一個 `backgroundJobId` 的重複資產、`generation_history` 多出一列同一次生成的重複紀錄,且 `costCredits` 欄位在兩列上都各自記一次(對「使用者實際被扣多少點」的稽核/對帳資料會產生重複計數的假象,即使 `remainingGenerations` 本身沒有被雙扣——那條路徑是 `refundJobIfBilled`/`atomicClaimJobRefund`,本身有 CAS 保護,不受此影響)。

**建議**:短期最小成本修法——把 `runPostGenForJob` 的「搶旗標」步驟提到最前面且改成 CAS(仿 `atomicClaimJobRefund`:`UPDATE background_jobs SET resultJson=JSON_SET(...,'$.postGenComplete',true) WHERE id=? AND (JSON_EXTRACT(resultJson,'$.postGenComplete') IS NULL OR ...!='true')`,依 `affectedRows` 決定要不要繼續執行 `doPostGenComplete`),而不是現在「先執行副作用、最後才補寫旗標」的順序;中期可在 `generation_history`/`digital_asset_library` 補上 `(userId, backgroundJobId)` 唯一索引作資料庫層兜底(`backgroundJobId` 目前雖有寫入但沒有唯一約束)。

**hasProtection**:部分——`postGenComplete` 旗標的**寫入**用 `JSON_MERGE_PATCH`(`mergeBackgroundJobResultJson`)不會互相蓋掉彼此欄位,但旗標的**檢查(讀)** 本身仍是無鎖 check-then-act,對「兩次呼叫都在旗標寫入前完成讀取」這種交錯沒有防護;下游 `prompt_assets` 關聯有 `(promptId, assetId, relation)` 唯一鍵保護、`refundJobIfBilled` 有 CAS 保護,但 `digital_asset_library`/`generation_history` 本體的重複列沒有任何 DB 端約束兜底。

---

### 4.【中・cluster: multi-instance・無保護】`orbQuota.ts` 的每日配額計數器是純記憶體 `Map`,水平擴展多實例部署下同一使用者的每日上限會被乘以實例數;process 重啟即全歸零

**競race窗口(行號)**:
- `server/services/orbQuota.ts:23-25` `userDailyCounters`/`sessionClicks`/`providerRateCounters` 三個 `Map` 是模組層級的 in-memory 狀態,**沒有寫回 Redis/DB,沒有跨 process 共享**。
- `checkAndConsumeQuota`(`:67-108`)本身是同步函式(全程無 `await`),單一 process 內因 JS run-to-completion 語意,函式內部的「讀 `next = (get??0)+1` → 檢查 → `set(counterKey,next)`」(`:102-106`)不會被同 process 的其他呼叫交錯打斷,**單 process 內部安全**。
- 但 `docs/research/S2-credits-team-pool.md` 與 W9 系列文件已確認本站以多 worker/多 process 型態運行(Railway 部署、W9 記錄之 4 個 worker 各自僅有 process-local 鎖即為佐證)。`generate` 類別(每日 40 次)是 GC2 文件已確認的「唯一真的擋、不受任何旗標控制」的配額類別(`agentToolExecutor.ts:1016` 呼叫點)。

**交錯後果**:若站方以 N 個 process/replica 對外提供服務(常見於容器化水平擴展或 Railway 多副本),同一使用者的請求依負載平衡落在不同 replica 上時,`userDailyCounters` 這個 Map 在每個 replica 各自獨立計數——實際可用的每日 `generation` 配額從設計上的 40 次變成最多 `40 × N` 次(每個 replica 各自允許到 40 才擋)。此外任何一次 process 重啟/滾動部署都會讓 `userDailyCounters` 整個歸零,等於變相「重置」當日已用配額,使用者可透過等待或利用部署時間窗口重新取得額度。

**建議**:若 `generation`(唯一实际生效且是「金額制」以外少數硬上限之一)的每日配額有實際防護意圖,應把計數器搬到 Redis(`INCR` + `EXPIRE`,或已有的 `getRedisClient()` 基礎設施,`staleJobChecker.ts` 已在用)這類跨 process 共享、可持久化的儲存,而非模組層級 `Map`;`rapid_click`/`provider_rate` 兩個短窗口限流則需視「是否要求全域限流」決定是否值得付出跨 process 的成本(單機/低副本數場景可接受現況)。

**hasProtection**:否(單 process 內因同步執行語意而「意外安全」,但完全沒有跨 process/重啟的保護;GC2 文件已從「contract-mismatch/deadcode」角度記錄本檔案其他問題,但未涵蓋此處的多實例計數失真,故本發現在此併發稽核角度是新增)。

---

## 2. 已正確保護(negative results,逐項列出以避免誤讀為稽核遺漏)

| 位置 | 保護機制 | 判定 |
|---|---|---|
| `db.ts:707-763` `deductUserQuota` | `db.transaction` + `SELECT...FOR UPDATE` + 額度檢查 + `UPDATE`,一次交易內完成 | 健康 |
| `db.ts:769-796` `refundUserQuota` | 同上模式(鎖行後才 `+amount`) | 健康 |
| `db.ts:808-893` `deductUserPoints` | 同上模式,回傳 `remainingBefore/After` 供呼叫端稽核 | 健康 |
| `db.ts:898-921` `refundUserPoints` | 同上模式 | 健康 |
| `db.ts:649-697` `runDueAutoCreditGrant` | `db.transaction` 內 `SELECT ... FOR UPDATE` 鎖住到期使用者列,逐筆用 `sql\`... + amount\`` 相對增量(非絕對值 SET) | 健康,但與發現 #1 的 `updateUserQuotaJson` 交互時仍可能被蓋掉(見 #1) |
| `db.ts:2160-2181` `atomicClaimJobRefund` | `UPDATE ... WHERE NOT refunded` CAS,`affectedRows` 判定 | 健康(AIDV-577) |
| `db.ts:2190-2202` `mergeBackgroundJobResultJson` | `JSON_MERGE_PATCH` 局部合併,不整包覆寫 `resultJson` | 健康,惟仅覆盖“旗標寫入”本身,不覆盖发现 #3 所述的“旗標檢查”競態 |
| `db.ts:3255-3267` `updateWorldStoryboardJobAtomic` | `JSON_SET` 對單一 `$.<stepId>` 路徑做 DB 端原子局部寫入,不需先讀整包 `jobsJson` 到記憶體 | 健康(與 W1 已知的 director.ts 主更新路徑整包覆寫問題屬不同函式,不矛盾) |
| `server/routers/credits.ts` 全檔 | 純 `query`(`pricingCatalog`/`myBalance`/`jobRefundStatus`),沒有任何 mutation,不改動點數/配額/job 狀態 | 不適用(無寫入路徑,非保護缺口) |
| `postGenActions.ts:384-388` `createPromptAssetLink` | `(promptId, assetId, relation)` 唯一鍵,webhook+polling 雙路徑重跑時 INSERT 衝突可視為冪等失敗吞掉 | 健康 |

---

## 3. 需執行期驗證(無法僅靠讀碼確認之處)

- 發現 #2/#3 的實際觸發機率取決於 fal.ai/Suno webhook 延遲分布、`localizeResultUrls` 下載外部媒體的耗時、以及 staleJobChecker 5 分鐘/10 分鐘視窗與真實生成耗時的重疊機率——本文件僅能由程式碼結構證明「窗口存在且無鎖」,實際重複率需執行期日誌/監控驗證(可觀察 `digital_asset_library` 中同一 `backgroundJobId` 是否出現多列作為直接指標)。
- 發現 #4 的「N 個 replica → N×40 次配額」需確認正式環境實際的 replica/worker 數量與負載平衡策略(是否 sticky session)——若目前僅單一 process 運行,此問題暫不會發生,但屬於水平擴展時會立即浮現的架構缺口,建議執行期以「同一使用者短時間內在 `generation` 類別的實際可用次數是否 > 40」做驗證。
- 發現 #1 的「使用者可自行送出任意大 `image/video/audio/voice` 值」是否真能突破前端限制,需以繞過前端(直接呼叫 tRPC endpoint)方式在測試環境驗證伺服器端是否真的無任何隱藏上限校驗(本文件僅讀到 `z.number().min(0)`,未見 `.max()` 或 `superRefine`)。
