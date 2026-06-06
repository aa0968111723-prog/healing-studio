# 08 · route ↔ procedure 對照表（每畫面 → 真實路由 → 真實 tRPC procedure）

> 事實校驗層。基準＝`_research/03_code_reality_notes.md`（GitNexus，HEAD `2888a36`）。
> 圖例：**✅**=已建（圖譜/原始碼佐證）｜**🆕**=新建（`social` router 內）｜**🔁**=委派既有｜**⚠**=校正（原設計文件名稱對不上真實 procedure）｜**🔌**=外部連接器整合點。
> 鐵則：**procedure 名一律以本表為準**；設計文件早期「建議命名」已在此校正。現況 drizzle ＝ **MySQL（`mysqlTable`）**，PG 為 P3 後目標。

---

## 1. 路由地圖（4 條 canonical，新增 `SocialShell`）

| 路由 | 元件 | 掛載 | 狀態 |
|---|---|---|---|
| `/social` | `SocialShell` → cockpit（三欄） | App.tsx 新增 `<Route>`，feature-flag 包覆 | 🆕 新建 |
| `/social/studio` | 圖像台（重用 `imageStudio` UI＋`generate.*`） | 同上 | 🆕 殼新建、底層 ✅ |
| `/social/brand` | 品牌/風格庫 | 同上 | 🆕 新建 |
| `/social/publish` | 發佈/行事曆/精選 | 同上 | 🆕 新建 |

> 重用方式：cockpit ＝ 另實例化 `client/src/components/create/*` 到 `client/src/shells/SocialShell.tsx`；差異元件進 `client/src/components/social/*`。**不在 `/create` 加 mode toggle。**

---

## 2. 九步 × 畫面 → 路由 → procedure（主表）

