# 資料庫系統健檢報告 (Database Health Audit)

- **專案**：healing-studio
- **日期**：2026-05-26
- **範圍**：Drizzle ORM + MySQL 資料層 — migration 完整性、schema 設計、`server/db.ts` 執行期模式、`server/repositories/`
- **性質**：唯讀稽核，本報告**未修改任何程式碼或 migration 設定**。文末「待決定修復清單」供後續逐項拍板。

---

## 0. 摘要與優先級總表

| # | 嚴重度 | 分類 | 問題 | 證據 |
|---|--------|------|------|------|
| 1 | **HIGH** | Migration | 12 個孤兒 migration 未註冊進 `_journal.json`，`drizzle migrate` 會靜默跳過 → 生產可能缺表/欄位 | `drizzle/meta/_journal.json`（64 筆）vs `drizzle/*.sql`（76 個） |
| 2 | **HIGH** | 執行期 | 181 處 `if (!db) return ...`，其中 92 處無 log → 無法分辨「無資料」與「DB 掛掉」 | `server/db.ts` |
| 3 | **HIGH** | 執行期 | `getAll*` 類查詢無 `.limit()`，大表恐 OOM/拖垮連線池 | `server/db.ts:420, ~1296, ~1872` |
| 4 | **MED** | Migration | 重複 migration 編號 `0008`/`0033`/`0067` | `drizzle/*.sql` |
| 5 | **MED** | Schema | 0 個 Drizzle FK 約束，82 張表關聯全靠命名慣例 | `drizzle/schema.ts` |
| 6 | **MED** | Schema | FK 欄位疑似缺索引（`digitalAssetLibrary.backgroundJobId`） | `drizzle/schema.ts:361` |
| 7 | **MED** | Schema | camelCase 與 snake_case 命名混用 | `drizzle/schema.ts`（如 `agentCollaborationSessions`） |
| 8 | **MED** | Schema | 熱點表 text+json 欄位集中，list 查詢放大 I/O | `drizzle/schema.ts`（多表） |
| 9 | **LOW** | 執行期 | `sql.raw(String(days))` 模式脆弱（**非可利用注入**，days 已 clamp） | `server/db.ts:1442` |
| 10 | **LOW** | Migration | journal idx 跳號、snapshot 自 0008 後未更新 | `drizzle/meta/` |
| 11 | **LOW** | Repository | 兩套並存的資料存取風格（技術債） | `server/repositories/`, `server/db.ts` |

---

## 1. Migration 完整性（最嚴重）

### 1.1 [HIGH] 12 個孤兒 migration 未註冊進 journal

`drizzle-kit migrate` 只執行 `drizzle/meta/_journal.json` 內登錄的 tag。現況：

- journal 條目：**64**
- `drizzle/*.sql` 檔案：**76**
- meta snapshot：只到 `0008_snapshot.json`（後續 migration 多為**手動新增 SQL + 手動補 journal**，且常漏補）

以下 12 個 SQL 檔**不在 journal**，`migrate` 會**靜默跳過**，正式環境若從未以其他途徑手動套用，對應的表/欄位將不存在：

| 孤兒 migration | 冪等性 | 重新註冊風險 |
|----------------|--------|--------------|
| `0033_add_plan_status_to_sessions` | **否（裸 ALTER ADD COLUMN）** | **高 — 重跑必失敗** |
| `0039_orb_long_term_memory` | 是（`CREATE TABLE IF NOT EXISTS`） | 低 |
| `0040_orb_intent_clarification` | 是 | 低 |
| `0041_orb_feature_usage` | 是 | 低 |
| `0042_orb_workflow_templates` | 是 | 低 |
| `0043_orb_system_monitoring` | 是 | 低 |
| `0044_orb_template_ratings_and_alerts` | 是 | 低 |
| `0067_repair_worldbuilding_v4_columns` | 是（`SET @stmt := IF(EXISTS(...))`） | 低 |
| `0071_context_packets` | 是（同上預備語句） | 低 |
| `0072_project_data_access_rules` | 是 | 低 |
| `0073_data_source_connections` | 是 | 低 |
| `0074_fine_tuned_models_team` | 是 | 低 |

**為何嚴重**：`server/db.ts` 已 import 並查詢這些孤兒所建立的物件：

- `contextPackets`（`0071`）、`dataSourceConnections`（`0073`）、`projectDataAccessRules`（`0072`）— 皆在 `db.ts` 頂部 import 區。
- `fineTunedModels.teamId`（`0074`）— 由 `getFineTunedModelsByTeam()` 使用。

