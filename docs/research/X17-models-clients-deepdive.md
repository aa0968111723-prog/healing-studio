# X17 — 模型路由/客戶端(models + modelClients)逐行深挖(地毯掃描 wave X)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/routers/models.ts(813)、server/services/modelClients.ts(1164)

## 前言 / 方法

本輪逐行讀完兩檔案全文(models.ts 813 行、modelClients.ts 1164 行,本機 HEAD 實測為 `4506a2d6`,與任務指定基準比對後相關程式碼無實質差異),並對每一個可疑呼叫鏈往外追蹤到 `server/db.ts`、`drizzle/schema.ts`、`server/_core/trpc.ts`、`server/_core/apiGuards.ts`、`server/services/falDispatcher.ts`、`server/services/langsmithTracer.ts`、`server/services/agentToolExecutor.ts`、`server/routers/proStudio.ts` 等呼叫端/被呼叫端,以確認「看起來像 bug」的地方是否真的在執行期可達、是否已有其他防線。**禁止臆測,每條發現都以 grep/Read 直接核對過至少一個具體行號**。

部分發現與既有稽核文件(`docs/research/K1-security-bugs.md`、`P4-security-fixes.md`、`T2-security-prs-playbook.md`、`X14-training-billing-deepdive.md`)有交集——凡屬於「舊發現、本次重新逐行驗證仍然成立」的項目,均會明確標註「已知(引用來源)、本次重新驗證於 HEAD 仍存在」,不重複邀功;凡是本輪從這兩個目標檔案新挖出、既有文件未提及的項目,標註「新發現」。

---

## 發現總表(依嚴重度排序)

### 1.【Critical・已知(K1-4 / P4 修復卡 5),本次重新驗證於 HEAD 仍存在】`teamModels` / `getById` / `getAnalysis` 把「team_shared」當成「對所有登入者公開」,未核對是否真的同團隊——跨團隊 IDOR

**證據**:

`server/routers/models.ts:20-22`
```ts
teamModels: protectedProcedure.query(async () => {
  return db.getTeamSharedModels();
}),
```
呼叫的 `db.getTeamSharedModels()`(`server/db.ts:1016-1024`):
```ts
export async function getTeamSharedModels() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(fineTunedModels)
    .where(eq(fineTunedModels.visibility, "team_shared"))
    .orderBy(desc(fineTunedModels.createdAt));
}
```
**WHERE 子句只篩 `visibility = "team_shared"`,完全不看 `teamId`**——但 schema 明確為此欄位留了位置:`drizzle/schema.ts:466`「`teamId: int("teamId")` — team_shared 模型所屬團隊；個人模型為 null」,且有索引 `ftm_teamId_idx`(:479)。同一支 db.ts 內其實有正確做法的對照組 `getFineTunedModelsByTeam(teamId)`(`server/db.ts:991-1004`,`WHERE teamId = ? AND visibility = 'team_shared'`),而且這支正確版本**已經被另一個子系統實際使用**(`server/subsystems/trainingTrack/trainingTrackService.ts:265`)——證明「應該比對 teamId」不是臆測,是本專案自己已經實作過、只是沒接到 `models.ts` 這條路徑。

同樣的漏洞邏輯也出現在讀取單一模型的兩個 query:
```ts
// models.ts:31-36(getById)
if (
  model.userId !== ctx.user.id &&
  model.visibility !== "team_shared"
) {
  throw new TRPCError({ code: "FORBIDDEN", message: "無存取權限" });
}
```
以及 `models.ts:47-52`(`getAnalysis`,同款判斷式)。這兩處的判斷式邏輯是「不是本人 **且** 不是 team_shared 才擋」——換句話說只要 `visibility === "team_shared"`,**不論查詢者是否真的屬於該模型的擁有團隊**,一律放行。

再往回追:`toggleVisibility`(`models.ts:719-758`)輸入 schema 只有 `id`/`visibility` 兩個欄位,**從未寫入 `teamId`**——所以透過這條 UI 路徑分享出去的「team_shared」模型,資料庫裡 `teamId` 欄位其實恆為 `null`,`getById`/`getAnalysis` 的判斷式也完全沒有用到 `teamId`,等於這三個端點對「team_shared」的定義是「任何登入者都能看」,而非「同團隊成員才能看」。

**影響**:任何登入使用者(不需要與模型擁有者有任何團隊關係)呼叫 `trpc.models.teamModels`,即可列出**全平台**所有被設為 team_shared 的自訓模型;或直接猜/掃描 `models.getById({id})`、`models.getAnalysis({id})`,取得 `trainedLoraUrl`(LoRA 權重下載連結)、`configJson`(訓練超參數)、`datasetImages`(訓練資料集圖片 URL,可能含真人肖像——尤其 `portrait_lora`/`real_person`/`copyrighted` 類型,這些資料在 `create` 流程中原本要求先簽署同意書才能訓練,見發現說明下方)。這是一個結構性、不需要任何特殊條件、100% 可重現的跨團隊資料外洩。

