# R4 — 成本歸屬 / 帳本 / 扣點全鏈深挖

**日期**：2026-07-03　**基準 commit**：7f4417da　**標記**：深挖 wave R

範圍聲明：本文件只補「帳本/歸屬機制本身的全鏈」，不重複 A-cost-integrations（供應商串接）、
H1-model-costs（各模型定價個案）、K2（雙重退款事件覆盤）、N4（降本建議）已涵蓋的內容。

---

## 0. 全鏈地圖（一次講完）

```
使用者發請求
  │
  ├─(A) 舊式點數扣款（真正影響餘額的路徑）
  │     estimatePoints()（modelPricing.ts，估價，非真實計費）
  │        → deductUserPoints()（server/db.ts，FOR UPDATE 鎖 + 就地 mutate
  │          users.remainingGenerations，無 idempotencyKey、無交易 log）
  │        → 任務失敗 → refundUserPoints()（同樣就地 mutate，無 idempotencyKey）
  │        → （部分流程）atomicClaimJobRefund CAS 寫 background_jobs.resultJson
  │          的 refunded/refundedPoints 旗標防重複退款（refundStatus.ts 讀這組
  │          旗標，不讀 cost_ledger）
  │
  └─(B) 新式真實成本觀測（AIDV-14/153，內部可視化，不影響使用者餘額）
        aiProxy.ts 收到上游回應
          → extractUsageCostUsd()（usageCost.ts，只認 OpenRouter 風格
            usage.cost，其餘供應商恆 "0"）
          → resolveCostUsdWithCatalog()（catalogCostFallback.ts，非 OpenRouter
            供應商用 modelPricing 目錄真實單位價 × 用量後援，標 costSource=
            "catalog"；OpenRouter 用 "provider"）
          → INSERT ai_usage_events（costUsd 落此表，requestType 熱路徑之外
            setImmediate 寫）
          → 兩條【互相獨立】的旗標分岔（見 §1，這是本次深挖的核心發現）：
              (B1) ENABLE_COST_LEDGER（預設 OFF）→ aiProxy 直接呼叫
                   postTransaction(member:<uid> debit / expense:ai-cost credit)
              (B2) ENABLE_COST_ATTRIBUTION（預設 ON）→ enqueueAttribution()
                   寫 cost_attribution_outbox（pending）
                     → costAttributionOutboxJob（cron */2min）drain
                     → buildAttributionEntries() 展開 member（必有）+
                       project/workflow/skill（拿得到才有）→ 各一筆
                       postTransaction 寫 cost_ledger
          → providerSnapshotJob（cron */15min）把當日 ai_usage_events
            GROUP BY provider+endpoint 聚合進 cost_aggregations（totalCostUsd/
            totalCostTwd，凍結當下 TWD_PER_USD 匯率）
          → costLedgerReconcileJob（cron */30min）比對 cost_ledger posted debit
            總額 vs cost_aggregations 總額（見 §3 的失真問題）
```

還有第三條【完全平行、互不往來】的舊式紀錄表 `api_usage_logs`（studio/accountant
流程寫入，見 `server/db.ts:1878` `createApiUsageLog`），與 `ai_usage_events` 各自
獨立存在，无交叉核對，供 `server/routers/accountant.ts` 等舊面板讀取。

---

## 1. 【核心發現】ENABLE_COST_LEDGER 並非 cost_ledger 表的唯一守門旗標

`server/services/cost/ledger.ts` 的檔頭註解寫死一句話：

> 「HARD SAFETY：本服務只在旗標 ENABLE_COST_LEDGER=ON 時被接線端呼叫；OFF 時接線端
> 完全不進入本模組，故零行為變化。」

這句話**只對 aiProxy.ts 裡那一條直接呼叫成立**（`server/routes/aiProxy.ts:558-577`，
`isCostLedgerEnabled() && status==="success" && usageEventId!=null` 才寫
`member:<uid>` debit / `expense:ai-cost` credit 一組分錄）。

