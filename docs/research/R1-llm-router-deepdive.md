# R1 — 多 Provider LLM 抽象層逐檔深挖

- 產生日期:2026-07-03
- 依據 commit:`7f4417daaacbf24510dc20d88dba9aae71b2883c`
- 屬於:深挖 wave R
- 前置文件:`docs/research/E-ai-agents.md`(已概述四層代理架構,§2/§8 提過 llmRouter/llm.ts 但未逐檔拆解)、`docs/research/K4-deadcode-contracts.md`(已點出 `modelRouter.ts` 孤兒)
- 方法:逐檔實讀 `server/_core/llmRouter.ts`(945 行)、`llm.ts`(2181 行)、`llmConcurrency.ts`(71 行)、`fallbackPolicy.ts`(361 行)、`providerFacade.ts`(157 行)、`modelRegistry.ts`(857 行)、`shared/engineModelIds.ts`(123 行)、`shared/unifiedModelRegistry.ts`(799 行)+ 其 9 個子註冊表、`server/services/modelRouter.ts`(23 行)、`providerRouter.ts`(375 行)、`modelClients.ts`(1165 行),並追蹤 `server/middleware/brainContext.ts` 的健康/降級邏輯與 `server/services/providerHealth.ts`、`shared/model-capability-registry.ts`。證據一律附 `檔案:行號`。

---

## 1. 路由決策全鏈:一個 invokeLLM 呼叫的完整路徑

### 1.1 全景流程圖(文字版,含 path:line)

