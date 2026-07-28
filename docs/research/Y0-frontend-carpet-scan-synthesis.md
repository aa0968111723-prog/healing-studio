# Y0 — 前端地毯掃描 wave Y 綜合彙整(北極星流程實況)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 性質:Y1-Y10 前端逐頁深挖彙整;可證偽項經對抗式驗證

## 資料來源與驗證覆蓋率說明

本綜合彙整整併 10 份 wave 文件(docs/research/Y1~Y10-*.md),共約 73 條 raw findings。其中:

- **20 條**(cluster 為 dead-ui / contract-mismatch / client-security)本輪經過獨立對抗式驗證(逐行讀碼、反查呼叫端、與 server 契約核對),**refuted = 0 條**,但 **7 條嚴重度被下修**(見第 4 節)。
- **Y8(project-assets)全部 12 條** findings 在來源文件內已自帶 `verdict: CONFIRMED`,屬於該 wave 自查後的結果,本輪採信但未重新獨立覆核。
- 其餘 northstar-flow / uiux-defect / other 分類、以及 Y8 以外標記「未逐行核對」「本次僅…」的項目,**未經本輪二次對抗驗證**,以下一律標註「wave 內部初篩,未經 Y0 覆核」,不代表已證實或已推翻。
- Y10 一條標記 **PLAUSIBLE**(信心較低),已依原樣保留該標籤,不視為 CONFIRMED。
- **資料品質警訊**:Y4(animation)wave 產出的唯一一條 finding 內容為字面 `"title": "test"`, `"evidence": "test"`,判斷為佔位/測試髒資料,**非真實稽核結果**,已排除於本報告所有統計與結論之外;Y4 wave 實質上等同尚未產出可用內容,建議重新跑一輪。

---

## 1. 北極星一條龍前端實況圖

北極星本質:創作者在單一專案裡走 **腳本→分鏡→逐幕(字卡+畫面圖影+聲音)→簡易拼接→輸出→打包**;AI 讀單一專案上下文全程逐步引導、不跑偏;快速素材管理+目標管理;達最終成品;連自己的資料庫/工具、建自動化工作流。

逐段核對前端現況如下(●=有基本雛形但斷 ○=幾乎不存在 ✕=旗標/資料模型鎖死):

