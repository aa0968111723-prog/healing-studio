/**
 * LoginOrbAnimation.tsx — 登入光球飛入動畫（高效能療癒美化版 v3）
 *
 * 當使用者成功登入（URL 帶有 ?welcome=1）時播放：
 *   1. 深邃星空背景漸顯 — 三層深度星場 + 色彩點綴 + 流星劃過
 *   2. 柔光球沿弧線軌跡飛入，每顆帶柔和殘像拖尾
 *   3. 匯聚瞬間爆發溫暖光芒（多層 convergence flash）
 *   4. 形成主光球 — 多層光暈 + 高光捕光 + 環繞微粒
 *   5. 星雲般漸層氛圍在中央暈散
 *   6. 「歡迎回來」與副標以發光漸層文字浮現
 *   7. 輕柔淡出，回歸日常
 *
 * 效能保證（延續 v2 架構）：
 *   - 星場 + 流星 + 光球飛行 + 殘像拖尾 + 環繞微粒：全部純 CSS @keyframes
 *   - 無 SVG filter / 無 CSS filter:blur()
 *   - framer-motion 僅用於遮罩進出場 + 中央光球（~12 實例）
 *   - will-change / CSS containment / translate3d GPU 合成
 */

import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  memo,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePersonality } from "@/contexts/PersonalityContext";
import type { Personality } from "@/contexts/PersonalityContext";

// ─── Constants ──────────────────────────────────────────────────────────────

const TOTAL_DURATION_MS = 6200;
const FADEOUT_DURATION_S = 1.6;
/** Above OfflineBanner/OnboardingTour (9999) and AuthExpiredModal (10000/10001) — topmost ephemeral overlay */
const Z_INDEX_ANIMATION_OVERLAY = 10050;

// Star count: 40 total — layer 0 distant, layer 1 mid, layer 2 close & bright
const STAR_LAYERS = [
  { count: 22, sizeMin: 0.8, sizeMax: 1.5, opacityMin: 0.12, opacityMax: 0.38 },
  { count: 13, sizeMin: 1.5, sizeMax: 2.8, opacityMin: 0.18, opacityMax: 0.55 },
  { count: 5, sizeMin: 2.8, sizeMax: 4.5, opacityMin: 0.28, opacityMax: 0.72 },
];

// ─── Static CSS keyframes (pure CSS — no JS animation overhead) ─────────────

const STATIC_KEYFRAMES = [
  // Star twinkle per layer
  "@keyframes hs-tw0{0%,100%{opacity:.25}50%{opacity:.12}}",
  "@keyframes hs-tw1{0%,100%{opacity:.36}50%{opacity:.18}}",
  "@keyframes hs-tw2{0%,100%{opacity:.5}50%{opacity:.28}}",
  // Star drift per layer (gentle vertical float)
  "@keyframes hs-dr0{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-2px,0)}}",
  "@keyframes hs-dr1{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-4px,0)}}",
  "@keyframes hs-dr2{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-6px,0)}}",
  // Shooting star streak (diagonal sweep with fade-in/out)
  "@keyframes hs-meteor{0%{transform:translate3d(0,0,0) scaleX(0.3);opacity:0}" +
    "10%{opacity:0.7}40%{opacity:0.8}70%{opacity:0.3}" +
    "100%{transform:translate3d(-220px,180px,0) scaleX(1);opacity:0}}",
  // Orb trailing afterglow (follows same path but softer)
  // per-orb trail keyframes are dynamically generated alongside main orb keyframes
  // Orbiting micro-sparkle around central orb
  "@keyframes hs-orbit{0%{transform:rotate(0deg) translate3d(36px,0,0) scale(0.8);opacity:0}" +
    "15%{opacity:0.8}50%{transform:rotate(180deg) translate3d(36px,0,0) scale(1);opacity:0.6}" +
    "85%{opacity:0.4}100%{transform:rotate(360deg) translate3d(36px,0,0) scale(0.8);opacity:0}}",
  // Breathing pulse for nebula
  "@keyframes hs-nebula{0%,100%{opacity:0.06;transform:scale(1)}50%{opacity:0.12;transform:scale(1.05)}}",
].join("");

// ─── Personality → Color Palette ────────────────────────────────────────────

