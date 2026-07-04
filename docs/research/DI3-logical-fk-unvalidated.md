# DI3 — 邏輯 FK 寫入未驗證
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:各 create/update 寫入含 xxxId 欄位(指向他表)的路徑

## 方法
在 0 FK 前提下,逐一檢視各 router 的 create/update mutation:凡輸入含指向他表主鍵的
`xxxId`(或 json 內嵌的 id 陣列),追蹤是否在寫入前用 `db.getX(id)` + `owner.userId ===
ctx.user.id` 驗證「父存在且屬於同一使用者」。重點比對同一資源的姊妹端點(例如
`update` vs `link`,`create` vs `getXSuggestions`)是否驗證邏輯不一致 —— 這是最容易
漏檢的模式:某端點已寫好驗證,另一個能達到同樣寫入效果的端點卻繞過它。

本份報告與 DI1(orphan-on-delete,刪父留孤兒)分工:DI1 管「刪除時要不要斷開/清
理」,本報告只管「**寫入當下**有沒有先驗證那個 id」。同一批表(world_storyboards /
timeline_frames / scene_compositions)在兩份報告裡出現,是因為它們在「刪除路徑」與
「寫入路徑」各自獨立地沒做應有的檢查,並非重複計數。

已知不重複列入 findings(依任務要求,僅確認一次):`deleteDigitalAsset` 硬刪兩段式安
全閥(W9,`server/routers/assets.ts:284-331`);`creativeProject.duplicate` 共用
`storyboardId`(PS-09);share/transfer 競態(RC-rbac,`server/routers/rbac.ts`);分享獎
勵旗標無唯一約束(RC/EH,`server/routers/assets.ts:252-267`)。

---

## 高風險(high)

### 1. `worldbuilding.checkConsistency` — 任何使用者可覆寫他人 `timeline_frames` 列(純 IDOR,非僅「未驗證」)
- **Schema**:`drizzle/schema.ts:3596-3629` `timelineFrames`,`storyboardId`/`sceneId`/`userId` 皆為必填但無 FK。
- **寫入路徑**:`server/routers/worldbuilding.ts:688-719` `checkConsistency` mutation 的輸入 schema `consistencyCheckRequestSchema`(`shared/worldbuilding-timeline.ts:108-111`)只要求 `timelineFrameId: z.number().int().positive()`,router 內**完全沒有**先 `getTimelineFrame` 比對 `userId`,直接呼叫 `db.updateTimelineFrameConsistency(input.timelineFrameId, result)`。
- **DB 層同樣沒補洞**:`server/db.ts:3328-3338` `updateTimelineFrameConsistency(frameId, result)` 函式簽章根本沒有 `userId` 參數,`WHERE` 子句只有 `eq(timelineFrames.id, frameId)`。
- **對照**:同檔案 `listTimelineFrames`(`worldbuilding.ts:617-638`)與 `deleteTimelineFrame`(`worldbuilding.ts:678-683`)呼叫的 DB 函式都有 `userId` 參數且入 WHERE(`db.ts:3277-3293`、`3317-3326`),證明「驗證擁有權」是這個表的既定模式,`checkConsistency` 是漏掉的那一個。
- **影響(impact)**:任何已登入使用者只要知道(或暴力枚舉)別人的 `timelineFrameId`,就能呼叫此 mutation 覆寫該列的 `consistencyCheckJson` 欄位 —— 屬跨用戶未授權寫入(IDOR),不只是「未驗證父存在」,是直接可竄改他人資料列。
- **建議**:`checkConsistency` 比照 `deleteTimelineFrame` 先 `getTimelineFrame(input.timelineFrameId)` 並比對 `row.userId === ctx.user.id`,否則丟 `NOT_FOUND`;`updateTimelineFrameConsistency` 也應加 `userId` 參數並收進 `WHERE`,不能只靠呼叫端記得檢查。
- Cluster:logical-fk-unvalidated

### 2. `worldbuilding.uploadTimelineFrame` / `saveComposition` — 寫入 `storyboardId`/`worldId` 完全不驗證擁有權,可掛接他人或不存在的分鏡/世界觀
- **Schema**:`drizzle/schema.ts:3596-3629`(`timelineFrames.storyboardId`)、`3637-3664`(`sceneCompositions.worldId`/`storyboardId`)。
- **寫入路徑**:
  - `uploadTimelineFrame`(`server/routers/worldbuilding.ts:643-673`)直接把 `input.storyboardId`(來自 `timelineFrameInputSchema`,`shared/worldbuilding-timeline.ts:95-104`,純 zod 數字驗證、無 DB 存在性檢查)連同 `userId: ctx.user.id` 寫入 `db.createTimelineFrame`,沒有先呼叫 `getWorldStoryboard` 驗證該 storyboard 存在且屬於自己。
  - `saveComposition`(`server/routers/worldbuilding.ts:753-767`)同樣把 `input.worldId`、`input.storyboardId` 直接寫入 `db.createSceneComposition`,沒有驗證。