| 環節 | 前端有沒有 | 通不通 | 被什麼鎖住 / 斷在哪 | 佐證 |
|---|---|---|---|---|
| **腳本** | ● DirectorAI.tsx 有聊天式腳本產出 | ✕ 不通:腳本操作(chat/saveSession/savePlanningSession/listSessions)完全沒有 `projectId` 範疇化,`project_notes_calendar` 表本身沒有此欄位 | 資料模型層缺口,非旗標 | Y2 northstar-flow critical,DirectorAI.tsx:2385,3406-3412;drizzle/schema.ts:487-536 |
| | | | ProjectContextStrip.tsx 明文警告「這支影片的腳本、素材與意圖不會被保存」 | Y2 |
| **分鏡** | ● 有「建立分鏡板」與「送入影片佇列」兩個按鈕 | ✕ 不通:兩者是互不關聯的獨立管線,各自 INSERT 新 `world_storyboards`,同一腳本可生出多份互不同步的分鏡板 | 無 upsert/複用邏輯 | Y2 northstar-flow high,DirectorAI.tsx:2853-2862,4086-4098 |
| | | AIDV-50 session tracking(`batchGenerateWithSession`) | ✕ 唯一呼叫端從未傳 `storyboardId`,session 追蹤功能 100% 不會觸發 | server storyboardId optional 且整段邏輯被 `!==undefined` 包住 | 已對抗驗證 confirmed high,DirectorAI.tsx:2907,4045-4060;director.ts:1199-1240 |
| | | WorkflowStepper「分鏡/生成」導覽 | ○ 兩步驟 tabId 都指向 worldbuilding,但真正批次生成入口在 script tab,worldbuilding tab 內只有建分鏡板按鈕 | 導覽死路(wave 內部初篩,未覆核) | Y2 dead-ui medium |
| **逐幕(字卡+畫面圖影+聲音)** | ● ImageStudio/ProStudio/VideoStudio 各自可單獨生成圖/影/音 | ✕ 三者是獨立單鏡頭工具,VideoStudio.tsx 全檔 0 個 `creativeProjectId` 引用,不是座艙本體 | 架構上未收斂進單一專案 | Y3 northstar-flow high |
| | | 生成結果回填腳本卡 | ✕「回到導演 AI」橋接永遠送 `resultUrl:null`,VideoStudio/ProStudio 生成的真實結果連結送不回 DirectorAI | 5 個分頁 reportState 架構性缺 video_url 欄位 | 已對抗驗證 confirmed high,VideoStudio.tsx:4968-4993 |
| | | 3D/World 五模型結果解析 | ✕ rodin3d/hunyuanWorld 在唯一可達輪詢路徑上 100% 誤判失敗(觸發退款嘗試);sam3dObjects/hunyuan3d 副輸出格式全部不可見 | extractFalMediaUrl 欄位表缺 model_mesh/world_file | 已對抗驗證 confirmed critical,ImageStudio.tsx:3712-3751;generate.ts:2259-2307 |
| | | 已扣點任務失敗退款 | ✕ `submitStudioJob` 從不寫 `costPoints`,ImageStudio/ProStudio 幾乎全部背景任務的失敗退款邏輯保證是 no-op | 契約缺欄位 | 已對抗驗證 confirmed critical,generate.ts:2143-2169 |
| | | 逐幕確認狀態(approved) | ○ `status==='approved'` 只用於統計徽章,從未作為生成/送佇列前置閘門,且會被 AI 討論結果靜默覆寫回 refined | wave 內部初篩,未覆核 | Y2 uiux-defect medium |
| **簡易拼接** | ○ 幾乎不存在 | ✕ 全代碼庫沒有真正的媒體合成(compose)服務,`videoCompiler.ts`/`audioCompiler.ts` 只是提示詞編譯器;VideoStudio.tsx 全檔搜尋 zip/打包/匯出/拼接/compose 皆 0 命中 | 服務層根本未建 | Y3 northstar-flow high,對照既有 M1 NS-05 結論 |
| **輸出** | ● 有單鏡頭「下載 MP4」/複製 URL | ○ 沒有跨鏡頭彙整,只有單一影片檔案層級動作 | 同上,拼接沒做,輸出自然只能是單檔 | Y3 northstar-flow high,VideoStudio.tsx:203-266 |
| **打包** | ○ 五步引導(ProjectFlowGuide)「成片」步驟名義上存在 | ✕ 永遠無可執行動作,無 canvasMode 欄位,元件註解自陳「成片匯出待後端」 | 且同頁已有真正可用的 CreationFlowBar 匯出素材包按鈕未被引用 | Y1 northstar-flow high,ProjectFlowGuide.tsx:102-109 |
| **AI 全程引導不跑偏** | ● 有五步引導元件、有光球 workflow 執行 | ✕✕ 雙重斷點:(1) Studio.tsx 的「五步引導」與 shells/video 的真正 ProjectFlowGuide 是零關聯的兩套系統,任務假設路徑本身不存在;(2) `ENABLE_PROJECT_HUB` 生產環境 OFF、dev 預設 ON,dev 看到的引導 prod 使用者看不到 | 旗標+架構雙重錯位 | Y1 northstar-flow critical ×2,Studio.tsx:1;videoFlags.ts:67 |
| | | AI 執行時的逐步確認 | ✕ `runWorkflow` 只有事前一次性確認卡,`confirmStep`/`estimateAndConfirmBudget` 細粒度守門鉤子全檔零引用,`requireConfirmationForWorkflowSteps` 硬編碼 false | 與「測試模式:每步確認」預設卡文案矛盾 | 已對抗驗證 confirmed critical,GlobalOrbChatContext.tsx:5373-5410,3357-3358 |
| **快速素材管理** | ● AssetsLibrary/ProjectNotesDrawer 存在 | ✕ 與 `creativeProjectId` 完全無綁定,client/router/DB 三層皆無此欄位,是全域素材庫而非「這個專案的素材」 | 資料模型缺口 | Y8 CONFIRMED critical,AssetsLibrary.tsx:521-540 |
| | | 「素材」快速開啟按鈕 | ✕ ImageStudio/ProStudio 皆用永久生效的 `hidden` class,AssetsQuickDrawer 全站不可達 | CSS bug(dead-ui) | 已對抗驗證 confirmed high,ImageStudio.tsx:4408-4414 |
| **目標管理** | ○ 完全不存在 | ✕ Project 型別只有 `progress`(0-100數字),無 goal/milestone 欄位;全 client 搜尋「目標/goal/GoalTracker」零命中 | 非旗標鎖住,是從未建模 | Y8 CONFIRMED critical,client/src/types/projects.ts:25-57 |
| **自己的資料庫(學習/教材)** | ● LearnHub.tsx 功能完整(含影片學習/測驗/提示詞庫+CRUD) | ✕ 整檔在正式環境 100% 不可達(被 4-shell 路由 shadow),光球深連結 `?docId=` 是死指令 | ENABLE_4SHELL 生產默認 ON,shadow 掉舊 Route | 已對抗驗證 confirmed critical,LearnHub.tsx;App.tsx:244 |
| | | 教材管理後台入口 | ✕「編輯/匯入/新增於學習中心」按鈕實際導向純唯讀面板,全站無任何可達 UI 能管理內容 | ContentTab.tsx 導向的 /learn/docs 落地頁無 CRUD | Y7 northstar-flow critical |
| **自己的工具/自動化(連接器 Adobe/Canva/Notion 類)** | ● TeamDataSourcesPanel 有 Notion/Drive 建立表單 | ✕ Google Drive 連接前端有兩套互不同步的資料模型(`dataSourceConnections` vs `driveAssetLibraries`),同一授權在兩處各自記帳 | 兩張獨立 DB 表未互查 | Y6 northstar-flow critical |
| | | 新增連接入口 | ✕ 鎖在需先有作用中專案的 /create 流程,/settings 連接器頁完全唯讀無導引連結 | 架構性入口單一化 | Y6 northstar-flow high |
| | | 「其他 MCP 工具」分類 | ✕ 文案宣稱只差權限/稽核表,實際建立表單、健檢、收集器 adapter 三層全部空白 | 低估真實缺口 | 已對抗驗證 confirmed high |

