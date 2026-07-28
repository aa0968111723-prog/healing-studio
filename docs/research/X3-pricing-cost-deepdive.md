# X3 — modelPricing + costAnalytics 計費定價正確性逐行深挖(地毯掃描 wave X)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/services/modelPricing.ts(3500 行)、server/services/costAnalytics.ts(1241 行)

範圍聲明:本文件聚焦「定價正確性」本身(catalog 數值、公式、與 costAnalytics 統計邏輯的逐行檢查),
不重複 R4-cost-ledger-deepdive.md 已涵蓋的「帳本/歸屬機制全鏈」(ENABLE_COST_LEDGER 雙旗標分岔、
cost_ledger 多維度重複計數、TWD 匯率凍結設計)——本文件只在必要處引用 R4 結論作為背景,並在其之上
新增本次逐行深挖找到的、R4 未觸及的具體計算層 bug 與資料流缺口。

---

## 摘要

1. 最嚴重的兩個發現都是**可證實會真的動到使用者點數餘額 / 真的讓後台成本報表看不到錢**的機制性
   問題,而非單純的「數字寫得不夠新」:
   - **(C1)** 21 個 catalog 條目的 `unit` 標示「每 5 秒/每 6 秒/每分鐘影片/每段」等含 baseline 時長
     的字樣,卻沒有設定 `freeSecondsInBase`,導致 `estimatePoints`/`calculateActualCost` 把同一段
     時長的「起跳費」與「時長費」重複計費一次。透過 `falDispatcher.ts` 的真實用量對帳
     (`calculateActualCost` 用供應商回傳的實際 `outputVideoDuration`)已可確認這條路徑會呼叫
     `reconcileCredits→deductCredits`,是會真的從使用者餘額多扣點數的路徑。
   - **(C2)** `ai_usage_events`(costAnalytics.ts 唯一資料源)在整個 `server/` 目錄只有
     `server/routes/aiProxy.ts` 兩處寫入;而 AI 光球的「reasoning」LLM 推理呼叫走的是
     `server/_core/llm.ts` 直連供應商 API(`providerFacade.ts` 的 `directBaseUrl`),完全不經過
     `aiProxy.ts`。`llm.ts` 內建了一份精確的「真實 token 單價表」(`estimateTokenCostUsd`),但只餵給
     LangSmith 觀測,從未寫回 `ai_usage_events`——導致 costAnalytics.ts 的每一個統計函式對「reasoning」
     類模型的真實花費完全看不到。
2. 這兩個發現與 R4 已知的「catalog 是 2025 Q2 寫死估價、缺乏外部驗證」形成互補:R4 說「這份表可能
   不準」,本文件進一步證明「就算表準,公式本身在特定條目上會算錯」以及「就算算對了,有一整類真實花費
   根本沒進到 costAnalytics 看得到的表」。
3. 也發現第三份完全獨立、從未與前兩者對齊過的定價表(`server/_core/llm.ts` 的 `PRICING` 常數,
   真實 per-token USD),證實「reasoning」類模型至少存在 3 套互不校驗的價格認知(modelPricing.ts 的
   flat pts/call、llm.ts 的 per-token USD、以及 costAnalytics 從 `ai_usage_events` 算出來但其實
   拿不到資料的「統計值」)。
4. 目錄內部算術本身**大部分是自洽的**(206/208 條 `basePoints ≈ baseCostUsd × 100`),且沒有
   重複鍵、沒有 0 元定價、沒有 `requiresKey` 契約缺角——這些是本次稽核明確排除的疑慮,列在
   §「已驗證排除的疑慮」。
5. 檔案本身的注釋密度異常高(12 則「補:」回填註解 + 9 個追蹤中的 `DEF-*` 缺陷編號),證明
   「catalog key 與 dispatcher 實際呼叫 modelId 對不上」這類回歸過去已發生 12 次以上,而目前
   CI 唯一的 SSOT 一致性守門測試(`videoCatalogConsistency.test.ts`)只覆蓋影片類別,音訊/語音/
   TTS/3D/訓練/reasoning 類別完全沒有等效的自動化防護。

| 嚴重度 | 編號 | 一句話 | Cluster |
|---|---|---|---|
| Critical | C1 | 21 個「每 N 秒/每分鐘」條目缺 `freeSecondsInBase`,時長費與起跳費雙重計費,會真的多扣點數 | billing |
| Critical | C2 | reasoning/LLM 真實呼叫走 llm.ts 直連供應商,完全不寫 `ai_usage_events`,costAnalytics 對此類別的花費結構性看不到 | billing |
| High | H1 | reasoning 類模型存在 modelPricing.ts(flat/call)與 llm.ts(per-token USD)兩套從未互相校驗的定價 | billing |
| High | H2 | LLM/JSON 類 `pointsPer1kChars` 只吃輸入字元數,完全不計輸出長度,結構性低估高輸出量呼叫的真實成本 | billing |
| High | H3 | catalog/dispatcher modelId 對不上會靜默退回 5 pts 或讓對帳失效,過去已發生 12+ 次,SSOT 測試只護到影片類別 | billing |
| Medium | M1 | 2 個 NVIDIA NIM 條目 `basePoints` 低於自身 `baseCostUsd × 100`,違反檔案自訂的定價公式 | billing |
| Medium | M2 | `categorizeEndpoint` 前綴比對在多組「短 key 是長 key 前綴」情境下可能誤分類到錯誤 category(僅影響報表分類,非金額) | other |
| Medium | M3 | `suggestSavings` 用單一 `baseCostUsd` 跨模型比較「最便宜替代品」,未正規化到相同計費單位(秒數/張數不同) | other |

