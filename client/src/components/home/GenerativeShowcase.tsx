import { useEffect, useMemo, useRef, useState } from "react";
import {
  motion,
  AnimatePresence,
  useReducedMotion,
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
} from "lucide-react";
import { useLocation } from "wouter";
import { useIsMobile } from "@/hooks/useMobile";

type ModeId = "image" | "video" | "music" | "voice" | "director" | "lora";

interface Mode {
  id: ModeId;
  label: string;
  icon: typeof ImageIcon;
  tint: string;
  glow: string;
  prompt: string;
  meta: string;
  route: string;
}

const MODES: readonly Mode[] = [
  {
    id: "image",
    label: "圖片",
    icon: ImageIcon,
    tint: "rgba(168,85,247,0.85)",
    glow: "rgba(168,85,247,0.55)",
    prompt: "夕陽下的少女側臉，電影感、淺景深、35mm 底片質感",
    meta: "輸出 4 版 · 約 8 秒",
    route: "/image-studio",
  },
  {
    id: "video",
    label: "影片",
    icon: Video,
    tint: "rgba(59,130,246,0.85)",
    glow: "rgba(59,130,246,0.5)",
    prompt: "城市夜景慢速推軌，霓虹倒影、雨後濕地、9:16 直式",
    meta: "輸出 6 秒短片 · 約 30 秒",
    route: "/video-studio",
  },
  {
    id: "music",
    label: "音樂",
    icon: Music,
    tint: "rgba(236,72,153,0.85)",
    glow: "rgba(236,72,153,0.55)",
    prompt: "冷冽雨夜，慢板鋼琴主旋律 + 弦樂氛圍墊底，BPM 72",
    meta: "輸出 30 秒原創曲 · 約 20 秒",
    route: "/pro-studio",
  },
  {
    id: "voice",
    label: "配音",
    icon: Mic,
    tint: "rgba(249,115,22,0.85)",
    glow: "rgba(249,115,22,0.5)",
    prompt: "溫暖女聲旁白，語速中等、情緒平靜，繁體中文",
    meta: "輸出 1 段配音 · 約 12 秒",
    route: "/pro-studio",
  },
  {
    id: "director",
    label: "導演",
    icon: Clapperboard,
    tint: "rgba(34,197,94,0.85)",
    glow: "rgba(34,197,94,0.5)",
    prompt: "30 秒品牌形象短片，分 5 鏡，溫暖治癒風格，含字幕",
    meta: "拆 5 鏡 + 配樂 + 字幕 · 約 90 秒",
    route: "/director",
  },
  {
    id: "lora",
    label: "角色 LoRA",
    icon: Shield,
    tint: "rgba(14,165,233,0.85)",
    glow: "rgba(14,165,233,0.55)",
    prompt: "上傳 12 張參考圖，建立專屬角色模型，跨作品風格一致",
    meta: "訓練專屬模型 · 約 8 分鐘",
    route: "/lora-trainer",
  },
] as const;

function PhaseLabel({ num, tint, label }: { num: string; tint: string; label: string }) {
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
        Phase {num} · {label}
      </span>
      <span
        className="block h-px w-8 rounded-full"
        style={{ background: `linear-gradient(90deg, ${tint}, transparent)` }}
      />
    </div>
  );
}

function useTypewriter(text: string, speed: number = 28, paused: boolean = false) {
  const [out, setOut] = useState("");
  useEffect(() => {
    if (paused) return;
    setOut("");
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, speed);
    return () => window.clearInterval(id);
  }, [text, speed, paused]);
  return out;
}

