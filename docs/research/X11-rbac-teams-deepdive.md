# X11 — RBAC enforcement + 團隊(rbac + teams)逐行深挖(地毯掃描 wave X)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/routers/rbac.ts(302)、server/routers/teams.ts(275)

## 0. 稽核方法與範圍

逐行讀完 `server/routers/rbac.ts`(302 行)、`server/routers/teams.ts`(275 行)後,對「V3 指出角色授權形同虛設」這個假設做對抗式追查,範圍延伸到:

- `server/services/authz/resourceAccess.ts`、`resourceAccessResolver.ts`(rbac 的授權純函式與 DB 橋接層)
- `server/db.ts` 內 `resource_shares` / `teams` / `teamMemberships` 相關的全部 helper(逐一開到實作)
- 四種資源型別實際「消費」`resource_shares` 的 router:`assets.ts`、`creativeProject.ts`、`promptLibrary.ts`、`teachingArchive.ts`(+`teachingArchiveAccess.ts`)
- 全庫 grep 交叉比對:`canAccessResource`/`canAccess(` 在 server 端所有呼叫點、`ENABLE_DATA_RBAC` 在 `.env.production`/`.env.example`/`railway.toml`/`env.validated.ts` 的實際值、`client/src` 對 `rbacRouter`/`teamsRouter` 各 procedure 的實際呼叫點
- 交叉參照既有稽核文件 `docs/research/K1-security-bugs.md`(K1-3)、`K4-deadcode-contracts.md` 作為外部佐證,但下述每一條都已對照本次 commit 的實際程式碼重新驗證,不是照抄舊文件。

一切結論以下方附行號的程式碼片段為準;凡未能在檔案中直接驗證的說法一律標「未在本檔驗證」。

## 1. 總覽結論

V3 對 `agentScopeGuard` 的「角色檢查回傳結果、但沒接線去真正擋動作」的模式,在 `rbac.ts` + 四個資源 router 之間**確實原封不動地複現,而且範圍更大**:

- 資料層 RBAC 的核心純函式 `canAccess()` 明確定義 owner/editor/viewer 三級權限(`editor` 可 view+edit,`viewer` 只能 view),但**全站搜尋後,呼叫 `canAccess`/`canAccessResource` 的地方只有 3 處,而且全部是 `"view"` action**——沒有任何一個 `update`/`delete`/`toggleVisibility` 等 mutation 呼叫它。也就是說,即使旗標 `ENABLE_DATA_RBAC` 打開,透過 `rbac.share` 授予的 `editor` 角色也完全無法讓對象真的編輯或刪除資源(見 C1)。
- 對 `material`(教材庫)這個資源型別,`rbac.share` 更是連「讀」都沒有效果——`teachingArchive.ts` 的存取控制(`teachingArchiveAccess.ts`)完全不查 `resource_shares` 表,只認 owner / team_shared+teamId 成員(見 C2)。
- `assets.teamAssets` 目前(旗標關閉的**出廠預設狀態**)就是一個跨租戶(cross-tenant)資料外洩——因為 `digital_asset_library` 表根本沒有 `teamId` 欄位,`visibility='team_shared'` 等於「分享給全站任何登入使用者」,程式碼自己的註解也承認這點(見 C3)。
- `teams.ts` 的角色矩陣本身也有一個沒被 `updateMemberRole` 的「只有 owner 能升級角色」規則覆蓋到的漏洞:`addMember` 讓任何 `admin` 都能直接把新邀請的成員設成 `admin`,等於繞過了 owner 專屬的角色授予邊界,而且這條路徑已經接了前端 UI,是可實際觸發的(見 H1)。

以下依嚴重度列出。

---

## 2. 發現(按嚴重度)

### 🔴 CRITICAL

#### C1 — 全站沒有任何寫入(edit/delete)動作呼叫 canAccess/canAccessResource;「editor」共享角色對寫入永遠無效

**發現**

`server/services/authz/resourceAccess.ts:113-134` 明確定義了角色矩陣:

