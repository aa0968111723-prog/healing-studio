# W4 — brainPipeline.ts 編排 monolith 逐行深挖(逐檔深挖 wave W)
- 產生日期:2026-07-03
- 依據 commit:7b18b76f
- 稽核檔案:server/routers/brainPipeline.ts(3401 行)

## 0. 先澄清檔案本質(這會改變後面每一項判讀)

檔頭(`server/routers/brainPipeline.ts:1-12`)寫得很清楚:

```ts
/**
 * Brain Pipeline Visualization Router
 * ────────────────────────────────────────────────────────────────────────────
 * 聚合既有的健康狀態、錯誤追蹤、頁面註冊表、Provider 健康偵測，組合成一張
 * 「AI 大腦組態管線圖」，提供給前端 React Flow 可視化呈現。
 *
 * 兩個 procedures：
 *   - getGraph      → admin only：全站完整管線
 *   - getMyGraph    → 任何登入用戶：個人腦組態（5 推理 + 4 引擎 + 我能用的 provider）
 *
 * 不重新偵測，只彙整既有資料源（不會額外打外部 API）。
 */
```

實際讀完全檔(3401 行,含大量靜態 catalog 陣列 `PROVIDERS` / `API_ENDPOINTS` / `WEBHOOK_ENDPOINTS` / `CRON_JOBS` / `INFRA_NODES` 等)後確認:**這不是一支會執行生成、扣點、呼叫 LLM 的「編排 pipeline」,而是一支唯讀的「站內架構可視化」路由**。它匯出 4 個 procedure(`getGraph`、`getMyGraph`、`getSummary`、`runPatrol`,見 `server/routers/brainPipeline.ts:3339-3376`),全部是同步組圖或轉發既有健康快照,**不呼叫任何 LLM、不寫入任何生成/計費資料**。

這個定位差異直接決定了稽核任務清單中幾個項目的答案:

- **計費/退款**:本檔案未發現任何扣點、退款、生成呼叫邏輯。詳見第 4 節。
- **注入/上下文組裝**:本檔案未發現任何把使用者輸入組進 LLM prompt 的邏輯。詳見第 5 節。
- **編排狀態機/重啟即失**:本檔案沒有多階段執行狀態機,只有一個 5 秒 TTL 的記憶體回應快取。詳見第 3 節。

真正值得列為稽核發現的,是這支「可視化路由」本身在**資料正確性**與**授權範圍**上的問題 —— 它自稱只給使用者看「個人腦組態」,但實際回傳的資料既不是該使用者的真實設定,也遠遠超出「個人」範圍。以下依嚴重度排序。

---

## 1.〔高〕`getMyGraph`「我的大腦」從未讀取使用者實際的大腦設定,也從未讀取伺服器實際生效的模型分層 —— 顯示的永遠是同一份寫死的靜態預設

**發現**

`getMyGraph` 是 `protectedProcedure`(任何登入用戶可呼叫),對應前端 `client/src/pages/MyBrainPage.tsx:25,32,69` 標題明確寫「我的大腦 / My Brain」,語意上承諾「這是你自己的腦組態」。

```ts
// server/routers/brainPipeline.ts:3349-3356
/** 個人版腦組態（任何登入用戶） */
getMyGraph: protectedProcedure.query(() => {
  return getCachedGraph("personal", {
    includeAllPages: false,
    includeRouters: false,
    includeAlerts: false,
  });
}),
```

`getMyGraph` 完全沒有取用 `ctx`(連 `ctx` 參數都沒宣告),因此不可能知道呼叫者是誰。它最終落到 `buildGraph()`,而 `buildGraph()` 產生「推理腦槽」「生成引擎槽」節點時,讀的是從 `server/middleware/brainContext.ts` import 進來的**全站靜態常數**:

```ts
// server/routers/brainPipeline.ts:21-28
import {
  getHealthSnapshot,
  getHealthCacheVersion,
  DEFAULT_REASONING_BRAINS,
  DEFAULT_GENERATION_ENGINES,
  type ReasoningBrainSlot,
  type GenerationEngineSlot,
} from "../middleware/brainContext";
```

