# DI2 — 帳號刪除的 PII 殘留
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:profile.deleteAccount + db 刪除鏈 + 各含 userId/PII 的表

## 方法

1. 讀 `server/routers/profile.ts:29-34`(`deleteAccount` mutation)→ `server/db.ts:5296-5395`(`USER_OWNED_TABLES` 陣列 + `deleteUserAccount()`)→ `server/_core/DatabaseManager.ts:347-372`(`executeTransaction` 的 commit/rollback 語意)。
2. 用腳本解析 `drizzle/schema.ts` 全部 102 張 `mysqlTable(...)` 定義,取出每張表的實際 SQL 表名與欄位字面量(注意:drizzle 的 JS 屬性名不等於 SQL 欄位名,例如 `userId: int("user_id")` 底層欄位其實是 `user_id`)。
3. 把 `USER_OWNED_TABLES`(69 個表名字串)逐一對照 schema:是否存在同名表、是否有可用 `WHERE userId = ?` 命中的欄位。
4. 找出 schema 中**含 `userId`/`ownerId`/`createdBy`/`sharedWithId` 等使用者關聯欄位、但不在 `USER_OWNED_TABLES` 內**的表,並逐一讀對應 db.ts / router 的寫入路徑確認欄位確實承載真實使用者資料(非死代碼)。
5. 對「已知」項目(W9 硬刪兩段式安全閥、PS-09 storyboardId 共用、RC-rbac 分享/轉移競態、RC/EH 分享獎勵旗標無唯一約束)只確認仍成立,不重覆分析。

---

## 發現(按嚴重度排序)

### 🔴 P0 — `deleteUserAccount` 現狀 100% 會拋錯、整個刪除交易全部回滾(GDPR 刪除端點完全不能用)

- **檔案:行號**:`server/db.ts:5300-5370`(`USER_OWNED_TABLES` 陣列)、`server/db.ts:5379-5395`(`deleteUserAccount`)、`server/_core/DatabaseManager.ts:359-372`(`executeTransaction` 出錯即 `rollback()`)、`server/routers/profile.ts:29-34`(呼叫端)。
- **問題**:`deleteUserAccount` 對 `USER_OWNED_TABLES` 陣列裡的 69 個表名依序執行 `DELETE FROM \`${table}\` WHERE userId = ?`,全部包在同一個交易裡,`SET FOREIGN_KEY_CHECKS=0/1` 只是關閉 FK 檢查、**不影響「欄位是否存在」的 SQL 解析**。逐表核對 schema.ts 後,陣列中至少 **11 個表名根本沒有 `userId` 欄位**:

  | # | 陣列順序 | 表名 | schema.ts 實際欄位(節錄) | 行號 |
  |---|---|---|---|---|
  | 1 | 第 26 個(**最先炸的一個**) | `prompt_assets` | `id, promptId, assetId, relation, createdAt`(無 userId,靠 `prompt_library` 間接歸屬) | `drizzle/schema.ts:1820-1830` |
  | 2 | 第 28 個 | `external_service_subscriptions` | 廠商訂閱設定表(`ownerEmail` 是廠商聯絡信箱,非使用者 PII) | `drizzle/schema.ts:1919-1940` |
  | 3 | 第 32 個 | `cost_aggregations` | 純聚合統計,無 userId | `drizzle/schema.ts:2111-2159` |
  | 4 | 第 33 個 | `cost_ledger` | 有 `refId`/`accountKey` 但無 `userId` | `drizzle/schema.ts:2159-2230` |
  | 5 | 第 34 個 | `cost_attribution_outbox` | outbox 表,無 userId | `drizzle/schema.ts:2230-2262` |
  | 6 | 第 35 個 | `alert_configs` | 全站告警設定,無 userId | `drizzle/schema.ts:2279-2303` |
  | 7 | 第 37 個 | `fine_tuned_model_consents` | 靠 `modelId`/`consentId`,無 userId | `drizzle/schema.ts:2414-2434` |
  | 8 | 第 48 個 | `orb_spirit_collaboration_metrics` | Spirit 對 Spirit 統計,無 userId | `drizzle/schema.ts:3310-3343` |
  | 9 | 第 50 個 | `orb_system_alerts` | 全站系統健康告警,無 userId,且陣列旁自帶註解承認「MySQL legacy name;Supabase prod table is `system_alerts`」— 即使欄位問題修好,prod 環境表名也對不上 | `drizzle/schema.ts:3418-3436`、`server/db.ts:5350` |
  | 10 | 第 56 個 | `data_source_connections` | 欄位是 `ownerUserId`,不是 `userId` | `drizzle/schema.ts:3889-3941` |
  | 11 | 第 58 個 | `real_earth_entries` | 欄位是 `createdBy`,不是 `userId` | `drizzle/schema.ts:4244-4357` |

  陣列是依序執行、**同一個交易**,第一個炸掉的是**第 26 個** `prompt_assets`(`Unknown column 'userId' in 'where clause'`,MySQL 1054)。`DatabaseManager.executeTransaction` 的 `catch` 區塊會對這個連線呼叫 `rollback()` 再把錯誤往上拋(`_core/DatabaseManager.ts:366-372`),所以：
  - 前 25 個表(含 `login_history`、`password_reset_tokens`、`digital_asset_library`、`user_google_oauth_tokens` 等高敏感資料)**即使刪除語句本身沒問題也會被回滾**,一筆都留不掉。
  - 最後一行 `DELETE FROM users WHERE id = ?`(`server/db.ts:5390`)**永遠執行不到**——使用者本人的 `users` 列(email、name…)也刪不掉。
  - `profileRouter.deleteAccount`(`server/routers/profile.ts:29-34`)直接把這個錯誤往外拋,前端 `AccountSettingsPage.tsx:74-78, 643-645` 正確顯示「刪除失敗,請稍後再試」——**沒有假成功**(見下方「已正確處理」),但使用者永遠無法完成 GDPR 被遺忘權請求。
