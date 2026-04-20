/**
 * Unified type exports — AI Director 智慧創作平台
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

// ─── Generation Types ───────────────────────────────────────────────────────

export type GenerationMode = "lightning" | "deep_precision";

export type GenerationType =
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "multimodal";

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
  {
    id: "serene",
    label: "Serene",
    labelZh: "寧靜",
    description: "平靜、柔和的氛圍",
    color: "#C8D5E0",
    icon: "cloud",
  },
  {
    id: "warm",
    label: "Warm",
    labelZh: "溫暖",
    description: "溫馨、舒適的感覺",
    color: "#EAC9C1",
    icon: "sun",
  },
  {
    id: "dreamy",
    label: "Dreamy",
    labelZh: "夢幻",
    description: "如夢似幻的意境",
    color: "#D4C5E2",
    icon: "moon",
  },
  {
    id: "nature",
    label: "Nature",
    labelZh: "自然",
    description: "大自然的安定力量",
    color: "#C5D5C0",
    icon: "leaf",
  },
  {
    id: "vintage",
    label: "Vintage",
    labelZh: "復古",
    description: "懷舊、經典的風格",
    color: "#D4C4A8",
    icon: "camera",
  },
  {
    id: "minimal",
    label: "Minimal",
    labelZh: "極簡",
    description: "簡約、純粹的美學",
    color: "#E8E4E0",
    icon: "square",
  },
  {
    id: "joyful",
    label: "Joyful",
    labelZh: "歡愉",
    description: "充滿活力與喜悅",
    color: "#F0D5A8",
    icon: "sparkles",
  },
  {
    id: "mystical",
    label: "Mystical",
    labelZh: "神秘",
    description: "神秘、深邃的氣息",
    color: "#A8B5C8",
    icon: "star",
  },
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

// ─── Script Segment (長腳本分鏡) ──────────────────────────────────────────────

export type ScriptSegment = {
  id: string;
  index: number;
  /** Raw text from the imported script for this segment */
  rawText: string;
  /** AI-generated storyboard breakdown */
  storyboard: {
    sceneHeading: string;
    visualDescription: string;
    dialogue: string;
    soundDesign: string;
    cameraDirection: string;
    duration: string;
    mood: string;
  };
  /** CO-STAR structured data for this segment */
  costar?: CoStarScript;
  /** Characters appearing in this segment (extracted during import or discussion) */
  characters?: string[];
  /** Locations referenced in this segment */
  locations?: string[];
  /** Free-form notes / annotations by the user or AI */
  notes?: string;
  /** Discussion messages for this segment */
  discussion: Array<{
    role: "user" | "assistant";
    content: string;
    /** Optional attached reference image URL */
    imageUrl?: string;
    /** Quick-action type that triggered this message */
    quickAction?: string;
    timestamp: string;
  }>;
  /** Current status */
  status: "pending" | "draft" | "refined" | "approved";
};

/** Holistic overview of an entire imported script */
export type ScriptOverview = {
  totalDuration: string;
  segmentCount: number;
  themes: string[];
  characters: Array<{ name: string; segmentIndices: number[] }>;
  locations: Array<{ name: string; segmentIndices: number[] }>;
  moodDistribution: Record<string, number>;
  pacingNotes: string;
  overallSuggestion: string;
};

export type QuickAction = {
  id: string;
  label: string;
  labelZh: string;
  icon: string;
  /** The prompt template sent to AI when user clicks this action */
  promptTemplate: string;
  /** Category for grouping */
  category: "visual" | "audio" | "narrative" | "technical" | "mood";
};

export type ScriptExportFormat =
  | "json"
  | "csv"
  | "markdown"
  | "fdx"
  | "srt"
  | "custom";

export type ScriptExportOptions = {
  format: ScriptExportFormat;
  /** Column mappings for custom spreadsheet format */
  customColumns?: Array<{
    header: string;
    field: string;
  }>;
  /** Include discussion history in export */
  includeDiscussion?: boolean;
  /** Include CO-STAR data in export */
  includeCostar?: boolean;
  /** Custom template string for free-form export */
  customTemplate?: string;
};

