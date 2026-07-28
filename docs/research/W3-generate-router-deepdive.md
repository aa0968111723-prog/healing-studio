# W3 — generate.ts 主生成 router 逐行深挖(逐檔深挖 wave W)
- 產生日期:2026-07-03
- 依據 commit:7b18b76f
- 稽核檔案:server/routers/generate.ts(2437 行)

## 方法說明

本報告逐行讀完 `server/routers/generate.ts` 全部 2437 行(共分 7 段讀取,offset 1/400/800/1200/1540/1940/2339),並對每個計費相關發現追進 `server/db.ts`(`deductUserPoints`/`refundUserPoints`/`atomicClaimJobRefund`/`getBackgroundJob`)、`server/_core/trpc.ts`(procedure 定義)、`server/services/postGenActions.ts`(`doPostGenComplete`)佐證,再用 Grep 確認相關 client 呼叫點(`client/src/adapters/generation.trpc.ts`、`client/src/contexts/BackgroundTasksContext.tsx`、`client/src/pages/ImageStudio.tsx`、`client/src/pages/ModelsPage.tsx`、`client/src/pages/LoraTrainer.tsx`)是否為目前實際會被打到的路徑。凡跨出 generate.ts 才能完全確認的細節,一律標注「未在本檔驗證」。

本檔含 10 個 procedure:`prepareJob`、`estimateCost`、`multimodal`(同步,342-1534 行,占全檔過半)、`jobStatus`、`myJobs`、`submitMultimodalAsync`、`submitStudioJob`、`checkStudioJob`、`activeJobs`、`recordGenResult`。

---

## 嚴重(Critical)

### C1. `jobStatus` 完全沒有 owner 檢查 → 跨使用者 IDOR,可讀取任何人的生成任務內容

**發現**(`server/routers/generate.ts:1536-1539`):

```ts
jobStatus: protectedProcedure
  .input(z.object({ jobId: z.number() }))
  .query(async ({ input }) => {
    return db.getBackgroundJob(input.jobId);
  }),
```

只用 `input.jobId`,完全沒有取用 `ctx.user.id`,也沒有比對 job 擁有者。追進 `server/db.ts:2204-2213`:

```ts
export async function getBackgroundJob(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id)).limit(1);
  return result[0];
}
```

是裸的 `SELECT * FROM background_jobs WHERE id = ?`,沒有 `userId` 過濾。任何已登入使用者只要換 `jobId` 就能拿到別人 job 的完整 `resultJson`(prompt、compiledPrompt、resultUrl、requestId、modelId、costPoints、errorMessage 等)。

對照同檔案 600 行後的姐妹 procedure `checkStudioJob`(`generate.ts:2176-2182`)明確做了擁有者檢查:

```ts
const job = await db.getBackgroundJob(input.jobId);
if (!job) return null;
// 權限檢查
if (job.userId !== ctx.user.id) return null;
```

證明「先查 job 再比對 userId」是本檔已知且採用的正確 pattern,`jobStatus` 只是漏做。

**這不是理論風險** — 確認 `jobStatus` 目前確實有活躍呼叫端:
- `client/src/pages/ModelsPage.tsx:531`、`client/src/pages/LoraTrainer.tsx:364`:`trpc.generate.jobStatus.useQuery(...)`(模型訓練狀態輪詢)。
- `client/src/adapters/generation.trpc.ts:143`:`client.generate.jobStatus.query({ jobId })`。

代表任何登入使用者可直接用 tRPC client 呼叫 `generate.jobStatus.query({ jobId: N })`,N 為任意整數,枚舉出他人 job(background_jobs.id 為自增整數,枚舉成本低)。

**影響**:跨使用者資料外洩(prompt 內容、生成結果媒體 URL、錯誤訊息、費用),嚴重度高;若使用者的 prompt 含個資/敏感描述,亦構成隱私事件。

**建議**:立即在 `jobStatus` 加上與 `checkStudioJob` 相同的擁有者檢查(`if (job.userId !== ctx.user.id) return null`,或 `throw FORBIDDEN`),並檢查是否要對兩個功能相同的 procedure(`jobStatus` vs `checkStudioJob`)做收斂,避免未來只修一邊又漂移。

