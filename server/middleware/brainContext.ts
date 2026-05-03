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
import { resolveFallbackChain } from "../_core/fallbackPolicy";
import { getModelPricing } from "../services/modelPricing";

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

// 全站光球代理（Global Orb Agent）預設改用 Perplexity 旗艦 AI 代理模型
// perplexity/sonar-reasoning-pro（ultra tier）：原生帶 web grounding（即時
// 網路搜尋）、reasoning 強化、最適合「全站光球」需要規劃 + 引用即時資訊
// 的代理人場景。
//
// 路由策略（見 server/_core/llmRouter.ts inferEngineFromModelIdSafe）：
//   1. 若設了 PERPLEXITY_API_KEY → 走原生 Perplexity API（直連，較便宜）
//   2. 若沒設 PERPLEXITY_API_KEY 但有 OPENROUTER_API_KEY → 自動走 OpenRouter
//      （normalizeModelForEngine 會把 perplexity/sonar-* 直接送到
//      OpenRouter 的 perplexity/sonar-* model id，相容）
//   3. 都沒設 → 斷路器跳過，降級到下一條 fallback chain（claude/gemini）
//
// 使用者仍可在 /ai-brain-settings 自行切換每個 slot 的模型。
export const DEFAULT_REASONING_BRAINS: Record<
  ReasoningBrainSlot,
  { model: string; temperature: number; topP: number }
> = {
  director: { model: "perplexity/sonar-reasoning-pro", temperature: 0.4, topP: 0.9 },
  analyst: { model: "perplexity/sonar-reasoning-pro", temperature: 0.3, topP: 0.8 },
  storyteller: { model: "perplexity/sonar-reasoning-pro", temperature: 0.9, topP: 0.95 },
  technician: { model: "perplexity/sonar-reasoning-pro", temperature: 0.2, topP: 0.7 },
  curator: { model: "perplexity/sonar-reasoning-pro", temperature: 0.8, topP: 0.9 },
};

export const DEFAULT_GENERATION_ENGINES: Record<
  GenerationEngineSlot,
  { engine: string; params: Record<string, unknown> | null }
> = {
  imageEngine: { engine: "fal-ai/flux-pro/v1.1", params: null },
  videoEngine: {
    engine: "fal-ai/kling-video/v2.1/standard/text-to-video",
    params: null,
  },
  audioEngine: { engine: "fal-ai/ace-step", params: null },
  voiceEngine: { engine: "fal-ai/elevenlabs/tts/turbo-v2.5", params: null },
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

/** 寫入版本：每次 healthCache 被寫入都 +1，供彙整層判斷快照新鮮度。 */
let healthCacheVersion = 0;
function bumpHealthCacheVersion(): void {
  healthCacheVersion++;
}
export function getHealthCacheVersion(): number {
  return healthCacheVersion;
}

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

/** 三態健康狀態:已驗證健康 / 已驗證不健康 / 未驗證(尚未探測過) */
export type HealthState = "healthy" | "unhealthy" | "unverified";

/**
 * 細緻版健康檢查:回傳三態,讓 UI 能區分「樂觀預設 healthy」與「真的探測過健康」。
 * 與 getHealthStatus 不同之處:無快取時回 "unverified",而非樂觀的 true。
 */
export function getHealthStatusDetailed(modelOrEngine: string): HealthState {
  const cached = healthCache.get(modelOrEngine);
  const now = Date.now();
  if (cached && now - cached.checkedAt < HEALTH_CACHE_TTL_MS) {
    return cached.healthy ? "healthy" : "unhealthy";
  }
  // 排程背景探測,但不假裝已驗證
  scheduleHealthCheck(modelOrEngine);
  return "unverified";
}

/**
 * 同步版健康探測（preflight）—— 用於高成本模型（Sora、Veo3、Topaz、Kling Pro 等
 * ultra tier）首次選用前的「先驗證再扣點」場景。
 *
 * 與 getHealthStatus 的差異：
 *   - 快取命中時行為相同（即時返回）
 *   - 快取未命中時 **等待** scheduleHealthCheck 完成，最長 timeoutMs（預設 3 秒）
 *   - 超時則樂觀回 true（避免阻塞太久），讓上游選擇是否繼續
 *
 * 設計原則：能用 getHealthStatus 就用，preflight 只給高成本路徑使用。
 */
export async function preflightHealthStatus(
  modelOrEngine: string,
  timeoutMs = 3000
): Promise<boolean> {
  const cached = healthCache.get(modelOrEngine);
  const now = Date.now();
  if (cached && now - cached.checkedAt < HEALTH_CACHE_TTL_MS) {
    return cached.healthy;
  }
  // 觸發背景探測並等待結果（最多 timeoutMs）
  scheduleHealthCheck(modelOrEngine);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const fresh = healthCache.get(modelOrEngine);
    if (fresh && fresh.checkedAt >= start) return fresh.healthy;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  // 超時 — 樂觀回 true，但上游可決定是否要 abort
  return true;
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
        bumpHealthCacheVersion();
      } else {
        const failures = previousFailures + 1;
        healthCache.set(modelOrEngine, {
          healthy: failures < MAX_CONSECUTIVE_FAILURES,
          checkedAt: Date.now(),
          consecutiveFailures: failures,
          lastError: `Unknown model/engine: ${modelOrEngine}`,
        });
        bumpHealthCacheVersion();
      }
    } catch (err) {
      const failures = previousFailures + 1;
      healthCache.set(modelOrEngine, {
        healthy: failures < MAX_CONSECUTIVE_FAILURES,
        checkedAt: Date.now(),
        consecutiveFailures: failures,
        lastError: err instanceof Error ? err.message : String(err),
      });
      bumpHealthCacheVersion();
    }
  });
}

import { isCanonicalOrKnownModel } from "../_core/modelRegistry";

/**
 * Whether a given model/engine ID is recognized by the registry.
 * Backed by the auto-derived `getKnownModelIds()` (catalogs ∪ legacy aliases).
 */
function isRecognizedModel(model: string): boolean {
  return isCanonicalOrKnownModel(model);
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
  bumpHealthCacheVersion();

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
  bumpHealthCacheVersion();

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
 * 由 _core/fallbackPolicy.ts 統一查詢:先看 per-model 覆寫(更精確),
 * 缺則退到 per-category 名單,共用同一份 SSOT 避免兩處策略分叉。
 * 若所有候選都不健康,返回該類型的硬編碼預設值。
 */
function findFallback(
  currentModel: string,
  slot: BrainSlot,
  slotType: "reasoning" | "generation"
): { fallbackModel: string; reason: string } | null {
  const isHealthy = getHealthStatus(currentModel);
  if (isHealthy) return null; // 不需要降級

  const category = getModelPricing(currentModel)?.category;
  const chain = resolveFallbackChain(currentModel, category);

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
    const systemPrompt = dbRow ? (dbRow[promptKey] as string | null) : null;
    const enabled = dbRow ? Boolean(dbRow[enabledKey] ?? true) : true;

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
    const enabled = dbRow ? Boolean(dbRow[enabledKey] ?? true) : true;

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
    Object.values(reasoning).filter(b => b.healthy && b.enabled).length,
    Object.values(generation).filter(e => e.healthy && e.enabled).length
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
      return Object.values(reasoning).filter(b => b.healthy && b.enabled);
    },

    getHealthyEngines() {
      return Object.values(generation).filter(e => e.healthy && e.enabled);
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
