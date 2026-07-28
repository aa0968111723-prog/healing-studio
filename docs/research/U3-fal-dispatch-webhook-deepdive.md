# U3 — falDispatcher × webhook 派工核心逐行深挖:對抗式 bug 獵人報告(深挖 wave U)

- 產生日期:2026-07-03
- 依據 commit:`7f4417da`(任務指定基準;本機 HEAD 實測為 `9d392cb9a0f85e03c2f00f21f918599ca8617c5e`,兩者間相關檔案無實質差異)
- 波次:**逐檔深挖 wave U:生成派工核心**
- 前置依據(不重複其結論):`docs/research/K2-generation-bugs.md`(雙重退款、webhook 競態、防冒認不對稱、staleJobChecker 不退款、orbQuota 記憶體/預設關閉)、`02-fullstack.md` §1(生成統一管線)、H1/A(成本地圖)
- 方法:逐行讀 `server/services/falDispatcher.ts`(全 1407 行)、`server/services/falQueueAwaiter.ts`、`server/services/falQueueClient.ts`、`server/services/falRecoveryPolicy.ts`、`server/services/generationJobDispatcher.ts`、`server/routes/webhookFal.ts`/`webhookSuno.ts`/`webhookReplicate.ts`,並逆向追蹤呼叫端(`server/routers/imageStudio.ts`、`videoStudio.ts`、`proStudio.ts`、`generate.ts`、`server/services/agentToolExecutor.ts`、`server/services/spiritTools/*.ts`)以確認每個扣點/退款分支是否真的被觸發。**禁止子代理,全程手動逐檔閱讀。**

---

## 發現總表(依嚴重度排序;每條標示「新發現」或「延伸自 K2」)

### 1.【嚴重・新發現・結構性 100% 重現】`generationJobDispatcher.dispatchGenerationJob` 完全丟棄 `userId`——圖圖/音樂/語音精靈工具的生成一律零扣點

**觸發情境**:`server/services/spiritTools/imageSpecialistTools.ts`、`musicSpecialistTools.ts`、`voiceSpecialistTools.ts` 三支精靈工具實作,呼叫生成時都正確帶上 `userId: input.userId`(例:`imageSpecialistTools.ts:68,131,192`;`musicSpecialistTools.ts:762`;`voiceSpecialistTools.ts:242`),呼叫的是 `generationJobDispatcher.ts` 的 `dispatchGenerationJob(input: DispatchGenerationJobInput)`。

但 `dispatchGenerationJob` 函式本體(`server/services/generationJobDispatcher.ts:103-106`)的解構是:
```ts
export async function dispatchGenerationJob(
  input: DispatchGenerationJobInput
): Promise<DispatchGenerationJobResult> {
  const { modality, modelId, prompt, params = {} } = input;
```
**`input.userId` 從未被解構、從未被讀取、從未被傳給下游任何函式**。往下走的四個分支(:110-157)呼叫 `dispatchImageGeneration`/`dispatchVideoGeneration`/`dispatchAudioGeneration`/`dispatchTTS`(全部定義在 `falDispatcher.ts:727-930`)時,傳入的物件字面量裡完全沒有 `userId` 這個鍵——事實上這幾個 convenience wrapper 的**型別簽名本身就沒有 `userId` 欄位**(`falDispatcher.ts:727-738,758-767,783-788,801-808` 逐一核對,四個函式的 params interface 均無 `userId`)。

這些 wrapper 最終都呼叫核心函式 `dispatchFalTask`(`falDispatcher.ts:282`),其扣點/對帳邏輯是:
```ts
if (typeof input.userId === "number") {
  if (typeof input.estimatedCredits === "number") {
    await reconcileCredits(input.userId, input.estimatedCredits, actualCost);
  } else {
    await deductCredits(input.userId, actualCost);
  }
  ...
}
```
(`falDispatcher.ts:480-504`,降級重試分支同款邏輯見 :618-624)。由於 `userId` 從 `dispatchGenerationJob` 這一層就已經斷鏈,傳進 `dispatchFalTask` 的 `input.userId` **恆為 `undefined`**,`typeof input.userId === "number"` 恆為 `false`——整段扣點/reconcile 程式碼對這條路徑而言是**無法觸達的死碼**。

