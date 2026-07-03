# W7 — webhook 路由(fal/replicate/suno)簽章驗證與計費安全網逐行深挖(逐檔深挖 wave W)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:webhookFal/Replicate/Suno.ts + webhooks.ts + webhookTokens.ts + webhookDispatcher.ts

## 結論先行:對核心問題的直接回答

**「W2/W5 講的『~20 條非同步生成失敗不退款』,webhook 安全網到底補不補?」**

**不成立 / 補不到。** 這是本輪逐行深挖最重要的發現(見發現 0)。webhook 安全網(`webhookFal.ts` 的 `refundJobIfBilled`)本身寫得很紮實 —— 簽章驗證、capability token、終態守門、CAS 退款鎖都到位 —— 但它的退款路徑**硬性要求 `backgroundJobs` 表裡有一筆對應的 job row(需要 `jobId`)**。W2/W5 揪出的那 ~20 個 `proStudio.checkAudioStatus` 家族端點(ElevenLabs/sonauto/ace-step 等非 Suno 音訊/影片/語音模型),送出 fal.ai 任務時**從未呼叫 `createBackgroundJob`**,全程只靠 `request_id` 直接對 fal.ai 查詢,不存在可退款的 job row。

更精確地說:這些端點的 `falQueueSubmit`(`proStudio.ts:107-142`)其實**有**簽 `fal:n:<nonce>` capability token、**有**把 `webhookUrl` 傳給 fal.ai(見下方程式碼),webhook 也**真的會抵達**、**真的會通過**簽章與 token 兩層驗證 —— 但因為找不到任何 `backgroundJob` 可以綁定,最終在 `webhookFal.ts:191-196` 靜默丟棄,`refundJobIfBilled` 從未被呼叫。也就是說,開發者在 `falQueueSubmit` 留的註解(「瀏覽器關閉時 webhookFal 會以 request_id 反查…不依賴前端輪詢」)**對這族端點是錯的假設** —— webhook 有到、有驗證通過,但沒有退款能力,因為根本沒有東西可以「反查」。

這與前端輪詢(`checkAudioStatus` 的 `FAILED` 分支,`proStudio.ts:1802-1817`)完全沒有退款呼叫的既有發現(W2 發現 1、W5 發現 1)是**同一個根因的兩種症狀**:整條 pipeline 從未建立可退款的 job 記錄。webhook 與輪詢兩條路徑都繞不過去,不是「輪詢沒補、webhook 有補」,而是**兩條路都補不到**。

---

## 發現 0(P0 · 本輪核心發現)webhook 安全網結構性地覆蓋不到 W2/W5 揪出的 ~20 個端點

**證據鏈:**

1. `proStudio.ts:107-142`(`falQueueSubmit`)—— 這是 `checkAudioStatus` 家族(sonauto/ace-step/ElevenLabs dubbing/TTS/sound-effects 等 ~20 個模型)提交任務的共用函式:
```
async function falQueueSubmit(...) {
  // 帶 fal.ai webhook 回呼，瀏覽器關閉時 webhookFal 會以 request_id 反查
  // resultJson.requestId 對應的 backgroundJob 並寫回結果（不依賴前端輪詢）。
  const falSigned = signFalWebhookNonce();
  const webhookUrl = siteUrl
    ? falSigned
      ? `${siteUrl}/api/webhook/fal?fnonce=${falSigned.nonce}&token=${falSigned.token}`
      : `${siteUrl}/api/webhook/fal`
    : undefined;
  ...
  const result = await dispatchFalQueueTask({ modelId, input, webhookUrl, ... });
  return { request_id: result.request_id };
}
```
   全檔(`server/routers/proStudio.ts`)搜尋 `createBackgroundJob`,只在 Suno 音樂流程(`generateMusicSuno`,約 2037-2078 行)出現一次 —— `checkAudioStatus` 覆蓋的其餘 ~20 個端點**完全沒有** `createBackgroundJob` 呼叫。

