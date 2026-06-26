// @vitest-environment jsdom
/**
 * AidvShellChrome（U-4 殼層 chrome 視覺實裝，AIDV-94 · flag-gated）行為測試。
 * 守住：路徑→shell 推導、Rail 選殼導航、⌘K 命令面板、接真實資料（專案名／積分）、
 * ProjectSwitcher 下拉切換專案（U-4 第三片）。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({ navigate: vi.fn(), setActive: vi.fn(), logout: vi.fn(), setProvider: vi.fn(), setAppearanceMode: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => ["/video/director", h.navigate] }));
vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ logout: h.logout }) }));
vi.mock("@/spine/useCreativeProject", () => ({
  useCreativeProject: () => ({ activeProjectId: 1, activeProject: null, setActiveProjectId: h.setActive }),
}));
vi.mock("@/providers/SpineProvider", () => ({
  useSpine: () => ({ provider: "hf", setProvider: h.setProvider, faults: {}, flags: {} }),
}));
vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ setAppearanceMode: h.setAppearanceMode, appearanceMode: "system", theme: "light", switchable: true }),
}));
const h2 = vi.hoisted(() => ({ compileMutate: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    creativeProject: { list: { useQuery: () => ({ data: [{ id: 1, title: "雪山專案", status: "production" }, { id: 2, title: "森林專案", status: "concept" }] }) } },
    credits: { myBalance: { useQuery: () => ({ data: { remaining: 500 } }) } },
    contextPacket: {
      getLatest: { useQuery: () => ({ data: { tokenEstimate: 1024, expiresAt: new Date(Date.now() + 20 * 60_000).toISOString() } }) },
      compileProject: { useMutation: () => ({ mutate: h2.compileMutate }) },
    },
  },
}));

import { AidvShellChrome, shellFromPath } from "./AidvShellChrome";

beforeEach(() => {
  h.navigate.mockReset();
  h.setActive.mockReset();
  h.logout.mockReset();
  h.setAppearanceMode.mockReset();
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

  it("⌘K 分組指令：點『導演企劃台』→ /director", () => {
    render(<AidvShellChrome />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(screen.getByText("導演企劃台"));
    expect(h.navigate).toHaveBeenCalledWith("/director");
  });

  it("⌘K 帳號指令：點『登出』→ 呼叫 logout（P1 修：chrome 取代 AppleDock 後保留登出）", () => {
    render(<AidvShellChrome />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(screen.getByText("登出"));
    expect(h.logout).toHaveBeenCalledTimes(1);
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

  it("ProjectSwitcher：切換專案同時觸發 contextPacket.compileProject（AIDV-134）", () => {
    render(<AidvShellChrome />);
    fireEvent.click(screen.getByText("雪山專案"));
    fireEvent.click(screen.getByText("森林專案"));
    expect(h2.compileMutate).toHaveBeenCalledWith({ projectId: 2, mode: "director" });
  });

  // AIDV-136：⌘K 代理動作群組（排程生成所有就緒鏡/重建 Context Packet/研究 i2v 一致性/自訂工作流）
  it("⌘K 代理動作群組：顯示『排程生成所有就緒鏡』且點擊後導航到影片殼層", () => {
    render(<AidvShellChrome />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByText("排程生成所有就緒鏡")).toBeTruthy();
    fireEvent.click(screen.getByText("排程生成所有就緒鏡"));
    expect(h.navigate).toHaveBeenCalledWith("/video");
  });

  // AIDV-136：⌘K 主題群組（淺色/深色/跟隨系統/自動）
  it("⌘K 主題群組：點『深色主題』→ setAppearanceMode('dark')", () => {
    render(<AidvShellChrome />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(screen.getByText("深色主題"));
    expect(h.setAppearanceMode).toHaveBeenCalledWith("dark");
  });

  it("⌘K 主題群組：點『跟隨系統』→ setAppearanceMode('system')", () => {
    render(<AidvShellChrome />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(screen.getByText("跟隨系統"));
    expect(h.setAppearanceMode).toHaveBeenCalledWith("system");
  });
});
