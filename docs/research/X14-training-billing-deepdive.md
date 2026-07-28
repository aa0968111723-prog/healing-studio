# X14 — 訓練計費(loraTrainer + falTrainer)逐行深挖(地毯掃描 wave X)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/routers/loraTrainer.ts(407)、server/services/falTrainer.ts(433)

## 前言:這輪要回答的核心問題

Brief 指定聚焦「訓練計費」,並要求對照 W2/W5「~20 個 ProStudio 端點扣了不退」的主題。逐行讀完兩檔後,結論是:**方向完全相反**——`loraTrainer.ts`/`falTrainer.ts` 兩檔案**從頭到尾沒有任何 `deductUserPoints`/`refundUserPoints`/`costPoints` 呼叫**(全檔 grep `credit|balance|charge|refund|deduct|price|cost` 零命中計費邏輯,唯一命中是 `loraTrainer.ts:178` 註解本身提到「GPU LoRA training costs several USD per run」)。所以「失敗要不要退款」這個問題在這兩檔案**不成立**——沒有先扣款,談不上退款。這與 W7 發現 3、W9 發現 3 的結論一致(W7:「LoRA 訓練目前完全沒有點數計費」;W9:「本輪稽核的兩條鏈路完全沒有接上 `atomicClaimJobRefund`」),本輪從這兩個目標檔案逐行重新驗證後**坐實同一結論,並额外挖出三個前幾輪未觸及的新缺口**(發現 1、2、3)。

真正的風險不是「使用者的錢消失」,而是反過來:**站方用真實 GPU/API 費用(Replicate、fal.ai)換取零收費保障,且至少兩處(發現 1、2)存在「已經真的付費啟動的任務,程式碼卻主動放棄追蹤結果」的具體缺口**——這比單純「沒收費」更嚴重,是「收費了(對第三方供應商)也追不回結果」。

---

## 發現 1(Critical · 已坐實)`trainWithReplicate` 對 `portrait_lora` 完全沒有同意書(consent)授權門檻——同一 app 的另一入口有擋、這裡沒擋

**現象**:`server/routers/loraTrainer.ts:152-282`(`trainWithReplicate`)的輸入 schema:

```ts
// loraTrainer.ts:153-169
.input(
  z.object({
    modelName: z.string().min(1).max(255),
    description: z.string().optional(),
    modelType: z.enum([
      "image_subject",
      "style_lora",
      "scene_lora",
      "portrait_lora",
    ]),
    triggerWord: z.string().min(1),
    steps: z.number().int().min(100).max(10000).default(1000),
    learningRate: z.number().positive().default(0.0004),
    imageUrls: z.array(z.string().url()).min(4).max(50),
    baseModel: z.string().optional(),
  })
)
```

`modelType` 明確允許 `"portrait_lora"`,但**全函式(152-282 行)、乃至全檔案,搜尋 `consent`/`Consent` 零命中**。對照同一專案內另一個「建立訓練模型 + 啟動訓練」的平行入口 `server/routers/models.ts` 的 `create` mutation(:270-435),那裡有完整的同意書門檻:

```ts
// models.ts:332-347(節錄)
const requiresConsent =
  input.subjectType === "self" ||
  input.subjectType === "real_person" ||
  input.subjectType === "copyrighted" ||
  input.modelType === "portrait_lora";

if (requiresConsent) {
  const ids = input.consentIds ?? [];
  if (ids.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "訓練真實人物或受版權保護的素材，必須先簽署數位肖像權 / 照片使用同意書",
    });
  }
  // ... 逐一驗證 consent 屬於本人、未撤回、未過期、consentType 對應 portrait_lora
```

`trainWithReplicate` 是一條**完全獨立**的 mutation,不經過 `models.ts` 的 `create`,直接呼叫 `buildAndUploadZip`(`loraTrainer.ts:212-218`)→ `startReplicateTraining`(`loraTrainer.ts:221-249`)啟動真實 Replicate 訓練,中間沒有任何一行檢查 `consentIds`/`subjectType`。也就是說:**同一個使用者要訓練「人像 LoRA」(`portrait_lora`),走 `models.create` 會被要求先簽同意書,走 `loraTrainer.trainWithReplicate` 完全不需要**——兩個入口對同一個受監管欄位(`modelType: "portrait_lora"`)的授權要求不一致,後者是繞過既有合規機制的活生生後門。