但同一份 `postTransaction()` 也被 `costAttribution.ts` 的 `postAttributedCost()`
呼叫（`aiProxy.ts:585-619`），而这条路径只檢查 `isCostAttributionEnabled()`
——**這個旗標預設 ON**（`ENABLE_COST_ATTRIBUTION: z.string().optional().default("true")`,
`server/_core/env.validated.ts:688`），且**完全不檢查 `isCostLedgerEnabled()`**。

也就是說在**預設環境變數配置**（`ENABLE_COST_LEDGER` 未設＝OFF，
`ENABLE_COST_ATTRIBUTION` 未設＝ON）下：
- aiProxy 自己的單維度（member-only）分錄**不寫**（路徑 B1 skip）。
- 但 outbox drain（`costAttributionOutboxJob`，`*/2min` cron）**持續把
  member/project/workflow/skill 多維分錄寫進同一張 `cost_ledger` 表**（路徑 B2
  沒有被擋）。
- `server/services/skillOrchestrator.ts:417` 的 Skill 執行成本也走
  `isCostAttributionEnabled()` 單獨 gate，同樣不理會 `ENABLE_COST_LEDGER`。

連帶推論：`server/routers/apiUsage.ts` 的 `costAttribution` admin 查詢直接
`SELECT ... FROM costLedger`（無視 `ENABLE_COST_LEDGER`），所以 admin 後台的
「成本歸屬」面板在**預設配置下就有資料可看**，跟文件宣稱「OFF 時完全不進本模組」
的印象矛盾——它只是「單維度那條路徑」不進，「多維度歸屬」那條路徑一直在跑。

## 2. 【連帶發現】costLedgerReconcileJob 的 gate 假設因此失效

`server/jobs/costLedgerReconcileJob.ts:130`：`if (!isCostLedgerEnabled()) return
{ status: "skipped" }`——這是為了避免「ledger 尚未啟用、空表」時狂刷假 drift 告警。

但依 §1 的發現，**`ENABLE_COST_LEDGER=OFF` 時 `cost_ledger` 表並不是空的**（outbox
drain 仍持續灌資料）。目前之所以沒炸開告警，純粹是因為 reconcile job 自己也被同一
把（錯誤地被當成「唯一守門」的）旗標擋住，never 執行比對；一旦有人只是把
`ENABLE_COST_LEDGER` 打開（不動 `ENABLE_COST_ATTRIBUTION`，這是預期升級路徑），
reconcile job 才第一次真正跑，屆時會看到：

- `cost_ledger` 早已被 outbox drain 灌了歷史資料（因為 `ENABLE_COST_ATTRIBUTION`
  一直是 ON），且每筆 usage event 若同時有 project/workflow/skill 維度，會產生
  **2～4 筆全額 debit**（`buildAttributionEntries` 對每個維度都用同一個
  `amountUsd`，不是分攤，而是各自「重複記一次全額」——這是歸屬語意上的合理設計：
  「這個 project 花了 $X、這個 member 也花了 $X」是同一筆錢的兩種視角，但**全域
  SUM(debit) 因此天生就是 cost_aggregations 總額的 N 倍**（N = 該事件命中的維度數）。
- 而 `costLedgerReconcileJob.reconcileWith()` 目前的比對邏輯是「全域 SUM(debit)
  應約等於 cost_aggregations SUM」——這個假設**只在『每筆 usage event 只有一個維度
  （member）』時成立**。一旦 project/workflow/skill 常態性出現（AIDV-14/130 的
  設計目標正是要它們出現），reconcile job 會立刻報出巨大且persistent 的假
  drift，且會經 `sendSlackAlert` 對外告警（`serverEnv.ALERT_SLACK_WEBHOOK`
  有設時）。
- 換句話說：**reconcile job 的比對公式與 attribution 的多維度寫入語意互斥**，
  現在靠「兩者共用同一把（本不該共用的）旗標而剛好互相遮蔽」才沒有爆炸；一旦
  拆開（本就該拆開，見 §5 建議）就會立刻暴露這個結構性 bug。

## 3. 內建估價 vs 真帳單的對帳缺口

