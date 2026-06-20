# 乾跑驗證 — aidv-longloop on AIDV-95（非破壞性）

> 用 `aidv-longloop` 走步驟 **1→5（align→design→schedule）**，示範技能產出。
> **非破壞性**：只讀 Jira／repo，**未寫任何 Jira、未開 PR、未部署**。日期 2026-06-18。
> 卡：[AIDV-95](https://aa0968111723.atlassian.net/browse/AIDV-95) · 進行中 · Medium · label `uiux`/`wave-u` · 父 Epic AIDV-74（Wave U）。

---

## 步驟 1 — 認領（align）
- **卡**：U-5 /video 六步工作流座艙視覺實裝（含確認門＋ShotCard）。量級 **L**；依賴 **U-1（AIDV-91 tokens）、U-4（AIDV-94 chrome）**＝皆已 Done → **依賴已解，可進行**。
- **北極星對位**：推進「logline→成片」六步的**主座艙**本身（S1 腳本→S6 匯出），是 Wave U 的旗艦頁。
- **驗收（卡內）**：六步畫面以 design-kit 實裝；GateCard/ShotCard 接真實 spine；四態＋RWD＋a11y；與設計稿一致；tsc/build/lint 綠。

## 步驟 2 — 現況對齊（看 main，不照舊圖做）

> **關鍵發現**：座艙骨架與 S4/S5 的 design-kit 採用**已存在於 main**，AIDV-95 是「**把剩下幾步補到同標準＋驗四態/RWD/a11y**」，**不是從設計稿重做**。

實證（`client/src/shells/video/`）：

| 六步 | 現有檔（main 實證） | design-kit 採用 | 缺口 |
|---|---|---|---|
| S1 腳本意圖＋劇本庫 | `canvas/ScriptCanvas.tsx`、`GuidedJourney.tsx` | 部分 | 套 token＋四態＋from-zero 5 步 a11y |
| S2 StageBar 非線性導航 | `StageBar.tsx`（done/current/todo/⚠N） | 部分 | 跳階驗證視覺＋鍵盤可及 |
| S3 多模態素材 | `canvas/AssetGenCanvas.tsx`（已用 `var(--text/--line/--muted)`） | ✅ 進行中 | 估算→生成→seed/provider 四態收尾＋PromptVault 自動存 |
| S4 初剪打包 | `canvas/RoughCutCanvas.tsx`（已用 `var(--gold-deep/--ok/--bad)`） | ✅ 大半 | zip_export 估算 50pt→MP4 的「新建 UI」 |
| S5 確認門 GateCard＋ShotCard | `ConfirmGate.tsx`（已 `import { GateCard as DkGateCard }`＋`computeGate/countGate` from `@/spine/gate`，掛 `ENABLE_AIDV_CHROME`）、`canvas/ShotDetailCanvas.tsx` | ✅ **已接真實 spine** | 旗標 ON 預設化＋過期重生視覺收尾 |
| S6 交付匯出 | `canvas/RoughCutCanvas.tsx`/showcase | 待補 | 成片卡＋解析度/格式＋下載＋分享展示牆 |

- **spine 已對齊**：`@/spine/gate`（`computeGate/countGate/GateReason`）、`ProjectSpineProvider`、`ShotVM/ShotLite` 已存在 → 卡述「僅需薄 adapter」屬實，**零新後端**。
- **旗標**：`ENABLE_4SHELL` ＞ `ENABLE_VIDEO_COCKPIT`（預設 ON）＞ `ENABLE_AIDV_CHROME`（視覺採用開關）；`VIDEO_SPINE_MOCK` 提供離線 mock 退路。
- **硬編色**：全 shell 僅 9 處 hex，集中在 `console/AmbientOrb.tsx`（cosmic 裝飾，**刻意非 design-kit**，呼應 AIDV-93 登入保留 cosmic）→ 不動。
- **不照舊圖**：S5 GateCard 已接真 spine，**別照 46 頁稿重畫**；重點放 S1/S2/S6 補齊與全頁四態/RWD/a11y。

## 步驟 3 — 設計規格（design，交給 Claude Design 出/補 UI）
- **範圍**：把 S1/S2/S6 補到 S4/S5 的標準；全六步統一掛 `ENABLE_AIDV_CHROME` design-kit 亮色暖光。
- **token**：一律語意 token（`var(--gold-deep/--gold-soft/--line/--ok/--bad/--text/--muted)`，源 `uiux/AIDV_design-tokens_TokensStudio.json`），**禁新增 hex**。
- **四態**：每步（尤其 S3 生成、S4 初剪、S6 匯出）載入/空/錯誤/正常皆有出口（共用 `_shared/PanelState`）。
- **RWD**：桌機三欄；`<lg` 單欄＋底部頁籤（沿用 AIDV-42）。
- **a11y（ui-ux-pro-max 補強，不覆蓋 design-kit）**：StageBar 階狀態「色彩非唯一資訊」＝保留文字標籤；對比 ≥4.5:1；icon-only 加 `aria-label`；命中 ≥44pt；尊重 `prefers-reduced-motion`。

## 步驟 4 — Adobe 視覺資產計畫（plan，未執行）
| 資產 | 用途 | Adobe 工具 | 存放 |
|---|---|---|---|
| StageBar 六階圖示（done/current/todo/⚠） | S2 導航 | `image_vectorize`（SVG，非 emoji）＋單色對齊 `--gold-deep` | Firefly board → repo `client/src/...assets` |
| 匯出成片「展示牆」背景 | S6 分享牆 | `image_apply_gaussian_blur`＋`image_apply_monochromatic_tint`（暖光、不搶前景） | Express → repo |
| 空狀態插畫（S1/S3/S6） | 四態「空」出口 | `adobe-batch-edit-photos` 統一風格＋色板鎖 design-kit | Firefly board → repo |
> 大圖走 repo asset/signed URL，**不 base64**（AIDV-15）。最終採用圖落 repo 並走 `ENABLE_AIDV_CHROME`。

## 步驟 5 — 交接提示詞（schedule，給「你的 Code」）

```
# 交接 — AIDV-95 U-5 /video 六步座艙視覺實裝（補 S1/S2/S6＋全頁四態/RWD/a11y）

## 北極星對位
推進 logline→成片 主座艙；S4/S5 已達標，本卡補齊其餘步到同標準。

## 範圍（一句話）
把 /video 六步座艙 S1/S2/S3/S6 統一掛 ENABLE_AIDV_CHROME design-kit，並補四態/RWD/a11y。

## 現況對齊（先讀）
- main：client/src/shells/video/* 骨架齊全；S5 ConfirmGate 已 import design-kit GateCard＋接 @/spine/gate；S3 AssetGenCanvas/S4 RoughCutCanvas 已用 var(--…) token。
- 不照舊圖：S5 別重畫；AmbientOrb 的 hex 是 cosmic 裝飾，不動。

## 必須重用（已查碼）
- spine：@/spine/gate（computeGate/countGate）、ProjectSpineProvider、ShotVM/ShotLite（薄 adapter，零新後端）
- 元件：@/components/design-kit（AidvKit、GateCard）、_shared/PanelState（四態）

## 視覺資產（步驟 4）
- StageBar 六階 SVG 圖示／S6 展示牆背景／S1·S3·S6 空狀態插畫 → repo client/src 對應 assets；token 鎖 design-kit。

## 旗標
- ENABLE_AIDV_CHROME：依線上開啟政策切「預設 ON＋退路」env VITE_ENABLE_AIDV_CHROME=0／runtime ?aidvchrome=0（**請 Bruce 確認預設 ON**）。

## 檔案（要改/新增）
- shells/video/canvas/ScriptCanvas.tsx、StageBar.tsx、canvas/AssetGenCanvas.tsx、S6 匯出（RoughCutCanvas/新 ExportCanvas）；共用 _shared/PanelState 串四態。

## 驗收（第三人可驗）
- [ ] 六步皆 design-kit token（無新 hex）；ShotCard/GateCard 接真 spine
- [ ] 每步四態皆有出口；桌機三欄／手機單欄＋底部頁籤
- [ ] a11y：StageBar 色彩非唯一資訊、對比 ≥4.5:1、icon aria-label
- [ ] 旗標 OFF 逐像素回舊版

## 驗證門（推送前全綠）
npx tsc --noEmit
npm run check:routes
npm run check:navigation
npx vitest run shells/video/ConfirmGate shells/video/StageBar shells/video/canvas/AssetGenCanvas

## 設計門狀態
自動通過 ✓（零新後端＝薄 adapter 接既有 spine/procedure；可回滾＝ENABLE_AIDV_CHROME＋VIDEO_SPINE_MOCK）；**唯一待確認**：ENABLE_AIDV_CHROME 是否切預設 ON（線上開啟政策）。

## 風險／避雷
- main baseline 13 failed（jsdom29+vitest2）＝既有，勿當新回歸。
- AmbientOrb hex 勿「順手」改成 token（cosmic 刻意保留）。

## 下一步（唯一）
進階 2 開發 ＝ 在分支 claude/<本批> 從 S2 StageBar 起補（最小、最多人看到）。
```

## 五道門裁決（本卡）
- 🚪 **設計門**：**自動通過 ✓**（零新後端＋可回滾）；唯一需 Bruce 一句確認：`ENABLE_AIDV_CHROME` 預設 ON？
- 驗證門／審查門／上線門／系統測試門：留待步驟 6 之後（本乾跑止於步驟 5）。

## 乾跑結論
技能在真實卡上**走得通且產出可直接動工的交接**：正確辨識「S5 已做、別重做」、定位真實檔與 spine、鎖 design-kit token、列出 Adobe 資產與旗標退路、收斂成單一下一步。**未寫 Jira／未開 PR／未部署。**
