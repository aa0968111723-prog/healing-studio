# RC0 — 並發/競態地圖(TOCTOU/無鎖改寫/多實例)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb

> 稽核方法:每條發現先讀碼定位 file:line,標競態窗口(哪兩步之間、什麼交錯會壞)、cluster、是否已有 CAS/鎖/交易保護。不臆測——無法從碼中直接推導的一律寫「需執行期驗證」。本輪對照 HEAD(`0c145055`,晚於卡片標注的 `812f6fdb` 數個 commit,均為文件卷,未動及本稽核觸及的檔案)逐條覆核 file:line,結果見各節。

---

## 0. 本輪推翻/修正清單(先講,避免誤讀後面當全数成立)

**推翻 1 條**:
- 原始輸入中 `label: "json-field-race"`、`file: "a.ts"`、`title: "test"`、`window: "test"` 一條——`a.ts` 在 repo 中不存在(`find . -iname a.ts` 零命中),內容為佔位測試字串,非可讀碼驗證的真實發現。**判定:推翻/剔除**,不計入下方地圖與計數。

**修正 1 條(部分推翻其比較語意,核心結論保留)**:
- `orbCodeTask.ts` 條目原稱其「是唯一未呼叫 `warnIfMultiInstanceSingleton` 的同類子系統」。實測全庫僅 `orbScheduler.ts:12,540` 與 `planExecutorTools.ts:48,54` 呼叫此函式;`orbIdempotency.ts`(同樣 process-local `Map`,同屬本卡討論的去重/狀態子系統)**同樣沒有呼叫**。故「唯一」的比較語意不成立——它是**又一個**沒掛哨兵的同類子系統,而非孤例。核心發現(in-memory 零持久化、跨 worker 不可見、重啟即失、無 boot-time 警告)本身經讀碼確認**仍然成立**,予以保留並在下方以修正後的措辭記錄。

以下「確認」節僅計入通過覆核的條目,共 **7 條**(原 9 條 − 1 條推翻,1 條修正保留)。

---

## 1. 依 cluster 分節的確認競態

### 1.1 lost-update

#### [critical] billing-race — `profile.updateQuotaJson` 對 `remainingGenerations` 無鎖絕對值 SET,與三條有鎖計費路徑競爭
- **file:line**:`server/routers/profile.ts:8-19`(入口,`z.object({image,video,audio,voice}).min(0)` 僅下限無上限)→ `server/db.ts:932-944`(`updateUserQuotaJson`)
- **窗口**:讀(使用者送出的四個欄位,来自客戶端,無鎖無版本號)→ 寫:`db.ts:940-943`
  ```
  await db.update(users).set({ quotaJson, remainingGenerations: total }).where(eq(users.id, userId));
  ```
  全程無 `transaction`、無 `SELECT ... FOR UPDATE`、無 CAS。此 UPDATE 寫入的是**呼叫當下的絕對值**(`total = image+video+audio+voice`),完全不感知同一區間內另外三條有鎖路徑已經發生的變動:
  - `deductUserPoints`(`db.ts:830-879`,`SELECT...FOR UPDATE` 讀當前值後相對扣減)
  - `refundUserPoints`(`db.ts:898-921`,同構相對加回)
  - `runDueAutoCreditGrant`(`db.ts:649-697`,自動給點,相對加回)
  - 行鎖本身沒有問題(它序列化了「寫入順序」),但 `updateQuotaJson` 語意是「用舊快照算出的絕對值覆蓋」,不是「相對加減」,所以哪怕鎖生效、按順序執行,**後執行的 `updateQuotaJson` 依然會用呼叫當下讀到的舊 quotaJson 把期間發生的扣款/退款/自動給點整包蓋掉**。
