# IN1 — 前後端契約:生成/studio 域
- 產生日期:2026-07-03
- 依據 commit:812f6fdb ⚠️ 該 hash 在本 repo 歷史中不存在(`git cat-file -t 812f6fdb` → `fatal: Not a valid object name`)。本次稽核實際依據 HEAD `7f4417daaacbf24510dc20d88dba9aae71b2883c`(`docs(research): Q4 光球工具全表+63 registry缺口逐一清單`),下列所有行號均對應此 commit。
- 稽核接縫:server/routers/{generate,imageStudio,videoStudio,proStudio}.ts ↔ client/src/pages/{ImageStudio,VideoStudio,ProStudio,AnimationStudio}.tsx

## 方法論
逐一列出四個 router 的 procedure(含隱藏在 `[a-zA-Z0-9]` 命名如 `veo3TextToVideo`/`stableDiffusion35` 的條目,初次 grep 因正則遺漏數字字元而誤判過幾個「不存在」的 procedure,已重跑修正),再逐一比對四個 client 頁面實際呼叫的 `trpc.xxx.yyy.useMutation/useQuery`,雙邊都讀過才下判斷。對每個 procedure 追蹤:(a) 回傳欄位 client 有沒有用、(b) client 讀的欄位 server 有沒有回、(c) 輸入方向 client 送的 server 有沒有收/驗、(d) 型別/格式一致性。

---

## 發現(按嚴重度排序)

### F-1 [high] field-inconsistency — `recordGenResult` 契約缺 `costCredits`,ImageStudio 的每一筆生成成本紀錄都被寫死成 1 點
- **endpointA**: `client/src/pages/ImageStudio.tsx:3820-3827`(`recordGenResultMut.mutateAsync({ modality, modelId, prompt, resultUrl, label, sourceStudio })` — 全站 26 個 imageStudio 生成模型共用同一個 `recordGenResultMut`,呼叫時完全不帶任何成本/點數欄位;`grep -n "estimatePoints\|costPoints\|totalPoints\|costCredits" ImageStudio.tsx` 零命中)
- **endpointB**: `server/routers/generate.ts:2414-2436`(`recordGenResult` 的 zod input schema 只有 `modality/modelId/prompt/resultUrl/label/sourceStudio`,**沒有 costCredits 欄位**,呼叫 `doPostGenComplete` 時也沒有帶 `costCredits`)→ `server/services/postGenActions.ts:238-243,284-285`(`costCredits?: number` 缺值時 「退回 1 以保留原行為」)
- **影響**: ImageStudio 是四個 studio 中對照組——它是唯一走「同步 mutation → 直接呼叫 recordGenResult」模式的頁面(其餘三頁走「非同步 request_id → 輪詢 checkXStatus → server 端 doPostGenComplete」)。26 個模型裡從 nanoBanana2(便宜 T2I)到 trellis2/hunyuan3d(較貴的 3D 重建)全部被記成 `generation_history.costCredits = 1`,不論實際模型定價。任何依賴 `generation_history.costCredits` 做的成本分析/積分帳本對帳,ImageStudio 這條路徑的資料全部失真。同一份 postGenActions.ts 內建的 `imageStudio.checkImageStatus`(見 F-2)反而正確算出 `estimatePoints(modelId).totalPoints` 並傳入——即「對的寫法就在旁邊,但沒人呼叫它」。此問題與已知 B-19(`submitStudioJob` 不寫 costPoints)同屬「生成完成後未如實記錄實際成本」的一類,但發生在不同的 procedure(`recordGenResult`)上,是獨立佐證,非重複。
- **建議**: 在 `recordGenResult` 的 zod schema 加上 `costCredits?: number`(或直接在 server 端用 `estimatePoints(modelId, {...})` 算,不依賴 client 回傳,更安全),並透傳給 `doPostGenComplete`。

