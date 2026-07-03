# X1 — 專案主幹(creativeProject + worldStoryboard)逐行深挖(地毯掃描 wave X)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/routers/creativeProject.ts、server/routers/worldStoryboard.ts

> 方法論:兩個檔案逐行讀完後,追蹤所有跨檔依賴(`server/db.ts`、`shared/video-state-machines.ts`、
> `shared/worldbuilding-animation.ts`、`server/services/authz/*`、`server/subsystems/projectContext/*`、
> `server/subsystems/contextPackets/adapters/*`、`server/routers/director.ts`),並比對 client 端
> (`client/src/contexts/WorldContextContext.tsx`、`ProjectsContext.tsx`、`client/src/spine/projectGateway.ts`)
> 的實際使用方式,確認每個「發現」在真實呼叫鏈上是否可達。所有行號皆為 commit 812f6fdb 當下版本。

---

## 摘要

`creativeProjects` 表刻意不對 `directorSessionId` / `worldFrameworkId` / `worldStoryboardId` 建 FK
(schema 註解:「References（刻意不用 FK，方便重新綁定）」),把「誰指向誰」的正確性完全交給
router 層人工檢查。逐行核對後,`link` 端點確實做了完整擁有權檢查,但功能相同的 `create` /
`update` 端點卻完全沒有做 —— 這是本次最大的設計不一致。另外,`world_storyboards.productionStatus`
這一個 varchar(32) 欄位被兩套互不相容的狀態機共用(`SESSION_STATUSES` 對 `WorldStoryboardInput.
productionStatus` 的 7 個管線階段值),且 `canTransitionSession()` 對未知的 `from` 狀態沒有防護
(對照 `canTransitionSegment()` 就有),形成一個可由任何登入使用者以兩次合法呼叫觸發的未攔截 500。
`creativeProject.duplicate()` 只複製 `worldStoryboardId` 的指標而非分鏡本身,造成「複製專案」實際上
與原專案共用同一顆分鏡,編輯副本會直接改到原專案。以下依嚴重度列出完整發現、影響與建議,並在文末
列出本次已查證、可排除的疑慮(negative results)。

---

## Critical

### C1. `productionStatus` 被兩套不相容狀態機共用,`canTransitionSession()` 對未知 `from` 無防護 → 可被合法呼叫觸發未攔截 500

**發現(附行號)**

1. `shared/worldbuilding-animation.ts:208-215`(型別)與 `:362-372`(zod schema,`worldStoryboardInputSchema.
   productionStatus`)定義的合法值是「管線階段」:
   ```ts
   productionStatus:
     | "planning" | "generating_frames" | "refining"
     | "rendering_video" | "composing_audio" | "final_compose" | "completed";
   ```
   這個 schema 被 `server/routers/worldStoryboard.ts:152-171`(`create`)與 `:174-212`(`update`,
   `p.productionStatus !== undefined ? { productionStatus: p.productionStatus } : {}` 於 200-203 行)
   直接接受任何一個「客戶端可控」的上述 7 個值寫入 DB。

2. `shared/video-state-machines.ts:73-91` 定義的是另一套「session」狀態機:
   ```ts
   export const SESSION_STATUSES = ["planning","in_progress","paused","completed","failed","cancelled"] as const;
   export const SESSION_NEXT_STATES = { planning: [...], in_progress: [...], paused: [...], completed: [], failed: [...], cancelled: [] };
   ```
   只涵蓋 6 個值,其中 `generating_frames` / `refining` / `rendering_video` / `composing_audio` /
   `final_compose` 這 5 個「管線階段」值**完全不是這個物件的 key**。

