# C — UIUX 規劃與優缺點(Phase 2-C,本案重點文件)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`
- 方法:單一代理逐檔實讀前端程式碼(頁面 JSX、`index.css`、design-kit、layout/hooks),輔以全站 pattern 掃描(aria/斷點/skeleton/硬編碼色票/觸控目標計數);共同依據為 `00-overview.md`(路由表)、`01-features.md`(各頁現況與 §7 非完整項目)、`02-fullstack.md`(接線)
- 勘誤沿用:prod `.env.production` 設 `VITE_SHELL_SOCIAL=1`,social 四頁**線上可達**(含 mock 發佈)
- **判定範圍聲明**:本文件以程式碼可靜態判定的項目為準——排版結構、狀態分支存在與否、token 使用、斷點與 aria 屬性。**「實際手感、動效體感、載入速度感、光球干擾度」屬待補項,需團隊 15–20 人實測回饋**(見 §8)。

---

## 1. Design Token 查證(以程式碼為準,重要勘誤)

### 1.1 背景宣稱的品牌 token 與 repo 實際不符

| 背景宣稱 | repo 實際(真實來源 `client/src/index.css`) | 證據 |
|---|---|---|
| navy `#16223B`(底色) | **暖米白 `#F4EEE4`**(`--background`);深色模式為夜空 `oklch(0.18 0.012 280)` | index.css:95、:309 |
| coral `#EF6A4E`(主色) | **黏土/珊瑚橘 `#C2613F`**(`--primary` = `--brand-clay`;亮階 `--clay-bright #D5734D`) | index.css:101、:233 |
| amber `#F2B24A` | **蜜金 `#C8922F`**(`--gold`;亮階 `--gold-bright #E0AC4A`) | index.css:236 |
| mint `#8FE3CB` | **teal `#3E9D94`**(`--teal`;soft 階 `--teal-soft #A9DAD3`) | index.css:238 |
| 字型 Fraunces/Manrope | **主字 = Noto Sans TC / Inter**(`--font-sans`,index.css:59);**Fraunces 只做 serif 顯示字**(`--font-serif`,index.css:258);**Manrope 全 repo 0 出現** | index.html:56(Google Fonts 載入 Noto Sans TC/Inter/Fraunces/Noto Serif TC/IBM Plex Mono) |

全 repo grep `16223B|EF6A4E|F2B24A|8FE3CB|Manrope` 僅 0 hits(Fraunces 有)。**結論:背景給的品牌 hex 是概念稿值,不是落地值;文件與設計溝通一律以「亮色暖光.黏土/蜜金」(Wave U / AIDV-74,rev L1,index.css:88-260)為準。**

### 1.2 token 體系現況(三層並存)

1. **shadcn 語意層**(index.css:88-216):`--background/--primary/--card…` + `.dark` 完整覆蓋(:308-373)、`.login-cosmic` carve-out 保留舊 Zen 燕麥登入識別(:262-286)。
2. **AIDV 平台母題層**(index.css:227-305):`--clay/--gold/--teal/--ok/--warn/--bad/--info` + tint 系、人格三色 `--persona-*`、暖色陰影、`--ease/--t` 動效,經 `@theme inline` 曝成 `bg-clay/text-gold` utility(:288-305)。
3. **版面/字級治理層**:`--page-max-w-narrow/default/wide/studio` 四檔頁寬(:150-153)+ `.page-shell-*` utility(:454-462、2996-3035);`hs-h1/h2/h3/h3-lg/p/small` 響應式字級(:2874-2975);`page-header/page-title/page-subtitle`(:3041+);CJK 專用 `text-2xs/3xs`、`tracking-cjk-*`(:67-77);`--bp-mobile 768px` 與 `useIsMobile` 對齊(:161-166,hooks/useMobile.tsx:6)。

`components/design-kit/tokens.ts` 只放程式常數(provider 標籤、GateState、低積分門檻),檔頭明言「色彩 token 的真實來源是 CSS 變數」(tokens.ts:1-3)——與 CSS 單一真相源一致,設計正確。

### 1.3 `docs/design-reference.md` 已過時

該文件(2026-06-03)記錄的是舊「Zen 暖燕麥」token(主色 `#50453D`、強調淡紫 hue 300),**與現行主色 clay `#C2613F` 不符**;其中自我警示「強調色淡紫 vs 首頁青藍光球不一致」的問題,在 Wave U 換膚後又疊了第三套 clay/gold——**深色模式的 `--primary` 仍是淡紫 `oklch(0.85 0.03 300)`(index.css:315),與亮色 clay 不同色相**,屬有意的雙氛圍設計但文件沒更新說明。