若這些 migration 在生產被跳過，相關功能一旦被呼叫即會因「缺表 / 缺欄位」報錯（Drizzle schema 與實際 DB 不同步）。`server/db.ts` 內的 `logOrphanedMigrationFiles()` 已會在開機時 WARN 此類漏登錄，等同系統作者已知此風險。

**冪等性結論**：11 個孤兒可安全重跑（`CREATE TABLE IF NOT EXISTS` 或 `SET @stmt := IF(EXISTS(...))` 預備語句模式）；**僅 `0033_add_plan_status_to_sessions` 不冪等**（連續三個裸 `ALTER TABLE agent_collaboration_sessions ADD COLUMN ...`，無存在性防護，欄位已存在時重跑必失敗）。

### 1.2 [MED] 重複的 migration 編號

`0008`、`0033`、`0067` 各有兩個不同檔名共用同一數字前綴：

- `0008_admin_api_usage` + `0008_numerous_mother_askani` — 兩者皆在 journal。
- `0033_agent_model_picks`（在 journal）+ `0033_add_plan_status_to_sessions`（孤兒）。
- `0067_creative_projects`（在 journal）+ `0067_repair_worldbuilding_v4_columns`（孤兒）。

重複前綴使「依編號排序套用」語意含糊，也讓人誤判某編號已套用。

### 1.3 [LOW] journal idx 跳號、snapshot 停更

journal 的 `idx` 序列缺 `35`、`39–44` 等，且 `drizzle/meta/` 的 snapshot 只到 `0008_snapshot.json`。後果：無法再用 `drizzle-kit generate` 正常做 schema diff（會以過時的 0008 快照為基準），這也是日後改用「手寫 SQL」的根因之一。

---

## 2. Schema 設計 (`drizzle/schema.ts`)

### 2.1 [MED] 完全沒有 Drizzle 外鍵約束

全檔 `.references(` / `foreignKey(` 出現次數 = **0**。82 張表的 `userId` / `teamId` / `modelId` / `projectId` / `consentId` 等關聯，全靠**命名慣例**維繫，DB 層無參照完整性。少數 FK 僅存在於個別原始 SQL migration（例：`0039` 的 `orb_memory_associations` 有 `FOREIGN KEY ... ON DELETE CASCADE`），但未反映在 Drizzle schema。

**風險**：可能產生孤兒列；級聯刪除/更新全靠應用層；應用層 bug 即可破壞一致性。

### 2.2 [MED] FK 欄位疑似缺索引

`digitalAssetLibrary.backgroundJobId`（`schema.ts:361`，`int("backgroundJobId")`）需對照該表索引區塊確認是否有對應 index；若無，依此欄位過濾/關聯會全表掃描。建議全面盤點所有 `*Id` 欄位是否皆有索引。

### 2.3 [MED] 命名慣例混用

camelCase 與 snake_case 並存：多數表用 `createdAt`/`updatedAt`/`userId`，但 `agentCollaborationSessions` 等表用 `collaboration_id`/`user_id`/`created_at`/`updated_at`。Drizzle 雖能對應，但易造成維護混淆與 JOIN 誤用。建議統一 TypeScript 屬性為 camelCase（DB 欄位命名可保留）。

### 2.4 [MED] 熱點表 text/json 欄位集中

`agentCollaborationSessions`、`agentCollaborationSteps`、`digitalAssetLibrary` 等表同時含多個 `text` + `json` 欄位（如 `taskDescription`/`sharedContext`/`planData`/`result`）。若 list 查詢用 `SELECT *`，會放大 I/O 與 JSON 解析成本。建議列查詢只取所需欄位，或將大型 json 垂直拆分至「明細表」。

---

## 3. 執行期模式 (`server/db.ts`)

### 3.1 [HIGH] 靜默 DB 失敗

`if (!db) (return|throw)` 共 **181 處**，其中 **92 處**為無 log 的裸 `return []` / `return null` / `return;`。例：`getAllUsers()`（`db.ts:420`）、`getAllFeedbacks()`（~`1296`）。

**風險**：DB 不可用時，呼叫端收到空結果而非錯誤，無法與「真的沒資料」區分；監控/告警偵測不到 DB 中斷；無重試策略。

**建議**：統一在 `if (!db)` 分支記錄 WARN（含函式名）；對關鍵讀寫考慮回傳可區分的結果型別或丟出錯誤；於 `getDb()` 加 circuit-breaker。

### 3.2 [HIGH] 無上限 SELECT

`getAll*` / `list*` 類函式缺 `.limit()`，例：`getAllUsers`（`db.ts:420`）、`getAllFeedbacks`（~`1296`）、`listStudioRecipes`（~`1872`）。大表時單一查詢可能 OOM、拖慢、佔滿連線池。