- **cluster**:`logical-fk-unvalidated`(準確地說是「清理清單與 schema 實際欄位不同步,無守門測試」)+ 直接後果是**全表殘留**。
- **影響**:GDPR「被遺忘權」端點目前是 100% 不可用的裝飾品——不是「殘留一部分」,而是**連使用者自己的帳號都刪不掉**,任何 PII(email、上傳圖片、對話紀錄、教材、回饋)全部原封不動留在 DB。這是本次稽核所有下游殘留問題的根因,必須最優先修。
- **建議**:
  1. 立刻把 11 個「無 userId 欄位」的表名從 `USER_OWNED_TABLES` 移除(它們本就不含該使用者專屬資料,留著只會讓交易炸掉)。
  2. 加一支像既有 migration journal 那樣的守門測試(例如對 `information_schema.COLUMNS` 或 drizzle schema 做程式化比對),斷言 `USER_OWNED_TABLES` 每一項都對應 schema 裡「確實存在且欄位字面量是 `userId`」的表,avoid 這份清單與 schema 再次漂移。
  3. 修正 `orb_system_alerts` 的 prod 表名疑慮(確認 Supabase/MySQL 實際生產表名一致)。

---

### 🟠 P1 — `orb_conversation_messages`(光球對話逐則內容)完全不在清單內,對話文字永久殘留

