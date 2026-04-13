/**
 * Unified type exports — AI Director 智慧創作平台
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

// ─── Generation Types ───────────────────────────────────────────────────────

export type GenerationMode = "lightning" | "deep_precision";

export type GenerationType = "image" | "video" | "audio" | "voice" | "multimodal";

// ─── Vibe Cards (Professional, realistic thumbnails) ────────────────────────

export type VibeCard = {
  id: string;
  label: string;
  labelZh: string;
  description: string;
  color: string;
  icon: string;
};

export const VIBE_CARDS: VibeCard[] = [
  { id: "serene", label: "Serene", labelZh: "寧靜", description: "平靜、柔和的氛圍", color: "#C8D5E0", icon: "cloud" },
  { id: "warm", label: "Warm", labelZh: "溫暖", description: "溫馨、舒適的感覺", color: "#EAC9C1", icon: "sun" },
  { id: "dreamy", label: "Dreamy", labelZh: "夢幻", description: "如夢似幻的意境", color: "#D4C5E2", icon: "moon" },
  { id: "nature", label: "Nature", labelZh: "自然", description: "大自然的安定力量", color: "#C5D5C0", icon: "leaf" },
  { id: "vintage", label: "Vintage", labelZh: "復古", description: "懷舊、經典的風格", color: "#D4C4A8", icon: "camera" },
  { id: "minimal", label: "Minimal", labelZh: "極簡", description: "簡約、純粹的美學", color: "#E8E4E0", icon: "square" },
  { id: "joyful", label: "Joyful", labelZh: "歡愉", description: "充滿活力與喜悅", color: "#F0D5A8", icon: "sparkles" },
  { id: "mystical", label: "Mystical", labelZh: "神秘", description: "神秘、深邃的氣息", color: "#A8B5C8", icon: "star" },
];

// ─── CO-STAR Script ─────────────────────────────────────────────────────────

export type CoStarScript = {
  context: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  visualPrompt: string;
  audioScript: string;
  musicVibe: string;
  proactiveQuestion?: string;
};

// ─── Director Session ───────────────────────────────────────────────────────

export type DirectorSession = {
  id: string;
  title: string;
  personality: "calm" | "creative" | "technical";
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  scripts: CoStarScript[];
  createdAt: string;
  updatedAt: string;
};

// ─── Director Templates ─────────────────────────────────────────────────────

export type DirectorTemplate = {
  id: string;
  label: string;
  description: string;
  category: "short-film" | "ad" | "meditation" | "music-video" | "tutorial" | "brand";
  prompt: string;
  personality: "calm" | "creative" | "technical";
};

// ─── Generation Request ─────────────────────────────────────────────────────

export type GenerationRequest = {
  prompt: string;
  generationType: GenerationType;
  mode: GenerationMode;
  vibeCardIds: string[];
  temperature: number;
  seed?: number;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  loraWeight?: number;
  characterProfileId?: number;
  videoDurationSeconds?: number;
  voiceModelId?: string;
  musicStyle?: string;
};

// ─── Job Progress ───────────────────────────────────────────────────────────

export type JobProgress = {
  jobId: number;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  resultUrl?: string;
  resultJson?: Record<string, unknown>;
};

// ─── Character Forge (Fine-Tuning) ──────────────────────────────────────────

export type CharacterForgeStep = "dataset" | "captioning" | "hyperparams" | "training";

export type DatasetImage = {
  url: string;
  angle: "front" | "side" | "back" | "expression" | "other";
  caption?: string;
};

// ─── Zen Co-Pilot Tooltip Definitions ───────────────────────────────────────

export const ZEN_TOOLTIPS: Record<string, { title: string; description: string }> = {
  temperature: {
    title: "創意溫度",
    description: "控制 AI 的創造力程度。數值越低，結果越精確穩定；數值越高，AI 越大膽創新。建議初次使用設定 0.5。",
  },
  seed: {
    title: "種子碼",
    description: "相同的種子碼會產生相似的結果，方便你微調同一個創作方向。留空則每次隨機生成。",
  },
  loraWeight: {
    title: "LoRA 權重",
    description: "控制微調角色特徵的套用強度。0.5 為自然融合，1.0 為完全套用角色特徵。",
  },
  mode: {
    title: "生成模式",
    description: "閃電模式使用 Gemini Flash，速度快但細節較少。深度精修模式使用 Gemini Pro + CO-STAR 框架，品質更高但需要更多時間。",
  },
  epochs: {
    title: "訓練輪數",
    description: "模型學習資料集的完整次數。更多輪數可提高品質，但過多可能導致過擬合。建議 10-30 輪。",
  },
  learningRate: {
    title: "學習率",
    description: "模型每次更新的步幅大小。較小的值學習更穩定但更慢，較大的值學習更快但可能不穩定。",
  },
  batchSize: {
    title: "批次大小",
    description: "每次訓練步驟處理的圖片數量。較大的批次需要更多記憶體，但訓練更穩定。",
  },
};

// ─── Morandi Zen Palette ────────────────────────────────────────────────────

export const ZEN_COLORS = {
  oat: "#F5F3F0",
  smoke: "#6C6C6C",
  warmGray: "#9A9590",
  blush: "#EAC9C1",
  sage: "#C5D5C0",
  dustyRose: "#D4A5A5",
  lavender: "#D4C5E2",
  skyMist: "#C8D5E0",
  sand: "#D4C4A8",
  peach: "#F0D5A8",
  frost: "rgba(255, 255, 255, 0.65)",
} as const;

// ─── Progress Messages (Professional) ───────────────────────────────────────

export const PROGRESS_MESSAGES: Record<string, string[]> = {
  image: [
    "編譯視覺提示詞...",
    "初始化影像生成引擎...",
    "渲染場景構圖...",
    "精修細節與光影...",
    "套用風格濾鏡...",
    "最終品質檢查...",
  ],
  video: [
    "分析場景連續性...",
    "生成關鍵影格...",
    "插值運動軌跡...",
    "合成影片序列...",
    "音視頻同步處理...",
  ],
  audio: [
    "解析音樂風格參數...",
    "生成旋律結構...",
    "編排和弦進行...",
    "混音與母帶處理...",
  ],
  voice: [
    "載入語音模型...",
    "分析語音韻律...",
    "合成語音波形...",
    "後處理降噪...",
  ],
};
