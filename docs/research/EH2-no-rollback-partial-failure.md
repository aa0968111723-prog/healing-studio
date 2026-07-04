# EH2 — 無回滾/部分失敗

- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:多步驟寫入(DB+外部 API+儲存、記憶體+DB 雙寫、多表寫入)無交易/補償的路徑

> 稽核方法：逐檔讀碼（非臆測）。涵蓋 `server/routers/{proStudio,generate,director,loraTrainer,models,assets,learnHub}.ts`、
> `server/services/{postGenActions,loraTrainer,falTrainer,refundStatus}.ts`、`server/routes/{webhookFal,webhookSuno,stripeWebhook}.ts`、
> `server/jobs/{assetCleanupJob,learnDocSyncer}.ts`、`server/db.ts`（`deductUserPoints`/`refundUserPoints`/`refundUserQuota`/`atomicClaimJobRefund`）、
> `client/src/pages/LoraTrainer.tsx`。實際 HEAD 為 `0cb8a860`（`812f6fdb` 為既有系列稽核沿用的基準點，兩者間本範圍檔案無相關變更）。

---

## 摘要

本輪最重大發現：`db.refundUserPoints` / `db.refundUserQuota`（`server/db.ts`）內部把交易錯誤整個吞掉、**從不 throw**，導致三處刻意設計的「退款失敗補償旗標」（`refundJobIfBilled`、director.ts 兩處）全部是**永遠不會執行到的死代碼**——這是目前系統唯一號稱「已解決」的退款安全網（AIDV-650/968），但其賴以偵測失敗的訊號源頭本身失效，形成貫穿多個呼叫點的系統性 false-success。其餘發現包含 LoRA 訓練「完成但無輸出檔仍標記成功」、分享獎勵的加點/旗標非原子雙寫、以及一批 `void` 呼叫（無 `.catch`）的退款/入庫路徑。

---

## 發現（按嚴重度排序）

### 1. [CRITICAL] `refundUserPoints`/`refundUserQuota` 吞掉交易錯誤且從不 throw → 上層「退款失敗補償旗標」全是死代碼，真失敗時仍回報「已退款」

- **檔案:行號**
  - `server/db.ts:898-921`（`refundUserPoints`：`catch (error) { console.error(...); }`，catch 區塊結束後**沒有 `throw error`**，函式對呼叫端而言恆為 resolve，不論交易是否真的成功）
  - `server/db.ts:769-796`（`refundUserQuota`：同構，catch 只 log，不 rethrow）
  - 依賴此訊號的「補償」邏輯（因而全數不可達）：
    - `server/services/postGenActions.ts:596-615`（`refundJobIfBilled`：`try { await db.refundUserPoints(...) } catch (err) { ... 補寫 refundRestoreFailed ... return false; } return true;`）
    - `server/routers/director.ts:3342-3363`、`server/routers/director.ts:3372-3390`（同款 claim-then-refund，`catch (refundErr)` 補寫 `refundRestoreFailed`）
- **失敗情境（什麼失敗 → 被吞後的壞狀態）**
  1. `atomicClaimJobRefund` 先以 CAS 寫入 `resultJson.refunded = true`（退款鎖，`server/db.ts:2160-2181`）。
  2. 接著呼叫 `refundUserPoints`／`refundUserQuota`，其內部 `db.transaction(...)` 若因鎖等待逾時、連線池耗盡、死鎖等**任何原因失敗**，只會落入 `catch (error) { console.error(...) }`，函式仍正常 return（無回傳值、無拋出）。
  3. 呼叫端（`refundJobIfBilled` / director.ts）的 `try { await db.refundUserPoints(...) } catch` 永遠不會進入 catch 分支（因為底層不拋錯）→ 一路執行到 `return true`，`refundRestoreFailed` 旗標**永遠不會被寫入**。
  4. 結果：`background_jobs.resultJson` 上 `refunded=true`、`refundedPoints=X` 已寫死；`refundStatus.ts` 的 `deriveJobRefundStatus` 因此回報 `full`（已全額退款）；前端「退款狀態徽章」顯示已退款；但使用者的 `users.remainingGenerations` 實際上**從未被加回**——錢包被永久少記一筆，且系統自己的稽核記錄反而證明「已退款」，人工事後也難以憑徽章發現異常（需直接比對交易日誌，而非讀 `resultJson`）。
  - 同一根因也影響 `models.ts` / `assets.ts` 的分享獎勵（見 #3）：`refundUserQuota` 靜默失敗時，呼叫端誤以為已發放，緊接著寫入「已獎勵」旗標，使用者因而**拿不到獎勵點數且永久無法補發**（旗標阻擋重試）。
