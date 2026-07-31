# Healing Studio 網站知識庫補充（2026-05-23・程式碼同步輪）

> 本文件是 Notion 知識庫《Healing Studio 網站知識庫（2026-05-23）》
> （<https://www.notion.so/369b7d0ed73a813c83c4fb34eac70e22>，子頁 01–27）的
> **程式碼同步補充**。Notion 版本是用一份「非 git 的本機快照」建立的，當時許多檢查
> （typecheck、test、git 狀態）無法執行；本輪改以**實際 git repo** 為來源重新比對，
> 補上快照之後的變更與可驗證狀態。
>
> - 來源 repo：`aa0968111723-prog/healing-studio`，分支 `claude/amazing-cori-4ZxXa`（default `main`）
> - 對應 commit：`1238d40`（2026-05-23 14:50 +0800）
> - 維護規則：依 Notion 既有「1-27 合併矩陣」歸位，能併入既有頁就不另開新頁。
> - 安全：只記錄變數名稱、架構用途與健康狀態，不寫入任何 secret 值。

---

## 本輪可驗證狀態（補 Notion 27 / 11 頁的空白）

Notion 快照當時：`tsc` 不存在、`node_modules` 不存在、本機非 git repo，故 typecheck/test/git 都「無法執行」。本輪在完整環境重跑：

| 檢查 | 指令 | 結果 |
|---|---|---|
| 依賴安裝 | `npm install` | ✅ 乾淨完成（`.npmrc`：`legacy-peer-deps=true`、`loglevel=error`；Node v22.22.2、npm 10.9.7） |
| 型別檢查 | `npm run typecheck`（`tsc -p tsconfig.json --noEmit`） | ✅ **通過（exit 0）**——這是 Notion 快照無法完成的 P0 |
| 路由掃描 | `npm run check:routes` | ✅ 通過：**54 路由 / 79 registry / 38 PageAgent** 對齊（與 Notion 紀錄一致） |
| Smoke | `npm run check:smoke` | ⏸️ 仍未實際 probe，需設 `SMOKE_BASE_URL` |
| 單元/整合測試 | `npm test`（vitest） | ⏸️ 需完整環境（`DATABASE_URL`、各 provider 金鑰）才有意義，本輪未跑全套 |
| git 狀態 | `git status` | ✅ 本輪來源即為 git repo，working tree clean |

**結論**：Notion 27 頁列為 P0 的「typecheck」已可標記為通過；「全套 test / smoke」仍待完整環境。

---

## 快照後重大變更摘要（2026-05-22 ～ 05-23）

依 git log 確認、且各自有程式碼佐證的新內容：

1. **導演 AI（Director AI）× 世界觀一條龍整合**（PR #842, `841567a`）—— `/director` 成為獨立、最佳化過的大型子系統。
2. **M1-A Active Project Context 地基**（`8e1f658`）—— 全站「當前專案」context 的前端骨架。
3. **架構第八原則：CreativeProject 為主幹、環環相扣**（`ddf8be3`，`docs/ARCHITECTURE.md`）。
4. **AI 創作作業系統 Phase 1 平台骨架**（`259b2da`）＋ CreationHub 入口（`0e41992`）。
5. **主選單瘦身為 4 項，其餘移到「未整理區域」`UnorganizedArea`**（`545de4b`），並陸續補回多個遺失側邊欄入口（`ad14fbc`、`b3d27f5`、`e772d47`）。
6. **影片專案聚焦**：移除快速開始/詢問光球/六大系統入口、移除「影片世界觀」選單項（`12c60aa`、`dd333a9`、`f424167`）。
7. **worldbuilding `generateCharacter`/`generateScene` 改為真實 LLM 呼叫**（`758fce2`）。
8. **部署修復**：`require("ws")` 改回 ESM import 修生產啟動失敗（`bf03cf7`）；core 啟動 ws typings 修正（`6a4b08c`）。
9. **資料庫 migration 修復**：real-earth migration 改為 idempotent 且在 MySQL 合法（`3ec2d4e`）；timeline/composition SQL 拆成多語句（`221535b`）。