2. `webhookFal.ts:181-196` —— webhook 收到 payload 後解析 jobId 的邏輯:
```js
let jobId = extractJobId(req, payload);          // 找 ?jobId= query（這條流程沒帶，用的是 fnonce）
if (!jobId && payload.request_id) {
  const matched = await findProcessingJobByRequestId(payload.request_id);  // 反查 backgroundJobs，但這族任務從沒寫過
  if (matched?.id) jobId = matched.id;
}
if (!jobId) {
  console.warn(`[WebhookFal] Cannot resolve jobId for request_id=${payload.request_id}`);
  return;   // ← 靜默丟棄，refundJobIfBilled 從未被呼叫
}
```
   對這族端點而言,`extractJobId` 找不到 `?jobId=`(用的是 `fnonce`)、`findProcessingJobByRequestId` 也查不到任何 row(因為第 1 點已證明從未寫入),所以**每一次**都會落入 `if (!jobId) { ...; return; }`,在通過簽章 + token 驗證之後,於 DB 查詢這一步就被丟棄。

3. `proStudio.ts:1802-1817`(`checkAudioStatus` 的 `FAILED` 分支,W2 已指出)只是 `throw new TRPCError(...)`,同樣沒有 `refundJobIfBilled` / `refundUserPoints` 呼叫,且**這是使用者唯一會看到失敗狀態的路徑**(因為沒有 `backgroundJobs` row,沒有 SSE、沒有背景通知,只有前端輪詢這支 tRPC query 拋錯)。

**影響**:對這 ~20 個 ProStudio 非 Suno 音訊/影片/語音端點,`chargeForFalTask` 預扣點數後,無論任務最終是「fal 佇列判定 FAILED」還是「前端輪詢逾時關閉分頁」,都**沒有任何路徑會退款** —— webhook 到得了,認證過得了,但在「這是哪個 job」這一步斷鏈。這是**持續性、100% 發生**的缺口,不是併發競態,與 W5 發現 1 的結論完全一致,本輪從 webhook 端獨立驗證後坐實同一結論(而非重複發現 —— 本輪新增的資訊是:「webhook 確實有送達且通過認證,但因缺 job 綁定而在資料層斷鏈」,排除了「webhook 沒接線」或「webhook 認證失敗」這兩種其他可能解釋)。

**建議**:與 W5 建議一致 —— 最徹底的修法是讓這族端點在 `falQueueSubmit` 之前先 `createBackgroundJob`(拿到 `jobId` 後改用 `?jobId=` 簽 `fal:<jobId>` token,而非 `fnonce`),`checkAudioStatus` 的 `FAILED` 分支與 `webhookFal.ts` 的 ERROR 分支才有東西可以退。過渡期最小修補:至少讓 `checkAudioStatus` 的 `FAILED` 分支呼叫 `refundUserPoints`(但如 W5 所述會缺乏冪等鎖,優先做完整修法)。

---

## 發現 1(P1)`FAL_WEBHOOK_FAIL_CLOSED` 單一旗標同時鬆綁兩層獨立防禦,誤設可致 `/api/webhook/fal` 完全開放

`webhookFal.ts` 對外宣稱有「雙層防禦」:① Ed25519/HMAC 簽章驗證(`verifyFalSignature`,`webhookFal.ts:55-110`)② capability token(`verifyFalWebhookToken`,`webhookFal.ts:119-144`)。但兩層的 fail-closed 行為**共用同一個旗標** `isFalWebhookFailClosed()`(`webhookFal.ts:38-44`,對應 env `FAL_WEBHOOK_FAIL_CLOSED`,預設 `"true"`):

```js
// verifyFalWebhookToken（webhookFal.ts:119-144）
function verifyFalWebhookToken(req: Request): boolean {
  if (!isFalWebhookFailClosed()) return true;   // ← 旗標關 → 整個 token 檢查形同虛設
  ...
}

// verifyFalSignature 內部（webhookFal.ts:77-89）
const secret = serverEnv.FAL_WEBHOOK_SECRET;
if (!secret) {
  if (serverEnv.NODE_ENV === "production" && isFalWebhookFailClosed()) {
    return false;   // ← 同一旗標
  }
  return true;
}
```

