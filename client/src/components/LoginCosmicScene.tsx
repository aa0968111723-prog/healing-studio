/**
 * LoginCosmicScene.tsx — 登入畫面動態場景背景
 *
 * 依使用者於「設定 › 背景場景」選擇的四個場景同步切換：
 *   • 夜空 (nightSky) — 深紫宇宙 + 行星 + 銀河 + 流星
 *   • 晨光 (morning)   — 暖橙日出 + 日光眩光 + 漂浮光塵 + 雲帶
 *   • 咖啡廳 (cafe)    — 暖琥珀燈光 + 蒸氣 + 散景光點
 *   • 深海 (deepSea)   — 深青海域 + 水面光柱 + 上升氣泡 + 水波光紋
 *
 * 全部使用純 CSS @keyframes + transform，無 SVG filter / blur()，
 * pointer-events:none，永不擋住前景表單。
 */

import { memo, useEffect, useRef, useState } from "react";
import type { SceneId } from "./AmbientEnvironment";

// ─── Static keyframes（共用全部場景） ────────────────────────────────────────

const KEYFRAMES = [
  // Star / dust twinkle per layer
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
  // Slow planet rotation (background drift)
  "@keyframes lcs-planet-spin{0%{background-position:0% 50%,30% 25%,70% 75%,35% 30%}100%{background-position:200% 50%,30% 25%,70% 75%,35% 30%}}",
  // Planet gentle bob
  "@keyframes lcs-planet-bob{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-10px,0)}}",
  // Moon orbit drift
  "@keyframes lcs-moon-orbit{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(8px,-6px,0)}}",
  // Atmospheric rim pulse
  "@keyframes lcs-rim{0%,100%{opacity:.55}50%{opacity:.85}}",
  // Looped meteor sweep
  "@keyframes lcs-meteor{" +
    "0%{transform:translate3d(0,0,0) scaleX(.3);opacity:0}" +
    "1.5%{opacity:.85}" +
    "5%{transform:translate3d(-160px,128px,0) scaleX(.85);opacity:.85}" +
    "10%{transform:translate3d(-280px,220px,0) scaleX(1);opacity:0}" +
    "100%{transform:translate3d(-280px,220px,0) scaleX(1);opacity:0}}",
  // Vignette breath
  "@keyframes lcs-vignette{0%,100%{opacity:.55}50%{opacity:.7}}",
  // Soft cosmic dust drift (rotation)
  "@keyframes lcs-dust{0%{transform:translate3d(-50%,-50%,0) rotate(0deg)}100%{transform:translate3d(-50%,-50%,0) rotate(360deg)}}",
  // Milky Way slow breath (brightness only)
  "@keyframes lcs-milky{0%,100%{opacity:.55}50%{opacity:.78}}",
  // Constellation line shimmer
  "@keyframes lcs-constellation{0%,100%{opacity:.18}50%{opacity:.42}}",
  // Sun pulse
  "@keyframes lcs-sun{0%,100%{opacity:.6;transform:translate3d(-50%,-50%,0) scale(1)}50%{opacity:.85;transform:translate3d(-50%,-50%,0) scale(1.04)}}",
  // Bigger rising sun pulse (morning hero)
  "@keyframes lcs-bigsun{0%,100%{opacity:.85;transform:translate3d(-50%,-50%,0) scale(1)}50%{opacity:1;transform:translate3d(-50%,-50%,0) scale(1.05)}}",
  // Lens flare drift
  "@keyframes lcs-flare{0%,100%{opacity:.35}50%{opacity:.6}}",
  // Cloud band drift
  "@keyframes lcs-clouds{0%{background-position:0% 50%}100%{background-position:-200% 50%}}",
  // Foreground dust mote — slow drift across the screen
  "@keyframes lcs-mote{0%{transform:translate3d(0,0,0);opacity:0}10%{opacity:.65}90%{opacity:.55}100%{transform:translate3d(60px,-40px,0);opacity:0}}",
  // Card title shimmer (background-position sweep)
  "@keyframes lcs-title-shimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}",
  // Corner glyph twinkle
  "@keyframes lcs-glyph{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:.95;transform:scale(1.15)}}",
  // Sun ray shimmer (rotation)
  "@keyframes lcs-rays{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}",
  // Bubble rise (deep sea)
  "@keyframes lcs-bubble{0%{transform:translate3d(0,0,0) scale(.85);opacity:0}10%{opacity:.7}80%{opacity:.7}100%{transform:translate3d(-12px,-360px,0) scale(1.1);opacity:0}}",
  // Caustic ripple drift (deep sea)
  "@keyframes lcs-caustic{0%,100%{opacity:.45;transform:translate3d(-50%,-50%,0) scale(1)}50%{opacity:.7;transform:translate3d(-50%,-50%,0) scale(1.06)}}",
  // Light shaft sway (deep sea)
  "@keyframes lcs-shaft{0%,100%{opacity:.32;transform:translate3d(0,0,0) skewX(-12deg)}50%{opacity:.55;transform:translate3d(8px,0,0) skewX(-15deg)}}",
  // Steam plume rise (cafe)
  "@keyframes lcs-steam{0%{transform:translate3d(0,0,0) scale(.8);opacity:0}15%{opacity:.55}70%{opacity:.4}100%{transform:translate3d(20px,-280px,0) scale(1.3);opacity:0}}",
  // Bokeh breath (cafe)
  "@keyframes lcs-bokeh{0%,100%{opacity:.5;transform:translate3d(0,0,0) scale(1)}50%{opacity:.85;transform:translate3d(0,-4px,0) scale(1.08)}}",
  // Window light pulse (cafe)
  "@keyframes lcs-window{0%,100%{opacity:.7}50%{opacity:.92}}",
  // Floating leaf / wisp (cafe + morning)
  "@keyframes lcs-wisp{0%{transform:translate3d(0,0,0) rotate(0deg);opacity:0}10%{opacity:.5}90%{opacity:.4}100%{transform:translate3d(140px,-90px,0) rotate(40deg);opacity:0}}",
].join("");

