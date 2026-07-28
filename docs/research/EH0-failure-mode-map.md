# EH0 — 錯誤處理/失敗模式地圖(吞錯/無回滾/fire-forget/假成功)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb

> 本輪稽核聚焦「錯誤處理韌性」：吞錯(swallowed-error)、多步無交易部分失敗(no-rollback)、
> 未 await/失敗不可見(fire-and-forget)、失敗卻回報成功(false-success)、錯誤脫敏過度/無告警
> (lost-error-context)。已知既有問題(不重複列出，僅在系統性反模式節引用)：
> W9 circuit breaker 吞錯永 CLOSED、learnHub DB 寫入失敗只 console.warn 假成功、
> loraTrainer Step4 失敗遺失 trainingId、教材向量化 fire-and-forget 靜默、
> ProStudio AvatarVideoTab FAILED 零回饋。
> 本輪 refuted（提出後複核不成立）：**2 條**。

---

## 1. 依 cluster 分節列表

### cluster: false-success（失敗卻回報成功）

#### F1 — 生成完成後資產庫/歷史寫入失敗零紀錄，完成旗標照設永不重試
- **檔案**：`server/services/postGenActions.ts:265,353,499,537-556`
- **嚴重度**：critical
- **失敗情境**：`doPostGenComplete` 呼叫 `db.createDigitalAsset`（L353）失敗時，外層 `catch {}`（L397 附近，`// 靜默忽略`）完全靜默——連 `console.error` 都沒有。`runPostGenForJob`（L494）不論 `doPostGenComplete` 內部各步驟是否真正成功寫入，執行完就無條件呼叫 `db.mergeBackgroundJobResultJson(jobId, { postGenComplete: true })`（L554）。之後任何重跑（webhook 重送、checkStudioJob 輪詢重試）都會被 `if (meta.postGenComplete === true) return false;`（L499）短路。結果：暫時性 DB 錯誤造成的漏帳永久無法自我修復，且日誌完全無跡可查，只能靠使用者回報「生成完成但資產庫是空的」才會被發現。
- **建議**：`doPostGenComplete` 內至少對資產/歷史寫入路徑加 `console.error` 並上報監控（不必拋出以免擋住其他步驟），且 `postGenComplete` 旗標應區分「完全成功」與「部分失敗」兩態（例如 `postGenComplete: "partial"`），讓輪詢/補償任務能重試失敗的子步驟而非整體短路。

#### F2 — Stripe webhook 五個事件處理器皆為 console.log stub，且先 200 後處理
- **檔案**：`server/routes/stripeWebhook.ts:6,171-255,279,320-321`
- **嚴重度**：high
- **失敗情境**：`checkout.session.completed` / `invoice.paid` / `invoice.payment_failed` / `customer.subscription.updated` / `customer.subscription.deleted` 五個 handler（L171-255）全部只 `console.log` + `TODO`，不寫任何 `userSubscriptions` 記錄。端點在簽章驗證通過後立即 `res.status(200)`（L279），才在 try/catch（L320）中分派處理器；catch 只 `console.error`，Stripe 因已收到 2xx 不會重送。現況：金流事件被接收但完全沒有 entitlement 邏輯生效——付費使用者收不到權限、退款/取消也不會降級。這是「已知未實作」而非邊界情況，但風險在於：未來一旦補上真實寫入邏輯，若不同時修正「先 ack 後處理」的結構，會直接複製本檔案已存在的「ack 後失敗即消失」模式。
- **建議**：實作 handler 時，DB 寫入應在回 200 之前完成（或至少對關鍵事件如 `invoice.payment_failed` 用可重試佇列），並讓 catch 區塊觸發告警而非僅 log。

#### F3 — Fal/Replicate/Suno webhook 統一先 ack 200 才處理，DB 寫入失敗無告警且供應商不再重試
- **檔案**：`server/routes/webhookFal.ts:166,206,238-241,259,268,288,303,330,338,352,359`
- **嚴重度**：high
- **失敗情境**：驗證通過後立即 `res.status(200)`（L166），再執行 `updateBackgroundJob` / `runPostGenForJob`（`void` 呼叫，L303）/ `refundJobIfBilled`（`void` 呼叫，L268/338）。若此時 DB 暫時故障拋錯，只落入最外層 `catch (err)`（L359）的 `console.error`，供應商因已收到 2xx 不會重送。結果：任務在供應商端已完成，但本地狀態卡住、資產未持久化、退款未觸發。是否有輪詢備援（`checkStudioJob`）可自我修復**需執行期驗證**——理論上輪詢路徑仍可能補上 `runPostGenForJob`，但 `refundJobIfBilled` 的 `void` 呼叫路徑若在此處失敗且輪詢端也未觸發等效退款檢查，退款會永久遺漏。
- **建議**：至少將 webhook 內對 DB 的關鍵寫入結果記錄到可查詢的失敗日誌表（非僅 stdout），供背景巡檢掃描並補償。