interface PaletteConfig {
  orbs: Array<{ color: string; glow: string; trail: string }>;
  haloInner: string;
  haloOuter: string;
  coreTint: string;
  pulseRing: string;
  textGlow: string;
  /** Nebula gradient colors (two-tone personality tint) */
  nebula: [string, string];
  /** Shooting star tint */
  meteorTint: string;
  /** Orbiting sparkle color */
  sparkleColor: string;
}

function buildPalette(personality: Personality): PaletteConfig {
  const tints: Record<Personality, { h: number; s: number }> = {
    calm: { h: 200, s: 30 },
    creative: { h: 25, s: 40 },
    technical: { h: 160, s: 25 },
  };
  const t = tints[personality];

  return {
    orbs: [
      {
        color: "rgba(255,200,120,0.72)",
        glow: "rgba(255,180,80,0.45)",
        trail: "rgba(255,190,100,0.18)",
      },
      {
        color: "rgba(255,160,180,0.65)",
        glow: "rgba(255,120,160,0.38)",
        trail: "rgba(255,140,170,0.15)",
      },
      {
        color: "rgba(200,180,255,0.58)",
        glow: "rgba(180,160,255,0.32)",
        trail: "rgba(190,170,255,0.14)",
      },
      {
        color: "rgba(180,230,255,0.58)",
        glow: "rgba(140,210,255,0.32)",
        trail: "rgba(160,220,255,0.14)",
      },
      {
        color: "rgba(255,220,180,0.65)",
        glow: "rgba(255,200,140,0.38)",
        trail: "rgba(255,210,160,0.16)",
      },
      {
        color: `hsla(${t.h},${t.s + 30}%,75%,0.58)`,
        glow: `hsla(${t.h},${t.s + 20}%,65%,0.32)`,
        trail: `hsla(${t.h},${t.s + 15}%,70%,0.14)`,
      },
      {
        color: `hsla(${t.h + 20},${t.s + 20}%,80%,0.48)`,
        glow: `hsla(${t.h + 20},${t.s + 10}%,70%,0.28)`,
        trail: `hsla(${t.h + 20},${t.s + 5}%,75%,0.12)`,
      },
    ],
    haloInner: `hsla(${t.h},${t.s}%,80%,0.22)`,
    haloOuter: "rgba(255,200,140,0.14)",
    coreTint: `hsla(${t.h},${Math.max(10, t.s - 10)}%,92%,0.35)`,
    pulseRing: `hsla(${t.h},${t.s}%,80%,0.14)`,
    textGlow: `hsla(${t.h},${t.s + 10}%,80%,0.65)`,
    nebula: [
      `hsla(${t.h},${t.s + 15}%,55%,0.08)`,
      `hsla(${t.h + 40},${t.s + 8}%,65%,0.06)`,
    ],
    meteorTint: `hsla(${t.h + 10},${t.s + 20}%,85%,0.7)`,
    sparkleColor: `hsla(${t.h},${t.s + 10}%,88%,0.8)`,
  };
}

// ─── Orb flight configuration ───────────────────────────────────────────────

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
  const cx = 50,
    cy = 50;
  const mx = (startX + cx) / 2;
  const my = (startY + cy) / 2;
  const dx = cx - startX;
  const dy = cy - startY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { x: mx + (-dy / len) * offset, y: my + (dx / len) * offset };
}

const ORB_FLIGHTS: OrbFlight[] = [
  {
    id: 1,
    startX: -12,
    startY: 18,
    curveOffset: 18,
    size: 22,
    delay: 0,
    duration: 3.0,
    colorIdx: 0,
  },
  {
    id: 2,
    startX: 112,
    startY: 32,
    curveOffset: -15,
    size: 18,
    delay: 0.15,
    duration: 3.2,
    colorIdx: 1,
  },
  {
    id: 3,
    startX: 28,
    startY: -12,
    curveOffset: 20,
    size: 16,
    delay: 0.3,
    duration: 2.8,
    colorIdx: 2,
  },
  {
    id: 4,
    startX: 78,
    startY: 112,
    curveOffset: -18,
    size: 20,
    delay: 0.2,
    duration: 3.1,
    colorIdx: 3,
  },
  {
    id: 5,
    startX: -8,
    startY: 72,
    curveOffset: -14,
    size: 14,
    delay: 0.4,
    duration: 2.9,
    colorIdx: 4,
  },
  {
    id: 6,
    startX: 65,
    startY: -8,
    curveOffset: 15,
    size: 12,
    delay: 0.45,
    duration: 2.9,
    colorIdx: 5,
  },
  {
    id: 7,
    startX: -6,
    startY: 55,
    curveOffset: -11,
    size: 10,
    delay: 0.6,
    duration: 3.2,
    colorIdx: 6,
  },
];

