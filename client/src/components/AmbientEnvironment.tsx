/**
 * AmbientEnvironment.tsx — 動態環境系統
 *
 * 依據當地電腦時間切換 4 種情境背景：
 *   夜空 (22:00–05:00) — 深藍漸層 + 星星閃爍 + 流星尾跡
 *   晨光 (05:00–11:00) — 暖橙漸層 + 光塵飄浮 + 柔和光暈
 *   咖啡廳 (11:00–17:00) — 暖棕漸層 + 蒸氣上升 + 散景光點
 *   深海 (17:00–22:00) — 深青漸層 + 氣泡上浮 + 水波紋光影
 *
 * 使用原生 Canvas 2D + requestAnimationFrame，零外部依賴。
 * 情境切換時漸層色與粒子行為同步平滑過渡。
 * 離屏自動暫停，粒子數量依視窗大小自適應。
 */

import { useRef, useEffect, useCallback, useState, memo } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

type SceneId = "nightSky" | "morning" | "cafe" | "deepSea";

interface SceneConfig {
  id: SceneId;
  label: string;
  gradientStops: Array<{ offset: number; color: string }>;
  particleCount: number;
  /** Each scene has a unique particle behavior factory */
  createParticle: (w: number, h: number) => Particle;
  updateParticle: (p: Particle, w: number, h: number, t: number) => void;
  drawParticle: (ctx: CanvasRenderingContext2D, p: Particle, t: number) => void;
  /** Optional overlay effects (bokeh, ripples, etc.) */
  drawOverlay?: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  life: number;
  maxLife: number;
  /** Scene-specific extra data */
  extra: Record<string, number>;
}

// ─── Utility ────────────────────────────────────────────────────────────────

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpColor(c1: number[], c2: number[], t: number): number[] {
  return c1.map((v, i) => Math.round(lerp(v, c2[i], t)));
}

function parseRgba(str: string): number[] {
  const m = str.match(/[\d.]+/g);
  return m ? m.map(Number) : [0, 0, 0, 1];
}

function toRgba(arr: number[]): string {
  return `rgba(${arr[0]},${arr[1]},${arr[2]},${arr[3] ?? 1})`;
}

// ─── Scene: Night Sky ───────────────────────────────────────────────────────

