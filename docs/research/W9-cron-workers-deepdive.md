# W9 — 背景排程/worker 子系統逐行深挖(逐檔深挖 wave W)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:mediaArchivalCron/modelTrainingWorker/teachingArchiveIngestionWorker/assetCleanupJob/orbScheduler/cronPreview

## 0. 範圍與方法

本輪 6 個目標檔案已全檔逐行讀完(行數:mediaArchivalCron.ts 76 行、modelTrainingWorker.ts 367 行、teachingArchiveIngestionWorker.ts 160 行、assetCleanupJob.ts 117 行、orbScheduler.ts 595 行、cronPreview.ts 298 行,共 1613 行)。為了回答「worker 觸發生成/LLM 有沒有扣點/退款」「刪除邏輯有沒有誤刪」這類問題,額外逐行讀了以下直接呼叫鏈上的檔案(非本輪主稽核對象,但為驗證上述 6 檔行為必要):

- `server/services/mediaArchivalService.ts`(mediaArchivalCron 的實際邏輯)
- `server/services/loraTrainer.ts`(modelTrainingWorker 呼叫的訓練實作)
- `server/services/teachingArchiveIngest.ts`(teachingArchiveIngestionWorker 呼叫的抽文實作)
- `server/services/assetCleanupService.ts`(assetCleanupJob 呼叫的純函式核心邏輯)
- `server/jobs/circuitBreaker.ts`、`server/services/serverDeploymentMode.ts`
- `server/db.ts` 內 `getQueuedJobsByType`/`getStuckJobsByType`/`updateBackgroundJob`/`listExpiredDigitalAssets`/`countOtherDigitalAssetsByFileKey`/`deleteDigitalAsset`/`atomicClaimJobRefund`
- `server/services/mediaTranscriber.ts`、`server/services/teachingArchiveRag.ts`、`server/services/ragMemory.ts`(embedding 呼叫鏈)
- `server/routers/models.ts`、`server/routers/loraTrainer.ts`(model_training job 的建立入口)
- `server/routes/webhookReplicate.ts`(驗證孤兒訓練競態用)
- `server/_core/index.ts`(確認 6 個排程都有被 `startScheduledMaintenanceJobs`/`startOrbScheduler` 實際掛載,非死碼)

一切結論以實際讀到的程式碼為準;凡涉及本輪未逐行讀完的下游檔案(例如 `pdfTextExtractor.ts`、`replicateClient.ts` 內部實作細節),一律標注「未在本檔驗證」。

**先講結論**:6 個排程/worker 全部確認有掛載執行(`server/_core/index.ts:180-253` 的 `SCHEDULED_MAINTENANCE_JOBS` 陣列 + `startOrbScheduler()` 呼叫),沒有「寫了但沒接線」的死碼。真正的問題集中在:(1) 多實例部署下 4/5 個 worker 完全沒有跨 process 的重複執行防護,且對應的架構缺陷警告函式 `warnIfMultiInstanceSingleton` 只有 orbScheduler 一個訂閱者;(2) `modelTrainingWorker` 的「無 predictionId 卡住任務 → 重置為 queued」復原邏輯,搭配 Replicate webhook 以 `modelId` 而非 `predictionId` 做終態判斷,存在即使單一 instance 也會因 process crash 觸發的「孤兒訓練 + 重複訓練」競態,對應真實的 Replicate GPU 計費;(3) `modelTrainingWorker`/`teachingArchiveIngest` 觸發的三個真實付費第三方 API(Replicate 訓練、ElevenLabs 轉錄、Gemini embedding)全鏈路查無任何點數/credit 扣款或退款呼叫。

---

## 1.〔嚴重〕孤兒 Replicate 訓練競態 — process crash 可在單一 instance 下觸發重複計費訓練

**發現**

`modelTrainingWorker.ts:274-286` 的 `recoverStuckTrainingJobs` 對「`processing` 超過 15 分鐘、`resultJson` 內沒有 `predictionId`」的任務,直接重置為 `queued` 讓下一輪重跑:

