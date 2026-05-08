import { useEffect, useRef } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";

interface Props {
  /** Tint of the spotlight, e.g. "rgba(125,211,252,0.35)". */
  color?: string;
  /** Radius of the radial gradient in pixels. */
  radius?: number;
}

/**
 * A cursor-following soft radial spotlight.  Mounts only on hover-capable
 * devices and when the user has not requested reduced motion.  Fully
 * absolute-positioned — drop it inside any `position: relative` ancestor.
 */
export default function HeroMagneticSpotlight({
  color = "rgba(125,211,252,0.32)",
  radius = 360,
}: Props) {
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Motion values track raw pointer position; spring smooths them.
  const x = useMotionValue(-9999);
  const y = useMotionValue(-9999);
  const sx = useSpring(x, { stiffness: 110, damping: 18, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 110, damping: 18, mass: 0.6 });

  const background = useMotionTemplate`radial-gradient(${radius}px circle at ${sx}px ${sy}px, ${color}, transparent 70%)`;

  useEffect(() => {
    if (reduceMotion) return;
    const el = containerRef.current?.parentElement;
    if (!el) return;

    // Pointer events fire for both mouse + touch, so the spotlight follows
    // a finger drag on mobile too (centred under the touch point).
    const setFromClient = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      x.set(clientX - rect.left);
      y.set(clientY - rect.top);
    };
    const onMove = (e: PointerEvent) => setFromClient(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) setFromClient(t.clientX, t.clientY);
    };
    const onLeave = () => {
      x.set(-9999);
      y.set(-9999);
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onLeave);
    };
  }, [reduceMotion, x, y]);

  if (reduceMotion) return null;

  return (
    <motion.div
      ref={containerRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0"
      style={{ background, mixBlendMode: "screen" }}
    />
  );
}
