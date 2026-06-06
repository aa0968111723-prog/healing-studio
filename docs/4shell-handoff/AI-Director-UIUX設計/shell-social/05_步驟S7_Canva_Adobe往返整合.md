# 05 · 步驟 S7 — 接入外部設計站：Canva / Adobe 往返整合

> 主場＝`/social/studio` 的「外部精修」往返；可選步驟，不擋主線。
> **Canva 與 Adobe 都有可用 MCP 連接器**（環境已偵測）。本檔定義**匯出/往返 UX**，並把每個動作標成**🔌 實作可接的整合點**（對回真實連接器工具名與簽章）。
> 設計原則：**往返不破壞血統**——送出去是「以現有資產為來源」，拉回來是「append 新版本＋記來源」；外部來的成品一律過**來源/授權確認**才能發佈。

---

## 1. 為什麼要外部往返（定位）

站內 `generate.*`＋`composeLayout` already 覆蓋多數需求。S7 是給**需要外部站特長**的場景：
- **Canva**：使用者習慣的拖拉編輯、海量範本、品牌範本（brand template）批量套版、團隊協作。
- **Adobe**：專業級**去背 / 生成式擴圖 / 向量化 / InDesign 印刷級版面 / Firefly 生成**。

S7 把這兩站當成**可往返的外掛工作台**：素材從本站送出 → 在外部站精修 → 成品拉回本站資產庫，續走 S8/S9。**本站永遠是真實來源（system of record），外部站是精修工具。**

---

## 2. 通用往返模式（Canva / Adobe 共用骨架）

```
本站資產(S4/S5/S6 產物)
   │ ① 推出：把資產暴露為「可公開取用的簽名 URL」
   ▼
外部站建立/上傳
   │   · Canva：import-design-from-url(url, name, type) → 取得 design_id（D…）
   │   · Adobe：asset_initialize_file_upload → asset_get_presigned_urls → asset_finalize_file_upload → 取得 assetUrl
   ▼
② 外部精修
   │   · Canva：使用者在 Canva 編輯器拖拉編修（本站顯示「在 Canva 編輯中」）
   │   · Adobe：多為 headless 呼叫（去背/擴圖/向量化/InDesign 匯出），回 outputUrl；Firefly board 則開外部
   ▼
③ 拉回：把外部成品 fetch 回 digital_asset_library（append 新資產）
   │   · Canva：get-export-formats → export-design → download URL → 入庫
   │   · Adobe：outputUrl / presignedAssetUrl → 入庫
   ▼
④ 來源/授權確認（HOLD）：標 sourceStudio:'canva'|'adobe'、確認使用權（assetSources[].source）→ 才可進 S9 發佈
```

> **🔑 推出的關鍵限制**：Canva `import-design-from-url` **只接公開 HTTPS URL，吃不到本機路徑**。因此「推出」必須先把本站資產產生一個**簽名公開 URL**（`digital_asset_library` 需提供 `getSignedUrl`）。這是 S7 的**第一個整合點**，實作須先備妥。

---

## 3. 畫面結構與佈局（`/social/studio` · 外部精修面板）

選一張資產 → 「外部精修」→ 出現往返面板（lane 分 Canva / Adobe）：

```
┌──────────── /social/studio · 外部精修 ────────────────────────────────┐
│ 來源資產：{縮圖} 春季講座主視覺-v3                                       │
│ ┌─ Canva lane ─────────────────┬─ Adobe lane ─────────────────────────┐ │
│ │ 在 Canva 精修／套品牌範本      │ 快速操作（站內回拉，不離開）：         │ │
│ │ [送進 Canva 編輯]             │ [去背] [生成式擴圖] [向量化]          │ │
│ │ [用品牌範本套版 ▾(BTM…)]      │ [InDesign 印刷版面→PDF]               │ │
│ │ ── 編輯中 ──                  │ [Firefly 生成板（開外部）]            │ │
│ │ design_id: Dxxxxxxxxx         │ 字體建議：font_recommend              │ │
│ │ ◷ 在 Canva 編輯中…            │ ── 處理中 ──                          │ │
│ │ [完成，拉回成品 ▾格式]        │ ◷ 去背處理中…（自動回拉）             │ │
│ └──────────────────────────────┴───────────────────────────────────────┘ │
│ 拉回後：[預覽] [存為新版本入庫] [來源確認：我有使用權]                    │
└────────────────────────────────────────────────────────────────────────┘
```

- **Canva lane**：偏「**離站編輯 → 完成拉回**」（使用者在 Canva 編輯器操作）。
- **Adobe lane**：偏「**站內呼叫 → 自動回拉**」（去背/擴圖/向量化/InDesign 匯出多為 headless，結果直接回庫）；少數（Firefly board）開外部。
- **狀態列**：顯示外部任務 id（Canva `design_id`、Adobe 任務）與進度；交 `BackgroundTasksContext` 背景輪詢。

---

## 4. 全狀態（空 / 載入 / 錯誤 / 長內容 / 權限）

