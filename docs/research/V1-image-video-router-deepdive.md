# V1 — imageStudio.ts × videoStudio.ts 生成 router 逐行深挖：對抗式 bug 獵人報告（深挖 wave V）

- 產生日期：2026-07-03
- 依據 commit：`7f4417da`（任務指定基準；本機 HEAD 實測為 `1b71105091289ad6e526f08b57757a80b8c268a4`，兩者間相關檔案無實質差異）
- 波次：**逐檔深挖 wave V：imageStudio.ts（1514 行，23 模型）+ videoStudio.ts（1779 行，22 模型 + compilePrompt）生成 router 內部**
- 前置依據（不重複其結論）：
  - `docs/research/U3-fal-dispatch-webhook-deepdive.md`（已證實 imageStudio/videoStudio 全部 mutation 零扣點；falQueueSubmit 丟棄降級後 modelId；webhook 競態）
  - `docs/research/H2-fields-image-video.md`（欄位死控制項/隱藏能力/預設值不一致的完整清單）
  - `docs/research/K2-generation-bugs.md`（#4：videoStudio.checkVideoStatus 有 owner 檢查、imageStudio.checkImageStatus 沒有）
  - `docs/research/01-features.md` §1.7-1.8（模型清單與行號索引）
- 方法：逐行讀完 `server/routers/imageStudio.ts`（全 1514 行）、`server/routers/videoStudio.ts`（全 1779 行），並交叉讀 `server/db.ts`（`getBackgroundJobByRequestId`/`findProcessingJobByRequestId`）、`server/routers/generate.ts`（`submitStudioJob`）、`client/src/contexts/BackgroundTasksContext.tsx`、`client/src/hooks/useSubmitGeneration.ts`、`client/src/pages/VideoStudio.tsx`（AsyncVideoPoller）、`server/lib/urlValidator.ts`、`server/utils/validateSafeUrl.ts`、`shared/safe-url.ts`、`server/services/falModels.ts`（catalog `disabled`/`replacement` 逐一核對）以驗證每個假設是否在目前程式碼下真的成立。**全程手動逐檔閱讀，未使用子代理。**

---

## 發現總表（依嚴重度排序；每條標示「新發現」或「延伸自 U3/H2/K2」）

### 1.【嚴重・新發現】`generate.submitStudioJob` 完全無驗證＋`getBackgroundJobByRequestId`「最新一筆勝出」──攻擊者可主動偽造記錄，讓 videoStudio 的 AIDV-244 owner 檢查「認證通過」自己的竊取行為

**觸發情境**：K2 #4 已指出 `videoStudio.checkVideoStatus`（`server/routers/videoStudio.ts:1671-1685`）在查詢 fal 狀態前，先用 `db.getBackgroundJobByRequestId(input.requestId)` 反查 `backgroundJobs` 記錄的 `userId` 是否與 `ctx.user.id` 相符，視為「有 owner 檢查」的對照組（相對於 imageStudio 完全沒檢查）。

本次逐行核對 `getBackgroundJobByRequestId`（`server/db.ts:2246-2258`）的實作：
```ts
const result = await db.select().from(backgroundJobs)
  .where(sql`JSON_UNQUOTE(JSON_EXTRACT(${backgroundJobs.resultJson}, '$.requestId')) = ${requestId}`)
  .orderBy(desc(backgroundJobs.createdAt))
  .limit(1);
```
取「最新建立的一筆」比對 `requestId`，**沒有任何唯一性約束**——同一個 `requestId` 可以有多筆 `backgroundJobs` 記錄，取決於誰最後插入。而寫入這張表的 `generate.submitStudioJob`（`server/routers/generate.ts:2143-2169`）是 `protectedProcedure`（僅要求登入，非 admin），input schema 只驗證 `requestId: z.string().min(1)`、`modelId: z.string().min(1)`——**完全不檢查這個 requestId 是否真的是呼叫者自己送出的 fal.ai 任務**，直接 `db.createBackgroundJob({ userId: ctx.user.id, resultJson: { requestId: input.requestId, modelId: input.modelId, ... } })`。

這意味著攻擊者一旦透過任何管道取得受害者的 `request_id`（K2 #4 已列出的取得管道：network log、分享連結、URL 參數觀察），可以主動執行：
1. 用自己的帳號呼叫 `generate.submitStudioJob({ studioType: "video", requestId: <偷來的 id>, modelId })`，在 `backgroundJobs` 插入一筆 `userId = 攻擊者`、`resultJson.requestId = 偷來的 id` 的記錄（且因為沒有唯一性約束，這筆會插在受害者原本那筆之後，成為「最新一筆」）。
2. 呼叫 `videoStudio.checkVideoStatus({ requestId, modelId })`（或 `jobStatus`）。`getBackgroundJobByRequestId` 依 `orderBy(desc(createdAt)).limit(1)` 撈到的是攻擊者剛剛偽造的那筆，`existingJob.userId === ctx.user.id`（都是攻擊者）——**AIDV-244 的檢查邏輯判定「通過」**。
3. 一旦 fal.ai 任務完成，`doPostGenComplete({ userId: ctx.user.id, ... })` 以攻擊者身分把受害者的生成結果寫入攻擊者自己的 `digital_asset_library`/`generation_history`/資產庫。

