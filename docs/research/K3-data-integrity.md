# K3 — 資料完整性與雙 DB 隱患獵人(深挖 wave K:資料完整性)

- 產生日期:2026-07-03
- 依據 commit:`4d137bdb907d67e6708ca360a66e89de0a6f2c2e`
- 承接:`docs/research/B-infra.md` §2(雙 DB 健康度)、`00-overview.md` §2(雙 DB 事實)、`G4-misc-audit.md`(`.brain-state.json` 誤 commit、記憶體態)
- 方法:單一代理實讀 `server/db.ts`、`drizzle/schema.ts`(102 表全表名比對)、`server/_core/DatabaseManager.ts`、`server/routes/handoffTraceRoute.ts`、`drizzle/meta/_journal.json`、`server/orphan-migrations-journal.test.ts`、`docs/guides/DB_RESTORE_SOP.md`、多支 migration `.sql`,並用 Python 腳本比對 schema 全部 `userId` 欄位 vs `USER_OWNED_TABLES` 清單(無子代理)
- 圖例:🔴 高風險(CONFIRMED,已讀到程式碼證實)/ 🟡 中風險(CONFIRMED 但影響面較窄)/ 🟠 PLAUSIBLE(強證據推論,未實際跑 DB 驗證)

---

## 摘要(按嚴重度排序)

