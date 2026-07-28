# T3 — 資料持久化與可靠性修法 PR 級實作 Playbook（實作 playbook wave T）

- 產生日期:2026-07-03
- 依據 commit:`7f4417daaacbf24510dc20d88dba9aae71b2883c`
- 性質:**PR 級實作 playbook**——不重複診斷,直接把 `P6-data-persistence-rag.md`（卡1.1/卡3）、
  `R2-rag-memory-deepdive.md`（§2/§4）、`R4-cost-ledger-deepdive.md`（§4/§6-4）、
  `K3-data-integrity.md`（§2.1/§4/§5）、`M2-project-agent-guidance.md`（§4.2/§4.5/路線圖）
  的既有發現排成三張可動工的 PR。本文件不重新論證問題是否存在,只設計「怎麼改、改哪幾個檔、
  migration 長什麼樣、怎麼測、怎麼判定做完、出事怎麼退」。
- 方法:單一代理(本波),無子代理。實讀 `server/services/orbTaskStateMachine.ts`(1-140 行)、
  `shared/orb-task-state-machine.ts`(全)、`drizzle/0039_orb_long_term_memory.sql`(CREATE TABLE
  IF NOT EXISTS 範例)、`drizzle/0074_fine_tuned_models_team.sql`(guarded ALTER 範例)、
  `server/orphan-migrations-journal.test.ts`(全)、`drizzle/meta/_journal.json`(尾端)、
  `server/services/ragMemory.ts`(100-330 行)、`server/db.ts`(deductUserPoints/refundUserPoints
  全段)、`server/services/cost/ledger.ts`(idempotencyKey 相關段落)、`AGENTS.md`(DB 架構節)、
  `drizzle/schema.ts`(teachingMaterials 定義段),並 grep 全 repo `buildMemoryContext`/
  `deductUserPoints`/`refundUserPoints` 呼叫點清點範圍。

---

## 0. 三張 PR 的關係與排序

```
PR-A(orbTask FSM 落 DB)        ─┐  彼此無強依賴,可平行開工
PR-B(RAG 專案範圍化 + M2 Ph1)   ─┼─ 建議 PR-B 與 PR-C 的「文件修正」半部最先合(零風險)
PR-C(記帳冪等 + 文件修正)       ─┘  PR-C 的「補 idempotencyKey」半部可獨立於 PR-A/B 之後排
```

- 三張 PR 都各自新增/變更一支 migration,**必須依「實際合併順序」而非本文件寫作順序**取得
  `_journal.json` 的 `when`/`idx`——本文件給的數值只是草案示意,真正落地時要重新讀一次
  `drizzle/meta/_journal.json` 尾端取最新值 +1。詳見 §4 共同規範。
- PR-A 與 PR-C 走**不同**的 migration 風格(PR-A/PR-C 新表用 `CREATE TABLE IF NOT EXISTS`;
  PR-B 若做選配 ALTER 用 `information_schema` 守門 + `PREPARE/EXECUTE`),都比照
  `orphan-migrations-journal.test.ts` 已驗證過的兩種既有模式,不發明第三種寫法。

---

## PR-A — orbTask FSM 落 DB(`orb_agent_tasks` 新表)

### 目標

`orbTaskStateMachine.ts:73` 的 `taskStore: Map<string, OrbAgentTask>` 是純模組級記憶體,
Railway redeploy/重啟整批消失,且沒有任何「重啟後標記中斷任務」的機制。目標:多步驟光球代理任務
(11 態 FSM + audit trail)在 redeploy 後不憑空消失;至少讓「進行中」任務在重啟後對使用者顯示
「這個操作被中斷了,要繼續嗎」而非查無此任務或卡住的進度條。對齊 M2 §4.5 路線圖 Phase 4
（「FSM 持久化,與 Phase 0-3 並行皆可,建議在打開任何自主續跑旗標 `ORB_OBSERVATION_LOOP` 前完成」）。

不做:不複用 `orb_workflow_executions`(P6 已證實 `templateId`/`totalSteps` NOT NULL、單一
6 態 status enum 與 `OrbAgentTask` 的 11 態 + `auditEvents[]`/`steps[]` 陣列形狀不對齊,借殼
需要大改既有 `runWorkflow` 消費端,風險與工作量都更高);不處理 `orbTaskStore.ts`(legacy 平行
store)的退場,那是收斂債務,留給後續卡(P6 §1.1 第 3 點)。

### 逐檔改動

