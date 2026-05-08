/**
 * LoginCosmicScene.tsx — 登入畫面深空背景（3D 行星 + 星空 + 星雲）
 *
 * 連續、可呼吸的太空場景，提供登入卡片背後的氛圍：
 *   • 三層深度星場（遠/中/近）+ 色溫差異 + 視差漂移
 *   • 主行星：球體漸層 + 終端線（明暗面）+ 大氣輪廓 + 環狀光環
 *   • 衛星：較小的次行星增強深度
 *   • 流動星雲（conic + radial gradient）
 *   • 流星定時劃過（CSS 動畫，無 JS 排程）
 *   • 滑鼠視差驅動的 3D 深度感（桌機）
 *
 * 效能：純 CSS @keyframes + transform: translate3d，無 SVG filter / blur()。
 * 無互動：pointer-events:none，永不擋住前景表單。
 */

import { memo, useEffect, useRef, useState } from "react";

// ─── Static keyframes ────────────────────────────────────────────────────────

const KEYFRAMES = [
  // Star twinkle per layer
  "@keyframes lcs-tw0{0%,100%{opacity:.22}50%{opacity:.08}}",
  "@keyframes lcs-tw1{0%,100%{opacity:.42}50%{opacity:.18}}",
  "@keyframes lcs-tw2{0%,100%{opacity:.7}50%{opacity:.3}}",
  // Star drift (vertical float per layer)
  "@keyframes lcs-dr0{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-2px,0)}}",
  "@keyframes lcs-dr1{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-4px,0)}}",
  "@keyframes lcs-dr2{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-7px,0)}}",
  // Nebula slow breath
  "@keyframes lcs-nebula{0%,100%{opacity:.42;transform:translate3d(-50%,-50%,0) scale(1)}50%{opacity:.62;transform:translate3d(-50%,-50%,0) scale(1.08)}}",
  // Aurora veil rotation around planet
  "@keyframes lcs-aurora{0%{transform:translate3d(-50%,-50%,0) rotate(0deg)}100%{transform:translate3d(-50%,-50%,0) rotate(360deg)}}",
  // Slow planet rotation (background gradient drift to fake surface motion)
  "@keyframes lcs-planet-spin{0%{background-position:0% 50%,30% 25%,70% 75%,35% 30%}100%{background-position:200% 50%,30% 25%,70% 75%,35% 30%}}",
  // Planet gentle bob
  "@keyframes lcs-planet-bob{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-10px,0)}}",
  // Moon orbit drift
  "@keyframes lcs-moon-orbit{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(8px,-6px,0)}}",
  // Atmospheric rim pulse
  "@keyframes lcs-rim{0%,100%{opacity:.55}50%{opacity:.85}}",
  // Looped meteor sweep — only the first ~10% of the cycle is visible, the
  // rest is dark, so the animation can use a long iteration period without
  // playing the streak in slow motion.
  "@keyframes lcs-meteor{" +
    "0%{transform:translate3d(0,0,0) scaleX(.3);opacity:0}" +
    "1.5%{opacity:.85}" +
    "5%{transform:translate3d(-160px,128px,0) scaleX(.85);opacity:.85}" +
    "10%{transform:translate3d(-280px,220px,0) scaleX(1);opacity:0}" +
    "100%{transform:translate3d(-280px,220px,0) scaleX(1);opacity:0}}",
  // Vignette breath
  "@keyframes lcs-vignette{0%,100%{opacity:.55}50%{opacity:.7}}",
  // Soft cosmic dust drift
  "@keyframes lcs-dust{0%{transform:translate3d(-50%,-50%,0) rotate(0deg)}100%{transform:translate3d(-50%,-50%,0) rotate(360deg)}}",
  // Milky Way slow breath (brightness only)
  "@keyframes lcs-milky{0%,100%{opacity:.55}50%{opacity:.78}}",
  // Constellation line shimmer (drawn-in feel)
  "@keyframes lcs-constellation{0%,100%{opacity:.18}50%{opacity:.42}}",
  // Sun off-screen pulse
  "@keyframes lcs-sun{0%,100%{opacity:.6;transform:translate3d(-50%,-50%,0) scale(1)}50%{opacity:.85;transform:translate3d(-50%,-50%,0) scale(1.04)}}",
  // Lens flare drift
  "@keyframes lcs-flare{0%,100%{opacity:.35}50%{opacity:.6}}",
  // Cloud band drift (independent of planet body)
  "@keyframes lcs-clouds{0%{background-position:0% 50%}100%{background-position:-200% 50%}}",
  // Foreground dust mote — slow drift across the screen
  "@keyframes lcs-mote{0%{transform:translate3d(0,0,0);opacity:0}10%{opacity:.65}90%{opacity:.55}100%{transform:translate3d(60px,-40px,0);opacity:0}}",
  // Card title shimmer (background-position sweep)
  "@keyframes lcs-title-shimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}",
  // Corner glyph twinkle
  "@keyframes lcs-glyph{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:.95;transform:scale(1.15)}}",
].join("");

