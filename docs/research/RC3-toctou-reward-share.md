# RC3 — TOCTOU：獎勵/分享/成員/建立

- 產生日期：2026-07-03
- 依據 commit：812f6fdb
- 稽核範圍：資產 `toggleVisibility` 獎勵、`resource_shares`、`teams` 成員、`creative_projects` 建立/duplicate、任何 check-then-insert

## 方法與既有結論對照

先讀 `docs/research/X12-output-assets-deepdive.md`、`docs/research/X11-rbac-teams-deepdive.md`、`docs/research/RC1-billing-quota-race.md`、`docs/research/RC2-json-field-race.md`，避免重複「新發現」。

已知（prior，依任務指示不重複展開，僅供對照）：`deductUserPoints`/`refundUserPoints` FOR UPDATE 原子 + `atomicClaimJobRefund` CAS（健康）；W1 `jobsJson` 讀改寫無鎖；**X12 `assets.toggleVisibility` 獎勵 TOCTOU 重複發獎（已知，本次逐行覆核現況：仍成立，未修）**；`admin.updateUserQuota` 絕對值 SET 無 CAS；W9 4 worker 只有 process-local boolean 鎖。

本次新掃描範圍內發現：**同一 TOCTOU 獎勵模式在 `models.toggleVisibility`（微調模型分享）幾乎逐行複製**，此前任何文件未點名 `models.ts`，故列「新發現」而非「延伸已知」。另外在 `rbac.share` vs `rbac.transferOwnership` 之間、`webhook.create` 配額計數，各揪出一個未被記錄過的 TOCTOU 窗口。`resource_shares`、`teams` 成員新增、`creative_projects` 建立/更新則覆核後**多數已有 unique 約束或樂觀鎖保護**，列為 negative results。

---

## 發現 1（高／新發現，與 X12 同 cluster 不同檔案）— `models.toggleVisibility` 的分享獎勵是 check-then-act，`configJson.shareRewarded` 旗標與 `refundUserQuota` 之間無鎖/無交易，並發雙擊可重複發獎

**cluster**: toctou
**hasProtection**: 無 — `fineTunedModels` 表沒有 `version`/CAS 欄位；`shareRewarded` 只是 `configJson`（純 JSON）裡的一個 key，讀取與覆寫分屬兩次獨立、不互斥的 `await`。`refundUserQuota` 本身雖是 `FOR UPDATE` 原子（見 `server/db.ts:769-796`），但那只保護「加點」這一步，不保護「本次呼叫是否有資格加點」的判斷。

**競態窗口（行號）**

- `server/routers/models.ts:727`（`const model = await db.getFineTunedModel(input.id)` 讀當前 `visibility`/`configJson`）
- → `:731-733`（`db.updateFineTunedModel(input.id, { visibility: input.visibility })`，第一次無鎖寫入）
- → `:742-743`（`const cfg = (model.configJson ?? {})`；`alreadyRewarded = cfg.shareRewarded === true`　— **注意這裡用的是 `:727` 讀到的舊 `model.configJson`，不是覆寫後重讀**）
- → `:744-751`（`if (model.status === "ready" && !alreadyRewarded) { await db.refundUserQuota(ctx.user.id, 3); await db.updateFineTunedModel(input.id, { configJson: { ...cfg, shareRewarded: true } }); }`，第二次無鎖寫入）
- `db.updateFineTunedModel`（`server/db.ts:1026-1052`）對 `configJson` 是「重讀現有值 merge 後整欄覆寫」，兩次獨立 `UPDATE`，中間無 transaction 包住、無 `SELECT ... FOR UPDATE`。

**交錯後果**

使用者對同一模型（`private → team_shared`，`status="ready"`）連點兩下分享按鈕，或前端因網路重試自動發第二個相同請求：

1. 請求 A、B 幾乎同時進入，各自在 `:727` 讀到 `model.configJson.shareRewarded` 均為 `undefined`（尚未被任何人設過）。
2. 兩者都通過 `:743` 的 `alreadyRewarded` 判斷（皆為 `false`），都執行 `:745` 的 `refundUserQuota(ctx.user.id, 3)`——因為 `refundUserQuota` 本身用 `FOR UPDATE` 鎖 `users` row，這兩次加點都會「各自成功」且互不覆蓋，使用者淨得 **+6 點**而非設計上的 +3。
3. 之後兩者各自把 `shareRewarded: true` 寫回（`:746-751`），最終落地值相同（冪等），**資料庫完全看不出曾經重複發獎**——`configJson.shareRewarded === true` 掩蓋了「已發兩次」的事實，稽核只能靠 `console.log`（非結構化，不落表）事後排查，且此 log 不含請求去重 id。
4. 與 X12（`assets.toggleVisibility`）相同結構、相同根因（讀 stale 布林旗標當 CAS token 用，但沒有真正拿它去做原子 compare-and-set），純粹是換一張表（`fineTunedModels` 換 `digitalAssetLibrary`）、換一個旗標載體（JSON key 換獨立欄位）複製貼上的結果。