```ts
// resourceAccess.ts:123-134
export function roleCan(role: EffectiveRole, action: AccessAction): boolean {
  switch (action) {
    case "view":
      return role === "owner" || role === "editor" || role === "viewer";
    case "edit":
      return role === "owner" || role === "editor";
    case "delete":
      return role === "owner";
    ...
```

但對全 server 目錄搜尋 `canAccessResource(`/`canAccess(` 的呼叫點,結果只有三處,而且第三個參數(action)全部是 `"view"`:

- `server/routers/creativeProject.ts:121-134`(`get` query,`action:"view"`)
- `server/routers/promptLibrary.ts:198-214`(`getById` query,`action:"view"`)
- `server/routers/assets.ts:140-159`(`teamAssets` query,`action:"view"`,第 156 行字面量 `"view"`)

而這三個資源型別各自的寫入端點,全部只用「是不是 owner」這個獨立、與 `resource_shares`/旗標無關的判斷,完全不理會 `rbac.share` 建立的 `editor` 授權:

- `assets.ts:209-213`(`update`)、`assets.ts:232-250`(`toggleVisibility`)、`assets.ts:284-301`(`delete`):均只判斷 `asset.userId !== ctx.user.id` → `NOT_FOUND`。
- `creativeProject.ts:214-218`(`update`)、`creativeProject.ts:268-271`(`delete`)、`creativeProject.ts:296-299`(`duplicate`)、`creativeProject.ts:346-350`(`link`):均只判斷 `existing.userId !== ctx.user.id` → `NOT_FOUND`。
- `promptLibrary.ts:252-258`(`update`)、`promptLibrary.ts:275-281`(`delete`)、`promptLibrary.ts:312-318`(`toggleFavorite`):SQL WHERE 直接寫死 `eq(promptLibrary.userId, ctx.user.id)`。

`rbac.ts:129-189` 的 `share` procedure 文件與程式碼都清楚聲明「授 viewer/editor 角色」,但這個 `role` 欄位除了寫進 `resource_shares` 表、被 3 個 view 端點讀取以外,在整個 codebase 沒有任何寫入路徑會去查它。

**影響**

owner 透過 `rbac.share` 把 project/asset/prompt 授予某人 `editor` 角色,無論 `ENABLE_DATA_RBAC` 開或關,對方永遠**不能編輯、不能刪除**該資源——UI 若日後接上「共享給某人並讓他協作編輯」的功能,會直接不可用,而且不會報錯,只會安靜地一路 `NOT_FOUND`。這正是 V3 描述的「角色檢查形同虛設」模式:角色資料模型與稽核鏈都做好了,但沒有一個地方真的拿它來擋(或放行)寫入動作。

**建議**

在 `assets.update`/`toggleVisibility`(delete 除外,因為 `roleCan("delete")` 本就只允許 owner)、`creativeProject.update`/`link`、`promptLibrary.update`/`toggleFavorite` 的擁有權檢查失敗分支,補上 `isDataRbacEnabled() && canAccessResource(..., "edit")` 的 fallback(比照 `creativeProject.get` 現有的 view fallback 寫法),否則應在文件裡明確宣告「editor 角色目前僅影響 view,不影響 edit/delete」,避免產品端誤用。

---

#### C2 — teachingArchive(material)完全不查 resource_shares;rbac.share 對教材資源讀寫兩端皆 100% 無效

**發現**

`server/routers/teachingArchive.ts` 全檔案沒有 import `canAccessResource` 或 `isDataRbacEnabled`(grep 只命中 `deleteAllSharesForResource` 這個刪除時的孤兒清理呼叫,`teachingArchive.ts:372-378`)。它的讀寫授權完全交給 `server/services/teachingArchiveAccess.ts`:

```ts
// teachingArchiveAccess.ts:43-81 loadMaterialForRead
// Owner — 永遠可讀
if (material.userId === ctx.userId) { ... }
// public_disciples — 全 workspace
if (material.visibility === "public_disciples") { ... }
// team_shared — 需要驗 membership
if (material.visibility === "team_shared" && material.teamId !== null) {
  const membership = await db.getTeamMembership(material.teamId, ctx.userId);
  if (membership) { ... }
}
throw new TRPCError({ code: "FORBIDDEN", ... });
```

