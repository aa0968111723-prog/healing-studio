/**
 * featureFlags.ts — Runtime feature flag system with graceful fallback
 *
 * Enables gradual feature rollout and safe disabling of optional subsystems
 * without redeployment. Flags are read from environment variables at startup
 * and can be overridden at runtime via the admin API.
 *
 * Supported flags (all default to enabled if the required API keys exist):
 *   RAG_MEMORY          — RAG vector memory（Supabase pgvector 或 Pinecone 後端）
 *   RAG_PINECONE        — 強制使用遺留 Pinecone 後端（AIDV-907 後預設 OFF）
 *   RESEARCH_MODE       — Perplexity / Brave deep-research (requires API keys)
 *   ADVANCED_SEARCH     — Multi-provider search aggregation
 *   LLM_CACHE           — In-process LLM response caching
 *   REQUEST_DEDUP       — In-flight request deduplication
 *   PERFORMANCE_METRICS — Internal metrics collection
 *   IMAGE_GENERATION    — Fal.ai / Replicate image generation
 *   VIDEO_GENERATION    — Fal.ai video generation
 *   AUDIO_GENERATION    — Suno / ElevenLabs audio generation
 *   VOICE_CLONING       — ElevenLabs voice cloning
 *   MODEL_TRAINING      — LoRA fine-tuning jobs
 *   ORB_SCHEDULER       — Scheduled orb task execution
 *
 * Graceful degradation:
 *   When a flag is disabled, callers receive a typed FlagDisabledError
 *   that includes a human-readable reason and a suggested fallback action.
 *   This prevents hard crashes when optional features are unavailable.
 *
 * Usage:
 *   import { featureFlags, FlagDisabledError } from "./_core/featureFlags";
 *
 *   if (!featureFlags.isEnabled("RAG_MEMORY")) {
 *     // skip RAG, use plain context instead
 *   }
 *
 *   // Or use the guard helper which throws FlagDisabledError:
 *   featureFlags.require("IMAGE_GENERATION");
 */

import { serverEnv } from "./env.validated";
import { logger } from "./logger";

// ─── Types ─────────────────────────────────────────────────────────────────

export type FeatureFlagName =
  | "RAG_MEMORY"
  | "RAG_PINECONE"
  | "RESEARCH_MODE"
  | "ADVANCED_SEARCH"
  | "LLM_CACHE"
  | "REQUEST_DEDUP"
  | "PERFORMANCE_METRICS"
  | "IMAGE_GENERATION"
  | "VIDEO_GENERATION"
  | "AUDIO_GENERATION"
  | "VOICE_CLONING"
  | "MODEL_TRAINING"
  | "ORB_SCHEDULER";

export interface FlagDefinition {
  /** Human-readable description of what this flag controls */
  description: string;
  /**
   * Resolver that determines the default enabled state.
   * Called once at startup; result is cached.
   */
  defaultResolver: () => boolean;
  /** Suggested action when the flag is disabled */
  fallbackHint: string;
}

export interface FlagStatus {
  name: FeatureFlagName;
  enabled: boolean;
  source: "env" | "runtime" | "default";
  description: string;
  fallbackHint: string;
}

export class FlagDisabledError extends Error {
  public readonly flagName: FeatureFlagName;
  public readonly fallbackHint: string;

  constructor(flagName: FeatureFlagName, fallbackHint: string) {
    super(`Feature flag "${flagName}" is disabled. ${fallbackHint}`);
    this.name = "FlagDisabledError";
    this.flagName = flagName;
    this.fallbackHint = fallbackHint;
  }
}

// ─── Flag Definitions ──────────────────────────────────────────────────────