```ts
// server/routers/brainPipeline.ts:2372-2374
for (const slot of Object.keys(DEFAULT_REASONING_BRAINS) as ReasoningBrainSlot[]) {
    const defaultModel = DEFAULT_REASONING_BRAINS[slot].model;
    const meta = REASONING_SLOT_META[slot];
```

```ts
// server/routers/brainPipeline.ts:2407-2410
for (const slot of Object.keys(
    DEFAULT_GENERATION_ENGINES
  ) as GenerationEngineSlot[]) {
    const defaultEngine = DEFAULT_GENERATION_ENGINES[slot].engine;
```

問題有兩層,都在 `server/middleware/brainContext.ts`(brainPipeline.ts 的依賴,佐證用):

1. **使用者若在 `/ai-brain-settings` 自訂了自己的模型**,那份設定存在 `userAiBrain` 表,要靠 `buildBrainContext(userId)` 讀出(`server/middleware/brainContext.ts:607-628`,`.where(eq(userAiBrain.userId, userId))`)。`brainPipeline.ts` 完全沒有 import 或呼叫 `buildBrainContext`,所以「我的大腦」畫面**永遠不會反映使用者自己改過的設定**,不論是 admin 全圖還是「個人版」都一樣 —— 兩者都用同一份全站預設。

2. **伺服器實際生效的模型分層也對不上**。`brainContext.ts` 另外匯出 `getActiveDefaultBrains()` / `getActiveDefaultEngines()`,依 `PREFER_CHEAP_MODELS` 環境變數在 `economy`(伺服端預設,見程式碼註解「economy 為伺服端預設，設 balanced 回現狀」)/`balanced`/`premium` 三個分層間切換:

```ts
// server/middleware/brainContext.ts:244-256(節錄)
function resolveModelTier(raw: string | undefined): ModelTier {
  const value = raw ?? "economy";
  ...
  return "economy";
}

// server/middleware/brainContext.ts:259-267
export function getActiveDefaultBrains(): Record<...> {
  const tier = resolveModelTier(process.env.PREFER_CHEAP_MODELS);
  if (tier === "balanced") return DEFAULT_REASONING_BRAINS;
  if (tier === "premium") return PREMIUM_REASONING_BRAINS;
  return ECONOMY_REASONING_BRAINS;
}
```

`brainPipeline.ts` 只 import 了 `DEFAULT_REASONING_BRAINS`(等同 `balanced` 分層,模型是 `anthropic/claude-opus-4.7` / `perplexity/sonar-pro`,見 `server/middleware/brainContext.ts:143-159`),**沒有 import 也沒有呼叫 `getActiveDefaultBrains()` / `getActiveDefaultEngines()`**。也就是說:只要正式站沒有明確設 `PREFER_CHEAP_MODELS=balanced`(依註解,economy 才是伺服端預設),可視化畫面顯示的「目前模型」就會跟真正在跑的模型(economy 分層:`google/gemini-2.5-pro` / `google/gemini-2.5-flash`,`fal-ai/flux/schnell` 等,見 `server/middleware/brainContext.ts:190-205`)完全不一致。

**影響**

- 使用者在「我的大腦」看到的模型清單,既不是「他自己選的」,也不一定是「伺服器實際在跑的」—— 是一份寫死的第三份資料。對維運/除錯人員來說,這支「大腦可視化」工具在關鍵欄位(目前模型)上是不可信的。
- admin 版 `getGraph` 有一樣的問題(它一樣呼叫 `buildGraph()` 讀同一個 `DEFAULT_REASONING_BRAINS`),所以連 admin 都無法透過這張圖判斷正式站真正在用哪個分層/哪個使用者自訂了什麼模型。

**建議**

- `getMyGraph` 應該接受 `ctx.user.id`,呼叫 `buildBrainContext(userId)` 取得該使用者實際生效的模型(含自訂覆寫),而非全站靜態預設。
- `buildGraph()` 應該改用 `getActiveDefaultBrains()` / `getActiveDefaultEngines()` 取代直接 import 的 `DEFAULT_REASONING_BRAINS` / `DEFAULT_GENERATION_ENGINES`,才能反映 `PREFER_CHEAP_MODELS` 分層下真正生效的模型。

