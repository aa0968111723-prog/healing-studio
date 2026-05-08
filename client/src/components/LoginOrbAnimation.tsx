/**
 * LoginOrbAnimation.tsx — 登入光球飛入動畫（深空 3D 美化版 v4）
 *
 * 當使用者成功登入（URL 帶有 ?welcome=1）時播放：
 *   1. 深邃星空背景漸顯 — 三層深度星場 + 銀河帶 + 流星劃過
 *   2. 遠景行星 + 月亮緩慢漂移 + 太陽鏡頭眩光（cinematic depth）
 *   3. 柔光球沿弧線軌跡飛入，每顆帶柔和殘像拖尾
 *   4. 匯聚瞬間爆發溫暖光芒（多層 convergence flash）
 *   5. 主光球 = 真正的 3D 著色光球（VisualSoul3D / Three.js + GLSL Fresnel）
 *      包覆多層光暈、極光紗、捕光高光、呼吸脈衝環、環繞微粒
 *   6. 星雲漸層氛圍在中央暈散
 *   7. 「歡迎回來」與副標以發光漸層文字浮現
 *   8. 輕柔淡出，回歸日常
 *
 * 效能保證：
 *   - 星場 + 流星 + 銀河帶 + 行星 + 月亮 + 太陽眩光：全部純 CSS @keyframes
 *   - 3D 光球以 lazy import + Suspense 載入，僅在 converge 階段掛載
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
  lazy,
  Suspense,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePersonality } from "@/contexts/PersonalityContext";
import type { Personality } from "@/contexts/PersonalityContext";
import { useAmbient } from "@/contexts/AmbientSoundContext";
import { useIsMobile } from "@/hooks/useMobile";

// Lazy-load the heavy WebGL orb so the rest of the overlay can paint immediately.
const VisualSoul3D = lazy(() => import("./VisualSoul3D"));

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
  // Hero orb breath + subtle vertical drift
  "@keyframes hs-hero-breathe{0%,100%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(0,-4px,0) scale(1.04)}}",
  // Rotating aurora veil around hero orb
  "@keyframes hs-aurora-spin{0%{transform:translate3d(-50%,-50%,0) rotate(0deg) scale(0.95)}100%{transform:translate3d(-50%,-50%,0) rotate(360deg) scale(1.05)}}",
  // Convergence shockwave ring
  "@keyframes hs-shockwave{0%{transform:translate3d(-50%,-50%,0) scale(0.35);opacity:0.55}100%{transform:translate3d(-50%,-50%,0) scale(1.9);opacity:0}}",
  // Cinematic light rays moving across hero orb
  "@keyframes hs-ray-sweep{0%{transform:translate3d(-50%,-50%,0) rotate(0deg) scale(0.95);opacity:0.12}50%{opacity:0.35}100%{transform:translate3d(-50%,-50%,0) rotate(360deg) scale(1.1);opacity:0.12}}",
  // Backdrop parallax-like breathing
  "@keyframes hs-depth-breathe{0%,100%{opacity:0.22;transform:scale(1)}50%{opacity:0.35;transform:scale(1.05)}}",
  // Slow depth plane drift
  "@keyframes hs-plane-drift{0%,100%{transform:translate3d(-50%,-50%,0) scale(1)}50%{transform:translate3d(-50%,-50%,0) scale(1.04)}}",
  // Volumetric mist rotation for soft cinematic depth
  "@keyframes hs-mist-swirl{0%{transform:translate3d(-50%,-50%,0) rotate(0deg) scale(0.95);opacity:0.08}50%{opacity:0.18}100%{transform:translate3d(-50%,-50%,0) rotate(360deg) scale(1.05);opacity:0.08}}",
  // Shimmer highlight on welcome text
  "@keyframes hs-text-shimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}",
  // Distant planet — gentle bob + slow surface drift (gas-giant feel)
  "@keyframes hs-planet-bob{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-8px,0)}}",
  "@keyframes hs-planet-spin{0%{background-position:0% 50%,30% 25%,70% 75%,35% 30%}100%{background-position:200% 50%,30% 25%,70% 75%,35% 30%}}",
  // Planet atmospheric rim breath
  "@keyframes hs-planet-rim{0%,100%{opacity:.55}50%{opacity:.85}}",
  // Moon gentle orbital drift
  "@keyframes hs-moon-drift{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(6px,-5px,0)}}",
  // Milky Way galactic plane breath (brightness only)
  "@keyframes hs-milky{0%,100%{opacity:.45}50%{opacity:.70}}",
  // Off-screen sun pulse
  "@keyframes hs-sun{0%,100%{opacity:.55;transform:translate3d(-50%,-50%,0) scale(1)}50%{opacity:.85;transform:translate3d(-50%,-50%,0) scale(1.05)}}",
  // Lens flare drift
  "@keyframes hs-flare{0%,100%{opacity:.32}50%{opacity:.62}}",
  // Cloud band drift across planet surface
  "@keyframes hs-clouds{0%{background-position:0% 50%}100%{background-position:-200% 50%}}",
  // 3D orb entrance — scale + opacity reveal at convergence
  // (The inner div is layout-centered inside its wrapper, so the keyframe
  // only needs scale/translate around its own center — no -50% recentering.)
  "@keyframes hs-orb3d-reveal{0%{transform:scale(0.2);opacity:0}40%{transform:scale(1.18);opacity:1}70%{transform:scale(0.96);opacity:1}100%{transform:scale(1);opacity:1}}",
  // 3D orb gentle hover (post-reveal)
  "@keyframes hs-orb3d-hover{0%,100%{transform:scale(1) translate3d(0,0,0)}50%{transform:scale(1.03) translate3d(0,-4px,0)}}",
  // Distant spiral galaxy — slow rotation
  "@keyframes hs-galaxy-spin{0%{transform:translate3d(-50%,-50%,0) rotate(0deg)}100%{transform:translate3d(-50%,-50%,0) rotate(360deg)}}",
  // Distant spiral galaxy — gentle breath
  "@keyframes hs-galaxy-breath{0%,100%{opacity:.42}50%{opacity:.62}}",
  // Convergence energy dust — spiral inward from edge to center
  "@keyframes hs-dust-spiral{0%{transform:translate3d(0,0,0) scale(0.6);opacity:0}10%{opacity:.85}80%{opacity:.5}100%{transform:translate3d(var(--hs-dx),var(--hs-dy),0) scale(0.1);opacity:0}}",
  // Bottom atmospheric horizon — gentle pulse
  "@keyframes hs-horizon{0%,100%{opacity:.55}50%{opacity:.78}}",
  // Cinematic title char reveal — slide up + fade in
  "@keyframes hs-char-reveal{0%{transform:translate3d(0,18px,0);opacity:0;filter:none}60%{opacity:1}100%{transform:translate3d(0,0,0);opacity:1}}",
  // Constellation line shimmer
  "@keyframes hs-constellation{0%,100%{opacity:.16}50%{opacity:.4}}",
  // Long comet sweep — only first ~8% visible per cycle (loops every 18s)
  "@keyframes hs-comet{0%{transform:translate3d(0,0,0) scaleX(.3);opacity:0}1%{opacity:.85}4%{transform:translate3d(-180px,144px,0) scaleX(.85);opacity:.85}8%{transform:translate3d(-340px,272px,0) scaleX(1);opacity:0}100%{transform:translate3d(-340px,272px,0) scaleX(1);opacity:0}}",
  // Aurora curtain — horizontal slow shimmer (background-position sweep)
  "@keyframes hs-aurora-curtain{0%{background-position:0% 50%;opacity:.32}50%{opacity:.5}100%{background-position:200% 50%;opacity:.32}}",
  // Energy filament — radial flicker around orb at convergence (rotate around left-edge pivot, scaleX 0→1)
  "@keyframes hs-filament{0%{transform:rotate(var(--hs-rot,0deg)) scaleX(0);opacity:0}20%{opacity:.55}45%{transform:rotate(var(--hs-rot,0deg)) scaleX(1);opacity:.7}80%{opacity:.3}100%{transform:rotate(var(--hs-rot,0deg)) scaleX(0.9);opacity:0}}",
  // Distant planet drift — start AT LoginCosmicScene's planet position
  // (50%, 52%) and ease into parked spot (18%, 70%). Offset = (+32vw, -18vh).
  // Provides seamless visual continuity from the login screen handoff.
  "@keyframes hs-planet-drift{0%{transform:translate3d(32vw,-18vh,0)}100%{transform:translate3d(0,0,0)}}",
  // Convergence chromatic ripple — thin expanding ring outward from orb
  "@keyframes hs-conv-ripple{0%{transform:translate3d(-50%,-50%,0) scale(0.2);opacity:.65}70%{opacity:.18}100%{transform:translate3d(-50%,-50%,0) scale(2.6);opacity:0}}",
  // Login-screen nebula cloud breath (mirrors LoginCosmicScene's lcs-nebula)
  "@keyframes hs-login-nebula{0%,100%{opacity:.42;transform:translate3d(-50%,-50%,0) scale(1)}50%{opacity:.62;transform:translate3d(-50%,-50%,0) scale(1.08)}}",
  // Login-screen cosmic dust (mirrors LoginCosmicScene's lcs-dust)
  "@keyframes hs-login-dust{0%{transform:translate3d(-50%,-50%,0) rotate(0deg)}100%{transform:translate3d(-50%,-50%,0) rotate(360deg)}}",
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

/**
 * Login screen cosmic identity — mirrored verbatim from LoginCosmicScene.tsx
 * so the post-login animation is a seamless continuation of the exact scene
 * the user just saw, not a jarring color swap into the ambient theme.
 *
 * If LoginCosmicScene's backdrop / corner accents / nebula / flare palette
 * change, update these in lockstep. Personality (calm/creative/technical)
 * still tints the hero orb + flying orbs + text glow, but the cosmic base
 * is locked to the login screen.
 */
