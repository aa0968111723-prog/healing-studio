import { FAL_MODEL_CATALOG } from "./falModels";

export interface OrbModelDescriptor {
  modelId: string;
  label: string;
  tier: "fast" | "standard" | "premium" | "ultra";
  description: string;
  category: string;
  intentTags: string[];
}

const IMAGE_EDIT_TAG_RULES: Array<{ pattern: RegExp; tags: string[] }> = [
  { pattern: /(修圖|潤飾|精修|retouch|beauty)/i, tags: ["retouch", "quality"] },
  { pattern: /(去背|移除背景|background remove|rembg)/i, tags: ["background"] },
  { pattern: /(局部|inpaint|遮罩|mask)/i, tags: ["local-edit"] },
  { pattern: /(合成|融合|多圖|reference|composite)/i, tags: ["multi-reference"] },
  { pattern: /(寫實|photoreal|真實感)/i, tags: ["photoreal"] },
  { pattern: /(快速|快一點|fast)/i, tags: ["speed"] },
  { pattern: /(高品質|高畫質|quality|細節)/i, tags: ["quality"] },
];

const IMAGE_EDIT_MODEL_TAGS: Record<string, string[]> = {
  "fal-ai/nano-banana-pro/edit": ["multi-reference", "quality"],
  "fal-ai/nano-banana/edit": ["speed", "multi-reference"],
  "fal-ai/nano-banana-2/edit": ["speed", "multi-reference", "quality"],
  "fal-ai/bytedance/seedream/v4.5/edit": ["quality", "local-edit"],
  "fal-ai/bytedance/seedream/v5/lite/edit": ["speed", "local-edit"],
  "xai/grok-imagine-image/edit": ["semantic", "quality"],
  "fal-ai/gpt-image-1.5/edit": ["semantic", "local-edit", "quality"],
  "fal-ai/flux-pro/kontext": ["local-edit", "quality", "photoreal"],
  "fal-ai/flux-2-pro/edit": ["photoreal", "multi-reference", "quality"],
};

export function getImageEditModelCatalog(): OrbModelDescriptor[] {
  return (FAL_MODEL_CATALOG["image-to-image"] ?? [])
    .filter(model => model.modelId.includes("edit") || model.modelId.includes("kontext"))
    .map(model => ({
      modelId: model.modelId,
      label: model.label,
      tier: model.tier,
      description: model.description,
      category: model.category,
      intentTags: IMAGE_EDIT_MODEL_TAGS[model.modelId] ?? [],
    }));
}

export function inferImageEditIntentTags(prompt: string): string[] {
  const normalized = prompt.trim();
  if (!normalized) return [];
  const tags = new Set<string>();
  for (const rule of IMAGE_EDIT_TAG_RULES) {
    if (rule.pattern.test(normalized)) {
      rule.tags.forEach(tag => tags.add(tag));
    }
  }
  return Array.from(tags);
}

export function suggestImageEditModelsByPrompt(prompt: string): OrbModelDescriptor[] {
  const tags = inferImageEditIntentTags(prompt);
  const catalog = getImageEditModelCatalog();
  if (tags.length === 0) return catalog;
  return [...catalog]
    .map(model => ({
      model,
      score: model.intentTags.reduce((acc, tag) => acc + (tags.includes(tag) ? 2 : 0), 0) +
        (tags.includes("speed") && model.tier === "fast" ? 1 : 0) +
        (tags.includes("quality") && model.tier === "premium" ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .map(item => item.model);
}
