# S4 — Mobile-First 創作本質流(產品策略設計 wave S)

- 產生日期:2026-07-03
- 依據 commit:`7f4417da`
- 波次:**產品策略設計 wave S**
- 性質:本文件只做**產品策略設計**(手機做什麼、桌機做什麼、關鍵手機場景長什麼樣、分階段),不寫程式碼、不 spawn 子代理。
- **前提聲明(必須先講清楚的矛盾)**:背景需求把系統定位為「mobile-first UX」,但 `C-uiux.md` 的實測 UX 診斷顯示行動端現況離「優先」很遠——viewport 禁縮放(WCAG 1.4.4 不合格)、行動 icon-only 按鈕無 aria-label、全站 44px 觸控目標僅 11 處(幾乎全在一頁)。本文件**不假裝現況已達標**,而是在承認落差的前提下,設計「手機優先的創作本質流該長什麼樣」——同時把 C/P1 已診斷出的行動端缺陷,重新用「這是不是宣稱 mobile-first 的直接反證」這個角度排序。
- 依據來源:`docs/research/C-uiux.md`(§2.2、§3 逐頁盤點、§5 無障礙)、`P1-uiux-solutions.md`(解法卡1 A11y速修、卡2 結果動線)、`P2-creator-flow-ux.md`(一條龍畫面地圖、關鍵畫面①③④)、`M0-solution-blueprint.md`(七支柱、分階段路線)
- 本次實讀(超出上述文件既有引用範圍):`client/src/hooks/useMobile.tsx`(全文)、`client/src/pages/ImageStudio.tsx:4360-4470`(行動模範區塊)、`client/src/pages/AnimationStudio.tsx:5980-6080`(行動崩潰區塊)、`client/src/components/DashboardLayout.tsx`(全文,行動導航+浮動元件掛載)、`client/src/components/design-kit/chrome.tsx:418-450`(`MobileNav`)、`client/src/components/AppleDock.tsx:590-660`(行動版 corner bubble 邏輯)

---

## 1. 行動端現況盤點

### 1.1 逐頁行動可用度分級

| 頁面 | 行動可用度 | 證據 | 策略意涵 |
|---|---|---|---|
| **ImageStudio**(/video/image) | **模範** | `page-shell-studio` + `pb-24` 底部安全區、`min-h-[44px]` + `aria-label`/`aria-pressed`(ImageStudio.tsx:4386-4404)、sticky pill tab `role=tablist/tab`+橫滑漸隱(4429-4457)、44 處斷點全站最高、22 處 `dark:` | 唯一可直接抄的行動 pattern 來源;但 header 素材鈕仍是 `hidden flex` 衝突死碼(4408-4414)、裝飾漸層 violet/purple 非品牌色(4371) |
| VideoStudio(/video/video) | 次佳 | 35 斷點+30 `dark:`、`role="alert"` API key banner、模型不可用替代提示(579-600) | Collapsible ToolCard 無「一次只開一卡」約束,手機單欄縱向會極長,需優先加 accordion 互斥 |
| DirectorAI(/video/director) | 中 | `useIsMobile` 已接入(行動預設收 Storyboard);但行動 icon-only 按鈕無 `aria-label`(DirectorAI.tsx:4485-4520)、0 alt | 骨架有做行動分流,但 a11y 沒跟上——「有響應式」不等於「行動可用」 |
| Studio(/video/studio) | 中低 | 工具箱抽屜已分流(行動 Sheet、桌面側欄,2434-2438) | 全頁 0 aria、0 空狀態、送出後**頁內無可視進度錨點**——在手機這個問題更致命,因為沒有桌面版「多開一個分頁看結果」的餘裕 |
| **AnimationStudio**(/video/animation) | **崩** | **146 Input + 98 Select** 單頁(全站認知負荷之最);header 一排 `h-8`(32px)按鈕(5999-6074);世界選擇器 `w-[220px]` 固定寬(6038)窄螢幕溢出風險;**0 個 `useIsMobile` 使用**、**0 個 `dark:` 變體** | 這是「宣稱 mobile-first」與現實反差最大的頁面——全站表單量最高的頁面同時是唯一完全沒做行動分流的頁面 |
| ProStudio(/video/pro) | 低 | aria 僅 2 處;7 tab 內卡片式 Collapsible 縱向長,同 VideoStudio 問題但更嚴重(0 skeleton) | |
| AgentChat(/agent) | 佳(結構性) | a11y 最佳頁(`role=log`+`aria-live`、32 處動作語意 aria-label、98 處 `dark:`);置中留白佈局天然適配窄螢幕 | 對話式介面本身對手機友善,值得作為「手機優先場景」的介面語言參考(見 §3 場景 C) |
| AssetsLibrary(/assets) | 中低 | 仅 6 個斷點、aria 僅 1 | `?section=` 死碼(見 P1 卡2 軌C)在手機上更致命——手機使用者從舊連結進來更難自行找回篩選狀態 |
| LearnHub(/learn) | 低 | 8 處斷點、0 aria | |
| AdminPage | 佳(非創作者場景) | `TabsList flex-nowrap overflow-x-auto` 明確行動可滑設計 | 是後台/leader 場景,不在本文件「創作者手機優先」範圍內,但證明團隊有能力做好行動 tab,只是沒推廣到創作頁 |
| Home(/) | 佳 | 40 處斷點+`useIsMobile` | three.js 光球在低階手機 FPS 未實測(承續 C §8 待補) |