---

## 2.〔高〕`resolveBrainTargetProvider()` 的 provider 判斷邏輯與實際預設模型不符,導致「推理呼叫」邊全部畫錯

**發現**

```ts
// server/routers/brainPipeline.ts:2199-2202
function resolveBrainTargetProvider(model: string): string {
  if (model.startsWith("vertex/") || model.startsWith("nvidia/")) return "vertex";
  return "gemini";
}
```

呼叫點:

```ts
// server/routers/brainPipeline.ts:2394-2397
    const targetProvider = resolveBrainTargetProvider(defaultModel);
    edges.push(
      makeEdge(`brain:${slot}`, `provider:${targetProvider}`, "推理呼叫")
    );
```

`resolveBrainTargetProvider` 只認得 `vertex/` 與 `nvidia/` 前綴,其餘一律回傳 `"gemini"`。但 `DEFAULT_REASONING_BRAINS` 五個腦槽的實際模型(`server/middleware/brainContext.ts:143-159`)是:

- `director` / `storyteller` / `technician` / `curator` → `"anthropic/claude-opus-4.7"`
- `analyst` → `"perplexity/sonar-pro"`

依同檔案的路由策略註解(`server/middleware/brainContext.ts:125-131`):「若設了對應 API key(ANTHROPIC_API_KEY / PERPLEXITY_API_KEY 或 OPENROUTER_API_KEY)→ 走原生;若主 key 缺 → 自動降級到 OpenRouter」—— 也就是說這 5 個腦槽實際打的是 **Anthropic 或 OpenRouter**,從來不是 Gemini。但因為 `resolveBrainTargetProvider` 沒有處理 `anthropic/` 與 `perplexity/` 前綴,`buildGraph()` 會把**全部 5 條「推理呼叫」邊都畫成 `brain:X → provider:gemini`**,`provider:anthropic`(`PROVIDERS` 陣列裡確實有這個節點,`server/routers/brainPipeline.ts:243-251`)在推理層完全收不到任何入邊。

**影響**

- 這是一支「讓主管/新成員一眼看懂請求怎麼從瀏覽器走到外部 AI」的工具(檔頭與 `appendInfrastructureLayers` 註解都這樣寫),但它自己畫的圖在「哪個腦槽打哪個 provider」這個最核心的問題上是錯的 —— 5 個腦槽全部被錯誤標成呼叫 Gemini,Anthropic 節點看起來像是孤立、沒人用的 provider。
- 若日後有人依這張圖做容量規劃、provider 停用評估或 on-call 排查,會被誤導去查 Gemini 而非真正在用的 Anthropic/OpenRouter。

**建議**

- 改用與 `server/_core/llmRouter.ts` 的 `inferEngineFromModelIdSafe` / `normalizeModelForEngine` 一致的判斷邏輯(或直接呼叫該函式取得真正的目標 provider),至少要涵蓋 `anthropic/`、`perplexity/`、`openrouter` 前綴,而不是只認 `vertex/` 與 `nvidia/`。

---

## 3.〔中偏高〕`getMyGraph`(任何登入用戶)實際回傳的資料遠超出檔頭承諾的「個人腦組態」範圍,含完整站內架構圖

**發現**

檔頭承諾 `getMyGraph` 只給「5 推理 + 4 引擎 + 我能用的 provider」(`server/routers/brainPipeline.ts:9`)。但 `BuildGraphOptions` 裡的 `includeInfrastructure` 預設為 `true`:

```ts
// server/routers/brainPipeline.ts:2295-2304
  /**
   * 是否包含「網站如何運作」的完整深度整合節點 —
   * 瀏覽器、REST/SSE/Webhook 端點、MySQL、物件儲存、Railway 部署、
   * 觀測（LangSmith/PostHog）、第三方登入、金流。
   *
   * 預設 true（admin & personal 圖都會包含；個人版只是少了 page/router）。
   * 測試或舊呼叫端可以傳 false 取得舊版精簡圖。
   */
  includeInfrastructure?: boolean;
```