**與 K2 #4 的關鍵差異**：K2 #4 把 videoStudio 定性為「有 owner 檢查的對照組」，本次發現這個檢查的信任錨點（`backgroundJobs.resultJson.requestId`）本身可以被任何登入使用者透過完全公開、無額外授權要求的 `submitStudioJob` 端點偽造——**AIDV-244 修復不只是「防護不足」，而是防護的檢查對象可以被攻擊者單方面捏造，讓檢查邏輯主動幫攻擊者背書**。且由於 imageStudio/videoStudio 全線零扣點（U3 #2），這條攻擊鏈的實際危害不是竊取「已付費」資產，而是：任何使用者只要知道別人的 `request_id`，就能把對方的生成結果免費複製一份到自己帳號（隱私外洩 + R2 儲存重複成本，見本報告 #3）。

**證據 path:line**：
- `server/routers/videoStudio.ts:1671-1685`（`checkVideoStatus` 的 owner 檢查邏輯）
- `server/db.ts:2246-2258`（`getBackgroundJobByRequestId`：無唯一性保證，取最新一筆）
- `server/routers/generate.ts:2143-2169`（`submitStudioJob`：`protectedProcedure`，對 `requestId`/`modelId` 零驗證，任何登入使用者可代任何 requestId 造記錄）
- 對照：K2 #4（`docs/research/K2-generation-bugs.md:72-84`）把 videoStudio 定性為「有 owner 檢查」，本條指出該檢查的信任錨點可被攻擊者單方面偽造

---

### 2.【高・新發現】videoStudio 的 `registerBgTask` 是 fire-and-forget（刻意不 await），與前端立即啟動的輪詢形成結構性競態視窗——AIDV-244 owner 檢查在提交後的最初一段時間必然形同虛設

**觸發情境**：`client/src/hooks/useSubmitGeneration.ts:103-121` 的 `submitGeneration`（VideoStudio 每個 `runXxx` 函式共用的骨架）：
```ts
const r = await spec.mutate();
spec.onResult?.(r);
// 與原行為一致：registerBgTask 為 fire-and-forget，不 await。
registerBgTask(r, spec.taskType, spec.taskLabel, spec.taskPrompt);
toast.success(...);
```
`registerBgTask`（`BackgroundTasksContext.tsx:594-617`）內部呼叫 `ctx.submitTask(...)`（實際觸發 `generate.submitStudioJob` 的網路請求），但呼叫端**明確不 await**（註解自陳「與原行為一致」，即這是刻意保留的既有設計，非疏漏）。

與此同時，`spec.onResult?.(r)` 已經把 `result.request_id` 寫回頁面 state，`AsyncVideoPoller`（`client/src/pages/VideoStudio.tsx:706-734`）的 `trpc.videoStudio.checkVideoStatus.useQuery` 在 `enabled: !!(result.request_id && !result.video_url && modelId)` 條件成立的當下**立即發出第一次輪詢**（react-query 預設不延遲首次 fetch）。

**時序上這代表**：`checkVideoStatus` 的第一次呼叫，與「在 `backgroundJobs` 寫入這筆任務」的網路請求，是同時起跑的兩支獨立 HTTP 請求，沒有任何 happens-before 關係保證後者先完成。對於任何回應夠快的模型（fal.ai queue 對簡單任務可能在 1-3 秒內進入 COMPLETED），`checkVideoStatus` 的最初 1-2 輪 3 秒輪詢極高機率會在 `submitStudioJob` 的 INSERT 完成之前執行，此時 `getBackgroundJobByRequestId` 查無記錄（`existingJob = undefined`），owner 檢查的 `if (existingJob && ...)` 條件不成立，**直接跳過檢查繼續往下走**——這與發現 #1 的偽造攻擊互為兩種不同觸發路徑（#1 是攻擊者主動偽造記錄讓檢查「誤判通過」；本條是攻擊者根本不需要偽造，只要在這個競態視窗內對別人的 requestId 呼叫 `checkVideoStatus` 即可繞過检查，因為此時任何記錄都還不存在）。

