import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, type PanInfo, useAnimation } from "framer-motion";
import { useAIState } from "@/contexts/AIStateContext";
import VisualSoul from "./VisualSoul";
import { X, Sparkles } from "lucide-react";

type Props = {
  className?: string;
  /** Enable the 90-second guided onboarding for first-time users */
  enableOnboarding?: boolean;
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

// ─── Component ────────────────────────────────────────────────────────────

export default function ProactiveOrbWidget({ className = "", enableOnboarding = true }: Props) {
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

  // Home position (bottom-right anchor offset)
  const homePositionRef = useRef(position);

  // ─── guideTo method ───────────────────────────────────────────────────

  const guideTo = useCallback(async (elementId: string, message: string) => {
    if (abortRef.current) return;

    const el = document.getElementById(elementId);
    if (!el) {
      // Element not found — skip this step silently
      return;
    }

    setGuiding(true);
    setGuideMessage(message);

    // Get target element position
    const rect = el.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    // Calculate offset from the orb's default bottom-right anchor
    // The orb sits at bottom:24px right:24px by default, so we need to compute
    // the delta from that anchor to the target element's left edge (with a small gap)
    const orbAnchorX = viewportW - 24 - 24; // right:24px + half orb width ~24px
    const orbAnchorY = viewportH - 24 - 24; // bottom:24px + half orb height ~24px

    const targetX = rect.left - 60; // 60px to the left of the element
    const targetY = rect.top + rect.height / 2 - 24; // vertically centered

    const deltaX = targetX - orbAnchorX;
    const deltaY = targetY - orbAnchorY;

    // Animate orb to target position
    await orbControls.start({
      x: deltaX,
      y: deltaY,
      transition: {
        duration: 0.8,
        ease: GUIDE_EASE,
      },
    });

    if (abortRef.current) return;

    // Triple pulse flash animation
    for (let i = 0; i < 3; i++) {
      if (abortRef.current) break;
      await orbControls.start({
        scale: 1.3,
        transition: { duration: 0.15 },
      });
      await orbControls.start({
        scale: 1,
        transition: { duration: 0.15 },
      });
    }

    if (abortRef.current) return;

    // Highlight the target element briefly
    el.style.transition = "box-shadow 0.3s ease, outline 0.3s ease";
    el.style.outline = "2px solid rgba(0,210,255,0.6)";
    el.style.boxShadow = "0 0 20px rgba(0,210,255,0.3)";

    // Hold for 1.5 seconds
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1500);
      onboardingTimerRef.current.push(timer);
    });

    if (abortRef.current) return;

    // Remove highlight
    el.style.outline = "";
    el.style.boxShadow = "";

    // Fade back to home position
    setGuideMessage(null);
    await orbControls.start({
      x: homePositionRef.current.x,
      y: homePositionRef.current.y,
      scale: 1,
      transition: {
        duration: 0.6,
        ease: GUIDE_EASE,
      },
    });

    setGuiding(false);
  }, [orbControls]);

  // ─── 90-second onboarding sequence ────────────────────────────────────

  useEffect(() => {
    if (!enableOnboarding || isOnboarded()) return;

    // Small delay to let the page render and elements mount
    const startDelay = setTimeout(() => {
      setOnboardingActive(true);
      abortRef.current = false;

      const runSequence = async () => {
        for (const step of ONBOARDING_STEPS) {
          if (abortRef.current) break;

          // Wait until the step's start time
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

        // Onboarding complete
        if (!abortRef.current) {
          markOnboarded();
          setOnboardingActive(false);
        }
      };

      const sequenceStart = performance.now();
      runSequence();
    }, 2000); // 2s initial delay for page to settle

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

    // Return orb to home
    orbControls.start({
      x: homePositionRef.current.x,
      y: homePositionRef.current.y,
      scale: 1,
      transition: { duration: 0.4 },
    });
  }, [orbControls]);

  // ─── Drag handlers ────────────────────────────────────────────────────

  function handleDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    if (guiding) return; // Don't allow drag during guided animation

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

  // ─── Personality theme maps ───────────────────────────────────────────

  const personalityLabels = {
    calm: "沉穩模式",
    creative: "創意模式",
    technical: "技術模式",
  };

  const personalityBubbleColors = {
    calm: "border-cyan-400/40 bg-cyan-950/80 shadow-cyan-400/20",
    creative: "border-pink-400/40 bg-pink-950/80 shadow-pink-400/20",
    technical: "border-emerald-400/40 bg-emerald-950/80 shadow-emerald-400/20",
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
                  <p className="text-xs font-medium text-foreground/90 mb-1">
                    {isGuideMsg ? "引導中" : personalityLabels[personality]}
                  </p>
                  <p className="text-sm text-foreground/80 leading-relaxed font-medium">
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

        {/* Floating orb with neon glow */}
        <motion.div
          animate={orbControls}
          whileHover={guiding ? undefined : { scale: 1.1 }}
          whileTap={guiding ? undefined : { scale: 0.95 }}
          className="relative"
          title={guiding ? "引導中..." : `AI Director - ${personalityLabels[personality]} (可拖曳)`}
        >
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