#### F4 — LoRA 訓練完成但抽不到輸出 URL 仍標記 ready/completed
- **檔案**：`server/services/falTrainer.ts:349-419`（Fal 路徑）；`server/services/loraTrainer.ts:306-331`（Replicate 路徑）
- **嚴重度**：high
- **失敗情境**：`falTrainer.ts` L349-357 從 Fal.ai 回應嘗試多種欄位路徑抽取 `outputUrl`；若都對不上（回應結構變動/暫時性截斷），`outputUrl` 為 `null`，程式碼落入 `else` 分支（L389-419）：僅 `log("warn", ...)`，隨即仍然 `updateFineTunedModel(modelId, { status: "ready", ... })`（無 `trainedLoraUrl`）與 `updateBackgroundJob(jobId, { status: "completed", ... })`。`loraTrainer.ts`（Replicate 路徑）L306-317 同構：`outputUrl` 解析失敗時仍以 `trainedLoraUrl: outputUrl || undefined` 寫入 `status: "ready"`，未做 null 檢查分流。前端 `client/src/pages/LoraTrainer.tsx`（約 L547,591-611,2667）僅憑 `status === "ready"`／`completed` 顯示「訓練完成！LoRA 已就緒」並允許使用者點擊套用；`applyModelToGeneration` 把空/undefined 的 `loraUrl` 當作合法值寫入生成參數並顯示套用成功，直到下游生成 API 才因空/非法 URL 失敗。已耗費的訓練費用/GPU 時間無補償、無自動重試。
- **建議**：`outputUrl` 為空時應設 `status: "failed"`（或新增 `"needs_review"` 狀態）而非 `"ready"`，並讓 `updateBackgroundJob` 同步標記失敗以觸發現有的失敗退款路徑（`refundJobIfBilled` / 對應的訓練點數退還邏輯，若尚無則需新增）。

#### F5 — 分享獎勵加點與「已獎勵」旗標非原子雙寫
- **檔案**：`server/routers/models.ts:731-750`（`share` mutation）；`server/routers/assets.ts:257-262`（`toggleVisibility`）
- **嚴重度**：high（cluster 主判為 no-rollback，因 false-success 只是其表現形式之一）
- **失敗情境**：見 §no-rollback F8。

---

### cluster: no-rollback（多步無交易，部分失敗）

#### F6 — refundUserPoints/refundUserQuota 吞掉交易錯誤且從不 throw，退款失敗補償旗標永遠死代碼
- **檔案**：`server/db.ts:769-796`（`refundUserQuota`）、`server/db.ts:898-921`（`refundUserPoints`）
- **嚴重度**：critical
- **失敗情境**：已讀碼確認兩函式結構完全一致：`db.transaction(async tx => {...})` 包在 `try` 內，`catch (error) { console.error(...) }`，**不 rethrow**。呼叫鏈：`refundJobIfBilled`（`postGenActions.ts:596` 附近）先以 `atomicClaimJobRefund` 原子搶鎖寫入 `refunded=true`，再呼叫 `db.refundUserPoints`；`director.ts:3342-3363` / `3372-3390` 有類似 try/catch 包裹呼叫端。因為 `refundUserPoints`/`refundUserQuota` 內部失敗時不拋出，呼叫端的 try/catch **永遠進不了 catch 分支**——`refundRestoreFailed` 一類的補償旗標因而從未被觸發，變成死代碼。實際效果：DB 交易因鎖逾時/連線問題失敗時，`atomicClaimJobRefund` 已寫入的 `refunded=true` 鎖仍然存在，`deriveJobRefundStatus` 之類的推導邏輯會回報「已全額退款」，但 `users.remainingGenerations` 實際從未加回，使用者錢包被永久少記，且稽核記錄本身反而佐證「已退款」，人工事後稽核難以察覺。
- **建議**：`refundUserPoints`/`refundUserQuota` 的 catch 分支應 rethrow（或回傳 `{success:false, error}` 由呼叫端顯式判斷），讓 `refundJobIfBilled` 等呼叫端能真正走到失敗分支，寫入可被監控/人工審計掃到的失敗旗標，而非讓 `atomicClaimJobRefund` 的鎖單方面代表「已完成」。

