import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  memo,
  type CSSProperties,
} from "react";
import {
  motion,
  AnimatePresence,
  type PanInfo,
  useAnimation,
  useReducedMotion,
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
  Brain,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useFocusFlow } from "@/contexts/FocusFlowContext";
import FocusFlowMini from "./FocusFlowMini";
import { useOrbGuide, type GuideIntent } from "@/contexts/OrbGuideContext";
import OrbGuidePanel from "./OrbGuidePanel";
import { usePageAgent } from "@/contexts/PageAgentContext";
import { parseLLMActions, type AgentAction } from "../../../shared/agent-actions";
import { findSkillForPage } from "../../../shared/agent-skills";
import { useLocation } from "wouter";
import { getPageByPath } from "@/config/appRegistry";
import { useIsMobile } from "@/hooks/useMobile";
import { cn } from "@/lib/utils";
import { getSpiritVisual } from "@/lib/spiritsVisual";
import {
  useGlobalOrbChat,
  type ChatAttachment,
  getPageEmoji,
  formatMessageMetadata,
  inferSuggestionEmoji,
} from "@/contexts/GlobalOrbChatContext";
import { shortErrorMsg, uploadFileToS3 } from "@/lib/upload";
import {
  ORB_UNSUPPORTED_ATTACHMENT_MESSAGE,
  ORB_UPLOAD_ACCEPT,
  resolveOrbAttachmentKind,
} from "../../../shared/orb-chat-multimodal";
import {
  AttachmentTextExtractionError,
  extractAttachmentText,
} from "@/lib/extractAttachmentText";
import { usePersonalSettings } from "@/contexts/PersonalSettingsContext";
import ChatMessageText from "./ChatMessageText";
import type { IntentOption } from "@/lib/intentOptions";
import OrbCapabilitiesView from "./orb/OrbCapabilitiesView";
import OrbSearchResultsCard from "./orb/OrbSearchResultsCard";
import OrbMemoryDashboard from "./orb/OrbMemoryDashboard";
import OrbActionFlow from "./orb/OrbActionFlow";
import { OrbThinkingTimeline } from "./orb/OrbThinkingTimeline";
import { OrbVoiceButton } from "./orb/OrbVoiceButton";
import OrbThinkingStepsPanel from "./orb/OrbThinkingStepsPanel";
import { useOrbState, ORB_STATE_VISUAL } from "@/contexts/OrbStateContext";
import type { CreativeCapability } from "@/data/creativeCapabilities";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";

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

/**
 * Clamp a drag offset relative to the configured corner anchor. Each anchor
 * allows movement only "into" the screen — bottom-right pulls up-left
 * (negative offsets), bottom-left allows positive x, top-right allows positive y,
 * top-left allows both positive offsets.
 */
