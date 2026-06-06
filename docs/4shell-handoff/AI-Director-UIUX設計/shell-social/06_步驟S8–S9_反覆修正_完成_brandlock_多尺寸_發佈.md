# 06 · 步驟 S8–S9 — 反覆修正 / 完成專案（品牌鎖閘門＋多尺寸匯出＋發佈）

> 旅程末段「**收斂並送出去**」。S8 主場＝`/social` cockpit；S9 跨 `/social/brand`（鎖品牌）與 `/social/publish`（多尺寸＋行事曆＋發佈）。
> S9 把 `/social` 三個既有能力收束在此：**brand-lock 閘門**、**多尺寸輸出**、**發佈/排程/精選**。

---

# S8 · 反覆修正（版本比較 / 核准 / 品牌改版 → stale 重生）

**目標**：在多版素材中收斂定稿（核准），並處理品牌改版造成的「既有貼文過期」。

## S8.1 畫面結構與佈局（`/social` cockpit · 修正視圖）

```
┌ 左：專案+品牌 ┬──────── 中：版本與核准 ────────┬ 右：庫＋Flow 牆 ┐
│ 品牌：療癒誌  │ 版本帶：v1 v2 v3(站內) vC(Canva)│ 受影響貼文（stale）│
│ 草稿/已鎖     │  [並排比較 ▦]                   │ ⚠ 3 篇引用舊品牌  │
│ 缺漏：無      │  ┌────────┬────────┐           │ [處理 stale ▾]    │
│               │  │ v2     │ v3 ✓   │           │                  │
│               │  │ off_   │ 對比AA │           │                  │
│               │  │ brand⚠ │ 已套品 │           │                  │
│               │  └────────┴────────┘           │                  │
│               │ [核准 v3 為定稿] [退回 v2 再改]  │                  │
└───────────────┴───────────────────────────────┴──────────────────┘
```

- **版本帶**：S4/S5/S6/S7 的所有版本（append-only），含外部往返版（vC=Canva、vA=Adobe）。
- **並排比較**：選 2–3 版並排，標旗標（`off_brand`/`low_contrast`/已套品牌）。
- **核准**：選定版「核准為定稿」→ Post-Asset `generated→approved`（**`approved` 才能進 S9 多尺寸/發佈**）。
- **stale 區（右欄）**：品牌改版後，引用舊版品牌的貼文標 `stale`，給三選項。

## S8.2 全狀態

| 狀態 | 內容 |
|---|---|
| **Empty** | 只有一版：「目前只有一個版本，核准它，或回去再做一版」。 |
| **Loading** | 版本縮圖 skeleton；stale 反查中 skeleton。 |
| **Error** | 核准寫入失敗 → 操作級重試（不改版本狀態）；比較圖載入失敗單版降級。 |
| **長內容（stale 多篇）** | 受影響 N 篇 → 清單虛擬滾動＋「全選/逐篇」；§01§5.5。 |
| **權限** | 非擁有者唯讀不可核准；品牌改版需擁有者。 |

## S8.3 進入＆離開條件
- **進入**：S6/S7 後；或從任何步回頭比較。
- **離開（前進）**：核准定稿 → S9。
- **離開（回改）**：退回某版 → 回 S5/S6 再修。
- **品牌改版觸發**：在 `/social/brand` 解鎖改版 → 回 cockpit 看 stale。

## S8.4 分支與決策（含 stale 三選項）

| 分支 | 條件 | 行為 |
|---|---|---|
| **a 核准定稿** | 選定版核准 | Post-Asset `approved`；可進 S9 |
| **b 退回再改** | 不滿意 | 回 S5/S6（不刪舊版） |
| **c 品牌改版 → stale** | `/brand` 解鎖 `version++` | 引用該品牌的貼文/產物**自動標 `stale`**（`social_posts.brandKitVersion` 反查） |
| **c1 全部重生** | stale 選全部 | 逐篇以新品牌 version 重生（append 新資產＋新 link，`generation_history` 記「對哪個品牌 version 生」） |
| **c2 選擇性重生** | stale 選部分 | 只重生選的 |
| **c3 保留舊版** | 接受分歧 | 標 `pinned_to_v{n}`，不再視為過期 |

> **append-only 血統**：重生不覆寫舊圖；mock DataStore 也實作 `version`/`stale`，「改品牌→既有貼文變灰提示重生」P2 零金鑰可驗。

