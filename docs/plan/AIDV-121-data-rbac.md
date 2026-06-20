# AIDV-121 團隊資料可見性／權限邊界 SSOT（資料層 RBAC 基礎版）

> 狀態：**PR-only 基礎版，enforcement 旗標 `ENABLE_DATA_RBAC` 預設 OFF＝零行為變化**。
> 待 Bruce 拍板角色集、預設可見範圍、移轉策略、全站接線後，再分卡推進。

## 1. 已做（本 PR）

| 層 | 檔案 | 內容 |
|---|---|---|
| 純函式授權中樞 | `server/services/authz/resourceAccess.ts` | `canAccess(resource, subject, action)`、`resolveEffectiveRole`、`roleCan`、`isDataRbacEnabled`。不碰 DB、不讀 env（除旗標 helper）、不 throw → 可單測、demo/無 DB 安全。 |
| DB 橋接層 | `server/services/authz/resourceAccessResolver.ts` | 把 DB 事實（團隊成員 `listTeamIdsForUser`、顯式共享 `getSharesForUserOnResource`）組進純函式。**只在旗標 ON 時被呼叫**。 |
| 顯式共享 SSOT 表 | `drizzle/schema.ts` `resourceShares` + `drizzle/0077_resource_shares.sql` | 泛型 junction（resourceType／resourceId／sharedWithType user\|team／sharedWithId／role viewer\|editor／sharedByUserId）。journal idx 81、information_schema 守門、一句一 breakpoint。 |
| db helper | `server/db.ts` | `listSharesForResource` / `getSharesForUserOnResource` / `listSharedResourceIdsForUser` / `upsertResourceShare` / `revokeResourceShare` / `deleteAllSharesForResource` / `transferResourceOwnership` / `getResourceOwnerFacts`。全 demo 安全。 |
| 共享生命週期 router | `server/routers/rbac.ts`（掛 `appRouter.rbac`） | `share` / `revokeShare` / `listShares` / `transferOwnership`，全 owner-gated。**不受旗標 gate**（寫入純加法、不改讀取行為）。 |
| 旗標 | `server/_core/env.validated.ts` `ENABLE_DATA_RBAC`（預設 `"false"`） | OFF＝各 router 不進 canAccess，行為位元相同。 |
| enforcement 接線（3 點，旗標 ON 才生效） | `assets.teamAssets`（`server/routers.ts`）、`creativeProject.get`、`promptLibrary.getById` | 見 §3。 |
| 測試 | `server/services/authz/__tests__/*`、`server/routers/__tests__/rbac.test.ts`、migration guard 0077 | 48 綠。 |

## 2. 角色與可見性模型（本 PR 採用的決策）

**資源層角色**（對「單一資源」而言，與全站系統角色 admin/leader 正交）：

| 角色 | 來源 | view | edit | delete | share/transfer |
|---|---|---|---|---|---|
| owner | `resource.userId === user.id` | ✅ | ✅ | ✅ | ✅ |
| editor | 顯式共享 role=editor，或 `visibility='team_shared'` 且為該 team 成員 | ✅ | ✅ | ❌ | ❌ |
| viewer | 顯式共享 role=viewer | ✅ | ❌ | ❌ | ❌ |
| none | 以上皆非 | ❌ | ❌ | ❌ | ❌ |

**可見性來源（兩條，OR）**：
1. 既有 `visibility='team_shared'` 欄位 + user ∈ 該 team 成員（沿用教材庫／提示詞收集語意）。
2. 顯式共享表 `resource_shares`（分享給單一 user 或整個 team）。

**預設最小可見**：任何來源都沒命中 → `canAccess` 回 false。`delete`/`transfer` 永遠只屬 owner。

## 3. 旗標 ON 已 enforce 的點，與 OFF 零變化保證

