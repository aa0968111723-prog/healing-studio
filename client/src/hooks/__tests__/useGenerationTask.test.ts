// @vitest-environment jsdom
/**
 * AIDV-174: useGenerationTask.test.ts
 *
 * 驗收：
 *   ✅ selectedModelId 初始值 / setSelectedModelId
 *   ✅ params 初始值 / setParam / setParams / resetParams
 *   ✅ isGenerating 初始 false / setIsGenerating
 *   ✅ opts.initialModelId / opts.initialParams 作用
 */

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGenerationTask } from "../useGenerationTask";

describe("useGenerationTask", () => {
  it("預設：selectedModelId=undefined, params={}, isGenerating=false", () => {
    const { result } = renderHook(() => useGenerationTask());
    expect(result.current.selectedModelId).toBeUndefined();
    expect(result.current.params).toEqual({});
    expect(result.current.isGenerating).toBe(false);
  });

  it("initialModelId / initialParams 作用", () => {
    const { result } = renderHook(() =>
      useGenerationTask({ initialModelId: "flux-pro", initialParams: { steps: 28 } })
    );
    expect(result.current.selectedModelId).toBe("flux-pro");
    expect(result.current.params).toEqual({ steps: 28 });
  });

  it("setSelectedModelId 更新", () => {
    const { result } = renderHook(() => useGenerationTask());
    act(() => result.current.setSelectedModelId("wan-t2v"));
    expect(result.current.selectedModelId).toBe("wan-t2v");
  });

  it("setParam 寫單一 key（不覆蓋其他 key）", () => {
    const { result } = renderHook(() =>
      useGenerationTask({ initialParams: { steps: 20 } })
    );
    act(() => result.current.setParam("cfg", 7.5));
    expect(result.current.params).toEqual({ steps: 20, cfg: 7.5 });
  });

  it("resetParams 清空", () => {
    const { result } = renderHook(() =>
      useGenerationTask({ initialParams: { steps: 20, cfg: 7 } })
    );
    act(() => result.current.resetParams());
    expect(result.current.params).toEqual({});
  });

  it("setParams 完整替換（相容 React setter 傳入 child）", () => {
    const { result } = renderHook(() => useGenerationTask());
    act(() => result.current.setParams({ resolution: "1080p", fps: 24 }));
    expect(result.current.params).toEqual({ resolution: "1080p", fps: 24 });
  });

  it("setIsGenerating true/false", () => {
    const { result } = renderHook(() => useGenerationTask());
    act(() => result.current.setIsGenerating(true));
    expect(result.current.isGenerating).toBe(true);
    act(() => result.current.setIsGenerating(false));
    expect(result.current.isGenerating).toBe(false);
  });
});
