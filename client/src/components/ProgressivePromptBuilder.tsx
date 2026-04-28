import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import { useIsMobile } from "@/hooks/useMobile";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  Sparkles,
  Lightbulb,
  Blocks,
  Focus,
  X,
  Plus,
  Heart,
  Trash2,
  FolderOpen,
  Save,
  Edit3,
  Check,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { VIBE_CARDS } from "@shared/types";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ─── Vibe Card Icons ───────────────────────────────────────────────────────

const vibeIcons: Record<string, React.ReactNode> = {
  serene: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="w-5 h-5"
    >
      <path d="M3 15c2.483 0 4.345-3 6-3s3.517 3 6 3 4.345-3 6-3" />
      <path d="M3 9c2.483 0 4.345-3 6-3s3.517 3 6 3 4.345-3 6-3" />
    </svg>
  ),
  warm: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="w-5 h-5"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ),
  dreamy: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="w-5 h-5"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  nature: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="w-5 h-5"
    >
      <path d="M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 17 3.5 17 3.5s1.5 2 2.8 5.5A7 7 0 0 1 11 20z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 12 13" />
    </svg>
  ),
  vintage: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="w-5 h-5"
    >
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <circle cx="18" cy="8" r="1" />
    </svg>
  ),
  minimal: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="w-5 h-5"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  ),
  joyful: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="w-5 h-5"
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  ),
  mystical: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="w-5 h-5"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
};

// ─── Visual Blocks Data ────────────────────────────────────────────────────

type BlockCategory = {
  id: string;
  label: string;
  icon: string;
  color: string;
  glowRgb: string;
  items: { id: string; label: string; prompt: string }[];
};

// ═══════════════════════════════════════════════════════════════════════════
// 🖼️ IMAGE_BLOCK_CATEGORIES — SSLCM 公式
// Subject → Style → Lighting → Color → Composition (Mood)
// ═══════════════════════════════════════════════════════════════════════════