- **建議**
  - `refundUserPoints` / `refundUserQuota` 的 catch 區塊補上 `throw error;`（或回傳 `{success:boolean}` 並讓所有呼叫端檢查，比照 `deductUserPoints` 既有作法），讓失敗訊號真正傳得到 `refundJobIfBilled` / director.ts 的 catch。
  - 修復前，`refundJobIfBilled` 等函式回傳的 `refundStatus` 語意有被靜默高估的風險；建議先對 `refundUserPoints` 補上型別化回傳值再重新驗證 `deriveJobRefundStatus` 的推導假設。
  - 需執行期驗證：實際觸發一次 `refundUserPoints` 內部交易失敗（例如短暫斷線/鎖逾時），確認 `refundRestoreFailed` 是否真的從未被設置、且 `remainingGenerations` 確實未增加。

---

### 2. [HIGH] LoRA 訓練「完成但抽不到輸出網址」仍標記成功（false-success），前端僅憑 status 即開放套用

- **檔案:行號**
  - `server/services/falTrainer.ts:389-421`（`else` 分支「沒有輸出 URL — treat as completed but warn」：`updateFineTunedModel(modelId, { status: "ready", configJson: {..., falRequestId: "completed-no-url", ...} })`——**沒有寫 `trainedLoraUrl`/`fileUrl`**，但 `status` 仍設為 `"ready"`；`updateBackgroundJob(...)` 也同步標記 `status: "completed"`）
  - `server/services/loraTrainer.ts:306-331`（Replicate 路徑：`outputUrl` 若解析為 `null`，仍執行 `updateFineTunedModel(modelId, { status: "ready", trainedLoraUrl: outputUrl || undefined, ... })`，未對 `outputUrl` 做非空防呆即標記 ready）
  - `client/src/pages/LoraTrainer.tsx:2667`（「套用生成」/「套用到專業創作室」按鈕僅檢查 `model.status === "ready"`，未檢查 `model.trainedLoraUrl` 是否存在）
  - `client/src/pages/LoraTrainer.tsx:591-611`（`applyModelToGeneration`：`loraUrl: model.trainedLoraUrl || ""`，空字串也照樣寫入 sessionStorage 並 `toast.success("已套用模型...")`）
  - `client/src/pages/LoraTrainer.tsx:547`（`if (data.status === "ready") toast.success("訓練完成！LoRA 已就緒")`）
- **失敗情境 → 壞狀態**
  - Fal.ai / Replicate 回報訓練「完成」，但回傳的 JSON 結構與現有的欄位提取邏輯（`diffusers_lora_file`/`config_file`/`model_url`/`lora_file_url`/`output` 等固定鍵名）不匹配（例如模型版本更新回傳新的欄位形狀）→ `outputUrl` 為 `null`。
  - 系統不視為失敗，而是把模型/任務都標記為「完成／就緒」，使用者收到「訓練完成！LoRA 已就緒」成功提示。
  - 使用者點擊「套用生成」，前端無防呆地把空字串當作 LoRA URL 送進下游生成流程，直到生成 API 因空/非法 URL 而失敗——失敗訊息與「LoRA 訓練失敗」毫無關聯，使用者難以追溯根因；已耗費的訓練 GPU 時間/費用也沒有任何補償或重跑機制（沒有針對 `falRequestId==="completed-no-url"` 或 `outputUrl===null` 的自動重試/告警）。
