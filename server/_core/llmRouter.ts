/**
 * llmRouter.ts — 五引擎智慧路由層（含斷路器 + 健康感知自動降級）
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                       LLM Router (此檔案)                               │
 * ├────────────┬──────────────┬────────────┬──────────────┬─────────────────┤
 * │ Engine ⭐  │  Engine A    │ Engine B   │   Engine C   │   Engine D      │
 * │ Anthropic  │  Gemini API  │ Vertex AI  │ Manus Forge  │ MiniMax M2.7    │
 * │ Claude API │  (直接呼叫)  │ (GCP SDK)  │ (向後相容)   │ (NVIDIA NIM)    │
 * └────────────┴──────────────┴────────────┴──────────────┴─────────────────┘
 *
 * 路由策略（可在 .env 中設定 LLM_ENGINE 覆蓋）：
 *   auto      → 健康感知優先：anthropic > gemini > nvidia > vertex > forge
 *   anthropic → 強制使用 Anthropic Claude API（需要 ANTHROPIC_API_KEY，光球代理首選）
 *   gemini    → 強制使用 Gemini API（需要 GEMINI_API_KEY）
 *   vertex    → 強制使用 Vertex AI（需要 GOOGLE_APPLICATION_CREDENTIALS_JSON）
 *   forge     → 強制使用 Manus Forge（需要 BUILT_IN_FORGE_API_KEY）
 *   nvidia    → 強制使用 MiniMax M2.7 via NVIDIA NIM（需要 NVIDIA_API）
 *
 * 每個 Engine 支援的功能：
 *   Engine ⭐ (Anthropic)    ：chat, json_mode, tool_use, vision, thinking, long_context (200K)
 *   Engine A  (Gemini API)   ：chat, json_mode, function_calling, vision, thinking
 *   Engine B  (Vertex AI)    ：chat, json_mode, function_calling, vision, grounding, long_context
 *   Engine C  (Forge)        ：chat, json_mode, function_calling, vision, thinking, whisper, maps
 *   Engine D  (MiniMax M2.7) ：chat, json_mode, function_calling, long_context (200K), agentic
 *
 * 穩定性機制：
 *   1. Circuit Breaker — 連續失敗 N 次後自動斷路，冷卻後半開放試探
 *   2. Health-Aware Routing — auto 模式自動跳過不健康的引擎
 *   3. Automatic Failover — invokeLLM 內建引擎降級鏈，首選引擎失敗後自動嘗試備援
 *   4. Exponential Backoff — 每次重試指數退避，避免雪崩
 *
 * 為何 Anthropic 排第一：對「全站光球代理」最關鍵的能力是 tool use 的可靠性
 * 與多步驟反問判斷力 — Claude Sonnet/Haiku 在這兩點上明顯領先 Gemini Flash。
 * tool_call schema 不會幻覺欄位、reasoning 出錯時會主動詢問而不是亂下動作。
 */

import { serverEnv } from "./env.validated";
import { ENV } from "./env";
import { resolveProviderBaseUrl } from "./providerFacade";
import { assertSafeExternalUrl } from "./ssrfGuard";

// ─── 引擎類型 ──────────────────────────────────────────────────────────────

export type LLMEngine =
  | "openrouter"
  | "anthropic"
  | "perplexity"
  | "gemini"
  | "vertex"
  | "forge"
  | "nvidia"
  | "freellmapi"
  | "auto";

export interface EngineConfig {
  name: string;
  engine: LLMEngine; // 引擎識別符
  url: string;
  apiKey: string;
  model: string;
  supportsThinking: boolean; // extended reasoning budget_tokens
  supportsGrounding: boolean; // Google Search grounding
  supportsLongContext: boolean; // >1M token context
  supportsToolCalling: boolean; // function calling / tool use
}

// ─── Circuit Breaker（斷路器）──────────────────────────────────────────────

/**
 * 斷路器狀態：
 *   CLOSED   — 正常運作，失敗計數累積
 *   OPEN     — 已斷路，所有請求直接跳過此引擎
 *   HALF_OPEN — 冷卻結束，允許一次試探請求
 */
type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitBreakerEntry {
  state: CircuitState;
  failures: number;
  lastFailureAt: number;
  lastSuccessAt: number;
  openedAt: number; // 進入 OPEN 狀態的時間
  /** 連續斷路次數（用於 adaptive cooldown 指數增長） */
  trips: number;
  /** 最近 N 次成功呼叫的延遲滾動平均（毫秒），用於 latency-aware 排序 */
  avgLatencyMs: number;
  /** 累積成功次數，避免 EMA 在頭幾次成功時過度敏感 */
  samples: number;
  /**
   * 由永久錯誤（auth / quota / billing）強制設定的冷卻時間。
   * 一般 transient 錯誤走 trips-based 指數退避；永久錯誤走這個獨立的長冷卻
   * （預設 10 分鐘），避免短時間內反覆撞到金鑰失效或額度耗盡的引擎。
   * 任何一次成功或非永久失敗都會清除此覆蓋值。
   */
  overrideCooldownMs?: number;
  /** 最近一次失敗的分類（permanent_auth / permanent_quota / transient），供 health endpoint 顯示 */
  lastFailureReason?: string;
  /**
   * 「模型無效」(invalid_model / permanent_model) 的累積次數。
   *
   * 這類失敗是「這一次呼叫帶的模型 id 對這個引擎無效」，引擎本身完全健康
   * （換個有效模型就會成功）。因此它**絕對不能**累進 `failures` 去觸發
   * CIRCUIT_FAILURE_THRESHOLD 斷路 — 否則某 brain 設了一個無效 model id 反覆
   * 觸發 invalid_model 時，會把其實健康的引擎錯誤地斷路 OPEN，連帶擋掉所有
   * 用有效模型的呼叫。這個獨立計數器只做觀測（health endpoint / debug），
   * 不參與任何斷路判斷，且任何一次成功都會歸零。
   */
  modelInvalidCount: number;
}