export type ImportedScript = {
  id: string;
  title: string;
  rawContent: string;
  sourceFormat: string;
  segments: ScriptSegment[];
  createdAt: string;
  updatedAt: string;
};

// ─── Director Templates ─────────────────────────────────────────────────────

export type DirectorTemplate = {
  id: string;
  label: string;
  description: string;
  category:
    | "short-film"
    | "ad"
    | "meditation"
    | "music-video"
    | "tutorial"
    | "brand";
  prompt: string;
  personality: "calm" | "creative" | "technical";
};

// ─── Long Script Planning Mode ──────────────────────────────────────────────

export type PlanningPhase =
  | "concept"
  | "outline"
  | "scene-planning"
  | "emotional-depth"
  | "schedule";

export type PlanningMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  /** Optional phase this message belongs to */
  phase?: PlanningPhase;
};

export type PlanningPhaseData = {
  phase: PlanningPhase;
  status: "not-started" | "in-progress" | "completed";
  /** AI-generated summary for this phase */
  summary?: string;
  /** Discussion thread for this phase */
  discussion: PlanningMessage[];
};

export type EmotionalBeat = {
  /** Which scene index this beat maps to (optional, for later linking) */
  sceneIndex?: number;
  label: string;
  emotion: string;
  intensity: number; // 1-10
  warmthNote: string;
};

export type ScenePlan = {
  id: string;
  title: string;
  description: string;
  mood: string;
  emotionalGoal: string;
  characters: string[];
  location: string;
  duration: string;
  notes: string;
};

