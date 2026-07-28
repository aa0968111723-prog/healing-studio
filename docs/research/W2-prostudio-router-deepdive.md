# W2 — proStudio.ts 逐行深挖(逐檔深挖 wave W)
- 產生日期:2026-07-03
- 依據 commit:7b18b76f
- 稽核檔案:server/routers/proStudio.ts(2227 行)

---

## 總覽與嚴重度排序

本檔是 fal.ai 音訊/語音/影片模型的 tRPC router,共 31 個 procedure(6 個 query/publicProcedure,其餘皆為扣點 mutation)。逐行核對後,按嚴重度列出本次稽核最重要的發現:

| # | 嚴重度 | 一句話 | 檔案:行號 |
|---|--------|--------|-----------|
| 1 | **高** | `checkMusicSunoStatus` 對 `jobId`(遞增整數、可枚舉)完全沒有 owner 檢查,任何登入使用者可讀寫他人 `background_jobs` 記錄並觸發錯誤歸戶的資產落庫 | `proStudio.ts:2139-2224` + `server/db.ts:2141-2148,2204-2213` |
| 2 | **高** | 除 Suno 流程外,其餘約 20 個 fal.ai 非同步 mutation 的失敗輪詢路徑(`checkAudioStatus` 的 `FAILED`/`TIMEOUT` 分支)**完全沒有退款呼叫**,已扣點數在生成失敗後永久遺失 | `proStudio.ts:1697-1706,1802-1817` |
| 3 | **中高** | Sonauto 音樂模型的計費依 `input.duration`/`targetDurationSec` 估點,但 Sonauto API 本身「沒有 duration 參數」(檔案自己的文件如此聲明),使用者可故意填最小值來壓低點數但拿到完整歌曲 | `proStudio.ts:30-34,586-588,1899` |
| 4 | **中** | `jobStatus`/`jobResult`/`checkAudioStatus` 直接把使用者提供的 `request_id` 拿去查 fal.ai 結果,沒有任何 DB 層級的「這個 request_id 屬於我」檢查,僅靠 opaque ID 保密 | `proStudio.ts:1646-1675,1688-1820` |
| 5 | **低中** | SSRF allowlist(`safeMediaUrl`)只套用在 3 個欄位,其餘 ~15 個使用者提供的 `audio_url`/`image_url`/`video_url` 欄位仍是裸 `z.string().url()` | 見下方清單 |
| 6 | **低** | `dubbing` 缺少其餘 5 個 ElevenLabs 端點都有的「缺 API Key 提早報錯」防護,體驗不一致且更容易撞上發現 #2 的退款缺口 | `proStudio.ts:1536-1572` |
| 7 | **低** | 3 個 procedure(`qwenCloneVoice`、`jobResult`、`compiledTextToMusic`,含 167 行 AudioCompiler 對接邏輯)在目前 client 程式碼中找不到任何呼叫點,屬死碼/未上線功能 | `proStudio.ts:984-1004,1658-1675,1832-1999` |
| 8 | **低** | `falQueueRun`(檔內自定義的 queue 輔助函式)整個檔案沒有任何呼叫點 | `proStudio.ts:301-309` |

以下依「計費/退款」「owner/授權」「注入面」「持久化」「死碼/契約不符」分節詳述,每項附「發現 → 影響 → 建議」。

---

## 一、計費/退款正確性

### 1.1〔高〕非 Suno 的非同步任務失敗時沒有退款路徑

**發現**

`chargeForFalTask`(`proStudio.ts:67-81`)在送出 fal.ai queue 任務**前**扣點:

```ts
async function chargeForFalTask(...): Promise<number> {
  const estimate = estimatePoints(modelId, params);
  const result = await deductUserPoints(userId, estimate.totalPoints);
  if (!result.success) { throw new TRPCError({ code: "PAYMENT_REQUIRED", ... }); }
  return estimate.totalPoints;
}
```

每個 mutation(`textToMusic`、`soundEffects`、`elevenLabsTTS`、`qwenTTS`、`demucs`、`audioIsolation`、`mergeAudios`、`voiceChanger`、`speechToText`、`speechToVideo`、`echoMimic`、`stableAvatar`、`dubbing`、`longcatAvatar`、`ltxAudioToVideo` 等,共 ~20 個)都遵循同一骨架:

```ts
const charged = await chargeForFalTask(ctx.user.id, modelId, {...});
try {
  const { request_id } = await falQueueSubmit(modelId, payload);
  return { request_id, ..., estimated_credits: charged };
} catch (err) {
  await refundUserPoints(ctx.user.id, charged);
  throw err;
}
```

這個 `catch` **只覆蓋「送出 fal queue 任務」這個同步呼叫失敗**的情況(例如 fal.ai 立即回 4xx/5xx、網路錯誤)。一旦 `falQueueSubmit` 成功回傳 `request_id`(任務已排入 fal.ai 佇列),後續任務本身是否成功完全交給前端輪詢的 `checkAudioStatus`(`proStudio.ts:1688-1820`)處理。但該 procedure 的失敗分支:

```ts
// proStudio.ts:1802-1817
if (s === "FAILED") {
  const errMsg = status?.error ?? status?.message ?? "未知錯誤";
  recordErrorTrace({ ... });
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `任務失敗 [${input.model}]: ${errMsg}`,
  });
}
```

以及逾時分支:

```ts
// proStudio.ts:1697-1706
if (input.submittedAt) {
  const elapsed = Date.now() - input.submittedAt;
  if (elapsed > BACKGROUND_TASK_TIMEOUT_MS) {
    throw new TRPCError({ code: "TIMEOUT", ... });
  }
}
```

**兩者都只是拋錯,沒有任何 `refundUserPoints` / `refundJobIfBilled` 呼叫。** 對照同檔案內的 Suno 流程(`generateMusicSuno`,`proStudio.ts:2014-2134`),該流程明確用 `atomicClaimJobRefund` 做 CAS 退款鎖,並在自己的失敗分支呼叫 `refundUserPoints`(`proStudio.ts:2125-2131`)——說明作者其實知道「非同步任務失敗要退款」這件事,只是沒有把同樣的處理套用到 `checkAudioStatus` 涵蓋的其餘 20 個模型上。

這個缺口在架構上還有一個放大因素(經交叉核對 `server/routes/webhookFal.ts` 與前端 `client/src/contexts/BackgroundTasksContext.tsx` 確認,**非本檔案範圍但直接影響本檔案的退款保底機制**):`webhookFal.ts:176-190` 的註解明確寫著「imageStudio / proStudio 流程:先送 fal、後由前端 submitStudioJob 建 backgroundJob」——也就是說,webhook 驅動的 `refundJobIfBilled` 安全網,依賴前端在 `falQueueSubmit` 回傳後,另外呼叫一次 `generate.submitStudioJob`(經 `useSubmitGeneration.ts:100-121` → `BackgroundTasksContext.tsx` 的 `registerBgTask`/`submitTask`,是 **fire-and-forget、不等待**的呼叫)才會建立 `background_jobs` 記錄。若這次 fire-and-forget 呼叫失敗、race 輸給 webhook,或使用者關閉分頁,webhook 就找不到對應 job(`webhookFal.ts:191-195` 的 `Cannot resolve jobId` 分支),連保底退款都不會發生。而 `checkAudioStatus` 本身完全不建立 `background_jobs`(全檔案搜尋確認只有 `generateMusicSuno` 呼叫 `createBackgroundJob`),所以一旦這條路徑失效,使用者扣的點數沒有任何機制找回。

**影響**

- 對使用者:凡是透過 `checkAudioStatus` 輪詢的 ~20 個模型(音樂/音效/TTS/聲音克隆/ASR/配音/頭像影片等),只要任務**送出成功但執行失敗**(fal.ai 模型出錯、上游 429/500、內容審核拒絕等常見情境),扣的點數不會退回。
- 對業務:這類失敗在生產環境中並不罕見(第三方模型可用性、輸入格式邊界情況),長期會造成使用者投訴與信任流失,且稽核上難以追蹤「這筆錢去哪了」。

**建議**

