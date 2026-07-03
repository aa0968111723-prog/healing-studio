# Y10 — 4-shell 路由 + Onboarding 前端深挖
- 產生日期:2026-07-03
- 依據 commit:812f6fdb（`git diff 812f6fdb..HEAD` 對本文所涉全部檔案零差異，HEAD 實測為 47917e3a，沿用 HEAD 現況）
- 稽核檔案:client/src/App.tsx 或路由設定、4-shell(video/learn/settings/social)殼頁、client/src/components/OnboardingFlow.tsx、client/src/contexts/SiteOnboardingContext.tsx

## 0. 旗標現況（先講清楚,下面所有結論都建立在此之上）

`client/src/config/featureFlags.ts:47` `ENABLE_4SHELL` 預設 **ON**（2026-06-20 拍板）；`:119-124` `ENABLE_AIDV_CHROME = ENABLE_4SHELL && (...預設 ON)`（2026-06-16 拍板）。`client/src/shells/settings/settingsFlags.ts:27` `SHELL_SETTINGS_RICH` 預設 ON；`client/src/shells/learn/learnFlags.ts:26` `SHELL_LEARN_RICH` 預設 ON；`client/src/config/shells.ts:24` `SHELL_SOCIAL` 預設 **OFF**。`client/src/config/featureFlags.ts:169` `ENABLE_ORB_ONBOARDING` 預設 ON。

**除非另外標註「非預設」，以下所有發現都是「什麼都不用做、正式環境現況」——不是理論上旗標組合。**

---

## 🔴 Critical

### 發現 1 — `/settings` 富殼把 AdminPage.tsx／AgentPreferencesPage.tsx／SettingsPage.tsx 全變孤兒頁,與 R14(LearnHub)同一套結構性 bug

**證據鏈**：
1. `client/src/App.tsx:244` `{ENABLE_4SHELL && shellRoutes()}` 是 `<Switch>` 第一個子節點；wouter 取第一個 match（`client/src/app/ShellRoutes.tsx:11-16` 註解自陳)。
2. `client/src/app/ShellRoutes.tsx:75-87`：`SHELL_IDS`（含 `"settings"`）逐一掛 `/settings` 裸前綴 + `/settings/:rest*` 萬用子路徑 —— 後者會攔截 `/settings/agent`、`/settings/admin` 等所有巢狀路徑,先於 `App.tsx:312-323` 舊有的 `<Route path="/settings/agent">`(→`AgentPreferencesPage`)、`<Route path="/settings">`(→`SettingsPage`)、`<Route path="/admin">`(→`AdminPage`) 生效（`LEGACY_REDIRECTS`,`client/src/shells/shellRouteTable.ts:111` 另把 `/admin`→`/settings/admin`）。
3. `client/src/shells/SettingsShell.tsx:5` 委派給 `client/src/shells/settings/SettingsShell.tsx`；`settingsFlags.ts:27` `SHELL_SETTINGS_RICH` 預設 `true` → 走富殼分支（`SettingsShell.tsx:28` 的 `if (!SHELL_SETTINGS_RICH) return <ShellFrame .../>` 永不觸發）。
4. 富殼自己的 `<Switch>`（`shells/settings/SettingsShell.tsx:34-43`）把 `/settings`→`<SettingsHome/>`、`/settings/agent`→`<SettingsHome initial="agent"/>`、`/settings/admin`→`<SettingsHome initial="admin"/>`——**都不是** `SHELL_SUBROUTES.settings`（`shellRouteTable.ts:62-64`）裡登記的 `P.SettingsPage`/`P.AgentPreferencesPage`/`P.AdminPage`（那張表只有 `SHELL_SETTINGS_RICH=OFF` 時的 `ShellFrame` 分支會讀到,同一份「唯一能讀到它的分支永不觸發」模式,與 L2 對 `/learn` 的結論完全同構）。
5. `SettingsHome.tsx:71-76` 的 5 個分頁分別渲染 `GeneralSettingsPanel`／`ProviderPanel`／`AgentPrefsPanel`／`ConnectionsPanel`／`ObservabilityPanel`／(`admin`)`AdminPanel`——皆為全新精簡元件,**不是** re-home 原頁面：
   - `pages/AdminPage.tsx:61-74`：**11 個分頁**（overview/users/activity/api/costs/generations/jobs/feedback/brain/ai-research/skills）。`shells/settings/panels/AdminPanel.tsx:27-33`：僅 **5 個分頁**（users/content/flags/data-repair/audit），且 `content`/`flags`/`data-repair`/`audit` 四個分頁在原 `AdminPage.tsx` 裡根本不存在——不是子集,是完全不同的兩套介面。
   - `pages/settings/AgentPreferencesPage.tsx:347-358`：**12 個分頁**（overview/behavior/budget/perception/critic/roles/notify/voice/tools/pages/ui/schedule，1272 行）。`shells/settings/panels/AgentPrefsPanel.tsx`（144 行）：僅人格切換 + 最近活動兩塊,無分頁,大幅縮水。
   - `pages/SettingsPage.tsx:587-635`：**8 個分頁**（profile/dashboard/data/appearance/notifications/onboarding/feedback/admin，1448 行）。`shells/settings/panels/GeneralSettingsPanel.tsx`（143 行）：僅外觀/通知/帳號三塊,無 `onboarding`/`dashboard`/`data`/`admin` 分頁。