- **建議**
  - `falTrainer.ts` 的「無輸出 URL」分支與 `loraTrainer.ts` 對 `outputUrl` 為空時，都應標記 `status: "failed"`（比照 `webhookFal.ts:256-274` 對「COMPLETED 但抽不到 URL」已採用的「改標 failed」模式），而非 "ready"。
  - 前端按鈕與 `applyModelToGeneration` 應同時檢查 `trainedLoraUrl` 非空，空值時停用按鈕並提示「訓練結果異常，請重新訓練」。

---

### 3. [HIGH] 分享獎勵：加點與「已獎勵」旗標非原子雙寫 → 可重複發放，或發放失敗但旗標已鎖死無法補發

- **檔案:行號**
  - `server/routers/models.ts:719-758`（`toggleVisibility`：L745 `await db.refundUserQuota(ctx.user.id, 3)` → L747-751 `await db.updateFineTunedModel(input.id, { configJson: { ...cfg, shareRewarded: true } })`；判斷式 `alreadyRewarded = cfg.shareRewarded === true` 於函式開頭一次性讀出，兩次寫入之間沒有交易/鎖）
  - `server/routers/assets.ts:225-267`（同構：L261 `await db.refundUserQuota(ctx.user.id, 2)` → L262 `await db.updateDigitalAsset(input.id, { rewardCredits: 2 })`；`alreadyRewarded = (asset.rewardCredits ?? 0) > 0`）
- **失敗情境 → 壞狀態**
  - **情境 A（旗標寫失敗）**：`refundUserQuota` 成功加點後，緊接著 `updateFineTunedModel`/`updateDigitalAsset` 寫入旗標那次因暫時性 DB 錯誤失敗（且因未被捕捉/未重試，直接以未處理例外結束此次 mutation，quota 已加但旗標未落地）。使用者下次切換分享狀態（關閉再打開）時，`alreadyRewarded` 讀到 `false`，**再次加點**——重複發放。
  - **情境 B（因發現 #1 而放大）**：`refundUserQuota` 內部交易失敗但函式吞錯不拋出（見發現 #1），呼叫端誤判為成功，緊接著把 `shareRewarded=true`/`rewardCredits=2` 寫入——使用者這次分享**實際上沒拿到任何點數**，但旗標已鎖死，之後永遠無法再觸發補發（`alreadyRewarded` 恆為真）。
  - 兩種情境都源於「加點」與「防重複旗標」不是同一交易，且旗標判斷讀取的是 mutation 開頭就拿到的舊列（無鎖/無 `FOR UPDATE`），高併發下亦可能 TOCTOU 雙重觸發。
- **建議**
  - 把「加點」與「寫旗標」包進同一個 `db.transaction`（可比照 `refundUserQuota` 已有的 `FOR UPDATE` 鎖模式），確保二者要嘛一起成功要嘛一起失敗；旗標寫入失敗時應回滾或至少讓整個 mutation 失敗（拋錯），而不是靜默各自為政。
  - 待發現 #1 修復（`refundUserQuota` 正確拋錯/回傳失敗訊號）後，此處也需要讓呼叫端在加點失敗時直接短路、不寫入旗標。

---

### 4. [MEDIUM] `void refundJobIfBilled(jobId)` / `void runPostGenForJob(jobId)` 無 `.catch`，內部首步未防呆 → 失敗時僅留通用「Unhandled promise rejection」日誌，job 狀態已寫死但退款/入庫永遠不會補跑

