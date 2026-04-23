import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react";
import {
  motion,
  AnimatePresence,
  type PanInfo,
  useAnimation,
} from "framer-motion";
import { useAIState } from "@/contexts/AIStateContext";
import {
  usePersonality,
  PERSONALITY_CONFIGS,
} from "@/contexts/PersonalityContext";
import type { Personality } from "@/contexts/PersonalityContext";
import VisualSoul from "./VisualSoul";
import {
  X,
  Sparkles,
  Lightbulb,
  Palette,
  Shuffle,
  MessageCircle,
  Paperclip,
  Send,
  Heart,
  Music,
  Video,
  Film,
  Image,
  Mic,
  BookOpen,
  RotateCcw,
  Loader2,
  Leaf,
  VolumeX,
  Volume2,
  Bot,
  Zap,
  ArrowRight,
  Navigation,
  Navigation2,
  Layers,
  Cpu,
  Shield,
  Users,
  RefreshCw,
  Clock,
  BarChart3,
  Coins,
  Settings,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useFocusFlow } from "@/contexts/FocusFlowContext";
import FocusFlowMini from "./FocusFlowMini";
import { useOrbGuide, type GuideIntent } from "@/contexts/OrbGuideContext";
import OrbGuidePanel from "./OrbGuidePanel";
import { usePageAgent } from "@/contexts/PageAgentContext";
import { parseLLMActions, type AgentAction } from "../../../shared/agent-actions";
import { useLocation } from "wouter";
import { getPageByPath } from "@/config/appRegistry";
import { useIsMobile } from "@/hooks/useMobile";
import { cn } from "@/lib/utils";
import {
  useGlobalOrbChat,
  type ChatAttachment,
  getPageEmoji,
  formatMessageMetadata,
} from "@/contexts/GlobalOrbChatContext";
import { shortErrorMsg, uploadFileToS3 } from "@/lib/upload";

type Props = {
  className?: string;
  enableOnboarding?: boolean;
  onSaveToNotes?: (payload: {
    title: string;
    content?: string;
    sourceType?: string;
  }) => void;
  onAddToCalendar?: (payload: {
    title: string;
    description?: string;
    date: Date;
  }) => void;
  onOpenNotes?: () => void;
  onOpenCalendar?: () => void;
  onRestartTour?: () => void;
  /** Apply inspiration blocks to the prompt builder */
  onApplyInspiration?: (blocks: {
    subject?: string;
    style?: string;
    lighting?: string;
    color?: string;
    mood?: string;
  }) => void;
  /** Switch modality tab */
  onSwitchModality?: (modality: "image" | "video" | "audio" | "voice") => void;
  /** Navigate to a page (agent action) */
  onNavigate?: (path: string) => void;
};

const POSITION_KEY = "proactive-orb-position";
const ONBOARDED_KEY = "onboarded";

// ─── Persistence helpers ──────────────────────────────────────────────────

function loadPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.x === "number" && typeof parsed.y === "number")
        return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function savePosition(x: number, y: number) {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify({ x, y }));
  } catch {
    /* ignore */
  }
}

const ORB_UPLOAD_ACCEPT = "image/*,video/*,audio/*,.pdf";

function resolveAttachmentKind(mimeType: string): ChatAttachment["kind"] | null {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  return null;
}

function isOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "true";
  } catch {
    return true;
  }
}

function markOnboarded() {
  try {
    localStorage.setItem(ONBOARDED_KEY, "true");
  } catch {
    /* ignore */
  }
}

// ─── Inspiration presets ─────────────────────────────────────────────────

interface InspirationPreset {
  label: string;
  emoji: string;
  mood: string;
  blocks: {
    subject?: string;
    style?: string;
    lighting?: string;
    color?: string;
    mood?: string;
  };
  modality?: "image" | "video" | "audio" | "voice";
}

const INSPIRATION_PRESETS: InspirationPreset[] = [
  {
    label: "寧靜森林",
    emoji: "🌿",
    mood: "平靜",
    blocks: {
      subject: "森林",
      style: "水彩畫",
      lighting: "柔光",
      color: "冷色調",
      mood: "寧靜",
    },
  },
  {
    label: "星空冒險",
    emoji: "✨",
    mood: "期待",
    blocks: {
      subject: "星空",
      style: "賽博龐克",
      lighting: "霓虹燈",
      color: "高飽和",
      mood: "神秘",
    },
  },
  {
    label: "溫暖日落",
    emoji: "🌅",
    mood: "溫暖",
    blocks: {
      subject: "海邊",
      style: "油畫",
      lighting: "黃金時刻",
      color: "暖色調",
      mood: "懷舊",
    },
  },
  {
    label: "夢幻花園",
    emoji: "🌸",
    mood: "浪漫",
    blocks: {
      subject: "花朵",
      style: "浮世繪",
      lighting: "柔光",
      color: "低飽和",
      mood: "夢幻",
    },
  },
  {
    label: "雨天咖啡",
    emoji: "☕",
    mood: "放鬆",
    blocks: {
      subject: "咖啡廳",
      style: "水彩畫",
      lighting: "燭光",
      color: "暖色調",
      mood: "慵懶",
    },
  },
  {
    label: "科幻都市",
    emoji: "🏙️",
    mood: "興奮",
    blocks: {
      subject: "城市",
      style: "賽博龐克",
      lighting: "霓虹燈",
      color: "高飽和",
      mood: "未來感",
    },
  },
];

// ─── Mood-based greetings ────────────────────────────────────────────────

const MOOD_GREETINGS: Record<string, string[]> = {
  calm: [
    "🌿 今天想創作什麼呢？不急，慢慢想。",
    "✨ 深呼吸，讓靈感像風一樣自然流過。",
    "🌸 好的作品不需要趕，享受過程就好。",
    "💫 你的創意空間已準備好了，隨時開始。",
  ],
  creative: [
    "✨ 今天的心情是什麼顏色呢？",
    "🎨 想像一下你心中最美的畫面⋯⋯",
    "💫 每個靈感都值得被看見，試試看吧！",
    "🌈 大膽嘗試，這裡沒有對錯，只有探索。",
  ],
  technical: [
    "🔧 需要參數建議嗎？我來幫你。",
    "✨ 找到最適合的設定，讓創作更順暢。",
    "💡 技術細節交給我，你專注在靈感上。",
    "🌿 精確和放鬆可以並存，慢慢調整就好。",
  ],
};

// ─── Page-aware greetings ─────────────────────────────────────────────────

const PAGE_GREETINGS: Record<string, string[]> = {
  "image-studio": [
    "🎨 想創作什麼畫面呢？慢慢想，我在這陪你。",
    "✨ 從一個情緒或顏色開始，剩下的讓 AI 來。",
    "🌸 圖片是心靈的窗戶，畫出你此刻的感受吧。",
  ],
  "video-studio": [
    "🎬 影片是會動的詩，想像你要的畫面流動起來⋯⋯",
    "✨ 不用著急，好的影片值得等待。",
    "💫 用文字描述一個場景，讓 AI 把它變成現實。",
  ],
  "pro-studio": [
    "🎵 想聽什麼樣的聲音呢？告訴我你的心情。",
    "🌿 音樂是最溫柔的療癒，試試看吧。",
    "✨ 從旋律到配音，這裡都可以幫你完成。",
  ],
  "lora-trainer": [
    "🌱 訓練自己的 AI 模型，就像培育一顆種子。",
    "✨ 準備好素材了嗎？不確定的話我可以幫你。",
    "💡 好的訓練不需要很多圖片，品質比數量重要。",
  ],
  director: [
    "🎬 導演模式啟動中，先把故事節奏抓好再選模型。",
    "✨ 腳本、分鏡、配樂、旁白都能一起規劃，我陪你逐步拆解。",
    "🧭 想先省成本還是先求品質？我可以幫你配一套生成管線。",
  ],
  learn: [
    "📚 想學什麼呢？我可以推薦適合你的內容。",
    "🌿 慢慢學，每一步都算數。",
    "✨ 這裡有豐富的教學資源，享受學習的過程。",
  ],
  shared: [
    "🌈 看看大家的創作，也許能遇見靈感。",
    "✨ 每個作品背後都有一個故事。",
    "💫 分享是一種療癒，你的作品也能溫暖別人。",
  ],
  dashboard: [
    "🌿 這是你的創作空間總覽，看看最近的成果吧。",
    "✨ 每次創作都是一次小旅行。",
    "💫 不用比較，享受自己的創作節奏就好。",
  ],
  history: [
    "📖 回顧過去的創作，每一個都是你的足跡。",
    "✨ 找到喜歡的作品了嗎？可以隨時重新使用。",
    "🌸 每次嘗試都值得珍惜。",
  ],
  models: [
    "🔧 這裡有各種 AI 模型，需要我幫你挑選嗎？",
    "✨ 每個模型有不同的個性，慢慢認識它們。",
    "💡 不確定用哪個？告訴我你想做什麼，我來推薦。",
  ],
  "brain-settings": [
    "🧠 AI 大腦的設定中心，技術細節都在這裡。",
    "🔧 有任何異常我會幫你注意的。",
    "✨ 這些工具是為了讓你的創作更順暢。",
  ],
};

// ─── Quick actions for the interaction panel ─────────────────────────────

interface QuickAction {
  icon: React.ReactNode;
  label: string;
  description: string;
  action: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    icon: <Shuffle className="w-4 h-4" />,
    label: "隨機靈感",
    description: "讓我幫你隨機組合一組靈感積木",
    action: "random",
  },
  {
    icon: <MessageCircle className="w-4 h-4" />,
    label: "聊聊天",
    description: "分享你的心情或想法",
    action: "chat",
  },
  {
    icon: <Heart className="w-4 h-4" />,
    label: "療癒推薦",
    description: "根據心情推薦創作方向",
    action: "chat-healing",
  },
  {
    icon: <Navigation2 className="w-4 h-4" />,
    label: "互動式導覽",
    description: "一步一步帶你操作目前這一頁",
    action: "interactive-guide",
  },
];

