import { useEffect, useRef, useState } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";

interface Trail {
  id: number;
  x: number;
  y: number;
  color: string;
}

interface Props {
  /** Tint of the soft aura (e.g. scene glow color). */
  color?: string;
  /** Radius in px of the radial gradient. */
  radius?: number;
}

/**
 * PointerAura — a fixed, page-wide layer that follows the user's mouse OR
 * finger across the homepage and emits gentle trailing motes.  Works on
 * touch devices (each touchmove updates the aura position; touch end fades
 * it out).  Fully passive — `pointer-events: none` so it never blocks
 * clicks on underlying UI.
 *
 * Honours `prefers-reduced-motion` by rendering nothing.
 */
export default function PointerAura({
  color = "rgba(186,230,253,0.22)",
  radius = 220,
}: Props) {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState(false);
  const [trails, setTrails] = useState<Trail[]>([]);
  const trailIdRef = useRef(0);
  const lastTrailRef = useRef(0);

  const x = useMotionValue(-9999);
  const y = useMotionValue(-9999);
  const sx = useSpring(x, { stiffness: 90, damping: 18, mass: 0.5 });
  const sy = useSpring(y, { stiffness: 90, damping: 18, mass: 0.5 });
  const background = useMotionTemplate`radial-gradient(${radius}px circle at ${sx}px ${sy}px, ${color}, transparent 65%)`;

  useEffect(() => {
    if (reduceMotion) return;

    const updatePos = (clientX: number, clientY: number) => {
      x.set(clientX);
      y.set(clientY);
      setActive(true);

      // Drop a trailing mote at most ~every 90ms so it stays subtle.
      const now = performance.now();
      if (now - lastTrailRef.current > 90) {
        lastTrailRef.current = now;
        const id = ++trailIdRef.current;
        setTrails(prev => {
          const next = [...prev, { id, x: clientX, y: clientY, color }];
          // Cap to last 10 motes — the older ones are about to be filtered
          // out by their own timeouts anyway.
          return next.length > 10 ? next.slice(-10) : next;
        });
        window.setTimeout(() => {
          setTrails(prev => prev.filter(t => t.id !== id));
        }, 900);
      }
    };

    const onPointerMove = (e: PointerEvent) => updatePos(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) updatePos(t.clientX, t.clientY);
    };
    const fadeOut = () => {
      // Park the aura off-screen and let trails decay naturally.
      x.set(-9999);
      y.set(-9999);
      setActive(false);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", fadeOut);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", fadeOut);
    window.addEventListener("blur", fadeOut);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", fadeOut);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", fadeOut);
      window.removeEventListener("blur", fadeOut);
    };
  }, [reduceMotion, x, y, color]);

  if (reduceMotion) return null;

  return (
    <>
      <motion.div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[5]"
        style={{
          background,
          mixBlendMode: "screen",
          opacity: active ? 1 : 0,
          transition: "opacity 600ms ease-out",
        }}
      />
      {/* Trailing motes */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[6]">
        {trails.map(t => (
          <motion.span
            key={t.id}
            className="absolute rounded-full"
            style={{
              left: t.x,
              top: t.y,
              width: 6,
              height: 6,
              marginLeft: -3,
              marginTop: -3,
              background: `radial-gradient(circle, ${t.color}, transparent 70%)`,
              filter: "blur(1.5px)",
              mixBlendMode: "screen",
            }}
            initial={{ opacity: 0.7, scale: 0.6 }}
            animate={{ opacity: 0, scale: 1.6, y: -22 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        ))}
      </div>
    </>
  );
}
