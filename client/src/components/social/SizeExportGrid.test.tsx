// @vitest-environment jsdom
/**
 * SizeExportGrid · ExportGroupTabs（U-6 / AIDV-96，屬 U-2/AIDV-92 逐殼採用 · /social 第 2 片）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有 pill 按鈕群組濾鏡＝零變化（4 個 button，未進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 SubTabs（進 .aidv-kit 範圍；tablist + 4 tab，標籤都在）。
 * 設計門依據（ui-ux-pro-max）：色彩非唯一資訊(High)——兩版皆保留文字標籤＋選取態語意。
 * 只測 ExportGroupTabs（純展示/純選取）；不渲染整個格（避免拉進 composeLayout 預覽）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));

import { ExportGroupTabs } from "./SizeExportGrid";
import { GROUP_LABEL } from "@/social/sizePresets";

afterEach(() => { cleanup(); flags.chrome = false; });

const LABELS = [GROUP_LABEL.social, GROUP_LABEL.story, GROUP_LABEL.messaging, GROUP_LABEL.print];

describe("SizeExportGrid · ExportGroupTabs（U-6 / AIDV-96 · /social 逐殼採用第 2 片）", () => {
  it("旗標 OFF（預設）：既有 pill 按鈕群組濾鏡，4 個 button、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<ExportGroupTabs group="social" onSelect={() => {}} />);
    for (const l of LABELS) expect(screen.getByText(l)).toBeTruthy();
    expect(container.querySelectorAll("button")).toHaveLength(4);
    expect(container.querySelector(".aidv-kit")).toBeNull();
    expect(container.querySelector("[role='tablist']")).toBeNull();
  });

  it("旗標 ON：改用 design-kit SubTabs（進 .aidv-kit 範圍；tablist + 4 個 tab、標籤都在）", () => {
    flags.chrome = true;
    const { container } = render(<ExportGroupTabs group="social" onSelect={() => {}} />);
    for (const l of LABELS) expect(screen.getByText(l)).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
    expect(container.querySelector("[role='tablist']")).not.toBeNull();
    expect(container.querySelectorAll("[role='tab']")).toHaveLength(4);
  });

  it("旗標 ON：點群組回傳對應 PresetGroup id（選取邏輯不變）", () => {
    flags.chrome = true;
    let picked = "";
    render(<ExportGroupTabs group="social" onSelect={(g) => { picked = g; }} />);
    (screen.getByText(GROUP_LABEL.print).closest("button") as HTMLButtonElement).click();
    expect(picked).toBe("print");
  });
});
