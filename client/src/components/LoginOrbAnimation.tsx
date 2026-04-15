/**
 * LoginOrbAnimation.tsx — 登入光球飛入動畫（高效能療癒版）
 *
 * 當使用者成功登入（URL 帶有 ?welcome=1）時播放：
 *   1. 深邃星空背景漸顯，三層深度星場營造空間感
 *   2. 柔光球沿弧線軌跡從畫面四周飛入
 *   3. 匯聚瞬間爆發溫暖光芒（convergence flash）
 *   4. 形成主光球，多層柔和漸層呼吸
 *   5. 「歡迎回來」以發光漸層文字浮現
 *   6. 輕柔淡出，回歸日常
 *
 * 效能優化（v2 — 消除卡頓）：
 *   - 星場：純 CSS @keyframes（消除 ~63 個 framer-motion JS 動畫迴圈）
 *   - 光球飛行：純 CSS @keyframes + translate3d GPU 合成（消除 ~42 個迴圈）
 *   - 移除 SVG feTurbulence / feDisplacementMap / feGaussianBlur（GPU 重大瓶頸）
 *   - 移除所有 CSS filter:blur()，改用大尺寸柔化漸層模擬模糊效果
 *   - 元素數量大幅精簡：7 光球（原 14+28 拖尾）、3 中央層（原 7+6+5）、37 星（原 63）
 *   - 僅遮罩進出場與中央光球使用 framer-motion（~9 實例，原 ~126）
 *   - will-change 提示關鍵動畫元素確保 GPU 合成層
 *   - CSS containment 隔離佈局
 *
 * 設計原則：
 *   - 療癒感：溫暖色調 + 呼吸節奏 + 深邃星空
 *   - 人格感知：依使用者 AI 人格（calm/creative/technical）微調光球色調
 *   - 無障礙：尊重 prefers-reduced-motion，降級為簡潔淡入淡出
 */

import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePersonality } from "@/contexts/PersonalityContext";
import type { Personality } from "@/contexts/PersonalityContext";

// ─── Constants ──────────────────────────────────────────────────────────────

const TOTAL_DURATION_MS = 5800;
const FADEOUT_DURATION_S = 1.4;
/** Above OfflineBanner/OnboardingTour (9999) and AuthExpiredModal (10000/10001) — topmost ephemeral overlay */
const Z_INDEX_ANIMATION_OVERLAY = 10050;

// Reduced star count (37 total, down from 63) — sufficient for atmosphere
const STAR_LAYERS = [
  { count: 20, sizeMin: 1, sizeMax: 1.5, opacityMin: 0.15, opacityMax: 0.4 },
  { count: 12, sizeMin: 1.5, sizeMax: 2.5, opacityMin: 0.2,  opacityMax: 0.55 },
  { count: 5,  sizeMin: 2.5, sizeMax: 4,   opacityMin: 0.3,  opacityMax: 0.7 },
];

// ─── Static CSS keyframes (pure CSS — no JS animation overhead) ─────────────

const STATIC_KEYFRAMES =
  // Star twinkle per layer (mid-opacity values from each layer's range)
  "@keyframes hs-tw0{0%,100%{opacity:.28}50%{opacity:.15}}" +
  "@keyframes hs-tw1{0%,100%{opacity:.38}50%{opacity:.22}}" +
  "@keyframes hs-tw2{0%,100%{opacity:.5}50%{opacity:.3}}" +
  // Star drift per layer (vertical float distance increases with depth)
  "@keyframes hs-dr0{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-2px,0)}}" +
  "@keyframes hs-dr1{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-4px,0)}}" +
  "@keyframes hs-dr2{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-6px,0)}}";

// ─── Personality → Color Palette ────────────────────────────────────────────

interface PaletteConfig {
  orbs: Array<{ color: string; glow: string }>;
  haloInner: string;
  haloOuter: string;
  coreTint: string;
  pulseRing: string;
  textGlow: string;
}

