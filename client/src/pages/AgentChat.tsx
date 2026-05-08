/**
 * AgentChat.tsx — Phase 2a 全頁光球代理人聊天緩衝頁（/agent）
 * ────────────────────────────────────────────────────────────────────────────
 * 目的：給新進或猶豫中的使用者一個「先說話，再看頁面」的入口。
 *   - 不密密麻麻 — 置中、留白、呼吸感
 *   - 用 Phase 1.5 的 ai.chat（MiniMax M2.7）、結構化 pageSnapshot、
 *     意圖確認卡（AgentIntentPreview）、回饋 bus
 *   - 光球回覆的 [ACTION:navigate:/path] 會真的把使用者帶去目標頁
 *   - [ACTION:submit/reset/applyPreset/...] 會走確認閘，不會一鍵執行
 *   - [SUGGEST:...] 變成柔軟的快速回覆按鈕，讓使用者不用自己打字
 *
 * 這頁同時也是 Phase 2 第一個接入 PageAgent bus 的頁面，
 * useRegisterPageAgent 裡宣告的「能力」只是「引導去其他頁」——
 * 故意保持極簡，所有動作都轉給對應頁面的 handler 或走 navigate。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Loader2,
  ArrowRight,
  ChevronDown,
  Clock3,
  Paperclip,
  X,
  Settings2,
  Sparkles,
  Eraser,
  Workflow,
  ListChecks,
  CornerUpRight,
  HelpCircle,
  Brush,
  Wand2,
  Image as ImageIcon,
  Film,
  Music,
  Mic2,
  Clapperboard,
  FolderHeart,
  GraduationCap,
  Layers,
  BookOpen,
  Calendar,
  Users,
  Compass,
  MessageCircle,
  Play,
  type LucideIcon,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePersonality } from "@/contexts/PersonalityContext";
import VisualSoul from "@/components/VisualSoul";
import {
  parseLLMActions,
  usePageAgent,
  useRegisterPageAgent,
  type AgentAction,
} from "@/contexts/PageAgentContext";
import { useOrbGuide, INTENT_CONFIGS, type GuideIntent } from "@/contexts/OrbGuideContext";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getAgentHomeEntries } from "@/config/appRegistry";
import {
  useGlobalOrbChat,
  ClarificationPromptCard,
  WorkflowConfirmationCard,
  WorkflowExecutionFloatingPanel,
} from "@/contexts/GlobalOrbChatContext";
import { inferSuggestionEmoji } from "@/lib/orbChatHelpers";
import { useOrbAttachments, attachmentKindEmoji } from "@/hooks/useOrbAttachments";
import { ORB_UPLOAD_ACCEPT } from "../../../shared/orb-chat-multimodal";
import { toast } from "sonner";
import AgentSettingsSheet from "@/components/AgentSettingsSheet";
import ChatMessageText from "@/components/ChatMessageText";
import type { IntentOption } from "@/lib/intentOptions";
import OrbSearchResultsCard from "@/components/orb/OrbSearchResultsCard";

// ─── 型別 ─────────────────────────────────────────────────────────────────

type ChatRole = "user" | "orb";
interface ChatMessage {
  role: ChatRole;
  text: string;
  at: number;
  /** 光球此輪附上的意圖摘要（若有） */
  intent?: string;
}

type StarterQuickAction = {
  id: string;
  label: string;
  description: string;
  path?: string;
  action?: AgentAction;
  prompt?: string;
};

type StarterEntry = {
  id: string;
  label: string;
  path: string;
  description: string;
  group: "create" | "train" | "project" | "assets" | "learn" | "orb" | "settings" | "admin";
  quickAction?: StarterQuickAction;
  quickActions: StarterQuickAction[];
  prompt?: string;
  starterText: string;
};

// ─── 依人格挑選柔軟的開場問候 ───────────────────────────────────────────

const GREETINGS: Record<string, string[]> = {
  calm: [
    "嗨 🌿 我是光球。先跟我說想完成的成果、要用在哪裡，我會陪你慢慢找到對的入口。",
    "歡迎來到這裡 ✨ 有什麼想做的嗎？告訴我目標、手上素材或限制，我一步步帶你。",
  ],
  creative: [
    "嗨！我是光球 🌸 今天腦海裡想生成什麼？用在什麼場合？告訴我一些線索，我幫你配好流程。",
    "你來啦 ✨ 先說說想要的成品、風格或靈感來源，我會問幾個小問題，帶你去對的頁面試做看。",
  ],
  technical: [
    "嗨，我是光球 🌿 告訴我想要的輸出、用途與手邊素材，我幫你挑模型、參數和頁面。",
    "歡迎 ✨ 先說需求與限制（格式、時長、設備），我會拆解成步驟並引導操作。",
  ],
};

const AGENT_HOME_ENTRIES = getAgentHomeEntries();

const NEED_CLUES = [
  "想要的成品與用途（平台/受眾/格式）",
  "尺寸/長寬比/時長/檔案格式",
  "手上已有的素材或參考（圖片、影片、腳本、聲音）",
  "限制條件（設備、時間、風格偏好、點數預算）",
];

/**
 * 「如何使用」分步說明 — 在第一輪對話前展開，告訴使用者怎麼跟光球互動，
 * 才不會打開頁面只看到一句「先聊聊看就好」就不知道下一步要做什麼。
 */
const HOW_TO_STEPS: Array<{ title: string; description: string }> = [
  {
    title: "1. 用一句話告訴光球目標",
    description:
      "直接打字、貼圖、附素材都可以。例：「我要做 30 秒 IG Reels 預告，已有 3 張產品照」。",
  },
  {
    title: "2. 回答光球的反問",
    description:
      "光球會先問尺寸、風格、限制 — 模糊的地方它會繼續確認，不會自己亂猜。",
  },
  {
    title: "3. 看到「意圖卡」再決定要不要動",
    description:
      "送出、套預設、跨頁這類動作會先彈卡片給你看。確認沒問題再按，光球才會真的執行。",
  },
  {
    title: "4. 點下方意圖卡跳到對的工具頁",
    description:
      "「圖片 / 影片 / 音樂 / 配音 / 腳本 / LoRA」按下去會帶你到對應頁，光球會繼續陪你完成。",
  },
  {
    title: "5. 隨時叫光球幫你跑長期任務",
    description:
      "右上角「代理設定」可以開排程，例如「每天早上整理昨日生成紀錄」— 光球會自己跑、出事再叫你。",
  },
];

const NEED_PROMPTS = [
  "我想做 ______，要用在 ______。目前有／沒有素材 ______，限制是 ______。請幫我決定先去哪個頁面並帶我做第一步。",
  "我想把這張圖做成影片，最終想在 IG Reels 用。幫我安排流程、比例與模型，先帶我去適合的頁面。",
  "我要做一支 ______ 秒的影片，受眾是 ______。我有的素材：______。請問要先去哪裡、按哪些按鈕？",
];

// ─── 視覺資源 ─────────────────────────────────────────────────────────
//
// 每個意圖／工作室都有自己的識別色與圖示。這個 map 取代了過去純文字
// 列表的呆板感，讓使用者一眼就能用視覺定位到要去的地方。
//
// 命名規則：tailwind class 字串而非物件 — 直接組進 className 比較快。

type IntentVisual = {
  gradient: string;
  glow: string;
  ring: string;
  shortHint: string;
};

const INTENT_VISUALS: Record<Exclude<GuideIntent, null>, IntentVisual> = {
  image: {
    gradient: "from-rose-400 via-pink-500 to-fuchsia-500",
    glow: "shadow-rose-200/60 dark:shadow-rose-900/40",
    ring: "ring-rose-200/70 dark:ring-rose-700/50",
    shortHint: "海報 · 風景 · 角色",
  },
  video: {
    gradient: "from-orange-400 via-amber-500 to-yellow-500",
    glow: "shadow-orange-200/60 dark:shadow-orange-900/40",
    ring: "ring-orange-200/70 dark:ring-orange-700/50",
    shortHint: "Reels · 動態 · 短片",
  },
  music: {
    gradient: "from-violet-400 via-indigo-500 to-blue-500",
    glow: "shadow-violet-200/60 dark:shadow-violet-900/40",
    ring: "ring-violet-200/70 dark:ring-violet-700/50",
    shortHint: "BGM · 配樂 · 環境",
  },
  voice: {
    gradient: "from-cyan-400 via-teal-500 to-emerald-500",
    glow: "shadow-cyan-200/60 dark:shadow-cyan-900/40",
    ring: "ring-cyan-200/70 dark:ring-cyan-700/50",
    shortHint: "TTS · 旁白 · 克隆",
  },
  script: {
    gradient: "from-emerald-400 via-green-500 to-lime-500",
    glow: "shadow-emerald-200/60 dark:shadow-emerald-900/40",
    ring: "ring-emerald-200/70 dark:ring-emerald-700/50",
    shortHint: "故事 · 分鏡 · 旁白",
  },
  lora: {
    gradient: "from-fuchsia-400 via-purple-500 to-pink-500",
    glow: "shadow-fuchsia-200/60 dark:shadow-fuchsia-900/40",
    ring: "ring-fuchsia-200/70 dark:ring-fuchsia-700/50",
    shortHint: "角色 · 風格 · 訓練",
  },
  explore: {
    gradient: "from-sky-400 via-blue-500 to-indigo-500",
    glow: "shadow-sky-200/60 dark:shadow-sky-900/40",
    ring: "ring-sky-200/70 dark:ring-sky-700/50",
    shortHint: "讓光球帶路",
  },
};

