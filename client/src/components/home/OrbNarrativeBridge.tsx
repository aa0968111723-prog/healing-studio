import { useRef } from "react";
import {
  motion,
  useMotionTemplate,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { useIsMobile } from "@/hooks/useMobile";

// Pre-computed dust positions for desktop and mobile.  Mobile uses fewer,
// tighter motes since the orb itself is smaller and the GPU budget is lower.
function buildDust(count: number, baseRadius: number) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const r = baseRadius + (i % 3) * (baseRadius * 0.32);
    return {
      id: i,
      dx: Math.cos(angle) * r,
      dy: Math.sin(angle) * r,
      delay: (i * 0.18) % 2.4,
      size: 4 + (i % 3) * 2,
      opacity: 0.25 + ((i * 7) % 5) / 20,
    };
  });
}

const DUST_DESKTOP = buildDust(14, 70);
const DUST_MOBILE = buildDust(8, 48);

function PhaseLabel({ num, tint }: { num: string; tint: string }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-4">
      <span
        className="block h-px w-8 rounded-full"
        style={{ background: `linear-gradient(90deg, transparent, ${tint})` }}
      />
      <span
        className="text-[10px] tracking-[0.4em] uppercase font-medium"
        style={{ color: tint }}
      >
        Phase {num}
      </span>
      <span
        className="block h-px w-8 rounded-full"
        style={{ background: `linear-gradient(90deg, ${tint}, transparent)` }}
      />
    </div>
  );
}

/**
 * Per-frame ambient decoration — small floating elements that match the
 * theme of each phase: idea sparks (Frame 1), connection threads
 * (Frame 2), and constellation glints (Frame 3).
 */
