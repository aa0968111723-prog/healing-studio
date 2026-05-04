/**
 * agentOSClient — thin HTTP wrapper around the hollow-agentOS FastAPI surface
 * (https://github.com/ninjahawk/hollow-agentOS).
 *
 * Phase 1 scope: connectivity smoke test only (`health()`).
 * Later phases will add agent CRUD, task submit, SSE streaming, etc.
 *
 * Auth: bearer token injected from `AGENT_OS_TOKEN`; never reaches the browser.
 */

import { httpClient } from "../_core/HttpClient";
import { AppError } from "../_core/error_handler";
import { serverEnv } from "../_core/env.validated";

export interface AgentOSHealth {
  ok: boolean;
  status?: string;
  details?: Record<string, unknown>;
}

export function isAgentOSEnabled(): boolean {
  return (
    serverEnv.AGENT_OS_ENABLED === "true" &&
    serverEnv.AGENT_OS_BASE_URL.length > 0
  );
}

function assertEnabled(): void {
  if (!isAgentOSEnabled()) {
    throw new AppError({
      message:
        "hollow-agentOS integration is disabled. Set AGENT_OS_ENABLED=true and AGENT_OS_BASE_URL to enable.",
      statusCode: 503,
      isOperational: true,
      errorCode: "AGENT_OS_DISABLED",
    });
  }
}

function buildUrl(path: string): string {
  const base = serverEnv.AGENT_OS_BASE_URL.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (serverEnv.AGENT_OS_TOKEN.length > 0) {
    headers.Authorization = `Bearer ${serverEnv.AGENT_OS_TOKEN}`;
  }
  return headers;
}

function timeoutMs(): number {
  const seconds = parseInt(serverEnv.AGENT_OS_TIMEOUT_SECONDS, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
}

/**
 * GET /health — used by tRPC `agentOS.health` and ops dashboards to verify
 * connectivity. Returns a normalized envelope rather than throwing on
 * upstream errors so the caller can surface a friendly status to the UI.
 */
export async function agentOSHealth(): Promise<AgentOSHealth> {
  assertEnabled();
  try {
    const raw = await httpClient.request<unknown>(buildUrl("/health"), {
      method: "GET",
      headers: authHeaders(),
      timeoutMs: timeoutMs(),
      retries: 1,
    });
    return {
      ok: true,
      status: "healthy",
      details:
        typeof raw === "object" && raw !== null
          ? (raw as Record<string, unknown>)
          : { raw },
    };
  } catch (error) {
    return {
      ok: false,
      status:
        error instanceof AppError ? error.errorCode : "AGENT_OS_UNAVAILABLE",
      details: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
