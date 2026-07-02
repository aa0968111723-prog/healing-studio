import { useCallback } from "react";
import { toast } from "sonner";
import { useAIState } from "@/contexts/AIStateContext";
import {
  useRegisterBgTask,
  type StudioJobType,
} from "@/contexts/BackgroundTasksContext";

/**
 * AIDV-970: useSubmitGeneration — 統一「提交 mutation → 寫結果 →
 * registerBgTask 註冊背景任務 → 成功 toast → 成功/失敗回報 → AI 狀態復位」
 * 的共用提交骨架（承 AIDV-899 的收斂路線）。
 *
 * 兩種既有呼叫風格都覆蓋，行為與抽出前逐字等價：
 *
 * 1) imperative（VideoStudio 各 runX 函式的 try/catch 骨架）：
 *      setAIState("generating");
 *      try {
 *        const r = await mut.mutateAsync(payload);
 *        setResult(r);
 *        registerBgTask(r, "video", label, prompt);
 *        toast.success("📤 任務已提交！稍後自動更新結果...");
 *        reportSuccess();
 *      } catch { reportFailure(); }
 *      finally { setAIState("idle"); }
 *    → await submitGeneration({ mutate, onResult, taskType, taskLabel, taskPrompt });
 *    （錯誤 toast 仍由各 mutation 自己的 onError 顯示，與原行為相同。）
 *
 * 2) declarative（ProStudio 各 useMutation 的 onMutate/onSuccess/onError/onSettled）：
 *    → trpc.x.useMutation(generationMutationCallbacks({ onResult, taskType,
 *        taskLabel, taskPrompt, successToast, errorToast }));
 *    （ProStudio 風格的錯誤 toast 在 onError 內組字串，故由 errorToast 提供前綴組裝。）
 *
 * 【刻意不納入】ProStudio Suno（獨立 taskId/jobId 輪詢語意、registerBgTask
 * 載荷為合成物件）、AvatarVideoTab（fal request_id 流程）、AsyncAudioPoller
 * （既有共用元件另有生命週期）— 這些流程語意不同，留在原地。
 * 輪詢/SSE 追蹤本身由 registerBgTask 背景任務中心與各頁結果面板
 * （VideoResultPanel / AsyncAudioPoller / Suno useQuery）承擔，不在本 hook 內。
 */

/** 與抽出前各 runX 內的字面值完全一致的預設提交成功 toast。 */
export const SUBMIT_SUCCESS_TOAST_DEFAULT = "📤 任務已提交！稍後自動更新結果...";

/** ProStudio 多數 mutation 使用的提交成功 toast 字面值。 */
export const SUBMIT_SUCCESS_TOAST_BG_NOTIFY =
  "📤 任務已提交！背景生成中，完成後會自動通知你";

export interface SubmitGenerationSpec<TData> {
  /** 執行提交（一般為 mutation.mutateAsync(payload)）。 */
  mutate: () => Promise<TData>;
  /** 成功時把結果寫回頁面 state（等價原 setXxxResult(r)）。 */
  onResult?: (data: TData) => void;
  /** registerBgTask 的 studioType。 */
  taskType: StudioJobType;
  /** registerBgTask 的 label。 */
  taskLabel: string;
  /** registerBgTask 的 prompt（原本沒帶的呼叫點維持 undefined）。 */
  taskPrompt?: string;
  /** 成功 toast；預設為 SUBMIT_SUCCESS_TOAST_DEFAULT，可用函式依結果動態決定。 */
  successToast?: string | ((data: TData) => string);
}

export interface GenerationMutationCallbacksSpec {
  /** 成功時把結果寫回頁面 state（等價原 onSuccess 內的 setResult(data)）。 */
  onResult?: (data: unknown) => void;
  taskType: StudioJobType;
  taskLabel: string;
  taskPrompt?: string;
  /** 成功 toast；預設為 SUBMIT_SUCCESS_TOAST_DEFAULT，可用函式依結果動態決定。 */
  successToast?: string | ((data: unknown) => string);
  /** 錯誤 toast 組裝（等價原 onError 內的 toast.error(`前綴：${e.message}`)）。 */
  errorToast: (message: string) => string;
}

export interface GenerationMutationCallbacks {
  onMutate: () => void;
  onSuccess: (data: unknown) => void;
  onError: (e: { message: string }) => void;
  onSettled: () => void;
}

function resolveSuccessToast<TData>(
  successToast: string | ((data: TData) => string) | undefined,
  data: TData
): string {
  if (typeof successToast === "function") return successToast(data);
  return successToast ?? SUBMIT_SUCCESS_TOAST_DEFAULT;
}

export interface UseSubmitGenerationReturn {
  /** imperative 骨架（VideoStudio runX）。 */
  submitGeneration: <TData>(spec: SubmitGenerationSpec<TData>) => Promise<void>;
  /** declarative 骨架（ProStudio useMutation callbacks）。 */
  generationMutationCallbacks: (
    spec: GenerationMutationCallbacksSpec
  ) => GenerationMutationCallbacks;
}

export function useSubmitGeneration(): UseSubmitGenerationReturn {
  const registerBgTask = useRegisterBgTask();
  const { setAIState, reportSuccess, reportFailure } = useAIState();

  const submitGeneration = useCallback(
    async <TData,>(spec: SubmitGenerationSpec<TData>): Promise<void> => {
      setAIState("generating");
      try {
        const r = await spec.mutate();
        spec.onResult?.(r);
        // 與原行為一致：registerBgTask 為 fire-and-forget，不 await。
        registerBgTask(r, spec.taskType, spec.taskLabel, spec.taskPrompt);
        toast.success(resolveSuccessToast(spec.successToast, r));
        reportSuccess();
      } catch {
        // 錯誤 toast 由各 mutation 自己的 onError 顯示（原骨架同樣只回報失敗）。
        reportFailure();
      } finally {
        setAIState("idle");
      }
    },
    [registerBgTask, setAIState, reportSuccess, reportFailure]
  );

  const generationMutationCallbacks = useCallback(
    (spec: GenerationMutationCallbacksSpec): GenerationMutationCallbacks => ({
      onMutate: () => setAIState("generating"),
      onSuccess: (data: unknown) => {
        spec.onResult?.(data);
        registerBgTask(data, spec.taskType, spec.taskLabel, spec.taskPrompt);
        toast.success(resolveSuccessToast(spec.successToast, data));
        reportSuccess();
      },
      onError: (e: { message: string }) => {
        toast.error(spec.errorToast(e.message));
        reportFailure();
      },
      onSettled: () => setAIState("idle"),
    }),
    [registerBgTask, setAIState, reportSuccess, reportFailure]
  );

  return { submitGeneration, generationMutationCallbacks };
}