- 在 `checkAudioStatus` 的 `FAILED` 與 `TIMEOUT` 分支補上退款呼叫,做法可仿照 `generateMusicSuno`:讓 `chargeForFalTask` 回傳的 `charged` 點數與某個冪等退款鎖(例如比照 `atomicClaimJobRefund`,但綁定在 `request_id` 而非 `jobId`,或強制所有 fal 任務都先 `createBackgroundJob` 再送出)綁定,避免同一失敗被 webhook + 輪詢雙重退款。
- 或者:把「先送 fal、後 registerBgTask」的順序反過來,在 `proStudio.ts` 內部先建立 `background_jobs`(拿到 `jobId`)才呼叫 `falQueueSubmit`,讓 webhook 安全網一開始就保證存在,不必依賴前端額外呼叫。

---

### 1.2〔中高〕Sonauto 音樂計費依「模型不支援的 duration」估點

**發現**

檔案開頭的 API 對接注意事項明確寫著(`proStudio.ts:30-34`):

```
5. Sonauto (sonauto/v2/text-to-music)
   - 歌詞參數名稱:lyrics_prompt(不是 lyrics)
   - 沒有 duration 參數;tags 是陣列而非字串
```

但 `textToMusic` 的 sonauto 分支(`proStudio.ts:547-601`)在建構送往 fal.ai 的 `payload` 時,確實沒有放入任何 duration/seconds 欄位(`payload` 只有 `prompt`/`tags`/`lyrics_prompt`/`bpm`/`output_format`/`num_songs`,見 548-583 行);但緊接著的計費呼叫卻是:

```ts
// proStudio.ts:585-588
const falModelId = "fal-ai/sonauto";
const charged = await chargeForFalTask(ctx.user.id, falModelId, {
  durationSec: input.duration ?? 60,
});
```

而 `input.duration` 的 zod 定義(`proStudio.ts:530`)是 `z.number().min(1).max(300).optional()`——使用者可以自由傳 `duration: 1`。`compiledTextToMusic` 的 sonauto 分支(`proStudio.ts:1879-1916`)有完全相同的問題:`durationSec` 拿去估點(1899 行),但送往 fal.ai 的 `payload` 同樣沒有帶 duration/seconds(1880-1897 行)。

**影響**

- 若 `estimatePoints` 對 sonauto 的計價公式含有「按秒數」的乘數(未在本檔驗證,需查 `server/services/modelPricing.ts` 對 `fal-ai/sonauto` 的定價項),使用者只要在請求時把 `duration` 填到最小值 1,就能用最低點數換到一首完整的 Sonauto 歌曲(Sonauto 本身固定生成完整長度、不受此參數影響)。這是一個對使用者可見、可重複操作的低成本套利路徑。
- 即使 `estimatePoints` 對 sonauto 目前是固定/不隨 duration 變動的定價(需另查 modelPricing.ts 確認),這段程式碼本身仍是「把一個模型不支援、不影響實際成本的參數,用來決定帳單金額」的邏輯錯誤,屬於未來維護者容易誤改出真正漏洞的地雷。

**建議**

- 移除 `chargeForFalTask` 呼叫中 sonauto 分支的 `durationSec: input.duration ?? 60`,改用固定的預估時長常數(例如按 Sonauto 官方文件的典型輸出長度),與 `payload` 實際送出的欄位保持一致。
- 在 `estimatePoints`(`server/services/modelPricing.ts`)確認 `fal-ai/sonauto` 的定價項是否真的吃 `durationSec` 參數;若有,應優先修正計價公式或直接用固定 base price。

---

### 1.3〔資訊〕本檔案內「先扣點、後送出、失敗即退款」的順序本身是正確的

逐一核對全部 20+ 個扣點 mutation,`chargeForFalTask` 皆在 `falQueueSubmit`/`falRun` **之前**呼叫,且 `payload` 組裝完成後才扣點(例如 `proStudio.ts:586,613,635,658,713,732,762` 等),沒有發現「先送出生成、後扣點」的時序錯誤,也沒有發現任何 mutation 略過扣點直接呼叫 `falQueueSubmit` 的免費繞過路徑。`qwenCloneAndSpeak`(`proStudio.ts:1011-1084`)的兩段式扣款(clone 與 TTS 各自獨立扣點/退款)邏輯也正確:clone 失敗只退 `cloneCharged`(1049,1055 行),TTS 失敗只退 `ttsCharged`(1081 行),不會誤退對方階段已消耗的點數,也不會雙退。

