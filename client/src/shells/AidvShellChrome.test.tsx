// @vitest-environment jsdom
/**
 * AidvShellChrome（U-4 殼層 chrome 視覺實裝，AIDV-94 · flag-gated）行為測試。
 * 守住：路徑→shell 推導、Rail 選殼導航、⌘K 命令面板、接真實資料（專案名／積分）、
 * ProjectSwitcher 下拉切換專案（U-4 第三片）。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({ navigate: vi.fn(), setActive: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => ["/video/director", h.navigate] }));
vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));
vi.mock("@/spine/useCreativeProject", () => ({
  useCreativeProject: () => ({ activeProjectId: 1, activeProject: null, setActiveProjectId: h.setActive }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    creativeProject: { list: { useQuery: () => ({ data: [{ id: 1, title: "雪山專案" }, { id: 2, title: "森林專案" }] }) } },
    credits: { myBalance: { useQuery: () => ({ data: { remaining: 500 } }) } },
  },
}));

import { AidvShellChrome, shellFromPath } from "./AidvShellChrome";

beforeEach(() => {
  h.navigate.mockReset();
  h.setActive.mockReset();
});
afterEach(() => cleanup());

describe("AidvShellChrome（U-4 / AIDV-94）", () => {
  it("shellFromPath：依路徑前綴推 shell", () => {
    expect(shellFromPath("/video/director")).toBe("video");
    expect(shellFromPath("/settings/admin")).toBe("settings");
    expect(shellFromPath("/learn")).toBe("learn");
    expect(shellFromPath("/")).toBe("video");
  });

  it("Rail 點殼層 → 導航到該 shell 路徑", () => {
    render(<AidvShellChrome />);
    fireEvent.click(screen.getByLabelText("設定"));
    expect(h.navigate).toHaveBeenCalledWith("/settings");
  });

  it("⌘K 開命令面板 → 選項導航到對應 shell", () => {
    render(<AidvShellChrome />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByText("前往 學習文件"));
    expect(h.navigate).toHaveBeenCalledWith("/learn");
  });

  it("接真實資料：TopBar 顯示當前專案名＋積分", () => {
    render(<AidvShellChrome />);
    expect(screen.getByText("雪山專案")).toBeTruthy();
    expect(screen.getByText("500 點")).toBeTruthy(); // Rail 為 "500"，TopBar 為 "500 點"
  });

  it("ProjectSwitcher：展開→選另一專案 → setActiveProjectId(id)", () => {
    render(<AidvShellChrome />);
    fireEvent.click(screen.getByText("雪山專案")); // collapsed pill → 展開下拉
    fireEvent.click(screen.getByText("森林專案")); // 選另一個專案
    expect(h.setActive).toHaveBeenCalledWith(2);
  });
});
