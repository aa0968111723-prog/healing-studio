// @vitest-environment jsdom
/**
 * Unit tests for the OrbGuide arrival-card flow:
 *   - attachArrivalGuide() synthesises a plan + flips step into navigating → arrived
 *   - buildDefaultArrivalChoices() returns sensible choices for known landing pages
 *   - dismissArrival cleans up the in-flight 600ms timer + clears plan state
 *
 * The chat-driven and starter-click navigation paths both depend on this
 * primitive — these tests guard the contract so a regression in either entry
 * point is caught at the unit layer instead of in manual QA.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  OrbGuideProvider,
  useOrbGuide,
} from "../../../client/src/contexts/OrbGuideContext";

function wrapper({ children }: { children: ReactNode }) {
  return <OrbGuideProvider>{children}</OrbGuideProvider>;
}

describe("OrbGuideContext.attachArrivalGuide", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flips the panel into navigating, then arrived after 600ms", () => {
    const { result } = renderHook(() => useOrbGuide(), { wrapper });

    expect(result.current.step).toBe("idle");
    expect(result.current.isPanelOpen).toBe(false);

    act(() => {
      result.current.attachArrivalGuide({
        targetPath: "/image-studio",
        targetLabel: "圖像工作室",
      });
    });

    expect(result.current.step).toBe("navigating");
    expect(result.current.isPanelOpen).toBe(true);
    expect(result.current.plan?.targetPath).toBe("/image-studio");
    expect(result.current.plan?.targetLabel).toBe("圖像工作室");

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(result.current.step).toBe("arrived");
  });

  it("auto-resolves the targetLabel from the app registry when omitted", () => {
    const { result } = renderHook(() => useOrbGuide(), { wrapper });

    act(() => {
      // Exact-path match must win over the normalize-fallback so the user
      // sees "提示詞庫", not the first /assets entry ("生成歷史").
      result.current.attachArrivalGuide({
        targetPath: "/assets?section=prompts",
      });
    });

    expect(result.current.plan?.targetLabel).toBe("提示詞庫");
  });

  it("falls back to the normalized registry entry when no exact match exists", () => {
    const { result } = renderHook(() => useOrbGuide(), { wrapper });

    act(() => {
      // /image-studio/foo isn't in the registry but normalizes via the
      // existing helper to /image-studio.
      result.current.attachArrivalGuide({ targetPath: "/image-studio" });
    });

    expect(result.current.plan?.targetLabel).toBe("圖片創作室");
  });

  it("populates default arrival choices for known prompt-library landing", () => {
    const { result } = renderHook(() => useOrbGuide(), { wrapper });

    act(() => {
      result.current.attachArrivalGuide({
        targetPath: "/assets?section=prompts",
      });
    });

    const choices = result.current.plan?.arrivalChoices ?? [];
    expect(choices.length).toBeGreaterThanOrEqual(3);
    // image-category choice must use setParam(category=image), not text search,
    // because PromptLibraryPage filters by category for accurate results.
    const imageChoice = choices.find(c => c.id === "prompts-image");
    expect(imageChoice?.actions[0]).toEqual({
      type: "setParam",
      key: "category",
      value: "image",
    });
  });

  it("populates default arrival choices for image-studio with fillPrompt actions", () => {
    const { result } = renderHook(() => useOrbGuide(), { wrapper });

    act(() => {
      result.current.attachArrivalGuide({ targetPath: "/image-studio" });
    });

    const choices = result.current.plan?.arrivalChoices ?? [];
    expect(choices.length).toBeGreaterThanOrEqual(3);
    expect(choices.every(c => c.actions[0].type === "fillPrompt")).toBe(true);
  });

  it("returns no defaults for paths not in the lookup table", () => {
    const { result } = renderHook(() => useOrbGuide(), { wrapper });

    act(() => {
      result.current.attachArrivalGuide({ targetPath: "/notes" });
    });

    expect(result.current.plan?.arrivalChoices).toBeUndefined();
  });

  it("respects explicit arrivalChoices override", () => {
    const { result } = renderHook(() => useOrbGuide(), { wrapper });

    act(() => {
      result.current.attachArrivalGuide({
        targetPath: "/image-studio",
        arrivalChoices: [
          {
            id: "custom-only",
            label: "自訂選項",
            actions: [{ type: "fillPrompt", text: "custom" }],
          },
        ],
      });
    });

    expect(result.current.plan?.arrivalChoices).toEqual([
      {
        id: "custom-only",
        label: "自訂選項",
        actions: [{ type: "fillPrompt", text: "custom" }],
      },
    ]);
  });

  it("re-attaching with a different path resets timer and step", () => {
    const { result } = renderHook(() => useOrbGuide(), { wrapper });

    act(() => {
      result.current.attachArrivalGuide({ targetPath: "/image-studio" });
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // Mid-flight: still navigating
    expect(result.current.step).toBe("navigating");

    act(() => {
      result.current.attachArrivalGuide({ targetPath: "/video-studio" });
    });
    // Re-attach resets to navigating with the new plan
    expect(result.current.step).toBe("navigating");
    expect(result.current.plan?.targetPath).toBe("/video-studio");

    // The original 300ms-already-elapsed timer must NOT prematurely flip to
    // arrived — i.e. only 300ms more should not be enough; we need 600.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.step).toBe("navigating");

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.step).toBe("arrived");
  });

  it("dismissArrival cancels the pending arrival timer", () => {
    const { result } = renderHook(() => useOrbGuide(), { wrapper });

    act(() => {
      result.current.attachArrivalGuide({ targetPath: "/image-studio" });
    });
    expect(result.current.step).toBe("navigating");

    act(() => {
      result.current.dismissArrival();
    });
    expect(result.current.step).toBe("idle");
    expect(result.current.isPanelOpen).toBe(false);
    expect(result.current.plan).toBeNull();

    // Even after the original 600ms elapses, step must stay idle — the
    // timer was cancelled, not just suppressed.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.step).toBe("idle");
  });

  it("uses provided manualSteps verbatim", () => {
    const { result } = renderHook(() => useOrbGuide(), { wrapper });

    act(() => {
      result.current.attachArrivalGuide({
        targetPath: "/image-studio",
        manualSteps: [
          { id: "step-1", label: "上傳一張參考圖" },
          { id: "step-2", label: "按生成" },
        ],
      });
    });

    expect(result.current.plan?.manualSteps).toEqual([
      { id: "step-1", label: "上傳一張參考圖" },
      { id: "step-2", label: "按生成" },
    ]);
  });

  it("populates default arrival choices for /director (setTab + applyPreset only — no auto-fillPrompt)", () => {
    const { result } = renderHook(() => useOrbGuide(), { wrapper });

    act(() => {
      result.current.attachArrivalGuide({ targetPath: "/director" });
    });

    const choices = result.current.plan?.arrivalChoices ?? [];
    expect(choices.length).toBeGreaterThanOrEqual(3);
    // Director's fillPrompt is "send immediately" — including it in arrival
    // choices would post the user's text without consent. Only safe actions
    // (setTab / applyPreset) should appear.
    expect(
      choices.every(c => c.actions.every(a => a.type === "setTab" || a.type === "applyPreset"))
    ).toBe(true);
  });

  it("populates default arrival choices for /studio with setModality actions", () => {
    const { result } = renderHook(() => useOrbGuide(), { wrapper });

    act(() => {
      result.current.attachArrivalGuide({ targetPath: "/studio" });
    });

    const choices = result.current.plan?.arrivalChoices ?? [];
    expect(choices.length).toBeGreaterThanOrEqual(4);
    expect(choices.every(c => c.actions[0].type === "setModality")).toBe(true);
  });

  it("populates default arrival choices for /agent with navigate actions that dismiss on click", () => {
    const { result } = renderHook(() => useOrbGuide(), { wrapper });

    act(() => {
      result.current.attachArrivalGuide({ targetPath: "/agent" });
    });

    const choices = result.current.plan?.arrivalChoices ?? [];
    expect(choices.length).toBeGreaterThanOrEqual(3);
    expect(choices.every(c => c.actions[0].type === "navigate")).toBe(true);
    // Each navigate-style choice must dismiss on click — leaving the old card
    // hovering on the new page would conflict with that page's own arrival.
    expect(choices.every(c => c.dismissOnSelect === true)).toBe(true);
  });

  it("falls back to default manualSteps for /director when caller provides none", () => {
    const { result } = renderHook(() => useOrbGuide(), { wrapper });

    act(() => {
      result.current.attachArrivalGuide({ targetPath: "/director" });
    });

    const steps = result.current.plan?.manualSteps ?? [];
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps[0]?.id).toBe("director-send");
  });

  it("falls back to default manualSteps for /image-studio (review prompt + click generate)", () => {
    const { result } = renderHook(() => useOrbGuide(), { wrapper });

    act(() => {
      result.current.attachArrivalGuide({ targetPath: "/image-studio" });
    });

    const steps = result.current.plan?.manualSteps ?? [];
    expect(steps.map(s => s.id)).toEqual(["review-prompt", "click-generate"]);
  });

  it("returns empty manualSteps for paths without a default mapping", () => {
    const { result } = renderHook(() => useOrbGuide(), { wrapper });

    act(() => {
      result.current.attachArrivalGuide({ targetPath: "/notes" });
    });

    expect(result.current.plan?.manualSteps).toEqual([]);
  });
});