`generateMusicSuno`(`proStudio.ts:2014-2134`)的退款設計是全檔最嚴謹的一段:`createBackgroundJob` 失敗時直接退款(2075 行,並在註解中說明此時無 `jobId`、與下方路徑互斥不會雙退);`suno.generateMusic` 失敗時改用 `atomicClaimJobRefund` 做 CAS 搶鎖再退款(2125-2131 行),明確是為了與 `webhookSuno`/`stale job` 路徑的 `refundJobIfBilled` 互斥、防雙退。**這也反過來凸顯發現 1.1——這種嚴謹度沒有被套用到其餘 20 個模型上,是一致性缺口而非能力缺口。**

---

## 二、Owner / 授權檢查

### 2.1〔高〕`checkMusicSunoStatus` 對 `jobId` 沒有 owner 檢查(IDOR)

**發現**

`checkMusicSunoStatus`(`proStudio.ts:2139-2224`)的輸入只驗證型別,不驗證擁有權:

```ts
// proStudio.ts:2140-2145
.input(
  z.object({
    taskId: z.string().min(1),
    jobId: z.number().optional(),
  })
)
```

當帶入 `jobId` 時,直接讀寫該 job,完全沒有比對 `existing.userId === ctx.user.id`:

```ts
// proStudio.ts:2181-2210(節錄)
if (input.jobId) {
  const { updateBackgroundJob, getBackgroundJob } = await import("../db");
  const existing = await getBackgroundJob(input.jobId);
  const existingMeta = (existing?.resultJson ?? {}) as Record<string, unknown>;
  await updateBackgroundJob(input.jobId, {
    status: "completed",
    progress: 100,
    resultJson: { ...existingMeta, ...localized, studioType: "audio",
      sourceStudio: "pro", modelId: "suno", resultUrl: localized.audioUrl, mediaType: "audio" } as any,
  });
  const { runPostGenForJob } = await import("../services/postGenActions.js");
  void runPostGenForJob(input.jobId);
}
```

已核對 `server/db.ts` 的底層實作,兩者都**不帶 `userId` 過濟**:

```ts
// server/db.ts:2141-2148
export async function updateBackgroundJob(id: number, data: Partial<InsertBackgroundJob>) {
  const db = await getDb();
  if (!db) return;
  await db.update(backgroundJobs).set(data).where(eq(backgroundJobs.id, id));
}

// server/db.ts:2204-2213
export async function getBackgroundJob(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id)).limit(1);
  return result[0];
}
```

且 `createBackgroundJob`(`server/db.ts:2134-2138`)用的是 `db.insert(...).values(data); return result[0].insertId;`——標準自增整數主鍵,**非高熵 UUID,可被枚舉猜測**。

進一步核對 `runPostGenForJob`(`server/services/postGenActions.ts:494-560`)的資產歸戶邏輯,用的是 `job.userId`(即目標 job 的原始擁有者,而非呼叫者 `ctx.user.id`,見 `postGenActions.ts:494-538` 中的 `await doPostGenComplete({ userId: job.userId, ..., resultUrl, ... })`)。組合起來,攻擊情境是:

1. 攻擊者建立自己的 Suno 任務,取得自己的 `taskId`。
2. 攻擊者呼叫 `checkMusicSunoStatus({ taskId: 自己的taskId, jobId: 猜測/枚舉出的他人 jobId })`。
3. 若目標 `jobId` 當下仍是 `processing` 狀態(尚未被 webhook 標成終態、`postGenComplete` 尚未設為 true),此呼叫會:
   - 用攻擊者自己 Suno 任務算出的音訊 URL,覆寫受害者 `background_jobs.resultJson`(資料完整性被破壞);
   - 觸發 `runPostGenForJob(受害者jobId)`,以受害者 `userId` 把攻擊者的音訊寫入受害者的 `generation_history`/`digital_asset_library`(錯誤歸戶,受害者帳號憑空多出一筆非自己產生的內容)。

**影響**