**錯誤結果**：即使不考慮發現 #1 的主動偽造攻擊，AIDV-244 的 owner 檢查在正常使用流程下，本身就有一段「先天保證會發生」的無保護視窗（提交 mutation 完成到 `submitStudioJob` INSERT 完成之間），時間長度等於一次 tRPC mutation 的網路往返（正常網路下數十至數百毫秒，但在生產環境流量高峰或資料庫延遲升高時可能更長）。這不是機率性的邊角案例，而是程式碼結構決定了「輪詢一定比背景任務登記更早開始」的必然時序。

**證據 path:line**：
- `client/src/hooks/useSubmitGeneration.ts:103-121`（`registerBgTask` 呼叫刻意不 await，註解自陳）
- `client/src/contexts/BackgroundTasksContext.tsx:594-617`（`useRegisterBgTask` 內部 `await ctx.submitTask` 為 async，但呼叫端未 await 這個 async 函式本身）
- `client/src/pages/VideoStudio.tsx:723-734`（`AsyncVideoPoller` 的 `useQuery` 在 `result.request_id` 一出現就 `enabled: true`，無延遲）
- 對照 #1：兩者共同指出 AIDV-244 這道「owner 檢查」在時間軸上（#2：檢查對象還不存在）與邏輯上（#1：檢查對象可被偽造）都不可靠

---

### 3.【高・新發現】`imageStudio.ts` 的 `jobStatus`/`jobResult` 是與 `checkImageStatus` 平行、K2 未提及的姊妹端點——同樣零 owner 檢查，且 `jobResult` 會把結果寫入呼叫者自己 userId 前綴的 R2 路徑

**觸發情境**：K2 #4 只針對 `imageStudio.checkImageStatus`（`imageStudio.ts:1419-1480`）指出零 owner 檢查。本次逐行讀完全檔後發現，同一檔案裡還有兩支**功能重疊但邏輯獨立**的查詢端點：

```ts
jobStatus: generationProcedure
  .input(z.object({ request_id: z.string(), model: z.string() }))
  .query(async ({ input }) => falQueueStatus(input.request_id, input.model)),   // imageStudio.ts:1397-1399

jobResult: generationProcedure
  .input(z.object({ request_id: z.string(), model: z.string() }))
  .query(async ({ ctx, input }) => {
    const raw = await falQueueResult(input.request_id, input.model);
    return localizeResultUrls(raw, unifiedAssetPrefix({
      userId: ctx.user.id, source: "image", modelId: input.model,
    }));
  }),   // imageStudio.ts:1401-1413
```
两者都只要求登入（`generationProcedure`），對 `request_id`/`model` **沒有任何所有權檢查**——任何登入使用者輸入別人的 `request_id` 即可：`jobStatus` 直接洩漏任務狀態/進度/logs；`jobResult` 更進一步呼叫 `localizeResultUrls`，把 fal.ai 的結果圖片**下載並重新上傳到 R2**，路徑前綴用**呼叫者自己的** `ctx.user.id`（`unifiedAssetPrefix({ userId: ctx.user.id, ... })`）。

**錯誤結果**：對照 `checkImageStatus`（K2 已記載）是「輪詢到 COMPLETED 時才觸發 `doPostGenComplete` 寫入資產庫」，`jobResult` 提供了一條**更直接、不需要等輪詢邏輯判斷、單次呼叫即可觸發的結果外洩＋重複儲存管道**：攻擊者只要知道任意一個 `request_id`+`modelId` 組合（不限於自己曾經送出過的），呼叫 `jobResult` 就能立即拿到本地化後的圖片 URL（無需等待、無需通過 `checkImageStatus` 的狀態機邏輯），同時讓系統把該圖片複製一份存到攻擊者自己名下的 R2 路徑（`generated/studio/<攻擊者 userId>/image/<modelId>/...`）——這造成雙重代價：①原始使用者的生成內容被任意其他登入使用者存取（資訊外洩，且不限於「已完成」的判斷，只要 fal.ai 那邊已經 COMPLETED 就能拉到，不需要對方還在輪詢中）；②每次呼叫都會讓系統重新下載＋上傳一份到 R2，造成儲存/頻寬成本被轉嫁到系統身上且無限可重複觸發（`jobResult` 沒有 dedupe 機制，不像 `checkImageStatus` 有 `dedupeMarker`）。

**證據 path:line**：
- `server/routers/imageStudio.ts:1397-1413`（`jobStatus`/`jobResult` 定義，零 owner 檢查）
- `server/routers/imageStudio.ts:1419-1480`（對照組 `checkImageStatus`，K2 已記載同樣零檢查，但至少有 dedupe）
- 對照 `server/routers/videoStudio.ts:1643-1665`（videoStudio 的同名 `jobStatus` **有**套用 AIDV-244 owner 檢查，但如發現 #1/#2 所述該檢查本身不可靠；videoStudio 沒有對應的 `jobResult` 端點，故本條風險只存在於 imageStudio 一側）