---

## Critical

### C1 — 21 個 catalog 條目「每 N 秒」但缺 `freeSecondsInBase`,時長費雙重計費

**發現**

`server/services/modelPricing.ts:83-92` 檔案自己的型別註解已經明講這個欄位存在的唯一理由:

```
83:  /** 時長乘數(每秒) — 僅限影片/音頻模型 */
84:  pointsPerSecond?: number;
86:  /**
87:   * basePoints 已包含的時長 baseline(秒)。例如 Kling V2.1 Standard 的
88:   * basePoints=30 對應「5 秒 baseline」,freeSecondsInBase=5,這樣
89:   * estimatePoints 才不會把同樣 5 秒再用 pointsPerSecond 加一次(雙倍計費)。
90:   * 沒設定(或設成 0)= 純加法,basePoints 是純啟動費。
91:   */
92:  freeSecondsInBase?: number;
```

`estimatePoints`(`modelPricing.ts:3301-3314`)與 `calculateActualCost`(`modelPricing.ts:3389-3401`)
兩處都用同一個公式:

```
3302:    const freeSec = Math.max(0, pricing.freeSecondsInBase ?? 0);
3303:    const billableSec = Math.max(0, durationSec - freeSec);
3304:    const extra = Math.round(billableSec * pricing.pointsPerSecond);
```

當 `freeSecondsInBase` 未設定,`freeSec=0`,`billableSec` 就等於**完整**時長,`extra` 會把整段
時長重新以 `pointsPerSecond` 計費一次,再加上原本就代表「這段時長基礎費」的 `basePoints`——
與 `unit` 標示的定價意圖(「每 N 秒 = X pts」)矛盾,變成「X pts(起跳) + 完整時長 × 費率」。

用程式碼裡兩個**同品牌、同 unit 標籤**但一個設對一個沒設的條目直接對照,可證明這是遺漏而非刻意設計:

| modelId | 行號 | unit | basePoints | pointsPerSecond | freeSecondsInBase | 60 秒實際扣點 |
|---|---|---|---|---|---|---|
| `fal-ai/topaz-upscale-video` | 1613-1628 | 每分鐘影片 | 20 | 0.33 | **60(有設)** | 20(正確,60-60=0) |
| `fal-ai/topaz/video-enhance` | 1552-1566 | 每分鐘影片 | 40 | 0.67 | **未設** | 40+round(60×0.67)=**80(雙倍)** |

同樣缺 `freeSecondsInBase` 的另外 20 個條目(`node` 腳本掃描全表得出,均為 `pointsPerSecond` 存在
但 `freeSecondsInBase` 缺席):

`fal-ai/sora`(529)、`fal-ai/ltx-video-13b-distilled`(546)、
`fal-ai/minimax/hailuo-02/pro/text-to-video`(562)、
`fal-ai/runway-gen4-turbo/image-to-video`(714)、
`fal-ai/minimax/hailuo-02/pro/image-to-video`(730)、
`fal-ai/ltx-video/image-to-video`(746)、`fal-ai/wan/v2.1/video-to-video`(1455)、
`fal-ai/kling-video/v1.6/standard/video-to-video`(1490)、`fal-ai/animatediff-v2v`(1506)、
`fal-ai/bytedance/upscaler/video`(1522)、`fal-ai/rife-v4.6/video`(1537)、
`fal-ai/cammaster`(1568)、`fal-ai/depthcrafter`(1583)、
`fal-ai/vidu/q1/reference-to-video`(1598)、`fal-ai/wan/v2.2-14b/speech-to-video`(3070)、
`fal-ai/echomimic-v3`(3085)、`fal-ai/stable-avatar`(3100)、`fal-ai/elevenlabs/dubbing`(3115)、
`fal-ai/longcat-single-avatar/audio-to-video`(3130)、
`fal-ai/ltx-2-19b/distilled/audio-to-video/lora`(3145)。

**這不是純理論——已確認有真實路徑會把多算出來的點數真的從使用者餘額扣掉:**

- `server/services/falDispatcher.ts:469-479` 在呼叫成功後,用供應商回應**實際量測到的**
  `payload.video.duration`(`outputVideoDuration`)呼叫 `calculateActualCost`:
  ```
  469:    const billingSeconds =
  470:      ((payload.metrics as { inference_time?: number } | undefined)?.inference_time ?? 0);
  472:    const outputVideoDuration =
  473:      ((payload.video as { duration?: number } | undefined)?.duration ?? 0);
  474:    const actualCost = calculateActualCost({
  475:      modelId: targetModelId,
  ...
  478:      outputVideoDuration,
  479:    });
  480:    if (typeof input.userId === "number") {
  481:      if (typeof input.estimatedCredits === "number") {
  482:        await reconcileCredits(input.userId, input.estimatedCredits, actualCost);
  ```
