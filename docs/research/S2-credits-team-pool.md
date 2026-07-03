# S2 — Credits/計費模式重設計:15-20 人內部團隊(產品策略 wave S)

- 產生日期:2026-07-03
- 依據 commit:`7f4417da`
- 定位:**產品策略 wave S**——不寫程式碼,只設計。前置研究依據 N4-cost-ops-decisions.md(決策卡 3/8)、A-cost-integrations.md(§2.6、§3.4)、H1-model-costs.md(§3 credits.pricingCatalog)、R4-cost-ledger-deepdive.md(全鏈)、D-adoption.md §4.7-4.9(業界 credit 通則)。本文件另外實讀 `server/routers/credits.ts`、`plans.ts`、`admin.ts`、`drizzle/schema.ts`(users/subscription_plans/user_subscriptions/teams/team_memberships)、`server/services/orbQuota.ts`。所有「業界通則」引用一律標明 D 文件出處(D 已附外部連結,本文件不重複列 URL)。
- 讀法:同 N4 慣例——每個判斷標注「[程式碼事實]」(有 file:line 佐證)或「[策略設計]」(本文件的新提議,尚未有程式碼佐證,需要 Bruce 拍板才進開發)。

---

## 1. 現況盤點:個人獨立點數 + 三層限流 + 自動給點 + Stripe 骨架

### 1.1 點數本體——單一可變整數,無帳本

- `users.remainingGenerations`(`drizzle/schema.ts:53`):`int` 型別,`default(50)`,**單一可變整數**,扣款/退款皆「就地 mutate」(`server/db.ts` `deductUserPoints`/`refundUserPoints`,R4 §4)。**無 idempotencyKey、無交易 log**——R4 §4 明確指出這是全鏈中冪等性最弱的一段,而它是唯一真正影響使用者餘額的路徑。
- `users.quotaJson`(`schema.ts:42-47`):`{image, video, audio, voice}` 四模態配額,`updateUserQuotaJson`(`server/db.ts`)寫入時會把四模態加總覆蓋 `remainingGenerations`——**quotaJson 目前只是「設定 remainingGenerations 初始值的一種輸入介面」,不是獨立生效的按模態限流**;實際扣點檢查的是 `remainingGenerations` 這個單一數字,不分模態。這是一個常見誤解點:管理員以為設了「圖 20/影 5」就會分別限流,實際上只是加總成一個池子。
- `credits.ts:66-67`(`myBalance`):`totalSpentPoints = getUserCostSummary().totalCost(USD) × 100`——花費統計走 `api_usage_logs`(舊表),餘額走 `users.remainingGenerations`(另一套),**兩者從未在扣款當下互相核對**(R4 §4 第二點)。
- `credits.pricingCatalog`(`credits.ts:10-47`):`publicProcedure`,**無需登入**即可拿到 200 條模型定價(H1 §3)——這是唯一做得完整的「成本透明」入口,但只列 basePoints/unit/tier,不含「這次生成為什麼扣這麼多點」的個案說明。

### 1.2 三層限流——彼此獨立、口徑不一致

| 層 | 位置 | 規則 | 狀態 |
|---|---|---|---|
| 點數餘額 | `users.remainingGenerations` | 扣完歸零即 `PAYMENT_REQUIRED` | 恆生效(唯一「金額制」的層) |
| 記憶體日限額 | `orbQuota.ts:27-32` `DAILY_LIMITS` | planner 200 / generation 40 / multimodal_analysis 30 / code_task 12,`userDailyCounters` Map,**進程重啟即歸零** | 恆生效,但「次數制」不分模型貴賤(N4 決策卡 3 已指出:圖片生成 $0.01-0.05 與導演批次 $39-68 在此算「1 次」一視同仁) |
| DB trigger 限流 | Supabase `creator_job_throttle`(A §2.6) | 20 tasks/hr | 恆生效,獨立於前兩層,口徑(小時 vs 天)不同 |
| Guard 旗標 | `ENABLE_ORB_QUOTA_GUARD`/`ENABLE_ORB_BUDGET_GUARD`/`ENABLE_ORB_IDEMPOTENCY_GUARD` | 三個已寫好、開了才生效 | **預設全 OFF**(N4 決策卡 3、A §2.6)——目前唯一的「防線」是三層限流本身,guard 是尚未啟用的加強層 |