- **對照(同檔案內已知怎麼做對)**:同一 router 的 `getCompositionSuggestions`(`worldbuilding.ts:796-813`)在使用 `input.worldId` 前明確 `const world = await db.getWorldbuildingFramework(input.worldId); if (!world || world.userId !== ctx.user.id) throw NOT_FOUND`。`worldStoryboard.ts` 整檔(`create`/`update`/`seedSkeleton`/…)也一律先呼叫 `loadFramework(ctx.user.id, input.worldId)` 驗證(見該檔 78-120, 133-160 等)。`uploadTimelineFrame`/`saveComposition` 是同一模組裡明顯的例外。
- **影響(impact)**:攻擊者(已登入用戶)可以:(a) 把時間軸圖幀/構圖掛在**不存在**的 storyboardId/worldId 下(懸空引用,列出時永遠配不到父資料);(b) 把資料掛在**他人**的 storyboardId/worldId 下 —— 因下游查詢一律以 `(storyboardId, userId=自己)` 或 `(worldId, userId=自己)` 兩欄一起過濾(`db.ts:3277-3293`、`3342-3358`),攻擊者看得到自己塞入的髒資料,被掛接的受害者看不到也不受影響,但資料庫從此存在「有 storyboardId/worldId 但父列屬於別人」的孤兒式跨戶列,污染分析/清理腳本、且未來若任何報表或管理後台改成「純用 storyboardId/worldId 撈全部列」(不再疊加 userId),就會變成真正的跨戶洩漏。
- **建議**:`uploadTimelineFrame` 補 `loadFramework`-等級的 `getWorldStoryboard(input.storyboardId)` + `userId` 比對;`saveComposition` 補 `getWorldbuildingFramework(input.worldId)` + `userId` 比對(有 `storyboardId` 時一併驗證該 storyboard 屬於同一 world/使用者)。
- Cluster:logical-fk-unvalidated

---

## 中高風險(medium-high)

### 3. `creativeProject.update` 用泛用 `patch` 繞過姊妹端點 `link` 已寫好的擁有權驗證(create 亦從未驗證,即既有已知 S-28)
- **Schema**:`drizzle/schema.ts:3669-3728`,註解已明言「References(刻意不用 FK,方便重新綁定)」,五個 id 欄位:`directorSessionId`(3686)、`worldviewId`(3688)、`scriptId`(3690)、`worldFrameworkId`(3692)、`worldStoryboardId`(3694)。
- **寫入路徑**:
  - `create`(`server/routers/creativeProject.ts:170-209`):五個 id 全部 `input.xxxId ?? null` 直接寫入,零驗證(= 已知 S-28)。
  - `update`(`creativeProject.ts:212-262`):`patch` 內同樣五個欄位透過展開運算子(`p.directorSessionId`/`p.worldFrameworkId`/`p.worldStoryboardId`/`p.worldviewId`/`p.scriptId`,225-235 行)直接寫入 `db.updateCreativeProject`,同樣零驗證。
  - **對照**:同檔案 `link`(`creativeProject.ts:332-381`)是專門設計來「綁定三大資源」的端點,對 `directorSessionId`/`worldFrameworkId`/`worldStoryboardId` 三個欄位**都有**先 `db.getProjectNote`/`getWorldbuildingFramework`/`getWorldStoryboard` + `userId` 比對(351-368 行),非本人一律 `FORBIDDEN`。但 `update` 端點可以設定完全相同的三個欄位(加上 `worldviewId`/`scriptId` 兩個 `link` 沒覆蓋到的),卻完全不走這段驗證 —— 前端只要呼叫 `update` 而非 `link` 就繞過了保護,等同白寫了 `link` 的守門。