---

## 規模與檔案分布更新（補頁 01 / 22）

| 區域 | Notion 快照 | 本輪實際（git ls-files） |
|---|---|---|
| `client/src` | 369 | **373** |
| `server` | 492 | **495** |
| `shared` | 106 | 106 |
| `tests` | 97 | 97 |
| `docs` | 86 | 86 |
| `drizzle` | 84 | 84 |
| 掃描/追蹤總檔數 | ~1,278 | **1,317（git 追蹤）** |

`client/src/pages` 目前 **55** 個頁面元件（含 `admin/`、`settings/` 子目錄）。

---

## 依頁面補充（對應 Notion 01–27）

### 01 系統總覽與技術棧
- 技術棧確認：Node **v22**、Vite、React 19 + `@react-three/fiber` 9 / `drei` 10、tRPC 11、TanStack Query 5、Drizzle（**MySQL**）、Tailwind + Radix/shadcn、XState 6、`@xyflow/react` 12。Build：`vite build` + `esbuild` 打包成 `dist`，啟動 `node dist/index.js`。
- 新增的「全站心智模型」核心原則第八條（CreativeProject 主幹）已寫入 `docs/ARCHITECTURE.md:31`，是本輪最重要的架構心法（見頁 12）。

### 02 前端路由與頁面
- 路由掃描維持 **54 路由 / 79 registry / 38 PageAgent** 對齊（`scripts/scan-routes.mjs`）。
- 新增頁面（快照後）：`CreationHub.tsx`、`CreativeProjectPage.tsx`、`DirectorAI.tsx`、`LightOrbCreationStudio.tsx`、`ProjectsListPage.tsx`、`ProjectDetailPage.tsx`、`FocusFlowPage.tsx`、`TutorialOverviewPage.tsx`、`UnorganizedArea.tsx`（「未整理區域」收納頁）。
- 入口：`CreationHub.tsx` 是創作系統（含 Director AI）的進入點。

### 03 後端 API 與執行管線
- 模組化 router 目錄 `server/routers/` 共 **41 檔**，主要 router：`adminRouter`、`brain`、`brainPipeline`、`creativeProject`、`director`、`aiModels`、`apiUsage`、`imageStudio`/`videoStudio`/`proStudio`、`learnHub`、`loraTrainer`、`orbProxyRouter`/`orbSchedulerRouter`/`orbCapabilitiesRouter`/`orbConversationsRouter`、`sense`、`spiritRouter`、`teachingArchive`、`teams`、`worldbuilding`/`worldStoryboard`、`realEarth`、`promptLibrary`/`promptCollection`、`showcase`、`news` 等。
- `server/services/` 高達 **177 檔**（service 層極厚）；`server/routes/` 18、`server/jobs/` 13、`server/_core/` 37、`server/middleware/` 2、`server/ws/` 2、`server/repositories/` 4、`server/subsystems/` 2。
- 排程/背景任務（`server/jobs/`）：`apiHealthMonitor`、`apiUsageAlertJob`、`braveLearnFetcher`、`circuitBreaker`、`learnDocSyncer`、`mediaArchivalCron`、`modelCatalogResearchJob`、`modelTrainingWorker`、`newsFetcher`、`providerSnapshotJob` 等。
- 非 tRPC HTTP：`/api/health`、`/api/metrics`、`server/uploadRoute.ts`、`server/sseRoute.ts`；ws 啟動修正見 `bf03cf7`/`6a4b08c`。

