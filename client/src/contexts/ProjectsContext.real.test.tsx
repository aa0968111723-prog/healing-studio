// @vitest-environment jsdom
/**
 * RealProjectsProvider（Wave 1 Project SSOT）單元測試。
 *
 * 沿用 repo 既有慣例（tests/unit/client/useOrbTaskObservations.hook.test.tsx）：
 * vi.mock("@/lib/trpc") 手刻 provider 會碰到的 procedure 樹，直接回 React-Query
 * 形狀的物件，不必掛 QueryClientProvider / trpc.Provider。WorldContext 同樣以
 * 模組 mock 取代 —— 這裡只驗證 ProjectsContext 的映射與委派語意。
 *
 * mutateAsync stub 模擬真實 TanStack Query 生命週期順序：
 *   await onMutate → mutationFn 結果 → onError（失敗時）→ onSettled。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

// ── 可程式化的 mock 狀態（每個測試前重設）──────────────────────────────────
const listState: {
  data: unknown[] | undefined;
  isLoading: boolean;
  error: { message: string } | null;
} = { data: [], isLoading: false, error: null };

const createCalls: unknown[] = [];
let nextCreatedId = 101;
let failNextCreate: Error | null = null;

const utilsStub = {
  creativeProject: {
    list: {
      cancel: vi.fn(async () => {}),
      getData: vi.fn(() => listState.data),
      setData: vi.fn(),
      invalidate: vi.fn(),
    },
  },
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => utilsStub,
    creativeProject: {
      list: {
        useQuery: () => ({
          data: listState.data,
          isLoading: listState.isLoading,
          error: listState.error,
        }),
      },
      create: {
        useMutation: (opts?: {
          onMutate?: (input: unknown) => unknown;
          onError?: (err: unknown, input: unknown, ctx: unknown) => void;
          onSettled?: () => unknown;
        }) => ({
          mutateAsync: async (input: unknown) => {
            createCalls.push(input);
            const ctx = await opts?.onMutate?.(input);
            if (failNextCreate) {
              const err = failNextCreate;
              failNextCreate = null;
              opts?.onError?.(err, input, ctx);
              await opts?.onSettled?.();
              throw err;
            }
            const result = { id: nextCreatedId };
            await opts?.onSettled?.();
            return result;
          },
        }),
      },
    },
  },
}));

const worldStub: {
  currentProjectId: number | null;
  setCurrentProjectId: ReturnType<typeof vi.fn>;
} = {
  currentProjectId: null,
  setCurrentProjectId: vi.fn(),
};

vi.mock("@/contexts/WorldContextContext", () => ({
  useWorldContext: () => worldStub,
}));

import { RealProjectsProvider, useProjects } from "./ProjectsContext";

function wrapper({ children }: { children: ReactNode }) {
  return <RealProjectsProvider>{children}</RealProjectsProvider>;
}

/** creativeProject.list 的單列（rowToData 形狀）。 */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    title: "真實專案",
    description: undefined,
    directorSessionId: null,
    worldFrameworkId: null,
    worldStoryboardId: null,
    worldviewId: null,
    scriptId: null,
    status: "concept",
    coverImageUrl: undefined,
    tags: [],
    metadata: undefined,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-02T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  listState.data = [];
  listState.isLoading = false;
  listState.error = null;
  createCalls.length = 0;
  nextCreatedId = 101;
  failNextCreate = null;
  worldStub.currentProjectId = null;
  worldStub.setCurrentProjectId.mockReset();
  utilsStub.creativeProject.list.cancel.mockClear();
  utilsStub.creativeProject.list.getData.mockClear();
  utilsStub.creativeProject.list.setData.mockReset();
  utilsStub.creativeProject.list.invalidate.mockReset();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  cleanup();
});

