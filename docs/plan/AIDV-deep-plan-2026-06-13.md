# AIDV 深度規劃 — AI 代理 × UIUX × 影片工作流 × 現有功能整合（2026-06-13）

> **這份文件是什麼**：針對 Bruce 指定的四個主題做的「程式碼實證版」深度規劃。
> 四個偵察代理把整個 repo（82 表／54 routes／~565 procedure）翻過一遍，所有結論都附檔案路徑為證，不是轉述舊文件。
> **白話導讀**：你（Bruce）是工程小白，所以每段都先用一句白話講「這是什麼、為什麼重要」，再給工程細節。
> **SSOT 位置**：本檔為 Confluence 鏡像。Confluence 目前因 OAuth 權限只授權 Jira（見文末「需要你動手」），暫時無法直接寫入；待你重新授權後，本檔原樣搬上 Confluence「⑩ 深度規劃」頁。Jira 卡已同步建立（見第 6 節）。

---

## 0. 一頁總結（最重要的發現）

**白話**：你的網站其實「東西都做好了，只是各做各的、沒接在一起」。

- 你以為「AI 代理」是 Wave 4 的未來工作——**錯**。實際上一整套成熟的代理系統（15 個精靈、多代理協作、編排器、工作流引擎、帶確認門的工具執行器、長期記憶、教材庫 RAG、排程器）**早就在線上跑了**，只是活在舊頁面裡。
- 你的新「四殼導演台」（DirectorConsole 脊椎）是一個乾淨、旗標保護、已上線的骨架——**但它幾乎沒用到上面那套代理系統，也沒接到世界觀／教材庫／真實地球／三大工作室（圖／影／音，合計 200+ procedure）**。
- 影片工作流 step 1–6（專案→劇本→分鏡→生圖→生影→配音樂）**都已實裝**；真正的大洞是 **step 7「組裝／剪輯／匯出」**（沒有時間軸、沒有 rough-cut、沒有 Flow TV 拼接 UI、沒有匯出任務佇列）。

**結論一句話**：未來最高 CP 值的工作，不是「再蓋新功能」，而是**把既有的成熟系統接進新導演台**。本規劃因此新增一條平行軌 **Wave I「現有功能整合」**（第 6 節，全部標 `待議` 待你拍板，不動既有 Wave 0–4 定錨）。

---

## 1. AI 代理：細節規劃

### 1.1 實況盤點（程式碼實證）

**白話**：代理系統分成「伺服器大腦」和「瀏覽器手腳」兩半，中間有 15 個專長精靈，全部都已經在跑。

| 元件 | 檔案 | 狀態 | 說明（白話） |
|---|---|---|---|
| 伺服器編排器 | `server/services/orbTaskOrchestrator.ts` | ✅ LIVE | 把 LLM 想出來的「工具計畫」實際跑起來，會重試、會重新規劃 |
| 工作流引擎 | `server/services/orbWorkflowEngine.ts` | ✅ LIVE | 多步驟工作流模板，存進 `orbWorkflow*` 三張表 |
| 工具執行器（含確認門） | `server/services/agentToolExecutor.ts` | ✅ LIVE | 每步有重試預算、**批准閘門**、結果驗證、錯誤分類 |
| 多代理協作 | `server/services/agentCollaborationOrchestrator.ts` | ✅ LIVE | 12+ 代理交接、共享上下文、訊息匯流排 |
| 瀏覽器端編排器 | `shared/global-agent-orchestrator.ts` | ✅ LIVE | 導航／填提示詞／換模型／跑工作流（操控頁面） |
| 規劃器 | `server/services/agentPlanner.ts` | ✅ LIVE | LLM 產生步驟計畫，支援 `${step1.video_url}` 串接、澄清迴圈 |
| 15 精靈角色 | `shared/orb-agent-roles.ts` | ✅ LIVE | 6 角色（導演/作曲/評審/研究/領航/夥伴）+ 6 專家 + 3 其他；各有工具白名單 |
| 精靈派工 | `server/services/spiritDispatcher.ts` + `server/routers/spiritRouter.ts` | ✅ LIVE | `spirit.invoke` → 直接派 FAL 模型 |
| 精靈工具庫 | `server/services/spiritTools/*.ts`（20+ 檔） | ✅ LIVE | 每個專家的實際工具函式 |
| 長期記憶 | `server/services/orbMemory.ts`（`orbLongTermMemories`/`orbMemoryAssociations`） | ✅ LIVE | 使用者偏好蒸餾、語意關聯圖 |
| 專家記憶 | `server/services/specializedAgentMemoryStore.ts` | ✅ LIVE | 每個專家各自的偏好/回饋/學習記憶 |
| 教材庫 RAG | `server/services/teachingArchiveRag.ts` | ✅ LIVE（但未接生成） | 全文+語意檢索使用者自己的教材 |
| 推理鏈顯示 | `client/src/components/orb/OrbThinkingStepsPanel.tsx` | ✅ LIVE | 一格一格顯示代理在想什麼（消毒→研究→規劃→呼叫專家→執行） |
| 排程器 | `server/services/orbScheduler.ts`（`orbScheduledJobs`） | ✅ LIVE | 給代理排 cron 工作 |
| 成本/扣點 | `server/db.ts:542-728` | ✅ LIVE | 原子鎖定扣點/退點 |
| Commander 骨架 | `server/subsystems/commander/contracts.ts` | 🟡 STUB（M1-B） | 只記意圖建 `orchestration_runs`，**明文不接 Perplexity/SubQ/MCP**，留給 Wave 4 |
| MCP / BYOMCP | — | ❌ 未實作 | 編排器「已經會吐工具呼叫」，缺的只是接到 MCP 工具註冊表這座橋 |

