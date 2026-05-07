import { motion, useReducedMotion } from "framer-motion";

interface Mote {
  x: number;
  delay: number;
  duration: number;
  size: number;
  drift: number;
}

function buildMotes(count: number): Mote[] {
  const motes: Mote[] = [];
  let seed = 13;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < count; i += 1) {
    motes.push({
      x: rand() * 100,
      delay: rand() * 7,
      duration: 8 + rand() * 4,
      size: 2 + rand() * 4,
      drift: (rand() - 0.5) * 18,
    });
  }
  return motes;
}

const MOTES = buildMotes(10);

interface Props {
  hovering: boolean;
}

/**
 * MorningSunRays — warm radial light beams emanating from top, plus
 * golden motes drifting down through the light.  Sits behind the
 * Hero orb on the morning scene.
 */
export default function MorningSunRays({ hovering }: Props) {
  const reduceMotion = useReducedMotion();

  return (
    <div aria-hidden className="pointer-events-none absolute inset-[-60%]">
      {/* Conic light beams from upper centre */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "conic-gradient(from 220deg at 50% 0%, transparent 0deg, rgba(254,215,170,0.28) 18deg, transparent 36deg, transparent 60deg, rgba(253,224,71,0.20) 78deg, transparent 96deg, transparent 130deg, rgba(252,211,77,0.16) 148deg, transparent 166deg)",
          filter: "blur(8px)",
          mixBlendMode: "screen",
        }}
        animate={
          reduceMotion
            ? { opacity: 0.55 }
            : { rotate: [0, 6, 0], opacity: hovering ? 0.85 : 0.55 }
        }
        transition={
          reduceMotion
            ? undefined
            : {
                rotate: { duration: 16, repeat: Infinity, ease: "easeInOut" },
                opacity: { duration: 0.6 },
              }
        }
      />

      {/* Soft warm halo */}
      <motion.div
        className="absolute inset-[10%] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(253,224,71,0.18) 0%, rgba(251,146,60,0.10) 45%, transparent 70%)",
          filter: "blur(20px)",
        }}
        animate={
          reduceMotion ? undefined : { scale: [1, 1.06, 1], opacity: [0.7, 0.95, 0.7] }
        }
        transition={
          reduceMotion ? undefined : { duration: 7, repeat: Infinity, ease: "easeInOut" }
        }
      />

      {/* Golden motes drifting down */}
      {MOTES.map((m, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${m.x}%`,
            top: -10,
            width: m.size,
            height: m.size,
            background:
              "radial-gradient(circle, rgba(253,224,71,0.95) 0%, rgba(251,191,36,0.45) 60%, transparent 100%)",
            boxShadow: "0 0 6px rgba(253,224,71,0.7)",
          }}
          animate={
            reduceMotion
              ? undefined
              : {
                  y: [0, 380],
                  x: [0, m.drift],
                  opacity: [0, hovering ? 1 : 0.75, 0],
                }
          }
          transition={
            reduceMotion
              ? undefined
              : {
                  duration: m.duration,
                  delay: m.delay,
                  repeat: Infinity,
                  ease: "linear",
                }
          }
        />
      ))}
    </div>
  );
}