---

## 2. 全站橫斷面:優點 / 缺點

### 2.1 優點(附證據)

1. **token 治理密度高、有勘誤紀錄文化**:radius 標度修正註解(index.css:11-15)、`--muted-foreground` 標 WCAG AA 校驗(:106-107)、`--text-on-glass-strong/soft` 玻璃面專用驗證色(:189-191)、頁寬四檔取代 ad-hoc `max-w-*`(:143-153)。
2. **深色模式三重防護**:`.dark` 語意變數全覆蓋(:308-373)+ `glass-card`/`zen-glass-card` 皆有 `.dark` 變體(:521-568)+ **cascade 層級外的 `.dark .bg-white/…` `.dark .bg-gray-50/…` 全域 remap**(:4528-4630+),把頁面殘留的硬編碼白/灰底一次矯正——線上深色不至於破版。
3. **動效節制有系統**:全域 `MotionConfig reducedMotion="user"`(App.tsx:426);index.css 至少 7 處 `prefers-reduced-motion` 區塊(899、1443、2406、2453-2465(glass-card 專用)、3306、3531、4511);LightOrb 頁用 `useReducedMotion`(LightOrbCreationStudio.tsx:16);hover 效果包在 `@media (hover: hover)` 內避免觸控誤觸(:852-888)。
4. **頁面骨架標準件已成形**:`PageHeader`(components/layout/PageHeader.tsx)、`.page-shell-*`、`hs-h*` 字級、`LoadingCard`(role=status + aria-busy + sr-only 文案,components/ui/loading-card.tsx:24-52)、`NextStepPanel`、`OutputSpecSelector` 等,DirectorAI/ImageStudio/ProStudio/AnimationStudio/AdminPage/LearnHub/AssetsLibrary 都已採用 page-shell/page-title 系。
5. **模型術語對創作者友善**:五大 studio 的模型清單以中文名+「bestFor/tip/advantages」呈現(VideoStudio.tsx:4522-4553 之 VIDEO_MODELS),**select 不直接暴露 `fal-ai/...` 原始 id**;模型上游故障時 inline 顯示「將自動使用 X 代替」而非鎖死按鈕(VideoStudio.tsx:186-200、579-600);「API 路徑已隱藏——技術細節對一般用戶無意義」有明確設計註解(VideoStudio.tsx:601)。
6. **三檔視覺密度(beginner/standard/professional)**:`lib/visualDensity.ts` + `shouldShowAdvanced/shouldShowDiagnostics`,五大創作頁全部消費(DirectorAI/AnimationStudio/VideoStudio/ImageStudio/ProStudio)——新手模式收起進階參數,是認知負荷分層的正確骨架。
7. **錯誤引導有「下一步」**:空提示詞不只擋路,toast 附「讓代理幫我寫」直接開光球預填(lib/emptyPromptHelper.ts);FAL key 未設有 `role="alert"` 的 actionable banner(VideoStudio.tsx:615-640;ProStudio.tsx:4754-4787)。
8. **VideoCockpit 是四態範本**:loading/error(含重試鈕)/empty(未選專案)/empty(空專案)/success 五分支各有插畫級文案與行動按鈕(shells/video/VideoCockpit.tsx:63-174)。
9. **Toast 全站統一走 sonner + token 換膚**(components/ui/sonner.tsx:10-36,success/warn/error 用 zen 色 token,跟主題連動)。
10. **鍵盤動線基礎在**:全域 `SkipToContent`(components/SkipToContent.tsx,App.tsx:445)、`:focus-visible` 柔紫 ring 且小螢幕加粗到 3px(index.css:409-419)、⌘K CommandPalette(role=dialog/listbox/option,design-kit/chrome.tsx:387-400)。
11. **殼層導航 a11y 完整**:Rail/MobileNav/AccountMenu/ProviderSwitcher 均有 `aria-label/aria-current/role=menu|radiogroup|menuitemradio`(design-kit/chrome.tsx:143-443);登出出口三處並存的設計決策有註解防回歸(AidvShellChrome.tsx:76-78)。

### 2.2 缺點(附證據)

