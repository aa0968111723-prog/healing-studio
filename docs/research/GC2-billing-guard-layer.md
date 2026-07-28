# GC2 — 計費守衛層深挖(credits + orbCostGuard/BudgetGuard/Quota)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/routers/credits.ts(102)、server/services/orbCostGuard.ts(173)、server/services/orbBudgetGuard.ts(125)、server/services/orbQuota.ts(163)

---

## 0. 範圍與方法

逐行讀完四個主稽核檔,並依任務指示追以下交叉線(全部逐行驗證,非引用既有文件的結論):

1. `credits.ts` 本身與 `orbCostGuard`/`orbBudgetGuard`/`orbQuota` **沒有直接呼叫關係**——`credits.ts` 只是唯讀端點(定價目錄、餘額、退款狀態透明化),不觸發任何守衛邏輯。真正的耦合點是共用的底層原子函式 `db.deductUserPoints`/`db.refundUserPoints`(`server/db.ts`),以及三道守衛各自依賴的資料表。
2. 追了每道守衛的**旗標預設值**(`server/_core/env.validated.ts`)、**實際呼叫點**(`server/routers/ai.ts`、`director.ts`、`agentToolExecutor.ts`)、以及**餵給守衛判斷的資料從哪裡來**(`ai_usage_events`、`cost_aggregations`、`api_usage_logs` 三張表各自的寫入點)。
3. 對照既有發現:E 文件「orb quota guard 預設關」、X 波 B-11(`costAnalytics.ts:39-47` 對主流量 LLM 呼叫結構性失明)、B-16(`models.ts` 訓練零計費)、X5 §7(「500 pts/次上限」文案與 catalog 矛盾,當時標註「真正防護邏輯未在本檔驗證」)、K2 #2(`deductCredits`/`reconcileCredits` 吞回傳值,已 CONFIRMED)。

**核心結論(先講重點)**:三道守衛的「攔截邏輯」本身(`decideBudget`、`checkRetryChainCost`、`checkAndConsumeQuota` 的純函式判斷)大多寫得正確且有單元測試覆蓋;但**其中兩道守衛(retry-chain cost guard、monthly budget guard)所依賴的資料表,對它們宣稱要保護的主流量(orb 聊天 + 15 精靈 studio 生成)是結構性看不到的**——這與 B-11 是同一個根因(`invokeLLM`/`callFalModel` 兩條真正花錢的路徑都繞過對應的 usage 記錄表),但本次深挖把 B-11 的影響範圍從「報表/對帳不可信」擴大到「兩道即時攔截守衛在實務上永遠不會觸發」。`credits.ts` 的 `myBalance` 端點(以及財財精靈的整個成本報表功能)也踩到同一種根因,只是資料表換成 `api_usage_logs`。

---

## 1. 發現總表(依嚴重度排序)

### 1.【嚴重・CONFIRMED】`checkRetryChainCost`(orbCostGuard.ts)與 `enforceMonthlyBudgetGate`/`checkMonthlyBudget`(orbBudgetGuard.ts)的唯一資料源 `ai_usage_events`,對它們要保護的主流量結構性失明——兩道守衛實務上永遠不會觸發

**發現**

- `checkRetryChainCost`(`orbCostGuard.ts:127-151`)是純函式,由呼叫端傳入 `UsageEventLike[]` 事件陣列;唯一呼叫點在 `server/routers/ai.ts:3146-3172`(`orbTask.retry`),事件來源是:
  ```
  server/routers/ai.ts:3151-3154
  const recentRows = await database.select().from(aiUsageEvents)
    .where(and(eq(aiUsageEvents.userId, ctx.user.id), gte(aiUsageEvents.createdAt, since)));
  ```
  即完全依賴 `ai_usage_events` 表。