**建議**(採用既有 P4 修復卡 5 的方案,本次重新確認其仍然適用):
1. `teamModels` 改為:先撈 `team_shared` 全集,再用 `db.listTeamIdsForUser(ctx.user.id)`(`server/db.ts:4386`,已存在)過濾,只留下呼叫者真正所屬團隊的模型;或直接改呼叫 `getFineTunedModelsByTeam(teamId)` 並讓前端明確傳入/後端查出使用者的 teamId。
2. `getById`/`getAnalysis` 在「非本人」分支補上:`team_shared` 時還必須 `model.teamId != null && (await db.listTeamIdsForUser(ctx.user.id)).includes(model.teamId)` 才放行,否則一律 FORBIDDEN。
3. `toggleVisibility` 應該要求呼叫者指定/推導 `teamId`(例如呼叫者必須是某個團隊成員才能把模型設為 team_shared),否則「team_shared 但 teamId=null」的模型永遠無法通過修好後的 teamId 比對而變成「分享了但誰都看不到」的另一種壞掉狀態。
4. 因為沒有退路旗標(不像 `assets.ts` 那樣有 `ENABLE_DATA_RBAC` 可以先關著觀察),且 LoRA 權重/資料集比一般素材更敏感,建議此處過濾**無條件啟用**,不要引入預設關閉的旗標。

---

### 2.【Critical・新發現(本輪從 models.ts 直接驗證,並與既有 X14 對 loraTrainer.ts 的交叉引用一致)】`create`/`retrain`/`captionImages`/`autofillAngles` 四個 mutation 全部只掛 `protectedProcedure`——沒有任何頻率限制、沒有任何配額/點數扣除

**證據**:全檔案(813 行)搜尋 `checkTrpcRateLimit`、`deductUserPoints`、`deductUserQuota`、`chargeForFalTask`,**零命中**。所有 mutation 一覽(`models.ts:15-813`)清一色是 `protectedProcedure`(只做登入檢查,見 `server/_core/trpc.ts:67`),沒有任何一個換成 `generationProcedure`/`audioGenerationProcedure`/`videoGenerationProcedure`(這三者才帶 5~10 次/分鐘的 per-user rate limit,定義在 `trpc.ts:161-182`)。

具體受影響的四個入口:
- `create`(`models.ts:270-503`):依 `trainingEngine` 分派到 `runLoraTrainingJob`(Replicate)或 `runFalTrainingJob`(fal.ai),兩者都是真實 GPU 訓練,依 `docs/research/X14-training-billing-deepdive.md` 逐行核對,單次訓練成本是「數美元」量級。這條路徑與同樣會啟動訓練的 `loraTrainer.trainWithReplicate`(`server/routers/loraTrainer.ts:179`)不同——後者好歹有 `checkTrpcRateLimit(..., {limit:3, windowMs:3600_000})` 的 3 次/小時限制,`models.ts` 的 `create` 完全沒有對等防線,呼叫端可無限次觸發。
- `retrain`(`models.ts:202-268`):同樣直接呼叫 `runLoraTrainingJob`,也沒有頻率限制。
- `captionImages`(`models.ts:505-558`):單次呼叫最多 30 張圖片(`images.max(30)`),每張各呼叫一次 `invokeLLM`(vision 模型,`runName: "lora-image-captioner"`)——沒有頻率限制、沒有扣點。
- `autofillAngles`(`models.ts:569-717`):單次呼叫最多 5 個角度(`targets.min(1).max(5)`),每個角度各呼叫一次 `dispatchImageGeneration({modelId:"fal-ai/nano-banana/edit", ...})`(真實 fal.ai 圖片生成 + 下載 + 落地儲存),沒有頻率限制、沒有扣點。往下追 `dispatchImageGeneration` 的型別簽名(`server/services/falDispatcher.ts:727-738`)本身就**沒有 `userId` 欄位**,與 `docs/research/U3-fal-dispatch-webhook-deepdive.md` 發現 1 描述的「convenience wrapper 結構性無法計費」是同一款缺口——就算日後想在 `models.ts` 補扣點,這個 wrapper 目前的簽名也傳不進 `dispatchFalTask` 內建的 `deductCredits`/`reconcileCredits` 邏輯,需要連同 `falDispatcher.ts` 一起改。

**影響**:任何登入使用者可以無限次呼叫 `create`(每次都是真實 Replicate/fal.ai 訓練賬單)、`retrain`、`captionImages`(LLM vision 呼叫)、`autofillAngles`(fal.ai 圖片生成),站方成本與呼叫次數線性相關,但沒有任何技術上的煞車——即使排除惡意濫用,一般使用者手滑重複點擊也會造成非預期的重複扣費(對站方,不是對使用者,因為使用者本來就沒被扣點)。

**建議**:
1. 至少為 `create`/`retrain` 加上與 `loraTrainer.trainWithReplicate` 對等的 `checkTrpcRateLimit`(次數/小時)+ 併發上限檢查(`models.ts` 目前完全沒有查詢「使用者目前有幾個 pending/training 模型」)。
2. `captionImages`/`autofillAngles` 建議换成 `generationProcedure`/`audioGenerationProcedure` 等既有的 rate-limited procedure,並評估是否要對這兩個「輔助型」AI 呼叫也計入點數(即使定價比正式生成低)。
3. 中長期應該讓 `dispatchImageGeneration`(`falDispatcher.ts:727-753`)補上 `userId`/`estimatedCredits` 欄位,讓 `autofillAngles` 這類呼叫端有機會接上既有的 `deductCredits`/`reconcileCredits` 機制。