- `server/services/orbCostGuard.ts:159-173` 的 `reconcileCredits` 在 `actualRounded > estimatedRounded`
  時會直接呼叫 `deductCredits`(`orbCostGuard.ts:166-168`),`deductCredits`→`deductUserPoints` 是真的
  改 `users.remainingGenerations` 的路徑,不是報表用的估算值。
- `server/services/falDispatcher.ts:220-242`(`TIMEOUT_OVERRIDES` 表)證實上述 21 個 modelId 中至少
  `fal-ai/wan/v2.1/video-to-video`、`fal-ai/bytedance/upscaler/video`、`fal-ai/rife-v4.6/video`、
  `fal-ai/topaz/video-enhance`、`fal-ai/cammaster`、`fal-ai/vidu/q1/reference-to-video`、
  `fal-ai/depthcrafter`、`fal-ai/minimax/hailuo-02/pro`(t2v/i2v)、`fal-ai/ltx-video-13b-distilled`
  確實是登記在 `falDispatcher.ts` 可分派模型清單裡的活躍條目,而非死碼。

**影響**

任何工作流程(director/spiritTools 的影片精靈等)透過 `falDispatcher.ts` 分派到上述 21 個模型之一、
且供應商回應帶有可量測時長時,使用者實際被扣的點數會是「表定單價的 2 倍甚至更多」(時長越長、
`freeSecondsInBase` 應涵蓋的比例越被浪費,倍率視 `pointsPerSecond × 應涵蓋秒數 / basePoints`
而定,多數條目落在 1.5×–2× 之間)。這是直接的營收/使用者體感落差:使用者依 UI 顯示的「每 5 秒 X pts」
心理預期付費,實際扣款卻可能是兩倍。

**建議**

1. 為上述 21 個條目逐一補上 `freeSecondsInBase`(值 = `unit` 標示的秒數,如「每 5 秒」→ 5、
   「每分鐘影片」→ 60、「每 6 秒」→ 6);「每段影片/每段配音」這類無明確秒數單位的條目,應改為
   移除 `pointsPerSecond`(改純固定價)或明確定義其 baseline 秒數。
2. 補一條像 `videoCatalogConsistency.test.ts` 一樣的 CI 守門測試:對每個同時設有 `unit`(含「秒」
   字樣)與 `pointsPerSecond` 的條目,斷言 `freeSecondsInBase` 必須存在且 > 0,防止未來新增條目
   再犯同樣遺漏。
3. 在修正生效前,建議對這 21 個模型的近期 `ai_usage_events`/點數扣款記錄做一次回溯抽查,評估是否
   需要對受影響使用者退點。

---

### C2 — `ai_usage_events` 只有 aiProxy.ts 兩處寫入,AI 光球 reasoning/LLM 真實呼叫完全繞過、costAnalytics 對此類別花費結構性看不到

**發現**

全 `server/` 目錄搜尋 `db.insert(aiUsageEvents)`,只有兩處命中,且都在同一支檔案:

```
server/routes/aiProxy.ts:305:        await db.insert(aiUsageEvents).values({
server/routes/aiProxy.ts:533:        const insertResult = await db.insert(aiUsageEvents).values({
```

而 `costAnalytics.ts` 全部 15 個匯總/分析函式(`summarizeByCategory`、`summarizeByEndpoint`、
`compareCatalogVsActual`、`reconcileWithProviderInvoices`……)都只吃 `UsageEventLike[]`
(`costAnalytics.ts:39-47`),這個陣列在生產環境唯一的資料來源就是 `ai_usage_events` 表——
也就是說,costAnalytics.ts 能「看到」的成本,上限就是 `aiProxy.ts` 這兩處寫入涵蓋到的流量。

AI 光球的推理/對話(`modelPricing.ts` 的 `reasoning` 類別:`gemini-2.5-pro`/`gemini-3-pro`/
`google/gemini-*`/`anthropic/claude-*`/`openai/gpt-5`/`perplexity/sonar-*` 等,共 23 條目,
2038-2385 行)實際呼叫路徑是:

- `server/_core/llm.ts`(檔頭 1-14 行自述「三引擎並存架構」,直接用 `@langchain/google-genai`/
  Vertex/Forge SDK)
- 透過 `server/_core/providerFacade.ts:55` 的 `directBaseUrl: "https://generativelanguage.googleapis.com"`
  直接對供應商發請求(其餘供應商也各自有 `directBaseUrl`,見 `providerFacade.ts:52-72`)。
- `server/_core/llmRouter.ts` 全檔搜尋 `costUsd`/`insert(...Usage`/`insert(...Log` 均無命中。
- `llm.ts`/`llmRouter.ts` 兩支檔案都沒有 import 或呼叫 `routes/aiProxy.ts` 的任何內容,也沒有對
  `/api/ai-proxy/...` 發內部 HTTP 請求的痕跡。

也就是說 `llm.ts` 這條「AI 光球大腦」路徑,結構上就不會經過 `aiProxy.ts` 那兩處 `insert`,
因此**不會**寫進 `ai_usage_events`。

