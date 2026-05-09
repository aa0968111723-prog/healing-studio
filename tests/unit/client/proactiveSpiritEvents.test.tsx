/**
 * proactiveSpiritEvents.test.tsx
 *
 * Regression guard for the `orbProactiveSuggestions` and `favoriteSpirits`
 * wiring on the proactive event bus. Both fields used to live in
 * AgentPreferences but `useProactiveSpiritEvents` ignored them — toggling
 * "關閉主動建議" did nothing, and starring a spirit was a pure UI hint.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  ProactiveEventBus,
  useProactiveSpiritEvents,
} from "../../../client/src/lib/proactiveSpiritEvents";

vi.mock("sonner", () => {
  const calls: Array<{ kind: string; headline: string; opts?: Record<string, unknown> }> = [];
  const make = (kind: string) =>
    (headline: string, opts?: Record<string, unknown>) => {
      calls.push({ kind, headline, opts });
    };
  const toast = Object.assign(make("default"), {
    success: make("success"),
    warning: make("warning"),
    error: make("error"),
    info: make("info"),
    __calls: calls,
  }) as unknown as typeof import("sonner").toast & { __calls: typeof calls };
  return { toast };
});

import { toast as mockedToast } from "sonner";

const ALL_CALLS = (mockedToast as unknown as { __calls: Array<{ kind: string; headline: string; opts?: Record<string, unknown> }> }).__calls;

afterEach(() => {
  ALL_CALLS.length = 0;
  // The bus is a process-wide singleton with a 30 s dedupe window. Wipe
  // it between tests so the second test's publish() of the same event
  // isn't silently swallowed.
  ProactiveEventBus.reset();
});

describe("useProactiveSpiritEvents — preference wiring", () => {
  // The ProactiveEventBus is a process-wide singleton, so each test must
  // unmount its hook to release subscriptions before the next one
  // publishes. Without this teardown, leftover listeners from earlier
  // tests fire when later tests publish and pollute ALL_CALLS.
  it("subscribes by default and surfaces toasts when an event fires", () => {
    const { unmount } = renderHook(() =>
      useProactiveSpiritEvents([], { enabled: true })
    );
    act(() => {
      ProactiveEventBus.publish("monthly_spend_threshold", {
        usedPct: 95,
        remainingCredits: 12,
        topModel: "fal/sd-xl",
      });
    });
    expect(ALL_CALLS.length).toBeGreaterThan(0);
    unmount();
  });

  it("emits zero toasts when enabled=false (orbProactiveSuggestions kill switch)", () => {
    const { unmount } = renderHook(() =>
      useProactiveSpiritEvents([], { enabled: false })
    );
    act(() => {
      ProactiveEventBus.publish("monthly_spend_threshold", {
        usedPct: 95,
        remainingCredits: 12,
        topModel: "fal/sd-xl",
      });
      ProactiveEventBus.publish("prompt_too_short", {
        prompt: "森林",
        suggestedAddition: "氣氛 / 主角 / 鏡頭",
      });
    });
    expect(ALL_CALLS).toEqual([]);
    unmount();
  });

  it("skips muted spirits even when proactive suggestions are enabled", () => {
    // accountant fires monthly_spend_threshold; muting them silences the toast.
    const { unmount } = renderHook(() =>
      useProactiveSpiritEvents(["accountant"], { enabled: true })
    );
    act(() => {
      ProactiveEventBus.publish("monthly_spend_threshold", {
        usedPct: 95,
        remainingCredits: 12,
        topModel: "fal/sd-xl",
      });
    });
    expect(ALL_CALLS).toEqual([]);
    unmount();
  });

  it("promotes favourite spirits' transient toasts to persistent (Infinity duration)", () => {
    // quality-coach fires `prompt_too_short` which is surface="toast"
    // (8 s auto-dismiss by default). Starring them should keep the toast
    // on screen until the user clears it (duration: Infinity).
    const { unmount } = renderHook(() =>
      useProactiveSpiritEvents([], {
        enabled: true,
        favoriteSpirits: ["quality-coach"],
      })
    );
    act(() => {
      ProactiveEventBus.publish("prompt_too_short", {
        prompt: "森林",
        suggestedAddition: "氣氛 / 主角 / 鏡頭",
      });
    });
    expect(ALL_CALLS.length).toBeGreaterThan(0);
    const last = ALL_CALLS[ALL_CALLS.length - 1];
    expect(last.opts?.duration).toBe(Infinity);
    unmount();
  });

  it("non-favourite spirits keep their default toast duration", () => {
    const { unmount } = renderHook(() =>
      useProactiveSpiritEvents([], { enabled: true })
    );
    act(() => {
      ProactiveEventBus.publish("prompt_too_short", {
        prompt: "森林",
        suggestedAddition: "氣氛 / 主角 / 鏡頭",
      });
    });
    const last = ALL_CALLS[ALL_CALLS.length - 1];
    // Default trigger surface=toast → 8 s duration. Anything finite is fine,
    // we just need it to NOT be Infinity (the favourite promotion).
    expect(last.opts?.duration).not.toBe(Infinity);
    expect(typeof last.opts?.duration).toBe("number");
    unmount();
  });
});
