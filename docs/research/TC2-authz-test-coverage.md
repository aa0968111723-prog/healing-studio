# TC2 — 授權/IDOR 測試覆蓋
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:owner/授權相關 *.test.ts + 對照安全群組(S-00/S-19/S-21/S-22/S-33/S-34/S-37/DI-01/DI-05 等 IDOR/BOLA)

> 方法論:先用 Glob/Grep 找出實際存在的 `*.test.ts(x)`/`__tests__` 測試檔並逐一讀取內容確認「測了什麼」,再回頭比對 `00-discussion-taskcards.md` 已確認的頂級發現(S-00/S-19/S-21/S-22/S-33/S-34/S-37/DI-01/DI-05)。不臆測「應該有測試」——每一列的「有無測試」都基於實際讀到的測試檔內容(或確認該路徑完全沒有對應測試檔)。

---

## 1. 逐項核對表:關鍵路徑 × 覆蓋狀態 × 對應發現 × 回歸風險 × 建議測試

| # | 關鍵路徑(檔案:行號) | 對應發現 | 覆蓋狀態 | 證據(實際測試檔:行號) | 回歸風險(若 untested) | 建議測試 |
|---|---|---|---|---|---|---|
| 1 | `server/routers/auth.ts:9`(`me: publicProcedure.query(ctx => ctx.user)`) | **S-00**(P0・全案最高優先)auth.me 洩漏 passwordHash/2FA 種子/icsFeedToken,無欄位白名單 | **untested**(有測試檔但斷言不夠,漏測負向案例) | `server/healing.test.ts:60-77` `describe("auth.me")` 兩個 case:未登入回 null、已登入只斷言 `result.name`/`result.email`/`result.remainingGenerations` 三個正向欄位存在;`createMockUser()`(:27-43)本身也**沒有**設定 `passwordHash`/`twoFactorSecret`/`icsFeedToken`,所以就算之後有人不小心把這些欄位加回回應,測試也不會爆 | 任何人「修 auth.me 加欄位/重構回應物件」都不會被既有測試攔下;之後只要重新混入 `passwordHash`/`twoFactorSecret` 就會**silently regress** 回全案最高優先漏洞,而 CI 綠燈 | 在 `describe("auth.me")` 的已登入 case 補負向斷言:`expect(result).not.toHaveProperty("passwordHash")`、`.not.toHaveProperty("twoFactorSecret")`、`.not.toHaveProperty("icsFeedToken")`;`createMockUser()` 也要顯式塞入這些欄位(模擬 DB 全列)才能證明白名單真的把它們濾掉,而不是「本來就沒有所以測試通過」 |
| 2 | `server/routers/admin.ts:13-27`(`allUsers`/`allUsersPaginated`)+ `server/db.ts:568-589`(`getAllUsers`/`getAllUsersPaginated`,`db.select().from(users)` 全欄位) | **S-37**(P0)admin.allUsers/allUsersPaginated 洩全站 passwordHash/2FA 給任何 admin | **untested**(測試檔存在但只測角色門,不測欄位投影) | `server/phase3-audit.test.ts:398-417` `describe("admin routes")` 三個 case 全部是「非 admin/未登入 → reject」的 gate 測試(`rejects.toThrow()`);**沒有任何一個 case 用合法 admin 呼叫 `allUsers()` 後檢查回傳內容**,故 S-37 真正的漏洞(合法 admin 拿到的資料含全站 passwordHash/2FA)完全沒被驗證過 | 這是「頂級確認發現裡缺回歸測試」的代表案例之一:任一 admin 帳號被盜或 XSS 即可外洩全站憑證,但現有測試連「合法 admin 呼叫後資料長什麼樣」都沒斷言過,補欄位白名單後也無法自動驗證是否修好、日後也可能被靜默改回 | 新增 `describe("admin.allUsers 欄位投影")`:mock `db.getAllUsers` 回傳含 `passwordHash`/`twoFactorSecret`/`icsFeedToken` 的假 row,用合法 admin caller 呼叫 `allUsers()`/`allUsersPaginated()`,斷言回傳陣列每個元素都 `not.toHaveProperty` 這三個欄位 |
| 3 | `server/routers/realEarth.ts:294-300`(`getLinkedMaterials`) | **S-19**(P0)繞過三層授權,任意登入者枚舉 id 讀他人私有教材全文 | **untested**(路由完全沒有對應測試檔) | Glob/Grep 全庫搜尋 `*.test.ts` 找不到任何檔案 import 或呼叫 `realEarthRouter`/`getLinkedMaterials`;`server/routers/realEarth.ts` 本身無同名 `__tests__` 檔 | 這是最乾淨的「零測試」缺口:`getLinkedMaterials` 直接 `parseInt(input.id)` 後 `db.findTeachingMaterialsByRealEarthRef(entryId)`,**完全沒有檢查 `ctx.user.id` 與教材擁有者的關係**,任何未來重構都不會觸發任何測試失敗,也無法用測試證明「已修好」 | 新增 `server/routers/__tests__/realEarthRouter.test.ts`:owner 呼叫 `getLinkedMaterials({id})` → 正常回傳;非 owner(不同 `ctx.user.id`)呼叫同一 `id` → 應 `FORBIDDEN`/`NOT_FOUND` 且不回傳教材內容(修復前這個測試會失敗,可當回歸測試骨架) |
| 4 | `server/routers/brain.ts:915-926`(`errorTraces`)、`:955-962`(`diagnoseError`)、`:1272-1276`(`generationLogs`) | **S-21**(P0)三端點僅需登入→跨用戶讀全站 prompt/錯誤/resultUrl | **untested**(唯一同名測試檔測的是完全不同的東西) | `server/routers/__tests__/brainPipeline.test.ts`(1331 行)整份是「brainPipeline 架構圖產生器」的 drift-guard 測試(`buildGraph`/`ROUTER_TO_PROVIDERS`/`APP_PAGE_REGISTRY` 等節點圖一致性),與 `brain.ts` router 的 `errorTraces`/`diagnoseError`/`generationLogs` 三個查詢端點無關;`server/brain-auto-repair.test.ts`、`server/brain-context.test.ts`、`server/brain-state-persistence.test.ts` 也都不觸及這三個端點 | 容易誤判「brain 有測試」,實際上這三個 IDOR 端點是**完全空白**;任何人看到 `brainPipeline.test.ts` 檔名可能誤以為已覆蓋,增加了誤判風險 | 新增測試(可放 `server/routers/__tests__/brainErrorTraces.test.ts`):以兩個不同 `ctx.user.id` 呼叫 `errorTraces`/`diagnoseError`/`generationLogs`,驗證回傳只含呼叫者自己的紀錄(或補 owner 檢查後應 `FORBIDDEN`) |
| 5 | `server/routers/models.ts:20-22`(`teamModels: protectedProcedure.query(() => db.getTeamSharedModels())`)、`:24-38`(`getById`) | **S-22**(P0)`team_shared` 只查 visibility 不查 teamId→任何登入者讀他人模型 `trainedLoraUrl`/訓練圖 | **untested**(存在容易混淆的「鄰近但不同路徑」測試) | `server/team-model-training.test.ts`(179 行)測的是 `server/subsystems/trainingTrack/trainingTrackService.ts` 的 `listTeamModels`/`startTeamModelTraining`——這條路徑**有**正確做 `getTeamMembership` 檢查(:174-177 非成員會 `forbidden`);但這不是 S-22 指出的漏洞路徑。真正有漏洞的 `server/routers/models.ts` 的 `teamModels`/`getById` 完全沒有同名測試檔,`teamModels` 甚至**不吃任何 input**,無法限定 teamId | 兩條 code path 一好一壞並存,容易誤以為「team_shared 已經測過了」而漏掉真正暴露的 router 端點;`models.ts:teamModels` 目前對任何登入者回傳全站 team_shared 模型(含 `trainedLoraUrl`) | 新增 `server/routers/__tests__/modelsRouter.test.ts`:以非該 team 成員身分呼叫 `teamModels`/`getById(otherTeamModelId)`,驗證不應拿到跨團隊的 `trainedLoraUrl`/訓練圖(對照 `resourceAccess.test.ts` 現有的 `canAccess` 矩陣寫法,讓 router 真正接上該授權中介層) |
| 6 | `server/routers/langsmith.ts`(8/9 procedure 用 `protectedProcedure`,如 `:317` `listRuns`、`:359` `getRun`、`:551` `listFeedback`、`:825` `exportFineTuningData`) | **S-33**(P0)任何登入者可讀取/批次匯出全站所有使用者 LLM 對話原文 | **untested**(路由完全沒有對應測試檔) | Glob/Grep 找不到任何 `*.test.ts` import `langsmithRouter` 或呼叫其 procedure;`server/app-registry-selectors.test.ts`、`server/ai-proxy-auth.test.ts`、`server/fal-queue-dispatcher.test.ts` 等檔名匹配到字串 "langsmith" 只是註解或不相關字串,實際未測此 router | 零測試意味著即使把這 8 個端點全部改成 `adminProcedure` 修復,也沒有測試能證明「非 admin 現在被擋下」,也無法防止未來又有人加一個新端點忘記加權限 | 新增 `server/routers/__tests__/langsmithRouter.test.ts`:非 admin 呼叫 `listRuns`/`getRun`/`listFeedback`/`exportFineTuningData` 等應 `FORBIDDEN`;admin 呼叫應成功 |
| 7 | `server/services/orbClarificationEngine.ts:517`(`recordAnswer`,僅 `where(eq(orbClarificationHistory.id, clarId))` 無 userId 過濾) | **S-34**(P0)更新澄清紀錄無 userId 擁有權檢查→跨用戶 IDOR 寫入 | **untested**(同檔測試檔存在但只測不相關的另一半功能) | `server/orbClarificationEngine.getStats.test.ts`(136 行)只測 `computeClarificationStats`(純聚合函式,:32-115)與 `getStats` 的 DB fallback(:117-136);**完全沒有任何 case 呼叫或 mock `recordAnswer`**,更不用說跨用戶擁有權驗證 | 檔名容易讓人誤以為「orbClarificationEngine 有測試」,但實際上寫入路徑(`recordAnswer`)是空白;任何人可用他人的 `clarificationId` 覆寫其澄清回答內容而無測試攔截 | 新增測試:呼叫 `recordAnswer(otherUserClarificationId, "偽造答案")` 應在補上 owner 檢查後拋錯/被拒;並驗證修復前後行為差異(可用 mock DB 之 `orbClarificationHistory.userId` 與呼叫者 `userId` 不符的案例) |
| 8 | `server/db.ts:5379`(`deleteUserAccount`)+ `USER_OWNED_TABLES` 常數 + `server/routers/profile.ts:32`(`deleteAccount` 呼叫入口) | **DI-01**(P0・法遵+正確性)`deleteUserAccount` 100% 失敗,帳號刪除從不生效(11 個表缺 `userId` 欄位名對應,交易在第 26 項炸掉整段 rollback) | **untested**(零測試) | 全庫 Grep `deleteUserAccount`/`USER_OWNED_TABLES` 於 `*.test.ts` **零命中**;唯一提到 profile 的測試(`server/routers/__tests__/*`)未涵蓋 `deleteAccount`;`server/creative-projects-migration.test.ts` 只測 schema 欄位存在,不測刪除交易本身 | 最高法遵風險缺口:目前該功能**已知 100% 失敗**且完全沒有測試守護——未來任何人修表名↔欄位名 map 都無法用測試驗證「這次修對了」,也無法防止之後又有新表被加進 `USER_OWNED_TABLES` 卻忘記對應正確欄位名而重新炸掉整個刪除交易 | 新增 `server/deleteUserAccount.test.ts`:對 `USER_OWNED_TABLES` 中每一個表 mock DB,驗證交易可以跑完(不因欄位名不符而 rollback);至少覆蓋一個 `ownerUserId`/`createdBy` 命名不一致的表當回歸案例;交易失敗時應該真的向呼叫端拋錯(而非被吞掉回報「成功」,這點 DI0 也標「待查」) |
| 9 | `server/routers/worldbuilding.ts:688-719`(`checkConsistency`) | **DI-05**(高)IDOR:可覆寫任意使用者 `timeline_frames` 的 `consistencyCheckJson`(同檔 `deleteTimelineFrame`/`listTimelineFrames` 都有 userId 收斂,`checkConsistency` 是漏掉的例外) | **untested**(同檔其他端點有 owner 測試,唯獨這條被跳過——同檔案內可直接對照的反例) | `server/routers/__tests__/worldbuildingRouter.test.ts:172-176`:`checkConsistency` 測試只用預設 `caller()`(userId=99,恰為 mock 資料擁有者)呼叫,斷言「不拋、回傳 ConsistencyCheckResult」,**沒有用另一個 userId 呼叫過**;對照同檔 `:224-230` 的 `getCompositionSuggestions` 測試明確用 `caller(12345)` 驗證「非擁有者拋 NOT_FOUND」——同一個測試檔案裡示範了正確的 IDOR regression test 寫法,`checkConsistency` 卻沒套用同款 | 同檔案內「該有的測試模式已經存在但漏用在這條端點上」,是最容易被忽略的一種缺口:表面上檔案「有測試」,實際上關鍵的跨用戶案例被跳過;修 owner 檢查後也無法自動證明修好 | 比照 `:224-230` 的寫法,在 `checkConsistency` 加一條 `caller(12345)` 呼叫同一 `timelineFrameId` 的 case,驗證應 `FORBIDDEN`/`NOT_FOUND` 且不呼叫 `db.updateTimelineFrameConsistency` |

