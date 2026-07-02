/**
 * providerHealthProbeJob.ts — AI Provider Key Health Probe (AIDV-518)
 *
 * Runs every 10 minutes. Probes each configured AI provider with a lightweight
 * request. On 2+ consecutive failures writes to orb_system_alerts. Auto-resolves
 * on recovery. Exposes getProviderProbeStatus() for GET /api/provider-health.
 */

import * as cron from "node-cron";
import { serverEnv } from "../_core/env.validated.js";
import { getDb } from "../db.js";
import { orbSystemAlerts } from "../../drizzle/schema.js";
import { eq, and, isNull } from "drizzle-orm";
import { setProviderHealth, markProviderRecovered } from "../services/providerHealth.js";
import { assertSafeExternalUrl } from "../_core/ssrfGuard.js";

// ─── Provider Probe Config ───────────────────────────────────────────────────

interface ProbeConfig {
  url: string;
  method: "GET" | "HEAD";
  headers: () => Record<string, string>;
  /** If true, skip probe when key is not configured (don't alert for missing keys) */
  requiresKey: boolean;
  hasKey: () => boolean;
  /** 'generation' = user-facing AI provider; 'infra' = internal health check (supabase_auth etc.) */
  kind: "generation" | "infra";
}

const PROBE_CONFIG: Record<string, ProbeConfig> = {
  fal: {
    url: "https://queue.fal.run/fal-ai/flux/requests",
    method: "GET",
    headers: () => {
      const h: Record<string, string> = {};
      if (serverEnv.FAL_API_KEY) h.Authorization = `Key ${serverEnv.FAL_API_KEY}`;
      return h;
    },
    requiresKey: true,
    hasKey: () => Boolean(serverEnv.FAL_API_KEY),
    kind: "generation",
  },
  elevenlabs: {
    url: "https://api.elevenlabs.io/v1/user",
    method: "GET",
    headers: () => {
      const h: Record<string, string> = {};
      if (serverEnv.ELEVENLABS_API_KEY) h["xi-api-key"] = serverEnv.ELEVENLABS_API_KEY;
      return h;
    },
    requiresKey: true,
    hasKey: () => Boolean(serverEnv.ELEVENLABS_API_KEY),
    kind: "generation",
  },
  replicate: {
    url: "https://api.replicate.com/v1/models",
    method: "GET",
    headers: () => {
      const h: Record<string, string> = {};
      if (serverEnv.REPLICATE_API_TOKEN) h.Authorization = `Bearer ${serverEnv.REPLICATE_API_TOKEN}`;
      return h;
    },
    requiresKey: true,
    hasKey: () => Boolean(serverEnv.REPLICATE_API_TOKEN),
    kind: "generation",
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    method: "GET",
    headers: () => {
      const h: Record<string, string> = {};
      if (serverEnv.ANTHROPIC_API_KEY) {
        h["x-api-key"] = serverEnv.ANTHROPIC_API_KEY;
        h["anthropic-version"] = "2023-06-01";
      }
      return h;
    },
    requiresKey: true,
    hasKey: () => Boolean(serverEnv.ANTHROPIC_API_KEY),
    kind: "generation",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    method: "GET",
    headers: () => ({} as Record<string, string>),
    requiresKey: false,
    hasKey: () => true,
    kind: "generation",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/models",
    method: "GET",
    headers: () => {
      const h: Record<string, string> = {};
      if (serverEnv.OPENROUTER_API_KEY) h.Authorization = `Bearer ${serverEnv.OPENROUTER_API_KEY}`;
      return h;
    },
    requiresKey: true,
    hasKey: () => Boolean(serverEnv.OPENROUTER_API_KEY),
    kind: "generation",
  },
  supabase_auth: {
    url: `${serverEnv.SUPABASE_URL}/auth/v1/health`,
    method: "GET",
    headers: () => ({} as Record<string, string>),
    requiresKey: true,
    hasKey: () => Boolean(serverEnv.SUPABASE_URL),
    kind: "infra",
  },
};

const PROBE_TIMEOUT_MS = 8_000;
export const ALERT_THRESHOLD = 2; // consecutive failures before alert
const PROBE_INTERVAL_MINUTES = 10;

/** IDs of configured generation providers (hasKey = true at startup) used as down-denominator. */
export function getConfiguredGenerationProviderIds(): string[] {
  return Object.entries(PROBE_CONFIG)
    .filter(([, cfg]) => cfg.kind === "generation" && cfg.hasKey())
    .map(([id]) => id);
}

// ─── State ───────────────────────────────────────────────────────────────────