| 檔案 | 改動 |
|---|---|
| `drizzle/schema.ts` | 新增 `orbAgentTasks`(表名 `orb_agent_tasks`)、`orbAgentTaskEvents`(表名 `orb_agent_task_events`)兩張 mysqlTable 定義,緊接在既有 `orbWorkflowExecutions`(3185-3226 行)之後,沿用同一個「orb 系列」命名慣例。欄位對齊 `shared/orb-task-state-machine.ts` 的 `OrbAgentTask`/`OrbTaskAuditEvent` 介面(見下方 migration DDL)。**不加 `.references()`**——比照 `drizzle/0039_orb_long_term_memory.sql` 的 `orb_long_term_memories`(有 userId 但無 FK 到 `users`)先例,對齊本站「0 外鍵」既有架構決策(K3 §1、P6 卡4 建議的 ADR 方向),新表個案評估後選擇不上 FK,理由:`users.id`/`orb_workflow_executions.taskId` 皆非強一致性要求,FK 在 102 表 0 FK 的既有基線下屬於例外決策,不需要為單一新表打破既有慣例。 |
| `drizzle/00XX_orb_agent_tasks.sql`(新檔,編號見 §4) | 見下方「migration DDL 草案」。 |
| `drizzle/meta/_journal.json` | 追加一筆 entry(`idx`/`when` 依 §4 規範計算)。 |
| `server/services/orbTaskStore.repository.ts`(新檔) | 新增一層 repository:`saveTaskToDb(task: OrbAgentTask)`、`loadTaskFromDb(taskId): Promise<OrbAgentTask \| null>`、`loadRecentTasksFromDb(userId, limit)`、`markOrphanedTasksOnBoot()`。內部用 `stepsJson`/`auditEventsJson` 兩個 json 欄位打包 `steps[]`/`auditEvents[]`(對齊 P6 卡5 建議的「新欄位 schema-first」——見下方「zod schema」段落),寫入前用 `OrbAgentTaskStepSchema`/`OrbTaskAuditEventSchema`(新增於 `shared/orb-task-state-machine.ts`)`.parse()`,避免落地當下就重演 `resultJson` 的無驗證錯誤模式。 |
| `server/services/orbTaskStateMachine.ts` | `taskStore.set(taskId, task)` 的每個呼叫點(建立任務、`pushEvent`、狀態轉換)之後,fire-and-forget 呼叫 `saveTaskToDb(task)`(仿 `ragMemory.upsertMemory` 的 try/catch 靜默降級寫法,DB 寫入失敗不擋主流程,只 `console.warn`);讀取路徑(`getOrbAgentTask`/`listRecentOrbAgentTasks`)先查 RAM `taskStore`,**miss 時 fallback 查 DB**(`loadTaskFromDb`)並回填 RAM,讓「剛重啟、RAM 是空的」情境下舊任務仍查得到。 |
| `server/_core/index.ts` | `SCHEDULED_MAINTENANCE_JOBS` 陣列新增一個一次性開機任務(非 cron,是啟動時執行一次):呼叫 `markOrphanedTasksOnBoot()`——把 DB 裡 `status` 屬於非終態(`executing`/`paused`/`awaiting_approval`/`recovering`/`planning`)但 `updatedAt` 早於本次程序啟動時間的任務列,批次 `UPDATE ... SET status='blocked'`(FSM 既有 11 態已含 `blocked`,不新增狀態值,只是賦予「因重啟而中斷」的語意)並補一筆 `task.manual_intervention` 型 audit event(既有 `OrbTaskAuditEvent.type` 已含此值,不需擴充 union)。 |
| `client/src/`(FSM 任務清單/狀態輪詢的前端消費端,精確路徑待實作時 grep `listRecentOrbAgentTasks`/`getOrbAgentTask` 的呼叫點) | 對 `status==='blocked'` 且帶有「因重啟」metadata 標記的任務,文案改成「這個操作被中斷了,要繼續嗎」而非泛用的「已封鎖」文案(小改,非本 PR 阻塞項,可同批或緊接 PR 補)。 |
| `shared/orb-task-state-machine.ts` | 新增 `OrbAgentTaskStepSchema`(zod,對應 `OrbAgentTaskStep` 介面)、`OrbTaskAuditEventSchema`(zod,對應 `OrbTaskAuditEvent`)並 export,供 repository 層 `.parse()` 使用。 |

### migration DDL 草案

編號以「PR-A 假設最先合併」示意,實際編號依 §4 規範在合併當下重算。