---

## 2. 已有良好測試(negative results——不要重找 bug,這些路徑已被驗證健康)

以下 owner/授權相關測試檔實際讀過內容後確認**確實涵蓋了跨用戶負向案例**,可作為第 1 節「建議測試」的寫法範本,不需要再重新開卡:

| 測試檔:行號 | 涵蓋內容 |
|---|---|
| `server/history-ownership-idor.test.ts:80-163`(AIDV-609) | `history.delete`/`history.rate`/`history.toggleBookmark` 在記錄不屬於呼叫者時皆拋 `NOT_FOUND` 且不呼叫底層 mutation;`loraTrainer.replicateTrainingStatus` 同款 owner 守門 |
| `server/download-ownership-idor.test.ts:104-159`(AIDV-789) | `/api/media/download` 命中 `digitalAssetLibrary` 或 `generationHistory` 才放行,兩表皆查不到 → 403 |
| `server/_core/videoIdorConvergence.test.ts:21-129`(AIDV-236/244/252) | SSE 串流、`checkVideoStatus`、`jobStatus`、`videoProject`/`worldStoryboard` router 均驗證 `job.userId !== user.id` → `FORBIDDEN`,且守門發生在 `doPostGenComplete` 之前(防止資產歸錯帳戶) |
| `server/routers/__tests__/promptLibraryIdor.test.ts:93-157`(AIDV-184) | `incrementUseCount`/`getById` 在旗標 ON 情境下,他人私有 prompt 無共享 → 走 `canAccess` → `NOT_FOUND`;有明確共享才放行 |
| `server/routers/__tests__/feedbackScreenshotOwnership.test.ts:62-109`(AIDV-881) | `feedback.create` 的 `screenshotKey` 做屬主前綴驗證,涵蓋偽前綴、前綴混淆、前導斜線正規化等邊界案例 |
| `server/routers/__tests__/videoAnalytics.ownership.test.ts:38-56`(AIDV-862) | `videoAnalyticsRouter.track` 非擁有者(`userId` 不符)→ `FORBIDDEN` 且不落庫 |
| `server/services/authz/__tests__/resourceAccess.test.ts`(AIDV-121) | `canAccess`/`resolveEffectiveRole` 純函式角色矩陣:owner 全過、他人未共享全擋、`team_shared` 需 `teamId` 相符才過 view/edit(delete 仍擋)——這是**正確**的 team_shared 授權模式,可作為修 S-22(`models.ts:teamModels`)時要接上的中介層範本 |
| `server/team-model-training.test.ts:163-178` | `listTeamModels` 正確以 `getTeamMembership` 檢查,非成員 → `forbidden`(注意:這是 `trainingTrackService.ts` 的路徑,**不是** S-22 指出的 `models.ts:teamModels` 漏洞路徑,兩者不可混為一談,見第 1 節 #5) |
| `server/worldbuilding` 相關:`worldbuildingRouter.test.ts:224-230` | `getCompositionSuggestions` 對非擁有者(`caller(12345)`)拋 `NOT_FOUND` 且不呼叫 LLM——同檔案內 `checkConsistency` 應該比照但沒有(見第 1 節 #9) |

### 已知既有並發/回歸測試(依任務說明採納,未在本次重新驗證範圍內深挖,僅列供交叉參考)
- `deduct`/`refund`/`atomicClaimJobRefund` 有並發回歸測試(W5)。
- `videoCatalogConsistency.test`(影片類一致性)。
- `agent-tool-executor.test` 覆蓋 fallback 路徑,但**未蓋 `requireConfirmation`**(與本次發現的 S-24 `agentToolExecutor.ts:828-849` connector fallbackTools 繞過確認閘屬同一缺口性質,雖不在本次目標清單 S-00/19/21/22/33/34/37/DI-01/05 內,但同屬「確認閘測試缺口」家族,一併提示)。

---

## 3. 重點標記:頂級確認發現中「untested」的優先順序

按嚴重度(P0 且外洩/寫入面最廣)排序,以下 5 項建議最優先補測試(其餘 4 項次之):

1. **S-00**(auth.me,全案最高優先)—— 現有測試斷言太弱,一行負向斷言即可補上,成本極低、風險極高。
2. **S-37**(admin.allUsers,範圍比 S-00 更廣,涵蓋全站每個使用者)—— 現有測試只測角色門,完全沒測資料內容,同樣是低成本高風險缺口。
3. **DI-01**(deleteUserAccount 100% 失敗,GDPR 被遺忘權)—— 零測試,且已知功能本身是壞的,補測試同時也是驗證修復是否生效的唯一手段。
4. **S-33**(langsmith 全站 LLM 對話原文外洩)—— 零測試,8/9 端點暴露面最大。
5. **S-19**(realEarth 私有教材外洩)、**S-21**(brain 全站 prompt/錯誤外洩)、**S-34**(orbClarification 跨用戶寫入)、**S-22**(models team_shared 跨團隊讀取)、**DI-05**(worldbuilding checkConsistency 覆寫)—— 皆為零測試或「同檔案內有範本模式但未套用到漏洞端點」,建議依第 1 節逐項補齊,可直接複製 `history-ownership-idor.test.ts`/`worldbuildingRouter.test.ts:224-230` 的既有寫法。

---

## 4. 需再查(尚未在本次範圍內完整驗證)

- `server/routers/__tests__/rbac.test.ts`(321 行)、`server/services/authz/__tests__/resourceAccessResolver.test.ts`(111 行)內容尚未逐行讀完,可能與 S-01/S-14/S-15(background job / orbTask owner 檢查)有重疊覆蓋,但因不在本次目標清單(S-00/19/21/22/33/34/37/DI-01/05)內,未深入展開,**需再查**。
- `server/routers/admin.ts` 中除 `allUsers`/`allUsersPaginated` 外,是否還有其他洩漏敏感欄位的查詢端點(如 `userActivity`)缺少對應測試,**需再查**(不在本次 9 項目標範圍內)。