---

### C2. `jobStatus` IDOR + `submitStudioJob` 無 requestId 溯源驗證 → 可鏈成「偷別人生成結果」

**發現**:`submitStudioJob`(`generate.ts:2143-2169`)接受**使用者端自帶**的 `requestId`(z.string().min(1))與 `modelId`,只建立一筆屬於呼叫者自己(`userId: ctx.user.id`)的 `background_jobs` 記錄,**完全沒有扣點,也沒有驗證這個 `requestId` 是否真的由這個使用者(或任何人)實際送去過 fal.ai**:

```ts
submitStudioJob: protectedProcedure
  .input(z.object({
    studioType: z.enum(["image", "video", "audio", "voice"]),
    requestId: z.string().min(1),
    modelId: z.string().min(1),
    ...
  }))
  .mutation(async ({ ctx, input }) => {
    const jobId = await db.createBackgroundJob({
      userId: ctx.user.id,
      jobType: input.studioType,
      status: "processing",
      ...
      resultJson: { requestId: input.requestId, modelId: input.modelId, ... },
    });
    return { jobId };
  }),
```

`checkStudioJob`(2176-2352)輪詢時只檢查「這個 job 是不是我的」(job.userId === ctx.user.id),完全不檢查 `requestId` 的來源合法性,接著就直接拿 `resultJson.requestId` + `modelId` 去 fal.ai 查狀態、下載結果、寫回 `digital_asset_library` / `generation_history`(經 `runPostGenForJob`)。

**可鏈成的攻擊鏈**:
1. 攻擊者用 C1 的 `jobStatus` IDOR 枚舉,取得受害者某筆進行中/剛完成 job 的 `resultJson.requestId` + `modelId`。
2. 攻擊者呼叫自己的 `submitStudioJob({ requestId: 偷來的requestId, modelId, studioType })`,在自己帳號下建立一筆指向同一個 fal.ai `requestId` 的 job。
3. 攻擊者呼叫 `checkStudioJob`(擁有者檢查只驗證這是「攻擊者自己的」新 job,會通過),觸發真的去 fal.ai 查詢該 `requestId` 狀態 → 若受害者原始任務已完成或稍後完成,攻擊者會拿到同一份生成結果 URL,並經 `runPostGenForJob` 寫進自己的資產庫/生成歷史 — **且全程沒有呼叫任何 `deductUserPoints`**。

**影響**:理論上可讓攻擊者零成本竊取他人已付費的生成結果並記入自己帳下(既是計費繞過,也是資料竊取)。此鏈路的第一步(C1)已確認可達;第二、三步的程式碼路徑在本檔內確認無阻擋,但「fal.ai 是否允許用不同 caller 查詢同一個 request_id 的狀態」屬於 fal.ai API 行為,未在本檔驗證(需查 `server/services/falQueueClient.ts` 是否有额外綁定)。

**建議**:
1. 先修 C1(擁有者檢查)阻斷洩漏來源。
2. `submitStudioJob` 應該記錄「這個 requestId 是哪個 job 建立的」的全域唯一性(例如對 `requestId` 建 unique index 或在建立前查詢是否已被其他 job 使用),拒絕重複註冊他人的 requestId。

---

### C3. `multimodal`(同步生成)mutation 對每個生成失敗路徑「雙重退款」

**發現**:`multimodal` mutation(`generate.ts:342-1534`)在 image/video/audio/voice 四個生成區塊內,對 fal.ai dispatch 失敗與「無有效 URL」兩種情境各自呼叫一次 `db.refundUserPoints` 後 `throw`:

- image:`generate.ts:903`(fal dispatch 失敗)、`916`(無 URL)
- video:`1003`、`1016`
- audio:`1104`、`1117`
- voice:`1212`、`1225`

