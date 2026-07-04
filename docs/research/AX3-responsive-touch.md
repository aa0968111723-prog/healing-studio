# AX3 — 響應式/行動/觸控
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:版面容器、固定寬度、觸控目標、光球浮動元件、工作室座艙在小螢幕

> 方法:先讀碼、後判斷。只列「從程式碼可靜態判定」的問題;顏色對比、實際渲染裁切量等一律標記「需視覺驗證」。每筆列出 檔案:行號、影響對象(鍵盤/螢幕閱讀器/觸控)、建議,並依嚴重度排序。文末含「已正確處理」negative results 供對照避免重工,以及對 Y8 / FE-03 / Y5 / S4 既有結論的確認延伸。

---

## 高(P0/P1)

### H1. ProjectNotesDrawer + AssetsQuickDrawer:自訂寬度覆寫掉共用 Sheet 的響應式安全網,手機水平溢出/裁切
**檔案:`client/src/components/ProjectNotesDrawer.tsx:337-340`、`client/src/components/AssetsQuickDrawer.tsx:173-176`;根因在共用元件 `client/src/components/ui/sheet.tsx:60-71`、`client/src/lib/utils.ts:4-6`**

`ui/sheet.tsx` 的 `SheetContent`(`side="right"`)預設 class 是 `w-3/4 border-l sm:max-w-sm`(:63)——即行動端寬度用**相對視窗**的 `3/4`,只有到 `sm+` 才加一個 `max-w-sm`(384px)上限,這個預設本身是對窄螢幕安全的寫法。但 `cn()`(`lib/utils.ts:4-6`)是用 `twMerge(clsx(inputs))`,`twMerge` 會依 Tailwind class group 去重——呼叫端傳入的 `className="w-[380px] sm:w-[420px] ..."` 與 base 的 `w-3/4` 同屬 `width` group、且都在**同一個 modifier(無前綴/base)**,因此呼叫端的 `w-[380px]` 會直接**蓋掉** base 的 `w-3/4`,而 base 的 `sm:max-w-sm` 屬於 `max-width` group、與呼叫端的 `sm:w-[420px]`(`width` group)不衝突,兩者會同時生效——所以在 `sm+`(≥640px)最終寬度是 `min(420px, 384px)=384px`(有救),但在 **base(<640px,也就是所有手機)** 完全沒有任何 `max-w` 兜底,寬度是硬編碼 `380px`。
常見手機視窗寬度 320-375px(iPhone SE、多數 Android 中低階機)全部小於 380px——抽屜以 `inset-y-0 right-0` 固定在右側,寬度超出視窗時左緣會被推到視窗外,造成內容裁切(不確定是否觸發整頁水平捲動,取決於瀏覽器對 `position:fixed` 溢出的實作,故此細節標需視覺驗證,但「寬度覆寫掉安全網、在 380px 以下手機必然裁切」本身可由程式碼直接判定)。
- **ProjectNotesDrawer 是目前線上可達的真實元件**(`isMobile` 只用於 158 行的刪除鈕透明度,並未用於調整 Sheet 寬度,見 68 行),不是被旗標或 `hidden` 擋住的死碼——這是本次掃描信心最高的一筆。
- **AssetsQuickDrawer 目前被 FE-03(`hidden` class)擋住不可達**,但這代表:若照 AX1 H3 建議「移除四處 `hidden`」直接修,AssetsQuickDrawer 在手機上會立刻踩到這個寬度覆寫 bug——建議把「移除 hidden」與「改用 `w-full sm:max-w-sm md:w-[420px]` 之類相對寬度」綁在同一張修復卡,避免修好一個入口問題又生出一個新的手機溢出問題。
- 影響對象:觸控使用者(視窗 ≤380px 時內容被裁切/推出視窗)。
- 建議:兩個檔案的 `className` 改成不依賴固定 px 覆寫 base width,例如 `"w-full sm:max-w-sm md:w-[420px]"` 或至少補回 `max-w-[calc(100vw-2rem)]`(專案內 `GlobalOrbChatContext.tsx`、`orb-agent/*.tsx` 已大量使用同款寫法,可直接抄,見「已正確處理」)。
- cluster:responsive-touch
- needsVisual:是(twMerge 的 group 去重規則可由原始碼與函式庫行為直接判定,但實際裁切像素量建議截圖/實機複驗)

