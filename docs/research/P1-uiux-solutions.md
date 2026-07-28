# P1 — UIUX 解法設計(方案設計 wave P)

- 產生日期:2026-07-03
- 依據 commit:`91117649`(`docs(research): M0 北極星對齊藍圖(方案設計 wave M 彙整)+ PROGRESS`)
- 性質:**深度研究 wave P**——把 `C-uiux.md` 診斷出的缺陷,設計成「貼合創作本質」的修法 + 設計系統收斂方案。本文件只做**方案設計**,不落地實作(無 Edit/Write 到 `client/src`、`server/`)。
- 依據來源:`docs/research/C-uiux.md`(診斷本體)、`00-overview.md`(品牌 token 勘誤,index.css AIDV-74)、`M0-solution-blueprint.md`(七支柱北極星)、`L1-fields-audio-studio.md`/`L2-fields-learn.md`/`L3-fields-settings-admin.md`/`L4-fields-spine-global.md`(死欄位/死開關地毯掃描)、`00-summary.md` §6 R18(死開關/死欄位風險登記)
- 追加查證(本次為寫方案而補讀的程式碼,超出 C-uiux 原始引用範圍):
  - `client/src/hooks/useMobile.tsx`(viewport meta 寫入邏輯全文)
  - `client/src/components/ui/loading-card.tsx`、`empty-state.tsx`、`error-state.tsx`(現成骨架元件實作)
  - `client/src/shells/_shared/PanelState.tsx`(**這就是題目提到的「PanelState」**——已存在的載入/空/錯誤三態共用元件,含 `ENABLE_AIDV_CHROME` 旗標下切換 design-kit 版本的邏輯)
  - `client/src/index.css`(`--chart-1..5` token 已定義為黏土/蜜金/苔綠/藍/紫五色)
  - `client/src/pages/DashboardPage.tsx`(硬編碼 `#818cf8` 等 7 色圖表色現況)
  - `client/src/pages/AssetsLibrary.tsx`(`getInitialSection()` 死碼現況與意圖註解)
  - `client/src/pages/ImageStudio.tsx`/`ProStudio.tsx`/`DirectorAI.tsx`(`className="hidden"` 死 UI 精確行號)

---

## 0. 設計總原則(貫穿六張解法卡)

北極星本質(`M0-solution-blueprint.md` §1 七支柱)裡與 UIUX 直接相關的三句:

> ④ 單一專案:腳本→分鏡→逐幕(字卡+圖影+聲音)→拼接→輸出→打包
> ⑥ 一步步引導、不跑偏
> ⑦ 素材管理 + 目標管理 + 達最終成品

UIUX 缺陷修復不是「把介面修漂亮」,而是**讓創作者在操作當下,始終看得見「我剛剛做的東西在哪裡、現在系統在幹嘛、下一步是什麼」**——這正是①②③三組缺陷(結果動線、loading/empty/error、假成功)的共同病灶;④⑤⑥兩組(死開關、設計系統)是地基層面的「說到做到」問題。六張卡的因果順序建議:**先止血信任(2、4)→ 再補骨架(3)→ 再清理死碼(5)→ 最後收斂系統(6)→ a11y(1)貫穿全程但可獨立並行**,因為 1 是純加法、零依賴,可隨時插隊。

---

## 解法卡 1:A11y 速修

### 1-A viewport 禁縮放(WCAG 1.4.4)

- **現況**:`hooks/useMobile.tsx` 的 `useViewMode()` 在 mount 與每次切換時,行動模式一律把 `<meta name="viewport">` 寫成 `"width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover"`(:51、:64);桌面模式寫 `"width=1280, initial-scale=0.35"`(:50、:63)。`maximum-scale=1.0` 直接關閉捏合縮放,WCAG 1.4.4(Resize Text)不合格;`initial-scale=0.35` 讓桌面模式初始縮成 35%,同樣影響可讀性。
- **貼合本質哪一句**:「創作者要能看得清楚自己在做什麼」——連文字都看不清就無從審視生成結果,是最底層的可用性,不是裝飾性 a11y。
- **改法(檔案級)**:`client/src/hooks/useMobile.tsx:47-52、60-66` 兩處 `content` 字串,行動模式改為 `"width=device-width, initial-scale=1.0, viewport-fit=cover"`(移除 `maximum-scale=1.0`);桌面模式的 `initial-scale=0.35` 建議重新評估——若原意是「在手機上模擬桌面版縮小預覽」,改用 CSS `zoom`/`transform: scale()` 包一層容器,而非動 viewport,避免整頁縮放影響原生手勢與螢幕閱讀器聚焦框。
- **工作量**:S(一行字串修改 + 桌面分支需 1 次人工驗證跨裝置手感,不需後端/資料改動)。
- **優先級**:高。

### 1-B 行動 icon-only 按鈕無 aria-label