---

### 3.【High・新發現】`safeApiCall` 對逾時觸發的重試,不會取消/中斷前一次呼叫,可能對同一個真實付費供應商 API 疊加送出多次生成請求

**證據**:`safeApiCall`(`server/services/modelClients.ts:148-205`)的核心邏輯:
```ts
// modelClients.ts:157-169
for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`[${label}] Timeout after ${cfg.timeoutMs}ms`)),
          cfg.timeoutMs
        )
      ),
    ]);
    ...
```
`Promise.race` 只是「我方先看哪個先解決」——當我方的 `setTimeout` 先觸發、reject,`fn()`(對供應商送出的實際請求)**並未被中斷**;供應商那端仍可能繼續處理甚至完成計費。`isRetryableError`(:74-117)把 `timeout`/`timed out` 判定為可重試錯誤,於是 `for` 迴圈的下一輪會**重新呼叫一次 `fn()`**——對同一個 prompt/input 再送出一次全新請求。

四個實際使用 `safeApiCall` 的呼叫點都符合這個模式,且**沒有任何一個傳入 `AbortController`/`signal`**(全檔案搜尋 `Abort|signal` 零命中):
- `FalClient.generateImage`:`this.client!.subscribe(modelId, {input, logs:false})`(:260-277,timeoutMs 180000)
- `FalClient.generateVideo`:同款 `.subscribe(...)`(:334-337,timeoutMs 300000)
- `SunoClient.generateMusic`:`fetch(...)`(:467-474,timeoutMs 60000)
- `ElevenLabsClient.textToSpeech`:`fetch(...)`(:682-697,timeoutMs 60000)
- `ReplicateClient.run`:`this.client!.run(...)`(:886-889,timeoutMs 300000)

`DEFAULT_RETRY_CONFIG.maxRetries = 3`(:64-69)——意味著單一次真正「只是慢、最終會成功」的呼叫,理論上可能被我方誤判逾時後,額外再送出最多 3 次全新請求,而前面幾次請求並未真的被取消。

**影響**:若供應商是「收到請求就開始計費/建立任務」的模型(例如 fal.ai 佇列任務、Replicate prediction、Suno 生成任務——這點屬於第三方計費模型,本檔案內無法直接證實其計費時點,但以生成式 AI API 常見的「提交即扣費/建立任務」慣例推斷風險存在),則一次「使用者體感很慢」的請求可能演變成 2~4 次真實計費任務同時在跑,其中 1 個(若稍晚才回)結果會被我方程式碼忽略——這與 `docs/research/X14-training-billing-deepdive.md` 發現 2(fal 訓練逾時不取消任務)是同一類「本地放棄、供應商端繼續燒錢」問題,但本次額外坐實的是「不只放棄一次,重試機制會疊加送出更多次」。

**建議**:
1. 為四個呼叫點補上 `AbortController`,`timeoutMs` 到期時真正中止底層 HTTP 請求(`fetch` 原生支援 `signal`;`@fal-ai/client`/`replicate` SDK 是否支援需查閱各自文件,若不支援至少應改用非阻塞的 submit+poll 模式而非長輪詢 `subscribe`/`run`)。
2. 對「逾時」錯誤與「明確失敗(4xx/5xx)」錯誤採不同重試策略——逾時不應該無條件視為可重試,至少應先查詢供應商端是否已有對應任務存在(如 fal 的 `request_id`)再決定是否重送,避免對非冪等的生成類 API 疊加請求。

---

### 4.【High・新發現】`FalClient.generateImage` 遇到未知的 `model` 值時,靜默退回到最貴的 `flux-pro`,無任何錯誤或警告

**證據**:`server/services/modelClients.ts:249-256`
```ts
const modelMap: Record<string, string> = {
  "flux-pro": "fal-ai/flux-pro/v1.1",
  "flux-schnell": "fal-ai/flux/schnell",
  "stable-diffusion-xl": "fal-ai/stable-diffusion-xl",
};

const modelId =
  modelMap[params.model || "flux-pro"] || modelMap["flux-pro"];
```
若呼叫端傳入的 `params.model` 不是這三個 key 之一(例如打錯字、傳入 fal 的完整 model id 字串而非這裡定義的短別名、或未來新增模型別名但這裡漏改),`modelMap[params.model]` 是 `undefined`,運算式退回 `undefined || modelMap["flux-pro"]` = `"fal-ai/flux-pro/v1.1"`——**三個選項中定價最高的 Pro 版**。全函式沒有任何 `console.warn`/錯誤紀錄告知「你要的模型找不到,已改用 flux-pro」。

對照 `FalClient.generateVideo`(:312-319)的等價邏輯,預設退回值是 `"kling-v1"`(標準版,非最貴的 `runway-gen3`),同樣的程式碼結構在圖片路徑放大了風險(退回值剛好是最貴選項),在影片路徑則相對溫和(退回值是相對便宜選項)——兩處寫法一致,只是資料剛好造成不對稱後果。

