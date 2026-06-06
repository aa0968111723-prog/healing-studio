# Healing Studio — 設計參考（內部團隊用）

> 一頁整合設計資產、品牌 token、頁面路由與 UX 原則，方便團隊內部對齊。
> 來源：`client/src/index.css`、`client/src/App.tsx`、Notion「Healing Studio 網站知識庫」。
> 建立：2026-06-03

## 設計資產連結

| 項目 | 連結 / 位置 |
|---|---|
| Figma — 網站頁面匯入（5 頁截圖板） | https://www.figma.com/design/ZW57DWB0QIks8QPlLLzCsb |
| Canva — 品牌主視覺概念稿（文字已修正） | https://www.canva.com/d/ysK5sYZisVEjZFe |
| Canva 其他概念稿 | A `WJgjSP967WEuhhN` · C `g4tColMMj63-XRu` · D `kFV4KQpB2QzPjb0` |
| Notion — UI 系統 | https://app.notion.com/p/369b7d0ed73a81018193dc7630ddabea |
| Notion — UX 系統 | https://app.notion.com/p/369b7d0ed73a8184a007c42196f5faba |
| 截圖腳本 | `scripts/figma-screenshots.mjs` |

## 品牌 Token（淺色主題）

字體：`--font-sans: "Noto Sans TC", "Inter", system-ui, sans-serif`（主字為 **Noto Sans TC**）

| 角色 | CSS 變數 | OKLCH（真實來源） | 約略 HEX |
|---|---|---|---|
| 背景 | `--background` | `oklch(0.97 0.006 75)` | `#F7F5F1` |
| 文字 | `--foreground` | `oklch(0.28 0.01 60)` | `#2D2824` |
| 主色 | `--primary` | `oklch(0.4 0.02 60)` | `#50453D` |
| 強調（淡紫） | `--accent` | `oklch(0.91 0.015 300)` | `#E3DFEA` |
| 強調文字 | `--accent-foreground` | `oklch(0.35 0.02 300)` | `#3C3844` |
| Muted | `--muted` | `oklch(0.94 0.008 75)` | `#EEEAE5` |
| 邊框 | `--border` | `oklch(0.91 0.01 75)` | `#E5E0DA` |
| 療癒光暈 | `--ring-healing` | `oklch(0.82 0.04 300)` | `#C8BFDB` |

深色主題：背景 `#101117`、主色（淡紫）`#D0CADF`。完整值見 `client/src/index.css`。

> ⚠️ 注意：設計系統的**強調色是淡紫 (hue 300)**，但首頁光球是**青藍**。做新視覺時先確定走「青藍光球」或「品牌紫」，避免不一致。

Radius/Spacing：4 / 8 / 12 / 16 / 24px 節奏；`glass-card` 只用於面板、抽屜、浮層，不整頁玻璃化。

## 已匯入 Figma 的 5 個關鍵頁

| 頁面 | 路由 | 說明 |
|---|---|---|
| Home | `/` | 光球登陸頁（公開） |
| CreationHub | `/create` | 影片專案管理區 |
| Dashboard | `/dashboard` | 用量／積分儀表板 |
| Studio | `/studio` | 創作工作室（圖片/影片/音樂/語音） |
| DirectorAI | `/director` | 導演 AI（對話→腳本→世界觀→分鏡→生成） |

## 完整路由地圖

公開：`/`、`/forgot-password`、`/reset-password`、`/404`

主要創作：`/create`、`/studio`、`/director`、`/image-studio`、`/video-studio`、`/pro-studio`、`/light-orb-studio`、`/animation`、`/worldbuilding`、`/playground`

專案／素材：`/projects`、`/creative-projects`、`/assets`、`/vault`、`/shared`、`/notes`、`/calendar`、`/history`

模型／大腦：`/models`、`/ai-models-hub`、`/model-wishlist`、`/lora-trainer`、`/my-brain`、`/teaching-archive`、`/prompt-library`、`/prompt-collection`

學習／其他：`/learn`、`/tutorial-overview`、`/focus-flow`、`/agent`、`/codex`、`/teams`、`/unorganized`

設定：`/settings`、`/settings/agent`、`/settings/ai-brain`、`/account-settings`、`/credits`、`/feedback`

管理：`/admin`、`/admin/api-usage`、`/admin/brain-pipeline`、`/dashboard`、`/background-tasks`、`/process`、`/langsmith`

## UX 六大原則（摘自 Notion 14 號頁）

1. **Continuity** — 專案／世界觀／提示詞／素材／模型／任務跨頁保留。
2. **Progressive Disclosure** — 新手先看可操作入口，進階參數收進 drawer/tabs/advanced。
3. **Recoverability** — 生成任務、背景任務、素材、歷史、筆記都要能找回重用。
4. **Cost Awareness** — 點數、預估成本、provider 選擇、失敗重試都要可理解。
5. **Ambient Assistance** — 光球／Agent 是全站陪伴層，懂目前頁面但不搶主線。
6. **Operator Visibility** — 管理者能看 API 用量、provider health、metrics、logs。

每個 API 狀態都要四態：**loading / empty / error / success**；長任務要顯示可追蹤的 job id / trace id。

## 重現頁面截圖

```bash
VITE_FIGMA_CAPTURE=1 npx vite build      # 讓需登入的 dashboard 頁面可渲染
npx vite preview --port 4173 --host &
node scripts/figma-screenshots.mjs       # 輸出 PNG 至 /tmp/figma-shots
```
