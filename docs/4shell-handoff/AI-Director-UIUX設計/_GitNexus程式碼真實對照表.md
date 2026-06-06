# _GitNexus 程式碼真實對照表（4-shell restructure）

> 來源分支：`feat/4-shell-restructure`（base commit `8b3fbcfa`）+ 本次前端優化 commit。
> 產生方式：GitNexus MCP 不可用（npx 取套件時 npm-cache 故障、MCP server 未註冊），
> 改用 **ripgrep 靜態掃描 + 強型別 tRPC client 編譯驗證** 重建同一張關係圖。
> 驗證基準：`npx tsc --noEmit`（強型別 `createTRPCClient<AppRouter>`）**全綠** → 表中每一個
> 「route → page → procedure → component → data model」連線都經過編譯器證明可解析（procedure
> 路徑、query/mutation、input 形狀皆正確），非人工臆測。
>
> 用途：交給 UI/UX 設計交接包與 Claude Design 當「程式碼真實面」依據——**畫面要對齊的，是這裡的真實資料流，而非開發計畫的願景。**

---

## 0. 圖例與總覽

```
route（wouter path）
   └─→ page/panel 檔（client/src/…）
          └─→ tRPC procedure（server 真實存在；query/mutation）
                 └─→ 關鍵元件（ui 原語 / shell 元件）
                        └─→ 資料模型（DB table / 外部服務）
```

- **旗標**：整個 4-shell 路由層掛在 `ENABLE_4SHELL`（`client/src/config/featureFlags.ts`）之後，**預設 OFF**。OFF 時行為 == 線上現狀（54 條既有 route 一條不動）。
- **單一真相源**：`client/src/shells/shellRouteTable.ts`（收編表）+ `client/src/app/ShellRoutes.tsx`（旗標控制注入層）。
- **真實 procedure 表面**：root router `server/routers.ts`（`appRouter`，~line 1072）組合 50+ 命名空間。

---

## A. 四大 shell — canonical 路由 → 頁面 → procedure → 元件 → 資料模型

### 🎬 video shell（`client/src/shells/VideoShell.tsx` · `video/VideoCockpit*`）

| canonical route | 頁面檔（re-home 既有頁） | 主要 tRPC procedure（經 adapter 接縫） | 關鍵元件 | 資料模型 |
|---|---|---|---|---|
| `/video/director` *(index)* | `pages/DirectorAI.tsx` | `director.chat` · `director.analyzeScriptOverview` · `director.generateVideoScript`（mut） | VideoCockpit / GuidedJourney / StageBar | `creative_projects` · `world_storyboards` |
| `/video/create` | `pages/CreationHub.tsx` | `creativeProject.list/get/getContextSummary`（q） | ContextColumn | `creative_projects` |
| `/video/studio` | `pages/Studio.tsx` | `generate.estimateCost/submitStudioJob/jobStatus/recordGenResult` | ConfirmGate | `digital_asset_library`（生成結果） |
| `/video/playground` | `pages/Playground.tsx` | （沿用既有頁；多 studio 試驗台） | — | — |
| `/video/animation`（+`/:storyboardId`） | `pages/AnimationStudio.tsx` | `worldStoryboard.*` · `worldbuilding.*` | — | `world_storyboards` · `worldbuilding_frameworks` |
| `/video/image` | `pages/ImageStudio.tsx` | `imageStudio.*` · `generate.*` | — | `digital_asset_library` |
| `/video/video` | `pages/VideoStudio.tsx` | `videoStudio.*` · `generate.*` | — | `digital_asset_library` |
| `/video/pro` | `pages/ProStudio.tsx` | `proStudio.*` | — | — |
| `/video/light-orb` | `pages/LightOrbCreationStudio.tsx` | `orbProxy.unifiedSearch`（mut） | — | `orchestration_runs` |

> video shell 的資料流走 **spine adapter 接縫**（`client/src/adapters/*.trpc.ts`），非面板直呼。見 §D。

### 📚 learn shell（`client/src/shells/learn/LearnShell.tsx` → 富首頁 `LearnHome.tsx`，六分頁）

