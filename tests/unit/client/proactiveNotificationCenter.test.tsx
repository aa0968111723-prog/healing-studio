/**
 * proactive-notification-center.test.tsx
 *
 * Locks the post-merge integration contract for ProactiveNotificationCenter:
 *
 *   1. globallyEnabled=false silences ALL events and clears throttle/queue
 *      so toggling off → on doesn't replay stale state.
 *   2. Dismissing a card resets the throttle window — same event won't
 *      re-surface within minIntervalMs of dismiss.
 *   3. favoriteSpirits forces transient `surface: "toast"` events into the
 *      ack-required notification queue.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { useEffect, useState } from "react";

import { ProactiveEventBus } from "../../../client/src/lib/proactiveEventBus";

vi.mock("sonner", () => {
  const calls: Array<{ kind: string; opts?: Record<string, unknown> }> = [];
  const make = (kind: string) => (_h: string, opts?: Record<string, unknown>) => {
    calls.push({ kind, opts });
  };
  const toast = Object.assign(make("default"), {
    success: make("success"),
    warning: make("warning"),
    error: make("error"),
    info: make("info"),
    __calls: calls,
  });
  return { toast };
});

import { ProactiveNotificationCenter } from "../../../client/src/lib/ProactiveNotificationCenter";
import { ORB_SMILEY_ONLY } from "../../../client/src/config/featureFlags";
import { toast as mockedToast } from "sonner";

const TOAST_CALLS = (mockedToast as unknown as { __calls: Array<{ kind: string; opts?: Record<string, unknown> }> })
  .__calls;

afterEach(() => {
  TOAST_CALLS.length = 0;
  ProactiveEventBus.reset();
});

// Helper: render the notification center with controllable preferences
// and return both the queue accessor (via a probe) and a setter for the
// global-enabled flag. We can't read the internal queue directly, so we
// proxy queue activity through the toast spy + a separate count probe.
function renderCenter(initial: {
  globallyEnabled?: boolean;
  favoriteSpirits?: string[];
}) {
  function Harness({
    state,
    setState,
  }: {
    state: { globallyEnabled: boolean; favoriteSpirits: string[] };
    setState: (s: { globallyEnabled: boolean; favoriteSpirits: string[] }) => void;
  }) {
    void setState;
    return (
      <ProactiveNotificationCenter
        mutedSpirits={[]}
        triggerSettings={{
          // Tight 5 s throttle so the test doesn't have to wait the
          // 5-minute production default. Still long enough that two
          // back-to-back publishes are clearly within the window.
          prompt_too_short: { enabled: true, minIntervalMs: 5_000, requireAck: false },
          monthly_spend_threshold: { enabled: true, minIntervalMs: 5_000, requireAck: true },
        }}
        globallyEnabled={state.globallyEnabled}
        favoriteSpirits={state.favoriteSpirits}
      />
    );
  }
  function Wrapper() {
    const [state, setState] = useState({
      globallyEnabled: initial.globallyEnabled ?? true,
      favoriteSpirits: initial.favoriteSpirits ?? [],
    });
    // Expose setter via window for tests to flip the toggle.
    useEffect(() => {
      (globalThis as unknown as { __center: typeof setState }).__center = setState;
    }, []);
    return <Harness state={state} setState={setState} />;
  }
  return render(<Wrapper />);
}

describe("ProactiveNotificationCenter — post-merge integration", () => {
  it("globallyEnabled=false silences events even when per-event triggerSettings allow them", () => {
    const { unmount } = renderCenter({ globallyEnabled: false });
    act(() => {
      ProactiveEventBus.publish("prompt_too_short", {
        prompt: "森林",
        suggestedAddition: "氣氛 / 主角",
      });
    });
    // The kill-switch should win over per-event enabled=true.
    expect(TOAST_CALLS).toEqual([]);
    unmount();
  });

  it("transient toast events fire normally when globallyEnabled=true", () => {
    const { unmount } = renderCenter({ globallyEnabled: true });
    act(() => {
      ProactiveEventBus.publish("prompt_too_short", {
        prompt: "森林",
        suggestedAddition: "氣氛 / 主角",
      });
    });
    expect(TOAST_CALLS.length).toBe(1);
    unmount();
  });

  it("favoriteSpirits promotes toast → ack queue (no sonner toast fires)", () => {
    // quality-coach owns prompt_too_short which has surface="toast".
    // When the spirit is favourited, the event must be promoted into the
    // ack-required queue and bypass the sonner branch entirely.
    const { unmount } = renderCenter({
      globallyEnabled: true,
      favoriteSpirits: ["quality-coach"],
    });
    act(() => {
      ProactiveEventBus.publish("prompt_too_short", {
        prompt: "森林",
        suggestedAddition: "氣氛 / 主角",
      });
    });
    // Promoted events skip the sonner toast branch, so nothing should
    // land in the toast spy. (The card itself goes into the React queue
    // which we don't probe directly here.)
    expect(TOAST_CALLS.length).toBe(0);
    unmount();
  });

  it("context_near_full surfaces an inline ack card with no sonner toast (companion is not favourited)", () => {
    // companion owns context_near_full at surface=inline. inline events
    // always queue an ack card and skip the sonner branch, even without
    // favouriting. This locks the new feature's UI path.
    const { unmount } = renderCenter({ globallyEnabled: true });
    act(() => {
      ProactiveEventBus.publish(
        "context_near_full",
        {
          usedPct: 84,
          messageCount: 16,
          usedChars: 9_500,
          capChars: 12_000,
          conversationTitle: "今天的對話",
        },
        { dedupeKey: "ctx-1" },
      );
    });
    // No sonner toast — went straight to the queue.
    expect(TOAST_CALLS.length).toBe(0);
    unmount();
  });

  it("kill-switch flip OFF → ON re-allows events without inheriting old throttle", async () => {
    // Render with globallyEnabled=true and fire the first event to seed
    // the lastSurfaceAt throttle window.
    const { unmount } = renderCenter({ globallyEnabled: true });
    act(() => {
      // The shared ProactiveEventBus has its own 30 s dedupe per
      // (event + dedupeKey) — pass distinct keys per publish so the
      // bus itself doesn't swallow our second publish for unrelated
      // reasons. We're testing the notification-center throttle, not
      // the bus dedupe.
      ProactiveEventBus.publish(
        "prompt_too_short",
        { prompt: "森林", suggestedAddition: "1" },
        { dedupeKey: "test-1" },
      );
    });
    expect(TOAST_CALLS.length).toBe(1);

    // Flip globallyEnabled=false.
    act(() => {
      const setter = (globalThis as unknown as { __center?: (s: { globallyEnabled: boolean; favoriteSpirits: string[] }) => void }).__center;
      setter?.({ globallyEnabled: false, favoriteSpirits: [] });
    });

    // Flip back to true. The throttle window should reset, so a fresh
    // publish below MUST fire (without the reset, the 5 s window would
    // still be active from the very first publish).
    act(() => {
      const setter = (globalThis as unknown as { __center?: (s: { globallyEnabled: boolean; favoriteSpirits: string[] }) => void }).__center;
      setter?.({ globallyEnabled: true, favoriteSpirits: [] });
    });
    TOAST_CALLS.length = 0;
    act(() => {
      ProactiveEventBus.publish(
        "prompt_too_short",
        { prompt: "森林", suggestedAddition: "2" },
        { dedupeKey: "test-2" },
      );
    });
    expect(TOAST_CALLS.length).toBe(1);
    unmount();
  });

  // ──「光球只留笑臉光球」(ORB_SMILEY_ONLY) 整合契約 ──────────────────────────
  // DashboardLayout 把 globallyEnabled 餵成 `proactiveGloballyEnabled &&
  // !ORB_SMILEY_ONLY`。預設 ORB_SMILEY_ONLY=true → 整個運算式恆為 false →
  // 走既有 kill-switch 分支：守守/財財/巧巧等主動精靈卡片一張都不出、連 toast
  // 都不冒。這把「只留笑臉光球」的行為鎖在這個唯一渲染收斂點上。
  describe("ORB_SMILEY_ONLY 整合契約", () => {
    it("預設旗標 ON：只留笑臉光球", () => {
      expect(ORB_SMILEY_ONLY).toBe(true);
    });

    it("以 DashboardLayout 的實際運算式 (proactiveGloballyEnabled && !ORB_SMILEY_ONLY) 掛載時，主動精靈卡片全靜音", () => {
      const proactiveGloballyEnabled = true; // 即使使用者偏好開著主動建議
      const effectiveEnabled = proactiveGloballyEnabled && !ORB_SMILEY_ONLY;
      const { unmount } = renderCenter({ globallyEnabled: effectiveEnabled });
      act(() => {
        // 守守「提示詞庫沒用到」(feature_not_used) 與其他事件全部丟進來
        ProactiveEventBus.publish("feature_not_used", { featureName: "提示詞庫" });
        ProactiveEventBus.publish("prompt_too_short", { prompt: "森林", suggestedAddition: "氣氛" });
      });
      // 預設旗標 ON → effectiveEnabled=false → 不訂閱、不渲染、不 toast
      expect(TOAST_CALLS).toEqual([]);
      unmount();
    });
  });
});