### 1.2 行動導航與浮動元件現況(本次新查證)

- **`useIsMobile` 覆蓋率低**:僅 6 頁+chrome 消費(C §2.2-11),AnimationStudio/ProStudio/AssetsLibrary/LearnHub 等創作/查閱型頁面完全靠 `sm:/md:/lg:` 斷點類名自然響應,沒有行動專屬分流邏輯。
- **`useMobile.tsx` 本身就是 mobile-first 破口的源頭**:`useViewMode()` 行動模式寫入 `maximum-scale=1.0`(:51、:64),直接關閉捏合縮放——一個宣稱「mobile-first」的系統,其行動端 viewport 設定卻主動關掉可讀性,是本文件最需要修正的認知落差。
- **行動殼層導航已有兩套骨架,但浮動元件疊加風險未治理**:
  - `AppleDock`(旗標 OFF 時的預設殼)在行動裝置預設收成角落 bubble(`isMobile && !mobileOpen` → `MinimizedBubble`,AppleDock.tsx:601-611),點擊展開再變抽屜——這個「預設收起,不占內容區」的設計本身是對的行動模式。
  - `MobileNav`(design-kit chrome.tsx:418-450,`ENABLE_AIDV_CHROME` 開啟時使用)是底部 FAB 列,含中央上浮 ⌘K 圓鈕(`-mt-6` 溢出效果)+ 兩側殼層籤,結構完整,但**按鈕文字用 `text-[10px]`**(:431),與 C §5.2 A6「9-10px CJK 小字可讀性疑慮」直接牴觸,且高度是否達 44px 觸控標準未經驗證(`py-1.5` + 18px icon + 10px 文字,粗估邊緣值)。
  - `DashboardLayout.tsx:941-959` 同時掛載 **`ProactiveOrbWidget`**(全站光球)+ **`AidvOrbMount`**(`ENABLE_AIDV_CHROME` 開時並存的第二顆光球)+ **`QuickFeedbackButton`**(快速回饋浮鈕)三個浮動元件,加上 `AppleDock` 行動 bubble 本身——**四個浮動元件都要搶手機畫面角落空間**,現有程式碼靠各自 z-index/position 隱性避讓,沒有統一的「行動版角落分配」規則,呼應 P2 引用 G1 §3.2-1「右下角浮動元件疊羅漢」的既有觀察。
  - `ProjectSelector` 在 `main` 內以 `sticky top-0 z-30`(:933)常駐,若頁面本身也有 sticky tab 列(如 ImageStudio 的 `sticky top-0 z-20`,ImageStudio.tsx:4430),手機窄螢幕上會出現**雙層 sticky bar 疊加**,吃掉本就有限的垂直可視空間——這是本次查證新發現、C/P1 未提及的潛在問題,需要團隊實機驗證(列入 §6 未涵蓋)。

### 1.3 對照「宣稱 mobile-first」的核心矛盾清單

