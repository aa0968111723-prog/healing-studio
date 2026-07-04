# AX0 — 無障礙/行動地圖(鍵盤/ARIA/響應式/對比)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb

> 稽核範圍:前端 a11y(鍵盤/焦點)、螢幕閱讀器(ARIA/語意)、行動觸控/響應式、對比(僅標記需視覺驗證)。
> 所有發現皆先讀碼再判斷,無法從程式碼判定者一律標「需視覺驗證」,不臆測。
> 資料清理說明:輸入清單中有一筆 `file: a.ts / title: "test"` 的假發現(檔案不存在、無實際程式碼依據),已依規則 2(不臆測)剔除,不列入下方地圖,僅在附錄註記以利追蹤資料管線是否誤混入測試資料。

---

## 1. 依 Cluster 分節列問題

### 1.1 keyboard-focus(鍵盤/焦點管理)— 7 筆

| # | 嚴重度 | 標題 | 檔案:行號 | WCAG | 影響對象 | 建議 |
|---|---|---|---|---|---|---|
|1| high | AuthExpiredModal 全站登入過期彈窗完全自訂,零 role/aria-modal、無 Esc、無初始焦點/焦點歸還 | `client/src/components/AuthExpiredModal.tsx:73-162` | 2.1.1 / 4.1.2 / 2.4.3 | **所有使用者**(任何人 session 過期都會撞到) | 改用專案既有 Radix Dialog 包一層,取得內建 focus trap/Esc/aria-modal,關閉後把焦點還給觸發元素 |
|2| high | BatchGenerationDialog(DirectorAI 批次生成核心動作)完全自訂彈窗,零 Esc/焦點管理/ARIA | `client/src/components/director/BatchGenerationDialog.tsx:60-90` | 2.1.1 / 4.1.2 | DirectorAI 重度使用者(批次生成是核心操作) | 同上,改用共用 Dialog primitive |
|3| medium | AmbientOrb(座艙常駐光球)協作面板無 Esc 關閉,面板 DOM 順序在觸發 FAB 之前,Tab 順序反向;`design-kit/orb.tsx` 已有正確對照組未合流 | `client/src/shells/video/console/AmbientOrb.tsx:54-135` | 2.1.1 / 2.4.3 | VideoStudio 座艙鍵盤使用者 | 面板 DOM 移到 FAB 之後、加 Esc handler,或直接把已驗證過的 `design-kit/orb.tsx` 邏輯合流回來 |
|4| medium | ArticleDialog 主動 `onOpenAutoFocus` preventDefault 關閉 Radix 內建自動聚焦,未提供替代焦點管理 | `client/src/components/ArticleDialog.tsx:255-258` | 2.4.3 | 文章閱讀彈窗鍵盤使用者 | 移除 preventDefault,或手動 `useEffect` 聚焦到對話框內第一個可聚焦元素/標題 |
|5| medium | FeedbackDialog(光球快捷選單觸發,跨頁可能出現)完全自訂彈窗,零 Esc/ARIA/初始焦點 | `client/src/components/FeedbackDialog.tsx:154-176` | 2.1.1 / 4.1.2 | 全站任何頁面觸發回饋的使用者 | 同 #1,改用共用 Dialog primitive |
|6| medium | Y8 延伸確認:hover-only 刪除鈕缺 focus-visible 對應(鍵盤可聚焦但視覺不可見);同款式也出現在 NodeDetailSheet | `client/src/components/ProjectNotesDrawer.tsx:156-161`(NodeDetailSheet 同款需另核) | 2.4.7 | 鍵盤操作者(看不到焦點在哪) | 加 `focus-visible:opacity-100`,對比是否清楚**需視覺驗證** |
|7| medium | QuickSaveForm 標籤刪除用 `Badge(span)+onClick`,無 role/tabIndex/鍵盤 handler | `client/src/components/ProjectNotesDrawer.tsx:276-289` | 2.1.1 | 純鍵盤使用者(無法刪除已加標籤) | 改用 `<button type="button">` 或補 `role="button" tabIndex={0}` + `onKeyDown` (Enter/Space) |