**一句話結論**:北極星「腳本→分鏡→逐幕→拼接→輸出→打包」六步,前端在**分鏡之後就開始斷裂**——逐幕生成三個工具(圖/影/音)互相獨立且與腳本卡失聯,拼接服務整個不存在,打包(五步引導最後一步)是死 UI;而應該貫穿全程的「單一專案 AI 引導」在資料層(project_notes_calendar 無 projectId)、旗標層(ENABLE_PROJECT_HUB 生產 OFF)、執行層(runWorkflow 逐步確認鉤子未接線)三處同時斷開,素材管理與目標管理則是完全脫鉤/未建模,不是流程斷點而是地基缺口。

---

## 2. 依 Cluster 分節

### 2.1 northstar-flow(北極星一條龍流程斷點/缺口)

> 本節項目多為 wave 內部初篩,除標明 CONFIRMED/PLAUSIBLE 者外未經 Y0 二次對抗驗證。

| 檔案:行號 | 標題摘要 | 嚴重度 | 驗證狀態 | 建議 |
|---|---|---|---|---|
| Studio.tsx:1(對照 shells/video/console/ProjectFlowGuide.tsx) | 五步引導與 Studio.tsx 零關聯,任務假設路徑不存在 | critical | wave 初篩 | 釐清「五步引導」到底該接在 Studio.tsx 還是 shells/video,補上真正串接或砍掉重複系統 |
| videoFlags.ts:67 | ENABLE_PROJECT_HUB 生產 OFF、dev 預設 ON,造成環境落差 | critical | wave 初篩 | 統一 dev/prod 旗標值,或決定正式上線時間表前先讓 prod 內部可見以便驗收 |
| ProjectFlowGuide.tsx:102-109 | 「成片」步驟永遠無可執行動作,與 CreationFlowBar 真實匯出功能脫節 | high | wave 初篩 | 讓 film 步驟直接呼叫既有 CreationFlowBar 匯出邏輯 |
| DirectorAI.tsx:2385,3406-3412,2760-2809 | 核心資料操作(chat/saveSession/listSessions)無 projectId 範疇化,DB 表無此欄位 | critical | wave 初篩 | 這是北極星地基缺口,建議列為 NS 卡最高優先:先加 `project_notes_calendar.creativeProjectId` 遷移,再逐一補寫入/查詢過濾 |
| DirectorAI.tsx:2853-2862,4086-4098 | 建立分鏡板/送入影片佇列各自新建 world_storyboards,同腳本多份不同步分鏡板 | high | wave 初篩 | 改為 upsert:同一腳本/專案應複用既有 storyboard id |
| VideoCockpit.tsx:165-172 | 「建立空白專案」單一動作遺棄當前專案、複製出第二個 creative_project | critical | wave 初篩 | onCreated 回呼應先確認使用者要不要放棄當前專案,並讓 VideoProjectCreateDialog 真正傳遞 creativeProjectId |
| VideoStudio.tsx:1-120 | 全檔 0 個 creativeProjectId 引用,是獨立單鏡頭工具而非座艙本體 | high | wave 初篩 | 若定位維持「工具頁」則應在文案/導覽上明確定位,不宜暗示為座艙主流程 |
| VideoStudio.tsx:203-266 | 拼接/輸出/打包 UI 完全不存在,僅單鏡頭下載 | high | wave 初篩,對照既有 M1 NS-05 | 落地一個最小可用的 compose 服務是解鎖整條北極星最關鍵的單一投資 |
| DriveLibrarySection.tsx:59-64,289-297 | Google Drive 連接兩套互不同步資料模型 | critical | wave 初篩 | 二選一收斂:要嘛 TeamDataSourcesPanel 也讀 driveAssetLibraries,要嘛合併成單一連線表 |
| ConnectionsPanel.tsx:44-51,130,151-156 | 新增連接入口鎖在 /create 流程,/settings 頁純唯讀無導引 | high | wave 初篩 | 至少在 /settings 空狀態補一個導去 /create 的按鈕/連結 |
| ContentTab.tsx | 管理後台「編輯/匯入/新增」按鈕實導向唯讀面板 | critical | wave 初篩 | 移除誤導文案,或真正把 /learn/docs 接上 CRUD |
| TeachingArchive.tsx | 搜尋僅走 LIKE,疊加既有 NSX-1(text 教材永不向量化) | high | wave 初篩 | 待 LearnHub 可達性修復後一併檢討是否改接語意 search procedure |
| AssetsLibrary.tsx:521-540 | 資產庫/筆記抽屜與 creativeProjectId 完全無綁定,三層(client/router/DB)皆無此欄位 | critical | **Y8 CONFIRMED** | 需先補 DB schema 欄位再逐層打通,是素材管理併入北極星的前置工程 |
| client/src/types/projects.ts:25-57 | 目標管理 UI 全站不存在,非旗標鎖住是從未建模 | critical | **Y8 CONFIRMED** | 對照 docs/research/00-devzone.md 卡 NS-07,需要從資料模型設計起 |
| ProjectsContext.tsx:168-177 | pickActive() 未釘選時靜默 fallback 成「最新更新一筆」專案,且為生產預設路徑 | high | **Y8 CONFIRMED** | 違反北極星「不跑偏」承諾,應在 UI 上明確標示「系統猜測」或強制要求釘選 |
| ImageStudio.tsx:3013-3034 | 未匯入腳本分鏡時,ImageStudio 回導演 AI 的交接經 sessionStorage 會靜默流失 | medium | wave 初篩 | 補一次性讀取失敗時的 toast/持久化備援 |
| SettingsPage.tsx:274-282,1293-1314 | 唯一「重置/重看新手引導」入口因 SettingsShell 孤兒化而不可達 | critical | wave 初篩(建立在已對抗驗證的 SettingsShell 孤兒化基礎上) | 修好 SettingsShell 路由後這條會自動復原,應一併驗收 |
| Home.tsx:1121-1124 | OnboardingFlow 預設完成路徑導向 /agent 而非 VideoShell 自稱旗艦座艙 /video | medium | **PLAUSIBLE**(信心較低,未深入 AgentChat.tsx) | 建議追加驗證 AgentChat.tsx 是否承接剛完成專案上下文 |

