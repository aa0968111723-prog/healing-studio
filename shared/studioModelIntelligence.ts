import { FAL_MODEL_CATALOG, type FalCategory } from "../server/services/falModels";

export interface StudioModelKnowledge {
  modelId: string;
  category: FalCategory;
  promptHints: string[];
}

const CATEGORY_HINTS: Record<FalCategory, string[]> = {
  "text-to-image": ["圖片", "圖像", "海報", "寫實", "插畫", "photo", "image", "poster", "portrait"],
  "image-to-image": ["修圖", "重繪", "去背", "風格遷移", "image to image", "edit"],
  "text-to-video": ["影片", "短片", "運鏡", "動畫", "video", "cinematic"],
  "text-to-audio": ["配樂", "背景音樂", "ambient", "music", "song", "audio"],
  "text-to-speech": ["配音", "旁白", "語音", "voice", "tts", "narration"],
  "training": ["lora", "訓練", "角色一致", "微調", "fine-tune"],
  "video-to-video": ["重製影片", "影片修復", "video to video", "restyle"],
  "video-to-audio": ["提取音訊", "extract audio"],
  "video-to-text": ["影片摘要", "字幕", "transcript"],
  "audio-to-text": ["語音轉文字", "逐字稿", "asr", "transcribe"],
  "image-to-3d": ["3d", "建模", "mesh", "glb", "立體"],
  "image-to-json": ["ocr", "解析圖片", "json"],
  "image-to-video": ["圖生影片", "image to video"],
  "json": ["結構化", "schema", "json output"],
  "llm": ["推理", "問答", "chat"],
  "text-to-3d": ["文字轉3d", "3d asset", "text to 3d"],
  "text-to-json": ["json", "抽取欄位", "structured"],
};

const FAL_MODELS = Object.values(FAL_MODEL_CATALOG).flat();

export const STUDIO_MODEL_KNOWLEDGE_REGISTRY: StudioModelKnowledge[] = FAL_MODELS.map(model => ({
  modelId: model.modelId,
  category: model.category,
  promptHints: CATEGORY_HINTS[model.category] ?? [],
}));

export function inferStudioModelCandidatesFromPrompt(prompt: string, limit = 8): StudioModelKnowledge[] {
  const normalized = prompt.toLowerCase();
  const scored = STUDIO_MODEL_KNOWLEDGE_REGISTRY.map(model => {
    const score = model.promptHints.reduce((acc, hint) => {
      return acc + (normalized.includes(hint.toLowerCase()) ? 1 : 0);
    }, 0);
    return { model, score };
  })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.model);

  if (scored.length > 0) return scored;

  return STUDIO_MODEL_KNOWLEDGE_REGISTRY.filter(model => model.category === "text-to-image").slice(0, limit);
}

export function summarizeStudioModelKnowledgeForAgent(limit = 40): string {
  const samples = STUDIO_MODEL_KNOWLEDGE_REGISTRY.slice(0, limit).map(item => ({
    modelId: item.modelId,
    category: item.category,
    promptHints: item.promptHints,
  }));
  return JSON.stringify({
    note: "創作工作室模型知識庫（供全站光球代理理解提示詞對應模型）",
    total: STUDIO_MODEL_KNOWLEDGE_REGISTRY.length,
    samples,
    instruction:
      "先判斷使用者提示詞的任務類型，再從同類 category 的 modelId 中挑選；若提示詞含 3D/配音/配樂/放大等關鍵詞，避免誤選 text-to-image。",
  });
}