`loadMaterialForWrite`(同檔 87-137 行)邏輯同構,一樣只看 owner / team_shared+teamId membership / public_disciples+owner-or-admin。兩個函式都**沒有任何一行**呼叫 `db.getSharesForUserOnResource`、`listSharedResourceIdsForUser` 或 `canAccess`。

**影響**

`rbac.ts` 的 `share`/`revokeShare`/`transferOwnership`(移除舊 share)三個 mutation 對 `resourceType: "material"` 完全可以正常呼叫、正常寫入 `resource_shares`、正常留稽核紀錄(`rbac.ts:174-186` 等),**但這筆共享記錄從頭到尾不會被 `teachingArchive.get`/`update`/`delete`/`list` 的任何一條讀取路徑查詢**。owner 把一份教材「顯式共享」給某個不在同一 team 的使用者,對方呼叫 `teachingArchive.get` 依然拿到 `FORBIDDEN`(`teachingArchiveAccess.ts:77-80`)。這是本次稽核中最直接的「角色授權形同虛設」實例——不是「檢查了但沒擋」,而是「寫進去的授權資料整條讀取鏈都不認得」。

**建議**

`teachingArchiveAccess.loadMaterialForRead`/`loadMaterialForWrite` 需要補上 `resource_shares` 查詢分支(比照 `promptLibrary.getById` 目前對 `prompt` 型別的做法),或者在 `rbac.share` 的 `resourceType` schema(`rbac.ts:50`)註解明確排除 `material`,避免 owner 誤以為「共享」對教材同樣有效。

---

#### C3 — assets.teamAssets 現行預設狀態(旗標 OFF)即為跨租戶洩漏;旗標打開後對 asset 型別的「修復」因 schema 缺 teamId 而結構性失效

**發現**

1. `server/db.ts:1493-1504`(`getTeamSharedAssetsFiltered`)只用 `eq(digitalAssetLibrary.visibility, "team_shared")` 過濾,**沒有任何 teamId 條件**。回頭看 `drizzle/schema.ts:331-380`(`digitalAssetLibrary` 表定義),欄位裡確實**沒有 `teamId`**;`drizzle/schema.ts:4412-4417` 的 `resource_shares` 表註解自己承認這件事:

   ```
   // 不在每張資源表硬塞 teamId/sharedWith 欄位(那會碰到 digital_asset_library
   // 的 team_shared 孤兒 enum、creative_projects 完全沒共享欄等不一致)...
   ```

2. `ENABLE_DATA_RBAC` 的預設值在 `server/_core/env.validated.ts:603` 是 `.default("false")`;檢查 `.env.production`、`.env.example`、`railway.toml`,均**沒有覆寫這個變數**,代表這是目前線上實際生效的預設狀態(OFF)。

3. `assets.ts:132-140` 的註解自己承認這是已知洩漏:

   ```ts
   // 旗標 OFF(預設)= 完全保持現狀:回(SQL 過濾後的)team_shared 資產(既有
   //   行為,含已知 cross-tenant 洩漏;本 PR 刻意不在 OFF 時改它)。
   if (isDataRbacEnabled()) { ... }
   ```

   即旗標關閉時,任何登入使用者呼叫 `assets.teamAssets` 會拿到**全站**所有被標記 `team_shared` 的資產(`assets.ts:127-131` 的 `result` 未經任何過濾直接回傳),不限本人所屬團隊——因為資產表根本沒有團隊概念可過濾。任何使用者只要對自己的資產呼叫 `assets.toggleVisibility({visibility:"team_shared"})`(`assets.ts:225-282`),就等於把它公開給工作區全體使用者,而不是「我的團隊」。

4. 即使把旗標打開,`canAccess` 的 team_shared 池邏輯(`resourceAccess.ts:100-107`)要求 `resource.teamId != null`,但 `getResourceOwnerFacts` 對 `asset` 型別(`db.ts` 內 `getResourceOwnerFacts` 的 `"asset"` case)回傳的 `teamId` **永遠是 `null`**——所以旗標打開後,team_shared 池成員規則對 asset 型別永遠不會命中,只剩「有明確 `resource_shares` 記錄」才看得到。這代表「打開旗標」對 asset 而言不是把外洩範圍收斂到「同團隊」,而是把整個 `team_shared` 可見性功能靜默改成「幾乎沒人看得到,除非被明確 share」——是一次語意被動置換,而非設計中的修復。

