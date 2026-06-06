# 02 · `/social` 系統設計 Digest（社群／海報／圖文創作系統）

> 來源：`AI-Director_社群圖文系統設計.md`（v1，撰寫日 2026-06-05，read-only greenfield design）
> 性質：把架構 rev.2 §2② 標為「🅿 待建（0 專屬實作）」的社群系統做成可動工設計。**未改任何程式碼。**
> 事實基準：`healing-studio_真實repo盤點.md`（main HEAD `2888a362`，2026-06-04）
> 設計鐵律：延伸架構不牴觸；既有功能一個都不丟；**重用優先、最小新增、加法不破壞（strangler-fig）**；脊椎元件單一實例、四 shell 共用、絕不複製。

---

## 1. 一句話定位

`/social` ＝平台的**第二條創作線**：不是長片管線，而是「快速產一張對外圖文，鎖住品牌，一次匯出多平台尺寸，排程發佈」的**輕量線**。

它**不造新引擎**——把 `/video` 已建的 **cockpit 元件庫 + imageStudio + showcase + 提示詞積木 + news/sense**，在 `/social` 這個**獨立 shell**（不嵌入其他 shell）裡**另實例化**一次。唯一真正新增的語意是：**品牌身份（brand kit）＋社群貼文（post）＋內容行事曆＋發佈通道**。

跨 shell 只透過**脊椎**讀寫（架構 §1.5.4），介面**不互嵌**。

**核心一句話**：在獨立 shell 裡，用 `/video` 同一條脊椎與接縫，把「品牌一致的對外圖文」從 brief 一路帶到多尺寸發佈——重用到極致、只新增「文字排版合成＋多尺寸匯出＋發佈通道」三塊，零新表可上線、需要時再加 `brand_kits`/`social_posts` 兩張小表升級。

---

## 2. 完整螢幕／流程（template → brand lock → generate → multi-size → publish + 行事曆）

### 2.1 一行流程圖

```
brief/意圖 ─▶ 套品牌+風格 ─▶ AI 文案+排版 ─▶ 出圖/合成 ─▶ 多尺寸匯出 ─▶ 排程/發佈
    │            │              │             │            │           │
 Commander   brand_kit/     Claude 文案    Generation  匯出預設    Posting
 .plan()     block_combos   (OpenRouter)   Provider    (1:1/9:16/  Provider
             consistency    +Sonar 選題    {mock|hf|   海報A/...)  {mock|
             _vault(鎖)     (讀 news)       gemini|fal}            postiz}
```

### 2.2 引導式七步旅程（intent → brand → content → generate → export → post → 回看/重生）

對齊開發計畫 §8「意圖式進站＋引導式拆解」。**每一步先出建議、標成本、等確認，不靜默跑完；全程可在 P0–P2 mock 下演完。**

| 步 | 動作 | 委派/呼叫 | 備註 |
|---|---|---|---|
| **[0]** | 進站意圖「想做社群海報/貼文」 | 意圖玄關（§8.1）路由到 `/social`，帶 active project；`Commander.createIntent(mode:'create', projectId)` | — |
| **[1]** | 選/套品牌 + 選一個 `block_combos` 風格模板 | `social.getBrandKit` / `blockCombos.list`（讀脊椎，零生成） | 品牌未鎖 → 引導去鎖（§2.2）；可先用草稿品牌 |
| **[2]** | 內容（文案＋選題）：貼 brief 或一句話；蹭熱點則叫 Sonar 讀 news/sense | Claude 出標題/內文/hashtag/CTA（多版可選）；Sonar 回帶引用選題 | 先出文案草稿 → 你改/挑 → 確認 |
| **[3]** | 生成/合成視覺：text→image 出背景；image-edit 套品牌色/換背景；text-layout 疊字 | `GenerationProvider`（mock\|hf\|gemini\|fal）→ 回掛 `assetId` 的 job（先估成本再確認） | 單張核准＝確認門等價物（§4.3） |
| **[4]** | 多尺寸匯出：選平台預設 → 主圖重構成各尺寸變體 | `social.exportSizes(presetIds[])` → 每尺寸一份資產，掛回 `social_post` | — |
| **[5]** | 排程/發佈：排進內容行事曆，到點由 PostingProvider 發佈（現為 mock） | `social.schedulePost` → `orb_scheduled_jobs` →（mock 標 posted / 之後 Postiz） | — |
| **[6]** | 回看/重生：品牌或文案改版 → 既有貼文標 `stale`（§2.4）→ 選擇性重生/重匯出 | — | — |

**UX 設計要點（流程層）**：
- **可回頭、可分歧**：任一步都能改上一步（改品牌→下游貼文標 `stale`），不是線性死路。
- **熟手可跳關**：`Ctrl+K` cmdk 直達 `/social/studio` 直接出圖；意圖玄關只服務新手與猶豫者。
- **mock 全程可演**：P2 用 `MockGenerationAdapter` 出佔位圖、`MockCommander` 出罐頭文案、`MockPosting` 標假 permalink——整條旅程**零金鑰可 demo**。
- **無孤兒**：每張產物 `linkAssetToProject` 回寫 `creative_projects` timeline。

### 2.3 五種產物（系統做什麼）

