# AX4 — 對比/焦點指示/狀態可見性
- 產生日期：2026-07-03
- 依據 commit：812f6fdb
- 稽核範圍：品牌配色（healing 暖色）、focus indicator、disabled/error 狀態、深色模式

> 方法：先讀碼、後判斷。只列「從程式碼可靜態判定」的問題；顏色對比等需要實際渲染的一律標記「需視覺驗證」。每筆列出 檔案:行號 → 影響對象（鍵盤/螢幕閱讀器/觸控/色盲）→ 建議，依嚴重度排序。務實聚焦高流量頁（Studio/DirectorAI/光球/座艙）。文末含「已正確處理」negative results，供對照避免重工。
> 已知延伸確認：Y8（ProjectNotesDrawer 刪除鈕 hover-only）、FE-03（素材快捷鈕永久 hidden）、Y5（SiteOnboarding spotlight target 缺失）、S4（mobile-first 既有分析）不重複展開，僅在下方相關發現處註記關聯。

---

## 高（P0/P1）

### H1. 系統性「hover-only 動作鈕」——群組焦點（group-focus-within）從未實作，Y8 只是冰山一角
**代表檔案：**
- `client/src/pages/ImageStudio.tsx:989`、`:1170`（Studio 生成結果的「下載／全尺寸／套用編輯」浮層按鈕）
- `client/src/pages/AgentChat.tsx:2170`、`:2273`（光球任務範本卡片的動作提示、視覺卡 CTA）
- `client/src/components/director/SessionItem.tsx:49`、`client/src/components/director/PlanningSessionItem.tsx:49`（DirectorAI 會話列表刪除鈕）
- `client/src/components/ConsistencyVault.tsx:169-170`（角色一致性庫刪除鈕，桌面版 hover-only／行動版才 opacity-100）
- 另有 `NodeDetailSheet.tsx`、`StoryboardTimelineUploader.tsx`、`AssetsLibrary.tsx`、`SharedSpace.tsx`、`ModelsPage.tsx`、`LoraTrainer.tsx`、`FocusFlowPage.tsx`、`FocusFlowMini.tsx`、`VisualSoulInvitation.tsx`、`ProgressivePromptBuilder.tsx` 共 16 個檔案、25 處同構寫法（`opacity-0 group-hover:opacity-100`）。

全庫對 `group-focus-within:opacity-*` 或 `group-focus:opacity-*` 做了全文搜尋，**0 筆命中**——代表這個「hover 才顯示動作鈕」的樣式規範，從未搭配鍵盤等效的 `focus-within` 版本。由於父層 `opacity-0` 會讓整個子樹（含子元素自己的 `:focus-visible` outline）一起變透明，鍵盤使用者 Tab 到這些按鈕時**完全看不到任何視覺提示**——按鈕仍在 DOM 中可被 Tab 到、可被 Enter 觸發（功能上「可達」），但看不見自己在哪、也看不見有東西存在，等於功能性的鍵盤陷阱。

以 `ImageStudio.tsx:989-1010` 為例，「下載／全尺寸／套用為編輯」三顆 `<Button>` 全部包在 `opacity-0 group-hover:opacity-100` 的 overlay div 內，是 Studio 生成結果卡片上*唯一*的操作入口之一；`AgentChat.tsx` 是光球主對話頁。這些都在題目指定的高流量頁範圍內。

- 影響對象：鍵盤使用者（看不到焦點在哪、不確定按鈕是否存在）；間接影響低視力使用者（無法用滑鼠精確 hover，但仍嘗試用鍵盤操作時同樣受影響）。
- 建議：把既有 `opacity-0 group-hover:opacity-100` 全面改為 `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`（或按鈕自身補 `focus-visible:opacity-100`），並建議在 Tailwind 設定或 lint 規則層面統一守護，避免第 17 個檔案再犯。
- cluster：keyboard-focus
- needsVisual：否（`opacity-0` 語意明確，純 class 靜態可判定；25 處中已抽查 ImageStudio/AgentChat/director/ConsistencyVault 四組原始碼確認無 focus-within 替代）