| 宣稱 | 實測現況 | 證據 |
|---|---|---|
| mobile-first UX | viewport 主動關閉縮放,WCAG 1.4.4 不合格 | useMobile.tsx:51、:64 |
| mobile-first UX | 全站 44px 觸控目標僅 11 處,且集中單頁 | ImageStudio.tsx:4386-4410;AnimationStudio.tsx:5999-6074 反例 |
| mobile-first UX | 行動版按鈕文字消失卻無 aria-label,SR 使用者連按鈕語意都聽不到 | DirectorAI.tsx:4485-4520 |
| mobile-first UX | 全站表單量最大的頁面(AnimationStudio,146 Input)完全沒有行動分流 | 0 `useIsMobile`、0 `dark:` |

**結論**:「mobile-first」目前是**產品定位語言**,不是**已落地的實作現況**。本文件後續設計以「要讓 mobile-first 成真,該怎麼分工與分階段」為目標,而非在現有缺陷上直接疊加新功能。

---

## 2. 本質流的行動端可行性設計

M0 七支柱④「單一專案:腳本→分鏡→逐幕(字卡+圖影+聲音)→拼接→輸出→打包」是北極星本質流;P2 已把它畫成 7 個畫面態。本節針對**每一步**評估手機可行性,設計「手機做什麼、桌機做什麼」的分工。

| 一條龍階段 | 手機可行性 | 理由 | 分工建議 |
|---|---|---|---|
| 建立專案 | **高** | 單一標題輸入,`CreationHub` 現況已是 2 欄位極簡表單(P2 §2) | 手機/桌機皆可,無需分工 |
| 世界觀連結(可選) | **高** | 純選單挑選(`WorldLinkPicker`),無需精細輸入 | 手機可完成,建立新世界的長表單(角色/場景細節)仍建議導向桌機 |
| 腳本 | **中高** | 「一句話生成初稿」在手機是天然強項(短輸入、AI 補完);但貼長腳本手動編修在手機鍵盤上效率低 | 手機:一句話生成、語音口述(見 §3 場景 C);桌機:長腳本貼上/逐段精修 |
| 分鏡(逐鏡生成/核准) | **中高** | `ShotDetailCanvas` 大圖+核准/重生/deep-link 修復本質是「單一鏡頭決策」,天然適合單手滑動操作(見 §3 場景 B) | 手機:核准、重生、瀏覽 readiness chip;桌機:補角色參考照上傳、批量拆分鏡設定 |
| **逐幕三軌組裝**(字卡+圖影+聲音) | **低,不建議手機做** | P2 §3② 設計的三軌並列編輯器,在桌面是「字卡軌/畫面軌/聲音軌」橫向並列;手機窄螢幕必然變成三軌堆疊成長縱欄,音軌 `startOffsetSec`/`volume` 數值輸入需要精細觸控且要對照時間軸,觸控精度天生不足 | **明確劃給桌機**——手機版此步驟應顯示「請在桌面完成本幕的細部組裝」引導卡,而非硬做一個閹割版編輯器製造挫敗感 |
| 拼接預覽 | **中高** | P2 §3③ 拼接預覽本質是「瀏覽+核對」,不是編輯——縮圖走廊+時間軸色塊+未核准警示都是唯讀瀏覽行為 | 手機:瀏覽拼接結果、看到哪幕被跳過、點擊 deep-link 回核准;「回去修改某一幕」動作本身會導回分鏡或三軌組裝(依 M0 分工自動落地到對應裝置) |
| 輸出打包 | **中高** | 下載/打包是單次動作,`CompletionCanvas` 播放器骨架天生適合手機直向播放 | 手機:下載成片單檔、分享連結;打包大 zip 在行動網路上可能慢,需背景下載/離線佇列提示(見 §5 待補);桌機:偏好大檔案打包與素材管理 |

### 分工設計原則

**「行動端是儀表板+審核台,桌機是工作台」**——

- **手機做**:啟動專案、瀏覽進度、單一決策式審核(核准/駁回/重生)、輕量輸入(一句話生成、語音下指令)、聽/看结果、下載/分享。這些操作的共同特徵是**一次一個決策、輸入量小、不需要多欄比對**。
- **桌機做**:多欄同時比對(三軌編輯、時間軸精調)、長文字輸入(貼長腳本)、批量操作(批次生成鏈)、素材整理、精細數值調校(音量/偏移/裁切)。這些操作的共同特徵是**需要同時看多個資訊源、需要精確指標裝置**。

