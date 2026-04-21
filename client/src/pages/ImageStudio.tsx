/**
 * ImageStudio.tsx — 專業圖片創作室 v2
 *
 * 整合 fal.ai 完整圖片模型矩陣：
 *  文字生圖（4）/ 圖片編輯（9）/ 影像放大（1）/ 骨骼姿勢偵測（1）
 *  Stable Diffusion（3）/ 圖片轉3D（5）
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { useAIState } from "@/contexts/AIStateContext";
import VisualSoul from "@/components/VisualSoul";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  Image,
  Wand2,
  Sparkles,
  Download,
  Loader2,
  AlertCircle,
  History,
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  Copy,
  Settings2,
  X,
  ChevronDown,
  ChevronUp,
  Zap,
  Check,
  Paintbrush,
  ImagePlus,
  RefreshCw,
  Trash2,
  Eye,
  Grid3x3,
  SlidersHorizontal,
  Plus,
  Box,
  Scan,
  ArrowUpCircle,
  Brain,
  Layers,
  Camera,
  Upload,
  Cpu,
  Lightbulb,
  HelpCircle,
  Rocket,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { uploadFileToS3 } from "@/lib/upload";
import { useRegisterBgTask } from "@/contexts/BackgroundTasksContext";
import { normalizeEngineModelId } from "@shared/engineModelIds";
import {
  useRegisterPageAgent,
  type AgentAction,
  type AgentActionResult,
  type AgentCapability,
} from "@/contexts/PageAgentContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type StudioTab =
  | "t2i" // 文字生圖
  | "edit" // 圖片編輯
  | "upscale" // 影像放大
  | "pose" // 骨骼姿勢
  | "sd" // Stable Diffusion
  | "3d"; // 圖片轉3D

type ModelCategory = "t2i" | "edit" | "upscale" | "pose" | "sd" | "3d";

type ModelInfo = {
  id: string;
  falId: string;
  name: string;
  desc: string;
  badge: string;
  category: ModelCategory;
  color: ColorKey;
  supportsMultiRef?: boolean;
  supportsNeg?: boolean;
  supportsStrength?: boolean;
  supportsMask?: boolean;
  supportsSize?: boolean;
  supportsGuidance?: boolean;
  supportsControlNet?: boolean;
  supportsLora?: boolean;
  fast?: boolean;
  outputType?: "image" | "3d" | "pose";
  /** Best use case for this model */
  bestFor?: string;
  /** Practical tip for using this model */
  tip?: string;
  /** Mark as recommended starter model */
  recommended?: boolean;
};

type ColorKey =
  | "purple"
  | "blue"
  | "green"
  | "orange"
  | "pink"
  | "cyan"
  | "indigo"
  | "rose"
  | "amber"
  | "teal"
  | "violet"
  | "slate"
  | "lime"
  | "sky";

type HistoryItem = {
  id: string;
  prompt: string;
  imageUrl: string;
  modelId: string;
  modelName: string;
  timestamp: number;
  bookmarked: boolean;
  params: Record<string, unknown>;
};

type VibeCard = {
  id: string;
  label: string;
  labelZh: string;
  emoji: string;
  keywords: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MODELS: ModelInfo[] = [
  // ── 文字生圖 ──
  {
    id: "nanoBanana2",
    falId: "fal-ai/nano-banana-2",
    name: "Nano Banana 2",
    desc: "快速生成 • 支援文字渲染 • 可加入參考圖",
    badge: "Gemini Flash",
    category: "t2i",
    color: "purple",
    supportsMultiRef: true,
    fast: true,
    recommended: true,
    bestFor: "🚀 快速創作、嘗試各種想法",
    tip: "速度最快的模型，適合快速試驗想法。支援最多 14 張參考圖，可以用參考圖引導風格。",
  },
  {
    id: "nanoBananaPro",
    falId: "fal-ai/nano-banana-pro",
    name: "Nano Banana Pro",
    desc: "最高品質 • 商業授權 • 精細控制",
    badge: "Gemini Pro",
    category: "t2i",
    color: "indigo",
    supportsMultiRef: true,
    bestFor: "💎 高品質成品、商業用途",
    tip: "品質最高的模型，適合需要精細成品的場景。可加入參考圖，商業授權友善。",
  },
  {
    id: "seedreamV4",
    falId: "fal-ai/bytedance/seedream/v4/text-to-image",
    name: "SeeDream v4",
    desc: "支援中文描述 • 高品質 • 多風格",
    badge: "ByteDance",
    category: "t2i",
    color: "orange",
    supportsNeg: true,
    bestFor: "🀄 中文描述、東方美學風格",
    tip: "可以直接用中文寫提示詞！例如「一位穿旗袍的女孩站在竹林中」。支援負向提示詞排除不想要的元素。",
  },
  {
    id: "imagen4",
    falId: "fal-ai/imagen4/preview",
    name: "Imagen 4 Preview",
    desc: "超真實感 • 細節豐富 • Google 出品",
    badge: "Google Imagen",
    category: "t2i",
    color: "blue",
    supportsNeg: true,
    bestFor: "📸 寫實照片、超逼真場景",
    tip: "擅長生成接近真實照片的圖片，細節非常豐富。適合風景、人像等寫實題材。",
  },

  // ── 圖片編輯 ──
  {
    id: "nanoBananaProEdit",
    falId: "fal-ai/nano-banana-pro/edit",
    name: "Nano Banana Pro Edit",
    desc: "Gemini 3 Pro • 語意式編輯 • 14圖融合",
    badge: "Gemini Pro",
    category: "edit",
    color: "indigo",
    supportsMultiRef: true,
  },
  {
    id: "nanoBananaEdit",
    falId: "fal-ai/nano-banana/edit",
    name: "Nano Banana Edit",
    desc: "Gemini 2.0 Flash • 快速編輯 • 多圖融合",
    badge: "Gemini Flash",
    category: "edit",
    color: "purple",
    supportsMultiRef: true,
    fast: true,
  },
  {
    id: "nanoBanana2Edit",
    falId: "fal-ai/nano-banana-2/edit",
    name: "Nano Banana 2 Edit",
    desc: "Gemini 3.1 Flash 編輯 • 多圖融合 • 0.5K-4K",
    badge: "Gemini Flash",
    category: "edit",
    color: "violet",
    supportsMultiRef: true,
    fast: true,
  },
  {
    id: "seedreamV45Edit",
    falId: "fal-ai/bytedance/seedream/v4.5/edit",
    name: "SeeDream v4.5 Edit",
    desc: "ByteDance • 高品質圖片語意編輯",
    badge: "ByteDance",
    category: "edit",
    color: "orange",
    supportsStrength: true,
  },
  {
    id: "seedreamV5LiteEdit",
    falId: "fal-ai/bytedance/seedream/v5/lite/edit",
    name: "SeeDream v5 Lite",
    desc: "ByteDance v5 • 輕量快速編輯",
    badge: "BD v5 Lite",
    category: "edit",
    color: "amber",
    supportsStrength: true,
    fast: true,
  },
  {
    id: "grokEdit",
    falId: "xai/grok-imagine-image/edit",
    name: "Grok Imagine Edit",
    desc: "xAI Grok • 原生多模態理解 • 語意精確",
    badge: "xAI Grok",
    category: "edit",
    color: "teal",
  },
  {
    id: "gptImage15Edit",
    falId: "fal-ai/gpt-image-1.5/edit",
    name: "GPT Image 1.5 Edit",
    desc: "OpenAI • 可選遮罩 • 頂尖語意理解",
    badge: "OpenAI",
    category: "edit",
    color: "green",
    supportsMask: true,
    supportsSize: true,
  },
  {
    id: "fluxKontext",
    falId: "fal-ai/flux-pro/kontext",
    name: "FLUX Kontext Pro",
    desc: "BFL • 精準局部修改 • 上下文感知",
    badge: "FLUX.1",
    category: "edit",
    color: "rose",
    supportsGuidance: true,
  },
  {
    id: "flux2ProEdit",
    falId: "fal-ai/flux-2-pro/edit",
    name: "FLUX 2 Pro Edit",
    desc: "BFL Flux2 Pro • 高真實感 • 多圖融合",
    badge: "FLUX 2 Pro",
    category: "edit",
    color: "pink",
    supportsMultiRef: true,
  },

  // ── 影像放大 ──
  {
    id: "seedVRUpscale",
    falId: "fal-ai/seedvr/upscale/image",
    name: "SeedVR Upscale",
    desc: "ByteDance SeedVR • ×2/×4 放大 • 720p→2160p",
    badge: "SeedVR",
    category: "upscale",
    color: "sky",
    outputType: "image",
  },

  // ── 骨骼姿勢 ──
  {
    id: "dwPose",
    falId: "fal-ai/dwpose",
    name: "DWPose 骨骼偵測",
    desc: "Mediapipe DWPose • 全身/臉部/手部姿勢圖",
    badge: "DWPose",
    category: "pose",
    color: "lime",
    outputType: "pose",
  },

  // ── Stable Diffusion ──
  {
    id: "stableDiffusion35",
    falId: "fal-ai/stable-diffusion-v35-large",
    name: "SD 3.5 Large",
    desc: "Stability AI • ControlNet • LoRA • 高品質",
    badge: "SD 3.5",
    category: "sd",
    color: "cyan",
    supportsNeg: true,
    supportsGuidance: true,
    supportsControlNet: true,
    supportsLora: true,
  },
  {
    id: "fastSdxl",
    falId: "fal-ai/fast-sdxl",
    name: "Fast SDXL",
    desc: "SDXL 快速生圖 • LoRA 支援 • 多尺寸",
    badge: "SDXL",
    category: "sd",
    color: "slate",
    supportsNeg: true,
    supportsLora: true,
    fast: true,
  },
  {
    id: "sdLora",
    falId: "fal-ai/lora",
    name: "SD + LoRA",
    desc: "Stable Diffusion + 任意 HuggingFace LoRA",
    badge: "SD LoRA",
    category: "sd",
    color: "teal",
    supportsNeg: true,
    supportsLora: true,
  },

  // ── 圖片轉3D ──
  {
    id: "trellis2",
    falId: "fal-ai/trellis-2",
    name: "Trellis 2",
    desc: "原生3D生成 • GLB輸出 • 電影級幾何",
    badge: "Trellis 2",
    category: "3d",
    color: "indigo",
    outputType: "3d",
  },
  {
    id: "sam3dObjects",
    falId: "fal-ai/sam-3/3d-objects",
    name: "SAM 3D Objects",
    desc: "Facebook SAM • 精確3D重建 • 幾何+紋理",
    badge: "SAM 3D",
    category: "3d",
    color: "blue",
    outputType: "3d",
  },
  {
    id: "hunyuan3d",
    falId: "fal-ai/hunyuan3d-v3/image-to-3d",
    name: "混元 3D v3",
    desc: "騰訊混元 • 電影級幾何 • PBR紋理 • GLB/OBJ",
    badge: "HunyuanV3",
    category: "3d",
    color: "orange",
    outputType: "3d",
  },
  {
    id: "rodin3d",
    falId: "fal-ai/hyper3d/rodin",
    name: "Rodin 3D",
    desc: "Hyper3D • 文字/圖片生3D • PBR材質",
    badge: "Rodin",
    category: "3d",
    color: "purple",
    outputType: "3d",
  },
  {
    id: "hunyuanWorld",
    falId: "fal-ai/hunyuan_world/image-to-world",
    name: "混元 World",
    desc: "混元 World 1.0 • 圖片→全景3D世界",
    badge: "HunyuanWorld",
    category: "3d",
    color: "teal",
    outputType: "3d",
  },
];

const IMAGE_STUDIO_QUICK_GUIDE = [
  {
    id: "start",
    title: "新手起手式（先有穩定產出）",
    summary: "先跑快、再微調，先確定方向再打磨細節。",
    tips: [
      "先用 Nano Banana 2 快速試 3~5 組構圖。",
      "確認方向後再切高品質模型做定稿。",
      "每次只調整一個變數（構圖/光線/風格）。",
    ],
  },
  {
    id: "edit",
    title: "圖片編輯穩定策略",
    summary: "編輯模型吃語意，描述要具體且可驗證。",
    tips: [
      "先說「保留」什麼，再說「改動」什麼。",
      "局部修改時搭配遮罩，避免全圖意外變形。",
      "多圖融合建議先統一光線與色調再生成。",
    ],
  },
  {
    id: "history",
    title: "歷史回放與複用",
    summary: "把成功案例沉澱成可重複流程。",
    tips: [
      "優先收藏可重複題材，建立自己的範本庫。",
      "從歷史重用時只改目標元素，提高成功率。",
      "搭配模態篩選快速找到可直接套用的版本。",
    ],
  },
] as const;

type ModelCoaching = {
  bestFor: string;
  tip: string;
  advantages: string[];
};

const MODEL_COACHING_MAP: Partial<Record<string, ModelCoaching>> = {
  nanoBananaProEdit: {
    bestFor: "🧪 複雜語意編修、多圖融合重構",
    tip: "一句自然語言就能做大幅度重繪，特別適合「換場景、換服裝、改構圖」這類高階編修。",
    advantages: ["語意理解強", "多參考圖融合穩定", "成品質感高"],
  },
  nanoBananaEdit: {
    bestFor: "⚡ 日常快速改圖、批量微調",
    tip: "需要快節奏反覆試稿時優先使用，先用它收斂方向，再切高品質模型做定稿。",
    advantages: ["速度快", "成本友善", "改稿迭代效率高"],
  },
  nanoBanana2Edit: {
    bestFor: "⚖️ 品質與速度平衡的編輯任務",
    tip: "適合「先做 3–5 版比較」的工作流，挑到方向後再升級到 Pro 類模型。",
    advantages: ["生成穩定", "速度良好", "多圖場景表現均衡"],
  },
  seedreamV45Edit: {
    bestFor: "🎨 風格重塑與美術向精修",
    tip: "搭配 strength 由低到高測試（0.25→0.45→0.65），更容易拿到自然過渡結果。",
    advantages: ["風格遷移細膩", "色彩審美佳", "藝術感強"],
  },
  seedreamV5LiteEdit: {
    bestFor: "📱 輕量快速編輯與即時回饋",
    tip: "先用 Lite 版本快速確定語意，再切換高品質模型做最終輸出。",
    advantages: ["速度快", "反應靈敏", "適合探索期"],
  },
  grokEdit: {
    bestFor: "🧠 需要理解複雜敘述的語意改圖",
    tip: "當你的需求包含多個條件（人物、場景、情緒、道具）時，Grok 類模型通常更穩。",
    advantages: ["複合語意理解強", "上下文銜接好", "描述容錯高"],
  },
  gptImage15Edit: {
    bestFor: "🪄 局部遮罩修圖、精準替換",
    tip: "有局部修補需求（換背景、修手、改文字）時先畫遮罩，成功率會明顯上升。",
    advantages: ["局部控制精準", "語意自然", "商用場景友善"],
  },
  fluxKontext: {
    bestFor: "🎯 精準局部改動與一致性維持",
    tip: "適合「保留主體只改局部」的任務，尤其是產品圖與角色細節修正。",
    advantages: ["局部修改能力強", "原圖保留度高", "細節一致性好"],
  },
  flux2ProEdit: {
    bestFor: "🖼️ 高真實感商業修圖",
    tip: "多參考圖時先確保光線方向一致，可顯著提升融合自然度。",
    advantages: ["寫實細節好", "高品質輸出", "多圖融合能力強"],
  },
  seedVRUpscale: {
    bestFor: "🔍 低解析素材放大與細節補強",
    tip: "先做 ×2 檢查細節，再決定是否 ×4，能避免過度銳化或假細節。",
    advantages: ["放大品質穩定", "邊緣保持好", "適合老圖修復"],
  },
  dwPose: {
    bestFor: "🕺 姿勢骨架抽取與動作參考",
    tip: "先用骨架圖固定動作，再串到 SD/ControlNet，可大幅提升姿勢一致性。",
    advantages: ["骨架精準", "手部臉部標記完整", "動畫前置很實用"],
  },
  stableDiffusion35: {
    bestFor: "🧩 進階控制流（ControlNet + LoRA）",
    tip: "需要可控性時首選：先用 ControlNet 固定構圖，再用 LoRA 強化風格。",
    advantages: ["可控性高", "生態完整", "適合專業流程"],
  },
  fastSdxl: {
    bestFor: "⚡ 快速試圖與 LoRA 草稿",
    tip: "做風格探索和草稿非常快，確定方向後可切到高品質模型收斂。",
    advantages: ["推理快", "LoRA 友好", "草稿效率高"],
  },
  sdLora: {
    bestFor: "🧬 客製 LoRA 風格化任務",
    tip: "配合 trigger word 與 loraScale（建議 0.6~1.0）可更穩定地喚出角色/風格。",
    advantages: ["客製彈性高", "社群資源多", "角色一致性好"],
  },
  trellis2: {
    bestFor: "🧱 高品質 3D 幾何與 GLB 輸出",
    tip: "主體輪廓清楚、背景乾淨的圖片最容易得到完整可用的 3D 網格。",
    advantages: ["幾何品質高", "輸出乾淨", "適合資產製作"],
  },
  sam3dObjects: {
    bestFor: "📦 單物件精準 3D 重建",
    tip: "先裁切到單一主體再轉換，通常會得到更完整的物件邊界與紋理。",
    advantages: ["物件邊界準", "重建穩定", "適合產品類題材"],
  },
  hunyuan3d: {
    bestFor: "🎬 高質感 PBR 3D 資產",
    tip: "適合需要材質與幾何兼顧的場景，建議使用清晰主體圖並避免過度複雜背景。",
    advantages: ["PBR 材質表現佳", "幾何細節完整", "可用於高質場景"],
  },
  rodin3d: {
    bestFor: "🧠 文字/圖片混合驅動的 3D 生成",
    tip: "若圖片資訊不足，可補一段 prompt 強化語意，能提升形體與材質方向一致性。",
    advantages: ["圖文混合彈性高", "材質輸出完整", "適合概念驗證"],
  },
  hunyuanWorld: {
    bestFor: "🌍 圖片到全景世界構建",
    tip: "最適合場景探索與沉浸式概念提案，建議輸入具有明確前中後景的畫面。",
    advantages: ["世界構建能力", "場景延展性好", "概念展示效果強"],
  },
};

function getModelCoaching(model: ModelInfo): ModelCoaching | null {
  const mapped = MODEL_COACHING_MAP[model.id];
  if (mapped) return mapped;
  if (model.tip) {
    return {
      bestFor: model.bestFor ?? "✨ 通用圖像創作",
      tip: model.tip,
      advantages: [],
    };
  }
  return null;
}

const TABS: {
  id: StudioTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
}[] = [
  { id: "t2i", label: "文字生圖", icon: Sparkles, count: 4 },
  { id: "edit", label: "圖片編輯", icon: Paintbrush, count: 9 },
  { id: "upscale", label: "影像放大", icon: ArrowUpCircle, count: 1 },
  { id: "pose", label: "骨骼姿勢", icon: Scan, count: 1 },
  { id: "sd", label: "Stable Diffusion", icon: Brain, count: 3 },
  { id: "3d", label: "圖片轉3D", icon: Box, count: 5 },
];

const ASPECT_RATIOS = [
  { value: "1:1", label: "1:1", hint: "正方形" },
  { value: "16:9", label: "16:9", hint: "橫式" },
  { value: "9:16", label: "9:16", hint: "直式" },
  { value: "4:3", label: "4:3", hint: "傳統" },
  { value: "3:4", label: "3:4", hint: "人像" },
  { value: "3:2", label: "3:2", hint: "相片" },
  { value: "2:3", label: "2:3", hint: "書本" },
  { value: "auto", label: "Auto", hint: "自動" },
];

const IMAGE_SIZES = [
  { value: "square_hd", label: "正方 HD" },
  { value: "square", label: "正方" },
  { value: "portrait_4_3", label: "直式 4:3" },
  { value: "portrait_16_9", label: "直式 16:9" },
  { value: "landscape_4_3", label: "橫式 4:3" },
  { value: "landscape_16_9", label: "橫式 16:9" },
];

const VIBE_CARDS: VibeCard[] = [
  {
    id: "cinematic",
    label: "Cinematic",
    labelZh: "電影感",
    emoji: "🎬",
    keywords: "cinematic, film grain, dramatic lighting, 35mm, bokeh",
  },
  {
    id: "dreamy",
    label: "Dreamy",
    labelZh: "夢幻",
    emoji: "✨",
    keywords: "dreamy, ethereal, soft glow, pastel, fantasy, magical",
  },
  {
    id: "minimal",
    label: "Minimal",
    labelZh: "極簡",
    emoji: "⬜",
    keywords: "minimalist, clean, white space, simple, elegant, modern",
  },
  {
    id: "dark",
    label: "Dark Art",
    labelZh: "暗黑",
    emoji: "🖤",
    keywords: "dark, moody, chiaroscuro, dramatic shadows, gothic",
  },
  {
    id: "anime",
    label: "Anime",
    labelZh: "動漫風",
    emoji: "🌸",
    keywords: "anime style, manga, vibrant colors, cel shading, kawaii",
  },
  {
    id: "photo",
    label: "Photorealistic",
    labelZh: "寫實攝影",
    emoji: "📷",
    keywords: "photorealistic, hyperrealistic, DSLR, sharp focus, 8K",
  },
  {
    id: "watercolor",
    label: "Watercolor",
    labelZh: "水彩畫",
    emoji: "🎨",
    keywords: "watercolor painting, soft edges, flowing colors, artistic",
  },
  {
    id: "vintage",
    label: "Vintage",
    labelZh: "復古",
    emoji: "📸",
    keywords: "vintage, retro, film photography, warm tones, nostalgic",
  },
];

const PROMPT_TEMPLATES = [
  {
    title: "🌅 自然風光",
    text: "A breathtaking landscape at golden hour, dramatic sky with warm orange and pink clouds, mountain peaks reflecting in a still lake",
  },
  {
    title: "👤 人物肖像",
    text: "Professional portrait photography, natural light, soft bokeh background, sharp focus on face, editorial style",
  },
  {
    title: "🏙️ 城市夜景",
    text: "Cyberpunk cityscape at night, neon lights reflecting on wet streets, futuristic architecture, cinematic atmosphere",
  },
  {
    title: "🎨 抽象藝術",
    text: "Abstract digital art, vibrant color palette, geometric shapes, flowing lines, modern aesthetic, high contrast",
  },
  {
    title: "🌸 日系清新",
    text: "Japanese spring scene, cherry blossoms, soft natural light, pastel colors, tranquil atmosphere, film photography style",
  },
  {
    title: "🔮 奇幻場景",
    text: "Epic fantasy landscape, magical floating islands, ancient ruins, ethereal glowing lights, detailed illustration",
  },
];

const PROMPT_BUILDER_BLOCKS = {
  subject: [
    "一位優雅的女性",
    "一片寧靜的森林",
    "未來城市的街道",
    "古老的圖書館",
    "太空站外景",
    "熱帶海灘",
  ],
  style: ["攝影風格", "油畫風格", "水彩插畫", "動漫風格", "3D渲染", "極簡主義"],
  lighting: [
    "黃金時段光線",
    "柔和的自然光",
    "戲劇性側光",
    "霓虹燈光",
    "月光",
    "工作室燈光",
  ],
  mood: [
    "寧靜祥和",
    "神秘詭異",
    "充滿活力",
    "溫馨暖意",
    "史詩壯觀",
    "憂鬱感性",
  ],
  detail: [
    "超精細細節",
    "景深效果",
    "8K解析度",
    "電影感色調",
    "高動態範圍",
    "清晰銳利",
  ],
};

const T2I_GUIDE_KEY = "imageStudio_t2i_guide_dismissed";

/** One-click try prompt for newcomers */
const QUICK_TRY_PROMPT =
  "一隻可愛的小貓咪坐在窗台上，陽光灑進來，溫暖的午後氛圍，水彩插畫風格";

const CONTROLNET_PATHS = [
  { value: "diffusers/controlnet-canny-sdxl-1.0", label: "Canny 邊緣" },
  { value: "diffusers/controlnet-depth-sdxl-1.0", label: "深度圖" },
  { value: "thibaud/controlnet-openpose-sdxl-1.0", label: "OpenPose 姿勢" },
  { value: "diffusers/controlnet-zoe-depth-sdxl-1.0", label: "Zoe 深度" },
  { value: "monster-labs/control_v1p_sdxl_qrcode_monster", label: "QRCode" },
];

// ─── Color map ────────────────────────────────────────────────────────────────

function colorClass(c: ColorKey) {
  const m: Record<ColorKey, string> = {
    purple: "from-purple-500/10 to-violet-500/5 border-purple-200/50",
    blue: "from-blue-500/10 to-cyan-500/5 border-blue-200/50",
    green: "from-emerald-500/10 to-teal-500/5 border-emerald-200/50",
    orange: "from-orange-500/10 to-amber-500/5 border-orange-200/50",
    pink: "from-pink-500/10 to-rose-500/5 border-pink-200/50",
    cyan: "from-cyan-500/10 to-sky-500/5 border-cyan-200/50",
    indigo: "from-indigo-500/10 to-blue-500/5 border-indigo-200/50",
    rose: "from-rose-500/10 to-pink-500/5 border-rose-200/50",
    amber: "from-amber-500/10 to-yellow-500/5 border-amber-200/50",
    teal: "from-teal-500/10 to-cyan-500/5 border-teal-200/50",
    violet: "from-violet-500/10 to-purple-500/5 border-violet-200/50",
    slate: "from-slate-500/10 to-gray-500/5 border-slate-200/50",
    lime: "from-lime-500/10 to-green-500/5 border-lime-200/50",
    sky: "from-sky-500/10 to-blue-500/5 border-sky-200/50",
  };
  return m[c] || m.purple;
}

function tabColor(tab: StudioTab) {
  const m: Record<StudioTab, string> = {
    t2i: "from-violet-600 to-purple-700",
    edit: "from-rose-500 to-pink-600",
    upscale: "from-sky-500 to-blue-600",
    pose: "from-lime-500 to-green-600",
    sd: "from-cyan-500 to-teal-600",
    "3d": "from-orange-500 to-amber-600",
  };
  return m[tab] || m.t2i;
}

// ─── History Storage ──────────────────────────────────────────────────────────

const HISTORY_KEY = "imageStudio_history";

function loadHistory(): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 50)));
}