```ts
// modelTrainingWorker.ts:274-286
} else {
  // No predictionId — job got stuck before submitting to Replicate
  // Reset to queued so processQueuedTrainingJobs picks it up next tick
  logWorker(
    "warn",
    `任務 #${job.id} — 無 predictionId，重置為 queued 等待重試`
  );
  await updateBackgroundJob(job.id, {
    status: "queued" as any,
    progress: 0,
    progressMessage: "Worker 已重置，等待重新處理",
  });
}
```

沒有重試次數上限欄位或計數器(`backgroundJobs` schema 於本次審查範圍內未見任何 `retryCount` 被此 worker 讀寫)。

問題在於 `loraTrainer.ts:249-266` 的寫入順序:`submitReplicateTraining()`(:251,Replicate 訓練已真的送出、GPU 開始計費)**先**回傳 `predictionId`,**之後**才呼叫 `updateBackgroundJob(jobId, { ..., resultJson: { modelId, modelName, predictionId } })`(:262-266)把 `predictionId` 寫回 DB:

```ts
// loraTrainer.ts:250-266
const predictionId = await submitReplicateTraining({...});   // ← Replicate 已開始計費
await updateBackgroundJob(jobId, {
  progress: 30,
  progressMessage: "訓練任務已提交，等待 GPU 分配...",
  resultJson: { modelId, modelName, predictionId },          // ← 此行之前 process 若 crash，predictionId 永遠留在記憶體
});
```

若 process 在這兩行之間 crash(部署重啟、OOM、未捕例外崩潰),該 backgroundJob 會卡在 `processing` 且 `resultJson` 沒有 `predictionId`。15 分鐘後 `recoverStuckTrainingJobs` 會誤判「還沒送出去」,重置為 `queued`,下一輪 `processQueuedTrainingJobs` 重新跑一次完整流程(重新下載訓練圖、重新打包、**重新呼叫 Replicate 送出第二個訓練**)。此時 Replicate 端實際上同時有兩個真正在跑、真正計費的訓練任務指向同一個 `modelId`。

`server/routes/webhookReplicate.ts:111-120` 的終態守門只檢查 `model.status`(`ready`/`failed`)是否已是終態,**不比對 webhook payload 的 `id`(訓練 A 或訓練 B 的 predictionId)是否等於目前追蹤的那一個**:

```ts
// webhookReplicate.ts:111-120
if (model.status === "ready" || model.status === "failed") {
  console.log(`[WebhookReplicate] Model ${modelId} already ${model.status}, ignoring duplicate/late webhook`);
  return;
}
```

孤兒訓練 A 若先完成,其 webhook 會先把 model 標成 `ready`(用 A 的權重);之後 `loraTrainer.ts` 內建輪詢迴圈(:306-339,針對 predictionId=B 做輪詢)偵測到 B 成功時,同樣**沒有先檢查 `model.status` 是否已是終態**就直接覆寫:

```ts
// loraTrainer.ts:318-331(succeeded 分支,無終態檢查)
await updateFineTunedModel(modelId, {
  status: "ready",
  trainedLoraUrl: outputUrl || undefined,
  ...
});
```

**影響**

- 對平台方而言:同一個訓練請求可能觸發兩次真實的 Replicate GPU 訓練計費(非使用者點數,是站方對 Replicate 的帳單成本),且沒有任何機制偵測或警告這個重複。
- 對使用者而言:最終看到的模型權重由「哪個訓練的更新語句後執行」決定,而非「使用者真正等待的那一次」,結果不可預期且無法重現。
- 觸發條件只需要一次 process 重啟/crash 恰好落在 30 秒級的窗口內(`submitReplicateTraining` 回傳到 `updateBackgroundJob` 寫回之間),在有滾動部署(Railway 等)的正式環境並非罕見場景。

**建議**

- 在 `submitReplicateTraining` 呼叫前先寫入一個「已送出但等待確認」的過渡狀態(或用 `mergeBackgroundJobResultJson` 之類的部分寫入),並把「送出 Replicate」與「寫回 predictionId」盡量收斂成一個不可分割的步驟,或至少讓 `recoverStuckTrainingJobs` 在重置為 `queued` 前,先呼叫 Replicate 的「依 destination model 查詢近期訓練」API(如果有的話)確認真的沒有孤兒訓練在跑,再決定要不要重新送出。
- `webhookReplicate.ts` 的終態守門與 `loraTrainer.ts` 輪詢迴圈的完成分支都應該比對 `trainingId === model.replicatePredictionId`(或目前 backgroundJob 追蹤的 predictionId),而不是只看 `model.status`,避免舊訓練的遲到回呼覆寫新訓練的結果。

---

## 2.〔嚴重〕多實例部署下,5 個排程中有 4 個完全沒有跨 process 防重複執行機制,且連警告都沒有

**發現**

`server/services/serverDeploymentMode.ts` 提供 `warnIfMultiInstanceSingleton(subsystemName, affectedBehavior)`,偵測到多實例訊號(`NODE_APP_INSTANCE`/`PM2_INSTANCE_ID`/`K8S_POD_NAME`/`KUBERNETES_PORT`/`NODE_CLUSTER_WORKERS`/`WORKER_ID`/`INSTANCE_ID` 任一非空)時才印一次警告(:44-64、74-112)。全 repo 搜尋顯示,**只有 `orbScheduler.ts:540-543` 與 `planExecutorTools.ts` 呼叫這個函式**:

```ts
// orbScheduler.ts:536-543
export async function startOrbScheduler(): Promise<void> {
  warnIfMultiInstanceSingleton(
    "orbScheduler",
    "in-memory jobRegistry → every worker fires cron jobs independently (double-trigger / N-trigger risk)"
  );
  ...
```

`mediaArchivalCron.ts`、`modelTrainingWorker.ts`、`teachingArchiveIngestionWorker.ts`、`assetCleanupJob.ts` 四個檔案**完全沒有呼叫** `warnIfMultiInstanceSingleton`,即使 operator 真的 scale-out,這四個 worker 連 stdout 警告都不會出現。

而且即使呼叫了,`warnIfMultiInstanceSingleton` 本身也只是 `console.warn`,沒有 `throw`、沒有 `process.exit`、沒有任何回傳值可讓呼叫端據以擋下後續行為(`serverDeploymentMode.ts:74-112` 全文只有字串組裝與 `console.warn`);`orbScheduler.ts:540-570` 呼叫完之後**沒有依回傳值做任何分支**,直接繼續 `loadPersistedJobs()` 並照常 `cron.schedule(...)`。

四個 worker 本身的「防重疊」機制都是 module-level boolean,只能防「同一個 process 內」cron tick 與前一輪重疊,無法跨 process:

```ts
// mediaArchivalCron.ts:24         let isWorkerRunning = false;
// modelTrainingWorker.ts:55       let isWorkerRunning = false;
// teachingArchiveIngestionWorker.ts:38  let isWorkerRunning = false;
// assetCleanupJob.ts:31           let isRunning = false;
```

資料庫層面也沒有補上這道防線:`getQueuedJobsByType`(`db.ts:2779-2796`)是純 `SELECT ... WHERE status='queued'`,沒有 `SELECT ... FOR UPDATE SKIP LOCKED`;`updateBackgroundJob`(`db.ts:2141-2148`)是無條件 `UPDATE ... SET ... WHERE id=?`,不是「`WHERE status='queued'` 才允許更新」的 CAS 操作。換言之,兩個 process 同時 `getQueuedJobsByType` 都會看到同一批 `queued` 任務,兩者都能無條件把它標成 `processing` 並各自啟動一次真正的處理(model_training → 重複 Replicate 訓練;teaching_archive_ingestion → 重複 ElevenLabs 轉錄/Gemini embedding 呼叫;mediaArchival → 重複下載上傳同一個外部 URL)。

**影響**

- 若正式環境目前是單一 instance(本次未驗證 Railway 部署設定,僅讀程式碼),此風險目前潛伏但未觸發;一旦 scale-out,`modelTrainingWorker`/`teachingArchiveIngestionWorker`/`mediaArchivalCron`/`assetCleanupJob` 四者會立即出現「同一任務被 N 個 worker 同時處理」,其中 model_training 與 teaching_archive_ingestion 兩者的重複執行會直接反映成重複的第三方付費 API 呼叫(對照發現 1 的孤兒訓練場景,多實例會讓這類競態的發生機率大幅提高,不再需要恰好卡在 30 秒窗口)。
- `assetCleanupJob` 的重複執行本身較不危險(delete-if-exists 語意本身冪等,參見發現 5),但仍會放大發現 5 的 race window。

**建議**

- 至少讓這四個 worker 也呼叫 `warnIfMultiInstanceSingleton`,讓 operator 在 log 看得到警告(這是最低成本的部分修補,不需要架構改動)。
- 中長期應把「認領一筆 queued job」改成條件式 UPDATE(例如 `UPDATE background_jobs SET status='processing' WHERE id=? AND status='queued'`,檢查 `affectedRows`,參考本檔案已有的 `atomicClaimJobRefund` CAS 手法),讓多實例下同一筆任務只會被一個 process 真正「認領」成功。

---

## 3.〔高〕model_training / teaching_archive_ingestion 全鏈路查無任何點數扣款或退款

**發現**

對 `deductCredits|refundCredits|chargeCredits|creditBalance|deductPoints|refundPoints` 在下列檔案做 Grep,全部零匹配:`loraTrainer.ts`、`modelTrainingWorker.ts`、`teachingArchiveIngest.ts`、`teachingArchiveIngestionWorker.ts`、`mediaTranscriber.ts`(ElevenLabs 轉錄下游)、`teachingArchiveRag.ts`(embedding 下游)、`routers/models.ts`(`create`/`retrain` 入口)、`routers/loraTrainer.ts`(`trainWithReplicate` 入口)。

三個真實付費第三方呼叫確認為:
- `loraTrainer.ts:130-197`(`submitReplicateTraining`)→ Replicate `ostris/flux-dev-lora-trainer` GPU 訓練。
- `teachingArchiveIngest.ts:106-112` → `mediaTranscriber.ts` → ElevenLabs Scribe 語音轉文字。
- `teachingArchiveIngest.ts:126-137`(`upsertTeachingMaterialVectors`)→ `teachingArchiveRag.ts` → `ragMemory.ts` `getEmbedding` → Google Gemini `gemini-embedding-001` embedding API。

本 repo 確實存在一套成熟的冪等退款機制 `atomicClaimJobRefund`(`db.ts:2160-2181`,CAS 寫 `resultJson.refunded` 旗標,AIDV-577),但 Grep 全 repo 顯示只有 `postGenActions.ts`、`refundStatus.ts`、`routers/proStudio.ts`、`routers/director.ts`、`routers/generate.ts` 五處呼叫它 —— **本輪稽核的兩條鏈路(`loraTrainer.ts`/`teachingArchiveIngest.ts`)完全沒有接上**。

另外,同樣是「建立 LoRA 訓練」的兩個入口,防護程度不一致:`routers/models.ts` 的 `create`(:270-435)與 `retrain`(:202-268)兩個 mutation,全文 Grep `quota|remainingGenerations|checkQuota|rateLimiter|limit` 除了一處與訓練無關的「分享模型獎勵 3 quota」註解外**沒有任何配額/限流檢查**;而另一個平行入口 `routers/loraTrainer.ts` 的 `trainWithReplicate`(:152-282)則有 `checkTrpcRateLimit(ctx.user.id, { limit: 3, windowMs: 60*60_000 })`(:179,每小時 3 次)與併發上限檢查(:182-191,≤2 個 pending/training)。`modelTrainingWorker` 消費 `model_training` 這個 jobType 時,並不區分任務是從哪個入口建立的,兩條入口共用同一個 worker 但限流程度不同。

**影響**

- 好消息:因為完全沒有扣款,「失敗要不要退款」這個問題在這兩條鏈路上不成立(沒有虧欠使用者的餘額),使用者側沒有金錢損失風險。
- 壞消息:這三個第三方 API 都是站方直接付費(Replicate 依訓練時長/GPU 計費、ElevenLabs 依轉錄時長計費、Gemini embedding 依 token 計費),`routers/models.ts` 的 `create`/`retrain` 入口在本次檢視範圍內找不到任何用量閘門,任何登入使用者理論上可以無限次建立訓練任務(每次都是真實 GPU 成本);`retrain`(:202-268)甚至沒有像 `trainWithReplicate` 那樣的每小時次數限制。
- 沒有計費機制,也代表沒有「用量歸因」——無法從 `background_jobs`/`fineTunedModels` 反查「這次 Replicate 帳單是哪個使用者造成的」,不利於異常用量的事後稽核與濫用使用者的限制。

**建議**

- 若產品決策是「LoRA 訓練/教學檔案 RAG 抽文對使用者完全免費」,至少應該讓 `routers/models.ts` 的 `create`/`retrain` 比照 `routers/loraTrainer.ts` 接上同等的 rate limit + 併發上限,避免兩個入口防護不對稱。
- 若之後要收費,`loraTrainer.ts`/`teachingArchiveIngest.ts` 需要新增扣點/`atomicClaimJobRefund` 式退款掛鉤;鑑於 worker 本身已經是「失敗只標記 failed、從不 throw 到外層」的設計(參見發現 4),屆時扣點退款邏輯建議直接內嵌在這兩個 service 的失敗分支裡,而不是依賴呼叫端。

---

## 4.〔高〕modelTrainingWorker 的 Circuit Breaker 邏輯在目前程式路徑下形同虛設

**發現**

`modelTrainingWorker.ts:49-52` 建構了一個 `CircuitBreaker("ReplicateTraining", { failureThreshold: 3, cooldownMs: 10*60_000 })`,意圖是「Replicate API 連續失敗時停止繼續打」。但 `processQueuedTrainingJobs`(:66-174)與 `recoverStuckTrainingJobs`(:178-292)內部所有錯誤都在各自的 `for` 迴圈內用 `try/catch` 吞掉、continue 到下一筆,**從不 rethrow**:

```ts
// modelTrainingWorker.ts:161-172(processQueuedTrainingJobs 內,每個 job 的 catch)
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  logWorker("error", `處理任務 #${job.id} 時發生錯誤: ${message}`);
  try {
    await updateBackgroundJob(job.id, { status: "failed", errorMessage: message });
  } catch { logWorker("error", `無法更新任務 #${job.id} 狀態`); }
}
// 迴圈繼續處理下一筆，沒有 throw 出這個 function
```

```ts
// modelTrainingWorker.ts:262-273(recoverStuckTrainingJobs 內，Replicate 查詢失敗)
} catch (replicateErr: unknown) {
  ...
  logWorker("error", `任務 #${job.id} — Replicate API 查詢失敗: ${msg}`);
  // Don't mark as failed — might be a transient error, let next tick retry
  continue;   // ← 不 rethrow
}
```

因此 `runModelTrainingWorker`(:296-325)包住這兩個函式呼叫的 `try { ... } catch (err) { replicateBreaker.recordFailure(); throw err; }` 幾乎不可能真的走到 `catch` 分支 —— 兩個內層函式本身就已經把所有錯誤(含 Replicate API 查詢失敗)吞掉了。實務上每一輪只要 `recoverStuckTrainingJobs`/`processQueuedTrainingJobs` 沒有拋出「未被內部捕捉」的例外(例如 `getStuckJobsByType`/`getQueuedJobsByType` 這兩個 DB 查詢本身失敗),就一定會執行到 :317 的 `replicateBreaker.recordSuccess()`,把 breaker 重置回 `CLOSED`。也就是說,即使 Replicate API 每次呼叫都失敗(在 `recoverStuckTrainingJobs` 裡被逐筆 catch 吞掉),circuit breaker 依然會在每一輪結束時被標記「成功」,永遠不會真正 OPEN。

**影響**

- 頭部註解(:4-9)宣稱這是「停止對 Replicate 連續打爆」的保護機制,但實際程式路徑下 `recordFailure()` 幾乎不可達,`recordSuccess()` 幾乎每輪必達,防護名存實亡。若 Replicate API 真的持續故障,這個 worker 仍會每 5 分鐘照常對外發送查詢/提交請求,沒有真正被這道保護攔下來。

**建議**

- 讓 `recoverStuckTrainingJobs`/`processQueuedTrainingJobs` 內對 Replicate API 呼叫失敗的分支改為往外拋一個可辨識的錯誤(或回傳失敗計數讓外層決定要不要 `recordFailure()`),而不是在內部 `continue`/靜默吞掉,讓 circuit breaker 真正依據 Replicate 呼叫的成功/失敗次數運作。

---

## 5.〔中〕`recoverStuckTrainingJobs` 對「Replicate 仍在 processing」的分支沒有整體逾時,可無限期停留在「訓練中」

**發現**

`modelTrainingWorker.ts:249-261`:

```ts
} else if (
  prediction.status === "starting" ||
  prediction.status === "processing"
) {
  // Still running — reset the stuck timer by touching updatedAt
  logWorker("info", `任務 #${job.id} — Replicate 仍在 ${prediction.status}，重置計時器`);
  await updateBackgroundJob(job.id, {
    progressMessage: `訓練中（${prediction.status}，Worker 已確認仍在執行）`,
  });
}
```

這個分支每次被觸發只會刷新 `updatedAt`(重置「卡住」判定的 15 分鐘計時器),沒有任何整體時間上限。對照 `loraTrainer.ts:282`(`const MAX_POLL_MS = 3_600_000; // 60 minutes`),同一個訓練若是在**同一次 process 存活期間**由 `runLoraTrainingJob` 自己的輪詢迴圈追蹤,會在 1 小時後強制判定逾時失敗(:372-379);但一旦 process 重啟、控制權轉移到這個 cron 復原路徑,就不再有這個 1 小時上限 —— 只要 Replicate 一直回報 `processing`,這個 job 可以被無限期地每 5 分鐘重置一次計時器。

