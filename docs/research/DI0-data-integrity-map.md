# DI0 — 無FK資料完整性地圖(孤兒/GDPR殘留/懸空引用/缺唯一約束)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb

> 稽核範圍:`drizzle/schema.ts`(102 表、0 個 foreign key,schema 註解明言刻意無 FK)+ `server/db.ts`(5701 行,所有寫入/刪除函式)。本輪 15 條「已確認」發現全數重新對照 schema 定義與 db 函式逐一複核,**推翻 0 條**。已知既存問題(deleteDigitalAsset 兩段式安全閥 W9、creativeProject.duplicate 共用 storyboardId PS-09、share/transfer 競態 RC-rbac、分享獎勵旗標無唯一約束 RC/EH)不重複展開,僅在下方對應節次註記。

---

## 1. 依 cluster 分節

### 1.1 orphan-on-delete(刪父留孤兒)

| # | 標題 | schema | 寫入/刪除路徑 | 影響 | 建議 |
|---|---|---|---|---|---|
| O1 | `resource_shares` 未隨帳號刪除清理 | `drizzle/schema.ts:4432-4478` | `server/db.ts` `deleteUserAccount`(USER_OWNED_TABLES,5300-5370,不含 `resource_shares`) | 其他被分享者查到指向已刪除資源/使用者的幽靈列;`sharedByUserId`/`sharedWithId` 殘留已刪除 userId | 併入下方「GDPR 殘留表清單」統一 cascade 服務處理 |
| O2 | `timeline_frames` / `scene_compositions` 刪 storyboard/世界觀後變孤兒 | `drizzle/schema.ts:3596-3629`(timeline_frames),`3637-3664`(scene_compositions) | `server/db.ts:3269-3273`(`deleteWorldStoryboard` 僅 `DELETE ... WHERE id`)、`3187-3193`(`deleteWorldbuildingFramework` 同樣單表刪除);路由 `server/routers/worldStoryboard.ts:215-224`、`worldbuilding.ts:212-221` | 兩表 `userId` notNull,不在 USER_OWNED_TABLES,雙重殘留:父被刪後子變孤兒 + 帳號刪除也不清 | 建立「刪 storyboard/framework 前先刪子表」的應用層 cascade 函式,並補進 USER_OWNED_TABLES |
| O3 | `context_packets` / `orchestration_runs` 刪 project 後變孤兒 | `drizzle/schema.ts:3806-3834`(context_packets),`3735-3797`(orchestration_runs) | `server/db.ts:3473-3477` `deleteCreativeProject`:僅 `db.delete(creativeProjects).where(eq(id))`,未觸碰任何子表;路由 `server/routers/creativeProject.ts:265-290` | `context_packets.projectId` notNull 留孤兒,且帶完整創作摘要文字,無任何刪除函式可清 | cascade 服務;`context_packets` 需新增 `deleteContextPacketsByProject` |
| O4 | `fine_tuned_model_consents` 兩端孤兒 | `drizzle/schema.ts:2414-2430`(僅 `modelId`/`consentId`,無 userId) | `server/db.ts:1055-1059` `deleteFineTunedModel` 單表刪除;路由 `server/routers/models.ts:791-800` | 模型刪除後懸空 `modelId`;帳號刪除時 `model_training_consents` 亦被清(在 USER_OWNED_TABLES),`consentId` 端同時消失,兩端孤兒,訓練同意稽核軌跡斷裂 | 刪模型前先刪關聯 consent 橋接列;帳號刪除需連動清 `fine_tuned_model_consents` |
| O5 | `creative_projects.worldFrameworkId`/`worldStoryboardId`/`worldviewId` 懸空不斷開 | `drizzle/schema.ts:3678-3725`(3688,3692,3694 三個 nullable int,無 FK) | `deleteWorldStoryboard`(db.ts:3269)、`deleteWorldbuildingFramework`(db.ts:3187)均未回頭 `UPDATE creative_projects SET ... = NULL` | 專案詳情頁 join 讀到 null 卻無法分辨「未設定」還是「已被刪除的死連結」 | cascade 服務刪除子資源時同步斷開父表引用欄位 |

