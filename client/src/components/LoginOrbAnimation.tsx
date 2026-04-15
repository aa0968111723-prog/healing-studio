/**
 * LoginOrbAnimation.tsx — 登入光球飛入動畫
 *
 * 當使用者成功登入（URL 帶有 ?welcome=1）時播放：
 *   1. 多顆柔光球從畫面四周緩緩飛入
 *   2. 匯聚至中心，形成一顆溫暖的主光球
 *   3. 主光球輕柔脈動、散發光暈
 *   4. 漸漸淡出，完成療癒迎接
 *
 * 設計原則：
 *   - 極細膩：使用多層高斯模糊 + 漸層透明
 *   - 療癒感：緩慢的 ease-in-out、溫暖色調、呼吸節奏
 *   - 不打斷流程：動畫結束後自動消失，可點擊跳過
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ─── Constants ──────────────────────────────────────────────────────────────

const TOTAL_DURATION_MS = 4200; // Total animation duration before fade-out

// ─── Types ──────────────────────────────────────────────────────────────────

interface OrbConfig {
  id: number;
  /** Starting position (viewport %) */
  startX: number;
  startY: number;
  /** Color (warm healing palette) */
  color: string;
  /** Glow color */
  glow: string;
  /** Size in px */
  size: number;
  /** Delay before fly-in (s) */
  delay: number;
  /** Individual fly duration (s) */
  duration: number;
}

// ─── Orb configurations — soft, warm, healing tones ─────────────────────────

const ORBS: OrbConfig[] = [
  // Primary warm orbs
  { id: 1,  startX: -10, startY: 20,  color: "rgba(255,200,120,0.7)", glow: "rgba(255,180,80,0.5)",  size: 18, delay: 0,    duration: 2.4 },
  { id: 2,  startX: 110, startY: 35,  color: "rgba(255,160,180,0.6)", glow: "rgba(255,120,160,0.4)", size: 14, delay: 0.15, duration: 2.6 },
  { id: 3,  startX: 30,  startY: -10, color: "rgba(200,180,255,0.6)", glow: "rgba(180,160,255,0.4)", size: 12, delay: 0.3,  duration: 2.2 },
  { id: 4,  startX: 80,  startY: 110, color: "rgba(180,230,255,0.6)", glow: "rgba(140,210,255,0.4)", size: 16, delay: 0.2,  duration: 2.5 },
  { id: 5,  startX: -5,  startY: 75,  color: "rgba(255,220,180,0.65)",glow: "rgba(255,200,140,0.4)", size: 10, delay: 0.4,  duration: 2.3 },
  // Secondary accent orbs (smaller, more ethereal)
  { id: 6,  startX: 105, startY: 70,  color: "rgba(255,190,200,0.5)", glow: "rgba(255,160,180,0.3)", size: 8,  delay: 0.5,  duration: 2.7 },
  { id: 7,  startX: 50,  startY: -8,  color: "rgba(220,200,255,0.5)", glow: "rgba(200,180,255,0.3)", size: 9,  delay: 0.35, duration: 2.1 },
  { id: 8,  startX: 15,  startY: 105, color: "rgba(255,230,200,0.5)", glow: "rgba(255,210,160,0.3)", size: 7,  delay: 0.55, duration: 2.4 },
  { id: 9,  startX: 90,  startY: -5,  color: "rgba(180,220,255,0.45)",glow: "rgba(150,200,255,0.3)", size: 11, delay: 0.25, duration: 2.8 },
  { id: 10, startX: -8,  startY: 50,  color: "rgba(255,210,170,0.5)", glow: "rgba(255,190,140,0.3)", size: 6,  delay: 0.6,  duration: 2.5 },
  // Tiny dust particles
  { id: 11, startX: 20,  startY: -12, color: "rgba(255,240,220,0.4)", glow: "rgba(255,220,180,0.2)", size: 4,  delay: 0.45, duration: 2.0 },
  { id: 12, startX: 108, startY: 55,  color: "rgba(240,200,255,0.4)", glow: "rgba(220,180,255,0.2)", size: 5,  delay: 0.7,  duration: 2.6 },
];

// ─── FlyingOrb sub-component ────────────────────────────────────────────────

function FlyingOrb({ orb }: { orb: OrbConfig }) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{
        width: orb.size,
        height: orb.size,
        background: `radial-gradient(circle, ${orb.color} 0%, transparent 70%)`,
        boxShadow: `0 0 ${orb.size * 2}px ${orb.glow}, 0 0 ${orb.size * 4}px ${orb.glow}`,
        filter: `blur(${Math.max(1, orb.size * 0.15)}px)`,
      }}
      initial={{
        left: `${orb.startX}%`,
        top: `${orb.startY}%`,
        scale: 0.3,
        opacity: 0,
      }}
      animate={{
        left: "50%",
        top: "50%",
        scale: [0.3, 1.2, 0.6],
        opacity: [0, 0.9, 0.7],
      }}
      transition={{
        duration: orb.duration,
        delay: orb.delay,
        ease: [0.25, 0.1, 0.25, 1], // cubic-bezier for gentle deceleration
        scale: {
          duration: orb.duration,
          delay: orb.delay,
          ease: "easeInOut",
        },
        opacity: {
          duration: orb.duration * 0.6,
          delay: orb.delay,
          ease: "easeOut",
        },
      }}
    />
  );
}

// ─── Central merged orb (appears after fly-in converges) ────────────────────