### H2. AmbientOrb(導演座艙常駐光球)——全元件零響應式類別,面板固定寬度且與手機底部分頁列位置衝突
**檔案:`client/src/shells/video/console/AmbientOrb.tsx`(全檔,60-134 行);掛載於 `client/src/shells/video/DirectorConsole.tsx:38-46`;衝突對象 `client/src/shells/video/console/CockpitColumns.tsx:57-82`**

`AmbientOrb.tsx` 整檔 **0 個 `sm:/md:/lg:` 斷點、0 個 `useIsMobile`**(全庫 grep 確認),是本次掃描中「工作室座艙」內部件裡响应式覆蓋率最低的一個:
- 60 行容器 `fixed bottom-6 right-6 z-50`——不分桌機/手機,同一組固定位移。
- 63 行主動泡泡 `w-64`(256px)、93 行協作面板 `w-72`(288px),兩者都**沒有** `max-w-[calc(100vw-...)]` 或 `min(92vw, ...)` 這類視窗相對兜底(對照同專案 `design-kit/orb.tsx:373` 的 `w-[min(92vw,380px)]`,是同一個「光球助手」概念但寫法品質差異很大)。288px+right-6(24px)=312px,在 320px 寬手機上只剩 8px 邊界,任何字級縮放/瀏覽器 UI 差異都可能溢出。
- **與 `CockpitColumns` 手機底部分頁列的位置衝突(本次新發現,程式碼可直接判定)**:`DirectorConsole.tsx` 把 `<CockpitColumns>` 與 `<AmbientOrb />` 掛成兄弟節點(38-46 行)。`CockpitColumns.tsx:57-58` 在 `<lg`(手機/平板)會渲染一條 `sticky bottom-0 z-20 ... lg:hidden` 的欄位切換分頁列(脊椎/畫布/Context),而 `AmbientOrb` 的 FAB 是 `fixed bottom-6 right-6 z-50`——z-index 50 > 20,兩者在螢幕右下角同一水平帶重疊:分頁列吃滿全寬、緊貼視窗底部,光球 FAB(`size-14`=56px)幾乎必然疊在分頁列右側按鈕(通常是 Context 分頁)之上,導致該分頁在手機上視覺被蓋住、可能連帶影響點擊區域。
- 影響對象:觸控使用者(座艙手機版分頁列右側按鈕可能被光球 FAB 遮擋/難以點擊)、所有窄螢幕使用者(泡泡/面板邊緣溢出風險)。
- 建議:(1)比照 `design-kit/orb.tsx` 的 `w-[min(92vw,Npx)]` 寫法補上 `AmbientOrb` 泡泡/面板的視窗相對寬度;(2)`<lg` 時把 `AmbientOrb` 的位置往上位移(例如疊加 `CockpitColumns` 分頁列的高度作為 `bottom` 偏移),或整合進 §5.2 建議的「行動版浮動元件角落治理規則」統一處理,不要各元件各自 `fixed`。
- cluster:responsive-touch
- needsVisual:是(精確重疊像素量建議截圖/在 `ENABLE_4SHELL`+`ENABLE_VIDEO_COCKPIT` 開啟情境下複驗;本文件只確認程式碼結構上兩者必然出現在同一畫面且座標帶重疊)

### H3. FocusFlowMini 刪除想法鈕——hover-only,無 isMobile/無 focus-visible,鑲嵌於手機專用光球面板內
**檔案:`client/src/components/FocusFlowMini.tsx:279-285`;渲染於行動專用面板 `client/src/components/ProactiveOrbWidget.tsx:2687-2723`(`isMobile &&` 區塊)、`:3178-3182`(`panelView === "focus-flow"` 分頁)**