### 04 AI 大腦、Orb 與生成系統
- **Provider 模型大改：OpenRouter 成為「統一 LLM 閘道」首選。** auto 路由優先序為 **openrouter > anthropic > gemini > nvidia > vertex > forge**（`.env.example` 明列）。
  - 預設 **Claude Haiku 4.5**（快、便宜、tool use 強），重大規劃自動 fallback。
  - 模型 ID 採 `<provider>/<model>`：`anthropic/claude-sonnet-4.6`、`anthropic/claude-haiku-4.5`、`anthropic/claude-opus-4.7`、`google/gemini-2.5-pro`、`openai/gpt-4o`、`meta-llama/llama-3.3-70b-instruct`。
  - 裸 `claude-*` / `vertex-*` 等 ID 會由 `inferEngineFromModelIdSafe` / `normalizeModelForEngine` 自動重寫為 OpenRouter 等效路徑——**只要設 `OPENROUTER_API_KEY` 就能透通使用 Gemini / Llama / Imagen，不需直連各家帳號**。
  - `LLM_ENGINE` 可覆蓋：`auto` / `openrouter` / `anthropic` / `gemini` / `vertex` / `nvidia` / `forge`。NVIDIA NIM 預設 MiniMax M2.7，catalog 另含 Llama Nemotron Ultra 253B / Super 49B v1.5。
- 模型目錄主檔 `shared/aiModelsCatalog.ts`（5,386 行）；定價 `server/services/modelPricing.ts`（3,500 行）。
- **worldbuilding 生成已接真實 LLM**：`generateCharacter`/`generateScene` 不再是 stub（`758fce2`，`server/worldbuilding-generation.test.ts`）。
- 效能護欄環境變數：`LLM_TIMEOUT_SECONDS`（預設 60，所有 LLM HTTP 的 AbortSignal）、`MAX_CONCURRENT_LLM_CALLS`（預設 5，超過排隊，`server/_core/llmConcurrency.ts`）、`CACHE_TTL_SECONDS`（預設 300）、`SENSE_INTENT_TIMEOUT_SECONDS`（預設 45，`server/routers/sense.ts`）。

### 04＋ Director AI（導演 AI）—— 快照後新主題，併入頁 04 / 24
新增獨立子系統 `/director`，文件見 `docs/director-ai-architecture.md`。要點：
- **雙引擎 RAG**：Sonar 研究引擎（Perplexity，帶 `researchStyle`）→ CO-STAR 創意引擎（依 `directorStyle` 輸出結構化腳本）。主函式 `runDirectorAI` 位於 `server/services/director/costarService.ts`。
- **Personality 三層系統**：server tonal prompts（`server/services/director/personality.ts`，含 `researchStyle`/`directorStyle`/`proactiveHint`/`systemPreamble`）＋ client UI hint。三種人格：`calm`、`creative`、`technical`。
- **三種操作模式**：`chat`、`script`（腳本分析）、`planning`（長腳本規劃），各對應一組 `director.*` procedures。
- **整理歷程**：把 4 個巨型檔（11,352 行）拆成 **7 個 service 檔 + 5 個 UI 元件檔**，並集中 personality prompts。
- tRPC namespace `director:`；新元件在 `client/src/components/director/`（`WorkflowStepper`、`WorldbuildingPanel`、`WorldbuildingInlineEditor`、`ScriptGeneratePanel`、`BatchGenerationDialog`、`PlanningSessionItem`、`SessionItem`、`QuickActionChip` 等）；server 服務 `server/services/director/{costarService,planningService,personality,exportFormats}.ts`；測試 `server/__tests__/director/*`、eval `server/eval/cases/delegationFromDirector.eval.ts`。

### 05 / 25 資料庫與 Schema 全域盤點
- **表數修正：實際 78 張 `mysqlTable`**（`drizzle/schema.ts`，3,749 行），Notion 記的「76」需更新為 **78**。ORM 引擎為 **MySQL**（`mysqlTable(...)`）。
- 與「CreativeProject 主幹」相關的近期表：`creative_projects`（含 `directorSessionId`、`worldFrameworkId`、`worldStoryboardId` 等欄）、timeline/composition、worldbuilding frameworks/era。
- JSON 欄位（仍缺 runtime schema 驗證，列為風險）：worldbuilding、studioRecipes、orbMemory 等。