// ─── Scene palette tables (single source of truth per scene) ────────────────

interface ScenePalette {
  // Body background — full-screen gradient
  body: string[];
  // Corner color accent overlays
  accents: string[];
  // Vignette tint at edges
  vignette: string;
  // Star tint functions
  starTints: ((o: number) => string)[];
  // Frame color CSS vars (overrides --login-frame-hue-*)
  frameA: string;
  frameB: string;
  frameC: string;
}

const SCENE_PALETTES: Record<SceneId, ScenePalette> = {
  nightSky: {
    body: [
      "radial-gradient(ellipse at 50% 42%, rgba(36,22,68,0.92) 0%, rgba(14,8,30,0.98) 55%, rgba(4,2,14,1) 100%)",
      "linear-gradient(180deg, #0b0820 0%, #110a2a 100%)",
    ],
    accents: [
      "radial-gradient(ellipse at 18% 22%, rgba(80,60,160,0.32) 0%, transparent 55%)",
      "radial-gradient(ellipse at 82% 76%, rgba(40,90,170,0.26) 0%, transparent 58%)",
      "radial-gradient(ellipse at 50% 88%, rgba(180,90,160,0.14) 0%, transparent 55%)",
    ],
    vignette:
      "radial-gradient(ellipse at 50% 50%, transparent 30%, rgba(2,1,8,0.55) 100%)",
    starTints: [
      o => `rgba(220,232,255,${o.toFixed(2)})`,
      o => `rgba(255,248,235,${o.toFixed(2)})`,
      o => `rgba(255,232,200,${o.toFixed(2)})`,
    ],
    frameA: "rgba(200,170,255,0.55)",
    frameB: "rgba(120,200,255,0.45)",
    frameC: "rgba(255,200,230,0.4)",
  },
  morning: {
    body: [
      "radial-gradient(ellipse at 50% 80%, rgba(255,210,170,0.85) 0%, rgba(255,180,140,0.4) 30%, transparent 65%)",
      "linear-gradient(180deg, #2a1a48 0%, #5b2f5a 28%, #b76a6a 60%, #ffb98e 88%, #ffd8b0 100%)",
    ],
    accents: [
      "radial-gradient(ellipse at 78% 18%, rgba(255,230,180,0.55) 0%, transparent 50%)",
      "radial-gradient(ellipse at 16% 30%, rgba(180,90,160,0.25) 0%, transparent 55%)",
      "radial-gradient(ellipse at 50% 100%, rgba(255,180,120,0.32) 0%, transparent 58%)",
    ],
    vignette:
      "radial-gradient(ellipse at 50% 60%, transparent 32%, rgba(60,20,40,0.42) 100%)",
    starTints: [
      o => `rgba(255,235,210,${o.toFixed(2)})`,
      o => `rgba(255,220,180,${o.toFixed(2)})`,
      o => `rgba(255,200,160,${o.toFixed(2)})`,
    ],
    frameA: "rgba(255,210,170,0.6)",
    frameB: "rgba(255,180,140,0.5)",
    frameC: "rgba(255,230,200,0.55)",
  },
  cafe: {
    body: [
      "radial-gradient(ellipse at 30% 28%, rgba(120,80,55,0.55) 0%, transparent 60%)",
      "radial-gradient(ellipse at 70% 72%, rgba(80,45,30,0.55) 0%, transparent 60%)",
      "linear-gradient(180deg, #2a1a14 0%, #3a2418 50%, #1f120c 100%)",
    ],
    accents: [
      "radial-gradient(ellipse at 18% 22%, rgba(255,190,120,0.30) 0%, transparent 55%)",
      "radial-gradient(ellipse at 84% 30%, rgba(220,150,90,0.22) 0%, transparent 55%)",
      "radial-gradient(ellipse at 50% 92%, rgba(180,100,60,0.18) 0%, transparent 58%)",
    ],
    vignette:
      "radial-gradient(ellipse at 50% 50%, transparent 32%, rgba(12,6,4,0.62) 100%)",
    starTints: [
      o => `rgba(255,225,180,${o.toFixed(2)})`,
      o => `rgba(255,210,150,${o.toFixed(2)})`,
      o => `rgba(255,190,120,${o.toFixed(2)})`,
    ],
    frameA: "rgba(255,200,140,0.55)",
    frameB: "rgba(220,150,90,0.5)",
    frameC: "rgba(255,225,180,0.55)",
  },
  deepSea: {
    body: [
      "radial-gradient(ellipse at 50% 12%, rgba(120,200,230,0.45) 0%, rgba(40,120,170,0.25) 30%, transparent 60%)",
      "linear-gradient(180deg, #0a3a5a 0%, #0a2848 30%, #051428 75%, #020a16 100%)",
    ],
    accents: [
      "radial-gradient(ellipse at 18% 28%, rgba(60,160,210,0.32) 0%, transparent 55%)",
      "radial-gradient(ellipse at 82% 72%, rgba(30,90,150,0.30) 0%, transparent 58%)",
      "radial-gradient(ellipse at 50% 100%, rgba(20,60,100,0.32) 0%, transparent 55%)",
    ],
    vignette:
      "radial-gradient(ellipse at 50% 50%, transparent 28%, rgba(2,6,14,0.62) 100%)",
    starTints: [
      o => `rgba(180,230,255,${o.toFixed(2)})`,
      o => `rgba(140,210,240,${o.toFixed(2)})`,
      o => `rgba(200,240,255,${o.toFixed(2)})`,
    ],
    frameA: "rgba(120,200,230,0.55)",
    frameB: "rgba(60,160,210,0.5)",
    frameC: "rgba(180,230,255,0.55)",
  },
};

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
  opacity: number;
}