| 步 / 畫面 | 路由 | 主要 procedure（真實名） | 類型 |
|---|---|---|---|
| **S1** 類型選擇 | `/social` | `creativeProject.get` | 🔁✅ |
| S1 意圖推論 | `/social` | `sense.inferIntent`（**⚠** `sense` 僅此一個，無 research） | 🔁✅ |
| **S2** brief 存檔 | `/social` | `creativeProject.update`（Tier-0）／`social.updatePost`（Tier-1） | 🔁✅ / 🆕 |
| S2 brief 長文壓縮 | `/social` | `contextPacket.compileProject`（**⚠** 非 `contextPacket.compile`） | 🔁✅ |
| S2 品牌欄讀取 | `/social` | `blockCombos.list`（Tier-0,`kind:'brand'`）／`social.getBrandKit`（Tier-1） | 🔁✅ / 🆕 |
| S2 講師名冊 | `/social` | `assets.list`（過濾講師分類）或既有講師資料（**實作核對真實 procedure**） | 🔁✅ |
| **S3** 既有資產（嵌入真實 `/assets`） | `/social` | `assets.*`（`assets.list`＋**依提示詞搜尋** `notesCurator.searchAssets`；篩 6 類型〔圖/影/音/語/腳本/打包〕／5 來源〔創意工作室·導演AI·Image·Video·Pro Studio〕＝`sourceStudio`／範圍 我的·團隊／最新優先） | 🔁✅ |
| S3 上傳 | `/social` | 既有上傳流 → `digital_asset_library`（`sourceStudio:'social'`；授權證據另記 `assetSources[].source:'uploaded'`） | 🔁✅ |
| S3 時事選題 | `/social` | `social.researchTrends` → `commander.createIntent`＋`orbProxy.unifiedSearch`＋`news.list`（**⚠** 非 `sense.research`/`sense.feed`） | 🆕 façade / 🔁✅ |
| **S4** 生成（估算） | `/social/studio` | `generate.estimateCost`（**⚠** 非 `imageStudio.generate`） | 🔁✅ |
| S4 生成（提交） | `/social/studio` | `generate.prepareJob` / `generate.submitStudioJob` | 🔁✅ |
| S4 生成（輪詢） | `/social/studio` | `generate.jobStatus` / `generate.checkStudioJob` | 🔁✅ |
| S4 生成（回寫血統） | `/social/studio` | **`generate.recordGenResult`**（回退鏈 hf→gemini→fal＋`asset_generation_events` 錨點） | 🔁✅ |
| S4 底層逐模型 | `/social/studio` | `imageStudio.<model>`（28 逐模型，如 `seedreamV4`/`fluxKontext`/`nanoBananaPro`） | 🔁✅ |
| S4 façade | `/social/studio` | `social.generateVisual` | 🆕 |
| S4 生成→存庫→重用（PromptVault §9） | `/social/studio` | 存＝**`promptLibrary.create`**（prompt+params+assetId）／我的詞庫 `promptCollection.*`／回寫 `generate.recordGenResult`／瀏覽搜尋 `assets.*`＋**`notesCurator.searchAssets`**（依提示詞）／`tagAssets`·`categorizeAsset`；掛載 `project_asset_links`（**⚠** P4，前用 `digital_asset_library.projectId`） | 🔁✅ / ❌P4 |
| S4 Flow 電視牆（VaultBrowser 皮） | `/social/studio` | `assets.list`＋`notesCurator.searchAssets`（依 prompt，prompt↔asset 已關聯）＋`promptLibrary`（seed/prompt）；showcase 範圍 `showcase.*`（**⚠** `showcase.templates` 待建）；脊椎 `OrbAssistant`「提示詞」分頁同源 | 🔁✅ / ❌ |
| **S5** image-edit | `/social/studio` | `generate.*` image2image → `imageStudio.<edit-model>`（`seedreamV45Edit`/`nanoBananaEdit`/`fluxKontext`） | 🔁✅ |
| S5 去背（可選外部） | `/social/studio` | 🔌 Adobe `image_remove_background` | 🔌 |
| S5 一致性比對 | `/social/studio` | Gemini 感知 client（與生成 client 分開） | 🔁✅ |
| **S6** 文字排版合成 | `/social/studio` | **`social.composeLayout`**（新 method，確定性渲染，不經擴散） | 🆕 |
| S6 範本骨架 | `/social/studio` | `block_combos`／`featured_showcase`（`templateId`，**⚠** `showcase.templates` 待建） | 🔁✅ / ❌ |
| S6 對比旗標 | `/social/studio` | `vault.update`（payload `low_contrast`，**⚠** vault 僅 CRUD） | 🔁✅ |
| **S7** Canva 往返 | `/social/studio` | 🔌 Canva `import-design-from-url`→`get-export-formats`→`export-design`（見 §5） | 🔌 |
| S7 Adobe 往返 | `/social/studio` | 🔌 Adobe `adobe_mandatory_init`＋`image_*`/`document_*`（見 §5） | 🔌 |
| S7 façade | `/social/studio` | `social.sendToCanva`/`pullFromCanva`/`adobeEdit`（內呼連接器） | 🆕 |
| **S8** 核准定稿 | `/social` | `vault.update`（payload `approved`，**⚠** 無 `setApproval`）／`social.updatePost` | 🔁✅ / 🆕 |
| S8 品牌改版 | `/social` | `social.unlockBrandKit`→`version++`（Tier-0 `vault.update`＋`blockCombos.update`） | 🆕 / 🔁✅ |
| S8 stale 反查 | `/social` | `social_posts.brandKitVersion`（Tier-1）／`project_asset_links` 反查（Tier-0） | 🆕 / 🔁 |
| S8 重生 | `/social` | 回 `generate.*`（帶新品牌 version、固定 seed） | 🔁✅ |
| **S9-A** 品牌 CRUD | `/social/brand` | `social.listBrandKits/getBrandKit/createBrandKit/updateBrandKit`（Tier-1）／`blockCombos.*`（Tier-0） | 🆕 / 🔁✅ |
| S9-A 鎖/解鎖 | `/social/brand` | `social.lockBrandKit/unlockBrandKit`（寫 `brand_kits.lockState`＋雙寫 `consistency_vault`）／Tier-0 `vault.update`（**⚠** 無專屬 lock procedure） | 🆕 / 🔁✅ |
| S9-A 風格庫 | `/social/brand` | `blockCombos.*`/`customBlocks.*` | 🔁✅ |
| **S9-B** 多尺寸匯出 | `/social/publish` | **`social.exportSizes(presetIds[])`**（新；每變體寫 `digital_asset_library`＋`project_asset_links`） | 🆕 |
| S9-B 焦點裁切 | `/social/publish` | Gemini 感知 client（主體偵測） | 🔁✅ |
| S9-B 長任務 | `/social/publish` | `background_jobs`＋`BackgroundTasksContext` | 🔁✅ |
| **S9-C** 排程 | `/social/publish` | `social.schedulePost/cancelSchedule/listCalendar` → `orb_scheduled_jobs`＋`project_notes_calendar`＋`background_jobs`（**排程 procedure 名實作核對真實 router**） | 🆕 / 🔁✅ |
| S9-C 發佈 | `/social/publish` | `social.postNow/getPostStatus` → **`PostingProvider`**（`POSTING_PROVIDER=mock\|postiz`，**⚠** 唯一全新接縫，無現況實作） | 🆕 / ❌ |
| S9-C 精選 | `/social/publish` | `social.publishToShowcase` → `showcase.*`（`featured_showcase` 表在、UI 待建） | 🆕 / 🔁◑ |