### F-2 [high] dead-seam — `imageStudio.jobStatus` / `jobResult` / `checkImageStatus` 完整建置但 ImageStudio.tsx 從未呼叫
- **endpointA(server 產出)**: `server/routers/imageStudio.ts:1397-1511`——三個 query procedure,其中 `checkImageStatus`(1419-1511)是最完整的一個:輪詢 fal 任務、`localizeResultUrls`、萃取 `image_url`/`model_glb_url`、**用 `estimatePoints(modelId).totalPoints` 正確計算 costCredits**、走 `doPostGenComplete` 全套(prompt 庫/資產庫/歷史/監控室 + dedupeMarker 防重複)。註解明寫「支援所有 imageStudio 的异步任務」。
- **endpointB(client 消費)**: `client/src/pages/ImageStudio.tsx` 全檔案搜尋 `imageStudio\.(jobStatus|jobResult|checkImageStatus)` 零命中——ImageStudio.tsx 的所有 mutation(nanoBanana2/trellis2/…)走的是 `generationProcedure` 內部用 `falQueueRun(...,300)` **阻塞式**等待完成後直接回傳最終結果(見 imageStudio.ts:1190-1206 trellis2 範例:`await falQueueRun(...)` 直接拿到 `raw`,回傳 `{model_glb_url, raw}`,不是 request_id),因此完全用不到這條輪詢鏈路。
- **影響**: 這是一段完整、經過設計(含 costCredits 正確記帳)但**永遠不會被執行**的程式碼路徑——三個 procedure、~115 行邏輯是死代碼。同時也解釋了 F-1:正確的記帳邏輯其實已經寫好在這裡,只是接錯了插座。
- **建議**: 二選一——(a) 確認 `falQueueRun` 現在都是同步阻塞模式後,直接刪除這三個死 procedure 與相關的 `falQueueStatus`/`falQueueResult` 引用以減少維護面;(b) 若未來要把 imageStudio 也改回非阻塞模式,把 F-1 的修法改成「複用 checkImageStatus 現成的 costCredits 邏輯」而不是在 recordGenResult 另開一條路。

### F-3 [high] broken-handoff — VideoStudio / ProStudio 回傳導演 AI 時 `resultUrl` 寫死 `null`(C-01 延伸到 ProStudio,非僅 VideoStudio)
- **endpointA-1**: `client/src/pages/VideoStudio.tsx:4967-4993`(`handleReturnToDirector`)——`resultUrl: null,`(第 4985 行),即使當下面板已經有生成完成的影片 URL(`AsyncVideoPoller` 的 `result.video_url`,VideoStudio.tsx:99/743/753),`handleReturnToDirector` 完全沒有引用任何 result 狀態,只塞 `finalPrompt`/`modelId`。
- **endpointA-2**: `client/src/pages/ProStudio.tsx:4326-4354`(同名 `handleReturnToDirector`)——同樣 `resultUrl: null,`(第 4346 行),即使 `bridgeRef.current.getState?.()` 已經能读到子 tab state。
- **對照組(正確寫法)**: `client/src/pages/ImageStudio.tsx:3013-3043`——`const firstImage = resultImages[0] ?? result3d?.glbUrl ?? resultPose ?? null;` 再把 `resultUrl: firstImage` 填入,是三者中唯一把實際結果帶回去的。
- **endpointB(消費端)**: `client/src/pages/DirectorAI.tsx:2422-2447`(讀取 `sessionStorage["directorReturn"]`,型別 `DirectorReturnPayload` 含 `resultUrl?: string | null`)→ `DirectorAI.tsx:2634`(`description: data.resultUrl ?? undefined`)、`2651`(`resultUrl: data.resultUrl ?? undefined`)——這兩處會把 `resultUrl` 顯示在確認卡片/回填筆記裡,對 video_studio / pro_studio 來源永遠顯示「無」。
- **影響**: 使用者從 VideoStudio 或 ProStudio 點「回到導演 AI」時,DirectorAI 端的確認卡片/回填永遠看不到剛剛生成的影片或音訊連結,只有 ImageStudio 這條路徑正常。體驗不一致,且與已知 C-01(「VideoStudio→DirectorAI resultUrl:null」)完全吻合、並確認 ProStudio 有相同缺陷(prior 未提及 ProStudio)。
- **建議**: 仿 ImageStudio 寫法,在 VideoStudio/ProStudio 的 `handleReturnToDirector` 內從各自的 result state(`klingResult.video_url` 等 / `bridgeRef.current.getState?.()` 對應的 audio/video URL)組出實際值。