const nightSky: SceneConfig = {
  id: "nightSky",
  label: "夜空",
  gradientStops: [
    { offset: 0, color: "rgba(8,12,35,1)" },
    { offset: 0.4, color: "rgba(15,22,60,1)" },
    { offset: 0.7, color: "rgba(25,18,55,1)" },
    { offset: 1, color: "rgba(10,8,30,1)" },
  ],
  particleCount: 120,
  createParticle(w, h) {
    const isMeteor = Math.random() < 0.03;
    return {
      x: rand(0, w),
      y: rand(0, h),
      vx: isMeteor ? rand(-3, -1.5) : 0,
      vy: isMeteor ? rand(1.5, 3) : 0,
      size: isMeteor ? rand(1.5, 2.5) : rand(0.5, 2),
      opacity: rand(0.2, 0.9),
      life: 0,
      maxLife: isMeteor ? rand(40, 80) : Infinity,
      extra: {
        isMeteor: isMeteor ? 1 : 0,
        twinkleSpeed: rand(0.01, 0.04),
        twinkleOffset: rand(0, Math.PI * 2),
        tailLength: isMeteor ? rand(30, 60) : 0,
      },
    };
  },
  updateParticle(p, w, h, t) {
    if (p.extra.isMeteor) {
      p.x += p.vx;
      p.y += p.vy;
      p.life++;
      if (p.life > p.maxLife || p.x < -50 || p.y > h + 50) {
        p.x = rand(w * 0.3, w * 1.2);
        p.y = rand(-50, h * 0.3);
        p.life = 0;
        p.maxLife = rand(40, 80);
      }
    }
  },
  drawParticle(ctx, p, t) {
    if (p.extra.isMeteor) {
      const progress = p.life / p.maxLife;
      const fadeOut = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1;
      const grad = ctx.createLinearGradient(
        p.x, p.y,
        p.x - p.vx * p.extra.tailLength * 0.5,
        p.y - p.vy * p.extra.tailLength * 0.5
      );
      grad.addColorStop(0, `rgba(255,255,255,${0.9 * fadeOut})`);
      grad.addColorStop(0.3, `rgba(200,210,255,${0.5 * fadeOut})`);
      grad.addColorStop(1, `rgba(150,170,255,0)`);
      ctx.beginPath();
      ctx.strokeStyle = grad;
      ctx.lineWidth = p.size;
      ctx.lineCap = "round";
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(
        p.x - p.vx * p.extra.tailLength * 0.5,
        p.y - p.vy * p.extra.tailLength * 0.5
      );
      ctx.stroke();
    } else {
      const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(t * p.extra.twinkleSpeed + p.extra.twinkleOffset));
      const alpha = p.opacity * twinkle;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220,225,255,${alpha})`;
      ctx.fill();
      // Soft glow
      if (p.size > 1.2) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3);
        glow.addColorStop(0, `rgba(200,210,255,${alpha * 0.3})`);
        glow.addColorStop(1, `rgba(200,210,255,0)`);
        ctx.fillStyle = glow;
        ctx.fill();
      }
    }
  },
  drawOverlay(ctx, w, h, t) {
    // Subtle nebula glow
    const cx = w * 0.6 + Math.sin(t * 0.0003) * 80;
    const cy = h * 0.35 + Math.cos(t * 0.0004) * 40;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.35);
    grad.addColorStop(0, "rgba(80,50,120,0.06)");
    grad.addColorStop(0.5, "rgba(40,30,80,0.03)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  },
};

// ─── Scene: Morning Light ───────────────────────────────────────────────────

const morning: SceneConfig = {
  id: "morning",
  label: "晨光",
  gradientStops: [
    { offset: 0, color: "rgba(255,218,185,1)" },
    { offset: 0.3, color: "rgba(255,200,160,0.9)" },
    { offset: 0.6, color: "rgba(245,225,210,0.8)" },
    { offset: 1, color: "rgba(240,235,225,1)" },
  ],
  particleCount: 60,
  createParticle(w, h) {
    return {
      x: rand(0, w),
      y: rand(0, h),
      vx: rand(-0.15, 0.15),
      vy: rand(-0.3, -0.05),
      size: rand(1, 4),
      opacity: rand(0.15, 0.5),
      life: 0,
      maxLife: Infinity,
      extra: {
        driftPhase: rand(0, Math.PI * 2),
        driftAmp: rand(0.3, 1.2),
        glowSize: rand(6, 14),
      },
    };
  },
  updateParticle(p, w, h, t) {
    p.x += p.vx + Math.sin(t * 0.001 + p.extra.driftPhase) * p.extra.driftAmp * 0.02;
    p.y += p.vy;
    if (p.y < -20) { p.y = h + 10; p.x = rand(0, w); }
    if (p.x < -20) p.x = w + 10;
    if (p.x > w + 20) p.x = -10;
  },
  drawParticle(ctx, p, t) {
    const pulse = 0.6 + 0.4 * Math.sin(t * 0.002 + p.extra.driftPhase);
    const alpha = p.opacity * pulse;
    // Warm dust mote
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,210,170,${alpha})`;
    ctx.fill();
    // Soft halo
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.extra.glowSize);
    grad.addColorStop(0, `rgba(255,200,150,${alpha * 0.25})`);
    grad.addColorStop(1, "rgba(255,200,150,0)");
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.extra.glowSize, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  },
  drawOverlay(ctx, w, h, t) {
    // Sun ray beams from top-right
    const sunX = w * 0.85 + Math.sin(t * 0.0002) * 30;
    const sunY = h * 0.05;
    const grad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, w * 0.7);
    grad.addColorStop(0, "rgba(255,200,120,0.12)");
    grad.addColorStop(0.3, "rgba(255,180,100,0.06)");
    grad.addColorStop(1, "rgba(255,180,100,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  },
};

// ─── Scene: Café ────────────────────────────────────────────────────────────