- **現況**:`DirectorAI.tsx:4485-4520` 起,行動版把「模板/對話紀錄/儲存」文字縮成空字串只留 icon(`{isMobile ? "" : "模板"}`),按鈕本身無 `aria-label`;同 pattern 在其他頁(ProStudio.tsx 工具列、AnimationStudio.tsx header)重複出現。
- **貼合本質哪一句**:「一步步引導、不跑偏」——螢幕閱讀器使用者連按鈕語意都聽不到,等於引導鏈斷在第一步。
- **改法(檔案級)**:在每個 `{isMobile ? "" : "文字"}` 的按鈕上补 `aria-label={isMobile ? "文字" : undefined}`(文字永遠存在於 aria-label,只是視覺上行動版隱藏)。具體目標:`DirectorAI.tsx:4485-4520`(模板/對話紀錄/儲存三顆)+ 全站掃描同 pattern(`grep -rn 'isMobile ? "" :' client/src/pages`)逐一補上,預估波及 ProStudio/AnimationStudio 各數顆。
- **工作量**:S(純加屬性,可寫一支 codemod/ESLint 規則防回歸:偵測 `isMobile ? "" :` 模式且無同層 `aria-label` 時警告)。
- **優先級**:高。

### 1-C 生成圖 0 alt

- **現況**:C-uiux §5.2 A4 量測 DirectorAI 0、ProStudio 0、VideoStudio 僅 1 個 alt;本次追加查證,生成結果圖多半經由共用元件渲染(如 `shells/video/canvas/CompletionCanvas.tsx:90、166`、`ShotDetailCanvas.tsx:124`、`ShotPanel.tsx:128`),而非頁面內直寫 `<img>`——代表**只要修對共用元件,一次修復可覆蓋多頁**,不需逐頁分別補。
- **貼合本質哪一句**:「生成的東西回到專案/回到那一幕」的前提是「這個東西本身要能被感知到」——對 SR 使用者而言,無 alt 的生成圖等於那一幕不存在。
- **改法(檔案級)**:
  1. 共用渲染點`CompletionCanvas.tsx`/`ShotDetailCanvas.tsx`/`ShotPanel.tsx` 補 `alt={prompt?.slice(0, 40) ?? "生成結果圖"}`(prompt 前 40 字,無 prompt 時給通用描述,而非空字串)。
  2. 各創作頁若有獨立渲染路徑(需逐頁 `grep "<img"` 二次確認,因為部分頁面可能透過 `background-image` CSS 呈現,無法用 `alt`,需額外補 `role="img" aria-label`)。
- **工作量**:M(共用元件修 3-4 處是 S,但需逐頁二次掃描確認有無獨立渲染路徑,合計抓 M)。
- **優先級**:高。

### 1-D 44px 觸控目標

- **現況**:全站 `min-h-[44px]` 類標記僅 11 處,幾乎全在 `ImageStudio.tsx:4386-4410`;`AnimationStudio.tsx` header 一排 `h-8`(32px)按鈕(:5999-6074,含「返回導演 AI」等),各頁大量 `size="sm"` 密排按鈕低於建議值。
- **貼合本質哪一句**:五大創作頁是創作者行動裝置上最常操作的地方,觸控失準直接打斷「一步步」的操作節奏。
- **改法(檔案級)**:把 ImageStudio 已驗證的 `min-h-[44px]` 規則(4386-4410)抽成共用 class(如 `.hs-touch-target` 或直接在 `Button` 元件的 `size="sm"` 於 `isMobile` 時提升 padding),推廣到 `AnimationStudio.tsx:5999-6074` 的 `h-8` 按鈕群與 DirectorAI/ProStudio header 按鈕列。
- **工作量**:M(需要跨頁抽共用規則,且要驗證窄版面是否因加高而擠壓)。
- **優先級**:中(比 1-A/1-B/1-C 影響範圍窄,且 ImageStudio 已有模範可抄,风险與工作量都可控)。

**卡 1 小結工作量合計**:S+S+M+M ≈ 中偏低,四項皆可獨立並行、互不阻塞,建議一次 PR 全部處理(同屬「a11y 速修」批次)。

---

## 解法卡 2:結果動線修復(最貼本質)

### 現況

三個斷點共同構成「東西去哪了」的迷路體驗:

1. **Studio 結果進背景抽屜,不進專案**:`Studio.tsx` 全頁 0 個空狀態文案(grep「尚未/還沒」=0)、`resultUrl` 是死欄位(01-features:74)——按下生成後結果只會出現在全域 `BackgroundTasksDrawer`,頁面本身沒有可視進度錨點,更沒有「這個結果屬於哪個專案/哪一幕」的歸屬顯示。
2. **素材庫抽屜鈕 hidden**:`ImageStudio.tsx:4408-4414`(素材鈕本身 `className="hidden flex ..."` 衝突 class)、`ImageStudio.tsx:4460-4461`(「模型細膩導覽」整段 hidden)、`ProStudio.tsx:4747-4753、4813-4814`(同款)、`DirectorAI.tsx:4525`(儲存鈕旁一顆隱藏按鈕)——這些鈕原本應該是「生成完後去哪裡看/回哪裡去」的出口,現在整顆消失。
3. **`/assets?section=` 聚合死碼**:`AssetsLibrary.tsx` 的 `getInitialSection()` 恆回傳 `"assets"`(:241-244),註解寫明「2026-05:入口統一為『數位資產庫』單頁,不再讓使用者在此頁切換到其他子頁」——這是**有意的簡化決策**,但沒有同步處理舊路由:`/vault`、`/history`、`/background-tasks`、`/prompt-library`、`/prompt-collection` 全部 `→/assets?section=…` 轉向(00-overview §3.3),使用者從舊書籤/舊連結進來,`section` 參數被完全忽略,永遠落在預設「我的資產」分頁,實際上是「資訊架構層的迷路」而非單純死碼。