**影響**:若呼叫端原本要打便宜/快速的 `flux-schnell`,但因為型別不對齊或字串拼寫落差導致 key 沒對上,使用者/系統會在不知情的狀況下改叫定價較高的 `flux-pro`,造成「選錯模型計錯價」——且因為沒有任何日誌或錯誤,除非事後對帳,否則不會被發現。（**範圍誠實說明**:本次稽核確認 `FalClient.generateImage` 目前在 production 沒有任何呼叫點——見發現 5——因此此 bug 目前不會被觸發;但若日後這個類別被重新啟用或被其他呼叫端引用,這個地雷會直接復燃,值得現在就修掉。）

**建議**:把 `||` 退回邏輯改成明確白名單校驗——找不到對應 key 時應該拋出錯誤(或至少 `console.error` 並標記為 `degraded`),不要用「剛好也在同一個物件字面量裡最後定義的那個 key」當隱性預設值;同時建議退回策略永遠指向「最保守/最便宜」的選項,而不是讓維護者無意間把最貴模型放在 fallback 位置。

---

### 5.【High・新發現】`modelClients.ts` 標榜的「四模態統一路由 + 健康檢查」在 production 幾乎全是死碼——只有 `SunoClient` 真的被外部呼叫

**證據**:檔頭註解(:1-15)宣稱本檔案「統一封裝 Fal.ai(圖片/影片)、Suno(音樂)、ElevenLabs(語音)、Replicate(進階預留)四大生成引擎」,並列出 `ModelOrchestrator` 提供「四模態統一路由 + 健康檢查」。但對全 repo(`*.ts`)逐一 grep 呼叫點後:

- `getOrchestrator()` 只在三個檔案被 import:`server/routers.ts:114`、`server/routers/ai.ts:177`、`server/services/modelClients.ts` 自己。**前兩者 import 進來後,全檔案搜尋都找不到第二次出現「`getOrchestrator`」的字樣**——也就是說這是兩個完全沒用到的 import(dead import)。`server/routers.ts:115` 自己的註解寫著:「voiceCompiler, audioCompiler, videoCompiler are no longer used — all modalities route through falDispatcher」,印證圖片/影片/語音三個模態的真正生成路徑早已改道到 `falDispatcher.ts`,不再經過這支「四模態 Orchestrator」。
- 真正呼叫 `getOrchestrator()` 並使用回傳值的,只有 `server/routers/proStudio.ts:2029,2148` 與 `server/services/agentToolExecutor.ts:1428`——**三處都只取用 `.suno`**,分別呼叫 `suno.generateMusic()`(proStudio.ts 有搭配 `chargeForFalTask`/`refundUserPoints` 正確計費)與 `suno.getTaskStatus()`。
- `getOrchestrator().fal`、`getOrchestrator().replicate`、`getOrchestrator().elevenlabs` **在整個 repo 裡沒有任何一次被存取**(`grep getOrchestrator\(\)\.\(elevenlabs\|replicate\|fal\)` 零命中)。連帶地,`FalClient.generateImage`/`generateVideo`/`healthCheck`、`ReplicateClient.run`/`healthCheck`、`ElevenLabsClient.textToSpeech`/`listVoices`/`healthCheck`,以及 `ModelOrchestrator.generate()`(:988-1090)、`healthCheckAll()`(:1095-1123)、`getAvailableModalities()`(:1128-1140)、`resetOrchestrator()`(:1159-1164)全部沒有呼叫點,是**純粹的死碼**——它們仍會在 `ModelOrchestrator` 建構時(`new FalClient()`/`new ReplicateClient()`/`new ElevenLabsClient()`,:979-982)被 instantiate、印出「✅ Initialized」或「⚠️ 未設定」的 log,但除此之外的方法本體永遠不會在目前的呼叫圖裡被執行到。
- 值得注意:`models.ts` 裡真正的 Replicate 呼叫(`syncReplicateStatus`,:152-155)是 `import("../services/replicateClient.js")` 的 `getReplicateClient()`——**這是另一個檔案的另一個 client**,與本檔案 `modelClients.ts` 的 `ReplicateClient` class 完全無關,兩者並存但職責已經分家。

**影響**:這不是功能性 bug(死碼不會被觸發、不會產生錯誤行為),但屬於「死碼/契約不符」——檔頭文件描述的架構(四模態統一路由)與實際執行路徑(只有 Suno 走這裡,圖片/影片走 falDispatcher,語音本檔案內完全無人呼叫,Replicate 訓練走另一個同名但不同檔案的 client)脫節,容易誤導後續維護者以為改這裡的 `FalClient`/`ReplicateClient`/`healthCheckAll` 會影響 production 行為,實際上不會;也代表 `healthCheckAll()` 這個「看似存在的健康監控儀表板資料來源」目前沒有任何 UI/排程真的呼叫它,如果有維運人員以為系統有這層健康檢查在跑,認知會與事實不符。