### H2. OrbGuidePanel（光球導引面板）主聊天輸入框——`outline-none` 後無任何 focus 替代
**檔案：`client/src/components/OrbGuidePanel.tsx:4253-4287`**

第 4253 行的外層容器 `<div className="flex items-center gap-2 bg-white/8 rounded-2xl border border-white/10 ...">` 沒有 `focus-within` 樣式；第 4285-4287 行的 `<input>`（光球對話輸入，`aria-label="輸入訊息給光球"`）className 只有：
```
flex-1 bg-transparent text-white placeholder:text-white/30 outline-none
```
同檔案內其他輸入框（例如 1014、1024、1141、1150、1553、2181、2277、2347 行）都正確搭配了 `focus:border-*`（emerald/cyan/indigo 等），顯示同一元件庫「應該」要有 focus 樣式，但這個光球主輸入框漏掉了——鍵盤 Tab 到這個核心輸入欄位時，邊框、外框都不會有任何變化。
- 影響對象：鍵盤使用者（無法確認焦點是否落在光球輸入框）。
- 建議：比照同檔案其他輸入框補上 `focus:border-white/25`（或等效 `focus-within` 於外層容器），統一該元件的 focus 樣式規範。
- cluster：keyboard-focus
- needsVisual：否

### H3. 首頁光球創作階段（OrbCreationStage）主要提示詞輸入框——同樣完全無 focus 指示
**檔案：`client/src/components/home/OrbCreationStage.tsx:3095-3121`**

第 3095-3098 行的父卡片用內聯 `style={{ border: '1px solid ' + cardBorder }}`（靜態顏色、非 focus 狀態相關），第 3121 行的 `<textarea>`：
```
w-full resize-none bg-transparent outline-none text-xs sm:text-sm lg:text-base leading-relaxed font-mono ${textPrimary} placeholder:opacity-50
```
沒有 `focus:` 或 `focus-within:` 任何 class，父卡片邊框顏色也是固定值（不隨 focus 改變）。這是首頁「光球」核心創作入口（一句話生成的主要提示詞欄），鍵盤使用者無法看到自己是否已聚焦到輸入框。
- 影響對象：鍵盤使用者（首頁最核心互動入口，焦點不可見）。
- 建議：至少讓父卡片在 `:focus-within` 時邊框變色／加 box-shadow，呼應站內既有 `.healing-input-shell:focus-within`（見 negative results）的做法。
- cluster：keyboard-focus
- needsVisual：否

---

## 中（P2）

### M1. OrbUnifiedAssistant（統一光球助手面板）搜尋框 / 分類下拉——同檔內不一致，部分輸入框漏了 focus 樣式
**檔案：`client/src/components/OrbUnifiedAssistant.tsx:689`（搜尋框）、`:1041`、`:1158`、`:1741`（三處 `<select>` 分類下拉）**

同檔案其餘文字輸入框（1014、1024、1141、1150、1553、2181、2190、2196、2277、2347、2353 行）都正確帶 `focus:border-emerald-300/40` 或 `focus:border-cyan-300/40`，但上述四處只有 `outline-none`，沒有任何 focus 替代樣式：
```
689:  className={cn("flex-1 bg-transparent text-white placeholder:text-white/30 outline-none min-w-0", ...)}
1041: className="rounded-lg bg-white/8 border border-white/12 text-white text-[11px] px-2 py-1 outline-none"
1158: className="rounded-lg bg-white/8 border border-white/12 text-white text-[11px] px-2 py-1 outline-none"
1741: className={cn("w-full rounded-lg bg-white/8 border border-white/12 text-white px-2 py-1.5 outline-none", ...)}
```
`<select>` 原生本身有瀏覽器預設 focus 樣式，但 `outline-none` 會移除它、且未補任何替代（不像同檔其他輸入框有 `focus:border-*`）。
- 影響對象：鍵盤使用者（尤其分類下拉是鍵盤重度操作的控制項，切換分類時看不到焦點在哪個下拉上）。
- 建議：比照同檔案既有樣式補 `focus:border-white/25`（或等效），統一規範。
- cluster：keyboard-focus
- needsVisual：否