### 貼合本質哪一句

M0 §2 一條龍藍圖:「**串接鑰匙:全線以 `creativeProjectId` 為唯一主鍵貫穿**」+ 00-summary §2.2「**結果動線斷裂是最便宜的修復標的**」——這是全案「單一專案:腳本→分鏡→逐幕→…→輸出」七支柱裡最現成、成本最低卻杠杆最大的一環:不需要新建资料模型,只需要把已有的 `creativeProjectId`/`section` 參數接回 UI。

### 改法(檔案級,分三軌並行)

**軌 A:Studio 頁內結果錨點(呼應卡 3 的骨架件)**
- 復用現成 `LoadingCard`/`PanelState`(`shells/_shared/PanelState.tsx`)在 `Studio.tsx` 送出生成後,頁內插入一張「生成中/已完成」任務卡(可直接訂閱 `BackgroundTasksContext` 現有資料,不需新 API),卡片上帶「這是第 X 幕/這個專案」的歸屬標籤與「查看/回到那一幕」按鈕。
- 目標檔案:`client/src/pages/Studio.tsx`(送出區塊,約 :2429-2506 工具箱鄰近處)、消費既有 `BackgroundTasksContext`。

**軌 B:素材庫抽屜鈕解 hidden**
- `ImageStudio.tsx:4408-4414` 移除 `hidden` 且修正 `hidden flex` 衝突 class,改為依旗標或條件顯示(若鈕背後功能未完成,先降級為「查看素材庫」導向 `/assets?section=...`,而非整顆藏起來)。
- `ImageStudio.tsx:4460-4461`、`ProStudio.tsx:4747-4753、4813-4814`、`DirectorAI.tsx:4525` 同款处理:逐一判斷「功能已完整→解 hidden 上线」或「功能未完成→改成 feature flag 控制并在 PR 描述註明原因」,禁止用 `className="hidden"` 當長期擱置手段(呼應卡 5 死開關清理的同一原則)。

**軌 C:`/assets?section=` 真的接回**
- 兩個可行方向擇一(建議 A):
  - **A(建議,成本低)**:`getInitialSection()` 改為讀取 `section` query param 並映射到 `AssetsLibrary` 現有的 `sourceFilter`/`typeFilter`/`tab` 狀態(例如 `?section=prompts` → 自動套用 `sourceFilter` 篩「提示詞」來源、`?section=vault` → 篩「Vault」來源),讓舊書籤使用者落地後**看到的就是他原本要找的子集**,而非空手落在預設頁。同時在頁面頂端加一次性 `EmptyState`/banner 提示「提示詞庫已整合進資產庫,以下是符合的資產」,解釋為什麼畫面變了。
  - **B(工作量大,不建議短期做)**:恢復獨立子頁面板,與「2026-05 統一單頁」決策衝突,除非團隊確認要撤回該決策。
- 目標檔案:`client/src/pages/AssetsLibrary.tsx:241-244` 起的 `getInitialSection`/`SectionId` 邏輯 + 篩選 state 初始化段落。

### 工作量

軌 A:M(需接 BackgroundTasksContext 並設計歸屬標籤 UI,但不用新建後端)。
軌 B:S(移除 class + 條件判斷,逐鈕約 0.5 天)。
軌 C:M(映射邏輯 + banner 文案,需與产品对齐「舊 section 對應哪個篩選值」的映射表)。

**合計:M**(三軌可並行,互不阻塞,建議各自獨立 PR)。

### 優先級

高(00-summary 列為第 1 波「結果動線修復」;三個子問題都是使用者實際會撞到的迷路點,而非潛在風险)。

---

## 解法卡 3:loading/empty/error 態補齊

### 現況

五大創作頁(DirectorAI/Studio/ImageStudio/VideoStudio/ProStudio)全部 0 個 Skeleton,首屏載入是空白或閃現;Studio 額外 0 個空狀態文案。與此同時,**現成骨架件其實已經很完整**,只是採用率低:

- `components/ui/loading-card.tsx`——`LoadingCard`,`role="status" aria-busy` + sr-only 文案,視覺對齊 `.glass-card-static`。
- `components/ui/empty-state.tsx`——`EmptyState`,含 icon/title/description/action/secondaryAction,`ambient` 光暈背景。
- `components/ui/error-state.tsx`——`ErrorState`,`role="alert" aria-live="polite"`,含重試鈕與可展開錯誤細節。
- `shells/_shared/PanelState.tsx`——**這正是題目講的「PanelState」**:`PanelLoading`/`PanelEmpty`/`PanelError` 三支函式,已內建 a11y 語意(load=status+aria-busy、empty=status、error=alert),且已設計好 `ENABLE_AIDV_CHROME` 旗標分支(旗標 ON 時自動切換成 design-kit 亮色暖光版本,OFF 時退回 shadow shadcn 版本,零視覺風險)。