| 產物 | 說明 | 主要尺寸 | 生成原語 |
|---|---|---|---|
| **社群貼文圖** | IG/FB/Threads/X 單張或輪播配圖 | 1:1、4:5、16:9 | text→image ＋ text-layout |
| **海報** | 活動/宣傳海報，含標題與資訊層 | A4/A3/A2（300dpi）、直幅 | text→image（背景）＋ text-layout（文字層） |
| **圖文卡** | 知識卡、語錄卡、懶人包多頁卡 | 1:1、4:5、多頁 carousel | 模板合成為主、生成為輔 |
| **限動（Story/Reels 封面）** | 全螢幕直式短內容 | 9:16 | text→image ＋ text-layout |
| **多平台尺寸包** | 同一主視覺一次輸出全平台 | 見 §6 預設集 | 主圖 → 重構圖（re-frame/re-layout） |

**與 `/video` 的分界**：`/social` 是**輕量、單張核准**線；**沒有**世界觀／腳本／分鏡／鏡號 `S0X`／i2v 長片管線。「鎖定」對象是**品牌**而非角色；「核准」對象是**單張對外圖文**而非關鍵影格。要 `/video` 的素材（如某支片的角色圖）時，**只透過脊椎讀 `digital_asset_library`**，不開 `/video` UI。

---

## 3. 螢幕清單、路由地圖、每個面板/分頁

### 3.1 `/social` shell 路由地圖（4 條 canonical 路由，對齊架構 §3）

頂部共用脊椎 chrome（active-project 切換器、全域搜尋/代理）。架構 §3 已列 4 條 canonical 路由；本設計把「行事曆」收為 `publish` 的一個**分頁**（不新增頂層路由）。

| 路由 | 名稱 | 內容 |
|---|---|---|
| `/social` | **cockpit** | 重用 `/video` 三欄殼：**左**=專案+品牌面板／**中**=brief+文案+生成主控／**右**=資產庫+風格庫 |
| `/social/studio` | **圖像台** | `imageStudio` 共用：text2image / image-edit / 比例選擇 / text-layout 合成 |
| `/social/brand` | **品牌/風格庫** | `brand_kits` 管理＋鎖定閘門｜`block_combos` 風格模板 |
| `/social/publish` | **發佈/精選** | 多尺寸匯出 → 內容行事曆〔分頁〕→ 排程/發佈 showcase |

> **時事選題**＝cockpit 內一個面板，經脊椎讀 news/sense；**不開 `/learn` 頁**（§1.5.4）。

**cockpit 重用方式（關鍵）**：`/social` 的三欄 cockpit 是把 `/video` 的 `components/create/*` 元件庫（`ActiveProjectContextPanel`、`IntentComposer`…）**另實例化**，**不是 `/create` 加 mode toggle**（架構 §2②.1、開發計畫 P5 明令）。`/social` 專屬差異元件放 **`client/src/components/social/*`**（品牌面板、尺寸匯出、行事曆）。

### 3.2 螢幕 × 狀態矩陣（empty / loading / error / success）

| 螢幕 | 主要任務 | Empty | Loading | Error | Success |
|---|---|---|---|---|---|
| `/social`（cockpit） | 開始一篇 | 「選平台、貼 brief」CTA＋上次未完成貼文 | 脊椎 chrome 先渲染；中欄 skeleton | 操作級 error boundary＋重試 toast；不白屏 | 出文案草稿＋視覺草稿，可進下一步 |
| `/social/brand` | 建/鎖品牌 | 「建立第一個品牌」CTA | 品牌卡 skeleton | 缺 logo/色/字 → 行內欄位提示（**非報錯**） | 品牌 `locked` 徽章；可被貼文套用 |
| `/social/studio` | 出圖/合成 | 「描述你要的畫面」＋比例選擇 | 生成中進度條（mock 數秒/real 輪詢） | 失敗注入回退鏈＋逐圖徽章（✅/❌/⏳）＋重試 | 圖回掛 `assetId`、可送多尺寸 |
| `/social/publish` | 匯出/排程/發佈 | 「還沒有可發佈的貼文」 | 匯出/發佈任務 skeleton | 平台拒件/限流 → 原因＋建議；草稿不失 | 多尺寸包就緒；行事曆有排程；showcase 出現 |
| 內容行事曆（publish 分頁） | 排內容 | 「本月還沒排內容」 | 月視圖 skeleton | 排程衝突提示 | 貼文落在日期格，到點自動發 |

### 3.3 全域 UX（沿用開發計畫 §3.7）

- **窄螢幕優先（社群多手機）**：窄螢幕三欄收 tabs、dock 變底部列、確認門 modal 全螢幕。
- **zh-TW 字串外部化**；鍵盤導覽（`Ctrl+K`、`G` 系列）。
- **對比達 WCAG AA**；尊重 `prefers-reduced-motion`。
- 受保護路由未登入 → 導登入並**保留 return URL＋暫存草稿**。

---

## 4. 品牌鎖定 / 一致性（Brand-Lock）= `/social` 的「角色鎖定」孿生

`/video` 用 `consistency_vault` 把**角色**鎖成定版（角色未 `locked` 不進分鏡）。`/social` 把同一機制套到**品牌**：**品牌未鎖，不進批量出圖與發佈**。兩條創作線**共用同一品管脊椎**（架構 §8.5：確認門是唯一品管脊椎）。

### 4.1 BrandKit 結構（每專案一份，跨產物重用，綁在 `creative_projects` 下）

```
BrandKit
├─ logo            主標/副標/去背/深淺底 各一 → 指向 digital_asset_library 資產
├─ palette         主色/輔色/強調/中性（hex + 角色標籤）
├─ typography      標題字/內文字（字體家族、字重、行距、大小階）
├─ voice & tone    口吻（如「溫暖療癒/專業/俏皮」）、用詞偏好、禁用詞、emoji 政策
├─ layout rules    安全邊距、logo 最小尺寸與保留區、對齊網格
└─ lockState       draft → defined → locked（＋version）  ← 鎖定狀態
```