**現況總結**:三層限流是「次數/頻率制」,只有點數餘額是「金額(換算)制」,但點數餘額本身又不區分「這次操作有多貴」——`orbQuota.ts` 的 40 次/天配額對圖片與導演批次一視同仁,是 N4 決策卡 3 已指出的政策與成本量級脫節問題,本文件在 §4 承接處理。

### 1.3 自動給點——已是「內部配額治理」雛形,但只有個人維度

- `users.autoCreditEnabled/autoCreditAmount/autoCreditIntervalDays/autoCreditNextAt/autoCreditLastAt`(`schema.ts:48-52`)+ `admin.updateAutoCreditPolicy`(`server/routers/admin.ts:43-62`,**`leaderOrAdminProcedure`——組長就能操作,不限 admin**)+ `admin.runAutoCreditNow`(`admin.ts:64-67`,手動觸發批次)+ 對應的 15 分鐘 cron `userAutoCreditJob`(A §2.1)。
- **這已經是「內部配額治理工具」的完整雛形**:leader 可以幫下屬設定「每 N 天自動補 M 點」——這正是本文件 §4 要求的「非收費、防失控+公平分配」政策工具的既有地基,只是**目前的分配單位是「使用者」,沒有「團隊」這一層**。
- `admin.teamCostSummary`(`admin.ts:75-91`,同樣 `leaderOrAdminProcedure`)已經在做「跨使用者成本彙總」查詢——`getTeamCostSummary()`(`server/db.ts:2115-2129`)`GROUP BY apiUsageLogs.userId`,回傳每位使用者的 totalCost/totalRequests/totalTokens/totalCredits。**這個查詢的名字叫「team」但實際上是「全部使用者攤平列表」,沒有真正的 team 分組**——是本文件 §2 要補的關鍵缺口之一。

### 1.4 Stripe 骨架——確認為零收入狀態

- `routes/stripeWebhook.ts` handler 全 TODO(A §1.5),`plans.ts`(`server/routers/plans.ts`)只有 `list`/`getById` 兩個唯讀 `publicProcedure`,**無購買/checkout mutation、無 UI**。`subscription_plans` 表(`schema.ts:746-767`)有 `tier`(free/starter/pro/enterprise)、`priceMonthly`、`quotaAllocation`(四模態)——是為「對外收費」設計的骨架,`priceMonthly` 欄位在內部團隊情境下無意義。
- `user_subscriptions`(`schema.ts:1977-2003`)有完整 Stripe 欄位(`stripeCustomerId`/`stripeSubscriptionId`/`status`/`currentPeriodStart/End`/`cancelAtPeriodEnd`)——**這是收費 SaaS 的資料模型,不是內部配額治理的資料模型**。`planId` 是 `varchar` 自由字串(非 FK 對 `subscription_plans.id`),兩表甚至沒有嚴格關聯。
- **結論**:plans/subscriptions 這組資料模型與內部團隊治理需求(誰能用多少、誰超支、誰該被告警)完全不對應,是「為了未來對外收費預留的空殼」,本文件 §4 建議**不繼續往這個方向補 UI**(理由見 §4)。

### 1.5 團隊資料模型——已有 teams/team_memberships,但只綁「素材可見度」