### M2. FilterBadge（brain-pipeline 摘要列篩選 chip）——完全無 focus 指示（`active` 是選中態，非 focus 態）
**檔案：`client/src/components/brain-pipeline/SummaryBar.tsx:259-273`**

```tsx
className={cn(
  "transition-all rounded-md outline-none",
  active
    ? "ring-2 ring-offset-1 ring-slate-900 dark:ring-slate-100 scale-105"
    : "opacity-90 hover:opacity-100 hover:scale-105"
)}
```
`ring-2` 只在 `active`（已選中的篩選 chip）時出現，這是「目前選中哪個篩選」的視覺，並非「鍵盤焦點在哪」；`outline-none` 把瀏覽器預設焦點框整個移除，兩種狀態（active / 未 active）都沒有任何 `:focus-visible` 專屬樣式。鍵盤 Tab 經過這排篩選 chip 時無法判斷焦點位置。
- 影響對象：鍵盤使用者。
- 建議：補 `focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-(--ring-healing-strong)`，與 `active` 態的 ring 樣式區隔（可疊加或用不同顏色）。
- cluster：keyboard-focus
- needsVisual：否

### M3. OrbUnifiedAssistant「快速動作」卡片 disabled 態——視覺差異極小（1-2% 透明度），建議需視覺覆核
**檔案：`client/src/components/OrbUnifiedAssistant.tsx:362-381`**

```tsx
disabled={!dispatchable}
...
className={cn(
  "w-full flex items-start gap-2 rounded-xl border px-3 py-2 text-left transition-colors",
  dispatchable
    ? "border-white/10 bg-white/5 hover:bg-white/12 cursor-pointer"
    : "border-white/8 bg-white/3 cursor-default"
)}
```
disabled（`!dispatchable`）態與 enabled 態的唯一差異是邊框 `white/10→white/8`、背景 `white/5→white/3`（皆為 1-2 個百分點的透明度差），文字（label/description）顏色不變。程式碼層級可判定「有做區分」，但差異幅度是否足以讓使用者「一眼看出這張卡不能點」需要實際渲染判斷。
- 影響對象：低視力使用者、快速掃視操作的一般使用者（可能誤以為所有卡片都能點擊）。
- 建議：加大 disabled 態對比（例如文字也降透明度、加 `cursor-not-allowed` 明確標示，目前是 `cursor-default` 而非 `cursor-not-allowed`）。
- cluster：contrast-visual
- needsVisual：是（差異存在但幅度需渲染後確認是否可辨識）

### M4. OrbUnifiedAssistant 筆記「儲存」按鈕 pending 態——`disabled` 但零視覺差異
**檔案：`client/src/components/OrbUnifiedAssistant.tsx:2296-2302`**

```tsx
<button
  type="button"
  onClick={saveEdit}
  disabled={updateNote.isPending}
  className="rounded-lg p-1 bg-emerald-400/20 hover:bg-emerald-400/35 text-emerald-200 transition-colors"
  title="儲存"
>
  <Check className="w-3 h-3" />
</button>
```
`disabled` 只影響原生互動行為（無法點擊），但 className 完全沒有 `disabled:opacity-*` 或任何條件式樣式——pending 儲存中，按鈕外觀與可點擊時一模一樣，使用者無法從外觀判斷「正在儲存、請稍候」還是「可以再按一次」。
- 影響對象：一般使用者（誤以為沒反應而重複點擊）、低視力使用者。
- 建議：加 `disabled:opacity-50 disabled:cursor-not-allowed`，或顯示 loading spinner 取代 `Check` icon。
- cluster：contrast-visual
- needsVisual：否（零樣式差異，純程式碼即可判定缺陷存在；具體對比度數值才需視覺）

### M5. 光球/DirectorAI 深色玻璃面板大量使用低透明度白字——對比風險需渲染驗證
**代表：`client/src/components/OrbGuidePanel.tsx:4287`、`:4497`；`client/src/components/OrbUnifiedAssistant.tsx:689`、`:800`、`:947`、`:1014`、`:1024` 等（`text-white/30`、`text-white/35`、`placeholder:text-white/30` 全庫於這四個核心檔案共 121 處 `text-white/1x~4x` 用法）**

