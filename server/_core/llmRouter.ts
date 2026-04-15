/**
 * llmRouter.ts — 四引擎智慧路由層（含斷路器 + 健康感知自動降級）
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                    LLM Router (此檔案)                          │
 * ├──────────────┬────────────┬──────────────────┬─────────────────┤
 * │  Engine A    │ Engine B   │   Engine C       │   Engine D      │
 * │  Gemini API  │ Vertex AI  │  Manus Forge     │  MiniMax M2.7   │
 * │  (直接呼叫)  │ (GCP SDK)  │  (向後相容降級)  │  (NVIDIA NIM)   │
 * └──────────────┴────────────┴──────────────────┴─────────────────┘
 *
 * 路由策略（可在 .env 中設定 LLM_ENGINE 覆蓋）：
 *   auto     → 自動偵測可用引擎，健康感知優先：gemini > minimax > vertex > forge
 *   gemini   → 強制使用 Gemini API（需要 GEMINI_API_KEY）
 *   vertex   → 強制使用 Vertex AI（需要 GOOGLE_APPLICATION_CREDENTIALS_JSON）
 *   forge    → 強制使用 Manus Forge（需要 BUILT_IN_FORGE_API_KEY）
 *   minimax  → 強制使用 MiniMax M2.7 via NVIDIA NIM（需要 NVIDA_API）
 *
 * 每個 Engine 支援的功能：
 *   Engine A (Gemini API)   ：chat, json_mode, function_calling, vision, thinking
 *   Engine B (Vertex AI)    ：chat, json_mode, function_calling, vision, grounding, long_context
 *   Engine C (Forge)        ：chat, json_mode, function_calling, vision, thinking, whisper, maps
 *   Engine D (MiniMax M2.7) ：chat, json_mode, function_calling, long_context (200K), agentic
 *
 * 穩定性機制：
 *   1. Circuit Breaker — 連續失敗 N 次後自動斷路，冷卻後半開放試探
 *   2. Health-Aware Routing — auto 模式自動跳過不健康的引擎
 *   3. Automatic Failover — invokeLLM 內建引擎降級鏈，首選引擎失敗後自動嘗試備援
 *   4. Exponential Backoff — 每次重試指數退避，避免雪崩
 */

import { serverEnv } from "./env.validated";
import { ENV } from "./env";

// ─── 引擎類型 ──────────────────────────────────────────────────────────────

export type LLMEngine = "gemini" | "vertex" | "forge" | "nvidia" | "auto";

export interface EngineConfig {
  name: string;
  engine: LLMEngine;           // 引擎識別符
  url: string;
  apiKey: string;
  model: string;
  supportsThinking: boolean;    // extended reasoning budget_tokens
  supportsGrounding: boolean;   // Google Search grounding
  supportsLongContext: boolean;  // >1M token context
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
  openedAt: number;            // 進入 OPEN 狀態的時間
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
    console.warn(`[CircuitBreaker] 🔴 ${engine} 連續失敗 ${cb.failures} 次，斷路中（冷卻 ${CIRCUIT_COOLDOWN_MS / 1000}s）`);
  }
}

