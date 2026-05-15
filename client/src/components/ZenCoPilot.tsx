import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ZEN_TOOLTIPS } from "@shared/types";
import { useIsMobile } from "@/hooks/useMobile";

// ─── Zen Co-Pilot Orb (replaces all mascots) ────────────────────────────────
// A minimalist glowing orb with breathing light effect.
// On hover over complex parameters, it expands into a frosted-glass tooltip.

export function ZenOrb({
  visible = true,
  size = "md",
}: {
  visible?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const sizeMap = { sm: "w-6 h-6", md: "w-10 h-10", lg: "w-14 h-14" };
  const glowMap = { sm: "8px", md: "16px", lg: "24px" };

  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`${sizeMap[size]} rounded-full relative`}
      style={{
        background:
          "radial-gradient(circle at 35% 35%, rgba(212, 197, 226, 0.8), rgba(200, 213, 224, 0.6), rgba(234, 201, 193, 0.4))",
        boxShadow: `0 0 ${glowMap[size]} rgba(212, 197, 226, 0.5), inset 0 0 ${glowMap[size]} rgba(255, 255, 255, 0.3)`,
      }}
    >
      <motion.div
        className="absolute inset-0 rounded-full"
        animate={{
          boxShadow: [
            "0 0 12px rgba(212, 197, 226, 0.3)",
            "0 0 24px rgba(212, 197, 226, 0.6)",
            "0 0 12px rgba(212, 197, 226, 0.3)",
          ],
        }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />
    </motion.div>
  );
}

// ─── Zen Tooltip (frosted glass, expands from orb) ──────────────────────────

export function ZenTooltip({
  tooltipKey,
  children,
}: {
  tooltipKey: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isTouchOpen, setIsTouchOpen] = useState(false);
  const isMobile = useIsMobile();
  const ref = useRef<HTMLDivElement>(null);
  const tooltip = ZEN_TOOLTIPS[tooltipKey];

  useEffect(() => {
    if (!isTouchOpen) return;
    const handler = (e: TouchEvent | MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsTouchOpen(false);
      }
    };
    document.addEventListener("touchstart", handler);
    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("touchstart", handler);
      document.removeEventListener("mousedown", handler);
    };
  }, [isTouchOpen]);

  if (!tooltip) return <>{children}</>;

  const showTooltip = isMobile ? isTouchOpen : isOpen;

  return (
    <div
      ref={ref}
      className="relative inline-flex items-center gap-1.5"
      onMouseEnter={() => !isMobile && setIsOpen(true)}
      onMouseLeave={() => !isMobile && setIsOpen(false)}
    >
      {children}
      <button
        type="button"
        onClick={() => isMobile && setIsTouchOpen(!isTouchOpen)}
        className="shrink-0 focus:outline-none"
        aria-label={`${tooltip.title} 說明`}
      >
        <ZenOrb size="sm" />
      </button>
      <AnimatePresence>
        {showTooltip && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 4 }}
            transition={{ duration: 0.2 }}
            className="zen-tooltip-glass absolute z-50 left-0 top-full mt-2 w-72 p-4 rounded-2xl"
          >
            <div className="flex items-center gap-2 mb-2">
              <ZenOrb size="sm" />
              <h4 className="text-sm font-semibold text-foreground">
                {tooltip.title}
              </h4>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {tooltip.description}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Skeleton Loader with Progress Text ─────────────────────────────────────

export function ZenSkeleton({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 rounded-lg animate-pulse"
          style={{
            width: i === lines - 1 ? "60%" : "100%",
            background:
              "linear-gradient(90deg, rgba(245,243,240,0.6) 25%, rgba(234,201,193,0.2) 50%, rgba(245,243,240,0.6) 75%)",
            backgroundSize: "200% 100%",
            animation: "shimmer 1.5s ease-in-out infinite",
          }}
        />
      ))}
    </div>
  );
}

// ─── Generation Progress Overlay ────────────────────────────────────────────

export function ZenProgressOverlay({
  visible,
  progress,
  message,
}: {
  visible: boolean;
  progress: number;
  message: string;
}) {
  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="zen-progress-overlay-bg fixed inset-0 z-50 flex items-center justify-center"
      >
        <motion.div
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
          className="flex flex-col items-center gap-6 max-w-sm px-8"
        >
          {/* Breathing Orb */}
          <motion.div
            className="w-20 h-20 rounded-full"
            animate={{
              scale: [1, 1.15, 1],
              boxShadow: [
                "0 0 20px rgba(212, 197, 226, 0.4)",
                "0 0 50px rgba(212, 197, 226, 0.7)",
                "0 0 20px rgba(212, 197, 226, 0.4)",
              ],
            }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            style={{
              background:
                "radial-gradient(circle at 35% 35%, rgba(212, 197, 226, 0.8), rgba(200, 213, 224, 0.6), rgba(234, 201, 193, 0.4))",
            }}
          />

          {/* Progress Bar */}
          <div className="w-full">
            <div className="h-1.5 w-full rounded-full bg-border/30 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{
                  background:
                    "linear-gradient(90deg, #D4C5E2, #C8D5E0, #EAC9C1)",
                }}
                initial={{ width: "0%" }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
            <div className="flex justify-between items-center mt-3">
              <p className="text-sm text-foreground font-medium">{message}</p>
              <span className="text-sm text-muted-foreground tabular-nums">
                {progress}%
              </span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Glassmorphism Card Wrapper ─────────────────────────────────────────────

export function GlassCard({
  children,
  className = "",
  hover = true,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={`zen-glass-card rounded-2xl p-5 transition-healing ${hover ? "zen-glass-card-hover hover:-translate-y-0.5" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

// ─── Mobile Bottom Sheet ────────────────────────────────────────────────────

export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/20"
            style={{ backdropFilter: "blur(4px)" }}
            onClick={onClose}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="zen-bottom-sheet fixed bottom-0 left-0 right-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-3xl"
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <div className="px-5 pb-2">
              <h3 className="text-base font-semibold text-foreground">
                {title}
              </h3>
            </div>
            <div className="px-5 pb-6">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