例如(`generate.ts:901-908`):
```ts
} else if (!demoMode) {
  await db.refundUserPoints(userId, _genEstimate.totalPoints);
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `圖片生成失敗（fal.ai ${imageDispatch.modelId}）：${imageDispatch.error || "未知錯誤"}`,
  });
}
```

這個 `throw` 會被同一個大 `try`(從 `generate.ts:676` 開始)包住,一路傳到最外層 `catch`(`generate.ts:1491-1533`),而該 catch **無條件**又退一次款:

```ts
} catch (error) {
  ...
  if (!demoMode) {
    await db.refundUserPoints(userId, _genEstimate.totalPoints);   // line 1498
    await db.updateBackgroundJob(jobId, { status: "failed", errorMessage: errMsg });
    await db.createApiUsageLog({ ... });
  }
  ...
}
```

追進 `server/db.ts:898-921` 的 `refundUserPoints` 實作:

```ts
export async function refundUserPoints(userId: number, pointsAmount: number) {
  ...
  const toRefund = Math.max(1, Math.min(500, Math.round(pointsAmount)));
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT ... FOR UPDATE`);
      await tx.update(users).set({
        remainingGenerations: sql`${users.remainingGenerations} + ${toRefund}`,
      }).where(eq(users.id, userId));
    });
  } catch { ... }
}
```

**沒有任何冪等鎖**(不像 `atomicClaimJobRefund` 用 `resultJson.refunded` CAS 旗標),純粹是「加回去」。因此上述 8 個內層退款點中的任何一個被觸發,都會導致同一次失敗被退款兩次 —— 使用者淨賺一次 `_genEstimate.totalPoints`(扣 1 次、退 2 次)。

**對照修過的姐妹路徑**:`submitMultimodalAsync` 的 catch(`generate.ts:2116-2136`)明確使用了 CAS 鎖:

```ts
if (!isDemoMode()) {
  const claimed = await db.atomicClaimJobRefund(jobId, points);
  if (claimed) await db.refundUserPoints(userId, points);
}
```

且程式碼註解(`generate.ts:2118-2123`,標記 AIDV-650)清楚寫明這正是為了「消除與後續 refundJobIfBilled 路徑的潛在雙退」。這證明修雙退的正確 pattern 已存在於本檔,但**從未回頭套用到 `multimodal` procedure**,是新舊世代程式碼交替留下的技術債。

**影響**:每一次 `multimodal`(同步)生成因 fal.ai dispatch 失敗或「回傳但無有效 URL」而失敗,使用者都會被多退一次點數 —— 可被惡意重複觸發以「刷點數」(送出容易導致 dispatch 失敗的請求,每次淨賺 `_genEstimate.totalPoints` 點)。

**範圍說明**:目前 Grep 確認 `multimodal` 唯一的即時呼叫端是 `client/src/components/OnboardingFlow.tsx:216`(新手引導的第一次生成),流量規模有限,但程式碼缺陷本身與可農場化的行為並不因呼叫量小而消失;只要有其他頁面重新接上 `generate.multimodal`,或使用者能重複觸發引導流程,就是可重複兌現的計費漏洞。

**建議**:把 8 個內層退款點全部移除,只在最外層 catch 統一退款(該 catch 本身就會涵蓋所有子區塊拋出的錯誤);或者反過來,讓內層退款後改用「已退款」旗標(比照 `atomicClaimJobRefund`),外層 catch 檢查旗標再決定是否退款。二選一即可,但目前「內外都退」的現狀必須修正。

---

## 高(High)

### H1. `prepareJob` 扣點金額與 `multimodal` 實際使用引擎/退款金額可能對不上

**發現**:`prepareJob`(`generate.ts:79-281`)決定計費引擎的邏輯(`generate.ts:124-142`):

```ts
const modalityEngineMap: Record<string, string> = {
  image: overrideEngine ?? String(brainRow?.imageEngine ?? falEngines.textToImage),
  video: overrideEngine ?? String(brainRow?.videoEngine ?? falEngines.textToVideo),
  audio: overrideEngine ?? String(brainRow?.audioEngine ?? falEngines.textToAudio),
  voice: overrideEngine ?? String(brainRow?.voiceEngine ?? falEngines.textToSpeech),
  multimodal: overrideEngine ?? String(brainRow?.imageEngine ?? falEngines.textToImage),
};
const selectedEngine = modalityEngineMap[input.generationType] ?? "gemini/imagen-3";
```

直接採用 `brainRow?.imageEngine` 這個「使用者在 AI 大腦組態選的原始引擎值」(不管是不是 fal 引擎)當計費依據,且尊重 `overrideEngine` 輸入欄位。

但 `multimodal` mutation 內實際決定「拿去生成、也拿去算退款金額」的引擎邏輯(`generate.ts:428-457`)是:

```ts
const brainImageEngine = getBrainSelectedEngine(brainRow, "imageEngine");
...
const _resolvedImageEngine = isGeminiEngine(brainImageEngine)
  ? brainImageEngine!
  : falEngines.textToImage;
