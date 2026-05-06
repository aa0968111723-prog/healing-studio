/**
 * shared/unifiedModelRegistry.ts
 * ═════════════════════════════════════════════════════════════════════════════
 * 全站光球代理統一模型資訊資料庫 (Unified Model Information Database)
 *
 * 目標：
 * 1) 整合所有專業領域的模型註冊表（影像放大、文字生圖、3D 模型等）
 * 2) 提供統一的查詢介面，讓 Orb 代理能根據使用者提示詞自動選擇最適合的模型
 * 3) 作為全站模型資訊的唯一真實來源 (Single Source of Truth - SSOT)
 *
 * 使用場景：
 * - Orb 代理分析使用者需求時，查詢最佳模型
 * - Planner / System Prompt 注入模型能力描述
 * - 前端顯示可用模型列表與說明
 */

import {
  IMAGE_UPSCALE_MODEL_REGISTRY,
  type ImageUpscaleModelProfile,
  type ImageUpscaleModelMatch,
  rankImageUpscaleModelsByPrompt,
  pickBestImageUpscaleModel,
} from "./imageUpscaleModelRegistry";

import {
  TEXT_TO_IMAGE_MODEL_REGISTRY,
  type TextToImageModelProfile,
  type TextToImageModelMatch,
  rankTextToImageModelsByPrompt,
  pickBestTextToImageModel,
} from "./textToImageModelRegistry";

import {
  SKELETAL_MODEL_REGISTRY,
  type SkeletalModelProfile,
  type SkeletalModelMatch,
  rankSkeletalModelsByPrompt,
  pickBestSkeletalModel,
} from "./skeletalModelRegistry";

// ═════════════════════════════════════════════════════════════════════════════
// 類型定義 (Type Definitions)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 模型領域類別
 */
export type ModelDomain =
  | "image-upscale"      // 影像畫質優化/放大
  | "text-to-image"      // 文字生成影像
  | "image-to-3d"        // 影像生成 3D 模型
  | "image-to-world";    // 影像生成 3D 世界場景

/**
 * 統一的模型描述介面
 */
export interface UnifiedModelProfile {
  modelId: string;
  label: string;
  provider: string;
  domain: ModelDomain;
  category?: string;
  strengths: string[];
  avoidWhen: string[];
  promptKeywords: string[];
  tier?: "fast" | "standard" | "premium";
}

/**
 * 統一的模型匹配結果
 */
export interface UnifiedModelMatch {
  modelId: string;
  domain: ModelDomain;
  score: number;
  matchedKeywords: string[];
  rationale: string;
}

/**
 * 模型查詢選項
 */
export interface ModelQueryOptions {
  /** 限定查詢的領域，不指定則查詢所有領域 */
  domains?: ModelDomain[];
  /** 最小匹配分數，低於此分數的結果會被過濾 */
  minScore?: number;
  /** 最多返回多少個結果 */
  limit?: number;
}

// ═════════════════════════════════════════════════════════════════════════════
// 統一模型資料庫 (Unified Model Database)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 將特定領域的模型轉換為統一格式
 */
function normalizeImageUpscaleModel(model: ImageUpscaleModelProfile): UnifiedModelProfile {
  return {
    modelId: model.modelId,
    label: model.label,
    provider: model.provider,
    domain: "image-upscale",
    strengths: model.strengths,
    avoidWhen: model.avoidWhen,
    promptKeywords: model.promptKeywords,
  };
}

function normalizeTextToImageModel(model: TextToImageModelProfile): UnifiedModelProfile {
  return {
    modelId: model.modelId,
    label: model.label,
    provider: model.provider,
    domain: "text-to-image",
    strengths: model.strengths,
    avoidWhen: model.avoidWhen,
    promptKeywords: model.promptKeywords,
  };
}

function normalizeSkeletalModel(model: SkeletalModelProfile): UnifiedModelProfile {
  return {
    modelId: model.modelId,
    label: model.label,
    provider: model.provider,
    domain: model.category === "image-to-world" ? "image-to-world" : "image-to-3d",
    category: model.category,
    strengths: model.strengths,
    avoidWhen: model.avoidWhen,
    promptKeywords: model.promptKeywords,
  };
}

/**
 * 統一模型資料庫 - 所有模型的完整清單
 */
export const UNIFIED_MODEL_REGISTRY: readonly UnifiedModelProfile[] = [
  ...IMAGE_UPSCALE_MODEL_REGISTRY.map(normalizeImageUpscaleModel),
  ...TEXT_TO_IMAGE_MODEL_REGISTRY.map(normalizeTextToImageModel),
  ...SKELETAL_MODEL_REGISTRY.map(normalizeSkeletalModel),
];

// ═════════════════════════════════════════════════════════════════════════════
// 查詢函式 (Query Functions)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 根據領域取得所有模型
 */