**影響**

- 若 Replicate 端的某個 prediction 變成殭屍(卡住不動但也不回報 failed),使用者會看到模型永遠停在「訓練中」,沒有任何機制會把它判定為最終失敗、讓使用者知道要重跑。

**建議**

- 在 `resultJson` 或另一個欄位記錄「首次送出 Replicate 的時間戳」,`recoverStuckTrainingJobs` 對 `starting`/`processing` 分支加上一個總體上限(例如比照 `loraTrainer.ts` 的 1 小時,或給訓練類任務更寬鬆的上限如 3 小時),超過就標記失敗並(可選)呼叫 Replicate 的取消 API。

---

## 6.〔中〕教學檔案 embedding 失敗被靜默吞掉,`transcriptionStatus` 不會反映真實狀態

**發現**

`teachingArchiveIngest.ts:120-137`:

```ts
await db.updateTeachingMaterial(row.id, {
  textContent: stored,
  transcriptionStatus: "completed",     // ← 先寫 completed
  ...(pageCount !== undefined ? { pageCount } : {}),
});

// ── 向量索引（Pinecone）— 失敗不擋主流程 ────────────────────────────
const fresh = await db.getTeachingMaterial(row.id);
if (fresh) {
  upsertTeachingMaterialVectors(fresh).catch(err => {
    console.warn(`[teachingArchiveIngest] vector upsert non-fatal failure for material=${row.id}:`, err);
  });
}
```