**影響**

這不是「等旗標打開才會出現」的假設性風險,而是**當下(旗標關閉的出廠預設)就在生效**的跨用戶資料外洩:任何一位使用者只要把資產切成 team_shared,全站任何其他登入者都能透過 `teamAssets` 看到,無關是否同隊。此結論與既有稽核文件 `docs/research/K1-security-bugs.md`(K1-3 🔴 CONFIRMED)一致,本次獨立重新核對現行 commit 程式碼與 schema 後確認仍然成立、未被修補。

**建議**

- 短期:`getTeamSharedAssetsFiltered` 至少應該無條件(不掛 `ENABLE_DATA_RBAC`)先把可見範圍收斂到「呼叫者自己的團隊」,而不是全站——這是資料外洩,不該用一個預設關閉、且與 asset 型別邏輯不相容的旗標去擋。
- 中期:若要讓 `canAccess` 的 team_shared 池邏輯對 asset 型別真正生效,需要先幫 `digital_asset_library` 補上 `teamId` 欄位(對齊 `teaching_materials`/`resource_shares` 的模型),否則旗標打開後這條規則永遠是死碼。

---

### 🟠 HIGH

#### H1 — teams.addMember 讓任一 admin 可直接冊封新 admin,繞過 updateMemberRole「只有 owner 能升級角色」的邊界(已接前端,可實際觸發)

**發現**

`teams.ts:100-146`(`addMember`)的角色門檻只要求 `admin` 以上:

```ts
// teams.ts:105, 108-110
role: z.enum(["admin", "member"]).default("member"),
...
const me = await getRequireMembership(input.teamId, ctx.user.id);
requireRole(me.role, "admin");   // admin 或 owner 皆可通過
```

呼叫者只要 rank ≥ admin(`requireRole`,`teams.ts:35-46`,`rank = {owner:3, admin:2, member:1}`),就能對一個**全新邀請**的 userId 直接指定 `role:"admin"`,不需要 owner 介入。

相對地,`updateMemberRole`(`teams.ts:229-261`)對**既有成員**的角色升降做了嚴格得多的限制:

```ts
// teams.ts:238-239
const me = await getRequireMembership(input.teamId, ctx.user.id);
requireRole(me.role, "owner");   // 只有 owner 能通過
```

兩者對「讓某人變成 admin」這件事的授權邊界並不一致:對既有成員晉升 admin,系統認定是 owner 專屬的高風險動作;但對「邀請新成員時直接給 admin」,任何 admin 都能做,效果完全相同(該 user 最終都拿到 admin rank)。

此路徑已接前端、可實際觸發:`client/src/pages/TeamsPage.tsx:307-329`:

```tsx
const [addRole, setAddRole] = useState<"admin" | "member">("member");
...
const canManage = myRole === "owner" || myRole === "admin";
...
await addMut.mutateAsync({ teamId, userId: uid, role: addRole });
```

UI 的 `canManage` 用的正是 owner-or-admin,而 role 選單允許選 `"admin"`——即任何現任 admin 都能透過既有頁面把新邀請對象直接設為 admin。

**影響**

一個非 owner 的 admin 可以單方面「複製」出等權限的 peer admin(例如邀請自己控制的第二個帳號、或串通的同夥,直接以 admin 身分加入),而不需要 owner 任何同意或知情——實質上架空了 `updateMemberRole` 想保護的「只有 owner 能授予 admin」不變式。若該 admin 帳號被盜或惡意行動,攻擊者能藉此在團隊裡快速擴大立足點(新 admin 可再邀請/移除其他 member,見 `teams.ts` 開頭角色矩陣註解)。

**建議**

