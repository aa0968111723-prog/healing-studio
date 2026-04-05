import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, ChevronLeft, Sparkles, RotateCcw, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Tour Step Definition ──────────────────────────────────────────────────

interface TourStep {
  targetId: string;
  title: string;
  description: string;
  encouragement: string; // warm micro-copy shown after description
  position: "top" | "bottom" | "left" | "right";
  fallbackPosition?: "top" | "bottom" | "left" | "right";
}

const TOUR_STEPS: TourStep[] = [
  {
    targetId: "prompt-builder-area",
    title: "靈感積木",
    description:
      "每個積木都是一片拼圖。不需要想太多，隨手點幾個喜歡的詞彙，AI 會幫你組合成完整的畫面。",
    encouragement: "沒有對錯，跟著直覺走就好。",
    position: "bottom",
  },
  {
    targetId: "modality-tabs",
    title: "創作模態",
    description:
      "除了圖片，你還可以生成影片、音樂和語音。每種模態都有專屬的靈感積木，試試切換看看。",
    encouragement: "多嘗試不同模態，會有意想不到的驚喜。",
    position: "bottom",
  },
  {
    targetId: "generate-button",
    title: "開始創作",
    description:
      "選好積木後，按下這個按鈕就能生成作品。第一次不用追求完美，先感受一下創作的樂趣。",
    encouragement: "每一次嘗試都是獨一無二的。",
    position: "top",
  },
  {
    targetId: "proactive-orb-anchor",
    title: "你的創作夥伴",
    description:
      "我是你的 AI 助理光球。點擊我可以獲得靈感推薦、隨機創作建議，或者只是聊聊今天的心情。",
    encouragement: "隨時點我，我都在這裡陪你。",
    position: "left",
    fallbackPosition: "top",
  },
];

const STORAGE_KEY = "hasSeenTour";

// ─── Spotlight Overlay ─────────────────────────────────────────────────────

function SpotlightOverlay({
  targetRect,
  padding = 16,
}: {
  targetRect: DOMRect | null;
  padding?: number;
}) {
  if (!targetRect) return null;

  const x = targetRect.left - padding;
  const y = targetRect.top - padding;
  const w = targetRect.width + padding * 2;
  const h = targetRect.height + padding * 2;
  const r = 16;

  return (
    <svg
      className="fixed inset-0 w-full h-full z-[9998] pointer-events-auto"
      style={{ mixBlendMode: "normal" }}
    >
      <defs>
        <mask id="spotlight-mask">
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          <rect x={x} y={y} width={w} height={h} rx={r} ry={r} fill="black" />
        </mask>
      </defs>
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        fill="rgba(0,0,0,0.6)"
        mask="url(#spotlight-mask)"
      />
      {/* Soft glow border */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={r}
        ry={r}
        fill="none"
        stroke="rgba(255,180,120,0.5)"
        strokeWidth="2"
      />
      {/* Animated breathing glow */}
      <rect
        x={x - 2}
        y={y - 2}
        width={w + 4}
        height={h + 4}
        rx={r + 2}
        ry={r + 2}
        fill="none"
        stroke="rgba(255,180,120,0.2)"
        strokeWidth="3"
      >
        <animate
          attributeName="opacity"
          values="0.3;0.8;0.3"
          dur="2s"
          repeatCount="indefinite"
        />
      </rect>
    </svg>
  );
}

// ─── Tooltip Card ──────────────────────────────────────────────────────────

function TooltipCard({
  step,
  stepIndex,
  totalSteps,
  targetRect,
  onNext,
  onPrev,
  onSkip,
}: {
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  targetRect: DOMRect | null;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}) {
  if (!targetRect) return null;

  const tooltipW = Math.min(340, window.innerWidth - 32);
  const tooltipH = 220;
  const gap = 16;

  // Try preferred position first, then fallback
  function calcPosition(pos: string) {
    let top = 0;
    let left = 0;
    switch (pos) {
      case "bottom":
        top = targetRect!.bottom + gap;
        left = targetRect!.left + targetRect!.width / 2 - tooltipW / 2;
        break;
      case "top":
        top = targetRect!.top - tooltipH - gap;
        left = targetRect!.left + targetRect!.width / 2 - tooltipW / 2;
        break;
      case "left":
        top = targetRect!.top + targetRect!.height / 2 - tooltipH / 2;
        left = targetRect!.left - tooltipW - gap;
        break;
      case "right":
        top = targetRect!.top + targetRect!.height / 2 - tooltipH / 2;
        left = targetRect!.right + gap;
        break;
    }
    return { top, left };
  }

  let { top, left } = calcPosition(step.position);

  // If out of viewport, try fallback
  if (
    (top < 16 || top + tooltipH > window.innerHeight - 16 ||
      left < 16 || left + tooltipW > window.innerWidth - 16) &&
    step.fallbackPosition
  ) {
    ({ top, left } = calcPosition(step.fallbackPosition));
  }

  // Final clamp
  left = Math.max(16, Math.min(window.innerWidth - tooltipW - 16, left));
  top = Math.max(16, Math.min(window.innerHeight - tooltipH - 16, top));

  const isLastStep = stepIndex === totalSteps - 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      className="fixed z-[9999] pointer-events-auto"
      style={{ top, left, width: tooltipW }}
    >
      <div className="rounded-2xl border border-amber-200/40 bg-white/95 backdrop-blur-xl shadow-2xl shadow-amber-500/10 p-5">
        {/* Step indicator */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-semibold text-amber-600">
              {stepIndex + 1} / {totalSteps}
            </span>
          </div>
          <button
            onClick={onSkip}
            className="p-1 rounded-full hover:bg-gray-100 transition-colors"
          >
            <X className="w-3.5 h-3.5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <h3 className="text-base font-semibold text-gray-800 mb-2">{step.title}</h3>
        <p className="text-sm text-gray-600 leading-relaxed mb-2">
          {step.description}
        </p>
        <p className="text-xs text-amber-600/80 italic flex items-center gap-1.5 mb-4">
          <Heart className="w-3 h-3 shrink-0" />
          {step.encouragement}
        </p>

        {/* Progress + Navigation */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <motion.div
                key={i}
                animate={{
                  scale: i === stepIndex ? 1.2 : 1,
                  backgroundColor:
                    i === stepIndex
                      ? "rgb(245, 158, 11)"
                      : i < stepIndex
                      ? "rgba(245, 158, 11, 0.4)"
                      : "rgba(0, 0, 0, 0.08)",
                }}
                className="w-2 h-2 rounded-full"
              />
            ))}
          </div>

          <div className="flex gap-2">
            {stepIndex > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onPrev}
                className="text-xs h-7 px-2 gap-1 text-gray-500"
              >
                <ChevronLeft className="w-3 h-3" />
                上一步
              </Button>
            )}
            <Button
              size="sm"
              onClick={onNext}
              className="text-xs h-7 px-4 gap-1 bg-amber-500 hover:bg-amber-400 text-white rounded-full shadow-md shadow-amber-500/20"
            >
              {isLastStep ? "開始創作" : "下一步"}
              {!isLastStep && <ChevronRight className="w-3 h-3" />}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main OnboardingTour Component ─────────────────────────────────────────