function addToHistory(
  item: Omit<HistoryItem, "id" | "timestamp" | "bookmarked">
) {
  const items = loadHistory();
  const newItem: HistoryItem = {
    ...item,
    id: `${Date.now()}`,
    timestamp: Date.now(),
    bookmarked: false,
  };
  items.unshift(newItem);
  saveHistory(items);
  return newItem;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function T2iQuickStartGuide({ onQuickTry }: { onQuickTry: () => void }) {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(T2I_GUIDE_KEY) === "true"
  );
  if (dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    localStorage.setItem(T2I_GUIDE_KEY, "true");
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-violet-200/50 dark:border-violet-800/40 bg-gradient-to-br from-violet-50/80 to-purple-50/60 dark:from-violet-950/30 dark:to-purple-950/20 p-4 relative"
    >
      <button
        onClick={dismiss}
        className="absolute top-2.5 right-2.5 p-1 rounded-lg hover:bg-violet-200/40 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-xl bg-violet-100 dark:bg-violet-900/40">
          <Lightbulb className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        </div>
        <p className="text-sm font-semibold text-violet-800 dark:text-violet-300">
          🌿 第一次使用？三步輕鬆開始
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { step: "1", label: "選模型", hint: "先選一個喜歡的模型" },
          { step: "2", label: "寫描述", hint: "用文字描述想要的畫面" },
          { step: "3", label: "點生成", hint: "按下按鈕等待 AI 創作" },
        ].map(s => (
          <div
            key={s.step}
            className="text-center p-2 rounded-xl bg-white/60 dark:bg-white/5 border border-violet-100/50 dark:border-violet-800/30"
          >
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-violet-500 text-white text-[10px] font-bold mb-1">
              {s.step}
            </span>
            <p className="text-[11px] font-medium text-foreground">{s.label}</p>
            <p className="text-[9px] text-muted-foreground leading-tight">
              {s.hint}
            </p>
          </div>
        ))}
      </div>
      <button
        onClick={onQuickTry}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-700 text-white text-xs font-medium shadow-sm hover:opacity-90 transition-all"
      >
        <Rocket className="w-3.5 h-3.5" /> 一鍵嘗試 — 自動填入範例馬上體驗 ✨
      </button>
    </motion.div>
  );
}