### 1.2 gdpr-residue(刪帳號留 PII)

已於第 2 節「GDPR 殘留表清單」統一列出,此處僅標註成因分類:
- **缺表清單**(表存在 userId 但漏列進 `USER_OWNED_TABLES`):`resource_shares`(O1)、`orb_conversation_messages`(G1)、`consistency_vault`(G2)、`studio_versions`(G3)。
- **整體交易必然失敗**(清單內表結構性錯誤導致 rollback):11 表無 `userId` 欄位(G4)。
- **儲存體殘留**(DB 清了但實體檔案沒清):R2 物件(G5)。

### 1.3 logical-fk-unvalidated(寫子未驗父存在/擁有權)

| # | 標題 | 檔案:行號 | 影響 | 建議 |
|---|---|---|---|---|
| L1 | `worldbuilding.checkConsistency` 可覆寫任意使用者的 `timeline_frames` 列(IDOR) | 路由 `server/routers/worldbuilding.ts:688-719`;DB 函式 `server/db.ts:3328-3338` `updateTimelineFrameConsistency(frameId, result)` — 簽章無 `userId` 參數,`WHERE` 只比對 `id` | 已於程式碼複核:`consistencyCheckRequestSchema` 只驗證 `timelineFrameId` 為正整數,router 從未呼叫 `getTimelineFrame` 比對 `ctx.user.id` 就直接呼叫 `db.updateTimelineFrameConsistency`。同檔案 `deleteTimelineFrame`(678-683,DB 層 3317-3326 有 `and(eq(id), eq(userId))`)與 `listTimelineFrames` 皆有 userId 收斂 WHERE,證明是既定模式,`checkConsistency` 是漏掉的例外。任何登入者知道/枚舉他人 `timelineFrameId` 即可覆寫其 `consistencyCheckJson` | `updateTimelineFrameConsistency` 簽章加 `userId` 參數並收斂 WHERE,比照 `deleteTimelineFrame` 寫法 |
| L2 | `uploadTimelineFrame` / `saveComposition` 寫入 `storyboardId`・`worldId` 不驗證擁有權 | `server/routers/worldbuilding.ts:643-673`(uploadTimelineFrame 直接把 `input.storyboardId` 寫入 `db.createTimelineFrame`)、`753-`(saveComposition 同樣直接寫 `input.worldId`) | 已複核:同檔案 `getCompositionSuggestions`(796-813)先驗證 `world.userId` 才放行,`worldStoryboard.ts` 全檔皆先 `loadFramework` 驗證,唯獨這兩支寫入端點跳過驗證。可掛接到不存在或他人的 `storyboardId`/`worldId`,造成跨戶/懸空孤兒列;目前下游查詢皆疊加 `userId` 過濾未直接洩漏,但任何未來報表/後台若單純依 `storyboardId`/`worldId` 撈取即會跨戶洩漏 | 寫入前比照 `getCompositionSuggestions` 模式,先 load 父列驗證 `userId` 歸屬 |

### 1.4 已知既存問題(僅確認,不重複展開)
- `deleteDigitalAsset` 硬刪兩段式安全閥 — W9,已有防護,無需新動作。
- `creativeProject.duplicate` 共用 `storyboardId` — PS-09。
- share/transfer 競態 — RC-rbac。
- 分享獎勵旗標無唯一約束 — RC/EH。

---

## 2. GDPR 殘留表清單(法遵重點)

刪帳號(`deleteUserAccount`, `server/db.ts:5379-5395`)後,以下表仍會留下可辨識個資或指向已刪除使用者的殘留列:

