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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [hovering, setHovering] = useState(false);
  const [tiltEnabled, setTiltEnabled] = useState(false);

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
    if (reduceMotion) return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setTiltEnabled(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [reduceMotion]);

  useEffect(() => {
    if (!tiltEnabled) return;
    const el = containerRef.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const ratioX = (e.clientX - cx) / (rect.width / 2);
      const ratioY = (e.clientY - cy) / (rect.height / 2);
      px.set(Math.max(-1.5, Math.min(1.5, ratioX)));
      py.set(Math.max(-1.5, Math.min(1.5, ratioY)));
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
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerenter", onEnter);
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

      {/* Hover bloom — intensifies the scene's signature glow */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute rounded-full"
        style={{
          width: 240,
          height: 240,
          background: `radial-gradient(circle, ${RIPPLE_TINT[sceneId]} 0%, transparent 65%)`,
          filter: "blur(20px)",
        }}
        animate={{
          opacity: hovering ? 0.9 : 0.5,
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
            initial={{ width: 60, height: 60, opacity: 0.7 }}
            animate={{ width: 320, height: 320, opacity: 0 }}
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

      {/* Specular shimmer arc — orbits subtly around the orb */}
      {!reduceMotion && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute rounded-full"
          style={{
            width: 200,
            height: 200,
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
