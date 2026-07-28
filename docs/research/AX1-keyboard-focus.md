# AX1 — 鍵盤導航/焦點管理
- 產生日期：2026-07-03
- 依據 commit：812f6fdb
- 稽核範圍：client/src 的 modal/drawer/dropdown/menu 元件 + 互動控制

> 方法：先讀碼、後判斷。只列「從程式碼可靜態判定」的問題；顏色對比等需要實際渲染的一律標記「需視覺驗證」。每筆列出 檔案:行號、影響對象、建議，並依嚴重度排序。文末含「已正確處理」negative results 供對照，避免重工。

---

## 高（P0/P1）

### H1. AuthExpiredModal 全站登入過期彈窗——完全自訂，零鍵盤/焦點管理
**檔案：`client/src/components/AuthExpiredModal.tsx:73-162`**

此彈窗由 `window` 事件（`auth:session-expired`）在**任何頁面、任何時間**觸發（見 73-85 行），會整頁覆蓋、阻擋後續操作直到使用者登入或關閉。但整個實作是純 `motion.div` + 條件渲染，**沒有**：
- `role="dialog"` / `aria-modal="true"` / `aria-labelledby`（99-124 行的容器只是普通 `div`，螢幕閱讀器不會宣告這是一個對話框）
- Esc 關閉（沒有任何 `keydown` 監聽）
- 開啟時的初始焦點移動（`visible` 變 `true` 後沒有 `.focus()` 呼叫，焦點停在觸發當下背景頁面上原本的位置）
- 焦點循環/trap（Tab 可以直接跑出彈窗、回到背景頁面上視覺被半透明遮罩蓋住但仍可互動的元素）
- 關閉後的焦點歸還

83-85 行的背景遮罩雖有 `onClick={handleDismiss}`，但沒有對應的鍵盤等效操作（本身也不需要，因為整個彈窗都缺 Esc）。

- 影響對象：鍵盤使用者（無法用 Esc 關閉、Tab 順序可能穿透到背景）、螢幕閱讀器使用者（不會被告知跳出了對話框，也無法用標準「跳出 dialog」手勢定位內容）。
- 建議：改用既有 `@/components/ui/dialog`（Radix Dialog，專案已有並在他處正確使用，見「已正確處理」），或至少補上 `role="dialog"` `aria-modal="true"` `aria-labelledby`、`Escape` 監聽、開啟時 focus 移入、關閉後 focus 歸還。
- cluster：keyboard-focus / aria-sr
- needsVisual：否（純程式碼可判定）

### H2. BatchGenerationDialog（DirectorAI 批次生成）——同樣完全自訂、零鍵盤/焦點管理
**檔案：`client/src/components/director/BatchGenerationDialog.tsx:60-90`；掛載於 `client/src/pages/DirectorAI.tsx:6358`**

DirectorAI（本次稽核指定高流量頁）「批次生成多模態內容」對話框：61 行整個容器是 `<div className="fixed inset-0 ...">`，沒有 `onClick` 讓點擊背景關閉、沒有 `role="dialog"`/`aria-modal`、沒有 Esc 監聽、沒有初始焦點移動或焦點 trap。唯一的關閉手段是 82-89 行的 × 按鈕（本身沒問題，有 `aria-label`），但鍵盤使用者必須先 Tab 到它——若打開當下焦點沒被移入面板，得先 Tab 過背景頁面所有可聚焦元素才可能到達。

- 影響對象：鍵盤使用者、螢幕閱讀器使用者。
- 建議：改走 Radix `Dialog`（專案內已有 `ui/dialog.tsx`），或補齊 Esc / focus 管理。這是 DirectorAI 核心生成流程的關鍵動作面板，優先度應高於一般設定型彈窗。
- cluster：keyboard-focus / aria-sr
- needsVisual：否

### H3. FE-03（已知延伸確認）：4 處「素材」快速開啟鈕永久 `hidden`，AssetsQuickDrawer 全站不可達
**檔案：`client/src/pages/ImageStudio.tsx:4408-4414`、`client/src/pages/ProStudio.tsx:4747-4753`、`client/src/pages/VideoStudio.tsx:5096-5102`、`client/src/pages/DirectorAI.tsx:4522-4531`**