- `teams`(`schema.ts:4146-4160`)+ `team_memberships`(`schema.ts:4165-4196`)已存在(0053 migration),`teamsRouter`(`server/routers/teams.ts`)有 create/list/get/updateMemberRole/transferOwnership,角色矩陣 owner/admin/member。
- 但這組 team 概念目前**只用於教材庫(teachingArchive)可見度範圍**(D §1.2「teams 治理半成品」:`TEAMS_COLLAB` 旗標 OFF、DB 無 FK)——**沒有任何欄位或表把 `teams.id` 跟「點數/預算」關聯起來**。這是本文件 §2 團隊池設計的**現成掛載點**,不需要新建團隊概念,只需要在既有 `teams` 之上加一張池表。

### 1.6 現況缺口小結(對照 D §4.7 業界通則:「團隊共享池+admin per-user 上限+閾值告警」)

| 業界通則要素 | 本站現況 |
|---|---|
| 團隊共享 credit 池 | **無**——每人獨立 `remainingGenerations`,`teams` 表存在但不掛額度 |
| admin 設 per-user 上限(池內配額) | **無**——`updateQuota`/`updateAutoCreditPolicy` 都是對單一 userId 操作,沒有「團隊池分下去」的中介層 |
| 閾值告警(個人或 workspace) | **半有**——`apiUsageAlertJob`(15 分 cron,`AI_MONTHLY_BUDGET_USD` 預設 500)是**全站單一閾值**告警,無「按團隊」或「按使用者」的分層閾值;`admin.teamCostSummary` 是唯讀彙總,無告警掛勾 |
| 消費透明(每次生成花多少、為什麼) | **半有**——`credits.pricingCatalog` 公開目錄存在,但沒有「這次生成」個案說明頁(見 §3) |

---

## 2. 團隊池設計

### 2.1 資料模型:在既有 `teams` 之上加池,不重造團隊概念

**[策略設計]** 新增一張 `team_credit_pools`(1:1 掛 `teams.id`),而非把池子塞進 `subscription_plans`/`user_subscriptions`(那組是收費骨架,語意不合,見 §1.4/§4)。

```
team_credit_pools
  id                 PK
  teamId             FK → teams.id (unique,1 team = 1 pool)
  totalPoints        int  — 池子總量(leader/admin 設定,類比現行 autoCreditAmount)
  usedPoints         int  — 本期已耗用(由扣款流程累加,見 2.3)
  periodStart        timestamp
  periodEnd          timestamp  — 池子週期(比照 autoCreditIntervalDays 概念,例如每月一補)
  perUserCapPoints   int  nullable — admin 設的「個人在此池內單期上限」,對應 D §4.7 Runway
                         Enterprise Credits 的「per-user 上限」
  alertThresholdPct  int  default 80 — 池用量達此百分比觸發告警(對應 D §4.7「閾值通知」)
  status             enum(active, paused, closed)
  createdAt / updatedAt
```

```
team_credit_pool_ledger   -- 池內部帳本(append-only,呼應 cost_ledger 設計精神,見 R4 §5 建議 4)
  id                 PK
  poolId             FK → team_credit_pools.id
  userId             FK → users.id  — 誰花的
  deltaPoints        int  — 負值=扣款、正值=退款/補點
  refType/refId      — 對應哪一筆 generation_history/background_jobs(供對帳追溯)
  idempotencyKey     unique — 從一開始就補上冪等鍵,不重蹈 R4 §4 指出的
                         deductUserPoints/refundUserPoints 無 idempotencyKey 的舊坑
  createdAt
```

**設計理由**:
- 沿用 `cost_ledger` 已驗證的「append-only + idempotencyKey」模式(`drizzle/schema.ts:2135-2158` 註解已經寫明這是「基礎版待升級」的方向),而不是重蹈 `users.remainingGenerations` 「單一可變整數就地 mutate」的舊坑——R4 §4/§6 建議 4 明確指出這是全鏈冪等性最弱的一段,新設計不應該再犯。
- `perUserCapPoints` 對應 D §4.7 引用的 Runway Enterprise Credits 模式(「workspace 全員共用,同時可設個人或 workspace 超額閾值即通知」)——這是業界驗證過的「共享池+個人上限」雙層結構,不是本站自創。

### 2.2 與現有 `users.remainingGenerations` 的遷移路徑