const cafe: SceneConfig = {
  id: "cafe",
  label: "咖啡廳",
  gradientStops: [
    { offset: 0, color: "rgba(235,220,200,1)" },
    { offset: 0.35, color: "rgba(220,200,175,0.95)" },
    { offset: 0.65, color: "rgba(210,190,165,0.9)" },
    { offset: 1, color: "rgba(195,175,150,1)" },
  ],
  particleCount: 50,
  createParticle(w, h) {
    const isSteam = Math.random() < 0.5;
    return {
      x: rand(0, w),
      y: isSteam ? rand(h * 0.5, h) : rand(0, h),
      vx: rand(-0.1, 0.1),
      vy: isSteam ? rand(-0.6, -0.2) : 0,
      size: isSteam ? rand(2, 5) : rand(3, 10),
      opacity: isSteam ? rand(0.05, 0.15) : rand(0.08, 0.25),
      life: 0,
      maxLife: isSteam ? rand(200, 400) : Infinity,
      extra: {
        isSteam: isSteam ? 1 : 0,
        wobble: rand(0, Math.PI * 2),
        wobbleAmp: rand(0.5, 2),
        bokehHue: rand(25, 50), // warm tones
      },
    };
  },
  updateParticle(p, w, h, t) {
    if (p.extra.isSteam) {
      p.x += Math.sin(t * 0.002 + p.extra.wobble) * p.extra.wobbleAmp * 0.05;
      p.y += p.vy;
      p.life++;
      p.opacity *= 0.998;
      if (p.life > p.maxLife || p.y < -20 || p.opacity < 0.01) {
        p.x = rand(0, w);
        p.y = rand(h * 0.5, h);
        p.opacity = rand(0.05, 0.15);
        p.life = 0;
      }
    }
  },
  drawParticle(ctx, p, t) {
    if (p.extra.isSteam) {
      // Wispy steam
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,250,240,${p.opacity})`;
      ctx.fill();
    } else {
      // Bokeh light circle
      const pulse = 0.6 + 0.4 * Math.sin(t * 0.0015 + p.extra.wobble);
      const alpha = p.opacity * pulse;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      grad.addColorStop(0, `rgba(255,230,180,${alpha * 0.6})`);
      grad.addColorStop(0.6, `rgba(255,220,160,${alpha * 0.2})`);
      grad.addColorStop(1, `rgba(255,210,140,0)`);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }
  },
};

// ─── Scene: Deep Sea ────────────────────────────────────────────────────────

const deepSea: SceneConfig = {
  id: "deepSea",
  label: "深海",
  gradientStops: [
    { offset: 0, color: "rgba(5,25,50,1)" },
    { offset: 0.3, color: "rgba(8,35,65,1)" },
    { offset: 0.6, color: "rgba(10,45,75,0.95)" },
    { offset: 1, color: "rgba(5,20,40,1)" },
  ],
  particleCount: 80,
  createParticle(w, h) {
    return {
      x: rand(0, w),
      y: rand(0, h),
      vx: rand(-0.1, 0.1),
      vy: rand(-0.8, -0.15),
      size: rand(1, 5),
      opacity: rand(0.15, 0.55),
      life: 0,
      maxLife: Infinity,
      extra: {
        wobblePhase: rand(0, Math.PI * 2),
        wobbleAmp: rand(0.5, 2.5),
        shimmer: rand(0.01, 0.03),
      },
    };
  },
  updateParticle(p, w, h, t) {
    p.x += p.vx + Math.sin(t * 0.001 + p.extra.wobblePhase) * p.extra.wobbleAmp * 0.03;
    p.y += p.vy;
    if (p.y < -20) {
      p.y = h + rand(10, 40);
      p.x = rand(0, w);
      p.size = rand(1, 5);
    }
  },
  drawParticle(ctx, p, t) {
    const shimmer = 0.5 + 0.5 * Math.sin(t * p.extra.shimmer + p.extra.wobblePhase);
    const alpha = p.opacity * shimmer;
    // Bubble body
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(120,200,230,${alpha * 0.3})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(150,220,240,${alpha * 0.5})`;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    // Inner highlight
    ctx.beginPath();
    ctx.arc(p.x - p.size * 0.25, p.y - p.size * 0.25, p.size * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200,240,255,${alpha * 0.5})`;
    ctx.fill();
  },
  drawOverlay(ctx, w, h, t) {
    // Caustic light ripples
    const numRipples = 3;
    for (let i = 0; i < numRipples; i++) {
      const cx = w * (0.3 + i * 0.25) + Math.sin(t * 0.0003 + i * 2) * 60;
      const cy = h * 0.2 + Math.cos(t * 0.0004 + i * 1.5) * 30;
      const radius = 80 + Math.sin(t * 0.001 + i) * 30;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, `rgba(80,180,220,0.04)`);
      grad.addColorStop(0.5, `rgba(60,160,200,0.02)`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  },
};

// ─── Scene Map ──────────────────────────────────────────────────────────────

const SCENES: Record<SceneId, SceneConfig> = { nightSky, morning, cafe, deepSea };

function getSceneForHour(hour: number): SceneId {
  if (hour >= 22 || hour < 5) return "nightSky";
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "cafe";
  return "deepSea";
}

// ─── Component ──────────────────────────────────────────────────────────────

interface AmbientEnvironmentProps {
  /** Override scene for preview/testing */
  forceScene?: SceneId;
  className?: string;
}

function AmbientEnvironmentInner({ forceScene, className }: AmbientEnvironmentProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const prevSceneRef = useRef<SceneId | null>(null);
  const transitionRef = useRef<{ from: SceneId; to: SceneId; progress: number } | null>(null);
  const [currentScene, setCurrentScene] = useState<SceneId>(
    forceScene ?? getSceneForHour(new Date().getHours())
  );

  // Check time every 30 seconds
  useEffect(() => {
    if (forceScene) return;
    const interval = setInterval(() => {
      const newScene = getSceneForHour(new Date().getHours());
      setCurrentScene((prev) => {
        if (prev !== newScene) return newScene;
        return prev;
      });
    }, 30_000);
    return () => clearInterval(interval);
  }, [forceScene]);

  // Handle scene transitions
  useEffect(() => {
    if (prevSceneRef.current && prevSceneRef.current !== currentScene) {
      transitionRef.current = {
        from: prevSceneRef.current,
        to: currentScene,
        progress: 0,
      };
    }
    prevSceneRef.current = currentScene;
  }, [currentScene]);

  // Reinitialize particles when scene changes
  const initParticles = useCallback(
    (w: number, h: number, sceneId: SceneId) => {
      const scene = SCENES[sceneId];
      const scaleFactor = Math.max(0.5, Math.min(1.5, (w * h) / (1920 * 1080)));
      const count = Math.round(scene.particleCount * scaleFactor);
      particlesRef.current = Array.from({ length: count }, () =>
        scene.createParticle(w, h)
      );
    },
    []
  );

  // Main animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let w = 0;
    let h = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas!.clientWidth;
      h = canvas!.clientHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      initParticles(w, h, currentScene);
    }

    resize();
    window.addEventListener("resize", resize);

    // Visibility-based pause
    let paused = false;
    function onVisibility() {
      paused = document.hidden;
    }
    document.addEventListener("visibilitychange", onVisibility);

    let frame = 0;

    function drawGradient(
      stops: Array<{ offset: number; color: string }>,
      alpha: number = 1
    ) {
      const grad = ctx!.createLinearGradient(0, 0, w * 0.5, h);
      for (const s of stops) {
        if (alpha < 1) {
          const rgba = parseRgba(s.color);
          rgba[3] = (rgba[3] ?? 1) * alpha;
          grad.addColorStop(s.offset, toRgba(rgba));
        } else {
          grad.addColorStop(s.offset, s.color);
        }
      }
      ctx!.fillStyle = grad;
      ctx!.fillRect(0, 0, w, h);
    }

    function animate() {
      if (paused) {
        animRef.current = requestAnimationFrame(animate);
        return;
      }

      frame++;
      const t = performance.now();
      const scene = SCENES[currentScene];
      const trans = transitionRef.current;

      // ── Background gradient ──
      if (trans && trans.progress < 1) {
        // Cross-fade between scenes
        const fromScene = SCENES[trans.from];
        const toScene = SCENES[trans.to];
        trans.progress = Math.min(1, trans.progress + 0.008); // ~2s transition

        drawGradient(fromScene.gradientStops, 1 - trans.progress);
        ctx!.globalCompositeOperation = "source-over";
        drawGradient(toScene.gradientStops, trans.progress);

        if (trans.progress >= 1) {
          transitionRef.current = null;
          initParticles(w, h, currentScene);
        }
      } else {
        drawGradient(scene.gradientStops);
      }

      // ── Particles ──
      for (const p of particlesRef.current) {
        scene.updateParticle(p, w, h, t);
        scene.drawParticle(ctx!, p, t);
      }

      // ── Overlay effects ──
      if (scene.drawOverlay) {
        scene.drawOverlay(ctx!, w, h, t);
      }

      animRef.current = requestAnimationFrame(animate);
    }

    animRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [currentScene, initParticles]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full ${className ?? ""}`}
      style={{ zIndex: 0 }}
      aria-hidden="true"
    />
  );
}

export const AmbientEnvironment = memo(AmbientEnvironmentInner);

/**
 * Hook: useCurrentScene
 * Returns the current scene ID and label for UI display (e.g., scene indicator badge).
 */
export function useCurrentScene(forceScene?: SceneId) {
  const [scene, setScene] = useState<SceneId>(
    forceScene ?? getSceneForHour(new Date().getHours())
  );

  useEffect(() => {
    if (forceScene) return;
    const interval = setInterval(() => {
      setScene(getSceneForHour(new Date().getHours()));
    }, 30_000);
    return () => clearInterval(interval);
  }, [forceScene]);

  return {
    sceneId: scene,
    label: SCENES[scene].label,
    isDark: scene === "nightSky" || scene === "deepSea",
  };
}

export type { SceneId };
export default AmbientEnvironment;
