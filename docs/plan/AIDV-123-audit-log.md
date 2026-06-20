# AIDV-123 全站操作稽核軌跡（audit log）— 基礎版

> PR-only，給 Bruce 審。**純加法、原操作零行為改變**。

## 範圍（卡片完成定義）

統一稽核事件（登入、建立/修改/刪除 專案・資產・提示詞・教材、共享/撤銷、
生成、連接器授權、成本操作）；欄位 actor／時間／動作／目標物／結果／來源 IP／
裝置；唯讀 admin 查詢（依成員/專案/時間過濾＋匯出）；保留策略。

## 已做（本 PR）

| 項目 | 檔案 |
|---|---|
| schema：append-only `global_audit_log` 表（bigint PK、無 updatedAt） | `drizzle/schema.ts`（末尾 `globalAuditLog`） |
| migration（governance 合規：information_schema 守門、一 breakpoint 一句） | `drizzle/0076_global_audit_log.sql` |
| journal 登記（idx **80**、when **1779050000080** > 現有最大 1779050000079） | `drizzle/meta/_journal.json` |
| `recordAuditEvent()` / `extractRequestSource()` / `queryAuditEvents()` / `countAuditEvents()` | `server/services/audit/auditLog.ts` |
| admin 唯讀查詢 router（events 過濾分頁 + export 匯出） | `server/routers/auditLog.ts`（掛進 `server/routers.ts` 的 `auditLog`） |
| 代表性接線 6 處 | 見下表 |
| 測試（helper 寫入/skip/不 throw + 查詢 + migration 守門綠） | `server/services/__tests__/auditLog.test.ts` |

### 欄位

`id`(bigint PK)・`actorUserId`(int, nullable)・`actorRole`(varchar)・
`action`(varchar `<domain>.<verb>`)・`targetType`・`targetId`(varchar，相容
int/uuid)・`result`(enum success/failure)・`ipAddress`(varchar45)・
`userAgent`(text)・`metadata`(json)・`createdAt`(timestamp)。

### 接線的 6 個關鍵寫入點（純加法、接在原操作成功之後、不 await）

| action | 位置 |
|---|---|
| `project.create` | `server/routers/creativeProject.ts` create |
| `project.update` | `server/routers/creativeProject.ts` update |
| `project.delete` | `server/routers/creativeProject.ts` delete |
| `prompt.delete` | `server/routers/promptLibrary.ts` delete |
| `asset.share` / `asset.unshare` | `server/routers.ts` assets.toggleVisibility |
| `asset.delete` | `server/routers.ts` assets.delete |

## 設計決策

- **action 用 varchar 而非 enum**：接新寫入點是純加法，不需改 migration 動 enum。
- **append-only / 不可竄改**：service 只提供 INSERT + SELECT，沒有任何
  update/delete 函式；admin router 只有 query（無 mutation）；一般使用者沒有
  任何寫/改稽核端點 → 天然不可竄改。
- **best-effort 鐵則**：`recordAuditEvent` 用 `setImmediate` fire-and-forget +
  內部 try/catch 吞錯，呼叫端拿到 void、永遠不會因稽核失敗而中斷主操作；
  無 DB / demo 安全 skip。
- **IP/UA 取法**沿用 `modelConsents.ts` 既有 `x-forwarded-for → req.ip` 慣例。

## 待 Bruce 拍板（基礎版刻意不做）

1. **保留天數（retention）**：`loginHistoryService.cleanupOldHistory(90d)` 已是
   現成樣板。稽核軌跡保留幾天？目前**不自動清理**。
2. **要不要全站接線**：本 PR 只接 6 個代表性寫入點。是否把全部寫入
   procedure（生成完成、連接器授權、成本操作、所有 CRUD、登入對齊
   login_history…）都接上？
3. **竄改防護程度**：目前靠「無寫/改端點 + DB 權限」。是否再加 hash-chain /
   WORM / 獨立稽核 DB / 寫入即簽章？
4. **IP 來源欄位可信度**：`x-forwarded-for` 在反向代理後可被偽造。是否改用
   平台可信 header（CF-Connecting-IP）或限定 trust proxy hops？
5. **登入事件對齊**：`login_history` 已記登入（含 IP/device/失敗原因）。是否把
   登入「鏡像」進 `global_audit_log` 統一查詢，或維持兩表分流？

## HARD SAFETY 對照

1. **純加法、原操作零行為改變**：所有接線都在原 mutation 成功之後加一行
   `recordAuditEvent(...)`（不 await、不進 try 成功鏈），原邏輯一字未動。
2. **demo / 無 DB 安全 skip**：`getDb()` 回 null 時 `writeAuditEvent` 直接
   return、`query/count` 回空/0。
3. **migration governance 合規 + 已登記 journal**：0076 仿 0075，
   information_schema 守門、一 breakpoint 一句、無 `CREATE INDEX IF NOT EXISTS`；
   journal idx 80 / when 1779050000080（> 現有最大）。
4. **best-effort 不阻塞**：`setImmediate` + try/catch 吞錯，稽核 DB 掛掉不影響
   使用者操作。