四處觸發 `AssetsQuickDrawer`（`client/src/components/AssetsQuickDrawer.tsx`）的按鈕 className 都同時含 `hidden` 與 `flex`（例如 ImageStudio:4410 `className="hidden flex items-center gap-1.5 ..."`；DirectorAI:4525 用的是 Radix `Button` 但 className 仍是 `"hidden rounded-xl text-xs gap-1"`），`hidden` 使其 `display:none`，按鈕在 DOM 中永遠不可見、不可 Tab 到、不可點擊——不論滑鼠、鍵盤、觸控皆不可達。已確認 `AssetsQuickDrawer` 元件本身寫得乾淨（有 `aria-label`、`role="alert"`／`role="status"`、Radix Sheet 焦點管理），問題出在四個呼叫站永久藏起了唯一入口。
- 影響對象：所有使用者（鍵盤/滑鼠/觸控/螢幕閱讀器一致不可達，不是單一輸入方式的問題）。
- 建議：移除四處的 `hidden` class（或改成有意義的響應式斷點寫法，例如只在小螢幕隱藏用 `hidden sm:flex`，而不是無條件 `hidden`）。
- cluster：other（渲染可達性，非單純鍵盤/ARIA，但等同永久移除唯一素材庫入口）
- needsVisual：否（`hidden` 語意明確，DOM 存在但 `display:none`）

---

## 中（P2）

### M1. AmbientOrb（座艙常駐光球助手）協作面板——無 Esc 關閉、Tab 順序反向
**檔案：`client/src/shells/video/console/AmbientOrb.tsx:54-135`（掛載於 `client/src/shells/video/DirectorConsole.tsx:45`，`/video` 座艙全程常駐）**

- 面板（92-117 行）是點擊 FAB（120-132 行）後於 FAB **上方**、同一 DOM 順序中**更早**渲染出的一個非 Radix 自訂浮層（不是 dialog/sheet）。開啟後焦點仍停在剛剛點擊的 FAB 按鈕上；由於面板的 JSX 在 FAB **之前**，鍵盤使用者按 Tab 前進不會進入面板（Tab 只會往「文件順序在 FAB 之後」的元素走），必須先 Shift+Tab 才能碰到面板裡的動作項——對一般使用者的直覺（打開浮層 → Tab 應該進入浮層內容）是反的。
- 全元件（59-135 行）沒有任何 `keydown`/`Escape` 監聽，唯一關閉方式是再點一次 FAB 或按面板內的 × 鈕（97 行），鍵盤使用者沒有 Esc 捷徑。
- 對照組：專案內 `client/src/components/design-kit/orb.tsx`（同樣是「光球助手」FAB+面板模式，且檔頭註解明載 `a11y：FAB aria-expanded／面板 role=dialog＋Esc 關＋焦點回 FAB`，347-354 行已正確實作「開→聚焦面板／關→焦點回 FAB」+ `onKeyDown` 監聽 Escape）已經把這個模式做對，但目前 `/video` 座艙實際掛載的仍是舊版 `AmbientOrb.tsx`，兩者未合流。CreationFlowBar/ReadinessChip 等座艙元件都已用 `ENABLE_AIDV_CHROME` 旗標切到 design-kit 版本，AmbientOrb 是尚未跟進的缺口。
- 影響對象：鍵盤使用者（Tab 順序違反直覺、無 Esc）。
- 建議：讓 AmbientOrb 走 `ENABLE_AIDV_CHROME` 旗標切換到 `design-kit/orb.tsx` 的 `OrbAssistant`（已有 dialog role + Esc + focus 管理），或至少補上 `Escape` 監聽與開啟時 focus 移入面板。
- cluster：keyboard-focus
- needsVisual：否

### M2. ArticleDialog 主動關閉 Radix 的開啟自動聚焦，且未提供替代焦點管理
**檔案：`client/src/components/ArticleDialog.tsx:255-258`**

