# DI1 — 刪除孤兒(刪父留子)

- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:drizzle/schema.ts + 各 delete 路徑(user/project/team/model/storyboard/世界觀/教材 刪除)

## 方法

1. 讀 `drizzle/schema.ts` 全 102 表,對照 `server/db.ts:5300` 的 `USER_OWNED_TABLES`(GDPR 帳號刪除清單),用腳本抓出「有 `userId`/`user_id` 欄位但不在清單內」的表。
2. 對七個主要實體(users / creative_projects / teams / fine_tuned_models / world_storyboards / worldbuilding_frameworks / teaching_materials)逐一找 delete router + `server/db.ts` 對應函式,確認刪除時是否處理指向它的子列。
3. 0 FK,所以任何遺漏都不會被 DB 擋下 —— 只能靠讀程式碼判斷。

---

## 高風險(critical)

### 1. `deleteUserAccount` 遺漏 `resource_shares`,刪帳號留下失效分享記錄
- **Schema**:`drizzle/schema.ts:4432-4478`(`resourceShares`,`resourceId`/`sharedWithId`/`sharedByUserId` 皆為 `notNull()` 的邏輯外鍵,無實體 FK)
- **寫入/刪除路徑**:`server/db.ts:5300-5370`(`USER_OWNED_TABLES` 清單裡沒有 `"resource_shares"`);`server/db.ts:5379-5395`(`deleteUserAccount` 只跑清單裡的表 + `users`)
- **對照**:個別資源刪除時確實有清 shares —— `server/routers/creativeProject.ts:265-279`、`server/routers/teachingArchive.ts:364-378`、`server/routers/assets.ts:328`、`server/routers/promptLibrary.ts:288` 都呼叫 `db.deleteAllSharesForResource(...)`(`server/db.ts:4703`)。但**帳號整體刪除**時完全不會跑這段清理。
- **影響**:使用者刪帳號後,(a) 該使用者建立的 project/asset/prompt/material 已被清空(表在 `USER_OWNED_TABLES` 內),但 `resource_shares.resourceId` 仍留著指向這些已消失資源的列 → 其他被分享者的清單查詢會看到「幽靈資源」或在讀取資源詳情時打到 `NOT_FOUND`;(b) `resource_shares.sharedByUserId`(誰分享的)與 `sharedWithId`(分享給誰,若對象是使用者)可能仍指向已刪除的 userId,是刪帳號後殘留的可辨識個資關聯,屬 GDPR 殘留。
- **建議**:`deleteUserAccount` 交易內,刪除 `USER_OWNED_TABLES` 的資源列之前,先用 `resourceType`+`resourceId IN (該 user 擁有的 project/asset/prompt/material id)` 清 `resource_shares`;另外對 `sharedWithType='user' AND sharedWithId = userId` 的列也要清。
- **cluster**:orphan-on-delete + gdpr-residue

### 2. `orb_conversation_messages` 不在 `USER_OWNED_TABLES`,刪帳號留下完整聊天內容
- **Schema**:`drizzle/schema.ts:2737-2768`(`orbConversationMessages`,`userId notNull()`,`text: text("text").notNull()` — 訊息全文)
- **寫入/刪除路徑**:`server/db.ts:5300-5370`(清單有 `"orb_conversations"` 但沒有 `"orb_conversation_messages"`)
- **對照(正確做法)**:單一對話刪除端點反而做對了 —— `server/routers/orbConversationsRouter.ts:304-340`,`delete` mutation 先驗證擁有權,再用交易依序刪 `orbConversationMessages`(326-333)才刪 `orbConversations`(334-340)。
- **影響**:帳號被整批刪除(GDPR 被遺忘權)時繞過了這條正確邏輯,直接對 `orb_conversations` 按 userId 做 `DELETE`,但訊息表沒被列入清單,使用者與 Orb 之間的完整對話全文(`text` 欄位)在刪帳號後永久留存於資料庫,且該列的 `userId` 仍指向已刪除帳號 —— 明確的 GDPR 殘留个資,且無從再用 API 觸及來清除(conversationId 對應的 conversation 母列已消失,前端也查不到)。
- **建議**:把 `"orb_conversation_messages"` 加進 `USER_OWNED_TABLES`(比照單一對話刪除的順序,訊息先刪、對話再刪,或因已停用 FK check 順序其實不重要)。
- **cluster**:gdpr-residue(嚴重,含對話全文)