## S8.5 microcopy
- 區段：`反覆修正`／副：`比較版本、核准定稿`
- 版本帶：`v{n}`／`{站} 版`／`並排比較`／`核准為定稿`／`退回 v{n} 再改`
- 旗標：`偏離品牌` / `對比不足` / `已套品牌 ✓`
- stale：`{n} 篇貼文引用了舊版品牌`／`全部重生` / `選擇性重生` / `保留舊版（接受差異）`
- 核准成功：`已核准，可進入多尺寸與發佈`

## S8.6 route / procedure
- 路由：`/social`（cockpit 修正視圖）。
- 核准（**校正**：vault 無 setApproval）：`vault.update`（payload 表達 `approved`）／Tier-1 `social.updatePost`（Post-Asset 狀態）。
- 品牌改版：`social.unlockBrandKit`→`brand_kits.version++`（Tier-0：`vault.update` + `blockCombos.update`）。
- stale 反查：`social_posts.brandKitVersion`（Tier-1）／`project_asset_links` 反查（Tier-0）。
- 重生：回 `generate.*`（帶新品牌 version，固定 seed 保系列一致）。

---

# S9 · 完成專案（品牌鎖閘門 → 多尺寸匯出 → 發佈/行事曆/精選）

S9 是收尾，三個能力依序：**先鎖品牌（閘門）→ 再多尺寸匯出 → 最後排程/發佈**。

---

## S9-A · 品牌鎖閘門（`/social/brand`）

> `/video` 用 `consistency_vault` 鎖**角色**；`/social` 把同機制套到**品牌**：**品牌未鎖，不進批量出圖/多尺寸/發佈**。

### A.1 畫面結構與佈局（`/social/brand`）

