// @vitest-environment jsdom
/**
 * AIDV-287: useAutoSavePrompt.test.ts
 *
 * 驗收：
 *   ✅ 非空 content + flag ON → createPrompt 被呼叫
 *   ✅ 空 content → createPrompt 不被呼叫
 *   ✅ flag OFF → createPrompt 不被呼叫
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoSavePrompt } from "../useAutoSavePrompt";
import type { PromptVaultAdapter } from "@/adapters/types";

function makeFakeAdapter(
  overrides: Partial<PromptVaultAdapter> = {},
): PromptVaultAdapter {
  return {
    listPrompts: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
    getPrompt: vi.fn().mockResolvedValue(null),
    createPrompt: vi.fn().mockResolvedValue({ id: 1 }),
    incrementUseCount: vi.fn().mockResolvedValue(undefined),
    listLinkedAssets: vi.fn().mockResolvedValue([]),
    listLinkedPrompts: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

vi.mock("@/config/promptVaultFlags", () => ({ ENABLE_PROMPT_VAULT: true }));

describe("useAutoSavePrompt (flag ON)", () => {
  it("非空 content → createPrompt を呼ぶ", async () => {
    const adapter = makeFakeAdapter();
    const { result } = renderHook(() =>
      useAutoSavePrompt({ sourceWorkflow: "video", adapter }),
    );
    await act(async () => {
      result.current.trySave({
        title: "花海",
        content: "a field of flowers",
        modelHint: "nanoBanana2",
      });
      await new Promise(r => setTimeout(r, 0));
    });
    expect(adapter.createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ content: "a field of flowers" }),
    );
  });

  it("空白のみの content → createPrompt は呼ばれない", async () => {
    const adapter = makeFakeAdapter();
    const { result } = renderHook(() =>
      useAutoSavePrompt({ sourceWorkflow: "video", adapter }),
    );
    await act(async () => {
      result.current.trySave({ title: "空", content: "   " });
      await new Promise(r => setTimeout(r, 0));
    });
    expect(adapter.createPrompt).not.toHaveBeenCalled();
  });
});

describe("useAutoSavePrompt (flag OFF)", () => {
  it("flag OFF → createPrompt は呼ばれない", async () => {
    vi.resetModules();
    vi.doMock("@/config/promptVaultFlags", () => ({ ENABLE_PROMPT_VAULT: false }));
    const { useAutoSavePrompt: useHook } = await import("../useAutoSavePrompt");
    const adapter = makeFakeAdapter();
    const { result } = renderHook(() =>
      useHook({ sourceWorkflow: "video", adapter }),
    );
    await act(async () => {
      result.current.trySave({ title: "テスト", content: "some prompt" });
      await new Promise(r => setTimeout(r, 0));
    });
    expect(adapter.createPrompt).not.toHaveBeenCalled();
    vi.doUnmock("@/config/promptVaultFlags");
    vi.resetModules();
  });
});
