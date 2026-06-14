// @vitest-environment jsdom
/**
 * ScriptCanvas（I-3 劇本→自動分鏡骨架，AIDV-81）行為測試。
 *
 * 守住：
 *   1. 匯入腳本得到 N 段後，出現「自動分鏡骨架（N 格）」並以 sceneCount=N、worldId
 *      ＝脊椎 worldFrameworkId、autoSave 呼叫 worldStoryboard.seedSkeleton。
 *   2. 專案未連結世界觀（worldFrameworkId 缺）→ 點擊只提示、不呼叫 seedSkeleton（零誤寫）。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  seedMutate: vi.fn(),
  importMutate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  spine: { project: { worldFrameworkId: 7 as number | null } as unknown },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    director: {
      videoScriptTypes: { useQuery: () => ({ data: [{ id: "heal", label: "療癒" }], isLoading: false, isError: false, refetch: vi.fn() }) },
      listSessions: { useQuery: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }) },
      generateVideoScript: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      importScript: { useMutation: () => ({ mutate: h.importMutate, isPending: false }) },
      saveSession: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    worldStoryboard: {
      seedSkeleton: { useMutation: () => ({ mutate: h.seedMutate, isPending: false }) },
    },
  },
}));
vi.mock("@/spine/ProjectSpineProvider", () => ({ useProjectSpine: () => h.spine }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

// jsdom 無 ResizeObserver；保險 polyfill（Radix Select 觸發器，與其他座艙測試一致）。
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub;

import { ScriptCanvas } from "./ScriptCanvas";

beforeEach(() => {
  h.seedMutate.mockReset();
  h.importMutate.mockReset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.spine.project = { worldFrameworkId: 7 };
  // importScript.mutate(input, opts) → 模擬成功回傳 4 段
  h.importMutate.mockImplementation((_i: unknown, opts: { onSuccess: (r: unknown) => void }) =>
    opts.onSuccess({ title: "測試腳本", rawContent: "一段內容", segments: [1, 2, 3, 4] }));
  // seedSkeleton.mutate(input, opts) → 模擬成功
  h.seedMutate.mockImplementation((_i: unknown, opts: { onSuccess?: (r: unknown) => void }) =>
    opts.onSuccess?.({ id: 1 }));
});

afterEach(() => cleanup());

/** 切到貼上模式、填標題＋內文、按匯入 → 觸發 importScript.onSuccess（4 段）。 */
function importFourSegments() {
  fireEvent.click(screen.getByText(/貼長腳本匯入/));
  fireEvent.change(screen.getByPlaceholderText("腳本標題（必填）"), { target: { value: "測試腳本" } });
  fireEvent.change(screen.getByPlaceholderText(/貼上你的長腳本/), { target: { value: "一段內容" } });
  fireEvent.click(screen.getByText(/匯入腳本/));
}

describe("ScriptCanvas（I-3 / AIDV-81 劇本→分鏡骨架）", () => {
  it("匯入 4 段 → 出現「自動分鏡骨架（4 格）」並以 sceneCount=4 呼叫 seedSkeleton", () => {
    render(<ScriptCanvas onGuided={() => {}} />);
    importFourSegments();
    const btn = screen.getByText(/自動分鏡骨架（4 格）/);
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(h.seedMutate).toHaveBeenCalledTimes(1);
    expect(h.seedMutate.mock.calls[0][0]).toMatchObject({ worldId: 7, sceneCount: 4, autoSave: true });
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it("未連結世界觀 → 只提示、不呼叫 seedSkeleton", () => {
    h.spine.project = { worldFrameworkId: null };
    render(<ScriptCanvas onGuided={() => {}} />);
    importFourSegments();
    fireEvent.click(screen.getByText(/自動分鏡骨架（4 格）/));
    expect(h.seedMutate).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalled();
  });
});