```tsx
<button
  onClick={() => removeThought(t.id)}
  className="opacity-0 group-hover:opacity-100 min-h-[44px] min-w-[44px] flex items-center justify-center hover:text-red-400 transition-all shrink-0"
  aria-label="刪除"
>
```
觸控目標尺寸(`min-h-[44px] min-w-[44px]`)本身是對的,`aria-label="刪除"` 也有——但**顯示邏輯只有 `opacity-0 group-hover:opacity-100`,沒有任何 `isMobile` 分支、也沒有 `focus-visible:opacity-100`**。對照同專案 `ProgressivePromptBuilder.tsx:810/1993/2005`、`ProjectNotesDrawer.tsx:158` 同款「刪除鈕 hover 顯示」模式都有 `isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"` 這一段——`FocusFlowMini` 是本次掃描中唯一一個**完全沒有任何裝置分支**的同款案例。
更關鍵的是:這顆按鈕不是隨便一個桌面表格的次要動作,而是**直接鑲嵌在手機專用的光球互動底部彈出面板裡**(`ProactiveOrbWidget.tsx` 的 `isMobile &&` fullscreen bottom sheet,對應 S4 場景 C「光球對話下指令」的既有元件)——這代表在觸控裝置上(沒有 `:hover` 狀態),這顆「刪除想法」按鈕永遠不透明化,使用者除非盲摸整行才可能誤觸,等於**該功能在光球手機面板裡功能性不可用**,是本次掃描中 hover-only 觸控無替代的最嚴重具體案例(比已知 Y8 案例更嚴重,因為 Y8 的 `ProjectNotesDrawer` 已用 `isMobile` 正確處理視覺,問題只在鍵盤 focus-visible)。
- 影響對象:觸控使用者(功能性不可發現/不可用)、鍵盤使用者(同樣沒有 `focus-visible` 對應)。
- 建議:比照同檔案(`ProgressivePromptBuilder.tsx`)已有的 `isMobile ? "opacity-100" : "..."` pattern 補上裝置分支,並加 `focus-visible:opacity-100`。
- cluster:responsive-touch
- needsVisual:否(`opacity-0` 且無任何 device/`focus`分支可直接由程式碼判定)

### H4. QuickFeedbackButton(全站浮動快速回饋鈕)——FAB 40px 觸控目標不足 + 面板固定寬度無視窗兜底,全站掛載
**檔案:`client/src/components/QuickFeedbackButton.tsx:150-167`;掛載處 `client/src/components/DashboardLayout.tsx:959`**

`QuickFeedbackButton.tsx` 全檔 **0 個 `useIsMobile`/`isMobile`、0 個 `sm:/md:` 斷點**:
- 150-157 行浮動 FAB:`className="fixed bottom-24 right-4 z-[99996] flex size-10 items-center justify-center rounded-full ..."`——`size-10`=**40px**,低於 WCAG 2.5.5/Apple HIG 建議的 44px 最小觸控目標,且沒有任何裝置分支放大。
- 161-167 行展開面板:`className="fixed bottom-24 right-4 z-[99996] w-80 rounded-2xl ..."`——`w-80`=**320px** 固定寬,加上 `right-4`(16px)=336px,**沒有** `max-w-[calc(100vw-...)]` 兜底。320px 寬視窗(iPhone SE 等)本身就等於面板寬度,任何邊界都會溢出;360-375px 機型也只剩 24-39px 邊界,面板內含 `Select`(功能區域下拉)、`Textarea`、截圖按鈕等多元件,擁擠度高。
- 由 `DashboardLayout.tsx:959`(`{ENABLE_QUICK_FEEDBACK && user && <QuickFeedbackButton />}`)全站掛載(旗標開時),影響面是**所有登入頁面**,不像 `AmbientOrb` 只在座艙。
- 影響對象:觸控使用者(FAB 觸控目標不足、面板窄螢幕溢出)。
- 建議:FAB 尺寸提升到 `size-11`(44px)或用 `min-h-[44px] min-w-[44px]`;面板改 `w-full max-w-80` 或 `w-[min(90vw,320px)]` 之類寫法(可直接抄 `design-kit/orb.tsx`/`GlobalOrbChatContext.tsx` 已驗證的 `max-w-[calc(100vw-2rem)]` pattern)。
- cluster:responsive-touch
- needsVisual:否(尺寸與 class 均可由程式碼直接判定)