const LOGIN_COSMIC = {
  // Root <div> background of LoginCosmicScene
  backdrop: [
    "radial-gradient(ellipse at 50% 42%, rgba(36,22,68,0.92) 0%, rgba(14,8,30,0.98) 55%, rgba(4,2,14,1) 100%)",
    "linear-gradient(180deg, #0b0820 0%, #110a2a 100%)",
  ].join(","),
  // Three-radial corner accents (purple top-left, blue lower-right, pink bottom)
  accentLayer: [
    "radial-gradient(ellipse at 18% 22%, rgba(80,60,160,0.32) 0%, transparent 55%)",
    "radial-gradient(ellipse at 82% 76%, rgba(40,90,170,0.26) 0%, transparent 58%)",
    "radial-gradient(ellipse at 50% 88%, rgba(180,90,160,0.14) 0%, transparent 55%)",
  ].join(","),
  // Nebula tones used by AuroraCurtain (replaces personality-themed nebula
  // for the cosmic-base layers — keeps purple-violet identity intact)
  nebula: ["rgba(120,80,200,0.18)", "rgba(200,120,180,0.14)"] as [string, string],
  // Sun + lens flare colors from LoginCosmicScene's SunWithLensFlare
  sunCore:
    "radial-gradient(circle, rgba(255,235,200,0.9) 0%, rgba(255,200,150,0.4) 22%, rgba(255,160,120,0.16) 45%, transparent 70%)",
  flares: [
    { t: 0.18, size: 28, color: "rgba(255,210,160,0.45)" },
    { t: 0.34, size: 18, color: "rgba(180,200,255,0.32)" },
    { t: 0.52, size: 42, color: "rgba(255,180,180,0.22)" },
    { t: 0.7, size: 22, color: "rgba(160,220,255,0.28)" },
    { t: 0.86, size: 14, color: "rgba(255,235,210,0.4)" },
  ],
} as const;

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

