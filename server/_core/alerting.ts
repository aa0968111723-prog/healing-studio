/**
 * alerting.ts — In-process alerting for critical error conditions
 *
 * Provides threshold-based alerting without requiring an external APM tool.
 * Alerts are emitted as structured log entries at "error" level and can be
 * forwarded to external channels (Slack, PagerDuty, etc.) by attaching a
 * custom `AlertHandler`.
 *
 * Built-in alert types:
 *   - High error rate on an endpoint (errors / total > threshold)
 *   - Circuit breaker opened for an external service
 *   - External service marked as down
 *   - Slow response time on an endpoint (p95 > threshold)
 *
 * Usage:
 *   import { alerting } from "./_core/alerting";
 *
 *   // Register a custom handler (e.g. post to Slack)
 *   alerting.addHandler(async (alert) => {
 *     await postToSlack(alert);
 *   });
 *
 *   // Fire an alert manually
 *   alerting.alertOnCircuitBreakerOpen("fal.ai");
 *
 * Design notes:
 *   - Alerts are de-duplicated: the same alert key will not fire more than
 *     once per `cooldownMs` window (default 5 minutes) to prevent floods.
 *   - All built-in checks are synchronous and zero-dependency.
 *   - Handlers are called asynchronously; handler errors are swallowed and
 *     logged so they never affect the hot path.
 */

import { logger } from "./logger";
import { metrics } from "./metrics";

// ─── Types ─────────────────────────────────────────────────────────────────

export type AlertSeverity = "critical" | "error" | "warn";

export interface Alert {
  /** Unique key used for de-duplication (e.g. "high-error-rate:news.list") */
  key: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  /** ISO timestamp when the alert was fired */
  firedAt: string;
  /** Arbitrary metadata for downstream handlers */
  metadata: Record<string, unknown>;
}

export type AlertHandler = (alert: Alert) => Promise<void>;

// ─── AlertingService ───────────────────────────────────────────────────────

class AlertingService {
  private readonly handlers: AlertHandler[] = [];
  /** Tracks the last time each alert key was fired (for cooldown) */
  private readonly lastFiredAt = new Map<string, number>();
  /** Default cooldown between repeated alerts for the same key (ms) */
  private readonly defaultCooldownMs = 5 * 60_000; // 5 minutes

  // ── Handler registration ──────────────────────────────────────────────────

  /**
   * Register a custom alert handler.
   * Handlers are called in registration order; errors are caught and logged.
   */
  addHandler(handler: AlertHandler): void {
    this.handlers.push(handler);
  }

  // ── Built-in alert checks ─────────────────────────────────────────────────

  /**
   * Fire an alert if the error rate for `endpoint` exceeds `threshold` (0–1).
   *
   * Reads live data from the metrics singleton so no extra bookkeeping is
   * needed at the call site.
   *
   * @param endpoint  e.g. "news.list" or "POST /api/proxy-download"
   * @param threshold Error rate fraction (0–1). Default: 0.1 (10 %)
   */
  alertOnHighErrorRate(endpoint: string, threshold = 0.1): void {
    const snap = metrics.getSnapshot();
    const counter = snap.api.counters[endpoint];
    if (!counter || counter.total === 0) return;

    const rate = counter.error / counter.total;
    if (rate < threshold) return;

    this.fire({
      key: `high-error-rate:${endpoint}`,
      severity: "error",
      title: "High error rate detected",
      message: `Endpoint "${endpoint}" has an error rate of ${(rate * 100).toFixed(1)}% (threshold: ${(threshold * 100).toFixed(1)}%).`,
      metadata: {
        endpoint,
        errorRate: rate,
        threshold,
        totalRequests: counter.total,
        totalErrors: counter.error,
      },
    });
  }

  /**
   * Fire an alert when a circuit breaker transitions to the open state.
   *
   * @param service  External service name, e.g. "fal.ai"
   */
  alertOnCircuitBreakerOpen(service: string): void {
    this.fire({
      key: `circuit-breaker-open:${service}`,
      severity: "critical",
      title: "Circuit breaker opened",
      message: `The circuit breaker for external service "${service}" has opened. All calls to this service are being fast-failed until the recovery window elapses.`,
      metadata: { service },
    });
  }

  /**
   * Fire an alert when an external service is detected as down.
   *
   * @param service  External service name, e.g. "elevenlabs"
   * @param reason   Optional human-readable reason
   */
  alertOnServiceDown(service: string, reason?: string): void {
    this.fire({
      key: `service-down:${service}`,
      severity: "critical",
      title: "External service unavailable",
      message: reason
        ? `External service "${service}" is unavailable: ${reason}`
        : `External service "${service}" is unavailable.`,
      metadata: { service, reason: reason ?? null },
    });
  }

  /**
   * Fire an alert if the p95 latency for `endpoint` exceeds `thresholdMs`.
   *
   * Reads live data from the metrics singleton.
   *
   * @param endpoint    e.g. "POST /api/trpc/imageStudio.generate"
   * @param thresholdMs Latency threshold in ms. Default: 5000 (5 s)
   */
  alertOnSlowResponse(endpoint: string, thresholdMs = 5_000): void {
    const snap = metrics.getSnapshot();
    const latency = snap.api.latency[endpoint];
    if (!latency) return;

    const p95 = latency.p95;
    if (p95 < thresholdMs) return;

    this.fire({
      key: `slow-response:${endpoint}`,
      severity: "warn",
      title: "Slow response time detected",
      message: `Endpoint "${endpoint}" p95 latency is ${p95}ms (threshold: ${thresholdMs}ms).`,
      metadata: { endpoint, p95Ms: p95, thresholdMs },
    });
  }

  /**
   * Fire a custom alert directly.
   * Useful for one-off critical conditions not covered by the built-in checks.
   */
  fire(
    alert: Omit<Alert, "firedAt">,
    cooldownMs = this.defaultCooldownMs
  ): void {
    const now = Date.now();
    const lastFired = this.lastFiredAt.get(alert.key) ?? 0;

    if (now - lastFired < cooldownMs) {
      // Still within cooldown window — suppress duplicate
      return;
    }

    this.lastFiredAt.set(alert.key, now);

    const fullAlert: Alert = {
      ...alert,
      firedAt: new Date(now).toISOString(),
    };

    // Always emit a structured log entry regardless of handlers
    const logFn =
      alert.severity === "critical" || alert.severity === "error"
        ? logger.error
        : logger.warn;

    logFn(`[Alert] ${fullAlert.title}`, {
      alertKey: fullAlert.key,
      severity: fullAlert.severity,
      message: fullAlert.message,
      metadata: fullAlert.metadata,
    });

    // Dispatch to registered handlers asynchronously
    for (const handler of this.handlers) {
      Promise.resolve()
        .then(() => handler(fullAlert))
        .catch(handlerErr => {
          logger.error("[Alert] Handler threw an error", {
            alertKey: fullAlert.key,
            err: handlerErr,
          });
        });
    }
  }

  /**
   * Clear the cooldown for a specific alert key.
   * Useful in tests or after a manual acknowledgement.
   */
  clearCooldown(key: string): void {
    this.lastFiredAt.delete(key);
  }

  /**
   * Clear all cooldowns (useful in tests).
   */
  clearAllCooldowns(): void {
    this.lastFiredAt.clear();
  }
}

// ─── Singleton Export ──────────────────────────────────────────────────────

export const alerting = new AlertingService();

export { AlertingService };