> **與 voice 串接**：`voice & tone` 不只擺著看——它在 §5.1 餵給 Claude 當文案的 **system 約束**，讓「文案口吻」與「視覺品牌」鎖同一份。

### 4.2 鎖定狀態機（對映角色鎖定，開發計畫 §3.1）

| 實體 | 狀態軌 | 缺漏旗標 | 進入下一步的硬條件 |
|---|---|---|---|
| **品牌 BrandKit** | `draft → defined → locked` | `missing_logo`、`missing_palette`、`missing_font`、`low_contrast`（對比未達 AA）、`superseded`（版本被取代） | **品牌 `locked` 才能進批量出圖/匯出/發佈** |
| **單張產物 Post-Asset** | `pending → generated → approved \| rejected` | `off_brand`（偏離品牌）、`unlicensed_source`（素材來源未確認）、`low_contrast` | **`approved` 才能匯出多尺寸/排程發佈** |

### 4.3 品牌閘門決策矩陣（這張圖能不能往下發？）

| 情況 | 判定 | 行為 |
|---|---|---|
| 品牌未 `locked` | **BLOCK** | 批量/發佈鈕 disabled；給「去鎖定品牌」捷徑（**單張試做可放行**） |
| 對比未達 AA | **WARN（可覆寫）** | 標 `low_contrast`，建議調色；可打字確認覆寫（記 reason） |
| 素材來源未確認 | **HOLD** | 跳「此圖含上傳素材，確認你有使用權？」未確認不發佈 |
| 成本未確認 | **HOLD** | 「預估 $X，確認生成？」未確認不送生成（成本階梯） |
| 品牌已鎖卻要改 | **UNLOCK 流程** | 解鎖 modal 顯示「將影響 N 篇既有貼文」→ 解鎖後 `version++`、下游標 `stale` |

> **核准語意 mock=real 一致**：P2 mock 期「approved」的判定，切真實後原樣搬到 `consistency_vault` / `brand_kits.lockState`，**不可判定翻盤**。

### 4.4 consistency_vault 行為（重要界線）

無論 Tier-0/1，**鎖定的「閘門狀態」一律可落 `consistency_vault`**（兩條創作線共用品管脊椎，不另造平行閘門）；差別只在「品牌身份欄位」存 JSON（Tier-0）還是存結構表（Tier-1）。Tier-1 的 `brand_kits.lockState` 語意同 vault，**亦可雙寫 vault**。

### 4.5 品牌改版 → 既有貼文 stale → 重生（對映開發計畫 §3.3）

- 品牌 `locked` 要改 → 走解鎖 → `brand_kits.version++` → 所有引用該品牌的 `social_posts`／產物**自動標 `stale`**（透過 `project_asset_links` / `social_posts.brandKitVersion` 反查）。
- cockpit 顯示「受影響 N 篇」，給**三選項**：**全部重生 / 選擇性重生 / 保留舊版**（`pinned_to_v{n}`，接受分歧、不再視為過期）。
- **append-only 血統**：重生不覆寫舊圖，一律新資產＋新 link，`generation_history` 記「對哪個品牌 version 生的」。
- **mock 一致性**：mock DataStore 也實作 `version`/`stale`，讓「改品牌→既有貼文變灰提示重生」在 P2 零金鑰即可驗。

---

## 5. 生成流程（Generation Flow）

### 5.1 三種生成原語（皆走同一 `GenerationProvider` 接縫，只是呼叫不同 method）

| 原語 | 做什麼 | 接縫 method | 模型（real） | 備註 |
|---|---|---|---|---|
| **text→image** | 由文字描述生主視覺/背景 | `text2image(T2IReq)` | Z-Image-Turbo / FLUX（與 `/video` keyframe 同棧） | provider 可選；回掛 `assetId` |
| **image-edit（轉繪）** | 套品牌色、換背景、去背、塞 logo、局部重繪 | `image2image(I2IReq)` | Qwen-Image-Edit / Nano Banana（Gemini 多模態） | **品牌一致性的主力** |
| **text-layout 合成** | 把標題/內文/CTA/logo **精準排版**到視覺上 | `composeLayout(LayoutReq)`（**新 method**） | **不走擴散模型** | 文字必須清晰可讀 |

> **🔑 為什麼 text-layout 不交給擴散模型**：擴散模型（FLUX/SD 類）生不出可靠中文字與精準排版（錯字、糊字、字體不可控）。社群/海報命脈是**文字清晰＋品牌字體正確**。因此 **text-layout 採確定性模板渲染**（HTML/CSS 或 SVG/Canvas，套 brand kit 字體與色票，後端 headless 渲染或前端 `<canvas>` 匯出），把「擴散生成的背景」與「確定性渲染的文字層」**分層疊合**。Gemini/Nano Banana 可生「字燒進圖」的版本作**快速草稿**，但**正式輸出走模板合成**保證文字保真與可編輯。這是 `/social` 相對 `/video` 真正新增的能力（也是唯一新 method `composeLayout`）。

**LayoutReq 欄位（具體）**：
```
LayoutReq {
  templateId,          // 來自 block_combos 風格模板 / showcase 範本
  brandKitId,          // 套色票/字體/logo/安全邊距
  slots: { headline, subhead, body, cta, badge },  // 文字插槽
  backgroundAssetId,   // 擴散生成或上傳的底圖
  ratioPreset          // 1:1 / 9:16 / A4 ...
}  → 回 GenJob{ assetId, status, estimatedCostUsd }（合成成本≈0，仍走確認流程保一致）
```

