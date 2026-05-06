export type ThreeDInputMode = "image-to-3d" | "text-to-3d";

export interface ThreeDModelProfile {
  modelId: string;
  name: string;
  modes: ThreeDInputMode[];
  tags: string[];
  recommendedFor: string[];
}

/**
 * 全站光球代理可直接使用的 3D 模型資料庫。
 * 目前先聚焦 Image -> 3D，再兼容 Text -> 3D 的 fallback。
 */
export const THREE_D_MODEL_REGISTRY: ThreeDModelProfile[] = [
  {
    modelId: "fal-ai/trellis",
    name: "Trellis",
    modes: ["image-to-3d", "text-to-3d"],
    tags: ["high detail", "mesh", "general"],
    recommendedFor: ["high quality", "realistic", "product", "scan"],
  },
  {
    modelId: "fal-ai/tripo3d",
    name: "Tripo3D",
    modes: ["image-to-3d", "text-to-3d"],
    tags: ["fast", "balanced", "general"],
    recommendedFor: ["fast", "quick draft", "prototype", "concept"],
  },
  {
    modelId: "fal-ai/sam-3/3d-objects",
    name: "SAM 3D Objects",
    modes: ["image-to-3d"],
    tags: ["object", "single asset", "extraction"],
    recommendedFor: ["single object", "cutout", "asset", "isolated subject"],
  },
  {
    modelId: "fal-ai/hunyuan3d-v3/image-to-3d",
    name: "Hunyuan3D v3",
    modes: ["image-to-3d"],
    tags: ["stylized", "clean topology"],
    recommendedFor: ["stylized", "anime", "character", "game asset"],
  },
  {
    modelId: "fal-ai/hyper3d/rodin",
    name: "Hyper3D Rodin",
    modes: ["image-to-3d", "text-to-3d"],
    tags: ["character", "creative", "fusion"],
    recommendedFor: ["character", "avatar", "creative", "sculpture"],
  },
];

export function inferThreeDModeFromPrompt(prompt: string): ThreeDInputMode {
  const text = prompt.toLowerCase();
  const imageHints = ["image", "photo", "from picture", "upload", "reference"];
  return imageHints.some(keyword => text.includes(keyword)) ? "image-to-3d" : "text-to-3d";
}

export function recommendThreeDModels(prompt: string, limit = 3): ThreeDModelProfile[] {
  const mode = inferThreeDModeFromPrompt(prompt);
  const text = prompt.toLowerCase();

  return THREE_D_MODEL_REGISTRY
    .filter(model => model.modes.includes(mode))
    .map(model => {
      const score = model.recommendedFor.reduce((acc, keyword) => {
        return acc + (text.includes(keyword) ? 1 : 0);
      }, 0);
      return { model, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.model);
}