```
<DialogPrimitive.Content
  asChild
  forceMount
  onOpenAutoFocus={e => e.preventDefault()}
>
```
Radix `Dialog.Content` 內建「開啟時自動把焦點移入內容」的行為，這裡明確呼叫 `e.preventDefault()` 關掉它，但檔案中沒有任何後續程式碼手動把焦點移到對話框內任何元素（`contentRef`，201/219-222 行，只用來重置 `scrollTop`，從未呼叫 `.focus()`）。結果是彈窗開啟後鍵盤焦點停在觸發它的卡片上（該卡片視覺上被彈窗蓋住），使用者必須自行摸索才能進入彈窗操作。
- 影響對象：鍵盤使用者、螢幕閱讀器使用者（不會被自動帶入新內容）。
- 建議：移除 `onOpenAutoFocus` 覆寫，或若是為了避免特定初始捲動/動畫問題，改為在 `onOpenAutoFocus` 內手動 `e.preventDefault()` 後自行 `contentRef.current?.focus()`（並確保容器有 `tabIndex={-1}`）。
- cluster：keyboard-focus
- needsVisual：否

### M3. FeedbackDialog——同樣自訂彈窗，零鍵盤/ARIA
**檔案：`client/src/components/FeedbackDialog.tsx:154-176`**

與 H1/H2 同一類問題：`fixed inset-0` 純 `motion.div`，163 行背景 `onClick={handleClose}` 有滑鼠等效但沒有 `Escape` 鍵盤等效；整份檔案（`useState`/`useCallback`，無 `useEffect`）沒有任何鍵盤事件監聽；165-176 行的內容容器沒有 `role="dialog"`/`aria-modal`；沒有開啟時的焦點移入。由光球快捷選單觸發，跨頁面可能出現。
- 影響對象：鍵盤使用者、螢幕閱讀器使用者。
- 建議：同 H1，改走專案既有 `ui/dialog.tsx`（Radix）或補齊 Esc/焦點管理/ARIA 屬性。
- cluster：keyboard-focus / aria-sr
- needsVisual：否

### M4. Y8（已知延伸確認）：hover-only 刪除鈕缺 focus-visible 對應——已知案例 + 同款式擴散到其他 drawer
**檔案：`client/src/components/ProjectNotesDrawer.tsx:156-161`；同款式也出現在 `client/src/components/brain-pipeline/NodeDetailSheet.tsx:310-328`**