// ─── Shooting star / meteor configuration ───────────────────────────────────

interface MeteorData {
  id: number;
  /** Starting position (%) */
  x: number;
  y: number;
  /** Rotation angle (deg) for the streak direction */
  angle: number;
  /** Length in px */
  length: number;
  delay: number;
  duration: number;
}

const METEORS: MeteorData[] = [
  { id: 1, x: 72, y: 5, angle: 225, length: 90, delay: 0.8, duration: 1.5 },
  { id: 2, x: 25, y: 8, angle: 210, length: 60, delay: 2.2, duration: 1.2 },
  { id: 3, x: 88, y: 22, angle: 240, length: 75, delay: 3.8, duration: 1.4 },
];

// ─── Pre-computed star data (computed once at module load) ───────────────────

/** Pre-computed star positioning and CSS animation data (computed once at module load). */
interface StarData {
  x: number;
  y: number;
  size: number;
  layer: number;
  /** Duration in seconds for the twinkle (opacity) CSS animation */
  twinkleDur: number;
  /** Duration in seconds for the drift (vertical float) CSS animation */
  driftDur: number;
  twinkleDelay: number;
  driftDelay: number;
  /** Pre-computed CSS background value */
  bg: string;
  /** Pre-computed CSS box-shadow value */
  shadow: string;
}

