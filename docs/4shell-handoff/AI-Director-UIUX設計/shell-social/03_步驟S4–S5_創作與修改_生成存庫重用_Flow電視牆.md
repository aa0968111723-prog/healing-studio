# 03 · 步驟 S4–S5 — 創作設計素材 / 素材修改（含「生成→存庫→重用」＋「Flow 電視牆」）

> 旅程中段「**把它做出來**」：成本集中在此。主場＝`/social/studio`（圖像台）。
> 跨工作流模式**生成→存庫→重用**與 **Flow 電視展示牆**接進本段（引用 `00_設計系統` §9 `PromptVault` ＋脊椎 `OrbAssistant`/`FlowWall` 共用元件，**不重造**）。
> 生成走**非同步 job 模型**（程式碼校正 `03`§9）：`generate.estimateCost → prepareJob/submitStudioJob → jobStatus/checkStudioJob → recordGenResult`；回退鏈（hf→gemini→fal）與血統錨在 **`generate.recordGenResult`**。

---

## S4 · 創作設計素材（站內 AI 生成 ／ 外部素材導入）

**目標**：產出這篇的主視覺/背景。兩條入口——**站內 AI 生成**（text→image）或**外部素材導入**（上傳/外部站）。產物即時入庫、可重用。

### S4.1 畫面結構與佈局（`/social/studio` 圖像台）