```
呼叫端(orb/director/spirit/...) 呼叫 invokeLLM(params)  [llm.ts:1573]
│
├─① 系統提示詞合併(systemPrompt 併入 messages)            [llm.ts:1602-1630]
│
├─② Cache lookup(cacheable=true 才查;djb2 fingerprint)     [llm.ts:1632-1655]
│     命中 → 直接 return,不進引擎迴圈、不佔並行槽
│
├─③ 決定 resolvedPrimary 引擎
│     engine(強制) > preferEngine(偏好) > "auto"            [llm.ts:1661]
│     若仍是 "auto" 且 overrideModel 有值
│       → inferEngineFromModelIdSafe(overrideModel)         [llm.ts:1662-1667 → llmRouter.ts:411-443]
│           inferEngineFromModelId 依 prefix 判斷引擎:       [llmRouter.ts:357-402]
│             openrouter/* → openrouter
│             vertex/*     → vertex
│             perplexity/* 或裸 sonar(-*) → perplexity
│             minimaxai/* / nvidia/*      → nvidia
│             anthropic|google|openai|meta-llama|mistralai|
│               minimax|x-ai|deepseek|qwen|perplexity|cohere/* → openrouter
│             裸 claude-*  → anthropic
│             裸 gemini-*  → gemini
│             其餘 → null(交給下面 auto 序)
│           inferEngineFromModelIdSafe 再檢查:
│             推斷出的引擎 isEngineAvailable(斷路器)+ 金鑰存在 → 採用
│             否則若為 vertex/anthropic/gemini/perplexity 且 OPENROUTER_API_KEY 存在
│               → 自動降級改用 "openrouter"(靠 normalizeModelForEngine 改寫 model id)
│             否則 → null,回退到下方 auto 序
│
├─④ resolveEngineConfig(resolvedPrimary)                    [llmRouter.ts:515-562]
│     非 auto → resolveSpecificEngine(指定引擎),缺金鑰直接 throw
│     auto    → 依健康感知序嘗試:
│       openrouter > anthropic > perplexity > gemini > nvidia > vertex > forge > freellmapi
│       (isEngineAvailable 為斷路器 CLOSED/HALF_OPEN 時視為可用;OPEN 且未過冷卻則跳過)
│     全部不可用(含斷路中)→ 忽略斷路器再試一輪 → 仍失敗才 throw
│
├─⑤ 組 fallback 鏈(允許降級時)
│     allowFallback = ENABLE_LLM_FALLBACK≠"false" 且 (!engine || engine==="auto" || preferEngine 存在)
│                                                            [llm.ts:1695-1703]
│     getEngineFallbackChain(primary.engine, {latencyAware:true}) [llmRouter.ts:578-619]
│       → 對其餘 7 個引擎依 auto 序過濾「可用」者,latencyAware 開啟時
│         已有 EMA 延遲樣本的引擎依延遲遞增排,無樣本者維持原 auto 序排在後面
│
├─⑥ runEngineLoop()(整圈包在 withLLMSlot 內,只佔 1 個並行槽)  [llm.ts:1792-1880 / llmConcurrency.ts:63-70]
│     hedge=true 且鏈長度≥2 → 主引擎 + 第2引擎 delay 後賽跑(raceSuccess),
│       兩個都敗才從第 3 個引擎起 sequential fallback           [llm.ts:1795-1833]
│     否則 → sequential fallback:依序呼叫 callEngine(cfg, isLast) [llm.ts:1836-1854]
│
├─⑦ callEngine → invokeSingleEngine(engineConfig, ...)        [llm.ts:1715-1788 → 1898-2180]
│     a) rawModel = overrideModel ?? engineConfig.model
│     b) resolvedModel = normalizeModelForEngine(rawModel, engineConfig.name) [llm.ts:915-984]
│          openrouter → OPENROUTER_CATALOG_REMAP 精確表 / 去 "openrouter/" 前綴 /
│                       裸名補 provider 前綴(claude-→anthropic/,gemini-→google/,
│                       gpt-→openai/,minimax→minimax/,sonar(-*)→perplexity/)/
│                       未知裸名 → 安全預設 "anthropic/claude-sonnet-4.6"
│          perplexity → normalizePerplexityNativeModel:剝 "perplexity/" 前綴,
│                       白名單校驗(sonar/sonar-pro/…),未知一律降級 sonar-pro
│          anthropic  → ANTHROPIC_MODEL_REMAP(Gemini/OpenAI/OpenRouter id → Claude id)
│          nvidia     → nvidia/minimax-m2.7 或 minimax/minimax-m2 → minimaxai/minimax-m2.7
│          gemini/vertex → "vertex/" 前綴剝離;GEMINI_MODEL_REMAP(OpenAI/Claude→Gemini)
│     c) 依 engine 組 payload(Anthropic 走 messagesToAnthropic/toolsToAnthropic 雙向轉譯,
│        其餘走 OpenAI-compatible shape;Gemini schema 經 simplifySchemaForGemini 降階,
│        OpenRouter const→enum 改寫)                          [llm.ts:1121-1339, 986-1119]
│     d) fetch(engineConfig.url) — 每引擎 timeout = timeoutMs ?? LLM_TIMEOUT_SECONDS(預設60s)
│        [llm.ts:1944-1947, 2037-2126]
│     e) 失敗 → classifyLLMError(status, body) 分類            [llm.ts:1431-1472]
│          402 / quota 關鍵詞        → permanent_quota
│          401/403 / auth 關鍵詞     → permanent_auth
│          4xx(非429)+ invalid_model 關鍵詞 → permanent_model
│          其餘(5xx/429/…)          → transient(在本引擎內重試,見下)
│        transient 且 5xx/429 且未達 maxRetries → getRetryDelayMs 指數退避後重試
│          (maxRetries:有備援時=1,鏈上最後一個引擎時=3,上限 LLM_MAX_RETRIES=3)
│                                                              [llm.ts:2043-2144, 1345-1353]
│     f) 成功 → recordEngineSuccess(engine, latencyMs)(重置斷路器 + 更新 EMA 延遲)
│        失敗 → recordEngineFailure(engine, {permanent?, modelInvalid?, reason})
│          permanent_model → 只記觀測計數,**不**累進斷路失敗數(見 §3)
│          其餘 permanent  → 立即斷路 OPEN,冷卻 10 分鐘(PERMANENT_FAILURE_COOLDOWN_MS)
│          transient       → failures++,達 CIRCUIT_FAILURE_THRESHOLD(3)才斷路,
│                            adaptive cooldown 15s→30s→60s(2^trips,封頂)
│                                                              [llmRouter.ts:68-277]
│
└─⑧ 全鏈失敗 → 若全部因 permanent 失敗,包成 aggregate 錯誤訊息(區分金鑰/額度 vs 模型無效)
      → throw;若成功 → dedup/cache write-back → return              [llm.ts:1855-1893]
```

### 1.2 三層降級的關鍵順序(容易被誤解之處)

