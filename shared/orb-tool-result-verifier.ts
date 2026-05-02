/**
 * orb-tool-result-verifier.ts
 *
 * Pure-function verifier that runs **after** an orb tool call returns
 * (success path) and decides whether the result actually contains usable
 * artefacts. Without this gate the orchestrator happily passes garbage
 * (all-black images, empty audio, missing URLs, model 200-with-error
 * payloads) to the next step, which is the single biggest reason a
 * multi-step plan looks "agentic" but produces unusable output.
 *
 * Design:
 *  - Zero side-effects, zero IO. Only inspects the `data` payload.
 *  - Returns `ok=true` when nothing suspicious is detected. Be **lenient**:
 *    we'd rather let an ambiguous result pass than block a valid one and
 *    waste user credits on a re-run.
 *  - Tool name is matched by **prefix** so PR #318 audio additions
 *    (`studio.generateVoice`, `studio.cloneVoice`, `studio.transcribe`,
 *    `studio.animateSpeaker`, ...) inherit the correct family of checks.
 *
 * Used by: `server/services/orbTaskOrchestrator.ts`
 *   (after `executeCurrentStepTools` returns ok=true, before advancing
 *   the FSM step). On verification failure the orchestrator flips the
 *   step to failed with a `verifier:<reason>` errorCode so the existing
 *   replan / retry path picks it up automatically.
 *
 * Defect: DEF-AG1 (cf. docs/agent/light-ball-agent-enhancement-plan.md)
 */
export type VerifierIssueCode =
  | "missing-payload"
  | "missing-asset-url"
  | "asset-url-not-http"
  | "empty-text"
  | "suspicious-zero-duration"
  | "suspicious-tiny-asset"
  | "model-reported-error";

export interface VerifierIssue {
  code: VerifierIssueCode;
  message: string;
  /** Optional dotted path to the offending field for log triage. */
  field?: string;
}

export interface ToolResultVerification {
  ok: boolean;
  issues: VerifierIssue[];
  /** Stable error string suitable for orchestrator `errorCode` field. */
  errorCode?: string;
}

interface VerifyArgs {
  toolName: string;
  data: unknown;
}

const HTTP_LIKE = /^(https?:|data:)/i;

/**
 * Drill down into `data` to locate a likely asset URL field. We accept the
 * common shapes producers actually emit: top-level `url`, nested
 * `images[0].url`, `image.url`, `audio.url`, `video.url`, `output.url`.
 * Returns `null` when no candidate exists (caller decides if that's fatal).
 */
