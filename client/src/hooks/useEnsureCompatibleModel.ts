/**
 * useEnsureCompatibleModel — 監看當前模型 ↔ 啟用功能組相容性的 hook
 *
 * 工作原則：
 *  - 使用者可自由換模型（selectedFalModelId）
 *  - 但啟用了 token weights / LoRA / 寬比例等功能，且當前模型不相容時：
 *      1. 自動切到該模態下第一個相容的模型
 *      2. 透過 toast 告知使用者「為支援 X 功能，已切換至 Y 模型」
 *  - 由 caller 提供 setSelectedFalModelId 與當前 activeFeatures
 *
 * 使用範例（Studio.tsx）：
 *   useEnsureCompatibleModel({
 *     modality: "image",
 *     selectedModelId: selectedFalModelId,
 *     setModelId: setSelectedFalModelId,
 *     activeFeatures: { loraInjection: !!fineTunedModelId, tokenWeights: hasWeightedTokens },
 *   });
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  type ActiveFeatureSet,
  type ModalityCategory,
  FEATURE_LABELS,
  findCompatibleModel,
  isModelCompatibleWith,
  listIncompatibleFeatures,
  getModelCapability,
} from "@shared/falModelCapabilities";

interface Options {
  modality: ModalityCategory;
  selectedModelId: string | undefined;
  /** 設置 selectedModelId 的 setter（auto-switch 時呼叫） */
  setModelId: (id: string | undefined) => void;
  activeFeatures: ActiveFeatureSet;
  /** 預設 true；設為 false 只警示不切換 */
  autoSwitch?: boolean;
}

export function useEnsureCompatibleModel(opts: Options): {
  isCompatible: boolean;
  incompatibleFeatures: string[];
} {
  const {
    modality,
    selectedModelId,
    setModelId,
    activeFeatures,
    autoSwitch = true,
  } = opts;

  // 防止 toast 風暴：對每組「modelId + 啟用功能集」只通知一次
  const lastToastSignatureRef = useRef<string | null>(null);

  // 推導當前狀態
  const currentModelId = selectedModelId ?? null;
  const incompatibleFeatures = currentModelId
    ? listIncompatibleFeatures(currentModelId, activeFeatures)
    : [];
  const isCompatible = incompatibleFeatures.length === 0;

  useEffect(() => {
    if (!currentModelId) return;
    if (isModelCompatibleWith(currentModelId, activeFeatures)) return;

    const signature = `${currentModelId}::${Object.entries(activeFeatures)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .sort()
      .join(",")}`;
    if (lastToastSignatureRef.current === signature) return;
    lastToastSignatureRef.current = signature;

    const featureLabels = listIncompatibleFeatures(
      currentModelId,
      activeFeatures
    )
      .map(f => FEATURE_LABELS[f])
      .join("、");

    if (autoSwitch) {
      const next = findCompatibleModel(modality, activeFeatures);
      if (next && next !== currentModelId) {
        setModelId(next);
        const nextLabel = getModelCapability(next)?.modelId ?? next;
        toast.info(
          `為支援「${featureLabels}」，已自動切換至 ${nextLabel}`,
          { duration: 4000 }
        );
        return;
      }
    }
    toast.warning(
      `目前模型不支援「${featureLabels}」，可能會被忽略`,
      { duration: 4000 }
    );
  }, [
    currentModelId,
    modality,
    setModelId,
    autoSwitch,
    // 將 activeFeatures 各值展平為依賴
    activeFeatures.tokenWeights,
    activeFeatures.loraInjection,
    activeFeatures.aspectRatioWide,
    activeFeatures.aspectRatioStandard,
    activeFeatures.negativePrompt,
  ]);

  return {
    isCompatible,
    incompatibleFeatures: incompatibleFeatures.map(f => FEATURE_LABELS[f]),
  };
}
