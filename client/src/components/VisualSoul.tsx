import { useMemo } from "react";
import { motion } from "framer-motion";

// ─── AI Global State Types ──────────────────────────────────────────────────

export type AIState = "idle" | "thinking" | "generating";

type Props = {
  state?: AIState;
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

// ─── State-driven visual configs ────────────────────────────────────────────

const STATE_CONFIG = {
  idle: {
    gradient: [
      "radial-gradient(circle at 35% 35%, rgba(212,197,226,0.9), rgba(200,213,224,0.7), rgba(234,201,193,0.5))",
      "radial-gradient(circle at 45% 45%, rgba(200,213,224,0.9), rgba(234,201,193,0.7), rgba(212,197,226,0.5))",
      "radial-gradient(circle at 35% 35%, rgba(212,197,226,0.9), rgba(200,213,224,0.7), rgba(234,201,193,0.5))",
    ],
    glowColor: "rgba(212,197,226,0.5)",
    glowPulse: [
      "0 0 12px rgba(212,197,226,0.3)",
      "0 0 20px rgba(212,197,226,0.5)",
      "0 0 12px rgba(212,197,226,0.3)",
    ],
    breathDuration: 3,
    rotateSpeed: 20,
    scale: [1, 1.03, 1],
    particleOpacity: 0.2,
  },
  thinking: {
    gradient: [
      "radial-gradient(circle at 30% 30%, rgba(251,191,36,0.9), rgba(248,113,113,0.7), rgba(167,139,250,0.5))",
      "radial-gradient(circle at 50% 50%, rgba(167,139,250,0.9), rgba(251,191,36,0.7), rgba(74,222,128,0.5))",
      "radial-gradient(circle at 40% 60%, rgba(74,222,128,0.9), rgba(248,113,113,0.7), rgba(251,191,36,0.5))",
      "radial-gradient(circle at 30% 30%, rgba(251,191,36,0.9), rgba(248,113,113,0.7), rgba(167,139,250,0.5))",
    ],
    glowColor: "rgba(251,191,36,0.6)",
    glowPulse: [
      "0 0 8px rgba(251,191,36,0.4)",
      "0 0 20px rgba(167,139,250,0.7)",
      "0 0 8px rgba(74,222,128,0.4)",
      "0 0 20px rgba(248,113,113,0.7)",
    ],
    breathDuration: 0.8,
    rotateSpeed: 4,
    scale: [0.97, 1.05, 0.97],
    particleOpacity: 0.6,
  },
  generating: {
    gradient: [
      "radial-gradient(circle at 50% 50%, rgba(96,165,250,0.95), rgba(167,139,250,0.8), rgba(251,191,36,0.6))",
      "radial-gradient(circle at 30% 30%, rgba(251,191,36,0.95), rgba(96,165,250,0.8), rgba(74,222,128,0.6))",
      "radial-gradient(circle at 50% 50%, rgba(96,165,250,0.95), rgba(167,139,250,0.8), rgba(251,191,36,0.6))",
    ],
    glowColor: "rgba(96,165,250,0.7)",
    glowPulse: [
      "0 0 16px rgba(96,165,250,0.5), 0 0 40px rgba(96,165,250,0.2)",
      "0 0 32px rgba(167,139,250,0.8), 0 0 60px rgba(96,165,250,0.4)",
      "0 0 16px rgba(96,165,250,0.5), 0 0 40px rgba(96,165,250,0.2)",
    ],
    breathDuration: 0.5,
    rotateSpeed: 2,
    scale: [0.95, 1.1, 0.95],
    particleOpacity: 0.9,
  },
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function VisualSoul({ state = "idle", size = "md", visible = true, className = "" }: Props) {
  const config = STATE_CONFIG[state];
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
          <filter id={`soul-turbulence-${size}`}>
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
          <filter id={`soul-glow-${size}`}>
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
          filter: `url(#soul-glow-${size})`,
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
            filter: `url(#soul-turbulence-${size})`,
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
            background: "radial-gradient(circle, rgba(96,165,250,0.4) 0%, transparent 70%)",
          }}
        />
      )}
    </div>
  );
}