若運維人員因為某個「緊急」理由(文件本身也稱其為「緊急人工決定」)把 `FAL_WEBHOOK_FAIL_CLOSED` 設為 `"false"`,且當下 `FAL_WEBHOOK_SECRET` 恰好未設定 —— 兩層防禦會**同時失效**:簽章檢查直接 `return true`(跳過),token 檢查也直接 `return true`(跳過)。此時 `/api/webhook/fal` 對任何人開放,攻擊者可用任意 `?jobId=<猜測的數字>` 加上 `status=OK` 與任意 `videoUrl`/`imageUrl`,把**別人的** job 標記為完成並帶入攻擊者控制的 URL(這正是 `webhookTokens.ts` 檔頭注解明確警告要防的攻擊情境),或用 `status=ERROR` 幫別人的還在跑的任務提早觸發退款。

**影響範圍**:僅在「該旗標被明確設為 false」且「FAL_WEBHOOK_SECRET 同時缺席」兩個條件同時成立時才會發生 —— 預設組態(旗標留空/true)下不受影響。但因為兩道獨立防線共用同一個開關,**「flip 一個旗標」就能讓 defense-in-depth 整層消失**,不符合縱深防禦應該互相獨立失效的設計原則。

**建議**:把 capability token 的 fail-closed 開關與簽章驗證的 fail-closed 開關拆成兩個獨立旗標(或至少讓 token 檢查不受 `FAL_WEBHOOK_FAIL_CLOSED` 影響,只靠 `isWebhookTokenEnforced()`/`JWT_SECRET` 是否配置來決定),避免單一組態失誤同時打開兩道門。

---

## 發現 2(P1)`JWT_SECRET` 缺失在 production 只是 `console.warn`,不是硬性啟動失敗 —— Suno/Replicate webhook 在此情境下完全無驗證

`server/_core/env.validated.ts:743-751`(`validateAndWarn`)在 zod 解析失敗時只印警告、用空值預設繼續執行;`JWT_SECRET` 僅出現在 `coreWarnings` 清單(`env.validated.ts:762-767`),缺失時只 `console.warn`,**不會阻止伺服器啟動**。

`webhookTokens.ts:61-63` 的 `isWebhookTokenEnforced()`:
```js
export function isWebhookTokenEnforced(): boolean {
  return getSecret() !== null;   // getSecret() 在 JWT_SECRET 未設或長度<8 時回 null
}
```
`verifyWebhookToken`(`webhookTokens.ts:103-112`):
```js
export function verifyWebhookToken(scope, id, token): boolean {
  const expected = computeToken(scope, id);
  if (expected === null) return true;   // ← JWT_SECRET 缺席 → 無條件放行，不比對 token 內容
  ...
}
```
`webhookReplicate.ts`(全檔沒有任何 provider 端簽章驗證,只有 `verifyWebhookToken("replicate", modelId, token)`,`webhookReplicate.ts:96-103`)與 `webhookSuno.ts`(同樣只有 `verifyWebhookToken("suno", jobId, token)`,`webhookSuno.ts:151-162`,檔頭注解自陳「Suno (apibox.erweima.ai) 沒有文件化的簽章機制」)**都只靠這一層 capability token 防禦,沒有像 fal 一樣的第二層 provider 簽章可退可守**。一旦 production 環境意外缺 `JWT_SECRET`(目前只是警告、不阻擋啟動),這兩個端點會變成**完全無驗證**:任何人都能用 `?modelId=<猜測整數>` 或 `?jobId=<猜測整數>` 加任意 `token` 值(甚至不帶 token),把別人的 LoRA 訓練或音樂生成標記為 ready/completed/failed,注入攻擊者控制的 weights/audio URL。

**影響**:嚴格說「production 一定會設 JWT_SECRET」是一個文件承諾(`webhookTokens.ts:19-21` 注解),不是程式碼保證的不變量 —— 目前的 `validateAndWarn` 設計本身就承認允許帶著缺失的核心密鑰跑起來(這也是 session/JWT 認證整體會壞掉的情境,故現實中自我限制風險發生機率較低,但不是程式碼層級的硬保證)。

**建議**:在 `NODE_ENV === "production"` 且 `JWT_SECRET` 缺失(或長度 < 8)時,考慮讓伺服器啟動失敗(hard fail)而非僅警告 —— 至少應讓 `isWebhookTokenEnforced()` 一類的安全關鍵旗標有獨立的 production 啟動檢查,不要依賴「JWT 認證本來就會壞掉所以有人會發現」這種間接訊號。