function FrameAmbient({
  variant,
  tint,
}: {
  variant: "spark" | "thread" | "glint";
  tint: string;
}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) return null;

  if (variant === "spark") {
    // 6 floating sparks rising — represents an idea forming
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <motion.span
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${15 + i * 12}%`,
              bottom: 0,
              width: 4 + (i % 3),
              height: 4 + (i % 3),
              background: `radial-gradient(circle, ${tint} 0%, transparent 70%)`,
              boxShadow: `0 0 8px ${tint}`,
            }}
            animate={{
              y: [0, -160 - i * 12],
              opacity: [0, 0.9, 0],
              x: [0, (i % 2 === 0 ? 1 : -1) * 12],
            }}
            transition={{
              duration: 4.5 + (i % 3) * 0.5,
              delay: i * 0.4,
              repeat: Infinity,
              ease: "easeOut",
            }}
          />
        ))}
      </div>
    );
  }

  if (variant === "thread") {
    // Pulsing concentric rings — represents the orb sensing
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {[0, 1, 2].map(i => (
          <motion.span
            key={i}
            className="absolute rounded-full"
            style={{
              width: 200,
              height: 200,
              border: `1px solid ${tint}`,
            }}
            animate={{ scale: [0.6, 1.8], opacity: [0.55, 0] }}
            transition={{
              duration: 3.2,
              delay: i * 1.0,
              repeat: Infinity,
              ease: "easeOut",
            }}
          />
        ))}
      </div>
    );
  }

  // glint — small twinkle stars scattered, fading in/out
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {[
        { x: 18, y: 22 },
        { x: 78, y: 28 },
        { x: 30, y: 78 },
        { x: 70, y: 70 },
        { x: 50, y: 18 },
        { x: 88, y: 50 },
        { x: 12, y: 55 },
      ].map((p, i) => (
        <motion.span
          key={i}
          className="absolute"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: 8,
            height: 8,
            background: `conic-gradient(from 0deg, transparent 0deg, ${tint} 90deg, transparent 180deg, ${tint} 270deg, transparent 360deg)`,
            borderRadius: "50%",
            filter: `drop-shadow(0 0 4px ${tint})`,
          }}
          animate={{
            opacity: [0, 1, 0],
            scale: [0.4, 1.2, 0.4],
            rotate: [0, 90, 180],
          }}
          transition={{
            duration: 2.4 + (i % 3) * 0.3,
            delay: (i * 0.3) % 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

/**
 * OrbNarrativeBridge — a 3-frame scrollytelling block that bridges the hero
 * to the rest of the homepage.  Replaces the former "CORE CAPABILITIES"
 * showcase (which has moved into the global orb's capabilities view).
 *
 *   Frame 1 (0–33%) : "從一個念頭開始"        — character mask reveal
 *   Frame 2 (33–66%): "光球感應你的情緒"      — small orb drifts up-right
 *   Frame 3 (66–100%): "在工作室具現"          — orb shrinks toward bottom-right
 *
 * Honours `prefers-reduced-motion` by collapsing into a static three-card
 * fallback with a single CTA.
 */
export default function OrbNarrativeBridge() {
  const reduceMotion = useReducedMotion();
  const isMobile = useIsMobile();
  const sectionRef = useRef<HTMLElement | null>(null);

  const dust = isMobile ? DUST_MOBILE : DUST_DESKTOP;
  const sectionHeight = isMobile ? "180vh" : "240vh";
  const orbSize = isMobile ? "w-28 h-28" : "w-40 h-40";
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });

  const frame1Opacity = useTransform(scrollYProgress, [0.0, 0.12, 0.34, 0.42], [0, 1, 1, 0]);
  const frame1Y = useTransform(scrollYProgress, [0.0, 0.42], [40, -20]);
  const frame1Scale = useTransform(scrollYProgress, [0.0, 0.12, 0.34, 0.42], [0.94, 1, 1, 1.04]);
  const frame1Blur = useTransform(scrollYProgress, [0.0, 0.12, 0.34, 0.42], [6, 0, 0, 4]);
  const frame1Filter = useMotionTemplate`blur(${frame1Blur}px)`;

  const frame2Opacity = useTransform(scrollYProgress, [0.32, 0.42, 0.62, 0.7], [0, 1, 1, 0]);
  const frame2Y = useTransform(scrollYProgress, [0.32, 0.7], [40, -20]);
  const frame2Scale = useTransform(scrollYProgress, [0.32, 0.42, 0.62, 0.7], [0.94, 1, 1, 1.04]);
  const frame2Blur = useTransform(scrollYProgress, [0.32, 0.42, 0.62, 0.7], [6, 0, 0, 4]);
  const frame2Filter = useMotionTemplate`blur(${frame2Blur}px)`;

  const frame3Opacity = useTransform(scrollYProgress, [0.6, 0.72, 1.0], [0, 1, 1]);
  const frame3Y = useTransform(scrollYProgress, [0.6, 1.0], [40, -20]);
  const frame3Scale = useTransform(scrollYProgress, [0.6, 0.72, 1.0], [0.94, 1, 1.02]);
  const frame3Blur = useTransform(scrollYProgress, [0.6, 0.72], [6, 0]);
  const frame3Filter = useMotionTemplate`blur(${frame3Blur}px)`;

  // Drifting orb — takes the full scroll progress to fly from
  // center → upper-right (frame 2) → bottom-right corner (frame 3),
  // mirroring the global floating orb's resting position.
  const orbX = useTransform(scrollYProgress, [0.1, 0.45, 0.95], ["0vw", "26vw", "44vw"]);
  const orbY = useTransform(scrollYProgress, [0.1, 0.45, 0.95], ["0vh", "-12vh", "32vh"]);
  const orbScale = useTransform(scrollYProgress, [0.1, 0.45, 0.95], [1, 0.7, 0.22]);
  const orbOpacity = useTransform(scrollYProgress, [0.05, 0.18, 0.97, 1.0], [0, 1, 1, 0.6]);
  const orbBlur = useTransform(scrollYProgress, [0.1, 0.95], [0, 4]);
  const orbFilter = useMotionTemplate`blur(${orbBlur}px)`;

  const handleOpenOrb = () => {
    window.dispatchEvent(new CustomEvent("orb-open-capabilities"));
  };

  if (reduceMotion) {
    return (
      <section className="section-breathing px-4 sm:px-6 relative z-10">
        <div className="max-w-3xl mx-auto text-center space-y-10">
          <p className="text-lg text-gray-600 leading-relaxed">
            從一個念頭開始 — 光球感應你的情緒，
            <br />
            在工作室具現你想表達的世界。
          </p>
          <button
            type="button"
            onClick={handleOpenOrb}
            className="inline-flex items-center gap-2 rounded-full px-6 py-3 bg-gradient-to-r from-purple-500 to-sky-500 text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Sparkles className="w-4 h-4" />
            點亮光球，開始創作
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      aria-label="光球敘事"
      className="relative z-10"
      style={{ height: sectionHeight }}
    >
      {/* Sticky stage that pins to viewport while the section scrolls */}
      <div className="sticky top-0 h-screen w-full overflow-hidden flex items-center justify-center">
        {/* Drifting orb (with surrounding dust field) */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2"
          style={{
            x: orbX,
            y: orbY,
            scale: orbScale,
            opacity: orbOpacity,
            filter: orbFilter,
            translateX: "-50%",
            translateY: "-50%",
          }}
        >
          <div className={`relative ${orbSize}`}>
            {/* Dust particles orbiting the orb */}
            {dust.map(d => (
              <motion.span
                key={d.id}
                className="absolute top-1/2 left-1/2 rounded-full bg-white/80"
                style={{
                  width: d.size,
                  height: d.size,
                  marginLeft: -d.size / 2,
                  marginTop: -d.size / 2,
                  filter: "blur(0.5px)",
                }}
                animate={{
                  x: [d.dx, d.dx * 1.08, d.dx],
                  y: [d.dy, d.dy * 1.08, d.dy],
                  opacity: [0, d.opacity, 0],
                }}
                transition={{
                  duration: 3.6 + (d.id % 4) * 0.4,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: d.delay,
                }}
              />
            ))}
            {/* Core orb */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  "radial-gradient(circle at 30% 30%, rgba(186,230,253,0.95) 0%, rgba(125,211,252,0.7) 35%, rgba(56,189,248,0.4) 60%, rgba(56,189,248,0) 100%)",
                boxShadow:
                  "0 0 80px rgba(125,211,252,0.55), inset 0 0 30px rgba(255,255,255,0.6)",
              }}
            />
          </div>
        </motion.div>

        {/* Frame 1 — concept */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center text-center px-6"
          style={{
            opacity: frame1Opacity,
            y: frame1Y,
            scale: frame1Scale,
            filter: frame1Filter,
          }}
        >
          <FrameAmbient variant="spark" tint="rgba(168,85,247,0.7)" />
          <div className="relative max-w-md sm:max-w-xl px-2">
            <PhaseLabel num="01" tint="rgba(168,85,247,0.85)" />
            <h2 className="text-2xl sm:text-4xl md:text-5xl font-semibold leading-tight bg-gradient-to-br from-purple-700 via-purple-500 to-fuchsia-400 bg-clip-text text-transparent">
              從一個念頭開始
            </h2>
            <p className="mt-5 text-sm sm:text-base text-gray-500 leading-relaxed">
              不需要完美的描述 — 一句話、一個感覺、一個畫面，光球都接得住。
            </p>
          </div>
        </motion.div>

        {/* Frame 2 — sensing */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center text-center px-6"
          style={{
            opacity: frame2Opacity,
            y: frame2Y,
            scale: frame2Scale,
            filter: frame2Filter,
          }}
        >
          <FrameAmbient variant="thread" tint="rgba(56,189,248,0.6)" />
          <div className="relative max-w-md sm:max-w-xl px-2">
            <PhaseLabel num="02" tint="rgba(56,189,248,0.85)" />
            <h2 className="text-2xl sm:text-4xl md:text-5xl font-semibold leading-tight bg-gradient-to-br from-sky-600 via-sky-400 to-cyan-300 bg-clip-text text-transparent">
              光球感應你的情緒
            </h2>
            <p className="mt-5 text-sm sm:text-base text-gray-500 leading-relaxed">
              它讀取頁面脈絡、傾聽你的對話節奏，在你需要時靜靜浮現。
            </p>
          </div>
        </motion.div>

        {/* Frame 3 — manifest */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center text-center px-6"
          style={{
            opacity: frame3Opacity,
            y: frame3Y,
            scale: frame3Scale,
            filter: frame3Filter,
          }}
        >
          <FrameAmbient variant="glint" tint="rgba(16,185,129,0.75)" />
          <div className="relative max-w-md sm:max-w-xl px-2">
            <PhaseLabel num="03" tint="rgba(16,185,129,0.85)" />
            <h2 className="text-2xl sm:text-4xl md:text-5xl font-semibold leading-tight bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-300 bg-clip-text text-transparent">
              在工作室具現
            </h2>
            <p className="mt-5 text-sm sm:text-base text-gray-500 leading-relaxed">
              圖片、影片、音樂、配音 — 全都在右下角的光球裡，等你點亮。
            </p>
            <button
              type="button"
              onClick={handleOpenOrb}
              className="mt-8 group inline-flex items-center gap-2 rounded-full px-6 py-3 bg-gradient-to-r from-purple-500/95 via-sky-500/95 to-emerald-500/95 text-white text-sm font-medium shadow-lg shadow-sky-500/20 hover:shadow-sky-500/40 hover:scale-[1.02] transition-all"
            >
              <Sparkles className="w-4 h-4" />
              <span>✦ 點亮光球，開始創作</span>
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