- 資料完整性破壞:任意使用者可覆寫他人未完成的背景任務記錄。
- 錯誤歸戶:受害者的資產庫/生成歷史可被注入攻擊者控制的內容(不涉及金錢損失,但屬於明確的存取控制缺陷,且利用門檻低——只需要能猜到一個小整數 ID)。
- `jobId` 是否真的容易被外部使用者取得需視前端是否曾把它暴露在 URL/API 回應中(`generateMusicSuno` 的回傳確實直接把 `jobId` 給前端,`proStudio.ts:2116`),意味著同一使用者在多個分頁/裝置間跑多個任務時,`jobId` 本身並非機密。

**建議**

- 在 `checkMusicSunoStatus` 讀取/寫入 `jobId` 前,先查出 `existing.userId`,與 `ctx.user.id` 不符時直接 `throw new TRPCError({ code: "FORBIDDEN" })`,不執行任何讀寫或 `runPostGenForJob`。
- 系統性地檢查 `getBackgroundJob`/`updateBackgroundJob` 在 `server/db.ts` 的所有呼叫點,評估是否該在 DB 層直接加上 `userId` 過濾(如 `getCustomBlock` 的作法,見下方 2.3),而不是靠每個呼叫端自律。

---

### 2.2〔中〕`jobStatus`/`jobResult`/`checkAudioStatus` 對 `request_id` 沒有擁有權綁定

**發現**

```ts
// proStudio.ts:1646-1655
jobStatus: brainProcedure
  .input(z.object({ request_id: z.string().min(1), model: z.string().min(1) }))
  .query(async ({ input }) => {
    return falQueueStatus(input.request_id, input.model);
  }),

// proStudio.ts:1658-1675
jobResult: brainProcedure
  .input(z.object({ request_id: z.string().min(1), model: z.string().min(1) }))
  .query(async ({ ctx, input }) => {
    const raw = await falQueueResult(input.request_id, input.model);
    return localizeResultUrls(raw, unifiedAssetPrefix({ userId: ctx.user.id, source: "pro", modelId: input.model }));
  }),
```

`checkAudioStatus`(`proStudio.ts:1688-1820`)的輸入同樣只有 `requestId`/`model`/`submittedAt`,沒有任何欄位把它綁回發起這次生成的使用者。三者都是 `brainProcedure`(要求登入),但驗證的只是「你有登入」,不是「這個 `request_id` 是你的」——任何登入使用者只要拿到別人的 `request_id`(fal.ai 的 UUID,理論上高熵,但可能透過瀏覽器分享連結、伺服器日誌、前端錯誤回報等管道外流),就能:

- 查看該任務的完整生成結果(音訊/影片/ASR 逐字稿),可能包含他人的私密聲音克隆或內容;
- 讓 `checkAudioStatus` 用自己的 `ctx.user.id` 把該結果落地存進**自己**的資產庫(`proStudio.ts:1769-1791` 的 `doPostGenComplete({ userId: ctx.user.id, ... })`)——等同白嫖他人已完成的生成結果。

**影響**

此風險成立與否,取決於 `request_id` 的實際洩漏面(本檔案內無法驗證 request_id 是否會出現在瀏覽器歷史記錄、第三方分析工具、CDN 存取日誌等)。但架構上「僅靠 opaque ID 保密、無 DB 層授權檢查」屬於較弱的存取控制模式,與 2.1 的問題同源,建議一併處理。

**建議**

- 若要保留無 DB 記錄的輕量輪詢設計,至少應在 `falQueueSubmit` 回傳 `request_id` 時,把 `(request_id, userId)` 的對應寫入一個輕量表或快取,`jobStatus`/`jobResult`/`checkAudioStatus` 查詢前先核對。
- 或者強制所有 fal 任務都先 `createBackgroundJob`(見 1.1 建議),讓所有查詢都走「先驗 owner 再查 fal」的路徑。

---

### 2.3〔資訊〕`getCustomBlock` 的 owner 檢查是本檔案內做得正確的範例

`elevenLabsTTS` 唯一涉及 DB 資源讀取的地方(`proStudio.ts:855-869`):

```ts
if (input.customBlockId != null) {
  const block = await getCustomBlock(input.customBlockId, ctx.user.id);
  ...
}
```