更關鍵的是,`llm.ts` 自己內建了一份**精確、貼近 2026 現況的真實 per-token 定價表**
(`llm.ts:599-641`,節錄):

```
605:  const PRICING: Record<string, { input: number; output: number }> = {
606:    // Native Gemini API IDs
607:    "gemini-2.5-pro": { input: 1.25, output: 5.0 },
609:    "gemini-3-pro": { input: 2.5, output: 15.0 },
614:    "anthropic/claude-opus-4.7": { input: 15.0, output: 75.0 },
615:    "anthropic/claude-sonnet-4.6": { input: 3.0, output: 15.0 },
618:    "openai/gpt-5": { input: 10.0, output: 30.0 },
636:  const p = PRICING[key];
637:  return (
638:    (usage.prompt_tokens / 1_000_000) * p.input +
639:    (usage.completion_tokens / 1_000_000) * p.output
640:  );
```

這個 `estimateTokenCostUsd()` 算出來的 `costUsd`(`llm.ts:662-663`)**只餵給 LangSmith 追蹤**
(`trackLangSmithSDK`,`llm.ts:735-744` 的 `extra.metadata.cost_usd`),從未寫回任何內部資料庫表。
LangSmith 是外部第三方觀測工具(需另外設定 `LANGSMITH_API_KEY` 才會啟用,`llm.ts:42`),不是
admin 後台「深度成本」面板的資料源。

**影響**

- `costAnalytics.ts` 的 `summarizeByCategory` 對 `"reasoning"`/`"llm"` 類別要嘛完全沒有列,要嘛
  只包含少數真正經由 `aiProxy.ts` 代理呼叫(而非 `llm.ts` 直連)的流量,admin 後台看到的「AI 大腦
  推理花了多少錢」在預設架構下是系統性低估、甚至可能是空的——但這正是「reasoning」類目錄裡
  單價最貴的一批模型(Claude Opus 4.7 $15/$75 每百萬 token、GPT-5 $10/$30 每百萬 token),對
  高頻對話式應用而言真實花費可能相當可觀,卻完全不在任何內部成本儀表板上。
- `compareCatalogVsActual`(`costAnalytics.ts:461-498`)、`reconcileWithProviderInvoices`
  (`costAnalytics.ts:974-1035`)這些「抓落差」的函式,對 reasoning 類別而言連比較的分母
  (真實花費)都不存在,無法發現任何異常。
- 這與 R4 §3 指出的「compareCatalogVsActual 是拿 catalog 表跟自己比」是不同層次的問題:R4 講的是
  「有資料但資料來源循環」,這裡是「reasoning 這整個類別的真實高單價流量,可能連進 `ai_usage_events`
  的機會都沒有」。

**建議**

1. 在 `llm.ts` 的成功回應路徑(`estimateTokenCostUsd` 算完之後)補一筆 `ai_usage_events` 寫入
   (或等效的內部成本紀錄呼叫),讓 reasoning 類別的真實花費至少能進到 costAnalytics 的統計基礎。
2. 若不方便直接耦合 DB 寫入到 `llm.ts`(維持其「純呼叫層」定位),至少應該在 `llmRouter.ts`/
   呼叫端(brain.ts、orbLLMReplan.ts 等)補一個統一的「reasoning usage 上報」hook,把
   `estimateTokenCostUsd` 算出的真實值餵進同一套 `ai_usage_events`/`cost_ledger` 管線,而不是
   只留在 LangSmith。
3. 若已知這是刻意的架構分工(LangSmith 專門管 reasoning 可觀測性,`ai_usage_events` 專門管
   media 生成成本),建議在兩份文件(admin 後台 UI 文案、costAnalytics.ts 檔頭註解)明確聲明
   「reasoning 類別成本不含在深度成本報表內,請至 LangSmith 查看」,避免使用者誤讀報表為
   「全站真實成本」。

---

## High

### H1 — reasoning 類模型存在兩套從未互相校驗的定價認知(flat pts/call vs per-token USD)

**發現**

`modelPricing.ts` 的 `reasoning` 類別(2038-2385 行)用「每次推理 N pts」的 flat 定價
(如 `anthropic/claude-sonnet-4.5`:`basePoints=5`、`pointsPer1kChars=5`、`maxPoints=150`,
2159-2173 行),而 `llm.ts:605-633` 對同一批模型維護了另一份**單位完全不同**的 per-token
USD 定價表(節錄同 C2)。兩份表由不同函式維護、鍵名部分不同(如原生 API id
`"claude-sonnet-4-6"` vs OpenRouter id `"anthropic/claude-sonnet-4.6"`),且從無任何測試或程式碼
互相對照過數值。

抽樣核對(以 `anthropic/claude-sonnet-4.5` 為例,catalog 行 2159-2173、llm.ts 行 616):
catalog 端固定收 basePoints=5(=$0.05)起跳、`pointsPer1kChars=5`,單次最高 150 pts(=$1.50);
llm.ts 端真實計費是 input $3/M + output $15/M token——若一次呼叫是 3,000 input + 3,000 output
token(約 4,000-8,000 中文字,對「說故事/療癒對話」場景並不誇張),真實成本 ≈
`(3000/1e6)*3 + (3000/1e6)*15 = $0.054`,與 catalog 的 $0.05 起跳大致接近;但只要輸入端帶大量
上下文(例如長篇故事接續、100K token 上下文視窗全開),真實 input 成本可單獨衝到
`(100000/1e6)*3 = $0.30` 以上,加上長輸出,catalog 端 150 pts($1.50)上限雖然名義上夠蓋,但因為
C2 指出的資料流缺口,這兩個數字從來沒有在同一個地方被比較過、也沒有寫入同一張表核對過。

