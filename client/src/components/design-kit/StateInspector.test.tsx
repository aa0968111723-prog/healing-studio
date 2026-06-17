// @vitest-environment jsdom
/**
 * StateInspector（U-4f / AIDV-139）行為 + a11y 測試。
 * 守住：四態 segmented control 切換、tablist/tab role、aria-selected、鍵盤左右切換、
 * 受控模式，且純元件唯讀（重用 design-kit 四態元件）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { StateInspector } from "./StateInspector";
import { STATE_INSPECTOR } from "./stateInspectorFlags";

afterEach(() => cleanup());

describe("StateInspector（U-4f / AIDV-139）", () => {
  it("旗標預設 OFF（prod 隱藏、安全回滾）", () => {
    expect(STATE_INSPECTOR).toBe(false);
  });

  it("segmented control：tablist + 四個 tab，預設 loading 被選中", () => {
    render(<StateInspector />);
    const tablist = screen.getByRole("tablist");
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.length).toBe(4);
    const loading = screen.getByRole("tab", { name: "載入" });
    expect(loading.getAttribute("aria-selected")).toBe("true");
    // 載入態：呈現 LoadingState（role=status）。
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });

  it("點擊切到「錯誤」→ aria-selected 更新 + 顯示 ErrorState（role=alert）", () => {
    render(<StateInspector />);
    fireEvent.click(screen.getByRole("tab", { name: "錯誤" }));
    expect(screen.getByRole("tab", { name: "錯誤" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "載入" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("點擊切到「空」→ 顯示 EmptyState 文案", () => {
    render(<StateInspector />);
    fireEvent.click(screen.getByRole("tab", { name: "空" }));
    expect(screen.getByText("還沒有內容")).toBeTruthy();
  });

  it("點擊切到「就緒」→ 顯示就緒文案", () => {
    render(<StateInspector />);
    fireEvent.click(screen.getByRole("tab", { name: "就緒" }));
    // 「就緒」同時是分頁標籤與面板標題，鎖定 tabpanel 內文案避免多重命中。
    expect(within(screen.getByRole("tabpanel")).getByText("就緒")).toBeTruthy();
  });

  it("鍵盤 ArrowRight 從 loading 切到 empty（roving tabindex）", () => {
    render(<StateInspector />);
    const loading = screen.getByRole("tab", { name: "載入" });
    fireEvent.keyDown(loading, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "空" }).getAttribute("aria-selected")).toBe("true");
  });

  it("鍵盤 End 跳到最後一態、Home 回到第一態", () => {
    render(<StateInspector />);
    const loading = screen.getByRole("tab", { name: "載入" });
    fireEvent.keyDown(loading, { key: "End" });
    expect(screen.getByRole("tab", { name: "就緒" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "就緒" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "載入" }).getAttribute("aria-selected")).toBe("true");
  });

  it("tabpanel 由當前 tab aria-labelledby 關聯（a11y 接線）", () => {
    render(<StateInspector />);
    const panel = screen.getByRole("tabpanel");
    const labelledby = panel.getAttribute("aria-labelledby");
    const loading = screen.getByRole("tab", { name: "載入" });
    expect(labelledby).toBe(loading.getAttribute("id"));
  });

  it("選中 tab tabIndex=0、其餘 -1（roving tabindex）", () => {
    render(<StateInspector />);
    expect(screen.getByRole("tab", { name: "載入" }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tab", { name: "錯誤" }).getAttribute("tabindex")).toBe("-1");
  });

  it("受控模式：state prop 指定，點擊只回呼 onStateChange、不改自身顯示", () => {
    const onStateChange = vi.fn();
    render(<StateInspector state="empty" onStateChange={onStateChange} />);
    expect(screen.getByRole("tab", { name: "空" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "錯誤" }));
    expect(onStateChange).toHaveBeenCalledWith("error");
    // 受控：未換 state prop → 顯示維持「空」。
    expect(screen.getByRole("tab", { name: "空" }).getAttribute("aria-selected")).toBe("true");
  });
});