| 狀態 | 內容 |
|---|---|
| **Empty** | 未選資產：「先選一張站內資產，再送去外部精修」。連接器未連：lane 顯示「尚未連接 Canva／Adobe · 連接後可往返」＋連接捷徑（不阻擋主線，可略過 S7）。 |
| **Loading** | 推出中「正在把素材送進 {Canva/Adobe}…」；編輯中「在 Canva 編輯中（完成後點拉回）」；Adobe headless「{去背/擴圖} 處理中…」。皆背景輪詢、換頁不中斷、完成 toast。 |
| **Error** | ① 連接失效/未授權：「{站} 連接已過期，重新連接」＋重試（不丟來源資產）。② 推出失敗（簽名 URL 取不到/檔過大）：原因＋重試。③ 外部處理失敗（Adobe API error/Canva export 失敗）：標 ❌＋原因＋重試；來源資產不動。④ 逾時：背景續跑，給「仍在處理，完成會通知」。 |
| **長內容** | 多頁 Canva 設計 → `export-design` 可指定 `pages[]`；InDesign 多頁 → `pageRange`；拉回多頁→多資產入庫（掛同一貼文）。 |
| **權限 / 來源** | 連接器 scope 不足（如 Canva `brandkit:read` 缺）→ 提示「重新連接以取得品牌庫權限」。**拉回成品一律過來源確認 HOLD**：標 `sourceStudio:'canva'|'adobe'`，未確認使用權不可發佈（可先入草稿）。 |

---

## 5. 進入＆離開條件
- **進入**：S6 合成後「外部精修」；或 S4/S5 任一資產「送去 Canva/Adobe」。
- **離開（前進）**：拉回成品「存為新版本入庫」→ 過來源確認 → 進 S8 核准 / S9 多尺寸。
- **離開（略過）**：S7 可選，直接從 S6 進 S8/S9。
- **可往返多次**：每次拉回都是 append 新版本，不覆寫；可比較內外版本。

---

## 6. 分支與決策

| 分支 | 條件 | 行為（對回連接器工具） |
|---|---|---|
| **a Canva 自由編輯** | 「送進 Canva 編輯」 | 推出簽名 URL → `import-design-from-url` → 拿 `design_id` → 使用者在 Canva 編 → `get-export-formats`→`export-design` 拉回 |
| **b Canva 品牌範本套版** | 「用品牌範本套版」 | `list-brand-kits`／`search-brand-templates` 選 `BTM…` → `create-design-from-brand-template` → 編 → 匯出拉回 |
| **c Canva 生成設計** | 想用 Canva AI 起稿 | `generate-design`／`generate-design-structured` → 拉回 |
| **d Canva 改尺寸** | 要 Canva 端 resize | `resize-design(design_id, preset|custom)` → 匯出（多尺寸主力仍是站內 S9 `exportSizes`，Canva resize 為輔） |
| **e Adobe 去背** | 「去背」 | `adobe_mandatory_init` → 上傳 → `image_remove_background(imageURI)` → 回透明 PNG 入庫 |
| **f Adobe 生成式擴圖** | 「生成式擴圖」 | `image_generative_expand`（換比例補畫面，跨比例不裁主體） |
| **g Adobe 向量化** | logo/圖示要向量 | `image_vectorize` → SVG 入庫 |
| **h Adobe 印刷版面** | 海報印刷級 | `document_render_layout(.indd/.idml → PDF, resolution 300)` |
| **i Adobe Firefly 生成板** | 外部生成探索 | `create_firefly_board`（開外部，成果再拉回） |
| **j 連接器未連** | lane 未連接 | 顯示連接捷徑；可略過 S7 |

---

## 7. 🔌 整合點對照表（實作可接 — 真實連接器工具名與簽章）

> 標 🔌＝實作代理直接接的整合點。Canva 連接器 server＝`mcp__9b23d016-…`；Adobe 連接器 server＝`mcp__47fb08e5-…`。**Adobe 任一工具前必先呼叫 `adobe_mandatory_init`。**

### 7.1 Canva 整合點

| UX 動作 | 🔌 連接器工具 | 關鍵參數 | 回傳 / 備註 |
|---|---|---|---|
| 推出本站素材 → 建 Canva 設計 | `import-design-from-url` | `url`(**公開 HTTPS**)、`name`、`intended_design_type`(poster/instagram_post/…) | 回 `design_id`(D…)。**吃不到本機路徑**，須先簽名 URL |
| 列品牌庫 | `list-brand-kits` | — | 回 brand kit ids（需 `brandkit:read` scope） |
| 找品牌範本 | `search-brand-templates` | query | 回 `BTM…` |
| 用品牌範本建設計 | `create-design-from-brand-template` | `brand_template_id`(BTM…)、`page_numbers?` | 回 `design_id` |
| AI 生成設計 | `generate-design` / `generate-design-structured` | prompt/結構 | 回 `design_id` |
| 改尺寸 | `resize-design` | `design_id`、`design_type`(preset/custom w×h) | 回新設計 |
| 查可匯出格式 | `get-export-formats` | `design_id` | 回支援格式（先查再匯） |
| 匯出拉回 | `export-design` | `design_id`、`format`{type:pdf/png/jpg/…、quality:`pro`、`pages[]`、w/h、`transparent_background`} | 回**download URL** → fetch 入庫 |
| 取設計內容/縮圖 | `get-design` / `get-design-content` / `get-design-thumbnail` | `design_id` | 預覽用 |