### 5.2 Provider 可選（`mock | fal | gemini | hf`）— 沿用開發計畫 Seam #2

- 旗標 `GENERATION_PROVIDER=mock|hf|gemini|fal`，可**逐引擎覆寫**（`GENERATION_PROVIDER_IMAGE` / `_I2I`）。`/social` **預設與 `/video` 同值**，共用同一條回退鏈與失敗 UI。
- **回退鏈**（per-引擎）：`text2image/i2i : hf → gemini → fal → FAILED`。
- **失敗模式共用**：timeout/quota/429/partial/退件/飛行中切換/冪等去重/超預算暫停——`/social` 不重寫，直接用 `/video` P2 已做好的錯誤 UI 與 `asset_generation_events` 血統記錄。
- **mock 演失敗**：`?fail=timeout|429|partial` 注入，零金鑰下也能開發 `/social` 錯誤態。

> **Claude 不生圖（鐵則）**：OpenRouter→Claude 只負責文案、排版建議、確認語氣與組 prompt；像素一律走 `GenerationProvider`，文字層走 `composeLayout`。

### 5.3 模板系統（重用 `showcase` ＋ `block_combos`，零新表）

兩層分工，正交組合出一張對外圖文：

1. **風格模板（怎麼生）＝ `block_combos`/`custom_blocks`**：把多個提示詞積木組成「風格咒語」（光感/色調/構圖/質感）。社群②**用 `block_combos` 當風格庫**（開發計畫 §10.3 已明文）。選一個 combo → 帶入生成 prompt → `generation_history` 記下「這張用哪個 combo 生的」（可回溯）。
2. **版面範本（怎麼排）＝ `featured_showcase` 當範本牆**：把精選作品/官方範本當**可 fork 的版面起點**（`composeLayout.templateId` 指向）。公開項可被 fork（複製為自己一份、記來源），對映 §10.3「公開可 fork」。

> 三者正交：`block_combos` 管**生成風格**、`showcase` 範本管**排版骨架**、brand kit 管**品牌套用**。

---

## 6. 多尺寸匯出（master → variants）

流程：**一張 master 合成 → 依預設集 re-frame/re-layout → 每尺寸一份資產**，全部掛回同一篇 `social_post`。

### 6.1 匯出預設集（架構基本三比例的超集）

| 預設 ID | 平台/用途 | 尺寸（px / mm） | 比例 |
|---|---|---|---|
| `ig_square` | IG 貼文 | 1080×1080 | 1:1 |
| `ig_portrait` | IG 貼文（直） | 1080×1350 | 4:5 |
| `ig_story` / `reels_cover` | 限動 / Reels 封面 | 1080×1920 | 9:16 |
| `fb_feed` | FB 連結卡/貼文 | 1200×630 | 1.91:1 |
| `x_card` | X/Twitter | 1600×900 | 16:9 |
| `line_card` | LINE 宣傳 | 1040×1040 | 1:1 |
| `xhs_portrait` | 小紅書 | 1080×1440 | 3:4 |
| `poster_a4` / `a3` / `a2` | 海報（印刷） | 210×297mm @300dpi … | √2:1（A 系列） |

### 6.2 重構規則（不只縮放）

每個預設帶**版面適配策略**：
- logo 安全區；
- 文字插槽重排（直式 vs 橫式標題位移）；
- 焦點裁切（用 Gemini 感知抓主體，避免裁掉臉，§7.1）。
- 比例變化大時（1:1↔9:16）**重排版面**而非粗暴拉伸。

**與架構一致**：架構 §2② 的基本三比例 `1:1 / 9:16 / 16:9` 是**子集**；本預設集是其**超集擴充**（加 4:5、海報 A 系列、LINE/小紅書），不牴觸。

**匯出即資產**：每變體寫 `digital_asset_library`（`sourceStudio:'social'`、`provider`、`ratioPreset`），`project_asset_links` 掛回專案與貼文。

---

## 7. 脊椎上的代理流（Agent Flow，不新建代理，用六代理層）

### 7.1 四個角色分工

| 代理 | 在 `/social` 做什麼 | 接縫 / 現況 |
|---|---|---|
| **Sonar + Brave**（研究） | **時事選題**：讀 ③ 的 `news_articles`/`sense`，回**帶引用**的熱點與角度；查 hashtag 趨勢、競品做法 | 經脊椎讀 news（**不開 `/learn` 頁**）；`COMMANDER_ADAPTER=sonar` |
| **OpenRouter→Claude**（決策/文案） | **文案＋排版建議**：出標題/內文/hashtag/CTA（多版）；依 brand kit `voice&tone` 約束口吻；建議用哪個版面範本與插槽文字 | 既有 OpenRouter 閘道；**只決策不生圖** |
| **Generation Provider**（視覺） | text→image 背景、image-edit 套品牌、（草稿）燒字版 | Seam #2，`mock\|hf\|gemini\|fal` |
| **Gemini**（感知） | 讀品牌參考圖打標、**品牌一致性比對**（生成圖 vs brand kit）、多尺寸裁切的**主體偵測**（避免裁掉臉/logo） | 感知 client，與生成 client 分開（架構方案 B） |

> **長文不爆 token**：若 brief 是長文（如一篇文章轉懶人包），**進 RAG/Context Packet 壓成精華**再給 Claude，**絕不整篇塞給影像模型**。

### 7.2 「時事選題」如何經脊椎讀 news（具體機制）

