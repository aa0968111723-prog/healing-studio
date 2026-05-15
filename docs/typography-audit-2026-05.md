# Typography & Layout Audit — 2026-05

> 全站排版與 typography token 一致性審視。  
> 範圍：`client/src/`。產出時間：2026-05-15。

## 1. Token 系統現況

**字型 token 定義位置**：`client/src/index.css` L2346–2443（`.hs-*` 類別）

| Token | Mobile | Tablet (≥640px) | Desktop (≥1024px) | Weight | Line-height | Letter-spacing |
|---|---|---|---|---|---|---|
| `.hs-h1` | 30px | 36px | 48px | 700 | 1.25→1.2 | -0.02em |
| `.hs-h2` | 20px | 24px | 30px | 600 | 1.3 | -0.01em |
| `.hs-h3` | 14px | 16px | — | 600 | 1.4 | -0.005em |
| `.hs-h3-lg` | 18px | 20px | — | 600 | 1.35 | -0.01em |
| `.hs-p` | 14px | — | 16px | 400 | 1.625→1.75 | 0.01em |
| `.hs-small` | 12px | 13px | — | 400 | 1.5 | 0.01em |

**字體**：`--font-sans: "Noto Sans TC", "Inter", system-ui, sans-serif`（index.css L53）

**Spacing scale**：`--space-1` ~ `--space-12`（4px → 192px）

**Glass surface 語意色**：
- `--text-on-glass-strong: oklch(0.28 0.01 60)` — 主要文字
- `--text-on-glass-soft: oklch(0.42 0.012 60)` — 次要/disabled

**Tailwind 設定方式**：v4 `@theme inline`（index.css L6-62），無獨立 `tailwind.config` 檔。

### 關鍵缺口

- ❌ **無 fontSize 自訂 token**：所有頁面用 Tailwind 預設 `text-xs/sm/base/...` 或硬編 `text-[10px]`
- ❌ **無 letter-spacing 自訂 token**：頁面充斥 `tracking-[0.18em]`、`tracking-[0.22em]`
- ✅ Color、spacing、radius、font-family 有 token

---

## 2. Top 10 不一致清單（依嚴重度）

### HIGH

1. **`pages/AIModelsHub.tsx` L232**  
   `<h3 className="hs-h3 !mb-0 text-gray-900 dark:text-white ...">`  
   `hs-h3` 的顏色立刻被 `text-gray-900 dark:text-white` 蓋掉。單檔內 115+ 處硬編色。

2. **30+ 檔案用 `text-[10px]` / `text-[11px]`**  
   完全繞過 `.hs-small`/`.hs-p` scale。
   主要違者：AIModelsHub.tsx（30+）、ShowcaseMasonry.tsx、IntelBentoGrid.tsx、GenerationControls.tsx、PortfolioDetailDialog.tsx、LoginOrbAnimation.tsx。

3. **`pages/DirectorAI.tsx` L4294** — `<h1 className="hs-h2 !mb-0">導演 AI</h1>`  
   語意/樣式錯位。**但**：DirectorAI 同時是 `/director` 獨立路由 + CreationHub 的 tab。改成 `<h2>` 會破壞獨立路由的語意；改成 `hs-h1` 會在 tab 內過大。屬於架構決策，不是單純的 typography fix。

4. **硬編 Tailwind 色彩繞過 healing palette**  
   `pages/DirectorAI_batch_dialog.tsx` L337–340 用 `text-purple-600`、`text-pink-600`，應改用 `--color-zen-lavender`、`--color-zen-blush` 或語意 token。  
   違者：AgentChat.tsx (85)、ProStudio.tsx (37)、LearnHub.tsx (59)、ImageStudio.tsx (15)。

5. **次像素 micro-spacing**  
   `components/home/OrbCreationStage.tsx` L1270/1283 — `gap-[3px]`、`gap-[1.5px]`、`mt-[1px]`。破壞 spacing scale。

### MEDIUM

6. **同一語意角色用不同 font-weight**  
   ShowcaseMasonry、IntelBentoGrid 與 180+ 元件混用 `font-bold`/`font-semibold`/`font-medium`。

7. **回應式字級沒對齊 `.hs-*` 斷點**  
   `PortfolioDetailDialog.tsx` L270 — `text-2xl sm:text-3xl font-semibold tracking-tight`，建立了平行於 `.hs-h2` 的第二套系統。

8. **同類內容混用不同 line-height**  
   多個檔案：body 文字同時出現 `leading-relaxed`、`leading-snug`、`leading-tight`、`leading-none`。

