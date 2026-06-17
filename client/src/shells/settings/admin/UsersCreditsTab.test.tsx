// @vitest-environment jsdom
/**
 * UsersCreditsTab · UserIdentity（U-2 / AIDV-92 逐殼採用 · /settings · Admin RBAC）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有身分列＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit AdminUserRow（進 .aidv-kit 範圍；名稱/email/角色都在）。
 * 只測 UserIdentity（純展示）；積分與 +500/-100/角色下拉等控制項由面板保留，不在本元件範圍。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));
vi.mock("../rbac", () => ({ useRole: () => "admin" }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { UserIdentity } from "./UsersCreditsTab";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("UsersCreditsTab · UserIdentity（U-2 / AIDV-92 · /settings）", () => {
  it("旗標 OFF（預設）：既有身分列，名稱/email/角色在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<UserIdentity name="小明" email="ming@example.com" role="leader" />);
    expect(screen.getByText("小明")).toBeTruthy();
    expect(screen.getByText("ming@example.com")).toBeTruthy();
    expect(screen.getByText(/leader/)).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit AdminUserRow（進 .aidv-kit 範圍；名稱/email/角色保留）", () => {
    flags.chrome = true;
    const { container } = render(<UserIdentity name="小明" email="ming@example.com" role="leader" />);
    expect(screen.getByText("小明")).toBeTruthy();
    expect(screen.getByText("ming@example.com")).toBeTruthy();
    expect(screen.getByText("leader")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});