3. `worldStoryboard.ts:352-378`(`updateSessionStatus`)：
   ```ts
   const currentStatus = (row.productionStatus ?? "planning") as (typeof SESSION_STATUSES)[number];
   if (!canTransitionSession(currentStatus, input.status)) { throw new TRPCError({...}); }
   ```
   而 `shared/video-state-machines.ts:113-116`：
   ```ts
   export function canTransitionSession(from: VideoSessionStatus, to: VideoSessionStatus): boolean {
     return (SESSION_NEXT_STATES[from] as readonly string[]).includes(to);
   }
   ```
   當 `from`(即 DB 裡目前的 `productionStatus`)是 `generating_frames` 這類「管線階段」值時,
   `SESSION_NEXT_STATES[from]` 是 `undefined`,對 `undefined` 呼叫 `.includes()` 會直接丟出
   `TypeError: Cannot read properties of undefined (reading 'includes')`,未被任何 try/catch 包住,
   最終讓 tRPC 回傳未分類的 `INTERNAL_SERVER_ERROR`(而非設計中的 `UNPROCESSABLE_CONTENT` 422)。

   對照同檔案 `shared/video-state-machines.ts:65-69` 的 `canTransitionSegment()`:
   ```ts
   const allowed = SEGMENT_NEXT_STATES[from];
   return allowed ? (allowed as readonly string[]).includes(to) : false; // 未知 from → 拒，不會崩
   ```
   這裡「未知 from → 拒」有防護,`canTransitionSession()` 卻沒有,是同檔案內兩個姊妹函式的不一致。

4. 這不是理論假設 —— `server/routers/director.ts:1215-1222` 有一模一樣的呼叫模式:
   ```ts
   const currentStatus = (row.productionStatus ?? "planning") as VideoSessionStatus;
   if (!canTransitionSession(currentStatus, "in_progress")) { throw new TRPCError({...}); }
   ```
   而且 `director.ts:1236-1239`、`:1360-1363`、`:1406-1409` 會把 `"in_progress"` / `"failed"` /
   `"completed"`(SESSION_STATUSES 的值)寫回同一個 `world_storyboards.productionStatus` 欄位。
   換句話說,同一個欄位在 `worldStoryboard.ts`(管線階段值)與 `director.ts`(session 值)兩條
   生產路徑上被輪流寫入,兩套字典**互不相容**,DB 層 `productionStatus` 是 `varchar(32)`
   (`drizzle/schema.ts:3568-3570`)沒有 enum 約束擋著。

**影響**

- 任何登入使用者對自己擁有的 storyboard 依序呼叫:
  `worldStoryboard.update({ id, patch: { productionStatus: "generating_frames" } })` →
  `worldStoryboard.updateSessionStatus({ id, status: "in_progress" })`,
  第二次呼叫會讓伺服器丟出未攔截例外,前端只會看到 500,而非乾淨的驗證錯誤。
- `director.ts` 的批次生成流程(`batchGenerateCostarWithSession` 類似路徑)一旦在某顆 storyboard
  處於「管線階段」狀態時被觸發(例如使用者剛用 `update` 手動設過 `productionStatus`),同樣會在
  `director.ts:1217` 崩潰,阻斷該次批次生成的所有段落,而不是優雅地回報「狀態不合法」。
- 更根本的問題:即使沒有崩潰,`productionStatus` 這個欄位的「事實」本身就是模糊的 ——
  UI(`AnimationStudio.tsx:5841` / `:6559`)只是把這個字串原樣印成 Badge,並沒有為 7 個管線值與
  6 個 session 值做語意區分,使用者看到 `in_progress` 或 `generating_frames` 只能各自腦補。

**建議**

1. 立即修：讓 `canTransitionSession()` 比照 `canTransitionSegment()` 加上「未知 from → 回 false」
   的防護,至少先把「崩潰」降級成「乾淨的 422」。
2. 中期修：把「管線階段」與「session 狀態」拆成兩個獨立欄位(例如 `pipelineStage` +
   `sessionStatus`),或把兩套列舉合併成一個涵蓋雙方需求的單一狀態機,避免同一欄位承載兩種不相容
   語意。

---

## High

### H1. `create` / `update` 允許在零擁有權驗證下,把專案綁到任意 `worldFrameworkId` / `worldStoryboardId` / `directorSessionId`,與同檔案 `link` 端點的顯式驗證邏輯互相矛盾

**發現(附行號)**

- `server/routers/creativeProject.ts:170-209`(`create`)直接把 `input.worldFrameworkId` /
  `input.worldStoryboardId` / `input.directorSessionId` / `input.worldviewId` / `input.scriptId`
  原封寫入 DB(178-182 行),**沒有**任何「這個 id 是否屬於 `ctx.user.id`」的檢查。