```ts
// server/routers/brainPipeline.ts:2733-2735
  if (opts.includeInfrastructure ?? true) {
    appendInfrastructureLayers(nodes, edges, opts);
  }
```

而 `getMyGraph`(`server/routers/brainPipeline.ts:3350-3356`)呼叫 `getCachedGraph` 時**沒有傳 `includeInfrastructure: false`**,所以任何登入用戶(非 admin)都會拿到:

- 全部 provider 節點含健康狀態、`reason`/`recommendation`(`server/routers/brainPipeline.ts:2343-2370`,不受任何 opts 開關保護,無條件執行)
- 完整 REST 端點清單 `API_ENDPOINTS`(約 30 條,含檔案路徑,`server/routers/brainPipeline.ts:630-1000` 附近)
- 完整 webhook 清單 `WEBHOOK_ENDPOINTS`,含 `POST /api/webhooks/stripe`、`/api/webhooks/fal` 等路徑與對應檔案(`server/routers/brainPipeline.ts:1017-1063`)
- `CRON_JOBS`,包含 `cron:user-auto-credit`(自動發點數)、`cron:cost-attribution-outbox`(成本歸屬補帳)等計費相關排程的描述與觸發檔案(`server/routers/brainPipeline.ts:1360-1387`)
- `DATA_NODES` / `INFRA_NODES`(DB、物件儲存、Railway、OAuth、Stripe 等節點與描述)

也就是說 `getMyGraph` 和 admin 專用的 `getGraph` 在「基礎設施層」幾乎拿到一樣的資訊,唯一差別只是少了 `page` / `router` 節點與尚未過濾的告警疊加(`includeAlerts`)。這與檔頭「個人腦組態(5 推理 + 4 引擎 + provider)」的敘述明顯不符,也超出前端 `我的大腦` 頁面(`client/src/pages/MyBrainPage.tsx:25`)給人的「個人視圖」印象。

**影響**

- 任何一個已登入(非 admin)的一般使用者,都能透過 `trpc.brainPipeline.getMyGraph` 列舉出站內完整的 webhook 路徑、REST 端點、cron 排程(含自動發點數/計費相關 job)、資料庫與物件儲存拓樸、部署平台資訊。雖然目前沒有洩漏金鑰或使用者資料,但這是明顯超出「個人」授權範圍的內部架構資訊揭露(CWE-200 等級),且與程式自己的文件承諾矛盾 —— 屬於授權範圍設計缺陷,而非單純文件疏漏。

**建議**

- `getMyGraph` 呼叫 `getCachedGraph("personal", { ..., includeInfrastructure: false })`,把基礎設施層只留給 admin 的 `getGraph`。
- 若日後仍想讓一般使用者看到「網站怎麼運作」的簡化版本,應該另外設計一份不含 webhook 路徑/檔案路徑/計費 cron 描述的精簡 catalog,而不是共用 admin 的完整清單。

---

## 4.〔中〕`metrics.lastError` 型別註解宣稱「已脫敏」,但至少一條資料來源路徑沒有做任何脫敏處理,且會顯示給所有登入用戶

**發現**

共用型別明確承諾這個欄位已經過處理:

```ts
// shared/brain-pipeline.ts:62-71(節錄)
export interface PipelineNodeMetrics {
  ...
  /** 最後一次錯誤訊息（已脫敏） */
  lastError?: string;
  ...
}
```

`brainPipeline.ts` 裡填這個欄位的地方之一是 `deriveBrainSlotStatus`:

```ts
// server/routers/brainPipeline.ts:2064-2076
  return {
    status: "broken",
    reason:
      cached.lastError ??
      `連續失敗 ${cached.consecutiveFailures} 次，已被熔斷`,
    recommendation: ...,
    metrics: {
      consecutiveFailures: cached.consecutiveFailures,
      lastError: cached.lastError,
      updatedAt: cached.checkedAt,
    },
  };
```

`cached` 來自 `getHealthSnapshot()`(`server/middleware/brainContext.ts:475` 附近),其 `lastError` 的寫入來源(佐證,brainContext.ts):

