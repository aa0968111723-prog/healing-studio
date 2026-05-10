/**
 * metrics.ts — Lightweight in-process performance metrics collector
 *
 * Tracks LLM call latency, API response times, error rates, and token usage
 * without requiring an external metrics backend (Prometheus, Datadog, etc.).
 * All data is held in memory and exposed via getSnapshot() for health
 * endpoints or periodic log flushing.
 *
 * Design:
 *   - Rolling 1-minute and 15-minute windows for latency percentiles
 *   - Per-endpoint error rate counters
 *   - Token usage aggregation per model
 *   - Zero external dependencies
 *
 * Usage:
 *   import { metrics } from "./_core/metrics";
 *
 *   const timer = metrics.startTimer("llm.invoke");
 *   try {
 *     const result = await invokeLLM(params);
 *     timer.end({ model: result.model, tokens: result.usage?.total_tokens });
 *   } catch (err) {
 *     timer.error(err);
 *   }
 */

import { logger } from "./logger";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TimerHandle {
  /** Record a successful completion. */
  end(meta?: TimerMeta): void;
  /** Record a failure. */
  error(err?: unknown, meta?: TimerMeta): void;
}

export interface TimerMeta {
  model?: string;
  engine?: string;
  endpoint?: string;
  tokens?: number;
  cached?: boolean;
  deduplicated?: boolean;
  [key: string]: unknown;
}

export interface LatencyBucket {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  /** Sorted sample array (capped at MAX_SAMPLES) for percentile calculation */
  samples: number[];
}

export interface MetricCounter {
  total: number;
  success: number;
  error: number;
  /** Error rate as a percentage (0–100) */
  errorRate: number;
}

export interface TokenUsage {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  callCount: number;
}

export interface ErrorMetrics {
  /** Total errors recorded, keyed by "endpoint:statusCode" */
  byEndpoint: Record<string, number>;
  /** Total errors recorded, keyed by HTTP status class ("4xx" | "5xx") */
  byStatusClass: { "4xx": number; "5xx": number };
  /** Total errors recorded, keyed by application error code */
  byErrorCode: Record<string, number>;
  /** Average recovery time in ms per endpoint (only populated after recovery events) */
  recoveryTimeMs: Record<string, number>;
  /** Current circuit breaker states, keyed by service name */
  circuitBreakerStates: Record<string, "closed" | "open" | "half-open">;
}

export interface MetricsSnapshot {
  timestamp: string;
  uptime: number;
  llm: {
    latency: Record<string, LatencyBucket>;
    counters: Record<string, MetricCounter>;
    tokenUsage: Record<string, TokenUsage>;
  };
  api: {
    latency: Record<string, LatencyBucket>;
    counters: Record<string, MetricCounter>;
  };
  cache: {
    hits: number;
    misses: number;
    hitRate: number;
  };
  dedup: {
    savedCalls: number;
    inFlightCount: number;
  };
  errors: ErrorMetrics;
}

// ─── Constants ─────────────────────────────────────────────────────────────

/** Maximum latency samples kept per metric (for percentile calculation) */
const MAX_SAMPLES = 500;

/** How often to flush a metrics summary to the log (ms) */
const FLUSH_INTERVAL_MS = 5 * 60_000; // 5 minutes

// ─── Helpers ───────────────────────────────────────────────────────────────

function createLatencyBucket(): LatencyBucket {
  return { count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, samples: [] };
}

function createCounter(): MetricCounter {
  return { total: 0, success: 0, error: 0, errorRate: 0 };
}

function createTokenUsage(): TokenUsage {
  return { totalTokens: 0, promptTokens: 0, completionTokens: 0, callCount: 0 };
}

function recordLatency(bucket: LatencyBucket, ms: number): void {
  bucket.count++;
  bucket.totalMs += ms;
  if (ms < bucket.minMs) bucket.minMs = ms;
  if (ms > bucket.maxMs) bucket.maxMs = ms;

  // Keep a capped sorted sample array for percentile calculation
  if (bucket.samples.length < MAX_SAMPLES) {
    bucket.samples.push(ms);
    bucket.samples.sort((a, b) => a - b);
  } else {
    // Replace a random sample to maintain statistical validity
    const idx = Math.floor(Math.random() * MAX_SAMPLES);
    bucket.samples[idx] = ms;
    bucket.samples.sort((a, b) => a - b);
  }
}