**影響**:任何登入使用者可用 `loraTrainer.trainWithReplicate` 提交任意人臉圖片(只要通過 `assertSafeUrl` 的網域白名單,見發現 5)訓練「人像 LoRA」模型,完全不需要主體本人的肖像權同意書或任何 subjectType 分類——直接繞過站方自己在 `models.ts` 已經建立的個資/肖像權合規門檻。這是「上傳資料集的授權」主題下最嚴重的一項發現。

**建議**:在 `trainWithReplicate` 的 mutation 開頭(建立 `fineTunedModel` 之前)加入與 `models.ts:332-381` 完全相同的 `subjectType`/`consentIds` 檢查邏輯(可抽成共用函式讓兩個入口呼叫同一份驗證,避免未來第三個入口又漏掉)。同時應盤點 `server/services/agentToolExecutor.ts`(Orb 智能體的 `studio.trainLora` 工具,約 7600-7700 行)是否也呼叫了 `falTrainer.runFalTrainingJob` 而未經同意書門檻——經查該檔案在建立 `fineTunedModel` 前同樣沒有 consent 檢查,顯示這不是單一入口的疏漏,而是「同意書門檻只掛在 `models.ts create` 一條路徑上」的系統性設計缺口(此檔案不在本次稽核範圍,僅作為佐證列出,建議另立稽核項目)。

---

## 發現 2(Critical · 已坐實)fal.ai 60 分鐘逾時只是本地放棄等待,從未取消/中斷實際任務——逾時後真實產出永久遺失且無法回收

**現象**:`server/services/falTrainer.ts:312-345`(`runFalTrainingJob` 內)：

```ts
// falTrainer.ts:328-345
const response = await Promise.race([
  client.subscribe(falModelId, { input: falInput, logs: false }),
  new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("Fal.ai 訓練超時（60 分鐘）")),
      3_600_000
    )
  ),
]);
result =
  (response as { data?: Record<string, unknown> }).data ??
  (response as Record<string, unknown>) ??
  {};
} finally {
  clearInterval(progressInterval);
}
```

`client.subscribe(...)` 是 `@fal-ai/client` 的長輪詢呼叫,本身沒有被傳入任何 `AbortController`/`signal`(全檔案搜尋 `Abort|signal|cancel` 零命中)。`Promise.race` 只決定「我方程式碼先看哪一個先解決」——當 60 分鐘計時器先觸發,`race` 立刻 reject,程式碼直接跳進 catch(`falTrainer.ts:422-432`),把模型標記 `status: "failed"`。**但 `client.subscribe` 這個呼叫本身並未被取消**——fal.ai 佇列端的訓練任務(以及 SDK 內部仍在跑的輪詢迴圈)會繼續在背景執行、繼續計費,而我方已經沒有任何程式碼路徑在等待它的最終結果:

- `runFalTrainingJob` 的「Step 5:輸出解析」區塊(`falTrainer.ts:347-421`,含 `trainedLoraUrl` 寫回、`status: "ready"`)完全被跳過,因為 control flow 已經進了 catch 分支。
- fal.ai 這條路徑**不像 Replicate 有 webhook 可以事後補救**——`submitFalTraining`(見發現 7,死碼)雖然定義了 `client.subscribe` 呼叫,但 `runFalTrainingJob` 實際使用的是內嵌的另一份呼叫(:328-338),兩者都沒有帶 `webhookUrl` 給 fal.ai(對照 Replicate 路徑有 `webhook` 參數,`loraTrainer.ts:235-239`)。所以逾時之後,即使 fal.ai 那頭最終真的訓練成功、產出可用的 LoRA 檔案,**沒有任何機制能把這個結果寫回 `fineTunedModels`**——訓練費用(steps 越高、影片 LoRA 越久,越可能撞到 60 分鐘上限)已經產生,產出永久遺失,使用者看到的是「失敗」,若因此重新提交(`models.ts` 的 `create`/`retrain` 對此無配額限制,已見 W9 發現)則是重複付費做同一件事。

**影響**:這是「有付費、無產出、且無法補救」的確定性缺口(非併發競態,只要訓練時間超過 60 分鐘就 100% 觸發)——比 W2/W5 的「扣款不退」更接近「持續燒錢卻放棄追蹤已購買的運算結果」。

