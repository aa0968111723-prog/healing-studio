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
  Send,
  Heart,
  Music,
  Video,
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
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useFocusFlow } from "@/contexts/FocusFlowContext";
import FocusFlowMini from "./FocusFlowMini";
import { useOrbGuide } from "@/contexts/OrbGuideContext";
import OrbGuidePanel from "./OrbGuidePanel";
import { usePageAgent } from "@/contexts/PageAgentContext";
import { parseLLMActions, type AgentAction } from "../../../shared/agent-actions";
import { useLocation } from "wouter";
import { getPageByPath } from "@/config/appRegistry";
import { useIsMobile } from "@/hooks/useMobile";
import { cn } from "@/lib/utils";

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
];

// ─── Page-specific quick actions (contextual AI agent capabilities) ────────

const PAGE_QUICK_ACTIONS: Record<string, QuickAction[]> = {
  "image-studio": [
    {
      icon: <Image className="w-4 h-4" />,
      label: "模型推薦",
      description: "根據你的需求推薦最適合的圖片模型",
      action: "chat-model-recommend",
    },
    {
      icon: <Sparkles className="w-4 h-4" />,
      label: "提詞優化",
      description: "讓 AI 幫你改進提示詞",
      action: "chat-prompt-optimize",
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
      icon: <Sparkles className="w-4 h-4" />,
      label: "影片提詞技巧",
      description: "教你寫出更好的影片生成提示詞",
      action: "chat-video-tips",
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
      icon: <Mic className="w-4 h-4" />,
      label: "配音技巧",
      description: "語音合成和聲音克隆的最佳實踐",
      action: "chat-voice-tips",
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
  learn: [
    {
      icon: <BookOpen className="w-4 h-4" />,
      label: "學習路徑",
      description: "推薦適合你程度的學習文件",
      action: "chat-learning-path",
    },
  ],
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
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<
    Array<{ role: "user" | "orb"; text: string }>
  >([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
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
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setShowPanel(false);
  }, [guiding, isGuideOpen, openGuidePanel, closeGuidePanel]);

  // Bridge from OrbGuidePanel → interaction panel views
  const handleOpenInteraction = useCallback(
    (view: "inspiration" | "focus-flow" | "chat") => {
      setPanelView(view === "chat" ? "chat" : view === "focus-flow" ? "focus-flow" : "inspiration");
      if (view === "chat") {
        setChatMessages([{ role: "orb", text: greeting }]);
      }
      setShowPanel(true);
    },
    [greeting]
  );

  // ─── Quick action handlers ───────────────────────────────────────────

  const handleQuickAction = useCallback(
    (action: string) => {
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
          setChatMessages([
            {
              role: "orb",
              text: greeting,
            },
          ]);
          break;
        case "chat-healing":
          setPanelView("chat");
          setChatMessages([
            {
              role: "orb",
              text: "🌿 告訴我你現在的心情，我來幫你找到適合的創作方向。",
            },
          ]);
          setChatInput("我現在的心情是⋯⋯");
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
              "chat-prompt-optimize": "請幫我優化提示詞",
              "chat-model-compare": "請幫我比較影片模型的差異",
              "chat-video-tips": "影片提示詞有什麼技巧？",
              "chat-music-style": "請推薦適合的音樂風格",
              "chat-voice-tips": "聲音克隆有什麼注意事項？",
              "chat-training-tips": "訓練 LoRA 模型有什麼建議？",
              "chat-learning-path": "推薦適合新手的學習路徑",
            };
            const seedMsg = topicHints[action] ?? "有什麼想聊的嗎？";
            setPanelView("chat");
            setChatMessages([{ role: "orb", text: greeting }]);
            setChatInput(seedMsg);
          }
          break;
      }
    },
    [onApplyInspiration, onRestartTour, greeting, showFeedback]
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

  // ─── AI chat mutation ─────────────────────────────────────────────────
  const aiChatMutation = trpc.ai.chat.useMutation();

  // ─── Chat handler (with real LLM + conversation history) ─────────────

  const handleChatSend = useCallback(async () => {
    if (!chatInput.trim() || isChatLoading) return;

    const userMsg = chatInput.trim();
    const updatedMessages = [
      ...chatMessages,
      { role: "user" as const, text: userMsg },
    ];
    setChatMessages(updatedMessages);
    setChatInput("");
    setIsChatLoading(true);

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

    try {
      // Build history for the LLM (exclude the greeting from orb since it's not part of the real history)
      const llmMessages = updatedMessages
        .filter(m => !(m.role === "orb" && chatMessages.indexOf(m) === 0)) // skip initial greeting
        .map(m => ({
          role: m.role === "user" ? ("user" as const) : ("assistant" as const),
          content: m.text,
        }))
        .filter(m => m.role === "user" || m.content !== greeting); // skip greeting bubble

      // Build page context string for LLM
      const contextParts = [pageContext?.pageLabel];
      if (pageContext?.activeModel)
        contextParts.push(`模型: ${pageContext.activeModel}`);
      if (pageContext?.activeTab)
        contextParts.push(`分頁: ${pageContext.activeTab}`);
      const contextStr = pageContext
        ? contextParts.filter(Boolean).join(" · ")
        : undefined;

      const data = await aiChatMutation.mutateAsync({
        messages: llmMessages,
        personality,
        context: contextStr,
        // Phase 1.5：送上結構化頁面 snapshot + 最近回饋，讓 LLM 真正看懂這頁
        pageSnapshot: pageAgent.snapshot ?? undefined,
        recentFeedback: pageAgent.recentFeedback,
      });
      setChatMessages(prev => [...prev, { role: "orb", text: data.reply }]);

      // Phase 1.5：若 LLM 附了 INTENT 摘要，先浮顯「光球想做什麼」給使用者看
      const intentSummary =
        typeof (data as { intent?: string | null }).intent === "string"
          ? ((data as { intent?: string | null }).intent as string)
          : undefined;
      const askBeforeAct = (data as { askBeforeAct?: boolean }).askBeforeAct === true;

      // Handle agent actions from LLM response
      if (data.actions && Array.isArray(data.actions)) {
        // 先走既有的 callbacks（向後相容，不影響 Studio 舊路徑）
        for (const action of data.actions) {
          switch (action.type) {
            case "navigate":
              onNavigate?.(action.payload);
              break;
            case "modality":
              if (
                ["image", "video", "audio", "voice"].includes(action.payload)
              ) {
                onSwitchModality?.(
                  action.payload as "image" | "video" | "audio" | "voice"
                );
              }
              break;
            case "preset": {
              const preset = INSPIRATION_PRESETS.find(
                p => p.label === action.payload
              );
              if (preset) {
                onApplyInspiration?.(preset.blocks);
                showFeedback(`已套用「${preset.label}」靈感 ${preset.emoji}`);
              }
              break;
            }
          }
        }

        // 同時把結構化 actions 丟進 PageAgent bus。
        // PageAgentContext.dispatch 內部會自動：
        //   - 非破壞性動作（fillPrompt / setModel / setTab…）→ 直接執行
        //   - 破壞性動作（submit / reset / applyPreset / setModality）→ 走確認閘，
        //     由 AgentIntentPreview 卡片請使用者按「好啊」或「先不要」
        const structured = parseLLMActions(data.actions);
        if (structured.length > 0) {
          for (const action of structured) {
            void pageAgent.dispatch(action, {
              source: "ai-chat",
              intentSummary,
              // 若 LLM 明說 askBeforeAct，所有動作一律先問；否則用內建破壞性判斷
              requireConfirmation: askBeforeAct ? true : undefined,
            });
          }
        }
      }
    } catch {
      setChatMessages(prev => [
        ...prev,
        { role: "orb", text: "🌸 抱歉，我剛才有點恍神。再說一次好嗎？" },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  }, [
    chatInput,
    chatMessages,
    isChatLoading,
    personality,
    greeting,
    aiChatMutation,
    onSwitchModality,
    pageContext,
    onNavigate,
    onApplyInspiration,
    showFeedback,
    pageAgent,
  ]);

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
    const handler = (e: MouseEvent | TouchEvent) => {
      const target = (e instanceof TouchEvent ? e.target : e.target) as HTMLElement;
      if (
        !target.closest("[data-orb-panel]") &&
        !target.closest("[data-orb-trigger]")
      ) {
        setShowPanel(false);
      }
    };
    // Use pointerdown for unified mouse+touch handling
    document.addEventListener("pointerdown", handler as EventListener, true);
    return () => document.removeEventListener("pointerdown", handler as EventListener, true);
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
                          onClick={() => setPanelView("inspiration")}
                          className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-gradient-to-r from-amber-50 to-pink-50 border border-amber-200/40 hover:from-amber-100 hover:to-pink-100 transition-all text-sm font-medium text-amber-700"
                        >
                          <Lightbulb className="w-4 h-4" />✨ 靈感探索
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
                              <div className={`max-w-[85%] px-3.5 py-2.5 text-sm leading-relaxed ${
                                msg.role === "user"
                                  ? `${personalityAccentBtn[personality]} rounded-2xl rounded-br-md`
                                  : "bg-gradient-to-br from-gray-50 to-gray-100/80 text-gray-700 rounded-2xl rounded-bl-md border border-gray-100/60"
                              }`}>
                                {msg.text}
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
                        <div className="px-4 py-3 border-t border-gray-100/60">
                          <div className="flex items-center gap-2 rounded-xl border border-gray-200/60 bg-gray-50/50 px-4 py-3 focus-within:border-gray-300 transition-colors">
                            <input
                              type="text"
                              value={chatInput}
                              onChange={e => setChatInput(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); } }}
                              placeholder="分享你的想法，或問我任何事⋯⋯"
                              className="bg-transparent text-sm text-gray-700 placeholder:text-gray-400 outline-none flex-1 min-w-0"
                              autoFocus
                            />
                            <button onClick={handleChatSend} disabled={!chatInput.trim() || isChatLoading} className="p-2 rounded-lg hover:bg-gray-200/60 transition-colors disabled:opacity-30">
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
                      onClick={() => setPanelView("inspiration")}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-amber-50 to-pink-50 border border-amber-200/40 hover:from-amber-100 hover:to-pink-100 transition-all text-sm font-medium text-amber-700"
                    >
                      <Lightbulb className="w-4 h-4" />✨ 靈感探索
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
                          <div
                            className={`max-w-[85%] px-3.5 py-2.5 text-xs leading-relaxed ${
                              msg.role === "user"
                                ? `${personalityAccentBtn[personality]} rounded-2xl rounded-br-md`
                                : "bg-gradient-to-br from-gray-50 to-gray-100/80 text-gray-700 rounded-2xl rounded-bl-md border border-gray-100/60"
                            }`}
                          >
                            {msg.text}
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

                    {/* Chat Input */}
                    <div className="px-3 py-3 border-t border-gray-100/60">
                      <div className="flex items-center gap-2 rounded-xl border border-gray-200/60 bg-gray-50/50 px-3 py-2 focus-within:border-gray-300 transition-colors">
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
                          disabled={!chatInput.trim() || isChatLoading}
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
