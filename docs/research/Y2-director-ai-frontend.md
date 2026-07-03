# Y2 — DirectorAI.tsx CO-STAR 導演前端深挖
- 產生日期:2026-07-03
- 依據 commit:812f6fdb(`git diff 812f6fdb HEAD -- client/src/pages/DirectorAI.tsx` 無差異,本檔內容與該 commit 起完全一致,可安全引用)
- 稽核檔案:client/src/pages/DirectorAI.tsx(6606 行,鎖定北極星流程/契約/安全,不必逐行)
- 交叉核對:server/routers/director.ts(3629 行)、server/routers/worldStoryboard.ts、client/src/components/director/{constants.ts,utils.ts,WorkflowStepper.tsx,BatchGenerationDialog.tsx,WorldbuildingPanel.tsx}、client/src/contexts/WorldContextContext.tsx、client/src/hooks/useActiveProject.ts、client/src/components/project/ProjectContextStrip.tsx、client/src/pages/VideoStudio.tsx、drizzle/schema.ts(`project_notes_calendar`)、shared/types.ts(`ScriptSegment`)
- 前置依據(不重複其結論,僅標注延伸/限縮關係):`docs/research/W1-director-router-deepdive.md`(server/routers/director.ts 逐行深挖,已確認批次生成鏈扣點/估價/輪詢/退款一段寫得嚴謹、`askForStudioPlan` 繞過安全閘、`batchGenerateWithSession` 的 jobsJson 讀-改-寫競態等發現)

---

## 本次範圍與 W1 的關係

W1 已逐行讀完 `server/routers/director.ts` 本體,本次改從 **client 端 DirectorAI.tsx 實際怎麼呼叫這些端點** 出發,交叉核對每個呼叫的參數是否真的觸發了 W1 記載的伺服器行為、以及北極星「腳本→分鏡→逐幕→…→打包」在這個頁面上的實況串接。核心結論:**W1 對批次生成鏈(`autoGenerateFromSegments`→N×`executeGenerationTask`→`pollGenerationTask`)「契約嚴謹」的結論在 client 端呼叫上同樣成立**(見下方「已驗證排除的疑慮」);但本次從 client 角度發現了 W1 未觸及的一整組問題——**DirectorAI 的資料操作完全沒有「單一創作專案」範疇化**(與北極星「創作者在單一專案裡走完整流程」直接衝突),以及**批次生成 UI 的一條龍導覽(WorkflowStepper)、逐鏡確認狀態(status)、成本預覽三處都是裝飾性/不精確,而非真正的流程閘門**。此外對 W1 發現 #3(`batchGenerateWithSession` 併發競態)提供了範圍限縮的新證據:目前 DirectorAI.tsx 唯一的呼叫點根本不會觸發該競態路徑。

---

## 發現清單(依嚴重度排序)

### 1.【嚴重・northstar-flow】DirectorAI 的核心資料操作完全沒有「創作專案」範疇化——與北極星「創作者在單一專案裡走完整流程」的本質直接衝突

