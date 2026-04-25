export interface OrbTaskMemoryEvent {
  taskId: string;
  planId: string;
  traceId: string;
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
