// @vitest-environment jsdom
/**
 * AIDV-899: ProStudio 模型選擇狀態收斂到 useGenerationTask 後的關鍵路徑煙霧測試。
 *
 * ProStudio 六個分頁（music/sfx/tts/clone/process/avatar）原本各自維護
 *   const [x, setX] = useState<Union>(initial)
 * 收斂後改為（照 ImageStudio 採用模式）：
 *   const { selectedModelId: raw, setSelectedModelId } =
 *     useGenerationTask({ initialModelId: initial });
 *   const x = (raw ?? initial) as Union;
 *
 * 本測試驗證該採用模式與原 useState 行為 100% 等價：
 *   1) 初始值 = initialModelId（六個分頁的預設模型/引擎/工具）
 *   2) setSelectedModelId（agent bridge setModel/setParam 路徑傳入字串）正確切換
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

describe("AIDV-899 ProStudio useGenerationTask 採用模式", () => {
  const tabDefaults: Array<[tab: string, initial: string, switched: string]> = [
    ["music", "ace-step", "suno-v4"],
    ["sfx", "stable-audio", "elevenlabs"],
    ["tts", "elevenlabs", "qwen"],
    ["clone", "qwen", "kling"],
    ["process", "demucs", "merge"],
    ["avatar", "echo", "dubbing"],
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
    const { result } = renderHook(() => useTabModel("ace-step"));
    act(() => result.current.setModel("sonauto"));
    expect(result.current.model).toBe("sonauto");
    act(() => result.current.setModel(undefined));
    expect(result.current.model).toBe("ace-step");
  });

  it("ProStudio 頁面模組載入正常且維持 default export 與 validatePromptBeforeSubmit", async () => {
    const mod = await import("../../../../client/src/pages/ProStudio");
    expect(typeof mod.default).toBe("function");
    expect(typeof mod.validatePromptBeforeSubmit).toBe("function");
  });
});