function buildPalette(personality: Personality): PaletteConfig {
  const tints: Record<Personality, { h: number; s: number }> = {
    calm:      { h: 200, s: 30 },
    creative:  { h: 25,  s: 40 },
    technical: { h: 160, s: 25 },
  };
  const t = tints[personality];

  return {
    orbs: [
      { color: "rgba(255,200,120,0.7)",  glow: "rgba(255,180,80,0.45)" },
      { color: "rgba(255,160,180,0.6)",  glow: "rgba(255,120,160,0.35)" },
      { color: "rgba(200,180,255,0.55)", glow: "rgba(180,160,255,0.3)" },
      { color: "rgba(180,230,255,0.55)", glow: "rgba(140,210,255,0.3)" },
      { color: "rgba(255,220,180,0.6)",  glow: "rgba(255,200,140,0.35)" },
      { color: `hsla(${t.h},${t.s + 30}%,75%,0.55)`, glow: `hsla(${t.h},${t.s + 20}%,65%,0.3)` },
      { color: `hsla(${t.h + 20},${t.s + 20}%,80%,0.45)`, glow: `hsla(${t.h + 20},${t.s + 10}%,70%,0.25)` },
    ],
    haloInner: `hsla(${t.h},${t.s}%,80%,0.2)`,
    haloOuter: "rgba(255,200,140,0.12)",
    coreTint:  `hsla(${t.h},${Math.max(10, t.s - 10)}%,92%,0.3)`,
    pulseRing: `hsla(${t.h},${t.s}%,80%,0.12)`,
    textGlow:  `hsla(${t.h},${t.s + 10}%,80%,0.6)`,
  };
}

// ─── Orb flight configuration (7 orbs, down from 14 — no trails) ────────────

interface OrbFlight {
  id: number;
  startX: number;
  startY: number;
  curveOffset: number;
  size: number;
  delay: number;
  duration: number;
  colorIdx: number;
}

/**
 * Compute a curved midpoint between a start position and center (50, 50).
 * The midpoint is offset perpendicular to the straight-line path,
 * creating a natural arc for orb flight trajectories.
 */
function getCurvedMidpoint(startX: number, startY: number, offset: number) {
  const cx = 50, cy = 50;
  const mx = (startX + cx) / 2;
  const my = (startY + cy) / 2;
  const dx = cx - startX;
  const dy = cy - startY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: mx + (-dy / len) * offset, y: my + (dx / len) * offset };
}

const ORB_FLIGHTS: OrbFlight[] = [
  { id: 1, startX: -12, startY: 18,  curveOffset: 18,  size: 22, delay: 0,    duration: 3.0, colorIdx: 0 },
  { id: 2, startX: 112, startY: 32,  curveOffset: -15, size: 18, delay: 0.15, duration: 3.2, colorIdx: 1 },
  { id: 3, startX: 28,  startY: -12, curveOffset: 20,  size: 16, delay: 0.3,  duration: 2.8, colorIdx: 2 },
  { id: 4, startX: 78,  startY: 112, curveOffset: -18, size: 20, delay: 0.2,  duration: 3.1, colorIdx: 3 },
  { id: 5, startX: -8,  startY: 72,  curveOffset: -14, size: 14, delay: 0.4,  duration: 2.9, colorIdx: 4 },
  { id: 6, startX: 65,  startY: -8,  curveOffset: 15,  size: 12, delay: 0.45, duration: 2.9, colorIdx: 5 },
  { id: 7, startX: -6,  startY: 55,  curveOffset: -11, size: 10, delay: 0.6,  duration: 3.2, colorIdx: 6 },
];

// ─── Pre-computed star data (computed once at module load) ───────────────────

/** Pre-computed star positioning and CSS animation data (computed once at module load). */
interface StarData {
  x: number; y: number; size: number; layer: number;
  /** Duration in seconds for the twinkle (opacity) CSS animation */
  twinkleDur: number;
  /** Duration in seconds for the drift (vertical float) CSS animation */
  driftDur: number;
  twinkleDelay: number; driftDelay: number;
  /** Pre-computed CSS background value */
  bg: string;
  /** Pre-computed CSS box-shadow value */
  shadow: string;
}

