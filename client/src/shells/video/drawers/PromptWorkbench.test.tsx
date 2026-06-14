// @vitest-environment jsdom
/**
 * PromptWorkbench（I-8 提示詞跨庫組合，AIDV-86 Phase 1）行為測試。
 *
 * 守住驗收：
 *   1. 預設「我的提示詞庫」分頁渲染 promptLibrary.list 項目。
 *   2. 切「我的收藏」→ 渲染 promptCollection.listMine 項目（跨庫並列）。
 *   3. 點卡多選 → 組合區顯示已選數＋chips＋合併文字（client-side 合成）。
 *   4. 「複製組合提示詞」→ toast 回饋。
 *   5. 四態：載入中 → PanelLoading；空來源 → 空狀態。
 *
 * 沿用 repo 慣例：模組級 vi.mock 釘住 trpc / sonner；Radix 需 ResizeObserver polyfill。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";

const h = vi.hoisted(() => ({
  lib: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() },
  mine: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() },
  team: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() },
  toast: { success: vi.fn(), message: vi.fn() },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    promptLibrary: { list: { useQuery: () => h.lib } },
    promptCollection: {
      listMine: { useQuery: () => h.mine },
      listTeam: { useQuery: () => h.team },
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

import { PromptWorkbenchBody } from "./PromptWorkbench";

const LIB = [
  { id: 1, title: "電影感打光", content: "cinematic lighting, soft key", category: "image", isFavorite: true, useCount: 3 },
  { id: 2, title: "台灣街景", content: "taiwan street, neon signs", category: "image", useCount: 0 },
];
const MINE = [{ id: 10, title: "收藏A", content: "collected prompt A", category: "video" }];

const wrap = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 50, totalPages: 1 });

beforeEach(() => {
  h.lib.data = wrap(LIB);
  h.lib.isLoading = false;
  h.lib.isError = false;
  h.mine.data = wrap(MINE);
  h.mine.isLoading = false;
  h.mine.isError = false;
  h.team.data = wrap([]);
  h.team.isLoading = false;
  h.team.isError = false;
  h.toast.success.mockClear();
  h.toast.message.mockClear();
});

afterEach(() => cleanup());

describe("PromptWorkbench（I-8 / AIDV-86 Phase 1）", () => {
  it("預設『我的提示詞庫』渲染 library 項目", () => {
    render(<PromptWorkbenchBody />);
    expect(screen.getByText("電影感打光")).toBeTruthy();
    expect(screen.getByText("台灣街景")).toBeTruthy();
  });

  it("切『我的收藏』→ 渲染 promptCollection 項目（跨庫）", () => {
    render(<PromptWorkbenchBody />);
    fireEvent.click(screen.getByRole("button", { name: "我的收藏" }));
    expect(screen.getByText("收藏A")).toBeTruthy();
  });

  it("點卡多選 → 組合區合成合併文字＋已選計數", () => {
    render(<PromptWorkbenchBody />);
    fireEvent.click(screen.getByRole("button", { name: /電影感打光/ }));
    const merged = screen.getByLabelText("組合提示詞") as HTMLTextAreaElement;
    expect(merged.value).toContain("cinematic lighting");
    fireEvent.click(screen.getByRole("button", { name: /台灣街景/ }));
    const merged2 = screen.getByLabelText("組合提示詞") as HTMLTextAreaElement;
    expect(merged2.value).toContain("cinematic lighting");
    expect(merged2.value).toContain("taiwan street");
    expect(screen.getByText(/已選 2 段/)).toBeTruthy();
  });

  it("『複製組合提示詞』→ toast 回饋", async () => {
    render(<PromptWorkbenchBody />);
    fireEvent.click(screen.getByRole("button", { name: /電影感打光/ }));
    fireEvent.click(screen.getByRole("button", { name: "複製組合提示詞" }));
    await Promise.resolve();
    expect(h.toast.success.mock.calls.length + h.toast.message.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("載入中 → PanelLoading、不渲染卡", () => {
    h.lib.isLoading = true;
    h.lib.data = undefined;
    render(<PromptWorkbenchBody />);
    expect(screen.getByText("讀取提示詞…")).toBeTruthy();
    expect(screen.queryByText("電影感打光")).toBeNull();
  });

  it("空來源 → 空狀態文案", () => {
    h.lib.data = wrap([]);
    render(<PromptWorkbenchBody />);
    expect(screen.getByText(/這個來源沒有提示詞/)).toBeTruthy();
  });
});
