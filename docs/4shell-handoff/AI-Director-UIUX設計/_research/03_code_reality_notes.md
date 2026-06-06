# 03 · 程式碼現況校正筆記（Code-Reality Notes）

> 來源：`AI-Director_GitNexus深度整合分析.md`（撰寫日 2026-06-06，read-only 程式碼情報層）
> 工具：**GitNexus v1.6.5**（MCP-native 程式碼知識圖譜；Tree-sitter AST → 依賴/呼叫鏈/影響分析；LadybugDB 圖儲存）
> 事實基準：`git clone --depth 1 https://github.com/aa0968111723-prog/healing-studio`，**main HEAD `2888a36`（2026-06-04）**
> 圖例：**✅**=圖譜佐證／**⚠**=校正／**❌**=確認缺口或原名不存在／**◑**=部分（語意需校正）
> 用途：作為 UI spec 的**事實校驗層**——真實路由、頁面元件、tRPC routers/procedures、資料模型、已知問題/限制。

---

## 1. Repo 真實規模（HEAD `2888a36`）

| 面向 | 數字 | 備註 |
|---|---|---|
| client TS/TSX | **381** 檔 | — |
| server TS | **514** 檔 | — |
| shared TS | **105** 檔 | — |
| 合計 | 約 **1,000** 檔 | — |
| App.tsx 路由 | **54** `<Route>` | 集中在一檔 |
| router 檔 | **34** router 檔 | `server/routers/*.ts` |
| appRouter 頂層 namespace | **68** | — |
| drizzle 資料表 | **82** 張 `mysqlTable` | **目前是 MySQL（mysqlTable），非 PG** |

> **交叉確認**：54 路由 / 68 namespace / 82 表這三個數字**與整合包文件完全吻合**，GitNexus 圖譜量測已交叉確認。

> ⚠ **重要 schema 事實**：drizzle 目前用 **`mysqlTable`**（MySQL）。社群設計文件提到的 Tier-1 新表「P3 之後建在 PG、用 `jsonb`/`pgEnum`/`timestamptz`」是**未來目標**，不是現況——現況仍是 MySQL。任何 UI spec 假設 PG 型別前須先確認 P3 Supabase parity 是否完成。

---

## 2. GitNexus 索引結果（執行成功）

分段索引（受沙盒 45 秒時限），兩段皆成功：

| 索引範圍 | 檔數/行數 | 結果 |
|---|---|---|
| 客戶端脊椎（App.tsx + contexts + config + hooks + 殼層元件） | 48 檔 / 12,495 行 | 1,493 nodes｜2,012 edges｜46 clusters｜44 flows |
| 伺服器代理層（director + commander + contextPackets + creativeProject + worldStoryboard + services/director） | 24 檔 / 10,319 行 | 911 nodes｜1,487 edges｜27 clusters｜73 flows |
| 基準量測 shared/ | 106 檔 | 4,027 symbols / 6,083 edges / 241 flows |

**沙盒限制**：FTS 全文索引與 onnxruntime 語意嵌入在沙盒降級（`Could not establish connection` to `extension.ladybugdb.com`），**不影響結構圖譜**（impact/context/cypher 全可用），只影響語意 `query` 模糊比對。本機跑可開啟完整嵌入/FTS。

---

## 3. 客戶端 4-shell 拆分藍圖（真實 import 圖）

### 3.1 最關鍵發現：頁面之間零耦合

在 `client/src/pages/`（**65 頁**）量到：

- **✅ 跨頁 import = 0**：**沒有任何一頁 import 另一頁**。頁面是「葉節點」，彼此不相依。
- **✅ DashboardLayout 只被 1 處 import（App.tsx）**：殼層外框集中掛在路由層，不散在 65 頁。
- **✅ 僅 5 頁**直接用 active-project 脊椎（`ProjectsContext`/`useActiveProject`）：`ProjectsListPage`、`ProjectDetailPage`、`CreationHub` 等。

