# Supabase Realtime 現況說明（AIDV-786）

> 查證日期：2026-07-02 ・ 專案：healing-studio（ref `vllsoxwruwfzdaxdbjwi`）・ 全程唯讀 SQL，未執行任何 ALTER/DDL

## 結論（TL;DR）

**本專案目前「不使用」Supabase Realtime（`realtime-not-used`）。**
前端/後端 codebase 全站搜尋皆無任何 Supabase Realtime 訂閱（無 `supabase.channel(...)`、無 `postgres_changes`）；即時性需求由 SSE（`client/src/components/SSEFallbackBanner.tsx`）與 WebSocket（`server/ws/`）承擔。Realtime 服務端未完成初始化屬平台面問題，但因無任何消費者，**不影響現有功能**，列為「已文件化、不啟用」狀態。

## 唯讀查證結果（2026-07-02）

| 檢查項 | 結果 | 意義 |
|---|---|---|
| `SELECT * FROM pg_publication_tables` | **0 列（空）** | publication 內沒有任何表，WAL 不會廣播任何變更 |
| `SELECT * FROM pg_publication` | `supabase_realtime` 存在，owner=`postgres`，`puballtables=false`，insert/update/delete/truncate 皆 true | publication 骨架在，但沒掛表 |
| `pg_tables WHERE schemaname='realtime'` | 只有 `schema_migrations`（owner=`supabase_admin`） | `realtime.subscription`／`messages` 缺失 → Realtime tenant 伺服器從未完成初始化 |
| `pg_replication_slots` | **0 列（空）** | Realtime 服務完全沒接上 WAL（連 replication slot 都沒有） |
| `wal_level` | `logical`（`max_replication_slots=5`） | WAL 基礎設施就緒，非阻礙 |
| `pg_available_extensions`（wal2json） | available 2.6，**未安裝** | Supabase Realtime 用內建 pgoutput/自管機制，此項僅供參考 |

## 權限判定：能否自行加表？

| 操作 | 可行性 | 依據 |
|---|---|---|
| `ALTER PUBLICATION supabase_realtime ADD TABLE public.<t>` | **權限上可行**（不會 42501） | publication owner=`postgres`＝MCP 連線角色（`current_user=postgres`）；public 十張表 owner 皆 `postgres` |
| 在 `realtime` schema 建表／補 `realtime.subscription` | **不可行（42501，平台管理）** | `has_schema_privilege('postgres','realtime','CREATE') = false`；`postgres` 非 `supabase_admin` 成員；realtime schema 由平台（supabase_admin）管理 |
| 啟動 Realtime tenant 伺服器（產生 subscription 表＋replication slot） | **不可行 via SQL/MCP** | 屬專案層設定：Supabase Dashboard → Settings → API → Realtime 開關，或聯絡 Supabase support |

即：**掛表這一步我們自己做得到，但光掛表沒用**——Realtime 伺服器端（`realtime.subscription`、replication slot）未初始化，掛了表也不會有事件送達前端。

## Codebase 使用現況

- 全 repo 搜 `\.channel\(`、`postgres_changes`：**0 筆**。
- `client/`、`server/` 內出現的 "realtime" 字樣皆為 SSE/WebSocket/語音相關命名，與 Supabase Realtime 無關。
- 即時更新走向：SSE（含 fallback banner）＋ `server/ws/` WebSocket gateway。

## 決議與後續

1. **現狀**：不啟用 Realtime，Jira 卡加 `realtime-not-used` 標籤，移出監控告警範圍（監控不應再對 realtime 零流量告警）。
2. **未來若要啟用**（有真實訂閱需求時）：
   - 先在 Supabase Dashboard 開啟 Realtime（讓平台初始化 `realtime.subscription` 與 replication slot）；
   - 再以 repo migration（供人審，範例如下）掛表，**不由 agent 直接對 prod 執行**：
     ```sql
     -- 範例（未執行；僅在確認啟用 Realtime 後由人審核套用）
     ALTER PUBLICATION supabase_realtime ADD TABLE public.video_projects;
     ALTER PUBLICATION supabase_realtime ADD TABLE public.video_segments;
     ```
   - 並在前端加上對應 `supabase.channel(...).on('postgres_changes', ...)` 消費端。

## 相關卡

- AIDV-786（本卡）・AIDV-783（R49 安全巡邏）・AIDV-767（R47 escalation）・AIDV-341（原始卡）