const STARS: StarData[] = (() => {
  const result: StarData[] = [];
  STAR_LAYERS.forEach((layer, li) => {
    for (let i = 0; i < layer.count; i++) {
      const seed = li * 100 + i;
      const x = ((seed * 17 + 31) % 97) / 97 * 100;
      const y = ((seed * 41 + 7) % 89) / 89 * 100;
      const size = layer.sizeMin + ((seed * 13) % 100) / 100 * (layer.sizeMax - layer.sizeMin);
      const opacity = layer.opacityMin + ((seed * 29) % 100) / 100 * (layer.opacityMax - layer.opacityMin);
      result.push({
        x, y, size, layer: li,
        twinkleDur: 3 + (seed % 5),
        driftDur: (li === 0 ? 6 : li === 1 ? 8 : 12) + (seed % 4),
        twinkleDelay: (i % 8) * 0.3,
        driftDelay: (i % 6) * 0.4,
        bg: li === 2
          ? `radial-gradient(circle, rgba(255,240,220,${opacity.toFixed(2)}) 0%, transparent 70%)`
          : `rgba(255,250,240,${opacity.toFixed(2)})`,
        shadow: li >= 1
          ? `0 0 ${(size * 2).toFixed(1)}px rgba(255,240,220,${(opacity * 0.5).toFixed(2)})`
          : "none",
      });
    }
  });
  return result;
})();

// ─── Star field (pure CSS animations — no framer-motion) ────────────────────

const StarField = memo(function StarField() {
  return (
    <>
      {STARS.map((star, i) => (
        <div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: star.size,
            height: star.size,
            left: `${star.x}%`,
            top: `${star.y}%`,
            background: star.bg,
            boxShadow: star.shadow,
            animation:
              `hs-tw${star.layer} ${star.twinkleDur}s ease-in-out ${star.twinkleDelay}s infinite,` +
              `hs-dr${star.layer} ${star.driftDur}s ease-in-out ${star.driftDelay}s infinite`,
          }}
        />
      ))}
    </>
  );
});

// ─── Flying orbs (CSS @keyframes + translate3d GPU compositing) ─────────────

/**
 * Generate CSS @keyframes strings for orb flight animations.
 * Converts percentage-based orb positions to pixel coordinates based on container size,
 * producing GPU-composited translate3d keyframes for each orb's curved flight path.
 */
function buildOrbKeyframes(cw: number, ch: number): string {
  if (cw === 0 || ch === 0) return "";
  return ORB_FLIGHTS.map((f) => {
    const mid = getCurvedMidpoint(f.startX, f.startY, f.curveOffset);
    const sx = (cw * f.startX / 100).toFixed(1);
    const sy = (ch * f.startY / 100).toFixed(1);
    const mx = (cw * mid.x / 100).toFixed(1);
    const my = (ch * mid.y / 100).toFixed(1);
    const ex = (cw * 0.5).toFixed(1);
    const ey = (ch * 0.5).toFixed(1);
    return (
      `@keyframes hs-orb-${f.id}{` +
      `0%{transform:translate3d(${sx}px,${sy}px,0) scale(0.2);opacity:0}` +
      `40%{transform:translate3d(${mx}px,${my}px,0) scale(1.15);opacity:0.85}` +
      `100%{transform:translate3d(${ex}px,${ey}px,0) scale(0.5);opacity:0}}`
    );
  }).join("");
}

function FlyingOrbs({ palette, containerSize }: { palette: PaletteConfig; containerSize: [number, number] }) {
  const css = useMemo(
    () => buildOrbKeyframes(containerSize[0], containerSize[1]),
    [containerSize],
  );

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {ORB_FLIGHTS.map((f) => {
        const color = palette.orbs[f.colorIdx] ?? palette.orbs[0];
        return (
          <div
            key={f.id}
            className="absolute rounded-full pointer-events-none"
            style={{
              left: 0,
              top: 0,
              width: f.size,
              height: f.size,
              background: `radial-gradient(circle, ${color.color} 0%, transparent 70%)`,
              boxShadow: `0 0 ${f.size * 2}px ${color.glow}`,
              animation: `hs-orb-${f.id} ${f.duration}s cubic-bezier(0.22,0.68,0.36,1) ${f.delay}s forwards`,
              willChange: "transform, opacity",
            }}
          />
        );
      })}
    </>
  );
}

// ─── Convergence flash (brief bright burst when orbs meet) ──────────────────

function ConvergenceFlash() {
  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{
        left: "50%",
        top: "50%",
        width: 340,
        height: 340,
        marginLeft: -170,
        marginTop: -170,
        // Larger, softer gradient replaces blur(20px) filter
        background: "radial-gradient(circle, rgba(255,255,240,0.45) 0%, rgba(255,220,180,0.15) 30%, transparent 55%)",
        willChange: "transform, opacity",
      }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: [0, 1.5, 0.8], opacity: [0, 0.8, 0] }}
      transition={{ duration: 1.0, ease: [0.16, 1, 0.3, 1] }}
    />
  );
}