function clampDragOffset(
  x: number,
  y: number,
  corner: string
): { x: number; y: number } {
  const w = typeof window !== "undefined" ? window.innerWidth : 0;
  const h = typeof window !== "undefined" ? window.innerHeight : 0;
  const padding = 80; // keep at least 80px of widget visible

  switch (corner) {
    case "bottom-left":
      return {
        x: Math.max(0, Math.min(w - padding, x)),
        y: Math.max(-(h - padding), Math.min(0, y)),
      };
    case "top-right":
      return {
        x: Math.max(-(w - padding), Math.min(0, x)),
        y: Math.max(0, Math.min(h - padding, y)),
      };
    case "top-left":
      return {
        x: Math.max(0, Math.min(w - padding, x)),
        y: Math.max(0, Math.min(h - padding, y)),
      };
    case "bottom-right":
    default:
      return {
        x: Math.max(-(w - padding), Math.min(0, x)),
        y: Math.max(-(h - padding), Math.min(0, y)),
      };
  }
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
  home: [
    "🌅 嗨～想做點什麼呢？我帶你去最適合的工作室。",
    "✨ 圖、影、音、聲，告訴我心情，我幫你選方向。",
    "🌿 不確定先做哪個？我可以從靈感開始陪你聊。",
  ],
  "my-brain": [
    "🧠 這裡是你的大腦工作面板，整合任務、模型與筆記。",
    "✨ 想看推理鏈或調整模型偏好嗎？我可以帶你去。",
    "💡 把你想完成的事告訴我，我幫你規劃下一步。",
  ],
  "tutorial-overview": [
    "📚 想學什麼呢？我幫你挑一條最順的學習路徑。",
    "✨ 從新手起手到進階參數，這裡都有對應的教學。",
    "🌱 學習也是一種療癒，慢慢來，每一步都算數。",
  ],
  "focus-flow": [
    "🌸 想休息一下嗎？療癒、番茄、聚焦三種節奏任你切換。",
    "⏳ 設定一段專注時間，我會在旁邊陪著你。",
    "✨ 累的時候先療癒，靈感清晰後再進工作室也來得及。",
  ],
  "agent-chat": [
    "💬 在這裡可以和我自由聊聊，我是你的全站助手。",
    "✨ 想去哪一頁、想找哪個模型，告訴我都行。",
    "🌿 想梳理思緒？聊天也能幫你慢慢釐清下一步。",
  ],
  admin: [
    "🛡️ 管理後台，這裡的每一步都建議謹慎操作。",
    "📊 想看用量、用戶或大腦組態？我可以帶你切到對應分頁。",
    "✨ 有狀況我會即時提醒你。",
  ],
  "admin-brain-pipeline": [
    "🧪 大腦推理鏈視覺化，逐步追蹤每一段思考。",
    "✨ 想看哪一條鏈路？告訴我目標，我幫你判讀。",
  ],
  "admin-api-usage": [
    "📈 API 用量分析中心，可以看趨勢、分佈與異常。",
    "✨ 需要幫忙抓出花最多 token 的地方嗎？我可以協助。",
  ],
  feedback: [
    "🌿 你的回饋很重要，慢慢說，我都會聽。",
    "✨ 不確定怎麼描述問題？我可以幫你整理成清楚的句子。",
    "💌 想到什麼就寫什麼，事後我會幫你補強。",
  ],
  notes: [
    "📒 這裡是你的創作筆記，把零散的靈感都收進來吧。",
    "✨ 想把剛剛的對話存進筆記嗎？告訴我一聲就行。",
    "🌿 整理筆記也是一種療癒，慢慢來不急。",
  ],
  calendar: [
    "📅 創作日曆，幫你把素材、生成、訓練、交付排成節奏。",
    "✨ 想規劃一週還是先排明天？我都可以陪你拆解。",
    "🌿 給自己留點呼吸的空檔，靈感才有空間生長。",
  ],
  assets: [
    "🗂️ 這裡是你的數位資產庫，慢慢挑一個喜歡的當靈感起點。",
    "✨ 想找特定風格、模型或時間段的素材嗎？我來幫你過濾。",
    "🌿 一個好素材，可以延伸出整個系列。",
  ],
  vault: [
    "🛡️ 一致性保險庫，幫你的角色、場景、風格留下穩定錨點。",
    "✨ 跨模型還想保持一致？我們先把錨點建好。",
    "🌿 一致性是長作品的根，慢慢養就好。",
  ],
  "prompt-library": [
    "📚 提示詞庫，這裡有許多可直接套用的模板。",
    "✨ 告訴我你想做的任務，我幫你挑一個最近的模板。",
    "🌿 模板只是起點，最終要長成你自己的語氣。",
  ],
  "background-tasks": [
    "⏳ 背景任務中心，你的所有生成都在這裡集合。",
    "✨ 想看哪個任務、要不要重試？我可以幫你判讀優先序。",
    "🌿 等待也是創作的一部分，先去休息一下也行。",
  ],
  settings: [
    "⚙️ 個人設定中心，把站台調整成最適合你的樣子。",
    "✨ 想調主題、聲音、引導節奏？我帶你逐項看。",
  ],
  credits: [
    "💎 積分中心，幫你掌握每一次生成的成本。",
    "✨ 想知道怎麼省、怎麼花得有效率嗎？我來分析。",
    "🌿 創作不是比誰花最多，是比誰最懂節奏。",
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
    icon: <BookOpen className="w-4 h-4" />,
    label: "教學引導",
    description: "用教學節奏帶你一步步完成操作（可搭配光球帶操）",
    action: "tutorial-guide",
  },
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
    {
      icon: <BookOpen className="w-4 h-4" />,
      label: "工作室全細節",
      description: "完整拆解創作工作室全部區塊、參數、生成邏輯與實作 SOP",
      action: "studio-all-details",
    },
    {
      icon: <Zap className="w-4 h-4" />,
      label: "一鍵帶操",
      description: "光球先幫你套一版可執行起手式，再逐步微調",
      action: "studio-autopilot",
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
      icon: <Layers className="w-4 h-4" />,
      label: "分鏡規劃",
      description: "從劇本/概念開始拆解出可執行的分鏡與節奏",
      action: "chat-director-storyboard",
    },
    {
      icon: <Sparkles className="w-4 h-4" />,
      label: "腳本優化",
      description: "幫你把粗稿改寫成可生成的鏡頭描述",
      action: "chat-director-script-polish",
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
    {
      icon: <Layers className="w-4 h-4" />,
      label: "資料集整理",
      description: "分類、去雜訊與打標籤，提升訓練品質",
      action: "chat-lora-dataset-prep",
    },
    {
      icon: <RefreshCw className="w-4 h-4" />,
      label: "訓練監控",
      description: "解讀步數、loss 與成果取捨，決定是否續練",
      action: "chat-lora-training-monitor",
    },
    {
      icon: <Coins className="w-4 h-4" />,
      label: "訓練成本預估",
      description: "依步數與資料集規模估算積分與時間",
      action: "chat-credits-estimate",
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
    {
      icon: <Sparkles className="w-4 h-4" />,
      label: "我該用哪個模型",
      description: "依風格與成本給你 1-2 個首選版本",
      action: "chat-model-recommend",
    },
    {
      icon: <Shield className="w-4 h-4" />,
      label: "風險與權重檢查",
      description: "釐清版本授權、敏感主題與穩定度差異",
      action: "chat-models-risk-check",
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
    {
      icon: <Sparkles className="w-4 h-4" />,
      label: "把對話存進筆記",
      description: "把剛剛聊天的重點整理成可重用的筆記稿",
      action: "chat-notes-from-chat",
    },
    {
      icon: <Layers className="w-4 h-4" />,
      label: "待辦排序",
      description: "把目前所有筆記重新排出今日 / 本週優先序",
      action: "chat-notes-prioritize",
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
  home: [
    {
      icon: <Sparkles className="w-4 h-4" />,
      label: "今天想做什麼",
      description: "依心情/目標幫你挑出最適合的工作室入口",
      action: "chat-home-orient",
    },
    {
      icon: <Navigation2 className="w-4 h-4" />,
      label: "全站導覽",
      description: "用一段話帶你看完所有主要頁面與用途",
      action: "chat-home-tour",
    },
    {
      icon: <BookOpen className="w-4 h-4" />,
      label: "新手起手",
      description: "推薦幾條最容易上手的學習路徑",
      action: "chat-learning-path",
    },
  ],
  "my-brain": [
    {
      icon: <Cpu className="w-4 h-4" />,
      label: "大腦組態總覽",
      description: "解讀目前模型、人格、偏好的整體狀態",
      action: "chat-my-brain-overview",
    },
    {
      icon: <BarChart3 className="w-4 h-4" />,
      label: "推理鏈分析",
      description: "看看最近的決策路徑，找優化空間",
      action: "chat-my-brain-pipeline",
    },
  ],
  "tutorial-overview": [
    {
      icon: <BookOpen className="w-4 h-4" />,
      label: "學習路徑",
      description: "依你的目標安排一條順暢的學習動線",
      action: "chat-learning-path",
    },
    {
      icon: <Sparkles className="w-4 h-4" />,
      label: "推薦下一課",
      description: "根據你已經看過的內容挑下一個主題",
      action: "chat-tutorial-next",
    },
  ],
  "focus-flow": [
    {
      icon: <Clock className="w-4 h-4" />,
      label: "選擇節奏",
      description: "幫你判斷今天適合療癒、番茄還是聚焦時間",
      action: "chat-focus-flow-pick",
    },
    {
      icon: <Heart className="w-4 h-4" />,
      label: "療癒陪伴",
      description: "邊聊邊放鬆，做完後再回去工作室",
      action: "chat-healing",
    },
    {
      icon: <BookOpen className="w-4 h-4" />,
      label: "完成後做什麼",
      description: "把這段時間的想法整理成下一步",
      action: "chat-focus-flow-next",
    },
  ],
  "agent-chat": [
    {
      icon: <Navigation2 className="w-4 h-4" />,
      label: "帶我去某一頁",
      description: "告訴我目的地，我直接帶你過去並準備好參數",
      action: "chat-agent-navigate",
    },
    {
      icon: <Sparkles className="w-4 h-4" />,
      label: "全站搜尋",
      description: "搜尋功能、模型、教學或歷史紀錄",
      action: "chat-agent-search",
    },
    {
      icon: <Layers className="w-4 h-4" />,
      label: "規劃工作流",
      description: "把目標拆成跨頁面的可執行步驟",
      action: "chat-agent-workflow",
    },
  ],
  admin: [
    {
      icon: <Shield className="w-4 h-4" />,
      label: "後台導覽",
      description: "拆解管理後台各分頁與安全操作守則",
      action: "chat-admin-overview",
    },
    {
      icon: <BarChart3 className="w-4 h-4" />,
      label: "系統健康檢查",
      description: "從用戶、回饋、API 用量找出需要關注的訊號",
      action: "chat-admin-health",
    },
    {
      icon: <Cpu className="w-4 h-4" />,
      label: "AI 大腦組態",
      description: "解讀目前大腦設定、模型路由與風險點",
      action: "chat-admin-brain",
    },
  ],
  "admin-brain-pipeline": [
    {
      icon: <Cpu className="w-4 h-4" />,
      label: "推理鏈解讀",
      description: "逐節點說明這段推理的決策、輸入與輸出",
      action: "chat-admin-pipeline-read",
    },
    {
      icon: <RefreshCw className="w-4 h-4" />,
      label: "找瓶頸",
      description: "從鏈路裡找出耗時/失敗最高的節點",
      action: "chat-admin-pipeline-bottleneck",
    },
  ],
  "admin-api-usage": [
    {
      icon: <BarChart3 className="w-4 h-4" />,
      label: "用量趨勢解讀",
      description: "依時間、模型與用戶拆解 API 用量分佈",
      action: "chat-admin-api-trend",
    },
    {
      icon: <Coins className="w-4 h-4" />,
      label: "成本優化建議",
      description: "找出花最多 token 的節點與可降本的方法",
      action: "chat-admin-api-cost",
    },
  ],
  "brain-settings": [
    {
      icon: <Cpu className="w-4 h-4" />,
      label: "大腦組態導覽",
      description: "逐項解說模型路由、人格與安全設定",
      action: "chat-brain-settings-deep-dive",
    },
    {
      icon: <Shield className="w-4 h-4" />,
      label: "風險與守則",
      description: "說明變更設定的影響範圍與注意事項",
      action: "chat-brain-settings-safety",
    },
  ],
  feedback: [
    {
      icon: <Sparkles className="w-4 h-4" />,
      label: "整理回饋內容",
      description: "把你想說的話整理成清楚、可行動的回饋",
      action: "chat-feedback-compose",
    },
    {
      icon: <Layers className="w-4 h-4" />,
      label: "選擇分類",
      description: "幫你判斷這則屬於 bug、功能、品質或一般回饋",
      action: "chat-feedback-categorize",
    },
    {
      icon: <Heart className="w-4 h-4" />,
      label: "我想聊聊感受",
      description: "先把心情聊出來，再決定怎麼寫回饋",
      action: "chat-healing",
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
  home: "explore",
  dashboard: "explore",
  models: "lora",
  assets: "explore",
  notes: "script",
  learn: "explore",
  vault: "image",
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
  const { settings: personalSettings } = usePersonalSettings();
  const orbCuteMode = personalSettings.orbCuteMode;
  const orbRandomFly = personalSettings.orbRandomFly;
  const { state: agentOrbState, message: agentOrbMessage, changedAt: agentOrbChangedAt } = useOrbState();
  const agentOrbVisual = ORB_STATE_VISUAL[agentOrbState];
  const {
    isAnyTimerRunning,
    activeMode,
    pomodoroRemaining,
    healingRemaining,
    pomodoroPhase,
  } = useFocusFlow();
  const orbControls = useAnimation();
  const isMobile = useIsMobile();
  // Honor system "reduce motion" preference: disable continuous breathing,
  // pulsing glow, and infinite scale loops; keep one-shot transitions short.
  const reduceMotion = useReducedMotion() ?? false;

  // ─── Global Orb Chat Integration ──────────────────────────────────────
  const globalChat = useGlobalOrbChat();

  // ── User pref: orb widget corner ────────────────────────────────────────
  // Read agentPreferences for the user-selected corner. The query is gated by
  // auth elsewhere; fallback to "bottom-right" matches existing behaviour.
  const agentPrefsQuery = trpc.agentPreferences.getPreferences.useQuery(undefined, {
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const orbWidgetCorner =
    (agentPrefsQuery.data as { orbWidgetCorner?: string } | undefined)?.orbWidgetCorner ??
    "bottom-right";
  // Voice button gates — only render the mic when the user has opted
  // into voice; only auto-fire startVoice() when they've also asked
  // for auto-activate. Both default to false (matches
  // DEFAULT_AGENT_PREFERENCES) so a fresh user doesn't get an
  // unexpected WebSocket connection on every page load.
  const voiceEnabled =
    (agentPrefsQuery.data as { voiceEnabled?: boolean } | undefined)?.voiceEnabled === true;
  const voiceAutoActivate =
    (agentPrefsQuery.data as { voiceAutoActivate?: boolean } | undefined)?.voiceAutoActivate === true;

  // Drag position state
  const [position, setPosition] = useState<{ x: number; y: number }>(
    () => loadPosition() || { x: 0, y: 0 }
  );
  const [hasDragged, setHasDragged] = useState(() => !!loadPosition());

  // Snap back to the configured corner whenever the preference changes —
  // wipes any old drag offset so the user actually sees the corner they picked.
  useEffect(() => {
    setPosition({ x: 0, y: 0 });
    setHasDragged(false);
    try {
      localStorage.removeItem(POSITION_KEY);
    } catch {
      /* ignore */
    }
  }, [orbWidgetCorner]);

  // Onboarding state
  const [guiding, setGuiding] = useState(false);
  const [guideMessage, setGuideMessage] = useState<string | null>(null);
  const [onboardingActive, setOnboardingActive] = useState(false);
  const onboardingTimerRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const abortRef = useRef(false);

  // Drop zone state
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [dropFlash, setDropFlash] = useState<string | null>(null);

  // wouter location — declared up-front because pageDefaultSpirit (below)
  // and several handlers further down both read it. Splitting the hook into
  // two later calls produced a TDZ ReferenceError that surfaced as a React
  // #300 ("Element type is invalid") full-page crash on every load.
  const [locationPath, setLocation] = useLocation();

  // Interaction panel state
  const [showPanel, setShowPanel] = useState(false);
  const [panelView, setPanelView] = useState<
    "main" | "chat" | "inspiration" | "focus-flow" | "capabilities"
  >("main");
  // Use global chat state instead of local state
  const chatInput = globalChat.input;
  const setChatInput = globalChat.setInput;
  const chatMessages = globalChat.messages; // Keep full message objects for metadata
  const isChatLoading = globalChat.isSending;
  const chatSuggestions = globalChat.suggestions.map(s => s.text);

  // 15 精靈：依當前頁面找出「常駐」精靈（例如 /image-studio → 圖圖）。
  // 純視覺提示，不影響路由 — 後端的 selectRoleForIntent 仍照使用者的話分派。
  // 只有在還沒開始實質對話時 (chatMessages.length <= 1) 才顯示，避免和 chip 撞色。
  const pageDefaultSpirit = useMemo(() => {
    const skill = findSkillForPage(locationPath);
    return skill ? getSpiritVisual(skill.id) : null;
  }, [locationPath]);
  const showPageDefaultHint = pageDefaultSpirit && chatMessages.length <= 1;
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  // 思考步驟面板：使用者按下訊息上的 🧠 chip 時記錄目標訊息的 timestamp。
  const [thinkingPanelMessageAt, setThinkingPanelMessageAt] = useState<
    number | null
  >(null);
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
    const clamped = clampDragOffset(newX, newY, orbWidgetCorner);

    setPosition(clamped);
    homePositionRef.current = clamped;
    savePosition(clamped.x, clamped.y);
    setHasDragged(true);
  }

  // Re-clamp on window resize. Re-bind when the corner changes so the
  // clamp signs (positive vs negative offsets) match the new anchor.
  useEffect(() => {
    function handleResize() {
      setPosition(prev => {
        const clamped = clampDragOffset(prev.x, prev.y, orbWidgetCorner);
        homePositionRef.current = clamped;
        return clamped;
      });
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [orbWidgetCorner]);

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
  const currentRegistryPage = useMemo(
    () => getPageByPath(locationPath),
    [locationPath]
  );
  const studioCreativeMode =
    pageAgent.snapshot?.pageId === "studio"
      ? String(pageAgent.snapshot.state?.creativeMode ?? "")
      : "";
  const studioModality =
    pageAgent.snapshot?.pageId === "studio"
      ? String(pageAgent.snapshot.state?.activeModality ?? "image")
      : "image";
  const isStudioInspirationMode =
    pageContext?.pageId === "studio" &&
    pageAgent.snapshot?.pageId === "studio" &&
    studioCreativeMode === "simple";
  const isStudioStandardMode =
    pageContext?.pageId === "studio" &&
    pageAgent.snapshot?.pageId === "studio" &&
    studioCreativeMode === "standard";
  const isStudioProfessionalMode =
    pageContext?.pageId === "studio" &&
    pageAgent.snapshot?.pageId === "studio" &&
    studioCreativeMode === "pro";
  const resolvedPageQuickActions = useMemo(() => {
    const base = pageContext?.pageId
      ? (PAGE_QUICK_ACTIONS[pageContext.pageId] ?? [])
      : [];
    if (
      !isStudioInspirationMode &&
      !isStudioStandardMode &&
      !isStudioProfessionalMode
    ) {
      return base;
    }
    const mapped = base.map(qa => {
      if (qa.action === "interactive-guide") {
        if (isStudioProfessionalMode) {
          return {
            ...qa,
            label: "專業參數帶路",
            description: "改成專業模式深度調參（品質/一致性/成本/可重現性）",
          };
        }
        if (isStudioStandardMode) {
          return {
            ...qa,
            label: "標準參數帶路",
            description: "改成標準模式深度調參（積木、比例、參考圖、負面詞、必要條件）",
          };
        }
        return {
          ...qa,
          label: "參數帶路",
          description: "改成靈感模式參數細節操作（風格/比例/負面詞/種子）",
        };
      }
      if (qa.action === "page-deep-dive") {
        if (isStudioProfessionalMode) {
          return {
            ...qa,
            label: "專業頁面深度解析",
            description: "完整解說專業模式生成管線、品質控制與交付策略",
          };
        }
        if (isStudioStandardMode) {
          return {
            ...qa,
            label: "標準頁面深度解析",
            description: "完整解說標準模式的生成鏈路、參數耦合與設計取捨",
          };
        }
        return {
          ...qa,
          label: "靈感頁面細節",
          description: "解說靈感模式底層生成邏輯與這樣設計的原因",
        };
      }
      return qa;
    });
    return [
      ...mapped,
      {
        icon: <Settings className="w-4 h-4" />,
        label: isStudioProfessionalMode
          ? "專業工具箱深度調參"
          : isStudioStandardMode
            ? "標準工具箱深度調參"
            : "工具箱參數",
        description: isStudioProfessionalMode
          ? "開啟工具箱進行專業模式細節操作：品質控制/一致性/成本平衡"
          : isStudioStandardMode
            ? "開啟工具箱進行標準模式細節操作：積木/構圖/負面詞/必要條件"
            : "直接開啟工具箱，逐步調整靈感模式參數並立即套用",
        action: isStudioProfessionalMode
          ? "studio-pro-toolbox-deep"
          : isStudioStandardMode
            ? "studio-standard-toolbox-deep"
            : "studio-toolbox-params",
      },
    ];
  }, [
    isStudioInspirationMode,
    isStudioStandardMode,
    isStudioProfessionalMode,
    pageContext?.pageId,
  ]);
  const proactiveActions = useMemo(
    () => resolvedPageQuickActions.slice(0, 2),
    [resolvedPageQuickActions]
  );
  const studioPromptPack = useMemo(() => {
    const modalityLabel =
      studioModality === "video"
        ? "影片"
        : studioModality === "audio"
          ? "音樂"
          : studioModality === "voice"
            ? "配音"
            : "照片";
    const inspiration = {
      chatOpen:
        studioModality === "video"
          ? "請先用『靈感模式-影片』帶我操作：先定義畫面主題與鏡頭情緒，再調整時長、運鏡與 seed，並說明每步對流暢度與敘事的影響。"
          : studioModality === "audio"
            ? "請先用『靈感模式-音樂』帶我操作：先定義情緒與風格，再調整節奏、能量與時長，並說明每步對氛圍的影響。"
            : studioModality === "voice"
              ? "請先用『靈感模式-配音』帶我操作：先選角色與情緒，再調整語速、穩定度與強度，並說明每步對可聽性的影響。"
              : "請先用『靈感模式-照片』帶我做參數細節操作：先設定風格與構圖，再調整比例、seed、負面詞，最後告訴我每個參數為什麼這樣設計。",
      interactive:
        studioModality === "video"
          ? "請改用『參數細節帶路』引導我做影片：逐步設定主題、鏡頭運動、時長、seed 與負面描述，並在每一步說明為什麼這樣調。"
          : studioModality === "audio"
            ? "請改用『參數細節帶路』引導我做音樂：逐步設定風格、能量、時長、是否純音樂與結構，並在每一步說明為什麼這樣調。"
            : studioModality === "voice"
              ? "請改用『參數細節帶路』引導我做配音：逐步設定聲線、情緒、語速、穩定度與情緒強度，並在每一步說明為什麼這樣調。"
              : "請改用『參數細節帶路』引導我：逐步幫我設定靈感模式的風格、比例、seed、負面詞，並在每一步說明為什麼這樣調。",
      toolbox:
        `請帶我使用工具箱做靈感模式「${modalityLabel}」參數微調：先開工具箱，再依序調整關鍵參數，並解釋每一步對結果的影響。`,
    };
    const standard = {
      chatOpen:
        studioModality === "video"
          ? "請先用『標準模式-影片』深度帶路：從靈感積木→進階提示詞→時長/運鏡→參考素材→負面描述，逐步操作並說明設計理由。"
          : studioModality === "audio"
            ? "請先用『標準模式-音樂』深度帶路：從靈感積木→進階提示詞→風格/能量/時長→參考素材→結構控制，逐步操作並說明設計理由。"
            : studioModality === "voice"
              ? "請先用『標準模式-配音』深度帶路：從文字腳本→聲線/情緒→語速/穩定度→語氣微調，逐步操作並說明設計理由。"
              : "請先用『標準模式』深度帶路：從圖像靈感積木→進階提示詞建構器→畫面比例→參考圖→風格快選→負面詞→必要條件，逐步操作並說明每一步設計理由。",
      deepDive:
        `請深度解說「標準模式-${modalityLabel}」：` +
        "\n1) 各區塊底層生成邏輯" +
        "\n2) 參數耦合關係與先後順序（哪些先調、哪些最後微調）" +
        "\n3) 為什麼標準模式這樣設計（品質穩定、可控性、迭代效率）" +
        "\n4) 給我一套可重複的『起稿→收斂→定稿』操作模板",
      interactive:
        `請改用『標準模式深度帶路（${modalityLabel}）』：逐步帶我操作主要積木、進階提示詞、核心參數、參考素材與限制條件，並解釋每步對輸出的影響。`,
      toolbox:
        `請帶我用工具箱深度調整標準模式「${modalityLabel}」：依序處理主要積木、進階提示詞、核心參數、參考素材與限制條件，並提供每步判斷準則。`,
    };
    const professional = {
      chatOpen:
        studioModality === "video"
          ? "請先用『專業模式-影片』深度帶路：建立分鏡結構、鏡頭節奏、時長策略、品質參數與成本預算，並說明每一步取捨。"
          : studioModality === "audio"
            ? "請先用『專業模式-音樂』深度帶路：建立段落結構、情緒曲線、能量控制、母帶質感與成本策略，並說明每一步取捨。"
            : studioModality === "voice"
              ? "請先用『專業模式-配音』深度帶路：建立腳本節奏、角色一致性、語氣控制、音質穩定與交付規格，並說明每一步取捨。"
              : "請先用『專業模式-照片』深度帶路：建立主題語意、構圖策略、風格一致性、負面詞與細節精修，並說明每一步取捨。",
      deepDive:
        `請深度解說「專業模式-${modalityLabel}」：` +
        "\n1) 生成管線與品質控制節點" +
        "\n2) 參數耦合、風險點與可重現策略（seed/版本/素材一致性）" +
        "\n3) 成本與品質平衡（試跑→收斂→定稿）" +
        "\n4) 交付前檢查清單與可複製 SOP",
      interactive:
        `請改用『專業模式深度帶路（${modalityLabel}）』：逐步帶我完成從需求拆解到參數定稿，再到品質驗收與交付前檢查。`,
      toolbox:
        `請帶我用工具箱深度調整專業模式「${modalityLabel}」：依序完成高品質參數設定、風格一致性、風險排查與交付檢查，並提供每步判斷準則。`,
    };
    const deepDive = {
      inspiration:
        `請深度解說「靈感模式-${modalityLabel}」：\n` +
        "1) 可直接操作的關鍵參數\n" +
        "2) 底層生成流程與這些參數如何影響輸出\n" +
        "3) 為什麼這頁要這樣設計（新手起手、可迭代、成本控制）",
    };
    return { inspiration, standard, professional, deepDive };
  }, [studioModality]);
  const composeOrbGuidePrompt = useCallback(
    (goal: string) => {
      const modeLabel =
        studioCreativeMode === "pro"
          ? "專業"
          : studioCreativeMode === "standard"
            ? "標準"
            : studioCreativeMode === "simple"
              ? "靈感"
              : "未指定";
      const modalityLabel =
        studioModality === "video"
          ? "影片"
          : studioModality === "audio"
            ? "音樂"
            : studioModality === "voice"
              ? "配音"
              : "照片";
      return (
        `${goal}\n\n` +
        `目前使用者在創作工作室（模式=${modeLabel}、模態=${modalityLabel}）。\n` +
        "請用更貼近使用者的光球助理方式回覆：\n" +
        "1) 先用一句話確認理解我的目標。\n" +
        "2) 給 3-5 個可直接執行的步驟（每步包含：操作、為什麼、預期結果）。\n" +
        "3) 每步盡量對應可操作參數與區塊名稱。\n" +
        "4) 最後補一段「常見錯誤 + 快速修正」。\n" +
        "5) 若可直接代操，附上可執行的 [ACTION:...]。"
      );
    },
    [studioCreativeMode, studioModality]
  );
  const studioAutopilotActions = useMemo<AgentAction[]>(() => {
    if (pageContext?.pageId !== "studio") return [];
    const modeId =
      studioCreativeMode === "pro"
        ? "professional"
        : studioCreativeMode === "standard"
          ? "standard"
          : "inspiration";
    const actions: AgentAction[] = [
      { type: "setModality", modality: studioModality as "image" | "video" | "audio" | "voice" },
      { type: "setMode", modeId },
      { type: "openDialog", dialogId: "toolbox", params: { tab: "prompt-builder", section: "autopilot" } },
    ];
    if (studioModality === "video") {
      actions.push(
        { type: "setParam", key: "duration", value: 5 },
        { type: "setParam", key: "cameraMotion", value: "gentle_pan" }
      );
    } else if (studioModality === "audio") {
      actions.push(
        { type: "setParam", key: "musicStyle", value: "ambient" },
        { type: "setParam", key: "energy", value: 0.4 }
      );
    } else if (studioModality === "voice") {
      actions.push(
        { type: "setParam", key: "emotionType", value: "calm" },
        { type: "setParam", key: "stability", value: 0.72 }
      );
    } else {
      actions.push(
        { type: "setParam", key: "aspectRatio", value: "16:9" },
        { type: "setParam", key: "negativePrompt", value: "lowres, blurry, artifacts" }
      );
    }
    return actions;
  }, [pageContext?.pageId, studioCreativeMode, studioModality]);
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

  // Auth hook for capability "試用" navigation
  const { isAuthenticated } = useAuth();

  // Handler invoked from OrbCapabilitiesView "進入" buttons.
  const handleTryCapability = useCallback(
    (capability: CreativeCapability) => {
      setShowPanel(false);
      if (!isAuthenticated) {
        window.location.href = getLoginUrl();
        return;
      }
      onNavigate?.(capability.route);
      setLocation(capability.route);
    },
    [isAuthenticated, onNavigate, setLocation]
  );

  // Listen for "orb-open-capabilities" — fired from homepage narrative CTA.
  useEffect(() => {
    const handler = () => {
      setShowPanel(true);
      setPanelView("capabilities");
    };
    window.addEventListener("orb-open-capabilities", handler);
    return () => window.removeEventListener("orb-open-capabilities", handler);
  }, []);

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

  // ─── Random fly behavior (when orbRandomFly is enabled) ───────────────

  const randomFlyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!orbRandomFly || isMobile || guiding || showPanel || isGuideOpen) {
      if (randomFlyTimerRef.current) {
        clearTimeout(randomFlyTimerRef.current);
        randomFlyTimerRef.current = null;
      }
      return;
    }

    const scheduleNextFly = () => {
      const delay = 8000 + Math.random() * 10000; // 8-18 seconds
      randomFlyTimerRef.current = setTimeout(async () => {
        if (guiding || showPanel || isGuideOpen) {
          scheduleNextFly();
          return;
        }

        // Pick a random drift offset within a gentle radius
        const driftX = (Math.random() - 0.5) * 160;
        const driftY = (Math.random() - 0.5) * 120;

        const homeX = homePositionRef.current.x;
        const homeY = homePositionRef.current.y;

        const targetX = Math.max(
          -(window.innerWidth * 0.9),
          Math.min(0, homeX + driftX)
        );
        const targetY = Math.max(
          -(window.innerHeight * 0.9),
          Math.min(0, homeY + driftY)
        );

        // Float away
        await orbControls.start({
          x: targetX,
          y: targetY,
          transition: { duration: 1.8, ease: [0.25, 0.46, 0.45, 0.94] },
        });

        // Dwell briefly
        await new Promise<void>(resolve =>
          setTimeout(resolve, 2000 + Math.random() * 2000)
        );

        // Return home
        await orbControls.start({
          x: homeX,
          y: homeY,
          transition: { duration: 1.4, ease: [0.25, 0.46, 0.45, 0.94] },
        });

        scheduleNextFly();
      }, delay);
    };

    scheduleNextFly();

    return () => {
      if (randomFlyTimerRef.current) {
        clearTimeout(randomFlyTimerRef.current);
        randomFlyTimerRef.current = null;
      }
    };
  }, [orbRandomFly, isMobile, guiding, showPanel, isGuideOpen, orbControls]);

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
    (view: "inspiration" | "focus-flow" | "chat" | "tutorial" | "autopilot") => {
      if (view === "chat") {
        const pageLabel = currentRegistryPage?.label ?? pageContext?.pageLabel;
        setPanelView("chat");
        // Open global chat and set initial input if needed
        globalChat.open();
        if (isStudioProfessionalMode) {
          setChatInput(composeOrbGuidePrompt(studioPromptPack.professional.chatOpen));
        } else if (isStudioStandardMode) {
          setChatInput(composeOrbGuidePrompt(studioPromptPack.standard.chatOpen));
        } else if (isStudioInspirationMode) {
          setChatInput(composeOrbGuidePrompt(studioPromptPack.inspiration.chatOpen));
        } else if (pageLabel && globalChat.messages.length <= 1) {
          // Only set input if chat history is minimal (just welcome message)
          setChatInput(`請先告訴我「${pageLabel}」這頁的最佳起手步驟。`);
        }
      } else if (view === "autopilot") {
        setPanelView("chat");
        globalChat.open();
        void pageAgent.dispatchMany(studioAutopilotActions, {
          source: "manual",
          requireConfirmation: false,
        });
        setChatInput(
          composeOrbGuidePrompt(
            "我已先幫你套用一版起手參數。請用『光球帶操』方式告訴我：現在每個參數的作用、下一步先調哪兩個最有感，並直接給我可執行 ACTION。"
          )
        );
        showFeedback("已完成一鍵帶操起手式，接下來我們做精細微調 ⚡");
        setShowPanel(true);
        return;
      } else if (view === "tutorial") {
        const guideIntent =
          (pageContext?.pageId
            ? PAGE_TO_GUIDE_INTENT[pageContext.pageId]
            : undefined) ?? "explore";
        onRestartTour?.();
        openGuidePanel();
        selectGuideIntent(guideIntent);
        setPanelView("chat");
        globalChat.open();
        setChatInput(
          composeOrbGuidePrompt(
            "請用『教學引導 + 帶操』方式帶我完成這一頁：先講目標，再一步一步實作，每步都要有操作、原因與檢查點。"
          )
        );
        showFeedback("已啟動教學引導模式，光球會邊教邊帶你操作 📘");
        setShowPanel(true);
        return;
      } else if (view === "focus-flow") {
        setPanelView("focus-flow");
      } else {
        setPanelView("inspiration");
      }
      setShowPanel(true);
    },
    [
      currentRegistryPage?.label,
      pageContext?.pageLabel,
      globalChat,
      isStudioProfessionalMode,
      isStudioStandardMode,
      isStudioInspirationMode,
      studioPromptPack,
      composeOrbGuidePrompt,
      setChatInput,
    ]
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
        case "tutorial-guide": {
          const guideIntent =
            (pageContext?.pageId
              ? PAGE_TO_GUIDE_INTENT[pageContext.pageId]
              : undefined) ?? "explore";
          onRestartTour?.();
          openGuidePanel();
          selectGuideIntent(guideIntent);
          setPanelView("chat");
          globalChat.open();
          setChatInput(
            composeOrbGuidePrompt(
              "請用『教學引導 + 帶操』方式帶我完成這一頁：先講目標，再一步一步實作，每步都要有操作、原因與檢查點。"
            )
          );
          showFeedback("已啟動教學引導模式，光球會邊教邊帶你操作 📘");
          break;
        }
        case "page-deep-dive": {
          const pageLabel = currentRegistryPage?.label ?? pageContext?.pageLabel ?? "這一頁";
          setPanelView("chat");
          globalChat.open();
          if (isStudioProfessionalMode) {
            setChatInput(
              composeOrbGuidePrompt(
                `請深度解說「${pageLabel}」。\n${studioPromptPack.professional.deepDive}`
              )
            );
          } else if (isStudioStandardMode) {
            setChatInput(
              composeOrbGuidePrompt(
                `請深度解說「${pageLabel}」。\n${studioPromptPack.standard.deepDive}`
              )
            );
          } else if (isStudioInspirationMode) {
            setChatInput(
              composeOrbGuidePrompt(
                `請深度解說「${pageLabel}」。\n${studioPromptPack.deepDive.inspiration}`
              )
            );
          } else {
            setChatInput(`請解說「${pageLabel}」這一頁，先做哪三步最有效。`);
          }
          break;
        }
        case "interactive-guide": {
          if (isStudioProfessionalMode) {
            setPanelView("chat");
            globalChat.open();
            setChatInput(
              composeOrbGuidePrompt(studioPromptPack.professional.interactive)
            );
            await pageAgent.dispatch(
              {
                type: "openDialog",
                dialogId: "toolbox",
                params: { tab: "prompt-builder", section: "pro-deep-guide" },
              },
              { source: "manual", requireConfirmation: false }
            );
            showFeedback("已切換為專業模式「深度參數帶路」並開啟工具箱 🧰");
            break;
          }
          if (isStudioStandardMode) {
            setPanelView("chat");
            globalChat.open();
            setChatInput(
              composeOrbGuidePrompt(studioPromptPack.standard.interactive)
            );
            await pageAgent.dispatch(
              {
                type: "openDialog",
                dialogId: "toolbox",
                params: { tab: "prompt-builder", section: "standard-deep-guide" },
              },
              { source: "manual", requireConfirmation: false }
            );
            showFeedback("已切換為標準模式「深度參數帶路」並開啟工具箱 🧰");
            break;
          }
          if (isStudioInspirationMode) {
            setPanelView("chat");
            globalChat.open();
            setChatInput(
              composeOrbGuidePrompt(studioPromptPack.inspiration.interactive)
            );
            showFeedback("已切換為靈感模式「參數細節操作」帶路 ✨");
            break;
          }
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
        case "studio-all-details":
          setPanelView("chat");
          globalChat.open();
          setChatInput(
            composeOrbGuidePrompt(
              "請完整拆解創作工作室所有細節：\n" +
                "1) 靈感/標準/專業三模式的定位、差異與切換時機\n" +
                "2) 照片/影片/音樂/配音四模態的關鍵參數、耦合關係與調整順序\n" +
                "3) 工具箱每個區塊（積木、進階提示詞、參考圖、負面詞、必要條件）的底層邏輯與實戰用法\n" +
                "4) 成本與品質控制策略（試跑→收斂→定稿）\n" +
                "5) 給我一份可重複執行的端到端 SOP（含常見錯誤與排查）"
            )
          );
          await pageAgent.dispatch(
            {
              type: "openDialog",
              dialogId: "toolbox",
              params: { tab: "prompt-builder", section: "studio-all-details" },
            },
            { source: "manual", requireConfirmation: false }
          );
          showFeedback("已切到「創作工作室全細節」深度導引 📚");
          break;
        case "studio-autopilot":
          setPanelView("chat");
          globalChat.open();
          await pageAgent.dispatchMany(studioAutopilotActions, {
            source: "manual",
            requireConfirmation: false,
          });
          setChatInput(
            composeOrbGuidePrompt(
              "我已先幫你套用一版起手參數。請用『光球帶操』方式告訴我：現在每個參數的作用、下一步先調哪兩個最有感，並直接給我可執行 ACTION。"
            )
          );
          showFeedback("已完成一鍵帶操起手式，接下來我們做精細微調 ⚡");
          break;
        case "studio-toolbox-params":
          setPanelView("chat");
          globalChat.open();
          setChatInput(composeOrbGuidePrompt(studioPromptPack.inspiration.toolbox));
          await pageAgent.dispatch(
            {
              type: "openDialog",
              dialogId: "toolbox",
              params: { tab: "prompt-builder", section: "inspiration-params" },
            },
            { source: "manual", requireConfirmation: false }
          );
          showFeedback("已開啟工具箱，開始參數細節操作 🧰");
          break;
        case "studio-standard-toolbox-deep":
          setPanelView("chat");
          globalChat.open();
          setChatInput(composeOrbGuidePrompt(studioPromptPack.standard.toolbox));
          await pageAgent.dispatch(
            {
              type: "openDialog",
              dialogId: "toolbox",
              params: { tab: "prompt-builder", section: "standard-advanced" },
            },
            { source: "manual", requireConfirmation: false }
          );
          showFeedback("已開啟標準模式工具箱深度調參流程 🧰");
          break;
        case "studio-pro-toolbox-deep":
          setPanelView("chat");
          globalChat.open();
          setChatInput(composeOrbGuidePrompt(studioPromptPack.professional.toolbox));
          await pageAgent.dispatch(
            {
              type: "openDialog",
              dialogId: "toolbox",
              params: { tab: "prompt-builder", section: "pro-advanced" },
            },
            { source: "manual", requireConfirmation: false }
          );
          showFeedback("已開啟專業模式工具箱深度調參流程 🧰");
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
              "chat-director-storyboard":
                "請依我的概念/劇本拆解一份可執行的分鏡：每鏡的鏡頭語言、節奏秒數、情緒轉折與生成模型搭配建議。",
              "chat-director-script-polish":
                "請把我的粗稿改寫成可生成的鏡頭描述：保留情緒，補上構圖、光線、運鏡與音樂方向，每鏡 2-3 句。",
              "chat-lora-dataset-prep":
                "請帶我整理 LoRA 資料集：分類、去雜訊、解析度、命名與打標籤策略，並說明每步對訓練品質的影響。",
              "chat-lora-training-monitor":
                "請教我看 LoRA 訓練監控：步數、loss 趨勢、過擬合徵兆與何時該停手或續練的判斷準則。",
              "chat-models-risk-check":
                "請幫我做模型風險檢查：版本授權、敏感主題、穩定度、推薦使用情境與不建議使用的場景。",
              "chat-notes-from-chat":
                "請把剛剛的對話濃縮成一份可重用的筆記：標題、重點清單、可立即執行的下一步。",
              "chat-notes-prioritize":
                "請依我目前所有筆記重新排出今日 / 本週優先序，並標出 3 個最值得先做的任務。",
              "chat-home-orient":
                "我現在在首頁，請依我的心情或目標推薦最適合的工作室入口，給 1-2 個首選與理由。",
              "chat-home-tour":
                "請用 5-7 句話帶我看完整個站台主要頁面：每一頁的用途、什麼時候該去、可從哪裡開始。",
              "chat-my-brain-overview":
                "請解讀我的大腦組態總覽：目前模型路由、人格設定、最近偏好與可優化的地方。",
              "chat-my-brain-pipeline":
                "請帶我看最近的推理鏈：哪幾步最關鍵、哪裡可能有耗時或誤判，並給我下次的優化方向。",
              "chat-tutorial-next":
                "請依我已經看過的教學內容，推薦下一個最值得學的主題，並給我 3 步上手建議。",
              "chat-focus-flow-pick":
                "請依我目前的狀態幫我決定要走療癒、番茄或聚焦：先問我 1-2 個關鍵問題，再給建議與設定。",
              "chat-focus-flow-next":
                "我剛剛完成這段專注時間，請幫我整理當下的想法，並建議下一步要去哪一頁、做什麼。",
              "chat-agent-navigate":
                "我想去某一頁，但還沒想清楚，請先問我 1-2 句關鍵問題，再幫我選定目的地並用 [ACTION:navigate] 帶我過去。",
              "chat-agent-search":
                "請啟動全站搜尋：先問我關鍵字或目標，再列出最相關的頁面、模型與教學，並給快速跳轉建議。",
              "chat-agent-workflow":
                "請幫我把目標拆成跨頁面的可執行工作流：每一步要去哪一頁、要做什麼、產出是什麼、下一步如何銜接。",
              "chat-admin-overview":
                "請帶我看管理後台：每個分頁的用途、操作風險等級與建議流程，並提示哪些動作不可逆。",
              "chat-admin-health":
                "請從用戶、回饋、API 用量、系統訊號中整理出目前需要關注的 3 件事，並給對應處理建議。",
              "chat-admin-brain":
                "請解讀目前 AI 大腦組態：模型路由、人格、安全設定的搭配是否合理，有沒有立即可優化的點。",
              "chat-admin-pipeline-read":
                "請逐節點解讀目前這條推理鏈：每一步的輸入、輸出、決策依據，最後給整體判讀。",
              "chat-admin-pipeline-bottleneck":
                "請從目前推理鏈中找出耗時或失敗率最高的節點，並給降本/降延遲的具體建議。",
              "chat-admin-api-trend":
                "請分析目前 API 用量：依時間、模型、用戶拆解趨勢，標出 2-3 個值得關注的訊號。",
              "chat-admin-api-cost":
                "請找出花最多 token 的節點，並給 3 條可立即執行的成本優化建議（含風險評估）。",
              "chat-brain-settings-deep-dive":
                "請逐項解說 AI 大腦設定中心：模型路由、人格、安全、引導節奏，給我推薦配置與調整時的注意事項。",
              "chat-brain-settings-safety":
                "請說明變更目前大腦設定的影響範圍：哪些是可逆的、哪些可能影響全站，並列出操作前的檢查清單。",
              "chat-feedback-compose":
                "我想提交一則回饋，請先問我 2-3 個關鍵問題，再幫我整理成清楚、可行動的標題與描述。",
              "chat-feedback-categorize":
                "請依我描述的內容判斷這則回饋屬於 bug、功能建議、品質問題還是一般回饋，並建議優先級。",
            };
            const seedMsg = topicHints[action] ?? "有什麼想聊的嗎？";
            setPanelView("chat");
            globalChat.open();
            setChatInput(seedMsg);
          }
          break;
      }
    },
    [
      onApplyInspiration,
      onRestartTour,
      showFeedback,
      currentRegistryPage?.label,
      pageContext?.pageLabel,
      pageContext?.pageId,
      pageAgent,
      globalChat,
      isStudioProfessionalMode,
      isStudioStandardMode,
      isStudioInspirationMode,
      studioAutopilotActions,
      studioPromptPack,
      composeOrbGuidePrompt,
      onRestartTour,
      setChatInput,
      openGuidePanel,
      selectGuideIntent,
    ]
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
      const validFiles = candidates
        .map(file => ({
          file,
          resolved: resolveOrbAttachmentKind(file.type, file.name),
        }))
        .filter(
          (
            entry
          ): entry is {
            file: File;
            resolved: NonNullable<ReturnType<typeof resolveOrbAttachmentKind>>;
          } => entry.resolved !== null
        );
      if (validFiles.length === 0) {
        showFeedback(ORB_UNSUPPORTED_ATTACHMENT_MESSAGE);
        return;
      }

      setIsUploadingAttachments(true);
      try {
        const uploaded = await Promise.all(
          validFiles.map(async ({ file, resolved }) => {
            // For text-like docs (txt / md / docx), parse the body client-
            // side so the LLM actually sees the script. file_url parts can't
            // help here — Claude / Gemini won't natively parse `.docx`.
            let extractedText: string | undefined;
            if (resolved.kind === "text") {
              try {
                extractedText = await extractAttachmentText(file, resolved.mimeType);
                if (!extractedText.trim()) {
                  throw new AttachmentTextExtractionError(
                    "附件看起來是空的，沒有可讀取的內容。",
                  );
                }
              } catch (err) {
                const reason =
                  err instanceof AttachmentTextExtractionError
                    ? err.message
                    : shortErrorMsg(err);
                showFeedback(`無法讀取「${file.name}」：${reason}`);
                throw err;
              }
            }
            const result = await uploadFileToS3(file);
            const id =
              typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            return {
              id,
              name: file.name,
              url: result.url,
              mimeType: resolved.mimeType,
              kind: resolved.kind,
              ...(extractedText ? { extractedText } : {}),
            } satisfies ChatAttachment;
          })
        );
        setChatAttachments(prev => [...prev, ...uploaded]);
      } catch (err) {
        if (!(err instanceof AttachmentTextExtractionError)) {
          showFeedback(`附件上傳失敗：${shortErrorMsg(err)}`);
        }
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

  // ─── Intent-card handler — picks send the option directly ─────────────
  // The user already chose; no need to make them tap again in the input.
  const handleIntentCardSelect = useCallback(
    (option: IntentOption) => {
      if (isChatLoading) return;
      void globalChat.sendMessage(option.pickText, []);
    },
    [globalChat, isChatLoading]
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
            type="button"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onClick={skipOnboarding}
            className="pointer-events-auto fixed top-4 right-4 z-[60] flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white/85 backdrop-blur-md border border-gray-200/50 text-gray-600 hover:text-gray-800 hover:bg-white transition-all shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            aria-label="跳過光球引導流程"
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
                aria-hidden
              />
              <motion.div
                data-orb-panel
                role="dialog"
                aria-modal="true"
                aria-label="光球助手互動面板"
                initial={{ opacity: 0, y: "100%" }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: "60%" }}
                transition={
                  reduceMotion
                    ? { duration: 0.18 }
                    : { type: "spring", stiffness: 300, damping: 30 }
                }
                className="orb-mobile-sheet fixed inset-x-0 bottom-0 z-[56] pointer-events-auto rounded-t-3xl overflow-hidden"
                style={{
                  maxHeight: "85vh",
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
                        size="md"
                        className="!w-7 !h-7"
                        cuteMode={orbCuteMode}
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
                            : panelView === "capabilities"
                              ? "✨ 創作能力"
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
                      type="button"
                      onClick={() => setQuietMode(!quietMode)}
                      className={`p-2 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${quietMode ? "bg-amber-50 text-amber-500" : "hover:bg-gray-100 text-gray-400"}`}
                      title={quietMode ? "開啟提示" : "靜音模式"}
                      aria-label={quietMode ? "開啟主動提示" : "關閉主動提示"}
                      aria-pressed={quietMode}
                    >
                      {quietMode ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                    {panelView !== "main" && (
                      <button
                        type="button"
                        onClick={() => setPanelView("main")}
                        className="p-2 rounded-full hover:bg-gray-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
                        aria-label="返回主面板"
                        title="返回主面板"
                      >
                        <RotateCcw className="w-4 h-4 text-gray-400" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowPanel(false)}
                      className="p-2 rounded-full hover:bg-gray-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
                      aria-label="關閉光球面板"
                      title="關閉"
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
                            ...resolvedPageQuickActions,
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
                          onClick={() => setPanelView("capabilities")}
                          className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-gradient-to-r from-purple-50 to-sky-50 border border-purple-200/40 hover:from-purple-100 hover:to-sky-100 transition-all text-sm font-medium text-purple-700 mt-2"
                        >
                          <Sparkles className="w-4 h-4" />✨ 創作能力
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
                          {showPageDefaultHint && pageDefaultSpirit && (
                            <div
                              className="flex justify-start"
                              data-testid={`widget-page-default-hint-${pageDefaultSpirit.id}`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  // 點 chip = 預填 @暱稱 進輸入欄，不直接送出。讓使用者
                                  // 仍有最後一道閘 — 純粹是「快速喚他」的捷徑。
                                  if (!chatInput.trim()) {
                                    setChatInput(`${pageDefaultSpirit.prompt} `);
                                  }
                                }}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r ${pageDefaultSpirit.gradient} text-white text-[11px] font-medium shadow-sm hover:scale-[1.02] transition-transform`}
                                title={`${pageDefaultSpirit.vibe} — 點一下預填 ${pageDefaultSpirit.prompt}`}
                              >
                                <span aria-hidden>{pageDefaultSpirit.emoji}</span>
                                <span>{pageDefaultSpirit.nickname} 是這頁的常駐</span>
                              </button>
                            </div>
                          )}
                          {chatMessages.map((msg, i) => {
                            // 15 精靈：server 在 ai.chat 回應上掛了 agentRole，hydrate
                            // 過後 ChatMessage.agentRole 也存在 metadata 裡。沒有就不顯示，
                            // 不在這裡 fallback 推論 — 推論交給 AgentChat 頁，widget 維持
                            // 「server 說誰回的，就顯示誰」。
                            const spirit = msg.role === "orb"
                              ? getSpiritVisual((msg as { agentRole?: string }).agentRole)
                              : null;
                            return (
                            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                              <div className="flex flex-col gap-0.5 max-w-[85%]">
                                {spirit && (
                                  <span
                                    className={`self-start mb-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-gradient-to-r ${spirit.gradient} text-white text-[10px] font-medium shadow-sm`}
                                    data-testid={`widget-message-spirit-${spirit.id}`}
                                    title={spirit.vibe}
                                  >
                                    <span aria-hidden>{spirit.emoji}</span>
                                    <span>{spirit.nickname}</span>
                                  </span>
                                )}
                                <div className={`px-3.5 py-2.5 text-sm leading-relaxed ${
                                  msg.role === "user"
                                    ? `${personalityAccentBtn[personality]} rounded-2xl rounded-br-md`
                                    : "bg-gradient-to-br from-gray-50 to-gray-100/80 text-gray-700 rounded-2xl rounded-bl-md border border-gray-100/60"
                                }`}>
                                  {msg.text && (
                                    <div className="whitespace-pre-wrap break-words">
                                      <ChatMessageText
                                        text={msg.text}
                                        linkClassName={
                                          msg.role === "user"
                                            ? "underline decoration-white/60 underline-offset-2 hover:text-white inline-flex items-center gap-0.5"
                                            : "underline decoration-emerald-400 underline-offset-2 text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-0.5"
                                        }
                                        onIntentSelect={
                                          msg.role !== "user" ? handleIntentCardSelect : undefined
                                        }
                                        intentDisabled={isChatLoading}
                                      />
                                    </div>
                                  )}
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
                                          {attachment.kind === "image" ? "🖼️" : attachment.kind === "video" ? "🎬" : attachment.kind === "audio" ? "🎵" : attachment.kind === "text" ? "📝" : "📄"}
                                          <span className="truncate max-w-[220px]">{attachment.name}</span>
                                        </a>
                                      ))}
                                    </div>
                                  ) : null}
                                  {msg.webSources?.length ? (
                                    <div className="mt-2 border-t border-gray-200/60 pt-2 space-y-0.5">
                                      <div className="text-[9px] uppercase tracking-wider text-gray-400">來源</div>
                                      {msg.webSources.map((src, idx) => (
                                        <a
                                          key={`${src.url}-${idx}`}
                                          href={src.url}
                                          target="_blank"
                                          rel="noreferrer noopener"
                                          className="block text-[10px] text-emerald-700 hover:underline truncate"
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
                                      compact
                                    />
                                  ) : null}
                                </div>
                                {/* Visual flow diagram for orb actions ≥ 2 — 文字抽象時用圖示代替 */}
                                {msg.role === "orb" && msg.actions && msg.actions.length >= 2 ? (
                                  <OrbActionFlow
                                    actions={msg.actions}
                                    theme="light"
                                    className="mt-1.5 max-w-full"
                                  />
                                ) : null}
                                {msg.pagePath && msg.at && (
                                  <div className={`text-[10px] text-muted-foreground px-1 flex items-center gap-1 ${
                                    msg.role === "user" ? "justify-end" : "justify-start"
                                  }`}>
                                    <span>{getPageEmoji(msg.pagePath)}</span>
                                    <span>{formatMessageMetadata(msg.pagePath, msg.at)}</span>
                                    {msg.role === "orb" &&
                                    msg.reasoningChain &&
                                    (msg.reasoningChain.sections.length > 0 ||
                                      msg.reasoningChain.actions.length > 0) ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setThinkingPanelMessageAt(msg.at)
                                        }
                                        className="ml-1 inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-[9px] font-medium"
                                        data-testid={`widget-message-thinking-${msg.at}`}
                                        title="查看光球思考步驟"
                                      >
                                        <Brain className="w-2.5 h-2.5" aria-hidden />
                                        思考
                                      </button>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            </div>
                            );
                          })}
                          {isChatLoading && (
                            <OrbThinkingTimeline
                              events={globalChat.progressEvents}
                              reduceMotion={reduceMotion}
                            />
                          )}
                          <div ref={chatEndRef} />
                        </div>
                        {/* Quick-reply suggestions — 用快選圖卡呈現 */}
                        {chatSuggestions.length > 0 && !isChatLoading && (
                          <div className="px-4 py-2 grid grid-cols-2 gap-1.5">
                            {chatSuggestions.map(s => {
                              const emoji = inferSuggestionEmoji(s);
                              return (
                                <button
                                  key={s}
                                  onClick={() => handleSuggestionClick(s)}
                                  className="group flex items-start gap-2 rounded-xl border border-gray-200/60 bg-white/85 px-2.5 py-2 text-left shadow-sm hover:border-emerald-300 hover:bg-emerald-50/70 transition-all"
                                >
                                  <span className="text-sm leading-none mt-0.5 shrink-0">{emoji}</span>
                                  <span className="text-[11px] leading-snug text-gray-600 group-hover:text-gray-700 line-clamp-2">
                                    {s}
                                  </span>
                                </button>
                              );
                            })}
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
                                  <span>{attachment.kind === "image" ? "🖼️" : attachment.kind === "video" ? "🎬" : attachment.kind === "audio" ? "🎵" : attachment.kind === "text" ? "📝" : "📄"}</span>
                                  <span className="max-w-[120px] truncate">{attachment.name}</span>
                                  <X className="w-3 h-3" />
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center gap-2 rounded-xl border border-gray-200/60 bg-gray-50/50 px-4 py-3 focus-within:border-gray-300 focus-within:ring-2 focus-within:ring-emerald-200/60 transition-colors">
                            <button
                              type="button"
                              onClick={handlePickAttachment}
                              disabled={isUploadingAttachments || isChatLoading}
                              className="p-2 rounded-lg hover:bg-gray-200/60 transition-colors disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                              title="上傳圖像、影片、音訊或 PDF"
                              aria-label="上傳檔案"
                            >
                              {isUploadingAttachments ? (
                                <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
                              ) : (
                                <Paperclip className="w-4 h-4 text-gray-500" />
                              )}
                            </button>
                            <OrbVoiceButton
                              enabled={voiceEnabled}
                              autoActivate={voiceAutoActivate}
                            />
                            <input
                              type="text"
                              value={chatInput}
                              onChange={e => setChatInput(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
                              placeholder="分享你的想法，或問我任何事⋯⋯"
                              className="bg-transparent text-sm text-gray-700 placeholder:text-gray-400 outline-none flex-1 min-w-0"
                              aria-label="輸入訊息給光球"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={handleChatSend}
                              disabled={(!chatInput.trim() && chatAttachments.length === 0) || isChatLoading || isUploadingAttachments}
                              className="p-2 rounded-lg hover:bg-gray-200/60 transition-colors disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                              aria-label={isChatLoading ? "傳送中" : "傳送訊息"}
                              title={isChatLoading ? "傳送中" : "傳送 (Enter)"}
                            >
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
                    {panelView === "capabilities" && (
                      <motion.div
                        key="capabilities-mobile"
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                      >
                        <div className="px-4 pt-3">
                          <OrbMemoryDashboard />
                        </div>
                        <OrbCapabilitiesView onTryCapability={handleTryCapability} />
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
        role="complementary"
        aria-label="光球助手"
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
          "pointer-events-auto flex gap-3",
          // Anchor the widget to the user-selected corner. Match alignment
          // (items-end / items-start) to the corner so the panel grows in the
          // right direction and the drag-bounds stay sensible.
          (orbWidgetCorner === "bottom-left" || orbWidgetCorner === "top-left")
            ? "items-start flex-col"
            : "items-end flex-col",
          // Position is set via inline style below to honour iOS safe-area insets
          orbWidgetCorner === "bottom-right" && "absolute",
          orbWidgetCorner === "bottom-left" && "absolute",
          orbWidgetCorner === "top-right" && "absolute",
          orbWidgetCorner === "top-left" && "absolute"
        )}
        style={(() => {
          const inset = isMobile ? "1rem" : "1.5rem";
          const v = `calc(${inset} + env(safe-area-inset-bottom, 0px))`;
          const top = `calc(${inset} + env(safe-area-inset-top, 0px))`;
          const right = `calc(${inset} + env(safe-area-inset-right, 0px))`;
          const left = `calc(${inset} + env(safe-area-inset-left, 0px))`;
          const cursor = isMobile ? "pointer" : (guiding ? "default" : "grab");
          const base: CSSProperties = { cursor, touchAction: "none" };
          if (orbWidgetCorner === "bottom-right") return { ...base, bottom: v, right };
          if (orbWidgetCorner === "bottom-left") return { ...base, bottom: v, left };
          if (orbWidgetCorner === "top-right") return { ...base, top, right };
          if (orbWidgetCorner === "top-left") return { ...base, top, left };
          return base;
        })()}
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
              role="dialog"
              aria-label="光球助手互動面板"
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              transition={
                reduceMotion
                  ? { duration: 0.18 }
                  : { type: "spring", stiffness: 300, damping: 25 }
              }
              className="orb-desktop-popover w-72 sm:w-80 rounded-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Panel Header */}
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <VisualSoul
                      state={aiState}
                      personality={personality}
                      size="md"
                      className="!w-6 !h-6"
                      cuteMode={orbCuteMode}
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
                          : panelView === "capabilities"
                            ? "✨ 創作能力"
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
                    type="button"
                    onClick={() => setQuietMode(!quietMode)}
                    className={`p-1.5 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${quietMode ? "bg-amber-50 text-amber-500" : "hover:bg-gray-100 text-gray-400"}`}
                    title={
                      quietMode
                        ? "開啟提示（目前靜音中）"
                        : "靜音模式（不再主動提示）"
                    }
                    aria-label={quietMode ? "開啟主動提示" : "關閉主動提示"}
                    aria-pressed={quietMode}
                  >
                    {quietMode ? (
                      <VolumeX className="w-3.5 h-3.5" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                  {panelView !== "main" && (
                    <button
                      type="button"
                      onClick={() => setPanelView("main")}
                      className="p-1.5 rounded-full hover:bg-gray-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
                      aria-label="返回主面板"
                      title="返回主面板"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowPanel(false)}
                    className="p-1.5 rounded-full hover:bg-gray-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
                    aria-label="關閉光球面板"
                    title="關閉"
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
                        ...resolvedPageQuickActions,
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

                    {/* Capabilities Button */}
                    <button
                      onClick={() => setPanelView("capabilities")}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-purple-50 to-sky-50 border border-purple-200/40 hover:from-purple-100 hover:to-sky-100 transition-all text-sm font-medium text-purple-700 mt-2"
                    >
                      <Sparkles className="w-4 h-4" />
                      ✨ 創作能力
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
                      {showPageDefaultHint && pageDefaultSpirit && (
                        <div
                          className="flex justify-start"
                          data-testid={`widget-mini-page-default-hint-${pageDefaultSpirit.id}`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (!chatInput.trim()) {
                                setChatInput(`${pageDefaultSpirit.prompt} `);
                              }
                            }}
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-gradient-to-r ${pageDefaultSpirit.gradient} text-white text-[10px] font-medium shadow-sm`}
                            title={pageDefaultSpirit.vibe}
                          >
                            <span aria-hidden>{pageDefaultSpirit.emoji}</span>
                            <span>{pageDefaultSpirit.nickname} 在這頁</span>
                          </button>
                        </div>
                      )}
                      {chatMessages.map((msg, i) => {
                        // 15 精靈：迷你版聊天列也顯示「誰回的」chip。同上 — server 沒給就不顯示。
                        const spirit = msg.role === "orb"
                          ? getSpiritVisual((msg as { agentRole?: string }).agentRole)
                          : null;
                        return (
                        <div
                          key={i}
                          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                          <div className="flex flex-col gap-0.5 max-w-[85%]">
                            {spirit && (
                              <span
                                className={`self-start mb-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-gradient-to-r ${spirit.gradient} text-white text-[9px] font-medium shadow-sm`}
                                data-testid={`widget-mini-message-spirit-${spirit.id}`}
                                title={spirit.vibe}
                              >
                                <span aria-hidden>{spirit.emoji}</span>
                                <span>{spirit.nickname}</span>
                              </span>
                            )}
                            <div
                              className={`px-3.5 py-2.5 text-xs leading-relaxed ${
                                msg.role === "user"
                                  ? `${personalityAccentBtn[personality]} rounded-2xl rounded-br-md`
                                  : "bg-gradient-to-br from-gray-50 to-gray-100/80 text-gray-700 rounded-2xl rounded-bl-md border border-gray-100/60"
                              }`}
                            >
                              {msg.text && (
                                <div className="whitespace-pre-wrap break-words">
                                  <ChatMessageText
                                    text={msg.text}
                                    linkClassName={
                                      msg.role === "user"
                                        ? "underline decoration-white/60 underline-offset-2 hover:text-white inline-flex items-center gap-0.5"
                                        : "underline decoration-emerald-400 underline-offset-2 text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-0.5"
                                    }
                                    onIntentSelect={
                                      msg.role !== "user" ? handleIntentCardSelect : undefined
                                    }
                                    intentCompact
                                    intentDisabled={isChatLoading}
                                  />
                                </div>
                              )}
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
                                      {attachment.kind === "image" ? "🖼️" : attachment.kind === "video" ? "🎬" : attachment.kind === "audio" ? "🎵" : attachment.kind === "text" ? "📝" : "📄"}
                                      <span className="truncate max-w-[180px]">{attachment.name}</span>
                                    </a>
                                  ))}
                                </div>
                              ) : null}
                              {msg.webSources?.length ? (
                                <div className="mt-2 border-t border-gray-200/60 pt-2 space-y-0.5">
                                  <div className="text-[9px] uppercase tracking-wider text-gray-400">來源</div>
                                  {msg.webSources.map((src, idx) => (
                                    <a
                                      key={`${src.url}-${idx}`}
                                      href={src.url}
                                      target="_blank"
                                      rel="noreferrer noopener"
                                      className="block text-[10px] text-emerald-700 hover:underline truncate"
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
                                  compact
                                />
                              ) : null}
                            </div>
                            {/* Visual flow diagram for orb actions ≥ 2 */}
                            {msg.role === "orb" && msg.actions && msg.actions.length >= 2 ? (
                              <OrbActionFlow
                                actions={msg.actions}
                                theme="light"
                                className="max-w-full"
                              />
                            ) : null}
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
                        );
                      })}
                      {/* Multi-step thinking timeline (replaces typing dots) */}
                      {isChatLoading && (
                        <OrbThinkingTimeline
                          events={globalChat.progressEvents}
                          reduceMotion={reduceMotion}
                        />
                      )}
                      <div ref={chatEndRef} />
                    </div>

                    {/* Quick-reply suggestions (desktop) — 用快選圖卡呈現 */}
                    {chatSuggestions.length > 0 && !isChatLoading && (
                      <div className="px-3 py-1.5 grid grid-cols-2 gap-1.5">
                        {chatSuggestions.map(s => {
                          const emoji = inferSuggestionEmoji(s);
                          return (
                            <button
                              key={s}
                              onClick={() => handleSuggestionClick(s)}
                              className="group flex items-start gap-1.5 rounded-xl border border-gray-200/60 bg-white/85 px-2 py-1.5 text-left shadow-sm hover:border-emerald-300 hover:bg-emerald-50/70 transition-all"
                            >
                              <span className="text-[13px] leading-none mt-0.5 shrink-0">{emoji}</span>
                              <span className="text-[11px] leading-snug text-gray-600 group-hover:text-gray-700 line-clamp-2">
                                {s}
                              </span>
                            </button>
                          );
                        })}
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
                              <span>{attachment.kind === "image" ? "🖼️" : attachment.kind === "video" ? "🎬" : attachment.kind === "audio" ? "🎵" : attachment.kind === "text" ? "📝" : "📄"}</span>
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
                        <OrbVoiceButton
                          enabled={voiceEnabled}
                          autoActivate={voiceAutoActivate}
                        />
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

                {/* ─── Capabilities View ─── */}
                {panelView === "capabilities" && (
                  <motion.div
                    key="capabilities"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                  >
                    <div className="px-3 pt-3">
                      <OrbMemoryDashboard compact />
                    </div>
                    <OrbCapabilitiesView
                      onTryCapability={handleTryCapability}
                      compact
                    />
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
              transition={
                reduceMotion
                  ? { duration: 0.18 }
                  : { type: "spring", stiffness: 300, damping: 25 }
              }
              role="status"
              aria-live="polite"
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
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      dismissProactive();
                    }}
                    className="shrink-0 p-1 -m-1 rounded-full hover:bg-gray-200/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
                    aria-label="關閉提示氣泡"
                    title="關閉提示"
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
          whileHover={guiding || reduceMotion ? undefined : { scale: 1.1 }}
          whileTap={guiding ? undefined : { scale: 0.95 }}
          className="relative cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-amber-300"
          title={guiding ? "引導中..." : "🌸 點我開始對話"}
          role="button"
          tabIndex={0}
          aria-label={
            guiding
              ? "光球引導中"
              : showPanel
                ? "關閉光球助手面板"
                : "開啟光球助手面板"
          }
          aria-expanded={showPanel}
          aria-haspopup="dialog"
          onClick={e => {
            e.stopPropagation();
            if (!guiding) handleOrbClick();
          }}
          onKeyDown={e => {
            if (guiding) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              handleOrbClick();
            }
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

          {/* Neon glow ring — softer, healing-like breathing.
              When user prefers reduced motion, render a single static halo
              instead of an infinite keyframe loop. */}
          <motion.div
            className="absolute inset-0 rounded-full"
            animate={
              reduceMotion
                ? {
                    boxShadow: `0 0 14px ${personalityGlowColors[personality].replace("0.8", "0.35")}, 0 0 28px ${personalityGlowColors[personality].replace("0.8", "0.15")}`,
                  }
                : {
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
                  }
            }
            transition={
              reduceMotion
                ? { duration: 0.2 }
                : {
                    duration: guiding ? 1 : 3.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }
            }
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
            cuteMode={orbCuteMode}
          />

          {/* Agent state ring — overlays a colored pulse when the orb is
              actively doing something on behalf of the user. Idle = invisible. */}
          {agentOrbState !== "idle" && (
            <motion.div
              key={agentOrbChangedAt}
              aria-hidden
              initial={{ opacity: 0, scale: 0.85 }}
              animate={
                reduceMotion
                  ? {
                      opacity: 0.85,
                      scale: 1,
                      boxShadow: `0 0 16px ${agentOrbVisual.hex}AA, 0 0 32px ${agentOrbVisual.hex}55`,
                    }
                  : {
                      opacity: [0.65, 0.95, 0.65],
                      scale: [1, 1.18, 1],
                      boxShadow: [
                        `0 0 12px ${agentOrbVisual.hex}AA, 0 0 28px ${agentOrbVisual.hex}55`,
                        `0 0 22px ${agentOrbVisual.hex}DD, 0 0 48px ${agentOrbVisual.hex}77`,
                        `0 0 12px ${agentOrbVisual.hex}AA, 0 0 28px ${agentOrbVisual.hex}55`,
                      ],
                    }
              }
              transition={
                reduceMotion
                  ? { duration: 0.2 }
                  : {
                      duration: agentOrbState === "executing" ? 1.4 : 1.8,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }
              }
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{
                margin: "-6px",
                border: `2px solid ${agentOrbVisual.hex}`,
              }}
            />
          )}

          {/* Status pip + tooltip — short message of what the orb is doing now. */}
          <AnimatePresence>
            {agentOrbState !== "idle" && agentOrbMessage ? (
              <motion.div
                key={`${agentOrbState}-${agentOrbChangedAt}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.25 }}
                className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none"
                role="status"
                aria-live="polite"
              >
                <div
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border backdrop-blur-md"
                  style={{
                    background: "rgba(15, 23, 42, 0.78)",
                    borderColor: `${agentOrbVisual.hex}55`,
                    color: agentOrbVisual.hex,
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: agentOrbVisual.hex }}
                  />
                  {agentOrbMessage.length > 22
                    ? `${agentOrbMessage.slice(0, 21)}…`
                    : agentOrbMessage}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* 引導模式的腳註文字浮標 — 提示尚未互動的使用者點擊光球。
              提高字級與背景對比，並讓裝飾不被輔助技術朗讀。 */}
          <AnimatePresence>
            {!isGuideOpen && !showPanel && !guiding && !isAnyTimerRunning && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.9 }}
                transition={{ delay: 2, duration: reduceMotion ? 0.2 : 0.4 }}
                className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none"
                aria-hidden
              >
                <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md border border-white/15 shadow-md">
                  <Sparkles className="w-3 h-3 text-amber-200" />
                  <span className="text-[11px] text-white font-medium tracking-wide">點我開始</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Personality indicator dot */}
          <motion.div
            className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white"
            aria-hidden
            animate={
              reduceMotion
                ? { boxShadow: `0 0 6px ${personalityDotColors[personality]}` }
                : {
                    boxShadow: [
                      `0 0 4px ${personalityDotColors[personality]}`,
                      `0 0 8px ${personalityDotColors[personality]}`,
                      `0 0 4px ${personalityDotColors[personality]}`,
                    ],
                  }
            }
            transition={
              reduceMotion
                ? { duration: 0.2 }
                : { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
            }
            style={{ backgroundColor: personalityDotColors[personality] }}
            title={personalityLabels[personality]}
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
                  aria-hidden
                  animate={reduceMotion ? { opacity: 1 } : { opacity: [1, 0.3, 1] }}
                  transition={reduceMotion ? { duration: 0.2 } : { duration: 1, repeat: Infinity }}
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
      <OrbThinkingStepsPanel
        open={thinkingPanelMessageAt !== null}
        onOpenChange={open => {
          if (!open) setThinkingPanelMessageAt(null);
        }}
        chain={
          thinkingPanelMessageAt === null
            ? undefined
            : chatMessages.find(m => m.at === thinkingPanelMessageAt)
                ?.reasoningChain
        }
        messageAt={thinkingPanelMessageAt ?? undefined}
      />
    </div>
  );
});
