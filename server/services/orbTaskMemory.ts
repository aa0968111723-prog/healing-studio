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

// ─── DB persistence (best-effort, opt-in) ─────────────────────────────────
//
// In-memory ring buffer is fast but evaporates on process restart. When
// `ORB_CHAIN_MEMORY_PERSIST=1` is set, we ALSO mirror chain-level events
// through the existing `orb_feedback_events` table (no schema change
// needed) so the planner / observer can recover historical chain
// outcomes after a restart or across horizontally-scaled instances.
//
// The mirror is fire-and-forget: any DB error is swallowed and logged
// because the agent loop must NEVER block on persistence. The hot
// in-memory path stays unchanged — restored entries on demand fall back
// to a paginated DB scan.

const PERSIST_FLAG = "ORB_CHAIN_MEMORY_PERSIST";
const CHAIN_MEMORY_ACTION_TYPE_PREFIX = "chain.";

function isChainMemoryPersistenceEnabled(): boolean {
  return process.env[PERSIST_FLAG] === "1";
}

/**
 * Map memory outcome → orb_feedback_events.status enum. The DB enum
 * is ['accepted', 'edited', 'cancelled', 'completed', 'failed']; we
 * use the closest semantic fit.
 */
function memoryOutcomeToFeedbackStatus(
  outcome: OrbTaskMemoryEvent["outcome"]
): "completed" | "failed" | "cancelled" {
  switch (outcome) {
    case "success":
      return "completed";
    case "blocked":
    case "cancelled":
      return "cancelled";
    case "failure":
    default:
      return "failed";
  }
}

/**
 * Best-effort DB mirror — caller passes the same event it just gave
 * to `recordOrbTaskMemory`. No-op when the persist flag is off, when
 * userId is missing (orb_feedback_events.userId is NOT NULL), or when
 * the DB layer returns null. Returns a promise so callers that care
 * can await; chain runner calls void to fire-and-forget.
 */
export async function persistOrbTaskMemoryEvent(
  event: OrbTaskMemoryEvent
): Promise<void> {
  if (!isChainMemoryPersistenceEnabled()) return;
  if (typeof event.userId !== "number") return;
  // Lazy import — keeps tests that don't touch the DB layer fast and
  // doesn't make orbTaskMemory.ts depend on the heavy db module at
  // module-load time.
  let appendOrbFeedback;
  try {
    ({ appendOrbFeedback } = await import("../db"));
  } catch (err) {
    console.warn(
      "[orbTaskMemory] DB module unavailable, skipping persist:",
      err instanceof Error ? err.message : String(err)
    );
    return;
  }
  try {
    const summary = JSON.stringify({
      taskId: event.taskId,
      planId: event.planId,
      traceId: event.traceId,
      usedEngine: event.usedEngine ?? null,
      usedMultimodalPlanner: event.usedMultimodalPlanner,
      actionTypes: event.actionTypes.slice(0, 12),
      failedReason: event.failedReason ?? null,
    }).slice(0, 256);
    await appendOrbFeedback({
      userId: event.userId,
      pageId: null,
      // Distinguishable from per-action feedback rows via the prefix —
      // load helper below filters on it.
      actionType: `${CHAIN_MEMORY_ACTION_TYPE_PREFIX}${event.outcome}`.slice(0, 32),
      status: memoryOutcomeToFeedbackStatus(event.outcome),
      note: event.userIntent.slice(0, 512),
      actionSummary: summary,
    });
  } catch (err) {
    console.warn(
      "[orbTaskMemory] persist failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Reconstruct OrbTaskMemoryEvent[] from the DB-persisted feedback
 * rows. Only the fields encoded into `actionSummary` survive the round
 * trip; consumers that need richer detail should keep using the
 * in-memory ring during a single process lifetime.
 */
export async function loadRecentChainMemoryFromDb(
  userId: number,
  limit = 10
): Promise<OrbTaskMemoryEvent[]> {
  if (!isChainMemoryPersistenceEnabled()) return [];
  let getRecentOrbFeedback;
  try {
    ({ getRecentOrbFeedback } = await import("../db"));
  } catch {
    return [];
  }
  let rows;
  try {
    // Pull a wider window then filter — chain rows are interleaved
    // with per-action rows in the same table.
    rows = await getRecentOrbFeedback(userId, Math.min(50, limit * 5));
  } catch (err) {
    console.warn(
      "[orbTaskMemory] DB read failed:",
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
  const out: OrbTaskMemoryEvent[] = [];
  for (const row of rows) {
    if (!row.actionType?.startsWith(CHAIN_MEMORY_ACTION_TYPE_PREFIX)) continue;
    const outcomeStr = row.actionType.slice(
      CHAIN_MEMORY_ACTION_TYPE_PREFIX.length
    );
    const validOutcomes: OrbTaskMemoryEvent["outcome"][] = [
      "success",
      "failure",
      "cancelled",
      "blocked",
    ];
    if (!validOutcomes.includes(outcomeStr as OrbTaskMemoryEvent["outcome"])) {
      continue;
    }
    let parsed: Record<string, unknown> = {};
    try {
      parsed = row.actionSummary ? JSON.parse(row.actionSummary) : {};
    } catch {
      // Skip rows whose summary isn't our JSON (e.g. legacy entries).
      continue;
    }
    out.push({
      taskId: typeof parsed.taskId === "string" ? parsed.taskId : `db-${row.id}`,
      planId: typeof parsed.planId === "string" ? parsed.planId : `db-${row.id}`,
      traceId: typeof parsed.traceId === "string" ? parsed.traceId : `db-${row.id}`,
      userId,
      userIntent: row.note ?? "",
      outcome: outcomeStr as OrbTaskMemoryEvent["outcome"],
      failedReason:
        typeof parsed.failedReason === "string" ? parsed.failedReason : undefined,
      usedEngine: typeof parsed.usedEngine === "string" ? parsed.usedEngine : null,
      usedMultimodalPlanner: !!parsed.usedMultimodalPlanner,
      actionTypes: Array.isArray(parsed.actionTypes)
        ? parsed.actionTypes
            .filter((s: unknown): s is string => typeof s === "string")
            .slice(0, 12)
        : [],
      createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : Date.now(),
    });
    if (out.length >= limit) break;
  }
  return out;
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