- **影響(impact)**:下游所有讀取路徑(`creativeProject.get`、`projectContextService`、`contextPacketService` 的 adapters)目前都有各自的 `framework.userId === userId` 二次檢查(見 `server/subsystems/contextPackets/adapters/projectContextAdapters.ts:56-66`、`168-206`、`projectContextService.ts:130-139`),所以**目前**不會直接洩漏他人世界觀/分鏡內容 —— 但這代表整個防線完全依賴「未來每一個新讀取路徑的作者都記得重新檢查 ownership」,任何一處漏檢就會變成可讀他人私有世界觀/分鏡資料的洞。且即使不洩漏,寫入端仍可把專案指向不存在或他人 id,造成長期累積的懸空引用(`worldviewId`/`scriptId` 兩個欄位甚至找不到任何消費端做驗證,需再查其實際指向的表/用途)。
- **建議**:把 `link` 裡的驗證邏輯下沉成共用 helper,`create` 與 `update` 對這五個欄位一律呼叫同一組驗證(存在 + `userId` 相符),而不是靠端點各自為政;或乾脆讓 `update` 對這五個欄位一律轉發到 `link` 的邏輯,禁止 `patch` 直接改。
- Cluster:logical-fk-unvalidated

### 4. `videoProject.create` 寫入 `creativeProjectId` 未驗證擁有權
- **Schema**:`drizzle/schema.ts:4604-4632`,`creativeProjectId: int("creativeProjectId")` nullable,無 FK,僅有 `userId` 索引。
- **寫入路徑**:`server/routers/videoProject.ts:65-116` `create` mutation 的輸入 schema 含 `creativeProjectId: z.number().int().positive().optional()`(70 行),直接寫入 `db.createVideoProject({ …, creativeProjectId: input.creativeProjectId ?? null })`(81-90 行),handler 全程未呼叫 `db.getCreativeProject` 或做任何 `userId` 比對。
- **對照**:同檔案 `requestExport`(469-522 行)對 `input.projectId`(videoProject 自己)與 `input.assetId` 都有嚴謹的存在性 + `userId` 雙重檢查(478-493 行),證明此檔案其他地方是有做驗證習慣的,`create` 對 `creativeProjectId` 是例外。
- **影響(impact)**:使用者可建立一個 `video_projects` 列,`creativeProjectId` 指向他人的 `creative_projects.id` 或不存在的 id。目前沒找到任何下游讀取路徑會「用 `creativeProjectId` 去撈 `creative_projects` 內容再顯示」(僅在建立時原樣寫入),因此當下不構成直接資料外洩,但屬未驗證的邏輯 FK,未來若 `/video` 頁面要顯示「所屬創作專案」標題等資訊時,若沿用這個未驗證欄位就會產生 IDOR。
- **建議**:`create` 補 `const cp = await db.getCreativeProject(input.creativeProjectId); if (input.creativeProjectId && (!cp || cp.userId !== ctx.user.id)) throw FORBIDDEN`。
- Cluster:logical-fk-unvalidated

---

## 中風險(medium)

### 5. `worldbuilding.create`/`update` 寫入 `linkedModelIds`(json 內嵌 id 陣列)未驗證擁有權
- **Schema**:`drizzle/schema.ts` `worldbuildingFrameworks.linkedModelIds`(json int[],無 FK,型別定義見 `shared/worldbuilding-types.ts`)。
- **寫入路徑**:`server/routers/worldbuilding.ts` `create`(112-152 行,125 行 `linkedModelIds: input.linkedModelIds ?? []`)與 `update`(154-209 行,178-180 行 `p.linkedModelIds`)都直接把陣列寫入,未逐一驗證每個 id 是否存在於 `fine_tuned_models` 且屬於 `ctx.user.id`。
- **對照**:同檔案 `linkableModels` 查詢(227-230 行)明確只回傳 `db.getFineTunedModelsByUser(ctx.user.id)`(= 只列出自己的),證明「這串 id 應該只能是自己的模型」是產品設計預期,寫入端卻沒有對應驗證。
- **影響(impact)**:可寫入他人或不存在的 `fine_tuned_models.id`。**需再查**:目前找不到任何生成/動畫管線程式碼實際讀取 `linkedModelIds` 去發動生成呼叫(在 `generate.ts`、`worldStoryboard.ts`、`shared/worldbuilding-animation.ts` 皆未見消費此欄位的邏輯),因此暫無法判斷是否會導致「用他人私有 LoRA 模型生成」這類更嚴重的越權使用 —— 若未來有功能開始信任此欄位做模型選取,務必在該處補驗證,不能假設寫入時已驗證過。
- **建議**:`create`/`update` 對 `linkedModelIds` 逐一 `db.getFineTunedModelsByUser(ctx.user.id)` 取回自己擁有的 id 集合後做差集檢查,非本人 id 一律拒絕或靜默過濾。
- Cluster:json-embedded-ref