**[策略設計]** 三階段遷移,避免一次性大改動打斷正在跑的扣款鏈:

1. **階段一(並行,不遷移)**:新增團隊池表與扣款邏輯,但先只做「檢查」不做「唯一真相來源」——扣款時**先扣 `users.remainingGenerations`(不動現行邏輯)**,若使用者屬於某個啟用池的團隊,**同時**寫一筆 `team_credit_pool_ledger`(deltaPoints 同步記錄,供彙總與告警用)。這一步零風險,因為個人餘額扣款路徑完全不變,只是多一份影子紀錄。
2. **階段二(池成為配額上限,個人餘額成為池的展現層)**:對已加入啟用團隊池的使用者,扣款檢查改成「先查 `remainingGenerations` 是否 > 0(維持現行 UI 不用大改)**且**團隊池 `usedPoints < totalPoints`(以及 `perUserCapPoints` 未超)」——兩個條件都要過。此階段個人配額仍存在,但團隊池變成一個额外的天花板,而不是取代個人配額。
3. **階段三(可選,視 Bruce 拍板決定要不要走到這一步)**:對已完全遷移進團隊池的使用者,`remainingGenerations` 不再是限流依據,只作為「個人本期已用/剩餘」的展示欄位(從池 ledger 反算),真正配額判斷全部走池——這一步等於把「個人獨立點數」正式升格成「團隊池的個人分配視圖」,是 D §4.7 業界模式(workspace 共用池)的完整落地。**這一步涉及既有『個人點數是我自己的』心智模型改變,是需要 Bruce 拍板的政策點(§5)**,不建議未經明確決策就做。

不建議一次性遷移(直接把 `remainingGenerations` 歸零、全部改讀池)的原因:現行 `deductUserPoints`/`refundUserPoints`(R4 §4)呼叫點分散在 `proStudio.chargeForFalTask`、`director.autoGenerateFromSegments`、`generate`/`imageStudio`/`videoStudio` 等多處(H1 §0),一次性換血牽動面過廣,階段化遷移能讓每一步都可獨立回退。

### 2.3 admin 怎麼分配/監控

**[策略設計]** 直接擴充既有 `leaderOrAdminProcedure` 的角色分工(不需要新 RBAC 概念——`users.role` 已有 `leader`/`admin` 兩級,`schema.ts:38-40`):

- **分配**:新增 `admin.createTeamCreditPool`/`admin.updateTeamCreditPool`(`leaderOrAdminProcedure`,比照現行 `updateAutoCreditPolicy` 的權限層級)——leader 可以幫自己的團隊設池子總量、個人上限、週期;`admin` 可以跨團隊操作。介面上直接沿用「成本金流」分頁(admin.ts 註解已提到這個既有分頁)加一個「團隊池」子分頁,不需要新開一整套 UI 骨架。
- **監控**:擴充 `admin.teamCostSummary`(`admin.ts:75-91`)——現行是 `GROUP BY userId` 的全域列表,加一個 `GROUP BY teamId` 的版本(`db.getTeamCostSummary` 需要新增依 `team_memberships` join 的變體),讓 leader 打開分頁直接看到「我的團隊本期用了池子的多少%、誰用最多、誰快超過 perUserCapPoints」。
- **告警**:擴充現行 `apiUsageAlertJob`(A §2.1,15 分鐘 cron,已有 Slack webhook 管線 `sendSlackAlert`)——加一段「逐團隊池檢查 `usedPoints/totalPoints` 是否超過 `alertThresholdPct`」,達標時對該團隊的 leader(而非全站籠統告警)發送。**這是重用現有 cron+Slack 管線,不需要新建告警系統**,只是把現行「全站單一 `AI_MONTHLY_BUDGET_USD` 閾值」升級成「逐池閾值」。
- 這個設計完整對齊 D §4.7 引用的業界通則原文:「Enterprise 為年約共享 credit 池,全 workspace 有生成角色者共用;admin 可設『個人或 workspace 超過 credit 閾值即通知』」——本站只是把「workspace」換成既有的「team」概念、把「年約」換成「內部週期」。