**發現**:
- `client/src/pages/DirectorAI.tsx:2385` 取得 `worldCtx = useWorldContext()`,但全檔案只用其 `worldCtx.worldFrameworkId`(:2843,2868,4076,4104,5163),**從未讀取 `worldCtx.currentProjectId`**(即 `useActiveProject()` 的 `activeProjectId`,見 `client/src/hooks/useActiveProject.ts:18`)。
- `client/src/contexts/WorldContextContext.tsx:141`:`worldFrameworkId` 是「從 `currentProjectId` 對應的 project 查出來的衍生值」(`projectQuery.data?.worldFrameworkId`),但 DirectorAI 允許使用者在「世界觀」分頁**手動選一個 `worldbuildingSelectedId`**(與 `currentProjectId` 完全無關的獨立 state,`useState` 宣告,未在本檔標出行號但由 `setWorldbuildingSelectedId` 管理),優先序寫在 `overrideWorldId ?? worldbuildingSelectedId ?? worldCtx.worldFrameworkId`(:2843,4076)——**即使沒有綁定任何創作專案,只要手動選了世界觀,建立分鏡板/送入影片佇列一樣能執行**。
- 對照 `client/src/components/project/ProjectContextStrip.tsx:26-41`——`activeProjectId === null` 時整條 strip 只顯示淡提示:「**尚未綁定創作專案,這支影片的腳本、素材與意圖不會被保存。**」`<ProjectContextStrip />` 確實掛在 DirectorAI 頁面上(`DirectorAI.tsx:4460`),但這條警語只是顯示,沒有任何後續程式碼把它變成阻擋——使用者可以無視它,繼續完整跑完腳本→CO-STAR→分鏡→送影片佇列全程。
- `chatMutation.mutate({...})`(:3406-3412)呼叫 `trpc.director.chat` 時只送 `messages / saveToNotes / personality`,**沒有送 `projectId`**——即使 server 端 `chat` procedure 明確支援(`server/routers/director.ts:235-241`,AIDV-152:「可選的當前 active project id…只有『有傳 projectId』且『旗標開啟』時,才會 best-effort 載入該專案的世界框架摘要並注入 system prompt」)。對照 `client/src/adapters/commander.trpc.ts:34-40`(光球指揮官轉呼叫同一 `director.chat`)**有**帶 `projectId: input.projectId ?? undefined`——同一顆 server 端點,DirectorAI 頁面自己的主聊天介面反而沒有接上這條「讀單一專案上下文」的路徑,光球側的轉呼叫倒是接了。(註:`ENABLE_DIRECTOR_WORLD_CONTEXT` 旗標預設 OFF——`server/routers/director.ts:140-155`——所以目前這個落差在生產環境下零行為差異;但只要旗標開啟,DirectorAI 頁面本身的聊天永遠讀不到世界觀脈絡,除非之後補上這行參數。)
- **結構性、非旗標可解**:`saveSession`(:380-433)/`listSessions`(:429-434)/`savePlanningSession`(:1907-1928)/`listPlanningSessions`(:1931-1943)四個「儲存/讀取腳本與規劃 session」的端點,**輸入輸出 schema 全部沒有 `projectId` 欄位**。往下查底層資料表 `drizzle/schema.ts:487-536`(`project_notes_calendar`):欄位只有 `id/userId/title/content/scriptJson/noteType/status/…/tags/category`,**完全沒有任何 `projectId`/`creativeProjectId` 外鍵欄位**。`listSessions` 內部查詢是 `db.getDirectorSessionsByUser(ctx.user.id)`(:430)——按 `userId` 全域查詢,不分專案。
- **結論**:即使使用者在 `/create` 綁定了創作專案、`ProjectContextStrip` 顯示著專案名稱,DirectorAI 頁面存/讀的每一份腳本分析 session、每一份長腳本規劃 session,實際上都是**全域**(跨所有專案混在一起的單一列表),沒有任何機制把它們跟「目前作用中的專案」關聯或過濾。這與北極星「創作者在單一專案裡走腳本→分鏡→逐幕…全程逐步引導」的核心假設(每個 project 有自己獨立、乾淨的創作歷程)在資料層面就不成立——多專案使用者會在「載入既有 session」清單裡看到所有專案的 session 混雜在一起,無從分辨。

**影響**:這是本檔案裡與北極星本質衝突最直接、證據鏈最完整的一條——不是某個按鈕沒接好,而是整個「腳本/規劃 session」持久化層在資料庫層級就缺了「這屬於哪個專案」這個欄位。ProjectContextStrip 存在的目的(組件註解自陳:「**永遠讓使用者知道自己在哪個 project**」)在 DirectorAI 頁面上只做到「顯示」,完全沒有做到「範疇化」。

**建議**:
1. 短期:`project_notes_calendar` 加 nullable `projectId` 欄位(向後相容,舊資料 `NULL`),`saveSession`/`savePlanningSession` 選填帶入 `worldCtx.currentProjectId`,`listSessions`/`listPlanningSessions` 支援依 `projectId` 篩選(未綁定專案時維持現有全域列表行為,不破壞既有使用者)。
2. `chatMutation.mutate` 補上 `projectId: worldCtx.currentProjectId ?? undefined`,即使旗標現在預設關閉,至少讓「旗標開啟後」這個路徑本來就是通的,不用等到那天才發現 DirectorAI 主頁忘了接線。

