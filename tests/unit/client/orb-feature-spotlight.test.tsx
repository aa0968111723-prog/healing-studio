// @vitest-environment jsdom
/**
 * orb-feature-spotlight.test.tsx
 *
 * Verifies the discoverability tip-card behavior:
 *   - Hidden until chat opens AND dwell timer elapses
 *   - Cycles through tips one at a time
 *   - localStorage-persisted dismissals survive remount
 *   - "不再顯示" disables the whole series
 *   - "試試看" example fires onTry callback
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import OrbFeatureSpotlight, {
  __SPOTLIGHT_TIPS_FOR_TESTS,
  __unsafe_resetSpotlightStateForTests,
} from "../../../client/src/components/orb/OrbFeatureSpotlight";

beforeEach(() => {
  __unsafe_resetSpotlightStateForTests();
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  __unsafe_resetSpotlightStateForTests();
  vi.useRealTimers();
});

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("OrbFeatureSpotlight", () => {
  it("renders nothing until chat is open AND dwell timer elapses", () => {
    const { rerender } = render(<OrbFeatureSpotlight isChatOpen={false} />);
    expect(screen.queryByTestId("orb-feature-spotlight")).toBeNull();

    rerender(<OrbFeatureSpotlight isChatOpen={true} />);
    // Still hidden right after opening
    expect(screen.queryByTestId("orb-feature-spotlight")).toBeNull();

    advance(13_000);
    expect(screen.queryByTestId("orb-feature-spotlight")).not.toBeNull();
  });

  it("cycles through tips when user clicks 下一個 / X", () => {
    render(<OrbFeatureSpotlight isChatOpen={true} />);
    advance(13_000);

    // First tip is the search shortcut — has an example with onTry undefined,
    // so the fallback button is "下一個".
    const card = screen.getByTestId("orb-feature-spotlight");
    expect(card.textContent).toContain("全站搜尋快捷");

    // Dismiss → next tip should appear (after the new dwell timer).
    fireEvent.click(card.querySelector('button[aria-label="略過這張提示"]')!);
    advance(13_000);

    const second = screen.getByTestId("orb-feature-spotlight");
    expect(second.textContent).toContain("光球記得你");
  });

  it("hides entirely after 不再顯示 + persists across remount", () => {
    const { unmount } = render(<OrbFeatureSpotlight isChatOpen={true} />);
    advance(13_000);

    fireEvent.click(screen.getByText("不再顯示"));
    expect(screen.queryByTestId("orb-feature-spotlight")).toBeNull();

    unmount();
    render(<OrbFeatureSpotlight isChatOpen={true} />);
    advance(13_000);
    expect(screen.queryByTestId("orb-feature-spotlight")).toBeNull();
  });

  it("calls onTry with the example phrase when 試試看 is clicked", () => {
    const onTry = vi.fn();
    render(<OrbFeatureSpotlight isChatOpen={true} onTry={onTry} />);
    advance(13_000);

    const tryBtn = screen.getByTestId("orb-feature-spotlight-try");
    fireEvent.click(tryBtn);
    expect(onTry).toHaveBeenCalledWith("找我之前的森林圖");
  });

  it("renders no card when every tip has been dismissed", () => {
    render(<OrbFeatureSpotlight isChatOpen={true} />);
    advance(13_000);

    for (let i = 0; i < __SPOTLIGHT_TIPS_FOR_TESTS.length; i++) {
      const card = screen.getByTestId("orb-feature-spotlight");
      const dismissBtn = card.querySelector('button[aria-label="略過這張提示"]');
      fireEvent.click(dismissBtn!);
      advance(13_000);
    }
    expect(screen.queryByTestId("orb-feature-spotlight")).toBeNull();
  });
});