### 3. `timeline_frames` / `scene_compositions` 雙重問題:刪 storyboard/世界觀留孤兒,且刪帳號也不清
- **Schema**:
  - `timeline_frames`:`drizzle/schema.ts:3596-3629`,`storyboardId: int("storyboard_id").notNull()`(3600)、`userId: int("user_id").notNull()`(3602)
  - `scene_compositions`:`drizzle/schema.ts:3637-3664`,`worldId: int("world_id").notNull()`(3641)、`storyboardId: int("storyboard_id")`(nullable,3642)、`userId: int("user_id").notNull()`(3643)
- **刪除路徑**:
  - `server/db.ts:3269-3273` `deleteWorldStoryboard(id)` 只 `DELETE FROM world_storyboards WHERE id=?`,呼叫點 `server/routers/worldStoryboard.ts:215-224`。完全沒有處理 `timeline_frames.storyboardId` 或 `scene_compositions.storyboardId` 指向這個 id 的列。
  - `server/db.ts:3187-3193` `deleteWorldbuildingFramework(id)` 只刪 framework 列,呼叫點 `server/routers/worldbuilding.ts:212-221`。不處理 `scene_compositions.worldId` 指向此 id 的列(`world_storyboards.worldId` 也一樣,但 `world_storyboards` 至少在帳號刪除清單內,storyboard 本身「刪除單筆」時才是問題)。
  - `USER_OWNED_TABLES`(`server/db.ts:5300-5370`)兩表皆未列入 —— 帳號整體刪除也不會清。
- **影響**:
  - 使用者手動刪一個分鏡(storyboard)後,底下的每一張 `timeline_frames`(圖幀,含 `imageUrl`/`description`)與相關 `scene_compositions` 全部變孤兒,前端「時間軸」「多角色構圖」頁面之後用 `storyboardId` 查詢時會撈到一批指向不存在分鏡的殘留列(查詢空指標 / 顯示壞資料),且這些圖檔 URL 永遠不會被清除或標記回收。
  - 刪一個世界觀(worldbuilding framework)同理會孤兒化底下 `scene_compositions.worldId`。
  - 因兩表都有 `notNull userId`,刪帳號時這些孤兒列還帶著已刪除使用者的 id 殘留 —— 兩個 cluster 疊加。
- **建議**:
  1. `deleteWorldStoryboard`/`deleteWorldbuildingFramework` 改成交易:先刪子表(`timeline_frames` by storyboardId、`scene_compositions` by storyboardId/worldId),再刪主表。
  2. 把兩表加進 `USER_OWNED_TABLES`,補上帳號刪除這條路。
- **cluster**:orphan-on-delete + gdpr-residue

---

## 中高風險(high)

### 4. 刪 creative_project 後,`context_packets`(含摘要全文)、`orchestration_runs` 變孤兒
- **Schema**:
  - `context_packets`:`drizzle/schema.ts:3806-3834`,`projectId: int("projectId").notNull()`(3810),`summaryMarkdown: mediumtext(...)`(3817,可含大量創作摘要內容)
  - `orchestration_runs`:`drizzle/schema.ts:3735-3797`,`projectId: int("projectId")`(3741,nullable)、`teamId`(3742,nullable)
- **刪除路徑**:`server/db.ts:3473-3477` `deleteCreativeProject(id)` 只 `DELETE FROM creative_projects WHERE id=?`;router 層(`server/routers/creativeProject.ts:265-290`)額外只清了 `resource_shares`(見上文正確案例),沒有觸碰 `context_packets`/`orchestration_runs`。
- **影響**:專案刪除後,`context_packets.projectId`(notNull,無法被「已刪除」語意覆蓋)與 `orchestration_runs.projectId` 都留著指向不存在專案的列,其中 `context_packets` 帶有完整創作摘要文字,永久佔用且無清理路徑(此表目前也沒有任何 delete 函式,連手動清都做不到,只能等 `expiresAt` 過期但過期後仍不會被刪除,只是重算時忽略)。
- **建議**:`deleteCreativeProject` 交易內一併 `DELETE FROM context_packets WHERE projectId=?`、`UPDATE orchestration_runs SET projectId=NULL WHERE projectId=?`(runs 因 nullable 且有稽核價值,建議保留列但斷開關聯而非整刪)。
- **cluster**:orphan-on-delete