- `enforceMonthlyBudgetGate`(`orbBudgetGuard.ts:113-125`)呼叫 `checkMonthlyBudget()`(`orbBudgetGuard.ts:73-99`),後者對 `cost_aggregations` 做 `SUM(totalCostUsd)`(:90-93)。
- `cost_aggregations` 的**唯一**寫入點是 `server/jobs/providerSnapshotJob.ts:161-215`,邏輯是每 15 分鐘把 `ai_usage_events` 依 provider+endpoint 聚合後 upsert 進去——換言之 `cost_aggregations` 是 `ai_usage_events` 的**下游衍生表**,兩者共享同一個盲區。
- `ai_usage_events` 全 repo 只有兩個寫入點,都在 `server/routes/aiProxy.ts`(:305 rate-limited 分支、:533 正常回應分支),對應的是 Express `/api/ai/:provider/*` 這條獨立代理路由。本次掃描全 repo(含 client 端)搜尋 `api/ai/` 呼叫字串,**除了 `server/routes/aiProxy.ts` 自己與 `server/routers/brainPipeline.ts`(僅作為路由健康檢查清單的字串標籤,非呼叫)外查無任何呼叫點**——不能排除 repo 外部呼叫者,但可確認 orb 聊天與 orb 生成兩條主流量都不是走這條路徑。
- 兩條真正花錢的路徑各自繞過 `ai_usage_events`:
  - 聊天/規劃:`ai.chat`(`ai.ts:565` 呼叫 `enforceMonthlyBudgetGate()`)與 `director.chat`(`director.ts:246`)最終呼叫 `server/_core/llm.ts` 的 `invokeLLM`,經 `providerFacade.ts` **直連**供應商——這正是 B-11 原始發現的路徑,本次交叉確認 `invokeLLM` 全文搜尋 `aiUsageEvents` **零命中**。
  - 生成:`falDispatcher.ts` 呼叫的 `callFalModel`(定義於 `server/services/falModels.ts`)全文搜尋 `aiUsageEvents` **零命中**——即 15 精靈觸發的圖片/影片/音訊生成(真正呼叫 `deductCredits`/`reconcileCredits` 扣點的那條路徑)同樣不寫入 `ai_usage_events`。

**影響**

- `checkRetryChainCost` 設計目的(AIDV-896 註解)是擋「使用者短時間內重試燒錢」,但它讀的表對 `orbTask.retry` 實際會重試的任務(無論是聊天規劃重跑或呼叫 15 精靈重新生成)幾乎必然是空結果——`userChains.length === 0` 分支永遠回 `{blocked:false}`。旗標 `ENABLE_RETRY_CHAIN_COST_GUARD` 雖預設 `"true"`(`env.validated.ts:571`),攔截邏輯本身形同虛設。
- `enforceMonthlyBudgetGate` 即使被 Bruce 手動打開(`ENABLE_ORB_BUDGET_GUARD=true`),`checkMonthlyBudget()` 算出的「當月已花費」會系統性低估——因為它加總的 `cost_aggregations` 從未收到 orb 聊天與 orb 生成這兩塊真正的大宗花費。換言之,這道「月度硬預算閘」在資料源修好之前,**無論旗標開關,實際上都攔不住 orb 聊天/生成把預算燒穿**,因為它永遠看不到真實花費逼近上限。
- 這是 B-11 的影響範圍擴大:B-11 原本定性為「成本分析/對帳不可信」(觀測性問題);本次確認同一個資料盲區同時使**兩道即時攔截守衛**在功能上失效(執行性問題),嚴重度應上修。

**建議**:在 `invokeLLM` 出口與 `callFalModel`/`falDispatcher` 的扣點成功點統一補寫 `ai_usage_events`(或等價 ledger),不能只倚賴 `aiProxy.ts` 這條看起來已經沒有前端呼叫的窄路徑;`checkRetryChainCost`/`checkMonthlyBudget` 在資料源修好前應視為「名義上存在、實際不生效」。

**cluster**:billing

---

