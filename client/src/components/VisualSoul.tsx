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

import { useMemo, lazy, Suspense, memo } from "react";
import { motion } from "framer-motion";
import type { OrbCustomColors } from "./VisualSoul3D";

// ─── Helper: parse "r,g,b" cute color string to 0-1 normalized tuple ────────

function parseCuteColor(s: string): [number, number, number] {
  const [r, g, b] = s.split(",").map(v => parseInt(v.trim(), 10) / 255);
  return [r, g, b];
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

// ─── Cute Face SVG component ───────────────────────────────────────────────

function CuteFace({ state = "idle", size = "md" }: { state: AIState; size: string }) {
  const faceScale = size === "sm" ? 0.65 : size === "md" ? 0.8 : 1;
  const eyeColor = "#1a1a2e";
  const strokeWidth = size === "sm" ? 1.4 : 1.6;

  // Eye definitions per state
  const leftEye = () => {
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

  // Cheek blush marks (only for idle + generating)
  const cheeks = () => {
    if (state !== "idle" && state !== "generating" && state !== "listening") return null;
    return (
      <g opacity="0.45">
        <ellipse cx="9" cy="19" rx="3.5" ry="2" fill="#FF9EC0" />
        <ellipse cx="31" cy="19" rx="3.5" ry="2" fill="#FF9EC0" />
      </g>
    );
  };

  const faceW = 40;
  const faceH = 32;

  return (
    <svg
      viewBox={`0 0 ${faceW} ${faceH}`}
      width={faceW * faceScale}
      height={faceH * faceScale}
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 5,
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      {cheeks()}
      {leftEye()}
      {rightEye()}
      {mouth()}
    </svg>
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
    <div
      className={`relative ${sizeConfig.container} ${className}`}
      style={{ perspective: "200px" }}
    >
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

      {/* Cute face overlay (line-style eyes + mouth + cheeks) */}
      {cuteMode && <CuteFace state={state} size={size} />}

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
    </div>
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

  // sm → 輕量 CSS（側欄、工具列等小型使用場景）
  if (size === "sm") {
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
      <div className={`relative ${sizeConfig.container} ${className}`}>
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
        <CuteFace state={state} size={size} />
      </div>
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
