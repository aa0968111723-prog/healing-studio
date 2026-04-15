/**
 * LoginOrbAnimation.tsx — 登入光球飛入動畫（極細膩療癒版）
 *
 * 當使用者成功登入（URL 帶有 ?welcome=1）時播放：
 *   1. 深邃星空背景漸顯，三層深度星場營造空間感
 *   2. 多顆柔光球沿弧線軌跡從畫面四周飛入，帶有柔和拖尾殘像
 *   3. 匯聚瞬間爆發溫暖光芒（convergence flash）
 *   4. 形成主光球，SVG 湍流紋理賦予有機質感，多層光暈呼吸
 *   5. 極光般的色彩飄帶環繞核心
 *   6. 「歡迎回來」以發光漸層文字浮現
 *   7. 輕柔淡出，回歸日常
 *
 * 設計原則：
 *   - 極細膩：SVG feTurbulence 有機紋理 + 多層高斯模糊 + 弧線軌跡 + 殘像拖尾
 *   - 療癒感：緩慢 spring 物理 + 溫暖色調 + 呼吸節奏 + 深邃星空
 *   - 人格感知：依使用者 AI 人格（calm/creative/technical）微調光球色調
 *   - 無障礙：尊重 prefers-reduced-motion，降級為簡潔淡入淡出
 *   - 效能：will-change 提示 GPU 加速，memoize 靜態元素
 */

import { useState, useEffect, useCallback, useMemo, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePersonality } from "@/contexts/PersonalityContext";
import type { Personality } from "@/contexts/PersonalityContext";

// ─── Constants ──────────────────────────────────────────────────────────────

const TOTAL_DURATION_MS = 5800;
const FADEOUT_DURATION_S = 1.4;
const Z_INDEX_ANIMATION_OVERLAY = 9999;
const STAR_LAYERS = [
  { count: 35, sizeMin: 1, sizeMax: 1.5, opacityMin: 0.15, opacityMax: 0.4,  driftSpeed: 6 },
  { count: 20, sizeMin: 1.5, sizeMax: 2.5, opacityMin: 0.2,  opacityMax: 0.55, driftSpeed: 8 },
  { count: 8,  sizeMin: 2.5, sizeMax: 4,   opacityMin: 0.3,  opacityMax: 0.7,  driftSpeed: 12 },
];
const PULSE_RING_COUNT = 5;

// ─── Personality → Color Palette ────────────────────────────────────────────

interface PaletteConfig {
  /** Warm base orb colors (always warm, slightly tinted by personality) */
  orbs: Array<{ color: string; glow: string }>;
  /** Central orb halo color */
  haloInner: string;
  haloOuter: string;
  /** Core bright spot tint */
  coreTint: string;
  /** Aurora wisp colors */
  aurora: [string, string];
  /** Pulse ring color */
  pulseRing: string;
  /** Welcome text glow */
  textGlow: string;
}