6. `client/src/app/lazyPages.ts:35-37` 證實 `SettingsPage`/`AgentPreferencesPage`/`AdminPage` 三個 import 仍存在、可正常編譯——**不是死 import,是路由層面永遠選不到它們**,與 L2 對 `LearnHub.tsx`/`AIModelsHub.tsx` 的描述用語完全一致（"程式碼與欄位本身是完整的,只是不可達"）。

**影響**：管理員在正式環境完全看不到「系統概覽」「活動紀錄」「API/資料庫」「成本金流(AdminPage 版)」「生成歷史」「背景任務」「回饋(AdminPage admin 分頁版)」「AI 全站研究」「技能登錄」9 個原 `AdminPage` 分頁,以及 `AgentPreferencesPage` 的「成本預算」「感知」「自我批判」「工具白黑名單」「頁面權限」「助手 UI」「自動排程」7 個分頁——這些是真實的維運/治理面,不是裝飾性 UI。且此為 `SHELL_SETTINGS_RICH`/`ENABLE_4SHELL` 皆為**預設值**下的現況,不需任何特殊操作即可重現。

**建議**：仿照 `LearnShell.tsx` 對「既有深頁」的做法（`/learn/my-brain` 等直接 re-home `P.MyBrainPage` 而非重寫）,把 `AdminPanel`/`AgentPrefsPanel`/`GeneralSettingsPanel` 缺少的分頁補齊,或至少在 `SettingsHome`/`AdminPanel` 裡插入「舊版完整介面」的深連結逃生口（類似 `AdminApiUsagePage`/`AiBrainPipelinePage` 目前的 re-home 待遇）。

---

## 🔴 Critical

### 發現 2 — 因發現 1,全站唯一「重置/重看新手引導」入口變成不可達,直接斷 S1 成長路徑的回頭路

**證據鏈**：
1. `client/src/components/SiteOnboardingOverlay.tsx:480-497` 的 `ResetAllToursButton`（呼叫 `resetAllTours()` + 重啟 `"welcome"` tour）**唯一消費者**是 `client/src/pages/SettingsPage.tsx:10,1312`——全站 grep 無第二個 import 點。
2. `SettingsPage.tsx:274-282` 的 `handleRestartOnboarding()`（清空 `ai-director-onboarded`/`hasSeenTour`/`onboarded` 三個 localStorage 鍵 + 派 `site-tour-start` 事件）**唯一呼叫點**是同檔 `:1307` 的按鈕,在 `onboarding` 分頁（`:617-622,1293-1314`）裡。
3. 依發現 1,`SettingsPage.tsx` 在預設旗標組合下永不被任何路由渲染——`GeneralSettingsPanel.tsx`（實際掛在 `/settings` 的元件）完全沒有「重看引導」的等效功能（全文無 `ai-director-onboarded`/`ResetAllToursButton`/`resetAllTours` 字樣）。