### 1.2 aria-sr(螢幕閱讀器 / ARIA / 語意標籤)— 16 筆

| # | 嚴重度 | 標題 | 檔案:行號 | WCAG | 影響對象 | 建議 |
|---|---|---|---|---|---|---|
|8| high | GenerationControls 核心生成參數 Label 未與控制項用 htmlFor/id 綁定 | `client/src/components/GenerationControls.tsx:60-166` | 1.3.1 / 4.1.2 | 螢幕閱讀器使用者(不知道欄位對應哪個標籤) | 每個控制項補唯一 `id`,Label 補對應 `htmlFor` |
|9| high | ProgressivePromptBuilder 主要創作描述 Textarea 無 id/htmlFor/aria-label | `client/src/components/ProgressivePromptBuilder.tsx:1476-1509` | 1.3.1 / 4.1.2 | 螢幕閱讀器使用者(核心輸入框無名稱) | 補 `id`+`htmlFor`,或至少 `aria-label` |
|10| high | 全站光球 ProactiveOrbWidget 送出鈕 icon-only 完全無 aria-label/title | `client/src/components/ProactiveOrbWidget.tsx:3719-3729` | 4.1.2 | 全站所有頁面的螢幕閱讀器使用者 | 補 `aria-label="送出"`(或依語境) |
|11| high | Studio 共用 DrawerPanel 關閉鈕未把已傳入的 `title` prop 接上 aria-label | `client/src/pages/Studio.tsx:171-209` | 4.1.2 | 所有經由 DrawerPanel 開抽屜的頁面 | 關閉鈕加 `aria-label={title ? `關閉${title}` : "關閉"}` |
|12| high | ImageStudio 歷史書籤切換鈕無 aria-label/aria-pressed,且觸控區域僅約 20px | `client/src/pages/ImageStudio.tsx:1369-1390`(實測收藏/刪除鈕約在 1381-1389) | 4.1.2 / 2.5.8 | 螢幕閱讀器 + 觸控使用者 | 補 `aria-label`+`aria-pressed`,padding 加大到 44px 觸控區 |
|13| high | (延伸確認 FE-03)素材快捷鈕四處仍用字面 `hidden` class 永久 `display:none`,鍵盤/螢幕閱讀器皆不可達 | `client/src/pages/ImageStudio.tsx:4408-4414`(確認:`className="hidden flex items-center ..."`,`hidden` 與 `flex` 並列無斷點前綴,永久隱藏) | — | ImageStudio/ProStudio/VideoStudio/DirectorAI 全體使用者 | 見 1.3 系統性反模式 F |
|14| high | DirectorAI 兩處面板關閉鈕(快速生成管道/匯出腳本)icon-only 無 aria-label/title | `client/src/pages/DirectorAI.tsx:1323-1336, 1949-1962` | 4.1.2 | DirectorAI 螢幕閱讀器使用者 | 各補對應 `aria-label` |
|15| medium | ImageStudio 3D 模型選項三個 Switch+Label 缺 htmlFor/id(同庫 DirectorAI/ProStudio 有正確對照組) | `client/src/pages/ImageStudio.tsx:2593-2597, 2750-2754, 2795-2799` | 1.3.1 / 4.1.2 | 螢幕閱讀器使用者 | 比照 DirectorAI/ProStudio 既有正確寫法補上 |
|16| medium | Studio 左抽屜 MiniAssetsPanel/MiniModelsPanel 載入骨架無 `role=status`/`aria-live` | `client/src/pages/Studio.tsx:3712-3725, 3820-3828` | 4.1.3 | 螢幕閱讀器使用者(不知道正在載入) | 骨架容器加 `role="status" aria-live="polite"` + 視覺隱藏文字「載入中」 |
|17| medium | (延伸確認 Y8)刪除鈕除 hover-only 外還完全缺 aria-label,且觸控區域僅約 22px(`p-1`+`w-3.5 h-3.5` icon) | `client/src/components/ProjectNotesDrawer.tsx:156-161` | 4.1.2 / 2.5.8 | 螢幕閱讀器 + 觸控使用者 | 補 `aria-label="刪除筆記"`,padding 加大 |
|18| medium | (延伸確認 Y5)22 個導覽步驟中 15 個 targetId 在 DOM 查無對應 id,spotlight 靜默退化 | `client/src/contexts/SiteOnboardingContext.tsx:71-639` | — | 使用新手導覽的所有使用者(尤其螢幕閱讀器,退化後只剩全螢幕變暗、無語意錨點) | 見 1.3 系統性反模式 H |
|19| medium | ImageStudio 新手提示卡關閉鈕無名稱,且觸控區域僅約 22px | `client/src/pages/ImageStudio.tsx:842-865` | 4.1.2 / 2.5.8 | 螢幕閱讀器 + 觸控使用者 | 補 `aria-label="關閉提示"`,加大觸控區 |
|20| high | Studio.tsx 工具箱鈕與創作模式 TabsTrigger 用 `hidden sm:inline` 藏文字卻無 aria-label/title 兜底,手機可及名稱消失且觸控高度 <44px | `client/src/pages/Studio.tsx:2429-2443, 2704-2716` | 4.1.2 / 2.5.5 | 手機版 Studio 使用者(名稱與觸控雙重問題) | 文字隱藏時補 `aria-label`,按鈕高度提升到 44px |
|21| low | design-kit PersonaSwitch/MemoryDBTabs 使用 `radiogroup`/`tablist` ARIA role 但未實作方向鍵導覽,語意與鍵盤行為不一致 | `client/src/components/design-kit/cockpit.tsx:59-73, 139-154` | 4.1.2 | 螢幕閱讀器 + 鍵盤使用者(角色宣稱可用方向鍵卻不能) | 補 `ArrowLeft/Right` 切換邏輯,或改用不承諾方向鍵行為的 role |
|22| low | SocialCockpit 品牌色票用非互動 `div`+`title` 呈現,螢幕閱讀器普遍讀不到 | `client/src/pages/social/SocialCockpitPage.tsx:152-156` | — | 螢幕閱讀器使用者 | 補 `aria-label`(含色票名稱/色碼);色票本身對比**需視覺驗證** |
|23| low | 清除全部歷史鈕僅靠 `title` 作為 accessible name 後備,無顯式 aria-label | `client/src/pages/ImageStudio.tsx:1345-1357` | 4.1.2 | 螢幕閱讀器使用者(title 的可及名稱支援度不穩定) | 補顯式 `aria-label` |
|24| low | DirectorAI 關閉面板鈕僅靠 `title`,無顯式 aria-label,觸控區域約 22px | `client/src/pages/DirectorAI.tsx:1798-1805` | 4.1.2 / 2.5.8 | 螢幕閱讀器 + 觸控使用者 | 同上補 aria-label,加大觸控區 |