### 1.2 規劃：兩個層次

**A. 近期（接線，屬 Wave I）— 把既有代理接進導演台**
- **白話**：導演台右下角那顆「光球」現在只是個漂亮的狀態燈；把它接上後面那套真精靈系統，它就能真的幫你生圖、生影、配音。
- 細節：`AmbientOrb` 的 `collab` 模式（`client/src/shells/video/console/AmbientOrb.tsx`）→ 接 `agentToolExecutor`（已有確認門，符合你的「確認門＋成本常駐」UI 原則）→ 透過 `spiritDispatcher` 派工。脊椎（`ProjectSpineProvider`）把當前專案上下文當成 agent 的 context packet。
- 驗收：在導演台對光球說「幫我把這顆鏡頭生出來」，它走批准閘門→精靈派工→結果回填 `StoryboardFrame`。

**B. 遠期（Wave 4 BYOMCP）— 缺的那座橋**
- **白話**：讓進階使用者「自帶工具」（MCP）給代理用。
- 細節：Commander 從 M1-B 骨架 → M5 adapter（填 plan/cost）→ 接 `CommanderKind` 既有的 `subq`/`mcp` 佔位 → BYOMCP 權限/稽核（AIDV-24）。橋接點＝編排器已輸出結構化工具呼叫，只需 MCP 工具註冊表轉接層。對應既有卡 AIDV-23/24/25。
- 避雷：`ApiKeysPanel.tsx` 已有 UI 殼但金鑰未接儲存；MCP 金鑰一律走 Railway 環境變數，不寫頁面。

---

## 2. UIUX：細節規劃

### 2.1 實況盤點

**白話**：骨架（四殼＋脊椎＋三欄導演台＋光球四態）100% 蓋好了；設計系統 46 頁規格也完整；缺的是「卡片內部的狀態細節」和「手機版」。

- **四殼旗標**（`client/src/config/*Flags.ts`）：`ENABLE_4SHELL`（預設 OFF，總開關）→ `SHELL_SOCIAL`(OFF)/`SHELL_LEARN`(ON)/`ENABLE_VIDEO_COCKPIT`(ON)→`VIDEO_SPINE_MOCK`(OFF=真資料)/`ENABLE_DIRECTOR_CONSOLE`(ON)/`ENABLE_PROJECT_SSOT`(ON)。**OFF 時零行為改變**已測試。
- **三欄導演台** `DirectorConsole.tsx`：左 Story Spine（S0X 鏡號導航）／中 CreationCanvas（chat/script/shot/asset/voice/music 六模式）／右 Context Sidecar（封包＋確認門＋成本＋過期鏡＋筆記）。✅ LIVE。
- **光球四態** `AmbientOrb.tsx`：silent/hint/collab/critical，無人格，CTA 都接好。✅ LIVE。
- **設計系統**：`docs/4shell-handoff/AI-Director-UIUX設計/`（46 頁＋互動原型＋tokens.oklch.css）。亮色暖米白為基準；`index.css` 已是 OKLCH。

### 2.2 規劃：依阻塞程度排序（對應 Wave U / AIDV-74、75）

**Rank-1（擋上線）**
1. **三欄 RWD 完成**：`cockpit-tabs`（平板分頁）只有 CSS class 沒有 React 元件；`.mnav`（手機底欄）整合未完；無手機/平板 e2e 測試。對應 ⑧-H7「手機版導演台缺失」＝ AIDV-42（W1-9）。
2. **ShotCard 狀態機**：idle/queued/generating/done/stale/error 視覺狀態＋生成前成本預覽，目前 STUB。
3. **確認門解鎖 UX**：角色升級、鎖頭圖示轉換、LoRA 徽章變化的視覺進程。