`transcriptionStatus` 在 embedding(Gemini `getEmbedding`)呼叫**之前**就已經寫成 `"completed"`;向量化本身是 fire-and-forget(沒有 `await`),錯誤只 `console.warn`,不會傳回 `runTeachingIngestion`/`doExtraction` 的呼叫鏈,自然也不會被 `teachingArchiveIngestionWorker.ts:100-125` 的 `try/catch` 捕捉到(該 catch 只能看到 `runTeachingIngestion` 本身拋出的例外,而向量化的錯誤根本沒有機會冒泡到這裡)。

**影響**

- 若 Gemini embedding API 額度用盡、金鑰失效、或暫時性錯誤,對應素材會被標記「已完成」,但實際上永遠沒有向量索引,RAG 檢索永遠找不到這篇素材。使用者與營運方都無法從 `transcriptionStatus` 察覺這個「靜默失敗」,也沒有任何補償性 cron/job 去掃描「completed 但缺向量」的素材重新索引。

**建議**

- 增加一個獨立欄位(例如 `vectorIndexStatus`)記錄向量化的實際結果,或至少把失敗寫進 `resultJson`/log 供事後查詢;可另開一個輕量 cron 定期掃描「`transcriptionStatus=completed` 且向量化失敗或缺漏」的素材重新觸發 `upsertTeachingMaterialVectors`。