const FLAG_DEFINITIONS: Record<FeatureFlagName, FlagDefinition> = {
  RAG_MEMORY: {
    description:
      "RAG vector memory for personalised AI context（AIDV-907：Supabase pgvector 為主、Pinecone 為遺留備援）",
    // pgvector（沿用既有 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 接線）
    // 或遺留 PINECONE_API_KEY 任一可用即預設開啟。
    defaultResolver: () =>
      Boolean(
        serverEnv.PINECONE_API_KEY ||
          (serverEnv.SUPABASE_URL && serverEnv.SUPABASE_SERVICE_ROLE_KEY)
      ),
    fallbackHint: "Use plain conversation context without long-term memory.",
  },
  RAG_PINECONE: {
    description:
      "強制使用遺留 Pinecone 向量後端（AIDV-907 起由 Supabase pgvector 取代，預設 OFF；設 FEATURE_RAG_PINECONE=true 可切回）",
    // 硬預設 OFF：Pinecone 只剩兩種觸發方式 —
    //   1) 本旗標明確開啟（runtime override 或 FEATURE_RAG_PINECONE=true）
    //   2) pgvector 未接線 / 查詢失敗時的遺留降級（見 ragMemory.resolveRagVectorBackend）
    defaultResolver: () => false,
    fallbackHint:
      "RAG vectors use Supabase pgvector; Pinecone is only used as legacy fallback.",
  },
  RESEARCH_MODE: {
    description:
      "Deep research via Brave Search 或 OpenRouter Perplexity Sonar（取代直連 Perplexity API）",
    defaultResolver: () =>
      Boolean(
        serverEnv.BRAVE_SEARCH_API_KEY ||
          serverEnv.OPENROUTER_API_KEY ||
          serverEnv.PERPLEXITY_API_KEY
      ),
    fallbackHint: "Fall back to standard LLM knowledge without live search.",
  },
  ADVANCED_SEARCH: {
    description:
      "Multi-provider search aggregation（Brave + OpenRouter Sonar；Perplexity 直連視為已淘汰）",
    defaultResolver: () =>
      Boolean(
        serverEnv.BRAVE_SEARCH_API_KEY ||
          serverEnv.OPENROUTER_API_KEY ||
          serverEnv.PERPLEXITY_API_KEY
      ),
    fallbackHint: "Use single-provider search or skip search entirely.",
  },
  LLM_CACHE: {
    description: "In-process LRU cache for LLM responses",
    defaultResolver: () => serverEnv.NODE_ENV !== "test",
    fallbackHint: "Every LLM call will hit the upstream API directly.",
  },
  REQUEST_DEDUP: {
    description: "In-flight request deduplication for concurrent LLM calls",
    defaultResolver: () => serverEnv.NODE_ENV !== "test",
    fallbackHint: "Concurrent identical requests will each hit the upstream API.",
  },
  PERFORMANCE_METRICS: {
    description: "Internal latency and error-rate metrics collection",
    defaultResolver: () => true,
    fallbackHint: "Performance data will not be collected.",
  },
  IMAGE_GENERATION: {
    description: "Image generation via Fal.ai / Replicate",
    defaultResolver: () =>
      Boolean(serverEnv.FAL_API_KEY || serverEnv.REPLICATE_API_TOKEN),
    fallbackHint: "Image generation endpoints will return 503.",
  },
  VIDEO_GENERATION: {
    description: "Video generation via Fal.ai",
    defaultResolver: () => Boolean(serverEnv.FAL_API_KEY),
    fallbackHint: "Video generation endpoints will return 503.",
  },
  AUDIO_GENERATION: {
    description: "Audio / music generation via Suno",
    defaultResolver: () => Boolean(serverEnv.SUNO_API_KEY),
    fallbackHint: "Audio generation endpoints will return 503.",
  },
  VOICE_CLONING: {
    description: "Voice cloning and TTS via ElevenLabs",
    defaultResolver: () => Boolean(serverEnv.ELEVENLABS_API_KEY),
    fallbackHint: "Voice endpoints will fall back to Google TTS.",
  },
  MODEL_TRAINING: {
    description: "LoRA fine-tuning jobs via Replicate / Fal.ai",
    defaultResolver: () =>
      Boolean(serverEnv.REPLICATE_API_TOKEN || serverEnv.FAL_API_KEY),
    fallbackHint: "Model training jobs will be rejected.",
  },
  ORB_SCHEDULER: {
    description: "Scheduled orb task execution",
    defaultResolver: () => serverEnv.ENABLE_ORB_TASK_STATE_MACHINE === "true",
    fallbackHint: "Scheduled tasks will not run automatically.",
  },
};

// ─── Feature Flag Service ──────────────────────────────────────────────────

class FeatureFlagService {
  /** Runtime overrides — set via admin API or tests */
  private readonly overrides = new Map<FeatureFlagName, boolean>();

  /** Cached default values (resolved once at first access) */
  private readonly defaults = new Map<FeatureFlagName, boolean>();

  // ── Core API ─────────────────────────────────────────────────────────────