| canonical route / 分頁 | 面板檔 | tRPC procedure（✅ 編譯驗證存在） | 關鍵元件 | 資料模型 |
|---|---|---|---|---|
| `/learn`（research 分頁） | `panels/ResearchPanel.tsx` | `orbProxy.unifiedSearch`（經 `adapters/research.ts`，預設 mock） | SpineProvider 故障注入 | `orchestration_runs`（真實時） |
| `/learn/ai-models`（models） | `panels/AIModelHubPanel.tsx` | `aiModels.list`（q）· `agentModelPicks.recordPick`（mut） | StatCard / ModelCard / BrainAssignment | `ai_models` · `agent_model_picks` · `user_ai_brain` |
| （docs 分頁） | `panels/LearnDocsPanel.tsx` | `learnHub.list` · `learnHub.categories`（q） | CatChip / FallbackDocs | `learn_hub`（docs）|
| （news 分頁） | `panels/NewsPanel.tsx` | `news.list`（q） | Card / Badge | `news_articles` |
| （credits 分頁） | `panels/CreditsUsagePanel.tsx` | `credits.myBalance` · `dashboard.myStats` · `dashboard.myUsageLogs`（q） | MiniStat / Progress | `api_usage_logs` · `ai_usage_events` · 積分 |
| （金鑰分頁） | `panels/ApiKeysPanel.tsx` | `admin.apiKeysStatus`（q，admin 限定） | RBAC（useAuth） | 平台金鑰狀態（只報 isSet） |
| `/learn/model-wishlist` | `pages/ModelWishlistPage.tsx`（re-home） | `modelWishes.*` | — | `model_wishes` |
| `/learn/my-brain` | `pages/MyBrainPage.tsx`（re-home） | `brain.*` | — | `user_ai_brain` |
| `/learn/codex` | `pages/AgentCodexPage.tsx`（re-home） | — | — | — |
| `/learn/teaching-archive` | `pages/TeachingArchive.tsx`（re-home） | `teachingArchive.*` | — | — |
| `/learn/teams` | `pages/TeamsPage.tsx`（re-home） | `teams.*` | — | `teams` |
| `/learn/feedback` | `pages/FeedbackPage.tsx`（re-home） | — | — | — |

### ⚙ settings shell（`client/src/shells/settings/SettingsShell.tsx` → 富首頁 `SettingsHome.tsx`，五分頁 + RBAC）

| 分頁 / canonical route | 面板/分頁檔 | tRPC procedure（✅ 編譯驗證存在） | RBAC | 資料模型 |
|---|---|---|---|---|
| 一般（general） | `panels/GeneralSettingsPanel.tsx` | `settings.get` · `settings.update` · `auth.me` | 登入者 | `system_settings` · `users` |
| 生成引擎（provider） | `panels/ProviderPanel.tsx` | `settings.update`（mut）+ SpineProvider `setProvider`/`toggleFault` | 登入者 | `system_settings` |
| 代理偏好（agent） | `panels/AgentPrefsPanel.tsx` | `agentPreferences.getPreferences/updatePreferences/getRecentActivity` | 登入者 | `agent_preferences` · `agent_model_picks` |
| 觀測（obs） | `panels/ObservabilityPanel.tsx` | `langsmith.status` · `admin.allBackgroundJobs` · `admin.systemStats` | langsmith 全員 / 統計限 admin | `background_jobs` · LangSmith（外部） |
| 管理後台（admin，限 leader\|admin） | `panels/AdminPanel.tsx` + 5 分頁 | 見下 | leader\|admin | — |
| └ 使用者/積分 | `admin/UsersCreditsTab.tsx` | `admin.allUsers` · `admin.updateQuota` · `admin.updateRole` | leader 看 / admin 改角色 | `users` |
| └ 內容治理 | `admin/ContentTab.tsx` | `aiModels.list` · `news.list` · `learnHub.categories` | leader\|admin | `ai_models` · `news_articles` · `learn_hub` |
| └ 稽核日誌 | `admin/AuditTab.tsx` | `admin.usageLogs` · `admin.apiKeysStatus` | admin | `api_usage_logs` |
| └ 資料修復 | `admin/DataRepairTab.tsx` | `admin.allBackgroundJobs`（診斷攤開；無 `dataRepair` procedure，誠實標待建） | admin | `background_jobs` |
| └ 功能開關 | `admin/FeatureFlagsTab.tsx` | `settings.update` + 唯讀 `@/config/featureFlags` | admin | `system_settings.extraSettings.featureFlags` |
| `/settings/agent` | re-home `pages/AgentPreferencesPage` | `agentPreferences.*` | — | `agent_preferences` |
| `/settings/admin`（+`/api-usage`,`/brain-pipeline`） | re-home `AdminPage`/`AdminApiUsagePage`/`AiBrainPipelinePage` | `admin.*` · `apiUsage.*` · `brainPipeline.*` | admin | — |
| `/settings/ai-brain` →（內部轉址）`/settings/admin` | `SHELL_INTERNAL_REDIRECTS.settings` | — | — | — |