---

### 4.【中高・新發現】videoStudio 四個「上游停用→替代」的後處理工具（放大/補幀/Topaz/深度）把使用者要求的具體技術參數整個丟棄，替換成寫死 strength 的通用 Wan v2v 重繪——`degraded_reason` 文案暗示「功能相同的替代品」，但實際操作性質完全不同且無輸出驗證

**觸發情境**：H2 已記載這幾個模型「上游停用→替代 wan v2v」的事實，但未深入其**參數層級**的落差。本次逐行核對 `frameInterpolation`（`videoStudio.ts:1319-1354`）：

```ts
const payload: Record<string, unknown> = resolved.substituted
  ? {
      prompt: `smooth motion at ${input.outputFps}fps, fluid frame transitions, ${input.multiplier}x interpolated`,
      video_url: input.videoUrl,
      strength: 0.25,
    }
  : { video_url: input.videoUrl, multiplier: parseInt(input.multiplier), output_fps: input.outputFps };
```
一旦觸發替代（目前 `fal-ai/rife-v4.6/video` 確實在 catalog 標 `disabled: true`），使用者在 UI 上設定的 `outputFps`（24-120，實際控制補幀後幀率的關鍵參數）與 `multiplier`（2x/4x）**完全沒有被當作技術參數送給 fal.ai**，只被拼進一句自然語言提示詞裡（"smooth motion at 60fps, ... 2x interpolated"）交給 Wan v2v 模型，而 Wan v2v **不是補幀模型**，其輸出影片的實際幀數/幀率完全由 Wan 自身生成邏輯決定，與使用者要求的 `outputFps` 沒有任何技術上的因果關係——模型看到這句提示詞會盡力去畫面上「表現流暢感」，但不會真的把 24fps 影片內插成 60fps。`videoUpscale`（:1280-1312，strength 0.35）、`topazEnhance`（:1362-1405，strength 0.3）、`depthCrafter`（:1554-1599）三支同構：`upscaleFactor`/`outputScale`/`numDenoising`/`windowSize`/`overlap`/`maxRes` 等技術參數在替代分支下全部只轉譯成文字提示詞或被完全捨棄（depthCrafter 替代分支只留 `guidance`，`windowSize`/`overlap`/`maxRes` 三個進階參數在替代路徑下**直接消失**，未出現在替代 payload 的任何欄位或提示詞中）。

`withSubstitutionMeta`（:291-315）產生的 `degraded_reason` 文案固定寫「已自動使用 X 代替」，語氣上暗示「這是功能對等的替代方案」，但實際上被替代的操作連基本語義都不保證達成（是否真的放大了解析度、是否真的提升了幀率），且**程式碼裡沒有任何一處在拿到 fal.ai 結果後去驗證輸出影片的實際解析度/幀率是否符合使用者原始請求**——`extractVideoUrl(result)` 只提取 URL，不做任何後驗證。

**錯誤結果**：使用者選擇「放大 4x」或「補幀到 60fps」等具體技術規格，在上游停用期間會**靜默地**得到一支風格略微不同、但解析度/幀率極可能與原片幾乎相同的影片，UI 只用一個「已自動使用 X 代替」的提示帶過，使用者若不逐幀检查根本無從得知自己要求的技術規格完全沒有被滿足。

**證據 path:line**：
- `server/routers/videoStudio.ts:1319-1354`（`frameInterpolation`，`outputFps`/`multiplier` 只進提示詞不進技術參數）
- `server/routers/videoStudio.ts:1280-1312`（`videoUpscale`，`upscaleFactor` 同款處理）
- `server/routers/videoStudio.ts:1362-1405`（`topazEnhance`，五種 Topaz 模型全部轉譯成固定提示詞模板）
- `server/routers/videoStudio.ts:1554-1599`（`depthCrafter`，`windowSize`/`overlap`/`maxRes` 三參數在替代分支下完全消失）
- `server/routers/videoStudio.ts:291-315`（`withSubstitutionMeta` 產生的使用者文案，未反映「操作性質改變」而非「同性質替代」）

---

### 5.【中・新發現】`assertModelEnabled` 丟棄替代後 modelId 是設計上的隱性契約，僅靠「目前 14 個呼叫點都不在 disabled+replacement 名單內」這個巧合維持正確——未來維護若忘記同步改用 `resolveModelOrThrow` 會靜默重現 U3 #4 的錯誤路徑

