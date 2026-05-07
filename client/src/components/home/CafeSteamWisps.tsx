import { motion, useReducedMotion } from "framer-motion";

interface Wisp {
  x: number;
  delay: number;
  duration: number;
  width: number;
  drift: number;
}

interface Bokeh {
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
}

function buildWisps(count: number): Wisp[] {
  const w: Wisp[] = [];
  let seed = 23;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < count; i += 1) {
    w.push({
      x: rand() * 100,
      delay: rand() * 5,
      duration: 7 + rand() * 4,
      width: 14 + rand() * 26,
      drift: (rand() - 0.5) * 20,
    });
  }
  return w;
}

function buildBokeh(count: number): Bokeh[] {
  const b: Bokeh[] = [];
  let seed = 41;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < count; i += 1) {
    b.push({
      x: rand() * 100,
      y: rand() * 100,
      size: 6 + rand() * 14,
      delay: rand() * 5,
      duration: 4 + rand() * 4,
    });
  }
  return b;
}

const WISPS = buildWisps(7);
const BOKEH = buildBokeh(8);

interface Props {
  hovering: boolean;
}

/**
 * CafeSteamWisps — vertical wispy steam tendrils rising past the orb,
 * paired with warm bokeh light points that pulse softly.  Used as
 * cafe-scene decoration in JewelOrbStage.
 */
export default function CafeSteamWisps({ hovering }: Props) {
  const reduceMotion = useReducedMotion();

  return (
    <div aria-hidden className="pointer-events-none absolute inset-[-55%]">
      {/* Warm sepia halo */}
      <motion.div
        className="absolute inset-[12%] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(217,119,6,0.16) 0%, rgba(180,83,9,0.10) 50%, transparent 75%)",
          filter: "blur(22px)",
        }}
        animate={
          reduceMotion ? undefined : { scale: [1, 1.05, 1], opacity: [0.65, 0.9, 0.65] }
        }
        transition={
          reduceMotion ? undefined : { duration: 9, repeat: Infinity, ease: "easeInOut" }
        }
      />

      {/* Warm bokeh pulses */}
      {BOKEH.map((b, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${b.x}%`,
            top: `${b.y}%`,
            width: b.size,
            height: b.size,
            background:
              "radial-gradient(circle, rgba(254,215,170,0.7) 0%, rgba(217,119,6,0.25) 50%, transparent 100%)",
            filter: "blur(2px)",
          }}
          animate={
            reduceMotion
              ? undefined
              : { opacity: [0.2, hovering ? 0.9 : 0.7, 0.2], scale: [1, 1.18, 1] }
          }
          transition={
            reduceMotion
              ? undefined
              : {
                  duration: b.duration,
                  delay: b.delay,
                  repeat: Infinity,
                  ease: "easeInOut",
                }
          }
        />
      ))}

      {/* Steam wisps rising */}
      {WISPS.map((w, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${w.x}%`,
            bottom: -40,
            width: w.width,
            height: w.width * 2.6,
            background:
              "radial-gradient(ellipse 50% 80% at 50% 70%, rgba(255,237,213,0.55) 0%, rgba(254,215,170,0.30) 40%, transparent 70%)",
            filter: "blur(10px)",
          }}
          animate={
            reduceMotion
              ? undefined
              : {
                  y: [0, -480],
                  x: [0, w.drift],
                  opacity: [0, hovering ? 0.9 : 0.55, 0],
                  scale: [1, 1.5, 2.2],
                }
          }
          transition={
            reduceMotion
              ? undefined
              : {
                  duration: w.duration,
                  delay: w.delay,
                  repeat: Infinity,
                  ease: "easeOut",
                }
          }
        />
      ))}
    </div>
  );
}