---

## 3. 新增 `social` router（一個檔，façade 為主）

新增 `server/routers/social.ts`（風格對齊既有 34 router），**委派既有能力＋兩個新 method＋品牌/貼文 CRUD**：

```
social.
  // 品牌（Tier-1；Tier-0 用 blockCombos.*＋vault.*）
  listBrandKits / getBrandKit / createBrandKit / updateBrandKit
  lockBrandKit / unlockBrandKit            // 寫 brand_kits.lockState（＋雙寫 consistency_vault）
  // 貼文
  createPost / getPost / listPosts / updatePost / deletePost(軟刪)
  // 內容（委派代理層）
  researchTrends   → commander.createIntent + orbProxy.unifiedSearch + news.list   // ⚠ 非 sense.research
  suggestCopy      → OpenRouter→Claude（依 brand voice 出多版文案）
  // 視覺（委派生成接縫）
  generateVisual   → generate.*（estimateCost→prepareJob/submitStudioJob→jobStatus→recordGenResult）  // ⚠ 非 imageStudio.generate
  composeLayout    → 🆕 模板合成（確定性渲染，不經擴散）
  exportSizes      → 🆕 多尺寸重構，每變體寫 digital_asset_library
  // 外部往返
  sendToCanva / pullFromCanva / adobeEdit  → 🔌 內呼 Canva/Adobe 連接器
  // 排程/發佈
  schedulePost / cancelSchedule / listCalendar   → orb_scheduled_jobs + project_notes_calendar
  publishToShowcase → showcase.*
  postNow / getPostStatus → PostingProvider（mock|postiz）   // ⚠ 全新接縫
  // 可設定工作流範本（全為待補·屬資料模型歸後端，比照 director.*Session 先例；見 09）
  listWorkflowTemplates / getWorkflowTemplate / saveWorkflowTemplate
  deleteWorkflowTemplate(軟刪) / setActiveWorkflowTemplate
```

> **可設定工作流（`09`）對回真實**：九步＝預設範本（前端內建常數）；每步**內容**對映本表既有 procedure；**範本持久化**（增/刪/重排/啟停/存自訂/作用中綁定）整批**待補（屬資料模型，歸後端）**，落 `workflow_templates`＋`ActiveWorkflowBinding`，**有 `director.{templates,saveSession,listSessions,loadSession,deleteSession}` 同型先例**可比照。安全閘門（成本/品牌/來源）**與步驟解耦、由動作觸發、恆在**。

**重用（不重寫）**：`generate.*`、`imageStudio.*`、`blockCombos.*`/`customBlocks.*`、`news.list`/`orbProxy.unifiedSearch`/`sense.inferIntent`、`assets.*`、`vault.*`、`commander.createIntent`/`contextPacket.compileProject`、`showcase.*`、`creativeProject.*`。

---

## 4. ⚠ 校正清單（設計文件早期命名 → 真實 procedure，與 `/social` 相關）

| 設計文件早期假設 | 真實 procedure（本表採用） |
|---|---|
| `social.generateVisual → imageStudio.generate` | **`generate.*`**（`estimateCost→prepareJob/submitStudioJob→jobStatus→recordGenResult`）；底層才是 `imageStudio.<model>` |
| `researchTrends → sense.research / sense.feed` | **`commander.createIntent` + `orbProxy.unifiedSearch` + `news.list`**（`sense` 僅 `inferIntent`） |
| commander `plan()` | **`commander.createIntent`**（內建 `assertProjectOwnership` ACL；無 `commander.plan`） |
| `contextPacket.compile` | **`contextPacket.compileProject`** |
| 品牌鎖 `vault.setApproval`/`setLocks` | **`vault.update`**（payload 表達；vault 僅 `create/update/delete/list/exportToAssets`） |
| `showcase.templates`（範本牆） | **待建**（`featured_showcase` 表在、UI 待建） |
| 用量/扣點 `credits.spend`/`apiUsage.record` | **`apiUsage.upsert`**（扣點為伺服器內部，非前端 procedure）；餘額 `credits.myBalance`／定價 `credits.pricingCatalog` |
| 儲值 `credits.topUp` | **不存在**：積分制（不涉真實金錢、不需信用卡）；**先扣後生成（原子）、失敗全額退還、最小 1／上限 500 pts**；無前端儲值 procedure（成本以 pts 顯示，不用 $） |
| Tier-1 新表「PG jsonb/pgEnum/timestamptz」 | 現況 **MySQL（`mysqlTable`）**；PG 為 P3 後目標 |

