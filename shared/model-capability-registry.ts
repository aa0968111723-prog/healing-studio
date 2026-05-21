export type ModelModality = "image" | "video" | "voice" | "music" | "sound" | "llm";

export type ModelProvider = "internal" | "fal" | "replicate" | "openai" | "elevenlabs" | "suno" | "custom";

export type ModelTaskKind =
  | "character_image"
  | "scene_image"
  | "shot_image"
  | "shot_video"
  | "voice"
  | "music"
  | "sound"
  | "publishing_copy"
  | "script_analysis"
  | "prompt_refine";

export type ModelCapability = {
  id: string;
  label: string;
  provider: ModelProvider;
  modality: ModelModality;
  taskKinds: ModelTaskKind[];
  input: Array<"text" | "image" | "audio" | "video" | "json">;
  output: Array<"image" | "audio" | "video" | "text" | "json">;
  costLevel: "low" | "medium" | "high";
  latencyLevel: "fast" | "medium" | "slow";
  qualityLevel: "draft" | "standard" | "premium";
  recommendedFor: string[];
  routeHint?: string;
  envKeys?: string[];
  enabledByDefault: boolean;
};

export const MODEL_CAPABILITY_REGISTRY: ModelCapability[] = [
  { id: "internal-image-draft", label: "Internal Image Draft", provider: "internal", modality: "image", taskKinds: ["character_image", "scene_image", "shot_image"], input: ["text", "json"], output: ["image", "json"], costLevel: "medium", latencyLevel: "medium", qualityLevel: "standard", recommendedFor: ["worldbuilding draft visuals"], routeHint: "/image-studio", enabledByDefault: true },
  { id: "internal-video-shot", label: "Internal Shot Video", provider: "internal", modality: "video", taskKinds: ["shot_video"], input: ["text", "image", "json"], output: ["video", "json"], costLevel: "high", latencyLevel: "slow", qualityLevel: "standard", recommendedFor: ["shot video preview"], routeHint: "/video-studio", enabledByDefault: true },
  { id: "internal-voice-tts", label: "Internal Voice TTS", provider: "internal", modality: "voice", taskKinds: ["voice"], input: ["text", "json"], output: ["audio", "json"], costLevel: "medium", latencyLevel: "fast", qualityLevel: "standard", recommendedFor: ["dialogue narration"], routeHint: "/pro-studio", enabledByDefault: true },
  { id: "internal-music-gen", label: "Internal Music Gen", provider: "internal", modality: "music", taskKinds: ["music", "sound"], input: ["text", "json"], output: ["audio", "json"], costLevel: "high", latencyLevel: "slow", qualityLevel: "standard", recommendedFor: ["background music", "sfx draft"], routeHint: "/pro-studio", enabledByDefault: true },
  { id: "internal-llm-copy", label: "Internal Copy LLM", provider: "internal", modality: "llm", taskKinds: ["publishing_copy", "script_analysis", "prompt_refine"], input: ["text", "json"], output: ["text", "json"], costLevel: "low", latencyLevel: "fast", qualityLevel: "standard", recommendedFor: ["publishing text"], routeHint: "/director", enabledByDefault: true },
];

export function getModelsForTask(kind: ModelTaskKind): ModelCapability[] {
  return MODEL_CAPABILITY_REGISTRY.filter(m => m.taskKinds.includes(kind));
}

export function pickDefaultModelForTask(kind: ModelTaskKind): ModelCapability | null {
  const models = getModelsForTask(kind);
  return models.find(m => m.enabledByDefault) ?? models[0] ?? null;
}

export function validateModelCanRunTask(modelId: string, kind: ModelTaskKind): { ok: boolean; reason?: string } {
  const model = MODEL_CAPABILITY_REGISTRY.find(m => m.id === modelId);
  if (!model) return { ok: false, reason: `model_not_found:${modelId}` };
  if (!model.taskKinds.includes(kind)) return { ok: false, reason: `model_task_mismatch:${modelId}:${kind}` };
  return { ok: true };
}