### 2.【嚴重・CONFIRMED】`credits.myBalance` 與財財精靈整個成本報表功能的資料源 `api_usage_logs`,對 orb 聊天與 15 精靈生成同樣結構性失明——低餘額提醒對主要花費路徑失效

**發現**

- `credits.ts:55-82` 的 `myBalance` 呼叫 `db.getUserCostSummary(ctx.user.id)`(:65)算 `totalSpentPoints`,再與 `remaining = ctx.user.remainingGenerations`(:71)算 `usedPct = spent/(spent+remaining)`(:72-75,註解見:52-54)。
- `getUserCostSummary`/`getUserTopModelRecent`(`server/db.ts:1940-1972`、`:3013-3047`)都是對 `apiUsageLogs` 表做 `WHERE userId=...` 的 SUM/TOP-N 查詢——owner 範圍本身正確,無 IDOR。
- 但 `apiUsageLogs` 的寫入函式 `createApiUsageLog`(`server/db.ts:1875-1880`)全 repo**只有 3 個呼叫點,全部在 `server/routers/generate.ts`(:530、:1288、:1503)**——即舊版 `generate.*`(`prepareJob`/`multimodal` 等)那條「預先估價、事後入庫」的傳統生成流程。
- 15 精靈 studio 生成(`falDispatcher.ts` → `deductCredits`/`reconcileCredits` → `db.deductUserPoints`)**不寫 `apiUsageLogs`**;orb 聊天(`invokeLLM`)也不寫。而 `users.remainingGenerations`(myBalance 的分母組成之一)是所有路徑共用的同一個欄位,任何一條路徑扣點都會讓它真實下降。
- 財財精靈(`server/services/spiritTools/accountantTools.ts`)的 `getUserCostSummary`/`getUserModalityBreakdown`/`getUserTopModelRecent` 呼叫(:208-213、:442 等)全部倚賴同一張表,踩到同一個盲區——不是 `credits.ts` 獨有,是整個「財財看得到多少錢」功能的地基問題。

**影響**

- 對一個主要透過 orb 聊天呼叫 15 精靈生成的使用者:`totalSpentPoints`(分子)幾乎恆為 0(或只反映他偶爾用到舊版 `generate.*` 流程的部分),但 `remaining`(分母的一部分)會隨著真實生成持續下降。範例:起始 1000 點,透過 15 精靈花掉 900 點只剩 100,`totalSpentPoints=0`→`usedPct = 0/(0+100) = 0%`。使用者與財財精靈都會誤判「幾乎沒花錢」,而實際上只剩 10% 的點數——**低餘額提醒對這群使用者永遠不會觸發**,直到餘額真的見底才會突然出現「額度用完」的 quota-limited 訊息(`ai.ts:1699` 那句),使用者體感是「毫無預警被斷」。
- `topModel`(myBalance 回傳欄位)在同樣情境下也會系統性顯示 `null`,退化成前端「最近的高耗模型」備援文案,對主力使用者永遠給不出真實答案。

**建議**:`myBalance`/`getUserCostSummary` 系列查詢需要同時涵蓋 `deductCredits`/`reconcileCredits`(15 精靈路徑)與 `invokeLLM`(聊天路徑)的真實扣點事件,不能只讀 `api_usage_logs`;或在扣點成功的當下(`falDispatcher.ts:480-485`、`:618-624`)也寫一筆等價紀錄。修法方向與發現 #1 相同(統一 usage ledger 出口),建議與 #1 一併處理,避免各補各的、又造出第三張各自為政的表。

**cluster**:billing

---

### 3.【高・CONFIRMED,擴大範圍】`enforceMonthlyBudgetGate` 除了資料源失明,連「掛勾範圍」本身也只覆蓋兩個聊天入口,擋不到直接生成/訓練花費

**發現**