function buildPalette(personality: Personality): PaletteConfig {
  // Base warm palette, subtly tinted by personality
  const tints: Record<Personality, { h: number; s: number }> = {
    calm:      { h: 200, s: 30 },  // cool blue tint
    creative:  { h: 25,  s: 40 },  // warm amber tint
    technical: { h: 160, s: 25 },  // mint-green tint
  };
  const t = tints[personality];

  return {
    orbs: [
      // Primary warm (universal)
      { color: "rgba(255,200,120,0.7)",  glow: "rgba(255,180,80,0.45)" },
      { color: "rgba(255,160,180,0.6)",  glow: "rgba(255,120,160,0.35)" },
      { color: "rgba(200,180,255,0.55)", glow: "rgba(180,160,255,0.3)" },
      { color: "rgba(180,230,255,0.55)", glow: "rgba(140,210,255,0.3)" },
      { color: "rgba(255,220,180,0.6)",  glow: "rgba(255,200,140,0.35)" },
      // Secondary (more ethereal)
      { color: "rgba(255,190,200,0.45)", glow: "rgba(255,160,180,0.25)" },
      { color: "rgba(220,200,255,0.45)", glow: "rgba(200,180,255,0.25)" },
      { color: "rgba(255,230,200,0.45)", glow: "rgba(255,210,160,0.25)" },
      { color: "rgba(180,220,255,0.4)",  glow: "rgba(150,200,255,0.22)" },
      { color: "rgba(255,210,170,0.45)", glow: "rgba(255,190,140,0.25)" },
      // Personality-tinted accent orbs
      { color: `hsla(${t.h},${t.s + 30}%,75%,0.55)`, glow: `hsla(${t.h},${t.s + 20}%,65%,0.3)` },
      { color: `hsla(${t.h + 20},${t.s + 20}%,80%,0.45)`, glow: `hsla(${t.h + 20},${t.s + 10}%,70%,0.25)` },
      // Tiny sparkle dust
      { color: "rgba(255,245,230,0.35)", glow: "rgba(255,230,200,0.18)" },
      { color: `hsla(${t.h + 10},${t.s}%,85%,0.35)`, glow: `hsla(${t.h + 10},${t.s}%,75%,0.18)` },
    ],
    haloInner: `hsla(${t.h},${t.s}%,80%,0.2)`,
    haloOuter: "rgba(255,200,140,0.12)",
    coreTint:  `hsla(${t.h},${Math.max(10, t.s - 10)}%,92%,0.3)`,
    aurora: [
      `hsla(${t.h},${t.s + 20}%,70%,0.08)`,
      `hsla(${t.h + 40},${t.s + 10}%,75%,0.06)`,
    ],
    pulseRing: `hsla(${t.h},${t.s}%,80%,0.12)`,
    textGlow:  `hsla(${t.h},${t.s + 10}%,80%,0.6)`,
  };
}

// ─── Orb flight configuration ───────────────────────────────────────────────

interface OrbFlight {
  id: number;
  startX: number;
  startY: number;
  /** Bezier mid-point offset (perpendicular to flight path, in vw%) */
  curveOffset: number;
  size: number;
  delay: number;
  duration: number;
  /** Index into palette.orbs */
  colorIdx: number;
}

/**
 * Compute a curved midpoint between start and center (50,50).
 * The midpoint is offset perpendicular to the straight-line path.
 */
function getCurvedMidpoint(startX: number, startY: number, offset: number): { x: number; y: number } {
  const cx = 50, cy = 50;
  const mx = (startX + cx) / 2;
  const my = (startY + cy) / 2;
  // Perpendicular direction
  const dx = cx - startX;
  const dy = cy - startY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  return { x: mx + px * offset, y: my + py * offset };
}

const ORB_FLIGHTS: OrbFlight[] = [
  // Large primary orbs — wide curves
  { id: 1,  startX: -12, startY: 18,  curveOffset: 18,  size: 20, delay: 0,    duration: 3.0, colorIdx: 0 },
  { id: 2,  startX: 112, startY: 32,  curveOffset: -15, size: 16, delay: 0.18, duration: 3.2, colorIdx: 1 },
  { id: 3,  startX: 28,  startY: -12, curveOffset: 20,  size: 14, delay: 0.35, duration: 2.8, colorIdx: 2 },
  { id: 4,  startX: 78,  startY: 112, curveOffset: -18, size: 18, delay: 0.22, duration: 3.1, colorIdx: 3 },
  { id: 5,  startX: -8,  startY: 72,  curveOffset: -14, size: 12, delay: 0.45, duration: 2.9, colorIdx: 4 },
  // Medium accent orbs — tighter curves
  { id: 6,  startX: 108, startY: 68,  curveOffset: 12,  size: 10, delay: 0.55, duration: 3.3, colorIdx: 5 },
  { id: 7,  startX: 48,  startY: -10, curveOffset: -16, size: 11, delay: 0.4,  duration: 2.7, colorIdx: 6 },
  { id: 8,  startX: 14,  startY: 108, curveOffset: 14,  size: 9,  delay: 0.6,  duration: 3.0, colorIdx: 7 },
  { id: 9,  startX: 92,  startY: -8,  curveOffset: -12, size: 13, delay: 0.3,  duration: 3.4, colorIdx: 8 },
  { id: 10, startX: -10, startY: 48,  curveOffset: 10,  size: 8,  delay: 0.65, duration: 3.1, colorIdx: 9 },
  // Personality-tinted orbs
  { id: 11, startX: 65,  startY: -8,  curveOffset: 15,  size: 12, delay: 0.5,  duration: 2.9, colorIdx: 10 },
  { id: 12, startX: -6,  startY: 55,  curveOffset: -11, size: 10, delay: 0.7,  duration: 3.2, colorIdx: 11 },
  // Tiny sparkle dust
  { id: 13, startX: 20,  startY: -14, curveOffset: 8,   size: 5,  delay: 0.5,  duration: 2.5, colorIdx: 12 },
  { id: 14, startX: 110, startY: 50,  curveOffset: -8,  size: 6,  delay: 0.75, duration: 3.0, colorIdx: 13 },
];

