# IN8 — 事件/背景任務接線(SSE/WS/webhook↔UI)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb(HEAD 為 4642549f；三個追蹤檔案在此範圍內無變更，內容一致)
- 稽核接縫:client/src/contexts/BackgroundTasksContext.tsx ↔ server/services/sseRouter.ts、server/routes/webhooks*.ts、background_jobs 回填鏈

## 0. 範圍校正(方法論筆記，非缺陷)

Prompt 指定的 glob `server/routes/webhooks*.ts` 只命中 `server/routes/webhooks.ts`——這其實是 ORB 代理 webhook(`/api/orb`，`runSchemaFirstAgentPlanner` 用)，與 `background_jobs` 回填鏈無關。真正驅動 `BackgroundTasksContext` 狀態回填的 webhook 是:
- `server/routes/webhookFal.ts`(fal.ai 影像/影片/3D/音訊)
- `server/routes/webhookSuno.ts`(Suno 音樂)
- `server/routes/webhookReplicate.ts`(LoRA 訓練，走 `model-training:*` channel，非本追蹤範圍)

本報告以這三個檔案 + `server/routers/generate.ts`(`submitStudioJob`/`checkStudioJob`/`activeJobs`)+ `server/generationEvents.ts` 為實際稽核對象。

---

## 1. 接縫斷點(依嚴重度排序)

### F1. 〔critical / dead-seam〕`BackgroundTasksDrawer` 從未掛載——`drawerOpen`/`setDrawerOpen` 全站為 no-op

**斷點兩端**:
- endpointA(context 寫入端):`client/src/contexts/BackgroundTasksContext.tsx:319-324`——任務完成 toast 的「查看」按鈕 `onClick: () => setDrawerOpen(true)`；`errorMessage`/失敗 toast 同樣依賴 drawer(:370-382)。`drawerOpen`/`setDrawerOpen` 於 context value 對外暴露(:162-163, 567)。
- endpointB(唯一讀者，未掛載):`client/src/components/BackgroundTasksDrawer.tsx:260-262`——是全庫**唯一**讀取 `drawerOpen`(`useBackgroundTasks()` 解構)的元件。對 `client/src` 全樹 grep `BackgroundTasksDrawer` 只命中該檔案自身；`useBackgroundTasks` 的 12 個消費者中(`ImageStudio.tsx`/`Studio.tsx`/`DirectorAI.tsx`/`SegmentProgressLabel.tsx`/`SSEFallbackBanner.tsx`/`ActiveVideoTasksBanner.tsx`/`AppleDock.tsx`/`BackgroundTasksDrawer.tsx` 等)，沒有任何一個 import 或渲染 `BackgroundTasksDrawer`。
- 補充端:`client/src/components/DashboardLayout.tsx:491-493` 掛載 `BackgroundTasksProvider`(context 全站生效)，但同檔案在預設 chrome(`ENABLE_AIDV_CHROME` 預設 ON，見 `featureFlags.ts:127-128`)路徑下渲染的 `AidvShellChrome.tsx` 對 `useBackgroundTasks`/`BackgroundTasksDrawer` **零引用**(全檔 grep 無命中)。舊 chrome `AppleDock.tsx:145-290` 有自己獨立重寫的 `BackgroundTasksDockButton`(見 F3)，也不讀 `drawerOpen`，用自己的 `React.useState(false)`(:153)。

**影響**:使用者在任一頁面收到「✅ XX 已完成」toast 後按「查看」，或失敗任務想開面板追蹤，`setDrawerOpen(true)` 只改變一個沒人訂閱的 context 欄位——UI 上什麼都不會發生。整個為此功能打造的介面(退款徽章、影片內嵌預覽、重試按鈕、分段進度、失敗原因)在預設 chrome 下對使用者完全不可見；使用者能感知任務狀態的唯一管道剩下 toast 本身 + `/video` 頁專屬的 `ActiveVideoTasksBanner`。此發現與 `docs/research/01-features.md:295`(「BackgroundTasksDrawer 元件孤兒(Context 完整運作)」)一致，本報告在 HEAD 上重新驗證並補上精確兩端行號與「setDrawerOpen 完全无处生效」的具體使用者動作路徑。

**建議**:短期——在 `DashboardLayoutContent`(或 `AidvShellChrome` 的固定角落)掛一個全站常駐的 `<BackgroundTasksDrawer />`(比照 `ActiveVideoTasksBanner` 只在 /video 才顯示的模式，這個該是全站級)；或至少讓 `AppleDock` 的 `BackgroundTasksDockButton` 改讀共享 `drawerOpen`/`setDrawerOpen`，讓兩處「開啟面板」語意一致。長期評估：若已判定此面板要被 4-shell 的新 UI 取代，應把 `setDrawerOpen(true)` 呼叫點也一併清掉，避免死狀態機誤導後續維護者。

