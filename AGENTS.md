# Healing Studio Agent Notes

## 多代理協作與分工（2026-06-21 起 · 所有本機助理必讀）

> 取代 `COORDINATION.md` 的 4-shell 階段板運作模式（4-shell 已合入 main 並上線）。
> **單一真實佇列 = Jira 專案 `AIDV`**（cloudId `a70fd562-5997-4fe4-8de7-18ac3e894a29`）。權威基準 = GitHub `origin/main` HEAD。

### 角色分工
**🔎 找問題的（只開 Jira 卡、不寫碼／不合併）**
- **QA 探查 bot**（`/aidv-qa-explore`，45 分）— 瀏覽器模擬創作者實測 director.today，找 UX／功能 bug。
- **資安巡檢**（cron 每小時）— Railway 健康＋env 驗證＋資安/DB 漏洞掃描。
- **任務卡優化**（`/aidv-optimize`，90 分）— 收集→驗證→去重→寫 `opt-card`。
- **PR↔任務卡一致性巡檢（Codex）**（45 分）— 查 PR 是否對映任務卡、回報落差。

**🛠️ 修問題的（接卡→實作→驗證→合併→部署→Jira 完成）**
- **aidv-longloop（Claude，總調度＋主力）** — 親手做 WIP=1 最高優先卡，並把其他就緒卡派發給平行 session。
- **平行 session（spawn 出去的）** — 接派發的卡，獨立 end-to-end。

### 防撞協定（每個會「寫碼／合併」的 agent 必守）
1. **認領 = 把 Jira 卡轉「進行中(31)」**。一卡一人；**不碰已在「進行中」的卡**。
2. **合併前必 `git fetch` ＋ rebase 到最新 `origin/main`**——並行合併是常態，stale base 會悄悄倒退別人已合的修正（曾差點倒退 #954 的 migration journal）。
3. **prod 防災鐵則**：`MIGRATION_FAIL_CLOSED=true` 已開（migration 套用失敗會擋啟動）→ 任何 migration 必 Docker 真跑驗證、`_journal.json` idx 接續勿撞（目前到 91）、註解禁字面 `--> statement-breakpoint`。
4. **金鑰只進 Railway env**，不入 repo/log/Jira。不弄壞 aiProxy 請求路徑 / demo / JWT。
5. **真實驗證**：tsc 用 `node ./node_modules/typescript/lib/tsc.js -p tsconfig.json --noEmit`（非 npx）；Docker 演練必用與 prod 相同的二進位（否則假綠）。
6. 每張卡完成在 Jira 留**白話**留言（工程小白 Bruce 看）。

### 優先序（只在「挑下一張」時用）
`P0/P1 壞掉核心動作 ＞ sev-high 資安 ＞ 在飛卡收尾 ＞ Wave-H 硬化 ＞ backlog by Rank ＞ sev-latent/低/UX`

## Codex CLI install troubleshooting

If `npm install -g @openai/codex` fails with `403 Forbidden` in this environment, the failure is usually caused by the enforced HTTP(S) proxy (`proxy:8080`) blocking access to `registry.npmjs.org`.

### Verified behavior in this container
- With proxy env vars enabled: request returns `403 Forbidden` from the proxy tunnel.
- With proxy env vars disabled: DNS lookup fails (`EAI_AGAIN`), so direct internet access is not available.

### Practical fix options
1. Ask the environment/network admin to allow `https://registry.npmjs.org/@openai%2fcodex` through the proxy.
2. Use an approved internal npm mirror that contains `@openai/codex`.
3. Install Codex CLI via Homebrew (`brew install codex`) in an environment where Homebrew access is allowed.

## DB 架構：MySQL (Drizzle) vs Postgres (Supabase) — AIDV-726/730

本專案有**兩套平行的 DB schema**，必須分清楚以免寫錯表：

| 層 | 技術 | Schema 位置 | 用途 |
|---|---|---|---|
| **MySQL (舊)** | Drizzle ORM (`mysqlTable`) | `drizzle/schema.ts` | 本機/Railway MySQL；所有 `orb_*` 前綴表定義於此 |
| **Postgres (prod)** | Supabase client SDK + migrations | `supabase/migrations/` | 實際線上資料庫；RLS 已開 |

### 重要命名差異

`system_alerts` 是典型案例：
- `drizzle/schema.ts` 中的物件叫 `orbSystemAlerts`，MySQL 表名 = `orb_system_alerts`
- Supabase prod 的實際表名 = **`system_alerts`**（沒有 `orb_` 前綴）
- `providerHealthProbeJob` 用 **Supabase client SDK** 寫入，目標正確是 `system_alerts`
- `server/db.ts` 的 `USER_OWNED_TABLES` 是 MySQL GDPR 刪除用的列表，含 `"orb_system_alerts"` 是 MySQL 名

### 規則

1. **新監控/告警代碼** → 寫 Supabase `system_alerts`（用 Supabase client SDK），不用 Drizzle `orbSystemAlerts`
2. **`drizzle/schema.ts` 的 `orb_*` 物件** → MySQL only，不代表 Supabase 有同名表
3. 未來從 Drizzle scaffold migration 時，注意 table name 可能與 Supabase 表名不同