// ─── Star data (computed once at module load) ────────────────────────────────

interface StarData {
  x: number;
  y: number;
  size: number;
  layer: 0 | 1 | 2;
  twinkleDur: number;
  driftDur: number;
  twinkleDelay: number;
  driftDelay: number;
  bg: string;
  shadow: string;
}

const STAR_LAYERS = [
  { count: 56, sizeMin: 0.7, sizeMax: 1.4, opMin: 0.1, opMax: 0.32 },
  { count: 28, sizeMin: 1.4, sizeMax: 2.6, opMin: 0.2, opMax: 0.55 },
  { count: 10, sizeMin: 2.6, sizeMax: 4.4, opMin: 0.35, opMax: 0.85 },
] as const;

const STARS: StarData[] = (() => {
  const out: StarData[] = [];
  const tints = [
    (o: number) => `rgba(220,232,255,${o.toFixed(2)})`, // distant — cool blue-white
    (o: number) => `rgba(255,248,235,${o.toFixed(2)})`, // mid — warm white
    (o: number) => `rgba(255,232,200,${o.toFixed(2)})`, // close — golden
  ];
  STAR_LAYERS.forEach((layer, li) => {
    for (let i = 0; i < layer.count; i++) {
      const seed = li * 1000 + i;
      const x = (((seed * 17 + 31) % 9973) / 9973) * 100;
      const y = (((seed * 41 + 7) % 9967) / 9967) * 100;
      const size =
        layer.sizeMin +
        (((seed * 13) % 100) / 100) * (layer.sizeMax - layer.sizeMin);
      const opacity =
        layer.opMin + (((seed * 29) % 100) / 100) * (layer.opMax - layer.opMin);
      const tintFn = tints[li];
      out.push({
        x,
        y,
        size,
        layer: li as 0 | 1 | 2,
        twinkleDur: 3 + (seed % 6),
        driftDur: (li === 0 ? 7 : li === 1 ? 9 : 13) + (seed % 4),
        twinkleDelay: (i % 9) * 0.32,
        driftDelay: (i % 7) * 0.4,
        bg:
          li === 2
            ? `radial-gradient(circle, ${tintFn(opacity)} 0%, transparent 70%)`
            : tintFn(opacity),
        shadow:
          li >= 1
            ? `0 0 ${(size * 2.6).toFixed(1)}px ${tintFn(opacity * 0.55)}`
            : "none",
      });
    }
  });
  return out;
})();

// ─── Meteor configuration (looped) ───────────────────────────────────────────

interface MeteorData {
  x: number;
  y: number;
  angle: number;
  length: number;
  delay: number;
  loopDur: number;
}

const METEORS: MeteorData[] = [
  { x: 78, y: 6, angle: 222, length: 110, delay: 1.5, loopDur: 11 },
  { x: 32, y: 12, angle: 215, length: 80, delay: 4.8, loopDur: 14 },
  { x: 92, y: 28, angle: 235, length: 95, delay: 8.2, loopDur: 13 },
  { x: 18, y: 38, angle: 200, length: 70, delay: 12.0, loopDur: 16 },
];