// ─── FlyingOrb with curved path + trailing afterglow ────────────────────────

function FlyingOrb({
  flight,
  palette,
}: {
  flight: OrbFlight;
  palette: PaletteConfig;
}) {
  const color = palette.orbs[flight.colorIdx] ?? palette.orbs[0];
  const mid = getCurvedMidpoint(flight.startX, flight.startY, flight.curveOffset);

  // Trail ghost: smaller, delayed, lower opacity copy
  const trailCount = flight.size >= 12 ? 2 : 1;

  return (
    <>
      {/* Trailing afterglow copies */}
      {Array.from({ length: trailCount }).map((_, ti) => (
        <motion.div
          key={`trail-${flight.id}-${ti}`}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: flight.size * (0.6 - ti * 0.15),
            height: flight.size * (0.6 - ti * 0.15),
            background: `radial-gradient(circle, ${color.glow} 0%, transparent 70%)`,
            filter: `blur(${flight.size * 0.3 + ti * 2}px)`,
            willChange: "transform, opacity",
          }}
          initial={{
            left: `${flight.startX}%`,
            top: `${flight.startY}%`,
            opacity: 0,
          }}
          animate={{
            left: [`${flight.startX}%`, `${mid.x}%`, "50%"],
            top: [`${flight.startY}%`, `${mid.y}%`, "50%"],
            opacity: [0, 0.35 - ti * 0.1, 0],
          }}
          transition={{
            duration: flight.duration,
            delay: flight.delay + 0.12 * (ti + 1),
            ease: [0.22, 0.68, 0.36, 1],
          }}
        />
      ))}

      {/* Main orb */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: flight.size,
          height: flight.size,
          background: `radial-gradient(circle, ${color.color} 0%, transparent 70%)`,
          boxShadow: `0 0 ${flight.size * 2.5}px ${color.glow}, 0 0 ${flight.size * 5}px ${color.glow}`,
          filter: `blur(${Math.max(0.5, flight.size * 0.12)}px)`,
          willChange: "transform, opacity",
        }}
        initial={{
          left: `${flight.startX}%`,
          top: `${flight.startY}%`,
          scale: 0.2,
          opacity: 0,
        }}
        animate={{
          left: [`${flight.startX}%`, `${mid.x}%`, "50%"],
          top: [`${flight.startY}%`, `${mid.y}%`, "50%"],
          scale: [0.2, 1.15, 0.5],
          opacity: [0, 0.85, 0.6],
        }}
        transition={{
          duration: flight.duration,
          delay: flight.delay,
          ease: [0.22, 0.68, 0.36, 1],
          scale: { duration: flight.duration, delay: flight.delay, ease: "easeInOut" },
          opacity: { duration: flight.duration * 0.7, delay: flight.delay, ease: "easeOut" },
        }}
      />
    </>
  );
}

// ─── Star field background ──────────────────────────────────────────────────