const IMAGE_BLOCK_CATEGORIES: BlockCategory[] = [
  {
    id: "img-subject",
    label: "主體 Subject",
    icon: "👤",
    color: "rose",
    glowRgb: "255,100,130",
    items: [
      { id: "is1", label: "少女", prompt: "a young girl" },
      { id: "is2", label: "武士", prompt: "a samurai warrior" },
      { id: "is3", label: "貓咪", prompt: "a cat" },
      { id: "is4", label: "機器人", prompt: "a humanoid robot" },
      { id: "is5", label: "龍", prompt: "a majestic dragon" },
      { id: "is6", label: "精靈", prompt: "an ethereal elf" },
      { id: "is7", label: "老者", prompt: "an elderly sage" },
      { id: "is8", label: "花朵", prompt: "blooming flowers" },
    ],
  },
  {
    id: "img-style",
    label: "風格 Style",
    icon: "🎨",
    color: "violet",
    glowRgb: "160,100,255",
    items: [
      { id: "ist1", label: "賽博龐克", prompt: "cyberpunk style" },
      { id: "ist2", label: "水彩畫", prompt: "watercolor painting" },
      {
        id: "ist3",
        label: "油畫",
        prompt: "oil painting, impasto brushstrokes",
      },
      { id: "ist4", label: "浮世繪", prompt: "ukiyo-e woodblock print" },
      { id: "ist5", label: "像素藝術", prompt: "pixel art, 16-bit" },
      { id: "ist6", label: "超現實", prompt: "surrealism, dreamlike" },
      { id: "ist7", label: "極簡主義", prompt: "minimalist, clean lines" },
      { id: "ist8", label: "蒸汽龐克", prompt: "steampunk, brass and gears" },
    ],
  },
  {
    id: "img-lighting",
    label: "光影 Lighting",
    icon: "💡",
    color: "sky",
    glowRgb: "80,200,255",
    items: [
      { id: "il1", label: "黃金時刻", prompt: "golden hour lighting" },
      { id: "il2", label: "霓虹燈", prompt: "neon lighting, cyberpunk glow" },
      { id: "il3", label: "月光", prompt: "soft moonlight" },
      { id: "il4", label: "逆光", prompt: "backlit, rim lighting" },
      { id: "il5", label: "柔光", prompt: "soft diffused light" },
      {
        id: "il6",
        label: "戲劇光",
        prompt: "dramatic chiaroscuro, Rembrandt lighting",
      },
      { id: "il7", label: "燭光", prompt: "warm candlelight" },
      { id: "il8", label: "極光", prompt: "aurora borealis light" },
    ],
  },
  {
    id: "img-color",
    label: "色彩 Color",
    icon: "🌈",
    color: "amber",
    glowRgb: "255,180,50",
    items: [
      {
        id: "ic1",
        label: "暖色調",
        prompt: "warm color palette, amber and gold tones",
      },
      {
        id: "ic2",
        label: "冷色調",
        prompt: "cool color palette, blue and teal tones",
      },
      { id: "ic3", label: "單色", prompt: "monochromatic, single hue" },
      { id: "ic4", label: "高飽和", prompt: "vibrant saturated colors" },
      { id: "ic5", label: "低飽和", prompt: "desaturated, muted tones" },
      {
        id: "ic6",
        label: "復古色",
        prompt: "vintage color grading, faded film look",
      },
    ],
  },
  {
    id: "img-composition",
    label: "構圖 Composition",
    icon: "📐",
    color: "orange",
    glowRgb: "255,140,50",
    items: [
      { id: "ico1", label: "特寫", prompt: "close-up shot" },
      { id: "ico2", label: "全景", prompt: "wide angle panoramic" },
      { id: "ico3", label: "俯瞰", prompt: "bird's eye view" },
      { id: "ico4", label: "仰拍", prompt: "low angle shot" },
      { id: "ico5", label: "微距", prompt: "macro photography" },
      { id: "ico6", label: "淺景深", prompt: "shallow depth of field, bokeh" },
      { id: "ico7", label: "對稱構圖", prompt: "symmetrical composition" },
      { id: "ico8", label: "三分法", prompt: "rule of thirds composition" },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 🎬 VIDEO_BLOCK_CATEGORIES
// Subject → Style → Subject Motion → Camera Motion → Pacing
// ═══════════════════════════════════════════════════════════════════════════

const VIDEO_BLOCK_CATEGORIES: BlockCategory[] = [
  {
    id: "vid-subject",
    label: "主體 Subject",
    icon: "🎭",
    color: "rose",
    glowRgb: "255,100,130",
    items: [
      { id: "vs1", label: "少女", prompt: "a young girl" },
      { id: "vs2", label: "武士", prompt: "a samurai warrior" },
      { id: "vs3", label: "貓咪", prompt: "a cat" },
      { id: "vs4", label: "機器人", prompt: "a humanoid robot" },
      { id: "vs5", label: "龍", prompt: "a majestic dragon" },
      { id: "vs6", label: "舞者", prompt: "a graceful dancer" },
    ],
  },
  {
    id: "vid-style",
    label: "風格 Style",
    icon: "🎨",
    color: "violet",
    glowRgb: "160,100,255",
    items: [
      { id: "vst1", label: "電影感", prompt: "cinematic, film grain" },
      { id: "vst2", label: "動畫", prompt: "3D animation style" },
      { id: "vst3", label: "紀錄片", prompt: "documentary style, handheld" },
      { id: "vst4", label: "夢境", prompt: "dreamlike, ethereal" },
      { id: "vst5", label: "復古膠片", prompt: "vintage film, Super 8mm" },
      { id: "vst6", label: "科幻", prompt: "sci-fi futuristic" },
    ],
  },
  {
    id: "vid-motion",
    label: "主體動態 Motion",
    icon: "🏃",
    color: "emerald",
    glowRgb: "80,220,150",
    items: [
      { id: "vm1", label: "緩步行走", prompt: "walking slowly" },
      { id: "vm2", label: "奔跑", prompt: "running forward" },
      { id: "vm3", label: "旋轉", prompt: "spinning gracefully" },
      { id: "vm4", label: "飛翔", prompt: "flying through the air" },
      { id: "vm5", label: "靜止凝視", prompt: "standing still, gazing" },
      { id: "vm6", label: "漂浮", prompt: "floating weightlessly" },
    ],
  },
  {
    id: "vid-camera",
    label: "運鏡 Camera",
    icon: "🎥",
    color: "sky",
    glowRgb: "80,200,255",
    items: [
      { id: "vc1", label: "推軌", prompt: "dolly forward" },
      { id: "vc2", label: "環繞", prompt: "orbiting around subject" },
      { id: "vc3", label: "升降", prompt: "crane shot, rising up" },
      { id: "vc4", label: "手持跟拍", prompt: "handheld tracking shot" },
      { id: "vc5", label: "固定鏡頭", prompt: "static locked-off shot" },
      { id: "vc6", label: "慢動作", prompt: "slow motion, 120fps" },
    ],
  },
  {
    id: "vid-pacing",
    label: "節奏 Pacing",
    icon: "⏱️",
    color: "amber",
    glowRgb: "255,180,50",
    items: [
      { id: "vp1", label: "緩慢沉浸", prompt: "slow pacing, contemplative" },
      { id: "vp2", label: "中等節奏", prompt: "moderate pacing" },
      { id: "vp3", label: "快速剪輯", prompt: "fast cuts, dynamic editing" },
      { id: "vp4", label: "漸進加速", prompt: "gradually accelerating pace" },
      { id: "vp5", label: "時間凝結", prompt: "time freeze, bullet time" },
      { id: "vp6", label: "延時攝影", prompt: "timelapse" },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 🎵 AUDIO_BLOCK_CATEGORIES — GMIT 公式
// Genre → Mood → Instrument → Tempo
// ═══════════════════════════════════════════════════════════════════════════

const AUDIO_BLOCK_CATEGORIES: BlockCategory[] = [
  {
    id: "aud-genre",
    label: "曲風 Genre",
    icon: "🎵",
    color: "rose",
    glowRgb: "255,100,130",
    items: [
      { id: "ag1", label: "環境音", prompt: "ambient music" },
      { id: "ag2", label: "Lo-Fi", prompt: "lo-fi chill beats" },
      { id: "ag3", label: "流行", prompt: "pop music" },
      { id: "ag4", label: "爵士", prompt: "jazz" },
      { id: "ag5", label: "古典", prompt: "classical music" },
      { id: "ag6", label: "電子", prompt: "electronic, EDM" },
      { id: "ag7", label: "民謠", prompt: "folk, acoustic" },
      { id: "ag8", label: "R&B", prompt: "R&B soul" },
    ],
  },
  {
    id: "aud-mood",
    label: "情緒 Mood",
    icon: "💫",
    color: "violet",
    glowRgb: "160,100,255",
    items: [
      { id: "am1", label: "療癒", prompt: "healing, soothing" },
      { id: "am2", label: "歡快", prompt: "happy, uplifting" },
      { id: "am3", label: "憂鬱", prompt: "melancholic, bittersweet" },
      { id: "am4", label: "史詩", prompt: "epic, grandiose" },
      { id: "am5", label: "神秘", prompt: "mysterious, enigmatic" },
      { id: "am6", label: "浪漫", prompt: "romantic, tender" },
    ],
  },
  {
    id: "aud-instrument",
    label: "樂器 Instrument",
    icon: "🎹",
    color: "emerald",
    glowRgb: "80,220,150",
    items: [
      { id: "ai1", label: "鋼琴", prompt: "piano" },
      { id: "ai2", label: "吉他", prompt: "acoustic guitar" },
      { id: "ai3", label: "合成器", prompt: "synthesizer, synth pads" },
      { id: "ai4", label: "管弦樂", prompt: "orchestral ensemble" },
      { id: "ai5", label: "小提琴", prompt: "violin" },
      { id: "ai6", label: "長笛", prompt: "flute" },
      { id: "ai7", label: "鼓組", prompt: "drums and percussion" },
      { id: "ai8", label: "豎琴", prompt: "harp" },
    ],
  },
  {
    id: "aud-tempo",
    label: "速度 Tempo",
    icon: "⏱️",
    color: "amber",
    glowRgb: "255,180,50",
    items: [
      { id: "at1", label: "慢板 60bpm", prompt: "slow tempo, 60 bpm, adagio" },
      {
        id: "at2",
        label: "行板 90bpm",
        prompt: "moderate tempo, 90 bpm, andante",
      },
      {
        id: "at3",
        label: "快板 130bpm",
        prompt: "fast tempo, 130 bpm, allegro",
      },
      { id: "at4", label: "急板 160bpm", prompt: "very fast, 160 bpm, presto" },
      { id: "at5", label: "自由節奏", prompt: "free tempo, rubato" },
      { id: "at6", label: "搖擺", prompt: "swing rhythm, syncopated" },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// 🎙️ VOICE_BLOCK_CATEGORIES
// Emotion → Speed & Tone → Structure
// ═══════════════════════════════════════════════════════════════════════════

const VOICE_BLOCK_CATEGORIES: BlockCategory[] = [
  {
    id: "vox-emotion",
    label: "情感 Emotion",
    icon: "🎭",
    color: "rose",
    glowRgb: "255,100,130",
    items: [
      { id: "ve1", label: "溫柔", prompt: "gentle, warm tone" },
      { id: "ve2", label: "激昂", prompt: "passionate, energetic" },
      { id: "ve3", label: "沉穩", prompt: "calm, steady" },
      { id: "ve4", label: "哀傷", prompt: "sorrowful, melancholic" },
      { id: "ve5", label: "歡樂", prompt: "joyful, cheerful" },
      { id: "ve6", label: "神秘", prompt: "mysterious, whispering" },
    ],
  },
  {
    id: "vox-speed",
    label: "調性語速 Speed & Tone",
    icon: "🔊",
    color: "sky",
    glowRgb: "80,200,255",
    items: [
      { id: "vsp1", label: "緩慢低沉", prompt: "slow pace, deep voice" },
      {
        id: "vsp2",
        label: "中速清晰",
        prompt: "moderate pace, clear articulation",
      },
      { id: "vsp3", label: "快速活潑", prompt: "fast pace, lively" },
      {
        id: "vsp4",
        label: "抑揚頓挫",
        prompt: "varied cadence, expressive intonation",
      },
      { id: "vsp5", label: "輕聲細語", prompt: "soft whisper, ASMR-like" },
      { id: "vsp6", label: "高亢宏亮", prompt: "loud, projecting voice" },
    ],
  },
  {
    id: "vox-structure",
    label: "結構段落 Structure",
    icon: "📝",
    color: "violet",
    glowRgb: "160,100,255",
    items: [
      { id: "vstr1", label: "旁白獨白", prompt: "narration, monologue" },
      { id: "vstr2", label: "對話", prompt: "dialogue, conversational" },
      { id: "vstr3", label: "詩歌朗誦", prompt: "poetry recitation" },
      { id: "vstr4", label: "新聞播報", prompt: "news anchor, broadcast" },
      { id: "vstr5", label: "故事講述", prompt: "storytelling, narrative" },
      {
        id: "vstr6",
        label: "冥想引導",
        prompt: "meditation guide, breathing cues",
      },
    ],
  },
];

// ─── Helper: get blocks by modality ───────────────────────────────────────

function getBlocksForModality(modality?: string): BlockCategory[] {
  switch (modality) {
    case "image":
      return IMAGE_BLOCK_CATEGORIES;
    case "video":
      return VIDEO_BLOCK_CATEGORIES;
    case "audio":
      return AUDIO_BLOCK_CATEGORIES;
    case "voice":
      return VOICE_BLOCK_CATEGORIES;
    default:
      return IMAGE_BLOCK_CATEGORIES;
  }
}

// ─── All built-in block IDs for lookup ────────────────────────────────────

const ALL_BUILTIN_BLOCKS = [
  ...IMAGE_BLOCK_CATEGORIES,
  ...VIDEO_BLOCK_CATEGORIES,
  ...AUDIO_BLOCK_CATEGORIES,
  ...VOICE_BLOCK_CATEGORIES,
];

function findBuiltinBlock(blockId: string) {
  for (const cat of ALL_BUILTIN_BLOCKS) {
    const item = cat.items.find(i => i.id === blockId);
    if (item) return { item, category: cat };
  }
  return null;
}

// ─── Token Weight Types ────────────────────────────────────────────────────

export type TokenWeight = {
  id: string;
  text: string;
  weight: number;
  category?: string;
};

// ─── Token Parser ──────────────────────────────────────────────────────────

function parseTokens(text: string): TokenWeight[] {
  if (!text.trim()) return [];
  const weightedPattern = /\(([^:]+):\s*([\d.]+)\)/g;
  const existingWeights: Record<string, number> = {};
  let match;
  while ((match = weightedPattern.exec(text)) !== null) {
    existingWeights[match[1].trim()] = parseFloat(match[2]);
  }
  const cleanText = text.replace(/\(([^:]+):\s*[\d.]+\)/g, "$1");
  const tokenPattern =
    /[\u4e00-\u9fff\u3400-\u4dbf]+|[a-zA-Z]+(?:\s+[a-zA-Z]+){0,2}/g;
  const rawTokens = cleanText.match(tokenPattern) || [];
  const seen = new Set<string>();
  return rawTokens
    .filter(t => t.trim().length > 1)
    .filter(t => {
      const key = t.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((t, i) => ({
      id: `token-${i}`,
      text: t.trim(),
      weight: existingWeights[t.trim()] || 1.0,
    }));
}

function compileWithWeights(
  tokens: TokenWeight[],
  vibes: string[],
  rawPrompt: string
): string {
  if (tokens.length === 0) return rawPrompt;
  const weightedParts = tokens.map(t => {
    if (Math.abs(t.weight - 1.0) < 0.05) return t.text;
    return `(${t.text}: ${t.weight.toFixed(1)})`;
  });
  const vibeLabels = vibes
    .map(id => VIBE_CARDS.find(v => v.id === id)?.label)
    .filter(Boolean);
  const parts = [...weightedParts];
  if (vibeLabels.length > 0) {
    parts.push(`Style: ${vibeLabels.join(", ")}`);
  }
  return parts.join(", ").trim();
}

// ─── Advanced Prompt Fields ────────────────────────────────────────────────

type AdvancedFields = {
  subject: string;
  action: string;
  environment: string;
  lighting: string;
  cameraAngle: string;
};

const ADVANCED_FIELD_CONFIG = [
  {
    key: "subject" as const,
    label: "主體",
    placeholder: "描述主要角色或物件",
    icon: "👤",
  },
  {
    key: "action" as const,
    label: "動作",
    placeholder: "角色正在做什麼",
    icon: "🎬",
  },
  {
    key: "environment" as const,
    label: "環境",
    placeholder: "場景與背景",
    icon: "🌍",
  },
  {
    key: "lighting" as const,
    label: "光線",
    placeholder: "光線風格",
    icon: "💡",
  },
  {
    key: "cameraAngle" as const,
    label: "鏡頭角度",
    placeholder: "拍攝角度",
    icon: "📐",
  },
];

// ─── Types ─────────────────────────────────────────────────────────────────

export type PromptBuilderOutput = {
  rawPrompt: string;
  vibeCardIds: string[];
  advancedFields: AdvancedFields;
  compiledPrompt: string;
  tokenWeights?: TokenWeight[];
};

type ProgressivePromptBuilderProps = {
  value: PromptBuilderOutput;
  onChange: (output: PromptBuilderOutput) => void;
  modality?: string;
  /** When true, show enlarged vibe cards and hide blocks/advanced sections */
  simpleMode?: boolean;
};

// ─── Self-Attention Token Chip ─────────────────────────────────────────────

function TokenChip({
  token,
  isSelected,
  onSelect,
  onWeightChange,
}: {
  token: TokenWeight;
  isSelected: boolean;
  onSelect: () => void;
  onWeightChange: (w: number) => void;
}) {
  const getTokenStyle = () => {
    if (token.weight > 1.2) {
      return {
        background: `rgba(255, 160, 50, ${0.15 + (token.weight - 1.0) * 0.15})`,
        border: `1.5px solid rgba(255, 160, 50, ${0.5 + (token.weight - 1.0) * 0.3})`,
        boxShadow: `0 0 ${8 + (token.weight - 1.0) * 12}px rgba(255, 160, 50, ${0.2 + (token.weight - 1.0) * 0.2})`,
        color: "rgb(255, 180, 80)",
      };
    }
    if (token.weight < 0.8) {
      return {
        background: "rgba(150, 150, 170, 0.08)",
        border: "1.5px solid rgba(150, 150, 170, 0.2)",
        boxShadow: "none",
        color: "rgba(150, 150, 170, 0.5)",
        opacity: 0.5 + token.weight * 0.5,
      };
    }
    return {
      background: "rgba(255, 255, 255, 0.08)",
      border: "1.5px solid rgba(255, 255, 255, 0.2)",
      boxShadow: "none",
      color: "inherit",
    };
  };

  return (
    <div className="relative">
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={onSelect}
        className={cn(
          "px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer select-none",
          "backdrop-blur-sm",
          isSelected && "ring-2 ring-primary/60"
        )}
        style={getTokenStyle()}
      >
        <span>{token.text}</span>
        {Math.abs(token.weight - 1.0) >= 0.05 && (
          <span className="ml-1 text-[10px] opacity-70">
            {token.weight.toFixed(1)}
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {isSelected && (
          <motion.div
            initial={{ opacity: 0, y: -5, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 top-full mt-2 left-1/2 -translate-x-1/2 w-56 p-3 rounded-xl shadow-xl"
            style={{
              background: "rgba(30, 30, 40, 0.92)",
              backdropFilter: "blur(20px)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-white/80">
                注意力權重
              </span>
              <span className="text-[11px] font-mono text-amber-400">
                {token.weight.toFixed(2)}
              </span>
            </div>
            <Slider
              value={[token.weight]}
              min={0.5}
              max={2.0}
              step={0.05}
              onValueChange={([v]) => onWeightChange(v)}
              className="w-full"
            />
            <div className="flex justify-between mt-1.5 text-[9px] text-white/40">
              <span>淡化 0.5</span>
              <span>標準 1.0</span>
              <span>強調 2.0</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Visual Block Chip ─────────────────────────────────────────────────────

function BlockChip({
  item,
  category,
  isSelected,
  onToggle,
  onDelete,
  isCustom,
}: {
  item: { id: string; label: string; prompt: string };
  category: BlockCategory;
  isSelected: boolean;
  onToggle: () => void;
  onDelete?: () => void;
  isCustom?: boolean;
}) {
  const isMobile = useIsMobile();
  return (
    <motion.div className="relative group">
      <motion.button
        whileTap={{ scale: 0.93 }}
        onClick={onToggle}
        className={cn(
          "px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all",
          "backdrop-blur-sm border",
          isSelected
            ? `ring-2 ring-${category.color}-400/50 border-${category.color}-400/40`
            : "border-white/10 hover:border-white/20",
          isCustom && "pr-6"
        )}
        style={{
          background: isSelected
            ? `rgba(${category.glowRgb}, 0.15)`
            : "rgba(255, 255, 255, 0.04)",
          boxShadow: isSelected
            ? `0 0 12px rgba(${category.glowRgb}, 0.2)`
            : "none",
          color: isSelected ? `rgb(${category.glowRgb})` : "inherit",
        }}
      >
        {isCustom && <span className="mr-0.5 opacity-60">*</span>}
        {item.label}
        {isSelected && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="ml-1 inline-block"
          >
            <X className="w-3 h-3 inline" />
          </motion.span>
        )}
      </motion.button>
      {isCustom && onDelete && (
        <button
          onClick={e => {
            e.stopPropagation();
            onDelete();
          }}
          className={`absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive/80 text-destructive-foreground flex items-center justify-center transition-opacity ${isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </motion.div>
  );
}

// ─── Create Custom Block Dialog ───────────────────────────────────────────

function CreateBlockDialog({
  open,
  onOpenChange,
  modality,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modality: string;
  categories: BlockCategory[];
}) {
  const [label, setLabel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState(categories[0]?.id || "");
  const utils = trpc.useUtils();

  const createMutation = trpc.customBlocks.create.useMutation({
    onSuccess: () => {
      toast.success("自訂積木已建立");
      utils.customBlocks.list.invalidate();
      setLabel("");
      setPrompt("");
      onOpenChange(false);
    },
    onError: err => {
      toast.error("建立失敗：" + err.message);
    },
  });

  const handleSubmit = () => {
    if (!label.trim() || !prompt.trim()) {
      toast.error("請填寫標籤和提示詞");
      return;
    }
    createMutation.mutate({
      modality: modality as "image" | "video" | "audio" | "voice",
      category,
      label: label.trim(),
      prompt: prompt.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        style={{
          background: "rgba(255,255,255,0.95)",
          backdropFilter: "blur(20px)",
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" />
            建立自訂積木
          </DialogTitle>
          <DialogDescription>
            建立專屬的靈感積木，加速你的創作流程
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">所屬類別</Label>
            <div className="flex flex-wrap gap-1.5">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setCategory(cat.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                    category === cat.id
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/50 hover:border-border text-muted-foreground"
                  )}
                >
                  {cat.icon} {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">積木標籤</Label>
            <Input
              placeholder="例如：夕陽海灘"
              value={label}
              onChange={e => setLabel(e.target.value)}
              maxLength={128}
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">英文提示詞</Label>
            <Textarea
              placeholder="例如：sunset on a tropical beach with palm trees"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              maxLength={512}
              rows={2}
              className="text-sm resize-none"
            />
            <p className="text-[10px] text-muted-foreground">
              點選此積木時，此提示詞會自動加入你的創作描述中
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            size="sm"
          >
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            size="sm"
          >
            {createMutation.isPending ? "建立中..." : "建立積木"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Save Combo Dialog ────────────────────────────────────────────────────

function SaveComboDialog({
  open,
  onOpenChange,
  modality,
  selectedBlocks,
  selectedCustomBlockIds,
  vibeCardIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modality: string;
  selectedBlocks: Set<string>;
  selectedCustomBlockIds: Set<number>;
  vibeCardIds: string[];
}) {
  const [name, setName] = useState("");
  const utils = trpc.useUtils();

  const createMutation = trpc.blockCombos.create.useMutation({
    onSuccess: () => {
      toast.success("靈感組合已收藏");
      utils.blockCombos.list.invalidate();
      setName("");
      onOpenChange(false);
    },
    onError: err => {
      toast.error("收藏失敗：" + err.message);
    },
  });

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error("請為組合命名");
      return;
    }
    createMutation.mutate({
      name: name.trim(),
      modality: modality as "image" | "video" | "audio" | "voice",
      blockIds: Array.from(selectedBlocks),
      customBlockIds: Array.from(selectedCustomBlockIds),
      vibeCardIds: vibeCardIds.length > 0 ? vibeCardIds : undefined,
    });
  };

  const totalCount =
    selectedBlocks.size + selectedCustomBlockIds.size + vibeCardIds.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        style={{
          background: "rgba(255,255,255,0.95)",
          backdropFilter: "blur(20px)",
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="w-4 h-4 text-rose-500" />
            收藏靈感組合
          </DialogTitle>
          <DialogDescription>
            將目前選取的 {totalCount} 個元素儲存為可快速套用的組合
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">組合名稱</Label>
            <Input
              placeholder="例如：賽博龐克城市夜景"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={255}
              className="h-9 text-sm"
            />
          </div>

          {/* Preview of what's being saved */}
          <div className="p-3 rounded-lg bg-muted/30 border border-border/30 space-y-1.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              組合內容預覽
            </p>
            <div className="flex flex-wrap gap-1">
              {Array.from(selectedBlocks).map(id => {
                const found = findBuiltinBlock(id);
                return found ? (
                  <span
                    key={id}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary"
                  >
                    {found.category.icon} {found.item.label}
                  </span>
                ) : null;
              })}
              {vibeCardIds.map(id => {
                const card = VIBE_CARDS.find(v => v.id === id);
                return card ? (
                  <span
                    key={id}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/10 text-violet-600"
                  >
                    {card.labelZh}
                  </span>
                ) : null;
              })}
              {selectedCustomBlockIds.size > 0 && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-600">
                  +{selectedCustomBlockIds.size} 自訂積木
                </span>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            size="sm"
          >
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            size="sm"
          >
            {createMutation.isPending ? "儲存中..." : "收藏組合"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export const ProgressivePromptBuilder = memo(function ProgressivePromptBuilder({
  value,
  onChange,
  modality,
  onType,
  simpleMode,
}: ProgressivePromptBuilderProps & { onType?: (len: number) => void }) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [blocksOpen, setBlocksOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [selectedBlocks, setSelectedBlocks] = useState<Set<string>>(new Set());
  const [selectedCustomBlockIds, setSelectedCustomBlockIds] = useState<
    Set<number>
  >(new Set());
  const [tokens, setTokens] = useState<TokenWeight[]>([]);
  const [createBlockOpen, setCreateBlockOpen] = useState(false);
  const [saveComboOpen, setSaveComboOpen] = useState(false);
  const [combosOpen, setCombosOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Get the correct block categories for the current modality
  const blockCategories = useMemo(
    () => getBlocksForModality(modality),
    [modality]
  );

  // Fetch custom blocks for current modality
  const { data: customBlocksData } = trpc.customBlocks.list.useQuery(
    { modality: modality || "image" },
    { enabled: !!modality }
  );

  // Fetch saved combos for current modality
  const { data: combosData } = trpc.blockCombos.list.useQuery(
    { modality: modality || "image" },
    { enabled: !!modality }
  );

  const utils = trpc.useUtils();

  const deleteCustomBlockMutation = trpc.customBlocks.delete.useMutation({
    onSuccess: () => {
      toast.success("自訂積木已刪除");
      utils.customBlocks.list.invalidate();
    },
  });

  const deleteComboMutation = trpc.blockCombos.delete.useMutation({
    onSuccess: () => {
      toast.success("組合已刪除");
      utils.blockCombos.list.invalidate();
    },
  });

  const renameComboMutation = trpc.blockCombos.rename.useMutation({
    onSuccess: () => {
      toast.success("已重新命名");
      utils.blockCombos.list.invalidate();
    },
  });

  // Group custom blocks by category
  type CustomBlockItem = NonNullable<typeof customBlocksData>[number];

  const customBlocksByCategory = useMemo(() => {
    const map = new Map<string, CustomBlockItem[]>();
    if (!customBlocksData) return map;
    for (const block of customBlocksData) {
      const existing = map.get(block.category) || [];
      existing.push(block);
      map.set(block.category, existing);
    }
    return map;
  }, [customBlocksData]);

  // Reset selected blocks when modality changes
  const prevModalityRef = useRef(modality);
  useEffect(() => {
    if (prevModalityRef.current !== modality) {
      setSelectedBlocks(new Set());
      setSelectedCustomBlockIds(new Set());
      prevModalityRef.current = modality;
    }
  }, [modality]);

  // Parse tokens when rawPrompt changes (debounced)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const newTokens = parseTokens(value.rawPrompt);
      const merged = newTokens.map(nt => {
        const existing = tokens.find(
          et => et.text.toLowerCase() === nt.text.toLowerCase()
        );
        return existing ? { ...nt, weight: existing.weight } : nt;
      });
      setTokens(merged);
      if (merged.length > 0 && !attentionOpen) {
        setAttentionOpen(true);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value.rawPrompt]);

  // ─── Advanced fields → compiled prompt builder ────────────────────────────
  // Compiles rawPrompt + advancedFields + vibeCards into a final prompt string
  const buildCompiledPrompt = useCallback(
    (
      raw: string,
      adv: AdvancedFields,
      vibes: string[],
      tkns: TokenWeight[]
    ): string => {
      // Start with raw prompt (or token-weighted version if tokens exist)
      const base = tkns.length > 0 ? compileWithWeights(tkns, [], raw) : raw;

      // Append advanced structured fields
      const advParts: string[] = [];
      if (adv.subject?.trim()) advParts.push(`Subject: ${adv.subject.trim()}`);
      if (adv.action?.trim()) advParts.push(`Action: ${adv.action.trim()}`);
      if (adv.environment?.trim())
        advParts.push(`Environment: ${adv.environment.trim()}`);
      if (adv.lighting?.trim())
        advParts.push(`Lighting: ${adv.lighting.trim()}`);
      if (adv.cameraAngle?.trim())
        advParts.push(`Camera: ${adv.cameraAngle.trim()}`);

      // Append vibe style labels
      const vibeLabels = vibes
        .map(id => VIBE_CARDS.find(v => v.id === id)?.label)
        .filter(Boolean) as string[];

      const parts: string[] = [];
      if (base.trim()) parts.push(base.trim());
      if (advParts.length > 0) parts.push(advParts.join(", "));
      if (vibeLabels.length > 0) parts.push(`Style: ${vibeLabels.join(", ")}`);
      return parts.join(". ").trim();
    },
    []
  );

  // Recompile when tokens change
  const recompile = useCallback(
    (updatedTokens: TokenWeight[], vibes: string[]) => {
      const compiled = buildCompiledPrompt(
        value.rawPrompt,
        value.advancedFields,
        vibes,
        updatedTokens
      );
      onChange({
        ...value,
        compiledPrompt: compiled,
        tokenWeights: updatedTokens,
        vibeCardIds: vibes,
      });
    },
    [value, onChange, buildCompiledPrompt]
  );

  const updateField = useCallback(
    (key: keyof PromptBuilderOutput, val: unknown) => {
      const next = { ...value, [key]: val };
      if (key === "vibeCardIds") {
        const compiled = buildCompiledPrompt(
          value.rawPrompt,
          value.advancedFields,
          val as string[],
          tokens
        );
        onChange({ ...next, compiledPrompt: compiled });
      } else if (key === "rawPrompt") {
        const compiled = buildCompiledPrompt(
          val as string,
          value.advancedFields,
          value.vibeCardIds,
          tokens
        );
        onChange({ ...next, compiledPrompt: compiled });
      } else {
        onChange(next);
      }
    },
    [value, onChange, tokens, buildCompiledPrompt]
  );

  const toggleVibe = useCallback(
    (id: string) => {
      const next = value.vibeCardIds.includes(id)
        ? value.vibeCardIds.filter(v => v !== id)
        : [...value.vibeCardIds, id];
      updateField("vibeCardIds", next);
    },
    [value.vibeCardIds, updateField]
  );

  const updateAdvanced = useCallback(
    (key: keyof AdvancedFields, val: string) => {
      const next = { ...value.advancedFields, [key]: val };
      // Recompile compiled prompt including the updated advanced fields
      const compiled = buildCompiledPrompt(
        value.rawPrompt,
        next,
        value.vibeCardIds,
        tokens
      );
      onChange({ ...value, advancedFields: next, compiledPrompt: compiled });
    },
    [value, onChange, tokens, buildCompiledPrompt]
  );

  const handleTokenWeightChange = useCallback(
    (tokenId: string, weight: number) => {
      const updated = tokens.map(t =>
        t.id === tokenId ? { ...t, weight } : t
      );
      setTokens(updated);
      recompile(updated, value.vibeCardIds);
    },
    [tokens, value.vibeCardIds, recompile]
  );

  const handleBlockToggle = useCallback(
    (blockId: string, prompt: string, categoryId: string) => {
      const next = new Set(selectedBlocks);
      if (next.has(blockId)) {
        // Deselect
        next.delete(blockId);
        const newRaw = value.rawPrompt
          .replace(prompt, "")
          .replace(/,\s*,/g, ",")
          .replace(/^,\s*|,\s*$/g, "")
          .trim();
        updateField("rawPrompt", newRaw);
      } else {
        // ── Enforce 1-per-category limit for conflicting categories ──
        // Find any other selected item in the same category and deselect it first
        const cat = blockCategories.find(c => c.id === categoryId);
        let rawPrompt = value.rawPrompt;
        if (cat) {
          for (const item of cat.items) {
            if (next.has(item.id)) {
              next.delete(item.id);
              rawPrompt = rawPrompt
                .replace(item.prompt, "")
                .replace(/,\s*,/g, ",")
                .replace(/^,\s*|,\s*$/g, "")
                .trim();
            }
          }
        }
        next.add(blockId);
        const separator = rawPrompt.trim() ? ", " : "";
        updateField("rawPrompt", rawPrompt.trim() + separator + prompt);
      }
      setSelectedBlocks(next);
    },
    [selectedBlocks, value.rawPrompt, updateField, blockCategories]
  );

  const handleCustomBlockToggle = useCallback(
    (block: { id: number; prompt: string }) => {
      const next = new Set(selectedCustomBlockIds);
      if (next.has(block.id)) {
        next.delete(block.id);
        const newRaw = value.rawPrompt
          .replace(block.prompt, "")
          .replace(/,\s*,/g, ",")
          .replace(/^,\s*|,\s*$/g, "")
          .trim();
        updateField("rawPrompt", newRaw);
      } else {
        next.add(block.id);
        const separator = value.rawPrompt.trim() ? ", " : "";
        updateField(
          "rawPrompt",
          value.rawPrompt.trim() + separator + block.prompt
        );
      }
      setSelectedCustomBlockIds(next);
    },
    [selectedCustomBlockIds, value.rawPrompt, updateField]
  );

  // Apply a saved combo
  const applyCombo = useCallback(
    (combo: NonNullable<typeof combosData>[number]) => {
      // Clear current selections
      const newSelectedBlocks = new Set<string>();
      const newCustomBlockIds = new Set<number>();
      const promptParts: string[] = [];

      // Re-select built-in blocks
      const blockIds = combo.blockIds as string[];
      for (const id of blockIds) {
        const found = findBuiltinBlock(id);
        if (found) {
          newSelectedBlocks.add(id);
          promptParts.push(found.item.prompt);
        }
      }

      // Re-select custom blocks
      const customIds = (combo.customBlockIds as number[]) || [];
      for (const id of customIds) {
        const found = customBlocksData?.find(b => b.id === id);
        if (found) {
          newCustomBlockIds.add(id);
          promptParts.push(found.prompt);
        }
      }

      // Set vibes
      const vibes = (combo.vibeCardIds as string[]) || [];

      setSelectedBlocks(newSelectedBlocks);
      setSelectedCustomBlockIds(newCustomBlockIds);

      const rawPrompt = promptParts.join(", ");
      const vibeLabels = vibes
        .map(id => VIBE_CARDS.find(v => v.id === id)?.label)
        .filter(Boolean);
      const compiled =
        rawPrompt +
        (vibeLabels.length > 0 ? `. Style: ${vibeLabels.join(", ")}` : "");

      onChange({
        ...value,
        rawPrompt,
        vibeCardIds: vibes,
        compiledPrompt: compiled,
      });

      toast.success(`已套用組合「${combo.name}」`);
    },
    [customBlocksData, value, onChange]
  );

  const hasAdvancedContent = useMemo(
    () => Object.values(value.advancedFields).some(v => v.trim()),
    [value.advancedFields]
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        !target.closest("[data-token-chip]") &&
        !target.closest("[data-token-slider]")
      ) {
        setSelectedTokenId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const blocksLabel =
    modality === "audio"
      ? "音樂靈感積木"
      : modality === "voice"
        ? "配音靈感積木"
        : modality === "video"
          ? "影片靈感積木"
          : "圖像靈感積木";
  const promptPlaceholder =
    modality === "audio"
      ? "描述你想要的音樂風格與情感...或從上方積木拼出靈感"
      : modality === "voice"
        ? "輸入要轉換為語音的文字...或從上方積木拼出靈感"
        : modality === "video"
          ? "描述你想要的影片畫面...或從上方積木拼出靈感"
          : "描述你想要創作的畫面...或從上方積木拼出靈感";

  const totalSelected = selectedBlocks.size + selectedCustomBlockIds.size;
  const canSaveCombo = totalSelected > 0 || value.vibeCardIds.length > 0;

  return (
    <div className={cn("space-y-4", simpleMode && "space-y-6")}>
      {/* ═══ Section 1: Main Prompt Textarea ═══ */}
      <div className={cn("space-y-2", simpleMode && "space-y-3")}>
        <div className="flex items-center justify-between">
          <Label
            className={cn(
              "text-sm font-medium text-foreground",
              simpleMode && "text-base"
            )}
          >
            {simpleMode ? "想創作什麼？" : "創作描述"}
          </Label>
          {!simpleMode &&
            value.compiledPrompt &&
            value.compiledPrompt !== value.rawPrompt && (
              <span className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                已自動編譯進階提示詞
              </span>
            )}
        </div>
        <Textarea
          placeholder={
            simpleMode
              ? "描述你想看到的畫面，或直接選擇下方靈感卡片..."
              : promptPlaceholder
          }
          value={value.rawPrompt}
          onChange={e => {
            updateField("rawPrompt", e.target.value);
            onType?.(e.target.value.length);
          }}
          rows={simpleMode ? 4 : 3}
          className={cn(
            "rounded-xl bg-white/40 border-white/60 resize-none text-sm placeholder:text-muted-foreground/40 focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:border-primary/30",
            simpleMode && "text-base py-4 px-5 rounded-2xl"
          )}
        />
      </div>

      {/* ═══ Section 2: Vibe Cards — hidden ═══ */}

      {/* ═══ Section 3+ : Blocks, Self-Attention, Advanced — hidden in simple mode ═══ */}
      {!simpleMode && (
        <>
          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: "rgba(255,255,255,0.25)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(255,255,255,0.35)",
            }}
          >
            <button
              onClick={() => setBlocksOpen(!blocksOpen)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Blocks className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">
                  {blocksLabel}
                </span>
                {totalSelected > 0 && (
                  <span className="text-[10px] bg-primary/15 text-primary px-2 py-0.5 rounded-full font-medium">
                    {totalSelected} 個已選
                  </span>
                )}
              </div>
              <motion.div
                animate={{ rotate: blocksOpen ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </motion.div>
            </button>

            <AnimatePresence>
              {blocksOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 space-y-3">
                    {/* Action bar: create custom block + save combo */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px] gap-1 bg-white/30 border-white/40 hover:bg-white/50"
                        onClick={() => setCreateBlockOpen(true)}
                      >
                        <Plus className="w-3 h-3" />
                        自訂積木
                      </Button>
                      {canSaveCombo && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] gap-1 bg-rose-500/5 border-rose-300/40 text-rose-600 hover:bg-rose-500/10"
                          onClick={() => setSaveComboOpen(true)}
                        >
                          <Heart className="w-3 h-3" />
                          收藏組合
                        </Button>
                      )}
                      {combosData && combosData.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] gap-1 bg-amber-500/5 border-amber-300/40 text-amber-600 hover:bg-amber-500/10"
                          onClick={() => setCombosOpen(!combosOpen)}
                        >
                          <FolderOpen className="w-3 h-3" />
                          我的組合 ({combosData.length})
                        </Button>
                      )}
                    </div>

                    {/* Saved combos panel */}
                    <AnimatePresence>
                      {combosOpen && combosData && combosData.length > 0 && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div
                            className="p-3 rounded-lg space-y-2"
                            style={{
                              background: "rgba(255,180,50,0.06)",
                              border: "1px solid rgba(255,180,50,0.15)",
                            }}
                          >
                            <p className="text-[10px] text-amber-600/70 uppercase tracking-wider font-medium">
                              已收藏的靈感組合
                            </p>
                            <div className="space-y-1.5">
                              {combosData.map(combo => (
                                <ComboCard
                                  key={combo.id}
                                  combo={combo}
                                  onApply={() => applyCombo(combo)}
                                  onDelete={() =>
                                    deleteComboMutation.mutate({ id: combo.id })
                                  }
                                  onRename={name =>
                                    renameComboMutation.mutate({
                                      id: combo.id,
                                      name,
                                    })
                                  }
                                />
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Selected blocks preview */}
                    {totalSelected > 0 && (
                      <div
                        className="flex flex-wrap gap-1.5 p-2.5 rounded-lg"
                        style={{
                          background: "rgba(255,255,255,0.1)",
                          border: "1px dashed rgba(255,255,255,0.25)",
                        }}
                      >
                        <span className="text-[10px] text-muted-foreground/60 mr-1 self-center">
                          已選組合:
                        </span>
                        {blockCategories.flatMap(cat =>
                          cat.items
                            .filter(item => selectedBlocks.has(item.id))
                            .map(item => (
                              <motion.span
                                key={item.id}
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                exit={{ scale: 0 }}
                                className="px-2 py-0.5 rounded-md text-[10px] font-medium"
                                style={{
                                  background: `rgba(${cat.glowRgb}, 0.15)`,
                                  color: `rgb(${cat.glowRgb})`,
                                  border: `1px solid rgba(${cat.glowRgb}, 0.3)`,
                                }}
                              >
                                {cat.icon} {item.label}
                              </motion.span>
                            ))
                        )}
                        {customBlocksData
                          ?.filter(b => selectedCustomBlockIds.has(b.id))
                          .map(b => (
                            <motion.span
                              key={`custom-${b.id}`}
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-amber-500/15 text-amber-600 border border-amber-500/30"
                            >
                              * {b.label}
                            </motion.span>
                          ))}
                      </div>
                    )}

                    {/* Block categories */}
                    {blockCategories.map(cat => {
                      const customInCategory =
                        customBlocksByCategory.get(cat.id) || [];
                      return (
                        <div key={cat.id} className="space-y-1.5">
                          <Label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                            <span>{cat.icon}</span>
                            {cat.label}
                            {customInCategory.length > 0 && (
                              <span className="text-[9px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded-full">
                                +{customInCategory.length} 自訂
                              </span>
                            )}
                          </Label>
                          <div className="flex flex-wrap gap-1.5">
                            {cat.items.map(item => (
                              <BlockChip
                                key={item.id}
                                item={item}
                                category={cat}
                                isSelected={selectedBlocks.has(item.id)}
                                onToggle={() =>
                                  handleBlockToggle(
                                    item.id,
                                    item.prompt,
                                    cat.id
                                  )
                                }
                              />
                            ))}
                            {/* Custom blocks in this category */}
                            {customInCategory.map(cb => (
                              <BlockChip
                                key={`custom-${cb.id}`}
                                item={{
                                  id: `custom-${cb.id}`,
                                  label: cb.label,
                                  prompt: cb.prompt,
                                }}
                                category={cat}
                                isSelected={selectedCustomBlockIds.has(cb.id)}
                                onToggle={() =>
                                  handleCustomBlockToggle({
                                    id: cb.id,
                                    prompt: cb.prompt,
                                  })
                                }
                                onDelete={() =>
                                  deleteCustomBlockMutation.mutate({
                                    id: cb.id,
                                  })
                                }
                                isCustom
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    {/* Custom blocks in categories not matching built-in ones */}
                    {Array.from(customBlocksByCategory)
                      .filter(
                        ([catId]: [string, CustomBlockItem[]]) =>
                          !blockCategories.some(bc => bc.id === catId)
                      )
                      .map(([catId, blocks]: [string, CustomBlockItem[]]) => (
                        <div key={catId} className="space-y-1.5">
                          <Label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
                            <span>*</span>
                            {catId}
                            <span className="text-[9px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded-full">
                              自訂
                            </span>
                          </Label>
                          <div className="flex flex-wrap gap-1.5">
                            {blocks.map(cb => (
                              <BlockChip
                                key={`custom-${cb.id}`}
                                item={{
                                  id: `custom-${cb.id}`,
                                  label: cb.label,
                                  prompt: cb.prompt,
                                }}
                                category={{
                                  id: catId,
                                  label: catId,
                                  icon: "*",
                                  color: "amber",
                                  glowRgb: "255,180,50",
                                  items: [],
                                }}
                                isSelected={selectedCustomBlockIds.has(cb.id)}
                                onToggle={() =>
                                  handleCustomBlockToggle({
                                    id: cb.id,
                                    prompt: cb.prompt,
                                  })
                                }
                                onDelete={() =>
                                  deleteCustomBlockMutation.mutate({
                                    id: cb.id,
                                  })
                                }
                                isCustom
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ═══ Section 4: Self-Attention UI (Token Weights) ═══ */}
          {tokens.length > 0 && (
            <div
              className="rounded-xl overflow-hidden"
              style={{
                background: "rgba(255,255,255,0.25)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(255,255,255,0.35)",
              }}
            >
              <button
                onClick={() => setAttentionOpen(!attentionOpen)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/10 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Focus className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-semibold text-foreground">
                    自注意力控制台
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {tokens.length} 個 Token
                  </span>
                  {tokens.some(t => Math.abs(t.weight - 1.0) >= 0.05) && (
                    <span className="text-[10px] bg-amber-500/15 text-amber-500 px-2 py-0.5 rounded-full font-medium">
                      已調整權重
                    </span>
                  )}
                </div>
                <motion.div
                  animate={{ rotate: attentionOpen ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                </motion.div>
              </button>

              <AnimatePresence>
                {attentionOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 space-y-3">
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        點擊 Token 標籤調整 AI 注意力權重。權重越高，AI
                        越關注該元素。
                      </p>
                      <div className="flex flex-wrap gap-2" data-token-chip>
                        {tokens.map(token => (
                          <TokenChip
                            key={token.id}
                            token={token}
                            isSelected={selectedTokenId === token.id}
                            onSelect={() =>
                              setSelectedTokenId(
                                selectedTokenId === token.id ? null : token.id
                              )
                            }
                            onWeightChange={w =>
                              handleTokenWeightChange(token.id, w)
                            }
                          />
                        ))}
                      </div>
                      {value.compiledPrompt && (
                        <div
                          className="p-3 rounded-lg"
                          style={{
                            background: "rgba(255, 180, 50, 0.05)",
                            border: "1px solid rgba(255, 180, 50, 0.15)",
                          }}
                        >
                          <p className="text-[10px] text-amber-500/60 uppercase tracking-wider mb-1.5 font-medium">
                            編譯後提示詞（含權重）
                          </p>
                          <p className="text-xs text-foreground/80 leading-relaxed font-mono">
                            {value.compiledPrompt}
                          </p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

        </>
      )}

      {/* ═══ Dialogs ═══ */}
      <CreateBlockDialog
        open={createBlockOpen}
        onOpenChange={setCreateBlockOpen}
        modality={modality || "image"}
        categories={blockCategories}
      />
      <SaveComboDialog
        open={saveComboOpen}
        onOpenChange={setSaveComboOpen}
        modality={modality || "image"}
        selectedBlocks={selectedBlocks}
        selectedCustomBlockIds={selectedCustomBlockIds}
        vibeCardIds={value.vibeCardIds}
      />
    </div>
  );
});

ProgressivePromptBuilder.displayName = "ProgressivePromptBuilder";

// ─── Combo Card ───────────────────────────────────────────────────────────

function ComboCard({
  combo,
  onApply,
  onDelete,
  onRename,
}: {
  combo: {
    id: number;
    name: string;
    blockIds: unknown;
    customBlockIds: unknown;
    vibeCardIds: unknown;
    createdAt: Date;
  };
  onApply: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const isMobile = useIsMobile();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(combo.name);

  const blockIds = (combo.blockIds as string[]) || [];
  const customIds = (combo.customBlockIds as number[]) || [];
  const vibeIds = (combo.vibeCardIds as string[]) || [];
  const totalItems = blockIds.length + customIds.length + vibeIds.length;

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-white/30 hover:bg-white/50 transition-colors group">
      {editing ? (
        <div className="flex items-center gap-1 flex-1">
          <Input
            value={editName}
            onChange={e => setEditName(e.target.value)}
            className="h-6 text-xs flex-1"
            autoFocus
            onKeyDown={e => {
              if (e.key === "Enter") {
                onRename(editName);
                setEditing(false);
              }
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <button
            onClick={() => {
              onRename(editName);
              setEditing(false);
            }}
            className="p-0.5 text-primary hover:text-primary/80"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate">
            {combo.name}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {totalItems} 個元素
          </p>
        </div>
      )}

      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-primary hover:text-primary/80 hover:bg-primary/10"
          onClick={onApply}
          title="套用此組合"
        >
          <Sparkles className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={`h-6 w-6 p-0 text-muted-foreground hover:text-foreground transition-opacity ${isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          onClick={() => {
            setEditName(combo.name);
            setEditing(true);
          }}
          title="重新命名"
        >
          <Edit3 className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={`h-6 w-6 p-0 text-muted-foreground hover:text-destructive transition-opacity ${isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
          onClick={onDelete}
          title="刪除組合"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

// ─── Default empty state ───────────────────────────────────────────────────

export function createEmptyPromptOutput(): PromptBuilderOutput {
  return {
    rawPrompt: "",
    vibeCardIds: [],
    advancedFields: {
      subject: "",
      action: "",
      environment: "",
      lighting: "",
      cameraAngle: "",
    },
    compiledPrompt: "",
    tokenWeights: [],
  };
}
