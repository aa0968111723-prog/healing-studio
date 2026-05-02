import { motion, useReducedMotion } from "framer-motion";
import { useLocation } from "wouter";
import { type ReactNode } from "react";

/**
 * RouteTransition — wraps page content with a healing fade-up.
 * Uses Wouter's `useLocation` as motion key so each route gets a fresh
 * animation. Respects `prefers-reduced-motion` (opacity only).
 */
export default function RouteTransition({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const reduce = useReducedMotion();

  return (
    <motion.div
      key={location}
      data-page-key={location}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{
        duration: reduce ? 0.15 : 0.32,
        ease: [0.16, 1, 0.3, 1],
      }}
      // Plain wrapper that doesn't impose layout — pages provide their own.
      className="w-full"
    >
      {children}
    </motion.div>
  );
}