---

## 發現 3(P2)Replicate webhook 沒有驗證 provider 自己的簽章,只靠單層 capability token(已知設計取捨,目前無計費影響)

`webhookReplicate.ts` 全檔搜尋不到任何 `webhook-signature` / `svix` / HMAC 驗證 provider payload 真實性的程式碼 —— 檔頭注解(`webhookTokens.ts:12`)提到「Replicate has standard-webhooks signing」,但這條驗證**在 `webhookReplicate.ts` 裡沒有實作**,只在 `webhookReplicate.ts:96-103` 做 capability token 檢查。相較 fal(Ed25519 JWKS + HMAC 雙層),Replicate 只有單層防禦 —— 若 token 被洩漏(理論上,例如日誌意外印出完整 webhook URL,實際檢查 `loraTrainer.ts` 的 log 呼叫沒有印出完整 URL,只印 trainer/destination/steps,故目前未發現外洩管道),攻擊者可偽造任意 `succeeded`/`failed` payload、注入任意 `weights` URL 到 `trainedLoraUrl` —— 這正是 `webhookTokens.ts` 檔頭注解描述的攻擊情境本身。

**計費影響核對**:搜尋 `server/routers/loraTrainer.ts`、`server/services/loraTrainer.ts`、`server/subsystems/trainingTrack/trainingTrackService.ts` 全部找不到 `deductUserPoints`/`refundUserPoints`/`costPoints` 呼叫 —— **LoRA 訓練目前完全沒有點數計費**,因此 `webhookReplicate.ts` 沒有 `refundJobIfBilled` 呼叫並非缺口,而是「沒有東西要退」。

**建議**:若未來對 LoRA 訓練收費,務必同步補上 `refundJobIfBilled` 式的退款路徑;認證面則建議至少補上 Replicate 官方的 `webhook-id`/`webhook-timestamp`/`webhook-signature`(standard-webhooks / svix 格式)驗證作第二層防禦,不要單靠 capability token。

---

## 發現 4(P2)Suno webhook 同為單層 capability token 防禦(設計已知、有文件記錄,非新缺口)

`webhookSuno.ts:151-162` 同樣只有 capability token 檢查,無 provider 簽章可查(檔頭注解與 `webhookTokens.ts:12` 皆坦承 apibox.erweima.ai 無文件化簽章機制)。與發現 3 同構,風險同樣收斂於「JWT_SECRET 是否配置正確」(見發現 2)。Suno 音樂生成**確實有計費**(`chargeForFalTask`,`proStudio.ts:2088` 附近的 `generateMusicSuno` 流程),且該流程**有**建立 `backgroundJobs` row(是 W2/W5 都明確排除在「~20 個不退款端點」之外的例外流程),`webhookSuno.ts:210-226` 的無 clip 失敗分支也**有**呼叫 `refundJobIfBilled`(`webhookSuno.ts:224`)—— 這條退款路徑本身是成立的,只是認證強度是單層。

**建議**:與發現 3 相同 —— 認證面優先度較低(無 vendor 簽章可加,只能靠 JWT_SECRET 管控更嚴謹),重點仍是發現 2 的 JWT_SECRET 啟動期保證。

---

## 發現 5(P2)`runPostGenForJob` 的冪等旗標是「讀取後才寫入」,無 DB 層 CAS —— webhook 重複投遞可能造成資產庫/歷史重複寫入(非計費風險)