| # | 隱患 | 嚴重度 | 一句話 |
|---|---|---|---|
| 1 | GDPR 刪除帳號整條路徑目前必炸,資料完全刪不掉 | 🔴 CONFIRMED | `USER_OWNED_TABLES` 內至少 10 張表根本沒有 `userId` 欄,`DELETE FROM ... WHERE userId=?` 會拋 SQL 錯誤,整個交易回滾 |
| 2 | 上述錯誤會餵食全域 DB 電路斷路器,5 次失敗即可讓全站交易 503 | 🔴 CONFIRMED | `DatabaseManager` 電路斷路器狀態是單例、非依操作類型隔離 |
| 3 | 至少 10 張「真的有 userId」的表被排除在刪除清單外 | 🔴 CONFIRMED | consistency_vault、orb_conversation_messages、studio_versions、timeline_frames、scene_compositions 等使用者刪除後永久留下孤兒個資列 |
| 4 | 團隊刪除只清 3 張表,至少 6 張 teamId 表留孤兒 | 🟠 PLAUSIBLE(程式碼證實,未跑 DB) | `deleteTeam()` 只處理 teaching_materials/team_memberships/teams,fine_tuned_models/prompt_collection/orchestration_runs/context_packets/project_data_access_rules(NOT NULL!)/data_source_connections/digital_asset_library 全部留著指向已刪除 teamId |
| 5 | resource_shares 是無型別多型關聯,刪資源/刪人/刪隊三向皆不清 | 🔴 CONFIRMED | resourceId 無法做 FK(4 種資源表任一),sharedWithId 可能是已刪 user/team;此表也不在 USER_OWNED_TABLES |
| 6 | 雙告警表分裂,監控盲區,連 schema 註解都與實碼矛盾 | 🔴 CONFIRMED(B-infra 已列,補充精讀) | `schema.ts:3411-3416` 註解與 `providerHealthProbeJob.ts` 實際寫入路徑相反 |
| 7 | MySQL int userId ↔ Supabase uuid creator_id 無對照表,導致跨庫端點形同 IDOR | 🔴 CONFIRMED(新發現) | `handoffTraceRoute.ts` 只驗證「有登入」,不驗證該 userId 是否擁有該 Supabase projectId,任何登入者可讀任何人的代理交棒紀錄 |
| 8 | Supabase 核心表 DDL 不在 repo,環境不可重建 | 🟡 CONFIRMED(B-infra 已列) | agent_tasks/video_projects/video_segments/system_alerts/creator_job_throttle 皆非 repo migration 建立 |
| 9 | Supabase 完全沒有備份機制(repo 內零證據) | 🟠 PLAUSIBLE | grep 全 repo 無 pg_dump/Supabase 備份字樣;`dbSnapshotJob.ts` 只備 MySQL |
| 10 | db-backups 永久累積不清,只是成本債非資料遺失 | 🟢 已知取捨 | `DB_RESTORE_SOP.md` §7 明文承認未做 lifecycle |
| 11 | 記憶體態資料清單:重啟即丟或還原成種子 | 🟡 CONFIRMED | learnHub 文件/測驗、aiModels enrichment、orbTaskStateMachine FSM、orbQuota 配額計數器 |
| 12 | json() 欄位無 runtime schema 驗證,`$type<>()` 只是編譯期假象 | 🟡 CONFIRMED | `resultJson` 連 `$type` 都沒有(裸 `json("resultJson")`),22+ 個 json 欄位中僅少數寫入路徑(如 quotaJson)有 zod 把關 |
| 13 | 非冪等 data migration 風險評估:實際查無真正的地雷,設計良好 | 🟢 修正原假設 | 0021/0032/0046/0050 皆用「比對舊 default 值」的 WHERE 子句寫法,重跑安全 |
| 14 | migration journal idx 撞號的歷史傷疤(AGENTS.md #954)仍是並行合併下的活風險 | 🟡 CONFIRMED | `AGENTS.md:21` 明文警告 stale rebase 差點倒退 #954 的 journal |

---

## 1. 孤兒資料(0 外鍵後果)

### 1.1 🔴 GDPR 帳號刪除整條路徑目前必炸(CONFIRMED,最高優先級)

**觸發情境**:任何使用者在 `/account-settings` 打「刪除帳號」(輸入 literal 確認字串 `DELETE MY ACCOUNT`),前端呼叫 `profile.deleteAccount` → `db.deleteUserAccount(userId)`。

**證據**:`server/db.ts:5300-5395` 的 `USER_OWNED_TABLES` 陣列(70 個表名)在迴圈裡對每張表執行 `DELETE FROM \`${table}\` WHERE userId = ?`(:5387)。用 Python 腳本逐一比對 `drizzle/schema.ts` 實際欄位定義後發現,以下 **10 張表在陣列裡、但 schema 裡根本沒有 `userId` 欄位**:

| 表名 | 實際主要欄位(無 userId) | schema.ts 行號 |
|---|---|---|
| `prompt_assets` | `promptId`、`assetId` | :1820-1829 |
| `external_service_subscriptions` | `serviceName`、`ownerEmail` | :1919-1929 |
| `cost_aggregations` | `provider`、`endpoint`、`date`(全域彙總,無個人歸屬) | :2111-2121 |
| `cost_ledger` | `accountKey`(非 userId) | :2159-2196 |
| `cost_attribution_outbox` | `idempotencyKey`、`payloadJson` | :2230-2240 |
| `alert_configs` | `alertType`、`provider`(全域告警設定) | :2279-2289 |
| `fine_tuned_model_consents` | `modelId`、`consentId` | :2414-2421 |
| `orb_spirit_collaboration_metrics` | `fromSpiritId`、`toSpiritId`(全域指標) | :3310-3320 |
| `orb_system_alerts` | `alertType`(全域告警,無使用者欄) | :3418-3428 |
| `real_earth_entries` | `title`、`category`(全域知識庫) | :4244-4254 |

陣列順序中,**`prompt_assets` 排在第 26 個位置**(`prompt_library` 之後),是迴圈第一個會撞到的無效表。MySQL 會回傳 `ER_BAD_FIELD_ERROR`(`Unknown column 'userId' in 'where clause'`),此例外未被 `deleteUserAccount` 內的 try/finally 吞掉(finally 只重設 `FOREIGN_KEY_CHECKS`,沒有 catch),往上傳遞到 `DatabaseManager.executeTransaction`(`server/_core/DatabaseManager.ts:359-378`),該處 `catch` 區塊執行 `connection.rollback()` 後 `throw error`(:367-375)。`server/routers/profile.ts:29-34` 的 `deleteAccount` mutation 沒有包 try/catch,錯誤直接以 tRPC 500 拋回前端。

**後果**:
1. **使用者的刪除請求 100% 失敗**——連 `users` 表本身那一列都刪不掉(因為迴圈在到達 `DELETE FROM users` 之前就已經拋錯,且整個交易回滾,連前面已成功刪除的表也復原)。GDPR「被遺忘權」端點目前是完全不能用的裝飾品。
2. **零測試覆蓋**:全 repo 搜尋 `deleteUserAccount`/`profileRouter` 在任何 `.test.ts` 檔案裡都沒有出現,CI(就算沒壞掉)也抓不到這個問題。
3. 由於 CI 目前本身又是壞的(`B-infra.md` D5:pr-gate 三秒即死),這條路徑事實上是**盲區中的盲區**。

---

### 1.2 🔴 電路斷路器複合故障(CONFIRMED,新發現,放大 1.1 的影響面)

**觸發情境**:承上,若短時間內有 ≥5 次刪除帳號的嘗試(或任何 5 次連續失敗的 `executeTransaction` 呼叫,不限刪帳號)。

**證據**:`server/_core/DatabaseManager.ts:211-227` 的 `recordFailure()` 是**單例層級**(非依操作類型/呼叫者隔離)的 `consecutiveFailures` 計數器,`CIRCUIT_OPEN_THRESHOLD = 5`(:60)。`executeTransaction`(:347-379)開頭就檢查 `isCircuitOpen()`(:348-355),開啟時直接對「任何」呼叫者丟 503 `CIRCUIT_OPEN`,不分這次呼叫跟先前失敗是否相關。`recordSuccess()`(:229-237)會在任何成功交易時把計數器歸零,故正常流量頻繁時該風險視窗很短;但若刪帳號功能被使用者/QA 連續踩(或未來加了自動化 GDPR cron),**理論上可讓整站所有 `executeTransaction` 路徑(含 `deleteTeam`、任何寫入交易)30 秒內全部 503**(`CIRCUIT_RESET_TIMEOUT_MS = 30_000`,:62)。

**後果**:一個從未被使用過的邊角功能(帳號刪除)的既有 bug,具備把「不相關功能的資料庫交易」拖下水的複合故障路徑。

---

### 1.3 🔴 至少 10 張「真的有 userId」的表被漏在 GDPR 刪除清單外(CONFIRMED)

**觸發情境**:即使 1.1 的 bug 修好(例如把 10 張無效表從陣列移除),以下 **10 張表持有真正的個人資料、有 `userId` 欄位,卻不在 `USER_OWNED_TABLES` 陣列裡**,使用者刪除帳號後這些列永久留存:

| 表 | 內容 | userId 欄位證據 |
|---|---|---|
| `consistency_vault` | 使用者的角色/場景一致性參考圖(vault) | schema.ts:719-727(`userId: int("userId").notNull()`) |
| `orb_conversation_messages` | 光球對話逐則訊息(`orb_conversations` 父表有在清單,子表訊息沒有) | schema.ts:2737-2745(`user_id`) |
| `studio_versions` | 各工作室版本快照(`studio_recipes` 有在清單,`studio_versions` 沒有) | schema.ts:2806-2814(`userId`) |
| `timeline_frames` | 世界觀分鏡逐幀資料(`world_storyboards` 父表有,子表沒有) | schema.ts:3596-3603(`user_id`) |
| `scene_compositions` | 場景合成資料 | schema.ts:3637-3644(`user_id`) |
| `agent_dlq` | 代理失敗死信佇列(含使用者關聯的失敗紀錄) | schema.ts:2660-2666(`user_id`) |
| `orb_workflow_template_ratings` | 使用者對工作流範本的評分/留言 | schema.ts:3278-3284(`userId`) |
| `video_analytics` | 影片觀看分析(`userId` 可為 null,設計上支援 opt-out,風險較低) | schema.ts:4737-4744(`user_id`,nullable) |

**後果**:GDPR 刪除是「部分刪除」——vault 圖片、光球對話逐則內容、分鏡幀、場景合成資料、工作室版本歷史在使用者「已刪除帳號」後仍完整留在 DB,只是 `users` 表的父列不見了(若 1.1 修好後)。這違反刪除請求的完整性承諾,且因為沒有 FK,沒有任何資料庫層級機制會發現這些孤兒列。

**根因**:`USER_OWNED_TABLES` 陣列的頭注解寫「涵蓋每一張有 userId FK 的表」(:5297-5299),但沒有任何自動化機制(測試/腳本)去驗證這個宣稱與 `schema.ts` 實際欄位是否同步——這是一個「意圖 vs 實作」隨時間漂移、且無守門測試的典型模式(對比 migration journal 有 `orphan-migrations-journal.test.ts` 守門,GDPR 刪除清單完全沒有對應測試)。

---

### 1.4 🟠 團隊/專案刪除的孤兒列(PLAUSIBLE,程式碼證實但未實跑 DB)

**觸發情境**:leader/admin 刪除一個團隊(`teams.delete` → `db.deleteTeam(teamId)`)。

**證據**:`server/db.ts:4347-4360` 的 `deleteTeam()` 註解自陳「三步包進 transaction,部分失敗全回滾,不留孤兒 membership 或脫鉤素材」,但實際只處理 3 張表:`teachingMaterials`(teamId 設 null + visibility 改 private)、`teamMemberships`(delete)、`teams`(delete)。透過 grep `teamId` 找到 schema 裡至少還有以下表持有 `teamId` 欄位、但 `deleteTeam()` 完全沒碰:

- `fine_tuned_models.teamId`(:466,nullable)——team_shared LoRA 模型指向已刪除的隊伍
- `prompt_collection.teamId`(:1886,nullable)——team_shared 提示詞集合
- `orchestration_runs.teamId`(:3742,nullable)
- `context_packets.teamId`(:3811,nullable)
- `project_data_access_rules.teamId`(:3847,**NOT NULL**)——這張表的 teamId 是必填欄,刪除團隊後這些列**永遠**指向不存在的 teamId,且沒有任何清理路徑
- `data_source_connections.teamId`(:3894,nullable)
- `digital_asset_library.teamId`(:4023,nullable)——團隊共享的數位資產庫項目

**後果**:team_shared 可見度的模型/提示詞/資產在團隊解散後,`teamId` 欄位變成指向一個不存在的隊伍;任何用 `teamId` 反查團隊資訊的程式碼(例如顯示「屬於 XX 團隊」)會查無結果或需要額外的空值防呆;`project_data_access_rules` 的 NOT NULL 孤兒列尤其危險,因為理論上它掌管資料存取規則,一旦有程式碼未來重用已刪除的 int teamId(雖然 auto_increment 不會重複,風險較低),或做全表掃描統計「有效規則數」,會把死規則算進去。此項未實際起 Docker 驗證資料庫行為,列為 PLAUSIBLE。

---

### 1.5 🔴 resource_shares:無型別多型關聯,三向皆不清(CONFIRMED)

**證據**:`drizzle/schema.ts:4412-4461` 的 `resourceShares` 表設計為**泛型 junction 表**:`resourceType`(project/asset/prompt/material)+ `resourceId`(int,對應 4 張不同表的主鍵之一)+ `sharedWithType`(user/team)+ `sharedWithId`(int,對應 users.id 或 teams.id 之一)。表頭註解坦承這是刻意的多型設計,用來避免「在每張資源表硬塞 teamId」的不一致。

**後果**:
1. **`resourceId` 無法做 FK**(即使將來補 FK 也做不到,因為同一欄位依 `resourceType` 指向 4 張不同的表)——`digital_asset_library`/`creative_projects`/`prompt_library`/`teaching_materials` 任一筆資源被刪除後,`resource_shares` 裡對應的分享列變孤兒,前端若拿孤兒列去 join 資源詳情會查無資料(需要應用層自行防呆,是否每個消費端都有做未逐一查證)。
2. **`sharedWithId` 同樣無法做 FK**——使用者或團隊被刪除後,分享記錄留著,`sharedByUserId` 也一樣。
3. **本表完全不在 `USER_OWNED_TABLES`**——不論是作為分享人(`sharedByUserId`)還是被分享對象(`sharedWithId` 為 user 時),使用者刪除帳號後這張表都不會被清理,是 §1.1/1.3 之外**第 11 張**該補進 GDPR 清單、卻連命名都不符合「userId」慣例(用的是 `sharedByUserId`/`sharedWithId`)因而不會被現行機制的簡單欄位比對抓到的表。

---

## 2. 雙 DB 不一致

### 2.1 🔴 雙告警表分裂(承接 B-infra §2.4 #1,已於該文件詳細記錄)

`drizzle/schema.ts:3411-3416` 的註解宣稱「`orb_system_alerts` 是 MySQL legacy,live 表是 Supabase `system_alerts`,`providerHealthProbeJob` 經 Supabase SDK 寫入」,但實際 `server/jobs/providerHealthProbeJob.ts:12` import 的是 Drizzle 的 `orbSystemAlerts` 並寫入 MySQL(:224-280)。管線停滯/心跳告警走 Supabase(pg_cron `detect_pipeline_stall`/`check-heartbeat-liveness`),供應商健康告警走 MySQL——監控 UI 讀哪張表看到哪一半,告警去重/resolve 生命週期兩套各自演化。此為 K3 承接既有發現,未重複展開,詳見 `B-infra.md` §2.4/§5.4。

### 2.2 🔴 MySQL userId(int)↔ Supabase creator_id(uuid)無對照表,導致跨庫端點形同 IDOR(新發現)

**觸發情境**:任意已登入使用者呼叫 `GET /api/video/project/:projectId/handoff-trace`,`projectId` 帶入**任意**合法格式的 UUID(不需要是自己名下的專案)。

**證據**:`server/routes/handoffTraceRoute.ts` 全文:
- `authenticateRequest(req)`(:29)只驗證「這是一個有效登入的使用者」,拿到的是 MySQL `users.id`(int)。
- 檔頭註解(:7-9)明文承認:「Proxies the Supabase REST API using the service-role key so RLS on `agent_handoff_log` does not filter results here (**the app auth gate is the ownership check**)」。
- 但程式碼裡從頭到尾**沒有任何一行**拿 `user.id`(int)去比對這個 `projectId`(Supabase uuid)是否真的屬於這個使用者——因為 MySQL 沒有任何表格存放「userId ↔ Supabase creator_id/video_project uuid」的對照關係,根本無從查起。唯一的「驗證」只是格式檢查 `UUID_RE.test(projectId)`(:40)。
- 請求直接用 `SUPABASE_SERVICE_ROLE_KEY`(繞過 RLS)查 `agent_handoff_log?project_id=eq.${projectId}`(:52-58)並把結果原樣回傳給前端。

**後果**:任何登入使用者(甚至團隊之外的普通使用者)只要能取得或猜到一個合法格式的 UUID(例如從自己過去建立的專案得知 UUID 格式規律、或從瀏覽器網路面板洩漏、或未來被暴力列舉),就可以讀取**任何其他使用者**的多代理影片管線交棒紀錄(`from_agent`/`to_agent`/`payload_hash`/`handoff_at`/`status`)。這是雙 DB 身分未打通(`B-infra.md` §2.4 #3 已點出「身分未打通」但未具體到端點層級)在真實路由上具體兌現成的存取控制漏洞——不是「查無」而是「查得到、但查到別人的」。

**根因**:雙 DB 架構下,MySQL 端的 authz 系統(users.role、team_memberships、resource_shares)完全無法對 Supabase 端的資源(uuid 主鍵)做細粒度擁有權判斷,因為兩者的主鍵空間互不相通、無映射表。

### 2.3 🟡 兩套限流互不知情(承接 B-infra,已記錄)

MySQL 側 `orbQuota.ts`(記憶體,40 次/天)vs Supabase `creator_job_throttle` DB trigger(20 tasks/hr)。使用者體感的「額度」有兩本帳,且因身分未打通(2.2),Supabase 側限流用的 `creator_id` 與 MySQL 側用的 `userId` 甚至可能無法對應到同一實體額度概念。此為既有發現引用,未重複展開。

---

## 3. Migration 風險

### 3.1 journal 現況查證(CONFIRMED,更新 B-infra 數字)

`drizzle/meta/_journal.json` 目前 **111 entries,idx 0→121**(idx 有跳號,對應歷史孤兒 migration 補登記的痕跡,與 `B-infra.md` 記錄一致),最後一筆 `idx:121, tag:"0106_video_input_assets", when:1783843200000`。`server/orphan-migrations-journal.test.ts` 有 7 個測試案例守住:journal `when` 嚴格遞增、idx 不可重複、每筆 journal 條目對應存在的 `.sql` 檔、guarded/CREATE-TABLE 風格孤兒的冪等性(`information_schema` 守門或 `CREATE TABLE IF NOT EXISTS`)。這套守門測試品質高,是目前 migration 治理最可靠的一環。

### 3.2 🟡 並行合併撞 journal 撞號是仍在的活風險(CONFIRMED)

`AGENTS.md:21` 明文:「合併前必 `git fetch` + rebase 到最新 `origin/main`——並行合併是常態,stale base 會悄悄倒退別人已合的修正(**曾差點倒退 #954 的 migration journal**)。」這代表:
1. 歷史上已經發生過「兩個並行 agent 各自在 `_journal.json` 尾端加一筆、用了同樣或衝突的 `when`/`idx`」的真實事故,只是「差點」而非「已發生」。
2. `orphan-migrations-journal.test.ts` 的測試只在**本地/CI 跑測試時**才會抓到撞號(且需要兩個 branch 合併之後才看得到完整陣列),而非在合併當下就擋。加上 `B-infra.md` D5 記錄「CI runner 目前 3 秒即死」——這代表現在如果真的發生類似 #954 的撞號,**理論上沒有任何自動化關卡會擋下**,只能靠人工 review 抓到。

### 3.3 🟢 資料遷移(data migration)冪等性:實查結果比預期安全(修正原假設)

檢查了 4 支混雜資料遷移的 migration(`0021_align_voice_engine_default.sql`、`0032_agent_preferences_specialist_columns.sql`、`0046_agent_preferences_15_spirits_phase3.sql`、`0050_align_brain_defaults_to_latest.sql`),皆採用「`UPDATE ... WHERE column = '<舊 default 值>'`」的模式(例如 `0050_align_brain_defaults_to_latest.sql:59-91`:只把 `directorModel = 'google/gemini-2.5-pro'` 的列改成新值,已手動選過模型的使用者列不受影響),此寫法對「重跑」是天然冪等的(第二次跑時 WHERE 已經匹配不到任何列)。`0050` 的檔頭註解甚至明文說明這是仿照 `0021` 的既有安全模式。**沒有找到會在重跑時破壞資料的資料遷移**,原本預期的「data migration 與 schema migration 混雜」風險經查證比預期低,值得記錄以避免過度悲觀。

### 3.4 🟡 Supabase 基底 DDL 不在 repo,環境不可重建(承接 B-infra §2.2,補充影響面)

`agent_tasks`、`video_projects`(含 `creator_id uuid`)、`video_segments`、`system_alerts`、`creator_job_throttle` 及函式 `check_creator_job_rate_limit()` 皆只被 repo 內的 migration `ALTER`/引用,基底 `CREATE TABLE` 不在 `supabase/migrations/`。**具體影響**:
1. 若要在新環境(例如換 Supabase 專案、災難復原、或本機起一份完整 Supabase 影子環境做測試)重建整個資料庫,`supabase db push`/`migration up` 這類「以 repo 為準」的標準流程會直接失敗或建出不完整的 schema——這些核心表根本不存在於任何 `.sql` 檔案裡,只存在於 Supabase dashboard/MCP 已施作的即時狀態。
2. Code review 對這些表的變更歷史(誰在何時加了哪個欄位)完全不可考,只能靠 `mcp list_migrations` 現場查詢即時狀態,`git blame`/PR 歷史對這些表的結構失效。
3. 這也直接放大 §6(備份)的風險:如果連 schema 定義都不在 repo,即使有資料備份,要「從零重建」也缺一半的材料(結構定義)。

---

## 4. 記憶體態資料遺失清單(逐一確認使用者可見後果)

| 資料 | 位置 | 重啟/redeploy 後果 | 使用者可見後果 |
|---|---|---|---|
| **learnHub 文件/測驗/影片** | `server/routers/learnHub.ts:50`:`let docs: LearnDoc[] = [...SEED_DOCS]` | 還原成種子資料(112 篇內建文件),使用者新增的自訂文件全部消失 | 使用者在「學習中樞」新增的教材/測驗,下次 Railway 重新部署後憑空消失,且沒有任何警告 UI |
| **aiModels enrichment + 研究排程** | `server/services/modelResearcher.ts:71`:`const enrichmentStore = new Map<string, EnrichmentRecord>()`;`server/routers/aiModels.ts:221` | 已完成的模型研究結果(enrichment)全部遺失,需要重新觸發研究 | AI 模型百科頁面的「深度介紹」內容重啟後消失,需要 admin 重新按「研究」按鈕,期間使用者看到的是空白/簡略介紹 |
| **orbTaskStateMachine FSM** | `server/services/orbTaskStateMachine.ts:73`:`const taskStore = new Map<string, OrbAgentTask>()` | 進行中的光球代理任務狀態全部消失(`ORB_TASK_STORE_FILE` 檔案持久化選項存在但預設空,需額外掛 volume 才生效) | 使用者正在進行的多步驟光球任務,若剛好碰上部署重啟,任務狀態直接消失(不是失敗,是「憑空不見」,前端可能顯示卡住的進度條或查無此任務) |
| **orbQuota 生成配額計數器** | `server/services/orbQuota.ts:23-25`:`userDailyCounters`/`sessionClicks`/`providerRateCounters` 皆為 `Map` | 重啟後所有使用者的每日生成配額計數器歸零 | 對使用者是「有利」的副作用(配額被重置,等於免費多得配額),但對商業模型是漏洞——惡意使用者可透過觸發服務重啟(若能誘發,例如打爆某個會導致 uncaughtException 的端點)來刷配額 |
| **rate-limit in-process bucket** | `server/_core/rateLimiter.ts:235-284`(tRPC 層 `ai.chat` 20 RPM、`feedback` 10/h) | 重啟後限流窗口歸零;多副本(replica)環境下**同時**互不共享 | 多 replica 部署時,同一使用者打不同 replica 可以繞過限流上限(N 倍於預期,N=replica 數) |
| **in-process metrics/monitor** | `B-infra.md` §5.1:`metrics.ts` in-process 滾動視窗(1min/15min 延遲百分位、per-endpoint 錯誤率) | 重啟後歷史效能數據全部歸零,`/api/metrics`/`/api/health/detail` 回報從零開始 | Admin 監控儀表板在每次部署後看起來像「全新系統」,無法追蹤跨部署的效能趨勢;事故調查時若剛好跨過一次部署,舊數據不可考 |
| **orbChatProgress 進度事件** | `server/services/orbChatProgress.ts:1-22` | 設計上本就是 60 秒 TTL 的短生命週期 ring buffer,重啟只會讓「當下正在輪詢的請求」進度條瞬間消失 | 影響極小(🟢):是刻意設計的暫態資料,非真正的「資料遺失」風險,列出僅為完整性 |

**共通根因**:`env.validated.ts:606-613` 誠實揭露這是已知技術債(`B-infra.md` D1),Redis 目前只救了「生成防重複鎖 / rate-limit store / creator quota」三項,上表其餘項目都還是純記憶體。多副本水平擴展目前被這份清單鎖死——任一項目在多 replica 下都會有「副本 A 不知道副本 B 的狀態」問題,不只是「重啟遺失」而已。

---

## 5. JSON 欄位無 schema 驗證

### 5.1 🟡 `$type<>()` 只是編譯期斷言,無 runtime 驗證(CONFIRMED)

`drizzle/schema.ts` 中至少 **22 個** json 欄位(`quotaJson`、`metadata` ×14、`resultJson`、`configJson` ×2、`scenesJson` ×2、`payload`/`payloadJson` ×4 等),多數使用 `.json("col").$type<Record<string, unknown>>()` 語法。**這個 `$type<>()` 純粹是 TypeScript 編譯期型別斷言**,Drizzle 在 runtime 寫入/讀出時完全不會驗證實際 JSON 內容是否符合宣告的形狀——寫入時只要是合法 JSON 就會被 `JSON.stringify` 存進去,讀出時原樣 `JSON.parse` 回傳,型別系統只是「告訴 TypeScript 相信它是這個形狀」。

**最嚴重的例子**:`backgroundJobs.resultJson`(`drizzle/schema.ts:312`)連 `$type<>()` 都沒有寫,是裸的 `json("resultJson")`,在 TypeScript 層級是完全未型別化的欄位。此欄位被 **30 個 server 檔案**共用(image/video/audio/voice/zip_export/model_training/multimodal/teaching_archive_ingestion 8 種 `jobType` 各自寫入不同形狀的物件到同一欄位),寫入端分散在 `server/routers/proStudio.ts`、`server/routers/generate.ts`、`server/routes/webhookFal.ts`、`server/routes/webhookSuno.ts`、`server/services/loraTrainer.ts` 等,彼此互不知道對方存了什麼 key。

**讀取端防護現況(抽查)**:`client/src/contexts/BackgroundTasksContext.tsx:225,317,368` 讀取時採用 `as Record<string, unknown> | null` 型別斷言 + 可選鏈(`meta?.resultUrl as string | undefined`)存取,屬於防禦性寫法,**不會**因為欄位缺失而崩潰,只會顯示 `undefined`。但這是**個別消費端自律**而非中央契約——沒有 zod schema 強制「不同 jobType 的 resultJson 形狀」,新增一種 jobType 或改動既有欄位命名時,沒有任何機制會在編譯期或執行期抓到「讀取端假設的 key 跟寫入端實際寫的 key 對不上」的情況;是否每一個消費端都做了同樣程度的防呆並未逐一查證。

### 5.2 🟢 部分寫入路徑有 zod 把關,非全面缺失(對比修正)

並非所有 json 欄位都毫無驗證——`server/routers/profile.ts:8-19` 的 `updateQuotaJson` mutation 對 `users.quotaJson` 有完整 zod 輸入驗證(`z.object({ image: z.number().min(0), video: ..., audio: ..., voice: ... })`),這是少數「寫入路徑有型別+值域雙重把關」的例子。**落差在於這種把關是各 router 各自決定要不要做,不是 schema 層級的通用機制**——`resultJson`/`metadata`/`payload` 這類「內部產生、非使用者直接輸入」的欄位普遍沒有做,因為開發者心態上認為「反正是我自己寫的資料,不需要驗證自己」,但這正是造成上游程式改版後下游悄悄讀到不符預期形狀而崩潰或顯示異常的溫床。

---

## 6. 備份/還原可信度

### 6.1 🟢 MySQL 備份+還原演練:證據紮實,可信度高

`docs/guides/DB_RESTORE_SOP.md` §5 記錄了一次用「prod 真 binary」(Alpine `mariadb-client`/`mariadb-connector-c`,與 `dbSnapshotJob.ts` 的 `buildMysqldumpArgs` 逐字一致的旗標)做的 dump→gzip→還原→對表數/對列數演練,結果 exit 0、70 張表對上、`provider_snapshots` 表 56 列精確對上。演練同時抓到並修掉了兩個真實的「會讓備份整個壞掉」的問題(MySQL-8-client 專屬旗標 `--set-gtid-purged`/`--column-statistics` 在 MariaDB mysqldump 上會讓 dump 變成 0-byte、`mariadb-connector-c` 缺失導致連不上 `caching_sha2_password`)。這是本次深挖中少數「查證後比預期更可信」的一項。

### 6.2 🟠 Supabase 完全沒有備份機制(PLAUSIBLE,repo 內零證據)

全 repo grep `supabase.*backup`/`pg_dump`/`Supabase.*備份` **零命中**。`server/jobs/dbSnapshotJob.ts` 的 `takeDbBackup()` 只對 `DATABASE_URL`(MySQL)做 `mysqldump`,`SCHEDULED_MAINTENANCE_JOBS` 掛載的排程任務清單裡沒有任何 Supabase 對應的備份 job。`DB_RESTORE_SOP.md` 全文(281 行)完全沒有提到 Supabase。

**後果**:Supabase 現在承載的是「多代理影片生成管線的執行資料面」——`agent_tasks`(派工/checkpoint)、`video_projects`/`video_segments`(含斷點續跑狀態)、`system_alerts`。如果 Supabase 專案發生資料損毀/誤刪/帳號問題,repo 內**沒有任何**應用層級的復原路徑;唯一的保護網是 Supabase 平台本身依方案等級提供的 PITR(Point-in-Time Recovery)——但這在 repo 文件裡完全沒有被記錄、驗證過、或列入任何 SOP,團隊可能完全不知道自己方案等級下的 PITR 保留天數是多少,也未曾像 MySQL 那樣做過一次實跑演練。結合 §3.4(基底 DDL 不在 repo),即使 Supabase 平台備份可用,「用 repo 從零重建」這條路也走不通,因為 schema 定義本身有一半不在版控。此項目未能連線 Supabase MCP 查證實際專案的 PITR/備份設定,列為 PLAUSIBLE(基於 repo 內零證據推論)。

### 6.3 🟢 db-backups 不清舊檔:是成本債,非資料遺失風險

`DB_RESTORE_SOP.md` §7 明文承認:「目前:時間戳累積——每天一個新檔,永久保留在 R2(不自動刪)」,並列出「想省空間時」的 lifecycle rule 選項為「未實作」。這與任務描述的「不清舊檔」現況相符,但方向上對「資料完整性」是正面的(備份只會越存越多,不會有保留期限太短導致回不去的風險),真正的成本是 R2 儲存費用隨時間無上限增長。不列為資料完整性風險,僅記錄以資對照。

### 6.4 🟡 還原 SOP 對「正式環境」的步驟仍是人工且未演練

`DB_RESTORE_SOP.md` §4「還原到正式環境的新 DB」明確標注「這步偏維運、由 Bruce 在有人陪同時操作」,且該節本身沒有像 §5 那樣附上一次真實跑過的紀錄——已驗證的是「本機 Docker 對本機 Docker」的還原流程,**尚未有一次「真的對 Railway 環境」的還原演練紀錄**。若正式環境真的發生需要還原的事故,操作者會是第一次在真正的 Railway 介面上做這件事,SOP 文件本身也承認細節「依當時 Railway 介面為準」(§4 開頭),存在紙上流程與實際介面不符的風險。

---

## 缺讀聲明(本波未查完部分)

1. **未實際起 Docker/MySQL 驗證** §1.1/1.3/1.4 的 SQL 錯誤與孤兒列結論——全部基於逐行讀 `drizzle/schema.ts` 欄位定義 + Python 腳本文字比對,未實跑 `deleteUserAccount()`/`deleteTeam()` 對真實資料庫觀察報錯訊息與最終列數,建議下一波用 `dev-environment/docker-compose.yml` 實跑驗證來把 §1.1/1.3 從「讀碼確認」升級為「實跑確認」(雖然讀碼證據已相當直接,SQL 對不存在欄位的行為在 MySQL 是有文件記載的固定行為,信心度仍高)。
2. **`exportUserData()`**(`server/db.ts:5403+`,GDPR 資料匯出)只讀了函式開頭(:5407-5410 部分 select),未逐行核對匯出欄位是否也漏了與 §1.3 同樣的表——很可能有對稱的漏洞(匯出跟刪除引用同一份表清單邏輯的可能性待查)。
3. **resource_shares 的實際消費端**(哪些 router 真的在讀這張表、`ENABLE_DATA_RBAC` 開啟後孤兒列會不會造成錯誤而非只是查無)未深入追蹤,§1.5 的後果描述偏保守推論。
4. **Supabase 23 支 migration 的函式 body**(`dispatch_task`/`complete_task`/`write_segment_from_completed_task` 等)是否有對應的「刪除 video_project 時清理 segments/tasks」的觸發器邏輯——只查了 B-infra 既有的函式清單,未逐一讀 SQL body 確認 Supabase 端自己的孤兒列問題(MySQL 端的孤兒列問題已查得很細,Supabase 端的對稱問題未深挖,可能又是一份獨立的 K4 主題)。
5. **實際 Supabase 專案的備份/PITR 設定**——未連線 `mcp__Supabase__*` 工具查詢真實專案設定(本波任務未取得該授權/未在範圍內),§6.2 的結論完全基於「repo 內找不到證據」的消極推論,不代表 Supabase 平台本身真的沒有备份,只代表**團隊在 repo 裡沒有留下任何關於它的知識或演練紀錄**。
6. **json 欄位** §5 僅對 `resultJson`/`quotaJson` 做了具體讀取端追蹤,其餘 20 個左右的 `metadata`/`payload`/`scenesJson`/`configJson` 欄位只做了清單盤點,未逐一追蹤每個欄位的讀寫兩端是否對稱。
7. **電路斷路器**(§1.2)的「5 次失敗即全站 503」推論,未確認是否有其他高頻的 `executeTransaction` 呼叫路徑會持續用 `recordSuccess()` 抵銷計數器,使得此複合故障在真實流量下的實際可觸發窗口可能遠比理論值窄;此為 PLAUSIBLE 而非 CONFIRMED 的機率評估留待下一波用真實流量模式驗證。
