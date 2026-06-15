# `components/design-kit/` — AI Director 設計套件元件庫

亮色暖光（黏土／珊瑚橘）設計系統的 React 元件，從設計交付包接進真實 repo。

- **來源（SSOT）**：`docs/4shell-handoff/AI-Director-UIUX設計/00_設計系統/`（rev L1）
- **Jira**：Wave U「UIUX 視覺實裝」Epic `AIDV-74`（落地卡見下）
- **視覺基準**：亮色暖光，主強調＝黏土／珊瑚橘 `--clay`（也是全站 shadcn `--primary`）

## 內容

| 檔案 | 說明 |
|---|---|
| `tokens.ts` | JS/TS 常數與型別（`cn`、provider/門狀態/人格…）；色彩真實來源是 CSS 變數 |
| `primitives.tsx` | `Button` `Pill` `Tag` `Kbd` `Eyebrow` `Toggle` `Meter` `Spinner` `Card` `Input` |
| `GateCard.tsx` | 確認門卡＋`computeGate`/`countGate` |
| `ShotCard.tsx` | 分鏡卡（生成狀態機）＋`frameStyle` |
| `PromptVault.tsx` | 「生成→存庫→重用」提示詞庫（`SaveToVault`/`VaultBrowser`） |
| `WorkflowBuilder.tsx` | 可設定工作流（`FlowBar`/`WorkflowBuilder`/`VIDEO_DEFAULT`/`STEP_LIBRARY`） |
| `design-kit.css` | `.aidv-kit` 範圍化 token 別名（見下） |
| `AidvKit.tsx` | scope 包裝元件 |

## 用法

元件綁設計系統「短別名」token（`--surface` / `--text` / `--muted`＝次級文字…）。
其中 `--muted` `--surface-2` `--surface-3` 與 app 既有 shadcn token **同名不同義**，
故元件**必須**用在 `.aidv-kit` 範圍內，token 才會解析成設計套件原義。

```tsx
import { AidvKit, ShotCard, Button, Pill } from "@/components/design-kit";

<AidvKit>
  <ShotCard … />
  <Button variant="primary">生成</Button>
</AidvKit>
```

也可不用包裝，直接在祖先節點加 `className="aidv-kit"`。

## Token 分層

- **全站 `:root`**（`client/src/index.css`）：shadcn 語意色已換成亮色暖光，
  並提供平台擴充色 `--clay*` `--gold*` `--teal` `--ok/warn/bad/info`、暖色陰影、
  動效、`--font-serif`（Fraunces／Noto Serif TC）。utility：`bg-clay` `text-gold` …
- **`.aidv-kit`**（`design-kit.css`）：僅重綁與 app 衝突的短別名
  （`--surface*`／`--muted`＝文字／`--text*`），不污染全站。

## 不在範圍

- **登入畫面**：依指示保留原本 cosmic 場景識別，不套此設計系統
  （見 `index.css` 的 `.login-cosmic` carve-out）。
- 深色「夜間/影院」次模式：後續里程碑（token 層已預留）。