`addMember` 若 `input.role === "admin"`,應追加 `requireRole(me.role, "owner")`(只有 owner 能直接邀入 admin;admin 只能邀入 `member`),使「誰能讓別人變成 admin」這件事在 add 與 update 兩條路徑上一致。

---

### 🟡 MEDIUM

#### M1 — rbac.transferOwnership 的擁有權驗證與實際 UPDATE 之間沒有 compare-and-swap,存在競態覆寫風險

**發現**

`rbac.ts:249-285`(`transferOwnership`)流程是:先做一次獨立的 `SELECT`(`requireOwner`,`rbac.ts:258` → `db.getResourceOwnerFacts`),確認 `ctx.user.id === facts.ownerId`,再呼叫 `db.transferResourceOwnershipAndWipeShares`(`rbac.ts:281-285`)。

但 `transferResourceOwnershipAndWipeShares` 內部(`db.ts:4772-4820`)四個資源型別分支的 `UPDATE` 語句**都沒有把「目前 owner 是誰」放進 WHERE 條件**,例如 project 分支:

```ts
// db.ts:4782-4787
case "project":
  await tx
    .update(creativeProjects)
    .set({ userId: newOwnerUserId })
    .where(eq(creativeProjects.id, resourceId));   // 沒有 AND userId = oldOwnerId
  break;
```

對照同一檔案裡 `transferTeamOwnership`(`db.ts:4485-4519`)處理團隊擁有權移轉時,反而**有**這個 compare-and-swap 條件:

```ts
// db.ts:4493-4497
await tx
  .update(teams)
  .set({ ownerId: newOwnerId })
  .where(and(eq(teams.id, teamId), eq(teams.ownerId, oldOwnerId)));
```

**影響**

若同一資源在極短時間內出現兩個(在各自檢查當下都合法)的 `transferOwnership` 呼叫(例如使用者雙擊送出、前端重試、或多分頁同時操作),第二個呼叫的 `requireOwner` 檢查可能仍讀到「舊 owner」(因為它是獨立的 SELECT,發生在第一個交易提交之前或之間),但真正落地寫入時,第一個交易可能已經把 owner 改成別人了——第二個 UPDATE 因為沒有 owner 條件,依然會盲目成功,把 owner 覆寫成第二次呼叫指定的對象,且**不會噴任何錯誤讓呼叫端知道自己覆寫了別人剛完成的移轉**。程式碼註解(`db.ts:4759-4770`)聲稱的「原子化」只涵蓋「移轉+清共享包進同一交易」,並未涵蓋「與其他併發移轉的互斥」。

**建議**

`transferResourceOwnershipAndWipeShares` 的四個 `UPDATE` 都應加上 `AND ownerId/userId = oldOwnerUserId`(需要新增一個 `oldOwnerUserId` 參數),並在受影響列數為 0 時對外拋 `CONFLICT`,比照 `transferTeamOwnership` 的寫法,徹底堵住併發覆寫視窗。

---

#### M2 — teams.ts 全數 8 個 procedure 均無 recordAuditEvent;團隊治理動作零稽核軌跡

**發現**

`server/routers/teams.ts` 整個檔案沒有 import 或呼叫 `recordAuditEvent`(對照 `rbac.ts:44-47` import 並在 `share`/`revokeShare`/`transferOwnership` 三處都呼叫,`rbac.ts:174-186`、`211-222`、`287-298`)。`teams.ts` 裡涉及授權邊界變更的動作——`addMember`(`100-146`)、`removeMember`(`149-180`)、`transferOwnership`(`198-226`)、`updateMemberRole`(`229-261`)、`delete`(`265-272`)——全部只回傳 `{ ok: true }`,沒有留下任何「誰、何時、對誰做了什麼」的稽核紀錄。

**影響**

若 H1 描述的「admin 冊封新 admin」被濫用,或有人移除合法成員、竊佔團隊擁有權,事後完全無法從稽核紀錄追溯——`rbac.ts` 對「資料層」的共享/移轉都留痕,但「團隊本身」這個更基礎的授權邊界(誰是 admin/owner)反而沒有對應的稽核鏈,形成明顯的不對稱。

**建議**

