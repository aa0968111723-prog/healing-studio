// @vitest-environment jsdom
/**
 * PanelState（U-2 / AIDV-92「元件採用」）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝沿用既有 shadcn 三態＝線上零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝空/錯誤態改用 design-kit 亮色暖光元件（進 .aidv-kit 範圍、保留 a11y 語意）。
 * compact 錯誤態為單行 inline 版，不論旗標皆維持原樣（避免嵌在面板列內破版）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

// 以可變持有物 mock 旗標，逐測切換 ON/OFF（getter 在 render 時即時讀取）。
const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({
  get ENABLE_AIDV_CHROME() { return flags.chrome; },
}));

import { PanelEmpty, PanelError } from "./PanelState";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("PanelState（U-2 / AIDV-92 元件採用）", () => {
  it("旗標 OFF（預設）：空態用既有 shadcn 版＝零變化（未進設計套件範圍）", () => {
    flags.chrome = false;
    const { container } = render(<PanelEmpty title="目前沒有資料" />);
    expect(screen.getByText("目前沒有資料")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：空態改用 design-kit（進 .aidv-kit 範圍、保留 role=status 與 hint）", () => {
    flags.chrome = true;
    const { container } = render(<PanelEmpty title="目前沒有資料" hint="稍後再來看看" />);
    expect(screen.getByText("目前沒有資料")).toBeTruthy();
    expect(screen.getByText("稍後再來看看")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("旗標 ON：錯誤態用 design-kit ErrorState（role=alert + 可重試）", () => {
    flags.chrome = true;
    const onRetry = vi.fn();
    const { container } = render(<PanelError message="讀取失敗" onRetry={onRetry} />);
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByText("重試"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("compact 錯誤態：不論旗標皆維持單行 inline（不破版、不進設計套件範圍）", () => {
    flags.chrome = true;
    const { container } = render(<PanelError message="讀取失敗" compact />);
    expect(container.querySelector(".aidv-kit")).toBeNull();
    expect(screen.getByText("讀取失敗")).toBeTruthy();
  });
});
