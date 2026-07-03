# P6 — 資料持久化 / 雙 DB 收斂 / RAG 強化方案（深度研究 wave P）

- 產生日期:2026-07-03
- 依據 commit:`7f4417daaacbf24510dc20d88dba9aae71b2883c`
- 性質:**解法卡 wave P**——本文件不重複診斷,直接引用既有盤點結論(`B-infra.md` §2/§6.1、`K3-data-integrity.md` §1/§4/§5、`E-ai-agents.md` §5、`G4-misc-audit.md` §3/§5、`M2-project-agent-guidance.md` §3.1、`02-fullstack.md` §6-7、`AGENTS.md`「DB 架構」節),只在其上設計「記憶體態資料落 DB / 雙 DB 分工收斂 / RAG 讓 AI 可靠讀單一專案上下文」的具體解法卡
- 方法:單一代理實讀 `server/services/orbTaskStateMachine.ts`(全 797 行)、`server/services/orbTaskStore.ts`(頭 80 行)、`server/routers/learnHub.ts`(逐 mutation 核對 docs/videos/quizzes 是否落 DB)、`server/services/ragMemory.ts`(全 324 行)、`drizzle/schema.ts`(learn_modules:4481-4506、orb_workflow_executions:3185-3226)、`server/services/modelResearcher.ts`(頭 90 行,含 Redis warm/persist)、`server/routers/aiModels.ts`(setSchedule mutation)、`supabase/migrations/`(23 支檔名逐一列出)、`server/_core/index.ts`(SCHEDULED_MAINTENANCE_JOBS 清單,無 orphan-scan job)、`AGENTS.md`(雙 DB 命名規則),無子代理
- 圖例:S=小(≤1 天)/M=中(2-5 天)/L=大(1-2 週)/XL=跨季

---

## 0. 一句話總覽

本波五張卡的共同主線是「AI 代理要能可靠地讀懂單一專案的上下文」這件事,今天被四個獨立問題卡住:①它可能問到的資料(orbTask 進度、learnHub 教材、模型研究結果)有一部分會在重啟後**憑空消失**;②它讀到的資料可能來自**兩本互相矛盾的帳**(雙 DB 分裂);③它做的向量檢索(RAG)是**全站/全使用者尺度**,不是「這個專案」尺度,也没有把世界觀/資產一起編入索引;④它讀到的 JSON 欄位**沒有形狀保證**,上游一改欄位下游就無聲讀到 `undefined`。五張卡按「AI 可靠讀專案上下文」貢獻由高到低排序如下(見各卡末項評分):卡3(RAG 專案範圍化)> 卡1(記憶體態落 DB)> 卡2(雙 DB 收斂)> 卡5(JSON zod 化)> 卡4(孤兒掃描,主要是資料衛生非直接貢獻)。

---

## 卡 1 — 記憶體態資料落 DB

### 1.1 orbTask FSM(`ORB_TASK_STORE_FILE` → `orb_workflow_executions`)

**現況**(已實讀,比既有文件更精確一層):
- 真正驅動「一步步引導/多步驟代理任務」的狀態機是 `server/services/orbTaskStateMachine.ts:73` 的 `const taskStore = new Map<string, OrbAgentTask>()`——**純模組級記憶體,無任何持久化選項**,程式碼全文(797 行)搜尋不到任何 `fs`/`db`/`redis` 讀寫。11 態(idle→…→completed/failed/cancelled/blocked)、28 種 audit event、`recordAgentMessage`(跨代理訊息)、`markStepRollback`(補償動作追蹤)全部只活在這個 Map 裡,Railway 重啟/redeploy 即整批消失,且**沒有任何「重啟後標記 orphan 任務」的程式碼**(`getOrbAgentTask`/`listRecentOrbAgentTasks` 對已消失的 taskId 只會回 `null`/空陣列,前端會看到「查無此任務」而非「已中斷、要繼續嗎」)。
- 另有一個**平行、獨立的**任務儲存 `server/services/orbTaskStore.ts`(`OrbTaskStore` 類別,:40),它的 constructor **真的支援檔案持久化**(`loadFromDisk()`,靠 `ORB_TASK_STORE_FILE` env,`env.validated.ts:613` 預設空字串);模組匯出 `export const orbTaskStore = new OrbTaskStore(process.env.ORB_TASK_STORE_FILE)`。**這是舊版 legacy store**(`ai.ts:2435-2456` 註解自述與 FSM 同 taskId 雙寫,E §3.3 已記錄「雙任務儲存並存」)。也就是說:**「檔案持久化」選項掛在錯的(legacy/次要)store 上**,真正承載狀態機邏輯與 audit trail 的 `orbTaskStateMachine.ts` 完全沒有這個選項——B-infra/K3/E 三份既有文件把兩者混講成同一件事,這是本波查證後的修正。
- 候選落地表 `orb_workflow_executions`(`drizzle/schema.ts:3185-3226`)**已存在**,但 schema 是為 `runWorkflow`(`orb_workflow_templates` 執行紀錄)設計的:`templateId`(**NOT NULL**,綁定一個範本)、`totalSteps`(**NOT NULL**)、單一 `status` enum(6 態,不是 FSM 的 11 態)、`inputs`/`outputs`/`metadata` 三個裸 json 欄。**與 `OrbAgentTask` 的形狀不完全對齊**(FSM 任務不一定有 templateId;FSM 有 `auditEvents[]`/`steps[]` 陣列結構、`agentRole`/`riskLevel`/`predecessorTaskId` 等此表沒有的欄位)——需要新表或大幅擴表,不能直接借殼。