P2 §3① 設計的「專案儀表板」(專案身分列+五步進度條+世界觀摘要卡+確認門總覽+下一步建議卡)本質上就是這條分工原則的視覺化——**它天生就該是手機版的主畫面**,而不是桌面 `/video` 座艙側欄裡的一個抽屜。這是本文件對 P2 藍圖的策略性再詮釋:P2 沒有明講「這張儀表板應該優先為手機設計」,但其資訊架構(單欄、決策導向、瀏覽為主)剛好完全符合手機優先的分工原則。

---

## 3. 手機優先的關鍵場景設計(4 張)

### 場景 A — 外出看專案進度(精簡儀表板)

**定位**:創作者在外面沒空打開電腦,想知道「我的專案卡在哪、AI 建議我做什麼」。

**設計**:直接沿用 P2 §3① 儀表板資訊架構,砍成單欄手機版:
1. 專案身分列(標題+狀態徽章+專案切換)
2. 五步進度條(重用 `ProjectFlowGuide`,當前步高亮+一句話現況)
3. 確認門總覽(就緒/待補/擋下大數字,點擊 deep-link)
4. 下一步建議卡(重用 `AmbientOrb` 泡泡殼,見 P2 §4.1)

**行動可用性要求**:字級不低於 14px(對照 C §5.2 A6 的 9-10px 問題,此頁面禁用任何 `text-[10px]/[9px]`)、按鈕全 44px、單欄無需橫向捲動。

**資料源已現成**:`ActiveProjectContextPanel` + 規劃中的 `deriveProjectJourney` 共用模組(P2 §5)——**不需要新 API**,只需要決定這張儀表板是否要成為手機版的預設首頁(見 §5 待補決策)。

### 場景 B — 審核/核准(逐鏡滑動審核卡片)

**定位**:創作者在通勤時想花 3 分鐘審完卡住的鏡頭。

**現況問題**:`StorySpineColumn` 左欄場景→鏡頭樹狀導航(P2 §1 畫面3)在桌面是自然的樹狀清單,但在手機窄螢幕上樹狀清單需要橫向捲動或多層展開,不適合單手操作。

**設計**:借用 `ShotDetailCanvas` 既有大圖+核准/重生/deep-link 修復的資料與動作邏輯,但介面改成「一次一鏡」全螢幕卡片——上滑/下滑或左右滑切換鏡頭,底部固定操作列(核准/重生/同 seed/下一鏡),每個按鈕 44px(對照 ImageStudio 已驗證的 pattern)。這是**淨新增 UI**,但邏輯層(生成/核准 API)完全複用既有 `ShotDetailCanvas` 消費的資料。

**AI 引導**:光球在此場景的角色沿用 P2 §3③ 的「核對」定位——「這一鏡角色參考照缺失,建議留到桌面補,先審下一鏡?」直接跳過需要桌面操作的步驟,不卡住手機審核流程。

### 場景 C — 光球對話下指令

**定位**:創作者想用一句話讓 AI 做事,而不是自己在手機小螢幕上找按鈕、填表單。

**現況基礎**:`AmbientOrb` 四態(silent/hint/collab/critical)+ 泡泡兩按鈕殼(P2 §2)已經是為輕量互動設計的元件,`AgentChat` 頁的對話式介面(`role=log`+`aria-live`,C §4.1)也證明團隊已有「手機友善對話介面」的能力,只是分散在不同元件裡。

**設計**:
1. **收斂浮動入口**:承接 §1.2 發現的「四個浮動元件搶角落」問題——手機優先場景下,行動版應該只保留**一個**常駐光球入口(建議 `ProactiveOrbWidget` 或 `AidvOrbMount` 二選一,依 `ENABLE_AIDV_CHROME` 旗標決定,而非兩個並存),`QuickFeedbackButton` 與 `AppleDock` bubble 應與該光球共用同一角落分層邏輯而非各自 fixed 定位。
2. **語音下指令入口**(淨新增,P2/M2 已明確排除的範圍,本文件重新提出):手機打字辛苦,語音輸入是手機專屬的差異化機會——「幫我用 XX 世界觀重生第三幕」「這一鏡核准」用說的比在小鍵盤打字更適合單手/移動場景。
3. **指令範圍收斂到手機可行的動作集**:對齊 §2 分工原則,光球在手機上只承接「核准/駁回/重生/查詢進度/簡單生成」這類單一決策指令,遇到「調整三軌編輯」這類需要多欄比對的請求,直接回覆「這個需要在桌面操作,要我先幫你標記這幕待處理嗎?」(呼應 P2 §4.2 對齊門澄清卡的兩按鈕語言)。

