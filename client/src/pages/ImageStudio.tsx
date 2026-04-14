/**
 * ImageStudio.tsx — 專業圖片創作室 v2
 *
 * 整合 fal.ai 完整圖片模型矩陣：
 *  文字生圖（4）/ 圖片編輯（9）/ 影像放大（1）/ 骨骼姿勢偵測（1）
 *  Stable Diffusion（3）/ 圖片轉3D（5）
 */

import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Image, Wand2, Sparkles, Download, Loader2, AlertCircle,
  History, Bookmark, BookmarkCheck, ExternalLink, Copy,
  Settings2, X, ChevronDown, ChevronUp, Zap, Check,
  Paintbrush, ImagePlus, RefreshCw, Trash2, Eye, Grid3x3,
  SlidersHorizontal, Plus, Box, Scan, ArrowUpCircle,
  Brain, Layers, Camera, Upload, Cpu,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { uploadFileToS3 } from "@/lib/upload";
import { useRegisterBgTask } from "@/contexts/BackgroundTasksContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type StudioTab =
  | "t2i"       // 文字生圖
  | "edit"      // 圖片編輯
  | "upscale"   // 影像放大
  | "pose"      // 骨骼姿勢
  | "sd"        // Stable Diffusion
  | "3d";       // 圖片轉3D

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
};

type ColorKey =
  | "purple" | "blue" | "green" | "orange" | "pink" | "cyan"
  | "indigo" | "rose" | "amber" | "teal" | "violet" | "slate" | "lime" | "sky";

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
  id: string; label: string; labelZh: string; emoji: string; keywords: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MODELS: ModelInfo[] = [
  // ── 文字生圖 ──
  {
    id: "nanoBanana2", falId: "fal-ai/nano-banana-2",
    name: "Nano Banana 2", desc: "Gemini 3.1 Flash • 文字渲染 • 14圖參考",
    badge: "Gemini Flash", category: "t2i", color: "purple",
    supportsMultiRef: true, fast: true,
  },
  {
    id: "nanoBananaPro", falId: "fal-ai/nano-banana-pro",
    name: "Nano Banana Pro", desc: "Gemini 3 Pro • 最高品質 • 商業授權",
    badge: "Gemini Pro", category: "t2i", color: "indigo",
    supportsMultiRef: true,
  },
  {
    id: "seedreamV4", falId: "fal-ai/bytedance/seedream/v4/text-to-image",
    name: "SeeDream v4", desc: "ByteDance • 高品質 • 支援中文描述",
    badge: "ByteDance", category: "t2i", color: "orange",
    supportsNeg: true,
  },
  {
    id: "imagen4", falId: "fal-ai/imagen4/preview",
    name: "Imagen 4 Preview", desc: "Google • 超真實感 • 細節豐富",
    badge: "Google Imagen", category: "t2i", color: "blue",
    supportsNeg: true,
  },

  // ── 圖片編輯 ──
  {
    id: "nanoBananaProEdit", falId: "fal-ai/nano-banana-pro/edit",
    name: "Nano Banana Pro Edit", desc: "Gemini 3 Pro • 語意式編輯 • 14圖融合",
    badge: "Gemini Pro", category: "edit", color: "indigo",
    supportsMultiRef: true,
  },
  {
    id: "nanoBananaEdit", falId: "fal-ai/nano-banana/edit",
    name: "Nano Banana Edit", desc: "Gemini 2.0 Flash • 快速編輯 • 多圖融合",
    badge: "Gemini Flash", category: "edit", color: "purple",
    supportsMultiRef: true, fast: true,
  },
  {
    id: "nanoBanana2Edit", falId: "fal-ai/nano-banana-2/edit",
    name: "Nano Banana 2 Edit", desc: "Gemini 3.1 Flash 編輯 • 多圖融合 • 0.5K-4K",
    badge: "Gemini Flash", category: "edit", color: "violet",
    supportsMultiRef: true, fast: true,
  },
  {
    id: "seedreamV45Edit", falId: "fal-ai/bytedance/seedream/v4.5/edit",
    name: "SeeDream v4.5 Edit", desc: "ByteDance • 高品質圖片語意編輯",
    badge: "ByteDance", category: "edit", color: "orange",
    supportsStrength: true,
  },
  {
    id: "seedreamV5LiteEdit", falId: "fal-ai/bytedance/seedream/v5/lite/edit",
    name: "SeeDream v5 Lite", desc: "ByteDance v5 • 輕量快速編輯",
    badge: "BD v5 Lite", category: "edit", color: "amber",
    supportsStrength: true, fast: true,
  },
  {
    id: "grokEdit", falId: "xai/grok-imagine-image/edit",
    name: "Grok Imagine Edit", desc: "xAI Grok • 原生多模態理解 • 語意精確",
    badge: "xAI Grok", category: "edit", color: "teal",
  },
  {
    id: "gptImage15Edit", falId: "fal-ai/gpt-image-1.5/edit",
    name: "GPT Image 1.5 Edit", desc: "OpenAI • 可選遮罩 • 頂尖語意理解",
    badge: "OpenAI", category: "edit", color: "green",
    supportsMask: true, supportsSize: true,
  },
  {
    id: "fluxKontext", falId: "fal-ai/flux-pro/kontext",
    name: "FLUX Kontext Pro", desc: "BFL • 精準局部修改 • 上下文感知",
    badge: "FLUX.1", category: "edit", color: "rose",
    supportsGuidance: true,
  },
  {
    id: "flux2ProEdit", falId: "fal-ai/flux-2-pro/edit",
    name: "FLUX 2 Pro Edit", desc: "BFL Flux2 Pro • 高真實感 • 多圖融合",
    badge: "FLUX 2 Pro", category: "edit", color: "pink",
    supportsMultiRef: true,
  },

  // ── 影像放大 ──
  {
    id: "seedVRUpscale", falId: "fal-ai/seedvr/upscale/image",
    name: "SeedVR Upscale", desc: "ByteDance SeedVR • ×2/×4 放大 • 720p→2160p",
    badge: "SeedVR", category: "upscale", color: "sky",
    outputType: "image",
  },

  // ── 骨骼姿勢 ──
  {
    id: "dwPose", falId: "fal-ai/dwpose",
    name: "DWPose 骨骼偵測", desc: "Mediapipe DWPose • 全身/臉部/手部姿勢圖",
    badge: "DWPose", category: "pose", color: "lime",
    outputType: "pose",
  },

  // ── Stable Diffusion ──
  {
    id: "stableDiffusion35", falId: "fal-ai/stable-diffusion-v35-large",
    name: "SD 3.5 Large", desc: "Stability AI • ControlNet • LoRA • 高品質",
    badge: "SD 3.5", category: "sd", color: "cyan",
    supportsNeg: true, supportsGuidance: true,
    supportsControlNet: true, supportsLora: true,
  },
  {
    id: "fastSdxl", falId: "fal-ai/fast-sdxl",
    name: "Fast SDXL", desc: "SDXL 快速生圖 • LoRA 支援 • 多尺寸",
    badge: "SDXL", category: "sd", color: "slate",
    supportsNeg: true, supportsLora: true, fast: true,
  },
  {
    id: "sdLora", falId: "fal-ai/lora",
    name: "SD + LoRA", desc: "Stable Diffusion + 任意 HuggingFace LoRA",
    badge: "SD LoRA", category: "sd", color: "teal",
    supportsNeg: true, supportsLora: true,
  },

  // ── 圖片轉3D ──
  {
    id: "trellis2", falId: "fal-ai/trellis-2",
    name: "Trellis 2", desc: "原生3D生成 • GLB輸出 • 電影級幾何",
    badge: "Trellis 2", category: "3d", color: "indigo",
    outputType: "3d",
  },
  {
    id: "sam3dObjects", falId: "fal-ai/sam-3/3d-objects",
    name: "SAM 3D Objects", desc: "Facebook SAM • 精確3D重建 • 幾何+紋理",
    badge: "SAM 3D", category: "3d", color: "blue",
    outputType: "3d",
  },
  {
    id: "hunyuan3d", falId: "fal-ai/hunyuan3d-v3/image-to-3d",
    name: "混元 3D v3", desc: "騰訊混元 • 電影級幾何 • PBR紋理 • GLB/OBJ",
    badge: "HunyuanV3", category: "3d", color: "orange",
    outputType: "3d",
  },
  {
    id: "rodin3d", falId: "fal-ai/hyper3d/rodin",
    name: "Rodin 3D", desc: "Hyper3D • 文字/圖片生3D • PBR材質",
    badge: "Rodin", category: "3d", color: "purple",
    outputType: "3d",
  },
  {
    id: "hunyuanWorld", falId: "fal-ai/hunyuan_world/image-to-world",
    name: "混元 World", desc: "混元 World 1.0 • 圖片→全景3D世界",
    badge: "HunyuanWorld", category: "3d", color: "teal",
    outputType: "3d",
  },
];

const TABS: { id: StudioTab; label: string; icon: React.ComponentType<{ className?: string }>; count: number }[] = [
  { id: "t2i",     label: "文字生圖",   icon: Sparkles,       count: 4 },
  { id: "edit",    label: "圖片編輯",   icon: Paintbrush,     count: 9 },
  { id: "upscale", label: "影像放大",   icon: ArrowUpCircle,  count: 1 },
  { id: "pose",    label: "骨骼姿勢",   icon: Scan,           count: 1 },
  { id: "sd",      label: "Stable Diffusion", icon: Brain,    count: 3 },
  { id: "3d",      label: "圖片轉3D",   icon: Box,            count: 5 },
];

