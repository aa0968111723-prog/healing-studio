/**
 * RippleTransition.tsx — 水波紋頁面過渡特效
 *
 * 從點擊座標向外擴散的圓形 clip-path 遮罩動畫，
 * 搭配同心水波紋漣漪效果，動畫完成後觸發導航回調。
 * 場景自適應色彩，符合 OARS 溫暖非侵入原則。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { SceneId } from "./AmbientEnvironment";

// ─── Scene-adaptive ripple colors ───────────────────────────────────────────

interface RippleColors {
  /** Primary fill color for the expanding circle */
  primary: string;
  /** Secondary ring color for concentric ripples */
  ring: string;
  /** Glow color for the center flash */
  glow: string;
  /** Text color for the transition label */
  text: string;
  /** Subtle particle color */
  particle: string;
}

const SCENE_RIPPLE_COLORS: Record<SceneId, RippleColors> = {
  nightSky: {
    primary: "rgba(30, 30, 80, 0.97)",
    ring: "rgba(120, 120, 255, 0.3)",
    glow: "rgba(160, 160, 255, 0.5)",
    text: "rgba(200, 200, 255, 0.9)",
    particle: "rgba(180, 180, 255, 0.6)",
  },
  morning: {
    primary: "rgba(255, 240, 220, 0.97)",
    ring: "rgba(255, 180, 80, 0.3)",
    glow: "rgba(255, 200, 100, 0.5)",
    text: "rgba(120, 80, 30, 0.9)",
    particle: "rgba(255, 200, 120, 0.6)",
  },
  cafe: {
    primary: "rgba(45, 30, 18, 0.97)",
    ring: "rgba(200, 150, 80, 0.3)",
    glow: "rgba(220, 170, 90, 0.5)",
    text: "rgba(240, 210, 170, 0.9)",
    particle: "rgba(200, 160, 100, 0.6)",
  },
  deepSea: {
    primary: "rgba(8, 25, 45, 0.97)",
    ring: "rgba(60, 180, 220, 0.3)",
    glow: "rgba(80, 200, 240, 0.5)",
    text: "rgba(180, 230, 250, 0.9)",
    particle: "rgba(100, 200, 240, 0.6)",
  },
};

// ─── Soft bounce easing ─────────────────────────────────────────────────────

const SOFT_BOUNCE: [number, number, number, number] = [0.16, 1, 0.3, 1];

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RippleOrigin {
  x: number;
  y: number;
}

interface RippleTransitionProps {
  /** Whether the ripple is active */
  active: boolean;
  /** Click origin coordinates (viewport-relative) */
  origin: RippleOrigin;
  /** Current ambient scene */
  sceneId: SceneId;
  /** Called when the transition animation completes */
  onComplete: () => void;
}

// ─── Concentric Ripple Ring ─────────────────────────────────────────────────

function RippleRing({
  delay,
  color,
  origin,
}: {
  delay: number;
  color: string;
  origin: RippleOrigin;
}) {
  return (
    <motion.div
      className="absolute pointer-events-none rounded-full"
      style={{
        left: origin.x,
        top: origin.y,
        x: "-50%",
        y: "-50%",
        border: `2px solid ${color}`,
      }}
      initial={{ width: 0, height: 0, opacity: 0.8 }}
      animate={{
        width: ["0px", "600px", "1200px"],
        height: ["0px", "600px", "1200px"],
        opacity: [0.8, 0.4, 0],
      }}
      transition={{
        duration: 1.2,
        delay,
        ease: SOFT_BOUNCE,
      }}
    />
  );
}

// ─── Floating Particle ──────────────────────────────────────────────────────