- **檔案:行號**:schema `drizzle/schema.ts:2737-2763`(`userId: int("user_id")`,`text: text("text").notNull()`);寫入路徑 `server/routers/orbConversationsRouter.ts:463`(`db.insert(orbConversationMessages).values(rows)`);父表 `orb_conversations` 有在 `USER_OWNED_TABLES`(`server/db.ts:5339`),但子表 `orb_conversation_messages` 沒有。
- **問題**:父表 `orb_conversations` 若刪除鏈修好會被清掉,但每一則對話訊息(`role`/`text`/`metadata`,即使用者實際輸入與光球回覆的逐字內容)存在獨立子表 `orb_conversation_messages`,鍵是 `conversationId`(非直接靠 FK),完全沒被 `USER_OWNED_TABLES` 涵蓋。且此表的 `userId` 底層欄位字面量是 `user_id`(snake_case),與清單裡多數表用的 `userId`(camelCase 字面量)不同——就算有人手動把表名加進清單,現有的 `DELETE FROM \`orb_conversation_messages\` WHERE userId = ?` 寫法一樣會因欄位名不符而報錯。
- **cluster**:`gdpr-residue`(對話內容,屬使用者最私密的資料類型之一)。
- **影響**:使用者刪除帳號後,他與光球的全部對話逐字記錄(可能包含情緒/心理諮商相關高敏感內容,對應本站「療癒工作室」的產品定位)永久留在 DB,只是失去可見的 `orb_conversations` 父列。
- **建議**:把 `orb_conversation_messages` 加入清理鏈,且刪除語句需用實際欄位名 `user_id`(或改用 drizzle query builder 而非原始字串拼接表名,避免欄位名大小寫/命名風格不一致的坑)。

---

### 🟠 P1 — `consistency_vault`(角色/場景一致性圖庫)不在清單內,圖片與檔案 key 殘留

- **檔案:行號**:schema `drizzle/schema.ts:719-740`(`userId`、`imageUrl`、`fileKey` 皆 not null);讀寫路徑 `server/db.ts:2305`(insert)、`:2325-2345`(依 userId 查詢)、`:2363`(單筆刪除,僅供使用者自行刪單筆用,非帳號刪除鏈的一部分)。
- **問題**:此表存的是使用者上傳/生成的角色與場景參照圖(`imageUrl`/`fileKey` 指向實際儲存物件),完全不在 `USER_OWNED_TABLES`。
- **cluster**:`gdpr-residue`(上傳內容)。
- **影響**:帳號刪除後,使用者的一致性圖庫圖片仍完整可查詢(只要知道 DB 主鍵或透過其他仍存在的關聯表誤連過去),且底層儲存物件也不會被清(見下一條)。
- **建議**:加入清理鏈;同時比照 `digital_asset_library` 的做法評估是否需要連動刪除底層儲存物件。

---

### 🟠 P1 — 帳號刪除完全不觸碰 R2/物件儲存,已上傳的實體檔案(圖片/影片/語音)永久殘留

- **檔案:行號**:`server/db.ts:5379-5395`(`deleteUserAccount` 全文只有 `DELETE FROM ... WHERE userId = ?` 的 SQL 迴圈,沒有任何呼叫 storage 層);對照真正會刪除物件儲存的程式碼只有 `server/signedUpload.ts:335-342`(`deleteUploadedObject`,僅用於 finalize 階段偵測到偽裝檔案時的補償刪除)與 `server/routers/assets.ts` / `server/jobs/assetCleanupJob.ts`(單一資產刪除與 TTL 清理走的路徑,即已知的 W9 兩段式安全閥,與帳號刪除是兩條互不相通的程式碼路徑)。
- **問題**:`digital_asset_library`、`consistency_vault`、`teaching_materials` 等表的 `fileUrl`/`fileKey`/`imageUrl` 欄位指向 R2 實體物件(`drizzle/schema.ts:346-347`、`:726-727`)。`deleteUserAccount` 就算把這些表的 DB 列刪乾淨,**也從未呼叫任何 R2 `DeleteObjectCommand`**——已上傳的圖片、影片、語音檔案本體會永久留在儲存桶內,只是 DB 裡找不到指向它們的列(孤兒物件,無法再靠應用層清掉,因為連指標都沒了)。
- **cluster**:`gdpr-residue`(上傳內容,且是「即使 DB 層修好也還殘留」的獨立問題)。
- **影響**:即使把 P0 的交易崩潰修好、把 P1 的表都補進清理鏈,使用者實際上傳/生成的檔案本體依然違反被遺忘權承諾地留在儲存服務中。這是純資料庫稽核容易漏掉、但 GDPR 稽核必查的一類殘留。
- **建議**:`deleteUserAccount` 執行 DB 刪除**之前**,先查出該使用者名下所有 `fileKey`(含 `digital_asset_library`、`consistency_vault`、未來新增的任何含檔案欄位的表),批次呼叫 R2 刪除,並比照 `countOtherDigitalAssetsByFileKey`(`server/db.ts:1567-1584`)的邏輯避免誤刪其他使用者仍共用的同一個 `fileKey`(公開回收/團隊共享複製)。

