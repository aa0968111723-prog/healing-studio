// @vitest-environment jsdom
/**
 * SegmentProgressLabel — AIDV-589
 * 驗收條件（仿 SSEFallbackBanner.test.tsx 模式，mock useBackgroundTasks）：
 * - context 有該 jobId 的分段進度 → 顯示「第 X/N 段」＋語意 aria-label
 * - context 無該 jobId entry → 完全不渲染（未收到 segment 事件 = 零回歸）
 * - context 缺 segmentProgress 欄位（舊 shape）→ 不渲染、不 throw
 * - 分段進度資料不合法（0 段）→ 靜默降級不渲染
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SegmentProgressLabel } from "./SegmentProgressLabel";

afterEach(() => cleanup());

vi.mock("@/contexts/BackgroundTasksContext", () => ({
  useBackgroundTasks: vi.fn(),
}));

import { useBackgroundTasks } from "@/contexts/BackgroundTasksContext";
const mockUse = useBackgroundTasks as ReturnType<typeof vi.fn>;

describe("SegmentProgressLabel (AIDV-589)", () => {
  it("有分段進度 → 顯示「第 2/5 段」", () => {
    mockUse.mockReturnValue({
      segmentProgress: { 101: { currentSegment: 2, totalSegments: 5, completed: false } },
    });
    render(<SegmentProgressLabel jobId={101} />);
    expect(screen.getByText("第 2/5 段")).toBeDefined();
  });

  it("aria-label 帶完整語意「分段進度：第 2/5 段」", () => {
    mockUse.mockReturnValue({
      segmentProgress: { 101: { currentSegment: 2, totalSegments: 5, completed: false } },
    });
    render(<SegmentProgressLabel jobId={101} />);
    expect(screen.getByText("第 2/5 段").getAttribute("aria-label")).toBe(
      "分段進度：第 2/5 段"
    );
  });

  it("該 jobId 無分段事件 → 完全不渲染（零回歸）", () => {
    mockUse.mockReturnValue({
      segmentProgress: { 999: { currentSegment: 1, totalSegments: 3, completed: false } },
    });
    const { container } = render(<SegmentProgressLabel jobId={101} />);
    expect(container.innerHTML).toBe("");
  });

  it("segmentProgress 為空物件 → 不渲染", () => {
    mockUse.mockReturnValue({ segmentProgress: {} });
    const { container } = render(<SegmentProgressLabel jobId={101} />);
    expect(container.innerHTML).toBe("");
  });

  it("context 缺 segmentProgress 欄位（舊 shape）→ 不渲染、不 throw", () => {
    mockUse.mockReturnValue({ sseConnected: true, activeCount: 1 });
    const { container } = render(<SegmentProgressLabel jobId={101} />);
    expect(container.innerHTML).toBe("");
  });

  it("分段進度資料不合法（0 段）→ 靜默降級不渲染", () => {
    mockUse.mockReturnValue({
      segmentProgress: { 101: { currentSegment: 1, totalSegments: 0, completed: false } },
    });
    const { container } = render(<SegmentProgressLabel jobId={101} />);
    expect(container.innerHTML).toBe("");
  });

  it("單一分段 → 顯示「第 1/1 段」", () => {
    mockUse.mockReturnValue({
      segmentProgress: { 101: { currentSegment: 1, totalSegments: 1, completed: true } },
    });
    render(<SegmentProgressLabel jobId={101} />);
    expect(screen.getByText("第 1/1 段")).toBeDefined();
  });
});
