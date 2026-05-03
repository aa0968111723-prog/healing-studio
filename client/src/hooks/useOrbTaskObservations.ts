/**
 * useOrbTaskObservations.ts — client-side hook to follow the agent
 * chain audit log.
 *
 * Polls `trpc.ai.orbTask.events` while a task is alive, picks out the
 * structured `task.observed` and `task.continuation_started` audit
 * events the chain runner writes, and surfaces them as a typed list
 * the UI can render. Auto-follows continuation tasks: when the current
 * task emits `task.continuation_started` with a `successorTaskId`, the
 * hook switches to polling the successor so the chain unfolds without
 * the caller managing taskId state.
 *
 * No subscriptions / SSE here — the existing endpoint is a query, and
 * a 1.5 s poll keeps the dependency chain dead-simple. The hook stops
 * polling once an observation with kind `complete` / `abort` /
 * `needs_user` is observed (terminal states), or after a hard timeout
 * to avoid leaking timers.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

export interface OrbTaskObservationItem {
  /** FSM event id — stable, unique within a task's audit log */
  eventId: string;
  /** Which task in the chain produced this observation */
  taskId: string;
  iterationIndex: number;
  /** When the observation was written (ms epoch) */
  at: number;
  kind: "complete" | "needs_user" | "continue" | "abort" | "continuation_started";
  /** Display text — for `complete`/`abort` it's the friendly userMessage,
   *  for `needs_user` it's the question, for `continue` the suggested next
   *  action, for `continuation_started` a short Chinese narration. */
  message: string;
  suggestions?: string[];
  failureCategory?:
    | "tool_error"
    | "missing_input"
    | "approval_blocked"
    | "quota_exceeded"
    | "unknown";
  /** Set on `continuation_started` events: id of the new task that was
   *  spawned. Hook uses this to switch its polling target. */
  successorTaskId?: string;
}

export interface UseOrbTaskObservationsResult {
  observations: OrbTaskObservationItem[];
  /** TaskId currently being polled — may differ from `rootTaskId` once
   *  the chain auto-follows continuations. */
  currentTaskId: string | null;
  isPolling: boolean;
  /** Last observation kind seen (for the most recent task in the chain). */
  latestKind: OrbTaskObservationItem["kind"] | null;
}