### H5. ImageStudio 生成結果卡 / 姿勢圖卡「查看全尺寸」動作 hover-only,無觸控替代——與 S4「模範頁」評價有落差
**檔案:`client/src/pages/ImageStudio.tsx:989-1017`(生成結果卡)、`:1163-1194`(骨骼姿勢圖卡)**

兩張卡片都是「圖片 + `absolute inset-0 ... opacity-0 group-hover:opacity-100`」覆蓋層,內含「下載/全尺寸/編輯」等動作按鈕,**沒有任何 `isMobile` 分支或 `!isMobile &&` 包裹**(對照同頁 `AssetsLibrary.tsx:1091-1093` 明確寫了「Desktop hover overlay」註解並用 `!isMobile &&` 包裹,同專案已有正確示範,但 ImageStudio 這兩張卡沒有跟進)。
逐一核對「hover overlay 動作」是否在卡片下方有恆常可見的替代按鈕:
- 生成結果卡:hover overlay 有「下載/全尺寸/編輯」(996-1013 行);下方恆常動作列(1038-1066 行)有「下載/編輯/複製 URL」——**「全尺寸(查看大圖)」只存在於 hover overlay,沒有恆常替代**。
- 姿勢圖卡:hover overlay 只有「全尺寸」(1170-1178 行);下方恆常動作列(1181 行起)是「複製 URL」等——同樣**「全尺寸」沒有任何觸控可達的替代入口**。
ImageStudio 在 S4 文件被評為「行動模範」(44px+sticky tab+alt 齊備),但「查看生成結果全尺寸圖」正是創作者確認生成品質的關鍵動作,在觸控裝置上完全依賴 hover 且無替代,屬於模範頁裡的具體落差。
- 影響對象:觸控使用者(無法查看生成圖/姿勢參考圖的全尺寸版本,只能靠圖片本身在卡片內的縮小顯示判斷)。
- 建議:比照 `AssetsLibrary.tsx` 的 `!isMobile &&` 分流,行動版把「全尺寸」按鈕移到恆常可見的動作列(或讓圖片本身可點擊開全尺寸)。
- cluster:responsive-touch
- needsVisual:否(overlay 觸發條件與恆常動作列內容差異可由程式碼直接比對)

### H6. Studio.tsx(創作工作室首頁)3 處「文字用 `hidden sm:inline` 藏起、無 aria-label/title 替代」+ 觸控目標 <44px
**檔案:`client/src/pages/Studio.tsx:2429-2443`(工具箱鈕)、`:2704-2716`(創作模式 TabsTrigger);對照 `:2445-2467`(進階創作入口,已有 `title` 兜底,見下方負向對照)**

Studio 是四大高流量創作頁之一(S4 §1.1 分級「中低」),本次確認其獨有的響應式缺陷(全庫 grep,`hidden sm:inline` 僅出現在本檔 3 處,DirectorAI/AnimationStudio/ProStudio/VideoStudio/ImageStudio 皆無此寫法):

1. **工具箱按鈕**(2429-2443 行):`<Button size="sm" className="... h-8">`,內容 `<Briefcase/><span className="hidden sm:inline">工具箱</span>`——`hidden` 在 CSS 是 `display:none`,依 accessible-name 計算規則,`display:none` 的內容**不列入**可及名稱計算,且此 Button **沒有** `aria-label`/`title` 兜底。手機視窗(<640px)下,這顆按鈕唯一可辨識文字消失,螢幕閱讀器只會唸出「按鈕」(Lucide icon 預設不帶語意),使用者聽不出這是「開啟工具箱」——這正是 S4/AX1 已知「行動 icon-only 按鈕無 aria-label」模式(原案例在 DirectorAI.tsx:4485-4520),本次確認**同款缺陷也存在於 Studio.tsx 這個創作首頁**,且是使用者開啟工具箱(vault/assets/models/controls)的**唯一入口**。
2. **創作模式 TabsTrigger**(2704-2716 行):Radix `TabsTrigger` 同款 `{t.icon}<span className="hidden sm:inline">{t.label}</span>`,同樣沒有 `aria-label`,是「圖像/影片/語音/音樂」四個生成模式切換的核心導覽控制,行動版可及名稱一樣會消失。
3. **對照**:同一批按鈕裡的「進階創作入口」(2456-2466 行)反而正確,`title={advanced.label}` 有補上(title 屬性在無其他命名機制時會被納入可及名稱計算)——顯示同一位開發者在同一段程式碼裡對三個按鈕的無障礙處理**不一致**,並非「整批都沒做」,而是漏了其中兩個。