**目標**:orbTask FSM 的任務狀態與 audit trail 在 redeploy 後不丟失;至少能讓「進行中」任務在重啟後被使用者看見「這個操作被中斷了,要繼續嗎」而非查無此任務或假進度條卡住。

**做法**(分兩階段,對齊 M2 §4.5 已給的方向,本卡把它具體化到表結構層):
1. **S(≤1 天,先止血)**:把 `ORB_TASK_STORE_FILE` 這個已存在但掛錯位置的選項,改接到 `orbTaskStateMachine.ts` 的 `taskStore`——啟動時 `loadFromDisk()`、每次 `pushEvent`/狀態變更後 debounce 寫回(仿 `orbTaskStore.ts` 現成的 `loadFromDisk`/序列化邏輯搬過來,不用重新設計);同時掛一個 Railway volume(Dockerfile/railway.toml 已有 volume 機制可援用 db-backups 的模式)。這一步不改 schema、不改 API,只是把「重啟即丟」降級為「重啟後從磁碟/volume 復原大部分狀態」,立即把風險面從「必丟」降到「volume 若正確掛載則不丟」。
2. **M(3-5 天,正式落地)**:新增 migration 建一張 `orb_agent_tasks` 表(不是複用 `orb_workflow_executions`,避免 templateId NOT NULL 的錯配),欄位對齊 `OrbAgentTask` 介面:`taskId`(varchar PK)、`userId`、`status`、`currentStepId`、`stepsJson`(json,對應 `steps[]`)、`auditEventsJson`(json,對應 `auditEvents[]`,或拆成獨立 `orb_agent_task_events` 表以利查詢/清理)、`agentRole`/`riskLevel`/`capabilities`/`predecessorTaskId`/`iterationIndex`/`retryBudget`/`retryCount` 等純量欄;`taskStore.set/get` 全部改為「寫穿 DB + in-memory cache」(讀多寫少,可承受一次 DB round-trip)。啟動時跑一次「非終態(executing/paused/awaiting_approval/recovering)任務標記 `status='orphaned'`」的一次性 sweep,前端 `listRecentOrbAgentTasks` 對 orphaned 任務顯示中斷提示。
3. 收斂:`orbTaskStore.ts`(legacy)在 DB 落地完成後可考慮退場為 FSM 的薄相容層(E §9.3 建議 7「以 FSM 為單一真相源」),但這屬於另一張技術債卡,本卡不強制要求。

**工作量**:止血步驟 S;正式落地(新表+遷移+讀寫改造+orphan sweep+前端提示)M,合計 M-L。

**對「AI 可靠讀專案上下文」的貢獻**:**高**。這是 M2 方案(單一專案引導代理)點名的「能力 D:達最終成品」兩個地基洞之一(另一是 178-tool gate)——沒有這個,任何「AI 帶你走完五步流程」的多步驟任務,只要中途撞上一次部署,狀態就整批消失,代理會表現成「說要做但憑空忘記」,直接摧毀使用者對「AI 讀得懂我的專案進度」的信任。

---

### 1.2 learnHub 文件/影片/測驗(`learn_modules` 表已在)

**現況**(逐 mutation 實讀後修正既有文件的籠統判定——**docs 已局部落地,videos/quizzes 仍純記憶體**,三者現況不同,不可一概而論):

| 子系統 | 現況 | 證據 |
|---|---|---|
| **docs(教材文件)** | `learnHub.ts:551`(`create`)/`:625`(`update`)/`:695`(`delete`)/`:716`(`importDocs`)**四個 mutation 皆有 `db.insert/update/delete(learnModules)`**(:599、:685、:706、:766),且啟動時 `initLearnHubFromDb()`(:99-120)把 DB 裡非種子的列併回記憶體陣列 `docs`。**docs 已經是「DB 為主、記憶體為讀取快取」的正確模式**,只是種子文件(`SEED_DOCS`)本身仍是程式碼常量,不在 DB 裡(設計如此,非債) | learnHub.ts:99-120、551-793 |
| **videos(教學影片)** | `videoCreate`(:853)/`videoUpdate`(:889)/`videoDelete`(:926)**三個 mutation 全部只操作記憶體陣列 `videos`**(`.unshift`/`[idx]=`/`.splice`),**無任何 DB 呼叫**。程式碼自己承認:`videoList` query 回傳 `ephemeral: true as const`,註解明寫「AIDV-190:影片目前僅存於模組級記憶體陣列(無 DB 表),redeploy/重啟即丟失。`ephemeral` 讓 admin UI 誠實提示『重啟後遺失』;DB 表落地後改為 false(待 Bruce 拍板表結構)」 | learnHub.ts:838、853-935 |
| **quizzes(測驗)** | `quizCreate`(:996)/`quizUpdate`(:1043)/`quizDelete`(:1096)同樣**三個 mutation 全部只操作記憶體陣列 `quizzes`**,無 DB 呼叫、無 ephemeral 旗標誠實揭露(比 videos 少了這一層自承) | learnHub.ts:996-1100 |

**目標**:admin 新增的教學影片/測驗在 redeploy 後不消失;三個子系統(docs/videos/quizzes)持久化模式一致,不再是「docs 已修好、videos/quizzes 仍是同一份技術債的兩個未完成分身」。