- **後果**:使用者在生成任務進行中(佔用點數)呼叫 `updateQuotaJson`(例如切換方案/儀表板刷新配額顯示),可把剛被 `deductUserPoints` 扣掉、或剛被 `refundUserPoints`/`runDueAutoCreditGrant` 加回的點數用舊值覆寫——實際發生方向視呼叫先後可以是「使用者扣點被抹掉→白嫖」或「使用者剛拿到的退款/自動給點被抹掉→少拿」,兩個方向都是 lost-update。
- **是否已有保護**:**無**。與同表同欄位的另外三條路徑保護等級不對稱——後三者都走 `FOR UPDATE`,唯獨這條可從客戶端直接觸發的入口是無鎖絕對值 SET。
- **建議保護機制**:比照 `atomicClaimJobRefund`(`db.ts:2160-2181`)的 CAS 精神,或直接讓 `updateQuotaJson` 走與 `deductUserPoints`/`refundUserPoints` 相同的 `FOR UPDATE` 交易、且改寫成「相對 delta」而非「絕對值 SET」;若業務語意本來就必須是絕對值(例如管理端強制重設配額),則應限定使用場景並在同一交易內讀最新值計算 diff,不能允許使用者端任意觸發覆蓋。

---

### 1.2 toctou

#### [high] billing-race — `updateBackgroundJob` 無條件 UPDATE(無 `WHERE status` 守衛),webhook/polling/staleJobChecker 三條並發完成路徑可互相覆蓋終態與 `resultJson`
- **file:line**:`server/db.ts:2141-2148`
  ```
  export async function updateBackgroundJob(id, data) {
    ...
    await db.update(backgroundJobs).set(data).where(eq(backgroundJobs.id, id));
  }
  ```
  全表更新無任何條件式守衛(如 `AND status = 'processing'`)。
- **窗口**:三條讀路徑各自做「終態短路檢查」後才呼叫寫入,但檢查與寫入之間夾著秒級外部 I/O:
  - `server/routes/webhookFal.ts:198-217` — 讀 `getBackgroundJob` 判斷是否已終態,通過後才繼續(第 219 行後)做 `localizeResultUrls` 等下載/上傳再呼叫 `updateBackgroundJob`
  - `server/routers/generate.ts:2179-2184`(`checkStudioJob`)— 讀 `status !== "processing"` 則直接回傳,否則才向 fal.ai 發 HTTP 查詢(秒級)後更新
  - `server/jobs/staleJobChecker.ts:49`(`getStuckJobsByType`,純 `SELECT status='processing' AND updatedAt < now-5min`)→ 迴圈內第 56 行用**迴圈開始時讀到的 `job.resultJson` 快照**組出新物件整包覆寫(第 61-65 行 `resultJson: {...resultJson, retryCount: newCount}`)
  - 三者之間沒有互斥:webhook 剛把 job 寫成 `completed + resultUrl` 之後,若 `staleJobChecker` 在稍早的掃描週期已經把該 job 讀進 `stuckJobs`(當時仍是 `processing`),它稍後執行到 `updateBackgroundJob(job.id, {status:"queued", resultJson:{...旧快照}})` 時不會再重新檢查目前狀態,會用舊快照把剛完成的 `resultUrl`/`completed` 打回 `queued`,抹掉成品連結。
- **是否已有保護**:**無 WHERE 守衛**,是三條路徑共用的無鎖寫入函式。注意:同檔案內的 `atomicClaimJobRefund`(`db.ts:2160-2181`,`WHERE ... refunded IS NULL`)與 `JSON_MERGE_PATCH` 局部合併寫法(`db.ts:2183-2189` 附近註解提到)已示範了正確模式,但這套模式**只用在退款旗標**,沒有覆蓋到 `updateBackgroundJob` 本身的通用路徑。
- **建議保護機制**:給 `updateBackgroundJob` 增加樂觀 CAS 版本(例如 `WHERE id=? AND status IN (允許的來源狀態)`,終態互斥終態),或至少讓 `staleJobChecker` 在寫回前重新 `SELECT` 一次目前狀態、只在仍為 `processing` 時才更新,避免用迴圈開頭的舊快照整包覆寫。

