// @vitest-environment jsdom
/**
 * ContentTab · StatRow（U-2 / AIDV-92 逐殼採用 · /settings · Admin RBAC）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有 label＋Badge＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 SettingRow＋Pill（進 .aidv-kit 範圍；label/數值都在）。
 * 只測 StatRow（純展示）；面板的 trpc/wouter 以最小 mock 隔離，避免載入重相依。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));
vi.mock("wouter", () => ({ useLocation: () => ["", () => {}] }));

import { StatRow } from "./ContentTab";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("ContentTab · StatRow（U-2 / AIDV-92 · /settings）", () => {
  it("旗標 OFF（預設）：既有 label＋Badge，label/數值在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<StatRow label="模型總數" value={128} />);
    expect(screen.getByText("模型總數")).toBeTruthy();
    expect(screen.getByText("128")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit SettingRow＋Pill（進 .aidv-kit 範圍；label/數值保留）", () => {
    flags.chrome = true;
    const { container } = render(<StatRow label="模型總數" value={128} />);
    expect(screen.getByText("模型總數")).toBeTruthy();
    expect(screen.getByText("128")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});
