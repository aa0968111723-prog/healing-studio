# IN0 — 全站接縫地圖(元件/欄位/頁面/前後端 連結整合稽核)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 性質:IN1-IN8 接縫追蹤彙整;可證偽項經對抗式驗證

本文彙整 IN1-IN8 八份接縫追蹤文件(`docs/research/IN1-contract-generation.md` ~ `IN8-event-bg-task-wiring.md`)的 confirmed 斷點(共 24 條,皆為 high/critical、已對抗式驗證),並保留 allByCluster 全量(含 medium/low 與少量「健康/negative」對照組)供交叉核對。**本輪 refutedCount = 0 — 沒有任何斷點被推翻。**

---

## 1. 接縫健康度總表

四類連結各自的健康度,以「confirmed 斷點數(high/critical)」為主指標,括號內為 allByCluster 全量(含 medium/low/健康對照)供參照。

| 連結類型 | 對應文件 | confirmed 斷點數 | 全量 findings(含健康/低優先) | 最嚴重斷點 |
|---|---|---|---|---|
| **前後端契約**(client↔server API/procedure) | IN1 contract-gen、IN2 contract-project、IN3 contract-learn、IN4 contract-settings | **14** | 26(其中 3 條 low/other 為「範圍註記非缺陷」) | critical — 生產環境路由旗標使 AdminPage.tsx 呼叫的 6 個 admin procedure 已無存活 UI 入口(server/routers/admin.ts:43-152 vs client/src/pages/AdminPage.tsx:280-401 已被 SettingsShell 取代) |
| **頁面交接**(page↔page 狀態/深連結) | IN5 page-to-page-handoff | **3** | 6(含 1 條 N1-N4 健康對照組,證實 GlobalOrbChatContext/DirectorAI handoff、assetsLibraryRouteState 等接得對) | critical — `/assets?section=X` 深連結整組死亡,getInitialSection() 硬編 "assets"(client/src/App.tsx:222-380 vs client/src/pages/AssetsLibrary.tsx:241-244) |
| **元件接線**(component props/context/callback) | IN6 component-context-wiring | **2** | 5(另有 2 條 medium — race 型 pendingConfirmation 覆蓋、Conversation 失敗靜默 — 未達本輪 confirmed 門檻但建議追蹤) | high — NavigationConfirmationCard 在 /agent 頁重複渲染兩份(GlobalOrbChatContext.tsx:6416-6506 vs AgentChat.tsx:2396-2444) |
| **欄位跨層**(DB↔Drizzle↔zod↔client type,含背景任務/事件) | IN7 field-cross-layer、IN8 event-bg-task-wiring | **5** | 9(4 條 medium,涵蓋 spine assets 空陣列、status enum 有損映射、SSE 降級提示掛載範圍過窄等) | critical(2 條並列)— background_jobs 生成路徑死接縫(client/src/adapters/generation.trpc.ts:128-160 vs server/routers/generate.ts:2143-2169 + drizzle/schema.ts:286-317);BackgroundTasksDrawer 從未掛載,drawerOpen 全站 no-op(BackgroundTasksContext.tsx:319-324 vs BackgroundTasksDrawer.tsx:260-262) |
| **總計** | — | **24** | **46** | — |

觀察:「前後端契約」類斷點數最多(14/24,58%),且以 **dead-seam**(server 建好、client 沒接)為壓倒性主因;「欄位跨層」類雖然條數少,但集中了本輪最高嚴重度(2 條 critical 且皆涉及生成/記帳核心路徑),風險密度最高。

---

## 2. 依 cluster 分節:確認斷點表

### 2.1 contract-mismatch(前後端欄位/型別不符)— 4 條