function ConvergenceFlash({ scale }: { scale: number }) {
  const s = (v: number) => v * scale;
  return (
    <>
      {/* Outer warm glow burst */}
      <motion.div
        className="absolute pointer-events-none"
        style={{
          left: "50%",
          top: "50%",
          width: s(420),
          height: s(420),
          marginLeft: -s(210),
          marginTop: -s(210),
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
          width: s(260),
          height: s(260),
          marginLeft: -s(130),
          marginTop: -s(130),
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
  scale,
}: {
  colors: [string, string];
  scale: number;
}) {
  const size = 500 * scale;
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: "50%",
        top: "50%",
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
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

function CentralOrb({
  palette,
  parallax,
  scale,
}: {
  palette: PaletteConfig;
  parallax: [number, number];
  scale: number;
}) {
  const [px, py] = parallax;
  const s = (v: number) => v * scale;
  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{
        left: "50%",
        top: "50%",
        willChange: "transform, opacity",
        animation: "hs-hero-breathe 4.8s ease-in-out 1.1s infinite",
        rotateX: py * -5,
        rotateY: px * 6,
        transformStyle: "preserve-3d",
      }}
      initial={{ opacity: 0, x: "-50%", y: "-50%" }}
      animate={{ opacity: 1, x: "-50%", y: "-50%" }}
      transition={{ duration: 0.8, ease: "easeOut" }}
    >
      {/* Hero orb cinematic shockwave */}
      <div
        className="absolute rounded-full"
        style={{
          width: s(160),
          height: s(160),
          left: "50%",
          top: "50%",
          transform: "translate3d(-50%,-50%,0)",
          border: `1px solid ${palette.pulseRing}`,
          background: "transparent",
          animation: "hs-shockwave 1.35s ease-out 1.2s 2 forwards",
          willChange: "transform, opacity",
        }}
      />

      {/* Hero orb aurora veil */}
      <div
        className="absolute rounded-full"
        style={{
          width: s(210),
          height: s(210),
          left: "50%",
          top: "50%",
          transform: "translate3d(-50%,-50%,0)",
          background: `conic-gradient(from 90deg, transparent 0deg, ${palette.haloInner} 90deg, transparent 200deg, ${palette.haloOuter} 280deg, transparent 360deg)`,
          opacity: 0.58,
          animation: "hs-aurora-spin 10s linear 1.1s infinite",
          willChange: "transform, opacity",
        }}
      />

      {/* Refractive rim to simulate glass-like 3D orb shell */}
      <div
        className="absolute rounded-full"
        style={{
          width: s(88),
          height: s(88),
          left: -s(44),
          top: -s(44),
          border: "1px solid rgba(255,255,255,0.28)",
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.04) 38%, rgba(255,200,140,0.08) 100%)",
          boxShadow: "inset -10px -12px 18px rgba(255,150,80,0.08)",
          transform: `translate3d(${px * 2.8 * scale}px, ${py * 2.4 * scale}px, ${s(16)}px)`,
          willChange: "transform",
        }}
      />

      {/* Outer atmospheric halo — large soft gradient */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: s(380),
          height: s(380),
          left: -s(190),
          top: -s(190),
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
          width: s(200),
          height: s(200),
          left: -s(100),
          top: -s(100),
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

      {/* Inner bright core — additive bloom on top of the 3D orb's center.
          mix-blend-mode: screen lets the WebGL orb show through while the
          climax burst still adds a punchy white-hot peak. */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: s(48),
          height: s(48),
          left: -s(24),
          top: -s(24),
          background: `radial-gradient(circle, rgba(255,255,248,0.85) 0%, rgba(255,230,200,0.55) 30%, ${palette.coreTint} 55%, transparent 100%)`,
          mixBlendMode: "screen",
          willChange: "transform, opacity",
        }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: [0, 1.5, 1.0, 1.12, 1.0, 1.08, 1.0],
          opacity: [0, 0.85, 0.5, 0.6, 0.45, 0.55, 0.45],
        }}
        transition={{ duration: 3.5, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Hero orb shell — additive thin shell ring around the 3D orb */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: s(76),
          height: s(76),
          left: -s(38),
          top: -s(38),
          border: `1px solid ${palette.haloInner}`,
          background:
            "radial-gradient(circle, rgba(255,255,255,0.10) 0%, transparent 70%)",
          mixBlendMode: "screen",
          willChange: "transform, opacity",
        }}
        initial={{ scale: 0.75, opacity: 0 }}
        animate={{ scale: [0.75, 1.06, 0.98, 1.02], opacity: [0, 0.55, 0.4, 0.45] }}
        transition={{ duration: 2.8, delay: 0.8, ease: "easeInOut" }}
      />

      {/* Specular highlight — top-left catchlight (additive screen blend).
          The 3D orb has its own GLSL spec; this CSS catchlight reinforces
          the front-lit feeling at the orb's upper-left rim. */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: s(14),
          height: s(10),
          left: -s(14),
          top: -s(16),
          background:
            "radial-gradient(ellipse, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.18) 70%, transparent 100%)",
          mixBlendMode: "screen",
          transform: "rotate(-25deg)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.7, 0.42, 0.55] }}
        transition={{ duration: 2.0, delay: 1.2, ease: "easeInOut" }}
      />

      {/* Breathing pulse rings (3 rings for richer feel) */}
      {[0, 1, 2].map(i => (
        <motion.div
          key={`pulse-${i}`}
          className="absolute rounded-full"
          style={{
            width: s(50),
            height: s(50),
            left: -s(25),
            top: -s(25),
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

      {/* Welcome text — cinematic letter-by-letter reveal + shimmer + thin underline */}
      <motion.div
        className="absolute flex flex-col items-center"
        style={{
          left: "50%",
          top: `calc(50% + ${s(72)}px)`,
          transform: "translateX(-50%)",
          willChange: "opacity",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1, 0.85] }}
        transition={{ duration: 2.6, delay: 2.0, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Char-by-char cinematic reveal */}
        <span
          className="font-light"
          style={{
            fontSize: `${s(16)}px`,
            letterSpacing: `${Math.max(0.12, 0.25 * scale)}em`,
            background: `linear-gradient(120deg, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0.98) 22%, ${palette.textGlow} 48%, rgba(255,255,255,0.96) 70%, rgba(255,255,255,0.72) 100%)`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            textShadow: `0 0 24px ${palette.textGlow}`,
            backgroundSize: "220% 100%",
            animation: "hs-text-shimmer 4.2s linear 2.4s infinite",
            display: "inline-flex",
          }}
        >
          {Array.from("歡迎回來").map((ch, i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                opacity: 0,
                animation: `hs-char-reveal 0.9s cubic-bezier(0.16,1,0.3,1) ${2.0 + i * 0.13}s forwards`,
                willChange: "transform, opacity",
              }}
            >
              {ch}
            </span>
          ))}
        </span>

        {/* Thin underline ribbon — premium cinematic touch (CSS only, no blur) */}
        <motion.div
          className="mt-2"
          style={{
            height: 1,
            background: `linear-gradient(90deg, transparent 0%, ${palette.textGlow} 50%, transparent 100%)`,
            transformOrigin: "center",
          }}
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: [0, s(96), s(96), s(96)], opacity: [0, 0.65, 0.5, 0.4] }}
          transition={{ duration: 2.2, delay: 2.6, ease: [0.16, 1, 0.3, 1] }}
        />

        <motion.span
          className="font-light mt-2"
          style={{
            color: "rgba(255,255,255,0.35)",
            fontSize: `${s(12)}px`,
            letterSpacing: `${Math.max(0.08, 0.15 * scale)}em`,
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.55, 0.55, 0.35] }}
          transition={{ duration: 2.0, delay: 3.0, ease: "easeInOut" }}
        >
          Healing Studio
        </motion.span>
      </motion.div>
    </motion.div>
  );
}

const HeroLightRays = memo(function HeroLightRays({
  color,
  scale,
}: {
  color: string;
  scale: number;
}) {
  return (
    <div
      className="absolute rounded-full pointer-events-none"
      style={{
        left: "50%",
        top: "50%",
        width: 330 * scale,
        height: 330 * scale,
        transform: "translate3d(-50%,-50%,0)",
        background: `conic-gradient(from 0deg, transparent 0deg, ${color} 48deg, transparent 92deg, ${color} 185deg, transparent 230deg, ${color} 300deg, transparent 360deg)`,
        maskImage:
          "radial-gradient(circle, transparent 0%, rgba(0,0,0,0.5) 35%, rgba(0,0,0,0.95) 68%, transparent 100%)",
        WebkitMaskImage:
          "radial-gradient(circle, transparent 0%, rgba(0,0,0,0.5) 35%, rgba(0,0,0,0.95) 68%, transparent 100%)",
        animation: "hs-ray-sweep 12s linear 1.2s infinite",
        mixBlendMode: "screen",
        willChange: "transform, opacity",
      }}
    />
  );
});

const DepthParallaxPlanes = memo(function DepthParallaxPlanes({
  parallax,
  scale,
}: {
  parallax: [number, number];
  scale: number;
}) {
  const [px, py] = parallax;
  return (
    <>
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          left: "50%",
          top: "50%",
          width: 760 * scale,
          height: 760 * scale,
          transform: `translate3d(calc(-50% + ${px * -22 * scale}px), calc(-50% + ${py * -16 * scale}px), 0)`,
          background:
            "radial-gradient(ellipse at 35% 38%, rgba(120,140,255,0.08) 0%, rgba(90,80,180,0.04) 38%, transparent 68%)",
          animation: "hs-plane-drift 12s ease-in-out infinite",
          willChange: "transform, opacity",
        }}
      />
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          left: "50%",
          top: "50%",
          width: 560 * scale,
          height: 560 * scale,
          transform: `translate3d(calc(-50% + ${px * 16 * scale}px), calc(-50% + ${py * 10 * scale}px), 0)`,
          background:
            "radial-gradient(ellipse at 66% 62%, rgba(255,180,140,0.07) 0%, rgba(160,80,120,0.05) 40%, transparent 70%)",
          animation: "hs-plane-drift 9s ease-in-out 0.8s infinite",
          willChange: "transform, opacity",
        }}
      />
    </>
  );
});

const VolumetricMist = memo(function VolumetricMist({
  parallax,
  palette,
  scale,
}: {
  parallax: [number, number];
  palette: PaletteConfig;
  scale: number;
}) {
  const [px, py] = parallax;
  return (
    <div
      className="absolute rounded-full pointer-events-none"
      style={{
        left: "50%",
        top: "50%",
        width: 820 * scale,
        height: 820 * scale,
        transform: `translate3d(calc(-50% + ${px * 10 * scale}px), calc(-50% + ${py * 8 * scale}px), 0)`,
        background: `conic-gradient(from 0deg, transparent 0deg, ${palette.nebula[0]} 78deg, transparent 150deg, ${palette.nebula[1]} 220deg, transparent 360deg)`,
        animation: "hs-mist-swirl 24s linear infinite",
        mixBlendMode: "screen",
        willChange: "transform, opacity",
      }}
    />
  );
});

// ─── Milky Way galactic plane — diagonal soft band for cosmic depth ─────────