但目前 `LoadingCard`/`EmptyState`/`ErrorState`/`PanelState` 的實際採用者集中在:`shells/video/panels/{Notes,Assets}Panel.tsx`、`shells/video/canvas/AssetGenCanvas.tsx`、`shells/learn/panels/ResearchPanel.tsx`、`PromptCollectionPage.tsx`、`LangSmithPage.tsx`——都是**次要面板**,五大主創作頁完全沒接。相较之下,AssetsLibrary(14 個 Skeleton)、AdminPage(12 個)反而是骨架分佈最密的頁——優先序完全顛倒:最常用的創作頁反而最空。

### 貼合本質哪一句

「一步步引導、不跑偏」——載入態不明確時,創作者會誤以为按鈕沒反應而重複點擊(進而可能觸發 R1/R12 這類雙重扣款/重複提交風險,見 00-summary §6);空狀態沒有引導文案時,新手不知道第一步該做什麼,直接卡在「這頁到底要我幹嘛」。

### 改法(檔案級,逐頁套用既有元件,不新建元件)

| 頁面 | Loading 現況→改法 | Empty 現況→改法 | Error 現況→改法 |
|---|---|---|---|
| `DirectorAI.tsx` | 僅 spinner/toast → 首屏骨架區改用 `<LoadingCard lines={4} />` × 2-3 張(對話串/模板庫載入態) | 無空狀態文案 → 首次進頁無對話紀錄時用 `<EmptyState title="開始你的第一段對話" action={{label:"從模板開始", onClick:...}} />` | 沿用既有 toast,batch 生成鏈失敗時額外用 `PanelError`(compact)嵌入 GenerationProgressPanel |
| `Studio.tsx` | 0 Loader2/0 Skeleton → 送出區塊改用 `<LoadingCard />`(呼應卡 2 軌 A 的任務卡) | 0 空狀態(grep「尚未/還沒」=0) → 首次進頁用 `<EmptyState title="還沒有生成紀錄" description="選一個模態,填入提示詞開始創作" />` | 生成失敗時用 `PanelError` 附重試 |
| `ImageStudio.tsx` | isLoading 僅 1 處 → 歷史面板輪詢區補 `<LoadingCard />` | 已有部分,核對是否覆蓋所有分頁 | 沿用既有 toast,webhook 逾時態補 `PanelError` |
| `VideoStudio.tsx` | 51 isLoading/27 Loader2(已是互動最完整頁,主要缺**首屏骨架**)→ 首次載入模型清單時補 `<LoadingCard />` | 已有 7 處空狀態文案,可作範本 | 已有 role=alert banner,維持現狀 |
| `ProStudio.tsx` | 0 skeleton → 7 tab 切換時的內容載入補 `<LoadingCard />` | 無 → 各 tab 首次進入補 `<EmptyState />`(如音樂 tab「選一個模型開始」) | 已有 FAL key 雙層告警(banner),可保留,額外用 `PanelError` 統一非 key 類錯誤 |

**實作策略**:不要求逐頁重新設計,而是**建一份「五大創作頁骨架件套用檢查清單」**(哪個 loading 分支用 LoadingCard、哪個 empty 分支用 EmptyState、哪個 error 分支用 ErrorState/PanelError),按頁拆 5 張小 PR,每頁工作量可控且互不阻塞,並在 PR 描述引用本卡作為設計依據。

### 工作量

單頁 S-M(每頁 0.5-1.5 天,取決於該頁 loading/empty 分支數量);五頁合計 M-L,但因元件已現成、無需新建,且可拆 5 個獨立 PR 平行進行,團隊實際體感是「M」。

### 優先級

高(00-summary 第 1 波「viewport 禁縮放一行修 + 五大創作頁補 skeleton(套現成 LoadingCard)」明列為信任止血項目)。

---

## 解法卡 4:假成功 UI 清理

### 現況(四個信任損耗點,prod 皆可達或高風險可達)

1. **mock 發佈**:`.env.production` 設 `VITE_SHELL_SOCIAL=1`,social shell 線上 ON;`SocialPublishPage.tsx:74、193` 走 mock adapter,UI 直接把「(mock permalink)」當成功結果顯示,無任何「演示模式」告示。
2. **光球演示頁**:`LightOrbCreationStudio.tsx:222-238`(`buildTimeline`)整頁假時間軸播「記記:已存到素材庫」「已預扣點數」台詞,頁面上沒有任何「這是示範」的視覺標示,創作者會誤信東西真的存了/發了。
3. **ProStudio UI 說謊(兩處)**:TTS 分頁標示引擎「AudioLDM 2」實際路由 mmaudio(01-features:122);TTS `speed` 滑桿——本次深讀 `L1-fields-audio-studio.md` §1.3 更正:**不是「滑桿調了不送後端」,而是「滑桿本身沒有渲染 UI」**(`speed` state 僅供光球 `getState/setParam` 讀寫,人類使用者連控制項都看不到)。這代表 C-uiux 原始描述需要修正一個字:不是「參數 UI 存在但無效」,而是「該參數根本沒有 UI,只是被誤植進文件」——真正需要清理的「UI 說謊」只剩 AudioLDM2 標籤這一處是**貨真價實**的說謊。
4. **座艙假上傳**:`VideoCockpit` 確認門卡(`ConfirmGate`)的「上傳參考照」按鈕無任何 `<input type="file">`或拖放區,純 `onClick` 觸發樂觀 state 變更把角色標記為「精準+四鎖全開」,`vault.update` 因 id 型別不符幾乎必然跳過回寫(L1 §4.2)——使用者以為已上傳,實際檔案從未經手。