| 標題 | severity | endpointA(兩端之一) | endpointB(另一端) | 建議 |
|---|---|---|---|---|
| vectorStatus 概念兩端皆不存在,語意檢索完成度誤植進 transcriptionStatus | high | server/routers/teachingArchive.ts:240-244,260-264 + server/services/teachingArchiveIngest.ts:32-34 | client/src/pages/TeachingArchive.tsx:731-759(TranscriptionBadge) | 新增獨立 `vectorStatus` 欄位(pending/indexed/not_applicable),徽章依此欄位而非 transcriptionStatus 判色,避免「已抽文」與「可語意搜尋」混為一談 |
| 前端 RBAC 宣稱 leader 可看使用者・積分分頁,後端卻是 admin 專屬 | high | client/src/shells/settings/rbac.ts:30-37 + UsersCreditsTab.tsx:6-46 | server/routers/admin.ts:18-39(adminProcedure) + server/_core/trpc.ts:69-88 | 二選一:放寬 server 端 procedure 為 leaderProcedure(若業務允許),或把 client rbac.ts 的 `users` 最低權限改回 `admin`,兩端目前互相矛盾必須先定案再改一邊 |
| admin.allUsers/allUsersPaginated 把 passwordHash/twoFactorSecret/icsFeedToken 洩漏給每位 admin | high | server/routers/admin.ts:13-27 + server/db.ts:568-589(全欄位無白名單) | client/src/pages/AdminPage.tsx:210,437-471 + UsersCreditsTab.tsx:34-80(僅用到安全欄位,型別宣告 any[]) | server 端查詢改白名單 select(排除 passwordHash/twoFactorSecret/icsFeedToken),不要依賴「client 恰好沒用到」作為安全邊界 |
| dispatchMany 回傳 AgentActionResult[] 被呼叫端當 boolean 用,破壞性動作出現假成功 toast | high | client/src/contexts/PageAgentContext.tsx:170-173,421-435,454-458 | client/src/components/OrbGuidePanel.tsx:113-128,761-766 + Studio.tsx:1360-1371 | 呼叫端改為檢查陣列內每筆 result.success,任一筆 false 就不顯示成功 toast,並列出失敗項 |

### 2.2 broken-handoff(頁面/流程間狀態交接遺失)— 3 條

| 標題 | severity | endpointA | endpointB | 建議 |
|---|---|---|---|---|
| VideoStudio 與 ProStudio 回傳導演 AI 時 resultUrl 皆寫死 null(C-01 延伸) | high | VideoStudio.tsx:4967-4993(4985行 resultUrl:null) + ProStudio.tsx:4326-4354(4346行同款) | DirectorAI.tsx:2422-2447,2634,2651(DirectorReturnPayload.resultUrl 用於確認卡片與回填筆記) | 兩個 handleReturnToDirector 都應引用當前 result state 的實際 URL,而非硬編 null;比照 ImageStudio 對應函式的正確寫法統一實作 |
| 生產環境路由旗標使 AdminPage.tsx 呼叫的 6 個 admin procedure 已無存活 UI 入口 | critical | AdminPage.tsx:280-401(呼叫 teamCostSummary/apiProviderBreakdown/systemDailyTrend/allGenerationHistory/updateAutoCreditPolicy/runAutoCreditNow) | AdminPanel.tsx:27-33(新 ADMIN_TABS 僅 5 個 key,無對應分頁) | 把這 6 個 procedure 的呼叫遷移進新 AdminPanel 分頁(或新增對應分頁),否則刪除 AdminPage.tsx 死路由與這 6 個 procedure,避免功能懸空 |
| ImageStudio/VideoStudio/ProStudio →「回到導演AI」在 importedSegments 為空時靜默擱置,零回饋 | high | ImageStudio.tsx:3013-3043、VideoStudio.tsx:4967-4993、ProStudio.tsx:4326-4354 | DirectorAI.tsx:2624(`if (importedSegments.length === 0) return;` 無 toast/無 TTL) | 比照同檔案 matchIdx===-1 已有的 toast 模式(:2631-2637),補上「沒有可回填內容」的使用者可見提示,不要靜默 return |

### 2.3 broken-wiring(元件間 props/context/callback 沒接上)— 1 條

| 標題 | severity | endpointA | endpointB | 建議 |
|---|---|---|---|---|
| NavigationConfirmationCard 在 /agent 頁重複渲染兩份 | high | GlobalOrbChatContext.tsx:6416-6428,6445-6450,6501-6506 | AgentChat.tsx:2396-2401,2438-2444 | 確認渲染所有權歸屬單一層(建議收斂到 GlobalOrbChatContext,AgentChat 改為消費而非自行再渲染一份),避免使用者看到重複卡片 |

### 2.4 field-inconsistency(DB↔Drizzle↔zod↔client type 不一致)— 5 條

