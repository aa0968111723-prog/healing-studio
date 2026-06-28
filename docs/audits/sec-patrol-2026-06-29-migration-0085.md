# 資安/營運巡檢 — 2026-06-29（部署阻斷：migration 0085 `ON UPDATE (now())` 語法錯誤）

> 自動巡檢產生。本輪 Jira/Atlassian MCP **未連線**、Railway agent **額度用罄**，故無法開卡，
> 改以本地稽核檔留存。Bruce 回來後請轉成 Jira 卡（issuetype=漏洞，labels=security,secaudit,auto-patrol,sev-high）或直接修。
> **這是新發現，非重複** [[sec-patrol-2026-06-29-deploy-migration]]（那張是 0082 空查詢，已由 PR #1059 / commit 091c2b47 修掉）。

## 嚴重度
**high（部署阻斷，但 prod 仍健康）**

## 現象（接力式部署失敗）
- 前一張卡的 0082 修復（PR #1059，commit `091c2b47`）合進 main 後，觸發自動部署
  `726f0513-838b-49e6-a807-263796b1060f`（healing-studio，2026-06-28T21:10:25Z）。
  此時間幾乎等同 #1059 合併時間（檔註記 05:10 +0800 = 21:10Z），可證此部署即為「0082 修復後的重跑」。
- Build 成功（image 已 push）；啟動時 migration runner **越過 0082**、繼續推進，**卡在 0085**：
  - `sqlMessage: "You have an error in your SQL syntax; ... near '(now())'"`（MySQL **ER_PARSE_ERROR 1064**）
  - 失敗語句為 `CREATE TABLE IF NOT EXISTS skill_registry (...)`
  - `[FATAL] DB migration failed on startup and MIGRATION_FAIL_CLOSED is enabled — refusing to boot.`
- 健康檢查 6 次重試後 `1/1 replicas never became healthy` → 部署 **FAILED**。
- **prod 仍健康**：`GET https://director.today/api/health` 回 `{ok:true, ts:..., storage:true}` HTTP 200
  （由 0085 之前的最後一個健康 image 服務；該舊 image 不含 0085 故重啟也安全）。
- **影響：0082 修好後並未真正解除阻斷——下一支 migration 0085 接力把部署再次擋死，
  自此所有新部署仍無法上線**，直到 0085 修好。

## 根因（單行、唯一）
- `drizzle/0085_skill_registry.sql:31`：
  ```sql
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE (now()),
  ```
- MySQL/MariaDB 的 `ON UPDATE` 子句**只接受 `CURRENT_TIMESTAMP`**，不接受括號表達式 `(now())`
  → 解析器在 `'(now())'` 處報 1064。
- `DEFAULT (now())` 本身合法（MySQL 8.0.13+ 表達式預設），全樹 30+ 個 migration 都這樣寫、prod 跑得好。
- 全 `drizzle/*.sql` 掃描：**0085:31 是整棵樹唯一**使用 `ON UPDATE (now())` 者；
  其餘全部寫 `ON UPDATE CURRENT_TIMESTAMP`（已實證，見「掃描證據」）。屬手寫 migration 打字錯誤。

## 掃描證據
- `grep "ON UPDATE (now())" drizzle/**.sql` → 命中 **1** 檔：`0085_skill_registry.sql:31`。
- `grep "ON UPDATE" drizzle/*.sql` → 其餘約 60 處全為 `ON UPDATE CURRENT_TIMESTAMP`。
- `0085_skill_registry` 已登記於 `drizzle/meta/_journal.json:632` → **會在啟動時實跑**（非孤兒）。
- HEAD（commit `091c2b47`）仍含此 bug，未被任何後續 commit 修掉。

## 殘留不確定（誠實標註）
- 本輪 railway-agent 額度用罄，**無法查 `__drizzle_migrations` 水位**確認 prod 目前停在 0084/0085 邊界；
  但部署 log 的 1064 錯誤明確指向 0085 的 `CREATE TABLE skill_registry`，搭配「唯一 `ON UPDATE (now())`」，
  根因為 0085:31 屬高可信。

## 重現
1. 對水位含 0085 為 pending 的 MySQL 跑 `migrate(db,{migrationsFolder:'drizzle'})`。
2. 套到 0085 第一句 `CREATE TABLE ... ON UPDATE (now())` → MySQL 回 ER_PARSE_ERROR 1064。