function FloatingParticle({
  delay,
  color,
  origin,
  angle,
}: {
  delay: number;
  color: string;
  origin: RippleOrigin;
  angle: number;
}) {
  const distance = 80 + Math.random() * 120;
  const size = 3 + Math.random() * 4;
  const endX = origin.x + Math.cos(angle) * distance;
  const endY = origin.y + Math.sin(angle) * distance;

  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        left: origin.x,
        top: origin.y,
        x: "-50%",
        y: "-50%",
      }}
      initial={{ opacity: 0, scale: 0 }}
      animate={{
        opacity: [0, 1, 0],
        scale: [0, 1.2, 0.5],
        left: [origin.x, endX],
        top: [origin.y, endY],
      }}
      transition={{
        duration: 0.8,
        delay: delay + 0.1,
        ease: SOFT_BOUNCE,
      }}
    />
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function RippleTransition({
  active,
  origin,
  sceneId,
  onComplete,
}: RippleTransitionProps) {
  const colors = SCENE_RIPPLE_COLORS[sceneId];
  const hasCompleted = useRef(false);
  const [showLabel, setShowLabel] = useState(false);

  // Calculate the maximum radius needed to cover the entire viewport
  const maxRadius = Math.ceil(
    Math.sqrt(
      Math.max(origin.x, window.innerWidth - origin.x) ** 2 +
        Math.max(origin.y, window.innerHeight - origin.y) ** 2
    )
  );

  // Percentage for clip-path circle
  const maxRadiusVw = Math.ceil((maxRadius / window.innerWidth) * 150);

  // Show label after initial expansion
  useEffect(() => {
    if (!active) {
      setShowLabel(false);
      return;
    }
    const timer = setTimeout(() => setShowLabel(true), 400);
    return () => clearTimeout(timer);
  }, [active]);

  // Trigger onComplete after animation finishes
  const handleAnimationComplete = useCallback(() => {
    if (!hasCompleted.current && active) {
      hasCompleted.current = true;
      // Small delay for the label to be visible
      setTimeout(() => {
        onComplete();
      }, 300);
    }
  }, [active, onComplete]);

  // Reset on deactivation
  useEffect(() => {
    if (!active) {
      hasCompleted.current = false;
    }
  }, [active]);

  // Generate particle angles
  const particleAngles = useRef(
    Array.from(
      { length: 8 },
      (_, i) => (i * Math.PI * 2) / 8 + (Math.random() - 0.5) * 0.4
    )
  );

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="fixed inset-0 z-[9999] pointer-events-auto"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: SOFT_BOUNCE }}
        >
          {/* Main expanding circle mask */}
          <motion.div
            className="absolute inset-0"
            style={{
              backgroundColor: colors.primary,
              clipPath: `circle(0% at ${origin.x}px ${origin.y}px)`,
            }}
            animate={{
              clipPath: `circle(${maxRadiusVw}% at ${origin.x}px ${origin.y}px)`,
            }}
            transition={{
              duration: 0.8,
              ease: SOFT_BOUNCE,
            }}
            onAnimationComplete={handleAnimationComplete}
          />

          {/* Center glow flash */}
          <motion.div
            className="absolute rounded-full pointer-events-none"
            style={{
              left: origin.x,
              top: origin.y,
              x: "-50%",
              y: "-50%",
              background: `radial-gradient(circle, ${colors.glow} 0%, transparent 70%)`,
            }}
            initial={{ width: 0, height: 0, opacity: 0 }}
            animate={{
              width: [0, 200, 300],
              height: [0, 200, 300],
              opacity: [0, 0.8, 0],
            }}
            transition={{
              duration: 0.7,
              ease: SOFT_BOUNCE,
            }}
          />

          {/* Concentric ripple rings */}
          <RippleRing delay={0} color={colors.ring} origin={origin} />
          <RippleRing delay={0.12} color={colors.ring} origin={origin} />
          <RippleRing delay={0.24} color={colors.ring} origin={origin} />

          {/* Floating particles */}
          {particleAngles.current.map((angle, i) => (
            <FloatingParticle
              key={i}
              delay={0.05 * i}
              color={colors.particle}
              origin={origin}
              angle={angle}
            />
          ))}

          {/* Transition label */}
          <AnimatePresence>
            {showLabel && (
              <motion.div
                className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35, ease: SOFT_BOUNCE }}
              >
                {/* Pulsing dot */}
                <motion.div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: colors.glow }}
                  animate={{
                    scale: [1, 1.4, 1],
                    opacity: [0.6, 1, 0.6],
                  }}
                  transition={{
                    duration: 1.2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
                <span
                  className="text-sm font-medium tracking-widest"
                  style={{ color: colors.text }}
                >
                  進入工作室
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Hook: useRippleTransition ──────────────────────────────────────────────

export function useRippleTransition() {
  const [rippleState, setRippleState] = useState<{
    active: boolean;
    origin: RippleOrigin;
  }>({
    active: false,
    origin: { x: 0, y: 0 },
  });

  const triggerRipple = useCallback((e: React.MouseEvent) => {
    setRippleState({
      active: true,
      origin: { x: e.clientX, y: e.clientY },
    });
  }, []);

  const resetRipple = useCallback(() => {
    setRippleState(prev => ({ ...prev, active: false }));
  }, []);

  return {
    rippleActive: rippleState.active,
    rippleOrigin: rippleState.origin,
    triggerRipple,
    resetRipple,
  };
}