`postGenActions.ts:494-560`(`runPostGenForJob`)的防重放機制:
```js
export async function runPostGenForJob(jobId: number): Promise<boolean> {
  const job = await db.getBackgroundJob(jobId);
  const meta = (job.resultJson ?? {}) as Record<string, unknown>;
  if (meta.postGenComplete === true) return false;   // ← 檢查（非原子）
  ...
  await doPostGenComplete({ userId: job.userId, ... });  // 無 dedupeMarker（與輪詢路徑不同）
  ...
  await db.mergeBackgroundJobResultJson(jobId, { postGenComplete: true });  // ← 之後才寫入旗標
  return true;
}
```
「檢查旗標」與「寫入旗標」之間沒有 DB 層原子鎖(不像 `refundJobIfBilled` 用 `atomicClaimJobRefund` 的 `UPDATE ... WHERE NOT refunded` CAS,`db.ts:2160-2181`)。若同一 webhook 事件被 provider 重複投遞(fal.ai/Suno 對非 2xx 回應會重試,雖然本專案 always 立即回 200,但網路層仍可能重複送達),兩個併發請求都可能在寫入旗標之前讀到 `postGenComplete !== true`,導致 `doPostGenComplete` 執行兩次 —— 而 `runPostGenForJob` 呼叫 `doPostGenComplete` 時**沒有帶 `dedupeMarker`**(對照:輪詢路徑,如 `proStudio.ts:1770` 的 `checkAudioStatus`,有帶 `dedupeMarker` 以 `generation_history.compiledPrompt` 做存在性檢查去重;`doPostGenComplete` 內部只在 `dedupeMarker` 存在時才做這層去重,見 `postGenActions.ts:294-319`)。

**影響**:`digital_asset_library` 與 `generation_history` 可能出現重複列(同一次生成被記錄兩次),`prompt_library` 因走 `findOrCreatePromptByContent` upsert-by-content 邏輯而不受影響。**這不是計費/退款缺口** —— 實際扣款發生在任務提交當下(早於 webhook),`refundJobIfBilled` 有獨立且穩固的 CAS 鎖(見下方發現 6 佐證),此處重複寫入純屬資產/歷史紀錄的資料完整性問題,不影響使用者餘額。

**建議**:低優先。若要補強,可讓 `runPostGenForJob` 呼叫 `doPostGenComplete` 時帶入以 `jobId` 為主體的 `dedupeMarker`(例如 `[webhook:job:<jobId>]`),或把 `postGenComplete` 旗標寫入也改成 `atomicClaimJobRefund` 同款的 CAS `UPDATE ... WHERE postGenComplete IS NOT TRUE` 語意。

---

## 發現 6(佐證/資訊)計費 CAS 鎖與終態守門本身寫得紮實 —— 這部分「安全網」對已有 job 綁定的任務是可靠的

以下是本輪驗證後確認「沒問題」的部分,列出以避免讀者誤以為整份 webhook 安全網都不可靠:

- **`atomicClaimJobRefund`**(`db.ts:2160-2181`)是真正的 DB 層 CAS:`UPDATE background_jobs SET resultJson = JSON_SET(...) WHERE id = ? AND (resultJson IS NULL OR ... refunded != 'true')`,依賴 `affectedRows` 判斷「這次呼叫是否搶到鎖」,多條併發失敗路徑(webhook ERROR / polling FAILED / stale 超時)只有一條會真正退款。`postGenActions.refund.test.ts` 有併發測試驗證 3 個同時呼叫只退一次。
- **終態守門**在 `webhookFal.ts:204-217`(AIDV-注解未標號但邏輯清楚)、`webhookReplicate.ts:111-120`(AIDV-610)、`webhookSuno.ts:170-183`(AIDV-590)三處都一致:job/model 已是 `completed`/`failed`/`cancelled`(或 `ready`/`failed`)就直接 return,不重跑 post-gen、不重覆退款、不覆寫已完成結果 —— 對「同一任務的終態被重送」這種重放,三個 webhook 都有防護。
- **`mergeBackgroundJobResultJson`**(`db.ts:2190-2202`)用 `JSON_MERGE_PATCH` 而非整包覆寫,明確是為了避免 `doPostGenComplete`(標記 `postGenComplete`)與 `refundJobIfBilled`(標記 `refunded`)併發互踩、其中一個旗標被另一個的整包寫入蓋掉 —— 這個 race 已被正確處理。
- **`refundRestoreFailed`** 補寫機制(`postGenActions.ts:600-614`):CAS 搶到鎖後若 `refundUserPoints` 本身拋例外(錢包從未入帳),會補寫 `refundRestoreFailed: true`,`refundStatus.ts:97-102` 正確地把這種狀態降級顯示為 `not_refunded` 而非誤報「已退款」—— 不會讓使用者以為錢已經回來但其實沒有。

換句話說:**只要任務有走到 `createBackgroundJob` 這一步、有 `jobId`,webhook 安全網對它是可靠的**(簽章/token 驗證扎實、終態守門到位、退款 CAS 正確)。發現 0 描述的缺口不是這套機制設計得不好,而是**整整一族端點根本沒被接進這套機制**。