---

### 2.【高・northstar-flow / dead-ui】「建立分鏡板」與「送入影片佇列」是兩條互不關聯的獨立管線,每次呼叫都各自建立全新 `world_storyboards` 記錄,同一腳本可產生多份互不相干的分鏡板

**發現**:
- `client/src/pages/DirectorAI.tsx:2853-2862`(`handleCreateStoryboardFromScript` → `createStoryboardMut` = `trpc.worldStoryboard.createFromSegments`):送出 `{ worldId, name, segments: [{ rawText, storyboard, characters, locations }] }`——**不含任何 CO-STAR 欄位**(無 `visualPrompt`/`musicVibe`/`audioScript`)。
- `client/src/pages/DirectorAI.tsx:4086-4098`(`handleQueueForVideo` → `queueForVideoMut` = `trpc.worldStoryboard.queueForVideo`):送出 `{ worldId, name, segments: [{ segmentId, storyboard, characters, locations, visualPrompt, musicVibe, audioScript }] }`——**含 CO-STAR 欄位**,且只挑 `s.costar` 存在的段落(:4065)。
- `server/routers/worldStoryboard.ts:486-499`(`createFromSegments`)與 `:600-613`(`queueForVideo`)**各自獨立呼叫 `db.createWorldStoryboard({...})`**——兩個端點之間沒有任何「若已有分鏡板則更新」的查詢或 upsert 邏輯,每次呼叫都是 `INSERT` 出一筆新 `id`。
- 兩個按鈕(「建立分鏡板」:5153-5174,「送入影片佇列」:5175-5196)並排出現在同一個「script」分頁的工具列上,UI 上沒有任何互斥/提示告知使用者這是兩條平行、不會互相同步的資料流。

**影響**:使用者若先點「建立分鏡板」(產生分鏡板 A,導去 `/animation/A` 做動畫細修),之後回到 DirectorAI 再批次生成 CO-STAR、點「送入影片佇列」(產生**另一個**分鏡板 B,導去 `/video-studio?queue=B`),A、B 是資料庫裡兩筆完全獨立、互不引用的 `world_storyboards` 記錄,對同一份腳本內容產生了兩份不同步的下游產物。若使用者又重新批次生成一次 CO-STAR 再送一次佇列,會再產生分鏡板 C……以此類推。這與北極星「單一專案裡的一條龍」直接衝突——沒有「這是同一部作品的迭代」的概念,每次「進到下一步」在資料層面都是另起爐灶。