- `modelPricing.ts` 檔頭明寫「參考真實成本（**2025 Q2**，basePoints 對應
  baseCostUsd × 100）」——這是整份 208 個模型條目的定價基準時間點。對照當前
  報告日期 2026-07-03，**基準價格已超過一年未被要求性地重新核價**（`git log`
  顯示該檔案最後一次修改是 2026-05-18，但那次改動是「新增/修正模型型號與路由
  對齊」，不是「依供應商最新牌價重新核算 baseCostUsd」——例如多筆 commit 訊息是
  "align DB defaults to latest models"、"register endpoint"、"fix alias"，
  屬於補漏洞/新模型上架，非價格稽核）。
- 這份「真實成本」本質上是**人工寫死的估算表**，沒有任何自動化管線去抓供應商
  當前實際單位價格做校驗；`compareCatalogVsActual()`（costAnalytics.ts）雖然
  存在「catalog 預估 vs 實際扣費」比較，但它比的是「catalog.baseCostUsd（同一份
  可能過時的表）」vs「ai_usage_events.costUsd（可能是這份表自己後援算出來的
  catalog 值，見下）」——**當上游非 OpenRouter 供應商時，costUsd 本身就是用
  這份 catalog 表反推出來的**（`catalogCostFallback.ts` 的 `costSource=
  "catalog"`），於是 `compareCatalogVsActual` 有很高機率是在「拿 catalog 表跟
  catalog 表自己比」，結構性地掩蓋了「這份表本身是否還準」的問題。
- 唯一真正獨立的外部校驗是 `providerSnapshotJob.ts` 輪詢供應商帳戶 API 拿
  `nextInvoice`——但目前只有 **ElevenLabs** 和 **Suno** 有實作輪詢；`fal_ai`
  （影片/圖片生成的大宗供應商，Kling/Veo/Flux 等貴的模型都走這條）與 `gemini`
  兩家在程式碼裡明寫 `// TODO: Implement ... polling when ... available`，
  `nextInvoice` 恆為 `undefined`。也就是說 `reconcileWithProviderInvoices()`
  算出的 `truthTotalUsd = max(recorded, invoiced)` 對 fal_ai/gemini
  **永遠退化成「自己記錄的數字」**（因為 `invoiceUsd=null`），沒有任何獨立
  外部真值可以偵測「這份估價表低估/高估了多少」。這正是 admin 後台「真實成本」
  牌子的可信度天花板：對兩個最大宗的供應商，系統無法自證準確，只能自我一致。

## 4. 扣退款正確性複核（呼應但不重複 K2）

- `deductUserPoints()` / `refundUserPoints()`（`server/db.ts`）都用
  `SELECT ... FOR UPDATE` 交易鎖 + 就地 `UPDATE users SET remainingGenerations
  = remainingGenerations ± N`，**兩者都沒有 idempotencyKey / 去重機制**。
  鎖只保證「同一使用者的並發扣款/退款序列化」，不保證「同一筆邏輯事件不會被
  呼叫兩次」——冪等責任完全外包給呼叫端（K2 覆盤的雙重退款正是呼叫端沒做好）。
  對照 `cost_ledger` 那邊 `postEntry`/`postTransaction` 有嚴謹的
  `idempotencyKey` UNIQUE 約束雙保險，**點數經濟的扣退款反而是全鏈中冪等性
  最弱的一段**，而它才是唯一真正影響使用者餘額的路徑。
- `refundStatus.ts`（AIDV-650）的檔頭自己就承認了這個斷層：「為什麼不是
  cost_ledger：… 點數退款（db.refundUserPoints）只加回
  users.remainingGenerations、完全不寫 ledger——以 ledger 推導退款狀態必然
  全面誤判，故改讀 resultJson」。也就是說 **cost_ledger 的 member 帳戶餘額
  （`computeBalance`）在概念上跟使用者實際點數餘額（`users.
  remainingGenerations`）是兩個互不同步、互不校驗的數字系統**——ledger 記
  「真實 USD 成本」，points 記「使用者被收的點數」，兩者換算比例
  （`POINTS_PER_USD=100`）只在 estimatePoints 那端存在，從未在扣款當下真正
  跟 ledger 對齊過。
