# U1 — server/db.ts 逐行深挖(5701 行資料存取層,深挖 wave U)

- 產生日期:2026-07-03
- 依據 commit:`7f4417da`
- 波次:**逐檔深挖 wave U**(單一代理實讀,無子代理;僅 5701 行 `server/db.ts` 全文 + 對照 `server/_core/DatabaseManager.ts` 全文 + 少量呼叫端交叉核對,未動用子代理)
- 前置依據(不重複其結論,僅在需要延伸/具體化時引用):`K2-generation-bugs.md`(扣點/退款正確性)、`K3-data-integrity.md`(GDPR 刪除、雙 DB、資源共享、json 欄位)、`R4-cost-ledger-deepdive.md`(cost_ledger 全鏈)、`B-infra.md`(基建總覽)
- 方法:從第 1 行到第 5701 行逐段實讀(每次 600-800 行區塊),對每個 exported function 檢視:交易邊界、鎖範圍、回傳值是否被呼叫端檢查、JSON 欄位讀寫、分頁/游標正確性;對可疑的並發/所有權模式額外 grep 呼叫端交叉核對(teams.ts、videoProject.ts、admin.ts、UserAuthRepository.mysql.ts)
- 圖例:🔴 高風險 / 🟡 中風險 / 🟢 低風險;每條標示【新發現】或【延伸已知】(在既有波次基礎上補新證據/新血緣鏈,非全新現象)

---

## 摘要表