- `creativeProject.ts:212-262`(`update`)的 `patch` 型別是 `createInputSchema.partial()`
  (line 47),因此同樣可以透過 `patch.worldFrameworkId` / `patch.worldStoryboardId` /
  `patch.directorSessionId` 改綁(225-235 行),一樣**沒有**擁有權檢查,只有樂觀鎖
  (`expectedVersion`)保護,與「這串 id 到底是不是你的東西」無關。
- 對照 `creativeProject.ts:332-381`(`link`),同一組欄位在這裡卻被**認真檢查**:
  ```ts
  // 351-368 行
  if (input.directorSessionId != null) {
    const session = await db.getProjectNote(input.directorSessionId);
    if (!session || session.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
  }
  if (input.worldFrameworkId != null) {
    const fw = await db.getWorldbuildingFramework(input.worldFrameworkId);
    if (!fw || fw.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
  }
  if (input.worldStoryboardId != null) {
    const sb = await db.getWorldStoryboard(input.worldStoryboardId);
    if (!sb || sb.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
  }
  ```
  同一個 router 裡,「正確的綁定端點」與「可以繞過同一個檢查的端點」並存。

**影響**

- 任何登入使用者可以呼叫 `creativeProject.update({ id: 自己的專案, patch: { worldStoryboardId: 猜測/枚舉的 id } })`,
  把自己的專案指向別人的私有 storyboard/framework/導演對話,完全不會被擋下。
- 目前逐一追蹤到的**下游消費端**都各自重做了擁有權檢查,因此本次稽核**未能證實**存在直接的資料
  外洩鏈:
  - `creativeProject.ts:138-144`(`get` 的 `worldFrameworkName` 解析)
  - `server/subsystems/projectContext/projectContextService.ts:130-136`
  - `server/subsystems/contextPackets/adapters/projectContextAdapters.ts:60-66`(`loadOwnedFramework`)
    與 `:174-193`(`continuityAdapter`)
  - `server/routers/director.ts:446-459`(`loadSession`,對 `directorSessionId` 二次驗證)
  - 這些讀取端目前全部都是「找不到/不是你的 → 靜默略過」,不會顯示對方資料。
- 但這是「防禦深度」而非「設計正確」:寫入層完全沒有守門,一旦未來新增任何一個消費端(例如新的
  匯出功能、AI 代理技能、後台工具)忘記重做這道檢查,就會立刻變成可外洩他人世界觀/分鏡/導演對話
  內容的真實 IDOR。`worldviewId` / `scriptId` 這兩個「Phase 1 alias」欄位目前完全沒有任何程式碼
  讀取解析(`grep` 全庫確認,除了 round-trip 之外沒有 `db.getX(project.worldviewId)` 這類呼叫),
  屬於低風險但同樣缺乏保護。

**建議**

- 讓 `update` 對這些關聯欄位比照 `link` 補上擁有權檢查,或者更乾淨的做法:讓 `update` 的 patch
  schema **排除**這 5 個關聯欄位,強制所有「換綁」都必須經過已驗證的 `link` 端點;`create`
  同理應該在建立時就檢查客戶端傳入的初始關聯 id。

### H2. `creativeProject` ↔ `worldStoryboard` 之間沒有 1:1 保護 —— `duplicate()` 把新專案與原專案指向同一顆分鏡,DB 也沒有唯一性約束

**發現(附行號)**

- `creativeProject.ts:292-326`(`duplicate`)：
  ```ts
  // 300-315 行
  const newId = await db.createCreativeProject({
    userId: ctx.user.id,
    title: `${source.title} (副本)`,
    description: source.description ?? null,
    directorSessionId: null,                              // ← 304 行:作者刻意把導演對話隔開
    worldFrameworkId: source.worldFrameworkId ?? null,
    worldStoryboardId: source.worldStoryboardId ?? null,   // ← 306 行:分鏡卻沒有隔開,直接共用同一個 id
    worldviewId: source.worldviewId ?? null,
    scriptId: source.scriptId ?? null,
    ...
  });
  ```
  第 304 行明確把 `directorSessionId` 設為 `null`(避免副本繼承對話 session),但第 306 行的
  `worldStoryboardId` 卻原封不動複製過去 —— 兩個 `creativeProjects` row 會指向**同一個**
  `world_storyboards.id`。