const ASPECT_RATIOS = [
  { value: "1:1",  label: "1:1",  hint: "正方形" },
  { value: "16:9", label: "16:9", hint: "橫式" },
  { value: "9:16", label: "9:16", hint: "直式" },
  { value: "4:3",  label: "4:3",  hint: "傳統" },
  { value: "3:4",  label: "3:4",  hint: "人像" },
  { value: "3:2",  label: "3:2",  hint: "相片" },
  { value: "2:3",  label: "2:3",  hint: "書本" },
  { value: "auto", label: "Auto", hint: "自動" },
];

const IMAGE_SIZES = [
  { value: "square_hd",     label: "正方 HD" },
  { value: "square",        label: "正方" },
  { value: "portrait_4_3",  label: "直式 4:3" },
  { value: "portrait_16_9", label: "直式 16:9" },
  { value: "landscape_4_3", label: "橫式 4:3" },
  { value: "landscape_16_9",label: "橫式 16:9" },
];

const VIBE_CARDS: VibeCard[] = [
  { id: "cinematic",     label: "Cinematic",      labelZh: "電影感",   emoji: "🎬", keywords: "cinematic, film grain, dramatic lighting, 35mm, bokeh" },
  { id: "dreamy",        label: "Dreamy",         labelZh: "夢幻",     emoji: "✨", keywords: "dreamy, ethereal, soft glow, pastel, fantasy, magical" },
  { id: "minimal",       label: "Minimal",        labelZh: "極簡",     emoji: "⬜", keywords: "minimalist, clean, white space, simple, elegant, modern" },
  { id: "dark",          label: "Dark Art",       labelZh: "暗黑",     emoji: "🖤", keywords: "dark, moody, chiaroscuro, dramatic shadows, gothic" },
  { id: "anime",         label: "Anime",          labelZh: "動漫風",   emoji: "🌸", keywords: "anime style, manga, vibrant colors, cel shading, kawaii" },
  { id: "photo",         label: "Photorealistic", labelZh: "寫實攝影", emoji: "📷", keywords: "photorealistic, hyperrealistic, DSLR, sharp focus, 8K" },
  { id: "watercolor",    label: "Watercolor",     labelZh: "水彩畫",   emoji: "🎨", keywords: "watercolor painting, soft edges, flowing colors, artistic" },
  { id: "vintage",       label: "Vintage",        labelZh: "復古",     emoji: "📸", keywords: "vintage, retro, film photography, warm tones, nostalgic" },
];

const PROMPT_TEMPLATES = [
  { title: "🌅 自然風光",  text: "A breathtaking landscape at golden hour, dramatic sky with warm orange and pink clouds, mountain peaks reflecting in a still lake" },
  { title: "👤 人物肖像",  text: "Professional portrait photography, natural light, soft bokeh background, sharp focus on face, editorial style" },
  { title: "🏙️ 城市夜景", text: "Cyberpunk cityscape at night, neon lights reflecting on wet streets, futuristic architecture, cinematic atmosphere" },
  { title: "🎨 抽象藝術",  text: "Abstract digital art, vibrant color palette, geometric shapes, flowing lines, modern aesthetic, high contrast" },
  { title: "🌸 日系清新",  text: "Japanese spring scene, cherry blossoms, soft natural light, pastel colors, tranquil atmosphere, film photography style" },
  { title: "🔮 奇幻場景",  text: "Epic fantasy landscape, magical floating islands, ancient ruins, ethereal glowing lights, detailed illustration" },
];

const PROMPT_BUILDER_BLOCKS = {
  subject:  ["一位優雅的女性", "一片寧靜的森林", "未來城市的街道", "古老的圖書館", "太空站外景", "熱帶海灘"],
  style:    ["攝影風格", "油畫風格", "水彩插畫", "動漫風格", "3D渲染", "極簡主義"],
  lighting: ["黃金時段光線", "柔和的自然光", "戲劇性側光", "霓虹燈光", "月光", "工作室燈光"],
  mood:     ["寧靜祥和", "神秘詭異", "充滿活力", "溫馨暖意", "史詩壯觀", "憂鬱感性"],
  detail:   ["超精細細節", "景深效果", "8K解析度", "電影感色調", "高動態範圍", "清晰銳利"],
};

const CONTROLNET_PATHS = [
  { value: "diffusers/controlnet-canny-sdxl-1.0",         label: "Canny 邊緣" },
  { value: "diffusers/controlnet-depth-sdxl-1.0",         label: "深度圖" },
  { value: "thibaud/controlnet-openpose-sdxl-1.0",        label: "OpenPose 姿勢" },
  { value: "diffusers/controlnet-zoe-depth-sdxl-1.0",     label: "Zoe 深度" },
  { value: "monster-labs/control_v1p_sdxl_qrcode_monster",label: "QRCode" },
];

// ─── Color map ────────────────────────────────────────────────────────────────

function colorClass(c: ColorKey) {
  const m: Record<ColorKey, string> = {
    purple: "from-purple-500/10 to-violet-500/5 border-purple-200/50",
    blue:   "from-blue-500/10 to-cyan-500/5 border-blue-200/50",
    green:  "from-emerald-500/10 to-teal-500/5 border-emerald-200/50",
    orange: "from-orange-500/10 to-amber-500/5 border-orange-200/50",
    pink:   "from-pink-500/10 to-rose-500/5 border-pink-200/50",
    cyan:   "from-cyan-500/10 to-sky-500/5 border-cyan-200/50",
    indigo: "from-indigo-500/10 to-blue-500/5 border-indigo-200/50",
    rose:   "from-rose-500/10 to-pink-500/5 border-rose-200/50",
    amber:  "from-amber-500/10 to-yellow-500/5 border-amber-200/50",
    teal:   "from-teal-500/10 to-cyan-500/5 border-teal-200/50",
    violet: "from-violet-500/10 to-purple-500/5 border-violet-200/50",
    slate:  "from-slate-500/10 to-gray-500/5 border-slate-200/50",
    lime:   "from-lime-500/10 to-green-500/5 border-lime-200/50",
    sky:    "from-sky-500/10 to-blue-500/5 border-sky-200/50",
  };
  return m[c] || m.purple;
}

function tabColor(tab: StudioTab) {
  const m: Record<StudioTab, string> = {
    t2i:     "from-violet-600 to-purple-700",
    edit:    "from-rose-500 to-pink-600",
    upscale: "from-sky-500 to-blue-600",
    pose:    "from-lime-500 to-green-600",
    sd:      "from-cyan-500 to-teal-600",
    "3d":    "from-orange-500 to-amber-600",
  };
  return m[tab] || m.t2i;
}

// ─── History Storage ──────────────────────────────────────────────────────────

const HISTORY_KEY = "imageStudio_history";

function loadHistory(): HistoryItem[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); }
  catch { return []; }
}

function saveHistory(items: HistoryItem[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 50)));
}

function addToHistory(item: Omit<HistoryItem, "id" | "timestamp" | "bookmarked">) {
  const items = loadHistory();
  const newItem: HistoryItem = { ...item, id: `${Date.now()}`, timestamp: Date.now(), bookmarked: false };
  items.unshift(newItem);
  saveHistory(items);
  return newItem;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ApiKeyBanner() {
  const q = trpc.imageStudio.checkApiKey.useQuery();
  if (q.data?.configured !== false) return null;
  return (
    <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200/60 flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium text-amber-800">需要設定 FAL_API_KEY</p>
        <p className="text-xs text-amber-700 mt-0.5">所有圖片生成功能均需要 fal.ai API Key</p>
        <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-amber-800 font-medium underline mt-1">
          <ExternalLink className="w-3 h-3" />前往取得 API Key
        </a>
      </div>
    </div>
  );
}

function ResultImage({ url, prompt, onDownload }: { url: string; prompt: string; onDownload: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
      className="rounded-2xl overflow-hidden border border-border/30 shadow-lg bg-background">
      <div className="relative group">
        <img src={url} alt={prompt} className="w-full object-contain max-h-[600px]" loading="lazy" />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
          <Button size="sm" variant="secondary" className="gap-1.5" onClick={onDownload}>
            <Download className="w-3.5 h-3.5" /> 下載
          </Button>
          <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => window.open(url, "_blank")}>
            <Eye className="w-3.5 h-3.5" /> 全尺寸
          </Button>
        </div>
      </div>
      <div className="p-3">
        <p className="text-xs text-muted-foreground line-clamp-2">{prompt}</p>
        <div className="flex items-center gap-2 mt-2">
          <Button variant="outline" size="sm" className="flex-1 text-xs h-7 gap-1" onClick={onDownload}>
            <Download className="w-3 h-3" /> 下載圖片
          </Button>
          <Button variant="outline" size="sm" className="text-xs h-7 gap-1"
            onClick={() => { navigator.clipboard.writeText(url); toast.success("已複製圖片 URL"); }}>
            <Copy className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function Model3DResult({ glbUrl, extras }: { glbUrl: string | null; extras?: Record<string, string | null> }) {
  if (!glbUrl && !extras) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border/30 p-4 bg-background space-y-3">
      <div className="flex items-center gap-2">
        <Box className="w-4 h-4 text-orange-500" />
        <p className="text-sm font-semibold">3D 模型已生成</p>
      </div>
      {glbUrl && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">GLB 主檔案</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1 text-xs gap-1.5"
              onClick={() => window.open(glbUrl, "_blank")}>
              <ExternalLink className="w-3 h-3" /> 在瀏覽器開啟
            </Button>
            <Button size="sm" variant="outline" className="text-xs gap-1.5"
              onClick={() => { navigator.clipboard.writeText(glbUrl); toast.success("已複製 GLB URL"); }}>
              <Copy className="w-3 h-3" /> 複製 URL
            </Button>
          </div>
          <a href={glbUrl} download className="block">
            <Button size="sm" className="w-full text-xs gap-1.5 bg-orange-500 hover:bg-orange-600">
              <Download className="w-3 h-3" /> 下載 GLB 檔案
            </Button>
          </a>
        </div>
      )}
      {extras && Object.entries(extras).filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground capitalize">{k}</span>
          <Button size="sm" variant="ghost" className="text-xs h-6 gap-1" onClick={() => { navigator.clipboard.writeText(v!); toast.success(`已複製 ${k} URL`); }}>
            <Copy className="w-2.5 h-2.5" /> {v!.split(".").pop()?.toUpperCase()}
          </Button>
        </div>
      ))}
      <p className="text-[10px] text-muted-foreground/60 text-center mt-1">
        提示：將 GLB URL 貼入 model-viewer 或 Three.js 以預覽 3D 模型
      </p>
    </motion.div>
  );
}

