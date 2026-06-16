// @vitest-environment jsdom
/**
 * AidvOrbMount（AIDV-114 第3片）— U-11 新光球真站掛載 wrapper 行為測試。
 * 守住：靜態示範內容下，FAB 渲染、點開面板、本頁分頁示範提示與 Flow 展示牆可見。
 * 旗標 gate（ENABLE_AIDV_CHROME）由 DashboardLayout 控制，非本元件職責。
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { AidvOrbMount } from "./AidvOrbMount";

afterEach(() => cleanup());

describe("AidvOrbMount（U-11 / AIDV-114 第3片）", () => {
  it("掛載：渲染光球 FAB（aria-expanded 預設 false）", () => {
    render(<AidvOrbMount />);
    const fab = screen.getByRole("button", { name: "光球助手" });
    expect(fab).toBeTruthy();
    expect(fab.getAttribute("aria-expanded")).toBe("false");
  });

  it("點 FAB → 開面板，本頁分頁顯示示範情境提示＋Flow 展示牆", () => {
    render(<AidvOrbMount />);
    fireEvent.click(screen.getByRole("button", { name: "光球助手" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/另一種型態/)).toBeTruthy();
    expect(screen.getByText("Flow 展示牆")).toBeTruthy();
    expect(screen.getByText("成片工作流（示範）")).toBeTruthy();
  });
});