### 5. 刪 fine_tuned_model 後,`fine_tuned_model_consents` 兩端全孤兒
- **Schema**:`drizzle/schema.ts:2414-2430`,`fineTunedModelConsents.modelId: int("modelId").notNull()`(2418)—— 多對多關聯表,連向 `fine_tuned_models.id` 與 `model_training_consents.id`。
- **刪除路徑**:`server/db.ts:1055-1059` `deleteFineTunedModel(id)` 只刪模型列;呼叫點 `server/routers/models.ts:791-800`(有驗證擁有權,但無 cascade)。
- **影響**:模型刪除(不論是使用者手動刪,或帳號整體刪除 —— `fine_tuned_models` 在 `USER_OWNED_TABLES` 內但 `fine_tuned_model_consents` 不在)後,關聯表留下 `modelId` 指向不存在模型的列;帳號刪除情境下 `consentId` 那端(`model_training_consents`,也在清單內被刪)同時消失,整列變成兩端都懸空的純垃圾資料,且訓練同意稽核軌跡因此斷裂(想追「這個模型當初用了哪些同意記錄訓練」會查到已不存在的 id,對合規追溯是負面影響)。
- **建議**:`deleteFineTunedModel` 增加 `DELETE FROM fine_tuned_model_consents WHERE modelId=?`;並把 `"fine_tuned_model_consents"` 加進 `USER_OWNED_TABLES`(需先解出該 user 的 modelId 清單再刪,因為此表本身沒有 userId 欄位)。
- **cluster**:orphan-on-delete

### 6. `creative_projects` 自身的 `worldFrameworkId`/`worldStoryboardId`/`worldviewId` 在被指對象刪除後不會斷開
- **Schema**:`drizzle/schema.ts:3678-3725`,`worldviewId`(3688)、`worldFrameworkId`(3692)、`worldStoryboardId`(3694)皆為 nullable int,程式註解明言「References(刻意不用 FK,方便重新綁定)」(`drizzle/schema.ts:3673-3677`)。
- **刪除路徑**:上文第 3 點的 `deleteWorldStoryboard`(`server/db.ts:3269`)、`deleteWorldbuildingFramework`(`server/db.ts:3187`)都只刪自己的表,完全不會回頭 `UPDATE creative_projects SET worldFrameworkId/worldStoryboardId = NULL WHERE ...`。
- **影響**:使用者刪掉一個世界觀或分鏡後,原本綁定它的 creative_project 列仍帶著死掉的 id;專案詳情頁面若依賴這兩個欄位去 join 讀世界觀/分鏡資料,會拿到 `null` 結果卻誤以為「使用者自己還沒建立」,而不是「原本連結的資源已被刪除」——邏輯上是使用者可感知的資料完整性問題(顯示壞掉的連結、無法分辨「未設定」與「已刪除」)。
- **建議**:至少在刪 storyboard/framework 時,對這幾個欄位做 `UPDATE ... SET xxxId = NULL`(schema 註解已表明作者知道無 FK,但目前確實沒有補寫這段清理)。
- **cluster**:orphan-on-delete(dangling reference,非傳統「父刪留子」但同樣是 0 FK 造成的懸空引用)

### 7. `studio_versions` 不在 `USER_OWNED_TABLES`,刪帳號後創作版本記錄殘留
- **Schema**:`drizzle/schema.ts:2806-2832`,`userId: int("userId").notNull()`(2810),`payload: json(...).notNull()`(2818,存完整 VersionEntry —— compiledPrompt / outputUrl 等創作內容)。
- **刪除路徑**:`server/db.ts:5300-5370` 清單有 `"studio_recipes"` 但沒有 `"studio_versions"`(兩者是不同表,`studio_recipes` 定義在 `drizzle/schema.ts:2774`)。
- **影響**:帳號刪除後,使用者在 Studio 版本歷史留下的完整 payload(含 prompt、輸出網址)永久殘留,且掛著已刪除的 `userId`。
- **建議**:把 `"studio_versions"` 加進 `USER_OWNED_TABLES`。
- **cluster**:gdpr-residue

