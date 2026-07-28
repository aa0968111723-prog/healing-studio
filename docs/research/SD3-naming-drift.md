# SD3 — 命名漂移(userId 家族 + camelCase/snake_case)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:drizzle/schema.ts 所有使用者/擁有權欄位命名 + 對應查詢

方法論:通讀 `drizzle/schema.ts`(4758 行,102 張 `mysqlTable(...)`,`git diff 812f6fdb HEAD -- drizzle/schema.ts` 確認自該 commit 以來無異動),對每一個語意為「使用者/擁有者」的欄位讀 schema 定義,再用 Grep 對照 `server/db.ts`、`server/routers/**`、`client/src/**` 找出實際查詢/刪除路徑,絕不臆測「有沒有被用」。已確認 102 表、0 個 `.references()`/`foreignKey()`(`grep -c` = 0),與既有 baseline 一致。

---

## 一、關鍵發現(依嚴重度排序)

### 1.〔critical〕`deleteUserAccount` 100% rollback 的精確根因:`prompt_assets` 完全沒有使用者欄位
- **發現**:`server/db.ts:5300-5370` 的 `USER_OWNED_TABLES` 陣列第 26 個元素是 `"prompt_assets"`;對照 `drizzle/schema.ts:1820-1842`(`promptAssets` = `mysqlTable("prompt_assets", { id, promptId, assetId, relation, createdAt })`),**整張表沒有任何 userId / user_id / ownerId 之類的欄位**——它是 `prompt_library` × `digital_asset_library` 的純 junction 表。`server/db.ts:5386-5388` 的迴圈對每張表執行字面 SQL `` DELETE FROM `${table}` WHERE userId = ? ``(5387),對 `prompt_assets` 執行時 MySQL 會直接丟 `Unknown column 'userId' in 'where clause'`。
- **機制確認**:`server/_core/DatabaseManager.ts:347-379` 的 `executeTransaction` 在 `executor` 拋出任何錯誤時,一律 `connection.rollback()`(367)後 rethrow(375)——不是「跳過壞表繼續」。因此 for 迴圈跑到第 26 個元素炸掉時,前 25 張表(`login_history`…`user_subscriptions` 等,行 5301-5329)已經成功刪除的資料**全部被 rollback**,`users` 本體列(5390)也從未執行到。
- **影響**:這就是 DI-01「帳號刪除 100% 失敗、PII 全殘留」的**確切、單一、每次都在同一點**的根因——不是隨機失敗,是每次都在跑到 `prompt_assets` 時炸,100% 重現。使用者按下刪除鍵、API 回應(若上層有 try/catch 吞錯)可能顯示成功,但資料庫其實什麼都沒刪。
- **建議**:立即把 `USER_OWNED_TABLES` 從「表名陣列 + 硬編 `userId` 欄名」改成「`{table, column}` 對照表」,`prompt_assets` 這類無使用者欄位的 junction 表改用子查詢(`DELETE FROM prompt_assets WHERE promptId IN (SELECT id FROM prompt_library WHERE userId=?)`)。此建議與既有 `docs/research/DI0-data-integrity-map.md:88`(G4,critical)的結論一致,本次以行號精確釘死。

### 2.〔critical〕修完第 1 點後,USER_OWNED_TABLES 陣列中至少還有 6 張表會用同樣方式再炸一次(完全沒有使用者欄位)
逐表確認(依陣列出現順序,均已用 Grep+Read 讀過 schema 定義,無使用者/擁有者欄位):

| # in array | 表名 | schema.ts 行號 | 實際欄位(無 user 概念) |
|---|---|---|---|
| 28 | `external_service_subscriptions` | 1919-1934 | 純後台維運資料(`serviceName`/`ownerEmail`/`riskLevel`),`ownerEmail` 是文字信箱不是 FK |
| 32 | `cost_aggregations` | 2111-2130 | 按 `provider`+`date` 聚合,無 user 維度 |
| 33 | `cost_ledger` | 2159-2211 | `accountKey`(自由字串鍵)+ `projectId`/`workflowId`(varchar),無 `userId` |
| 34 | `cost_attribution_outbox` | 2230-2255 | 只有 `payloadJson`,無 user 欄位 |
| 35 | `alert_configs` | 2279-2289 | 純告警設定(`alertType`/`thresholdPct`),無 user 欄位 |
| 37 | `fine_tuned_model_consents` | 2414-2426 | 只有 `modelId`+`consentId`(junction 表) |
| 50 | `orb_system_alerts` | 3418-3457 | 純系統監控告警,無 user 欄位;且 3412-3417 明文註解「MYSQL LEGACY — not used in Postgres/Supabase prod. 真正的 prod 表是 Supabase `system_alerts`,`providerHealthProbeJob` 是用 Supabase client SDK 寫入,不經這個 Drizzle 物件」(AIDV-726/730)——這張表被放進 GDPR 刪除清單完全沒有意義,它既不含使用者資料也不是真正在用的表 |

