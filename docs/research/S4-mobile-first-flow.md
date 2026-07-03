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
<br>
