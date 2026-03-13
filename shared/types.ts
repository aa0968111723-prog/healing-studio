/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

// ─── Healing Studio Application Types ────────────────────────────────────────

export type GenerationMode = "lightning" | "deep_precision";

export type GenerationType = "image" | "video" | "audio" | "voice" | "multimodal";

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
  { id: "nature", label: "Nature", labelZh: "自然", description: "大自然的療癒力量", color: "#C5D5C0", icon: "leaf" },
  { id: "vintage", label: "Vintage", labelZh: "復古", description: "懷舊、經典的風格", color: "#D4C4A8", icon: "camera" },
  { id: "minimal", label: "Minimal", labelZh: "極簡", description: "簡約、純粹的美學", color: "#E8E4E0", icon: "square" },
  { id: "joyful", label: "Joyful", labelZh: "歡愉", description: "充滿活力與喜悅", color: "#F0D5A8", icon: "sparkles" },
  { id: "mystical", label: "Mystical", labelZh: "神秘", description: "神秘、深邃的氣息", color: "#A8B5C8", icon: "star" },
];

export type MascotState = "idle" | "hover" | "loading";

export type CoStarScript = {
  context: string;
  situation: string;
  task: string;
  action: string;
  result: string;
  visualPrompt: string;
  audioScript: string;
  musicVibe: string;
};

export type GenerationRequest = {
  prompt: string;
  generationType: GenerationType;
  mode: GenerationMode;
  vibeCardIds: string[];
  temperature: number;
  seed?: number;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  videoDurationSeconds?: number;
  voiceModelId?: string;
  musicStyle?: string;
};

export type JobProgress = {
  jobId: number;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  resultUrl?: string;
  resultJson?: Record<string, unknown>;
};

export const MORANDI_COLORS = {
  cream: "#FFF8F0",
  warmGray: "#6C6C6C",
  blush: "#EAC9C1",
  sage: "#C5D5C0",
  dustyRose: "#D4A5A5",
  lavender: "#D4C5E2",
  skyMist: "#C8D5E0",
  sand: "#D4C4A8",
  peach: "#F0D5A8",
  softGray: "#E8E4E0",
} as const;

export const MASCOT_DIALOGUES = {
  idle: [
    "嗨！我是小熊，你的 AI 創作夥伴",
    "AI 模型就像一位畫家，你的提示詞就是它的靈感來源",
    "試試選擇一張氛圍卡片，讓 AI 更了解你想要的感覺",
    "溫度滑桿越高，AI 就越有冒險精神哦",
    "種子碼就像平行宇宙的密碼，相同的種子會產生相似的結果",
  ],
  hover: [
    "這個選項很不錯呢！",
    "讓我來幫你解釋一下...",
    "點擊這裡可以開始創作",
  ],
  loading: [
    "正在為你創作中，請稍等...",
    "AI 正在施展魔法...",
    "快好了，再等一下下...",
    "正在精心調整每一個細節...",
  ],
} as const;
