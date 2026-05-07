import { motion, useReducedMotion } from "framer-motion";

interface Props {
  /** Tint of the primary blob (rgba). Defaults to a soft sky tone. */
  primary?: string;
  /** Tint of the secondary blob. */
  secondary?: string;
  /** Tint of the accent blob. */
  accent?: string;
}

/**
 * Three large soft gradient blobs that drift slowly behind the hero —
 * an "aurora" backdrop reminiscent of premium AI products.  Animation
 * shuts off under prefers-reduced-motion.
 */
export default function AuroraBlobs({
  primary = "rgba(168,85,247,0.22)",
  secondary = "rgba(56,189,248,0.20)",
  accent = "rgba(236,72,153,0.18)",
}: Props) {
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
      {blob(primary, { top: "-12%", left: "-8%", size: "60%" })}
      {blob(secondary, { top: "20%", left: "55%", size: "55%" })}
      {blob(accent, { top: "55%", left: "12%", size: "45%" })}
    </div>
  );
}