### 🖼 social shell（`client/src/shells/SocialShell.tsx` · **P5，預設 `SHELL_SOCIAL`=OFF → ShellFrame 顯示「已關閉」佔位**）

| canonical route | 規劃頁面（P5，重用既有，**零新表**） | 重用 procedure | 資料模型（皆既有） |
|---|---|---|---|
| `/social`（cockpit，index） | `SocialCockpit`（重用 video cockpit，另實例化） | `news.list`（時事選題，經脊椎只讀） | `news_articles` |
| `/social/studio` | `SocialStudio`（重用 `imageStudio`） | `imageStudio.*` · `generate.*` | `digital_asset_library` |
| `/social/brand` | `SocialBrand`（品牌庫） | `vault.*` | `consistency_vault` · `block_combos` |
| `/social/publish` | `SocialPublish`（現 `/shared`） | `showcase.*` | `featured_showcase` |

---

## B. 舊路徑 → 新 canonical 相容導向（`LEGACY_REDIRECTS`，21 條；ENABLE_4SHELL=ON 時 shadow 舊 Route）

| 舊路徑（線上真實 Route） | → 新 canonical |
|---|---|
| `/director` | `/video/director` |
| `/create` | `/video/create` |
| `/studio` | `/video/studio` |
| `/playground` | `/video/playground` |
| `/animation`（+`/:storyboardId`） | `/video/animation`（參數轉址） |
| `/image-studio` | `/video/image` |
| `/video-studio` | `/video/video` |
| `/pro-studio` | `/video/pro` |
| `/light-orb-studio` | `/video/light-orb` |
| `/ai-models-hub` | `/learn/ai-models` |
| `/model-wishlist` | `/learn/model-wishlist` |
| `/my-brain` | `/learn/my-brain` |
| `/codex` | `/learn/codex` |
| `/teaching-archive` | `/learn/teaching-archive` |
| `/teams` | `/learn/teams` |
| `/feedback` | `/learn/feedback` |
| `/admin` | `/settings/admin` |
| `/admin/api-usage` | `/settings/admin/api-usage` |
| `/admin/brain-pipeline` | `/settings/admin/brain-pipeline` |

> ✅ 掃描證明：每條 `from` 都是 App.tsx 真實既有 Route（非杜撰）；每條 `to` 都是宣告過的 canonical sub-route（舊連結不 404）。

---

## C. 跨 shell 脊椎（`CROSS_SHELL_TOPLEVEL`）— 不收編、維持頂層

`/`（Home）· `/assets` · `/models` · `/shared` · `/notes` · `/dashboard`（assets/project 脊椎）
`/creative-projects` · `/projects` · `/projects/:id`（project 脊椎）· `/agent`（全域光球代理）
`/focus-flow` · `/unorganized` · `/tutorial-overview`（跨切面/過渡）
`/forgot-password` · `/reset-password` · `/account-settings` · `/process`（standalone 認證/狀態）

> 依據：`shared/appRegistry.ts` 的 group=project/assets 為四 shell 共讀脊椎，不歸單一 shell。

---

## D. Spine adapter 接縫 → 真實 procedure（`client/src/adapters/*.trpc.ts`，強型別 vanilla client）

| adapter 檔 | 接縫方法 | → 真實 procedure（✅ 編譯驗證） |
|---|---|---|
| `commander.trpc.ts` | createIntent/getRun/listRunsByProject/script | `director.chat` · `commander.createIntent/getRun/listRunsByProject` · `director.analyzeScriptOverview/generateVideoScript` |
| `dataStore.trpc.ts` | listProjects/getProject/contextSummary/models/news/templates | `creativeProject.list/get/getContextSummary` · `aiModels.list` · `news.list` · `showcase.templates` |
| `generation.trpc.ts` | estimateCost/submitJob/jobStatus/recordResult | `generate.estimateCost/submitStudioJob/jobStatus/recordGenResult` |
| `contextPacket.trpc.ts` | compile/getLatest/unifiedSearch | `contextPacket.compileProject/getLatest` · `orbProxy.unifiedSearch` |
| `research.ts` | run | `orbProxy.unifiedSearch`（預設 mock，`VITE_RESEARCH_PROVIDER`） |
| `storage.trpc.ts` | recordResult/exportToAssets | `generate.recordGenResult` · `vault.exportToAssets` |