```
┌──────────── /social/brand · 品牌 / 風格庫 ────────────────────────────┐
│ 分頁：[品牌 Kit] [風格庫 block_combos]                                  │
│ ┌─ 品牌列表 ──┬──────────── 品牌編輯 ────────────────────────────────┐ │
│ │ ⬡ 療癒誌 🔒 │ 狀態：● defined（缺：無）  [鎖定品牌 →]                │ │
│ │ ⬡ 春季活動  │ ── logo ──  主標/副標/去背/深淺底（各指向資產）        │ │
│ │ [+新品牌]   │ ── 色票 ──  主●輔●強調●中性● (hex＋角色＋對比檢查)     │ │
│ │             │ ── 字體 ──  標題:Noto Serif TC / 內文:Noto Sans TC     │ │
│ │             │ ── 口吻 voice&tone ── 溫暖療癒 · 禁用詞 · emoji 政策    │ │
│ │             │ ── 版面規則 ── 安全邊距 / logo 最小尺寸 / 對齊網格      │ │
│ │             │ lockState：draft → defined → locked（version 2）       │ │
│ └─────────────┴───────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

- **BrandKit 結構**（每專案一份，跨產物重用）：logo / palette / typography / voice&tone / layout rules / lockState（draft→defined→locked＋version）。色票列＝設計系統 `BrandSwatchRow`（§8.4）；鎖定徽章＝`Pill`（`kind`=ok 表 locked）；缺漏行內提示＝`Pill`（`kind`=warn）。
- **voice&tone 串接**：此欄餵 S4 文案的 Claude system 約束——「文案口吻」與「視覺品牌」鎖同一份。
- **鎖定鈕**：缺漏旗標清空且對比達標 → 可鎖；鎖後出 `locked` 徽章＋version。

### A.2 全狀態

| 狀態 | 內容 |
|---|---|
| **Empty** | 無品牌：「建立第一個品牌」CTA；可先用草稿品牌做單張試做。 |
| **Loading** | 品牌卡 skeleton。 |
| **Error**（**非報錯，行內提示**） | 缺 logo/色/字 → **行內欄位提示**（`缺少 logo` / `缺少主色` / `缺少字體`），不是整頁報錯；`low_contrast` → 該色對比徽章標紅＋建議。 |
| **長內容** | 色票/字體階多 → 分節折疊；多品牌（主品牌/活動子品牌）列表虛擬滾動。 |
| **權限** | 鎖/解鎖需擁有者；協作者唯讀＋「只能套用已鎖品牌」。 |

### A.3 鎖定 / 解鎖流程與決策矩陣

| 情況 | 判定 | 行為 |
|---|---|---|
| 品牌未 `locked` | **BLOCK** | S9 批量/多尺寸/發佈鈕 disabled＋「去鎖定品牌」捷徑（**單張試做放行**） |
| 缺 logo/色/字 | **不可鎖** | 行內提示補齊；補齊才亮「鎖定」 |
| 對比未達 AA | **WARN（可覆寫）** | 標 `low_contrast`、建議調色；可打字確認覆寫＋reason |
| 品牌已鎖要改 | **UNLOCK** | 解鎖 modal：「**將影響 {N} 篇既有貼文**」→ 解鎖後 `version++`、下游標 `stale`（回 S8 處理） |

### A.4 microcopy
- 分頁：`品牌 Kit`／`風格庫`
- 狀態：`草稿` / `已備齊` / `已鎖定 · v{n}`
- 缺漏（行內）：`缺少 logo，補上才能鎖定`／`缺少主色`／`缺少字體`
- 對比：`主色配白字對比不足，建議改用 {建議色}`
- 鎖定：`鎖定品牌`／`鎖定後，這個品牌就能批量出圖與發佈`
- 解鎖：`解鎖會建立新版本，並影響 {n} 篇既有貼文`／`仍要解鎖` / `取消`
- 閘門 BLOCK：`品牌尚未鎖定，先鎖定才能多尺寸匯出與發佈`／`去鎖定品牌`

### A.5 route / procedure
- 路由：`/social/brand`。
- 品牌 CRUD：Tier-1 `social.listBrandKits/getBrandKit/createBrandKit/updateBrandKit`；Tier-0 `blockCombos.*`(`kind:'brand'`)。
- 鎖/解鎖（**校正**：vault 無專屬 lock procedure）：Tier-1 `social.lockBrandKit/unlockBrandKit`（寫 `brand_kits.lockState`＋**雙寫** `consistency_vault`）；Tier-0 `vault.update`（`entityType:'brand'`，payload 表達 lockState）。
- 風格庫：`blockCombos.*`/`customBlocks.*`。

---

## S9-B · 多尺寸匯出（`/social/publish` · 匯出）

> 一張 master 合成 → 依預設集 re-frame/re-layout → 每尺寸一份資產，全掛回同一篇貼文。**重構非縮放。**

### B.1 畫面結構與佈局

```
┌──────────── /social/publish · 多尺寸匯出 ─────────────────────────────┐
│ 主視覺：{已核准定稿 v3}   品牌：療癒誌 🔒                               │
│ 選預設集（可多選）：                                                    │
│  ☑ IG 貼文 1:1 1080² ☑ IG 直 4:5 ☑ 限動 9:16 ☐ FB 1.91:1             │
│  ☐ X 16:9 ☐ LINE 1:1 ☐ 小紅書 3:4 ☐ 海報 A4/A3 300dpi                │
│ 重構策略：焦點裁切(避開臉/logo) · 文字插槽重排 · logo 安全區            │
│ [預覽各尺寸] [匯出 {n} 個尺寸 →]                                        │
│ ── 匯出進度 ──  IG✅ IG直✅ 限動⏳ …（逐尺寸徽章）                       │
└────────────────────────────────────────────────────────────────────────┘
```

> 預設集卡＝設計系統 `ExportRatioCard`（§8.4，`.expo`，`ratio`）；多選 grid。重構策略列用 `Seg`/`Pill`。

### B.2 匯出預設集（架構基本三比例的超集）

| 預設 ID | 平台/用途 | 尺寸 | 比例 |
|---|---|---|---|
| `ig_square` | IG 貼文 | 1080×1080 | 1:1 |
| `ig_portrait` | IG 直 | 1080×1350 | 4:5 |
| `ig_story`/`reels_cover` | 限動/Reels 封面 | 1080×1920 | 9:16 |
| `fb_feed` | FB 連結卡 | 1200×630 | 1.91:1 |
| `x_card` | X | 1600×900 | 16:9 |
| `line_card` | LINE | 1040×1040 | 1:1 |
| `xhs_portrait` | 小紅書 | 1080×1440 | 3:4 |
| `poster_a4/a3/a2` | 海報（印刷） | 210×297mm@300dpi… | √2:1 |

> 架構 §2② 基本三比例 `1:1/9:16/16:9` 是子集；本預設集是超集擴充，不牴觸。

### B.3 重構規則（不只縮放）
- logo 安全區；文字插槽重排（直式 vs 橫式標題位移）；焦點裁切（Gemini 感知抓主體，避免裁臉/logo）；比例變化大（1:1↔9:16）**重排版面**而非粗暴拉伸。可在 Adobe lane 用 `image_generative_expand` 補畫面（S7）。

### B.4 全狀態

| 狀態 | 內容 |
|---|---|
| **Empty** | 無已核准定稿：「先核准一張定稿，才能匯出多尺寸」＋回 S8 捷徑。 |
| **Loading** | 各尺寸預覽 skeleton；匯出時逐尺寸進度。 |
| **Error** | 某尺寸匯出失敗 → 該尺寸 ❌＋重試，其他照出；海報 300dpi 過大→提示「大圖較久，背景處理中」。 |
| **長內容** | 預設集多→卡片 grid＋全選/反選；多尺寸包逐尺寸徽章。 |
| **權限 / 閘門** | **品牌未鎖 BLOCK**（鈕 disabled＋去鎖捷徑）；非擁有者唯讀。 |

### B.5 microcopy
- 標題：`多尺寸匯出`／副：`一張定稿，一次輸出全平台尺寸`
- 預設集：各平台名＋尺寸標籤（見 B.2）
- 重構策略：`智慧裁切（避開臉與 logo）`／`文字位置自動重排`
- 動作：`預覽各尺寸`／`匯出 {n} 個尺寸`
- 閘門：`品牌未鎖定，無法匯出多尺寸`／`去鎖定`
- 進度：`{preset} 匯出完成` / `{preset} 失敗，重試`

### B.6 route / procedure
- 路由：`/social/publish`（匯出分頁）。
- 多尺寸（**新 method**）：`social.exportSizes(presetIds[])` → 每變體寫 `digital_asset_library`（`sourceStudio:'social'`、`ratioPreset`、`provider`）＋`project_asset_links` 掛回貼文。
- 焦點裁切：Gemini 感知 client（主體偵測）。
- 長任務：`background_jobs`＋`BackgroundTasksContext`。

---

## S9-C · 發佈 / 內容行事曆 / 精選（`/social/publish`）

> 發佈到外部平台是 `/social` **唯一完全沒有現況實作**的能力，藏在**第 6 條接縫 `PostingProvider`** 後，現跑 mock、之後翻旗標接 Postiz。

### C.1 畫面結構與佈局（三分頁：發佈 / 行事曆 / 精選）

```
┌──────────── /social/publish ──────────────────────────────────────────┐
│ 分頁：[發佈] [內容行事曆] [精選 showcase]                                │
│ ── 發佈 ──                                                              │
│  貼文：{標題} 多尺寸包就緒(6)  品牌🔒  來源確認✅                        │
│  通道：☑IG ☑FB ☑Threads ☐X ☐LINE  （未授權通道：灰＋連接）             │
│  文案：{headline/body/hashtags/cta}（逐通道可微調）                      │
│  [立即發佈] 或 [排程 ▾ 2026-06-10 09:00]                                │
│ ── 內容行事曆（月/週）──                                                 │
│  [<] 2026 六月 [>]   日 一 二 三 四 五 六                               │
│   ...  10●春季講座(已排) 11  12◐懶人包(草稿) ...                         │
│ ── 精選 showcase ──  已發佈 → 推上精選牆（可被 fork 為版面起點）          │
└────────────────────────────────────────────────────────────────────────┘
```

### C.2 發佈前三道確認（接 §01§3）
1. **品牌確認**：品牌 `locked`（否則 BLOCK）。
2. **來源確認**：每張圖來源 `generated/uploaded/licensed/canva/adobe` 已確認使用權（否則 HOLD）。
3. **成本確認**：若發佈含付費生成補件，先估。

### C.3 全狀態

| 狀態 | 內容 |
|---|---|
| **Empty** | 發佈：「還沒有可發佈的貼文」；行事曆：「本月還沒排內容」；精選：「還沒有已發佈作品」。 |
| **Loading** | 發佈/匯出任務 skeleton；行事曆月視圖 skeleton。 |
| **Error** | ① 平台**拒件**（尺寸/內容政策）→ 標 `failed`＋原因＋建議改尺寸/文案，**絕不靜默當成功**。② **限流/額度** → 退避＋jitter 重排進 `background_jobs`，toast「排隊中」。③ **排程衝突/重複** → 冪等鍵（`postId+channel+scheduledAt`）去重。④ **到點 token 過期** → 先 refresh，不行標 `failed`＋通知重新授權（不丟草稿）。 |
| **長內容** | 行事曆一格 >3 篇折「+N」點開當日列表；通道多→逐通道狀態列。 |
| **權限 / 通道未授權** | 通道未連 → 灰＋「連接此通道」；停在「已產出、可手動下載多尺寸包」，不阻斷主線（§01§5.4）。 |

### C.4 進入＆離開條件
- **進入**：S9-B 多尺寸就緒＋品牌鎖＋來源確認。
- **離開（完成）**：`立即發佈`→ posted（mock 標 posted＋假 permalink）；或 `排程`→ scheduled（到點 `orb_scheduled_jobs` 觸發）。發佈成功→可推 showcase。
- **可缺席**：通道未接 → 下載多尺寸包手動發，旅程仍算完成。

### C.5 分支與決策

| 分支 | 條件 | 行為 |
|---|---|---|
| **a 立即發佈** | 點立即發佈 | `social.postNow`→`PostingProvider`（mock 標 posted/假 permalink；real→Postiz） |
| **b 排程** | 選日期時間 | `social.schedulePost`→`orb_scheduled_jobs`；行事曆落格；到點 `background_jobs` 發 |
| **c 逐通道微調文案** | 多通道 | 各通道字數/標籤差異，逐通道編（共用主文案＋覆寫） |
| **d 推精選** | 發佈成功 | `social.publishToShowcase`→`showcase.*`；公開項可被他人 fork |
| **e 通道未授權** | 缺 token | 停「已產出、可下載」；給連接捷徑；不擋完成 |
| **f mock→real 切換** | 旗標切換 | in-flight 排程沿原 provider 跑完；新排程才用新 provider |

### C.6 microcopy
- 分頁：`發佈`／`內容行事曆`／`精選`
- 通道：`選擇發佈通道`／未授權：`尚未連接 {通道}`／`連接此通道`
- 動作：`立即發佈`／`排程發佈`／`選擇日期時間`
- 確認門：`品牌已鎖 ✅` / `素材來源已確認 ✅` / `預估 {N} pts（先扣後生成，失敗全額退還）`
- 行事曆空：`本月還沒排內容`／`把貼文拖到日期就會自動排程`
- 拒件：`{通道}退件：{原因}`／`建議改 {尺寸/文案}`／`重試`
- 限流：`{通道}流量限制，已排隊，會自動重送`
- token 過期：`{通道}授權過期，請重新連接（你的貼文已保留）`
- 精選：`推上精選牆`／`已發佈作品可被他人 fork 為版面起點`
- 通道缺席：`還沒接發佈通道？先下載多尺寸包手動發佈`

### C.7 route / procedure
- 路由：`/social/publish`（發佈/行事曆/精選分頁）。
- 排程：`social.schedulePost`/`cancelSchedule`/`listCalendar` → 既有 **`orb_scheduled_jobs`** 持久化排程＋`project_notes_calendar`（行事曆與筆記同源）＋`background_jobs`（非同步發佈）。**排程 procedure 名以 `08` 對照表/實際 router 為準。**
- 發佈（**唯一全新接縫**）：`social.postNow`/`getPostStatus` → **`PostingProvider`**（`POSTING_PROVIDER=mock|postiz`）；mock＝`MockPostingAdapter`（標 posted/假 permalink/寫 `external_refs` `provider:'mock'`）；real＝`PostizPostingAdapter`（Postiz 28+ 通道）。**上層 `social.postNow` 不改。**
- 精選：`social.publishToShowcase` → `showcase.*`（`featured_showcase` 表在、UI 待建；`showcase.templates` 待建）。

---

## 旅程閉環
S9 發佈成功 → 貼文 `posted`、推上 showcase 精選牆 → 成為他人（與自己下一篇）可在 **Flow 電視牆**「延伸」的起點（`03` Flow 牆）。九步閉環：**完成的作品回流成下一輪創作的種子。**
