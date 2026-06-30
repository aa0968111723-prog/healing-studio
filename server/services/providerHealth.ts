export type ProviderHealthStatus =
  | "healthy"
  | "degraded"
  | "disabled"
  | "missing_key"
  | "rate_limited"
  | "timeout"
  | "unknown_error";

export interface ProviderHealthSnapshot {
  providerId: string;
  status: ProviderHealthStatus;
  reason?: string;
  updatedAt: number;
}

const healthStore = new Map<string, ProviderHealthSnapshot>();
export let ELEVENLABS_AVAILABLE = true;

/**
 * 寫入版本計數器：每次 setProviderHealth 都 +1。供 brainPipeline 等彙整層
 * 判斷自上次快取以來有沒有變化，達成寫入即失效（不必等 TTL）。
 */
let healthVersion = 0;
export function getProviderHealthVersion(): number {
  return healthVersion;
}

function now() {
  return Date.now();
}

function redactReason(reason?: string): string | undefined {
  if (!reason) return undefined;
  return reason
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/sk-[a-z0-9]{8,}/gi, "sk-[REDACTED]")
    .slice(0, 280);
}

export function getProviderHealth(providerId: string): ProviderHealthSnapshot {
  return (
    healthStore.get(providerId) ?? {
      providerId,
      status: "healthy",
      updatedAt: now(),
    }
  );
}

export function setProviderHealth(providerId: string, status: ProviderHealthStatus, reason?: string): ProviderHealthSnapshot {
  const snapshot: ProviderHealthSnapshot = {
    providerId,
    status,
    reason: redactReason(reason),
    updatedAt: now(),
  };
  healthStore.set(providerId, snapshot);
  healthVersion++;
  return snapshot;
}

export function markProviderRecovered(providerId: string) {
  const current = getProviderHealth(providerId);
  if (current.status !== "healthy") {
    setProviderHealth(providerId, "healthy", "provider recovered");
    return true;
  }
  return false;
}

export function markProviderFailure(providerId: string, err: unknown): ProviderHealthSnapshot {
  const msg = err instanceof Error ? err.message : String(err ?? "unknown error");
  const lower = msg.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return setProviderHealth(providerId, "degraded", "timeout");
  }
  if (lower.includes("429") || lower.includes("rate") || lower.includes("quota")) {
    return setProviderHealth(providerId, "rate_limited", "rate limit");
  }
  return setProviderHealth(providerId, "unknown_error", msg);
}

export function __unsafe_resetProviderHealthForTests() {
  healthStore.clear();
  healthVersion++;
  ELEVENLABS_AVAILABLE = true;
}

export function setElevenLabsAvailability(available: boolean): void {
  ELEVENLABS_AVAILABLE = available;
}

export async function checkElevenLabsHealth(): Promise<boolean> {
  try {
    // AIDV: hard 5s timeout. Node's global fetch has NO default timeout, so a
    // slow/unreachable ElevenLabs endpoint would otherwise hang this await
    // indefinitely. Because startup awaits this BEFORE server.listen(), an
    // unbounded hang here blocks the HTTP server from ever binding the port,
    // so Railway's /api/health healthcheck never gets a response and the
    // deploy FAILS with a healthcheck timeout despite a healthy app.
    const res = await fetch("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" },
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