### F-4 [medium] dead-seam — VideoStudio 多個 mutation 回傳的降級中繼資料(`model_used`/`model_requested`/`degraded`/`degraded_reason`/`output_spec_downgrades`)從未被讀取或顯示
- **endpointA(server 產出)**: `server/routers/videoStudio.ts:287-308`(`withSubstitutionMeta`,型別包含 `model_used/model_requested/degraded?/degraded_reason?`)、註解 244 行明寫「the response carries model_requested / model_used / degraded so the UI can surface『上游暫停,已使用 X 代替』」。實際套用在至少 `klingTextToVideo`(598-606)、`wanTextToVideo`(650-656)、`minimaxTextToVideo`(693-697)、`ltxTextToVideo`(740-745)、`klingImageToVideo`(869-873)、`videoUpscale`(1304-1308)等多個 procedure。另外 `outputSpecDowngrades`(applyOutputSpec 產出)也在多處以 `output_spec_downgrades` 欄位附加(603/655/698/745 等)。
- **endpointB(client 消費)**: `client/src/pages/VideoStudio.tsx:98-102`——`interface VideoResult { video_url?; request_id?; raw?; }`,型別上完全沒有 `model_used`/`degraded`/`output_spec_downgrades` 這幾個欄位;對整檔 `grep -n "\.degraded\b\|\.model_used\b\|\.model_requested\b\|\.output_spec_downgrades\b"` 只命中第 183 行的**註解**,沒有任何實際讀取/渲染邏輯。`klingMut` 等 mutation 也只掛了 `onError`(893-910),没有 `onSuccess` 去處理這些欄位。
- **影響**: 後端刻意設計的「模型被下線→透明替換→告知使用者」UX(對應本 repo 另一個已知痛點:上游 fal 端點常態性下線/改名)在 VideoStudio.tsx 完全沒有落地——使用者被靜默换成替代模型卻毫無提示,只有程式碼裡的 in-flight 資料,沒有 UI。這批欄位技術上存在於執行期物件(因為 `onResult` 是泛型轉發,見 `useSubmitGeneration.ts:107-108`),只是型別和渲染層都沒有接住。
- **建議**: 把 `degraded`/`model_used`/`degraded_reason`/`output_spec_downgrades` 加進 `VideoResult` 型別,並在 `VideoResultPanel`/`AsyncVideoPoller` 附近補一個提示 banner(`role="status"`,對應 662 行註解原本設想的用法)。

### F-5 [medium] broken-handoff — VideoStudio 佇列面板「生成」按鈕不會把結果寫回 storyboard job 狀態(worldStoryboard.ts,C-02 同類但不同 router;範圍說明見下)
> 註:此接縫的 server 端落在 `worldStoryboard.ts`,不在題目點名的四個 router 之列,但它是 `VideoStudio.tsx`(題目點名的 client 頁)實際依賴的資料源,故列為延伸發現而非嚴格 in-scope 發現。
- **endpointA**: `client/src/pages/VideoStudio.tsx:5151-5237`(AIDV-151 導演 AI 影片製作佇列面板)——`onClick={() => { setActiveTab("t2v"); ... agentBus.dispatch({ type:"fillPrompt", payload:{ text: visualPrompt } }); }}`(5207-5215)。點擊「生成」只把 `visualPrompt` 塞進 t2v tab 的輸入框,**沒有攜帶 `segId`**(閉包裡明明有 `segId`,見 5177 的 `.map(([segId, job]) => ...)`,但 onClick handler 完全沒引用它)。
- **endpointB**: `server/routers/worldStoryboard.ts:587-598`——`jobsJson[seg.segmentId] = { status: "queued", visualPrompt, sceneHeading, mood, musicVibe, audioScript, queuedAt }`,而全 repo 唯一會更新這個 `jobsJson[...].status`(改成 success/failed)的地方是 `server/routers/director.ts:1223-1408` 的 `batchGenerateWithSession`(收到 `storyboardId` 時才會更新對應 segId 的狀態)。`worldStoryboard.ts` 本身沒有任何「依 segId 更新單一 job 狀態」的 procedure。
- **影響**: 使用者若不是用 DirectorAI 的批次生成(`batchGenerateWithSession`),而是打開 VideoStudio 佇列面板手動逐鏡「生成」,不論生成成功與否,該鏡頭在 `jobsJson` 裡永遠停在 `status:"queued"`——因為(1) `segId` 在點擊當下就被丟棄,(2) 就算沒丟棄,`worldStoryboard.ts` 也沒有對應的「更新單一 job 狀態」procedure 可呼叫。佇列面板顯示的「queued/success/failed」徽章因此對手動路徑永遠失真。
- **建議**: 若要保留這個手動路徑,至少要:(a) 把 `segId` 帶進 `agentBus.dispatch`/`submitGeneration` 的上下文,(b) 在 `worldStoryboard.ts` 新增一個 `updateJobStatus({id, segId, status, resultUrl})` procedure,由 t2v 生成成功/失敗的 callback 呼叫。