export function getModelsByDomain(domain: ModelDomain): UnifiedModelProfile[] {
  return UNIFIED_MODEL_REGISTRY.filter(model => model.domain === domain);
}

/**
 * 根據模型 ID 取得模型資訊
 */
export function getModelById(modelId: string): UnifiedModelProfile | undefined {
  return UNIFIED_MODEL_REGISTRY.find(model => model.modelId === modelId);
}

/**
 * 根據提示詞查詢所有領域的最佳模型
 *
 * @param prompt - 使用者的提示詞
 * @param options - 查詢選項
 * @returns 按匹配分數排序的模型列表
 */
export function queryModelsByPrompt(
  prompt: string,
  options: ModelQueryOptions = {}
): UnifiedModelMatch[] {
  const { domains, minScore = 0, limit } = options;
  const results: UnifiedModelMatch[] = [];

  // 查詢影像放大模型
  if (!domains || domains.includes("image-upscale")) {
    const matches = rankImageUpscaleModelsByPrompt(prompt);
    results.push(
      ...matches.map(m => ({
        modelId: m.modelId,
        domain: "image-upscale" as ModelDomain,
        score: m.score,
        matchedKeywords: m.matchedKeywords,
        rationale: m.rationale,
      }))
    );
  }

  // 查詢文字生圖模型
  if (!domains || domains.includes("text-to-image")) {
    const matches = rankTextToImageModelsByPrompt(prompt);
    results.push(
      ...matches.map(m => ({
        modelId: m.modelId,
        domain: "text-to-image" as ModelDomain,
        score: m.score,
        matchedKeywords: m.matchedKeywords,
        rationale: m.rationale,
      }))
    );
  }

  // 查詢 3D 模型（包含 image-to-3d 和 image-to-world）
  if (!domains || domains.includes("image-to-3d") || domains.includes("image-to-world")) {
    const matches = rankSkeletalModelsByPrompt(prompt);
    results.push(
      ...matches.map(m => {
        const model = SKELETAL_MODEL_REGISTRY.find(model => model.modelId === m.modelId);
        return {
          modelId: m.modelId,
          domain: (model?.category === "image-to-world" ? "image-to-world" : "image-to-3d") as ModelDomain,
          score: m.score,
          matchedKeywords: m.matchedKeywords,
          rationale: m.rationale,
        };
      })
    );
  }

  // 過濾並排序
  let filtered = results.filter(r => r.score >= minScore);
  filtered.sort((a, b) => b.score - a.score);

  if (limit) {
    filtered = filtered.slice(0, limit);
  }

  return filtered;
}

/**
 * 為特定領域選擇最佳模型
 *
 * @param domain - 模型領域
 * @param prompt - 使用者的提示詞
 * @returns 最佳模型匹配結果
 */
export function pickBestModelForDomain(
  domain: ModelDomain,
  prompt: string
): UnifiedModelMatch {
  switch (domain) {
    case "image-upscale": {
      const match = pickBestImageUpscaleModel(prompt);
      return {
        modelId: match.modelId,
        domain,
        score: match.score,
        matchedKeywords: match.matchedKeywords,
        rationale: match.rationale,
      };
    }
    case "text-to-image": {
      const match = pickBestTextToImageModel(prompt);
      return {
        modelId: match.modelId,
        domain,
        score: match.score,
        matchedKeywords: match.matchedKeywords,
        rationale: match.rationale,
      };
    }
    case "image-to-3d":
    case "image-to-world": {
      const match = pickBestSkeletalModel(prompt);
      const model = SKELETAL_MODEL_REGISTRY.find(m => m.modelId === match.modelId);
      return {
        modelId: match.modelId,
        domain: model?.category === "image-to-world" ? "image-to-world" : "image-to-3d",
        score: match.score,
        matchedKeywords: match.matchedKeywords,
        rationale: match.rationale,
      };
    }
  }
}

/**
 * 推斷提示詞對應的領域類型
 *
 * 根據提示詞中的關鍵字判斷使用者可能需要的模型類型
 */
export function inferDomainFromPrompt(prompt: string): ModelDomain[] {
  const normalized = prompt.toLowerCase();
  const domains: ModelDomain[] = [];

  // 影像放大相關關鍵字
  const upscaleKeywords = ["upscale", "放大", "enhance", "增強", "4k", "8k", "高畫質", "high quality", "restore"];
  if (upscaleKeywords.some(kw => normalized.includes(kw))) {
    domains.push("image-upscale");
  }

  // 文字生圖相關關鍵字
  const textToImageKeywords = ["generate", "生成", "create image", "draw", "畫", "圖", "photo", "照片"];
  if (textToImageKeywords.some(kw => normalized.includes(kw))) {
    domains.push("text-to-image");
  }

  // 3D 模型相關關鍵字
  const image3DKeywords = ["3d", "model", "模型", "mesh", "object", "物件"];
  if (image3DKeywords.some(kw => normalized.includes(kw))) {
    domains.push("image-to-3d");
  }

  // 3D 世界場景相關關鍵字
  const worldKeywords = ["world", "scene", "場景", "environment", "環境", "terrain", "level"];
  if (worldKeywords.some(kw => normalized.includes(kw))) {
    domains.push("image-to-world");
  }

  // 如果沒有匹配到任何關鍵字，返回所有領域
  return domains.length > 0 ? domains : ["image-upscale", "text-to-image", "image-to-3d", "image-to-world"];
}