核對 `server/db.ts:2541-2550`,`getCustomBlock` 在 SQL `WHERE` 子句同時比對 `id` 與 `userId`(`and(eq(customBlocks.id, id), eq(customBlocks.userId, userId))`),屬於正確的 IDOR 防護寫法,與 2.1/2.2 的「先讀後不驗證」形成對比,值得作為修正 2.1 的參考範本。

---

## 三、注入面

**未發現**傳統意義的 SQL Injection 或特權 system prompt 注入——本檔案不含任何直接組字串的 SQL 呼叫(唯一的 DB 存取 `getCustomBlock` 走 Drizzle 參數化查詢,見 2.3),使用者輸入(`prompt`/`text`/`lyrics`/`voice_description` 等)全部是作為生成參數直接轉發給 fal.ai 第三方 API,不會被用來組裝本服務自己執行的指令或查詢。

但有一項與「輸入驗證一致性」相關、值得放在此節的發現:

### 3.1〔低中〕SSRF allowlist(`safeMediaUrl`)只套用在少數欄位

**發現**

檔案匯入了 `safeMediaUrl`/`safeMediaUrlOptional`(`proStudio.ts:38`),已核對其實作(`server/lib/urlValidator.ts`)確實是完整的 SSRF allowlist:拒絕非 http(s)、拒絕 localhost/loopback/link-local/私有 IPv4 段(10./127./169.254./192.168./172.16-31./100.64-127. CGNAT)、拒絕裸 IP 字面量,並要求 host 落在固定網域白名單(fal.ai/fal.run/storage.googleapis.com/amazonaws.com/supabase.co 等)或環境變數 `ALLOWED_MEDIA_DOMAINS`。

但本檔案內實際套用 `safeMediaUrl`/`safeMediaUrlOptional` 的欄位只有 3 處:

- `qwenTTS.speaker_voice_embedding_file_url`(`proStudio.ts:927`)
- `qwenCloneVoice.audio_url`(`proStudio.ts:987`)
- `qwenCloneAndSpeak.audio_url`(`proStudio.ts:1014`)

其餘同樣是「使用者提供一個媒體 URL,伺服器把它原樣轉發給 fal.ai」的欄位,一律是裸 `z.string().url()`,沒有走 SSRF allowlist:

- `textToMusic.referenceAudioUrl`(`proStudio.ts:533`)
- `elevenLabsVoiceClone.audio_url`(`proStudio.ts:1164`)
- `klingCreateVoice.audio_url`(`proStudio.ts:1209`)
- `demucs.audio_url`(`proStudio.ts:1244`)
- `audioIsolation.audio_url`(`proStudio.ts:1306`)
- `mergeAudios.audio_urls`(`proStudio.ts:1336`)
- `voiceChanger.audio_url`(`proStudio.ts:1366`)
- `speechToText.audio_url`(`proStudio.ts:1413`)
- `speechToVideo.image_url`/`audio_url`(`proStudio.ts:1449-1450`)
- `echoMimic.image_url`/`audio_url`(`proStudio.ts:1480-1481`)
- `stableAvatar.image_url`/`audio_url`(`proStudio.ts:1508-1509`)
- `dubbing.video_url`/`audio_url`(`proStudio.ts:1539-1540`)
- `longcatAvatar.image_url`/`audio_url`(`proStudio.ts:1578-1579`)
- `ltxAudioToVideo.audio_url`/`image_url`/`lora_url`(`proStudio.ts:1609-1611`)

**影響**

這些 URL 是交給 fal.ai 的伺服器去抓取(本服務自己不會 fetch),因此直接的 SSRF 目標是 fal.ai 的雲端網路而非 healing-studio 自身內網,實際可利用性**未在本檔驗證**(需了解 fal.ai 基礎設施的網路隔離狀況才能下定論)。但這仍是明顯的輸入驗證不一致——同一個檔案裡,同一類欄位(媒體 URL)有的走 allowlist、有的不走,容易在後續維護中被誤以為「反正這個檔案都有做 SSRF 防護」而掉以輕心。

**建議**

- 把所有 `audio_url`/`image_url`/`video_url`/`*_url` 欄位統一改用 `safeMediaUrl`/`safeMediaUrlOptional`,除非有明確理由(例如效能)保留例外,並在程式碼加註解說明原因。

---

## 四、持久化