// ─── Constellation anchors — hand-placed bright stars + connecting lines ───
// Coordinates are viewport-% (0-100). Lines are drawn via SVG with
// preserveAspectRatio=none so endpoints align exactly with the absolutely-
// positioned anchor stars below.

interface Anchor {
  x: number;
  y: number;
  size: number;
  delay: number;
}

const CONSTELLATION_ANCHORS: Anchor[] = [
  // Upper galactic chain (Cassiopeia-like zigzag)
  { x: 12, y: 18, size: 3.6, delay: 0.0 },
  { x: 24, y: 11, size: 4.2, delay: 0.5 },
  { x: 35, y: 22, size: 3.4, delay: 1.0 },
  { x: 48, y: 14, size: 4.0, delay: 1.5 },
  { x: 60, y: 26, size: 3.6, delay: 2.0 },
  { x: 74, y: 18, size: 4.4, delay: 2.5 },
  { x: 88, y: 32, size: 3.8, delay: 3.0 },
  // Lower-left triangle
  { x: 8, y: 78, size: 3.2, delay: 3.5 },
  { x: 22, y: 84, size: 3.8, delay: 4.0 },
  { x: 14, y: 92, size: 3.0, delay: 4.5 },
];

// ─── Subcomponents ───────────────────────────────────────────────────────────

/**
 * Milky Way galactic plane — soft diagonal band with extra dim stars on top.
 * Sits beneath the main star field for a true "looking from inside the galaxy"
 * feel without overwhelming the composition.
 */
const MilkyWay = memo(function MilkyWay() {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        // Cover the screen at a tilt; soft mask keeps the band feathered.
        left: "-20%",
        top: "-10%",
        width: "140%",
        height: "120%",
        transform: "rotate(-22deg)",
        background: [
          // Bright spine
          "linear-gradient(180deg, transparent 38%, rgba(220,210,255,0.12) 46%, rgba(255,240,255,0.18) 50%, rgba(220,210,255,0.12) 54%, transparent 62%)",
          // Color cast — violet on one side, cyan on the other
          "linear-gradient(180deg, transparent 40%, rgba(150,110,220,0.10) 48%, rgba(110,180,240,0.08) 52%, transparent 60%)",
        ].join(","),
        backgroundBlendMode: "screen",
        mixBlendMode: "screen",
        WebkitMaskImage:
          "linear-gradient(90deg, transparent 0%, #000 18%, #000 82%, transparent 100%)",
        maskImage:
          "linear-gradient(90deg, transparent 0%, #000 18%, #000 82%, transparent 100%)",
        opacity: 0.7,
        animation: "lcs-milky 14s ease-in-out infinite",
      }}
    />
  );
});

/**
 * Constellation anchors only (no connecting wireframe lines), so the
 * background keeps depth while avoiding geometric frame overlays.
 */
const Constellations = memo(function Constellations() {
  return (
    <>
      {CONSTELLATION_ANCHORS.map((a, i) => (
        <div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: `${a.x}%`,
            top: `${a.y}%`,
            width: a.size,
            height: a.size,
            marginLeft: -a.size / 2,
            marginTop: -a.size / 2,
            background:
              "radial-gradient(circle, rgba(255,250,240,0.95) 0%, rgba(255,235,210,0.6) 40%, transparent 80%)",
            boxShadow: `0 0 ${a.size * 4}px rgba(255,235,210,0.6)`,
            animation: `lcs-tw2 ${4 + (i % 3)}s ease-in-out ${a.delay}s infinite`,
          }}
        />
      ))}
    </>
  );
});

/**
 * Off-screen sun + lens flare hex artifacts that align across the screen.
 * The "sun" sits just past the upper-right corner and casts a chain of
 * hexagonal flares back through the optical axis (to lower-left).
 */