- `/social` 要熱點時，**不開 `/learn` 的新聞頁**，而是經脊椎讀 `news_articles`/`sense` ＋ Sonar 代理，呈現在 `/social` cockpit 的「選題」面板（架構 §1.5.4 範例就是這條）。
- Sonar 回**帶引用**的熱點與角度，Claude 再把它轉成品牌口吻文案。
- 在 Commander plan 中對應步驟 `{tool:'research.trends', requiresConfirmation:false, cost:~0}`。

### 7.3 Commander 編排（與 `/video` 同一條流程）

每次「生成一篇」都走脊椎**同一條** `createIntent → packet → plan → tools → writeback`：

```
CommanderIntent { userId, projectId, mode:'create', message:brief, budget }
   │ compileContextPacket()   ← 專案＋品牌＋允許來源(news)壓成 2k–8k 精華（Seam #4）
ContextPacket { summaryMarkdown, sourceRefs[], tokenEstimate, permissions }
   │ plan()                   ← 步驟＋每步成本估算＋是否需確認
CommanderPlan { goal, steps:[
     {tool:'research.trends',   requiresConfirmation:false, cost:~0},      // Sonar 讀 news
     {tool:'copy.suggest',      requiresConfirmation:false, cost:cheapLLM},// Claude 文案
     {tool:'image.text2image',  requiresConfirmation:true,  cost:$X},      // 生成（需確認）
     {tool:'layout.compose',    requiresConfirmation:false, cost:~0},      // 模板合成
     {tool:'export.sizes',      requiresConfirmation:false, cost:~0},      // 多尺寸
   ], totalCost }
   │ 執行（成本階梯選最省可行）→ 回寫 orchestration_runs（citations/cost/trace，已落地 0070）
```

實作順序與 `/video` 同：`FallbackCommanderAdapter`（現有）→ `SonarCommanderAdapter` → `SubQCommanderAdapter`（到位只換 adapter）。**P2 用 MockCommander 出罐頭 plan＋罐頭文案＋罐頭引用**，整條旅程零金鑰可演。

### 7.4 確認門等價物（三道確認）

接 §4.3 閘門矩陣，`/social` 的三道對等確認：

1. **品牌確認**：品牌 `locked` 才能批量出圖/匯出/發佈；偏離品牌（Gemini 感知比對分數低）→ 標 `off_brand`、建議調整。
2. **素材來源確認（asset source）**：每篇發佈前確認每張圖**來源**——`generated`（本站生成）/ `uploaded`（使用者上傳）/ `licensed`（授權庫）。上傳/授權素材跳「**確認你有使用權？**」未確認 `HOLD`。寫 `social_posts.assetSources[]` 留證。
3. **成本確認**：媒體生成**永遠先估成本再確認**；mock 期回固定 `estimatedCostUsd` 也照走，確保切真實 UX 不變。

> 三道確認皆**寫 `orchestration_runs` 稽核**（誰/何時/為何覆寫）；覆寫需打字確認＋填 reason，與 `/video` 一致。

### 7.5 成本階梯（鐵則，與全站同）

`Deterministic（模板合成/重構）→ Cache → RAG（壓 brief）→ 便宜 LLM（文案）→ Sonar（選題）→ 高級 LLM → 媒體生成（永遠先估＋確認）`。`/social` 多數步驟落在**左段（便宜/確定）**——文案與排版便宜、合成≈0、只有 text→image/image-edit 落在最右段需確認。這讓 `/social` **單位成本遠低於 `/video`**，適合高頻產出。

---

## 8. 發佈 / 精選 / 排程（Scheduling & Posting）

### 8.1 內容行事曆（重用既有排程，零新表）

- **行事曆視圖**＝對 `social_posts.scheduled_at`（Tier-1）或 `project_notes_calendar`（Tier-0）的一個**月/週視圖**，不是新表。
- **到點觸發**＝既有 **`orb_scheduled_jobs`**（持久化排程，架構 §5.3 已列「②內容行事曆/發佈」為其用途之一）＋ `background_jobs` 跑非同步發佈。換頁/重整不中斷（`BackgroundTasksContext` 背景輪詢，完成 toast 通知）。
- **與筆記同源**：靈感/草稿存 `project_notes_calendar`（`ProjectNotesDrawer` 全站抽屜），與排程同一條時間軸。

### 8.2 PostingProvider 接縫（第 6 條接縫 · mock→Postiz）

發佈到外部平台是 `/social` **唯一完全沒有現況實作**的能力。藏在**第 6 條接縫**後，現在跑 mock、之後翻旗標接真實：

```ts
// server/services/posting/PostingProvider.ts
export interface PostingProvider {
  publish(req: PublishReq): Promise<PublishResult>;   // {postId, channel, assets, copy, scheduledAt?}
  getStatus(ref: ExternalRef): Promise<PostStatus>;
}
export interface PublishResult { ref: ExternalRef; status:'scheduled'|'posted'|'failed'; permalink?: string; }
```

| 接縫 | 介面 | mock 實作 | real 實作 | 旗標 |
|---|---|---|---|---|
| **Posting**（新） | `PostingProvider` | 標 `posted`、回假 `permalink`、寫 `social_posts.external_refs`（`provider:'mock'`） | **Postiz**（28+ 通道：IG/FB/Threads/X/LinkedIn/TikTok/Pinterest…）；或各平台原生 API | `POSTING_PROVIDER=mock\|postiz` |

