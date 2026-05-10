/**
 * circuitBreaker.ts — Circuit Breaker pattern for external API calls
 *
 * Prevents cascading failures when an external service is unhealthy by
 * tracking consecutive failures and "opening" the circuit (fast-failing
 * all calls) until the service recovers.
 *
 * States:
 *   closed    — Normal operation. Calls pass through; failures are counted.
 *   open      — Service is unhealthy. All calls fail immediately without
 *               hitting the upstream. Transitions to half-open after the
 *               recovery window expires.
 *   half-open — One probe call is allowed through. Success → closed;
 *               failure → open again with a longer back-off.
 *
 * Usage:
 *   const cb = createCircuitBreaker("fal.ai", { failureThreshold: 5 });
 *   const result = await cb.execute(() => callFalApi(params));
 *
 * Design notes:
 *   - Zero external dependencies; all state is in-process.
 *   - Integrates with the metrics singleton to expose circuit state.
 *   - Integrates with the alerting singleton to fire alerts on open/close.
 */

import { AppError } from "./error_handler";
import { logger } from "./logger";
import { metrics } from "./metrics";
import { alerting } from "./alerting";

// ─── Types ─────────────────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /**
   * Number of consecutive failures required to open the circuit.
   * @default 5
   */
  failureThreshold?: number;
  /**
   * How long (ms) to keep the circuit open before allowing a probe.
   * @default 30_000 (30 seconds)
   */
  recoveryWindowMs?: number;
  /**
   * Maximum recovery window after repeated failures (exponential back-off cap).
   * @default 300_000 (5 minutes)
   */
  maxRecoveryWindowMs?: number;
  /**
   * Optional callback invoked on every state transition.
   */
  onStateChange?: (
    service: string,
    from: CircuitState,
    to: CircuitState
  ) => void;
}

export interface CircuitBreakerStats {
  service: string;
  state: CircuitState;
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  openedAt: number | null;
  nextProbeAt: number | null;
}