type StudioVisual = {
  icon: LucideIcon;
  gradient: string;
  glow: string;
  bg: string;
};

// 工作室視覺：用色塊 + 圖示取代過去的冗長文字卡片，讓「全站能力地圖」
// 一眼可讀。fallback 用泛綠色保證未列出的頁面也不會破版。
const STUDIO_VISUALS: Record<string, StudioVisual> = {
  create: {
    icon: Layers,
    gradient: "from-emerald-400 to-teal-500",
    glow: "shadow-emerald-200/50 dark:shadow-emerald-900/30",
    bg: "from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20",
  },
  studio: {
    icon: Brush,
    gradient: "from-sky-400 to-blue-500",
    glow: "shadow-sky-200/50 dark:shadow-sky-900/30",
    bg: "from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20",
  },
  playground: {
    icon: Wand2,
    gradient: "from-fuchsia-400 to-purple-500",
    glow: "shadow-fuchsia-200/50 dark:shadow-fuchsia-900/30",
    bg: "from-fuchsia-50 to-purple-50 dark:from-fuchsia-900/20 dark:to-purple-900/20",
  },
  "image-studio": {
    icon: ImageIcon,
    gradient: "from-rose-400 to-pink-500",
    glow: "shadow-rose-200/50 dark:shadow-rose-900/30",
    bg: "from-rose-50 to-pink-50 dark:from-rose-900/20 dark:to-pink-900/20",
  },
  "video-studio": {
    icon: Film,
    gradient: "from-orange-400 to-amber-500",
    glow: "shadow-orange-200/50 dark:shadow-orange-900/30",
    bg: "from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20",
  },
  "pro-studio": {
    icon: Music,
    gradient: "from-violet-400 to-indigo-500",
    glow: "shadow-violet-200/50 dark:shadow-violet-900/30",
    bg: "from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20",
  },
  director: {
    icon: Clapperboard,
    gradient: "from-slate-500 to-zinc-600",
    glow: "shadow-slate-300/50 dark:shadow-slate-900/30",
    bg: "from-slate-50 to-zinc-50 dark:from-slate-900/20 dark:to-zinc-900/20",
  },
  assets: {
    icon: FolderHeart,
    gradient: "from-lime-400 to-green-500",
    glow: "shadow-lime-200/50 dark:shadow-lime-900/30",
    bg: "from-lime-50 to-green-50 dark:from-lime-900/20 dark:to-green-900/20",
  },
  "lora-trainer": {
    icon: GraduationCap,
    gradient: "from-cyan-400 to-teal-500",
    glow: "shadow-cyan-200/50 dark:shadow-cyan-900/30",
    bg: "from-cyan-50 to-teal-50 dark:from-cyan-900/20 dark:to-teal-900/20",
  },
  models: {
    icon: Users,
    gradient: "from-amber-400 to-orange-500",
    glow: "shadow-amber-200/50 dark:shadow-amber-900/30",
    bg: "from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20",
  },
  "prompt-library": {
    icon: BookOpen,
    gradient: "from-teal-400 to-emerald-500",
    glow: "shadow-teal-200/50 dark:shadow-teal-900/30",
    bg: "from-teal-50 to-emerald-50 dark:from-teal-900/20 dark:to-emerald-900/20",
  },
  vault: {
    icon: Mic2,
    gradient: "from-pink-400 to-rose-500",
    glow: "shadow-pink-200/50 dark:shadow-pink-900/30",
    bg: "from-pink-50 to-rose-50 dark:from-pink-900/20 dark:to-rose-900/20",
  },
  calendar: {
    icon: Calendar,
    gradient: "from-blue-400 to-indigo-500",
    glow: "shadow-blue-200/50 dark:shadow-blue-900/30",
    bg: "from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20",
  },
  shared: {
    icon: Users,
    gradient: "from-purple-400 to-fuchsia-500",
    glow: "shadow-purple-200/50 dark:shadow-purple-900/30",
    bg: "from-purple-50 to-fuchsia-50 dark:from-purple-900/20 dark:to-fuchsia-900/20",
  },
};

const DEFAULT_STUDIO_VISUAL: StudioVisual = {
  icon: Sparkles,
  gradient: "from-slate-400 to-slate-500",
  glow: "shadow-slate-200/50 dark:shadow-slate-900/30",
  bg: "from-slate-50 to-slate-100 dark:from-slate-900/20 dark:to-slate-800/20",
};

function getStudioVisual(id: string): StudioVisual {
  return STUDIO_VISUALS[id] ?? DEFAULT_STUDIO_VISUAL;
}

// 短標題：把資料庫的長 description 壓成一行簡短語，避免卡片堆字。
const STUDIO_SHORT_HINT: Record<string, string> = {
  create: "全部創作工作流",
  studio: "跨模態主入口",
  playground: "進階模型總覽",
  "image-studio": "AI 生圖 / 改圖",
  "video-studio": "動態短片生成",
  "pro-studio": "音樂 · 配音",
  director: "腳本與分鏡",
  assets: "素材 · 提示詞",
  "lora-trainer": "LoRA 訓練",
  models: "角色與模型",
  "prompt-library": "提示詞庫",
  vault: "一致性保險庫",
  calendar: "創作排程",
  shared: "團隊共享",
};

// ─── 任務範本（task-shaped，不是工具 shaped） ─────────────────────────
//
// 真實使用者帶著任務來：「我要做 IG 預告」「我要做角色立繪」。光球的
// 真正強項是把多個工具串成 workflow — 這份清單把每個常見任務拆成
// 工具鏈，點下去 = 進入 multi-step 模式 + 跳到鏈頭工具，光球會接續
// 帶完整個流程。

type ChainStage =
  | "script"
  | "image"
  | "video"
  | "voice"
  | "music"
  | "lora";

const CHAIN_VISUAL: Record<ChainStage, { icon: LucideIcon; label: string; tone: string }> = {
  script: { icon: BookOpen, label: "腳本", tone: "from-emerald-400 to-green-500" },
  image: { icon: ImageIcon, label: "圖", tone: "from-rose-400 to-pink-500" },
  video: { icon: Film, label: "影片", tone: "from-orange-400 to-amber-500" },
  voice: { icon: Mic2, label: "配音", tone: "from-cyan-400 to-teal-500" },
  music: { icon: Music, label: "音樂", tone: "from-violet-400 to-indigo-500" },
  lora: { icon: GraduationCap, label: "LoRA", tone: "from-fuchsia-400 to-purple-500" },
};

type TaskTemplate = {
  id: string;
  title: string;
  subtitle: string;
  chain: ChainStage[];
  eta: string;
  accentBg: string;     // outer card bg
  accentBorder: string; // outer card border
  firstPath: string;    // 鏈頭工具
  prompt: string;       // 送給光球的 multi-step prompt
};

const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "ig-reels",
    title: "30 秒 IG / Reels 預告",
    subtitle: "把產品照變成有節奏的短片",
    chain: ["script", "image", "video", "voice"],
    eta: "約 5 分鐘 · 4 步",
    accentBg: "from-rose-50 to-orange-50 dark:from-rose-900/20 dark:to-orange-900/20",
    accentBorder: "border-rose-200/70 dark:border-rose-700/40",
    firstPath: "/director",
    prompt:
      "我要做一支 30 秒 IG/Reels 預告片。請先幫我擬腳本與分鏡（節奏、鉤子、CTA），再帶我到圖片創作室產出關鍵畫面，接著到影片創作室做動態，最後到配音。每一步都先確認再進行。",
  },
  {
    id: "character-forge",
    title: "角色立繪 + LoRA 鎖定",
    subtitle: "從一段描述生角色，再訓練成可重用模型",
    chain: ["image", "image", "lora"],
    eta: "約 10 分鐘 · 3 步",
    accentBg: "from-fuchsia-50 to-pink-50 dark:from-fuchsia-900/20 dark:to-pink-900/20",
    accentBorder: "border-fuchsia-200/70 dark:border-fuchsia-700/40",
    firstPath: "/image-studio",
    prompt:
      "我要打造一個原創角色：先在圖片創作室生成正面/側面/背面立繪，再用這些圖在角色鍛造所訓練 LoRA，最後我能用這個 LoRA 一致性產角色。請逐步問我描述。",
  },
  {
    id: "brand-visual",
    title: "品牌主視覺包",
    subtitle: "Logo · 主視覺 · 社群延伸，整套產出",
    chain: ["image", "image", "image"],
    eta: "約 8 分鐘 · 3 步",
    accentBg: "from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20",
    accentBorder: "border-amber-200/70 dark:border-amber-700/40",
    firstPath: "/image-studio",
    prompt:
      "我要做品牌主視覺包：先問我品牌調性與受眾，給 3 組 Logo 提案，挑定後延伸成主視覺，再做 Instagram 三圖延伸。",
  },
  {
    id: "podcast",
    title: "Podcast 預錄包",
    subtitle: "腳本 → TTS 配音 → BGM 混音",
    chain: ["script", "voice", "music"],
    eta: "約 6 分鐘 · 3 步",
    accentBg: "from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20",
    accentBorder: "border-violet-200/70 dark:border-violet-700/40",
    firstPath: "/director",
    prompt:
      "我要錄一集 Podcast：先幫我整理今天主題的腳本（含開場/段落/結尾），再用 TTS 做配音樣本，最後配上適合的 BGM。",
  },
  {
    id: "healing-loop",
    title: "療癒循環短片",
    subtitle: "靜態圖 → 慢動態 → 環境音",
    chain: ["image", "video", "music"],
    eta: "約 4 分鐘 · 3 步",
    accentBg: "from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20",
    accentBorder: "border-emerald-200/70 dark:border-emerald-700/40",
    firstPath: "/image-studio",
    prompt:
      "我想做一支療癒循環短片：先生一張寧靜風景圖（描述場景），動畫化成慢節奏循環，最後加上配合的環境音樂。",
  },
  {
    id: "product-shot",
    title: "產品商品照變體包",
    subtitle: "去背 / 場景化 / 多角度，一次出 6 張",
    chain: ["image", "image"],
    eta: "約 3 分鐘 · 2 步",
    accentBg: "from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20",
    accentBorder: "border-sky-200/70 dark:border-sky-700/40",
    firstPath: "/image-studio",
    prompt:
      "請為產品照生成 6 種風格變體：白底專業、生活情境、戶外光、夜景、抽象藝術、極簡平面。請先讓我上傳產品圖。",
  },
];

