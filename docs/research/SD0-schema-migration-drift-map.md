# SD0 — schema/migration 漂移地圖(死欄位/遷移碰撞/命名漂移)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb

> 稽核方法:每條發現都用 Read 讀過原始檔案 + Grep 全庫確認「有沒有被用」,不臆測。無法用本機檔案確認的項目(需連 Railway/prod DB 才能坐實)一律標「需再查」,不算入 confirmed。

---

## 0. 總覽

| Cluster | 條數 | 最高嚴重度 |
|---|---|---|
| dead-table | 4 | medium |
| migration-schema-mismatch | 2 | high |
| naming-drift | 6 | critical |
| dead-column(重複標記,同 DI-01 根因) | 1 | critical |

**推翻/更正:1 條**(細節層級更正,非整條推翻;見 §2 末段「更正」)。其餘 12 條原樣確認,無推翻。

---

## 1. 依 Cluster 分節(確認/建議)

### 1.1 dead-table

**[medium] agent_collaboration_steps / agent_collaboration_messages 全表零讀寫**
`drizzle/schema.ts:2506-2593`(表定義,`agentCollaborationSteps`/`agentCollaborationMessages`)
Grep 確認:全庫(`server` `client` `shared` `drizzle`)搜尋 `agentCollaborationSteps`/`agentCollaborationMessages`/`agent_collaboration_steps`/`agent_collaboration_messages`,除了 `drizzle/schema.ts` 定義本身與自動產生的 `drizzle/relations.ts` 之外,零命中。orchestrator 實際只碰 `agent_collaboration_sessions`(`drizzle/schema.ts:2434`)與 handoffs 類表。
**建議**:先確認是否有前端/背景任務規劃要用這兩張表(若無,標記可安全下線;見 §4)。

**[low] agent_performance_metrics 全表零使用**
`drizzle/schema.ts:2623-2654`
Grep `agent_performance_metrics`/`agentPerformanceMetrics` 全庫:僅 schema.ts 定義行(2623-2654),無任何 service/router/client 讀寫。
**建議**:同上,列入 §4 死表清單。

**[low] email_verification_tokens 全鏈路孤兒**
`server/services/auth/emailVerificationService.ts`(`EmailVerificationService` class,`export const emailVerificationService`,行 25/139)
Grep 確認:
- `emailVerificationService` 在全庫僅兩處命中:定義檔本身,以及 `server/routers/brainPipeline.ts:1689`——但該行只是「Auth Facade 說明清單」裡的**檔名字串**(文件性質的 inventory 陣列元素),不是 import/呼叫。
- `sendEmailVerification(` 呼叫點:全庫僅 `server/services/auth/emailService.ts:218` 的**定義**本身,無任何呼叫端。
- client 端:`grep -rl "verify-email\|verifyEmail" client/src` 零命中,無 `/verify-email` 頁面。
確認:`email_verification_tokens` 表 + `EmailVerificationService` + `emailService.sendEmailVerification` 三者組成的整條驗證信鏈路,從表到 service 到前端頁面全部零真實呼叫,是完整的「寫好但沒接線」孤兒功能。

**[low] subscriptionPlans 表 + plansRouter 後端完整、前端零呼叫**
`server/routers/plans.ts:1-16`(`plansRouter` = `{ list, getById }`,呼叫 `db.getActivePlans()`/`db.getPlanById()`)
`server/routers.ts:102,482`(已掛載:`plans: plansRouter`)
`drizzle/schema.ts:746`(`subscriptionPlans` 表定義)
Grep `trpc\.plans\.` 於 `client`:零命中。確認 router 本身完整可動(有掛載、有實作),但沒有任何 client 元件呼叫,是「後端完工、前端從未接」的孤兒 router。

### 1.2 migration-schema-mismatch