在 `addMember`/`removeMember`/`transferOwnership`/`updateMemberRole`/`delete` 補上 `recordAuditEvent`(action 建議:`team.addMember`/`team.removeMember`/`team.transferOwnership`/`team.updateMemberRole`/`team.delete`),沿用 `rbac.ts` 已有的 `extractRequestSource(ctx.req)` 模式。

---

#### M3(northstar)— transferOwnership / updateMemberRole 後端已完工且測試齊全,但前端零呼叫;owner 目前無法離隊、admin 無法升級

**發現**

`teams.transferOwnership`(`teams.ts:198-226`)與 `teams.updateMemberRole`(`teams.ts:229-261`)邏輯完整、與 `create`/`addMember` 等一樣做了完整的邊界檢查。但對 `client/src` 全目錄搜尋 `trpc.teams.transferOwnership`/`trpc.teams.updateMemberRole`,**沒有任何呼叫點**(同一次搜尋確認 `trpc.teams.create/list/get/members/addMember/removeMember/leave/delete` 都有 UI 接線,唯獨這兩個沒有)。

同時,`teams.leave`(`teams.ts:183-195`)明確禁止 owner 離隊(`"團隊 owner 不可直接離開,請先解散或轉移擁有權"`),但轉移擁有權的 UI 不存在——也就是說,**目前產品上一個團隊的 owner 事實上永久卡在該團隊裡**,唯一出路是 `delete`(整團解散)。

**影響**

這不是安全漏洞,而是能力缺口:teams 的角色矩陣設計(owner 可移轉、admin 可被升級)在後端完整落地,但因為前端沒接線而在產品上不可用,owner 離職/交接情境目前只能靠工程手動改資料庫解決。

**建議**

補上 `TeamsPage.tsx` 對 `updateMemberRole`(把 member 升 admin 的操作按鈕)與 `transferOwnership`(移轉擁有權對話框)的接線,對齊既有規劃文件(`docs/research/00-summary.md:77`)已經記錄的「teams 治理收尾」待辦。

---

## 3. 已驗證排除的疑慮(Negative Results)

以下是本次深挖過程中主動假設、但實際讀碼後確認**不成立**或**已有妥善防護**的項目,列出以避免報告只呈現壞消息:

1. **rbac.ts 自身的 owner 守門是紮實的。** `requireOwner`(`rbac.ts:57-73`)在 `share`/`revokeShare`/`transferOwnership`/`listShares` 四個 procedure 都被正確呼叫;非 owner → `FORBIDDEN`、資源不存在 → `NOT_FOUND`,且有完整的 `rbac.test.ts`(107-320 行)以 mock DB 驗證每個分支,包含「分享給自己」「分享給不存在的 user/team」「分享給無關係的 team」等邊界情境,均正確擋下。

2. **rbac.share 對 team 共享目標有防「幽靈授權」機制。** `validateShareTarget`(`rbac.ts:83-113`)要求目標 team 必須存在,且分享者必須是該 team 的成員或 owner,才允許把資源共享給整個團隊——不會發生「把私有資源塞進毫無關係的團隊,讓該團隊全員意外拿到存取權」的情況。

3. **teams.ts 沒有跨團隊 IDOR。** `addMember`/`removeMember`/`leave`/`transferOwnership`/`updateMemberRole`/`delete` 全部都先呼叫 `getRequireMembership(input.teamId, ctx.user.id)`(`teams.ts:24-33`),嚴格把呼叫者限定在其指定的那個 `teamId` 範圍內;沒有任何路徑可以讓使用者操作自己不屬於的團隊。

4. **removeMember 的「admin 互踢」防護正確。** `teams.ts:170-176` 正確擋下「admin 移除另一個 admin」(除非操作者是 owner),邏輯與 `requireRole` 的 rank 設計一致,未發現繞過方式。

5. **addMember 的「phantom membership」防護確實落地。** `teams.ts:129-137` 的註解(「DB 沒掛 FK 約束,應用層必須先確認 userId 真的存在」)與實作一致——邀請一個不存在的 userId 會被 `getUsersByIds` 檢查擋下,回 `NOT_FOUND`,不會產生指向不存在使用者的孤兒 membership 列。