> **結論**：把一頁移進某 shell 的 **blast-radius ≈ 0**——不牽動其他頁。4-shell 重整真正工作集中在**一個檔：`App.tsx`（54 路由）＋ `DashboardLayout` 參數化**。與架構 §1.5.5「換外框＋設前綴＋改導覽，不動資料模型」**完全一致，且風險被圖譜證實為低**。

### 3.2 Provider/Context 掛載拓撲（SpineProvider 要包誰）

```
main.tsx
└─ trpc.Provider › QueryClientProvider › AIStateProvider › <App/>
App.tsx  ←★ provider 掛載樞紐（一檔 import 15 個 context）
├─ ProjectsContext(active-project) · WorldContextContext · PersonalSettingsContext
├─ PersonalityContext · AIStateContext · ThemeContext · FocusFlowContext
├─ IntentCardContext · NotesDrawerContext · AssetsDrawerContext · OrbGuideContext
├─ OrbStateContext · PageAgentContext · ShowcaseTransferContext · SiteOnboardingContext
DashboardLayout.tsx  ←★ 共用 chrome（消費 AmbientSound/BackgroundTasks/PersonalSettings/SiteOnboarding）
AppleDock.tsx → BackgroundTasksContext · ThemeContext
CommandPalette.tsx → SiteOnboardingContext   WorldContextSidebar.tsx → WorldContextContext
```

**最被依賴（共用）的脊椎模組**（incoming IMPORTS，scope 內）：`PersonalSettingsContext ×4`、`SiteOnboardingContext ×3`、`WorldContextContext ×3`、`appRegistry ×3`、`useMobile ×3`、`const.ts ×3`、`BackgroundTasksContext / AIStateContext / ThemeContext / ProjectsContext ×2`。

> **SpineProvider 指示**：上列被多處 import 的 context **必須掛在 4 shell 之上的脊椎層（單一實例，不複製）**——尤其 `ProjectsContext`(active-project)、`PersonalSettingsContext`、`ThemeContext`、`BackgroundTasksContext`、`AIStateContext`。只被單一殼層用的（如 `WorldContextContext` 多為 `/video`）可下放到該 shell。

### 3.3 ⚠ 真實循環依賴（抽脊椎前要先拆）

GitNexus cypher 偵測到一個 **2-node 循環**：

```
PersonalSettingsContext.tsx  ⇄  useMobile.tsx     （互相 import）
```

`PersonalSettingsContext` 同時是**最被依賴的脊椎 provider（×4）**，卻與 `useMobile` 互相依賴。抽 SpineProvider 時這條循環會跟著被拉到脊椎層，可能造成初始化順序/HMR 問題。→ **建議**：抽脊椎前先打斷此環（把 `useMobile` 對 `PersonalSettings` 的依賴改為參數注入或下沉到共用 util），列為 4-shell 重整的**前置整理項**。

---

## 4. ✅ 已驗證的收編機制（現況如架構所述）

| 機制 | 文件主張 | 真實程式碼（HEAD `2888a36`） | 判定 |
|---|---|---|---|
| `appRegistry.group` 作 shell 對映依據 | 每頁標 group | `shared/appRegistry.ts`：實際 group＝`create(9) / project(9) / learn(9) / settings(9) / assets(7) / orb(3) / train(1)`；型別另含 `admin/management/...` | ✅ |
| `SIDEBAR_GROUPS` 空 | `[]` 待填 | `export const SIDEBAR_GROUPS = [] as const` | ✅ 完全吻合 |
| Dock 白名單硬塞 4 頁 | `create/assets/director/teaching-archive` | `VISIBLE_DOCK_PAGE_IDS = new Set(["create","assets","director","teaching-archive"])` | ✅ 完全吻合 |
| 路由集中、相容導向 | 改 App.tsx＋NavigateRedirect | App.tsx 集中 54 `<Route>`；`NavigateRedirect` 存在 | ✅ |