## 最小修復
1. **首選（單行）**：`drizzle/0085_skill_registry.sql:31`
   `ON UPDATE (now())` → `ON UPDATE CURRENT_TIMESTAMP`
   （`DEFAULT (now())` 維持不動即可；與全樹一致）。`CREATE TABLE IF NOT EXISTS` 本就冪等，重跑安全。
2. **加固**：把 PR #1059 已加的 migration lint 守衛擴充一條——
   禁止任何 `drizzle/*.sql` 出現 `ON UPDATE (` 後接非 `CURRENT_TIMESTAMP`（即禁括號表達式 ON UPDATE），
   讓未來手寫 migration 一旦再犯就在 CI/單元測試紅燈。
3. 修好後重新部署，確認 replica 變健康、`__drizzle_migrations` 水位推進過 0085（直到 0097）。

## 完成定義
- 新部署 **SUCCESS** 且 `/api/health` 維持 200；`__drizzle_migrations` 含到 0097；
- lint/守衛測試擋住未來括號表達式 `ON UPDATE`。

## 確認指令（Bruce 端，有 DB 存取時）
```sql
SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY id DESC LIMIT 5;
SHOW CREATE TABLE skill_registry;  -- 修好部署後應存在
```

---

## 可直接貼上的 Jira 卡（待 Atlassian MCP 恢復後開）
- **專案/類型**：AIDV / 漏洞
- **labels**：`security`, `secaudit`, `auto-patrol`, `sev-high`
- **summary**：`[資安巡檢] migration 0085 ON UPDATE (now()) 語法錯誤致 prod 部署 fail-closed 阻斷`
- **description**：
  - 檔案:行號：`drizzle/0085_skill_registry.sql:31`
  - 行為：`ON UPDATE (now())` 為非法 MySQL 語法（ON UPDATE 僅接受 CURRENT_TIMESTAMP），啟動 migration 報 ER_PARSE_ERROR 1064；`MIGRATION_FAIL_CLOSED` 生效 → refusing to boot → 部署 FAILED。
  - prod-env 校正後真實影響：prod 站台仍 200（舊 image 服務，不含 0085），但**所有新部署被擋死**；屬部署阻斷而非線上停機，故 high 非 critical。
  - 重現：對 0085 為 pending 的 MySQL 跑 drizzle migrate → 1064。
  - 最小修復：0085:31 改 `ON UPDATE CURRENT_TIMESTAMP`；CI 守衛擴充禁括號表達式 ON UPDATE。
  - 完成定義：新部署 SUCCESS、/api/health 200、水位過 0085、守衛紅燈擋未來犯規。
  - 署名：— 自動巡檢產生

## 已修復（2026-06-29，AIDV 自動開發 · 接力 #1059）
- 本輪 Jira/Atlassian MCP 仍未連線（無法開卡/轉場/留言），故依本稽核檔直接修並走本機驗證門。
- 改動（branch `fix/migration-0085-on-update-now`）：
  1. `drizzle/0085_skill_registry.sql:31`：`ON UPDATE (now())` → `ON UPDATE CURRENT_TIMESTAMP`（與全樹 ~60 處一致；`DEFAULT (now())` 不動）。
  2. `server/migration-prod-pending-block.test.ts`：新增守衛測試「禁括號表達式 `ON UPDATE (`」——剝註解後 `/ON\s+UPDATE\s*\(/i` 命中即 fail；不誤殺外鍵 `ON UPDATE CASCADE/RESTRICT/...` 與 `CURRENT_TIMESTAMP(N)`（已對全樹實證只命中 0085 修前一處）。
- 安全性：0085 在 prod 從未成功套用（即 fail-closed 阻斷點），`__drizzle_migrations` 無其紀錄 → 改檔不致 hash drift；`CREATE TABLE IF NOT EXISTS` ＋ information_schema 守門索引 → 重跑冪等。與已合併並獲接受的 #1059（0082）同理。
- 驗證門全綠：`tsc --noEmit` 0 錯、`npm run check` 通過（54 路由對齊）、`vitest migration-prod-pending-block.test.ts` 7/7（含新守衛）。
- 待 Atlassian MCP 恢復後：開/轉 AIDV 卡並留言對帳；Bruce 端有 DB 存取時用上方「確認指令」核對新部署轉 SUCCESS、水位推進過 0085 直到 0097。

— 自動巡檢產生