### 場景 D — 快速生成一張圖

**定位**:創作者靈感來了,想立刻用手機生成一張圖,不想面對 23 個模型的完整介面。

**現況基礎**:ImageStudio 已是行動模範(44px+sticky tab+alt),但 23 模型分 5 tab、每 tab 仍 4-9 卡的資訊量,對「我只是想快速生成一張」的手機情境仍然過重。

**設計**:在既有 `visualDensity`(beginner/standard/professional)三檔基礎上,延伸一個**手機專屬精簡密度檔**——手機版預設只顯示 1-2 個「最常用/推薦」模型卡,其餘模型收進「更多模型」折疊區(而非強迫捲動過 5 個 tab)。這不是新建元件,是既有 `shouldShowAdvanced`/`shouldShowDiagnostics` 密度分層邏輯(`lib/visualDensity.ts`)的手機情境延伸。

---

## 4. A11y 速修清單 + 行動導航改進 + 觸控目標

### 4.1 A11y 速修清單(對照 C/P1,按「對 mobile-first 主張的傷害程度」重新排序)

| 優先 | 問題 | 對應 P1 卡 | 檔案:行號 | 為何在 mobile-first 策略下優先級最高 |
|---|---|---|---|---|
| **最高** | viewport 禁縮放/桌面模式縮 35% | 1-A | `useMobile.tsx:47-52、60-66` | 直接、字面意義上與「mobile-first」定位矛盾;一行字串修改即可解 WCAG 1.4.4,是止血成本最低、傷害最大的一項 |
| **高** | 行動 icon-only 按鈕無 aria-label | 1-B | `DirectorAI.tsx:4485-4520`+同 pattern 全站掃描 | 只在行動版觸發(桌面顯示文字),是**行動限定**缺陷,不修等於行動 SR 使用者被排除在外 |
| **高** | 44px 觸控目標僅 11 處 | 1-D | `ImageStudio.tsx:4386-4410`(模範)vs `AnimationStudio.tsx:5999-6074`(反例) | 觸控目標本質就是行動議題,桌面用滑鼠不受影響 |
| 中 | 生成圖 0 alt | 1-C | `CompletionCanvas.tsx`/`ShotDetailCanvas.tsx`/`ShotPanel.tsx` | 影響所有裝置的 SR 使用者,非行動限定,但場景 B(滑動審核卡片)以圖為核心,若無 alt,SR 使用者在手機審核場景完全無法使用,建議與場景 B 開發同批处理 |

### 4.2 行動導航改進

1. **統一浮動元件角落治理**(新發現,非既有文件已列項目):訂一份「行動版浮動元件優先權」規則——`ProactiveOrbWidget`/`AidvOrbMount`/`QuickFeedbackButton`/`AppleDock` bubble 四者在手機上不可同時出現在同一視覺角落。建議做法:依 `ENABLE_AIDV_CHROME` 旗標二選一光球(不並存)、`QuickFeedbackButton` 與光球共用一個「次要動作」彈出選單而非獨立浮鈕、`AppleDock` bubble 位置與光球位置對角分佈(左下 vs 右下)而非同角。目標檔案:`DashboardLayout.tsx:941-959`、`AppleDock.tsx:601-611`。
2. **`MobileNav` 文字改用 token**:`text-[10px]`(chrome.tsx:431)違反 C §5.2 A6 規則,建議改 `text-2xs` 系 token,並實測確認按鈕整體高度(icon+文字+padding)是否真的達 44px——目前只有視覺推測,未實測。
3. **雙層 sticky bar 排查**:`ProjectSelector`(`sticky top-0 z-30`,DashboardLayout.tsx:933)與頁面自帶 sticky tab(如 ImageStudio 的 `sticky top-0 z-20`)在手機窄螢幕上是否疊加吃掉可視空間,需要團隊實機驗證(本文件新發現,未經測試確認,見 §6)。
4. **`useIsMobile` 覆蓋率推廣**:AnimationStudio/ProStudio/AssetsLibrary/LearnHub 補接 `useIsMobile`,至少讓最重的表單頁(AnimationStudio)有行動分流骨架可用(呼應 P1 卡1-D 的「推廣」建議,範圍擴大到覆蓋率本身)。

