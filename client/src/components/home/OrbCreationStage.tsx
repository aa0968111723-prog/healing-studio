import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import {
  ArrowRight,
  Sparkles,
  Image as ImageIcon,
  Video,
  Music,
  Mic,
  Clapperboard,
  Shield,
  Loader2,
  Wand2,
  Eye,
  Zap,
  Target,
  Palette,
  CircleCheck,
  Clock,
  Layers,
  Terminal,
  CheckCircle2,
} from "lucide-react";
import { useIsMobile } from "@/hooks/useMobile";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";

// ─── Modality definitions ───────────────────────────────────────────────────

type ModeId = "image" | "video" | "music" | "voice" | "director" | "lora";

interface Mode {
  id: ModeId;
  label: string;
  icon: typeof ImageIcon;
  tint: string;
  glow: string;
  prompt: string;
  meta: string;
  /** Tool name shown in the agent's dispatch trace. */
  tool: string;
  /** Whether this modality has live generation wired up on the homepage. */
  liveGenerate: boolean;
}

const MODES: readonly Mode[] = [
  {
    id: "image",
    label: "圖片",
    icon: ImageIcon,
    tint: "rgba(168,85,247,0.85)",
    glow: "rgba(168,85,247,0.55)",
    prompt: "夕陽下的少女側臉，電影感、淺景深、35mm 底片質感",
    meta: "輸出 1 張 · 約 8 秒",
    tool: "image_generator.nano_banana_2",
    liveGenerate: true,
  },
  {
    id: "video",
    label: "影片",
    icon: Video,
    tint: "rgba(59,130,246,0.85)",
    glow: "rgba(59,130,246,0.5)",
    prompt: "城市夜景慢速推軌，霓虹倒影、雨後濕地、9:16 直式",
    meta: "輸出 6 秒短片 · 約 30 秒",
    tool: "video_generator.kling_v2",
    liveGenerate: false,
  },
  {
    id: "music",
    label: "音樂",
    icon: Music,
    tint: "rgba(236,72,153,0.85)",
    glow: "rgba(236,72,153,0.55)",
    prompt: "冷冽雨夜，慢板鋼琴主旋律 + 弦樂氛圍墊底，BPM 72",
    meta: "輸出 30 秒原創曲 · 約 20 秒",
    tool: "music_generator.compose",
    liveGenerate: false,
  },
  {
    id: "voice",
    label: "配音",
    icon: Mic,
    tint: "rgba(249,115,22,0.85)",
    glow: "rgba(249,115,22,0.5)",
    prompt: "溫暖女聲旁白，語速中等、情緒平靜，繁體中文",
    meta: "輸出 1 段配音 · 約 12 秒",
    tool: "voice_synth.warm_female_zh",
    liveGenerate: false,
  },
  {
    id: "director",
    label: "導演",
    icon: Clapperboard,
    tint: "rgba(34,197,94,0.85)",
    glow: "rgba(34,197,94,0.5)",
    prompt: "30 秒品牌形象短片，分 5 鏡，溫暖治癒風格，含字幕",
    meta: "拆 5 鏡 + 配樂 + 字幕 · 約 90 秒",
    tool: "director_orchestrator.plan",
    liveGenerate: false,
  },
  {
    id: "lora",
    label: "角色 LoRA",
    icon: Shield,
    tint: "rgba(14,165,233,0.85)",
    glow: "rgba(14,165,233,0.55)",
    prompt: "上傳 12 張參考圖，建立專屬角色模型，跨作品風格一致",
    meta: "訓練專屬模型 · 約 8 分鐘",
    tool: "lora_trainer.create",
    liveGenerate: false,
  },
] as const;

// ─── Scenario presets — fold the former "你可以這樣用" use cases into the
//    orb stage so the agent can dispatch them inline (no studio detour). ──

interface Scenario {
  id: string;
  modeId: ModeId;
  label: string;
  eta: string;
  summary: string;
  prompt: string;
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: "brand-short-film",
    modeId: "director",
    label: "品牌形象短片",
    eta: "20-30 分鐘",
    summary: "代理拆鏡 + 配樂 + 字幕一次到位",
    prompt:
      "幫我做一支 20 秒品牌形象短片，溫暖療癒、自動分鏡、配樂、繁中字幕。",
  },
  {
    id: "product-key-visual",
    modeId: "image",
    label: "商品主視覺",
    eta: "8-12 分鐘",
    summary: "代理產出多版可比較設計稿",
    prompt:
      "極簡質感商品攝影，純色背景、柔光、淺景深、4K，產出 4 版差異稿。",
  },
  {
    id: "social-short",
    modeId: "video",
    label: "社群短影音",
    eta: "10-15 分鐘",
    summary: "9:16 直式，自動節奏點與字幕",
    prompt:
      "15 秒 9:16 社群短影音，霓虹城市夜景慢推軌，自動節奏點切換、配字幕。",
  },
  {
    id: "podcast-music",
    modeId: "music",
    label: "Podcast 配樂與旁白",
    eta: "10-15 分鐘",
    summary: "原創配樂 + 語音克隆旁白",
    prompt:
      "Podcast 開場 30 秒原創配樂，BPM 76、慢板鋼琴 + 弦樂氛圍，搭配溫暖女聲旁白。",
  },
  {
    id: "character-series",
    modeId: "lora",
    label: "角色一致系列圖",
    eta: "25-40 分鐘",
    summary: "LoRA 鎖風格，跨作品一致",
    prompt:
      "上傳 12 張參考圖，訓練專屬角色 LoRA，後續以同一造型產出 6 張系列圖。",
  },
  {
    id: "campaign-pack",
    modeId: "director",
    label: "完整行銷素材包",
    eta: "30-45 分鐘",
    summary: "主視覺 + 短片 + 配樂 + 旁白",
    prompt:
      "產出完整行銷素材包：主視覺、15 秒短片、30 秒配樂、繁中旁白，跨格式同步。",
  },
] as const;