### 貼合本質哪一句

00-summary §2.3「**信任損耗點要先止血**」——這四項是**唯一會讓創作者對整個系統失去信任**的類別:功能不完整可以忍,但「系统告诉我做到了、其實沒做到」會讓創作者開始怀疑所有其他頁面的真實性,是負面外溢效應最大的一類。

### 改法(檔案級,依嚴重度分兩批)

**批次一:標示(S,先止血,不動邏輯)**
- `SocialPublishPage.tsx:74、193`:mock permalink 结果卡加醒目 badge「⚠ 示範發佈(尚未真正發佈到社群平台)」,而非讓「(mock permalink)」字串本身充當唯一提示。
- `LightOrbCreationStudio.tsx`:整頁頂部加持久顯示的「🎬 示範模式」banner(呼應 C-uiux 建議「更適合掛 onboarding 流程並加示範模式 banner」),`buildTimeline`(:222-238)的台詞維持不變但周邊視覺明確降級為「demo」語境。
- `ProStudio.tsx` TTS 分頁:「AudioLDM 2」標籤改為「音效引擎(mmaudio)」或直接顯示真實供應商名稱,與音樂/音效 tab 既有「不暴露 fal-ai/... 原始 id 但用誠實中文名」的全站慣例一致。
- `VideoCockpit` ConfirmGate:「上傳參考照」按鈕若短期不做真上傳,先改文案為「標記已核對(暫不支援上傳)」或直接补 file input 走最小實作(見批次二)。

**批次二:修正(M,視資源決定是否本階段做)**
- `VideoCockpit` 上傳鈕補齊真實 `<input type="file">` + `vault.update` id 型別修正,讓「上傳參考照」名實相符(這屬於 K 系列 bug 範疇,可與資安/資料層 PR 並案)。
- 若 social shell 短期無法做真發佈,評估 00-summary 建議的「prod 關 SHELL_SOCIAL」作为替代方案(產品決策,非纯 UI 改動)。

### 工作量

批次一:S(純文案+badge,4 處合計 1-2 天)。
批次二:M(需動邏輯與型別,建議跟既有 K 系列 bug 修復排在一起)。

### 優先級

高(批次一)/中(批次二,因為批次一已能止血多數信任損耗,批次二是治本但可稍後排)。

---

## 解法卡 5:死開關/死欄位清理(L1-L4 彙總,對應 00-summary R18)

### 現況(依「刪」或「接」分類彙總,不逐條重複 L1-L4 已列的所有項目,只列決策)

**A. Studio「閃電/深度精確」模式(`mode`)—— 建議「刪」**
- `Studio.tsx` 共用按鈕×2(閃電/深度精確)寫入 `mode` state,zod 有收但 `submitMultimodalAsync` 函式體 0 處讀取(L1 §2.2、§2.3-4)——全 Studio 最顯眼卻完全不影響生成結果的死開關。唯一會用 `mode` 的是 Studio 未使用的另一支同步端點 `generate.multimodal`。
- **決策**:若產品線確定 async 路徑才是唯一使用中路徑(L1 §2.1 已確認),直接刪除 UI 按鈕與 `mode` state;若打算未来接回「深度精確」語意(例如切換 gemini_flash/gemini_pro),則需先讓 `submitMultimodalAsync` 讀取 `input.mode` 並真的分流模型,否則刪除是唯一誠實選項。**建議刪**,因為「假裝有兩檔精細度」比「只有一檔」更傷創作者信任(呼應卡 4 的同一原則)。

**B. 音樂歌詞/能量強度(Studio 音樂模態)—— 建議「接」**
- `AudioWorkspace` 有完整 UI(歌詞 Textarea、0-100 能量滑桿),但 `submitMultimodalAsync` zod **從未定義** `lyrics`/`audioEnergy`(L1 §2.3-2)——且 `mutationInput` 死物件本身也証明這是「算兩次只用一次」而非單純遺漏。
- **決策**:建議「接」而非刪,因為歌詞是音樂生成的核心創作輸入,刪除會直接砍掉一個創作能力;接的成本是後端 zod 補欄位 + falInput 組裝補讀取,前端已有 UI 不用改。與卡 6 的資料層規則呼應:**與其清理死物件本身,不如先修「為何 mutationInput 算了兩次只用一次」的根因**(`Studio.tsx:1574-1618` 附近的送出邏輯重構)。