function pickAssetUrl(data: Record<string, unknown>): string | null {
  const candidates: Array<unknown> = [];
  candidates.push(data.url);
  if (data.image && typeof data.image === "object") {
    candidates.push((data.image as Record<string, unknown>).url);
  }
  if (Array.isArray(data.images) && data.images.length > 0) {
    const first = data.images[0];
    if (first && typeof first === "object") {
      candidates.push((first as Record<string, unknown>).url);
    }
  }
  if (data.audio && typeof data.audio === "object") {
    candidates.push((data.audio as Record<string, unknown>).url);
  }
  if (data.video && typeof data.video === "object") {
    candidates.push((data.video as Record<string, unknown>).url);
  }
  if (data.output && typeof data.output === "object") {
    candidates.push((data.output as Record<string, unknown>).url);
  }
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

/**
 * Some FAL/Replicate-style providers return HTTP 200 + `{error: "..."}`
 * inside `data` instead of using a non-2xx status. Surface those.
 */
function detectModelReportedError(data: Record<string, unknown>): VerifierIssue | null {
  const err = data.error ?? (data.detail as Record<string, unknown> | undefined)?.error;
  if (typeof err === "string" && err.trim().length > 0) {
    return {
      code: "model-reported-error",
      field: "error",
      message: `Provider returned 200 but body carries error: ${err.slice(0, 160)}`,
    };
  }
  return null;
}

function verifyImageFamily(data: Record<string, unknown>): VerifierIssue[] {
  const issues: VerifierIssue[] = [];
  const url = pickAssetUrl(data);
  if (!url) {
    issues.push({
      code: "missing-asset-url",
      field: "url|images[0].url|image.url",
      message: "Image tool succeeded but no asset URL was returned.",
    });
    return issues;
  }
  if (!HTTP_LIKE.test(url)) {
    issues.push({
      code: "asset-url-not-http",
      field: "url",
      message: `Image asset URL does not look downloadable: ${url.slice(0, 80)}`,
    });
  }
  return issues;
}

function verifyVideoFamily(data: Record<string, unknown>): VerifierIssue[] {
  const issues: VerifierIssue[] = [];
  const url = pickAssetUrl(data);
  if (!url) {
    issues.push({
      code: "missing-asset-url",
      field: "url|video.url|output.url",
      message: "Video tool succeeded but no asset URL was returned.",
    });
    return issues;
  }
  if (!HTTP_LIKE.test(url)) {
    issues.push({
      code: "asset-url-not-http",
      field: "url",
      message: `Video asset URL does not look downloadable: ${url.slice(0, 80)}`,
    });
  }
  // Some providers expose `duration` (seconds). Zero-duration videos
  // are a frequent silent-fail mode (e.g. FAL Wan rare codepath).
  const duration = data.duration ?? (data.video as Record<string, unknown> | undefined)?.duration;
  if (typeof duration === "number" && duration <= 0) {
    issues.push({
      code: "suspicious-zero-duration",
      field: "duration",
      message: "Video reports duration <= 0 seconds.",
    });
  }
  return issues;
}

function verifyAudioFamily(data: Record<string, unknown>): VerifierIssue[] {
  const issues: VerifierIssue[] = [];
  const url = pickAssetUrl(data);
  if (!url) {
    issues.push({
      code: "missing-asset-url",
      field: "url|audio.url|output.url",
      message: "Audio tool succeeded but no asset URL was returned.",
    });
    return issues;
  }
  if (!HTTP_LIKE.test(url)) {
    issues.push({
      code: "asset-url-not-http",
      field: "url",
      message: `Audio asset URL does not look downloadable: ${url.slice(0, 80)}`,
    });
  }
  const duration = data.duration ?? (data.audio as Record<string, unknown> | undefined)?.duration;
  if (typeof duration === "number" && duration <= 0) {
    issues.push({
      code: "suspicious-zero-duration",
      field: "duration",
      message: "Audio reports duration <= 0 seconds.",
    });
  }
  return issues;
}

/**
 * For ASR / transcription: must return non-empty text.
 */
function verifyTranscribeFamily(data: Record<string, unknown>): VerifierIssue[] {
  const issues: VerifierIssue[] = [];
  const text = (data.text ?? data.transcript ?? (data.output as Record<string, unknown> | undefined)?.text) as
    | string
    | undefined;
  if (typeof text !== "string" || text.trim().length === 0) {
    issues.push({
      code: "empty-text",
      field: "text|transcript|output.text",
      message: "Transcription returned empty text.",
    });
  }
  return issues;
}

/**
 * Runs the verification. Tool family is inferred from the tool name prefix
 * so all 17 `studio.*` orb tools (and any future ones following the same
 * naming convention) automatically route to the right checker.
 */
export function verifyToolResult(args: VerifyArgs): ToolResultVerification {
  const { toolName, data } = args;
  // Be tolerant — non-object data is allowed (some tools just return
  // primitives or null intentionally). Only flag the obviously broken
  // cases.
  if (data === null || data === undefined) {
    return {
      ok: false,
      issues: [
        { code: "missing-payload", message: `${toolName} returned null/undefined data.` },
      ],
      errorCode: `verifier:missing-payload`,
    };
  }
  if (typeof data !== "object") {
    // Primitive returns are fine for tools that legitimately do so
    // (e.g. counters, booleans). Don't second-guess.
    return { ok: true, issues: [] };
  }
  const obj = data as Record<string, unknown>;
  const issues: VerifierIssue[] = [];
  const modelErr = detectModelReportedError(obj);
  if (modelErr) issues.push(modelErr);
  const lower = toolName.toLowerCase();
  // Family routing — ordered by specificity. `transcribe` must be checked
  // before `audio` because it's a non-asset-producing audio family.
  if (lower.includes("transcribe") || lower.includes("asr")) {
    issues.push(...verifyTranscribeFamily(obj));
  } else if (
    lower.includes("video") ||
    lower.includes("animatespeaker") ||
    lower.includes("speechtovideo")
  ) {
    issues.push(...verifyVideoFamily(obj));
  } else if (
    lower.includes("audio") ||
    lower.includes("voice") ||
    lower.includes("sfx") ||
    lower.includes("stem") ||
    lower.includes("isolate") ||
    lower.includes("merge")
  ) {
    issues.push(...verifyAudioFamily(obj));
  } else if (
    lower.includes("image") ||
    lower.includes("imageedit") ||
    lower.includes("trainlora")
  ) {
    issues.push(...verifyImageFamily(obj));
  }
  if (issues.length === 0) {
    return { ok: true, issues: [] };
  }
  // Pick the first issue as the canonical errorCode so the orchestrator
  // and FSM can pattern-match cleanly.
  return {
    ok: false,
    issues,
    errorCode: `verifier:${issues[0].code}`,
  };
}