6. **deleteTeam 的資料清理是原子化的,已對照 AIDV-186 修過的模式。** `db.ts:4347-4360` 用單一 transaction 依序處理「教材退回個人池」→「刪除全部 membership」→「刪除 team 列」,不會因為中途失敗留下部分狀態。至於團隊刪除後,`resource_shares` 表中 `sharedWithType='team'` 指向該已刪除 teamId 的孤兒列會不會造成安全風險——**已驗證不會**,因為(a)MySQL AUTO_INCREMENT 的 id 不會被回收重用,(b)`listTeamIdsForUser` 只會回傳呼叫者「目前仍有效」的 membership,而該團隊的 membership 已在同一交易中被刪光,因此永遠不會有任何在世使用者的 `memberTeamIds` 命中這個孤兒 teamId。這條路徑是死資料,但不是可被利用的漏洞。

7. **rbac.transferOwnership 的「移轉+清共享」原子性(AIDV-186)本身沒有問題**——`db.ts:4772-4820` 確實把兩步包進同一個 `db.transaction`,不會出現「擁有權轉走但共享沒清乾淨」的部分失敗狀態;M1 描述的競態問題是另一個維度(併發下的 compare-and-swap 缺失),與 AIDV-186 想解決的「單次呼叫內的原子性」並不衝突,兩者互不影響對方的正確性。

---

## 4. 附錄:關鍵呼叫鏈證據索引

| 主張 | 佐證位置 |
|---|---|
| 全站僅 3 處呼叫 `canAccess(Resource)`,皆為 `"view"` | `creativeProject.ts:121-134`、`promptLibrary.ts:198-214`、`assets.ts:140-159` |
| 四種資源型別的 update/delete 只查 ownerId,不查 `resource_shares` | `assets.ts:209-213,232-250,284-301`、`creativeProject.ts:214-218,268-271,296-299,346-350`、`promptLibrary.ts:252-258,275-281,312-318` |
| `teachingArchive.ts` 不 import `canAccessResource`/`isDataRbacEnabled` | 對該檔案 grep 僅命中 `deleteAllSharesForResource`(372-378 行的孤兒清理) |
| `teachingArchiveAccess.ts` 讀寫皆不查 `resource_shares` | `teachingArchiveAccess.ts:43-137` |
| `digital_asset_library` 無 `teamId` 欄位 | `drizzle/schema.ts:331-380`(欄位列表)、`drizzle/schema.ts:4415-4416`(註解自承「孤兒 enum」) |
| `ENABLE_DATA_RBAC` 預設 false 且生產環境未覆寫 | `server/_core/env.validated.ts:603`;`.env.production`/`.env.example`/`railway.toml` 皆無此鍵 |
| `assets.teamAssets` 旗標 OFF 時回全站資料,程式碼自承已知洩漏 | `assets.ts:132-140` |
| `addMember` 可直接邀入 `role:"admin"`,只需 admin 門檻 | `teams.ts:100-110`(schema 105、`requireRole` 110) |
| `updateMemberRole` 升級角色僅限 owner | `teams.ts:229-239` |
| 前端可直接以 `addRole:"admin"` 邀請新成員 | `client/src/pages/TeamsPage.tsx:307,319,329` |
| `transferResourceOwnershipAndWipeShares` 的 UPDATE 缺 owner 條件 | `db.ts:4772-4820`(對照有條件的 `transferTeamOwnership`,`db.ts:4485-4519`) |
| `teams.ts` 全檔無 `recordAuditEvent` | 對 `teams.ts` grep 無命中;對照 `rbac.ts:174-186,211-222,287-298` |
| `transferOwnership`/`updateMemberRole` 前端零呼叫 | 對 `client/src` grep `trpc.teams.transferOwnership`/`trpc.teams.updateMemberRole` 無命中,其餘 procedure 均有命中(`TeamsPage.tsx` 等) |

（本報告不含任何真實密鑰值;涉及 `.env.production`/`railway.toml` 僅描述變數是否存在/其預設值機制,未貼出檔案原始內容。）