// ─── Page-specific quick actions (contextual AI agent capabilities) ────────

const PAGE_QUICK_ACTIONS: Record<string, QuickAction[]> = {
  studio: [
    {
      icon: <Sparkles className="w-4 h-4" />,
      label: "建立工作流",
      description: "先建立模態、模式，再進工具箱與素材",
      action: "studio-workflow-bootstrap",
    },
    {
      icon: <Layers className="w-4 h-4" />,
      label: "頁面細節",
      description: "改成頁面細節導引（取代空的靈感連接）",
      action: "page-deep-dive",
    },
    {
      icon: <Coins className="w-4 h-4" />,
      label: "生成積分預估",
      description: "先估算本頁模型生成所需積分，再決定執行策略",
      action: "chat-credits-estimate",
    },
  ],
  "image-studio": [
    {
      icon: <Image className="w-4 h-4" />,
      label: "模型推薦",
      description: "根據你的需求推薦最適合的圖片模型",
      action: "chat-model-recommend",
    },
    {
      icon: <Cpu className="w-4 h-4" />,
      label: "模型細節導覽",
      description: "逐一解說模型長處、功能與適用任務",
      action: "chat-image-model-deep-dive",
    },
    {
      icon: <Sparkles className="w-4 h-4" />,
      label: "提詞優化",
      description: "讓 AI 幫你改進提示詞",
      action: "chat-prompt-optimize",
    },
    {
      icon: <Coins className="w-4 h-4" />,
      label: "生成積分預估",
      description: "估算不同圖片模型本次生成約需積分",
      action: "chat-credits-estimate",
    },
  ],
  "video-studio": [
    {
      icon: <Video className="w-4 h-4" />,
      label: "模型比較",
      description: "幫你比較 Kling / Veo / Sora 等影片模型",
      action: "chat-model-compare",
    },
    {
      icon: <Cpu className="w-4 h-4" />,
      label: "模型細節導覽",
      description: "逐一解說影片模型長處、功能優勢與取捨",
      action: "chat-video-model-deep-dive",
    },
    {
      icon: <Sparkles className="w-4 h-4" />,
      label: "影片提詞技巧",
      description: "教你寫出更好的影片生成提示詞",
      action: "chat-video-tips",
    },
    {
      icon: <Coins className="w-4 h-4" />,
      label: "生成積分預估",
      description: "估算不同影片模型與秒數所需積分",
      action: "chat-credits-estimate",
    },
  ],
  "pro-studio": [
    {
      icon: <Music className="w-4 h-4" />,
      label: "音樂風格建議",
      description: "推薦適合你的音樂風格和模型",
      action: "chat-music-style",
    },
    {
      icon: <Cpu className="w-4 h-4" />,
      label: "模型細節導覽",
      description: "逐一解說音樂/配音模型長處、功能優勢與取捨",
      action: "chat-pro-model-deep-dive",
    },
    {
      icon: <Mic className="w-4 h-4" />,
      label: "配音技巧",
      description: "語音合成和聲音克隆的最佳實踐",
      action: "chat-voice-tips",
    },
    {
      icon: <Coins className="w-4 h-4" />,
      label: "生成積分預估",
      description: "估算音樂/配音模型生成所需積分",
      action: "chat-credits-estimate",
    },
  ],
  director: [
    {
      icon: <Film className="w-4 h-4" />,
      label: "管線模型導覽",
      description: "拆解導演 AI 圖像/影片/音樂/語音模型搭配",
      action: "chat-director-model-deep-dive",
    },
    {
      icon: <Coins className="w-4 h-4" />,
      label: "生成積分預估",
      description: "估算導演 AI 全流程生成大約所需積分",
      action: "chat-credits-estimate",
    },
  ],
  "lora-trainer": [
    {
      icon: <Sparkles className="w-4 h-4" />,
      label: "訓練建議",
      description: "如何準備最佳的訓練資料集",
      action: "chat-training-tips",
    },
  ],
  assets: [
    {
      icon: <Layers className="w-4 h-4" />,
      label: "素材子項目導覽",
      description: "深度整理圖片/影片/音訊素材與可重用策略",
      action: "chat-assets-subitems-deep-dive",
    },
    {
      icon: <Navigation2 className="w-4 h-4" />,
      label: "8 子分頁工作流",
      description: "一次串起素材與模型 8 個子分頁",
      action: "chat-assets-model-workflow",
    },
  ],
  history: [
    {
      icon: <Clock className="w-4 h-4" />,
      label: "歷史反推導覽",
      description: "從歷史紀錄反推模型選型與參數規律",
      action: "chat-history-deep-dive",
    },
  ],
  "prompt-library": [
    {
      icon: <BookOpen className="w-4 h-4" />,
      label: "模板細膩導覽",
      description: "解析提示詞模板、變體與模型對應",
      action: "chat-prompt-library-deep-dive",
    },
  ],
  models: [
    {
      icon: <Cpu className="w-4 h-4" />,
      label: "模型版本導覽",
      description: "比較版本用途、風險與參數起手式",
      action: "chat-models-deep-dive",
    },
  ],
  vault: [
    {
      icon: <Shield className="w-4 h-4" />,
      label: "一致性規格導覽",
      description: "建立角色/場景錨點與跨模型一致策略",
      action: "chat-vault-deep-dive",
    },
  ],
  shared: [
    {
      icon: <Users className="w-4 h-4" />,
      label: "共享復用導覽",
      description: "拆解共享素材/模型的團隊復用流程",
      action: "chat-shared-deep-dive",
    },
  ],
  "background-tasks": [
    {
      icon: <RefreshCw className="w-4 h-4" />,
      label: "任務佇列導覽",
      description: "判讀耗時、成功率與重試優先順序",
      action: "chat-background-tasks-deep-dive",
    },
  ],
  notes: [
    {
      icon: <BookOpen className="w-4 h-4" />,
      label: "規劃筆記導覽",
      description: "整理腳本、待辦與優先級執行清單",
      action: "chat-notes-deep-dive",
    },
  ],
  calendar: [
    {
      icon: <Clock className="w-4 h-4" />,
      label: "創作排程導覽",
      description: "安排一週素材、生成、訓練與交付節奏",
      action: "chat-calendar-deep-dive",
    },
  ],
  dashboard: [
    {
      icon: <BarChart3 className="w-4 h-4" />,
      label: "數據洞察導覽",
      description: "解讀請求量、成本與效率趨勢",
      action: "chat-dashboard-deep-dive",
    },
  ],
  credits: [
    {
      icon: <Coins className="w-4 h-4" />,
      label: "積分規則導覽",
      description: "比較費率、消耗與節省策略",
      action: "chat-credits-deep-dive",
    },
  ],
  settings: [
    {
      icon: <Settings className="w-4 h-4" />,
      label: "個人設定導覽",
      description: "逐項說明外觀、通知與場景設定",
      action: "chat-settings-deep-dive",
    },
  ],
  learn: [
    {
      icon: <BookOpen className="w-4 h-4" />,
      label: "學習路徑",
      description: "推薦適合你程度的學習文件",
      action: "chat-learning-path",
    },
  ],
};

const PROACTIVE_NUDGE_KEY = "orb-proactive-nudge-seen";

const PAGE_TO_GUIDE_INTENT: Partial<Record<string, GuideIntent>> = {
  studio: "explore",
  "image-studio": "image",
  "video-studio": "video",
  "pro-studio": "music",
  director: "script",
  "lora-trainer": "lora",
};

// ─── 90-second onboarding step definitions ────────────────────────────────

interface OnboardingStep {
  elementId: string;
  message: string;
  startSec: number;
  endSec: number;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  // Step 1: 首先指向光球本身 — 告訴使用者光球是入口
  {
    elementId: "proactive-orb-anchor",
    message: "我是你的 AI 光球助手 ✨ 點我輸入『今天想做什麼』，我帶你去！",
    startSec: 0,
    endSec: 18,
  },
  // Step 2: 指向 prompt builder
  {
    elementId: "prompt-builder-area",
    message: "這裡可以建構你的想法，幾個字就行 🎨",
    startSec: 18,
    endSec: 35,
  },
  // Step 3: 指向模態切換
  {
    elementId: "modality-tabs",
    message: "圖、影、音、聲 — 四種創作隨時切換 🎬",
    startSec: 35,
    endSec: 52,
  },
  // Step 4: 指向生成按鈕
  {
    elementId: "generate-button",
    message: "準備好了？按下去，魔法即將發生 ✨",
    startSec: 52,
    endSec: 70,
  },
];