1. **model-id 層降級**(呼叫 invokeLLM **之前**):`server/middleware/brainContext.ts` 的 `findFallback()`(:558-597)在 5 槽推理大腦解析時,若 `getHealthStatus(model)`(:315-326)判定不健康,會用 `resolveFallbackChain`(`fallbackPolicy.ts:348-360`,查 `PER_MODEL_FALLBACK` 再退 `PER_CATEGORY_FALLBACK`)換一個 model id,再把新 id 塞進 `ctx.brain` 給呼叫端當 `overrideModel`。
2. **engine 層降級**(invokeLLM **內部**):`llmRouter.ts` 的斷路器 + `getEngineFallbackChain`,决定同一個 model id 該送到哪個 HTTP endpoint,失敗換下一個 endpoint。
3. **model-id 兼容改寫**(每次呼叫每個引擎前):`normalizeModelForEngine`,把①選出的 model id 改寫成②選中引擎能接受的格式。

**這三層彼此不共用健康狀態**(細節見 §4),①用的是 `healthCache`(60s TTL、樂觀預設 healthy),②用的是 `circuitBreakers` Map(即時、真實失敗驅動)。兩者可能同時對同一個 `"gemini-2.5-pro"` 給出不同答案。

---

## 2. Provider 抽象品質評估

### 2.1 加一個新 LLM provider 要改幾處

以「新增一個原生 provider(例如直連 Mistral API)」為例,至少要動:

| # | 檔案 | 要做的事 |
|---|---|---|
| 1 | `server/_core/llmRouter.ts` | `LLMEngine` union 加值(:45-54);`resolveSpecificEngine` 加 `case`(:624-809);`detectAvailableEngines` 加偵測邏輯(:449-508);`autoOrder`/`allOrder` 陣列插入位置(:529-538, 582-591,**兩處必須手動保持一致**);`getEngineStatus` 的 `missing` 清單(:820-832) |
| 2 | `server/_core/env.validated.ts` | `LLM_ENGINE` enum 加值(:533-536);新增 `MISTRAL_API_KEY` 等環境變數 schema |
| 3 | `server/_core/providerFacade.ts` | `FacadeProvider` union 加值、`PROVIDER_ROUTES` 加路由(:29-75);`engineGatewayProvider` 加 case(:143-156) |
| 4 | `server/_core/llm.ts` | `normalizeModelForEngine` 加對應 remap 表與分支(:915-984);若該 provider 的請求/回應格式非 OpenAI-compatible(像 Anthropic),要仿照 `messagesToAnthropic`/`toolsToAnthropic`/`anthropicResponseToInvokeResult` 整組新增雙向 adapter(:1121-1339);`estimateTokenCostUsd` 的 PRICING 表補價格(:605-633) |
| 5 | `server/_core/fallbackPolicy.ts` | `PER_MODEL_FALLBACK` 補新模型的降級候選,並把新模型加進其他模型的降級候選裡(:15-241,**雙向手改,無自動化一致性檢查**) |
| 6 | `server/_core/modelRegistry.ts` | 若要讓使用者在「大腦設定」UI 選到,得把新模型 value 加進 `REASONING_MODEL_CATALOG` 的對應 slot(:23-301) |
| 7 | `server/middleware/brainContext.ts` | `DEFAULT_REASONING_BRAINS`/`ECONOMY_*`/`PREMIUM_*` 三個分層預設表(若要設為預設值) |
| 8 | 測試 | `server/llm-engine-inference.test.ts`、`llm-fallback.test.ts`、`llm-permanent-error.test.ts` 等需補案例 |

**至少 6-8 個檔案、無單一「註冊一次就自動生效全站」的機制。** `modelRegistry.ts` 檔頭自稱是「Single Source of Truth」,但它只統整**選項清單**(讓 UI/白名單知道有哪些合法值),並不驅動 §1 的路由/改寫邏輯——路由改寫邏輯是 `llmRouter.ts`+`llm.ts` 兩檔各自維護的一批平行 Record 常量(`OPENROUTER_CATALOG_REMAP`/`GEMINI_MODEL_REMAP`/`ANTHROPIC_MODEL_REMAP`/`PER_MODEL_FALLBACK`),彼此靠人工保持同步,没有编译期或运行时的交叉校验。