**影響**

沒有任何自動化機制能回答「reasoning 類模型現在到底是賺是賠」這個問題——兩套系統各自用不同單位
(次 vs token)、不同基準(估計 vs 真實)在各自的角落運作,彼此不知道對方存在。

**建議**

短期:在 `modelPricing.ts` reasoning 類別的每個條目加註解,標明其 flat 定價與 `llm.ts` 對應
per-token 價格的換算關係與已知落差區間;中期:採 C2 建議,把 `estimateTokenCostUsd` 的結果
接進統一成本表後,兩者才有機會被同一支 reconcile job 自動比較。

---

### H2 — `pointsPer1kChars` 只吃輸入字元數,完全不計 LLM 輸出長度

**發現**

`estimatePoints` 的字元計費分支(`modelPricing.ts:3316-3325`):

```
3317:  const charCount = asPositiveNumber(params.charCount);
3318:  if (charCount > 0 && pricing.pointsPer1kChars) {
3319:    const charPoints = Math.ceil((charCount / 1000) * pricing.pointsPer1kChars);
```

`charCount` 的注入來源(`modelPricing.ts:3272` 型別註解「文字字符數」未區分輸入/輸出)。追蹤
實際呼叫端:

- `server/services/spiritTools/directorTools.ts:478-482`(`pickStepParams`):
  `out.charCount = args.prompt.length` / `args.text.length` —— 這是**呼叫模型前**組好的
  prompt/輸入文字長度,不含模型生成後的輸出。
- `server/services/cost/catalogCostFallback.ts:157-166`(`extractCatalogSignals`):
  `textField = body.text || body.input || ""`,`out.charCount = textField.length` —— `body`
  來自 `aiProxy.ts:501-504` 的 `req.body`(**請求本體**,發給供應商前的內容),同一支函式的檔頭
  註解(`catalogCostFallback.ts:157`)也自陳「字符數:… 否則由 text / input / prompt 字串長度推」,
  且 `aiProxy.ts:519-523` 呼叫時傳入的正是 proxy 收到的**請求** `bodyObj`,不是供應商回應內容
  (回應 `payload` 只用在 `extractUsageCostUsd`,`aiProxy.ts:489-494`)。

對 TTS 類別(`elevenlabs/*`、`fal-ai/*-tts`)而言這個設計是**正確**的——TTS 供應商本來就是按
「要合成的文字字元數」計費,輸入字元數就是真實成本驅動因子。但對 `llm`/`json`/`text-to-json`
類別(如 `fal-ai/any-llm`、`fal-ai/wizardlm-2-8x22b`、`fal-ai/dolphin-2.9.2-qwen2-72b` 等,
1634-1781 行,均設有 `pointsPer1kChars`)而言,LLM 真實計費的主要驅動因子恰恰相反——輸出
token(且輸出單價通常是輸入的 4-6 倍,見 H1 的 llm.ts 對照表),而這裡完全沒有計入。

**影響**

任何走這條 `pointsPer1kChars` 公式計費、且輸出內容偏長(例如故事續寫、長篇腳本產出,這正是
healing-studio 這類創作平台的核心使用情境)的呼叫,結構性地只按「使用者打的那句提示詞」長短計費,
跟模型實際吐出多少字完全脫鉤——短提示詞換來長輸出的呼叫會被嚴重低估。

**建議**

1. 對 `llm`/`json`/`text-to-json` 類別的計費公式,改為同時計入輸出長度(若無法取得真實 token
   數,至少用「輸出字數」做粗略代理),或改採與 `llm.ts` 一致的 per-token 計費模型。
2. 若短期無法重構公式,至少在 `unit`/`availabilityNote` 欄位加註「僅按輸入長度計費,長輸出可能
   低估」,讓下游(director/accountant 精靈的預算估算)知道這是已知簡化,不要把它當作精算依據。

---

### H3 — catalog / dispatcher modelId 對不上時靜默退回 5 pts 或讓對帳失效,已發生 12+ 次,SSOT 測試只護到影片類別

**發現**

`estimatePoints` 對目錄查無此模型的處理(`modelPricing.ts:3279-3288`):

```
3279:  if (!pricing) {
3280:    // 未知模型:收取標準費用
3281:    return {
3282:      modelId,
3283:      basePoints: 5,
...
3286:      breakdown: "未知模型(標準計費 5 pts)",
```

`catalogCostFallback.ts:78-80` 對同一情境的處理是直接放棄、回傳 `"0"`(其註解明確說明
「那是『使用者計費保底』非『真實成本』,不可拿來當真實價」)。也就是說 catalog key 對不上
dispatcher 實際呼叫的 modelId 時,分別會導致「使用者只被收 5 pts 的保底費」(不論真實成本多高)
或「內部成本歸零、對帳失真」兩種後果之一。