---

## 三、owner / 歸屬完整性驗證

檢查所有 `createBackgroundJob(...)` 呼叫點(`proStudio.ts:2052-2054`、`generate.ts:174-176,1895-1897,2154-2158`、`director.ts:2871-2872`、`models.ts:240-244,424-428`、`agentToolExecutor.ts:1444-1448,7645-7649`、`teachingArchiveIngest.ts:63-67`),**`userId` 一律來自伺服器端已驗證的 `ctx.user.id`(tRPC 認證 context)或等價的伺服器端變數,從未讀取任何請求體/webhook payload 欄位**。

`webhookFal.ts`/`webhookSuno.ts`/`webhookReplicate.ts` 讀取 `job.userId` 都是從既有 DB row(`getBackgroundJob(jobId)`/`getFineTunedModel(modelId)`)取得,webhook payload 本身**完全不影響**歸屬欄位 —— 攻擊者即使能通過認證打進某個 `jobId`,也只能改動該 job 的**結果**(URL/狀態),無法把 job 的 owner 改成別人或自己。真正的攻擊面因此收斂到「capability token 能不能被繞過猜中別人的 jobId」,這點已在發現 1、2 分析過(取決於 `JWT_SECRET`/`FAL_WEBHOOK_FAIL_CLOSED` 是否正確配置)。**結論:歸屬機制本身設計正確,唯一風險是認證層被繞過後的下游後果,而非歸屬邏輯本身有漏洞。**

---

## 四、注入 / SSRF 檢查

- **fal / Suno 的結果 URL**(`videoUrl`/`imageUrl`/`audioUrl`)一律經 `localizeResultUrls`(`internalMedia.ts:98-130`)→ `persistExternalMediaUrl`(`internalMedia.ts:53-88`):下載前呼叫 `assertSafeExternalUrl`(阻擋私網/loopback/IMDS 位址)、限制 10MB、`redirect: "error"`(阻擋 redirect 到內網)、下載後再用 `assertSafeMediaBytes` 驗證檔案內容(防止偽裝成媒體的可執行檔/HTML)。**這條路徑的 SSRF/注入防護是完整的。**
- **Replicate 的 `trainedLoraUrl`**(`webhookReplicate.ts:136-146`,`extractWeightsUrl`)**沒有**經過 `localizeResultUrls`/SSRF guard,原樣存進 DB。後續使用(`generate.ts:1739-1747,1786-1789`)是把這個 URL 當作 `loraUrl`/`path` 參數傳給 fal.ai API,**由 fal.ai 自己的伺服器去 fetch**,不是本專案伺服器直接請求 —— 因此不構成對本專案基礎設施的直接 SSRF,但仍是「讓平台成為跳板,誘使第三方(fal.ai)服務去 fetch 攻擊者指定 URL」的風險,且這正是 `webhookTokens.ts` 檔頭注解明文列出的攻擊情境之一。目前唯一的防線是 capability token(見發現 2、3)。
- **webhook payload 沒有被餵給任何 LLM**:三個 webhook handler 都只做 URL 抽取、狀態更新、SSE 推播,沒有把 payload 內容送進 prompt/LLM 呼叫鏈。

---

## 五、死碼 / 契約澄清

