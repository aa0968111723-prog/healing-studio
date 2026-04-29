/**
 * shared/orb-dag-scheduler.ts
 *
 * Topological scheduler for AgentWorkflowStep[] with optional `dependsOn`.
 * Returns batches the orchestrator can run with `Promise.all`, capping
 * concurrency. Designed to be paranoid about UI race conditions:
 *
 *   1. Steps on the SAME `path` are forced into a chain even without
 *      explicit dependsOn. We never run two UI dispatches on the same page
 *      in parallel — that's the main race vector.
 *   2. Steps without `path` (tool-only, navigate, etc.) can parallelise
 *      across batches.
 *   3. Cycles are detected and reported (orchestrator should fail-safe to
 *      sequential execution).
 *
 * No runtime dependencies — works in browser + node.
 */

import type { AgentWorkflowStep } from "./agent-actions";

export interface SchedulerStep extends AgentWorkflowStep {
  /** Required for the scheduler — caller assigns if AgentWorkflowStep didn't have one. */
  id: string;
}

export interface TopologicalBatchesResult {
  /** Ordered list of batches. Each batch can run in parallel. */
  batches: SchedulerStep[][];
  /** When non-null, the input contained a cycle and `batches` is empty. */
  cycle: string[] | null;
  /**
   * Step ids the scheduler had to add an implicit same-page dependency to
   * (in declared order). Surfaced for debugging / telemetry.
   */
  implicitChainEdges: Array<{ from: string; to: string; reason: "same-page" }>;
}

/**
 * Assign stable ids to a step list — used when the planner / workflow
 * expander didn't populate `id`. Idempotent: existing ids are preserved.
 */
export function ensureStepIds(steps: AgentWorkflowStep[]): SchedulerStep[] {
  return steps.map((step, index) => ({
    ...step,
    id: step.id && step.id.length > 0 ? step.id : `step_${index}`,
  }));
}

/**
 * Build the topological batches. Same-page steps are forced sequential by
 * adding an implicit dependency from each previous same-page step.
 */
export function topologicalBatches(input: AgentWorkflowStep[]): TopologicalBatchesResult {
  const steps = ensureStepIds(input);
  const idToIndex = new Map<string, number>();
  steps.forEach((step, index) => idToIndex.set(step.id, index));

  // Build adjacency. We use Sets to dedup edges that get added twice (e.g.
  // explicit dependsOn + same-page chain on a step that already had a dep).
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const step of steps) {
    incoming.set(step.id, new Set());
    outgoing.set(step.id, new Set());
  }

  // Explicit `dependsOn` edges first.
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!idToIndex.has(dep) || dep === step.id) continue;
      incoming.get(step.id)!.add(dep);
      outgoing.get(dep)!.add(step.id);
    }
  }

  // Implicit same-page chain: every step on a non-empty `path` depends on the
  // previous declared step on that same path. This prevents two UI dispatches
  // hitting the same page concurrently — the canonical orb race.
  const implicitChainEdges: Array<{ from: string; to: string; reason: "same-page" }> = [];
  const lastSeenByPath = new Map<string, string>();
  for (const step of steps) {
    const key = step.path ?? "";
    if (!key) continue;
    const previous = lastSeenByPath.get(key);
    if (previous && previous !== step.id) {
      const incomingSet = incoming.get(step.id)!;
      if (!incomingSet.has(previous)) {
        incomingSet.add(previous);
        outgoing.get(previous)!.add(step.id);
        implicitChainEdges.push({ from: previous, to: step.id, reason: "same-page" });
      }
    }
    lastSeenByPath.set(key, step.id);
  }

  // Kahn's algorithm — process every step with zero incoming as a batch,
  // then peel them off. If we can't drain all steps the graph has a cycle.
  const remaining = new Map<string, Set<string>>();
  incoming.forEach((deps, id) => remaining.set(id, new Set(deps)));
  const batches: SchedulerStep[][] = [];
  const visited = new Set<string>();

  while (visited.size < steps.length) {
    const ready = steps.filter(step => !visited.has(step.id) && remaining.get(step.id)!.size === 0);
    if (ready.length === 0) {
      // Cycle: report the steps still waiting.
      const cycle = steps
        .filter(step => !visited.has(step.id))
        .map(step => step.id);
      return { batches: [], cycle, implicitChainEdges };
    }
    batches.push(ready);
    for (const step of ready) {
      visited.add(step.id);
      const downstreams = outgoing.get(step.id);
      if (downstreams) {
        downstreams.forEach(downstream => {
          remaining.get(downstream)?.delete(step.id);
        });
      }
    }
  }

  return { batches, cycle: null, implicitChainEdges };
}

/**
 * Execute batches with bounded concurrency. Caller provides `runStep`; this
 * function is pure orchestration so the same code path works in node tests
 * and the browser orchestrator.
 *
 * Concurrency cap is per-batch (the algorithm intrinsically waits for a batch
 * to finish before starting the next), but we still throttle within a single
 * batch to avoid thrashing tools / network.
 */
export async function runBatchesWithConcurrency<T>(args: {
  batches: SchedulerStep[][];
  concurrency: number;
  runStep: (step: SchedulerStep) => Promise<T>;
}): Promise<{ results: T[]; failed: { step: SchedulerStep; error: unknown } | null }> {
  const cap = Math.max(1, Math.floor(args.concurrency));
  const results: T[] = [];
  for (const batch of args.batches) {
    let cursor = 0;
    while (cursor < batch.length) {
      const slice = batch.slice(cursor, cursor + cap);
      try {
        const sliceResults = await Promise.all(slice.map(step => args.runStep(step)));
        results.push(...sliceResults);
      } catch (err) {
        // Find the first step in the slice that threw — Promise.all only
        // surfaces the first rejection, so we re-run sequentially to find it.
        for (const step of slice) {
          try {
            const r = await args.runStep(step);
            results.push(r);
          } catch (innerErr) {
            return { results, failed: { step, error: innerErr } };
          }
        }
        // If we got here, the original error was transient — keep going.
      }
      cursor += cap;
    }
  }
  return { results, failed: null };
}