function ModelTipCard({ model }: { model: ModelInfo }) {
  const coaching = getModelCoaching(model);
  if (!coaching) return null;
  return (
    <div className="rounded-xl border border-border/30 bg-background/60 px-3 py-2.5 flex items-start gap-2">
      <HelpCircle className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
      <div className="min-w-0">
        {coaching.bestFor && (
          <p className="text-[11px] font-medium text-foreground mb-0.5">
            {coaching.bestFor}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {coaching.tip}
        </p>
        {coaching.advantages.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {coaching.advantages.map(adv => (
              <span
                key={adv}
                className="text-[10px] rounded-full border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-primary/80"
              >
                {adv}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ApiKeyBanner() {
  const q = trpc.imageStudio.checkApiKey.useQuery();
  if (q.data?.configured !== false) return null;
  return (
    <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200/60 flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium text-amber-800">
          需要設定 FAL_API_KEY
        </p>
        <p className="text-xs text-amber-700 mt-0.5">
          所有圖片生成功能均需要 fal.ai API Key
        </p>
        <a
          href="https://fal.ai/dashboard/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-amber-800 font-medium underline mt-1"
        >
          <ExternalLink className="w-3 h-3" />
          前往取得 API Key
        </a>
      </div>
    </div>
  );
}

function ResultImage({
  url,
  prompt,
  onDownload,
  onUseAsEdit,
  genMeta,
}: {
  url: string;
  prompt: string;
  onDownload: () => void;
  onUseAsEdit?: (url: string) => void;
  genMeta?: { modelName: string; duration: number; seed?: string } | null;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-2xl overflow-hidden border border-border/30 shadow-lg bg-background"
    >
      <div className="relative group">
        <img
          src={url}
          alt={prompt}
          className="w-full object-contain max-h-[400px] sm:max-h-[500px] lg:max-h-[600px]"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            className="gap-1.5"
            onClick={onDownload}
          >
            <Download className="w-3.5 h-3.5" /> 下載
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="gap-1.5"
            onClick={() => window.open(url, "_blank")}
          >
            <Eye className="w-3.5 h-3.5" /> 全尺寸
          </Button>
          {onUseAsEdit && (
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5"
              onClick={() => onUseAsEdit(url)}
            >
              <Paintbrush className="w-3.5 h-3.5" /> 編輯
            </Button>
          )}
        </div>
      </div>
      <div className="p-3">
        <p className="hs-small !mb-0 text-muted-foreground line-clamp-2">
          {prompt}
        </p>
        {genMeta && (
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5">
              <Cpu className="w-2.5 h-2.5" /> {genMeta.modelName}
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              · {genMeta.duration}s
            </span>
            {genMeta.seed && (
              <span className="text-[10px] text-muted-foreground/60">
                · seed: {genMeta.seed}
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 mt-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs h-7 gap-1"
            onClick={onDownload}
          >
            <Download className="w-3 h-3" /> 下載
          </Button>
          {onUseAsEdit && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 gap-1"
              onClick={() => onUseAsEdit(url)}
              title="送到編輯模式"
            >
              <Paintbrush className="w-3 h-3" />
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7 gap-1"
            onClick={() => {
              navigator.clipboard.writeText(url);
              toast.success("已複製圖片 URL");
            }}
          >
            <Copy className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function Model3DResult({
  glbUrl,
  extras,
}: {
  glbUrl: string | null;
  extras?: Record<string, string | null>;
}) {
  if (!glbUrl && !extras) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border/30 p-4 bg-background space-y-3"
    >
      <div className="flex items-center gap-2">
        <Box className="w-4 h-4 text-orange-500" />
        <p className="hs-small !mb-0">3D 模型已生成</p>
      </div>
      {glbUrl && (
        <div className="space-y-1.5">
          <p className="hs-small !mb-0 text-muted-foreground">GLB 主檔案</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-xs gap-1.5"
              onClick={() => window.open(glbUrl, "_blank")}
            >
              <ExternalLink className="w-3 h-3" /> 在瀏覽器開啟
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1.5"
              onClick={() => {
                navigator.clipboard.writeText(glbUrl);
                toast.success("已複製 GLB URL");
              }}
            >
              <Copy className="w-3 h-3" /> 複製 URL
            </Button>
          </div>
          <a href={glbUrl} download className="block">
            <Button
              size="sm"
              className="w-full text-xs gap-1.5 bg-orange-500 hover:bg-orange-600"
            >
              <Download className="w-3 h-3" /> 下載 GLB 檔案
            </Button>
          </a>
        </div>
      )}
      {extras &&
        Object.entries(extras)
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground capitalize">
                {k}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs h-6 gap-1"
                onClick={() => {
                  navigator.clipboard.writeText(v!);
                  toast.success(`已複製 ${k} URL`);
                }}
              >
                <Copy className="w-2.5 h-2.5" />{" "}
                {v!.split(".").pop()?.toUpperCase()}
              </Button>
            </div>
          ))}
      <p className="hs-small !mb-0 text-muted-foreground/60 text-center mt-1">
        提示：將 GLB URL 貼入 model-viewer 或 Three.js 以預覽 3D 模型
      </p>
    </motion.div>
  );
}

function PoseResult({ poseUrl, prompt }: { poseUrl: string; prompt: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-2xl overflow-hidden border border-lime-200/50 shadow-lg bg-background"
    >
      <div className="p-3 bg-lime-50/50 flex items-center gap-2 border-b border-lime-200/40">
        <Scan className="w-4 h-4 text-lime-600" />
        <p className="text-xs font-medium text-lime-800">骨骼姿勢圖</p>
      </div>
      <div className="relative group">
        <img
          src={poseUrl}
          alt="pose"
          className="w-full object-contain max-h-[350px] sm:max-h-[400px] lg:max-h-[500px]"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="gap-1.5"
            onClick={() => window.open(poseUrl, "_blank")}
          >
            <Eye className="w-3.5 h-3.5" /> 全尺寸
          </Button>
        </div>
      </div>
      <div className="p-3 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs h-7 gap-1"
          onClick={() => {
            navigator.clipboard.writeText(poseUrl);
            toast.success("已複製姿勢圖 URL");
          }}
        >
          <Copy className="w-3 h-3" /> 複製 URL（用於 ControlNet）
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-xs h-7 gap-1"
          onClick={() => window.open(poseUrl, "_blank")}
        >
          <Download className="w-3 h-3" />
        </Button>
      </div>
    </motion.div>
  );
}

function HistoryPanel({ onReuse }: { onReuse: (item: HistoryItem) => void }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [filter, setFilter] = useState<"all" | "bookmarked">("all");
  const [keyword, setKeyword] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest">("newest");

  useEffect(() => {
    setItems(loadHistory());
  }, []);

  const toggleBookmark = (id: string) => {
    const updated = items.map(i =>
      i.id === id ? { ...i, bookmarked: !i.bookmarked } : i
    );
    setItems(updated);
    saveHistory(updated);
  };
  const remove = (id: string) => {
    const updated = items.filter(i => i.id !== id);
    setItems(updated);
    saveHistory(updated);
  };
  const clearAll = () => {
    setItems([]);
    saveHistory([]);
    toast.success("已清除所有歷史");
  };
  const shown = items
    .filter(i => (filter === "bookmarked" ? i.bookmarked : true))
    .filter(i =>
      keyword.trim()
        ? `${i.prompt} ${i.modelName}`
            .toLowerCase()
            .includes(keyword.trim().toLowerCase())
        : true
    )
    .sort((a, b) =>
      sortBy === "newest" ? b.timestamp - a.timestamp : a.timestamp - b.timestamp
    );
  const bookmarkedCount = items.filter(i => i.bookmarked).length;

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border/20 space-y-2">
        <div className="rounded-lg border border-border/50 bg-background/60 px-2 py-1.5">
          <Input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="搜尋提示詞 / 模型名稱..."
            className="h-7 text-xs border-0 bg-transparent px-0 focus-visible:ring-0"
          />
        </div>
        <div className="grid grid-cols-2 gap-1">
          {(["all", "bookmarked"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs py-1.5 rounded-lg transition-colors ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
            >
              {f === "all" ? `全部（${items.length}）` : `⭐ 精選（${bookmarkedCount}）`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSortBy("newest")}
            className={`flex-1 text-[11px] py-1 rounded-md ${sortBy === "newest" ? "bg-accent text-foreground" : "text-muted-foreground"}`}
          >
            最新優先
          </button>
          <button
            onClick={() => setSortBy("oldest")}
            className={`flex-1 text-[11px] py-1 rounded-md ${sortBy === "oldest" ? "bg-accent text-foreground" : "text-muted-foreground"}`}
          >
            最舊優先
          </button>
          <button
            onClick={clearAll}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="清除全部"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {!shown.length && (
          <div className="text-center py-8">
            <History className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="hs-small !mb-0 text-muted-foreground">
              {keyword.trim() ? "沒有符合搜尋條件的紀錄" : filter === "bookmarked" ? "尚無精選" : "尚無生成歷史"}
            </p>
          </div>
        )}
        {shown.map(item => (
          <div
            key={item.id}
            className="rounded-xl border border-border/30 overflow-hidden bg-background/50"
          >
            <div className="relative">
              <img
                src={item.imageUrl}
                alt={item.prompt}
                className="w-full h-28 object-cover"
                loading="lazy"
              />
              <div className="absolute top-1 right-1 flex gap-1">
                <button
                  onClick={() => toggleBookmark(item.id)}
                  className="p-1 rounded-md bg-black/50 text-white hover:bg-black/70 transition-colors"
                >
                  {item.bookmarked ? (
                    <BookmarkCheck className="w-3 h-3 text-amber-400" />
                  ) : (
                    <Bookmark className="w-3 h-3" />
                  )}
                </button>
                <button
                  onClick={() => remove(item.id)}
                  className="p-1 rounded-md bg-black/50 text-white hover:bg-red-500/70 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="p-2">
              <p className="hs-small !mb-0 text-muted-foreground line-clamp-2 mb-1.5">
                {item.prompt}
              </p>
              <div className="flex items-center justify-between gap-1">
                <Badge variant="secondary" className="text-[9px] px-1 py-0 truncate max-w-[55%]">
                  {item.modelName}
                </Badge>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {new Date(item.timestamp).toLocaleString("zh-TW", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[10px] px-1.5 gap-1"
                  onClick={() => {
                    navigator.clipboard.writeText(item.prompt);
                    toast.success("已複製提示詞");
                  }}
                >
                  <Copy className="w-2.5 h-2.5" /> 複製
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[10px] px-1.5 gap-1"
                  onClick={() => onReuse(item)}
                >
                  <RefreshCw className="w-2.5 h-2.5" /> 重用
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VibeSelector({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(
      selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]
    );
  return (
    <div className="flex flex-wrap gap-1.5">
      {VIBE_CARDS.map(v => {
        const active = selected.includes(v.id);
        return (
          <button
            key={v.id}
            onClick={() => toggle(v.id)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-medium border transition-all ${
              active
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-background hover:bg-accent border-border text-muted-foreground"
            }`}
          >
            <span>{v.emoji}</span>
            <span>{v.labelZh}</span>
            {active && <Check className="w-2.5 h-2.5 ml-0.5" />}
          </button>
        );
      })}
    </div>
  );
}

function PromptBuilder({
  value,
  onChange,
  vibeIds,
  onVibeChange,
}: {
  value: string;
  onChange: (v: string) => void;
  vibeIds: string[];
  onVibeChange: (ids: string[]) => void;
}) {
  const [showBuilder, setShowBuilder] = useState(false);
  const [blocks, setBlocks] = useState<Record<string, string>>({});

  const buildPrompt = () => {
    const parts = [
      blocks.subject,
      blocks.style,
      blocks.lighting,
      blocks.mood && `${blocks.mood}風格`,
      blocks.detail,
      ...vibeIds
        .map(id => VIBE_CARDS.find(v => v.id === id)?.keywords)
        .filter(Boolean),
    ].filter(Boolean);
    onChange(parts.join(", "));
    toast.success("提示詞已建構完成");
  };

  const appendVibeKeywords = () => {
    if (!vibeIds.length) {
      toast.info("請先選擇氛圍風格");
      return;
    }
    const kw = vibeIds
      .map(id => VIBE_CARDS.find(v => v.id === id)?.keywords)
      .filter(Boolean)
      .join(", ");
    onChange(value ? `${value}, ${kw}` : kw);
    toast.success("已加入氛圍關鍵字");
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <Label className="text-xs font-medium text-muted-foreground">
            提示詞 <span className="text-destructive ml-0.5">*</span>
          </Label>
          <div className="flex gap-1">
            {PROMPT_TEMPLATES.slice(0, 3).map((t, i) => (
              <button
                key={i}
                onClick={() => onChange(t.text)}
                className="text-[10px] px-2 py-0.5 rounded-md bg-muted/40 hover:bg-muted/60 text-muted-foreground border border-border/40 transition-colors"
              >
                {t.title.slice(0, 5)}
              </button>
            ))}
          </div>
        </div>
        <Textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="描述你想生成的圖片（支援中英文）..."
          className="resize-none min-h-[6rem] text-sm"
        />
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-muted-foreground/60">
            {value.length} 字元
          </span>
          <div className="flex gap-2">
            {value && (
              <button
                onClick={() => onChange("")}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                清除
              </button>
            )}
            <button
              onClick={appendVibeKeywords}
              className="text-[10px] text-primary hover:text-primary/80"
            >
              + 加入氛圍
            </button>
          </div>
        </div>
      </div>

      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          氛圍風格（選填）
        </Label>
        <VibeSelector selected={vibeIds} onChange={onVibeChange} />
      </div>

      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          快速範例
        </Label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {PROMPT_TEMPLATES.map((t, i) => (
            <button
              key={i}
              onClick={() => onChange(t.text)}
              className="text-left p-2 rounded-xl border border-border/40 hover:border-primary/40 hover:bg-primary/5 transition-all"
            >
              <p className="text-[11px] font-medium">{t.title}</p>
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => setShowBuilder(!showBuilder)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full p-2 rounded-lg hover:bg-accent/30"
      >
        <SlidersHorizontal className="w-3.5 h-3.5" /> 進階提示詞建構器
        {showBuilder ? (
          <ChevronUp className="w-3 h-3 ml-auto" />
        ) : (
          <ChevronDown className="w-3 h-3 ml-auto" />
        )}
      </button>

      <AnimatePresence>
        {showBuilder && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 rounded-xl bg-muted/20 border border-border/30 space-y-3">
              <p className="text-[11px] text-muted-foreground font-medium">
                🧩 積木式提示詞建構器
              </p>
              {(
                Object.entries(PROMPT_BUILDER_BLOCKS) as [string, string[]][]
              ).map(([key, options]) => (
                <div key={key}>
                  <Label className="text-[10px] text-muted-foreground capitalize mb-1 block">
                    {{
                      subject: "主體",
                      style: "風格",
                      lighting: "光線",
                      mood: "情緒",
                      detail: "細節",
                    }[key] ?? key}
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {options.map(opt => (
                      <button
                        key={opt}
                        onClick={() =>
                          setBlocks(prev => ({
                            ...prev,
                            [key]: prev[key] === opt ? "" : opt,
                          }))
                        }
                        className={`text-[10px] px-2 py-1 rounded-lg border transition-all ${
                          blocks[key] === opt
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border/50 text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs gap-1.5"
                onClick={buildPrompt}
              >
                <Sparkles className="w-3.5 h-3.5" /> 一鍵生成提示詞
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RefImageInput({
  label,
  value,
  onChange,
  onClear,
  multiple = false,
  extraUrls = [],
  onExtraUrlsChange,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
  multiple?: boolean;
  extraUrls?: string[];
  onExtraUrlsChange?: (urls: string[]) => void;
  required?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleUpload = useCallback(
    async (file: File) => {
      if (file.size > 16 * 1024 * 1024) {
        toast.error("圖片不能超過 16MB");
        return;
      }
      setUploading(true);
      try {
        const { url } = await uploadFileToS3(file);
        onChange(url);
        toast.success("✅ 圖片已上傳");
      } catch (e: any) {
        toast.error("上傳失敗：" + (e.message || "未知錯誤"));
      } finally {
        setUploading(false);
      }
    },
    [onChange]
  );

  const handleFileSelect = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleUpload(file);
    };
    input.click();
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith("image/")) handleUpload(file);
      const url = e.dataTransfer.getData("text/plain");
      if (url && !file) onChange(url);
    },
    [handleUpload, onChange]
  );

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <div
        className={`relative rounded-xl border transition-all ${isDragOver ? "border-primary/50 bg-primary/5 scale-[1.01]" : "border-border/40"}`}
        onDragOver={e => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="flex items-center gap-1 p-1">
          <Input
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder="貼上圖片 URL 或點擊上傳（PNG/JPG/WebP）"
            className="border-0 shadow-none focus-visible:ring-0 flex-1 text-sm pr-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleFileSelect}
            disabled={uploading}
            title="上傳圖片"
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onClear}
              title="清除"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        {value && (
          <div className="px-2 pb-2">
            <div className="rounded-xl overflow-hidden border border-border/30">
              <img
                src={value}
                alt="reference"
                className="w-full max-h-40 object-cover"
                loading="lazy"
                onError={() => onChange("")}
              />
            </div>
          </div>
        )}
        {!value && (
          <div className="px-2 pb-2">
            <button
              onClick={handleFileSelect}
              className="w-full py-4 rounded-xl border border-dashed border-border/40 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors flex items-center justify-center gap-2"
            >
              <Upload className="w-3.5 h-3.5" />
              點擊或拖放圖片上傳（最大 16MB）
            </button>
          </div>
        )}
      </div>
      {multiple && onExtraUrlsChange && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground">
            額外參考圖（最多 13 張，選填）
          </p>
          {extraUrls.map((url, i) => (
            <div key={i} className="flex gap-1.5">
              <Input
                value={url}
                onChange={e => {
                  const next = [...extraUrls];
                  next[i] = e.target.value;
                  onExtraUrlsChange(next);
                }}
                placeholder={`參考圖 ${i + 2}`}
                className="text-xs flex-1"
              />
              <button
                onClick={() =>
                  onExtraUrlsChange(extraUrls.filter((_, j) => j !== i))
                }
                className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {extraUrls.length < 13 && (
            <button
              onClick={() => onExtraUrlsChange([...extraUrls, ""])}
              className="w-full text-xs py-1.5 rounded-xl border border-dashed border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors flex items-center justify-center gap-1.5"
            >
              <Plus className="w-3 h-3" /> 新增參考圖
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Special Panels per Tab ───────────────────────────────────────────────────

function UpscalePanel({
  imageUrl,
  setImageUrl,
  upscaleMode,
  setUpscaleMode,
  upscaleFactor,
  setUpscaleFactor,
  targetRes,
  setTargetRes,
}: {
  imageUrl: string;
  setImageUrl: (v: string) => void;
  upscaleMode: "factor" | "target";
  setUpscaleMode: (v: "factor" | "target") => void;
  upscaleFactor: number;
  setUpscaleFactor: (v: number) => void;
  targetRes: string;
  setTargetRes: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <RefImageInput
        label="原始圖片"
        value={imageUrl}
        onChange={setImageUrl}
        onClear={() => setImageUrl("")}
      />
      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-2 block">
          放大模式
        </Label>
        <div className="flex gap-2">
          {(["factor", "target"] as const).map(m => (
            <button
              key={m}
              onClick={() => setUpscaleMode(m)}
              className={`flex-1 py-2 rounded-xl border text-xs font-medium transition-all ${upscaleMode === m ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}
            >
              {m === "factor" ? "📐 倍數放大" : "🎯 目標解析度"}
            </button>
          ))}
        </div>
      </div>
      {upscaleMode === "factor" ? (
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">
            放大倍數：×{upscaleFactor}
          </Label>
          <Slider
            value={[upscaleFactor]}
            onValueChange={([v]) => setUpscaleFactor(v)}
            min={1}
            max={4}
            step={1}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1">
            <span>×1</span>
            <span>×2</span>
            <span>×3</span>
            <span>×4</span>
          </div>
        </div>
      ) : (
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">
            目標解析度
          </Label>
          <div className="grid grid-cols-4 gap-1.5">
            {(["720p", "1080p", "1440p", "2160p"] as const).map(r => (
              <button
                key={r}
                onClick={() => setTargetRes(r)}
                className={`py-2 rounded-xl border text-[11px] font-semibold transition-all ${targetRes === r ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PosePanel({
  imageUrl,
  setImageUrl,
  drawMode,
  setDrawMode,
}: {
  imageUrl: string;
  setImageUrl: (v: string) => void;
  drawMode: string;
  setDrawMode: (v: string) => void;
}) {
  const modes = [
    { value: "full-pose", label: "完整姿勢", emoji: "🧍" },
    { value: "body-pose", label: "身體", emoji: "💪" },
    { value: "face-pose", label: "臉部", emoji: "😊" },
    { value: "hand-pose", label: "手部", emoji: "✋" },
    { value: "face-hand-mask", label: "臉+手遮罩", emoji: "🎭" },
    { value: "face-mask", label: "臉遮罩", emoji: "😷" },
    { value: "hand-mask", label: "手遮罩", emoji: "🤚" },
  ];
  return (
    <div className="space-y-4">
      <RefImageInput
        label="人物圖片"
        value={imageUrl}
        onChange={setImageUrl}
        onClear={() => setImageUrl("")}
      />
      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-2 block">
          偵測模式
        </Label>
        <div className="grid grid-cols-2 gap-1.5">
          {modes.map(m => (
            <button
              key={m.value}
              onClick={() => setDrawMode(m.value)}
              className={`p-2.5 rounded-xl border text-left text-[11px] transition-all ${drawMode === m.value ? "bg-lime-500/10 border-lime-400/50 text-lime-700 font-medium" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}
            >
              <span className="mr-1">{m.emoji}</span>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-xl bg-lime-50/50 border border-lime-200/40 p-3 text-xs text-lime-700">
        💡 生成的骨骼圖可複製 URL，直接貼入 SD ControlNet（OpenPose 模式）使用
      </div>
    </div>
  );
}

function SDPanel({
  imageSize,
  setImageSize,
  negPrompt,
  setNegPrompt,
  guidance,
  setGuidance,
  inferSteps,
  setInferSteps,
  seed,
  setSeed,
  loraPath,
  setLoraPath,
  loraScale,
  setLoraScale,
  controlnetImageUrl,
  setControlnetImageUrl,
  controlnetPath,
  setControlnetPath,
  controlnetScale,
  setControlnetScale,
  modelId,
}: {
  imageSize: string;
  setImageSize: (v: string) => void;
  negPrompt: string;
  setNegPrompt: (v: string) => void;
  guidance: number;
  setGuidance: (v: number) => void;
  inferSteps: number;
  setInferSteps: (v: number) => void;
  seed: string;
  setSeed: (v: string) => void;
  loraPath: string;
  setLoraPath: (v: string) => void;
  loraScale: number;
  setLoraScale: (v: number) => void;
  controlnetImageUrl: string;
  setControlnetImageUrl: (v: string) => void;
  controlnetPath: string;
  setControlnetPath: (v: string) => void;
  controlnetScale: number;
  setControlnetScale: (v: number) => void;
  modelId: string;
}) {
  const [showAdv, setShowAdv] = useState(false);

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          圖片尺寸
        </Label>
        <div className="grid grid-cols-3 gap-1.5">
          {IMAGE_SIZES.map(s => (
            <button
              key={s.value}
              onClick={() => setImageSize(s.value)}
              className={`py-2 px-1 rounded-xl border text-[10px] font-medium transition-all ${imageSize === s.value ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">
          負向提示詞
        </Label>
        <Textarea
          value={negPrompt}
          onChange={e => setNegPrompt(e.target.value)}
          placeholder="描述不想出現的元素（模糊、變形、低品質...）"
          className="resize-none h-16 text-xs"
        />
      </div>

      <button
        onClick={() => setShowAdv(!showAdv)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground w-full py-1"
      >
        <Settings2 className="w-3.5 h-3.5" /> 進階設定
        {showAdv ? (
          <ChevronUp className="w-3 h-3 ml-auto" />
        ) : (
          <ChevronDown className="w-3 h-3 ml-auto" />
        )}
      </button>

      <AnimatePresence>
        {showAdv && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 pt-1">
              {modelId !== "fastSdxl" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    引導強度：{guidance.toFixed(1)}
                  </Label>
                  <Slider
                    value={[guidance]}
                    onValueChange={([v]) => setGuidance(v)}
                    min={1}
                    max={20}
                    step={0.5}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  推理步數：{inferSteps}
                </Label>
                <Slider
                  value={[inferSteps]}
                  onValueChange={([v]) => setInferSteps(v)}
                  min={10}
                  max={50}
                  step={1}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  種子碼（Seed）
                </Label>
                <Input
                  value={seed}
                  onChange={e => setSeed(e.target.value)}
                  placeholder="留空隨機"
                  className="text-sm"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">
                  LoRA 路徑（HuggingFace）
                </Label>
                <Input
                  value={loraPath}
                  onChange={e => setLoraPath(e.target.value)}
                  placeholder="例：nerijs/pixel-art-xl"
                  className="text-xs mb-1.5"
                />
                {loraPath && (
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">
                      LoRA 強度：{loraScale.toFixed(1)}
                    </Label>
                    <Slider
                      value={[loraScale]}
                      onValueChange={([v]) => setLoraScale(v)}
                      min={0}
                      max={2}
                      step={0.1}
                    />
                  </div>
                )}
              </div>
              {modelId === "stableDiffusion35" && (
                <div className="space-y-2 p-3 rounded-xl bg-cyan-50/50 border border-cyan-200/40">
                  <p className="text-[11px] font-medium text-cyan-700 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" /> ControlNet 設定
                  </p>
                  <div>
                    <Label className="text-[10px] text-muted-foreground mb-1 block">
                      控制圖片 URL
                    </Label>
                    <Input
                      value={controlnetImageUrl}
                      onChange={e => setControlnetImageUrl(e.target.value)}
                      placeholder="貼上骨骼圖/深度圖/邊緣圖 URL"
                      className="text-xs"
                    />
                  </div>
                  {controlnetImageUrl && (
                    <>
                      <div>
                        <Label className="text-[10px] text-muted-foreground mb-1 block">
                          ControlNet 模式
                        </Label>
                        <Select
                          value={controlnetPath}
                          onValueChange={setControlnetPath}
                        >
                          <SelectTrigger className="text-xs h-8">
                            <SelectValue placeholder="選擇控制模式" />
                          </SelectTrigger>
                          <SelectContent>
                            {CONTROLNET_PATHS.map(p => (
                              <SelectItem key={p.value} value={p.value}>
                                {p.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">
                          控制強度：{controlnetScale.toFixed(1)}
                        </Label>
                        <Slider
                          value={[controlnetScale]}
                          onValueChange={([v]) => setControlnetScale(v)}
                          min={0}
                          max={2}
                          step={0.1}
                        />
                      </div>
                    </>
                  )}
                  <p className="text-[10px] text-cyan-600/80">
                    💡 可將 DWPose 骨骼圖 URL 直接貼入此處
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ThreeDPanel({
  imageUrl,
  setImageUrl,
  prompt3d,
  setPrompt3d,
  modelId,
  // Trellis
  trellisResolution,
  setTrellisResolution,
  trellisTextureSize,
  setTrellisTextureSize,
  // SAM3D
  samPrompt,
  setSamPrompt,
  // Hunyuan3D
  enablePbr,
  setEnablePbr,
  hunyuanGenType,
  setHunyuanGenType,
  // Rodin
  rodinQuality,
  setRodinQuality,
  rodinMaterial,
  setRodinMaterial,
  // HunyuanWorld
  labelsFg1,
  setLabelsFg1,
  labelsFg2,
  setLabelsFg2,
  worldClasses,
  setWorldClasses,
}: {
  imageUrl: string;
  setImageUrl: (v: string) => void;
  prompt3d: string;
  setPrompt3d: (v: string) => void;
  modelId: string;
  trellisResolution: string;
  setTrellisResolution: (v: string) => void;
  trellisTextureSize: string;
  setTrellisTextureSize: (v: string) => void;
  samPrompt: string;
  setSamPrompt: (v: string) => void;
  enablePbr: boolean;
  setEnablePbr: (v: boolean) => void;
  hunyuanGenType: "Normal" | "LowPoly" | "Geometry";
  setHunyuanGenType: (v: "Normal" | "LowPoly" | "Geometry") => void;
  rodinQuality: "high" | "medium" | "low" | "extra-low";
  setRodinQuality: (v: "high" | "medium" | "low" | "extra-low") => void;
  rodinMaterial: "PBR" | "Shaded";
  setRodinMaterial: (v: "PBR" | "Shaded") => void;
  labelsFg1: string;
  setLabelsFg1: (v: string) => void;
  labelsFg2: string;
  setLabelsFg2: (v: string) => void;
  worldClasses: string;
  setWorldClasses: (v: string) => void;
}) {
  const needsImage = [
    "trellis2",
    "sam3dObjects",
    "hunyuan3d",
    "hunyuanWorld",
  ].includes(modelId);
  const needsPrompt = ["rodin3d"].includes(modelId);
  const needsImageOrPrompt = ["rodin3d"].includes(modelId);

  return (
    <div className="space-y-4">
      {needsImage && (
        <RefImageInput
          label="來源圖片"
          value={imageUrl}
          onChange={setImageUrl}
          onClear={() => setImageUrl("")}
        />
      )}

      {needsImageOrPrompt && (
        <div className="space-y-2">
          <RefImageInput
            label="參考圖片（選填）"
            value={imageUrl}
            onChange={setImageUrl}
            onClear={() => setImageUrl("")}
          />
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">
              文字描述（選填，可與圖片並用）
            </Label>
            <Textarea
              value={prompt3d}
              onChange={e => setPrompt3d(e.target.value)}
              placeholder="描述 3D 模型，例：a futuristic robot with metallic design"
              className="resize-none h-16 text-xs"
            />
          </div>
        </div>
      )}

      {/* Trellis 專屬 */}
      {modelId === "trellis2" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">
              解析度
            </Label>
            <div className="flex gap-1">
              {["512", "1024", "1536"].map(r => (
                <button
                  key={r}
                  onClick={() => setTrellisResolution(r)}
                  className={`flex-1 py-1.5 rounded-lg border text-[10px] font-semibold transition-all ${trellisResolution === r ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">
              紋理尺寸
            </Label>
            <div className="flex gap-1">
              {["1024", "2048", "4096"].map(r => (
                <button
                  key={r}
                  onClick={() => setTrellisTextureSize(r)}
                  className={`flex-1 py-1.5 rounded-lg border text-[10px] font-semibold transition-all ${trellisTextureSize === r ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SAM3D 專屬 */}
      {modelId === "sam3dObjects" && (
        <div>
          <Label className="text-xs text-muted-foreground mb-1 block">
            偵測目標描述
          </Label>
          <Input
            value={samPrompt}
            onChange={e => setSamPrompt(e.target.value)}
            placeholder="例：car, dog, bottle..."
            className="text-sm"
          />
        </div>
      )}

      {/* Hunyuan3D 專屬 */}
      {modelId === "hunyuan3d" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">
              啟用 PBR 材質
            </Label>
            <Switch checked={enablePbr} onCheckedChange={setEnablePbr} />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">
              生成類型
            </Label>
            <div className="flex gap-1.5">
              {(["Normal", "LowPoly", "Geometry"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setHunyuanGenType(t)}
                  className={`flex-1 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${hunyuanGenType === t ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Rodin 專屬 */}
      {modelId === "rodin3d" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">
              材質
            </Label>
            <div className="flex gap-1">
              {(["PBR", "Shaded"] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setRodinMaterial(m)}
                  className={`flex-1 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${rodinMaterial === m ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">
              品質
            </Label>
            <Select
              value={rodinQuality}
              onValueChange={v => setRodinQuality(v as any)}
            >
              <SelectTrigger className="text-xs h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["high", "medium", "low", "extra-low"] as const).map(q => (
                  <SelectItem key={q} value={q}>
                    {q}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* HunyuanWorld 專屬 */}
      {modelId === "hunyuanWorld" && (
        <div className="space-y-2">
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">
              前景物件描述 (labels_fg1)
            </Label>
            <Input
              value={labelsFg1}
              onChange={e => setLabelsFg1(e.target.value)}
              placeholder="前景主要物件，例：person, car"
              className="text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">
              前景元素描述 (labels_fg2)
            </Label>
            <Input
              value={labelsFg2}
              onChange={e => setLabelsFg2(e.target.value)}
              placeholder="前景次要元素，例：tree, bench"
              className="text-xs"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">
              場景類別 (classes)
            </Label>
            <Input
              value={worldClasses}
              onChange={e => setWorldClasses(e.target.value)}
              placeholder="場景類型，例：outdoor, urban"
              className="text-xs"
            />
          </div>
        </div>
      )}

      <div className="rounded-xl bg-orange-50/50 border border-orange-200/40 p-3 text-xs text-orange-700">
        ⏱️ 3D 模型生成需要 1–5 分鐘，請耐心等候
      </div>
    </div>
  );
}

/** Compact results preview shown at top of mobile when results exist */
function MobileResultsPreview({
  resultImages,
  result3d,
  resultPose,
  prompt,
  viewMode,
  setViewMode,
  downloadImage,
  onUseAsEdit,
  lastGenMeta,
  poseImageUrl,
}: {
  resultImages: string[];
  result3d: { glbUrl: string | null; extras?: Record<string, string | null> } | null;
  resultPose: string | null;
  prompt: string;
  viewMode: "single" | "grid";
  setViewMode: (v: "single" | "grid") => void;
  downloadImage: (url: string) => void;
  onUseAsEdit: (url: string) => void;
  lastGenMeta: { modelName: string; duration: number; seed?: string } | null;
  poseImageUrl: string;
}) {
  return (
    <div className="rounded-2xl border border-border/20 bg-muted/20 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/20 bg-background/80">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <ImagePlus className="w-3.5 h-3.5" />
          生成結果
          {resultImages.length > 0 && (
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 ml-1">
              {resultImages.length} 張
            </Badge>
          )}
        </p>
        {resultImages.length > 1 && (
          <button
            onClick={() => setViewMode(viewMode === "single" ? "grid" : "single")}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"
          >
            {viewMode === "single" ? (
              <Grid3x3 className="w-3.5 h-3.5" />
            ) : (
              <Image className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>
      <div className="p-3">
        {resultImages.length > 0 && (
          <div className={viewMode === "grid" && resultImages.length > 1 ? "grid grid-cols-2 gap-2" : "space-y-2"}>
            {resultImages.map((url) => (
              <ResultImage
                key={url}
                url={url}
                prompt={prompt}
                onDownload={() => downloadImage(url)}
                onUseAsEdit={onUseAsEdit}
                genMeta={lastGenMeta}
              />
            ))}
          </div>
        )}
        {result3d && (
          <Model3DResult glbUrl={result3d.glbUrl} extras={result3d.extras} />
        )}
        {resultPose && (
          <PoseResult poseUrl={resultPose} prompt={poseImageUrl} />
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ImageStudio() {
  // 全站新手引導
  usePageTour("image-studio");
  const registerBgTask = useRegisterBgTask();

  // ── AI Agent Integration ──
  const {
    aiState,
    setAIState,
    reportSuccess,
    reportFailure,
    setPageContext,
    personality,
  } = useAIState();

  // ── Tab / Model ──
  const [activeTab, setActiveTab] = useState<StudioTab>("t2i");
  const [selectedModelId, setSelectedModelId] = useState("nanoBanana2");

  // ── Common ──
  const [prompt, setPrompt] = useState("");
  const [vibeIds, setVibeIds] = useState<string[]>([]);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [numImages, setNumImages] = useState(1);
  const [seed, setSeed] = useState("");

  // ── Edit ──
  const [refImageUrl, setRefImageUrl] = useState("");
  const [extraRefUrls, setExtraRefUrls] = useState<string[]>([]);
  const [maskUrl, setMaskUrl] = useState("");
  const [strength, setStrength] = useState(0.8);
  const [guidance, setGuidance] = useState(3.5);
  const [inferSteps, setInferSteps] = useState(28);
  const [outputSize, setOutputSize] = useState("auto");

  // ── Upscale ──
  const [upscaleImageUrl, setUpscaleImageUrl] = useState("");
  const [upscaleMode, setUpscaleMode] = useState<"factor" | "target">("factor");
  const [upscaleFactor, setUpscaleFactor] = useState(2);
  const [targetRes, setTargetRes] = useState("1080p");

  // ── Pose ──
  const [poseImageUrl, setPoseImageUrl] = useState("");
  const [drawMode, setDrawMode] = useState("body-pose");

  // ── SD ──
  const [sdImageSize, setSdImageSize] = useState("landscape_4_3");
  const [negPrompt, setNegPrompt] = useState("");
  const [sdGuidance, setSdGuidance] = useState(3.5);
  const [sdInferSteps, setSdInferSteps] = useState(28);
  const [sdSeed, setSdSeed] = useState("");
  const [loraPath, setLoraPath] = useState("");
  const [loraScale, setLoraScale] = useState(1.0);
  const [controlnetImageUrl, setControlnetImageUrl] = useState("");
  const [controlnetPath, setControlnetPath] = useState(
    "diffusers/controlnet-canny-sdxl-1.0"
  );
  const [controlnetScale, setControlnetScale] = useState(1.0);

  // ── 3D ──
  const [imageUrl3d, setImageUrl3d] = useState("");
  const [prompt3d, setPrompt3d] = useState("");
  const [trellisResolution, setTrellisResolution] = useState("1024");
  const [trellisTextureSize, setTrellisTextureSize] = useState("2048");
  const [samPrompt, setSamPrompt] = useState("object");
  const [enablePbr, setEnablePbr] = useState(true);
  const [hunyuanGenType, setHunyuanGenType] = useState<
    "Normal" | "LowPoly" | "Geometry"
  >("Normal");
  const [rodinQuality, setRodinQuality] = useState<
    "high" | "medium" | "low" | "extra-low"
  >("medium");
  const [rodinMaterial, setRodinMaterial] = useState<"PBR" | "Shaded">("PBR");
  const [labelsFg1, setLabelsFg1] = useState("foreground objects");
  const [labelsFg2, setLabelsFg2] = useState("background elements");
  const [worldClasses, setWorldClasses] = useState("general scene");

  // ── Results ──
  const [resultImages, setResultImages] = useState<string[]>([]);
  const [result3d, setResult3d] = useState<{
    glbUrl: string | null;
    extras?: Record<string, string | null>;
  } | null>(null);
  const [resultPose, setResultPose] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastGenMeta, setLastGenMeta] = useState<{
    modelName: string;
    duration: number;
    seed?: string;
  } | null>(null);
  const genStartRef = useRef<number>(0);

  // ── Applied Fine-tuned Model from ModelsPage ──
  const [appliedModelName, setAppliedModelName] = useState<string | null>(null);
  const [appliedTriggerWord, setAppliedTriggerWord] = useState<string | null>(
    null
  );

  // ── UI ──
  const [showHistory, setShowHistory] = useState(false);
  const [viewMode, setViewMode] = useState<"single" | "grid">("single");
  const [showSettings, setShowSettings] = useState(true);
  const [showAdvancedT2i, setShowAdvancedT2i] = useState(false);

  const model = MODELS.find(m => m.id === selectedModelId) ?? MODELS[0];
  const tabModels = MODELS.filter(m => m.category === activeTab);

  /** Quick-try: fill in a sample prompt so newcomers can experience generation immediately */
  const handleQuickTry = useCallback(() => {
    setActiveTab("t2i");
    setSelectedModelId("seedreamV4"); // Chinese-friendly model for the Chinese sample prompt
    setPrompt(QUICK_TRY_PROMPT);
    setVibeIds(["watercolor"]);
    toast.success("🌿 已填入範例，按下「開始生成」即可體驗！");
  }, []);

  // ── AI Agent: broadcast page context so the orb knows where user is ──
  useEffect(() => {
    setPageContext({
      pageId: "image-studio",
      pageLabel: "圖片創作室",
      activeModel: model.name,
      activeTab,
    });
    return () => setPageContext(null);
  }, [model.name, activeTab, setPageContext]);

  // Auto-select first model when switching tabs
  useEffect(() => {
    const first = tabModels[0];
    if (first && !tabModels.find(m => m.id === selectedModelId)) {
      setSelectedModelId(first.id);
    }
  }, [activeTab]);

  // ── Restore applied model from ModelsPage (via sessionStorage) ──
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("applyModel");
      if (raw) {
        const modelData = JSON.parse(raw);
        if (modelData?.name) {
          setAppliedModelName(modelData.name);
          setAppliedTriggerWord(modelData.triggerWord || null);
          // Auto-inject trigger word into prompt
          if (modelData.triggerWord && modelData.triggerWord.trim()) {
            setPrompt(prev => {
              if (prev.includes(modelData.triggerWord)) return prev;
              return prev
                ? `${modelData.triggerWord}, ${prev}`
                : modelData.triggerWord;
            });
            setLoraPath(modelData.loraUrl || "");
          }
          toast.success(
            `已套用角色模型「${modelData.name}」，觸發詞已自動加入提示詞`
          );
          sessionStorage.removeItem("applyModel");
        }
      }
    } catch {
      // silent
    }
  }, []);

  // ── Restore Director AI sendToStudio payload (image path) ──
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("sendToStudio");
      if (!raw) return;
      const data = JSON.parse(raw) as {
        prompt?: string;
        generationType?: string;
        overrideEngine?: string;
        source?: string;
        sceneName?: string;
      };
      if (data.generationType !== "image") return;

      if (typeof data.prompt === "string" && data.prompt.trim()) {
        setPrompt(data.prompt);
      }

      if (data.overrideEngine) {
        const canonical = normalizeEngineModelId(data.overrideEngine);
        const matched = MODELS.find(m => m.falId === canonical);
        if (matched) {
          setActiveTab(matched.category);
          setSelectedModelId(matched.id);
        }
      }

      sessionStorage.removeItem("sendToStudio");
      toast.success(
        data.source === "director_ai" && data.sceneName
          ? `已從導演 AI 載入「${data.sceneName}」到圖片創作室`
          : "已載入導演 AI 設定到圖片創作室"
      );
    } catch {
      // silent
    }
  }, []);

  // ── Ctrl+Enter keyboard shortcut for generation ──
  const handleGenerateRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !isGenerating) {
        e.preventDefault();
        handleGenerateRef.current?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isGenerating]);

  // ── tRPC mutations ──
  const mutations = {
    // T2I
    nanoBanana2: trpc.imageStudio.nanoBanana2.useMutation(),
    nanoBananaPro: trpc.imageStudio.nanoBananaPro.useMutation(),
    seedreamV4: trpc.imageStudio.seedreamV4.useMutation(),
    imagen4: trpc.imageStudio.imagen4.useMutation(),
    // Edit
    nanoBananaProEdit: trpc.imageStudio.nanoBananaProEdit.useMutation(),
    nanoBananaEdit: trpc.imageStudio.nanoBananaEdit.useMutation(),
    nanoBanana2Edit: trpc.imageStudio.nanoBanana2Edit.useMutation(),
    seedreamV45Edit: trpc.imageStudio.seedreamV45Edit.useMutation(),
    seedreamV5LiteEdit: trpc.imageStudio.seedreamV5LiteEdit.useMutation(),
    grokEdit: trpc.imageStudio.grokEdit.useMutation(),
    gptImage15Edit: trpc.imageStudio.gptImage15Edit.useMutation(),
    fluxKontext: trpc.imageStudio.fluxKontext.useMutation(),
    flux2ProEdit: trpc.imageStudio.flux2ProEdit.useMutation(),
    // Upscale
    seedVRUpscale: trpc.imageStudio.seedVRUpscale.useMutation(),
    // Pose
    dwPose: trpc.imageStudio.dwPose.useMutation(),
    // SD
    stableDiffusion35: trpc.imageStudio.stableDiffusion35.useMutation(),
    fastSdxl: trpc.imageStudio.fastSdxl.useMutation(),
    sdLora: trpc.imageStudio.sdLora.useMutation(),
    // 3D
    trellis2: trpc.imageStudio.trellis2.useMutation(),
    sam3dObjects: trpc.imageStudio.sam3dObjects.useMutation(),
    hunyuan3d: trpc.imageStudio.hunyuan3d.useMutation(),
    rodin3d: trpc.imageStudio.rodin3d.useMutation(),
    hunyuanWorld: trpc.imageStudio.hunyuanWorld.useMutation(),
  } as const;

  const currentMutation = mutations[model.id as keyof typeof mutations] as any;

  const downloadImage = async (url: string) => {
    try {
      // Use server proxy to bypass CORS restrictions on CDN URLs
      const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(url)}`;
      const resp = await fetch(proxyUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const ext = blob.type.includes("png")
        ? "png"
        : blob.type.includes("webp")
          ? "webp"
          : "jpg";
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `ai-image-${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
      toast.success("圖片已下載");
    } catch {
      // Fallback: open in new tab
      window.open(url, "_blank");
      toast.info("已在新分頁開啟圖片");
    }
  };

  const persistGeneratedImageUrl = useCallback(async (url: string) => {
    if (!/^https?:\/\//i.test(url)) return url;
    if (typeof window !== "undefined" && url.includes(window.location.host)) {
      return url;
    }

    const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(url)}`;
    const resp = await fetch(proxyUrl);
    if (!resp.ok) throw new Error(`下載生成檔案失敗 (HTTP ${resp.status})`);

    const blob = await resp.blob();
    const mimeType = blob.type || "image/png";
    const ext = mimeType.includes("png")
      ? "png"
      : mimeType.includes("webp")
        ? "webp"
        : mimeType.includes("gif")
          ? "gif"
          : "jpg";

    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      for (let j = 0; j < chunk.length; j += 1) {
        binary += String.fromCharCode(chunk[j]);
      }
    }
    const data = btoa(binary);

    const uploadResp = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        fileName: `image-studio-${Date.now()}.${ext}`,
        mimeType,
        data,
      }),
    });
    if (!uploadResp.ok) {
      const err = await uploadResp.json().catch(() => ({}));
      throw new Error(err?.error || `上傳內部儲存失敗 (HTTP ${uploadResp.status})`);
    }
    const payload = (await uploadResp.json()) as { url?: string };
    if (!payload.url) throw new Error("上傳完成但未取得內部 URL");
    return payload.url;
  }, []);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setAIState("generating");
    setResultImages([]);
    setResult3d(null);
    setResultPose(null);
    setLastGenMeta(null);
    genStartRef.current = Date.now();

    const vibeKw = vibeIds
      .map(id => VIBE_CARDS.find(v => v.id === id)?.keywords)
      .filter(Boolean)
      .join(", ");
    const fullPrompt =
      prompt && vibeKw ? `${prompt}, ${vibeKw}` : prompt || vibeKw;
    const seedNum = seed ? parseInt(seed) : undefined;
    const extraValid = extraRefUrls.filter(u => u.trim());

    try {
      let input: any;
      let result: any;

      // ── T2I ──
      if (model.id === "nanoBanana2") {
        input = {
          prompt: fullPrompt,
          aspect_ratio: aspectRatio as any,
          num_images: numImages,
          ...(extraValid.length && { image_urls: extraValid }),
        };
        if (!fullPrompt) {
          toast.error("請輸入提示詞");
          return;
        }
      } else if (model.id === "nanoBananaPro") {
        input = {
          prompt: fullPrompt,
          aspect_ratio: aspectRatio as any,
          num_images: numImages,
          ...(extraValid.length && { image_urls: extraValid }),
        };
        if (!fullPrompt) {
          toast.error("請輸入提示詞");
          return;
        }
      } else if (model.id === "seedreamV4") {
        input = {
          prompt: fullPrompt,
          aspect_ratio: aspectRatio as any,
          num_images: numImages,
          ...(negPrompt && { negative_prompt: negPrompt }),
        };
        if (!fullPrompt) {
          toast.error("請輸入提示詞");
          return;
        }
      } else if (model.id === "imagen4") {
        input = {
          prompt: fullPrompt,
          aspect_ratio: aspectRatio as any,
          num_images: numImages,
          ...(negPrompt && { negative_prompt: negPrompt }),
        };
        if (!fullPrompt) {
          toast.error("請輸入提示詞");
          return;
        }
      }
      // ── Edit ──
      else if (model.id === "nanoBananaProEdit") {
        if (!fullPrompt || !refImageUrl) {
          toast.error("請輸入提示詞和參考圖片");
          return;
        }
        input = {
          prompt: fullPrompt,
          image_url: refImageUrl,
          image_urls: extraValid.length ? extraValid : undefined,
        };
      } else if (model.id === "nanoBananaEdit") {
        if (!fullPrompt || !refImageUrl) {
          toast.error("請輸入提示詞和參考圖片");
          return;
        }
        input = {
          prompt: fullPrompt,
          image_url: refImageUrl,
          image_urls: extraValid.length ? extraValid : undefined,
        };
      } else if (model.id === "nanoBanana2Edit") {
        if (!fullPrompt || !refImageUrl) {
          toast.error("請輸入提示詞和參考圖片");
          return;
        }
        input = {
          prompt: fullPrompt,
          image_url: refImageUrl,
          image_urls: extraValid.length ? extraValid : undefined,
          aspect_ratio: "auto" as any,
        };
      } else if (model.id === "seedreamV45Edit") {
        if (!fullPrompt || !refImageUrl) {
          toast.error("請輸入提示詞和參考圖片");
          return;
        }
        input = { prompt: fullPrompt, image_url: refImageUrl, strength };
      } else if (model.id === "seedreamV5LiteEdit") {
        if (!fullPrompt || !refImageUrl) {
          toast.error("請輸入提示詞和參考圖片");
          return;
        }
        input = { prompt: fullPrompt, image_url: refImageUrl, strength };
      } else if (model.id === "grokEdit") {
        if (!fullPrompt || !refImageUrl) {
          toast.error("請輸入提示詞和參考圖片");
          return;
        }
        input = { prompt: fullPrompt, image_url: refImageUrl };
      } else if (model.id === "gptImage15Edit") {
        if (!fullPrompt || !refImageUrl) {
          toast.error("請輸入提示詞和參考圖片");
          return;
        }
        input = {
          prompt: fullPrompt,
          image_url: refImageUrl,
          size: outputSize as any,
          ...(maskUrl && { mask_url: maskUrl }),
        };
      } else if (model.id === "fluxKontext") {
        if (!fullPrompt || !refImageUrl) {
          toast.error("請輸入提示詞和參考圖片");
          return;
        }
        input = {
          prompt: fullPrompt,
          image_url: refImageUrl,
          guidance_scale: guidance,
          num_inference_steps: inferSteps,
          ...(seedNum && { seed: seedNum }),
        };
      } else if (model.id === "flux2ProEdit") {
        if (!fullPrompt || !refImageUrl) {
          toast.error("請輸入提示詞和參考圖片");
          return;
        }
        input = {
          prompt: fullPrompt,
          image_url: refImageUrl,
          image_urls: extraValid.length ? extraValid : undefined,
          ...(seedNum && { seed: seedNum }),
        };
      }
      // ── Upscale ──
      else if (model.id === "seedVRUpscale") {
        if (!upscaleImageUrl) {
          toast.error("請提供要放大的圖片");
          return;
        }
        input = {
          image_url: upscaleImageUrl,
          upscale_mode: upscaleMode,
          upscale_factor: upscaleFactor,
          target_resolution: targetRes as any,
        };
      }
      // ── Pose ──
      else if (model.id === "dwPose") {
        if (!poseImageUrl) {
          toast.error("請提供人物圖片");
          return;
        }
        input = { image_url: poseImageUrl, draw_mode: drawMode as any };
      }
      // ── SD ──
      else if (model.id === "stableDiffusion35") {
        if (!fullPrompt) {
          toast.error("請輸入提示詞");
          return;
        }
        input = {
          prompt: fullPrompt,
          negative_prompt: negPrompt,
          num_inference_steps: sdInferSteps,
          guidance_scale: sdGuidance,
          num_images: numImages,
          image_size: sdImageSize as any,
          ...(sdSeed && { seed: parseInt(sdSeed) }),
          ...(loraPath && { lora_path: loraPath, lora_scale: loraScale }),
          ...(controlnetImageUrl &&
            controlnetPath && {
              controlnet_image_url: controlnetImageUrl,
              controlnet_path: controlnetPath,
              controlnet_scale: controlnetScale,
            }),
        };
      } else if (model.id === "fastSdxl") {
        if (!fullPrompt) {
          toast.error("請輸入提示詞");
          return;
        }
        input = {
          prompt: fullPrompt,
          negative_prompt: negPrompt,
          image_size: sdImageSize as any,
          num_images: numImages,
          ...(sdSeed && { seed: parseInt(sdSeed) }),
          ...(loraPath && { lora_path: loraPath, lora_scale: loraScale }),
        };
      } else if (model.id === "sdLora") {
        if (!fullPrompt) {
          toast.error("請輸入提示詞");
          return;
        }
        input = {
          prompt: fullPrompt,
          negative_prompt: negPrompt,
          image_size: sdImageSize as any,
          num_images: numImages,
          ...(sdSeed && { seed: parseInt(sdSeed) }),
          ...(loraPath && { loras: [{ path: loraPath, scale: loraScale }] }),
        };
      }
      // ── 3D ──
      else if (model.id === "trellis2") {
        if (!imageUrl3d) {
          toast.error("請提供來源圖片");
          return;
        }
        input = {
          image_url: imageUrl3d,
          resolution: trellisResolution as any,
          texture_size: trellisTextureSize as any,
        };
      } else if (model.id === "sam3dObjects") {
        if (!imageUrl3d) {
          toast.error("請提供來源圖片");
          return;
        }
        input = {
          image_url: imageUrl3d,
          prompt: samPrompt,
          export_textured_glb: true,
        };
      } else if (model.id === "hunyuan3d") {
        if (!imageUrl3d) {
          toast.error("請提供來源圖片");
          return;
        }
        input = {
          input_image_url: imageUrl3d,
          enable_pbr: enablePbr,
          generate_type: hunyuanGenType,
        };
      } else if (model.id === "rodin3d") {
        if (!prompt3d && !imageUrl3d) {
          toast.error("請提供文字描述或參考圖片");
          return;
        }
        input = {
          prompt: prompt3d,
          image_urls: imageUrl3d ? [imageUrl3d] : undefined,
          material: rodinMaterial,
          quality: rodinQuality,
        };
      } else if (model.id === "hunyuanWorld") {
        if (!imageUrl3d) {
          toast.error("請提供來源圖片");
          return;
        }
        input = {
          image_url: imageUrl3d,
          labels_fg1: labelsFg1,
          labels_fg2: labelsFg2,
          classes: worldClasses,
        };
      }

      result = await currentMutation.mutateAsync(input);
      registerBgTask(result, "image", `🖼️ ${model.name}`);

      // 若為非同步任務（只有 request_id），不嘗試提取結果，直接提示並回傳
      const isAsyncResult = !!(
        result?.raw?.request_id || result?.raw?.is_async_polling
      );
      if (isAsyncResult) {
        toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
        return;
      }

      // Handle 3D result
      if (model.category === "3d") {
        const glb = result?.model_glb_url || null;
        const extras: Record<string, string | null> = {};
        if (result?.gaussian_splat_url)
          extras["Gaussian PLY"] = result.gaussian_splat_url;
        if (result?.artifacts_zip_url)
          extras["ZIP 壓縮包"] = result.artifacts_zip_url;
        if (result?.model_urls?.obj) extras["OBJ"] = result.model_urls.obj;
        if (result?.model_urls?.usdz) extras["USDZ"] = result.model_urls.usdz;
        if (result?.model_urls?.fbx) extras["FBX"] = result.model_urls.fbx;
        if (result?.world_file_url) extras["World"] = result.world_file_url;
        if (result?.textures?.length)
          extras["紋理 ZIP"] = result.textures[0] || null;
        setResult3d({
          glbUrl: glb,
          extras: Object.keys(extras).length ? extras : undefined,
        });
        setLastGenMeta({
          modelName: model.name,
          duration: Math.round((Date.now() - genStartRef.current) / 1000),
        });
        if (glb) toast.success("3D 模型生成完成！");
        else toast.warning("3D 生成完成，但未找到 GLB 檔案，請查看 extras");
        return;
      }

      // Handle Pose result
      if (model.category === "pose") {
        const poseUrl = result?.pose_image_url || null;
        if (poseUrl) {
          const internalPoseUrl = await persistGeneratedImageUrl(poseUrl);
          setResultPose(internalPoseUrl);
          setLastGenMeta({
            modelName: model.name,
            duration: Math.round((Date.now() - genStartRef.current) / 1000),
          });
          toast.success("骨骼姿勢圖生成完成！");
        } else {
          toast.error("未取得姿勢圖 URL");
        }
        return;
      }

      // Handle image result
      const imgs: string[] = [];
      if (result?.images?.length) imgs.push(...result.images);
      else if (result?.image_url) imgs.push(result.image_url);

      if (!imgs.length) {
        // 已提交背景任務，不再顯示錯誤
        toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
        return;
      }
      const internalImgs = await Promise.all(
        imgs.map(imgUrl => persistGeneratedImageUrl(imgUrl))
      );
      setResultImages(internalImgs);
      toast.success(`✨ 生成完成！（${imgs.length} 張）`);
      reportSuccess();
      setLastGenMeta({
        modelName: model.name,
        duration: Math.round((Date.now() - genStartRef.current) / 1000),
        seed: seed || undefined,
      });

      addToHistory({
        prompt: fullPrompt || upscaleImageUrl || poseImageUrl || imageUrl3d,
        imageUrl: internalImgs[0],
        modelId: model.id,
        modelName: model.name,
        params: {
          aspectRatio,
          negPrompt,
          strength,
          guidance,
          inferSteps,
          numImages,
          seed,
          refImageUrl,
        },
      });
    } catch (err: any) {
      toast.error(`生成失敗：${err?.message ?? "未知錯誤"}`);
      reportFailure();
    } finally {
      setIsGenerating(false);
      setAIState("idle");
    }
  }, [
    model,
    prompt,
    vibeIds,
    aspectRatio,
    numImages,
    seed,
    refImageUrl,
    extraRefUrls,
    maskUrl,
    strength,
    guidance,
    inferSteps,
    outputSize,
    upscaleImageUrl,
    upscaleMode,
    upscaleFactor,
    targetRes,
    poseImageUrl,
    drawMode,
    sdImageSize,
    negPrompt,
    sdGuidance,
    sdInferSteps,
    sdSeed,
    loraPath,
    loraScale,
    controlnetImageUrl,
    controlnetPath,
    controlnetScale,
    imageUrl3d,
    prompt3d,
    trellisResolution,
    trellisTextureSize,
    samPrompt,
    enablePbr,
    hunyuanGenType,
    rodinQuality,
    rodinMaterial,
    labelsFg1,
    labelsFg2,
    worldClasses,
    currentMutation,
    persistGeneratedImageUrl,
    setAIState,
    reportSuccess,
    reportFailure,
  ]);

  const handleReuseHistory = (item: HistoryItem) => {
    setPrompt(item.prompt);
    const m = MODELS.find(m => m.id === item.modelId);
    if (m) {
      setSelectedModelId(item.modelId);
      setActiveTab(m.category);
    }
    const p = item.params as any;
    if (p.aspectRatio) setAspectRatio(p.aspectRatio);
    if (p.negPrompt) setNegPrompt(p.negPrompt);
    if (p.strength) setStrength(p.strength);
    if (p.guidance) setGuidance(p.guidance);
    if (p.inferSteps) setInferSteps(p.inferSteps);
    if (p.numImages) setNumImages(p.numImages);
    if (p.seed) setSeed(p.seed);
    if (p.refImageUrl) setRefImageUrl(p.refImageUrl);
    setShowHistory(false);
    toast.success("已載入歷史參數");
  };

  // Wire ref so Ctrl+Enter can call handleGenerate
  handleGenerateRef.current = handleGenerate;

  /** Send result image to the Edit tab as reference */
  const handleUseAsEditSource = useCallback((url: string) => {
    setRefImageUrl(url);
    setActiveTab("edit");
    toast.success("已將圖片載入編輯模式");
  }, []);

  const generateBtnLabel = () => {
    if (isGenerating) return "AI 生成中...";
    if (activeTab === "upscale") return "開始放大";
    if (activeTab === "pose") return "偵測骨骼姿勢";
    if (activeTab === "3d") return "生成 3D 模型";
    return "開始生成";
  };

  const gradientBtn = `bg-gradient-to-r ${tabColor(activeTab)} hover:opacity-90`;

  const hasResults = resultImages.length > 0 || !!result3d || !!resultPose;

  /** Shared max-height for sticky right-side panels (results + history) */
  const stickyPanelMaxH = "calc(100vh - 5rem)";

  // ── 光球代理人：註冊頁面能力 ─────────────────────────────────────────
  const agentCapabilities: AgentCapability[] = [
    {
      action: "setTab",
      label: "分頁",
      currentId: activeTab,
      options: TABS.map(t => ({
        id: t.id,
        label: t.label,
        meta: { count: t.count },
      })),
      hint: "切換不同類型的創作（文字生圖 / 編輯 / 放大 / 骨骼 / SD / 3D）",
    },
    {
      action: "setModel",
      label: "模型",
      currentId: selectedModelId,
      options: MODELS.map(m => {
        const coaching = getModelCoaching(m);
        return {
          id: m.id,
          label: m.name,
          description: m.desc,
          meta: {
            category: m.category,
            badge: m.badge,
            fast: m.fast,
            recommended: m.recommended,
            bestFor: coaching?.bestFor,
            tip: coaching?.tip,
            advantages: coaching?.advantages ?? [],
          },
        };
      }),
      hint: "切換模型會自動切到對應分頁。建議選型順序：先看任務（t2i/edit/upscale/pose/sd/3d）→ 再看速度與品質需求 → 最後看控制能力（遮罩/LoRA/ControlNet/多參考圖）。若不確定，先用 nanoBanana2 試方向，再切 nanoBananaPro 或 Imagen4 定稿。",
    },
    {
      action: "fillPrompt",
      label: "提示詞",
      hint: "slot=prompt 是主要提示詞（t2i/edit/sd 使用）；slot=negativePrompt 會填到負向欄位（SD / seedream / imagen）；slot=prompt3d 給 3D 分頁。支援 append=true 追加模式。好的提示詞 = 主體 + 環境 + 光線 + 風格 + 品質",
    },
    {
      action: "applyPreset",
      label: "氛圍卡",
      options: VIBE_CARDS.map(v => ({
        id: v.id,
        label: v.labelZh,
        description: v.keywords,
      })),
      hint: "套用後會把氛圍關鍵字附加到生成時的 prompt。可多選組合。電影感=cinematic / 夢幻=dreamy / 極簡=minimal / 暗黑=dark / 動漫=anime / 寫實=photo / 水彩=watercolor / 復古=vintage",
    },
    {
      action: "submit",
      label: "送出生成",
      hint: "需要使用者確認才執行；未填提示詞會失敗；已在生成中也會失敗",
    },
    {
      action: "reset",
      label: "重設",
      hint: "清空提示詞、氛圍、參考圖、結果",
    },
    {
      action: "setParam",
      label: "參數",
      hint: activeTab === "t2i"
        ? "t2i 可調: aspectRatio(1:1/16:9/9:16/4:3/3:4/3:2/2:3/auto) / numImages(1~4) / seed"
        : activeTab === "edit"
          ? "edit 可調: strength(0.1~1.0，越高改變越大) / guidance(1~20) / inferSteps(10~50) / negPrompt / outputSize"
          : activeTab === "sd"
            ? "sd 可調: sdImageSize / sdGuidance(1~20) / sdInferSteps(10~50) / sdSeed / negPrompt / loraPath / loraScale(0~2) / controlnetScale(0~2)"
            : activeTab === "upscale"
              ? "upscale 可調: upscaleFactor(2/4) / upscaleMode(factor/target)"
              : activeTab === "3d"
                ? "3d 可調: trellisResolution / trellisTextureSize / enablePbr(bool) / hunyuanGenType(Normal/LowPoly/Geometry) / rodinQuality(high/medium/low) / rodinMaterial(PBR/Shaded)"
                : "可調 key: aspectRatio / numImages / seed / strength / guidance / inferSteps / negPrompt / outputSize / sdGuidance / sdInferSteps / loraScale / controlnetScale / upscaleFactor / enablePbr / hunyuanGenType / rodinQuality",
    },
  ];

  useRegisterPageAgent({
    pageId: "image-studio",
    pageLabel: "圖片創作室",
    pagePath: "/image-studio",
    capabilities: agentCapabilities,
    state: {
      activeTab,
      selectedModelId,
      modelName: model.name,
      promptPreview: prompt.slice(0, 150) || "(空)",
      promptLength: prompt.length,
      appliedVibes: vibeIds.join(", ") || "(無)",
      vibeCount: vibeIds.length,
      aspectRatio,
      numImages,
      hasRefImage: !!refImageUrl,
      isGenerating,
      hasResult: resultImages.length > 0 || !!result3d || !!resultPose,
      resultCount: resultImages.length,
      // Tab-specific state
      ...(activeTab === "edit" && {
        strength,
        guidance,
        inferSteps,
        outputSize,
      }),
      ...(activeTab === "sd" && {
        negPrompt: negPrompt.slice(0, 80) || "(空)",
        sdGuidance,
        sdInferSteps,
        sdImageSize,
        hasLora: !!loraPath,
        loraScale,
        hasControlnet: !!controlnetImageUrl,
        controlnetScale,
      }),
      ...(activeTab === "upscale" && {
        upscaleMode,
        upscaleFactor,
        hasUpscaleImage: !!upscaleImageUrl,
      }),
      ...(activeTab === "3d" && {
        has3dImage: !!imageUrl3d,
        enablePbr,
        hunyuanGenType,
        rodinQuality,
      }),
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      switch (action.type) {
        case "fillPrompt": {
          const slot = action.slot ?? "prompt";
          const setter =
            slot === "negativePrompt"
              ? setNegPrompt
              : slot === "prompt3d"
                ? setPrompt3d
                : setPrompt;
          if (action.append) {
            setter(prev => (prev ? `${prev}, ${action.text}` : action.text));
          } else {
            setter(action.text);
          }
          return { ok: true };
        }
        case "setTab": {
          const tab = TABS.find(t => t.id === action.tabId);
          if (!tab) return { ok: false, reason: `unknown tabId: ${action.tabId}` };
          setActiveTab(tab.id);
          return { ok: true };
        }
        case "setModel": {
          const m = MODELS.find(x => x.id === action.modelId);
          if (!m) return { ok: false, reason: `unknown modelId: ${action.modelId}` };
          setSelectedModelId(m.id);
          if (m.category !== activeTab) setActiveTab(m.category);
          return { ok: true };
        }
        case "applyPreset": {
          const vibe = VIBE_CARDS.find(v => v.id === action.presetId);
          if (!vibe) return { ok: false, reason: `unknown presetId: ${action.presetId}` };
          setVibeIds(prev =>
            prev.includes(vibe.id) ? prev : [...prev, vibe.id]
          );
          return { ok: true, message: `已加入氛圍「${vibe.labelZh}」` };
        }
        case "setParam": {
          const { key, value } = action;
          switch (key) {
            // ── Common params ──
            case "aspectRatio":
              if (typeof value === "string") setAspectRatio(value);
              return { ok: true, message: `比例已設為 ${value}` };
            case "numImages":
              if (typeof value === "number") setNumImages(Math.min(4, Math.max(1, value)));
              return { ok: true, message: `生成數量已設為 ${value}` };
            case "seed":
              if (typeof value === "string" || typeof value === "number")
                setSeed(String(value));
              return { ok: true };
            // ── Edit tab params ──
            case "strength":
              if (typeof value === "number") setStrength(Math.min(1, Math.max(0, value)));
              return { ok: true, message: `強度已設為 ${value}` };
            case "guidance":
              if (typeof value === "number") setGuidance(value);
              return { ok: true, message: `引導值已設為 ${value}` };
            case "inferSteps":
              if (typeof value === "number") setInferSteps(value);
              return { ok: true, message: `推理步數已設為 ${value}` };
            case "negPrompt":
              if (typeof value === "string") setNegPrompt(value);
              return { ok: true, message: "負面提示詞已更新" };
            case "outputSize":
              if (typeof value === "string") setOutputSize(value);
              return { ok: true };
            // ── SD tab params ──
            case "sdGuidance":
              if (typeof value === "number") setSdGuidance(value);
              return { ok: true, message: `SD 引導值已設為 ${value}` };
            case "sdInferSteps":
              if (typeof value === "number") setSdInferSteps(value);
              return { ok: true, message: `SD 步數已設為 ${value}` };
            case "sdSeed":
              if (typeof value === "string" || typeof value === "number")
                setSdSeed(String(value));
              return { ok: true };
            case "sdImageSize":
              if (typeof value === "string") setSdImageSize(value);
              return { ok: true, message: `SD 圖片尺寸已設為 ${value}` };
            case "loraPath":
              if (typeof value === "string") setLoraPath(value);
              return { ok: true, message: "LoRA 路徑已設定" };
            case "loraScale":
              if (typeof value === "number") setLoraScale(Math.min(2, Math.max(0, value)));
              return { ok: true, message: `LoRA 強度已設為 ${value}` };
            case "controlnetScale":
              if (typeof value === "number") setControlnetScale(Math.min(2, Math.max(0, value)));
              return { ok: true, message: `ControlNet 強度已設為 ${value}` };
            // ── Upscale tab params ──
            case "upscaleFactor":
              if (typeof value === "number") setUpscaleFactor(value);
              return { ok: true, message: `放大倍率已設為 ${value}x` };
            case "upscaleMode":
              if (typeof value === "string") setUpscaleMode(value as "factor" | "target");
              return { ok: true };
            // ── 3D tab params ──
            case "trellisResolution":
              if (typeof value === "string") setTrellisResolution(value);
              return { ok: true, message: `3D 解析度已設為 ${value}` };
            case "trellisTextureSize":
              if (typeof value === "string") setTrellisTextureSize(value);
              return { ok: true };
            case "enablePbr":
              if (typeof value === "boolean") setEnablePbr(value);
              return { ok: true, message: value ? "已開啟 PBR 材質" : "已關閉 PBR 材質" };
            case "hunyuanGenType":
              if (typeof value === "string") setHunyuanGenType(value as "Normal" | "LowPoly" | "Geometry");
              return { ok: true, message: `3D 類型已設為 ${value}` };
            case "rodinQuality":
              if (typeof value === "string") setRodinQuality(value as "high" | "medium" | "low" | "extra-low");
              return { ok: true, message: `3D 品質已設為 ${value}` };
            case "rodinMaterial":
              if (typeof value === "string") setRodinMaterial(value as "PBR" | "Shaded");
              return { ok: true };
            default:
              return { ok: false, reason: `unknown param key: ${key}` };
          }
        }
        case "submit": {
          if (isGenerating) return { ok: false, reason: "already generating" };
          if (action.delayMs && action.delayMs > 0) {
            await new Promise(r => setTimeout(r, action.delayMs));
          }
          void handleGenerate();
          return { ok: true, message: "已送出生成" };
        }
        case "reset": {
          setPrompt("");
          setVibeIds([]);
          setRefImageUrl("");
          setExtraRefUrls([]);
          setMaskUrl("");
          setNegPrompt("");
          setResultImages([]);
          setResult3d(null);
          setResultPose(null);
          return { ok: true };
        }
        case "focusElement":
          return { ok: true };
        default:
          return { ok: false, reason: `unsupported action` };
      }
    },
  });

  return (
    <div className="max-w-[1400px] mx-auto px-3 sm:px-4 lg:px-6 pb-24 lg:pb-10">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 py-3 sm:py-4">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <div className="p-2 sm:p-2.5 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shrink-0">
            <Image className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="hs-h2 !mb-0">圖片創作室</h1>
            <p className="hs-small !mb-0 text-muted-foreground mt-0.5 hidden sm:block">
              {MODELS.length} 個 AI 模型 · 文字生圖 · 圖片編輯 · 影像放大 · SD · 3D
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <VisualSoul
            size="sm"
            state={aiState}
            personality={personality}
            className="!w-7 !h-7"
          />
          <button
            onClick={() =>
              setViewMode(v => (v === "single" ? "grid" : "single"))
            }
            className="p-2 sm:p-2.5 rounded-xl border border-border/40 hover:bg-accent active:bg-accent/70 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            title="切換檢視"
            aria-label={viewMode === "single" ? "切換為網格檢視" : "切換為單張檢視"}
          >
            {viewMode === "single" ? (
              <Grid3x3 className="w-4 h-4" />
            ) : (
              <Image className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2.5 rounded-xl border text-xs font-medium transition-all min-h-[44px] ${
              showHistory
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border/40 hover:bg-accent active:bg-accent/70 text-muted-foreground"
            }`}
            aria-label={showHistory ? "關閉歷史面板" : "開啟歷史面板"}
            aria-pressed={showHistory}
          >
            <History className="w-3.5 h-3.5" /> 歷史
          </button>
        </div>
      </div>

      <ApiKeyBanner />

      {/* ── Tab Bar — scrollable pill strip ── */}
      <div className="sticky top-0 z-20 -mx-3 sm:-mx-4 lg:-mx-6 px-3 sm:px-4 lg:px-6 py-2 bg-background/80 backdrop-blur-md border-b border-border/20">
        <div className="flex gap-1 overflow-x-auto no-scrollbar scroll-fade-x -mx-1 px-1" role="tablist" aria-label="圖片創作分頁">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full whitespace-nowrap text-xs font-medium transition-all shrink-0 min-h-[36px] ${
                  active
                    ? `bg-gradient-to-r ${tabColor(tab.id)} text-white shadow-md shadow-primary/10`
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full leading-none ${active ? "bg-white/20" : "bg-background/80 text-muted-foreground"}`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Two-Column Layout (lg+) ── */}
      <div className="mt-4 flex flex-col lg:flex-row gap-4 lg:gap-6">
        {/* ── Mobile: Results at top when available ── */}
        {hasResults && (
          <div className="lg:hidden">
            <MobileResultsPreview
              resultImages={resultImages}
              result3d={result3d}
              resultPose={resultPose}
              prompt={prompt}
              viewMode={viewMode}
              setViewMode={setViewMode}
              downloadImage={downloadImage}
              onUseAsEdit={handleUseAsEditSource}
              lastGenMeta={lastGenMeta}
              poseImageUrl={poseImageUrl}
            />
          </div>
        )}

        {/* ── LEFT: Controls ── */}
        <div className="w-full lg:w-[420px] xl:w-[460px] shrink-0 lg:sticky lg:top-14 lg:self-start lg:overflow-y-auto lg:max-h-[calc(100vh-4rem)] space-y-3 sm:space-y-4 lg:pr-1 lg:pb-4 no-scrollbar">
          {/* Model Selection — compact horizontal-scrollable on small grids */}
          <div className="rounded-2xl border border-border/30 p-3 sm:p-4 bg-background/60">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5" />
                模型（{tabModels.length}）
              </p>
              <Badge variant="secondary" className="text-[9px]">
                {model.name}
              </Badge>
            </div>
            {tabModels.length <= 3 ? (
              <div className="grid grid-cols-1 gap-2">
                {tabModels.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedModelId(m.id)}
                    className={`p-2.5 rounded-xl border text-left transition-all relative overflow-hidden ${
                      selectedModelId === m.id
                        ? `bg-gradient-to-br ${colorClass(m.color)} border-primary/40 shadow-sm ring-1 ring-primary/20`
                        : "bg-background border-border/30 hover:bg-accent/30"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-semibold leading-tight truncate">
                            {m.name}
                          </p>
                          {m.fast && <Zap className="w-2.5 h-2.5 text-amber-500 shrink-0" />}
                          {m.recommended && (
                            <span className="text-[8px] px-1 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 font-medium shrink-0">
                              推薦
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-snug mt-0.5 line-clamp-1">
                          {m.desc}
                        </p>
                      </div>
                      {selectedModelId === m.id && (
                        <Check className="w-4 h-4 text-primary shrink-0" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div
                className={`grid gap-2 ${tabModels.length <= 4 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-2"}`}
              >
                {tabModels.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedModelId(m.id)}
                    className={`p-2.5 rounded-xl border text-left transition-all relative overflow-hidden ${
                      selectedModelId === m.id
                        ? `bg-gradient-to-br ${colorClass(m.color)} border-primary/40 shadow-sm ring-1 ring-primary/20`
                        : "bg-background border-border/30 hover:bg-accent/30"
                    }`}
                  >
                    <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
                      {m.recommended && (
                        <span className="text-[8px] px-1 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 font-medium">
                          推薦
                        </span>
                      )}
                      {m.fast && <Zap className="w-2.5 h-2.5 text-amber-500" />}
                    </div>
                    <div className="flex items-center gap-1.5 mb-0.5 pr-10">
                      <p className="text-[11px] font-semibold leading-tight truncate">
                        {m.name}
                      </p>
                      {selectedModelId === m.id && (
                        <Check className="w-3 h-3 text-primary shrink-0" />
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2">
                      {m.desc}
                    </p>
                    {m.bestFor && (
                      <p className="text-[10px] text-primary/70 leading-snug mt-0.5 line-clamp-1">
                        {m.bestFor}
                      </p>
                    )}
                    <div className="flex items-center gap-1 mt-1.5">
                      <Badge
                        variant="secondary"
                        className="text-[9px] px-1.5 py-0"
                      >
                        {m.badge}
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Model Tip — contextual guidance for selected model */}
          {activeTab === "t2i" && <ModelTipCard model={model} />}

          {/* Tab-specific panels */}

          {/* T2I — Quick Start Guide + Prompt + Settings */}
          {activeTab === "t2i" && (
            <>
              {/* Newcomer Quick Start Guide */}
              <T2iQuickStartGuide onQuickTry={handleQuickTry} />

              {/* Applied Model Banner */}
              {appliedModelName && (
                <div className="rounded-xl border border-amber-200/60 bg-amber-50/60 dark:bg-amber-900/20 px-3 py-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Cpu className="w-3.5 h-3.5 text-amber-600" />
                    <span className="font-medium text-amber-700 dark:text-amber-400">
                      角色模型：{appliedModelName}
                    </span>
                    {appliedTriggerWord && (
                      <code className="text-[10px] bg-amber-100 dark:bg-amber-800/40 px-1.5 py-0.5 rounded text-amber-700 dark:text-amber-300 font-mono">
                        {appliedTriggerWord}
                      </code>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setAppliedModelName(null);
                      setAppliedTriggerWord(null);
                    }}
                    className="text-amber-500 hover:text-amber-700 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="rounded-2xl border border-border/30 p-3 sm:p-4 bg-background/60">
                <PromptBuilder
                  value={prompt}
                  onChange={setPrompt}
                  vibeIds={vibeIds}
                  onVibeChange={setVibeIds}
                />
              </div>

              {/* Basic Settings — always visible */}
              <div className="rounded-2xl border border-border/30 p-3 sm:p-4 bg-background/60 space-y-3">
                <p className="hs-small !mb-0 text-foreground flex items-center gap-1.5">
                  <Settings2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                  生成設定
                </p>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    畫面比例
                  </Label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {ASPECT_RATIOS.map(ar => (
                      <button
                        key={ar.value}
                        onClick={() => setAspectRatio(ar.value)}
                        className={`py-1.5 px-1 rounded-xl border text-center transition-all ${aspectRatio === ar.value ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 hover:bg-accent text-muted-foreground"}`}
                      >
                        <p className="text-[11px] font-semibold">{ar.label}</p>
                        <p className="text-[9px] opacity-60">{ar.hint}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground mb-1 block">
                    生成數量
                  </Label>
                  <div className="flex gap-1.5">
                    {[1, 2, 4].map(n => (
                      <button
                        key={n}
                        onClick={() => setNumImages(n)}
                        className={`flex-1 py-1.5 rounded-xl border text-xs font-semibold transition-all ${numImages === n ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}
                      >
                        {n} 張
                      </button>
                    ))}
                  </div>
                </div>
                {model.supportsNeg && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      負向提示詞
                    </Label>
                    <Textarea
                      value={negPrompt}
                      onChange={e => setNegPrompt(e.target.value)}
                      placeholder="例如：模糊、低品質、扭曲的手指"
                      className="resize-none min-h-[3.5rem] text-xs"
                    />
                  </div>
                )}

                {/* Advanced Settings — collapsed by default */}
                <button
                  onClick={() => setShowAdvancedT2i(!showAdvancedT2i)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full p-2 rounded-lg hover:bg-accent/30"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" /> 進階設定
                  {showAdvancedT2i ? (
                    <ChevronUp className="w-3 h-3 ml-auto" />
                  ) : (
                    <ChevronDown className="w-3 h-3 ml-auto" />
                  )}
                </button>
                <AnimatePresence>
                  {showAdvancedT2i && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-3 pt-1">
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block">
                            種子碼（Seed）
                          </Label>
                          <Input
                            value={seed}
                            onChange={e => setSeed(e.target.value)}
                            placeholder="留空隨機生成"
                            className="text-sm"
                          />
                          <p className="text-[9px] text-muted-foreground/60 mt-0.5">
                            固定這個數字，每次都會生成一樣的結果
                          </p>
                        </div>
                        {model.supportsMultiRef && (
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">
                              多圖參考（選填，最多 14 張）
                            </Label>
                            <p className="text-[9px] text-muted-foreground/60 mb-1.5">
                              提供參考圖片讓 AI 學習風格或內容
                            </p>
                            {extraRefUrls.map((url, i) => (
                              <div key={i} className="flex gap-1.5 mb-1">
                                <Input
                                  value={url}
                                  onChange={e => {
                                    const n = [...extraRefUrls];
                                    n[i] = e.target.value;
                                    setExtraRefUrls(n);
                                  }}
                                  placeholder={`參考圖 ${i + 1}`}
                                  className="text-xs flex-1"
                                />
                                <button
                                  onClick={() =>
                                    setExtraRefUrls(
                                      extraRefUrls.filter((_, j) => j !== i)
                                    )
                                  }
                                  className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                            {extraRefUrls.length < 14 && (
                              <button
                                onClick={() =>
                                  setExtraRefUrls([...extraRefUrls, ""])
                                }
                                className="w-full text-xs py-1.5 rounded-xl border border-dashed border-border/60 text-muted-foreground hover:border-primary/40 flex items-center justify-center gap-1.5 transition-colors"
                              >
                                <Plus className="w-3 h-3" /> 新增參考圖
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          )}

          {/* Edit — Ref Image + Prompt + Settings */}
          {activeTab === "edit" && (
            <>
              <div
                className={`rounded-2xl border p-3 sm:p-4 bg-gradient-to-br ${colorClass(model.color)}`}
              >
                <RefImageInput
                  label="原始圖片（待編輯）"
                  value={refImageUrl}
                  onChange={setRefImageUrl}
                  onClear={() => setRefImageUrl("")}
                  multiple={model.supportsMultiRef}
                  extraUrls={extraRefUrls}
                  onExtraUrlsChange={setExtraRefUrls}
                />
                {model.supportsMask && (
                  <div className="mt-3">
                    <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                      遮罩圖片（Mask，選填）
                    </Label>
                    <Input
                      value={maskUrl}
                      onChange={e => setMaskUrl(e.target.value)}
                      placeholder="白色=編輯，黑色=保留"
                      className="text-sm"
                    />
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-border/30 p-3 sm:p-4 bg-background/60">
                <PromptBuilder
                  value={prompt}
                  onChange={setPrompt}
                  vibeIds={vibeIds}
                  onVibeChange={setVibeIds}
                />
              </div>
              <div className="rounded-2xl border border-border/30 p-3 sm:p-4 bg-background/60 space-y-3">
                <p className="hs-small !mb-0 text-foreground flex items-center gap-1.5">
                  <Settings2 className="w-3.5 h-3.5 text-muted-foreground" />{" "}
                  編輯設定
                </p>
                {model.supportsStrength && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      編輯強度：{strength.toFixed(2)}
                    </Label>
                    <Slider
                      value={[strength]}
                      onValueChange={([v]) => setStrength(v)}
                      min={0.1}
                      max={1}
                      step={0.05}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground/60">
                      <span>保留原圖</span>
                      <span>完全重繪</span>
                    </div>
                  </div>
                )}
                {model.supportsSize && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      輸出尺寸
                    </Label>
                    <Select value={outputSize} onValueChange={setOutputSize}>
                      <SelectTrigger className="text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">自動選擇</SelectItem>
                        <SelectItem value="1024x1024">
                          1024×1024（正方形）
                        </SelectItem>
                        <SelectItem value="1536x1024">
                          1536×1024（橫式）
                        </SelectItem>
                        <SelectItem value="1024x1536">
                          1024×1536（直式）
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {model.supportsGuidance && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        引導強度：{guidance.toFixed(1)}
                      </Label>
                      <Slider
                        value={[guidance]}
                        onValueChange={([v]) => setGuidance(v)}
                        min={1}
                        max={30}
                        step={0.5}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        推理步數：{inferSteps}
                      </Label>
                      <Slider
                        value={[inferSteps]}
                        onValueChange={([v]) => setInferSteps(v)}
                        min={10}
                        max={50}
                        step={1}
                      />
                    </div>
                  </>
                )}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">
                    種子碼（Seed）
                  </Label>
                  <Input
                    value={seed}
                    onChange={e => setSeed(e.target.value)}
                    placeholder="留空隨機"
                    className="text-sm"
                  />
                </div>
              </div>
            </>
          )}

          {/* Upscale */}
          {activeTab === "upscale" && (
            <div className="rounded-2xl border border-sky-200/50 p-3 sm:p-4 bg-sky-50/20 dark:bg-sky-950/10">
              <UpscalePanel
                imageUrl={upscaleImageUrl}
                setImageUrl={setUpscaleImageUrl}
                upscaleMode={upscaleMode}
                setUpscaleMode={setUpscaleMode}
                upscaleFactor={upscaleFactor}
                setUpscaleFactor={setUpscaleFactor}
                targetRes={targetRes}
                setTargetRes={setTargetRes}
              />
            </div>
          )}

          {/* Pose */}
          {activeTab === "pose" && (
            <div className="rounded-2xl border border-lime-200/50 p-3 sm:p-4 bg-lime-50/20 dark:bg-lime-950/10">
              <PosePanel
                imageUrl={poseImageUrl}
                setImageUrl={setPoseImageUrl}
                drawMode={drawMode}
                setDrawMode={setDrawMode}
              />
            </div>
          )}

          {/* SD */}
          {activeTab === "sd" && (
            <>
              <div className="rounded-2xl border border-border/30 p-3 sm:p-4 bg-background/60">
                <PromptBuilder
                  value={prompt}
                  onChange={setPrompt}
                  vibeIds={vibeIds}
                  onVibeChange={setVibeIds}
                />
              </div>
              <div className="rounded-2xl border border-cyan-200/50 p-3 sm:p-4 bg-cyan-50/20 dark:bg-cyan-950/10">
                <SDPanel
                  imageSize={sdImageSize}
                  setImageSize={setSdImageSize}
                  negPrompt={negPrompt}
                  setNegPrompt={setNegPrompt}
                  guidance={sdGuidance}
                  setGuidance={setSdGuidance}
                  inferSteps={sdInferSteps}
                  setInferSteps={setSdInferSteps}
                  seed={sdSeed}
                  setSeed={setSdSeed}
                  loraPath={loraPath}
                  setLoraPath={setLoraPath}
                  loraScale={loraScale}
                  setLoraScale={setLoraScale}
                  controlnetImageUrl={controlnetImageUrl}
                  setControlnetImageUrl={setControlnetImageUrl}
                  controlnetPath={controlnetPath}
                  setControlnetPath={setControlnetPath}
                  controlnetScale={controlnetScale}
                  setControlnetScale={setControlnetScale}
                  modelId={selectedModelId}
                />
              </div>
              <div className="rounded-2xl border border-border/30 p-3 bg-background/60">
                <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  生成數量
                </Label>
                <div className="flex gap-1.5">
                  {[1, 2, 4].map(n => (
                    <button
                      key={n}
                      onClick={() => setNumImages(n)}
                      className={`flex-1 py-1.5 rounded-xl border text-xs font-semibold transition-all ${numImages === n ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}
                    >
                      {n} 張
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* 3D */}
          {activeTab === "3d" && (
            <div className="rounded-2xl border border-orange-200/50 p-3 sm:p-4 bg-orange-50/20 dark:bg-orange-950/10">
              <ThreeDPanel
                imageUrl={imageUrl3d}
                setImageUrl={setImageUrl3d}
                prompt3d={prompt3d}
                setPrompt3d={setPrompt3d}
                modelId={selectedModelId}
                trellisResolution={trellisResolution}
                setTrellisResolution={setTrellisResolution}
                trellisTextureSize={trellisTextureSize}
                setTrellisTextureSize={setTrellisTextureSize}
                samPrompt={samPrompt}
                setSamPrompt={setSamPrompt}
                enablePbr={enablePbr}
                setEnablePbr={setEnablePbr}
                hunyuanGenType={hunyuanGenType}
                setHunyuanGenType={setHunyuanGenType}
                rodinQuality={rodinQuality}
                setRodinQuality={setRodinQuality}
                rodinMaterial={rodinMaterial}
                setRodinMaterial={setRodinMaterial}
                labelsFg1={labelsFg1}
                setLabelsFg1={setLabelsFg1}
                labelsFg2={labelsFg2}
                setLabelsFg2={setLabelsFg2}
                worldClasses={worldClasses}
                setWorldClasses={setWorldClasses}
              />
            </div>
          )}

          {/* Generate Button — visible in-flow on desktop */}
          <div className="hidden lg:block">
            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
              aria-busy={isGenerating}
              className={`w-full h-12 rounded-2xl text-sm font-semibold gap-2 shadow-lg hover:shadow-xl transition-all text-white ${gradientBtn} ${!isGenerating ? "animate-[gentle-pulse_3s_ease-in-out_infinite]" : ""}`}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {generateBtnLabel()}
                </>
              ) : (
                <>
                  <Wand2 className="w-5 h-5" />
                  {generateBtnLabel()}
                  <kbd className="hidden xl:inline text-[10px] px-1.5 py-0.5 rounded bg-white/20 ml-1 font-mono">{navigator.platform?.includes("Mac") ? "⌘" : "Ctrl"}+↵</kbd>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* ── RIGHT: Results / Preview + History ── */}
        <div className="flex-1 min-w-0 flex flex-col lg:flex-row gap-4 lg:gap-5">
          {/* Results Area */}
          <div className="flex-1 min-w-0 lg:sticky lg:top-16 lg:self-start" style={{ maxHeight: stickyPanelMaxH }}>
            <div className="rounded-2xl border border-border/20 bg-muted/20 lg:overflow-y-auto lg:h-full" style={{ maxHeight: stickyPanelMaxH }}>
              {/* Results Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 border-b border-border/20 bg-background/80 backdrop-blur-sm rounded-t-2xl">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <ImagePlus className="w-3.5 h-3.5" />
                  生成結果
                  {resultImages.length > 0 && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 ml-1" aria-live="polite">
                      {resultImages.length} 張
                    </Badge>
                  )}
                </p>
                {resultImages.length > 1 && (
                  <button
                    onClick={() => setViewMode(v => (v === "single" ? "grid" : "single"))}
                    className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors"
                    title="切換檢視模式"
                    aria-label={viewMode === "single" ? "切換為網格檢視" : "切換為單張檢視"}
                  >
                    {viewMode === "single" ? (
                      <Grid3x3 className="w-3.5 h-3.5" />
                    ) : (
                      <Image className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>

              {/* Content Area */}
              <div className="p-3 sm:p-4">
                <AnimatePresence mode="wait">
                  {isGenerating ? (
                    <motion.div
                      key="generating"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center justify-center py-16 sm:py-24 gap-4"
                      role="status"
                      aria-label="AI 生成中"
                    >
                      <div className="relative">
                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900/30 dark:to-purple-900/20 flex items-center justify-center">
                          <Loader2 className="w-7 h-7 text-violet-500 animate-spin" />
                        </div>
                        <div className="absolute inset-0 rounded-full border-2 border-violet-200/50 dark:border-violet-800/30 animate-ping" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium text-foreground">AI 正在創作中...</p>
                        <p className="text-xs text-muted-foreground mt-1">使用 {model.name} 生成</p>
                      </div>
                    </motion.div>
                  ) : hasResults ? (
                    <motion.div
                      key="results"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      {resultImages.length > 0 && (
                        <div
                          className={
                            viewMode === "grid" && resultImages.length > 1
                              ? "grid grid-cols-2 gap-3"
                              : "space-y-3"
                          }
                        >
                          {resultImages.map((url) => (
                            <ResultImage
                              key={url}
                              url={url}
                              prompt={prompt}
                              onDownload={() => downloadImage(url)}
                              onUseAsEdit={handleUseAsEditSource}
                              genMeta={lastGenMeta}
                            />
                          ))}
                        </div>
                      )}
                      {result3d && (
                        <Model3DResult
                          glbUrl={result3d.glbUrl}
                          extras={result3d.extras}
                        />
                      )}
                      {resultPose && (
                        <PoseResult poseUrl={resultPose} prompt={poseImageUrl} />
                      )}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center justify-center py-12 sm:py-20 gap-4"
                    >
                      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/20 border border-violet-100/50 dark:border-violet-800/30 flex items-center justify-center">
                        <Sparkles className="w-8 h-8 text-violet-300 dark:text-violet-600" />
                      </div>
                      <div className="text-center max-w-[260px]">
                        <p className="text-sm font-medium text-muted-foreground">等待你的靈感 ✨</p>
                        <p className="text-xs text-muted-foreground/60 mt-1 leading-relaxed">
                          選擇模型、輸入描述，按下生成
                        </p>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 mt-1">
                        <button
                          onClick={() => {
                            setPrompt(QUICK_TRY_PROMPT);
                            setActiveTab("t2i");
                            setSelectedModelId("seedreamV4");
                            toast.success("🌿 已填入範例提示詞");
                          }}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-100/80 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-medium hover:bg-violet-200/80 dark:hover:bg-violet-900/50 transition-colors"
                        >
                          <Rocket className="w-3.5 h-3.5" /> 一鍵填入範例
                        </button>
                        <button
                          onClick={() => {
                            const randomTemplate = PROMPT_TEMPLATES[Math.floor(Math.random() * PROMPT_TEMPLATES.length)];
                            setPrompt(randomTemplate.text);
                            toast.success(`已填入「${randomTemplate.title}」`);
                          }}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border/40 text-muted-foreground text-xs font-medium hover:bg-accent transition-colors"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> 隨機靈感
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* History Sidebar */}
          <AnimatePresence>
            {showHistory && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 260, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="shrink-0 overflow-hidden rounded-2xl border border-border/30 bg-background/60 flex flex-col lg:sticky lg:top-16 lg:self-start"
                style={{ maxHeight: stickyPanelMaxH }}
              >
                <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/20">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <History className="w-4 h-4 text-primary" /> 歷史
                  </div>
                  <button
                    onClick={() => setShowHistory(false)}
                    className="p-2 sm:p-1 hover:bg-accent active:bg-accent/70 rounded-md"
                    aria-label="關閉歷史面板"
                  >
                    <X className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-muted-foreground" />
                  </button>
                </div>
                <HistoryPanel onReuse={handleReuseHistory} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Mobile Sticky Generate Bar ── */}
      <div className="fixed bottom-0 left-0 right-0 z-30 lg:hidden border-t border-border/30 bg-background/90 backdrop-blur-lg px-3 py-2 safe-area-pb">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[9px] px-2 py-0.5 shrink-0 max-w-[100px] truncate" title={model.name}>
            {model.name}
          </Badge>
          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
            aria-busy={isGenerating}
            className={`flex-1 h-11 rounded-2xl text-sm font-semibold gap-2 shadow-lg transition-all text-white ${gradientBtn}`}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                {generateBtnLabel()}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="text-center py-4 mt-6 border-t border-border/20">
        <p className="hs-small !mb-0 text-muted-foreground/50">
          Powered by fal.ai · Gemini · FLUX · SeeDream · Imagen4 · Grok · GPT
          Image · Stable Diffusion · Trellis · SAM3D · HunyuanWorld
        </p>
      </div>
    </div>
  );
}
