# 網站 → Figma 1:1 搬遷方案（healing-studio）

目標：把 healing-studio（React + Vite，53 條路由、56 個 UI 元件、一套 design-kit
設計系統）**一比一**放進 Figma，且**兩者都要**——

- **A. 像素級視覺快照**：逐頁 pixel-perfect 抄成可編輯 Figma 圖層。
- **B. 可維護設計系統**：把 design tokens + UI 元件建成 Figma Variables / Components。

## 為什麼要分兩條路

「1:1」有兩種互斥的意義，硬要一步到位反而兩邊都做不好：

| | A · 像素快照 | B · 設計系統 |
|---|---|---|
| 產物 | 一頁一畫板，逐像素對齊 | Variables + Components 元件庫 |
| 像不像 | 100% 像截圖 | 用設計語言重建，頁面級非逐像素 |
| 可維護 | 差（死圖層） | 高（可改可重用） |
| 工具 | Figma 桌面版 + `html.to.design` plugin（吃公開網址） | 本 repo 的 Figma MCP（code→Figma） |
| 誰來做 | 需人在 Figma 桌面端操作，AI 只能備料/導引 | AI 可直接產出 |

> 本環境的 Figma MCP **只能做 B**（從程式碼生成）。**A 需要在 Figma 桌面端**用
> `html.to.design` 這類 plugin 抓已部署網址——那不在 MCP 工具範圍內，AI 負責備妥
> 網址清單與對照表，實際匯入由你在桌面端一鍵批次完成。

## 三階段工作流（建議順序）

### Phase 0 — 基礎（B，AI 在此環境可做）
1. 抽 `client/src/index.css` 的設計 token（OKLCH 色盤、Zen Morandi 療癒色、
   radius 階、CJK 字距、動畫節奏）→ 建成 Figma **Variables**（含亮/暗雙模式）。
2. 把 `client/src/components/ui/`（56 個 shadcn/radix 元件）+ design-kit 原子件
   建成 Figma **Components**（含變體 variants）。
   > 這是整個元件庫的骨幹，A 路線抓進來的死圖層之後靠它「認領」成語意元件。

### Phase 1 — 像素快照（A，你在 Figma 桌面端做，AI 備料）
1. 確保 53 條路由都有**公開可達網址**（見下方 route manifest）。
2. Figma 桌面版安裝 `html.to.design` plugin →「Import from URL」→ 貼上
   `route-manifest.csv` 的網址，可批次逐頁匯入。
3. 每頁一個 Figma Page 或 Frame，命名對齊路由。

### Phase 2 — 對帳（reconcile）
- 把 A 抓進來的頁面，關鍵區塊替換成 B 的元件，讓像素稿變成可維護稿。
- 用 Figma **Code Connect** 把 Figma 元件對回 repo 元件路徑，雙向同步。

## 需要你提供 / 決定
- [ ] **公開網址 base URL**（Phase 1 必需；目前 repo 未找到，`route-manifest` 先留佔位）
- [ ] 認證頁（`/`, `/forgot-password`, `/reset-password`）匯入時是否需登入態截圖
- [ ] 動態頁（`:id` / `:storyboardId`）要用哪組真實 ID 當代表樣本

## 檔案
- `route-manifest.csv` — 53 條路由，A 路線批次匯入用
- `README.md` — 本文件