const SunWithLensFlare = memo(function SunWithLensFlare({
  parallax,
}: {
  parallax: [number, number];
}) {
  const [px, py] = parallax;
  // Optical axis: from sun (105, -8) toward opposite corner. Place flares
  // along the axis with parallax offset for subtle 3D feel.
  const flares = [
    { t: 0.18, size: 28, color: "rgba(255,210,160,0.45)" },
    { t: 0.34, size: 18, color: "rgba(180,200,255,0.32)" },
    { t: 0.52, size: 42, color: "rgba(255,180,180,0.22)" },
    { t: 0.7, size: 22, color: "rgba(160,220,255,0.28)" },
    { t: 0.86, size: 14, color: "rgba(255,235,210,0.4)" },
  ];
  const SUN_X = 105;
  const SUN_Y = -8;
  const END_X = -10;
  const END_Y = 110;

  return (
    <>
      {/* Sun core glow (mostly off-screen) */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          left: `${SUN_X}%`,
          top: `${SUN_Y}%`,
          width: 320,
          height: 320,
          marginLeft: -160,
          marginTop: -160,
          background:
            "radial-gradient(circle, rgba(255,235,200,0.9) 0%, rgba(255,200,150,0.4) 22%, rgba(255,160,120,0.16) 45%, transparent 70%)",
          mixBlendMode: "screen",
          animation: "lcs-sun 8s ease-in-out infinite",
          willChange: "transform, opacity",
        }}
      />
      {/* Lens flare chain along optical axis */}
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
              animation: `lcs-flare ${5 + (i % 3)}s ease-in-out ${i * 0.4}s infinite`,
              willChange: "opacity",
            }}
          />
        );
      })}
    </>
  );
});

/**
 * Foreground dust motes — bigger, glowing particles that drift slowly across
 * the screen, adding parallax foreground depth (camera looking through them).
 */
const FG_MOTES = [
  { x: 12, y: 28, size: 3, dur: 22, delay: 0 },
  { x: 78, y: 14, size: 2.4, dur: 26, delay: 4 },
  { x: 38, y: 72, size: 3.4, dur: 24, delay: 8 },
  { x: 86, y: 60, size: 2.6, dur: 28, delay: 2 },
  { x: 22, y: 48, size: 3, dur: 30, delay: 12 },
  { x: 58, y: 86, size: 2.8, dur: 25, delay: 16 },
];

const ForegroundMotes = memo(function ForegroundMotes() {
  return (
    <>
      {FG_MOTES.map((m, i) => (
        <div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: `${m.x}%`,
            top: `${m.y}%`,
            width: m.size,
            height: m.size,
            background:
              "radial-gradient(circle, rgba(255,245,225,0.9) 0%, rgba(255,220,180,0.4) 50%, transparent 100%)",
            boxShadow: "0 0 8px rgba(255,230,200,0.6)",
            animation: `lcs-mote ${m.dur}s ease-in-out ${m.delay}s infinite`,
            willChange: "transform, opacity",
            opacity: 0,
          }}
        />
      ))}
    </>
  );
});

const StarField = memo(function StarField() {
  return (
    <>
      {STARS.map((s, i) => (
        <div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: s.size,
            height: s.size,
            left: `${s.x}%`,
            top: `${s.y}%`,
            background: s.bg,
            boxShadow: s.shadow,
            animation:
              `lcs-tw${s.layer} ${s.twinkleDur}s ease-in-out ${s.twinkleDelay}s infinite,` +
              `lcs-dr${s.layer} ${s.driftDur}s ease-in-out ${s.driftDelay}s infinite`,
          }}
        />
      ))}
    </>
  );
});

const Meteors = memo(function Meteors() {
  return (
    <>
      {METEORS.map((m, i) => (
        <div
          key={i}
          className="absolute pointer-events-none"
          style={{
            left: `${m.x}%`,
            top: `${m.y}%`,
            width: m.length,
            height: 2,
            borderRadius: 1,
            background:
              "linear-gradient(90deg, transparent 0%, rgba(200,220,255,0.55) 45%, rgba(255,255,255,0.95) 100%)",
            transformOrigin: "100% 50%",
            transform: `rotate(${m.angle}deg)`,
            // Long iteration so streaks only appear briefly; per-meteor delay
            // distributes them across the loop.
            animation: `lcs-meteor ${m.loopDur}s ease-out ${m.delay}s infinite`,
            opacity: 0,
            willChange: "transform, opacity",
          }}
        />
      ))}
    </>
  );
});

