# Supabase 後端遷移計畫

> 狀態：**計畫階段**（尚未改動任何應用程式碼）
> 分支：`claude/supabase-backend-migration-FNCsz`
> 撰寫日期：2026-06-04

---

## 0. 一句話結論

**技術上完全可行，但不是「換連線字串」的無痛搬遷。** 核心工程量集中在
**MySQL → PostgreSQL** 的方言轉換；認證與部署 runtime 不屬於 Supabase 能接管的範圍。

---

## 1. 先釐清：Supabase 能接管什麼、不能接管什麼

Supabase = 託管 **PostgreSQL** + Auth + Storage + Realtime + **Deno** Edge Functions。

| 你的元件 | Supabase 能接管？ | 說明 |
|---|---|---|
| 資料庫（MySQL） | ✅ 能 | 改成 Supabase 託管 Postgres。**這是遷移主體。** |
| 檔案儲存（R2 / GCS） | ✅ 可選 | 可換 Supabase Storage，或維持 R2/GCS 不動。 |
| 自建認證（密碼/TOTP/OAuth/credit） | ⚠️ 可選但不建議 | 你的認證跟 `users` 表、credit 制度深度綁定，換 Supabase Auth 風險高、收益低。 |
| **Node/Express+tRPC server（runtime）** | ❌ **不能** | Supabase 不託管長駐 Node 程式。server 仍需 host（Railway 留著，或 Fly/Render）。Edge Functions 是 Deno，無法承載這個大型 tRPC app。 |
| 背景排程 / node-cron jobs | ❌ 不能（直接） | 跟 server 一起留在 Railway，或改用 Supabase `pg_cron` + Edge Functions（大改，不建議首階段做）。 |

> **對「全部轉移」的決策含義**：即使全套搬，**app server 的部署不會進 Supabase**。
> 「全部轉移」實際指的是：DB（必做）＋ Storage（可選）＋ Auth（可選）。

---

## 2. 我透過 Supabase MCP 能掌控的範圍

這個 session 已連線 Supabase MCP，我能直接操作 **資料/後端服務層**（不含 Railway 部署）：

- 建立 / 查詢 / 暫停 / 還原專案（已完成建立，見 §3）
- `apply_migration` / `execute_sql`：套用 schema、建表、建 index、灌資料
- `list_tables` / `list_migrations` / `list_extensions`：盤點現況
- `get_advisors`：安全（RLS 缺漏）與效能建議
- `get_logs`：API / Postgres / Auth 各服務日誌
- `generate_typescript_types`：由 DB 產生 TS 型別
- `deploy_edge_function`：部署 Deno Edge Function
- 分支（branch）：建立隔離的開發資料庫做測試後 merge
- `get_project_url` / `get_publishable_keys`：給前端用的連線資訊

**我無法掌控**：Railway 部署、DNS、你的 R2/GCS 帳號、Supabase DB 的 **superuser 密碼**（需你在 Dashboard 取得後填入 `DATABASE_URL`）。

---

## 3. 已建立的 Supabase 專案

| 項目 | 值 |
|---|---|
| Project Ref | `vllsoxwruwfzdaxdbjwi` |
| API URL | `https://vllsoxwruwfzdaxdbjwi.supabase.co` |
| 區域 | `ap-northeast-1`（東京，對台灣延遲最低） |
| 方案 | Free（$0/月） |
| Publishable key | `sb_publishable_m1ehKn0jxUbg_WdBw8bNjw_X9JfMjK1` |
| 狀態 | `ACTIVE_HEALTHY` |

> `DATABASE_URL` 的密碼需你到 Supabase Dashboard → Project Settings → Database 取得（建議用
> **Session/Transaction pooler** 連線串，搭配你現有的連線池設定）。

---

## 4. 現況盤點（遷移影響面）

| 項目 | 現況 | 遷移衝擊 |
|---|---|---|
| ORM | Drizzle，query builder 為主（~161 處）、原生 SQL 少（~10 處） | 中 |
| Schema | `drizzle/schema.ts`，**82 張表 / ~3,950 行**，全用 `mysql-core` | **大**（整份改寫 `pg-core`） |
| Migrations | `drizzle/` 下約 **75 個 MySQL 方言 .sql** | **大**（無法重播，需重建 baseline） |
| 連線層 | `server/_core/DatabaseManager.ts` 死綁 `mysql2` | **大**（整支重寫成 `postgres`/`pg`） |
| 設定 | `drizzle.config.ts` `dialect:"mysql"`；`server/config/database.ts` **已預留 `"postgres"` driver 型別** | 小（已有鋪路） |
| 認證 | 自建（密碼/TOTP/OAuth/credit），不動 | 無（沿用） |
| 儲存 | R2 / GCS，`server/storage.ts` | 無（首階段沿用） |
| 部署 | Railway / Nixpacks / Docker | 無（沿用，只改環境變數） |

---

## 5. MySQL → PostgreSQL 型別與語法對照（重點）

