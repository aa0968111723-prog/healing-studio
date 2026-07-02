// @vitest-environment jsdom
/**
 * AIDV-970: useSubmitGeneration.test.ts
 *
 * 驗收（兩種骨架的行為順序與內容都必須與抽出前逐字等價）：
 *   ✅ imperative submitGeneration：
 *        成功 → setAIState("generating") → mutate → onResult → registerBgTask
 *              → toast.success(預設文案) → reportSuccess → setAIState("idle")
 *        失敗 → reportFailure（不 toast，錯誤 toast 由 mutation onError 負責）
 *              → setAIState("idle")
 *   ✅ declarative generationMutationCallbacks：
 *        onMutate → setAIState("generating")
 *        onSuccess → onResult → registerBgTask → toast.success → reportSuccess
 *        onError → toast.error(errorToast(message)) → reportFailure
 *        onSettled → setAIState("idle")
 *   ✅ successToast 支援字串與函式（MusicTab 條件式完成文案）
 *   ✅ taskPrompt 未提供時 registerBgTask 第 4 參數為 undefined
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const registerBgTask = vi.fn().mockResolvedValue(1);
vi.mock("@/contexts/BackgroundTasksContext", () => ({
  useRegisterBgTask: () => registerBgTask,
}));

const setAIState = vi.fn();
const reportSuccess = vi.fn();
const reportFailure = vi.fn();
vi.mock("@/contexts/AIStateContext", () => ({
  useAIState: () => ({ setAIState, reportSuccess, reportFailure }),
}));

import {
  useSubmitGeneration,
  SUBMIT_SUCCESS_TOAST_DEFAULT,
  SUBMIT_SUCCESS_TOAST_BG_NOTIFY,
} from "../useSubmitGeneration";

/** 依呼叫順序收集事件，驗證骨架步驟順序不變。 */
function orderedCalls(): string[] {
  const events: Array<{ name: string; order: number }> = [];
  const collect = (name: string, mock: ReturnType<typeof vi.fn>) => {
    for (const order of mock.mock.invocationCallOrder) {
      events.push({ name, order });
    }
  };
  collect("setAIState", setAIState);
  collect("registerBgTask", registerBgTask);
  collect("toast.success", toastSuccess);
  collect("toast.error", toastError);
  collect("reportSuccess", reportSuccess);
  collect("reportFailure", reportFailure);
  return events.sort((a, b) => a.order - b.order).map(e => e.name);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useSubmitGeneration — imperative submitGeneration（VideoStudio runX 骨架）", () => {
  it("成功路徑：順序與內容等價原 try 區塊", async () => {
    const { result } = renderHook(() => useSubmitGeneration());
    const data = { request_id: "req-1" };
    const onResult = vi.fn();

    await act(() =>
      result.current.submitGeneration({
        mutate: () => Promise.resolve(data),
        onResult,
        taskType: "video",
        taskLabel: "Kling 文生影",
        taskPrompt: "a cat",
      })
    );

    expect(setAIState).toHaveBeenNthCalledWith(1, "generating");
    expect(setAIState).toHaveBeenNthCalledWith(2, "idle");
    expect(onResult).toHaveBeenCalledWith(data);
    expect(registerBgTask).toHaveBeenCalledWith(
      data,
      "video",
      "Kling 文生影",
      "a cat"
    );
    expect(toastSuccess).toHaveBeenCalledWith(SUBMIT_SUCCESS_TOAST_DEFAULT);
    expect(reportSuccess).toHaveBeenCalledTimes(1);
    expect(reportFailure).not.toHaveBeenCalled();
    expect(orderedCalls()).toEqual([
      "setAIState",
      "registerBgTask",
      "toast.success",
      "reportSuccess",
      "setAIState",
    ]);
  });

  it("失敗路徑：只 reportFailure＋復位，不吐 toast（錯誤 toast 屬 mutation onError）", async () => {
    const { result } = renderHook(() => useSubmitGeneration());
    const onResult = vi.fn();

    await act(() =>
      result.current.submitGeneration({
        mutate: () => Promise.reject(new Error("boom")),
        onResult,
        taskType: "video",
        taskLabel: "Wan 文生影",
      })
    );

    expect(onResult).not.toHaveBeenCalled();
    expect(registerBgTask).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(reportSuccess).not.toHaveBeenCalled();
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(setAIState).toHaveBeenNthCalledWith(1, "generating");
    expect(setAIState).toHaveBeenNthCalledWith(2, "idle");
  });

  it("taskPrompt 未提供 → registerBgTask 第 4 參數為 undefined（等價原無 prompt 呼叫點）", async () => {
    const { result } = renderHook(() => useSubmitGeneration());
    await act(() =>
      result.current.submitGeneration({
        mutate: () => Promise.resolve({ ok: true }),
        taskType: "video",
        taskLabel: "影片超解析度",
      })
    );
    expect(registerBgTask).toHaveBeenCalledWith(
      { ok: true },
      "video",
      "影片超解析度",
      undefined
    );
  });
});