### 2.2 加一個新模型(同 provider,例如 OpenRouter 上新出的 Claude 版本)

比新增 provider 輕,但仍要動:
1. `modelRegistry.ts` 的 `REASONING_MODEL_CATALOG`(讓使用者選得到)
2. `fallbackPolicy.ts` 的 `PER_MODEL_FALLBACK`(新模型的降級鏈 + 補進舊模型鏈的候選,如把新旗艦插到 opus-4.7 前面)
3. `llm.ts` 的 `OPENROUTER_CATALOG_REMAP`/`ANTHROPIC_MODEL_REMAP`(如果新模型有多種 id 形式需要互轉)
4. `llm.ts` 的 `estimateTokenCostUsd` PRICING(否則 LangSmith trace 的成本估算會 fallback 到 `gemini-2.5-flash` 價格,見 :634-636)

`modelRegistry.ts` 有 `buildKnownModelIds()`(:818-838)自動彙整多個 catalog 到一個 `KNOWN_MODEL_IDS` 集合,這部分確實做到了自動衍生;但 fallback 鏈與 remap 表**沒有**類似的自動衍生機制,是純手工維護的平行結構。

### 2.3 生成模型(圖片/影片/音樂/語音)的分散程度更高

`shared/` 下有 **9 個獨立模態註冊表**(`imageUpscaleModelRegistry.ts`、`textToImageModelRegistry.ts`、`imageToImageModelRegistry.ts`、`skeletalModelRegistry.ts`、`imageToVideoModelRegistry.ts`、`v2vModelRegistry.ts`、`audioModelRegistry.ts`、`voiceModelRegistry.ts`、`fineTuneModelRegistry.ts`),`unifiedModelRegistry.ts`(:269-279)手動 `.map(normalizeXxxModel)` 逐一匯入合併成 `UNIFIED_MODEL_REGISTRY`——每加一個新領域註冊表,都要在這裡手寫一個 `normalizeXxxModel` 轉接函式 + 加進陣列 + 在 `ModelDomain` union 加值 + 在 `inferDomainFromPrompt`(:565-639)加關鍵字判斷分支。此外還有:
- `server/services/falModels.ts`(2434 行,16 大類 Fal 任務目錄,`modelRegistry.ts` 靠它衍生 `FAL_TASK_ENGINE_CATALOG`)
- `shared/model-capability-registry.ts`(56 行,`MODEL_CAPABILITY_REGISTRY`,只有 5 筆 internal 佔位模型,唯一消費者是孤兒 `modelRouter.ts`,見 §4)
- `shared/videoModelCatalog.ts`(另一份影片型錄,`fallbackPolicy.sync.test.ts` 有引用,與 `falModels.ts`/`GENERATION_ENGINE_CATALOG.videoEngine` 部分重疊)

**沒有單一真相源。** 至少存在 4-5 條平行的模型型錄系(推理 5 槽 catalog、生成 4 槽 catalog、Fal 16 類 catalog、9 模態統一登記簿、孤兒的 capability registry),彼此用不同的 `modelId` 字串格式(`fal-ai/xxx` vs `fal/xxx` vs `gemini/xxx` vs 裸模型名),靠 `shared/engineModelIds.ts` 的 `LEGACY_FAL_ALIAS_MAP`(:5-99,人工維護的別名對照表)在執行期互轉,新增/改名模型時很容易漏改其中一處(`LEGACY_FAL_ALIAS_MAP` 本身的註解 :82-98 記錄了至少一次「fal 改了真實路徑但某處還在用舊 id」的事故)。

---

## 3. Fallback / 重試 / 降級

### 3.1 降級鏈設計是合理的,且有明確防無限迴圈機制

