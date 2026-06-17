# AIDV-118 · U-15 全站四態／RWD／a11y 一致性查核表（Phase 1：靜態程式碼掃描）

> **卡**：AIDV-118 U-15 全站四態／空／錯誤態＋RWD 斷點＋a11y（WCAG AA／reduced-motion）一致性驗收
> **執行**：`/aidv-workflow dev` · 智能助手 🤖 · 掃描基準 HEAD（branch `claude/upbeat-newton-txqyf0`）
> **SSOT 拍板**：RWD 斷點以**程式碼實作為準＝`--bp-mobile 768 / --bp-tablet 1024 / --bp-desktop 1280`（＋`useMobile` 768）**；卡描述早期規格 `1181/1180/780/430` 視為**過時、本表以實作斷點查核**（Bruce 2026-06-17 拍板）。
> **方法邊界**：本表＝**靜態程式碼層**自動掃描（四態/錯誤態出口、reduced-motion 守衛、icon a11y、硬編色、斷點一致性）。**視覺走查／截圖對照／真機 RWD 破版／對比度實測＝Phase 2 人工**（Bruce 走查），不在本次自動掃描內。
> **登入 carve-out**：`/login` cosmic（U-3／AIDV-93）不在範圍。

---

## 結論（一句話）

**Wave U 的四態/a11y/reduced-motion 紀律整體良好**（採用 `_shared/PanelState` ＋ design-kit `states.tsx` 奏效）：26 個查詢面板 **25 個有錯誤態出口**、首頁 15 個 framer 動畫層 **14 個守 `useReducedMotion`**、四殼斷點**全部對齊 768/1024/1280**。其餘為**少量低風險缺口**，已逐項路由到擁有該軌的卡修補（一軌一主）。

---

## §1 四態鐵律（空／載入／錯誤／就緒）

掃描 26 個含 `useQuery` 的面板/抽屜/canvas（四殼＋脊椎）：

| 訊號 | 結果 |
|---|---|
| 有載入態（Skeleton/PanelLoading/LoadingState） | 24/26 |
| 有錯誤態出口（PanelError/ErrorState/isError） | **25/26** ✅ |
| 有空態（PanelEmpty/EmptyState/長度判空） | 20/26（其餘多為表單/設定，空態不適用） |

**🟡 發現 F1（低）— chrome 查詢無顯式錯誤態**
`shells/AidvShellChrome.tsx:47,49` 的 `creativeProject.list`（ProjectSwitcher）與 `credits.myBalance`（點數 chip）兩個 query 無顯式錯誤態，失敗時靜默落空。chip 類降級可接受，但建議補 degraded 顯示（如「—」＋tooltip）。**→ 路由 AIDV-94（U-4 chrome）**

**🟢 發現 F2（資訊）— 空態 heuristic 待人工確認**
`learn/ApiKeysPanel`、`settings/GeneralSettingsPanel`、`settings/admin/ContentTab`、`settings/admin/FeatureFlagsTab`、`video/drawers/VideoSettings` 自動掃描未命中「空態」字樣——**多為表單/開關面板，空態本不適用**。列此供 Phase 2 人工逐頁確認（非確認缺陷）。

---

## §2 RWD 斷點一致性（SSOT＝768/1024/1280）

- 掃描 `shells/**` ＋ `components/social/**`：**未發現 off-grid 像素斷點**；皆走 Tailwind `md`(768)/`lg`(1024)/`xl`(1280)＝與 SSOT 對齊 ✅。
- `hooks/useMobile.tsx` `MOBILE_BREAKPOINT=768` 與 `index.css` `--bp-mobile/tablet/desktop` 一致 ✅。
- **規格整改（文件層）**：AIDV-118 卡描述的 `1181/1180/780/430` 與實作不符——已於本表定錨以實作為準；建議把卡描述四斷點同步改為 `≥1280 桌機／768–1279 平板收窄／<768 手機／<640(sm) 窄機`，避免後人誤用。**→ 回填 AIDV-118 卡描述（規格對齊）**

---

## §3 a11y（WCAG AA／鍵盤／aria）

