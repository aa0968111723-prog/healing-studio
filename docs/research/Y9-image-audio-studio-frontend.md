# Y9 — ImageStudio + ProStudio 前端深挖
- 產生日期:2026-07-03
- 依據 commit:812f6fdb (現有 HEAD 47917e3 對兩份稽核檔案 `git diff 812f6fdb HEAD` 為空,程式碼一致)
- 稽核檔案:client/src/pages/ImageStudio.tsx(5354)、client/src/pages/ProStudio.tsx(4948,鎖定契約/死UI/計費回饋,不必逐行)

## 稽核方法
- 先讀 `client/src/pages/ImageStudio.tsx`、`client/src/pages/ProStudio.tsx` 全文的 tRPC 呼叫點、`useMutation`/`useQuery` 輪詢邏輯、`toast`/錯誤 UI,再逐一回頭讀對應的 `server/routers/imageStudio.ts`、`server/routers/proStudio.ts`、`server/routers/generate.ts`、`server/services/postGenActions.ts`、`server/services/refundStatus.ts`、`server/services/falQueueAwaiter.ts`、`server/_core/trpc.ts` 驗證欄位/端點是否真的存在、邏輯是否真的執行到。
- 對照既有 `docs/research/V1-image-video-router-deepdive.md`、`docs/research/W2-prostudio-router-deepdive.md`(及其引用的 K2/U3/W3/P4)的伺服端結論,但一律以本次重新讀到的程式碼為準;凡本次獨立驗證結果與既有文件不同或提供新資訊(例如「端點在伺服端存在但前端從未呼叫」),都在條目內明確標註。
- 不臆測任何未讀到的檔案內容;凡未實地開啟驗證的模組,一律寫「未在本檔驗證」。

## 北極星對照(摘要)
北極星要求「創作者在單一專案裡走 腳本→分鏡→逐幕(字卡+畫面圖影+聲音)→簡易拼接→輸出→打包,AI 全程逐步引導、不跑偏」。ImageStudio/ProStudio 是「逐幕」階段的圖像/音訊素材產生器,對北極星最直接的體現是:①生成結果能否可靠地回到專案/分鏡(見發現 10);②生成失敗時創作者要不要為看不到的錯誤埋單(見發現 2、4、5);③創作者能否看懂自己正在花多少「創作資源」(見發現 3、8)。本次多處發現顯示,這條線在「非同步任務失敗」與「3D/World 產出」兩個節點上有實質斷點。

---

## 發現總覽(依嚴重度)

