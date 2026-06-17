// @vitest-environment jsdom
/**
 * Flow TV 全屏沉浸放映皮（AIDV-117 / U-14）行為測試。
 * 守住：render＋a11y（dialog/aria-modal/icon aria-label）、鍵盤（←/→/Esc/空白）、
 * 左右切換、播放/暫停 toggle、底部進度、四態出口（loading/error/empty），
 * 且純元件唯讀消費（items prop，零後端）。
 */
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, act } from "@testing-library/react";
import { FlowTvOverlay, FLOW_TV_MOCK_ITEMS, type FlowTvItem } from "./FlowTv";

afterEach(() => cleanup());

// jsdom 沒有 matchMedia → 自動播放邏輯需要它；預設「不減少動效」。
beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (q: string) => ({
        matches: false,
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }),
    });
  }
});

const items: FlowTvItem[] = FLOW_TV_MOCK_ITEMS;

describe("FlowTvOverlay（AIDV-117 / U-14）", () => {
  it("open=false → 不渲染任何 dialog（零回歸）", () => {
    render(<FlowTvOverlay items={items} open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("render：dialog + aria-modal + 首張內容 + 進度 1/N", () => {
    render(<FlowTvOverlay items={items} open onClose={() => {}} />);
    const dlg = screen.getByRole("dialog");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText(items[0].prompt)).toBeTruthy();
    expect(screen.getByText(`1 / ${items.length}`)).toBeTruthy();
  });

  it("a11y：退出鈕與左右切換鈕皆有 aria-label（icon-only）", () => {
    render(<FlowTvOverlay items={items} open onClose={() => {}} />);
    expect(screen.getByLabelText("退出 Flow TV")).toBeTruthy();
    expect(screen.getByLabelText("上一個")).toBeTruthy();
    expect(screen.getByLabelText("下一個")).toBeTruthy();
  });

  it("鍵盤 → 切到下一張；← 切回上一張（環狀）", () => {
    render(<FlowTvOverlay items={items} open onClose={() => {}} />);
    const dlg = screen.getByRole("dialog");
    fireEvent.keyDown(dlg, { key: "ArrowRight" });
    expect(screen.getByText(`2 / ${items.length}`)).toBeTruthy();
    fireEvent.keyDown(dlg, { key: "ArrowLeft" });
    expect(screen.getByText(`1 / ${items.length}`)).toBeTruthy();
    // 環狀：第一張往左 → 最後一張。
    fireEvent.keyDown(dlg, { key: "ArrowLeft" });
    expect(
      screen.getByText(`${items.length} / ${items.length}`),
    ).toBeTruthy();
  });

  it("點擊切換鈕：下一個推進索引", () => {
    render(<FlowTvOverlay items={items} open onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("下一個"));
    expect(screen.getByText(`2 / ${items.length}`)).toBeTruthy();
  });

  it("Esc 與退出鈕都觸發 onClose", () => {
    const onClose = vi.fn();
    render(<FlowTvOverlay items={items} open onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByLabelText("退出 Flow TV"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("播放/暫停 toggle：aria-pressed 與 aria-label 切換", () => {
    render(<FlowTvOverlay items={items} open onClose={() => {}} />);
    const playBtn = screen.getByLabelText("開始自動放映");
    expect(playBtn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(playBtn);
    const pauseBtn = screen.getByLabelText("暫停自動放映");
    expect(pauseBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("空白鍵 toggle 自動放映（鍵盤可操作）", () => {
    render(<FlowTvOverlay items={items} open onClose={() => {}} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: " " });
    expect(screen.getByLabelText("暫停自動放映")).toBeTruthy();
  });

  it("自動播放：計時器到點推進索引（尊重 reduced-motion=false）", () => {
    vi.useFakeTimers();
    try {
      render(
        <FlowTvOverlay
          items={items}
          open
          onClose={() => {}}
          autoplayMs={1500}
        />,
      );
      fireEvent.keyDown(screen.getByRole("dialog"), { key: " " }); // 播放
      // 計時器到點會 setIndex；包進 act 讓重繪在斷言前 flush。
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(screen.getByText(`2 / ${items.length}`)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("空態：title + 行動鈕觸發 onClick（有出口）", () => {
    const onClick = vi.fn();
    render(
      <FlowTvOverlay
        items={[]}
        open
        onClose={() => {}}
        onEmptyAction={{ label: "去生成", onClick }}
      />,
    );
    expect(screen.getByText("還沒有可放映的提示")).toBeTruthy();
    fireEvent.click(screen.getByText("去生成"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("載入態：role=status（有出口）", () => {
    render(
      <FlowTvOverlay items={[]} open onClose={() => {}} state="loading" />,
    );
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("錯誤態：role=alert + 重試觸發 onRetry（有出口）", () => {
    const onRetry = vi.fn();
    render(
      <FlowTvOverlay
        items={items}
        open
        onClose={() => {}}
        state="error"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByText("重試"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("單張：左右切換鈕不出現、播放鈕停用（無誤動作）", () => {
    render(
      <FlowTvOverlay items={[items[0]]} open onClose={() => {}} />,
    );
    expect(screen.queryByLabelText("下一個")).toBeNull();
    expect(screen.queryByLabelText("上一個")).toBeNull();
    expect(
      (screen.getByLabelText("開始自動放映") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
