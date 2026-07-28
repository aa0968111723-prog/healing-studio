# Y1 — Studio.tsx + ProjectFlowGuide 北極星五步引導前端實況

- 產生日期:2026-07-03
- 依據 commit:812f6fdb(任務指定基準;經核對 `git diff 812f6fdb HEAD -- <本次三檔>` 無差異,現行 HEAD `47917e3a` 內容相同,故以 HEAD 實測)
- 稽核檔案:client/src/pages/Studio.tsx、client/src/components/ProjectFlowGuide.tsx(**不存在,見發現 #1**)、client/src/components/PlanningSubpageGuide.tsx(存在,已核對)
- 交叉核對:client/src/shells/video/console/ProjectFlowGuide.tsx、StorySpineColumn.tsx、CreationFlowBar.tsx、WorldLinkPicker.tsx、client/src/config/videoFlags.ts、client/src/config/featureFlags.ts、client/src/contexts/PersonalSettingsContext.tsx、client/src/contexts/PageAgentContext.tsx、shared/agent-actions.ts、client/src/spine/ProjectSpineProvider.tsx、client/src/spine/projectGateway.ts、client/src/lib/send-to-studio.ts、client/src/pages/DirectorAI.tsx、server/routers/generate.ts、server/routers/studio.ts、server/routers/creativeProject.ts、server/routers/worldbuilding.ts、.env.production、dev-environment/.env.dev.example
- 前置依據(不重複其結論,僅延伸):`docs/research/W1-director-router-deepdive.md`(askForStudioPlan 繞過安全閘、`submit` action 唯一攔阻是預設關閉的 `confirmBeforeGenerate`)

---

## 本次範圍與任務假設的落差(先講清楚,避免後續發現被誤讀)

任務指定要深挖 `client/src/components/ProjectFlowGuide.tsx`,**此路徑不存在**。全站唯一名為 `ProjectFlowGuide` 的元件在 `client/src/shells/video/console/ProjectFlowGuide.tsx`(204 行),掛載於 `/video` 座艙(DirectorConsole → StorySpineColumn),**與 `client/src/pages/Studio.tsx`(路由 `/studio`,重導至 `/video/studio`)完全是兩個獨立頁面、兩套資料模型**:

- `Studio.tsx`:本地 `useState` 管理的四模態(image/video/audio/voice)生成工作區,呼叫 `trpc.generate.submitMultimodalAsync`。全文 grep `ProjectFlowGuide|ENABLE_PROJECT_HUB|videoFlags|ENABLE_4SHELL|StorySpineColumn|DirectorConsole` **零命中**(已執行驗證)。
- `ProjectFlowGuide.tsx`(shells/video/console):消費 `useProjectSpine()` 脊椎專案物件,推導「世界觀→劇本→分鏡→生成→成片」五步狀態,是北極星五步引導**唯一**的實作。

`PlanningSubpageGuide.tsx` 則與五步引導完全無關,是 `/notes`、`/calendar` 兩個規劃頁的靜態提示卡(見「已驗證排除的疑慮」)。

以下發現依嚴重度排序,標明是 Studio.tsx 本身的問題、還是 ProjectFlowGuide(五步引導)的問題。

---

## 發現清單

### 1.【嚴重・northstar-flow】北極星「五步引導」與「創作工作室」(Studio.tsx)是兩條互不相通的前端路徑

**證據**:
- `client/src/pages/Studio.tsx` 全文(3999 行)不 import、不引用 `ProjectFlowGuide`、`ENABLE_PROJECT_HUB`、`videoFlags.ts`、`DirectorConsole`、`StorySpineColumn` 中任何一個(Grep 驗證,零命中)。
- 反之 `client/src/shells/video/console/ProjectFlowGuide.tsx:1-18` 註解自陳:「把『創作專案』做成影片工作流的主入口……五步脊椎＝世界觀→劇本→分鏡→生成→成片」,消費的是 `useProjectSpine()`(`client/src/spine/ProjectSpineProvider.tsx`)這一套獨立於 Studio.tsx 的專案脊椎狀態,不是 Studio.tsx 的 `promptByModality`/`imageState`/`videoState` 等本地狀態。
- 路由層面也是兩個頁面:`client/src/shells/shellRouteTable.ts:94`(`{ from: "/studio", to: "/video/studio" }`,由 `ShellPage` re-home 舊 `Studio.tsx`)vs `VideoCockpitFrame.tsx:25,40-44`(`/video`、`/video/director`、`/video/cockpit` 三條路徑渲染 `VideoCockpit`→`DirectorConsole`→`StorySpineColumn`→`ProjectFlowGuide`)。

**影響**:如果把「M2:五步引導已經在創作工作室(Studio.tsx)串起來,只是被旗標鎖住」當作已知事實去規劃後續工作,是誤判——**應該說的是「五步引導只存在於 /video 座艙,創作工作室(Studio.tsx,/studio)完全沒有這段程式碼」**。若北極星的目標是「使用者在 Studio.tsx 這個生成工作室頁面裡走完五步」,目前的實作根本不在那裡,不是「有但被鎖」而是「該頁面從未實作過」。

**建議**:向決策者/Bruce 澄清「五步引導」目前的唯一落地點是 `/video` 座艙,而非 `/studio`;若北極星要求兩者合一,需要新規劃,不是解旗標可以解決的。

---

### 2.【嚴重・northstar-flow / dead-ui】ENABLE_PROJECT_HUB 生產環境確認 OFF,五步引導在線上 100% 不渲染;dev 環境卻預設 ON,造成「開發者看得到、使用者看不到」的認知落差

**證據鏈**:
1. `client/src/config/videoFlags.ts:61-67`:`ENABLE_PROJECT_HUB` 定義為 `readFlag("VITE_ENABLE_PROJECT_HUB", false)`——**程式碼預設 OFF**。
2. `client/src/shells/video/console/StorySpineColumn.tsx:64-65`:`{/* I-6 創作流程嚮導(AIDV-84,旗標 ENABLE_PROJECT_HUB 預設 OFF) */} {ENABLE_PROJECT_HUB && <ProjectFlowGuide onGuided={onGuided} />}`——旗標關閉時這個 `<ProjectFlowGuide>` 連掛載都不會發生(不是隱藏,是不渲染)。
3. `.env.production:17-30`(正式環境建置旗標,Vite build-time 注入)**沒有** `VITE_ENABLE_PROJECT_HUB` 這一行(只顯式列出 `VITE_ENABLE_4SHELL=1`、`VITE_SHELL_SOCIAL=1`、`VITE_SHELL_LEARN=1`、`VITE_SHELL_LEARN_RICH=1`、`VITE_SHELL_SETTINGS_RICH=1`、`VITE_ENABLE_VIDEO_COCKPIT=1`),因此正式環境該旗標落回程式碼預設值 `false`。
4. `dev-environment/.env.dev.example:22-29` 卻明確設 `VITE_ENABLE_PROJECT_HUB=1`(與 `VITE_ENABLE_4SHELL=1`、`VITE_ENABLE_VIDEO_COCKPIT=1`、`VITE_ENABLE_VIDEO_GATE_KIT=1`、`VITE_ENABLE_WORLD_STYLE_INJECTION=1` 一起),註解寫「dev 直接全開最貼近線上」——但實際上正是這幾顆旗標讓 dev 看到的畫面**不**等於線上畫面。
5. 對照組(已驗證非死 UI 的旗標):`ENABLE_4SHELL`(`client/src/config/featureFlags.ts:58`,`readFlag("VITE_ENABLE_4SHELL", true)`)與 `ENABLE_VIDEO_COCKPIT`(`videoFlags.ts:45`,預設 `true`)兩者都在 `.env.production` 顯式或依預設值為 ON,所以 `/video` 座艙本身(StorySpineColumn、CreationFlowBar 等)在生產環境是可達的——**問題精確定位在 `ENABLE_PROJECT_HUB` 這一顆內層旗標,不是整個座艙都沒上線**。

**影響**:北極星宣稱的「世界觀→劇本→分鏡→生成→成片」五步引導元件,在目前的正式部署設定下對任何線上使用者都不會渲染,是完全的死 UI;但因為 dev 環境的 `.env.dev.example` 把它打開,開發者/評審在本機測試會誤以為這功能「已經在跑」。

**建議**:若 M2 決定要讓五步引導上線,只需在 `.env.production` 新增 `VITE_ENABLE_PROJECT_HUB=1` 一行即可解鎖(程式碼本身無需改動,元件已存在且有測試覆蓋,見「已驗證排除的疑慮」);若尚未決定上線,應在文件中明確標註「dev 預設 ON 僅供評審預覽,線上未開」,避免對外溝通失真。

---

### 3.【高・northstar-flow / uiux-defect】即使打開旗標,五步引導的最後一步「成片」永遠沒有可執行動作,且與同頁已存在的真實匯出功能(CreationFlowBar)完全脫節,形成兩套互相矛盾的進度列

**證據**:
- `ProjectFlowGuide.tsx:102-109` 定義「成片」步驟:`done: allGenerated`,`detail`/`hint` 皆為純文字描述,**沒有 `canvasMode` 欄位**(對照 `script`/`storyboard`/`generate` 三步都有 `canvasMode`)。
- `ProjectFlowGuide.tsx:119-125`(Phase 2 動作鏈判斷式)只處理 `current?.id === "script"`、`current?.id === "storyboard"`、`(current?.id === "generate" || allDone) && schedulable > 0` 三種情況,**沒有任何分支對應 `film`**,因此即使全部鏡頭都生成完畢(`allDone === true` 且 `schedulable === 0`),畫面上除了文字「🎬 可成片」之外**沒有任何按鈕**。
- 元件自己的模組註解承認這是刻意的唯狀態設計:`ProjectFlowGuide.tsx:12`「世界自動連結與成片匯出＝待後端(Phase 2b),維持唯狀態、不假裝」。
- `ProjectFlowGuide.test.tsx:117-126` 的測試(「世界已連結 + 全部鏡已生成 → 顯示『🎬 可成片』」)只斷言文字出現,**沒有任何測試點擊「成片」相關按鈕**——測試本身也印證這步是純顯示,無行為。
- 但同一 `/video` 頁面頂部、不受 `ENABLE_PROJECT_HUB` 保護、**預設就會渲染**的 `CreationFlowBar.tsx` 已經有一個真正可用的匯出能力:`CreationFlowBar.tsx:188-192`(`allDone && exportableShots.length > 0` 時顯示「匯出素材包」按鈕)+ `CreationFlowBar.tsx:240-336`(對話框內逐鏡下載連結、封面選擇 `spine.setCoverShot`、全部依序下載)。也就是說「成片」在同一頁事實上**有**後端/前端都接好的匯出動作,只是 `ProjectFlowGuide` 沒有引用它、也沒有連過去。

**影響**:
1. 若 `ENABLE_PROJECT_HUB` 開啟,使用者在畫面上會同時看到兩條步驟/流程列——左欄 `ProjectFlowGuide`(5 步:世界觀/劇本/分鏡/生成/成片)與頂部 `CreationFlowBar`(由 `console_.steps` 可設定工作流決定,依旗標可能是 4~6 步,含「引導式創作」「生成就緒鏡」「匯出素材包」等按鈕)。兩者對「完成度」各自獨立計算(`ProjectFlowGuide` 用 `allGenerated = hasShots && shots.every(done)`,`CreationFlowBar` 用 `allDone = shots.length>0 && shots.every(done)`,邏輯雖然等價但是各自重算,非共用來源),使用者看不出兩條列的差異與權責分工。
2. 五步引導的「成片」是北極星流程的**終點**(一句話→成片),卻是全流程裡唯一沒有主要動作鈕的一步,體驗上「引導到最後一步卻沒有下一步可做」,使用者得自己發現要去看頂部那條完全不同的列才能真正匯出。

**建議**:讓 `ProjectFlowGuide` 的「成片」步驟至少連到 `CreationFlowBar` 已有的匯出對話框(例如複用同一個 `exportOpen` 狀態或觸發同一個 callback),或者評估兩套進度列是否該合併為一,避免北極星最重要的「成片」節點在其中一套 UI 里是死路。

---

### 4.【高・client-security / contract-mismatch】`confirmBeforeGenerate`(client 布林,預設關閉)只保護 Studio.tsx 三條生成路徑中的一條,另兩條完全繞過,且其中一條連 `requireAuth()` 都沒有

**證據鏈**:
1. `client/src/contexts/PersonalSettingsContext.tsx:29,53`:`confirmBeforeGenerate: boolean`,`DEFAULT_PERSONAL_SETTINGS.confirmBeforeGenerate = false`——**client 端純布林,預設關閉**。
2. `client/src/shells/video/drawers/VideoSettings.tsx:49`:UI 文案宣稱這是「生成前先跳確認(**成本門**)」——對使用者的心智模型是「開了這個,所有生成都會先問我」。
3. `client/src/pages/Studio.tsx:1554-1572`(`handleGenerate`,對應主要「生成」鈕,`GenerationActionBar` 的 `onGenerate={handleGenerate}`,Studio.tsx:2988):唯一真的檢查 `personalSettings.confirmBeforeGenerate` 並跳 `window.confirm` 的地方。
4. `client/src/pages/Studio.tsx:1395-1499`(`handleBatchGenerate`,「多模態同時送出」鈕,`onClick={() => void handleBatchGenerate()}` 於 Studio.tsx:3006):**全函式沒有出現 `confirmBeforeGenerate` 字樣**,直接對每個已填寫提示詞的模態呼叫 `submitAsyncMutation.mutateAsync`(Studio.tsx:1493-1495,`Promise.allSettled`)。
5. `client/src/pages/Studio.tsx:709-739`(`submitDirectorBatch`,由 `sessionStorage.getItem("sendToStudio")` 內含 `batchTasks` 陣列觸發,見 Studio.tsx:871-881 的 `useEffect`:`if (Array.isArray(data.batchTasks) && data.batchTasks.length > 0) { ...; void submitDirectorBatch(tasks); }`)——同樣**沒有 `confirmBeforeGenerate` 檢查**,而且**連 `requireAuth()` 都沒呼叫**(對照 `handleGenerate`/`handleBatchGenerate` 開頭都有 `if (!requireAuth()) return;`,`submitDirectorBatch` 完全沒有這行)。此函式在頁面掛載的 `useEffect` 裡被動觸發,對每個 task 直接 `await submitAsyncMutation.mutateAsync(...)`(Studio.tsx:715-729),失敗只是 `catch { failed += 1; }` 靜默吞掉,不會像 `requireAuth()` 那樣彈出登入 modal。
6. 這三條路徑最終都打向 `server/routers/generate.ts:1561`(`submitMultimodalAsync`,`protectedProcedure`)——伺服器端會扣點、送 fal.ai queue(zod schema 於 generate.ts:1561-1605,與三個呼叫點送出的欄位一一對應,**無 contract-mismatch**,見「已驗證排除的疑慮」)。

**影響**:使用者若特地在設定頁打開「生成前先跳確認(成本門)」以防手滑或 AI 誤觸發花費,實際只有走單模態「生成」主鈕才有效。走「同時送出多模態」按鈕、或從導演 AI 頁面點「生成全部」(`client/src/pages/DirectorAI.tsx:1263-1319` `handleGenerateAll` → `dispatchToStudio` 寫入 `sessionStorage` → 導覽到 `/studio`)時,Studio.tsx 一掛載就會自動、無二次確認地送出所有付費生成請求——設定頁的「成本門」對這兩條路徑形同虛設。這與 `docs/research/W1-director-router-deepdive.md:29` 記載的「`askForStudioPlan` → `dispatchMany` → `submit` 唯一攔阻是預設關閉的 `confirmBeforeGenerate`」屬於**同一類病灶(client 端布林被當安全邊界,覆蓋不全)但是不同路徑**——W1 記載的是 AI 建議動作那條路徑,本次額外發現同一支檔案內「使用者自己點的批次鈕」與「跨頁跳轉自動觸發」這兩條路徑同樣繞過,且後者還額外漏掉登入檢查。

**建議**:
- 把 `confirmBeforeGenerate` 檢查抽成共用 wrapper(例如包裝 `submitAsyncMutation.mutateAsync` 本身),讓 `handleGenerate`/`handleBatchGenerate`/`submitDirectorBatch` 都經過同一關卡,而不是各自複製貼上檢查邏輯(目前的實作方式本身就容易漏)。
- `submitDirectorBatch` 至少應補上 `requireAuth()` guard,避免登入態過期時使用者只看到「導演批次任務失敗 N 筆」而不知道要重新登入。

---

### 5.【中・client-security / dead-ui,需求證】`dispatchMany` 對同批次多個 destructive action 的確認卡是單一物件覆寫,非佇列——理論上會靜默丟失前面的確認請求,但回傳值仍回報成功

**證據鏈**:
1. `shared/agent-actions.ts:764-778`(`isDestructiveAction`):`submit`/`reset`/`applyPreset`/`setModality`/`execute_task`/`execute_worldbuilding_task`/`execute_worldbuilding_task_batch`/`runWorkflow` 八種 action 都判定為需要確認。
2. `client/src/contexts/PageAgentContext.tsx:247`:`const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);`——**單一物件狀態,不是陣列/佇列**。
3. `PageAgentContext.tsx:421-435`(`dispatch`):對 destructive action,`setPendingConfirmation({...})` 後立刻 `return { ok: true, message: "awaiting user confirmation" }`——**不等待使用者真正確認**就 resolve。
4. `PageAgentContext.tsx:454-458`(`dispatchMany`):`for (const action of actions) results.push(await dispatch(action, opts));`——逐一呼叫 `dispatch`,若同一批次內有 ≥2 個 destructive action,後一個的 `setPendingConfirmation` 呼叫會覆蓋前一個,而 React state 更新前兩者可能在同一輪處理內連續發生,使用者只會看到 `AgentIntentPreview`(`client/src/components/AgentIntentPreview.tsx`,已確認掛載於 `DashboardLayout.tsx:961`,非死元件)顯示**最後一個**的確認卡;前面的 destructive action 永遠不會真的執行(因為使用者沒機會按確認),但 `dispatchMany` 回傳的陣列裡,那個被覆蓋掉的 action 仍然是 `{ ok: true }`。
5. `client/src/pages/Studio.tsx:1342-1387`(`handleAskDirector`)是目前站上呼叫 `dispatchMany` 的實際入口之一:`await pageAgent.dispatchMany(result.actions, { source: "manual" })` 後直接 toast「導演建議了 N 個動作」,不會知道其中可能有動作被靜默覆蓋。

**影響**:中等,**需求證**——是否會在現行 `askForStudioPlan` 的實際回應中觸發(即同一次回應是否真的會產出 ≥2 個 destructive action),本次未逐行核對 `askForStudioPlan` 的 system prompt 對「同批次多個 submit/reset」的機率與伺服器端是否有陣列去重/上限;僅確認**程式碼邏輯上此覆寫行為必然發生**,是否為高頻實際問題留待下一輪針對 `director.ts:3429` 附近再核。

**建議**:`pendingConfirmation` 改為佇列(陣列),或 `dispatch()` 對 destructive action 應該真正等待使用者按下確認/取消後才 resolve,避免「回報成功但其實從未執行」的情形。

---

## 已驗證排除的疑慮(negative results)

1. **`ENABLE_4SHELL` / `ENABLE_VIDEO_COCKPIT` 本身不是死旗標**:`featureFlags.ts:58` 預設 `true`(自 2026-06-20)、`.env.production:21` 顯式設 `1`;`videoFlags.ts:45` `ENABLE_VIDEO_COCKPIT` 預設 `true`、`.env.production:30` 顯式設 `1`。因此 `/video` 座艙(`DirectorConsole`/`StorySpineColumn`/`CreationFlowBar`)在生產環境確實可達——**死的只有 `ENABLE_PROJECT_HUB` 這一顆內層旗標**,不是整個座艙都沒上線,避免把發現 #2 過度推廣成「/video 整條都沒上線」。
2. **`studio.recipes` / `studio.versions` 持久化並非虛談**:`server/routers/studio.ts:11-90`(`recipes.list/create/delete`、`versions.list/create/setPinned`)皆為 `protectedProcedure` 真實實作,對應 `Studio.tsx:486-505`(`recipesQuery`/`versionsQuery`/`createRecipeMutation`/`createVersionMutation`/`setVersionPinnedMutation`)的呼叫欄位一致,Studio.tsx 註解自陳「之前 useState、重整就消失」的舊問題已修復——非死接口,已排除。
3. **`generate.submitMultimodalAsync` 的 client/server 欄位契約一致**:`server/routers/generate.ts:1561-1605` 的 zod schema(`aspectRatio`/`videoDurationSeconds`/`musicStyle`/`voiceModelId`/`vaultCharacterId`/`fineTunedModelId`/`loraWeight`/`overrideModelId`/`modelParams` 等)與 `Studio.tsx` 三個呼叫點(`handleGenerate`:1620-1664、`handleBatchGenerate`:1409-1485、`submitDirectorBatch`:713-729)送出的欄位逐一核對,**無 contract-mismatch**。
4. **`ProjectFlowGuide` 消費的脊椎動作皆有真實 server procedure,非假資料**:`WorldLinkPicker.tsx` 的 `listWorlds`/`linkWorld` → `client/src/spine/projectGateway.ts:314-326`(`creativeProject.link.mutate` / `worldbuilding.list.query`)→ 已核對 `server/routers/creativeProject.ts:332`(`link: protectedProcedure`)與 `server/routers/worldbuilding.ts:95`(`list: protectedProcedure`)皆存在;`spine.scheduleGeneration()`(`ProjectSpineProvider.tsx:263-270`)→ `genOne`(:182-)→ `spine.adapters.generation.generate` 真實呼叫生成 adapter(非純 mock,`VIDEO_SPINE_MOCK` 旗標可切換離線種子,預設走真實 tRPC)。五步引導本身「劇本」「分鏡」步驟的主鈕(`onGuided`)開啟的 `GuidedJourney.tsx`(200 行)也是真實實作,非佔位元件。
5. **`ProjectFlowGuide.test.tsx` 存在且與本次靜態分析結論一致**:七個測試涵蓋五步狀態推導、Phase 1 導航(世界觀/成片唯狀態不可點)、Phase 2 動作鏈(劇本/生成主鈕)、「部分生成不誤判可成片」的回歸案例,測試本身就印證了發現 #3(成片步無按鈕)不是本次分析誤讀,而是元件既有、被測試鎖定的既定行為。
6. **`PlanningSubpageGuide.tsx` 與五步北極星引導無關,已排除**:`client/src/components/PlanningSubpageGuide.tsx`(132 行)是 `/notes`(`NotesPage.tsx:830`,`page="notes"`)與 `/calendar`(`CalendarPage.tsx:1093`,`page="calendar"`)兩個規劃頁共用的靜態摺疊卡,內容是寫死的 `PLANNING_GUIDE` 提示文字 + 導向 `/director`/`/studio`/`/dashboard` 三個既有路由的連結(皆已確認路由存在),沒有任何狀態推導、旗標判斷或與世界觀/劇本/分鏡/生成/成片相關的邏輯。任務原先把它列入疑似五步引導相關檔案,經核對後排除。
7. **`askForStudioPlan` 繞過安全閘的問題非本次新發現**:`server/routers/director.ts:3429`(`askForStudioPlan: brainProcedure`)在現行 HEAD 依然存在,與 `docs/research/W1-director-router-deepdive.md` 記載的分析一致,本文件不重複列為新發現,僅作為發現 #4(`confirmBeforeGenerate` 覆蓋不全)的背景對照組引用。

---

## 附錄:關鍵檔案/行號索引

| 主題 | 檔案:行號 |
|---|---|
| ProjectFlowGuide 實際路徑(非任務假設路徑) | `client/src/shells/video/console/ProjectFlowGuide.tsx:1-205` |
| ENABLE_PROJECT_HUB 定義(預設 OFF) | `client/src/config/videoFlags.ts:61-67` |
| ENABLE_PROJECT_HUB 掛載端守門 | `client/src/shells/video/console/StorySpineColumn.tsx:64-65` |
| 生產環境未開 ENABLE_PROJECT_HUB | `.env.production:17-30` |
| dev 環境開 ENABLE_PROJECT_HUB | `dev-environment/.env.dev.example:22-29` |
| 成片步無 canvasMode/無主鈕 | `client/src/shells/video/console/ProjectFlowGuide.tsx:102-109,119-125` |
| CreationFlowBar 真實匯出功能(與成片步脫節) | `client/src/shells/video/console/CreationFlowBar.tsx:188-192,240-336` |
| confirmBeforeGenerate 定義與預設值 | `client/src/contexts/PersonalSettingsContext.tsx:29,53` |
| handleGenerate 唯一檢查 confirmBeforeGenerate 處 | `client/src/pages/Studio.tsx:1567-1572` |
| handleBatchGenerate(未檢查) | `client/src/pages/Studio.tsx:1395-1499`,按鈕 `:3006` |
| submitDirectorBatch(未檢查、未 requireAuth) | `client/src/pages/Studio.tsx:709-739`,觸發點 `:871-881` |
| submit action 直接呼叫 handleGenerate | `client/src/pages/Studio.tsx:2328-2334` |
| isDestructiveAction 定義 | `shared/agent-actions.ts:764-778` |
| dispatch/dispatchMany 確認卡覆寫風險 | `client/src/contexts/PageAgentContext.tsx:247,421-458` |
| AgentIntentPreview 掛載處(確認為非死元件) | `client/src/components/DashboardLayout.tsx:961` |
| PlanningSubpageGuide 使用處 | `client/src/pages/NotesPage.tsx:830`、`client/src/pages/CalendarPage.tsx:1093` |