### 2.2 dead-ui(按鈕/功能呼叫不存在或旗標鎖住的後端、永不顯示的分支)

已對抗驗證(confirmed,含嚴重度校正):

| 檔案:行號 | 標題 | 原始→校正嚴重度 | 建議 |
|---|---|---|---|
| server/routers/worldStoryboard.ts:314-349 | updateJob 全 repo 零呼叫端,VideoStudio 佇列面板狀態永遠凍結在建立當下 | critical→**medium**(status 顯示問題,非崩潰/安全/資料遺失) | 把 VideoStudio「生成」按鈕的 onClick 接上 updateJob 回寫,或至少改用真實輪詢結果渲染狀態 |
| client/src/components/connectors/ConnectorsPanel.tsx:1-317 | 整目錄 100% 孤兒死碼,CONNECTORS_PANEL_ENABLED 從未被讀取 | critical→**medium**(僅為未接線的重複實作,真正面板 ConnectionsPanel.tsx 另外存在且可用) | 二選一:接上路由或整個目錄連同旗標一併刪除,避免未來誤維護 |
| client/src/pages/LearnHub.tsx | 整檔正式環境 100% 不可達,深連結死指令 | **critical**(維持) | 見第 5 節,是三大關鍵斷點之一 |
| client/src/pages/TeachingArchive.tsx | teachingArchive.update 後端完整但前端零呼叫,只能刪除重傳;isFeatured/sortOrder 已接入 ORDER BY 但前端無從設定 | high→**medium**(有替代路徑,非阻斷) | 補一個編輯表單即可,後端已就緒,成本低 |
| client/src/pages/ImageStudio.tsx:4408-4414 / ProStudio.tsx:4747-4753 / VideoStudio.tsx:5096-5102 / DirectorAI.tsx:4522-4531 | 「素材」快速開啟按鈕四處皆用永久生效 hidden class,AssetsQuickDrawer 全站不可達 | **high**(維持) | 移除 `hidden`,或補上正確的響應式前綴(如 `hidden md:flex`) |
| client/src/shells/ShellFrame.tsx:21-33 | ShellDisabled 占位頁承諾管理員可於功能開關重新開啟,但無此開關 | high→**medium**(僅誤導文案,非阻斷關鍵路徑) | 改文案為「需重新部署」,或真正把 shell 旗標納入可寫 RUNTIME_FLAGS |
| client/src/shells/settings/SettingsShell.tsx:26-49 | /settings 富殼把 AdminPage/AgentPreferencesPage/SettingsPage 全變孤兒頁 | **critical**(維持) | 見第 5 節,三大關鍵斷點之一 |