---

### 🟡 P2 — `resource_shares`(跨使用者分享關係)不在清理鏈,分享者/被分享者刪帳號後關係列殘留

- **檔案:行號**:schema `drizzle/schema.ts:4432-4475`(`sharedWithId`、`sharedByUserId`,命名不符 `userId` 慣例);`USER_OWNED_TABLES` 完整清單 `server/db.ts:5300-5370` 內不含 `resource_shares`。
- **問題**:此表記錄「誰把什麼資源分享給誰」,兩個使用者關聯欄位都不叫 `userId`,因此連依「欄位字面比對」這種最簡單的自動化都抓不到這個缺口。分享者刪帳號後,`sharedByUserId` 變成指向不存在的使用者;被分享對象(`sharedWithType="user"`)刪帳號後,`sharedWithId` 一樣懸空。
- **cluster**:`gdpr-residue` + `orphan-on-delete`。
- **影響**:除了殘留分享者身分的稽核痕跡外,懸空的 `sharedWithId` 也可能造成分享清單顯示錯亂(顯示分享給一個已不存在的使用者)。此發現與既有 K3 報告 §1.3 提到的「第 11 張表」為同一張表,本次重新核對後確認截至目前仍未修。
- **建議**:比照 P1 加入清理鏈(依 `sharedByUserId = ?` 與 `sharedWithType='user' AND sharedWithId = ?` 兩個條件都要清)。

---

### 🟡 P2 — 多張「使用者直接產生內容」的表不在清理鏈:`studio_versions`、`timeline_frames`、`scene_compositions`、`orb_workflow_template_ratings`

- **檔案:行號**:
  - `studio_versions`(工作室版本歷史,`payload` 含完整生成參數/prompt/輸出網址):schema `drizzle/schema.ts:2806-2832`;寫入 `server/db.ts:2699`。
  - `timeline_frames`(分鏡幀圖片/標題/描述):schema `drizzle/schema.ts:3596-3629`(底層欄位是 `user_id`);寫入 `server/db.ts:3300`。
  - `scene_compositions`(場景合成畫布資料):schema `drizzle/schema.ts:3637-3664`(底層欄位是 `user_id`);寫入 `server/db.ts:3365`。
  - `orb_workflow_template_ratings`(對工作流範本的評分與**文字評論** `comment`):schema `drizzle/schema.ts:3278-3304`。
- **問題**:四張表都各自有真實寫入路徑與依 `userId` 查詢/刪除單筆的 API(使用者可自行刪單筆),但都不在 `USER_OWNED_TABLES`,帳號刪除不會清。其中 `timeline_frames`/`scene_compositions` 底層欄位是 `user_id`(snake_case),即使日後補進清單,也必須用正確欄位名,否則會重蹈 P0 的覆轍。
- **cluster**:`gdpr-residue`(上傳內容/生成紀錄/回饋文字)。
- **影響**:K3 報告先前已點名 vault 圖片、分鏡幀、場景合成、工作室版本歷史屬於「已知漏在清單外」的類別;本次逐表核對後確認這 4 張(加上前面 P1 的 `consistency_vault`)目前仍是完整殘留,並補上了具體 schema 行號與底層欄位名(`user_id` vs `userId`)這個先前未特別標注、但修復時容易再次踩雷的細節。
- **建議**:全部加入清理鏈;`timeline_frames`/`scene_compositions` 記得用 `user_id`。

---

### 🟡 P2 — 父表刪除鏈存在,但子表(協作訊息/步驟/交接紀錄)沒有對應清理,形成刪除後孤兒列(可能含 PII)