function PoseResult({ poseUrl, prompt }: { poseUrl: string; prompt: string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
      className="rounded-2xl overflow-hidden border border-lime-200/50 shadow-lg bg-background">
      <div className="p-3 bg-lime-50/50 flex items-center gap-2 border-b border-lime-200/40">
        <Scan className="w-4 h-4 text-lime-600" />
        <p className="text-xs font-medium text-lime-800">骨骼姿勢圖</p>
      </div>
      <div className="relative group">
        <img src={poseUrl} alt="pose" className="w-full object-contain max-h-[500px]" loading="lazy" />
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => window.open(poseUrl, "_blank")}>
            <Eye className="w-3.5 h-3.5" /> 全尺寸
          </Button>
        </div>
      </div>
      <div className="p-3 flex gap-2">
        <Button variant="outline" size="sm" className="flex-1 text-xs h-7 gap-1"
          onClick={() => { navigator.clipboard.writeText(poseUrl); toast.success("已複製姿勢圖 URL"); }}>
          <Copy className="w-3 h-3" /> 複製 URL（用於 ControlNet）
        </Button>
        <Button variant="outline" size="sm" className="text-xs h-7 gap-1" onClick={() => window.open(poseUrl, "_blank")}>
          <Download className="w-3 h-3" />
        </Button>
      </div>
    </motion.div>
  );
}