---

## 3. 成本透明:創作者可見「這次生成花幾點、為什麼」

R4 §3/§5 的核心發現是:三套記帳(`api_usage_logs`/`ai_usage_events`+`cost_ledger`/`cost_aggregations`)從未彼此核對,且 `costLedgerReconcileJob` 因為旗標耦合意外沒真正跑過(R4 §1-2)。這代表**內部帳本本身還不夠可信,不適合直接把三套記帳的原始數字攤給一般創作者看**——會把系統內部尚未修好的不一致,直接曝露成使用者困惑。本文件的成本透明設計因此鎖定「單次生成的個案說明」,不做「歷史帳本核對頁」(那是 R4 §6 建議的工程債,需先修完旗標拆分才能對外呈現)。

### 3.1 現況已有的可重用件

- `credits.pricingCatalog`(`credits.ts:10-47`):公開模型單價目錄,含 basePoints/unit/tier/pointsPerSecond 等完整計費公式參數。
- `modelPricing.ts` 的 `estimatePoints` 公式(H1 §0):`basePoints + 超秒×pointsPerSecond + ceil(字數/1000)×pointsPer1kChars + 超圖×pointsPerImage + 訓練步數×pointsPerStep`——公式本身已經是逐項可拆解的,只是目前只餵給扣款邏輯,沒有把拆解結果回吐給使用者。
- `credits.myBalance`(`credits.ts:55-82`)已有 `topModel`/`totalSpentPoints`/`usedPct`——是「累積」視角,缺「單筆」視角。
- `refundStatus.ts`(`credits.jobRefundStatus`,`credits.ts:95-101`)已經是「單一任務」層級的透明化先例(AIDV-650)——這是本文件建議的成本透明頁最貼近的既有模式,可以直接沿用它的設計語言(單任務查詢、`none/not_refunded/partial/full/unknown` 狀態機)。

### 3.2 缺口與設計

**[策略設計]** 新增「這次生成花多少點/為什麼」個案說明,掛在現有生成結果卡片上(不需要新頁面),資料完全來自已存在的欄位,零新資料收集:

1. **扣點明細 breakdown**:`estimatePoints` 目前只回傳一個總數(H1 §0 提到 breakdown 欄位在「未知模型 fallback」時才有文字說明,如「未知模型(標準計費 5 pts)」)。建議讓 `estimatePoints` **對所有路徑都固定回傳一組結構化 breakdown**(base/超時長/超字數/超張數/訓練步數 各自的 pts 貢獻),扣款時把這組 breakdown 存進 `generation_history`(或既有的 job resultJson,比照 `refundStatus.ts` 讀 `background_jobs.resultJson` 的既有模式)。前端在生成結果卡片加一個「為什麼扣 N 點?」的展開區,直接讀這個 breakdown 逐項列出——例如「flux-pro/v1.1 基礎 4 pts + 無額外加成 = 4 pts」或「kling v2.1 pro 基礎 49 pts(含 5 秒)+ 5 秒超時 × 9.8 pts/秒 = 98 pts」。
2. **模型檔次標示**:結果卡片上直接標出這次用的模型 tier(economy/standard/premium/ultra,`modelPricing.ts` 已有此欄位),讓創作者知道自己選了貴檔還是便宜檔,呼應 N4 決策卡 1 的「使用者可手動切模型檔次」入口設計。
3. **光球/導演 LLM 對話的透明化**:H1 §2.2/N4 決策卡 1 指出光球對話**完全不扣點**(平台吸收),這對創作者是「隱形」的——不需要讓創作者看到 USD 數字(那是平台內部成本,不該外洩,H1/A 都提到 baseCostUsd 刻意不對外),但**可以**讓創作者知道「這次對話用的是 Opus 檔(較貴,回應通常較細緻)還是 Haiku 檔(較快,回應較精簡)」,幫助他們理解為什麼有時候光球回覆風格不同——這是免費資訊揭露,不涉及金額。
4. **團隊池視角的透明化**(承接 §2):個人在團隊池內的頁面補一行「本期團隊池已用 X/Y pts,你個人用了 Z pts(團隊平均 W pts)」——比照 D §4.9 引用的「credit 儀表板透明度是使用者信任基礎」通則,讓創作者理解自己的用量在團隊裡是高是低,而非只看到孤立的個人數字。