- `atomicClaimJobRefund`（CAS 寫 `background_jobs.resultJson.refunded` 旗標）
  是目前唯一針對「失敗任務重複退款」做的防護，且限定在有寫這組旗標的較新任務
  流程（generate.prepareJob / submitMultimodalAsync / director AIDV-968 後）；
  `refundStatus.ts` 明確排除舊 `chargedPoints` 欄位任務，「一律 `none`、徽章
  安靜不顯示」——舊任務的扣退款正確性完全沒有可觀測性，無法在這條鏈路上稽核。
- race 場景：`estimatePoints → deduct → 任務執行 → reconcileCredits/refund`
  這條鏈（`orbCostGuard.ts` 的 `reconcileCredits`）在 estimated/actual
  差額調整時，`deductCredits`/`refundUserPoints` 各自獨立呼叫、非同一交易，
  若中途 process 崩潰（例如 deduct 完差額後尚未來得及更新任務狀態就重啟），
  沒有機制偵測「這次 reconcile 是否已經做過」——同樣缺 idempotencyKey。

## 5. Admin 成本頁看到的數字可信度

- `server/routers/apiUsage.ts` 的 `deepCost` 讀 `ai_usage_events`（原始事件，
  上限 50,000 筆掃描 + 獨立 SUM 聚合避免截斷失真）+ `cost_aggregations`（月度
  MTD 投影），`costAttribution` 讀 `cost_ledger` GROUP BY accountKey——**三個
  不同表**、各自獨立聚合，彼此沒有互相校驗（唯一的校驗是 §2 提到、目前被
  意外遮蔽的 `costLedgerReconcileJob`）。
- `costAttribution` 面板在預設配置（`ENABLE_COST_LEDGER=OFF`）下能看到資料，
  是靠 §1 發現的「旁路」（`ENABLE_COST_ATTRIBUTION` 默默一直在寫），如果哪天
  有人誤以為「兩個旗標是同一件事、只要開 `ENABLE_COST_LEDGER` 就能看到成本
  歸屬」，會誤判現況——事實是歸屬資料一直都在，跟 `ENABLE_COST_LEDGER` 無關。
- **USD→TWD 換匯是靜態手動值**：`DEFAULT_USD_TO_TWD_RATE = 31.5`
  （`shared/currency.ts`），可用 `TWD_PER_USD` 或 `USD_TO_TWD_RATE` env 覆蓋，
  但沒有任何自動抓即時匯率的機制；`cost_aggregations.exchangeRate` /
  `cost_ledger.exchangeRate` 都是「落帳當下讀到的這個靜態值」凍結寫入——如果
  Bruce 忘記手動更新 env（或從未設定過、一直吃預設 31.5），所有歷史 TWD
  數字都會系統性偏離真實匯率，且因為是「凍結」設計，**過去的錯誤匯率永遠不會
  被追溯修正**，只有未來寫入的新資料能反映新匯率。這是刻意的稽核設計（凍結
  當下值利於追溯「當時算的是多少」），但也代表「頁面上的 TWD 總數」精確度
  完全取決於這個手動維護值有沒有人記得更新。
- `MonthlyProjection`（月底投影）用「至今每日均費線性外推」，對有明顯週期性
  （例如週末流量低）或月初/月底集中生成的使用型態會系統性失準，屬已知的簡化
  假設，非 bug，但 admin 看數字時應知道這只是粗略線性外推非精算。

## 6. 改進提議（開 ledger 的安全順序）

1. **先拆開 `ENABLE_COST_LEDGER` 與 `ENABLE_COST_ATTRIBUTION` 的實際語意**，
   讓文件與程式碼一致：要嘛把 costAttribution 的 postTransaction 呼叫也
   加上 `isCostLedgerEnabled()` 檢查（讓 `ENABLE_COST_LEDGER` 真正變成
   cost_ledger 表的唯一總開關），要嘛重寫 ledger.ts 檔頭註解，明確承認
   「本旗標只控制 aiProxy 的單維度 member 分錄，多維度歸屬分錄由
   `ENABLE_COST_ATTRIBUTION` 獨立控制」。現況兩者用同一份說法但實際是兩條路，
   極易在未來變更時誤判影響範圍。
