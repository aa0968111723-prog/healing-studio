/**
 * client/src/lib/workflowRunStateStore.ts
 *
 * Browser-side adapter for the orchestrator's `persistRunState` /
 * `loadRunState` callbacks. Serialises every step to localStorage so:
 *
 *   1. A workflow that fails partway through (step 5 of 9) leaves a durable
 *      record the user can reopen for debugging without losing what step 1-4
 *      already produced.
 *   2. A future "resume from where it stopped" UI can hand the runId back to
 *      the orchestrator via `resumeFromRunId` and skip already-completed
 *      steps.
 *
 * Without this, the 50+ lines of resume code in shared/global-agent-orchestrator.ts
 * are unreachable in production — the orchestrator only loads if `loadRunState`
 * was provided, and previously no client wired it up.
 */
import type { WorkflowRunState } from "../../../shared/workflow-run-state";

const KEY_PREFIX = "orb-workflow-run:";
const INDEX_KEY = "orb-workflow-run-index";
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 5;

interface IndexEntry {
  runId: string;
  updatedAt: number;
}

function readIndex(): IndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIndex(entries: IndexEntry[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch {
    // quota exceeded or storage disabled — best-effort
  }
}

function pruneExpiredAndCap(entries: IndexEntry[], now: number): IndexEntry[] {
  const fresh = entries.filter(e => now - e.updatedAt <= TTL_MS);
  fresh.sort((a, b) => b.updatedAt - a.updatedAt);
  const kept = fresh.slice(0, MAX_ENTRIES);
  // Remove the dropped entries' state blobs to avoid leaking storage.
  const droppedRunIds = new Set(
    fresh.slice(MAX_ENTRIES).map(e => e.runId).concat(
      entries.filter(e => now - e.updatedAt > TTL_MS).map(e => e.runId)
    )
  );
  for (const runId of droppedRunIds) {
    try {
      localStorage.removeItem(KEY_PREFIX + runId);
    } catch {
      // ignore
    }
  }
  return kept;
}

export async function persistRunState(state: WorkflowRunState): Promise<void> {
  try {
    localStorage.setItem(KEY_PREFIX + state.runId, JSON.stringify(state));
    const now = Date.now();
    const index = readIndex();
    const next = index.filter(e => e.runId !== state.runId);
    next.push({ runId: state.runId, updatedAt: state.updatedAt });
    writeIndex(pruneExpiredAndCap(next, now));
  } catch {
    // localStorage unavailable / quota exceeded — degrade gracefully; the
    // orchestrator runs fine without persistence (just no resume capability).
  }
}

export async function loadRunState(
  runId: string
): Promise<WorkflowRunState | null> {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + runId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkflowRunState;
    // Drop stale entries proactively so a stale resume token can't replay an
    // ancient run.
    if (Date.now() - parsed.updatedAt > TTL_MS) {
      localStorage.removeItem(KEY_PREFIX + runId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** List recent workflow runs (newest first) — used by the "recent failures" UI. */
export function listRecentRuns(): IndexEntry[] {
  const now = Date.now();
  const pruned = pruneExpiredAndCap(readIndex(), now);
  writeIndex(pruned);
  return pruned;
}

/** Manually drop a single run (e.g., when user dismisses a failure card). */
export function clearRun(runId: string) {
  try {
    localStorage.removeItem(KEY_PREFIX + runId);
    writeIndex(readIndex().filter(e => e.runId !== runId));
  } catch {
    // ignore
  }
}
