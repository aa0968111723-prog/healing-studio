import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence, type PanInfo, useAnimation } from "framer-motion";
import { useAIState } from "@/contexts/AIStateContext";
import VisualSoul from "./VisualSoul";
import {
  X, Sparkles, Lightbulb, Palette, Shuffle, MessageCircle,
  Send, Heart, Music, Video, Image, Mic, BookOpen, RotateCcw,
} from "lucide-react";

type Props = {
  className?: string;
  enableOnboarding?: boolean;
  onSaveToNotes?: (payload: { title: string; content?: string; sourceType?: string }) => void;
  onAddToCalendar?: (payload: { title: string; description?: string; date: Date }) => void;
  onOpenNotes?: () => void;
  onOpenCalendar?: () => void;
  onRestartTour?: () => void;
  /** Apply inspiration blocks to the prompt builder */
  onApplyInspiration?: (blocks: { subject?: string; style?: string; lighting?: string; color?: string; mood?: string }) => void;
  /** Switch modality tab */
  onSwitchModality?: (modality: "image" | "video" | "audio" | "voice") => void;
};

const POSITION_KEY = "proactive-orb-position";
const ONBOARDED_KEY = "onboarded";

// ─── Persistence helpers ──────────────────────────────────────────────────

function loadPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.x === "number" && typeof parsed.y === "number") return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

function savePosition(x: number, y: number) {
  try { localStorage.setItem(POSITION_KEY, JSON.stringify({ x, y })); } catch { /* ignore */ }
}

function isOnboarded(): boolean {
  try { return localStorage.getItem(ONBOARDED_KEY) === "true"; } catch { return true; }
}

function markOnboarded() {
  try { localStorage.setItem(ONBOARDED_KEY, "true"); } catch { /* ignore */ }
}

// ─── Inspiration presets ─────────────────────────────────────────────────

interface InspirationPreset {
  label: string;
  emoji: string;
  mood: string;
  blocks: { subject?: string; style?: string; lighting?: string; color?: string; mood?: string };
  modality?: "image" | "video" | "audio" | "voice";
}

const INSPIRATION_PRESETS: InspirationPreset[] = [
  {
    label: "寧靜森林",
    emoji: "🌿",
    mood: "平靜",
    blocks: { subject: "森林", style: "水彩畫", lighting: "柔光", color: "冷色調", mood: "寧靜" },
  },
  {
    label: "星空冒險",
    emoji: "✨",
    mood: "期待",
    blocks: { subject: "星空", style: "賽博龐克", lighting: "霓虹燈", color: "高飽和", mood: "神秘" },
  },
  {
    label: "溫暖日落",
    emoji: "🌅",
    mood: "溫暖",
    blocks: { subject: "海邊", style: "油畫", lighting: "黃金時刻", color: "暖色調", mood: "懷舊" },
  },
  {
    label: "夢幻花園",
    emoji: "🌸",
    mood: "浪漫",
    blocks: { subject: "花朵", style: "浮世繪", lighting: "柔光", color: "低飽和", mood: "夢幻" },
  },
  {
    label: "雨天咖啡",
    emoji: "☕",
    mood: "放鬆",
    blocks: { subject: "咖啡廳", style: "水彩畫", lighting: "燭光", color: "暖色調", mood: "慵懶" },
  },
  {
    label: "科幻都市",
    emoji: "🏙️",
    mood: "興奮",
    blocks: { subject: "城市", style: "賽博龐克", lighting: "霓虹燈", color: "高飽和", mood: "未來感" },
  },
];

// ─── Mood-based greetings ────────────────────────────────────────────────