**做法**:
1. **S**:比照 `learn_modules` 的模式,各開一張 `learn_videos`(id/category/title/summary/videoUrl/thumbnailUrl/tags(json)/difficulty/durationMinutes/featured/authorName/publishedAt/updatedAt)、`learn_quizzes`(id/category/title/summary/questionsJson/tags/difficulty/estimatedMinutes/featured/authorName/publishedAt/updatedAt)两張 migration——**欄位形狀直接照抄現有 `videoCreate`/`quizCreate` 的 zod input schema**(已在 learnHub.ts:853-875、996-1023 寫好,不需要重新設計欄位)。
2. `videoCreate/Update/Delete`、`quizCreate/Update/Delete` 六個 mutation 仿 docs 的模式補 `db.insert/update/delete`;啟動 `initLearnHubFromDb` 旁增加 `initLearnHubVideosFromDb`/`initLearnHubQuizzesFromDb`(同一個函式稍加抽象即可涵蓋三種,減少重複)。
3. `videoList` 的 `ephemeral: true` 改回 `false`(AIDV-190 註解已經預告這個收尾動作)。

**工作量**:S(有現成模式可抄、有現成 zod schema 可搬,無架構決策)。

**對「AI 可靠讀專案上下文」的貢獻**:**中低**。這批資料是「全站教材」而非「單一專案」上下文,不直接影響代理對某個創作專案的理解;但影響光球 RAG 教材索引的完整性(§6.2 節既有的 `siteKnowledge.buildLearnHubIndexKnowledge()` 會讀 `getAllLearnDocsForOrbIndex`,若未來擴充涵蓋 videos/quizzes,持久化是前提)與管理員體驗(不會覺得後台「教材莫名消失」)。

---

### 1.3 aiModels enrichment(Redis 已接,非純記憶體——修正既有文件)

**現況**(實讀後修正:B-infra/K3/E 三份文件都把這項寫成「純記憶體 Map,重啟即丟」,**這個判定對現況不準確**):
- `server/services/modelResearcher.ts:71` 的 `const enrichmentStore = new Map<string, EnrichmentRecord>()` 確實是記憶體 Map,但模組載入時**已經**跑 `void loadAllEnrichmentsFromRedis<EnrichmentRecord>().then(records => { for (const r of records) enrichmentStore.set(r.modelId, r); })`(:73-82,fail-open:Redis 不可用時 Map 從空開始,行為與舊版一致,不會炸開機),寫入路徑 `setEnrichment()`(:86-89)**也已經**同步 `enrichmentStore.set()` + `saveEnrichmentToRedis(record).catch(() => {})`(fire-and-forget,失敗不擋主流程)。
- 也就是說:**只要 `REDIS_URL` 有設(prod 已設,B-infra §3.2 rateLimiter 章節已證實 REDIS_URL 存在時會自動切換 Redis-backed store),aiModels enrichment 在 prod 環境下重啟不會遺失**——這是本波查證後對既有三份文件的重要修正,啟動時 Map 會從 Redis 熱身回填。
- 真正仍是純記憶體、無持久化的是:`server/routers/aiModels.ts` 的 `setSchedule` mutation(:221-230)——研究排程的 cron 字串**只存在記憶體**,註解自陳「變更會立刻熱重啟 cron task;只存在於記憶體,要跨重啟持久化請額外設定 `MODEL_RESEARCH_CRON_SCHEDULE` 環境變數」。這是「設定改了會在下次重啟後跳回 env 預設值」的體驗債,而非資料遺失風險。

**目標**:enrichment 結果的持久化現況(Redis-backed)應更新進既有研究文件,避免下一波研究重複列為「純記憶體待修」的假警報;研究排程改動應可跨重啟保留(不必動 env)。

**做法**:
1. **S(文件修正,非程式碼變更)**:更新 `B-infra.md` D1/`E-ai-agents.md` §9.2/`K3-data-integrity.md` §4 三處對 aiModels enrichment 的描述,標註「已有 Redis warm/persist(fail-open),非純記憶體」,避免重複列為技術債。
2. **S(選配,若要真正解決排程問題)**:`setSchedule` mutation 除了熱重啟 cron task,順手把新 schedule 字串寫進 Redis(或一個小的 `app_settings` KV 表,若已存在);啟動時讀回。工作量小,純粹是「補一行持久化」,無架構變動。

**工作量**:文件修正 S;排程持久化(選配)S。

**對「AI 可靠讀專案上下文」的貢獻**:**低**。aiModels enrichment 是「AI 模型百科頁面的深度介紹」,服務對象是使用者瀏覽模型資訊,不進 orb 主聊天的專案上下文注入鏈;列在此處主要是為了**修正既有文件對現況的誤判**,避免下一波研究基於錯誤前提重複列債。

---

### 1.4 orbQuota 生成配額計數器(補充,既有文件已提及,本卡不重複展開)

沿用 K3 §4/E §8.3 的既有記錄:`orbQuota.ts:23-25`(`userDailyCounters`/`sessionClicks`/`providerRateCounters`)純記憶體,`ENABLE_ORB_QUOTA_GUARD` 預設 OFF(該 guard 本身都還沒開,持久化優先序低於 1.1-1.3)。**不建議此波處理**——旗標都還沒開,先落地一個沒人依賴的計數器 ROI 低;待 M2 路線圖考慮開 `ENABLE_ORB_QUOTA_GUARD` 時再一併評估要不要換 Redis(已有 ioredis 基建,做法與 rate-limit store 一致)。

---

## 卡 2 — 雙 DB 分工文件化 + 收斂

### 2.1 現況(引用 B-infra §2.3/2.4、K3 §2、AGENTS.md「DB 架構」節,不重複展開,只做「文件化+收斂」層級的方案設計)

