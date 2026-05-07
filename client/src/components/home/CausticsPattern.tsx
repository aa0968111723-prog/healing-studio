import { motion, useReducedMotion } from "framer-motion";

interface Bubble {
  x: number;
  size: number;
  delay: number;
  duration: number;
  drift: number;
}

function buildBubbles(count: number): Bubble[] {
  const bubbles: Bubble[] = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < count; i += 1) {
    bubbles.push({
      x: rand() * 100,
      size: 3 + rand() * 7,
      delay: rand() * 6,
      duration: 5 + rand() * 4,
      drift: (rand() - 0.5) * 12,
    });
  }
  return bubbles;
}

const BUBBLES = buildBubbles(12);

interface Props {
  hovering: boolean;
}

/**
 * Underwater visual layer for the deepSea jewel orb stage.  Combines:
 *   - An animated SVG caustic mesh (rotating light ripples) that gives
 *     the impression of light shimmering through water onto the orb.
 *   - A vertical stream of bubbles rising past the orb, intensifying
 *     when the user hovers.
 */
export default function CausticsPattern({ hovering }: Props) {
  const reduceMotion = useReducedMotion();

  return (
    <div aria-hidden className="pointer-events-none absolute inset-[-60%]">
      {/* Caustic mesh — slowly rotating layered radial gradients */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(ellipse 70% 40% at 30% 30%, rgba(125,211,252,0.25) 0%, transparent 60%)," +
            "radial-gradient(ellipse 60% 80% at 70% 60%, rgba(56,189,248,0.20) 0%, transparent 60%)," +
            "radial-gradient(ellipse 50% 50% at 50% 90%, rgba(20,184,166,0.18) 0%, transparent 60%)",
          filter: "blur(8px)",
          mixBlendMode: "screen",
        }}
        animate={
          reduceMotion
            ? { opacity: 0.6 }
            : { rotate: 360, opacity: hovering ? 0.95 : 0.7 }
        }
        transition={
          reduceMotion
            ? undefined
            : {
                rotate: { duration: 38, repeat: Infinity, ease: "linear" },
                opacity: { duration: 0.6 },
              }
        }
      />

      {/* Counter-rotating soft caustic */}
      {!reduceMotion && (
        <motion.div
          className="absolute inset-[-10%] rounded-full"
          style={{
            background:
              "radial-gradient(ellipse 50% 60% at 60% 40%, rgba(186,230,253,0.22) 0%, transparent 55%)," +
              "radial-gradient(ellipse 60% 40% at 30% 70%, rgba(45,212,191,0.18) 0%, transparent 55%)",
            filter: "blur(14px)",
            mixBlendMode: "screen",
          }}
          animate={{ rotate: -360 }}
          transition={{ duration: 52, repeat: Infinity, ease: "linear" }}
        />
      )}

      {/* Bubble stream rising past the orb */}
      {BUBBLES.map((b, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${b.x}%`,
            bottom: -20,
            width: b.size,
            height: b.size,
            background:
              "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.9) 0%, rgba(186,230,253,0.5) 50%, transparent 100%)",
            border: "1px solid rgba(186,230,253,0.4)",
          }}
          animate={
            reduceMotion
              ? undefined
              : {
                  y: [0, -360],
                  x: [0, b.drift],
                  opacity: [0, hovering ? 0.9 : 0.55, 0],
                }
          }
          transition={
            reduceMotion
              ? undefined
              : {
                  duration: b.duration,
                  delay: b.delay,
                  repeat: Infinity,
                  ease: "easeOut",
                }
          }
        />
      ))}
    </div>
  );
}