> **關鍵單一真相源**：`appRegistry` 在 **`shared/`**（被 client 與 server 共讀，server 還 `serializeRegistryForSiteKnowledge` 餵給 brain/director）。**shell 對映表改在 `shared/appRegistry.ts` 一處，前後端與 AI 知識同步生效**——脊椎級單一真相源。

---

## 5. Shell 抽出順序（blast-radius + 完成度）

| 順位 | Shell | blast-radius | 風險 | 理由/先決條件 |
|---|---|---|---|---|
| **1** | `/settings` | 頁面零跨頁耦合；多為讀 `system_settings/agent_preferences` | 🟢低 | 治理頁彼此獨立、最少脊椎寫入，先抽建立 shell 樣板 |
| **2** | `/learn` | 同上；`LearnHub`(434KB) 雖大但**葉節點**，不被其他頁 import | 🟢低 | 內容/帳務/模型頁互不依賴；只讀脊椎 `news/aiModels/credits` |
| **3** | `/video`（旗艦） | 頁面零跨頁耦合，但**重度消費脊椎**（active-project/world/vault/generate） | 🟡中 | 等脊椎共用 provider 先抽穩；含 M3 缺口（見 §7） |
| **4** | `/social` | **0 專屬實作＝新建**，無既有 blast-radius | 🟡中 | 重用 `/video` cockpit 元件實例化；待 M3 證明後 |
| **前置** | SpineProvider 抽出 | §3.2 共用 provider＋§3.3 循環 | 🟠 | **先打斷 `PersonalSettingsContext⇄useMobile` 環**，再把共用 provider 提到脊椎層 |

> **抽出鐵則**：因跨頁 import=0，可**逐頁搬移**不破壞他頁；唯一要單一實例化的是脊椎 provider 與 DashboardLayout→4 shell 參數化。順序：`/settings`→`/learn`（葉、低耦合）→`/video`（重脊椎）→`/social`（新建）。

---

## 6. ⚠ Adapter → tRPC procedure 校正（對照真實 call graph）

> 整合包 `adapter對應表.md` 自註：除 `director.*`（逐一列 33）外，其餘 procedure 名為**「建議命名」**。本節逐一比對 `server/routers/*.ts` ＋ `server/routers.ts`（**9,650 行 god file**，內含約 30 個 inline router）＋ `server/subsystems/*` 的真實 procedure 定義。

### 6.1 ✅ 已驗證正確的對應

- **`director` 命名空間 = 33 procedures**（top-level 31 ＋ `preferences.{get,update}` 2）。
- `director.chat` ✅、`director.estimateSegmentCost` ✅、`director.generationModels` ✅、`director.analyzeScriptOverview` ✅、`director.importScript` ✅、`director.generateVideoScript` ✅
- **`director.breakdown` 確認不存在（待建 M3）** ✅
- `creativeProject.list/create` ✅、`aiModels.list` ✅、`news.list` ✅、`notes.create` ✅、`promptLibrary.create`/`customBlocks.create`/`blockCombos.create` ✅、`orbProxy.unifiedSearch` ✅、`contextPacket` 子系統（`compileProject`）✅、`commander` 子系統 ✅
- **`showcase.templates` 確認不存在＝社群版型待建** ✅（與對應表 ◑ 一致）

### 6.2 ❌/⚠ 需校正的對應（真實 procedure 不同名／不存在）— 16 項