const STAR_LAYERS = [
  { count: 56, sizeMin: 0.7, sizeMax: 1.4, opMin: 0.1, opMax: 0.32 },
  { count: 28, sizeMin: 1.4, sizeMax: 2.6, opMin: 0.2, opMax: 0.55 },
  { count: 10, sizeMin: 2.6, sizeMax: 4.4, opMin: 0.35, opMax: 0.85 },
] as const;

const STARS: StarData[] = (() => {
  const out: StarData[] = [];
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
      out.push({
        x,
        y,
        size,
        layer: li as 0 | 1 | 2,
        twinkleDur: 3 + (seed % 6),
        driftDur: (li === 0 ? 7 : li === 1 ? 9 : 13) + (seed % 4),
        twinkleDelay: (i % 9) * 0.32,
        driftDelay: (i % 7) * 0.4,
        opacity,
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

// ─── Constellation anchors (nightSky only) ──────────────────────────────────

interface Anchor {
  x: number;
  y: number;
  size: number;
  delay: number;
}

const CONSTELLATION_ANCHORS: Anchor[] = [
  { x: 12, y: 18, size: 3.6, delay: 0.0 },
  { x: 24, y: 11, size: 4.2, delay: 0.5 },
  { x: 35, y: 22, size: 3.4, delay: 1.0 },
  { x: 48, y: 14, size: 4.0, delay: 1.5 },
  { x: 60, y: 26, size: 3.6, delay: 2.0 },
  { x: 74, y: 18, size: 4.4, delay: 2.5 },
  { x: 88, y: 32, size: 3.8, delay: 3.0 },
  { x: 8, y: 78, size: 3.2, delay: 3.5 },
  { x: 22, y: 84, size: 3.8, delay: 4.0 },
  { x: 14, y: 92, size: 3.0, delay: 4.5 },
];

const CONSTELLATION_LINES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6],
  [7, 8], [8, 9], [7, 9],
];

// ─── Bubble configuration (deepSea) ─────────────────────────────────────────

const BUBBLES = [
  { x: 14, size: 6, dur: 14, delay: 0 },
  { x: 22, size: 4, dur: 12, delay: 3 },
  { x: 30, size: 8, dur: 16, delay: 1.5 },
  { x: 42, size: 5, dur: 13, delay: 6 },
  { x: 54, size: 7, dur: 15, delay: 2.5 },
  { x: 64, size: 4, dur: 11, delay: 8 },
  { x: 76, size: 6, dur: 14, delay: 4 },
  { x: 84, size: 9, dur: 18, delay: 7 },
  { x: 90, size: 5, dur: 13, delay: 10 },
];

// ─── Steam wisp configuration (cafe) ────────────────────────────────────────

const STEAM_WISPS = [
  { x: 18, size: 30, dur: 18, delay: 0 },
  { x: 32, size: 22, dur: 16, delay: 5 },
  { x: 64, size: 28, dur: 20, delay: 2 },
  { x: 78, size: 24, dur: 17, delay: 9 },
];

// ─── Subcomponents (shared) ─────────────────────────────────────────────────

const StarField = memo(function StarField({
  palette,
}: {
  palette: ScenePalette;
}) {
  return (
    <>
      {STARS.map((s, i) => {
        const tint = palette.starTints[s.layer](s.opacity);
        const bg =
          s.layer === 2
            ? `radial-gradient(circle, ${tint} 0%, transparent 70%)`
            : tint;
        const shadow =
          s.layer >= 1
            ? `0 0 ${(s.size * 2.6).toFixed(1)}px ${palette.starTints[s.layer](
                s.opacity * 0.55
              )}`
            : "none";
        return (
          <div
            key={i}
            className="absolute rounded-full pointer-events-none"
            style={{
              width: s.size,
              height: s.size,
              left: `${s.x}%`,
              top: `${s.y}%`,
              background: bg,
              boxShadow: shadow,
              animation:
                `lcs-tw${s.layer} ${s.twinkleDur}s ease-in-out ${s.twinkleDelay}s infinite,` +
                `lcs-dr${s.layer} ${s.driftDur}s ease-in-out ${s.driftDelay}s infinite`,
            }}
          />
        );
      })}
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
            animation: `lcs-meteor ${m.loopDur}s ease-out ${m.delay}s infinite`,
            opacity: 0,
            willChange: "transform, opacity",
          }}
        />
      ))}
    </>
  );
});

