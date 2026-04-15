/**
 * Circuit Breaker — Resilience pattern for background jobs.
 *
 * States:
 *   CLOSED  → Normal operation. Failures increment the counter.
 *   OPEN    → Too many failures. All calls are rejected for a cooldown period.
 *   HALF_OPEN → After cooldown, allows one probe call. Success → CLOSED, Failure → OPEN.
 *
 * Usage:
 *   const breaker = new CircuitBreaker("NewsAPI", { failureThreshold: 3, cooldownMs: 5 * 60_000 });
 *   if (!breaker.canExecute()) { log("circuit open, skipping"); return; }
 *   try { await doWork(); breaker.recordSuccess(); }
 *   catch (e) { breaker.recordFailure(); throw e; }
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 3 */
  failureThreshold?: number;
  /** Time in ms to keep the circuit open before transitioning to HALF_OPEN. Default: 5 minutes */
  cooldownMs?: number;
}

export class CircuitBreaker {
  readonly name: string;
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(name: string, opts: CircuitBreakerOptions = {}) {
    this.name = name;
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 5 * 60_000;
  }

  /** Returns true if the caller may proceed. Transitions OPEN → HALF_OPEN after cooldown. */
  canExecute(): boolean {
    if (this.state === "CLOSED") return true;

    if (this.state === "OPEN") {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.cooldownMs) {
        this.state = "HALF_OPEN";
        console.info(
          `[CircuitBreaker:${this.name}] Transitioning to HALF_OPEN (cooldown elapsed).`
        );
        return true; // allow one probe
      }
      return false;
    }

    // HALF_OPEN — allow probe
    return true;
  }

  /** Record a successful operation. Resets the breaker to CLOSED. */
  recordSuccess(): void {
    if (this.state !== "CLOSED") {
      console.info(
        `[CircuitBreaker:${this.name}] Success recorded. Resetting to CLOSED.`
      );
    }
    this.consecutiveFailures = 0;
    this.state = "CLOSED";
  }

  /** Record a failure. May transition to OPEN if threshold is exceeded. */
  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (
      this.consecutiveFailures >= this.failureThreshold ||
      this.state === "HALF_OPEN"
    ) {
      this.state = "OPEN";
      console.warn(
        `[CircuitBreaker:${this.name}] OPEN after ${this.consecutiveFailures} consecutive failures. ` +
          `Will retry in ${(this.cooldownMs / 1000).toFixed(0)}s.`
      );
    }
  }

  /** Current state (for health-check / logging). */
  getState(): CircuitState {
    return this.state;
  }
}