| Adapter 方法 / Spine action | 對應表原列 | **真實 procedure（校正）** | 校正類型 |
|---|---|---|---|
| **GenerationAdapter.generate(image)** | `imageStudio.generate`（加 provider/seed） | **無 `imageStudio.generate`**。統一入口是 inline **`generate.*`**：`generate.estimateCost → prepareJob / submitStudioJob → jobStatus / checkStudioJob → recordGenResult`；底層 `imageStudio.<model>`（28 個逐模型 procedure） | ❌原名不存在→改接 `generate.*` |
| **GenerationAdapter.generate(video)** | `videoStudio.generateSegment`（待建 M3） | `videoStudio` **已有 ~29 個逐模型 i2v/t2v**。**待建的不是「生成」，是包住它們的 session/segment 狀態機**（`generateSegment` 確不存在） | ◑語意校正：生成已在，缺 orchestration |
| **GenerationAdapter.generate(audio)** | `proStudio.generateAudio` / `proStudio.tts` | 無此二名。音樂＝`proStudio.textToMusic` / `generateMusicSuno` / `compiledTextToMusic`；TTS＝`proStudio.elevenLabsTTS` / `qwenTTS` / `qwenVoiceDesign`；另有 `soundEffects / voiceChanger / dubbing / speechToText` | ❌改名 |
| **（LoRA 訓練）** | `loraTrainer.train`（→HF Jobs） | `loraTrainer.trainWithReplicate`（+ `replicateTrainingStatus / trainingHistory / trainingDetail`）；使用者自有模型管理在 inline **`models.*`**（`myModels / create / retrain / trainingStatus / syncReplicateStatus`） | ❌改名（現走 **Replicate**，待轉 HF） |
| **ResearchAdapter.run** | `sense.research` / `orbProxy.unifiedSearch` | **`orbProxy.unifiedSearch`**（✅）。**`sense` 只有 `inferIntent`，無 `research`**；情報清單走 `news.list`（非 `sense.feed`） | ❌`sense.research` 不存在→定錨 `orbProxy.unifiedSearch` |
| **AgentAdapter.commanderPlan** | `commander.plan()` | **`commander.createIntent`**（+ `getRun / listRunsByProject`）。**無 `commander.plan`**（唯一 `plan:` 在 `spiritRouter`，非 commander） | ❌改名 |
| **AgentAdapter.breakdownScript** | 過渡＝`analyzeScriptOverview`+`generateVideoScript`+**`generateVideoScriptFromBrief`** | 前兩者 ✅ 在 33 中；**`generateVideoScriptFromBrief` 不存在**（對應表誤列「✅在33中」）。真實近親另有 `generateSegmentCostar / batchGenerateCostar / autoGenerateFromSegments` | ⚠原表誤列一項 |
| **ingestBreakdown** | `worldStoryboard.bulkUpsert` | **`worldStoryboard.createFromSegments`**（正是「由分段批次建分鏡」）＋ `create / planPipeline / seedSkeleton`。**無 `bulkUpsert`** | ❌改名（真實名更貼切） |
| **rebuildPacket** | `contextPacket.compile` | **`contextPacket.compileProject`**（+ `getLatest / setProjectAccessRules / listProjectAccessRules`）。無 `compile` | ❌改名 |
| **approveShot / toggleLock / uploadReference** | `vault.setApproval` / `setLocks` / `upsertCharacter` | **`vault` 僅 CRUD**（`create / update / delete / list / exportToAssets`）。approval/鎖臉/角色升級**皆走 `vault.update`**，無專屬 procedure（語意需在 payload 表達或後端擴充） | ❌三個專屬名皆不存在 |
| **assignBrain（五腦指派）** | `agentModelPicks.assign` / `aiModels.assignBrain` | **`agentModelPicks.recordPick`**（+ `markAcceptance / getPreferredForModality / getPreferredByModalities`）。二原名皆不存在 | ❌改名 |
| **spendCredits / 用量記帳** | `credits.spend` / `apiUsage.record` | `credits` **僅 `myBalance / pricingCatalog`**（無 `spend`；扣點為伺服器內部，非前端 procedure）；用量＝**`apiUsage.upsert`**（+ `billing / overview / usageByProvider / deepCost`），無 `record` | ❌改名／改層 |
| **topUpCredits** | `credits.topUp` | 無 `credits.topUp`（儲值走 `plans.*` / subscription 流程） | ❌不存在 |
| **adminAdjustCredits** | `admin.adjustCredits` | **`admin.updateQuota`**（+ `runAutoCreditNow / updateAutoCreditPolicy`） | ❌改名 |
| **adminToggleUser** | `admin.toggleUser` | **`admin.updateRole`** | ❌改名 |
| **adminSetFlag** | `settings.setFlag` / `admin.setFlag` | **`settings.update`**（settings 僅 `get/update`，無 `setFlag`） | ❌改名 |
| **adminDataRepair** | `admin.dataRepair` | **不存在**（admin 14 procedure 無 dataRepair；修復需走 `background_jobs` 或待建） | ❌確認缺口 |