- `drizzle/schema.ts:3694`(`worldStoryboardId: int(...)`)與 `:3721-3723`
  (`worldStoryboardIdIdx` 只是普通 index,不是 `uniqueIndex`)證實資料庫層完全不禁止多個
  `creativeProjects` row 共用同一個 `worldStoryboardId`。`creativeProject.ts:332-381`(`link`)
  的擁有權檢查也只驗證「這顆分鏡是不是你的」,不驗證「這顆分鏡是否已經被別的專案佔用」。

**影響**

- 使用者對「(副本)」專案呼叫 `worldStoryboard.update` 修改分鏡場景、時間軸、`productionStatus`
  等內容,實際上是在改**原專案也看得到的同一顆分鏡**,與一般人對「複製專案」= 獨立分支的直覺
  相反,可能造成原專案內容被意外覆寫或狀態機互相干擾(尤其疊加 C1 的狀態機問題)。
- `link` 允許任何使用者把自己已擁有的兩個(或更多)專案都指向同一顆自己擁有的分鏡,產生「多個
  project 共用一顆 storyboard」的資料形狀,而 `worldStoryboard` 這邊完全沒有反向欄位可以回答
  「這顆分鏡目前被哪個/哪些專案引用」,對帳/清理時難以判斷。

**建議**

- `duplicate()` 應該深拷貝一份新的 `world_storyboards` row(同一個 `worldId` 底下建立新分鏡,複製
  `scenesJson`/`totalDurationSec`/`fps`/`aspectRatio` 等欄位),再把新專案指向新分鏡;或至少把
  `worldStoryboardId` 也設為 `null`,並在前端提示「請重新綁定分鏡」,而不是靜默共用。
- 若「多專案共用一顆分鏡」是刻意允許的產品需求,建議在 `world_storyboards` 增加反向 index 或在
  `link` 端點加上「此分鏡已被其他專案綁定」的警示,避免使用者無意間造成交叉污染。

---

## Medium

### M1. `updateJob` 的狀態機檢查是讀取快照後才驗證,實際寫入卻是無條件的 `JSON_SET`,沒有真正的 compare-and-swap

**發現(附行號)**

- `worldStoryboard.ts:324-349`：
  ```ts
  const existingJobs = (row.jobsJson ?? {}) as Record<string, Record<string, unknown>>;
  const currentStatus = existingJobs[input.stepId]?.status as ...;
  if (currentStatus !== undefined && !canTransitionSegment(currentStatus, input.status)) {
    throw new TRPCError({ code: "UNPROCESSABLE_CONTENT", ... });
  }
  await db.updateWorldStoryboardJobAtomic(input.id, input.stepId, {
    ...(existingJobs[input.stepId] ?? {}),
    status: input.status, ...
  });
  ```
- `server/db.ts:3255-3267`(`updateWorldStoryboardJobAtomic`)：
  ```ts
  const jsonPath = `$.${stepId}`;
  await db.execute(
    sql`UPDATE world_storyboards SET jobsJson = JSON_SET(COALESCE(jobsJson, '{}'), ${jsonPath}, CAST(${jsonValue} AS JSON)) WHERE id = ${id}`
  );
  ```
  這條 SQL 對「目前 `jobsJson->stepId.status` 是否仍等於請求開頭讀到的 `currentStatus`」完全沒有
  WHERE 條件 —— 只要 `id` 存在就無條件覆寫。

**影響**

- 兩個並發請求(例如 render worker 回報進度 + 使用者手動 retry)若都在同一個 stepId 目前狀態下
  各自讀到同一個 `currentStatus` 快照,各自通過 `canTransitionSegment` 驗證後,最終寫入結果由
  「哪個 SQL 敘述後到」決定,而非「哪個轉移邏輯上先發生」決定,可能讓較舊的事件蓋掉較新的事件,
  和 `creativeProject.update` 的 `expectedVersion`(`db.ts:3456-3471` 的
  `WHERE id=? AND version=?` + `affectedRows` 檢查)相比,少了真正的原子性保護。

**建議**