### 3.3 明確不做的部分(避免曝露系統尚未修好的內部不一致)

- 不把 `ai_usage_events`/`cost_ledger`/`cost_aggregations` 三表的原始數字或彼此的差異直接暴露給一般創作者——R4 §1-2 指出這三者目前在旗標耦合下已有結構性對不上的風險,曝露出去只會製造困惑而非透明。
- 不承諾「這是真實供應商帳單金額」——`modelPricing.ts` 是 2025 Q2 人工定價表(R4 §3),對創作者的措辭應該是「本次消耗積分」而非「本次花費 USD」,避免暗示點數與真金流有精確兌換關係(尤其在內部團隊、非收費情境下,見 §4)。

---

## 4. 內部團隊定位:配額是治理工具,不是收費工具

### 4.1 為什麼不該把 plans/Stripe UI 補完

**[策略設計]** N4/A/D 都已確認:Stripe 是零收入骨架、`subscription_plans`/`user_subscriptions` 是為對外收費設計的資料模型(§1.4)。15-20 人是**已知身份的內部團隊**,不是要防止陌生人白嫖的公開產品——把 plans 頁面做完(定價卡、checkout 流程)對這個場景沒有意義,只會多一套要維護的 UI 假裝在收錢。**建議明確定調:plans/Stripe 骨架維持現狀凍結(不投入開發),點數系統完全走「內部配額治理」路線**,`subscription_plans` 表如果要用,retire 成「純粹的角色分級範本」(例如把 `tier` 概念借來做「resident/senior/lead 創作者的預設配額範本」,但拿掉 `priceMonthly`/Stripe 欄位的语意)。

### 4.2 內部配額治理政策設計(防失控 + 公平分配)

**[策略設計]** 兩個目標分開設計,因為機制不同:

**(a) 防失控**——鎖定「單次尖峰」而非「日常次數」:
- N4 決策卡 3 已指出核心問題:現行 40 次/天配額對「圖片生成($0.01-0.05)」與「導演批次一鍵($39-68)」一視同仁地算 1 次。**建議把導演批次類操作(`autoGenerateFromSegments`)獨立出一個「單次操作點數上限」規則**,而非與日常生成共用 40 次額度——例如「單次操作預估點數超過 X(例如 500 pts ≈ $5)時,無論日配額還剩多少,都要求二次確認」,這比「調高或調低日配額次數」更貼近實際風險(尖峰單擊,而非累積次數)。
- 呼應 N4 決策卡 3 建議 (a):三個 guard 旗標(`ENABLE_ORB_QUOTA_GUARD`/`BUDGET_GUARD`/`IDEMPOTENCY_GUARD`)全開,是「已寫好、零開發成本」的第一道防線,應該最先做,且獨立於本文件的團隊池設計(兩者互補:guard 防單次尖峰,團隊池防週期性總量失控)。

**(b) 公平分配**——鎖定「團隊內部資源分配是否合理」:
- 團隊池(§2)本身就是公平分配的載體:15-20 人的池子讓 leader 看得到「誰用最多」,可以主動溝通調整,而不是像現在每人自帶 50 點互不相干、無法從團隊視角判斷「這樣分配合不合理」。
- `perUserCapPoints`(§2.1)是防止「少數重度使用者吃掉全隊配額」的機制,對應 D §4.7 業界通則的「per-user 上限」——但**上限值本身怎麼定,是需要 Bruce 或團隊 leader 依角色(誰是主力創作者、誰是輕度使用)拍板的政策問題,不是本文件能代為決定的技術參數**。
- `autoCreditIntervalDays`(現行 7 天預設,`schema.ts:50`)這個「自動補點週期」概念,可以直接沿用到團隊池的 `periodEnd` 設計(§2.1)——不需要另外發明新的週期語意。