const MilkyWayBand = memo(function MilkyWayBand() {
  return (
    <div
      className="absolute pointer-events-none"
      aria-hidden
      style={{
        left: "-20%",
        top: "-10%",
        width: "140%",
        height: "120%",
        transform: "rotate(-22deg)",
        // Identical opacities to LoginCosmicScene's MilkyWay (lines 213-215)
        // so the band matches in brightness when the user transitions in.
        background: [
          "linear-gradient(180deg, transparent 38%, rgba(220,210,255,0.12) 46%, rgba(255,240,255,0.18) 50%, rgba(220,210,255,0.12) 54%, transparent 62%)",
          "linear-gradient(180deg, transparent 40%, rgba(150,110,220,0.10) 48%, rgba(110,180,240,0.08) 52%, transparent 60%)",
        ].join(","),
        backgroundBlendMode: "screen",
        mixBlendMode: "screen",
        WebkitMaskImage:
          "linear-gradient(90deg, transparent 0%, #000 18%, #000 82%, transparent 100%)",
        maskImage:
          "linear-gradient(90deg, transparent 0%, #000 18%, #000 82%, transparent 100%)",
        opacity: 0.7,
        animation: "hs-milky 14s ease-in-out infinite",
      }}
    />
  );
});

// ─── Login-screen nebula clouds — exact mirror of LoginCosmicScene Nebula ──

/**
 * Two large offset radial clouds (purple lower-left, pink upper-right) plus
 * a slow-rotating conic dust ring — ported verbatim from LoginCosmicScene's
 * Nebula component so the animation reads as the SAME cosmic environment.
 *
 * Note: the keyframes apply translate3d(-50%, -50%, 0) on top of the
 * elements' existing margin-based centering — this double-offset positions
 * the clouds toward the corner quadrants rather than at their nominal
 * left/top, which is the exact behavior of LoginCosmicScene. Mirroring the
 * quirk preserves visual continuity instead of breaking the look.
 */
const LoginNebula = memo(function LoginNebula({ scale }: { scale: number }) {
  const big = 1100 * scale;
  return (
    <>
      {/* Purple cloud — drifts into upper-left quadrant via keyframe offset */}
      <div
        className="absolute rounded-full pointer-events-none"
        aria-hidden
        style={{
          left: "30%",
          top: "55%",
          width: big,
          height: big,
          marginLeft: -big / 2,
          marginTop: -big / 2,
          background:
            "radial-gradient(ellipse at 40% 45%, rgba(120,80,200,0.22) 0%, rgba(80,50,160,0.10) 30%, transparent 60%)",
          mixBlendMode: "screen",
          animation: "hs-login-nebula 18s ease-in-out infinite",
          willChange: "transform, opacity",
        }}
      />
      {/* Pink-purple cloud — drifts into upper-mid quadrant */}
      <div
        className="absolute rounded-full pointer-events-none"
        aria-hidden
        style={{
          left: "72%",
          top: "32%",
          width: big * 0.85,
          height: big * 0.85,
          marginLeft: (-big * 0.85) / 2,
          marginTop: (-big * 0.85) / 2,
          background:
            "radial-gradient(ellipse at 55% 50%, rgba(200,120,180,0.16) 0%, rgba(140,80,180,0.08) 32%, transparent 62%)",
          mixBlendMode: "screen",
          animation: "hs-login-nebula 22s ease-in-out 2s infinite",
          willChange: "transform, opacity",
        }}
      />
      {/* Slow swirling cosmic dust — centered conic gradient (90s rotation) */}
      <div
        className="absolute rounded-full pointer-events-none"
        aria-hidden
        style={{
          left: "50%",
          top: "50%",
          width: big * 1.4,
          height: big * 1.4,
          background:
            "conic-gradient(from 0deg, transparent 0deg, rgba(160,140,230,0.06) 80deg, transparent 160deg, rgba(120,180,255,0.05) 240deg, transparent 360deg)",
          mixBlendMode: "screen",
          animation: "hs-login-dust 90s linear infinite",
          willChange: "transform",
        }}
      />
    </>
  );
});

// ─── Off-screen sun + lens flare chain (cinematic optical axis) ─────────────

const SunLensFlare = memo(function SunLensFlare({
  parallax,
}: {
  parallax: [number, number];
}) {
  const [px, py] = parallax;
  // Hex flare chain — exact colors/sizes from LoginCosmicScene's SunWithLensFlare.
  const flares = LOGIN_COSMIC.flares;
  // Sun position matches LoginCosmicScene (slightly different but visually identical).
  const SUN_X = 108;
  const SUN_Y = -10;
  const END_X = -10;
  const END_Y = 110;

  return (
    <>
      {/* Sun core glow (mostly off-screen, top-right) — same gradient as login screen */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          left: `${SUN_X}%`,
          top: `${SUN_Y}%`,
          width: 280,
          height: 280,
          marginLeft: -140,
          marginTop: -140,
          background: LOGIN_COSMIC.sunCore,
          mixBlendMode: "screen",
          animation: "hs-sun 9s ease-in-out infinite",
          willChange: "transform, opacity",
        }}
      />
      {/* Hex flare chain along optical axis */}
      {flares.map((f, i) => {
        const cx = SUN_X + (END_X - SUN_X) * f.t + px * 1.2;
        const cy = SUN_Y + (END_Y - SUN_Y) * f.t + py * 1.0;
        return (
          <div
            key={i}
            className="absolute rounded-full pointer-events-none"
            style={{
              left: `${cx}%`,
              top: `${cy}%`,
              width: f.size,
              height: f.size,
              marginLeft: -f.size / 2,
              marginTop: -f.size / 2,
              background: `radial-gradient(circle, ${f.color} 0%, transparent 70%)`,
              mixBlendMode: "screen",
              animation: `hs-flare ${5 + (i % 3)}s ease-in-out ${i * 0.4}s infinite`,
              willChange: "opacity",
            }}
          />
        );
      })}
    </>
  );
});

// ─── Distant 3D planet — gas giant with terminator + ring + cloud band ──────