---

## 7.〔中〕assetCleanupService 的共用 fileKey 檢查與實際刪除之間無交易/鎖,存在 TOCTOU 競態

**發現**

`assetCleanupService.ts:75-101`:

```ts
for (const row of expired) {
  try {
    let canDeleteObject = false;
    if (row.fileKey && row.fileKey.trim()) {
      const others = await deps.countOthersByFileKey(row.fileKey, row.id);
      if (others === 0) { canDeleteObject = true; } else { result.skippedSharedKey++; }
    }
    if (opts.dryRun) continue;
    if (canDeleteObject && row.fileKey) {
      await deps.deleteStorageObject(row.fileKey);   // ← 與上面 countOthersByFileKey 之間沒有交易/鎖
      result.storageDeleted++;
    }
    await deps.deleteAssetRow(row.id);
    result.rowsDeleted++;
  } catch { result.errors++; }
}
```

`countOtherDigitalAssetsByFileKey`(`db.ts:1567-1584`)只是一次獨立的 `SELECT COUNT(*)`,與後續的 `deleteStorageObject`/`deleteAssetRow` 之間沒有用交易或列鎖包住。若在「確認 `others === 0`」之後、真正執行刪除之前,剛好有另一筆資產列 insert/update 成共用同一個 `fileKey`(程式碼註解本身承認這種共用場景存在,例如「公開回收複製、團隊共享複製」),該共用列會因為原物件被刪除而壞圖,且沒有任何機制在刪除前重新檢查。