// ─── 最近使用：localStorage 驅動的個人化 ──────────────────────────────
//
// 任何點選任務範本或工具磁磚的動作都會 push 到 recent，下次回訪時
// 「繼續上次」strip 會出現在第一螢幕。為了不污染全域，限定 12 筆。

type RecentEntry = {
  kind: "studio" | "task";
  id: string;
  label: string;
  path?: string;
  at: number;
};

const RECENT_STORAGE_KEY = "agent.recent_v1";
const RECENT_LIMIT = 12;

function readRecent(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (it): it is RecentEntry =>
        it && typeof it === "object" && typeof it.id === "string" && typeof it.label === "string"
    );
  } catch {
    return [];
  }
}

function writeRecent(entries: RecentEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(entries.slice(0, RECENT_LIMIT)));
  } catch {
    // localStorage may be disabled — degrade silently
  }
}

function buildStarterEntry(page: (typeof AGENT_HOME_ENTRIES)[number]): StarterEntry {
  const primaryQuickAction = page.quickActions[0];
  return {
    id: page.id,
    label: page.label,
    path: page.path,
    description: page.description,
    group: page.group,
    quickAction: primaryQuickAction
      ? {
          id: primaryQuickAction.id,
          label: primaryQuickAction.label,
          description: primaryQuickAction.description,
          path: primaryQuickAction.path,
          action: primaryQuickAction.action,
          prompt: primaryQuickAction.prompt,
        }
      : undefined,
    quickActions: page.quickActions.map(action => ({
      id: action.id,
      label: action.label,
      description: action.description,
      path: action.path,
      action: action.action,
      prompt: action.prompt,
    })),
    prompt: primaryQuickAction?.prompt ?? page.orbHints[0],
    starterText:
      primaryQuickAction?.description ?? page.orbHints[0] ?? `帶我去${page.label}`,
  };
}

// ─── 元件 ────────────────────────────────────────────────────────────────