const DistantPlanet = memo(function DistantPlanet({
  parallax,
  scale,
}: {
  parallax: [number, number];
  scale: number;
}) {
  const [px, py] = parallax;
  // Smaller and offset to lower-left so it doesn't compete with the central orb
  const size = 360 * scale;
  const tx = px * 12 * scale;
  const ty = py * 8 * scale;

  return (
    // Drift wrapper: positioned at the PARKED location (18%, 70%). The CSS
    // animation translates the whole sub-tree from the login screen's planet
    // position (50%, 52%) — offset (+32vw, -18vh) — to (0, 0), so the planet
    // appears to be the SAME planet drifting aside as the user enters.
    // Inner parallax+content wrapper handles mouse parallax independently
    // (composes with the drift transform).
    <div
      className="absolute pointer-events-none"
      aria-hidden
      style={{
        left: "18%",
        top: "70%",
        // Drift timing is locked to the phase pipeline:
        //   0.0–0.4s : stars only — planet stays at login screen position
        //   0.4–2.4s : orbs flying — planet drifts to parked spot
        //   2.4s+    : convergence — planet settled, 3D orb takes over center
        // 0.4s delay + 2.0s duration ⇒ settles exactly when convergence
        // begins, so the drifting planet never overlaps the hero orb at climax.
        // `both` fill mode applies the 0% keyframe (login position) on mount
        // so there's no first-frame flash at parked position.
        animation:
          "hs-planet-drift 2.0s cubic-bezier(0.4,0,0.2,1) 0.4s both",
        willChange: "transform",
      }}
    >
    <div
      style={{
        position: "absolute",
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        transform: `translate3d(${tx}px, ${ty}px, 0)`,
        willChange: "transform",
      }}
    >
      {/* Outer atmospheric halo */}
      <div
        className="absolute rounded-full"
        style={{
          inset: -size * 0.28,
          background:
            "radial-gradient(circle, rgba(160,140,230,0.16) 0%, rgba(120,90,200,0.08) 28%, rgba(80,60,160,0.03) 50%, transparent 70%)",
          animation: "hs-planet-rim 7s ease-in-out infinite",
        }}
      />

      {/* Subtle planet ring */}
      <div
        className="absolute rounded-full"
        style={{
          left: "50%",
          top: "50%",
          width: size * 1.45,
          height: size * 0.18,
          marginLeft: -(size * 1.45) / 2,
          marginTop: -(size * 0.18) / 2,
          transform: "rotate(-18deg)",
          background:
            "linear-gradient(90deg, transparent 0%, rgba(200,180,255,0.10) 18%, rgba(230,210,255,0.28) 50%, rgba(200,180,255,0.10) 82%, transparent 100%)",
          boxShadow:
            "0 0 24px rgba(180,160,240,0.16), inset 0 0 18px rgba(255,240,255,0.18)",
          opacity: 0.78,
        }}
      />

      {/* Planet body — gas-giant gradient with terminator */}
      <div
        className="absolute rounded-full"
        style={{
          left: "50%",
          top: "50%",
          width: size * 0.78,
          height: size * 0.78,
          marginLeft: -(size * 0.78) / 2,
          marginTop: -(size * 0.78) / 2,
          background: [
            "linear-gradient(180deg, rgba(255,235,210,0.05) 0%, rgba(160,120,200,0.05) 22%, rgba(120,90,180,0.0) 38%, rgba(180,140,220,0.04) 56%, rgba(110,80,170,0.0) 72%, rgba(200,160,240,0.05) 92%)",
            "radial-gradient(circle at 30% 25%, rgba(255,225,190,0.28) 0%, rgba(255,210,180,0.0) 32%)",
            "radial-gradient(circle at 72% 78%, rgba(20,10,38,0.74) 0%, rgba(34,18,60,0.42) 38%, rgba(70,40,120,0.0) 62%)",
            "radial-gradient(circle at 36% 32%, #8a6fc5 0%, #5b3f95 28%, #36256a 55%, #1a1138 88%)",
          ].join(","),
          backgroundSize: "300% 100%, auto, auto, auto",
          backgroundRepeat: "repeat-x, no-repeat, no-repeat, no-repeat",
          boxShadow: [
            "inset -32px -36px 92px rgba(0,0,0,0.62)",
            "inset 24px 22px 76px rgba(190,160,255,0.16)",
            "0 0 60px rgba(160,130,230,0.28)",
            "0 0 150px rgba(90,60,170,0.22)",
          ].join(","),
          animation:
            "hs-planet-spin 110s linear infinite, hs-planet-bob 14s ease-in-out infinite",
          willChange: "background-position, transform",
        }}
      />

      {/* Cloud band drift */}
      <div
        className="absolute rounded-full overflow-hidden"
        style={{
          left: "50%",
          top: "50%",
          width: size * 0.78,
          height: size * 0.78,
          marginLeft: -(size * 0.78) / 2,
          marginTop: -(size * 0.78) / 2,
          WebkitMaskImage:
            "radial-gradient(circle, #000 60%, rgba(0,0,0,0.5) 78%, transparent 92%)",
          maskImage:
            "radial-gradient(circle, #000 60%, rgba(0,0,0,0.5) 78%, transparent 92%)",
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, transparent 22%, rgba(230,210,255,0.14) 32%, transparent 42%, rgba(200,180,255,0.10) 56%, transparent 66%, rgba(220,200,255,0.12) 78%, transparent 88%)",
            backgroundSize: "300% 100%",
            animation: "hs-clouds 130s linear infinite",
            mixBlendMode: "screen",
            opacity: 0.65,
          }}
        />
      </div>

      {/* Atmospheric rim — Rayleigh limb glow */}
      <div
        className="absolute rounded-full"
        style={{
          left: "50%",
          top: "50%",
          width: size * 0.82,
          height: size * 0.82,
          marginLeft: -(size * 0.82) / 2,
          marginTop: -(size * 0.82) / 2,
          background:
            "radial-gradient(circle at 32% 26%, transparent 54%, rgba(120,180,255,0.20) 60%, rgba(200,225,255,0.38) 63%, rgba(255,235,255,0.28) 65%, transparent 70%)",
          mixBlendMode: "screen",
          opacity: 0.85,
          animation: "hs-planet-rim 6s ease-in-out infinite",
        }}
      />

      {/* Specular catchlight */}
      <div
        className="absolute rounded-full"
        style={{
          left: `calc(50% - ${size * 0.18}px)`,
          top: `calc(50% - ${size * 0.22}px)`,
          width: size * 0.06,
          height: size * 0.04,
          background:
            "radial-gradient(ellipse, rgba(255,255,255,0.8) 0%, rgba(255,240,220,0.22) 60%, transparent 100%)",
          transform: "rotate(-22deg)",
          opacity: 0.65,
        }}
      />
    </div>
    </div>
  );
});

// ─── Distant moon for parallax depth ────────────────────────────────────────

const DistantMoon = memo(function DistantMoon({
  parallax,
  scale,
}: {
  parallax: [number, number];
  scale: number;
}) {
  const [px, py] = parallax;
  const size = 72 * scale;
  const tx = px * -18 * scale;
  const ty = py * -12 * scale;
  return (
    <div
      className="absolute pointer-events-none"
      aria-hidden
      style={{
        // Exact-match LoginCosmicScene's Moon position (82%, 22%) so the
        // user sees the same satellite they just had on the login screen.
        left: "82%",
        top: "22%",
        width: size,
        height: size,
        transform: `translate3d(${tx}px, ${ty}px, 0)`,
        willChange: "transform",
        animation: "hs-moon-drift 18s ease-in-out infinite",
      }}
    >
      <div
        className="absolute rounded-full"
        style={{
          inset: 0,
          background: [
            "radial-gradient(circle at 35% 30%, #e8dfd0 0%, #b8a99a 48%, #5a4d44 92%)",
            "radial-gradient(circle at 70% 75%, rgba(0,0,0,0.55) 0%, transparent 55%)",
          ].join(","),
          boxShadow:
            "inset -8px -10px 22px rgba(0,0,0,0.55), 0 0 24px rgba(200,180,160,0.20)",
        }}
      />
      {/* Crater detail */}
      <div
        className="absolute rounded-full"
        style={{
          left: "32%",
          top: "40%",
          width: size * 0.12,
          height: size * 0.12,
          background:
            "radial-gradient(circle, rgba(80,68,58,0.55) 0%, transparent 70%)",
        }}
      />
    </div>
  );
});

// ─── Distant spiral galaxy — fine cosmic background detail ─────────────────

/**
 * A small, slowly rotating galaxy with conic-gradient spiral arms + a
 * brighter core. Sits in the upper-left quadrant for compositional balance
 * with the lower-left planet and upper-right moon.
 */
