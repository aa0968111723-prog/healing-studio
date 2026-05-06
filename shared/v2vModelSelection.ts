/**
 * V2V Model Selection Integration for Orb Agent
 *
 * 此模組提供 Orb 代理整合 V2V 模型資料庫的輔助函式。
 * 可在 agentToolExecutor.ts 的 studio.generateVideo 中使用，
 * 依據使用者提示詞自動選擇最適合的 video-to-video 模型。
 */

import {
  rankV2VModelsByPrompt,
  pickBestV2VModel,
  getV2VModelsByUseCase,
  type V2VModelMatch,
  type V2VModelProfile,
} from "./v2vModelRegistry";

export interface V2VModelSuggestion {
  recommendedModelId: string;
  confidence: "high" | "medium" | "low";
  alternatives: string[];
  rationale: string;
}

/**
 * 基於使用者提示詞，為 Orb 代理推薦 V2V 模型。
 *
 * @param prompt 使用者的提示詞或需求描述
 * @param fallbackModelId 如果無法推薦，使用的回退模型 ID
 * @returns V2V 模型推薦結果
 *
 * @example
 * const suggestion = suggestV2VModelForOrb("需要快速風格遷移測試");
 * console.log(suggestion.recommendedModelId); // "fal-ai/wan/v2.1/video-to-video"
 */
export function suggestV2VModelForOrb(
  prompt: string,
  fallbackModelId: string = "fal-ai/wan/v2.1/video-to-video"
): V2VModelSuggestion {
  const ranked = rankV2VModelsByPrompt(prompt);
  const topMatch = ranked[0];

  if (!topMatch || topMatch.score === 0) {
    return {
      recommendedModelId: fallbackModelId,
      confidence: "low",
      alternatives: ranked.slice(0, 3).map((m) => m.modelId),
      rationale: `未能從提示詞中識別明確需求，使用預設模型 ${fallbackModelId}`,
    };
  }

  // 高信心：匹配 3+ 關鍵詞
  if (topMatch.score >= 3) {
    return {
      recommendedModelId: topMatch.modelId,
      confidence: "high",
      alternatives: ranked.slice(1, 4).map((m) => m.modelId),
      rationale: topMatch.rationale,
    };
  }

  // 中等信心：匹配 1-2 關鍵詞
  if (topMatch.score >= 1) {
    return {
      recommendedModelId: topMatch.modelId,
      confidence: "medium",
      alternatives: ranked.slice(1, 4).map((m) => m.modelId),
      rationale: topMatch.rationale,
    };
  }

  return {
    recommendedModelId: fallbackModelId,
    confidence: "low",
    alternatives: ranked.slice(0, 3).map((m) => m.modelId),
    rationale: "關鍵詞匹配度較低，建議使用預設模型",
  };
}

/**
 * 為 Orb 代理提供可讀的模型推薦說明。
 * 可用於 agent planner 的知識庫或回應給使用者。
 *
 * @param prompt 使用者的提示詞
 * @returns 適合給 Orb 代理閱讀的模型推薦說明
 *
 * @example
 * const explanation = explainV2VModelChoiceForOrb("需要骨架控制的精準動作");
 * // 返回："基於您的需求，推薦使用 AnimateDiff V2V..."
 */
export function explainV2VModelChoiceForOrb(prompt: string): string {
  const suggestion = suggestV2VModelForOrb(prompt);
  const best = pickBestV2VModel(prompt);

  let explanation = `基於您的需求「${prompt}」，`;

  if (suggestion.confidence === "high") {
    explanation += `強烈推薦使用 ${suggestion.recommendedModelId}。`;
    explanation += `\n原因：${best.rationale}`;
  } else if (suggestion.confidence === "medium") {
    explanation += `建議使用 ${suggestion.recommendedModelId}。`;
    explanation += `\n原因：${best.rationale}`;
  } else {
    explanation += `使用預設模型 ${suggestion.recommendedModelId}。`;
    explanation += `\n原因：提示詞中未包含明確的模型選擇關鍵詞。`;
  }

  if (suggestion.alternatives.length > 0) {
    explanation += `\n\n其他可選模型：${suggestion.alternatives.join(", ")}`;
  }

  return explanation;
}

/**
 * 檢查給定的模型 ID 是否適合當前使用場景。
 * 用於驗證使用者指定的模型或 brain 設定的模型是否合理。
 *
 * @param modelId 要檢查的模型 ID
 * @param prompt 使用者的提示詞
 * @returns 是否適合及原因
 */
export function validateV2VModelChoice(
  modelId: string,
  prompt: string
): { isValid: boolean; reason: string } {
  const suggestion = suggestV2VModelForOrb(prompt);

  if (modelId === suggestion.recommendedModelId) {
    return {
      isValid: true,
      reason: "所選模型與推薦模型一致",
    };
  }

  if (suggestion.alternatives.includes(modelId)) {
    return {
      isValid: true,
      reason: "所選模型是備選方案之一",
    };
  }

  return {
    isValid: false,
    reason: `所選模型 ${modelId} 可能不適合當前需求。推薦使用：${suggestion.recommendedModelId}`,
  };
}

// 重新導出核心函式供其他模組使用
export {
  rankV2VModelsByPrompt,
  pickBestV2VModel,
  getV2VModelsByUseCase,
  type V2VModelMatch,
  type V2VModelProfile,
};
