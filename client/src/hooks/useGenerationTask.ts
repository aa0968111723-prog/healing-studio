import { useCallback, useState } from "react";

/** Generic params bag shared across all generation modalities. */
export type GenerationParams = Record<string, string | number | boolean>;

export interface UseGenerationTaskOptions {
  initialModelId?: string;
  initialParams?: GenerationParams;
}

export interface UseGenerationTaskReturn {
  /** Currently selected model ID. */
  selectedModelId: string | undefined;
  setSelectedModelId: (id: string | undefined) => void;
  /** Flat params bag for model-specific sliders / dropdowns. */
  params: GenerationParams;
  /** Full setter — use this when passing down to child components that expect a React setter. */
  setParams: React.Dispatch<React.SetStateAction<GenerationParams>>;
  /** Set a single param key. */
  setParam: (key: string, value: string | number | boolean) => void;
  /** Clear all params (e.g. when switching models). */
  resetParams: () => void;
  /** Whether a generation is actively in flight (manually tracked by the caller). */
  isGenerating: boolean;
  setIsGenerating: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Shared state for the model-selection + params + in-flight tracking pattern
 * that all four studio pages repeat independently.
 *
 * Migration guide (逐頁遷移):
 *   const { selectedModelId, setSelectedModelId, params, setParams, resetParams } = useGenerationTask();
 *   // alias to match existing local names if needed:
 *   //   selectedModelId → selectedFalModelId
 *   //   setParams       → setSelectedModelParams (for passing to child components)
 *   //   resetParams()   → replaces setSelectedModelParams({})
 */
export function useGenerationTask(
  opts?: UseGenerationTaskOptions
): UseGenerationTaskReturn {
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>(
    opts?.initialModelId
  );
  const [params, setParams] = useState<GenerationParams>(
    opts?.initialParams ?? {}
  );
  const [isGenerating, setIsGenerating] = useState(false);

  const setParam = useCallback(
    (key: string, value: string | number | boolean) => {
      setParams(prev => ({ ...prev, [key]: value }));
    },
    []
  );

  const resetParams = useCallback(() => setParams({}), []);

  return {
    selectedModelId,
    setSelectedModelId,
    params,
    setParams,
    setParam,
    resetParams,
    isGenerating,
    setIsGenerating,
  };
}