1. **`text-[10px]/[9px]` 任意值氾濫 vs token 採用率低**:pages 內 724 處 arbitrary 小字 vs `text-2xs/3xs` token 僅 97 處——index.css:60-70 專門為此建了 token 卻大多沒回收;9-10px CJK 小字同時是**對比/可讀性疑慮源**(§6)。
2. **`glass-card` 定義完整但幾乎沒人用**:index.css 花 80+ 行維護 glass 系(:487-579、2453-2465),但 pages+shells 僅 16 處使用,集中在 VideoCockpit/console 與 loading-card;各頁實際用 ad-hoc `bg-card/40`、`bg-background/70`、`bg-muted/30`——同為「玻璃面」卻各自調透明度,視覺一致性靠巧合。
3. **`.dark .bg-white` 全域 remap 是症狀而非治癒**:cascade hack 存在本身(index.css:4526-4630+)證明頁面層硬編碼 `bg-white/bg-gray-*` 廣泛;pages 另有 71 處硬編碼 hex,集中 DashboardPage 圖表色(`#818cf8` 等 7 色,DashboardPage.tsx:103-109,**未用現成 `--chart-1..5`**)、SettingsPage、LangSmithPage、AdminApiUsagePage、LightOrb。
4. **標題階層錯亂(雙 h1)**:DirectorAI 同頁兩個 `<h1>`(PageHeader 內建 h1「導演 AI」DirectorAI.tsx:4439-4441 + 第二個 `<h1 className="hs-h2">導演 AI</h1>` :4471);AnimationStudio 把 `<h1>世界觀系統</h1>` 巢在 PageHeader 的 `secondaryActions` 槽裡(AnimationStudio.tsx:5990-6011,header 裡有兩個同名標題);Studio 頁級標題用 `hs-h3-lg`(卡片字級)(Studio.tsx:2417);AgentChat 全頁 0 個 h1-h3。
5. **skeleton 分佈極不均**:AssetsLibrary 14、AdminPage 12、Playground 5;**五大創作頁 DirectorAI/Studio/ImageStudio/VideoStudio/ProStudio 全部 0 個 Skeleton**(僅 spinner/toast/`animate-pulse` 塊,Studio.tsx:3721),首屏載入是空白或閃現;`LoadingCard` 標準件做好了但創作頁沒接。
6. **原生 `window.confirm()` 刪除確認散佈 8 頁**(AnimationStudio.tsx:6069、DirectorAI、AgentChat、LearnHub、ModelWishlistPage、PromptLibrary/Collection、CalendarPage)——與其他處的 Radix AlertDialog 並存,視覺斷裂且不可主題化。
7. **`hidden` class 留死 UI**:素材庫抽屜鈕與「模型細膩導覽」整段以 `className="hidden"` 留在 JSX(ImageStudio.tsx:4408-4414、4460-4461;ProStudio.tsx:4747-4753、4813-4814;DirectorAI.tsx:4525),其中 ImageStudio 的素材鈕還寫成 `hidden flex` 衝突 class——增加維護混淆,應改旗標或刪除(呼應 01-features §7 死碼清單)。
8. **行動版 icon-only 按鈕無可及名稱**:DirectorAI 行動版把「模板/對話紀錄/儲存」文字縮成空字串只剩 icon(`{isMobile ? "" : "模板"}`,DirectorAI.tsx:4485-4520)且**無 aria-label**——盲用與觸控辨識雙輸。
9. **prod 可達的「假成功」介面**:SHELL_SOCIAL 線上 ON,SocialPublish 走 mock adapter,UI 直接把「(mock permalink)」當成功結果顯示(social/SocialPublishPage.tsx:74、193);LightOrbCreationStudio 整頁假時間軸還播「記記:已存到素材庫」台詞(LightOrbCreationStudio.tsx:222-238 buildTimeline)而**頁面上沒有任何「演示模式」告示**——創作者會以為東西真的存了/發了,是信任層級的 UX 缺陷。
10. **觸控目標治理只到 ImageStudio**:全站 `min-h-[44px]` 類標記僅 11 處(幾乎都在 ImageStudio.tsx:4386-4410);AnimationStudio header 一排 `h-8`(32px)按鈕(:5999-6074)、各頁大量 `size="sm"` 密排按鈕,行動觸控低於 44px 建議值。
11. **`useIsMobile` 覆蓋率低**:僅 6 頁+chrome 使用(DirectorAI/Home/History/Assets/SharedSpace/Studio);其餘頁面純靠 `sm:/md:/lg:`,而 CreationHub/VideoCockpitFrame 兩個入口頁 0 個斷點 class(CreationHub 靠 max-w-3xl 單欄自然響應,可接受但無行動優化)。
12. **serif 顯示字(Fraunces)只活在 design-kit**:pages 內 `font-serif` 0 處——花了字型載入成本(index.html:56)但頁面標題全是 sans,「標題質感」的設計意圖(index.css:257)未落到頁面。
13. **雙 chrome/雙 toast 並存**:AidvShellChrome(預設 ON)自帶 design-kit `ToastProvider/Toasts`(AidvShellChrome.tsx:164、218)與全域 sonner `Toaster`(App.tsx:446)並存兩套通知視覺;AppleDock 舊軌仍在(01-features §6),密度/風格雙標準。