**C. ProStudio TTS `speed`—— 建議「刪」該死狀態或明確定義為 agent-only**
- 見卡 4 更正:`speed` state 無 UI、無 zod 對應欄,僅光球可寫。若光球確實需要這個「agent-only 隱藏參數」來源(例如未來語音精修流程),建議明確重新命名並加註解「此欄僅供 Orb agent-bridge 使用,人類 UI 無對應控制項」防止未來開發者誤以為漏接 UI 而浪費時間排查;若光球也用不到,直接刪除。

**D. VideoCockpit codec/provider 裝飾欄—— 建議「刪或改標示」**
- 編碼(codec)選項 UI 自承「目前僅作專案標註,不影響實際生成輸出」(L1 §4.1)——這種**誠實的裝飾欄**比 A 卡的無聲裝飾好,但仍建議之後補上「(暫未生效)」的 inline 標籤讓沒讀過程式碼的使用者也知道。
- 成本階梯 Provider 選擇按鈕×4(hf/gemini/fal/mock)不進 `submitStudioJob` payload(L1 §4.5)——選擇對實際生成/計費零影響,純心理暗示數字。**建議刪**:若 provider 真的不能由使用者選,顯示一個假的選擇 UI 只會製造「我選了 fal 結果算到 mock」的困惑,不如顯示唯讀的「目前引擎:X」文字。

**E. LoRA 訓練精靈 4/10 類別必炸(concept/product/fashion/pose_lora)—— 建議「接」(緊急)**
- `selectedTrainingType` 10 選項中 4 個在 `models.create` zod `modelType` enum 不存在(L4 §2.1),選了走完 4 步驟送出必 400——比一般死欄位嚴重,因为這是**使用者實際會走到底才發現失敗**的死路,不是靜默無效。
- **決策**:短期先在卡片選擇階段(第 1 步)disable 這 4 個類別並標「即將支援」,長期後端補 zod enum 或前端砍掉這 4 個選項——兩者擇一即可,但**disable 遠比讓使用者走 4 步才炸緊急**。同批處理 batchSize 滑桿 UI 1-16 vs zod 1-8 的範圍矛盾(收窄 UI 上限到 8)。

**F. Settings 19 個頂層死欄位(uiTheme/accentColor/fontScale/…)—— 建議「刪」**
- `system_settings` 表與 `settings.update` zod 都有完整定義與 DB default,但 `PersonalSettingsContext.encodeServerPayload()` 從未觸碰,全站也無第二處寫入路徑(L3 §1.1)——這是「比隱藏能力更嚴重」的完全零呼叫欄位。
- **決策**:若無近期產品計畫要做主題色/字級縮放等功能,建議直接標記這 19 欄為 deprecated 並從 zod 移除(或至少加 `@deprecated` 註解防止未來誤用),避免下一個開發者以為「這欄位有前端在用」而浪費時間排查。

**G. 其餘 L1-L4 已列但非緊急項**:ModelsPage 隱藏 `pageTab="forge"` 分頁繞過同意書(屬 K/合規範疇,不只是 UIUX 死碼,建議與 00-summary R8 一併處理,非本卡範圍)、`OrbGuidePanel.panelMode` 無 setter 恆 "unified" 的死碼分支(建議直接刪除 `panelMode==="guide"` 相關判斷式與其專屬 UI)、`notes.create` 的 `meetingUrl` 全站 4 處建立表單皆無 UI(建議挑一個最常用入口,如 CalendarPage 的 QuickScheduleForm,補上此欄)。

### 貼合本質哪一句

「一步步引導、不跑偏」的資料層根基——M0 §6 講「資料層(機械強制)…禁止猜最新一筆」,死開關/死欄位是同一種問題的鏡像:**介面在說謊,說「這裡有一個選擇」,但系統從不兌現**。清理死開關和补齊真實功能,都是同一件事:讓 UI 和系統行為對齊。

### 工作量

A/C/D:S(多數是刪除幾顆按鈕/state,單項 0.5-1 天)。
B:M(需要後端 zod 補欄位 + falInput 讀取邏輯,前端維持不變)。
E:S(短期 disable)/M(長期後端補 enum)。
F:S(標記 deprecated)。

**合計:S-M**,建議按 A/C/D/F(純前端刪除,可快速批次處理)與 B/E(涉及後端改動,需排進功能真實化波次)兩批分開排程。

### 優先級

E 高(使用者會真的撞到 400 錯誤,屬於 00-summary 第 1 波「功能真實化」範疇);A/C/D/F 中(清理維護債,不影響當下功能,但持續累積會讓下一輪 UIUX 稽核越來越難分辨真假);B 中(有創作價值但非緊急)。

---

## 解法卡 6:設計系統收斂

### 現況(四個並存問題)