### 6.3 ⚠ 命名空間掛載陷阱（重要）

- **`admin` 在 appRouter 掛兩次**——`adminEval: adminRouter`（imported，評測相關）＋ inline **`admin: router({...})`**（14 個治理 procedure）。對應表的 `admin.*` 應指向 **inline `admin`**，不是 `adminEval`。
- **inline router（在 `routers.ts` god file 內，不在獨立檔）**：`credits / vault / notes / settings / studio / assets / history / generate / ai / models / plans` 皆為 **`routers.ts` 內的 inline router**，不在 `server/routers/*.ts` 獨立檔——這是為何「逐檔 grep router 檔」會找不到它們、**必須讀 9,650 行 god file**。

---

## 7. M3 缺口的精確描述（最重要的「待建」澄清）

> **M3「影片垂直切片」缺的不是生成能力，是 orchestration 狀態機。**

- **缺的是**：`video_generation_sessions` / `video_segment_jobs` **兩張表** ＋ 包住現有 `videoStudio.<model>` 逐模型生成的**狀態機**（`generateSegment`）。
- **不缺的是**：生成能力。`videoStudio` 已有 ~29 個逐模型 i2v/t2v；director 已有 `executeGenerationTask / pollGenerationTask / generateSegmentCostar / batchGenerateCostar`。
- **做法**：M3 應**復用 director 既有 segment 編排** + videoStudio 逐模型 procedure 接起來，**而非從零造**。
- **過渡版 breakdown 立即可組**：`director.analyzeScriptOverview` + `director.generateVideoScript`（都在 33 中）+ `worldStoryboard.createFromSegments`（分段→分鏡批寫）——過渡版可立即用既有 procedure 組出，正式 `director.breakdown` 再取代。

---

## 8. 伺服器 call-chain 洞察（GitNexus 實測）

對伺服器代理層（director + commander + contextPackets）建圖後查 CALLS：

- **共用脊椎原語（最被呼叫）**：`invokeLLM ×6`（OpenRouter→Claude 決策閘道）、`withTimeout ×6`（韌性包裝）、`extractMessageText/Json ×5`、**`assertProjectOwnership ×4`**（ACL 守門）。→ 這四個是**每條代理 procedure 都會穿過的脊椎服務**；重整時**不可下放到單一 shell**，必須留在脊椎/`_core`。
- **`commander.createIntent` 360° 視圖**：解析到 `server/subsystems/commander/commanderService.ts:createIntent`（**L80–105**），被 `commanderRouter.ts` 呼叫，向下呼叫 `toView / assertProjectOwnership / CommanderAccessError`。→ 證實 **AgentAdapter.commanderPlan 的真實接點 = `commander.createIntent`**（非 `plan`），且已內建 ACL 守門。
- **director 層偵測到 73 條執行流（Process）**：腳本匯入→分段→CO-STAR 生成→輪詢 的鏈路已成形，佐證「影片鏈路已大量建成、缺的是 session/segment 持久化」。

---

## 9. 對社群（`/social`）UI spec 的直接影響

把社群設計文件的「重用對應」對照本程式碼校正，**社群 spec 應修正的接點**：