- **icon-only 按鈕**：掃描 18 個 `size="icon"` shadcn 按鈕，**所在檔案皆含 `aria-label`**（檔層通過）。建議 Phase 2 人工逐顆抽查（檔層通過≠每顆都標）。
- **全域基線良好**：`index.css` 具全域 `:focus-visible`、`.focus-ring-healing`、`sr-only`；`PanelState`/`states.tsx` 四態內建 `role="status"/"alert"`、`aria-busy`、`aria-live`。
- **Phase 2 人工項**：正文對比 ≥4.5:1、大字/圖示 ≥3:1（clay/gold 用 deep 版）、焦點環實機可見、⌘K/↑↓↵/Esc/Tab 鍵序——皆需**實際量測/操作**，留 Bruce 走查。

---

## §4 prefers-reduced-motion

- **CSS 動畫**：`index.css` 多處 `@media (prefers-reduced-motion: reduce)` 守衛 ✅。
- **JS（framer-motion）動畫**：CSS media query **不會**停止 framer JS 動畫，須各元件用 `useReducedMotion`。首頁 15 個 framer 動畫層中 **14 個已守**（AgentBlueprint/OrbCreationStage/Aurora/Caustics/Constellation/Cosmic… 皆 ✅）。

**🟡 發現 F3（低）— 唯一未守 reduced-motion 的 framer 元件**
`components/home/ScrollProgressBar.tsx`（`useScroll`＋`useSpring` 捲動進度條）無 `useReducedMotion`；spring 抖動對前庭敏感者不友善。修：`useReducedMotion()` 為真時改 `useScroll` 直給（不過 spring）或隱藏。**→ 路由 AIDV-119（U-10 首頁／home 軌）**

---

## §5 硬編色 vs design-kit token

掃描 >2 處硬編 hex（排除黑白）的元件：

| 檔 | hex 數 | 路由 |
|---|---|---|
| `components/design-kit/ShotCard.tsx` | 4 | **AIDV-92（U-2，design-kit 應走 token）** |
| `components/social/TemplatePicker.tsx` | 12 | **AIDV-96（U-6 /social）** |
| `shells/video/console/AmbientOrb.tsx` | 8 | 舊版視覺，待 U-11 收斂（AIDV-114） |
| `components/home/OrbCreationStage.tsx` | 24 | 首頁裝飾，AIDV-119 |

> 註：裝飾性漸層/光暈用 hex 有時為刻意（非語意色）；design-kit `ShotCard` 與 social `TemplatePicker` 屬語意元件、**優先**改 token。

---

## §6 缺漏路由表（缺漏回報各殼卡修補）

| 編號 | 嚴重度 | 發現 | 擁有卡（一軌一主） |
|---|---|---|---|
| F1 | 🟡 低 | chrome ProjectSwitcher/點數 chip query 無錯誤態 | AIDV-94（U-4） |
| F3 | 🟡 低 | `ScrollProgressBar` framer 未守 reduced-motion | AIDV-119（home） |
| F4 | 🟢 微 | `ShotCard` 4 處硬編色應走 token | AIDV-92（U-2） |
| F5 | 🟢 微 | `TemplatePicker` 12 處硬編色應走 token | AIDV-96（U-6） |
| F6 | 📝 文件 | 卡描述斷點 1181/1180/780/430 與實作不符 | AIDV-118（本卡描述對齊） |

---

## §7 Phase 2（人工走查待辦，交 Bruce）

1. 四斷點真機/瀏覽器縮放 RWD 破版逐頁目視（桌機/平板/手機/窄機）。
2. 對比度實測（正文 ≥4.5:1、大字/圖示 ≥3:1，clay/gold deep 版）。
3. 焦點環可見性＋鍵盤序（⌘K/↑↓↵/Esc/Tab）逐殼操作。
4. icon-only 按鈕逐顆 aria-label 抽查。
5. 四態截圖對照（用 `VITE_STATE_INSPECTOR=1` 四態切換器逐區走查）。

> Phase 1（本表）＝自動可掃部分，已交付；Phase 2＝需人眼/真機，不可自動化部分，待 Bruce 走查後勾稽回本表。
