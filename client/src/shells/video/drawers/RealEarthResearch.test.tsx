// @vitest-environment jsdom
/**
 * RealEarthResearch（I-5 真實地球研究面板，AIDV-83 Phase 1）行為測試。
 *
 * 守住驗收：
 *   1. 搜尋列送出 → trpc.realEarth.search.useQuery 收到 submitted query。
 *   2. 「只看台灣」開關 → useQuery 收到 taiwanOnly。
 *   3. 結果卡渲染 title / 類別標籤 / summary / 台灣＋可信度徽章。
 *   4. 「用此參照接地（複製）」→ toast 回饋（複製真實參照）。
 *   5. 四態：載入中 → PanelLoading；空 → 空狀態；錯誤 → PanelError 訊息。
 *
 * 沿用 repo 慣例：模組級 vi.mock 釘住 trpc / sonner；real-earth-types 用真資料。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";

const h = vi.hoisted(() => ({
  search: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    lastArgs: undefined as unknown,
  },
  toast: { success: vi.fn(), message: vi.fn() },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    realEarth: {
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

// jsdom 無 ResizeObserver；Radix 子元件（react-use-size）需要 → polyfill。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub;

import { RealEarthResearchBody } from "./RealEarthResearch";

const ENTRY = {
  id: "1",
  title: "媽祖遶境",
  category: "religion",
  summary: "台灣重要的民間信仰遶境活動。",
  content: "…",
  historicalPeriod: "清治時期（1683-1895）",
  location: { region: "台中市" },
  tags: ["媽祖", "遶境", "信仰"],
  isTaiwanFocused: true,
  quality: { credibility: "verified" },
  externalLinks: [{ label: "wiki", url: "https://example.com", type: "wikipedia" }],
};

function okData(entries: unknown[] = [ENTRY]) {
  return { entries, total: entries.length, page: 1, perPage: 20, totalPages: 1 };
}

beforeEach(() => {
  h.search.data = okData();
  h.search.isLoading = false;
  h.search.isError = false;
  h.search.lastArgs = undefined;
  h.search.refetch.mockClear();
  h.toast.success.mockClear();
  h.toast.message.mockClear();
});

afterEach(() => cleanup());

describe("RealEarthResearch（I-5 / AIDV-83 Phase 1）", () => {
  it("搜尋送出 → useQuery 收到 submitted query", () => {
    render(<RealEarthResearchBody />);
    const input = screen.getByLabelText("搜尋真實地球資料") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "媽祖" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect((h.search.lastArgs as { query?: string }).query).toBe("媽祖");
  });

  it("『只看台灣』開關 → useQuery 收到 taiwanOnly", () => {
    render(<RealEarthResearchBody />);
    const label = screen.getByText("只看台灣重點資料").closest("label") as HTMLElement;
    const sw = label.querySelector('[role="switch"]') as HTMLElement;
    fireEvent.click(sw);
    expect((h.search.lastArgs as { taiwanOnly?: boolean }).taiwanOnly).toBe(true);
  });

  it("結果卡渲染 title / 類別標籤 / summary / 徽章", () => {
    render(<RealEarthResearchBody />);
    expect(screen.getByText("媽祖遶境")).toBeTruthy();
    expect(screen.getByText("宗教")).toBeTruthy(); // CATEGORY_LABELS.religion
    expect(screen.getByText("台灣重要的民間信仰遶境活動。")).toBeTruthy();
    expect(screen.getByText("台灣")).toBeTruthy();
    expect(screen.getByText("已驗證")).toBeTruthy(); // credibility verified
  });

  it("『用此參照接地（複製）』→ toast 回饋", async () => {
    render(<RealEarthResearchBody />);
    fireEvent.click(screen.getByRole("button", { name: /用此參照接地/ }));
    await Promise.resolve();
    expect(h.toast.success.mock.calls.length + h.toast.message.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("載入中 → PanelLoading、不渲染結果卡", () => {
    h.search.isLoading = true;
    h.search.data = undefined;
    render(<RealEarthResearchBody />);
    expect(screen.getByText("搜尋真實地球資料…")).toBeTruthy();
    expect(screen.queryByText("媽祖遶境")).toBeNull();
  });

  it("空結果 → 空狀態文案", () => {
    h.search.data = okData([]);
    render(<RealEarthResearchBody />);
    expect(screen.getByText(/沒有符合的真實參照/)).toBeTruthy();
  });

  it("錯誤 → PanelError 訊息", () => {
    h.search.isError = true;
    h.search.data = undefined;
    render(<RealEarthResearchBody />);
    expect(screen.getByText(/真實地球搜尋失敗/)).toBeTruthy();
  });
});