---

## 3. 創作工具頁逐頁(9 頁 + VideoCockpit)

### 3.0 VideoCockpit(/video、/video/director 實際入口)
- **優**:唯一嚴格四態頁(loading/error+重試/兩種 empty/success),空狀態有具體下一步文案與「引導式創作」CTA(VideoCockpit.tsx:63-174);用 `glass-card-static` 正統 token;成片就緒條顯示於頂部(:124-138)。
- **缺**:成片條用硬編碼 emerald 系(:125)非 `--ok` token;`CockpitShell` 只有 `p-4 sm:p-6` 一個斷點(:179),內層 DirectorConsole/console/* 未逐行讀(缺讀);VideoCockpitFrame 本身 0 aria(shells/video/VideoCockpitFrame.tsx)。

### 3.1 DirectorAI(/video/director,旗標後備頁;6606 行)
- **優**:PageHeader+ProjectContextStrip+WorkflowStepper 三段式資訊架構,把「對話→腳本→分鏡→生成」步驟外顯(4439-4466);「快速導覽」Collapsible 收起教學(4555+);79 處 toast 錯誤回饋、36 處 disabled 防連點;`useIsMobile` 行動優化(2548 行動預設收 Storyboard);visualDensity 接入。
- **缺**:雙 h1(§2.2-4);行動 icon-only 無 aria-label(§2.2-8);全頁僅 7 個 aria、**0 個 alt**(分鏡生成結果圖多);9 處 sm:/md: 對 6600 行的頁而言斷點密度極低,重度依賴 isMobile 二分;0 skeleton;批次生成鏈(01-features:46)的長任務進度靠 GenerationProgressPanel+輪詢,結構可判但**體感待實測**。

### 3.2 CreationHub(/video/create;418 行)
- **優**:小而完整——loading/error/empty 三分支且**刻意防呆**(「載入失敗≠沒有專案,別把建立表單端給已有專案的人」CreationHub.tsx:345-361 附註解);建立失敗保留輸入(191-216);首個專案表單僅 2 欄位、Enter 送出、必填鎖鈕(232-265);切換器有 `aria-label="切換影片專案"`(366);樂觀更新臨時列防跳轉(402-404);data-testid 全鋪。
- **缺**:0 響應式斷點、0 skeleton(文字式 loading);綁定列 emerald 硬編碼(35-41,應用 `--ok`);IntentComposer 本身是 skeleton 功能(01-features:60)卻以正式 UI 呈現,無「試驗中」標示。

### 3.3 Studio(/video/studio;3998 行)
- **優**:認知負荷設計最完整——單一「工具箱」鈕收攏 vault/模型/種子/配方/版本五抽屜(2429-2443、2472-2506),行動改 Sheet、桌面改側欄(isMobile 分流 2434-2438);依模態導向進階工作室的「進階創作」出口(2446-2467);積木式 prompt 編譯+引擎報價常駐(01-features:69-70)。
- **缺**:**全頁 0 個 aria-***、0 Loader2、0 Skeleton、0 空狀態文案(grep「尚未/還沒」=0)——結果全走背景任務抽屜,頁內 resultUrl 是死欄位(01-features:74),按下生成後**頁面本身沒有可視進度錨點**;頁級 h1 用 `hs-h3-lg` 字級偏小(2417);drawer 內自製 tab 按鈕無 role=tab(2511-2521)。

### 3.4 Playground(/video/playground;293 行)
- **優**:純容器,8 分頁 lazy+`?tab=` URL 同步,有 Skeleton fallback(5 處);認知上是「一頁試所有工具」的正確聚合。
- **缺**:巢狀頁(Studio/ImageStudio…)各自帶 page-shell 與 header,嵌在 tab 裡出現「頁中頁標題」重複層級;僅 1 個斷點 class,tab 列在行動的可滑性依賴子元件。

### 3.5 AnimationStudio(/video/animation;6946 行,全站最重表單頁)
- **優**:PageHeader+「準備度 %」badge+「繼續下一步」單一主行動(5990-5995)把複雜度收斂到一個 CTA;24 組 Tabs 分區;Skeleton 3 處;匯出/匯入齊備。
- **缺**:**146 個 Input + 98 個 Select 單頁**,即使分 tab 仍是全站認知負荷之最;h1 巢在 PageHeader secondaryActions(§2.2-4);**0 個 `dark:` 變體**+沉浸模式硬編碼 `text-slate-100/50`(5989、6011)——深色/沉浸全靠全域 remap 兜底;刪除世界觀用原生 confirm(6069);0 Loader2(11 處 isLoading 多用文字);世界選擇器 `w-[220px]` 固定寬在窄螢幕溢出風險(6038)。

### 3.6 ImageStudio(/video/image;5354 行)
- **優**:**行動優化模範**——`page-shell-studio` + `pb-24` 底部安全區(4367)、44px 觸控目標+`aria-label`+`aria-pressed`(4386-4404)、sticky pill tab 列 `role=tablist/tab/aria-selected`+橫滑漸隱(4429-4457)、4 個 `<img>` 全有 alt;WorldContextSidebar 預設摺疊注入世界觀(4420-4427);44 處斷點全站最高;22 處 dark:。
- **缺**:header 裝飾漸層 violet/purple 硬編碼非品牌 clay(4371);`hidden flex` 衝突 class 死鈕(4408-4414);isLoading 僅 1 處(異步結果全靠 webhook,前端同步回存是死碼,01-features:96)——**送出後的等待狀態依賴歷史面板輪詢,頁內無 skeleton**;23 模型分 5 tab 每 tab 仍 4-9 卡,tab 計數 badge 用 `text-[10px]`(4450)。

### 3.7 VideoStudio(/video/video;5408 行)
- **優**:**互動狀態最完整的創作頁**——51 處 isLoading、27 處 Loader2、33 處 disabled、`role="alert"` API key banner(615-640)、模型不可用/自動替代 inline 提示(579-600)、任務輪詢+模型灰化+替代路由(01-features:113);模型卡帶 bestFor/tip/advantages 中文教學(4522-4553);7 處空狀態文案;35 斷點+30 dark:。
- **缺**:結果播放器區硬編碼 blue/purple 漸層(≈205);Collapsible ToolCard 每卡自帶一套參數,單 tab 展開多卡時縱向極長(**無「一次只開一卡」accordion 約束**);aria 僅 9 處對 5400 行偏低;`<track kind="captions">` 有殼無字幕內容(213)。

### 3.8 ProStudio(/video/pro;4948 行)
- **優**:`page-shell-narrow` 收窄閱讀寬;sticky tab+當前 tab 描述副標(4790-4810);FAL key 缺失的雙層告警(header pill + actionable banner,4754-4787);「點擊卡片展開使用」漸進揭露副標(4721-4726)。
- **缺**:**aria 僅 2 處**(音訊播放器眾多卻無標籤);`text-muted-foreground/50` 疊小字(4723)對比疑慮;已知術語誠實問題——UI 標「AudioLDM 2」實際路由 mmaudio、TTS `speed` 滑桿調了不送後端(01-features:122-123)——**參數 UI 存在但無效 = 認知欺騙**;0 skeleton;7 tab 內卡片式 Collapsible 同 VideoStudio 縱向長問題;素材鈕/導覽 hidden 死碼(4747-4753、4813)。

### 3.9 LightOrbCreationStudio(/video/light-orb;1061 行)
- **優**:`useReducedMotion` 接入(16);預設示範 prompt+400 字上限(DEFAULT_PROMPT/PROMPT_LIMIT);敘事型 timeline 把代理協作可視化,作為 onboarding/demo 的敘事密度佳。
- **缺**:**整頁純演示卻無演示標示**(§2.2-9),假「已存到素材庫」「已預扣點數」台詞(226-236)對創作者是錯誤心智模型;0 dark:、0 aria(僅 1)、0 錯誤/空狀態(無真實請求故無);與其掛在正式路由 `/video/light-orb`,更適合掛 onboarding 流程並加「示範模式」banner。

---

## 4. 其他頁(分組)

### 4.1 /agent(AgentChat,2987 行)
- **優**:**a11y 最佳頁**——聊天區 `role="log"` + `aria-live="polite"`(2471-2479 附設計註解)、32 處 aria-label 全是動作語意(「開始任務:X」「選擇意圖:Y」,2103-2318)、98 處 dark: 全站最高;確認閘設計([ACTION] 走確認、[SUGGEST] 變快速回覆,檔頭 1-16);置中留白的低壓佈局意圖明確。
- **缺**:0 個 h1-h3(純視覺 div 標題,SR 使用者無地標);「串流」是輪詢模擬(01-features:266),打字機體感待實測;isLoading 0 處(自管 state)。

### 4.2 /assets(AssetsLibrary,1490 行)
- **優**:skeleton 全站最多(14)+Suspense `SubPageSkeleton`(869);page-header/page-title 標準件(827);無限捲動+上傳對話框。
- **缺**:известно的 `?section=` 聚合死碼——`/vault`、`/prompt-library` 等舊路由 redirect 進來**永遠落在預設資產頁**(AssetsLibrary.tsx:241-244,01-features:248),使用者從舊書籤來會「找不到我的提示詞庫」,**這是資訊架構層的實際迷路問題不只是死碼**;aria 僅 1、0 dark:、6 個斷點偏少;副標一句塞三個概念(「資產卡/歷史時間軸」「我的/團隊」)(830-832)。

### 4.3 /learn 群(LearnHub 為主)
- **優**:七分頁富首頁+文件搜尋/分類/深連結(01-features:141-143);h1/h2/h3 階層存在(2394-2403 用 page-title);30 處 toast 回饋。
- **缺**:**0 aria**;測驗作答成績不落儲存、影片區 ephemeral(01-features:145-147)——UI 呈現成持久功能,**重新整理後消失會被當 bug 體驗**;markdown 渲染用字串替換注入 h1 class(206)而非元件化;斷點僅 8 處。

### 4.4 /admin 群(AdminPage 11 分頁)
- **優**:TabsList `flex-nowrap overflow-x-auto` 行動可滑、桌面 wrap(505);12 處 skeleton、31 isLoading、20 disabled——後台的狀態衛生反而比多數創作頁好;cursor 分頁防 OOM(01-features:208)。
- **缺**:11 分頁 × 各自子功能全在一頁 2381 行,無 URL 深連結至子分頁的證據(分頁狀態可否分享待查);aria 僅 3;`text-xs` 全表格資訊密度高,對 leader 級非工程使用者的可讀性待實測。

### 4.5 Home(/)
- **優**:文案層級經過刻意收斂(「單一情感錨點」註解,Home.tsx:1435-1456);h1 有 aria-label、chips 用 `role=list`(1461);40 處斷點、useIsMobile;三情境主題(夜/晨/暖)自帶完整色組。
- **缺**:三主題色全是頁內硬編碼物件(`textPrimary: "text-white"/"text-amber-950"`…,138-217)+inline style glow——**完全繞過 token 系**,是「第三套視覺」;0 dark:(自管主題可解釋);光球 three.js 場景效能/動效體感待實測。

### 4.6 social 四頁(prod 可達)
- SocialCockpit/Studio 結構正常(230/237 行,小頁);**SocialBrand save 只 toast 不落庫、SocialPublish mock 發佈**(01-features:281-283)——線上可達下這兩頁是「看起來能用的假功能」,UX 信任問題大於視覺問題(§2.2-9)。

---

## 5. 無障礙(獨立節)

### 5.1 已具備
- 全域:SkipToContent(App.tsx:445)、`:focus-visible` 統一 ring+行動加粗(index.css:409-419)、`MotionConfig reducedMotion="user"`(App.tsx:426)、7+ 處 `prefers-reduced-motion` CSS 含 glass-card 靜止版(index.css:2453-2465)、body 行高 1.7 CJK 友善(:385)。
- 元件層:design-kit chrome 全套 aria(chrome.tsx:143-443);LoadingCard `role=status/aria-busy`;sonner `role=status`(內建);AgentChat `role=log/aria-live`;ImageStudio tablist/tab/aria-pressed/44px。

### 5.2 問題清單(嚴重度排序)

| # | 問題 | 證據 | 影響 |
|---|---|---|---|
| A1 | **`useViewMode` 行動模式寫入 `maximum-scale=1.0`,桌面模式 `initial-scale=0.35`** | hooks/useMobile.tsx:47-52、60-66 | 禁止捏合縮放,WCAG 1.4.4(Resize Text)直接不合格;低視力使用者無法放大 |
| A2 | 五大創作頁 aria 覆蓋極低(Studio 0、ProStudio 2、DirectorAI 7 對 4000-6600 行) | grep 計數(§2 表) | 創作主流程對 SR 幾乎不可用 |
| A3 | 行動版 icon-only 按鈕無 aria-label | DirectorAI.tsx:4485-4520 | 行動 SR 使用者聽到空白按鈕 |
| A4 | alt 覆蓋低:DirectorAI 0、ProStudio 0、VideoStudio 1;生成結果圖是核心內容 | grep 計數 | 生成結果對 SR 不可感知 |
| A5 | 標題地標缺失/錯亂:AgentChat 0 個 h*;DirectorAI/AnimationStudio 雙 h1 | §2.2-4 | SR 跳轉導航失效 |
| A6 | 9-10px 小字 724 處(CJK 在 10px 以下筆畫糊)+`text-muted-foreground/50` 疊透明 | §2.2-1;ProStudio.tsx:4723 | 低視力對比與可讀性;`--muted-foreground` 本身有 AA 校驗但 /50 疊加後無保證 |
| A7 | 觸控目標 44px 僅 ImageStudio 落實(全站 11 處標記);`h-8`(32px)按鈕成排 | AnimationStudio.tsx:5999-6074 | 行動誤觸 |
| A8 | `<video>` 有 `<track kind="captions">` 空殼無字幕 | VideoStudio.tsx:213 | 聽障使用者;目前多為生成預覽,屬低風險但註意 |
| A9 | 自製 tab/按鈕條缺 role(Studio drawer tab 2511-2521;ProStudio tab 列 4792-4806 無 role=tablist) | 同左 | 鍵盤 tab 序可用但語意缺 |
| A10 | 原生 confirm() 雖可及但無法被 focus-trap/主題治理 | §2.2-6 | 一致性 |

對比疑慮補充:亮色主題大量 `bg-amber-50 + text-amber-700/800`(ProStudio.tsx:4755-4785)一類組合未見校驗註記;glass 半透明面上的 `text-muted-foreground` 在照片背景上疊加時對比不受控(token 有 `--text-on-glass-*` 解法但頁面少用)。

---

## 6. 創作工具頁認知負荷總評

| 頁 | 主要欄位量 | 分層策略 | 術語暴露 | 預設值 | 錯誤引導 |
|---|---|---|---|---|---|
| VideoCockpit | 極低(引導式) | GuidedJourney 對話式 | 無 | — | 四態完備 ✅ |
| DirectorAI | 中(10 Input+10 tab) | WorkflowStepper+Collapsible | 無(Veo 徽章是裝飾文案) | 模板庫 | toast 為主 |
| CreationHub | 極低(2 欄) | 單卡+下一步 | 無 | 佔位範例佳 | 三分支 ✅ |
| Studio | 中(積木式) | 工具箱 drawer+密度三檔 | 無 | 引擎自動選 | **頁內無進度錨點** ⚠ |
| ImageStudio | 高(23 模型/17 Input) | 5 tab+每卡 Collapsible+密度 | 無 | 各卡合理 | 輪詢+歷史面板 |
| VideoStudio | 高(22 模型/32 Input/56 Select) | 5 tab+卡片 Collapsible+密度 | 無+替代模型透明 ✅ | 各卡合理 | inline+toast 最佳 ✅ |
| ProStudio | 高(7 tab/20 Input) | tab+卡片+密度 | **AudioLDM2 標示不實、speed 無效** ⚠ | 引擎 fallback | banner 佳 |
| AnimationStudio | **極高(146 Input+98 Select)** | 24 tab+準備度 %+單一 CTA | 無 | 「未命名世界」一鍵建 | confirm() 原生 |
| LightOrb | 極低 | 演示時間軸 | timeline 露 `fal-ai/nano-banana-2`(演示文案) | 示範 prompt ✅ | **假成功** ⚠ |

**結論**:模型 id 對創作者的遮蔽整體做得好(select 全用中文名);真正的認知負荷風險是 (a) AnimationStudio 的表單總量、(b) Studio 送出後「東西去哪了」的斷點、(c) ProStudio 兩處「UI 說謊」、(d) LightOrb/SocialPublish 假成功。

---

## 7. 改善建議(排序)

### 高優先(信任與可用性直接受損;預估影響:大)
1. **移除/修正 viewport `maximum-scale=1.0`**(hooks/useMobile.tsx:47-66)——一行級修改,解 WCAG 1.4.4;桌面模式 `initial-scale=0.35` 亦建議重新評估。
2. **LightOrb 加「演示模式」banner、SocialPublish mock 結果標示「模擬發佈」**(或 prod 關 SHELL_SOCIAL)——防止創作者誤信素材已存/貼文已發;純文案+badge 級工作量。
3. **修復 /assets `?section=` 聚合死碼**(AssetsLibrary.tsx:241-244)——舊路由使用者實際迷路;同時解 01-features §7 五分支死碼。
4. **Studio 頁內生成進度錨點**:送出後在頁內顯示任務卡(可直接復用 LoadingCard+背景任務資料),補五大創作頁首屏 skeleton(LoadingCard 已現成)。
5. **行動 icon-only 按鈕補 aria-label**(DirectorAI.tsx:4485-4520 起,全站同 pattern 掃一輪)+生成結果 `<img>` 補 alt(可用 prompt 前 30 字)。
6. **修雙 h1 / 標題階層**:PageHeader 已含 h1,頁內第二標題降為 h2/去除(DirectorAI.tsx:4471、AnimationStudio.tsx:6011);AgentChat 加一個 sr-only h1。

### 中優先(一致性/維護債;影響:中)
7. **ProStudio 術語誠實化**:AudioLDM2 改標 mmaudio(或「音效引擎」)、speed 滑桿接後端或先移除(01-features:122-123)。
8. **統一刪除確認為 AlertDialog**(8 頁 confirm() 替換)。
9. **`text-[10px]/[9px]` 批次改 `text-2xs/3xs`**(724 處,可 codemod)+ 制定「10px 以下禁用於必讀資訊」規則。
10. **清除 `hidden` 死 UI**(ImageStudio/ProStudio/DirectorAI 素材鈕與模型導覽)——改旗標或刪。
11. **圖表色改用 `--chart-1..5`**(DashboardPage.tsx:103-109)+裝飾漸層收斂到 clay/gold/teal(ImageStudio header、VideoStudio player、CreationHub/VideoCockpit emerald→`--ok`)。
12. **AnimationStudio 表單減量**:以 visualDensity beginner 預設隱藏 50%+ 欄位、或拆「基本資料/角色/場景/風格」為精靈式步驟;補 dark: 或移除沉浸模式硬編碼 slate。
13. **glass-card 採用或降級**:決定「頁面卡片一律 glass-card-static / 或刪掉 glass 系只留 surface token」,終結 ad-hoc `bg-card/40` 亂象。

### 低優先(打磨;影響:小)
14. Fraunces 用於頁級標題(`hs-h1/h2` 加 `font-serif`)或停載該字型省流量。
15. 自製 tab 條補 `role=tablist/tab`(Studio drawer、ProStudio)。
16. 雙 toast 系收斂為 sonner 單軌(design-kit Toasts 僅 chrome demo 用途時移除)。
17. `docs/design-reference.md` 更新為 Wave U token(現內容已誤導)。
18. AdminPage 分頁支援 `?tab=` 深連結(若尚無);LearnHub markdown 渲染元件化。
19. 觸控目標 44px 規則從 ImageStudio 推廣到 AnimationStudio/DirectorAI header 按鈕列。

---

## 8. 待補(程式碼無法判定,需團隊回饋/實測)
- 實際手感:glass blur 在低階機的效能、Home three.js 光球 FPS、sticky tab 在 iOS Safari 的行為
- 動效體感:framer-motion 進出場是否過多/過慢(`--duration-breath 4s` 級動畫的主觀感受)
- 光球(Orb)浮鈕與 Quick Feedback 浮鈕在行動版的遮擋度(與 MobileNav 底欄疊加)
- 深色模式全域 remap 後的實際視覺(規則能保底,質感需目測)
- AdminPage/AdminApiUsage 對 leader 級使用者的表格可讀性
- 輪詢式「串流」(AgentChat)與 3-5s 任務輪詢(Director/Studio)的等待體感
- 對比實測:amber 告警條、glass 面上 muted 文字的 axe/lighthouse 掃描值

## 9. 缺讀聲明
- DirectorConsole 及 `shells/video/console|drawers|panels/*` 內部 JSX 未逐行(僅 VideoCockpit/VideoCockpitFrame/AidvShellChrome/chrome.tsx 全讀)
- 五大創作頁各讀 header/模型表/狀態元件等關鍵區段+全檔 pattern 掃描,**非逐行**(合計 2.6 萬行);AnimationStudio 中段表單、ImageStudio 各 tab 卡片細節未逐行
- Home 三情境場景的 three.js 元件、LearnHub 七分頁子元件、AdminPage 各 TabsContent、SettingsPage/DashboardPage/NotesPage/ModelsPage/TeachingArchive 以 grep 計數+01-features 結論為據,未深讀
- `index.css` 讀約 1200/4996 行(token/base/components 層全讀,後段動畫 keyframes 掃 outline)
- 02-fullstack.md 僅取接線結論交叉引用,未整篇覆核