- **每個引擎的重試次數有硬上限**:`LLM_MAX_RETRIES=3`(:1348),且鏈上非最後一個引擎的 `retriesOverride=1`(:1745),避免「每個引擎都重試 3 次 × 8 個引擎」的組合爆炸——最壞情況大約是 `1 次(前 7 個引擎各試1次) + 3 次(最後一個引擎)= 10 次` HTTP 呼叫,而非 24 次。
- **fallback 鏈本身不會迴圈**:`getEngineFallbackChain` 明確排除 `primaryEngine` 自己(:595),且 `allOrder` 是固定的 8 元素陣列,`engineConfigs` 陣列長度有界(最多 8),`runEngineLoop` 的 for 迴圈跑完陣列就結束,不存在遞迴或重新排入佇列的路徑。
- **模型無效(permanent_model)刻意設計成不觸發斷路**(:100-109, 224-238):作者在註解中明確論證了「為何」——因為 invalid_model 是「這次呼叫的模型 id 對這個引擎無效」,引擎本身健康;如果誤累進斷路計數,某個 brain 設了錯的 model id 會反覆觸發 invalid_model(中間沒有成功呼叫拉低計數),第 3 次就會把健康的引擎斷路 10 分鐘,連累所有用**其他有效模型**打同一引擎的請求。這是本檔案中少見的、有留白防呆設計文檔且經得起推敲的部分。

### 3.2 但存在跨系統不一致的風險(見 §1.2 / §4)

`brainContext.ts` 的 `findFallback` 是在 invokeLLM **之前**执行的 model-id 換血,它依賴的 `getHealthStatus`(healthCache)**與 llmRouter 的斷路器完全不通訊**:
- `healthCache` 的探測邏輯(`scheduleHealthCheck`,:387-425)**並未真的打 API**,只是呼叫 `isRecognizedModel` = `isCanonicalOrKnownModel(id)`(:434-436 → `modelRegistry.ts:847-849`)——也就是「這個字串有沒有出現在某個 catalog 裡」。這與函式上方的 docstring「LLM 模型:嘗試一次極小的 invokeLLM 呼叫」(:380-381)**完全不符**——只要 model id 拼寫正確、在 catalog 裡,`getHealthStatus` 幾乎恆為 `true`,`findFallback` 幾乎永遠不會被觸發,無論實際 API key 是否缺失或 provider 是否真的掛掉。
- 唯一能讓 `healthCache` 標記不健康的正式入口是 `reportEngineFailure`(:442-458),而全站只有 `server/services/brainAutoRepair.ts:882` 這一個生產路徑呼叫它(其餘呼叫皆在測試檔)——即一個獨立的背景巡檢 job,並非 invokeLLM 失敗時即時回寫。也就是說:「brainContext 認為某模型健康」與「llmRouter 斷路器認為某引擎不健康」之間,只靠 `brainAutoRepair` 的巡檢週期(而非即時失敗事件)勉強對齊,兩者短時間內可能給出矛盾答案。
- 影響:即使 `llmRouter` 已把 `anthropic` 引擎斷路 OPEN(連續 401 三次),`brainContext` 的 5 槽解析仍可能繼續把 `director` 槽解析成 `claude-opus-4.7`(因為它「已知」),`invokeLLM` 收到後才在 engine 層走 fallback——多繞了一層,但**不會**造成錯誤(因為 invokeLLM 自己的斷路器判斷才是實際決定 HTTP 目標的權威),只是 `brainContext` 這層「優雅降級」形同虛設,degradation 事件/telemetry 也因此幾乎不會被記錄,讓運營者誤以為系統一直健康。

### 3.3 成本歸屬(cost attribution)不完整

- `estimateTokenCostUsd`(`llm.ts:599-641`)**只**餵給 LangSmith 追蹤(`trackLangSmithSDK`,:645-752),而 LangSmith 整合本身是條件式的(`serverEnv.LANGSMITH_API_KEY` 未設就整段 no-op,:39-54)。
- 站內真正的成本資料庫 `apiUsageLogs` 表(`server/db.ts:1875` `createApiUsageLog`)只被 `server/routers/generate.ts`(圖片/影片/音樂/語音生成)寫入,**LLM 推理呼叫(`invokeLLM`/`ai.chat` 的文字生成)完全沒有寫入 `apiUsageLogs`**——這代表 `accountant.usage`、月度預算閘(`enforceMonthlyBudgetGate`)、`ENABLE_ORB_COST_GUARD` 這些「成本控制」機制,實際監控的只是**生成模態(圖/影/音/聲)的花費**,推理大腦(5 槽 LLM,含最貴的 Opus 4.7 / GPT-5)的 token 成本**沒有被計入使用者的每日/每月花費歸戶**,只在 LangSmith(若有設定)裡有一份不會被站內任何 guard 讀取的估算值。
- 對於一個把「多 provider LLM」當核心賣點、且明確設計了斷路器/延遲感知路由的系統而言,這是成本控制鏈上一個實質的缺口——費用最高的路徑反而是唯一不被追蹤入帳的路徑。