- `orbBudgetGuard.ts:104` 的文件註解寫「call at the top of **any** LLM handler」,但全 repo 搜尋 `enforceMonthlyBudgetGate` 的生產呼叫點只有兩處:`ai.ts:565`(`ai.chat`)與 `director.ts:246`(director 對話)。
- `proStudio.ts`、`imageStudio.ts`、`videoStudio.ts`、`models.ts`(`create`/`retrain`)、`loraTrainer.ts` 等直接觸發真實生成/訓練花費的路由**完全沒有掛這道閘**——其中 `models.ts` 的 `create`/`retrain` 正是 B-16 指出的「零限流零計費」入口。
- 疊加發現 #1:即使把 `ENABLE_ORB_BUDGET_GUARD` 打開、也把資料源修好,這道閘依然只能擋 `ai.chat`/`director.chat` 兩個聊天入口的**後續呼叫**,擋不住任何直接打生成/訓練 API 的路由——B-16 描述的訓練零計費完全在這道閘的視野之外。

**影響**:「月度硬預算閘」給人的印象是「全站 AI 花費的最後防線」,但實際覆蓋面只是聊天規劃的入口檢查,對平台真正大額花費來源(生成、訓練)沒有任何作用,即使打開旗標也不會擋住 B-16 那種零計費缺口。

**建議**:若要讓這道閘名副其實,需要在 `checkMonthlyBudget()` 資料源修好後,把呼叫點擴散到 `proStudio.ts`/`models.ts`/`loraTrainer.ts` 等直接觸發花費的入口,而非只掛在兩個聊天路由。

**cluster**:billing

---

### 4.【高・部分重驗證】`deductCredits`/`reconcileCredits`(orbCostGuard.ts:153-173)吞掉扣款結果 —— 与 db.ts 500 點安全上限疊加,坐實 X5 §7 當時「未在本檔驗證」的懸念

**發現**

- `deductCredits`/`reconcileCredits`(`orbCostGuard.ts:153-173`)呼叫 `db.deductUserPoints`/`db.refundUserPoints` 後完全不檢查回傳值,此為 **K2 #2 已 CONFIRMED** 的既有發現,本次重讀程式碼確認現狀不變(未修復)。
- 本次深挖新增交叉驗證:`server/db.ts:826-827`
  ```ts
  // Minimum 1 point, maximum safety cap of 500
  const toDeduct = Math.max(1, Math.min(500, Math.round(pointsAmount)));
  ```
  以及 `refundUserPoints`(`db.ts:901`)同款 `Math.min(500, ...)` 上限——這是**全站唯一**的硬編上限,對「呼叫端要求扣/退多少點」一律 clamp 到 500,與呼叫者原始金額脫鉤。
- 這解答了 `X5-brain-router-deepdive.md` §7 當時留下的懸念(「真正的扣點/防護邏輯是否在扣點當下另外套用了一個真正的 500 硬上限,未在本檔驗證」)——**答案是肯定的,且此上限位於 `deductUserPoints`/`refundUserPoints` 本身(`db.ts`),不是個別業務邏輯**。
- 交叉 `modelPricing.ts` catalog:多筆**可派工 live 模型**的 `maxPoints` 超過 500,例如 `fal-ai/sora`(text-to-video,`modelPricing.ts:540`,`maxPoints:600`,註解明言是 `videoStudio.ts soraTextToVideo` 實際呼叫的 ID)、`fal-ai/kling-video/v2.1/pro/image-to-video`(`modelPricing.ts:612`,`maxPoints:550`)。`falDispatcher.ts` 的 `calculateActualCost`(`modelPricing.ts:3376-3413`)會依模型自己的 `[minPoints,maxPoints]` clamp 出正確的 `actualCost`(如 600),但後面呼叫 `deductCredits(userId, 600)`(`falDispatcher.ts:484`)進到 `deductUserPoints` 時又被砍到 500——每次全額 Sora t2v 呼叫少收 100 點、Kling Pro i2v 少收 50 點,**且完全靜默,連 log 都只印「已扣 500」不會提及原始要求的 600**。
- 訓練類別(`modelPricing.ts:1912-1999` 一帶)maxPoints 更高達 2000-5000,目前因 B-16(訓練零計費)完全不走 `deductCredits`,此上限暫時「幸運地」沒被觸發;但這代表**若日後修 B-16 時天真地接上現有 `deductCredits`/`reconcileCredits`,500 點上限會讓訓練費用被砍掉 75-90%**,是修復 B-16 時必須一併處理的隱藏地雷。

