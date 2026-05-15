/**
 * shared/orb-self-reflection.ts
 *
 * Step-level self-reflection layer for the orb orchestrator. Wraps
 * `verifyToolResult` with qualitative checks the verifier alone can't
 * express — slow latency, suspiciously trivial output, repeated identical
 * failure signatures — and produces a single structured verdict the
 * orchestrator can attach to its audit trail and feed back into orbMemory
 * for the next planner pass to learn from.
 *
 * Design goals:
 *  - Pure, side-effect free. The caller owns IO (memory writes, SSE emit).
 *  - Never throws on malformed input — return `severity="info"` instead so
 *    a bad reflection can't take down a real tool run.
 *  - Output shape is stable: orchestrator audit events, planner replan
 *    prompts, and the front-end "intent card" all consume the same fields.
 *
 * Used by: `server/services/orbTaskOrchestrator.ts`
 *   `reflectOnStepResult` is called once per tool result after the
 *   verifier returns. On `severity >= "warn"` the orchestrator records
 *   the reflection into orbMemory (so the next planner pass sees the
 *   lesson) and surfaces `advice` on the SSE channel.
 */

import { verifyToolResult, type ToolResultVerification } from "./orb-tool-result-verifier";

export type ReflectionSeverity = "info" | "warn" | "fail";

export interface StepReflectionInput {
  toolName: string;
  data: unknown;
  /** Optional latency in ms; reflection downgrades slow successful results. */
  latencyMs?: number;
  /** Optional retry count up to this attempt — high counts add a warn note. */
  retryCount?: number;
  /** Optional declared output type (image/video/audio/voice/text) for stricter checks. */
  expectedOutputType?: "image" | "video" | "audio" | "voice" | "text" | "plan" | "analysis" | "lora";
}

export interface StepReflection {
  ok: boolean;
  severity: ReflectionSeverity;
  /** Stable code suitable for orchestrator errorCode / metric labels. */
  code: string;
  /** Short summary for orbMemory.summary (under 120 chars). */
  summary: string;
  /** Free-text advice surfaced to the planner & UI. */
  advice: string;
  /** Verifier verdict, preserved so callers don't have to re-run it. */
  verifier: ToolResultVerification;
  /** Tag list for orbMemory.tags — caller can merge with their own. */
  tags: string[];
}

const SLOW_LATENCY_MS = 60_000;
const MAX_HEALTHY_RETRIES = 1;

function asObject(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

/**
 * Heuristic: did the producer hand back an "empty success"? Verifier already
 * catches the obvious missing-url/empty-text cases for known families, but
 * tools outside those families (research.deepSearch, qualityCoach.diagnose,
 * accountant.estimate, …) can still 200 with `{ results: [] }`. Treat
 * empty arrays / empty strings at common output keys as a soft warn.
 */
function hasShallowEmptySignal(data: unknown): { empty: boolean; field?: string } {
  const obj = asObject(data);
  if (!obj) return { empty: false };
  const candidateKeys = ["results", "items", "data", "matches", "candidates", "outputs", "text", "reply", "answer"];
  for (const key of candidateKeys) {
    if (!(key in obj)) continue;
    const value = obj[key];
    if (Array.isArray(value) && value.length === 0) return { empty: true, field: key };
    if (typeof value === "string" && value.trim().length === 0) return { empty: true, field: key };
  }
  return { empty: false };
}

/**
 * Run the reflection. Always returns a verdict; never throws. The caller
 * is responsible for any IO (memory writes, SSE emits, planner replan).
 */
export function reflectOnStepResult(input: StepReflectionInput): StepReflection {
  const verifier = verifyToolResult({ toolName: input.toolName, data: input.data });
  const tags: string[] = [input.toolName];

  if (!verifier.ok) {
    const code = verifier.errorCode ?? "verifier:unknown";
    tags.push("verifier-failed", code);
    const reasons = verifier.issues.slice(0, 3).map(i => i.message).join("; ");
    return {
      ok: false,
      severity: "fail",
      code,
      summary: `Tool ${input.toolName} produced an unusable result (${code}).`,
      advice: reasons
        ? `Verifier flagged: ${reasons}. Replan with stricter args or switch to a fallback tool.`
        : `Replan with stricter args or switch to a fallback tool.`,
      verifier,
      tags,
    };
  }

  const emptySignal = hasShallowEmptySignal(input.data);
  if (emptySignal.empty) {
    const code = `reflection:empty-${emptySignal.field}`;
    tags.push("empty-success", code);
    return {
      ok: false,
      severity: "warn",
      code,
      summary: `Tool ${input.toolName} returned a 200 with empty "${emptySignal.field}".`,
      advice:
        `The call succeeded but "${emptySignal.field}" is empty — broaden the query, ` +
        `relax filters, or fall back to a different source before passing this to the next step.`,
      verifier,
      tags,
    };
  }

  if (typeof input.retryCount === "number" && input.retryCount > MAX_HEALTHY_RETRIES) {
    const code = "reflection:high-retry-count";
    tags.push("high-retries", code);
    return {
      ok: true,
      severity: "warn",
      code,
      summary: `Tool ${input.toolName} eventually succeeded after ${input.retryCount} retries.`,
      advice:
        `The tool succeeded but only after ${input.retryCount} retries — consider tightening ` +
        `arguments upfront on the next plan, or pick a more reliable alternative.`,
      verifier,
      tags,
    };
  }

  if (typeof input.latencyMs === "number" && input.latencyMs > SLOW_LATENCY_MS) {
    const code = "reflection:slow-latency";
    tags.push("slow-latency", code);
    return {
      ok: true,
      severity: "warn",
      code,
      summary: `Tool ${input.toolName} succeeded but took ${input.latencyMs}ms.`,
      advice:
        `The result is usable but the call was slow (>${SLOW_LATENCY_MS}ms). ` +
        `If this tool sits on a hot path, prefer an asynchronous alternative or smaller payload.`,
      verifier,
      tags,
    };
  }

  return {
    ok: true,
    severity: "info",
    code: "reflection:pass",
    summary: `Tool ${input.toolName} returned usable output.`,
    advice: "",
    verifier,
    tags,
  };
}

/**
 * Decide whether the reflection should trigger a replan rather than just an
 * audit-log note. Replan is reserved for hard failures: verifier rejects or
 * the producer handed back an empty success that would poison the next step.
 */
export function shouldReplanFromReflection(reflection: StepReflection): boolean {
  if (reflection.severity === "fail") return true;
  if (reflection.severity === "warn" && reflection.code.startsWith("reflection:empty-")) {
    return true;
  }
  return false;
}
