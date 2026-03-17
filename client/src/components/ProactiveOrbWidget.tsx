import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, type PanInfo, useAnimation } from "framer-motion";
import { useAIState } from "@/contexts/AIStateContext";
import VisualSoul from "./VisualSoul";
import { X, Sparkles, StickyNote, CalendarDays, MessageCircle, Send } from "lucide-react";

type Props = {
  className?: string;
  /** Enable the 90-second guided onboarding for first-time users */
  enableOnboarding?: boolean;
  /** Callback: save payload to notes context */
  onSaveToNotes?: (payload: { title: string; content?: string; sourceType?: string }) => void;
  /** Callback: add event to calendar */
  onAddToCalendar?: (payload: { title: string; description?: string; date: Date }) => void;
  /** Callback: open notes drawer */
  onOpenNotes?: () => void;
  /** Callback: open calendar */
  onOpenCalendar?: () => void;
  /** Callback: restart onboarding tour */
  onRestartTour?: () => void;
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

// ─── 90-second onboarding step definitions ────────────────────────────────

interface OnboardingStep {
  elementId: string;
  message: string;
  startSec: number;
  endSec: number;
}

const ONBOARDING_STEPS: OnboardingStep[] = [
  { elementId: "prompt-input",        message: "試著描述你想創作的畫面",          startSec: 0,  endSec: 15 },
  { elementId: "personality-selector", message: "選擇你的導演風格",               startSec: 15, endSec: 35 },
  { elementId: "generate-button",     message: "點擊生成你的第一個場景",          startSec: 35, endSec: 60 },
  { elementId: "storyboard-panel",    message: "腳本完成！可一鍵發送到工作室",    startSec: 60, endSec: 90 },
];

// ─── Custom easing matching the spec ──────────────────────────────────────

const GUIDE_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

// ─── Natural language date parser (simple) ────────────────────────────────

function parseNaturalDate(text: string): Date | null {
  const now = new Date();
  const lower = text.toLowerCase();

  if (lower.includes("明天")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (lower.includes("後天")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    return d;
  }
  if (lower.includes("下週一") || lower.includes("下周一")) {
    const d = new Date(now);
    const dayOfWeek = d.getDay();
    const daysUntilNextMonday = ((1 - dayOfWeek + 7) % 7) || 7;
    d.setDate(d.getDate() + daysUntilNextMonday);
    return d;
  }
  if (lower.includes("下週五") || lower.includes("下周五")) {
    const d = new Date(now);
    const dayOfWeek = d.getDay();
    const daysUntilNextFriday = ((5 - dayOfWeek + 7) % 7) || 7;
    d.setDate(d.getDate() + daysUntilNextFriday);
    return d;
  }
  if (lower.includes("下週") || lower.includes("下周")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return d;
  }

  // Try to match "X天後" or "X日後"
  const daysMatch = text.match(/(\d+)\s*(天|日)後/);
  if (daysMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + parseInt(daysMatch[1]));
    return d;
  }

  return null;
}

// ─── Command handler ──────────────────────────────────────────────────────

type OrbCommand = {
  type: "notes" | "calendar" | "tour" | "unknown";
  payload?: any;
};

function parseOrbCommand(text: string): OrbCommand {
  const lower = text.toLowerCase();

  // Notes commands
  if (lower.includes("筆記") || lower.includes("記錄") || lower.includes("釘選") || lower.includes("note")) {
    return { type: "notes", payload: { content: text } };
  }

  // Calendar commands
  if (lower.includes("排程") || lower.includes("日曆") || lower.includes("行事曆") || lower.includes("schedule") || lower.includes("calendar")) {
    const date = parseNaturalDate(text);
    return { type: "calendar", payload: { date, text } };
  }

  // Tour commands
  if (lower.includes("導覽") || lower.includes("引導") || lower.includes("教學") || lower.includes("tour")) {
    return { type: "tour" };
  }

  return { type: "unknown" };
}

// ─── Component ────────────────────────────────────────────────────────────

export default function ProactiveOrbWidget({
  className = "",
  enableOnboarding = true,
  onSaveToNotes,
  onAddToCalendar,
  onOpenNotes,
  onOpenCalendar,
  onRestartTour,
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

  // Command input state
  const [showCommandInput, setShowCommandInput] = useState(false);
  const [commandText, setCommandText] = useState("");

  // Home position (bottom-right anchor offset)
  const homePositionRef = useRef(position);

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

    for (let i = 0; i < 3; i++) {
      if (abortRef.current) break;
      await orbControls.start({ scale: 1.3, transition: { duration: 0.15 } });
      await orbControls.start({ scale: 1, transition: { duration: 0.15 } });
    }

    if (abortRef.current) return;

    el.style.transition = "box-shadow 0.3s ease, outline 0.3s ease";
    el.style.outline = "2px solid rgba(0,210,255,0.6)";
    el.style.boxShadow = "0 0 20px rgba(0,210,255,0.3)";

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

  function handleDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    if (guiding) return;

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

  // ─── Drop zone handlers (HTML5 native drag) ──────────────────────────

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
      try {
        data = JSON.parse(raw);
      } catch {
        data = { text: raw };
      }

      // Flash the orb with personality color
      setDropFlash(personality);
      setTimeout(() => setDropFlash(null), 800);

      // Determine action based on payload
      if (data.noteId || data.type === "note") {
        onSaveToNotes?.({
          title: data.title || "拖曳筆記",
          content: data.content || data.text || "",
          sourceType: "orb",
        });
        setGuideMessage("已擷取至筆記 ✓");
        setTimeout(() => setGuideMessage(null), 2000);
      } else if (data.prompt || data.resultUrl) {
        onSaveToNotes?.({
          title: data.prompt?.slice(0, 30) || "生成結果",
          content: `提示詞：${data.prompt || ""}\n結果：${data.resultUrl || ""}`,
          sourceType: "orb",
        });
        setGuideMessage("已擷取生成結果至筆記 ✓");
        setTimeout(() => setGuideMessage(null), 2000);
      } else if (data.thoughtNode) {
        onSaveToNotes?.({
          title: `思維節點：${data.thoughtNode.label || ""}`,
          content: data.thoughtNode.detail || "",
          sourceType: "orb",
        });
        setGuideMessage("已擷取思維節點至筆記 ✓");
        setTimeout(() => setGuideMessage(null), 2000);
      } else {
        onSaveToNotes?.({
          title: "拖曳內容",
          content: typeof data === "string" ? data : JSON.stringify(data),
          sourceType: "orb",
        });
        setGuideMessage("已擷取元素 ✓");
        setTimeout(() => setGuideMessage(null), 2000);
      }
    } catch {
      setGuideMessage("無法解析拖曳內容");
      setTimeout(() => setGuideMessage(null), 2000);
    }
  }, [personality, onSaveToNotes]);

  // ─── Command input handler ────────────────────────────────────────────

  const handleCommand = useCallback(() => {
    if (!commandText.trim()) return;

    const cmd = parseOrbCommand(commandText);

    switch (cmd.type) {
      case "notes":
        onOpenNotes?.();
        setGuideMessage("已開啟筆記面板");
        break;
      case "calendar":
        if (cmd.payload?.date) {
          onAddToCalendar?.({
            title: commandText.replace(/排程|日曆|行事曆|到|schedule|calendar/gi, "").trim() || "新排程",
            date: cmd.payload.date,
          });
          setGuideMessage(`已排程至 ${cmd.payload.date.toLocaleDateString("zh-TW")}`);
        } else {
          onOpenCalendar?.();
          setGuideMessage("已開啟日曆");
        }
        break;
      case "tour":
        onRestartTour?.();
        setGuideMessage("重新啟動導覽...");
        break;
      default:
        setGuideMessage("試試輸入「筆記」、「排程到下週五」或「導覽」");
        break;
    }

    setCommandText("");
    setShowCommandInput(false);
    setTimeout(() => setGuideMessage(null), 3000);
  }, [commandText, onOpenNotes, onOpenCalendar, onAddToCalendar, onRestartTour]);

  // ─── Personality theme maps ───────────────────────────────────────────

  const personalityLabels = {
    calm: "沉穩模式",
    creative: "創意模式",
    technical: "技術模式",
  };

  const personalityBubbleColors = {
    calm: "border-cyan-300/50 bg-white/85 shadow-cyan-200/30",
    creative: "border-pink-300/50 bg-white/85 shadow-pink-200/30",
    technical: "border-emerald-300/50 bg-white/85 shadow-emerald-200/30",
  };

  const personalityDotColors = {
    calm: "rgb(0,210,255)",
    creative: "rgb(255,80,180)",
    technical: "rgb(80,255,180)",
  };

  const personalityGlowColors = {
    calm: "rgba(0,210,255,0.8)",
    creative: "rgba(255,80,180,0.8)",
    technical: "rgba(80,255,180,0.8)",
  };

  const dropFlashColors: Record<string, string> = {
    calm: "rgba(0,210,255,0.6)",
    creative: "rgba(255,80,180,0.6)",
    technical: "rgba(80,255,180,0.6)",
  };

  // Determine which message to show: guide message takes priority over proactive
  const activeMessage = guideMessage || proactiveMessage;
  const isGuideMsg = !!guideMessage;

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
            className="pointer-events-auto fixed top-4 right-4 z-[60] flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-background/80 backdrop-blur-md border border-border/50 text-muted-foreground hover:text-foreground hover:bg-background transition-all shadow-lg"
          >
            <X className="w-3 h-3" />
            跳過引導
          </motion.button>
        )}
      </AnimatePresence>

      {/* Draggable orb container */}
      <motion.div
        drag={!guiding}
        dragElastic={0.1}
        dragMomentum={false}
        dragConstraints={{
          left: -(window.innerWidth * 0.9),
          right: 0,
          top: -(window.innerHeight * 0.9),
          bottom: 0,
        }}
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
      >
        {/* Message bubble (guide or proactive) */}
        <AnimatePresence mode="wait">
          {activeMessage && (
            <motion.div
              key={activeMessage}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className={`max-w-xs rounded-2xl border p-4 shadow-lg backdrop-blur-md ${personalityBubbleColors[personality]}`}
            >
              <div className="flex items-start gap-2">
                <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                <div className="flex-1">
                  <p className="text-xs font-medium text-gray-700 mb-1">
                    {isGuideMsg ? "引導中" : personalityLabels[personality]}
                  </p>
                  <p className="text-sm text-gray-800 leading-relaxed font-medium">
                    {activeMessage}
                  </p>
                  {isGuideMsg && onboardingActive && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex gap-1">
                        {ONBOARDING_STEPS.map((_, i) => (
                          <div
                            key={i}
                            className={`w-1.5 h-1.5 rounded-full transition-colors ${
                              guideMessage === ONBOARDING_STEPS[i]?.message
                                ? "bg-primary"
                                : "bg-foreground/20"
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {!isGuideMsg && (
                  <button
                    onClick={(e) => { e.stopPropagation(); dismissProactive(); }}
                    className="shrink-0 p-0.5 rounded-full hover:bg-foreground/10 transition-colors"
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Command input */}
        <AnimatePresence>
          {showCommandInput && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.9 }}
              className="flex items-center gap-2 rounded-2xl border border-gray-200/60 bg-white/90 backdrop-blur-xl px-3 py-2 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <MessageCircle className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                type="text"
                value={commandText}
                onChange={(e) => setCommandText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCommand(); if (e.key === "Escape") setShowCommandInput(false); }}
                placeholder="輸入指令...（筆記/排程/導覽）"
                className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none w-48"
                autoFocus
              />
              <button
                onClick={handleCommand}
                className="p-1 rounded-full hover:bg-accent/50 transition-colors"
              >
                <Send className="w-3.5 h-3.5 text-primary" />
              </button>
              <button
                onClick={() => setShowCommandInput(false)}
                className="p-1 rounded-full hover:bg-accent/50 transition-colors"
              >
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quick action buttons (visible on hover) */}
        <AnimatePresence>
          {!guiding && !showCommandInput && !activeMessage && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="flex gap-1.5 opacity-0 hover:opacity-100 transition-opacity"
            >
              <button
                onClick={(e) => { e.stopPropagation(); onOpenNotes?.(); }}
                className="p-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-white/10 hover:bg-cyan-500/20 transition-colors"
                title="開啟筆記"
              >
                <StickyNote className="w-3 h-3 text-cyan-400" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onOpenCalendar?.(); }}
                className="p-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-white/10 hover:bg-amber-500/20 transition-colors"
                title="開啟日曆"
              >
                <CalendarDays className="w-3 h-3 text-amber-400" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowCommandInput(true); }}
                className="p-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-white/10 hover:bg-purple-500/20 transition-colors"
                title="輸入指令"
              >
                <MessageCircle className="w-3 h-3 text-purple-400" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating orb with neon glow + drop zone */}
        <motion.div
          animate={orbControls}
          whileHover={guiding ? undefined : { scale: 1.1 }}
          whileTap={guiding ? undefined : { scale: 0.95 }}
          className="relative"
          title={guiding ? "引導中..." : `AI Director - ${personalityLabels[personality]} (可拖曳/接收元素)`}
          onDoubleClick={() => !guiding && setShowCommandInput(!showCommandInput)}
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
                className="absolute inset-0 rounded-full border-2 border-dashed border-cyan-400/60"
                style={{
                  boxShadow: `0 0 30px ${personalityGlowColors[personality]}, 0 0 60px ${personalityGlowColors[personality].replace("0.8", "0.4")}`,
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
                  background: `radial-gradient(circle, ${dropFlashColors[dropFlash] || "rgba(255,255,255,0.5)"} 0%, transparent 70%)`,
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
                : isDropTarget
                ? [
                    `0 0 25px ${personalityGlowColors[personality]}, 0 0 60px ${personalityGlowColors[personality].replace("0.8", "0.6")}`,
                    `0 0 35px ${personalityGlowColors[personality]}, 0 0 80px ${personalityGlowColors[personality].replace("0.8", "0.8")}`,
                    `0 0 25px ${personalityGlowColors[personality]}, 0 0 60px ${personalityGlowColors[personality].replace("0.8", "0.6")}`,
                  ]
                : [
                    `0 0 12px ${personalityGlowColors[personality]}, 0 0 24px ${personalityGlowColors[personality].replace("0.8", "0.3")}`,
                    `0 0 20px ${personalityGlowColors[personality]}, 0 0 40px ${personalityGlowColors[personality].replace("0.8", "0.5")}`,
                    `0 0 12px ${personalityGlowColors[personality]}, 0 0 24px ${personalityGlowColors[personality].replace("0.8", "0.3")}`,
                  ],
            }}
            transition={{ duration: guiding ? 0.8 : isDropTarget ? 0.5 : 2, repeat: Infinity, ease: "easeInOut" }}
            style={{ margin: "-4px", borderRadius: "50%" }}
          />

          <VisualSoul
            state={guiding ? "thinking" : aiState}
            personality={personality}
            size="md"
            className="!w-12 !h-12"
          />

          {/* Personality indicator dot */}
          <motion.div
            className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background"
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