`OrbGuidePanel`、`OrbUnifiedAssistant`、`AgentChat`、`OrbCreationStage` 這幾個光球核心互動面板，大量以固定深色玻璃底（`bg-white/8` 等）疊加 `text-white/30~55` 的低透明度白字（placeholder、次要說明、輔助文字），且此配色**不隨站台亮/暗模式切換而變**（面板本身固定走深色玻璃美學）。透明度疊加後的實際對比比值無法單從 class 名稱推算（取決於底下堆疊的漸層/模糊背景實際渲染色值），屬於典型「文字置於半透明疊層上，對比可能不足」情境。
- 影響對象：低視力使用者、色弱/色盲使用者（低對比對所有辨色能力使用者都有影響，非單一族群）。
- 建議：以實際渲染（含背景模糊/漸層疊加後）測量 placeholder 與次要文字的對比比值，若低於 WCAG AA 的 4.5:1（一般文字）/3:1（大型文字），調高不透明度或改用 `--text-on-glass-soft` 之類專用 token（站內已有此 token，見 negative results，惟這幾個面板未採用，仍手刻 `text-white/NN`）。
- cluster：contrast-visual
- needsVisual：是

---

## 低（P3）

### L1. FlowTv 沉浸播放對話框容器——`outline: none`，但屬非 Tab 序（`tabIndex={-1}`），優先度低
**檔案：`client/src/components/flow-tv/FlowTv.tsx:162-172`**

容器 `role="dialog"` 帶 `tabIndex={-1}`（僅供程式化 `.focus()`，一般 Tab 不會到達）且 class 含 `outline-none`，無 `:focus-visible` 替代。因為不在一般 Tab 序列中，實際影響僅限於「開啟對話框當下把焦點程式化移入容器本身」那一瞬間是否需要視覺提示；多數 dialog 模式做法一致（焦點移入容器後再移到內部第一個可互動元素），風險低於 H1-H3。
- 影響對象：鍵盤使用者（極低機率場景）。
- 建議：確認開啟時焦點是移到容器還是移到內部第一個按鈕；若前者，建議至少加 `focus:outline-2 focus:outline-(--ring-healing)` 保底。
- cluster：keyboard-focus
- needsVisual：否

### L2. design-kit/chrome.tsx 的 CommandPalette 搜尋框——`outline-none` 無替代，但元件本身未接上任何頁面
**檔案：`client/src/components/design-kit/chrome.tsx:388-390`**

第 388 行 `<input>` 的 `outline-none placeholder:text-[var(--muted-2)]` 無 focus 樣式，`design-kit.css` 全檔亦無任何 `focus` 規則。惟 `chrome.test.tsx` 檔頭註解明載「純元件、不接頁面」，且全庫搜尋僅測試檔引用；實際掛載到 `App.tsx` 的 Cmd+K 指令面板是另一支 `client/src/components/CommandPalette.tsx`（走 shadcn `CommandInput`，焦點樣式由 `ui/command.tsx` 統一處理，未見缺陷）。
- 影響對象：目前無真實使用者受影響（未接頁面）；若未來啟用需先補 focus 樣式。
- 建議：若此 design-kit 版本日後要取代 `CommandPalette.tsx` 或掛到 AidvShellChrome 等內部工具頁，記得補 focus-visible 樣式。
- cluster：keyboard-focus
- needsVisual：否

---

## 已正確處理（negative results，供對照避免重工）