**建議**

- 短期：把「判斷是否已發獎」與「發獎+標記」包進單一 DB transaction，並在 `UPDATE ... SET configJson = JSON_SET(configJson, '$.shareRewarded', true) WHERE id=? AND (configJson->>'$.shareRewarded' IS NULL OR configJson->>'$.shareRewarded' != 'true')`，用「受影響列數」當 CAS 判斷（0 列 = 已被搶先發過，不再 `refundUserQuota`）——不依賴 app 層讀到的舊值。
- 中期：`shareRewarded` 這種「一次性布林獎勵」建議提升成獨立欄位（比照 `digitalAssetLibrary.rewardCredits`）並加 `UNIQUE`/CHECK 約束或至少配合 `UPDATE ... WHERE shareRewarded=false` 的 CAS，兩張表（`assets`、`models`）用同一套工具函式收斂，避免第三個資源類型（例如未來的 prompt/material 分享獎勵）重蹈覆轍。

---

## 發現 2（中高／新發現）— `rbac.share` 與 `rbac.transferOwnership` 之間無互斥：擁有權移轉「清光全部共享」的原子保證，可被同時進行中的 `share` 呼叫繞過，留下移轉後才誕生的殘餘共享

**cluster**: toctou
**hasProtection**: 部分 — `transferOwnership` 本身（擁有權改欄位 + 清共享）已用單一 DB transaction 做到內部原子（`transferResourceOwnershipAndWipeShares`，`server/db.ts:4772-4821`，AIDV-186 明確為了避免「兩步非交易、第二步失敗留殘餘」而修的）。但這只保證「這一次呼叫內部」原子，**沒有對「另一個並發的 `share` 呼叫」上鎖**，`requireOwner` 檢查與 `upsertResourceShare` 寫入之間存在真正的 read-then-write 窗口。

**競態窗口（行號）**

- `server/routers/rbac.ts:143-189`（`share` mutation）：`:144` `await requireOwner(...)`（讀當下 owner 是否為 `ctx.user.id`）→ `:159-163` `validateShareTarget`（額外查詢）→ `:165-172` `await db.upsertResourceShare(...)`（寫入）。三個 `await` 之間完全沒有交易包裹、沒有對資源列上鎖。
- `server/routers/rbac.ts:241-301`（`transferOwnership` mutation）：`:258` `await requireOwner(...)` → `:281-285` `await db.transferResourceOwnershipAndWipeShares(...)`（單一 transaction：先 `UPDATE <resource>.userId`，再 `DELETE FROM resource_shares WHERE resourceType=? AND resourceId=?`，`server/db.ts:4779-4820`）。
- `requireOwner`（`server/routers/rbac.ts:57-73`）僅 `db.getResourceOwnerFacts(...)` 讀一次快照，無 `FOR UPDATE`，`getResourceOwnerFacts` 實作（`server/db.ts:4823` 起）是普通 `SELECT`。

**交錯後果**

同一使用者（現任 owner）幾乎同時發出 `share`（例如分享給自己所在的某 team）與 `transferOwnership`（把資源轉給另一 user）兩個請求（雙分頁、或前端「分享後立刻離開團隊觸發自動轉移」之類的組合操作）：

1. `share` 請求在 `:144` 讀到自己仍是 owner → 通過。
2. 在 `share` 走到 `:165` 寫入之前，`transferOwnership` 請求已經跑完 `requireOwner` 檢查並整個 transaction 提交：資源 owner 欄位已改成新 user、`resource_shares` 該資源的所有列已被清空（此時「清空」這個動作**先於** `share` 的 insert 執行完成）。
3. `share` 請求繼續執行 `:165-172` 的 `upsertResourceShare`，在新 owner 完全不知情、且已經被「洗過一次」的 `resource_shares` 表裡，重新插入一筆新的共享列——`sharedByUserId` 記的是**已經不是 owner 的舊使用者**，而這筆列不會再被任何後續動作清掉（清理只在 transfer 那一刻跑一次）。
4. 結果：AIDV-186 想達成的「移轉後舊 owner 不留任何殘餘存取」保證被繞過——旧 owner 可以在提交轉移的同時／之後幾毫秒內，用一個競速的 `share` 呼叫，讓自己（或自己選的第三方 team/user）繼續保有該資源的顯式存取權，且這筆授權在稽核記錄上看起來像是「轉移前就存在、只是沒被清乾淨」，難以與正常時序區分。
5. 前提條件：需要攻擊者能在極短視窗內打出兩個並發請求（同一 owner 帳號），屬於「自己對自己資源」的操作，但後果是讓 RBAC 移轉的安全保證失效，且新 owner 對此殘餘共享毫無感知（`listShares` 會顯示出它，但一般使用者不會主動去查）。