---

## 4. 孤兒 / 重複:三個 *Router 檔案的關係

| 檔案 | 職責 | 消費者 | 狀態 |
|---|---|---|---|
| `server/_core/llmRouter.ts` + `llm.ts` | **LLM 引擎級路由**:給定 model id + engine 偏好,決定實際打哪個 provider HTTP endpoint,含斷路器/延遲感知/自動降級 | `invokeLLM` 全站唯一入口,被 `ai.ts`/`director/*`/`orb*`/`spirit*` 等 60+ 檔引用(§1) | **活躍、核心** |
| `server/services/providerRouter.ts` | **意圖級 provider 選擇**:給定 `ProviderRouteIntent`(`planner_text`/`generate_image`/`code_task`/`voice_tts`/…)+ 風險等級,從 9 個 provider(`gemini`/`default_llm`/`claudeCode`/`codex`/`fal`/`elevenlabs`/`suno`/`minimax`/`disabled`)中選一個,健康資料來自獨立的 `providerHealth.ts`(`healthStore` Map,`setProviderHealth`/`markProviderFailure` 手動回報) | `server/routers.ts:243`、`server/routers/ai.ts:128`(附件/多模態判斷路徑,E-ai-agents.md §1.1 步驟11 已引用)、3 支測試 | **活躍,但與 llmRouter 是平行系統,職責不重疊**(它決定「這次附件要不要走 Gemini 多模態」這類上層意圖判斷,不涉及 HTTP endpoint 細節或 model id 改寫) |
| `server/services/modelRouter.ts` | 依 `shared/model-capability-registry.ts`(5 筆 internal 佔位模型)的 `taskKind` 執行模型任務,含 `dryRun` 模式 | **全站 0 引用**(僅自身測試 `tests/unit/server/modelRouter.test.ts` import) | **孤兒**(與 K4-deadcode-contracts.md:88-90 的判定一致) |

### 4.1 三者不是同一條路由鏈的三個版本,而是兩個活躍系統 + 一個孤兒

- `llmRouter.ts` 與 `providerRouter.ts` **不衝突、不重複**——一個管「HTTP 層該打哪個 provider 的哪個 endpoint」(LLM 專用,含 model id 改寫/斷路器),一個管「這次任務該用哪個 provider 家族」(涵蓋 code/deploy/image/audio/voice,不只 LLM,且不碰 model id 或 HTTP 細節)。兩者健康判斷機制也不同源:`llmRouter` 用即時失敗驅動的斷路器,`providerRouter` 用 `providerHealth.ts` 的手動回報 Map(`healthStore`,:17,预设永远 healthy 除非被显式 set)。**這是本次深挖找到的第三個獨立健康追蹤系統**(第一個是 `llmRouter` 斷路器,第二個是 `brainContext` healthCache,第三個是這裡的 `providerHealth.ts`)。三者互不通訊,各自有一份「這個 provider/model/engine 健不健康」的答案。
- `modelRouter.ts` 則是真孤兒——`executeModelTask` 從未被任何路由器/服務呼叫,`MODEL_CAPABILITY_REGISTRY` 的 5 筆 internal 模型(`internal-image-draft`/`internal-video-shot`/`internal-voice-tts`/`internal-music-gen`/`internal-llm-copy`)在 `GENERATION_ENGINE_CATALOG`/`FAL_MODEL_CATALOG`/`unifiedModelRegistry.ts` 裡完全沒有對應實體,像是一個曾經規劃但未接線的「內建生成」抽象層草案。

### 4.2 收斂建議

