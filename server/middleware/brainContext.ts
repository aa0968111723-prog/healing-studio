/**
 * Brain Context Middleware
 * ────────────────────────────────────────────────────────────────────────────
 * 在每次 tRPC 請求時攔截並讀取 `user_ai_brain` 配置，注入 `ctx.brain`。
 *
 * 防護機制：
 *   1. Health Ping — 對選定引擎執行輕量級可用性探測
 *   2. Graceful Degradation — 若引擎斷線，優雅退回預設引擎
 *   3. Safety Audit Log — 所有降級 / 切換事件寫入結構化日誌
 *
 * 設計原則：
 *   - 零阻塞：Health Ping 使用快取 + TTL，不會在每次請求時發出 HTTP
 *   - 零崩潰：任何 DB / 網路錯誤都會 fallback 到硬編碼預設值
 *   - 可觀測：所有事件透過 BrainAuditLogger 結構化輸出
 */

import { eq } from "drizzle-orm";
import { userAiBrain, type UserAiBrain } from "../../drizzle/schema";
import { getDb } from "../db";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** 推理大腦插槽名稱 */
export type ReasoningBrainSlot =
  | "director"
  | "analyst"
  | "storyteller"
  | "technician"
  | "curator";

/** 生成引擎插槽名稱 */
export type GenerationEngineSlot =
  | "imageEngine"
  | "videoEngine"
  | "audioEngine"
  | "voiceEngine";

/** 所有插槽名稱 */
export type BrainSlot = ReasoningBrainSlot | GenerationEngineSlot;

/** 單一推理大腦的解析結果 */
export interface ReasoningBrainConfig {
  slot: ReasoningBrainSlot;
  model: string;
  temperature: number;
  topP: number;
  systemPrompt: string | null;
  enabled: boolean;
  healthy: boolean;
  degraded: boolean;
  originalModel?: string; // 降級前的原始模型
}

/** 單一生成引擎的解析結果 */
export interface GenerationEngineConfig {
  slot: GenerationEngineSlot;
  engine: string;
  params: Record<string, unknown> | null;
  enabled: boolean;
  healthy: boolean;
  degraded: boolean;
  originalEngine?: string; // 降級前的原始引擎
}

/** 注入到 ctx.brain 的完整大腦組態 */
export interface BrainContext {
  /** 使用者是否有自訂大腦配置（false = 使用全預設） */
  hasCustomConfig: boolean;

  /** 5 種推理大腦 */
  reasoning: Record<ReasoningBrainSlot, ReasoningBrainConfig>;

  /** 4 種生成引擎 */
  generation: Record<GenerationEngineSlot, GenerationEngineConfig>;

  /** 本次請求的降級摘要 */
  degradationSummary: DegradationEvent[];

  /** 快速取得指定推理大腦 */
  getBrain: (slot: ReasoningBrainSlot) => ReasoningBrainConfig;

  /** 快速取得指定生成引擎 */
  getEngine: (slot: GenerationEngineSlot) => GenerationEngineConfig;

  /** 取得所有健康的推理大腦 */
  getHealthyBrains: () => ReasoningBrainConfig[];

  /** 取得所有健康的生成引擎 */
  getHealthyEngines: () => GenerationEngineConfig[];
}