2. **重寫 `costLedgerReconcileJob` 的比對公式**，使其能正確處理「同一筆
   usage event 產生多筆全額 debit（跨維度）」的語意——例如只比對
   `accountKey LIKE 'member:%'` 的 debit 總額（因為 member 維度是「必有且
   唯一」的，理論上跟 aggregations 一對一），而不是比對「全域所有維度加總」。
   在此修正之前，**不建議**把 `ENABLE_COST_LEDGER` 開啟到會觸發 reconcile
   實際跑（目前它被同一旗標鎖住，意外安全；一旦拆開 §1/§2 的耦合，必須先修
   這裡再開）。
3. **在拆開兩個旗標之後**，才依序做：(a) 先確認 reconcile 公式修正過、在
   `ENABLE_COST_LEDGER=ON` 的 staging 環境跑至少一個對帳週期無異常 drift
   告警；(b) 再逐步在 production 打開 `ENABLE_COST_LEDGER`（此時 aiProxy 的
   member-only 分錄才會開始寫，與早已存在的 attribution 多維度分錄疊加，
   需要在 reconcile 修正後才不會雙重誤報）。
4. **點數扣退款補冪等鍵**：`deductUserPoints`/`refundUserPoints` 建議接受
   一個可選的 `idempotencyKey`（比照 cost_ledger 的做法），內部可先查一張輕量
   去重表（或沿用 `background_jobs.resultJson` 的 CAS 旗標模式，但擴大到所有
   扣退款呼叫點,不只是有走 `atomicClaimJobRefund` 的新任務流程），從根本堵住
   K2 類型問題在未覆蓋路徑重演的可能。
5. **補齊 fal_ai / gemini 的 providerSnapshot 真實帳單輪詢**（目前是 TODO
   stub），這是讓「內建估價 vs 真帳單」有意義對帳的前提；沒有這塊，
   `modelPricing.ts` 的 2025 Q2 估價表永遠無法被獨立證偽或證實，只能自我
   一致地循環驗證。
6. **`orbBudgetGuard`（`ENABLE_ORB_BUDGET_GUARD` 預設 OFF）上線前**，先確認
   它讀的 `cost_aggregations` 月度 SUM 在旗標拆開／reconcile 修正後仍然只
   反映「真實 USD 成本」而非被 attribution 多維度寫入污染（`cost_aggregations`
   本身是從 `ai_usage_events` 直接聚合，不受 §2 的多維度 debit 重複問題影響，
   這點目前是安全的，但拆開兩個旗標時仍建議重新跑一次驗證，避免未來有人誤把
   budget guard 的資料源換成 `cost_ledger`）。

---

## 未查證 / 需人工確認事項

- `ai_usage_events`／`cost_ledger`／`cost_aggregations`／`cost_attribution_outbox`
  在生產環境（Railway）目前實際的 env 旗標值（`ENABLE_COST_LEDGER`、
  `ENABLE_COST_ATTRIBUTION`、`TWD_PER_USD`/`USD_TO_TWD_RATE`、
  `ENABLE_ORB_BUDGET_GUARD`）——本文件只讀了程式碼預設值，未讀取實際部署
  設定，§1/§2 的「預設配置下」推論以程式碼 default 為準。
- `costAttributionOutboxJob` 与 `costLedgerReconcileJob` 的 cron 是否已在
  `server/_core` 的排程清單實際掛載啟動（兩份 job 檔案本身有
  `initXxxCron()` 函式，但本次未逐一確認 `_core/index.ts` 或等效入口確實
  呼叫了它們）。
- `cost_ledger` 目前在生產庫的實際列數/是否已因 §1 的旁路而累積了大量歷史
  資料，需要直接查資料庫才能確認（本文件僅推論機制,未驗證資料現況）。
- `api_usage_logs`（舊表）與 `ai_usage_events`（新表）在各業務流程（studio
  generate / director / accountant）的實際覆蓋範圍是否有重疊或缺口，只做了
  grep 層級確認兩者是獨立寫入路徑,未逐一走查每個呼叫點。
- modelPricing.ts 208 個模型條目是否每一個都仍對應供應商現行有效的
  endpoint／價格（本文件只確認了整份表的「基準時間點」與「最後程式碼改動
  時間」，未逐條核價）。