// ─── 3D planet with terminator + atmosphere + ring ──────────────────────────

function Planet({
  parallax,
  scale,
}: {
  parallax: [number, number];
  scale: number;
}) {
  const [px, py] = parallax;
  const size = 540 * scale;
  const tx = px * 14 * scale;
  const ty = py * 10 * scale;

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        // Position: behind/around the auth card, slightly offset to add depth
        left: "50%",
        top: "52%",
        width: size,
        height: size,
        transform: `translate3d(calc(-50% + ${tx}px), calc(-50% + ${ty}px), 0)`,
        willChange: "transform",
      }}
    >
      {/* Outer atmospheric halo — soft cosmic glow extending past planet */}
      <div
        className="absolute rounded-full"
        style={{
          inset: -size * 0.28,
          background:
            "radial-gradient(circle, rgba(160,140,230,0.18) 0%, rgba(120,90,200,0.10) 28%, rgba(80,60,160,0.04) 50%, transparent 70%)",
          animation: "lcs-rim 7s ease-in-out infinite",
        }}
      />

      {/* Aurora veil — slow rotating conic ring giving 3D shimmer */}
      <div
        className="absolute rounded-full"
        style={{
          left: "50%",
          top: "50%",
          width: size * 1.25,
          height: size * 1.25,
          marginLeft: -size * 0.625,
          marginTop: -size * 0.625,
          background:
            "conic-gradient(from 30deg, transparent 0deg, rgba(180,150,255,0.16) 60deg, transparent 130deg, rgba(120,200,255,0.12) 220deg, transparent 320deg)",
          mixBlendMode: "screen",
          opacity: 0.55,
          animation: "lcs-aurora 60s linear infinite",
          willChange: "transform",
        }}
      />

      {/* Planet ring — subtle elliptical band (Saturn-like) */}
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
            "linear-gradient(90deg, transparent 0%, rgba(200,180,255,0.12) 18%, rgba(230,210,255,0.32) 50%, rgba(200,180,255,0.12) 82%, transparent 100%)",
          boxShadow:
            "0 0 24px rgba(180,160,240,0.18), inset 0 0 18px rgba(255,240,255,0.2)",
          opacity: 0.85,
        }}
      />
      {/* Ring shadow on the front of the planet — sliver stripe */}
      <div
        className="absolute rounded-full overflow-hidden"
        style={{
          left: "50%",
          top: "50%",
          width: size * 0.78,
          height: size * 0.78,
          marginLeft: -(size * 0.78) / 2,
          marginTop: -(size * 0.78) / 2,
        }}
      >
        <div
          className="absolute"
          style={{
            left: "-30%",
            top: "48%",
            width: "160%",
            height: 4,
            transform: "rotate(-18deg)",
            background:
              "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.35) 40%, rgba(0,0,0,0.45) 60%, transparent 100%)",
            filter: "none",
          }}
        />
      </div>

      {/* Planet body — gradient sphere with terminator (light/dark side) + surface bands */}
      <div
        className="absolute rounded-full"
        style={{
          left: "50%",
          top: "50%",
          width: size * 0.78,
          height: size * 0.78,
          marginLeft: -(size * 0.78) / 2,
          marginTop: -(size * 0.78) / 2,
          // Layer 1 = horizontal striations (gas-giant feel) — animated drift
          // Layer 2 = warm highlight (sun-lit upper-left)
          // Layer 3 = cool deep shadow (lower-right night side)
          // Layer 4 = base body gradient
          background: [
            "linear-gradient(180deg, rgba(255,235,210,0.06) 0%, rgba(160,120,200,0.06) 22%, rgba(120,90,180,0.0) 38%, rgba(180,140,220,0.05) 56%, rgba(110,80,170,0.0) 72%, rgba(200,160,240,0.06) 92%)",
            "radial-gradient(circle at 30% 25%, rgba(255,225,190,0.32) 0%, rgba(255,210,180,0.0) 32%)",
            "radial-gradient(circle at 72% 78%, rgba(20,10,38,0.78) 0%, rgba(34,18,60,0.45) 38%, rgba(70,40,120,0.0) 62%)",
            "radial-gradient(circle at 36% 32%, #8a6fc5 0%, #5b3f95 28%, #36256a 55%, #1a1138 88%)",
          ].join(","),
          backgroundSize: "300% 100%, auto, auto, auto",
          backgroundRepeat: "repeat-x, no-repeat, no-repeat, no-repeat",
          // Inner shadow — terminator dark rim + subtle inner highlight
          boxShadow: [
            "inset -38px -42px 110px rgba(0,0,0,0.65)",
            "inset 28px 26px 90px rgba(190,160,255,0.18)",
            "inset -2px -4px 18px rgba(0,0,0,0.55)",
            "0 0 70px rgba(160,130,230,0.32)",
            "0 0 180px rgba(90,60,170,0.28)",
          ].join(","),
          animation:
            "lcs-planet-spin 90s linear infinite, lcs-planet-bob 12s ease-in-out infinite",
          willChange: "background-position, transform",
        }}
      />

      {/* Cloud band — drifts across the planet face independently for life */}
      <div
        className="absolute rounded-full overflow-hidden pointer-events-none"
        style={{
          left: "50%",
          top: "50%",
          width: size * 0.78,
          height: size * 0.78,
          marginLeft: -(size * 0.78) / 2,
          marginTop: -(size * 0.78) / 2,
          // Inner mask so clouds don't bleed past the limb
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
              "linear-gradient(180deg, transparent 22%, rgba(230,210,255,0.16) 32%, transparent 42%, rgba(200,180,255,0.12) 56%, transparent 66%, rgba(220,200,255,0.14) 78%, transparent 88%)",
            backgroundSize: "300% 100%",
            animation: "lcs-clouds 110s linear infinite",
            mixBlendMode: "screen",
            opacity: 0.7,
          }}
        />
      </div>

      {/* Atmospheric rim — cool blue/violet limb glow on the lit side
       * (Earth-like Rayleigh scattering) */}
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
            "radial-gradient(circle at 32% 26%, transparent 54%, rgba(120,180,255,0.22) 60%, rgba(200,225,255,0.42) 63%, rgba(255,235,255,0.32) 65%, transparent 70%)",
          mixBlendMode: "screen",
          opacity: 0.9,
          animation: "lcs-rim 6s ease-in-out infinite",
        }}
      />

      {/* Limb darkening — thin dark ring at the planet edge for sphere
       * volume (mimics atmospheric absorption near the limb) */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          left: "50%",
          top: "50%",
          width: size * 0.78,
          height: size * 0.78,
          marginLeft: -(size * 0.78) / 2,
          marginTop: -(size * 0.78) / 2,
          background:
            "radial-gradient(circle, transparent 70%, rgba(0,0,0,0.35) 86%, rgba(0,0,0,0.55) 95%, transparent 100%)",
          mixBlendMode: "multiply",
          opacity: 0.6,
        }}
      />

      {/* Specular catchlight — small bright dot for "wet glass" feel */}
      <div
        className="absolute rounded-full"
        style={{
          left: `calc(50% - ${size * 0.18}px)`,
          top: `calc(50% - ${size * 0.22}px)`,
          width: size * 0.06,
          height: size * 0.04,
          background:
            "radial-gradient(ellipse, rgba(255,255,255,0.85) 0%, rgba(255,240,220,0.25) 60%, transparent 100%)",
          transform: "rotate(-22deg)",
          opacity: 0.7,
        }}
      />
    </div>
  );
}

