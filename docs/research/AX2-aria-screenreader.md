# AX2 — ARIA/螢幕閱讀器/語意
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:圖示按鈕、圖片、表單、自訂 widget、狀態通知

> 方法論:僅回報「從程式碼可靜態判定」的問題(缺 aria/label/alt、hover-only 顯示、永久 hidden、
> 無鍵盤 handler、Tailwind 固定像素觸控過小、無響應式斷點)。對比度、實際螢幕閱讀朗讀順序等需要
> 渲染才能確認者一律標記「需視覺驗證」。聚焦高流量頁:`Studio.tsx`(創作工作室)、
> `ImageStudio.tsx`/`ProStudio.tsx`/`VideoStudio.tsx`、`DirectorAI.tsx`、光球
> `ProactiveOrbWidget.tsx`/`SiteOnboardingOverlay.tsx`、社群座艙 `SocialCockpitPage.tsx`,並延伸既有
> 已知發現(Y8 刪除鈕、FE-03 hidden 快捷鈕、Y5 spotlight 目標、S4 mobile-first)。

---

## 發現總覽(依嚴重度)

| # | 嚴重度 | 一句話 | cluster |
|---|---|---|---|
| 1 | High | `GenerationControls.tsx` 全站核心生成參數(創意溫度/LoRA 權重/種子碼)的 `<Label>` 均未與控制項用 `htmlFor`/`id` 綁定 | aria-sr |
| 2 | High | `ProgressivePromptBuilder.tsx` 主要「創作描述」Textarea 沒有 `id`/`htmlFor`/`aria-label`,僅靠視覺相鄰的 Label | aria-sr |
| 3 | High | `ProactiveOrbWidget.tsx`(全站光球聊天)送出按鈕(icon-only)完全無 `aria-label`/`title` | aria-sr |
| 4 | High | `Studio.tsx` 共用 `DrawerPanel` 關閉鈕(icon-only)沒有 `aria-label`,即使元件已收到 `title` prop 卻沒接上 | aria-sr |
| 5 | High | `ImageStudio.tsx` 生成歷史書籤切換鈕 icon-only,無 `aria-label`/`aria-pressed`,觸控區域僅 20px | aria-sr / responsive-touch |
| 6 | High | (延伸確認 FE-03)素材庫快捷開啟鈕在 ImageStudio/ProStudio/VideoStudio/DirectorAI 四處皆用字面 `"hidden ..."` class 永久 `display:none`,`AssetsQuickDrawer` 全站鍵盤與螢幕閱讀器都不可達 | other |
| 7 | High | `DirectorAI.tsx` 兩處面板關閉鈕(「快速生成管道」「匯出腳本」)icon-only,無 `aria-label`/`title` | aria-sr |
| 8 | Medium | `ImageStudio.tsx` 3D 模型選項區三個 `Switch`+`Label` 沒有 `id`/`htmlFor`(對照同庫已正確處理範例) | aria-sr |
| 9 | Medium | `ProjectNotesDrawer.tsx` `QuickSaveForm` 標籤刪除用 `<Badge>`(渲染為 `<span>`)+`onClick`,無 `role="button"`/`tabIndex`/鍵盤 handler | keyboard-focus |
| 10 | Medium | `Studio.tsx` `MiniAssetsPanel`/`MiniModelsPanel` 載入骨架沒有 `role="status"`/`aria-live`,同頁 `AssetsQuickDrawer` 已有對照組 | aria-sr |
| 11 | Medium | (延伸確認 Y8)`ProjectNotesDrawer` 刪除鈕除了已知 hover-only,還完全缺 `aria-label`(icon-only `Trash2`),觸控區域僅 22px | aria-sr / responsive-touch |
| 12 | Medium | (延伸確認 Y5)22 個 tour 步驟中 15 個 `targetId` 在目前 DOM 查無對應 `id`,Spotlight 對多數步驟靜默退化為全螢幕置中卡 | other |
| 13 | Medium | `ImageStudio.tsx` `T2iQuickStartGuide` 卡片關閉鈕 icon-only 無 `aria-label`/`title`,觸控區域僅 22px | aria-sr / responsive-touch |
| 14 | Low | `SocialCockpitPage.tsx` 品牌色票用非互動 `<div title=hex>` 呈現,`title` 在多數螢幕閱讀器不會被朗讀 | aria-sr |
| 15 | Low | `Studio.tsx` `MiniAssetsPanel` 資產列表項目有 `cursor-pointer` 視覺樣式但完全沒有 `onClick`/`role`/`tabIndex` | semantics |
| 16 | Low | `ImageStudio.tsx`「清除全部」歷史紀錄鈕僅靠 `title` 作為 accessible name 後備,無顯式 `aria-label` | aria-sr |
| 17 | Low | `DirectorAI.tsx`「關閉面板」X 鈕同樣僅靠 `title`,無顯式 `aria-label` | aria-sr |

