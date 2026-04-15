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

import { useMemo, lazy, Suspense } from "react";
import { motion } from "framer-motion";

// ─── Types ─────────────────────────────────────────────────────────────────

export type AIState   = "idle" | "thinking" | "generating" | "listening" | "acting";
export type Personality = "calm" | "creative" | "technical";

type Props = {
  state?:       AIState;
  personality?: Personality;
  size?:        "sm" | "md" | "lg" | "xl";
  visible?:     boolean;
  className?:   string;
};

// ─── Lazy-load the heavy 3D component ─────────────────────────────────────

const VisualSoul3D = lazy(() => import("./VisualSoul3D"));

// ─── CSS Size Map ──────────────────────────────────────────────────────────

const SIZE_MAP = {
  sm:  { container: "w-7 h-7",   blur: 5,  particleCount: 3 },
  md:  { container: "w-12 h-12", blur: 10, particleCount: 5 },
  lg:  { container: "w-16 h-16", blur: 14, particleCount: 7 },
  xl:  { container: "w-24 h-24", blur: 18, particleCount: 9 },
};

// ─── CSS Personality Colors ─────────────────────────────────────────────────

const PERSONALITY_COLORS = {
  calm: {
    primary:   "0,210,255",    // 亮青 #00D2FF
    secondary: "100,240,255",  // 天藍白
    accent:    "200,255,255",  // 冰白
    breathDurationMultiplier: 1.5,
  },
  creative: {
    primary:   "255,80,180",   // 亮粉 #FF50B4
    secondary: "255,160,60",   // 橘粉
    accent:    "255,230,0",    // 亮黃
    breathDurationMultiplier: 1.0,
  },
  technical: {
    primary:   "80,255,180",   // 亮綠 #50FFB4
    secondary: "0,200,120",    // 翠綠
    accent:    "150,255,200",  // 薄荷
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
      glowColor:     `rgba(${colors.primary},0.4)`,
      glowPulse:     [`0 0 10px rgba(${colors.primary},0.25), 0 0 24px rgba(${colors.primary},0.1)`, `0 0 18px rgba(${colors.primary},0.4), 0 0 36px rgba(${colors.primary},0.18)`, `0 0 10px rgba(${colors.primary},0.25), 0 0 24px rgba(${colors.primary},0.1)`],
      breathDuration: 4 * bm,
      rotateSpeed:   25,
      scale:         [1, 1.03, 1] as number[],
      particleOpacity: 0.2,
    },
    thinking: {
      gradient: [
        `radial-gradient(circle at 30% 30%, rgba(${colors.accent},0.9), rgba(${colors.primary},0.7), rgba(${colors.secondary},0.5))`,
        `radial-gradient(circle at 50% 50%, rgba(${colors.secondary},0.9), rgba(${colors.accent},0.7), rgba(${colors.primary},0.5))`,
        `radial-gradient(circle at 40% 60%, rgba(${colors.primary},0.9), rgba(${colors.secondary},0.7), rgba(${colors.accent},0.5))`,
        `radial-gradient(circle at 30% 30%, rgba(${colors.accent},0.9), rgba(${colors.primary},0.7), rgba(${colors.secondary},0.5))`,
      ],
      glowColor:     `rgba(${colors.accent},0.6)`,
      glowPulse:     [`0 0 8px rgba(${colors.accent},0.4)`, `0 0 20px rgba(${colors.primary},0.7)`, `0 0 8px rgba(${colors.secondary},0.4)`, `0 0 20px rgba(${colors.accent},0.7)`],
      breathDuration: 0.8 * bm,
      rotateSpeed:   4,
      scale:         [0.97, 1.05, 0.97] as number[],
      particleOpacity: 0.6,
    },
    generating: {
      gradient: [
        `radial-gradient(circle at 50% 50%, rgba(${colors.primary},0.95), rgba(${colors.accent},0.8), rgba(${colors.secondary},0.6))`,
        `radial-gradient(circle at 30% 30%, rgba(${colors.accent},0.95), rgba(${colors.primary},0.8), rgba(${colors.secondary},0.6))`,
        `radial-gradient(circle at 50% 50%, rgba(${colors.primary},0.95), rgba(${colors.accent},0.8), rgba(${colors.secondary},0.6))`,
      ],
      glowColor:     `rgba(${colors.primary},0.7)`,
      glowPulse:     [`0 0 16px rgba(${colors.primary},0.5), 0 0 40px rgba(${colors.primary},0.2)`, `0 0 32px rgba(${colors.accent},0.8), 0 0 60px rgba(${colors.primary},0.4)`, `0 0 16px rgba(${colors.primary},0.5), 0 0 40px rgba(${colors.primary},0.2)`],
      breathDuration: 0.5 * bm,
      rotateSpeed:   2,
      scale:         [0.95, 1.1, 0.95] as number[],
      particleOpacity: 0.9,
    },
    listening: {
      gradient: [
        `radial-gradient(circle at 40% 40%, rgba(${colors.secondary},0.85), rgba(${colors.primary},0.65), rgba(${colors.accent},0.45))`,
        `radial-gradient(circle at 50% 50%, rgba(${colors.primary},0.85), rgba(${colors.secondary},0.65), rgba(${colors.accent},0.45))`,
        `radial-gradient(circle at 40% 40%, rgba(${colors.secondary},0.85), rgba(${colors.primary},0.65), rgba(${colors.accent},0.45))`,
      ],
      glowColor:     `rgba(${colors.secondary},0.5)`,
      glowPulse:     [`0 0 14px rgba(${colors.secondary},0.35), 0 0 28px rgba(${colors.secondary},0.15)`, `0 0 20px rgba(${colors.secondary},0.55), 0 0 42px rgba(${colors.secondary},0.25)`, `0 0 14px rgba(${colors.secondary},0.35), 0 0 28px rgba(${colors.secondary},0.15)`],
      breathDuration: 1.2 * bm,
      rotateSpeed:   15,
      scale:         [1, 1.06, 1] as number[],
      particleOpacity: 0.5,
    },
    acting: {
      gradient: [
        `radial-gradient(circle at 45% 45%, rgba(${colors.accent},0.95), rgba(${colors.primary},0.8), rgba(${colors.secondary},0.5))`,
        `radial-gradient(circle at 35% 35%, rgba(${colors.primary},0.95), rgba(${colors.accent},0.8), rgba(${colors.secondary},0.5))`,
        `radial-gradient(circle at 45% 45%, rgba(${colors.accent},0.95), rgba(${colors.primary},0.8), rgba(${colors.secondary},0.5))`,
      ],
      glowColor:     `rgba(${colors.accent},0.7)`,
      glowPulse:     [`0 0 20px rgba(${colors.accent},0.5), 0 0 40px rgba(${colors.accent},0.2)`, `0 0 36px rgba(${colors.accent},0.8), 0 0 56px rgba(${colors.accent},0.4)`, `0 0 20px rgba(${colors.accent},0.5), 0 0 40px rgba(${colors.accent},0.2)`],
      breathDuration: 0.6 * bm,
      rotateSpeed:   3,
      scale:         [0.96, 1.08, 0.96] as number[],
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
}: Props) {
  const config     = getStateConfig(state, personality);
  const sizeConfig = SIZE_MAP[size];

  const particles = useMemo(() => {
    const w = parseInt(sizeConfig.container.split(" ")[0].replace("w-", "")) * 4;
    return Array.from({ length: sizeConfig.particleCount }, (_, i) => ({
      angle:   (360 / sizeConfig.particleCount) * i,
      delay:   i * 0.3,
      size:    2 + (i % 3),
      radius:  w,
    }));
  }, [sizeConfig]);

  const colors = PERSONALITY_COLORS[personality];

  return (
    <div className={`relative ${sizeConfig.container} ${className}`} style={{ perspective: "200px" }}>
      {/* SVG filters */}
      <svg width="0" height="0" className="absolute">
        <defs>
          <filter id={`soul-turbulence-${size}-${personality}`}>
            <feTurbulence type="fractalNoise" baseFrequency={state === "idle" ? "0.02" : state === "thinking" ? "0.05" : "0.03"} numOctaves="3" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={state === "idle" ? "2" : state === "thinking" ? "4" : "6"} />
          </filter>
          <filter id={`soul-glow-${size}-${personality}`}>
            <feGaussianBlur stdDeviation={String(sizeConfig.blur)} result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
      </svg>

      {/* Outer glow halo — 去背透暈 */}
      <motion.div className="absolute rounded-full"
        style={{ inset: "-35%", zIndex: 0 }}
        animate={{ boxShadow: config.glowPulse, opacity: [0.7, 1, 0.7] }}
        transition={{ duration: config.breathDuration, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Core sphere */}
      <motion.div className="absolute inset-0 rounded-full" style={{ transformStyle: "preserve-3d", filter: `url(#soul-glow-${size}-${personality})`, zIndex: 1 }}
        animate={{ rotateY: [0, 360], rotateX: state === "thinking" ? [0, 15, -15, 0] : [0, 5, -5, 0] }}
        transition={{ rotateY: { duration: config.rotateSpeed, repeat: Infinity, ease: "linear" }, rotateX: { duration: config.breathDuration * 2, repeat: Infinity, ease: "easeInOut" } }}
      >
        <motion.div className="absolute inset-0 rounded-full" style={{ filter: `url(#soul-turbulence-${size}-${personality})` }}
          animate={{ background: config.gradient, scale: config.scale }}
          transition={{ background: { duration: config.breathDuration * 2, repeat: Infinity, ease: "easeInOut" }, scale: { duration: config.breathDuration, repeat: Infinity, ease: "easeInOut" } }}
        />
        {/* 中心白熱點光 */}
        <motion.div className="absolute rounded-full"
          style={{ top: "12%", left: "15%", width: "40%", height: "35%", background: "radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.4) 50%, transparent 80%)" }}
          animate={{ opacity: state === "generating" ? [0.7, 1.0, 0.7] : [0.6, 0.9, 0.6] }}
          transition={{ duration: config.breathDuration, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>

      {/* Orbiting particles */}
      {particles.map((p, i) => (
        <motion.div key={i} className="absolute rounded-full"
          style={{
            width: p.size + 1, height: p.size + 1,
            background: `rgba(${colors.accent}, 1)`,
            boxShadow: `0 0 ${p.size * 3}px rgba(${colors.accent}, 0.9)`,
            top: "50%", left: "50%",
            marginTop: -(p.size + 1) / 2, marginLeft: -(p.size + 1) / 2,
          }}
          animate={{
            x: [Math.cos((p.angle * Math.PI) / 180) * p.radius, Math.cos(((p.angle + 180) * Math.PI) / 180) * p.radius, Math.cos((p.angle * Math.PI) / 180) * p.radius],
            y: [Math.sin((p.angle * Math.PI) / 180) * p.radius, Math.sin(((p.angle + 180) * Math.PI) / 180) * p.radius, Math.sin((p.angle * Math.PI) / 180) * p.radius],
            opacity: [config.particleOpacity * 0.6, config.particleOpacity, config.particleOpacity * 0.6],
          }}
          transition={{ duration: config.rotateSpeed / 2, delay: p.delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}

      {/* 去背暈光圈 — 邊緣漸隐 */}
      <motion.div className="absolute inset-0 rounded-full"
        style={{ zIndex: 0, background: `radial-gradient(circle, transparent 35%, rgba(${colors.primary},0.2) 65%, transparent 100%)` }}
        animate={{ scale: [1, 1.25, 1], opacity: [0.5, 0.9, 0.5] }}
        transition={{ duration: config.breathDuration * 1.5, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Generating burst */}
      {state === "generating" && (
        <motion.div className="absolute inset-0 rounded-full"
          animate={{ scale: [1, 1.8, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 1.0, repeat: Infinity, ease: "easeOut" }}
          style={{ background: `radial-gradient(circle, rgba(${colors.accent},0.8) 0%, rgba(${colors.primary},0.3) 40%, transparent 70%)` }}
        />
      )}
    </div>
  );
}

// ─── Main Export ────────────────────────────────────────────────────────────

export default function VisualSoul({
  state       = "idle",
  personality = "creative",
  size        = "md",
  visible     = true,
  className   = "",
}: Props) {
  if (!visible) return null;

  // sm → 輕量 CSS（側欄、工具列等小型使用場景）
  if (size === "sm") {
    return <CSSOrb state={state} personality={personality} size={size} className={className} />;
  }

  // md / lg / xl → 真 3D WebGL 光球（主角視覺），CSS fallback for Suspense
  return (
    <Suspense fallback={<CSSOrb state={state} personality={personality} size={size} className={className} />}>
      <VisualSoul3D
        state={state}
        personality={personality}
        size={size}
        className={className}
      />
    </Suspense>
  );
}