**建議**:
1. 若确定圖片/影片/語音生成已全面改走 `falDispatcher.ts`,建議直接刪除 `FalClient`/`ReplicateClient`/`ElevenLabsClient`/`ModelOrchestrator.generate`/`healthCheckAll`/`getAvailableModalities` 這些死碼路徑,只保留 `SunoClient`(真的在用)與 `safeApiCall`(被 `geminiMedia.ts` 等外部檔案引用,仍是活的共用工具)。
2. 若這幾個 class 是「刻意保留給未來擴充」,至少在檔頭與 class 上方註解明確標註「目前未接線,production 走 falDispatcher」,並清掉 `routers.ts`/`ai.ts` 兩處無用的 `getOrchestrator` import,避免誤導。
3. 若真的想啟用 `healthCheckAll()` 作為監控儀表板資料源,記得一併處理發現 6(FalClient/SunoClient 的健康檢查目前是「只看金鑰是否存在」而非「金鑰是否有效」)。

---

### 6.【Medium・新發現】`toggleVisibility` 的「首次分享獎勵 3 點」有 TOCTOU 競態,可被同時發出的重複請求重複觸發

**證據**:`server/routers/models.ts:737-756`
```ts
if (
  !isDemoMode() &&
  input.visibility === "team_shared" &&
  model.visibility !== "team_shared"
) {
  const cfg = (model.configJson ?? {}) as Record<string, unknown>;
  const alreadyRewarded = cfg.shareRewarded === true;
  if (model.status === "ready" && !alreadyRewarded) {
    await db.refundUserQuota(ctx.user.id, 3);
    await db.updateFineTunedModel(input.id, {
      configJson: { ...cfg, shareRewarded: true } as typeof model.configJson,
    });
    ...
```
`model`/`cfg`/`alreadyRewarded` 都是在 mutation 一開始(:727)讀取的**同一份快照**,防重複的旗標 `shareRewarded` 要等到 `refundUserQuota` 執行**之後**才寫回 DB(:746-751)。若同一使用者對同一模型幾乎同時發出兩個 `toggleVisibility({visibility:"team_shared"})` 請求,兩個請求各自的 `db.getFineTunedModel(input.id)`(:727)都可能在對方寫回 `shareRewarded:true` 之前完成讀取,此時兩者讀到的 `cfg.shareRewarded` 都是 `false`/`undefined`,都會各自呼叫一次 `db.refundUserQuota(ctx.user.id, 3)`——即使 `refundUserQuota` 本身透過 `SELECT ... FOR UPDATE` 交易正確地做到「每次呼叫的 +3 都會確實入帳」(`server/db.ts:769-796`,已核對,原子性沒有問題),問題出在「要不要呼叫」這個判斷本身不是原子的,兩次呼叫就是兩次 +3,總共 +6。

**影響**:使用者可透過連續快速點擊/併發呼叫 `toggleVisibility` 重複領取「首次分享」獎勵,每次多拿 3 點配額。單次金額不大,但屬於可重複觸發的營運漏洞。

**建議**:把「讀取 shareRewarded → 判斷 → refundUserQuota → 寫回 shareRewarded」整個序列改成一個原子的 SQL 更新(例如 `UPDATE fineTunedModels SET configJson = JSON_SET(configJson, '$.shareRewarded', true) WHERE id = ? AND JSON_EXTRACT(configJson, '$.shareRewarded') IS NOT TRUE`,靠受影響列數判斷「這次呼叫是不是真的搶到了那把鎖」,搶到才呼叫 `refundUserQuota`),或至少在 `refundUserQuota` 前後包一層資料庫鎖/唯一約束防止同一模型被併發領獎兩次。

---

### 7.【Medium・新發現】`retrain` 重新提交訓練前,不會重新檢查同意書(consent)是否已撤回或過期

**證據**:`server/routers/models.ts:202-268`(`retrain`)全函式搜尋 `consent`/`Consent`,**零命中**。對照 `create`(:332-381)在建立模型前會完整驗證 `consentIds`(逐一檢查 `db.isConsentActive`、是否屬於本人、`portrait_lora` 是否誤用 `photo_usage` 類型的同意書),`retrain` 只是讀出既有 `model.configJson` 裡的 `triggerWord`/`epochs`/`learningRate`/`datasetImages`,直接重新呼叫 `runLoraTrainingJob`(:249-265)——**完全不重新檢查這批 `imageUrls` 背後的同意書當下是否仍然有效**。

**影響**:若使用者在 `create` 時合法簽署了同意書、模型訓練失敗,而後**該同意書被當事人撤回**(`db.revokeModelTrainingConsent`,`db.ts:1114-1124`)——此時使用者呼叫 `retrain`,系統仍會拿同一批資料集圖片重新送去訓練,不會發現 consent 已經撤回。這是「授權在建立當下有效,但後續操作不重新驗證」的時間點漏洞,與 `docs/research/X14-training-billing-deepdive.md` 發現 1(`loraTrainer.trainWithReplicate` 完全没有 consent 檢查)是同一主題下的不同角度:前者是「另一個入口沒有門檻」,這裡是「同一個入口的門檻只在建立時檢查一次,續作/重試不重新檢查」。

**建議**:`retrain` 在重新呼叫訓練前,應該重新查詢該模型關聯的 consent(`db.getConsentsForModel(modelId)`,`db.ts:1156-1170` 已存在)並用 `isConsentActive` 逐一複驗;若任一必要同意書已撤回/過期,應該擋下 `retrain` 並提示使用者需要重新簽署。