  /**
   * Check whether a feature flag is currently enabled.
   * Checks in order: runtime override → env var → default resolver.
   */
  isEnabled(name: FeatureFlagName): boolean {
    // 1. Runtime override (highest priority)
    if (this.overrides.has(name)) {
      return this.overrides.get(name)!;
    }

    // 2. Explicit env var override (e.g. FEATURE_RAG_MEMORY=false)
    const envKey = `FEATURE_${name}`;
    const envVal = process.env[envKey];
    if (envVal !== undefined) {
      return envVal.toLowerCase() !== "false" && envVal !== "0";
    }

    // 3. Cached default
    if (!this.defaults.has(name)) {
      const def = FLAG_DEFINITIONS[name];
      let resolved = false;
      try {
        resolved = def.defaultResolver();
      } catch {
        resolved = false;
      }
      this.defaults.set(name, resolved);
    }

    return this.defaults.get(name)!;
  }

  /**
   * Assert that a feature flag is enabled.
   * Throws FlagDisabledError if the flag is off — callers should catch
   * this and apply graceful degradation.
   */
  require(name: FeatureFlagName): void {
    if (!this.isEnabled(name)) {
      const def = FLAG_DEFINITIONS[name];
      throw new FlagDisabledError(name, def.fallbackHint);
    }
  }

  /**
   * Execute `fn` if the flag is enabled, otherwise execute `fallback`.
   * This is the recommended pattern for graceful degradation.
   *
   * @example
   * const memories = await featureFlags.withFallback(
   *   "RAG_MEMORY",
   *   () => ragMemory.query(userId, prompt),
   *   () => [],
   * );
   */
  async withFallback<T>(
    name: FeatureFlagName,
    fn: () => Promise<T>,
    fallback: () => Promise<T> | T
  ): Promise<T> {
    if (this.isEnabled(name)) {
      try {
        return await fn();
      } catch (err) {
        // If the feature throws, log and fall back gracefully
        logger.warn("[FeatureFlags] Feature threw, falling back", {
          flag: name,
          err: err instanceof Error ? err.message : String(err),
        });
        return fallback();
      }
    }
    return fallback();
  }

  // ── Runtime Overrides ────────────────────────────────────────────────────

  /**
   * Override a flag at runtime (e.g. from admin API or tests).
   * Overrides persist until the process restarts or clearOverride() is called.
   */
  setOverride(name: FeatureFlagName, enabled: boolean): void {
    this.overrides.set(name, enabled);
    logger.info("[FeatureFlags] Runtime override set", { flag: name, enabled });
  }

  /** Remove a runtime override, reverting to env/default resolution. */
  clearOverride(name: FeatureFlagName): void {
    this.overrides.delete(name);
    logger.info("[FeatureFlags] Runtime override cleared", { flag: name });
  }

  /** Remove all runtime overrides. */
  clearAllOverrides(): void {
    this.overrides.clear();
  }

  // ── Observability ────────────────────────────────────────────────────────

  /**
   * Return the status of all feature flags.
   * Useful for admin dashboards and health endpoints.
   */
  getAllStatuses(): FlagStatus[] {
    return (Object.keys(FLAG_DEFINITIONS) as FeatureFlagName[]).map(name => {
      const def = FLAG_DEFINITIONS[name];
      const hasOverride = this.overrides.has(name);
      const hasEnvOverride = process.env[`FEATURE_${name}`] !== undefined;

      return {
        name,
        enabled: this.isEnabled(name),
        source: hasOverride ? "runtime" : hasEnvOverride ? "env" : "default",
        description: def.description,
        fallbackHint: def.fallbackHint,
      };
    });
  }

  /**
   * Return a compact summary of enabled/disabled flags for logging.
   */
  getSummary(): Record<string, boolean> {
    const summary: Record<string, boolean> = {};
    for (const name of Object.keys(FLAG_DEFINITIONS) as FeatureFlagName[]) {
      summary[name] = this.isEnabled(name);
    }
    return summary;
  }

  /**
   * Log the current flag state at startup.
   * Call this once during server initialisation.
   */
  logStartupState(): void {
    const statuses = this.getAllStatuses();
    const enabled = statuses.filter(s => s.enabled).map(s => s.name);
    const disabled = statuses.filter(s => !s.enabled).map(s => s.name);

    logger.info("[FeatureFlags] Startup state", {
      enabled,
      disabled,
    });

    if (disabled.length > 0) {
      for (const status of statuses.filter(s => !s.enabled)) {
        logger.warn("[FeatureFlags] Feature disabled", {
          flag: status.name,
          reason: status.source === "env" ? "env override" : "missing API key or config",
          fallback: status.fallbackHint,
        });
      }
    }
  }
}

// ─── Singleton Export ──────────────────────────────────────────────────────

export const featureFlags = new FeatureFlagService();

export { FeatureFlagService };