---

## 1.〔High〕核心生成參數 Label 未與控制項建立程式化關聯

**發現(附行號)**

`client/src/components/GenerationControls.tsx`:
- L60-63:創意/深度模式的 `<Label>` 沒有 `htmlFor`,對應的 `<Switch>`(L65-70)也沒有 `id`。
- L86-100:「創意溫度」`<Label>`(L87)沒有 `htmlFor`,`<Slider>`(L93-100)沒有 `id`/`aria-label`。
- L114-128:「LoRA 權重」同樣模式,`<Label>`(L115)與 `<Slider>`(L121-127)無關聯。
- L142-166:「種子碼」`<Label>`(L143)與 `<Input>`(L152-166)無 `htmlFor`/`id`,僅左右並排。

`GenerationControls` 掛載於 `client/src/pages/Studio.tsx:2643`(pro 模式)與 `:3657`(simple 模式),是創作工作室最核心的參數面板,每一種生成模態都會用到。

**影響對象**:螢幕閱讀器使用者。Tab 直接跳到 Slider/Input 時,朗讀不到「創意溫度」「LoRA 權重」「種子碼」等用途說明,只會聽到數值或空白,無法辨識控制項作用。

**對照(同檔案內已正確處理)**:同檔案內的三顆種子碼輔助按鈕(擲骰子 L167-178、沿用上次 L179-188、清空 L189-198)都正確加了 `aria-label`,顯示作者具備 a11y 意識,只是 Label/控制項綁定被遺漏。

**建議**:為每個 `<Label>` 補上對應 `htmlFor`,並在 `Switch`/`Slider`/`Input` 補上相同 `id`;`Slider` 另補 `aria-label`(Radix Slider 不會自動繼承外部 label 文字)。

---

## 2.〔High〕主要「創作描述」輸入框沒有可程式辨識的名稱

**發現**

`client/src/components/ProgressivePromptBuilder.tsx:1476-1509`:
```tsx
<Label className="...">
  {simpleMode ? "想創作什麼？" : "創作描述"}
</Label>
...
<Textarea
  placeholder={...}
  value={value.rawPrompt}
  onChange={...}
  rows={simpleMode ? 4 : 3}
  className="..."
/>
```
`Label` 與 `Textarea` 之間沒有 `htmlFor`/`id`,`Textarea` 本身也沒有 `aria-label`/`aria-labelledby`。此元件僅在 `client/src/pages/Studio.tsx` 掛載,是整個創作工作室唯一的主要提示詞輸入框。

**影響對象**:螢幕閱讀器使用者。跳至此 Textarea 時 accessible name 依賴瀏覽器對 `placeholder` 的非標準後備行為(並非所有 AT/瀏覽器組合都會朗讀 placeholder,且不屬於 W3C accname 計算鏈的正式來源),風險是使用者聽不到「創作描述」這個核心欄位的用途。