#### [high] toctou-reward — `models.toggleVisibility` 分享獎勵 check-then-act,與 X12(`assets.toggleVisibility`)同構於另一張表複製,並發雙擊可重複發放模型分享獎勵
- **file:line**:`server/routers/models.ts:727` → `731-733` → `742-751`
- **窗口**:
  1. `727` `const model = await db.getFineTunedModel(input.id)` 讀舊快照,含 `configJson.shareRewarded`
  2. `731-733` 第一次無鎖寫 `visibility`
  3. `742-751` 用**第 727 行讀到的舊 `cfg`** 判斷 `alreadyRewarded = cfg.shareRewarded === true`;若為 `false` 則呼叫 `db.refundUserQuota(ctx.user.id, 3)`(該函式內部雖有 `FOR UPDATE` 保護加點本身的原子性),隨後才 `updateFineTunedModel` 把 `shareRewarded:true` 寫回。
  - `refundUserQuota` 的鎖只保護「加 3 點」這個動作不會算錯,**不保護「資格判斷」**——兩個並發請求都在 `727` 讀到 `shareRewarded !== true` 的同一舊快照,都通過 `744` 的 `!alreadyRewarded` 判斷,各自執行一次 `refundUserQuota(+3)`,兩次加點都成功疊加;最後 `749` 寫回 `shareRewarded:true` 是冪等寫入,不會報錯,也不會留下「重複發獎」的痕跡,只看 `configJson` 最終值會誤以為只發過一次。
- **是否已有保護**:**無**。與 assets.ts 的 X12 已知問題完全同構,是同一模式在第二張表(`fineTunedModels.configJson`)上的複製。
- **建議保護機制**:比照 `atomicClaimJobRefund` 的單一 UPDATE CAS 模式,把「判斷 + 標記」收斂成一條帶條件的 UPDATE,例如 `UPDATE fine_tuned_models SET configJson = JSON_SET(configJson,'$.shareRewarded',true) WHERE id=? AND (JSON_EXTRACT(configJson,'$.shareRewarded') IS NULL OR JSON_EXTRACT(configJson,'$.shareRewarded') != true)`,用 `affectedRows` 判斷是否搶到發獎資格,搶到才呼叫 `refundUserQuota`。

#### [high] toctou-reward(現況確認,不重複計分)— `assets.toggleVisibility` 分享獎勵 TOCTOU(X12 已知問題)覆核 HEAD 仍成立,未修
- **file:line**:`server/routers/assets.ts:233` → `251` → `258-267`
- **窗口**:`233` `getDigitalAsset` 讀舊快照 → `251` 第一次無鎖寫 `visibility` → `259` 用 `233` 讀到的舊 `asset.rewardCredits` 判斷 `alreadyRewarded = (asset.rewardCredits ?? 0) > 0`,為 `false` 則 `261` `refundUserQuota(+2)` 後 `262` 寫回 `rewardCredits: 2`。與 models.ts 新發現同構;`digitalAssetLibrary` 表同樣無 version/CAS 欄位。
- **是否已有保護**:**無**。此為既有 X12 卡(`X12-output-assets-deepdive.md`)與 `RC3-toctou-reward-share.md` 已記錄的問題,本輪只是覆核 HEAD 未變、確認結構性根因(check-then-act 讀寫分離,無 WHERE 條件式 UPDATE)與 models.ts 一致,可合併同一張修復卡處理(見第 3 節串接)。
- **建議保護機制**:同上,單一條件式 UPDATE CAS。

#### [medium] toctou-reward — `rbac.share` 與 `rbac.transferOwnership` 之間無互斥:擁有權移轉「清空全部共享」的原子保證可被並發 `share` 呼叫繞過
- **file:line**:`server/routers/rbac.ts:144`(share 的 `requireOwner`)、`159-172`(驗證+寫入共享)、`258`(transferOwnership 的 `requireOwner`)、`281-285`(呼叫 `transferResourceOwnershipAndWipeShares`,單一 transaction,見 `server/db.ts:4772` 起)
- **窗口**:
  - `share`:`144` 讀當下 owner 快照 → `159-163` `validateShareTarget` → `165-172` `upsertResourceShare` 寫入。
  - `transferOwnership`:`258` `requireOwner` 讀 owner 快照 → `281-285` 呼叫單一 transaction(先改 owner 欄位、再清空 `resource_shares`,已用 AIDV-186 修正為原子交易,交易本身無競態)。
  - 若 `transferOwnership` 的整個 transaction 在 `share` 的 `144`(讀到自己仍是 owner)之後、`165`(寫入共享列)之前完整提交(owner 已變更、`resource_shares` 已清空),`share` 請求並不會重新檢查 owner 是否已變——它仍會在清空之後繼續執行 `165` 插入新共享列。該列建立時間晚於 `transferResourceOwnershipAndWipeShares` 的清空動作,**不會被任何後續清理動作移除**,成為新 owner 治理下的殘餘授權(舊 owner 分享出去的訪問權在轉移後意外續存)。
