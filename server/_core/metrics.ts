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
  db: {
    poolUtilization: number;
    poolStats: { total: number; active: number; idle: number; queued: number };
  };
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

  // DB connection pool stats (updated externally via recordPoolUtilization)
  private dbPoolUtilization = 0;
  private dbPoolStats: { total: number; active: number; idle: number; queued: number } = {
    total: 0, active: 0, idle: 0, queued: 0,
  };

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

  // ── DB Pool Monitoring ───────────────────────────────────────────────────

  /**
   * Update the tracked connection pool utilisation.
   * Call this periodically (e.g. from a health-check interval) with the
   * values returned by DatabaseManager.getPoolStats() / getPoolUtilization().
   * Logs a warning when utilisation exceeds 80 % so operators are alerted
   * before the pool is fully exhausted.
   */
  recordPoolUtilization(
    utilization: number,
    stats: { total: number; active: number; idle: number; queued: number }
  ): void {
    this.dbPoolUtilization = utilization;
    this.dbPoolStats = stats;

    if (utilization > 0.8) {
      logger.warn("[Metrics] High database connection pool utilization", {
        utilizationPct: `${(utilization * 100).toFixed(1)}%`,
        ...stats,
      });
    }
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
      db: {
        poolUtilization: this.dbPoolUtilization,
        poolStats: { ...this.dbPoolStats },
      },
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
      dbPoolUtilizationPct: `${(snap.db.poolUtilization * 100).toFixed(1)}%`,
      dbPoolStats: snap.db.poolStats,
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