檔案內部證據顯示這不是假設性風險,而是反覆發生過的真實缺陷類別:

- 12 處「補:」回填註解,均以「videoStudio.ts / UI VideoStudio.tsx 實際呼叫的 ID」為由新增條目
  (528、545、561、577、713、729、745、761、1454、1470、1489、1505 行)。
- 9 個明確追蹤的 `DEF-*` 缺陷編號:`DEF-A2`(800 行,fal-ai/audioldm2 端點下架後的 fallback 對齊)、
  `DEF-V4`(2837 行,ElevenLabs turbo-v2.5 兩條目 maxPoints 不一致)、`DEF-V7`(2856、2875 行)、
  `DEF-V9`(2874、2892 行)、`DEF-D2`(2923 行,label 誤導修正)、`DEF-EL6`(943 行,「否則 dispatcher
  在 normalize 後 getModelPricing 會回 null,cost reconciliation 無法對帳」)、`DEF-So1`
  (2819 行)。這批 `DEF-*` 幾乎全部集中在**音訊/語音/TTS**類別。

現有的唯一 CI 自動化防護 `server/services/__tests__/videoCatalogConsistency.test.ts` 只掃描
`videoStudio.ts` 的 `fal-ai/*` 字面值與 `shared/videoModelCatalog.ts`/`brain.ts` 的
`GENERATION_ENGINE_CATALOG.videoEngine`(該測試檔 1-138 行),範圍明確限定影片類別
(T2V/I2V/V2V/enhance/control)。全 `server/` 目錄搜尋沒有找到針對 `falDispatcher.ts`、
`proStudio.ts`(音訊/語音/3D/訓練類別的主要呼叫端)或 `imageStudio.ts` 的等效 SSOT 一致性測試。

**影響**

音訊/語音/TTS/3D/訓練/reasoning 這些類別,一旦未來新增或修改 dispatcher 呼叫的 modelId 卻忘記
同步 catalog(正是過去 12+ 次已發生的模式),不會有 CI 紅燈提醒,會靜默退化成「使用者被收
5 pts 保底費(可能遠低於真實成本)」或「內部成本歸零、稽核看不到」,直到有人手動發現才會補上
下一個 `DEF-*` 編號。

**建議**

把 `videoCatalogConsistency.test.ts` 的模式(SSOT 字面值掃描 + catalog 存在性斷言)複製一份到
`falDispatcher.ts`(掃描 `TIMEOUT_OVERRIDES` 等內部模型清單)與 `proStudio.ts`(掃描
`chargeForFalTask` 呼叫的 `modelId`/`pricingKey` 字面值),堵住目前唯一沒有自動化防護的
音訊/語音/3D/訓練類別。

---

## Medium

### M1 — 2 個 NVIDIA NIM 條目 `basePoints` 低於自身 `baseCostUsd × 100`

**發現**

檔頭定價公式(`modelPricing.ts:23`)明講「basePoints 對應 baseCostUsd × 100」,全表 208 條目中
206 條精確或無條件進位滿足此式,唯獨 2 條反向低估(用腳本掃描 `basePoints < baseCostUsd*100` 得出):

| modelId | 行號 | basePoints | baseCostUsd | 依公式應為 |
|---|---|---|---|---|
| `nvidia/llama-3.1-nemotron-ultra-253b-v1` | 3232-3245 | 3 | 0.04 | 4 |
| `nvidia/llama-3.3-nemotron-super-49b-v1.5` | 3247-3260 | 1 | 0.015 | 1.5(進位應為 2,惟 `minPoints` 本身即為 1,實際更保守) |

**影響**

絕對金額很小(每次呼叫差 $0.005–0.01),但違反檔案自訂的內部定價公式,若未來有人依此公式做
批次校驗腳本,這兩條會被誤判為「異常」或反過來被忽略掉一個真實存在的小額低估。

**建議**

順手改成 `basePoints=4`/`2`(或调整 `baseCostUsd` 使兩者對齊),並在旁註明是刻意的(例如
「NVIDIA NIM 提供免費試用額度,故刻意訂低於參考成本」)避免下次稽核重複標記。

### M2 — `categorizeEndpoint` 前綴比對在特定 key 組合下可能誤分類(僅影響報表分類,非金額)

**發現**

`costAnalytics.ts:146-161`:

```
154:  const trimmed = endpoint.split(/[?#]/)[0];
155:  if (MODEL_PRICING_CATALOG[trimmed]) return MODEL_PRICING_CATALOG[trimmed].category;
157:  for (const key of Object.keys(MODEL_PRICING_CATALOG)) {
158:    if (trimmed.startsWith(key)) return MODEL_PRICING_CATALOG[key].category;
159:  }
```