---

## 中風險(medium)

### 8. `deleteTeam` 沒處理 `project_data_access_rules.teamId`(notNull)
- **Schema**:`drizzle/schema.ts:3843-3877`,`teamId: int("teamId").notNull()`(3847)。
- **刪除路徑**:`server/db.ts:4347-4360` `deleteTeam(id)` 用交易正確處理了 `teaching_materials.teamId → null`(4353-4356)與 `team_memberships`(4357),但完全沒碰 `project_data_access_rules`。
- **影響**:團隊解散後,存取規則列(`accessLevel`/`allowedModesJson`)留著指向不存在 `teamId` 的孤兒列;因 `teamId` 是 `notNull`,無法比照 `teaching_materials` 用「設 null」的方式優雅降級,只能整列刪除。目前資料庫裡會持續累積死掉的存取規則,佔用空間且讓「這個團隊有哪些存取規則」之類的稽核查詢失真。
- **建議**:`deleteTeam` 交易內加一行 `DELETE FROM project_data_access_rules WHERE teamId=?`。
- **cluster**:orphan-on-delete

### 9. `deleteTeam` 也沒處理其他表的 `teamId`:`orchestration_runs` / `context_packets` / `data_source_connections` / `prompt_collection` / `fine_tuned_models`
- **Schema 位置**(核實 `creativeProjects` 本身**沒有** `teamId` 欄位,teamId 出現在以下幾張表):`orchestrationRuns.teamId`(`drizzle/schema.ts:3742`,nullable)、`contextPackets.teamId`(`drizzle/schema.ts:3811`,nullable)、`projectDataAccessRules.teamId`(`drizzle/schema.ts:3847`,notNull,已在上一條單獨列出)、`dataSourceConnections.teamId`(`drizzle/schema.ts:3894`,nullable)、`promptCollection.teamId`(`drizzle/schema.ts:1886`,nullable)、`fineTunedModels.teamId`(`drizzle/schema.ts:466`,nullable)、`teamMemberships.teamId`(`drizzle/schema.ts:4169`,已在 `deleteTeam` 正確處理)。
- **刪除路徑**:`server/db.ts:4347-4360`,同上,只處理 3 張表。
- **影響**:團隊解散後,上述表中 nullable 的 `teamId` 繼續指向死掉的團隊 id,屬於輕量孤兒(欄位多半只是「這筆資料原本屬於哪個團隊」的標籤,不影響資源本身可用性,但團隊相關的篩選/報表會撈到殘影)。
- **建議**:視語意選擇「刪團隊時把這些表的 teamId 設 null」或「保留原樣但在讀取層過濾已刪除的 teamId」;至少要在 code comment 標明這是已知取捨,而非遺漏。
- **cluster**:orphan-on-delete(輕度)

### 10. 刪教材(teaching_materials)未清理 `teaching_material_access_log.materialId`
- **Schema**:`drizzle/schema.ts:4200-4232`,`materialId: int("materialId").notNull()`(4204)。
- **刪除路徑**:`server/db.ts:4264-4268` `deleteTeachingMaterial(id)` 只刪 `teachingMaterials` 列;router(`server/routers/teachingArchive.ts:364-386`)有清 `resource_shares` 與 Pinecone 向量(正確做法),但沒清這張存取日誌表。
- **影響**:教材刪除後,`teaching_material_access_log` 留著大量「誰在何時看過/下載過」的紀錄,`materialId` 指向不存在的教材;`accessLog` 查詢端點(`teachingArchive.ts:389-` 附近)若之後被誰用 materialId 反查會拿到查無教材但仍列出存取記錄的怪異結果。因為此表本身也在 `USER_OWNED_TABLES` 內(依 userId 清),帳號刪除時「查看者」side 會清,但「被查看的教材」side 若教材擁有者仍在世,記錄依然孤兒化。
- **建議**:`deleteTeachingMaterial` 加 `DELETE FROM teaching_material_access_log WHERE materialId=?`(稽核與留存政策若要求保留存取記錄,則應改記錄快照而非活查詢)。
- **cluster**:orphan-on-delete(低-中,僅影響稽核可讀性,不影響核心資料安全)