interface ProbeResult {
  providerId: string;
  ok: boolean;
  statusCode?: number;
  latencyMs: number;
  error?: string;
  consecutiveFailures: number;
  lastCheckedAt: number;
  alertWritten: boolean;
  kind: "generation" | "infra";
}

const probeState = new Map<string, ProbeResult>();
let cronTask: cron.ScheduledTask | null = null;
let isRunning = false;

export function getProviderProbeStatus(): ProbeResult[] {
  return [...probeState.values()];
}

// ─── Probe ───────────────────────────────────────────────────────────────────

/**
 * Maps a probe HTTP status to provider health (AIDV-886).
 *
 * Previously `res.status < 500` treated 401/403 as "healthy" (reachable), so an
 * expired ANTHROPIC_API_KEY / OPENAI_API_KEY silently kept the provider green
 * until a real generation request failed (masked the AIDV-871 prod incident).
 *
 * Rules:
 *  - 2xx → healthy.
 *  - 401/403 **only when we actually authenticate** (`requiresKey`) → unhealthy:
 *    we sent a key and the provider rejected it → key invalid/expired.
 *  - 5xx → unhealthy (provider server error).
 *  - everything else (429 rate-limit = key valid; 400/404/405 endpoint quirks;
 *    and 401/403 for *keyless* probes like gemini, whose `/v1beta/models` returns
 *    403 with no key in the request) → reachable, key not rejected → ok.
 *
 * The `requiresKey` guard is load-bearing: gemini probes with no Authorization
 * header, so its expected 403 must NOT be read as an auth failure (would
 * otherwise fire a false alert every 10-minute cycle).
 *
 * Exported for exhaustive unit testing.
 */
export function classifyProbeStatus(
  status: number,
  requiresKey: boolean
): { ok: boolean; error?: string } {
  if (status >= 200 && status < 300) return { ok: true };
  if (requiresKey && (status === 401 || status === 403)) {
    return {
      ok: false,
      error: `HTTP ${status} — provider rejected credentials (API key invalid or expired)`,
    };
  }
  if (status >= 500) return { ok: false };
  return { ok: true };
}

async function probeProvider(
  providerId: string,
  config: ProbeConfig
): Promise<{ ok: boolean; statusCode?: number; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    // AIDV-963: SSRF guard — block loopback/private/link-local/IMDS targets before
    // egress. Matters for dynamic URLs built from env (e.g. supabase_auth uses
    // `${SUPABASE_URL}/auth/v1/health`). Deliberately inside the try block: a
    // blocked URL throws SsrfBlockedError, lands in the catch below, and marks
    // THIS provider's probe as failed — same path as a fetch error — instead of
    // crashing the whole probe cycle. Follows the llmRouter/internalMedia
    // convention of relaxing loopback/http only outside production.
    assertSafeExternalUrl(config.url, process.env.NODE_ENV !== "production");
    const res = await fetch(config.url, {
      method: config.method,
      headers: config.headers(),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - start;
    const { ok, error } = classifyProbeStatus(res.status, config.requiresKey);
    return { ok, statusCode: res.status, latencyMs, error };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  }
}

// ─── DB Alert Write / Resolve ────────────────────────────────────────────────

async function writeProviderAlert(providerId: string, result: ProbeResult): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    // Dedup: only write if no unresolved alert exists for this provider
    const existing = await db
      .select({ id: orbSystemAlerts.id })
      .from(orbSystemAlerts)
      .where(
        and(
          eq(orbSystemAlerts.metricType, `provider_health:${providerId}`),
          eq(orbSystemAlerts.isResolved, false)
        )
      )
      .limit(1);

    if (existing.length > 0) return; // already alerted

    await db.insert(orbSystemAlerts).values({
      alertType: "health_critical",
      severity: "high",
      title: `AI provider ${providerId} failing (${result.consecutiveFailures} consecutive failures)`,
      message: [
        `Provider ${providerId} health probe failed ${result.consecutiveFailures} consecutive times.`,
        result.error ? `Last error: ${result.error}` : `HTTP status: ${result.statusCode ?? "no response"}`,
        `Last checked: ${new Date(result.lastCheckedAt).toISOString()}`,
        "Action: Check API key configuration, quota limits, and provider status page.",
      ].join("\n"),
      metricType: `provider_health:${providerId}`,
      metadata: {
        provider_name: providerId,
        failure_count: result.consecutiveFailures,
        last_error: result.error ?? null,
        last_status_code: result.statusCode ?? null,
        detected_at: new Date(result.lastCheckedAt).toISOString(),
      },
    });

    console.warn(`[ProviderHealthProbe] 🔴 Alert written for provider=${providerId}, failures=${result.consecutiveFailures}`);
  } catch (err) {
    console.warn("[ProviderHealthProbe] Failed to write alert:", err instanceof Error ? err.message : err);
  }
}