**觸發情境**：`videoStudio.ts:281-283` 的 `assertModelEnabled`：
```ts
function assertModelEnabled(modelId: string): void {
  resolveModelOrThrow(modelId);   // 回傳值被丟棄
}
```
檔頭註解（:273-280）承認這是刻意設計：「8 個真正停用的模型都改用 `resolveModelOrThrow` 直接拿替代後 modelId；其餘 14 個『目前沒停用』的呼叫點繼續用 `assertModelEnabled`，只為了讓程式碼可讀、能編譯」。本次逐一核對這 14 個呼叫點目前使用的 modelId（`wanTextToVideo`/`minimaxTextToVideo`/`veo3TextToVideo`/`veo3ProTextToVideo`/`ltxTextToVideo`/`klingImageToVideo`/`klingProImageToVideo`/`wanImageToVideo`/`runwayImageToVideo`/`pixverseImageToVideo`/`minimaxImageToVideo`/`wanVideoToVideo`/`klingVideoToVideo`/`ltxImageToVideo`/`animateDiff`/`viduReferenceToVideo`，見 :643,686,733,776,826,917,964,1007,1049,1098,1135,1177,1214,1258,1534,1624），逐一比對 `server/services/falModels.ts` 的 catalog，**目前確實全部 `disabled: false`**——這個設計在當下沒有實際 bug。

但這是一個**脆弱的隱性契約**：一旦維運人員未來在 `falModels.ts` 把這 14 個模型中的任何一個標記為 `disabled: true` 且提供 `replacement`（跟過去對 CamMaster/Sora/Kling Standard t2v/RIFE/Topaz/ByteDance Upscaler/AnimateDiff/DepthCrafter 這 8 個模型做過的事一模一樣），但忘記把對應 `videoStudio.ts` 呼叫點從 `assertModelEnabled(modelId)` 改成 `const resolved = resolveModelOrThrow(modelId)` 並用 `resolved.modelId` 取代裸 `modelId`——`assertModelEnabled` 不會拋錯（因為有 replacement），但實際送給 `falQueueRun` 的仍是**原本已停用的 modelId**，導致提交直接對 fal.ai 已下線的端點送出請求，且回應給前端的物件不會帶 `degraded`/`model_used`，UI 不會顯示「已替代」提示——使用者只會看到任務卡在處理中直到逾時。這與 U3 #4（`falQueueSubmit` 丟棄 `dispatchFalQueueTask` 內部 fallback 鏈算出的真實 modelId）是**同一種錯誤模式在不同層級的重現**：U3 #4 發生在 falDispatcher 的執行期 fallback，本條是 videoStudio router 層的目錄驅動替代，兩者互相獨立但共享同一個根因（「算出了正確的替代 modelId，但呼叫鏈某一層把它丟掉」）。

**證據 path:line**：
- `server/routers/videoStudio.ts:273-283`（`assertModelEnabled` 定義與其檔頭自陳的設計取捨）
- `server/routers/videoStudio.ts:643,686,733,776,826,917,964,1007,1049,1098,1135,1177,1214,1258,1534,1624`（14 個呼叫點的完整清單）
- `server/services/falModels.ts`（逐一比對確認目前這 14 個 modelId 均非 `disabled: true`，隱性契約現況成立但非結構保證）
- 對照：`docs/research/U3-fal-dispatch-webhook-deepdive.md` 發現 #4（`falQueueSubmit` 丟棄降級後 modelId，同一錯誤模式的另一層級）

---

### 6.【中・新發現】videoStudio 與 imageStudio 對「使用者提供的外部媒體 URL」採用兩套強度不同的 SSRF 防護——videoStudio 無網域白名單，imageStudio 有

**觸發情境**：`imageStudio.ts:41` 匯入 `safeMediaUrl`/`safeMediaUrlOptional`（來自 `server/lib/urlValidator.ts`），其 `assertSafeUrl`/`isAllowedHost`（`urlValidator.ts:27-38`）除了封鎖私網/loopback/metadata IP 外，**還套用明確網域白名單**（`STATIC_ALLOWED_HOSTS_RE`：僅允許 `fal.ai`/`fal.run`/`fal.media`/`storage.googleapis.com`/`r2.dev`/`cloudfront.net`/`amazonaws.com`/`supabase.co`/`supabase.in`/`blob.core.windows.net` 及 env 可擴充的名單）。

