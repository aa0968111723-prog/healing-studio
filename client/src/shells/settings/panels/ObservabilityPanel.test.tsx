// @vitest-environment jsdom
/**
 * ObservabilityPanel · Stat（U-8 / AIDV-98 逐殼採用 · /settings；傘卡 U-2 / AIDV-92）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有系統概覽統計卡＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 StatCard（進 .aidv-kit 範圍；label/value 都在）。
 * 設計門依據（ui-ux-pro-max）：Number Formatting——數值由呼叫端格式化後傳入，兩版皆原樣呈現＝零資訊損失。
 * 只測 Stat（純展示）；面板的 trpc/rbac 以最小 mock 隔離，避免載入重相依。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));

import { Stat } from "./ObservabilityPanel";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("ObservabilityPanel · Stat（U-8 / AIDV-98 · /settings）", () => {
  it("旗標 OFF（預設）：既有統計卡，label/value 在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<Stat label="總使用者" value="1,024" />);
    expect(screen.getByText("總使用者")).toBeTruthy();
    expect(screen.getByText("1,024")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit StatCard（進 .aidv-kit 範圍；label/value 保留、千分位原樣）", () => {
    flags.chrome = true;
    const { container } = render(<Stat label="總使用者" value="1,024" />);
    expect(screen.getByText("總使用者")).toBeTruthy();
    expect(screen.getByText("1,024")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});