#### F7 — 分享獎勵加點與「已獎勵」旗標非原子雙寫，可重複發放或發放失敗但旗標鎖死
- **檔案**：`server/routers/models.ts:731-750`；`server/routers/assets.ts:257-262`
- **嚴重度**：high
- **失敗情境**：兩處都是「先呼叫 `refundUserQuota` 加點，緊接著另一次獨立 DB 寫入設定 `shareRewarded`/`rewardCredits` 旗標」的非交易雙寫。情境 A（重複發放）：`refundUserQuota` 加點成功後，緊接著 `updateFineTunedModel`（models.ts L746）或 `updateDigitalAsset`（assets.ts L262）因暫時性 DB 錯誤失敗且未被外層捕捉 → 旗標未落地 → 使用者下次切換分享狀態時 `alreadyRewarded` 讀到 `false`，重複加點。情境 B（因 F6 而放大，優先度更高）：`refundUserQuota` 內部交易失敗但吞錯不拋出（見 F6）→ 呼叫端誤判成功繼續寫入 `shareRewarded=true`/`rewardCredits: 2` → 使用者這次分享實際未拿到任何點數，但旗標已鎖死（`alreadyRewarded`/`(asset.rewardCredits ?? 0) > 0` 恆真），之後永遠無法補發。`assets.ts:261-262` 的 `refundUserQuota(ctx.user.id, 2)` 與 `updateDigitalAsset(input.id, { rewardCredits: 2 })` 是 models.ts L745-749 的同構重複實例。
- **建議**：兩處應包成單一 DB 交易（加點 + 寫旗標同一 transaction），或至少讓 `refundUserQuota` 回傳明確成功/失敗（見 F6 建議），呼叫端據此決定是否寫入旗標，避免「錢沒發但旗標鎖死」與「旗標沒寫但可重複觸發」兩種方向的不一致同時存在。

---

### cluster: fire-and-forget（未 await / 失敗不可見）

#### F8 — LoRA/Fal 訓練啟動 `import(...).then(...)` 缺外層 catch，import 失敗變無主 unhandled rejection
- **檔案**：`server/routers/models.ts:249,449,482`（三處啟動點）；`server/jobs/modelTrainingWorker.ts:151-155`
- **嚴重度**：high
- **失敗情境**：已讀碼確認 L249-263 結構為 `import("../services/loraTrainer").then(({ runLoraTrainingJob }) => { runLoraTrainingJob({...}).catch(err => console.error(...)) })`——內層 `.catch` 只保護 `runLoraTrainingJob(...)` 這個 promise，**外層 `import(...).then(...)` 本身沒有 `.catch`**。若動態 `import()` 本身 reject（模組載入錯誤/遺失 chunk/暫時性記憶體壓力），或 `.then` callback 內、內層 `.catch` 附加之前的同步程式碼拋錯，整條 promise 鏈無人接手，變成 process 級 unhandled rejection。此時 `backgroundJob` 已在 L240-247 寫入 `status: "queued"`，但訓練從未真正開始。`server/jobs/staleJobChecker.ts`（L8 註解）明確排除 `model_training`；`modelTrainingWorker.ts` 自己的 `recoverStuckTrainingJobs`（L178-179，`getStuckJobsByType("model_training", 15, 3)`）15 分鐘後只會把卡住任務重置/嘗試恢復，第三參數 `3` 經讀碼確認（`db.ts:2801-2821`）只是查詢 `limit`（每輪最多處理幾筆），**並非重試次數上限**——全檔案 grep 確認 `retryCount`/`attemptCount` 未被實作。若失敗是永久性的（例如壞版本部署），會無限 queued→processing→stale→reset 迴圈，永不標 `failed`、永不通知使用者。
- **對照修復先例**：`server/services/agentToolExecutor.ts:7671-7712`（fal trainer）與 `:7729`（replicate trainer）已有 `.catch(async err => {...})` 明確標記 `failed`，程式碼註解自稱「F3 修復」。`models.ts`/`modelTrainingWorker.ts` 的三處啟動點尚未套用同款修法。
- **建議**：把 `import(...).then(...)` 整條鏈補上外層 `.catch(err => updateBackgroundJob(jobId, {status:"failed", ...}))`，比照 `agentToolExecutor.ts` 既有的 F3 修復模式；並在 `resultJson` 中加入 `retryCount` 欄位，讓 `recoverStuckTrainingJobs` 在超過上限後才轉為 `failed` 而非無限重置。