### 4.3 觸控目標推廣路線

- 第一步:把 ImageStudio 已驗證的 `min-h-[44px]` 規則抽成共用 class 或 `Button` 元件 `size="sm"` 在 `isMobile` 時自動提升 padding(P1 卡1-D 已提出改法)。
- 第二步:優先推廣到 AnimationStudio header 按鈕列(`h-8`=32px,6 顆按鈕全需要提升)與 `MobileNav`。
- 第三步:場景 B(滑動審核卡片)的底部操作列從設計階段就直接套用 44px 規則,不留技術債。

---

## 5. 重用什麼 + 要補什麼 + 分階段

### 5.1 重用清單(現成骨架,行動優先只需「解放/複製 pattern」,非新建)

| 場景/需求 | 重用對象 | 路徑 | 現況 |
|---|---|---|---|
| 44px+sticky tab+alt pattern 模板 | ImageStudio 行動區塊 | `ImageStudio.tsx:4386-4457` | 完整,可直接抄花紋推廣到其他四大創作頁 |
| 光球對話殼(場景C) | `AmbientOrb` 四態+泡泡兩按鈕 | `shells/video/console/AmbientOrb.tsx` | 完整,P2 §4 已設計借用方式 |
| 精簡儀表板資料源(場景A) | `ProjectFlowGuide` 五步+`ActiveProjectContextPanel` | 同 P2 §2 表列路徑 | 完整但鎖在 `ENABLE_PROJECT_HUB`(OFF)+ 只掛 `/create` 頁,需搬遷+開旗標 |
| 滑動審核卡片底層邏輯(場景B) | `ShotDetailCanvas` 生成/核准/reseed 動作與資料 | `shells/video/canvas/ShotDetailCanvas.tsx` | 完整,只是介面外殼需重畫(樹狀→單卡滑動) |
| 首屏骨架(空白/skeleton 治理) | `LoadingCard`/`EmptyState`/`ErrorState`/`PanelState` | `components/ui/*`、`shells/_shared/PanelState.tsx` | 完整,五大創作頁未接(P1 卡3),行動場景更急迫因為手機首屏空白比桌面更打斷單手操作節奏 |
| 行動導航骨架 | `MobileNav`(chrome.tsx)+ `AppleDock` mobile bubble | `design-kit/chrome.tsx:418-450`、`AppleDock.tsx:590-660` | 骨架已存在且設計合理(bubble 預設收起),**需要治理浮動元件衝突而非重建** |
| 密度分層邏輯基礎(場景D) | `visualDensity.ts`(beginner/standard/professional) | `lib/visualDensity.ts` | 完整,手機精簡檔是既有邏輯的延伸而非新機制 |

### 5.2 要補清單(淨新建或需要產品決策)

1. **精簡儀表板作為手機首頁**(場景A)——需要決定:這是全新路由頁面,還是取代 VideoCockpit 現有 success 態首屏在手機下的呈現(P2 §5 已標記此為未裁定項,本文件延續同一開放問題,補上「手機優先」這個新的裁定依據——傾向手機版優先採用儀表板形態)。
2. **逐鏡滑動審核卡片**(場景B)——淨新增 UI,邏輯層全部複用既有 `ShotDetailCanvas`。
3. **手機專屬精簡密度檔**(場景D)——延伸 `visualDensity.ts`,非新機制但需要新增一檔並在五大創作頁接線。
4. **浮動元件行動版治理規則**(§4.2-1)——需要產品/設計拍板優先權順序,非純技術判斷。
5. **語音下指令入口**(場景C)——P2/M2 已明確排除的範圍,本文件重新提出為手機差異化機會,需要技術可行性評估(ASR 供應商/成本,見 §6 未涵蓋)。
6. **打包/下載的行動網路降級策略**——大 zip 檔在行動網路的背景下載/離線佇列提示,現有 `CreationFlowBar` 匯出邏輯未考慮這個情境。
7. **A11y 速修四項**(viewport/icon-only aria-label/44px/alt)——見 §4.1,多數是純前端小改動,無後端依賴。

