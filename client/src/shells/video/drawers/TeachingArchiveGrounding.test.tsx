// @vitest-environment jsdom
/**
 * TeachingArchiveGrounding（I-4 教材庫接地，AIDV-82 Phase 1）行為測試。
 *
 * 守住驗收：
 *   1. 未搜尋 → 引導態文案；不打 query。
 *   2. 送出 → teachingArchive.search 收到 submitted query。
 *   3. 結果卡渲染 title / snippet / 比對方式徽章（語意/關鍵字）。
 *   4. 「用此教材接地（複製）」→ toast 回饋。
 *   5. 四態：載入中 → PanelLoading；空 → 空狀態；錯誤 → PanelError。
 *
 * 沿用 repo 慣例：模組級 vi.mock 釘住 trpc / sonner；Radix 需 ResizeObserver polyfill。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";

const h = vi.hoisted(() => ({
  search: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn(), lastArgs: undefined as unknown },
  toast: { success: vi.fn(), message: vi.fn() },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    teachingArchive: {
      search: {
        useQuery: (args: unknown) => {
          h.search.lastArgs = args;
          return h.search;
        },
      },
    },
  },
}));
vi.mock("sonner", () => ({ toast: h.toast }));

// jsdom 無 ResizeObserver；Radix（react-use-size）需要 → polyfill。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub;

import { TeachingArchiveGroundingBody } from "./TeachingArchiveGrounding";

const HIT = {
  id: 1,
  title: "慈悲的力量",
  mediaType: "pdf",
  sourceType: "discourse",
  lineage: "某傳承",
  topic: "慈悲",
  speaker: "師父",
  fileUrl: "https://example.com/f.pdf",
  snippet: "慈悲是修行的核心。",
  matchedBy: "vector" as const,
  score: 0.82,
};

function renderAndSubmit(q = "慈悲") {
  render(<TeachingArchiveGroundingBody />);
  const input = screen.getByLabelText("搜尋教材庫") as HTMLInputElement;
  fireEvent.change(input, { target: { value: q } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

beforeEach(() => {
  h.search.data = [HIT];
  h.search.isLoading = false;
  h.search.isError = false;
  h.search.lastArgs = undefined;
  h.toast.success.mockClear();
  h.toast.message.mockClear();
});

afterEach(() => cleanup());

describe("TeachingArchiveGrounding（I-4 / AIDV-82 Phase 1）", () => {
  it("未搜尋 → 引導態文案", () => {
    render(<TeachingArchiveGroundingBody />);
    expect(screen.getByText(/輸入關鍵字搜尋你的教材庫/)).toBeTruthy();
    expect(screen.queryByText("慈悲的力量")).toBeNull();
  });

  it("送出 → teachingArchive.search 收到 submitted query", () => {
    renderAndSubmit("慈悲");
    expect((h.search.lastArgs as { query?: string }).query).toBe("慈悲");
  });

  it("結果卡渲染 title / snippet / 比對方式徽章", () => {
    renderAndSubmit();
    expect(screen.getByText("慈悲的力量")).toBeTruthy();
    expect(screen.getByText("慈悲是修行的核心。")).toBeTruthy();
    expect(screen.getByText("語意")).toBeTruthy(); // matchedBy vector
  });

  it("『用此教材接地（複製）』→ clipboard 成功 → 只發 success toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderAndSubmit();
    fireEvent.click(screen.getByRole("button", { name: /用此教材接地/ }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(h.toast.message).not.toHaveBeenCalled();
  });

  it("載入中 → PanelLoading", () => {
    h.search.isLoading = true;
    h.search.data = undefined;
    renderAndSubmit();
    expect(screen.getByText("搜尋教材庫…")).toBeTruthy();
  });

  it("空結果 → 空狀態文案", () => {
    h.search.data = [];
    renderAndSubmit();
    expect(screen.getByText(/沒有符合的教材/)).toBeTruthy();
  });

  it("錯誤 → PanelError 訊息", () => {
    h.search.isError = true;
    h.search.data = undefined;
    renderAndSubmit();
    expect(screen.getByText(/教材庫搜尋失敗/)).toBeTruthy();
  });
});