用腳本掃描全表發現至少 22 組「短 key 是長 key 前綴」的情況,其中部分兩端 `category` 不同,例如
`"fal-ai/flux/dev"`(text-to-image,148 行)是 `"fal-ai/flux/dev/image-to-image"`
(image-to-image,265 行)的前綴,且前者在物件中插入順序較早。`trimmed` 只去掉 `?`/`#` 之後的
內容,不去掉路徑後綴,若某個實際 `endpoint` 字串在完整 modelId 之後還帶有額外路徑片段(例如
供應商回傳的 endpoint 帶版本/子路徑後綴,不在本次範圍內逐一驗證是否真的發生),`for...of` 迴圈
在第一個符合的 `key` 就 `return`,不保證挑到「最長/最精確」的前綴,可能把 `image-to-image` 呼叫
歸類成 `text-to-image` 的統計桶。

**影響**

僅影響 `summarizeByCategory`/`categorizeEndpoint` 的**報表分類**,不影響 `costUsd` 金額本身
(金額在寫入 `ai_usage_events` 當下就已經定案,這裡只是拿現成的 `costUsd` 分到錯的桶),
所以不是「多扣錢」問題,而是「深度成本報表的模態拆解可能有小比例誤植」問題。本次未逐一驗證
生產環境的 `endpoint` 欄位是否真的會帶上會觸發此路徑的後綴(直接 catalog key 完全比對命中時
根本不會進到這段前綴迴圈),嚴重度暫列 medium、且應視為「未在本檔驗證是否可觸發」。

**建議**

把 `for...of` 迴圈改成「找出所有符合前綴的 key、取字串最長者」,一次性根除排序依賴問題。

### M3 — `suggestSavings` 用 `baseCostUsd` 跨模型比較但未按計費單位正規化

**發現**

`costAnalytics.ts:884-902`:

```
884:  for (const [modelId, p] of Object.entries(MODEL_PRICING_CATALOG)) {
885:    const cur = cheapestPerCategory.get(p.category);
886:    if (!cur || p.baseCostUsd < cur.baseCostUsd) {
```

直接比較不同模型的 `baseCostUsd` 找「同類別最便宜」,但同一 category 內不同模型的 `unit`
基準未必相同(例如 image-to-video 類別內,有的模型 `unit="每5秒"`、有的是 `"每6秒"`,或
`training` 類別內每個模型的 `pointsPerStep` 隱含步數基準也不同)。多數 category 內部確實已經
用相近的秒數基準(5 或 6 秒)訂價,實務落差不大,但演算法本身沒有做任何單位正規化,只是恰好
巧合地大致可比。

**影響**

`suggestSavings` 是「建議」性質的輔助函式(admin 後台的降本建議),不直接影響扣款,但若未來
新增計費單位差異較大的模型進同一 category(例如把「每 10 秒」的模型跟「每 5 秒」的放一起比較),
會給出誤導性的省錢建議(推薦一個「單價低但單位涵蓋時長也短」的模型,實際上並不省錢)。

**建議**

比較前先用 `estimatePoints(modelId, { durationSec: 常數基準 })` 之類的方式正規化到同一 duration/
imageCount 基準,而不是直接比 `baseCostUsd` 原始值。

---

## 已驗證排除的疑慮(negative results)

1. **無重複 catalog key**:用腳本掃描全部 200 個物件字面量 key,無任何重複。
2. **無 0 元/0 點定價**:全表無 `basePoints===0`、`minPoints===0`、`baseCostUsd===0` 的條目,不存在
   「免費模型」或「定價缺漏導致實質免費」的情況。
3. **`requiresKey` 契約完整**:所有 `requiresKey: true` 的條目都有對應 `keyEnvVar`,沒有「宣稱需要
   金鑰卻沒登記環境變數名稱」導致 `checkModelAvailability` 誤判可用的情況;也沒有任何條目設
   `requiresKey: false`。
4. **`NVIDIA_API` 環境變數命名**:確認這是已知並已處理過的歷史問題(`DEF-13`,`env.validated.ts:93,700-701`
   有做 `NVIDA_API`→`NVIDIA_API` 自動改正 + `env-self-repair.test.ts` 覆蓋),非本次新發現的缺陷。
5. **basePoints/baseCostUsd 整體自洽**:208 條目中 206 條精確滿足「basePoints = baseCostUsd × 100」
   (向上取整),只有 M1 提到的 2 條 NVIDIA 條目反向偏低,整份表不是隨意亂填的數字。
6. **pts↔USD 換算單位統一**:`modelPricing.ts` 的 `pointsToUsd`、`catalogCostFallback.ts` 的
   `POINTS_PER_USD`、`shared/currency.ts:16` 的 `POINTS_PER_USD=100` 三處引用同一常數,沒有發現
   「某處用 100、某處用別的匯率」這類單位換算錯誤。
7. **`compareCatalogVsActual` 的 `??` fallback 實際上是死碼但無害**:`costAnalytics.ts:484` 的
   `pricing.baseCostUsd ?? pricing.basePoints / 100` 這個 fallback 分支在目前資料下永遠不會走到
   (因為每個條目都有 `baseCostUsd`),不構成正確性風險,只是可以精簡的冗餘程式碼。
8. **影片類別已有 SSOT 自動化防護**:`videoCatalogConsistency.test.ts` 針對 T2V/I2V/V2V/enhance/
   control 五個維度、且對 `videoStudio.ts` 的 `fal-ai/*` 字面值做 lint 式全文掃描,是本次稽核中
   唯一一個能夠攔截「catalog 與 dispatcher 對不上」這類回歸的自動化機制(參見 H3,惜僅限影片類別)。