// ─── Foreground dust motes (shared, color tinted per scene) ─────────────────

const FG_MOTES = [
  { x: 12, y: 28, size: 3, dur: 22, delay: 0 },
  { x: 78, y: 14, size: 2.4, dur: 26, delay: 4 },
  { x: 38, y: 72, size: 3.4, dur: 24, delay: 8 },
  { x: 86, y: 60, size: 2.6, dur: 28, delay: 2 },
  { x: 22, y: 48, size: 3, dur: 30, delay: 12 },
  { x: 58, y: 86, size: 2.8, dur: 25, delay: 16 },
];

const ForegroundMotes = memo(function ForegroundMotes({
  tint,
}: {
  tint: string;
}) {
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
            background: `radial-gradient(circle, ${tint} 0%, transparent 100%)`,
            boxShadow: `0 0 8px ${tint}`,
            animation: `lcs-mote ${m.dur}s ease-in-out ${m.delay}s infinite`,
            willChange: "transform, opacity",
            opacity: 0,
          }}
        />
      ))}
    </>
  );
});

// ─── nightSky: Milky Way + Constellations + Planet + Moon + Sun flare ───────

const MilkyWay = memo(function MilkyWay() {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: "-20%",
        top: "-10%",
        width: "140%",
        height: "120%",
        transform: "rotate(-22deg)",
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
        animation: "lcs-milky 14s ease-in-out infinite",
      }}
    />
  );
});