**建議**:
1. 用 `AbortController` 把 60 分鐘逾時與 `client.subscribe` 綁在一起(若 SDK 支援 `signal` 選項),至少讓逾時後續呼叫走 `client.status()`/`client.result()`(fal.ai 佇列 API 通常允許之後用 `request_id` 補查結果)而不是整個放棄。
2. 逾時分支應改為「標記為 `training`(而非 `failed`)+ 排一個背景輪詢/webhook 去之後撿回真正的終態」,而不是直接判死。
3. 中長期應該讓 fal 訓練也走 `webhookUrl` 提交(比照 Replicate 與 `proStudio.ts` 其他 fal 端點的做法),不要靠一個會被本地逾時打斷的長輪詢 `subscribe` 作為唯一取得結果的手段。

---

## 發現 3(High · 已坐實)Replicate 訓練「已啟動但寫回失敗」時,真實付費任務被程式碼標記為失敗且永久無法追回——webhook 安全網因終態守門而失效

**現象**:`server/routers/loraTrainer.ts:210-281`(`trainWithReplicate` 的 try/catch):

```ts
try {
  // Step 2: 打包+上傳 ZIP
  const zipUrl = await buildAndUploadZip(...)                 // :213-218
  // Step 3: 啟動 Replicate 訓練 —— 這一步成功就代表 Replicate 已經開始計費
  const { trainingId, status } = await startReplicateTraining({...})  // :241-249
  // Step 4: 寫回 trainingId + 標記為 training
  await db.updateFineTunedModel(modelId, {
    status: "training",
    replicatePredictionId: trainingId,
    configJson: { ...triggerWord, steps, learningRate, zipUrl, predictionId: trainingId, submittedAt: Date.now() },
  });                                                          // :252-263
  return { modelId, trainingId, status, destination, zipUrl };
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  await db.updateFineTunedModel(modelId, { status: "failed" }).catch(() => {});  // :274-276 —— 無論失敗發生在 Step 2/3/4 都是同一句
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Replicate 訓練啟動失敗：${msg}` });
}
```

**關鍵問題**:Step 3(`startReplicateTraining`)一旦成功回傳 `trainingId`,代表 Replicate 端已經真的建立訓練任務並開始計費——**這個時間點之後的任何失敗(例如 Step 4 的 `db.updateFineTunedModel` 因為短暫的 DB 連線問題而拋錯),catch 區塊都只會執行同一句 `status: "failed"`,從未把 `trainingId`/`replicatePredictionId` 補寫進資料庫**。後果串連:

1. 這筆真實 Replicate 訓練任務**沒有任何地方記錄它的 `trainingId`**——`replicateTrainingStatus`(:287-312)依賴 `db.getFineTunedModelByReplicateId` 才能查到對應模型,查不到就直接 `NOT_FOUND`,使用者永遠看不到這筆訓練的真實進度。
2. 訓練啟動時已經用 `signWebhookToken("replicate", modelId)` 簽好、以 `modelId`(而非 `trainingId`)為主鍵構造 webhook URL(:234-239)——這代表**即使 Step 4 寫回失敗,Replicate 之後仍然會真的呼叫 `/api/webhook/replicate?modelId=<modelId>&token=...`**。但 `webhookReplicate.ts:115-120` 有終態守門:

   ```ts
   // webhookReplicate.ts:111-120
   if (model.status === "ready" || model.status === "failed") {
     console.log(`[WebhookReplicate] Model ${modelId} already ${model.status}, ignoring duplicate/late webhook`);
     return;
   }
   ```

   由於 catch 區塊已經把 `model.status` 設成 `"failed"`,**這個守門會把稍後真的送達的 `succeeded` webhook 直接丟棄**——即使 Replicate 端訓練最終成功、產出可用的 `trainedLoraUrl`,這個結果永遠不會被寫回資料庫。
3. `failed` 狀態不計入 `trainWithReplicate` 自己的併發上限檢查(`activeCount` 只算 `pending`/`training`,:183-185),使用者會立刻看到「可以再訓練一次」,在同一小時內(受限於 3 次/hr 速率限制)重複提交、重複付費——而每一次都可能重蹈覆轍。

**影響範圍的誠實界定**:這個窗口需要「Replicate 訓練啟動成功」與「緊接著的 DB 寫回拋錯」同時發生,不是每次呼叫都會觸發,但一旦觸發,是**不可逆的資料遺失**(沒有任何 cron/補償機制之後去比對「狀態是 failed 但其實 Replicate 端已經在跑/已完成」的模型並修正——本次稽核範圍內的兩個檔案沒有這類自我修復邏輯)。

**建議**:
1. 把 Step 3(`startReplicateTraining`)與 Step 4(寫回 DB)拆成兩個獨立的 try 區塊:Step 3 成功後,若 Step 4 寫回失敗,不應該把狀態標成 `"failed"`,至少應該標成一個中繼狀態(例如沿用 `"training"` 但補寫 `predictionId`,或新增 `"training_unconfirmed"`),並記錄告警讓後續有機會用 `trainingId`(已經拿到手,只是沒寫進 DB 而已——可以在 catch 內用區域變數重試寫入)補救,而不是直接判死。
2. 至少應該用區域變數暫存已取得的 `trainingId`,在 catch 區塊裡「再試一次」把它寫回 DB(retry once),把「Replicate 已啟動」與「DB 寫入」兩件事的失敗率解耦。

---

## 發現 4(High · 已坐實)訓練全流程零計費 + 唯一的用量閘門是「軟性」速率限制——與 GPU 真實成本不成比例

**現象**:如前言所述,`loraTrainer.ts`/`falTrainer.ts` 兩檔案全文搜尋計費相關函式呼叫**零命中**。`loraTrainer.ts:178-179` 的註解自陳:

```ts
// AIDV-622: per-user rate limit (3/hr) — GPU LoRA training costs several USD per run
checkTrpcRateLimit(ctx.user.id, { limit: 3, windowMs: 60 * 60_000, label: "lora:hr" });
```

`checkTrpcRateLimit`(`server/_core/trpcRateLimit.ts:22,35-60`)是**單一 process 記憶體內的 `Map`**,沒有任何持久化(DB/Redis)。這代表:
- 每次 Railway 重新部署(process 重啟)都會把所有使用者的計數器歸零——使用者若剛好在部署前用滿 3 次/hr,部署後可以立刻再訓練 3 次,「每小時 3 次」不是硬上限,是「每個 process 生命週期內每小時 3 次」。
- 若未來水平擴展成多個 instance,限制會依 instance 數等比例失效(每個 instance 各自維護一份 `Map`)。
- 即使限制完全生效,`3 次/hr` 本身也**沒有總量或總花費上限**——理論上一個使用者可以無限期地每小時訓練 3 次、一天 72 次,只要不撞到「同時 ≤2 個 pending/training」的併發上限(:182-191,這道併發檢查是查 DB,持久化,不受重啟影響——這道防線本身是可靠的)。
- `falTrainer.ts` 的 `runFalTrainingJob` **本身完全沒有任何速率/併發自我防護**——它是一個純函式,呼叫端(`models.ts` 的 `create`,已由 W9 證實無任何配額檢查)給什麼就跑什麼,沒有第二道防線。

**影響**:對照 W2/W5 討論的「扣了不退」,這裡是完全相反且更根本的問題——**站方為每一次訓練買單(Replicate/fal.ai 的真實 GPU 帳單),唯一的閘門是一個會被部署重啟清空、且沒有總量上限的速率限制**,而這道限制本身還只掛在 `loraTrainer.trainWithReplicate` 這一個入口,`falTrainer.ts` 的 `runFalTrainingJob` 作為服務層完全信任呼叫端。

**建議**:
1. 速率限制器應改為以 DB 為準(比照併發上限檢查已經在做的方式),至少對「訓練」這類直接對應真實金流的操作,不應該依賴會被部署清空的記憶體狀態。
2. 應該在 `falTrainer.ts`(服務層本身)加入與 `loraTrainer.ts` 對等的每小時次數/併發上限自我檢查,不要把防線完全交給呼叫端——目前兩個引擎(Replicate vs fal)的防護不對稱,已由 W9 從 `models.ts` 角度指出,本輪從服務層角度確認 `falTrainer.ts` 沒有補上這一塊。
3. 建議增加「總花費」層級的防護(例如每位使用者每月訓練次數上限、或串接 `cost_ledger` 記錄每次訓練預估成本作觀測),而不只是「呼叫頻率」層級。

---

## 發現 5(Medium · 已坐實)`VITE_SITE_URL` 未設定時,Replicate webhook 直接靜默停用,完成通知完全依賴前端輪詢

**現象**:`loraTrainer.ts:233-239`:

```ts
const siteUrl = process.env.VITE_SITE_URL?.trim();
const webhookToken = signWebhookToken("replicate", modelId);
const webhook = siteUrl
  ? `${siteUrl}/api/webhook/replicate?modelId=${modelId}${
      webhookToken ? `&token=${webhookToken}` : ""
    }`
  : undefined;