**影響**：使用者一旦按過「跳過引導」或完成 `OnboardingFlow`,`localStorage["ai-director-onboarded"]` 被設為 `"true"`（`OnboardingFlow.tsx:320,328,357`）,之後**沒有任何站內 UI** 能讓他自己重新觸發首頁 90 秒首圖引導或全站 Welcome Tour——唯一辦法是使用者自行開 devtools 清 localStorage。這直接與 S1(成長路徑)期待的「使用者可主動回頭複習/重跑入門引導」相牴觸。

**建議**：與發現 1 一併修——最低成本做法是把 `<ResetAllToursButton/>` + `handleRestartOnboarding` 移到 `GeneralSettingsPanel.tsx`（`/settings` 富殼的一般設定分頁）或新增一個 `onboarding` 分頁到 `SettingsHome.tsx`。

---

## 🟠 High

### 發現 3 — 兩套「是否已完成引導」訊號永久失聯：Home 首頁引導只寫 localStorage,永不寫伺服器欄位

**證據鏈**：
1. `client/src/components/OnboardingFlow.tsx:320`(`handleComplete`)、`:328`(`handleBranchNavigate`)、`:357`(Skip 按鈕)——三個完成/略過路徑**只**呼叫 `localStorage.setItem("ai-director-onboarded","true")`,全檔 grep 無任何 `trpc.agentPreferences.*` 或 `onboardingCompletedAt` 字樣。
2. `client/src/pages/Home.tsx:805` 判斷是否顯示 `OnboardingFlow` 只看 `localStorage.getItem("ai-director-onboarded")`,同樣不查任何伺服器欄位。
3. 對照 `client/src/shells/AidvShellChrome.tsx:58-71`：另一套「首次引導」（`ENABLE_ORB_ONBOARDING` 預設 ON 的 `OrbOnboardingDialog`)靠 `trpc.agentPreferences.getPreferences` 讀伺服器欄位 `onboardingCompletedAt`(`server/routers/agentPreferencesRouter.ts:65`,DB 落地,見 `server/services/agentPreferenceService.ts:96`)**加上** localStorage 雙重判斷才決定是否彈出。
4. `client/src/components/orb-agent/OrbOnboardingDialog.tsx:56,88,93-96` 證實**只有這個對話框**在完成/略過時,才會同時寫 `onboardingCompletedAt`(伺服器)**與** `localStorage['ai-director-onboarded']`——是單向橋接：`OrbOnboardingDialog` 完成 → 兩邊都同步；`OnboardingFlow`(Home 首頁版)完成 → 只有 localStorage 同步,伺服器欄位永遠留 `null`。

**影響**：正式環境裡使用者登入後第一個落點是 `/`（`App.tsx:245` 不包 `DashboardLayout`,`AidvShellChrome` 尚未掛載),幾乎必然先跑 Home 版 `OnboardingFlow`。完成後,`agentPreferences.onboardingCompletedAt` 永久是 `null`。這造成：①該使用者換裝置/清瀏覽器資料/換瀏覽器後,`localStorage` 是空的,`Home.tsx` 會重新彈 90 秒首圖引導,`AidvShellChrome` 的 `OrbOnboardingDialog` 也會因為伺服器欄位仍是 `null` 而准備彈出——依使用者先落地哪個頁面,會得到兩套不同、互不相干的「初次引導」UI 之一,體驗不一致；②任何讀 `onboardingCompletedAt` 做分眾/分析的後端邏輯（`server/services/spiritTools/settingsDetailTools.ts:1247` 已有一處判斷式)永遠把「Home 引導已完成」的使用者誤判為未引導。