function ParticleStream({ tint }: { tint: string }) {
  const reduce = useReducedMotion();
  if (reduce) return null;
  const particles = Array.from({ length: 8 }, (_, i) => i);
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {particles.map(i => (
        <motion.span
          key={i}
          className="absolute top-1/2 rounded-full"
          style={{
            left: 0,
            width: 4,
            height: 4,
            background: tint,
            filter: `drop-shadow(0 0 6px ${tint})`,
          }}
          initial={{ opacity: 0, x: 0, y: 0 }}
          animate={{
            x: ["0%", "100%"],
            y: [0, (i % 2 === 0 ? -1 : 1) * (8 + (i % 3) * 6), 0],
            opacity: [0, 0.9, 0],
          }}
          transition={{
            duration: 2.4,
            delay: i * 0.18,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

function ImageOutput({ tint }: { tint: string }) {
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
              background: `linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.25) 50%, transparent 70%)`,
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

function VideoOutput({ tint }: { tint: string }) {
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
          >
            <motion.div
              className="absolute inset-x-0 h-px"
              style={{ background: tint, top: "50%" }}
              animate={{ scaleX: [0, 1, 0] }}
              transition={{
                duration: 1.6,
                delay: i * 0.15,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          </motion.div>
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

function MusicOutput({ tint }: { tint: string }) {
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

function VoiceOutput({ tint }: { tint: string }) {
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
        <motion.path
          d="M 0 30 Q 20 22 40 30 T 80 30 T 120 30 T 160 30 T 200 30"
          fill="none"
          stroke={tint}
          strokeWidth="1"
          strokeLinecap="round"
          opacity={0.5}
          animate={{
            d: [
              "M 0 30 Q 20 22 40 30 T 80 30 T 120 30 T 160 30 T 200 30",
              "M 0 30 Q 20 38 40 30 T 80 30 T 120 30 T 160 30 T 200 30",
              "M 0 30 Q 20 26 40 30 T 80 30 T 120 30 T 160 30 T 200 30",
            ],
          }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
        />
      </svg>
    </div>
  );
}

function DirectorOutput({ tint }: { tint: string }) {
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

function LoraOutput({ tint }: { tint: string }) {
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
          animate={{
            y: [0, -4, 0],
            scale: [1, 1.05, 1],
          }}
          transition={{
            duration: 2.4,
            delay: i * 0.3,
            repeat: Infinity,
            ease: "easeInOut",
          }}
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

function OutputPreview({ mode }: { mode: Mode }) {
  switch (mode.id) {
    case "image":
      return <ImageOutput tint={mode.tint} />;
    case "video":
      return <VideoOutput tint={mode.tint} />;
    case "music":
      return <MusicOutput tint={mode.tint} />;
    case "voice":
      return <VoiceOutput tint={mode.tint} />;
    case "director":
      return <DirectorOutput tint={mode.tint} />;
    case "lora":
      return <LoraOutput tint={mode.tint} />;
  }
}

interface GenerativeShowcaseProps {
  textPrimary: string;
  textMuted: string;
  cardBg: string;
  cardBorder: string;
  featureBg: string;
  btnPrimary: string;
  btnPrimaryText: string;
  isDark: boolean;
}

export default function GenerativeShowcase({
  textPrimary,
  textMuted,
  cardBg,
  cardBorder,
  featureBg,
  btnPrimary,
  btnPrimaryText,
  isDark,
}: GenerativeShowcaseProps) {
  const [, navigate] = useLocation();
  const [activeId, setActiveId] = useState<ModeId>("image");
  const [autoplay, setAutoplay] = useState(true);
  const isMobile = useIsMobile();
  const reduce = useReducedMotion();
  const intervalRef = useRef<number | null>(null);

  const activeMode = useMemo(
    () => MODES.find(m => m.id === activeId) ?? MODES[0],
    [activeId]
  );

  const typed = useTypewriter(activeMode.prompt, 32, reduce ?? false);

  useEffect(() => {
    if (!autoplay || reduce) return;
    intervalRef.current = window.setInterval(() => {
      setActiveId(curr => {
        const idx = MODES.findIndex(m => m.id === curr);
        return MODES[(idx + 1) % MODES.length].id;
      });
    }, 6000);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [autoplay, reduce]);

  const handleSelect = (id: ModeId) => {
    setAutoplay(false);
    setActiveId(id);
  };

  return (
    <section className="px-4 sm:px-6 py-14 sm:py-20 lg:py-24 relative z-10">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-8 sm:mb-12"
        >
          <PhaseLabel num="02" tint={activeMode.tint} label="光球開始創造" />
          <h2
            className={`text-2xl sm:text-4xl md:text-5xl font-semibold leading-tight tracking-tight transition-colors duration-1000 ${textPrimary}`}
          >
            這網站能幫你
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
            className={`mt-3 sm:mt-5 text-sm sm:text-base max-w-xl mx-auto leading-relaxed transition-colors duration-1000 ${textMuted}`}
          >
            選一個能力，看光球如何把一句話變成圖、影、音、模型 — 點下方標籤切換，或讓它自動播放。
          </p>
        </motion.div>

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
          <motion.div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(ellipse at 50% 0%, ${activeMode.glow} 0%, transparent 55%)`,
              opacity: 0.35,
            }}
            animate={{ opacity: [0.25, 0.45, 0.25] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          />

          <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-3 sm:gap-4 lg:gap-6 items-stretch">
            <div
              className="rounded-2xl p-3 sm:p-4 lg:p-5 min-h-[120px] sm:min-h-[140px] flex flex-col justify-between"
              style={{
                background: featureBg,
                border: `1px solid ${cardBorder}`,
              }}
            >
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="text-[10px] tracking-[0.2em] uppercase font-medium"
                    style={{ color: activeMode.tint }}
                  >
                    輸入提示詞
                  </span>
                  <motion.span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: activeMode.tint }}
                    animate={{ opacity: [1, 0.2, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                  />
                </div>
                <p
                  className={`text-xs sm:text-sm lg:text-base leading-relaxed font-mono transition-colors duration-1000 ${textPrimary}`}
                  style={{ minHeight: "3.5em" }}
                >
                  {typed}
                  <motion.span
                    className="inline-block w-[2px] ml-0.5 align-middle"
                    style={{
                      background: activeMode.tint,
                      height: "1em",
                    }}
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 0.9, repeat: Infinity }}
                  />
                </p>
              </div>
              <div
                className={`mt-3 text-[10px] sm:text-xs ${textMuted}`}
              >
                {activeMode.meta}
              </div>
            </div>

            <div className="relative flex items-center justify-center min-h-[100px] lg:min-h-[180px]">
              <ParticleStream tint={activeMode.tint} />
              <div className="relative w-16 h-16 sm:w-20 sm:h-20 lg:w-24 lg:h-24">
                <motion.div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: `radial-gradient(circle, ${activeMode.glow} 0%, transparent 70%)`,
                  }}
                  animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0.8, 0.5] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.div
                  className="absolute inset-2 rounded-full"
                  style={{
                    background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.95) 0%, ${activeMode.tint} 40%, ${activeMode.glow} 70%, transparent 100%)`,
                    boxShadow: `0 0 40px ${activeMode.glow}, inset 0 0 20px rgba(255,255,255,0.6)`,
                  }}
                  animate={{
                    rotate: reduce ? 0 : 360,
                    scale: [1, 1.05, 1],
                  }}
                  transition={{
                    rotate: { duration: 18, repeat: Infinity, ease: "linear" },
                    scale: { duration: 3, repeat: Infinity, ease: "easeInOut" },
                  }}
                />
                {!reduce &&
                  [0, 1, 2].map(i => (
                    <motion.div
                      key={i}
                      className="absolute inset-0 rounded-full pointer-events-none"
                      style={{ border: `1px solid ${activeMode.tint}` }}
                      animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
                      transition={{
                        duration: 2.4,
                        delay: i * 0.8,
                        repeat: Infinity,
                        ease: "easeOut",
                      }}
                    />
                  ))}
              </div>
            </div>

            <div
              className="rounded-2xl relative overflow-hidden min-h-[140px] sm:min-h-[180px] lg:min-h-[220px]"
              style={{
                background: featureBg,
                border: `1px solid ${cardBorder}`,
              }}
            >
              <div className="absolute top-2 left-3 z-10 flex items-center gap-2">
                <span
                  className="text-[10px] tracking-[0.2em] uppercase font-medium"
                  style={{ color: activeMode.tint }}
                >
                  生成預覽
                </span>
                <motion.span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: activeMode.tint }}
                  animate={{ scale: [1, 1.4, 1] }}
                  transition={{ duration: 1.0, repeat: Infinity }}
                />
              </div>
              <div className="absolute inset-0 pt-7">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeMode.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.4 }}
                    className="w-full h-full"
                  >
                    <OutputPreview mode={activeMode} />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>

          <div className="relative mt-5 sm:mt-6 flex flex-wrap justify-center gap-2 sm:gap-2.5">
            {MODES.map(mode => {
              const Icon = mode.icon;
              const isActive = mode.id === activeMode.id;
              return (
                <motion.button
                  key={mode.id}
                  type="button"
                  onClick={() => handleSelect(mode.id)}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.96 }}
                  className={`relative inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-medium transition-all duration-300`}
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
                </motion.button>
              );
            })}
          </div>

          <div className="relative mt-5 sm:mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
            <motion.button
              type="button"
              onClick={() => navigate(activeMode.route)}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              className={`group relative inline-flex items-center justify-center gap-2 rounded-2xl h-11 sm:h-12 px-6 sm:px-8 text-sm font-medium overflow-hidden btn-healing w-full sm:w-auto ${btnPrimary} ${btnPrimaryText}`}
              style={{
                boxShadow: `0 8px 28px ${activeMode.glow}`,
              }}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out"
                style={{
                  background:
                    "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.22) 50%, transparent 70%)",
                }}
              />
              <Sparkles className="w-4 h-4" />
              進入「{activeMode.label}」工作室
              <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
            </motion.button>
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("orb-open-capabilities"))
              }
              className={`text-xs sm:text-sm underline-offset-4 hover:underline transition-colors duration-1000 ${textMuted}`}
            >
              或讓光球幫你決定
            </button>
          </div>
        </motion.div>

        {!isMobile && (
          <div
            className={`mt-4 text-center text-[10px] tracking-[0.2em] uppercase ${textMuted}`}
          >
            {autoplay ? "自動播放中 · 點擊任一標籤暫停" : "已暫停 · 重新整理可重啟"}
          </div>
        )}
      </div>
    </section>
  );
}