| # | 隱患 | 嚴重度 | 新舊 |
|---|---|---|---|
| 1 | `transferTeamOwnership` 無 affectedRows 檢查,並發轉移可讓 team_memberships.role 與 teams.ownerId 分裂 | 🔴 | 新發現 |
| 2 | `DatabaseManager` 獨立連線池未套用 lock_wait_timeout 修補,重蹈 2026-06-30 開機卡死事故的病灶 | 🔴 | 新發現 |
| 3 | 電路斷路器精確血緣鏈:刪帳號觸發 5 敗 → 本機 email/密碼登入 30 秒內全部 503 | 🔴 | 延伸已知(K3 §1.2 具體化) |
| 4 | `admin.updateQuota` 絕對值 SET 與扣退點相對值交易並存,構成 lost-update | 🟡 | 新發現 |
| 5 | `exportUserData` 只匯出 4 張表(且欄位截斷),GDPR 資料可攜權形同裝飾 | 🟡 | 延伸已知(K3 缺讀聲明#2 證實) |
| 6 | `softDeleteUser` 是全 repo 零呼叫的死碼,與已知壞掉的 `deleteUserAccount` 並存 | 🟡 | 新發現 |
| 7 | `deleteUserAccount` 70 張表同步逐一 DELETE、無批次,大量資料使用者會長時間鎖表 | 🟡 | 新發現 |
| 8 | `getAllUsers()`(無界 limit 10000)與分頁版並存,admin.allUsers 仍在用前者 | 🟡 | 新發現 |
| 9 | `getUserActivitySummary` 全表無 LIMIT + 每列 4 個相關子查詢 | 🟡 | 新發現 |
| 10 | `duplicateVideoProject` db 層本身無擁有權檢查,防護層級與同檔慣例不一致 | 🟢 | 新發現 |
| 11 | `searchRealEarthEntries` 條件建構邏輯重複兩份(rows 查詢/count 查詢各自維護一份) | 🟢 | 新發現 |
| 12 | `runDueAutoCreditGrant` 單一交易鎖住至多 200 筆使用者列,逐筆同步 UPDATE | 🟢 | 新發現 |

---

## 1. 🔴【新發現】`transferTeamOwnership` 無 affectedRows 檢查——並發轉移可讓 owner 權限分裂

**觸發情境**:同一個 owner 在極短時間內(例如雙擊、雙分頁、或惡意重放請求)對同一個團隊發起兩次「轉移擁有權」,目標分別是成員 A 與成員 B。

**證據**:`server/db.ts:4485-4519` 的 `transferTeamOwnership(teamId, oldOwnerId, newOwnerId)` 分三步、包在同一交易內:

1. `UPDATE teams SET ownerId=newOwnerId WHERE id=teamId AND ownerId=oldOwnerId`(:4494-4497,CAS 式帶條件更新)
2. `UPDATE team_memberships SET role='owner' WHERE teamId AND userId=newOwnerId`(:4499-4507)
3. `UPDATE team_memberships SET role='member' WHERE teamId AND userId=oldOwnerId`(:4509-4517)

**問題**:第 1 步用 `WHERE ownerId=oldOwnerId` 做樂觀 CAS,但**完全沒有檢查其 affectedRows**。第 2、3 步是**無條件執行**的,不管第 1 步是否真的命中。

推演:兩條並發請求 TxA(轉給 A)、TxB(轉給 B)都先通過 `routers/teams.ts:206-207` 的 `getRequireMembership` + `requireRole(me.role, "owner")` 檢查(讀 `team_memberships.role`,無鎖,可同時通過)。若 TxA 先提交(`teams.ownerId` 從 old→A),TxB 的第 1 步 `WHERE ownerId=oldOwnerId` 會 0 rows 命中(此時已是 A)——**但 TxB 仍會無條件執行第 2、3 步**,把 B 的 membership.role 設成 `'owner'`。結果:`teams.ownerId = A`(真正的 owner),但 `team_memberships` 表裡 **A 與 B 兩人都是 `role='owner'`**。

**後果**:若任何授權判斷(`requireRole`、`getRequireMembership`)是讀 `team_memberships.role` 而非 `teams.ownerId`(`routers/teams.ts:207` 正是如此),B 會取得所有 owner 專屬操作的權限(例如再次轉移擁有權、踢除成員、未來可能的刪隊/計費操作),即使他從未真正拿到 `teams.ownerId`。這是一個由「CAS 更新後未檢查結果」造成的並發權限分裂,測試(`teamsRouter.test.ts`)因為 mock 掉 `db.transferTeamOwnership` 本身,完全測不到這個 race——是典型「測試綠燈卻會壞」案例。

**證據 path:line**:`server/db.ts:4485-4519`;呼叫端 `server/routers/teams.ts:198-226`(權限檢查來源、無額外鎖)。

**修法方向(僅供參考)**:第 1 步後檢查 `affectedRows`,0 則整個函式拋錯／回傳失敗,不繼續執行第 2、3 步。

---

## 2. 🔴【新發現】`DatabaseManager` 獨立連線池未套用 lock_wait_timeout 修補,重蹈 2026-06-30 病灶

**觸發情境**:任一張 `DatabaseManager` 服務的表(見下方血緣清單)遭遇長時間持有的 metadata lock(例如某支 migration 的 `ALTER TABLE users …` 卡住,或另一個長交易鎖住同一張表),同時有請求打進 `UserAuthRepository.findByEmail`(本機登入)、密碼重設、信箱驗證、或 `deleteUserAccount`。

**證據**:`server/db.ts:322-350` 有一段詳細註解記錄了 **2026-06-30 的真實事故**:MySQL `lock_wait_timeout` 預設 ~1 年,若某支 migration 的 DDL 卡住 metadata lock,`migrate()` 永遠不返回,整個開機健檢卡死、Railway 部署全部判定不健康。修法是在 **drizzle 的連線池**(`_db = drizzle({...})`,:306-316)的 `connection` 事件裡對每個新連線執行 `SET SESSION lock_wait_timeout = 60`(:342-350),把 DDL metadata lock 等待上限從 ~1 年壓到 60 秒。

但 `server/_core/DatabaseManager.ts:89-98` 建立的是**完全獨立的第二個 mysql2 連線池**(`mysql.createPool({ uri: databaseUrl, waitForConnections, connectionLimit: 20, queueLimit: 0, enableKeepAlive, keepAliveInitialDelay })`)——**沒有任何 `pool.on("connection", …)` 事件處理器**,沒有套用同一個 `lock_wait_timeout=60` 修補。

透過 grep `getDatabaseManager()` 確認此池服務的業務範圍:`server/repositories/base/BaseRepository.ts`(被 `passwordResetService.ts`、`emailVerificationService.ts`、`loginHistoryService.ts`、`UserAuthRepository.mysql.ts` 繼承)、`server/db.ts:5380`(`deleteUserAccount`)、`server/_core/metricsRoute.ts`(健康快照讀取)。也就是**本機 email/密碼登入(`findByEmail`)、密碼重設、信箱驗證、登入歷史寫入、帳號刪除**這五類請求走的是這個「沒打過補丁」的連線池。

**後果**:2026-06-30 那次修的是「migration 執行路徑」;但只要有任何 DDL(未來的 migration、或人工在正式庫下 `ALTER TABLE`)卡住 metadata lock,且該 DDL 涉及 `users`/`login_history`/`password_reset_tokens`/`email_verification_tokens` 或 `USER_OWNED_TABLES` 任一張表,經過 `DatabaseManager` 的查詢(尤其是本機登入 `findByEmail`)會用 MySQL 預設的 ~1 年 `lock_wait_timeout` 卡住——`DatabaseManager.query()/execute()` 外層雖然有 `withTimeout()` 30 秒 JS 端 race(:260-300),但這只讓呼叫端的 Promise 提早 reject,**底層 mysql2 對 MySQL server 的實際查詢/鎖等待並未被取消**,連線在驅動層仍卡住直到 MySQL 真正回應或連線被摧毀。20 個連線的池在最壞情況下會被逐一卡滿,最終讓本機登入整體不可用——而這正是修補 §1(drizzle 池)想解決、卻沒有覆蓋到的同一種故障模式,只是換了一個連線池重演。

**證據 path:line**:`server/db.ts:322-350`(drizzle 池的修補與其詳盡事故記錄);`server/_core/DatabaseManager.ts:89-98`(無對應修補的獨立池);`server/repositories/base/BaseRepository.ts:5`、`server/repositories/mysql/UserAuthRepository.mysql.ts:21-31`(血緣鏈到本機登入)。

---

## 3. 🔴【延伸已知,具體化血緣鏈】電路斷路器精確打擊面:刪帳號 5 敗 → 本機登入 30 秒內全站 503

`K3-data-integrity.md` §1.2 已指出 `deleteUserAccount` 觸發的 SQL 錯誤(K3 §1.1,`USER_OWNED_TABLES` 內 10 張表無 `userId` 欄)會餵給單例電路斷路器,5 次連續失敗即可讓 `DatabaseManager.executeTransaction` 全站 503 達 30 秒,但當時的措辭是「任何 `executeTransaction` 呼叫」,較為抽象。本波深挖 `getDatabaseManager()` 的實際呼叫端後可以把打擊面**具體釘死**:

**證據**:`server/repositories/mysql/UserAuthRepository.mysql.ts:21-31` 的 `findByEmail()`——本機 email/密碼登入流程唯一的使用者查找入口——透過 `BaseRepository`(`server/repositories/base/BaseRepository.ts:5`,`return getDatabaseManager()`)呼叫 `this.db.query(...)`,即 `DatabaseManager.query()`(`DatabaseManager.ts:260-300`)。此方法開頭就是 `if (this.isCircuitOpen()) throw new AppError({ statusCode: 503, errorCode: "CIRCUIT_OPEN" })`(:265-273)。

**後果**:K3 §1.1 描述的「使用者刪帳號會撞到 `prompt_assets` 等無 userId 欄位的表而 100% 拋錯」一旦被連續觸發 5 次(例如同一個壞掉的刪帳號功能被使用者反覆重試,或未來的自動化 QA/GDPR cron 掃過去),接下來 **30 秒內,任何嘗試用 email+密碼登入的使用者都會收到 503 CIRCUIT_OPEN**,而不是含糊的「任何交易」——這是一個具體、可重現、直接影響最基本的登入功能的複合故障,且與密碼重設、信箱驗證共用同一個斷路器狀態。

**證據 path:line**:`server/db.ts:5379-5395`(刪帳號觸發點,承接 K3 §1.1);`server/repositories/mysql/UserAuthRepository.mysql.ts:21-31`;`server/repositories/base/BaseRepository.ts:1-10`;`server/_core/DatabaseManager.ts:200-237,260-273`。

---

## 4. 🟡【新發現】`admin.updateQuota` 絕對值 SET 與扣退點相對值交易並存,構成 lost-update

**觸發情境**:管理員在後台「使用者管理」面板對某使用者的點數餘額做調整(例如手動加值/扣點),與該使用者當下正在進行的生成扣點/退款發生時間重疊。

**證據**:`server/db.ts:591-598` 的 `updateUserQuota(userId, amount)` 是一個**沒有交易、沒有鎖的絕對值 SET**:`UPDATE users SET remainingGenerations = amount WHERE id = userId`。它被 `server/routers/admin.ts:29-39` 的 `admin.updateQuota` mutation 直接呼叫,`amount` 是管理員在前端表單填入的**絕對目標值**(`z.number().min(0)`,非 delta)。

同一份 `users.remainingGenerations` 欄位,在本檔案裡另外有 `deductUserQuota`(:707-763)、`deductUserPoints`(:808-893)、`refundUserPoints`(:898-921)、`refundUserQuota`(:769-796)四支函式,全部用 `db.transaction` + `SELECT … FOR UPDATE` 做**相對值**（`± amount`）的原子加減。

MySQL 層面兩者不會互相「跑飛」資料(InnoDB 對同一列的寫入互斥,`updateUserQuota` 的隱式單語句交易會排隊等待 FOR UPDATE 鎖釋放),但**語意上**是一個古典的 lost-update:管理員在後台載入頁面時看到的 `remainingGenerations` 快照是某個時間點的值,填入新的絕對值後送出——如果送出前使用者剛好完成一次生成扣點(或收到一筆退款),管理員這次「設定」會用一個基於舊快照算出的絕對值,**把使用者這段時間內任何扣點/退款的效果完全覆蓋掉**(不論方向,使用者可能被少扣或多扣,且無任何記錄或警告)。

**後果**:管理員操作與正常扣退點流程沒有任何協調機制(無版本欄位、無「+delta」語意選項),對活躍使用者做點數調整時有實質的資料遺失風險,且因為 `updateUserQuota` 不寫任何 log/稽核軌跡,事後無法追查「使用者少的那筆點數是被扣點吃掉還是被管理員覆蓋」。測試(`atomic-deduction.test.ts`)只在無 DB 環境下跑,測不到這個交互。

**證據 path:line**:`server/db.ts:591-598`(`updateUserQuota`);`server/routers/admin.ts:29-39`(`admin.updateQuota`,絕對值輸入);對照 `server/db.ts:707-763,808-893`(相對值原子函式家族)。

---

## 5. 🟡【延伸已知,實證】`exportUserData` 只匯出 4 張表——GDPR 資料可攜權形同裝飾

K3 的「缺讀聲明」第 2 項曾標記「`exportUserData()` 只讀了函式開頭,未逐行核對匯出欄位是否也漏了與 §1.3 同樣的表」為待查項。本波已逐行讀完,可以升級為 CONFIRMED。

**證據**:`server/db.ts:5403-5464` 的 `exportUserData(userId)` 只並行查詢 **4 張表**:

- `users`(僅 8 個欄位:id/email/name/loginMethod/role/emailVerified/createdAt/lastSignedIn)
- `generationHistory`(僅 id/modality/prompt/createdAt,限 200 筆)
- `loginHistory`(僅 success/ipAddress/device/browser/os/createdAt,限 100 筆)
- `digitalAssetLibrary`(僅 id/title/createdAt,限 200 筆——**連 fileUrl/description/promptUsed 都沒帶到**)

對照同檔案 `USER_OWNED_TABLES`(:5300-5370)列出的 **70 張表**——教材庫(`teaching_materials`)、光球對話與長期記憶(`orb_conversations`/`orb_long_term_memories`)、consistency_vault、custom_blocks、prompt_library、fine_tuned_models、user_feedback_reports、team_memberships、cost_ledger、api_usage_logs、model_wishes、studio_recipes、video_projects 等,**全部沒有出現在匯出結果裡**。

**後果**:使用者按下「匯出我的資料」拿到的 JSON 幾乎不包含他們在本站的真實足跡——沒有教材庫使用紀錄、沒有光球對話內容、沒有自訂模板/提示詞、沒有訓練過的 LoRA 模型、沒有完整的資產詳情(檔案位址都沒有,只有標題)、沒有費用/點數帳本。這與 GDPR 第 15/20 條「資料可攜權」的精神有明顯落差——名義上有一個匯出端點,但實質涵蓋率遠低於刪除清單(即使刪除清單本身如 K3 所述也是壞的)。

**證據 path:line**:`server/db.ts:5403-5464`(匯出實作)vs `server/db.ts:5300-5370`(`USER_OWNED_TABLES` 70 張表清單)。

---

## 6. 🟡【新發現】`softDeleteUser` 是全 repo 零呼叫的死碼,與已知壞掉的硬刪除並存

**觸發情境**:無——這正是問題所在。

**證據**:`server/db.ts:506-523` 定義了 `softDeleteUser(userId)`:把 `users.deletedAt` 設為 `NOW()`,清空 `name`/`email`/`passwordHash`/`twoFactorSecret`/`orbMemorySummary`/`avatarUrl`,並把 `openId` 改成 `deleted-${userId}-${Date.now()}`(匿名化模式,不動任何其他表)。全 repo grep `softDeleteUser`(含 client/server/tests)**只有這一處定義,零呼叫端**。

**後果**:這代表本站事實上存在兩套獨立的「刪除使用者」思路:(a) `deleteUserAccount` 的硬刪除+70 表清單(K3 已證實至少 10 張表會讓它 100% 拋錯,整條路徑目前不能用),(b) 完全沒被接線、寫好放著的匿名化軟刪除函式。沒有任何路由呼叫 (b),也沒有測試涵蓋它是否真的能正確運作(例如 `openId` 改名後是否會撞到唯一鍵、`orbMemorySummary` 等欄位是否存在於目前 schema)。這是一個「準備了 Plan B 卻沒有人接上、Plan A 又是壞的」的技術債模式——若團隊誤以為「反正軟刪除還在,帳號刪除大不了走那條路」,實際上那條路目前完全是死碼,沒有任何呼叫端會觸發它。

**證據 path:line**:`server/db.ts:506-523`(定義);全 repo grep `softDeleteUser` 僅命中此行,無任何 router/service 呼叫。

---

## 7. 🟡【新發現】`deleteUserAccount` 70 張表同步逐一 DELETE、無批次、無 timeout 保護

**觸發情境**:即使 K3 §1.1 的「10 張表無 userId 欄位」問題被修好,對一個使用本站多年、生成過大量內容的「重度使用者」執行帳號刪除。

**證據**:`server/db.ts:5379-5395` 的 `deleteUserAccount` 在單一 `manager.executeTransaction` 內,對 `USER_OWNED_TABLES` 陣列(70 個表名)用 `for...of` **循序**執行 `DELETE FROM \`${table}\` WHERE userId = ?`——70 次獨立的網路往返,全部包在同一個交易、同一個連線裡,**沒有任何批次(batch)/分段(chunking)/LIMIT 機制**。`api_usage_logs`、`ai_usage_events`、`background_jobs`、`generation_history` 這幾張表對活躍多年的使用者可能累積數千甚至數萬列。

**後果**:結合第 2 條發現(`DatabaseManager` 池無 `lock_wait_timeout` 修補、`executeTransaction` 的 `executor` 呼叫本身完全沒有套用 `withTimeout` 包裝——只有 `query()`/`execute()` 兩個方法有,`executeTransaction` 內部是直接呼叫 `executor(connection)`,見 `DatabaseManager.ts:347-379`),這個刪除交易在資料量大時可能長時間持有列鎖/交易,期間任何該使用者其他並發請求(例如同時還在跑的生成任務要寫 `background_jobs`/`api_usage_logs`)會被鎖等待,甚至可能與其他背景 cron(`purgeExpiredBackgroundJobs`、`mediaArchivalCron`)產生鎖競爭。在測試/demo 環境(每張表數十列)這條路徑會很快跑完、完全綠燈;只有在真實高用量帳號上才會浮現「一次刪除帳號卡住資料庫數十秒」的效能問題。

**證據 path:line**:`server/db.ts:5379-5395`;對照 `server/_core/DatabaseManager.ts:347-379`(`executeTransaction` 無 timeout 包裝)。

---

## 8. 🟡【新發現】`getAllUsers()` 無界查詢與分頁版並存,admin 後台仍在用前者

**觸發情境**:管理員開啟後台「使用者列表」頁面,且站上註冊使用者數量成長。

**證據**:`server/db.ts:568-572` 的 `getAllUsers()` 是 `SELECT * FROM users ORDER BY createdAt DESC LIMIT 10000`——**無分頁參數,硬編碼上限 10000**。旁邊 `server/db.ts:575-589` 已經有正確的游標分頁版本 `getAllUsersPaginated`(AIDV-618,主打「防止大量使用者時 OOM」)。但 `server/routers/admin.ts:13-15` 的 `admin.allUsers` 查詢**仍然呼叫舊版 `getAllUsers()`**,新版 `allUsersPaginated`(:18-27)是另一個獨立端點並存,而非取代關係。

**後果**:只要使用者數低於 10000(目前應該是這樣),`admin.allUsers` 運作正常、測試會綠燈。一旦超過 10000,`admin.allUsers` 會**靜默截斷**(LIMIT 10000 之外的使用者完全不會出現在結果裡,不拋錯、不警告、前端也沒有任何「還有更多資料未顯示」的提示)——這正是 AIDV-618 想解決的 OOM 問題演變成的另一種形式:從「整表載入導致記憶體爆掉」變成「隱性資料截斷,admin 看不到最新註冊的一批使用者」。兩個版本並存代表遷移沒有做完,是典型「聲稱修好但只修了一半接線」的技術債模式。

**證據 path:line**:`server/db.ts:568-589`(兩個版本並列定義);`server/routers/admin.ts:13-27`(舊版仍被路由使用)。

---

## 9. 🟡【新發現】`getUserActivitySummary` 全表無 LIMIT + 每列 4 個相關子查詢——效能陷阱

**觸發情境**:管理員後台載入某個依賴「每使用者活動摘要」的畫面(例如成本金流/使用者總覽分頁)。

**證據**:`server/db.ts:2933-2953` 的 `getUserActivitySummary()`:

```sql
SELECT users.id, ..., users.remainingGenerations, ...,
  (SELECT COUNT(*) FROM api_usage_logs WHERE api_usage_logs.userId = users.id) AS totalApiCalls,
  (SELECT SUM(estimatedCostUsd) FROM api_usage_logs WHERE api_usage_logs.userId = users.id) AS totalCost,
  (SELECT COUNT(*) FROM generation_history WHERE generation_history.userId = users.id) AS totalGenerations,
  (SELECT COUNT(*) FROM digital_asset_library WHERE digital_asset_library.userId = users.id) AS totalAssets
FROM users
ORDER BY users.lastSignedIn DESC
```

**沒有 `LIMIT`**,對 `users` 表的**每一列**都要對 `api_usage_logs`(兩次,COUNT 與 SUM 各一次相關子查詢)、`generation_history`、`digital_asset_library` 各執行一次相關子查詢——雖然整體仍是「一條 SQL」而非應用層 N+1,但 MySQL 執行計畫上等同對每個使用者跑 4 次額外查找,使用者數與各表資料量同時成長時,這條查詢的成本是接近 O(使用者數 × 各表平均列數)量級,且沒有分頁/上限保護。

**後果**:在開發/測試資料量下(數十個使用者、數百列日誌)這條查詢瞬間完成、測試全綠;隨著站上使用者數與生成歷史增長,此查詢的執行時間會隨資料量二次成長,且因無 LIMIT,無法透過分頁緩解——是典型「資料量小時看不出來,正式站規模化後才爆」的效能陷阱,且此查詢很可能被排在管理後台首頁載入路徑上(常態高頻呼叫)。

**證據 path:line**:`server/db.ts:2932-2953`。

---

## 10. 🟢【新發現】`duplicateVideoProject` db 層無擁有權檢查,防護層級與同檔慣例不一致

**觸發情境**:目前唯一呼叫端(`routers/videoProject.ts`)有做擁有權檢查,故此項**現況安全**;風險在於未來若有第二個呼叫路徑忘記重複這個檢查。

**證據**:`server/db.ts:5681-5701` 的 `duplicateVideoProject(sourceId, userId, newTitle)` 內部呼叫 `getVideoProject(sourceId)`(:5688,**不帶 userId 過濾**)取得來源專案,然後用參數 `userId`(而非來源專案的 `userId`)建立複本,複製 `title`/`aspectRatio`/`outputSpec`/`creativeProjectId`/`inputAssets`。函式本身**不驗證 `source.userId === userId`**,完全信任呼叫端已經做過這個檢查。

對照同檔案其他函式的慣例——例如 `getLinkedAssetsForPrompt`(:1381-1416)、`getLinkedPromptsForAsset`(:1417-1442)的註解明確寫著「呼叫端 router 另檢查資產本身的所有權 — 雙層防護」,並且**在 SQL WHERE 子句裡也真的加了 userId 條件做第二層防護**——`duplicateVideoProject` 沒有這種雙層防護,是單點防護(僅靠 `server/routers/videoProject.ts:263-267` 的 `if (source.userId !== ctx.user.id) throw FORBIDDEN`)。

**後果**:目前唯一呼叫端有查,不構成現行漏洞。但這是一個「跟同檔案其他函式的安全模式不一致」的設計債——`inputAssets` 可能包含他人私有素材的參照,一旦未來有第二個呼叫端(例如某個內部工具腳本、批次遷移腳本、或 AI 代理直接呼叫 db 層函式)忘記重複這個檢查,就會變成可以複製任意他人影片專案(含其輸入素材參照)到自己帳下的 IDOR。

**證據 path:line**:`server/db.ts:5681-5701`;呼叫端 `server/routers/videoProject.ts:262-267`(唯一的擁有權檢查點)。

---

## 11. 🟢【新發現】`searchRealEarthEntries` 條件建構邏輯重複兩份,維護時容易漏改

**觸發情境**:未來有人替 `searchRealEarthEntries` 新增一個篩選條件(例如 `yearRange`——目前的 `params` 型別已經宣告了 `yearRange`/`tags`/`minCredibility` 三個欄位,但函式本體完全沒有使用它們,見下)。

**證據**:`server/db.ts:4982-5097` 的 `searchRealEarthEntries` 為了同時回傳 `rows`(分頁後結果)與 `total`(總筆數),把同一組篩選條件**手動重複組裝了兩次**——一次在 :4998-4031(給 `query`)、一次在 :5061-5087(給 `countQuery`,變數名是獨立的 `countConditions`)。兩份邏輯目前碰巧完全一致,但這是純手動同步,沒有共用函式或單一事實來源。

**另外**:函式簽章宣告的 `yearRange`、`tags`、`minCredibility` 三個參數**完全沒有被函式體使用**(grep 全函式本體無 `params.yearRange`/`params.tags`/`params.minCredibility` 出現),呼叫端若真的傳了這些篩選條件,會被靜默忽略——搜尋結果「看起來成功」但實際上沒套用這些篩選,是另一種「看起來有支援、實際上沒接線」的落差。

**後果**:低優先級,因目前兩份條件邏輯尚未失衡;但這是典型「重複程式碼隨時間漂移」的溫床——未來若只改了 `rows` 查詢那一份(例如新增 `yearRange` 篩選)卻忘了同步改 `countQuery` 那份,會造成「當前頁面顯示的結果集」與「總頁數/總筆數」不一致(例如篩出 5 筆結果,但 `total` 卻回報未篩選前的 500 筆),前端分頁 UI 會出現「明明只有 5 筆,卻顯示有 100 頁」的錯亂。

**證據 path:line**:`server/db.ts:4982-5097`(條件重複两份 + 三個宣告卻未使用的篩選參數)。

---

## 12. 🟢【新發現】`runDueAutoCreditGrant` 單一交易鎖住至多 200 筆使用者列,逐筆同步 UPDATE

**觸發情境**:自動加值排程(`runDueAutoCreditGrant`,預設 `limit=200`)觸發時,剛好有多個到期使用者需要同時處理,且這些使用者中有人同時在使用站上功能扣點。

**證據**:`server/db.ts:642-698` 在單一 `db.transaction` 內先 `SELECT … FOR UPDATE LIMIT 200`(:650-660)鎖住最多 200 筆到期使用者列,然後在**同一個交易、同一個 for 迴圈**裡對每一筆逐一執行 `UPDATE users SET remainingGenerations = remainingGenerations + amount, autoCreditLastAt = NOW(), autoCreditNextAt = nextAt WHERE id = userId`(:685-692)。整個交易要等所有 200 筆(或實際到期筆數)的 UPDATE 依序跑完才 COMMIT,這段期間**這 200 位使用者的列鎖持續被持有**。

**後果**:若批次剛好覆蓋到某位使用者,且該使用者此刻正在提交生成請求(觸發 `deductUserPoints`/`deductUserQuota` 的 `SELECT … FOR UPDATE`),該使用者的生成請求會被這個自動加值批次job 卡住,直到整批 200 筆全部處理完畢才能繼續——批次量小時感覺不到(幾毫秒),但若到期使用者数一次湧現到接近 200 上限(例如許多使用者的 `autoCreditIntervalDays` 恰好對齊在同一天/同一小時到期),批次執行時間會拉長,期間受影響使用者的生成請求會有感延遲,是「量小時無感、量大時才浮現」的另一個效能陷阱案例。

**證據 path:line**:`server/db.ts:642-698`。

---

## 缺讀聲明(本波未查完部分)

1. 本波是**全檔逐行讀完**(1-5701 行皆有讀取),但深度上仍有取捨:對已被 K2/K3/R4 詳細記錄的函式(`deductUserPoints`/`refundUserPoints`/`atomicClaimJobRefund`/`USER_OWNED_TABLES`/`resourceShares` 多型關聯本身的設計問題)只做「確認現況與既有記錄一致」的核對,未重新展開分析,避免與既有文件重複。
2. `server/_core/DatabaseManager.ts` 全文已讀完(506 行),但其呼叫端(`passwordResetService.ts`/`emailVerificationService.ts`/`loginHistoryService.ts`)本身的邏輯未逐行核對,只確認了它們共用同一個斷路器單例這件事(§2/§3 的血緣鏈)。
3. `searchRealEarthEntries` 的 `yearRange`/`tags`/`minCredibility` 三個「宣告卻未使用」的參數,未進一步追蹤呼叫端(`realEarth.ts` router)是否真的會傳入這些欄位、前端 UI 是否有對應輸入框卻始終無效——只在 db.ts 層級確認了「函式體未使用」這個事實,未評估使用者可見的實際影響範圍。
4. 未實際起 Docker/MySQL 對 §1(`transferTeamOwnership` 並發權限分裂)、§7(70 表同步刪除的鎖持有時間)做真實併發測試,兩者都是「讀碼邏輯推導必然發生」而非「實測量到」,信心度高但屬 PLAUSIBLE 而非以 DB 實測驗證的 CONFIRMED。
5. 未逐一核對 `USER_OWNED_TABLES`/`exportUserData` 之外,是否還有其他「宣稱涵蓋 X 但實際只做部分」的清單型函式(例如是否還有其他地方也維護了一份使用者資料表清單、彼此是否同步)——只鎖定了刪除清單 vs 匯出清單這一組已知的不對稱。
