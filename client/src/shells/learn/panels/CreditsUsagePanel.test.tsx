// @vitest-environment jsdom
/**
 * CreditsUsagePanel · MiniStat（U-2 / AIDV-92 逐殼採用 · /learn）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有小統計＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 StatCard（進 .aidv-kit 範圍；label/value 都在）。
 * 設計門依據（ui-ux-pro-max）：Number Formatting——數值由呼叫端格式化後傳入，兩版皆原樣呈現。
 * 只測 MiniStat（純展示）；面板的 trpc 以最小 mock 隔離。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));

import { MiniStat } from "./CreditsUsagePanel";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("CreditsUsagePanel · MiniStat（U-2 / AIDV-92 · /learn）", () => {
  it("旗標 OFF（預設）：既有小統計，label/value 在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<MiniStat label="本期請求" value="1,234" />);
    expect(screen.getByText("本期請求")).toBeTruthy();
    expect(screen.getByText("1,234")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit StatCard（進 .aidv-kit 範圍；label/value 保留、千分位原樣）", () => {
    flags.chrome = true;
    const { container } = render(<MiniStat label="本期請求" value="1,234" />);
    expect(screen.getByText("本期請求")).toBeTruthy();
    expect(screen.getByText("1,234")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});