**建議**：加預設上限（如 100–200）或分頁參數（`limit`/`offset`）。

### 3.3 [LOW，已校準] `sql.raw` 模式脆弱（非可利用注入）

`getUserDailyTrend()`（`db.ts:1442`）使用：

```ts
sql`${apiUsageLogs.createdAt} >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)`
```

`sql.raw()` 繞過參數化，**但** `days` 上游已 clamp：`const days = Math.max(1, Math.min(90, Math.trunc(opts?.days ?? 7)))` → 永遠是 1–90 的整數，**目前無法注入**。同檔 `getUserDailyTrendRange()`（~`1471`）對等邏輯已改用參數化 `${days}`。

> 校準說明：本項由探索代理原評為「HIGH SQL injection」，經逐行驗證 `days` 已被 clamp 成整數，**降為 LOW**。建議仍移除 `sql.raw`、改用 `${days}`，以求一致性與縱深防禦，避免日後有人放寬 clamp 時引入真實漏洞。

### 3.4 [LOW] 連線池設定合理

`getDb()`（`db.ts:~242`）：`connectionLimit: 20`、`waitForConnections: true`、`maxIdle: 10`、`idleTimeout: 60s`、`enableKeepAlive`。設定健全，無須變更；建議用既有 `getDrizzlePoolStats()`（`db.ts:~305`）監控使用率。

### 3.5 交易使用（無問題）

關鍵扣點/退點（`deductUserQuota`、`refundUserQuota`、`deductUserPoints`、`runDueAutoCreditGrant` 等）正確使用 `db.transaction(async tx => ...)` + `SELECT ... FOR UPDATE` 悲觀鎖。非關鍵的多步驟寫入（如建立 + 記 log）未包交易，屬可接受範圍。

---

## 4. Repository 層 (`server/repositories/`)

### 4.1 [LOW] 兩套並存的資料存取風格

- `server/repositories/base/BaseRepository.ts` — 注入 `getDatabaseManager()`。
- `server/repositories/mysql/SpiritMemoryRepository.mysql.ts` — 直接 import `getDb()`，並定義帶 `limit` 的明確介面。
- 主體 ~3,794 行查詢函式集中在 `server/db.ts`，直接用 `getDb()`。

三者並存、錯誤處理不一致，屬技術債。建議擇一收斂（全面走 repository 類別，或統一於 `db.ts` 並強制 limit/錯誤模式）。非急迫。

---

## 5. 待決定修復清單 (Proposed Fixes — 逐項拍板)

| # | 修復 | 風險 | 備註 |
|---|------|------|------|
| F1 | 將 11 個冪等孤兒重新註冊進 `_journal.json` | 低 | 冪等可安全重跑 |
| F2 | 先把 `0033_add_plan_status_to_sessions` 改寫成冪等（`IF(EXISTS)` 預備語句）再註冊 | 中 | 需確認生產現況，避免裸 ALTER 重跑失敗 |
| F3 | 處理重複編號 `0008`/`0033`/`0067`（文件化或重編） | 中 | 重編需同步 journal |
| F4 | `getAll*` / `list*` 加 `.limit()` 或分頁 | 低 | |
| F5 | 移除 `db.ts:1442` 的 `sql.raw`，改 `${days}` | 低 | 純一致性/縱深防禦 |
| F6 | 為熱點 `*Id` 欄位補索引 | 低 | 先全面盤點缺索引欄位 |
| F7 | 評估補 Drizzle `.references()` / MySQL FK | 中 | 需與既有資料相容，可能要先清孤兒列 |
| F8 | 統一 `if (!db)` 的 log / 錯誤策略 | 中 | 跨 ~92 處，建議集中包裝 |
| F9 | 收斂 repository 與 `db.ts` 的雙軌存取 | 中 | 技術債，非急迫 |

**建議優先序**：F1 → F2（解最嚴重的生產缺表風險）→ F4、F5、F6（低風險速贏）→ F3、F7、F8、F9（較大或需設計）。

---

## 附錄：複現指令

```bash
# 孤兒 migration（不在 journal）
comm -23 <(ls drizzle/*.sql | sed -E 's#drizzle/(.*)\.sql#\1#' | sort) \
         <(grep '"tag"' drizzle/meta/_journal.json | sed -E 's/.*"tag": *"([^"]+)".*/\1/' | sort)

# 重複 migration 編號
ls drizzle/*.sql | sed -E 's#drizzle/([0-9]{4})_.*#\1#' | sort | uniq -d

# 靜默 DB 失敗計數
grep -cE 'if \(!db\) (return|throw)' server/db.ts

# Drizzle FK 約束數（預期 0）
grep -cE '\.references\(|foreignKey\(' drizzle/schema.ts
```