**[high] drizzle-kit snapshot 機制在第 9 支 migration 後放棄**
`drizzle/meta/0008_snapshot.json`(最後一份 snapshot)
確認:`drizzle/meta/` 目錄下只有 `0000_snapshot.json` 到 `0008_snapshot.json` 共 9 份 + `_journal.json`,但 `drizzle/` 目錄下實際 migration SQL 檔已到 `0098`+ 一帶(`_journal.json` 共 111 筆 entries)。用 Python 解析 `0008_snapshot.json` 得表數 **24 張**;`drizzle/schema.ts` 目前 `mysqlTable(` 出現 **102 次**——落差 **78 張表**,與已知線索「落後 78 張表」精確吻合。
`server/_core/env.validated.ts:386`(`MIGRATION_FAIL_CLOSED` 預設 `"false"`)與 `server/_core/index.ts:459-466`、`server/db.ts:215,256,266`:確認此旗標**預設關(fail-open,只記錄不擋)**,只有明確設成 `"true"` 時才會在 migration apply 失敗時拒絕開機。
**影響(需再查:Railway 環境變數實際值)**:若任何人在此狀態下跑 `npx drizzle-kit generate`,工具會拿落後 78 張表的 0008 快照當「目前 DB 現狀」基準去 diff schema.ts,產生大量假的「新增表/新增欄」migration;若套用到已有這些表的環境會直接衝突報錯。**若** `MIGRATION_FAIL_CLOSED=true`(需查 Railway 實際設定,本機看不到),這類啟動期 migration 失敗會直接擋部署。

**[low] migration 0059 新增的 4 表 × 5 欄 + index 在 schema.ts 完全沒有宣告**
`drizzle/0059_media_archival_fields.sql:1-24`(標頭列出四張表:`drive_asset_libraries` / `teaching_materials` / `consistency_vault` / `r2_storage_snapshots`,各補 `sourceUrl` / `provider` / `archivedAt` / `expiresAt` / `archivalChecksum` 五欄 + functional index)
逐表核對 `drizzle/schema.ts`:
- `driveAssetLibraries`(`schema.ts:578-597`)— 無此五欄
- `teachingMaterials`(`schema.ts:4013-`)— 無此五欄
- `consistencyVault`(`schema.ts:719-740`)— 無此五欄
- `r2StorageSnapshots`(`schema.ts:1940-1949`)— 無此五欄
對照:`digitalAssetLibrary`(`schema.ts:331` 起,`sourceUrl` 見 `:372`)與 `generationHistory`(`schema.ts:935` 起,`sourceUrl` 見 `:961`)——這兩張是 migration **0058** 的表,schema.ts 有正確補上同款五欄。
`server/services/mediaArchivalService.ts:59,73,81,103,200,205,219,227,248,266,285,307` 逐一確認:程式碼只操作 `digitalAssetLibrary`(0058)與 `generationHistory`(0058)的 `archivedAt` 等欄位,完全沒有觸碰 0059 那四張表。
確認:若 0059 已在 prod 套用,DB 層面這 4 表確實多出 20 欄 + 4 index,但 Drizzle ORM(因 schema.ts 未宣告)與 `mediaArchivalService.ts` 全部無法讀寫這些欄位——是一次性遺漏,不是設計如此。**需再查**:Railway prod DB 是否已跑過 0059(本機看不到 `__drizzle_migrations` 實際套用記錄)。

**[low→naming-drift 交叉] migration 檔名重號(0008 為代表,另有 5 組同款)**
`drizzle/0008_admin_api_usage.sql` / `drizzle/0008_numerous_mother_askani.sql`
見 §3(遷移健康)完整清單與驗證。

### 1.3 naming-drift(critical 群組,DI-01 全鏈)

見 §2 完整清單。

---

## 2. 命名漂移完整清單(userId 家族)+ 對 DI-01 的連累 + 統一修法

### 2.1 根因鏈確認

**`server/_core/DatabaseManager.ts:347-379`**(`executeTransaction`)逐行確認:
```
361  const result = await executor(connection);
362  await connection.commit();
...
366  } catch (error) {
367    await connection.rollback();
```
任何一次 `executor` 內拋錯,`catch` 一定 `rollback()` 整個交易(第 367 行),沒有「部分提交」機制。

