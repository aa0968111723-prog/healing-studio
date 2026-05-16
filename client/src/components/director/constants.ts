import {
  Brain,
  Palette,
  Wrench,
  Image,
  Camera,
  Music,
  Sparkles,
  Volume2,
  Mic,
  Headphones,
  Timer,
  Heart,
  Shuffle,
  Settings,
  Wand2,
  Sun,
  Zap,
  Eye,
  Pencil,
  CheckCircle2,
  Lightbulb,
  BookOpen,
  Film,
  ThermometerSun,
  CalendarDays,
} from "lucide-react";
import type { PlanningPhase } from "@shared/types";

export type DirectorGenTaskModality = "image" | "video" | "audio" | "voice" | "sfx";

// Local draft of the active planning session — persisted to localStorage on
// every edit so a page reload mid-edit doesn't lose work that hasn't yet been
// flushed to the 3s DB auto-save. Versioned so we can evolve the shape later.
export const PLANNING_DRAFT_KEY = "hs.director.planningDraft.v1";

export type Personality = "calm" | "creative" | "technical";

// ─── Personality Config ────────────────────────────────────────────────────

export const PERSONALITIES = [
  {
    id: "calm" as const,
    label: "沉穩型",
    icon: Brain,
    description: "重邏輯、結構與可行性分析",
    color: "from-slate-500 to-blue-600",
    bgActive: "bg-slate-50 ring-slate-400",
    textColor: "text-slate-700",
  },
  {
    id: "creative" as const,
    label: "創意型",
    icon: Palette,
    description: "重氛圍、情緒與視覺衝擊力",
    color: "from-purple-500 to-pink-500",
    bgActive: "bg-purple-50 ring-purple-400",
    textColor: "text-purple-700",
  },
  {
    id: "technical" as const,
    label: "技術型",
    icon: Wrench,
    description: "重參數精確度與技術最佳實踐",
    color: "from-emerald-500 to-teal-600",
    bgActive: "bg-emerald-50 ring-emerald-400",
    textColor: "text-emerald-700",
  },
];

// ─── Template Category Labels ──────────────────────────────────────────────

export const CATEGORY_LABELS: Record<string, string> = {
  "short-film": "短片",
  ad: "廣告",
  meditation: "冥想",
  "music-video": "MV",
  tutorial: "教學",
  brand: "品牌",
};

export const DIRECTOR_QUICK_GUIDE = [
  {
    id: "brief",
    title: "先說任務再說風格",
    tips: [
      "先描述用途、受眾、時長與平台（例如 Reels / YouTube）。",
      "再補風格與情緒（寫實、夢幻、懸疑、療癒等）。",
      "最後才加限制（預算、素材、交付時間）。",
    ],
  },
  {
    id: "pipeline",
    title: "分鏡與生成的推薦順序",
    tips: [
      "先用模板快速出分鏡，再逐段微調對白與鏡頭語言。",
      "先經濟模型確認節奏，再切高品質模型做定稿。",
      "卡住時可先做 1-2 段 POC，再擴展到全片。",
    ],
  },
] as const;

// ─── Quick Action Icon Map ──────────────────────────────────────────────────

export const QUICK_ACTION_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  image: Image,
  video: Camera,
  palette: Palette,
  sparkles: Sparkles,
  volume: Volume2,
  mic: Mic,
  headphones: Headphones,
  timer: Timer,
  heart: Heart,
  shuffle: Shuffle,
  settings: Settings,
  wand: Wand2,
  sun: Sun,
  zap: Zap,
  eye: Eye,
};

export const QUICK_ACTION_CATEGORY_LABELS: Record<
  string,
  { label: string; color: string }
> = {
  visual: { label: "視覺", color: "bg-blue-100 text-blue-700" },
  audio: { label: "音頻", color: "bg-purple-100 text-purple-700" },
  narrative: { label: "敘事", color: "bg-amber-100 text-amber-700" },
  technical: { label: "技術", color: "bg-emerald-100 text-emerald-700" },
  mood: { label: "氛圍", color: "bg-pink-100 text-pink-700" },
};

export const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    color: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  pending: { label: "待分析", color: "bg-gray-100 text-gray-600", icon: Timer },
  draft: {
    label: "草稿",
    color: "bg-yellow-100 text-yellow-700",
    icon: Pencil,
  },
  refined: { label: "已優化", color: "bg-blue-100 text-blue-700", icon: Eye },
  approved: {
    label: "已確認",
    color: "bg-green-100 text-green-700",
    icon: CheckCircle2,
  },
};