const SpiralGalaxy = memo(function SpiralGalaxy({
  parallax,
  scale,
}: {
  parallax: [number, number];
  scale: number;
}) {
  const [px, py] = parallax;
  const size = 260 * scale;
  const tx = px * -8 * scale;
  const ty = py * -6 * scale;
  return (
    <div
      className="absolute pointer-events-none"
      aria-hidden
      style={{
        left: "16%",
        top: "26%",
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        transform: `translate3d(${tx}px, ${ty}px, 0)`,
        willChange: "transform",
        opacity: 0.55,
        animation: "hs-galaxy-breath 16s ease-in-out infinite",
        mixBlendMode: "screen",
      }}
    >
      {/* Spiral arms — conic gradient with slow rotation */}
      <div
        className="absolute rounded-full"
        style={{
          inset: 0,
          background: [
            "conic-gradient(from 0deg, transparent 0deg, rgba(180,160,255,0.22) 30deg, transparent 70deg, rgba(140,200,255,0.18) 130deg, transparent 180deg, rgba(220,180,255,0.20) 230deg, transparent 290deg, rgba(160,180,255,0.16) 330deg, transparent 360deg)",
            "radial-gradient(circle, rgba(255,240,220,0.45) 0%, rgba(220,200,255,0.16) 18%, transparent 50%)",
          ].join(","),
          backgroundBlendMode: "screen",
          left: "50%",
          top: "50%",
          transform: "translate3d(-50%,-50%,0)",
          width: "100%",
          height: "100%",
          WebkitMaskImage:
            "radial-gradient(circle, #000 0%, rgba(0,0,0,0.85) 35%, rgba(0,0,0,0.4) 65%, transparent 88%)",
          maskImage:
            "radial-gradient(circle, #000 0%, rgba(0,0,0,0.85) 35%, rgba(0,0,0,0.4) 65%, transparent 88%)",
          animation: "hs-galaxy-spin 180s linear infinite",
        }}
      />
      {/* Bright galactic core */}
      <div
        className="absolute rounded-full"
        style={{
          left: "50%",
          top: "50%",
          width: size * 0.18,
          height: size * 0.18,
          marginLeft: -(size * 0.18) / 2,
          marginTop: -(size * 0.18) / 2,
          background:
            "radial-gradient(circle, rgba(255,245,225,0.95) 0%, rgba(255,220,180,0.55) 30%, rgba(220,180,255,0.18) 65%, transparent 100%)",
          boxShadow: "0 0 24px rgba(255,230,200,0.5)",
        }}
      />
    </div>
  );
});

// ─── Convergence energy dust — sparks spiraling into the central orb ────────

interface DustParticle {
  /** Start position offset (px from center) */
  startX: number;
  startY: number;
  size: number;
  delay: number;
  duration: number;
}

/**
 * Pre-computed energy dust particles: each starts at a perimeter point and
 * spirals into the center via a CSS variable–driven keyframe. The end-point
 * delta is `-startX, -startY`, so the @keyframes consume it via
 * `translate3d(var(--hs-dx), var(--hs-dy), 0)`.
 *
 * 18 sparks gives a rich convergence climax without flooding the GPU.
 */
const DUST_PARTICLES: DustParticle[] = (() => {
  const out: DustParticle[] = [];
  const COUNT = 18;
  for (let i = 0; i < COUNT; i++) {
    // Polar distribution — even angle spacing + jitter for organic feel
    const angle = (i / COUNT) * Math.PI * 2 + ((i * 17) % 5) * 0.06;
    const radius = 220 + (i % 4) * 40;
    out.push({
      startX: Math.cos(angle) * radius,
      startY: Math.sin(angle) * radius,
      size: 2 + (i % 3),
      delay: (i % 6) * 0.08,
      duration: 1.6 + (i % 5) * 0.15,
    });
  }
  return out;
})();