describe("RealProjectsProvider (Project SSOT)", () => {
  it("maps server rows to the frontend Project shape", () => {
    listState.data = [
      makeRow({
        id: 12,
        title: "禪修長片",
        status: "production",
        worldFrameworkId: 3,
        metadata: {
          type: "video",
          progress: 42,
          currentStep: "分鏡完成",
          nextAction: "挑配樂",
          storyboardLabel: "30 秒禪修分鏡",
        },
      }),
    ];
    const { result } = renderHook(() => useProjects(), { wrapper });
    expect(result.current.projects).toHaveLength(1);
    const p = result.current.projects[0];
    expect(p.id).toBe("12");
    expect(p.title).toBe("禪修長片");
    expect(p.type).toBe("video");
    expect(p.status).toBe("active"); // production → active
    expect(p.progress).toBe(42);
    expect(p.currentStep).toBe("分鏡完成");
    expect(p.nextAction).toBe("挑配樂");
    expect(p.createdAt).toBe("2026-06-01T00:00:00.000Z");
    expect(p.updatedAt).toBe("2026-06-02T00:00:00.000Z");
    expect(p.isPending).toBeUndefined();
    // binding：metadata label 優先，否則由連結 id 產生佔位標籤。
    expect(p.binding?.storyboard).toBe("30 秒禪修分鏡");
    expect(p.binding?.worldFramework).toBe("世界觀框架 #3");
  });

  it("falls back to safe defaults for rows without metadata (legacy console rows)", () => {
    listState.data = [makeRow({ id: 9, status: "complete" })];
    const { result } = renderHook(() => useProjects(), { wrapper });
    const p = result.current.projects[0];
    expect(p.type).toBe("other");
    expect(p.status).toBe("completed");
    expect(p.progress).toBe(100); // complete 且無 metadata.progress → 100
    expect(p.binding).toBeUndefined();
  });

  it("marks optimistic temp rows (non-positive id) as isPending", () => {
    listState.data = [makeRow({ id: -1750000000000, title: "剛建立" })];
    const { result } = renderHook(() => useProjects(), { wrapper });
    expect(result.current.projects[0].isPending).toBe(true);
  });

  it("delegates activeProjectId to WorldContext (number ↔ string bridge)", () => {
    listState.data = [makeRow({ id: 7 })];
    worldStub.currentProjectId = 7;
    const { result } = renderHook(() => useProjects(), { wrapper });
    expect(result.current.activeProjectId).toBe("7");
    expect(result.current.activeProject?.id).toBe("7");

    act(() => {
      result.current.setActiveProjectId("12");
    });
    expect(worldStub.setCurrentProjectId).toHaveBeenCalledWith(12);

    // 解析不出正整數的非 null id（mock 字串 / 樂觀負數 id）→ no-op，
    // 不可誤清使用者既有的 active 釘選。
    worldStub.setCurrentProjectId.mockClear();
    act(() => {
      result.current.setActiveProjectId("proj-zen-short");
    });
    act(() => {
      result.current.setActiveProjectId("-1750000000000");
    });
    expect(worldStub.setCurrentProjectId).not.toHaveBeenCalled();

    // 顯式 null 才解除釘選。
    act(() => {
      result.current.setActiveProjectId(null);
    });
    expect(worldStub.setCurrentProjectId).toHaveBeenCalledWith(null);
  });

  it("createProject sends title + metadata, optimistically inserts a valid temp row, then pins the real id", async () => {
    const { result } = renderHook(() => useProjects(), { wrapper });
    let created: Awaited<ReturnType<typeof result.current.createProject>> | null =
      null;
    await act(async () => {
      created = await result.current.createProject({
        title: "  新影片企劃  ",
        type: "video",
        worldFramework: "新世界觀",
      });
    });
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toMatchObject({
      title: "新影片企劃",
      status: "concept",
      metadata: {
        type: "video",
        progress: 0,
        worldFrameworkLabel: "新世界觀",
      },
    });

    // 樂觀插入：實際執行 setData 收到的 updater，驗證臨時列形狀與 old ?? [] 行為。
    const setData = utilsStub.creativeProject.list.setData;
    expect(setData).toHaveBeenCalledTimes(1);
    const [key, updater] = setData.mock.calls[0] as [
      undefined,
      (old?: unknown[]) => unknown[],
    ];
    expect(key).toBeUndefined();
    const inserted = updater(undefined); // old ?? [] 分支
    expect(inserted).toHaveLength(1);
    const temp = inserted[0] as Record<string, unknown>;
    expect(temp.id as number).toBeLessThan(0);
    expect(temp).toMatchObject({
      title: "新影片企劃",
      status: "concept",
      tags: [],
    });
    expect((temp.metadata as Record<string, unknown>).type).toBe("video");

    // 生命週期順序：樂觀 setData 先於 onSettled 的 invalidate。
    expect(setData.mock.invocationCallOrder[0]).toBeLessThan(
      utilsStub.creativeProject.list.invalidate.mock.invocationCallOrder[0],
    );
    expect(utilsStub.creativeProject.list.invalidate).toHaveBeenCalled();

    // 釘為 active（委派 WorldContext，真實 id）。
    expect(worldStub.setCurrentProjectId).toHaveBeenCalledWith(101);
    expect(created!.id).toBe("101");
    expect(created!.status).toBe("draft");
    expect(created!.binding?.worldFramework).toBe("新世界觀");
  });

  it("rolls back the optimistic insert when create rejects and does not pin anything", async () => {
    const previous = [makeRow({ id: 7 })];
    listState.data = previous;
    failNextCreate = new Error("boom");
    const { result } = renderHook(() => useProjects(), { wrapper });
    await act(async () => {
      await expect(
        result.current.createProject({ title: "失敗企劃", type: "video" }),
      ).rejects.toThrow("boom");
    });
    // onError 用 onMutate 拍下的快照回滾（直接傳陣列，不是 updater）。
    expect(utilsStub.creativeProject.list.setData).toHaveBeenLastCalledWith(
      undefined,
      previous,
    );
    // onSettled 照樣 invalidate（伺服器真相最終一致）。
    expect(utilsStub.creativeProject.list.invalidate).toHaveBeenCalled();
    // 失敗不可釘 active id。
    expect(worldStub.setCurrentProjectId).not.toHaveBeenCalled();
  });

  it("surfaces the list error message", () => {
    listState.error = { message: "boom" };
    listState.data = undefined;
    const { result } = renderHook(() => useProjects(), { wrapper });
    expect(result.current.error).toBe("boom");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.projects).toEqual([]);
  });

  it("surfaces list loading state and clears the legacy localStorage key", () => {
    // 本機 jsdom 可能沒有可用的 localStorage（jsdom29 + vitest2 已知相容性問題；
    // 與 baseline 的 ProjectsContext.test.tsx 同款）—— seed 失敗就只驗 loading 語意。
    let seeded = false;
    try {
      window.localStorage.setItem("creation-hub-active-project-id", "proj-stale");
      seeded =
        window.localStorage.getItem("creation-hub-active-project-id") ===
        "proj-stale";
    } catch {
      /* env without working localStorage */
    }
    listState.isLoading = true;
    listState.data = undefined;
    const { result } = renderHook(() => useProjects(), { wrapper });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.projects).toEqual([]);
    expect(result.current.error).toBe(null);
    if (seeded) {
      // SSOT 路徑不再使用 mock 時代的 key，掛載時清掉。
      expect(
        window.localStorage.getItem("creation-hub-active-project-id"),
      ).toBe(null);
    }
  });
});