9. **`ElevenLabs`/`Sonauto` 重複條目已對齊**:`DEF-V4`/`DEF-V9`(2837、2874-2892 行)顯示過去
   `elevenlabs/*` 與 `fal-ai/elevenlabs/tts/*` 兩組平行條目的 `maxPoints`/`pointsPer1kChars` 曾經
   不一致,現況已修正對齊,是良好的既有修復案例。

---

## 外部比價(信心中等 — 官方頁面本次連線回傳 403,以下僅供參考、非本次結論主證據)

本次嘗試對照 fal.ai / ElevenLabs / OpenRouter 目前掛牌價格,ElevenLabs 官方定價頁
(`elevenlabs.io/pricing/api`)與數個第三方比價聚合頁在本次環境中均回傳 HTTP 403,僅能取得
WebSearch 摘要結果,**未能以官方原始頁面覆核**,故不計入上方 Critical/High/Medium 正式清單,
僅記錄如下供人工複核:

- 多個第三方比價頁(2026-07)一致指出 ElevenLabs Flash v2.5 / Turbo v2.5 API 現行牌價約為
  **每 1,000 字元 $0.05**;而 `modelPricing.ts` 對應條目
  `elevenlabs/turbo-v2.5`(995-1009 行,`basePoints=1`/`baseCostUsd=0.01`)、
  `elevenlabs/flash-v2.5`(1010-1024 行,`basePoints=1`/`baseCostUsd=0.005`)只按 $0.01/1000 字元
  收費(受 `minPoints=1` clamp)。若此外部數字屬實,兩者相差約 5 倍,是本表「基準價格已超過一年
  未重新核價」(R4 §3 已指出的問題)最具體的量化例子之一,建議人工登入 ElevenLabs 官方後台
  核實現行 API 費率後更新 `baseCostUsd`。
- WebSearch 對 fal.ai Kling V2.1 的查詢顯示目前官網主推 Kling 2.1 Master / 2.5 / 2.6 系列,
  舊版「V2.1 Standard」命名的獨立定價頁已不易查得,不排除 fal.ai 端點命名或分級已變動,建議人工
  登入 fal.ai dashboard 核對 `fal-ai/kling-video/v2.1/*` 系列端點是否仍為現行有效路徑與價格。
- OpenRouter 現行 Claude Sonnet 4.5($3/$15 每百萬 token)、Claude Opus 4.7($5/$25,一說
  $15/$75,不同來源數字不一致,值得留意)與 `llm.ts:614-616` 內建數字大致同量級,與本文 H1
  的分析方向一致(級序正確,但兩套系統從未真正對齊過)。

---

## 未查證 / 需人工確認事項

1. `modelPricing.ts` 208 個模型條目的 `baseCostUsd` 是否每一條都仍對應供應商現行有效牌價——
   本次僅能對少數幾個高使用量模型做外部網路查證(且官方頁面多次 403,信心中等),未逐條核價;
   完整覆核需要人工登入 fal.ai / ElevenLabs / Suno / Google AI Studio / OpenRouter 後台。
2. C1 指出的 21 個「缺 `freeSecondsInBase`」條目中,除了已經確認 `falDispatcher.ts` 會用真實
   `outputVideoDuration` 觸發雙重計費之外,`videoStudio.ts` 的 `videoUpscale`/`frameInterpolation`/
   `topazEnhance` 三個 mutation handler(`videoStudio.ts:1280-1404`)本身在讀取的程式碼片段中
   未見到直接呼叫 `estimatePoints`/`calculateActualCost` 帶入時長參數——這三個端點的實際扣點
   機制(是否經由 `generationProcedure`/`requireVideoStudioLimit` 中介層扣款、是否也會走到
   `falDispatcher.ts` 那條路徑)未在本次時間內完整追蹤到底,需要再展開 `_core/trpc.ts` 的
   `generationProcedure` 定義才能確認。
3. `ai_usage_events` 在生產環境(Railway)實際的資料量與 `reasoning` 類別佔比——本文件只讀了
   程式碼路徑推論「結構上不會寫入」,未查詢實際資料庫確認目前是否有任何 `provider="gemini"`
   且 `category` 對應到 `reasoning` 的既有紀錄列(理論上不應該有,但未實測)。
4. `server/routes/aiProxy.ts` 除了作為對外 HTTP 代理路由,是否也被 `llm.ts`/`llmRouter.ts` 以外的
   其他內部呼叫端間接使用(例如某些 `image-to-json`/`json` 類別是否經由 aiProxy 代理),本次只
   完整追蹤了 `llm.ts` 這一條路徑,未逐一排查 `agentToolExecutor.ts`、`spiritTools/*` 是否還有
   其他直連供應商、同樣繞過 `ai_usage_events` 的呼叫點。
5. M2 指出的 `categorizeEndpoint` 前綴誤分類風險,是否在生產環境的 `endpoint` 欄位格式下真的
   可被觸發(即是否存在「完整 modelId + 額外後綴」但無法被步驟 155 的 trimmed 完全比對命中的
   真實案例),本次未實測。