- 讓 `updateWorldStoryboardJobAtomic` 的 SQL 加上「僅在 `JSON_EXTRACT(jobsJson, path) ->> status`
  等於呼叫端期望的 `currentStatus` 時才更新」的條件,並在 `affectedRows === 0` 時回傳
  `CONFLICT`/`UNPROCESSABLE_CONTENT`,而不是永遠視為成功。

### M2. `worldStoryboard` 完全沒有接上 AIDV-121 RBAC/共享機制,旗標開啟後仍無法讓被共享的協作者看到分鏡(北極星缺口)

**發現(附行號)**

- `server/services/authz/resourceAccess.ts:35`：
  ```ts
  export type ResourceType = "project" | "asset" | "prompt" | "material";
  ```
  沒有 `"storyboard"`(或等價型別)。
- `worldStoryboard.ts` 裡所有需要擁有權的端點(`get` 144-149、`update` 182-185、`delete` 218-221、
  `validate` 272-275、`planPipeline` 294-297、`updateJob` 325-328、`updateSessionStatus`
  361-364、`summarizeForPrompt` 384-387、`exportShotList` 628-631)一律是：
  ```ts
  if (!row || row.userId !== ctx.user.id) { throw new TRPCError({ code: "NOT_FOUND" }); }
  ```
  沒有任何一處呼叫 `isDataRbacEnabled()` / `canAccessResource()`,對照
  `creativeProject.ts:121-134` 的 `get` 端點,兩個檔案在「同一個 AIDV-121 旗標」下的實作深度
  明顯不對稱。

**影響**

- 就算未來 `ENABLE_DATA_RBAC` 打開(目前預設 `false`,見 `server/_core/env.validated.ts:603` 與
  `resourceAccess.ts:161-163`),`creativeProject.get` 允許被顯式共享的 viewer/editor 看到專案
  本身,但只要該協作者嘗試看專案綁定的分鏡時間軸(`worldStoryboard.get`/`listByWorld` 等),一律
  收到 `NOT_FOUND`,「共享協作」在分鏡這塊會直接斷鏈,產生「可以看到專案存在,但看不到專案實際
  內容」的破碎體驗。

**建議**

- 若共享協作是既定 roadmap,需要把 `"storyboard"` 加進 `ResourceType`,並在 `worldStoryboard.ts`
  各讀取端點比照 `creativeProject.get` 加上 `canAccessResource` gate(旗標 OFF 時行為不變)。

### M3. `link` 端點繞過 `creativeProject` 的樂觀鎖(`expectedVersion`),與 `update` 端點的併發保護不一致

**發現(附行號)**

- `creativeProject.ts:332-345`(`link` 的 input schema)只有 `id` / `directorSessionId` /
  `worldFrameworkId` / `worldStoryboardId`,**沒有** `expectedVersion` 欄位。
- `creativeProject.ts:369-379` 呼叫 `db.updateCreativeProject(input.id, {...})` 時**沒有傳
  `opts`**,對照 `update` 端點在 `:220-244` 明確傳入 `{ expectedVersion: input.expectedVersion }`。
- `db.ts:3456-3471`(`updateCreativeProject`)在 `opts?.expectedVersion` 為 `undefined` 時,會退化
  成「不檢查版本、直接 `WHERE id=?`」的路徑,但仍然執行 `version + 1`。

**影響**

- AIDV-316 樂觀鎖存在的目的是保護「多代理並行更新同一專案」的場景,但只有走 `update` 端點、且
  主動帶上 `expectedVersion` 的呼叫方才受保護。任何走 `link` 的呼叫方(包含目前 client 端
  `client/src/spine/projectGateway.ts:314-317` 的 `linkWorld()`)一律無條件覆寫欄位,且仍會讓
  `version` 遞增 —— 這會讓另一個「有乖乖帶 `expectedVersion` 的呼叫方」之後續 `update` 因為
  version 已經被 `link` 悄悄推進而收到非預期的 409,樂觀鎖的保護範圍變得不可預期、不完整。

**建議**

- 讓 `link` 的 input 也能帶 `expectedVersion` 並傳給 `updateCreativeProject`,或至少在文件與程式
  註解中明確說明「`link` 刻意不受版本保護,呼叫端需自行避免併發呼叫」。