### F-6 [low] scope note — `AnimationStudio.tsx` 與題目點名的四個 router 完全沒有接縫
- **endpointA**: `client/src/pages/AnimationStudio.tsx` 全檔案對 `trpc\.(generate|imageStudio|videoStudio|proStudio)\.` 的搜尋為 **零命中**。
- **endpointB**: 該頁實際呼叫的是 `worldbuilding.*`(create/delete/update/list/exportFull/importFull/linkableModels/linkableVoices)、`worldStoryboard.*`(get/listByWorld/seedSkeleton/planPipeline/exportShotList/delete/update)、`worldbuildingGeneration.*`(generateCharacter/generateScene/generateStoryboard),見 `client/src/pages/AnimationStudio.tsx:4689-5724`。
- **影響**: 非缺陷,但題目要求的「AnimationStudio.tsx ↔ {generate,imageStudio,videoStudio,proStudio}」這條線本身不存在——AnimationStudio 是分鏡/世界觀編輯器,不直接觸發模型生成。若稽核目的是要涵蓋 AnimationStudio 的契約風險,真正該追的 router 是 `worldStoryboard.ts` / `worldbuilding.ts` / `worldbuildingGeneration.ts`(均不在本次委託範圍內,未深入稽核,標記「未在兩端驗證」)。
- **cluster**: other

---

## 已驗證接得對的接縫(negative results)

1. **ImageStudio.tsx ↔ imageStudio.ts 生成 procedure 全覆蓋**:重新用容錯 regex(含數字字元,如 `stableDiffusion35`/`trellis2`/`sam3dObjects`/`hunyuan3d`/`rodin3d`)核對後,server 26 個 procedure 中 23 個生成類(nanoBanana2/nanoBananaPro/seedreamV4/imagen4/…edit 系列/seedVRUpscale/dwPose/stableDiffusion35/fastSdxl/sdLora/trellis2/sam3dObjects/hunyuan3d/rodin3d/hunyuanWorld)全部在 `ImageStudio.tsx:3253-3283` 的 `mutations` map 裡有對應呼叫者,參數/欄位命名一致。唯一缺口是輪詢類三個(見 F-2)。

2. **videoStudio.ts 非同步持久化管線正確接線**:`falQueueSubmit`(videoStudio.ts:68-110)只回傳 `request_id`,`falQueueRun`(210-218)不阻塞、直接回 `{request_id, raw_model_id, is_async_polling:true}`→ client `AsyncVideoPoller`(VideoStudio.tsx:706-734)以 `enabled: !!(result.request_id && !result.video_url && modelId)` 條件觸發 `checkVideoStatus` 輪詢 → server 端(videoStudio.ts:1692-1733)在 `COMPLETED` 時呼叫 `doPostGenComplete` 並用 `dedupeMarker = "[videoStudio:<model>:<request>]"` 防止輪詢多次造成重複寫入。此鏈路欄位命名(`requestId`/`modelId`/`video_url`)雙邊一致,推翻了「VideoStudio 生成永遠不進資產庫」的疑慮(該歷史 bug 已由此鏈路修復,程式內註解 1709-1711 亦明確記載修復動機)。

3. **proStudio.ts checkAudioStatus 同款正確接線**:`checkAudioStatus`(proStudio.ts:1688-1780+)同時支援 audio_url 與 video_url 萃取(dubbing/avatar 類回傳影片),接上 `doPostGenComplete`,dedupeMarker 格式一致(`[proStudio:<model>:<request>]`)。`generateMusicSuno`/`checkMusicSunoStatus`(proStudio.ts:2014-2139+)走獨立但完整的點數記帳流程:`estimatePoints`→`chargeForFalTask`→ 失敗時 `atomicClaimJobRefund`+`refundUserPoints`(冪等防雙退),client 端 `ProStudio.tsx:1096-1143` 的 `sunoJob` state(`taskId`/`jobId`/`modelVersion`)與 server 回傳欄位完全對齊。