export default function OnboardingTour({
  forceStart = false,
  onComplete,
}: {
  forceStart?: boolean;
  onComplete?: () => void;
}) {
  const [active, setActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  // Check if tour should start
  useEffect(() => {
    if (forceStart) {
      setActive(true);
      setCurrentStep(0);
      return;
    }

    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        const timer = setTimeout(() => setActive(true), 1500);
        return () => clearTimeout(timer);
      }
    } catch { /* ignore */ }
  }, [forceStart]);

  // Listen for restart-tour event
  useEffect(() => {
    const handler = () => {
      setActive(true);
      setCurrentStep(0);
    };
    window.addEventListener("restart-tour", handler);
    return () => window.removeEventListener("restart-tour", handler);
  }, []);

  // Track target element position
  useEffect(() => {
    if (!active) return;

    const step = TOUR_STEPS[currentStep];
    if (!step) return;

    const updateRect = () => {
      const el = document.getElementById(step.targetId);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        setTargetRect(null);
      }
    };

    updateRect();

    const interval = setInterval(updateRect, 500);
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      clearInterval(interval);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [active, currentStep]);

  const completeTour = useCallback(() => {
    setActive(false);
    setCurrentStep(0);
    setTargetRect(null);
    try { localStorage.setItem(STORAGE_KEY, "true"); } catch { /* ignore */ }
    onComplete?.();
  }, [onComplete]);

  const handleNext = useCallback(() => {
    if (currentStep >= TOUR_STEPS.length - 1) {
      completeTour();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  }, [currentStep, completeTour]);

  const handlePrev = useCallback(() => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  }, []);

  const handleSkip = useCallback(() => {
    completeTour();
  }, [completeTour]);

  if (!active) return null;

  const step = TOUR_STEPS[currentStep];
  if (!step) return null;

  return (
    <>
      <SpotlightOverlay targetRect={targetRect} />
      <AnimatePresence mode="wait">
        <TooltipCard
          key={currentStep}
          step={step}
          stepIndex={currentStep}
          totalSteps={TOUR_STEPS.length}
          targetRect={targetRect}
          onNext={handleNext}
          onPrev={handlePrev}
          onSkip={handleSkip}
        />
      </AnimatePresence>
    </>
  );
}

// ─── Restart Tour Button (for Settings page) ──────────────────────────────

export function RestartTourButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-2 text-xs"
      onClick={() => {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
        window.dispatchEvent(new CustomEvent("restart-tour"));
      }}
    >
      <RotateCcw className="w-3.5 h-3.5" />
      重新導覽
    </Button>
  );
}
