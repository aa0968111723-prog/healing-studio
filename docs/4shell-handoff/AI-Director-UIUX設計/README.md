# AI Director · UI/UX 設計交付（亮色暖光 Claude 識別）

> 接手 AI Director / healing-studio 平台 UI/UX 設計：把既有模擬升級成**一套有完整設計系統、視覺精緻、可直接搬回 React 19 + Vite + Tailwind 真實 repo** 的高擬真互動原型。
> **視覺方向**：明亮通透的暖米白分層表面 ＋ 黏土／珊瑚橘主強調，留白、柔和圓角、克制細邊框、安靜層次、標題帶 serif 質感。靈感取自 Claude/Anthropic 的「感覺」，但為平台自有亮色識別（非照抄）；**保留原系統**、只統一視覺語言並補齊細節。
> **rev. L1** · 2026-06-06

---

## 📦 我負責的範圍（地基 ＋ 旗艦）

| # | 交付 | 位置 | 狀態 |
|---|---|---|---|
| 1 | **設計系統（單一真實來源 SSOT）** | `00_設計系統/` | ✅ |
| 2 | **共用 app 殼層 / 4-shell 切換** | `01_殼層/` | ✅ |
| 3 | **/video 完整規格（六步工作流 ＋ 確認門狀態機）** | `shell-video/` | ✅ |
| 4 | **共用「生成→存庫→重用」提示詞庫模式** | `00_設計系統/`（§9 ＋ `react/PromptVault.tsx`） | ✅ |
| 5 | **reference 互動原型（設計系統＋殼層＋/video）** | `_reference原型/index.html` | ✅ |

> `/social`、`/learn`、`/settings` 三殼由**平行工作階段**設計，直接引用本 `00_設計系統/設計系統.md` 對齊 token。原型中這三殼顯示「平行工作階段設計中」佔位（共用同一脊椎與設計系統）。

---

## 🗂 資料夾結構

```
AI-Director-UIUX設計/
├── README.md                         ← 本檔（總覽）
├── 00_設計系統/                       ← 單一真實來源 SSOT（其餘 shell 引用此）
│   ├── 設計系統.md                    ★ 權威：tokens + 51 元件規格 + 生成→存庫→重用 + 四態/RWD/a11y
│   ├── theme.css                      ← 完整亮色樣式（class 同名，drop-in 取代 styles.css）
│   ├── tokens.css                     ← 純 :root 變數（vanilla HEX）
│   ├── tokens.oklch.css               ← Tailwind 4 @theme + shadcn :root（貼回真實 repo index.css）
│   ├── style-guide.html               ← 可視化 style guide（瀏覽器開）
│   └── react/                         ← React 19 + Tailwind 元件（可貼）
│       ├── tokens.ts · primitives.tsx · GateCard.tsx · ShotCard.tsx · PromptVault.tsx
├── 01_殼層/殼層規格.md                ← 4-shell + 脊椎 chrome + RWD + route map
├── shell-video/video規格.md           ← /video 六步工作流 + 確認門 + ShotCard + route/procedure 對映
├── _reference原型/index.html          ★ 可在瀏覽器打開、能點的互動原型
├── _research/                         ← 研究筆記（社群深設計 / 程式碼現況校正）
└── _GitNexus程式碼真實對照表.md        ← （你產生中）產出後逐條核對 procedure
```

---

## ▶️ 怎麼看

1. **互動原型**（最推薦）：用瀏覽器開 `_reference原型/index.html`。
   - 點左側 Rail 切 4 shell；`/video` 為完整旗艦。
   - 確認門：點「上傳參考照」→ 角色升級 → 鏡頭解鎖（可量產數字增加）。
   - 分鏡卡：點「生成」看 估算→生成中→完成 全狀態；「核准」「同 seed 重生」。
   - 「＋存入提示詞庫」→ 右欄「提示詞」分頁看 存入→重用（再生成/插入/fork）。
   - `⌘K`／`Ctrl+K` 開命令面板（↑↓ 選、↵ 執行、esc 關）。
   - 「引導式創作」開長腳本拆片 modal（填範例→拆解→確認→寫入）。
   - 「狀態檢視」strip 切 cockpit 空/載入/錯誤/成功；縮放視窗看 RWD（手機底部光球 FAB）。
2. **設計系統視覺**：開 `00_設計系統/style-guide.html`（色彩/字級/圓角/陰影/元件/旗艦複合元件）。
3. **規格文件**：`00_設計系統/設計系統.md`（SSOT）→ `01_殼層/殼層規格.md` → `shell-video/video規格.md`。

---

## 🔌 怎麼貼回真實 repo（React 19 + Vite + Tailwind 4 + shadcn）

- **token**：把 `00_設計系統/tokens.oklch.css` 的 `:root` 與 `@theme inline` 覆寫進 `client/src/index.css`（亮色暖光值；HEX 在 Tailwind 4 合法）。
- **元件**：`00_設計系統/react/*` 直接貼進 `client/src/components`（已綁 CSS 變數，不寫死 hex）。
- **模擬/原型**：`theme.css` 可 drop-in 取代 `AI-Director-模擬/styles.css`（class 全同名）。
- **對齊**：四殼一律引用 `設計系統.md` 的 token 名稱（已凍結，rev 進位才改）。

---

## ✅ 已驗證
- **設計系統 CSS**：靜態 lint — 158 CSS 變數、227 class、**0 個未定義變數、括號平衡**。
- **互動原型 JS**：DOM 實跑逐路徑 — 殼層切換、確認門升級（可量產 3→5）、分鏡生成全生命週期、提示詞庫存入→重用、⌘K 過濾/執行、引導式拆片 input→loading→review→寫入、跳階驗證、四態切換、RWD — **全綠**。
- **procedure 對映**：以 `_research/03_code_reality_notes.md`（GitNexus 校驗）為準，持久化錨點 `promptLibrary.create` ＋ `generate.recordGenResult` 已確認**真實存在**（非 mock）。

## ⏳ 待辦 / 開放項
- **`_GitNexus程式碼真實對照表.md`**（你產生中）出爐後，逐條核對所有 procedure 對映並更正（video規格 §9、設計系統 §9.4）。
- 視覺截圖：沙盒無法下載 Chromium（網路限制），故未附自動截圖；可直接開原型卡片檢視，或我用 Claude in Chrome 在你的瀏覽器截圖確認。
- 深色「夜間/影院」次模式：後續里程碑（token 層已預留，只覆寫 surfaces 與語意別名）。

*所有產出 read-only，未寫入或改動 `healing-studio-dev` 真實 repo。*