### 26 Migration、資料完整性與風險
- **migration .sql 共 71 個**，編號 `0000` → `0069`。最新幾個：`0069_creative_projects_worldview_script`、`0068_creative_projects_bootstrap`、`0067_creative_projects` / `0067_repair_worldbuilding_v4_columns`、`0066_teaching_materials_real_earth_refs`、`0065_real_earth_information_system`、`0064_timeline_frames_and_compositions`。
- **風險（新增）：migration 編號有重複** —— `0008`、`0033`、`0067` 各出現兩個檔名，套用順序需以 drizzle meta journal 為準，建議盤點避免亂序。
- 近期修復：`3ec2d4e` 使 real-earth migration idempotent 且 MySQL 合法；`221535b` 將 timeline/composition 拆成多個 SQL 語句（修 migration 失敗）。
- **`drizzle/relations.ts` 實際只有 1 行（幾乎為空）** —— 直接證實 Notion P1「補核心 relations」待辦；目前 ORM 關聯多靠應用層維護，孤兒資料風險仍在。

### 06 設定、部署與營運
- `.env.example` 共 **71 個宣告變數**，分組：核心平台 / 效能調節 / Google OAuth / 資料庫(MySQL) / 管理員信箱 / OpenRouter / Anthropic / Google AI Studio / Vertex AI / LLM 引擎選擇 / 向後相容(Manus) / 地圖代理 / 圖片影片生成(Fal.ai)。
- 安全相關：`AUTH_SECRET` 會被 self-repair 自動 rename 成 `JWT_SECRET`；密碼雜湊 `PASSWORD_HASH_ALGO`（scrypt/bcrypt/argon2，預設 scrypt）；**Fal.ai webhook 用 HMAC-SHA256 簽章密鑰，且必須與 `FAL_API_KEY` 不同**。
- 部署：Dockerfile + Railway，build = `vite build` + esbuild bundle → `dist`，start = `node dist/index.js`。

### 07 / 27 測試、風險與驗證
- 本輪驗證閉環見本文件最上方表：**typecheck 通過、routes 對齊、deps 乾淨**。
- 仍待：完整環境下 `npm test`（vitest）與 `npm run check:smoke`（需 `SMOKE_BASE_URL`）。
- `drizzle/relations.ts` 近乎空、migration 編號重複，列為 P1 資料完整性待辦。

### 08 GitHub 遠端 Repo 與架構根文件
- 新增/更新的根架構文件：`docs/ARCHITECTURE.md`（加入 vision 與「影片系統垂直切片計畫」、第八原則）、`docs/director-ai-architecture.md`、`docs/ASSISTANT_ARCHITECTURE.md`、`docs/agent/ARCHITECTURE_DEEP_DIVE.md`、`docs/plans/worldview-system-enhancements.md`。
- 文件與程式碼衝突時，仍以程式碼為準再回頭更新文件。

### 12 完整網站架構地圖（核心心法）
`docs/ARCHITECTURE.md:31` 第八原則：**CreativeProject 是主幹，所有子系統環環相扣**。
- 每個子系統都從同一個 `creative_projects` 讀「目前 project context」（worldFramework、style、LoRA、negativePrompt、credits budget），輸出（assets、generation 紀錄、agent 任務）都寫回該 project。
- pattern 化的接點：`loadProjectContext()`、`appendToProjectAssets()`，以及 consistency / budget / agent task 注入點。
- 已知半綁定（待補的垂直切片）：`creative_projects` 有 `worldStoryboardId` 但沒人讀；segment→video 對應尚未持久化（對應 Notion 頁 11 高優先待辦 #5）。

### 13 / 14 / 15 UI / UX / 使用者動線
- **選單瘦身**：主選單縮為 4 項，其餘收進 `client/src/pages/UnorganizedArea.tsx`（「未整理區域」）。
- 側邊欄補回：數位資產庫、模型訓練中心、創作專案、共享空間、專注流、教學總覽等入口。
- 新增 layout 元件：`PageHeader`、`SectionCard`、`AdvancedSection`、`NextStepPanel`、`ProjectSelector`，視覺密度工具 `client/src/lib/visualDensity.ts`。
- 首頁視覺：`CosmicBackdrop`、`OrbCreationStage`、`OrbFloatButton`、`CreationHubSections`。
- 使用者動線新主幹：CreationHub →（選/建）CreativeProject → 世界觀 → 腳本（Director AI）→ 分鏡 → 素材，與架構主幹一致。