wave 內部初篩、未經 Y0 覆核(供參考,不代表已證實):WorkflowStepper 分鏡/生成導覽死路、SceneSwitcher.tsx 硬編碼 false 旗標鎖死、CreationHubSections.tsx 整檔被取代未清、AssetsLibrary.tsx legacyAssetId 死碼分支、qwenCloneVoice 端點零呼叫、imageStudio.checkImageStatus 系列零呼叫、executeApprovedTask/approvedByB 完整實作零呼叫(見第 3 節)、/social shell 四頁預設關閉且無 runtime override。

### 2.3 contract-mismatch(client 期待欄位/型別與 server 不符)

已對抗驗證(confirmed):

| 檔案:行號 | 標題 | 校正嚴重度 | 建議 |
|---|---|---|---|
| DirectorAI.tsx:2907,4045-4060 / director.ts:1199-1240 | batchGenerateWithSession 唯一呼叫端從未傳 storyboardId,AIDV-50 session 追蹤 100% 不觸發 | **high** | 呼叫端補傳 storyboardId,並補測試蓋住「W1 jobsJson 併發競態」目前被此 bug 遮蔽的路徑 |
| VideoStudio.tsx:4968-4993 | 「回到導演 AI」永遠送 resultUrl:null | **high** | 讓五個分頁的 reportState 補上 video_url 欄位(參考 ImageStudio.tsx:3027 正確實作) |
| VideoProjectCreateDialog.tsx:49-85 / videoProject.ts:64-90 | 建案流程從未送 creativeProjectId,即使 server 已支援 | high→**medium** | 補一個 prop 傳入當前 activeProjectId |
| ConnectionsPanel.tsx:30 | 「其他 MCP 工具」文案宣稱只差權限表,實際三層(建立/健檢/收集)全空白 | **high** | 文案先降級為「尚未支援」,避免使用者誤判已可用只差治理 |
| TeachingArchive.tsx | 「已抽文」completed 徽章與「AI 助理就能引用」標語矛盾,無欄位可區分已抽文/已向量化 | **high** | 後端補一個 vectorStatus/embeddingStatus 欄位,前端徽章拆成兩層狀態 |
| ImageStudio.tsx:3712-3751 / generate.ts:2259-2307 | rodin3d/hunyuanWorld 結果解析恆為 null,誤判失敗;另三支遺失副輸出格式 | **critical** | extractFalMediaUrl 補上 model_mesh/world_file 欄位;BackgroundTasksDrawer 補渲染 model_urls/gaussian_splat 等副輸出 |
| generate.ts:2143-2169 | submitStudioJob 從不寫 costPoints,退款邏輯保證 no-op | **critical** | 比照 submitMultimodalAsync/generateMusicSuno 的正確模式,在 createBackgroundJob 時內嵌 costPoints |

wave 內部初篩、未覆核:BatchGenerationDialog 積分預警天真估算、AIDV-270 inputAssets 全鏈路只收集不消費、ProjectStatus.archived 永不可達、孤兒 mock 面板 ACL 模型對不上真實後端、proStudio.ts estimated_credits 前端從未讀取。

### 2.4 client-security(client 端旗標/布林被當安全邊界、確認閘可繞)

已對抗驗證(confirmed):

