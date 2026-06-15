// @vitest-environment jsdom
/**
 * ObservabilityPanel · Stat（U-2 / AIDV-92 逐殼採用 · /settings）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有小統計卡＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 StatCard（進 .aidv-kit 範圍；label/value 都在）。
 * 只測 Stat（純展示）；面板的 trpc/rbac 以最小 mock 隔離，避免載入重相依。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));
vi.mock("../rbac", () => ({ useRole: () => "user", roleAtLeast: () => false }));

import { Stat } from "./ObservabilityPanel";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("ObservabilityPanel · Stat（U-2 / AIDV-92 · /settings）", () => {
  it("旗標 OFF（預設）：既有小統計卡，label/value 在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<Stat label="總使用者" value="1,234" />);
    expect(screen.getByText("總使用者")).toBeTruthy();
    expect(screen.getByText("1,234")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit StatCard（進 .aidv-kit 範圍；label/value 保留）", () => {
    flags.chrome = true;
    const { container } = render(<Stat label="總使用者" value="1,234" />);
    expect(screen.getByText("總使用者")).toBeTruthy();
    expect(screen.getByText("1,234")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});