/** 連續失敗幾次後斷路 */
const CIRCUIT_FAILURE_THRESHOLD = 3;
/** 斷路後冷卻時間基準值（毫秒）。Adaptive cooldown：第一次 15s、第二次 30s、第三次起 60s */
const CIRCUIT_COOLDOWN_BASE_MS = 15_000;
const CIRCUIT_COOLDOWN_MAX_MS = 60_000;
/**
 * 永久錯誤（API 金鑰失效、額度耗盡、帳單問題）的長冷卻時間。
 * 這類錯誤不是「重試就會恢復」的網路抖動 — 在運營者修復金鑰或補額前，
 * 任何重試都會繼續燒錢、拖慢使用者體驗。10 分鐘讓系統把流量交給其他引擎，
 * 同時保留一條重新試探的路徑（避免人工修好後還要重啟服務）。
 */
const PERMANENT_FAILURE_COOLDOWN_MS = 10 * 60_000;
/** 成功一次後重置計數器 */
const CIRCUIT_SUCCESS_RESET = true;
/** EMA 平滑係數 — 越接近 1，越偏重最近的延遲；0.3 在抗抖動與感應變化之間取得平衡 */
const LATENCY_EMA_ALPHA = 0.3;

const circuitBreakers = new Map<LLMEngine, CircuitBreakerEntry>();

function getCircuit(engine: LLMEngine): CircuitBreakerEntry {
  if (!circuitBreakers.has(engine)) {
    circuitBreakers.set(engine, {
      state: "CLOSED",
      failures: 0,
      lastFailureAt: 0,
      lastSuccessAt: Date.now(),
      openedAt: 0,
      trips: 0,
      avgLatencyMs: 0,
      samples: 0,
      modelInvalidCount: 0,
    });
  }
  return circuitBreakers.get(engine)!;
}

/** 計算當前 trip 對應的冷卻時間（指數退避，封頂於 CIRCUIT_COOLDOWN_MAX_MS） */
function getCooldownMs(trips: number): number {
  // trips 從 1 開始算：1→15s、2→30s、3+→60s
  const factor = Math.min(2 ** Math.max(trips - 1, 0), CIRCUIT_COOLDOWN_MAX_MS / CIRCUIT_COOLDOWN_BASE_MS);
  return Math.min(CIRCUIT_COOLDOWN_BASE_MS * factor, CIRCUIT_COOLDOWN_MAX_MS);
}

/** 取得實際生效的冷卻毫秒數 — 永久錯誤覆蓋優先，否則走 trips-based 指數退避 */
function effectiveCooldownMs(cb: CircuitBreakerEntry): number {
  if (typeof cb.overrideCooldownMs === "number" && cb.overrideCooldownMs > 0) {
    return cb.overrideCooldownMs;
  }
  return getCooldownMs(cb.trips);
}

/** 引擎是否可用（斷路器判斷） */
export function isEngineAvailable(engine: LLMEngine): boolean {
  const cb = getCircuit(engine);
  if (cb.state === "CLOSED") return true;
  if (cb.state === "OPEN") {
    // 檢查冷卻期是否結束 — 採用 adaptive cooldown
    const cooldown = effectiveCooldownMs(cb);
    if (Date.now() - cb.openedAt >= cooldown) {
      cb.state = "HALF_OPEN";
      return true; // 允許一次試探
    }
    return false;
  }
  // HALF_OPEN — 允許試探
  return true;
}

/** 記錄引擎成功（重置斷路器，更新延遲滾動平均） */
export function recordEngineSuccess(engine: LLMEngine, latencyMs?: number): void {
  const cb = getCircuit(engine);
  if (CIRCUIT_SUCCESS_RESET) {
    cb.failures = 0;
  }
  // 連續成功一段時間後，重置 trips 計數器（讓下次斷路從 15s 起算）
  if (Date.now() - cb.lastSuccessAt > CIRCUIT_COOLDOWN_MAX_MS && cb.state === "CLOSED") {
    cb.trips = 0;
  }
  cb.lastSuccessAt = Date.now();
  cb.state = "CLOSED";
  // 一旦成功，清除永久錯誤覆蓋與失敗分類 — 之後若再失敗按 transient 規則重新評估。
  cb.overrideCooldownMs = undefined;
  cb.lastFailureReason = undefined;
  // 成功代表引擎健康，把「模型無效」觀測計數歸零（與 failures 同步重置）。
  cb.modelInvalidCount = 0;

  if (typeof latencyMs === "number" && latencyMs > 0 && Number.isFinite(latencyMs)) {
    if (cb.samples === 0) {
      cb.avgLatencyMs = latencyMs;
    } else {
      cb.avgLatencyMs = LATENCY_EMA_ALPHA * latencyMs + (1 - LATENCY_EMA_ALPHA) * cb.avgLatencyMs;
    }
    cb.samples++;
  }
}