| 檔案:行號 | 標題 | 校正嚴重度/分類 | 建議 |
|---|---|---|---|
| Studio.tsx:1567(對照 :1395-1513,:709-739) | confirmBeforeGenerate 只護住 handleGenerate,batchGenerate/submitDirectorBatch 全繞過 | high→**medium**,重新歸類為 **client-consistency/cost-UX**(非安全邊界繞過,伺服器 protectedProcedure 仍在) | 統一三條路徑的確認體驗;submitDirectorBatch 補 requireAuth 改善未登入錯誤呈現 |
| GlobalOrbChatContext.tsx:5373-5410,5742-5763,3357-3358 | runWorkflow 只有事前一次性確認卡,逐步確認/成本閘門鉤子從未接線 | **critical**(維持) | 見第 3 節,接上 confirmStep/estimateAndConfirmBudget,或至少讓 requireConfirmationForWorkflowSteps 真正讀取使用者 policy |
| GlobalOrbChatContext.tsx:4605-4613 | 編編(composer)自然語言指令路徑硬編碼 requireConfirmation:false,行內註解與實際行為不符 | **high**(維持) | 移除錯誤註解;composer 路徑應也呼叫 shouldAskBeforeAct |
| ProStudio.tsx:4067-4068(proStudio.ts:1688-1820) | checkAudioStatus IDOR 是活躍呼叫路徑,request_id 明碼顯示畫面上 | **high**(維持) | 補 ctx.user.id 擁有權檢查(參考同檔 getCustomBlock 的正確模式);移除畫面明碼顯示 request_id |
| generate.ts:1536-1540 | jobStatus 無 owner 檢查,ImageStudio/ProStudio 背景任務可被連號 jobId 枚舉 | **high**(維持) | 比照 checkStudioJob 補 `if (job.userId !== ctx.user.id) return null` |

wave 內部初篩、未覆核(需求證,見第 3 節延伸):PageAgentContext.pendingConfirmation 單一物件非佇列可能覆蓋確認卡、context 欄位把選取文字未結構化拼入 LLM prompt、PageAgentContext navigate 未走白名單、executeApprovedTask/approvedByB 自我宣告旗標無簽章(dead 但架構同源)、LearnHub 附件 URL 無 scheme 限制(現時因不可達風險趨近零)。

### 2.5 uiux-defect(發現性/狀態遺失/錯誤無回饋/a11y)

已對抗驗證(Y8 project-assets 全數 CONFIRMED):

| 檔案:行號 | 標題 | 嚴重度 | 建議 |
|---|---|---|---|
| ProjectNotesDrawer.tsx:320-325,454-459 | 刪除 mutation 系統性缺 onError,確認對話框無條件關閉造成假成功訊號 | high | 補 onError toast,失敗時不清空 pendingDeleteId |
| ProjectSelector.tsx:91 | 觸發按鈕顯示 fallback 猜測值,但下拉清單勾選判斷用原始 activeProjectId,兩者矛盾 | medium | 統一判斷基準用同一個值 |
| ProjectNotesDrawer.tsx:140-154 | NoteCard 型別接受 scheduledDate 卻從未渲染排程時間 | medium | 補上時間顯示 |
| ProjectNotesDrawer.tsx:156-161 | 刪除按鈕 hover-only,鍵盤使用者難以發現 | low | 補 focus-visible:opacity-100 |

wave 內部初篩、未覆核:ProStudio AvatarVideoTab 對 FAILED 狀態零回饋(卡在假的處理中動畫)、Notion/Drive 連線失敗通用 toast 無 CTA、「個人資料庫/vault」一詞三處各自指涉不同概念、LearnHub 404 深連結無提示、SiteOnboardingContext 22 個 spotlight target 多數在 DOM 不存在、光球「重新導覽本頁」路徑表未跟上 4-shell 改版、t2v 分頁 Sora 雙重解析度控制易混淆。

### 2.6 other(非核心但值得記錄)

imageStudio.ts 全部 23 支生成 mutation 零點數扣除(交叉驗證既有 V1/U3 結論一致);director.ts 的 fetchTrendingInspiration/perplexityThrottleStatus 全 client 零呼叫死碼;askForStudioPlan(W1 已載)唯一呼叫端確認為 Studio.tsx 而非 DirectorAI.tsx——本次 wave 批次生成流程本身不觸發該已知風險。

---

## 3. client-security 主題溯源:W1/W8/X2 在前端的源頭