describe("useSubmitGeneration — generationMutationCallbacks（ProStudio useMutation 骨架）", () => {
  it("onMutate/onSuccess/onSettled：順序與內容等價原 callbacks", () => {
    const { result } = renderHook(() => useSubmitGeneration());
    const onResult = vi.fn();
    const cb = result.current.generationMutationCallbacks({
      onResult,
      taskType: "audio",
      taskLabel: "🔊 音效生成",
      taskPrompt: "rain",
      successToast: SUBMIT_SUCCESS_TOAST_BG_NOTIFY,
      errorToast: m => `生成失敗：${m}`,
    });

    const data = { audio_url: "https://x/a.mp3" };
    cb.onMutate();
    cb.onSuccess(data);
    cb.onSettled();

    expect(setAIState).toHaveBeenNthCalledWith(1, "generating");
    expect(onResult).toHaveBeenCalledWith(data);
    expect(registerBgTask).toHaveBeenCalledWith(
      data,
      "audio",
      "🔊 音效生成",
      "rain"
    );
    expect(toastSuccess).toHaveBeenCalledWith(SUBMIT_SUCCESS_TOAST_BG_NOTIFY);
    expect(reportSuccess).toHaveBeenCalledTimes(1);
    expect(setAIState).toHaveBeenNthCalledWith(2, "idle");
    expect(orderedCalls()).toEqual([
      "setAIState",
      "registerBgTask",
      "toast.success",
      "reportSuccess",
      "setAIState",
    ]);
  });

  it("onError：toast.error(errorToast(message)) → reportFailure", () => {
    const { result } = renderHook(() => useSubmitGeneration());
    const cb = result.current.generationMutationCallbacks({
      taskType: "voice",
      taskLabel: "🎤 ElevenLabs 語音",
      errorToast: m => `合成失敗：${m}`,
    });

    cb.onError({ message: "quota exceeded" });

    expect(toastError).toHaveBeenCalledWith("合成失敗：quota exceeded");
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(reportSuccess).not.toHaveBeenCalled();
  });

  it("successToast 函式形式：依結果動態決定文案（MusicTab 條件式完成訊息）", () => {
    const { result } = renderHook(() => useSubmitGeneration());
    const cb = result.current.generationMutationCallbacks({
      taskType: "audio",
      taskLabel: "🎵 音樂生成",
      successToast: data => {
        const r = data as { audio_url?: string; url?: string };
        return (r.audio_url ?? r.url)
          ? "🎵 音樂生成完成！"
          : SUBMIT_SUCCESS_TOAST_DEFAULT;
      },
      errorToast: m => `生成失敗：${m}`,
    });

    cb.onSuccess({ audio_url: "https://x/a.mp3" });
    expect(toastSuccess).toHaveBeenLastCalledWith("🎵 音樂生成完成！");

    cb.onSuccess({ request_id: "pending" });
    expect(toastSuccess).toHaveBeenLastCalledWith(SUBMIT_SUCCESS_TOAST_DEFAULT);
  });

  it("successToast 未提供 → 預設文案", () => {
    const { result } = renderHook(() => useSubmitGeneration());
    const cb = result.current.generationMutationCallbacks({
      taskType: "audio",
      taskLabel: "📝 語音識別",
      errorToast: m => `失敗：${m}`,
    });
    cb.onSuccess({});
    expect(toastSuccess).toHaveBeenCalledWith(SUBMIT_SUCCESS_TOAST_DEFAULT);
  });
});