**影響**:對已上線、真實可派工的高價視覺/影片模型,平台每次都少收固定金額(50-100 點/次,約 baseCostUsd 的 15-20%);疊加 #1(`deductCredits` 不查回傳值,餘額不足時整筆收不到)與 B-16(訓練零計費),計費失效群組在「高價層」的缺口比之前任一份文件單獨呈現的都更完整。

**建議**:`deductUserPoints`/`refundUserPoints` 的 500 上限應該改成可設定或直接移除、改由呼叫端(`orbCostGuard`)依 catalog `maxPoints` 做上限依據;`deductCredits`/`reconcileCredits` 應檢查回傳值,對 `success:false` 或「實際扣點 < 要求扣點」記 log/寫稽核旗標,而非靜默吞掉。

**cluster**:billing

---

### 5.【中・CONFIRMED】`orbQuota.ts` 的 `multimodal_analysis`/`task_retry`/`provider_rate` 三個配額類別在生產程式碼零呼叫——寫進 LLM planner 提示詞的配額是假的

**發現**

- `orbQuota.ts` 定義 4 個「每日額度」類別(`DAILY_LIMITS`,:27-32):`planner`(200)、`generation`(40)、`multimodal_analysis`(30)、`code_task`(12),另有視窗制的 `rapid_click`/`provider_rate`/`task_retry`。
- 全 repo 搜尋 `checkAndConsumeQuota(` 的呼叫點:`ai.ts:1644`(`rapid_click`)、`ai.ts:1684`(`planner`)、`ai.ts:2508`(`code_task`)、`agentToolExecutor.ts:1016`(`generation`)——**`multimodal_analysis`、`task_retry`、`provider_rate` 三個類別在生產程式碼中零呼叫**,僅出現在 `server/orb-quota.test.ts` 的單元測試裡。
- `getOrbQuotaSnapshot`/`summarizeOrbQuotaForPlanner`(`orbQuota.ts:134-163`)會把包含 `multimodal_analysis` 在內的 4 個 `DAILY_LIMITS` 類別剩餘量組成文字,經 `agentPlanner.ts:377` 注入 LLM planner 的 system prompt(`ai.ts:2050` 呼叫 `getOrbQuotaSnapshot`)。因為 `multimodal_analysis` 從未被 `checkAndConsumeQuota` 實際消費,它的 `used` 計數器永遠是 0——不管使用者當天做了多少次多模態分析,planner 看到的永遠是「multimodal_analysis: 剩餘 30/30」。

**影響**:這是一個「看起來有守衛、實際是裝飾」的 contract-mismatch——LLM planner 依這段文字自我節制生成步驟數量(`orbQuota.ts:129-134` 註解明言用途),但對多模態分析類別的節制完全基於虛假的「還有滿額」訊號,起不到設計初衷的效果;`task_retry`(依 `retryCount>1` 擋)、`provider_rate`(單一 provider 120 次/分)這兩個獨立防線也同樣是「寫好了、沒人呼叫」的狀態。

**建議**:若這三個類別的設計意圖仍然有效,需要在對應的實際呼叫點(多模態分析工具派工、任務重試、供應商層級呼叫)補上呼叫;若已被其他機制取代,應從 `DAILY_LIMITS`/snapshot 移除,避免 planner 提示詞給出失真訊號。