const Constellations = memo(function Constellations() {
  return (
    <>
      <svg
        className="absolute inset-0 pointer-events-none"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style={{ opacity: 0.7, mixBlendMode: "screen" }}
        aria-hidden
      >
        <defs>
          <linearGradient id="lcs-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(180,160,240,0.0)" />
            <stop offset="50%" stopColor="rgba(220,200,255,0.55)" />
            <stop offset="100%" stopColor="rgba(180,160,240,0.0)" />
          </linearGradient>
        </defs>
        {CONSTELLATION_LINES.map(([a, b], i) => {
          const A = CONSTELLATION_ANCHORS[a];
          const B = CONSTELLATION_ANCHORS[b];
          return (
            <line
              key={i}
              x1={A.x}
              y1={A.y}
              x2={B.x}
              y2={B.y}
              stroke="url(#lcs-line)"
              strokeWidth={0.18}
              vectorEffect="non-scaling-stroke"
              style={{
                animation: `lcs-constellation ${8 + (i % 4)}s ease-in-out ${i * 0.3}s infinite`,
              }}
            />
          );
        })}
      </svg>
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

const SunWithLensFlare = memo(function SunWithLensFlare({
  parallax,
  scene,
}: {
  parallax: [number, number];
  scene: SceneId;
}) {
  const [px, py] = parallax;
  // Per-scene sun configuration
  const config = {
    nightSky: {
      x: 105,
      y: -8,
      coreColor:
        "radial-gradient(circle, rgba(255,235,200,0.9) 0%, rgba(255,200,150,0.4) 22%, rgba(255,160,120,0.16) 45%, transparent 70%)",
      flares: [
        { t: 0.18, size: 28, color: "rgba(255,210,160,0.45)" },
        { t: 0.34, size: 18, color: "rgba(180,200,255,0.32)" },
        { t: 0.52, size: 42, color: "rgba(255,180,180,0.22)" },
        { t: 0.7, size: 22, color: "rgba(160,220,255,0.28)" },
        { t: 0.86, size: 14, color: "rgba(255,235,210,0.4)" },
      ],
    },
    morning: {
      x: 78,
      y: 22,
      coreColor:
        "radial-gradient(circle, rgba(255,245,220,1) 0%, rgba(255,220,170,0.7) 18%, rgba(255,180,130,0.32) 40%, rgba(255,150,110,0.14) 60%, transparent 78%)",
      flares: [
        { t: 0.18, size: 36, color: "rgba(255,210,160,0.55)" },
        { t: 0.34, size: 22, color: "rgba(255,180,140,0.45)" },
        { t: 0.52, size: 48, color: "rgba(255,200,170,0.32)" },
        { t: 0.7, size: 26, color: "rgba(255,225,200,0.4)" },
        { t: 0.86, size: 16, color: "rgba(255,240,220,0.55)" },
      ],
    },
    cafe: {
      x: 86,
      y: 18,
      coreColor:
        "radial-gradient(circle, rgba(255,210,150,0.85) 0%, rgba(255,180,110,0.45) 22%, rgba(220,140,80,0.18) 45%, transparent 70%)",
      flares: [
        { t: 0.22, size: 30, color: "rgba(255,200,140,0.42)" },
        { t: 0.42, size: 20, color: "rgba(220,160,100,0.32)" },
        { t: 0.62, size: 38, color: "rgba(255,180,120,0.26)" },
        { t: 0.82, size: 16, color: "rgba(255,220,180,0.4)" },
      ],
    },
    deepSea: {
      x: 50,
      y: -20,
      coreColor:
        "radial-gradient(ellipse at 50% 100%, rgba(180,230,255,0.5) 0%, rgba(120,200,230,0.25) 30%, rgba(60,160,200,0.10) 55%, transparent 80%)",
      flares: [
        { t: 0.22, size: 28, color: "rgba(160,220,240,0.32)" },
        { t: 0.42, size: 18, color: "rgba(200,235,250,0.26)" },
        { t: 0.62, size: 36, color: "rgba(140,200,230,0.22)" },
      ],
    },
  }[scene];

  const SUN_X = config.x;
  const SUN_Y = config.y;
  const END_X = -10;
  const END_Y = 110;
  const isMorning = scene === "morning";
  const sunSize = isMorning ? 460 : 320;
  const sunAnim = isMorning ? "lcs-bigsun 9s ease-in-out infinite" : "lcs-sun 8s ease-in-out infinite";

  return (
    <>
      {/* Sun core glow */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          left: `${SUN_X}%`,
          top: `${SUN_Y}%`,
          width: sunSize,
          height: sunSize,
          marginLeft: -sunSize / 2,
          marginTop: -sunSize / 2,
          background: config.coreColor,
          mixBlendMode: "screen",
          animation: sunAnim,
          willChange: "transform, opacity",
        }}
      />
      {/* Lens flare chain along optical axis */}
      {config.flares.map((f, i) => {
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
        left: "50%",
        top: "52%",
        width: size,
        height: size,
        transform: `translate3d(calc(-50% + ${tx}px), calc(-50% + ${ty}px), 0)`,
        willChange: "transform",
      }}
    >
      <div
        className="absolute rounded-full"
        style={{
          inset: -size * 0.28,
          background:
            "radial-gradient(circle, rgba(160,140,230,0.18) 0%, rgba(120,90,200,0.10) 28%, rgba(80,60,160,0.04) 50%, transparent 70%)",
          animation: "lcs-rim 7s ease-in-out infinite",
        }}
      />
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
          }}
        />
      </div>
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
            "linear-gradient(180deg, rgba(255,235,210,0.06) 0%, rgba(160,120,200,0.06) 22%, rgba(120,90,180,0.0) 38%, rgba(180,140,220,0.05) 56%, rgba(110,80,170,0.0) 72%, rgba(200,160,240,0.06) 92%)",
            "radial-gradient(circle at 30% 25%, rgba(255,225,190,0.32) 0%, rgba(255,210,180,0.0) 32%)",
            "radial-gradient(circle at 72% 78%, rgba(20,10,38,0.78) 0%, rgba(34,18,60,0.45) 38%, rgba(70,40,120,0.0) 62%)",
            "radial-gradient(circle at 36% 32%, #8a6fc5 0%, #5b3f95 28%, #36256a 55%, #1a1138 88%)",
          ].join(","),
          backgroundSize: "300% 100%, auto, auto, auto",
          backgroundRepeat: "repeat-x, no-repeat, no-repeat, no-repeat",
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
      <div
        className="absolute rounded-full overflow-hidden pointer-events-none"
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
              "linear-gradient(180deg, transparent 22%, rgba(230,210,255,0.16) 32%, transparent 42%, rgba(200,180,255,0.12) 56%, transparent 66%, rgba(220,200,255,0.14) 78%, transparent 88%)",
            backgroundSize: "300% 100%",
            animation: "lcs-clouds 110s linear infinite",
            mixBlendMode: "screen",
            opacity: 0.7,
          }}
        />
      </div>
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

// ─── morning: Sun rays + cloud strata + horizon glow ────────────────────────

const SunRays = memo(function SunRays() {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: "78%",
        top: "22%",
        width: 1200,
        height: 1200,
        marginLeft: -600,
        marginTop: -600,
        background:
          "conic-gradient(from 0deg, transparent 0deg, rgba(255,235,200,0.16) 8deg, transparent 18deg, rgba(255,210,160,0.12) 32deg, transparent 44deg, rgba(255,235,200,0.18) 60deg, transparent 72deg, rgba(255,200,150,0.14) 96deg, transparent 110deg, rgba(255,235,200,0.16) 140deg, transparent 156deg, rgba(255,210,160,0.12) 196deg, transparent 212deg, rgba(255,235,200,0.18) 248deg, transparent 262deg, rgba(255,200,150,0.14) 296deg, transparent 312deg, rgba(255,235,200,0.16) 344deg, transparent 360deg)",
        mixBlendMode: "screen",
        opacity: 0.55,
        animation: "lcs-rays 220s linear infinite",
        willChange: "transform",
      }}
    />
  );
});