const MOOD_GREETINGS: Record<string, string[]> = {
  calm: [
    "今天想創作什麼樣的畫面呢？",
    "深呼吸，讓靈感自然浮現。",
    "不急，慢慢來，好的作品值得等待。",
  ],
  creative: [
    "靈感來了！試試看隨機組合？",
    "今天的你，想要什麼顏色的心情？",
    "大膽嘗試，每個意外都可能是驚喜。",
  ],
  technical: [
    "需要我幫你分析構圖嗎？",
    "試試調整權重，看看效果有什麼變化。",
    "精確的參數，帶來精確的表達。",
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
  { icon: <Shuffle className="w-4 h-4" />, label: "隨機靈感", description: "讓我幫你隨機組合一組靈感積木", action: "random" },
  { icon: <MessageCircle className="w-4 h-4" />, label: "聊聊心情", description: "告訴我你現在的感受", action: "chat" },
  { icon: <BookOpen className="w-4 h-4" />, label: "重新導覽", description: "再看一次新手引導", action: "tour" },
];

// ─── 90-second onboarding step definitions ────────────────────────────────

interface OnboardingStep {
  elementId: string;
  message: string;
  startSec: number;
  endSec: number;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  { elementId: "prompt-builder-area", message: "試著點選幾個喜歡的積木",        startSec: 0,  endSec: 15 },
  { elementId: "modality-tabs",       message: "切換不同的創作模態",            startSec: 15, endSec: 30 },
  { elementId: "generate-button",     message: "準備好了就按下生成",            startSec: 30, endSec: 50 },
  { elementId: "proactive-orb-anchor", message: "隨時點我，我會陪你一起創作",   startSec: 50, endSec: 70 },
];

const GUIDE_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

// ─── Component ────────────────────────────────────────────────────────────

export default function ProactiveOrbWidget({
  className = "",
  enableOnboarding = true,
  onSaveToNotes,
  onAddToCalendar,
  onOpenNotes,
  onOpenCalendar,
  onRestartTour,
  onApplyInspiration,
  onSwitchModality,
}: Props) {
  const { aiState, personality, proactiveMessage, dismissProactive } = useAIState();
  const orbControls = useAnimation();

  // Drag position state
  const [position, setPosition] = useState<{ x: number; y: number }>(() => loadPosition() || { x: 0, y: 0 });
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
  const [panelView, setPanelView] = useState<"main" | "chat" | "inspiration">("main");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "orb"; text: string }>>([]);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // Home position
  const homePositionRef = useRef(position);

  // Random greeting based on personality
  const greeting = useMemo(() => {
    const greetings = MOOD_GREETINGS[personality] || MOOD_GREETINGS.calm;
    return greetings[Math.floor(Math.random() * greetings.length)];
  }, [personality, showPanel]);

  // ─── guideTo method ───────────────────────────────────────────────────

  const guideTo = useCallback(async (elementId: string, message: string) => {
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

    await new Promise<void>((resolve) => {
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
  }, [orbControls]);

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
            await new Promise<void>((resolve) => {
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

  function handleDragStart(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    dragStartRef.current = { x: info.point.x, y: info.point.y };
  }

  function handleDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
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
      setPosition((prev) => {
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

  const handleNativeDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropTarget(false);

    try {
      const raw = e.dataTransfer.getData("text/plain");
      let data: any;
      try { data = JSON.parse(raw); } catch { data = { text: raw }; }

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
  }, [personality, onSaveToNotes]);

  // ─── Feedback helper ─────────────────────────────────────────────────

  const showFeedback = useCallback((msg: string) => {
    setFeedbackMessage(msg);
    setTimeout(() => setFeedbackMessage(null), 2500);
  }, []);

  // ─── Orb click handler (single click opens panel) ────────────────────

  const handleOrbClick = useCallback(() => {
    if (guiding) return;
    setShowPanel((prev) => !prev);
    setPanelView("main");
  }, [guiding]);

  // ─── Quick action handlers ───────────────────────────────────────────

  const handleQuickAction = useCallback((action: string) => {
    switch (action) {
      case "random": {
        const preset = INSPIRATION_PRESETS[Math.floor(Math.random() * INSPIRATION_PRESETS.length)];
        onApplyInspiration?.(preset.blocks);
        showFeedback(`已套用「${preset.label}」靈感 ${preset.emoji}`);
        setShowPanel(false);
        break;
      }
      case "chat":
        setPanelView("chat");
        setChatMessages([{
          role: "orb",
          text: greeting,
        }]);
        break;
      case "tour":
        setShowPanel(false);
        onRestartTour?.();
        break;
    }
  }, [onApplyInspiration, onRestartTour, greeting, showFeedback]);

  // ─── Chat handler ────────────────────────────────────────────────────

  const handleChatSend = useCallback(() => {
    if (!chatInput.trim()) return;

    const userMsg = chatInput.trim();
    setChatMessages((prev) => [...prev, { role: "user", text: userMsg }]);
    setChatInput("");

    // Simple keyword-based response for immediate feedback
    setTimeout(() => {
      let response = "";
      const lower = userMsg.toLowerCase();

      if (lower.includes("開心") || lower.includes("快樂") || lower.includes("高興")) {
        response = "太好了！開心的時候最適合創作。試試用暖色調和明亮的光線來表達你的心情？";
      } else if (lower.includes("難過") || lower.includes("傷心") || lower.includes("低落") || lower.includes("累")) {
        response = "沒關係，創作也可以是一種療癒。試試畫一幅寧靜的風景，讓心情慢慢沉澱。";
      } else if (lower.includes("無聊") || lower.includes("沒靈感") || lower.includes("不知道")) {
        const preset = INSPIRATION_PRESETS[Math.floor(Math.random() * INSPIRATION_PRESETS.length)];
        response = `試試「${preset.label}」${preset.emoji} 這個主題？我幫你準備好了積木，點擊下方的靈感推薦就能套用。`;
      } else if (lower.includes("謝") || lower.includes("感謝")) {
        response = "不客氣！創作的路上有我陪你。隨時點我聊聊天或要靈感。";
      } else if (lower.includes("你好") || lower.includes("嗨") || lower.includes("哈囉")) {
        response = "嗨！很高興見到你。今天想創作什麼呢？可以告訴我你的心情，我來推薦適合的靈感。";
      } else if (lower.includes("圖") || lower.includes("畫") || lower.includes("圖片")) {
        response = "想畫圖嗎？試試點選上方的積木，組合出你想要的畫面。或者讓我幫你隨機推薦一組？";
      } else if (lower.includes("影片") || lower.includes("視頻") || lower.includes("動畫")) {
        response = "影片創作很有趣！切換到影片模態，選擇主體動態和運鏡方式，就能生成短影片。";
        onSwitchModality?.("video");
      } else if (lower.includes("音樂") || lower.includes("歌") || lower.includes("曲")) {
        response = "想要音樂嗎？切換到音樂模態，描述你想要的氛圍，AI 就能為你譜曲。";
        onSwitchModality?.("audio");
      } else if (lower.includes("配音") || lower.includes("語音") || lower.includes("說話")) {
        response = "語音功能可以幫你把文字變成有感情的聲音。切換到語音模態試試看！";
        onSwitchModality?.("voice");
      } else {
        const responses = [
          "我理解你的感受。要不要試試把這個想法轉化成一幅畫？",
          "有趣的想法！你可以用積木來描述這個場景，看看 AI 會怎麼詮釋。",
          "嗯，讓我想想...也許可以從一個顏色或一種光線開始，慢慢建構你的畫面。",
          "每個想法都是創作的種子。試著選幾個積木，讓它發芽吧。",
        ];
        response = responses[Math.floor(Math.random() * responses.length)];
      }

      setChatMessages((prev) => [...prev, { role: "orb", text: response }]);
    }, 600);
  }, [chatInput, onSwitchModality]);

  // ─── Apply inspiration preset ────────────────────────────────────────

  const handleApplyPreset = useCallback((preset: InspirationPreset) => {
    onApplyInspiration?.(preset.blocks);
    if (preset.modality) {
      onSwitchModality?.(preset.modality);
    }
    showFeedback(`已套用「${preset.label}」靈感 ${preset.emoji}`);
    setShowPanel(false);
  }, [onApplyInspiration, onSwitchModality, showFeedback]);

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

  // Close panel when clicking outside
  useEffect(() => {
    if (!showPanel) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-orb-panel]") && !target.closest("[data-orb-trigger]")) {
        setShowPanel(false);
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
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

      {/* Draggable orb container */}
      <motion.div
        drag={!guiding && !showPanel}
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
        whileDrag={{
          scale: 1.15,
          boxShadow: `0 0 40px ${personalityGlowColors[personality]}`,
        }}
        initial={hasDragged ? position : { x: 0, y: 0 }}
        animate={guiding ? undefined : position}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="absolute bottom-6 right-6 pointer-events-auto flex flex-col items-end gap-3"
        style={{ cursor: guiding ? "default" : "grab", touchAction: "none" }}
        id="proactive-orb-anchor"
      >
        {/* Interaction Panel */}
        <AnimatePresence>
          {showPanel && (
            <motion.div
              data-orb-panel
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="w-72 sm:w-80 rounded-2xl border border-gray-200/60 bg-white/95 backdrop-blur-xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Panel Header */}
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <VisualSoul state={aiState} personality={personality} size="sm" className="!w-6 !h-6" />
                  <span className="text-sm font-semibold text-gray-800">
                    {panelView === "chat" ? "聊聊天" : panelView === "inspiration" ? "靈感推薦" : "你的創作夥伴"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {panelView !== "main" && (
                    <button
                      onClick={() => setPanelView("main")}
                      className="p-1 rounded-full hover:bg-gray-100 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  )}
                  <button
                    onClick={() => setShowPanel(false)}
                    className="p-1 rounded-full hover:bg-gray-100 transition-colors"
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
                    {/* Greeting */}
                    <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                      {greeting}
                    </p>

                    {/* Quick Actions */}
                    <div className="space-y-1.5 mb-3">
                      {QUICK_ACTIONS.map((qa) => (
                        <button
                          key={qa.action}
                          onClick={() => handleQuickAction(qa.action)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors text-left group"
                        >
                          <div className={`p-1.5 rounded-lg ${personalityAccent[personality]} transition-colors`}>
                            {qa.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-700">{qa.label}</p>
                            <p className="text-xs text-gray-400 truncate">{qa.description}</p>
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Inspiration Button */}
                    <button
                      onClick={() => setPanelView("inspiration")}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-amber-50 to-pink-50 border border-amber-200/40 hover:from-amber-100 hover:to-pink-100 transition-all text-sm font-medium text-amber-700"
                    >
                      <Lightbulb className="w-4 h-4" />
                      瀏覽靈感推薦
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
                    <div className="px-4 py-2 max-h-48 overflow-y-auto space-y-2">
                      {chatMessages.map((msg, i) => (
                        <div
                          key={i}
                          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${
                              msg.role === "user"
                                ? `${personalityAccentBtn[personality]} rounded-br-md`
                                : "bg-gray-100 text-gray-700 rounded-bl-md"
                            }`}
                          >
                            {msg.text}
                          </div>
                        </div>
                      ))}
                      <div ref={chatEndRef} />
                    </div>

                    {/* Chat Input */}
                    <div className="px-3 py-3 border-t border-gray-100">
                      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleChatSend();
                            }
                          }}
                          placeholder="說說你的心情..."
                          className="bg-transparent text-sm text-gray-700 placeholder:text-gray-400 outline-none flex-1 min-w-0"
                          autoFocus
                        />
                        <button
                          onClick={handleChatSend}
                          disabled={!chatInput.trim()}
                          className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-30"
                        >
                          <Send className="w-3.5 h-3.5 text-gray-500" />
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
                      {INSPIRATION_PRESETS.map((preset) => (
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
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>

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
                    {isFeedback ? "完成" : isGuideMsg ? "引導中" : personalityLabels[personality]}
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
                    onClick={(e) => { e.stopPropagation(); dismissProactive(); }}
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
          title={guiding ? "引導中..." : "點擊我開啟互動面板"}
          onClick={(e) => {
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

          {/* Neon glow ring */}
          <motion.div
            className="absolute inset-0 rounded-full"
            animate={{
              boxShadow: guiding
                ? [
                    `0 0 20px ${personalityGlowColors[personality]}, 0 0 50px ${personalityGlowColors[personality].replace("0.8", "0.5")}`,
                    `0 0 30px ${personalityGlowColors[personality]}, 0 0 70px ${personalityGlowColors[personality].replace("0.8", "0.7")}`,
                    `0 0 20px ${personalityGlowColors[personality]}, 0 0 50px ${personalityGlowColors[personality].replace("0.8", "0.5")}`,
                  ]
                : showPanel
                ? [`0 0 25px ${personalityGlowColors[personality]}, 0 0 50px ${personalityGlowColors[personality].replace("0.8", "0.5")}`]
                : [
                    `0 0 12px ${personalityGlowColors[personality]}, 0 0 24px ${personalityGlowColors[personality].replace("0.8", "0.3")}`,
                    `0 0 20px ${personalityGlowColors[personality]}, 0 0 40px ${personalityGlowColors[personality].replace("0.8", "0.5")}`,
                    `0 0 12px ${personalityGlowColors[personality]}, 0 0 24px ${personalityGlowColors[personality].replace("0.8", "0.3")}`,
                  ],
            }}
            transition={{ duration: guiding ? 0.8 : 2, repeat: Infinity, ease: "easeInOut" }}
            style={{ margin: "-4px", borderRadius: "50%" }}
          />

          <VisualSoul
            state={guiding ? "thinking" : showPanel ? "generating" : aiState}
            personality={personality}
            size="md"
            className="!w-12 !h-12"
          />

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
        </motion.div>
      </motion.div>
    </div>
  );
}