const STARS: StarData[] = (() => {
  const result: StarData[] = [];
  // Color tints per layer: layer 0 = cool blue-white, layer 1 = subtle warm, layer 2 = golden
  const layerColors = [
    (o: number) => `rgba(220,230,255,${o.toFixed(2)})`, // distant — cool blue-white
    (o: number) => `rgba(255,248,235,${o.toFixed(2)})`, // mid — warm white
    (o: number) => `rgba(255,235,200,${o.toFixed(2)})`, // close — warm golden
  ];
  STAR_LAYERS.forEach((layer, li) => {
    for (let i = 0; i < layer.count; i++) {
      const seed = li * 100 + i;
      const x = (((seed * 17 + 31) % 97) / 97) * 100;
      const y = (((seed * 41 + 7) % 89) / 89) * 100;
      const size =
        layer.sizeMin +
        (((seed * 13) % 100) / 100) * (layer.sizeMax - layer.sizeMin);
      const opacity =
        layer.opacityMin +
        (((seed * 29) % 100) / 100) * (layer.opacityMax - layer.opacityMin);
      const colorFn = layerColors[li];
      result.push({
        x,
        y,
        size,
        layer: li,
        twinkleDur: 3 + (seed % 5),
        driftDur: (li === 0 ? 6 : li === 1 ? 8 : 12) + (seed % 4),
        twinkleDelay: (i % 8) * 0.3,
        driftDelay: (i % 6) * 0.4,
        bg:
          li === 2
            ? `radial-gradient(circle, ${colorFn(opacity)} 0%, transparent 70%)`
            : colorFn(opacity),
        shadow:
          li >= 1
            ? `0 0 ${(size * 2.5).toFixed(1)}px ${colorFn(opacity * 0.5)}`
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

// ─── Shooting stars (pure CSS — cinematic depth) ────────────────────────────

const ShootingStars = memo(function ShootingStars({ tint }: { tint: string }) {
  return (
    <>
      {METEORS.map(m => (
        <div
          key={m.id}
          className="absolute pointer-events-none"
          style={{
            left: `${m.x}%`,
            top: `${m.y}%`,
            width: m.length,
            height: 2,
            borderRadius: 1,
            background: `linear-gradient(90deg, transparent 0%, ${tint} 40%, rgba(255,255,255,0.9) 100%)`,
            transformOrigin: "100% 50%",
            transform: `rotate(${m.angle}deg)`,
            animation: `hs-meteor ${m.duration}s ease-out ${m.delay}s forwards`,
            opacity: 0,
            willChange: "transform, opacity",
          }}
        />
      ))}
    </>
  );
});

// ─── Flying orbs with trailing afterglow (CSS @keyframes) ───────────────────

/**
 * Generate CSS @keyframes strings for orb flight animations + trailing afterglow.
 * Each orb gets a main keyframe and a trail keyframe (larger, softer, slightly delayed).
 */
function buildOrbKeyframes(cw: number, ch: number): string {
  if (cw === 0 || ch === 0) return "";
  return ORB_FLIGHTS.map(f => {
    const mid = getCurvedMidpoint(f.startX, f.startY, f.curveOffset);
    const sx = ((cw * f.startX) / 100).toFixed(1);
    const sy = ((ch * f.startY) / 100).toFixed(1);
    const mx = ((cw * mid.x) / 100).toFixed(1);
    const my = ((ch * mid.y) / 100).toFixed(1);
    const ex = (cw * 0.5).toFixed(1);
    const ey = (ch * 0.5).toFixed(1);
    // Main orb keyframe
    const main =
      `@keyframes hs-orb-${f.id}{` +
      `0%{transform:translate3d(${sx}px,${sy}px,0) scale(0.2);opacity:0}` +
      `15%{opacity:0.6}` +
      `40%{transform:translate3d(${mx}px,${my}px,0) scale(1.15);opacity:0.88}` +
      `75%{opacity:0.6}` +
      `100%{transform:translate3d(${ex}px,${ey}px,0) scale(0.45);opacity:0}}`;
    // Trail afterglow — same path, slightly behind, softer
    const trail =
      `@keyframes hs-orb-trail-${f.id}{` +
      `0%{transform:translate3d(${sx}px,${sy}px,0) scale(0.4);opacity:0}` +
      `20%{opacity:0.25}` +
      `45%{transform:translate3d(${mx}px,${my}px,0) scale(1.5);opacity:0.3}` +
      `100%{transform:translate3d(${ex}px,${ey}px,0) scale(0.8);opacity:0}}`;
    return main + trail;
  }).join("");
}

function FlyingOrbs({
  palette,
  containerSize,
}: {
  palette: PaletteConfig;
  containerSize: [number, number];
}) {
  const css = useMemo(
    () => buildOrbKeyframes(containerSize[0], containerSize[1]),
    [containerSize]
  );

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {ORB_FLIGHTS.map(f => {
        const color = palette.orbs[f.colorIdx] ?? palette.orbs[0];
        return (
          <div key={f.id}>
            {/* Trailing afterglow — larger, softer, delayed */}
            <div
              className="absolute rounded-full pointer-events-none"
              style={{
                left: 0,
                top: 0,
                width: f.size * 2.2,
                height: f.size * 2.2,
                background: `radial-gradient(circle, ${color.trail} 0%, transparent 70%)`,
                animation: `hs-orb-trail-${f.id} ${f.duration * 1.05}s cubic-bezier(0.22,0.68,0.36,1) ${f.delay + 0.08}s forwards`,
                willChange: "transform, opacity",
              }}
            />
            {/* Main orb */}
            <div
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
          </div>
        );
      })}
    </>
  );
}

// ─── Convergence flash (multi-layer burst when orbs meet) ───────────────────

function ConvergenceFlash() {
  return (
    <>
      {/* Outer warm glow burst */}
      <motion.div
        className="absolute pointer-events-none"
        style={{
          left: "50%",
          top: "50%",
          width: 420,
          height: 420,
          marginLeft: -210,
          marginTop: -210,
          background:
            "radial-gradient(circle, rgba(255,220,180,0.2) 0%, rgba(255,200,140,0.06) 40%, transparent 65%)",
          willChange: "transform, opacity",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.8, 1.2], opacity: [0, 0.6, 0] }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      />
      {/* Inner white-hot flash */}
      <motion.div
        className="absolute pointer-events-none"
        style={{
          left: "50%",
          top: "50%",
          width: 260,
          height: 260,
          marginLeft: -130,
          marginTop: -130,
          background:
            "radial-gradient(circle, rgba(255,255,245,0.5) 0%, rgba(255,230,200,0.15) 35%, transparent 55%)",
          willChange: "transform, opacity",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.6, 0.7], opacity: [0, 0.85, 0] }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      />
    </>
  );
}

// ─── Nebula gradient aura (pure CSS breathing — behind central orb) ─────────

const NebulaAura = memo(function NebulaAura({
  colors,
}: {
  colors: [string, string];
}) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: "50%",
        top: "50%",
        width: 500,
        height: 500,
        marginLeft: -250,
        marginTop: -250,
        borderRadius: "50%",
        background: `radial-gradient(ellipse at 45% 48%, ${colors[0]} 0%, ${colors[1]} 35%, transparent 65%)`,
        animation: "hs-nebula 6s ease-in-out infinite",
        willChange: "transform, opacity",
      }}
    />
  );
});

// ─── Orbiting micro-sparkles (pure CSS — around central orb) ────────────────

const OrbitingSparkles = memo(function OrbitingSparkles({
  color,
}: {
  color: string;
}) {
  // 4 sparkles evenly spaced, different speeds
  const sparkles = [
    { delay: 0, dur: 4.0 },
    { delay: 0.5, dur: 4.5 },
    { delay: 1.0, dur: 5.0 },
    { delay: 1.5, dur: 3.8 },
  ];
  return (
    <>
      {sparkles.map((s, i) => (
        <div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: "calc(50% - 2px)",
            top: "calc(50% - 2px)",
            width: 4,
            height: 4,
            background: color,
            boxShadow: `0 0 6px ${color}`,
            animation: `hs-orbit ${s.dur}s ease-in-out ${s.delay + 1.2}s infinite`,
            willChange: "transform, opacity",
            opacity: 0,
          }}
        />
      ))}
    </>
  );
});