```ts
// server/middleware/brainContext.ts:415-422(節錄)
} catch (err) {
  const failures = previousFailures + 1;
  healthCache.set(modelOrEngine, {
    healthy: failures < MAX_CONSECUTIVE_FAILURES,
    checkedAt: Date.now(),
    consecutiveFailures: failures,
    lastError: err instanceof Error ? err.message : String(err),
  });
```

這裡是**原始例外訊息直接寫入**,沒有呼叫任何脫敏/redact 函式。相對地,同專案的 `server/services/providerHealth.ts:51-55` 在寫入 provider 層的 `reason` 時明確呼叫了 `redactReason(reason)`:

```ts
// server/services/providerHealth.ts:51-55(節錄,佐證)
export function setProviderHealth(providerId: string, status: ProviderHealthStatus, reason?: string): ProviderHealthSnapshot {
  ...
    reason: redactReason(reason),
```

兩條資料路徑處理方式不一致 —— provider 層有脫敏,brain-slot 層(來自 `brainContext.ts` 的健康快取)目前看不到對應處理。而 brain-slot 節點在 `buildGraph()` 裡是**無條件產生**(不受 `includeAlerts` 或任何 opts 保護),所以 `getMyGraph`(任何登入用戶)也會拿到這個欄位。

**影響**

- 型別文件與至少一條實際資料路徑不一致,若之後有人依賴「lastError 已脫敏」的註解假設就直接把它顯示在前端或記錄稽核,可能暴露未經處理的例外訊息內容。目前這條路徑(`scheduleHealthCheck` 的簡化探測)拋錯機率低、內容多半是 `Unknown model/engine: ...` 或 JS 例外訊息,尚未發現實際 PII/機密外洩案例,但 `reportEngineFailure(modelOrEngine, error)`(`server/middleware/brainContext.ts:442-454`)允許任意呼叫端塞入任意 `error` 字串且同樣不經脫敏 —— 所有呼叫點是否可能帶入敏感內容,不在本次 brainPipeline.ts 單檔稽核範圍內,**未逐一追查,建議另案確認**。

**建議**

- 讓 `server/middleware/brainContext.ts` 的健康快取寫入路徑(`scheduleHealthCheck` 例外分支、`reportEngineFailure`)比照 `providerHealth.ts` 呼叫同一個 `redactReason()`(或抽出共用工具),讓型別註解「已脫敏」真正對應到程式行為。

---

## 5.〔低〕告警疊加與 trace 比對都採用脆弱的子字串比對,存在誤配風險

**發現**

```ts
// server/routers/brainPipeline.ts:2708-2728(節錄)
if (opts.includeAlerts) {
    const alerts = getAlerts(50);
    for (const alert of alerts) {
      if (alert.dismissedAt) continue;
      const targetId = nodes.find(
        n =>
          (n.kind === "brain-slot" || n.kind === "engine-slot") &&
          n.description?.includes(alert.engine ?? "")
      )?.id;
```

`alert.engine ?? ""` —— 若 `alert.engine` 為空字串或未帶入,`"".includes("")` 恆為 `true`,`nodes.find` 會直接命中**第一個** brain-slot/engine-slot 節點,把不相關的告警錯誤地疊加到它身上(狀態被降級成 `needs_optimization`,`reason` 顯示錯誤的告警訊息)。目前 `ApiAlert.engine` 型別是必填 `string`(`server/services/brainAutoRepair.ts:98` 附近),理論上不會是 `undefined`,但寫這個 `?? ""` fallback 本身就顯示作者曾經考慮過這個情境,卻沒有做「無對應 engine 就整條跳過」的正確處理。

同樣的子字串比對手法也用在 `getTraceSamplesForEngines`:

```ts
// server/routers/brainPipeline.ts:2171-2180(節錄)
for (const t of traces) {
    if (
      engines.some(
        engine => t.engine.includes(engine) || engine.includes(t.engine)
      )
    ) {
      result.push(t.id);
```