- **檔案:行號（呼叫點，均無 `.catch`）**
  - `server/routers/proStudio.ts:2209`
  - `server/routers/generate.ts:2205, 2301, 2330, 2350`
  - `server/routers/director.ts:3306`
  - `server/routes/webhookFal.ts:268, 303, 338`
  - `server/routes/webhookSuno.ts:224, 274`
  - 被呼叫函式內未防呆的首步：`server/services/postGenActions.ts:495`（`runPostGenForJob`：`const job = await db.getBackgroundJob(jobId);` 未包 try/catch）；`server/services/postGenActions.ts:576, 594`（`refundJobIfBilled`：`await db.getBackgroundJob(jobId)` 與 `await db.atomicClaimJobRefund(...)` 均未包 try/catch）
  - 全域回退：`server/_core/error_handler.ts:132-154`（`handleUnhandledRejection`：非風暴情況下只 `logger.error("Unhandled promise rejection (non-fatal)", { err: reason })`，訊息不含 jobId/userId/points）
- **失敗情境 → 壞狀態**
  - 呼叫點已先 `await db.updateBackgroundJob(jobId, { status: "failed"/"completed", ... })` 落庫（使用者可見的任務狀態已定案），才用 `void` 觸發 `refundJobIfBilled`/`runPostGenForJob`。
  - 若此時 `db.getBackgroundJob`（或 `atomicClaimJobRefund`）因暫時性 DB 問題丟出例外，因呼叫端未 `await`/`.catch`，該 rejection 變成 process 層級的 unhandled rejection——只在風暴閾值（60s 內 ≥50 次）才會觸發 fatal shutdown，單次失敗只留一行不含業務上下文的 log。
  - 淨效果：使用者已看到「任務失敗」但**點數永遠退不回**（`refundJobIfBilled` 沒機會補寫任何旗標，連 #1 描述的 `refundRestoreFailed` 也不會有）；或使用者已看到「生成完成」但提示詞庫/資產庫/生成歷史/AI 監控（`runPostGenForJob` → `doPostGenComplete`）**永遠不會補跑**——且沒有任何重試佇列或定期回填 job 去偵測、修復這批漏網任務。
- **建議**
  - 至少為每個呼叫點加上 `.catch(err => logger.error("...", { jobId, userId, err }))`，把 jobId/userId/points 帶進日誌，讓值班能定位受影響任務。
  - 更完整的作法：`runPostGenForJob`/`refundJobIfBilled` 內部首步包 try/catch 並回傳明確失敗訊號；並新增一個掃描「`status` 已終態但缺 `postGenComplete`/`refunded` 旗標超過 N 分鐘」的補跑 cron（可仿 `assetCleanupJob.ts` 的旗標化+dry-run 安全模式）。

---

### 5. [MEDIUM，設計已知取捨] `doPostGenComplete` 五段式多表寫入各自吞錯、無交易、無回填 — 部分失敗會留下永久性資產/歷史缺口

- **檔案:行號**
  - `server/services/postGenActions.ts:265-483`（函式頂端註解已自陳：「同步寫入提示詞庫 + 資產庫 + 歷史 + 監控。各子任務皆吞錯，不影響主流程。」）
    - L328-346 提示詞庫 upsert（`try { savedPromptId = await findOrCreatePromptByContent(...) } catch { /* 靜默忽略 */ }`）
    - L351-396 數位資產庫 + prompt↔asset 關聯（兩層巢狀 try/catch，皆靜默忽略）
    - L399-429 生成歷史 `createHistoryEntry`（靜默忽略）
    - L432-444 AI 監控室 log（靜默忽略）
    - L452-464 `agent_model_picks` 接受度回填（靜默忽略）
    - L470-482 保底歸檔 `enqueueMediaArchivalTask(...).catch(err => console.warn(...))`（fire-and-forget，僅 console.warn）