**`server/db.ts:5300-5370`**(`USER_OWNED_TABLES`,69 個表名字串常數)+ **`server/db.ts:5379-5388`**(`deleteUserAccount`):
```
5386  for (const table of USER_OWNED_TABLES) {
5387    await conn.execute(`DELETE FROM \`${table}\` WHERE userId = ?`, [userId]);
5388  }
```
第 5387 行對**每一張表**都硬編字面 `WHERE userId = ?`——這裡的 `userId` 是 SQL 欄位字面量,不是 Drizzle 欄位物件,不會依各表實際欄名自動替換。

### 2.2 已確認的 userId 家族命名分歧(逐表核對 `drizzle/schema.ts`)

| 表名(USER_OWNED_TABLES 內) | schema.ts 實際欄位 | 位置 | 會炸的原因 |
|---|---|---|---|
| `prompt_assets`(陣列第 **26** 個元素,對照:逐一數 `server/db.ts:5301-5369` 確認 `prompt_assets` 在 `:5326`,前面 25 個) | **完全無使用者欄位**(僅 `promptId`/`assetId`/`relation`) | `schema.ts:1820-1842` | `DELETE ... WHERE userId=?` 直接 MySQL `Unknown column 'userId'`(error 1054) |
| `external_service_subscriptions` | `ownerEmail`(varchar,非 FK,非 int) | `schema.ts:1919-1934` | 同上,無 `userId` 欄 |
| `cost_aggregations` | 無任何使用者欄位(聚合表,維度是 provider+date) | `schema.ts:2112-2130` | 同上 |
| `cost_ledger` | 無使用者欄位(`accountKey` 自由字串科目鍵,非 userId) | `schema.ts:2159-2211` | 同上 |
| `cost_attribution_outbox` | 無使用者欄位(`idempotencyKey`/`payloadJson`) | `schema.ts:2230-2241` | 同上 |
| `alert_configs` | 無使用者欄位(全域告警設定) | `schema.ts:2279-2292` | 同上 |
| `fine_tuned_model_consents` | 無使用者欄位(`modelId`/`consentId` junction 表) | `schema.ts:2414-2426` | 同上 |
| `orb_spirit_collaboration_metrics` | 無使用者欄位(精靈對精靈的聚合指標) | `schema.ts:3310-3334` | 同上 |
| `orb_system_alerts` | 無使用者欄位;且註解自承(`schema.ts:3412-3417`)這是 **MySQL legacy**,真正 prod 表是 Supabase `system_alerts`(`providerHealthProbeJob` 走 Supabase client SDK,不走此 Drizzle 物件) | `schema.ts:3412-3441` | 同上,且此表本身放進 GDPR 清單就是誤植 |
| `data_source_connections` | 欄名是 **`ownerUserId`**,不是 `userId` | `schema.ts:3889-3893` | `Unknown column 'userId'`(欄位存在但字面量不符) |
| `real_earth_entries` | 無任何使用者欄位(全域參考資料,無 owner 語意) | `schema.ts:4244-4260` | 同上,且此表放進清單本身是誤植(非個人資料) |
| `agent_collaboration_sessions` | TS 變數叫 `userId`,但 DB 實際欄名是 **`user_id`**(snake_case,`int("user_id")`) | `schema.ts:2434-2438` | 字面量 `userId` ≠ 實際欄 `user_id`,`Unknown column` |
| `orb_conversations` | 同上,TS 變數 `userId` 對應 DB 欄 **`user_id`** | `schema.ts:2709-2713` | 同上 |

**確認:11 張表完全無使用者欄位 + `data_source_connections`/`real_earth_entries`(欄名不同)+ `agent_collaboration_sessions`/`orb_conversations`(欄名 snake_case)= 至少 13 種不同的「與字面量 `userId` 不符」情形**,不只 11 種。`prompt_assets` 排在陣列第 26 位,是迴圈第一個真正炸掉的點,`executeTransaction` 的 rollback 機制(`DatabaseManager.ts:367`)會讓前 25 張表已刪除的資料**全部復原**,`users` 本體列也不會被刪。這是 DI-01「帳號刪除功能對任何使用者 100% 失敗、每次卡在同一點」的確切根因鏈。

### 2.3 更正(對照原始發現清單的一處錯誤細節)

原始發現主張:「另有 7-9 張有使用者概念的表(`news_articles`、`featured_showcase`、`resource_shares`、`teams`、`team_memberships`、`global_audit_log`、`project_data_access_rules`)完全不在 `USER_OWNED_TABLES` 清單內」。逐表核對後:

- **`team_memberships` 這一項是錯的**——它**確實在** `USER_OWNED_TABLES` 內(`server/db.ts:5357`),且該表本身就有 `userId` 欄位(`schema.ts:4165-4189`,`userId: int("userId").notNull()`)。這條應從清單移除。
- 其餘 6 張逐一核對確認**真的不在清單內**,且各自帶著使用者相關(但非清單語意下的)欄位:
  - `news_articles`——`authorUserId`(nullable)`schema.ts:1176`
  - `featured_showcase`——`curatorUserId`(nullable)`schema.ts:1262`
  - `resource_shares`——`sharedByUserId`(notNull)`schema.ts:4452`,另有 `sharedWithId`(user 或 team,依 `sharedWithType`)
  - `teams`——`ownerId`(notNull)`schema.ts:4153`
  - `global_audit_log`——`actorUserId`(nullable)`schema.ts:4362`
  - `project_data_access_rules`——`createdBy`(notNull)`schema.ts:3866`
- **修正後的數字:6 張表(非 7-9 張)確實有使用者關聯欄位卻不在 GDPR 刪除清單內**,其中多數欄位本身就是 nullable(系統/匿名可為 null),需要人工判斷是否該納入清單、以及刪除時是否該置空而非整列刪除(如 `global_audit_log` 通常要保留稽核軌跡、只置空 `actorUserId`)。

### 2.4 統一修法建議

1. **表名 → 使用者欄位名 map(單一事實來源)**:新增一份 `USER_OWNED_TABLES_MAP: Record<string, string | null>`(表名 → 實際使用者欄位名,`null` 表示「此表無個人資料,不需清」),取代目前的字串陣列 + 硬編 `WHERE userId=?`。`deleteUserAccount` 迴圈改成 `DELETE FROM \`${table}\` WHERE \`${col}\` = ?`,`col` 從 map 取值。
2. **CI 檢查**:寫一支腳本,在建置期對 `USER_OWNED_TABLES_MAP` 的每個 key 做 `drizzle/schema.ts` 的 AST/反射比對,確認 (a) 表存在、(b) 指定欄位存在、(c) 欄位型別是 int 且非文字欄。CI fail 就擋 merge,防止未來新表又漏放/放錯。
3. **分段提交**:`deleteUserAccount` 目前是「全表一次大交易」,任何一張表失敗就全部 rollback。建議改成 per-table try/catch + 記錄哪些表刪除失敗,不因單表錯誤讓已成功的 24 張表復原(至少要能達成「部分刪除 + 明確報告哪裡卡住」,而非現在的「100% 全部失敗且無明確錯誤定位」)。
4. **語意重新分類**:`cost_aggregations`/`cost_ledger`/`cost_attribution_outbox`/`alert_configs`/`orb_spirit_collaboration_metrics`/`orb_system_alerts`/`real_earth_entries` 這 7 張本質是聚合/系統/全域表,不具備 per-user 擁有語意,應直接从 `USER_OWNED_TABLES` 移除(不是幫它們補欄位)。