`videoStudio.ts:25` 匯入的是 `safeExternalUrl`/`safeExternalUrlOptional`（來自 `server/utils/validateSafeUrl.ts` → re-export 自 `shared/safe-url.ts` 的 `isSafeExternalUrl`）。逐行核對 `shared/safe-url.ts:23-68` 的實作：只做 HTTPS-only ＋ 私有 IP／loopback／link-local／metadata／CGNAT／IPv6 ULA 封鎖，**完全沒有網域白名單**——任何解析到公開 IP 的 HTTPS 網域（包含攻擊者自己架設的伺服器）都會通過驗證。這代表 videoStudio 全部 20+ 個 `imageUrl`/`videoUrl`/`tailImageUrl` 欄位（`klingImageToVideo`/`wanVideoToVideo`/`camMaster`/`viduReferenceToVideo` 等）接受任意公開網域的媒體 URL，而 imageStudio 的對等欄位（`image_url`/`refImageUrl` 等）被限制在少數幾個已知內容網域。

本次同時確認：這兩支 router 目前都**沒有在自己的程式碼裡直接 `fetch()` 使用者提供的這個 URL**（grep 全檔案只有 `imageStudio.ts:254` 的 `falRun` 呼叫的是 fal.ai 自己的 API base，不是使用者輸入的 URL）——實際下載這些 URL 的動作發生在 fal.ai 自己的伺服器端，所以此刻不構成對本站基礎設施的直接 SSRF。但這仍是一個真實的防護強度不一致：兩支處理「結構完全相同」的輸入（使用者提供、最終轉發給 fal.ai 抓取的外部媒體 URL）套用不同等級的防護，且 `urlValidator.ts` 檔頭明確自稱這是「多層防護、belt-and-suspenders」設計，videoStudio 這一側事實上只有其中一層。若日後任一支程式碼新增「伺服器端預先下載使用者提供的參考圖/影片做前處理」的功能（例如生成縮圖、驗證檔案類型），videoStudio 這條路徑會直接繼承目前沒有網域白名單的弱點。

**證據 path:line**：
- `server/routers/imageStudio.ts:41`（匯入 `safeMediaUrl`，見 `server/lib/urlValidator.ts:27-38,165-173`：私網封鎖 + 網域白名單雙層）
- `server/routers/videoStudio.ts:25`（匯入 `safeExternalUrl`，見 `shared/safe-url.ts:23-68`：僅私網封鎖，無網域白名單）
- 全文 grep 確認兩支 router 均未對使用者輸入 URL 做伺服器端直接 fetch（風險現階段落在 fal.ai 一側）

---

### 7.【中・新發現】`stableDiffusion35`/`fastSdxl`/`sdLora` 的 `lora_path`/`controlnet_path`/`model_name` 是純 `z.string()`——同一批輸入裡唯一完全不經過任何 URL 健全性檢查的「會被下游抓取」欄位

**觸發情境**：`imageStudio.ts` 的 SD 系列三個模型，`image_url`/`controlnet_image_url` 等欄位都用 `safeMediaUrl`/`safeMediaUrlOptional` 驗證（如 `:1019` 的 `controlnet_image_url: safeMediaUrlOptional`），但同一組 payload 裡的：
- `lora_path: z.string().optional()`（`stableDiffusion35:1023`、`fastSdxl:1083`、`sdLora` 的 `loras[].path:1136`）
- `controlnet_path: z.string().optional()`（`stableDiffusion35:1020`）
- `model_name: z.string().optional().default("stabilityai/stable-diffusion-xl-base-1.0")`（`sdLora:1116-1119`）

**完全是裸 `z.string()`，不套用 `safeMediaUrl`/`safeExternalUrl`，甚至不驗證是否為合法 URL 格式**。這幾個欄位的語意（HuggingFace LoRA 權重路徑、ControlNet 預設路徑、基底模型名稱）本身會被組進 `payload.loras`/`payload.controlnet`/`payload.model_name` 直接轉發給 fal.ai，而 fal.ai 收到 `lora_path` 後會去該路徑抓取權重檔案——這與 `image_url` 欄位「使用者提供一個外部資源、系統轉發給 fal.ai 去抓」的性質完全相同，但因為欄位語意是「路徑字串」而非「URL」，被排除在 SSRF allowlist 保護之外。

**錯誤結果**：使用者（或惡意腳本）可以在 `lora_path` 填入任意字串（包含指向內網/雲端 metadata 端點的 URL，只要 fal.ai 那端接受任意 URI scheme 就可能被當作 SSRF 跳板打向 fal.ai 自己的基礎設施；或至少可以指向惡意的 HuggingFace 倉庫，讓 fal.ai 拉取來路不明的模型權重檔案，若 fal.ai 對此類任意路徑缺乏過濾則風險轉嫁到 fal 平台）——本站對此欄位沒有做出任何形式的健全性把關，與同一支 mutation 裡其他 URL 欄位的防護標準不一致。