// ─── CircuitBreaker ────────────────────────────────────────────────────────

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastFailureAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private openedAt: number | null = null;
  /** How long the circuit will stay open on the next trip (grows with back-off) */
  private currentRecoveryWindowMs: number;

  private readonly failureThreshold: number;
  private readonly baseRecoveryWindowMs: number;
  private readonly maxRecoveryWindowMs: number;
  private readonly onStateChange?: CircuitBreakerOptions["onStateChange"];

  constructor(
    public readonly service: string,
    options: CircuitBreakerOptions = {}
  ) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.baseRecoveryWindowMs = options.recoveryWindowMs ?? 30_000;
    this.maxRecoveryWindowMs = options.maxRecoveryWindowMs ?? 300_000;
    this.currentRecoveryWindowMs = this.baseRecoveryWindowMs;
    this.onStateChange = options.onStateChange;

    // Register initial state with metrics
    metrics.recordCircuitBreakerState(service, "closed");
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Execute `fn` through the circuit breaker.
   *
   * - If the circuit is **open** and the recovery window has not elapsed,
   *   throws immediately without calling `fn`.
   * - If the circuit is **open** and the recovery window has elapsed,
   *   transitions to **half-open** and allows one probe call.
   * - If the circuit is **closed** or **half-open**, calls `fn` and records
   *   the outcome.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransitionToHalfOpen();

    if (this.state === "open") {
      const nextProbeAt = this.openedAt! + this.currentRecoveryWindowMs;
      throw new AppError({
        message: `Circuit breaker open for service "${this.service}". Next probe at ${new Date(nextProbeAt).toISOString()}.`,
        statusCode: 503,
        isOperational: true,
        errorCode: "CIRCUIT_BREAKER_OPEN",
      });
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  /** Current circuit state. */
  getState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  /** Full stats snapshot for health endpoints and logging. */
  getStats(): CircuitBreakerStats {
    this.maybeTransitionToHalfOpen();
    const nextProbeAt =
      this.state === "open" && this.openedAt !== null
        ? this.openedAt + this.currentRecoveryWindowMs
        : null;

    return {
      service: this.service,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      openedAt: this.openedAt,
      nextProbeAt,
    };
  }

  /**
   * Manually reset the circuit to closed state.
   * Useful for admin-triggered recovery or test teardown.
   */
  reset(): void {
    const prev = this.state;
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.currentRecoveryWindowMs = this.baseRecoveryWindowMs;
    this.notifyStateChange(prev, "closed");
    logger.info("[CircuitBreaker] Manually reset to closed", {
      service: this.service,
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private onSuccess(): void {
    this.totalSuccesses++;
    this.lastSuccessAt = Date.now();

    if (this.state === "half-open") {
      // Probe succeeded — close the circuit and reset back-off
      const prev = this.state;
      this.state = "closed";
      this.consecutiveFailures = 0;
      this.openedAt = null;
      this.currentRecoveryWindowMs = this.baseRecoveryWindowMs;
      this.notifyStateChange(prev, "closed");
      logger.info("[CircuitBreaker] Probe succeeded — circuit closed", {
        service: this.service,
        totalSuccesses: this.totalSuccesses,
      });
    } else {
      // Normal success in closed state — reset consecutive failure counter
      this.consecutiveFailures = 0;
    }
  }

  private onFailure(err: unknown): void {
    this.totalFailures++;
    this.consecutiveFailures++;
    this.lastFailureAt = Date.now();

    const errMsg = err instanceof Error ? err.message : String(err);

    if (this.state === "half-open") {
      // Probe failed — re-open with exponential back-off
      const prev = this.state;
      this.currentRecoveryWindowMs = Math.min(
        this.currentRecoveryWindowMs * 2,
        this.maxRecoveryWindowMs
      );
      this.state = "open";
      this.openedAt = Date.now();
      this.notifyStateChange(prev, "open");
      logger.warn("[CircuitBreaker] Probe failed — circuit re-opened", {
        service: this.service,
        nextRecoveryWindowMs: this.currentRecoveryWindowMs,
        err: errMsg,
      });
      return;
    }

    if (
      this.state === "closed" &&
      this.consecutiveFailures >= this.failureThreshold
    ) {
      const prev = this.state;
      this.state = "open";
      this.openedAt = Date.now();
      this.notifyStateChange(prev, "open");
      logger.error("[CircuitBreaker] Failure threshold reached — circuit opened", {
        service: this.service,
        consecutiveFailures: this.consecutiveFailures,
        failureThreshold: this.failureThreshold,
        recoveryWindowMs: this.currentRecoveryWindowMs,
        err: errMsg,
      });
    }
  }

  private maybeTransitionToHalfOpen(): void {
    if (
      this.state === "open" &&
      this.openedAt !== null &&
      Date.now() >= this.openedAt + this.currentRecoveryWindowMs
    ) {
      const prev = this.state;
      this.state = "half-open";
      this.notifyStateChange(prev, "half-open");
      logger.info(
        "[CircuitBreaker] Recovery window elapsed — transitioning to half-open",
        {
          service: this.service,
          openedAt: new Date(this.openedAt).toISOString(),
        }
      );
    }
  }

  private notifyStateChange(from: CircuitState, to: CircuitState): void {
    if (from === to) return;
    metrics.recordCircuitBreakerState(this.service, to);
    this.onStateChange?.(this.service, from, to);

    // Auto-alert when the circuit opens
    if (to === "open") {
      alerting.alertOnCircuitBreakerOpen(this.service);
    }
  }
}

// ─── Factory & Registry ────────────────────────────────────────────────────

const registry = new Map<string, CircuitBreaker>();

/**
 * Create (or retrieve a cached) CircuitBreaker for a named external service.
 *
 * Calling `createCircuitBreaker` with the same `service` name twice returns
 * the same instance, so circuit state is shared across all callers.
 *
 * @param service  Human-readable service name, e.g. "fal.ai" or "elevenlabs"
 * @param options  Optional configuration overrides
 */
export function createCircuitBreaker(
  service: string,
  options: CircuitBreakerOptions = {}
): CircuitBreaker {
  if (registry.has(service)) {
    return registry.get(service)!;
  }
  const cb = new CircuitBreaker(service, options);
  registry.set(service, cb);
  return cb;
}

/**
 * Return all registered circuit breakers (for health endpoints).
 */
export function getAllCircuitBreakers(): CircuitBreaker[] {
  return Array.from(registry.values());
}

/**
 * Reset all circuit breakers (useful in tests or after a deployment).
 */
export function resetAllCircuitBreakers(): void {
  for (const cb of registry.values()) {
    cb.reset();
  }
}