### 5.3 分階段路線(疊加 M0 既有四階段,加上 mobile lens)

**Phase 0(與 M0 Phase 0 並行,純前端,無後端依賴,建議立即做)**
- viewport 一行修(`useMobile.tsx:47-52、60-66` 移除 `maximum-scale=1.0`)
- 行動 icon-only 按鈕補 aria-label(全站掃描同 pattern)
- `MobileNav` 文字改 token + 44px 實測
- 浮動元件角落治理規則制定(不等後端,先做產品/設計決策)

**Phase 1(呼應 M0 Phase 1「單幕端到端」+「AI 讀專案」)**
- 精簡儀表板解放:開 `ENABLE_PROJECT_HUB`,把 `ProjectFlowGuide`+`ActiveProjectContextPanel` 搬到座艙儀表板尺度(場景A 落地)
- 44px 觸控目標推廣到 AnimationStudio/ProStudio/DirectorAI header
- 五大創作頁補 `LoadingCard`/`EmptyState` 首屏骨架(P1 卡3),手機優先驗收

**Phase 2(呼應 M0 Phase 2「引導解放+逐幕三軌+審」)**
- 逐鏡滑動審核卡片(場景B)落地,綁 M4 資產審批狀態機(draft/in_review/approved)
- 手機專屬精簡密度檔(場景D)接線五大創作頁
- **逐幕三軌組裝明確定位為桌機專屬**,手機版顯示「請在桌面完成」引導卡而非閹割版編輯器

**Phase 3(呼應 M0 Phase 3「拼接輸出打包」)**
- 拼接預覽/輸出打包的手機瀏覽態(天然適合手機的「看」而非「編輯」步驟,與桌機版同批開發但手機測試優先)
- 打包大檔案的行動網路降級策略(背景下載/離線佇列)

**Phase 4+(縱深,依賴語音/AI 工具鏈成熟)**
- 語音下指令入口(場景C 完整版)
- 光球對話指令範圍隨 M2 對齊門(project-alignment-gate)成熟後擴大手機可承接的動作集

---

## 6. 未涵蓋 / 待補聲明

- **真實裝置手感**(承續 C §8):sticky tab 在 iOS Safari 的行為、glass blur 在低階手機的效能、Home three.js 光球在低階手機的 FPS——本文件的行動端分級仍以程式碼可靜態判定為主,未做跨裝置實測。
- **雙層 sticky bar 疊加**(§1.2 新發現):`ProjectSelector` 與頁面自帶 sticky tab 在手機窄螢幕的實際疊加效果只是靜態程式碼推測,未經真機驗證。
- **`MobileNav` 按鈕實際觸控高度**:僅從 class 名稱(`py-1.5`+18px icon+10px 文字)推估邊緣值,未實測是否真的達 44px。
- **語音下指令的技術可行性**:ASR 供應商選型、延遲、成本,以及與既有光球對話（文字)架構的整合方式,完全未研究,僅作為場景C 的產品構想提出。
- **網路頻寬情境**(4G/離線)未考慮的功能降級策略:僅在 §5.2-6 點出打包下載的問題,未涵蓋生成任務在弱網路下的行為(輪詢頻率、超時重試)。
- **手機版 WCAG 完整稽核**:本文件只列 §4.1 四項速修(源自 C/P1 已有的靜態掃描),不是全量 AA/AAA 稽核,C §5.2 A5(標題地標)/A8(字幕殼)/A9(自製 tab role)等其餘項目未在本文件中針對手機情境重新評估。
- **場景B(滑動審核卡片)與既有 `StorySpineColumn` 樹狀導航共存策略**:桌面版是否保留樹狀導航、手機版滑動卡片是否也要能「跳轉到指定鏡頭」而非純線性滑動,未設計細節,留待 UI 落地階段決定。
- **多專案並行的手機場景**:承續 P2 §未涵蓋部分,若創作者手機上同時追蹤兩個專案,精簡儀表板/光球對話該認哪個專案的行為未涵蓋。