---

### F2. 〔high / dead-seam，延伸 B-19〕`submitStudioJob` 不寫 `costPoints`——退款徽章鏈路對此類任務恆為靜默 no-op

**斷點�wo端**:
- 寫入端:`server/routers/generate.ts:2153-2168`(`submitStudioJob` mutation)——`resultJson` 只有 `{requestId, modelId, studioType, label, prompt}`，**沒有 `costPoints`**。這是 ImageStudio/ProStudio/VideoStudio「先呼叫模型 mutation 拿 request_id、後端 `registerBgTask`→`submitStudioJob` 補登記」流程建立的 job(見 `client/src/pages/ImageStudio.tsx:3712-3724`、`client/src/contexts/BackgroundTasksContext.tsx:594-617` 的 `useRegisterBgTask`)。
- 讀取端:`server/services/postGenActions.ts:575-587`(`refundJobIfBilled`)——`points = meta.costPoints > 0 ? ... : 0; if (points <= 0) return false;`——對此類 job 恆定 `costPoints` 缺失 → 函式在讀到 job 後立即短路，不會執行 `atomicClaimJobRefund`/`refundUserPoints`。呼叫點:`server/routes/webhookFal.ts:268`(no-URL 失敗路徑)、`:338`(ERROR 路徑)、`server/routers/generate.ts:2205`(30 分鐘 stale 超時)、`:2301`(completed 但抽不到 URL)、`:2350`(fal queue FAILED)。
- UI 端:`server/services/refundStatus.ts:105-116`(`deriveJobRefundStatus`)——`charged<=0` 分支回傳 `refundStatus:"none"`；`client/src/components/refundStatus.ts:62-65`(`describeRefundBadge`)對 `none`/`unknown` 回傳 `null` → `RefundStatusBadge`(`client/src/components/RefundStatusBadge.tsx:56-58`)與 `RefundDetailLink` 都安靜不渲染。

**影響**:對 image/audio/voice/video 這條「同步呼叫模型 mutation → 事後登記背景任務」的路徑而言，即使使用者實際被扣點(扣點邏輯位於各 `imageStudio.ts`/`proStudio.ts` 的模型 mutation 或其呼叫的計費站點，是否對這批 job 有效扣點**未在兩端驗證**，不臆測)，一旦該任務事後在 webhook/輪詢失敗，`refundJobIfBilled` 保證不會退款，且退款徽章 UI 也保證不會顯示任何警示——使用者對「扣了錢但沒退」這件事拿不到任何信號。這是 Y0(`docs/research/Y0-frontend-carpet-scan-synthesis.md:109`)「submitStudioJob 從不寫 costPoints，退款邏輯保證 no-op」在 HEAD 上的重新驗證+延伸(補上讀寫兩端行號 + UI 端的靜默降級路徑)。

**建議**:比照 `server/routers/director.ts:3024-3027`(`chargedPoints`/`costPoints` 同額寫入)的模式，在 `submitStudioJob` 建 job 時，若呼叫端能提供本次模型呼叫的預估/實際扣點金額，一併寫入 `resultJson.costPoints`。若目前這條路徑本來就不預先扣點(而是完成後才依 `doPostGenComplete` 記帳，如 `imageStudio.ts:1462-1479` 的 `costCredits`)，則需要另一條退款判斷依據，不能沿用 `costPoints` 語意——這點需與計費站點的實際扣點時機一併確認,本報告不臆測。

---

### F3. 〔high / field-inconsistency〕`activeJobs` 未過濾 `jobType`——訓練/教材任務可能混進 studio 專用的背景任務 feed