- **影響**:即使把發現 1 的 `prompt_assets` 修好,`deleteUserAccount` 也不會真的成功——迴圈會在下一張「完全沒有 userId 欄位」的表(依序是 `external_service_subscriptions`)重演一模一樣的錯誤。這 7 張表全部要從「逐表 `WHERE userId=?`」模式移除,因為它們的資料本質上就不是「per-user 擁有」,留在 `USER_OWNED_TABLES` 本身就是設計誤植。
- **建議**:先把這 7 張表從 `USER_OWNED_TABLES` 移除(它們本來就不該在 GDPR 個資刪除清單裡),`orb_system_alerts` 另外標記「MySQL 側為 legacy、真正需要清理的是 Supabase `system_alerts`,GDPR 刪除流程需另開 Supabase 分支處理」。

### 3.〔high〕修完發現 1、2 後,清單裡还有 4 张表命名與硬編 `userId` 不符,會再炸第三輪——`userId` 家族完整清單(同語意不同命名)
逐一確認 DB 欄位實際名稱(非只看 TS 屬性名):

| 語意 | JS 屬性名 | 實際 DB 欄位名 | 表(schema.ts 行號) | 是否在 `USER_OWNED_TABLES`(server/db.ts:5300) |
|---|---|---|---|---|
| 使用者 | `userId` | **`userId`**(camelCase,絕大多數表採此) | 約 60+ 張表(如 `login_history` 259、`digital_asset_library` 335…) | 大多是 |
| 使用者 | `userId` | **`user_id`**(snake_case) | `agent_collaboration_sessions`(2434-2469,欄位 2438)、`orb_conversations`(2709-2732,欄位 2713)、`orb_conversation_messages`(2737-2768,欄位 2744,**不在清單內**)、`agent_dlq`(2660-2697,欄位 2666,**不在清單內**)、`timeline_frames`(3596-3629,欄位 3602,**不在清單內**)、`scene_compositions`(3637-3664,欄位 3643,**不在清單內**)、`video_analytics`(4737-4755,欄位 4743,nullable,**不在清單內**) | `agent_collaboration_sessions`✅、`orb_conversations`✅ 兩張**在清單內**,會因欄名不符再炸 |
| 擁有者 | `ownerUserId` | `ownerUserId` | `data_source_connections`(3889-3931,欄位 3893) | ✅ 在清單內(`data_source_connections`,5356),硬編 `WHERE userId=?` 對這張表**完全篩不到列**(欄位根本不叫 userId,MySQL 仍會報 Unknown column) |
| 建立者/擁有者 | `createdBy` | `createdBy`(int) | `real_earth_entries`(4244-4343,欄位 4320,nullable)、`project_data_access_rules`(3843-3879,欄位 3866) | 僅 `real_earth_entries` ✅ 在清單內(5358) |
| 建立者(字串,非 FK) | `createdBy` | `createdBy`(varchar 64) | `orb_long_term_memories`(2838-2890,欄位 2909) | 不在清單內(語意是「哪個 spirit/agent 建立」,非使用者 id,型別也不同,容易與上一列混淆) |
| 團隊擁有者 | `ownerId` | `ownerId` | `teams`(4146-4160,欄位 4153) | 不在清單內(團隊非個人資料,合理) |
| 操作者 | `actorUserId` | `actorUserId`(nullable) | `global_audit_log`(4357-4407,欄位 4362) | 不在清單內 |
| 分享建立者 | `sharedByUserId` | `sharedByUserId` | `resource_shares`(4432-4478,欄位 4452) | 不在清單內(既有 `docs/research/DI0-data-integrity-map.md:15` O1 已指出) |
| 作者 | `authorUserId` | `authorUserId`(nullable) | `news_articles`(1129-1199,欄位 1176) | 不在清單內 |
| 提交者 | `curatorUserId` | `curatorUserId`(nullable) | `featured_showcase`(1202-1297,欄位 1262) | 不在清單內 |
| 邀請者 | `invitedBy` | `invitedBy`(nullable) | `team_memberships`(4165-4196,欄位 4179) | `team_memberships` 本身✅在清單(5357),但清單只會清 `userId` 欄(該表也有 `userId`,4170,幸好這張表 `userId` 命名正確,**但 `invitedBy` 這個引用同一使用者集合的欄位永遠不會被清**——如果邀請者帳號被刪、被邀請者的 membership 列還在,`invitedBy` 會指向已刪除使用者) |
| 解決者(型別不一致) | `resolvedBy` | `resolvedBy`(**int**,`orb_system_alerts` 3440) vs `resolved_by`(**varchar(64)**,`agent_dlq` 2684) | 兩張不同表 | 皆不在清單內;兩表對「誰處理了這筆」用同一欄名卻是不同型別(int FK vs 自由文字),若日後寫一個通用「resolvedBy 使用者查詢」工具函式,對 `agent_dlq` 會直接型別不合 |
| 共享對象(多型) | `sharedWithId` | `sharedWithId`(int,依 `sharedWithType` 決定是 userId 或 teamId) | `resource_shares`(4432-4478,欄位 4448) | 不在清單內;此欄本質上是 polymorphic reference,任何「掃描所有 *UserId* 欄位」的清理腳本都抓不到它(欄名根本不含 User 字樣) |

