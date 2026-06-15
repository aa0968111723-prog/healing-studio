// @vitest-environment jsdom
/**
 * design-kit State 元件（U-10 / AIDV-101 「State 4」）行為測試。
 * 守住：四態的內容、a11y role、與動作回呼（action/onRetry），且純元件不接頁面。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { EmptyState, ErrorState, LoadingState, SkeletonLines } from "./states";

afterEach(() => cleanup());

describe("design-kit State 元件（U-10 / AIDV-101）", () => {
  it("EmptyState：標題＋提示＋動作鈕觸發 onClick", () => {
    const onClick = vi.fn();
    render(<EmptyState title="還沒有專案" hint="從一句話開始" action={{ label: "新建", onClick }} />);
    expect(screen.getByText("還沒有專案")).toBeTruthy();
    expect(screen.getByText("從一句話開始")).toBeTruthy();
    fireEvent.click(screen.getByText("新建"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("ErrorState：role=alert＋訊息＋重試觸發 onRetry", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="讀取失敗" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("讀取失敗")).toBeTruthy();
    fireEvent.click(screen.getByText("重試"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("ErrorState：無 onRetry → 不顯示重試鈕（零誤動作）", () => {
    render(<ErrorState message="x" />);
    expect(screen.queryByText("重試")).toBeNull();
  });

  it("LoadingState：role=status＋自訂 label", () => {
    render(<LoadingState label="載入世界…" />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("載入世界…")).toBeTruthy();
  });

  it("SkeletonLines：依 lines 數渲染對應骨架行", () => {
    render(<SkeletonLines lines={4} />);
    expect(screen.getByRole("status").children.length).toBe(4);
  });
});