### 4.1〔低〕`checkMusicSunoStatus` 的 `resultJson` 合併存在理論上的 race,但有元件層級的說明

`checkMusicSunoStatus`(`proStudio.ts:2181-2210`)在寫回 `resultJson` 前,採「先 `getBackgroundJob` 讀出舊 meta、再展開合併、才 `updateBackgroundJob`」的 read-modify-write 模式,沒有使用資料庫層的 CAS/樂觀鎖。若同一 `jobId` 同時被 webhook(`webhookFal.ts`)與前端輪詢兩條路徑碰到,存在小機率的最後寫入覆蓋(lost update)風險。程式碼註解(`proStudio.ts:2203-2205`)提到「Idempotent via postGenComplete flag」,但這個旗標只保護 `runPostGenForJob` 內部不重複落地資產,**不保護 `resultJson` 欄位本身的合併不被覆蓋**。這與發現 2.1(owner 檢查缺失)疊加後,風險會被放大,但單獨看是低嚴重度的競態,**是否在生產環境實際發生過未在本檔驗證**。

### 4.2〔資訊〕`void doPostGenComplete(...)` / `void runPostGenForJob(...)` 為刻意的 fire-and-forget

`checkAudioStatus`(`proStudio.ts:1776`)與 `checkMusicSunoStatus`(`proStudio.ts:2209`)都用 `void` 呼叫落地邏輯而不 `await`,意味著:如果這次 tRPC query 的 HTTP 連線在 `doPostGenComplete`/`runPostGenForJob` 完成前中斷(例如使用者切頁),寫入是否成功不會反映在回應裡,前端也無法得知是否真的落地成功。查閱 `postGenActions.ts` 內部各子步驟皆包在各自的 try/catch 且靜默吞錯(依據前次子代理的研究,`doPostGenComplete` 各段落「best-effort、無重試」)。這是刻意的設計取捨(避免拖慢輪詢回應),**非本次稽核重點,但列為持久化風險紀錄**——若這類「靜默失敗」造成使用者資產遺失需要另開排查(需查 `postGenActions.ts` 的實際錯誤率/監控)。

---

## 五、死碼 / 契約不符

### 5.1〔低〕三個 procedure 在目前 client 程式碼中找不到任何呼叫點

以 `client/src` 為範圍,逐一 grep 檔內定義的全部 31 個 procedure 名稱(排除本檔自身),以下三個為 0 匹配(已用 `grep -rl "proStudio\.<name>\b"` 交叉核對,並確認沒有透過動態 `client.proStudio[proc]` 呼叫——`client/src/adapters/generation.trpc.ts:108` 唯一的動態呼叫點只會解析成 `"elevenLabsTTS"` 或 `"textToMusic"`):

- **`qwenCloneVoice`**(`proStudio.ts:984-1004`)——獨立的「只做聲音克隆、回傳 speaker_embedding」端點。目前唯一被呼叫的是 `qwenCloneAndSpeak`(`proStudio.ts:1011-1084`),但它內部直接呼叫 `falRun(cloneModelId, ...)` 重新實作了一次 clone 呼叫(`proStudio.ts:1044-1047`),並沒有呼叫 `qwenCloneVoice` procedure 本身。也就是說兩段式流程(先 `qwenCloneVoice` 拿 embedding、再自行呼叫 `qwenTTS`)這個「二選一」中的「分開兩步」選項,目前沒有任何 UI 入口。
- **`jobResult`**(`proStudio.ts:1658-1675`)——註解自陳是被 `checkAudioStatus` 取代的舊流程("此 endpoint 取代 jobStatus + 自行讀取 output.video_url 的舊流程"),但函式本身還留著,沒有被移除也沒有被呼叫。
- **`compiledTextToMusic`**(`proStudio.ts:1832-1999`,167 行)——串接 `AudioCompiler`(情緒積木 → 結構化音樂提示詞)完整的四模型分支邏輯,程式碼品質與其餘 procedure 相當(有各自的 charge/refund),但 grep 全部 `client/src` 找不到任何 `.compiledTextToMusic` 呼叫,`MusicCanvas.tsx`/`VoiceAmbientCanvas.tsx` 也沒有 `AudioBlock`/`audioCompiler` 相關 UI 痕跡。註解裡提到的「28KB 的 audioCompiler 邏輯」($server/services/audioCompiler.ts$)似乎是一個完整實作但從未上線的功能分支。

