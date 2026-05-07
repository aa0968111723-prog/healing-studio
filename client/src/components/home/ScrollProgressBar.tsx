import { motion, useScroll, useSpring } from "framer-motion";

interface Props {
  /** Tint of the progress fill — defaults to a soft scene-neutral cyan. */
  color?: string;
}

/**
 * Hairline progress bar pinned to the very top of the viewport.  Fills
 * from 0 to 100% as the user scrolls, with a spring-smoothed motion.
 * Stays under nav bar (z-40) so it doesn't fight with the orb panel.
 */
export default function ScrollProgressBar({
  color = "rgba(125,211,252,0.85)",
}: Props) {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 90,
    damping: 22,
    mass: 0.4,
  });

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 right-0 h-[2px] origin-left z-[51]"
      style={{
        scaleX,
        background: `linear-gradient(90deg, transparent, ${color} 50%, transparent)`,
        boxShadow: `0 0 12px ${color}`,
      }}
    />
  );
}