**斷點兩端**:
- DB/schema 端:`drizzle/schema.ts:291-300`——`backgroundJobs.jobType` enum 包含 `image|video|audio|voice|zip_export|multimodal|model_training|teaching_archive_ingestion`，遠多於 client 的 `StudioJobType`(`image|video|audio|voice`，見 `client/src/contexts/BackgroundTasksContext.tsx:133`)。實際會建立 `model_training` job 的:`server/routers/models.ts:240-247`(resultJson 僅 `{modelId, modelName}`，無 `studioType`);建立 `teaching_archive_ingestion` job 的:`server/services/teachingArchiveIngest.ts:63-68`(resultJson 僅 `{materialId}`，無 `studioType`)。兩者皆會被驅動經過 `processing`/`completed`/`failed` 狀態(`server/services/loraTrainer.ts` 多處 `updateBackgroundJob`；`server/jobs/teachingArchiveIngestionWorker.ts` 多處 `updateBackgroundJob`)，因此在 24 小時窗內是真實可達的。
- 查詢端:`server/routers/generate.ts:2371-2399`(`activeJobs`)——`where` 只比對 `userId` + `status`，**沒有 `eq(backgroundJobs.jobType, ...)` 過濾**，任何 jobType 的 row 都會被回傳。
- 消費端:`client/src/contexts/BackgroundTasksContext.tsx:228-229`——`studioType: (meta?.studioType as StudioJobType) ?? (j.jobType as StudioJobType)`；對這兩類 job，`meta.studioType` 不存在 → 直接把 `jobType` 字面值("model_training"/"teaching_archive_ingestion")硬轉型成 `StudioJobType`。渲染端:`client/src/components/AppleDock.tsx:249,276`(`t.label || t.studioType`，`label` 也缺失 → 直接把英文 snake_case 字面值顯示給使用者)；`client/src/components/BackgroundTasksDrawer.tsx:145,152`(`STUDIO_ICON[task.studioType] ?? STUDIO_ICON.image` / `STUDIO_LABEL[task.studioType] ?? task.studioType`，同樣的字面值洩漏，但此元件本身未掛載，見 F1)。

**影響**:目前唯一「上線可見」的消費點是 F1 所述、僅在舊 chrome(`ENABLE_AIDV_CHROME=false`)才會渲染的 `AppleDock` flyout——使用者若在重訓 LoRA 模型或匯入教材時剛好走舊 chrome，會在「背景任務」快顯清單看到一則標籤是英文字面值 `model_training`/`teaching_archive_ingestion` 的怪異項目，混在圖片/影片/音樂任務中間。若 F1 被修掉(把 `BackgroundTasksDrawer` 掛回全站)，此問題會在預設 chrome 下同步曝光,影響面擴大。`zip_export` 這個 enum 值目前全庫無建立點(死值，非本回合重點)。

**建議**:`activeJobs` 查詢加上 `inArray(backgroundJobs.jobType, ["image","video","audio","voice"])`(或等效 `studioType` 白名單過濾),把訓練/教材任務排除在「創作工作室背景任務」feed 之外;它們各自已有專屬 UI(`LoraTrainer.tsx` 的 SSE、`TeachingArchive.tsx` 的狀態顯示)。

---

### F4. 〔medium / broken-handoff〕`SSEFallbackBanner`(降級提示)只掛在 `/video` 殼，`sseConnected` 卻是全站狀態

**斷點兩端**:
- 狀態產生端:`client/src/contexts/BackgroundTasksContext.tsx:203`(`sseConnected` state)與 :400-479(SSE 訂閱 effect，斷線 5 秒後 `setSseConnected(false)`)——此 effect 對**所有** `activeJobIds`(image/video/audio/voice 皆含)生效，`BackgroundTasksProvider` 掛在 `DashboardLayout.tsx:491-493`,全站生效。
- 唯一 UI 讀者:`client/src/components/SSEFallbackBanner.tsx:7-11`(`if (sseConnected || activeCount===0) return null`)——全庫 grep 只有 `client/src/shells/video/VideoCockpitFrame.tsx:19,33` 一處掛載它。預設 chrome 的 `AidvShellChrome.tsx`、`DashboardLayout.tsx` 皆未引用 `SSEFallbackBanner`。

**影響**:使用者在 ImageStudio/ProStudio(圖片/音樂/語音生成)頁面時,若 SSE 斷線降級為 5 秒輪詢,不會有任何 banner 提示——只有恰好在 `/video` 殼(VideoCockpitFrame)才看得到。降級本身不影響資料正確性(輪詢仍會補上),但屬於「狀態產生是全站的、消費端範圍卻窄化」的 UI 認知落差。

**建議**:把 `SSEFallbackBanner` 提升到 `DashboardLayoutContent` 或 `AidvShellChrome` 等全站層級掛載一次,或明確在元件文件註明「僅影片殼提示」為刻意設計(若是刻意,需要補文件澄清這不是遺漏)。

---

### F5. 〔medium / dead-seam，已有 fallback 緩解，屬已自我記錄的現況確認〕`segment_started` / `segment_completed` SSE 事件結構性收不到