| 社群設計文件假設 | 程式碼現況校正 |
|---|---|
| `social.generateVisual → imageStudio / GenerationProvider` | 真實統一入口是 **`generate.*`**（非 `imageStudio.generate`）；底層才是 `imageStudio.<model>`。生成走**非同步 job 模型**：`estimateCost → prepareJob/submitStudioJob → jobStatus → recordGenResult`。回退鏈（hf→gemini→fal）與 `asset_generation_events` 應**錨在 `generate.recordGenResult`**（已存在的回寫點），非自造。 |
| `social.researchTrends → 委派 commander/Sonar 讀 news/sense` | `sense` **只有 `inferIntent`，無 research**；情報清單走 **`news.list`**；統一搜尋走 **`orbProxy.unifiedSearch`**。 |
| `social` Commander 走 `commander.createIntent` | ✅ 正確——真實入口就是 `commander.createIntent`（非 `commander.plan`），且已內建 `assertProjectOwnership` ACL。 |
| `consistency_vault` 鎖品牌走 `vault.*` | `vault` **僅 CRUD**（`create/update/delete/list/exportToAssets`）；**無 `setApproval`/`setLocks`/專屬鎖定 procedure**——品牌鎖定的 lock 語意需在 **`vault.update` 的 payload** 表達或後端擴充。 |
| `showcase.*`（發佈/精選/範本牆） | **`showcase.templates` 確認不存在**＝社群版型/範本牆**待建**。`featured_showcase` 表存在但 **UI 待建**。 |
| Context Packet 委派 `contextPacket.compile` | 真實是 **`contextPacket.compileProject`**。 |
| Tier-1 新表「建在 PG、用 jsonb/pgEnum/timestamptz」 | 現況 drizzle 是 **MySQL（`mysqlTable`）**；PG 是 P3 之後目標，非現況。 |
| `PostingProvider`（mock→Postiz） | 程式碼確認**完全無現況實作**（社群唯一全新接縫）。Postiz 連接器/skill 在環境中可用。 |

---

## 10. ✅built vs ❌to-build 速查

### ✅ 已建（圖譜/原始碼佐證）
- `director` 33 procedures（含 chat / importScript / analyzeScriptOverview / generateVideoScript / estimateSegmentCost / generationModels / executeGenerationTask / pollGenerationTask / generateSegmentCostar / batchGenerateCostar）
- `generate.*`（10：estimateCost / prepareJob / submitStudioJob / checkStudioJob / jobStatus / myJobs / activeJobs / multimodal / submitMultimodalAsync / **recordGenResult**）
- `imageStudio.*`（28 逐模型）、`videoStudio.*`（~29 逐模型）、`proStudio.*`（音樂/TTS/音效/配音）
- `commander.{createIntent, getRun, listRunsByProject}`、`contextPacket.{compileProject, getLatest, create, list, setProjectAccessRules, listProjectAccessRules, setStatus, test}`
- `creativeProject.*`、`worldStoryboard.{create, createFromSegments, planPipeline, seedSkeleton, …}`、`vault.{create, update, delete, list, exportToAssets}`、`notes.*`、`news.*`、`orbProxy.unifiedSearch`、`blockCombos.*`、`customBlocks.*`、`promptLibrary.*`、`assets.*`、`apiUsage.*`、`credits.{myBalance, pricingCatalog}`、`admin`（inline 14）、`settings.{get, update}`、`aiModels.*`、`agentModelPicks.*`
- 收編機制：`appRegistry.group`、`SIDEBAR_GROUPS=[]`、`VISIBLE_DOCK_PAGE_IDS`、`NavigateRedirect`、App.tsx 集中 54 路由
- ACL：`assertProjectOwnership`（每條代理 procedure 穿過）