ProjectNotesDrawer 156-161 行：
```
<button
  onClick={() => onDelete(note.id)}
  className={`transition-opacity p-1 rounded hover:bg-red-500/20 ... ${isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
>
```
`isMobile` 分支確保觸控使用者看得到（已正確處理觸控），但桌面鍵盤使用者：按鈕本身沒有 `disabled`、仍在 Tab 順序中、可以被聚焦並用 Enter/Space 觸發，**但視覺上維持 `opacity-0`**（class 只綁 `hover`，沒有 `focus`/`focus-visible` 變體）——鍵盤使用者 Tab 到它時看不到任何視覺回饋，等於「盲刪」。
同款式（`opacity-0 group-hover:opacity-100`，無 `focus`/`focus-visible` 對應）也出現在 `NodeDetailSheet.tsx:310-328`（GitHub 開啟鈕、複製鈕），確認並非單一個案，而是 drawer 類元件裡重複出現的樣式模式。
- 影響對象：鍵盤使用者（WCAG 2.4.7 Focus Visible 未滿足：聚焦到可互動元素卻無可見指示）。
- 建議：在這類「hover 才顯示」的按鈕 className 補上 `focus-visible:opacity-100`（或等效的 `focus-within:opacity-100` 加在父層 `group`），讓鍵盤聚焦時可見；已知同款式建議一次性搜尋 `opacity-0 group-hover:opacity-100` 全庫掃描修正（本次掃描以 grep 找到約 15 個檔案有此樣式，未逐一開啟確認是否都在互動元素上，僅 ProjectNotesDrawer / NodeDetailSheet 屬本次「modal/drawer」掃描範圍內確認）。
- cluster：keyboard-focus
- needsVisual：是（focus-visible 時的實際可見程度建議截圖/鍵盤走查複驗，尤其 `opacity-0` 是否被其他 CSS 覆寫）

### M5. SiteOnboardingOverlay：Spotlight 目標元素多數不存在（Y5 已知延伸確認）
**檔案：`client/src/contexts/SiteOnboardingContext.tsx`（21 個步驟定義了 `targetId`）；渲染邏輯在 `client/src/components/SiteOnboardingOverlay.tsx:356-408`**

實際掃描 `client/src`，21 個非 null 的 `targetId` 中，**僅 5 個**在程式碼裡找得到對應的 `id="..."` 元素（`sidebar-nav`、`modality-tabs`、`prompt-builder-area`、`proactive-orb-anchor`、`learn-search`、`learn-category-filter`、`focus-flow-tabs`——精確計算為 7/21，其餘 14 個如 `sidebar-studio-link`、`sidebar-pro-studio-link`、`generate-button`、`pro-tab-music`、`director-chat-input`、`director-reset-btn`、`models-dataset-tab`、`history-search` 等皆查無 `id`）。`SiteOnboardingOverlay.tsx` 的 `updateRect`（369-376 行）在找不到元素時會 `setTargetRect(null)`，於是自動退化成 `DarkBackdrop`（全螢幕變暗、無 Spotlight），程式不會崩潰，但文案仍會講「這裡可以…」卻沒有任何視覺指向，對所有使用者（不限鍵盤/螢幕閱讀器）都造成「說了但沒指到東西」的導覽斷點。
- 影響對象：全體使用者（視覺導覽功能性缺失，非嚴格鍵盤/ARIA 問題，但因引導文案與畫面不同步，等同功能性 broken affordance）。
- 建議：核對 `SiteOnboardingContext.tsx` 中每個 `targetId` 對應的頁面是否仍存在該 `id`（頁面重構後 id 沒有同步更新），逐一補回或砍掉對應步驟。
- cluster：other
- needsVisual：否（`id` 缺失可由靜態 grep 直接判定；是否「視覺上明顯斷點」可再截圖佐證但非必要）

---

## 低（P3）

### L1. design-kit 共用元件：Tab/RadioGroup 樣式僅點擊、無方向鍵導覽
**檔案：`client/src/components/design-kit/cockpit.tsx`：`PersonaSwitch`（59-73 行，`role="radiogroup"` + `role="radio"`）、`MemoryDBTabs`（139-154 行，`role="tablist"` + `role="tab"`）**

依 WAI-ARIA Authoring Practices，`radiogroup`/`tablist` 模式預期方向鍵（←→ 或 ↑↓）可在群組內移動焦點與選取，這兩個元件只綁 `onClick`，沒有 `onKeyDown` 處理方向鍵；鍵盤使用者仍可用 Tab 逐一移到每個選項並用 Enter/Space 觸發，功能上「可達」但不符合對應 ARIA role 的預期互動模式，可能讓已熟悉螢幕閱讀器/鍵盤慣例的使用者困惑（例如以為方向鍵可切換分頁）。這是共用 design-kit 元件，若座艙（cockpit）各面板都在用會有擴散面。
- 影響對象：鍵盤使用者、螢幕閱讀器使用者（ARIA role 語意與實際鍵盤行為不一致）。
- 建議：視工作量權衡是否補上方向鍵導覽；若暫不修，至少評估是否降級成不使用 `role="tab"/"radio"`（避免語意承諾與實作不符）。
- cluster：aria-sr
- needsVisual：否

### L2. SiteOnboardingOverlay 背景遮罩（DarkBackdrop）點擊為 no-op
**檔案：`client/src/components/SiteOnboardingOverlay.tsx:101-108`，呼叫處 `client/src/components/SiteOnboardingOverlay.tsx:454-455`**

`DarkBackdrop` 元件本身接受 `onClick` 並綁在 `<div>` 上（103-106 行），但主元件呼叫時傳入 `onClick={() => {}}`（455 行）——空函式。滑鼠使用者點擊變暗背景預期會關閉導覽（常見慣例），實際上什麼都不會發生；同時這個背景 `div` 沒有 `role`/`tabIndex`，鍵盤/螢幕閱讀器也無法與之互動（但本身也不必要，因為 Esc 已在 434-444 行的 `window` keydown 監聽正確處理關閉/上一步/下一步/Enter）。
- 影響對象：滑鼠使用者體感不一致（點了沒反應），非鍵盤/ARIA 阻斷（Esc 路徑本身正常）。
- 建議：若不打算讓點擊背景關閉導覽（可能是刻意防止手滑跳出），建議在視覺上移除「看起來可點」的暗示，或乾脆讓它跟 Esc 行為一致（呼叫 `stopTour`）。
- cluster：other
- needsVisual：否

---

## 已正確處理（Negative Results，供對照避免重工）

1. **SlashCommandMenu**（`client/src/components/SlashCommandMenu.tsx` + `client/src/hooks/useSlashCommandMenu.ts`）：完整鍵盤導覽——↑↓移動、Enter/Tab 套用、Esc 關閉（`useSlashCommandMenu.ts:114-161`），`role="listbox"`/`role="option"`/`aria-selected`（`SlashCommandMenu.tsx:156-208`）齊備，是本次掃描中鍵盤處理最完整的自訂選單，可作為其他自訂彈層的範本。
2. **AssetsQuickDrawer**（`client/src/components/AssetsQuickDrawer.tsx`）：走 Radix `Sheet`（焦點管理/Esc/背景鎖定由 Radix 內建處理），關閉鈕有 `aria-label="關閉"`（195 行），loading/error 狀態分別標了 `role="status"`/`role="alert"`（240、246 行）。元件本身沒問題，問題出在外部呼叫端把觸發鈕 `hidden` 掉了（見 H3）。
3. **OrbFloatButton**（`client/src/components/OrbFloatButton.tsx`）：FAB 有 `aria-label`+`focus-visible` 樣式（58-65 行），抽屜走 Radix `Sheet`，`SheetDescription` 用 `sr-only` 補充螢幕閱讀器描述（86-88 行）。
4. **ConsoleDrawers**（`client/src/shells/video/drawers/ConsoleDrawers.tsx`）：座艙全部 9 個抽屜（workflow/flowtv/playground/research/prompts/agents/grounding/lora/agent_ops/settings）統一走 Radix `Sheet`，焦點/Esc/背景鎖定一致由 Radix 處理，沒有發現自訂繞過。
5. **ArticleDialog** 除 M2（自動聚焦被關掉）外，其餘 ARIA 結構正確：`DialogPrimitive.Title`（348-352 行）、`DialogPrimitive.Close` 有 `aria-label="關閉"`（276-283 行）。
6. **ui/dialog.tsx** 的 IME 合成防呆（`isComposing` 檢查，103-119 行）是正確設計，不是 bug——避免中文/日文輸入法選字時誤觸 Esc 關閉對話框，不影響一般 Esc 關閉路徑。
7. **ProactiveOrbWidget** 桌面互動面板（`client/src/components/ProactiveOrbWidget.tsx:2612-2639`）：程式碼自陳「M14」修補——開啟時把焦點移入面板第一個可聚焦元素、`window` 層級監聽 Escape 關閉，並在註解中誠實記錄「這只是初始 focus + Esc 關閉，不是完整 focus trap」（2612-2615 行）。相較 H1/H2/M3 的「完全沒做」，這是「部分做、且自知侷限」的中間態，故不重複列入中/高風險，僅在此存查：若之後要做完整 trap，需要引入 focus-trap 邏輯；同一效果目前**只套用在桌面**（`isMobile` 分支被排除，2618/2630 行），行動版彈窗（2699-2718 行，`role="dialog" aria-modal="true"`）目前完全沒有這段初始焦點/Esc 處理——但行動裝置多半無實體鍵盤，且螢幕閱讀器對 `aria-modal` 的焦點限制依賴瀏覽器/AT 實作差異，故列為觀察項而非扣分項，若之後有平板+外接鍵盤或 switch-control 使用情境，建議一併補上。

---

## 附註：本次未覆蓋
- Radix 系 `ui/dropdown-menu.tsx`、`ui/context-menu.tsx`、`ui/popover.tsx`、`ui/menubar.tsx`、`ui/navigation-menu.tsx`、`ui/alert-dialog.tsx`：逐一檢查沒有發現覆寫 `onEscapeKeyDown`/`onOpenAutoFocus`/`onPointerDownOutside` 等會破壞預設無障礙行為的 props（僅 `ArticleDialog.tsx` 覆寫了 `onOpenAutoFocus`，已列 M2）。
- 顏色對比、暗色/亮色模式下的可見度問題不在本次「可從程式碼判定」範圍內，一律標記需視覺驗證；本文件中凡涉及此類皆已個別標註。
- `shells/video/drawers/*`（AgentCatalog / ModelCatalog / FlowTv / PromptWorkbench / RealEarthResearch / TeachingArchiveGrounding / LoraCharacters / AgentOpsPanel / VideoSettings）內部表單/清單控制項的逐一鍵盤走查未展開（外層皆由 `ConsoleDrawers.tsx` 的 Radix `Sheet` 包住，焦點進出面板本身沒問題；面板內部 widget 級別的鍵盤細節建議列入後續 AX2 範圍）。