function HistoryPanel({ onReuse }: { onReuse: (item: HistoryItem) => void }) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [filter, setFilter] = useState<"all" | "bookmarked">("all");

  useEffect(() => { setItems(loadHistory()); }, []);

  const toggleBookmark = (id: string) => {
    const updated = items.map(i => i.id === id ? { ...i, bookmarked: !i.bookmarked } : i);
    setItems(updated); saveHistory(updated);
  };
  const remove = (id: string) => {
    const updated = items.filter(i => i.id !== id);
    setItems(updated); saveHistory(updated);
  };
  const clearAll = () => { setItems([]); saveHistory([]); toast.success("已清除所有歷史"); };
  const shown = filter === "bookmarked" ? items.filter(i => i.bookmarked) : items;

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border/20 flex items-center gap-1">
        {(["all", "bookmarked"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex-1 text-xs py-1.5 rounded-lg transition-colors ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}>
            {f === "all" ? "全部" : "⭐ 精選"}
          </button>
        ))}
        <button onClick={clearAll} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors ml-1" title="清除全部">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {!shown.length && (
          <div className="text-center py-8">
            <History className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">{filter === "bookmarked" ? "尚無精選" : "尚無生成歷史"}</p>
          </div>
        )}
        {shown.map(item => (
          <div key={item.id} className="rounded-xl border border-border/30 overflow-hidden bg-background/50">
            <div className="relative">
              <img src={item.imageUrl} alt={item.prompt} className="w-full h-28 object-cover" loading="lazy" />
              <div className="absolute top-1 right-1 flex gap-1">
                <button onClick={() => toggleBookmark(item.id)} className="p-1 rounded-md bg-black/50 text-white hover:bg-black/70 transition-colors">
                  {item.bookmarked ? <BookmarkCheck className="w-3 h-3 text-amber-400" /> : <Bookmark className="w-3 h-3" />}
                </button>
                <button onClick={() => remove(item.id)} className="p-1 rounded-md bg-black/50 text-white hover:bg-red-500/70 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="p-2">
              <p className="text-[10px] text-muted-foreground line-clamp-2 mb-1.5">{item.prompt}</p>
              <div className="flex items-center justify-between">
                <Badge variant="secondary" className="text-[9px] px-1 py-0">{item.modelName}</Badge>
                <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5 gap-1" onClick={() => onReuse(item)}>
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

function VibeSelector({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {VIBE_CARDS.map(v => {
        const active = selected.includes(v.id);
        return (
          <button key={v.id} onClick={() => toggle(v.id)}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-medium border transition-all ${
              active ? "bg-primary text-primary-foreground border-primary shadow-sm" : "bg-background hover:bg-accent border-border text-muted-foreground"
            }`}>
            <span>{v.emoji}</span>
            <span>{v.labelZh}</span>
            {active && <Check className="w-2.5 h-2.5 ml-0.5" />}
          </button>
        );
      })}
    </div>
  );
}

function PromptBuilder({ value, onChange, vibeIds, onVibeChange }: {
  value: string; onChange: (v: string) => void;
  vibeIds: string[]; onVibeChange: (ids: string[]) => void;
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
      ...vibeIds.map(id => VIBE_CARDS.find(v => v.id === id)?.keywords).filter(Boolean),
    ].filter(Boolean);
    onChange(parts.join(", "));
    toast.success("提示詞已建構完成");
  };

  const appendVibeKeywords = () => {
    if (!vibeIds.length) { toast.info("請先選擇氛圍風格"); return; }
    const kw = vibeIds.map(id => VIBE_CARDS.find(v => v.id === id)?.keywords).filter(Boolean).join(", ");
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
              <button key={i} onClick={() => onChange(t.text)}
                className="text-[10px] px-2 py-0.5 rounded-md bg-muted/40 hover:bg-muted/60 text-muted-foreground border border-border/40 transition-colors">
                {t.title.slice(0, 5)}
              </button>
            ))}
          </div>
        </div>
        <Textarea value={value} onChange={e => onChange(e.target.value)}
          placeholder="描述你想生成的圖片（支援中英文）..."
          className="resize-none h-24 text-sm" />
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-muted-foreground/60">{value.length} 字元</span>
          <div className="flex gap-2">
            {value && <button onClick={() => onChange("")} className="text-[10px] text-muted-foreground hover:text-foreground">清除</button>}
            <button onClick={appendVibeKeywords} className="text-[10px] text-primary hover:text-primary/80">+ 加入氛圍</button>
          </div>
        </div>
      </div>

      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">氛圍風格（選填）</Label>
        <VibeSelector selected={vibeIds} onChange={onVibeChange} />
      </div>

      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">快速範例</Label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {PROMPT_TEMPLATES.map((t, i) => (
            <button key={i} onClick={() => onChange(t.text)}
              className="text-left p-2 rounded-xl border border-border/40 hover:border-primary/40 hover:bg-primary/5 transition-all">
              <p className="text-[11px] font-medium">{t.title}</p>
            </button>
          ))}
        </div>
      </div>

      <button onClick={() => setShowBuilder(!showBuilder)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full p-2 rounded-lg hover:bg-accent/30">
        <SlidersHorizontal className="w-3.5 h-3.5" /> 進階提示詞建構器
        {showBuilder ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
      </button>

      <AnimatePresence>
        {showBuilder && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden">
            <div className="p-3 rounded-xl bg-muted/20 border border-border/30 space-y-3">
              <p className="text-[11px] text-muted-foreground font-medium">🧩 積木式提示詞建構器</p>
              {(Object.entries(PROMPT_BUILDER_BLOCKS) as [string, string[]][]).map(([key, options]) => (
                <div key={key}>
                  <Label className="text-[10px] text-muted-foreground capitalize mb-1 block">
                    {{ subject: "主體", style: "風格", lighting: "光線", mood: "情緒", detail: "細節" }[key] ?? key}
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {options.map(opt => (
                      <button key={opt} onClick={() => setBlocks(prev => ({ ...prev, [key]: prev[key] === opt ? "" : opt }))}
                        className={`text-[10px] px-2 py-1 rounded-lg border transition-all ${
                          blocks[key] === opt ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/50 text-muted-foreground hover:bg-accent"
                        }`}>
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <Button size="sm" variant="outline" className="w-full text-xs gap-1.5" onClick={buildPrompt}>
                <Sparkles className="w-3.5 h-3.5" /> 一鍵生成提示詞
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RefImageInput({ label, value, onChange, onClear, multiple = false, extraUrls = [], onExtraUrlsChange, required = true }: {
  label: string; value: string; onChange: (v: string) => void; onClear: () => void;
  multiple?: boolean; extraUrls?: string[]; onExtraUrlsChange?: (urls: string[]) => void;
  required?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleUpload = useCallback(async (file: File) => {
    if (file.size > 16 * 1024 * 1024) { toast.error("圖片不能超過 16MB"); return; }
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
  }, [onChange]);

  const handleFileSelect = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) handleUpload(file);
    };
    input.click();
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) handleUpload(file);
    const url = e.dataTransfer.getData("text/plain");
    if (url && !file) onChange(url);
  }, [handleUpload, onChange]);

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <div
        className={`relative rounded-xl border transition-all ${isDragOver ? "border-primary/50 bg-primary/5 scale-[1.01]" : "border-border/40"}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="flex items-center gap-1 p-1">
          <Input value={value} onChange={e => onChange(e.target.value)}
            placeholder="貼上圖片 URL 或點擊上傳（PNG/JPG/WebP）" className="border-0 shadow-none focus-visible:ring-0 flex-1 text-sm pr-1" />
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={handleFileSelect} disabled={uploading} title="上傳圖片">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClear} title="清除">
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        {value && (
          <div className="px-2 pb-2">
            <div className="rounded-xl overflow-hidden border border-border/30">
              <img src={value} alt="reference" className="w-full max-h-40 object-cover" loading="lazy" onError={() => onChange("")} />
            </div>
          </div>
        )}
        {!value && (
          <div className="px-2 pb-2">
            <button onClick={handleFileSelect} className="w-full py-4 rounded-xl border border-dashed border-border/40 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors flex items-center justify-center gap-2">
              <Upload className="w-3.5 h-3.5" />
              點擊或拖放圖片上傳（最大 16MB）
            </button>
          </div>
        )}
      </div>
      {multiple && onExtraUrlsChange && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground">額外參考圖（最多 13 張，選填）</p>
          {extraUrls.map((url, i) => (
            <div key={i} className="flex gap-1.5">
              <Input value={url}
                onChange={e => { const next = [...extraUrls]; next[i] = e.target.value; onExtraUrlsChange(next); }}
                placeholder={`參考圖 ${i + 2}`} className="text-xs flex-1" />
              <button onClick={() => onExtraUrlsChange(extraUrls.filter((_, j) => j !== i))}
                className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {extraUrls.length < 13 && (
            <button onClick={() => onExtraUrlsChange([...extraUrls, ""])}
              className="w-full text-xs py-1.5 rounded-xl border border-dashed border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors flex items-center justify-center gap-1.5">
              <Plus className="w-3 h-3" /> 新增參考圖
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Special Panels per Tab ───────────────────────────────────────────────────

function UpscalePanel({ imageUrl, setImageUrl, upscaleMode, setUpscaleMode, upscaleFactor, setUpscaleFactor, targetRes, setTargetRes }: {
  imageUrl: string; setImageUrl: (v: string) => void;
  upscaleMode: "factor" | "target"; setUpscaleMode: (v: "factor" | "target") => void;
  upscaleFactor: number; setUpscaleFactor: (v: number) => void;
  targetRes: string; setTargetRes: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <RefImageInput label="原始圖片" value={imageUrl} onChange={setImageUrl} onClear={() => setImageUrl("")} />
      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-2 block">放大模式</Label>
        <div className="flex gap-2">
          {(["factor", "target"] as const).map(m => (
            <button key={m} onClick={() => setUpscaleMode(m)}
              className={`flex-1 py-2 rounded-xl border text-xs font-medium transition-all ${upscaleMode === m ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}>
              {m === "factor" ? "📐 倍數放大" : "🎯 目標解析度"}
            </button>
          ))}
        </div>
      </div>
      {upscaleMode === "factor" ? (
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">放大倍數：×{upscaleFactor}</Label>
          <Slider value={[upscaleFactor]} onValueChange={([v]) => setUpscaleFactor(v)} min={1} max={4} step={1} />
          <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-1">
            <span>×1</span><span>×2</span><span>×3</span><span>×4</span>
          </div>
        </div>
      ) : (
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">目標解析度</Label>
          <div className="grid grid-cols-4 gap-1.5">
            {(["720p", "1080p", "1440p", "2160p"] as const).map(r => (
              <button key={r} onClick={() => setTargetRes(r)}
                className={`py-2 rounded-xl border text-[11px] font-semibold transition-all ${targetRes === r ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}>
                {r}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PosePanel({ imageUrl, setImageUrl, drawMode, setDrawMode }: {
  imageUrl: string; setImageUrl: (v: string) => void;
  drawMode: string; setDrawMode: (v: string) => void;
}) {
  const modes = [
    { value: "full-pose",    label: "完整姿勢", emoji: "🧍" },
    { value: "body-pose",    label: "身體",     emoji: "💪" },
    { value: "face-pose",    label: "臉部",     emoji: "😊" },
    { value: "hand-pose",    label: "手部",     emoji: "✋" },
    { value: "face-hand-mask",label:"臉+手遮罩",emoji: "🎭" },
    { value: "face-mask",    label: "臉遮罩",   emoji: "😷" },
    { value: "hand-mask",    label: "手遮罩",   emoji: "🤚" },
  ];
  return (
    <div className="space-y-4">
      <RefImageInput label="人物圖片" value={imageUrl} onChange={setImageUrl} onClear={() => setImageUrl("")} />
      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-2 block">偵測模式</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {modes.map(m => (
            <button key={m.value} onClick={() => setDrawMode(m.value)}
              className={`p-2.5 rounded-xl border text-left text-[11px] transition-all ${drawMode === m.value ? "bg-lime-500/10 border-lime-400/50 text-lime-700 font-medium" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}>
              <span className="mr-1">{m.emoji}</span>{m.label}
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
  imageSize, setImageSize,
  negPrompt, setNegPrompt,
  guidance, setGuidance,
  inferSteps, setInferSteps,
  seed, setSeed,
  loraPath, setLoraPath,
  loraScale, setLoraScale,
  controlnetImageUrl, setControlnetImageUrl,
  controlnetPath, setControlnetPath,
  controlnetScale, setControlnetScale,
  modelId,
}: {
  imageSize: string; setImageSize: (v: string) => void;
  negPrompt: string; setNegPrompt: (v: string) => void;
  guidance: number; setGuidance: (v: number) => void;
  inferSteps: number; setInferSteps: (v: number) => void;
  seed: string; setSeed: (v: string) => void;
  loraPath: string; setLoraPath: (v: string) => void;
  loraScale: number; setLoraScale: (v: number) => void;
  controlnetImageUrl: string; setControlnetImageUrl: (v: string) => void;
  controlnetPath: string; setControlnetPath: (v: string) => void;
  controlnetScale: number; setControlnetScale: (v: number) => void;
  modelId: string;
}) {
  const [showAdv, setShowAdv] = useState(false);

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">圖片尺寸</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {IMAGE_SIZES.map(s => (
            <button key={s.value} onClick={() => setImageSize(s.value)}
              className={`py-2 px-1 rounded-xl border text-[10px] font-medium transition-all ${imageSize === s.value ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">負向提示詞</Label>
        <Textarea value={negPrompt} onChange={e => setNegPrompt(e.target.value)}
          placeholder="描述不想出現的元素（模糊、變形、低品質...）"
          className="resize-none h-16 text-xs" />
      </div>

      <button onClick={() => setShowAdv(!showAdv)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground w-full py-1">
        <Settings2 className="w-3.5 h-3.5" /> 進階設定
        {showAdv ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
      </button>

      <AnimatePresence>
        {showAdv && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-3 pt-1">
              {modelId !== "fastSdxl" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">引導強度：{guidance.toFixed(1)}</Label>
                  <Slider value={[guidance]} onValueChange={([v]) => setGuidance(v)} min={1} max={20} step={0.5} />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">推理步數：{inferSteps}</Label>
                <Slider value={[inferSteps]} onValueChange={([v]) => setInferSteps(v)} min={10} max={50} step={1} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">種子碼（Seed）</Label>
                <Input value={seed} onChange={e => setSeed(e.target.value)} placeholder="留空隨機" className="text-sm" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1 block">LoRA 路徑（HuggingFace）</Label>
                <Input value={loraPath} onChange={e => setLoraPath(e.target.value)}
                  placeholder="例：nerijs/pixel-art-xl" className="text-xs mb-1.5" />
                {loraPath && (
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">LoRA 強度：{loraScale.toFixed(1)}</Label>
                    <Slider value={[loraScale]} onValueChange={([v]) => setLoraScale(v)} min={0} max={2} step={0.1} />
                  </div>
                )}
              </div>
              {modelId === "stableDiffusion35" && (
                <div className="space-y-2 p-3 rounded-xl bg-cyan-50/50 border border-cyan-200/40">
                  <p className="text-[11px] font-medium text-cyan-700 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" /> ControlNet 設定
                  </p>
                  <div>
                    <Label className="text-[10px] text-muted-foreground mb-1 block">控制圖片 URL</Label>
                    <Input value={controlnetImageUrl} onChange={e => setControlnetImageUrl(e.target.value)}
                      placeholder="貼上骨骼圖/深度圖/邊緣圖 URL" className="text-xs" />
                  </div>
                  {controlnetImageUrl && (
                    <>
                      <div>
                        <Label className="text-[10px] text-muted-foreground mb-1 block">ControlNet 模式</Label>
                        <Select value={controlnetPath} onValueChange={setControlnetPath}>
                          <SelectTrigger className="text-xs h-8"><SelectValue placeholder="選擇控制模式" /></SelectTrigger>
                          <SelectContent>
                            {CONTROLNET_PATHS.map(p => (
                              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">控制強度：{controlnetScale.toFixed(1)}</Label>
                        <Slider value={[controlnetScale]} onValueChange={([v]) => setControlnetScale(v)} min={0} max={2} step={0.1} />
                      </div>
                    </>
                  )}
                  <p className="text-[10px] text-cyan-600/80">💡 可將 DWPose 骨骼圖 URL 直接貼入此處</p>
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
  imageUrl, setImageUrl,
  prompt3d, setPrompt3d,
  modelId,
  // Trellis
  trellisResolution, setTrellisResolution,
  trellisTextureSize, setTrellisTextureSize,
  // SAM3D
  samPrompt, setSamPrompt,
  // Hunyuan3D
  enablePbr, setEnablePbr,
  hunyuanGenType, setHunyuanGenType,
  // Rodin
  rodinQuality, setRodinQuality,
  rodinMaterial, setRodinMaterial,
  // HunyuanWorld
  labelsFg1, setLabelsFg1,
  labelsFg2, setLabelsFg2,
  worldClasses, setWorldClasses,
}: {
  imageUrl: string; setImageUrl: (v: string) => void;
  prompt3d: string; setPrompt3d: (v: string) => void;
  modelId: string;
  trellisResolution: string; setTrellisResolution: (v: string) => void;
  trellisTextureSize: string; setTrellisTextureSize: (v: string) => void;
  samPrompt: string; setSamPrompt: (v: string) => void;
  enablePbr: boolean; setEnablePbr: (v: boolean) => void;
  hunyuanGenType: "Normal" | "LowPoly" | "Geometry"; setHunyuanGenType: (v: "Normal" | "LowPoly" | "Geometry") => void;
  rodinQuality: "high" | "medium" | "low" | "extra-low"; setRodinQuality: (v: "high" | "medium" | "low" | "extra-low") => void;
  rodinMaterial: "PBR" | "Shaded"; setRodinMaterial: (v: "PBR" | "Shaded") => void;
  labelsFg1: string; setLabelsFg1: (v: string) => void;
  labelsFg2: string; setLabelsFg2: (v: string) => void;
  worldClasses: string; setWorldClasses: (v: string) => void;
}) {
  const needsImage = ["trellis2", "sam3dObjects", "hunyuan3d", "hunyuanWorld"].includes(modelId);
  const needsPrompt = ["rodin3d"].includes(modelId);
  const needsImageOrPrompt = ["rodin3d"].includes(modelId);

  return (
    <div className="space-y-4">
      {needsImage && (
        <RefImageInput label="來源圖片" value={imageUrl} onChange={setImageUrl} onClear={() => setImageUrl("")} />
      )}

      {needsImageOrPrompt && (
        <div className="space-y-2">
          <RefImageInput label="參考圖片（選填）" value={imageUrl} onChange={setImageUrl} onClear={() => setImageUrl("")} />
          <div>
            <Label className="text-xs text-muted-foreground mb-1 block">文字描述（選填，可與圖片並用）</Label>
            <Textarea value={prompt3d} onChange={e => setPrompt3d(e.target.value)}
              placeholder="描述 3D 模型，例：a futuristic robot with metallic design"
              className="resize-none h-16 text-xs" />
          </div>
        </div>
      )}

      {/* Trellis 專屬 */}
      {modelId === "trellis2" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">解析度</Label>
            <div className="flex gap-1">
              {["512", "1024", "1536"].map(r => (
                <button key={r} onClick={() => setTrellisResolution(r)}
                  className={`flex-1 py-1.5 rounded-lg border text-[10px] font-semibold transition-all ${trellisResolution === r ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">紋理尺寸</Label>
            <div className="flex gap-1">
              {["1024", "2048", "4096"].map(r => (
                <button key={r} onClick={() => setTrellisTextureSize(r)}
                  className={`flex-1 py-1.5 rounded-lg border text-[10px] font-semibold transition-all ${trellisTextureSize === r ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}>
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
          <Label className="text-xs text-muted-foreground mb-1 block">偵測目標描述</Label>
          <Input value={samPrompt} onChange={e => setSamPrompt(e.target.value)}
            placeholder="例：car, dog, bottle..." className="text-sm" />
        </div>
      )}

      {/* Hunyuan3D 專屬 */}
      {modelId === "hunyuan3d" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">啟用 PBR 材質</Label>
            <Switch checked={enablePbr} onCheckedChange={setEnablePbr} />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">生成類型</Label>
            <div className="flex gap-1.5">
              {(["Normal", "LowPoly", "Geometry"] as const).map(t => (
                <button key={t} onClick={() => setHunyuanGenType(t)}
                  className={`flex-1 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${hunyuanGenType === t ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}>
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
            <Label className="text-[10px] text-muted-foreground mb-1 block">材質</Label>
            <div className="flex gap-1">
              {(["PBR", "Shaded"] as const).map(m => (
                <button key={m} onClick={() => setRodinMaterial(m)}
                  className={`flex-1 py-1.5 rounded-lg border text-[10px] font-medium transition-all ${rodinMaterial === m ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">品質</Label>
            <Select value={rodinQuality} onValueChange={v => setRodinQuality(v as any)}>
              <SelectTrigger className="text-xs h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["high", "medium", "low", "extra-low"] as const).map(q => (
                  <SelectItem key={q} value={q}>{q}</SelectItem>
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
            <Label className="text-[10px] text-muted-foreground mb-1 block">前景物件描述 (labels_fg1)</Label>
            <Input value={labelsFg1} onChange={e => setLabelsFg1(e.target.value)}
              placeholder="前景主要物件，例：person, car" className="text-xs" />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">前景元素描述 (labels_fg2)</Label>
            <Input value={labelsFg2} onChange={e => setLabelsFg2(e.target.value)}
              placeholder="前景次要元素，例：tree, bench" className="text-xs" />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground mb-1 block">場景類別 (classes)</Label>
            <Input value={worldClasses} onChange={e => setWorldClasses(e.target.value)}
              placeholder="場景類型，例：outdoor, urban" className="text-xs" />
          </div>
        </div>
      )}

      <div className="rounded-xl bg-orange-50/50 border border-orange-200/40 p-3 text-xs text-orange-700">
        ⏱️ 3D 模型生成需要 1–5 分鐘，請耐心等候
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ImageStudio() {
  // 全站新手引導
  usePageTour("image-studio");
  const registerBgTask = useRegisterBgTask();

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
  const [controlnetPath, setControlnetPath] = useState("diffusers/controlnet-canny-sdxl-1.0");
  const [controlnetScale, setControlnetScale] = useState(1.0);

  // ── 3D ──
  const [imageUrl3d, setImageUrl3d] = useState("");
  const [prompt3d, setPrompt3d] = useState("");
  const [trellisResolution, setTrellisResolution] = useState("1024");
  const [trellisTextureSize, setTrellisTextureSize] = useState("2048");
  const [samPrompt, setSamPrompt] = useState("object");
  const [enablePbr, setEnablePbr] = useState(true);
  const [hunyuanGenType, setHunyuanGenType] = useState<"Normal" | "LowPoly" | "Geometry">("Normal");
  const [rodinQuality, setRodinQuality] = useState<"high" | "medium" | "low" | "extra-low">("medium");
  const [rodinMaterial, setRodinMaterial] = useState<"PBR" | "Shaded">("PBR");
  const [labelsFg1, setLabelsFg1] = useState("foreground objects");
  const [labelsFg2, setLabelsFg2] = useState("background elements");
  const [worldClasses, setWorldClasses] = useState("general scene");

  // ── Results ──
  const [resultImages, setResultImages] = useState<string[]>([]);
  const [result3d, setResult3d] = useState<{ glbUrl: string | null; extras?: Record<string, string | null> } | null>(null);
  const [resultPose, setResultPose] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // ── Applied Fine-tuned Model from ModelsPage ──
  const [appliedModelName, setAppliedModelName] = useState<string | null>(null);
  const [appliedTriggerWord, setAppliedTriggerWord] = useState<string | null>(null);

  // ── UI ──
  const [showHistory, setShowHistory] = useState(false);
  const [viewMode, setViewMode] = useState<"single" | "grid">("single");
  const [showSettings, setShowSettings] = useState(true);

  const model = MODELS.find(m => m.id === selectedModelId) ?? MODELS[0];
  const tabModels = MODELS.filter(m => m.category === activeTab);

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
              return prev ? `${modelData.triggerWord}, ${prev}` : modelData.triggerWord;
            });
            setLoraPath(modelData.loraUrl || "");
          }
          toast.success(`已套用角色模型「${modelData.name}」，觸發詞已自動加入提示詞`);
          sessionStorage.removeItem("applyModel");
        }
      }
    } catch {
      // silent
    }
  }, []);

  // ── tRPC mutations ──
  const mutations = {
    // T2I
    nanoBanana2:          trpc.imageStudio.nanoBanana2.useMutation(),
    nanoBananaPro:        trpc.imageStudio.nanoBananaPro.useMutation(),
    seedreamV4:           trpc.imageStudio.seedreamV4.useMutation(),
    imagen4:              trpc.imageStudio.imagen4.useMutation(),
    // Edit
    nanoBananaProEdit:    trpc.imageStudio.nanoBananaProEdit.useMutation(),
    nanoBananaEdit:       trpc.imageStudio.nanoBananaEdit.useMutation(),
    nanoBanana2Edit:      trpc.imageStudio.nanoBanana2Edit.useMutation(),
    seedreamV45Edit:      trpc.imageStudio.seedreamV45Edit.useMutation(),
    seedreamV5LiteEdit:   trpc.imageStudio.seedreamV5LiteEdit.useMutation(),
    grokEdit:             trpc.imageStudio.grokEdit.useMutation(),
    gptImage15Edit:       trpc.imageStudio.gptImage15Edit.useMutation(),
    fluxKontext:          trpc.imageStudio.fluxKontext.useMutation(),
    flux2ProEdit:         trpc.imageStudio.flux2ProEdit.useMutation(),
    // Upscale
    seedVRUpscale:        trpc.imageStudio.seedVRUpscale.useMutation(),
    // Pose
    dwPose:               trpc.imageStudio.dwPose.useMutation(),
    // SD
    stableDiffusion35:    trpc.imageStudio.stableDiffusion35.useMutation(),
    fastSdxl:             trpc.imageStudio.fastSdxl.useMutation(),
    sdLora:               trpc.imageStudio.sdLora.useMutation(),
    // 3D
    trellis2:             trpc.imageStudio.trellis2.useMutation(),
    sam3dObjects:         trpc.imageStudio.sam3dObjects.useMutation(),
    hunyuan3d:            trpc.imageStudio.hunyuan3d.useMutation(),
    rodin3d:              trpc.imageStudio.rodin3d.useMutation(),
    hunyuanWorld:         trpc.imageStudio.hunyuanWorld.useMutation(),
  } as const;

  const currentMutation = mutations[model.id as keyof typeof mutations] as any;

  const downloadImage = async (url: string) => {
    try {
      // Use server proxy to bypass CORS restrictions on CDN URLs
      const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(url)}`;
      const resp = await fetch(proxyUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const ext = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
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

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setResultImages([]);
    setResult3d(null);
    setResultPose(null);

    const vibeKw = vibeIds.map(id => VIBE_CARDS.find(v => v.id === id)?.keywords).filter(Boolean).join(", ");
    const fullPrompt = prompt && vibeKw ? `${prompt}, ${vibeKw}` : (prompt || vibeKw);
    const seedNum = seed ? parseInt(seed) : undefined;
    const extraValid = extraRefUrls.filter(u => u.trim());

    try {
      let input: any;
      let result: any;

      // ── T2I ──
      if (model.id === "nanoBanana2") {
        input = { prompt: fullPrompt, aspect_ratio: aspectRatio as any, num_images: numImages, ...(extraValid.length && { image_urls: extraValid }) };
        if (!fullPrompt) { toast.error("請輸入提示詞"); return; }
      } else if (model.id === "nanoBananaPro") {
        input = { prompt: fullPrompt, aspect_ratio: aspectRatio as any, num_images: numImages, ...(extraValid.length && { image_urls: extraValid }) };
        if (!fullPrompt) { toast.error("請輸入提示詞"); return; }
      } else if (model.id === "seedreamV4") {
        input = { prompt: fullPrompt, aspect_ratio: aspectRatio as any, num_images: numImages, ...(negPrompt && { negative_prompt: negPrompt }) };
        if (!fullPrompt) { toast.error("請輸入提示詞"); return; }
      } else if (model.id === "imagen4") {
        input = { prompt: fullPrompt, aspect_ratio: aspectRatio as any, num_images: numImages, ...(negPrompt && { negative_prompt: negPrompt }) };
        if (!fullPrompt) { toast.error("請輸入提示詞"); return; }
      }
      // ── Edit ──
      else if (model.id === "nanoBananaProEdit") {
        if (!fullPrompt || !refImageUrl) { toast.error("請輸入提示詞和參考圖片"); return; }
        input = { prompt: fullPrompt, image_url: refImageUrl, image_urls: extraValid.length ? extraValid : undefined };
      } else if (model.id === "nanoBananaEdit") {
        if (!fullPrompt || !refImageUrl) { toast.error("請輸入提示詞和參考圖片"); return; }
        input = { prompt: fullPrompt, image_url: refImageUrl, image_urls: extraValid.length ? extraValid : undefined };
      } else if (model.id === "nanoBanana2Edit") {
        if (!fullPrompt || !refImageUrl) { toast.error("請輸入提示詞和參考圖片"); return; }
        input = { prompt: fullPrompt, image_url: refImageUrl, image_urls: extraValid.length ? extraValid : undefined, aspect_ratio: "auto" as any };
      } else if (model.id === "seedreamV45Edit") {
        if (!fullPrompt || !refImageUrl) { toast.error("請輸入提示詞和參考圖片"); return; }
        input = { prompt: fullPrompt, image_url: refImageUrl, strength };
      } else if (model.id === "seedreamV5LiteEdit") {
        if (!fullPrompt || !refImageUrl) { toast.error("請輸入提示詞和參考圖片"); return; }
        input = { prompt: fullPrompt, image_url: refImageUrl, strength };
      } else if (model.id === "grokEdit") {
        if (!fullPrompt || !refImageUrl) { toast.error("請輸入提示詞和參考圖片"); return; }
        input = { prompt: fullPrompt, image_url: refImageUrl };
      } else if (model.id === "gptImage15Edit") {
        if (!fullPrompt || !refImageUrl) { toast.error("請輸入提示詞和參考圖片"); return; }
        input = { prompt: fullPrompt, image_url: refImageUrl, size: outputSize as any, ...(maskUrl && { mask_url: maskUrl }) };
      } else if (model.id === "fluxKontext") {
        if (!fullPrompt || !refImageUrl) { toast.error("請輸入提示詞和參考圖片"); return; }
        input = { prompt: fullPrompt, image_url: refImageUrl, guidance_scale: guidance, num_inference_steps: inferSteps, ...(seedNum && { seed: seedNum }) };
      } else if (model.id === "flux2ProEdit") {
        if (!fullPrompt || !refImageUrl) { toast.error("請輸入提示詞和參考圖片"); return; }
        input = { prompt: fullPrompt, image_url: refImageUrl, image_urls: extraValid.length ? extraValid : undefined, ...(seedNum && { seed: seedNum }) };
      }
      // ── Upscale ──
      else if (model.id === "seedVRUpscale") {
        if (!upscaleImageUrl) { toast.error("請提供要放大的圖片"); return; }
        input = {
          image_url: upscaleImageUrl,
          upscale_mode: upscaleMode,
          upscale_factor: upscaleFactor,
          target_resolution: targetRes as any,
        };
      }
      // ── Pose ──
      else if (model.id === "dwPose") {
        if (!poseImageUrl) { toast.error("請提供人物圖片"); return; }
        input = { image_url: poseImageUrl, draw_mode: drawMode as any };
      }
      // ── SD ──
      else if (model.id === "stableDiffusion35") {
        if (!fullPrompt) { toast.error("請輸入提示詞"); return; }
        input = {
          prompt: fullPrompt, negative_prompt: negPrompt,
          num_inference_steps: sdInferSteps, guidance_scale: sdGuidance,
          num_images: numImages, image_size: sdImageSize as any,
          ...(sdSeed && { seed: parseInt(sdSeed) }),
          ...(loraPath && { lora_path: loraPath, lora_scale: loraScale }),
          ...(controlnetImageUrl && controlnetPath && { controlnet_image_url: controlnetImageUrl, controlnet_path: controlnetPath, controlnet_scale: controlnetScale }),
        };
      } else if (model.id === "fastSdxl") {
        if (!fullPrompt) { toast.error("請輸入提示詞"); return; }
        input = {
          prompt: fullPrompt, negative_prompt: negPrompt,
          image_size: sdImageSize as any, num_images: numImages,
          ...(sdSeed && { seed: parseInt(sdSeed) }),
          ...(loraPath && { lora_path: loraPath, lora_scale: loraScale }),
        };
      } else if (model.id === "sdLora") {
        if (!fullPrompt) { toast.error("請輸入提示詞"); return; }
        input = {
          prompt: fullPrompt, negative_prompt: negPrompt,
          image_size: sdImageSize as any, num_images: numImages,
          ...(sdSeed && { seed: parseInt(sdSeed) }),
          ...(loraPath && { loras: [{ path: loraPath, scale: loraScale }] }),
        };
      }
      // ── 3D ──
      else if (model.id === "trellis2") {
        if (!imageUrl3d) { toast.error("請提供來源圖片"); return; }
        input = { image_url: imageUrl3d, resolution: trellisResolution as any, texture_size: trellisTextureSize as any };
      } else if (model.id === "sam3dObjects") {
        if (!imageUrl3d) { toast.error("請提供來源圖片"); return; }
        input = { image_url: imageUrl3d, prompt: samPrompt, export_textured_glb: true };
      } else if (model.id === "hunyuan3d") {
        if (!imageUrl3d) { toast.error("請提供來源圖片"); return; }
        input = { input_image_url: imageUrl3d, enable_pbr: enablePbr, generate_type: hunyuanGenType };
      } else if (model.id === "rodin3d") {
        if (!prompt3d && !imageUrl3d) { toast.error("請提供文字描述或參考圖片"); return; }
        input = { prompt: prompt3d, image_urls: imageUrl3d ? [imageUrl3d] : undefined, material: rodinMaterial, quality: rodinQuality };
      } else if (model.id === "hunyuanWorld") {
        if (!imageUrl3d) { toast.error("請提供來源圖片"); return; }
        input = { image_url: imageUrl3d, labels_fg1: labelsFg1, labels_fg2: labelsFg2, classes: worldClasses };
      }

      result = await currentMutation.mutateAsync(input);
      registerBgTask(result, "image", `🖼️ ${model.name}`);

      // 若為非同步任務（只有 request_id），不嘗試提取結果，直接提示並回傳
      const isAsyncResult = !!(result?.raw?.request_id || result?.raw?.is_async_polling);
      if (isAsyncResult) {
        toast.success("📤 任務已提交！背景生成中，完成後會自動通知你");
        return;
      }

      // Handle 3D result
      if (model.category === "3d") {
        const glb = result?.model_glb_url || null;
        const extras: Record<string, string | null> = {};
        if (result?.gaussian_splat_url) extras["Gaussian PLY"] = result.gaussian_splat_url;
        if (result?.artifacts_zip_url)  extras["ZIP 壓縮包"] = result.artifacts_zip_url;
        if (result?.model_urls?.obj)    extras["OBJ"]    = result.model_urls.obj;
        if (result?.model_urls?.usdz)   extras["USDZ"]   = result.model_urls.usdz;
        if (result?.model_urls?.fbx)    extras["FBX"]    = result.model_urls.fbx;
        if (result?.world_file_url)     extras["World"]  = result.world_file_url;
        if (result?.textures?.length)   extras["紋理 ZIP"] = result.textures[0] || null;
        setResult3d({ glbUrl: glb, extras: Object.keys(extras).length ? extras : undefined });
        if (glb) toast.success("3D 模型生成完成！");
        else toast.warning("3D 生成完成，但未找到 GLB 檔案，請查看 extras");
        return;
      }

      // Handle Pose result
      if (model.category === "pose") {
        const poseUrl = result?.pose_image_url || null;
        if (poseUrl) {
          setResultPose(poseUrl);
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
      setResultImages(imgs);
      toast.success(`✨ 生成完成！（${imgs.length} 張）`);

      addToHistory({
        prompt: fullPrompt || upscaleImageUrl || poseImageUrl || imageUrl3d,
        imageUrl: imgs[0],
        modelId: model.id, modelName: model.name,
        params: { aspectRatio, negPrompt, strength, guidance, inferSteps, numImages, seed, refImageUrl },
      });

    } catch (err: any) {
      toast.error(`生成失敗：${err?.message ?? "未知錯誤"}`);
    } finally {
      setIsGenerating(false);
    }
  }, [
    model, prompt, vibeIds, aspectRatio, numImages, seed,
    refImageUrl, extraRefUrls, maskUrl, strength, guidance, inferSteps, outputSize,
    upscaleImageUrl, upscaleMode, upscaleFactor, targetRes,
    poseImageUrl, drawMode,
    sdImageSize, negPrompt, sdGuidance, sdInferSteps, sdSeed,
    loraPath, loraScale, controlnetImageUrl, controlnetPath, controlnetScale,
    imageUrl3d, prompt3d, trellisResolution, trellisTextureSize,
    samPrompt, enablePbr, hunyuanGenType,
    rodinQuality, rodinMaterial, labelsFg1, labelsFg2, worldClasses,
    currentMutation,
  ]);

  const handleReuseHistory = (item: HistoryItem) => {
    setPrompt(item.prompt);
    const m = MODELS.find(m => m.id === item.modelId);
    if (m) { setSelectedModelId(item.modelId); setActiveTab(m.category); }
    const p = item.params as any;
    if (p.aspectRatio) setAspectRatio(p.aspectRatio);
    if (p.negPrompt)   setNegPrompt(p.negPrompt);
    if (p.strength)    setStrength(p.strength);
    if (p.guidance)    setGuidance(p.guidance);
    if (p.inferSteps)  setInferSteps(p.inferSteps);
    if (p.numImages)   setNumImages(p.numImages);
    if (p.seed)        setSeed(p.seed);
    if (p.refImageUrl) setRefImageUrl(p.refImageUrl);
    setShowHistory(false);
    toast.success("已載入歷史參數");
  };

  const generateBtnLabel = () => {
    if (isGenerating) return "AI 生成中，請稍候...";
    if (activeTab === "upscale") return "開始放大";
    if (activeTab === "pose")    return "偵測骨骼姿勢";
    if (activeTab === "3d")      return "生成 3D 模型";
    return `開始生成`;
  };

  const gradientBtn = `bg-gradient-to-r ${tabColor(activeTab)} hover:opacity-90`;

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-10">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shrink-0">
            <Image className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">圖片創作室</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              fal.ai 23 大模型 — 文字生圖・圖片編輯・影像放大・骨骼姿勢・Stable Diffusion・圖片轉3D
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setViewMode(v => v === "single" ? "grid" : "single")}
            className="p-2.5 rounded-xl border border-border/40 hover:bg-accent active:bg-accent/70 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center" title="切換檢視">
            {viewMode === "single" ? <Grid3x3 className="w-4 h-4" /> : <Image className="w-4 h-4" />}
          </button>
          <button onClick={() => setShowHistory(!showHistory)}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-medium transition-all min-h-[44px] ${
              showHistory ? "bg-primary text-primary-foreground border-primary" : "border-border/40 hover:bg-accent active:bg-accent/70 text-muted-foreground"
            }`}>
            <History className="w-3.5 h-3.5" /> <span className="hidden sm:inline">歷史 / 精選</span><span className="sm:hidden">歷史</span>
          </button>
        </div>
      </div>

      <ApiKeyBanner />

      {/* ── Tab Bar ── */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar -mx-1 px-1">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-3 sm:py-2.5 rounded-2xl border whitespace-nowrap text-xs font-medium transition-all shrink-0 min-h-[44px] ${
                active
                  ? `bg-gradient-to-r ${tabColor(tab.id)} text-white border-transparent shadow-md`
                  : "bg-background border-border/40 text-muted-foreground hover:bg-accent active:bg-accent"
              }`}>
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? "bg-white/20" : "bg-muted text-muted-foreground"}`}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Main Layout ── */}
      <div className="flex flex-col sm:flex-row gap-4">

        {/* ── Left: Control Panel ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Model Selection */}
          <div className="rounded-2xl border border-border/30 p-3 bg-background/60">
            <p className="text-xs font-medium text-muted-foreground mb-2">選擇模型（{tabModels.length} 個）</p>
            <div className={`grid gap-2 ${tabModels.length <= 2 ? "grid-cols-1 sm:grid-cols-2" : tabModels.length <= 4 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
              {tabModels.map(m => (
                <button key={m.id} onClick={() => setSelectedModelId(m.id)}
                  className={`p-3 rounded-xl border text-left transition-all relative overflow-hidden ${
                    selectedModelId === m.id
                      ? `bg-gradient-to-br ${colorClass(m.color)} border-primary/40 shadow-sm`
                      : "bg-background border-border/30 hover:bg-accent/30"
                  }`}>
                  {m.fast && <span className="absolute top-1.5 right-1.5"><Zap className="w-2.5 h-2.5 text-amber-500" /></span>}
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <p className="text-xs font-semibold leading-tight">{m.name}</p>
                    {selectedModelId === m.id && <Check className="w-3 h-3 text-primary ml-auto shrink-0" />}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-snug">{m.desc}</p>
                  <div className="flex items-center gap-1 mt-1.5">
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0">{m.badge}</Badge>
                    <a href={`https://fal.ai/models/${m.falId}`} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="ml-auto text-[9px] text-muted-foreground/50 hover:text-primary transition-colors flex items-center gap-0.5">
                      <ExternalLink className="w-2 h-2" />文檔
                    </a>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Tab-specific panels */}

          {/* T2I — Prompt + Settings */}
          {activeTab === "t2i" && (
            <>
              {/* Applied Model Banner */}
              {appliedModelName && (
                <div className="rounded-xl border border-amber-200/60 bg-amber-50/60 dark:bg-amber-900/20 px-3 py-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Cpu className="w-3.5 h-3.5 text-amber-600" />
                    <span className="font-medium text-amber-700 dark:text-amber-400">角色模型：{appliedModelName}</span>
                    {appliedTriggerWord && (
                      <code className="text-[10px] bg-amber-100 dark:bg-amber-800/40 px-1.5 py-0.5 rounded text-amber-700 dark:text-amber-300 font-mono">{appliedTriggerWord}</code>
                    )}
                  </div>
                  <button onClick={() => { setAppliedModelName(null); setAppliedTriggerWord(null); }} className="text-amber-500 hover:text-amber-700 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="rounded-2xl border border-border/30 p-4 bg-background/60">
                <PromptBuilder value={prompt} onChange={setPrompt} vibeIds={vibeIds} onVibeChange={setVibeIds} />
              </div>
              <div className="rounded-2xl border border-border/30 p-4 bg-background/60 space-y-3">
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Settings2 className="w-3.5 h-3.5 text-muted-foreground" /> 生成設定
                </p>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">畫面比例</Label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {ASPECT_RATIOS.map(ar => (
                      <button key={ar.value} onClick={() => setAspectRatio(ar.value)}
                        className={`p-2 rounded-xl border text-center transition-all ${aspectRatio === ar.value ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 hover:bg-accent text-muted-foreground"}`}>
                        <p className="text-[11px] font-semibold">{ar.label}</p>
                        <p className="text-[9px] opacity-60">{ar.hint}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs font-medium text-muted-foreground mb-1 block">生成數量</Label>
                  <div className="flex gap-1.5">
                    {[1, 2, 4].map(n => (
                      <button key={n} onClick={() => setNumImages(n)}
                        className={`flex-1 py-2 rounded-xl border text-xs font-semibold transition-all ${numImages === n ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}>
                        {n} 張
                      </button>
                    ))}
                  </div>
                </div>
                {model.supportsNeg && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">負向提示詞</Label>
                    <Textarea value={negPrompt} onChange={e => setNegPrompt(e.target.value)}
                      placeholder="描述不想出現的元素" className="resize-none h-14 text-xs" />
                  </div>
                )}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">種子碼（Seed）</Label>
                  <Input value={seed} onChange={e => setSeed(e.target.value)} placeholder="留空隨機生成" className="text-sm" />
                </div>
                {model.supportsMultiRef && (
                  <div className="mt-2">
                    <Label className="text-xs text-muted-foreground mb-1 block">多圖參考（選填，最多 14 張）</Label>
                    {extraRefUrls.map((url, i) => (
                      <div key={i} className="flex gap-1.5 mb-1">
                        <Input value={url} onChange={e => { const n = [...extraRefUrls]; n[i] = e.target.value; setExtraRefUrls(n); }}
                          placeholder={`參考圖 ${i + 1}`} className="text-xs flex-1" />
                        <button onClick={() => setExtraRefUrls(extraRefUrls.filter((_, j) => j !== i))}
                          className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {extraRefUrls.length < 14 && (
                      <button onClick={() => setExtraRefUrls([...extraRefUrls, ""])}
                        className="w-full text-xs py-1.5 rounded-xl border border-dashed border-border/60 text-muted-foreground hover:border-primary/40 flex items-center justify-center gap-1.5 transition-colors">
                        <Plus className="w-3 h-3" /> 新增參考圖
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Edit — Ref Image + Prompt + Settings */}
          {activeTab === "edit" && (
            <>
              <div className={`rounded-2xl border p-4 bg-gradient-to-br ${colorClass(model.color)}`}>
                <RefImageInput
                  label="原始圖片（待編輯）"
                  value={refImageUrl} onChange={setRefImageUrl} onClear={() => setRefImageUrl("")}
                  multiple={model.supportsMultiRef} extraUrls={extraRefUrls} onExtraUrlsChange={setExtraRefUrls}
                />
                {model.supportsMask && (
                  <div className="mt-3">
                    <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">遮罩圖片（Mask，選填）</Label>
                    <Input value={maskUrl} onChange={e => setMaskUrl(e.target.value)}
                      placeholder="白色=編輯，黑色=保留" className="text-sm" />
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-border/30 p-4 bg-background/60">
                <PromptBuilder value={prompt} onChange={setPrompt} vibeIds={vibeIds} onVibeChange={setVibeIds} />
              </div>
              <div className="rounded-2xl border border-border/30 p-4 bg-background/60 space-y-3">
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Settings2 className="w-3.5 h-3.5 text-muted-foreground" /> 編輯設定
                </p>
                {model.supportsStrength && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">編輯強度：{strength.toFixed(2)}</Label>
                    <Slider value={[strength]} onValueChange={([v]) => setStrength(v)} min={0.1} max={1} step={0.05} />
                    <div className="flex justify-between text-[10px] text-muted-foreground/60"><span>保留原圖</span><span>完全重繪</span></div>
                  </div>
                )}
                {model.supportsSize && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">輸出尺寸</Label>
                    <Select value={outputSize} onValueChange={setOutputSize}>
                      <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">自動選擇</SelectItem>
                        <SelectItem value="1024x1024">1024×1024（正方形）</SelectItem>
                        <SelectItem value="1536x1024">1536×1024（橫式）</SelectItem>
                        <SelectItem value="1024x1536">1024×1536（直式）</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {model.supportsGuidance && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">引導強度：{guidance.toFixed(1)}</Label>
                      <Slider value={[guidance]} onValueChange={([v]) => setGuidance(v)} min={1} max={30} step={0.5} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">推理步數：{inferSteps}</Label>
                      <Slider value={[inferSteps]} onValueChange={([v]) => setInferSteps(v)} min={10} max={50} step={1} />
                    </div>
                  </>
                )}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">種子碼（Seed）</Label>
                  <Input value={seed} onChange={e => setSeed(e.target.value)} placeholder="留空隨機" className="text-sm" />
                </div>
              </div>
            </>
          )}

          {/* Upscale */}
          {activeTab === "upscale" && (
            <div className="rounded-2xl border border-sky-200/50 p-4 bg-sky-50/20">
              <UpscalePanel
                imageUrl={upscaleImageUrl} setImageUrl={setUpscaleImageUrl}
                upscaleMode={upscaleMode} setUpscaleMode={setUpscaleMode}
                upscaleFactor={upscaleFactor} setUpscaleFactor={setUpscaleFactor}
                targetRes={targetRes} setTargetRes={setTargetRes}
              />
            </div>
          )}

          {/* Pose */}
          {activeTab === "pose" && (
            <div className="rounded-2xl border border-lime-200/50 p-4 bg-lime-50/20">
              <PosePanel
                imageUrl={poseImageUrl} setImageUrl={setPoseImageUrl}
                drawMode={drawMode} setDrawMode={setDrawMode}
              />
            </div>
          )}

          {/* SD */}
          {activeTab === "sd" && (
            <>
              <div className="rounded-2xl border border-border/30 p-4 bg-background/60">
                <PromptBuilder value={prompt} onChange={setPrompt} vibeIds={vibeIds} onVibeChange={setVibeIds} />
              </div>
              <div className="rounded-2xl border border-cyan-200/50 p-4 bg-cyan-50/20">
                <SDPanel
                  imageSize={sdImageSize} setImageSize={setSdImageSize}
                  negPrompt={negPrompt} setNegPrompt={setNegPrompt}
                  guidance={sdGuidance} setGuidance={setSdGuidance}
                  inferSteps={sdInferSteps} setInferSteps={setSdInferSteps}
                  seed={sdSeed} setSeed={setSdSeed}
                  loraPath={loraPath} setLoraPath={setLoraPath}
                  loraScale={loraScale} setLoraScale={setLoraScale}
                  controlnetImageUrl={controlnetImageUrl} setControlnetImageUrl={setControlnetImageUrl}
                  controlnetPath={controlnetPath} setControlnetPath={setControlnetPath}
                  controlnetScale={controlnetScale} setControlnetScale={setControlnetScale}
                  modelId={selectedModelId}
                />
              </div>
            </>
          )}

          {/* 3D */}
          {activeTab === "3d" && (
            <div className="rounded-2xl border border-orange-200/50 p-4 bg-orange-50/20">
              <ThreeDPanel
                imageUrl={imageUrl3d} setImageUrl={setImageUrl3d}
                prompt3d={prompt3d} setPrompt3d={setPrompt3d}
                modelId={selectedModelId}
                trellisResolution={trellisResolution} setTrellisResolution={setTrellisResolution}
                trellisTextureSize={trellisTextureSize} setTrellisTextureSize={setTrellisTextureSize}
                samPrompt={samPrompt} setSamPrompt={setSamPrompt}
                enablePbr={enablePbr} setEnablePbr={setEnablePbr}
                hunyuanGenType={hunyuanGenType} setHunyuanGenType={setHunyuanGenType}
                rodinQuality={rodinQuality} setRodinQuality={setRodinQuality}
                rodinMaterial={rodinMaterial} setRodinMaterial={setRodinMaterial}
                labelsFg1={labelsFg1} setLabelsFg1={setLabelsFg1}
                labelsFg2={labelsFg2} setLabelsFg2={setLabelsFg2}
                worldClasses={worldClasses} setWorldClasses={setWorldClasses}
              />
            </div>
          )}

          {/* SD num images */}
          {activeTab === "sd" && (
            <div className="rounded-2xl border border-border/30 p-3 bg-background/60">
              <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">生成數量</Label>
              <div className="flex gap-1.5">
                {[1, 2, 4].map(n => (
                  <button key={n} onClick={() => setNumImages(n)}
                    className={`flex-1 py-2 rounded-xl border text-xs font-semibold transition-all ${numImages === n ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/40 text-muted-foreground hover:bg-accent"}`}>
                    {n} 張
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Generate Button */}
          <Button onClick={handleGenerate} disabled={isGenerating}
            className={`w-full h-14 rounded-2xl text-base font-semibold gap-3 shadow-lg hover:shadow-xl transition-all text-white ${gradientBtn}`}>
            {isGenerating
              ? <><Loader2 className="w-5 h-5 animate-spin" />{generateBtnLabel()}</>
              : <><Wand2 className="w-5 h-5" />{generateBtnLabel()}<span className="opacity-60 text-sm ml-1">({model.name})</span></>
            }
          </Button>

          {/* Results */}
          <AnimatePresence>
            {resultImages.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                className={viewMode === "grid" && resultImages.length > 1 ? "grid grid-cols-2 gap-3" : "space-y-3"}>
                {resultImages.map((url, i) => (
                  <ResultImage key={i} url={url} prompt={prompt} onDownload={() => downloadImage(url)} />
                ))}
              </motion.div>
            )}
            {result3d && (
              <Model3DResult glbUrl={result3d.glbUrl} extras={result3d.extras} />
            )}
            {resultPose && (
              <PoseResult poseUrl={resultPose} prompt={poseImageUrl} />
            )}
          </AnimatePresence>
        </div>

        {/* ── Right: History Panel ── */}
        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ width: 0, opacity: 0 }} animate={{ width: "min(280px, 85vw)", opacity: 1 }} exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="shrink-0 overflow-hidden rounded-2xl border border-border/30 bg-background/60 flex flex-col"
              style={{ maxHeight: "calc(100vh - 200px)", position: "sticky", top: "1rem" }}>
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/20">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <History className="w-4 h-4 text-primary" /> 歷史 / 精選
                </div>
                <button onClick={() => setShowHistory(false)} className="p-2 sm:p-1 hover:bg-accent active:bg-accent/70 rounded-md">
                  <X className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-muted-foreground" />
                </button>
              </div>
              <HistoryPanel onReuse={handleReuseHistory} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Footer ── */}
      <div className="text-center py-4 border-t border-border/40">
        <p className="text-[11px] text-muted-foreground/60">
          Powered by fal.ai · Gemini · FLUX · SeeDream · Imagen4 · Grok · GPT Image · Stable Diffusion · Trellis · SAM3D · HunyuanWorld
        </p>
        <p className="text-[10px] text-muted-foreground/40 mt-1">
          歷史記錄儲存於瀏覽器本地（最多 50 筆）· 23 個 fal.ai 模型
        </p>
      </div>
    </div>
  );
}