---

## 3. 遷移健康

### 3.1 migration 檔名重號(6 組確認)

用 `_journal.json`(111 筆 entries)解析 tag 前綴,確認共 6 組重號:

| 組別 | 兩個 tag | idx(套用序) | when(timestamp,嚴格遞增) | ls 字母序 vs 實際套用序 |
|---|---|---|---|---|
| 0008 | `0008_numerous_mother_askani` / `0008_admin_api_usage` | 8 / 9 | 1776622268401 / 1776622268402 | **相反**(ls: admin 先;實際: numerous 先) |
| 0033 | `0033_agent_model_picks` / `0033_add_plan_status_to_sessions` | 33 / 73 | ...002 / ...084 | **相反**(ls: add 先;實際: agent 先) |
| 0067 | `0067_creative_projects` / `0067_repair_worldbuilding_v4_columns` | 60 / 80 | ...067 / ...091 | 一致(ls: creative 先,實際也是) |
| 0080 | `0080_agent_concurrency_registry` / `0080_refresh_tokens` | 92 / 96 | ...092 / ...096 | 一致 |
| 0081 | `0081_orchestration_priority_scope` / `0081_user_workflows` | 93 / 97 | ...093 / ...097 | 一致 |
| 0082 | `0082_learn_modules` / `0082_data_source_expiry` | 94 / 98 | ...094 / ...098 | **相反**(ls: data 先;實際: learn 先) |

確認 **0008 / 0033 / 0082 三組 ls 字母序與真實套用序相反**,與已知線索精確吻合。

**journal 排序機制本身健康度驗證(Python 逐項檢查 `_journal.json` 111 筆 entries)**:
- `idx` 全部唯一且已按套用序遞增排列:確認
- `when`(timestamp)全部嚴格遞增:確認
- `tag` 全部唯一(即使數字前綴重複,完整 tag 字串不重複):確認

**結論**:journal 排序本身無 runtime bug(drizzle-kit 用 `idx`/`when` 判斷套用序,不是靠檔名字母排序),0008 兩檔套用順序目前正確。但這 6 組重號證明**新增 migration 時從無查重機制**——只要兩個人各自跑 `drizzle-kit generate` 拿到同一個下一序號,就會產生同號檔案,靠人工用 `ls` 判讀套用順序在其中 3 組會直接得到錯誤答案。

### 3.2 schema.ts ↔ migration 落差