**建議**

- 短期：把 `share`／`revokeShare` 也改成單一 transaction，並在 transaction 內用 `SELECT ... FOR UPDATE` 鎖住該資源列（與 `transferOwnership` 用同一把鎖：例如對資源表本列 `FOR UPDATE`），確保「檢查 owner」與「寫入/刪除 resource_shares」對同一資源不會與 `transferOwnership` 交錯。
- 中期：`upsertResourceShare` 寫入前，改成 `INSERT ... SELECT` 型式帶上 `WHERE EXISTS (SELECT 1 FROM <resource_table> WHERE id=? AND userId=?)` 的條件式寫入（把「owner 身份」的驗證下推進同一條 SQL 語句原子完成），而不是「app 層讀一次、隔幾個 await 後再寫」。

---

## 發現 3（中／新發現，範圍延伸：任何 check-then-insert）— `webhook.create` 的「配額上限」是 count-then-insert，無 DB 層唯一約束/CHECK 兜底，並發建立可超過 `MAX_WEBHOOKS_PER_USER`

**cluster**: toctou（配額繞過變種，非本次任務指定的「獎勵/分享/成員/建立」四類，但符合「任何 check-then-insert」掃描項）
**hasProtection**: 無 — `webhookSubscriptions` 沒有「每使用者筆數」的 DB 約束（不像 `team_memberships` 有 `tm_teamId_userId_uk` 可兜底），純靠 app 層計數。

**競態窗口（行號）**

- `server/routers/webhook.ts:70-73`（`const existing = await db.select(...).from(webhookSubscriptions).where(eq(userId, ctx.user.id))`）
- → `:75-80`（`if (existing.length >= MAX_WEBHOOKS_PER_USER) throw BAD_REQUEST`，`MAX_WEBHOOKS_PER_USER = 5`，`:20`）
- → `:84-90`（`await db.insert(webhookSubscriptions).values({ userId, url, events, secret, active: true })`，插入前未再次確認計數）

**交錯後果**

使用者已有 4 筆 webhook，短時間內併發打 3 個 `create` 請求：三個請求都在各自的 `:70` 讀到「目前 4 筆 < 5」，都通過 `:75` 檢查，都各自插入一筆——最終落地 7 筆，超過設計上限 `MAX_WEBHOOKS_PER_USER=5`。影響：webhook 訂閱數上限形同虛設（可被輕易繞過），下游若有「按訂閱數計費」或「每筆 dispatch 併發送出」的假設，會被無上限放大（`server/services/webhookDispatcher.ts` 對外送出的請求數與訂閱數成正比，可作為 SSRF/資源耗盡放大器，配合既有的 `assertSafeExternalUrlAsync` SSRF 檢查一起看，是「配額 TOCTOU + 出站放大」的組合風險，雖然單一風險等級不算最高）。

**建議**

- 短期：把 `:70-90` 包進單一 transaction，並在 transaction 內對該 `userId` 的計數查詢加 `FOR UPDATE`（或用 `SELECT COUNT(*) ... FOR UPDATE` 鎖住相關列的等效手法——MySQL 對純 `COUNT` 沒有列可鎖時可改鎖 `users` 該列做序列化點）。
- 中期：更乾淨的做法是原子 `INSERT ... SELECT ... WHERE (SELECT COUNT(*) FROM webhook_subscriptions WHERE userId=?) < 5`，一條 SQL 完成「檢查+寫入」，不留 TOCTOU 窗口。

---

## Negative Results（已正確保護，覆核後現況良好）

1. **`resource_shares` upsert（`rbac.share` 對同一 `(resourceType, resourceId, sharedWithType, sharedWithId)` 的重複呼叫）**
   - `drizzle/0078_resource_shares.sql:56` 建立 `rs_resource_target_uk` UNIQUE INDEX；`drizzle/schema.ts:4458-4463` 對應宣告。
   - `server/db.ts:4668-4679`（`upsertResourceShare`）用 `db.insert(resourceShares).values(data).onDuplicateKeyUpdate(...)`，並發重複 share 只會 upsert 成同一份 role，不會產生重複列、不會拋錯。**cluster: toctou，hasProtection: 有（唯一約束 + ON DUPLICATE KEY UPDATE）**。

