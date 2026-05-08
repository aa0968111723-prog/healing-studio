import { useEffect, useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import ConstellationField from "./ConstellationField";
import CausticsPattern from "./CausticsPattern";
import MorningSunRays from "./MorningSunRays";
import CafeSteamWisps from "./CafeSteamWisps";
import { useIsMobile } from "@/hooks/useMobile";

export type JewelSceneId = "nightSky" | "morning" | "cafe" | "deepSea";

interface Props {
  sceneId: JewelSceneId;
  children: React.ReactNode;
  /** Optional click handler — if provided, clicking the orb emits a ripple. */
  onTap?: () => void;
}

interface Ripple {
  id: number;
  /** Tint of the ripple ring. */
  color: string;
}

const RIPPLE_TINT: Record<JewelSceneId, string> = {
  nightSky: "rgba(167,139,250,0.45)",
  morning: "rgba(251,191,36,0.45)",
  cafe: "rgba(217,119,6,0.40)",
  deepSea: "rgba(56,189,248,0.45)",
};

/**
 * JewelOrbStage — wraps the Hero orb with scene-specific interactive
 * decorations, turning it into a "光球寶珠" experience.
 *
 *   - nightSky → ConstellationField behind the orb (pointer-reactive lines)
 *   - deepSea  → CausticsPattern + rising bubble streams
 *   - other    → neutral (decorations skipped)
 *
 * Always-on:
 *   - Cursor-tilt parallax (gently rotates the orb toward the pointer)
 *   - Click/tap ripple emanating outward from the centre
 *   - Hover bloom (subtle accent halo intensifies)
 *
 * Honours `prefers-reduced-motion` and disables tilt on touch devices.
 */
export default function JewelOrbStage({ sceneId, children, onTap }: Props) {
  const reduceMotion = useReducedMotion();
  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [hovering, setHovering] = useState(false);
  const [tiltEnabled, setTiltEnabled] = useState(false);

  // Mobile reduces the bloom and shimmer arc so the small orb isn't
  // swallowed by an oversized ring.
  const bloomSize = isMobile ? 150 : 240;
  const shimmerSize = isMobile ? 130 : 200;
  const rippleStart = isMobile ? 40 : 60;
  const rippleEnd = isMobile ? 220 : 320;

  // Pointer position relative to centre, normalised to [-1, 1].
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotX = useSpring(useTransform(py, [-1, 1], [8, -8]), {
    stiffness: 90,
    damping: 14,
  });
  const rotY = useSpring(useTransform(px, [-1, 1], [-10, 10]), {
    stiffness: 90,
    damping: 14,
  });
  const orbX = useSpring(useTransform(px, [-1, 1], [-6, 6]), {
    stiffness: 90,
    damping: 14,
  });
  const orbY = useSpring(useTransform(py, [-1, 1], [-6, 6]), {
    stiffness: 90,
    damping: 14,
  });

  useEffect(() => {
    if (reduceMotion) {
      setTiltEnabled(false);
      return;
    }
    // Tilt is now enabled for both mouse + touch — pointer events fire for
    // both, and the touch handlers below explicitly cover finger-drag too.
    setTiltEnabled(true);
  }, [reduceMotion]);

  useEffect(() => {
    if (!tiltEnabled) return;
    const el = containerRef.current;
    if (!el) return;
    const setFromClient = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const ratioX = (clientX - cx) / Math.max(rect.width / 2, 1);
      const ratioY = (clientY - cy) / Math.max(rect.height / 2, 1);
      px.set(Math.max(-1.5, Math.min(1.5, ratioX)));
      py.set(Math.max(-1.5, Math.min(1.5, ratioY)));
    };
    const onMove = (e: PointerEvent) => setFromClient(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) {
        setFromClient(t.clientX, t.clientY);
        setHovering(true);
      }
    };
    const onLeave = () => {
      px.set(0);
      py.set(0);
      setHovering(false);
    };
    const onEnter = () => setHovering(true);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onLeave);
    };
  }, [tiltEnabled, px, py]);

  const handleTap = () => {
    const id = Date.now() + Math.random();
    setRipples(prev => [...prev, { id, color: RIPPLE_TINT[sceneId] }]);
    setTimeout(() => {
      setRipples(prev => prev.filter(r => r.id !== id));
    }, 1200);
    onTap?.();
  };

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center"
      style={{ perspective: 800 }}
      onClick={handleTap}
    >
      {/* Scene-specific backdrop decoration */}
      {sceneId === "nightSky" && <ConstellationField hovering={hovering} />}
      {sceneId === "deepSea" && <CausticsPattern hovering={hovering} />}
      {sceneId === "morning" && <MorningSunRays hovering={hovering} />}
      {sceneId === "cafe" && <CafeSteamWisps hovering={hovering} />}

      {/* Hover bloom — intensifies the scene's signature glow.
          On mobile the bloom is smaller and dimmer so it doesn't form
          a heavy ring around a small orb. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute rounded-full"
        style={{
          width: bloomSize,
          height: bloomSize,
          background: `radial-gradient(circle, ${RIPPLE_TINT[sceneId]} 0%, transparent 65%)`,
          filter: "blur(20px)",
        }}
        animate={{
          opacity: hovering ? (isMobile ? 0.55 : 0.9) : isMobile ? 0.28 : 0.5,
          scale: hovering ? 1.12 : 1,
        }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Click ripples */}
      <AnimatePresence>
        {ripples.map(r => (
          <motion.div
            key={r.id}
            aria-hidden
            className="pointer-events-none absolute rounded-full"
            initial={{ width: rippleStart, height: rippleStart, opacity: 0.7 }}
            animate={{ width: rippleEnd, height: rippleEnd, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
            style={{ border: `2px solid ${r.color}` }}
          />
        ))}
      </AnimatePresence>

      {/* The orb itself, tilted toward pointer */}
      <motion.div
        className="relative z-10"
        style={
          tiltEnabled
            ? {
                rotateX: rotX,
                rotateY: rotY,
                x: orbX,
                y: orbY,
                transformStyle: "preserve-3d",
              }
            : undefined
        }
      >
        {children}
      </motion.div>

      {/* Specular shimmer arc — orbits subtly around the orb.
          Skipped on mobile where the arc would crowd the small orb. */}
      {!reduceMotion && !isMobile && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute rounded-full"
          style={{
            width: shimmerSize,
            height: shimmerSize,
            border: `1px solid ${RIPPLE_TINT[sceneId].replace(/0\.\d+\)$/, "0.20)")}`,
            boxShadow: `inset 0 0 30px ${RIPPLE_TINT[sceneId]}`,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
        />
      )}
    </div>
  );
}