const HorizonClouds = memo(function HorizonClouds() {
  return (
    <>
      {/* Lower cloud strata — wide soft banding near the horizon */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: "-10%",
          right: "-10%",
          bottom: "-5%",
          height: "55%",
          background: [
            "linear-gradient(180deg, transparent 0%, rgba(255,210,180,0.12) 35%, rgba(255,180,150,0.20) 60%, rgba(220,140,140,0.18) 85%, transparent 100%)",
            "radial-gradient(ellipse at 30% 70%, rgba(255,220,200,0.18) 0%, transparent 55%)",
            "radial-gradient(ellipse at 75% 80%, rgba(255,200,170,0.16) 0%, transparent 55%)",
          ].join(","),
          backgroundBlendMode: "screen",
          mixBlendMode: "screen",
        }}
      />
      {/* Drifting cloud band */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: "-50%",
          right: "-50%",
          top: "44%",
          height: 110,
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,225,200,0.18) 18%, rgba(255,235,215,0.28) 36%, transparent 52%, rgba(255,220,190,0.16) 70%, transparent 88%, rgba(255,225,200,0.14) 100%)",
          backgroundSize: "300% 100%",
          opacity: 0.65,
          mixBlendMode: "screen",
          animation: "lcs-clouds 90s linear infinite",
          WebkitMaskImage:
            "linear-gradient(90deg, transparent 0%, #000 14%, #000 86%, transparent 100%)",
          maskImage:
            "linear-gradient(90deg, transparent 0%, #000 14%, #000 86%, transparent 100%)",
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          left: "-50%",
          right: "-50%",
          top: "62%",
          height: 80,
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,200,170,0.12) 22%, rgba(255,210,180,0.22) 42%, transparent 60%, rgba(255,190,160,0.14) 78%, transparent 100%)",
          backgroundSize: "300% 100%",
          opacity: 0.5,
          mixBlendMode: "screen",
          animation: "lcs-clouds 130s linear infinite reverse",
          WebkitMaskImage:
            "linear-gradient(90deg, transparent 0%, #000 14%, #000 86%, transparent 100%)",
          maskImage:
            "linear-gradient(90deg, transparent 0%, #000 14%, #000 86%, transparent 100%)",
        }}
      />
    </>
  );
});

// ─── cafe: Window light + warm bokeh + rising steam ─────────────────────────

const CafeWindow = memo(function CafeWindow() {
  return (
    <>
      {/* Soft window light wash from upper-left, like sunlight through a café window */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: "-15%",
          top: "-15%",
          width: "75%",
          height: "85%",
          background:
            "radial-gradient(ellipse at 22% 22%, rgba(255,210,150,0.30) 0%, rgba(255,180,110,0.16) 30%, transparent 60%)",
          mixBlendMode: "screen",
          opacity: 0.85,
          animation: "lcs-window 9s ease-in-out infinite",
        }}
      />
      {/* Window slatted light shaft — soft skew streak */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: "12%",
          top: "-10%",
          width: 220,
          height: "120%",
          background:
            "linear-gradient(180deg, rgba(255,220,170,0.0) 0%, rgba(255,220,170,0.18) 35%, rgba(255,200,150,0.14) 60%, transparent 100%)",
          transform: "skewX(-18deg)",
          transformOrigin: "top center",
          opacity: 0.55,
          mixBlendMode: "screen",
          filter: "none",
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          left: "30%",
          top: "-10%",
          width: 140,
          height: "120%",
          background:
            "linear-gradient(180deg, rgba(255,205,150,0.0) 0%, rgba(255,205,150,0.14) 40%, rgba(255,185,130,0.10) 70%, transparent 100%)",
          transform: "skewX(-18deg)",
          transformOrigin: "top center",
          opacity: 0.45,
          mixBlendMode: "screen",
        }}
      />
    </>
  );
});