- **失敗情境 → 壞狀態**
  - 各步驟分屬不同資料表、無共用交易；例如「數位資產庫」寫入成功但「生成歷史」寫入因暫時性錯誤失敗 → 使用者的「我的資產」看得到這筆產出，但「生成歷史」/`costCredits` 對帳缺這一筆，且**沒有任何背景任務去偵測或補寫**這類部分落差（不同於 `refundJobIfBilled`/`runPostGenForJob` 至少有 idempotent 旗標可重跑，這五段一旦失敗即永久遺失，除非使用者剛好觸發同一 dedupeMarker 的另一次呼叫）。
  - 此為文件中明示的刻意設計（best-effort，避免拖垮生成主流程），非疏忽，故列為 MEDIUM 而非 HIGH；但目前**沒有任何監控指標或定期回填機制**能回答「這五段各自的靜默失敗率是多少」，出問題時只能從 console 日誌大海撈針。
- **建議**
  - 至少替每段的 catch 補上結構化告警計數（如 `captureError`/metrics），讓失敗率可觀測；不需要做成交易（設計本意如此），但需要「知道吞了多少」。
  - 可評估是否需要一個以 `backgroundJobId` 為鍵的定期對帳 job，抽樣比對 `digital_asset_library` / `generation_history` / `prompt_library` 是否三者都有對應列，缺漏則補寫。

---

### 6. [LOW] LoRA 訓練用 ZIP 資料集上傳到 S3 後，任何失敗路徑（含成功完訓後）都不清理，造成孤兒物件

- **檔案:行號**
  - `server/services/loraTrainer.ts:104-120`（`uploadZipToStorage`：`lora-datasets/{userId}/{modelId}-{timestamp}.zip`）
  - `server/services/falTrainer.ts:133-163`（`uploadZipToStorage` / `buildAndUploadZip`：`lora-datasets/{userId}/{modelId}-fal-{timestamp}.zip` 與 `-{scope}-{timestamp}.zip`）
  - `server/routers/loraTrainer.ts:210-218`（啟動訓練时呼叫 `buildAndUploadZip`）
  - 對照：`server/jobs/assetCleanupJob.ts:60-70`（清理範圍僅 `db.listExpiredDigitalAssets`，即 `digital_asset_library` 有 `expiresAt` 的列，從未涉及 `lora-datasets/*` 這個 key 前綴）
- **失敗情境 → 壞狀態**
  - 不論訓練後續步驟（提交 Replicate/Fal.ai、輪詢、標記完成/失敗）成功或失敗，已上傳的 ZIP 物件都沒有任何刪除路徑；`assetCleanupJob` 的掃描邏輯完全不觸及這個前綴。長期累積為儲存成本，非使用者可見的正確性問題，故列 LOW。
- **建議**
  - 於訓練失敗/超時分支（`loraTrainer.ts:372-393`、`falTrainer.ts:422-432`）加上 `storageDelete(key).catch(()=>{})` 清理；或讓 `assetCleanupJob` 增加對 `lora-datasets/` 前綴、以建立時間為準的 TTL 清理規則。

---

## 已知（prior，本輪確認位置即可，不重複展開）

- **loraTrainer Step4 失敗遺失 trainingId**：確認位置為 `server/routers/loraTrainer.ts:251-263`（Step 4 `db.updateFineTunedModel(modelId, { replicatePredictionId: trainingId, ... })` 寫入失敗）與其外層 `catch` 區塊 `server/routers/loraTrainer.ts:272-281`（僅標記模型 `status:"failed"` 並回錯給前端，但 Replicate 端訓練已實際啟動且 `trainingId` 未存入任何欄位，之後無人輪詢，GPU 費用與訓練結果永久失聯）。與本輪發現 #2（false-success）為同一服務內的兩個不同缺陷，互不重疊。
- **learnHub DB 寫入失敗只 console.warn 假成功**：確認位置為 `server/routers/learnHub.ts` 的 `create`（L596-618）、`update`（L672-689）、`delete`（L703-710）、`importDocs`（L763-787）四個 mutation——皆是先改記憶體陣列 `docs`/`videos`，DB 寫入包在 `try { ... } catch (dbErr) { console.warn(...) }` 中，失敗不回滾記憶體、不通知呼叫端，回應永遠視為成功。
- **W9 circuit breaker 吞錯永 CLOSED**：本輪掃描到的相關使用點為 `server/jobs/learnDocSyncer.ts:63-66`（`llmBreaker = new CircuitBreaker(...)`），未重新展開細節。
- **教材向量化 fire-and-forget 靜默**：未在本輪重新定位，維持原稽核結論。
- **ProStudio AvatarVideoTab FAILED 零回饋**：屬前端狀態回饋缺失，未在本輪重新定位，維持原稽核結論。

