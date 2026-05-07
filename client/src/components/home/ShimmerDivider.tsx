import { motion, useReducedMotion } from "framer-motion";

interface Props {
  /** rgba/hex tint for the shimmer (defaults to a soft lavender). */
  color?: string;
  /** Tailwind max-width utility, defaults to `max-w-3xl`. */
  maxWidthClass?: string;
  /** Shimmer cycle length in seconds. */
  duration?: number;
}

/**
 * A horizontal hairline that gently shimmers a brighter highlight from
 * left to right.  Replaces the static `linear-gradient(transparent, color,
 * transparent)` dividers used throughout the homepage so section seams
 * feel alive without being distracting.
 */
export default function ShimmerDivider({
  color = "rgba(168,170,210,0.18)",
  maxWidthClass = "max-w-3xl",
  duration = 7,
}: Props) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      className={`relative z-10 h-px mx-auto overflow-hidden ${maxWidthClass}`}
      aria-hidden
    >
      {/* Base hairline */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
        }}
      />
      {/* Shimmer highlight */}
      {!reduceMotion && (
        <motion.div
          className="absolute inset-y-0 w-1/3"
          style={{
            background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)`,
            mixBlendMode: "overlay",
          }}
          initial={{ x: "-50%" }}
          animate={{ x: "350%" }}
          transition={{
            duration,
            ease: "easeInOut",
            repeat: Infinity,
            repeatDelay: 2,
          }}
        />
      )}
    </div>
  );
}
