import { useMemo } from "react";
import { motion } from "framer-motion";

// ─── AI Global State Types ──────────────────────────────────────────────────

export type AIState = "idle" | "thinking" | "generating";
export type Personality = "calm" | "creative" | "technical";

type Props = {
  state?: AIState;
  personality?: Personality;
  size?: "sm" | "md" | "lg";
  visible?: boolean;
  className?: string;
};

// ─── Size Config ────────────────────────────────────────────────────────────

const SIZE_MAP = {
  sm: { container: "w-6 h-6", blur: 4, particleCount: 3 },
  md: { container: "w-10 h-10", blur: 8, particleCount: 5 },
  lg: { container: "w-14 h-14", blur: 12, particleCount: 7 },
};

// ─── Personality Color Palettes ────────────────────────────────────────────
// PDF Spec: Calm=#0D1B2A(深藍), Creative=#FF6F61(暖橘), Technical=#7B2CBF(電紫)

const PERSONALITY_COLORS = {
  calm: {
    primary: "0,210,255",       // 電藍光
    secondary: "100,240,255",   // 冰藍
    accent: "200,255,255",      // 白藍
    breathDurationMultiplier: 1.5, // slower, calmer
  },
  creative: {
    primary: "255,80,180",      // 霓虹粉
    secondary: "255,160,60",    // 暖橘
    accent: "255,230,0",        // 亮黃
    breathDurationMultiplier: 1.0, // default rhythm
  },
  technical: {
    primary: "80,255,180",      // 螢光綠
    secondary: "0,200,120",     // 青綠
    accent: "150,255,200",      // 薄荷
    breathDurationMultiplier: 0.7, // faster, more precise
  },
};

// ─── State-driven visual configs (now personality-aware) ───────────────────

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
      glowColor: `rgba(${colors.primary},0.5)`,
      glowPulse: [
        `0 0 12px rgba(${colors.primary},0.3)`,
        `0 0 20px rgba(${colors.primary},0.5)`,
        `0 0 12px rgba(${colors.primary},0.3)`,
      ],
      breathDuration: 3 * bm,
      rotateSpeed: 20,
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
  };

  return configs[state];
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function VisualSoul({
  state = "idle",
  personality = "creative",
  size = "md",
  visible = true,
  className = "",
}: Props) {
  const config = getStateConfig(state, personality);
  const sizeConfig = SIZE_MAP[size];

  // Generate particle positions (stable across renders)
  const particles = useMemo(() => {
    return Array.from({ length: sizeConfig.particleCount }, (_, i) => ({
      angle: (360 / sizeConfig.particleCount) * i,
      delay: i * 0.3,
      size: 2 + Math.random() * 2,
    }));
  }, [sizeConfig.particleCount]);

  if (!visible) return null;

  return (
    <div className={`relative ${sizeConfig.container} ${className}`} style={{ perspective: "200px" }}>
      {/* SVG Filter for organic distortion */}
      <svg width="0" height="0" className="absolute">
        <defs>
          <filter id={`soul-turbulence-${size}-${personality}`}>
            <feTurbulence
              type="fractalNoise"
              baseFrequency={state === "idle" ? "0.02" : state === "thinking" ? "0.05" : "0.03"}
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
            <feGaussianBlur stdDeviation={String(sizeConfig.blur)} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      {/* Outer glow ring */}
      <motion.div
        className="absolute inset-0 rounded-full"
        animate={{
          boxShadow: config.glowPulse,
        }}
        transition={{
          duration: config.breathDuration,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* 3D rotating shell */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          transformStyle: "preserve-3d",
          filter: `url(#soul-glow-${size}-${personality})`,
        }}
        animate={{
          rotateY: [0, 360],
          rotateX: state === "thinking" ? [0, 15, -15, 0] : [0, 5, -5, 0],
        }}
        transition={{
          rotateY: { duration: config.rotateSpeed, repeat: Infinity, ease: "linear" },
          rotateX: { duration: config.breathDuration * 2, repeat: Infinity, ease: "easeInOut" },
        }}
      >
        {/* Core sphere with animated gradient */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            filter: `url(#soul-turbulence-${size}-${personality})`,
          }}
          animate={{
            background: config.gradient,
            scale: config.scale,
          }}
          transition={{
            background: { duration: config.breathDuration * 2, repeat: Infinity, ease: "easeInOut" },
            scale: { duration: config.breathDuration, repeat: Infinity, ease: "easeInOut" },
          }}
        />

        {/* Inner highlight (specular) */}
        <motion.div
          className="absolute rounded-full"
          style={{
            top: "15%",
            left: "20%",
            width: "35%",
            height: "30%",
            background: "radial-gradient(circle, rgba(255,255,255,0.6) 0%, transparent 70%)",
          }}
          animate={{
            opacity: state === "generating" ? [0.4, 0.8, 0.4] : [0.3, 0.5, 0.3],
          }}
          transition={{ duration: config.breathDuration, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>

      {/* Orbiting particles */}
      {particles.map((p, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: p.size,
            height: p.size,
            background: config.glowColor,
            top: "50%",
            left: "50%",
            marginTop: -p.size / 2,
            marginLeft: -p.size / 2,
          }}
          animate={{
            x: [
              Math.cos((p.angle * Math.PI) / 180) * (parseInt(sizeConfig.container.split(" ")[0].replace("w-", "")) * 2.5),
              Math.cos(((p.angle + 180) * Math.PI) / 180) * (parseInt(sizeConfig.container.split(" ")[0].replace("w-", "")) * 2.5),
              Math.cos((p.angle * Math.PI) / 180) * (parseInt(sizeConfig.container.split(" ")[0].replace("w-", "")) * 2.5),
            ],
            y: [
              Math.sin((p.angle * Math.PI) / 180) * (parseInt(sizeConfig.container.split(" ")[0].replace("w-", "")) * 2.5),
              Math.sin(((p.angle + 180) * Math.PI) / 180) * (parseInt(sizeConfig.container.split(" ")[0].replace("w-", "")) * 2.5),
              Math.sin((p.angle * Math.PI) / 180) * (parseInt(sizeConfig.container.split(" ")[0].replace("w-", "")) * 2.5),
            ],
            opacity: [config.particleOpacity * 0.5, config.particleOpacity, config.particleOpacity * 0.5],
          }}
          transition={{
            duration: config.rotateSpeed / 2,
            delay: p.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* Generating: expansion burst effect */}
      {state === "generating" && (
        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{
            scale: [1, 1.6, 1],
            opacity: [0.3, 0, 0.3],
          }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            ease: "easeOut",
          }}
          style={{
            background: `radial-gradient(circle, rgba(${PERSONALITY_COLORS[personality].primary},0.4) 0%, transparent 70%)`,
          }}
        />
      )}
    </div>
  );
}