**錯誤結果**:任何透過圖圖(image-specialist)、音樂(music-specialist)、語音(voice-specialist)三位精靈的工具呼叫生成(`imageSpecialistTools.ts` 的 3 個生成函式、`musicSpecialistTools.ts` 音樂生成、`voiceSpecialistTools.ts` 語音生成),不論實際 fal.ai 花費多少推論成本,**使用者的點數餘額都不會被扣一分錢**。這不是競態、不是機率性缺口,而是型別簽名層級就切斷了 userId 傳遞路徑的結構性 bug,每次呼叫 100% 重現。K2 #7 曾推測「光球對話路徑的 orbQuota 記憶體 Map + 預設關閉旗標讓配額防護形同虛設」,但那條分析假設「至少有一層點數扣款存在、只是去重防護不足」——本次逐行追蹤發現這幾個精靈工具路徑的真相更嚴重:**點數扣款機制本身在程式碼層面就不存在傳遞路徑,不是「配額防護不足」而是「完全沒有計費」**。

**證據 path:line**:
- `server/services/generationJobDispatcher.ts:103-106`(`userId` 未解構)
- `server/services/generationJobDispatcher.ts:110-157`(四個 switch 分支呼叫,均無 userId)
- `server/services/falDispatcher.ts:727-930`(四個 convenience wrapper 的型別簽名均無 `userId` 欄位)
- `server/services/falDispatcher.ts:480-504,618-624`(`dispatchFalTask` 內被架空的扣點/reconcile 邏輯)
- `server/services/spiritTools/imageSpecialistTools.ts:67-68,130-131,191-192`(呼叫端確實有傳 `userId`,證明呼叫端「以為」會扣點)
- `server/services/spiritTools/musicSpecialistTools.ts:762-771`、`voiceSpecialistTools.ts:242-243`(同款呼叫模式)

---

### 2.【嚴重・新發現】`imageStudio.ts`(23 模型)與 `videoStudio.ts`(13+ 模型)的所有 mutation 完全沒有扣點呼叫——與 `proStudio.ts` 對照組不一致,且與既有文件記載矛盾

**觸發情境**:全文 grep `server/routers/imageStudio.ts`(1515 行)、`server/routers/videoStudio.ts`(1779 行)找 `deductUserPoints`/`deductUserQuota`/`chargeForFalTask`/`charge`/`Deduct` 等關鍵字,**零命中**。對照組 `server/routers/proStudio.ts` 在同款「fal queue 非同步派工」模式下,每個生成 mutation 開頭都呼叫 `chargeForFalTask(ctx.user.id, modelId, ...)`(先 `estimatePoints`→`deductUserPoints`→失敗回 `PAYMENT_REQUIRED`),失敗分支也都有對應的 `refundUserPoints`(proStudio.ts 全文 33 處呼叫)。imageStudio/videoStudio 的 `generationProcedure`/`videoGenerationProcedure` 中介層(`server/_core/trpc.ts:162-166,190-230`)只做**請求頻率限制**(5 次/分鐘、影片另加 50/hr+200/day+同時 5 個 concurrent job 上限),完全不觸碰 `users.remainingGenerations`。

client 端 `ImageStudio.tsx` 對這 23 個 mutation(`nanoBanana2`、`seedreamV4`、`imagen4`、`fluxKontext`……)直接 `.mutate()`(:3255-3282),沒有任何前置扣點檢查;`BackgroundTasksContext.submitTask`(呼叫 `generate.submitStudioJob` 建立 backgroundJob 記錄)裡唯一與費用相關的動作是 `accountant.estimate` 查詢——**純粹是 UI 警示卡片**(「這個動作大概會花 N 點」),不觸發任何實際扣款(`BackgroundTasksContext.tsx:503-518`)。

值得注意:`docs/research/H1-model-costs.md:19` 明確寫著「generate/imageStudio/videoStudio 同模式」,聲稱這兩個工作室與 `proStudio.chargeForFalTask` 走相同的扣點模式——**本次逐行核對後判定此為誤記**,imageStudio.ts/videoStudio.ts 實際上完全沒有這套扣款機制,H1 的說法與程式碼不符。

