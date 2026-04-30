/*
 * shared/orb-process-link.ts
 * ───────────────────────────────────────────────────────────────
 * Compact, URL-safe encoder/decoder for "process guides" that the orb agent
 * can hand back as shareable links (e.g. `/process?spec=...`).
 *
 * A process spec is a tiny step-by-step guide the user can open in a tab,
 * bookmark, or share. It covers two cases:
 *
 *   1. Site workflows the orb already runs (短片生成、圖片生成…) — the spec
 *      mirrors the workflow steps and includes their target paths so the
 *      viewer can offer "open this page" / "ask the orb to run this".
 *   2. General how-to topics the orb explains in chat (e.g. "製茶過程",
 *      "登入步驟") — pure educational content with title + steps.
 *
 * The whole spec is JSON, then base64url-encoded so it survives sharing
 * across clients without needing a database row. Specs are capped to keep
 * URLs short; longer flows should be served from a saved-process store
 * (future enhancement).
 */

export interface ProcessStep {
  /** Short imperative title for the step. */
  title: string;
  /** Optional 1–2 sentence elaboration. */
  detail?: string;
  /** Optional in-app path the user can jump to for this step. */
  path?: string;
  /** Optional helper for the orb runner — re-uses AgentWorkflowStep.actionType. */
  actionType?: string;
  /** Payload for the action when the orb is asked to run this step. */
  payload?: string;
}

export type ProcessKind = "workflow" | "howto";

export interface ProcessSpec {
  /** Display title shown at the top of the viewer. */
  title: string;
  /** One-line subtitle / summary. */
  summary?: string;
  /** Ordered steps. */
  steps: ProcessStep[];
  /** Whether the orb originally generated this as a runnable workflow. */
  kind?: ProcessKind;
  /** Optional source attribution (e.g. "光球 / 全站代理 v1"). */
  source?: string;
  /** Optional per-process emoji shown in the header. */
  emoji?: string;
  /** Spec format version — increment on breaking changes. */
  v?: number;
}

export const PROCESS_SPEC_VERSION = 1;
export const PROCESS_SPEC_MAX_STEPS = 24;
export const PROCESS_SPEC_MAX_TITLE_LEN = 80;
export const PROCESS_SPEC_MAX_DETAIL_LEN = 240;
export const PROCESS_SPEC_MAX_BYTES = 6_000;

function clip(value: string | undefined, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** Strip / clip fields so the spec stays small enough for a URL. */
export function normalizeProcessSpec(input: ProcessSpec): ProcessSpec {
  const title = clip(input.title, PROCESS_SPEC_MAX_TITLE_LEN) ?? "未命名流程";
  const summary = clip(input.summary, PROCESS_SPEC_MAX_DETAIL_LEN);
  const source = clip(input.source, PROCESS_SPEC_MAX_TITLE_LEN);
  const emoji = clip(input.emoji, 8);
  const steps = (input.steps ?? [])
    .slice(0, PROCESS_SPEC_MAX_STEPS)
    .map((step): ProcessStep => ({
      title: clip(step.title, PROCESS_SPEC_MAX_TITLE_LEN) ?? "步驟",
      ...(step.detail ? { detail: clip(step.detail, PROCESS_SPEC_MAX_DETAIL_LEN)! } : {}),
      ...(step.path ? { path: clip(step.path, 200)! } : {}),
      ...(step.actionType ? { actionType: clip(step.actionType, 40)! } : {}),
      ...(step.payload ? { payload: clip(step.payload, 400)! } : {}),
    }))
    .filter(step => step.title.length > 0);

  return {
    v: PROCESS_SPEC_VERSION,
    title,
    ...(summary ? { summary } : {}),
    ...(source ? { source } : {}),
    ...(emoji ? { emoji } : {}),
    kind: input.kind ?? "howto",
    steps,
  };
}

// ─── base64url encode/decode that works in browser + node ──────────────

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const b64 = padded + padding;
  if (typeof atob === "function") {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** Encode a process spec into a compact, URL-safe string. */
export function encodeProcessSpec(spec: ProcessSpec): string {
  const normalized = normalizeProcessSpec(spec);
  const json = JSON.stringify(normalized);
  if (json.length > PROCESS_SPEC_MAX_BYTES) {
    throw new Error(
      `process spec too large for URL (${json.length} bytes > ${PROCESS_SPEC_MAX_BYTES})`
    );
  }
  const bytes = new TextEncoder().encode(json);
  return toBase64Url(bytes);
}

export interface DecodeResult {
  ok: boolean;
  spec?: ProcessSpec;
  reason?: string;
}

/** Decode a URL-encoded spec back into a normalized ProcessSpec. */
export function decodeProcessSpec(encoded: string): DecodeResult {
  if (typeof encoded !== "string" || encoded.length === 0) {
    return { ok: false, reason: "empty spec" };
  }
  if (encoded.length > PROCESS_SPEC_MAX_BYTES * 2) {
    return { ok: false, reason: "spec too large" };
  }
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(encoded);
  } catch (err) {
    return { ok: false, reason: `invalid base64: ${(err as Error).message}` };
  }
  let parsed: unknown;
  try {
    const json = new TextDecoder().decode(bytes);
    parsed = JSON.parse(json);
  } catch (err) {
    return { ok: false, reason: `invalid json: ${(err as Error).message}` };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "spec must be an object" };
  }
  const candidate = parsed as Partial<ProcessSpec>;
  if (typeof candidate.title !== "string" || !Array.isArray(candidate.steps)) {
    return { ok: false, reason: "spec missing title or steps" };
  }
  return { ok: true, spec: normalizeProcessSpec(candidate as ProcessSpec) };
}

export interface BuildProcessUrlOptions {
  /** Base path for the process viewer (defaults to `/process`). */
  base?: string;
  /** Origin to prepend (e.g. `https://example.com`); when omitted returns a path-only link. */
  origin?: string;
}

/** Build a viewer URL for a process spec. */
export function buildProcessUrl(
  spec: ProcessSpec,
  options: BuildProcessUrlOptions = {}
): string {
  const encoded = encodeProcessSpec(spec);
  const base = options.base ?? "/process";
  const path = `${base}?spec=${encoded}`;
  if (!options.origin) return path;
  return `${options.origin.replace(/\/$/, "")}${path}`;
}

import type { RunWorkflowAction } from "./agent-actions";

/**
 * Convert an existing orb workflow (RunWorkflow action) into a process spec
 * that the viewer can render. Used so any workflow the orb plans can be
 * shared as a viewable link before / after execution.
 */
export function workflowActionToProcessSpec(
  action: RunWorkflowAction,
  options: { summary?: string; emoji?: string; source?: string } = {}
): ProcessSpec {
  return normalizeProcessSpec({
    title: action.name,
    summary: options.summary,
    emoji: options.emoji ?? "🧭",
    source: options.source ?? "光球工作流程",
    kind: "workflow",
    steps: action.steps.map(step => ({
      title: step.label,
      ...(step.path ? { path: step.path } : {}),
      ...(step.actionType ? { actionType: step.actionType } : {}),
      ...(step.payload ? { payload: step.payload } : {}),
    })),
  });
}