```sql
-- 0107: orbTask FSM 落 DB（orb_agent_tasks / orb_agent_task_events）
-- 讓多步驟光球代理任務狀態與 audit trail 在 redeploy 後不丟失。
-- 對齊「0 外鍵」既有架構決策：無 .references()，比照 0039_orb_long_term_memory 先例。

CREATE TABLE IF NOT EXISTS `orb_agent_tasks` (
  `taskId` varchar(64) NOT NULL,
  `userId` int NULL COMMENT 'nullable：少數 test/scaffold 呼叫點無 userId（見 createOrbAgentTaskFromPlanner 註解）',
  `traceId` varchar(64) NOT NULL,
  `planId` varchar(64) NULL,
  `status` ENUM(
    'idle','planning','awaiting_approval','approved','executing',
    'paused','recovering','completed','failed','cancelled','blocked'
  ) NOT NULL DEFAULT 'idle',
  `currentStepId` varchar(64) NULL,
  `agentRole` varchar(64) NULL,
  `riskLevel` varchar(32) NULL,
  `priority` ENUM('urgent','normal','background') NOT NULL DEFAULT 'normal',
  `predecessorTaskId` varchar(64) NULL,
  `iterationIndex` int NOT NULL DEFAULT 0,
  `retryBudget` int NULL,
  `retryCount` int NOT NULL DEFAULT 0,
  `stepsJson` json NULL COMMENT 'OrbAgentTaskStep[]，寫入前經 OrbAgentTaskStepSchema.parse()',
  `metadata` json NULL,
  `orphanedAt` timestamp NULL COMMENT '開機 sweep 標記此任務因重啟而中斷的時間；NULL=非因重啟中斷',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`taskId`),
  KEY `orb_agent_tasks_user_idx` (`userId`),
  KEY `orb_agent_tasks_status_idx` (`status`),
  KEY `orb_agent_tasks_user_status_idx` (`userId`, `status`),
  KEY `orb_agent_tasks_updated_idx` (`updatedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `orb_agent_task_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `eventId` varchar(64) NOT NULL,
  `taskId` varchar(64) NOT NULL COMMENT '無 FK，對齊 0 外鍵既有決策；應用層保證寫入時 orb_agent_tasks 列已存在',
  `traceId` varchar(64) NOT NULL,
  `type` varchar(64) NOT NULL COMMENT 'OrbTaskAuditEvent["type"] union 值，寫入前經 OrbTaskAuditEventSchema.parse()',
  `message` text NOT NULL,
  `metadata` json NULL,
  `timestamp` bigint NOT NULL COMMENT '對應 OrbTaskAuditEvent.timestamp（Date.now() 毫秒），與 createdAt 分開存以保留原始事件時序',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `orb_agent_task_events_eventId_uk` (`eventId`),
  KEY `orb_agent_task_events_task_idx` (`taskId`),
  KEY `orb_agent_task_events_type_idx` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**設計取捨備忘**:
- `auditEvents[]` 拆成獨立表(而非塞單一 `auditEventsJson` json 欄)——理由:P6 §1.1 建議「或拆成獨立
  `orb_agent_task_events` 表以利查詢/清理」,且 audit trail 是無上限增長的陣列(長任務可能有幾十筆
  事件),塞單一 json 欄會讓每次 `pushEvent` 都要整欄重寫、行變大;拆表用 append-only INSERT,寫入
  成本固定、未來要做「清理超過 N 天的舊 task 事件」也只是單表 `DELETE ... WHERE createdAt < ...`。
- `stepsJson` 維持單一 json 欄(不拆表)——理由:`steps[]` 陣列長度有限(通常個位數步驟)、整批讀寫
  頻率高(每次狀態機推進都要讀完整步驟清單判斷下一步),不像 audit event 是純粹的 append-only 稽核紀錄。

### 測試

1. **Migration 冪等性測試**(新增進 `server/orphan-migrations-journal.test.ts` 同一份檔案的既有
   `describe` 區塊,或緊鄰的新 `it`):比照現有「create-table-style orphans」測項的斷言邏輯——
   `CREATE TABLE` 數量與 `CREATE TABLE IF NOT EXISTS` 數量相等、無裸 `ALTER`/`CREATE INDEX`。
   這支新 migration 一開始就登記進 journal(不是「孤兒後補登記」),但沿用同一組冪等性斷言函式,
   確保新表從第一天就符合既有治理標準,而非等下一波清孤兒時才補測試。
2. **Repository 層單元測試**(新檔 `server/services/orbTaskStore.repository.test.ts`):
   - `saveTaskToDb` → `loadTaskFromDb` round-trip,確認 `stepsJson` 序列化/反序列化後與原物件深相等。
   - 傳入不符 `OrbAgentTaskStepSchema` 形狀的物件時,`saveTaskToDb` 拋出可辨識的驗證錯誤(而非
     靜默寫入壞形狀 json,重演 `resultJson` 的錯誤模式)。
   - `markOrphanedTasksOnBoot()`:seed 3 筆任務(`executing`/`completed`/`failed`),執行 sweep 後
     只有 `executing` 那筆變成 `blocked` 且 `orphanedAt` 非 null,其餘兩筆狀態不變、`orphanedAt`
     維持 null。
3. **FSM 整合測試**(擴充既有 `orbTaskStateMachine.test.ts`,若不存在則新增):模擬「建立任務→
   推進兩步→(不呼叫任何清空)重新 `import()` 模組(模擬程序重啟後 RAM Map 是空的)→呼叫
   `getOrbAgentTask(taskId)`」,斷言仍能從 DB fallback 讀回任務且欄位與重啟前一致。
4. **回歸測試**:確認 DB 寫入失敗(mock `saveTaskToDb` throw)不影響 FSM 主流程——任務仍能推進
   到下一步,只在 log 出現 warning,呼應「fire-and-forget,失敗不擋主流程」的設計承諾。

### 驗收

- [ ] `orb_agent_tasks`/`orb_agent_task_events` migration 在乾淨 DB 套用成功;重跑第二次(模擬
      `MIGRATION_FAIL_CLOSED=true` 下的整段重跑)no-op 成功。
- [ ] 建立一個多步驟光球任務,推進到 `executing`,手動重啟本機 dev server 程序,`getOrbAgentTask`
      仍能查到該任務(從 DB fallback),且狀態顯示為 `blocked`(因重啟中斷),前端顯示「被中斷,
      要繼續嗎」而非「查無此任務」。
- [ ] `stepsJson`/`auditEventsJson` 寫入前皆過 zod `.parse()`;刻意餵一個缺欄位的假物件觸發驗證
      錯誤,確認不會寫入壞形狀資料。
- [ ] DB 寫入失敗(模擬斷線)不阻塞任務狀態機正常推進(fire-and-forget 承諾成立)。
- [ ] `orphan-migrations-journal.test.ts` 全綠(journal `when` 嚴格遞增、idx 不重複、有對應 .sql
      檔、新 migration 冪等性斷言通過)。

### 風險與回滾

- **風險**:寫穿 DB 讓每次狀態轉換多一次 round-trip,若 fire-and-forget 的 promise 未正確處理
  (忘記 `.catch()`)可能產生 unhandled rejection 噪音——實作時比照 `ragMemory.upsertMemory` 的
  `try/catch` 包法,不留裸 promise。
- **風險**:`markOrphanedTasksOnBoot()` 若判斷邏輯有誤(例如把「剛好在啟動瞬間仍在跑」的任務
  誤判為孤兒),可能誤傷正常任務——緩解:只在**開機時**跑一次(不是持續輪詢),且只處理
  `updatedAt` 早於「本次程序啟動時間」的列,理論上一個健康程序處理中的任務其 `updatedAt` 必然
  是最近的,不會被誤判。
- **回滾**:新表、新 repository 層皆為**加法**,不改動既有 `taskStore` Map 的行為(只是多一層
  DB 鏡射),可用 feature flag(如 `ENABLE_ORB_TASK_DB_PERSIST`,預設先 OFF 灰度)包住整個
  repository 呼叫,關閉旗標即完全恢復 PR 前行為(純 RAM,無 DB 寫入/讀取)。若旗標 ON 後發現
  問題,直接關閉旗標即可,無需回滾 migration(新表留著不影響任何現行功能)。

### 工作量

止血步驟(P6 已建議的「先接上既有 `ORB_TASK_STORE_FILE` 選項」)可視為本 PR 的 S 級子集,若時間
緊迫可先只做這步再排正式落地;完整版(新表 + repository + orphan sweep + zod schema + 前端文案)
估 **M-L**(3-8 天),對齊 P6 原估。

---

## PR-B — RAG 專案範圍化(`projectId` 維度接線,與 M2 Phase 1 同批)

### 目標

`buildMemoryContext(userId, currentPrompt)`(`ragMemory.ts:253`)只吃 `userId`,查詢時用
`namespace: user-${userId}` 撈**該使用者名下所有專案**的生成歷史混在一起做向量相似度排序——
兩個世界觀不同的專案會互相污染彼此的 RAG 注入,這是 M2 對齊門「只用這個專案已知的實體」要防的
「杜撰專案外實體」問題的資料層根源之一(R2/P6 均已定位)。目標:RAG 檢索能限定在「單一專案」
範圍(作為可選過濾維度,不強制廢除全使用者範圍檢索),且與 M2 §4.2(Phase 1:`ai.chat` 加
optional `projectId` 欄位、接上 `contextPacketService`)排進**同一批**——這兩條資料流本該同時
落地,否則「接了 `projectId` 傳遞線卻沒有專案範圍過濾」等於白接(P6 §3.3 已明講此依賴)。

**範圍收斂**(避免第一個 PR 就鋪太大面):本 PR **只做**①`ragMemory.ts` 核心函式簽章 + Pinecone
metadata filter,②`ai.chat`(`server/routers/ai.ts`)與 `costarService.ts` 兩個**主聊天/Director**
呼叫點接上 `projectId`。**不做**(留給後續 PR):`buildProjectRagContext` 多來源合併 façade
(P6 §3.3 第 2 點,façade 需要教材庫/contextPacket 都先接好 projectId 才有意義,是更大範圍的整合
工作);`ENABLE_RAG_INJECTION_GUARD` 分階段開啟計畫(P6 §3.3 第 3 點,獨立旗標時程,不阻塞本 PR);
`generate.ts`/`planningService.ts`/`routers.ts`(legacy)三個次要呼叫點的 `projectId` 傳遞——先
在最高價值的兩個入口驗證行為正確,再擴散到其餘呼叫點,降低單一 PR 的回歸面。

### 逐檔改動

| 檔案 | 改動 |
|---|---|
| `server/services/ragMemory.ts` | `MemoryRecord` 介面(124-132 行)加 `projectId?: number`(optional)。`upsertMemory()`(134-186 行)寫入 Pinecone metadata 時多帶一個 `projectId: record.projectId ?? null` 欄位(namespace **維持 `user-${userId}` 不變**,不新增 namespace)。`queryMemories()`(200-249 行)簽章加 `projectId?: number`,有值時在 Pinecone query body 加 `filter: { projectId: { $eq: projectId } }`;**查無結果時(新專案、尚無該專案歷史記憶)自動 fallback 成不帶 filter 的全使用者範圍查詢**(維持現有行為,零回歸風險——沒傳 `projectId` 的既有呼叫點行為完全不變)。`buildMemoryContext(userId, currentPrompt, projectId?: number)`(253-267 行)加第三參數,原樣往下傳。 |
| `server/services/director/costarService.ts` | `:117` 的 `buildMemoryContext(userId, lastUserMsg)` 呼叫改傳 `buildMemoryContext(userId, lastUserMsg, projectId)`——`projectId` 來源與 M2 §4.2 第二點「`director.chat` 補上 `projectId`」是同一條線,兩者在同一個 PR 內完成,避免「旗標開了但沒人傳值」的半殘狀態。 |
| `server/routers/ai.ts` | `ai.chat` 的 input zod schema(對齊 M2 §4.2 第一點)加一個 optional `projectId` 欄位。記憶組裝階段(既有呼叫 `buildMemoryContext`/`upsertMemory` 之處,`:26` import)一併傳入 `input.projectId`。**這一步與 M2 §4.2 的 `contextPacketService` 接線共用同一個 `projectId` 輸入來源**,建議由同一位工程師或同一個 PR 完成兩件事,避免兩個 PR 各自定義 `projectId` 的傳遞路徑導致不一致。 |
| `server/routers/generate.ts`(`:681` 呼叫點) | **本 PR 不改**——留 TODO 註解說明「待 PR-B 驗證主路徑無誤後,下一個 PR 接上 `projectId`」,避免範圍蔓延。 |
| `server/routers/director.ts`、`server/services/director/planningService.ts`(`:251`)、`server/routers.ts`(legacy `:116`) | **本 PR 不改**,同上理由。 |
| `shared/orb-memory.ts`(`OrbMemorySchema`) | 若 `queryRagMemory`/`searchOrbMemoriesWithRag` 的 metadata 也要支援 `projectId` 過濾,本 PR **不強制**——P6 §3.1 已指出這是 B-1(orbMemory)的獨立 schema,不在 `buildMemoryContext` 的直接依賴鏈上,列為後續卡。 |

### migration DDL 草案

**核心變更本身不需要 MySQL migration**——Pinecone 是 schemaless 的 metadata store,加
`projectId` 欄位只是在既有 upsert/query 的 JSON body 多帶一個 key,不需要對 index 做結構變更。

**選配**(不阻塞本 PR 主線,可同批或下一個 PR 做):P6/R2 均指出教材庫(`teaching_materials`)
目前**沒有** `projectId`/`creativeProjectId` 欄位可標記(本次已實讀 `drizzle/schema.ts:4013-4060`
確認),若未來要讓 `buildProjectRagContext` façade(P6 §3.3 第 2 點)把教材也納入專案範圍過濾,
需要先補這個欄位。草案(guarded ALTER 風格,比照 `0074_fine_tuned_models_team.sql`):

```sql
-- 01XX: teaching_materials 加 creativeProjectId（選配，為未來的專案範圍教材過濾鋪路）
-- 冪等版：欄位/索引存在就 SELECT 1，不存在才建立。本欄位 nullable，不影響既有「跨專案教材庫」語意
-- （P6 §3.3：教材庫本質仍是跨專案資產，此欄位只是「可選標記」，非強制歸屬）。

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'teaching_materials'
      AND column_name = 'creativeProjectId'
  ),
  'SELECT 1',
  'ALTER TABLE `teaching_materials` ADD COLUMN `creativeProjectId` int NULL'
);
--> statement-breakpoint
PREPARE tm_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE tm_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE tm_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'teaching_materials'
      AND index_name = 'tm_creativeProjectId_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `tm_creativeProjectId_idx` ON `teaching_materials` (`creativeProjectId`)'
);
--> statement-breakpoint
PREPARE tm_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE tm_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE tm_stmt;
```

若本 PR 不做這個選配欄位,則 PR-B **不新增任何 migration 檔**——只改 TS 程式碼與 Pinecone
metadata 形狀,這點在 PR 描述裡要明講,避免 reviewer 找不到 migration 檔而誤以為漏做。

### 測試

1. **`ragMemory.test.ts`**(新增或擴充既有測試檔):
   - `queryMemories(userId, prompt, topK, projectId)` 帶 `projectId` 時,mock fetch 斷言送出的
     query body 含 `filter: { projectId: { $eq: projectId } }`。
   - 不帶 `projectId` 時,query body **不含** `filter` 欄位(逐位元比對舊行為,零回歸驗證)。
   - mock 「filter 查無結果」情境(matches 空陣列),斷言自動 fallback 成不帶 filter 重查一次。
2. **`upsertMemory` 測試**:帶 `projectId` 時 metadata 含該欄位;不帶時 metadata 該欄位為
   `null`(不是 `undefined`,避免 Pinecone 端行為因欄位缺失/null 不一致而分岔)。
3. **`costarService.test.ts`**(擴充既有 world-context-injection 測試模式,`:65` 已有
   `buildMemoryContext: vi.fn(async () => "")` mock 範例可援用):斷言呼叫 `buildMemoryContext`
   時第三參數等於當前 `projectId`。
4. **`ai.chat` 契約測試**:input schema 接受 optional `projectId`(數字/undefined 皆合法),
   缺省時整條記憶組裝行為與 PR 前一致(零回歸)。
5. **並行測試**(呼應 M2 §6 對齊門的「零回歸」要求):同一支測試檔驗證「沒有 active project 時,
   `projectId` 不傳,行為完全不變」,避免這個接線意外影響到目前**沒有**專案概念的舊生成流程
   (如首頁快速生成)。

### 驗收

- [ ] 兩個世界觀不同的專案(同一使用者)分別產生幾筆生成記憶後,對 A 專案提問時 RAG 注入的
      「歷史創作偏好」只包含 A 專案的記憶,不包含 B 專案的。
- [ ] 新專案(尚無任何該專案範圍記憶)提問時,RAG 注入 fallback 到全使用者範圍記憶(不是空白),
      確認「查無結果才 fallback」的降級路徑生效。
- [ ] 未傳 `projectId` 的既有呼叫路徑(若本 PR 範圍內有保留的舊呼叫點)行為與 PR 前逐位元一致。
- [ ] `ai.chat`/`director.chat` 兩個入口皆能正確把當前 `projectId` 傳到 `buildMemoryContext`。
- [ ] Pinecone metadata filter 的 API 呼叫在 staging 環境實測一次(呼應 P6「未查證 Pinecone
      serverless metadata filter 效能/配額限制」),確認延遲與配額在可接受範圍。

### 風險與回滾

- **風險**:Pinecone metadata filter 在本站現用方案下的效能/配額特性未經負載測試(P6 未查證項)
  ——緩解:先在 staging 用真實流量模式跑一段時間觀察延遲分佈,若 filter 導致查詢明顯變慢,
  fallback 邏輯本身就是天然的降級路徑(filter 失敗或逾時可視同「查無結果」處理,直接查全範圍)。
- **風險**:`projectId` 帶錯值(例如前端傳了別的使用者的 projectId)不會造成安全問題(Pinecone
  namespace 仍是 `user-${userId}`,filter 只在該使用者自己的向量子集內縮小範圍,不會跨使用者
  洩漏),但可能讓使用者查不到自己的記憶(filter 過嚴)——這正是「查無結果就 fallback」設計要
  兜底的情境。
- **回滾**:`ragMemory.ts` 的簽章變更是**加法**(新增 optional 參數),舊呼叫點不傳等同 PR 前
  行為;若上線後發現 filter 邏輯有問題,可只回退 `costarService.ts`/`ai.ts` 兩個呼叫點改回不傳
  `projectId`(單行改動),不需要回退整個 migration 或 `ragMemory.ts` 的介面變更。

### 工作量

`ragMemory.ts` 核心改動 + 兩個呼叫點接線:**M**(3-5 天,含測試)。選配的教材庫欄位:**S**
(0.5-1 天,獨立於主線)。合計 **M**,與 M2 Phase 1 工作量估計一致(本卡與 M2 §4.2 是同一條
資料流的兩端,建議同一位工程師或緊接的兩個 PR 完成,避免介面對不上)。

---

## PR-C — 記帳冪等 + 文件修正

### 目標

兩件事分開看但同一 PR 一起做(都是低風險、對齊「記帳系統」主題):

1. **文件修正(零風險,優先序最高)**:`AGENTS.md` §「DB 架構」第 57 行寫「`providerHealthProbeJob`
   用 **Supabase client SDK** 寫入,目標正確是 `system_alerts`」,但實讀
   `server/jobs/providerHealthProbeJob.ts:12,224-280` 證實該檔案 import 的是 Drizzle
   `orbSystemAlerts` 並寫 **MySQL**——連「權威分工說明文件」自己都是錯的,比沒有文件更危險
   (下一位工程師或下一輪 AI 代理會照著錯誤描述去改代碼)。R4 §1/§2 也指出 `ENABLE_COST_LEDGER`
   的檔頭註解「HARD SAFETY:OFF 時接線端完全不進入本模組」只對 aiProxy 的單維度分錄成立,
   `costAttribution.ts`/`skillOrchestrator.ts` 兩條路徑各自只檢查 `isCostAttributionEnabled()`
   (預設 ON),完全不理會 `ENABLE_COST_LEDGER`——這句「HARD SAFETY」檔頭註解對讀者是誤導性的。
2. **`deductUserPoints`/`refundUserPoints` 補冪等鍵**:`server/db.ts:808-921` 兩個函式都只有
   `SELECT ... FOR UPDATE` 交易鎖(保證同使用者並發序列化),完全沒有 `idempotencyKey`/去重機制
   ——鎖只保證「不會同時跑兩次」,不保證「同一筆邏輯事件不會被呼叫兩次」(例如重試/雙重 webhook
   觸發同一次退款)。對照 `cost_ledger` 的 `postEntry`/`postTransaction` 有 `idempotencyKey`
   UNIQUE 約束雙保險(快路徑查詢 + DB UNIQUE INDEX 撞鍵回退),**點數經濟的扣退款反而是全鏈中
   冪等性最弱的一段,而它才是唯一真正影響使用者餘額的路徑**(R4 §4 已下此判斷)。

### 逐檔改動

| 檔案 | 改動 |
|---|---|
| `AGENTS.md`(§「DB 架構」,約 43-64 行) | 把第 57 行「`providerHealthProbeJob` 用 **Supabase client SDK** 寫入,目標正確是 `system_alerts`」改成如實描述:「⚠️ 已知落差(見 K3-data-integrity.md §2.1、B-infra.md §2.4#1):`providerHealthProbeJob.ts` 目前實際 import Drizzle `orbSystemAlerts` 並寫入 **MySQL** `orb_system_alerts`,與本節『規則』宣稱的 Supabase SDK 寫入方式不符,屬已知技術債。管線停滯/心跳告警(`detect_pipeline_stall`)才是真正走 Supabase 的部分」。 |
| `drizzle/schema.ts`(`:3411-3416` `orbSystemAlerts` 定義旁的既有註解) | 補一行「⚠️ 本註解與 `providerHealthProbeJob.ts` 實際行為不符,見 AGENTS.md『DB 架構』節」,讓兩處文件互相指向,不再各說各話。 |
| `server/services/cost/ledger.ts`(檔頭 `HARD SAFETY` 註解) | 改寫成如實描述:「本旗標(`ENABLE_COST_LEDGER`)只控制 `aiProxy.ts` 直接呼叫的單維度 `member` 分錄;多維度歸屬分錄(project/workflow/skill)由 `ENABLE_COST_ATTRIBUTION`(預設 ON)獨立控制、不受本旗標影響。`ENABLE_COST_LEDGER=OFF` 時 `cost_ledger` 表**不是空的**——outbox drain(`costAttributionOutboxJob`)持續在寫。見 R4-cost-ledger-deepdive.md §1/§2」。 |
| `server/jobs/costLedgerReconcileJob.ts`(`:130` 附近的 gate 註解) | 補充註解說明「本 job 目前被 `isCostLedgerEnabled()` 擋住不執行,是**意外的**副作用(見 R4 §2),並非設計上『`ENABLE_COST_LEDGER=OFF` 時 ledger 表為空所以不用比對』——真實情況是 outbox drain 一直在寫。**若之後要拆開兩個旗標的耦合(見改進提議),必須先修這裡的比對公式(只比對 `accountKey LIKE 'member:%'`),否則會在多維度分錄下產生持續性假 drift 告警**」——本 PR 只補註解對齊事實,**不改**比對公式本身(那是 R4 §6 建議 2 的獨立工作項,涉及告警行為變更,風險層級不同,留給後續 PR)。 |
| `server/db.ts` | `deductUserPoints(userId, pointsAmount, idempotencyKey?: string)`、`refundUserPoints(userId, pointsAmount, idempotencyKey?: string)` 簽章各加一個 optional 第三參數。函式內部(既有 `db.transaction` 區塊內,`FOR UPDATE` 鎖之後):若傳入 `idempotencyKey`,先 `SELECT 1 FROM points_transaction_log WHERE idempotencyKey = ?`(在同一個 transaction 內,與既有 `FOR UPDATE` 鎖共用同一把交易,不需要額外鎖);已存在則直接回傳「視為已處理」的結果(帶目前餘額,不重複 mutate)並提早 return;不存在則照舊執行 `UPDATE users SET remainingGenerations = ...`,並在同一個 transaction 內 `INSERT INTO points_transaction_log`(`idempotencyKey` 上有 UNIQUE 約束當最終防線,呼應 `cost_ledger.postEntry` 的「先查快路徑 + DB UNIQUE 撞鍵回退」雙保險模式)。**不傳 `idempotencyKey` 時行為與 PR 前完全一致**(純加法,零回歸)。 |
| `server/services/orbCostGuard.ts`(`reconcileCredits`) | 呼叫 `deductUserPoints`/`refundUserPoints` 時開始傳入一個依「任務 ID + reconcile 動作類型」衍生的 `idempotencyKey`(比照 `cost_ledger` 的做法,用穩定字串雜湊,例如 `reconcile:${taskId}:${action}`),堵住 R4 §4 指出的「reconcile 中途崩潰、重啟後重複調整」風險。 |
| `server/services/postGenActions.ts`、`server/routers/proStudio.ts`、`server/routers/director.ts`、`server/routers/generate.ts`(既有 61 個呼叫點中,已有 `atomicClaimJobRefund` CAS 旗標防護的較新任務流程) | **本 PR 不強制全面改**——優先只在 `orbCostGuard.reconcileCredits`(上面已列,R4 §4 明確指出的高風險 race 場景)加冪等鍵;其餘呼叫點的 `idempotencyKey` 採「有走 `atomicClaimJobRefund` 的流程,順手把該任務既有的 CAS 旗標值當作 `idempotencyKey` 傳入」的漸進策略,列為本 PR 的「選配加分項」,不是驗收阻塞項——避免為了追求「一次改完 61 處」而讓 PR 過大、審查困難、回歸風險上升。 |

### migration DDL 草案

```sql
-- 01XX: 點數扣退款冪等去重表（points_transaction_log）
-- deductUserPoints / refundUserPoints 補 idempotencyKey；對照 cost_ledger 已有的
-- idempotencyKey UNIQUE 約束模式，堵住「同一筆邏輯事件被呼叫兩次」的重複扣款/退款風險
-- （R4 §4：目前鎖只保證同使用者並發序列化，不保證同一事件不重放）。
-- 對齊 0 外鍵既有架構決策：無 .references() 到 users。