雙向 `includes` 比對(`"fal".includes("fa")`、`"falcon".includes("fal")` 皆為 true)在 engine id 命名稍有重疊(例如未來若新增 `"fal-legacy"` 之類的 id)時容易誤配到不相關節點的 trace 樣本,只是後果僅止於「錯誤追蹤面板上的樣本 id 顯示位置不準」,嚴重度低。

**影響**

- 屬於正確性/可維護性問題,不是安全漏洞:告警可能疊加到錯的節點,或錯誤樣本 id 顯示在錯的節點下,造成排查時方向錯誤。

**建議**

- 告警/錯誤 trace 與節點的對應改用精確的 id 對照表(例如 alert 直接帶 `brainSlot` / `engineSlot` 欄位,而非靠 description 字串模糊比對),並在 `engine` 為空時直接 `continue` 跳過該筆告警。

---

## 6.〔低〕`appendInfrastructureLayers` 尾端的 edge 去重邏輯有一段死碼分支

**發現**

```ts
// server/routers/brainPipeline.ts:2764
const existingIds = new Set(nodes.map(n => n.id));
...
// server/routers/brainPipeline.ts:3268-3280
  const seen = new Set<string>();
  const dedupedEdges: PipelineEdge[] = [];
  for (const e of edges) {
    if (existingIds.has(e.source) && existingIds.has(e.target) && seen.has(e.id)) {
      continue;
    }
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    dedupedEdges.push(e);
  }
```

第一個 `if` 分支的條件是第二個 `if`(`seen.has(e.id)`)條件的嚴格子集 —— 只要第一個分支成立,第二個分支必定也成立,所以第一個分支永遠不會比第二個分支多篩掉任何東西,是純粹的死碼。此外 `existingIds` 是在函式一開始(第 2764 行)就對 `nodes` 取快照,當時基礎設施層(browser / infra / api / webhook / ws / internal service 節點)都還沒被 push 進 `nodes`,所以就算第一分支不是死碼,它能檢查到的也只是「函式開始前」的節點集合,對函式執行期間新增的節點一律視為不存在。

實際上這不會造成懸空邊(dangling edge),因為本檔案裡每個新增 edge 的地方(例如 `server/routers/brainPipeline.ts:2881-2924` 的 API_ENDPOINTS 迴圈)都已各自用 `nodes.find(...)` 檢查來源/目標節點存在才 push edge,這段去重迴圈的 `existingIds` 判斷從一開始就是多餘的保險,只是寫成了無效分支。

**影響**

- 純可維護性問題:讀者容易誤以為這行有實際過濾懸空邊的作用,增加理解成本;目前沒有觀察到會產生錯誤資料的路徑。

**建議**

- 移除死碼分支,只保留 `seen.has(e.id)` 判斷;若真的想防呆懸空邊,應在迴圈當下用即時的 `nodes` id 集合(而非函式進入時的舊快照)檢查。

---

## 7.〔資訊性〕檔頭文件與實際 router 的 procedure 數量不符

**發現**

檔頭寫「兩個 procedures」(`server/routers/brainPipeline.ts:7-9`),但實際 router 匯出 4 個:

```ts
// server/routers/brainPipeline.ts:3339-3376
export const brainPipelineRouter = router({
  getGraph: adminProcedure.query(() => { ... }),
  getMyGraph: protectedProcedure.query(() => { ... }),
  getSummary: protectedProcedure.query(() => { ... }),
  runPatrol: adminProcedure.mutation(async () => { ... }),
});
```

`getSummary`(任何登入用戶,回傳 `getSystemSummary()` 全站摘要)與 `runPatrol`(admin,觸發真正的健康巡檢並使快取失效)都沒有出現在檔頭說明裡。

**影響**

- 輕微的文件與程式碼漂移,不影響執行,但會誤導第一次讀這支檔案的人低估它的對外介面數量與 `getSummary` 的授權範圍(同樣是任何登入用戶皆可取得全站摘要,而非個人化資料 —— 與發現 3 屬同一類模式)。

**建議**

- 更新檔頭註解列出全部 4 個 procedure 及其授權層級。

---

## 8. 依任務清單逐項確認「未發現」的部分(附驗證依據)