const CAFE_BOKEH = [
  { x: 14, y: 32, size: 90, dur: 9, delay: 0, c: "rgba(255,200,140,0.32)" },
  { x: 28, y: 56, size: 60, dur: 8, delay: 2, c: "rgba(255,180,120,0.28)" },
  { x: 42, y: 24, size: 110, dur: 11, delay: 1, c: "rgba(255,210,160,0.30)" },
  { x: 58, y: 64, size: 70, dur: 10, delay: 3, c: "rgba(255,190,130,0.32)" },
  { x: 72, y: 38, size: 95, dur: 9, delay: 1.5, c: "rgba(255,200,150,0.28)" },
  { x: 88, y: 56, size: 80, dur: 12, delay: 4, c: "rgba(255,220,170,0.34)" },
  { x: 8, y: 70, size: 55, dur: 8, delay: 5, c: "rgba(255,200,140,0.28)" },
  { x: 64, y: 88, size: 75, dur: 11, delay: 6, c: "rgba(255,180,120,0.26)" },
];

const CafeBokeh = memo(function CafeBokeh() {
  return (
    <>
      {CAFE_BOKEH.map((b, i) => (
        <div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: `${b.x}%`,
            top: `${b.y}%`,
            width: b.size,
            height: b.size,
            marginLeft: -b.size / 2,
            marginTop: -b.size / 2,
            background: `radial-gradient(circle, ${b.c} 0%, ${b.c.replace(/0\.\d+\)/, "0)")} 70%)`,
            mixBlendMode: "screen",
            animation: `lcs-bokeh ${b.dur}s ease-in-out ${b.delay}s infinite`,
            willChange: "opacity, transform",
          }}
        />
      ))}
    </>
  );
});

const SteamPlumes = memo(function SteamPlumes() {
  return (
    <>
      {STEAM_WISPS.map((w, i) => (
        <div
          key={i}
          className="absolute pointer-events-none"
          style={{
            left: `${w.x}%`,
            bottom: "-5%",
            width: w.size,
            height: w.size * 4.5,
            marginLeft: -w.size / 2,
            background:
              "radial-gradient(ellipse at 50% 80%, rgba(255,250,240,0.18) 0%, rgba(255,240,220,0.10) 40%, transparent 78%)",
            filter: "none",
            mixBlendMode: "screen",
            animation: `lcs-steam ${w.dur}s ease-in-out ${w.delay}s infinite`,
            willChange: "transform, opacity",
            opacity: 0,
          }}
        />
      ))}
    </>
  );
});

// ─── deepSea: Light caustics + light shafts + rising bubbles ────────────────