const GUIDE_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Compact mm:ss for the orb badge */
function formatTimerBadge(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Component ────────────────────────────────────────────────────────────

export default memo(function ProactiveOrbWidget({
  className = "",
  enableOnboarding = true,
  onSaveToNotes,
  onAddToCalendar,
  onOpenNotes,
  onOpenCalendar,
  onRestartTour,
  onApplyInspiration,
  onSwitchModality,
  onNavigate,
}: Props) {
  const {
    aiState,
    proactiveMessage,
    dismissProactive,
    pageContext,
    quietMode,
    setQuietMode,
  } = useAIState();
  const {
    personality,
    setPersonality,
    isManual,
    resetToAuto,
    config: personalityConfig,
  } = usePersonality();
  const {
    isAnyTimerRunning,
    activeMode,
    pomodoroRemaining,
    healingRemaining,
    pomodoroPhase,
  } = useFocusFlow();
  const orbControls = useAnimation();
  const isMobile = useIsMobile();

  // ─── Global Orb Chat Integration ──────────────────────────────────────
  const globalChat = useGlobalOrbChat();

  // Drag position state
  const [position, setPosition] = useState<{ x: number; y: number }>(
    () => loadPosition() || { x: 0, y: 0 }
  );
  const [hasDragged, setHasDragged] = useState(() => !!loadPosition());

  // Onboarding state
  const [guiding, setGuiding] = useState(false);
  const [guideMessage, setGuideMessage] = useState<string | null>(null);
  const [onboardingActive, setOnboardingActive] = useState(false);
  const onboardingTimerRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const abortRef = useRef(false);

  // Drop zone state
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [dropFlash, setDropFlash] = useState<string | null>(null);

  // Interaction panel state
  const [showPanel, setShowPanel] = useState(false);
  const [panelView, setPanelView] = useState<
    "main" | "chat" | "inspiration" | "focus-flow"
  >("main");
  // Use global chat state instead of local state
  const chatInput = globalChat.input;
  const setChatInput = globalChat.setInput;
  const chatMessages = globalChat.messages; // Keep full message objects for metadata
  const isChatLoading = globalChat.isSending;
  const chatSuggestions = globalChat.suggestions.map(s => s.text);
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Home position
  const homePositionRef = useRef(position);

  // Random greeting based on personality + page context
  const greeting = useMemo(() => {
    // Prefer page-specific greetings when available
    const pageGreetings = pageContext?.pageId
      ? PAGE_GREETINGS[pageContext.pageId]
      : null;
    const greetings =
      pageGreetings ?? MOOD_GREETINGS[personality] ?? MOOD_GREETINGS.calm;
    return greetings[Math.floor(Math.random() * greetings.length)];
  }, [personality, showPanel, pageContext?.pageId]);

  // ─── guideTo method ───────────────────────────────────────────────────

  const guideTo = useCallback(
    async (elementId: string, message: string) => {
      if (abortRef.current) return;

      const el = document.getElementById(elementId);
      if (!el) return;

      setGuiding(true);
      setGuideMessage(message);

      const rect = el.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;

      const orbAnchorX = viewportW - 24 - 24;
      const orbAnchorY = viewportH - 24 - 24;

      const targetX = rect.left - 60;
      const targetY = rect.top + rect.height / 2 - 24;

      const deltaX = targetX - orbAnchorX;
      const deltaY = targetY - orbAnchorY;

      await orbControls.start({
        x: deltaX,
        y: deltaY,
        transition: { duration: 0.8, ease: GUIDE_EASE },
      });

      if (abortRef.current) return;

      for (let i = 0; i < 2; i++) {
        if (abortRef.current) break;
        await orbControls.start({ scale: 1.2, transition: { duration: 0.15 } });
        await orbControls.start({ scale: 1, transition: { duration: 0.15 } });
      }

      if (abortRef.current) return;

      el.style.transition = "box-shadow 0.3s ease, outline 0.3s ease";
      el.style.outline = "2px solid rgba(255,180,120,0.6)";
      el.style.boxShadow = "0 0 20px rgba(255,180,120,0.3)";

      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 1500);
        onboardingTimerRef.current.push(timer);
      });

      if (abortRef.current) return;

      el.style.outline = "";
      el.style.boxShadow = "";

      setGuideMessage(null);
      await orbControls.start({
        x: homePositionRef.current.x,
        y: homePositionRef.current.y,
        scale: 1,
        transition: { duration: 0.6, ease: GUIDE_EASE },
      });

      setGuiding(false);
    },
    [orbControls]
  );

  // ─── 90-second onboarding sequence ────────────────────────────────────

  useEffect(() => {
    if (!enableOnboarding || isOnboarded()) return;

    const startDelay = setTimeout(() => {
      setOnboardingActive(true);
      abortRef.current = false;

      const runSequence = async () => {
        for (const step of ONBOARDING_STEPS) {
          if (abortRef.current) break;

          const now = performance.now();
          const elapsed = (now - sequenceStart) / 1000;
          const waitTime = Math.max(0, step.startSec - elapsed);

          if (waitTime > 0) {
            await new Promise<void>(resolve => {
              const timer = setTimeout(resolve, waitTime * 1000);
              onboardingTimerRef.current.push(timer);
            });
          }

          if (abortRef.current) break;
          await guideTo(step.elementId, step.message);
        }

        if (!abortRef.current) {
          markOnboarded();
          setOnboardingActive(false);
        }
      };

      const sequenceStart = performance.now();
      runSequence();
    }, 2000);

    return () => {
      clearTimeout(startDelay);
      abortRef.current = true;
      onboardingTimerRef.current.forEach(clearTimeout);
      onboardingTimerRef.current = [];
    };
  }, [enableOnboarding, guideTo]);

  // ─── Skip onboarding handler ──────────────────────────────────────────

  const skipOnboarding = useCallback(() => {
    abortRef.current = true;
    onboardingTimerRef.current.forEach(clearTimeout);
    onboardingTimerRef.current = [];
    setGuiding(false);
    setGuideMessage(null);
    setOnboardingActive(false);
    markOnboarded();

    orbControls.start({
      x: homePositionRef.current.x,
      y: homePositionRef.current.y,
      scale: 1,
      transition: { duration: 0.4 },
    });
  }, [orbControls]);

  // ─── Drag handlers ────────────────────────────────────────────────────

  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  function handleDragStart(
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) {
    dragStartRef.current = { x: info.point.x, y: info.point.y };
  }

  function handleDragEnd(
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) {
    if (guiding) return;

    // Detect if it was a tap (very small movement)
    const dist = Math.sqrt(info.offset.x ** 2 + info.offset.y ** 2);
    if (dist < 5) {
      // This was a tap, not a drag — toggle panel
      handleOrbClick();
      return;
    }

    const newX = position.x + info.offset.x;
    const newY = position.y + info.offset.y;
    const clampedX = Math.max(-(window.innerWidth - 80), Math.min(0, newX));
    const clampedY = Math.max(-(window.innerHeight - 80), Math.min(0, newY));

    setPosition({ x: clampedX, y: clampedY });
    homePositionRef.current = { x: clampedX, y: clampedY };
    savePosition(clampedX, clampedY);
    setHasDragged(true);
  }

  // Re-clamp on window resize
  useEffect(() => {
    function handleResize() {
      setPosition(prev => {
        const clamped = {
          x: Math.max(-(window.innerWidth - 80), Math.min(0, prev.x)),
          y: Math.max(-(window.innerHeight - 80), Math.min(0, prev.y)),
        };
        homePositionRef.current = clamped;
        return clamped;
      });
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ─── Drop zone handlers ──────────────────────────────────────────────

  const handleNativeDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropTarget(true);
  }, []);

  const handleNativeDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropTarget(false);
  }, []);

  const handleNativeDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDropTarget(false);

      try {
        const raw = e.dataTransfer.getData("text/plain");
        let data: any;
        try {
          data = JSON.parse(raw);
        } catch {
          data = { text: raw };
        }

        setDropFlash(personality);
        setTimeout(() => setDropFlash(null), 800);

        onSaveToNotes?.({
          title: data.title || data.prompt?.slice(0, 30) || "拖曳內容",
          content: data.content || data.text || JSON.stringify(data),
          sourceType: "orb",
        });
        showFeedback("已擷取至筆記 ✓");
      } catch {
        showFeedback("無法解析拖曳內容");
      }
    },
    [personality, onSaveToNotes]
  );

  // ─── Feedback helper ─────────────────────────────────────────────────

  const showFeedback = useCallback((msg: string) => {
    setFeedbackMessage(msg);
    setTimeout(() => setFeedbackMessage(null), 2500);
  }, []);

  // ─── OrbGuide integration ─────────────────────────────────────────────
  const {
    isPanelOpen: isGuideOpen,
    openPanel: openGuidePanel,
    closePanel: closeGuidePanel,
    selectIntent: selectGuideIntent,
    arrivedMessage,
    clearArrivedMessage,
    step: guideStep,
  } = useOrbGuide();

  // ─── PageAgent bus（Phase 1：讓 autoFillPrompt / autoTabId 真的被消費） ──
  const pageAgent = usePageAgent();
  const [locationPath] = useLocation();
  const currentRegistryPage = useMemo(
    () => getPageByPath(locationPath),
    [locationPath]
  );
  const proactiveActions = useMemo(
    () =>
      pageContext?.pageId
        ? (PAGE_QUICK_ACTIONS[pageContext.pageId] ?? []).slice(0, 2)
        : [],
    [pageContext?.pageId]
  );
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!pageContext?.pageId || quietMode || proactiveActions.length === 0) return;
    const key = `${PROACTIVE_NUDGE_KEY}:${pageContext.pageId}`;
    if (sessionStorage.getItem(key) === "1") return;
    sessionStorage.setItem(key, "1");
    showFeedback(`🧭 建議先試試「${proactiveActions[0].label}」`);
  }, [pageContext?.pageId, proactiveActions, quietMode, showFeedback]);

  // 監聽 orb-guide-navigate 事件：導航 + 把 Phase 3e 帶過來的 AgentAction[] 丟進 bus
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        path: string;
        actions?: AgentAction[];
        /** 舊版 fallback：只有 autoFillPrompt 字串時，組成一個 fillPrompt action */
        autoFillPrompt?: string;
        autoTabId?: string;
      };
      onNavigate?.(detail.path);

      const fromArray = Array.isArray(detail.actions) ? detail.actions : [];
      const fallback: AgentAction[] = [];
      if (fromArray.length === 0) {
        if (detail.autoTabId) {
          fallback.push({ type: "setTab", tabId: detail.autoTabId });
        }
        if (detail.autoFillPrompt) {
          fallback.push({ type: "fillPrompt", text: detail.autoFillPrompt });
        }
      }
      const actions = fromArray.length ? fromArray : fallback;

      // 目標頁還沒掛載 → PageAgentContext 會把動作 enqueueAction 暫存，
      // 等頁面 register 時 drainActionsForPage 自動接棒。
      if (actions.length) {
        void pageAgent.dispatchMany(actions, { source: "orb-guide" });
      }
    };
    window.addEventListener("orb-guide-navigate", handler);
    return () => window.removeEventListener("orb-guide-navigate", handler);
  }, [onNavigate, pageAgent]);

  // 到達目標頁面後，顯示 arrivedMessage 作為 proactive
  useEffect(() => {
    if (arrivedMessage) {
      showFeedback(arrivedMessage);
      clearArrivedMessage();
    }
  }, [arrivedMessage, clearArrivedMessage, showFeedback]);

  // 30 秒無操作時，給一個柔和提示
  useEffect(() => {
    const resetIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        showFeedback("要不要我幫你開始？");
      }, 30_000);
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      "pointerdown",
      "mousemove",
      "keydown",
      "touchstart",
      "scroll",
    ];
    activityEvents.forEach(event =>
      window.addEventListener(event, resetIdleTimer, { passive: true })
    );
    resetIdleTimer();

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      activityEvents.forEach(event =>
        window.removeEventListener(event, resetIdleTimer)
      );
    };
  }, [showFeedback]);

  // ─── Orb click handler (single click opens panel) ────────────────────

  const handleOrbClick = useCallback(() => {
    if (guiding) return;
    // 如果 Guide Panel 是開的，關掉；否則優先開 Guide Panel
    if (isGuideOpen) {
      closeGuidePanel();
      return;
    }
    // 首次或主動探索 → 開引導面板（取代舊的 main panel）
    openGuidePanel();
    const pageIntent =
      (pageContext?.pageId && PAGE_TO_GUIDE_INTENT[pageContext.pageId]) || null;
    if (pageIntent) {
      selectGuideIntent(pageIntent);
    }
    setShowPanel(false);
  }, [guiding, isGuideOpen, openGuidePanel, closeGuidePanel, pageContext?.pageId, selectGuideIntent]);

  // Bridge from OrbGuidePanel → interaction panel views
  const handleOpenInteraction = useCallback(
    (view: "inspiration" | "focus-flow" | "chat") => {
      if (view === "chat") {
        const pageLabel = currentRegistryPage?.label ?? pageContext?.pageLabel;
        setPanelView("chat");
        // Open global chat and set initial input if needed
        globalChat.open();
        if (pageLabel && globalChat.messages.length <= 1) {
          // Only set input if chat history is minimal (just welcome message)
          setChatInput(`請先告訴我「${pageLabel}」這頁的最佳起手步驟。`);
        }
      } else if (view === "focus-flow") {
        setPanelView("focus-flow");
      } else {
        setPanelView("inspiration");
      }
      setShowPanel(true);
    },
    [currentRegistryPage?.label, pageContext?.pageLabel, globalChat, setChatInput]
  );

  // ─── Quick action handlers ───────────────────────────────────────────

  const handleQuickAction = useCallback(
    async (action: string) => {
      switch (action) {
        case "random": {
          const preset =
            INSPIRATION_PRESETS[
              Math.floor(Math.random() * INSPIRATION_PRESETS.length)
            ];
          onApplyInspiration?.(preset.blocks);
          showFeedback(`已套用「${preset.label}」靈感 ${preset.emoji}`);
          setShowPanel(false);
          break;
        }
        case "chat":
          setPanelView("chat");
          globalChat.open();
          break;
        case "chat-healing":
          setPanelView("chat");
          globalChat.open();
          setChatInput("我現在的心情是⋯⋯");
          break;
        case "page-deep-dive": {
          const pageLabel = currentRegistryPage?.label ?? pageContext?.pageLabel ?? "這一頁";
          setPanelView("chat");
          globalChat.open();
          setChatInput(`請解說「${pageLabel}」這一頁，先做哪三步最有效。`);
          break;
        }
        case "interactive-guide": {
          const guideIntent =
            (pageContext?.pageId
              ? PAGE_TO_GUIDE_INTENT[pageContext.pageId]
              : undefined) ?? "explore";
          setShowPanel(false);
          openGuidePanel();
          selectGuideIntent(guideIntent);
          showFeedback("已啟動互動式導覽，跟著光球一步步操作 ✨");
          break;
        }
        case "studio-workflow-bootstrap":
          setPanelView("chat");
          globalChat.open();
          setChatInput("接著帶我做：模態→模式→素材→模型→送出第一版。");
          await pageAgent.dispatchMany(
            [
              { type: "setModality", modality: "image" },
              { type: "setMode", modeId: "lightning" },
              { type: "openDialog", dialogId: "toolbox", params: { tab: "assets" } },
            ],
            { source: "manual", requireConfirmation: false }
          );
          break;
        case "tour":
          setShowPanel(false);
          onRestartTour?.();
          break;
        default:
          // Handle page-specific chat actions (chat-model-recommend, chat-prompt-optimize, etc.)
          if (action.startsWith("chat-")) {
            const topicHints: Record<string, string> = {
              "chat-model-recommend": "請推薦適合我的模型",
              "chat-image-model-deep-dive":
                "請詳細比較圖片創作室每個模型的長處、功能優勢與適用場景，並給我選型建議",
              "chat-prompt-optimize": "請幫我優化提示詞",
              "chat-model-compare": "請幫我比較影片模型的差異",
              "chat-video-model-deep-dive":
                "請細膩比較影片創作室每個模型的長處、功能優勢、成本與適用場景，最後給我選型建議",
              "chat-video-tips": "影片提示詞有什麼技巧？",
              "chat-music-style": "請推薦適合的音樂風格",
              "chat-pro-model-deep-dive":
                "請細膩比較音樂配音創作室每個模型的長處、功能優勢、限制與適用場景，最後給我選型建議",
              "chat-director-model-deep-dive":
                "請深度比較導演 AI 生成管線中的圖像/影片/音樂/語音模型長處、成本與適用場景，並給我分鏡選型策略",
              "chat-assets-subitems-deep-dive":
                "請深度整理數位資產庫的圖片/影片/音訊子項目，給我分類規格、命名規則、可重用建議與下一步。",
              "chat-assets-model-workflow":
                "請帶我走一套跨數位資產庫、生成歷史、提示詞庫、共享空間、角色鍛造所、模型訓練中心、一致性保險庫、背景任務中心的完整工作流，逐步說明每一步目的。",
              "chat-history-deep-dive":
                "請用我的生成歷史反推模型選型與參數調整規律，並整理成下次可直接套用的流程。",
              "chat-prompt-library-deep-dive":
                "請深度拆解提示詞庫模板：每種任務的 prompt 結構、可替換欄位、負向詞與模型搭配建議。",
              "chat-models-deep-dive":
                "請深度比較角色鍛造所模型版本差異、最佳用途、風險與推薦參數起手式。",
              "chat-vault-deep-dive":
                "請深度整理一致性保險庫：角色錨點、場景錨點、風格規範如何跨模型維持一致。",
              "chat-shared-deep-dive":
                "請深度拆解共享空間中的素材/模型復用流程，並給我團隊協作與回饋迭代建議。",
              "chat-background-tasks-deep-dive":
                "請深度解讀背景任務中心任務佇列，幫我建立耗時、成功率、失敗重試與排程優先順序策略。",
              "chat-notes-deep-dive":
                "請深度整理我的專案筆記，分成腳本、待辦、排程三類，並輸出可執行的下一步清單與優先序。",
              "chat-calendar-deep-dive":
                "請深度規劃我的創作排程，把素材整理、生成迭代、模型訓練、交付節點安排成一週節奏。",
              "chat-dashboard-deep-dive":
                "請深度解讀儀表板數據，拆解請求量、成本、模態分佈與效率，並給我可執行的優化策略。",
              "chat-credits-deep-dive":
                "請深度解讀積分規則，給我不同任務的耗點預估與低成本驗證到高品質定稿的流程。",
              "chat-credits-estimate": `請以「${currentRegistryPage?.label ?? pageContext?.pageLabel ?? "當前頁"}」為主，估算這頁常用生成模型在本次任務可能消耗多少積分，並給我低成本試跑→高品質定稿的執行建議。`,
              "chat-settings-deep-dive":
                "請細膩導覽個人設定：外觀、場景、通知、引導、管理功能的用途、風險與推薦配置。",
              "chat-voice-tips": "聲音克隆有什麼注意事項？",
              "chat-training-tips": "訓練 LoRA 模型有什麼建議？",
              "chat-learning-path": "推薦適合新手的學習路徑",
            };
            const seedMsg = topicHints[action] ?? "有什麼想聊的嗎？";
            setPanelView("chat");
            globalChat.open();
            setChatInput(seedMsg);
          }
          break;
      }
    },
    [onApplyInspiration, onRestartTour, showFeedback, currentRegistryPage?.label, pageContext?.pageLabel, pageContext?.pageId, pageAgent, globalChat, setChatInput, openGuidePanel, selectGuideIntent]
  );

  const handleRegistryQuickAction = useCallback(
    async (quickAction: {
      path?: string;
      action?: AgentAction;
      prompt?: string;
      label: string;
    }) => {
      if (quickAction.path) {
        onNavigate?.(quickAction.path);
      }
      if (quickAction.action) {
        await pageAgent.dispatch(quickAction.action, {
          source: "manual",
        });
      }
      if (quickAction.prompt) {
        setPanelView("chat");
        setChatInput(quickAction.prompt);
      }
      showFeedback(`已開始：${quickAction.label}`);
    },
    [onNavigate, pageAgent, showFeedback]
  );

  // ─── Chat handler (with real LLM + conversation history) ─────────────

  const handleChatSend = useCallback(async () => {
    if ((!chatInput.trim() && chatAttachments.length === 0) || isChatLoading) return;

    const userMsg = chatInput.trim();

    // Check for modality keywords to trigger UI side effects
    const lower = userMsg.toLowerCase();
    if (
      lower.includes("影片") ||
      lower.includes("視頻") ||
      lower.includes("動畫")
    ) {
      onSwitchModality?.("video");
    } else if (
      lower.includes("音樂") ||
      lower.includes("歌曲") ||
      lower.includes("譜曲")
    ) {
      onSwitchModality?.("audio");
    } else if (lower.includes("配音") || lower.includes("語音合成")) {
      onSwitchModality?.("voice");
    }

    // Use global chat to send the message
    // GlobalOrbChatContext handles all LLM interaction, action dispatch, and message management
    await globalChat.sendMessage(userMsg, chatAttachments);
    setChatAttachments([]);
  }, [
    chatInput,
    chatAttachments,
    isChatLoading,
    onSwitchModality,
    globalChat,
  ]);

  const handlePickAttachment = useCallback(() => {
    uploadInputRef.current?.click();
  }, []);

  const handleAttachmentFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || isUploadingAttachments) return;

      const candidates = Array.from(files);
      const validFiles = candidates.filter(file => resolveAttachmentKind(file.type));
      if (validFiles.length === 0) {
        showFeedback("只支援圖像、影片、音訊與 PDF 檔案");
        return;
      }

      setIsUploadingAttachments(true);
      try {
        const uploaded = await Promise.all(
          validFiles.map(async file => {
            const kind = resolveAttachmentKind(file.type);
            if (!kind) return null;
            const result = await uploadFileToS3(file);
            const id =
              typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            return {
              id,
              name: file.name,
              url: result.url,
              mimeType: file.type,
              kind,
            } satisfies ChatAttachment;
          })
        );
        setChatAttachments(prev => [
          ...prev,
          ...uploaded.filter((item): item is ChatAttachment => item !== null),
        ]);
      } catch (err) {
        showFeedback(`附件上傳失敗：${shortErrorMsg(err)}`);
      } finally {
        setIsUploadingAttachments(false);
        if (uploadInputRef.current) {
          uploadInputRef.current.value = "";
        }
      }
    },
    [isUploadingAttachments, showFeedback]
  );

  const handleRemoveAttachment = useCallback((id: string) => {
    setChatAttachments(prev => prev.filter(item => item.id !== id));
  }, []);

  // ─── Apply inspiration preset ────────────────────────────────────────

  const handleApplyPreset = useCallback(
    (preset: InspirationPreset) => {
      onApplyInspiration?.(preset.blocks);
      if (preset.modality) {
        onSwitchModality?.(preset.modality);
      }
      showFeedback(`已套用「${preset.label}」靈感 ${preset.emoji}`);
      setShowPanel(false);
    },
    [onApplyInspiration, onSwitchModality, showFeedback]
  );

  // ─── Quick-reply suggestion handler ───────────────────────────────────
  const handleSuggestionClick = useCallback(
    (text: string) => {
      setChatInput(text);
      // No need to clear suggestions - globalChat manages them
    },
    [setChatInput]
  );

  // ─── Personality theme maps ───────────────────────────────────────────

  const personalityLabels: Record<string, string> = {
    calm: "沉穩模式",
    creative: "創意模式",
    technical: "技術模式",
  };

  const personalityBubbleColors: Record<string, string> = {
    calm: "border-cyan-200/50 bg-white/90 shadow-cyan-200/20",
    creative: "border-pink-200/50 bg-white/90 shadow-pink-200/20",
    technical: "border-emerald-200/50 bg-white/90 shadow-emerald-200/20",
  };

  const personalityDotColors: Record<string, string> = {
    calm: "rgb(0,210,255)",
    creative: "rgb(255,80,180)",
    technical: "rgb(80,255,180)",
  };

  const personalityGlowColors: Record<string, string> = {
    calm: "rgba(0,210,255,0.8)",
    creative: "rgba(255,80,180,0.8)",
    technical: "rgba(80,255,180,0.8)",
  };

  const personalityAccent: Record<string, string> = {
    calm: "bg-cyan-50 text-cyan-700 border-cyan-200",
    creative: "bg-pink-50 text-pink-700 border-pink-200",
    technical: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };

  const personalityAccentBtn: Record<string, string> = {
    calm: "bg-cyan-500 hover:bg-cyan-400 text-white",
    creative: "bg-pink-500 hover:bg-pink-400 text-white",
    technical: "bg-emerald-500 hover:bg-emerald-400 text-white",
  };

  // Determine which message to show
  const activeMessage = feedbackMessage || guideMessage || proactiveMessage;
  const isFeedback = !!feedbackMessage;
  const isGuideMsg = !!guideMessage;

  // Close panel when clicking/tapping outside
  useEffect(() => {
    if (!showPanel) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLElement;
      if (
        !target.closest("[data-orb-panel]") &&
        !target.closest("[data-orb-trigger]")
      ) {
        setShowPanel(false);
      }
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [showPanel]);

  // Auto-scroll chat
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  return (
    <div className={`fixed inset-0 pointer-events-none z-50 ${className}`}>
      {/* Skip onboarding button */}
      <AnimatePresence>
        {onboardingActive && (
          <motion.button
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onClick={skipOnboarding}
            className="pointer-events-auto fixed top-4 right-4 z-[60] flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white/80 backdrop-blur-md border border-gray-200/50 text-gray-500 hover:text-gray-700 hover:bg-white transition-all shadow-lg"
          >
            <X className="w-3 h-3" />
            跳過引導
          </motion.button>
        )}
      </AnimatePresence>

      <input
        ref={uploadInputRef}
        type="file"
        accept={ORB_UPLOAD_ACCEPT}
        multiple
        className="hidden"
        onChange={e => {
          void handleAttachmentFiles(e.target.files);
        }}
      />

      {/* ══ OrbGuide Panel — mobile: fixed overlay outside drag container ══ */}
      {isMobile && (
        <AnimatePresence>
          {isGuideOpen && (
            <div className="pointer-events-auto">
              <OrbGuidePanel onClose={closeGuidePanel} fullscreen onOpenInteraction={handleOpenInteraction} />
            </div>
          )}
        </AnimatePresence>
      )}

      {/* ══ Mobile interaction panel — fullscreen bottom sheet ══ */}
      {isMobile && (
        <AnimatePresence>
          {showPanel && (
            <>
              <motion.div
                className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[55] pointer-events-auto"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowPanel(false)}
              />
              <motion.div
                data-orb-panel
                initial={{ opacity: 0, y: "100%" }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: "60%" }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="fixed inset-x-0 bottom-0 z-[56] pointer-events-auto rounded-t-3xl overflow-hidden"
                style={{
                  maxHeight: "85vh",
                  background: "rgba(255, 255, 255, 0.96)",
                  backdropFilter: "blur(24px) saturate(180%)",
                  WebkitBackdropFilter: "blur(24px) saturate(180%)",
                  border: "1px solid rgba(255, 255, 255, 0.5)",
                  boxShadow: "0 -8px 40px rgba(0, 0, 0, 0.12), 0 -2px 12px rgba(0, 0, 0, 0.06)",
                  paddingBottom: "env(safe-area-inset-bottom, 0px)",
                }}
                onClick={e => e.stopPropagation()}
              >
                {/* Drag handle */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className="w-10 h-1 rounded-full bg-gray-300" />
                </div>

                {/* Panel Header (mobile) */}
                <div className="px-5 pt-2 pb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <VisualSoul
                        state={aiState}
                        personality={personality}
                        size="sm"
                        className="!w-7 !h-7"
                      />
                      <div
                        className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white"
                        title="AI 代理人模式"
                      />
                    </div>
                    <span className="text-base font-semibold text-gray-800">
                      {panelView === "chat"
                        ? "💬 對話"
                        : panelView === "inspiration"
                          ? "✨ 靈感"
                          : panelView === "focus-flow"
                            ? "🌿 專注"
                            : "🌸 光球"}
                    </span>
                    {pageContext && panelView === "main" && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
                        {pageContext.pageLabel}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setQuietMode(!quietMode)}
                      className={`p-2 rounded-full transition-colors ${quietMode ? "bg-amber-50 text-amber-500" : "hover:bg-gray-100 text-gray-400"}`}
                      title={quietMode ? "開啟提示" : "靜音模式"}
                    >
                      {quietMode ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                    {panelView !== "main" && (
                      <button
                        onClick={() => setPanelView("main")}
                        className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                      >
                        <RotateCcw className="w-4 h-4 text-gray-400" />
                      </button>
                    )}
                    <button
                      onClick={() => setShowPanel(false)}
                      className="p-2 rounded-full hover:bg-gray-100 transition-colors"
                    >
                      <X className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>
                </div>

                {/* Mobile panel views reuse same AnimatePresence content */}
                <div className="overflow-y-auto" style={{ maxHeight: "calc(85vh - 100px)" }}>
                  <AnimatePresence mode="wait">
                    {panelView === "main" && (
                      <motion.div
                        key="main-mobile"
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        className="px-5 pb-5"
                      >
                        <div className="flex items-start gap-2 mb-3">
                          <Bot className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" />
                          <p className="text-sm text-gray-500 leading-relaxed">{greeting}</p>
                        </div>
                        {currentRegistryPage?.orbHints?.length ? (
                          <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2.5">
                            <p className="text-xs text-emerald-700 leading-relaxed">
                              💡 {currentRegistryPage.orbHints[0]}
                            </p>
                          </div>
                        ) : null}
                        {proactiveActions.length ? (
                          <div className="mb-3 rounded-xl border border-emerald-200/70 bg-emerald-50/70 p-2.5">
                            <p className="text-xs font-medium text-emerald-700 mb-1.5">
                              光球主動建議（本頁）
                            </p>
                            <div className="space-y-1.5">
                              {proactiveActions.map(qa => (
                                <button
                                  key={`proactive-${qa.action}`}
                                  onClick={() => handleQuickAction(qa.action)}
                                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/80 hover:bg-white transition-colors text-left border border-emerald-100"
                                >
                                  <div className="p-1.5 rounded-md bg-emerald-100 text-emerald-700">
                                    {qa.icon}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium text-emerald-800 truncate">
                                      {qa.label}
                                    </p>
                                    <p className="text-[11px] text-emerald-600/80 truncate">
                                      {qa.description}
                                    </p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="space-y-1.5 mb-3">
                          {[
                            ...QUICK_ACTIONS,
                            ...(pageContext?.pageId ? (PAGE_QUICK_ACTIONS[pageContext.pageId] ?? []) : []),
                          ].map(qa => (
                            <button
                              key={qa.action}
                              onClick={() => handleQuickAction(qa.action)}
                              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-gray-50 transition-colors text-left group"
                            >
                              <div className={`p-2 rounded-lg ${personalityAccent[personality]} transition-colors`}>
                                {qa.icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-700">{qa.label}</p>
                                <p className="text-xs text-gray-400 truncate">{qa.description}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                        {currentRegistryPage?.quickActions?.length ? (
                          <div className="space-y-1.5 mb-3">
                            <p className="text-xs text-gray-400 px-1">這頁可直接開始：</p>
                            {currentRegistryPage.quickActions.map(action => (
                              <button
                                key={action.id}
                                onClick={() => void handleRegistryQuickAction({ path: action.path, action: action.action, prompt: action.prompt, label: action.label })}
                                className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200/70 bg-white/70 hover:bg-gray-50 transition-colors text-left"
                              >
                                <Navigation className="w-4 h-4 text-emerald-500 shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-gray-700 truncate">{action.label}</p>
                                  <p className="text-xs text-gray-400 truncate">{action.description}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        <button
                          onClick={() => void handleQuickAction("page-deep-dive")}
                          className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-gradient-to-r from-amber-50 to-pink-50 border border-amber-200/40 hover:from-amber-100 hover:to-pink-100 transition-all text-sm font-medium text-amber-700"
                        >
                          <Lightbulb className="w-4 h-4" />🧭 頁面細節引導
                        </button>
                        <button
                          onClick={() => setPanelView("focus-flow")}
                          className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-gradient-to-r from-green-50 to-indigo-50 border border-green-200/40 hover:from-green-100 hover:to-indigo-100 transition-all text-sm font-medium text-green-700 mt-2"
                        >
                          <Leaf className="w-4 h-4" />🌿 療癒專注流
                        </button>
                      </motion.div>
                    )}
                    {panelView === "chat" && (
                      <motion.div
                        key="chat-mobile"
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        className="flex flex-col"
                      >
                        <div className="px-5 py-2 max-h-[60vh] overflow-y-auto space-y-2.5">
                          {chatMessages.map((msg, i) => (
                            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                              <div className="flex flex-col gap-0.5 max-w-[85%]">
                                <div className={`px-3.5 py-2.5 text-sm leading-relaxed ${
                                  msg.role === "user"
                                    ? `${personalityAccentBtn[personality]} rounded-2xl rounded-br-md`
                                    : "bg-gradient-to-br from-gray-50 to-gray-100/80 text-gray-700 rounded-2xl rounded-bl-md border border-gray-100/60"
                                }`}>
                                  {msg.text && <div>{msg.text}</div>}
                                  {msg.attachments?.length ? (
                                    <div className={`flex flex-col gap-1 ${msg.text ? "mt-2" : ""}`}>
                                      {msg.attachments.map(attachment => (
                                        <a
                                          key={attachment.id}
                                          href={attachment.url}
                                          target="_blank"
                                          rel="noreferrer"
                                          className={`inline-flex items-center gap-1 text-xs underline ${msg.role === "user" ? "text-white/90" : "text-emerald-700"}`}
                                        >
                                          {attachment.kind === "image" ? "🖼️" : attachment.kind === "video" ? "🎬" : attachment.kind === "audio" ? "🎵" : "📄"}
                                          <span className="truncate max-w-[220px]">{attachment.name}</span>
                                        </a>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                                {msg.pagePath && msg.at && (
                                  <div className={`text-[10px] text-muted-foreground px-1 flex items-center gap-1 ${
                                    msg.role === "user" ? "justify-end" : "justify-start"
                                  }`}>
                                    <span>{getPageEmoji(msg.pagePath)}</span>
                                    <span>{formatMessageMetadata(msg.pagePath, msg.at)}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                          {isChatLoading && (
                            <div className="flex justify-start">
                              <div className="bg-gradient-to-br from-gray-50 to-gray-100/80 rounded-2xl rounded-bl-md px-4 py-3 border border-gray-100/60">
                                <div className="flex items-center gap-1">
                                  <motion.div className="w-1.5 h-1.5 rounded-full bg-gray-400" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0 }} />
                                  <motion.div className="w-1.5 h-1.5 rounded-full bg-gray-400" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }} />
                                  <motion.div className="w-1.5 h-1.5 rounded-full bg-gray-400" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }} />
                                </div>
                              </div>
                            </div>
                          )}
                          <div ref={chatEndRef} />
                        </div>
                        {/* Quick-reply suggestions */}
                        {chatSuggestions.length > 0 && !isChatLoading && (
                          <div className="px-4 py-1.5 flex flex-wrap gap-1.5">
                            {chatSuggestions.map(s => (
                              <button
                                key={s}
                                onClick={() => handleSuggestionClick(s)}
                                className="text-xs px-2.5 py-1 rounded-full bg-white/80 text-gray-600 border border-gray-200/60 hover:bg-emerald-50 hover:border-emerald-200 transition"
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="px-4 py-3 border-t border-gray-100/60">
                          {chatAttachments.length > 0 && (
                            <div className="mb-2 flex flex-wrap gap-1.5">
                              {chatAttachments.map(attachment => (
                                <button
                                  key={attachment.id}
                                  onClick={() => handleRemoveAttachment(attachment.id)}
                                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100"
                                  title="移除附件"
                                >
                                  <span>{attachment.kind === "image" ? "🖼️" : attachment.kind === "video" ? "🎬" : attachment.kind === "audio" ? "🎵" : "📄"}</span>
                                  <span className="max-w-[120px] truncate">{attachment.name}</span>
                                  <X className="w-3 h-3" />
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center gap-2 rounded-xl border border-gray-200/60 bg-gray-50/50 px-4 py-3 focus-within:border-gray-300 transition-colors">
                            <button
                              onClick={handlePickAttachment}
                              disabled={isUploadingAttachments || isChatLoading}
                              className="p-2 rounded-lg hover:bg-gray-200/60 transition-colors disabled:opacity-30"
                              title="上傳圖像、影片、音訊或 PDF"
                            >
                              {isUploadingAttachments ? (
                                <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
                              ) : (
                                <Paperclip className="w-4 h-4 text-gray-500" />
                              )}
                            </button>
                            <input
                              type="text"
                              value={chatInput}
                              onChange={e => setChatInput(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
                              placeholder="分享你的想法，或問我任何事⋯⋯"
                              className="bg-transparent text-sm text-gray-700 placeholder:text-gray-400 outline-none flex-1 min-w-0"
                              autoFocus
                            />
                            <button onClick={handleChatSend} disabled={(!chatInput.trim() && chatAttachments.length === 0) || isChatLoading || isUploadingAttachments} className="p-2 rounded-lg hover:bg-gray-200/60 transition-colors disabled:opacity-30">
                              {isChatLoading ? <Loader2 className="w-4 h-4 text-gray-500 animate-spin" /> : <Send className="w-4 h-4 text-gray-500" />}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                    {panelView === "inspiration" && (
                      <motion.div key="inspiration-mobile" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="px-5 pb-5">
                        <p className="text-sm text-gray-500 mb-3">選一個喜歡的主題，積木會自動填入。</p>
                        <div className="grid grid-cols-2 gap-2.5">
                          {INSPIRATION_PRESETS.map(preset => (
                            <button key={preset.label} onClick={() => handleApplyPreset(preset)} className="flex flex-col items-start gap-1 px-3 py-3 rounded-xl border border-gray-100 hover:border-amber-200 hover:bg-amber-50/50 transition-all text-left group">
                              <span className="text-xl">{preset.emoji}</span>
                              <span className="text-sm font-medium text-gray-700 group-hover:text-amber-700">{preset.label}</span>
                              <span className="text-xs text-gray-400">{preset.mood}</span>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                    {panelView === "focus-flow" && (
                      <motion.div key="focus-flow-mobile" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
                        <FocusFlowMini />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      )}

      {/* Draggable orb container */}
      <motion.div
        drag={!isMobile && !guiding && !showPanel}
        dragElastic={0.1}
        dragMomentum={false}
        dragConstraints={{
          left: -(window.innerWidth * 0.9),
          right: 0,
          top: -(window.innerHeight * 0.9),
          bottom: 0,
        }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        whileDrag={isMobile ? undefined : {
          scale: 1.15,
          boxShadow: `0 0 40px ${personalityGlowColors[personality]}`,
        }}
        initial={!isMobile && hasDragged ? position : { x: 0, y: 0 }}
        animate={guiding ? undefined : (isMobile ? { x: 0, y: 0 } : position)}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className={cn(
          "pointer-events-auto flex flex-col items-end gap-3",
          isMobile
            ? "absolute bottom-4 right-4"
            : "absolute bottom-6 right-6"
        )}
        style={{ cursor: isMobile ? "pointer" : (guiding ? "default" : "grab"), touchAction: "none" }}
        id="proactive-orb-anchor"
      >
        {/* ══ OrbGuide Panel — desktop only (mobile renders outside drag container) ══ */}
        {!isMobile && (
        <AnimatePresence>
          {isGuideOpen && (
            <div data-orb-panel>
              <OrbGuidePanel onClose={closeGuidePanel} onOpenInteraction={handleOpenInteraction} />
            </div>
          )}
        </AnimatePresence>
        )}

        {/* Interaction Panel — desktop only (mobile renders as bottom sheet above) */}
        {!isMobile && (
        <AnimatePresence>
          {showPanel && (
            <motion.div
              data-orb-panel
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="w-72 sm:w-80 rounded-2xl overflow-hidden"
              style={{
                background: "rgba(255, 255, 255, 0.92)",
                backdropFilter: "blur(24px) saturate(180%)",
                WebkitBackdropFilter: "blur(24px) saturate(180%)",
                border: "1px solid rgba(255, 255, 255, 0.5)",
                boxShadow:
                  "0 8px 40px rgba(0, 0, 0, 0.08), 0 2px 12px rgba(0, 0, 0, 0.04)",
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Panel Header */}
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <VisualSoul
                      state={aiState}
                      personality={personality}
                      size="sm"
                      className="!w-6 !h-6"
                    />
                    {/* Agent badge */}
                    <div
                      className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-white"
                      title="AI 代理人模式"
                    />
                  </div>
                  <span className="text-sm font-semibold text-gray-800">
                    {panelView === "chat"
                      ? "💬 對話"
                      : panelView === "inspiration"
                        ? "✨ 靈感"
                        : panelView === "focus-flow"
                          ? "🌿 專注"
                          : "🌸 光球"}
                  </span>
                  {pageContext && panelView === "main" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
                      {pageContext.pageLabel}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-0.5">
                  {/* Quiet mode toggle */}
                  <button
                    onClick={() => setQuietMode(!quietMode)}
                    className={`p-1.5 rounded-full transition-colors ${quietMode ? "bg-amber-50 text-amber-500" : "hover:bg-gray-100 text-gray-400"}`}
                    title={
                      quietMode
                        ? "開啟提示（目前靜音中）"
                        : "靜音模式（不再主動提示）"
                    }
                  >
                    {quietMode ? (
                      <VolumeX className="w-3.5 h-3.5" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                  {panelView !== "main" && (
                    <button
                      onClick={() => setPanelView("main")}
                      className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  )}
                  <button
                    onClick={() => setShowPanel(false)}
                    className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"
                  >
                    <X className="w-3.5 h-3.5 text-gray-400" />
                  </button>
                </div>
              </div>

              <AnimatePresence mode="wait">
                {/* ─── Main View ─── */}
                {panelView === "main" && (
                  <motion.div
                    key="main"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="px-4 pb-4"
                  >
                    {/* Greeting with agent badge */}
                    <div className="flex items-start gap-2 mb-3">
                      <Bot className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-500" />
                      <p className="text-xs text-gray-500 leading-relaxed">
                        {greeting}
                      </p>
                    </div>
                    {currentRegistryPage?.orbHints?.length ? (
                      <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2">
                        <p className="text-[11px] text-emerald-700 leading-relaxed">
                          💡 {currentRegistryPage.orbHints[0]}
                        </p>
                      </div>
                    ) : null}

                    {/* Quick Actions — redesigned as compact cards */}
                    {proactiveActions.length ? (
                      <div className="mb-3 rounded-xl border border-emerald-200/70 bg-emerald-50/70 p-2.5">
                        <p className="text-xs font-medium text-emerald-700 mb-1.5">
                          光球主動建議（本頁）
                        </p>
                        <div className="space-y-1.5">
                          {proactiveActions.map(qa => (
                            <button
                              key={`proactive-desktop-${qa.action}`}
                              onClick={() => handleQuickAction(qa.action)}
                              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white/80 hover:bg-white transition-colors text-left border border-emerald-100"
                            >
                              <div className="p-1.5 rounded-md bg-emerald-100 text-emerald-700">
                                {qa.icon}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-emerald-800 truncate">
                                  {qa.label}
                                </p>
                                <p className="text-[11px] text-emerald-600/80 truncate">
                                  {qa.description}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="space-y-1.5 mb-3">
                      {[
                        ...QUICK_ACTIONS,
                        ...(pageContext?.pageId
                          ? (PAGE_QUICK_ACTIONS[pageContext.pageId] ?? [])
                          : []),
                      ].map(qa => (
                        <button
                          key={qa.action}
                          onClick={() => handleQuickAction(qa.action)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors text-left group"
                        >
                          <div
                            className={`p-1.5 rounded-lg ${personalityAccent[personality]} transition-colors`}
                          >
                            {qa.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-700">
                              {qa.label}
                            </p>
                            <p className="text-xs text-gray-400 truncate">
                              {qa.description}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>

                    {currentRegistryPage?.quickActions?.length ? (
                      <div className="space-y-1.5 mb-3">
                        <p className="text-[11px] text-gray-400 px-1">
                          這頁可直接開始：
                        </p>
                        {currentRegistryPage.quickActions.map(action => (
                          <button
                            key={action.id}
                            onClick={() =>
                              void handleRegistryQuickAction({
                                path: action.path,
                                action: action.action,
                                prompt: action.prompt,
                                label: action.label,
                              })
                            }
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200/70 bg-white/70 hover:bg-gray-50 transition-colors text-left"
                          >
                            <Navigation className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-700 truncate">
                                {action.label}
                              </p>
                              <p className="text-[11px] text-gray-400 truncate">
                                {action.description}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {/* Inspiration Button */}
                    <button
                      onClick={() => void handleQuickAction("page-deep-dive")}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-amber-50 to-pink-50 border border-amber-200/40 hover:from-amber-100 hover:to-pink-100 transition-all text-sm font-medium text-amber-700"
                    >
                      <Lightbulb className="w-4 h-4" />🧭 頁面細節引導
                    </button>

                    {/* Focus Flow Button */}
                    <button
                      onClick={() => setPanelView("focus-flow")}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-green-50 to-indigo-50 border border-green-200/40 hover:from-green-100 hover:to-indigo-100 transition-all text-sm font-medium text-green-700 mt-2"
                    >
                      <Leaf className="w-4 h-4" />
                      🌿 療癒專注流
                    </button>
                  </motion.div>
                )}

                {/* ─── Chat View ─── */}
                {panelView === "chat" && (
                  <motion.div
                    key="chat"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="flex flex-col"
                  >
                    {/* Chat Messages */}
                    <div className="px-4 py-2 max-h-56 overflow-y-auto space-y-2.5">
                      {chatMessages.map((msg, i) => (
                        <div
                          key={i}
                          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                          <div className="flex flex-col gap-0.5 max-w-[85%]">
                            <div
                              className={`px-3.5 py-2.5 text-xs leading-relaxed ${
                                msg.role === "user"
                                  ? `${personalityAccentBtn[personality]} rounded-2xl rounded-br-md`
                                  : "bg-gradient-to-br from-gray-50 to-gray-100/80 text-gray-700 rounded-2xl rounded-bl-md border border-gray-100/60"
                              }`}
                            >
                              {msg.text && <div>{msg.text}</div>}
                              {msg.attachments?.length ? (
                                <div className={`flex flex-col gap-1 ${msg.text ? "mt-2" : ""}`}>
                                  {msg.attachments.map(attachment => (
                                    <a
                                      key={attachment.id}
                                      href={attachment.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={`inline-flex items-center gap-1 text-[11px] underline ${msg.role === "user" ? "text-white/90" : "text-emerald-700"}`}
                                    >
                                      {attachment.kind === "image" ? "🖼️" : attachment.kind === "video" ? "🎬" : attachment.kind === "audio" ? "🎵" : "📄"}
                                      <span className="truncate max-w-[180px]">{attachment.name}</span>
                                    </a>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            {msg.pagePath && msg.at && (
                              <div className={`text-[9px] text-muted-foreground px-1 flex items-center gap-0.5 ${
                                msg.role === "user" ? "justify-end" : "justify-start"
                              }`}>
                                <span>{getPageEmoji(msg.pagePath)}</span>
                                <span>{formatMessageMetadata(msg.pagePath, msg.at)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      {/* Typing indicator */}
                      {isChatLoading && (
                        <div className="flex justify-start">
                          <div className="bg-gradient-to-br from-gray-50 to-gray-100/80 rounded-2xl rounded-bl-md px-4 py-3 border border-gray-100/60">
                            <div className="flex items-center gap-1">
                              <motion.div
                                className="w-1.5 h-1.5 rounded-full bg-gray-400"
                                animate={{ opacity: [0.3, 1, 0.3] }}
                                transition={{
                                  duration: 1.2,
                                  repeat: Infinity,
                                  delay: 0,
                                }}
                              />
                              <motion.div
                                className="w-1.5 h-1.5 rounded-full bg-gray-400"
                                animate={{ opacity: [0.3, 1, 0.3] }}
                                transition={{
                                  duration: 1.2,
                                  repeat: Infinity,
                                  delay: 0.2,
                                }}
                              />
                              <motion.div
                                className="w-1.5 h-1.5 rounded-full bg-gray-400"
                                animate={{ opacity: [0.3, 1, 0.3] }}
                                transition={{
                                  duration: 1.2,
                                  repeat: Infinity,
                                  delay: 0.4,
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>

                    {/* Quick-reply suggestions (desktop) */}
                    {chatSuggestions.length > 0 && !isChatLoading && (
                      <div className="px-3 py-1 flex flex-wrap gap-1">
                        {chatSuggestions.map(s => (
                          <button
                            key={s}
                            onClick={() => handleSuggestionClick(s)}
                            className="text-[11px] px-2 py-0.5 rounded-full bg-white/80 text-gray-600 border border-gray-200/60 hover:bg-emerald-50 hover:border-emerald-200 transition"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Chat Input */}
                    <div className="px-3 py-3 border-t border-gray-100/60">
                      {chatAttachments.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {chatAttachments.map(attachment => (
                            <button
                              key={attachment.id}
                              onClick={() => handleRemoveAttachment(attachment.id)}
                              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100"
                              title="移除附件"
                            >
                              <span>{attachment.kind === "image" ? "🖼️" : attachment.kind === "video" ? "🎬" : attachment.kind === "audio" ? "🎵" : "📄"}</span>
                              <span className="max-w-[110px] truncate">{attachment.name}</span>
                              <X className="w-3 h-3" />
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2 rounded-xl border border-gray-200/60 bg-gray-50/50 px-3 py-2 focus-within:border-gray-300 transition-colors">
                        <button
                          onClick={handlePickAttachment}
                          disabled={isUploadingAttachments || isChatLoading}
                          className="p-1.5 rounded-lg hover:bg-gray-200/60 transition-colors disabled:opacity-30"
                          title="上傳圖像、影片、音訊或 PDF"
                        >
                          {isUploadingAttachments ? (
                            <Loader2 className="w-3.5 h-3.5 text-gray-500 animate-spin" />
                          ) : (
                            <Paperclip className="w-3.5 h-3.5 text-gray-500" />
                          )}
                        </button>
                        <input
                          type="text"
                          value={chatInput}
                          onChange={e => setChatInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleChatSend();
                            }
                          }}
                          placeholder="分享你的想法，或問我任何事⋯⋯"
                          className="bg-transparent text-sm text-gray-700 placeholder:text-gray-400 outline-none flex-1 min-w-0"
                          autoFocus
                        />
                        <button
                          onClick={handleChatSend}
                          disabled={(!chatInput.trim() && chatAttachments.length === 0) || isChatLoading || isUploadingAttachments}
                          className="p-1.5 rounded-lg hover:bg-gray-200/60 transition-colors disabled:opacity-30"
                        >
                          {isChatLoading ? (
                            <Loader2 className="w-3.5 h-3.5 text-gray-500 animate-spin" />
                          ) : (
                            <Send className="w-3.5 h-3.5 text-gray-500" />
                          )}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}

                {/* ─── Inspiration View ─── */}
                {panelView === "inspiration" && (
                  <motion.div
                    key="inspiration"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="px-4 pb-4"
                  >
                    <p className="text-xs text-gray-500 mb-3">
                      選一個喜歡的主題，積木會自動填入。
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {INSPIRATION_PRESETS.map(preset => (
                        <button
                          key={preset.label}
                          onClick={() => handleApplyPreset(preset)}
                          className="flex flex-col items-start gap-1 px-3 py-2.5 rounded-xl border border-gray-100 hover:border-amber-200 hover:bg-amber-50/50 transition-all text-left group"
                        >
                          <span className="text-lg">{preset.emoji}</span>
                          <span className="text-xs font-medium text-gray-700 group-hover:text-amber-700">
                            {preset.label}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {preset.mood}
                          </span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* ─── Focus Flow View ─── */}
                {panelView === "focus-flow" && (
                  <motion.div
                    key="focus-flow"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                  >
                    <FocusFlowMini />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
        )}

        {/* Message bubble (feedback / guide / proactive) */}
        <AnimatePresence mode="wait">
          {activeMessage && !showPanel && (
            <motion.div
              key={activeMessage}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className={`max-w-xs rounded-2xl border p-4 shadow-lg backdrop-blur-md ${personalityBubbleColors[personality]}`}
            >
              <div className="flex items-start gap-2">
                <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                <div className="flex-1">
                  <p className="text-xs font-medium text-gray-500 mb-1">
                    {isFeedback
                      ? "完成"
                      : isGuideMsg
                        ? "引導中"
                        : personalityLabels[personality]}
                  </p>
                  <p className="text-sm text-gray-800 leading-relaxed font-medium">
                    {activeMessage}
                  </p>
                  {isGuideMsg && onboardingActive && (
                    <div className="mt-2 flex gap-1">
                      {ONBOARDING_STEPS.map((_, i) => (
                        <div
                          key={i}
                          className={`w-1.5 h-1.5 rounded-full transition-colors ${
                            guideMessage === ONBOARDING_STEPS[i]?.message
                              ? "bg-amber-500"
                              : "bg-gray-300"
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
                {!isGuideMsg && !isFeedback && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      dismissProactive();
                    }}
                    className="shrink-0 p-0.5 rounded-full hover:bg-gray-200/50 transition-colors"
                  >
                    <X className="w-3.5 h-3.5 text-gray-400" />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating orb with neon glow + drop zone */}
        <motion.div
          data-orb-trigger
          animate={orbControls}
          whileHover={guiding ? undefined : { scale: 1.1 }}
          whileTap={guiding ? undefined : { scale: 0.95 }}
          className="relative cursor-pointer"
          title={guiding ? "引導中..." : "🌸 點我開始對話"}
          onClick={e => {
            e.stopPropagation();
            if (!guiding) handleOrbClick();
          }}
          // HTML5 drop zone
          onDragOver={handleNativeDragOver as any}
          onDragLeave={handleNativeDragLeave as any}
          onDrop={handleNativeDrop as any}
        >
          {/* Drop zone highlight ring */}
          <AnimatePresence>
            {isDropTarget && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1.4 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="absolute inset-0 rounded-full border-2 border-dashed border-amber-400/60"
                style={{
                  boxShadow: `0 0 30px ${personalityGlowColors[personality]}`,
                  margin: "-8px",
                }}
              />
            )}
          </AnimatePresence>

          {/* Drop flash effect */}
          <AnimatePresence>
            {dropFlash && (
              <motion.div
                initial={{ opacity: 0.8, scale: 1 }}
                animate={{ opacity: 0, scale: 2.5 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8 }}
                className="absolute inset-0 rounded-full"
                style={{
                  background: `radial-gradient(circle, rgba(255,180,120,0.6) 0%, transparent 70%)`,
                  margin: "-12px",
                }}
              />
            )}
          </AnimatePresence>

          {/* Neon glow ring — softer, healing-like breathing */}
          <motion.div
            className="absolute inset-0 rounded-full"
            animate={{
              boxShadow: guiding
                ? [
                    `0 0 16px ${personalityGlowColors[personality]}, 0 0 40px ${personalityGlowColors[personality].replace("0.8", "0.35")}`,
                    `0 0 24px ${personalityGlowColors[personality]}, 0 0 56px ${personalityGlowColors[personality].replace("0.8", "0.5")}`,
                    `0 0 16px ${personalityGlowColors[personality]}, 0 0 40px ${personalityGlowColors[personality].replace("0.8", "0.35")}`,
                  ]
                : showPanel
                  ? [
                      `0 0 18px ${personalityGlowColors[personality]}, 0 0 36px ${personalityGlowColors[personality].replace("0.8", "0.35")}`,
                    ]
                  : [
                      `0 0 8px ${personalityGlowColors[personality].replace("0.8", "0.2")}, 0 0 16px ${personalityGlowColors[personality].replace("0.8", "0.1")}`,
                      `0 0 14px ${personalityGlowColors[personality].replace("0.8", "0.35")}, 0 0 28px ${personalityGlowColors[personality].replace("0.8", "0.15")}`,
                      `0 0 8px ${personalityGlowColors[personality].replace("0.8", "0.2")}, 0 0 16px ${personalityGlowColors[personality].replace("0.8", "0.1")}`,
                    ],
            }}
            transition={{
              duration: guiding ? 1 : 3.5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            style={{ margin: "-4px", borderRadius: "50%" }}
          />

          {/* Phase 11: 升級為 3D 光球 — 整合 OrbGuide 引導狀態 */}
          <VisualSoul
            state={
              guiding
                ? "thinking"
                : isGuideOpen
                  ? "listening"
                  : showPanel
                    ? "listening"
                    : aiState
            }
            personality={personality}
            size="lg"
            className="!w-12 !h-12"
          />

          {/* 引導模式的蒯腳文字浮標 */}
          <AnimatePresence>
            {!isGuideOpen && !showPanel && !guiding && !isAnyTimerRunning && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.9 }}
                transition={{ delay: 2, duration: 0.4 }}
                className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap"
              >
                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10">
                  <Sparkles className="w-2.5 h-2.5 text-white/70" />
                  <span className="text-[10px] text-white/80 font-medium">點我開始</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Personality indicator dot */}
          <motion.div
            className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white"
            animate={{
              boxShadow: [
                `0 0 4px ${personalityDotColors[personality]}`,
                `0 0 8px ${personalityDotColors[personality]}`,
                `0 0 4px ${personalityDotColors[personality]}`,
              ],
            }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            style={{ backgroundColor: personalityDotColors[personality] }}
          />

          {/* Active timer indicator (shown when a focus-flow timer is running) */}
          <AnimatePresence>
            {isAnyTimerRunning && !showPanel && (
              <motion.div
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                className="absolute -top-3 -left-3 flex items-center gap-1 bg-white/95 backdrop-blur-sm rounded-full px-1.5 py-0.5 shadow-md border border-gray-200/60"
              >
                <motion.div
                  className="w-1.5 h-1.5 rounded-full"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1, repeat: Infinity }}
                  style={{
                    backgroundColor:
                      activeMode === "pomodoro"
                        ? pomodoroPhase === "work"
                          ? "#ef4444"
                          : "#22c55e"
                        : "#ec4899",
                  }}
                />
                <span className="text-[9px] font-bold tabular-nums text-gray-600">
                  {formatTimerBadge(
                    activeMode === "pomodoro"
                      ? pomodoroRemaining
                      : healingRemaining
                  )}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </div>
  );
});