// ─── Central converged orb — simplified, no SVG filters, no blur ────────────

function CentralOrb({ palette }: { palette: PaletteConfig }) {
  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{ left: "50%", top: "50%", willChange: "transform, opacity" }}
      initial={{ opacity: 0, x: "-50%", y: "-50%" }}
      animate={{ opacity: 1, x: "-50%", y: "-50%" }}
      transition={{ duration: 0.8, ease: "easeOut" }}
    >
      {/* Outer atmospheric halo — large soft gradient (no blur filter) */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 360,
          height: 360,
          left: -180,
          top: -180,
          background: `radial-gradient(circle, ${palette.haloOuter} 0%, rgba(255,200,140,0.04) 35%, transparent 65%)`,
          willChange: "transform, opacity",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.8, 1.5], opacity: [0, 0.7, 0.5] }}
        transition={{ duration: 2.2, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Mid glow ring — personality-tinted */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 180,
          height: 180,
          left: -90,
          top: -90,
          background: `radial-gradient(circle, ${palette.haloInner} 0%, rgba(255,210,170,0.1) 40%, transparent 75%)`,
          willChange: "transform, opacity",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.4, 1.15, 1.25], opacity: [0, 1, 0.8, 0.85] }}
        transition={{ duration: 2.6, delay: 0.5, ease: "easeInOut" }}
      />

      {/* Inner bright core */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 44,
          height: 44,
          left: -22,
          top: -22,
          background: `radial-gradient(circle, rgba(255,255,248,0.95) 0%, rgba(255,230,200,0.7) 35%, ${palette.coreTint} 60%, transparent 100%)`,
          willChange: "transform, opacity",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: [0, 1.5, 1.0, 1.1, 1.0],
          opacity: [0, 1, 0.9, 1, 0.9],
        }}
        transition={{ duration: 3.0, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Pulse rings */}
      {[0, 1].map((i) => (
        <motion.div
          key={`pulse-${i}`}
          className="absolute rounded-full"
          style={{
            width: 50,
            height: 50,
            left: -25,
            top: -25,
            border: `1px solid ${palette.pulseRing}`,
            background: "transparent",
            willChange: "transform, opacity",
          }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: [0.8, 2.8 + i * 0.4], opacity: [0.45, 0] }}
          transition={{
            duration: 2.2 + i * 0.15,
            delay: 1.4 + i * 0.35,
            ease: "easeOut",
            repeat: 1,
            repeatDelay: 0.6,
          }}
        />
      ))}

      {/* Welcome text */}
      <motion.div
        className="absolute whitespace-nowrap"
        style={{
          left: "50%",
          top: "calc(50% + 70px)",
          transform: "translateX(-50%)",
          willChange: "opacity",
        }}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: [0, 0.9, 0.9, 0.75], y: [16, 0, 0, 0] }}
        transition={{ duration: 2.0, delay: 2.0, ease: [0.16, 1, 0.3, 1] }}
      >
        <span
          className="text-sm tracking-[0.2em] font-light"
          style={{
            background: `linear-gradient(135deg, rgba(255,255,255,0.8), ${palette.textGlow}, rgba(255,255,255,0.6))`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            textShadow: `0 0 20px ${palette.textGlow}`,
          }}
        >
          歡迎回來
        </span>
      </motion.div>
    </motion.div>
  );
}

// ─── Reduced motion variant — simple, elegant fade ──────────────────────────