### M4. `updateJob` 與 `updateSessionStatus` 在目前程式碼庫中找不到任何呼叫端 —— 疑似尚未接線的死碼

**發現(附行號)**

- `grep -rn "updateSessionStatus" /home/user/healing-studio --include=*.ts --include=*.tsx -l` 與
  `grep` `worldStoryboard.*updateJob\|updateJob`(排除定義本身)皆只命中
  `server/routers/worldStoryboard.ts` 自己 —— 沒有任何 client 元件、其他 server 檔案或測試呼叫
  這兩個 mutation(`updateJob`:`worldStoryboard.ts:313-350`;`updateSessionStatus`:`:352-378`)。
- 檔案頭註解(`worldStoryboard.ts:12-15`)本身也承認:「動畫管線實際執行(kick off render jobs)
  會接到 cross-modality-workflows 的 VIDEO_CREATION_WORKFLOW,但完整 orchestrator 跨多個
  spirit,超出本 router 的範圍」,暗示這兩個端點原本設計給範圍外的外部 orchestrator 回呼,但
  本次稽核範圍(server + client 全庫 grep)內找不到任何實際呼叫端。

**影響**

- 正面看:這讓 C1 的爆炸半徑目前侷限在「使用者主動、刻意呼叫」的情境,而非被動觸發,實務風險
  略低於「已被前端主動使用」的情形。
- 負面看:兩個端點都要求 `protectedProcedure`(即需要一般使用者登入 session,見
  `server/_core/trpc.ts:67`),若真正的外部 render pipeline / orchestrator 要回呼,勢必得攜帶
  使用者級 token,這與「後端到後端 webhook」的常見架構不符,值得確認這兩個端點的呼叫端到底是誰
  (前端尚未實作的功能?外部服務?或者已經是廢棄設計)。

**建議**

- 若確認為尚未接線的規劃中功能,建議在 PR/issue 追蹤中標註,並優先修掉 C1 的崩潰風險(反正修法
  成本很低);若確認為廢棄設計,建議連同 C1 一起評估是否要下架這兩個端點。

---

## 其他觀察(Low,列入文件但未列入結構化輸出)

- **L1**:`worldStoryboard.ts:214-224`(`delete`)直接刪除 `world_storyboards` row,沒有反向清除
  `creativeProjects.worldStoryboardId` 指向它的紀錄,留下懸空指標。對照 `creativeProject.ts:
  272-279`(`delete`)有明確的「AIDV-121：清掉此資源的孤兒共享記錄」邏輯,同一份檔案群組對「刪除
  後孤兒清理」的原則套用並不一致。目前確認消費端(`continuityAdapter` 等)都會對 `null` 分鏡
  做優雅降級,不會 crash,純粹是資料衛生問題。
- **L2**:`worldviewId` / `scriptId`(`creativeProject.ts:37-38`、`61-62`、`181-182`、
  `234-235`、`307-308`)是 schema 註解裡標明的「Phase 1 alias」欄位,寫入/讀出邏輯齊全,但全庫
  沒有任何程式碼真的用它們去查詢對應資源 —— 目前是純粹的「寫入即遺忘」欄位。
- **L3**:`server/services/authz/resourceAccess.ts:38` 定義 `AccessAction = "view"|"edit"|"delete"`,
  但 `creativeProject.ts` 只在 `get`(:124-130)呼叫過 `action: "view"`,`update`/`delete`/`link`
  從未呼叫 `canAccessResource(..., "edit")` 或 `"delete"`。即使旗標開啟,「editor 共享角色可以
  view+edit」這個在 `resourceAccess.ts` 文件裡承諾的能力,在 `creativeProjectRouter` 這一層
  完全不可達 —— 是一個未完成的能力(dead branch)。

---

## 已驗證排除的疑慮(Negative Results)

以下項目是本次任務要求特別檢查、但逐行核對後**確認未在這兩個檔案發現問題**的部分,列出以避免
報告只呈現壞消息:

1. **「猜最新一筆」反模式 —— 伺服器端未發現**:`creativeProject.ts` 的 `list`(:78-81)、
   `listPaginated`(:85-107)、`get`(:110-147)全部要求呼叫端明確帶入 `id`(或以
   `userId` 過濾清單),沒有任何「挑最後一筆/最新一筆當作預設」的隱式邏輯;`worldStoryboard.ts`
   的 `get`/`update`/`delete` 等也都需要明確 `id`。唯一找到的「挑最新」邏輯是
   `client/src/contexts/ProjectsContext.tsx:163-177`(`pickLatest`/`pickActive`),但其自身註解
   (:56-59)明確界定用途僅止於首頁「繼續上次專案」卡片展示,不會回寫進
   `client/src/contexts/WorldContextContext.tsx` 的 `currentProjectId`(真正驅動 AI prompt 世界觀
   注入的 SSOT id 仍然只能由使用者顯式選擇或由 `localStorage` 還原,參見
   `WorldContextContext.tsx:110-127`),因此不影響專案主幹的資料正確性。
2. **CSV 匯出的公式注入(cluster: injection)已修補**:`worldStoryboard.ts:709-711` 的
   `csvLine = toCsvRow` 走 `shared/csv-safe.ts` 的 `sanitizeCsvCell`(第一字元為 `=+-@` 時前置
   單引號、RFC-4180 引號跳脫),`exportShotList`(:620-706)所有欄位皆經過這條路徑,已對照
   AIDV-562 註解確認生效,不構成 CWE-1236 公式注入。
3. **`creativeProject.update` 本身的樂觀鎖是正確實作的**:`db.ts:3456-3471` 的
   `updateCreativeProject` 用 `WHERE id=? AND version=?` + `affectedRows` 檢查 + SQL 端
   `version + 1` 原子遞增,`creativeProject.ts:220-251` 正確處理了 `updated === false` 時回傳
   `CONFLICT`,沒有發現 lost-update 問題(前提是呼叫端有帶 `expectedVersion`,參見上方 M3)。
4. **`worldStoryboard.ts` 的擁有權檢查覆蓋率是完整的**:9 個需要擁有權的端點(`get`/`update`/
   `delete`/`validate`/`planPipeline`/`updateJob`/`updateSessionStatus`/`summarizeForPrompt`/
   `exportShotList`)逐一核對,全部一致採用 `row.userId !== ctx.user.id → NOT_FOUND`,沒有發現
   任何一處遺漏或用錯欄位比對(例如誤比對 `row.id` 而非 `row.userId`)的情形。`createFromSegments`
   /`queueForVideo`/`seedSkeleton`/`create`/`listByWorld` 也都先呼叫 `loadFramework(ctx.user.id,
   worldId)`(:78-120)驗證世界觀擁有權,才繼續往下走。
5. **`link` 端點本身的擁有權檢查是正確、完整的**(對照 H1,問題出在 `create`/`update` 沒有做,
   而不是 `link` 做錯):`creativeProject.ts:351-368` 對 `directorSessionId` /
   `worldFrameworkId` / `worldStoryboardId` 三者都各自查詢來源表並比對 `userId`,邏輯正確。
6. **billing / 退款 cluster 在這兩個檔案不適用**:`estimatedCostUsd`(`worldStoryboard.ts:65-67`、
   `168`、`207-209`、`307`)全程只是「估算值」的儲存與顯示,兩個檔案內都沒有任何實際扣款/退款/
   credit ledger 呼叫,不構成本次稽核範圍內的計費風險。
7. **`creativeProjects` 表本來就沒有 `visibility`/`teamId` 欄位,`get` 端點對此的處理是誠實的**:
   `creativeProject.ts:126-127` 傳給 `canAccessResource` 的 `{ ownerId, visibility: null, teamId:
   null }` 正確反映了 schema(`drizzle/schema.ts:3678-3725`)沒有這兩個欄位的事實,不是漏寫,而是
   「team_shared 池」這條路徑目前對 project 資源本來就不適用 —— 與程式碼行為一致。
8. **`creativeProjectsByUserPaginated` 的 keyset pagination 正確**:`db.ts:3425-3454` 用
   `lt(creativeProjects.id, opts.cursor)` 搭配 `orderBy(desc(id))`,沒有發現重複/跳過筆數的分頁
   bug,且全程以 `userId` 過濾,無跨租戶洩漏。
