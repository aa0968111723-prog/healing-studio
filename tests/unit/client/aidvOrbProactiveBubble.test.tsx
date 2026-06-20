/**
 * aidvOrbProactiveBubble.test.tsx
 *
 * Locks「光球只留笑臉光球」for the second (design-kit) orb mount:
 *
 *   1. AidvOrbView 預設（proactiveBubble 未傳＝true）會冒出「我在這裡…」主動泡泡
 *      （點開面板後 role="status" 泡泡可見）。
 *   2. proactiveBubble=false（ORB_SMILEY_ONLY ON 時容器會這樣傳）時：
 *      光球本體仍在（FAB 仍渲染、點開仍可用），但**不再有主動泡泡**
 *      ＝第二顆光球不主動跳出提示，符合「只留笑臉光球」的乾淨畫面。
 *
 * AidvOrbView 是純 props-driven 呈現元件（不需 provider / tRPC），可直接 render。
 * 主動泡泡用 design-kit ProactiveBubble 的 role="status" 容器定位（穩定、不靠文字切片）。
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { render, fireEvent, within, cleanup } from "@testing-library/react";

import { AidvOrbView, type AidvOrbViewProps } from "../../../client/src/shells/AidvOrbMount";

// 沒有全域 auto-cleanup 設定 → 每個 test 後手動清，避免上一個 render 殘留在 body。
afterEach(() => cleanup());

function baseProps(overrides: Partial<AidvOrbViewProps> = {}): AidvOrbViewProps {
  return {
    mood: "idle",
    pageLabel: "影片工作室",
    chatMsgs: [],
    prompts: { state: "empty", items: [] },
    credits: { state: "ready", remaining: 100, usedPct: 10 },
    onOpenNotes: () => {},
    ...overrides,
  };
}

/** 點開光球面板（FAB 的 aria-label 是「光球助手」）。 */
function openPanel(container: HTMLElement) {
  const fab = within(container).getByRole("button", { name: "光球助手" });
  fireEvent.click(fab);
}

describe("AidvOrbView — 主動泡泡 gate（光球只留笑臉光球）", () => {
  it("預設（proactiveBubble 未傳）：光球本體 + 主動泡泡都在", () => {
    const { container } = render(<AidvOrbView {...baseProps()} />);
    // 光球本體（FAB）一定在
    expect(within(container).getByRole("button", { name: "光球助手" })).toBeTruthy();
    // 點開面板 → 看得到主動泡泡（role="status"）
    openPanel(container);
    expect(within(container).queryByRole("status")).not.toBeNull();
  });

  it("proactiveBubble=true：明確開啟也有主動泡泡", () => {
    const { container } = render(<AidvOrbView {...baseProps({ proactiveBubble: true })} />);
    openPanel(container);
    expect(within(container).queryByRole("status")).not.toBeNull();
  });

  it("proactiveBubble=false（ORB_SMILEY_ONLY ON）：光球本體留著，但主動泡泡不再冒出", () => {
    const { container } = render(<AidvOrbView {...baseProps({ proactiveBubble: false })} />);
    // 光球本體（FAB）仍在＝可點開使用，功能不被移除
    expect(within(container).getByRole("button", { name: "光球助手" })).toBeTruthy();
    // 點開面板 → 不再有主動泡泡（role="status"）
    openPanel(container);
    expect(within(container).queryByRole("status")).toBeNull();
  });
});