既有稽核(W1 askForStudioPlan、W8 executeTools approved、X2 fallbackTools)反覆指出「**client 布林被當安全邊界**」是這個代碼庫的系統性反模式。本輪 Y5(orb-client)在前端找到了這個反模式的**兩個獨立源頭**,證實它不是單一端點的孤立疏失,而是同一種寫法在不同代理派工路徑上被各自重造:

1. **runWorkflow 直接派工路徑**(GlobalOrbChatContext.tsx:5742-5763,3357-3358):`startPendingWorkflow` 無條件傳 `requireConfirmation:false`,`executeActions` 把它硬編碼成 `requireConfirmationForWorkflowSteps:false`,使 `PageAgentContext.dispatch()` 原本存在的 `isDestructiveAction` 逐步確認閘門(`opts.requireConfirmation ?? (isDestructiveAction(action) && ...)`)因為收到的是**顯式 false 而非 undefined**,`??` 運算子不會 fallback 到安全網,閘門被繞過。
2. **composer(編編)自然語言指令路徑**(GlobalOrbChatContext.tsx:4605-4613):同樣的 `requireConfirmation:false` 硬編碼,且行內註解宣稱「executeActions 內部已會依 preferences 決定」——這句話在程式碼裡完全不成立,`executeActions` 全函式沒有一行讀取 `confirmationPolicy`。

兩處與 W8 已記載的 `executeApprovedTask`/`ApprovedTask`/`approvedByB`(PageAgentContext.tsx:98-104,468-512,487-488)是**同一種形狀**:一個 client 自建物件內的布林/字面量字串被當成「已核准」的憑證,沒有伺服端簽章或二次驗證。差別只在於 `approvedByB` 這條線目前全庫零呼叫端(dead-ui,尚未真正接線危害不會發生),而 runWorkflow/composer 這兩條線是**活的、每天在跑的真實派工路徑**。

也就是說,X2 fallbackTools 主題描述的「client 端旗標當安全邊界」模式,在前端最新一輪稽核中被**在完全不同的兩個檔案位置獨立重新製造出來**——這意味著這不是「當年沒改完」的殘留,而是團隊在後續開發(orb-agent 自然語言派工、workflow 直接派工)時持續複製同一個不安全模式。建議:把「凡是 requireConfirmation/approved 類旗標,必須經過伺服器可驗證的機制(如簽章 token 或伺服器端二次確認 API)」寫成團隊層級的架構守則,而不是逐一修補。

需注意修正過的認知:`confirmBeforeGenerate`(Studio.tsx)那條原本標記 client-security 的發現,經核實後**不屬於此主題**——它保護的是使用者自選的「生成前提醒」,伺服器端從未也不需要對它做強制,真正的授權邊界(`protectedProcedure`)始終完好,繞過的只是 UX 提醒而非安全閘門,已重新歸類為 client-consistency。

---

## 4. 明確聲明:哪些被下修、哪些被排除、哪些是 negative result

**refutedCount = 0**——本輪 20 條可證偽發現(dead-ui/contract-mismatch/client-security)沒有任何一條被完全推翻,核心程式碼事實均查證屬實。但為避免誇大,以下 **7 條嚴重度被下修**,理由摘要:

1. `confirmBeforeGenerate` 繞過(flowguide):high→medium,重新歸類 client-security→client-consistency(伺服器端授權邊界未被繞過)。
2. `worldStoryboard.updateJob` 零呼叫(video-cockpit):critical→medium(僅狀態顯示凍結,非崩潰/安全/資料遺失,使用者仍可正常生成影片)。
3. `VideoProjectCreateDialog` 未送 creativeProjectId(video-cockpit):high→medium(缺功能但非阻斷)。
4. `components/connectors/` 孤兒目錄(connectors-ui):critical→medium(重複但未使用的死碼,真實 ConnectionsPanel 另外存在且可用,非使用者可見斷點)。
5. `teachingArchive.update` 零呼叫(learn-owndb):high→medium(有「刪除重傳」替代路徑,非阻斷)。
6. `OnboardingFlow` 只寫 localStorage(shell-onboarding):high→medium(影響範圍窄化為「跨裝置/清快取使用者多看一次引導」,非「多數使用者重複引導」,且會自我修復)。
7. `ShellDisabled` 誤導文案(shell-onboarding):high→medium(純文案問題,非功能阻斷)。

**明確排除(非誇大,是資料本身無效或無關)**:
- `PlanningSubpageGuide.tsx`(flowguide/other):核對後確認與五步北極星引導無關,是 notes/calendar 頁共用的靜態提示卡,已由來源 wave 自行排除,本報告從缺。
- Y4(animation)wave 的唯一一條 finding 內容為字面 `"test"`/`"test"`,判定為髒資料/佔位符,**排除於本報告所有分析之外**,并標記 Y4 wave 需要重跑。