```

若 `VITE_SITE_URL` 未設定(或為空字串,`?.trim()` 後仍可能是空字串,此時 `siteUrl` 為假值),`webhook` 直接是 `undefined`。傳入 `startReplicateTraining`(`replicateClient.ts:112-115`):

```ts
if (input.webhook) {
  createOptions.webhook = input.webhook;
  createOptions.webhook_events_filter = ["completed"];
}
```

`webhook` 欄位整個被省略——Replicate **完全不會回呼**。`webhookReplicate.ts` 檔頭注解原本要解決的問題(「瀏覽器關閉後 `fineTunedModels.status` 會卡在 `training`」)在這個組態下會原封不動地重現:模型狀態永遠停在 `"training"`,除非使用者手動觸發 `models.ts` 的 `syncReplicateStatus`(該檔案不在本次稽核範圍)。`loraTrainer.ts` 本身沒有任何程式碼在 `webhook === undefined` 時發出告警或退回輪詢排程。

**影響範圍**:僅在 `VITE_SITE_URL` 環境變數缺失/設錯時觸發,屬於組態相依風險,不是預設路徑下的 bug,但一旦觸發,`loraTrainer.ts` 自身沒有偵測或補救機制。

**建議**:在 `trainWithReplicate` 內,若 `webhook` 為 `undefined`,至少應該 `logger.warn(...)` 記錄「本次訓練沒有 webhook 回呼,僅能依賴輪詢」,並考慮讓後端有一支背景排程(比照 `staleJobChecker.ts` 模式)定期對 `status === "training"` 且無 webhook 的模型做主動輪詢兜底。

---

## 發現 6(Medium · 已坐實)訓練資料集網址只驗證 SSRF 安全性與 CDN 網域白名單,不驗證擁有權

**現象**:`loraTrainer.ts:166` 的輸入 schema `imageUrls: z.array(z.string().url()).min(4).max(50)` 對每個 URL 唯一的伺服器端檢查是 `buildZipBuffer`(`falTrainer.ts:75-131`)內的 `assertSafeUrl(url)`(:109),其邏輯(`server/lib/urlValidator.ts:28-140`)只做三件事:HTTPS-only、封鎖私網/loopback IP、以及網域白名單(`fal.ai|fal.run|fal.media|storage.googleapis.com|r2.dev|cloudfront.net|amazonaws.com|supabase.co|supabase.in|blob.core.windows.net` 等)。**這些檢查完全不驗證「這個 URL 是否屬於發起請求的使用者」**——只要是這些 CDN 網域底下的任何公開可讀 URL(包含其他使用者先前生成/上傳、恰好可被存取到的檔案),都會被下載、打包進本次訓練的 ZIP、送去訓練成別人的 LoRA 模型。

**影響**:這與發現 1 的同意書繞過屬於同一類「上傳資料集授權」問題,但角度不同——即使補上 consent 檢查,`imageUrls` 本身仍是「自由輸入的任意合法 CDN URL」,沒有機制確認素材真的來自使用者本人的帳號空間(例如比對 `fileKey`/物件的擁有者 metadata)。實務風險程度取決於這些 CDN 上的物件金鑰是否容易被猜測或外流(本次稽核未驗證這點,不在此檔案範圍內)。

**建議**:比照 `models.ts` `create` 的 `datasetImages` 結構(帶 `fileKey`),`trainWithReplicate` 的 `imageUrls` 也應該改成接受 `fileKey` 並由後端查詢該檔案的擁有者記錄(若有的話)進行比對,而不是單純接受任意字串 URL。

---

## 發現 7(Medium · 已坐實)`submitFalTraining` 為死碼;實際執行路徑從未保存 fal.ai 真實 `requestId`

**現象**:`falTrainer.ts:167-214` 定義了 `submitFalTraining`,內部邏輯(組 input、呼叫 `client.subscribe`、回傳 `result.requestId`)與 `runFalTrainingJob` 內嵌的呼叫(:296-338)高度重複。全 repo 搜尋 `submitFalTraining` 只有這個定義本身,**沒有任何呼叫點**——是純粹的死碼。

同時,`runFalTrainingJob` 實際路徑寫入 `configJson.falRequestId` 的值是寫死的字串常數,不是 fal.ai 回傳的真實 request id:

```ts
// falTrainer.ts:282-293(提交後立即寫入,尚未有結果)
await updateFineTunedModel(modelId, {
  configJson: { falModelId, falRequestId: "pending", triggerWord, steps, learningRate, isStyle, zipUrl, submittedAt: Date.now() },
});
...
// falTrainer.ts:360-375(成功後)
configJson: { falModelId, falRequestId: "completed", ... }
// falTrainer.ts:395-408(無輸出 URL 但視為完成)
configJson: { falModelId, falRequestId: "completed-no-url", ... }
```

`client.subscribe(...)` 的回傳值裡確實可能帶有 `requestId`(`submitFalTraining` 自己的實作就示範了如何取,:210-213),但 `runFalTrainingJob` 從未擷取它,`falRequestId` 欄位實質上只是一個狀態字串("pending"/"completed"/"completed-no-url"),而非可用來對照 fal.ai 帳單/後台紀錄的真實識別碼。訓練失敗的分支(:422-432)完全不觸碰 `configJson`,所以失敗的任務會永遠停留在 `falRequestId: "pending"` 這個具誤導性的殘留值上。

**影響**:對帳/事後追查能力受損——如果要核對某次 fal.ai 帳單對應到平台上哪一個使用者/哪一次訓練,`fineTunedModels.configJson` 裡沒有真正可用的 fal 端識別碼可查,只能回頭翻 fal.ai 自己的後台記錄再手動比對時間戳。屬於 deadcode/契約不符範疇,非資安或計費急迫問題。

**建議**:刪除死碼 `submitFalTraining`(或讓 `runFalTrainingJob` 改呼叫它以消除重複),並讓 `runFalTrainingJob` 從 `client.subscribe` 的回傳值中擷取真正的 `requestId`/`request_id` 寫入 `configJson.falRequestId`,取代目前的狀態字串常數。

---

## 附帶低嚴重度觀察(非結構化輸出必列項,列於此供完整性參考)

- **`epochs`/`batchSize` 顯示恆為預設值**:`trainingDetail`(:387-391)與 `trainingHistory`(:112-116)從 `configJson` 讀 `epochs ?? 0`、`batchSize ?? 4`,但 `trainWithReplicate` 寫入 `configJson` 的欄位只有 `triggerWord`/`steps`/`learningRate`(:201-205、255-262),從未寫入 `epochs`/`batchSize`。因此所有透過 `loraTrainer.trainWithReplicate` 建立的模型,前端顯示的 `epochs` 永遠是 `0`、`batchSize` 永遠是預設值 `4`,與實際训练使用的 `steps` 無法對應——是顯示層的契約不符(deadcode 性質),非功能性錯誤。
- **速率限制計數先於併發檢查遞增**:`checkTrpcRateLimit`(:179)在「同時 ≤2 個 pending/training」併發檢查(:182-191)**之前**執行且無條件遞增計數器。若使用者已有 2 個進行中任務、第 3 次呼叫必然被併發檢查擋下(不會真的啟動 Replicate 訓練、不花錢),但該次呼叫仍然會消耗一次「每小時 3 次」的額度。效果是使用者可能因為連續撞到併發上限而把當小時的真正可用額度提前用光,屬於檢查順序造成的體驗瑕疵,不是燒錢問題(因為這些被擋下的請求沒有實際啟動付費訓練)。

---

## 已驗證排除的疑慮(Negative Results)

以下項目經逐行檢查後**確認不成立**,列出避免報告只呈現壞消息:

1. **`replicateTrainingStatus`/`trainingDetail` 的擁有權檢查是真正的 DB 層過濾,非事後過濾**——`replicateTrainingStatus`(`loraTrainer.ts:287-312`)呼叫 `db.getFineTunedModelByReplicateId(input.trainingId, ctx.user.id)`,對應的 SQL(`db.ts:971-988`)是 `WHERE replicatePredictionId = ? AND userId = ?` 兩個條件同時鎖在 WHERE 子句裡,不是「查到後再比對 userId」——任何人拿別人的 `trainingId` 查詢都會直接落 `NOT_FOUND`(:296-301),不會洩漏他人訓練狀態。`trainingDetail`(:317-323)同樣顯式檢查 `model.userId !== ctx.user.id` 才放行。這兩個查詢端點的 owner 隔離做得正確。
2. **Replicate webhook 的終態守門與欄位回填邏輯,經程式碼閱讀 + 實機端對端測試雙重驗證正確**——`webhookReplicate.ts:115-120` 的終態守門(`status` 已是 `ready`/`failed` 就直接短路)避免重送/遲到回呼覆寫既有終態;`scripts/model-harness/FINDINGS.md:186-213` 記錄了一次真實 Replicate 訓練(topping up 真實額度後)端對端測試:`startReplicateTraining` 啟動、`trainings.create` 送出、狀態輪詢、以及模擬 webhook payload(`output.weights` 真實格式)送達後確認 `fine_tuned_models.status='ready'` 且 `trainedLoraUrl` 正確寫入——排除了「webhook 回填邏輯本身寫錯」的疑慮。
3. **`destination = user-{userId}/{slug}` 命名慣例(`loraTrainer.ts:230-231`)+ `ensureDestinationModel` 的「不存在就建立」邏輯(`replicateClient.ts:51-70`)並非空想的斷裂假設**——本次稽核初步懷疑這個命名慣例可能與 Replicate 官方 API 的擁有權模型衝突(無法用任意字串當 `owner` 建立 model),但 `scripts/model-harness/FINDINGS.md:186-196` 記錄的真實測試顯示這條路徑「auth、destination model creation、training POST、狀態輪詢」皆確認可用(`status=succeeded`,1m55s 內完成,產出真實 `weights.tar` URL)——排除此項為既存缺陷。
4. **沒有「雙重退款」風險——因為沒有任何退款邏輯可言**:W3/W5/W7 討論的「CAS 鎖是否系統性覆蓋」在這兩個檔案裡沒有適用對象,因為根本不存在 `refundUserPoints`/`atomicClaimJobRefund` 呼叫。這不是「防護做得好」,而是「沒有需要防護的東西」——已在發現 4 中明確定性為計費缺口而非退款缺口。
5. **`checkTrpcRateLimit`/併發上限檢查確實存在且會真的擋下請求**——這不是一個裝飾性的檢查:`trainWithReplicate`(:179、182-191)在超過 3 次/hr 或 ≥2 個進行中任務時會確實拋出 `TOO_MANY_REQUESTS` 並中止,不會走到建立訓練任務的後續步驟。局限性(軟性、無總量上限)已在發現 4 中說明,但檢查本身不是死碼。

---

## 逐題作答

### 1. 訓練任務扣款
兩檔案內**完全沒有扣款邏輯**(見前言 + 發現 4)。`trainWithReplicate` 建立 `fineTunedModel` 時只寫入 `triggerWord`/`steps`/`learningRate` 到 `configJson`,沒有任何 `costPoints`/`deductUserPoints` 呼叫;`runFalTrainingJob` 全程同樣沒有。

### 2. 失敗退款(對照 W2/W5)
不適用(沒有扣款,見上)。但發現 2、3 描述了比「扣了不退」更嚴重的情境:**已經產生真實第三方費用的任務,程式碼因為逾時/寫回失敗而放棄追蹤結果,產出永久遺失**——這是「失敗」語意本身被扭曲(明明可能成功,卻被本地邏輯判定為失敗且無法回溯)的問題,而非退款機制的問題。

### 3. Owner(擁有權隔離)
`trainingDetail`、`replicateTrainingStatus` 的擁有權檢查正確(見「已驗證排除的疑慮」第 1 點)。唯一的授權缺口不在「查詢別人的資料」,而在「用別人的素材/未經同意的人像資料訓練自己的模型」(發現 1、6)——這是另一種形態的授權問題(資料使用授權,非查詢存取授權)。

### 4. 無限重試燒錢
`trainWithReplicate` 有速率限制(3/hr)+ 併發上限(≤2)兩道防線,但速率限制是製程內記憶體狀態、會被部署重啟清空、無總量上限(發現 4);`falTrainer.ts` 的 `runFalTrainingJob` 本身則完全沒有任何自我防護,依賴呼叫端(`models.ts`/`agentToolExecutor.ts`,經 W9 證實均無配額檢查)。發現 3 描述的「啟動成功但寫回失敗」情境還會讓使用者在同一小時內對同一個失敗模型重試,進一步放大成本。

### 5. 狀態持久化
`updateFineTunedModel`(`db.ts:1026-1053`)的 `configJson` 合併是「先讀後寫」而非交易+CAS——在本次稽核的兩個檔案內部,所有呼叫都是同一個 async 函式內依序 `await`,未發現具體的併發雙寫證據;但這個模式若與跨檔案的並發寫入(例如 webhook 與 polling 同時觸發)相遇,存在遺失局部欄位更新的架構性風險(未在兩個目標檔案內坐實成具體 bug,誠實列為潛在風險而非確定缺陷)。發現 3 是本輪坐實的、屬於這兩個檔案自身的持久化缺口(訓練啟動與資料庫寫回之間的失敗處理)。

### 6. Webhook 回填正確性
Replicate 路徑(`webhookReplicate.ts`)本身的欄位回填邏輯正確且經真實測試驗證(已驗證排除疑慮第 2 點),但這套安全網的觸發前提——`webhook` URL 是否真的被送給 Replicate——依賴 `VITE_SITE_URL` 是否配置(發現 5),以及 `trainWithReplicate` 的 Step 4 是否成功把 `trainingId` 寫回 DB(發現 3)。fal.ai 路徑(`falTrainer.ts`)則完全沒有 webhook 回填機制,唯一的結果取得手段是會被 60 分鐘逾時打斷且不可恢復的長輪詢(發現 2)。

### 7. 上傳資料集的授權
本輪最嚴重的兩項發現都在此主題下:`trainWithReplicate` 對 `portrait_lora` 完全沒有同意書門檻(發現 1,Critical),以及 `imageUrls` 只驗證 SSRF 安全性/網域白名單、不驗證擁有權(發現 6,Medium)。

---

## 總結排序(依嚴重度)

1. **Critical**(發現 1):`trainWithReplicate` 對 `portrait_lora` 完全沒有同意書授權門檻,繞過 `models.ts create` 已建立的合規檢查。
2. **Critical**(發現 2):fal.ai 訓練 60 分鐘本地逾時不會取消/中斷實際任務,逾時後真實產出永久遺失、無法回收,且無 webhook 兜底。
3. **High**(發現 3):Replicate 訓練啟動成功後、DB 寫回失敗,會把已付費真實任務永久標記為失敗,webhook 安全網被自己的終態守門擋死。
4. **High**(發現 4):全流程零計費 + 唯一防線是製程內記憶體速率限制(會被部署重啟清空、無總量上限),`falTrainer.ts` 服務層本身無自我防護。
5. **Medium**(發現 5):`VITE_SITE_URL` 未設定時 Replicate webhook 靜默停用,完成通知完全依賴前端輪詢。
6. **Medium**(發現 6):訓練資料集 URL 只做 SSRF/網域白名單檢查,不驗證擁有權。
7. **Medium**(發現 7):`submitFalTraining` 死碼;實際路徑從未保存 fal.ai 真實 `requestId`,拖累事後對帳能力。
8. **Low**(附帶觀察):`epochs`/`batchSize` 顯示恆為預設值;速率限制計數先於併發檢查遞增,浪費未實際花錢的被拒請求額度。

**已驗證排除**:擁有權查詢隔離(trainingDetail/replicateTrainingStatus)、Replicate webhook 欄位回填正確性(含真實端對端測試佐證)、`user-{userId}` destination 命名慣例的可行性(含真實端對端測試佐證)、雙重退款風險(不適用,無退款邏輯)、速率/併發檢查本身確實生效(非裝飾性)。