const ConvergenceDust = memo(function ConvergenceDust({
  color,
  scale,
}: {
  color: string;
  scale: number;
}) {
  return (
    <div
      className="absolute pointer-events-none"
      aria-hidden
      style={{
        left: "50%",
        top: "50%",
        width: 0,
        height: 0,
        willChange: "transform",
      }}
    >
      {DUST_PARTICLES.map((p, i) => {
        const sx = p.startX * scale;
        const sy = p.startY * scale;
        return (
          <div
            key={i}
            className="absolute rounded-full"
            style={
              {
                left: sx,
                top: sy,
                width: p.size,
                height: p.size,
                marginLeft: -p.size / 2,
                marginTop: -p.size / 2,
                background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
                boxShadow: `0 0 ${p.size * 3}px ${color}`,
                animation: `hs-dust-spiral ${p.duration}s cubic-bezier(0.4,0,0.2,1) ${p.delay}s forwards`,
                willChange: "transform, opacity",
                opacity: 0,
                // CSS custom properties consumed by hs-dust-spiral keyframes
                "--hs-dx": `${-sx}px`,
                "--hs-dy": `${-sy}px`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
});

// ─── Bottom atmospheric horizon — warm gradient grounds the deep space ──────

const BottomHorizon = memo(function BottomHorizon({
  palette,
}: {
  palette: PaletteConfig;
}) {
  return (
    <div
      className="absolute pointer-events-none"
      aria-hidden
      style={{
        left: 0,
        right: 0,
        bottom: 0,
        height: "38%",
        background: [
          // Warm low-horizon glow (dawn-like)
          `linear-gradient(180deg, transparent 0%, ${palette.haloOuter} 70%, rgba(255,180,140,0.06) 100%)`,
          // Cool atmospheric tint to harmonize with cosmic palette
          `linear-gradient(180deg, transparent 0%, ${palette.nebula[0]} 100%)`,
        ].join(","),
        backgroundBlendMode: "screen",
        mixBlendMode: "screen",
        animation: "hs-horizon 12s ease-in-out infinite",
        opacity: 0.65,
      }}
    />
  );
});

// ─── Constellation lines — hand-placed bright-star network ─────────────────

interface ConstAnchor {
  x: number;
  y: number;
  size: number;
  delay: number;
}

const CONST_ANCHORS: ConstAnchor[] = [
  // Cassiopeia-like zigzag near the top
  { x: 22, y: 12, size: 3.6, delay: 0.0 },
  { x: 33, y: 7, size: 4.2, delay: 0.5 },
  { x: 44, y: 14, size: 3.4, delay: 1.0 },
  { x: 56, y: 8, size: 4.0, delay: 1.5 },
  { x: 68, y: 16, size: 3.6, delay: 2.0 },
  // Lower-right triangle
  { x: 78, y: 82, size: 3.2, delay: 3.0 },
  { x: 88, y: 88, size: 3.8, delay: 3.5 },
  { x: 82, y: 94, size: 3.0, delay: 4.0 },
];

const CONST_LINES: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [5, 6],
  [6, 7],
  [5, 7],
];

const Constellations = memo(function Constellations() {
  return (
    <>
      <svg
        className="absolute inset-0 pointer-events-none"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style={{ opacity: 0.6, mixBlendMode: "screen" }}
        aria-hidden
      >
        <defs>
          <linearGradient id="hs-const-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(180,160,240,0.0)" />
            <stop offset="50%" stopColor="rgba(220,200,255,0.5)" />
            <stop offset="100%" stopColor="rgba(180,160,240,0.0)" />
          </linearGradient>
        </defs>
        {CONST_LINES.map(([a, b], i) => {
          const A = CONST_ANCHORS[a];
          const B = CONST_ANCHORS[b];
          return (
            <line
              key={i}
              x1={A.x}
              y1={A.y}
              x2={B.x}
              y2={B.y}
              stroke="url(#hs-const-line)"
              strokeWidth={0.16}
              vectorEffect="non-scaling-stroke"
              style={{
                animation: `hs-constellation ${8 + (i % 4)}s ease-in-out ${i * 0.3}s infinite`,
              }}
            />
          );
        })}
      </svg>
      {CONST_ANCHORS.map((a, i) => (
        <div
          key={i}
          className="absolute rounded-full pointer-events-none"
          aria-hidden
          style={{
            left: `${a.x}%`,
            top: `${a.y}%`,
            width: a.size,
            height: a.size,
            marginLeft: -a.size / 2,
            marginTop: -a.size / 2,
            background:
              "radial-gradient(circle, rgba(255,250,240,0.95) 0%, rgba(255,235,210,0.55) 40%, transparent 80%)",
            boxShadow: `0 0 ${a.size * 4}px rgba(255,235,210,0.55)`,
            animation: `hs-tw2 ${4 + (i % 3)}s ease-in-out ${a.delay}s infinite`,
          }}
        />
      ))}
    </>
  );
});

// ─── Comet — slow long-tailed sweep across the screen (looped) ──────────────

const Comet = memo(function Comet() {
  return (
    <div
      className="absolute pointer-events-none"
      aria-hidden
      style={{
        left: "98%",
        top: "12%",
        width: 180,
        height: 3,
        borderRadius: 1.5,
        transformOrigin: "100% 50%",
        transform: "rotate(218deg)",
        background:
          "linear-gradient(90deg, transparent 0%, rgba(180,210,255,0.35) 35%, rgba(220,235,255,0.85) 75%, rgba(255,255,255,1) 100%)",
        boxShadow:
          "0 0 14px rgba(200,220,255,0.7), 0 0 32px rgba(160,200,255,0.4)",
        animation: "hs-comet 18s ease-out 3s infinite",
        opacity: 0,
        willChange: "transform, opacity",
      }}
    />
  );
});

// ─── Aurora curtain — wavy translucent ribbon at the top of the sky ─────────

const AuroraCurtain = memo(function AuroraCurtain() {
  return (
    <div
      className="absolute pointer-events-none"
      aria-hidden
      style={{
        left: 0,
        right: 0,
        top: "-2%",
        height: "40%",
        // Tilted (~95deg) gradients with wide background-size so horizontal
        // background-position sweep produces a visible wavy shimmer. Two
        // layers run at slightly different angles + sizes to feel organic.
        // The ribbon shape comes from the vertical mask below.
        // Color #2 uses LOGIN_COSMIC.nebula (purple-violet) instead of the
        // personality-themed palette so the cosmic identity stays locked
        // to whatever the user just saw on LoginCosmicScene.
        background: [
          "linear-gradient(95deg, transparent 0%, rgba(120,220,200,0.20) 18%, rgba(140,200,240,0.14) 38%, rgba(180,160,255,0.18) 60%, transparent 82%)",
          `linear-gradient(100deg, transparent 0%, ${LOGIN_COSMIC.nebula[0]} 22%, ${LOGIN_COSMIC.nebula[1]} 52%, transparent 80%)`,
        ].join(","),
        backgroundSize: "240% 100%, 220% 100%",
        backgroundRepeat: "no-repeat, no-repeat",
        backgroundBlendMode: "screen",
        mixBlendMode: "screen",
        WebkitMaskImage:
          "linear-gradient(180deg, transparent 0%, #000 35%, #000 65%, transparent 100%)",
        maskImage:
          "linear-gradient(180deg, transparent 0%, #000 35%, #000 65%, transparent 100%)",
        animation: "hs-aurora-curtain 22s ease-in-out infinite",
        willChange: "background-position, opacity",
      }}
    />
  );
});

// ─── Energy filaments — radial lightning tendrils at convergence ────────────

interface Filament {
  rot: number;
  length: number;
  delay: number;
  duration: number;
}

const FILAMENTS: Filament[] = (() => {
  const out: Filament[] = [];
  const COUNT = 8;
  for (let i = 0; i < COUNT; i++) {
    out.push({
      rot: (i / COUNT) * 360 + ((i * 23) % 11) * 1.3,
      length: 110 + (i % 3) * 22,
      delay: (i % 4) * 0.08,
      duration: 1.4 + (i % 3) * 0.18,
    });
  }
  return out;
})();

// ─── Convergence chromatic ripple — gravitational-wave style impact ring ───

/**
 * Two concentric expanding rings with slight delay between them, simulating a
 * subtle chromatic aberration on the impact wave. Color tinted with cosmic
 * purple to feel like a continuation of LoginCosmicScene's identity.
 */
const ConvergenceRipple = memo(function ConvergenceRipple({
  scale,
}: {
  scale: number;
}) {
  const baseSize = 200 * scale;
  const rings = [
    {
      delay: 0,
      duration: 1.4,
      borderColor: "rgba(180,160,255,0.55)",
    },
    {
      delay: 0.16,
      duration: 1.5,
      borderColor: "rgba(255,200,200,0.42)",
    },
  ];
  return (
    <>
      {rings.map((r, i) => (
        <div
          key={i}
          className="absolute rounded-full pointer-events-none"
          aria-hidden
          style={{
            left: "50%",
            top: "50%",
            width: baseSize,
            height: baseSize,
            border: `1px solid ${r.borderColor}`,
            background: "transparent",
            mixBlendMode: "screen",
            animation: `hs-conv-ripple ${r.duration}s cubic-bezier(0.16,1,0.3,1) ${r.delay}s forwards`,
            willChange: "transform, opacity",
            opacity: 0,
          }}
        />
      ))}
    </>
  );
});

const EnergyFilaments = memo(function EnergyFilaments({
  color,
  scale,
}: {
  color: string;
  scale: number;
}) {
  return (
    <div
      className="absolute pointer-events-none"
      aria-hidden
      style={{
        left: "50%",
        top: "50%",
        width: 0,
        height: 0,
        willChange: "transform",
      }}
    >
      {FILAMENTS.map((f, i) => (
        <div
          key={i}
          className="absolute"
          style={
            {
              // Position the filament line so its left edge sits exactly at
              // the orb center (the wrapper's origin). top: -0.7 vertically
              // centers the 1.4px line on the y=0 axis so rotation produces
              // a clean radial spoke around the orb.
              left: 0,
              top: -0.7,
              width: f.length * scale,
              height: 1.4,
              background: `linear-gradient(90deg, ${color} 0%, rgba(255,255,255,0.4) 60%, transparent 100%)`,
              transformOrigin: "0% 50%",
              animation: `hs-filament ${f.duration}s cubic-bezier(0.4,0,0.2,1) ${f.delay}s forwards`,
              willChange: "transform, opacity",
              opacity: 0,
              mixBlendMode: "screen",
              boxShadow: `0 0 6px ${color}`,
              "--hs-rot": `${f.rot}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
});

// ─── Hero 3D orb — real Three.js + GLSL Fresnel orb ─────────────────────────

/**
 * Maps the welcome animation's personality + scene into shader-uniform colors
 * for VisualSoul3D. We use the personality theme directly so it matches the
 * user's existing 「光球助手」 (non-cute) aesthetic across the app.
 */
function Hero3DOrb({
  personality,
  scale,
}: {
  personality: Personality;
  scale: number;
}) {
  // Render the orb at xl (80px native) and CSS-transform-scale it up for
  // crisp, GPU-accelerated upscaling without blowing up the WebGL canvas.
  const NATIVE_PX = 80;
  // Final visible size ≈ 220px at scale=1 (~280 on large monitors)
  const targetSizePx = 220 * scale;
  const cssScale = targetSizePx / NATIVE_PX;

  // State arc: burst on entrance (white-hot generating) → settle to idle.
  // The 1.4s entrance keyframe overlaps with this so the orb feels alive
  // from the moment it materializes out of the convergence flash.
  const [orbState, setOrbState] = useState<"generating" | "idle">("generating");
  useEffect(() => {
    const t = setTimeout(() => setOrbState("idle"), 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    // Outer: anchors center + applies static upscale so the inner keyframe
    // animation can own `transform` exclusively. The static scale lives here
    // because keyframes overwrite `transform`, not its parent's transform.
    <div
      className="absolute pointer-events-none"
      style={{
        left: "50%",
        top: "50%",
        width: NATIVE_PX,
        height: NATIVE_PX,
        transform: `translate3d(-50%,-50%,0) scale(${cssScale})`,
        transformOrigin: "center center",
        willChange: "transform",
      }}
    >
      {/* Inner: fills the 80x80 outer exactly (NO inset-0 + 50% mix that
          collapsed the box to 40x40 in v2). Animation transforms relative to
          the inner's own center, scaling up and down without re-centering. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          opacity: 0,
          animation:
            "hs-orb3d-reveal 1.4s cubic-bezier(0.16,1,0.3,1) forwards, hs-orb3d-hover 5.2s ease-in-out 1.4s infinite",
          transformOrigin: "center center",
          willChange: "transform, opacity",
        }}
      >
        <Suspense fallback={null}>
          <VisualSoul3D personality={personality} state={orbState} size="xl" />
        </Suspense>
      </div>
    </div>
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
  const parallaxRaf = useRef(0);
  const [parallax, setParallax] = useState<[number, number]>([0, 0]);
  const originalAmbientVolumeRef = useRef<number | null>(null);

  const { personality } = usePersonality();
  const isMobile = useIsMobile();
  const ambient = useAmbient();
  const palette = useMemo(() => buildPalette(personality), [personality]);
  // Cosmic backdrop is locked to LOGIN_COSMIC for visual continuity with
  // the login screen — see comment on LOGIN_COSMIC. Personality still tints
  // the orbs / hero / text glow via `palette`.
  const responsiveScale = useMemo(() => {
    const viewportWidth = containerSize[0] || 1280;
    const baseByWidth = Math.max(0.68, Math.min(1.05, viewportWidth / 1280));
    return isMobile ? Math.min(0.82, baseByWidth) : baseByWidth;
  }, [isMobile, containerSize]);

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

  // Cursor-driven parallax for stronger 3D depth (desktop only)
  useEffect(() => {
    if (!show || prefersReducedMotion) return;
    const onMove = (e: MouseEvent) => {
      const nx = (e.clientX / window.innerWidth - 0.5) * 2;
      const ny = (e.clientY / window.innerHeight - 0.5) * 2;
      cancelAnimationFrame(parallaxRaf.current);
      parallaxRaf.current = requestAnimationFrame(() => {
        setParallax([
          Math.max(-1, Math.min(1, nx)),
          Math.max(-1, Math.min(1, ny)),
        ]);
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(parallaxRaf.current);
      parallaxRaf.current = requestAnimationFrame(() => setParallax([0, 0]));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(parallaxRaf.current);
    };
  }, [show, prefersReducedMotion]);

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

  // Link login animation with existing ambient engine: cinematic volume envelope
  useEffect(() => {
    if (!show || prefersReducedMotion) return;
    if (!ambient.isUnlocked || ambient.isMuted) return;
    const base = originalAmbientVolumeRef.current ?? 0.25;
    const intro = Math.max(0.06, base * 0.72);
    const climax = Math.min(1, base + 0.12);
    ambient.setVolume(intro);

    const t1 = setTimeout(() => ambient.setVolume(climax), 2200);
    const t2 = setTimeout(() => ambient.setVolume(Math.max(0.05, base * 0.9)), 4300);
    const t3 = setTimeout(() => ambient.setVolume(base), TOTAL_DURATION_MS);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      if (originalAmbientVolumeRef.current != null) {
        ambient.setVolume(originalAmbientVolumeRef.current);
      }
      originalAmbientVolumeRef.current = null;
    };
  }, [
    show,
    prefersReducedMotion,
    ambient.isUnlocked,
    ambient.isMuted,
    ambient.setVolume,
  ]);

  useEffect(() => {
    if (show) return;
    originalAmbientVolumeRef.current = ambient.volume;
  }, [show, ambient.volume]);

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
            // Locked to LoginCosmicScene's exact backdrop so the user feels
            // the login screen continue, not a switch to ambient theme.
            background: LOGIN_COSMIC.backdrop,
            backgroundBlendMode: "screen, normal",
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

          {/* Deepened cosmic accent — three-radial corner glows from
              LoginCosmicScene (purple top-left / blue lower-right / pink
              bottom). hs-depth-breathe gives a subtle atmospheric pulse. */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: LOGIN_COSMIC.accentLayer,
              animation: "hs-depth-breathe 8s ease-in-out infinite",
            }}
          />

          {/* Galactic plane — deepest atmospheric layer (mirrors login screen) */}
          <MilkyWayBand />

          {/* Login-screen nebula clouds — purple lower-left, pink upper-right
              + slow conic dust ring. Exact mirror of LoginCosmicScene's
              Nebula so the animation IS the same cosmic environment. */}
          <LoginNebula scale={responsiveScale} />

          {/* Aurora curtain — wavy translucent ribbon at top of sky */}
          <AuroraCurtain />

          {/* Star field — pure CSS animations */}
          <StarField />

          {/* Constellation network — hand-placed bright-star groupings */}
          <Constellations />
          <DepthParallaxPlanes parallax={parallax} scale={responsiveScale} />
          <VolumetricMist
            parallax={parallax}
            palette={palette}
            scale={responsiveScale}
          />

          {/* Off-screen sun + lens flare chain — cinematic optical axis */}
          <SunLensFlare parallax={parallax} />

          {/* Bottom atmospheric horizon — grounds the composition. Rendered
              BEFORE planet/moon/galaxy so they sit on top of the warm tint
              instead of having their dark sides washed by additive blend. */}
          <BottomHorizon palette={palette} />

          {/* Distant planet (lower-left) + moon (upper-right) for parallax depth */}
          <DistantPlanet parallax={parallax} scale={responsiveScale} />
          <DistantMoon parallax={parallax} scale={responsiveScale} />

          {/* Distant spiral galaxy (upper-left) — completes the cosmic triad */}
          <SpiralGalaxy parallax={parallax} scale={responsiveScale} />

          {/* Shooting stars — cinematic depth */}
          <ShootingStars tint={palette.meteorTint} />

          {/* Long-tailed comet — slow looping cinematic sweep */}
          <Comet />

          {/* Subtle vignette overlay — focuses the eye on the central orb */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse at 50% 50%, transparent 25%, rgba(5,3,12,0.55) 100%)",
            }}
          />

          {/* Flying orbs with trailing afterglow — CSS animations */}
          {phase !== "stars" && (
            <FlyingOrbs palette={palette} containerSize={containerSize} />
          )}

          {/* Convergence flash */}
          {phase === "converged" && <ConvergenceFlash scale={responsiveScale} />}

          {/* Convergence chromatic ripple — gravitational-wave impact ring */}
          {phase === "converged" && (
            <ConvergenceRipple scale={responsiveScale} />
          )}

          {/* Convergence energy dust — sparks spiraling into the central orb */}
          {phase === "converged" && (
            <ConvergenceDust
              color={palette.sparkleColor}
              scale={responsiveScale}
            />
          )}

          {/* Energy filaments — radial lightning tendrils at climax */}
          {phase === "converged" && (
            <EnergyFilaments
              color={palette.sparkleColor}
              scale={responsiveScale}
            />
          )}

          {/* Nebula aura (appears with central orb) */}
          {(phase === "converged" || phase === "fadeout") && (
            <NebulaAura colors={palette.nebula} scale={responsiveScale} />
          )}

          {/* Orbiting micro-sparkles */}
          {(phase === "converged" || phase === "fadeout") && (
            <OrbitingSparkles color={palette.sparkleColor} />
          )}

          {/* Cinematic rays around hero orb */}
          {(phase === "converged" || phase === "fadeout") && (
            <HeroLightRays color={palette.haloOuter} scale={responsiveScale} />
          )}

          {/* Hero 3D orb (Three.js + GLSL Fresnel) — protagonist sits behind
              the CSS halo/text layers so the welcome label stays readable
              while the orb provides the dimensional core glow. Uses the
              user's personality theme to match the 「光球助手」 aesthetic. */}
          {(phase === "converged" || phase === "fadeout") && (
            <Hero3DOrb personality={personality} scale={responsiveScale} />
          )}

          {/* Central orb (CSS halos, aurora, pulse rings, welcome text) */}
          {(phase === "converged" || phase === "fadeout") && (
            <CentralOrb
              palette={palette}
              parallax={parallax}
              scale={responsiveScale}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
