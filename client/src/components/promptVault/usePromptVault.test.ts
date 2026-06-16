// @vitest-environment jsdom
// ============================================================================
// usePromptVault.test — U-9 PromptVault 接線 hook 單測（adapter 以 fake 注入）
// 覆蓋：型別映射、瀏覽四態（ready/empty/error）、存庫（saved/duplicate/error）、重用計數。
// ============================================================================
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePromptVault, toVaultEntry } from "./usePromptVault";
import type {
  PromptVaultAdapter,
  PromptVaultItem,
  PromptVaultPage,
} from "@/adapters/types";

function makeItem(over: Partial<PromptVaultItem> = {}): PromptVaultItem {
  return {
    id: 1,
    title: "晚安雨聲",
    content: "lo-fi 治癒夜雨",
    category: "audio",
    tags: ["治癒", "雨"],
    isFavorite: false,
    useCount: 2,
    modelHint: "fal",
    ...over,
  };
}

function page(items: PromptVaultItem[]): PromptVaultPage {
  return { items, total: items.length, page: 1, pageSize: 20, totalPages: 1 };
}

function fakeAdapter(over: Partial<PromptVaultAdapter> = {}): PromptVaultAdapter {
  return {
    listPrompts: vi.fn(async () => page([makeItem()])),
    getPrompt: vi.fn(async () => null),
    createPrompt: vi.fn(async () => ({ id: 9 })),
    incrementUseCount: vi.fn(async () => undefined),
    listLinkedAssets: vi.fn(async () => []),
    listLinkedPrompts: vi.fn(async () => []),
    ...over,
  };
}

describe("toVaultEntry", () => {
  it("把後端列映射成 design-kit VaultEntry（content→prompt、useCount→uses、id→string）", () => {
    const e = toVaultEntry(makeItem({ id: 7, isFavorite: true }), "video");
    expect(e.id).toBe("7");
    expect(e.prompt).toBe("lo-fi 治癒夜雨");
    expect(e.uses).toBe(2);
    expect(e.sourceWorkflow).toBe("video");
    expect(e.params.provider).toBe("fal"); // modelHint 命中 ProviderId
    expect(e.status).toBe("saved"); // isFavorite → saved
  });

  it("modelHint 非合法 ProviderId 時 provider 回退 gemini", () => {
    const e = toVaultEntry(makeItem({ modelHint: "suno-v3.5" }), "social");
    expect(e.params.provider).toBe("gemini");
  });
});

describe("usePromptVault — 瀏覽四態", () => {
  it("載入成功 → ready 且帶 entries", async () => {
    const adapter = fakeAdapter();
    const { result } = renderHook(() =>
      usePromptVault({ sourceWorkflow: "video", adapter })
    );
    await waitFor(() => expect(result.current.browseState).toBe("ready"));
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].prompt).toBe("lo-fi 治癒夜雨");
  });

  it("空清單 → empty", async () => {
    const adapter = fakeAdapter({ listPrompts: vi.fn(async () => page([])) });
    const { result } = renderHook(() =>
      usePromptVault({ sourceWorkflow: "video", adapter })
    );
    await waitFor(() => expect(result.current.browseState).toBe("empty"));
  });

  it("列表丟錯 → error", async () => {
    const adapter = fakeAdapter({
      listPrompts: vi.fn(async () => {
        throw new Error("tRPC down");
      }),
    });
    const { result } = renderHook(() =>
      usePromptVault({ sourceWorkflow: "video", adapter })
    );
    await waitFor(() => expect(result.current.browseState).toBe("error"));
  });
});

describe("usePromptVault — 存庫", () => {
  it("存新 prompt → createPrompt 被呼叫、saveState=saved", async () => {
    const adapter = fakeAdapter();
    const { result } = renderHook(() =>
      usePromptVault({ sourceWorkflow: "social", adapter })
    );
    await waitFor(() => expect(result.current.browseState).toBe("ready"));

    await act(async () => {
      await result.current.save({ title: "新詞", content: "全新的 prompt 內容" });
    });
    expect(adapter.createPrompt).toHaveBeenCalledTimes(1);
    expect(result.current.saveState).toBe("saved");
  });

  it("存重複 content → 不建立、改 +1 使用次數、saveState=duplicate", async () => {
    const adapter = fakeAdapter();
    const { result } = renderHook(() =>
      usePromptVault({ sourceWorkflow: "social", adapter })
    );
    await waitFor(() => expect(result.current.browseState).toBe("ready"));

    await act(async () => {
      await result.current.save({ title: "重複", content: "lo-fi 治癒夜雨" });
    });
    expect(adapter.createPrompt).not.toHaveBeenCalled();
    expect(adapter.incrementUseCount).toHaveBeenCalledWith(1);
    expect(result.current.saveState).toBe("duplicate");
  });

  it("createPrompt 丟錯 → saveState=error", async () => {
    const adapter = fakeAdapter({
      createPrompt: vi.fn(async () => {
        throw new Error("create failed");
      }),
    });
    const { result } = renderHook(() =>
      usePromptVault({ sourceWorkflow: "video", adapter })
    );
    await waitFor(() => expect(result.current.browseState).toBe("ready"));

    await act(async () => {
      await result.current.save({ title: "x", content: "另一個全新 prompt" });
    });
    expect(result.current.saveState).toBe("error");
  });
});

describe("usePromptVault — 重用", () => {
  it("applyEntry → incrementUseCount + onApply 回呼", async () => {
    const adapter = fakeAdapter();
    const onApply = vi.fn();
    const { result } = renderHook(() =>
      usePromptVault({ sourceWorkflow: "video", adapter, onApply })
    );
    await waitFor(() => expect(result.current.browseState).toBe("ready"));

    const entry = result.current.entries[0];
    await act(async () => {
      await result.current.applyEntry(entry);
    });
    expect(adapter.incrementUseCount).toHaveBeenCalledWith(1);
    expect(onApply).toHaveBeenCalledWith(entry);
  });
});