// ─── Inline value strip — folded in from the former site value highlights. ──

const VALUE_HIGHLIGHTS = [
  { id: "speed", icon: Zap, label: "一句話到成品" },
  { id: "consistency", icon: Target, label: "風格一致" },
  { id: "scene", icon: Palette, label: "場景四時段" },
  { id: "iterate", icon: CircleCheck, label: "版本可重跑" },
] as const;

// ─── Phase label (shared chrome) ────────────────────────────────────────────

function PhaseLabel({ tint, label }: { tint: string; label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-3 sm:mb-4">
      <span
        className="block h-px w-8 rounded-full"
        style={{ background: `linear-gradient(90deg, transparent, ${tint})` }}
      />
      <span
        className="text-[10px] tracking-[0.4em] uppercase font-medium"
        style={{ color: tint }}
      >
        {label}
      </span>
      <span
        className="block h-px w-8 rounded-full"
        style={{ background: `linear-gradient(90deg, ${tint}, transparent)` }}
      />
    </div>
  );
}

// ─── Pointer-reactive orb (mouse + touch) ───────────────────────────────────

interface InteractiveOrbProps {
  tint: string;
  glow: string;
  /** When > 0, the orb pulses at this intensity (e.g. while user types). */
  excitement: number;
  /** When true, the orb shows a generation/loading shimmer. */
  busy: boolean;
}

function InteractiveOrb({ tint, glow, excitement, busy }: InteractiveOrbProps) {
  const reduce = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Pointer position relative to centre, normalised to [-1, 1].
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sxNorm = useSpring(px, { stiffness: 110, damping: 16, mass: 0.5 });
  const syNorm = useSpring(py, { stiffness: 110, damping: 16, mass: 0.5 });

  const orbX = useTransform(sxNorm, [-1, 1], [-12, 12]);
  const orbY = useTransform(syNorm, [-1, 1], [-12, 12]);
  const rotX = useTransform(syNorm, [-1, 1], [10, -10]);
  const rotY = useTransform(sxNorm, [-1, 1], [-12, 12]);

  useEffect(() => {
    if (reduce) return;
    const el = wrapRef.current;
    if (!el) return;

    const setFromClient = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const ratioX = (clientX - cx) / Math.max(rect.width / 2, 1);
      const ratioY = (clientY - cy) / Math.max(rect.height / 2, 1);
      px.set(Math.max(-1.5, Math.min(1.5, ratioX)));
      py.set(Math.max(-1.5, Math.min(1.5, ratioY)));
    };

    const onPointerMove = (e: PointerEvent) => {
      setFromClient(e.clientX, e.clientY);
    };
    const onPointerLeave = () => {
      px.set(0);
      py.set(0);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      setFromClient(t.clientX, t.clientY);
    };
    const onTouchEnd = () => {
      px.set(0);
      py.set(0);
    };

    el.addEventListener("pointermove", onPointerMove, { passive: true });
    el.addEventListener("pointerleave", onPointerLeave);
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerleave", onPointerLeave);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [reduce, px, py]);

  const breathScale = 1 + Math.min(excitement, 1) * 0.08;

  return (
    <div
      ref={wrapRef}
      className="relative w-32 h-32 sm:w-40 sm:h-40 lg:w-44 lg:h-44 select-none"
      style={{ perspective: 800, touchAction: "none" }}
      aria-hidden
    >
      {/* outer glow */}
      <motion.div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle, ${glow} 0%, transparent 70%)`,
        }}
        animate={
          reduce
            ? undefined
            : {
                scale: [breathScale, breathScale * 1.18, breathScale],
                opacity: [0.45, 0.7, 0.45],
              }
        }
        transition={{ duration: busy ? 1.6 : 3.2, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* expanding rings */}
      {!reduce && (
        <>
          {[0, 1, 2].map(i => (
            <motion.span
              key={i}
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{ border: `1px solid ${tint}` }}
              animate={{ scale: [1, 1.7], opacity: [0.55, 0] }}
              transition={{
                duration: busy ? 1.4 : 2.6,
                delay: i * 0.7,
                repeat: Infinity,
                ease: "easeOut",
              }}
            />
          ))}
        </>
      )}
      {/* tilting core */}
      <motion.div
        className="absolute inset-3 sm:inset-4"
        style={{
          x: reduce ? 0 : orbX,
          y: reduce ? 0 : orbY,
          rotateX: reduce ? 0 : rotX,
          rotateY: reduce ? 0 : rotY,
          transformStyle: "preserve-3d",
        }}
      >
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.95) 0%, ${tint} 40%, ${glow} 75%, transparent 100%)`,
            boxShadow: `0 0 50px ${glow}, inset 0 0 24px rgba(255,255,255,0.6)`,
          }}
          animate={
            reduce
              ? undefined
              : { rotate: 360, scale: [1, 1.04, 1] }
          }
          transition={{
            rotate: { duration: busy ? 6 : 18, repeat: Infinity, ease: "linear" },
            scale: { duration: 3, repeat: Infinity, ease: "easeInOut" },
          }}
        />
        {busy && (
          <motion.div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background:
                "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.45) 50%, transparent 70%)",
              mixBlendMode: "screen",
            }}
            animate={{ x: ["-100%", "100%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </motion.div>
    </div>
  );
}

// ─── Output previews (placeholder + real image) ─────────────────────────────

function PlaceholderImage({ tint }: { tint: string }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 w-full h-full p-1">
      {[0, 1, 2, 3].map(i => (
        <motion.div
          key={i}
          className="rounded-lg relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${tint}, rgba(255,255,255,0.06))`,
            border: `1px solid ${tint}`,
          }}
          initial={{ opacity: 0, scale: 0.9, filter: "blur(8px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          transition={{ delay: 0.15 + i * 0.12, duration: 0.5 }}
        >
          <motion.div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.25) 50%, transparent 70%)",
            }}
            animate={{ x: ["-100%", "100%"] }}
            transition={{
              duration: 2.4,
              delay: 0.4 + i * 0.2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        </motion.div>
      ))}
    </div>
  );
}

