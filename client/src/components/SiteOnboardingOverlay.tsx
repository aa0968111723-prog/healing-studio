/**
 * SiteOnboardingOverlay.tsx
 *
 * 全站新手引導覆蓋層
 *
 * 功能：
 *  - Spotlight 聚焦目標元素（SVG 遮罩）
 *  - 帶光球 VisualSoul 裝飾的引導提示卡
 *  - 步驟指示、前後導覽、跳過按鈕
 *  - 中央模式（targetId = null）顯示全屏歡迎卡
 *  - 進度條動畫
 *  - 響應式（手機/桌面均可用）
 */

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ChevronRight,
  ChevronLeft,
  Heart,
  Sparkles,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useSiteOnboarding,
  type TourStep,
} from "@/contexts/SiteOnboardingContext";
import VisualSoul from "./VisualSoul";

// ─── Spotlight SVG Overlay ───────────────────────────────────────────────────

function SpotlightOverlay({ targetRect }: { targetRect: DOMRect | null }) {
  if (!targetRect) return null;

  const padding = 12;
  const x = targetRect.left - padding;
  const y = targetRect.top - padding;
  const w = targetRect.width + padding * 2;
  const h = targetRect.height + padding * 2;
  const r = 14;

  return (
    <svg
      className="fixed inset-0 w-full h-full z-[9990] pointer-events-none"
      aria-hidden="true"
    >
      <defs>
        <mask id="site-spotlight-mask">
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          <rect x={x} y={y} width={w} height={h} rx={r} ry={r} fill="black" />
        </mask>
      </defs>
      {/* Dark overlay */}
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        fill="rgba(0,0,0,0.62)"
        mask="url(#site-spotlight-mask)"
      />
      {/* Glow border */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={r}
        ry={r}
        fill="none"
        stroke="rgba(255,180,80,0.55)"
        strokeWidth="2"
      />
      {/* Pulse animation */}
      <rect
        x={x - 3}
        y={y - 3}
        width={w + 6}
        height={h + 6}
        rx={r + 3}
        ry={r + 3}
        fill="none"
        stroke="rgba(255,180,80,0.25)"
        strokeWidth="3"
      >
        <animate
          attributeName="opacity"
          values="0.2;0.7;0.2"
          dur="2.2s"
          repeatCount="indefinite"
        />
      </rect>
    </svg>
  );
}

// ─── Full-screen dark backdrop (no spotlight) ────────────────────────────────

function DarkBackdrop({ onClick }: { onClick: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[9990] bg-black/60 backdrop-blur-sm"
      onClick={onClick}
    />
  );
}

// ─── Tour Card (positioned near target or centred) ───────────────────────────

function TourCard({
  step,
  stepIndex,
  totalSteps,
  targetRect,
  viewport,
  onNext,
  onPrev,
  onSkip,
}: {
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  targetRect: DOMRect | null;
  viewport: { width: number; height: number };
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}) {
  const isCentered = step.position === "center" || !targetRect;
  const isLastStep = stepIndex === totalSteps - 1;
  const isMobile = viewport.width < 640;
  const isTablet = viewport.width >= 640 && viewport.width < 1024;

  const cardW = Math.min(isMobile ? 460 : 380, viewport.width - (isMobile ? 20 : 32));
  const cardH = isMobile ? 360 : isTablet ? 320 : 300;
  const gap = 18;

  // Position logic for anchored cards
  function computeStyle(): React.CSSProperties {
    if (isCentered || !targetRect) {
      if (isMobile) {
        return {
          position: "fixed",
          left: "50%",
          bottom: 10,
          transform: "translateX(-50%)",
          width: cardW,
          maxWidth: "calc(100vw - 20px)",
          maxHeight: Math.max(280, viewport.height - 20),
        };
      }
      return {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: cardW,
        maxWidth: "calc(100vw - 32px)",
      };
    }

    let top = 0;
    let left = 0;
    const pos = step.position ?? "bottom";

    switch (pos) {
      case "bottom":
        top = targetRect.bottom + gap;
        left = targetRect.left + targetRect.width / 2 - cardW / 2;
        break;
      case "top":
        top = targetRect.top - cardH - gap;
        left = targetRect.left + targetRect.width / 2 - cardW / 2;
        break;
      case "left":
        top = targetRect.top + targetRect.height / 2 - cardH / 2;
        left = targetRect.left - cardW - gap;
        break;
      case "right":
        top = targetRect.top + targetRect.height / 2 - cardH / 2;
        left = targetRect.right + gap;
        break;
    }

    // Clamp to viewport
    left = Math.max(16, Math.min(viewport.width - cardW - 16, left));
    top = Math.max(16, Math.min(viewport.height - cardH - 16, top));

    if (isMobile) {
      return {
        position: "fixed",
        left: "50%",
        bottom: 10,
        transform: "translateX(-50%)",
        width: cardW,
        maxWidth: "calc(100vw - 20px)",
        maxHeight: Math.max(280, viewport.height - 20),
      };
    }

    return { position: "fixed", top, left, width: cardW };
  }

  const style = computeStyle();

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.93, y: isCentered ? 0 : 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.93, y: isCentered ? 0 : 10 }}
      transition={{ type: "spring", stiffness: 280, damping: 24 }}
      className="z-[9999] pointer-events-auto"
      style={style}
    >
      <div className="rounded-3xl border border-amber-200/40 bg-card/97 backdrop-blur-2xl shadow-2xl shadow-amber-500/15 overflow-hidden max-h-[calc(100vh-20px)] sm:max-h-none flex flex-col">
        {/* Top accent bar */}
        <div className="h-1 bg-gradient-to-r from-amber-400 via-orange-400 to-pink-400" />

        <div className="p-4 sm:p-5 overflow-y-auto">
          {/* Header row */}
          <div className="flex items-start gap-3 mb-3">
            {/* VisualSoul orb */}
            <div className="shrink-0 mt-0.5">
              <VisualSoul state="thinking" personality="creative" size="sm" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {step.icon && (
                    <span className="text-lg leading-none">{step.icon}</span>
                  )}
                  <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                    {stepIndex + 1} / {totalSteps}
                  </span>
                </div>
                <button
                  onClick={onSkip}
                  className="p-1 rounded-full hover:bg-muted transition-colors text-muted-foreground/70 hover:text-foreground"
                  aria-label="跳過引導"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <h3 className="text-sm sm:text-base font-bold text-foreground mt-1.5">
                {step.title}
              </h3>
            </div>
          </div>

          {/* Description */}
          <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed mb-3 whitespace-pre-line">
            {step.description}
          </p>

          {/* Tip */}
          {step.tip && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50/80 border border-amber-100 mb-4">
              <Heart className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-[11px] sm:text-xs text-amber-700 leading-relaxed italic">
                {step.tip}
              </p>
            </div>
          )}

          {/* Progress dots + Navigation */}
          <div className="flex items-center justify-between mt-1 gap-2">
            {/* Progress dots */}
            <div className="flex gap-1.5">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <motion.div
                  key={i}
                  animate={{
                    scale: i === stepIndex ? 1.25 : 1,
                    backgroundColor:
                      i === stepIndex
                        ? "rgb(251,146,60)"
                        : i < stepIndex
                          ? "rgba(251,146,60,0.45)"
                          : "rgba(0,0,0,0.10)",
                  }}
                  className="w-2 h-2 rounded-full"
                />
              ))}
            </div>

            {/* Navigation buttons */}
            <div className="flex gap-1.5 sm:gap-2">
              {stepIndex > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onPrev}
                  className="text-[11px] sm:text-xs h-8 px-2.5 sm:px-3 gap-1 text-muted-foreground rounded-full"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  上一步
                </Button>
              )}
                <Button
                size="sm"
                onClick={onNext}
                className="text-[11px] sm:text-xs h-8 px-3.5 sm:px-5 gap-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white rounded-full shadow-md shadow-amber-500/25 border-0"
              >
                {isLastStep ? (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    開始探索
                  </>
                ) : (
                  <>
                    下一步
                    <ChevronRight className="w-3.5 h-3.5" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Bottom skip link */}
        <div className="px-5 pb-4 -mt-1">
          <button
            onClick={onSkip}
            className="text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            跳過引導
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main SiteOnboardingOverlay ──────────────────────────────────────────────

export default function SiteOnboardingOverlay() {
  const {
    isActive,
    currentStepData,
    currentStep,
    totalSteps,
    nextStep,
    prevStep,
    stopTour,
  } = useSiteOnboarding();

  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  // Track target element rect
  useEffect(() => {
    if (!isActive || !currentStepData) {
      setTargetRect(null);
      return;
    }

    const targetId = currentStepData.targetId;
    if (!targetId) {
      setTargetRect(null);
      return;
    }

    const updateRect = () => {
      const el = document.getElementById(targetId);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
      } else {
        setTargetRect(null);
      }
    };

    // Scroll into view once on step change, then only track position
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTargetRect(el.getBoundingClientRect());
    } else {
      setTargetRect(null);
    }

    // Poll to handle dynamic layouts
    const interval = setInterval(updateRect, 600);
    window.addEventListener("resize", updateRect);

    // Throttled scroll handler: update spotlight position only, no scrollIntoView
    let scrollThrottle: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (scrollThrottle) return;
      scrollThrottle = setTimeout(() => {
        updateRect();
        scrollThrottle = null;
      }, 100);
    };
    window.addEventListener("scroll", onScroll, true);

    return () => {
      clearInterval(interval);
      if (scrollThrottle) clearTimeout(scrollThrottle);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [isActive, currentStepData]);

  // Keep viewport in sync for responsive card sizing (e.g., phone rotation)
  useEffect(() => {
    if (!isActive) return;

    const updateViewport = () => {
      const vv = window.visualViewport;
      setViewport({
        width: Math.round(vv?.width ?? window.innerWidth),
        height: Math.round(vv?.height ?? window.innerHeight),
      });
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    window.visualViewport?.addEventListener("resize", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
      window.visualViewport?.removeEventListener("resize", updateViewport);
    };
  }, [isActive]);

  // Keyboard navigation
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") stopTour();
      if (e.key === "ArrowRight" || e.key === "Enter") nextStep();
      if (e.key === "ArrowLeft") prevStep();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isActive, nextStep, prevStep, stopTour]);

  if (!isActive || !currentStepData) return null;

  const isCentered =
    currentStepData.position === "center" || !currentStepData.targetId;

  return (
    <>
      {/* Overlay */}
      {isCentered || !targetRect ? (
        <DarkBackdrop onClick={() => {}} />
      ) : (
        <SpotlightOverlay targetRect={targetRect} />
      )}

      {/* Tour card */}
      <AnimatePresence mode="wait">
        <TourCard
          key={`${currentStep}-${currentStepData.targetId}`}
          step={currentStepData}
          stepIndex={currentStep}
          totalSteps={totalSteps}
          targetRect={isCentered ? null : targetRect}
          viewport={viewport}
          onNext={nextStep}
          onPrev={prevStep}
          onSkip={stopTour}
        />
      </AnimatePresence>
    </>
  );
}

// ─── ResetAllToursButton (for Settings page) ─────────────────────────────────

export function ResetAllToursButton() {
  const { resetAllTours, startTour } = useSiteOnboarding();

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-2 text-xs"
      onClick={() => {
        resetAllTours();
        setTimeout(() => startTour("welcome", true), 200);
      }}
    >
      <BookOpen className="w-3.5 h-3.5" />
      重置全部導覽狀態
    </Button>
  );
}