/**
 * 記錄引擎失敗。
 *
 * 一般 transient 錯誤（網路抖動、5xx、429）：累積失敗計數，達到 threshold 才斷路。
 * 永久錯誤（permanent=true，例如 401/403/402、credit balance too low、invalid api key）：
 *   立即斷路並設定 10 分鐘長冷卻 — 因為這類錯誤不會自然恢復，繼續重試只會
 *   讓 fallback 鏈每次都先撞到壞掉的引擎再降級，浪費延遲與 token 預算。
 * 模型無效（modelInvalid=true，例如 4xx invalid_model / permanent_model）：
 *   **完全不影響引擎健康訊號** — 不累進 failures、不開斷路器、不動 trips。
 *   這類失敗只代表「這一次的模型 id 對這個引擎無效」，引擎本身健康（換個有效
 *   模型即成功）。若把它當 transient 累進 failures，某 brain 設了無效 model id
 *   反覆觸發 invalid_model（中間無任何成功）時，會在第 3 次把其實健康的引擎
 *   錯誤地斷路 OPEN，連帶擋掉所有用有效模型的呼叫 — 違反「invalid_model 不斷路」
 *   的承諾。所以這裡只記一個獨立觀測計數器 + 失敗時間/分類，立刻 return，
 *   永遠不會累積觸發 CIRCUIT_FAILURE_THRESHOLD。
 */
export function recordEngineFailure(
  engine: LLMEngine,
  options?: { permanent?: boolean; modelInvalid?: boolean; reason?: string }
): void {
  const cb = getCircuit(engine);

  // ── 模型無效路徑 — 在累進 failures 之前攔截，確保絕不貢獻斷路 ──────────
  if (options?.modelInvalid) {
    cb.modelInvalidCount++;
    cb.lastFailureAt = Date.now();
    if (options.reason) cb.lastFailureReason = options.reason;
    // 刻意不動 cb.failures / cb.state / cb.trips / overrideCooldownMs：
    // 引擎健康訊號完全不受「模型 id 無效」影響。
    return;
  }

  cb.failures++;
  cb.lastFailureAt = Date.now();
  if (options?.reason) cb.lastFailureReason = options.reason;

  if (options?.permanent) {
    // 永久錯誤 — 立即斷路，使用長冷卻，不需要等 3 次累積。
    cb.state = "OPEN";
    cb.openedAt = Date.now();
    cb.trips++;
    cb.overrideCooldownMs = PERMANENT_FAILURE_COOLDOWN_MS;
    const reason = options.reason ?? "permanent";
    console.warn(
      `[CircuitBreaker] 🔴 ${engine} 永久錯誤（${reason}），立即斷路（冷卻 ${Math.round(
        PERMANENT_FAILURE_COOLDOWN_MS / 1000
      )}s）— 跳過此引擎直到金鑰／額度修復`
    );
    return;
  }

  // Transient 錯誤路徑 — 一旦再次出現轉瞬即逝的失敗，我們不再相信舊的長冷卻。
  cb.overrideCooldownMs = undefined;

  if (cb.state === "HALF_OPEN") {
    // 試探失敗 → 重新打開（trips 不變，本次仍算同一輪斷路）
    cb.state = "OPEN";
    cb.openedAt = Date.now();
    console.warn(
      `[CircuitBreaker] 🔴 ${engine} 試探失敗，重新斷路（冷卻 ${getCooldownMs(cb.trips) / 1000}s）`
    );
  } else if (cb.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    cb.state = "OPEN";
    cb.openedAt = Date.now();
    cb.trips++;
    console.warn(
      `[CircuitBreaker] 🔴 ${engine} 連續失敗 ${cb.failures} 次，斷路中（第 ${cb.trips} 次，冷卻 ${getCooldownMs(cb.trips) / 1000}s）`
    );
  }
}

/** 取得單一引擎的最近平均延遲（毫秒）；無樣本時回 0 */
export function getEngineAvgLatencyMs(engine: LLMEngine): number {
  return getCircuit(engine).avgLatencyMs;
}

/** 取得所有斷路器狀態（供 debug / health endpoint 使用） */
export function getCircuitBreakerStatus(): Record<
  string,
  {
    state: CircuitState;
    failures: number;
    available: boolean;
    avgLatencyMs: number;
    trips: number;
    lastFailureReason?: string;
    cooldownMs: number;
    modelInvalidCount: number;
  }
