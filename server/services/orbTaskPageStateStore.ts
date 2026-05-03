/**
 * orbTaskPageStateStore.ts — per-task ring buffer of page-state snapshots.
 *
 * Bridges the client/server gap for the agent loop: the observer +
 * planner run server-side and have no native way to see what the
 * destination page actually looks like after a UI action dispatches.
 * The PageAgent (client) reports structured snapshots here whenever a
 * handler returns `data` on its AgentActionResult; the observer reads
 * the buffer at post-mortem time so its prompt sees the world as the
 * page sees it.
 *
 * In-memory only (TTL 30 min, same window as the planner-context
 * store). On process restart the buffers are dropped — observer just
 * runs without the extra context, same fallback as no-snapshot.
 *
 * Ring-buffer cap (`MAX_SNAPSHOTS_PER_TASK`): bounded so a runaway
 * action queue can't grow the buffer unbounded.
 */

const TTL_MS = 30 * 60 * 1_000;
const MAX_SNAPSHOTS_PER_TASK = 16;

export interface OrbTaskPageStateSnapshot {
  /** When the snapshot was captured (ms epoch). */
  at: number;
  /** PageAgent's pageId (e.g. "studio", "video-studio") if known. */
  pageId?: string;
  /** Action type that produced the snapshot (e.g. "fillPrompt"). */
  actionType?: string;
  /** Optional short summary the page handler can attach for the LLM. */
  summary?: string;
  /** Free-form structured payload — kept under control by the caller. */
  state: Record<string, unknown>;
}

interface BufferEntry {
  snapshots: OrbTaskPageStateSnapshot[];
  storedAt: number;
}

const store = new Map<string, BufferEntry>();

function cleanup(now: number) {
  store.forEach((entry, taskId) => {
    if (now - entry.storedAt > TTL_MS) {
      store.delete(taskId);
    }
  });
}

export function appendOrbTaskPageState(
  taskId: string,
  snapshot: OrbTaskPageStateSnapshot
): void {
  const now = Date.now();
  cleanup(now);
  const entry = store.get(taskId);
  if (entry) {
    entry.snapshots.push(snapshot);
    if (entry.snapshots.length > MAX_SNAPSHOTS_PER_TASK) {
      entry.snapshots.splice(0, entry.snapshots.length - MAX_SNAPSHOTS_PER_TASK);
    }
    entry.storedAt = now;
  } else {
    store.set(taskId, { snapshots: [snapshot], storedAt: now });
  }
}

export function getOrbTaskPageState(taskId: string): OrbTaskPageStateSnapshot[] {
  cleanup(Date.now());
  return store.get(taskId)?.snapshots ?? [];
}

export function deleteOrbTaskPageState(taskId: string): void {
  store.delete(taskId);
}

/** Test-only — clear the entire store between unit tests. */
export function _resetOrbTaskPageStateStoreForTests(): void {
  store.clear();
}