| 標題 | severity | endpointA | endpointB | 建議 |
|---|---|---|---|---|
| recordGenResult 契約缺 costCredits 欄位,成本紀錄被寫死成 1 點 | high | ImageStudio.tsx:3820-3827(不帶任何成本欄位) | server/routers/generate.ts:2414-2436(zod schema 無 costCredits)→ postGenActions.ts:238-243,284-285(預設回 1) | zod schema 補上必填 costCredits 欄位,client mutateAsync 呼叫點一併補送實際估算成本,消除「所有生成一律 1 點」的假象 |
| world_storyboards.productionStatus 同時被兩套互不相容列舉治理(PS-08) | high | shared/worldbuilding-animation.ts:208-215,362-372(7 值管線階段 zod enum) | server/routers/worldStoryboard.ts:63(as 轉型掩蓋)+ shared/video-state-machines.ts:73-91(SESSION_STATUSES 6 值實際寫入) | 廢除其中一套,統一以 SESSION_STATUSES(實際被寫入的那套)為準,shared/worldbuilding-animation.ts 的型別與 zod enum 同步改寫,移除 `as` 轉型掩蓋 |
| DataRepairTab.tsx 用不存在的狀態值 "running" 篩選卡住任務,真實 DB enum 是 "processing" | high | DataRepairTab.tsx:22-27(篩選 failed\|running\|queued) | drizzle/schema.ts:301-309(backgroundJobs.status enum 無 running,是 processing) | 把篩選條件的 "running" 改成 "processing",否則真正卡住的任務永遠篩不到 |
| digital_asset_library.sourceStudio 值 "music-studio" 未被納入 server/client 過濾 enum | high | server/routers/assets.ts:34-48,103-117(zod enum 無 music-studio)+ AssetsLibrary.tsx:160-172(SOURCE_STUDIOS 常數無 music-studio) | server/routers/proStudio.ts:2063(寫入 "music-studio")+ webhookSuno.ts:245-261(實際持久化進 DB) | 在兩端過濾 enum 补上 "music-studio",否則音樂工作室產出的資產在資產庫篩選器裡永遠篩不到/被排除 |
| activeJobs 查詢未過濾 jobType,LoRA 訓練/教材匯入任務可能以英文字面值混入 studio 背景任務 feed | high | server/routers/models.ts:240-247(jobType="model_training") + teachingArchiveIngest.ts:63-68(jobType="teaching_archive_ingestion") | generate.ts:2371-2399(activeJobs 無 jobType 過濾)→ BackgroundTasksContext.tsx:228-229 → AppleDock.tsx:249,276(直接顯示英文字面值) | activeJobs 查詢加上 jobType 白名單(僅生成類),或在 client 端建立 jobType→顯示名稱 的映射表,不要讓內部字面值外洩到 UI |

### 2.5 dead-seam(端點/事件/回呼從未被接)— 11 條

