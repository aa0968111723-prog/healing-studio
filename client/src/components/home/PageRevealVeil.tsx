import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

interface Props {
  /** Tint of the veil. */
  color?: string;
  /** How long the veil stays at full opacity before fading (ms). */
  holdMs?: number;
  /** Total fade-out duration (s). */
  fadeDuration?: number;
}

/**
 * One-shot full-viewport veil that fades out shortly after the page mounts,
 * giving first paint a cinematic "curtain raise" feel.  Skipped when the
 * user prefers reduced motion.
 */
export default function PageRevealVeil({
  color = "rgba(8, 10, 24, 0.5)",
  holdMs = 80,
  fadeDuration = 1.2,
}: Props) {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (reduceMotion) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(false), holdMs);
    return () => clearTimeout(timer);
  }, [reduceMotion, holdMs]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[60]"
          style={{
            background: `radial-gradient(circle at 50% 35%, transparent 0%, ${color} 70%)`,
          }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: fadeDuration, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
    </AnimatePresence>
  );
}