const LightShafts = memo(function LightShafts() {
  // Three soft "god rays" descending from the surface
  const shafts = [
    { x: 26, w: 90, dur: 10, delay: 0 },
    { x: 50, w: 130, dur: 13, delay: 2 },
    { x: 72, w: 100, dur: 11, delay: 1 },
  ];
  return (
    <>
      {shafts.map((s, i) => (
        <div
          key={i}
          className="absolute pointer-events-none"
          style={{
            left: `${s.x}%`,
            top: "-10%",
            width: s.w,
            height: "110%",
            marginLeft: -s.w / 2,
            background:
              "linear-gradient(180deg, rgba(180,230,255,0.32) 0%, rgba(140,210,240,0.18) 25%, rgba(80,160,210,0.08) 60%, transparent 100%)",
            transform: "skewX(-12deg)",
            transformOrigin: "top center",
            opacity: 0.4,
            mixBlendMode: "screen",
            animation: `lcs-shaft ${s.dur}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}
    </>
  );
});

const Caustics = memo(function Caustics() {
  return (
    <>
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          left: "30%",
          top: "20%",
          width: 700,
          height: 700,
          marginLeft: -350,
          marginTop: -350,
          background:
            "radial-gradient(ellipse at 50% 50%, rgba(120,210,240,0.22) 0%, rgba(80,170,210,0.10) 40%, transparent 70%)",
          mixBlendMode: "screen",
          animation: "lcs-caustic 12s ease-in-out infinite",
          willChange: "transform, opacity",
        }}
      />
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          left: "70%",
          top: "30%",
          width: 600,
          height: 600,
          marginLeft: -300,
          marginTop: -300,
          background:
            "radial-gradient(ellipse at 50% 50%, rgba(160,230,250,0.18) 0%, rgba(80,170,210,0.08) 40%, transparent 65%)",
          mixBlendMode: "screen",
          animation: "lcs-caustic 16s ease-in-out 2s infinite",
          willChange: "transform, opacity",
        }}
      />
      {/* Slow rotating water-light pattern */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: "50%",
          top: "30%",
          width: 1400,
          height: 1400,
          marginLeft: -700,
          marginTop: -700,
          background:
            "conic-gradient(from 0deg, transparent 0deg, rgba(140,210,240,0.06) 70deg, transparent 140deg, rgba(180,230,250,0.05) 220deg, transparent 320deg)",
          mixBlendMode: "screen",
          animation: "lcs-dust 120s linear infinite",
          willChange: "transform",
        }}
      />
    </>
  );
});

const Bubbles = memo(function Bubbles() {
  return (
    <>
      {BUBBLES.map((b, i) => (
        <div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: `${b.x}%`,
            bottom: "-2%",
            width: b.size,
            height: b.size,
            background:
              "radial-gradient(circle at 35% 30%, rgba(220,245,255,0.92) 0%, rgba(160,220,240,0.42) 40%, rgba(80,170,210,0.16) 70%, transparent 100%)",
            border: "1px solid rgba(200,235,250,0.28)",
            boxShadow: "inset 0 0 6px rgba(200,235,250,0.2), 0 0 6px rgba(140,210,240,0.18)",
            animation: `lcs-bubble ${b.dur}s ease-in ${b.delay}s infinite`,
            willChange: "transform, opacity",
            opacity: 0,
          }}
        />
      ))}
    </>
  );
});

// ─── Main component ─────────────────────────────────────────────────────────

interface LoginCosmicSceneProps {
  /** Scene id to render. Defaults to nightSky. */
  sceneId?: SceneId;
}

export default function LoginCosmicScene({
  sceneId = "nightSky",
}: LoginCosmicSceneProps) {
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

  const palette = SCENE_PALETTES[sceneId];

  // Per-scene foreground mote tint — picks first star tint at high opacity
  const moteTint = palette.starTints[2](0.8);

  return (
    <div
      aria-hidden
      data-scene={sceneId}
      className="absolute inset-0 overflow-hidden pointer-events-none"
      style={{
        background: palette.body.join(","),
        backgroundBlendMode: "screen, normal",
        isolation: "isolate",
        // Expose frame hue CSS vars to the auth card border (consumed by CSS)
        ["--login-frame-hue-a" as string]: palette.frameA,
        ["--login-frame-hue-b" as string]: palette.frameB,
        ["--login-frame-hue-c" as string]: palette.frameC,
      }}
    >
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

      {/* Color accents (corner glows) */}
      <div
        className="absolute inset-0"
        style={{ background: palette.accents.join(",") }}
      />

      {/* Scene-specific atmospheric layers (deepest first) */}
      {sceneId === "nightSky" && (
        <>
          <MilkyWay />
          <Nebula scale={scale} />
        </>
      )}

      {sceneId === "morning" && (
        <>
          <HorizonClouds />
          <SunRays />
        </>
      )}

      {sceneId === "cafe" && (
        <>
          <CafeWindow />
          <CafeBokeh />
        </>
      )}

      {sceneId === "deepSea" && (
        <>
          <Caustics />
          <LightShafts />
        </>
      )}

      {/* Stars — visible on all scenes but tinted differently */}
      <StarField palette={palette} />

      {/* nightSky-only constellations + planet + moon */}
      {sceneId === "nightSky" && (
        <>
          <Constellations />
          <Moon parallax={parallax} scale={scale} />
          <Planet parallax={parallax} scale={scale} />
        </>
      )}

      {/* Sun + lens flare for every scene that has a sun in frame */}
      {(sceneId === "nightSky" ||
        sceneId === "morning" ||
        sceneId === "cafe") && (
        <SunWithLensFlare parallax={parallax} scene={sceneId} />
      )}

      {/* deepSea-only bubbles rising in foreground */}
      {sceneId === "deepSea" && (
        <>
          <SunWithLensFlare parallax={parallax} scene="deepSea" />
          <Bubbles />
        </>
      )}

      {/* Meteors — appear on nightSky only */}
      {sceneId === "nightSky" && <Meteors />}

      {/* Steam plumes — cafe only */}
      {sceneId === "cafe" && <SteamPlumes />}

      {/* Foreground motes — drift on every scene, tinted */}
      <ForegroundMotes tint={moteTint} />

      {/* Vignette — keeps focus on the auth card */}
      <div
        className="absolute inset-0"
        style={{
          background: palette.vignette,
          animation: "lcs-vignette 10s ease-in-out infinite",
        }}
      />
    </div>
  );
}