> {
  const result: Record<
    string,
    {
      state: CircuitState;
      failures: number;
      available: boolean;
      avgLatencyMs: number;
      trips: number;
      lastFailureReason?: string;
      cooldownMs: number;
      modelInvalidCount: number;
    }
  > = {};
  for (const [engine, cb] of Array.from(circuitBreakers.entries())) {
    result[engine] = {
      state: cb.state,
      failures: cb.failures,
      available: isEngineAvailable(engine),
      avgLatencyMs: Math.round(cb.avgLatencyMs),
      trips: cb.trips,
      lastFailureReason: cb.lastFailureReason,
      cooldownMs: effectiveCooldownMs(cb),
      modelInvalidCount: cb.modelInvalidCount,
    };
  }
  return result;
}

/**
 * 重置單一引擎的斷路器狀態（含 trips 與延遲統計）— 僅供測試使用。
 * 一般運作不應呼叫此函式；recordEngineSuccess 已能在連續成功後自動重置。
 */
export function __unsafeResetCircuitForTests(engine: LLMEngine): void {
  circuitBreakers.set(engine, {
    state: "CLOSED",
    failures: 0,
    lastFailureAt: 0,
    lastSuccessAt: Date.now(),
    openedAt: 0,
    trips: 0,
    avgLatencyMs: 0,
    samples: 0,
    overrideCooldownMs: undefined,
    lastFailureReason: undefined,
    modelInvalidCount: 0,
  });
}

// ─── 引擎偵測 ──────────────────────────────────────────────────────────────

/**
 * 從模型 ID 推斷正確的引擎。給定一個 model id（例如 "nvidia/minimax-m2.7"
 * 或 "vertex/gemini-2.5-pro"），回傳該 ID 應該被送往哪個引擎。
 *
 * 設計原則：OpenRouter 作為預設統一閘道，但某些 prefix（vertex/、nvidia/、
 * minimaxai/）必須走原生引擎，否則 OpenRouter 會 400 Bad Request。
 *
 * 回傳 null 表示無法從 prefix 確定引擎（呼叫端應 fallback 到 auto 順序）。
 */
export function inferEngineFromModelId(
  modelId: string | undefined | null
): LLMEngine | null {
  if (!modelId || typeof modelId !== "string") return null;
  const id = modelId.toLowerCase().trim();
  if (!id) return null;

  // ── 明確 prefix 對應 ──────────────────────────────────────
  if (id.startsWith("openrouter/")) return "openrouter";
  if (id.startsWith("vertex/")) return "vertex";

  // Perplexity：原生 API 直連（PERPLEXITY_API_KEY），perplexity/sonar* 系列
  // 也可走 OpenRouter（呼叫端 fallback 由 inferEngineFromModelIdSafe 決定）。
  if (id.startsWith("perplexity/")) return "perplexity";
  // 裸 sonar-* 模型 ID（sonar、sonar-pro、sonar-reasoning、sonar-pro
  // 等）→ 直連 Perplexity API。
  if (/^sonar(-|$)/.test(id)) return "perplexity";

  // NVIDIA NIM：catalog 用 nvidia/...，原生 API 用 minimaxai/...
  if (id.startsWith("minimaxai/") || id.startsWith("nvidia/")) return "nvidia";

  // OpenRouter 統一閘道支援的 provider/model 格式
  if (
    id.startsWith("anthropic/") ||
    id.startsWith("google/") ||
    id.startsWith("openai/") ||
    id.startsWith("meta-llama/") ||
    id.startsWith("mistralai/") ||
    id.startsWith("minimax/") ||
    id.startsWith("x-ai/") ||
    id.startsWith("deepseek/") ||
    id.startsWith("qwen/") ||
    id.startsWith("perplexity/") ||
    id.startsWith("cohere/")
  ) {
    return "openrouter";
  }

  // 裸 Claude 模型 → Anthropic native（若無 key，呼叫端會 fallback 到 OpenRouter）
  if (id.startsWith("claude-")) return "anthropic";

  // 裸 Gemini 模型 → Gemini API（若無 key，呼叫端會 fallback）
  if (id.startsWith("gemini-")) return "gemini";

  return null;
}

/**
 * 從模型 ID 推斷引擎，但只回傳實際已設定且健康的引擎。
 * 找不到合適引擎時：
 *   - vertex/* 與裸 claude-*、gemini-* 路徑會自動降級到 OpenRouter（若已設定 key），
 *     避免在 Vertex/Anthropic 直連缺金鑰時整個請求失敗。
 *   - 其他狀況回 null，呼叫端會 fallback 到 auto 順序。
 */