**cluster**:contract-mismatch(次要:deadcode)

---

### 6.【中・釐清既有發現】E 文件「ENABLE_ORB_QUOTA_GUARD 預設關」定性正確,但只涵蓋聊天層三類別;真正在派工當下擋量的 `generation` 類別不受此旗標影響、永遠啟用

**發現**

- `ai.ts:995-998` 的 `quotaGuardEnabled = isFlagEnabled(ENABLE_ORB_QUOTA_GUARD, false)` 只控制三個呼叫點:`rapid_click`(:1643-1682)、`planner`(:1683-1722)、`code_task`(:2507-2526)——這三個是**聊天/規劃層**的節流(擋連點、擋每日規劃次數、擋程式碼協作任務數)。
- 但真正在「派工當下」擋每日生成上限的呼叫點——`agentToolExecutor.ts:1015-1024`(`GENERATION_SLOT_TOOLS.has(call.name)` 分支呼叫 `checkAndConsumeQuota("generation", ...)`)——**沒有被任何 `ENABLE_*` 旗標包住,是無條件執行的**。這條路徑是 `executeOrbToolCalls` 的一部分,而 `executeOrbToolCalls` 是 `orbTaskOrchestrator.ts`、`orbWorkflowEngine.ts`、`ai.ts` `executeTools`、`planExecutorTools.ts` 共用的**唯一真實派工出口**。

**影響**:E 文件「orb quota guard 預設關」這句話容易被讀成「orb 生成完全沒有每日上限」,但精確地說:**只有聊天層的節流(防連點、防過量規劃、防程式碼協作任務數)因旗標關閉而不生效;實際生成派工的每日 40 次上限(`generation` 類別)不受這個旗標影響,永遠有效**。這是對既有發現的重要澄清而非推翻,對「這些守衛實際擋不擋」這個問題,答案在不同子類別上不一致,必須逐類別回答,不能一概而論。

**建議**:若決定開啟 `ENABLE_ORB_QUOTA_GUARD`,受影響的只有聊天層三類別;溝通給 Bruce 時應明確區分「聊天節流」與「生成上限」是兩組獨立開關,避免誤判開啟後的實際效果。

**cluster**:billing(澄清性質)

---

### 7.【低】`credits.jobRefundStatus` 的 zod schema 對輸入陣列沒有上限,僅服務層事後截斷

**發現**

- `credits.ts:97-99`:`z.object({ jobIds: z.array(z.number().int().positive()) })`——schema 層沒有 `.max(...)`。實際上限(100)是 `refundStatus.ts:39,152` 的 `MAX_REFUND_STATUS_IDS`/`.slice(...)`,發生在**去重(`new Set`)之後**——即一個惡意超大陣列(例如數十萬個整數)仍需先被 body-parser/zod 解析、再建一個同樣大小的 `Set`,才會被截斷。
- 目前僅靠全站泛用限流頂著(其他文件已載明約 300 req/15min,本檔未重新驗證此數字,標註為未在本檔驗證)。

**影響**:輕量的記憶體/CPU 放大面,非立即可利用的高風險漏洞,但與 `getJobRefundStatuses` 自身文件宣稱的「上限 100」設計意圖不完全一致(意圖上限應該在拒絕輸入的層級,而非事後截斷)。

**建議**:在 zod schema 加 `.max(100)`,對超限請求直接 400 拒絕,而非讓每個請求都先付出解析/去重的成本。

**cluster**:other

---

### 8.【低】`server/routers.ts:257-258` 匯入 `estimateOrbTaskCost`/`checkAndConsumeQuota`/`getOrbQuotaSnapshot` 但整檔從未呼叫

**發現**:`grep` 確認這三個 import 在 `routers.ts` 內只出現於 import 陳述式,無任何呼叫式。真正的呼叫邏輯都在 `routers/ai.ts`/`services/agentToolExecutor.ts`。