2. **`teams.addMember` 的重複邀請 race**
   - `server/routers/teams.ts:120-127` 是 check-then-insert（`getTeamMembership` 讀 → `addTeamMember` 寫，`:139-144`），app 層有查重，但兩個 await 之間本身無鎖。
   - 不過 `drizzle/schema.ts:4186-4189`（`tm_teamId_userId_uk` UNIQUE INDEX，程式註解明寫「DB 這層 UNIQUE 用來防 race condition」）在 DB 層兜底：即使 app 層查重失手，第二筆 `INSERT` 會因唯一鍵衝突被 DB 拒絕，**不會產生重複成員列**，資料完整性有保障。**cluster: toctou，hasProtection: 有（唯一約束）**。
   - 唯一殘留的小缺口（未達列入高風險門檻，僅供留意）：`server/db.ts:4396-4403`（`addTeamMember`）與 `teams.ts:139-144` 呼叫端都沒有 `try/catch` 攔截 `ER_DUP_ENTRY`，若真的競速觸發唯一鍵衝突，使用者會看到未分類的 `INTERNAL_SERVER_ERROR`（500）而非乾淨的 `CONFLICT`（409，如 `addMember:122-126` 已為「非併發」情境準備的訊息）。**建議（低優先）**：在 `addTeamMember` 外包一層 try/catch，把 DB 唯一鍵衝突轉譯成與 `:122-126` 一致的 `TRPCError({code:"CONFLICT"})`，改善併發下的錯誤體驗，不影響資料正確性本身。

3. **`creativeProject.update` 的併發覆寫**
   - `server/routers/creativeProject.ts:212-262`：`updateInputSchema` 帶 `expectedVersion`（`:48-50`），`db.updateCreativeProject(id, patch, { expectedVersion })` 做 `WHERE id=? AND version=?` 的原子 CAS（AIDV-316），版本不符回 `CONFLICT`（`:245-251`）。**cluster: lost-update，hasProtection: 有（樂觀鎖 version CAS）**，與 RC2 對 `worldStoryboards`／`worldbuildingFrameworks`（無此保護）形成對照。

4. **`creativeProject.create`／`duplicate`**
   - `create`（`:170-209`）純新插入、`duplicate`（`:293-326`）先讀來源列（`:296`）再插入新列（`:300-315`），皆無「同名/同來源唯一」語意（`creativeProjects` 表無此類 UNIQUE 約束，也不需要——標題允許重複本屬設計行為，非 bug）。兩者都不是「先查有沒有、沒有才建立」的 TOCTOU 模式，並發重複呼叫最壞情況只是「多建立幾筆使用者自己觸發的專案/副本」，不構成越權或配額繞過。**cluster: n/a（非 check-then-insert 語意），hasProtection: n/a**。

5. **`rbac.transferOwnership` 內部原子性**
   - `server/db.ts:4772-4821`（`transferResourceOwnershipAndWipeShares`）：owner 欄位更新 + `resource_shares` 清空包在同一 transaction 內，`server/routers/rbac.ts:276-280` 註解明確記錄 AIDV-186 修過「兩步非交易、第二步失敗留殘餘」的舊 bug。**此函式自身内部無 TOCTOU**；本文件發現 2 指出的問題是「與外部並發的 `share` 呼叫」互動時的窗口，並非此函式自身退步。

---

## 排序摘要（依嚴重度）

| # | 發現 | cluster | hasProtection | 嚴重度 |
|---|------|---------|----------------|--------|
| 1 | `models.toggleVisibility` 分享獎勵 TOCTOU（新發現，同 X12 模式） | toctou | 無 | 高 |
| 2 | `rbac.share` vs `transferOwnership` 殘餘共享 race | toctou | 部分（transfer 自身原子，跨呼叫無鎖） | 中高 |
| 3 | `webhook.create` 配額 count-then-insert 繞過 | toctou | 無 | 中 |
| — | （現況確認）`assets.toggleVisibility` 獎勵 TOCTOU（X12 已知，未修） | toctou | 無 | 高（不重複計分，僅現況確認） |
| N1 | `resource_shares` upsert | toctou | 有（唯一約束+upsert） | negative |
| N2 | `teams.addMember` 重複成員 | toctou | 有（唯一約束）；錯誤處理有小缺口 | negative（低優先建議） |
| N3 | `creativeProject.update` | lost-update | 有（version CAS） | negative |
| N4 | `creativeProject.create`/`duplicate` | n/a | n/a | negative |
| N5 | `transferOwnership` 內部 | toctou | 有（單一 transaction） | negative |