function PlaceholderVideo({ tint }: { tint: string }) {
  return (
    <div className="flex flex-col gap-2 w-full h-full p-2 justify-center">
      <div className="flex gap-1.5">
        {[0, 1, 2, 3, 4].map(i => (
          <motion.div
            key={i}
            className="flex-1 aspect-[3/4] rounded-md relative overflow-hidden"
            style={{
              background: `linear-gradient(135deg, ${tint}, rgba(255,255,255,0.05))`,
              border: `1px solid ${tint}`,
            }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
          />
        ))}
      </div>
      <div
        className="h-1 rounded-full overflow-hidden mt-2"
        style={{ background: "rgba(255,255,255,0.08)" }}
      >
        <motion.div
          className="h-full"
          style={{ background: tint }}
          animate={{ width: ["0%", "100%"] }}
          transition={{ duration: 3.0, repeat: Infinity, ease: "linear" }}
        />
      </div>
    </div>
  );
}

function PlaceholderMusic({ tint }: { tint: string }) {
  const bars = Array.from({ length: 24 }, (_, i) => i);
  return (
    <div className="flex items-end justify-center gap-1 w-full h-full px-3 py-2">
      {bars.map(i => (
        <motion.span
          key={i}
          className="rounded-full"
          style={{
            width: 4,
            background: tint,
            boxShadow: `0 0 8px ${tint}`,
          }}
          animate={{
            height: [
              `${15 + ((i * 13) % 60)}%`,
              `${30 + ((i * 7) % 50)}%`,
              `${15 + ((i * 13) % 60)}%`,
            ],
          }}
          transition={{
            duration: 1.2 + (i % 4) * 0.15,
            delay: (i % 6) * 0.08,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

function PlaceholderVoice({ tint }: { tint: string }) {
  return (
    <div className="flex items-center justify-center w-full h-full px-3">
      <svg viewBox="0 0 200 60" className="w-full h-full" preserveAspectRatio="none">
        <motion.path
          d="M 0 30 Q 20 10 40 30 T 80 30 T 120 30 T 160 30 T 200 30"
          fill="none"
          stroke={tint}
          strokeWidth="1.5"
          strokeLinecap="round"
          animate={{
            d: [
              "M 0 30 Q 20 10 40 30 T 80 30 T 120 30 T 160 30 T 200 30",
              "M 0 30 Q 20 50 40 30 T 80 30 T 120 30 T 160 30 T 200 30",
              "M 0 30 Q 20 18 40 30 T 80 30 T 120 30 T 160 30 T 200 30",
            ],
          }}
          transition={{ duration: 2.0, repeat: Infinity, ease: "easeInOut" }}
          style={{ filter: `drop-shadow(0 0 4px ${tint})` }}
        />
      </svg>
    </div>
  );
}

function PlaceholderDirector({ tint }: { tint: string }) {
  return (
    <div className="grid grid-cols-3 gap-1.5 w-full h-full p-2">
      {[0, 1, 2, 3, 4, 5].map(i => (
        <motion.div
          key={i}
          className="rounded-md relative overflow-hidden flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${tint}, rgba(255,255,255,0.05))`,
            border: `1px solid ${tint}`,
          }}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.1, duration: 0.4 }}
        >
          <span className="text-[9px] font-medium" style={{ color: tint }}>
            S{i + 1}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

function PlaceholderLora({ tint }: { tint: string }) {
  return (
    <div className="flex items-center justify-center gap-3 w-full h-full">
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          className="w-12 h-16 sm:w-14 sm:h-20 rounded-xl relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${tint}, rgba(255,255,255,0.05))`,
            border: `1px solid ${tint}`,
          }}
          animate={{ y: [0, -4, 0], scale: [1, 1.05, 1] }}
          transition={{ duration: 2.4, delay: i * 0.3, repeat: Infinity, ease: "easeInOut" }}
        >
          <div
            className="absolute inset-x-2 top-2 h-3 rounded-full"
            style={{ background: tint, opacity: 0.6 }}
          />
          <div
            className="absolute inset-x-2 bottom-2 h-1 rounded-full"
            style={{ background: tint, opacity: 0.4 }}
          />
        </motion.div>
      ))}
    </div>
  );
}

function PlaceholderForMode({ mode }: { mode: Mode }) {
  switch (mode.id) {
    case "image":
      return <PlaceholderImage tint={mode.tint} />;
    case "video":
      return <PlaceholderVideo tint={mode.tint} />;
    case "music":
      return <PlaceholderMusic tint={mode.tint} />;
    case "voice":
      return <PlaceholderVoice tint={mode.tint} />;
    case "director":
      return <PlaceholderDirector tint={mode.tint} />;
    case "lora":
      return <PlaceholderLora tint={mode.tint} />;
  }
}

// ─── Agent tool-dispatch trace ──────────────────────────────────────────────

type DispatchStep = "parse" | "call" | "stream" | "done";

interface DispatchState {
  tool: string;
  step: DispatchStep;
  /** When true, this dispatch is a real backend call (image only). */
  live: boolean;
}

const DISPATCH_STEP_ORDER: readonly DispatchStep[] = [
  "parse",
  "call",
  "stream",
  "done",
];

function ToolDispatchTrace({
  state,
  tint,
  prompt,
}: {
  state: DispatchState;
  tint: string;
  prompt: string;
}) {
  const reduce = useReducedMotion();
  const stepIndex = DISPATCH_STEP_ORDER.indexOf(state.step);
  const promptPreview =
    prompt.length > 48 ? `${prompt.slice(0, 46)}…` : prompt;

  const lines: { key: DispatchStep; text: string }[] = [
    { key: "parse", text: "光球代理 · 解析意圖與模態" },
    {
      key: "call",
      text: `→ ${state.tool}({ prompt: "${promptPreview}" })`,
    },
    {
      key: "stream",
      text: state.live ? "← 串流真實 API 預覽…" : "← 串流模擬預覽（示範）…",
    },
    { key: "done", text: state.live ? "✓ 已完成" : "✓ 代理示範完成" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.25 }}
      className="absolute left-2 right-2 bottom-2 rounded-lg backdrop-blur-md px-2.5 py-1.5 font-mono text-[9.5px] sm:text-[10px] leading-relaxed pointer-events-none"
      style={{
        background: "rgba(0,0,0,0.45)",
        border: `1px solid ${tint}`,
        color: "rgba(255,255,255,0.92)",
      }}
    >
      <div
        className="flex items-center gap-1.5 mb-0.5"
        style={{ color: tint }}
      >
        <Terminal className="w-2.5 h-2.5" />
        <span className="tracking-[0.2em] uppercase text-[8.5px]">
          agent.dispatch
        </span>
        {state.live && (
          <span
            className="ml-auto text-[8px] px-1 py-0.5 rounded"
            style={{ background: tint, color: "#fff" }}
          >
            LIVE
          </span>
        )}
      </div>
      {lines.map((line, idx) => {
        const reached = idx <= stepIndex;
        const active = idx === stepIndex && state.step !== "done";
        return (
          <div
            key={line.key}
            className="flex items-start gap-1.5"
            style={{ opacity: reached ? 1 : 0.35 }}
          >
            <span style={{ width: 8, color: tint }}>
              {idx < stepIndex || state.step === "done" ? "✓" : active ? "›" : "·"}
            </span>
            <span className="flex-1 truncate">
              {line.text}
              {active && !reduce && (
                <motion.span
                  className="ml-0.5 inline-block"
                  animate={{ opacity: [1, 0.2, 1] }}
                  transition={{ duration: 0.9, repeat: Infinity }}
                >
                  ▌
                </motion.span>
              )}
            </span>
          </div>
        );
      })}
    </motion.div>
  );
}

// ─── Component props ────────────────────────────────────────────────────────

interface OrbCreationStageProps {
  textPrimary: string;
  textMuted: string;
  cardBg: string;
  cardBorder: string;
  featureBg: string;
  btnPrimary: string;
  btnPrimaryText: string;
  isDark: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// ─── Main component ────────────────────────────────────────────────────────

/**
 * OrbCreationStage — single unified visual experience for the homepage.
 * Folds in the former "Site Value Highlights" + "Site Use Cases" sections
 * so users can see the global orb agent dispatch every modality (image,
 * video, music, voice, director, LoRA) in place — no studio detour.
 *
 * Real APIs wired:
 *   - `sense.inferIntent` (public) → "光球感應" the prompt as user types
 *   - `imageStudio.checkApiKey` (public) → reveal whether live generation works
 *   - `imageStudio.nanoBanana2` (auth) → real image generation when user is
 *     logged in and the image modality is selected.
 *
 * For the other five modalities the agent dispatch is shown as a
 * tool-call trace + animated preview, so users feel the orb agent calling
 * those tools without leaving the homepage.
 */
export default function OrbCreationStage({
  textPrimary,
  textMuted,
  cardBg,
  cardBorder,
  featureBg,
  btnPrimary,
  btnPrimaryText,
  isDark,
}: OrbCreationStageProps) {
  const isMobile = useIsMobile();
  const reduce = useReducedMotion();
  const { isAuthenticated } = useAuth();

  const [activeId, setActiveId] = useState<ModeId>("image");
  const activeMode = useMemo(
    () => MODES.find(m => m.id === activeId) ?? MODES[0],
    [activeId]
  );
  const [prompt, setPrompt] = useState<string>(activeMode.prompt);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [dispatch, setDispatch] = useState<DispatchState | null>(null);
  const [simulating, setSimulating] = useState(false);
  const dispatchTimers = useRef<number[]>([]);
  useEffect(() => {
    return () => {
      dispatchTimers.current.forEach(id => window.clearTimeout(id));
      dispatchTimers.current = [];
    };
  }, []);

  // When the user switches modality, swap the prompt to the suggestion
  // unless the user has typed something custom that doesn't match any sample.
  const userEditedRef = useRef(false);
  useEffect(() => {
    if (userEditedRef.current) return;
    setPrompt(activeMode.prompt);
  }, [activeMode]);

  // ── tRPC ──
  const apiKeyQuery = trpc.imageStudio.checkApiKey.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const senseIntentMut = trpc.sense.inferIntent.useMutation();
  const imageGenMut = trpc.imageStudio.nanoBanana2.useMutation({
    onSuccess: data => {
      const url = (data?.image_url as string | null) ?? data?.images?.[0] ?? null;
      if (url) {
        setResultUrl(url);
        setErrorMsg(null);
      } else {
        setErrorMsg("光球暫時沒拿到結果，再試一次。");
      }
    },
    onError: err => {
      setResultUrl(null);
      setErrorMsg(err.message || "生成失敗，請再試一次。");
    },
  });

  // ── Debounced sense inference (real public API) ──
  const debouncedPrompt = useDebouncedValue(prompt.trim(), 700);
  useEffect(() => {
    if (debouncedPrompt.length < 8) return;
    const now = Date.now();
    senseIntentMut.mutate({
      events: [
        {
          type: "hoverIntent",
          timestamp: now,
          targetId: `home-orb-${activeMode.id}`,
          meta: {
            cardTitle: activeMode.label,
            hoverMs: 1500,
            mouseTravel: 40,
            intentScore: 0.85,
            promptPreview: debouncedPrompt.slice(0, 120),
            modality: activeMode.id,
          },
        },
        {
          type: "cardDwell",
          timestamp: now - 1000,
          targetId: `home-orb-${activeMode.id}`,
          meta: {
            cardTitle: activeMode.label,
            cardModality: activeMode.id,
            dwellMs: 4200,
            cardTags: [activeMode.id, "homepage", "orb"],
          },
        },
        {
          type: "sectionVisit",
          timestamp: now - 2000,
          targetId: "orb-creation-stage",
          meta: { totalDwellMs: 6000, visitCount: 1 },
        },
      ],
      summary: {
        totalEvents: 3,
        dwellCount: 1,
        hesitationCount: 0,
        highIntentCards: [
          {
            targetId: `home-orb-${activeMode.id}`,
            title: `${activeMode.label}: ${debouncedPrompt.slice(0, 40)}`,
            score: 0.85,
          },
        ],
        hesitationSections: [],
        modalityPreference: { [activeMode.id]: 1 },
        abortCount: 0,
        rapidScanCount: 0,
        sessionStartedAt: now - 6000,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedPrompt, activeMode.id]);

  const senseInsight = senseIntentMut.data;

  // Excitement drives the orb's pulse — inferred from typing freshness +
  // sense confidence so the orb visibly "responds" to the prompt.
  const excitement = useMemo(() => {
    const promptScore = Math.min(prompt.trim().length / 80, 1);
    const senseScore = senseInsight?.confidence ?? 0;
    return Math.min(0.4 + promptScore * 0.4 + senseScore * 0.4, 1.2);
  }, [prompt, senseInsight]);

  const clearDispatchTimers = useCallback(() => {
    dispatchTimers.current.forEach(id => window.clearTimeout(id));
    dispatchTimers.current = [];
  }, []);

  const handleSelectMode = (id: ModeId) => {
    setActiveId(id);
    userEditedRef.current = false;
    setResultUrl(null);
    setErrorMsg(null);
    setDispatch(null);
    setSimulating(false);
    setActiveScenarioId(null);
    clearDispatchTimers();
  };

  const handleSelectScenario = (s: Scenario) => {
    setActiveScenarioId(s.id);
    setActiveId(s.modeId);
    userEditedRef.current = false;
    setPrompt(s.prompt);
    setResultUrl(null);
    setErrorMsg(null);
    setDispatch(null);
    setSimulating(false);
    clearDispatchTimers();
  };

  const handlePromptChange = (next: string) => {
    setPrompt(next);
    userEditedRef.current = true;
    setActiveScenarioId(null);
  };

  /** Drive the dispatch trace for non-live modalities so users see the
   *  global orb agent calling the right tool inline. */
  const runSimulatedDispatch = useCallback(
    (mode: Mode) => {
      clearDispatchTimers();
      setSimulating(true);
      setDispatch({ tool: mode.tool, step: "parse", live: false });
      const queue = (delay: number, step: DispatchStep, done = false) => {
        const id = window.setTimeout(() => {
          setDispatch(d =>
            d && d.tool === mode.tool ? { ...d, step } : d
          );
          if (done) setSimulating(false);
        }, delay);
        dispatchTimers.current.push(id);
      };
      queue(450, "call");
      queue(1100, "stream");
      queue(2100, "done", true);
    },
    [clearDispatchTimers]
  );

  const handleGenerate = useCallback(() => {
    setErrorMsg(null);
    const trimmed = prompt.trim();
    if (!trimmed) {
      setErrorMsg("先寫一句話，光球代理才能感應。");
      return;
    }
    // Image modality has a real backend wired. All others are dispatched
    // by the orb agent as a tool-call trace, in place.
    if (!activeMode.liveGenerate) {
      runSimulatedDispatch(activeMode);
      return;
    }
    if (!isAuthenticated) {
      window.location.href = getLoginUrl();
      return;
    }
    if (apiKeyQuery.data && apiKeyQuery.data.configured === false) {
      setErrorMsg("尚未設定 FAL_API_KEY，光球代理改用模擬流。可至設定接上真實金鑰。");
      runSimulatedDispatch(activeMode);
      return;
    }
    setResultUrl(null);
    setDispatch({ tool: activeMode.tool, step: "parse", live: true });
    imageGenMut.mutate({
      prompt: trimmed,
      aspect_ratio: "1:1",
      num_images: 1,
    });
  }, [
    prompt,
    activeMode,
    isAuthenticated,
    apiKeyQuery.data,
    imageGenMut,
    runSimulatedDispatch,
  ]);

  // Drive the LIVE dispatch trace through its phases as the real mutation
  // progresses, so the trace mirrors the actual API call rather than just
  // appearing at completion.
  useEffect(() => {
    if (!dispatch?.live) return;
    if (imageGenMut.isPending) {
      setDispatch(d => (d ? { ...d, step: "call" } : d));
      const id = window.setTimeout(() => {
        setDispatch(d => (d && d.live ? { ...d, step: "stream" } : d));
      }, 600);
      dispatchTimers.current.push(id);
    } else if (imageGenMut.isSuccess) {
      setDispatch(d => (d ? { ...d, step: "done" } : d));
    }
  }, [dispatch?.live, imageGenMut.isPending, imageGenMut.isSuccess]);

  const isBusy = imageGenMut.isPending || simulating;
  const apiKeyConfigured = apiKeyQuery.data?.configured ?? null;

  return (
    <section
      aria-label="光球創作劇場"
      className="px-4 sm:px-6 py-14 sm:py-20 lg:py-24 relative z-10"
    >
      <div className="max-w-5xl mx-auto">
        {/* ── Phase header — merged copy ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-7 sm:mb-10"
        >
          <PhaseLabel tint={activeMode.tint} label={`Phase 01 → 02 · 光球創作劇場`} />
          <h2
            className={`text-2xl sm:text-4xl md:text-5xl font-semibold leading-tight tracking-tight transition-colors duration-1000 ${textPrimary}`}
          >
            從一個念頭開始 ·
            <span
              className="bg-clip-text text-transparent bg-gradient-to-br ml-1 sm:ml-2"
              style={{
                backgroundImage: `linear-gradient(135deg, ${activeMode.tint}, ${activeMode.glow})`,
                transition: "background-image 0.6s ease",
              }}
            >
              即時生成
            </span>
          </h2>
          <p
            className={`mt-3 sm:mt-5 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed transition-colors duration-1000 ${textMuted}`}
          >
            寫下你想創作的畫面或情緒 — 光球代理會即時感應、判斷模態，
            並為你呼叫對應的生成工具：圖片、影片、音樂、配音、導演與角色 LoRA，全部在這個畫面完成。
          </p>
        </motion.div>

        {/* ── Scenario presets — fold the former "六種常見創作情境" inline so
            the orb agent can dispatch each scenario right here ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.8, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6 sm:mb-7"
        >
          <div className={`flex items-center justify-center gap-2 mb-3 text-[10px] sm:text-[11px] tracking-[0.2em] uppercase ${textMuted}`}>
            <Layers className="w-3 h-3" style={{ color: activeMode.tint }} />
            <span>常見情境 · 一鍵交給光球代理</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-2.5">
            {SCENARIOS.map(scenario => {
              const mode = MODES.find(m => m.id === scenario.modeId)!;
              const isActive = scenario.id === activeScenarioId;
              const Icon = mode.icon;
              return (
                <motion.button
                  key={scenario.id}
                  type="button"
                  onClick={() => handleSelectScenario(scenario)}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  className="group text-left rounded-xl px-2.5 sm:px-3 py-2 sm:py-2.5 backdrop-blur-md transition-all duration-300"
                  style={{
                    background: isActive ? mode.tint : cardBg,
                    border: `1px solid ${isActive ? mode.tint : cardBorder}`,
                    boxShadow: isActive ? `0 8px 24px ${mode.glow}` : "none",
                  }}
                  aria-pressed={isActive}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Icon
                      className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0"
                      style={{ color: isActive ? "#fff" : mode.tint }}
                    />
                    <span
                      className={`text-[11px] sm:text-xs font-medium truncate ${
                        isActive ? "text-white" : textPrimary
                      }`}
                    >
                      {scenario.label}
                    </span>
                    <span
                      className="ml-auto inline-flex items-center gap-0.5 text-[9px] sm:text-[10px] shrink-0"
                      style={{
                        color: isActive ? "rgba(255,255,255,0.85)" : mode.tint,
                      }}
                    >
                      <Clock className="w-2.5 h-2.5" />
                      {scenario.eta}
                    </span>
                  </div>
                  <p
                    className={`text-[10px] sm:text-[11px] leading-snug line-clamp-1 ${
                      isActive ? "text-white/85" : textMuted
                    }`}
                  >
                    {scenario.summary}
                  </p>
                </motion.button>
              );
            })}
          </div>
        </motion.div>

        {/* ── Interactive panel ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.9, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-3xl overflow-hidden backdrop-blur-md p-4 sm:p-6 lg:p-8"
          style={{
            background: cardBg,
            border: `1px solid ${cardBorder}`,
            boxShadow: `0 30px 80px -20px ${activeMode.glow}`,
            transition: "box-shadow 0.8s ease",
          }}
        >
          {/* Ambient halo at top */}
          <motion.div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(ellipse at 50% 0%, ${activeMode.glow} 0%, transparent 55%)`,
              opacity: 0.35,
            }}
            animate={reduce ? undefined : { opacity: [0.25, 0.45, 0.25] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Three-column stage on desktop, stacked on mobile */}
          <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-3 sm:gap-4 lg:gap-6 items-stretch">
            {/* Prompt input */}
            <div
              className="rounded-2xl p-3 sm:p-4 lg:p-5 min-h-[160px] sm:min-h-[180px] flex flex-col gap-3"
              style={{ background: featureBg, border: `1px solid ${cardBorder}` }}
            >
              <div className="flex items-center gap-2">
                <Wand2 className="w-3.5 h-3.5" style={{ color: activeMode.tint }} />
                <span
                  className="text-[10px] tracking-[0.2em] uppercase font-medium"
                  style={{ color: activeMode.tint }}
                >
                  輸入提示詞
                </span>
                <motion.span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: activeMode.tint }}
                  animate={reduce ? undefined : { opacity: [1, 0.2, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                />
              </div>
              <textarea
                value={prompt}
                onChange={e => handlePromptChange(e.target.value)}
                placeholder="一句話、一個感覺、一個畫面，光球都接得住…"
                rows={isMobile ? 3 : 4}
                maxLength={400}
                className={`w-full resize-none bg-transparent outline-none text-xs sm:text-sm lg:text-base leading-relaxed font-mono ${textPrimary} placeholder:opacity-50`}
                style={{
                  caretColor: activeMode.tint,
                }}
              />
              <div className={`flex items-center justify-between text-[10px] sm:text-xs ${textMuted}`}>
                <span>{activeMode.meta}</span>
                <span>{prompt.length}/400</span>
              </div>
            </div>

            {/* Center orb */}
            <div className="relative flex flex-col items-center justify-center min-h-[140px] lg:min-h-[220px] gap-2">
              <InteractiveOrb
                tint={activeMode.tint}
                glow={activeMode.glow}
                excitement={excitement}
                busy={isBusy}
              />
              {/* Sense whisper — driven by the real public sense.inferIntent API */}
              <AnimatePresence mode="wait">
                {senseInsight && senseInsight.confidence > 0.3 && !isBusy && (
                  <motion.div
                    key={senseInsight.intentLabel + senseInsight.preferredModality}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.4 }}
                    className={`text-center px-2 max-w-[14rem] ${textMuted}`}
                  >
                    <div
                      className="inline-flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase mb-0.5"
                      style={{ color: activeMode.tint }}
                    >
                      <Eye className="w-3 h-3" />
                      光球感應
                    </div>
                    <p className="text-[11px] sm:text-xs leading-snug line-clamp-2">
                      {senseInsight.intentLabel}
                      {senseInsight.detectedAesthetics?.[0]
                        ? ` · ${senseInsight.detectedAesthetics.slice(0, 2).join("、")}`
                        : ""}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Output preview */}
            <div
              className="rounded-2xl relative overflow-hidden min-h-[160px] sm:min-h-[200px] lg:min-h-[240px]"
              style={{ background: featureBg, border: `1px solid ${cardBorder}` }}
            >
              <div className="absolute top-2 left-3 right-3 z-10 flex items-center gap-2">
                <span
                  className="text-[10px] tracking-[0.2em] uppercase font-medium"
                  style={{ color: activeMode.tint }}
                >
                  代理生成預覽
                </span>
                <motion.span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: activeMode.tint }}
                  animate={reduce ? undefined : { scale: [1, 1.4, 1] }}
                  transition={{ duration: 1.0, repeat: Infinity }}
                />
                {dispatch && (
                  <span
                    className="ml-auto text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded-full inline-flex items-center gap-1"
                    style={{
                      background: dispatch.live
                        ? activeMode.glow
                        : "rgba(255,255,255,0.06)",
                      border: `1px solid ${activeMode.tint}`,
                      color: dispatch.live
                        ? "#fff"
                        : isDark
                          ? "rgba(255,255,255,0.85)"
                          : "rgba(20,20,30,0.8)",
                    }}
                  >
                    {dispatch.step === "done" ? (
                      <CheckCircle2 className="w-2.5 h-2.5" />
                    ) : (
                      <Terminal className="w-2.5 h-2.5" />
                    )}
                    {dispatch.live ? "LIVE" : "AGENT"}
                  </span>
                )}
              </div>
              <div className="absolute inset-0 pt-7">
                <AnimatePresence mode="wait">
                  {resultUrl && activeMode.id === "image" ? (
                    <motion.div
                      key="result"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.4 }}
                      className="w-full h-full p-2"
                    >
                      <img
                        src={resultUrl}
                        alt={prompt}
                        className="w-full h-full object-contain rounded-xl"
                        loading="lazy"
                      />
                    </motion.div>
                  ) : (
                    <motion.div
                      key={`placeholder-${activeMode.id}`}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.4 }}
                      className="w-full h-full"
                    >
                      <PlaceholderForMode mode={activeMode} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <AnimatePresence>
                {dispatch && (
                  <ToolDispatchTrace
                    state={dispatch}
                    tint={activeMode.tint}
                    prompt={prompt}
                  />
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* ── Modality selector — the agent's tool palette ── */}
          <div
            className={`relative mt-5 sm:mt-6 text-center text-[10px] sm:text-[11px] tracking-[0.2em] uppercase mb-2 ${textMuted}`}
          >
            光球代理可呼叫的工具
          </div>
          <div className="relative flex flex-wrap justify-center gap-2 sm:gap-2.5">
            {MODES.map(mode => {
              const Icon = mode.icon;
              const isActive = mode.id === activeMode.id;
              return (
                <motion.button
                  key={mode.id}
                  type="button"
                  onClick={() => handleSelectMode(mode.id)}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.96 }}
                  className="relative inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-medium transition-all duration-300"
                  style={{
                    background: isActive ? mode.tint : featureBg,
                    color: isActive
                      ? "#fff"
                      : isDark
                        ? "rgba(255,255,255,0.75)"
                        : "rgba(20,20,30,0.7)",
                    border: `1px solid ${isActive ? mode.tint : cardBorder}`,
                    boxShadow: isActive ? `0 6px 20px ${mode.glow}` : "none",
                  }}
                  aria-pressed={isActive}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {mode.label}
                  {mode.liveGenerate && (
                    <span
                      className="ml-0.5 text-[9px] uppercase tracking-wider opacity-80"
                      style={{ color: isActive ? "#fff" : mode.tint }}
                    >
                      live
                    </span>
                  )}
                </motion.button>
              );
            })}
          </div>

          {/* ── Generate CTA ── */}
          <div className="relative mt-5 sm:mt-7 flex flex-col items-center gap-3">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full">
              <motion.button
                type="button"
                onClick={handleGenerate}
                disabled={isBusy}
                whileHover={!isBusy ? { y: -2 } : undefined}
                whileTap={!isBusy ? { scale: 0.97 } : undefined}
                className={`group relative inline-flex items-center justify-center gap-2 rounded-2xl h-11 sm:h-12 px-6 sm:px-8 text-sm font-medium overflow-hidden btn-healing w-full sm:w-auto ${btnPrimary} ${btnPrimaryText} ${
                  isBusy ? "opacity-80 cursor-not-allowed" : ""
                }`}
                style={{ boxShadow: `0 8px 28px ${activeMode.glow}` }}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out"
                  style={{
                    background:
                      "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.22) 50%, transparent 70%)",
                  }}
                />
                {isBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {isBusy
                  ? activeMode.liveGenerate && imageGenMut.isPending
                    ? "光球代理串流中…"
                    : "光球代理派工中…"
                  : "✨ 讓光球代理生成"}
                <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
              </motion.button>
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent("orb-open-capabilities"))
                }
                className={`text-xs sm:text-sm underline-offset-4 hover:underline transition-colors duration-1000 ${textMuted}`}
              >
                或讓光球幫你決定模態
              </button>
            </div>

            {/* Status hints */}
            <div className={`text-center text-[11px] sm:text-xs ${textMuted}`}>
              {errorMsg ? (
                <span className="text-red-400">{errorMsg}</span>
              ) : isBusy && activeMode.liveGenerate && imageGenMut.isPending ? (
                <span>光球代理正在呼叫 {activeMode.tool} 真實 API…</span>
              ) : isBusy ? (
                <span>光球代理示範呼叫 {activeMode.tool}（多模態流以 LIVE 串接後上線）。</span>
              ) : activeMode.liveGenerate && !isAuthenticated ? (
                <span>登入後光球代理即可呼叫真實 API；其他模態目前以代理示範呼叫展示。</span>
              ) : activeMode.liveGenerate && apiKeyConfigured === false ? (
                <span>提示：尚未設定 FAL_API_KEY，光球代理僅以示範流呼叫。</span>
              ) : (
                <span>提示詞越具體，光球代理越能精準呼叫對應模態工具。</span>
              )}
            </div>

            {/* ── Value highlights — folded in micro-strip ── */}
            <div className="mt-3 sm:mt-4 flex flex-wrap justify-center gap-1.5 sm:gap-2">
              {VALUE_HIGHLIGHTS.map(item => {
                const Icon = item.icon;
                return (
                  <span
                    key={item.id}
                    className={`inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-[11px] ${textMuted}`}
                    style={{
                      background: featureBg,
                      border: `1px solid ${cardBorder}`,
                    }}
                  >
                    <Icon
                      className="w-2.5 h-2.5 sm:w-3 sm:h-3"
                      style={{ color: activeMode.tint }}
                    />
                    {item.label}
                  </span>
                );
              })}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
