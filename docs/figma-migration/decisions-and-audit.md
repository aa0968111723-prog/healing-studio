# Figma / Adobe 搬遷 — 決策評估 + UI/UX 稽核

> 承接 `README.md`（三階段方案）。本文回答三個決策：
> (1) 要不要升級 Figma、(2) Adobe 怎麼搭、(3) 搬遷前該先修的 UI/UX 缺陷。

---

## 1. 要不要升級 Figma 訂閱？

**現況**：Professional · **Collab seat** = MCP 工具 **6 次／月**。

| 你想做的事 | 需要的呼叫數 | Collab(6/月) | 需升級？ |
|---|---|---|---|
| A · 像素快照（`generate_figma_design`） | **免額度** | ✅ 可做 | 否 |
| B · 建設計系統（`use_figma`） | 100–300 次 | ❌ 一天就爆 | **要（Full/Dev seat）** |

**升級後**：Full/Dev seat on Pro = **200 次／日、15 次／分** → 足以跑完整套元件庫。

**建議**：**先別急著升級**。理由見第 3 節——目前程式碼的**設計 token 架構有衝突**，
若現在就把它 1:1 建進 Figma，等於把缺陷也複製進去。正確順序是：
**先在 code 修好 token 架構 → 再升級 seat → 一次把乾淨的設計系統建進 Figma。**
在那之前，像素快照（A）與 Adobe（第 2 節）都不吃 Figma 額度，可先並行推進。

---

## 2. Adobe 怎麼搭（重點：完全繞過 Figma 6/月 限制）

環境內有整套 Adobe MCP（Express / Firefly / 影像 / 文件）。它和 Figma **定位不同**，
不是二選一，是分工：

| 工具 | 最適合 | 對本專案 |
|---|---|---|
| **Figma** `html.to.design` / `generate_figma_design` | App 頁面 **1:1 像素捕捉** | 路線 A 首選 |
| **Figma** `use_figma` | 可維護**設計系統元件庫** | 路線 B（需升級 seat） |
| **Adobe Express** `export_html_to_express` | HTML → 可編輯 Express 文件 | 行銷／簡報／社群視覺 |
| **Adobe Firefly / 影像** | 生成／去背／向量化素材 | 品牌素材、hero 圖 |

**Adobe 的甜蜜點**：不是拿來 1:1 抄 App（它需要自包含 HTML，SPA 不好餵），
而是**用你的設計系統產出「衍生視覺」**——落地頁、社群圖、簡報、印刷品。
這條路**不吃 Figma 額度**，可以立刻做。

**可立即試點**：挑一頁（如 Home / VideoStudio）→ 產出一份自包含 HTML →
`export_html_to_express` 轉成 Adobe Express 文件，驗證「設計系統 → Adobe」通路。

---

## 3. UI/UX 缺陷稽核（靜態掃描 · 有實證）

搬進 Figma/Adobe **之前**該修的問題。按嚴重度排序：

### 🔴 A. Design token 同名不同義（架構級，直接影響搬遷）
`client/src/components/design-kit/README.md` 自述：`--muted`、`--surface-2`、
`--surface-3` 在**全站 `:root`（shadcn）**與 **`.aidv-kit` scope** 兩層**同名不同義**——
`.aidv-kit` 裡 `--muted` 是「次級文字色」，全站 `--muted` 是「靜音背景色」。
- **影響**：我從 `:root` 建的 24 個 Figma 色變數，套到 design-kit 元件上會**解析成錯的顏色**。
  任何「1:1」搬遷都會踩這個雷。
- **建議**：把 `.aidv-kit` 的別名改成**不衝突的命名**（如 `--dk-text-muted`、
  `--dk-surface-2`），讓 token 全域唯一，再建 Figma 變數才安全。

### 🟠 B. 極小字級氾濫（可讀性／無障礙）
**200 個 TSX 檔**用到 `text-[9px]` / `text-[10px]` / `text-2xs` / `text-3xs`。
- CJK（中文）在 9–10px 下辨識度差，違反可讀性最佳實務（正文建議 ≥ 12–14px）。
- **建議**：稽核這批用途，chip/metadata 以外的正文拉回 ≥ 12px；把最小可用字級
  定成 token 並在設計系統標註「僅限標籤」。

### 🟠 C. 硬寫 hex 色繞過 token（主題漂移）
**30 個 TSX 檔**內嵌 `#RRGGBB`。其中畫布／WebGL／漸層（`VisualSoul*`、
`OrbCreationStage`、動畫預覽）屬合理例外，但 **`SettingsPage`(8)、
`DashboardPage`(15)、`LangSmithPage`(16)、`AdminApiUsagePage`(8)** 等一般 UI 硬寫色
= **暗色模式不會跟著變**、與 token 不同步。
- **建議**：一般 UI 的 hex 換成語意 token（`text-foreground`/`bg-muted`…）；
  畫布類保留但集中到常數檔。

### 🟡 D. 登入畫面在設計系統之外
`.login-cosmic` carve-out（design-kit README 明列「不在範圍」）。
- 搬遷時需**單獨處理**登入頁，別套一般設計系統元件。

### ✅ 表現良好處
- 圖片缺 `alt`：僅 **1 處**（無障礙圖片標註幾乎到位）
- 非語意可點元素（`<div onClick>`）：僅 **1 處**（按鈕語意乾淨）

---

## 建議執行順序

1. **修 token 衝突（缺陷 A）** — 解鎖乾淨的 Figma/Adobe 搬遷
2. **並行**：Adobe 試點（不吃額度）+ Figma 像素快照（`generate_figma_design`，不吃額度）
3. **稽核字級（B）與硬寫色（C）** — 提升搬遷後的成品品質
4. **升級 Figma seat** → 建完整設計系統元件庫（路線 B）
5. 逐頁對帳、Code Connect 對回程式碼

## 證據指令（可複現）
```bash
# B. 極小字級
grep -rlE "text-\[(9|10)px\]|text-2xs|text-3xs" client/src --include=*.tsx | wc -l   # 200
# C. 硬寫 hex
grep -rlE '#[0-9a-fA-F]{6}' client/src --include=*.tsx | wc -l                       # 30
```