**證據 path:line**：
- `server/routers/imageStudio.ts:1019-1024`（`stableDiffusion35` 的 `controlnet_image_url`（safeMediaUrlOptional）vs `controlnet_path`（裸 z.string()）並排對比）
- `server/routers/imageStudio.ts:1083`（`fastSdxl` 的 `lora_path`）
- `server/routers/imageStudio.ts:1116-1140`（`sdLora` 的 `model_name`/`loras[].path`）

---

### 8.【低中・新發現】`imageStudio.checkImageStatus` 的 FAILED 分支硬編碼 `userId: 0` 寫入錯誤追蹤，即使 `ctx.user.id` 在同一函式內已知可用；`videoStudio.checkVideoStatus` 的對應分支正確使用 `ctx.user?.id ?? 0`

**觸發情境**：兩支姊妹端點的 FAILED 分支對照：
```ts
// imageStudio.ts:1493-1503（checkImageStatus 的 FAILED 分支）
recordErrorTrace({
  userId: 0,                       // ← 硬編碼，ctx.user.id 明明在同一 query 內可用（COMPLETED 分支就用了 ctx.user.id）
  modality: "image",
  engine: input.modelId,
  ...
});
```
```ts
// videoStudio.ts:1760-1770（checkVideoStatus 的 FAILED 分支）
recordErrorTrace({
  userId: ctx.user?.id ?? 0,       // ← 正確帶入真實使用者 id
  modality: "video",
  engine: input.modelId,
  ...
});
```
`imageStudio.ts` 的 `falRun` 輔助函式內的 `recordErrorTrace({ userId: 0, ... })`（:275-282）硬編碼尚可理解（該函式本身沒有 `ctx`），但 `checkImageStatus` 這個 query procedure **本來就有 `ctx`**（COMPLETED 分支的 `doPostGenComplete` 就正確使用了 `ctx.user.id`，見 :1464），FAILED 分支卻仍寫死 `userId: 0`。

**錯誤結果**：所有透過 imageStudio 生成失敗的錯誤線索（`recordErrorTrace` 餵給 `brainAutoRepair` 的自動修復/爬網提案系統）永遠被歸因到「使用者 0」，無法按實際觸發使用者做任何關聯分析（例如「這個使用者的失敗率異常高」「這個 modelId 對特定使用者的輸入組合持續失敗」），而 videoStudio 的等價機制正確保留了使用者歸因——兩支同構端點在同一套錯誤追蹤基礎設施上出現不一致，削弱 image 側自動修復系統的線索品質。

**證據 path:line**：
- `server/routers/imageStudio.ts:1493-1503`（`checkImageStatus` FAILED 分支，硬編碼 `userId: 0`）
- `server/routers/imageStudio.ts:1464`（同一函式的 COMPLETED 分支正確使用 `ctx.user.id`，證明 `ctx` 可用）
- `server/routers/videoStudio.ts:1760-1770`（`checkVideoStatus` 對應分支，正確寫法對照）

---

### 9.【低中・延伸自 U3 #2】全文僅兩處與「方案/付費」相關的守門——補強「零扣點」全貌：不只沒有扣點，幾乎也沒有任何用量節流

**觸發情境**：U3 #2 已證實 imageStudio/videoStudio 全部 mutation 沒有 `deductUserPoints`/`chargeForFalTask` 呼叫。本次逐行讀完兩檔案後確認，**全文對 `db.getUserSubscription` 的呼叫只有兩處**，且都只針對「解析度」這個單一維度做二元擋（付費/免費），而非對「選用哪個模型」本身做任何節流：

1. `imageStudio.ts:834-842`（`nanoBanana2Edit`）：`resolution === "4K"` 時查訂閱方案，非付費方案擋下。
2. `videoStudio.ts:360-365`（`applyOutputSpec`，供 `klingTextToVideo`/`wanTextToVideo`/`minimaxTextToVideo`/`veo3TextToVideo` 四支 t2v 共用）：`outputSpec.resolution === "4K"` 時同款查訂閱擋下。

除此之外，**23（image）+ 22（video）＝ 45 支 mutation 對任何模型選擇、任何參數組合（含 `num_images=4`、Sora/Veo3 Pro/Kling Pro/Rodin3D 等目錄上單價最高的模型）完全沒有任何形式的用量或方案節流**——唯二的守門只在「同一個模型選了超高解析度」這個窄縫觸發，且都只是「非付費方案就整個擋掉」的二元開關，不是按用量計費/扣點。這補強了 U3 #2 的結論：imageStudio/videoStudio 的成本控制不是「扣點機制有漏洞」，而是「扣點機制近乎不存在，僅有的兩處付費檢查也只覆蓋極窄的解析度維度」。