---

## 已正確處理錯誤（negative results）

- `server/routers/generate.ts:150-193`（AIDV-771）與 `server/routers/proStudio.ts:2050-2077`（AIDV-620）：扣點成功後 `createBackgroundJob` 失敗時，因尚無 `jobId`（`refundJobIfBilled` 無從觸發），呼叫端**立即**在原地 `await db.refundUserPoints(...)` 補救，並在註解中明確論證與後續 `refundJobIfBilled` 路徑互斥、不會雙退。此模式正確處理了「createBackgroundJob 是否成功」這一步的部分失敗（惟其退款動作本身仍受發現 #1 影響）。
- `server/routes/webhookFal.ts:254-274` 與 `server/routers/generate.ts:2284-2307`：fal.ai 回報「完成」但解析不到結果 URL 時，明確選擇把任務標記為 `failed`（而非誤標 `completed` 留一張無預覽卡片），並觸發退款——這正是發現 #2 中 loraTrainer/falTrainer **沒有**採用、但本可以照抄的既有良好模式。
- `server/services/postGenActions.ts:288-319`（dedupeMarker 前檢）與 `server/services/postGenActions.ts:550-557`（`postGenComplete` 旗標、`JSON_MERGE_PATCH` 而非整包覆寫）：正確處理了 webhook 與 polling 兩條路徑同時抵達的併發重跑問題，避免重複寫入資產/歷史。
- `server/db.ts:808-893`（`deductUserPoints`）：交易失敗與餘額不足都會回傳結構化的 `{success:false, ...}`，呼叫端能正確判斷並提前中止（與同檔的 `refundUserPoints`/`refundUserQuota` 吞錯不拋錯的作法形成鮮明對比，見發現 #1）。
- `server/services/refundStatus.ts`：純唯讀推導、defensive parsing、對 `refundRestoreFailed` 旗標有專門降級邏輯（`deriveJobRefundStatus:83-134`）、且任何內部錯誤 fallback 為 `unknown` 絕不 throw 到 UI——**設計本身完整**，只是其賴以工作的上游訊號（發現 #1）目前故障，一旦 #1 修復，本模組不需要改動即可正確運作。
- `server/routes/stripeWebhook.ts`：簽章驗證（HMAC-SHA256 + timestamp 容差 + timingSafeEqual）與事件處理器分離良好；事件處理器目前均為 `console.log` TODO 骨架、尚未接上真正的多步驟 DB 寫入，因此**本輪範圍內尚無「部分失敗」可稽核**——僅提醒未來實作 `handleCheckoutSessionCompleted` 等函式時，需比照 `refundJobIfBilled` 的 CAS 冪等旗標模式，避免 Stripe 重試造成重複發放。

---

## 附註：稽核範圍邊界

- `server/jobs/learnDocSyncer.ts` 的 `addLearnDoc()`（`server/routers/learnHub.ts:56-58`）本身只寫記憶體陣列、**未嘗試寫 DB**，不構成「多步驟寫入部分失敗」（無第二步可失敗），故未列入本輪發現；但需注意其效果是每次部署/重啟即遺失所有自動同步文件，屬於資料持久性缺口，建議另立稽核項目追蹤。