### 11. `consistency_vault` / `agent_dlq` / `orb_workflow_template_ratings` 不在 `USER_OWNED_TABLES`
- **Schema**:
  - `consistency_vault`:`drizzle/schema.ts:719-740`,`userId notNull()`(723),存角色/場景一致性參考圖(`imageUrl`/`fileKey`)。
  - `agent_dlq`:`drizzle/schema.ts:2660-2697`,`userId: int("user_id").notNull()`(2666),死信佇列,含失敗 payload。
  - `orb_workflow_template_ratings`:`drizzle/schema.ts:3278-3304`,`userId notNull()`(3283),使用者對範本的評分/評論。
- **刪除路徑**:`server/db.ts:5300-5370`,三表皆未列入 `USER_OWNED_TABLES`。
- **影響**:帳號刪除後三表仍殘留掛著已刪除 `userId` 的列;`consistency_vault` 內容(角色參考圖 URL)算創作性個資,優先度較高;`agent_dlq`/評分內容個資敏感度較低,但仍是系統該保證清空卻沒清空的例外。
- **建議**:三表加入 `USER_OWNED_TABLES`。
- **cluster**:gdpr-residue

### 12. `video_analytics.userId` 帳號刪除後不會被清空/設 null
- **Schema**:`drizzle/schema.ts:4737-4755`,`userId: int("user_id")`(4743,nullable,註解明言「null = 匿名訪客或用戶已退出追蹤(GDPR opt-out)」),`videoProjectId: int("video_project_id").notNull()`(4741)。
- **刪除路徑**:`video_analytics` 不在 `USER_OWNED_TABLES`;`video_projects` 在清單內,帳號刪除時 `video_projects` 列被清空,但 `video_analytics.videoProjectId` 沒被一併清 → 同時具備「userId 未 opt-out 語意下的殘留」與「刪 video_project 留孤兒」雙重小問題。
- **影響**:較低 —— 內容僅為事件型別/觀看秒數,無直接可讀個資,但欄位設計本身承諾「可被清空代表 GDPR 退出」,實際帳號刪除流程並未真正做到這件事,是設計意圖與實作的落差。
- **建議**:`deleteUserAccount` 對 `video_analytics` 執行 `UPDATE video_analytics SET userId = NULL WHERE userId = ?`(不需整列刪除,只斷開個資關聯,符合欄位原始設計);另加 `DELETE FROM video_analytics WHERE videoProjectId IN (該 user 的 video_projects id)` 或改用 `UPDATE ... SET videoProjectId = NULL` 視分析用途取捨。
- **cluster**:gdpr-residue(輕度)+ orphan-on-delete(輕度)

### 13. `project_snapshots` 沒有 `userId` 欄位,`video_projects` 刪除後永遠孤兒且無法批次尋回
- **Schema**:`drizzle/schema.ts:4639-4654`,`projectId: int("project_id").notNull()`(4643,對應 `video_projects.id`),表內**無** `userId` 欄位。
- **刪除路徑**:目前 `server/routers/videoProject.ts` 沒有任何單筆刪除 `video_projects` 的 mutation(已確認),因此唯一會刪 `video_projects` 的路徑是帳號刪除(`USER_OWNED_TABLES` 內有 `"video_projects"`,`server/db.ts:5369`);但 `project_snapshots` 不在清單,且因為它沒有 `userId` 欄位,連「事後補寫清理」都無法直接用 `WHERE userId=?` 掃出來,必須先 join `video_projects`(此時 `video_projects` 都已經被刪了,join 不到)。
- **影響**:帳號刪除後,`project_snapshots` 的快照 JSON(`snapshot: json(...).notNull()`)永久留存且無從追溯歸屬,是目前所有發現中「最難事後補救」的一筆孤兒資料(因為刪除順序一旦執行完就無法再靠 projectId 反查 owner)。
- **建議**:`deleteUserAccount` 交易中,務必在刪 `video_projects` **之前**,先用子查詢 `DELETE FROM project_snapshots WHERE project_id IN (SELECT id FROM video_projects WHERE userId = ?)`,再刪 `video_projects` 本身;不能簡單加到 `USER_OWNED_TABLES` 迴圈裡(該迴圈是逐表 `WHERE userId=?`,這張表沒有這個欄位,直接加入清單也篩不到東西)。
- **cluster**:orphan-on-delete(高稽核成本,但目前無主動刪除入口,實際發生機率取決於帳號刪除頻率)