// ─── Distant smaller moon for parallax depth ────────────────────────────────

const Moon = memo(function Moon({
  parallax,
  scale,
}: {
  parallax: [number, number];
  scale: number;
}) {
  const [px, py] = parallax;
  const size = 96 * scale;
  const tx = px * -22 * scale;
  const ty = py * -16 * scale;
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: "82%",
        top: "22%",
        width: size,
        height: size,
        transform: `translate3d(${tx}px, ${ty}px, 0)`,
        willChange: "transform",
        animation: "lcs-moon-orbit 18s ease-in-out infinite",
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
            "inset -10px -12px 28px rgba(0,0,0,0.55), 0 0 30px rgba(200,180,160,0.22)",
        }}
      />
      {/* Subtle craters */}
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
      <div
        className="absolute rounded-full"
        style={{
          left: "55%",
          top: "55%",
          width: size * 0.08,
          height: size * 0.08,
          background:
            "radial-gradient(circle, rgba(80,68,58,0.45) 0%, transparent 70%)",
        }}
      />
    </div>
  );
});

// ─── Drifting nebula clouds ─────────────────────────────────────────────────

const Nebula = memo(function Nebula({ scale }: { scale: number }) {
  const big = 1100 * scale;
  return (
    <>
      <div
        className="absolute rounded-full"
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
          animation: "lcs-nebula 18s ease-in-out infinite",
          willChange: "transform, opacity",
        }}
      />
      <div
        className="absolute rounded-full"
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
          animation: "lcs-nebula 22s ease-in-out 2s infinite",
          willChange: "transform, opacity",
        }}
      />
      {/* Slow swirling cosmic dust */}
      <div
        className="absolute rounded-full"
        style={{
          left: "50%",
          top: "50%",
          width: big * 1.4,
          height: big * 1.4,
          background:
            "conic-gradient(from 0deg, transparent 0deg, rgba(160,140,230,0.06) 80deg, transparent 160deg, rgba(120,180,255,0.05) 240deg, transparent 360deg)",
          mixBlendMode: "screen",
          animation: "lcs-dust 90s linear infinite",
          willChange: "transform",
        }}
      />
    </>
  );
});