同時確認:`listExpiredDigitalAssets`(`db.ts:1591-1606`)是全站掃描,`where` 條件只有 `lt(digitalAssetLibrary.expiresAt, asOf)`,**沒有 `eq(userId, ...)` 這類 owner 限定**;`assetCleanupJob.ts:68-79` 呼叫時也不帶任何使用者上下文 —— 這對「系統排程」而言是預期行為(不是使用者觸發的 mutation,不需要 tenant 邊界),但代表 owner 檢查完全不存在於這條路徑上,一切正確性依賴 `expiresAt`/共用 key 檢查本身。

**影響**

- 這個 race window 在單一 instance、單一 cron tick 內部是安全的(`for` 迴圈逐筆序列處理,不會自己跟自己競爭);風險來自「本批次執行期間,其他請求路徑同時對同一個 `fileKey` 做新增引用」。發現 2 提到的「多實例下 `assetCleanupJob` 也沒有跨 process 防護」會放大這個窗口(兩個 instance 同時掃描到同一批過期資產,各自獨立跑 `countOthersByFileKey` 檢查,行為上仍是各自序列處理,不會讓風險質變,但會讓同一批列被檢查與刪除兩次,浪費資源且如果第一個 instance 刪除後、第二個 instance 對已刪除的行再次操作,`deleteAssetRow`/`deleteStorageObject` 本身宣稱冪等「不存在不算錯」,應可安全處理重複刪除)。

**建議**