觸控目標同樣不足:`size="sm"` 對應 `ui/button.tsx:27` 的 `h-8`(32px 固定高),`TabsTrigger` 是 `py-2.5 text-xs`(約 10px+16px+10px≈36px)——兩者皆低於 44px,且**沒有隨 `isMobile` 放大**(對照同檔案 3618-3629 行手機 `BottomSheet` 內的工具箱分頁鈕也是 `py-2 text-xs`,約 32px,同樣偏小)。
- 影響對象:螢幕閱讀器使用者(手機模式下 2 個核心控制項可及名稱消失)、觸控使用者(觸控目標 <44px)。
- 建議:兩處各補 `aria-label`(工具箱鈕用固定字串,TabsTrigger 用 `aria-label={t.label}`);`size="sm"` 在 `isMobile` 時比照 ImageStudio 已驗證的 `min-h-[44px]` 覆蓋高度。
- cluster:aria-sr / responsive-touch
- needsVisual:否

---

## 中(P2)

### M1. AnimationStudio header(已知 S4 反例延伸確認):Trash2 刪除世界鈕零 aria-label + 觸控高度精算
**檔案:`client/src/pages/AnimationStudio.tsx:5999-6076`**

S4 §1.1 已把 AnimationStudio 列為「崩」(0 `useIsMobile`、0 `dark:`),本次逐行確認細節:6 顆 header 按鈕(5999/6014/6049/6065 行)全部 `size="sm" className="h-8 text-xs ..."`(32px,對照 `ui/button.tsx:27`),且整段 `secondaryActions`(5996-6076 行)沒有任何 `isMobile`/`sm:` 判斷。其中 **6065-6076 行「刪除世界」按鈕是純圖示**(`<Trash2 className="w-3.5 h-3.5" />`,無文字、無 `aria-label`、無 `title`)——這是一個**破壞性動作**(點擊後 `confirm()` 刪除世界觀),在所有裝置(不限行動)上對螢幕閱讀器使用者都是「無名稱按鈕」,行動觸控上又只有 32px 高。`6038` 行 `SelectTrigger className="h-8 w-[220px] text-xs"` 固定寬 Select 雖然包在 `flex ... flex-wrap` 容器內不至於撐爆版面造成頁面級水平捲動,但配合其餘 5 顆按鈕在窄螢幕會擠成多行、可用性差,呼應 S4 已有結論。
- 影響對象:螢幕閱讀器使用者(刪除世界鈕無可及名稱,且是破壞性動作風險更高)、觸控使用者(6 顆 32px 按鈕)。
- 建議:刪除世界鈕至少補 `aria-label="刪除世界觀"`;整組 header 導入 `useIsMobile` 後在行動版改用 44px 高度或收進選單。
- cluster:aria-sr / responsive-touch
- needsVisual:否

### M2. `ui/button.tsx`:`size="sm"` 缺少 `size="lg"` 已有的 44px 手機底線,DirectorAI 等頁的行動圖示鈕因此固定卡在 32px
**檔案:`client/src/components/ui/button.tsx:25-28`**

