export interface OrbTaskMemoryEvent {
  taskId: string;
  planId: string;
  traceId: string;
  /** Owning user. Optional only because pre-user-scoping callers may
   *  still record events without it; new callers MUST pass userId so
   *  per-user observer memory queries don't leak across accounts. */
  userId?: number;
  userIntent: string;
  outcome: "success" | "failure" | "cancelled" | "blocked";
  failedReason?: string;
  usedEngine?: string | null;
  usedMultimodalPlanner: boolean;
  actionTypes: string[];
  createdAt: number;
}

const MAX_EVENTS = 300;
const memoryEvents: OrbTaskMemoryEvent[] = [];

export function recordOrbTaskMemory(event: OrbTaskMemoryEvent): OrbTaskMemoryEvent {
  memoryEvents.unshift(event);
  if (memoryEvents.length > MAX_EVENTS) memoryEvents.length = MAX_EVENTS;
  return event;
}

export function getRecentOrbTaskMemory(limit = 10): OrbTaskMemoryEvent[] {
  return memoryEvents.slice(0, Math.max(1, Math.min(limit, 50)));
}

/**
 * Per-user view of recent task memory. Only returns events where the
 * recorded userId matches; events without a userId (legacy callers)
 * are EXCLUDED so they can't accidentally leak across accounts. Use
 * this from per-user contexts (observer, planner) instead of the
 * unscoped `getRecentOrbTaskMemory`.
 */
export function getRecentOrbTaskMemoryForUser(
  userId: number,
  limit = 10
): OrbTaskMemoryEvent[] {
  const cap = Math.max(1, Math.min(limit, 50));
  const out: OrbTaskMemoryEvent[] = [];
  for (const evt of memoryEvents) {
    if (evt.userId === userId) {
      out.push(evt);
      if (out.length >= cap) break;
    }
  }
  return out;
}

/** Test-only — clear the buffer between unit tests. */
export function _resetOrbTaskMemoryForTests(): void {
  memoryEvents.length = 0;
}

export function summarizeRecentOrbTaskMemoryForPlanner(limit = 10): string {
  const recent = getRecentOrbTaskMemory(limit);
  if (recent.length === 0) return "No recent task memory.";
  const compact = recent.map(item => ({
    taskId: item.taskId,
    planId: item.planId,
    traceId: item.traceId,
    intent: item.userIntent.slice(0, 140),
    outcome: item.outcome,
    failedReason: item.failedReason?.slice(0, 160),
    usedEngine: item.usedEngine ?? null,
    usedMultimodalPlanner: item.usedMultimodalPlanner,
    actionTypes: item.actionTypes.slice(0, 8),
    createdAt: item.createdAt,
  }));
  return JSON.stringify({ count: compact.length, recent: compact });
}