- **現在＝mock 發佈**：`MockPostingAdapter` 讓「排程→到點→標記已發佈→顯示 permalink」整條在 P5 外殼期**零金鑰可演**；帳本照記一筆（`provider:'mock'`，成本 0，不污染真實帳）。
- **之後＝Postiz 外掛**：環境已偵測到 **Postiz 連接器/skill** 可用。接真實時實作 `PostizPostingAdapter`（呼叫 Postiz API/MCP），**只翻 `POSTING_PROVIDER=postiz`**，`social.postNow`/`schedulePost` 上層不改。原生 API（IG Graph、FB、X）為後續可選 adapter。
- **不擋進度**：發佈通道永遠可缺席——沒接 Postiz 就停在「已產出、可手動下載多尺寸包」，不阻斷創作主線。

### 8.3 精選牆（showcase）

`featured_showcase`(+comments) 同時做**發佈/精選**（`/social/publish`）與**版面範本牆**。`social.publishToShowcase` 委派 `showcase.*`。公開項可被其他使用者 fork 為版面起點。

### 8.4 發佈例外處理（對映開發計畫 §3.2 失敗矩陣）

| 情況 | 處理 |
|---|---|
| 平台 API 限流/額度 | 退避＋jitter 重排，進 `background_jobs` 佇列；toast「排隊中」 |
| 平台拒件（尺寸/內容政策） | 標 `failed`＋原因；建議改尺寸/文案；**絕不靜默當成功** |
| 排程衝突/重複發 | 冪等鍵（`postId+channel+scheduledAt`）去重，避免重複發佈 |
| 到點時 token 過期 | 先嘗試 refresh；不行則標 `failed` 並通知重新授權（不丟貼文草稿） |
| 品牌未鎖卻要排 | 閘門 BLOCK：先鎖品牌或單張放行 |
| mock→real 切換 | in-flight 排程沿用原 provider 跑完；新排程才用新 provider |

---

## 9. 如何重用 `/video` cockpit 元件（重用 vs 新建總表）

| 面向 | 重用既有（零摩擦） | 新建（最小、加法） |
|---|---|---|
| 介面殼 | `/video` cockpit 元件庫（`components/create/*`）→ **另實例化** | `client/src/shells/SocialShell.tsx`、`components/social/*` |
| 圖像生成 | `imageStudio` router＋`GenerationProvider` 接縫 | 文字排版合成器（text-layout / `composeLayout`） |
| 風格模板 | `block_combos`/`custom_blocks`（提示詞積木＝風格庫） | — |
| 品牌鎖定 | `consistency_vault`（鎖定機制＝角色鎖定的孿生） | **`brand_kits`**（結構化品牌身份，Tier-1） |
| 發佈/精選 | `featured_showcase`(+comments)、`showcase.*` router | **`social_posts`**（貼文實體，Tier-1） |
| 時事選題 | 經脊椎讀 ③ 的 `news_articles`/`news`/`sense` | — |
| 排程 | `orb_scheduled_jobs`＋`project_notes_calendar`＋`background_jobs` | 內容行事曆視圖（view，非新表） |
| 發佈通道 | （現況無）→ mock 發佈 | **`PostingProvider` 接縫**（mock→Postiz，第 6 條接縫） |

**重用方式關鍵字**：`/video` 的 `components/create/*` 元件**另實例化**到 `SocialShell`，**不是在 `/create` 加 mode toggle**。脊椎元件（active-project、確認門、資產庫、代理層）單一實例、跨 shell 共用。

---

## 10. 資料模型（兩條落地路徑）

主幹仍是 **`creative_projects`**（架構唯一主鍵）。社群產物**全部掛在專案下，沒有孤兒**。

### 10.1 Tier-0 · 零新表（架構預設，最快上線）

| 表 | 在 `/social` 的角色 | tRPC（既有） | 現況 |
|---|---|---|---|
| `creative_projects` | 專案主幹（社群系列＝一個專案/輕量專案） | `creativeProject.*` | ✅ |
| `digital_asset_library` | 每張產物與尺寸變體（`sourceStudio:'social'`、`provider`、`ratioPreset`） | `assets.*` | ✅ |
| `generation_history` | 每次生成記錄（prompt/combo/provider，可回溯） | `imageStudio.*` | ✅ |
| `block_combos`/`custom_blocks`/`custom_blocks_combo` | **風格庫**；Tier-0 也兼存品牌（`kind:'brand'`） | `blockCombos.*`/`customBlocks.*` | ✅ |
| `consistency_vault` | **鎖定閘門**（品牌/單張核准的狀態） | `vault.*` | ✅ |
| `featured_showcase`(+comments) | 發佈/精選 ＋ 版面範本牆 | `showcase.*` | ✅（UI 待建） |
| `news_articles` | 時事選題（**讀取**，來自 ③） | `news.*`/`sense.*` | ✅ |
| `prompt_library`/`prompt_collection` | 文案/咒語片段收藏 | `promptLibrary.*` | ✅ |
| `project_notes_calendar` | 內容筆記/排程日期（行事曆視圖讀它） | `notes.*`/`schedule.*` | ✅ |
| `orb_scheduled_jobs` | **到點發佈**的持久化排程 | `orbScheduler.*` | ✅ |
| `background_jobs` | 生成/匯出/發佈長任務輪詢 | （脊椎） | ✅ |
| `context_packets`/`orchestration_runs` | 代理上下文/決策稽核 | `contextPacket.*`/`commander.*` | ✅（0070/0071） |
| `project_asset_links`（P4） | 資產↔專案/貼文 | （video 子系統共用） | ❌待建（P4） |

> Tier-0 即可端到端：品牌＝`block_combos(kind:'brand')`＋`consistency_vault` 鎖；貼文＝產物資產 + 文案存進既有表 + `project_notes_calendar` 排程。**完全零新表，對齊架構 P5。**

### 10.2 Tier-1 · 1–3 張小型新表（純加法、flag 包覆，P5 建在 PG）