**建議**：`OnboardingFlow.tsx` 的 `handleComplete`/`handleBranchNavigate`/Skip 三處補一次 `agentPreferences.updatePreferences({onboardingCompletedAt: new Date().toISOString()})`（fire-and-forget 即可,不阻塞導航),讓兩套引導共用同一個伺服器落地訊號。

---

### 發現 4 — SiteOnboardingContext 的 22 個 spotlight `targetId` 裡,多數在目前程式碼上完全找不到對應 DOM 元素

**證據鏈**（逐一 grep 全 `client/src` 核實,非抽樣）：

| targetId | 定義位置 | 現況 |
|---|---|---|
| `sidebar-nav` | `SiteOnboardingContext.tsx:86` | 只存在於 `AppleDock.tsx:702`；`DashboardLayout.tsx:877-901` 證實 `ENABLE_AIDV_CHROME`（預設 ON）為真時渲染 `<AidvShellChrome/>` 取代 `<AppleDock/>`——預設情境下此 id **永不出現在 DOM** |
| `sidebar-studio-link`／`sidebar-pro-studio-link`／`sidebar-image-studio-link`／`sidebar-video-studio-link`／`sidebar-director-link`／`sidebar-learn-link` | `SiteOnboardingContext.tsx:95,104,113,122,131,140` | 由 `DashboardLayout.tsx:109` `` `sidebar-${leaf.pageId}-link` `` 動態產生,但**只餵給** `<AppleDock entries=.../>`（`:880`）；`AidvShellChrome.tsx` 的 `Rail`/`TopBar`（`:166-216`）只有 4 個 shell 圖示,無此類 id。同上,預設情境下皆不存在 |
| `modality-tabs`／`prompt-builder-area` | `:174,183` | ✅ 存在（`pages/Studio.tsx:2705,2737`),`/video/studio` 可達,可正常運作 |
| `generate-button` | `:192` | 全 `client/src` grep **零匹配**(唯一另一處引用是 `ProactiveOrbWidget.tsx:1044` 的 `elementId` 提示字串,同樣指向不存在的 id)——從未存在,非旗標造成,疑似頁面改版後忘記同步 |
| `proactive-orb-anchor` | `:201` | ✅ 存在（`ProactiveOrbWidget.tsx:3241`),且該元件全站常駐掛載,恆可用 |
| `pro-tab-music`／`pro-tab-voice`／`pro-tab-avatar` | `:227,236,245` | 全 `pages/ProStudio.tsx` grep **零匹配**（`:4460` 只有一行給 AI 代理 `focusElement` 用的**提示字串**「可用 elementId=pro-tab-music」,並非真的 DOM id) |
| `image-api-key-banner` | `:270` | 全 `pages/ImageStudio.tsx` 與全 repo grep **零匹配** |
| `director-chat-input`／`director-reset-btn` | `:320,329` | 全 `pages/DirectorAI.tsx` grep **零匹配** |
| `models-dataset-tab` | `:354` | 全 `pages/ModelsPage.tsx` grep **零匹配**（該頁確有一個 `step==="dataset"` 的 state 值,但從未渲染成 `id="models-dataset-tab"` 的元素） |
| `history-search` | `:379` | 全 `pages/HistoryPage.tsx` grep **零匹配**（`:479` 有搜尋 `<Input>` 但未包 id） |
| `learn-search`／`learn-category-filter` | `:532,540` | ✅ 存在,但**只存在於** `pages/LearnHub.tsx:2499,2518`——而 `LearnHub.tsx` 本身依 L2/R14 已確認是預設旗標下的孤兒頁,故此 tour 的觸發頁（`usePageTour("learn")` 掛在 `LearnHub.tsx:2148`)本身永不掛載,tour 不會被觸發（非「使用者看到壞掉的 tour」,而是「這個 tour 整組作廢」） |
| `focus-flow-tabs` | `:581` | ✅ 存在（`pages/FocusFlowPage.tsx:770`),可正常運作 |