### 1.3 responsive-touch(行動/觸控)— 10 筆

| # | 嚴重度 | 標題 | 檔案:行號 | WCAG | 影響對象 | 建議 |
|---|---|---|---|---|---|---|
|25| high | ProjectNotesDrawer/AssetsQuickDrawer 用固定 `w-[380px] sm:w-[420px]` 覆寫共用 Sheet 的 `w-3/4` 響應式安全網,手機(<640px)無 max-width 兜底,320-375px 機型內容裁切 | `client/src/components/ProjectNotesDrawer.tsx:337-340` | 1.4.10 | 小尺寸手機(iPhone SE 等)使用者 | 移除固定 `w-[380px]`,改回繼承 Sheet 預設或加 `max-w-[calc(100vw-2rem)]` |
|26| high | AssetsQuickDrawer 同款寬度覆寫 bug,目前被 FE-03 的 `hidden` 擋住不可達,但移除 hidden 後會立刻暴露此溢出問題 | `client/src/components/AssetsQuickDrawer.tsx:173-176` | 1.4.10 | 未來 FE-03 修復後的全體使用者(隱藏 bug,一修 FE-03 就會炸出來) | 與 #25 同批修,避免修完 FE-03 後產生新的視覺回歸 |
|27| high | AmbientOrb(座艙常駐光球)全檔零響應式類別/零 useIsMobile,面板固定 `w-64`/`w-72` 無 vw 兜底,且與 CockpitColumns 手機底部分頁列在同一水平帶重疊(**需視覺驗證**重疊實況) | `client/src/shells/video/console/AmbientOrb.tsx:60-134` | — | VideoStudio 座艙手機使用者 | 補 `useIsMobile` 分支,面板寬度改 `w-[min(16rem,90vw)]` 之類,並確認與底部導覽列的 z-index/位置關係 |
|28| high | FocusFlowMini 刪除想法鈕 hover-only,`opacity-0 group-hover:opacity-100` 無 focus-visible/isMobile 任何替代,鑲嵌於手機專用光球面板內,功能性不可用 | `client/src/components/FocusFlowMini.tsx:279-285` | 2.4.7 / 2.5.5 | 手機使用者(無 hover 能力)+ 鍵盤使用者 | 加 `focus-visible:opacity-100`,並在 `isMobile` 時直接 `opacity-100`(注:此按鈕本身觸控區已達 44px、已有 aria-label,問題純粹在可見性觸發條件) |
|29| high | QuickFeedbackButton 全站浮動回饋鈕:FAB `size-10`(40px)<44px 觸控標準,面板 `w-80` 固定寬無視窗兜底,零響應式,全站掛載 | `client/src/components/QuickFeedbackButton.tsx:150-167` | 2.5.5 | 全站所有手機使用者 | FAB 改 `size-11`(44px),面板寬度加 `max-w-[calc(100vw-2rem)]` |
|30| high | ImageStudio 生成結果卡與姿勢圖卡「查看全尺寸」動作僅存在 hover overlay,無恆常可見的觸控替代按鈕 | `client/src/pages/ImageStudio.tsx:989-1017 / 1163-1194` | — | 手機使用者(無 hover,功能不可達) | 加一個常駐的小圖示按鈕(如角落放大鏡 icon)取代純 hover overlay |
|31| medium | `ui/button.tsx` `size="sm"` 缺少 `size="lg"` 已有的 44px 手機底線 pattern,導致多頁行動圖示鈕系統性固定卡在 32px | `client/src/components/ui/button.tsx:25-28`(確認:`sm: "h-8 ..."` 無 `min-h`,對照 `lg: "min-h-[44px] h-11 ... md:min-h-0 md:h-10"`) | 2.5.5 | 全站所有用到 `size="sm"`/`size="icon-sm"` 圖示鈕的手機使用者 | 見 1.3 系統性反模式 D |
|32| medium | MultimodalSuggestCard 與 QuickFeedbackButton 共用近乎相同的 `fixed bottom-24 right-4/5` 定位,同頁顯示會重疊(**需視覺驗證**實際重疊畫面) | `client/src/components/orb-agent/MultimodalSuggestCard.tsx:30` | — | 同時觸發兩者的手機使用者 | 統一一個「右下角浮動元件」佇列/堆疊管理機制,避免各自寫死座標 |
|33| low | AnimationStudio 全頁 0 useIsMobile(S4 已完整記錄,本次未發現額外新細節,存查參照) | `client/src/pages/AnimationStudio.tsx:5996-6076` | — | AnimationStudio 手機使用者 | 併入既有 S4 mobile-first 修復計畫,不重複開票 |