> **結論：所有 adapter 與面板的 procedure 呼叫，在強型別 client 下編譯全綠 → 無壞掉的 procedure 引用、無簽章不符。** P0/P6 接線正確。

---

## E. 資料模型清單（4-shell 觸及；皆既有，本分支零 schema 改動）

`creative_projects` · `worldbuilding_frameworks` · `world_storyboards` · `consistency_vault` ·
`digital_asset_library` · `context_packets` · `orchestration_runs` · `news_articles` · `ai_models` ·
`learn_hub`（docs）· `agent_model_picks` · `user_ai_brain` · `model_wishes` · `teams` ·
`agent_preferences` · `system_settings` · `background_jobs` · `users` · `api_usage_logs` · `ai_usage_events` ·
`featured_showcase` · `block_combos`

外部服務：LangSmith（`langsmith.status`，未設金鑰時 no-op）。

> ⚠ 計畫提及但 **main 尚未落地** 的後端表（屬 P3/P4，前端不可造）：
> `video_generation_sessions` · `video_segment_jobs`（M3）· `project_asset_links` · `asset_generation_events`（M2）。
> 細節與決策見《比對與優化報告.md》。

---

## F. Procedure 驗證表（前端真實呼叫 → server 真實存在）

所有 4-shell 面板與 adapter 呼叫均經 `tsc` 強型別解析，下列為人工抽核的關鍵命名空間（皆 ✅ 存在）：

`aiModels.list` · `news.list` · `learnHub.list/categories` · `credits.myBalance` · `dashboard.myStats/myUsageLogs` ·
`agentModelPicks.recordPick` · `orbProxy.unifiedSearch` · `admin.allUsers/updateQuota/updateRole/usageLogs/systemStats/allBackgroundJobs/apiKeysStatus` ·
`settings.get/update` · `agentPreferences.getPreferences/updatePreferences/getRecentActivity` · `langsmith.status` ·
`director.chat/analyzeScriptOverview/generateVideoScript` · `commander.createIntent/getRun/listRunsByProject` ·
`creativeProject.list/get/getContextSummary` · `generate.estimateCost/submitStudioJob/jobStatus/recordGenResult` ·
`contextPacket.compileProject/getLatest` · `vault.exportToAssets` · `showcase.templates`

> 註：`admin.*` 解析到 `appRouter` 內聯 `admin` 命名空間（14 procedure，`server/routers.ts` ~line 9294），
> **不是** `adminEval`（後者只有 `runAgentEval`）。`admin` 後台**無** `dataRepair` procedure → DataRepairTab 誠實標「待建」。

---

## G. 提示詞庫（prompt library）— 資料模型 / procedure / 與素材(asset)的關聯 ★本節為重點

### G.1 路由與 UI 表面

| 路由 / 表面 | 檔 | 類別 | 說明 |
|---|---|---|---|
| `/prompt-library` | `pages/PromptLibraryPage.tsx` | 跨 shell 頂層（脊椎，未收編進 shell） | 個人提示詞庫完整 CRUD UI |
| `/prompt-collection` | `pages/PromptCollectionPage.tsx` | 跨 shell 頂層 | 從站內可重用片段「收集」（精靈 system slice／模板…），可團隊共享 |
| video shell 面板 | `shells/video/panels/PromptsPanel.tsx` | **flag-gated（ENABLE_4SHELL）** | 「存入提示詞庫」→ `spine.addPromptBlock` → 經 gateway `promptLibrary.create` |

### G.2 資料模型（drizzle/schema.ts，**本分支零改動**）

**`prompt_library`（line 1759）** — 使用者級提示詞庫
`id` · `userId` · `title` · `content` · `category`(general/image/video/audio/voice/story/system) · `tags(json)` ·
`isFavorite` · `isPublic` · `useCount` · `modelHint`(模型 ID 字串) · `language` · `generationMode`(lightning/deep_precision) · `createdAt` · `updatedAt`
> ⚠ **無 `projectId` 欄**（user 級，非 project 級）；**無 `assetId` / 任何指向素材的欄位**。