4. **DirectorAI → ImageStudio/VideoStudio/ProStudio 正向 handoff(`sendToStudio`)欄位契約一致**:`client/src/lib/send-to-studio.ts:52-76` 定義的 `SendToStudioPayload`(`prompt/generationType/overrideEngine/source/sceneName/segmentContext/…`)與 `DirectorAI.tsx:1239-1253`、`1300-1315` 實際組出的 payload(`segmentContext: {sceneHeading, mood, duration}`)跟三個 studio 頁面的讀取邏輯(`ImageStudio.tsx:3197-3226`、`VideoStudio.tsx` 對應區塊、`ProStudio.tsx:4193-4250`)欄位命名完全對齊,`overrideEngine` 經 `normalizeEngineModelId` 正確反解成 `MODELS` 條目。

5. **outputSpec(resolution/fps/codec)前後端契約一致且有位元零變化安全設計**:client `OutputSpecSelector.tsx:16-24`(`OutputResolution/OutputFps/OutputCodec`)與 server `videoStudio.ts:325-327`(`videoOutputSpecSchema`)三個欄位的列舉值(`720p/1080p/4K`、`24/30/60`、`h264/h265/vp9`)完全一致;`outputSpecForGeneration()`(OutputSpecSelector.tsx:61-67)在使用者未變更預設值時刻意回傳 `undefined`,避免對不支援 outputSpec 的模型(如 Veo3 以外)注入多餘欄位造成回歸——這是一個經過設計、雙邊都驗證過的防禦性契約。

6. **registerBgTask 讀取欄位與 videoStudio.ts 回傳格式吻合**:`BackgroundTasksContext.tsx:594-617` 的 `useRegisterBgTask` 用 `r?.request_id ?? r?.raw?.request_id` 與 `r?.raw_model_id ?? r?.raw?.raw_model_id ?? r?.model` 雙路徑容錯提取,與 videoStudio.ts 的 `withSubstitutionMeta` 回傳結構(`{video_url, request_id, raw, model_used, …}`,其中 `raw` 內層才是 `{request_id, raw_model_id}`)相容。

---

## 附註:B-19 / C-02 在本次追蹤範圍內的現況
- **B-19**(`submitStudioJob` 不寫 costPoints):`server/routers/generate.ts:2143-2176` 的 `submitStudioJob`/`checkStudioJob` **未被本次四個 client 頁面呼叫**(`grep trpc.generate.submitStudioJob/checkStudioJob` 在 ImageStudio/VideoStudio/ProStudio/AnimationStudio.tsx 均零命中;實際呼叫者是 `client/src/shells/video/drawers/FlowTv.tsx`、`ShotDetailCanvas.tsx`、`BackgroundTasksPage.tsx` 等,不在本次委託範圍)。四個 tracked 頁面各自繞開 `submitStudioJob`,改用自己 router 的同步 mutation + `checkXStatus` 輪詢(videoStudio/proStudio 這條線是接對的,見 negative result 2/3;imageStudio 這條線本身沒接皮帶,見 F-1/F-2)。故 B-19 本身在本次四頁範圍內「未再現」,但其代表的「生成完成未寫實際成本」問題在 F-1 以另一個 procedure 重現,判定為同類但獨立的缺陷,未重複計分。
- **C-02**(`batchGenerateWithSession` 不傳 storyboardId):procedure 位於 `server/routers/director.ts:1175`,呼叫者是 `client/src/pages/DirectorAI.tsx:2907`,两端皆不在本次四個 router / 四個 client 頁面的清單內,**未在兩端驗證**。唯一與本次範圍的交集是 F-5(VideoStudio 佇列面板讀 `worldStoryboard.get` 顯示 `batchGenerateWithSession` 寫入的 `jobsJson`),已在 F-5 記錄現況。
- **SSOT-1**(appRegistry.supportedActions↔hasCapabilityForPage):對四個 router 檔與四個 client 頁面檔案搜尋 `supportedActions`/`hasCapabilityForPage` 均零命中,**未在兩端驗證**,本次不予延伸。