**影響**:非功能性錯誤,但增加維護負擔與稽核雜訊(未來修 bug 時容易誤以為這些路徑有真實流量在跑);`compiledTextToMusic` 若真的是一個「做完但沒接上」的功能,代表產品端可能誤以為情緒積木音樂功能已上線。

**建議**:與產品/前端團隊確認 `compiledTextToMusic`/`qwenCloneVoice` 二選一流程是否仍在路線圖上;若無計畫近期串接,建議在 `jobResult`/`qwenCloneVoice` 加上 `@deprecated` 標記或直接移除,`compiledTextToMusic` 則應明確排入前端串接待辦或移除以減少攻擊面(它仍是一個可被直接呼叫、會扣點的 mutation,即使沒有官方 UI 入口,只要知道 procedure 名稱就能呼叫)。

### 5.2〔低〕`falQueueRun` 函式本檔內定義但零呼叫

`proStudio.ts:301-309` 定義了 `falQueueRun`(submit → 直接回傳 `request_id`,`waitSec` 參數依註解已廢棄):

```ts
async function falQueueRun(
  modelId: string,
  input: Record<string, unknown>,
  waitSec = 300 // 參數已废棄,改由前端 Polling
): Promise<unknown> {
  const { request_id } = await falQueueSubmit(modelId, input);
  return { request_id, raw_model_id: modelId, is_async_polling: true };
}
```

全檔搜尋確認本檔案內所有 mutation 都直接呼叫 `falQueueSubmit`,沒有任何地方呼叫這個 `falQueueRun`。對照 `server/routers/imageStudio.ts`(24 處呼叫)與 `server/routers/videoStudio.ts`(23 處呼叫)——這兩個檔案各自也定義了「同名但獨立」的 `falQueueRun`(`imageStudio.ts:302`、`videoStudio.ts:210`)且都大量使用——推測這是三個 studio router 複製貼上共用骨架時遺留下來、但 proStudio.ts 最終改用別的呼叫方式(`falQueueSubmit`)後忘記刪除的死碼。

**建議**:直接刪除 `proStudio.ts:301-309` 這段死碼,或若近期有計畫讓 proStudio 也走「同步等待」模式再保留並加註解說明用途。

### 5.3〔資訊〕未發現「旗標鎖住的功能」

除了上述死碼外,沒有在本檔案找到被 feature flag / 環境變數整段跳過但仍佔用 code path 的功能區塊(例如整個 procedure 被 `if (FEATURE_X)` 包住的情況)——`ELEVENLABS_API_KEY`/`FAL_API_KEY`/`SUNO_API_KEY` 的檢查都是「缺 key 就報錯」而非「隱藏功能」,不屬於此類。

---

## 附錄:本次稽核方法說明

- 全檔 2227 行以 `Read` 完整讀過兩輪(offset 0-1359、1360-2227),逐一追蹤每個 mutation 的 deduct → generate → refund 三段。
- 為避免臆測,額外用一個唯讀子代理(Explore)交叉核對以下依賴模組的實際原始碼:`server/db.ts`(`deductUserPoints`/`refundUserPoints`/`getCustomBlock`/`getBackgroundJob`/`updateBackgroundJob`/`createBackgroundJob`/`atomicClaimJobRefund`)、`server/_core/trpc.ts`(procedure 中介層鏈)、`server/lib/urlValidator.ts`(`safeMediaUrl`)、`server/services/modelPricing.ts`(`estimatePoints` 未知模型 fallback)、`server/services/postGenActions.ts`(`doPostGenComplete`/`runPostGenForJob`/`refundJobIfBilled`)、`server/services/falDispatcher.ts`(`dispatchFalQueueTask`)。
- 死碼判定以 `grep -rl` 對 `client/src` 與 `server` 全目錄搜尋每個 procedure 名稱,並人工核對動態呼叫點(`generation.trpc.ts`)排除誤判。
- 未在本檔案驗證、僅列為需另查的項目已在正文中明確標註「未在本檔驗證」。