function recordCounter(counter: MetricCounter, success: boolean): void {
  counter.total++;
  if (success) {
    counter.success++;
  } else {
    counter.error++;
  }
  counter.errorRate =
    counter.total === 0
      ? 0
      : Math.round((counter.error / counter.total) * 10_000) / 100;
}

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const idx = Math.ceil((p / 100) * samples.length) - 1;
  return samples[Math.max(0, Math.min(idx, samples.length - 1))];
}

// ─── Metrics Service ───────────────────────────────────────────────────────

class MetricsService {
  private readonly startedAt = Date.now();

  // LLM metrics — keyed by "model" or "engine"
  private readonly llmLatency = new Map<string, LatencyBucket>();
  private readonly llmCounters = new Map<string, MetricCounter>();
  private readonly llmTokens = new Map<string, TokenUsage>();

  // API endpoint metrics — keyed by "METHOD /path"
  private readonly apiLatency = new Map<string, LatencyBucket>();
  private readonly apiCounters = new Map<string, MetricCounter>();

  // Lightweight cache/dedup stats (updated externally via recordCacheHit etc.)
  private cacheHits = 0;
  private cacheMisses = 0;
  private dedupSavedCalls = 0;
  private dedupInFlight = 0;

  // ── Error tracking ────────────────────────────────────────────────────────
  private readonly errorsByEndpoint = new Map<string, number>();
  private readonly errorsByStatusClass = { "4xx": 0, "5xx": 0 };
  private readonly errorsByCode = new Map<string, number>();
  /** Accumulated recovery time samples per endpoint for averaging */
  private readonly recoveryTimeSamples = new Map<string, number[]>();
  /** Current circuit breaker states reported by CircuitBreaker instances */
  private readonly circuitBreakerStates = new Map<
    string,
    "closed" | "open" | "half-open"
  >();

  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startFlushTimer();
  }

  // ── Timer API ────────────────────────────────────────────────────────────

  /**
   * Start a latency timer for an LLM call.
   * @param label  Metric label, e.g. "gemini" or "gemini:gemini-2.5-flash"
   */
  startLlmTimer(label: string): TimerHandle {
    const startMs = Date.now();
    return {
      end: (meta?: TimerMeta) => {
        const durationMs = Date.now() - startMs;
        this.recordLlmSuccess(label, durationMs, meta);
      },
      error: (err?: unknown, meta?: TimerMeta) => {
        const durationMs = Date.now() - startMs;
        this.recordLlmError(label, durationMs, err, meta);
      },
    };
  }

  /**
   * Start a latency timer for an API endpoint.
   * @param label  e.g. "POST /api/trpc/chat.send"
   */
  startApiTimer(label: string): TimerHandle {
    const startMs = Date.now();
    return {
      end: (meta?: TimerMeta) => {
        const durationMs = Date.now() - startMs;
        this.recordApiSuccess(label, durationMs, meta);
      },
      error: (err?: unknown, meta?: TimerMeta) => {
        const durationMs = Date.now() - startMs;
        this.recordApiError(label, durationMs, err, meta);
      },
    };
  }

  // ── LLM Recording ────────────────────────────────────────────────────────

  recordLlmSuccess(label: string, durationMs: number, meta?: TimerMeta): void {
    if (!this.llmLatency.has(label)) this.llmLatency.set(label, createLatencyBucket());
    if (!this.llmCounters.has(label)) this.llmCounters.set(label, createCounter());

    recordLatency(this.llmLatency.get(label)!, durationMs);
    recordCounter(this.llmCounters.get(label)!, true);

    // Token usage
    if (meta?.tokens && meta.model) {
      const tokenKey = meta.model as string;
      if (!this.llmTokens.has(tokenKey)) this.llmTokens.set(tokenKey, createTokenUsage());
      const usage = this.llmTokens.get(tokenKey)!;
      usage.totalTokens += meta.tokens as number;
      usage.callCount++;
    }
  }

  recordLlmError(label: string, durationMs: number, err?: unknown, meta?: TimerMeta): void {
    if (!this.llmLatency.has(label)) this.llmLatency.set(label, createLatencyBucket());
    if (!this.llmCounters.has(label)) this.llmCounters.set(label, createCounter());

    recordLatency(this.llmLatency.get(label)!, durationMs);
    recordCounter(this.llmCounters.get(label)!, false);

    logger.debug("[Metrics] LLM error recorded", {
      label,
      durationMs,
      err: err instanceof Error ? err.message : String(err),
      meta,
    });
  }

  // ── API Recording ────────────────────────────────────────────────────────

  recordApiSuccess(label: string, durationMs: number, _meta?: TimerMeta): void {
    if (!this.apiLatency.has(label)) this.apiLatency.set(label, createLatencyBucket());
    if (!this.apiCounters.has(label)) this.apiCounters.set(label, createCounter());

    recordLatency(this.apiLatency.get(label)!, durationMs);
    recordCounter(this.apiCounters.get(label)!, true);
  }

  recordApiError(label: string, durationMs: number, _err?: unknown, _meta?: TimerMeta): void {
    if (!this.apiLatency.has(label)) this.apiLatency.set(label, createLatencyBucket());
    if (!this.apiCounters.has(label)) this.apiCounters.set(label, createCounter());

    recordLatency(this.apiLatency.get(label)!, durationMs);
    recordCounter(this.apiCounters.get(label)!, false);
  }

  // ── Cache / Dedup Counters ────────────────────────────────────────────────

  recordCacheHit(): void { this.cacheHits++; }
  recordCacheMiss(): void { this.cacheMisses++; }
  recordDedupSaved(): void { this.dedupSavedCalls++; }
  setDedupInFlight(count: number): void { this.dedupInFlight = count; }

  // ── Error Metrics ─────────────────────────────────────────────────────────

  /**
   * Record an error occurrence for a given endpoint and HTTP status code.
   * Also accepts an optional application-level error code for finer grouping.
   *
   * @param endpoint   e.g. "news.list" or "POST /api/proxy-download"
   * @param statusCode HTTP status code (4xx / 5xx)
   * @param errorCode  Optional application error code, e.g. "DB_UNAVAILABLE"
   */
  recordError(
    endpoint: string,
    statusCode: number,
    errorCode?: string
  ): void {
    const key = `${endpoint}:${statusCode}`;
    this.errorsByEndpoint.set(key, (this.errorsByEndpoint.get(key) ?? 0) + 1);

    if (statusCode >= 400 && statusCode < 500) {
      this.errorsByStatusClass["4xx"]++;
    } else if (statusCode >= 500) {
      this.errorsByStatusClass["5xx"]++;
    }

    if (errorCode) {
      this.errorsByCode.set(
        errorCode,
        (this.errorsByCode.get(errorCode) ?? 0) + 1
      );
    }
  }

  /**
   * Record how long it took to recover from an error on a given endpoint.
   * Used to compute mean-time-to-recovery (MTTR) per endpoint.
   *
   * @param endpoint       e.g. "news.list"
   * @param recoveryTimeMs Wall-clock ms from first failure to successful retry
   */
  recordErrorRecovery(endpoint: string, recoveryTimeMs: number): void {
    const samples = this.recoveryTimeSamples.get(endpoint) ?? [];
    samples.push(recoveryTimeMs);
    // Cap at 100 samples per endpoint to bound memory usage
    if (samples.length > 100) samples.shift();
    this.recoveryTimeSamples.set(endpoint, samples);
  }

  /**
   * Update the current state of a circuit breaker for a named service.
   * Called by CircuitBreaker instances on every state transition.
   *
   * @param service External service name, e.g. "fal.ai" or "elevenlabs"
   * @param state   Current circuit breaker state
   */
  recordCircuitBreakerState(
    service: string,
    state: "closed" | "open" | "half-open"
  ): void {
    this.circuitBreakerStates.set(service, state);
  }

  /**
   * Return a snapshot of all error-specific metrics.
   */
  getErrorMetrics(): ErrorMetrics {
    const recoveryTimeMs: Record<string, number> = {};
    for (const [endpoint, samples] of Array.from(
      this.recoveryTimeSamples.entries()
    )) {
      if (samples.length === 0) continue;
      recoveryTimeMs[endpoint] =
        Math.round(
          samples.reduce((sum, v) => sum + v, 0) / samples.length
        );
    }

    const circuitBreakerStatesObj: Record<
      string,
      "closed" | "open" | "half-open"
    > = {};
    for (const [service, state] of Array.from(
      this.circuitBreakerStates.entries()
    )) {
      circuitBreakerStatesObj[service] = state;
    }

    const byEndpointObj: Record<string, number> = {};
    for (const [key, count] of Array.from(this.errorsByEndpoint.entries())) {
      byEndpointObj[key] = count;
    }

    const byErrorCodeObj: Record<string, number> = {};
    for (const [code, count] of Array.from(this.errorsByCode.entries())) {
      byErrorCodeObj[code] = count;
    }

    return {
      byEndpoint: byEndpointObj,
      byStatusClass: { ...this.errorsByStatusClass },
      byErrorCode: byErrorCodeObj,
      recoveryTimeMs,
      circuitBreakerStates: circuitBreakerStatesObj,
    };
  }

  // ── Snapshot ─────────────────────────────────────────────────────────────

  /**
   * Return a full metrics snapshot suitable for a health/metrics endpoint.
   * Includes p50/p95/p99 latency percentiles for each tracked label.
   */
  getSnapshot(): MetricsSnapshot & {
    llm: {
      latency: Record<string, LatencyBucket & { p50: number; p95: number; p99: number; avgMs: number }>;
      counters: Record<string, MetricCounter>;
      tokenUsage: Record<string, TokenUsage>;
    };
    api: {
      latency: Record<string, LatencyBucket & { p50: number; p95: number; p99: number; avgMs: number }>;
      counters: Record<string, MetricCounter>;
    };
  } {
    const enrichLatency = (map: Map<string, LatencyBucket>) => {
      const out: Record<string, LatencyBucket & { p50: number; p95: number; p99: number; avgMs: number }> = {};
      for (const [key, bucket] of Array.from(map.entries())) {
        out[key] = {
          ...bucket,
          p50: percentile(bucket.samples, 50),
          p95: percentile(bucket.samples, 95),
          p99: percentile(bucket.samples, 99),
          avgMs: bucket.count === 0 ? 0 : Math.round(bucket.totalMs / bucket.count),
        };
      }
      return out;
    };

    const mapToObj = <V>(map: Map<string, V>): Record<string, V> => {
      const out: Record<string, V> = {};
      for (const [k, v] of Array.from(map.entries())) out[k] = v;
      return out;
    };

    const cacheTotal = this.cacheHits + this.cacheMisses;

    return {
      timestamp: new Date().toISOString(),
      uptime: Math.round((Date.now() - this.startedAt) / 1_000),
      llm: {
        latency: enrichLatency(this.llmLatency),
        counters: mapToObj(this.llmCounters),
        tokenUsage: mapToObj(this.llmTokens),
      },
      api: {
        latency: enrichLatency(this.apiLatency),
        counters: mapToObj(this.apiCounters),
      },
      cache: {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: cacheTotal === 0 ? 0 : Math.round((this.cacheHits / cacheTotal) * 10_000) / 100,
      },
      dedup: {
        savedCalls: this.dedupSavedCalls,
        inFlightCount: this.dedupInFlight,
      },
      errors: this.getErrorMetrics(),
    };
  }

  // ── Flush / Shutdown ─────────────────────────────────────────────────────

  private flushToLog(): void {
    const snap = this.getSnapshot();
    const llmLabels = Object.keys(snap.llm.counters);
    if (llmLabels.length === 0) return;

    logger.info("[Metrics] Periodic flush", {
      uptime: snap.uptime,
      llmLabels: llmLabels.map(label => ({
        label,
        calls: snap.llm.counters[label]?.total ?? 0,
        errorRate: snap.llm.counters[label]?.errorRate ?? 0,
        p95Ms: snap.llm.latency[label]?.p95 ?? 0,
      })),
      cacheHitRate: snap.cache.hitRate,
      dedupSaved: snap.dedup.savedCalls,
    });
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => this.flushToLog(), FLUSH_INTERVAL_MS);
    if (this.flushTimer.unref) this.flushTimer.unref();
  }

  /** Stop background flush timer (call during graceful shutdown). */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

// ─── Singleton Export ──────────────────────────────────────────────────────

export const metrics = new MetricsService();

export { MetricsService };
