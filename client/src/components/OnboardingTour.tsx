import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, ChevronLeft, Sparkles, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Tour Step Definition ──────────────────────────────────────────────────

interface TourStep {
  targetId: string;
  title: string;
  description: string;
  position: "top" | "bottom" | "left" | "right";
}

const TOUR_STEPS: TourStep[] = [
  {
    targetId: "prompt-input",
    title: "視覺化積木",
    description: "歡迎來到治癒工作室！不知道從何開始？試著點擊這幾個積木組合你的靈感。",
    position: "bottom",
  },
  {
    targetId: "personality-selector",
    title: "自注意力滑桿",
    description: "點擊有顏色的單字，滑動調整權重，你來決定 AI 該看輕還是看重什麼。",
    position: "bottom",
  },
  {
    targetId: "generate-button",
    title: "AI 助理光球",
    description: "我是你的專屬 AI 助理。你可以把成品直接拖著丟給我，或叫我幫你排入日曆。",
    position: "top",
  },
  {
    targetId: "storyboard-panel",
    title: "側邊欄",
    description: "你的所有創作與靈感，都會被安全收納在資產庫與專案筆記中。",
    position: "right",
  },
];

const STORAGE_KEY = "hasSeenTour";

// ─── Spotlight Overlay ─────────────────────────────────────────────────────

function SpotlightOverlay({
  targetRect,
  padding = 12,
}: {
  targetRect: DOMRect | null;
  padding?: number;
}) {
  if (!targetRect) return null;

  const x = targetRect.left - padding;
  const y = targetRect.top - padding;
  const w = targetRect.width + padding * 2;
  const h = targetRect.height + padding * 2;
  const r = 12;

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
        fill="rgba(0,0,0,0.75)"
        mask="url(#spotlight-mask)"
      />
      {/* Animated border around spotlight */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={r}
        ry={r}
        fill="none"
        stroke="rgba(0,210,255,0.5)"
        strokeWidth="2"
        strokeDasharray="8 4"
      >
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="24"
          dur="1.5s"
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

  // Calculate tooltip position
  let top = 0;
  let left = 0;
  const tooltipW = 320;
  const tooltipH = 180;
  const gap = 16;

  switch (step.position) {
    case "bottom":
      top = targetRect.bottom + gap;
      left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
      break;
    case "top":
      top = targetRect.top - tooltipH - gap;
      left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
      break;
    case "left":
      top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
      left = targetRect.left - tooltipW - gap;
      break;
    case "right":
      top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
      left = targetRect.right + gap;
      break;
  }

  // Clamp to viewport
  left = Math.max(16, Math.min(window.innerWidth - tooltipW - 16, left));
  top = Math.max(16, Math.min(window.innerHeight - tooltipH - 16, top));

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className="fixed z-[9999] pointer-events-auto"
      style={{ top, left, width: tooltipW }}
    >
      <div className="rounded-2xl border border-cyan-500/30 bg-background/95 backdrop-blur-xl shadow-2xl shadow-cyan-500/10 p-5">
        {/* Step indicator */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-semibold text-cyan-400">
              步驟 {stepIndex + 1} / {totalSteps}
            </span>
          </div>
          <button
            onClick={onSkip}
            className="p-1 rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <h3 className="text-sm font-semibold text-foreground mb-2">{step.title}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-4">
          {step.description}
        </p>

        {/* Progress dots */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-all ${
                  i === stepIndex
                    ? "bg-cyan-400 scale-110"
                    : i < stepIndex
                    ? "bg-cyan-400/40"
                    : "bg-white/10"
                }`}
              />
            ))}
          </div>

          <div className="flex gap-2">
            {stepIndex > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onPrev}
                className="text-xs h-7 px-2 gap-1"
              >
                <ChevronLeft className="w-3 h-3" />
                上一步
              </Button>
            )}
            <Button
              size="sm"
              onClick={onNext}
              className="text-xs h-7 px-3 gap-1 bg-cyan-600 hover:bg-cyan-500 text-white"
            >
              {stepIndex === totalSteps - 1 ? "完成" : "下一步"}
              {stepIndex < totalSteps - 1 && <ChevronRight className="w-3 h-3" />}
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
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

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
        // Delay to let the page render
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
        // Scroll element into view if needed
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        setTargetRect(null);
      }
    };

    updateRect();

    // Re-measure on resize/scroll
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