```
┌──────────────── /social/studio · 圖像台 ────────────────────────────┐
│ chips：類型：海報 · 品牌：療癒誌(草稿) · 主題：春季禪修講座           │
│ 分頁：[文字生成] [外部導入] [文字排版合成(S6)]                        │
│ ┌─ 左：輸入 ───────────────┬─ 中：結果 ─────────┬─ 右：庫 ────────┐ │
│ │ prompt（brief 帶入草稿）  │ 生成結果格          │ 生成→存庫→重用   │ │
│ │ [風格庫 combo：療癒暖光✓] │ ⬚✅ ⬚⏳ ⬚❌(重試)  │ 面板（本篇產物）  │ │
│ │ 比例：1:1 4:5 9:16 16:9   │ 逐圖徽章＋掃描動畫   │ ───────────────  │ │
│ │ 參考圖：{S3 已選素材}     │ [核准這張][再生成]  │ Flow 電視牆       │ │
│ │ seed：🔒1234567 / 🎲隨機  │                     │（直顯 seed+prompt│ │
│ │ provider：自動(hf→…)      │                     │ ·可一鍵延伸）     │ │
│ │ 積分徽章：~3 pts          │                     │                  │ │
│ │ [估算成本 → 生成]         │                     │                  │ │
│ └──────────────────────────┴────────────────────┴──────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

**輸入欄細節**：
- **prompt**：S2/S3 帶入草稿（主題＋風格 combo＋講師）；可改。
- **風格 combo**：S2 選的 `block_combos` chip 已勾選，影響 prompt；可換。
- **比例**：預設＝S1 類型的主要比例；可改（多尺寸在 S9 才展開，這裡先定主圖比例）。
- **參考圖**：S3 帶來的素材（作 image-edit 底圖時用，純 text2image 可無）。
- **seed**：🔒固定（跨圖一致）或 🎲隨機。**固定 seed 是品牌一致性與「可重現」的關鍵**，顯性可鎖。
- **provider**：預設自動（與 `/video` 同回退鏈 hf→gemini→fal）；進階可指定。
- **積分徽章＋估算鈕**：點「估算成本 → 生成」先過**成本確認門**（積分制：先扣後生成、失敗全額退還）。

### S4.2 全狀態

| 狀態 | 內容 |
|---|---|
| **Empty** | 結果格空：「描述你要的畫面，或從右側 Flow 牆延伸一張」；prompt 若空，給 brief 自動草稿一鍵填入。 |
| **Loading**（生成中） | 結果格出 N 個佔位卡＋**掃描掃光動畫**＋進度（mock 數秒 / real 輪詢 `jobStatus`）；交 `BackgroundTasksContext` 背景輪詢，換頁不中斷，完成 toast。`prefers-reduced-motion` 關掃光、留進度條。 |
| **Error**（回退鏈 UI） | 逐圖徽章 ✅成功／⏳進行／❌失敗；失敗卡顯示**回退鏈**（`hf ❌→gemini ⏳`）＋原因（timeout/429/quota/partial）＋重試。**整批不全毀**：成功的照留。mock 可 `?fail=timeout\|429\|partial` 注入演練。 |
| **長內容** | prompt 過長 → 先過 RAG 壓縮（§01§5.5）再送；多版結果（>4 張）→ 結果格分頁/虛擬滾動。 |
| **權限 / 成本** | 成本未確認不送（HOLD）；積分不足 → 確認門顯示「積分不足，需 {N} pts」＋「改用更省的模型」（積分制、不涉金錢），不靜默失敗；送出 toast「已扣 {N} pts」、失敗 toast「已全額退還 {N} pts」；非擁有者唯讀不可生成。 |

### S4.3 進入＆離開條件
- **進入**：S3「帶去創作」；或 `Ctrl+K` 跳關直達；或 Flow 牆「延伸」一張。
- **離開（前進）**：對任一結果按「**核准這張**」→ Post-Asset `generated`（核准在 S8 才升 `approved`，這裡先生成）→ 可進 S5 修改、S6 合成、或 S9 多尺寸。
- **離開（外部導入分頁）**：見 S4.5。
- **後退**：回 cockpit 改 brief/素材。

### S4.4 分支與決策

| 分支 | 條件 | 行為 |
|---|---|---|
| **a 純文字生成** | 無參考圖 | `generate.*` text2image（底層 `imageStudio.<model>`）；空景/背景用 |
| **b 參考圖轉繪** | 有 S3 素材 | image2image（套品牌色/換背景/置入講師）→ 實際在 S5，但 S4 可先轉繪打底 |
| **c 多版生成** | 一次要多張比較 | 提交 batch；結果格多卡逐圖徽章；擇一核准 |
| **d 從 Flow 牆延伸** | 點 Flow 牆某卡「延伸」 | 帶入該卡 **seed＋prompt** 預填輸入欄（見 §Flow 牆）；微調再生成 |
| **e 外部導入** | 切「外部導入」分頁 | 上傳/外部站素材直接入庫，不走生成（見 S4.5） |
| **f 成本超預算** | 估算 > 預算 | 確認門「超預算，仍要生成？」＋成本階梯建議（降模型/降張數） |

### S4.5 外部素材導入（分頁）
- **上傳**：拖放→**來源確認 HOLD**→入 `digital_asset_library`（`sourceStudio:'upload'`；授權證據 `assetSources[].source:'uploaded'`）。
- **外部設計站導回**：從 Canva/Adobe 往返回來的成品也在此入庫（詳 `05`）。
- 導入素材同樣進「生成→存庫→重用」面板，可作後續合成元件。

### S4.6 microcopy
- 分頁：`文字生成`／`外部導入`／`文字排版合成`
- prompt placeholder：`描述你要的畫面，例如：暖色晨光中的禪修者剪影，留白給標題`
- seed：`固定 seed（跨圖一致）` / `隨機` ／ tooltip：`固定 seed 能讓系列圖風格一致、可重現`
- 成本（積分制）：`估算成本`／`預估 {N} pts，確認生成？`／`已扣 {N} pts`／`已全額退還 {N} pts`／`積分不足，需 {N} pts`／`改用更省的模型`
- 結果：`核准這張`／`再生成`／`從這張延伸`
- 回退鏈失敗：`{provider} 生成失敗（{reason}），已自動改用 {next}…`／`重試這張`
- 外部導入：`上傳素材`／`從 Canva／Adobe 導回的成品也會出現在這裡`

### S4.7 route / procedure
- 路由：`/social/studio`。
- 生成（**校正**：非 `imageStudio.generate`）：`generate.estimateCost` → `generate.prepareJob` / `generate.submitStudioJob` → `generate.jobStatus` / `generate.checkStudioJob` → **`generate.recordGenResult`**（回退鏈與 `asset_generation_events` 血統錨點）。底層 `imageStudio.<model>`（28 逐模型）。
- 入庫：產物寫 `digital_asset_library`（`sourceStudio:'social'`、`provider`、`seed`、`ratioPreset`）＋ `generation_history`（prompt/combo/provider，可回溯）。
- 委派 façade：`social.generateVisual`。

---

## ★ 跨工作流模式一：生成→存庫→重用（接 S4／S5）

> 元件＝**設計系統 §9 `PromptVault`**＝`SaveToVault`（存）＋`VaultBrowser`（瀏覽）＋`PromptCard`（卡）。`/social` **引用**它，class `.vault-*`、色票/版式/動效全繼承設計系統，**不重定義**。本節只定義它在 `/social` S4/S5 的**接法與行為**。Bruce 鐵則：**提示詞庫／資料庫真實記錄、非 mock**——持久化錨在真實 procedure（設計系統 §9.4 已 GitNexus 校驗）。

**意圖**：每一張被生成或導入的素材，連同它的 prompt＋參數**即時存進提示詞庫成可重用 entry**，避免重做、保留血統、跨步跨篇重用。

**行為規格**（對映設計系統 §9.1–§9.3）：
1. **存入（`SaveToVault`）**：生成結果旁出「**存入提示詞庫**」鈕＋「⚙ 自動存草稿」`Toggle`（開＝每次成功生成自動存 `draft`）。一筆 entry 記 `prompt 全文 / params(model·seed·size·provider·cfg) / assetId / tags / sourceWorkflow:'social' / projectId`。狀態：存檔中→成功（toast「已存入提示詞庫 · 可重複使用」）→失敗（重試）→重複（偵測同 prompt+params：`uses+1`，不重建）。
2. **生成即回寫**：`generate.recordGenResult` 回寫 asset（含 provider/seed/cost），與 vault entry 的 `assetId` 關聯。
3. **瀏覽重用（`VaultBrowser`＋`PromptCard`）**：素材步驟工具列「📚 提示詞庫」開抽屜（`SubTabs`：我的詞庫／團隊共享／block 組合）；`PromptCard` 網格＝縮圖＋prompt 摘要＋標籤＋`×{uses}`＋模型/seed mono 標；可關鍵字/模型/比例/標籤/來源/專案篩選。
4. **三動作**：**再生成**（套舊 prompt＋參數→仍先 `generate.estimateCost` 估成本→`generate.submitStudioJob`）／**插入素材**（直接帶既有 asset，不重生不扣點）／**複製並編輯 fork**（複製 prompt 進輸入框→存檔 `promptLibrary.create` 為新 entry，記 `forkedFrom`）。
5. **一鍵去向**（`/social` 加掛）：`重用為底圖`（→S5）、`加入合成`（→S6）、`送多尺寸`（→S9）、`設為主視覺`。
6. **無孤兒**：重用＝新 `project_asset_links`（P4 前用 `digital_asset_library.projectId`），不複製檔、不覆寫（append-only）。

**狀態**（§9.3）：空（`EmptyState`「還沒有存過提示詞 · 生成後按『存入提示詞庫』」）／載入（`Skeleton` 卡）／錯誤（`ErrorState` 重試）／長內容（網格虛擬滾動＋範圍篩選）。

**route/procedure（真實，§9.4 校驗）**：存入＝**`promptLibrary.create`**（`prompt_library`，prompt+params+assetId）；我的詞庫＝`promptCollection.*`；風格組合＝`blockCombos.create`/`customBlocks.create`；產出回寫＝**`generate.recordGenResult`**（`digital_asset_library`）；瀏覽/搜尋＝`assets.*`／`notesCurator.searchAssets`／`notesCurator.tagAssets`·`categorizeAsset`；再生成＝`generate.estimateCost→submitStudioJob→jobStatus→recordGenResult`。委派 façade `social.generateVisual`。

---

## ★ 跨工作流模式二：Flow 電視展示牆（接 S4／S5）

> 元件＝**設計系統 §9 `VaultBrowser`＋`PromptCard`（showcase 範圍）的 `/social` 展示皮**——不是新元件，是把提示詞庫卡牆做成「會放映的電視牆」皮（直顯 seed＋prompt、可一鍵延伸、可自動輪播）。`/social` **引用**底層 `PromptCard`／`VaultBrowser`，**不重造、不改色票**。本節定義它在 `/social` 的接法。

**意圖**：把「精選作品／本專案產物／官方範本」當成一面**會放映的牆**——**直接顯示 seed＋prompt，且可一鍵延伸運用**，讓使用者從既有成果出發，而非每次從零。

### 畫面與行為
```
┌ Flow 電視牆（右欄下半 / 全螢幕可放映）──────────────────┐
│ ▣ 範圍：[本專案][精選 showcase][官方範本]  ◷ 自動輪播 ⏯  │
│ ┌───────────┐ ┌───────────┐ ┌───────────┐               │
│ │ [縮圖]    │ │ [縮圖]    │ │ [縮圖]    │   ←掃光輪播      │
│ │ seed:1234 │ │ seed:5678 │ │ seed:9012 │                 │
│ │ prompt:暖 │ │ prompt:極 │ │ prompt:禪 │                 │
│ │ 光禪修…   │ │ 簡留白…   │ │ 意水墨…   │                 │
│ │ [延伸][套] │ │ [延伸][套] │ │ [延伸][套] │                 │
│ └───────────┘ └───────────┘ └───────────┘               │
└─────────────────────────────────────────────────────────┘
```
- **直顯 seed＋prompt**：每張卡正面就顯示 `seed` 與 `prompt` 摘要（mono 字體，`--f-mono`），不必點開。
- **一鍵延伸（核心）**：`延伸` → 把該卡 **seed＋prompt 帶進 S4 輸入欄**（預填），使用者微調即生成同源變體（固定 seed 保一致）。
- **一鍵套用**：`套` → 直接把該卡風格 combo＋版面範本套到本篇（不重生，作為起點）。
- **放映模式**：可全螢幕自動輪播（電視展示感），`prefers-reduced-motion` 關輪播改手動翻頁。
- **可 fork**：`精選 showcase` 範圍的公開項可 fork 為自己一份（記來源），對映設計 §10.3。

### 狀態
- **空**：本專案範圍無產物→「先生成一張，之後就能在這裡延伸」；showcase 範圍無資料→「精選牆還沒有作品」。
- **載入**：卡 skeleton；放映啟動前等首批縮圖。
- **錯誤**：縮圖載入失敗單卡降級為佔位＋重試；輪播不中斷。
- **長內容**：卡多→虛擬滾動＋範圍篩選；prompt 超長→卡面截斷＋hover/點開全文。
- **權限**：精選/官方範本唯讀可延伸；他人作品 fork 需符合公開授權。

### 與光球助手（OrbAssistant）整合（實站對齊）
實站右下角常駐**光球助手浮球**，面板有 6 情境分頁（本頁／**提示詞**／對話／專注流／積分／筆記），且**會主動跳泡泡**（精靈「守守」實見提醒「提示詞庫沒用到」）。`/social` 的提示詞庫與 Flow 牆**與光球助手同源整合**：
- **面板「提示詞」分頁＝`VaultBrowser`**（同一提示詞庫，浮球開即見），Flow 牆是其 showcase 範圍的展示皮。
- **主動泡泡 ProactiveBubble**：S4 生成成功但未存庫 → 守守冒泡「`你這次的提示詞還沒存進提示詞庫，要存起來重用嗎？→ 存入`」（觸發碼 `prompt_too_short`/`feature_not_used` 類）。`/social` 接這條 nudge 導到 `SaveToVault`。
- 元件＝設計系統脊椎層 `OrbAssistant`＋`FlowWall`（四殼共用，亮色玻璃化）。`/social` **引用不重造**。

### route/procedure（實站對齊）
- 本專案/全部範圍：`assets.list`＋**依提示詞搜尋**（實站 /assets 已可依 prompt 搜尋，prompt↔asset 已關聯）＋`notesCurator.searchAssets`。
- 精選 showcase：`showcase.*`（**注意** `showcase.templates` 待建，範本牆 UI 為新建；`featured_showcase` 表在、UI 待建）。
- 延伸：把 `PromptCard` 的 seed/prompt 灌回 S4 → `generate.estimateCost→submitStudioJob`（固定 seed）。
- fork：`promptLibrary.create`（記 `forkedFrom`）／`showcase` fork（複製為自有產物＋記來源）。

> **與設計系統的關係**：`PromptVault`（§9）＋`OrbAssistant`/`FlowWall` 是設計系統脊椎層共用元件，`/video` 與 `/social` 共用同一實例。`/social` 只負責「把本 shell 的 prompt/seed/showcase 資料餵進去、把延伸與『存入』動作接回 `generate.*`／`promptLibrary.create`」。**不得在 `/social` 改其視覺或另立色票。**

---

## S5 · 素材修改（image-edit 轉繪 ／ 微調 ／ 重生）

**目標**：對 S4 產出或導入的素材做品牌化與精修——套品牌色、換背景、去背、置入 logo/講師、局部重繪。**這是品牌一致性的主力。**

### S5.1 畫面結構與佈局（`/social/studio` · 編輯模式）

選一張素材進入編輯模式，左欄變編輯工具，中欄是畫布＋前後對照：

```
┌ 左：編輯工具 ──────────┬─ 中：畫布（前/後對照）─┬─ 右：庫＋Flow 牆 ─┐
│ 來源圖：{選定素材}      │  [原圖] ⇄ [編輯後]      │ 生成→存庫→重用    │
│ 操作：                 │  局部重繪：框選區域     │ （新版本入庫）    │
│ · 套品牌色             │  進度/掃描               │ Flow 牆延伸       │
│ · 換背景（prompt）     │                         │                  │
│ · 去背（cutout）       │  [核准][再修][還原]     │                  │
│ · 置入 logo/講師       │                         │                  │
│ · 局部重繪（遮罩+prompt│                         │                  │
│ seed：🔒 / provider     │                         │                  │
│ 積分徽章：~2 pts        │                         │                  │
│ [估算 → 套用]          │                         │                  │
└────────────────────────┴────────────────────────┴──────────────────┘
```

### S5.2 全狀態

| 狀態 | 內容 |
|---|---|
| **Empty** | 未選來源圖：「從右側挑一張素材開始修改」。 |
| **Loading** | 畫布掃描動畫＋進度（image2image 輪詢）；背景輪詢不中斷。 |
| **Error** | 回退鏈 UI（同 S4）；局部重繪遮罩無效 → 提示「請框選要重畫的區域」。 |
| **長內容** | 多次編輯產生多版本 → 版本帶（append-only，可比較/回退任一版）。 |
| **權限 / 成本 / 來源** | 再生成過成本門；編輯**上傳/外部**素材前過來源確認；非擁有者唯讀。 |

### S5.3 進入＆離開條件
- **進入**：S4 結果「重用為底圖」、生成→存庫面板「重用」、或外部導入素材選「修改」。
- **離開（前進）**：「核准」→ 新版本入庫（不覆寫舊版）→ 進 S6 合成或 S9 多尺寸。
- **後退/還原**：「還原」回上一版；版本帶可跳任一版。

### S5.4 分支與決策

| 分支 | 條件 | 行為 |
|---|---|---|
| **a 套品牌色** | 有品牌色票 | image-edit 把畫面調到品牌色（Gemini 感知比對一致性） |
| **b 換背景** | prompt 描述新背景 | 主體保留、背景重生（去背→合成新底） |
| **c 去背** | 要透明素材 | cutout 透明 PNG（可作合成元件，→S6） |
| **d 置入 logo/講師** | 品牌 logo / 講師照 | 疊上（精準位置建議在 S6 合成做，這裡先粗放） |
| **e 局部重繪** | 框選＋prompt | 只重畫遮罩區（修手/換字牌/去雜物） |
| **f 偏離品牌** | Gemini 比對分數低 | 標 `off_brand`＋建議調整（不強制，記旗標） |

### S5.5 microcopy
- 操作：`套品牌色`／`換背景`／`去背（透明）`／`置入 logo・講師`／`局部重繪`
- 局部重繪提示：`框選要重畫的區域，再描述想要的內容`
- 動作：`估算 → 套用`／`核准`／`再修一次`／`還原上一版`
- 版本帶：`版本 {n}`／`比較`／`回到這版`
- 偏離品牌：`這張和品牌色有點距離，建議：{suggestion}`（可忽略）

### S5.6 route / procedure
- 路由：`/social/studio`（編輯模式）。
- 編輯：`generate.*` image2image（底層 `imageStudio.<edit-model>`，如 `seedreamV45Edit`/`fluxKontext`/`nanoBananaEdit`）；血統錨 `generate.recordGenResult`。
- 去背：可走站內 image-edit，或 **Adobe MCP `image_remove_background`**（往返，見 `05`）。
- 一致性比對：Gemini 感知 client（與生成 client 分開，架構方案 B）。
- 版本入庫：新 `digital_asset_library` 資產＋`project_asset_links`，append-only。

---

## 銜接 S6

S5 把素材修到品牌化、可用之後，進入 S6「**圖層拼接合成**」——把背景、講師、logo、標題/內文/CTA **分層精準排版**疊成最終單張。文字層走確定性渲染（`composeLayout`），不交擴散模型——詳見 `04`。