`SiteOnboardingOverlay.tsx:369-385` 對「找不到目標元素」有防禦：`el` 為 `null` 時 `targetRect` 設回 `null`,渲染會退化成 `DarkBackdrop`(全螢幕暗屏)+ 置中卡片（`:446-458`)——**不會當機**,但也**不會**顯示文案承諾的「聚焦框選」,且文案本身描述的是已不存在的舊版兩層側欄結構（"可以用滑鼠拖拉邊緣來調整寬度"等）。

**影響**：`DashboardLayout.tsx:720-730` 對每個登入使用者、掛載任一 `DashboardLayout` 頁面 1.2 秒後**無條件**檢查並自動觸發 `"welcome"` tour（不受 `ENABLE_AIDV_CHROME` 影響)——這是預設情境下新用戶一定會遇到的路徑。7 步驟中 6 步（含首步後的全部 6 步)目標元素在預設 chrome 下不存在,使用者看到的是連續 6 張「莫名其妙全螢幕暗屏置中卡片」,而非文案承諾的「聚焦導覽」。另外 5 個獨立頁面 tour（`pro-studio`/`director`/`models`/`history`/`image-studio`)的部分或全部步驟目標元素**從未存在過**（與旗標無關的既有 bug）。

**建議**：①把 `sidebar-*` 系列步驟改成同時支援 `AidvShellChrome` 的 Rail 對應元素(或乾脆為 welcome tour 開一條 `ENABLE_AIDV_CHROME` 分支文案);②`generate-button`/`image-api-key-banner`/`pro-tab-*`/`director-chat-input`/`director-reset-btn`/`models-dataset-tab`/`history-search` 七組 id 需要回頭替對應頁面補上真實 id,或直接砍掉這幾個 tour 步驟改用 `targetId:null` 置中說明。

---

### 發現 5 — `ShellDisabled` 承諾管理員可從「功能開關」重新開啟被關閉的 shell,但 `FeatureFlagsTab` 完全沒有這個開關

**證據鏈**：
1. `client/src/shells/ShellFrame.tsx:21-33`（`ShellDisabled` 元件)文案:「管理員可於 /settings → 管理後台 → 功能開關重新開啟（示範「功能開關即時影響全站」）。」——`/social` 在預設 `SHELL_SOCIAL=false` 下就是走這個分支(`ShellFrame.tsx:41-47`,`config/shells.ts:24`)。
2. `client/src/shells/settings/admin/FeatureFlagsTab.tsx:58-72`（section A,「建置時旗標」)明確標示為**唯讀**（`:6-7` 註解自陳「要改需改 .env 重 build；不可由 UI 即時切」),`SHELL_SOCIAL` 會出現在這個唯讀徽章網格裡（因為它在 `featureFlags.ts:218-231` 的 `FEATURE_FLAGS` 匯出物件內)。
3. `FeatureFlagsTab.tsx:28-34` 的「執行時功能開關」（section B,唯一可寫的一組)`RUNTIME_FLAGS` 清單只有 5 項（research/byomcp/ambient/focusFlow/onboarding),**沒有任何一項對應 shell 啟用**,且其寫入目標 `settings.extraSettings.featureFlags`（`:53`)是**使用者級**設定（`:89` 註解自陳「站台級治理待 P3」),就算硬塞一個鍵進去也不會是 `ShellDisabled` 文案承諾的「全站」效果。

**影響**：管理員照著畫面文案操作,會發現「管理後台 → 功能開關」裡確實看得到 `SHELL_SOCIAL: OFF` 的徽章,但點不動、也没有任何按鈕能把它變成 ON——文案承諾的能力不存在,是一個具體可指出的體驗缺陷（找了半天發現按鈕根本沒做)。

**建議**：改文案為「需請工程調整環境變數 `VITE_SHELL_SOCIAL=1` 並重新部署」,或反過來把 shell 啟用旗標真的接進 section B 的 `settings.update` 路徑（比照其他 `RUNTIME_FLAGS`)。