- 若共用 `fileKey` 的場景(公開複製/團隊共享)在實務上确实會發生「清理當下才新增引用」,建議把 `countOthersByFileKey` 檢查與 `deleteStorageObject` 收斂進同一個 DB 交易,或者用「先刪 DB 列(在交易內連同 fileKey 引用計數一起處理)、成功後才刪物件」的順序降低窗口;若共用場景極罕見或有其他業務規則保證不會在清理瞬間發生,目前設計可接受,但應在文件/註解中明確記錄這個已知的窄 race window。

---

## 8.〔低〕mediaArchivalService 失敗只計數不留訊息,壞資料每 5 分鐘重掃永不隔離

**發現**

`mediaArchivalService.ts` 內的批次迴圈(`runMediaArchival:292-299`、`313-320`,以及 `archiveBackgroundJobMedia:140-147`)對每筆資產的例外處理一律是:

```ts
try {
  const r = await archiveAsset(asset);
  if (r.archived) result.assets.archived += 1;
  else result.assets.skipped += 1;
} catch {
  result.assets.failed += 1;   // ← 完全不記錄錯誤訊息/堆疊
}
```

`mediaArchivalCron.ts:31-47` 每 5 分鐘呼叫一次 `runMediaArchival(MAX_BATCH=20)`,以 `archivedAt IS NULL` 做為篩選條件(`mediaArchivalService.ts:283-290`)。若某筆資產的來源 URL 已經失效(例如 AI 供應商的 presigned link 早已過期 404),`persistExternalMediaUrl` 會持續拋錯,該筆資產的 `archivedAt` 永遠不會被寫入,於是**每 5 分鐘都會被重新掃到、重新嘗試、重新失敗**,沒有失敗次數上限、沒有退避(backoff)、也沒有「標記為不可歸檔」的旁路機制把它從下一輪批次中排除。

**影響**

- 不燒錢(沒有付費 API 呼叫,只是下載失敗的 HTTP 請求與資料庫查詢),但屬於「準毒訊息」模式:同一批壞資料佔用每一輪批次的名額(`MAX_BATCH=20`),且因為 catch 沒有記錄具體錯誤原因,運維只能看到 `failed=N` 這個數字,無從得知是哪些資產、為什麼失敗,除錯困難。

**建議**

- 在 catch 區塊至少 log 一次具體的 asset id + 錯誤訊息(不需要每次都印,可用取樣或第一次/每 N 次失敗才印),並考慮加上失敗次數欄位或「連續失敗 N 次後跳過本輪批次」的邏輯,避免壞資料長期佔用批次名額。

---

## 9.〔低〕cronPreview 的 370 天搜尋上限對跨年週期(如純閏年 2/29)排程會靜默回傳空結果

**發現**

`cronPreview.ts:119-121`:

```ts
// Cap the search at ~370 days. Yearly schedules (e.g. `0 0 1 1 *`) still
// resolve within this window for any starting date.
const cap = new Date(cur.getTime() + 370 * 24 * 60 * 60 * 1000);
```

對於 `0 0 29 2 *`(只在閏年 2/29 觸發)這類跨越最長 4 年週期的排程,下一次真正發生的時間可能超過 370 天上限,`nextFireTimes` 會回傳 `{ ok: true, nextRuns: [] }`(不是報錯,是靜默回傳空陣列,參見函式邏輯 :123-145 的 `while (cur < cap && result.length < count)` 迴圈)。

**影響**

- 此檔案的用途僅是 UI 預覽(檔頭註解:「讓 panel 顯示 Next 3 runs」),不影響 `node-cron` 真正的排程執行(真正執行由 `orbScheduler.ts` 直接呼叫 `cron.schedule`,不經過這個檔案)。影響範圍僅限於使用者在設定介面對這類極端 cron 表達式看到「無法預覽」的空清單,不是功能性 bug。

**建議**

- 低優先。若要修可以把 cap 動態延長到約 4~5 年(仍是常數時間的迴圈,只是上限拉高),或在 `ok: true, nextRuns: []` 時額外回傳一個 hint 訊息讓 UI 顯示「下次執行時間超過可預覽範圍」而非單純空白。

---

## 10.〔資訊〕orbScheduler 的 in-flight 鎖與 cross-tenant 保護設計值得記錄

**發現(非缺陷,供稽核記錄)**

