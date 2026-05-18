/**
 * orbCreativeModelHints — short prompt block of "models the planner is
 * actually allowed to recommend".
 *
 * Why this exists: the brainstorming arc ends with the planner suggesting
 * 2-3 modality models ("Veo 3 for cinematic / Hailuo for character /
 * Suno for BGM"). Without grounding, the planner happily invents names
 * that the studio doesn't actually run. We pin recommendations to a real
 * catalog by injecting a compact "available creative models" block into
 * the planner context.
 *
 * Source of truth: `shared/aiModelsCatalog.ts` — featured models first,
 * then fill from the catalog. We pick at most 3 per modality so the block
 * stays under ~600 tokens.
 */

import {
  AI_MODELS_CATALOG,
  type AIModelEntry,
  type ModelModality,
} from "../../shared/aiModelsCatalog";

const MAX_PER_MODALITY = 3;

type CreativeModality = Extract<ModelModality, "video" | "image" | "audio">;

const MODALITY_HEADERS: Record<CreativeModality, string> = {
  video: "影片 (video)",
  image: "圖像／海報 (image)",
  audio: "音樂／配樂／配音 (audio)",
};

function pickTopModels(modality: CreativeModality): AIModelEntry[] {
  const candidates = AI_MODELS_CATALOG.filter(m => m.modality === modality);
  const featured = candidates.filter(m => m.featured === true);
  const rest = candidates.filter(m => m.featured !== true);
  // Featured first (curated picks), then fall through to the catalog order
  // which already groups by provider tier in the source file.
  return [...featured, ...rest].slice(0, MAX_PER_MODALITY);
}

function formatModel(entry: AIModelEntry): string {
  const tag = entry.tagline?.trim() || entry.description?.split("。")[0] || "";
  const truncated = tag.length > 60 ? `${tag.slice(0, 59)}…` : tag;
  return `  - ${entry.name}：${truncated}`;
}

/**
 * Build the prompt block. Returns "" when the catalog has no entries for
 * a given modality (defensive — shouldn't happen with the shipped catalog).
 */
export function buildCreativeModelHintsBlock(): string {
  const sections: string[] = [];
  for (const modality of ["video", "image", "audio"] as const) {
    const picks = pickTopModels(modality);
    if (picks.length === 0) continue;
    sections.push(`${MODALITY_HEADERS[modality]}:`);
    for (const entry of picks) sections.push(formatModel(entry));
  }
  if (sections.length === 0) return "";
  return [
    "【可推薦的創意模型 / Available Creative Models】",
    "推薦模態模型時請只從以下清單挑選；不要捏造未列出的模型名稱。",
    ...sections,
    "若使用者已指定某個模型（例如「我要用 Veo 3」），保持使用者選擇，不要強制換成清單裡其他名字。",
  ].join("\n");
}