- **是否已有保護**:transfer 內部的「改 owner + 清 shares」已有交易保護(AIDV-186),但 **transfer 與 share 兩個端點之間**沒有互斥——沒有版本號/樂觀鎖能讓 `share` 在寫入前偵測「owner 已在我讀取之後變更」。
- **建議保護機制**:`upsertResourceShare` 寫入前應在同一交易內重新 `SELECT owner FOR UPDATE`(而非僅在請求開頭做一次 `requireOwner` 快照檢查),或讓 `resource_shares` 攜帶 `resource_owner_version`,寫入時 `WHERE owner_version = 快照版本`,不符則要求呼叫端重新整理後重試。

---

### 1.3 multi-instance

#### [high] `orbIdempotency.ts` 請求/任務去重為 process-local `Map`,多實例下可各自誤判「新請求」,重複觸發付費生成任務與 LLM 呼叫
- **file:line**:`server/services/orbIdempotency.ts:17-18`(`store`/`requestIdStore` 均為 `Map`)、`50`(`checkAndLock`)、`111`(`findDuplicateTask`)
- **窗口**:replica A 上 `checkAndLock`/`findDuplicateTask` 記錄 in-progress/duplicate 標記的同時,同一 `requestId` 或同文字+附件在 TTL(60s/5s)內被路由到 replica B——B 的 `Map` 看不到 A 的紀錄,兩邊都判定為 `new` 並各自完整執行(呼叫端見 `server/routers/ai.ts:537-551`、`1582-1601`)。
- **是否已有保護**:**無跨實例保護**,且**未呼叫 `warnIfMultiInstanceSingleton`**(全庫僅 `orbScheduler.ts`、`planExecutorTools.ts` 有呼叫,見第 0 節修正說明)。單實例下此 `Map` 本身邏輯正確(同進程內序列化正常),問題僅在水平擴展後浮現。
- **建議保護機制**:去重狀態遷移到 Redis(專案已有 `getRedisClient`,參見 `staleJobChecker.ts:14`)或 DB 唯一鍵約束 + `INSERT ... ON DUPLICATE KEY`/`SELECT ... FOR UPDATE` 語意,並補上 `warnIfMultiInstanceSingleton` 啟動期警告(即使暫不重構,至少讓維運知道現況風險)。

#### [medium] `orbCodeTask.ts` 的 `codeTaskStore` 為零持久化 in-memory `Map`,跨 worker 不可見且重啟即遺失(未呼叫 `warnIfMultiInstanceSingleton`,但非孤例)
- **file:line**:`server/services/orbCodeTask.ts:11`(`const codeTaskStore = new Map<string, OrbCodeTask>()`)、`105`(寫入)、`121/125/131/150/169/189/213/234/275`(各處讀取)、`321`(`clear()`)
- **窗口**:`createOrbCodeTask` 在 replica A 寫入 `Map` 後,後續輪詢 `getOrbCodeTask`/狀態更新請求被路由到 replica B 時回傳 `null`(跨實例不可見);任一 replica 重啟則該 replica 全部進行中任務狀態消失,無 disk/DB fallback,也無 boot-time 警告。
- **修正後的比較語意**:本輪覆核發現,呼叫 `warnIfMultiInstanceSingleton` 的檔案全庫只有 `orbScheduler.ts` 與 `planExecutorTools.ts` 兩處——`orbIdempotency.ts` 同樣是無哨兵的 in-memory 單例子系統。故 `orbCodeTask.ts` 並非「唯一」未掛哨兵者,而是這類「in-memory 單例、缺乏跨實例告警」問題在此codebase 的**第三個實例**(與 orbIdempotency.ts 並列)。核心發現(零持久化、跨 worker 不可見、重啟即失)不受此修正影響,仍然成立。
- **是否已有保護**:**無**。
- **建議保護機制**:同上,遷移至 Redis 或 DB 表,並在啟動期對所有此類 in-memory 單例(至少 `orbIdempotency.ts`、`orbCodeTask.ts`)統一補 `warnIfMultiInstanceSingleton` 呼叫,不要求本輪立即重構,先做到「至少讓維運知道」。