- **`webhookDispatcher.ts` 不是本文討論的「計費安全網」的一部分** —— 它是**對外**的創作者事件通知系統(`dispatchWebhookEvent`/`deliverDirectToSubscription`,`webhookDispatcher.ts:105-167`),在 `webhookFal.ts:269,304,339`(video.failed/video.completed)被呼叫,單純把「這個 job 完成/失敗了」這件事**通知使用者自己設定的第三方 URL**,不涉及退款/扣款邏輯本身。已確認接線正確:`server/routers/webhook.ts` 的訂閱管理端點皆有 `userId` 隔離查詢條件、`webhookDispatcher.ts:159`(`assertSafeExternalUrlAsync`)做 SSRF 防護、`buildSignature`(`webhookDispatcher.ts:21-23`)對外送出時做 HMAC 簽章、`redirect: "error"` 防止 redirect 繞過、有重試(`MAX_RETRIES=3`,指數退避)與 `webhook_delivery_history` 稽核紀錄。**沒有發現死碼或旗標鎖住的問題** —— 這是一套獨立、功能完整的模組,只是與「webhook 收到 provider 回呼後補退款」是兩件不同的事,任務描述把兩者放在同一稽核範圍內,此處特別澄清避免混淆。
- **`webhooks.ts`(`/api/webhooks/orb`)與計費/生成 webhook 完全無關** —— 是給 n8n/Zapier/Make 等外部自動化觸發 orb agent 任務的端點,用共用密鑰(`ORB_WEBHOOK_SECRET`)+ `timingSafeEqual` 比對(`webhooks.ts:19-24`)。已核對:密鑰為空字串時 `!expected` 為真,直接 401(fail-closed,非 fail-open),外加 rate limit(10 req/min,`webhooks.ts:26-31`)。此端點順帶稽核,未發現問題,僅在此註記其與 fal/replicate/suno 三個 provider webhook 及計費安全網無關,不應被誤解為同一套機制的一部分。

---

## 六、簽章驗證與 constant-time 比較彙總表

| 端點 | Provider 簽章驗證 | Capability token | timingSafeEqual | 缺 secret 時行為(prod) |
|---|---|---|---|---|
| `/api/webhook/fal` | Ed25519(JWKS)優先 + HMAC-SHA256 備援 | 有(`fal:<jobId>` 或 `fal:n:<nonce>`) | 是(`webhookFal.ts:106-109`、`webhookTokens.ts:111`) | fail-closed(`FAL_WEBHOOK_FAIL_CLOSED` 預設 true,見發現 1 的耦合風險) |
| `/api/webhook/replicate` | **無**(僅 capability token) | 有(`replicate:<modelId>`) | 是(`webhookTokens.ts:111`) | fail-open(依賴 `JWT_SECRET`,見發現 2) |
| `/api/webhook/suno` | **無**(vendor 無簽章機制,已知設計) | 有(`suno:<jobId>`) | 是(`webhookTokens.ts:111`) | fail-open(依賴 `JWT_SECRET`,見發現 2) |
| `/api/webhooks/orb`(不相關端點) | N/A(共用密鑰) | N/A | 是(`webhooks.ts:19-24`) | fail-closed(空字串必被拒) |

---

## 總結排序(依嚴重度)

1. **P0**(發現 0):webhook 安全網對 W2/W5 的 ~20 個 ProStudio 非 Suno 端點**完全補不到** —— webhook 有到、有驗證通過,但因這些任務從未建立 `backgroundJobs` row,`extractJobId`/`findProcessingJobByRequestId` 兩者都找不到綁定,靜默丟棄,`refundJobIfBilled` 從未執行。這是對任務核心問題的最終答案:**否,不成立**。
2. **P1**(發現 1):`FAL_WEBHOOK_FAIL_CLOSED` 單一旗標同時鬆綁簽章與 token 兩層防禦,建議拆開獨立控制。
3. **P1**(發現 2):`JWT_SECRET` 缺失在 production 只是警告不阻擋啟動,Suno/Replicate webhook 在此情境下無任何有效驗證,建議 production 啟動期加硬性檢查。
4. **P2**(發現 3、4):Replicate/Suno webhook 僅單層 capability token 防禦(無 vendor 簽章),Replicate 目前無計費故無退款影響;Suno 有計費且退款路徑成立,認證強度收斂於發現 2。
5. **P2**(發現 5):`runPostGenForJob` 冪等旗標非 DB 層 CAS,webhook 重複投遞可能造成資產庫/歷史重複寫入 —— 非計費風險,純資料完整性問題。
6. **佐證**(發現 6):已有 job 綁定的任務,退款 CAS 鎖、終態守門、`JSON_MERGE_PATCH` 併發保護皆確認落地紮實,不應被誤解為整體不可靠。
7. **契約澄清**(第五節):`webhookDispatcher.ts` 是對外創作者通知系統,非本文討論的「計費安全網」核心;`webhooks.ts` 的 `/api/webhooks/orb` 與 fal/replicate/suno 三個 provider webhook 無關,兩者皆已個別核對安全性,無死碼或旗標鎖死問題。