const StarField = memo(function StarField() {
  const stars = useMemo(() => {
    const result: Array<{
      x: number; y: number; size: number; opacity: number;
      drift: number; twinkle: number; layer: number;
    }> = [];
    STAR_LAYERS.forEach((layer, li) => {
      for (let i = 0; i < layer.count; i++) {
        // Deterministic but varied positions via simple hash
        const seed = li * 100 + i;
        const x = ((seed * 17 + 31) % 97) / 97 * 100;
        const y = ((seed * 41 + 7) % 89) / 89 * 100;
        const size = layer.sizeMin + ((seed * 13) % 100) / 100 * (layer.sizeMax - layer.sizeMin);
        const opacity = layer.opacityMin + ((seed * 29) % 100) / 100 * (layer.opacityMax - layer.opacityMin);
        result.push({
          x, y, size, opacity,
          drift: layer.driftSpeed + (seed % 4),
          twinkle: 3 + (seed % 5),
          layer: li,
        });
      }
    });
    return result;
  }, []);

  return (
    <>
      {stars.map((star, i) => (
        <motion.div
          key={`star-${i}`}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: star.size,
            height: star.size,
            left: `${star.x}%`,
            top: `${star.y}%`,
            background: star.layer === 2
              ? `radial-gradient(circle, rgba(255,240,220,${star.opacity}) 0%, transparent 70%)`
              : `rgba(255,250,240,${star.opacity})`,
            boxShadow: star.layer >= 1
              ? `0 0 ${star.size * 2}px rgba(255,240,220,${star.opacity * 0.5})`
              : "none",
          }}
          initial={{ opacity: 0 }}
          animate={{
            opacity: [0, star.opacity, star.opacity * 0.6, star.opacity],
            y: [0, -(2 + star.layer * 2), 0],
          }}
          transition={{
            opacity: { duration: star.twinkle, repeat: Infinity, ease: "easeInOut", delay: (i % 8) * 0.3 },
            y: { duration: star.drift, repeat: Infinity, ease: "easeInOut", delay: (i % 6) * 0.4 },
          }}
        />
      ))}
    </>
  );
});

// ─── Convergence flash (brief bright burst when orbs meet) ──────────────────

function ConvergenceFlash() {
  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{
        left: "50%",
        top: "50%",
        width: 300,
        height: 300,
        marginLeft: -150,
        marginTop: -150,
        background: "radial-gradient(circle, rgba(255,255,240,0.5) 0%, rgba(255,220,180,0.2) 30%, transparent 60%)",
        filter: "blur(20px)",
        willChange: "transform, opacity",
      }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{
        scale: [0, 1.5, 0.8],
        opacity: [0, 0.8, 0],
      }}
      transition={{
        duration: 1.0,
        ease: [0.16, 1, 0.3, 1],
      }}
    />
  );
}

// ─── Central converged orb — multi-layered, organic, breathing ──────────────