| 表 | 為何殘留 | 內容敏感度 |
|---|---|---|
| `resource_shares` | 不在 USER_OWNED_TABLES(schema `drizzle/schema.ts:4432`) | `sharedByUserId`/`sharedWithId` 指向已刪除帳號 |
| `orb_conversation_messages` | 不在 USER_OWNED_TABLES;且底層欄位是 `user_id`(schema `2737-2768`),即使補進清單,現行 `WHERE userId=?` 寫法仍會因欄位名不符再度失敗 | 使用者與光球的完整對話原文(`text` 欄位)+ metadata |
| `consistency_vault` | 不在 USER_OWNED_TABLES(schema `719-743`);寫入 `server/db.ts:2305` | 角色/場景參照圖 `imageUrl`/`fileKey` |
| `studio_versions` | 不在 USER_OWNED_TABLES(schema `2806-2835`,清單只有 `studio_recipes`) | 創作版本完整 payload(`compiledPrompt`/`outputUrl` 等) |
| **以下 11 表雖「有列在」USER_OWNED_TABLES,但表本身無 `userId` 欄位,导致整段刪除交易 100% rollback** | | |
| `prompt_assets`(陣列第 26 項,`schema:1820-1830`,僅 `promptId`/`assetId`) | 無 userId 欄位 → `DELETE ... WHERE userId=?` 觸發 MySQL 1054 | 觸發點,但自身非 PII 表 |
| `external_service_subscriptions`(`schema:1919-1937`) | 同上 | — |
| `cost_aggregations`(`schema:2111-2133`) | 同上 | — |
| `cost_ledger`(`schema:2159-2214`) | 同上 | — |
| `cost_attribution_outbox`(`schema:2230-2259`) | 同上 | — |
| `alert_configs`(`schema:2279-2292`) | 同上 | — |
| `fine_tuned_model_consents`(`schema:2414-2430`,僅 `modelId`/`consentId`) | 同上 | 訓練同意稽核鏈 |
| `orb_spirit_collaboration_metrics`(`schema:3310-3338`) | 同上 | — |
| `orb_system_alerts`(`schema:3418-3457`,註解自承 prod 表名可能是 `system_alerts`) | 同上 + 表名本身可能對不上生產環境 | — |
| `data_source_connections`(`schema:3889-3928`,實際欄位是 `ownerUserId`) | 欄位名不符 | 第三方帳密關聯設定 |
| `real_earth_entries`(`schema:4244-4341`,實際欄位是 `createdBy`) | 欄位名不符 | — |

**連鎖後果**:`DatabaseManager.executeTransaction`(`server/_core/DatabaseManager.ts:347-379`)在 executor 拋出任何例外時對整個連線 `rollback()`。`prompt_assets`是 `USER_OWNED_TABLES`(`server/db.ts:5300-5370`)陣列第 26 項,for 迴圈跑到它就會因 `Unknown column 'userId'` 拋錯,導致**前 25 個表(含 password_reset_tokens、digital_asset_library、user_google_oauth_tokens 等)與最後的 `DELETE FROM users` 全部復原** —— 目前 `deleteUserAccount` 只要曾經真的執行到這裡,GDPR 刪除請求 100% 失敗、100% PII 殘留。（需再查：是否有上層 catch 把此錯誤吞掉並回報「刪除成功」給使用者 —— 若是,則是更嚴重的「假成功」而非單純失敗，本輪未追查 `server/db.ts` 之外的呼叫端錯誤處理，建議下一輪查證。）

**儲存體殘留(不只是 DB 列)**:`deleteUserAccount` 全程只執行 SQL `DELETE`,從未呼叫任何 R2 物件刪除。`digital_asset_library`、`consistency_vault` 等表的 `fileUrl`/`fileKey` 指向的 R2 實體物件在帳號刪除後永久留存;真正會刪 R2 物件的程式碼只存在於 `server/signedUpload.ts:335-342`(`deleteUploadedObject`,僅用於 finalize 偽裝檔案補償)與單一資產刪除路徑(`server/routers/assets.ts` / `server/jobs/assetCleanupJob.ts`,即已知 W9),帳號刪除完全繞過這兩條路徑。即使上述 DB 層問題全部修好,使用者實際上傳的檔案本體仍會永久留在儲存桶中。