- `drizzle/meta/` snapshot 只到 `0008`(24 張表),`schema.ts` 現有 102 張表——**78 張表落差**,`drizzle-kit generate` 若被誤用會拿錯誤基準 diff。
- migration `0059` 新增的 4 表 × 5 欄 + 4 index 在 `schema.ts` 完全未宣告(§1.2 已列)。
- 相對地,`0058` 的同款欄位（`digitalAssetLibrary`/`generationHistory`）schema.ts 有正確補上,證明落差是**單次遺漏**不是系統性設計。

### 3.3 需再查(需連 Railway/prod 才能坐實,本次未確認)

- Railway 環境變數 `MIGRATION_FAIL_CLOSED` 的實際值(本機 `.env` 不代表 prod)。
- prod 的 `__drizzle_migrations`(或等效追蹤表)裡,`0008_admin_api_usage`/`0008_numerous_mother_askani` 實際套用順序是否與本機 journal 一致。
- migration `0059` 是否已在 prod 套用(若已套用,則 prod DB 這 4 表已存在 20 個 Drizzle/程式碼完全碰不到的欄位;若未套用,則風險降級為「pending debt」)。
- 是否有人曾經真的跑過 `npx drizzle-kit generate` 並把落後的假 migration 提交進 repo(需查 git log 是否有 `0009` 之後由 generate 產生、而非手寫的 migration 檔案特徵)。

---

## 4. 可安全移除的死欄位/死表清單(建議,執行前仍需與 Bruce 確認產品意圖)

| 項目 | 位置 | 確認依據 |
|---|---|---|
| `agent_collaboration_steps` 全表 | `drizzle/schema.ts:2506-2552` | 全庫零讀寫,僅 schema.ts + 自動生成 relations.ts |
| `agent_collaboration_messages` 全表 | `drizzle/schema.ts:2554-2593` | 同上 |
| `agent_performance_metrics` 全表 | `drizzle/schema.ts:2623-2654` | 全庫零讀寫 |
| `email_verification_tokens` 表 + `EmailVerificationService` + `emailService.sendEmailVerification` 整條鏈 | `server/services/auth/emailVerificationService.ts`,`server/services/auth/emailService.ts:218` | 無 router 呼叫,無 client `/verify-email` 頁面 |
| migration `0059` 補的 4 表 × 5 欄(`sourceUrl`/`provider`/`archivedAt`/`expiresAt`/`archivalChecksum` on `drive_asset_libraries`/`teaching_materials`/`consistency_vault`/`r2_storage_snapshots`) | `drizzle/0059_media_archival_fields.sql` | schema.ts 未宣告,`mediaArchivalService.ts` 不碰;**先查 Railway prod 是否已套用**,已套用則是「補 schema 宣告」而非「移除」 |

**不建議列入「移除」但應標記為孤兒待決策**:`subscriptionPlans` 表 + `plansRouter`——後端完整可用,只是前端沒接,若產品仍打算做訂閱功能,應該是「接前端」而非「刪除」。

---

## 5. 給 Bruce:schema 面最該先處理的 3 條

1. **修 `deleteUserAccount` 的欄位名硬編問題(DI-01 根因)**——這是唯一會讓「使用者要求刪帳號」這個 GDPR 法遵功能**對所有人 100% 失敗**的 bug,且失敗點還會不斷往後移(修好 `prompt_assets` 後下一輪換 `external_service_subscriptions` 炸,再下一輪換 `data_source_connections` 因欄名是 `ownerUserId` 又炸)。建議一次性把 §2.4 的「表名→欄位 map + CI 檢查」做完,而不是逐一補洞打地鼠。同時把 7 張本質非個人資料的聚合/系統表(`cost_aggregations` 等)直接踢出清單。
2. **決定 migration `0059` 那 4 表 20 個孤兒欄位的去留**——如果 prod 已經套用這支 migration,DB 裡已經有 20 個沒人碰得到的欄位在吃儲存空間;如果沒套用,直接刪掉這支 migration 或動手把 schema.ts 補齊,別讓它繼續是「孤兒 debt」。這需要先查一次 Railway prod 的 migration 套用記錄才能拍板,不是本機能決定的。
3. **重建 drizzle-kit 的可信基準**——snapshot 已經落後 78 張表,任何人跑 `drizzle-kit generate` 都會產生垃圾 migration。建議找一個維護窗口,直接對 prod 現況做一次全量 introspect 重建 snapshot(或至少把 `drizzle/meta/` 標記為「不可信,勿用 generate,一律手寫 migration」),同時補一個「新 migration 檔名查重」的 pre-commit/CI 檢查,避免 0008/0033/0082 這種重號再發生。