**斷點兩端**:
- `segment_started` 發送端:`server/routers/director.ts:3036-3047`——`generationBus.emit(jobId, {type:"segment_started",...})` 與 `db.updateBackgroundJob` 都在同一個 tRPC mutation(`executeGenerationTask`)內、**於 `return {jobId, requestId}` 之前**同步執行。客戶端要等 tRPC mutation 回傳、再等 `activeJobsQuery` 輪詢/`notifyJobStarted` 觸發 `activeJobIds` 更新,才會在 `client/src/contexts/BackgroundTasksContext.tsx:400-421` 的 effect 中對該 jobId 開啟 `EventSource`——此時 emit 早已發生過,監聽器根本還不存在。
- `segment_completed` 發送端:`server/routes/webhookFal.ts:310`(先 emit `type:"complete"`)緊接 `:311-324`(if `sourceStudio==="director"` 才 emit `segment_completed`)——兩者在**同一個同步函式呼叫序列**內執行。而 legacy SSE 路由 `server/sseRoute.ts:161-178` 的訂閱回呼在收到 `complete` 事件時,會在寫出該事件後**同步呼叫 `unsubscribe()`**(:170-171,先於 500ms 後才 `res.end()`),於是輪到 `segment_completed` emit 時監聽器已被移除。Client 端自己也在 `BackgroundTasksContext.tsx:446-454` 於收到 `complete`/`error` 時同步 `es.close()`,雙重保證漏接。

此現象已由程式碼自身的註解記載(`client/src/contexts/segmentProgress.ts:90-99`),並非本次新發現,但本報告在 HEAD 上重新走過兩端程式碼逐行確認其成立。

**影響**:分段進度標籤(「第 X/N 段」)若只依賴 SSE 永遠不會正確渲染。但專案已內建 polling-based fallback:`client/src/contexts/segmentProgress.ts:110-128`(`deriveSegmentProgressFromJobMeta`,從 `activeJobs` 輪詢帶回的 `resultJson.segmentIndex`/`totalTasks` 推導),由 `client/src/components/SegmentProgressLabel.tsx:29-34` 以「SSE 優先、resultJson 後備」的順序組合——實際 UI 效果與 100% 依賴輪詢時一致,只是 SSE 這條「即時增強層」形同虛設。

**建議**:此為低風險的效能/架構債(多做了一套永遠打不中的即時管線),非使用者可感知缺陷。若要修,選項:(a) `segment_started` 改成非同步延後(如排入下一個 tick 或等待 `notifyJobStarted` 確認訂閱已建立)才 emit;(b) `segment_completed` 提前到 `complete` emit 之前送出。優先度低,可與其他 SSE 整併(`UNIFIED_SSE_ROUTER`)一併處理。

---

## 2. 已驗證接得對的接縫(negative results)

1. **SSE channel/topic 對得上**:client 端無論走 legacy(`/api/generation-events/:jobId`,`client/src/contexts/BackgroundTasksContext.tsx:419-420`)或 unified(`/api/sse?jobId=`,同檔 :418-419),最終都訂閱 `generationBus` 上的 `job:${jobId}` channel(`server/generationEvents.ts:138-153`;legacy 路由訂閱見 `server/sseRoute.ts:161-163`;unified 路由經 `server/services/sseRouter.ts:42-55` 轉發同一 channel)。三個真實 webhook(`webhookFal.ts`/`webhookSuno.ts`)與 `generate.ts`/`director.ts` 的伺服器端狀態變更全部 emit 到同一個 `generationBus.emit(jobId, ...)`——**topic 命名與訂閱端完全一致,沒有走錯 channel 的情形**。

2. **退款狀態契約(對有 `costPoints` 的任務而言)完全對得上**:`server/routers/credits.ts:95-101`(`jobRefundStatus` procedure)回傳 `{taskId, chargedPoints, refundedPoints, refundStatus}`,與 client `client/src/components/RefundStatusBadge.tsx:30-48`(`useJobRefundStatuses`)、`client/src/components/refundStatus.ts:18-23`(`JobRefundInfo` 型別)欄位名稱、型別逐一對齊,`refundStatus` 列舉值(`none|not_refunded|partial|full|unknown`)兩端一致。對 `submitMultimodalAsync`(`generate.ts:1906` 寫入 `costPoints`)、director(`director.ts:3027`)、Suno 音樂(`proStudio.generateMusicSuno`)這些**有寫入 `costPoints`** 的路徑,退款徽章鏈路(webhook 失敗 → `refundJobIfBilled` → `refunded`/`refundedPoints` 旗標 → `deriveJobRefundStatus` → UI 徽章)完整可用——問題只在 F2 所述、`submitStudioJob` 不寫 `costPoints` 那一條分支。