export type ScriptPlanningSession = {
  id: string;
  title: string;
  personality: "calm" | "creative" | "technical";
  /** Core concept defined in phase 1 */
  concept?: {
    theme: string;
    targetAudience: string;
    coreEmotion: string;
    vision: string;
  };
  /** Story outline from phase 2 */
  outline?: {
    synopsis: string;
    emotionalArc: string;
    keyTurningPoints: string[];
    characters: Array<{ name: string; role: string; emotionalJourney: string }>;
  };
  /** Scene plans from phase 3 */
  scenes: ScenePlan[];
  /** Emotional depth analysis from phase 4 */
  emotionalBeats: EmotionalBeat[];
  warmthScore?: number; // 1-10 overall warmth rating
  depthAnalysis?: string;
  /** Scheduling milestones from phase 5 */
  milestones: Array<{
    id: string;
    title: string;
    targetDate?: string;
    phase: PlanningPhase;
    completed: boolean;
  }>;
  /** Per-phase data */
  phases: PlanningPhaseData[];
  createdAt: string;
  updatedAt: string;
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

// ─── Model Training Types ───────────────────────────────────────────────────

export type TrainingModelType =
  | "image_subject"
  | "voice_clone"
  | "style_lora"
  | "scene_lora"
  | "video_lora"
  | "portrait_lora";

export type TrainingEngine = "replicate" | "fal";

/** 訓練類別定義：UI 顯示資訊 + 預設引擎 + 資料需求 */
export type TrainingCategory = {
  type: TrainingModelType;
  label: string;
  labelZh: string;
  description: string;
  icon: string;
  defaultEngine: TrainingEngine;
  acceptsImages: boolean;
  acceptsVideos: boolean;
  minDatasetSize: number;
  maxDatasetSize: number;
};

export const TRAINING_CATEGORIES: TrainingCategory[] = [
  {
    type: "image_subject",
    label: "Character / Subject",
    labelZh: "角色 / 主體",
    description: "訓練特定角色或物件的外觀，可在生成時用觸發詞呼叫",
    icon: "user",
    defaultEngine: "replicate",
    acceptsImages: true,
    acceptsVideos: false,
    minDatasetSize: 3,
    maxDatasetSize: 30,
  },
  {
    type: "portrait_lora",
    label: "Portrait",
    labelZh: "人像專訓",
    description: "針對人像生成最佳化，專注於面部特徵與表情細節",
    icon: "smile",
    defaultEngine: "fal",
    acceptsImages: true,
    acceptsVideos: false,
    minDatasetSize: 5,
    maxDatasetSize: 30,
  },
  {
    type: "style_lora",
    label: "Style",
    labelZh: "風格微調",
    description: "學習特定藝術風格、色調或視覺語言，套用至任意主題",
    icon: "palette",
    defaultEngine: "fal",
    acceptsImages: true,
    acceptsVideos: false,
    minDatasetSize: 5,
    maxDatasetSize: 50,
  },
  {
    type: "scene_lora",
    label: "Scene / Environment",
    labelZh: "場景 / 環境",
    description: "訓練特定場景風格（如室內設計、自然景觀、建築）",
    icon: "mountain",
    defaultEngine: "fal",
    acceptsImages: true,
    acceptsVideos: false,
    minDatasetSize: 5,
    maxDatasetSize: 50,
  },
  {
    type: "video_lora",
    label: "Video LoRA",
    labelZh: "影片 LoRA",
    description: "訓練影片風格微調，可用於文字生成影片或影片轉換",
    icon: "film",
    defaultEngine: "fal",
    acceptsImages: true,
    acceptsVideos: true,
    minDatasetSize: 3,
    maxDatasetSize: 48,
  },
  {
    type: "voice_clone",
    label: "Voice Clone",
    labelZh: "語音複製",
    description: "複製特定人聲進行語音合成（即將推出）",
    icon: "mic",
    defaultEngine: "fal",
    acceptsImages: false,
    acceptsVideos: false,
    minDatasetSize: 1,
    maxDatasetSize: 10,
  },
];

/** 依 modelType 取得訓練類別設定 */
export function getTrainingCategory(
  type: TrainingModelType
): TrainingCategory | undefined {
  return TRAINING_CATEGORIES.find(c => c.type === type);
}

// ─── Character Forge (Fine-Tuning) ──────────────────────────────────────────

export type CharacterForgeStep =
  | "dataset"
  | "captioning"
  | "hyperparams"
  | "training";

export type DatasetImage = {
  url: string;
  angle: "front" | "side" | "back" | "expression" | "other";
  caption?: string;
};

export type DatasetVideo = {
  url: string;
  fileKey: string;
  caption?: string;
};

// ─── Zen Co-Pilot Tooltip Definitions ───────────────────────────────────────

export const ZEN_TOOLTIPS: Record<
  string,
  { title: string; description: string }
> = {
  temperature: {
    title: "創意溫度",
    description:
      "控制 AI 的創造力程度。數值越低，結果越精確穩定；數值越高，AI 越大膽創新。建議初次使用設定 0.5。",
  },
  seed: {
    title: "種子碼",
    description:
      "相同的種子碼會產生相似的結果，方便你微調同一個創作方向。留空則每次隨機生成。",
  },
  loraWeight: {
    title: "LoRA 權重",
    description:
      "控制微調角色特徵的套用強度。0.5 為自然融合，1.0 為完全套用角色特徵。",
  },
  mode: {
    title: "生成模式",
    description:
      "閃電模式使用 Gemini Flash，速度快但細節較少。深度精修模式使用 Gemini Pro + CO-STAR 框架，品質更高但需要更多時間。",
  },
  epochs: {
    title: "訓練輪數",
    description:
      "模型學習資料集的完整次數。更多輪數可提高品質，但過多可能導致過擬合。建議 10-30 輪。",
  },
  learningRate: {
    title: "學習率",
    description:
      "模型每次更新的步幅大小。較小的值學習更穩定但更慢，較大的值學習更快但可能不穩定。",
  },
  batchSize: {
    title: "批次大小",
    description:
      "每次訓練步驟處理的圖片數量。較大的批次需要更多記憶體，但訓練更穩定。",
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
