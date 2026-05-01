/**
 * shared/orb-step-ref-resolver.ts
 *
 * Resolves `${<stepId>.<path>}` (or `${steps.<stepId>.<path>}`) references in
 * `toolArgs` against the cumulative results captured by the orchestrator.
 *
 * Closes the audit's #1 highest-impact gap: tool-result feedback. Without this,
 * a multi-step plan like
 *   step1 → studio.generateVideo → returns { request_id, video_url }
 *   step2 → studio.enhanceVideo  → needs `video_url` from step1
 * could only run if the planner guessed the value upfront, which never works
 * for async generation pipelines. With this resolver, the planner can write:
 *   step2.toolArgs = { video_url: "${step1.video_url}", operation: "upscale" }
 * and the orchestrator substitutes the real value at run time.
 *
 * Resolution rules:
 *   - "${<stepId>.<key>[.<key>...]}" matches a previous step's
 *     toolResult.data[key][...]. The leading `steps.` prefix is optional.
 *   - "${<stepId>.output.<key>}" is also accepted (LLMs love the word "output").
 *   - When the entire string IS a single `${...}` placeholder and the resolved
 *     value is non-string, we keep the original type (number / boolean / array).
 *   - When a placeholder appears alongside other text, we coerce to string and
 *     splice in (best-effort, used for prompts).
 *   - Unresolved placeholders are LEFT IN PLACE (no silent dropping) so the
 *     orchestrator can detect the missing dep and fail loudly rather than
 *     dispatching a tool with `undefined` somewhere subtle.
 *
 * The resolver is pure + sync; the orchestrator imports it from /shared so
 * client + server tests share the same contract.
 */

export interface StepResultEntry {
  stepId: string;
  /** Captured `data` payload from the first successful tool call of the step. */
  data?: unknown;
}

const PLACEHOLDER_RE = /\$\{([^}]+)\}/g;

function getByPath(root: unknown, path: string[]): unknown {
  let cursor: unknown = root;
  for (const key of path) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function parseRef(ref: string): { stepId: string; path: string[] } | null {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  let parts = trimmed.split(".").map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  // Allow "${steps.step1.foo}" by dropping the leading "steps" namespace.
  if (parts[0] === "steps" && parts.length >= 2) parts = parts.slice(1);
  const stepId = parts[0];
  let rest = parts.slice(1);
  // Allow "${step1.output.foo}" by dropping the optional "output" segment.
  if (rest[0] === "output") rest = rest.slice(1);
  return { stepId, path: rest };
}

function resolveValueForRef(
  ref: string,
  results: Map<string, StepResultEntry>
): { found: boolean; value: unknown } {
  const parsed = parseRef(ref);
  if (!parsed) return { found: false, value: undefined };
  const entry = results.get(parsed.stepId);
  if (!entry) return { found: false, value: undefined };
  if (parsed.path.length === 0) return { found: true, value: entry.data };
  const v = getByPath(entry.data, parsed.path);
  return { found: v !== undefined, value: v };
}

function resolveString(
  raw: string,
  results: Map<string, StepResultEntry>
): unknown {
  // Whole-string single-placeholder → preserve original type.
  const wholeMatch = raw.match(/^\$\{([^}]+)\}$/);
  if (wholeMatch) {
    const { found, value } = resolveValueForRef(wholeMatch[1], results);
    return found ? value : raw;
  }
  // Mixed string with embedded placeholders → splice as strings.
  if (!PLACEHOLDER_RE.test(raw)) return raw;
  PLACEHOLDER_RE.lastIndex = 0;
  return raw.replace(PLACEHOLDER_RE, (whole, ref: string) => {
    const { found, value } = resolveValueForRef(ref, results);
    if (!found) return whole;
    if (value === null || value === undefined) return whole;
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  });
}

function resolveValue(
  value: unknown,
  results: Map<string, StepResultEntry>
): unknown {
  if (typeof value === "string") return resolveString(value, results);
  if (Array.isArray(value)) return value.map(item => resolveValue(item, results));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveValue(v, results);
    }
    return out;
  }
  return value;
}

export interface ResolveStepRefsInput {
  args: Record<string, unknown> | undefined;
  perStepToolResults: Array<{
    stepId: string;
    toolResults: Array<{ ok: boolean; data?: unknown }>;
  }>;
}

/**
 * Resolve `${stepId.path}` references in a toolArgs object against the
 * cumulative `perStepToolResults` captured by the orchestrator. Only the
 * first successful (`ok: true`) tool result of each step contributes data —
 * subsequent failed retries don't shadow earlier successes. Returns a
 * fresh object; never mutates the input.
 */
export function resolveStepRefsInArgs(
  input: ResolveStepRefsInput
): Record<string, unknown> | undefined {
  if (!input.args) return input.args;
  const map = new Map<string, StepResultEntry>();
  for (const entry of input.perStepToolResults) {
    if (map.has(entry.stepId)) continue;
    const firstOk = entry.toolResults.find(r => r.ok && r.data !== undefined);
    if (firstOk) map.set(entry.stepId, { stepId: entry.stepId, data: firstOk.data });
  }
  return resolveValue(input.args, map) as Record<string, unknown>;
}

/**
 * Pure helper exposed for tests — given a raw string, resolve any
 * `${stepId.path}` placeholders against `results`.
 */
export function resolveStepRefsInString(
  raw: string,
  perStepToolResults: ResolveStepRefsInput["perStepToolResults"]
): unknown {
  const map = new Map<string, StepResultEntry>();
  for (const entry of perStepToolResults) {
    if (map.has(entry.stepId)) continue;
    const firstOk = entry.toolResults.find(r => r.ok && r.data !== undefined);
    if (firstOk) map.set(entry.stepId, { stepId: entry.stepId, data: firstOk.data });
  }
  return resolveString(raw, map);
}