**錯誤結果**:透過圖片工作室(ImageStudio.tsx)和影片工作室(VideoStudio.tsx)頁面產生的所有生成——涵蓋 nano-banana 2/pro、SeeDream v4/v4.5/v5、Imagen4、Flux Kontext、SD 3.5、Kling v2.1、Wan v2.1、MiniMax Hailuo、Veo3、Sora、Runway Gen4 等平台上單價最高的模型群——**對使用者完全免費**,只受每分鐘 5 次的頻率限制與影片工作室額外的併發/日/時上限保護,沒有任何點數消耗。這是比雙重退款(K2 #1)更根本的營收缺口:不是「退太多」,是「從未收費」。

**證據 path:line**:
- `server/routers/imageStudio.ts`(全文 1515 行,grep `deductUserPoints|deductUserQuota|chargeForFalTask` 零命中)
- `server/routers/videoStudio.ts`(全文 1779 行,同樣零命中)
- `server/routers/proStudio.ts:67-75`(對照組 `chargeForFalTask` 定義,先扣點後送單)
- `server/_core/trpc.ts:162-166,190-230`(`generationProcedure`/`videoGenerationProcedure` 只做 rate limit,不扣點)
- `client/src/pages/ImageStudio.tsx:3255-3282`(23 個 mutation 直接呼叫,無前置扣點)
- `client/src/contexts/BackgroundTasksContext.tsx:503-518`(`accountant.estimate` 僅供 UI 警示,非實際扣款)
- `docs/research/H1-model-costs.md:19`(既有文件誤記兩者「同模式」,本次予以更正)

---

### 3.【嚴重・新發現・坐實 K2 #7 推測】`agentToolExecutor.ts` 的 15 個 `GENERATION_SLOT_TOOLS`(光球精靈 orb 對話生成入口)透過 `dispatchFalQueueTask` 生成,同樣完全沒有扣點呼叫

**觸發情境**:`server/services/agentToolExecutor.ts` 是光球(orb)15 位精靈工具呼叫的核心執行器,`GENERATION_SLOT_TOOLS`(:15-31)列出 15 個會觸發 fal.ai 生成的工具名(`studio.generateImage`/`generateVideo`/`generateAudio`/`generateVoice`/`generate3D`/`trainLora` 等)。全文 grep `agentToolExecutor.ts` 找 `Points|Credit|remainingGenerations|estimatePoints|orbCostGuard`,**唯一命中是 `budgetPoints`(:4843,只是讀取使用者傳入的參數名,非扣款呼叫)**,零扣款函式呼叫。

`ai.ts`(光球對話 router)呼叫 `executeOrbToolCalls`(:3032)時同樣沒有任何扣點包裝。**唯一的「成本控制」是 `checkAndConsumeQuota("generation", { userId })`(:1016,來自 `orbQuota.ts`)——這是純記憶體 Map 計數器,K2 #7 已指出其守護旗標 `ENABLE_ORB_QUOTA_GUARD` 預設關閉(`02-fullstack.md` §9.3)**。本次逐行核對確認:即使該旗標打開,`checkAndConsumeQuota`/`orbQuota.ts` 全文同樣沒有任何一行碰觸 `users.remainingGenerations` 或呼叫 `deductUserPoints`——它是純粹的「次數計數器」,從未、也無法轉換成金錢扣款。

這條路徑(`agentToolExecutor.ts` 內對 `studio.generateImage` 等工具的 inline 實作,見 :1131-1160 `runFalWithRecovery` 包裝 `dispatchFalQueueTask`)與發現 #1(`generationJobDispatcher.ts`)是**兩套獨立的執行路徑**——同樣是圖圖/影影等精靈的生成工具,可能因呼叫框架版本不同而走不同程式碼(一個用 `dispatchGenerationJob`,一個用 `agentToolExecutor.ts` 自己的 inline 邏輯),但**兩條路徑殊途同歸:都不扣點**。

**錯誤結果**:光球對話介面(使用者直接跟 15 位精靈聊天觸發的生成,產品文件宣傳的核心互動模式)在當前預設組態下,對所有圖片/影片/音訊/語音/3D/LoRA 訓練生成**完全免費且無軟性節流**(quota guard 預設關閉);即使打開該旗標,充其量也只是「每人每天 N 次」的次數上限,與實際模型單價(Veo3 Pro/Sora 級 vs SDXL 級可差數十倍)完全脫鉤——重度使用者可以整天用光球精靈狂刷 Sora/Veo3 等頂級模型,一分錢不用付。

**證據 path:line**:
- `server/services/agentToolExecutor.ts`(全文 grep `Points|Credit` 僅命中 :4843 的 `budgetPoints` 參數名,非扣款)
- `server/services/agentToolExecutor.ts:15-31`(`GENERATION_SLOT_TOOLS` 15 個工具清單)
- `server/services/agentToolExecutor.ts:1016`(唯一成本控制:`checkAndConsumeQuota("generation", ...)`)
- `server/services/orbQuota.ts`(全文 grep `Points|Credit` 零命中,純計數器)
- `server/routers/ai.ts:3032`(`executeOrbToolCalls` 呼叫點,無扣點包裝)
- 對照:K2 #7(推測配額防護不足)、本條為坐實「防護不只不足,是根本不存在扣款機制」

---

### 4.【高・新發現】`dispatchFalQueueTask` 的 submit 降級鏈成功時,實際使用的 modelId 在 `imageStudio.ts`/`videoStudio.ts` 的 wrapper 中被丟棄——導致後續輪詢查詢錯誤的模型 namespace,永久 404

**觸發情境**:`dispatchFalQueueTask`(`falDispatcher.ts:979-1263`)的 Step 2(:1146-1184)在主模型 submit 失敗(5xx/429/網路錯誤)時會遍歷 `submitCandidates`(fallback chain)逐一嘗試,命中後把 `targetModelId` 更新為實際成功的候選模型並標記 `degraded=true`、`originalModel`(:1162-1173),回傳物件 `FalQueueDispatchResult` 正確帶有這個「實際 modelId」(:1251-1262)。

但呼叫端 `imageStudio.ts` 的 `falQueueSubmit`(:119-152)與 `videoStudio.ts` 的同名函式(:65-108)都是這樣處理回傳值的:
```ts
const result = await dispatchFalQueueTask({ modelId, input, webhookUrl, route, modality });
return { request_id: result.request_id };  // ← 只取 request_id,result.modelId 被丟棄
```
再往上一層,`falQueueRun`(imageStudio.ts:302-310)把**呼叫端原本要求的 `modelId`**(不是 `dispatchFalQueueTask` 實際使用的降級後模型)包成 `raw_model_id` 回傳給前端。前端後續呼叫 `checkImageStatus`/`checkVideoStatus`(帶著這個錯誤的 `modelId`)時,`falQueueFetchWithPrefixFallback`(`falQueueClient.ts:21-46`)的容錯機制只會「對同一個 modelId 字串逐段去尾」嘗試,**它完全不知道 fal.ai 這個 request_id 實際上屬於另一個完全不同的模型 namespace**(降級鏈候選可能是同分類下完全不同的 provider,例如從 `nano-banana-2` 降到 `flux-pro/v1.1`)。

**錯誤結果**:當且僅當「使用者選定模型的 submit 呼叫暫時失敗、降級鏈救回」這個分支觸發時(5xx/429/網路抖動、或目錄裡 `disabled` 模型),前端後續所有狀態輪詢(`checkImageStatus`/`checkVideoStatus`)永遠查詢錯誤的模型路徑,得到 404/405,使用者的生成任務**永久卡在「處理中」直到前端或 `staleJobChecker` 判定逾時**——即使 fal.ai 那邊實際上已經用降級後的模型成功產出結果。此為 K2 遺留追蹤項「`falDispatcher.ts` 降級鏈重試次數與 `reconcileCredits` 的交互…留待下一輪」的延伸與具體化,但發現的實際 bug 是「輪詢路徑斷鏈」而非退款覆蓋問題(imageStudio/videoStudio 本身不扣點,見 #2,故此路徑無金錢損失,但使用者體驗上是「生成憑空消失」)。

**證據 path:line**:
- `server/services/falDispatcher.ts:1146-1184`(submit fallback 迴圈,`targetModelId` 正確更新)
- `server/services/falDispatcher.ts:1251-1262`(回傳值正確帶降級後 modelId)
- `server/routers/imageStudio.ts:119-152`(`falQueueSubmit` 只回傳 `request_id`)
- `server/routers/imageStudio.ts:302-310`(`falQueueRun` 用原始 `modelId` 而非 `result.modelId` 包 `raw_model_id`)
- `server/routers/videoStudio.ts:65-108`(同款 wrapper,同款問題)
- `server/services/falQueueClient.ts:21-46`(`falQueueFetchWithPrefixFallback` 僅對「同一 modelId 逐段去尾」有效,不知道真正降級後的不同模型)
- 對照:`server/services/spiritTools/videoSpecialistTools.ts:191-201` 的 `submitAndAwait` 正確使用 `submitted.modelId`(降級後的真實值)——證明「正確傳遞」的寫法在同一個 repo 裡確實存在,imageStudio/videoStudio 只是沒有照做

---

### 5.【中高・新發現】webhookFal 的 request_id 反查路徑存在建立時序競態——先送 fal、後建 backgroundJob 的流程,若 webhook 搶先抵達會被無條件丟棄且永不重送

**觸發情境**:`imageStudio`/`videoStudio`/`proStudio` 部分入口(無法在送 fal 前預先取得 jobId)採「先送 fal.ai queue、取得 request_id→前端再呼叫 `generate.submitStudioJob` 建立 `backgroundJobs` 記錄」的兩段式流程(`server/db.ts:2260-2264` 註解明確描述此設計)。webhookFal.ts 對這類「URL 沒帶 `?jobId=`」的回呼,唯一的 jobId 解析手段是 `findProcessingJobByRequestId(payload.request_id)`(:182-190),其 SQL 條件精確要求 `status = "processing"` 且 `resultJson.requestId` 完全比對(`server/db.ts:2268-2283`)。

若 fal.ai(對快速模型,例如 fast-sdxl 這類 1-2 秒完成的圖片模型,或使用者網路延遲導致 `submitStudioJob` 這第二次 round-trip較慢)在 `submitStudioJob` 的 INSERT 完成**之前**就送達 webhook,`findProcessingJobByRequestId` 查無此列(表裡根本還沒有這筆 backgroundJob),`extractJobId` 全部手段都失敗,handler 只印一行 `console.warn("[WebhookFal] Cannot resolve jobId...")` 就直接 `return`(:191-196)——**這個 webhook 事件永久遺失**,fal.ai 不會重送(已經回過 200)。等 `submitStudioJob` 之後才建立 backgroundJob,該 job 完全沒有機會再收到這次遺失的 OK/ERROR 通知,只能靠使用者持續留在頁面上的輪詢(`checkStudioJob`,`generate.ts:2176`)或 30 分鐘後被動 timeout / `staleJobChecker` 5-10 分鐘後標記失敗來收尾。

**與 K2 #3 的複合效應**:`proStudio.ts:114-115` 明確自陳多個音訊/語音端點就是走這條「先送 fal、後建 job」流程(`chargeForFalTask` 先扣點,再 `dispatchFalQueueTask`,再由前端 `submitStudioJob` 補建 job)。這代表:**若使用者在送出付費的音訊/語音生成請求後立刻關閉分頁或網路中斷(第二段 round-trip 沒完成),且此時 fal.ai 剛好在這個窗口內送達 ERROR webhook**,該筆已扣點的失敗任務的自動退款觸發點(webhook 的 `refundJobIfBilled` 呼叫,`webhookFal.ts:338`)完全不會執行——最終只能靠 K2 #3 已證實「從不退款」的 `staleJobChecker` 把它標成 failed,使用者的點數永久遺失,且沒有任何日誌記錄這是「webhook 遺失」而非「單純逾時」,問題根因難以追查。

**證據 path:line**:
- `server/db.ts:2260-2283`(`findProcessingJobByRequestId` 要求精確 `status="processing"`,並自陳此設計是為了配合「先送 fal 後建 job」流程)
- `server/routes/webhookFal.ts:181-196`(反查失敗即靜默丟棄,無重試/無 DLQ/無稽核旗標)
- `server/routers/proStudio.ts:114-118`(`chargeForFalTask` 先扣點,`webhookUrl` 用 fnonce 而非 jobId,證實此為「先扣點才建 job」的路徑)
- 交叉引用:K2 #3(`staleJobChecker` 從不退款)——本條找到的是「webhook 本可自動退款,但因建立時序競態而遺失」這個**額外放大 K2 #3 命中率**的新機制

---

### 6.【高・新發現】`falQueueAwaiter.awaitFalQueueResult` 未使用 `falQueueFetchWithPrefixFallback`——影影精靈工具鏈與 orb 工具鏈的輪詢會對已知路徑不對稱的模型永遠逾時

**觸發情境**:`server/services/falQueueClient.ts` 的檔案頭部說明(:1-16)明確記載一個已知、已修的 bug 類別:「fal 接受在 `fal-ai/imagen4/preview` 提交,但 queue tracking 卻路由到 `fal-ai/imagen4/...`,直接組 URL 查詢狀態會 405」,並提供 `falQueueFetchWithPrefixFallback` 做逐段去尾重試作為修復,`imageStudio.ts`/`videoStudio.ts`/`generate.ts` 的 `checkStudioJob` 都已改用此函式。

但 `server/services/falQueueAwaiter.ts` 的 `awaitFalQueueResult`(:145-249,供 orb agent 多步驟串接工具鏈使用,「等到真的有 URL 才回」)**完全沒有使用這個共用函式**,而是自己組裸 URL:
```ts
const statusUrl = `${FAL_QUEUE_BASE}/${modelId}/requests/${request_id}/status`;
const resultUrl = `${FAL_QUEUE_BASE}/${modelId}/requests/${request_id}`;
```
(:167-168)。輪詢迴圈把 404 當成「submit 後常見的暫態現象,直接放行繼續等」(:176-178 註解「404 right after submit happens in practice; ride through it」)——這代表對於**任何** submit/status 路徑不對稱的模型(正是 `falQueueClient.ts` 檔頭點名、kling-video 多段路徑、imagen4/preview 等),`awaitFalQueueResult` 會**每一輪都收到 404、每一輪都當成暫態忽略、無限重試直到外層 timeout**(預設 120s,`videoSpecialistTools.ts` 呼叫時設 300s),最終回傳 `{ status: "pending", error: "await timed out after ...ms" }`——即使 fal.ai 早已完成生成。

呼叫端 `server/services/spiritTools/videoSpecialistTools.ts:179-201`(影影精靈「等真正的影片 URL 才能串下一步」的核心 helper `submitAndAwait`)與 `server/services/agentToolExecutor.ts:128,154`(orb 工具鏈的圖片/3D 生成 await)都依賴這個函式。這代表:**影影精靈的多步驟工具鏈(例如「先生成影片→再對嘴/加音效」)一旦第一步選中一個路徑不對稱的模型(該分類的預設模型之一就是 `fal-ai/kling-video/v2.1/pro/*`,見 `02-fullstack.md` §1「四模態預設引擎」),整條鏈會在 300 秒後回報逾時失敗,即使 fal.ai 那邊實際上已經產出影片**。

**錯誤結果**:光球精靈的多步驟生成鏈(串接工具呼叫,依賴上一步輸出 URL 才能執行下一步)對特定模型族系會**系統性地假逾時失敗**——修復已經存在於同一個 repo(`falQueueClient.ts`),但沒有傳播到這個共用輪詢器,是「修過一次卻沒同步到姊妹模組」的典型缺口。

**證據 path:line**:
- `server/services/falQueueClient.ts:1-16`(檔頭記載已知 bug 與修復動機)
- `server/services/falQueueAwaiter.ts:167-168`(裸組 URL,不用 prefix fallback)
- `server/services/falQueueAwaiter.ts:176-178`(404 一律當暫態忽略)
- `server/services/spiritTools/videoSpecialistTools.ts:179-201`(影影精靈呼叫點,`waitTimeoutMs` 預設 300_000)
- `server/services/agentToolExecutor.ts:128,154`(orb 工具鏈呼叫點)

---

### 7.【中・新發現】`falRecoveryPolicy.runFalWithRecovery` 的重試計數器橫跨三種錯誤分類共用,與檔案自身文件宣稱的「三層獨立上限」不符

**觸發情境**:`falRecoveryPolicy.ts` 檔頭明確宣稱三層重試策略互相獨立:「transient 最多 3 次、content 最多 2 次、hard 最多 1 次」(:4-7)。但 `runFalWithRecovery`(:135-178)的實作用**單一** `attempt` 變數貫穿整個 `for` 迴圈(:152 `for (let attempt = 1; ; attempt++)`),不論這次失敗被分類成 `transient`/`content`/`hard` 哪一種,都用同一個遞增中的 `attempt` 去跟該分類的上限比較(`shouldRetry(kind, attempt, policy)`,:159-162)。

**錯誤結果**:當失敗序列在不同分類間切換時(例如:第 1 次 transient 逾時、第 2 次改判 content 拒絕、第 3 次又回到 transient),第 3 次的 `attempt=3` 去跟 `maxTransientRetries=3` 比較剛好壓線通過,但如果換成「第 1 次 hard、第 2 次 content、第 3 次又 hard」,第 3 次的 `shouldRetry("hard", 3, policy)` 會因為 `3 > maxHardRetries(1)` 而**提早放棄**,即使這其實只是第二次真正的 hard 失敗(尚未用完檔頭宣稱的獨立額度)。混合錯誤序列下,實際重試次數不等於文件宣稱的「各自 3/2/1 次」,而是取決於失敗類型切換的順序——這是邏輯與文件不一致的正確性 bug,會讓某些混合失敗模式下的自動恢復比預期更早放棄(`degraded=true` 或直接回傳失敗結果),使用者原本「應該還有一次重試額度」的容錯被提前用完。反向確認:此共用計數器機制不會造成無限重試(因為任一分類的上限都 ≤3,`attempt` 單調遞增,最多 4 輪左右必然全數超限跳出),所以**不存在「無限重試」風險**,純粹是「重試比承諾的少」的公平性/穩定性缺陷。

**證據 path:line**:
- `server/services/falRecoveryPolicy.ts:4-7`(檔頭宣稱三層獨立上限)
- `server/services/falRecoveryPolicy.ts:152`(單一共用 `attempt` 計數器)
- `server/services/falRecoveryPolicy.ts:159-162`(`shouldRetry` 用同一個 `attempt` 對照不同分類的獨立上限)

---

### 8.【中・新發現】`generationLock`(支援 Redis 跨 replica 的通用防重複提交鎖)只接在 `director.ts` 兩處,imageStudio/videoStudio/proStudio/generate.ts/agentToolExecutor.ts 完全沒有掛上

**觸發情境**:`server/_core/generationLock.ts` 是一個設計完整、文件詳盡的通用防重複提交鎖(:1-70 大段設計文件),明確定位為「generation entry points」(複數、通用)的雙擊/retry storm/並行 agent 步驟防護,且透過 `REDIS_URL` 可升級成跨 replica 生效(:26-40)。全 repo grep `generationLock` 的實際呼叫點(`.acquire`/`.release`)**只有 `server/routers/director.ts` 兩處**(:2121,2423 一組;:2799,3087 另一組),分別對應「批次分段生成」與「單一任務」兩個 director 專屬入口。

`imageStudio.ts`、`videoStudio.ts`、`proStudio.ts`、`generate.ts`(`multimodal` 同步與 `submitMultimodalAsync` 背景任務兩個入口)、`agentToolExecutor.ts`(光球精靈工具呼叫)**全部沒有 import 或呼叫 `generationLock`**。

**錯誤結果**:除了 director 的批次生成鏈,全站其餘所有生成入口(包含唯一「有完整扣點/退款邏輯」的 `generate.ts` multimodal/submitMultimodalAsync 與 `proStudio.ts`)都沒有這層雙擊/重送防護。使用者連點兩次生成按鈕、或多分頁同時對同一組參數送出(K2 #7 已從 orbQuota 記憶體 Map 角度討論過這個風險面,但那是針對光球對話路徑;本條指出的是**唯一具備正確計費邏輯的 `submitMultimodalAsync`/`proStudio` 路徑同樣沒有這層保護**,意味著若使用者雙擊,`deductUserPoints`/`chargeForFalTask` 會被呼叫兩次、產生兩個 backgroundJob、兩次真實 fal.ai 呼叫,兩者各自的失敗分支各自退款——不是 K2 #1 那種「同一個 job 退兩次」,而是「使用者被真實扣款兩次、且兩次都對應到真的生成任務」,這在使用者體感上是「我沒有點兩次,為什麼扣了兩次點數/生成了兩張」)。

**證據 path:line**:
- `server/_core/generationLock.ts:1-70`(設計文件,定位為通用「generation entry points」防護)
- `server/routers/director.ts:2113-2121,2423,2788-2799,3087`(唯二的實際呼叫點)
- `server/routers/generate.ts`、`imageStudio.ts`、`videoStudio.ts`、`proStudio.ts`、`server/services/agentToolExecutor.ts`(grep `generationLock` 零命中,全站其餘生成入口未接)

---

### 9.【中・新發現】`webhookReplicate.ts` 的 `succeeded` 分支缺少「URL 抽取失敗就不能標成功」防護——LoRA 模型可能永久卡在「ready 但無 weights URL」

**觸發情境**:`webhookFal.ts`(:254-275)與 `generate.ts` 的 `checkStudioJob`(:2284-2307)都有明確防護:「fal 回 COMPLETED/OK 但抽不到結果 URL,不可以標成功,要標失敗+退款」。但 `webhookReplicate.ts` 的 `succeeded` 分支(:135-156)沒有這道防護:
```ts
if (status === "succeeded") {
  const weightsUrl = extractWeightsUrl(payload.output);
  await updateFineTunedModel(modelId, {
    status: "ready",
    ...(weightsUrl ? { trainedLoraUrl: weightsUrl } : {}),
    ...
  });
  ...
  return;
}
```
`extractWeightsUrl`(:50-67)只認得三種 `output` shape(純字串、陣列首項字串或帶 `weights` 鍵、物件帶 `weights`/`url` 鍵);若 Replicate 回傳的 `output` shape 不在這三種之內(格式漂移,或訓練框架版本升級改了輸出結構),`weightsUrl` 為 `null`,則 `trainedLoraUrl` 這個鍵**整個被展開語法省略掉、不寫入**,但 `status` 仍然被寫成 `"ready"`(終態)。

而 `webhookReplicate.ts` 的終態短路守門(:115-120)明確擋掉任何後續 webhook(包含理論上格式正確的重送),於是這個模型永久卡在「`status="ready"` 但 `trainedLoraUrl` 是 `null`/未更新」的壞狀態——沒有 `errorMessage`、沒有 `failed` 狀態可觸發任何 UI 重試提示,使用者在「我的模型」列表看到這個 LoRA 顯示為「已就緒」,實際載入使用時才會發現沒有可用權重檔案。

**錯誤結果**:一旦 Replicate 端 `output` 格式輕微漂移(不需要整個 API 契約重寫,只要巢狀深一層或欄位改名),受影響的 LoRA 訓練會**靜默假成功**,且因為終態短路機制,沒有任何自動恢復路徑;如果 LoRA 訓練有預扣點數(需與 `loraTrainer`/`fineTunedModels` 扣款邏輯交叉確認,本次未深入該檔案,留待下一輪),這筆錢也不會走 `refundJobIfBilled` 一類的退款路徑,因為系統認定這是「成功」而非「失敗」。

**證據 path:line**:
- `server/routes/webhookReplicate.ts:135-156`(`succeeded` 分支,無 URL-missing 防護)
- `server/routes/webhookReplicate.ts:50-67`(`extractWeightsUrl` 只認三種 shape)
- `server/routes/webhookReplicate.ts:115-120`(終態短路,擋住任何後續補救)
- 對照:`server/routes/webhookFal.ts:254-275`、`server/routers/generate.ts:2284-2307`(同款「URL 缺失→標失敗+退款」的正確防護,證明修法在同 repo 已有先例,只是沒套用到 Replicate 這支)

---

### 10.【低中・新發現】`webhookSuno.ts` 的終態守門只保護終態,中間態(`text`/`first`)之間沒有單調遞增保護——進度條可能倒退

**觸發情境**:`webhookSuno.ts`(:174-183)的亂序防護明確只檢查 `job.status ∈ {completed, failed, cancelled}`(終態)才短路,對 `callbackType === "text"`(進度 30%,:186-196)與 `callbackType === "first"`(進度 70%,:197-207)這兩個中間態,**互相之間沒有任何順序/單調性檢查**——每次收到都直接 `updateBackgroundJob(jobId, { status: "processing", progress, ... })` 覆寫。檔案自己的註解(:170-173)承認「Suno 對同一任務連送 text→first→complete,但投遞不保證順序」,卻只把這個認知落實到終態守門,沒有延伸到中間態。

**錯誤結果**:若 `first`(70%)先於 `text`(30%)抵達(檔案自陳的亂序前提下完全可能發生),使用者會看到進度條從 70% 倒退回 30%,再往上爬向 100%——單純 UI/UX 缺陷,不影響金流或資產正確性,但與同檔案「已經意識到亂序問題」的自我認知不一致(修了一半)。

**證據 path:line**:
- `server/routes/webhookSuno.ts:170-183`(終態守門,只覆蓋三個終態)
- `server/routes/webhookSuno.ts:186-207`(`text`/`first` 中間態,互相無順序保護)

---

## 未查完部分(誠實聲明)

- **finding #9 的金錢面未完全坐實**:webhookReplicate.ts 的「假成功」bug 已用程式碼路徑百分之百確認會發生(只要 output shape 漂移),但 LoRA 訓練扣點/建 job 的完整鏈路(`loraTrainer.ts`/`server/routers/loraTrainer.ts` 或其對應檔案)本次未逐行讀,「這筆錢是否真的收不回來」需要下一輪針對該扣款鏈路單獨核對。
- **finding #1/#2/#3(全站三條零扣款路徑)彼此的相對規模未量測**:三條路徑(精靈 specialist tools、imageStudio/videoStudio、agentToolExecutor 的 GENERATION_SLOT_TOOLS)在生產流量中各自的呼叫佔比未知,無法從程式碼判斷「使用者主要從哪個入口在免費生成」,只能確認三者都是零扣款,無法排序何者造成的實際營收缺口更大。
- **`server/services/spiritTools/` 除 image/music/voice/video 四支以外,是否還有其他精靈(15 位中的其餘)也走 `dispatchGenerationJob` 或類似無 userId 傳遞的路徑**——本次只核對了這四支 specialist tools 檔案,15 位精靈的其餘工具實作(例如 3D/訓練類精靈)未逐一開檔確認是否有相同或不同的扣款缺口。
- **falRecoveryPolicy 的「相容層」API(`classifyFalFailure`/`isAdp2RetryEnabled`/`adp2BackoffMs` 等,:180-283)只讀過、未逐一核對其呼叫端**(標示為給早期版本呼叫端與測試用)是否也存在類似的計數器/退款交互問題,留待下一輪。
- **`webhookFal.ts`/`webhookSuno.ts` 的 HMAC/token 驗證邏輯本身(`_core/webhookTokens.ts`、`falJwks.ts`)已讀過設計文件並確認 fnonce 機制在「攻擊者需先取得 FAL_WEBHOOK_SECRET 或 JWT_SECRET」的前提下是合理的**,但未做實際的簽章繞過滲透測試(僅靜態推理),不排除有本次未發現的旁路。
- **`falQueueAwaiter.ts` finding #6 的實際觸發率未量測**——已確認機制上「用到路徑不對稱模型 + 走這條 awaiter」必然逾時,但生產環境中影影精靈實際選中這類模型的比例、以及使用者是否會真的走到「多步驟串接」這種需要等待 URL 解出的工具鏈場景,未做流量統計,無法評估影響面大小(架構上是 100% 命中,產品面命中率未知)。
