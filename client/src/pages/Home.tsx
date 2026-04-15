import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl, getDemoLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { GlassCard } from "@/components/ZenCoPilot";
import VisualSoul from "@/components/VisualSoul";
import OnboardingFlow from "@/components/OnboardingFlow";
import { motion, AnimatePresence, useScroll, useTransform, useMotionValueEvent } from "framer-motion";
import {
  Wand2, Clapperboard, Package, Cpu, ArrowRight, Sparkles, Shield, Users,
  Moon, Sun, Coffee, Waves, Play, Pause, Volume2, VolumeX,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { useAIState } from "@/contexts/AIStateContext";
import { AmbientEnvironment, useCurrentScene } from "@/components/AmbientEnvironment";
import type { SceneId } from "@/components/AmbientEnvironment";
import SceneSwitcher from "@/components/SceneSwitcher";
import { useAmbientSound, SoundControl } from "@/components/AmbientSoundEngine";
import OarsGreeting from "@/components/OarsGreeting";
import { AmbientVideo } from "@/components/AmbientVideo";
import { useSenseEngine } from "@/hooks/useSenseEngine";
import { useIntentInference } from "@/hooks/useIntentInference";
import VisualSoulInvitation from "@/components/VisualSoulInvitation";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import Autoplay from "embla-carousel-autoplay";

// ─── Heavy components: lazy load to reduce initial bundle ───────────────────
const IntelBentoGrid = lazy(() => import("@/components/IntelBentoGrid"));
const ShowcaseMasonry = lazy(() => import("@/components/ShowcaseMasonry"));

// ─── Scene-Adaptive Style Maps ──────────────────────────────────────────────

const SCENE_STYLES: Record<SceneId, {
  navBg: string;
  navBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  cardBg: string;
  cardBorder: string;
  btnPrimary: string;
  btnPrimaryText: string;
  btnOutline: string;
  btnOutlineText: string;
  featureBg: string;
  footerBorder: string;
  icon: typeof Moon;
  greeting: string;
}> = {
  nightSky: {
    navBg: "rgba(10,12,35,0.7)",
    navBorder: "rgba(100,120,200,0.15)",
    textPrimary: "text-white",
    textSecondary: "text-slate-300",
    textMuted: "text-slate-400",
    cardBg: "rgba(20,25,60,0.45)",
    cardBorder: "rgba(100,120,200,0.12)",
    btnPrimary: "bg-indigo-500 hover:bg-indigo-400",
    btnPrimaryText: "text-white",
    btnOutline: "border-slate-500/40 hover:bg-slate-700/30",
    btnOutlineText: "text-slate-200",
    featureBg: "rgba(80,90,160,0.12)",
    footerBorder: "rgba(100,120,200,0.1)",
    icon: Moon,
    greeting: "夜深了，讓靈感在星空下綻放",
  },
  morning: {
    navBg: "rgba(255,235,215,0.75)",
    navBorder: "rgba(200,160,120,0.2)",
    textPrimary: "text-amber-950",
    textSecondary: "text-amber-800",
    textMuted: "text-amber-700/70",
    cardBg: "rgba(255,245,235,0.5)",
    cardBorder: "rgba(220,180,140,0.2)",
    btnPrimary: "bg-amber-600 hover:bg-amber-500",
    btnPrimaryText: "text-white",
    btnOutline: "border-amber-400/40 hover:bg-amber-100/30",
    btnOutlineText: "text-amber-800",
    featureBg: "rgba(255,200,140,0.15)",
    footerBorder: "rgba(200,160,120,0.15)",
    icon: Sun,
    greeting: "早安，用晨光喚醒你的創造力",
  },
  cafe: {
    navBg: "rgba(235,220,200,0.75)",
    navBorder: "rgba(180,150,120,0.2)",
    textPrimary: "text-stone-900",
    textSecondary: "text-stone-700",
    textMuted: "text-stone-500",
    cardBg: "rgba(245,235,220,0.5)",
    cardBorder: "rgba(200,180,150,0.2)",
    btnPrimary: "bg-stone-700 hover:bg-stone-600",
    btnPrimaryText: "text-white",
    btnOutline: "border-stone-400/40 hover:bg-stone-200/30",
    btnOutlineText: "text-stone-700",
    featureBg: "rgba(200,180,150,0.12)",
    footerBorder: "rgba(180,150,120,0.15)",
    icon: Coffee,
    greeting: "午後時光，來杯咖啡配靈感",
  },
  deepSea: {
    navBg: "rgba(5,25,50,0.7)",
    navBorder: "rgba(60,140,180,0.15)",
    textPrimary: "text-cyan-50",
    textSecondary: "text-cyan-200",
    textMuted: "text-cyan-300/70",
    cardBg: "rgba(10,40,70,0.45)",
    cardBorder: "rgba(60,140,180,0.12)",
    btnPrimary: "bg-cyan-600 hover:bg-cyan-500",
    btnPrimaryText: "text-white",
    btnOutline: "border-cyan-500/40 hover:bg-cyan-800/30",
    btnOutlineText: "text-cyan-200",
    featureBg: "rgba(60,140,180,0.12)",
    footerBorder: "rgba(60,140,180,0.1)",
    icon: Waves,
    greeting: "傍晚了，潛入深海尋找靈感珍珠",
  },
};

// ─── Video Demo Showcase Data ────────────────────────────────────────────

const VIDEO_DEMOS = [
  {
    id: "text-to-image",
    icon: Wand2,
    title: "AI 圖片生成",
    description: "從文字描述生成高品質圖片",
    tag: "圖片",
    color: "rgba(168,85,247,0.15)",
    borderColor: "rgba(168,85,247,0.25)",
    accentColor: "rgb(168,85,247)",
  },
  {
    id: "text-to-video",
    icon: Clapperboard,
    title: "AI 影片創作",
    description: "文字 → 影片，一鍵生成動態內容",
    tag: "影片",
    color: "rgba(59,130,246,0.15)",
    borderColor: "rgba(59,130,246,0.25)",
    accentColor: "rgb(59,130,246)",
  },
  {
    id: "text-to-music",
    icon: Sparkles,
    title: "AI 音樂生成",
    description: "描述風格即可生成原創音樂",
    tag: "音樂",
    color: "rgba(236,72,153,0.15)",
    borderColor: "rgba(236,72,153,0.25)",
    accentColor: "rgb(236,72,153)",
  },
  {
    id: "director-ai",
    icon: Cpu,
    title: "導演 AI 編排",
    description: "自動編排多媒體腳本，一鍵組合創意",
    tag: "導演",
    color: "rgba(34,197,94,0.15)",
    borderColor: "rgba(34,197,94,0.25)",
    accentColor: "rgb(34,197,94)",
  },
  {
    id: "voice-clone",
    icon: Users,
    title: "語音克隆",
    description: "上傳樣本即可克隆語音風格",
    tag: "語音",
    color: "rgba(249,115,22,0.15)",
    borderColor: "rgba(249,115,22,0.25)",
    accentColor: "rgb(249,115,22)",
  },
  {
    id: "lora-training",
    icon: Shield,
    title: "角色訓練 LoRA",
    description: "訓練專屬角色模型，保持風格一致性",
    tag: "訓練",
    color: "rgba(14,165,233,0.15)",
    borderColor: "rgba(14,165,233,0.25)",
    accentColor: "rgb(14,165,233)",
  },
];

// ─── Personality display labels (linked to personal settings) ────────────────

const PERSONALITY_LABELS: Record<string, { label: string; color: string }> = {
  calm: { label: "沉穩模式", color: "rgba(30,64,175,0.6)" },
  creative: { label: "創意模式", color: "rgba(255,80,180,0.6)" },
  technical: { label: "技術模式", color: "rgba(80,255,180,0.6)" },
};

/** Default personality color when personality key is unknown */
const DEFAULT_PERSONALITY_COLOR = "rgba(255,80,180,0.6)";

/** Get personality color with fallback */
function getPersonalityColor(personality: string): string {
  return PERSONALITY_LABELS[personality]?.color ?? DEFAULT_PERSONALITY_COLOR;
}

// ─── Carousel Dot Indicator ─────────────────────────────────────────────────

function CarouselDots({
  count,
  current,
  onSelect,
  isDark,
}: {
  count: number;
  current: number;
  onSelect: (idx: number) => void;
  isDark: boolean;
}) {
  return (
    <div className="flex items-center justify-center gap-2.5 mt-10">
      {Array.from({ length: count }).map((_, i) => (
        <motion.button
          key={i}
          onClick={() => onSelect(i)}
          className={`rounded-full transition-all duration-700 ${
            i === current
              ? isDark
                ? "bg-white/50"
                : "bg-black/25"
              : isDark
              ? "bg-white/12 hover:bg-white/20"
              : "bg-black/6 hover:bg-black/12"
          }`}
          animate={{
            width: i === current ? 28 : 8,
            height: 8,
          }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          aria-label={`Go to slide ${i + 1}`}
        />
      ))}
    </div>
  );
}

// ─── Scene Badge ────────────────────────────────────────────────────────────

function SceneBadge({ sceneId, isDark }: { sceneId: SceneId; isDark: boolean }) {
  const style = SCENE_STYLES[sceneId];
  const Icon = style.icon;
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={sceneId}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.4 }}
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium backdrop-blur-md ${
          isDark ? "bg-white/10 text-white/80" : "bg-black/5 text-black/60"
        }`}
      >
        <Icon className="w-3 h-3" />
        {style.greeting}
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Scroll Indicator ───────────────────────────────────────────────────────

function ScrollIndicator({ isDark }: { isDark: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 2.0, duration: 1.0 }}
      className="flex flex-col items-center gap-3 mt-16"
    >
      <span className={`text-[10px] tracking-[0.2em] uppercase ${isDark ? "text-white/25" : "text-black/20"}`}>
        向下探索
      </span>
      <motion.div
        animate={{ y: [0, 8, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      >
        <svg
          width="16"
          height="28"
          viewBox="0 0 16 28"
          fill="none"
          className={isDark ? "text-white/20" : "text-black/15"}
        >
          <rect x="1" y="1" width="14" height="26" rx="7" stroke="currentColor" strokeWidth="1" />
          <motion.circle
            cx="8"
            cy="8"
            r="2"
            fill="currentColor"
            animate={{ cy: [8, 18, 8] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          />
        </svg>
      </motion.div>
    </motion.div>
  );
}

// ─── Home Page ──────────────────────────────────────────────────────────────

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const { personality } = useAIState();
  const [, navigate] = useLocation();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { sceneId, isDark, override, setOverride, allScenes } = useCurrentScene();
  const s = useMemo(() => SCENE_STYLES[sceneId], [sceneId]);
  const soundControls = useAmbientSound(sceneId);

  // ─── Feature Carousel State ─────────────────────────────────────
  const [featureApi, setFeatureApi] = useState<CarouselApi>();
  const [featureCurrent, setFeatureCurrent] = useState(0);
  const featureAutoplay = useMemo(
    () => Autoplay({ delay: 4000, stopOnInteraction: true, stopOnMouseEnter: true }),
    [],
  );

  useEffect(() => {
    if (!featureApi) return;
    const onSelect = () => setFeatureCurrent(featureApi.selectedScrollSnap());
    featureApi.on("select", onSelect);
    onSelect();
    return () => { featureApi.off("select", onSelect); };
  }, [featureApi]);

  const featureScrollTo = useCallback(
    (idx: number) => featureApi?.scrollTo(idx),
    [featureApi],
  );

  // ─── Sense Engine + Intent Inference ─────────────────────────────
  const senseEngine = useSenseEngine({ enabled: true });
  const { result: intentResult, isInferring: isIntentInferring } = useIntentInference(senseEngine, {
    minEvents: 5,
    minSessionMs: 30_000,
    maxInferences: 3,
    cooldownMs: 60_000,
  });

  // ─── Scrollytelling: useScroll + useTransform ─────────────────────
  // heroRef marks the Hero section. As user scrolls past it,
  // the ambient background (video + particles) fades to 0 opacity,
  // elegantly handing visual focus to the content sections below.
  const heroRef = useRef<HTMLElement>(null);

  // Use window scroll instead of target ref to avoid hydration issues
  // when onboarding early-return unmounts the ref before useScroll resolves.
  const { scrollY } = useScroll();

  // Map window scrollY to a 0–1 progress based on viewport height
  const ambientOpacity = useTransform(scrollY, [0, 300, 800], [1, 1, 0]);

  // Hero content parallax: subtle upward drift as user scrolls
  const heroY = useTransform(scrollY, [0, 800], [0, -80]);
  const heroContentOpacity = useTransform(scrollY, [0, 400, 700], [1, 0.8, 0]);

  // Nav background intensifies as ambient fades (more opaque for readability)
  const navOpacityBoost = useTransform(scrollY, [300, 800], [0, 0.3]);

  // Track scroll state for conditional rendering optimizations
  const [isAmbientVisible, setIsAmbientVisible] = useState(true);
  useMotionValueEvent(ambientOpacity, "change", (latest) => {
    setIsAmbientVisible(latest > 0.01);
  });

  // Check if user needs onboarding
  useEffect(() => {
    if (isAuthenticated && !loading) {
      const onboarded = localStorage.getItem("ai-director-onboarded");
      if (!onboarded) {
        setShowOnboarding(true);
      }
    }
  }, [isAuthenticated, loading]);

  if (showOnboarding && isAuthenticated) {
    return (
      <OnboardingFlow
        onComplete={() => { setShowOnboarding(false); navigate("/studio"); }}
        onSkip={() => { setShowOnboarding(false); navigate("/studio"); }}
      />
    );
  }

  return (
    <div className="min-h-screen relative overflow-x-hidden flex flex-col">
      {/* ── Full-page gradient background (covers entire scroll height) ── */}
      <div
        className="fixed inset-0 w-full h-full -z-20 pointer-events-none"
        style={{
          background: isDark
            ? "linear-gradient(180deg, rgba(10,12,35,0.95) 0%, rgba(15,20,50,0.9) 40%, rgba(10,12,35,0.95) 100%)"
            : "linear-gradient(180deg, rgba(255,235,210,0.6) 0%, rgba(255,245,230,0.4) 30%, rgba(255,250,240,0.3) 60%, rgba(255,245,235,0.5) 100%)",
          transition: "background 0.7s ease",
        }}
        aria-hidden="true"
      />
      {/* ── Full-screen Ambient Background (Video + Particles) ── */}
      {/* Opacity driven by scroll position via Framer Motion useTransform */}
      <motion.div
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{ opacity: ambientOpacity }}
        // Performance: skip rendering when fully transparent
        aria-hidden="true"
      >
        {isAmbientVisible && (
          <>
            <AmbientVideo
              src=""
              overlayOpacity={0.35}
              fadeInDuration={1200}
            />
            <AmbientEnvironment />
          </>
        )}
      </motion.div>

      {/* ── Navigation — healing glass nav ── */}
      <motion.nav
        className="fixed top-0 left-0 right-0 z-50 h-16 transition-all duration-700"
        style={{
          background: s.navBg,
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          borderBottom: `1px solid ${s.navBorder}`,
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <VisualSoul size="sm" personality={personality} />
            <span className={`font-semibold tracking-tight transition-colors duration-700 ${s.textPrimary}`}>
              AI Director
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex items-center gap-2">
              <SceneSwitcher
                currentScene={sceneId}
                override={override}
                allScenes={allScenes}
                onSelect={setOverride}
                isDark={isDark}
              />
              <SoundControl controls={soundControls} isDark={isDark} />
            </div>
            {isAuthenticated ? (
              <Button
                onClick={() => navigate("/studio")}
                className={`rounded-2xl gap-1.5 text-sm h-10 px-4 sm:px-6 btn-healing ${s.btnPrimary} ${s.btnPrimaryText}`}
              >
                <span className="hidden sm:inline">進入工作室</span>
                <span className="sm:hidden">工作室</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button
                onClick={() => { window.location.href = getLoginUrl(); }}
                className={`rounded-2xl text-sm h-10 px-4 sm:px-6 btn-healing ${s.btnPrimary} ${s.btnPrimaryText}`}
              >
                登入
              </Button>
            )}
          </div>
        </div>
      </motion.nav>

      {/* ── Hero Section (Scrollytelling anchor) — healing breathing space ── */}
      <motion.section
        ref={heroRef}
        className="pt-28 sm:pt-40 pb-24 sm:pb-32 px-4 sm:px-6 relative z-10 min-h-[90vh] flex items-center"
        style={{ y: heroY }}
      >
        <motion.div
          className="max-w-4xl mx-auto text-center w-full"
          style={{ opacity: heroContentOpacity }}
        >
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.0, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Scene Badge */}
            <motion.div
              className="flex justify-center mb-10"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <SceneBadge sceneId={sceneId} isDark={isDark} />
            </motion.div>

            {/* Central Orb — larger, more ethereal, connected to personal settings */}
            <div className="flex flex-col items-center mb-12">
              {/* Ambient glow ring behind orb — soft, scene-linked */}
              <motion.div
                className="absolute w-48 h-48 sm:w-64 sm:h-64 rounded-full pointer-events-none"
                style={{
                  background: `radial-gradient(circle, ${getPersonalityColor(personality)} 0%, transparent 70%)`,
                }}
                animate={{
                  scale: [1, 1.15, 1],
                  opacity: [0.3, 0.5, 0.3],
                }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              />
              {/* Orb glow aura — scene-linked ambient ring */}
              <motion.div
                className="relative"
                animate={{
                  filter: [
                    `drop-shadow(0 0 30px ${getPersonalityColor(personality)})`,
                    `drop-shadow(0 0 50px ${getPersonalityColor(personality)})`,
                    `drop-shadow(0 0 30px ${getPersonalityColor(personality)})`,
                  ],
                }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              >
                <VisualSoul size="xl" personality={personality} />
              </motion.div>
              {/* Personality indicator — connected to personal settings */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={personality}
                  initial={{ opacity: 0, y: 8, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.9 }}
                  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  className={`mt-5 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[10px] tracking-wider backdrop-blur-md ${
                    isDark ? "bg-white/8 text-white/50" : "bg-black/4 text-black/40"
                  }`}
                >
                  <motion.div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: PERSONALITY_LABELS[personality]?.color }}
                    animate={{ scale: [1, 1.4, 1], opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  />
                  {PERSONALITY_LABELS[personality]?.label ?? "創意模式"}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* OARS Contextual Greeting — replaces static title */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              <OarsGreeting
                sceneId={sceneId}
                textPrimary={`transition-colors duration-700 heading-healing ${s.textPrimary}`}
                textMuted={`transition-colors duration-700 body-healing ${s.textMuted}`}
              />
            </motion.div>

            <motion.div
              className="mt-14 flex items-center justify-center gap-4"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              {isAuthenticated ? (
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <Button
                    size="lg"
                    onClick={() => navigate("/studio")}
                    className={`rounded-2xl h-12 px-6 sm:px-8 gap-2 text-sm shadow-lg hover:shadow-xl btn-healing w-full sm:w-auto ${s.btnPrimary} ${s.btnPrimaryText}`}
                  >
                    <Sparkles className="w-4 h-4" />
                    開始創作
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => navigate("/director")}
                    className={`rounded-2xl h-12 px-6 sm:px-8 gap-2 text-sm btn-healing w-full sm:w-auto ${s.btnOutline} ${s.btnOutlineText}`}
                  >
                    <Clapperboard className="w-4 h-4" />
                    導演 AI
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    size="lg"
                    onClick={() => { window.location.href = getLoginUrl(); }}
                    className={`rounded-2xl h-12 px-6 sm:px-10 gap-2 text-sm shadow-lg hover:shadow-xl btn-healing ${s.btnPrimary} ${s.btnPrimaryText}`}
                  >
                    立即開始
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => { window.location.href = getDemoLoginUrl(); }}
                    className={`rounded-2xl h-12 px-6 sm:px-8 gap-2 text-sm border-dashed btn-healing ${s.btnOutline} ${s.btnOutlineText}`}
                  >
                    ✨ 訪客體驗
                  </Button>
                </div>
              )}
            </motion.div>

            {/* Scroll indicator — gentle invitation */}
            <ScrollIndicator isDark={isDark} />
          </motion.div>
        </motion.div>
      </motion.section>

      {/* ── Soft gradient divider between Hero and Features ── */}
      <div
        className="relative z-10 h-px mx-auto max-w-3xl"
        style={{
          background: `linear-gradient(90deg, transparent, ${isDark ? "rgba(100,120,200,0.12)" : "rgba(212,197,226,0.25)"}, transparent)`,
        }}
      />

      {/* ── Video Demo Showcase (影片功能展示區域) — healing carousel ── */}
      <section className="section-breathing px-4 sm:px-6 relative z-10">
        <div className="max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="text-center mb-14"
          >
            <h2 className={`text-2xl sm:text-3xl heading-healing transition-colors duration-700 ${s.textPrimary}`}>
              功能展示
            </h2>
            <p className={`mt-5 text-sm max-w-md mx-auto body-healing transition-colors duration-700 ${s.textMuted}`}>
              體驗 AI Director 的核心創作能力
            </p>
            {/* Healing divider */}
            <div className="mx-auto mt-8 w-16 h-[1px] rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${isDark ? "rgba(100,120,200,0.3)" : "rgba(212,197,226,0.5)"}, transparent)` }} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <Carousel
              setApi={setFeatureApi}
              plugins={[featureAutoplay]}
              opts={{ align: "start", loop: true }}
              className="w-full carousel-fade-edge"
            >
              <CarouselContent className="-ml-5">
                {VIDEO_DEMOS.map((demo) => (
                  <CarouselItem key={demo.id} className="pl-5 basis-full sm:basis-1/2 lg:basis-1/3">
                    <motion.div
                      whileHover={{ y: -4 }}
                      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <div
                        className="group h-full rounded-2xl overflow-hidden card-healing cursor-pointer"
                        style={{
                          background: s.cardBg,
                          border: `1px solid ${s.cardBorder}`,
                        }}
                        onClick={() => navigate(isAuthenticated ? "/studio" : "/")}
                      >
                        {/* Preview area with play overlay */}
                        <div
                          className="relative aspect-[16/10] flex items-center justify-center overflow-hidden"
                          style={{ background: demo.color }}
                        >
                          {/* Animated gradient — gentle breathing */}
                          <motion.div
                            className="absolute inset-0"
                            style={{
                              background: `radial-gradient(circle at 30% 40%, ${demo.accentColor}18 0%, transparent 60%), radial-gradient(circle at 70% 60%, ${demo.accentColor}0d 0%, transparent 50%)`,
                            }}
                            animate={{ opacity: [0.4, 0.75, 0.4] }}
                            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
                          />
                          {/* Center icon + play */}
                          <div className="relative z-10 flex flex-col items-center gap-4">
                            <motion.div
                              className="w-16 h-16 rounded-2xl flex items-center justify-center"
                              style={{ background: `${demo.accentColor}20`, border: `1px solid ${demo.accentColor}20`, backdropFilter: "blur(12px)" }}
                              whileHover={{ scale: 1.06 }}
                              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                            >
                              <demo.icon className="w-7 h-7" style={{ color: demo.accentColor }} />
                            </motion.div>
                            <motion.div
                              className="w-10 h-10 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-700"
                              style={{ background: `${demo.accentColor}12`, border: `1px solid ${demo.accentColor}18`, backdropFilter: "blur(12px)" }}
                            >
                              <Play className="w-4 h-4 ml-0.5" style={{ color: demo.accentColor }} />
                            </motion.div>
                          </div>
                          {/* Tag badge */}
                          <div
                            className="absolute top-3.5 left-3.5 px-3 py-1 rounded-full text-[10px] font-medium tracking-wide"
                            style={{ background: `${demo.accentColor}12`, color: demo.accentColor, border: `1px solid ${demo.accentColor}18`, backdropFilter: "blur(12px)" }}
                          >
                            {demo.tag}
                          </div>
                        </div>
                        {/* Text content — healing spacing */}
                        <div className="px-5 py-5 sm:px-6 sm:py-6">
                          <h3 className={`text-sm font-semibold mb-2.5 transition-colors duration-700 ${s.textPrimary}`}>
                            {demo.title}
                          </h3>
                          <p className={`text-xs leading-relaxed body-healing transition-colors duration-700 ${s.textMuted}`}>
                            {demo.description}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  </CarouselItem>
                ))}
              </CarouselContent>
            </Carousel>
            <CarouselDots
              count={VIDEO_DEMOS.length}
              current={featureCurrent}
              onSelect={featureScrollTo}
              isDark={isDark}
            />
          </motion.div>
        </div>
      </section>

      {/* ── Intent Inference Whisper (意圖推論低語) ── */}
      {intentResult && intentResult.confidence > 0.4 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="py-6 px-4 relative z-10"
        >
          <div className="max-w-2xl mx-auto">
            <div
              className="rounded-2xl px-6 py-5 backdrop-blur-md transition-all duration-700"
              style={{
                background: s.cardBg,
                border: `1px solid ${s.cardBorder}`,
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: s.featureBg }}
                >
                  <Sparkles className={`w-4 h-4 transition-colors duration-700 ${s.textSecondary}`} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium transition-colors duration-700 ${s.textSecondary}`}>
                      {intentResult.intentLabel}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full transition-colors duration-700 ${s.textMuted}`}
                      style={{ background: s.featureBg }}
                    >
                      {Math.round(intentResult.confidence * 100)}% 信心度
                    </span>
                  </div>
                  <p className={`text-sm leading-relaxed transition-colors duration-700 ${s.textPrimary}`}>
                    {intentResult.psychologicalInsight}
                  </p>
                  <p className={`text-xs mt-2 transition-colors duration-700 ${s.textMuted}`}>
                    {intentResult.actionDetail}
                  </p>
                  {intentResult.detectedAesthetics.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {intentResult.detectedAesthetics.map((tag) => (
                        <span
                          key={tag}
                          className={`text-[10px] px-2 py-0.5 rounded-full transition-colors duration-700 ${s.textMuted}`}
                          style={{ background: s.featureBg }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Intel Bento Grid (情報站) ── */}
      <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>}>
        <IntelBentoGrid sceneId={sceneId} />
      </Suspense>

      {/* ── Showcase Masonry (精選作品瀑布流) ── */}
      <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" /></div>}>
        <ShowcaseMasonry
        sceneId={sceneId}
        aestheticOverride={
          intentResult &&
          intentResult.confidence > 0.5 &&
          intentResult.intentType === "aesthetic_preference" &&
          intentResult.detectedAesthetics.length > 0
            ? intentResult.detectedAesthetics
            : null
        }
      />
      </Suspense>

      {/* ── Soft gradient divider before CTA ── */}
      <div
        className="relative z-10 h-px mx-auto max-w-3xl"
        style={{
          background: `linear-gradient(90deg, transparent, ${isDark ? "rgba(100,120,200,0.12)" : "rgba(212,197,226,0.25)"}, transparent)`,
        }}
      />

      {/* ── CTA Section — healing invitation ── */}
      <section className="section-breathing px-4 sm:px-6 relative z-10">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <div
              className="relative text-center py-14 sm:py-20 px-6 sm:px-12 rounded-3xl card-healing overflow-hidden"
              style={{
                background: s.cardBg,
                border: `1px solid ${s.cardBorder}`,
              }}
            >
              {/* Subtle ambient glow behind CTA */}
              <motion.div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: `radial-gradient(ellipse at 50% 30%, ${getPersonalityColor(personality)} 0%, transparent 60%)`,
                }}
                animate={{ opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              />
              <div className="relative z-10">
                <div className="flex flex-col items-center">
                  <motion.div
                    animate={{
                      filter: [
                        `drop-shadow(0 0 20px ${getPersonalityColor(personality)})`,
                        `drop-shadow(0 0 40px ${getPersonalityColor(personality)})`,
                        `drop-shadow(0 0 20px ${getPersonalityColor(personality)})`,
                      ],
                    }}
                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <VisualSoul size="lg" personality={personality} />
                  </motion.div>
                </div>
                <h2 className={`text-2xl heading-healing mt-10 transition-colors duration-700 ${s.textPrimary}`}>
                  準備好開始創作了嗎？
                </h2>
                <p className={`mt-5 text-sm max-w-md mx-auto body-healing transition-colors duration-700 ${s.textMuted}`}>
                  登入後即可使用所有功能，每位使用者享有初始免費配額
                </p>
                <div className="mt-12">
                  {isAuthenticated ? (
                    <Button
                      size="lg"
                      onClick={() => navigate("/studio")}
                      className={`rounded-2xl h-12 px-10 gap-2 text-sm btn-healing ${s.btnPrimary} ${s.btnPrimaryText}`}
                    >
                      進入工作室
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      onClick={() => { window.location.href = getLoginUrl(); }}
                      className={`rounded-2xl h-12 px-10 gap-2 text-sm btn-healing ${s.btnPrimary} ${s.btnPrimaryText}`}
                    >
                      免費開始
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── VisualSoul Invitation (光球行動與邀約) ── */}
      <VisualSoulInvitation
        sceneId={sceneId}
        personality={personality}
        intentResult={intentResult}
        isInferring={isIntentInferring}
      />

      {/* ── Footer — healing minimal ── */}
      <footer
        className="py-12 sm:py-14 px-4 sm:px-6 transition-colors duration-700 relative z-10 mt-auto"
      >
        {/* Breathing divider line */}
        <div
          className="max-w-4xl mx-auto mb-10 h-px"
          style={{
            background: `linear-gradient(90deg, transparent, ${s.footerBorder}, transparent)`,
          }}
        />
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <VisualSoul size="sm" personality={personality} />
            <span className={`transition-colors duration-700 tracking-wide ${s.textMuted}`}>AI Director</span>
          </div>
          <span className={`transition-colors duration-700 tracking-wide ${s.textMuted}`}>
            Healing Creative Platform
          </span>
        </div>
      </footer>
    </div>
  );
}