**Rank-2（核心流程未完）**
4. **AssetGenCanvas 多模態**：六個生成器（圖/影/音/TTS/音樂）狀態機未完。
5. **GuidedJourney 全流程**：從零引導→AI 共筆→劇本拆解→寫回專案；review 狀態半 stub。
6. **存庫→重用閉環**：`promptLibrary.create` 已有，UI 的「再生成/插入/fork」只有規格沒程式。

**Rank-3（未來波）**
7. **暗色「影院/夜間」次模式**（AIDV-53）：OKLCH token 已預留，未切換。
8. **Step 4 rough-cut 編輯器**（與第 3 節影片 step 7 同一個洞）。

---

## 3. 影片製作工作流：細節規劃

### 3.1 全鏈實況（八步）

**白話**：從「一句話點子」到「成片」共八步。前六步都能跑，第七步（把片段拼成成片）幾乎是空的。

| 步驟 | 狀態 | 關鍵 procedure / 表 | 缺口 |
|---|---|---|---|
| 1 專案/點子 | ✅/🟡 | `creativeProject.*`、`commander.createIntent`、`orchestration_runs` | GuidedJourney 入口 |
| 2 劇本生成 | ✅ | `director.generateScript`/`parseScriptIntoSegments`/`analyzeEmotionalDepth` | — |
| 3 分鏡拆解 | ✅/🟡 | `worldStoryboard.skeleton`/`plan`/`validate`、`worldStoryboards` 表 | **無 `video_generation_sessions`/`segment_jobs`** |
| 4 生圖（關鍵幀） | ✅ | `imageStudio.generateFromText`/`refineImage`、FAL t2i 6+ 模型 | — |
| 5 生影（草稿→精修） | ✅/🟡 | `videoStudio.klingTextToVideo`/`wanImageToVideo`、`backgroundJobs` | 段落任務追蹤、草稿/精修兩層 DB 持久化 |
| 6 配音/音樂 | ✅ | `proStudio.generateVoice`/`cloneVoice`/`generateMusic`、ElevenLabs/Sonauto | — |
| 7 組裝/剪輯/匯出 | 🔴 PARTIAL/STUB | `videoCompiler.ts`(有邏輯無 router)、`director.exportScript`(同步) | **無時間軸 UI、無 rough-cut、無 Flow TV 拼接、無 `export_jobs`、無 `project_asset_links`** |
| 8 橫切（成本/血統） | ✅/🟡 | `costAggregations`、`aiUsageEvents`、`promptAssets` | 段落級成本、劇本/分鏡版本控制、無 BullMQ/Redis/SSE |

### 3.2 規劃：補完 step 7 + 段落狀態機（對應既有卡，附細節）

**白話**：先把「段落任務」這個概念補成真的資料表，再把「拼接成片」做出來。

- **3.2.a 段落狀態機**（對應 AIDV-18 M3／AIDV-50）：新增 `video_generation_sessions`（projectId/storyboardId/status: draft|refine|approved|final/估算成本/實際成本）＋ `video_segment_jobs`（sessionId/segmentIndex/backgroundJobId FK/outputVideoUrl/retryCount/costUsd）。**好處**：段落級重試、段落級成本、批次連貫。避雷：migration 守三鐵則（資訊schema 守門、逐句 breakpoint、禁 MySQL 不支援語法），journal `when` 要大於 DB 最後一筆。
- **3.2.b 組裝端點**（新，建議掛 AIDV-48）：把已存在的 `videoCompiler.ts` 包成 `assembly.compile` tRPC procedure（目前只有邏輯沒入口）＋ `project_asset_links` junction（專案↔資產）＋ `export_jobs`（非同步匯出佇列，避免大片同步 timeout）。
- **3.2.c Flow TV 放映皮**（AIDV-37，進行中 #873 已合）：放映/重用/fork；頻道＝真實後端篩選。已在做，接著做拼接視圖。
- **3.2.d 任務耐久化**（AIDV-13，缺 Redis 金鑰）：目前是 DB 輪詢（5 秒），無 BullMQ/SSE。Redis 金鑰到位後升級為佇列＋斷線重連 SSE。

---

## 4. 我沒想到的：現有功能整合（核心發現）

**白話**：以下是「做好了卻沒人用 / 沒接進影片流程」的功能。把它們接起來，影片流程會從「一堆分散工具」變成「一條順暢的創作旅程」。

四個偵察代理共找到 **36 個實作功能**，其中約 12 個未整合、4 個甚至沒有前端頁面。最值得整合的：