**影響**:純粹的死碼/維護雜訊,不影響行為。

**建議**:清掉未使用的 import。

**cluster**:deadcode

---

## 2. Negative results(查過確認沒問題的部分)

- **`credits.ts` 本身無 IDOR**:`myBalance` 用 `protectedProcedure` + `ctx.user.id` 範圍;`jobRefundStatus` 的 `getJobRefundStatuses`→`getBackgroundJobsRefundMeta`(`db.ts:2228-2240`)SQL 端有 `WHERE userId=... AND id IN (...)`,非本人/不存在的 id 統一回應 `unknown`,不可區分存在性(防列舉)。`pricingCatalog` 是 `publicProcedure` 但只回傳靜態定價目錄,無使用者資料或金鑰外洩。
- **`deductUserPoints`/`refundUserPoints` 的列鎖是可靠的**:兩者都用 `SELECT ... FOR UPDATE` 包在 `db.transaction` 內(`db.ts:830-834`、`903-906`),與既有文件(W5)對核心原子性「可靠」的結論一致——本次深挖的問題出在「呼叫端忽略回傳值」與「硬編上限」,不是列鎖本身的競態問題。
- **`decideBudget`/`checkRetryChainCost` 的純函式邏輯本身正確**:兩者都有對應單元測試(`orbCostGuard.test.ts`、`orbCostGuards.test.ts`)覆蓋邊界情況(budget<=0 視為無上限、chain 未達門檻不擋等),問題不在判斷邏輯,而在餵給它們的資料。
- **`ENABLE_ORB_COST_GUARD`/`ENABLE_RETRY_CHAIN_COST_GUARD` 兩個旗標預設值其實是 `"true"`**(`env.validated.ts:569,571`)——容易被誤以為和 `ENABLE_ORB_QUOTA_GUARD`/`ENABLE_ORB_BUDGET_GUARD`(都預設 `"false"`)一樣關閉,實際上「表面開關」是開的,只是資料源讓它形同虛設(見發現 #1)。
- **`ai.chat`/`orbTask.retry` 有 owner/rate 檢查**(`tryConsumeChatToken`、`orbTask.retry` 的 `taskForRetry.userId !== ctx.user.id` 檢查,`ai.ts:556,3133-3135`)——不是本次任務核心範圍,順手確認未見異常。
- 本檔案未驗證:aiProxy.ts `/api/ai/:provider/*` 是否有 repo 外部(如行動端、第三方整合)呼叫者;`checkTrpcRateLimit`/全站泛用限流的確切數值;財財精靈其餘工具是否有繞過 `apiUsageLogs` 盲區的替代資料來源。

---

## 3. 一句話回答任務的核心問題

**這些守衛實際擋不擋?** 答案依類別而異,不是統一的「開/關」:
- `orbQuota` 的 `generation`(每日 40 次生成上限)**真的擋**,且不受任何旗標控制;`rapid_click`/`planner`/`code_task` 三類**旗標關,不擋**;`multimodal_analysis`/`task_retry`/`provider_rate` 三類**從未接線,永遠不擋**,且 `multimodal_analysis` 還會對 LLM planner 給假訊號。
- `orbCostGuard` 的 `estimateOrbTaskCost` 只是替回覆加一句提示文字與 telemetry,**從未真正阻擋任何任務materialize/派工**;`checkRetryChainCost` 旗標開著,但資料源全空,**形同虛設**;`deductCredits`/`reconcileCredits` 真的會扣點,但吞回傳值、且被 `db.ts` 的 500 點硬上限限縮,對高價模型**系統性少收**。
- `orbBudgetGuard` **預設關**,即使打開,資料源(`cost_aggregations`←`ai_usage_events`)也看不到 orb 聊天/生成的真實花費,且只掛在兩個聊天入口——**在資料源與掛勾範圍都修好之前,這道「月度硬預算閘」實質上不可能真正攔下超支**。