### 7.2 Adobe 整合點

| UX 動作 | 🔌 連接器工具 | 關鍵參數 | 回傳 / 備註 |
|---|---|---|---|
| **前置（必呼）** | `adobe_mandatory_init` | `skill_name?` | 回檔案處理規則與路由；**任一 Adobe 工具前必先呼叫** |
| 上傳本站素材 | `asset_initialize_file_upload`→`asset_get_presigned_urls`→`asset_finalize_file_upload` | 檔/URL | 取得可供後續工具用的 assetUrl |
| 去背（透明 PNG） | `image_remove_background` | `imageURI` | 回 cutout PNG（透明）。**注意**：這是 cutout 不是 mask，別餵給吃 mask 的工具 |
| 選主體（取 mask） | `image_select_subject` | `imageURI` | 要做「換底色/只調主體/只模糊背景」用這個取 mask（非去背） |
| 生成式擴圖 | `image_generative_expand` | `imageURI`、目標尺寸 | 跨比例補畫面（多尺寸換比例的精修選項） |
| 生成式填補 | `image_fill_area` | `imageURI`、區域 | 去雜物/補背景 |
| 向量化 | `image_vectorize` | `imageURI` | 回向量（logo/圖示） |
| 調色/濾鏡 | `image_adjust_*` / `image_apply_*` | `imageURI`、參數 | 亮度/對比/色溫/HSL/grain/halftone/glitch… |
| 套用預設 | `image_list_presets`→`image_apply_preset` | preset | — |
| 字體建議 | `font_recommend` | 內容/風格 | 配合品牌字體選型 |
| InDesign 印刷版面匯出 | `document_render_layout` | `documentSourceUrl`(.indd/.idml)、`outputMediaType`(pdf/jpeg/png)、`resolution`(300)、`pageRange` | 印刷級 PDF |
| PDF 轉換 | `document_convert_pdf` | source | — |
| 資料合併版面 | `document_merge_data_layout` / `_vector` | 資料＋版面 | 批量套版（如多講師同版面） |
| Firefly 生成板 | `create_firefly_board` | prompt | 開外部探索 |
| 庫存素材授權下載 | `asset_license_and_download_stock` | stock id | 授權素材（來源＝`licensed`） |

> **回拉血統**：所有拉回工具的 `outputUrl`/`presignedAssetUrl`/download URL，一律 fetch 進 `digital_asset_library`（新資產、`sourceStudio:'canva'|'adobe'`；授權素材另記 `assetSources[].source:'licensed'`）＋ `project_asset_links` 掛回貼文，append-only。

---

## 8. microcopy（zh-TW）
- 面板標題：`外部精修（Canva／Adobe）`／副：`送去外部站精修，成品自動拉回你的資產庫`
- Canva：`送進 Canva 編輯`／`用品牌範本套版`／`在 Canva 編輯中…`／`完成，拉回成品`／`選擇匯出格式 ▾`
- Adobe：`去背`／`生成式擴圖`／`向量化`／`InDesign 印刷版面 → PDF`／`Firefly 生成板（開新視窗）`／`字體建議`
- 推出/處理中：`正在把素材送進 {站}…`／`{操作} 處理中，完成會通知`
- 未連接：`尚未連接 {Canva／Adobe}`／`連接後即可往返精修`／`先略過，用站內工具`
- 連接失效：`{站} 連接已過期`／`重新連接`
- 拉回：`預覽`／`存為新版本入庫`
- 來源確認（HOLD）：`這張成品來自 {Canva／Adobe}`／`確認你有使用權？` → `我有使用權` / `先存草稿`
- 錯誤：`{站} 處理失敗：{reason}`／`重試`／`你的來源素材沒有變動`

---

## 9. route / procedure（本站側）
- 路由：`/social/studio`（外部精修面板）。
- 推出簽名 URL：`digital_asset_library` 的 `getSignedUrl`（**整合前置，須備妥**）。
- 觸發/輪詢/回拉：`social` router 包一層 façade（如 `social.sendToCanva` / `social.pullFromCanva` / `social.adobeEdit`），**內部呼叫上述連接器工具**；外部任務狀態交 `background_jobs` + `BackgroundTasksContext`。
- 入庫：`digital_asset_library`（`sourceStudio:'canva'|'adobe'`；授權素材 `assetSources[].source:'licensed'`）＋`project_asset_links`。
- 來源確認稽核：`social_posts.assetSources[]`／`orchestration_runs`。

> **標記**：本步驟所有外部呼叫都是**實作可接的整合點**，連接器與簽章如 §7。UI/UX 層先以 mock 往返（假 `design_id`、假 outputUrl）演完整旅程；翻旗標接真實連接器時 **UI 不改**。

---

## 銜接 S8
外部精修拉回、過來源確認後，所有版本（站內＋外部）進入 S8「**反覆修正**」：比較版本、核准定稿、或因品牌改版觸發重生——詳見 `06`。