`AGENTS.md` 已有一段「DB 架構:MySQL (Drizzle) vs Postgres (Supabase)」規則,但**現行文字本身就與程式碼事實矛盾**:AGENTS.md 寫「`providerHealthProbeJob` 用 **Supabase client SDK** 寫入,目標正確是 `system_alerts`」,但 B-infra §2.4 #1 與 K3 §2.1 實讀 `server/jobs/providerHealthProbeJob.ts:12,224-280` 後證實**該檔案 import 的是 Drizzle `orbSystemAlerts` 並寫 MySQL**,不是 Supabase SDK。也就是說:**連「權威分工說明文件」自己都是錯的**——這比「沒有文件」更危險,因為它會讓下一位工程師(或下一輪 AI 代理讀 AGENTS.md 當作事實)照著錯誤描述去改代碼、去判斷「這個告警去哪查」。

其餘既有記錄(不重複展開,見出處):雙告警表分裂(B-infra §2.4#1/K3 §2.1)、Supabase 5 張核心表(`agent_tasks`/`video_projects`/`video_segments`/`system_alerts`/`creator_job_throttle`)基底 DDL 不在 repo(B-infra §2.2/K3 §3.4)、MySQL int userId ↔ Supabase uuid creator_id 無對照表導致 `handoffTraceRoute.ts` 形同 IDOR(K3 §2.2)、兩套限流互不知情(B-infra §2.4#4/AGENTS.md「Wave T」節)。

### 2.2 目標

①`AGENTS.md`「DB 架構」節文字與程式碼一致(不再是誤導性的權威文件);②Supabase 5 核心表 DDL 收編進 `supabase/migrations/`,環境可從 repo 重建;③雙告警表寫入路徑單軌化;④身分映射有一張對照表可查(即使不強制外鍵)。

### 2.3 做法(按 ROI 由高到低排序)

1. **S(≤1 天)——先修 AGENTS.md 文字本身**:把「規則」節的第 3 條「providerHealthProbeJob 用 Supabase client SDK 寫入」改成如實描述現況(「目前實際寫入 MySQL `orb_system_alerts`,與命名/文件宣稱的 Supabase `system_alerts` 不符,屬已知技術債,見 B-infra §2.4#1」),並在 `drizzle/schema.ts:3411-3416` 那段自相矛盾的註解旁補一行「⚠️ 本註解與 `providerHealthProbeJob.ts` 實際行為不符,見 AGENTS.md」。**這一步零程式碼風險,純文件對齊,但是全卡優先序最高的一步**——任何 AI 代理(含未來的自己)在改動告警相關代碼前第一件事是讀 AGENTS.md,文件本身錯就會持續產生新的錯誤修改。
2. **M(3-5 天)——雙告警表單軌化**:採用 B-infra §6.1 優化路徑建議 3 的方向,把 `providerHealthProbeJob.ts` 改寫 Supabase `system_alerts`(經 Supabase client SDK,比照 pg_cron 側 `detect_pipeline_stall` 的寫入格式),讓「供應商健康」與「管線停滯/心跳」告警進同一張表、同一套去重(AIDV-834 索引)/resolve 生命週期;MySQL `orb_system_alerts` 保留為只讀 legacy view 或直接標記 deprecated(不刪,因為既有 admin UI/查詢可能還在讀,需先盤點消費端)。**先決條件**:Node 端要能用 service-role key 呼叫 Supabase REST(`handoffTraceRoute.ts` 已有現成範例可抄,§2.4 會一併處理其安全洞)。
3. **M(3-5 天)——Supabase 核心表 DDL 收編**:用 `mcp__Supabase__list_migrations`/`get_advisors`(或 `supabase db pull` CLI,若本機有 Supabase CLI 存取權)把 `agent_tasks`/`video_projects`/`video_segments`/`system_alerts`/`creator_job_throttle` 及 `check_creator_job_rate_limit()` 函式的現行 DDL 匯出,補一支「baseline」migration 檔進 `supabase/migrations/`(命名建議 `00000000_baseline_pre_repo_tables.sql`,標明「這是 dashboard/MCP 直接施作、事後補登記的基底 DDL,非時序正確的變更歷史」)。之後**新規則**:任何對這 5 張表的 schema 變更一律先寫 migration 檔再套用(`apply_migration` MCP 工具本身就是走 migration 路徑,只要求團隊紀律,不要求新工具)。
4. **L(1-2 週)——身分映射對照表**:不需要跨庫外鍵(技術上做不到),但可以建一張 MySQL 側的 `supabase_identity_links` 表(userId int, supabaseCreatorId uuid, linkedAt),在使用者首次觸發 Supabase 側動作(如建立 video_project)時 upsert 一筆;`handoffTraceRoute.ts` 等跨庫端點改為先查此表確認 `projectId` 對應的 `creator_id` 屬於當前 `userId` 才放行(修掉 K3 §2.2 的 IDOR)。這張表也是未來「身分打通」的地基,若之後要做「一個使用者橫跨兩庫的完整審計」都會需要它。

### 2.4 工作量

文件修正 S;告警單軌化 M;DDL 收編 M;身分映射表(含改 `handoffTraceRoute.ts` 授權邏輯)L。合計 M-L(可分批上線,彼此無強依賴,除了④建議在③之後因為③會讓「哪些表算核心表」的清單更穩定)。

### 2.5 對「AI 可靠讀專案上下文」的貢獻

**中**。AI 代理(尤其是本站的多代理影片管線,運作在 Supabase 側)若要對「這個專案」給出正確判斷,必須知道專案的執行狀態(`agent_tasks`/`video_projects`)是可信的單一來源;目前雙 DB 分裂主要傷害的是**監控/告警視野**與**身分授權**,不直接污染代理讀取的「內容」上下文(世界觀/腳本/資產仍在 MySQL 且結構清楚)。但長期若代理需要「這個影片專案卡在哪個 agent_task」這類跨庫追問,身分映射(④)是硬前提。

---

## 卡 3 — RAG 強化:讓 AI 更懂單一專案

### 3.1 現況(實讀 `ragMemory.ts` 全文 + 引用 `02-fullstack.md` §6.1、`E-ai-agents.md` §5、`M2-project-agent-guidance.md` §3.1)

本站只有**一個** Pinecone index(`ai-director-memories`,3072 維,gemini-embedding-001),但裡面混了至少兩種完全不同尺度的命名空間,兩者都不是「專案」尺度:

| 用途 | Namespace 規則 | 服務範圍 | 證據 |
|---|---|---|---|
| 生成歷史/偏好記憶 | `user-${userId}` | **整個使用者**(跨所有專案、跨所有生成請求) | ragMemory.ts:179、223 |
| 教材庫(TeachingArchive) | `teaching-${userId}` | 整個使用者的教材庫(跨專案) | 02-fullstack §6.1、E §5.1 |
| Director RAG 注入 | 呼叫 `buildMemoryContext(userId, lastUserMsg)`,底層即上表「生成歷史」namespace | 同上,無 projectId 參數 | E §2「其他」節、costarService.ts:93 |

**核心問題**:`buildMemoryContext(userId, currentPrompt)`(ragMemory.ts:253-267)的函式簽章**只吃 `userId`**,查詢時用 `namespace: user-${userId}` 撈**該使用者名下所有專案的生成歷史**混在一起做向量相似度排序。若一個使用者同時經營兩個世界觀完全不同的專案(例如一個奇幻小說 + 一個科幻短片),向量檢索完全可能把 A 專案的角色偏好記憶注入到 B 專案的生成 prompt 裡——這正是 M2 §6.1 對齊門第 3 點「只用這個專案已知的實體」要防的「杜撰專案外實體」問題的**根源之一**:不是 LLM 幻覺,是 RAG 檢索本身就沒有專案邊界。

同時,`OrbMemorySchema`(shared/orb-memory.ts,經 `queryRagMemory` 使用,ragMemory.ts:284-323)的 metadata 裡也沒有 `projectId` 欄位可過濾——即使想在應用層事後過濾,索引裡也沒有這個 metadata 可查。

**另一半現況(教材+世界觀+資產是否一起 index)**:目前**完全分離**——教材庫(`teachingArchiveRag.ts`)自己一條管線(namespace `teaching-{userId}`),世界觀/角色/場景資料**完全不進 Pinecone**,只透過 `server/subsystems/contextPackets/`(M2 §3.1 已詳細記錄)的 adapter 即時查 MySQL 組 markdown 摘要餵給 LLM(非向量檢索,是結構化直查+拼字串)。資產庫(digital_asset_library)也不在向量索引裡。也就是說:**「教材+世界觀+資產一起 index」目前答案是否定的**——三者用三種完全不同的機制(向量/直查 DB/未索引),AI 若要同時參考「這個專案的世界觀設定」+「使用者過去對這類場景的教材筆記」+「這個專案已生成的資產」,今天沒有一條統一的檢索路徑能把三者按相關性排序後一起送進 prompt。

### 3.2 目標

①RAG 檢索能限定在「單一專案」範圍(至少作為可選的過濾維度,不強制廢除全使用者範圍的檢索,因為某些場景如「這位使用者一貫的美術風格偏好」本來就該跨專案);②教材庫檢索結果能與專案上下文放進同一個候選池讓 LLM 一次判斷相關性,而非目前的「各自一條線,互不知道對方存在」;③`ENABLE_RAG_INJECTION_GUARD` 從預設 OFF 轉為分階段 ON 的計畫(E §9.3 建議 2 已指出這是「純包裹、各注入點旗標 OFF 位元相同已驗證」的低風險項)。

### 3.3 做法

1. **M(3-5 天)——RAG 記憶寫入/查詢加 `projectId` 維度**:
   - `MemoryRecord`(ragMemory.ts:124-132)介面加 `projectId?: number`(optional,向後相容);`upsertMemory` 寫入 metadata 時帶 `projectId`,namespace 維持 `user-${userId}` 不變(**不建議改 namespace 粒度**,Pinecone namespace 數量膨脹會增加管理負擔,且「跨專案的使用者偏好」仍有查詢價值)——改用 metadata filter 做專案範圍收斂:Pinecone query 時加 `filter: { projectId: { $eq: projectId } }`(Pinecone serverless 原生支援 metadata filter,無需額外基建)。
   - `buildMemoryContext(userId, currentPrompt, projectId?: number)` 加第三參數,有 `projectId` 時先用 filter 查「本專案」記憶,查無結果(新專案)才 fallback 全使用者範圍(维持現有行為,零回歸風險——沒傳 `projectId` 的既有呼叫點行為完全不變)。
   - 呼叫端(`director/costarService.ts:93`、光球主聊天記憶組裝階段)比照 M2 §4.2 已設計的「`ai.chat` 加 optional `projectId` 欄位」那條線,把同一個 `projectId` 一併傳給 `buildMemoryContext`——**這兩張卡(本卡 3.3.1 與 M2 Phase 1)是同一條資料流的兩端,建議排在同一個 PR 或緊接的兩個 PR,否則接了 `projectId` 傳遞線卻沒有專案範圍過濾,等於白接**。
2. **M(3-5 天)——教材+世界觀+資產納入同一檢索候選池(不是同一個 index,是同一次查詢的多來源合併)**:
   - 不建議把世界觀/資產也塞進 Pinecone 向量化(世界觀資料量小、結構化程度高,向量化的邊際收益低於直接結構化查詢的精確度,契合 M2 §3.1 已指出的「`contextPacketService` 直查 MySQL 組摘要」現有優勢)。
   - 改在**應用層**做「多來源合併」:新增一個 `buildProjectRagContext(userId, projectId, query)` façade,內部並行呼叫①`buildMemoryContext`(帶 projectId,見上)②`searchTeachingArchive`(帶 userId,若教材有 `projectId` 標記則一併過濾,教材庫目前無 projectId 欄位需先評估是否要補)③`contextPacketService` 的專案摘要(已有,M2 §3.1),三段結果各自標明來源(「本專案上下文」/「你的教材筆記」/「你過去的創作記憶」)後一起組進 system prompt,而不是像現在三條線各自為政、由不同呼叫點各自決定要不要注入。
   - 這個 façade 的輸出天然就是 M2 §6.3「注入端鎖定」設計要用的「`buildOrbSystemPrompt` 只塞這個 projectId 的 contextPacket」那句話的具體實作。
3. **S(≤2 天)——`ENABLE_RAG_INJECTION_GUARD` 分階段開啟計畫**(採 E §9.3 建議 2 的既有結論,本卡只補「怎麼分階段」的具體步驟,不重新論證是否該開):
   - 第一階段:先在 `costarService.ts`(Director,單一進入點)+ 上述新 `buildProjectRagContext` façade 這兩處手動測試旗標 ON 後輸出無位元差異(guard 檔頭已宣稱「純函式,永不 throw,出錯 fallback 原文」,理論上應該零影響);
   - 第二階段:灰度開給 admin 帳號(`isAdminEmail` 判斷,複用既有機制)觀察 1-2 週無異常;
   - 第三階段:全站預設 ON,`ai.chat` 主路徑(7 個接線點,E §5.3 表已列全)一次切換,同時把旗標補進 `env.validated.ts` 的 zod schema(目前不在 schema 內,B-infra E4 已指出的覆蓋缺口之一)。

### 3.4 工作量

`projectId` 維度接線 M;多來源合併 façade M;guard 分階段開啟計畫 S(執行分三階段跨 2-3 週日曆時間,但工程量小)。合計 M-L。

### 3.5 對「AI 可靠讀專案上下文」的貢獻

**最高**。這是本波五卡中唯一直接命中「AI 讀懂單一專案」核心機制的一張——今天 RAG 檢索完全沒有專案邊界這件事,是 M2 方案設計的「防跑偏對齊門」要攔的「杜撰專案外實體」問題的資料層根源;不先把檢索範圍收斂到專案,任何上層的對齊門/prompt 鐵則都只是在攔一個持續被 RAG 自己製造出來的漏洞,治標不治本。

---

## 卡 4 — 0 外鍵取捨 + 孤兒掃描 job

### 4.1 現況(引用 B-infra §2.1、K3 §1 全節,不重複已證實的孤兒清單,只做「取捨文件化+掃描 job 設計」)

`drizzle/schema.ts` 102 張表**確認 0 個 `.references()`/`foreignKey()`**(B-infra §2.1 grep 計數結果),參照完整性完全靠應用層(`USER_OWNED_TABLES`/`deleteTeam()` 等 cleanup 函式)。K3 §1 已用 Python 腳本實證至少 3 類具體孤兒風險(GDPR 刪除清單缺 10 張有效表/多 10 張無效表、團隊刪除漏 7 張表、`resource_shares` 多型關聯三向皆不清)。**這個決策(不上 FK)本身從未在任何文件中被正式承認為「架構決策」**——它散落在各處程式碼行為裡,沒有一份文件寫「我們選擇不用 FK,因為 X,取捨是 Y,補償機制是 Z」。同時,**全 repo 檢查後確認沒有任何孤兒掃描 job**(`server/_core/index.ts` 的 `SCHEDULED_MAINTENANCE_JOBS` 陣列逐條核對,`server/jobs/` 目錄下 22 個 job 檔沒有一個叫 orphan/consistency/integrity 之類名稱;唯一沾到「orphan」字樣的是 `scripts/scan-routes.mjs`,與資料庫無關)。

### 4.2 目標

①把「0 外鍵」正式寫成一份架構決策記錄(ADR),讓下一個工程師/AI 代理不會把它誤判為疏忽而想擅自補 FK(補 FK 在 102 張表、多年生產資料的情況下是高風險操作,需要謹慎評估,不該是"順手修";反過來也不該讓現況繼續無聲累積孤兒列);②有一個排程 job 定期量化「孤兒列有多少」,把 K3 §1 的一次性人工稽核變成持續監控指標,至少做到「這週孤兒列數字比上週多還是少」可觀測。

### 4.3 做法

1. **S(1-2 天)——寫 ADR**:新增 `docs/adr/0001-no-foreign-keys.md`(或併入既有 `docs/` 慣例位置),內容包含:現況(0 FK、102 表)、為何走到這一步(推測:Manus 時期快速迭代、MySQL FK 在高頻 schema 變更下的遷移摩擦成本)、取捨(優點:migration 快、跨表重構不受 FK 約束;缺點:K3 §1 已列的 3 類孤兒風險是**已實現的成本**,非理論)、緩解機制清單(各 `delete*` 函式+本卡新增的掃描 job)、**明確結論**:不建議大規模補 FK(102 表+生產資料,ROI 低於用應用層 + 掃描 job 的組合),但**新表**若明確是強關聯(如 1.1 卡的新 `orb_agent_tasks` 表若引用 `users.id`)可個案評估要不要上 FK。這份文件同時解決 B-infra D14「MySQL 補 FK 或正式文件化」建議項的「文件化」半邊。
2. **M(3-5 天)——孤兒掃描 job**:新增 `server/jobs/orphanScanJob.ts`,比照現有 job 的模式(如 `auditLogPurgeJob.ts`/`assetCleanupJob.ts` 的 cron 註冊寫法):
   - 檢查清單直接沿用 K3 §1 已經找出的具體項目,不必重新分析:①`USER_OWNED_TABLES` 陣列 vs `schema.ts` 實際欄位定義的漂移檢查(K3 §1.1/1.3 的兩個方向:陣列裡沒有 userId 欄的表、有 userId 欄但不在陣列裡的表)——**這部分甚至不需要跑 DB,是靜態程式碼比對**,可以做成一個 build-time/CI 檢查而非 runtime job(見下方「同時建議」);②`teamId` 孤兒列計數(K3 §1.4 列出的 7 張表,逐表 `SELECT COUNT(*) FROM X WHERE teamId NOT IN (SELECT id FROM teams)`);③`resource_shares` 孤兒計數(resourceId/sharedWithId 兩個方向)。
   - 頻率:每日一次(比照 `auditLogPurgeJob` 等維護類 job 的頻率量級),只讀不寫(這是**掃描**,不是自動清理——清理孤兒列涉及資料刪除決策,不該由排程自動做,需人工複核),結果寫進 `system_alerts`(Supabase,若卡2已上軌)或至少寫 structured log + 若數字超過閾值觸發既有 Slack/Discord 告警管道(B-infra §5.3 已有的 `apiUsageAlertJob` 模式可援用其告警 client)。
3. **S(0.5-1 天,同時建議,優先序甚至可排更前面)**:把「§1.1/1.3 的 `USER_OWNED_TABLES` vs schema.ts 欄位漂移比對」寫成一支 vitest(仿 `orphan-migrations-journal.test.ts` 的守門測試模式,K3 §1.3 已指出「migration journal 有守門測試、GDPR 刪除清單完全沒有對應測試」的落差),讓它**進 CI**——這是本卡裡 ROI 最高的單一動作:B-infra D5 記錄 CI 目前 3 秒即死(runner 層問題),一旦 CI 修好,這支測試能防止「陣列與 schema 漂移」這個已發生過的錯誤模式(GDPR 刪除炸掉)重演,且完全不需要跑真實資料庫。

### 4.4 工作量

ADR S;掃描 job M;GDPR 清單漂移守門測試 S。合計 M。三項可獨立排期,建議順序:守門測試(最快見效,防止舊 bug 復發)→ ADR(對齊團隊認知)→ 掃描 job(持續監控,依賴卡2的告警管道則需等卡2部分完成)。

### 4.5 對「AI 可靠讀專案上下文」的貢獻

**低-中**。這張卡主要是資料衛生與 GDPR 合規風險(K3 §1.1 標記的「整條刪除帳號路徑必炸」是獨立於 RAG/代理之外的高優先級 bug,但那是 K3 的範圍,本卡只處理「取捨文件化+持續監控」層級)。對代理讀專案上下文的間接貢獻是:孤兒列(尤其是已刪除專案/團隊留下的殘留資料)若被 `contextPacketService` 等直查 DB 的機制不慎撈到,可能讓 AI 引用到「早已不存在的專案」的殘影資料——掃描 job 至少能讓這類殘影被量化追蹤,不是本卡的主要訴求但值得記錄。

---

## 卡 5 — JSON 欄無驗證 → 加 zod 優先順序

### 5.1 現況(引用 K3 §5 全節,不重複已證實內容,只做「優先順序」設計)

K3 §5.1/5.2 已完整記錄:`drizzle/schema.ts` 至少 22 個 json 欄位,多數 `.json("col").$type<Record<string,unknown>>()` 只是編譯期斷言,無 runtime 驗證;最嚴重案例 `backgroundJobs.resultJson`(schema.ts:312)連 `$type<>()` 都沒有,被 **30 個 server 檔案**共用、8 種 `jobType` 各寫入不同形狀;唯一有完整 zod 把關的正面案例是 `users.quotaJson`(`profile.ts:8-19` 的 `updateQuotaJson`)。

### 5.2 目標

不是「把 22 個 json 欄位一次全部 zod 化」(工作量與風險不成比例,多數是內部產生的欄位、消費端已有防禦性讀取),而是**建立優先順序**,讓後續工程資源投入到影響面最大、風險最高的欄位。

### 5.3 做法:優先順序矩陣

按「消費端數量 × 是否餵給 LLM/影響代理判斷 × 是否使用者可觸達輸入」三個維度排序(前兩者權重最高,因為與本波「AI 可靠讀專案上下文」主題直接相關):

| 優先級 | 欄位 | 理由 | 建議 zod 位置 |
|---|---|---|---|
| **P0** | `backgroundJobs.resultJson`(schema.ts:312) | 30 個消費檔案、8 種 jobType 互不知道對方格式、且是**前端 BackgroundTasksContext 顯示生成結果的唯一資料源**——格式對不上會讓使用者看到「生成完成但結果消失」這類體感 bug,已知風險最高 | 依 jobType 建 discriminated union(`z.discriminatedUnion("jobType", [...])`),寫入時每個 dispatcher(webhookFal.ts/webhookSuno.ts/loraTrainer.ts 等)各自 `.parse()` 後才寫 DB,而非讀取端才防禦 |
| **P1** | 本卡新增的 `orb_agent_tasks.stepsJson`/`auditEventsJson`(若卡1.1 落地) | **這是本波新增的持久化欄位**,不像既有 22 個欄位是歷史負債——新表從一開始就該用 zod schema-first(`OrbAgentTaskStep`/`OrbTaskAuditEvent` 的 TS 介面本身就有明確結構,直接衍生 zod schema 成本很低),避免落地當下就重演 resultJson 的錯誤模式 | 用 `zod` 定義 `OrbAgentTaskStepSchema`/`OrbTaskAuditEventSchema`,DB 讀寫層(repository)強制 `.parse()` |
| **P1** | `contextPackets`/`projectContext` 相關的任何新 json 欄位(若卡3 落地新增 metadata 欄) | 同理,RAG/專案上下文是本波主題核心,任何餵給 LLM 的結構化資料若格式漂移,後果是「AI 讀錯專案上下文」而非單純顯示 bug,優先級應與 P0 同級甚至更高 | 同上,schema-first |
| **P2** | `orb_workflow_templates`/`orb_workflow_executions` 的 `inputs`/`outputs`/`metadata` | 使用者可自訂工作流範本,`inputs` 某種程度是使用者輸入,若格式錯誤會讓 `runWorkflow` 執行時遇到非預期形狀 | 依 `DEFAULT_WORKFLOW`/`workflowSteps.ts` 既有的六步 schema 反推 zod |
| **P3** | 其餘 14+ 個內部 `metadata`/`payload`/`configJson` 欄位(K3 §5.1 清單) | 多數消費端已有 `as Record<string,unknown> \| null` + 可選鏈的防禦性寫法(K3 §5.1 已確認),不會直接崩潰,只是型別不安全;ROI 低於前三級 | 不強制此波處理;若順手改動某個 router 時可個案補 |

### 5.4 工作量

P0(resultJson discriminated union + 5 個 dispatcher 改造)M;P1(新欄位 schema-first,若與卡1/卡3 同 PR 則邊際成本低,幾乎是「順手做對」而非「額外做」)S;P2 S;P3 不排本波。合計本波建議做 P0+P1,約 M。

### 5.5 對「AI 可靠讀專案上下文」的貢獻

**中**。P0(`resultJson`)本身不直接餵給 LLM(是生成結果的展示資料),但 P1(新增的 orbTask/contextPacket 欄位)直接影響代理讀取的結構化上下文正確性——建議把「P1 隨卡1/卡3 一起做」寫進實作備忘,而不是把 zod 化當成獨立的第六張卡,避免新债务与旧债务混在一起排期。

---

## 五卡優先序總表(給下一步排卡參考)

| 卡 | 對「AI 可靠讀專案上下文」貢獻 | 工作量 | 建議順序理由 |
|---|---|---|---|
| 3(RAG 專案範圍化) | 最高 | M-L | 直接命中核心機制,且與 M2 方案 Phase 1(`projectId` 接線)共用同一條資料流,應緊接進行 |
| 1.1(orbTask FSM 落 DB) | 高 | S(止血)+M(正式) | M2 已列為「能力D」地基洞之一;止血步驟(接上既有 `ORB_TASK_STORE_FILE` 選項)成本極低可立即做 |
| 2(雙 DB 收斂) | 中 | M-L(可分批) | 文件修正步驟(2.3-1)零風險應立即做;其餘視卡3/卡1排期空檔插入 |
| 5(JSON zod 化) | 中(P1 部分) | M | P1 應與卡1/卡3 同 PR 執行,不單獨列時程 |
| 1.2(learnHub videos/quizzes) | 中低 | S | 工作量最小、有現成模式可抄,可穿插在其他卡之間當「填空」任務 |
| 1.3(aiModels enrichment) | 低(主要是文件修正) | S | 主要價值是修正既有三份研究文件的誤判,防止下一波重複列債 |
| 4(孤兒掃描+ADR) | 低-中 | M | 守門測試(4.3-3)ROI 最高且與 CI 修復(B-infra D5)綁定,其餘部分無急迫性 |

---

## 未查證聲明

- 未實際跑 Docker/MySQL 驗證卡1.1 的 `orb_workflow_executions` 表結構與 `OrbAgentTask` 介面的欄位映射細節(僅比對 schema.ts 定義與 TS interface,未寫過 migration 草稿或實際跑過欄位對齊)。
- 未查證 `REDIS_URL` 在目前 prod Railway 環境是否確實已設(引用 B-infra §3.2 對 rateLimiter 的既有記錄推論 aiModels enrichment 的 Redis warm/persist 在 prod 應該生效,但未直接連線 prod 環境或 Railway 後台核對)。
- 未查證 Pinecone serverless index 的 metadata filter 在本站現用的 Pinecone 方案/API 版本下是否有效能或配額限制(卡3 的 `filter: { projectId: { $eq } }` 設計基於 Pinecone 官方文件的一般能力,未針對本站實際 index 配置做過負載測試)。
- 未查證教材庫(`teaching_materials`)表是否已有可用的 `projectId`/`creativeProjectId` 關聯欄位(卡3 §3.3-2 提到「教材庫目前無 projectId 欄位需先評估」是基於未在 `drizzle/schema.ts` 教材相關表定義逐欄核對後的推測,建議下一波實讀 `teaching_materials` 表定義確認)。
- `resource_shares`/`creative_projects` 等表在卡4 掃描 job 設計中引用的欄位名稱,沿用 K3 文件既有引用,本波未重新逐一核對行號是否因近期 migration 而位移。
- Supabase `agent_tasks`/`video_projects` 等表的真實 DDL(卡2 §2.3-3 的「baseline migration」做法)未實際透過 `mcp__Supabase__list_migrations`/`get_advisors` 連線查詢,本波僅設計流程,未執行。