---

### 8.【Medium・新發現】`FalClient.generateImage`/`generateVideo` 用 `&&` 短路運算組參數,`seed`/`guidanceScale` 傳 `0` 時會被整個忽略

**證據**:`server/services/modelClients.ts:268-271`
```ts
...(params.guidanceScale && {
  guidance_scale: params.guidanceScale,
}),
...(params.seed && { seed: params.seed }),
```
函式簽名(:233-241)明確允許 `seed?: number`、`guidanceScale?: number`——`0` 是這兩個欄位型別上完全合法的值(`seed: 0` 是常見的「固定種子重現結果」用法)。但 `params.seed && {...}` 這個寫法,當 `params.seed === 0` 時,`0` 本身是 falsy,整個 spread 不會展開,等同於「呼叫端明明指定了 `seed: 0`,實際送給 fal.ai 的請求卻沒有帶 `seed` 欄位」——會讓 fal.ai 使用隨機種子而非呼叫端要求的固定種子 0,導致「指定種子卻不可重現」的靜默行為落差。

**影響**:範圍限定在「呼叫端剛好把 `seed`/`guidanceScale` 設為 `0`」這個特定輸入下,且如前述(發現 5)`FalClient.generateImage` 目前無人呼叫,實際爆炸半徑為零;但若之後重新啟用會直接復現這個 bug,建議與發現 5 的清理/重新啟用一併處理。

**建議**:改用顯式的 `!== undefined` 檢查(例如 `params.seed !== undefined && { seed: params.seed }`),避免用真假值短路運算處理「數值型且 0 為合法值」的可選欄位。

---

### 9.【Medium・新發現】`FalClient`/`SunoClient` 的健康檢查只看金鑰「有沒有設定」,不像 `ElevenLabsClient`/`ReplicateClient` 那樣真的打一次 API 驗證金鑰是否仍然有效

**證據**:
```ts
// modelClients.ts:358-376(FalClient.healthCheck)
async healthCheck(): Promise<ClientHealth> {
  const start = Date.now();
  try {
    if (!this.initialized) {
      return { status: "offline", ... errorMessage: "FAL_API_KEY not set" };
    }
    // Lightweight check — just verify credentials
    // Fal doesn't have a dedicated health endpoint, so we check init status
    return { status: "online", lastChecked: Date.now(), ... errorMessage: null };
  } ...
}
```
```ts
// modelClients.ts:605-621(SunoClient.healthCheck)— 同款寫法,只檢查 this.apiKey 是否存在,
// 存在就直接回 "online",沒有真的呼叫 apibox.erweima.ai 的任何端點驗證金鑰有效性。
```
對照組 `ElevenLabsClient.healthCheck()`(:796-841)會真的 `fetch(`${this.baseUrl}/user`, {...})` 並依 HTTP 狀態碼細分 `online`/`degraded`(401 → 金鑰過期)/`offline`;`ReplicateClient.healthCheck()`(:938-965)會真的呼叫 `this.client.accounts.current()`。這兩組健康檢查的嚴謹程度並不一致——`FalClient`/`SunoClient` 這兩個「只看初始化旗標」的版本,在金鑰已被供應商撤銷/過期、但環境變數字串本身還在的狀況下,仍會回報 `"online"`(fail-open:預設判定為健康,而非保守判定為不確定/degraded)。

**影響**:如發現 5 所述,`healthCheckAll()` 目前在 production 沒有呼叫點,所以這個不精確的健康檢查目前不會誤導任何真實的監控儀表板或告警;但這是本檔案「供應商錯誤處理」邏輯本身內部不一致的問題,一旦 `healthCheckAll` 被接上任何監控用途,`FalClient`/`SunoClient` 這兩項會比 `ElevenLabsClient`/`ReplicateClient` 更容易產生「假性健康」的誤報。

**建議**:比照 `ElevenLabsClient`/`ReplicateClient` 的作法,為 `FalClient`/`SunoClient` 補上一次輕量、真正打 API 的驗證呼叫(例如 fal.ai 的帳號/額度查詢端點、Suno/apibox 的帳號資訊端點),而非只用「建構時是否讀到環境變數」代表「目前是否可用」。

---

### 10.【Medium・新發現,信心中等】`autofillAngles`/`captionImages` 的 `withTimeout` 逾時後不會取消底層的 fal.ai / LLM 呼叫,可能浪費已產生的供應商費用

**證據**:`withTimeout`(`server/services/director/templates.ts:17-38`)是純 `Promise.race` 包裝,`reject` 只影響呼叫端看到的結果,不影響被包裝的 `promise` 本身是否繼續執行。`models.ts` 用它包住兩處真實付費呼叫:
- `captionImages`(:522-548):`withTimeout(invokeLLM(...), 20_000, "圖片標註")`——單張圖片逾時算失敗,fallback 成固定字串(:552-554),但底層 `invokeLLM` 呼叫並未被中斷。
- `autofillAngles`(:633-643):`withTimeout(dispatchImageGeneration(...), 120_000, ...)`——逾時算該角度失敗、計入 `failures`(:645-650),底層 fal.ai 任務同樣未被中斷。