- **計費/退款、扣點/生成、零計費繞過**:本檔案不含任何 `credit`/`charge`/`refund`/`deduct` 相關程式邏輯(全檔搜尋只命中 `credits` 頁面 id 對應到 `router:apiUsage` 的靜態字串,以及 `cron:user-auto-credit`/`cron:cost-attribution-outbox` 兩個節點的**描述文字**,`server/routers/brainPipeline.ts:353, 1360-1387`)。實際計費/自動發點邏輯在 `server/jobs/userAutoCreditJob.ts`、`server/jobs/costAttributionOutboxJob.ts` 等檔案,**不在本檔案內,未於本次稽核驗證**。
- **注入/上下文組裝、prompt sanitize**:本檔案不呼叫任何 LLM(沒有 `invokeLLM`、`generate`、`chat` 之類的呼叫),只讀取既有的健康快照/錯誤追蹤資料組成 React Flow 用的靜態圖結構。未發現使用者輸入被組進 LLM prompt 的路徑。
- **owner/授權 IDOR(以 id 取他人資源)**:4 個 procedure 全部**不接受任何輸入參數**(`getGraph`/`getMyGraph`/`getSummary` 是 `.query(() => ...)`,`runPatrol` 是 `.mutation(async () => ...)`,均無 `.input(...)`),因此不存在「client 傳入他人資源 id 取得資料」這類經典 IDOR 的攻擊面。本檔案真正的授權問題是發現 3 的「範圍過寬」(protectedProcedure 拿到近似 admin 等級的資訊),性質是最小權限設計缺陷,不是傳統 IDOR。
- **重啟即失(in-memory state)、race**:本檔案唯一的模組層級可變狀態是 `responseCache`(`server/routers/brainPipeline.ts:3301`,`Map<"admin"|"personal", CachedGraphEntry>`,5 秒 TTL,`server/routers/brainPipeline.ts:3292`),純粹是效能快取,重啟遺失不影響正確性(下一次請求會重新 `buildGraph()`)。`getCachedGraph()` 內部無 `await`,`buildGraph()` 全程同步,單一 Node 事件迴圈內不會出現讀寫交錯的 race。未發現多階段執行狀態機、部分失敗處理或重試邏輯,因為本檔案沒有多階段「執行」,只有一次性的同步組圖。

---

## 附錄:發現總覽(依嚴重度)

| # | 嚴重度 | 檔案:行號 | 一句話描述 |
|---|--------|-----------|-----------|
| 1 | 高 | brainPipeline.ts:21-28, 2372-2374, 2407-2410, 3350-3356(+ brainContext.ts:139-278, 607-628) | 「我的大腦」永遠顯示全站靜態預設,不反映使用者自訂設定,也不反映伺服器實際生效的 PREFER_CHEAP_MODELS 分層 |
| 2 | 高 | brainPipeline.ts:2199-2202, 2394-2397(+ brainContext.ts:143-159) | provider 判斷只認 vertex/nvidia 前綴,實際模型是 anthropic/perplexity,5 條推理呼叫邊全部畫錯 |
| 3 | 中偏高 | brainPipeline.ts:9, 2295-2304, 2733-2735, 3350-3356 | getMyGraph(任何登入用戶)實際回傳完整站內架構(webhook/端點/cron/DB),超出文件承諾的「個人」範圍 |
| 4 | 中 | brainPipeline.ts:2064-2076(+ brainContext.ts:415-422, 442-454; 對照 providerHealth.ts:51-55) | metrics.lastError 型別承諾「已脫敏」,但 brain-slot 路徑的來源未見脫敏處理 |
| 5 | 低 | brainPipeline.ts:2171-2180, 2708-2728 | 告警/trace 對應節點採脆弱子字串比對,存在誤配風險 |
| 6 | 低 | brainPipeline.ts:2764, 3268-3280 | edge 去重迴圈內有一段邏輯死碼 |
| 7 | 資訊性 | brainPipeline.ts:7-9, 3339-3376 | 檔頭文件只列 2 個 procedure,實際有 4 個 |