---

## 2. 單實例 vs 多實例分層(該不該現在修的判準)

> 這一層是本卡最關鍵的產出:**同一份「無鎖/TOCTOU」清單裡,有些現在(單一 Railway/單容器部署)就會壞,有些要等到水平擴展成多副本才會現形。** 誤把後者當前者修,會浪費工分;誤把前者當後者晾著,會現在就在生產環境流血。

### 2.1 單實例現在就會壞(不需要水平擴展,單一 process 內並發請求/計時器即可觸發)

| 發現 | 觸發條件 | 為什麼單實例也會壞 |
|---|---|---|
| `profile.updateQuotaJson` lost-update | 使用者連續/並發呼叫配額更新,恰與扣款/退款/自動給點時間重疊 | 這是應用層邏輯競態(絕對值 SET vs 相對值鎖),與 process 數無關;單一 Node process 的兩個並發請求交錯執行 await 之間就能觸發 |
| `updateBackgroundJob` 無 WHERE 守衛(webhook/polling/staleJobChecker 互覆) | webhook 到達、前端輪詢、cron 排程三者本來就在同一實例內並發跑 | staleJobChecker 是 cron(`node-cron`),webhook 是 HTTP 入站,前端輪詢是另一條 HTTP 入站——三者在單一 process 內天然並發,不需要第二個副本 |
| `models.toggleVisibility` / `assets.toggleVisibility` 分享獎勵 TOCTOU | 使用者雙擊、或前端 optimistic UI 重送 | 純粹是同一 process 內兩個並發 request handler 交錯,單實例即可复現(已知 X12 卡即是在單實例語境下發現) |
| `rbac.share` vs `rbac.transferOwnership` | 兩個不同使用者(或同使用者兩個分頁)並發呼叫 | 同一 process 內兩個並發 mutation,無需多副本 |

**結論**:上面 4 條屬於「**現在就該修**」,與部署拓樸無關,水平擴展與否都不影響其可觸發性——這些應優先於任何「等擴容了再處理」的排程。

### 2.2 只有水平擴展(多副本)才出事

| 發現 | 單實例下的實況 | 多實例才浮現的原因 |
|---|---|---|
| `orbIdempotency.ts` process-local `Map` 去重 | 單實例下邏輯正確——同進程共享同一 `Map`,能正確攔截重複請求 | 只有請求被負載平衡器路由到不同副本時,各副本的 `Map` 互不可見,才會誤判為「新請求」重複觸發 |
| `orbCodeTask.ts` codeTaskStore in-memory | 單實例下「跨 worker 不可見」不成立(只有一個 worker);但「重啟即遺失」這一半風險**單實例也成立**(deploy/crash 重啟就丟任務狀態) | 「跨副本不可見」需要 ≥2 副本才能觀察到;但要注意這條發現其實是兩個風險的疊加,其中一半(持久化)與副本數無關 |

**結論**:這兩條的「跨實例不可見」風險目前是否已在生產環境發生,取決於 healing-studio 目前的實際部署副本數——**需執行期驗證**(查 Railway/部署設定是否為單一 replica;若確認長期單副本,這兩條可降級為「未來擴容前置卡」而非本輪立即修復項;若已是多副本或即將擴容,應提前到 2.1 同等優先級)。`orbCodeTask.ts` 的「重啟即遺失」半條例外——這部分即使單實例也已经是現行風險,不受此判準保護。

---

## 3. 串接既有卡(避免重複開票)