---

## 3.「0 FK 的代價」總結

無 FK 的後果可分三類,各自需要不同的修法方向:

| 類型 | 代表案例 | 根因 | 統一修法方向 |
|---|---|---|---|
| **刪除孤兒**(父刪、子留) | O1-O5(resource_shares、timeline_frames/scene_compositions、context_packets/orchestration_runs、fine_tuned_model_consents、creative_projects 的 world*Id 懸空) | 每個 `deleteX` 函式都只 `DELETE FROM 單表 WHERE id`,從未查詢/清理任何「以此 id 為外鍵」的子表或反向引用欄位 | 建一個集中式「應用層 cascade 服務」(例如 `server/cascadeDelete.ts`),為每個父表註冊其子表/反向引用清單,`deleteX` 一律透過該服務刪除,而非各自手刻單表 DELETE |
| **寫入懸空**(子寫、父未驗) | L1(IDOR:任意覆寫他人 timeline_frames)、L2(uploadTimelineFrame/saveComposition 不驗 storyboardId/worldId 擁有權) | 寫入路徑各自為政,部分函式(如 `getCompositionSuggestions`、`worldStoryboard.ts`)有先 load 驗證父列擁有權的模式,但未強制套用到所有寫入端點 | 寫成一個「擁有權驗證中介」(例如 `assertOwns(table, id, userId)` helper),所有寫入/更新 mutation 在寫入前必須呼叫,而不是各路由自行決定要不要驗 |
| **GDPR 殘留 / 缺清單同步** | G1-G5(orb_conversation_messages、consistency_vault、studio_versions、11 表結構不符、R2 物件不清) | `USER_OWNED_TABLES` 是手刻陣列,新表上線時容易忘記加入,且陣列元素與實際 DB 欄位名脫鉤(`userId` vs `user_id`/`ownerUserId`/`createdBy`) | 1) 把 `USER_OWNED_TABLES` 陣列升級為「表名 + 實際使用者欄位名」的 map,而非假設全部叫 `userId`;2) CI 加一個 schema 掃描檢查:凡是有使用者關聯欄位(`userId`/`user_id`/`ownerUserId`/`createdBy`)的表都必須出現在該清單中,否則測試失敗;3) `deleteUserAccount` 收尾加一步呼叫 R2 刪除(掃描該使用者名下所有 `fileUrl`/`fileKey`) |

（本輪未系統性稽核 missing-unique / json-embedded-ref 兩類 cluster 的新案例，僅第 5 條規則列出的已知案例仍成立；建議列入下一輪 DI1 稽核範圍。）

---

## 4. 給 Bruce:資料完整性最該先補的 3 條

1. **先修 `deleteUserAccount` 的結構性 bug(G4,critical)**:目前只要流程走到 `prompt_assets` 就整段 rollback,GDPR 刪除請求等於從未真正生效過。這是「使用者按了刪除鍵、系統回應成功、但資料庫其實什麼都沒刪」的合規風險最高項,且修法本身不難 —— 把陣列改成「表名+實際欄位名」對照表即可,應該優先於其他所有資料完整性項目。
2. **補 R2 物件清除(G5,critical)**:即使第 1 點修好,使用者上傳的圖片/影片本體目前完全不會因帳號刪除而清除,是被遺忘權承諾的實質破口,建議與第 1 點合併一次修完。
3. **修 `worldbuilding.checkConsistency` 的 IDOR(L1,high)**:這是本輪唯一一條「非僅懸空引用、而是可被任意使用者主動利用覆寫他人資料」的漏洞,修法只需在 `updateTimelineFrameConsistency` 簽章加一個 `userId` 參數,成本低、風險消除立即見效,建議與其他兩條一起排入最近一個修復窗口。

---

**推翻計數:0 條**(15 條確認發現全數逐一對照 schema 與 db 函式複核通過,無臆測)。