| 標題 | severity | endpointA | endpointB | 建議 |
|---|---|---|---|---|
| imageStudio.ts 的 jobStatus/jobResult/checkImageStatus 完整建置但 ImageStudio.tsx 從未呼叫 | high | server/routers/imageStudio.ts:1397-1511(含正確記帳與持久化) | ImageStudio.tsx(全檔零命中,走 falQueueRun 阻塞式同步等待) | 若非同步輪詢已是既定架構決策,應刪除 checkImageStatus 死代碼;若是規劃中但未完成的遷移,補上 client 呼叫並移除阻塞式等待 |
| DirectorAI.tsx 主聊天呼叫從未傳 projectId,世界觀注入形同死碼 | high | server/routers/director.ts:235-258(支援 projectId 注入世界觀摘要) | DirectorAI.tsx:3406-3413(chatMutation.mutate 未傳 worldCtx.currentProjectId) | 補上 `projectId: worldCtx.currentProjectId` 到 mutate 呼叫參數,否則此功能對所有使用者恆為關閉 |
| batchGenerateWithSession 仍未收到 storyboardId(C-02 現況確認,未修) | high | server/routers/director.ts:1199,1202-1240(有 storyboardId 才做狀態機追蹤) | DirectorAI.tsx:4051-4059(唯一呼叫點,未傳,元件內無此狀態) | 需在呼叫前補上 storyboardId 狀態管理(比照世界觀分鏡建立流程取得 id),否則批次生成永遠退化成舊版無追蹤模式 |
| teachingArchive.isFeatured / sortOrder 全鏈路存在但 client 完全不讀不寫 | medium | server/db.ts:4044-4072,4139-4143(排序已依此兩欄) | TeachingArchive.tsx(全檔零命中,無精選徽章) | 補上「設為精選」UI 操作與徽章顯示,否則後端排序邏輯對使用者不可見、不可控 |
| teachingArchive.update 與 RealEarth 三端點 server 完整、client 零呼叫 | high | teachingArchive.ts:307-361,462-527(update/link/unlink/getRealEarthLinks) | TeachingArchive.tsx 及 RealEarthResearch.tsx(皆零命中) | 確認此功能是否仍在產品範圍內;若是,補上 client 呼叫點;若已棄用,清除 server 端孤兒 procedure |
| plansRouter(訂閱方案 list/getById)全站零呼叫 | medium | server/routers/plans.ts:7-17(查有資料的 subscriptionPlans 表) | client 全樹搜尋 trpc.plans. 零命中 | 確認訂閱方案頁面是否仍待開發;若無規劃,考慮下線此 router 與對應資料表維護成本 |
| IN5-01 /assets?section=X 深連結整組死亡 | critical | App.tsx:222-380 + OrbGuideContext.tsx:400-404(navigate 到 ?section=vault\|tasks\|prompts\|collection) | AssetsLibrary.tsx:241-244(getInitialSection 恆回傳 "assets",setSection 零命中) | getInitialSection 改為實際解析 URL query 的 section 參數並呼叫 setSection,四個舊路由與光球快捷才能生效 |
| IN5-02 LearnHub ?docId= 深連結在 P6 富 shell 下雙重失聯 | high | PersonalDatabasePanel.tsx:160,355(navigate("/learn?docId=...")) | LearnShell.tsx:25-33(掛載 LearnHome 非 LearnHub)+ LearnHome.tsx:42-54(readSub 只認 ?sub=) | LearnHome 需補上 docId 讀取與對應開啟文件的邏輯,舊 LearnHub.tsx 的 handler 已因路由順序不可達,不能指望它接手 |
| background_jobs 圖像/keyframe 生成路徑死接縫 | critical | client/src/adapters/generation.trpc.ts:128-160(讀 last.assetUrl/url/seed/model/costUsd) | server/routers/generate.ts:2143-2169(submitStudioJob 只寫 row 無生成呼叫)+ drizzle/schema.ts:286-317(無此扁平欄位,值在 resultJson) | 這是本輪最高風險項之一:要嘛 submitStudioJob 補上實際生成呼叫並把結果攤平寫回client期待的欄位,要嘛 client adapter 改讀 resultJson 巢狀結構,兩端目前完全對不上導致此路徑形同從不產出結果 |
| BackgroundTasksDrawer 從未掛載於任何渲染樹 | critical | BackgroundTasksContext.tsx:319-324(toast 呼叫 setDrawerOpen(true)) | BackgroundTasksDrawer.tsx:260-262(唯一讀取者)+ DashboardLayout.tsx:491-493 只掛 Provider、AidvShellChrome.tsx 零引用 | 在至少一個常駐 shell(建議 AidvShellChrome 或 DashboardLayout)實際掛載 `<BackgroundTasksDrawer />`,否則「查看」按鈕永遠打不開任何東西 |
| submitStudioJob 不寫 costPoints(B-19 延伸,現況確認未修) | critical | generate.ts:2153-2168(resultJson 無 costPoints) | postGenActions.ts:575-587(refundJobIfBilled 短路)+ refundStatus.ts:105-116(回 none)+ refundStatus.ts client:62-65(徽章不渲染) | submitStudioJob 寫入時補上 costPoints 欄位(依估算或實際扣點金額),否則此類任務永遠無法退款也無法在 UI 顯示退款狀態 |

### 2.6 race(共用狀態競態)— 0 條 confirmed(供追蹤的 medium 候選)

本輪 confirmed 清單中沒有達到 high/critical 門檻的 race 類斷點。allByCluster 中有 1 條 medium 候選,**未在此波列入 confirmed、未經對抗式驗證，僅供追蹤參考**:

| 標題 | severity | endpointA | endpointB | 備註 |
|---|---|---|---|---|
| PageAgentContext.pendingConfirmation 為單一物件而非佇列,dispatchMany 內多個破壞性動作會互相覆蓋 | medium | PageAgentContext.tsx:421-435(覆蓋式 setPendingConfirmation) | PageAgentContext.tsx:454-458(dispatchMany 序列迴圈)+ AgentIntentPreview.tsx:31(只 render 單一物件) | 若 dispatchMany 常態呼叫多個破壞性動作,建議升級為佇列儲存待確認項,逐一彈出;未經本輪對抗式驗證,列此供下一輪覆核 |

---

## 3. 串接既有 contract 卡

