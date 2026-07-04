# DI4 — 缺唯一約束 + JSON 內嵌引用完整性
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:drizzle/schema.ts 的 uniqueIndex 覆蓋 + JSON 欄位內存的 id/ref

## 方法

- 對 `drizzle/schema.ts` 全檔 grep `uniqueIndex`,102 張表裡只有 **18 個** uniqueIndex/`.unique()` 宣告(含 users.openId、team_memberships、resource_shares、prompt_assets、prompt_collection、cost_ledger、cost_attribution_outbox、refresh_tokens、skill_registry、api_keys、user_google_oauth_tokens 等),逐一核對「本該唯一」的候選欄位是否在列。
- 對「json(...).\$type<number[]>() / \$type<string[]>()」等疑似跨表 id 陣列欄位逐一定位,回讀對應表的 `delete*` / `upsert*` 寫入函式(`server/db.ts`、對應 router),確認刪除父列時是否有清理引用方的 JSON 欄位。
- 每個發現都先讀 schema 定義行號,再讀寫入/刪除路徑,不臆測。

---

## 發現(按嚴重度排序)

### 1(高)— `users.email` 全表無 UNIQUE,OAuth 與本機密碼可各自造出同信箱的兩個帳號,`findByEmail` 用 `LIMIT 1` 無 `ORDER BY` 挑不確定的那一筆

**cluster**: missing-unique

**schema**:`drizzle/schema.ts:29`(`email: varchar("email", { length: 320 })`,可 null、無 `.unique()`)、`:69`(`emailIdx: index("users_email_idx")` —— 普通索引,非唯一)。對照 `:27`(`openId` 有 `.unique()`)、`:74`(`icsFeedToken` 有 `uniqueIndex`),email 明顯是被漏掉的一個。

**寫入路徑**:
- `server/db.ts:438-493`(`upsertUser`)—— Google OAuth 每次登入呼叫此函式,`onDuplicateKeyUpdate` 只鍵在 `openId`(Google `sub`)上,從不檢查 `email` 是否已被別的 `openId` 占用。`server/_core/oauth.ts:298-310` 附近的回呼直接把 `userInfo.sub` 當 `openId` 傳入,同樣不查 email。
- `server/repositories/mysql/UserAuthRepository.mysql.ts:21-31`(`findByEmail`)——`SELECT ... WHERE LOWER(email)=LOWER(?) LIMIT 1`,**沒有 `ORDER BY`**,MySQL 在有重複 email 時回傳哪一列不保證穩定。
- `server/services/auth/AuthFacade.ts` 內至少 6 處靠 `findByEmail` 做身分判斷:`:66`(註冊時判斷是否已存在)、`:158`(密碼登入)、`:279`(`findUserByEmail`,登入紀錄用)、`:294`(`requestPasswordReset`)、`:355`(`changePassword`)、`:392`(`updateProfile`)。