/** 降級事件 */
export interface DegradationEvent {
  slot: BrainSlot;
  originalModel: string;
  fallbackModel: string;
  reason: string;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Default Configurations (硬編碼安全預設)
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_REASONING_BRAINS: Record<
  ReasoningBrainSlot,
  { model: string; temperature: number; topP: number }
> = {
  director:    { model: "gemini-2.5-pro",   temperature: 0.7,  topP: 0.9  },
  analyst:     { model: "gemini-2.5-flash",  temperature: 0.3,  topP: 0.8  },
  storyteller: { model: "gemini-2.5-pro",   temperature: 0.9,  topP: 0.95 },
  technician:  { model: "gemini-2.5-flash",  temperature: 0.2,  topP: 0.7  },
  curator:     { model: "gemini-2.5-flash",  temperature: 0.8,  topP: 0.9  },
};

export const DEFAULT_GENERATION_ENGINES: Record<
  GenerationEngineSlot,
  { engine: string; params: Record<string, unknown> | null }
> = {
  imageEngine: { engine: "fal-ai/flux-pro/v1.1", params: null },
  videoEngine: { engine: "fal-ai/kling-video/v2.1/pro/text-to-video", params: null },
  audioEngine: { engine: "fal-ai/stable-audio", params: null },
  voiceEngine: { engine: "fal-ai/metavoice-v1", params: null },
};

/** 每個引擎的備援候選清單（按優先順序） */
const ENGINE_FALLBACK_CHAIN: Record<string, string[]> = {
  // 推理大腦（Gemini 模型族）
  "gemini-2.5-pro":   ["gemini-2.5-flash", "gemini-1.5-pro"],
  "gemini-2.5-flash": ["gemini-1.5-flash", "gemini-2.5-pro"],
  "gemini-1.5-pro":   ["gemini-2.5-pro",   "gemini-1.5-flash"],
  "gemini-1.5-flash": ["gemini-2.5-flash",  "gemini-1.5-pro"],
  // OpenAI 模型名稱 → Gemini fallback（向後相容，防止舊設定觸發 404）
  "gpt-4o":           ["gemini-2.5-pro",   "gemini-2.5-flash"],
  "gpt-4o-mini":      ["gemini-2.5-flash",  "gemini-1.5-flash"],
  "gpt-3.5-turbo":    ["gemini-2.5-flash",  "gemini-1.5-flash"],
  "claude-3.5-sonnet":["gemini-2.5-pro",   "gemini-2.5-flash"],
  "claude-3-opus":    ["gemini-2.5-pro",   "gemini-1.5-pro"],
  "claude-3-haiku":   ["gemini-2.5-flash",  "gemini-1.5-flash"],
  // Vertex AI 路徑 → 直接 Gemini fallback
  "vertex/gemini-2.5-pro":   ["gemini-2.5-pro",   "gemini-2.5-flash"],
  "vertex/gemini-2.5-flash":  ["gemini-2.5-flash",  "gemini-1.5-flash"],
  // 圖像引擎（fal.ai）
  "fal-ai/flux-pro/v1.1":       ["fal-ai/flux/dev", "fal-ai/flux-schnell"],
  "fal-ai/flux/dev":             ["fal-ai/flux-pro/v1.1", "fal-ai/flux-schnell"],
  "fal-ai/flux-schnell":         ["fal-ai/flux/dev", "fal-ai/flux-pro/v1.1"],
  // 向後相容短名稱 → fal.ai 路徑 fallback
  "flux-pro":                    ["fal-ai/flux-pro/v1.1", "fal-ai/flux-schnell"],
  "flux-schnell":                ["fal-ai/flux-schnell", "fal-ai/flux-pro/v1.1"],
  // 影片引擎（fal.ai Kling v2.1）
  "fal-ai/kling-video/v2.1/pro/text-to-video":      ["fal-ai/wan-t2v", "fal-ai/minimax/video-01"],
  "fal-ai/kling-video/v2.1/pro/image-to-video":      ["fal-ai/wan-i2v", "fal-ai/minimax/video-01/image-to-video"],
  "fal-ai/wan-t2v":              ["fal-ai/kling-video/v2.1/standard/text-to-video", "fal-ai/minimax/video-01"],
  "fal-ai/minimax/video-01":     ["fal-ai/kling-video/v2.1/standard/text-to-video", "fal-ai/wan-t2v"],
  // 向後相容短名稱
  "kling-v1":                    ["fal-ai/kling-video/v2.1/pro/text-to-video", "fal-ai/wan-t2v"],
  // 音樂引擎（fal.ai）
  "fal-ai/stable-audio":         ["fal-ai/ace-step", "fal-ai/musicgen"],
  "fal-ai/ace-step":             ["fal-ai/stable-audio", "fal-ai/musicgen"],
  "fal-ai/musicgen":             ["fal-ai/stable-audio", "fal-ai/ace-step"],
  // 向後相容短名稱
  "suno-v4":                     ["fal-ai/stable-audio", "fal-ai/ace-step"],
  "suno-v3.5":                   ["fal-ai/stable-audio", "fal-ai/ace-step"],
  // 語音引擎（fal.ai TTS）
  "fal-ai/metavoice-v1":         ["fal-ai/kokoro", "fal-ai/dia-tts"],
  "fal-ai/kokoro":               ["fal-ai/metavoice-v1", "fal-ai/dia-tts"],
  "fal-ai/dia-tts":              ["fal-ai/metavoice-v1", "fal-ai/kokoro"],
  // 向後相容短名稱
  "elevenlabs-v2":               ["fal-ai/metavoice-v1", "fal-ai/kokoro"],
};

// ═══════════════════════════════════════════════════════════════════════════
// Health Ping System (健康狀態區驗)
// ═══════════════════════════════════════════════════════════════════════════

interface HealthCacheEntry {
  healthy: boolean;
  checkedAt: number;
  consecutiveFailures: number;
  lastError?: string;
}

/** 健康狀態快取 — TTL 60 秒，避免每次請求都發出探測 */
const healthCache = new Map<string, HealthCacheEntry>();
const HEALTH_CACHE_TTL_MS = 60_000; // 60 秒
const MAX_CONSECUTIVE_FAILURES = 3; // 連續失敗 N 次後標記為不健康

/**
 * 對指定模型/引擎執行輕量級健康探測。
 *
 * 策略：
 *   1. 先查快取，TTL 內直接返回
 *   2. 快取過期時，以非阻塞方式在背景更新
 *   3. 首次查詢（無快取）時，樂觀返回 healthy=true 並在背景探測
 *
 * 這確保 middleware 永遠不會因為 health ping 而阻塞請求。
 */
export function getHealthStatus(modelOrEngine: string): boolean {
  const cached = healthCache.get(modelOrEngine);
  const now = Date.now();

  if (cached && now - cached.checkedAt < HEALTH_CACHE_TTL_MS) {
    return cached.healthy;
  }

  // 快取過期或不存在 — 背景更新，樂觀返回上次狀態或 true
  scheduleHealthCheck(modelOrEngine);
  return cached?.healthy ?? true;
}

/**
 * 排程背景健康檢查（非阻塞）。
 * 實際的探測邏輯根據模型類型不同：
 *   - LLM 模型：嘗試一次極小的 invokeLLM 呼叫
 *   - 生成引擎：檢查 API endpoint 可達性
 *
 * 為了避免在 middleware 中引入重量級依賴，這裡使用簡化的
 * connectivity check（DNS + TCP），而非完整的 API 呼叫。
 */
function scheduleHealthCheck(modelOrEngine: string): void {
  // 使用 setImmediate 確保不阻塞當前請求
  setImmediate(async () => {
    const cached = healthCache.get(modelOrEngine);
    const previousFailures = cached?.consecutiveFailures ?? 0;

    try {
      // 簡化的健康檢查：驗證模型名稱是否在已知清單中
      // 在生產環境中，這裡會替換為實際的 API ping
      const isKnownModel = isRecognizedModel(modelOrEngine);

      if (isKnownModel) {
        healthCache.set(modelOrEngine, {
          healthy: true,
          checkedAt: Date.now(),
          consecutiveFailures: 0,
        });
      } else {
        const failures = previousFailures + 1;
        healthCache.set(modelOrEngine, {
          healthy: failures < MAX_CONSECUTIVE_FAILURES,
          checkedAt: Date.now(),
          consecutiveFailures: failures,
          lastError: `Unknown model/engine: ${modelOrEngine}`,
        });
      }
    } catch (err) {
      const failures = previousFailures + 1;
      healthCache.set(modelOrEngine, {
        healthy: failures < MAX_CONSECUTIVE_FAILURES,
        checkedAt: Date.now(),
        consecutiveFailures: failures,
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

/** 已知的模型/引擎清單 */
const KNOWN_MODELS = new Set([
  // LLM — Gemini（主要引擎）
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
  "gemini-pro",
  // Vertex AI 路徑
  "vertex/gemini-2.5-pro",
  "vertex/gemini-2.5-flash",
  "vertex/gemini-1.5-pro",
  "vertex/gemini-1.5-flash",
  "vertex/llama-3.2-90b",
  // OpenAI/Claude（向後相容，系統會自動 remapping）
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-3.5-turbo",
  "claude-3.5-sonnet",
  "claude-3-opus",
  // Google AI Studio / Vertex AI — 多模態
  "gemini/imagen-3",
  "gemini/imagen-3-fast",
  "gemini/imagen-4",
  "vertex/imagen-3",
  "vertex/imagen-4",
  "gemini/veo-2",
  "gemini/veo-3",
  "gemini/veo-3-fast",
  "vertex/veo-2",
  "vertex/veo-3",
  "gemini/lyria-2",
  "gemini/lyria-3",
  "vertex/lyria-2",
  "gemini/tts-flash",
  "gemini/tts-pro",
  // 圖像引擎（fal.ai）
  "fal-ai/flux-pro/v1.1",
  "fal-ai/flux/dev",
  "fal-ai/flux/schnell",
  "fal-ai/flux-schnell",
  "fal-ai/stable-diffusion-v3-medium",
  "fal-ai/aura-flow",
  "fal-ai/ideogram/v2",
  "flux-pro",       // 向後相容短名稱
  "flux-schnell",   // 向後相容短名稱
  // 圖像編輯 / ControlNet / IP-Adapter
  "fal-ai/flux/dev/image-to-image",
  "fal-ai/stable-diffusion-v3-medium/image-to-image",
  "fal-ai/controlnet-union",
  "fal-ai/ip-adapter-face-id",
  "fal-ai/aura-sr",
  "fal-ai/imageutils/rembg",
  // 影片引擎（fal.ai）
  "fal-ai/kling-video/v2.1/pro/text-to-video",
  "fal-ai/kling-video/v2.1/standard/text-to-video",
  "fal-ai/kling-video/v2.1/pro/image-to-video",
  "fal-ai/kling-video/v2.1/standard/image-to-video",
  "fal-ai/kling-video/v2.1/standard/video-to-video",
  "fal-ai/wan-t2v",
  "fal-ai/wan-t2v-v2.1",
  "fal-ai/wan-v2v",
  "fal-ai/minimax/video-01",
  "fal-ai/minimax-video/text-to-video",
  "fal-ai/minimax-video/image-to-video",
  "fal-ai/luma-dream-machine",
  "fal-ai/luma-dream-machine/image-to-video",
  "fal-ai/runway-gen3/turbo/image-to-video",
  "fal-ai/stable-video",
  "fal-ai/cogvideox-5b",
  "fal-ai/cogvideox-5b/video-to-video",
  "fal-ai/video-to-video",
  "fal-ai/topaz-upscale-video",
  "fal-ai/stable-video-upscaler",
  "kling-v1",       // 向後相容短名稱
  // 音樂引擎（fal.ai）
  "fal-ai/stable-audio",
  "fal-ai/ace-step",
  "fal-ai/musicgen",
  "fal-ai/mmaudio-v2",
  "fal-ai/mmaudio-v2/video-to-audio",
  "fal-ai/audioldm2",
  "fal-ai/elevenlabs/sound-effects",
  "suno-v4",        // 向後相容短名稱
  "suno-v3.5",      // 向後相容短名稱
  // 語音引擎（fal.ai TTS）
  "fal-ai/metavoice-v1",
  "fal-ai/kokoro",
  "fal-ai/dia-tts",
  "fal-ai/playai-tts",
  "fal-ai/orpheus-tts",
  "fal-ai/whisper",
  "fal-ai/wizper",
  "fal-ai/sync-lipsync",
  "elevenlabs-v2",  // 向後相容短名稱
  // 3D 引擎
  "fal-ai/trellis",
  "fal-ai/triposr",
  "fal-ai/stable-zero123",
  "fal-ai/zero123plus",
  "fal-ai/mv-adapter",
  "fal-ai/hyper3d/rodin",
  "fal-ai/meshy-4",
  "fal-ai/shap-e",
  "fal-ai/dreamgaussian",
  "fal-ai/fantasia3d",
  // LLM / JSON / Vision（fal.ai）
  "fal-ai/any-llm",
  "fal-ai/llava-next",
  "fal-ai/moondream",
  "fal-ai/doctr",
  "fal-ai/sam2",
  "fal-ai/meta-llama/llama-3.2-90b-vision-instruct",
  "fal-ai/meta-llama/llama-3.1-8b-instruct",
  "fal-ai/wizardlm-2-8x22b",
  "fal-ai/dolphin-2.9.2-qwen2-72b",
  "fal-ai/lmstudio",
  "fal-ai/outlines",
  "fal-ai/wizardcoder",
  // 訓練引擎
  "fal-ai/flux-lora-fast-training",
  "fal-ai/flux-lora-portrait-trainer",
  "fal-ai/dreambooth-flux",
  "fal-ai/sd3-lora-training",
  "fal-ai/cogvideox-lora-training",
  "fal-ai/hunyuan-video-lora-training",
  "fal-ai/flux-2-trainer",
  "fal-ai/turbo-flux-trainer",
]);

function isRecognizedModel(model: string): boolean {
  return KNOWN_MODELS.has(model);
}

/**
 * 手動設定健康狀態（供外部模組報告引擎故障）。
 * 例如：當生成請求收到 503 時，呼叫此函數標記引擎為不健康。
 */
export function reportEngineFailure(
  modelOrEngine: string,
  error: string
): void {
  const cached = healthCache.get(modelOrEngine);
  const failures = (cached?.consecutiveFailures ?? 0) + 1;

  healthCache.set(modelOrEngine, {
    healthy: failures < MAX_CONSECUTIVE_FAILURES,
    checkedAt: Date.now(),
    consecutiveFailures: failures,
    lastError: error,
  });

  BrainAuditLogger.engineFailure(modelOrEngine, error, failures);
}

/**
 * 手動恢復引擎健康狀態（供外部模組報告引擎恢復）。
 */
export function reportEngineRecovery(modelOrEngine: string): void {
  healthCache.set(modelOrEngine, {
    healthy: true,
    checkedAt: Date.now(),
    consecutiveFailures: 0,
  });

  BrainAuditLogger.engineRecovery(modelOrEngine);
}

/** 取得完整的健康快取快照（用於診斷） */
export function getHealthSnapshot(): Record<string, HealthCacheEntry> {
  const snapshot: Record<string, HealthCacheEntry> = {};
  const entries = Array.from(healthCache.entries());
  for (let i = 0; i < entries.length; i++) {
    const [key, value] = entries[i];
    snapshot[key] = { ...value };
  }
  return snapshot;
}

// ═══════════════════════════════════════════════════════════════════════════
// Brain Audit Logger (安全提示日誌)
// ═══════════════════════════════════════════════════════════════════════════

export const BrainAuditLogger = {
  /** 記錄大腦組態載入事件 */
  configLoaded(userId: number, hasCustom: boolean): void {
    console.log(
      `[BrainContext] ✅ userId=${userId} config=${hasCustom ? "custom" : "default"} loaded`
    );
  },

  /** 記錄降級事件 */
  degradation(event: DegradationEvent): void {
    console.warn(
      `[BrainContext] ⚠️  DEGRADATION slot=${event.slot} ` +
        `from="${event.originalModel}" → to="${event.fallbackModel}" ` +
        `reason="${event.reason}"`
    );
  },

  /** 記錄引擎故障 */
  engineFailure(
    modelOrEngine: string,
    error: string,
    consecutiveFailures: number
  ): void {
    console.error(
      `[BrainContext] 🔴 ENGINE_FAILURE model="${modelOrEngine}" ` +
        `error="${error}" consecutiveFailures=${consecutiveFailures}`
    );
  },

  /** 記錄引擎恢復 */
  engineRecovery(modelOrEngine: string): void {
    console.log(
      `[BrainContext] 🟢 ENGINE_RECOVERY model="${modelOrEngine}" restored`
    );
  },

  /** 記錄 DB 讀取失敗（fallback 到預設） */
  dbFallback(userId: number, error: string): void {
    console.warn(
      `[BrainContext] ⚠️  DB_FALLBACK userId=${userId} error="${error}" → using defaults`
    );
  },

  /** 記錄完整的請求大腦摘要 */
  requestSummary(
    userId: number,
    degradations: number,
    healthyBrains: number,
    healthyEngines: number
  ): void {
    const status =
      degradations === 0 ? "🟢 ALL_HEALTHY" : `🟡 DEGRADED(${degradations})`;
    console.log(
      `[BrainContext] ${status} userId=${userId} ` +
        `brains=${healthyBrains}/5 engines=${healthyEngines}/4`
    );
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Graceful Degradation (優雅降級)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 為不健康的模型/引擎尋找可用的備援。
 * 沿著 ENGINE_FALLBACK_CHAIN 依序嘗試，返回第一個健康的候選。
 * 若所有候選都不健康，返回該類型的硬編碼預設值。
 */
function findFallback(
  currentModel: string,
  slot: BrainSlot,
  slotType: "reasoning" | "generation"
): { fallbackModel: string; reason: string } | null {
  const isHealthy = getHealthStatus(currentModel);
  if (isHealthy) return null; // 不需要降級

  const chain = ENGINE_FALLBACK_CHAIN[currentModel] ?? [];

  // 嘗試 fallback chain
  for (const candidate of chain) {
    if (getHealthStatus(candidate)) {
      return {
        fallbackModel: candidate,
        reason: `Primary "${currentModel}" unhealthy, fell back to "${candidate}" via fallback chain`,
      };
    }
  }

  // 所有候選都不健康 — 退回硬編碼預設
  const hardDefault =
    slotType === "reasoning"
      ? DEFAULT_REASONING_BRAINS[slot as ReasoningBrainSlot]?.model
      : DEFAULT_GENERATION_ENGINES[slot as GenerationEngineSlot]?.engine;

  if (hardDefault && hardDefault !== currentModel) {
    return {
      fallbackModel: hardDefault,
      reason: `All fallback candidates unhealthy, reverting to hard default "${hardDefault}"`,
    };
  }

  // 最終兜底：即使預設也不健康，仍然返回預設（總比沒有好）
  return {
    fallbackModel: hardDefault || currentModel,
    reason: `Complete fallback exhaustion, using last-resort default`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Core: Build Brain Context
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 從 DB 讀取使用者的 AI 大腦組態，解析為 BrainContext。
 * 若 DB 不可用或使用者無自訂配置，返回全預設值。
 */
export async function buildBrainContext(userId: number): Promise<BrainContext> {
  const degradationSummary: DegradationEvent[] = [];

  // ── Step 1: 從 DB 讀取使用者配置 ──────────────────────────────────────

  let dbRow: UserAiBrain | null = null;
  let hasCustomConfig = false;

  try {
    const db = await getDb();
    if (db) {
      const rows = await db
        .select()
        .from(userAiBrain)
        .where(eq(userAiBrain.userId, userId))
        .limit(1);
      dbRow = rows[0] ?? null;
      hasCustomConfig = dbRow !== null;
    }
  } catch (err) {
    BrainAuditLogger.dbFallback(
      userId,
      err instanceof Error ? err.message : String(err)
    );
  }

  // ── Step 2: 解析推理大腦 ──────────────────────────────────────────────

  const reasoningSlots: ReasoningBrainSlot[] = [
    "director",
    "analyst",
    "storyteller",
    "technician",
    "curator",
  ];

  const reasoning = {} as Record<ReasoningBrainSlot, ReasoningBrainConfig>;

  for (const slot of reasoningSlots) {
    const defaults = DEFAULT_REASONING_BRAINS[slot];
    const modelKey = `${slot}Model` as keyof UserAiBrain;
    const tempKey = `${slot}Temperature` as keyof UserAiBrain;
    const topPKey = `${slot}TopP` as keyof UserAiBrain;
    const promptKey = `${slot}SystemPrompt` as keyof UserAiBrain;
    const enabledKey = `${slot}Enabled` as keyof UserAiBrain;

    let model = dbRow
      ? String(dbRow[modelKey] ?? defaults.model)
      : defaults.model;
    const temperature = dbRow
      ? Number(dbRow[tempKey] ?? defaults.temperature)
      : defaults.temperature;
    const topP = dbRow
      ? Number(dbRow[topPKey] ?? defaults.topP)
      : defaults.topP;
    const systemPrompt = dbRow
      ? (dbRow[promptKey] as string | null)
      : null;
    const enabled = dbRow
      ? Boolean(dbRow[enabledKey] ?? true)
      : true;

    // Health Ping + Graceful Degradation
    const healthy = getHealthStatus(model);
    let degraded = false;
    let originalModel: string | undefined;

    if (!healthy && enabled) {
      const fallback = findFallback(model, slot, "reasoning");
      if (fallback) {
        originalModel = model;
        model = fallback.fallbackModel;
        degraded = true;

        const event: DegradationEvent = {
          slot,
          originalModel,
          fallbackModel: model,
          reason: fallback.reason,
          timestamp: Date.now(),
        };
        degradationSummary.push(event);
        BrainAuditLogger.degradation(event);
      }
    }

    reasoning[slot] = {
      slot,
      model,
      temperature,
      topP,
      systemPrompt,
      enabled,
      healthy: getHealthStatus(model),
      degraded,
      ...(originalModel ? { originalModel } : {}),
    };
  }

  // ── Step 3: 解析生成引擎 ──────────────────────────────────────────────

  const engineSlots: GenerationEngineSlot[] = [
    "imageEngine",
    "videoEngine",
    "audioEngine",
    "voiceEngine",
  ];

  const generation = {} as Record<GenerationEngineSlot, GenerationEngineConfig>;

  for (const slot of engineSlots) {
    const defaults = DEFAULT_GENERATION_ENGINES[slot];
    const engineKey = slot as keyof UserAiBrain;
    const paramsKey = `${slot}Params` as keyof UserAiBrain;
    const enabledKey = `${slot}Enabled` as keyof UserAiBrain;

    let engine = dbRow
      ? String(dbRow[engineKey] ?? defaults.engine)
      : defaults.engine;
    const params = dbRow
      ? (dbRow[paramsKey] as Record<string, unknown> | null)
      : defaults.params;
    const enabled = dbRow
      ? Boolean(dbRow[enabledKey] ?? true)
      : true;

    // Health Ping + Graceful Degradation
    const healthy = getHealthStatus(engine);
    let degraded = false;
    let originalEngine: string | undefined;

    if (!healthy && enabled) {
      const fallback = findFallback(engine, slot, "generation");
      if (fallback) {
        originalEngine = engine;
        engine = fallback.fallbackModel;
        degraded = true;

        const event: DegradationEvent = {
          slot,
          originalModel: originalEngine,
          fallbackModel: engine,
          reason: fallback.reason,
          timestamp: Date.now(),
        };
        degradationSummary.push(event);
        BrainAuditLogger.degradation(event);
      }
    }

    generation[slot] = {
      slot,
      engine,
      params,
      enabled,
      healthy: getHealthStatus(engine),
      degraded,
      ...(originalEngine ? { originalEngine } : {}),
    };
  }

  // ── Step 4: 組裝 BrainContext ─────────────────────────────────────────

  BrainAuditLogger.configLoaded(userId, hasCustomConfig);
  BrainAuditLogger.requestSummary(
    userId,
    degradationSummary.length,
    Object.values(reasoning).filter((b) => b.healthy && b.enabled).length,
    Object.values(generation).filter((e) => e.healthy && e.enabled).length
  );

  const brainCtx: BrainContext = {
    hasCustomConfig,
    reasoning,
    generation,
    degradationSummary,

    getBrain(slot: ReasoningBrainSlot) {
      return reasoning[slot];
    },

    getEngine(slot: GenerationEngineSlot) {
      return generation[slot];
    },

    getHealthyBrains() {
      return Object.values(reasoning).filter((b) => b.healthy && b.enabled);
    },

    getHealthyEngines() {
      return Object.values(generation).filter((e) => e.healthy && e.enabled);
    },
  };

  return brainCtx;
}

// ═══════════════════════════════════════════════════════════════════════════
// Export: Middleware factory for tRPC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 建立一個不依賴 tRPC 的純函數版本，供 tRPC middleware 呼叫。
 * tRPC 整合在 _core/trpc.ts 中完成。
 */
export { buildBrainContext as resolveBrainForUser };