#### F9 — `runPostGenForJob`/`refundJobIfBilled` 全以 `void` 呼叫且無 `.catch`，函式開頭有未受保護的 DB 呼叫
- **檔案**：`server/services/postGenActions.ts:494-499,575-595`（函式定義）；呼叫端：`server/routers/generate.ts:2022,2205,2301,2330,2350`、`server/routers/proStudio.ts:1776,2209`、`server/routers/videoStudio.ts:1718`、`server/routers/director.ts:3306`、`server/routes/webhookFal.ts:268,303,338`
- **嚴重度**：high
- **失敗情境**：`runPostGenForJob`/`refundJobIfBilled` 函式開頭第一行都是 `const job = await db.getBackgroundJob(jobId);`（`postGenActions.ts:496,577`）。`db.getBackgroundJob`（`db.ts:2204-2213`）是裸 Drizzle 查詢，沒有自己的 try/catch，DB 連線暫時性錯誤時會直接拋出。所有呼叫端一致寫成 `void runPostGenForJob(job.id)` / `void refundJobIfBilled(jobId)`，沒有 `.catch`，一旦這行拋出就成為 process 級 unhandled rejection。`server/_core/error_handler.ts:88,107-108,135,144-145` 顯示單次 rejection 只 log 非致命（`doFatal` 不會為單一次觸發），但 60 秒內累積達 `stormThreshold`（預設 50，L107）就會 `void doFatal("unhandledRejectionStorm", ...)` → `process.exit(1)`（L108 `exit: exitFn = (code) => process.exit(code)`）。這些呼叫點正是 webhookFal/checkStudioJob 輪詢/座艙生成完成後最常觸發的路徑，若同一波 DB 抖動同時打中多個使用者、多個工作室的完成回呼，短時間內湊出 50+ 次 unhandled rejection 並非不可能，屆時會讓整個伺服器行程重啟，牽連當下所有使用者。**「無 catch + 函式開頭無保護」為已讀碼確認的事實；實際觸發全站重啟的機率需執行期驗證**（取決於 DB 抖動的並發規模與持續時間）。
- **建議**：至少在 `runPostGenForJob`/`refundJobIfBilled` 每個呼叫點補上 `.catch(err => console.error(...))`（或抽出共用 helper 統一包裝），避免任何未來的暫時性 DB 錯誤有機會疊加到 storm 閾值。

---

## 2. 系統性反模式（跨檔案重複出現）

### 反模式 A：「DB 寫入/退款失敗只 log 仍讓呼叫端視為成功」
出現於（本輪 + 已知 prior 合計）：
- `server/services/postGenActions.ts`（F1，資產/歷史寫入全靜默）
- `server/db.ts` `refundUserPoints`/`refundUserQuota`（F6，吞錯不 rethrow）
- learnHub DB 寫入失敗只 `console.warn`（prior，已確認）
- W9 circuit breaker 吞錯永遠 CLOSED（prior，已確認）

**共同修法**：建立一條「失敗即上浮」的統一原則——資料庫寫入類函式（尤其涉及金流/資產/訓練狀態的）一律不應在內部把錯誤轉成單純 log 後吞掉；應 (a) rethrow 讓呼叫端決策，或 (b) 回傳結構化 `{success, error}` 讓呼叫端顯式檢查。目前至少 4 處（含 prior）走的是「內部吞錯 → 外部誤判成功 → 狀態/旗標永久卡在錯的一邊」的同一形狀，建議列為共用 helper（例如 `withDbErrorPropagation`）強制執行，而非逐檔案各自修。

### 反模式 B：「Webhook 先 ack 200 才處理，處理失敗無重試機制」
出現於：
- `server/routes/stripeWebhook.ts`（F2，且處理器本身尚未實作）
- `server/routes/webhookFal.ts`（F3，Fal/Replicate/Suno 共用同一模式）