- **影響**:光是「使用者/擁有權」這一個語意,drizzle/schema.ts 裡至少有 **11 種不同的欄位命名模式**(`userId` camelCase / `user_id` snake / `ownerUserId` / `ownerId` / `createdBy`(int) / `createdBy`(varchar,不同語意) / `actorUserId` / `sharedByUserId` / `authorUserId` / `curatorUserId` / `invitedBy` / `sharedWithId` 多型 / `resolvedBy` 型別不一致)。任何「通用清理/查詢邏輯」只要假設「使用者欄位一律叫 `userId`」(目前 `deleteUserAccount` 正是如此假設),就會系統性漏表——已確認至少 4 張清單內的表(`agent_collaboration_sessions`、`orb_conversations`、`data_source_connections`、`real_earth_entries`)會在發現 1、2 修好之後接力炸掉；另外至少 9 張「有使用者概念但欄名不是 userId」的表(`news_articles`/`authorUserId`、`featured_showcase`/`curatorUserId`、`resource_shares`/`sharedByUserId`+`sharedWithId`、`teams`/`ownerId`、`team_memberships`/`invitedBy`、`global_audit_log`/`actorUserId`、`project_data_access_rules`/`createdBy`)完全不在 `USER_OWNED_TABLES` 清單內,帳號刪除永遠不會碰到它們,GDPR 殘留(其中 `news_articles.authorUserId`、`featured_showcase.curatorUserId`、`resource_shares.sharedByUserId/sharedWithId` 已由 `docs/research/DI0-data-integrity-map.md`、`DI2-gdpr-delete-residue.md`、`X7-showcase-social-deepdive.md` 從殘留角度記錄過,本文從「命名為何導致清理腳本漏掃」角度補上根因)。
- **建議**:建一份 `USER_REFERENCE_COLUMNS`(表名 → 欄位名 → 語意角色:owner/actor/author/invitedBy/sharedBy…)取代目前「假設欄名固定」的做法;GDPR 刪除/資料匯出/任何「找出某使用者所有資料」的功能都應該共用這份對照表,而不是各自硬編 `userId`。

### 4.〔high〕`server/routers/apiUsage.ts:353` camelCase/snake_case 原生 SQL 漂移(PF apiUsage snapshotAt bug)
- **發現**:`providerSnapshots` 表(`drizzle/schema.ts:2088-2108`)的欄位是 `snapshotAt: timestamp("snapshotAt")`(2100,camelCase)。`server/routers/apiUsage.ts` 裡有三處同款「取每個 provider 最新快照」的 `sql` 樣板:
  - `overview` 用法(277-278):``sql`(...,${providerSnapshots.snapshotAt}) IN (SELECT provider, MAX(snapshotAt) FROM ...)`  ``——正確,子查詢用 `snapshotAt`。
  - `usageByProvider` 用法(352-354):``sql`(...,${providerSnapshots.snapshotAt}) IN (SELECT provider, MAX(snapshot_at) FROM ...)` ``——**子查詢寫成 `snapshot_at`(snake_case),但這張表的實際 DB 欄位是 `snapshotAt`,沒有 `snapshot_at` 這個欄位**。
  - 第三處(578-579)又寫對了(`MAX(snapshotAt)`)。
  只有 `usageByProvider`(331-355)這一處漂移。
