/**
 * shared/orb-perception-loop.ts
 *
 * Closes the "agent thinks it succeeded but the page didn't actually
 * change" gap. The orchestrator already takes a `PageAgentSnapshot`
 * once at workflow start; with this module the caller can capture a
 * SECOND snapshot AFTER each step, diff the two, and convert the
 * delta into a verdict the orchestrator can act on (proceed / retry
 * / replan / abort).
 *
 * Pure functions only — the actual snapshot capture lives in the page
 * agent layer that already owns the live React state. We just give it
 * a deterministic comparator + recommendation policy that the planner
 * can also inspect when reviewing past runs.
 */
import type {
  AgentAction,
  AgentActionResult,
  PageAgentSnapshot,
} from "./agent-actions";

export type PerceptionOutcome = "succeeded" | "no-effect" | "diverged" | "unknown";
export type PerceptionRecommendation = "proceed" | "retry" | "replan" | "abort";

/** Concrete diff between two PageAgentSnapshots, used by the verdict logic. */
export interface SnapshotDelta {
  pageChanged: boolean;
  modelChanged: boolean;
  modeChanged: boolean;
  modalityChanged: boolean;
  promptChanged: boolean;
  presetChanged: boolean;
  /** Warnings that appeared after the action ran (not present before). */
  newWarnings: string[];
  /** Warnings that disappeared (the action cleared them). */
  resolvedWarnings: string[];
  /** State keys whose stringified value differs. */
  changedStateKeys: string[];
  /** Whether at least one observable field changed. */
  anyChange: boolean;
}

export interface PerceptionVerdict {
  outcome: PerceptionOutcome;
  recommendation: PerceptionRecommendation;
  /** Human-readable reason — kept short enough to embed in the next LLM prompt. */
  reason: string;
  observedAt: number;
  delta: SnapshotDelta;
}

/** Subset of an `AgentAction` the diff logic cares about. */
type ActionExpectation = {
  /** When true, we expect SOME observable change after this action. */
  expectsChange: boolean;
  /** When set, we expect this specific delta field to flip true. */
  expectedField?: keyof SnapshotDelta;
  /** Free-form description for the LLM (when we surface to it). */
  description: string;
};

/**
 * What changing fields would justify "the action took effect" for each
 * AgentAction type. Intentionally narrow — we'd rather under-claim
 * success than declare a no-effect step succeeded.
 */
export function expectedDeltaForAction(action: AgentAction): ActionExpectation {
  switch (action.type) {
    case "navigate":
      return { expectsChange: true, expectedField: "pageChanged", description: "page should change" };
    case "setModel":
      return { expectsChange: true, expectedField: "modelChanged", description: `model should switch to ${action.modelId}` };
    case "setMode":
      return { expectsChange: true, expectedField: "modeChanged", description: `mode should switch to ${action.modeId}` };
    case "setModality":
      return { expectsChange: true, expectedField: "modalityChanged", description: `modality should be ${action.modality}` };
    case "fillPrompt":
      return { expectsChange: true, expectedField: "promptChanged", description: "prompt text should change" };
    case "applyPreset":
      return { expectsChange: true, expectedField: "presetChanged", description: "preset should be applied" };
    case "setTab":
    case "setParam":
    case "toggleSetting":
    case "openDialog":
    case "search":
      return { expectsChange: true, description: "page state should reflect the action" };
    case "submit":
      // submit kicks off async generation; we can't expect immediate
      // observable change in the snapshot. Don't penalise for "no-effect".
      return { expectsChange: false, description: "submit kicks off async work; no immediate snapshot delta required" };
    case "reset":
      return { expectsChange: true, description: "form fields should clear" };
    case "focusElement":
      return { expectsChange: false, description: "focus is visual only; no snapshot delta required" };
    case "runWorkflow":
      // Nested workflow — outer perception ignores; inner steps are evaluated individually.
      return { expectsChange: false, description: "nested workflow; per-step perception applies inside" };
    default:
      return { expectsChange: false, description: "unknown action type" };
  }
}