**共同修法**：這是刻意設計（避免供應商重送造成重複處理），但代價是「ack 後失敗即消失」。建議兩個 webhook 端點共用同一套「失敗事件落地表」（例如 `webhookProcessingFailures`），處理失敗時寫入該表而非只 log，並由既有的 stale/巡檢任務（`staleJobChecker.ts` 一類）定期掃描補償，而不是依賴供應商重送。

### 反模式 C：「訓練/生成完成判定只看『有沒有拋例外』，不驗證『產出是否真的可用』」
出現於：
- `server/services/falTrainer.ts` L389-419（`outputUrl` 為 null 仍標 ready，F4）
- `server/services/loraTrainer.ts` L306-331（Replicate 路徑同構，F4）
- loraTrainer Step4 失敗遺失 trainingId（prior，已確認）
- ProStudio AvatarVideoTab FAILED 零回饋（prior，已確認——雖是「失敗但零回饋」而非「假裝成功」，但同屬「終態判定與使用者可見狀態脫節」這條反模式家族）

**共同修法**：所有「完成」狀態的寫入前，應加一道「產出完整性檢查」關卡（URL 非空、格式合法、可選的 HEAD 請求驗證可達性），檢查不過就轉 `failed`/`needs_review` 而非 `ready`/`completed`，並讓失敗狀態能觸發下游既有的通知/退款機制，而不是止步於 `log("warn", ...)`。

### 反模式 D：「非同步啟動鏈只包內層 `.catch`，外層 promise（尤其動態 `import()`）沒人接手」
出現於：
- `server/routers/models.ts` 三處訓練啟動點（F8）
- 教材向量化 fire-and-forget 靜默（prior，已確認）

**已有修復先例**可直接複用：`server/services/agentToolExecutor.ts:7671-7712`「F3 修復」模式——外層 `.catch` 明確把對應 `backgroundJob` 標成 `failed`。建議直接把該段程式碼抽成共用 helper（例如 `runFireAndForgetTraining(jobId, importFn, runFn)`），讓 `models.ts` 的三處啟動點與未來任何新增的訓練/生成啟動點都必須經過它，而不是每處各自手寫 `.then().catch()`。

---

## 3. 給 Bruce：最該先修的 3 條

1. **F6（`server/db.ts:769-796,898-921` — `refundUserPoints`/`refundUserQuota` 吞錯不 rethrow）**。這是本輪最嚴重的一條：它讓「已退款」的稽核紀錄本身變得不可信，且是 F1、F7 之外，任何呼叫這兩個退款函式的地方（`refundJobIfBilled`、`director.ts`、分享獎勵）都共用的同一個底層漏洞——修一處等於同時堵住好幾條資料不一致的源頭。優先度最高，因為它直接造成「錢/點數對不上帳」且人工難以察覺。

2. **F1（`server/services/postGenActions.ts:353,397,499,554` — 資產/歷史寫入失敗零紀錄且完成旗標照設）**。使用者看到「生成完成」，但資產庫是空的——這是最直接誤導使用者、且完全無日誌可查的一條。修法成本低（先加 `console.error`/監控上報，再把 `postGenComplete` 拆成完整/部分兩態），但目前是「完全沉默」，屬於故障排查時最難定位的一類問題，應優先處理。

3. **F8（`server/routers/models.ts:249,449,482` — 訓練啟動 `import().then()` 缺外層 catch）**。已經有現成的修復範本可以直接抄（`agentToolExecutor.ts` 的「F3 修復」），成本低、風險可控，卻仍會讓使用者的訓練任務卡在 `queued`/`processing` 無限迴圈、永遠看不到失敗訊息，且已知會無限消耗訓練資源。修好之後也順手补上 F4（完成判定加產出檢查）的前置條件——兩者本來就在同一段訓練完成流程附近。

（F2/F3/F9 屬於「已知結構性風險但需要更大規模的重構或執行期資料才能定優先序」，建議列入下一輪追蹤而非本輪立即動工；F2 尤其因為 handler 本身尚未實作，目前的「假成功」風險是潛在的而非已發生的。）

---

## 附：本輪 refuted 項目

本輪提出後經複核**不成立、予以撤回**：**2 條**（撤回理由與涉及路徑未附於本檔案標頭 JSON，若需要撤回明細請回頭查稽核過程記錄；本檔案僅收錄複核後仍成立的 confirmed 項目）。