- **影響**:呼叫 `trpc.admin.apiUsage.usageByProvider` 時,MySQL 對子查詢 `SELECT provider, MAX(snapshot_at) FROM provider_snapshots GROUP BY provider` 會丟 `Unknown column 'snapshot_at' in 'field list'`,整個 procedure 直接 500——這是複製貼上前後兩處正確寫法時,中間這一份手誤成 snake_case 導致的純命名漂移 bug,和「json 裡欄位對不上」這種資料問題不同,是**語法錯誤級**的漂移。
- **建議**:`apiUsage.ts:353` 的 `MAX(snapshot_at)` 改回 `MAX(snapshotAt)`,並建議把這三處重複的「每 provider 最新快照」子查詢抽成一個共用 helper,避免同一段 SQL 被複製三次、其中一次手誤。

### 5.〔high〕`DataRepairTab.tsx:26` 前端寫死的 `"running"` 在 `background_jobs.status` enum 裡不存在
- **發現**:`client/src/shells/settings/admin/DataRepairTab.tsx:24-27` 用 `all.filter(j => { const s = String(j.status ?? ""); return s === "failed" || s === "running" || s === "queued"; })` 判斷「卡住/失敗任務」。資料來源是 `trpc.admin.allBackgroundJobs`(`server/routers/admin.ts:154-158`)→`db.getAllBackgroundJobs`(`server/db.ts:3092-3100`),這是對 `backgroundJobs` 表原樣 `select()`,不做任何欄位/值轉換。`backgroundJobs.status` 的實際 enum 定義(`drizzle/schema.ts:301-309`)是 `["queued", "processing", "completed", "failed", "cancelled"]`——**沒有 `"running"` 這個值**,真正代表「執行中」的值是 `"processing"`。
- **影響**:`DataRepairTab` 的「卡住任務」診斷面板永遠不會把正在跑(`processing`)的任務算進去——只有 `failed` 和 `queued` 會被列出。如果一個任務卡在 `processing` 狀態(例如 worker 掛掉、永遠不會轉成 `completed`/`failed`),這正是「卡住」的典型案例,但因為程式碼比對的是不存在的 `"running"` 字串,永遠篩不到它,管理員在這個面板上完全看不到。
- **建議**:把 `DataRepairTab.tsx:26` 的 `"running"` 改成 `"processing"`,並建議從 `shared/` 匯出 `backgroundJobs.status` 的 enum 常數供前端 import,避免前端用自由字串猜測後端 enum 值。

### 6.〔medium〕`orb_conversation_messages` 等「有 userId 但不在清單內」的表,一併有 `user_id` snake_case 命名疊加
- **發現**:`orb_conversation_messages`(`drizzle/schema.ts:2737-2768`,欄位 2744)、`agent_dlq`(2660-2697,欄位 2666)、`timeline_frames`(3596-3629,欄位 3602)、`scene_compositions`(3637-3664,欄位 3643)、`video_analytics`(4737-4755,欄位 4743,nullable)五張表,DB 欄位都是 `user_id`(snake_case),且全部**不在** `USER_OWNED_TABLES` 清單內。此點與 `docs/research/DI1-orphan-on-delete.md:152` 已列出的「10 張帶 userId/user_id 卻不在清單內的表」重疊,本文從命名角度補充:即使日後想「照欄名批次補齊清單」,寫一個掃描腳本抓「欄位名叫 userId 的表」也會漏掉這五張(欄名是 `user_id`),必須同時掃 `userId` 與 `user_id` 兩種字面值,否則清理腳本本身就會重蹈 `deleteUserAccount` 同款漏洞。
- **影響**:與 DI1 已述一致(GDPR 殘留),此處純粹是從「為何掃描腳本會漏掃」的命名角度補證據,不重複列殘留內容本身。
- **建議**:見 DI1 既有建議;新增的腳本層建議是掃描時對 `userId`/`user_id`/`ownerUserId`/`ownerId`/`createdBy`/`actorUserId`/`sharedByUserId`/`authorUserId`/`curatorUserId` 全部字面值一起抓,不能只抓其中一種命名。