- `orbScheduler.ts:217-236` 的 per-job in-flight lock(`inFlightScheduledJobs` Map)有 `STALE_SCHEDULED_LOCK_MS = 45 * 60_000`(:218)安全網,即使 `finally` 沒執行(process 被 SIGKILL)也不會永久卡死該任務排程,設計上比其餘 4 個 worker 單純的 boolean 鎖更完整(有過期機制)。但如同發現 2 所述,這個鎖仍是 process-local,無法跨多實例。
- `setOrbJobEnabled`(:432-488)對 `expectedUserId` 做了明確的跨租戶保護:即使 DB fallback 路徑(:441-467)也會在讀到別的使用者的 row 時直接回傳 `undefined`,不讓呼叫端拿到別人的排程資料、也不會產生任何寫入。這是本輪 6 個檔案中唯一看到「對使用者輸入做 owner 檢查」的 mutation 路徑,值得肯定。
- `recordRunResult`(:108-154)對「`lastResult`/`lastRunStatus` 欄位可能因為 migration 0024 尚未套用而不存在」做了 graceful degradation(偵測 `Unknown column`/`does not exist` 訊息後降級只寫 `lastRunAt`/`lastError`),避免因為欄位缺失讓整條排程結果寫入失敗。

---

## 附:做得好的設計(供公正記錄,非發現)

- `assetCleanupJob.ts` 的兩段式安全閥設計扎實:`ENABLE_ASSET_TTL_CLEANUP` 預設 OFF(對正式站零行為改變)+ 即使開了旗標,`ASSET_TTL_CLEANUP_DRY_RUN` 預設仍是 ON(演練,只統計不刪),需要明確兩個環境變數都手動調整才會真的刪除(:38-51)。`runAssetCleanupSweep`(:58-89)本身也遵守檔頭宣稱的「fail-never」原則:cron callback 的 catch 呼叫 `captureError`(:96-100)而不是讓例外往外炸。
- `listExpiredDigitalAssets`(`db.ts:1591-1606`)用嚴格小於(`lt`,非 `<=`)判斷過期,且 `expiresAt IS NULL` 的列因 SQL `NULL < x` 為 unknown 而天然被排除,行為正確、無邊界誤刪風險。
- `deleteDigitalAsset`(`db.ts:1555-1559`)確認為真實硬刪除(非 soft-delete,`digitalAssetLibrary` 表也沒有 `deletedAt` 欄位),這與兩段式安全閥的設計互相配合(先用 dry-run 充分驗證,再接受硬刪除的不可逆性)。
- 5 個排程/worker 全數確認已在 `server/_core/index.ts` 正確掛載啟動與優雅關閉(`SCHEDULED_MAINTENANCE_JOBS` 陣列 + `startOrbScheduler()`),沒有發現「寫了但沒接線」的死碼;啟動順序上,所有維護性 cron 都排在 DB migration 完成之後才啟動(`server/_core/index.ts:491-493` 註解:「Scheduled maintenance cron jobs start only after migrations」),避免了首次執行就打到不存在的資料表。

---

## 嚴重度總表

| # | 發現 | 嚴重度 | 檔案:行號 |
|---|---|---|---|
| 1 | 孤兒 Replicate 訓練競態(process crash 觸發、單一 instance 即可發生) | 嚴重 | modelTrainingWorker.ts:274-286、loraTrainer.ts:250-266/306-339、webhookReplicate.ts:111-120 |
| 2 | 4/5 個 worker 無跨 process 防重複執行,且無架構缺陷警告 | 嚴重 | mediaArchivalCron.ts:24、modelTrainingWorker.ts:55、teachingArchiveIngestionWorker.ts:38、assetCleanupJob.ts:31、db.ts:2779-2796/2141-2148 |
| 3 | model_training / teaching_archive_ingestion 全鏈路無計費/配額防護(部分入口不對稱) | 高 | loraTrainer.ts 全檔、teachingArchiveIngest.ts 全檔、routers/models.ts:270-435、routers/loraTrainer.ts:152-282 |
| 4 | Circuit Breaker 邏輯路徑上幾乎必為 CLOSED,防護形同虛設 | 高 | modelTrainingWorker.ts:161-172、262-273、296-325 |
| 5 | 卡住訓練若 Replicate 端真殭屍,無整體逾時 | 中 | modelTrainingWorker.ts:249-261 |
| 6 | 教學檔案 embedding 失敗被靜默吞掉 | 中 | teachingArchiveIngest.ts:120-137 |
| 7 | 共用 fileKey 檢查與刪除間無交易/鎖(TOCTOU) | 中 | assetCleanupService.ts:75-101、db.ts:1567-1584 |
| 8 | mediaArchival 失敗吞錯誤訊息,壞資料無限重掃 | 低 | mediaArchivalService.ts:145-147/297-299/319-321 |
| 9 | cronPreview 370 天上限對跨年閏日排程靜默回傳空清單 | 低 | cronPreview.ts:119-121 |
| 10 | orbScheduler in-flight 鎖與 cross-tenant 保護(正向記錄) | 資訊 | orbScheduler.ts:217-236、432-488 |