3. **`background_jobs.status` enum 與 client 型別完全一致**:`drizzle/schema.ts:301-309` 的 `["queued","processing","completed","failed","cancelled"]` 與 `client/src/contexts/BackgroundTasksContext.tsx:139` 的 `BackgroundTask.status` 聯合型別逐字對應,`STATUS_CONFIG`(`BackgroundTasksDrawer.tsx:64-93`)五個 key 全覆蓋,無漏接狀態值。

4. **`UNIFIED_SSE_ROUTER` 旗標兩端預設一致,無 SSOT 漂移**:server `server/_core/index.ts:641-644`(`process.env.UNIFIED_SSE_ROUTER === "1"` 才掛載 `/api/sse`)與 client `client/src/config/featureFlags.ts:165`(`readFlag("VITE_UNIFIED_SSE_ROUTER", false)`)預設都是 OFF——兩端關閉狀態同步,不會出現「client 以為走新路由但 server 沒掛」的斷線。這點與已知 SSOT-1(`appRegistry.supportedActions`↔`hasCapabilityForPage`)脫鉤是不同性質,此處未發現對應問題。

5. **`updateBackgroundJob`(本追蹤鏈實際的「job 回填」函式)並未凍結,與 Y3 的 `updateJob` 是兩個不相關的端點**:Y3(`docs/research/Y0-frontend-carpet-scan-synthesis.md:87`)所述「`updateJob` 全 repo 零呼叫」,指的是 `server/routers/worldStoryboard.ts:314-349` 的 `updateJob` procedure(VideoStudio 佇列面板專用,獨立於 `background_jobs` 表)。本追蹤鏈的 `db.updateBackgroundJob`(`server/db.ts:2141`)則持續被三個真實 webhook(`webhookFal.ts` 4 處、`webhookSuno.ts` 4 處)、`generate.ts` 的 `checkStudioJob` 輪詢(3 處)、`staleJobChecker.ts`、`loraTrainer.ts`(9 處)、`teachingArchiveIngestionWorker.ts`(6 處)呼叫——回填鏈本身是活的,沒有被凍結。特此澄清避免未來稽核把兩個同名概念的端點混為一談。

---

## 3. 附錄:本次追蹤到的檔案/行號清單

| 檔案 | 角色 |
|---|---|
| `client/src/contexts/BackgroundTasksContext.tsx` | 前端 context:輪詢(`activeJobs`/`checkStudioJob`) + SSE 雙軌訂閱 + 提交(`submitStudioJob`) |
| `client/src/contexts/segmentProgress.ts` | 分段進度純函式 reducer + polling fallback |
| `client/src/components/BackgroundTasksDrawer.tsx` | 孤兒元件(F1) |
| `client/src/components/AppleDock.tsx` | 舊 chrome 獨立重寫的背景任務 flyout |
| `client/src/components/SSEFallbackBanner.tsx` | 降級提示(F4) |
| `client/src/components/RefundStatusBadge.tsx` / `refundStatus.ts` | 退款徽章 UI + 純顯示邏輯 |
| `server/generationEvents.ts` | `generationBus`(EventEmitter 單例),`job:${jobId}` channel |
| `server/sseRoute.ts` | legacy `/api/generation-events/:jobId`、`/api/model-training-events/:modelId` |
| `server/unifiedSseRoute.ts` + `server/services/sseRouter.ts` | unified `/api/sse`(旗標門控,預設 OFF) |
| `server/routes/webhookFal.ts` | fal.ai webhook(影像/影片/3D/音訊)——本鏈實際回填來源 |
| `server/routes/webhookSuno.ts` | Suno 音樂 webhook |
| `server/routes/webhooks.ts` | ORB 代理 webhook(與本鏈無關,見 §0) |
| `server/routers/generate.ts` | `submitStudioJob`/`checkStudioJob`/`activeJobs` |
| `server/routers/director.ts` | `executeGenerationTask`(segment_started 發送點) |
| `server/routers/models.ts` / `server/services/teachingArchiveIngest.ts` | 非 studio 型 `background_jobs`(F3) |
| `server/services/postGenActions.ts` | `refundJobIfBilled` |
| `server/services/refundStatus.ts` | `deriveJobRefundStatus`/`getJobRefundStatuses` |
| `server/routers/credits.ts` | `jobRefundStatus` procedure |
| `drizzle/schema.ts` | `backgroundJobs` table 定義 |
