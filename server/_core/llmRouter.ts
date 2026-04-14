/**
 * llmRouter.ts — 三引擎智慧路由層
 *
 * ┌─────────────────────────────────────────────────────┐
 * │              LLM Router (此檔案)                     │
 * ├──────────────┬──────────────────┬───────────────────┤
 * │  Engine A    │   Engine B       │   Engine C        │
 * │  Gemini API  │  Vertex AI       │  Manus Forge      │
 * │  (直接呼叫)  │  (GCP SDK)       │  (向後相容降級)   │
 * └──────────────┴──────────────────┴───────────────────┘
 *
 * 路由策略（可在 .env 中設定 LLM_ENGINE 覆蓋）：
 *   auto     → 自動偵測可用引擎，優先 Gemini > Forge
 *   gemini   → 強制使用 Gemini API（需要 GEMINI_API_KEY）
 *   vertex   → 強制使用 Vertex AI（需要 GOOGLE_APPLICATION_CREDENTIALS_JSON）
 *   forge    → 強制使用 Manus Forge（需要 BUILT_IN_FORGE_API_KEY）
 *
 * 每個 Engine 支援的功能：
 *   Engine A (Gemini API)：chat, json_mode, function_calling, vision
 *   Engine B (Vertex AI) ：chat, json_mode, function_calling, vision, grounding, long_context
 *   Engine C (Forge)     ：chat, json_mode, function_calling, vision, thinking, whisper, maps
 */

import { serverEnv } from "./env.validated";
import { ENV } from "./env";

// ─── 引擎類型 ──────────────────────────────────────────────────────────────

export type LLMEngine = "gemini" | "vertex" | "forge" | "auto";

export interface EngineConfig {
  name: string;
  url: string;
  apiKey: string;
  model: string;
  supportsThinking: boolean;    // extended reasoning budget_tokens
  supportsGrounding: boolean;   // Google Search grounding
  supportsLongContext: boolean; // >1M token context
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

  return available;
}

/**
 * 解析當前應使用的引擎設定
 * 優先順序：env override → gemini → forge → 錯誤
 */
export function resolveEngineConfig(forceEngine?: LLMEngine): EngineConfig {
  const preferred = forceEngine ?? (process.env.LLM_ENGINE as LLMEngine | undefined) ?? "auto";

  // ── Engine A：Gemini API（直連，無需 GCP 帳號）─────────────
  if (preferred === "gemini" || preferred === "auto") {
    if (ENV.geminiApiKey) {
      return {
        name: "Gemini API (Direct)",
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        apiKey: ENV.geminiApiKey,
        model: "gemini-2.5-flash",
        supportsThinking: true,
        supportsGrounding: false,
        supportsLongContext: true,
      };
    }
    if (preferred === "gemini") {
      throw new Error("Engine 'gemini' 指定但 GEMINI_API_KEY 未設定");
    }
  }

  // ── Engine B：Vertex AI（GCP SDK，需服務帳號）───────────────
  // Vertex AI 使用 OpenAI-compatible endpoint 或原生 REST API
  if (preferred === "vertex") {
    const projectId = serverEnv.GOOGLE_CLOUD_PROJECT_ID;
    const credentials = serverEnv.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    const location = serverEnv.GOOGLE_CLOUD_LOCATION || "us-central1";
    if (!projectId || !credentials) {
      throw new Error(
        "Engine 'vertex' 指定但 GOOGLE_CLOUD_PROJECT_ID 或 GOOGLE_APPLICATION_CREDENTIALS_JSON 未設定"
      );
    }
    // Vertex AI 支援 Gemini API Key 作為認證（OpenAI-compatible endpoint）
    // 完整 Vertex AI SDK 認證需要服務帳號 Token
    if (ENV.geminiApiKey) {
      return {
        name: "Vertex AI (via Gemini Key)",
        url: `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/gemini-2.5-flash:generateContent`,
        apiKey: ENV.geminiApiKey,
        model: "gemini-2.5-flash",
        supportsThinking: true,
        supportsGrounding: true,
        supportsLongContext: true,
      };
    }
    throw new Error("Vertex AI 需要 GEMINI_API_KEY 或服務帳號 Token");
  }

  // ── Engine C：Manus Forge（向後相容）────────────────────────
  if (preferred === "forge" || preferred === "auto") {
    if (ENV.forgeApiKey && ENV.forgeApiUrl) {
      return {
        name: "Manus Forge API (Legacy)",
        url: `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`,
        apiKey: ENV.forgeApiKey,
        model: "gemini-2.5-flash",
        supportsThinking: true,   // Forge 代理版有 thinking 功能
        supportsGrounding: false,
        supportsLongContext: false,
      };
    }
    if (preferred === "forge") {
      throw new Error("Engine 'forge' 指定但 BUILT_IN_FORGE_API_KEY 未設定");
    }
  }

  // 全部都沒設定
  const available = detectAvailableEngines();
  throw new Error(
    available.length === 0
      ? "沒有可用的 LLM 引擎！請在 .env 中設定 GEMINI_API_KEY（推薦）或 BUILT_IN_FORGE_API_KEY（Manus 相容）"
      : `LLM 引擎設定錯誤。可用引擎：${available.map(e => e.engine).join(", ")}`
  );
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

  let currentName = "無可用引擎";
  try {
    const config = resolveEngineConfig();
    currentName = config.name;
  } catch {
    // ignore
  }

  return {
    current: currentName,
    available: available.map(a => `${a.engine}: ${a.reason}`),
    missing,
    recommendation: available.length === 0
      ? "請設定 GEMINI_API_KEY 以啟用 LLM 功能"
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