| # | 功能 | 檔案證據 | 現狀 | 整合角度（白話） |
|---|---|---|---|---|
| 1 | **教材庫 RAG** | `server/routers/teachingArchive.ts`、`teachingArchiveRag.ts` | RAG 已建未接生成 | 用你自己的教材（療癒教學/品牌語氣）來「接地」劇本生成 |
| 2 | **世界觀框架** | `server/routers/worldbuilding.ts`(20 procedure)、`summarizeForPrompt` | LIVE 未自動注入 | 選定世界的風格檔/音樂主題/角色一致性 prompt **自動注入**圖/影/音生成 |
| 3 | **世界分鏡** | `server/routers/worldStoryboard.ts`(14 procedure) | 有後端無獨立 UI | 劇本完成→`seedStoryboardSkeleton` 自動生空白分鏡骨架 |
| 4 | **真實地球資料庫** | `server/routers/realEarth.ts`(13 procedure) | **完全沒有前端頁面** | 導演「研究階段」面板：用真實歷史/地理把場景接地 |
| 5 | **LoRA 角色閉環** | `loraTrainer.ts`、worldbuilding `linkedModelIds` | 可連結未自動套用 | 生成有 LoRA 的角色時自動套用 loraUrl/scale，確保一致性 |
| 6 | **Creative Projects 主入口** | `creativeProject.ts`、脊椎 `ProjectsContext` | 像附屬品 | 改成主入口：新專案→選世界→導演→自動分鏡→各工作室帶上下文 |
| 7 | **Prompt 庫＋收藏跨庫** | `promptLibrary.ts`、`promptCollection.ts` | 兩套各自獨立 | 生成時建議＋合併使用，跨專案重用 |
| 8 | **Sense 意圖引擎** | `server/routers/sense.ts` | 靜默跑、無 UI 應用 | 用既有意圖推論（選擇困難/找靈感/目標導向）個人化 GuidedJourney |
| 9 | **解剖專家** | `spiritTools/anatomySpecialistTools.ts` | 藏在精靈系統 | 圖像工作室加「醫療插畫」標籤→喚出解剖專家（你領域相關） |
| 10 | **團隊共享世界觀/教材** | `teams.ts`、worldbuilding/teachingArchive 的 teamId/visibility | 權限有、沒行銷 | 「一起共建世界」快捷：邀團隊共享世界觀＋教材語料 |

> 還有一條最關鍵、跨三個主題的整合（見第 1.2.A）：**把既有 orb/spirit 編排系統接進導演台光球**。這是「AI 代理 × UIUX × 影片流程」三者的交會點，也是整份規劃的最高 CP 值單項。

---

## 5. 建議路線（不動既有定錨，新增平行軌）

**白話**：你原本的 Wave 0–4 順序不動。我只額外提一條「整合軌」Wave I，全部當提案、等你點頭。

- **Wave I — 現有功能整合**（新平行軌，標 `待議`）：把第 4 節 + 第 1.2.A 的接線工作收成一個 Epic，建議排在 Wave 1 收尾後、與 Wave 2 並行（多為 UI 接線，低風險、不碰金鑰）。
- 既有 Wave U（UIUX 實裝 AIDV-74/75）：依第 2.2 排序落地。
- 既有 Wave 2/3（影片 step 7、段落狀態機、耐久化）：依第 3.2 補完。
- 既有 Wave 4（BYOMCP）：依第 1.2.B，缺的只是 MCP 橋接層。

---

## 6. Jira 同步（本次已建/已留言）

> 規則：不動既有 Wave 0–4 定錨；新卡一律 `待議`＋`integration`，等 Bruce 拍板。詳見 Jira 專案 AIDV。

- **新 Epic**：Wave I 現有功能整合（見 Jira）。
- **新 Story（待議）**：I-1 光球接編排器、I-2 世界觀自動注入、I-3 劇本→分鏡骨架、I-4 教材庫 RAG 接地、I-5 真實地球研究面板、I-6 Creative Projects 主入口、I-7 LoRA 角色閉環、I-8 Prompt 跨庫建議、I-9 Sense 個人化 onboarding。
- **既有卡補規劃留言**：AIDV-37（Flow TV 拼接）、AIDV-18/50（段落狀態機表結構）、AIDV-48（組裝端點＋export_jobs）、AIDV-23/24/25（Wave 4 MCP 橋接）、AIDV-74/75（UIUX 排序）。

---

## 7. 需要你動手（🤝）

1. **Confluence 重新授權**（擋住本檔上 Confluence）：目前連上的 Atlassian OAuth 只授權了 Jira（scope 僅 `read/write:jira-work`），Confluence 一律回 403「app not installed」。請到 **claude.ai／Desktop → Settings → Connectors → Atlassian → 重新 Connect**，授權時**勾選 Confluence 權限**（read/write:confluence-content）。完成後我就能把本檔原樣搬上 Confluence「⑩ 深度規劃」並更新討論區。
2. **拍板 Wave I**：第 6 節九張 `待議` 卡要不要納入路線、排在哪（建議與 Wave 2 並行）。
3. （沿用）缺金鑰仍貼 Railway：Redis（耐久化）、FAL_KEY、Supabase、ELEVENLABS_API_KEY。