| 接點 | OFF（預設，位元同現狀） | ON（canAccess 過濾） |
|---|---|---|
| `assets.teamAssets` | 回全站 `team_shared` 資產（既有行為，含已知 cross-tenant 洩漏，本 PR 刻意不在 OFF 時改它） | 對每筆 `canAccess('asset', view)` 過濾，只留 owner／被顯式共享／池成員可見的 → A 看不到 B 未共享的 |
| `creativeProject.get` | 非 owner → `NOT_FOUND`（原 `row.userId !== ctx.user.id` 行為） | owner 仍可，且額外允許被顯式共享的 viewer/editor 看到 |
| `promptLibrary.getById` | `WHERE id=? AND userId=?`（owner-only，原 SQL 等價） | by-id 取後 owner 仍可，額外允許被顯式共享的 viewer/editor |

**零變化怎麼保證（HARD SAFETY ①）**：
- 每個接點都以 `if (isDataRbacEnabled())`（或 `!isDataRbacEnabled()` 早返回原路徑）包住新邏輯；旗標 OFF 時 `canAccess` 完全不在資料路徑被呼叫。
- `ENABLE_DATA_RBAC` 在 `env.validated` 預設 `"false"`，測試環境亦未設 → 有單測 `isDataRbacEnabled()` 無 override 時必為 false（機器可驗證）。
- `creativeProject.get` / `promptLibrary.getById` 的 OFF 分支與原碼邏輯等價（NOT_FOUND/owner-only）；`assets.teamAssets` 的 OFF 分支完全不執行新的 for-loop。

## 4. HARD SAFETY 逐條

1. **旗標 OFF＝零行為變化**：所有接點 OFF 路徑與現狀位元相同（見 §3）；有單測證明預設 OFF。
2. **不弄壞既有存取**：owner 路徑在三接點皆保留；`creativeProject.router.test.ts`、`auditLog.test.ts` 回歸綠。
3. **demo／無 DB 安全**：所有 db helper `getDb()===null` 時讀回空集合、寫才 throw；resolver 在空集合下等同「只剩 owner 過」。
4. **migration 合規**：0077 用 information_schema 守門、一句一 `--> statement-breakpoint`、無 `CREATE INDEX IF NOT EXISTS`；登記 `_journal.json` idx 81（>現有最大 80）；納入 `migration-prod-pending-block.test.ts` PENDING_BLOCK。
5. **canAccess 為 pure function**：不碰 DB/env（除旗標 helper）/不 throw，17 個純函式單測。

## 5. 設計決策＋待 Bruce 拍板

**本 PR 已定（可改）**：
- 不在各資源表硬塞 teamId/sharedWith 欄，改用一張泛型 `resource_shares`（避開 `digital_asset_library` 的 team_shared 孤兒 enum、`creative_projects` 無共享欄等不一致）。
- 角色集＝owner/editor/viewer 三級；team_shared 池成員視為 editor（沿用教材庫「池內成員可讀寫」語意）。
- 共享寫入與 enforcement 解耦：share/transfer 不受旗標 gate（純加法、可先累積資料）。

**待拍板**：
1. **角色集**：是否需要更細（commenter／manager／不同資源不同角色集）？team_shared 池成員該是 editor 還是 viewer？
2. **預設可見範圍**：目前「預設最小可見」。是否要 workspace-wide public 層（如教材庫 public_disciples）？
3. **跨成員引用規則**：被共享的資源能不能被引用進別人的專案／生成鏈？引用後原 owner 撤銷共享時，既有引用如何處理？
4. **移轉策略**：成員離開團隊時，其素材自動移轉給誰（team owner？指定接班人？）？是否要批次移轉端點＋是否連同 `resource_shares` 一併改寫。本 PR 只提供單筆 `transferOwnership`。
5. **是否全站接線（全互通）**：目前只接 3 個代表性讀取點。是否把全部 query/mutation（list 清單過濾、所有 get/update/delete、AI 上下文管道）都接上 canAccess？清單過濾已備 `listSharedResourceIdsForUser` helper 待用。
6. **`assets.teamAssets` 既有洩漏**：本 PR 在 OFF 時刻意保留現狀洩漏（零行為變化鐵則）。是否要把「修洩漏」與「開旗標」綁定、或先預設 ON 此單一接點？需 Bruce 決定切換時機。
7. **`digital_asset_library` 缺 teamId**：資產的 team_shared 目前無 team 可綁（靠顯式共享授權）。是否補 teamId 欄讓資產也能走「池」語意。