export function inferEngineFromModelIdSafe(
  modelId: string | undefined | null
): LLMEngine | null {
  const inferred = inferEngineFromModelId(modelId);
  if (!inferred) return null;
  if (isEngineAvailable(inferred)) {
    try {
      resolveSpecificEngine(inferred);
      return inferred;
    } catch {
      // 推斷出引擎但金鑰缺失 — 走下面的 OpenRouter 自動降級
    }
  }
  // Vertex / Anthropic / 直連 Gemini / Perplexity 沒設好 → 自動切到 OpenRouter
  // （normalizeModelForEngine 會把 vertex/* → google/*、claude-* →
  // anthropic/claude-*、sonar-* → perplexity/sonar-* 重寫成 OpenRouter 接受的格式）。
  if (
    (inferred === "vertex" ||
      inferred === "anthropic" ||
      inferred === "gemini" ||
      inferred === "perplexity") &&
    ENV.openRouterApiKey &&
    isEngineAvailable("openrouter")
  ) {
    try {
      resolveSpecificEngine("openrouter");
      return "openrouter";
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 偵測可用的引擎，回傳優先順序列表
 * 呼叫端可以用來顯示「目前使用哪個引擎」的 debug info
 */
export function detectAvailableEngines(): Array<{
  engine: LLMEngine;
  reason: string;
}> {
  const available: Array<{ engine: LLMEngine; reason: string }> = [];

  if (ENV.openRouterApiKey) {
    available.push({
      engine: "openrouter",
      reason: "OPENROUTER_API_KEY 已設定（統一 LLM 閘道）",
    });
  }
  if (ENV.anthropicApiKey) {
    available.push({
      engine: "anthropic",
      reason: "ANTHROPIC_API_KEY 已設定（光球代理主引擎）",
    });
  }
  if (ENV.perplexityApiKey) {
    available.push({
      engine: "perplexity",
      reason: "PERPLEXITY_API_KEY 已設定（搜尋 + 推理代理：Sonar 系列）",
    });
  }
  if (ENV.geminiApiKey) {
    available.push({ engine: "gemini", reason: "GEMINI_API_KEY 已設定" });
  }
  if (
    serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON &&
    serverEnv.GOOGLE_CLOUD_PROJECT_ID
  ) {
    available.push({
      engine: "vertex",
      reason: "GOOGLE_APPLICATION_CREDENTIALS_JSON + PROJECT_ID 已設定",
    });
  }
  if (ENV.forgeApiKey && ENV.forgeApiUrl) {
    available.push({
      engine: "forge",
      reason: "BUILT_IN_FORGE_API_KEY 已設定（Manus 相容模式）",
    });
  }
  if (process.env.NVIDIA_API || process.env.NVIDA_API) {
    available.push({
      engine: "nvidia",
      reason: "NVIDIA_API 已設定（NVIDIA NIM 代理人引擎）",
    });
  }
  if (
    ENV.freeLlmApiEnabled === "true" ||
    ENV.freeLlmApiEnabled === "1"
  ) {
    available.push({
      engine: "freellmapi",
      reason: "FREE_LLM_API_ENABLED=true（免費 LLM 備援引擎，無需 API 金鑰）",
    });
  }

  return available;
}

/**
 * 解析當前應使用的引擎設定
 * 健康感知優先順序（auto 模式）：gemini > nvidia > vertex > forge
 * 含斷路器判斷 — 跳過不健康的引擎
 */
export function resolveEngineConfig(forceEngine?: LLMEngine): EngineConfig {
  const preferred =
    forceEngine ?? (serverEnv.LLM_ENGINE as LLMEngine) ?? "auto";

  // ── 強制指定引擎 — 不受斷路器影響（用戶明確選擇）─────────
  if (preferred !== "auto") {
    return resolveSpecificEngine(preferred);
  }

  // ── Auto 模式 — 健康感知路由 ───────────────────────────────
  // 優先順序：openrouter > anthropic > perplexity > gemini > nvidia > vertex > forge > freellmapi
  // perplexity 排在 anthropic 後面：Sonar 雖然是搜尋+推理代理，但 tool use
  // 與一般對話的覆蓋面不如 Claude，僅當顯式選擇 perplexity/sonar-* 時優先。
  // freellmapi 排最後：免費服務可能有速率限制或可用性問題，僅作最終備援。
  const autoOrder: LLMEngine[] = [
    "openrouter",
    "anthropic",
    "perplexity",
    "gemini",
    "nvidia",
    "vertex",
    "forge",
    "freellmapi",
  ];

  for (const engine of autoOrder) {
    if (!isEngineAvailable(engine)) continue;
    try {
      return resolveSpecificEngine(engine);
    } catch {
      // 此引擎未設定 → 跳過
      continue;
    }
  }

  // 全部都不可用 — 嘗試無視斷路器取得任何引擎
  for (const engine of autoOrder) {
    try {
      return resolveSpecificEngine(engine);
    } catch {
      continue;
    }
  }

  throw new Error(
    "沒有可用的 LLM 引擎！請在 .env 中設定 OPENROUTER_API_KEY（推薦：統一閘道，可直接路由到 Claude / Gemini / Llama）、GEMINI_API_KEY、NVIDIA_API（NVIDIA NIM）或 BUILT_IN_FORGE_API_KEY（Manus 相容）"
  );
}

/**
 * 取得 auto 模式下的引擎降級鏈（供 invokeLLM 自動降級使用）
 * 回傳從首選引擎開始的所有可用引擎列表（不含首選自身）
 *
 * 當 `latencyAware=true` 時，對 fallback 鏈用實測平均延遲做穩定排序：
 *   - 有樣本的引擎優先按延遲遞增排（最快的先嘗試）
 *   - 沒樣本的引擎維持原本靜態優先順序，且排在有樣本的引擎之後
 *   - 主引擎永遠不在 fallback 鏈中
 *   - HALF_OPEN（試探中）的引擎仍會被納入 — 試探失敗會自動重新斷路
 *
 * 為何有樣本的引擎排在沒樣本的之前：當系統還沒呼叫過某引擎時，無法判斷
 * 它的延遲；如果先試它可能踩到冷啟動或網路卡頓。讓「已知快速」的引擎
 * 優先處理 fallback，能讓使用者體感的「切換」幾乎無感。
 */
export function getEngineFallbackChain(
  primaryEngine: LLMEngine,
  options: { latencyAware?: boolean } = {}
): EngineConfig[] {
  const allOrder: LLMEngine[] = [
    "openrouter",
    "anthropic",
    "perplexity",
    "gemini",
    "nvidia",
    "vertex",
    "forge",
    "freellmapi",
  ];
  const fallbacks: EngineConfig[] = [];

  for (const engine of allOrder) {
    if (engine === primaryEngine) continue;
    if (!isEngineAvailable(engine)) continue;
    try {
      fallbacks.push(resolveSpecificEngine(engine));
    } catch {
      continue;
    }
  }

  if (options.latencyAware && fallbacks.length > 1) {
    return fallbacks.slice().sort((a, b) => {
      const la = getEngineAvgLatencyMs(a.engine);
      const lb = getEngineAvgLatencyMs(b.engine);
      const aHas = la > 0;
      const bHas = lb > 0;
      if (aHas && bHas) return la - lb;
      if (aHas) return -1; // a 有樣本，b 沒 → a 先
      if (bHas) return 1; // b 有樣本，a 沒 → b 先
      // 都沒樣本 → 維持原順序（autoOrder 的相對位置）
      return allOrder.indexOf(a.engine) - allOrder.indexOf(b.engine);
    });
  }

  return fallbacks;
}

/**
 * 解析指定的引擎設定（內部函數）
 */
function resolveSpecificEngine(engine: LLMEngine): EngineConfig {
  switch (engine) {
    case "openrouter": {
      if (!ENV.openRouterApiKey)
        throw new Error("Engine 'openrouter' 指定但 OPENROUTER_API_KEY 未設定");
      // 門面解析：OPENROUTER_BASE_URL 有自訂值時優先；否則直連或 CF Gateway。
      const baseUrl = resolveProviderBaseUrl(
        "openrouter",
        ENV.openRouterBaseUrl
      );
      return {
        name: "OpenRouter (Unified Gateway)",
        engine: "openrouter",
        // OpenAI-compatible chat completions endpoint
        url: `${baseUrl}/chat/completions`,
        apiKey: ENV.openRouterApiKey,
        // Default to Claude Opus 4.7 — Anthropic 的旗艦 AI 代理人模型，最高品質
        // 的 tool use / 多步驟規劃 / 反問判斷力（全站光球代理首選，與
        // DEFAULT_REASONING_BRAINS 對齊）。Model IDs follow `<provider>/<model>`
        // 格式；OpenRouter 支援 anthropic/*, openai/*, google/*, meta-llama/*,
        // mistralai/* 等。可在 /ai-brain-settings 自行切換每個 slot 的模型。
        model: "anthropic/claude-opus-4.7",
        supportsThinking: true,
        supportsGrounding: false,
        supportsLongContext: true,
        supportsToolCalling: true,
      };
    }

    case "anthropic":
      if (!ENV.anthropicApiKey)
        throw new Error("Engine 'anthropic' 指定但 ANTHROPIC_API_KEY 未設定");
      return {
        name: "Anthropic Claude API",
        engine: "anthropic",
        // Native messages endpoint — invokeSingleEngine handles the
        // Anthropic-specific request/response shape.
        url: `${resolveProviderBaseUrl("anthropic")}/v1/messages`,
        apiKey: ENV.anthropicApiKey,
        // Haiku 4.5 = best speed/cost for orb dispatch + clarification.
        // Override per-call (model: "claude-sonnet-4-6") for harder planning.
        model: "claude-haiku-4-5-20251001",
        supportsThinking: true,
        supportsGrounding: false,
        supportsLongContext: true,
        supportsToolCalling: true,
      };

    case "perplexity":
      if (!ENV.perplexityApiKey)
        throw new Error(
          "Engine 'perplexity' 指定但 PERPLEXITY_API_KEY 未設定。請至 https://www.perplexity.ai/settings/api 取得並設定環境變數。"
        );
      return {
        name: "Perplexity (Sonar)",
        engine: "perplexity",
        // OpenAI-compatible chat completions endpoint。Sonar 系列原生帶 web
        // grounding（不需要 tool 即可搜尋），所以 supportsGrounding=true。
        url: `${resolveProviderBaseUrl("perplexity")}/chat/completions`,
        apiKey: ENV.perplexityApiKey,
        // 預設 sonar-pro：Perplexity 旗艦推理模型，內建 web search，
        // 最適合需要規劃 + 即時資訊查詢的全站光球代理。可在每次呼叫覆寫
        // model（例如改用 sonar-pro / sonar / sonar-deep-research）。
        model: "sonar-pro",
        supportsThinking: true,
        supportsGrounding: true,
        supportsLongContext: true,
        // Sonar chat completions 不支援 OpenAI 風格的 function calling；
        // 光球的 [ACTION:...] 文字標記仍可正常 parse，但 schema-first
        // planner 的 JSON tool_use 流程會 fall back 到 prompt-engineering。
        supportsToolCalling: false,
      };

    case "gemini":
      if (!ENV.geminiApiKey)
        throw new Error("Engine 'gemini' 指定但 GEMINI_API_KEY 未設定");
      return {
        name: "Gemini API (Direct)",
        engine: "gemini",
        url: `${resolveProviderBaseUrl("gemini")}/v1beta/openai/chat/completions`,
        apiKey: ENV.geminiApiKey,
        model: "gemini-2.5-flash",
        supportsThinking: true,
        supportsGrounding: false,
        supportsLongContext: true,
        supportsToolCalling: true,
      };

    case "vertex": {
      const projectId = serverEnv.GOOGLE_CLOUD_PROJECT_ID;
      const credentials = serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON;
      const location = serverEnv.GOOGLE_CLOUD_LOCATION || "us-central1";
      if (!projectId || !credentials) {
        throw new Error(
          "Engine 'vertex' 指定但 GOOGLE_CLOUD_PROJECT_ID 或 GOOGLE_APPLICATION_CREDENTIALS_JSON 未設定"
        );
      }
      if (!ENV.geminiApiKey)
        throw new Error("Vertex AI 需要 GEMINI_API_KEY 或服務帳號 Token");
      return {
        name: "Vertex AI (via Gemini Key)",
        engine: "vertex",
        url: `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/gemini-2.5-flash:generateContent`,
        apiKey: ENV.geminiApiKey,
        model: "gemini-2.5-flash",
        supportsThinking: true,
        supportsGrounding: true,
        supportsLongContext: true,
        supportsToolCalling: true,
      };
    }

    case "nvidia": {
      // DEF-A 修復：兼容歷史拼字錯誤 NVIDA_API（Railway 舊環境變數名稱）
      const nvidiaKey = process.env.NVIDIA_API || process.env.NVIDA_API;
      if (!nvidiaKey)
        throw new Error("Engine 'nvidia' 指定但 NVIDIA_API（或 NVIDA_API）未設定");
      return {
        name: "NVIDIA NIM (Nemotron / MiniMax)",
        engine: "nvidia",
        url: "https://integrate.api.nvidia.com/v1/chat/completions",
        apiKey: nvidiaKey,
        // 預設 MiniMax M2.7（DEF-13 沿用）。呼叫端可透過 model 參數切到
        // Llama Nemotron Ultra / Super 等其他 NIM；normalizeModelForEngine
        // 會把 catalog 的 nvidia/* 別名映射成 NIM API 的 canonical id。
        model: "minimaxai/minimax-m2.7",
        supportsThinking: true,
        supportsGrounding: false,
        supportsLongContext: true,
        supportsToolCalling: true,
      };
    }

    case "forge":
      if (!ENV.forgeApiKey || !ENV.forgeApiUrl)
        throw new Error("Engine 'forge' 指定但 BUILT_IN_FORGE_API_KEY 未設定");
      return {
        name: "Manus Forge API (Legacy)",
        engine: "forge",
        url: `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`,
        apiKey: ENV.forgeApiKey,
        model: "gemini-2.5-flash",
        supportsThinking: true,
        supportsGrounding: false,
        supportsLongContext: false,
        supportsToolCalling: true,
      };

    case "freellmapi": {
      // 免費 LLM API — 無需 API 金鑰，OpenAI 相容格式
      // 來源：https://github.com/tashfeenahmed/freellmapi
      // 僅在 FREE_LLM_API_ENABLED=true 時可用；排在所有付費引擎之後作為最終備援。
      const isEnabled =
        ENV.freeLlmApiEnabled === "true" || ENV.freeLlmApiEnabled === "1";
      if (!isEnabled)
        throw new Error(
          "Engine 'freellmapi' 指定但 FREE_LLM_API_ENABLED 未設為 true"
        );
      const rawBase = ENV.freeLlmApiUrl || "https://api.freellmapi.com";
      // AIDV-863: SSRF guard — FREE_LLM_API_URL is operator-supplied; block it
      // pointing at private/loopback/IMDS (e.g. 169.254.169.254) before the
      // backend issues outbound requests to it. Dev allows insecure/localhost
      // hosts (mirrors internalMedia.ts); production stays strict.
      assertSafeExternalUrl(rawBase, process.env.NODE_ENV !== "production");
      const baseUrl = rawBase.replace(/\/$/, "");
      return {
        name: "FreeLLM API (Free Fallback)",
        engine: "freellmapi",
        // OpenAI-compatible chat completions endpoint
        url: `${baseUrl}/v1/chat/completions`,
        // 免費服務不需要 API 金鑰；傳空字串讓 HTTP 客戶端不帶 Authorization 標頭
        apiKey: "",
        // gpt-3.5-turbo 是 freellmapi 支援的標準模型 ID
        model: "gpt-3.5-turbo",
        // 免費 API 通常不支援進階功能
        supportsThinking: false,
        supportsGrounding: false,
        supportsLongContext: false,
        supportsToolCalling: false,
      };
    }

    default:
      throw new Error(`Unknown engine: ${engine}`);
  }
}

// ─── 引擎狀態回報（供 /api/health 或 debug 使用）─────────────────────────

export interface EngineStatus {
  current: string;
  available: string[];
  missing: string[];
  recommendation: string;
}

export function getEngineStatus(): EngineStatus {
  const available = detectAvailableEngines();
  const missing: string[] = [];

  if (!ENV.openRouterApiKey)
    missing.push("OPENROUTER_API_KEY（推薦：統一 LLM 閘道）");
  if (!ENV.geminiApiKey) missing.push("GEMINI_API_KEY");
  if (!serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON)
    missing.push("GOOGLE_APPLICATION_CREDENTIALS_JSON（Vertex AI）");
  if (!ENV.forgeApiKey) missing.push("BUILT_IN_FORGE_API_KEY（Manus 相容）");
  if (!process.env.NVIDIA_API && !process.env.NVIDA_API)
    missing.push("NVIDIA_API（MiniMax M2.7 via NVIDIA NIM）");

  let currentName = "無可用引擎";
  try {
    const config = resolveEngineConfig();
    currentName = config.name;
  } catch {
    // ignore
  }

  const cbStatus = getCircuitBreakerStatus();
  const cbInfo = Object.entries(cbStatus)
    .filter(([, s]) => s.state !== "CLOSED")
    .map(([eng, s]) => `${eng}: ${s.state}(failures=${s.failures})`)
    .join(", ");

  return {
    current: currentName,
    available: available.map(a => `${a.engine}: ${a.reason}`),
    missing,
    recommendation:
      available.length === 0
        ? "請設定 GEMINI_API_KEY 以啟用 LLM 功能"
        : cbInfo
          ? `引擎部分斷路中：${cbInfo}`
          : available[0].engine === "forge"
            ? "建議設定 GEMINI_API_KEY 以取得更好的效能與穩定性"
            : "引擎設定正常",
  };
}

// ─── Google AI Studio / Vertex AI 多模態端點解析 ──────────────────────────────

/**
 * 部署環境配置 — 定義 Google AI Studio 和 Vertex AI 的多模態模型端點
 *
 * Google AI Studio (Gemini API)：免費/付費，適合開發測試與中小流量
 *   - 端點：generativelanguage.googleapis.com
 *   - 認證：GEMINI_API_KEY
 *
 * Vertex AI (GCP)：企業級，適合正式環境與高流量
 *   - 端點：{LOCATION}-aiplatform.googleapis.com
 *   - 認證：GOOGLE_APPLICATION_CREDENTIALS_JSON + PROJECT_ID
 */
export type MultimodalModelType = "imagen" | "veo" | "lyria" | "tts";

export interface MultimodalEndpoint {
  name: string;
  modelId: string;
  url: string;
  apiKey: string;
  provider: "gemini" | "vertex";
}

/**
 * 解析 Google 多模態模型的 API 端點
 * 支援 Imagen（圖片）、Veo（影片）、Lyria（音樂）、TTS（語音）
 *
 * @param modelType - 模型類型
 * @param variant - 模型變體（如 "3", "4", "3-fast" 等）
 * @param forceProvider - 強制使用的提供者（留空則自動偵測）
 */
export function resolveMultimodalEndpoint(
  modelType: MultimodalModelType,
  variant: string = "",
  forceProvider?: "gemini" | "vertex"
): MultimodalEndpoint {
  const projectId = serverEnv.GOOGLE_CLOUD_PROJECT_ID;
  const location = serverEnv.GOOGLE_CLOUD_LOCATION || "us-central1";
  const hasVertex = !!(
    projectId && serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON
  );
  const hasGemini = !!ENV.geminiApiKey;

  // 決定提供者
  const provider: "gemini" | "vertex" =
    forceProvider ?? (hasVertex ? "vertex" : "gemini");

  // 模型名稱映射
  const modelNames: Record<MultimodalModelType, string> = {
    imagen: variant ? `imagen-${variant}` : "imagen-4",
    veo: variant ? `veo-${variant}` : "veo-3",
    lyria: variant ? `lyria-${variant}` : "lyria-2",
    tts: variant ? `tts-${variant}` : "tts-flash",
  };

  const modelName = modelNames[modelType];

  if (provider === "vertex") {
    if (!projectId) throw new Error("Vertex AI 需要 GOOGLE_CLOUD_PROJECT_ID");
    if (!ENV.geminiApiKey)
      throw new Error("Vertex AI 端點需要 GEMINI_API_KEY 作為認證");

    return {
      name: `${modelName} (Vertex AI)`,
      modelId: `vertex/${modelName}`,
      url: `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelName}:predict`,
      apiKey: ENV.geminiApiKey,
      provider: "vertex",
    };
  }

  // Google AI Studio（Gemini API）
  if (!ENV.geminiApiKey)
    throw new Error("Google AI Studio 需要 GEMINI_API_KEY");

  return {
    name: `${modelName} (AI Studio)`,
    modelId: `gemini/${modelName}`,
    url: `${resolveProviderBaseUrl("gemini")}/v1beta/models/${modelName}:predict`,
    apiKey: ENV.geminiApiKey,
    provider: "gemini",
  };
}