// ─── Main component ─────────────────────────────────────────────────────────

export default function LoginCosmicScene() {
  const [parallax, setParallax] = useState<[number, number]>([0, 0]);
  const [scale, setScale] = useState(1);
  const [reduced, setReduced] = useState(false);
  const rafRef = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const recalc = () => {
      const w = window.innerWidth;
      // Clamp so the planet stays elegant on phones and doesn't overflow on big monitors.
      setScale(Math.max(0.55, Math.min(1.15, w / 1280)));
    };
    recalc();
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const onMove = (e: MouseEvent) => {
      const nx = (e.clientX / window.innerWidth - 0.5) * 2;
      const ny = (e.clientY / window.innerHeight - 0.5) * 2;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setParallax([
          Math.max(-1, Math.min(1, nx)),
          Math.max(-1, Math.min(1, ny)),
        ]);
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, [reduced]);

  return (
    <div
      aria-hidden
      className="absolute inset-0 overflow-hidden pointer-events-none"
      style={{
        // Deep cosmic gradient — base layer
        background: [
          "radial-gradient(ellipse at 50% 42%, rgba(36,22,68,0.92) 0%, rgba(14,8,30,0.98) 55%, rgba(4,2,14,1) 100%)",
          "linear-gradient(180deg, #0b0820 0%, #110a2a 100%)",
        ].join(","),
        backgroundBlendMode: "screen, normal",
        isolation: "isolate",
      }}
    >
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

      {/* Color accents (corner glows) for cinematic depth */}
      <div
        className="absolute inset-0"
        style={{
          background: [
            "radial-gradient(ellipse at 18% 22%, rgba(80,60,160,0.32) 0%, transparent 55%)",
            "radial-gradient(ellipse at 82% 76%, rgba(40,90,170,0.26) 0%, transparent 58%)",
            "radial-gradient(ellipse at 50% 88%, rgba(180,90,160,0.14) 0%, transparent 55%)",
          ].join(","),
        }}
      />

      {/* Galactic plane — the deepest atmospheric layer */}
      <MilkyWay />

      <Nebula scale={scale} />

      <StarField />

      <Constellations />

      <SunWithLensFlare parallax={parallax} />

      <Moon parallax={parallax} scale={scale} />

      <Planet parallax={parallax} scale={scale} />

      <Meteors />

      <ForegroundMotes />

      {/* Vignette — keeps focus on the auth card */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, transparent 30%, rgba(2,1,8,0.55) 100%)",
          animation: "lcs-vignette 10s ease-in-out infinite",
        }}
      />
    </div>
  );
}