---

## 🟡 Medium

### 發現 6 — `/social` shell 858 行已寫好的四頁,預設關閉且無任何單瀏覽器預覽退路

**證據鏈**：`client/src/pages/social/{SocialCockmy,SocialStudio,SocialBrand,SocialPublish}Page.tsx` 合計 858 行（`SocialCockpitPage.tsx` 230 行、`SocialStudioPage.tsx` 237 行、`SocialBrandPage.tsx` 125 行、`SocialPublishPage.tsx` 266 行),透過 `client/src/app/lazyPages.ts:43-46` 正常匯入、`client/src/shells/shellRouteTable.ts:68-75` 正常登記路由。但 `client/src/config/shells.ts:24` `SHELL_META` 的 `social.enabled = SHELL_SOCIAL`,而 `featureFlags.ts:60` `SHELL_SOCIAL = readFlag("VITE_SHELL_SOCIAL", false)` ——**沒有**使用 `readRuntimeOverride`（對照同檔 `ENABLE_AIDV_CHROME`/`ORB_SMILEY_ONLY`/`FEATURE_EXPORT_CHAIN`/`FEATURE_ONBOARDING_BRANCH` 皆支援 `?key=1` 單瀏覽器覆寫)。

**影響**：這批已完成的功能唯一的預覽方式是請工程改 `.env` 重新 build/部署——不像其他同批旗標可以用網址參數即時給利害關係人看,拖慢驗收/走查節奏。

**建議**：`SHELL_SOCIAL` 改用 `readRuntimeOverride("shellsocial") ?? readFlag(...)` 比照其他旗標,方便 `?shellsocial=1` 單瀏覽器預覽。

---

### 發現 7 — 光球「重新導覽本頁」在所有 4-shell 新路徑下都退化成重播全站 Welcome Tour

**證據鏈**：`client/src/components/DashboardLayout.tsx:734-754`（`handleOrbRestartTour` 的 `pathToPageId` 表)只有舊版頂層路徑（`/pro-studio`/`/image-studio`/`/video-studio`/`/director`/`/models`/`/learn`/…),完全沒有 4-shell 的 canonical 路徑（`/video/pro`、`/video/image`、`/video/video`、`/video/director`、`/video/create`、`/video/studio`、`/video/playground`、`/video/animation`、`/video/light-orb`、`/learn/ai-models`、`/learn/model-wishlist`、`/learn/my-brain`、`/learn/codex`、`/learn/teaching-archive`、`/learn/teams`、`/learn/feedback`、`/settings/agent`、`/settings/admin`,及其子路徑)。`:755` `pathToPageId[location] ?? "welcome"` 兜底成 `"welcome"`。此 handler 綁在 `ProactiveOrbWidget`（`:943-951`),與 `ENABLE_AIDV_CHROME` 無關,恆常掛載；使用者點擊光球選單裡的「tour」/「教學引導」動作（`ProactiveOrbWidget.tsx:2216` `case "tour"`、`:1965`/`:2027` `view==="tutorial"`皆呼叫 `onRestartTour?.()`)在上述任一新路徑上都會誤觸發全站 Welcome Tour,而非當頁 tour。

**影響**：使用者在（例如）`/video/pro` 頁面請光球「重新導覽本頁」,得到的是與當頁無關的全站 7 步導覽（且其中 6 步本身又是發現 4 的壞 tour),而不是 `pro-studio` 專屬 tour——雙重體驗缺陷疊加。

**建議**：把 `pathToPageId` 的 key 換成（或加上）4-shell canonical 路徑,或改用「路徑前綴比對」而非精確字串比對。

---

### 發現 8（PLAUSIBLE，信心較低）— OnboardingFlow 預設完成路徑落在 `/agent`（全頁對話),不是 `/video`（旗艦座艙)