```
size: {
  default: "h-9 px-4 py-2 has-[>svg]:px-3 md:h-9",
  sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
  lg: "min-h-[44px] h-11 rounded-md px-6 has-[>svg]:px-4 md:min-h-0 md:h-10",
},
```
`size="lg"` 已經是「手機 `min-h-[44px]` 兜底,桌機(`md:`)才放寬回 `h-10`」的正確 pattern——顯示設計系統其實知道這個規則,但只套用在 `lg`。`size="sm"`(`h-8`=32px)沒有對應的 `isMobile`/`md:` 分流,而 DirectorAI 已知的行動圖示按鈕(`DirectorAI.tsx:4485-4520`,`isMobile ? "" : "模板"` 等)、Studio.tsx 的工具箱鈕(H6)、AnimationStudio header(M1)都是用 `size="sm"`,因此全部固定卡在 32px,無法用「換個 size」簡單修正。
- 影響對象:觸控使用者(全站使用 `size="sm"` 的行動場景觸控目標系統性偏小)。
- 建議:比照 `lg` 的寫法,在 `sm` 也加上 `min-h-[44px] ... md:min-h-0 md:h-8`,一次性讓所有使用 `size="sm"` 的行動可見按鈕達標,而非逐頁補丁。
- cluster:responsive-touch
- needsVisual:否

### M3. MultimodalSuggestCard 與 QuickFeedbackButton 共用近乎相同的 `fixed bottom-24 right-4/5` 定位點,同頁顯示會重疊
**檔案:`client/src/components/orb-agent/MultimodalSuggestCard.tsx:30`(用於 `client/src/pages/AgentChat.tsx:2979`)、`client/src/components/QuickFeedbackButton.tsx:153/163`**

全庫 grep `bottom-24 right-` 命中 7 處,其中 `orb-agent/` 下 5 個卡片裡**只有 `MultimodalSuggestCard` 實際被消費**(其餘 4 個——`CostGateCard`/`PerceptionVerdictCard`/`PreferenceNudgeCard`/`StepByStepConfirmCard`——全庫搜尋沒有任何呼叫端引用,屬未接線的死碼,不影響本次判定)。`MultimodalSuggestCard` 定位 `fixed bottom-24 right-5 z-[86]`,`QuickFeedbackButton` FAB/面板定位 `fixed bottom-24 right-4 z-[99996]`——兩者 `bottom` 完全相同、`right` 只差 1px(20px vs 16px),若 `AgentChat` 頁面(掛在 `DashboardLayout` 下)同時顯示兩者(`QuickFeedbackButton` 只要 `ENABLE_QUICK_FEEDBACK` 開啟且已登入即常駐,`MultimodalSuggestCard` 在多模態建議情境觸發),`QuickFeedbackButton`(z-index 99996)會直接蓋在 `MultimodalSuggestCard`(z-index 86)之上,擋住建議卡的部分內容/按鈕。
- 影響對象:觸控使用者(建議卡動作按鈕可能被回饋鈕遮擋)。
- 建議:兩者其中之一改變 anchor(例如 `MultimodalSuggestCard` 改用 `bottom-40` 或依 `QuickFeedbackButton` 是否掛載動態避讓),或納入 §H2/H4 建議的「浮動元件角落治理規則」統一協調。
- cluster:responsive-touch
- needsVisual:是(需在 `ENABLE_QUICK_FEEDBACK` 開啟且 AgentChat 觸發多模態建議的情境下實機/截圖複驗是否真的同時顯示)

---

## 已知項目延伸確認(依指示逐一核對)

