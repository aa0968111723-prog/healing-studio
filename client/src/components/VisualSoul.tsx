/**
 * VisualSoul.tsx — AI 光球元件（Phase 10 升級版）
 *
 * 架構：
 *   - size="sm"       → CSS + Framer Motion（輕量，適合側欄小圖示）
 *   - size="md/lg/xl" → Three.js + GLSL 真 3D 光球（主角視覺）
 *   - 若瀏覽器不支援 WebGL → 自動退回 CSS 模式
 *
 * 使用方式：
 *   <VisualSoul personality="creative" state="generating" size="lg" />
 */

import { useMemo, useEffect, useState, lazy, Suspense, memo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import type { OrbCustomColors } from "./VisualSoul3D";

// ─── Helper: parse "r,g,b" cute color string to 0-1 normalized tuple ────────

function parseCuteColor(s: string): [number, number, number] {
  const parts = s.split(",").map(v => {
    const n = parseInt(v.trim(), 10);
    return isNaN(n) ? 0 : n / 255;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type AIState =
  | "idle"
  | "thinking"
  | "generating"
  | "listening"
  | "acting";
export type Personality = "calm" | "creative" | "technical";

type Props = {
  state?: AIState;
  personality?: Personality;
  size?: "sm" | "md" | "lg" | "xl";
  visible?: boolean;
  className?: string;
  cuteMode?: boolean;
};

// ─── Lazy-load the heavy 3D component ─────────────────────────────────────

const VisualSoul3D = lazy(() => import("./VisualSoul3D"));

// ─── Cute Mode Color Palettes (bright, positive only) ─────────────────────

const CUTE_STATE_COLORS: Record<AIState, { primary: string; secondary: string; accent: string }> = {
  idle:       { primary: "255,210,90",  secondary: "255,240,140", accent: "255,255,200" }, // sunny yellow
  thinking:   { primary: "130,195,255", secondary: "175,220,255", accent: "220,240,255" }, // sky blue
  generating: { primary: "255,140,195", secondary: "255,185,225", accent: "255,225,245" }, // candy pink
  listening:  { primary: "90,225,170",  secondary: "145,245,205", accent: "200,255,240" }, // mint green
  acting:     { primary: "195,145,255", secondary: "220,180,255", accent: "245,225,255" }, // lavender
};

// ─── Cute Mode: whisper messages per state (occasionally float up) ─────────

const CUTE_WHISPERS: Record<AIState, string[]> = {
  idle:       ["哈囉～", "嗨！", "♪～", "陪你～", "嘿嘿", "🌸"],
  thinking:   ["嗯...", "想想", "誒？", "等等～", "喔！"],
  generating: ["變變變！", "登登～", "鏘鏘", "好啦～", "✨"],
  listening:  ["我聽著", "嗯嗯", "繼續說", "好喔", "🍃"],
  acting:     ["衝啊！", "去囉！", "馬上！", "出發～"],
};

// ─── Cute Mode: state-specific floating accessory icons ────────────────────

function CuteAccessory({ state, size }: { state: AIState; size: "sm" | "md" | "lg" | "xl" }) {
  const reduced = useReducedMotion();
  const fontPx = size === "sm" ? 9 : size === "md" ? 12 : size === "lg" ? 14 : 16;
  const offsetTop = size === "sm" ? -6 : size === "md" ? -10 : -14;
  const offsetRight = size === "sm" ? -2 : size === "md" ? -4 : -6;

  // Pick the icon + color for this state
  const a = (() => {
    if (state === "thinking")   return { icon: "?",  color: "#3B8FE8", glow: "rgba(91,168,255,0.8)" };
    if (state === "generating") return { icon: "✨", color: "#FF7BB8", glow: "rgba(255,123,184,0.9)" };
    if (state === "listening")  return { icon: "♪",  color: "#34C895", glow: "rgba(90,225,170,0.8)" };
    if (state === "acting")     return { icon: "!",  color: "#9D6BFF", glow: "rgba(195,145,255,0.85)" };
    return null; // idle → no accessory (face does the work)
  })();

  if (!a) return null;

  const baseAnim = reduced
    ? { y: 0, rotate: 0, scale: 1 }
    : state === "generating"
      ? { y: [-2, -8, -2], rotate: [-12, 12, -12], scale: [0.9, 1.1, 0.9] }
      : state === "thinking"
        ? { y: [-1, -5, -1], rotate: [-6, 6, -6], scale: [0.95, 1.05, 0.95] }
        : { y: [-1, -4, -1], rotate: [-4, 4, -4], scale: [0.95, 1.05, 0.95] };

  return (
    <motion.div
      className="absolute pointer-events-none select-none"
      style={{
        top: offsetTop,
        right: offsetRight,
        fontSize: fontPx,
        fontWeight: 800,
        color: a.color,
        textShadow: `0 0 6px ${a.glow}, 0 0 12px ${a.glow.replace(/0\.\d+/, "0.4")}`,
        zIndex: 6,
        lineHeight: 1,
      }}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, ...baseAnim }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ duration: state === "generating" ? 1.4 : 2.2, repeat: Infinity, ease: "easeInOut" }}
    >
      {a.icon}
    </motion.div>
  );
}

// ─── Cute Mode: twinkling sparkle field around the orb ─────────────────────

function CuteSparkleField({ size, state }: { size: "sm" | "md" | "lg" | "xl"; state: AIState }) {
  const reduced = useReducedMotion();
  // Fewer sparkles on small sizes; richer for generating/acting
  const baseCount = size === "sm" ? 2 : size === "md" ? 3 : size === "lg" ? 4 : 5;
  const boost = state === "generating" ? 2 : state === "acting" ? 1 : 0;
  const count = baseCount + boost;

  const sparkles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        // Spread sparkles around the orb (outside the core)
        angle: (360 / count) * i + Math.random() * 30,
        radius: 55 + Math.random() * 35, // % offset from center
        delay: Math.random() * 2.5,
        duration: 1.6 + Math.random() * 1.2,
        size: 2 + Math.floor(Math.random() * 3), // 2-4 px
      })),
    [count]
  );

  if (reduced) return null;

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 4 }}>
      {sparkles.map((s, i) => {
        const x = Math.cos((s.angle * Math.PI) / 180) * s.radius;
        const y = Math.sin((s.angle * Math.PI) / 180) * s.radius;
        return (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              top: `calc(50% + ${y}%)`,
              left: `calc(50% + ${x}%)`,
              width: s.size,
              height: s.size,
              marginTop: -s.size / 2,
              marginLeft: -s.size / 2,
              background: "radial-gradient(circle, #ffffff 0%, rgba(255,255,255,0.6) 50%, transparent 80%)",
              boxShadow: "0 0 6px rgba(255,255,255,0.9), 0 0 12px rgba(255,230,200,0.6)",
            }}
            animate={{
              opacity: [0, 1, 0],
              scale: [0.4, 1.2, 0.4],
            }}
            transition={{
              duration: s.duration,
              delay: s.delay,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Cute Mode: soft ground halo / shadow beneath the orb ──────────────────

function CuteGroundHalo({ state, size }: { state: AIState; size: "sm" | "md" | "lg" | "xl" }) {
  const reduced = useReducedMotion();
  const colors = CUTE_STATE_COLORS[state];
  const haloHeight = size === "sm" ? 4 : size === "md" ? 6 : size === "lg" ? 8 : 10;
  const haloWidth = size === "sm" ? 60 : size === "md" ? 70 : 80; // %

  return (
    <motion.div
      className="absolute pointer-events-none rounded-[50%]"
      style={{
        bottom: -haloHeight - 2,
        left: "50%",
        width: `${haloWidth}%`,
        height: haloHeight,
        marginLeft: `-${haloWidth / 2}%`,
        background: `radial-gradient(ellipse at center, rgba(${colors.primary},0.45) 0%, rgba(${colors.primary},0.18) 50%, transparent 80%)`,
        filter: "blur(2px)",
        zIndex: 0,
      }}
      animate={
        reduced
          ? { opacity: 0.7 }
          : { opacity: [0.45, 0.75, 0.45], scaleX: [0.85, 1, 0.85] }
      }
      transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

// ─── Cute Mode: ephemeral whisper bubble (idle, intermittent) ──────────────

function CuteWhisperBubble({ state, size }: { state: AIState; size: "sm" | "md" | "lg" | "xl" }) {
  const reduced = useReducedMotion();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (reduced) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      // Roughly every 8-18s, surface a whisper for 2.4s
      const delay = 8000 + Math.random() * 10000;
      timer = setTimeout(() => {
        const pool = CUTE_WHISPERS[state] ?? CUTE_WHISPERS.idle;
        setText(pool[Math.floor(Math.random() * pool.length)] ?? null);
        setTimeout(() => setText(null), 2400);
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [state, reduced]);

  // Hide on small sizes — too cramped
  if (size === "sm") return null;

  const fontPx = size === "md" ? 9 : size === "lg" ? 10 : 11;

  return (
    <AnimatePresence>
      {text && (
        <motion.div
          key={text}
          initial={{ opacity: 0, y: 4, scale: 0.85 }}
          animate={{ opacity: 1, y: -2, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.85 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="absolute left-1/2 -translate-x-1/2 pointer-events-none whitespace-nowrap"
          style={{
            top: -22,
            fontSize: fontPx,
            padding: "2px 7px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.92)",
            color: "#3a3552",
            fontWeight: 600,
            boxShadow: "0 2px 8px rgba(255,180,210,0.35), 0 0 0 1px rgba(255,255,255,0.6) inset",
            zIndex: 7,
            letterSpacing: 0.2,
          }}
        >
          {text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Cute Face SVG component ───────────────────────────────────────────────

function CuteFace({ state = "idle", size = "md" }: { state: AIState; size: string }) {
  const reduced = useReducedMotion();
  const faceScale = size === "sm" ? 0.65 : size === "md" ? 0.8 : 1;
  const eyeColor = "#1a1a2e";
  const strokeWidth = size === "sm" ? 1.4 : 1.6;

  // Blink: briefly close eyes every 4-7s (skip when reduced motion preferred)
  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    if (reduced) return;
    let blinkTimer: ReturnType<typeof setTimeout>;
    const scheduleBlink = () => {
      const delay = 3500 + Math.random() * 3500;
      blinkTimer = setTimeout(() => {
        setBlinking(true);
        setTimeout(() => {
          setBlinking(false);
          scheduleBlink();
        }, 140);
      }, delay);
    };
    scheduleBlink();
    return () => clearTimeout(blinkTimer);
  }, [reduced]);

  // Eye definitions per state
  const leftEye = () => {
    if (blinking) {
      // Closed eye line — gentle smile
      return <path d="M9,15 Q12,16.5 15,15" stroke={eyeColor} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />;
    }
    if (state === "idle") {
      // Happy arc eyes ∩
      return <path d="M10,15 Q12,11 14,15" stroke={eyeColor} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />;
    }
    if (state === "thinking") {
      // Dot eyes with one raised eyebrow
      return (
        <g>
          <circle cx="12" cy="14" r="1.5" fill={eyeColor} />
          <path d="M9.5,10.5 Q12,9 14.5,10.5" stroke={eyeColor} strokeWidth={1.1} strokeLinecap="round" fill="none" />
        </g>
      );
    }
    if (state === "generating") {
      // Star / sparkle eyes
      return (
        <g>
          <circle cx="12" cy="14" r="2.2" fill="none" stroke={eyeColor} strokeWidth={strokeWidth} />
          <circle cx="12" cy="14" r="0.9" fill={eyeColor} />
          <line x1="12" y1="10.5" x2="12" y2="9.2" stroke={eyeColor} strokeWidth={1} strokeLinecap="round" />
          <line x1="12" y1="17.5" x2="12" y2="18.8" stroke={eyeColor} strokeWidth={1} strokeLinecap="round" />
          <line x1="8.8" y1="14" x2="7.5" y2="14" stroke={eyeColor} strokeWidth={1} strokeLinecap="round" />
          <line x1="15.2" y1="14" x2="16.5" y2="14" stroke={eyeColor} strokeWidth={1} strokeLinecap="round" />
        </g>
      );
    }
    if (state === "listening") {
      // Soft half-closed happy eyes
      return <path d="M9.5,13.5 Q12,11 14.5,13.5" stroke={eyeColor} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />;
    }
    // acting → surprised round eyes
    return <circle cx="12" cy="14" r="2.5" fill="none" stroke={eyeColor} strokeWidth={strokeWidth} />;
  };

  const rightEye = () => {
    if (blinking) {
      return <path d="M25,15 Q28,16.5 31,15" stroke={eyeColor} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />;
    }
    if (state === "idle") {
      return <path d="M26,15 Q28,11 30,15" stroke={eyeColor} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />;
    }
    if (state === "thinking") {
      return (
        <g>
          <circle cx="28" cy="14" r="1.5" fill={eyeColor} />
          <path d="M25.5,11 Q28,9.5 30.5,11" stroke={eyeColor} strokeWidth={1.1} strokeLinecap="round" fill="none" />
        </g>
      );
    }
    if (state === "generating") {
      return (
        <g>
          <circle cx="28" cy="14" r="2.2" fill="none" stroke={eyeColor} strokeWidth={strokeWidth} />
          <circle cx="28" cy="14" r="0.9" fill={eyeColor} />
          <line x1="28" y1="10.5" x2="28" y2="9.2" stroke={eyeColor} strokeWidth={1} strokeLinecap="round" />
          <line x1="28" y1="17.5" x2="28" y2="18.8" stroke={eyeColor} strokeWidth={1} strokeLinecap="round" />
          <line x1="24.8" y1="14" x2="23.5" y2="14" stroke={eyeColor} strokeWidth={1} strokeLinecap="round" />
          <line x1="31.2" y1="14" x2="32.5" y2="14" stroke={eyeColor} strokeWidth={1} strokeLinecap="round" />
        </g>
      );
    }
    if (state === "listening") {
      return <path d="M25.5,13.5 Q28,11 30.5,13.5" stroke={eyeColor} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />;
    }
    return <circle cx="28" cy="14" r="2.5" fill="none" stroke={eyeColor} strokeWidth={strokeWidth} />;
  };

  const mouth = () => {
    if (state === "idle") {
      // Gentle smile
      return <path d="M16,23 Q20,27 24,23" stroke={eyeColor} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />;
    }
    if (state === "thinking") {
      // Slightly wavy neutral
      return <path d="M16,24 Q18,22.5 20,24 Q22,25.5 24,24" stroke={eyeColor} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />;
    }
    if (state === "generating") {
      // Big open happy mouth
      return (
        <path d="M14,22 Q20,29 26,22" stroke={eyeColor} strokeWidth={strokeWidth} strokeLinecap="round" fill="rgba(26,26,46,0.15)" />
      );
    }
    if (state === "listening") {
      return <path d="M16,23 Q20,26.5 24,23" stroke={eyeColor} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />;
    }
    // acting → surprised "o"
    return <ellipse cx="20" cy="24" rx="2.8" ry="3" fill="none" stroke={eyeColor} strokeWidth={strokeWidth} />;
  };

  // Cheek blush marks — radial-gradient soft blush (idle / generating / listening)
  const cheeks = () => {
    if (state !== "idle" && state !== "generating" && state !== "listening") return null;
    const opacity = state === "generating" ? 0.6 : 0.5;
    return (
      <g opacity={opacity}>
        <circle cx="9" cy="19.5" r="3.2" fill="url(#cute-blush-grad)" />
        <circle cx="31" cy="19.5" r="3.2" fill="url(#cute-blush-grad)" />
      </g>
    );
  };

  const faceW = 40;
  const faceH = 32;

  // Slight bounce on the whole face when generating (excited bobble)
  const faceBounce = reduced
    ? undefined
    : state === "generating"
      ? { y: [0, -1.5, 0], scale: [1, 1.04, 1] }
      : state === "acting"
        ? { rotate: [-3, 3, -3] }
        : undefined;

  return (
    <motion.svg
      viewBox={`0 0 ${faceW} ${faceH}`}
      width={faceW * faceScale}
      height={faceH * faceScale}
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        translateX: "-50%",
        translateY: "-50%",
        zIndex: 5,
        pointerEvents: "none",
        overflow: "visible",
      }}
      animate={faceBounce}
      transition={{
        duration: state === "generating" ? 0.55 : 1.2,
        repeat: faceBounce ? Infinity : 0,
        ease: "easeInOut",
      }}
    >
      <defs>
        <radialGradient id="cute-blush-grad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FF9EC0" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#FFB8D4" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#FFD2E2" stopOpacity="0" />
        </radialGradient>
      </defs>
      {cheeks()}
      {leftEye()}
      {rightEye()}
      {mouth()}
    </motion.svg>
  );
}

// ─── CSS Size Map ──────────────────────────────────────────────────────────

const SIZE_MAP = {
  sm: { container: "w-7 h-7", blur: 5, particleCount: 3 },
  md: { container: "w-12 h-12", blur: 10, particleCount: 5 },
  lg: { container: "w-16 h-16", blur: 14, particleCount: 7 },
  xl: { container: "w-24 h-24", blur: 18, particleCount: 9 },
};

// ─── CSS Personality Colors ─────────────────────────────────────────────────

const PERSONALITY_COLORS = {
  calm: {
    primary: "0,210,255", // 亮青 #00D2FF
    secondary: "100,240,255", // 天藍白
    accent: "200,255,255", // 冰白
    breathDurationMultiplier: 1.5,
  },
  creative: {
    primary: "255,80,180", // 亮粉 #FF50B4
    secondary: "255,160,60", // 橘粉
    accent: "255,230,0", // 亮黃
    breathDurationMultiplier: 1.0,
  },
  technical: {
    primary: "80,255,180", // 亮綠 #50FFB4
    secondary: "0,200,120", // 翠綠
    accent: "150,255,200", // 薄荷
    breathDurationMultiplier: 0.7,
  },
};

// ─── CSS State Config ───────────────────────────────────────────────────────

function getStateConfig(state: AIState, personality: Personality) {
  const colors = PERSONALITY_COLORS[personality];
  const bm = colors.breathDurationMultiplier;

  const configs = {
    idle: {
      gradient: [
        `radial-gradient(circle at 35% 35%, rgba(${colors.primary},0.7), rgba(${colors.secondary},0.5), rgba(${colors.accent},0.3))`,
        `radial-gradient(circle at 45% 45%, rgba(${colors.secondary},0.7), rgba(${colors.accent},0.5), rgba(${colors.primary},0.3))`,
        `radial-gradient(circle at 35% 35%, rgba(${colors.primary},0.7), rgba(${colors.secondary},0.5), rgba(${colors.accent},0.3))`,
      ],
      glowColor: `rgba(${colors.primary},0.4)`,
      glowPulse: [
        `0 0 10px rgba(${colors.primary},0.25), 0 0 24px rgba(${colors.primary},0.1)`,
        `0 0 18px rgba(${colors.primary},0.4), 0 0 36px rgba(${colors.primary},0.18)`,
        `0 0 10px rgba(${colors.primary},0.25), 0 0 24px rgba(${colors.primary},0.1)`,
      ],
      breathDuration: 4 * bm,
      rotateSpeed: 25,
      scale: [1, 1.03, 1] as number[],
      particleOpacity: 0.2,
    },
    thinking: {
      gradient: [
        `radial-gradient(circle at 30% 30%, rgba(${colors.accent},0.9), rgba(${colors.primary},0.7), rgba(${colors.secondary},0.5))`,
        `radial-gradient(circle at 50% 50%, rgba(${colors.secondary},0.9), rgba(${colors.accent},0.7), rgba(${colors.primary},0.5))`,
        `radial-gradient(circle at 40% 60%, rgba(${colors.primary},0.9), rgba(${colors.secondary},0.7), rgba(${colors.accent},0.5))`,
        `radial-gradient(circle at 30% 30%, rgba(${colors.accent},0.9), rgba(${colors.primary},0.7), rgba(${colors.secondary},0.5))`,
      ],
      glowColor: `rgba(${colors.accent},0.6)`,
      glowPulse: [
        `0 0 8px rgba(${colors.accent},0.4)`,
        `0 0 20px rgba(${colors.primary},0.7)`,
        `0 0 8px rgba(${colors.secondary},0.4)`,
        `0 0 20px rgba(${colors.accent},0.7)`,
      ],
      breathDuration: 0.8 * bm,
      rotateSpeed: 4,
      scale: [0.97, 1.05, 0.97] as number[],
      particleOpacity: 0.6,
    },
    generating: {
      gradient: [
        `radial-gradient(circle at 50% 50%, rgba(${colors.primary},0.95), rgba(${colors.accent},0.8), rgba(${colors.secondary},0.6))`,
        `radial-gradient(circle at 30% 30%, rgba(${colors.accent},0.95), rgba(${colors.primary},0.8), rgba(${colors.secondary},0.6))`,
        `radial-gradient(circle at 50% 50%, rgba(${colors.primary},0.95), rgba(${colors.accent},0.8), rgba(${colors.secondary},0.6))`,
      ],
      glowColor: `rgba(${colors.primary},0.7)`,
      glowPulse: [
        `0 0 16px rgba(${colors.primary},0.5), 0 0 40px rgba(${colors.primary},0.2)`,
        `0 0 32px rgba(${colors.accent},0.8), 0 0 60px rgba(${colors.primary},0.4)`,
        `0 0 16px rgba(${colors.primary},0.5), 0 0 40px rgba(${colors.primary},0.2)`,
      ],
      breathDuration: 0.5 * bm,
      rotateSpeed: 2,
      scale: [0.95, 1.1, 0.95] as number[],
      particleOpacity: 0.9,
    },
    listening: {
      gradient: [
        `radial-gradient(circle at 40% 40%, rgba(${colors.secondary},0.85), rgba(${colors.primary},0.65), rgba(${colors.accent},0.45))`,
        `radial-gradient(circle at 50% 50%, rgba(${colors.primary},0.85), rgba(${colors.secondary},0.65), rgba(${colors.accent},0.45))`,
        `radial-gradient(circle at 40% 40%, rgba(${colors.secondary},0.85), rgba(${colors.primary},0.65), rgba(${colors.accent},0.45))`,
      ],
      glowColor: `rgba(${colors.secondary},0.5)`,
      glowPulse: [
        `0 0 14px rgba(${colors.secondary},0.35), 0 0 28px rgba(${colors.secondary},0.15)`,
        `0 0 20px rgba(${colors.secondary},0.55), 0 0 42px rgba(${colors.secondary},0.25)`,
        `0 0 14px rgba(${colors.secondary},0.35), 0 0 28px rgba(${colors.secondary},0.15)`,
      ],
      breathDuration: 1.2 * bm,
      rotateSpeed: 15,
      scale: [1, 1.06, 1] as number[],
      particleOpacity: 0.5,
    },
    acting: {
      gradient: [
        `radial-gradient(circle at 45% 45%, rgba(${colors.accent},0.95), rgba(${colors.primary},0.8), rgba(${colors.secondary},0.5))`,
        `radial-gradient(circle at 35% 35%, rgba(${colors.primary},0.95), rgba(${colors.accent},0.8), rgba(${colors.secondary},0.5))`,
        `radial-gradient(circle at 45% 45%, rgba(${colors.accent},0.95), rgba(${colors.primary},0.8), rgba(${colors.secondary},0.5))`,
      ],
      glowColor: `rgba(${colors.accent},0.7)`,
      glowPulse: [
        `0 0 20px rgba(${colors.accent},0.5), 0 0 40px rgba(${colors.accent},0.2)`,
        `0 0 36px rgba(${colors.accent},0.8), 0 0 56px rgba(${colors.accent},0.4)`,
        `0 0 20px rgba(${colors.accent},0.5), 0 0 40px rgba(${colors.accent},0.2)`,
      ],
      breathDuration: 0.6 * bm,
      rotateSpeed: 3,
      scale: [0.96, 1.08, 0.96] as number[],
      particleOpacity: 0.85,
    },
  };

  return configs[state];
}

// ─── CSS-Only Fallback Orb (used for sm, and when WebGL unavailable) ────────

function CSSOrb({
  state = "idle",
  personality = "creative",
  size = "md",
  className = "",
  cuteMode = false,
}: Props) {
  const cuteColors = CUTE_STATE_COLORS[state];
  const baseColors = PERSONALITY_COLORS[personality];
  const colors = cuteMode ? cuteColors : baseColors;
  const baseConfig = getStateConfig(state, personality);

  // When in cute mode, override the gradient and glow with the bright cute colors
  const config = cuteMode
    ? {
        ...baseConfig,
        gradient: [
          `radial-gradient(circle at 35% 30%, rgba(${cuteColors.secondary},0.9), rgba(${cuteColors.primary},0.75), rgba(${cuteColors.accent},0.55))`,
          `radial-gradient(circle at 50% 45%, rgba(${cuteColors.primary},0.9), rgba(${cuteColors.accent},0.75), rgba(${cuteColors.secondary},0.55))`,
          `radial-gradient(circle at 35% 30%, rgba(${cuteColors.secondary},0.9), rgba(${cuteColors.primary},0.75), rgba(${cuteColors.accent},0.55))`,
        ],
        glowPulse: [
          `0 0 12px rgba(${cuteColors.primary},0.5), 0 0 28px rgba(${cuteColors.primary},0.25)`,
          `0 0 22px rgba(${cuteColors.primary},0.75), 0 0 44px rgba(${cuteColors.primary},0.35)`,
          `0 0 12px rgba(${cuteColors.primary},0.5), 0 0 28px rgba(${cuteColors.primary},0.25)`,
        ],
      }
    : baseConfig;

  const sizeConfig = SIZE_MAP[size];

  const particles = useMemo(() => {
    const w =
      parseInt(sizeConfig.container.split(" ")[0].replace("w-", "")) * 4;
    return Array.from({ length: sizeConfig.particleCount }, (_, i) => ({
      angle: (360 / sizeConfig.particleCount) * i,
      delay: i * 0.3,
      size: 2 + (i % 3),
      radius: w,
    }));
  }, [sizeConfig]);

  return (
    <motion.div
      className={`relative ${sizeConfig.container} ${className}`}
      style={{ perspective: "200px" }}
      animate={
        cuteMode
          ? { y: [0, -3, 0, -1.5, 0] }
          : undefined
      }
      transition={
        cuteMode
          ? { duration: 4.6, repeat: Infinity, ease: "easeInOut" }
          : undefined
      }
    >
      {/* Cute mode: soft ground halo behind everything */}
      {cuteMode && <CuteGroundHalo state={state} size={size} />}

      {/* SVG filters */}
      <svg width="0" height="0" className="absolute">
        <defs>
          <filter id={`soul-turbulence-${size}-${personality}`}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency={
                state === "idle"
                  ? "0.02"
                  : state === "thinking"
                    ? "0.05"
                    : "0.03"
              }
              numOctaves="3"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale={state === "idle" ? "2" : state === "thinking" ? "4" : "6"}
            />
          </filter>
          <filter id={`soul-glow-${size}-${personality}`}>
            <feGaussianBlur
              stdDeviation={String(sizeConfig.blur)}
              result="blur"
            />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      {/* Outer glow halo — 去背透暈 */}
      <motion.div
        className="absolute rounded-full"
        style={{ inset: "-35%", zIndex: 0 }}
        animate={{ boxShadow: config.glowPulse, opacity: [0.7, 1, 0.7] }}
        transition={{
          duration: config.breathDuration,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Core sphere */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          transformStyle: "preserve-3d",
          filter: `url(#soul-glow-${size}-${personality})`,
          zIndex: 1,
        }}
        animate={{
          rotateY: [0, 360],
          rotateX: state === "thinking" ? [0, 15, -15, 0] : [0, 5, -5, 0],
        }}
        transition={{
          rotateY: {
            duration: config.rotateSpeed,
            repeat: Infinity,
            ease: "linear",
          },
          rotateX: {
            duration: config.breathDuration * 2,
            repeat: Infinity,
            ease: "easeInOut",
          },
        }}
      >
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{ filter: `url(#soul-turbulence-${size}-${personality})` }}
          animate={{ background: config.gradient, scale: config.scale }}
          transition={{
            background: {
              duration: config.breathDuration * 2,
              repeat: Infinity,
              ease: "easeInOut",
            },
            scale: {
              duration: config.breathDuration,
              repeat: Infinity,
              ease: "easeInOut",
            },
          }}
        />
        {/* 中心白熱點光 */}
        <motion.div
          className="absolute rounded-full"
          style={{
            top: "12%",
            left: "15%",
            width: "40%",
            height: "35%",
            background:
              "radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.4) 50%, transparent 80%)",
          }}
          animate={{
            opacity: state === "generating" ? [0.7, 1.0, 0.7] : [0.6, 0.9, 0.6],
          }}
          transition={{
            duration: config.breathDuration,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </motion.div>

      {/* Cute mode: glossy top-rim highlight (plastic-cute feel) */}
      {cuteMode && (
        <div
          className="absolute pointer-events-none rounded-full overflow-hidden"
          style={{ inset: 0, zIndex: 3 }}
        >
          <div
            style={{
              position: "absolute",
              top: "6%",
              left: "18%",
              width: "64%",
              height: "26%",
              borderRadius: "50%",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.3) 50%, transparent 100%)",
              filter: "blur(0.8px)",
              opacity: 0.85,
            }}
          />
          {/* tiny pin-point specular */}
          <div
            style={{
              position: "absolute",
              top: "16%",
              left: "26%",
              width: "10%",
              height: "10%",
              borderRadius: "50%",
              background:
                "radial-gradient(circle, #ffffff 0%, rgba(255,255,255,0.6) 50%, transparent 80%)",
            }}
          />
        </div>
      )}

      {/* Cute face overlay (line-style eyes + mouth + cheeks) */}
      {cuteMode && <CuteFace state={state} size={size} />}

      {/* Cute mode: twinkling sparkle field around the orb */}
      {cuteMode && <CuteSparkleField size={size} state={state} />}

      {/* Cute mode: state-specific floating accessory icon */}
      {cuteMode && <CuteAccessory state={state} size={size} />}

      {/* Cute mode: ephemeral whisper bubble (idle/intermittent) */}
      {cuteMode && <CuteWhisperBubble state={state} size={size} />}

      {/* Orbiting particles */}
      {particles.map((p, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: p.size + 1,
            height: p.size + 1,
            background: `rgba(${colors.accent}, 1)`,
            boxShadow: `0 0 ${p.size * 3}px rgba(${colors.accent}, 0.9)`,
            top: "50%",
            left: "50%",
            marginTop: -(p.size + 1) / 2,
            marginLeft: -(p.size + 1) / 2,
          }}
          animate={{
            x: [
              Math.cos((p.angle * Math.PI) / 180) * p.radius,
              Math.cos(((p.angle + 180) * Math.PI) / 180) * p.radius,
              Math.cos((p.angle * Math.PI) / 180) * p.radius,
            ],
            y: [
              Math.sin((p.angle * Math.PI) / 180) * p.radius,
              Math.sin(((p.angle + 180) * Math.PI) / 180) * p.radius,
              Math.sin((p.angle * Math.PI) / 180) * p.radius,
            ],
            opacity: [
              config.particleOpacity * 0.6,
              config.particleOpacity,
              config.particleOpacity * 0.6,
            ],
          }}
          transition={{
            duration: config.rotateSpeed / 2,
            delay: p.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* 去背暈光圈 — 邊緣漸隐 */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          zIndex: 0,
          background: `radial-gradient(circle, transparent 35%, rgba(${colors.primary},0.2) 65%, transparent 100%)`,
        }}
        animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0.9, 0.5] }}
        transition={{
          duration: config.breathDuration * 1.5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Generating burst */}
      {state === "generating" && (
        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{ scale: [1, 1.8, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 1.0, repeat: Infinity, ease: "easeOut" }}
          style={{
            background: `radial-gradient(circle, rgba(${colors.accent},0.8) 0%, rgba(${colors.primary},0.3) 40%, transparent 70%)`,
          }}
        />
      )}
    </motion.div>
  );
}

// ─── Main Export ────────────────────────────────────────────────────────────

export default memo(function VisualSoul({
  state = "idle",
  personality = "creative",
  size = "md",
  visible = true,
  className = "",
  cuteMode = false,
}: Props) {
  if (!visible) return null;

  // sm → 預設輕量 CSS；但 thinking 狀態改為 3D，讓「思考光球」更有生命感
  if (size === "sm") {
    if (!cuteMode && state === "thinking") {
      return (
        <Suspense
          fallback={
            <CSSOrb
              state={state}
              personality={personality}
              size={size}
              className={className}
              cuteMode={cuteMode}
            />
          }
        >
          <VisualSoul3D
            state={state}
            personality={personality}
            size={size}
            className={className}
          />
        </Suspense>
      );
    }

    return (
      <CSSOrb
        state={state}
        personality={personality}
        size={size}
        className={className}
        cuteMode={cuteMode}
      />
    );
  }

  // md / lg / xl → 真 3D WebGL 光球（主角視覺），CSS fallback for Suspense
  // When cuteMode is on, use VisualSoul3D with cute colors + CuteFace overlay for true 3D look
  if (cuteMode) {
    const cuteColors = CUTE_STATE_COLORS[state];
    const customColors: OrbCustomColors = {
      colorPrimary: parseCuteColor(cuteColors.primary),
      colorSecondary: parseCuteColor(cuteColors.secondary),
      colorAccent: parseCuteColor(cuteColors.accent),
    };
    const sizeConfig = SIZE_MAP[size];
    return (
      <motion.div
        className={`relative ${sizeConfig.container} ${className}`}
        animate={{ y: [0, -3, 0, -1.5, 0] }}
        transition={{ duration: 4.6, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* Soft ground halo behind everything */}
        <CuteGroundHalo state={state} size={size} />

        <Suspense
          fallback={
            <CSSOrb
              state={state}
              personality={personality}
              size={size}
              cuteMode={cuteMode}
            />
          }
        >
          <VisualSoul3D
            state={state}
            personality={personality}
            size={size}
            customColors={customColors}
          />
        </Suspense>

        {/* Glossy top-rim highlight + pin-point specular */}
        <div
          className="absolute pointer-events-none rounded-full overflow-hidden"
          style={{ inset: 0, zIndex: 3 }}
        >
          <div
            style={{
              position: "absolute",
              top: "6%",
              left: "18%",
              width: "64%",
              height: "26%",
              borderRadius: "50%",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.22) 50%, transparent 100%)",
              filter: "blur(0.8px)",
              opacity: 0.75,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "16%",
              left: "26%",
              width: "10%",
              height: "10%",
              borderRadius: "50%",
              background:
                "radial-gradient(circle, #ffffff 0%, rgba(255,255,255,0.6) 50%, transparent 80%)",
            }}
          />
        </div>

        <CuteFace state={state} size={size} />
        <CuteSparkleField size={size} state={state} />
        <CuteAccessory state={state} size={size} />
        <CuteWhisperBubble state={state} size={size} />
      </motion.div>
    );
  }

  return (
    <Suspense
      fallback={
        <CSSOrb
          state={state}
          personality={personality}
          size={size}
          className={className}
          cuteMode={cuteMode}
        />
      }
    >
      <VisualSoul3D
        state={state}
        personality={personality}
        size={size}
        className={className}
      />
    </Suspense>
  );
});