**證據鏈**：`client/src/pages/Home.tsx:1121-1124`「進入完整工作室」按鈕（未選任何下一步分支 chip 時的預設完成路徑)`onComplete` 呼叫 `navigate("/agent")`；`client/src/shells/VideoShell.tsx:1-15` 註解自陳 `VideoCockpitFrame` 是「旗艦座艙」（`ENABLE_VIDEO_COCKPIT` 預設 ON)。`/agent` 對應 `pages/AgentChat.tsx`（2987 行,獨立全頁聊天介面),與 `VideoCockpitFrame`/`VideoCockpit` 是兩支不同元件,本次未深入核對 `AgentChat.tsx` 內部是否有機制把使用者接回 `/video` 座艙延續剛完成的創作專案。

**影響**：若 `AgentChat.tsx` 沒有承接剛剛生成的圖片/專案上下文,使用者做完第一張圖後的「預設下一步」會落到一個功能上獨立、可能感覺脫節的聊天頁,而非直接延續到分鏡/逐幕製作旗艦座艙——潛在的北極星流程斷點,但需要更深入核對 `AgentChat.tsx`（超出本次 App.tsx/路由/onboarding 稽核範圍)才能從 PLAUSIBLE 升級為 CONFIRMED。

**建議**：後續針對 `AgentChat.tsx` 與 `VideoCockpit` 的專案上下文銜接做專項深挖。

---

## 已驗證排除的疑慮（negative results）

1. **generate/evaluate tRPC 契約核對無誤**：`OnboardingFlow.tsx` 呼叫的 `trpc.generate.prepareJob`/`trpc.generate.multimodal`/`trpc.evaluate.suggestChips` 三支,逐欄核對 `server/routers/generate.ts:79-119`（`prepareJob` 回傳含 `jobId`,`:326`)、`:342-390`（`multimodal` 輸入 zod schema 與 `mode`/`vibeCardIds`/`temperature` 完全吻合)、`:1490`（回傳 `{ jobId, resultUrl, resultData, compiledPrompt, thoughtChain }`,與 `OnboardingFlow.tsx:219,229` 讀取的欄位一致)、`server/routers/evaluate.ts:169-206`（`suggestChips` 回傳 `chips` 陣列)——**無 contract-mismatch**。
2. **AidvShellChrome 的 6 支 tRPC procedure 全部存在**：`contextPacket.getLatest`/`contextPacket.compileProject`（`server/subsystems/contextPackets/contextPacketRouter.ts:45,69`)、`creativeProject.list`（`server/routers/creativeProject.ts:78`)、`credits.myBalance`（`server/routers/credits.ts:55`)、`agentPreferences.getPreferences`/`updatePreferences`（`server/routers/agentPreferencesRouter.ts:106-107`)、`directorPreferences.get`/`update`（`server/routers/directorPreferences.ts:8,20`)——皆存在且已在 `server/routers.ts` 掛載,無孤兒呼叫。
3. **VideoCockpitFrame 對 `DirectorAI.tsx` 的孤兒化是明確標註的設計取捨,不是隱性回歸**：`client/src/shells/video/VideoCockpitFrame.tsx:4-7,24-29` 註解直接寫明「/video 首頁與 /video/director 由導演座艙渲染,其餘 studio 子路由仍沿用 P0 re-home」——與發現 1（settings 富殼未加註明就悄悄砍掉 3 個既有頁面的大半功能)性質不同,不歸為本次新發現。其餘 8 個 video 子路由（create/studio/playground/animation/image/video/pro/light-orb)皆正確 re-home 原頁面元件,未發現額外孤兒。
4. **RBAC 前端隱藏非安全邊界,已正確標註且核實**：`client/src/shells/settings/rbac.ts:7-8,18-21` 的 `useRole()` 讀 `useAuth().user.role`（伺服器來源,非 localStorage/前端可竄改布林),且註解明確「前端放行 ≠ 後端放行」；`AdminPanel.tsx` 標題註解同樣強調「真正權限由後端 procedure 強制,前端僅 UX 隱藏」——未發現 client-security 邊界誤用。
5. **OnboardingFlow 分支 chip 導向的舊路徑非死連結**：`NEXT_STEP_CHIPS`（`OnboardingFlow.tsx:23-28`)導向 `/pro-studio`/`/video-studio`/`/director`,三者皆在 `LEGACY_REDIRECTS`（`shellRouteTable.ts:92,99,100`)裡有對應 4-shell 轉址,非孤兒/死路由；AIDV-836 的 `onBranchComplete` 單次導航（`OnboardingFlow.tsx:327-335`、`Home.tsx:1125-1131`)避免了 `/agent` 被多推進 history 的問題,程式邏輯正確。
6. **shellRouteContract.ts / shellRouteTable.ts / ShellRoutes.tsx 三檔路由條數合約邏輯自洽**：`expectedShellRouteCount()`（`shellRouteContract.ts:32-35`)與 `shellRoutes()`（`ShellRoutes.tsx:47-90`)的實作邏輯逐行比對一致（OFF→0 條、ON→`LEGACY_REDIRECTS.length + 8` 條)。本次僅讀碼比對,未實際執行對應測試套件（`AidvShellChrome.test.tsx`/`VideoShell.flag.test.tsx` 等)驗證執行期行為。
7. **learn/settings 富殼「既有深頁」子路由確實維持 parity**：`LearnShell.tsx:41-46`（`/learn/model-wishlist`、`/learn/my-brain`、`/learn/codex`、`/learn/teaching-archive`、`/learn/teams`、`/learn/feedback`)與 `SettingsShell.tsx:42-43`（`/settings/admin/api-usage`、`/settings/admin/brain-pipeline`)皆正確 re-home `@/app/lazyPages` 的原元件,未重寫——僅「首頁/index/admin/agent 這幾個索引頁」被替換成精簡版,不是全面替換。

