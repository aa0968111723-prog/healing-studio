# SD2 — migration ↔ schema 不同步
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:drizzle/*.sql、drizzle/meta/*_snapshot.json vs drizzle/schema.ts

方法論:先讀檔案（`drizzle/*.sql` 111 支、`drizzle/meta/_journal.json`、`drizzle/meta/*_snapshot.json`、`drizzle/schema.ts` 4758 行）,
再用腳本化 Grep/正則交叉比對「schema.ts 宣告的 102 張表/欄位」↔「migration 實際 CREATE TABLE / ALTER TABLE ADD COLUMN」，
並讀 `node_modules/drizzle-orm/migrator.js` + `mysql-core/dialect.js` 原始碼確認 drizzle 實際套用順序演算法（不臆測)。「使用點」一律以 Grep 對
`server/`、`client/`、`shared/` 全域搜尋變數名/表名確認,查無使用才標「未使用」。

---

## 發現（依嚴重度排序）

### 1.〔高〕drizzle-kit 的 snapshot 追蹤機制在第 9 支 migration 後就被放棄——往後 98 支全靠手寫,`generate` 已不可信任
- **檔案:行號**
  - `drizzle/meta/` 目錄只有 `0000_snapshot.json` ~ `0008_snapshot.json`（`ls drizzle/meta/*_snapshot.json` 確認,共 9 個檔,無 `0009_snapshot.json` 起的任何檔案)。
  - `drizzle/schema.ts`（全檔 4758 行,102 張 `mysqlTable(...)`)現在的實際表數是 **102**,而最後一份 snapshot `drizzle/meta/0008_snapshot.json` 裡只有 **24 張表**。
  - `drizzle/meta/_journal.json` 共 111 筆條目（對應 `drizzle/*.sql` 111 個檔案,idx 0–110)。
  - `drizzle.config.ts:1-15`:`schema: "./drizzle/schema.ts"`、`out: "./drizzle"`、`dialect: "mysql"` — 標準 drizzle-kit 設定,理論上 `generate` 仍可被任何人執行。
  - `package.json:25`:`"db:push": "drizzle-kit migrate"`（腳本名稱是 `db:push` 但實際指令是 `migrate`,無 `db:generate` 腳本 — 附帶的 naming-drift,見第 7 點）。
- **佐證**:0000–0007 的檔名都是 drizzle-kit 自動產生的形容詞+名詞亂數（`0000_giant_reptil`、`0001_panoramic_night_thrasher`…),`0008_numerous_mother_askani`（journal idx 8)也是同一亂數命名慣例、且是 `0008_snapshot.json` 唯一對得上的內容（該 snapshot 含 `orb_feedback_events`,正是這支 migration 建的表;不含 `ai_usage_events`/`provider_snapshots`/`cost_aggregations`/`rate_limit_rules`/`alert_configs` — 那是"另一個" 0008,見第 3 點)。從 idx 9（`0008_admin_api_usage`)開始,之後全部 98 支檔名都是人手描述性命名（`admin_api_usage`、`prompt_library_generation_mode`…),且完全沒有再產生任何 snapshot。這是「drizzle-kit generate 從此沒被跑過,全靠人手寫 SQL + 手動在 `_journal.json` 補一筆」的直接證據。
- **影響**:任何人現在若執行 `npx drizzle-kit generate`,diff 引擎只會拿「落後 102-24=78 張表、上百個欄位」的 `0008_snapshot.json` 當作基準狀態去對比目前的 `schema.ts`,極可能產生一支想要重新 `CREATE TABLE`／`ALTER TABLE ADD COLUMN` 這 78 張表相關內容的「假新增」migration。若這支被誤跑到已存在 78 張表的環境（dev 或 prod）,會直接因表/欄位已存在而炸機;結合 `server/db.ts` 的 `MIGRATION_FAIL_CLOSED=true`（prod 已開啟）,會直接擋住開機/部署。
- **建議**:凍結 `drizzle-kit generate` 的使用（在 README/CONTRIBUTING 明示「本專案 migration 一律手寫,禁止跑 generate」),或投入一次性工作把 `meta/` snapshot 追上目前 102 表的真實狀態,兩者擇一,否則 snapshot 機制對現況只有誤導風險、沒有實益。
- cluster: migration-schema-mismatch

### 2.〔高〕migration 0059 對 4 張表加了 5 欄 + 1 個 functional index,`schema.ts` 完全沒有對應宣告,程式碼也零使用
- **檔案:行號**
  - `drizzle/0059_media_archival_fields.sql`（全檔 328 行):對 `drive_asset_libraries`（L26-97)、`teaching_materials`（L103-174)、`consistency_vault`（L180-251)、`r2_storage_snapshots`（L257-328)四張表,各自用 information_schema 守門的 idempotent stored procedure 加了 `sourceUrl TEXT`、`provider VARCHAR(32)`、`archivedAt TIMESTAMP`、`expiresAt TIMESTAMP`、`archivalChecksum VARCHAR(64)` 五個欄位,以及一個 `*_archivedNull_createdAt_idx` functional index。
  - `drizzle/schema.ts:578-597`（`driveAssetLibraries`)、`:719-740`（`consistencyVault`)、`:1940-1949`（`r2StorageSnapshots`)、`:4013-4139`（`teachingMaterials`)——四個表定義區塊逐一核對,**皆無** `sourceUrl`/`provider`/`archivedAt`/`expiresAt`/`archivalChecksum` 欄位,索引清單裡也沒有對應的 `archivedNull_createdAt` idx。
  - 對照組（同一 migration 註解裡自陳"沿用 0058"的正確案例):`drizzle/0058_asset_history_archival_fields.sql` 對 `digital_asset_library`／`generation_history` 加的同一組 5 欄,`schema.ts` 的 `digitalAssetLibrary`（約 L331 起)與 `generationHistory:935-966` **確實有**逐欄宣告與對應 index（`gh_archivedNull_createdAt_idx` 等),證明「補寫回 schema.ts」原本是既有流程,只有 0059 這次漏掉。
- **使用點 Grep 確認**:`grep -rn "archivalChecksum" server client shared` 只命中測試檔（`server/services/__tests__/mediaArchivalService.test.ts`、`server/history-rating-model-pick.test.ts`、`server/history-ownership-idor.test.ts`),且都是針對 `generationHistory`（0058 的表)造 fixture,與 0059 的四張表無關。實際歸檔 worker `server/services/mediaArchivalService.ts` 逐行 Grep（`digitalAssetLibrary`/`generationHistory` 各出現十餘次)完全沒有 `driveAssetLibraries`/`consistencyVault`/`r2StorageSnapshots`/`teachingMaterials` 字樣——四張表的歸檔欄位從沒被任何服務讀寫過。
- **影響**:若 0059 在 prod 已套用（idempotent guard,理論上會套用成功),DB 裡實際多出 20 個欄位 + 4 個 index,但因為 Drizzle 的型別層完全不知道它們存在,應用程式永遠無法透過 ORM 讀寫——是「建了但打從一開始就沒人用得到」的 migration-schema-mismatch,且與程式碼零耦合、無法被既有測試發現。
- **建議**:若確認這 4 張表未來仍要走歸檔流程,把 5 欄 + index 補進 `schema.ts` 對應區塊（比照 `generationHistory` 寫法);若確認用不到,考慮出一支 migration `DROP COLUMN`/`DROP INDEX` 收斂,並在 PR 說明是否要保留 0058 那組真正在用的欄位。
- cluster: migration-schema-mismatch

### 3.〔高〕0008 檔名重號——不只一組,共 6 組重號,其中 3 組「檔名字母序」與「實際套用序」相反
- **檔案:行號**
  - `drizzle/0008_numerous_mother_askani.sql`（14 行,建 `orb_feedback_events`)vs `drizzle/0008_admin_api_usage.sql`（73 行,建 `ai_usage_events`/`provider_snapshots`/`cost_aggregations`/`rate_limit_rules`/`alert_configs`)。
  - `drizzle/meta/_journal.json`:`numerous_mother_askani` 是 idx **8**（when=1776622268401),`admin_api_usage` 是 idx **9**（when=1776622268402)——journal 陣列序與 `when` 都嚴格遞增,但兩者檔名同為 `0008`,`ls drizzle/*.sql` 的字母序（`admin_api_usage` < `numerous_mother_askani`)剛好與實際套用序相反。
  - 全庫掃描（`ls drizzle/*.sql` 依 4 碼前綴分組)另外還有 **5 組**重號:`0033`（`add_plan_status_to_sessions` vs `agent_model_picks`)、`0067`（`creative_projects` vs `repair_worldbuilding_v4_columns`)、`0080`（`agent_concurrency_registry` vs `refresh_tokens`)、`0081`（`orchestration_priority_scope` vs `user_workflows`)、`0082`（`data_source_expiry` vs `learn_modules`)。逐一對照 journal 序:**0008、0033、0082** 三組是「字母序 ≠ 套用序」（0033 尤其嚴重:`add_plan_status_to_sessions` 字母序在前,但 journal 序在 idx 73,遠晚於 `agent_model_picks` 的 idx 33);`0067`、`0080`、`0081` 三組剛好字母序與套用序一致,純屬巧合。
  - 已讀原始碼確認機制:`node_modules/drizzle-orm/migrator.js:12-28`（`readMigrationFiles` 只依 `journal.entries` 陣列序讀檔,不理檔名排序)+ `node_modules/drizzle-orm/mysql-core/dialect.js:40-50`（比對 DB 內 `__drizzle_migrations.created_at` 最大值 vs 每筆 `folderMillis`,只套用 `when` 更大的)。
- **驗證(負向結果)**:全庫 `_journal.json` 111 筆條目「`when` 嚴格遞增」「`idx` 唯一」「`tag` 唯一」皆通過腳本檢查,無違規——目前這 6 組重號**不會**造成 `drizzle-kit migrate` 實際套用順序錯誤,純粹是檔名層級的可讀性/維運陷阱。`dev-environment/migrate-debug.mjs:21-25` 這支除錯腳本本身也是照 `journal.entries` 走、不是 glob 檔名排序,寫法正確,無風險。
- **影響**:任何人若用 `ls drizzle/*.sql | sort` 或直覺的「檔名數字=時間序」去重建套用歷史、寫維運文件、或做 code review 判斷「這支 migration 是不是比較晚」,在這 3 組（0008/0033/0082)上都會得到相反答案。這是純粹的人為/工具風險,不是資料庫層 bug,但過去 6 次重號代表產生新 migration 檔時完全沒有查重機制。
- **建議**:在建立新 migration 的流程（無論是 script 或人工)加一道「檢查 4 碼前綴是否已存在」的 guard;若要治理既有重號,只能重新 renumber 全部後續檔名並同步改 `_journal.json`,风险高,建議維持現狀但在 CONTRIBUTING 明確記載這個陷阱與判斷方式（一律以 `_journal.json` 陣列序為準,不要看檔名)。
- cluster: naming-drift

### 4.〔高,延伸 DI-01〕deleteUserAccount 的 69 張「使用者擁有表」清單裡,11 張表根本沒有 `userId` 欄位——精確定位到會 100% 觸發 rollback 的第一張表
- **檔案:行號**
  - `server/db.ts:5300-5370`（`USER_OWNED_TABLES` 常數,69 張表)+ `server/db.ts:5386-5388`（迴圈內固定寫死 `` `DELETE FROM \`${table}\` WHERE userId = ?` ``)。
  - 逐表比對 `drizzle/schema.ts` 定義,以下 11 張表**沒有任何欄位字面對應到 `userId`**（Grep 每張表的 `mysqlTable` 區塊確認):
    - `prompt_assets`（`schema.ts:1820` 起)——欄位只有 `promptId`/`assetId`/`relation`/`createdAt`,是 prompt↔asset 的關聯表,沒有 user 欄。
    - `external_service_subscriptions`（`schema.ts:1919`)——擁有者欄是 `ownerEmail`,不是 `userId`。
    - `cost_aggregations`（`schema.ts:2111`)——`provider`/`endpoint`/`date`/`callCount`… 純粹是全站彙總表,設計上就不屬於任一使用者。
    - `cost_ledger`（`schema.ts:2159`)——擁有者欄是 `accountKey`,無 `userId`。
    - `cost_attribution_outbox`（`schema.ts:2230`)——`idempotencyKey`/`payloadJson`…,無 user 欄。
    - `alert_configs`（`schema.ts:2279`)——全域告警設定,無 user 欄。
    - `fine_tuned_model_consents`（`schema.ts:2414`)——只有 `modelId`/`consentId`,是關聯表。
    - `orb_spirit_collaboration_metrics`（`schema.ts:3310`)——聚合指標表,無 user 欄。
    - `orb_system_alerts`（`schema.ts:3418`)——系統告警,無 user 欄。
    - `data_source_connections`（`schema.ts:3889`)——擁有者欄是 `ownerUserId`,不是 `userId`。
    - `real_earth_entries`（`schema.ts:4244`)——建立者欄是 `createdBy`,不是 `userId`。
  - `USER_OWNED_TABLES` 陣列序中,`prompt_assets` 是第 **26** 個元素（早於上面其餘 10 張),迴圈固定依序執行,因此 `deleteUserAccount` 對任何使用者呼叫,都會在跑到 `prompt_assets` 時對 MySQL 送出 `Unknown column 'userId' in 'where clause'`（error 1054),而不是「部分表沒刪乾淨」——因為整段包在同一個 `manager.executeTransaction(...)` 交易裡,這個錯誤會讓**前面已成功刪除的 25 張表也一併 rollback**,等於 GDPR 刪帳號功能對任何人都 100% 失敗,而不是部分失敗。
- **影響**:確認/精確化已知 DI-01(userId vs user_id vs ownerUserId vs createdBy 命名不一致導致全 rollback)的具體觸發點與失敗表——不是「偶爾」而是「每次呼叫必炸,且必炸在同一張表」。
- **建議**:`USER_OWNED_TABLES` 需要改成「表名 + 該表實際擁有者欄名」的 pair(或改用 drizzle schema 物件而非裸表名字串,讓 TypeScript 在編譯期就能挡掉打錯欄名),並把明顯不屬於單一使用者的彙總/關聯表（`cost_aggregations`、`alert_configs`、`orb_spirit_collaboration_metrics`、`fine_tuned_model_consents`、`prompt_assets`…)移出這份清單,改用它們的關聯路徑(例如 `fine_tuned_model_consents` 應該透過 `consentId` 反查 `model_training_consents.userId` 再刪)。
- cluster: naming-drift

### 5.〔中〕`schema.ts` 完全沒有宣告任何 FK 關聯,但 migrations 實際建立了至少 21 條真正的 `FOREIGN KEY` 約束——「102 表 0 FK」只在 schema.ts 這層成立,DB 層不是
- **檔案:行號**
  - 全域 Grep:`grep -c "\.references(\|foreignKey(" drizzle/schema.ts` → **0**。確認 102 張表在 Drizzle 型別層完全沒有宣告任何一條關聯。
  - 但下列 7 支 migration 用原生 SQL 建立了 21 條 `FOREIGN KEY`/`CONSTRAINT ... FOREIGN KEY`:
    - `drizzle/0027_agent_collaboration_persistence.sql:27,55,77,94`——`agent_collaboration_sessions.user_id → users.id`、`agent_collaboration_steps/messages/handoffs.collaboration_id → agent_collaboration_sessions.collaboration_id`。
    - `drizzle/0039_orb_long_term_memory.sql:59,61`——`orb_memory_associations.fromMemoryId/toMemoryId → orb_long_term_memories`。
    - `drizzle/0040_orb_intent_clarification.sql:55`——`orb_clarification_history.intentLogId → orb_intent_logs`。
    - `drizzle/0042_orb_workflow_templates.sql:56,82`——`orb_workflow_executions.templateId`、`orb_workflow_step_executions.executionId`。
    - `drizzle/0044_orb_template_ratings_and_alerts.sql:21`——`orb_workflow_template_ratings.templateId`。
    - `drizzle/0055_teaching_archive_fk.sql:21,27,33,39,45,51,57,63`——`teams.ownerId`、`team_memberships.teamId/userId/invitedBy`、`teaching_materials.userId/teamId`、`teaching_material_access_log.materialId/userId` → `users`/`teams`/`teaching_materials`。
    - `drizzle/0075_prompt_assets.sql:80,89`（guarded ALTER,idempotent)——`prompt_assets.promptId/assetId → prompt_library/digital_asset_library`。
- **影響**:「102 表 0 FK」作為 schema.ts 型別層的描述是準確的(0 處 `.references()`),但若拿來推論「DB 層也沒有任何外鍵約束、可以隨意 DELETE 而不會被擋」則不準確——上述至少 13 張表(若這些 migration 確實套用成功)在 DB 層是有 `ON DELETE CASCADE`/`SET NULL` 或無動作的硬約束的,`deleteUserAccount` 用 `SET FOREIGN_KEY_CHECKS = 0` 繞過這些約束(`server/db.ts:5383`)也間接印證程式作者知道 DB 層是有 FK 存在、才需要主動關閉檢查。
- **需再查(Railway 查證)**:以上 7 支 migration 是否真的在 prod 套用成功、FK 約束目前是否還存在,需要對 Railway 生產 MySQL 執行 `SELECT * FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY'` 才能確認;本稽核僅能確認「migration 檔裡寫了什麼」,無法確認「prod DB 實際狀態」。
- cluster: migration-schema-mismatch

### 6.〔中,需再查〕`server/db.ts:5350` 註解自陳「MySQL legacy name; Supabase prod table is "system_alerts"」——疑似雙資料庫(MySQL/Drizzle vs Supabase/Postgres)命名不一致,超出本次掃描範圍
- **檔案:行號**:`server/db.ts:5350`,`USER_OWNED_TABLES` 陣列中 `"orb_system_alerts", // MySQL legacy name; Supabase prod table is "system_alerts"`。
- repo 裡另外還有一整套獨立的 `supabase/migrations/*.sql`（23 支,Postgres 方言,例如 `20260629_aidv718_system_alerts_write_paths.sql`),與本次稽核範圍 `drizzle/*.sql`（MySQL 方言)是兩套不同的 migration 系統。
- **本次未展開**:此為 SD2 宣告範圍（`drizzle/*.sql`、`drizzle/meta/*_snapshot.json` vs `drizzle/schema.ts`)之外的第二套資料庫/migration 系統,不臆測其現況,建議另立稽核項目比對 `supabase/migrations/*.sql` 與其對應 schema 定義。
- cluster: other

---

## 負向結果(Negative Results——已查證、確認「沒有問題」的項目)

1. **表級 CREATE TABLE 覆蓋率完整**:`schema.ts` 102 張 `mysqlTable(...)` 逐一比對,**每一張**都能在 111 支 migration 檔的某處找到對應 `CREATE TABLE`(含大小寫、`IF NOT EXISTS` 變體),沒有「只靠手動 DB / `drizzle-kit push` 建立、migration 從未建過」的表。
2. **無孤兒 migration**:`drizzle/*.sql` 111 個檔案與 `drizzle/meta/_journal.json` 111 筆條目一一對應,無任何一支 `.sql` 檔缺席於 journal、也無任何 journal 條目缺對應檔案——`server/orphan-migrations-journal.test.ts` 描述的 AIDV-17（過去孤兒 migration 事故)的補登記,在目前這個 commit 上完整成立、沒有新孤兒。
3. **journal 排序健康**:`_journal.json` 111 筆條目的 `when` 欄位嚴格遞增、`idx` 與 `tag` 皆唯一——雖然檔名重號(見發現 3),但 journal 本身的排序與去重完整,`drizzle-kit migrate` 的實際套用順序目前正確。
4. **system_settings 不是 migration/schema 不同步**:`drizzle/0004_past_pandemic.sql`(建表)與 `drizzle/schema.ts:1055` 起的 `systemSettings` 定義逐欄比對,27 個欄位**完全一致**——已知的「19 欄死」(L3)是應用層未讀寫的問題(dead-column),不是本次 SD2 範圍的 migration↔schema 不同步,兩者需分開追蹤,不要誤併。
5. **0058 archival 欄位是正確案例**:與發現 2 對照,`digital_asset_library`/`generation_history` 的同一組 5 個 archival 欄位在 0058 之後**有**正確補進 `schema.ts`(`generationHistory:935-966` 等),證明「migration 加欄位後同步補 schema.ts」原本是團隊既有習慣,只有 0059 這批漏掉——非系統性問題,是單次遺漏。
6. **除錯腳本寫法正確**:`dev-environment/migrate-debug.mjs` 套用 migration 時是照 `_journal.json` 的陣列序讀檔並依序執行,不是用 `ls`/glob 對檔名排序——不受發現 3 的檔名重號影響。

---

## 附:方法與限制
- 所有「使用點」判斷均以 `grep -rn` 對 `server/`、`client/`、`shared/` 全域搜尋變數名/欄位名/表名後確認,未查得任何引用才標「未使用」;未能查證之處一律寫「需再查」,不臆測。
- 本報告僅比對 repo 內的 `drizzle/*.sql`、`drizzle/meta/*_snapshot.json`、`drizzle/schema.ts` 三者的靜態內容,**未連線 Railway 生產資料庫**,無法確認上述 migration 是否都已在 prod 實際套用成功、或套用時是否失敗於某一半(尤其發現 5 的 FK 約束、發現 2 的 archival 欄位)。所有需要連線 prod 才能下結論的項目已在對應段落標「需再查(Railway 查證)」。