- **W1 `jobsJson` 讀改寫無鎖**(`PS-02`,`batchGenerateWithSession`)——與本卡 1.2 節 `updateBackgroundJob` 無 WHERE 守衛屬於同一大類(背景任務欄位無鎖改寫),但 W1 針對的是 `jobsJson` 陣列欄位、本卡針對的是 `updateBackgroundJob` 整體函式無條件 UPDATE,兩者是同一子系統的不同欄位/不同函式,建議在同一張「背景任務並發改寫」修復卡下合併治理,勿分開各修一半。
- **X12 獎勵 TOCTOU 重複發獎**(`assets.toggleVisibility`,`X12-output-assets-deepdive.md` / `RC3-toctou-reward-share.md`)——本卡 1.2 節確認 HEAD 仍未修,且發現 **models.ts 有同構複製品**(`models.toggleVisibility`)。建議兩者合併成一張「分享獎勵 CAS 化」卡一次修完,而非各表各修一次(未來若還有第三張表走同一模式,也該一併掃)。
- **R15 FSM(`orbTaskStore.ts`)重啟即失**(`PS-01`)——與本卡 1.3 節 `orbCodeTask.ts` 屬於同一類「AI 自主續跑相關狀態,in-memory 零持久化」風險,但分屬不同子系統(orbTask FSM vs orb code task)。若後續要開「AI 自主續跑」旗標,建議把 R15、`orbCodeTask.ts`、以及本卡新增的 `orbIdempotency.ts` 三者列為同一個「持久化前置」清單一次盤點,不要逐一補丁。
- **W9 4 worker 只有 process-local boolean 鎖**(`PS-04`,`mediaArchivalCron`/`modelTrainingWorker`/`teachingArchiveIngestionWorker`/`assetCleanupJob`)——與本卡 1.3 節同屬「process-local 狀態在多實例下失真」母題,但 W9 談的是「任務認領鎖」、本卡談的是「請求去重 Map」與「任務狀態儲存」,三者(W9 worker 鎖、orbIdempotency 去重、orbCodeTask 儲存)可以共用同一套「Redis 分散式鎖/去重基礎設施」解決,建議合併規劃基礎設施而非各自為政補丁。

---

## 4. 給 Bruce:並發面最該先上鎖的 3 條

1. **`profile.updateQuotaJson`(`server/db.ts:932-944`)——critical,且現在就會壞。** 這是本輪最高風險項:它與已驗證紮實的 `deductUserPoints`/`refundUserPoints`/`atomicClaimJobRefund` 三件套保護等級完全不對稱,一條使用者可直接觸發的端點就能把整套計費鎖的成果覆蓋掉。建議直接讓它走 `FOR UPDATE` + 相對 delta,或至少加上「讀最新值計算 diff 再寫」的交易包裹,不要再用「呼叫當下絕對值 SET」。
2. **分享獎勵 TOCTOU(`assets.toggleVisibility` + `models.toggleVisibility`,現在就會壞,雙擊即中)。** 兩張表同一漏洞模式,建議一次性用 `atomicClaimJobRefund` 已驗證過的單一條件式 UPDATE CAS 手法收斂掉,順便掃一遍是否還有第三個「分享得獎勵」入口用了同款 check-then-act。
3. **`updateBackgroundJob`(`server/db.ts:2141-2148`)無 `WHERE status` 守衛,現在就會壞。** webhook/輪詢/staleJobChecker 三條完成路徑目前互相不設防,已有一次「用舊快照整包覆寫」的具體可讀碼路徑(staleJobChecker 迴圈快照)。建議加 CAS 條件(比照同檔案內 `atomicClaimJobRefund` 的寫法),防止任何一條路徑用過期狀態打回終態任務。

`orbIdempotency.ts`/`orbCodeTask.ts` 的多實例風險與 `rbac.share`/`transferOwnership` 的中風險殘餘授權問題,可排在這 3 條之後——前者是否已經是現行生產風險需先確認目前副本數(需執行期驗證),後者影響面較窄(僅限有共享後又被移轉所有權的資源)。

---

## 附:計數
- 輸入原始發現:9 條(不含 `refutedCount` 欄位標注的 0)
- 本輪推翻:**1 條**(`a.ts`/"test" 佔位假資料)
- 本輪修正保留:**1 條**(`orbCodeTask.ts` 的「唯一」語意修正,核心發現保留)
- 最終計入地圖:**7 條確認**(lost-update ×1、toctou ×4、multi-instance ×2)