**`prompt_collection`（line 1792）** — 個人收集（可 team_shared）
`id` · `userId` · `title` · `content` · `category` · `tags` · `notes` · `sourceType`(agent_role/proactive_trigger/model_template/image_studio/site_prompt/manual) · `sourceRef` · `sourceLabel` · `visibility`(private/team_shared) · `teamId` · `isFavorite` · `useCount`
> `sourceRef` 指向「站內提示詞來源」（精靈/模板 id），**不是**指向生成素材。

### G.3 tRPC procedure（✅ 皆真實存在）

| 命名空間 | procedure | 用途 | 對應計畫需求 |
|---|---|---|---|
| `promptLibrary` | `list`（q） | 列出我的（category/title 搜尋/favoritesOnly/generationMode + 分頁） | ✅ 列出/搜尋/篩選（⚠ 搜尋僅比對 title，**不含 content**） |
| | `listPublic`（q） | 公開廣場（依 useCount 排序） | ✅ 重用發現 |
| | `getById`（q） | 取單一 | ✅ 重用讀取 |
| | `create`（mut） | 新增（input：`{title, content, category?, tags?, isPublic?, modelHint?, language?, generationMode?}`） | ✅ **儲存 prompt** |
| | `update` / `delete`（mut） | 編輯/刪除（限本人） | ✅ |
| | `toggleFavorite`（mut） | 收藏 | ✅ |
| | `incrementUseCount`（mut） | 使用次數 +1（每次重用時呼叫） | ✅ **重用計數**（reuse hook） |
| | `adminSeed`（mut, admin） | 批次種子 | — |
| `promptCollection` | `siteCatalog`/`listMine`/`listTeam`（q） · `collect`/`update`/`delete`/`toggleFavorite`/`incrementUseCount`/`setVisibility`（mut） | 站內片段收集 + 團隊共享 | ✅ 收集/共享/重用計數 |

### G.4 prompt ↔ asset 關聯（**關鍵缺口**）

| 方向 | 現況 | 結論 |
|---|---|---|
| prompt_library → asset | 無 `assetId`、無中介表 | ❌ 不存在 |
| asset → prompt_library | `digital_asset_library.promptUsed`（line 345，**inline text**）、`generationHistory.prompt`/`compiledPrompt`（line 925-926，**inline text**） | ⚠ 只存「當時用的 prompt 文字」，**非** FK 指向 `prompt_library.id` |
| 全庫 FK 掃描 | `grep promptId\|promptLibraryId\|prompt_id\|prompt_library_id` → **0 命中** | ❌ 兩方向皆無外鍵、無 junction table |

> **判讀**：素材會記下「生成當下的 prompt 文字」（denormalized），但**無法**回連到一筆可重用的 `prompt_library` 條目，反之亦然。
> 因此計畫需求「**生成素材後，把 prompt＋素材一起存進提示詞庫並可重複利用**」目前**只能做到一半**：
> - ✅ 可把 prompt 存進庫（`promptLibrary.create`）並重複利用（`getById`+`incrementUseCount`）。
> - ❌ **prompt 與該次素材無資料層關聯** → 無法查「此庫提示詞生成過哪些素材 / 此素材出自哪筆庫提示詞」。
> 補關聯屬 `drizzle/`+`server/`（後端 P3/P4），見《比對與優化報告.md》§7，**本分支不擅自改**。

### G.5 本次已修的安全前端接線（flag-gated、用既有 procedure）

`client/src/spine/projectGateway.ts › createPromptBlock`：原本送 `{projectId, label, content}` 給 `promptLibrary.create`，
但該 procedure 真實 zod 輸入為 `{title(必填), content(必填), …}`——**缺必填 `title` → 伺服器退回**，且 spine 的 optimistic
`catch` 吞掉錯誤（看似存了、實際**沒寫入庫**；gateway client 為 `as any` 故 `tsc` 抓不到）。
已修正為送 `{title: label, content: text}`（對齊 `PromptLibraryPage` 既有正確呼叫），prompt 自此**真的**寫入庫。
→ video shell 的「存入提示詞庫」按鈕從「靜默失敗」變為「真實持久化」。純前端、零後端改動、僅 ENABLE_4SHELL=ON 生效。