### 7.〔low〕`orb_system_alerts` 表名本身就是「MySQL/Supabase 雙軌」命名漂移的已知案例(交叉引用,非本次新發現)
- **發現**:`drizzle/schema.ts:3412-3417` 明文自承這是命名缺口(AIDV-726/730 已記錄),`server/db.ts:5350` 的清單註解也重複同一句話。已是程式碼內自我記錄的已知事實,本文僅確認它同時也是發現 2 表格裡「完全沒有 userId 欄位」的成員之一,兩個問題疊加在同一張表上。
- **建議**:無新建議,維持既有 AIDV-726/730 的方向(新監控程式碼一律對 Supabase `system_alerts`),並把它從 GDPR 清單移除(見發現 2)。

---

## 二、Negative results(已查證、非漂移或影響有限)

1. **硬編欄名反模式並不普遍**:全庫 `grep -rn "WHERE userId\|WHERE user_id\|SET userId\|SET user_id" server/**/*.ts` 只命中 `server/db.ts:5387`(`deleteUserAccount` 本身)一處;`server/services/refundStatus.ts:30` 只是註解提及慣例、非真的硬編字串查詢。也就是說「原生 SQL 硬寫欄名」不是普遍寫法,問題集中在 `deleteUserAccount` 這一個函式,修好它不需要擔心其他地方有同款地雷。
2. **`sql\`` 樣板裡的 camelCase/snake_case 漂移目前只找到一處**(發現 4);對 `server/**/*.ts` 內所有 `sql\`` 樣板搜尋 `_at)`/`_id)`/`_by)` 等 snake_case 收尾模式,沒有再找到第二個實例。
3. **多數(約 60/69)`USER_OWNED_TABLES` 內的表命名一致、可正常運作**:`login_history`、`digital_asset_library`、`generation_history`、`custom_blocks`、`system_settings`、`user_ai_brain`、`prompt_library`、`teaching_materials` 等表的 DB 欄位都確實字面叫 `userId`,`deleteUserAccount` 對這些表本身沒問題——bug 集中在少數「junction/聚合/admin 表」誤入清單,以及少數「歷史上用 snake_case 或改名」的表,不是整份清單全壞。
4. **`system_settings` 的 `userId` 欄位命名正確**(`drizzle/schema.ts:1057`,`int("userId").notNull().unique()`),此表在清單內、位置在第 21 位(發現 1 的炸點之前),命名本身不是問題——該表已知的問題是 19 個死欄位(見 `docs/research/L3-fields-settings-admin.md`),與本次命名漂移稽核範圍不同,不重複展開。
5. **`drizzle/0008_*.sql` 重號兩檔(`0008_admin_api_usage.sql` vs `0008_numerous_mother_askani.sql`)已在 `docs/research/SD2-migration-schema-mismatch.md`(發現 3)完整稽核**,含 journal idx 對照(`0008_numerous_mother_askani`=idx 8、`0008_admin_api_usage`=idx 9)、另外 5 組重號(`0033`/`0067`/`0080`/`0081`/`0082`)、以及「檔名字母序 ≠ 實際套用序」的完整分析,本文僅確認此為已知基線、不重新推導,避免與 SD2 重複。
6. **102 表、0 個 FK 約束**:`grep -n ".references(\|foreignKey("` `drizzle/schema.ts` 命中 0 筆,`grep -c "mysqlTable("` = 102,與既有基線一致。

---

## 三、與既有文件的交叉引用

- DI-01(帳號刪除 100% 失敗)根因由本文發現 1 精確釘死在 `prompt_assets`(`schema.ts:1820-1830`);既有 `docs/research/DI0-data-integrity-map.md:88` 已推論「只要流程走到 prompt_assets 就整段 rollback」,本文以 `executeTransaction` 原始碼(`server/_core/DatabaseManager.ts:347-379`)驗證了「為何一定 rollback」的機制、並延伸列出發現 1 修好後會接力炸掉的第 2、3 輪表清單。
- `docs/research/DI1-orphan-on-delete.md`、`DI2-gdpr-delete-residue.md` 已從「殘留資料」角度記錄多張本文提到的表(`orb_conversation_messages`、`agent_dlq`、`timeline_frames`、`scene_compositions`、`video_analytics`、`resource_shares`);本文從「為何清理腳本會漏掃這些表」的命名角度補上根因,不重複列殘留內容。
- `docs/research/SD2-migration-schema-mismatch.md` 已完整稽核 migration 檔名重號與 journal 漂移,本文僅作已知基線交叉引用。
- `docs/research/L3-fields-settings-admin.md` 已記錄 `system_settings` 19 個死欄位,與命名漂移屬不同 cluster,本文僅確認 `userId` 欄位命名本身無誤。