- **Y8(ProjectNotesDrawer 刪除鈕 hover-only)**:重新從「觸控」角度核對——`ProjectNotesDrawer.tsx:158-161` 的 `isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"` **在觸控層面其實已正確處理**(AX1 M4 談的是鍵盤 `focus-visible` 缺失,非觸控可用性問題)。但本次擴大同款式(`opacity-0 group-hover:opacity-100`)掃描全庫 26 處命中,發現**擴散不一致**:`ProgressivePromptBuilder.tsx`(810/1993/2005 行)、`ConsistencyVault.tsx`(170 行)都正確做了 `isMobile` 分支,但 `FocusFlowMini.tsx:281` **完全沒有**——見本文件 H3,是本次對 Y8 案例最重要的延伸發現(同款式裡最糟的一個反例,且位置在手機專用光球面板內,比原案例影響更大)。
- **FE-03(素材快捷鈕永久 `hidden`)**:從響應式角度重新檢視——四處 `hidden` 是**無條件**隱藏(非 `hidden sm:flex` 這種斷點式寫法),因此不是「響應式設計缺陷」本身,兩端(桌機/觸控)一致不可達,AX1 H3 的判定不需要修正。但本次額外發現:若照 AX1 建議直接移除 `hidden`,`AssetsQuickDrawer` 本身在手機上會立刻踩到 H1 的 Sheet 寬度覆寫 bug——兩張修復卡建議合併處理(見 H1)。
- **Y5(SiteOnboardingOverlay spotlight 目標多數不存在)**:從行動角度重新檢視——`SiteOnboardingOverlay.tsx` 的 spotlight 定位邏輯本身用 `getBoundingClientRect()`(程式碼判斷不到手機專屬問題),21 個 `targetId` 中僅 7 個存在對應元素是**全裝置一致**的問題(AX1 M5 已完整記錄),本次未發現額外的「僅行動端」問題;真正的行動端風險是**若目標元素本身只在某個斷點才 `hidden`/`lg:block` 顯示**(例如導覽項目在手機收進抽屜、`id` 元素不在 DOM 內),會讓「找不到目標」的比例在手機上比桌機更高,但這需要逐一核對每個 `targetId` 元素的響應式可見性,本次未逐一複核(列入未涵蓋)。
- **S4(mobile-first 既有分析)**:S4 §1.2 提出「四個浮動元件(`ProactiveOrbWidget`/`AidvOrbMount`/`QuickFeedbackButton`/`AppleDock` bubble)搶手機畫面角落空間」的疑慮,本次逐一核對實際定位座標後可以**部分修正**這個推測:
  - `AppleDock` 的 `MinimizedBubble`(`mobileCorner` 分支,`AppleDock.tsx:409-410`)刻意錨定在**左上角**(`left-3 top-[...]`),刻意避開右下角,不與其餘三者衝突——這是正確設計,非風險項。
  - `AidvOrbMount` 使用 `OrbAssistant position="bl"`(**左下角**,`AidvOrbMount.tsx:117`),與 `ProactiveOrbWidget`/`QuickFeedbackButton` 預設的**右下角**也是分開的。
  - 真正會搶同一角落的只剩 `ProactiveOrbWidget`(右下角,`inset` 1rem/1.5rem,`ProactiveOrbWidget.tsx:3227-3239`)與 `QuickFeedbackButton`(`bottom-24 right-4`)——實測座標差距約 24px(不重疊但很緊),見 H4/M3。S4 的「四個都搶角落」結論建議更新為「只有右下角 2 個元件有實際近距離風險,左上/左下已由既有設計錯開」。

---

## 低(P3)

### L1. AnimationStudio 全頁 0 `useIsMobile`(重申,不重複列 M1 已涵蓋範圍外的細節)
S4 §1.1 已完整記錄「146 Input + 98 Select 單頁、0 `useIsMobile`、0 `dark:`」,本次未發現超出 S4/M1 範圍的新增細節,故不重複展開,僅在此存查與 M1 互相參照。
- cluster:responsive-touch
- needsVisual:否

---

## 已正確處理(Negative Results,供對照避免重工)