/**
 * 智慧模型推薦 - 自動推斷領域並選擇最佳模型
 *
 * 這是最高層級的 API，適合 Orb 代理直接使用
 */
export function recommendModels(prompt: string, maxResults = 3): UnifiedModelMatch[] {
  // 1. 推斷可能的領域
  const inferredDomains = inferDomainFromPrompt(prompt);

  // 2. 在推斷的領域中查詢模型
  const results = queryModelsByPrompt(prompt, {
    domains: inferredDomains,
    minScore: 0, // 包含所有結果，即使沒有關鍵字匹配
    limit: maxResults,
  });

  return results;
}

/**
 * 生成模型推薦說明文字，供 Orb 代理使用
 */
export function generateModelRecommendationText(matches: UnifiedModelMatch[]): string {
  if (matches.length === 0) {
    return "目前沒有找到合適的模型。";
  }

  const lines = matches.map((match, index) => {
    const model = getModelById(match.modelId);
    if (!model) return "";

    const ranking = index === 0 ? "🥇 最推薦" : index === 1 ? "🥈 次選" : "🥉 備選";
    const keywords = match.matchedKeywords.length > 0
      ? `命中關鍵詞: ${match.matchedKeywords.join(", ")}`
      : "通用模型";

    return `${ranking}: ${model.label} (${model.modelId})
   領域: ${model.domain}
   優勢: ${model.strengths.join("、")}
   ${keywords}
   ${match.rationale}`;
  });

  return lines.filter(Boolean).join("\n\n");
}

// ═════════════════════════════════════════════════════════════════════════════
// 統計與摘要 (Statistics & Summary)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * 取得模型資料庫統計資訊
 */
export function getModelRegistryStats() {
  const stats = {
    total: UNIFIED_MODEL_REGISTRY.length,
    byDomain: {
      "image-upscale": 0,
      "text-to-image": 0,
      "image-to-3d": 0,
      "image-to-world": 0,
    },
    byProvider: {} as Record<string, number>,
  };

  UNIFIED_MODEL_REGISTRY.forEach(model => {
    stats.byDomain[model.domain]++;
    stats.byProvider[model.provider] = (stats.byProvider[model.provider] || 0) + 1;
  });

  return stats;
}

/**
 * 生成全站模型資訊摘要，供 Orb System Prompt 使用
 */
export function generateModelRegistrySummary(): string {
  const stats = getModelRegistryStats();

  return `# 全站模型資訊摘要

共有 ${stats.total} 個模型可供使用：

## 依領域分類
- 影像畫質優化 (image-upscale): ${stats.byDomain["image-upscale"]} 個模型
- 文字生成影像 (text-to-image): ${stats.byDomain["text-to-image"]} 個模型
- 影像生成 3D 模型 (image-to-3d): ${stats.byDomain["image-to-3d"]} 個模型
- 影像生成 3D 世界 (image-to-world): ${stats.byDomain["image-to-world"]} 個模型

## 依提供者分類
${Object.entries(stats.byProvider).map(([provider, count]) => `- ${provider}: ${count} 個模型`).join("\n")}

使用 queryModelsByPrompt() 或 recommendModels() 函式來根據使用者提示詞選擇最適合的模型。`;
}

// ═════════════════════════════════════════════════════════════════════════════
// 導出所有子註冊表，供需要直接存取的場景使用
// ═════════════════════════════════════════════════════════════════════════════

export {
  // Image Upscale Registry
  IMAGE_UPSCALE_MODEL_REGISTRY,
  type ImageUpscaleModelProfile,
  type ImageUpscaleModelMatch,
  rankImageUpscaleModelsByPrompt,
  pickBestImageUpscaleModel,

  // Text-to-Image Registry
  TEXT_TO_IMAGE_MODEL_REGISTRY,
  type TextToImageModelProfile,
  type TextToImageModelMatch,
  rankTextToImageModelsByPrompt,
  pickBestTextToImageModel,

  // Skeletal/3D Model Registry
  SKELETAL_MODEL_REGISTRY,
  type SkeletalModelProfile,
  type SkeletalModelMatch,
  rankSkeletalModelsByPrompt,
  pickBestSkeletalModel,
};