1. **全站 `:focus-visible` 基準規則**（`client/src/index.css:408-419`）：以柔和薰衣草色 `outline: 2px solid var(--ring-healing)` 取代預設焦點框，小螢幕（≤640px）加粗到 3px 方便觸控裝置的鍵盤/開關裝置使用者辨識。基準做得紮實。
2. **`.focus-ring-healing` 共用 utility**（`index.css:819-829`）與 `Button`（`components/ui/button.tsx:8`）：`outline-none` 一律搭配 `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--ring-healing)]`，並額外處理 `aria-invalid` 邊框/ring。全站 shadcn `ui/*` 元件（tabs、input-group、input-otp、checkbox 等）的 `outline-none` 均正確搭配 `focus-visible:ring-*` 或 `has-[...:focus-visible]` 選擇器。
3. **`AgentChat.tsx` 主對話輸入框**（第一輪 hero composer 第 1520 行 `.healing-input-shell`、後續輪 2925 行）：雖然內層 `<input>` 本身寫 `outline-none`，但外層容器分別靠 `.healing-input-shell:focus-within`（`index.css:4184-4189`，含 dark mode 對應版本 4194-4198）與行內 `focus-within:ring-emerald-300/70 dark:focus-within:ring-emerald-600/40`（`AgentChat.tsx:2925`）正確補上鍵盤可見的聚焦框，是本次抽查中「`outline-none` + `focus-within` 父層替代」的正確示範。
4. **`FeedbackDialog.tsx` 表單輸入框**（第 284、308 行）：`outline-none` 乍看無替代，但 `className` 內插值 `${s.inputBorder}`（見 `FeedbackDialog.tsx:59,71`：`"border-white/10 focus:border-indigo-400/50"` / `"border-black/8 focus:border-amber-500/40"`）已含 focus 邊框樣式，非缺陷。
5. **`index.css` 內另外兩處 `outline: none`**（`.apple-dock-immersive-exit` 第 1380 行、`.apple-dock-flyout-item` 第 2077 行）：分別在 1399-1404 行、2103 行有明確 `:focus-visible` 替代樣式（box-shadow ring / 專用聚焦樣式），非缺陷。
6. **`AgentStatusBar.tsx`（代理狀態指示燈）**：狀態用色（`bg-green-500` active／`bg-yellow-400` idle／`bg-red-500` offline）並未只靠顏色表達——每個色點都搭配 `aria-label`（第 39 行）與旁邊的中文文字標籤「活躍/閒置/離線」（`STATUS_LABEL`，第 29-33、118 行），色盲使用者仍可透過文字辨識狀態，是「不只用顏色表達狀態」的正確示範。
7. **`LocalAuthForm.tsx` 錯誤與密碼強度狀態**：全域錯誤訊息（第 518-522 行）搭配 `AlertCircle` icon + 文字訊息，不只靠紅色框線；密碼強度計（第 471-493 行）色條（`STRENGTH_COLORS`）旁固定搭配文字標籤「強度：{STRENGTH_LABELS}」，達到「色彩＋文字雙重編碼」；`aria-invalid` 直接交給共用 `Input`（`ui/input.tsx:61`）的 `aria-invalid:border-destructive` 統一處理，且密碼不一致額外有文字說明（第 511 行）。是錯誤狀態可見性的良好示範。
8. **深色模式 token 體系**（`index.css:307-373`）：`.dark` 完整覆寫了 `--background/--foreground/--card/--border/--ring` 等語意色與陰影（`--shadow-healing-*`），並非「只換底色不管前景」的半調子深色模式；另有 `--text-on-glass-strong/soft` 專為玻璃疊層準備的文字色 token（`index.css:189-190`、dark 版本 343-344），可惜 M5 提到的光球面板群並未採用此既有 token，屬「有工具但未落地」而非「工具缺失」。

---

## 綜合建議（依落地成本排序）
1. **H1（group-focus-within 系統性補丁）**投報比最高：一次性把 `opacity-0 group-hover:opacity-100` 這條 class 組合，在 25 處出現點統一加上 `group-focus-within:opacity-100`，可考慮抽成 Tailwind `@apply` 或共用 utility class（例如 `.hs-hover-reveal`）避免未來再犯。
2. **H2/H3/M1（光球輸入框 focus 樣式）**：三個檔案問題同構，可用同一個 PR 一次修完，且站內已有大量「正確示範」可直接抄（`focus:border-white/25` 或 `.healing-input-shell:focus-within` 模式）。
3. **M5（低透明度白字對比）**建議排入下一輪需要實機渲染的視覺對比稽核（可搭配 AX3 或獨立 contrast-visual 排程），先用瀏覽器 DevTools 或自動化對比工具（如 axe / Lighthouse）跑一次 OrbGuidePanel、OrbUnifiedAssistant 實際頁面截圖驗證。
