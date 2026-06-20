# 設計→視覺 管線（步驟 3–4）

> 步驟 3＝Claude Design 依規格出 UI 草案；步驟 4＝把產出的視覺資產存進 Adobe 並精修（hero／icon／插畫／背景）。
> **最高鐵則：design-kit 亮色暖光 tokens 是唯一真相**（黏土／珊瑚橘，AIDV-74／U-1）。任何工具產出與 design-kit 衝突 → 以 design-kit 為準。tokens＝`uiux/AIDV_design-tokens_TokensStudio.json`。

## 步驟 3 — Claude Design 出 UI

1. **先給規格**（來自步驟 1–2 的卡＋現況對齊），至少含：頁/元件名、對應 live 現況、design-kit token（色/字/間距/圓角/陰影）、四態（載入/空/錯誤/正常）、RWD 斷點（`<lg` 單欄＋底部頁籤、桌機 `lg:contents`）。
2. **產出 UI 草案**：HTML/React，**用語意 token 不硬編色**，SVG 圖示非 emoji。可用 `export_html_to_express` 把 HTML 帶進 Adobe Express 做版面精修，或走 Figma MCP（`/figma-generate-design`）對既有設計系統落元件。
3. **設計門自檢**（ui-ux-pro-max 交付前檢查，只補強不覆蓋 design-kit）：
   - 對比 ≥4.5:1；icon-only 有 `aria-label`；焦點環可見；色彩非唯一資訊。
   - 觸控命中 ≥44pt；按下回饋 ≤150ms；動效 150–300ms；尊重 `prefers-reduced-motion`。

## 步驟 4 — Adobe 存＋精修（依資產類型選工具）

> 用 Adobe 影像/設計工具（`image_*`、`document_*`、Firefly board、Express）或 `adobe-for-creativity` 外掛技能。存：建 Firefly board 或 Express 專案集中放；最終**採用的圖入 repo** 對應 `client/src/...` assets（走旗標、別 base64）。

| 資產 | 精修重點 | 建議工具 |
|---|---|---|
| **hero**（主視覺/banner） | 構圖、裁切到版位、生成式擴展補背景、色溫對齊暖光、加雜訊/顆粒質感 | `image_crop_and_resize`、`image_generative_expand`、`image_adjust_color_temperature`、`image_add_grain` |
| **icon**（圖示） | 去背、向量化（SVG，非 emoji）、單色/雙色對齊 token | `image_remove_background`、`image_vectorize` |
| **插畫**（illustration） | 風格一致、色板鎖 design-kit、必要時套 preset 統一 | `adobe-batch-edit-photos`、`image_apply_preset`、`image_apply_color_overlay` |
| **背景**（background） | 低對比不搶前景、模糊/漸層、暖光基底 | `image_apply_gaussian_blur`、`image_apply_monochromatic_tint`、`image_adjust_vibrance_and_saturation` |

## 資產驗收（過設計門前）
- [ ] 配色落在 design-kit token（沒有冒出非品牌色）。
- [ ] icon 是 SVG／可縮放，非點陣 emoji。
- [ ] hero/背景在淺色（與未來夜間模式 AIDV-53）都讀得清楚。
- [ ] 已存 Adobe（Firefly board/Express 連結記進卡），最終圖確定 repo 落點。
- [ ] 大圖走 signed URL/repo asset，**不 base64 塞 tRPC body**（AIDV-15）。

## 交接
精修完，把「資產連結＋repo 落點＋token 對照」寫進步驟 5 的交接提示詞「視覺資產」欄。
