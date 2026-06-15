// @vitest-environment jsdom
/**
 * AidvShellChrome（U-4 殼層 chrome 視覺實裝，AIDV-94 · flag-gated）行為測試。
 * 守住：路徑→shell 推導、Rail 選殼導航、⌘K 開命令面板並導航。純前端、design-kit 組合。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => ["/video/director", h.navigate] }));
vi.mock("@/hooks/useMobile", () => ({ useIsMobile: () => false }));

import { AidvShellChrome, shellFromPath } from "./AidvShellChrome";

beforeEach(() => h.navigate.mockReset());
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
});