### LOW

9. **任意 letter-spacing**  
   `tracking-[0.18em]`、`tracking-[0.16em]`、`tracking-[0.22em]` 散落各處（PortfolioDetailDialog、LoginOrbAnimation、ArticleDialog）。建議建立 tracking token。

10. **以 `<div>` 當標題**  
    例：`AIModelsHub.tsx` L402 — `<div className="text-3xl mb-2">🔍</div>` 用作 section 分隔。應該是 `<h2>` 或裝飾性 `aria-hidden`。

---

## 3. 主要頁面巡查

| 頁面 | h1 | h2 | h3 | 主要問題 |
|---|---|---|---|---|
| Home | 0 | 1 | — | 缺 h1；hero 用 div+emoji |
| AIModelsHub | 0 | 0 | 5+ | 全 h3；無 section 分層；115 處硬編色 |
| DirectorAI | 1 (h1.hs-h2 錯位) | 0 | 5+ | 嵌入 CreationHub 時產生重複 h1 |
| AgentChat | 0 | 0 | 3+ | 全 h3；85 處硬編色 |
| LearnHub | 0 | 0 | 4+ | 全 h3；混用 line-height；59 處硬編色 |
| ProStudio | 0 | 0 | 1+ | 全 h3；37 處硬編色 |
| SettingsPage | 0 | 9 (all hs-h3) | 1+ | h2 全用 `.hs-h3` 樣式 |

**通用 pattern**：17+ 頁面把頁首寫成 `<h1 className="hs-h2 !mb-0">` — 這是團隊慣例（語意 h1 + 視覺壓縮成 h2），不算 bug，但與 `.hs-h1` token 的定位脫鉤。

---

## 4. 元件層（client/src/components/ui/）

| 元件 | 問題 | 行 |
|---|---|---|
| button.tsx | 硬編 `text-sm`、size variants 直接寫 `h-8/h-9/h-11` | 8、26-31 |
| card.tsx | `CardTitle` 用 `font-semibold leading-none` 但不指定 size；`CardDescription` 硬編 `text-sm`；根 `gap-6 py-6` | 26、52、62 |

---

## 5. CJK 觀察

- 字型：`"Noto Sans TC"`（繁中）— 正確
- ❌ 無簡體（`Noto Sans SC`）/日文（`Noto Sans JP`）fallback
- 一次性覆蓋：`lib/orbExportShare.ts` L7 用 `"PingFang TC", "Microsoft JhengHei"` — 與全局不一致
- `font-feature-settings`：body 已開 `rlig` + `calt`（好），但無 CJK 特定 feature

---

## 6. 建議分階段清理

### Phase 1 — 基礎（最影響後續）

1. **擴充 `@theme inline`**：加入 fontSize 與 letter-spacing token，讓 `text-h3`/`tracking-display` 等語意 utility 可以直接使用，逐步取代 `.hs-*` CSS 類別與 arbitrary value
2. **建立 text color 語意 token**：`--text-primary` / `--text-secondary` / `--text-tertiary`，取代 `text-gray-X dark:text-Y` 雙向硬編
3. **修明顯語意 bug**：Home 缺 h1；ComponentShowcase 的 `<h3 className="hs-h2">` 標題

### Phase 2 — 大檔重構

4. AIModelsHub.tsx 全檔 color 清掃（115 處）
5. DirectorAI_batch_dialog.tsx、AgentChat.tsx、LearnHub.tsx、ProStudio.tsx 的 palette 對齊
6. 30+ 檔案的 `text-[10px]` / `text-[11px]` 替換為 `text-xs` 或 `hs-small`

### Phase 3 — 架構決策

7. CreationHub 嵌入 tab 時的重複 h1 問題：建議子頁面接受 `headingLevel` prop，由父頁傳入
8. shadcn 元件層 (`components/ui/`) token 化

### Phase 4 — Nice to have

9. CJK fallback 擴充（SC / JP）
10. tracking 系統化（替換 `tracking-[0.18em]` 之類）
11. line-height 規則文件化（headings / body / metadata 各自的 token）

---

## 7. 修正策略原則

- **不破 UI**：每次 migration 後 visual diff 應為零或可預期的微調
- **語意 token 優先**：`text-foreground` > `text-gray-900` > `text-[#1F2937]`
- **單檔/單元件批次**：避免跨檔大範圍 search-replace；每次 PR 控制在 1 個檔或 1 個元件
- **保留 `.hs-*` 為過渡層**：新增 Tailwind token 後，`.hs-*` 仍可共存，舊頁面慢慢遷移