### ❌ 待建（確認缺口）
- **`director.breakdown`**（待建 M3；過渡可用 analyzeScriptOverview + generateVideoScript + worldStoryboard.createFromSegments 組）
- **影片 session/segment 狀態機**：`video_generation_sessions` / `video_segment_jobs` 兩表 ＋ `generateSegment`（生成已在，缺持久化編排）
- **`showcase.templates`**（社群版型/範本牆待建；`featured_showcase` 表在但 UI 待建）
- **`/social` 全系統**：0 專屬實作＝新建
- **`PostingProvider`**：完全無現況實作（mock→Postiz 待接）
- **`vault` 專屬鎖定 procedure**（`setApproval`/`setLocks`）：不存在，需 payload 表達或後端擴充
- **`admin.dataRepair`**：不存在（修復需走 background_jobs 或待建）
- **`project_asset_links`**（P4 待建，社群設計文件亦標 ❌）
- **PG 遷移**：現況 MySQL；Tier-1 新表的 PG 型別需待 P3 Supabase parity

### ⚠ 改名/改層（非缺口，名稱對不上）
- `imageStudio.generate` → **`generate.*`**
- `videoStudio.generateSegment` → 缺 orchestration（逐模型生成已在）
- `proStudio.generateAudio`/`tts` → `textToMusic`/`generateMusicSuno`/`elevenLabsTTS`/`qwenTTS`…
- `loraTrainer.train` → `loraTrainer.trainWithReplicate`（現走 Replicate，待轉 HF）
- `sense.research` → `orbProxy.unifiedSearch` / `news.list`
- `commander.plan` → `commander.createIntent`
- `worldStoryboard.bulkUpsert` → `worldStoryboard.createFromSegments`
- `contextPacket.compile` → `contextPacket.compileProject`
- `agentModelPicks.assign` → `agentModelPicks.recordPick`
- `credits.spend`/`apiUsage.record` → `apiUsage.upsert`（扣點為伺服器內部）
- `credits.topUp` → 走 `plans.*`/subscription
- `admin.adjustCredits` → `admin.updateQuota`；`admin.toggleUser` → `admin.updateRole`；`admin.setFlag` → `settings.update`
- `generateVideoScriptFromBrief` → **不存在**（對應表誤列為已在 33）

---

## 11. 真實 procedure 清單（節錄，供 merge 核對）

- **director（33）**：chat · refineScript · templates · saveSession · listSessions · loadSession · deleteSession · importScript · generateVideoScript · videoScriptTypes · analyzeScriptOverview · estimateSegmentCost · generationModels · generateSegmentCostar · batchGenerateCostar · autoGenerateFromSegments · discussSegment · executeGenerationTask · pollGenerationTask · askForStudioPlan · quickActions · fetchTrendingInspiration · perplexityThrottleStatus · planningAnalyzeDepth · planningCreateMilestones · planningDiscuss · savePlanningSession · listPlanningSessions · loadPlanningSession · deletePlanningSession · preferences.{get,update}
- **generate（10）**：estimateCost · prepareJob · submitStudioJob · checkStudioJob · jobStatus · myJobs · activeJobs · multimodal · submitMultimodalAsync · recordGenResult
- **imageStudio（28 逐模型）**：seedreamV4 · seedreamV45Edit · fluxKontext · flux2ProEdit · nanoBananaPro · nanoBanana2 · nanoBananaEdit · imagen4 · gptImage15Edit · stableDiffusion35 · sdLora · grokEdit · hunyuan3d · trellis2 · rodin3d · seedVRUpscale · jobStatus · checkImageStatus …
- **videoStudio（~29 逐模型）**：klingImageToVideo · klingTextToVideo · klingProImageToVideo · veo3TextToVideo · veo3ProTextToVideo · soraTextToVideo · wanImageToVideo · wanTextToVideo · ltxTextToVideo · minimaxTextToVideo · runwayImageToVideo · pixverseImageToVideo · viduReferenceToVideo · compilePrompt · modelAvailability · checkVideoStatus …（**無 `generateSegment`**）
- **proStudio**：elevenLabsTTS · qwenTTS · qwenVoiceDesign · textToMusic · generateMusicSuno · compiledTextToMusic · soundEffects · voiceChanger · dubbing · speechToText · musicModels …（**無 `generateAudio`/`tts`**）
- **commander**：createIntent · getRun · listRunsByProject　|　**contextPacket**：compileProject · getLatest · create · list · setProjectAccessRules · listProjectAccessRules · setStatus · test
- **creativeProject**：list · create · get · update · delete · link · getContextSummary　|　**worldStoryboard**：create · createFromSegments · update · planPipeline · seedSkeleton · exportShotList · validate · summarizeForPrompt · listByWorld …
- **vault**：create · update · delete · list · exportToAssets　|　**notes**：create · update · delete · list · summary · exportIcs
- **credits**：myBalance · pricingCatalog　|　**apiUsage**：upsert · list · billing · overview · usageByProvider · usageEvents · deepCost · snapshots
- **admin（inline，14）**：allUsers · updateRole · updateQuota · usageLogs · systemStats · systemDailyTrend · teamCostSummary · userActivity · apiKeysStatus · apiProviderBreakdown · allBackgroundJobs · allGenerationHistory · runAutoCreditNow · updateAutoCreditPolicy　|　**settings**：get · update
- **aiModels**：list · getById · discoveries · runDiscovery · refreshAll/One/Stale · researchStats · setSchedule　|　**agentModelPicks**：recordPick · markAcceptance · getPreferredForModality · getPreferredByModalities · getRecent
- **orbProxy**：unifiedSearch · getRememberedPreferences · persistClarificationPicks · removePreferenceValue · clearAllPreferenceMemory　|　**sense**：inferIntent（**僅此一個**）