function valueKey(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Compare two snapshots field-by-field. Both inputs may be null/undefined
 * — if either is missing we return a zero-delta and let the verdict layer
 * decide whether to call that "unknown" or treat it as "no observation".
 */
export function diffSnapshots(
  before: PageAgentSnapshot | null | undefined,
  after: PageAgentSnapshot | null | undefined
): SnapshotDelta {
  const empty: SnapshotDelta = {
    pageChanged: false,
    modelChanged: false,
    modeChanged: false,
    modalityChanged: false,
    promptChanged: false,
    presetChanged: false,
    newWarnings: [],
    resolvedWarnings: [],
    changedStateKeys: [],
    anyChange: false,
  };
  if (!before || !after) return empty;

  const newWarnings = (after.warnings ?? []).filter(w => !(before.warnings ?? []).includes(w));
  const resolvedWarnings = (before.warnings ?? []).filter(w => !(after.warnings ?? []).includes(w));

  const changedStateKeys: string[] = [];
  const beforeState = before.state ?? {};
  const afterState = after.state ?? {};
  const allKeys = new Set<string>(Object.keys(beforeState).concat(Object.keys(afterState)));
  allKeys.forEach(k => {
    if (valueKey(beforeState[k]) !== valueKey(afterState[k])) {
      changedStateKeys.push(k);
    }
  });

  // Modality is encoded inside `state.activeModality` on most pages; surface
  // it as a top-level flag so verdict logic doesn't need to peek into state.
  const modalityChanged =
    valueKey((beforeState as Record<string, unknown>)["activeModality"]) !==
    valueKey((afterState as Record<string, unknown>)["activeModality"]);

  const delta: SnapshotDelta = {
    pageChanged: before.pagePath !== after.pagePath || before.pageId !== after.pageId,
    modelChanged: (before.activeModel ?? "") !== (after.activeModel ?? ""),
    modeChanged: (before.activeMode ?? "") !== (after.activeMode ?? ""),
    modalityChanged,
    promptChanged: (before.currentPrompt ?? "") !== (after.currentPrompt ?? ""),
    presetChanged: (before.selectedPreset ?? "") !== (after.selectedPreset ?? ""),
    newWarnings,
    resolvedWarnings,
    changedStateKeys,
    anyChange: false,
  };
  delta.anyChange =
    delta.pageChanged ||
    delta.modelChanged ||
    delta.modeChanged ||
    delta.modalityChanged ||
    delta.promptChanged ||
    delta.presetChanged ||
    newWarnings.length > 0 ||
    resolvedWarnings.length > 0 ||
    changedStateKeys.length > 0;
  return delta;
}

export interface EvaluateStepOutcomeArgs {
  action: AgentAction;
  before: PageAgentSnapshot | null | undefined;
  after: PageAgentSnapshot | null | undefined;
  dispatchResult: AgentActionResult;
  /** ms-since-epoch override for tests. */
  now?: number;
  /**
   * When true and the dispatched action was a `submit`, treat any new warning
   * as a hard failure (the user's quota / API key likely tripped). Default true.
   */
  treatNewWarningsAsFailure?: boolean;
}

/**
 * Convert a (action, before, after, dispatchResult) tuple into a verdict
 * with a recommendation. Recommendations:
 *   - "proceed"  — the action took the expected effect.
 *   - "retry"    — an immediate retry might recover (transient no-effect).
 *   - "replan"   — the action took the wrong effect or surfaced new warnings;
 *                  the planner needs to react.
 *   - "abort"    — the dispatch result itself failed and snapshots confirm
 *                  the page is in an inconsistent state.
 */
export function evaluateStepOutcome(args: EvaluateStepOutcomeArgs): PerceptionVerdict {
  const observedAt = args.now ?? Date.now();
  const delta = diffSnapshots(args.before, args.after);
  const expectation = expectedDeltaForAction(args.action);

  // 1) Dispatch failed → align verdict with the failure reason but use the
  //    snapshot to decide whether retry or replan is the cheaper path.
  if (!args.dispatchResult.ok) {
    const newWarning = delta.newWarnings[0];
    return {
      outcome: "diverged",
      recommendation: newWarning ? "replan" : "retry",
      reason:
        args.dispatchResult.reason ?? "dispatch failed without a reason",
      observedAt,
      delta,
    };
  }

  // 2) No snapshots provided → we can't evaluate; trust the dispatch result.
  if (!args.before || !args.after) {
    return {
      outcome: "unknown",
      recommendation: "proceed",
      reason: "no snapshot pair to compare; trusting dispatch ok",
      observedAt,
      delta,
    };
  }

  // 3) New warning after the action almost always means the page is in a
  //    worse state than before — submit + warning is the classic
  //    "quota exceeded" / "missing API key" pattern.
  const treatWarnings = args.treatNewWarningsAsFailure ?? true;
  if (treatWarnings && delta.newWarnings.length > 0) {
    return {
      outcome: "diverged",
      recommendation: "replan",
      reason: `new warning surfaced: ${delta.newWarnings.join("; ")}`,
      observedAt,
      delta,
    };
  }

  // 4) Action expected a specific change — verify it landed.
  if (expectation.expectsChange) {
    if (expectation.expectedField) {
      const matchedField = delta[expectation.expectedField] === true;
      if (matchedField) {
        return {
          outcome: "succeeded",
          recommendation: "proceed",
          reason: `${expectation.description} (observed)`,
          observedAt,
          delta,
        };
      }
      // Expected a SPECIFIC field to change but it didn't — diverged.
      return {
        outcome: "no-effect",
        recommendation: "retry",
        reason: `${expectation.description} but field "${expectation.expectedField}" didn't update`,
        observedAt,
        delta,
      };
    }
    if (delta.anyChange) {
      return {
        outcome: "succeeded",
        recommendation: "proceed",
        reason: `${expectation.description} (saw ${delta.changedStateKeys.length} state key change(s))`,
        observedAt,
        delta,
      };
    }
    return {
      outcome: "no-effect",
      recommendation: "retry",
      reason: `${expectation.description}, but no observable change`,
      observedAt,
      delta,
    };
  }

  // 5) No change expected (submit / focusElement / nested workflow) — proceed.
  return {
    outcome: "succeeded",
    recommendation: "proceed",
    reason: expectation.description,
    observedAt,
    delta,
  };
}

/**
 * Roll a series of perception verdicts into a short prompt-friendly summary
 * the planner can read on the next round. Trims to the most recent N entries
 * and de-duplicates noisy "proceed" runs to keep the summary signal-dense.
 */
export function summarizePerceptionForPrompt(
  verdicts: PerceptionVerdict[],
  cap: number = 5
): string {
  if (!verdicts.length) return "";
  // Drop trailing "proceed/succeeded" runs older than the most-recent
  // diverged/no-effect entry — the planner only really cares about the
  // surprises and the latest state.
  const lastInteresting = verdicts.findIndex(
    v => v.outcome === "diverged" || v.outcome === "no-effect"
  );
  const tail = lastInteresting >= 0 ? verdicts.slice(lastInteresting) : verdicts.slice(-cap);
  const lines = tail.slice(-cap).map(v => {
    const change = v.delta.anyChange
      ? `[Δ ${v.delta.changedStateKeys.slice(0, 3).join(",")}]`
      : "[no Δ]";
    return `- ${v.outcome} → ${v.recommendation}: ${v.reason} ${change}`;
  });
  return ["【最近觀察】", ...lines].join("\n");
}