// ─── Central converged orb — enriched with highlight + sparkles ─────────────

function CentralOrb({ palette }: { palette: PaletteConfig }) {
  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{ left: "50%", top: "50%", willChange: "transform, opacity" }}
      initial={{ opacity: 0, x: "-50%", y: "-50%" }}
      animate={{ opacity: 1, x: "-50%", y: "-50%" }}
      transition={{ duration: 0.8, ease: "easeOut" }}
    >
      {/* Outer atmospheric halo — large soft gradient */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 380,
          height: 380,
          left: -190,
          top: -190,
          background: `radial-gradient(circle, ${palette.haloOuter} 0%, rgba(255,200,140,0.04) 35%, transparent 65%)`,
          willChange: "transform, opacity",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.9, 1.5, 1.6], opacity: [0, 0.7, 0.5, 0.55] }}
        transition={{ duration: 2.4, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Mid glow ring — personality-tinted */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 200,
          height: 200,
          left: -100,
          top: -100,
          background: `radial-gradient(circle, ${palette.haloInner} 0%, rgba(255,210,170,0.1) 40%, transparent 75%)`,
          willChange: "transform, opacity",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: [0, 1.4, 1.15, 1.25, 1.18],
          opacity: [0, 1, 0.8, 0.9, 0.85],
        }}
        transition={{ duration: 3.0, delay: 0.5, ease: "easeInOut" }}
      />

      {/* Inner bright core */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 48,
          height: 48,
          left: -24,
          top: -24,
          background: `radial-gradient(circle, rgba(255,255,248,0.95) 0%, rgba(255,230,200,0.75) 30%, ${palette.coreTint} 55%, transparent 100%)`,
          willChange: "transform, opacity",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: [0, 1.5, 1.0, 1.12, 1.0, 1.08, 1.0],
          opacity: [0, 1, 0.92, 1, 0.9, 0.96, 0.9],
        }}
        transition={{ duration: 3.5, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Specular highlight — top-left catchlight for dimensionality */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 14,
          height: 10,
          left: -14,
          top: -16,
          background:
            "radial-gradient(ellipse, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.2) 70%, transparent 100%)",
          transform: "rotate(-25deg)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.85, 0.55, 0.7] }}
        transition={{ duration: 2.0, delay: 1.2, ease: "easeInOut" }}
      />

      {/* Breathing pulse rings (3 rings for richer feel) */}
      {[0, 1, 2].map(i => (
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
          animate={{
            scale: [0.8, 3.0 + i * 0.5],
            opacity: [0.5 - i * 0.08, 0],
          }}
          transition={{
            duration: 2.4 + i * 0.2,
            delay: 1.3 + i * 0.3,
            ease: "easeOut",
            repeat: 1,
            repeatDelay: 0.5,
          }}
        />
      ))}

      {/* Welcome text — main + subtitle */}
      <motion.div
        className="absolute flex flex-col items-center"
        style={{
          left: "50%",
          top: "calc(50% + 72px)",
          transform: "translateX(-50%)",
          willChange: "opacity",
        }}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: [0, 0.95, 0.95, 0.8], y: [18, 0, 0, 0] }}
        transition={{ duration: 2.2, delay: 2.0, ease: [0.16, 1, 0.3, 1] }}
      >
        <span
          className="text-base tracking-[0.25em] font-light"
          style={{
            background: `linear-gradient(135deg, rgba(255,255,255,0.9), ${palette.textGlow}, rgba(255,255,255,0.7))`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            textShadow: `0 0 24px ${palette.textGlow}`,
          }}
        >
          歡迎回來
        </span>
        <motion.span
          className="text-xs tracking-[0.15em] font-light mt-2"
          style={{
            color: "rgba(255,255,255,0.35)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.5, 0.5, 0.35] }}
          transition={{ duration: 2.0, delay: 2.6, ease: "easeInOut" }}
        >
          Healing Studio
        </motion.span>
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
        background:
          "radial-gradient(ellipse at 50% 50%, rgba(20,15,30,0.9) 0%, rgba(10,8,20,0.95) 100%)",
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
            background:
              "radial-gradient(circle, rgba(255,255,248,0.9) 0%, rgba(255,220,180,0.5) 50%, transparent 100%)",
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
  const [phase, setPhase] = useState<
    "stars" | "flying" | "converged" | "fadeout"
  >("stars");
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
    const handler = (e: MediaQueryListEvent) =>
      setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Check for ?welcome=1 on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("welcome") !== "1") return;

    params.delete("welcome");
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname +
      (newSearch ? `?${newSearch}` : "") +
      window.location.hash;
    window.history.replaceState({}, "", newUrl);

    setShow(true);
  }, []);

  // Lock body scroll while visible
  useEffect(() => {
    if (!show) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
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
    const convergeTimer = setTimeout(() => setPhase("converged"), 2400);
    const fadeTimer = setTimeout(() => setPhase("fadeout"), TOTAL_DURATION_MS);
    return () => {
      clearTimeout(flyTimer);
      clearTimeout(convergeTimer);
      clearTimeout(fadeTimer);
    };
  }, [show, prefersReducedMotion]);

  // Hide after fade-out
  useEffect(() => {
    if (phase !== "fadeout") return;
    const timer = setTimeout(
      () => setShow(false),
      FADEOUT_DURATION_S * 1000 + 200
    );
    return () => clearTimeout(timer);
  }, [phase]);

  const handleSkip = useCallback(() => {
    setPhase("fadeout");
  }, []);
  const handleReducedMotionDone = useCallback(() => {
    setShow(false);
  }, []);

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
            background:
              "radial-gradient(ellipse at 50% 45%, rgba(18,14,32,0.94) 0%, rgba(8,6,18,0.98) 100%)",
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
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === " " || e.key === "Escape")
              handleSkip();
          }}
        >
          {/* Inject all static CSS keyframes */}
          {/* eslint-disable-next-line react/no-danger */}
          <style dangerouslySetInnerHTML={{ __html: STATIC_KEYFRAMES }} />

          {/* Deepened cosmic backdrop — secondary radial gradient layer */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse at 30% 25%, rgba(40,20,80,0.15) 0%, transparent 50%)," +
                "radial-gradient(ellipse at 70% 75%, rgba(20,40,80,0.12) 0%, transparent 50%)",
            }}
          />

          {/* Star field — pure CSS animations */}
          <StarField />

          {/* Shooting stars — cinematic depth */}
          <ShootingStars tint={palette.meteorTint} />

          {/* Subtle vignette overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse at 50% 50%, transparent 25%, rgba(5,3,12,0.45) 100%)",
            }}
          />

          {/* Flying orbs with trailing afterglow — CSS animations */}
          {phase !== "stars" && (
            <FlyingOrbs palette={palette} containerSize={containerSize} />
          )}

          {/* Convergence flash */}
          {phase === "converged" && <ConvergenceFlash />}

          {/* Nebula aura (appears with central orb) */}
          {(phase === "converged" || phase === "fadeout") && (
            <NebulaAura colors={palette.nebula} />
          )}

          {/* Orbiting micro-sparkles */}
          {(phase === "converged" || phase === "fadeout") && (
            <OrbitingSparkles color={palette.sparkleColor} />
          )}

          {/* Central orb */}
          {(phase === "converged" || phase === "fadeout") && (
            <CentralOrb palette={palette} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