export default function AgentChat() {
  const { personality } = usePersonality();
  const pageAgent = usePageAgent();
  const [, setLocation] = useLocation();
  const {
    openPanel: openOrbGuide,
    selectIntent: selectOrbIntent,
    attachArrivalGuide,
  } = useOrbGuide();

  // ─── Global Orb Chat Integration ──────────────────────────────────────
  const globalChat = useGlobalOrbChat();

  // Ref to hold the latest `send` for use in handler (avoids stale closures)
  const sendRef = useRef<(raw: string) => Promise<void>>(undefined);

  // ── 把 /agent 本身也登記成一個 PageAgent 頁面 ──────────────────────
  //
  // 這頁自己的能力包括「帶你去別頁」和「搜尋」——
  // 其他結構化動作留給目的地頁面的 handler（透過 pending queue 傳遞）。
  //
  // navigate 的 ALLOWLIST 是「全站功能頁」的集合（從 AGENT_HOME_ENTRIES 衍
  // 生），加上幾個輔助路徑。確保光球只把使用者送去已登記的頁面，避免被
  // LLM 引誘到 /admin 等敏感路徑或亂編路徑。
  const AGENT_NAV_ALLOWLIST = useMemo<Set<string>>(() => {
    const paths = new Set<string>();
    for (const entry of AGENT_HOME_ENTRIES) {
      if (entry.path) paths.add(entry.path);
    }
    paths.add("/");
    paths.add("/agent");
    paths.add("/learn");
    paths.add("/tutorial-overview");
    paths.add("/dashboard");
    paths.add("/settings");
    paths.add("/credits");
    return paths;
  }, []);
  useRegisterPageAgent({
    pageId: "agent-chat",
    pageLabel: "全站光球代理",
    pagePath: "/agent",
    capabilities: [
      {
        action: "navigate",
        label: "前往頁面",
        hint: "使用者在聊天頁時，navigate 會直接帶他過去",
      },
      {
        action: "search",
        label: "全站搜尋",
        hint: "搜尋功能頁面、工作流程、模型名稱",
      },
    ],
    state: {
      messageCount: globalChat.messages.length,
      starterEntryCount: AGENT_HOME_ENTRIES.length,
      surface: "agent-chat",
    },
    handle: async action => {
      if (action.type === "navigate") {
        if (!AGENT_NAV_ALLOWLIST.has(action.path)) {
          return {
            ok: false,
            reason: `agent-chat: 不在允許跳轉清單：${action.path}`,
          };
        }
        setLocation(action.path);
        return { ok: true, message: "navigated" };
      }
      if (action.type === "search") {
        // 在聊天頁搜尋：用搜尋關鍵字自動送出一次 chat。
        // sendRef.current 回傳的是 Promise — 同步 try/catch 抓不到非同步
        // rejection，會默默吞掉錯誤讓使用者按了沒反應。改用 .catch()
        // 把失敗 surface 出來。
        const promise = sendRef.current?.(`搜尋：${action.query}`);
        if (promise) {
          promise.catch(err => {
            const reason = err instanceof Error ? err.message : String(err);
            console.warn(
              "[AgentChat] search dispatch failed for:",
              action.query,
              reason
            );
            toast.error(`搜尋送出失敗：${reason.slice(0, 120)}`);
          });
        }
        return { ok: true, message: "searching" };
      }
      // 其他動作：這頁沒有工具可執行，讓 bus 自己 enqueue 給目標頁
      return {
        ok: false,
        reason: `agent-chat: not-applicable (${action.type}) — 由目標頁面接手`,
      };
    },
  });

  // ─── Chat 狀態 ─────────────────────────────────────────────────────
  // Use global chat state instead of local state
  const messages = globalChat.messages;
  const input = globalChat.input;
  const setInput = globalChat.setInput;
  const isSending = globalChat.isSending;
  const suggestions = globalChat.suggestions.map(s => s.text);
  const setSuggestions = (_newSuggestions: string[]) => {
    // Global chat manages suggestions internally
  };
  const [needGuideOpen, setNeedGuideOpen] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const [showAdvancedEntry, setShowAdvancedEntry] = useState(false);
  const [showAllIntents, setShowAllIntents] = useState(false);
  const [showAllTools, setShowAllTools] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const [modeBarOpen, setModeBarOpen] = useState(false);
  const [recent, setRecent] = useState<RecentEntry[]>(() => readRecent());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const heroInputRef = useRef<HTMLInputElement | null>(null);

  const pushRecent = useCallback((entry: Omit<RecentEntry, "at">) => {
    setRecent(prev => {
      const filtered = prev.filter(e => !(e.kind === entry.kind && e.id === entry.id));
      const next = [{ ...entry, at: Date.now() }, ...filtered].slice(0, RECENT_LIMIT);
      writeRecent(next);
      return next;
    });
  }, []);
  const starterEntries = useMemo(
    () =>
      AGENT_HOME_ENTRIES
        .filter(page => page.id !== "home" && page.id !== "agent-chat")
        .slice(0, 12)
        .map(buildStarterEntry),
    []
  );

  const {
    attachments,
    isUploading,
    fileInputRef,
    pickAttachment,
    removeAttachment,
    clearAttachments,
    handleFiles,
  } = useOrbAttachments(message => toast.error(message));

  // Auto-scroll to bottom on new message
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  // Open global chat when this page loads
  useEffect(() => {
    globalChat.open();
  }, [globalChat]);

  // ─── 模式工具列：點亮後送出時把模式作為結構化 metadata 傳給 sendMessage。
  // 不再把長段中文指令塞到使用者的 prompt 前面 — 使用者打的字就是聊天紀錄
  // 看到的字。每個模式的行為由程式直接處理（navigate / ask-feature 走純客
  // 端捷徑；plan / multi-step 走 LLM 但用 context 帶模式提示）。
  //
  // 每個模式還帶 `flowSteps` — 三段視覺化 pictogram，告訴使用者「按下去
  // 之後光球會做什麼」。在 hero 模式選擇器上用，讓四種代理風格一眼能
  // 看懂差異。
  const modeOptions = useMemo(
    () => [
      {
        id: "multi-step" as const,
        label: "多步驟代理",
        shortLabel: "自動",
        description: "全自動拆解工作流程並執行",
        tagline: "把目標丟給光球，它自己跑完整條任務",
        accent: "violet" as const,
        gradient: "from-violet-400 via-purple-500 to-indigo-500",
        glow: "shadow-violet-200/60 dark:shadow-violet-900/40",
        ring: "ring-violet-200/70 dark:ring-violet-700/50",
        bg: "from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20",
        icon: Workflow,
        defaultPrompt: "幫我把這件事拆成完整流程並自動執行到完成。",
        placeholder: "說一句目標，光球會自動拆步驟…",
        example: "做支 30 秒 IG 預告片",
        flowSteps: [
          { icon: ListChecks, label: "拆步驟" },
          { icon: Workflow, label: "自動跑" },
          { icon: Sparkles, label: "出成品" },
        ],
        previewText: "光球會把目標拆成多步驟，自動跨工具執行；卡關時才會打斷你。",
      },
      {
        id: "plan" as const,
        label: "計畫",
        shortLabel: "計畫",
        description: "先擬一份可執行的計畫",
        tagline: "光球先給你看計畫表，你說「開始」它才動",
        accent: "emerald" as const,
        gradient: "from-emerald-400 via-teal-500 to-green-500",
        glow: "shadow-emerald-200/60 dark:shadow-emerald-900/40",
        ring: "ring-emerald-200/70 dark:ring-emerald-700/50",
        bg: "from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20",
        icon: ListChecks,
        defaultPrompt: "幫我擬一份可執行的計畫。",
        placeholder: "說一個想完成的目標，光球先擬計畫…",
        example: "幫我規劃這週的影片產出",
        flowSteps: [
          { icon: HelpCircle, label: "問需求" },
          { icon: ListChecks, label: "出計畫" },
          { icon: ArrowRight, label: "你說好" },
        ],
        previewText: "光球先擬步驟清單給你看，你檢視、修改、按「開始」後才會執行。",
      },
      {
        id: "navigate" as const,
        label: "跳頁",
        shortLabel: "跳頁",
        description: "幫我帶到對應的功能頁面",
        tagline: "說一句目的地，光球幫你判斷該去哪頁",
        accent: "sky" as const,
        gradient: "from-sky-400 via-blue-500 to-cyan-500",
        glow: "shadow-sky-200/60 dark:shadow-sky-900/40",
        ring: "ring-sky-200/70 dark:ring-sky-700/50",
        bg: "from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20",
        icon: CornerUpRight,
        defaultPrompt: "帶我去合適的功能頁。",
        placeholder: "想去哪個工具頁？描述一下…",
        example: "我要做配音，帶我去對的頁",
        flowSteps: [
          { icon: HelpCircle, label: "懂需求" },
          { icon: Compass, label: "選頁" },
          { icon: CornerUpRight, label: "跳轉" },
        ],
        previewText: "光球會解析你的需求，挑出全站最相關的工具頁，並自動把你帶過去。",
      },
      {
        id: "ask-feature" as const,
        label: "功能詢問",
        shortLabel: "功能",
        description: "問光球這個站有什麼功能",
        tagline: "純問答模式，光球解釋功能但不動手",
        accent: "amber" as const,
        gradient: "from-amber-400 via-orange-500 to-yellow-500",
        glow: "shadow-amber-200/60 dark:shadow-amber-900/40",
        ring: "ring-amber-200/70 dark:ring-amber-700/50",
        bg: "from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20",
        icon: HelpCircle,
        defaultPrompt: "這個站目前有哪些功能可以用？",
        placeholder: "想知道哪個功能？問我吧…",
        example: "這站有什麼模型可以做角色一致性？",
        flowSteps: [
          { icon: HelpCircle, label: "你問" },
          { icon: BookOpen, label: "光球查" },
          { icon: MessageCircle, label: "解釋" },
        ],
        previewText: "純問答 — 光球只會解釋功能、列出可選方案，不會幫你動手或跳頁。",
      },
    ],
    []
  );

  const activeModeOption = useMemo(
    () => modeOptions.find(option => option.id === activeMode) ?? null,
    [activeMode, modeOptions]
  );

  const toggleMode = useCallback((modeId: string) => {
    setActiveMode(prev => (prev === modeId ? null : modeId));
  }, []);

  // ─── 送出訊息 ───────────────────────────────────────────────────────
  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if ((!text && attachments.length === 0) || isSending) return;
      // 使用者打什麼，聊天紀錄就顯示什麼。模式以 requestedMode 結構化欄位
      // 傳遞，由 GlobalOrbChatContext 內的 hard-coded 邏輯接手 — 不再注入
      // 一段中文 instruction 蓋掉使用者原文。
      const promptToSend = text || activeModeOption?.defaultPrompt || "";
      await globalChat.sendMessage(promptToSend, attachments, {
        requestedMode: activeModeOption?.id,
      });
      clearAttachments();
      // 送出後自動關閉模式，避免下一句又意外帶到模式上下文。
      if (activeModeOption) setActiveMode(null);
    },
    [isSending, globalChat, attachments, clearAttachments, activeModeOption]
  );

  // Keep sendRef in sync with the latest `send` callback
  sendRef.current = send;

  // ─── 意圖卡片：使用者點選後直接送出該選項 ─────────────────────────────
  const handleIntentCardSelect = useCallback(
    (option: IntentOption) => {
      if (isSending) return;
      void globalChat.sendMessage(option.pickText, []);
    },
    [globalChat, isSending]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void send(input);
      }
    },
    [input, send]
  );

  const isFirstTurn = messages.length <= 1;
  const handleStarterEntryClick = useCallback(
    async (entry: StarterEntry) => {
      // 紀錄到「最近使用」，下次回訪可一鍵繼續
      pushRecent({ kind: "studio", id: entry.id, label: entry.label, path: entry.path });
      // 1) 有 path -> 先導頁，並彈出「已自動完成 / 接下來請你做」引導卡，
      //    讓使用者一到目的頁就知道光球幫他做了什麼、還可以選什麼。
      if (entry.path && entry.path !== "/agent") {
        const followupActions: AgentAction[] = [];
        if (entry.quickAction?.action) followupActions.push(entry.quickAction.action);
        attachArrivalGuide({
          targetPath: entry.path,
          targetLabel: entry.label,
          orbMessage: entry.quickAction?.description ?? entry.description,
          actions: followupActions,
        });
        setLocation(entry.path);
      }
      // 2) quickAction 有 action -> dispatch 第一個
      if (entry.quickAction?.action) {
        await pageAgent.dispatch(entry.quickAction.action, {
          source: "manual",
        });
      }
      // 3) 有 prompt -> 直接送出 chat
      if (entry.prompt) {
        await send(entry.prompt);
        return;
      }
      if (entry.path === "/agent") {
        await send(entry.starterText);
      }
    },
    [attachArrivalGuide, pageAgent, pushRecent, send, setLocation]
  );
  const handleStarterQuickAction = useCallback(
    async (entry: StarterEntry, action: StarterQuickAction) => {
      pushRecent({ kind: "studio", id: entry.id, label: entry.label, path: entry.path });
      if (action.path && action.path !== "/agent") {
        const followupActions: AgentAction[] = [];
        if (action.action) followupActions.push(action.action);
        attachArrivalGuide({
          targetPath: action.path,
          targetLabel: `${entry.label} · ${action.label}`,
          orbMessage: action.description,
          actions: followupActions,
        });
        setLocation(action.path);
      }
      if (action.action) {
        await pageAgent.dispatch(action.action, { source: "manual" });
      }
      if (action.prompt) {
        await send(action.prompt);
        return;
      }
      await send(`請帶我在「${entry.label}」處理「${action.label}」。`);
    },
    [attachArrivalGuide, pageAgent, pushRecent, send, setLocation]
  );

  // 任務範本：點下去 = 進入 multi-step 模式 + 跳到鏈頭工具，
  // 光球收到結構化 prompt 後接手帶完整個 workflow。
  const handleTaskTemplate = useCallback(
    async (tpl: TaskTemplate) => {
      pushRecent({ kind: "task", id: tpl.id, label: tpl.title, path: tpl.firstPath });
      // 先導頁，光球進到目標頁後接到 multi-step prompt
      setLocation(tpl.firstPath);
      await globalChat.sendMessage(tpl.prompt, [], { requestedMode: "multi-step" });
    },
    [globalChat, pushRecent, setLocation]
  );

  // 由 ID 找回最近項目對應的入口（task 或 studio）
  const recentResolved = useMemo(
    () =>
      recent
        .map(item => {
          if (item.kind === "task") {
            const tpl = TASK_TEMPLATES.find(t => t.id === item.id);
            return tpl ? { kind: "task" as const, item, tpl } : null;
          }
          const entry = starterEntries.find(e => e.id === item.id);
          return entry ? { kind: "studio" as const, item, entry } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .slice(0, 4),
    [recent, starterEntries]
  );

  // 第一輪自動聚焦 hero 輸入，讓使用者直接打字而不必先點任務範本
  useEffect(() => {
    if (isFirstTurn && heroInputRef.current) {
      const t = window.setTimeout(() => heroInputRef.current?.focus(), 320);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [isFirstTurn]);

  return (
    <div className="flex-1 flex flex-col items-center w-full min-h-full">
      {/* 柔和漸層背景，呼吸感 */}
      <div
        className="fixed inset-0 pointer-events-none -z-10"
        style={{
          background:
            "radial-gradient(60% 40% at 50% 0%, rgba(167, 243, 208, 0.18) 0%, transparent 60%), radial-gradient(50% 50% at 80% 100%, rgba(196, 181, 253, 0.15) 0%, transparent 60%)",
        }}
      />

      <div className="w-full max-w-3xl flex-1 flex flex-col px-4 sm:px-6 py-6 sm:py-8 gap-5 relative">
        {/* 右上角：低頻工具（清除對話 / 代理設定）做成圖示，不搶版面 */}
        <div className="absolute top-3 right-3 sm:top-4 sm:right-4 flex items-center gap-1 z-10">
          <button
            type="button"
            onClick={() => {
              if (messages.length === 0) {
                globalChat.resetConversation();
                toast.success("已重新開始對話");
                return;
              }
              if (
                window.confirm(
                  `確定要清除這段對話嗎？目前有 ${messages.length} 則訊息會被刪除（不影響排程與設定）。`
                )
              ) {
                globalChat.resetConversation();
                toast.success("對話已清除，重新開始");
              }
            }}
            disabled={isSending}
            title="清除對話"
            aria-label="清除目前的光球對話"
            data-testid="clear-chat-trigger"
            className="p-1.5 rounded-lg text-slate-400 hover:text-destructive hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
          >
            <Eraser className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="代理設定"
            aria-haspopup="dialog"
            data-testid="agent-settings-trigger"
            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>

        {/* 開場區塊 */}
        <div className="flex flex-col items-center text-center gap-2.5">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <VisualSoul size="lg" personality={personality} />
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.1 }}
            className="text-xl sm:text-2xl font-medium text-slate-800 dark:text-slate-100"
          >
            先聊聊看就好 🌿
          </motion.h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md leading-relaxed">
            我會先問幾個關鍵問題（目標、用途、素材、限制），幫你定位到正確的頁面，並一步步告訴你怎麼做。
          </p>

          {/* 主要輔助按鈕：如何使用光球（單一） */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setHowToOpen(prev => !prev)}
            className="h-8 px-3 text-xs gap-1.5 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
            aria-expanded={howToOpen}
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
            如何使用光球
            <ChevronDown
              className={`w-3 h-3 transition-transform ${howToOpen ? "rotate-180" : ""}`}
            />
          </Button>

          {/* 如何使用 — 分步說明 */}
          <AnimatePresence initial={false}>
            {howToOpen && (
              <motion.div
                key="how-to"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
                className="w-full mt-1 overflow-hidden"
              >
                <div className="rounded-2xl border border-emerald-200/70 dark:border-emerald-700/40 bg-emerald-50/40 dark:bg-emerald-900/10 px-4 py-3 text-left space-y-2.5">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      五步學會用光球
                    </p>
                  </div>
                  <ol className="space-y-2">
                    {HOW_TO_STEPS.map(step => (
                      <li
                        key={step.title}
                        className="flex flex-col gap-0.5 rounded-lg bg-white/70 dark:bg-slate-900/30 border border-emerald-100/80 dark:border-emerald-700/30 px-3 py-2"
                      >
                        <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                          {step.title}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                          {step.description}
                        </p>
                      </li>
                    ))}
                  </ol>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => void send("我是新手，請用 30 秒帶我認識這個聊天頁的用法。")}
                      className="text-[11px] px-2 py-1 rounded-full border border-emerald-300/70 text-emerald-700 hover:bg-emerald-100/60 transition-colors"
                    >
                      🚀 讓光球親自示範
                    </button>
                    <button
                      type="button"
                      onClick={() => setLocation("/learn")}
                      className="text-[11px] px-2 py-1 rounded-full border border-slate-200/80 text-slate-500 hover:text-slate-700 hover:border-slate-300 transition-colors"
                    >
                      📚 看完整文件
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 需求釐清提示 */}
          <div className="w-full mt-2 sm:mt-3">
            <Collapsible
              open={needGuideOpen}
              onOpenChange={setNeedGuideOpen}
              className="rounded-xl border border-slate-200/70 dark:border-slate-700/60 bg-white/70 dark:bg-slate-900/40 px-4 py-3 text-left shadow-sm"
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-2"
                >
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    提前告訴我這些，導引會更精準
                  </p>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-slate-400 transition-transform ${needGuideOpen ? "rotate-180" : ""}`}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <div className="flex flex-wrap gap-1.5">
                  {NEED_CLUES.map(item => (
                    <span
                      key={item}
                      className="text-[11px] px-2 py-1 rounded-full border border-slate-200/80 dark:border-slate-700/70 text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-900/50"
                    >
                      {item}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {NEED_PROMPTS.map((template, i) => (
                    <Button
                      key={template}
                      variant="outline"
                      size="sm"
                      className="text-[11px] h-8 px-3 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                      onClick={() => void send(template)}
                    >
                      示範 {i + 1}
                    </Button>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
          {/* ── 第一輪：Hero composer + Recent + Task templates ────────────
              真實使用者帶著任務來，光球真正強項是把多個工具串成 workflow。
              這個區塊用「先說目標 → 套任務範本 → 光球幫你串好」的順序，
              取代過去的工具瀏覽思維。 */}
          {isFirstTurn && (
            <motion.div
              key="hero-composer"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.15 }}
              className="w-full mt-1 space-y-2"
            >
              <div className="relative bg-white/95 dark:bg-slate-900/85 backdrop-blur-xl rounded-3xl border-2 border-emerald-200/80 dark:border-emerald-700/40 shadow-2xl shadow-emerald-200/40 dark:shadow-emerald-900/30 ring-2 ring-emerald-100/50 dark:ring-emerald-900/20 focus-within:ring-emerald-300/70 dark:focus-within:ring-emerald-600/50 focus-within:border-emerald-400/80 transition-all p-1.5">
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-2 pt-1.5">
                    {attachments.map(attachment => (
                      <button
                        key={attachment.id}
                        type="button"
                        onClick={() => removeAttachment(attachment.id)}
                        title="移除附件"
                        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/70 bg-white/90 px-2.5 py-0.5 text-[11px] text-slate-600 shadow-sm hover:bg-white dark:border-slate-700/60 dark:bg-slate-800/80 dark:text-slate-200"
                      >
                        <span>{attachmentKindEmoji(attachment.kind)}</span>
                        <span className="max-w-[140px] truncate">{attachment.name}</span>
                        <X className="w-3 h-3 opacity-70" />
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 px-1.5 py-1">
                  <button
                    type="button"
                    onClick={pickAttachment}
                    disabled={isSending || isUploading}
                    title="上傳圖片 / 影片 / 音訊 / PDF"
                    className="p-2.5 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-slate-500 dark:text-slate-400 disabled:opacity-40 transition-colors shrink-0"
                  >
                    {isUploading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Paperclip className="w-5 h-5" />
                    )}
                  </button>
                  <input
                    ref={heroInputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    disabled={isSending}
                    placeholder={activeModeOption?.placeholder ?? "告訴光球你想做什麼，它幫你串好整套流程…"}
                    className="flex-1 bg-transparent outline-none px-2 py-3 text-base text-slate-800 dark:text-slate-100 placeholder:text-slate-400 disabled:opacity-50 min-w-0"
                  />
                  <Button
                    onClick={() => void send(input)}
                    disabled={(!input.trim() && attachments.length === 0 && !activeModeOption) || isSending || isUploading}
                    className="bg-gradient-to-r from-emerald-400 to-sky-400 hover:from-emerald-500 hover:to-sky-500 text-white border-0 shadow-md hover:shadow-lg disabled:opacity-40 px-4 py-2.5 h-auto rounded-xl shrink-0"
                  >
                    <Send className="w-4 h-4 mr-1" />
                    <span className="text-sm font-medium">送出</span>
                  </Button>
                </div>
              </div>

              {/* 已點亮模式：視覺化流程預覽卡 ─────────────────────────
                  原本只是一條淡綠色 banner 寫「目前模式：xxx」。改成用
                  漸層卡 + 三段 pictogram flow + 範例 prompt，讓使用者
                  按下送出前就能直觀理解光球接下來會做什麼。 */}
              <AnimatePresence initial={false}>
                {activeModeOption && (() => {
                  const ActiveModeIcon = activeModeOption.icon;
                  return (
                  <motion.div
                    key={`mode-preview-${activeModeOption.id}`}
                    initial={{ opacity: 0, y: 6, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: "auto" }}
                    exit={{ opacity: 0, y: -4, height: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div
                      className={`relative overflow-hidden rounded-2xl ring-1 ${activeModeOption.ring} bg-gradient-to-br ${activeModeOption.bg} p-3`}
                      data-testid={`mode-preview-${activeModeOption.id}`}
                    >
                      <div
                        aria-hidden
                        className={`absolute -top-8 -right-6 w-24 h-24 rounded-full bg-gradient-to-br ${activeModeOption.gradient} opacity-20 blur-2xl`}
                      />
                      <div className="relative flex items-start gap-2.5">
                        <div
                          className={`shrink-0 w-9 h-9 rounded-xl bg-gradient-to-br ${activeModeOption.gradient} flex items-center justify-center text-white shadow-md ${activeModeOption.glow}`}
                        >
                          <ActiveModeIcon className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                              已啟用：{activeModeOption.label}
                            </p>
                            <button
                              type="button"
                              onClick={() => setActiveMode(null)}
                              className="text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 shrink-0"
                            >
                              取消模式
                            </button>
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug mt-0.5">
                            {activeModeOption.tagline}
                          </p>

                          {/* 三段 pictogram flow */}
                          <div className="mt-2 flex items-center gap-1 flex-wrap">
                            {activeModeOption.flowSteps.map((step, idx) => {
                              const StepIcon = step.icon;
                              return (
                                <div
                                  key={`${step.label}-${idx}`}
                                  className="flex items-center gap-1"
                                >
                                  <div
                                    className={`flex items-center gap-1 rounded-full bg-white/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-700/60 px-2 py-0.5`}
                                  >
                                    <StepIcon className="w-3 h-3 text-slate-600 dark:text-slate-300" />
                                    <span className="text-[10px] text-slate-700 dark:text-slate-200 font-medium">
                                      {step.label}
                                    </span>
                                  </div>
                                  {idx < activeModeOption.flowSteps.length - 1 && (
                                    <ArrowRight className="w-3 h-3 text-slate-400 mx-0.5" />
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* 一鍵範例：直接套這個模式送出 */}
                          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] text-slate-500 dark:text-slate-400">範例：</span>
                            <button
                              type="button"
                              onClick={() => void send(activeModeOption.example)}
                              disabled={isSending}
                              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-white/85 dark:bg-slate-900/60 border border-slate-300/70 dark:border-slate-600/50 text-slate-700 dark:text-slate-200 hover:border-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
                            >
                              <Play className="w-2.5 h-2.5" />
                              {activeModeOption.example}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                  );
                })()}
              </AnimatePresence>

              {/* 三個極簡示範 prompt — 取代原本長段「示範 1/2/3」按鈕 */}
              <div className="flex flex-wrap gap-1.5 px-1">
                <span className="text-[11px] text-slate-400 dark:text-slate-500">試試：</span>
                {[
                  "做支 30 秒 IG 預告",
                  "幫我做角色立繪",
                  "我想配 Podcast",
                ].map(hint => (
                  <button
                    key={hint}
                    type="button"
                    onClick={() => void send(hint)}
                    className="text-[11px] px-2 py-0.5 rounded-full border border-slate-200/80 dark:border-slate-700/60 text-slate-600 dark:text-slate-300 hover:border-emerald-300 hover:text-emerald-700 hover:bg-emerald-50/60 dark:hover:bg-emerald-900/20 transition-colors"
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── 代理風格：4 個視覺化模式卡 ───────────────────────────
              4 個模式（多步驟 / 計畫 / 跳頁 / 功能詢問）從藏在折疊條
              後的小 pill 升級為 hero 視覺卡：每張卡顯示模式漸層、
              三段 flow pictogram、範例 prompt。讓使用者一眼能看懂
              四種代理風格各會做什麼，再決定按哪個。 */}
          {isFirstTurn && (
            <motion.section
              key="mode-catalog"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.18 }}
              className="w-full mt-1 space-y-2 text-left"
            >
              <header className="flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    切換代理風格（光球做事的方式）
                  </p>
                </div>
                <span className="text-[10px] text-slate-400">
                  {activeModeOption ? "點同一個取消" : "可選一個"}
                </span>
              </header>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {modeOptions.map((mode, i) => {
                  const Icon = mode.icon;
                  const isActive = activeMode === mode.id;
                  return (
                    <motion.button
                      key={mode.id}
                      type="button"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 + i * 0.04 }}
                      whileHover={{ y: -2, scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => toggleMode(mode.id)}
                      disabled={isSending}
                      aria-pressed={isActive}
                      title={mode.previewText}
                      className={`group relative overflow-hidden rounded-2xl text-left p-2.5 transition-all disabled:opacity-40 ${
                        isActive
                          ? `ring-2 ${mode.ring} bg-gradient-to-br ${mode.gradient} text-white shadow-lg ${mode.glow}`
                          : `border border-slate-200/70 dark:border-slate-700/50 bg-gradient-to-br ${mode.bg} hover:border-transparent hover:shadow-md ${mode.glow}`
                      }`}
                    >
                      {isActive && (
                        <div
                          aria-hidden
                          className="absolute -top-6 -right-6 w-16 h-16 rounded-full bg-white/30 blur-xl"
                        />
                      )}
                      <div className="relative flex flex-col gap-1.5 min-h-[5.5rem]">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-sm ${
                            isActive
                              ? "bg-white/25 text-white"
                              : `bg-gradient-to-br ${mode.gradient} text-white ${mode.glow}`
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p
                            className={`text-xs font-semibold truncate ${
                              isActive ? "text-white" : "text-slate-800 dark:text-slate-100"
                            }`}
                          >
                            {mode.label}
                          </p>
                          <p
                            className={`text-[10px] leading-tight line-clamp-2 mt-0.5 ${
                              isActive
                                ? "text-white/90"
                                : "text-slate-600 dark:text-slate-400"
                            }`}
                          >
                            {mode.tagline}
                          </p>
                        </div>
                        {/* 微型 flow indicator — 三顆小圓 + 連線，視覺暗示這是流程 */}
                        <div className="mt-auto flex items-center gap-0.5">
                          {mode.flowSteps.map((step, idx) => {
                            const StepIcon = step.icon;
                            return (
                              <div key={`${step.label}-${idx}`} className="flex items-center gap-0.5">
                                <span
                                  className={`w-4 h-4 rounded-md flex items-center justify-center ${
                                    isActive
                                      ? "bg-white/25 text-white"
                                      : "bg-white/85 dark:bg-slate-900/60 text-slate-600 dark:text-slate-300 border border-slate-200/70 dark:border-slate-700/60"
                                  }`}
                                  title={step.label}
                                >
                                  <StepIcon className="w-2.5 h-2.5" />
                                </span>
                                {idx < mode.flowSteps.length - 1 && (
                                  <span
                                    className={`block w-1 h-px ${
                                      isActive ? "bg-white/50" : "bg-slate-300 dark:bg-slate-600"
                                    }`}
                                  />
                                )}
                              </div>
                            );
                          })}
                          {isActive && (
                            <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                          )}
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </motion.section>
          )}

          {/* ── 繼續上次：個人化 strip（只在 localStorage 有資料才出現） ── */}
          {isFirstTurn && recentResolved.length > 0 && (
            <motion.section
              key="recent-strip"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="w-full mt-1 space-y-1.5 text-left"
            >
              <header className="flex items-center gap-1.5 px-1">
                <Clock3 className="w-3.5 h-3.5 text-amber-500" />
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  繼續上次
                </p>
              </header>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                {recentResolved.map(item => {
                  if (item.kind === "task") {
                    const tpl = item.tpl;
                    return (
                      <button
                        key={`task-${item.item.id}`}
                        type="button"
                        onClick={() => void handleTaskTemplate(tpl)}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-amber-200/70 bg-amber-50/70 dark:border-amber-700/40 dark:bg-amber-900/20 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-200 hover:border-amber-300 hover:bg-amber-100/80 transition-colors"
                      >
                        <Workflow className="w-3.5 h-3.5" />
                        <span>{tpl.title}</span>
                        <ArrowRight className="w-3 h-3 opacity-70" />
                      </button>
                    );
                  }
                  const visual = getStudioVisual(item.entry.id);
                  const Icon = visual.icon;
                  return (
                    <button
                      key={`studio-${item.item.id}`}
                      type="button"
                      onClick={() => void handleStarterEntryClick(item.entry)}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-slate-200/70 bg-white/85 dark:border-slate-700/50 dark:bg-slate-800/60 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:border-emerald-300 hover:bg-emerald-50/60 transition-colors"
                    >
                      <span
                        className={`w-4 h-4 rounded-md bg-gradient-to-br ${visual.gradient} flex items-center justify-center text-white shrink-0`}
                      >
                        <Icon className="w-2.5 h-2.5" />
                      </span>
                      <span>{item.entry.label}</span>
                    </button>
                  );
                })}
              </div>
            </motion.section>
          )}

          {/* ── 任務範本：workflow 鏈視覺化 ────────────────────────────
              每個範本顯示「腳本→圖→影片→配音」這種工具串連，讓使用者
              一眼看見光球能跨多個工具自動完成整條任務。 */}
          {isFirstTurn && (
            <motion.section
              key="task-templates"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.25 }}
              className="w-full mt-1 space-y-2.5 text-left"
            >
              <header className="flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-1.5">
                  <Workflow className="w-3.5 h-3.5 text-emerald-500" />
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    挑一個任務，光球幫你串好整套流程
                  </p>
                </div>
                <span className="text-[10px] text-slate-400">點下去 = 自動跑多步驟</span>
              </header>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {TASK_TEMPLATES.map((tpl, i) => (
                  <motion.button
                    key={tpl.id}
                    type="button"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + i * 0.04 }}
                    whileHover={{ y: -2, scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => void handleTaskTemplate(tpl)}
                    className={`group relative text-left rounded-2xl border ${tpl.accentBorder} bg-gradient-to-br ${tpl.accentBg} p-3 hover:shadow-lg transition-all`}
                    aria-label={`開始任務：${tpl.title}`}
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                            {tpl.title}
                          </p>
                          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug mt-0.5">
                            {tpl.subtitle}
                          </p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-500 group-hover:translate-x-0.5 transition-all shrink-0 mt-0.5" />
                      </div>

                      {/* 工具鏈視覺化：每個 stage 是一顆漸層小圓，用 → 串接 */}
                      <div className="flex items-center gap-0.5 flex-wrap">
                        {tpl.chain.map((stage, idx) => {
                          const stageVisual = CHAIN_VISUAL[stage];
                          const StageIcon = stageVisual.icon;
                          return (
                            <div key={`${stage}-${idx}`} className="flex items-center gap-0.5">
                              <div
                                className={`w-7 h-7 rounded-lg bg-gradient-to-br ${stageVisual.tone} flex items-center justify-center text-white shadow-sm`}
                                title={stageVisual.label}
                              >
                                <StageIcon className="w-3.5 h-3.5" />
                              </div>
                              {idx < tpl.chain.length - 1 && (
                                <ArrowRight className="w-3 h-3 text-slate-400 mx-0.5" />
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                        <span>{tpl.eta}</span>
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-emerald-600 dark:text-emerald-400 font-medium">
                          讓光球帶我做 →
                        </span>
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </motion.section>
          )}

          {/* ── 全部工具瀏覽（次要層級，預設摺起）────────────────────
              熟手或想直接跳工具的人才需要打開。原本的「意圖大卡 + 能力
              地圖」整套移進來，從首屏主角降為次選。 */}
          {isFirstTurn && (
            <motion.section
              key="all-tools-collapsible"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.3 }}
              className="w-full mt-1"
            >
              <Collapsible open={showAllTools} onOpenChange={setShowAllTools}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-slate-200/70 dark:border-slate-700/60 bg-white/55 dark:bg-slate-900/35 hover:bg-white/80 dark:hover:bg-slate-900/55 transition-colors"
                  >
                    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                      <Compass className="w-3.5 h-3.5 text-sky-500" />
                      想直接跳工具？打開全站能力地圖
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-slate-400 transition-transform ${showAllTools ? "rotate-180" : ""}`}
                    />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 space-y-4">
                {/* ── 意圖大卡 ────────────────────────────────────────── */}
                <section className="space-y-2.5 text-left">
                  <header className="flex items-center justify-between gap-2 px-1">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        想做什麼？選一個，光球先釐清需求再帶路
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAllIntents(prev => !prev)}
                      className="text-[11px] text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-300 transition-colors"
                    >
                      {showAllIntents ? "收起" : "更多 +"}
                    </button>
                  </header>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {(
                      showAllIntents
                        ? (["image", "video", "music", "voice", "script", "lora", "explore"] as Exclude<GuideIntent, null>[])
                        : (["image", "video", "script", "explore"] as Exclude<GuideIntent, null>[])
                    ).map((intentId, i) => {
                      const cfg = INTENT_CONFIGS[intentId];
                      const visual = INTENT_VISUALS[intentId];
                      return (
                        <motion.button
                          key={intentId}
                          type="button"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.25 + i * 0.04 }}
                          whileHover={{ y: -3, scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => {
                            selectOrbIntent(intentId);
                            openOrbGuide();
                          }}
                          className={`group relative overflow-hidden rounded-2xl text-left p-3 ring-1 ${visual.ring} shadow-md ${visual.glow} bg-gradient-to-br ${visual.gradient} text-white transition-all`}
                          aria-label={`選擇意圖：${cfg.label}`}
                        >
                          {/* 光暈裝飾 */}
                          <div
                            aria-hidden
                            className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-white/20 blur-2xl group-hover:bg-white/30 transition"
                          />
                          <div
                            aria-hidden
                            className="absolute -bottom-8 -left-4 w-16 h-16 rounded-full bg-white/10 blur-xl"
                          />
                          <div className="relative flex flex-col gap-1.5 min-h-[5rem]">
                            <span className="text-2xl leading-none drop-shadow-sm">
                              {cfg.emoji}
                            </span>
                            <p className="text-sm font-semibold tracking-wide">
                              {cfg.label}
                            </p>
                            <p className="text-[11px] text-white/85 leading-snug line-clamp-2">
                              {visual.shortHint}
                            </p>
                            <div className="mt-auto flex items-center gap-1 text-[11px] text-white/90 opacity-0 group-hover:opacity-100 -translate-x-1 group-hover:translate-x-0 transition-all">
                              <span>讓光球帶我做</span>
                              <ArrowRight className="w-3 h-3" />
                            </div>
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </section>

                {/* ── 全站能力地圖（icon-tile launcher） ─────────────── */}
                <section className="space-y-2.5 text-left">
                  <header className="flex items-center justify-between gap-2 px-1">
                    <div className="flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5 text-sky-500" />
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        全站能力地圖（直接跳到工具）
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAdvancedEntry(prev => !prev)}
                      className="text-[11px] text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-300 transition-colors"
                    >
                      {showAdvancedEntry ? "收起快速動作" : "展開快速動作"}
                    </button>
                  </header>

                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {starterEntries.map((entry, i) => {
                      const visual = getStudioVisual(entry.id);
                      const Icon = visual.icon;
                      const hint = STUDIO_SHORT_HINT[entry.id] ?? entry.description;
                      return (
                        <motion.button
                          key={entry.id}
                          type="button"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.3 + i * 0.03 }}
                          whileHover={{ y: -2, scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => void handleStarterEntryClick(entry)}
                          className={`group relative flex flex-col items-center gap-1.5 rounded-2xl p-2.5 border border-slate-200/70 dark:border-slate-700/50 bg-gradient-to-br ${visual.bg} hover:border-transparent hover:shadow-lg ${visual.glow} transition-all`}
                          aria-label={`前往${entry.label}`}
                        >
                          <div
                            className={`w-10 h-10 rounded-xl bg-gradient-to-br ${visual.gradient} flex items-center justify-center text-white shadow-md ${visual.glow} group-hover:scale-110 transition-transform`}
                          >
                            <Icon className="w-5 h-5" />
                          </div>
                          <p className="text-[11px] sm:text-xs font-medium text-slate-700 dark:text-slate-200 text-center leading-tight line-clamp-2">
                            {entry.label}
                          </p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 text-center leading-tight line-clamp-1">
                            {hint}
                          </p>
                        </motion.button>
                      );
                    })}
                  </div>

                  {/* 快速動作抽屜 — 只在使用者主動展開後才出現，預設不擾人 */}
                  <AnimatePresence initial={false}>
                    {showAdvancedEntry && (
                      <motion.div
                        key="quick-actions-drawer"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="rounded-xl border border-slate-200/70 dark:border-slate-700/60 bg-white/55 dark:bg-slate-900/35 p-2.5 space-y-2">
                          {starterEntries
                            .filter(entry => entry.quickActions.length > 0)
                            .map(entry => {
                              const visual = getStudioVisual(entry.id);
                              const Icon = visual.icon;
                              return (
                                <div
                                  key={entry.id}
                                  className="flex items-center gap-2 flex-wrap"
                                >
                                  <div className="flex items-center gap-1.5 min-w-[7rem] sm:min-w-[8rem]">
                                    <div
                                      className={`w-5 h-5 rounded-md bg-gradient-to-br ${visual.gradient} flex items-center justify-center text-white shrink-0`}
                                    >
                                      <Icon className="w-3 h-3" />
                                    </div>
                                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200 truncate">
                                      {entry.label}
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap gap-1 flex-1">
                                    {entry.quickActions.slice(0, 3).map(action => (
                                      <button
                                        type="button"
                                        key={action.id}
                                        onClick={() =>
                                          void handleStarterQuickAction(entry, action)
                                        }
                                        className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-200/80 text-emerald-700 bg-emerald-50/70 hover:bg-emerald-100/80 dark:border-emerald-700/50 dark:text-emerald-300 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/40 transition-colors"
                                      >
                                        {action.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </section>
                </CollapsibleContent>
              </Collapsible>
            </motion.section>
          )}
        </div>

        {/* ── 對話內 Pending 卡（反問 / 計畫確認 / 執行進度）─────────────
            這三種互動原本以 floating panel 漂在右下角，在 /agent 頁
            重複疊在輸入框上方很擾人。改成 inline 卡片放在聊天區上方，
            「光球正在等你決定」就直接出現在使用者注意力中心。
            GlobalOrbChatProvider 也偵測 /agent 路徑時自動 suppress
            floating 版本，避免雙重顯示。 */}
        {(globalChat.pendingClarification ||
          globalChat.pendingWorkflow ||
          globalChat.workflowExecution) && (
          <motion.section
            key="inline-pending-cards"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full space-y-2"
            data-testid="agent-inline-pending-stack"
          >
            <div className="flex items-center gap-1.5 px-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                {globalChat.pendingClarification
                  ? "光球正在問你"
                  : globalChat.pendingWorkflow
                    ? "光球擬好計畫，等你確認"
                    : "光球正在執行中"}
              </p>
            </div>
            <div className="flex flex-col gap-2 items-stretch">
              {globalChat.pendingClarification && (
                <ClarificationPromptCard
                  prompt={globalChat.pendingClarification}
                  isBusy={globalChat.isSending}
                  onAnswer={text => void globalChat.answerClarification(text)}
                  onMultiAnswer={(answers, extra) =>
                    void globalChat.answerMultiClarification(answers, extra)
                  }
                  onCancel={globalChat.cancelClarification}
                />
              )}
              {globalChat.pendingWorkflow && (
                <WorkflowConfirmationCard
                  pendingWorkflow={globalChat.pendingWorkflow}
                  isBusy={globalChat.isSending}
                  onStart={globalChat.startPendingWorkflow}
                  onRevise={globalChat.revisePendingWorkflow}
                  onCancel={globalChat.cancelPendingWorkflow}
                />
              )}
              {!globalChat.pendingWorkflow && globalChat.workflowExecution && (
                <WorkflowExecutionFloatingPanel
                  workflowExecution={globalChat.workflowExecution}
                  onDismiss={globalChat.clearWorkflowExecution}
                />
              )}
            </div>
          </motion.section>
        )}

        {/* 聊天區 — `aria-live="polite"` so screen readers announce new
           orb replies as they land instead of staying silent and forcing
           the user to navigate the message list manually. */}
        <div
          ref={scrollRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="光球對話"
          className="flex-1 min-h-[22rem] max-h-[55vh] overflow-y-auto space-y-3 px-3 py-3 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 bg-white/45 dark:bg-slate-900/25 backdrop-blur-sm scroll-smooth"
        >
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => (
              <motion.div
                key={`${msg.at}-${i}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className={`flex ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[88%] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-gradient-to-br from-emerald-400 to-sky-400 text-white rounded-2xl rounded-br-md shadow-md"
                      : "bg-white/80 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 rounded-2xl rounded-bl-md border border-slate-200/60 dark:border-slate-700/60 backdrop-blur"
                  }`}
                >
                  {msg.intent && msg.role === "orb" && (
                    <div className="mb-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                      💭 {msg.intent}
                    </div>
                  )}
                  <ChatMessageText
                    text={msg.text}
                    linkClassName={
                      msg.role === "user"
                        ? "underline decoration-white/60 underline-offset-2 hover:text-white inline-flex items-center gap-0.5"
                        : "underline decoration-cyan-400 underline-offset-2 text-cyan-700 hover:text-cyan-800 inline-flex items-center gap-0.5"
                    }
                    onIntentSelect={
                      msg.role === "orb" ? handleIntentCardSelect : undefined
                    }
                    intentDisabled={isSending}
                  />
                  {msg.attachments?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {msg.attachments.map(attachment => (
                        <a
                          key={attachment.id}
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                            msg.role === "user"
                              ? "border-white/30 bg-white/15 text-white hover:bg-white/25"
                              : "border-slate-200/70 bg-slate-50/70 text-slate-600 hover:bg-slate-100 dark:border-slate-600/60 dark:bg-slate-700/40 dark:text-slate-200 dark:hover:bg-slate-700/70"
                          }`}
                        >
                          <span>{attachmentKindEmoji(attachment.kind)}</span>
                          <span className="truncate max-w-[200px]">{attachment.name}</span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {msg.webSources?.length ? (
                    <div className="mt-2 border-t border-slate-200/40 dark:border-slate-700/40 pt-2 space-y-1">
                      <div className="text-[10px] uppercase tracking-wider text-slate-400">
                        來源 · Sources
                      </div>
                      {msg.webSources.map((src, idx) => (
                        <a
                          key={`${src.url}-${idx}`}
                          href={src.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="block text-[11px] text-cyan-700 dark:text-cyan-300 hover:underline truncate"
                          title={src.url}
                        >
                          {idx + 1}. {src.title}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {msg.searchResults?.length ? (
                    <OrbSearchResultsCard
                      query={msg.searchQuery}
                      items={msg.searchResults}
                    />
                  ) : null}
                  <div className="mt-1.5 text-[10px] opacity-60 flex items-center gap-1">
                    <Clock3 className="w-3 h-3" />
                    {new Date(msg.at).toLocaleTimeString("zh-TW", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </motion.div>
            ))}
            {isSending && (
              <motion.div
                key="typing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex justify-start"
              >
                <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-white/70 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 text-slate-500 dark:text-slate-400 text-sm flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  讓我想想…
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 快速回覆（對話中途的反問建議）— 用快選圖卡呈現，比小膠囊更好讀 */}
        {!isFirstTurn && suggestions.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-slate-400 dark:text-slate-500 px-1">
              快選回應 ✨
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {suggestions.map(s => {
                const emoji = inferSuggestionEmoji(s);
                return (
                  <motion.button
                    key={s}
                    onClick={() => void send(s)}
                    disabled={isSending}
                    whileHover={{ y: -1.5 }}
                    whileTap={{ scale: 0.99 }}
                    className="group flex items-start gap-2.5 rounded-2xl border border-slate-200/70 dark:border-slate-700/60 bg-white/85 dark:bg-slate-800/70 px-3 py-2.5 text-left shadow-sm backdrop-blur hover:border-emerald-300 hover:bg-emerald-50/70 dark:hover:border-emerald-500/50 dark:hover:bg-emerald-900/30 disabled:opacity-50 transition-all"
                  >
                    <span className="text-base leading-none mt-0.5 shrink-0">{emoji}</span>
                    <span className="text-xs leading-snug text-slate-700 dark:text-slate-200 line-clamp-3">
                      {s}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          </div>
        )}
        {/* 學習中心捷徑（對話中途顯示） */}
        {!isFirstTurn && (
          <div className="flex items-center gap-2">
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              想系統化學習 📚
            </p>
            <button
              type="button"
              onClick={() => setLocation("/learn")}
              className="text-[11px] px-2 py-1 rounded-md border border-slate-200/70 text-slate-500 hover:text-slate-700 hover:border-slate-300 transition-colors"
            >
              學習文件中心
            </button>
          </div>
        )}

        {/* 隱藏的檔案 input — 給 attachments hook 觸發。Hoist 到此處讓
            hero / sticky 兩種 composer 共用同一個 DOM ref。 */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ORB_UPLOAD_ACCEPT}
          multiple
          className="hidden"
          onChange={e => {
            void handleFiles(e.target.files);
          }}
        />

        {/* 輸入列 — 第二輪以後才顯示在底部，第一輪改用上方 hero composer */}
        {!isFirstTurn && (
        <div className="sticky bottom-4 space-y-2.5">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1">
              {attachments.map(attachment => (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => removeAttachment(attachment.id)}
                  title="移除附件"
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200/70 bg-white/90 px-3 py-1 text-xs text-slate-600 shadow-sm hover:bg-white dark:border-slate-700/60 dark:bg-slate-800/80 dark:text-slate-200"
                >
                  <span>{attachmentKindEmoji(attachment.kind)}</span>
                  <span className="max-w-[160px] truncate">{attachment.name}</span>
                  <X className="w-3 h-3 opacity-70" />
                </button>
              ))}
            </div>
          )}

          {/* 模式工具列：點下去會亮起來，再輸入自己的提示詞送出即可。 */}
          <Collapsible open={modeBarOpen} onOpenChange={setModeBarOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="w-full flex items-center justify-between px-2 text-[11px] text-slate-500 dark:text-slate-400"
              >
                <span>進階模式（多步驟 / 計畫 / 跳頁 / 功能詢問）</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${modeBarOpen ? "rotate-180" : ""}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1">
              <div className="flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5 scrollbar-thin">
                {modeOptions.map(option => {
                  const Icon = option.icon;
                  const isActive = activeMode === option.id;
                  const accentClasses = isActive
                    ? {
                        violet:
                          "border-violet-300 bg-violet-100 text-violet-700 shadow-sm shadow-violet-200/60 dark:border-violet-500/60 dark:bg-violet-500/20 dark:text-violet-200",
                        emerald:
                          "border-emerald-300 bg-emerald-100 text-emerald-700 shadow-sm shadow-emerald-200/60 dark:border-emerald-500/60 dark:bg-emerald-500/20 dark:text-emerald-200",
                        sky: "border-sky-300 bg-sky-100 text-sky-700 shadow-sm shadow-sky-200/60 dark:border-sky-500/60 dark:bg-sky-500/20 dark:text-sky-200",
                        amber:
                          "border-amber-300 bg-amber-100 text-amber-700 shadow-sm shadow-amber-200/60 dark:border-amber-500/60 dark:bg-amber-500/20 dark:text-amber-200",
                      }[option.accent]
                    : "border-slate-200/70 bg-white/70 text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-400 dark:hover:text-slate-200";
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => toggleMode(option.id)}
                      disabled={isSending}
                      aria-pressed={isActive}
                      title={option.description}
                      className={`group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all disabled:opacity-40 ${accentClasses}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{option.label}</span>
                      {isActive && (
                        <span
                          aria-hidden
                          className="ml-0.5 inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* 已點亮模式的提示條：清楚告訴使用者「現在輸入會以這個模式送出」 */}
          {activeModeOption && (
            <motion.div
              key={activeModeOption.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-900/20 px-3 py-1.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <p className="text-[11px] text-emerald-700 dark:text-emerald-300 truncate">
                  目前模式：<span className="font-semibold">{activeModeOption.label}</span>
                  <span className="opacity-70"> · {activeModeOption.description}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveMode(null)}
                className="text-[11px] text-emerald-700/70 hover:text-emerald-800 dark:text-emerald-300/70 dark:hover:text-emerald-200 shrink-0"
              >
                取消
              </button>
            </motion.div>
          )}

          <div className="flex items-center gap-2 bg-white/90 dark:bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-slate-200/70 dark:border-slate-700/60 shadow-lg p-2 ring-1 ring-emerald-100/60 dark:ring-emerald-900/20 focus-within:ring-emerald-300/70 dark:focus-within:ring-emerald-600/40 transition-all">
            <button
              type="button"
              onClick={pickAttachment}
              disabled={isSending || isUploading}
              title="上傳圖片 / 影片 / 音訊 / PDF"
              aria-label={
                isUploading ? "正在上傳附件" : "上傳圖片、影片、音訊或 PDF 附件"
              }
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 disabled:opacity-40 transition-colors"
            >
              {isUploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </button>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={isSending}
              placeholder={activeModeOption?.placeholder ?? "說一句話就好…"}
              className="flex-1 bg-transparent outline-none px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 disabled:opacity-50"
            />
            <Button
              onClick={() => void send(input)}
              disabled={(!input.trim() && attachments.length === 0 && !activeModeOption) || isSending || isUploading}
              size="sm"
              className="bg-gradient-to-r from-emerald-400 to-sky-400 hover:from-emerald-500 hover:to-sky-500 text-white border-0 shadow-md disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
        )}

      </div>

      <AgentSettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