### 4.3 措辭與心智模型的調整

**[策略設計]** 因為是內部團隊、非收費,點數相關的所有 UI 文案應該從「消費/購買」語言改成「配額/預算」語言——例如 `myBalance` 頁面現在的 `remaining`(剩餘點數)概念上沒問題,但如果之後要在團隊池 UI 上呈現,建議用「本月配額」而非「餘額」這種暗示金錢帳戶的詞,降低使用者誤以為點數等同真實金錢、或誤以為用完會被要求付費的疑慮——D §4.9 提到的「credit 儀表板透明度是信任基礎」在這裡的意涵是「信任這個數字代表什麼」,而不是「信任這是精確的錢」。

---

## 5. 重用清單 + 要補什麼 + 分階段 + 需要 Bruce 拍板的政策點

### 5.1 直接重用(附 path)

| 重用對象 | Path | 用途 |
|---|---|---|
| leader/admin 角色分級 | `drizzle/schema.ts:38-40`(`users.role`) | 團隊池管理權限,不需新 RBAC |
| 自動給點雛形 | `server/routers/admin.ts:43-67`(`updateAutoCreditPolicy`/`runAutoCreditNow`)+ `userAutoCreditJob` cron | 團隊池分配/補點邏輯的既有範本 |
| 現行 teams 資料模型 | `drizzle/schema.ts:4146-4196`(`teams`/`team_memberships`) | 團隊池的掛載對象,不需重造團隊概念 |
| 成本彙總查詢起點 | `server/routers/admin.ts:75-91`(`teamCostSummary`)+ `server/db.ts:2115-2129` | 改寫成真正 `GROUP BY teamId` 版本 |
| 告警管線 | `server/jobs/apiUsageAlertJob.ts`(Slack webhook,15 分 cron) | 擴充成逐團隊池閾值告警 |
| 定價公開目錄 | `server/routers/credits.ts:10-47`(`pricingCatalog`) | 成本透明頁的資料來源 |
| 單任務透明化的既有模式 | `server/routers/credits.ts:95-101`(`jobRefundStatus`)+ `server/services/refundStatus.ts` | 「單筆扣點/退款查詢」的設計語言可直接沿用到「單筆扣點明細」 |
| append-only 帳本設計精神 | `drizzle/schema.ts:2135-2158`(`cost_ledger` 註解) | `team_credit_pool_ledger` 的冪等鍵/append-only 模式範本 |
| Guard 旗標(已寫好未開) | `ENABLE_ORB_QUOTA_GUARD`/`ENABLE_ORB_BUDGET_GUARD`/`ENABLE_ORB_IDEMPOTENCY_GUARD`(N4 決策卡 3) | 防失控第一道防線,零開發成本 |

### 5.2 要補的(新開發)

1. `team_credit_pools` + `team_credit_pool_ledger` 兩張新表(§2.1)。
2. 扣款鏈路加一段「若使用者屬於啟用池的團隊,同步寫池 ledger」(§2.2 階段一)——涉及 `proStudio.chargeForFalTask`、`director.autoGenerateFromSegments`、`generate`/`imageStudio`/`videoStudio` 等既有扣款呼叫點(H1 §0 列出的呼叫鏈)。
3. `admin.createTeamCreditPool`/`updateTeamCreditPool`/`teamCreditPoolSummary` 三個新 mutation/query。
4. `apiUsageAlertJob` 擴充逐池閾值檢查段。
5. `estimatePoints` 讓所有路徑都回傳結構化 breakdown(目前只有 fallback 分支有文字說明,H1 §0)。
6. 生成結果卡片加「為什麼扣 N 點」展開區(前端,讀新 breakdown 欄位)。
7. 單次操作點數上限規則(獨立於日配額,§4.2a)。

