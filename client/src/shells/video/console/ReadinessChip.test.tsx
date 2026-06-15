// @vitest-environment jsdom
/**
 * ReadinessChip（U-2 / AIDV-92 逐殼採用 · /video）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有 Tailwind chip＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 ReadinessChip / Pill（進 .aidv-kit 範圍、文字標籤保留）。
 * 設計門依據（ui-ux-pro-max）：狀態不可只靠顏色——兩版皆保留文字標籤。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({
  get ENABLE_AIDV_CHROME() { return flags.chrome; },
}));

import { ReadinessChip, ApprovedChip } from "./ReadinessChip";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("ReadinessChip（U-2 / AIDV-92 · /video）", () => {
  it("旗標 OFF（預設）：既有 Tailwind chip，文字標籤在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<ReadinessChip state="ready" label="可量產" />);
    expect(screen.getByText("可量產")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit chip（進 .aidv-kit 範圍、保留文字標籤）", () => {
    flags.chrome = true;
    const { container } = render(<ReadinessChip state="partial" label="待補" />);
    expect(screen.getByText("待補")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });

  it("旗標 ON：可點擊 → 觸發 onClick（design-kit 自帶按鈕）", () => {
    flags.chrome = true;
    const onClick = vi.fn();
    render(<ReadinessChip state="blocked" label="擋下" onClick={onClick} />);
    fireEvent.click(screen.getByText("擋下"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("ApprovedChip：OFF 既有版 / ON 進設計套件範圍；兩者皆有『已核准』文字", () => {
    flags.chrome = false;
    const off = render(<ApprovedChip />);
    expect(screen.getByText("已核准")).toBeTruthy();
    expect(off.container.querySelector(".aidv-kit")).toBeNull();
    off.unmount();

    flags.chrome = true;
    const { container } = render(<ApprovedChip />);
    expect(screen.getByText("已核准")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});