1. **`CockpitColumns.tsx`**(`shells/video/console/CockpitColumns.tsx`):手機三欄→分頁化的實作品質高——`lg:contents` 讓桌機版面「零變化」,`<lg` 時只顯示 active 分頁、底部 `sticky` 分頁列補 `role="tablist"`/`role="tab"`/`aria-selected`(57-82 行),是本次掃描裡「桌機/行動分流」寫得最乾淨的座艙元件(僅 H2 指出它與 `AmbientOrb` 的位置衝突,元件本身無問題)。
2. **`ProactiveOrbWidget.tsx` 行動版底部彈出面板**(2687-2723 行):`role="dialog" aria-modal="true"`、`maxHeight: "85vh"`、`paddingBottom: env(safe-area-inset-bottom, 0px)`,桌面/行動版面完全分流(`{!isMobile && ...}` / `{isMobile && ...}`),FAB 主體 `!w-12 !h-12`(48px,達 44px 標準,3976-3986 行),`drag` 在 `isMobile` 時關閉(3195 行)避免觸控誤觸拖曳,角落定位含 `env(safe-area-inset-*)` 四方向處理(3227-3239 行)——是本次掃描中行動端浮動元件實作最完整的範例(僅 H3 指出其內部 `FocusFlowMini` 子元件本身有 hover-only 缺陷)。
3. **`design-kit/orb.tsx`(`OrbAssistant`)**:FAB `size-14`(56px,94 行),面板 `w-[min(92vw,380px)]` + `max-h-[min(72vh,560px)]`(373 行)——**視窗相對寬高兜底**寫得比同專案任何其他光球元件都完整,建議作為 `AmbientOrb`(H2)/`QuickFeedbackButton`(H4)修復時的抄寫範本。
4. **`GlobalOrbChatContext.tsx`**(1217/1480/1572/1694/1867/1910/1960/6553 行,共 8 處浮動確認卡):全部一致採用 `w-full md:w-[Npx] max-w-[calc(100vw-2rem)]` pattern,窄螢幕保證不溢出,是本次掃描中「同類元件重複出現且每次都做對」的最佳案例。
5. **`orb-agent/*.tsx`**(`CostGateCard`/`MultimodalSuggestCard`/`PerceptionVerdictCard`/`PreferenceNudgeCard`/`StepByStepConfirmCard`,5 個檔案):即使多數未被實際呼叫(死碼),寫法上也都一致含 `max-w-[calc(100vw-2rem)]` 安全網,顯示團隊在這個模式上有共識,只是沒推廣到 `AmbientOrb`/`QuickFeedbackButton`。
6. **`AssetsLibrary.tsx:1091-1093`**:hover overlay 明確標註「Desktop hover overlay」註解並用 `{!isMobile && (...)}` 包裹,避免觸控裝置繼承桌機限定互動——與 H5 指出的 `ImageStudio.tsx` 相同 hover overlay 模式但沒做這層防護形成對比,可作為 `ImageStudio` 修復時的同專案範本。
7. **`AppleDock.tsx` `MinimizedBubble`**(393-450 行):行動版錨定左上角(`mobileCorner` 分支,409-410 行),`h-12 w-12`(48px,426 行)達 44px 標準,含 `env(safe-area-inset-top)`,且刻意避開右下角浮動元件聚集區(見「已知延伸確認」S4 段落)。
8. **`DirectorAI.tsx:5370`**:`className={cn("shrink-0", isMobile ? "w-full" : "w-[280px]")}`——固定寬度僅在桌機生效,手機正確改為 `w-full`,是本次掃描中「固定 px 寬度隨裝置切換」的正確示範。

---

## 附註:本次未覆蓋
- 真實裝置渲染/實機觸控走查(iOS Safari `sticky`/`fixed` 混合行為、`position:fixed` 元素是否在特定瀏覽器造成頁面級水平捲動)——本文件的溢出判定以「寬度數值 vs 常見視窗寬度」的靜態推算為主,凡涉及此類皆已標記 needsVisual。
- 顏色對比、暗色/亮色模式可見度——不在本次「可從程式碼判定」範圍內。
- `shells/video/drawers/*`、`shells/video/panels/*` 內部表單控制項逐一觸控目標量測未展開(外層皆由 Radix `Sheet` 包住,本文件聚焦座艙外層容器/浮動元件/高流量頁首屏,面板內部 widget 級細節建議列入後續稽核)。
- Y5 SiteOnboarding 21 個 `targetId` 逐一核對其對應元素在各斷點的可見性(是否被 `hidden`/`lg:block` 等 class 排除)——本次僅指出風險方向,未逐一複核。
- ProStudio.tsx / VideoStudio.tsx 的觸控目標與固定寬度未逐行覆蓋(S4 已有概略分級,本文件聚焦 Studio/DirectorAI/光球/座艙,未再重複展開這兩頁的細節掃描)。