**具體可重現場景**:使用者 A 先用本機密碼註冊 `x@mail.com`(`registerWithPassword`,`openId = local:x@mail.com`,產生 row #1,有 `passwordHash`)。之後(同一人或另一操作者)用 Google 帳號登入,Google 回傳的 email 剛好也是 `x@mail.com` 但 `sub` 不同 —— `upsertUser` 只鍵在 `openId`,不會與 row #1 衝突,直接 INSERT 出 row #2(`openId=<google sub>`,`email=x@mail.com`,無 `passwordHash`)。此後任何 `findByEmail("x@mail.com")` 呼叫(密碼登入、忘記密碼、改密碼、改個人資料)都可能挑到 row #1 或 row #2 其中之一,行為不可預期 —— 密碼重設信可能寄去「還沒設密碼」的那個影子帳號並回應成功(該分支目前是 `if (!user || !user.passwordHash) return;` 靜默略過,不會出錯但也不會真的送信),使用者資料(名稱、頭像、配額)也可能分裂存在兩列。

**影響**:身分完整性喪失(同一信箱對應兩個互不相干的帳號),密碼重設 / 改密碼 / 改個資等安全敏感操作命中哪一列不可預測;長期看是帳號接管與客服排查的隱患。

**建議**:
1. 短期:`users` 補 `uniqueIndex` on `email`(需先跑一次資料清查腳本找出既有重複 email 並人工合併/決定保留哪列,否則 migration 會直接失敗)。
2. 中期:OAuth 回呼在 `upsertUser` 之前先用 email 查一次既有帳號(比照 `registerWithPassword` 的「先查後鏈接」邏輯),避免建立影子帳號;`findByEmail` 加 `ORDER BY passwordHash IS NULL, id ASC` 之類的確定性排序作為過渡防線。

---

### 2(中高)— `fine_tuned_models` 被硬刪時,`worldbuilding_frameworks.linkedModelIds`(JSON 內的模型 id 陣列)沒有任何清理,導演 AI 之後會拿到已刪除模型的 id

**cluster**: json-embedded-ref

**schema**:`drizzle/schema.ts:3492`(`linkedModelIds: json("linkedModelIds").$type<number[]>()`,註解明寫「連結到模型訓練中心的 fine_tuned_models.id 陣列」,`:3466-3467` 說明用途是「讓導演 AI 在生成圖像/影片時知道要套用哪個訓練模型」)。

**刪除路徑**:`server/db.ts:1055-1059`(`deleteFineTunedModel`)—— `await db.delete(fineTunedModels).where(eq(fineTunedModels.id, id))`,函式本體只有這一行,沒有查詢或更新任何其他表。全檔對 `linkedModelIds` 的唯一操作是讀(`server/routers/worldbuilding.ts:59,125,178-179,597`、`server/routers/worldStoryboard.ts:98`),`server/db.ts` 裡完全沒有寫入或清除 `linkedModelIds` 的程式碼(已用 grep 確認零匹配)。

**影響**:使用者刪除一個微調模型後,任何引用它的世界觀 framework 的 `linkedModelIds` 仍保留該 id;下次讀取 framework 並嘗試依 id 解析模型時(生成圖像/影片走 LoRA 套用邏輯),會拿到一個不存在的模型 id —— 輕則生成失敗、重則(視消費端是否做防呆)拋出未預期例外。由於此 JSON 陣列由使用者手動勾選(`worldbuilding.ts:125` 建立 / `:178-179` 更新),累積後也難以從 UI 端察覺哪些 id 已失效。

**建議**:
1. `deleteFineTunedModel` 改為交易:刪除前(或刪除後)用 `JSON_REMOVE`/應用層讀寫,把所有引用該 id 的 `worldbuilding_frameworks.linkedModelIds`(以及若 `charactersJson`/`scenesJson` 內個別角色場景也存了 `linkedModelId`,一併)過濾掉該 id。
2. 短期防線:消費端(生成前解析 `linkedModelIds` 對應模型)查無此 id 時應該靜默略過並提示使用者「原連結模型已刪除」,而非讓下游 API 呼叫失敗。

---

### 3(中)— `real_earth_entries` 被刪除時,`teaching_materials.realEarthRefs` 與其他條目的 `relatedEntryIds` 皆留下懸空 id;已有的「反查」函式並未接進刪除流程

**cluster**: json-embedded-ref

**schema**:`drizzle/schema.ts:4093`(`realEarthRefs: json("realEarthRefs").$type<number[]>()`,teaching_materials 表,註解「關聯的真實地球資訊條目 ID(用於深度連結)」)、`:4301`(`relatedEntryIds: json("relatedEntryIds").$type<string[]>()`,real_earth_entries 表自身的「相關條目 ID」,同表自我參照)。

**刪除路徑**:`server/db.ts:5120-5124`(`deleteRealEarthEntry`)—— 單純 `db.delete(realEarthEntries).where(eq(realEarthEntries.id, id))`。呼叫端 `server/routers/realEarth.ts:191-205`(`delete` mutation)在刪除前只做「存在性 + 擁有者/admin 權限」檢查(`:195-201`),完全沒有呼叫 `findTeachingMaterialsByRealEarthRef`(`server/db.ts:5192-5208`,用 `JSON_CONTAINS` 反查引用此 id 的教材)—— 該函式實際只在 `realEarth.ts:298` 的「查詢關聯教材」讀端點被使用,不在刪除路徑上起任何清理或阻擋作用。

**影響**:刪除一筆真實地球條目後,任何教材的 `realEarthRefs` 深度連結、以及其他真實地球條目的 `relatedEntryIds` 自我參照都會指向不存在的 id —— 前端「深度連結」功能會產生死連結;若前端沒有針對「查無此條目」做防呆,使用者點擊會看到錯誤或空白,而非優雅降級。

**建議**:
1. 刪除前用既有的 `findTeachingMaterialsByRealEarthRef(id)` 查出受影響教材,對其 `realEarthRefs` 做 `JSON_REMOVE` 式過濾(該函式已經寫好,只差沒接線,成本低)。
2. 同時對 `real_earth_entries.relatedEntryIds` 做一次全表 `JSON_CONTAINS` 掃描並移除該 id(或至少記錄一筆待清理稽核項)。
3. 過渡期:前端顯示深度連結前先確認目標條目仍存在,查無則以「條目已下架」取代死連結。

---

### 4(低中)— `fine_tuned_model_consents`(consent ↔ model 多對多 junction 表)缺 `(modelId, consentId)` UNIQUE,重試 / 雙擊可產生重複的法遵同意書連結

**cluster**: missing-unique

**schema**:`drizzle/schema.ts:4414-4426`—— 只有 `ftmc_modelId_idx`、`ftmc_consentId_idx` 兩個非唯一 index,沒有對 `(modelId, consentId)` 組合建 `uniqueIndex`。對照同檔其他 junction 表(`resource_shares` 的 `rs_resource_target_uk`、`team_memberships` 的 `tm_teamId_userId_uk`、`prompt_assets` 的 `pa_prompt_asset_rel_unique`)都有補這道防線,這張表是漏網之魚。

**寫入路徑**:`server/db.ts:1142-1154`(`linkConsentsToModel`)—— 直接把 `consentIds.map(...)` 組成陣列後一次 `insert`,呼叫前沒有查詢是否已存在同樣的 `(modelId, consentId)` 配對。呼叫端 `server/routers/models.ts:339-380` 在建立模型前**有**認真驗證每個 `consentId` 屬於目前使用者且未撤回/未過期(`:349-370`,ownership + `isConsentActive` 雙重檢查,做得不錯,不算 logical-fk-unvalidated 問題),但驗證通過後的 `db.linkConsentsToModel(modelId, input.consentIds)`(`:420`)本身若因前端重送 / 重試而被呼叫兩次,DB 層沒有任何東西擋下重複列。

**影響**:比起前三項,這裡的直接風險較低(`getConsentsForModel` 讀出的重複列不會授予額外權限),但這張表承載的是肖像權 / 版權同意書的法遵稽核記錄,重複列會讓「這個模型引用了幾份同意書」的稽核輸出失真,未來若有人依此表做合規報表會被誤導。

**建議**:`fine_tuned_model_consents` 加 `uniqueIndex("ftmc_model_consent_uk").on(table.modelId, table.consentId)`,`linkConsentsToModel` 改用 `insert(...).onDuplicateKeyUpdate({ set: { consentId: sql\`consentId\` } })`(no-op update)或先查重再插入。

---

### 5(低)— `block_combos.customBlockIds`(JSON id 陣列 → `custom_blocks.id`)刪除自訂區塊後留下懸空 id,但讀端已優雅降級

**cluster**: json-embedded-ref

**schema**:`drizzle/schema.ts:1038`(`customBlockIds: json("customBlockIds").$type<number[]>()`)。

**刪除路徑**:`server/db.ts:2561-2567`(`deleteCustomBlock`)—— 純刪除,不清理任何 `block_combos.customBlockIds`。

**影響**:使用者刪除一個自訂區塊後,先前存的組合(combo)預設裡仍保留該 id。但已核對讀取端 `client/src/components/ProgressivePromptBuilder.tsx:1397-1404` —— 套用 combo 時用 `customBlocksData?.find(b => b.id === id)`,找不到就靜默跳過(不加入 prompt、不拋錯),使用者只會覺得「這個 combo 套用出來比記憶中少了一塊」,不會當機。

**建議**:優先度低,可選擇性補:`deleteCustomBlock` 順手把所有 `block_combos.customBlockIds` 內含該 id 的組合更新掉(過濾陣列),或在 UI 顯示「此組合有 N 個區塊已失效」的提示,好過完全靜默。

---

## 已知案例(依任務指示只確認未重新展開)

- **RC/EH 分享獎勵旗標無唯一約束**:實際定位到 `fineTunedModels.configJson.shareRewarded`(`drizzle/schema.ts:439-459` 的 `configJson` 型別里)—— 這是 JSON key,天生不可能掛 DB UNIQUE,已由 `docs/research/RC3-toctou-reward-share.md:17-42` 的「發現 1」完整分析(check-then-act 競態、建議改用 `JSON_SET ... WHERE` CAS 或提升為獨立欄位)。本輪確認該分析仍與目前程式碼一致,不重複列。
- **PS-09 `creativeProjects.worldStoryboardId` 共用**:核對 `drizzle/schema.ts:3678-3725`,`creativeProjects.worldStoryboardId`(`:3694`)確實只有非唯一的 `cp_worldStoryboardId_idx`(`:3721-3723`),與 `docs/research/DI1-orphan-on-delete.md:138` 描述一致,不重複展開。
- **RC-rbac share/transfer 競態**:屬並行控制範疇,非本輪 missing-unique/json-ref 焦點,不重複列。
- **W9 `deleteDigitalAsset` 兩段式安全閥**:已由先前稽核確認與任務描述一致,不重複核對。

---

## 已正確清理 / 有約束的正向案例(negative results)

1. `resource_shares`(`drizzle/schema.ts:4432-4475`)—— `(resourceType, resourceId, sharedWithType, sharedWithId)` 有 `uniqueIndex`(`:4458-4463`),寫入端 `server/db.ts` 的 `upsertResourceShare` 用 `onDuplicateKeyUpdate` 冪等更新 role,不會產生重複份額列(細節見 `docs/research/RC3-toctou-reward-share.md:99-100`)。
2. `team_memberships`(`drizzle/schema.ts:4165-4193`)—— `(teamId, userId)` 有 `uniqueIndex`(`:4186-4189`,程式註解明講是為了防 race condition)。更進一步:`drizzle/0055_teaching_archive_fk.sql:25-40` 已用 `ALTER TABLE` 補上真正的 DB 層 FOREIGN KEY(`team_memberships.teamId → teams.id` CASCADE、`userId → users.id` CASCADE、`invitedBy → users.id` SET NULL)—— 雖然 `schema.ts` 本身不宣告 `.references()`,實際資料庫已有約束,「全站 0 FK」這個前提對這 4 張表(`teams`/`team_memberships`/`teaching_materials`/`teaching_material_access_log`)不完全成立。
3. `prompt_assets`(`drizzle/schema.ts:1820-1842`)—— `(promptId, assetId, relation)` 有 `uniqueIndex`(`:1836-1840`),且 `drizzle/0075_prompt_assets.sql:80-89` 額外補了雙向 `ON DELETE CASCADE` 的真實 FK(`promptId → prompt_library.id`、`assetId → digital_asset_library.id`),生成鏈重跑(webhook + polling 雙路徑)不會留孤兒關聯列。
4. `prompt_collection`(`drizzle/schema.ts:1852-1909`)—— `(userId, sourceType, sourceRef)` 有 `uniqueIndex`(`:1903-1907`),同一使用者對同一來源收藏不會重複插入。
5. `cost_ledger` / `cost_attribution_outbox`(`drizzle/schema.ts:2198-2200`、`:2247-2249`)—— `idempotencyKey` 皆有 `uniqueIndex`,配合 outbox 重試機制不會雙重入帳。
6. `users.openId`(`:27`)、`user_google_oauth_tokens.(userId, purpose)`(`:564-567`)、`refresh_tokens.tokenHash`(`:4519,4526`)、`skill_registry.skillId`(`:4580`)、`api_keys.keyHash`(`:4716`)—— 皆有對應唯一約束,未發現缺口。
7. `fine_tuned_model_consents` 的寫入呼叫端(`server/routers/models.ts:339-380`)雖然 junction 表本身缺唯一約束(見發現 4),但在插入前確實驗證了每個 `consentId` 屬於目前使用者(`:353`)且處於有效狀態(`:359-370`)—— **logical-fk-unvalidated 這個面向本身是有做防護的**,缺口單純是「重複插入」而非「插入無主/無效的 consent」。
8. `contextPackets.sourceRefsJson`(`:3816`)/`orchestrationRuns.contextPacketIdsJson`(`:3772`)—— 前者受 `expiresAt` TTL 保護,過期即由 `reuseOrRefreshPacket` 重新計算,不會長期存在懸空引用;後者經 grep 確認目前程式碼(`server/db.ts`、各 router)完全沒有寫入路徑,是尚未接線的欄位,暫無實際懸空風險。

---

## 統計摘要

- 全檔 102 張表僅 **18 個** `uniqueIndex`/`.unique()` 宣告;本輪新發現 **1 個明顯缺口**(`users.email`,高風險)與 **1 個次要缺口**(`fine_tuned_model_consents`,低中風險)。
- JSON 內嵌 id/ref 型別欄位(`number[]` / `string[]` 指向他表主鍵)全檔掃出 **7 個** 候選:`blockCombos.customBlockIds`、`worldbuildingFrameworks.linkedModelIds`、`orchestrationRuns.contextPacketIdsJson`、`teachingMaterials.realEarthRefs`、`realEarthEntries.relatedEntryIds`、`contextPackets.sourceRefsJson`(物件陣列,非純 id)、`fineTunedModels.configJson.shareRewarded`(旗標,非 id 陣列,已知案例)。其中 **2 個**(`linkedModelIds`、`realEarthRefs`/`relatedEntryIds`)刪除父列時完全無清理且無 TTL/讀端防呆,列為本輪主要發現;**1 個**(`customBlockIds`)雖無清理但讀端優雅降級,列為低優先;**1 個**(`contextPacketIdsJson`)尚未接線,無實際風險。
- 額外確認:`teams`/`team_memberships`/`teaching_materials`/`teaching_material_access_log`(migration 0055)與 `prompt_assets`(migration 0075)這 5 張表雖然 `schema.ts` 不宣告 `.references()`,實際資料庫已透過獨立 migration 補上真正的 FOREIGN KEY 約束 —— 「本專案 0 FK」的前提對這 5 張表不成立,稽核/重構時應留意這批例外,避免誤判或誤刪。