| 既有卡 | 本輪狀態 | 依據 |
|---|---|---|
| **C-01**(VideoStudio→DirectorAI resultUrl:null) | **複核成立,且發現新增同源者** | 本輪確認 VideoStudio.tsx:4985 仍是 `resultUrl: null`,且**新發現 ProStudio.tsx:4346 存在完全相同的缺陷**(同名函式 handleReturnToDirector,同樣硬編 null)。建議 C-01 卡面範圍擴大為「VideoStudio + ProStudio」而非僅 VideoStudio,一次修兩處 |
| **C-02**(batchGenerateWithSession 不傳 storyboardId) | **複核成立,現況未修** | director.ts:1199-1240 與 DirectorAI.tsx:4051-4059 的呼叫關係與先前記錄一致,DirectorAI.tsx 元件內仍無 storyboardId 狀態(grep 0 命中),判定未修 |
| **Y0 §2.3 契約不符表** | **同源模式在本輪擴大,建議合併追蹤** | 本輪至少 7 條屬同類「前後端契約不符」(vectorStatus 誤植、RBAC leader/admin 不符、DataRepairTab running/processing、world_storyboards 雙軌 enum、music-studio sourceStudio 漏白名單、creative_projects.status 有損映射、LearnHub featured vs teachingArchive isFeatured 命名不一致),建議併入 Y0 §2.3 同一份表格追蹤,避免重複開票 |
| **SSOT-1**(appRegistry.supportedActions ↔ hasCapabilityForPage 脫鉤) | **未直接復核脫鉤本身;但呼叫端證實健康** | 本輪 IN5 的 N1-N4 負向對照組確認 `hasCapabilityForPage`(global-agent-capabilities.ts:187-195)與其消費端(DirectorAI/ImageStudio/VideoStudio/Studio/AssetsLibrary)接線正確、無斷點。這只證明「呼叫端沒問題」,**appRegistry.supportedActions 定義端本身是否仍與其脫鉤,未在兩端驗證**,需另開追蹤確認源頭 |
| **B-19**(submitStudioJob 不寫 costPoints) | **複核成立,現況未修** | 本輪重新驗證同一組行號(generate.ts:2153-2168 / postGenActions.ts:575-587 / refundStatus.ts 兩端),結論與原卡一致:退款判定與徽章對此類任務恆為靜默 no-op |
| **B-20** | **未在兩端驗證** | 本次提供的 8 份 IN 文件與 findings JSON 中未見對應此卡號的具體描述,無法判斷是否複核或有新增同源者。若需追蹤,請提供原卡的兩端描述以便比對 |
| **NSX-1** | **未在兩端驗證** | 同上,本輪素材中未見此卡具體內容,無法判斷現況 |

---

## 4. 系統性接縫反模式

以下 5 種壞法在 24 條 confirmed 斷點中重複出現,分別給根因與統一修法:

1. **「server 回傳/實作完整,但 client 從未呼叫」= 孤兒契約/維護負債面**(imageStudio.jobStatus、teachingArchive.update+RealEarth 三端點、plansRouter、rbacRouter、apiUsageRouter 5 端點、externalServicesRouter、isFeatured/sortOrder、BackgroundTasksDrawer 未掛載——本輪 11 條 dead-seam 中至少 8 條屬此型)。
   **根因**:功能上線時前後端分兩批交付,後端先完工、前端因排期/範圍調整而未跟上,且無「procedure 零呼叫」的自動偵測機制,問題長期不可見。
   **統一修法**:建立 CI 檢查,定期比對 router 定義的每個 procedure 名稱 vs 全 client 樹的 grep 呼叫次數,零呼叫超過一個 release 週期即標記待清或補前端,不讓孤兒契約無限期存活。

2. **「client 讀取的欄位 server 從不回填」= 靜默 undefined,功能表面存在實際失效**(VideoStudio/ProStudio resultUrl 恆 null、model_used/degraded 欄位從未讀取、submitStudioJob 缺 costPoints 使退款徽章恆不顯示、activeJobs 缺 jobType 過濾使內部字面值外洩)。
   **根因**:欄位在型別上是 optional/nullable,TypeScript 不強制處理缺值分支,且錯誤/降級路徑普遍沒有 toast 或紀錄,問題只能靠人工逐頁核對才會發現。
   **統一修法**:凡「影響使用者可見狀態」的回傳欄位一律以 zod 必填或 discriminated union 約束,client 端針對缺值分支強制補 fallback UI/警示,而非任由 undefined 靜默通過。