### 6. `teachingArchive.linkRealEarthEntry` 寫入 `realEarthRefs`(json 內嵌 id 陣列)未驗證存在性
- **Schema**:`drizzle/schema.ts` `teachingMaterials.realEarthRefs`(json number[],對應 `realEarthEntries` 表,無 FK)。
- **寫入路徑**:`server/routers/teachingArchive.ts:462-489` `linkRealEarthEntry` 只驗證 `materialId` 擁有權(470-473 行,`loadMaterialForWrite`),對 `input.realEarthId` 本身沒有呼叫 `db.getRealEarthEntry` 確認存在,就直接 push 進 `realEarthRefs` 陣列寫回(482-486 行)。`unlinkRealEarthEntry`(492-514 行)同構但屬純移除、風險較低。
- **降低嚴重度的因素**:`realEarthEntries` 是站內共用知識庫(`server/routers/realEarth.ts:51-79` 的 `list`/`get` 皆不依 `userId` 過濾,屬公開內容),所以寫入不存在/已刪除的 id 只會造成「連結顯示不到內容」的懸空引用(`getRealEarthLinks` 只回傳 id 陣列,前端另外逐一查詢,不會直接洩漏他人私有資料)。
- **影響(impact)**:懸空引用累積(尤其 `realEarthEntries.delete`,`realEarth.ts:191-205`,也未反向清理任何 `teachingMaterials.realEarthRefs`,兩邊都缺這一環)。
- **建議**:`linkRealEarthEntry` 加一次 `db.getRealEarthEntry(input.realEarthId)` 存在性檢查;`realEarthEntries.delete` 增加 best-effort 清理引用它的 `realEarthRefs`(或至少不擋刪除、留給背景任務,做法可比照 `deleteAllSharesForResource` 的 best-effort 模式)。
- Cluster:json-embedded-ref

---

## 低風險 / 附帶觀察(low)

### 7. `deleteTeam` 交易未清理 `promptCollection.teamId`,團隊解散後 team_shared 提示詞卡在無主狀態
- **Schema**:`drizzle/schema.ts:1852-1909`,`promptCollection.teamId` nullable、`visibility` 可為 `team_shared`。
- **寫入/刪除路徑**:`server/db.ts:4347-4360` `deleteTeam` 交易內正確處理 `teachingMaterials.teamId → null`(連同 `visibility: "private"` 一併重設,4353-4356 行)與 `teamMemberships` 刪除(4357 行),但**沒有**對 `promptCollection` 做同樣的事。
- **影響(impact)**:團隊解散後,原本 `visibility: "team_shared"` 且 `teamId` 指向該已刪除團隊的 `promptCollection` 列會維持原狀 —— `teamId` 變懸空引用,且 `visibility` 沒有跟著退回 `private`(不像 `teachingMaterials` 那樣被動退回)。原 owner 因為自己的 `list` 查詢只用 `userId` 過濾(不看 `visibility`)仍看得到該筆,UI 上卻可能誤顯示「團隊共享中」的過期狀態;其他曾在該團隊的成員理論上因 `teamMemberships` 已被清空、走 `requireTeamMember` 一類檢查會失敗而看不到,實際影響偏向資料衛生而非資料外洩。此問題與 DI1 #8/#9(`deleteTeam` 遺漏 `project_data_access_rules`/`orchestration_runs`/`context_packets`/`data_source_connections`/`fine_tuned_models` 的 `teamId`)同屬一類「刪 team 只顧一張表」的病灶,`promptCollection` 是額外一張沒被 DI1 點名的表,一併補在此處供 DI1 修補時合併處理。
- **建議**:`deleteTeam` 交易內加一行 `UPDATE prompt_collection SET teamId = NULL, visibility = 'private' WHERE teamId = ?`,與 `teachingMaterials` 同款寫法。
- Cluster:orphan-on-delete(附帶於本次掃描,建議併入 DI1 修補批次)

---

## 已正確驗證 / 有約束的正向案例(negative results)