interface AuditEventRow {
  eventId: string;
  taskId: string;
  type: string;
  message: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

const POLL_INTERVAL_MS = 1_500;
/** Hard stop: 10 minutes of polling per task. Real tasks complete way faster
 *  and a runaway poll only burns network budget. */
const MAX_POLL_MS = 10 * 60 * 1_000;

function eventToObservation(
  event: AuditEventRow,
  iterationIndex: number
): OrbTaskObservationItem | null {
  if (event.type === "task.continuation_started") {
    const successor =
      event.metadata && typeof event.metadata.successorTaskId === "string"
        ? (event.metadata.successorTaskId as string)
        : undefined;
    const nextIter =
      event.metadata && typeof event.metadata.iterationIndex === "number"
        ? (event.metadata.iterationIndex as number)
        : iterationIndex + 1;
    return {
      eventId: event.eventId,
      taskId: event.taskId,
      iterationIndex,
      at: event.timestamp,
      kind: "continuation_started",
      message: `光球換個方法繼續：第 ${nextIter} 輪`,
      successorTaskId: successor,
    };
  }

  if (event.type !== "task.observed") return null;

  // Observer's metadata payload: { observation: TaskObservation } — see
  // observationToAuditMetadata in server/services/orbTaskObserver.ts
  const obs = (event.metadata as { observation?: Record<string, unknown> } | undefined)?.observation;
  if (!obs || typeof obs !== "object") {
    // Fallback: a non-observer-shaped task.observed entry (e.g. observer
    // crashed) — surface as a continue-style note so the UI doesn't go
    // silent.
    return {
      eventId: event.eventId,
      taskId: event.taskId,
      iterationIndex,
      at: event.timestamp,
      kind: "continue",
      message: event.message || "光球觀察到狀況，但沒有完整資訊。",
    };
  }
  const kind = obs.kind;
  switch (kind) {
    case "complete":
      return {
        eventId: event.eventId,
        taskId: event.taskId,
        iterationIndex,
        at: event.timestamp,
        kind: "complete",
        message: typeof obs.userMessage === "string" ? obs.userMessage : "已完成。",
      };
    case "abort":
      return {
        eventId: event.eventId,
        taskId: event.taskId,
        iterationIndex,
        at: event.timestamp,
        kind: "abort",
        message: typeof obs.userMessage === "string" ? obs.userMessage : "中途遇到狀況，先暫停。",
        failureCategory:
          typeof obs.failureCategory === "string"
            ? (obs.failureCategory as OrbTaskObservationItem["failureCategory"])
            : "unknown",
      };
    case "needs_user":
      return {
        eventId: event.eventId,
        taskId: event.taskId,
        iterationIndex,
        at: event.timestamp,
        kind: "needs_user",
        message: typeof obs.question === "string" ? obs.question : "需要你的協助。",
        suggestions: Array.isArray(obs.suggestions)
          ? obs.suggestions.filter((s): s is string => typeof s === "string").slice(0, 4)
          : undefined,
      };
    case "continue":
      return {
        eventId: event.eventId,
        taskId: event.taskId,
        iterationIndex,
        at: event.timestamp,
        kind: "continue",
        message:
          typeof obs.suggestedNextAction === "string"
            ? obs.suggestedNextAction
            : "光球準備繼續。",
      };
    default:
      return null;
  }
}

const TERMINAL_KINDS = new Set<OrbTaskObservationItem["kind"]>([
  "complete",
  "abort",
  "needs_user",
]);

export function useOrbTaskObservations(
  rootTaskId: string | null
): UseOrbTaskObservationsResult {
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(rootTaskId);
  const [observations, setObservations] = useState<OrbTaskObservationItem[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const startedAtRef = useRef<number>(0);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const iterationByTaskRef = useRef<Map<string, number>>(new Map());

  // When rootTaskId changes, fully reset.
  useEffect(() => {
    setCurrentTaskId(rootTaskId);
    setObservations([]);
    seenEventIdsRef.current = new Set();
    iterationByTaskRef.current = new Map();
    if (rootTaskId) {
      iterationByTaskRef.current.set(rootTaskId, 0);
      startedAtRef.current = Date.now();
      setIsPolling(true);
    } else {
      setIsPolling(false);
    }
  }, [rootTaskId]);

  // tRPC poll — disable when not polling so we don't keep firing.
  const eventsQuery = trpc.ai.orbTask.events.useQuery(
    { taskId: currentTaskId ?? "" },
    {
      enabled: Boolean(currentTaskId) && isPolling,
      refetchInterval: isPolling ? POLL_INTERVAL_MS : false,
      // Don't churn the UI on identical responses; the structural diff
      // we do below is cheap.
      staleTime: 500,
    }
  );

  useEffect(() => {
    const data = eventsQuery.data;
    if (!data || !currentTaskId) return;
    const events = (Array.isArray(data) ? data : []) as AuditEventRow[];
    const iterationIndex = iterationByTaskRef.current.get(currentTaskId) ?? 0;

    let switchTo: string | null = null;
    let sawTerminal = false;
    const newItems: OrbTaskObservationItem[] = [];
    for (const evt of events) {
      if (seenEventIdsRef.current.has(evt.eventId)) continue;
      const item = eventToObservation(evt, iterationIndex);
      if (!item) continue;
      seenEventIdsRef.current.add(evt.eventId);
      newItems.push(item);
      if (item.kind === "continuation_started" && item.successorTaskId) {
        switchTo = item.successorTaskId;
      }
      if (TERMINAL_KINDS.has(item.kind)) sawTerminal = true;
    }

    if (newItems.length > 0) {
      setObservations(prev => [...prev, ...newItems]);
    }

    // Decide whether to keep polling.
    const elapsed = Date.now() - startedAtRef.current;
    if (elapsed > MAX_POLL_MS) {
      setIsPolling(false);
      return;
    }
    if (switchTo) {
      const nextIteration = iterationIndex + 1;
      iterationByTaskRef.current.set(switchTo, nextIteration);
      setCurrentTaskId(switchTo);
      // keep isPolling — new task to follow
      return;
    }
    if (sawTerminal) {
      setIsPolling(false);
    }
  }, [eventsQuery.data, currentTaskId]);

  return useMemo(() => {
    const last = observations[observations.length - 1];
    return {
      observations,
      currentTaskId,
      isPolling,
      latestKind: last?.kind ?? null,
    };
  }, [observations, currentTaskId, isPolling]);
}