function ReducedMotionOverlay({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 2000);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <motion.div
      className="fixed inset-0 flex items-center justify-center cursor-pointer overflow-hidden"
      style={{
        zIndex: Z_INDEX_ANIMATION_OVERLAY,
        background: "radial-gradient(ellipse at 50% 50%, rgba(20,15,30,0.9) 0%, rgba(10,8,20,0.95) 100%)",
        isolation: "isolate",
        contain: "layout paint style",
        width: "100vw",
        height: "100vh",
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: "easeInOut" }}
      onClick={onDone}
    >
      <motion.div
        className="flex flex-col items-center gap-6"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, delay: 0.3 }}
      >
        <div
          className="w-12 h-12 rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(255,255,248,0.9) 0%, rgba(255,220,180,0.5) 50%, transparent 100%)",
            boxShadow: "0 0 40px rgba(255,200,140,0.4)",
          }}
        />
        <span className="text-sm tracking-[0.2em] text-white/60 font-light">
          歡迎回來
        </span>
      </motion.div>
    </motion.div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function LoginOrbAnimation() {
  const [show, setShow] = useState(false);
  const [phase, setPhase] = useState<"stars" | "flying" | "converged" | "fadeout">("stars");
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [containerSize, setContainerSize] = useState<[number, number]>([0, 0]);
  const resizeRaf = useRef(0);

  const { personality } = usePersonality();
  const palette = useMemo(() => buildPalette(personality), [personality]);

  // Sync container size before first paint
  useLayoutEffect(() => {
    setContainerSize([window.innerWidth, window.innerHeight]);
  }, []);

  // Detect prefers-reduced-motion
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Check for ?welcome=1 on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("welcome") !== "1") return;

    params.delete("welcome");
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "") + window.location.hash;
    window.history.replaceState({}, "", newUrl);

    setShow(true);
  }, []);

  // Lock body scroll while visible
  useEffect(() => {
    if (!show) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [show]);

  // Track viewport size (throttled via rAF)
  useEffect(() => {
    if (!show) return;
    const onResize = () => {
      cancelAnimationFrame(resizeRaf.current);
      resizeRaf.current = requestAnimationFrame(() => {
        setContainerSize([window.innerWidth, window.innerHeight]);
      });
    };
    window.addEventListener("resize", onResize);
    onResize();
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(resizeRaf.current);
    };
  }, [show]);

  // Phase transitions
  useEffect(() => {
    if (!show || prefersReducedMotion) return;
    const flyTimer = setTimeout(() => setPhase("flying"), 400);
    const convergeTimer = setTimeout(() => setPhase("converged"), 2200);
    const fadeTimer = setTimeout(() => setPhase("fadeout"), TOTAL_DURATION_MS);
    return () => { clearTimeout(flyTimer); clearTimeout(convergeTimer); clearTimeout(fadeTimer); };
  }, [show, prefersReducedMotion]);

  // Hide after fade-out
  useEffect(() => {
    if (phase !== "fadeout") return;
    const timer = setTimeout(() => setShow(false), FADEOUT_DURATION_S * 1000 + 200);
    return () => clearTimeout(timer);
  }, [phase]);

  const handleSkip = useCallback(() => { setPhase("fadeout"); }, []);
  const handleReducedMotionDone = useCallback(() => { setShow(false); }, []);

  if (!show) return null;

  if (prefersReducedMotion) {
    return (
      <AnimatePresence>
        <ReducedMotionOverlay onDone={handleReducedMotionDone} />
      </AnimatePresence>
    );
  }

  const isFading = phase === "fadeout";

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="button"
          tabIndex={0}
          aria-label="跳過登入動畫"
          className="fixed inset-0 overflow-hidden"
          style={{
            zIndex: Z_INDEX_ANIMATION_OVERLAY,
            background: "radial-gradient(ellipse at 50% 45%, rgba(18,14,32,0.93) 0%, rgba(8,6,18,0.97) 100%)",
            isolation: "isolate",
            contain: "layout paint style",
            pointerEvents: isFading ? "none" : "auto",
            cursor: isFading ? "default" : "pointer",
            width: "100vw",
            height: "100vh",
            backfaceVisibility: "hidden",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: isFading ? 0 : 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: isFading ? FADEOUT_DURATION_S : 0.7,
            ease: "easeInOut",
          }}
          onClick={handleSkip}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") handleSkip(); }}
        >
          {/* Inject static CSS keyframes for stars */}
          {/* eslint-disable-next-line react/no-danger */}
          <style dangerouslySetInnerHTML={{ __html: STATIC_KEYFRAMES }} />

          {/* Star field — pure CSS animations */}
          <StarField />

          {/* Subtle vignette overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "radial-gradient(ellipse at 50% 50%, transparent 30%, rgba(5,3,12,0.4) 100%)",
            }}
          />

          {/* Flying orbs — CSS animations (visible from phase "flying" onward) */}
          {phase !== "stars" && <FlyingOrbs palette={palette} containerSize={containerSize} />}

          {/* Convergence flash */}
          {phase === "converged" && <ConvergenceFlash />}

          {/* Central orb */}
          {(phase === "converged" || phase === "fadeout") && <CentralOrb palette={palette} />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
