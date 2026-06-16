// @vitest-environment jsdom
/**
 * AIModelHubPanel · StatCard（U-2 / AIDV-92 逐殼採用 · /learn）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有 Card 統計卡＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 StatCard（進 .aidv-kit 範圍；icon 折進 label、label/value 保留）。
 * 只測 StatCard（純展示）；面板的 trpc 不在本測涵蓋。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));

import { StatCard } from "./AIModelHubPanel";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("AIModelHubPanel · StatCard（U-2 / AIDV-92 · /learn）", () => {
  it("旗標 OFF（預設）：既有 Card，label/value 在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<StatCard icon={<i data-testid="ic" />} label="模型總數" value="128" />);
    expect(screen.getByText("模型總數")).toBeTruthy();
    expect(screen.getByText("128")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit StatCard（進 .aidv-kit 範圍；icon/label/value 保留）", () => {
    flags.chrome = true;
    const { container } = render(<StatCard icon={<i data-testid="ic" />} label="模型總數" value="128" />);
    expect(screen.getByText("模型總數")).toBeTruthy();
    expect(screen.getByText("128")).toBeTruthy();
    expect(screen.getByTestId("ic")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});