### 5.3 分階段

- **第一階段(零風險,可立即做)**:5.1 表列的「直接重用」項目全部先做——尤其是開三個 guard 旗標(N4 決策卡 3 已建議、無需本文件重複拍板)+ `teamCostSummary` 改 `GROUP BY teamId`(唯讀查詢,無扣款邏輯變動)。
- **第二階段**:新建 `team_credit_pools`/`team_credit_pool_ledger` 表 + 影子寫入(§2.2 階段一)+ admin 分配/監控 UI(§2.3)+ 告警擴充。此階段個人扣款邏輯完全不變,零回歸風險。
- **第三階段**:團隊池變成真正的配額上限(§2.2 階段二)+ 成本透明個案說明頁(§3.2)。
- **第四階段(需 Bruce 明確拍板才做,見 §5.4)**:個人點數完全升格為池的展示層(§2.2 階段三)。

### 5.4 需要 Bruce 拍板的政策點

1. **是否走到「個人點數完全併入團隊池」(§2.2 階段三)**,還是永久停在「團隊池是額外天花板、個人配額仍獨立存在」(階段二)——這是心智模型的根本選擇,技術上兩者都可行,差別在於使用者體感「這是我的點數」vs「這是團隊的點數,我分到一份」。
2. **`perUserCapPoints`(團隊池內個人上限)怎麼定**——是否所有人一致,還是依角色(主力創作者 vs 輕度使用者)分級,需要 Bruce 或各團隊 leader 依實際人力配置決定,技術上只是一個可調參數。
3. **`alertThresholdPct`(團隊池告警閾值)預設值**——建議 80%,但最終數字需與現行 `AI_MONTHLY_BUDGET_USD`(全站閾值,預設 500)的關係一併校準,避免「團隊池沒超,但全站閾值先炸」的混亂告警順序,這需要 Bruce 一併定調兩層閾值怎麼分工。
4. **導演批次類操作的「單次操作點數上限」數值(§4.2a)**——需要 Bruce 定調「一鍵最多可以觸發多少點的批次」,這直接決定尖峰事件的防線鬆緊。
5. **`subscription_plans`/`user_subscriptions`(Stripe 骨架)是否正式凍結不再投入開發**(§4.1)——本文件建議凍結,但這是產品方向決策,需要 Bruce 確認團隊確實不打算在可見未來對外收費,才能安心把資源全部導向內部治理路線而非同時維護兩套語意不同的系統。
6. **點數 UI 措辭是否從「餘額/消費」改為「配額/預算」語言(§4.3)**——涉及既有前端多處文案調整範圍,需要 Bruce 確認優先度(這是體感優化,非阻塞性)。

---

## 6. 缺讀聲明

- 未讀:`server/services/proStudio.ts`/`director.ts`/`generate.ts`/`imageStudio.ts`/`videoStudio.ts` 扣款呼叫點的完整程式碼(僅依 H1/R4 已整理的行號引用,未逐一重新翻閱);`server/jobs/userAutoCreditJob.ts` 完整實作(僅依 A 文件 cron baseline 表描述);`teams.ts` router 除 create/list/get/updateMemberRole 外的其餘 mutation(transferOwnership 等)。
- 未查:目前 15-20 人團隊在 `teams`/`team_memberships` 表裡的實際使用狀態(D §1.2 提到 `TEAMS_COLLAB` 旗標 OFF、前端未接,本文件假設這組表結構可重用,但實際團隊是否已經在用它劃分教材可見度,需查資料庫現況確認)。
- 本文件的池表欄位設計(§2.1)是**提案結構**,尚未驗證與現行 Drizzle migration 慣例(如索引命名、外鍵策略)完全一致,實作前應比照 `team_memberships` 的既有 migration 寫法(`schema.ts:4165-4196` 的 `uniqueIndex`/`index` 模式)校對。