3. **「頁面交接靠初始狀態硬編或漏傳參數」= 深連結/跨頁狀態遺失**(/assets?section=X 硬編 "assets"、LearnHub ?docId= 在新 shell 下讀不到、batchGenerateWithSession/projectId 呼叫時漏傳)。
   **根因**:4-shell 路由遷移只搬了頁面容器,沒有同步搬遷「舊深連結參數的讀取邏輯」;或呼叫端明明已有該狀態,卻在組裝 mutation payload 這一步漏寫欄位(重構半成品)。
   **統一修法**:每次 shell/路由遷移前,先列出 App.tsx 全部 `navigate(...?xxx=...)` 呼叫作為深連結回歸清單,逐一驗證新 shell 有無對應讀取;呼叫 mutation 前把易漏的欄位(storyboardId、projectId)在型別上設為必填而非 optional,逼呼叫端在編譯期就補值。

4. **「client 假設的回應形狀,DB/server 實際上沒有」= 欄位存在的功能假象**(generation.trpc.ts 讀 last.assetUrl/url/seed/model/costUsd,但 backgroundJobs 表無此扁平欄位,值巢狀在 resultJson;background_jobs 生成路徑因此形同死接縫)。
   **根因**:前端 adapter 提前按「理想扁平化回應格式」寫好型別與讀取邏輯,但後端從未依此格式實作(契約先行、實作沒追上,或 PR 只完成一半)。
   **統一修法**:採契約優先(contract-first)開發順序——用同一份 zod schema 同時做 server 輸出驗證與 client 型別來源(如 `t.output(schema)`),CI 擋下任何 client 讀取 schema 未聲明欄位的情況,不允許「假設的形狀」單方面先行。

5. **「同一個 enum/status 兩份定義互不同步」= 欄位跨層漂移**(world_storyboards.productionStatus 兩套不相容 enum、DataRepairTab "running" vs DB 真實值 "processing"、creative_projects.status 與 client ProjectStatus 有損映射、music-studio 未列入 sourceStudio 過濾 enum)。
   **根因**:enum 定義分散在 shared/*.ts、drizzle/schema.ts、client 端各自手抄的 literal union 中,沒有單一來源,增修時容易只改一處而漏改其他份。
   **統一修法**:所有 status/enum 一律從 drizzle schema 衍生(如 drizzle-zod)並 re-export 給 shared 與 client 共用,消滅手抄第二份 enum 的可能性。

---

## 5. 推翻聲明

**本輪 refutedCount = 0 — 沒有任何斷點被推翻。** 進入 confirmed 清單的 24 條(來自 IN1-IN8 對抗式驗證後的 high/critical 集合)全數通過驗證留存;allByCluster 中額外的 22 條 medium/low 項目屬「範圍註記非缺陷」或「健康/negative 對照組」(如 IN5 的 N1-N4 確認 GlobalOrbChatContext handoff、hasCapabilityForPage 接線正確),並非被推翻,而是本輪嚴重度未達 confirmed 門檻或屬於刻意保留的正向對照。

---

## 給 Bruce:全站接縫最該優先接好的 3 條線

1. **生成成本/背景任務記帳這條線先接好**:submitStudioJob 不寫 costPoints(退款徽章全面失效)+ recordGenResult 缺 costCredits(成本寫死 1 點)+ background_jobs 扁平欄位不存在(client 讀不到真實生成結果)三者疊加,代表「使用者被扣了多少點、生成到底有沒有成功」這條核心財務/信任鏈路在多個環節同時斷裂,風險最高、影響最廣,建議第一優先。

2. **頁面交接/深連結這條線先接好**:`/assets?section=X` 整組死亡、LearnHub `?docId=` 雙重失聯、VideoStudio/ProStudio 回導演 AI 時 resultUrl 恆 null 且靜默擱置,三者都是使用者實際點擊後「看起來沒反應」的體感斷點,且都源自 4-shell 遷移半成品,建議一次性做深連結回歸清單並補齊。

3. **Settings/Admin 資安面這條線先接好**:admin.allUsers 洩漏 passwordHash/twoFactorSecret/icsFeedToken 給每位 admin,加上 RBAC 宣稱 leader 可見但後端擋在 admin-only(角色定義本身自相矛盾),再加上 AdminPage.tsx 6 個管理功能已無存活 UI 入口——這條線同時牽涉資料外洩與治理權限錯亂,建議與資安團隊一起優先排入。

---

*本文件為 IN1-IN8 彙整版,單條斷點的完整推導過程與更多 medium/low 項目請見 `docs/research/IN1` ~ `IN8` 對應原始文件。*