1. **token 採用率低**:`text-[10px]/[9px]` 任意值 pages 內 724 處,而 index.css:60-70 專門建的 `text-2xs/3xs` token 僅 97 處被使用——回收率不到 15%。
2. **硬編碼 hex**:pages 另有 71 處硬編碼 hex,集中 `DashboardPage.tsx:103-109`(`MODALITY_COLORS` 物件 7 色如 `#818cf8`)、SettingsPage、LangSmithPage、AdminApiUsagePage、LightOrb——本次追加查證確認 **`--chart-1..5` token 已在 index.css:115-119 定義好對應的黏土/蜜金/苔綠/藍/紫五色**,`DashboardPage.tsx` 完全沒理由不用現成 token,是最現成的一組低垂果實。
3. **`glass-card` 定義完整但幾乎沒人用**:index.css 花 80+ 行維護,pages+shells 僅 16 處使用,各頁改用 ad-hoc `bg-card/40`、`bg-background/70`、`bg-muted/30` 各自調透明度。
4. **雙 toast/雙確認 Dialog**:`AidvShellChrome` 自帶 design-kit `ToastProvider/Toasts` 與全域 sonner `Toaster` 並存;原生 `window.confirm()` 散佈 8 頁(AnimationStudio/DirectorAI/AgentChat/LearnHub/ModelWishlistPage/PromptLibrary/PromptCollection/CalendarPage)與其他處的 Radix `AlertDialog` 並存。

### 貼合本質哪一句

00-summary §2.2「UIUX 好範式已存在但分佈不均」——設計系統本身的治理密度其實很高(token 命名、深色模式雙重防護、動效節制都做得好,見 C-uiux §2.1),**問題不是缺系統,是系統沒被回收**。收斂的本質是「讓創作者在每一頁看到的都是同一套視覺語言」,信任感也包含「這個介面看起來是同一個產品做的」。

### 改法(檔案級,依機械化程度分三批)

**批次一:圖表色收斂(最快見效)**
- `DashboardPage.tsx:103-109` 的 `MODALITY_COLORS` 物件,7 色直接改引用 `var(--chart-1)`~`var(--chart-5)`(5 色不夠 7 個 modality 時,補 2 色到 index.css 的 `--chart-*` 序列或做取模循环使用)。
- 裝飾漸層收斂:ImageStudio header(violet/purple,4371)、VideoStudio 結果播放器(blue/purple,≈205)、CreationHub/VideoCockpit(emerald 硬編碼)全部改用 `--brand-clay`/`--gold`/`--teal` 或既有 `--ok` token。
- **工作量**:S(純值替換,無邏輯改動,可寫簡單 codemod 抓 `#[0-9a-fA-F]{6}` 逐一核對替換)。

**批次二:`text-[10px]/[9px]` codemod**
- 724 處中,先篩出「必讀資訊」(如按鈕文字、狀態標籤)vs「純裝飾小字」(如版本號、時間戳),制定規則:**必讀資訊禁用 10px 以下,一律用 `text-2xs`(10px 實際渲染但走 token 管理)或更大**;純裝飾允許保留但仍建議走 token 便於未來統一調整。
- 可先寫一支 codemod(`scripts/codemod-text-size.ts` 類)機械替換 `text-[10px]`→`text-2xs`、`text-[9px]`→`text-3xs`(需先確認 index.css:60-70 的 `text-2xs/3xs` 實際 px 值與現有 arbitrary value 一致,若不一致需先對齊 token 定義本身)。
- **工作量**:M(724 處雖多但可高比例自動化,人工只需抽查有無破版,抓 3-5 天)。

**批次三:glass-card / 雙 toast / 雙確認 Dialog 決策(治理決策,非纯技術替换)**
- **glass-card**:建議產品/設計拍板「頁面卡片一律 `glass-card-static`,或乾脆刪掉 glass 系只留現有 surface token(`bg-card/40` 等)」二選一,而非放任並存——本卡建議前者(採用),因为 glass 系已投入 80+ 行維護且 VideoCockpit/console 已驗證视觉效果,砍掉等於浪費已完成的工。決策後才進行逐頁替換(工作量隨決策方向差異大,估 M-L)。
- **雙 toast**:sonner 是全域預設(`App.tsx:446`),design-kit `Toasts`(`AidvShellChrome.tsx:164、218`)若只在 chrome demo 用途,建議移除該份 Provider,統一走 sonner(S)。
- **雙確認 Dialog**:8 頁 `window.confirm()` 全部替換為既有 `AlertDialog` pattern(`AssetsLibrary.tsx`/`CalendarPage.tsx`/`CreativeProjectPage.tsx`/`LoraTrainer.tsx` 已有可抄範本),逐頁替換無需新建元件(S 每頁,合計 M)。

### 工作量

批次一:S(1-2 天,立即可做)。
批次二:M(3-5 天,需先定規則再自動化)。
批次三:玻璃卡決策後 M-L(視決策方向)+ toast 收斂 S + confirm 替換 M ≈ 合計 M-L。

**卡 6 總工作量:M-L**,建議批次一立即做(低成本高一致性收益),批次二/三排入中優先(00-summary 第 1-2 波之間)。

### 優先級

批次一高、批次二中、批次三中(其中雙確認 Dialog 因為散佈使用者可見的刪除操作,一致性问题比 glass-card 更容易被使用者感知,可提前做)。