**證據 path:line**：
- `server/routers/imageStudio.ts:834-842`（`nanoBanana2Edit` 的 4K 付費 gate，全 imageStudio.ts 唯一的 `getUserSubscription` 呼叫點）
- `server/routers/videoStudio.ts:360-365`（`applyOutputSpec` 的 4K 付費 gate，全 videoStudio.ts 唯一的 `getUserSubscription` 呼叫點）
- 對照：`docs/research/U3-fal-dispatch-webhook-deepdive.md` 發現 #2

---

### 10.【低・新發現】`checkImageStatus` 寫入 `costCredits: estimate.totalPoints`（僅圖片側），`checkVideoStatus` 的 `doPostGenComplete` 呼叫完全沒有帶 `costCredits`——使用者「點數紀錄」頁面對圖片/影片生成的花費揭露不一致，且圖片側估算本身不看實際參數

**觸發情境**：`imageStudio.checkImageStatus`（:1462,1478）在 COMPLETED 分支呼叫 `estimatePoints(input.modelId)` 並把 `estimate.totalPoints` 當作 `costCredits` 傳給 `doPostGenComplete`，寫入 `generation_history`/資產庫的紀錄裡；`videoStudio.checkVideoStatus`（:1718-1732）呼叫 `doPostGenComplete` 時**完全沒有帶 `costCredits` 欄位**。由於 imageStudio/videoStudio 全線零實際扣點（U3 #2、本報告 #9），這個 `costCredits` 純粹是寫入歷史紀錄的「估計花費」中繼資料，不代表真的扣過款。

**錯誤結果**：使用者在「點數紀錄」/生成歷史頁面檢視自己的圖片生成紀錄時會看到一個「估計點數」欄位（即使實際上分文未扣），檢視影片生成紀錄則完全沒有這個欄位——同一套「零扣點」機制下，兩個姊妹功能對使用者呈現不一致的資訊揭露介面。此外，`estimatePoints(input.modelId)` 只吃 `modelId` 一個參數，不考慮 `num_images`（1-4 張）、`resolution`（0.5K-4K）等實際影響真實成本的參數，即使日後接上真實扣款，這個估算函式目前的呼叫方式本身也會低估多圖/高解析度請求的實際成本。

**證據 path:line**：
- `server/routers/imageStudio.ts:1462,1478`（`estimatePoints(input.modelId)` 與 `costCredits: estimate.totalPoints`）
- `server/routers/videoStudio.ts:1718-1732`（`doPostGenComplete` 呼叫，無 `costCredits` 欄位）

---

## 未查完部分（誠實聲明）

- **發現 #1 的攻擊鏈未做實際滲透測試**：`submitStudioJob` 偽造記錄 → `checkVideoStatus` owner 檢查誤判通過的邏輯鏈已用程式碼路徑逐行確認可行，但未實際起服務、開兩個帳號跑一次端到端驗證（僅靜態推理，因任務要求「只寫研究文件」未執行）。
- **`server/services/falModels.ts` 完整 catalog（超過 100 個模型條目）僅針對本報告提到的 23 個 videoStudio/imageStudio 呼叫點做過交叉核對**，其餘作為 proStudio/generate.ts/agentToolExecutor 等其他 router 使用的條目未逐一檢查是否有類似 `assertModelEnabled` 丟棄替代 modelId 的模式。
- **`localizeResultUrls`/`unifiedAssetPrefix`（`server/services/internalMedia.ts`、`server/services/postGenActions.ts`）的完整實作本次僅讀了與本報告發現直接相關的片段（dedupeMarker 查詢邏輯），未逐行核對其 R2 上傳/命名/去重的完整邏輯是否還有其他問題。**
- **發現 #6（SSRF 防護不一致）的「目前無伺服器端直接 fetch」結論只靠全文字串 grep `fetch(` 確認，未排除透過其他間接手段（例如某個背景 cron job 或第三方 SDK 內部隱含的 fetch）讀取這些使用者提供 URL 的可能性。**
- **發現 #4（後處理工具替代參數丟失）的「使用者體感」推論未搭配真實 fal.ai 呼叫驗證輸出影片實際解析度/幀率**——本次判斷完全基於程式碼靜態分析（payload 內容），未實際送出請求比對輸出檔案屬性。
- **`compilePrompt`（videoStudio.ts:466-547）與 `videoCompiler.ts` 服務本身的邏輯正確性未深入**，僅核對其 zod schema 與呼叫鏈路。
- **`agentToolExecutor.ts`/`generationJobDispatcher.ts` 等生成路徑本次未重新核對**（U3 已逐行讀過，本報告聚焦 imageStudio.ts/videoStudio.ts 檔案本身未被 U3 完整覆蓋的細節）。