| MySQL（現況） | PostgreSQL（目標） | 注意事項 |
|---|---|---|
| `mysqlTable` | `pgTable` | 全表替換 |
| `mysqlEnum("x",[...])` | `pgEnum` + 欄位引用 | enum 在 PG 是獨立型別，需先 `CREATE TYPE` |
| `int().autoincrement()` | `serial` / `integer generated always as identity` | 主鍵自增語意改變 |
| `bigint` | `bigint` | mysql2 回傳 string vs PG 行為差異，需驗證 |
| `mediumtext` / `text` | `text` | PG 無 mediumtext，統一 `text` |
| `json` | `jsonb` | PG 建議 `jsonb`（可索引、去重） |
| `boolean`（tinyint(1)） | `boolean` | 原生支援，較乾淨 |
| `timestamp` / `datetime` | `timestamptz` | **時區語意**需逐欄確認，避免位移 |
| `decimal` | `numeric` | 對應 |
| ``` `camelCase` ``` 識別字 | `"camelCase"` | PG 對未加引號識別字會轉小寫；Drizzle 會自動加雙引號，但原生 SQL 需手動改 |
| `ON DUPLICATE KEY UPDATE` | `INSERT ... ON CONFLICT ... DO UPDATE` | 原生 upsert 需改寫 |
| `LIMIT a, b` | `LIMIT b OFFSET a` | 分頁語法 |
| 錯誤碼 `ER_LOCK_DEADLOCK` 等 | SQLSTATE（`40P01` 等） | `DatabaseManager` 的 transient/錯誤判斷需重映射 |

---

## 6. 分階段執行計畫

### Phase 0 — 準備（不改 runtime 行為）
1. 新增 `pg`（或 `postgres`）、`drizzle-orm/postgres-js` 依賴。
2. `drizzle.config.ts` 新增 Postgres 設定（可與 MySQL 並存做對照產生）。
3. 在 Supabase 開一個 **branch 資料庫** 當作搬遷沙盒（避免污染主 DB）。

### Phase 1 — Schema 轉換（核心）
4. 將 `drizzle/schema.ts` 改寫為 `pg-core` 版本（82 表逐一對照 §5）。
5. 用 `drizzle-kit generate` 產生 **Postgres baseline migration**（取代 75 個 MySQL 檔）。
6. 透過 MCP `apply_migration` 套到 Supabase branch，跑 `list_tables` 驗證結構。
7. 跑 `get_advisors` 檢查 RLS / 安全建議（Supabase 預設啟用 RLS 概念）。

### Phase 2 — 連線層重寫
8. 重寫 `server/_core/DatabaseManager.ts`：`mysql2` → `postgres`/`pg`，
   保留 circuit breaker / health check / timeout / pool stats 介面不變（對外 API 相容）。
9. `server/db.ts`：Drizzle 多數可平移；逐一處理 `sql\`\`` 原生片段與 upsert。
10. 重映射錯誤碼與 transient 判斷。

### Phase 3 — 資料搬遷
11. 從 MySQL dump → 轉換（型別/布林/時間）→ 灌入 Supabase（pgloader 或自訂 ETL script）。
12. 抽樣比對筆數與關鍵資料一致性。

### Phase 4 — 驗證
13. 跑全套測試：`npm run test`（vitest）+ `npm run typecheck` + `npm run check:routes`。
14. 本地以 Supabase `DATABASE_URL` 啟動 `npm run dev`，煙霧測試關鍵流程（登入、生成、credit）。

### Phase 5 — 切換上線
15. Railway 環境變數 `DATABASE_URL` 指向 Supabase（先用 staging 驗證）。
16. 觀察 `get_logs` 與 app 監控，保留 MySQL 一段時間可回滾。

### （可選）Phase 6 — Storage / Auth
17. Storage：`server/storage.ts` 增加 Supabase Storage adapter。
18. Auth：評估是否值得（**預設不做**）。

---

## 7. 風險與回滾

| 風險 | 緩解 |
|---|---|
| 時間欄位時區位移 | Phase 1 逐欄確認 `timestamptz`，Phase 3 抽樣比對 |
| `bigint`/`json` 行為差異 | 型別測試 + 全測試套件 |
| 原生 SQL upsert / 分頁語法 | grep 全列出後逐一改寫並加測試 |
| 資料搬遷中斷 | 用 Supabase branch 沙盒先演練；正式切換前雙寫或維護視窗 |
| 認證/credit 受影響 | `users` 表型別嚴格對照，登入/credit 流程煙霧測試 |
| 回滾 | 切換僅改 `DATABASE_URL`；MySQL 保留 N 天即可秒回滾 |

---

## 8. 待你確認 / 提供

1. **要不要連 Storage、Auth 一起搬？**（預設只搬 DB；Auth 不建議搬）
2. **資料搬遷**：正式 MySQL 資料要不要我一起搬？需要你提供匯出（dump）或唯讀連線。
3. **切換方式**：要不要先在 Railway 開 staging 環境驗證再切正式？
4. `DATABASE_URL` 密碼請從 Supabase Dashboard 取得後設定（我無法讀取）。
