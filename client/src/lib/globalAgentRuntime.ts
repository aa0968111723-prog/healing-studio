/**
 * Runtime controls for the site-wide Orb / AI Director agent.
 *
 * Keep this module tiny and dependency-free so it can be imported safely from
 * React contexts, UI components, and future Playwright/debug helpers.
 */

export const GLOBAL_AGENT_WORKFLOW_FLAG = "VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS";
export const GLOBAL_AGENT_TELEMETRY_FLAG = "VITE_ENABLE_GLOBAL_AGENT_TELEMETRY";

function normalizeFlag(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function readImportMetaEnv(key: string): unknown {
  try {
    return (import.meta as unknown as { env?: Record<string, unknown> }).env?.[key];
  } catch {
    return undefined;
  }
}

export function isGlobalAgentWorkflowEnabled(): boolean {
  const raw = normalizeFlag(readImportMetaEnv(GLOBAL_AGENT_WORKFLOW_FLAG));

  // Default ON to preserve the behavior that was merged into main. Railway can
  // set VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS=false for an immediate soft-disable.
  if (!raw) return true;
  return !["0", "false", "off", "no", "disabled"].includes(raw);
}

export function isGlobalAgentTelemetryEnabled(): boolean {
  const raw = normalizeFlag(readImportMetaEnv(GLOBAL_AGENT_TELEMETRY_FLAG));
  return ["1", "true", "on", "yes", "enabled"].includes(raw);
}

export type GlobalAgentTelemetryEvent =
  | "workflow.plan"
  | "workflow.confirm"
  | "workflow.cancel"
  | "workflow.revise"
  | "workflow.start"
  | "workflow.step"
  | "workflow.complete"
  | "workflow.fail"
  | "workflow.disabled";

export interface GlobalAgentTelemetryPayload {
  workflowId?: string;
  workflowName?: string;
  source?: string;
  intent?: string;
  userText?: string;
  total?: number;
  stepIndex?: number;
  stepLabel?: string;
  stepPath?: string;
  actionType?: string;
  reason?: string;
  at?: number;
}

export function logGlobalAgentTelemetry(
  event: GlobalAgentTelemetryEvent,
  payload: GlobalAgentTelemetryPayload = {}
): void {
  if (!isGlobalAgentTelemetryEnabled()) return;

  const enriched = {
    ...payload,
    event,
    at: payload.at ?? Date.now(),
  };

  try {
    console.groupCollapsed(`[GlobalAgent] ${event}`);
    console.info(enriched);
    console.groupEnd();
  } catch {
    console.info(`[GlobalAgent] ${event}`, enriched);
  }
}