---

## 12. GitNexus 整合現況（給 Bruce 本機跑）

- **GitNexus 已半連結進 repo**：根目錄 **`.mcp.json` 已掛 gitnexus**（HEAD `2888a36` 即存在）：
  ```json
  { "mcpServers": { "gitnexus": { "command": "npx", "args": ["-y", "gitnexus@latest", "mcp"] } } }
  ```
  另有 `package.json` 的 `npm run gitnexus`（→ `scripts/gitnexus-launcher.mjs`，跑 `gitnexus serve`）與 `AGENTS.md`。
- **真正缺的只有兩件**：(a) **建索引**（`.mcp.json` 只啟動 MCP server、不會自動 analyze；沒索引時工具回 `Repository not indexed`）→ 須手動跑 `gitnexus analyze .`；(b) **把同組設定複製到 Codex / Cursor / Antigravity**（它們不讀 repo 的 `.mcp.json`）。
- Claude Code 預設讀 repo 根 `.mcp.json`，已等同連好、只缺索引。
- 協作可用的高價值工具：`impact <symbol>`（blast-radius，merge 前必查）、`context <symbol>`（360° callers/callees）、`query <concept>`（概念找執行流）、`cypher <q>`（找循環依賴/最被依賴模組）、`detect-changes`（git diff → 受影響符號）。

---

## 13. 一句話淨增量清單（對整合計畫）

1. **拆 shell 風險被證實為低**：跨頁 import=0、外框集中在 App.tsx＋DashboardLayout、僅 5 頁碰 active-project。
2. **抽出順序**：`/settings`→`/learn`→`/video`→`/social`；**前置**：打斷 `PersonalSettingsContext⇄useMobile` 循環、抽共用 provider 為脊椎單例。
3. **adapter 對應表 16 項改名/校正**——最關鍵：GenerationAdapter→`generate.*`、commanderPlan→`commander.createIntent`、ingestBreakdown→`worldStoryboard.createFromSegments`、rebuildPacket→`contextPacket.compileProject`、用量→`apiUsage.upsert`、admin→`updateQuota/updateRole`。
4. **M3 缺口更精確**：缺 session/segment 狀態機（非生成）；復用 director 既有 `executeGenerationTask/generateSegmentCostar` + videoStudio 逐模型 procedure。
5. **`shared/appRegistry.ts` 是 shell 對映單一真相源**（前後端＋AI 知識同步）。
6. **GitNexus 已半連結進 repo**：只缺「跑一次 `gitnexus analyze .`」＋把設定複製到 Codex/Cursor/Antigravity。