```sql
-- 1) brand_kits（結構化品牌身份）
brand_kits (
  id pk, project_id fk→creative_projects, owner_id fk→users,
  name,
  logo_asset_refs jsonb,      -- {primary, mono, inverse} → digital_asset_library ids
  palette jsonb,              -- [{role:'primary', hex:'#...'}...]
  typography jsonb,           -- {heading:{family,weight}, body:{...}, scale:[...]}
  voice_tone jsonb,           -- {tone, preferredWords[], bannedWords[], emojiPolicy}
  layout_rules jsonb,         -- {safeMargin, logoMinSize, grid}
  lock_state enum('draft','defined','locked') default 'draft',
  version int default 1,
  created_at, updated_at, deleted_at  -- 軟刪
)

-- 2) social_posts（貼文聚合：文案＋資產＋平台＋狀態＋排程）
social_posts (
  id pk, project_id fk→creative_projects, owner_id fk→users,
  brand_kit_id fk→brand_kits null, brand_kit_version int,  -- 用於 stale 判定
  title,
  copy jsonb,                 -- {headline, body, hashtags[], cta}
  platforms jsonb,            -- ['ig','fb','story','x','line','xhs']
  asset_refs jsonb,           -- [{assetId, ratioPreset}] → digital_asset_library
  asset_sources jsonb,        -- [{assetId, source:'generated|uploaded|licensed', confirmedBy}]
  status enum('draft','ready','scheduled','posted','failed') default 'draft',
  scheduled_at timestamptz null,
  external_refs jsonb,        -- [{provider:'postiz|mock', channel, permalink, postedAt}]
  version int default 1,
  created_at, updated_at, deleted_at  -- 軟刪
)

-- 3)（選配）social_post_renders：多尺寸變體（也可純用 digital_asset_library + links）
social_post_renders (
  id pk, post_id fk→social_posts, asset_id fk→digital_asset_library,
  ratio_preset, width, height, render_mode enum('compose','reframe'),
  created_at
)
```

| 新表 | 為何值得獨立 | 對映 procedure |
|---|---|---|
| `brand_kits` | 品牌結構化、長壽、跨產物/專案重用、需查詢與驗證 | `social.*BrandKit` |
| `social_posts` | 一篇貼文是「文案＋多資產＋多平台＋排程＋發佈結果」的聚合，現有表無此聚合 | `social.*Post` |
| `social_post_renders` | 純選配；不想獨立可用 `digital_asset_library`+`project_asset_links` 表達 | （含在 `social.exportSizes`） |

> **遷移/驗收**：新表須在 `drizzle/relations.ts` 補關聯（`brand_kits→creative_projects`、`social_posts→brand_kits/creative_projects`）；P3 之後建在 PG（型別用 `jsonb`/`pgEnum`/`timestamptz`）。`provider` 欄位沿用全站 B 案列舉（`hf|gemini|fal|mock`）。

### 10.3 Tier-0 vs Tier-1 權衡與建議

| | Tier-0 · 零新表 | Tier-1 · `brand_kits` 新表 |
|---|---|---|
| 品牌身份存哪 | 一筆 `block_combos`（`payload` JSON 塞 logo/色/字/voice）＋標籤 `kind:'brand'` | 專屬 `brand_kits`（結構化欄位） |
| 鎖定機制 | `consistency_vault` 一筆，`entityType:'brand'` | `brand_kits.lockState`（語意同 vault，亦可雙寫 vault） |
| 優點 | 完全零新表、最快上線、零 schema 風險、完全合架構 P5 | 可查詢（依色/字/品牌過濾）、清晰 lock 語意、可跨專案複用、欄位驗證（缺 logo/對比） |
| 缺點 | 品牌語意埋在 JSON，難查詢/驗證；與「風格模板」混在同一表語意模糊 | 多 1 張表（但純加法、flag 包覆、不動 `/video`） |

> **建議**：**先 Tier-0 出 MVP**（對齊架構「零新表」、最快 demo），**確定品牌功能要長期經營時升 Tier-1**。理由：品牌身份是**長壽、結構化、跨產物跨專案重用**的資料，硬塞 `block_combos.payload` 會失去查詢與驗證能力；`/video` 的角色鎖定本來就用**專屬結構表**（`worldbuilding_frameworks`＋`consistency_vault`），誠實的孿生設計應給品牌一張對等結構表。`block_combos` 仍保留**真正角色＝風格/咒語模板**，不與品牌身份混用。

### 10.4 掛載結構（無孤兒）

```
creative_projects (主幹)
├─ brand_kits[]            一專案可多品牌（主品牌/活動子品牌）
├─ social_posts[]          一專案多貼文；每貼文綁一個 brand_kit + 多資產
│    └─ asset_refs[] ─────▶ digital_asset_library ⇄ project_asset_links（掛回專案/貼文）
├─ block_combos[]          風格庫（脊椎共用，①②同源）
├─ consistency_vault       品牌/單張鎖定閘門
└─ context_packets         代理讀的精華（含品牌摘要＋允許 news 來源）
```

> **全站共用 active project**：在 `/video` 與 `/social` 之間切換，帶**同一專案上下文**（架構 §1.5.3）——同一支片的素材、同一個品牌，跨 shell 不斷脈絡。

---

## 11. 新增 tRPC procedures（一個 `social` router）

新增 `server/routers/social.ts`（風格對齊既有 34 router），**委派**既有能力、只在必要處新增：