- `modelRouter.ts` + `shared/model-capability-registry.ts`:建議直接刪除(K4 已建議),或若仍想保留「內建 dry-run 任務執行」的構想,至少要接一個真正的呼叫端(例如讓 `agentToolExecutor` 在缺少外部 key 時走它做 dry-run 預覽),否則就是純維護負擔。
- `providerRouter.ts` 保留,但建議把它的健康資料源改為讀 `llmRouter.getCircuitBreakerStatus()`(對 LLM 類 provider,如 `gemini`/`default_llm`/`minimax`)而非自己的 `providerHealth.ts` Map——目前一個請求可能先被 `providerRouter` 判定 `gemini` healthy(因為沒人手動 `setProviderHealth`),選中後才在 `invokeLLM` 內部撞上斷路器 OPEN,多繞一層。
- `brainContext.ts` 的 `healthCache`/`findFallback`:要嘛把 `scheduleHealthCheck` 改成真正探測(哪怕只是輕量 HEAD/ping),要嘛承認它只是「拼字檢查」並改掉误导性的 docstring 與 degradation telemetry 的呈現方式(目前 `BrainAuditLogger.degradation`/`requestSummary` 的 `healthyBrains`/`healthyEngines` 數字會讓人以為在做真實健康監控)。

---

## 5. 與本質的關聯:5 槽大腦 / 成本控制 / 可靠生成

### 5.1 對「大腦 5 slot」的影響

5 個推理槽(`director`/`analyst`/`storyteller`/`technician`/`curator`,`modelRegistry.ts:23-301`)本質上只是「哪個 model id 字串塞進哪個槽」的組態問題,真正決定「這次請求打哪個 provider」的是 `invokeLLM` 的 engine 路由(§1)。這代表:
- 使用者在 `/ai-brain-settings` 把 `director` 槽設成 `nvidia/llama-3.1-nemotron-ultra-253b-v1`,只要 `NVIDIA_API`/`NVIDA_API` 沒設,`inferEngineFromModelIdSafe` 會判定引擎不可用且非 vertex/anthropic/gemini/perplexity 四種可自動轉 OpenRouter 的類型(nvidia prefix 不在自動轉清單內,:427-434),`resolveEngineConfig` 直接退回 `"auto"` 序——實際打出去的可能是完全不同的模型(例如 OpenRouter 上的 Claude),使用者在 UI 上看到的「已選模型」與「實際生效模型」會不一致,且沒有一個回饋管道告訴使用者「你選的槽其實沒生效」。
- 5 槽的「品質差異化」(director 用旗艦、technician 用快速)依賴的是**呼叫端**各自傳入不同 `overrideModel`,路由層本身對「這是哪個槽」無感——斷路器狀態是**引擎級**共用的(不分槽),某槽把 anthropic 打斷路後,其他槽的 anthropic 呼叫也會立即被跳過,這是合理的資源保護行為,但目前沒有任何機制讓「高優先槽」(如 director)在斷路期間有優先試探權——`isEngineAvailable` 的 HALF_OPEN 試探名額是全站共用的單次配額,可能被低優先槽的呼叫搶走。

### 5.2 對「成本控制」的影響

見 §3.3——最貴的推理呼叫(Opus 4.7 / GPT-5 / Sonar Reasoning Pro)完全不進 `apiUsageLogs`,月度預算閘、使用者面板看到的「花費」系統性低估。`PREFER_CHEAP_MODELS` 分層(economy/balanced/premium,`brainContext.ts:234-278`)是唯一的成本控制槓桿,但它是靜態環境變數,不是動態依實際花費調整。

### 5.3 對「可靠生成」的影響

斷路器 + 降級鏈 + hedge 設計本身相當扎實(§3.1),是這次深挖中少數「文檔與實作高度一致、邊界條件有想清楚」的子系統。真正的可靠性風險不在 `llmRouter.ts` 內部,而在**它與周邊系統的邊界**:brainContext 的假健康檢查(§3.2)、三套互不通訊的健康狀態源(§4.1)、以及 fallback 鏈完全靠人工維護的一致性(`PER_MODEL_FALLBACK`/`OPENROUTER_CATALOG_REMAP`/`ANTHROPIC_MODEL_REMAP` 三表互相之間沒有自動化交叉驗證,新模型上線只改一表、漏改另一表不會有任何編譯期或執行期警告)。

### 5.4 改進提議(依優先序)

