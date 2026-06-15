// @vitest-environment jsdom
/**
 * BrandLockBadge · 品牌鎖定狀態徽章（U-6 / AIDV-96，屬 U-2/AIDV-92 逐殼採用 · /social 第 5 片）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有 shadcn Badge＝零變化（未進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 Pill（進 .aidv-kit 範圍；狀態文字都在）。
 * 設計門依據（ui-ux-pro-max）：色彩非唯一資訊(High)——兩版皆以文字呈現鎖定狀態。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));

import { BrandLockBadge } from "./BrandLockBadge";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("BrandLockBadge（U-6 / AIDV-96 · /social 逐殼採用第 5 片）", () => {
  it("旗標 OFF（預設）：已鎖定 → 既有 Badge，文字在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<BrandLockBadge locked lockState="draft" />);
    expect(screen.getByText("已鎖定")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 OFF：未鎖 → 顯示原始 lockState 文字（零變化）", () => {
    flags.chrome = false;
    render(<BrandLockBadge locked={false} lockState="draft" />);
    expect(screen.getByText("draft")).toBeTruthy();
  });

  it("旗標 ON：改用 design-kit Pill（進 .aidv-kit 範圍；狀態文字都在）", () => {
    flags.chrome = true;
    const { container } = render(<BrandLockBadge locked lockState="draft" />);
    expect(screen.getByText("已鎖定")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});