| # | 嚴重度 | 一句話 | cluster |
|---|---|---|---|
| 1 | Critical | ImageStudio 的 3D/World 五模型,有兩支(rodin3d/hunyuanWorld)透過唯一可達的背景任務輪詢路徑會 100% 被誤判失敗,另三支遺失全部副輸出格式 | contract-mismatch |
| 2 | Critical | `submitStudioJob` 建立的背景任務從不寫入 `costPoints`,導致 ImageStudio/ProStudio 幾乎全部非同步任務失敗後,`refundJobIfBilled` 必然靜默 no-op(退款邏輯是假象) | contract-mismatch |
| 3 | High | `imageStudio.ts` 全部 23 支生成 mutation 零點數扣除(交叉驗證 V1 #9、U3 #2 既有結論,獨立複查得出相同結果) | other |
| 4 | High | ProStudio `AvatarVideoTab` 對 `checkAudioStatus` 的 FAILED 狀態零 UI 回饋,畫面卡在「處理中…」動畫直到使用者放棄 | uiux-defect |
| 5 | High | `proStudio.checkAudioStatus` 的 IDOR(W2 已載)在 ProStudio.tsx 是活躍呼叫路徑,且作為存取憑證的 `request_id` 被明碼顯示在畫面上 | client-security |
| 6 | High | 「素材」快速開啟資產庫按鈕在 ImageStudio.tsx / ProStudio.tsx 都用永久生效的 `hidden` class,整個 `AssetsQuickDrawer` 全站唯一四個呼叫點均不可達 | dead-ui |
| 7 | High | ImageStudio/ProStudio 建立的背景任務,經由已知未修的 `generate.jobStatus` IDOR(W3 已載)可被任何登入使用者以連號 jobId 枚舉讀取 | client-security |
| 8 | Medium | `proStudio.ts` 每支付費 mutation 都回傳 `estimated_credits`,但 ProStudio.tsx 全文從未讀取/顯示;ImageStudio.tsx 對生成成本也毫無預覽 | contract-mismatch |
| 9 | Medium | `imageStudio.checkImageStatus`/`jobStatus`/`jobResult`(V1 記載之 IDOR 端點)本次確認在目前 ImageStudio.tsx 前端零呼叫,是孤立死端點 | dead-ui |
| 10 | Medium | `handleReturnToDirector` 把生成結果丟進 sessionStorage 交還 Director AI,但若當時 Director AI 尚未匯入腳本分鏡,交接資料會靜默流失、零提示 | northstar-flow |
| 11 | Low | `qwenCloneVoice` 端點全站零呼叫,是被 `qwenCloneAndSpeak` 取代後留下的死碼 | dead-ui |
| 12 | Low | `falQueueRun` 的 `waitSec` 參數完全未使用,函式一律立即回傳非同步佔位物件,函式簽章具誤導性 | contract-mismatch |

---

## 1.〔Critical〕ImageStudio 3D/World 生成鏈斷裂:唯一可達路徑無法解析兩支模型的結果,另三支遺失全部副輸出

**發現**

`imageStudio.ts` 的輔助函式 `falQueueRun`(`server/routers/imageStudio.ts:302-310`)一律立即回傳:
```ts
async function falQueueRun(modelId, input, waitSec = 180): Promise<FalResultLike> {
  const { request_id } = await falQueueSubmit(modelId, input);
  // 直接回傳 request_id，不在後端等待（防止 504 Timeout）
  return { request_id, raw_model_id: modelId, is_async_polling: true };
}
```
`waitSec` 參數完全未在函式體內使用——這不是「等待 N 秒再放棄」,而是無論如何都立刻回傳非同步佔位物件。全站 23 支 `imageStudio.ts` mutation(包含全部 5 支 3D/World 模型:`trellis2`、`sam3dObjects`、`hunyuan3d`、`rodin3d`、`hunyuanWorld`,分別見 `imageStudio.ts:1174-1390`)都呼叫這支函式,因此每次呼叫的 `raw` 永遠只有 `{request_id, raw_model_id, is_async_polling}` 三個欄位。

對應到前端,`ImageStudio.tsx:3712-3724`:
```ts
result = await currentMutation.mutateAsync(input);
const bgJobId = await registerBgTask(result, "image", ...);
const isAsyncResult = !!(result?.raw?.request_id || result?.raw?.is_async_polling);
if (isAsyncResult) {
  if (bgJobId) setPendingBgJobId(bgJobId);
  toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
  return;   // ← 提早 return
}
```
由於 `is_async_polling` 對這 5 支模型永遠是 `true`,`ImageStudio.tsx:3726-3751`(讀取 `result?.model_glb_url`、`gaussian_splat_url`、`artifacts_zip_url`、`model_urls.{obj,usdz,fbx}`、`world_file_url`、`textures[0]` 並塞進 `setResult3d({glbUrl, extras})` 的完整 3D 結果面板)**必然是死碼——永遠執行不到**。

那麼使用者實際看到的結果,只能來自唯一存活的路徑:`BackgroundTasksContext`(`registerBgTask`/`useRegisterBgTask`,`client/src/contexts/BackgroundTasksContext.tsx:594-617`)→`generate.submitStudioJob`→輪詢 `generate.checkStudioJob`(`server/routers/generate.ts:2176-2365`)。`checkStudioJob` COMPLETED 分支的 URL 抽取邏輯(`generate.ts:2259-2282`)是:
```ts
const extracted = extractFalMediaUrl(r);   // server/services/falQueueAwaiter.ts:78-138，只認 video/image/audio 欄位
const resultUrl =
  extracted.output_url ??
  ((r?.audio_file as any)?.url) ?? ((r?.vocals as any)?.url) ?? ((r?.speaker_embedding as any)?.url) ??
  ((r?.output as any)?.url) ?? ((r?.model_glb as any)?.url) ?? ((r?.dubbed_url as string)) ??
  ((r as any)?.text) ?? ((r as any)?.transcript) ?? null;
```
`extractFalMediaUrl`(`falQueueAwaiter.ts:78-138`)完整讀過一遍,只處理 `video`/`image`/`audio`(含陣列)欄位,**完全不認得** `model_mesh`、`gaussian_splat`、`model_urls`、`textures`、`world_file`、`artifacts_zip`、`individual_glbs`。上面這串 fallback 也只多補了一個 `model_glb`。

逐一對照 5 支模型實際回傳的主要欄位(`imageStudio.ts` 對應行號):
- `trellis2`(:1204)→`model_glb.url` → **有** fallback,可解析。
- `sam3dObjects`(:1238)→`model_glb.url` → **有** fallback,可解析主模型;但 `gaussian_splat_url`(:1239)、`artifacts_zip_url`(:1240)、`individual_glbs`(:1241-1243)三個副輸出**全部遺失**。
- `hunyuan3d`(:1297)→`model_glb.url` → **有** fallback,可解析主模型;但 `thumbnail_url`(:1298)、`model_urls.{glb,obj,usdz,fbx}`(:1299-1304)遺失。
- `rodin3d`(:1354)→**`model_mesh.url`**(注意不是 `model_glb`)→ fallback 清單中**沒有 `model_mesh`**,`resultUrl` 恆為 `null`。
- `hunyuanWorld`(:1388-1389)→**`world_file.url`** → fallback 清單中**沒有 `world_file`**,`resultUrl` 恆為 `null`。

`resultUrl` 為 `null` 時,`checkStudioJob`(`generate.ts:2284-2307`)會**主動把任務標記為失敗**:
```ts
if (!resultUrl) {
  const errMsg = "生成已完成但無法解析結果連結（fal 回傳格式異常），請重試或更換模型";
  await db.updateBackgroundJob(job.id, { status: "failed", errorMessage: errMsg, ... });
  void refundJobIfBilled(job.id);
  return { ...job, status: "failed" as const, errorMessage: errMsg };
}
```

**影響**

- 使用者透過 ImageStudio 呼叫「Rodin 文字/圖片生成 3D」或「混元 World 圖片轉世界」,即使 fal.ai 端真的成功產出模型,`BackgroundTasksDrawer` 也會 100% 顯示「❌ ... 失敗」,錯誤訊息還誤導成「fal 回傳格式異常,請重試或更換模型」——重試只會再失敗一次,使用者無法從 UI 得知這是系統本身的欄位對應缺口。
- 另外三支(trellis2/sam3dObjects/hunyuan3d)雖然「不失敗」,但 Gaussian Splat、ZIP 打包、OBJ/USDZ/FBX 多格式、貼圖等副產出**對使用者完全不可見**,即使 `imageStudio.ts` 自己的 mutation 程式碼已經算好這些 URL——ImageStudio.tsx 內建的 `extras` 面板(對應 3D 結果卡片,含「Gaussian PLY」「ZIP 壓縮包」「OBJ」「USDZ」「FBX」「World」等 label)因為第一點提到的死碼問題,永遠沒有機會渲染。
- 對北極星「快速素材管理」而言,3D/World 是 ImageStudio 目錄裡明確標注的「NEW」旗艦功能(共 5/23,佔比不小),目前透過正常 UI 操作有 2 支完全不可用、3 支殘缺可用。

**建議**
- 在 `extractFalMediaUrl` 或 `checkStudioJob` 的 fallback 清單補上 `model_mesh.url`、`world_file.url`(以及理想上 `gaussian_splat`/`model_urls`/`textures`/`artifacts_zip`,可考慮把整個 `raw`/`localizedResult` 一併存進 `resultJson.result`,前端 3D 結果卡片改讀 `resultJson.result` 而非只讀單一 `resultUrl`)。
- 或者:讓 `falQueueRun` 真的依 `waitSec` 做同步等待(如同其名稱與既有註解暗示的語意),把 3D/World 類別回歸同步回傳,ImageStudio.tsx 既有的 `extras` 面板即可直接生效,不必依賴通用 fallback。
- 短期至少應把 `!resultUrl` 分支的錯誤訊息,對 3D/World 類別改成明確的「此類型結果暫不支援自動預覽,請至任務紀錄查看原始連結」而非「請重試」,避免使用者做無效的重試循環並被誤導。

---

## 2.〔Critical〕`submitStudioJob` 從不記錄扣點金額,讓「失敗退款」在 ImageStudio/ProStudio 全面失效

**發現**

`generate.submitStudioJob`(`server/routers/generate.ts:2143-2169`)的輸入 schema:
```ts
submitStudioJob: protectedProcedure
  .input(z.object({
    studioType: z.enum(["image", "video", "audio", "voice"]),
    requestId: z.string().min(1),
    modelId: z.string().min(1),
    label: z.string().max(200).optional(),
    prompt: z.string().max(2000).optional(),
  }))
  .mutation(async ({ ctx, input }) => {
    const jobId = await db.createBackgroundJob({
      userId: ctx.user.id, jobType: input.studioType, status: "processing", progress: 0,
      resultJson: { requestId: input.requestId, modelId: input.modelId, studioType: input.studioType, label: input.label, prompt: input.prompt ?? "" },
    });
    return { jobId };
  }),
```
沒有任何 `costPoints` 欄位。這是 ImageStudio.tsx(`registerBgTask`,`ImageStudio.tsx:3714`)與 ProStudio.tsx(`registerBgTask`/`useSubmitGeneration.generationMutationCallbacks`,例如 `ProStudio.tsx:3712,3726,3740,3754,3768,3782` 等幾乎所有生成 mutation 的 `onSuccess`)登記背景任務的**唯一**途徑——中介的 `useRegisterBgTask`(`client/src/contexts/BackgroundTasksContext.tsx:594-617`)只從 mutation 結果抽取 `request_id`/`model` 轉呼叫 `submitTask({studioType, requestId, modelId, label, prompt})`,同樣不傳、也无处可传扣點金額(即便個別 mutation 回應裡有 `estimated_credits`,見發現 8)。

而 `refundJobIfBilled`(`server/services/postGenActions.ts:575-618`)的退款依據**只有** `resultJson.costPoints`:
```ts
const costPointsRaw = meta.costPoints;
const points = typeof costPointsRaw === "number" && ... && costPointsRaw > 0 ? Math.round(costPointsRaw) : 0;
if (points <= 0) return false;   // ← submitStudioJob 建立的 job 必然在此短路
```
`checkStudioJob` 在三個失敗分支(逾時 stale job `generate.ts:2205`、COMPLETED 但解不出 URL `generate.ts:2301`、fal queue 回 FAILED `generate.ts:2350`)都忠實呼叫了 `void refundJobIfBilled(job.id)`,程式碼「看起來」有完整的失敗退款保護,但因為 `costPoints` 永遠缺席,這三處呼叫對 ImageStudio/ProStudio 的任務**保證是 no-op**。

**影響**

- ProStudio 端是真的先扣點(`chargeForFalTask`,例如 `speechToVideo`,`proStudio.ts:1465`)才送出 fal 佇列;若佇列送出後才失敗(fal queue 回 FAILED、逾時、或解不出結果 URL),使用者的點數永久遺失,且 `BackgroundTasksDrawer` 的 `RefundStatusBadge`(`client/src/components/RefundStatusBadge.tsx`,見 `BackgroundTasksDrawer.tsx:178-183`)因為 `deriveJobRefundStatus`(`server/services/refundStatus.ts:88-134`)讀到 `costPoints=0` 會回傳 `refundStatus: "none"`,徽章**依規則安靜不顯示**——也就是說,對這整條路徑而言,「已扣點且未退款」的事實,不會被這個原本專門為此設計的透明化元件揭露。
- ImageStudio 端因發現 3(全站零扣點)而不涉及金錢損失,但同一套「看起來已修復」的退款程式碼路徑,對兩個工作室其實都是幻覺——這正是「失敗不退款的 UI 回饋」這題最根本的斷點:UI 元件(徽章/toast)本身沒壞,壞在資料從一開始就沒被寫進去。

**建議**
- 讓 `submitStudioJob` 的 input schema 增加可選 `costPoints: z.number().optional()`,並在 `createBackgroundJob` 的 `resultJson` 內一併寫入;呼叫端(`useRegisterBgTask`)把 mutation 回應裡的 `estimated_credits` 原樣轉傳。
- 或至少在 `checkStudioJob` 的三個失敗分支,對 `costPoints` 缺席但 `studioType` 屬於已知計費模型的情況,記一筆「需人工核對」的稽核 log,避免退款狀態被靜默誤判為「無扣款紀錄」。

---

## 3.〔High〕`imageStudio.ts` 全部 23 支生成 mutation 零點數扣除(交叉驗證既有結論)

**發現**

本次獨立通讀 `server/routers/imageStudio.ts`(1514 行)全文,搜尋 `deductUserPoints`/`deductCredits`/`chargeForFalTask`/`remainingGenerations`,**零命中**(唯一與「點數」相關的程式碼是 `checkImageStatus` COMPLETED 分支呼叫 `estimatePoints(input.modelId)` 把估算值當 `costCredits` 寫進 `doPostGenComplete` 的歷史紀錄元資料,`imageStudio.ts:1462,1478`,純粹是寫史用途,`postGenActions.ts` 全文同樣搜尋不到任何扣點呼叫)。掛在這些 mutation 上的中介層 `generationProcedure`(`server/_core/trpc.ts:180`)只疊加了「5 req/60s」的速率限制,不含任何計費檢查。這與 `docs/research/V1-image-video-router-deepdive.md` 第 213-233 行、`docs/research/U3-fal-dispatch-webhook-deepdive.md` 已載的「imageStudio/videoStudio 全線零扣點」結論一致,本次獨立複查得到相同結果(視為交叉驗證,非重複計分的新發現)。

同時確認前端這一側的「正片」:`ImageStudio.tsx` 全文搜尋 `estimate`/`costPoints`/`pricingCatalog`/`myBalance`/`accountant.`/「點數」/「積分」/`totalPoints`/`basePoints`,**同樣零命中**——ImageStudio.tsx 沒有在任何地方宣稱、預覽或顯示這次生成要花多少點數。

**影響**

- 好消息(見「已驗證排除的疑慮」):由於前端也完全沒有顯示點數/成本資訊,不構成「介面說會扣費、其實沒扣」的 contract-mismatch,不會誤導使用者。
- 壞消息:ImageStudio 整條產品線(含目錄上單價最高的 3D/World 類模型)目前唯一的用量節流只有「每分鐘 5 次請求」的共用速率限制,沒有任何形式的按次計費或方案節流,是一個貨真價實的營收/成本控制缺口——只是它落在「北極星前端稽核」的 client-security/契約分類之外,更接近純粹的商業邏輯缺陷,故標記為 other。

**建議**
- 若產品意圖是「圖片生成免費、僅影片/音訊計費」,建議在 ImageStudio.tsx 明確加上「本工作室生成不消耗積分」之類的說明文案,把目前的沉默一致性,變成刻意且對使用者透明的產品決策;若非故意,則需要在 `imageStudio.ts` 補上與 `proStudio.ts` 同款的 `chargeForFalTask` 呼叫。

---

## 4.〔High〕ProStudio `AvatarVideoTab` 對 `checkAudioStatus` 的 FAILED 狀態零 UI 回饋

**發現**

`AvatarVideoTab`(`client/src/pages/ProStudio.tsx:3585` 起)維護一個獨立於 `BackgroundTasksContext` 的本地輪詢:
```ts
// ProStudio.tsx:3798-3813
const statusQuery = trpc.proStudio.checkAudioStatus.useQuery(
  { requestId: jobInfo?.request_id ?? "", model: jobInfo?.model ?? "", submittedAt: statusSubmittedAt },
  {
    enabled: !!jobInfo && !!jobInfo.request_id,
    refetchInterval: query => {
      const s = query.state.data?.status;
      return s === "COMPLETED" ? false : 3000;   // ← 沒有 "FAILED" 分支
    },
    refetchIntervalInBackground: false,
    retry: 5,
  }
);
const jobStatus = statusQuery.data?.status;
```
渲染處(`ProStudio.tsx:4056-4065`):
```tsx
{jobStatus === "COMPLETED" ? (
  <Badge className="bg-emerald-500 text-white">✓ 完成</Badge>
) : (
  <><Loader2 className="w-3 h-3 animate-spin text-primary" /><Badge variant="secondary">{jobStatus ?? "處理中..."}</Badge></>
)}
```
全元件(`ProStudio.tsx:3585-4099`)對 `statusQuery.isError`/`statusQuery.error` **零讀取**。而伺服端 `proStudio.checkAudioStatus` 的 FAILED 分支(`proStudio.ts:1802-1817`)是 `throw new TRPCError(...)`,不是回傳 `{status:"FAILED"}`:
```ts
if (s === "FAILED") {
  const errMsg = status?.error ?? status?.message ?? "未知錯誤";
  recordErrorTrace({...});
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `任務失敗 [${input.model}]: ${errMsg}` });
}
```
因此當任務真的失敗,react-query 的 `data` 停留在上一次成功值(`{status:"IN_PROGRESS"}`或 `undefined`),`refetchInterval` 判斷式 `s === "COMPLETED" ? false : 3000` 恆真回傳 `3000`——**輪詢永不停止**,畫面上的 `Badge`/`Loader2` 永遠顯示「處理中...」轉圈動畫,使用者除非自行離開頁面,否則永遠不會知道任務已經失敗。

對照同檔案內 `AsyncAudioPoller`(`ProStudio.tsx:267-349`,供 TTS/文字生音樂等分頁共用)則是有處理 `isError` 分支的(`ProStudio.tsx:311-317`,顯示「生成失敗：{error.message}」),只是同樣沒有提及退款狀態(見發現 2)。兩者對比說明 `AvatarVideoTab` 這支是遺漏了同檔案內已有的正確模式,而非設計上刻意省略。

**影響**

- 對「說話人影片 / EchoMimic / Stable Avatar / LongCat / LTX 音訊轉影片 / ElevenLabs 配音」六種模型,一旦 fal.ai 端真正失敗,使用者體驗是「無限期卡在處理中」,唯一的補救訊號來自平行的 `BackgroundTasksContext`(因為 `registerBgTask` 同時把同一個 job 登記進去,見發現 2)在它自己的輪詢週期跳出的全域 toast——但那條路徑的錯誤訊息與這支分頁內建的狀態卡片互不同步,使用者停留在本分頁畫面上看到的仍是假的「處理中」。

**建議**
- 比照 `AsyncAudioPoller` 補上 `if (statusQuery.isError) return <ErrorCard message={...} />` 或至少把 `refetchInterval` 的判斷式改成同時處理 `query.state.status === "error"` 時停止輪詢並顯示失敗態。

---

## 5.〔High〕`proStudio.checkAudioStatus` 的 IDOR 是活躍呼叫路徑,且 `request_id` 被明碼顯示在畫面上

**發現**

`docs/research/W2-prostudio-router-deepdive.md` 第 222-254 行已記載 `proStudio.checkAudioStatus`(`proStudio.ts:1688-1820`)只要求登入(`brainProcedure`),對 `requestId`/`model` 組合**沒有任何擁有權檢查**。本次逐一確認這是 ProStudio.tsx **兩個實際使用中**的呼叫點:
- `AsyncAudioPoller`(`ProStudio.tsx:282-293`)
- `AvatarVideoTab`(`ProStudio.tsx:3798-3813`)

都是直接把 `requestId`/`model` 交給 `trpc.proStudio.checkAudioStatus.useQuery`,不經過任何本地/伺服端的「這個 requestId 是我的」比對——與 V1 記載的 `imageStudio.checkImageStatus`(見發現 9,已確認前端零呼叫)不同,`checkAudioStatus` 是貨真價實會被一般使用者操作觸發的即時查詢端點,任何登入使用者只要換掉 `requestId` 參數(不需要繞過任何前端 UI,只要照抄同一支已載入頁面的 tRPC client 呼叫)就能查看/觸發任意他人任務的完成結果落地(`doPostGenComplete`,見 `proStudio.ts:1776-1790`,以呼叫者自己的 `ctx.user.id` 寫入資產庫)。

更進一步,`AvatarVideoTab` 把作為存取憑證的 `request_id` **明碼顯示在畫面上**(`ProStudio.tsx:4067-4068`):
```tsx
<p className="text-[10px] text-muted-foreground font-mono truncate">
  ID: {jobInfo.request_id}
</p>
```
即使 CSS 用 `truncate` 視覺裁切,完整字串仍在 DOM 裡,使用者只要截圖分享(北極星鼓勵的「輸出→打包」後半段常伴隨分享)、或被檢視原始碼,就會把這個唯一防線(W2 原文用語:「僅靠 opaque ID 保密」)的憑證外流。

**影響**
- 放大 W2 已記載的 IDOR 的實際可觸發面:攻擊者不需要猜測/爆破,只需要拿到任何一個外流(截圖、分享連結、瀏覽器紀錄)的 `request_id`,即可用自己帳號透過**這個真實存在且天天被呼叫**的端點竊取對方生成內容並佔為己有。

**建議**
- 伺服端:比照 W2 建議,在 `checkAudioStatus`(以及 `jobStatus`/`jobResult`)呼叫 `falQueueStatus` 之前,增加「此 `requestId` 是否曾由本人建立的 backgroundJob 引用過」的比對。
- 前端:`AvatarVideoTab` 移除或遮蔽畫面上顯示的完整 `request_id`(例如只顯示末 6 碼供除錯用),降低被動外洩機率。

---

## 6.〔High〕「素材」快速開啟資產庫按鈕在兩份稽核檔案都被永久隱藏,`AssetsQuickDrawer` 全站不可達

**發現**

`ImageStudio.tsx:4408-4414`:
```tsx
<button
  onClick={() => openAssetsDrawer()}
  className="hidden flex items-center gap-1.5 px-2.5 sm:px-3 py-2.5 rounded-xl border border-border/40 hover:bg-accent active:bg-accent/70 text-muted-foreground text-xs font-medium transition-all min-h-[44px]"
  aria-label="開啟素材庫"
>
  <Package className="w-3.5 h-3.5" /> 素材
</button>
```
`ProStudio.tsx:4747-4753` 幾乎逐字相同:
```tsx
<button
  onClick={() => openAssetsDrawer()}
  className="hidden flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-border/40 hover:bg-accent text-muted-foreground text-xs font-medium transition-colors min-h-[36px]"
  aria-label="開啟素材庫"
>
  <Package className="w-3.5 h-3.5" /> 素材
</button>
```
兩處 `className` 都是字面上的 `"hidden flex ..."`,**沒有任何響應式斷點前綴**(如 `sm:flex`)解除 `hidden`。Tailwind 的 `display` 工具類(`block`/`flex`/`hidden`/...)彼此互斥且共用同一 CSS 特異度,`hidden`(`display: none`)在生成的樣式表中排序在 `flex` 之後,會直接覆蓋 `flex`——這顆按鈕在任何螢幕尺寸下都是 `display: none`,無法被使用者看到或點擊。

`onClick={() => openAssetsDrawer()}` 呼叫的是真實存在、邏輯完整的 `useAssetsDrawer()`(`client/src/contexts/AssetsDrawerContext.tsx`),其 `openDrawer` 會開啟全域掛載於 `App.tsx:453` 的 `<AssetsQuickDrawer />`(一個有搜尋/篩選/插入功能的完整素材抽屜元件)。全站搜尋 `useAssetsDrawer`/`openAssetsDrawer`/`toggleDrawer`,唯一的四個呼叫點是 `ImageStudio.tsx`、`ProStudio.tsx`、`VideoStudio.tsx`、`DirectorAI.tsx`——後兩者(超出本次稽核範圍,僅作旁證未逐行覆核)分別在 `VideoStudio.tsx:5097-5098` 有同款 `"hidden flex ..."`、在 `DirectorAI.tsx:4525` 有 `className="hidden rounded-xl text-xs gap-1"`。也就是說,**全站唯一能打開這個資產抽屜的四個按鈕,在本次檢查範圍內的兩個都確認是永久隱藏的**。

**影響**
- `AssetsQuickDrawer` 這整支功能(含其內建的搜尋/篩選/一鍵插入邏輯)對一般使用者而言不存在——沒有任何鍵盤快捷鍵或其他觸發點補位。這是典型的「按鈕存在、handler 存在、但沒人能點到」死 UI,且因為在 4 個檔案裡以完全相同的模式重複出現,較可能是一次刻意但尚未清乾淨的功能下線/分階段釋出遺留,而非單一檔案的手誤——但無論成因為何,對使用者的最終效果一致:功能不可達。

**建議**
- 若功能仍在建置中:移除該按鈕或加上明確的 feature flag 條件渲染,而非留下一段「看似正常、實則永遠不顯示」的 JSX 誤導後續維護者。
- 若功能已可上線:把 `className` 開頭的 `"hidden "` 移除即可立即恢復四處入口。

---

## 7.〔High〕ImageStudio/ProStudio 建立的背景任務,經由 `generate.jobStatus` 的已知 IDOR(W3)可被枚舉讀取

**發現**

`docs/research/W3-generate-router-deepdive.md` 第 16-60 行已記載 `generate.jobStatus`(`server/routers/generate.ts:1536-1540`)完全沒有擁有權檢查:
```ts
jobStatus: protectedProcedure
  .input(z.object({ jobId: z.number() }))
  .query(async ({ input }) => {
    return db.getBackgroundJob(input.jobId);
  }),
```
本次確認 `ImageStudio.tsx`/`ProStudio.tsx` **都沒有直接呼叫**這支 `jobStatus`(全文搜尋 `trpc.generate.jobStatus` 零命中;W3 記載的實際呼叫端是 `client/src/pages/ModelsPage.tsx:531`、`client/src/pages/LoraTrainer.tsx:364`,超出本次稽核範圍)。但兩份稽核檔案建立背景任務的**唯一**途徑`generate.submitStudioJob`(見發現 2)寫入的正是同一張 `background_jobs` 表,`jobId` 是同一個自增整數主鍵。也就是說:雖然 ImageStudio.tsx/ProStudio.tsx 本身不觸發這條 IDOR,但它們產生的每一筆任務資料(包含完成後寫入 `resultJson.resultUrl`/`videoUrl`/`imageUrl`/`audioUrl` 的最終產出連結)都座落在這張被 `generate.jobStatus` 無差別暴露的表格裡,可被任何登入使用者以連號 `jobId`(如 1,2,3...)枚舉讀取。

**影響**
- 雖然觸發點不在本次稽核的兩個檔案內,但受害資料完全是這兩個檔案產生的——修 `generate.jobStatus` 本身(W3 建議的擁有者檢查)會同時保護 ImageStudio/ProStudio 的所有背景任務資料,值得在本報告內明確點出這個資料流關聯,避免修復時遺漏。

**建議**
- 見 W3 建議:比照 `checkStudioJob` 補上 `if (job.userId !== ctx.user.id) return null`。此為已知缺口,此處僅作跨檔案資料流關聯提示,不重複計分。

---

## 8.〔Medium〕`estimated_credits` 欄位被伺服端每支付費 mutation 回傳,卻從未在 ProStudio.tsx 顯示

**發現**

全文搜尋 `server/routers/proStudio.ts`,幾乎每一支計費 mutation 的回傳物件都包含 `estimated_credits: charged`(例如 `proStudio.ts:595,626,650,668,723,744,771,907,965,999,1078,1113,1146,1197,1221,1295,1325,1351,1389,1433,1469,1497,1528,1567,1596,1633,1910,1937,1961,1993,2116`,共 30+ 處),這是伺服端已經算好、貨真價實的本次扣點金額。但 `ProStudio.tsx` 全文搜尋 `estimated_credits`,**零讀取**——每一個把 mutation 結果存進 `setResult`/`setJobInfo`/`setKlingResult` 的地方,都只挑出 `request_id`/`model`/`audio_url` 等欄位使用,`estimated_credits` 被悄悄丟棄。`ImageStudio.tsx` 這一側因發現 3(零扣點)沒有對應欄位可丟,但同樣沒有任何生成前的成本預覽。

**影響**
- 使用者在 ProStudio 每次點擊生成前不知道「這次大概要花多少點」,生成後也不知道「剛剛實際扣了多少點」,只能透過應用程式全域外殼(`ENABLE_AIDV_CHROME`/`ENABLE_4SHELL` 旗標依 `client/src/config/featureFlags.ts:58,127-128` 皆預設 `true`,故現行預設外殼是 `AidvShellChrome`→`Rail`,其 `credits` 徽章見 `client/src/components/design-kit/chrome.tsx:199`;旗標關閉時回退到 `AppleDock.tsx:883-908` 的「配額 · N」)裡持續顯示的總餘額,自行心算前後差額去推斷——這件事在同時開著多個分頁/背景任務時幾乎不可行。

**建議**
- 在生成成功的 toast 或任務卡片裡加上「本次消耗 {estimated_credits} 點」的簡短文案,充分利用伺服端已經提供、目前被浪費的資料。

---

## 9.〔Medium〕`imageStudio.checkImageStatus`/`jobStatus`/`jobResult`(V1 記載之 IDOR 端點)在目前 ImageStudio.tsx 前端零呼叫——修正既有文件對「前端輪詢對象」的假設

**發現**

`docs/research/K2-generation-bugs.md`、`docs/research/V1-image-video-router-deepdive.md`(第 71-96 行)、`docs/research/P4-security-fixes.md` 等既有文件,均在敘述情境時假設「前端每 3 秒輪詢 `imageStudio.checkImageStatus`」。本次針對 `ImageStudio.tsx` 全文(5354 行)搜尋 `checkImageStatus`、`imageStudio.jobStatus`、`imageStudio.jobResult`,**三者皆零命中**。追蹤 `ImageStudio.tsx` 實際的非同步結果回收路徑(見發現 1、2),前端走的是 `registerBgTask` → `generate.submitStudioJob` → 輪詢 `generate.checkStudioJob`(**有**擁有權檢查,`generate.ts:2181-2182`)這條完全不同、且相對安全的路徑。

`server/routers/imageStudio.ts:1397-1511` 定義的 `checkImageStatus`/`jobStatus`/`jobResult` 三支端點確認**在伺服端真實存在**、邏輯完整(`checkImageStatus` 甚至有 `dedupeMarker` 去重與 `doPostGenComplete` 落地寫入),但目前是與 `generate.checkStudioJob` 功能重疊、彼此獨立維護的「姊妹端點」,且從 ImageStudio.tsx 的角度看是純粹的孤兒程式碼——它們依然可以被任何登入使用者以原始 tRPC 呼叫直接觸發(V1/K2 記載的 IDOR 依然真實存在、依然需要修),但**不是**透過「使用者正常操作 ImageStudio UI」這條路徑觸發,而是需要使用者主動繞過 UI、自行組 tRPC 呼叫。

**影響**
- 安全影響本身不變(這三支端點的 IDOR 依然是任何登入使用者可直接呼叫的真實漏洞,不因「前端沒有按鈕觸發」而降低可利用性),但本次稽核提供一個修正既有文件的事實澄清:一般使用者在毫無異常操作的情況下,不會透過現行 ImageStudio UI 觸發到這三支端點——威脅模型應聚焦在「攻擊者主動構造請求」而非「路過的使用者不慎踩到」。
- 對維護者而言,這是三支重複維護、行為卻不完全一致(見 V1 #8、#10 記載的 `userId: 0` 硬編碼、`costCredits` 揭露不一致等細節)的死碼,增加了日後修 bug 時「改了一邊漏了另一邊」的風險。

**建議**
- 若確認 `generate.checkStudioJob` 已是 ImageStudio 現行唯一輪詢路徑,建議直接移除 `imageStudio.ts` 內的 `checkImageStatus`/`jobStatus`/`jobResult`(或至少加上程式碼註解標明「已由 generate.checkStudioJob 取代,僅保留供舊版/外部呼叫」),避免未來修復 IDOR 時只修其中一支。

---

## 10.〔Medium〕Director AI 交接:未匯入腳本分鏡時,ImageStudio 的生成結果會靜默流失

**發現**

`ImageStudio.tsx:3013-3034`(`handleReturnToDirector`)把目前 prompt + 第一張結果圖打包進 `sessionStorage["directorReturn"]` 並跳轉 `/director`。接收端 `DirectorAI.tsx:2432-2447` 讀取後即刻 `sessionStorage.removeItem`(一次性讀取),存進 `pendingStudioReturn` state。真正套用的 effect(`DirectorAI.tsx:2596-2654`)開頭是:
```ts
useEffect(() => {
  if (!pendingStudioReturn) return;
  ...
  if (importedSegments.length === 0) return;   // ← 沒有清掉 pendingStudioReturn,也沒有任何提示
  const matchIdx = importedSegments.findIndex(s => s.storyboard.sceneHeading === sceneName);
  if (matchIdx === -1) { toast.info(...); setPendingStudioReturn(null); return; }
  setPendingStudioReturn(null);
  setPendingFill({...});   // 顯示徵詢確認卡片，使用者確認後才真的回填
}, [pendingStudioReturn, importedSegments]);
```
若使用者在導航到 Director AI 當下,**尚未匯入腳本分鏡**(`importedSegments.length === 0`),這個 effect 會直接 return,不清空 state、不顯示任何 toast——理論上等 `importedSegments` 之後變化(使用者匯入腳本)會重新觸發比對,設計上是「等待」而非「遺失」。但 `sessionStorage.removeItem` 在讀取當下(元件掛載時)就已執行(`DirectorAI.tsx:2436`),意味著這份 payload 現在只活在記憶體中的 React state 裡——**只要使用者在匯入腳本之前重新整理頁面、或這次 session 內始終沒有匯入腳本就離開**,這份從 ImageStudio 帶過來的生成結果就會無聲消失,沒有任何 toast、記錄或提示告訴使用者「你剛才的圖片沒有交接成功」。

**影響**
- 對北極星「創作者在單一專案裡走腳本→分鏡→逐幕」的敘事而言,這正是一個具體的流程斷點:如果創作者的操作順序是「先去 ImageStudio 生一張圖,再想到要建立/匯入這一集的腳本」,現有實作要求腳本必須已經匯入,否則會靜默漏接這次交接,而使用者完全不會意識到自己漏了什麼。

**建議**
- 在 `importedSegments.length === 0` 分支加上一次性 toast(例如「已收到 ImageStudio 的成品,匯入劇本後會自動幫你找對應分鏡」),讓使用者至少知道有一份待處理的交接資料還在等待,而不是被完全靜默處理。

---

## 11.〔Low〕`qwenCloneVoice` 端點全站零呼叫(死碼)

**發現**
`server/routers/proStudio.ts:984` 定義的 `qwenCloneVoice`,全站(`client/src`、`server`)搜尋除定義與註解外無任何呼叫端;`ProStudio.tsx` 的 `CloneTab` 實際使用的是二合一的 `qwenCloneAndSpeak`(`proStudio.ts:1011-1084`,`ProStudio.tsx:2351`)。程式碼註解(`proStudio.ts:1157` 附近)也自陳「與 `qwenCloneVoice` 的差異」,顯示是刻意迭代後留下的舊端點。

**影響**
- 純粹的維護負擔(多一支要跟著改 schema/定價的端點),不影響使用者體驗。

**建議**
- 確認無外部/行動端呼叫後可安全移除。

---

## 12.〔Low〕`falQueueRun` 的 `waitSec` 參數具誤導性簽章

**發現**
`imageStudio.ts:302-310` 的 `falQueueRun(modelId, input, waitSec = 180)` 簽章暗示「等待最多 waitSec 秒」,但函式體內從未讀取 `waitSec`,無條件立即回傳非同步佔位物件。是發現 1 的旁證,單獨列出以提醒清理。

**影響**
- 對後續維護者是誤導性訊號(閱讀呼叫端 `falQueueRun("fal-ai/hyper3d/rodin", payload, 300)` 容易誤以為系統會等待 300 秒才回應)。

**建議**
- 移除未使用的參數,或補上真正依 `waitSec` 同步等待的邏輯(與發現 1 的建議二擇一)。

---

## 已驗證排除的疑慮(negative results)

- **`BackgroundTasksDrawer` 的 `RefundStatusBadge`/`RefundDetailLink` 元件本身沒有 bug**:讀完 `BackgroundTasksDrawer.tsx:1-220`、`RefundStatusBadge.tsx`,確認這組 UI 元件的渲染邏輯與 `deriveJobRefundStatus`(`refundStatus.ts:88-134`)的推導規則完全對齊,若上游 `costPoints` 有被正確寫入,徽章會正確顯示 `none/not_refunded/partial/full`。問題出在資料源頭(發現 2),不在這個顯示元件。
- **`generate.checkStudioJob` 有正確的擁有權檢查**:`generate.ts:2181-2182` 的 `if (job.userId !== ctx.user.id) return null;` 確認存在且邏輯正確,是 ImageStudio.tsx/ProStudio.tsx 目前實際依賴的安全輪詢路徑,與發現 5/7 提到的其他端點形成對照組。
- **ProStudio 送出當下(非非同步輪詢後)失敗的退款邏輯正確**:抽查 `speechToVideo`(`proStudio.ts:1446-1469`)、`ltxAudioToVideo`(`proStudio.ts:1605-1638` 一帶)等多支 mutation,確認 `chargeForFalTask` 扣點 → `falQueueSubmit` 拋例外 → `catch` 內 `refundUserPoints` 退款 → 重新 `throw` 的模式一致存在,與 `docs/research/W2-prostudio-router-deepdive.md` 第 1.3 節「先扣點、後送出、失敗即退款」的既有結論相符。唯一缺口是「送出成功、佇列本身後續失敗」這一段(發現 2、4),而非送出當下失敗。
- **ImageStudio 的世界觀自動注入與 ProStudio 的刻意不注入,都是有意識的設計**:`ImageStudio.tsx:3383-3385` 的 `worldCtx.injectIntoPrompt` 與 `ProStudio.tsx` 對應處(約 4117-4121 行附近)的程式碼註解明確說明「音樂/語音輸入若自動注入世界觀前綴會污染內容,故只做唯讀 sidebar 參考」,是刻意的產品決策,不是遺漏的 bug。
- **ImageStudio.tsx 沒有顯示點數/成本資訊,與伺服端零扣點的事實一致**:不構成介面說謊的 contract-mismatch(見發現 3 的討論)。
- **全域餘額顯示確實存在,緩解(但不能消除)發現 8 的問題**:確認 `ProtectedDashboardRoute`(`App.tsx:162-177`)把 `ImageStudio`/`ProStudio` 包在 `DashboardLayout` 內;`DashboardLayout.tsx:564` 的 `credits.myBalance` 查詢本身只用於低餘額警示 toast 的門檻判斷(`DashboardLayout.tsx:569-599`),並未直接在該處渲染數字。真正持續可見的餘額顯示視 `DashboardLayout.tsx:877-884` 的旗標分支而定:讀 `client/src/config/featureFlags.ts:58,127-128`,`ENABLE_4SHELL`/`ENABLE_AIDV_CHROME` 皆預設 `true`,故程式碼現行預設會走 `AidvShellChrome` → `Rail` 的 `credits` 徽章(`chrome.tsx:199`);若旗標被關閉則回退到 `AppleDock` 的「配額 · N」(`AppleDock.tsx:883-908`,讀 `user?.remainingGenerations`)。兩條路徑都會顯示總餘額數字,只是都缺少「這次操作花了多少」的即時歸因;實際線上環境變數覆寫值未在本檔驗證。

## 未在本檔驗證
- `VideoStudio.tsx`、`DirectorAI.tsx` 內同款 `hidden` 按鈕(發現 6 提及)僅作為佐證瀏覽,未逐行覆核其上下文,不計入本報告嚴重度排序。
- `qwenCloneAndSpeak` 兩段式扣款(clone/TTS 各自 refund)的行號級覆核依賴既有 `docs/research/W2-prostudio-router-deepdive.md` 第 139 行結論,本次僅確認該端點在 `ProStudio.tsx:2351` 被實際呼叫,未重新逐行複算退款金額正確性。
- LoraTrainer.tsx/ModelsPage.tsx 對 `generate.jobStatus` 的實際呼叫上下文,僅作發現 7 的資料流關聯佐證,未列入本次逐行稽核範圍。