CREATE TABLE IF NOT EXISTS `points_transaction_log` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `idempotencyKey` varchar(191) NOT NULL COMMENT '呼叫端衍生的穩定去重鍵，如 reconcile:<taskId>:<action>',
  `direction` ENUM('deduct', 'refund') NOT NULL,
  `points` int NOT NULL,
  `balanceAfter` int NOT NULL COMMENT '此筆操作完成後 users.remainingGenerations 的值，供事後稽核',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ptl_idempotencyKey_unique` (`idempotencyKey`),
  KEY `ptl_user_idx` (`userId`),
  KEY `ptl_user_direction_idx` (`userId`, `direction`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**設計取捨備忘**:這張表刻意設計成「輕量去重日誌」而非完整覆寫 `cost_ledger` 的複式記帳模型——
`points`(使用者點數經濟)與 `cost_ledger`(USD 真實成本)本來就是 R4 §4 指出的「兩個互不同步、
互不校驗的數字系統」,本 PR 的範圍是**補冪等**,不是「把點數也記成複式帳本」(那是更大範圍的
架構統一工作,不在本波範圍)。

### 測試

1. **文件修正無需程式測試**,但建議加一個輕量 grep 守門(可選,非阻塞):CI 裡一支簡單腳本/測試
   確認 `AGENTS.md` 與 `providerHealthProbeJob.ts` 兩處對「寫入哪個 DB」的描述**不再互相矛盾**
   ——例如檢查 `AGENTS.md` 是否含「已知落差」關鍵字段落,避免未來有人「修正」程式碼卻忘了同步
   更新文件(或反過來)。此項為加分項,不因缺少而卡驗收。
2. **`deductUserPoints`/`refundUserPoints` 冪等測試**(擴充既有 `server/atomic-deduction.test.ts`/
   `server/points-billing-audit.test.ts`):
   - 同一個 `idempotencyKey` 連續呼叫 `deductUserPoints` 兩次,斷言 `users.remainingGenerations`
     只被扣一次(第二次呼叫回傳「已處理」結果,不重複 mutate)。
   - 併發呼叫(用 `Promise.all` 同時發起兩個帶相同 `idempotencyKey` 的呼叫)斷言最終只有一筆
     `points_transaction_log` 記錄(UNIQUE 約束擋下重複 insert,呼應 `cost_ledger.postEntry` 的
     雙保險測試模式)。
   - **不傳 `idempotencyKey` 時行為與 PR 前逐位元一致**(既有測試 `server/aidv-620-suno-orphan-refund.test.ts`/
     `server/aidv-771-orphan-refund.test.ts` 全部維持綠燈,零回歸)。
3. **`orbCostGuard.reconcileCredits` 冪等整合測試**:模擬「reconcile 呼叫 `deductUserPoints` 後、
   更新任務狀態前」程序崩潰重啟,重放同一次 reconcile,斷言使用者餘額不會被二次調整。
4. **Migration 測試**:沿用 `orphan-migrations-journal.test.ts` 既有的 create-table-style 冪等性
   斷言函式,驗證新 migration 符合既有兩種風格之一。

### 驗收

- [ ] `AGENTS.md`「DB 架構」節文字與 `providerHealthProbeJob.ts` 實際行為一致,不再自相矛盾。
- [ ] `drizzle/schema.ts` 的 `orbSystemAlerts` 定義旁註解與 `AGENTS.md` 互相指向。
- [ ] `cost/ledger.ts` 檔頭「HARD SAFETY」註解如實反映 `ENABLE_COST_LEDGER` 只控制單維度分錄的
      事實,不再誤導讀者以為它是 `cost_ledger` 表的唯一總開關。
- [ ] `deductUserPoints`/`refundUserPoints` 帶相同 `idempotencyKey` 重複呼叫,只扣/退一次點數。
- [ ] `orbCostGuard.reconcileCredits` 的 race 場景(reconcile 中途崩潰重放)不會二次調整餘額。
- [ ] 既有記帳相關測試(`atomic-deduction`/`points-billing-audit`/`aidv-620-suno-orphan-refund`/
      `aidv-771-orphan-refund`)全數維持綠燈,零回歸。

### 風險與回滾

- **風險**:`points_transaction_log` 的 `INSERT` 與 `UPDATE users` 若沒有包在同一個
  `db.transaction` 內,可能出現「扣款成功但去重記錄沒寫入」的不一致視窗——實作時**必須**把
  查重、UPDATE、INSERT 三步驟都放進既有的 `db.transaction(async tx => {...})` 區塊內(與現有
  `FOR UPDATE` 鎖同一個 transaction),不能拆成兩個獨立呼叫。
- **風險**:文件修正本身零程式碼風險,但若 `AGENTS.md` 未來被其他 PR 依賴既有(錯誤)文字做
  判斷,修正後可能讓某個依賴舊描述的假設暴露——影響面評估為低(K3/R4 已證實錯誤文字目前只是
  誤導閱讀者,未發現有程式碼邏輯依賴這段註解文字本身)。
- **回滾**:`idempotencyKey` 是 optional 加法參數,不傳等同 PR 前行為,可安全逐步在各呼叫點
  灰度導入;若 `points_transaction_log` 表本身有問題,移除 `idempotencyKey` 檢查邏輯(改回
  直接執行 UPDATE)即可完全回退,新表閒置不影響任何現行功能。文件修正無需回滾機制(文字變更
  本身無風險)。

### 工作量

文件修正(`AGENTS.md` + `schema.ts` 註解 + `ledger.ts` 檔頭):**S**(半天內)。
`deductUserPoints`/`refundUserPoints` 冪等鍵 + `orbCostGuard` 接線 + 測試:**S-M**(2-3 天)。
合計 **S-M**,是三張 PR 中風險與工作量最低的一張,建議**優先合併**(尤其文件修正半部應立即做,
零風險且能立刻停止「下一個工程師照錯誤文件改代碼」的持續傷害)。

---

## 4. 三張 PR 共同的 migration 規範(呼應既有治理模式)

以下規則不是本文件新發明,是把 `server/orphan-migrations-journal.test.ts` 已經驗證過的既有紀律
寫成三張 PR 都要遵守的檢核清單:

1. **`when` 嚴格遞增,`idx` 不可重複**:三張 PR 的作者在**實際合併當下**(不是寫 PR 描述時)都要
   重新 `cat drizzle/meta/_journal.json` 讀最後一筆 entry 的 `when`/`idx`,新 entry 用「最後一筆
   `when` + 86400000(既有慣例,約 1 天間距)」與「最後一筆 `idx` + 1」——本文件給的 `0107`/`01XX`
   編號只是示意,若 PR-A/B/C 沒有照本文件寫作順序合併(例如 PR-C 先合),後合併的 PR 作者必須
   重算,不能沿用本文件寫死的數字,否則會重演 `AGENTS.md:21` 記錄的「差點倒退 #954 journal」事故。
2. **合併前必 `git fetch` + rebase 到最新 `origin/main`**(既有 `AGENTS.md` 規則),尤其三張 PR
   若平行開發,谁先合併谁的 journal entry 先定案,後合併者要 rebase 後在自己的 entry 前面看到
   前一張 PR 的 entry,而非各自假設自己是「唯一新增者」。
3. **新表一律 `CREATE TABLE IF NOT EXISTS`**(PR-A 的 `orb_agent_tasks`/`orb_agent_task_events`、
   PR-C 的 `points_transaction_log`);**對既有表的欄位/索引新增一律走 `information_schema` 守門
   + `PREPARE`/`EXECUTE` 動態語句**(PR-B 選配的 `teaching_materials.creativeProjectId`)——不
   混用、不裸寫 `ALTER TABLE`/`CREATE INDEX`(MySQL 不支援 `CREATE INDEX IF NOT EXISTS`)。
4. **`MIGRATION_FAIL_CLOSED` 已在 prod 開啟**(`server/_core/env.validated.ts:386` 預設
   `"false"`,但 prod 實際設為 `true`,`server/_core/index.ts:459-466` 對應邏輯)——這代表三張
   PR 的 migration 若套用失敗會**擋住整個 Railway 部署啟動**,不是「記錄錯誤後繼續開機」。實作
   時必須比照 `server/migration-fail-closed.test.ts`/`server/migration-prod-pending-block.test.ts`
   已驗證的模式,在本機用 Docker MySQL 對「已套用到當前基準 schema 的 DB」實跑驗證:①乾淨套用
   成功、②重跑第二次 no-op 成功、③模擬「fail-closed 整段重跑」(刪掉尾端記帳、結構已存在)仍
   冪等成功——這是 `orphan-migrations-journal.test.ts` 檔頭註解已明講的上線前提,三張 PR 都要
   过一遍,不能只跑過 CI 裡的靜態斷言就假設安全。
5. **每張 PR 的 migration 都要新增或擴充對應的冪等性斷言測試**(比照 §PR-A/PR-C 已列的測試項),
   不能只依賴人工 review——`orphan-migrations-journal.test.ts` 本身的存在理由就是「migration
   journal 有守門測試、其他資料完整性清單(如 GDPR 刪除清單)完全沒有對應測試」的落差(K3 §1.3
   已指出),三張 PR 都應該避免重演「新增機制卻不補對應守門測試」的模式。

---

## 未涵蓋範圍(明確排除,留給後續卡)

- P6 卡2(雙 DB 分工收斂,雙告警表單軌化 + Supabase 核心表 DDL 收編 + 身分映射對照表)——本波
  PR-C 只修文件文字本身,**不做**告警表單軌化的程式碼改動(那是 M-L 工作量的獨立卡)。
- P6 卡4(0 外鍵 ADR + 孤兒掃描 job)、卡5(JSON zod 化 P0 `resultJson` discriminated union)——
  未排入本波三張 PR,PR-A 的 `stepsJson`/`auditEventsJson` zod schema 是卡5 P1 項目的「順手做對」,
  但卡5 P0(`resultJson`)本身不在本波範圍。
- R2 §4 指出的 C-1(`orbLongTermMemory`)「寫了沒人讀」死胡同、B-2/B-1 正則抽偏好重工、
  `embeddingVector` 死欄位——本波三張 PR 皆未觸碰記憶分層的這些既有缺口,只處理 orbTask FSM 與
  RAG 的 `buildMemoryContext` 這條線。
- R4 §6 建議 2(重寫 `costLedgerReconcileJob` 比對公式,使其正確處理多維度 debit)、建議 5
  (補齊 fal_ai/gemini 的 providerSnapshot 真實帳單輪詢)——PR-C 只在 `costLedgerReconcileJob.ts`
  補註解說明現況,**不改**比對公式本身,那涉及告警行為變更,需要獨立 PR 與 staging 對帳週期驗證
  (R4 §6 建議 3 已明講的安全順序)。
- PR-B 的 `buildProjectRagContext` 多來源合併 façade(P6 §3.3 第 2 點)、`ENABLE_RAG_INJECTION_GUARD`
  分階段開啟計畫(P6 §3.3 第 3 點)、`generate.ts`/`planningService.ts`/`routers.ts` 三個次要
  `buildMemoryContext` 呼叫點的 `projectId` 接線——留給 PR-B 之後的下一張卡。
- M2 Phase 0(178-tool gate 修復)、Phase 2(引導狀態機從 /video 解放)、Phase 3(防跑偏對齊門)
  ——本波三張 PR 只對齊 M2 Phase 1(專案上下文接線,PR-B)與 Phase 4(FSM 持久化,PR-A),
  Phase 0/2/3 是獨立的工作流卡,不在資料持久化/可靠性這個主題範圍內。
- 未實跑 Docker/MySQL 驗證任何一支 migration DDL 草案的實際套用行為(§4 已列為上線前提,但
  本文件本身是紙上設計,尚未實作與實跑)。