function CentralOrb({ palette }: { palette: PaletteConfig }) {
  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
    >
      {/* SVG Filters — turbulence for organic texture */}
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <filter id="orb-turbulence">
            <feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="4" result="noise" seed="42" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="8" />
          </filter>
          <filter id="orb-soft-glow">
            <feGaussianBlur stdDeviation="18" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      {/* Layer 1: Outermost atmospheric halo — very diffuse */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 280,
          height: 280,
          left: -140,
          top: -140,
          background: `radial-gradient(circle, ${palette.haloOuter} 0%, transparent 65%)`,
          filter: "blur(40px)",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: [0, 2.0, 1.6, 1.7],
          opacity: [0, 0.7, 0.5, 0.55],
        }}
        transition={{ duration: 2.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Layer 2: Aurora wisp A — rotating ethereal band */}
      <motion.div
        className="absolute"
        style={{
          width: 200,
          height: 100,
          left: -100,
          top: -50,
          background: `linear-gradient(135deg, transparent 20%, ${palette.aurora[0]} 50%, transparent 80%)`,
          borderRadius: "50%",
          filter: "blur(25px)",
        }}
        initial={{ scale: 0, opacity: 0, rotate: 0 }}
        animate={{
          scale: [0, 1.3, 1.1],
          opacity: [0, 0.6, 0.4],
          rotate: [0, 45, 90],
        }}
        transition={{ duration: 4.0, delay: 0.8, ease: "easeInOut" }}
      />

      {/* Layer 3: Aurora wisp B — counter-rotating */}
      <motion.div
        className="absolute"
        style={{
          width: 160,
          height: 120,
          left: -80,
          top: -60,
          background: `linear-gradient(225deg, transparent 25%, ${palette.aurora[1]} 55%, transparent 85%)`,
          borderRadius: "50%",
          filter: "blur(20px)",
        }}
        initial={{ scale: 0, opacity: 0, rotate: 0 }}
        animate={{
          scale: [0, 1.2, 1.0],
          opacity: [0, 0.5, 0.35],
          rotate: [0, -30, -60],
        }}
        transition={{ duration: 3.8, delay: 1.0, ease: "easeInOut" }}
      />

      {/* Layer 4: Mid glow ring — personality-tinted */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 140,
          height: 140,
          left: -70,
          top: -70,
          background: `radial-gradient(circle, ${palette.haloInner} 0%, rgba(255,210,170,0.15) 45%, transparent 75%)`,
          filter: "url(#orb-soft-glow)",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: [0, 1.4, 1.15, 1.25, 1.15],
          opacity: [0, 1, 0.8, 0.9, 0.8],
        }}
        transition={{ duration: 3.0, delay: 0.5, ease: "easeInOut" }}
      />

      {/* Layer 5: Organic textured core — SVG turbulence */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 70,
          height: 70,
          left: -35,
          top: -35,
          background: "radial-gradient(circle, rgba(255,230,200,0.5) 0%, rgba(255,200,160,0.25) 50%, transparent 80%)",
          filter: "url(#orb-turbulence)",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: [0, 1.3, 1.0, 1.1],
          opacity: [0, 0.7, 0.5, 0.6],
          rotate: [0, 180, 360],
        }}
        transition={{
          duration: 4.0,
          delay: 0.6,
          ease: "easeInOut",
          rotate: { duration: 20, repeat: Infinity, ease: "linear", delay: 0.6 },
        }}
      />

      {/* Layer 6: Inner bright core — white-hot center */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 36,
          height: 36,
          left: -18,
          top: -18,
          background: `radial-gradient(circle, rgba(255,255,248,0.95) 0%, rgba(255,230,200,0.7) 35%, ${palette.coreTint} 60%, transparent 100%)`,
          filter: "blur(1.5px)",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: [0, 1.6, 1.0, 1.12, 1.0, 1.08, 1.0],
          opacity: [0, 1, 0.9, 1, 0.88, 0.95, 0.88],
        }}
        transition={{ duration: 3.6, delay: 0.8, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Layer 7: Specular highlight — top-left catchlight */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 14,
          height: 10,
          left: -12,
          top: -14,
          background: "radial-gradient(ellipse, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.3) 60%, transparent 100%)",
          filter: "blur(1px)",
          transform: "rotate(-25deg)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.8, 0.5, 0.7] }}
        transition={{ duration: 2.0, delay: 1.2, ease: "easeInOut" }}
      />

      {/* Inner sparkle particles — orbiting micro-lights */}
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const angle = (i / 6) * Math.PI * 2;
        const radius = 28 + (i % 3) * 8;
        return (
          <motion.div
            key={`sparkle-${i}`}
            className="absolute rounded-full"
            style={{
              width: 3 + (i % 2),
              height: 3 + (i % 2),
              left: -1.5,
              top: -1.5,
              background: "rgba(255,250,235,0.8)",
              boxShadow: "0 0 6px rgba(255,240,210,0.6)",
            }}
            initial={{ opacity: 0, x: 0, y: 0 }}
            animate={{
              opacity: [0, 0.7, 0.3, 0.7],
              x: [
                Math.cos(angle) * radius * 0.3,
                Math.cos(angle + 1) * radius,
                Math.cos(angle + 2) * radius * 0.8,
                Math.cos(angle + 3) * radius,
              ],
              y: [
                Math.sin(angle) * radius * 0.3,
                Math.sin(angle + 1) * radius,
                Math.sin(angle + 2) * radius * 0.8,
                Math.sin(angle + 3) * radius,
              ],
            }}
            transition={{
              duration: 4 + i * 0.3,
              delay: 1.0 + i * 0.15,
              ease: "easeInOut",
              repeat: 1,
            }}
          />
        );
      })}

      {/* Breathing pulse rings — expanding halos */}
      {Array.from({ length: PULSE_RING_COUNT }).map((_, i) => (
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
          }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{
            scale: [0.8, 2.8 + i * 0.4],
            opacity: [0.5, 0],
          }}
          transition={{
            duration: 2.2 + i * 0.15,
            delay: 1.4 + i * 0.35,
            ease: "easeOut",
            repeat: 1,
            repeatDelay: 0.6,
          }}
        />
      ))}

      {/* Welcome text — elegant glow gradient */}
      <motion.div
        className="absolute whitespace-nowrap"
        style={{
          left: "50%",
          top: "calc(50% + 70px)",
          transform: "translateX(-50%)",
        }}
        initial={{ opacity: 0, y: 16, filter: "blur(4px)" }}
        animate={{
          opacity: [0, 0.9, 0.9, 0.75],
          y: [16, 0, 0, 0],
          filter: ["blur(4px)", "blur(0px)", "blur(0px)", "blur(0px)"],
        }}
        transition={{
          duration: 2.0,
          delay: 2.0,
          ease: [0.16, 1, 0.3, 1],
        }}
      >
        <span
          className="text-sm tracking-[0.2em] font-light select-none"
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
      className="fixed inset-0 flex items-center justify-center cursor-pointer"
      style={{
        zIndex: Z_INDEX_ANIMATION_OVERLAY,
        background: "radial-gradient(ellipse at 50% 50%, rgba(20,15,30,0.9) 0%, rgba(10,8,20,0.95) 100%)",
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
        <span className="text-sm tracking-[0.2em] text-white/60 font-light select-none">
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

  // Read personality for color adaptation (always inside PersonalityProvider)
  const { personality } = usePersonality();

  const palette = useMemo(() => buildPalette(personality), [personality]);

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

    // Remove the query param from URL without reload
    params.delete("welcome");
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "") + window.location.hash;
    window.history.replaceState({}, "", newUrl);

    setShow(true);
  }, []);

  // Phase transitions — carefully timed sequence
  useEffect(() => {
    if (!show || prefersReducedMotion) return;

    // Stars → flying (orbs begin)
    const flyTimer = setTimeout(() => setPhase("flying"), 400);
    // Flying → converged (central orb appears)
    const convergeTimer = setTimeout(() => setPhase("converged"), 2200);
    // Converged → fadeout
    const fadeTimer = setTimeout(() => setPhase("fadeout"), TOTAL_DURATION_MS);

    return () => {
      clearTimeout(flyTimer);
      clearTimeout(convergeTimer);
      clearTimeout(fadeTimer);
    };
  }, [show, prefersReducedMotion]);

  // Hide after fade-out completes
  useEffect(() => {
    if (phase !== "fadeout") return;
    const timer = setTimeout(() => setShow(false), FADEOUT_DURATION_S * 1000 + 200);
    return () => clearTimeout(timer);
  }, [phase]);

  const handleSkip = useCallback(() => {
    setPhase("fadeout");
  }, []);

  const handleReducedMotionDone = useCallback(() => {
    setShow(false);
  }, []);

  // Memoize orb elements
  const orbElements = useMemo(
    () => ORB_FLIGHTS.map((flight) => (
      <FlyingOrb key={flight.id} flight={flight} palette={palette} />
    )),
    [palette],
  );

  if (!show) return null;

  // Reduced motion: simple elegant fade
  if (prefersReducedMotion) {
    return (
      <AnimatePresence>
        <ReducedMotionOverlay onDone={handleReducedMotionDone} />
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 pointer-events-auto cursor-pointer overflow-hidden"
          style={{
            zIndex: Z_INDEX_ANIMATION_OVERLAY,
            background: "radial-gradient(ellipse at 50% 45%, rgba(18,14,32,0.93) 0%, rgba(8,6,18,0.97) 100%)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: phase === "fadeout" ? 0 : 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: phase === "fadeout" ? FADEOUT_DURATION_S : 0.7,
            ease: "easeInOut",
          }}
          onClick={handleSkip}
        >
          {/* Deep star field — three depth layers */}
          <StarField />

          {/* Subtle vignette overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "radial-gradient(ellipse at 50% 50%, transparent 30%, rgba(5,3,12,0.4) 100%)",
            }}
          />

          {/* Flying orbs (visible from phase "flying" onward) */}
          {phase !== "stars" && orbElements}

          {/* Convergence flash — brief bright burst */}
          {phase === "converged" && <ConvergenceFlash />}

          {/* Central merged orb — appears after convergence */}
          {(phase === "converged" || phase === "fadeout") && (
            <CentralOrb palette={palette} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