其中 AnimationStudio 刪除世界觀按鈕 icon-only 缺 aria-label(`AnimationStudio.tsx:5999-6076`,header 全部 32px 按鈕高度)歸類為 aria-sr,已併入 1.2 節建議一併修(與 #31 的 32px 問題同源,見系統性反模式 D)。

### 1.4 semantics(語意標籤)— 1 筆

| # | 嚴重度 | 標題 | 檔案:行號 | 影響對象 | 建議 |
|---|---|---|---|---|---|
|34| low | MiniAssetsPanel 資產列有 `cursor-pointer` 視覺樣式但無任何 onClick/role/鍵盤互動 | `client/src/pages/Studio.tsx:3748-3773` | 所有使用者(視覺暗示可點但點了沒反應,屬「假可互動」) | 補實際 onClick,或移除 `cursor-pointer` 視覺暗示 |

### 1.5 other(暫難歸類 / 流程性問題)— 3 筆

| # | 嚴重度 | 標題 | 檔案:行號 | 影響對象 | 建議 |
|---|---|---|---|---|---|
|35| medium | Y5 已知延伸確認:SiteOnboarding 21 個導覽步驟中僅 7 個 targetId 在程式碼中實際存在,其餘退化成無指向的全螢幕變暗 | `client/src/contexts/SiteOnboardingContext.tsx:86-629` | 使用新手導覽的所有使用者 | 見系統性反模式 H |
|36| low | SiteOnboarding 背景遮罩 DarkBackdrop 傳入空 onClick,滑鼠點擊無反應(視覺上看似可點但無等效行為) | `client/src/components/SiteOnboardingOverlay.tsx:101-108, 454-455` | 想點擊遮罩跳出導覽的使用者 | 補實際關閉邏輯,或移除看似可點的視覺提示 |

---

## 2. 系統性反模式(統一修法優先於逐檔修補)

| 反模式 | 涉及發現 | 統一修法(共用元件層一次修) |
|---|---|---|
| **A. 手刻 Modal 取代共用 Dialog primitive** — 完全自訂 `fixed inset-0` 彈窗,零 role/aria-modal/Esc/焦點管理 | #1 AuthExpiredModal、#2 BatchGenerationDialog、#5 FeedbackDialog | 三者都改用專案已有的 Radix-based Dialog(`ArticleDialog.tsx` 已示範用法,只是自己又犯了 #4 反例)。一次把 focus trap / Esc / `aria-modal` 拿回來,不用逐檔手刻。 |
| **B. icon-only 按鈕系統性缺 aria-label** — 只靠 icon 或 `title` 屬性當可及名稱 | #10 ProactiveOrbWidget(全站)、#11 DrawerPanel(Studio)、#12/#23 ImageStudio、#14/#24 DirectorAI、AnimationStudio 刪除鈕 | 建立/推廣共用 `IconButton` 包裝元件,TypeScript 型別上把 `aria-label` 設為必填 prop(非 optional),或加 ESLint `jsx-a11y` 規則擋 icon-only `<button>` 缺 aria-label 的 PR。 |
| **C. hover-only 操作缺 focus-visible 替代** — `opacity-0 group-hover:opacity-100` 沒有對應的鍵盤可見狀態 | #6/#17 ProjectNotesDrawer 刪除鈕(Y8)、#28 FocusFlowMini 刪除鈕 | 在 Tailwind 全域 utility 或共用 class 中,凡是 `group-hover:opacity-100` 一律搭配 `group-focus-within:opacity-100` 或 `focus-visible:opacity-100`,並在手機( `isMobile` )時直接常駐可見。建議做一個 `hover-reveal` 共用 class 取代各檔各自寫。 |
| **D. 固定像素觸控目標系統性 <44px** — `button.tsx` `size="sm"`(32px)、`icon-sm` 等 variant 沒有手機底線 | #12、#19、#20、#24、#29(FAB)、#31、AnimationStudio 32px 按鈕 | 比照 `size="lg"` 已有的 `min-h-[44px] ... md:min-h-0 md:h-10` pattern,把同樣的手機底線邏輯套到 `sm`/`icon`/`icon-sm` variant(`<640px` 時強制 44px,桌面可縮回)。這是**一次改 `ui/button.tsx` 就能修全站多處**的最高槓桿修法。 |
| **E. 抽屜/浮動面板固定像素寬,無響應式兜底** — `w-[380px]`、`w-64`、`w-72`、`w-80` 覆寫或缺共用 Sheet 的響應式安全網 | #25 ProjectNotesDrawer、#26 AssetsQuickDrawer、#27 AmbientOrb、#29 QuickFeedbackButton 面板 | 禁止各檔自行覆寫 Sheet 寬度為固定 px;改用共用 `max-w-[calc(100vw-2rem)]` 或 `clamp()` utility,或直接不覆寫、沿用共用 Sheet 元件原生的 `w-3/4` 響應式邏輯。 |
| **F. `hidden` class 與 `flex` 並列造成永久隱藏(FE-03)** — `className="hidden flex ..."` 缺斷點前綴,`hidden` 恆勝出 | #13、#26(間接) | 全域搜尋 `"hidden flex"` / `"hidden inline"` 等並列且無 `sm:`/`md:` 前綴的寫法(即字面 Tailwind class 衝突),改成 `hidden sm:flex` 或用 state 控制顯示,而非兩個互斥 display class 硬湊在一起。 |
| **G. Label 未綁定 htmlFor/id** | #8 GenerationControls、#9 ProgressivePromptBuilder、#15 ImageStudio 3D 開關 | 建立共用 `FormField`/`LabeledSwitch` 元件,內部自動產生唯一 `id` 並接上 `htmlFor`,新表單直接用元件而非裸 `<Label>`+`<Input>`。DirectorAI/ProStudio 已有正確用法可直接抄。 |
| **H. Onboarding tour targetId 與 DOM 嚴重失聯(Y5)** | #18、#35 | 非單純程式碼修補,建議加一支簡單的建置期/CI 檢查腳本,對 `SiteOnboardingContext.tsx` 定義的每個 `targetId` 掃描 codebase 確認對應 `id="..."` 仍存在,避免元件重構後 tour 步驟悄悄失效。 |

---

## 3. 北極星:行動創作者可用性(對照 S4)

以「手機使用者能否走完一條龍(選素材 → 調參數 → 生成 → 查看結果 → 收藏/管理)」為標準檢視本次發現:

- **素材抽屜(FE-03)**:ImageStudio/ProStudio/VideoStudio/DirectorAI 四處素材快捷鈕永久 `hidden`,`AssetsQuickDrawer` 全站不可達(#13)。這是**流程斷點**——不分手機或桌面,只要走「用素材生成」這條路就卡住,且 `AssetsQuickDrawer` 本身還藏著寬度溢出的隱藏 bug(#26),意味著即使先修好可達性,寬度問題會立刻在小尺寸手機上炸出來,兩者需**同批修**才算真的把這條路打通。
- **抽屜裁切**:ProjectNotesDrawer 固定 `w-[380px]` 在 320-375px 機型上疑似裁切內容(#25,需視覺驗證確認實際裁切程度)。
- **座艙(VideoStudio)重疊**:AmbientOrb 完全零響應式,面板可能與手機底部分頁列重疊(#27,需視覺驗證),加上協作面板無 Esc、Tab 順序反向(#3),VideoStudio 手機端的座艙操作體驗风险高。
- **浮動元件打架**:QuickFeedbackButton 與 MultimodalSuggestCard 用幾乎相同座標 `fixed bottom-24 right-4/5`,同頁顯示疑似互相遮擋(#32,需視覺驗證),且 QuickFeedbackButton 本身 FAB 40px 未達 44px 標準(#29)。
- **查看結果**:生成結果卡「查看全尺寸」僅 hover 可用,手機上這個動作直接消失(#30)——對照 S4 已記錄的 mobile-first 缺口,這是同一類「桌面優先設計,手機降級到不可用」的重複模式,而非新類別問題。

**結論**:與 S4 既有分析一致——手機使用者在多個關鍵節點(素材存取、抽屜寬度、座艙面板、hover-only 動作)會撞牆或體驗劣化,目前尚不能穩定走完一條龍。FE-03 是其中最直接的「完全擋死」,其餘多屬「可用但體驗打折/有溢出風險」。

---

## 4. 需視覺驗證清單(對比/實際渲染重疊,無法只靠讀碼判定)

| 項目 | 檔案:行號 | 待驗證內容 |
|---|---|---|
| Y8 刪除鈕 focus-visible 對比 | `ProjectNotesDrawer.tsx:156-161` | 加上 focus-visible 樣式後,焦點框與背景對比是否達標 |
| ProjectNotesDrawer 固定寬度裁切 | `ProjectNotesDrawer.tsx:337-340` | 320-375px 機型實機/模擬器截圖確認內容是否真的被裁切 |
| AssetsQuickDrawer 同款寬度 bug | `AssetsQuickDrawer.tsx:173-176` | 移除 FE-03 hidden 後的實際渲染溢出情況 |
| AmbientOrb 與底部分頁列重疊 | `AmbientOrb.tsx:60-134` | 手機視窗下面板與 CockpitColumns 底部導覽列是否視覺重疊/z-index 衝突 |
| SocialCockpit 品牌色票對比 | `SocialCockpitPage.tsx:152-156` | 色票本身文字/邊界對比是否符合 WCAG AA(此發現目前只判定「螢幕閱讀器讀不到」,對比需另外實測) |
| MultimodalSuggestCard × QuickFeedbackButton 重疊 | `MultimodalSuggestCard.tsx:30` | 兩元件同頁觸發時的實際畫面是否重疊/互相擋住可點擊區域 |

---

## 5. 給 Bruce:a11y 最該先修的 3 條

1. **FE-03 素材快捷鈕 `hidden` class(#13)——最易修、影響最廣**。四個核心創作頁(ImageStudio/ProStudio/VideoStudio/DirectorAI)的素材抽屜全部被字面 `hidden` class 擋死,幾乎是一行 class 改動(移除或改成正確斷點前綴)就能讓全站使用者重新拿回「用素材生成」這條路。但務必同批處理 `AssetsQuickDrawer` 藏著的寬度溢出 bug(#26),否則修完可達性馬上會冒出新的手機版裁切問題。

2. **自訂彈窗缺 Esc/焦點管理/ARIA(#1 AuthExpiredModal、#2 BatchGenerationDialog、#5 FeedbackDialog)——影響最多使用者的鍵盤/螢幕閱讀器可用性**。AuthExpiredModal 尤其關鍵,因為「登入過期」是幾乎每個使用者都會遇到的情境,目前鍵盤使用者可能被困在裡面出不去。三者屬同一反模式,改用專案已有的 Radix Dialog 一次修完,不必逐檔手刻。

3. **icon-only 按鈕系統性缺 aria-label(#10 全站光球、#11 DrawerPanel、#14 DirectorAI 等)——影響所有螢幕閱讀器使用者且遍布多頁**。建議在共用 `IconButton`/`Button` 層級把 `aria-label` 設為必填,並搭配 ESLint 規則擋新 PR 繼續產生同類問題,一次性堵住這個持續在擴散的洞。

(加碼快速修:hover-only 刪除鈕缺 `focus-visible:opacity-100`,#6/#17/#28,改一行 class 即可讓鍵盤使用者看得到焦點,CP 值極高,可與上述任一項一起順手修掉。)

---

### 附錄:資料清理記錄
- 輸入清單中一筆 `{"file": "a.ts", "title": "test", ...}` 因檔案不存在且無實際程式碼佐證,依規則「不臆測、不確定寫需視覺驗證」剔除,未列入本地圖統計。建議檢查上游 finding 收集管線為何會混入此類測試/佔位資料。