**建議**:`Textarea` 補 `id="prompt-builder-textarea"`,`Label` 補 `htmlFor="prompt-builder-textarea"`。

---

## 3.〔High〕全站光球聊天送出鈕完全無可辨識名稱

**發現**

`client/src/components/ProactiveOrbWidget.tsx:3719-3729`:
```tsx
<button
  onClick={handleChatSend}
  disabled={(!chatInput.trim() && chatAttachments.length === 0) || isChatLoading || isUploadingAttachments}
  className="p-1.5 rounded-lg hover:bg-muted/80 transition-colors disabled:opacity-30"
>
  {isChatLoading ? (
    <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
  ) : (
    <Send className="w-3.5 h-3.5 text-muted-foreground" />
  )}
</button>
```
沒有 `aria-label`、沒有 `title`、也沒有可見文字。`ProactiveOrbWidget` 是全站浮動光球,幾乎每個高流量頁都會掛載。

同區塊的附件上傳鈕(L3688-3699)雖有 `title="上傳圖像、影片、音訊或 PDF"` 可作為 accessible name 後備,但同樣缺少顯式 `aria-label`(見 #16/#17 同類問題)。聊天輸入框本身(L3704-3717)也只靠 `placeholder`,無 `aria-label`。

**影響對象**:螢幕閱讀器使用者。此鈕是送出訊息給 AI 光球的唯一按鈕,朗讀時只會聽到「按鈕」,完全無法判斷用途,是全站曝光面最大的一個 aria-sr 缺口。

**建議**:補 `aria-label="傳送訊息"`(loading 時可動態改為 `aria-label="傳送中"` 並加 `aria-busy="true"`);輸入框補 `aria-label="輸入訊息給光球"`。

---

## 4.〔High〕Studio 共用 DrawerPanel 關閉鈕未使用已傳入的 title 作為 aria-label

**發現**

`client/src/pages/Studio.tsx:171-209`:
```tsx
function DrawerPanel({ open, side, title, icon, onClose, children }: {...}) {
  return (
    ...
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        {icon}
        {title}
      </div>
      <button
        onClick={onClose}
        className="p-2 rounded-md hover:bg-accent/50 active:bg-accent/70 transition-colors"
      >
        <X className="w-4 h-4 text-muted-foreground" />
      </button>
    ...
  );
}
```
元件已經接收 `title: string` 這個 prop 且用於可見標題文字(L201),但關閉鈕完全沒有引用它做 `aria-label`。`DrawerPanel` 是 Studio 左側抽屜(保險庫/資產/模型/參數/配方/版本,見 L2479-2506 呼叫處)共用的殼層,高流量元件。

**影響對象**:螢幕閱讀器使用者。關閉每一種抽屜面板時都只聽到「按鈕」,聽不出關的是哪個面板。

**建議**:`aria-label={\`關閉${title}\`}`,一行修復即可覆蓋所有抽屜實例。

---

## 5.〔High〕ImageStudio 歷史書籤切換鈕無名稱、無狀態、觸控過小

**發現**

`client/src/pages/ImageStudio.tsx:1369-1390`:
```tsx
<div key={item.id} className="rounded-xl border border-border/30 overflow-hidden bg-background/50">
  <div className="relative">
    <img src={item.imageUrl} alt={item.prompt} .../>
    <div className="absolute top-1 right-1 flex gap-1">
      <button
        onClick={() => toggleBookmark(item.id)}
        className="p-1 rounded-md bg-black/50 text-white hover:bg-black/70 transition-colors"
      >
        {item.bookmarked ? (
          <BookmarkCheck className="w-3 h-3 text-amber-400" />
        ) : (
          <Bookmark className="w-3 h-3" />
        )}
      </button>
```
三個問題疊加:①無 `aria-label`/`title`,②切換狀態(已加入精選/未加入)只靠圖示替換,沒有 `aria-pressed`,③觸控區域 = `p-1`(上下左右各 4px)+ 圖示 `w-3 h-3`(12px)= 20×20px,低於 WCAG 2.5.8(AA)建議的 24×24px 最小值。

**影響對象**:螢幕閱讀器使用者(聽不到用途與目前狀態)、行動裝置觸控使用者(20px 熱區在生成歷史清單這種高互動密度頁面很容易誤觸相鄰項目)。

**建議**:補 `aria-label={item.bookmarked ? "取消精選" : "加入精選"}` + `aria-pressed={item.bookmarked}`;把 `p-1` 調整為至少 `p-2.5`(或用 `min-w-[44px] min-h-[44px]` + 內距置中)。

---

## 6.〔High,延伸確認 FE-03〕素材快捷鈕永久 hidden,螢幕閱讀器與鍵盤皆不可達

**發現(HEAD 現況核對)**

四個呼叫點目前行號與既有稽核記錄一致,均未修復:
- `client/src/pages/ImageStudio.tsx:4408-4414`
- `client/src/pages/ProStudio.tsx:4747-4753`
- `client/src/pages/VideoStudio.tsx:5096-5102`
- `client/src/pages/DirectorAI.tsx:4522-4531`

以 `ImageStudio.tsx:4408-4414` 為例:
```tsx
<button
  onClick={() => openAssetsDrawer()}
  className="hidden flex items-center gap-1.5 px-2.5 sm:px-3 py-2.5 rounded-xl border border-border/40 hover:bg-accent active:bg-accent/70 text-muted-foreground text-xs font-medium transition-all min-h-[44px]"
  aria-label="開啟素材庫"
>
  <Package className="w-3.5 h-3.5" /> 素材
</button>
```
`className` 字面上以 `"hidden "` 開頭且**沒有任何響應式斷點前綴**(如 `sm:flex`)解除它,Tailwind 的 `display` 工具類互斥且共用同一特異度,`hidden`(`display:none`)在產生的樣式表中排序在 `flex` 之後,永遠覆蓋 `flex`——按鈕在任何尺寸都是 `display:none`。

**影響對象**:全體使用者(視覺、鍵盤、螢幕閱讀器皆不可達,`display:none` 元素不會進入 accessibility tree,也拿不到 focus)。雖然 `aria-label`/`min-h-[44px]` 都已正確設置,但元素根本不存在於畫面與 tab 順序中,這些正確設置形同虛設。

**建議**:延續 Y9 建議——移除開頭的 `"hidden "` 或改成 `feature-flag` 條件渲染,而非留下語法正確但視覺/語意雙重不可達的 JSX。

---

## 7.〔High〕DirectorAI 兩處面板關閉鈕無名稱

**發現**

`client/src/pages/DirectorAI.tsx:1323-1336`(快速生成管道面板):
```tsx
<button onClick={onClose} className="text-muted-foreground hover:text-foreground">
  <X className="w-3.5 h-3.5" />
</button>
```
`client/src/pages/DirectorAI.tsx:1949-1962`(匯出腳本面板):
```tsx
<button onClick={onClose} className="text-muted-foreground hover:text-foreground">
  <X className="w-4 h-4" />
</button>
```
兩處都沒有 `aria-label`/`title`,可見標題文字("快速生成管道"、"匯出腳本")就在同一個 flex row 裡卻沒有連到按鈕。

**影響對象**:螢幕閱讀器使用者,關閉面板時聽不到關的是哪個面板。

**建議**:仿造 `DrawerPanel` 修法,直接引用旁邊的標題字串做 `aria-label={\`關閉${標題}\`}`。

---

## 8.〔Medium〕ImageStudio 3D 模型選項 Switch 缺 htmlFor/id(同庫內有正確對照組)

**發現**

`client/src/pages/ImageStudio.tsx`:
- L2593-2597(啟用 PBR 材質)
- L2750-2754(Hyper 加速)
- L2795-2799(匯出 Draco 壓縮 export_drc)

三處都是:
```tsx
<Label className="text-xs text-muted-foreground">啟用 PBR 材質</Label>
<Switch checked={enablePbr} onCheckedChange={setEnablePbr} />
```
`Label` 無 `htmlFor`,`Switch` 無 `id`。

**對照(同代碼庫已正確處理)**:
- `client/src/pages/DirectorAI.tsx:1990-1997`:`<Switch id="inc-discussion" .../>` + `<Label htmlFor="inc-discussion">含討論紀錄</Label>`
- `client/src/pages/ProStudio.tsx:1313-1320`:`<Switch id="instrumental" .../>` + `<Label htmlFor="instrumental">`

顯示這是遺漏而非能力問題,ImageStudio 的 3D 選項區塊沒有沿用專案內既有的正確模式。

**影響對象**:螢幕閱讀器使用者,Tab 到 3D 生成選項的開關時聽不到用途說明。

**建議**:比照 DirectorAI/ProStudio 既有寫法補上 `id`/`htmlFor`。

---

## 9.〔Medium〕QuickSaveForm 標籤刪除無鍵盤支援

**發現**

`client/src/components/ProjectNotesDrawer.tsx:276-289`:
```tsx
{tags.map(tag => (
  <Badge
    key={tag}
    variant="secondary"
    className="text-[10px] gap-1 cursor-pointer"
    onClick={() => setTags(tags.filter(t => t !== tag))}
  >
    {tag} <X className="w-2.5 h-2.5" />
  </Badge>
))}
```
`Badge`(`client/src/components/ui/badge.tsx:35`)預設渲染為 `<span>`,是非互動元素。此處僅加 `onClick`,沒有 `role="button"`、沒有 `tabIndex={0}`、沒有 `onKeyDown` 處理 Enter/Space。

**影響對象**:鍵盤操作使用者。滑鼠使用者可以點掉標籤,但純鍵盤使用者無法 Tab 到這個標籤並刪除它,螢幕閱讀器也不會把它識別成可互動元素(不會被當成 button 朗讀,也進不了 tab 順序)。

**建議**:改用 `<button type="button">` 包裹,或加上 `role="button" tabIndex={0} onKeyDown={e => (e.key === "Enter" || e.key === " ") && removeTag(tag)}`,並補 `aria-label={\`移除標籤 ${tag}\`}`。

---

## 10.〔Medium〕Studio 左抽屜載入骨架無 aria-live(同頁已有正確對照組)

**發現**

`client/src/pages/Studio.tsx`:
- `MiniAssetsPanel`(L3712-3725):`myAssetsQuery.isLoading` 時回傳 `<div className="p-3 space-y-2">{skeleton...}</div>`,無 `role`/`aria-live`。
- `MiniModelsPanel`(L3820-3828):同樣模式。

**對照(同代碼庫已正確處理)**:`client/src/components/AssetsQuickDrawer.tsx:240` 的載入骨架就有 `role="status" aria-label="載入素材中"`,`:246` 的錯誤狀態也有 `role="alert"`。

**影響對象**:螢幕閱讀器使用者。切換 Studio 左抽屜到「資產」「模型」分頁時,載入中的狀態不會被主動朗讀,使用者只能盲猜。

**建議**:比照 `AssetsQuickDrawer` 加上 `role="status" aria-label="載入中"`。

---

## 11.〔Medium,延伸確認 Y8〕刪除鈕除了 hover-only,還完全缺 aria-label 且觸控過小

**發現**

`client/src/components/ProjectNotesDrawer.tsx:156-161`(HEAD 現況核對,行號與既有 Y8 記錄一致):
```tsx
<button
  onClick={() => onDelete(note.id)}
  className={`transition-opacity p-1 rounded hover:bg-red-500/20 text-muted-foreground/40 hover:text-red-400 ${isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
>
  <Trash2 className="w-3.5 h-3.5" />
</button>
```
除了 Y8 已記載的 hover-only 顯示(桌面版無 `focus-visible:opacity-100`)之外,本次額外確認:①按鈕完全沒有 `aria-label`/`title`,icon-only 且無任何可辨識名稱;②觸控區域 = `p-1`(4px×2)+ `w-3.5 h-3.5`(14px)= 22×22px,低於 WCAG 2.5.8 建議的 24×24px 底線。

**影響對象**:螢幕閱讀器使用者(聽不到「刪除筆記」)、鍵盤使用者(沿用 Y8 的可視性問題)、觸控使用者(22px 熱區在筆記清單密集排列時容易誤觸)。

**建議**:三合一修復——`aria-label="刪除筆記"` + `focus-visible:opacity-100` + 加大 padding 至 `p-2`(達 30px,建議再放寬到符合 44px 或至少用 `min-w-[24px] min-h-[24px]`)。

---

## 12.〔Medium,延伸確認 Y5〕多數 tour 步驟的 spotlight 目標在 DOM 中不存在

**發現**

`client/src/contexts/SiteOnboardingContext.tsx` 的 `TOUR_DEFINITIONS` 定義了 22 個非 `null` 的 `targetId`,逐一用 `grep -rl "id=\"<targetId>\""` 核對 `client/src` 後,僅 7 個存在對應 DOM `id`:

| 存在 | 不存在(15 個) |
|---|---|
| `sidebar-nav`、`modality-tabs`、`prompt-builder-area`、`proactive-orb-anchor`、`learn-search`、`learn-category-filter`、`focus-flow-tabs` | `sidebar-studio-link`、`sidebar-pro-studio-link`、`sidebar-image-studio-link`、`sidebar-video-studio-link`、`sidebar-director-link`、`sidebar-learn-link`、`generate-button`、`pro-tab-music`、`pro-tab-voice`、`pro-tab-avatar`、`image-api-key-banner`、`director-chat-input`、`director-reset-btn`、`models-dataset-tab`、`history-search` |

`SiteOnboardingOverlay.tsx:369-385` 的邏輯是:`document.getElementById(targetId)` 找不到就把 `targetRect` 設為 `null`,外層據此判斷 `isCentered = ... || !targetRect`,靜默退化為全螢幕置中卡(`DarkBackdrop`),不會報錯也不會提示開發者。

**影響對象**:所有使用者(不限 a11y)。多數導覽步驟原本設計要「聚焦某個 UI 元素」,實際上卻變成「置中卡片 + 純文字描述一個畫面上找不到對應高亮的東西」,對螢幕閱讀器使用者尤其不利——文字描述會提到「點擊這裡」「這個按鈕」等指示性語言,但沒有對應的可聚焦/可高亮元素,喪失了空間指向的輔助意義。

**建議**:比照既有 Y5 建議,補上缺失的 `id`(側欄連結、生成按鈕、各分頁 tab 等),或若元素已改名/移除則同步更新 `TOUR_DEFINITIONS`。

---

## 13.〔Medium〕ImageStudio 新手提示卡關閉鈕無名稱、觸控過小

**發現**

`client/src/pages/ImageStudio.tsx:842-865`(`T2iQuickStartGuide`):
```tsx
<button
  onClick={dismiss}
  className="absolute top-2.5 right-2.5 p-1 rounded-lg hover:bg-violet-200/40 text-muted-foreground hover:text-foreground transition-colors"
>
  <X className="w-3.5 h-3.5" />
</button>
```
無 `aria-label`/`title`;觸控區域 = `p-1`(4px×2)+ `w-3.5 h-3.5`(14px)= 22×22px。

**影響對象**:螢幕閱讀器使用者(不知道按下去是關閉這張新手指南卡)、觸控使用者。

**建議**:`aria-label="關閉提示卡片"` + 加大 padding。

---

## 14.〔Low〕品牌色票對螢幕閱讀器等同不存在

**發現**

`client/src/pages/social/SocialCockpitPage.tsx:152-156`:
```tsx
{brand.kit.palette.map((s) => (
  <div key={s.role} className="h-8 w-8 rounded-md border" style={{ background: s.hex }} title={`${s.role} ${s.hex}`} />
))}
```
`<div>` 是非互動元素,`title` 屬性在非互動、非 focusable 元素上普遍不會被主流螢幕閱讀器自動朗讀(僅滑鼠懸停 tooltip 對視覺使用者有效)。此區塊沒有任何文字替代(如 `aria-label` 或視覺隱藏的 `<span className="sr-only">`)。

**影響對象**:螢幕閱讀器使用者,聽不到品牌調色盤有哪些顏色/角色對應。色票本身色相/對比是否清楚需視覺驗證,但「螢幕閱讀器讀不到任何文字說明」這點可由程式碼直接判定。

**建議**:每個色塊補 `aria-label={\`${s.role} 色票 ${s.hex}\`}` 或內嵌 `sr-only` 文字。

---

## 15.〔Low〕MiniAssetsPanel 資產列有滑鼠游標樣式但無任何互動邏輯

**發現**

`client/src/pages/Studio.tsx:3748-3773`:
```tsx
<div className="space-y-1 p-2">
  {assets.slice(0, 20).map((asset: any) => (
    <div
      key={asset.id}
      className="flex items-center gap-2 p-2 rounded-lg hover:bg-accent/30 transition-colors cursor-pointer"
    >
      {asset.thumbnailUrl ? (
        <img src={asset.thumbnailUrl} alt="" .../>
      ) : (...)}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-foreground truncate">{asset.name || "未命名"}</p>
        <p className="text-[10px] text-muted-foreground">{asset.type}</p>
      </div>
    </div>
  ))}
</div>
```
外層 `<div>` 有 `cursor-pointer` 與 `hover:bg-accent/30` 視覺樣式,暗示可點擊,但整個區塊沒有 `onClick`、沒有 `role`、沒有 `tabIndex`、沒有鍵盤 handler——純滑鼠使用者移過去會誤以為能點,鍵盤/螢幕閱讀器使用者反而不會被誤導(因為它不在 tab 順序中,也不會被唸成可互動元素),兩種使用者體驗互相矛盾。

**影響對象**:滑鼠使用者(錯誤的可點擊暗示)。此項嚴格來說不是 a11y 阻斷性缺陷(鍵盤/螢幕閱讀器使用者反而沒有被誤導),但屬於語意不一致,列為 Low 供產品/工程判斷這排資產列表原意是否該可點擊插入。

**建議**:若設計上應可點擊插入到提示詞/畫布,補上 `onClick`+`role="button"`+`tabIndex`+`onKeyDown`;若僅供瀏覽,移除 `cursor-pointer`/`hover` 樣式避免誤導。

---

## 16.〔Low〕「清除全部」歷史鈕僅靠 title 後備

**發現**

`client/src/pages/ImageStudio.tsx:1345-1357`:
```tsx
<button
  onClick={clearAll}
  className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
  title="清除全部"
>
  <Trash2 className="w-3.5 h-3.5" />
</button>
```
無顯式 `aria-label`,accessible name 依賴瀏覽器把 `title` 當成 fallback name(多數瀏覽器/AT 組合支援,但非所有;且 `title` 同時觸發滑鼠 tooltip,鍵盤/觸控使用者拿不到視覺提示)。

**影響對象**:螢幕閱讀器使用者(風險較低,多數瀏覽器仍可用 title 讀出)。

**建議**:補 `aria-label="清除全部歷史紀錄"`,不依賴 fallback。

---

## 17.〔Low〕DirectorAI「關閉面板」鈕同樣僅靠 title

**發現**

`client/src/pages/DirectorAI.tsx:1798-1805`:
```tsx
<button
  onClick={onClear}
  className="p-1 rounded hover:bg-muted/40 text-muted-foreground"
  title="關閉面板"
>
  <X className="w-3.5 h-3.5" />
</button>
```
與 #16 同類問題,另外觸控區域 `p-1` + `w-3.5 h-3.5` = 22×22px,同樣低於 24px 底線。

**建議**:補 `aria-label="關閉面板"`,並視情況加大 padding。

---

## 已正確處理(negative results,供對照)

- `client/src/pages/Studio.tsx:2700-2718` 模態切換(圖片/影片/音訊/語音)使用 shadcn/Radix `Tabs`/`TabsList`/`TabsTrigger`,`role="tablist"`/`role="tab"`/`aria-selected` 由 Radix 自動處理,鍵盤方向鍵導覽也內建,無需額外修復。
- `client/src/components/AssetsQuickDrawer.tsx:240-251` 載入骨架有 `role="status" aria-label="載入素材中"`,錯誤狀態有 `role="alert"`,是本次稽核中最佳範例之一。
- `client/src/pages/VideoStudio.tsx:620-665` 服務降級橫幅正確依阻斷程度分流:`down`(阻斷)用 `role="alert"`(隱含 assertive),`degraded`(非阻斷)用 `role="status"` + `aria-live="polite"`,並在程式碼註解中說明設計理由,是全庫唯一有清楚記載 aria-live 語意選擇邏輯的地方。
- `client/src/pages/ImageStudio.tsx:5165-5177` 檢視模式切換鈕(`viewMode`)`aria-label` 隨狀態動態變化("切換為網格檢視"/"切換為單張檢視"),且生成中狀態(`L5184-5193`)有 `role="status" aria-label="AI 生成中"`,是圖片工作室內處理最完整的區塊。
- `client/src/pages/DirectorAI.tsx:1990-2004` 與 `client/src/pages/ProStudio.tsx:1313-1320` 的 `Switch`+`Label` 都正確用 `id`/`htmlFor` 綁定,可作為 #1/#8 修復時的專案內既有範本。
- `client/src/components/GenerationControls.tsx:167-198` 種子碼三顆輔助按鈕(擲骰子/沿用上次/清空)均有正確 `aria-label`,且圖示都加了 `aria-hidden`,顯示同檔案內對 icon-only 按鈕已有部分正確實踐。
- `client/src/components/social/TemplatePicker.tsx:49-63` 版型選擇網格用 `role="listbox"` + `role="option"` + `aria-selected`,是自訂 widget 語意最完整的範例。
- `client/src/pages/Studio.tsx:3137` 生成結果圖片有具描述性的 `alt="Generated"`;`:3756` 資產縮圖用 `alt=""` 但緊鄰可見的資產名稱文字,屬於正確的「裝飾性/已有文字替代」用法,非缺陷。

---

## 需視覺驗證清單(本報告未涵蓋 / 需渲染確認)

- 上述所有觸控尺寸判定(#5/#11/#13/#17)僅以 Tailwind 間距類別數值計算,未把行高、外層容器可能的額外可點擊區域(如整個父層有 padding)計入,實機觸控體驗建議用瀏覽器 DevTools 量測驗證。
- 色彩對比(如 `text-muted-foreground/40`、`bg-black/50` 疊加圖片等半透明疊層)未在本報告評估,需渲染 + 對比度工具驗證。
- `SiteOnboardingOverlay` 的 Spotlight SVG 遮罩在螢幕閱讀器啟用時的實際 focus 順序(是否會把焦點鎖進卡片內)僅由程式碼推測,建議實機用 VoiceOver/NVDA 走一次 tour 流程確認。
- `ProactiveOrbWidget` 聊天訊息串(AI 回覆內容)是否有對應 `aria-live` 播報新訊息,本次未完整追蹤其父層(訊息串以外的區塊已抽樣,聊天輸入區已在 #3 記載),建議專案另立追蹤票逐一過一遍。