**建議**:至少讓「送入影片佇列」在偵測到同一 `worldId`(或搭配發現 #1 修好後的 `projectId`)已有 `in_progress`/`planning` 的分鏡板時,提示「是否要更新既有分鏡板 XXX,還是建立新的?」,而非無聲建立新記錄。

---

### 3.【高・contract-mismatch / dead-ui,延伸並限縮 W1 發現 #3】`batchGenerateWithSession`(AIDV-50,「session tracking」)的唯一呼叫端從未傳入 `storyboardId`,其存在理由完全不會被觸發——連帶讓 W1 記載的併發競態在目前 UI 上不可達

**發現**:
- `client/src/pages/DirectorAI.tsx:2907`(`batchCostarMut = trpc.director.batchGenerateWithSession.useMutation`)的程式碼註解寫「AIDV-50: uses batchGenerateWithSession for session tracking」,但實際呼叫處 `:4051-4060`(`handleBatchCostar`)送出的物件只有 `{ segments: [...], personality }`——**全檔案 grep `storyboardId` 零命中**(已對整份 6606 行檔案確認)。
- `server/routers/director.ts:1199`(`batchGenerateWithSession` 的 input schema)`storyboardId: z.number().int().positive().optional()`——正是這個「session tracking」的價值所在(:1206-1240,依 `storyboardId` 讀寫 `world_storyboards.jobsJson`/`productionStatus`,W1 發現 #3 記載的併發競態就發生在這段)。當 `storyboardId === undefined` 時,整段 `if (storyboardId !== undefined) {...}` 區塊(:1207-1240)完全跳過——這個端點對目前 DirectorAI 的呼叫方式而言,**行為上與純 LLM 生成無異,沒有寫入/讀取任何 `world_storyboards` 資料**。
- 交叉檢查另一個更早、功能幾乎相同的端點 `batchGenerateCostar`(`director.ts:809`,無 session tracking):全 client 程式碼庫(`grep -rn "batchGenerateCostar" client/src/`)**零呼叫**——是徹底的死伺服器端點。

**影響**:
1. 使用者透過 DirectorAI「批次 CO-STAR」按鈕觸發的生成,**從未**讓對應的分鏡板(若日後透過發現 #2 修好、真的有一個持續存在的分鏡板)得知任何進度——`productionStatus` 不會被推進到 `in_progress`,`jobsJson` 不會被寫入逐段狀態。這個端點的「比 `batchGenerateCostar` 更可靠地追蹤每段進度」的設計動機(W1 原文引用),對目前唯一的呼叫端而言是完全落空的承諾。
2. **對 W1 發現 #3 的限縮**:W1 記載的「讀-改-寫 `jobsJson` 全程無鎖,雙擊會互相覆蓋」的競態,只有在 `storyboardId` 有值、且短時間內對**同一個** `storyboardId` 發出兩次呼叫時才會觸發。由於 DirectorAI.tsx 目前完全不傳這個參數,**這條競態路徑在本頁面現行 UI 上不可達**——不是說 W1 的發現有誤(它是純伺服器端邏輯分析,結論本身成立),而是從 client 呼叫的實際覆蓋範圍看,目前沒有任何使用者可以透過 DirectorAI 的 UI 觸發它。這個限定條件值得記錄,避免後續文件誤以為這個競態是使用者當下可踩到的路。

**建議**:要嘛把 `handleBatchCostar` 接上 `storyboardId`(讓 session tracking 真正生效,同時記得補上 W1 建議的鎖),要嘛把兩個幾乎重複的 procedure(`batchGenerateCostar` / `batchGenerateWithSession`)合併,移除死碼分支。

---

### 4.【中・uiux-defect / northstar-flow】WorkflowStepper「一條龍流程」5 步驟裡,「分鏡」與「生成」都導到同一個 tab,但真正的批次生成入口不在那個 tab 裡——是導覽死路

**發現**:
- `client/src/components/director/WorkflowStepper.tsx:32-43`(`STEPS` 陣列):5 步驟為 `chat/script/worldbuilding/storyboard/generation`,其中 `storyboard` 與 `generation` 的 `tabId` **都是 `"worldbuilding"`**(:41-42)。
- `client/src/pages/DirectorAI.tsx:4876-4915` 只定義了 4 個 `TabsTrigger`:`chat / script / planning / worldbuilding`——**沒有獨立的 storyboard 或 generation tab**。
- 真正的「批次生成」按鈕(:5143-5152)、「建立分鏡板」按鈕(:5153-5174)、「送入影片佇列」按鈕(:5175-5196)全部渲染在 `<TabsContent value="script">`(:5047 起)之內。
- `<TabsContent value="worldbuilding">`(:6335-6355)只渲染 `<WorldbuildingPanel onCreateStoryboard={...} />`,而 `WorldbuildingPanel.tsx:434-446` 內唯一相關的按鈕是「生成分鏡」(用 `Sparkles` icon,與 WorkflowStepper「生成」步驟同一個 icon),點下去呼叫的其實是 `onCreateStoryboard()`(即 `handleCreateStoryboardFromScript`,建立分鏡板)——**跟批次多模態生成(image/video/audio/voice)完全是兩回事**,worldbuilding tab 內**沒有任何**觸發 `autoGenerateMut`/`executeTaskMut` 的入口。

**影響**:使用者若照著頁面頂部「一條龍流程」指示條的順序點「分鏡」或「生成」步驟,會被切到 worldbuilding 分頁,但那裡並沒有本頁面實際的批次多模態生成功能(那功能只存在於 script 分頁的工具列)。「生成」步驟形同一個名不符實的死路——名字叫「生成」,點了卻只到達一個「生成分鏡」(其實是建分鏡板)按鈕,和真正「批次生成」是不同功能、不同端點。這正是本頁面自己標榜的「一條龍流程」導覽條本身內部不一致。

**建議**:「生成」步驟的 `tabId` 改成 `"script"`(批次生成按鈕實際所在位置),或在 worldbuilding tab 內也放一個能直接開啟 `BatchGenerationDialog` 的入口。

---

### 5.【中・uiux-defect】segment 的「已確認」(approved)狀態全檔案只用來算統計徽章,從不作為任何操作的前置閘門;且會被 AI 討論結果靜默覆寫回「已優化」

**發現**:
- `shared/types.ts:159`:`ScriptSegment.status: "pending" | "draft" | "refined" | "approved"`。
- 全檔案 grep `.status ===`/`status !==`(共 27 處命中)逐一核對:唯一讀取 `"approved"` 的地方是 `client/src/pages/DirectorAI.tsx:4183-4185`(`scriptStats.approved` 統計)與 `:5087`(顯示徽章「{scriptStats.approved} 已確認」)。
- 真正決定是否可以送出付費/批次操作的三個入口——`handleBatchCostar`(:4045-4060)、`handleQueueForVideo`(:4063-4108,只檢查 `s.costar` 是否存在,:4065)、`handleStartBatchGeneration`(:4110-4128,對 `importedSegments` 全量送出,不篩選 `status`)——**沒有一處檢查 `segment.status`**。也就是說,一個仍是「草稿」(draft)狀態、從未被使用者按過「已確認」的分鏡,一樣可以被送去跑真實付費生成、一樣可以被送入影片佇列。
- `client/src/pages/DirectorAI.tsx:382-387`(`discussMut` 的 `onSuccess`):`status: data.updatedStoryboard ? "refined" : segment.status`——只要這次 AI 討論回傳了 `updatedStoryboard`(哪怕使用者只是問了個小問題、AI 順手微調了分鏡描述),該分鏡的 `status` 就會被**無條件**改成 `"refined"`,即使呼叫前它是使用者手動點過的 `"approved"`。整個流程**沒有任何 toast 或提示**告知使用者「這一鏡的確認狀態被重置了」。

**影響**:「已確認」這個狀態標籤給使用者的心理暗示是「這一鏡已經定案、可以放心往下走」,但實際上(a)它從未被用來擋任何操作,(b)還可能被使用者自己接下來的一次提問操作在背後靜默清掉。對照北極星要求「AI 讀單一專案上下文全程逐步引導、不跑偏」——一個承諾了「確認」語意卻毫無約束力、還會被自己的機制悄悄撤銷的狀態欄位,是體驗上具體可指出的缺陷(狀態遺失且無回饋)。

**建議**:
1. 若「已確認」的設計意圖只是給創作者自己看的軟性標記,至少在 `discussMut.onSuccess` 覆寫 `status` 時發一則 toast(例如「AI 更新了分鏡內容,確認狀態已重置為『已優化』,請重新確認」)。
2. 若意圖是要作為批次生成/送佇列前的把關,則應在 `handleStartBatchGeneration`/`handleQueueForVideo` 加入「尚有 N 個分鏡未確認,是否仍要繼續?」的提示。

---

### 6.【中・contract-mismatch】批次生成對話框的「積分不足」預警用「分鏡數 × 模態數」天真估算,與伺服器實際依模型精算的點數脫鉤;已存在的精準估價端點未被使用

**發現**:
- `client/src/components/director/BatchGenerationDialog.tsx:55-58`:
  ```
  const totalTasks = totalSegments * options.modalities.length;
  const insufficientCredits =
    remainingPoints != null && totalTasks > 0 && remainingPoints < totalTasks;
  ```
  這個估算假設「每個(分鏡 × 模態)任務固定花費 1 點」。
- 對照伺服器實際邏輯 `server/routers/director.ts:2196-2373`(`autoGenerateFromSegments` 內為每個 modality 各自呼叫 `estimatePoints(modelId, {...})`,依模型、時長(`durationSec`)、字數(`charCount`)精算),`totalPoints`(:2378-2381)是這些精算值加總——**不是** `totalTasks × 1`。舉例:image 與 video 用不同模型、video 依秒數計費,兩者點數差距可以是數倍到數十倍(視 `modelPricing.ts` 費率表,本次未逐行核對其具體倍率,但函式簽章與呼叫參數確認「非常數」)。
- `server/routers/director.ts:1695`(`estimateSegmentCost`)是專門設計來做「不觸發生成、只回傳精準逐模態估價」的唯讀端點(對照 `client/src/components/design-kit/GateCard.tsx:1-5` 註解「媒體生成前先估成本…估成本走 director.estimateSegmentCost」、`client/src/shells/video/drawers/AgentCatalog.tsx:6,43`「唯讀、不觸發生成、不扣點,落實『成本常駐』UI 原則」)。**全 client 程式碼庫檢索,`estimateSegmentCost` 唯一呼叫端是 `client/src/shells/video/drawers/AgentCatalog.tsx:43`(屬於新版 `/video` shell 座艙,非本檔案)**——DirectorAI.tsx 完全沒有呼叫這個端點。
- `BatchGenerationDialog` 的「開始批次生成」按鈕(:273-295)靠這個天真估算的 `insufficientCredits` 決定是否 `disabled`(:276)——真正的餘額檢查仍然正確地在伺服器端執行(`autoGenerateFromSegments`,:2384-2401,`FORBIDDEN` 拋錯;`executeGenerationTask` 每個任務也各自扣點檢查,:2837-2848)**不是安全繞過**,只是使用者在點擊前看到的「積分是否足夠」提示可能與伺服器實際判斷不一致(低估或高估皆有可能,取決於選取的模態組合)。

**影響**:純 UX 層面——使用者可能被天真估算誤導,以為積分足夠而點下「開始批次生成」,結果伺服器判定不足而整批規劃被拒(`toast.error("規劃失敗：" + e.message)`,:3091);或反過來被天真估算誤判為不足而根本按不下按鈕,即使實際成本遠低於門檻。因為北極星明確要求「快速素材管理+目標管理」,成本預覽的精準度屬於這個範疇的直接體驗。

**建議**:把 `remainingPoints < totalTasks` 換成呼叫 `director.estimateSegmentCost`(或等價的前端試算,依模態別配置各自預設模型的費率),而非用任務數當點數的替代品。

---

### 7.【低・other,伺服器端死碼,順帶記錄】`fetchTrendingInspiration`、`perplexityThrottleStatus`(director router)在全 client 程式碼庫查無呼叫端

**發現**:`server/routers/director.ts:3341`(`fetchTrendingInspiration`)、`:3387`(`perplexityThrottleStatus`)——`grep -rn "fetchTrendingInspiration\|perplexityThrottleStatus" client/src/` 零命中。`askForStudioPlan`(:3211,W1 發現 #1 記載的安全繞過端點)則確認**不是**由 DirectorAI.tsx 呼叫(唯一呼叫端是 `client/src/pages/Studio.tsx:1341`)——這點與 W1 文件一致,本次予以確認排除:**DirectorAI.tsx 本身的批次生成流程不會觸發 W1 發現 #1 的安全繞過**(但透過光球工具橋接是否可達,W1 已記載為缺讀項,本次未重新查證)。

**影響**:輕微——這兩個是與本檔北極星流程無直接關係的邊角端點(灑落內容 discovery/節流狀態查詢),列出是因為深挖 director router 呼叫面時一併發現,供後續清理死碼參考。

---

## 已驗證排除的疑慮(negative results)

1. **批次生成核心鏈契約完全吻合,非零扣點漏洞**:`autoGenerateFromSegments`(規劃,:2023-2425)→`executeTaskMut`/`executeGenerationTask`(執行+扣點,:3138-3169 client / :2750-3089 server)→`pollGenerationTask`(輪詢,:1594-1629 client / :3104-3417 server)三段的欄位命名、回傳形狀(`jobId/requestId/segmentId/segmentIndex/modality/label`、`status: COMPLETED/FAILED/IN_PROGRESS`、`resultUrl/progress/errorMessage`)逐一核對,client 端讀取與 server 端回傳完全一致,不存在 contract-mismatch。與 W1 對此段「是本檔目前寫得最嚴謹的一段」的結論一致,本次從 client 呼叫角度複核同意。
2. **worldStoryboard.createFromSegments / queueForVideo 皆為真實存在的端點**(server/routers/worldStoryboard.ts:402,506),非幽靈呼叫;client 端呼叫的欄位(`worldId/name/segments[...]`)與 server 端 zod schema(:404-429,507-537)一致。
3. **queueForVideo → /video-studio?queue=:id 的導覽確實有消費端接住**:`client/src/pages/DirectorAI.tsx:2812-2828`(`queueForVideoMut.onSuccess` 呼叫 `navigate(\`/video-studio?queue=${data.id}\`)`)與 `client/src/pages/VideoStudio.tsx:4401-4421`(`useSearch()` 解析 `queue` 參數、`trpc.worldStoryboard.get.useQuery({id: queueStoryboardId})`)兩端確實接上,不是斷點。路由 `/video-studio`、`/animation/:storyboardId` 皆存在於 `client/src/App.tsx:273,342`。
4. **`discussSegment.imageUrl` 未過 `safeMediaUrl` 白名單驗證(W1 發現 #4)在 DirectorAI.tsx 本身的 UI 上沒有可觸及的填入介面**:全檔案 grep `imageUrl` 零命中——本頁面的分鏡討論輸入框(`inputMessage`)只送文字,沒有任何圖片網址輸入/上傳控制項餵進 `discussMut.mutate` 的 `segment`(:410-430,461-476)。理論上仍可能經由「載入已存 session」(`loadSession`,session JSON 未過 schema 驗證直接信任)帶入被竄改過的 `discussion[].imageUrl`,但這需要繞過 UI 直接構造/編輯 sessionData,不是本頁面正常操作路徑能觸及的注入面——予以記錄為「風險已存在但本檔案 UI 未提供直接觸發手段」,與 W1 的「供應商端請求、非本站 SSRF」風險定性一致,不重複列為獨立發現。
5. **`status` 欄位裡的 `"pending"` 未出現在三個切換按鈕(draft/refined/approved,:594)中,經查非漏洞**:所有 server 端建構新 segment 的分支(`director.ts:531,624,752,761`)固定賦值 `status: "draft"`,`"pending"` 在正常流程中不會被指派,UI 排除它是合理設計而非缺陷。
6. **`FEATURE_EXPORT_CHAIN` 旗標(:130,1691,1753,1775,1837)只控制「下載素材」連結的顯示與否,不是安全邊界**:被隱藏/顯示的內容都是已完成任務的 `resultUrl`(使用者自己的生成結果),旗標關閉只是不顯示下載連結,底層資料本身沒有额外保護意義,不構成 client-security 問題。

---

## 未讀完 / 缺讀聲明
- `client/src/components/director/WorldbuildingInlineEditor.tsx`(697 行)、`WorldbuildingPanel.tsx`(733 行)僅針對 `onCreateStoryboard` 相關段落讀取,未逐行通讀全檔。
- `server/services/modelPricing.ts`(`estimatePoints` 本體)未逐行核對其費率表,僅信任其函式簽章(依 modelId/durationSec/charCount 變動)與呼叫端用法一致的假設——發現 #6 的「差距可達數倍到數十倍」為合理推估,非逐行驗證的精確倍率。
- `client/src/shells/video/`(ConfirmGate.tsx/AgentCatalog.tsx 等新版 `/video` 座艙殼層)只為交叉核對 `estimateSegmentCost`/`GateCard` 的真實呼叫端而查閱局部,未通讀,亦不在本次任務範圍內(該殼層與本檔案 DirectorAI.tsx 是否為同一使用者旅程的新舊兩版,未在本檔驗證)。
- `agentToolExecutor.ts` 的 `dispatchDirectorTool` 橋接函式(W1 已列為缺讀項)本次同樣未讀,「光球對話是否也能觸發本檔案分析的任一端點」未重新查證。