---

## 附錄：發現與行號速查

| 嚴重度 | 標題 | 檔案:行號 | Cluster |
|---|---|---|---|
| 🔴 Critical | `/settings` 富殼孤兒化 AdminPage/AgentPreferencesPage/SettingsPage | shells/settings/SettingsShell.tsx:34-43；pages/AdminPage.tsx:61-74；pages/settings/AgentPreferencesPage.tsx:345-358；pages/SettingsPage.tsx:587-635 | dead-ui |
| 🔴 Critical | 唯一「重置引導」入口隨之不可達 | pages/SettingsPage.tsx:274-282,1293-1314；components/SiteOnboardingOverlay.tsx:480-497 | northstar-flow |
| 🟠 High | 引導完成訊號 localStorage/伺服器雙軌永久失聯 | components/OnboardingFlow.tsx:320,328,357；pages/Home.tsx:805；shells/AidvShellChrome.tsx:58-71；components/orb-agent/OrbOnboardingDialog.tsx:56,88,93-96 | contract-mismatch |
| 🟠 High | SiteOnboarding 22 個 targetId 多數指向不存在的 DOM 元素 | contexts/SiteOnboardingContext.tsx:86-354；components/SiteOnboardingOverlay.tsx:369-385 | uiux-defect |
| 🟠 High | ShellDisabled 承諾的「功能開關重新開啟」不存在 | shells/ShellFrame.tsx:21-33；shells/settings/admin/FeatureFlagsTab.tsx:28-34,58-72 | dead-ui |
| 🟡 Medium | `/social` 858 行已建功能無單瀏覽器預覽退路 | config/featureFlags.ts:60；pages/social/*.tsx | dead-ui |
| 🟡 Medium | 光球「重新導覽本頁」路徑表未跟上 4-shell 路徑 | components/DashboardLayout.tsx:734-759 | uiux-defect |
| 🟡 Medium(PLAUSIBLE) | 引導完成預設落點 `/agent` 而非 `/video` 旗艦座艙 | pages/Home.tsx:1121-1124；shells/VideoShell.tsx:1-15 | northstar-flow |
