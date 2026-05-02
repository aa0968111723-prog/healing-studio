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

// ─── 引擎類型 ──────────────────────────────────────────────────────────────

export type LLMEngine =
  | "openrouter"
  | "anthropic"
  | "gemini"
  | "vertex"
  | "forge"
  | "nvidia"
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
}

/** 連續失敗幾次後斷路 */
const CIRCUIT_FAILURE_THRESHOLD = 3;
/** 斷路後冷卻時間（毫秒），冷卻後進入 HALF_OPEN */
const CIRCUIT_COOLDOWN_MS = 60_000; // 60 秒
/** 成功一次後重置計數器 */
const CIRCUIT_SUCCESS_RESET = true;

const circuitBreakers = new Map<LLMEngine, CircuitBreakerEntry>();

function getCircuit(engine: LLMEngine): CircuitBreakerEntry {
  if (!circuitBreakers.has(engine)) {
    circuitBreakers.set(engine, {
      state: "CLOSED",
      failures: 0,
      lastFailureAt: 0,
      lastSuccessAt: Date.now(),
      openedAt: 0,
    });
  }
  return circuitBreakers.get(engine)!;
}

/** 引擎是否可用（斷路器判斷） */
export function isEngineAvailable(engine: LLMEngine): boolean {
  const cb = getCircuit(engine);
  if (cb.state === "CLOSED") return true;
  if (cb.state === "OPEN") {
    // 檢查冷卻期是否結束
    if (Date.now() - cb.openedAt >= CIRCUIT_COOLDOWN_MS) {
      cb.state = "HALF_OPEN";
      return true; // 允許一次試探
    }
    return false;
  }
  // HALF_OPEN — 允許試探
  return true;
}

/** 記錄引擎成功（重置斷路器） */
export function recordEngineSuccess(engine: LLMEngine): void {
  const cb = getCircuit(engine);
  if (CIRCUIT_SUCCESS_RESET) {
    cb.failures = 0;
  }
  cb.lastSuccessAt = Date.now();
  cb.state = "CLOSED";
}

/** 記錄引擎失敗（累積失敗計數，達到閾值則斷路） */
export function recordEngineFailure(engine: LLMEngine): void {
  const cb = getCircuit(engine);
  cb.failures++;
  cb.lastFailureAt = Date.now();

  if (cb.state === "HALF_OPEN") {
    // 試探失敗 → 重新打開
    cb.state = "OPEN";
    cb.openedAt = Date.now();
    console.warn(`[CircuitBreaker] 🔴 ${engine} 試探失敗，重新斷路`);
  } else if (cb.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    cb.state = "OPEN";
    cb.openedAt = Date.now();
    console.warn(
      `[CircuitBreaker] 🔴 ${engine} 連續失敗 ${cb.failures} 次，斷路中（冷卻 ${CIRCUIT_COOLDOWN_MS / 1000}s）`
    );
  }
}

/** 取得所有斷路器狀態（供 debug / health endpoint 使用） */
export function getCircuitBreakerStatus(): Record<
  string,
  { state: CircuitState; failures: number; available: boolean }
> {
  const result: Record<
    string,
    { state: CircuitState; failures: number; available: boolean }
  > = {};
  for (const [engine, cb] of Array.from(circuitBreakers.entries())) {
    result[engine] = {
      state: cb.state,
      failures: cb.failures,
      available: isEngineAvailable(engine),
    };
  }
  return result;
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
  // Vertex / Anthropic / 直連 Gemini 沒設好 → 自動切到 OpenRouter（normalizeModelForEngine
  // 會把 vertex/* → google/*、claude-* → anthropic/claude-* 重寫成 OpenRouter 接受的格式）
  if (
    (inferred === "vertex" || inferred === "anthropic" || inferred === "gemini") &&
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
  // 優先順序：gemini > nvidia > vertex > forge
  const autoOrder: LLMEngine[] = [
    "openrouter",
    "anthropic",
    "gemini",
    "nvidia",
    "vertex",
    "forge",
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
 */
export function getEngineFallbackChain(
  primaryEngine: LLMEngine
): EngineConfig[] {
  const allOrder: LLMEngine[] = [
    "openrouter",
    "anthropic",
    "gemini",
    "nvidia",
    "vertex",
    "forge",
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
      const baseUrl = ENV.openRouterBaseUrl.replace(/\/$/, "");
      return {
        name: "OpenRouter (Unified Gateway)",
        engine: "openrouter",
        // OpenAI-compatible chat completions endpoint
        url: `${baseUrl}/chat/completions`,
        apiKey: ENV.openRouterApiKey,
        // Default to Claude Sonnet 4.5 — change via brain config UI per slot.
        // Model IDs follow `<provider>/<model>` format; OpenRouter supports
        // anthropic/*, openai/*, google/*, meta-llama/*, mistralai/* etc.
        model: "anthropic/claude-sonnet-4.5",
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
        url: "https://api.anthropic.com/v1/messages",
        apiKey: ENV.anthropicApiKey,
        // Haiku 4.5 = best speed/cost for orb dispatch + clarification.
        // Override per-call (model: "claude-sonnet-4-6") for harder planning.
        model: "claude-haiku-4-5-20251001",
        supportsThinking: true,
        supportsGrounding: false,
        supportsLongContext: true,
        supportsToolCalling: true,
      };

    case "gemini":
      if (!ENV.geminiApiKey)
        throw new Error("Engine 'gemini' 指定但 GEMINI_API_KEY 未設定");
      return {
        name: "Gemini API (Direct)",
        engine: "gemini",
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
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
        name: "NVIDIA NIM (MiniMax M2.7)",
        engine: "nvidia",
        url: "https://integrate.api.nvidia.com/v1/chat/completions",
        apiKey: nvidiaKey,
        model: "minimaxai/minimax-m2.7", // 修復：原為 minimax/minimax-m2.7 導致 NVIDIA NIM 404，正確路徑為 minimaxai/minimax-m2.7
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
    url: `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict`,
    apiKey: ENV.geminiApiKey,
    provider: "gemini",
  };
}