### 16 開發者文件與維護手冊
- 本機啟動：`npm install`（需 `legacy-peer-deps`，已寫在 `.npmrc`）→ `npm run dev`（`tsx watch server/_core/index.ts`）→ DB 用 `npm run db:push`（`drizzle-kit migrate`）。
- 驗證指令：`npm run typecheck`、`npm run check:routes`、`npm run check:navigation`、`npm test`、`npm run test:e2e`。
- 既有審計腳本：`scripts/audit-25-spirits.mjs`、`scripts/simulate-director-orb.mjs`、`scripts/audit-music-voice-studio.mjs`、`scripts/audit-12-roles.mjs`、`scripts/check-internal-navigation.mjs`。
- 新增/改頁/改 API 的 checklist 不變（同步 `App.tsx`、app registry、brainPipeline mapping、route scan）。

### 23 程式碼熱點與模組邊界（更新）
最大檔（`wc -l`，本輪實測）：

| 檔案 | 行數 |
|---|---|
| `server/routers/learnHub.ts` | **12,837**（已超越 routers.ts，成為第一大檔） |
| `server/routers.ts` | 9,622 |
| `server/services/agentToolExecutor.ts` | 7,903 |
| `client/src/pages/AnimationStudio.tsx` | 6,868 |
| `client/src/contexts/GlobalOrbChatContext.tsx` | 6,563 |
| `client/src/pages/DirectorAI.tsx` | 6,047 |
| `shared/aiModelsCatalog.ts` | 5,386 |
| `client/src/pages/ImageStudio.tsx` | 5,321 |
| `client/src/pages/VideoStudio.tsx` | 5,190 |
| `client/src/pages/ProStudio.tsx` | 4,991 |

拆分建議優先序更新為：`learnHub.ts` → `routers.ts` → `agentToolExecutor.ts` → 各 Studio 大頁。

### 17–21 新手小白導讀（白話補充）
- **當前專案（Active Project Context）**：可以想成「桌上正在做的那個案子」。系統各處（生成圖、生成影片、問光球）都會先看「現在桌上是哪個案子」，再把世界觀、風格、預算自動帶進去；做出來的東西也收回同一個案子。程式入口：`client/src/hooks/useActiveProject.ts`、`client/src/contexts/ProjectsContext.tsx`、`client/src/components/create/ActiveProjectContextPanel.tsx`。
- **導演 AI**：像一位會先查資料（Perplexity）再幫你寫腳本（CO-STAR）的導演，可選 calm/creative/technical 三種性格，有聊天、腳本分析、長片規劃三種模式。
- **「未整理區域」**：選單瘦身後，比較少用的入口都先搬到這裡，不是刪掉，找不到功能時先來這頁。

### 22 第三輪深度盤點摘要（補：來源升級）
本輪與 Notion 第三輪最大差異：來源由「本機非 git 快照」升級為**實際 git repo + 可執行環境**，因此 typecheck/route-scan/deps 都實跑驗證；表數、檔數、熱點檔均以實測更新。

---

## 給 Notion automation 的歸位提示
- 表數 76 → **78**：更新頁 05 / 25。
- typecheck P0 → **通過**：更新頁 11 / 27。
- Director AI、Active Project Context、CreativeProject 主幹：併入頁 04 / 12 /（新手）20，動線併頁 15。
- 選單瘦身、未整理區域、側邊欄補回：併入頁 02 / 13 / 14 / 15。
- 熱點檔 learnHub.ts 第一：更新頁 23。
- relations.ts 近乎空、migration 編號重複：更新頁 26。