---

## 排序總表(高/中/低優先 × 影響)

| 優先級 | 解法卡/子項 | 影響面 | 工作量 | 是否需後端配合 |
|---|---|---|---|---|
| **高** | 1-A viewport 禁縮放 | 全站行動使用者可讀性(WCAG 1.4.4) | S | 否 |
| **高** | 1-B 行動 icon-only aria-label | 行動 SR 使用者 | S | 否 |
| **高** | 1-C 生成圖 alt | 生成內容對 SR 可感知性 | M | 否 |
| **高** | 卡2 軌B 素材庫抽屜解 hidden | 結果動線信任 | S | 否 |
| **高** | 卡2 軌A Studio 頁內結果錨點 | 「東西去哪了」核心體驗 | M | 部分(接既有 Context) |
| **高** | 卡2 軌C `/assets?section=` 接回 | 舊書籤使用者迷路 | M | 否(前端映射) |
| **高** | 卡3 五大創作頁 loading/empty 補齊 | 首屏體感、重複點擊風險 | M | 否 |
| **高** | 卡4 批次一 假成功標示 | 全域信任(prod 可達) | S | 否 |
| **高** | 卡5-E LoRA 4 類別必炸 | 使用者實際撞到 400 | S(短期)/M(長期) | 短期否/長期是 |
| **中** | 1-D 44px 觸控目標推廣 | 行動裝置誤觸 | M | 否 |
| **中** | 卡4 批次二 假上傳修正 | 資料真實性 | M | 是 |
| **中** | 卡5-A/C/D 死開關刪除 | 維護債、認知欺騙 | S | 否(A/D)/需確認(C) |
| **中** | 卡5-B 音樂歌詞/能量接線 | 創作能力真實化 | M | 是 |
| **中** | 卡5-F Settings 19 死欄位標記 | 維護債 | S | 否 |
| **中** | 卡6 批次一 圖表色/裝飾漸層收斂 | 視覺一致性 | S | 否 |
| **中** | 卡6 批次三 雙確認 Dialog 收斂 | 使用者可感知一致性 | M | 否 |
| **中** | 卡6 批次二 text-[10px] codemod | 長尾一致性/可讀性 | M | 否 |
| **低** | 卡6 批次三 glass-card 決策 | 視覺一致性(需先決策) | M-L | 否(純前端) |
| **低** | 卡6 批次三 雙 toast 收斂 | 視覺一致性 | S | 否 |
| **低** | 卡5-G forge 分頁/panelMode 死碼/meetingUrl | 維護債(forge 另涉合規,見下) | S | 部分 |

---

## 未查證/待補聲明

1. **本文件為方案設計,未做任何程式碼落地驗證**——所有「改法」的可行性建立在 C-uiux.md/L1-L4 的靜態掃描結論上,未重新跑測試或畫面截圖比對。
2. **1-C 生成圖 alt**:只確認了 `shells/video/canvas/{CompletionCanvas,ShotDetailCanvas}.tsx`、`shells/video/panels/ShotPanel.tsx` 三處共用渲染點有 `<img>`;DirectorAI/ProStudio 頁面內是否還有其他獨立渲染路徑(例如透過 CSS `background-image`,無法用 `alt` 需改 `role="img"`)未逐頁二次掃描,列為 M 工作量的原因之一。
3. **卡5-B(Studio 音樂歌詞/能量)**:「接」的決策假設产品仍要保留歌詞輸入能力;若产品端已判定音樂模態近期不做歌詞驅動生成,則應改為「刪 UI」而非「接後端」——此為需要與 Bruce/產品側二次確認的分岔點。
4. **卡5-C(TTS speed)**:是否光球實際有消費這個 agent-only state 尚未追蹤到具體呼叫鏈(`getState/setParam` 的呼叫端),若確認光球從未真的讀寫過,建議直接歸類為卡5-G 一併刪除,而非保留為「agent-only」特例。
5. **卡6 批次三 glass-card 去留**:本卡建議「採用 glass-card-static 為主」,但這是設計決策不是技術判斷,需要視覺設計側(可能與 Home 三情境主題、`.login-cosmic` carve-out 等既有「刻意雙氛圍」設計並存考量)拍板才能執行,本文件僅提供選項與工作量估算。
6. **1-A 桌面模式 `initial-scale=0.35` 的原始設計意圖**:程式碼與註解都沒有說明為何桌面版要縮小到 35% 顯示,只能推測是「手機瀏覽器模擬桌面版預覽」用途;改法段落給的替代方案(CSS zoom/transform)未經實測驗證是否能達到相同效果,需要團隊在真實裝置上比對兩種方案的手感(呼應 C-uiux §8 待補項「實際手感…需團隊 15–20 人實測回饋」)。
7. **全案待補共通項**(沿用 C-uiux §8、00-summary §4.4):動效體感、光球 FPS、行動裝置實測、審改迴圈實際發生頻率——本文件的優先級排序仍以「靜態可判定的信任損耗/使用者迷路點」為主要依據,實測數據回來後可能需要微調排序。
