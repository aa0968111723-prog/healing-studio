// @vitest-environment jsdom
/**
 * Real hook test for useOrbTaskObservations — exercises polling,
 * dedupe, terminal-stop and chain auto-follow against a hand-rolled
 * trpc stub. Sister-tests in orbTaskObservations.test.ts cover the
 * pure mapping; this file covers the React state machine around it.
 *
 * Uses vitest's per-file jsdom env so the rest of the suite stays
 * node-only. Avoids spinning up the real tRPC client by mocking
 * `@/lib/trpc` to expose just the procedure the hook calls.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Mock trpc.ai.orbTask.events.useQuery ──────────────────────────────
//
// The hook only touches this one procedure. We use a queue so each test
// can script the sequence of audit-event arrays the poll returns. No
// QueryClientProvider needed — this stub bypasses React Query entirely.

interface QueryStubState {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
}

const queryQueueRef: { responses: unknown[][] } = { responses: [] };

vi.mock("@/lib/trpc", () => ({
  trpc: {
    ai: {
      orbTask: {
        events: {
          useQuery: (
            _input: { taskId: string },
            opts: { enabled?: boolean } = {}
          ): QueryStubState => {
            // Pop the next scripted batch each time the hook re-reads.
            // When the queue empties, just keep returning the last one.
            if (!opts.enabled) {
              return { data: undefined, isLoading: false, isError: false };
            }
            const next =
              queryQueueRef.responses.length > 0
                ? queryQueueRef.responses.shift()
                : [];
            return { data: next, isLoading: false, isError: false };
          },
        },
      },
    },
  },
}));

import { useOrbTaskObservations } from "@/hooks/useOrbTaskObservations";

afterEach(() => {
  queryQueueRef.responses = [];
});

function pushQueryResponse(rows: unknown[]) {
  queryQueueRef.responses.push(rows);
}

describe("useOrbTaskObservations (hook)", () => {
  it("starts with empty observations and isPolling=true when given a rootTaskId", () => {
    const { result } = renderHook(() => useOrbTaskObservations("t-root"));
    expect(result.current.observations).toEqual([]);
    expect(result.current.isPolling).toBe(true);
    expect(result.current.currentTaskId).toBe("t-root");
  });

  it("returns no observations and stays not-polling when rootTaskId is null", () => {
    const { result } = renderHook(() => useOrbTaskObservations(null));
    expect(result.current.observations).toEqual([]);
    expect(result.current.isPolling).toBe(false);
    expect(result.current.currentTaskId).toBeNull();
  });

  it("ingests audit events into observations on first poll", async () => {
    pushQueryResponse([
      {
        eventId: "e1",
        taskId: "t-root",
        type: "task.observed",
        message: "",
        timestamp: 100,
        metadata: {
          observation: { kind: "complete", userMessage: "好了" },
        },
      },
    ]);
    const { result } = renderHook(() => useOrbTaskObservations("t-root"));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));
    expect(result.current.observations[0].kind).toBe("complete");
    expect(result.current.observations[0].message).toBe("好了");
  });

  it("stops polling once a terminal observation arrives", async () => {
    pushQueryResponse([
      {
        eventId: "e-abort",
        taskId: "t-root",
        type: "task.observed",
        message: "",
        timestamp: 100,
        metadata: {
          observation: {
            kind: "abort",
            userMessage: "stopped",
            failureCategory: "tool_error",
          },
        },
      },
    ]);
    const { result } = renderHook(() => useOrbTaskObservations("t-root"));
    await waitFor(() => expect(result.current.isPolling).toBe(false));
    expect(result.current.latestKind).toBe("abort");
  });

  it("auto-follows continuation_started and switches polling target", async () => {
    pushQueryResponse([
      {
        eventId: "e-cont",
        taskId: "t-root",
        type: "task.continuation_started",
        message: "Continuation",
        timestamp: 100,
        metadata: {
          successorTaskId: "t-root-2",
          iterationIndex: 1,
        },
      },
    ]);
    const { result } = renderHook(() => useOrbTaskObservations("t-root"));
    await waitFor(() => expect(result.current.currentTaskId).toBe("t-root-2"));
    expect(result.current.observations).toHaveLength(1);
    expect(result.current.observations[0].kind).toBe("continuation_started");
    expect(result.current.observations[0].successorTaskId).toBe("t-root-2");
  });

  it("dedupes events on subsequent polls (same eventId not appended twice)", async () => {
    const sharedEvent = {
      eventId: "e-dup",
      taskId: "t-root",
      type: "task.observed",
      message: "",
      timestamp: 100,
      metadata: {
        observation: { kind: "continue", suggestedNextAction: "try x", reason: "y" },
      },
    };
    // Same event will be returned on next poll too — hook must
    // dedupe by eventId.
    pushQueryResponse([sharedEvent]);
    pushQueryResponse([sharedEvent]);
    const { result, rerender } = renderHook(() =>
      useOrbTaskObservations("t-root")
    );
    await waitFor(() => expect(result.current.observations).toHaveLength(1));
    // Force a re-read by re-rendering — the stub will return the same
    // event again from the second queued response.
    act(() => {
      rerender();
    });
    expect(result.current.observations).toHaveLength(1);
  });

  it("resets state when rootTaskId changes", async () => {
    pushQueryResponse([
      {
        eventId: "e-1",
        taskId: "t-a",
        type: "task.observed",
        message: "",
        timestamp: 100,
        metadata: { observation: { kind: "complete", userMessage: "ok" } },
      },
    ]);
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useOrbTaskObservations(id),
      { initialProps: { id: "t-a" as string | null } }
    );
    await waitFor(() => expect(result.current.observations).toHaveLength(1));
    act(() => {
      rerender({ id: "t-b" });
    });
    expect(result.current.observations).toEqual([]);
    expect(result.current.currentTaskId).toBe("t-b");
  });
});