- **檔案:行號**:
  - 父表 `agent_collaboration_sessions` 在清單(`server/db.ts:5338`);子表 `agent_collaboration_steps`(`drizzle/schema.ts:2506-2547`,`toolArgs`/`stepResult` JSON)、`agent_collaboration_messages`(`drizzle/schema.ts:2554-2588`,`content` JSON)、`agent_collaboration_handoffs`(`drizzle/schema.ts:2595-`,`contextTransferred` JSON)都只靠字串 `collaborationId` 關聯,不在清單。
  - 父表 `orb_workflow_executions` 在清單(`server/db.ts:5347`);子表 `orb_workflow_step_executions`(`drizzle/schema.ts:3228-3277`,`inputs`/`outputs`/`inputSnapshot` JSON,可能含使用者生成參數/prompt)只靠 `executionId` 關聯,不在清單。
  - 父表 `orb_long_term_memories` 在清單(`server/db.ts:5340`);`orb_memory_associations`(`drizzle/schema.ts:2890-2928`,`createdBy` 欄位)只靠 `fromMemoryId`/`toMemoryId` 關聯,不在清單。
- **問題**:帳號刪除鏈只刪了「有 userId 欄位的父表」,這些子表用的是「業務主鍵字串」(`collaborationId`/`executionId`/`fromMemoryId`)而非 `userId` 做關聯,天生不會被現行「依 userId 逐表刪」的機制掃到。父列刪除後,子列變成永久孤兒(懸空引用一個已不存在的 `collaborationId`/`executionId`/`memoryId`),且部分子表(`toolArgs`、`content`、`inputs`/`outputs`)以 JSON 儲存,可能內嵌使用者的實際 prompt/生成參數。
- **cluster**:`orphan-on-delete` + `json-embedded-ref`(JSON 內存的業務 id 在父列刪除後完整性無法驗證)。
- **影響**:即使把 P0/P1 都修好,這批子表仍會在帳號刪除後留下無主孤兒列;因為關聯鍵不是 `userId`,現行清理機制的簡單模式(依表名硬編 `userId` 欄位刪)完全無法覆蓋,需要額外一輪「依父表 id 反查子表」的清理。
- **建議**:在刪除父表列**之前**先查出其 id 集合,對子表下 `DELETE ... WHERE collaborationId/executionId/fromMemoryId|toMemoryId IN (...)`;或改用真正的資料庫層 cascade(超出本次「不加 FK」的既定架構決策,至少可在應用層補一段顯式的子表清理函式並提供測試覆蓋)。

---

### 🟢 P3 — 擁有者/作者類欄位懸空,功能性孤兒但非直接 PII 外洩(orphan-on-delete,需留意但優先度較低)

- **`teams.ownerId`**(`drizzle/schema.ts:4146-4160`,`ownerId` 是必填、無轉移擁有權機制,schema 註解本身承認「轉移擁有權需另開 mutation,目前 hardcoded 建立者擁有」):team owner 刪帳號後,`teams` 列與其餘成員的 `team_memberships`(該表本身在清單內,但只會刪掉「正在刪帳號的這個使用者」的成員列,不會刪整個 team)會變成無主團隊,其他成員可能因此卡在一個沒有 owner 的團隊裡。屬功能性孤兒,非直接 PII 洩漏,但需要產品面決策(轉移 owner?停用 team?)。
- **`news_articles.authorUserId`**(`drizzle/schema.ts:1129-`)、**`featured_showcase.curatorUserId`**(`drizzle/schema.ts:1202-`):後台管理員/策展人撰寫的公開內容,作者刪帳號後留下懸空作者引用。內容本身是站方公開發布內容而非該使用者的私人資料,PII 風險低,但建議至少在刪除時把該欄位設為 NULL 或系統帳號,避免顯示端對已刪除 id 做二次查詢時出錯。
- **`project_data_access_rules.createdBy`**、**`orb_memory_associations.createdBy`**:純稽核用建立者欄位,懸空後不影響功能,只影響「誰建立的」這條稽核線索,優先度最低。
- **cluster**:`orphan-on-delete`。
- **影響**:主要是資料完整性/功能性問題,PII 曝光風險相對本報告其他項目低,建議排在 P0-P2 之後處理。

---

### 🔵 附帶觀察(非本次核心範圍,僅記錄以防後續稽核重覆發現)