...
const _genModelId = input.generationType === "video" ? _resolvedVideoEngine
  : input.generationType === "audio" ? _resolvedAudioEngine
  : input.generationType === "voice" ? _resolvedVoiceEngine
  : _resolvedImageEngine;
const _genEstimate = estimatePoints(_genModelId, { ... });
```

差異點:
1. `multimodal` 的 input schema(`generate.ts:343-394`)**沒有 `overrideEngine` 欄位**,所以 `prepareJob` 若用 `overrideEngine` 算出的扣點金額,`multimodal` 完全不會知道、也不會採用同一顆引擎生成。
2. 就算不用 `overrideEngine`,只要 `brainRow.imageEngine` 是「非 Gemini 的 fal 引擎 ID」且與 `falEngines.textToImage`(來自另一個欄位 `falImageToImageEngine`/`falTextToImageEngine`)不同,`prepareJob` 會照 `brainRow.imageEngine` 的價格扣款,但 `multimodal` 卻改用 `falEngines.textToImage` 那顆引擎生成 —— 使用者「付了 A 引擎的錢,拿到 B 引擎的結果」,且失敗時退款金額也是以 B 引擎的價格計算,與原始扣款金額(A 引擎價格)不一致。

**影響**:計費金額與實際使用引擎脫鉤,可能系統性多收或少收(視兩引擎價差方向而定),且退款金額也連帶算錯 —— 不是單次意外,而是只要組態滿足上述條件就會每次發生的結構性 bug。

**範圍說明**:目前唯一呼叫 `prepareJob`+`multimodal` 的 OnboardingFlow.tsx(`generate.ts` 呼叫端見上)沒有傳 `overrideEngine`,且新用戶引導階段 `brainRow` 多半是空的(直接落回兩邊都取 `falEngines.textToImage` 的預設值),因此目前多半不會觸發;但只要使用者已設定過 AI 大腦的自訂引擎、或未來有呼叫端開始傳 `overrideEngine`,問題就會出現。

**建議**:`prepareJob` 與 `multimodal` 的引擎解析邏輯應收斂成同一個 helper 呼叫,避免各自兩份實作漂移;`multimodal` 的 zod input 也應該補上 `overrideEngine`,或明確在文件中禁止/移除 `prepareJob.overrideEngine`。

---

### H2. `generate.ts` 的生成入口未套用專為生成設計的速率限制,與姐妹 router 不一致

**發現**:`server/_core/trpc.ts:161-166`、`:180` 定義了專門給生成類 procedure 用的限流:

```ts
// Image / video generation calls: 5 req / 60s per user (shared bucket across studios).
const requireGenerationLimit = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  checkTrpcRateLimit(ctx.user.id, { limit: 5, windowMs: 60_000, label: "gen" }, ctx.res);
  return next({ ctx: { ...ctx, user: ctx.user } });
});
...
export const generationProcedure = brainProcedure.use(requireGenerationLimit);
```

Grep 確認 `imageStudio.ts`、`videoStudio.ts` 有使用 `generationProcedure`。但 `generate.ts` 全檔搜尋 `generationProcedure` 沒有任何一次使用 —— `multimodal`(2437 行檔案中唯一真正呼叫 fal.ai/Gemini 生成的同步 procedure)用的是普通 `brainProcedure`(`generate.ts:342`),`submitMultimodalAsync`、`submitStudioJob`、`checkStudioJob`、`prepareJob` 全部用普通 `protectedProcedure`,完全沒有每分鐘請求數上限。

**影響**:`generate.ts` 提供的生成入口(尤其 `multimodal` 與 `submitMultimodalAsync`,兩者都會真的打外部付費 API)繞開了系統本身設計的「生成類請求 5 次/60 秒」防濫用機制,理論上使用者可用比 imageStudio/videoStudio 更高的頻率連續送出付費生成請求(僅受限於自身點數餘額與外部 API 速率),增加短時間內大量刷點/打爆 fal.ai 配額的風險。

**建議**:評估 `multimodal`、`submitMultimodalAsync`(至少)是否應該改用 `generationProcedure`,與 `imageStudio`/`videoStudio` 對齊。

---

## 中(Medium)

### M1. `recordGenResult` 無驗證、零計費,任何使用者可捏造「生成紀錄」

**發現**(`generate.ts:2414-2436`):

```ts
recordGenResult: protectedProcedure
  .input(z.object({
    modality: z.enum(["image", "video", "audio", "voice"]),
    modelId: z.string().max(200),
    prompt: z.string().max(2000).optional(),
    resultUrl: z.string().url().optional(),
    label: z.string().max(200).optional(),
    sourceStudio: z.string().max(50).optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    await doPostGenComplete({
      userId: ctx.user.id,
      modality: input.modality,
      modelId: input.modelId,
      prompt: input.prompt,
      resultUrl: input.resultUrl,
      label: input.label,
      sourceStudio: input.sourceStudio ?? "image",
    });
    return { success: true };
  }),
```

這個 procedure 完全沒有呼叫 `db.deductUserPoints`,也沒有任何欄位用來佐證「這個 modelId/resultUrl 真的來自一次已付費的生成」(沒有 jobId、沒有 requestId、沒有 dedupeMarker)。追進 `server/services/postGenActions.ts:265-286`,`doPostGenComplete` 只是把傳入值原樣寫進 `generation_history`/`digital_asset_library`(`costCredits` 缺值時退回預設 `1`,純粹展示用,不代表真的扣過款)。

Grep 確認目前唯一活躍呼叫端 `client/src/pages/ImageStudio.tsx:3286,3820` 的設計意圖是「先呼叫真正計費的 `imageStudio.*` mutation,再呼叫 `recordGenResult` 補寫歷史」,但**伺服器端完全沒有強制這個順序**——任何使用者可以直接用 tRPC client 呼叫 `generate.recordGenResult.mutate({ modality, modelId, resultUrl, ... })`,填入任意 `modelId`(包含昂貴引擎名稱)與任意 `resultUrl`(包含外部/自建的任意 URL),零成本在自己帳下捏造一筆「已生成」紀錄,且 `resultUrl` 未經 `checkSafety` 或任何內容審核就寫入資產庫/歷史。

**影響**:
1. 若平台任何功能依賴生成次數/生成歷史做統計(成就、推薦、社群動態、額度佐證等),可被免費灌水。
2. `resultUrl` 無驗證直接寫入使用者自己的資產庫,存在把不當內容混入自己歷史紀錄的風險(是否會外流到他人可見的頁面,如社群/公開展示,未在本檔驗證)。

**建議**:至少要求呼叫時附上對應的 `backgroundJobId`/`requestId` 並在伺服器端驗證該 job 屬於呼叫者、且未被登記過(dedupe),避免完全信任 client 端宣稱的資料。

### M2. Vault / 微調模型 owner 檢查在 `userId` 為 `null` 時「fail-open」跳過

**發現**:同一個 pattern 在檔案中出現 4 次:

- `multimodal` 內 vault 角色檢查(`generate.ts:566`):`if (vaultChar && vaultChar.userId != null && vaultChar.userId !== ctx.user.id)`
- `multimodal` 內 vault 場景檢查(`generate.ts:599`)
- `multimodal` 內微調模型檢查(`generate.ts:622`):`if (ftModel.userId != null && ftModel.userId !== ctx.user.id)`
- `submitMultimodalAsync` 內對應三處(`generate.ts:1659`、`1692`、`1718`)完全相同寫法

只要對應資料列的 `userId` 欄位是 `null`,擁有者檢查會被整段跳過,視為可用。

**影響**:若資料庫中存在 `userId = null` 的 vault 項目或微調模型(不論是設計上代表「公版/共用資源」,還是軟刪除/資料異常留下的孤兒列),任何使用者都能把它當自己的注入使用。程式碼本身看不出這是有意為之的「公版資源」設計,還是防禦性檢查寫漏(該用 `??`/一律要求非 null)。

**建議**:確認 `vault_items`/`fine_tuned_models` schema 中 `userId` 是否真的允許合法的 `null`(公版資源);若是,應該用明確欄位(如 `isPublic`)而不是「userId 缺值」來代表可共用,避免和「資料異常」混淆。若不是設計如此,應改為 `userId == null` 時一律拒絕。

---

## 低 / 資訊性(Low / Info)

### L1. 死碼:5 個 import 從未在檔案中使用

**發現**:
- `isFlagEnabled`(`generate.ts:12`,來自 `../_core/flags`)
- `featureFlags`(`generate.ts:18`,來自 `../_core/featureFlags`)
- `MODEL_PRICING_CATALOG`(`generate.ts:36`)
- `DEFAULT_FAL_ENGINES`(`generate.ts:44`)
- `estimateGenerationPoints`(`generate.ts:45`)

Grep 全檔確認上述 5 個識別字只出現在 import 陳述式(`MODEL_PRICING_CATALOG` 另外出現一次在註解文字中),函式主體從未呼叫。

**影響**:純程式碼健康度問題,無功能影響,但顯示可能有計畫中要接的旗標判斷/價目表查詢最終沒有接上(是否代表某個「依旗標切換定價/可用性」的需求半途而廢,未在本檔驗證)。

**建議**:清除未用 import,或若這些原本要接某個未完成功能,應在對應的 Jira/規劃文件中確認是否仍要做。

### L2. brainRow 查詢邏輯在 4 個 procedure 中逐字重複

**發現**:幾乎相同的「查 `userAiBrain` 表拿 brainRow,catch 吞錯」區塊分別出現在:
- `prepareJob`(`generate.ts:101-115`)
- `estimateCost`(`generate.ts:296-309`)
- `multimodal`(`generate.ts:411-424`)
- `submitMultimodalAsync`(`generate.ts:1623-1634`)

**影響**:主要是維護性問題 —— H1 發現的引擎解析漂移,根源之一正是這幾份重複邏輯各自演化出不同的「引擎回退規則」。

**建議**:抽成共用 helper(例如 `loadBrainRowAndEngines(userId)`),讓 `prepareJob` 與 `multimodal`/`submitMultimodalAsync` 保證用同一套引擎解析規則,順便修掉 H1。

### L3. `submitStudioJob` 對 `requestId` 零溯源驗證(僅供 C2 参照,獨立記錄設計缺口)

已在 C2 完整描述其與 C1 的鏈式風險,此處僅補充:`submitStudioJob` 本身的合約就是「完全相信 client 傳來的 requestId/modelId」,沒有以任何方式驗證這個 requestId 真的是呼叫者剛剛送給哪個外部供應商的任務。這在只考慮單一 procedure 時是一個開放式的信任假設,建議未來新增呼叫端時都要意識到這一點。

另外注意:`client/src/adapters/generation.trpc.ts`(image/keyframe 生成的一個 adapter 實作)呼叫 `submitStudioJob` 時,`requestId` 是**前端自己現生的 `crypto.randomUUID()`**(`generation.trpc.ts:127`),而非任何真正呼叫 fal.ai 後拿到的 request id——換句話說,若這條 adapter 路徑被啟用,`submitStudioJob` 建立的 job 內部存的 `requestId` 從一開始就不對應任何真實的 fal.ai 任務,`checkStudioJob` 輪詢永遠拿不到 COMPLETED,只能等 30 分鐘 timeout 後被標記失敗退款。此 adapter 檔案自身註解(`generation.trpc.ts:16`)與 `client/src/adapters/index.ts:14-16` 都明確自稱是「dormant」、「P0 沒有 UI 路徑會呼叫」的休眠基礎設施,但 `client/src/providers/SpineProvider.tsx:64` 確實已經在呼叫 `createAdapters(...)`。此路徑目前是否真的會被終端使用者觸發、blast radius 多大,**未在本檔驗證**(需要另外深挖 `SpineProvider` 掛載範圍與路由),在此僅記錄觀察供後續稽核追蹤。

---

## 未發現 / 澄清

- **SQL / 指令注入**:本檔沒有發現使用者輸入直接串接進 SQL 字串或 shell 指令的路徑;資料庫存取一律經由 `server/db.ts` 的 Drizzle ORM 呼叫。
- **Prompt 注入到外部 API**:`input.prompt`、`memoryContext`(RAG 歷史 prompt,可能含先前被注入污染的內容)最終都會流入 `compileElitePrompt` 再送進 Gemini/fal.ai(`generate.ts:718-744`、`834-909` 等)。檔案內已有明確註解(`generate.ts:690-696`,AIDV-69)承認 RAG 記憶內容屬於「untrusted」且注入防護旗標**預設 OFF**,關閉時行為與「完全不過濾」位元相同 —— 這是已知、已標記、目前預設不啟用防護的開放風險,而非本次新發現,列在此處供對照。`compileElitePrompt`/`checkSafety` 本身的實作在 `server/routers/_generateHelpers.ts`,未在本檔逐行深挖。
- **Webhook 回填一致性**:`submitMultimodalAsync` 建立的 fal.ai webhook URL 帶有 `signWebhookToken` 簽章(`generate.ts:2047-2050`),可防止偽造回呼;但 webhook 實際處理邏輯在 `server/routes/webhookFal.ts`,以及 `refundJobIfBilled`/`atomicClaimJobRefund` 是否能完全防止「客戶端輪詢 30 分鐘 timeout 退款」與「webhook 稍後才送達完成」之間的競態,**未在本檔驗證**(需另外深挖 postGenActions.ts 與 webhookFal.ts)。
- **`checkStudioJob` 的擁有者檢查**、**`myJobs`/`activeJobs` 的 `ctx.user.id` 過濾**、**`prepareJob`/`submitMultimodalAsync` 對 `createBackgroundJob` 失敗時的孤兒退款處理**(AIDV-771,`generate.ts:184-192`、`1909-1915`)均正確,是本檔中值得保留的良好防禦模式,未列入問題清單。

---

## 附錄:計費路徑總覽(deduct → dispatch → refund 逐一核對)

| Procedure | 扣點 | 派工 | 失敗退款 | 備註 |
|---|---|---|---|---|
| `prepareJob` | `deductUserPoints`(158) | 無(僅建 job) | 建 job 失敗時立即退款(190,孤兒防護) | 正常 |
| `multimodal` | 不扣點(靠 `prepareJob` 已扣) | 直接同步呼叫 gemini/fal | **雙重退款**(見 C3) | 需修 |
| `submitMultimodalAsync` | `deductUserPoints`(1879) | Gemini 同步 or fal 排隊 | CAS 鎖退款(2124-2127,單次) | 正常 |
| `submitStudioJob` | 不扣點 | 不派工(僅登記) | 無(靠 caller 已扣) | 見 C2/L3 溯源缺口 |
| `checkStudioJob` | 不扣點 | 輪詢既有 requestId | `refundJobIfBilled`(冪等,依賴 postGenActions,未在本檔驗證) | 正常 |
| `recordGenResult` | **完全不扣點** | 不派工 | 不適用 | 見 M1 |