**影響範圍的誠實說明**:這與發現 3(`safeApiCall` 逾時不取消)是同一類「本地放棄、供應商端繼續執行」問題,但風險程度較低——`invokeLLM`(vision 圖說)與 `nano-banana/edit`(圖片語意編輯)兩者通常都是秒級到十幾秒級的操作,20 秒/120 秒的逾時視窗理論上足夠寬裕,實際觸發機率遠低於 X14 描述的「60 分鐘 LoRA 訓練」情境。本檔案內無法驗證 `dispatchImageGeneration`/`invokeLLM` 內部是否對逾時後的殘留任務有任何補救(不在本次稽核的兩個目標檔案範圍內),誠實列為「潛在風險,未在本檔案內坐實為高機率事件」。

**建議**:比照發現 3 的建議,評估是否值得為這兩處也補上 `AbortController`;優先順序低於發現 3(safeApiCall 是四個供應商共用的基礎設施,影響面更廣)。

---

## 附帶低嚴重度觀察(非結構化輸出必列項,列於此供完整性參考)

- **`create` 檢查 fal/Replicate 金鑰用未經 trim 的 `process.env`,與 `ensureFalApiKeyConfigured()` 的 `serverEnv.FAL_API_KEY?.trim()` 不一致**(`models.ts:444` vs `server/_core/apiGuards.ts:5`)。若環境變數被誤設為純空白字串,`create` 會誤判「已設定」而放行,實際呼叫 fal.ai 時才會因空白金鑰失敗,使用者得到的錯誤訊息會是底層 API 的原始錯誤而非「金鑰未設定」的友善提示。影響範圍限定於組態設定錯誤的邊界情境,非預設路徑。
- **`delete` mutation(`models.ts:791-800`)只刪除 `fineTunedModels` 資料列**,未見刪除底層 storage 物件(訓練資料集圖片/影片、`trainedLoraUrl` 指向的權重檔)或撤銷 `fineTunedModelConsents` 關聯紀錄的呼叫;是否有獨立的背景清除任務或 storage 生命週期規則處理這件事,不在本次稽核的兩個目標檔案範圍內,未驗證,誠實列為待查項而非坐實缺陷。

---

## 已驗證排除的疑慮(Negative Results)

以下項目經逐行檢查後**確認不成立**,列出避免報告只呈現壞消息:

1. **`create` 的同意書(consent)門檻邏輯本身正確且完整**——`models.ts:332-381` 對 `self`/`real_person`/`copyrighted`/`portrait_lora` 四種需要授權的情境,逐一檢查 `consentIds` 非空、批次查詢(`db.getModelTrainingConsentsByIds`,`db.ts:1104-1112`,已是批次查詢而非 N+1)、每筆同意書 `userId` 必須等於呼叫者(:353)、`isConsentActive`(`db.ts:1130-1140`,正確處理 `revokedAt`/`validFrom`/`validUntil` 三個時間條件)、以及 `portrait_lora` 不可誤用 `photo_usage` 類型同意書(:371-379)。這一段的邏輯本身沒有繞過或邏輯漏洞——問題出在發現 7(`retrain` 不重新驗證)與已知的 `loraTrainer.trainWithReplicate` 平行入口沒有這道門檻(X14 發現 1),而不是這段程式碼本身寫錯。
2. **`getById`/`getAnalysis`/`trainingStatus`/`syncReplicateStatus`/`retrain`/`toggleVisibility`/`update`/`delete`/`incrementUsage` 對「本人模型」的擁有權檢查(`model.userId !== ctx.user.id`)全部正確且一致**——除了發現 1 指出的「team_shared 分支」漏洞外,「非本人且非 team_shared」的一般情境下,九個端點沒有一個漏掉這道檢查。
3. **`updateFineTunedModel` 的 `configJson` 合併邏輯正確**(`server/db.ts:1026-1053`)——每次更新前會先讀出既有 `configJson` 再淺層合併寫入新欄位,不會因為某次呼叫只想改 `triggerWord` 就把 `datasetImages`/`batchSize`/`isStyle` 等既有欄位整個清空。`models.ts` 內對 `configJson` 的三處寫入(`create`/`toggleVisibility`/`update`)都是透過這支函式,沒有繞過合併邏輯直接覆寫整欄。
4. **`refundUserQuota`/`deductUserQuota` 本身的原子性沒有問題**(`server/db.ts:707-763,769-796`)——兩者都用 `db.transaction` + `SELECT ... FOR UPDATE` 鎖住該使用者列後才做 `± amount` 的 SQL 端運算,不是「讀 balance 算好再寫回」的危險序列。發現 6 描述的競態,問題出在「要不要呼叫這支函式」的應用層判斷不是原子的,不是這支函式自己的鎖有漏洞。
5. **`modelClients.ts` 四個 client 都沒有把 API 金鑰值寫進任何 log 或錯誤訊息**——`FalClient`/`SunoClient`/`ElevenLabsClient`/`ReplicateClient` 的建構子只 log「✅ Initialized with X_API_KEY」/「⚠️ X_API_KEY not set」這類「有沒有設定」的訊息(例如 :220-223、399-402、643-649、855-859),金鑰本身只用於 `Authorization`/`xi-api-key` 標頭或 SDK 建構參數,全檔案搜尋沒有任何 `console.log`/錯誤訊息把金鑰字串本身印出來或回傳給呼叫端。
6. **`traceToolRun`(供 `SunoClient`/`ElevenLabsClient`/`ReplicateClient` 記錄呼叫軌跡用)不會因為觀測性基礎設施故障而讓生成流程失敗**——`server/services/langsmithTracer.ts:55-83` 把 LangSmith 呼叫包在自己的 `try/catch`,catch 區塊是空的(靜默吞掉),`getLangSmithClient()`(:5-18)本身也吞掉初始化錯誤回傳 `null`。`modelClients.ts` 對 `traceToolRun` 的呼叫(例如 :497-511、519-535)沒有额外包一層防護,但因為 `traceToolRun` 自己已經 fail-safe,不會反過來讓 `generateMusic`/`textToSpeech`/`replicate.run` 的主流程因為 LangSmith 掛掉而跟著壞掉。
7. **`SunoClient.generateMusic` 的請求欄位映射與既有文件記載的 2026-05 供應商契約變更一致**(:434-451,注解記載 apibox.erweima.ai 從 `mv`/`make_instrumental` 舊契約改成 `model`/`instrumental` 新契約),`getTaskStatus` 的端點路徑與欄位相容處理(:561-599)也與注解描述的「新舊 shape 都要接住」邏輯吻合,實際核對程式碼沒有發現注解與實作不一致的地方。
8. **`proStudio.ts` 的 `generateMusicSuno`/`checkMusicSunoStatus` 透過本檔案 `SunoClient` 呼叫時,計費邏輯完整**(`proStudio.ts:2013-2060` 附近,`chargeForFalTask`→失敗 `refundUserPoints`)——`modelClients.ts` 本身雖然不做任何計費(它只是薄的 API wrapper,設計上刻意把計費交給呼叫端),但至少 `proStudio.ts` 這個呼叫端有把計費接好。（對照組:`agentToolExecutor.ts:1423-1515` 的光球 `studio.generateAudio` 走 Suno 分支時完全沒有計費呼叫——但這個缺口屬於 `agentToolExecutor.ts` 檔案本身的問題,不在本次稽核的兩個目標檔案範圍內,僅作為交叉參考列出,不計入本報告的結構化發現。）