1. **修正或移除 brainContext 的假健康檢查**(高優先、低成本):`scheduleHealthCheck`(:387-425)要嘛接上真實探測,要嘛把 docstring 改為誠實描述「僅檢查 model id 是否在已知清單」,並考慮讓它訂閱 `llmRouter.getCircuitBreakerStatus()` 作為輸入,而不是自建一套假的健康源。
2. **LLM 呼叫接入 `apiUsageLogs`**(高優先、中成本):在 `invokeSingleEngine` 成功回傳處(`llm.ts:2166` 附近)呼叫 `createApiUsageLog`,把 `estimateTokenCostUsd` 的結果實際落地,讓月度預算閘/使用者面板涵蓋推理花費,而不只是圖/影/音/聲。
3. **統一健康狀態源**(中優先、中成本):讓 `providerRouter.getProviderStatus`(`providerRouter.ts:307-312`)對 LLM 類 provider 讀 `llmRouter.isEngineAvailable`/`getCircuitBreakerStatus`,退場 `providerHealth.ts` 對 LLM provider 的獨立追蹤(它對 fal/elevenlabs/suno 等非 LLM provider 仍有存在價值,可以保留)。
4. **fallback/remap 表加一致性測試**(中優先、低成本):寫一支測試遍歷 `modelRegistry.ts` 的 `getKnownModelIds()`,斷言每個 id 若出現在 `PER_MODEL_FALLBACK` 的 key,其 value 陣列裡的每個 id 也都在 `KNOWN_MODEL_IDS` 裡(防止 fallback 鏈指向一個已下架/改名的 id);同理對 `OPENROUTER_CATALOG_REMAP`/`ANTHROPIC_MODEL_REMAP` 做「來源 id 必須出現在某個 catalog」的斷言。`server/_core/fallbackPolicy.sync.test.ts` 已存在同類精神的測試,建議擴大覆蓋範圍到 llm.ts 的三張 remap 表。
5. **清掉孤兒**(低優先、低成本):刪除 `modelRouter.ts` + `shared/model-capability-registry.ts`,或至少在 K4 已標記的基礎上這次再次確認並排入清理待辦。
6. **收斂生成模型型錄**(低優先、高成本,建議獨立 wave 處理):9 個模態註冊表 + `falModels.ts` + `videoModelCatalog.ts` 之間的重疊與別名機制(`LEGACY_FAL_ALIAS_MAP`)是本次發現中最龐雜的一塊,值得單獨開一輪深挖評估合併可行性,本文只做現況記錄不展開設計。

---

## 未查證清單

1. `providerRouter.ts` 選中 provider 後,`ai.ts` 是否有進一步把「provider 選擇」與「實際呼叫哪個引擎/模型」接回 `invokeLLM` 的完整資料流——本文只確認了 `routers/ai.ts:128`/`routers.ts:243` 的 import,未逐行追蹤 `selectProvider` 的回傳值在 `ai.chat` handler 內如何具體影響後續 `invokeLLM(engine/preferEngine)` 參數。
2. `brainAutoRepair.ts` 的巡檢週期、觸發條件、以及它與 `reportEngineFailure`/`healthCache` 的完整生命週期——只確認了它是生產環境唯一呼叫 `reportEngineFailure` 的地方,未讀該檔全文(882 行僅讀到呼叫點附近)。
3. `shared/videoModelCatalog.ts` 與 `GENERATION_ENGINE_CATALOG.videoEngine`/`FAL_MODEL_CATALOG` 的實際重疊範圍與是否已有既定的「以誰為準」共識——只從 grep 結果確認三者共存且被不同測試引用,未逐一比對 model id 清單差異。
4. Hedge 模式(`llm.ts:1795-1833`)在生產環境的實際啟用率——是否有任何呼叫端把 `hedge:true` 設為預設,或僅是預留的呼叫端 opt-in 能力,本文未 grep 全站 `hedge:\s*true` 的實際使用點。
5. `estimateTokenCostUsd` 的定價表(`llm.ts:605-633`)與各 provider 官方現行定價的準確度——只確認了它「存在」且「未落地到 apiUsageLogs」,未逐一核對數字是否過期。
6. `MAX_CONCURRENT_LLM_CALLS`(全站單一號誌,預設 5)在多租戶/多 brain 槽同時高並發下是否會造成某些低優先呼叫(如背景 replan)長時間排隊餓死——只讀了 `llmConcurrency.ts` 的 FIFO 實作,未追蹤佇列深度的實際監控/告警。