1. **`assets.ts` 全檔**(`server/routers/assets.ts`):`upload`/`update`/`toggleVisibility`/`delete`/`linkedPrompts` 對 `id` 一律先 `getDigitalAsset` + `userId` 比對(74-77、211-213、233-234、288-289 行);`delete` 額外做兩件本次任務要求「僅確認」的正確清理:R2 物件計數後才刪(309-324,= W9 的一部分脈絡)、`deleteAllSharesForResource("asset", id)`(328 行)清孤兒分享。`backgroundJobId` 欄位(`digitalAssetLibrary.backgroundJobId`)雖無驗證,但只在 `server/services/postGenActions.ts` 內部信任呼叫鏈寫入(來源是後端自己產生的 job,非使用者可控輸入),不構成外部可控的邏輯 FK 風險。
2. **`resourceShares` 共享機制**(`server/routers/rbac.ts`):`share`/`transferOwnership` 對 `sharedWithId`(user 或 team)一律呼叫 `validateShareTarget`(83-113 行)驗證對象存在,team 共享額外驗證分享者與該 team 有關係(106-112 行);`transferOwnership` 驗證 `newOwnerUserId` 存在(268-274 行)。`resourceShares` 表本身有 `(resourceType, resourceId, sharedWithType, sharedWithId)` 唯一索引(`drizzle/schema.ts:4458-4463`),不會重複列 —— missing-unique 疑慮在此不成立。
3. **`worldStoryboard.ts` 全檔**:`create`/`update`/`seedSkeleton`/`get` 等一律先 `loadFramework(ctx.user.id, input.worldId)` 驗證世界觀擁有權(見 78-120 行 helper 定義,及 133-160 等呼叫點),模式一致。
4. **`teams.ts` 全檔**:`addMember` 明確以註解記錄「DB 沒掛 FK 約束,應用層必須先確認 userId 真的存在」(129-137 行),`transferOwnership`/`updateMemberRole` 對目標成員一律先驗證是否為現有 membership(216-222、248-251 行)。
5. **`promptLibrary.ts`/`promptCollection.ts`**:所有涉及 `promptId`/`teamId` 的讀寫,均先做 `userId` 或 `requireTeamMember`(`promptCollection.ts:105-119`)驗證後才放行;`promptCollection` 設定 `team_shared` 前一律呼叫 `requireTeamMember`(568-574 行)。
6. **`modelWishesRouter.ts`**:`vote`/`unvote` 呼叫 `db.voteModelWish`/`unvoteModelWish`,對不存在的 `wishId` 會拋 `WISH_NOT_FOUND` 由 router 轉成 `NOT_FOUND`(162-186 行);`modelWishVotes` 表有 `(wishId, userId)` 唯一索引(`drizzle/schema.ts:3997-4000`),防重複投票,missing-unique 疑慮在此不成立。
7. **`studio.ts`**:`recipes`/`versions` 兩個子路由不含任何指向他表的 `xxxId` 欄位,`delete` 一律帶 `ctx.user.id` 收斂 WHERE,無邏輯 FK 風險。
8. **`videoProject.requestExport`**:對 `projectId` 與 `assetId` 都做「存在 + `userId` 相符 + 型別正確(`assetType==="video"`)」三重檢查(478-498 行),是本次掃描中驗證最嚴謹的端點之一,可作為其他端點的參考範本。
9. **`contextPacketService` / `projectContextAdapters`**:即使上游(`creativeProjects`)寫入未驗證(見 finding #3),下游讀取一律重新 `framework.userId === input.userId` / `storyboard.userId === input.userId` 二次檢查(`projectContextAdapters.ts:56-66`、`168-181`),目前形成事實上的縱深防禦,但如 finding #3 所述,這道防線完全靠「每個新讀取端都記得補檢查」維持,建議仍在寫入端補洞而非只依賴讀取端。

---

## 統計摘要

| 嚴重度 | 件數 |
| --- | --- |
| high | 2 |
| medium-high | 2 |
| medium | 2 |
| low | 1 |
| 正向案例 | 9 |

核心結論:0 FK 下,本站絕大多數「顯式共享/團隊/資產」相關端點(rbac、teams、assets、
promptLibrary、promptCollection)已建立一致的「先查存在與擁有權再寫入」紀律;風險集
中在**世界觀/分鏡/時間軸這條創作管線**(`worldbuilding.ts`、`creativeProject.ts` 部
分端點)—— 同一模組內出現「有的端點驗證、姊妹端點不驗證」的不一致模式(`link` vs
`update`、`getCompositionSuggestions` vs `saveComposition`、`deleteTimelineFrame` vs
`checkConsistency`),顯示問題不是「不知道要驗證」,而是新端點在複製貼上時漏掉了既有
模式,建議優先把驗證邏輯收斂成共用 helper(如 `loadFramework`)並強制所有寫入端點呼叫,
而非仰賴逐一手動比對。
