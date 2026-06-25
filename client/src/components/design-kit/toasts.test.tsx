// @vitest-environment jsdom
/**
 * Toast 通知系統（U-4d / AIDV-137）行為測試。
 * · ToastProvider + useToast：show/toast.ok/warn/bad/info 推入；dismiss 移除。
 * · Toasts 容器：空時不渲染；有 toast 時出現；點×手動關閉；4.8s 後自動消失。
 * · a11y：bad → role="status" + aria-live="assertive"；其餘 polite。
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, act } from "@testing-library/react";
import * as React from "react";
import { ToastProvider, Toasts, useToast } from "./toasts";

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      {children}
      <Toasts />
    </ToastProvider>
  );
}

function ShowButton({ kind, title, msg }: { kind: "ok" | "warn" | "bad" | "info"; title: string; msg?: string }) {
  const { toast } = useToast();
  return <button onClick={() => toast[kind](title, msg)}>show</button>;
}

describe("Toast 通知系統（U-4d / AIDV-137）", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it("空態：無 toast 時 Toasts 不渲染任何 DOM", () => {
    const { container } = render(<Wrapper><div /></Wrapper>);
    expect(container.querySelector("[aria-label='通知佇列']")).toBeNull();
  });

  it("show ok → toast 出現，title 可見", () => {
    render(
      <Wrapper>
        <ShowButton kind="ok" title="生成成功" msg="-5 積分" />
      </Wrapper>,
    );
    fireEvent.click(screen.getByText("show"));
    expect(screen.getByText("生成成功")).toBeTruthy();
    expect(screen.getByText("-5 積分")).toBeTruthy();
  });

  it("show bad → 可見；role=status + aria-live=assertive", () => {
    render(<Wrapper><ShowButton kind="bad" title="生成失敗" /></Wrapper>);
    fireEvent.click(screen.getByText("show"));
    const el = screen.getByText("生成失敗").closest("[role='status']");
    expect(el).not.toBeNull();
    expect(el!.getAttribute("aria-live")).toBe("assertive");
  });

  it("show warn/info → aria-live=polite", () => {
    render(<Wrapper><ShowButton kind="warn" title="引擎切換" /></Wrapper>);
    fireEvent.click(screen.getByText("show"));
    const el = screen.getByText("引擎切換").closest("[role='status']");
    expect(el!.getAttribute("aria-live")).toBe("polite");
  });

  it("點×關閉 → toast 立即消失", () => {
    render(<Wrapper><ShowButton kind="info" title="提示訊息" /></Wrapper>);
    fireEvent.click(screen.getByText("show"));
    expect(screen.getByText("提示訊息")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("關閉通知"));
    expect(screen.queryByText("提示訊息")).toBeNull();
  });

  it("4.8s 後自動消失", () => {
    render(<Wrapper><ShowButton kind="ok" title="自動消失" /></Wrapper>);
    fireEvent.click(screen.getByText("show"));
    expect(screen.getByText("自動消失")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4800); });
    expect(screen.queryByText("自動消失")).toBeNull();
  });

  it("4.7s 後尚未消失（邊界）", () => {
    render(<Wrapper><ShowButton kind="ok" title="未到時間" /></Wrapper>);
    fireEvent.click(screen.getByText("show"));
    act(() => { vi.advanceTimersByTime(4700); });
    expect(screen.getByText("未到時間")).toBeTruthy();
  });

  it("連推兩個 toast → 各自獨立顯示", () => {
    function TwoButton() {
      const { toast } = useToast();
      return (
        <button onClick={() => { toast.ok("第一個"); toast.warn("第二個"); }}>show2</button>
      );
    }
    render(<Wrapper><TwoButton /></Wrapper>);
    fireEvent.click(screen.getByText("show2"));
    expect(screen.getByText("第一個")).toBeTruthy();
    expect(screen.getByText("第二個")).toBeTruthy();
  });

  it("第一個 4.8s 後消失，第二個仍在（各自計時）", () => {
    function SeqButton() {
      const { toast } = useToast();
      return (
        <>
          <button onClick={() => toast.ok("先推")}>first</button>
          <button onClick={() => toast.bad("後推")}>second</button>
        </>
      );
    }
    render(<Wrapper><SeqButton /></Wrapper>);
    fireEvent.click(screen.getByText("first"));
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.click(screen.getByText("second"));
    act(() => { vi.advanceTimersByTime(2800); }); // first 共 4800ms → 消失，second 才 2800ms
    expect(screen.queryByText("先推")).toBeNull();
    expect(screen.getByText("後推")).toBeTruthy();
  });

  it("useToast 在 ToastProvider 外拋錯", () => {
    function Bad() { useToast(); return null; }
    expect(() => render(<Bad />)).toThrow("ToastProvider");
  });
});