async function resolveProviderAlert(providerId: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const now = new Date();
    const updated = await db
      .update(orbSystemAlerts)
      .set({
        isResolved: true,
        resolvedAt: now,
        resolutionNotes: `Provider ${providerId} recovered automatically at ${now.toISOString()}`,
      })
      .where(
        and(
          eq(orbSystemAlerts.metricType, `provider_health:${providerId}`),
          eq(orbSystemAlerts.isResolved, false)
        )
      );

    if (updated[0]?.affectedRows > 0) {
      console.log(`[ProviderHealthProbe] ✅ Alert auto-resolved for provider=${providerId}`);
    }
  } catch (err) {
    console.warn("[ProviderHealthProbe] Failed to resolve alert:", err instanceof Error ? err.message : err);
  }
}

// ─── Probe Cycle ─────────────────────────────────────────────────────────────

async function runProbeCycle(): Promise<void> {
  if (isRunning) {
    console.log("[ProviderHealthProbe] ⏭️  Previous cycle still running, skipping.");
    return;
  }
  isRunning = true;

  const results: Array<{ providerId: string; ok: boolean; failures: number }> = [];

  try {
    for (const [providerId, config] of Object.entries(PROBE_CONFIG)) {
      // Skip providers without configured keys
      if (config.requiresKey && !config.hasKey()) continue;

      const probeResult = await probeProvider(providerId, config);
      const prev = probeState.get(providerId);
      const consecutiveFailures = probeResult.ok ? 0 : (prev?.consecutiveFailures ?? 0) + 1;
      const wasAlerting = prev?.alertWritten ?? false;

      const state: ProbeResult = {
        providerId,
        ok: probeResult.ok,
        statusCode: probeResult.statusCode,
        latencyMs: probeResult.latencyMs,
        error: probeResult.error,
        consecutiveFailures,
        lastCheckedAt: Date.now(),
        alertWritten: wasAlerting,
        kind: config.kind,
      };

      if (probeResult.ok) {
        // Recovery path
        if (!prev?.ok || wasAlerting) {
          await resolveProviderAlert(providerId);
          state.alertWritten = false;
        }
        // Bridge: update router health store so providerRouter can resume using this provider
        if (config.kind === "generation") {
          markProviderRecovered(providerId);
        }
      } else {
        // Failure path
        if (consecutiveFailures >= ALERT_THRESHOLD && !wasAlerting) {
          await writeProviderAlert(providerId, state);
          state.alertWritten = true;
        }
        // Bridge: mark provider degraded in router health store after threshold
        if (config.kind === "generation" && consecutiveFailures >= ALERT_THRESHOLD) {
          setProviderHealth(
            providerId,
            "degraded",
            `probe failed ${consecutiveFailures}× ${state.error ?? `HTTP ${state.statusCode ?? "none"}`}`
          );
        }
        console.warn(
          `[ProviderHealthProbe] ⚠️  provider=${providerId} consecutive_failures=${consecutiveFailures}` +
            (probeResult.error ? ` error=${probeResult.error}` : ` status=${probeResult.statusCode}`)
        );
      }

      probeState.set(providerId, state);
      results.push({ providerId, ok: probeResult.ok, failures: consecutiveFailures });
    }

    const healthy = results.filter(r => r.ok).length;
    const failing = results.filter(r => !r.ok).length;
    console.log(`[ProviderHealthProbe] ✅ Probe complete: ${healthy} healthy, ${failing} failing (${results.length} total)`);
  } finally {
    isRunning = false;
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export function initProviderHealthProbeCron(): void {
  if (cronTask) {
    console.warn("[ProviderHealthProbe] Cron already initialized, skipping.");
    return;
  }

  // Initial probe after 60s delay to let server finish startup
  setTimeout(() => {
    runProbeCycle().catch(err =>
      console.error("[ProviderHealthProbe] Initial probe error:", err)
    );
  }, 60_000);

  const cronExpr = `*/${PROBE_INTERVAL_MINUTES} * * * *`;
  cronTask = cron.schedule(cronExpr, () => {
    runProbeCycle().catch(err =>
      console.error("[ProviderHealthProbe] Cron error:", err)
    );
  });

  console.log(`[ProviderHealthProbe] ✅ Cron initialized (every ${PROBE_INTERVAL_MINUTES} min)`);
}

export function stopProviderHealthProbeCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log("[ProviderHealthProbe] 🛑 Cron stopped");
  }
}

export { runProbeCycle as _runProbeCycleForTest };