- **`exportUserData()`**(`server/db.ts:5403-5464`)只匯出 4 類資料(`profile`/`generationRows`/`loginRows`/`assetRows`),完全沒有涵蓋本報告點名的任何一張殘留表(對話訊息、vault 圖片、教材、回饋、分鏡幀…)。這是 GDPR 資料可攜權(Article 15/20)的匯出完整性問題,與本報告的「刪除殘留」是同一份「意圖 vs 實作」漂移的兩種症狀,建議與 P0-P2 的清理鏈修復一併處理(理想上兩者共用同一份「使用者所有資料表」清單來源)。

---

## 已正確清理 / 已有約束(negative results)

1. **高敏感驗證/授權類資料表已正確納入清單且欄位字面量正確可執行**:`login_history`(IP/裝置指紋,`drizzle/schema.ts:255-280`)、`password_reset_tokens`、`email_verification_tokens`、`refresh_tokens`、`user_google_oauth_tokens`(OAuth token)、`api_keys`——只要 P0 的交易崩潰修好,這幾張表本身的刪除語句是可以正確執行的(欄位字面量確實是 `userId` 且表名存在)。
2. **前端沒有「假成功」問題**:`client/src/pages/AccountSettingsPage.tsx:74-78`(`onSuccess` 才 `window.location.replace("/")`)與 `:643-645`(`deleteAccountMutation.isError` 時顯示「刪除失敗,請稍後再試」)——目前的失敗(P0)會被正確地攔下並提示使用者,不是靜默失敗或假裝成功導致使用者誤以為資料已刪除。這點與其他模組常見的 `EH4 false-success` 模式不同,值得肯定。
3. **`SET FOREIGN_KEY_CHECKS` 只作用於單一連線、且用 `finally` 保證還原**(`server/db.ts:5382-5393`):不會洩漏成全域關閉,設計本身沒有問題,問題出在「關 FK 檢查」解決不了「欄位根本不存在」這種語法層錯誤。
4. **`teaching_materials` / `teaching_material_access_log`**(教材與教材存取記錄)、**`user_feedback_reports`**(使用者回饋)、**`generation_history`**(含 `prompt` 欄位的生成紀錄)均已正確納入 `USER_OWNED_TABLES` 且欄位可用,是本次核對中少數「設計意圖與實作一致」的一批表。
5. 依題目指示確認以下項目**仍然成立、本次不重複分析**:`deleteDigitalAsset` 硬刪的兩段式安全閥(W9)、`creativeProject.duplicate` 共用 `storyboardId`(PS-09)、share/transfer 競態(RC-rbac)、分享獎勵旗標無唯一約束(RC/EH)。

---

## 修復優先順序建議

1. **P0 立即修**:清掉 `USER_OWNED_TABLES` 裡 11 個沒有 `userId` 欄位的表名(或改成正確欄位/邏輯),讓交易不再必炸,並補一支自動化守門測試比對「陣列 vs schema 實際欄位」,避免清單再次與 schema 漂移。
2. **P1 本批修**:補進 `orb_conversation_messages`(注意底層欄位是 `user_id`)、`consistency_vault`、以及 R2 實體物件清理(在 DB 刪除前先收集 `fileKey` 並呼叫儲存層刪除,同時比照 `countOtherDigitalAssetsByFileKey` 避免誤刪共用物件)。
3. **P2 排入下一輪**:`resource_shares`(雙欄位)、`studio_versions`/`timeline_frames`/`scene_compositions`/`orb_workflow_template_ratings`,以及子表孤兒問題(`agent_collaboration_*`、`orb_workflow_step_executions`、`orb_memory_associations`)——這批需要「先查父表 id 集合、再清子表」的兩段式邏輯,不是簡單加表名就能解決。
4. **P3 排在功能修復而非資料外洩風險**:`teams.ownerId` 等擁有者欄位懸空,建議與「team 擁有權轉移」功能一起設計。
5. **一併檢討**:`exportUserData()` 的匯出完整性,理想上與刪除清理共用同一份「使用者所有資料表」的權威清單,避免兩套機制各自維護、各自漂移。