// ─── Planning Phase Config ──────────────────────────────────────────────────

export const PLANNING_PHASES: Array<{
  id: PlanningPhase;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  activeColor: string;
}> = [
  {
    id: "concept",
    label: "核心概念",
    description: "釐清主題、觀眾、核心情感與願景",
    icon: Lightbulb,
    color: "text-amber-500",
    activeColor: "bg-amber-50 ring-amber-300 text-amber-700",
  },
  {
    id: "outline",
    label: "故事大綱",
    description: "建構故事弧線、角色與轉折點",
    icon: BookOpen,
    color: "text-blue-500",
    activeColor: "bg-blue-50 ring-blue-300 text-blue-700",
  },
  {
    id: "scene-planning",
    label: "場景規劃",
    description: "逐場景設計細節、氛圍與情感目標",
    icon: Film,
    color: "text-purple-500",
    activeColor: "bg-purple-50 ring-purple-300 text-purple-700",
  },
  {
    id: "emotional-depth",
    label: "情感深度",
    description: "分析溫度、共鳴點、療癒元素",
    icon: ThermometerSun,
    color: "text-rose-500",
    activeColor: "bg-rose-50 ring-rose-300 text-rose-700",
  },
  {
    id: "schedule",
    label: "排程整合",
    description: "建立製作里程碑與時間規劃",
    icon: CalendarDays,
    color: "text-teal-500",
    activeColor: "bg-teal-50 ring-teal-300 text-teal-700",
  },
];

export const FORMAT_OPTIONS = [
  { value: "plaintext", label: "純文字" },
  { value: "screenplay", label: "劇本格式" },
  { value: "srt", label: "SRT 字幕" },
  { value: "fdx", label: "Final Draft (.fdx)" },
  { value: "novel", label: "小說/散文" },
  { value: "storyboard", label: "分鏡表" },
  { value: "custom", label: "自訂格式" },
];

export const EXPORT_FORMATS = [
  { value: "markdown", label: "Markdown", ext: ".md" },
  { value: "csv", label: "CSV 試算表", ext: ".csv" },
  { value: "json", label: "JSON", ext: ".json" },
  { value: "srt", label: "SRT 字幕", ext: ".srt" },
  { value: "fdx", label: "Final Draft", ext: ".fdx" },
  { value: "custom", label: "自訂模板", ext: ".txt" },
];

// ─── Generation Tier / Modality Badges ──────────────────────────────────────

export const TIER_COLORS: Record<string, string> = {
  free: "text-gray-500",
  economy: "text-green-600",
  standard: "text-blue-600",
  premium: "text-purple-600",
  ultra: "text-amber-600",
};

export const MODALITY_BADGES: Record<
  DirectorGenTaskModality,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  image: { label: "圖像", icon: Image, color: "bg-blue-100 text-blue-700" },
  video: { label: "影片", icon: Camera, color: "bg-purple-100 text-purple-700" },
  audio: { label: "音樂", icon: Music, color: "bg-amber-100 text-amber-700" },
  voice: { label: "語音", icon: Mic, color: "bg-emerald-100 text-emerald-700" },
  sfx: { label: "音效", icon: Volume2, color: "bg-pink-100 text-pink-700" },
};

// ─── Personality UI Hint (client-only placeholder for AIChatBox) ────────────
//
// The real LLM system prompts live server-side in
// server/services/director/personality.ts. These strings are only used as
// a chatBox placeholder display and never reach the LLM.
export const PERSONALITY_SYSTEM_PROMPTS: Record<Personality, string> = {
  calm: `你是「導演 AI」（沉穩型），一位注重邏輯、結構與可行性分析的多媒體創意導演。你使用 CO-STAR 框架來幫助使用者構思和規劃多媒體創作專案。請用繁體中文回覆，提供有條理、有依據的建議，著重可執行性與結構完整性。`,
  creative: `你是「導演 AI」（創意型），一位充滿熱情、重視氛圍與視覺衝擊力的多媒體創意導演。你使用 CO-STAR 框架來幫助使用者構思和規劃多媒體創作專案。請用繁體中文回覆，提供富有想像力、充滿情緒感染力的建議，著重視覺美感與情感共鳴。`,
  technical: `你是「導演 AI」（技術型），一位精通參數與技術最佳實踐的多媒體創意導演。你使用 CO-STAR 框架來幫助使用者構思和規劃多媒體創作專案。請用繁體中文回覆，提供精確、專業的技術建議，著重參數設定、工作流程與最佳化策略。`,
};
