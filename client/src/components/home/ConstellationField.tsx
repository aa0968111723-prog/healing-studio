import { motion, useReducedMotion } from "framer-motion";

interface Star {
  x: number;
  y: number;
  r: number;
  delay: number;
  twinkleDuration: number;
}

// Deterministic pseudo-random — same star layout every render.
function buildStars(count: number): Star[] {
  const stars: Star[] = [];
  let seed = 1;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < count; i += 1) {
    stars.push({
      x: rand() * 100,
      y: rand() * 100,
      r: 0.6 + rand() * 1.6,
      delay: rand() * 4,
      twinkleDuration: 2 + rand() * 3,
    });
  }
  return stars;
}

const STARS = buildStars(34);

// Hand-curated constellation lines connecting selected stars by index —
// gives the visual feeling of a real constellation rather than a random
// triangulation.
const LINES: Array<[number, number]> = [
  [3, 7],
  [7, 12],
  [12, 5],
  [5, 9],
  [9, 14],
  [14, 18],
  [18, 22],
  [22, 27],
  [1, 4],
  [4, 10],
  [10, 16],
  [16, 24],
  [24, 30],
];

interface Props {
  hovering: boolean;
}

/**
 * SVG constellation field that lives behind the nightSky orb.
 * On hover, the connection lines fade in (the stars "remember" their
 * shape), and a few selected stars pulse brighter.
 */
export default function ConstellationField({ hovering }: Props) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.svg
      aria-hidden
      viewBox="0 0 100 100"
      className="pointer-events-none absolute inset-[-50%]"
      animate={{
        opacity: reduceMotion ? 0.7 : hovering ? 1 : 0.7,
      }}
      transition={{ duration: 0.6 }}
    >
      {/* Connection lines — fade in on hover */}
      <motion.g
        animate={{ opacity: hovering ? 0.55 : 0.18 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        {LINES.map(([a, b], i) => {
          const sa = STARS[a];
          const sb = STARS[b];
          if (!sa || !sb) return null;
          return (
            <line
              key={i}
              x1={sa.x}
              y1={sa.y}
              x2={sb.x}
              y2={sb.y}
              stroke="rgba(196,181,253,0.7)"
              strokeWidth={0.18}
            />
          );
        })}
      </motion.g>

      {/* Stars */}
      {STARS.map((s, i) => (
        <motion.circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={s.r * 0.45}
          fill="rgba(255,255,255,0.95)"
          initial={false}
          animate={
            reduceMotion
              ? { opacity: 0.7 }
              : { opacity: [0.35, 1, 0.35], scale: [1, 1.3, 1] }
          }
          transition={
            reduceMotion
              ? undefined
              : {
                  duration: s.twinkleDuration,
                  delay: s.delay,
                  repeat: Infinity,
                  ease: "easeInOut",
                }
          }
        />
      ))}

      {/* Shooting star — only when not reduced motion */}
      {!reduceMotion && (
        <motion.line
          x1={0}
          y1={20}
          x2={6}
          y2={26}
          stroke="rgba(255,255,255,0.85)"
          strokeWidth={0.28}
          strokeLinecap="round"
          animate={{
            x1: [-10, 100, 100],
            y1: [10, 60, 60],
            x2: [-4, 106, 106],
            y2: [16, 66, 66],
            opacity: [0, 1, 0],
          }}
          transition={{
            duration: 2,
            times: [0, 0.55, 1],
            repeat: Infinity,
            repeatDelay: 7,
            ease: "easeIn",
          }}
        />
      )}
    </motion.svg>
  );
}