function CentralOrb() {
  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
      }}
    >
      {/* Outermost glow halo */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 200,
          height: 200,
          left: -100,
          top: -100,
          background: "radial-gradient(circle, rgba(255,200,140,0.15) 0%, rgba(255,180,200,0.08) 40%, transparent 70%)",
          filter: "blur(30px)",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: [0, 1.8, 1.5],
          opacity: [0, 0.8, 0.6],
        }}
        transition={{
          duration: 2.0,
          delay: 1.6,
          ease: [0.16, 1, 0.3, 1],
        }}
      />

      {/* Middle glow ring */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 100,
          height: 100,
          left: -50,
          top: -50,
          background: "radial-gradient(circle, rgba(255,210,170,0.4) 0%, rgba(255,180,220,0.2) 50%, transparent 80%)",
          filter: "blur(12px)",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: [0, 1.3, 1.1, 1.2],
          opacity: [0, 1, 0.8, 0.9],
        }}
        transition={{
          duration: 2.2,
          delay: 1.8,
          ease: "easeInOut",
        }}
      />

      {/* Core bright spot */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 40,
          height: 40,
          left: -20,
          top: -20,
          background: "radial-gradient(circle, rgba(255,255,245,0.95) 0%, rgba(255,220,180,0.7) 40%, rgba(255,190,160,0.3) 70%, transparent 100%)",
          filter: "blur(2px)",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: [0, 1.5, 1.0, 1.15, 1.0],
          opacity: [0, 1, 0.9, 1, 0.9],
        }}
        transition={{
          duration: 2.4,
          delay: 2.0,
          ease: [0.16, 1, 0.3, 1],
        }}
      />

      {/* Breathing pulse rings */}
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: 60,
            height: 60,
            left: -30,
            top: -30,
            border: "1px solid rgba(255,220,180,0.15)",
            background: "transparent",
          }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{
            scale: [1, 2.5 + i * 0.5],
            opacity: [0.4, 0],
          }}
          transition={{
            duration: 2.0,
            delay: 2.4 + i * 0.4,
            ease: "easeOut",
            repeat: 1,
            repeatDelay: 0.5,
          }}
        />
      ))}

      {/* Welcome text */}
      <motion.div
        className="absolute whitespace-nowrap"
        style={{
          left: "50%",
          top: "calc(50% + 60px)",
          transform: "translateX(-50%)",
        }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: [0, 1, 1, 0.8], y: [10, 0, 0, 0] }}
        transition={{
          duration: 1.6,
          delay: 2.6,
          ease: [0.16, 1, 0.3, 1],
        }}
      >
        <span className="text-sm tracking-[0.15em] text-white/60 font-light select-none">
          歡迎回來
        </span>
      </motion.div>
    </motion.div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function LoginOrbAnimation() {
  const [show, setShow] = useState(false);
  const [phase, setPhase] = useState<"flying" | "converged" | "fadeout">("flying");

  // Check for ?welcome=1 on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("welcome") !== "1") return;

    // Remove the query param from URL without reload
    params.delete("welcome");
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "") + window.location.hash;
    window.history.replaceState({}, "", newUrl);

    setShow(true);
  }, []);

  // Phase transitions
  useEffect(() => {
    if (!show) return;

    // After orbs converge → show central orb
    const convergeTimer = setTimeout(() => setPhase("converged"), 1800);
    // After full animation → begin fade-out
    const fadeTimer = setTimeout(() => setPhase("fadeout"), TOTAL_DURATION_MS);

    return () => {
      clearTimeout(convergeTimer);
      clearTimeout(fadeTimer);
    };
  }, [show]);

  // Hide after fade-out completes
  useEffect(() => {
    if (phase !== "fadeout") return;
    const timer = setTimeout(() => setShow(false), 1200);
    return () => clearTimeout(timer);
  }, [phase]);

  const handleSkip = useCallback(() => {
    setPhase("fadeout");
  }, []);

  // Memoize orb list to avoid re-renders
  const orbElements = useMemo(
    () => ORBS.map((orb) => <FlyingOrb key={orb.id} orb={orb} />),
    [],
  );

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[9999] pointer-events-auto cursor-pointer"
          style={{
            background: "radial-gradient(ellipse at 50% 50%, rgba(20,15,30,0.92) 0%, rgba(10,8,20,0.96) 100%)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: phase === "fadeout" ? 0 : 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: phase === "fadeout" ? 1.0 : 0.6,
            ease: "easeInOut",
          }}
          onClick={handleSkip}
        >
          {/* Ambient background particles — very subtle floating dust */}
          {[...Array(20)].map((_, i) => (
            <motion.div
              key={`dust-${i}`}
              className="absolute rounded-full pointer-events-none"
              style={{
                width: 2 + (i % 3),
                height: 2 + (i % 3),
                background: `rgba(255,230,200,${0.08 + (i % 5) * 0.03})`,
                left: `${10 + (i * 4.2) % 80}%`,
                top: `${8 + (i * 3.7) % 84}%`,
                filter: "blur(1px)",
              }}
              animate={{
                y: [0, -15 - (i % 10), 0],
                x: [0, 8 - (i % 16), 0],
                opacity: [0.3, 0.6, 0.3],
              }}
              transition={{
                duration: 4 + (i % 3),
                delay: i * 0.2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          ))}

          {/* Flying orbs */}
          {orbElements}

          {/* Central merged orb — appears after convergence */}
          {phase !== "flying" && <CentralOrb />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