---

## 5. 🔌 外部連接器整合點（詳 `05` §7）

| 整合 | server | 關鍵工具 |
|---|---|---|
| **Canva** | `mcp__9b23d016-…` | `import-design-from-url`（需公開 HTTPS URL）、`get-export-formats`、`export-design`、`create-design-from-brand-template`、`list-brand-kits`、`resize-design`、`generate-design` |
| **Adobe** | `mcp__47fb08e5-…` | **`adobe_mandatory_init`（必先呼）**、`asset_initialize_file_upload`→`asset_get_presigned_urls`→`asset_finalize_file_upload`、`image_remove_background`、`image_generative_expand`、`image_vectorize`、`document_render_layout`（InDesign→PDF 300dpi）、`create_firefly_board`、`font_recommend` |
| **發佈** | Postiz（skill/連接器） | `PostingProvider` real adapter；`POSTING_PROVIDER=postiz` |

---

## 6. ✅built / 🆕to-build 速查（`/social` 範圍）

**✅ 已建可直接委派**：`generate.*`（10）、`imageStudio.*`（28）、`commander.createIntent`、`contextPacket.compileProject`、`creativeProject.*`、`blockCombos.*`/`customBlocks.*`、`assets.*`、**`notesCurator.searchAssets`/`tagAssets`/`categorizeAsset`**（依提示詞搜尋/打標，prompt↔asset 已關聯）、**`promptLibrary.create`**/**`promptCollection.*`**（提示詞庫存/收藏）、`vault.*`、`news.list`、`orbProxy.unifiedSearch`、`sense.inferIntent`、`apiUsage.upsert`、`credits.myBalance`/`pricingCatalog`、`background_jobs`、`orb_scheduled_jobs`、`project_notes_calendar`、收編機制（`appRegistry.group`/`SIDEBAR_GROUPS`/`VISIBLE_DOCK_PAGE_IDS`/`NavigateRedirect`）、ACL `assertProjectOwnership`。

> **脊椎共用（設計系統新增、四殼共用，`/social` 引用不重造）**：`OrbAssistant`（右下光球助手浮球＋6 情境分頁〔本頁/提示詞/對話/專注流/積分/筆記〕＋主動泡泡 ProactiveBubble，亮色玻璃化）＋`FlowWall`（成功 prompt→產出 的可重跑範例牆）。`/social` 的提示詞庫＝面板「提示詞」分頁的 `VaultBrowser`；Flow 電視牆＝其 showcase 範圍展示皮。

**🆕 待建（`/social` 新增）**：`SocialShell` ＋ 4 路由、`components/social/*`、`server/routers/social.ts`（façade）、`social.composeLayout`、`social.exportSizes`、`PostingProvider`（mock→Postiz）、`showcase` 範本牆 UI、（Tier-1）`brand_kits`/`social_posts`(+`social_post_renders`) 小表、`project_asset_links`（P4）、品牌 lock 語意（`vault.update` payload 或後端擴充）。

**🆕 待補（可設定工作流，屬資料模型·歸後端，`09`）**：`workflow_templates`（範本＋steps JSON／或子表 `workflow_template_steps`）、`ActiveWorkflowBinding`（user/project↔template）、`social.{list,get,save,delete,setActive}WorkflowTemplate` 五支 façade。**比照 `director.*Session`/`templates` 同型先例**，純加法、flag 包覆。前端：預設九步範本內建常數＋`WorkflowEditor` 家族（設計系統即將提供）。

**⚠ 落地前提**：① 抽 `SocialShell` 前先打斷 `PersonalSettingsContext⇄useMobile` 循環、把共用 provider 提脊椎層（`03` §3.3）。② `digital_asset_library.getSignedUrl`（S7 推出公開 URL 的前置）。③ Tier-1 新表型別依 P3 Supabase parity 進度（現況 MySQL）。

---

## 7. Mock-First（零金鑰演完九步）

擴充 `IDataStore`：`listBrandKits/saveBrandKit/setBrandLock/listPosts/savePost/schedulePost`。fixtures：示範品牌「療癒誌」＋3 篇貼文＋多尺寸變體。

旗標翻轉（**UI 一行不改**）：`DATA_STORE=trpc`（P1 後端）、`GENERATION_PROVIDER=hf|gemini|fal`（P4 真實生成）、`POSTING_PROVIDER=postiz`（發佈接真實）、外部連接器（Canva/Adobe）翻旗標接真實工具。mock 失敗注入：`?fail=timeout|429|partial`。
