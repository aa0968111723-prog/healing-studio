// @vitest-environment jsdom
/**
 * FlowTv（W1-4 放映皮）行為測試。
 *
 * 守住驗收四件套：
 *   1. 頻道＝真實後端篩選（切頻道 → promptLibrary.list 收到 category/favoritesOnly）。
 *   2. 格狀/清單切換；格卡點擊 → 全屏播放器開啟、seed＋prompt 直顯。
 *   3. Hide Prompt 疊層可收合；左右換頁循環。
 *   4. 一鍵重用（generation 接縫＋incrementUseCount）／fork（帶回編輯表單＋關播放器）。
 *
 * 沿用 repo 慣例：模組級 vi.mock 釘 @/lib/trpc 與 SpineProvider。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";

const { listCalls, listState, mutations, generateMock } = vi.hoisted(() => ({
  listCalls: [] as unknown[],
  listState: {
    data: { items: [] as unknown[], total: 0, page: 1, pageSize: 20, totalPages: 0 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: vi.fn(),
    delete: vi.fn(),
    incrementUseCount: vi.fn(),
    toggleFavorite: vi.fn(),
  },
  generateMock: vi.fn(async (_input: Record<string, unknown>) => ({ model: "flux-dev", seedUsed: 1234, provider: "hf", costUsd: 0.01 })),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    promptLibrary: {
      list: {
        useQuery: (input: unknown) => {
          listCalls.push(input);
          return listState;
        },
      },
      create: { useMutation: () => ({ mutate: mutations.create, isPending: false }) },
      delete: { useMutation: () => ({ mutate: mutations.delete, isPending: false }) },
      incrementUseCount: { useMutation: () => ({ mutate: mutations.incrementUseCount, isPending: false }) },
      toggleFavorite: { useMutation: () => ({ mutate: mutations.toggleFavorite, isPending: false }) },
    },
  },
}));

vi.mock("@/providers/SpineProvider", () => ({
  useSpine: () => ({
    provider: "hf",
    adapters: { generation: { generate: generateMock } },
  }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));

import { FlowTvBody, seedOf } from "./FlowTv";

const ITEMS = [
  { id: 1, title: "雪山禪定", content: "snow mountain meditation, cinematic", category: "image", isFavorite: true, useCount: 3, modelHint: "flux-dev", generationMode: null },
  { id: 2, title: "克難坡合照", content: "group photo at the slope, golden hour", category: "video", isFavorite: false, useCount: 0, modelHint: null, generationMode: "lightning" },
];

beforeEach(() => {
  listCalls.length = 0;
  listState.data = { items: ITEMS, total: 2, page: 1, pageSize: 20, totalPages: 1 };
  listState.isLoading = false;
  listState.isError = false;
  mutations.incrementUseCount.mockClear();
  mutations.toggleFavorite.mockClear();
  generateMock.mockClear();
});

afterEach(() => cleanup());

describe("FlowTv 放映皮（W1-4）", () => {
  it("頻道切換＝真實後端篩選參數（category / favoritesOnly）", () => {
    render(<FlowTvBody />);
    fireEvent.click(screen.getByRole("button", { name: "影片" }));
    const last = listCalls[listCalls.length - 1] as Record<string, unknown>;
    expect(last.category).toBe("video");
    expect(last.favoritesOnly).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: /最愛/ }));
    const fav = listCalls[listCalls.length - 1] as Record<string, unknown>;
    expect(fav.favoritesOnly).toBe(true);
    expect(fav.category).toBeUndefined();
  });

  it("格狀為預設、可切清單；格卡點擊開啟全屏播放器並直顯 seed＋prompt", () => {
    render(<FlowTvBody />);
    // 格狀卡存在
    const card = screen.getByTestId("flowtv-card-1");
    expect(card.textContent).toContain(`seed ${seedOf(1)}`);

    fireEvent.click(card);
    const player = screen.getByTestId("flowtv-player");
    expect(player).toBeTruthy();
    // seed＋prompt 直顯
    expect(player.textContent).toContain(`seed ${seedOf(1)}`);
    expect(screen.getByTestId("flowtv-prompt-overlay").textContent).toContain("snow mountain meditation");
    // 模型徽章
    expect(player.textContent).toContain("flux-dev");

    // 切清單檢視（先關播放器）
    fireEvent.click(screen.getByRole("button", { name: "關閉放映" }));
    fireEvent.click(screen.getByRole("button", { name: "清單檢視" }));
    expect(screen.queryByTestId("flowtv-card-1")).toBeNull();
    expect(screen.getByText("×3 重用")).toBeTruthy();
  });

  it("Hide Prompt 收合疊層；左右鍵換頁會循環", () => {
    render(<FlowTvBody />);
    fireEvent.click(screen.getByTestId("flowtv-card-1"));

    fireEvent.click(screen.getByRole("button", { name: "隱藏 prompt" }));
    expect(screen.queryByTestId("flowtv-prompt-overlay")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "顯示 prompt" }));
    expect(screen.getByTestId("flowtv-prompt-overlay")).toBeTruthy();

    // 換頁循環：1 → 2 →（wrap）→ 1
    const player = () => screen.getByTestId("flowtv-player");
    fireEvent.click(screen.getByRole("button", { name: "下一個" }));
    expect(player().textContent).toContain("克難坡合照");
    fireEvent.click(screen.getByRole("button", { name: "下一個" }));
    expect(player().textContent).toContain("雪山禪定");
    fireEvent.click(screen.getByRole("button", { name: "上一個" }));
    expect(player().textContent).toContain("克難坡合照");
  });

  it("一鍵重用：走 generation 接縫＋incrementUseCount；fork 帶回表單並關閉播放器", async () => {
    render(<FlowTvBody />);
    fireEvent.click(screen.getByTestId("flowtv-card-1"));

    fireEvent.click(screen.getByRole("button", { name: /一鍵重用/ }));
    await waitFor(() => expect(generateMock).toHaveBeenCalled());
    const arg = generateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.prompt).toContain("snow mountain meditation");
    expect(arg.seed).toBe(seedOf(1));
    await waitFor(() => expect(mutations.incrementUseCount).toHaveBeenCalledWith({ id: 1 }, expect.anything()));

    fireEvent.click(screen.getByRole("button", { name: /fork 到編輯表單/ }));
    expect(screen.queryByTestId("flowtv-player")).toBeNull();
    expect((screen.getByPlaceholderText(/標籤 \/ 標題/) as HTMLInputElement).value).toBe("雪山禪定（複製）");
    expect((screen.getByPlaceholderText(/prompt 內容/) as HTMLTextAreaElement).value).toContain("snow mountain meditation");
  });

  it("空頻道顯示空態（PanelEmpty 語意）", () => {
    listState.data = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
    render(<FlowTvBody />);
    expect(screen.getByText("這個頻道還沒有提示詞")).toBeTruthy();
  });
});
