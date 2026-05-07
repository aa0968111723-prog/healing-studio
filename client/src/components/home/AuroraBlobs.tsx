import { motion, useReducedMotion } from "framer-motion";

export type AuroraSceneId = "nightSky" | "morning" | "cafe" | "deepSea";

/**
 * Per-scene blob palettes.  Each scene gets a distinct triad so the
 * homepage feels visibly different across the 4 time-of-day moods.
 *
 * Alphas are intentionally low (0.10–0.18) so the underlying ambient
 * particles and page gradient still read through.
 */
export const AURORA_SCENE_PALETTES: Record<
  AuroraSceneId,
  { primary: string; secondary: string; accent: string }
> = {
  nightSky: {
    primary: "rgba(99,102,241,0.18)", // indigo
    secondary: "rgba(139,92,246,0.16)", // violet
    accent: "rgba(56,189,248,0.12)", // sky
  },
  morning: {
    primary: "rgba(251,191,36,0.16)", // amber
    secondary: "rgba(244,114,182,0.14)", // rose
    accent: "rgba(253,224,71,0.12)", // sun yellow
  },
  cafe: {
    primary: "rgba(217,119,6,0.14)", // amber-deep
    secondary: "rgba(180,83,9,0.12)", // sepia
    accent: "rgba(245,158,11,0.10)", // honey
  },
  deepSea: {
    primary: "rgba(20,184,166,0.16)", // teal
    secondary: "rgba(56,189,248,0.16)", // sky
    accent: "rgba(99,102,241,0.12)", // indigo
  },
};

interface Props {
  /** Optional explicit tints. If omitted, derived from `sceneId`. */
  primary?: string;
  secondary?: string;
  accent?: string;
  /** Pick a per-scene palette automatically. */
  sceneId?: AuroraSceneId;
}

/**
 * Three large soft gradient blobs that drift slowly behind the hero —
 * an "aurora" backdrop tuned per-scene so each of the 4 time-of-day
 * moods feels visually distinct.  Animation shuts off under
 * prefers-reduced-motion.
 */
export default function AuroraBlobs({ sceneId, primary, secondary, accent }: Props) {
  const palette = sceneId ? AURORA_SCENE_PALETTES[sceneId] : null;
  const p = primary ?? palette?.primary ?? "rgba(168,85,247,0.18)";
  const s = secondary ?? palette?.secondary ?? "rgba(56,189,248,0.16)";
  const a = accent ?? palette?.accent ?? "rgba(236,72,153,0.14)";
  const reduceMotion = useReducedMotion();

  const blob = (color: string, base: { top: string; left: string; size: string }) => (
    <motion.div
      aria-hidden
      className="absolute rounded-full"
      style={{
        top: base.top,
        left: base.left,
        width: base.size,
        height: base.size,
        background: `radial-gradient(circle, ${color} 0%, transparent 65%)`,
        filter: "blur(30px)",
      }}
      animate={
        reduceMotion
          ? undefined
          : {
              x: [0, 40, -20, 0],
              y: [0, -30, 25, 0],
              scale: [1, 1.08, 0.96, 1],
            }
      }
      transition={
        reduceMotion
          ? undefined
          : {
              duration: 22,
              repeat: Infinity,
              ease: "easeInOut",
            }
      }
    />
  );

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {blob(p, { top: "-12%", left: "-8%", size: "60%" })}
      {blob(s, { top: "20%", left: "55%", size: "55%" })}
      {blob(a, { top: "55%", left: "12%", size: "45%" })}
    </div>
  );
}