**Negative result(查證後確認「這裡是對的」,值得記錄避免誤修)**:
- `ImageStudio.tsx:3009-3027` 的 `handleReturnToDirector` 正確送出真實 `resultUrl`,證明橋接模式本身可行,只是 VideoStudio/ProStudio 沒接上——不需重新設計架構,只需比照实作。
- `submitMultimodalAsync`/`generateMusicSuno` 正確在 `createBackgroundJob` 時內嵌 `costPoints`,證明退款機制本身設計無誤,只是 `submitStudioJob` 這條路徑漏接。
- `getCustomBlock`(proStudio.ts:855-869)與 `checkStudioJob`(generate.ts:2176-2182)都正確做了 `ctx.user.id` 擁有權檢查,證明 IDOR 修法在同代碼庫內已有現成範例可抄,不需要新設計。
- server 端 `protectedProcedure` 授權邊界在 `confirmBeforeGenerate` 繞過案例中始終完好,沒有因為 client 端遺漏檢查而被突破。
- H2 既有結論(Sora 欄位契約正確性)本輪未推翻,VideoStudio.tsx 的雙重解析度控制是 UX 冗餘而非契約錯誤。
- **Y8(project-assets)wave 是本次 10 個 wave 中唯一全數自帶 verdict:CONFIRMED 的一份**,内部查證扎實,可信度高於其餘僅初篩的 wave。

---

## 5. 給 Bruce:北極星流程前端最關鍵的 3 個斷點

**斷點 1 —「單一專案」在資料層根本不存在,AI 沒有東西可以「讀」**
DirectorAI 的腳本/分鏡操作(chat、saveSession、savePlanningSession、listSessions)全部沒有 projectId 範疇化,`project_notes_calendar` 表連欄位都沒有;AssetsLibrary/ProjectNotesDrawer 同樣與 creativeProjectId 无綁定(Y8 已 CONFIRMED)。這意味著北極星承諾的「AI 讀單一專案上下文全程逐步引導」在**最底層的資料庫 schema 就不成立**——不是接線問題,是還沒有這根柱子。
→ 對應 NS 卡:建議開一張「creative_projects 範疇化遷移」的地基卡,優先於任何 UI 修補,把 projectId/creativeProjectId 欄位補進 project_notes_calendar、digital_asset_library 等核心表,再逐一收斂前端查詢。

**斷點 2 — 逐幕生成之後,「拼接」整層服務不存在,「打包」是死 UI**
VideoStudio.tsx 全檔搜尋 zip/打包/匯出/拼接/compose 皆 0 命中,唯一輸出動作是單鏡頭下載 MP4;五步引導的「成片」步驟永遠無可執行動作。這是北極星「簡易拼接→輸出→打包」三步在前端**完全空白**,不是某個按鈕壞了,是這一層從未被建造。
→ 對應 NS 卡:落地一個最小可用的 compose 服務(哪怕只是把多個生成結果依腳本順序串接的陽春版),是解鎖整條北極星「腳本到成片」閉環最高槓桿的單一投資,建議列為下一個 Wave 的頭號候選卡。

**斷點 3 — 兩個核心「設定殼」被自己的路由 shadow 成孤兒頁,使用者連回頭修正的入口都找不到**
`/settings` 富殼的內部 Switch 把 `/settings`、`/settings/agent`、`/settings/admin` 全部導向精簡版 SettingsHome 分頁,原本 11/12/8 個分頁的 AdminPage/AgentPreferencesPage/SettingsPage 三個完整頁面在生產環境**永遠選不到路由**(與 LearnHub 同構問題)——連帶使唯一的「重置/重看新手引導」按鈕也不可達。這代表即便前面兩個斷點修好了,使用者也可能無法透過設定頁面自行排查、重看引導或管理進階設定。
→ 對應 NS 卡:這是最容易修、投資報酬率最高的一張卡——问题出在 `App.tsx` 的 `<Switch>` 子節點順序與 `SettingsShell.tsx` 內部路由映射,不需要重新設計功能,只需把 `shellRouteTable.ts` 裡本來就登記好的 `P.SettingsPage`/`P.AgentPreferencesPage`/`P.AdminPage` 正確接上(目前只有旗標關閉分支才會讀到),應優先於前兩張大卡先修掉,同時能順帶驗收 LearnHub 的同款路由 shadow 問題是否用同一次修復解決。
