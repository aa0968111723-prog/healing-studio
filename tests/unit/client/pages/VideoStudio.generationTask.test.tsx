// @vitest-environment jsdom
/**
 * AIDV-899: VideoStudio 模型選擇狀態收斂到 useGenerationTask 後的關鍵路徑煙霧測試。
 *
 * VideoStudio 五個分頁（t2v/i2v/v2v/enhance/control）原本各自維護
 *   const [activeXModel, setActiveXModel] = useState<Union>(initial)
 * 收斂後改為（照 ImageStudio 採用模式）：
 *   const { selectedModelId: raw, setSelectedModelId } =
 *     useGenerationTask({ initialModelId: initial });
 *   const activeXModel = (raw ?? initial) as Union;
 *
 * 本測試驗證該採用模式與原 useState 行為 100% 等價：
 *   1) 初始值 = initialModelId（五個分頁的預設模型）
 *   2) setSelectedModelId（agent bus setModel 路徑傳入字串）正確切換
 *   3) raw 被設回 undefined 時回退到初始模型（?? fallback 分支）
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGenerationTask } from "../../../../client/src/hooks/useGenerationTask";

/** 完全複製收斂後各分頁的採用寫法。 */
function useTabModel<T extends string>(initial: T) {
  const { selectedModelId, setSelectedModelId } = useGenerationTask({
    initialModelId: initial,
  });
  return {
    model: (selectedModelId ?? initial) as T,
    setModel: setSelectedModelId,
  };
}

describe("AIDV-899 VideoStudio useGenerationTask 採用模式", () => {
  const tabDefaults: Array<[tab: string, initial: string, switched: string]> = [
    ["t2v", "kling", "sora"],
    ["i2v", "kling", "runway"],
    ["v2v", "wan", "ltx"],
    ["enhance", "upscale", "topaz"],
    ["control", "cam", "vidu"],
  ];

  it.each(tabDefaults)(
    "%s 分頁：初始=%s，setModel 切換到 %s",
    (_tab, initial, switched) => {
      const { result } = renderHook(() => useTabModel(initial));
      expect(result.current.model).toBe(initial);
      act(() => result.current.setModel(switched));
      expect(result.current.model).toBe(switched);
    }
  );

  it("raw 清成 undefined 時回退到初始模型（?? fallback）", () => {
    const { result } = renderHook(() => useTabModel("kling"));
    act(() => result.current.setModel("wan"));
    expect(result.current.model).toBe("wan");
    act(() => result.current.setModel(undefined));
    expect(result.current.model).toBe("kling");
  });

  it("VideoStudio 頁面模組載入正常且維持 default export", async () => {
    const mod = await import("../../../../client/src/pages/VideoStudio");
    expect(typeof mod.default).toBe("function");
  });
});