---

## 已確認/已知情況(依任務要求,僅確認不重複列入 findings)

- **W9**:`deleteDigitalAsset` 硬刪具兩段式安全閥 —— 已讀 `server/routers/assets.ts` 對應邏輯,確認與任務描述一致,不重複稽核。
- **PS-09**:`creativeProject.duplicate` 複製專案時共用同一個 `storyboardId`(`server/routers/creativeProject.ts:293-` 附近)—— 已知的資料共用設計,不在本次孤兒稽核範圍內重複列出。
- **RC-rbac**:share/transfer 競態 —— 已知,屬並行控制問題而非孤兒問題,不重複列。
- **RC/EH**:分享獎勵旗標無唯一約束 —— 已知的 missing-unique 案例,不重複列(本輪聚焦 orphan-on-delete)。

## 已正確清理 / 有約束的正向案例(negative results)

1. `deleteTeam`(`server/db.ts:4347-4360`)用交易把 `teaching_materials.teamId` 退回 null、刪 `team_memberships`、再刪 `teams`,三步驟包在同一 transaction,不會留下孤兒 membership —— 設計註解(`server/db.ts:4350-4351`)明確說明這是刻意補的清理邏輯。
2. 單一 Orb 對話刪除(`server/routers/orbConversationsRouter.ts:304-341`)正確地先刪 `orb_conversation_messages` 再刪 `orb_conversations`,且用 `userId` 做擁有權雙重檢查 —— 只是這條正確邏輯沒有被帳號整體刪除路徑複用(見上文第 2 點)。
3. `creativeProject.delete`(`server/routers/creativeProject.ts:265-279`)、`teachingArchive.delete`(`server/routers/teachingArchive.ts:364-378`)、`assets` 與 `promptLibrary` 對應刪除端點,都會呼叫 `db.deleteAllSharesForResource(...)` 清 `resource_shares`,涵蓋 `resourceType` 支援的全部 4 種資源(project/asset/prompt/material,見 `drizzle/schema.ts:4437-4442`),個別刪除路徑本身沒有遺漏 —— 缺口只在「帳號整體刪除」沒有複用這段邏輯(見上文第 1 點)。
4. `background_jobs`(`drizzle/schema.ts:286-328`)本身不含 project/storyboard 等交叉引用欄位,純粹按 `userId` 掛勾,且在 `USER_OWNED_TABLES` 內,帳號刪除可以完整清空,無孤兒風險。
5. `teaching_material_access_log`、`model_training_consents`、`digital_asset_library`、`fine_tuned_models` 等表都正確地被列在 `USER_OWNED_TABLES` 內,單就「以 userId 為準的帳號刪除」而言涵蓋率高(102 表中僅前述約 10 張表有遺漏)。

## 統計摘要

- 掃描 102 張表,找出 **10 張** 帶 `userId`/`user_id` 欄位卻不在 `USER_OWNED_TABLES` 清單內的表:`consistency_vault`、`agent_dlq`、`orb_conversation_messages`、`studio_versions`、`orb_workflow_template_ratings`、`timeline_frames`、`scene_compositions`、`video_analytics`(nullable,設計上部分合理)。
- 七個主要實體的個別刪除路徑(project/team/model/storyboard/世界觀/教材)裡,**每一個都至少有一項子表未被清理**,只有 `teams` 與 `resource_shares`(在個別資源刪除層級)有做對一部分。
- `project_snapshots` 因缺少 `userId` 欄位,是目前唯一「即使日後想補救也無法單靠 userId 掃描」的孤兒來源,建議優先處理。