```
social.
  // 品牌（Tier-1；Tier-0 用 blockCombos.*＋vault.*）
  listBrandKits / getBrandKit / createBrandKit / updateBrandKit
  lockBrandKit / unlockBrandKit            // 寫 brand_kits.lockState（＋雙寫 consistency_vault）
  // 貼文
  createPost / getPost / listPosts / updatePost / deletePost(軟刪)
  // 內容（委派代理層）
  researchTrends   → 委派 commander/Sonar 讀 news/sense（回帶引用選題）
  suggestCopy      → 委派 OpenRouter→Claude（依 brand voice 出多版文案）
  // 視覺（委派生成接縫）
  generateVisual   → 委派 imageStudio / GenerationProvider（text2image / image2image）
  composeLayout    → 新：模板合成（確定性渲染）
  exportSizes      → 新：多尺寸重構，每變體寫 digital_asset_library
  // 排程/發佈
  schedulePost / cancelSchedule / listCalendar   → 委派 orbScheduler + project_notes_calendar
  publishToShowcase → 委派 showcase.*（精選牆）
  postNow / getPostStatus → 委派 PostingProvider（mock|postiz）
```

**重用（不重寫）**：`showcase.*`、`imageStudio.*`、`blockCombos.*`/`customBlocks.*`、`news.*`/`sense.*`、`assets.*`、`vault.*`、`commander.*`/`contextPacket.*`、`orbScheduler.*`。`social` router 主要是**編排 façade ＋ 兩個新 method（`composeLayout`/`exportSizes`）＋ 貼文/品牌 CRUD**。

### 11.1 Mock-First 落地（擴充 `IDataStore`）

```ts
interface IDataStore {
  // …既有…
  listBrandKits(projectId): Promise<BrandKit[]>;
  saveBrandKit(kit): Promise<BrandKit>;        // mock 記憶體；real→social.*BrandKit
  setBrandLock(kitId, state): Promise<void>;
  listPosts(projectId): Promise<SocialPost[]>;
  savePost(post): Promise<SocialPost>;
  schedulePost(postId, when): Promise<void>;   // mock→記憶體計時器；real→orb_scheduled_jobs
}
```

fixtures：一個示範品牌「療癒誌」＋3 篇貼文＋多尺寸變體。
翻轉旗標：`DATA_STORE=trpc`（P1 後端就緒）、`GENERATION_PROVIDER=hf|gemini|fal`（P4）、`POSTING_PROVIDER=postiz`（發佈接真實時）。**UI 一行不改。**

---

## 12. 路線圖定位（落在哪個 P 階段）

**開發計畫 P5 ＝ `/social` shell**，排在 `/video` 旗艦（P2 外殼／P4 真實生成）**之後**，因為 `/social` 全盤重用 P2 已驗證的接縫。

```
P0 四 shell 外殼 ─▶ P1 脊椎+MockDataStore ─▶ P2 /video cockpit+確認門+mock 生成
                                                     │（驗證了可重用的接縫）
P3 Supabase parity ─▶ P4 Director→Video＋真實 HF/Gemini 生成
                                                     ▼
                              P5 ◀── /social shell（重用 P2 接縫、零新表 MVP）
                                     · 外殼/旅程：mock 下可先做（與 P0–P2 並行不擋）
                                     · 真實視覺：用 P4 的生成金鑰
                                     · Tier-1 新表（brand_kits/social_posts）：P5 建在 PG（P3 後）
                                     · 發佈：mock；之後接 Postiz（POSTING_PROVIDER）
```

| 問題 | 答案 |
|---|---|
| 何時做 | **P5**，`/video` 旗艦證明接縫後 |
| 需要什麼前置 | P2 的接縫（cockpit/Generation/Commander/Gate）；真實圖需 P4 金鑰（HF/Gemini） |
| 能先做什麼（零金鑰） | `SocialShell` 外殼、品牌/貼文 CRUD（mock）、模板合成、多尺寸匯出、mock 發佈、整條旅程 demo |
| 要金鑰才能做 | 真實 text→image/image-edit（P4 HF/Gemini）；真實發佈（Postiz token） |
| 回滾 | `SocialShell` feature-flag；**不影響 `/video`**；新表純加法可關 |

---

## 13. UI/UX 設計師可直接落地的清單（重點摘要）

- **4 條路由**：`/social`（cockpit 三欄）、`/social/studio`（圖像台）、`/social/brand`（品牌/風格庫）、`/social/publish`（匯出/行事曆分頁/發佈）。
- **三欄 cockpit 佈局**：左=專案+品牌面板／中=brief+文案+生成主控／右=資產庫+風格庫。
- **時事選題面板**在 cockpit 內（不另開頁）。
- **品牌鎖定徽章**（draft/defined/locked）＋缺漏旗標行內提示（非報錯）。
- **閘門 UX**：BLOCK（disabled + 去鎖捷徑）、WARN（可打字覆寫 + reason）、HOLD（素材來源/成本確認 modal）。
- **生成狀態徽章**：逐圖 ✅/❌/⏳；失敗回退鏈 UI 共用 `/video`。
- **多尺寸匯出**：預設集卡片（IG/FB/Story/X/LINE/小紅書/海報 A 系列），重構非縮放。
- **內容行事曆**：月/週視圖（publish 分頁），到點自動發；排程衝突提示。
- **窄螢幕優先**：三欄收 tabs、dock 變底部列、modal 全螢幕。
- **a11y**：WCAG AA 對比、`prefers-reduced-motion`、鍵盤導覽（Ctrl+K、G 系列）。
- **empty states**（每頁皆有定義，見 §3.2）。
- **三選項 stale 處理**：全部重生 / 選擇性重生 / 保留舊版。
