// @vitest-environment jsdom
/**
 * BrandKitPanel · BrandGateFlags（U-6 / AIDV-96，屬 U-2/AIDV-92 逐殼採用 · /social 第 4 片）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有 Badge 閘門旗標列＝零變化（未進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 Pill（進 .aidv-kit 範圍；標籤都在）。
 * 設計門依據（ui-ux-pro-max）：色彩非唯一資訊(High)——兩版皆有文字標籤，不單靠顏色。
 * 只測 BrandGateFlags（純展示）；空陣列回 null（不渲染）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));

import { BrandGateFlags } from "./BrandKitPanel";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("BrandKitPanel · BrandGateFlags（U-6 / AIDV-96 · /social 逐殼採用第 4 片）", () => {
  it("旗標 OFF（預設）：既有 Badge 旗標列，標籤在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<BrandGateFlags flags={["missing_logo", "low_contrast"]} />);
    expect(screen.getByText("缺 logo")).toBeTruthy();
    expect(screen.getByText("對比未達 AA（可覆寫）")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit Pill（進 .aidv-kit 範圍；標籤都在）", () => {
    flags.chrome = true;
    const { container } = render(<BrandGateFlags flags={["missing_logo", "low_contrast"]} />);
    expect(screen.getByText("缺 logo")).toBeTruthy();
    expect(screen.getByText("對比未達 AA（可覆寫）")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });

  it("空陣列：不渲染（回 null）", () => {
    flags.chrome = true;
    const { container } = render(<BrandGateFlags flags={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