---

## 總結排序(依嚴重度)

1. **Critical**(發現 1):`teamModels`/`getById`/`getAnalysis` 把 team_shared 當全站公開,跨團隊 IDOR——已知(K1-4/P4 修復卡 5),本次重新驗證於 HEAD 仍存在,尚未修復。
2. **Critical**(發現 2):`create`/`retrain`/`captionImages`/`autofillAngles` 零頻率限制、零計費,真實 GPU/API 成本無技術煞車。
3. **High**(發現 3):`safeApiCall` 逾時觸發的重試不取消底層呼叫,可能對同一供應商疊加送出多次真實付費請求。
4. **High**(發現 4):`FalClient.generateImage` 未知模型 key 靜默退回最貴的 `flux-pro`(目前為死碼,無呼叫點,但邏輯本身待修)。
5. **High**(發現 5):`ModelOrchestrator`/`FalClient`/`ReplicateClient`/`ElevenLabsClient` 絕大部分方法是死碼,只有 `SunoClient` 真正在用,與檔頭文件宣稱的「四模態統一路由」脫節。
6. **Medium**(發現 6):`toggleVisibility` 首次分享獎勵有 TOCTOU 競態,可重複領取 +3 配額。
7. **Medium**(發現 7):`retrain` 不重新檢查 consent 是否已撤回/過期。
8. **Medium**(發現 8):`FalClient` 圖片/影片生成的 `seed`/`guidanceScale` 用 `&&` 短路運算,`0` 值會被靜默丟棄(目前為死碼,邏輯本身待修)。
9. **Medium**(發現 9):`FalClient`/`SunoClient` 健康檢查只看金鑰是否設定,不驗證是否仍然有效,與 `ElevenLabsClient`/`ReplicateClient` 不一致(目前 `healthCheckAll` 為死碼,實際影響為零,但邏輯本身待修)。
10. **Medium/信心中等**(發現 10):`autofillAngles`/`captionImages` 的 `withTimeout` 逾時不取消底層呼叫,風險程度低於發現 3。
11. **Low**(附帶觀察):`create` 對 FAL_API_KEY 的檢查未 trim,與 `ensureFalApiKeyConfigured` 不一致;`delete` 未見清除底層 storage/consent 關聯(待查,未坐實)。

**已驗證排除**:`create` 的 consent 驗證邏輯本身正確完整;九個端點的一般擁有權檢查(非 team_shared 情境)全部正確;`configJson` 合併邏輯正確;`refundUserQuota`/`deductUserQuota` 的資料庫層原子性沒有問題;四個 client 都沒有洩漏 API 金鑰值;`traceToolRun` 觀測性故障不會拖垮生成主流程;`SunoClient` 的供應商契約映射與既有文件記載一致;`proStudio.ts` 呼叫 `SunoClient` 時計費邏輯完整。