/** 取得所有斷路器狀態（供 debug / health endpoint 使用） */
export function getCircuitBreakerStatus(): Record<string, { state: CircuitState; failures: number; available: boolean }> {
  const result: Record<string, { state: CircuitState; failures: number; available: boolean }> = {};
  for (const [engine, cb] of circuitBreakers.entries()) {
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
 * 偵測可用的引擎，回傳優先順序列表
 * 呼叫端可以用來顯示「目前使用哪個引擎」的 debug info
 */
export function detectAvailableEngines(): Array<{ engine: LLMEngine; reason: string }> {
  const available: Array<{ engine: LLMEngine; reason: string }> = [];

  if (ENV.geminiApiKey) {
    available.push({ engine: "gemini", reason: "GEMINI_API_KEY 已設定" });
  }
  if (serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON && serverEnv.GOOGLE_CLOUD_PROJECT_ID) {
    available.push({ engine: "vertex", reason: "GOOGLE_APPLICATION_CREDENTIALS_JSON + PROJECT_ID 已設定" });
  }
  if (ENV.forgeApiKey && ENV.forgeApiUrl) {
    available.push({ engine: "forge", reason: "BUILT_IN_FORGE_API_KEY 已設定（Manus 相容模式）" });
  }
  if (process.env.NVIDIA_API) {
    available.push({ engine: "nvidia", reason: "NVIDIA_API 已設定（NVIDIA NIM 代理人引擎）" });
  }

  return available;
}

/**
 * 解析當前應使用的引擎設定
 * 健康感知優先順序（auto 模式）：gemini > nvidia > vertex > forge
 * 含斷路器判斷 — 跳過不健康的引擎
 */
export function resolveEngineConfig(forceEngine?: LLMEngine): EngineConfig {
  const preferred = forceEngine ?? (serverEnv.LLM_ENGINE as LLMEngine) ?? "auto";

  // ── 強制指定引擎 — 不受斷路器影響（用戶明確選擇）─────────
  if (preferred !== "auto") {
    return resolveSpecificEngine(preferred);
  }

  // ── Auto 模式 — 健康感知路由 ───────────────────────────────
  // 優先順序：gemini > nvidia > vertex > forge
  const autoOrder: LLMEngine[] = ["gemini", "nvidia", "vertex", "forge"];

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
    "沒有可用的 LLM 引擎！請在 .env 中設定 GEMINI_API_KEY（推薦）、NVIDIA_API（NVIDIA NIM）或 BUILT_IN_FORGE_API_KEY（Manus 相容）"
  );
}

/**
 * 取得 auto 模式下的引擎降級鏈（供 invokeLLM 自動降級使用）
 * 回傳從首選引擎開始的所有可用引擎列表（不含首選自身）
 */
export function getEngineFallbackChain(primaryEngine: LLMEngine): EngineConfig[] {
  const allOrder: LLMEngine[] = ["gemini", "nvidia", "vertex", "forge"];
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
    case "gemini":
      if (!ENV.geminiApiKey) throw new Error("Engine 'gemini' 指定但 GEMINI_API_KEY 未設定");
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
        throw new Error("Engine 'vertex' 指定但 GOOGLE_CLOUD_PROJECT_ID 或 GOOGLE_APPLICATION_CREDENTIALS_JSON 未設定");
      }
      if (!ENV.geminiApiKey) throw new Error("Vertex AI 需要 GEMINI_API_KEY 或服務帳號 Token");
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
      const nvidiaKey = process.env.NVIDIA_API;
      if (!nvidiaKey) throw new Error("Engine 'nvidia' 指定但 NVIDIA_API 未設定");
      return {
        name: "NVIDIA NIM (MiniMax M2.7)",
        engine: "nvidia",
        url: "https://integrate.api.nvidia.com/v1/chat/completions",
        apiKey: nvidiaKey,
        model: "minimax/minimax-01",
        supportsThinking: true,
        supportsGrounding: false,
        supportsLongContext: true,
        supportsToolCalling: true,
      };
    }

    case "forge":
      if (!ENV.forgeApiKey || !ENV.forgeApiUrl) throw new Error("Engine 'forge' 指定但 BUILT_IN_FORGE_API_KEY 未設定");
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

  if (!ENV.geminiApiKey) missing.push("GEMINI_API_KEY（推薦）");
  if (!serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON) missing.push("GOOGLE_APPLICATION_CREDENTIALS_JSON（Vertex AI）");
  if (!ENV.forgeApiKey) missing.push("BUILT_IN_FORGE_API_KEY（Manus 相容）");
  if (!serverEnv.NVIDA_API) missing.push("NVIDA_API（MiniMax M2.7 via NVIDIA NIM）");

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
    recommendation: available.length === 0
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
  const hasVertex = !!(projectId && serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  const hasGemini = !!ENV.geminiApiKey;

  // 決定提供者
  const provider: "gemini" | "vertex" = forceProvider
    ?? (hasVertex ? "vertex" : "gemini");

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
    if (!ENV.geminiApiKey) throw new Error("Vertex AI 端點需要 GEMINI_API_KEY 作為認證");

    return {
      name: `${modelName} (Vertex AI)`,
      modelId: `vertex/${modelName}`,
      url: `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelName}:predict`,
      apiKey: ENV.geminiApiKey,
      provider: "vertex",
    };
  }

  // Google AI Studio（Gemini API）
  if (!ENV.geminiApiKey) throw new Error("Google AI Studio 需要 GEMINI_API_KEY");

  return {
    name: `${modelName} (AI Studio)`,
    modelId: `gemini/${modelName}`,
    url: `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:predict`,
    apiKey: ENV.geminiApiKey,
    provider: "gemini",
  };
}
