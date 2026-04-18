import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  lazy,
  Suspense,
} from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl, getDemoLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { GlassCard } from "@/components/ZenCoPilot";
import VisualSoul from "@/components/VisualSoul";
const OnboardingFlow = lazy(() => import("@/components/OnboardingFlow"));
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  useMotionValueEvent,
} from "framer-motion";
import {
  Wand2,
  Clapperboard,
  Package,
  Cpu,
  ArrowRight,
  Sparkles,
  Shield,
  Users,
  Moon,
  Sun,
  Coffee,
  Waves,
  Play,
  Pause,
  Volume2,
  VolumeX,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useAIState } from "@/contexts/AIStateContext";
import { AmbientEnvironment } from "@/components/AmbientEnvironment";
import type { SceneId } from "@/components/AmbientEnvironment";
import SceneSwitcher from "@/components/SceneSwitcher";
import { SoundControl } from "@/components/AmbientSoundEngine";
import { useAmbient } from "@/contexts/AmbientSoundContext";
import OarsGreeting from "@/components/OarsGreeting";
import { AmbientVideo } from "@/components/AmbientVideo";
import { useSenseEngine } from "@/hooks/useSenseEngine";
import { useIntentInference } from "@/hooks/useIntentInference";
import VisualSoulInvitation from "@/components/VisualSoulInvitation";
import FeatureDetailDialog, {
  type FeatureDetail,
} from "@/components/FeatureDetailDialog";

// ─── Heavy components: lazy load to reduce initial bundle ───────────────────
const IntelBentoGrid = lazy(() => import("@/components/IntelBentoGrid"));
const ShowcaseMasonry = lazy(() => import("@/components/ShowcaseMasonry"));

// ─── Scene-Adaptive Style Maps ──────────────────────────────────────────────

const SCENE_STYLES: Record<
  SceneId,
  {
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
    /** Scene-matched glow color for orb auras */
    glowColor: string;
    /** Scene-adaptive divider color (replaces hardcoded lavender/indigo) */
    dividerColor: string;
    /** Scene-adaptive full-page gradient background */
    pageBg: string;
  }
> = {
  nightSky: {
    navBg: "rgba(10,12,35,0.7)",
    navBorder: "rgba(100,120,200,0.15)",
    textPrimary: "text-white",
    textSecondary: "text-slate-300",
    textMuted: "text-slate-400",
    cardBg: "rgba(20,25,60,0.45)",
    cardBorder: "rgba(100,120,200,0.12)",
    btnPrimary: "bg-indigo-600 hover:bg-indigo-500 hover:shadow-lg",
    btnPrimaryText: "text-white",
    btnOutline: "border-slate-500/40 hover:bg-slate-700/30 hover:shadow-md",
    btnOutlineText: "text-slate-200",
    featureBg: "rgba(80,90,160,0.12)",
    footerBorder: "rgba(100,120,200,0.1)",
    icon: Moon,
    greeting: "夜深了，讓靈感在星空下綻放",
    glowColor: "rgba(100,120,220,0.45)",
    dividerColor: "rgba(100,120,200,0.18)",
    pageBg:
      "linear-gradient(180deg, rgba(10,12,35,0.95) 0%, rgba(15,20,50,0.9) 40%, rgba(10,12,35,0.95) 100%)",
  },
  morning: {
    navBg: "rgba(255,235,215,0.75)",
    navBorder: "rgba(200,160,120,0.2)",
    textPrimary: "text-amber-950",
    textSecondary: "text-amber-800",
    textMuted: "text-amber-700/70",
    cardBg: "rgba(255,245,235,0.5)",
    cardBorder: "rgba(220,180,140,0.2)",
    btnPrimary: "bg-amber-700 hover:bg-amber-600 hover:shadow-lg",
    btnPrimaryText: "text-white",
    btnOutline: "border-amber-400/40 hover:bg-amber-100/30 hover:shadow-md",
    btnOutlineText: "text-amber-800",
    featureBg: "rgba(255,200,140,0.15)",
    footerBorder: "rgba(200,160,120,0.15)",
    icon: Sun,
    greeting: "早安，用晨光喚醒你的創造力",
    glowColor: "rgba(240,180,100,0.4)",
    dividerColor: "rgba(210,170,120,0.25)",
    pageBg:
      "linear-gradient(180deg, rgba(255,235,210,0.6) 0%, rgba(255,245,230,0.4) 30%, rgba(255,250,240,0.3) 60%, rgba(255,245,235,0.5) 100%)",
  },
  cafe: {
    navBg: "rgba(235,220,200,0.75)",
    navBorder: "rgba(180,150,120,0.2)",
    textPrimary: "text-stone-900",
    textSecondary: "text-stone-700",
    textMuted: "text-stone-500",
    cardBg: "rgba(245,235,220,0.5)",
    cardBorder: "rgba(200,180,150,0.2)",
    btnPrimary: "bg-stone-800 hover:bg-stone-700 hover:shadow-lg",
    btnPrimaryText: "text-white",
    btnOutline: "border-stone-400/40 hover:bg-stone-200/30 hover:shadow-md",
    btnOutlineText: "text-stone-700",
    featureBg: "rgba(200,180,150,0.12)",
    footerBorder: "rgba(180,150,120,0.15)",
    icon: Coffee,
    greeting: "午後時光，來杯咖啡配靈感",
    glowColor: "rgba(200,175,140,0.4)",
    dividerColor: "rgba(180,150,120,0.2)",
    pageBg:
      "linear-gradient(180deg, rgba(235,220,200,0.6) 0%, rgba(245,235,220,0.4) 30%, rgba(250,245,235,0.3) 60%, rgba(245,235,220,0.5) 100%)",
  },
  deepSea: {
    navBg: "rgba(5,25,50,0.7)",
    navBorder: "rgba(60,140,180,0.15)",
    textPrimary: "text-cyan-50",
    textSecondary: "text-cyan-200",
    textMuted: "text-cyan-300/70",
    cardBg: "rgba(10,40,70,0.45)",
    cardBorder: "rgba(60,140,180,0.12)",
    btnPrimary: "bg-cyan-700 hover:bg-cyan-600 hover:shadow-lg",
    btnPrimaryText: "text-white",
    btnOutline: "border-cyan-500/40 hover:bg-cyan-800/30 hover:shadow-md",
    btnOutlineText: "text-cyan-200",
    featureBg: "rgba(60,140,180,0.12)",
    footerBorder: "rgba(60,140,180,0.1)",
    icon: Waves,
    greeting: "傍晚了，潛入深海尋找靈感珍珠",
    glowColor: "rgba(60,160,200,0.4)",
    dividerColor: "rgba(60,140,180,0.18)",
    pageBg:
      "linear-gradient(180deg, rgba(5,20,45,0.95) 0%, rgba(8,30,60,0.9) 40%, rgba(5,20,45,0.95) 100%)",
  },
};

// ─── Video Demo Showcase Data ────────────────────────────────────────────

const VIDEO_DEMOS: FeatureDetail[] = [
  {
    id: "text-to-image",
    icon: Wand2,
    title: "AI 圖片生成",
    description:
      "輸入文字描述，即刻生成高品質影像。支援多種風格與精準的參數調校。",
    longDescription:
      "從一段描述出發，快速產出可商用等級的影像。內建多種美學預設與細節調校，讓你在分鐘內完成從概念到視覺成品的跳躍。",
    features: [
      "多風格預設：寫實 / 插畫 / 電影感 / 日系",
      "精準參數：光影、構圖、色調、鏡頭語言",
      "高解析輸出：支援 2K / 4K 放大",
      "風格參考：上傳 reference 自動擷取氛圍",
    ],
    tag: "圖片",
    color: "rgba(168,85,247,0.10)",
    borderColor: "rgba(168,85,247,0.20)",
    accentColor: "rgb(168,85,247)",
  },
  {
    id: "text-to-video",
    icon: Clapperboard,
    title: "AI 影片創作",
    description: "從文字一鍵生成流暢動態影片，適用於短片、動畫與創意敘事。",
    longDescription:
      "自動化從腳本到成片的全流程。鏡頭運動、轉場節奏、角色一致性都幫你處理好，你只需要專注在敘事本身。",
    features: [
      "鏡頭運動自動編排：推拉搖移一鍵套用",
      "多尺寸輸出：9:16 / 16:9 / 1:1 同步生成",
      "角色一致性：跨鏡頭維持同一人物樣貌",
      "音畫同步：自動對齊配樂節奏",
    ],
    tag: "影片",
    color: "rgba(59,130,246,0.10)",
    borderColor: "rgba(59,130,246,0.20)",
    accentColor: "rgb(59,130,246)",
  },
  {
    id: "text-to-music",
    icon: Sparkles,
    title: "AI 音樂生成",
    description:
      "描述曲風情境，自動產生原創配樂。從電子氛圍到古典管弦皆可駕馭。",
    longDescription:
      "說出你想要的情緒、節奏與樂器，AI 會產出可直接使用的原創配樂。支援多段落結構與情緒轉折，適合 podcast、短影音、廣告。",
    features: [
      "情境式 prompt：「冷冽、雨夜、慢板鋼琴」",
      "多樂器編制：電子、管弦、民謠、氛圍",
      "段落結構：前奏 / 主歌 / 副歌可分段生成",
      "商用授權：所有輸出可直接發佈",
    ],
    tag: "音樂",
    color: "rgba(236,72,153,0.10)",
    borderColor: "rgba(236,72,153,0.20)",
    accentColor: "rgb(236,72,153)",
  },
  {
    id: "director-ai",
    icon: Cpu,
    title: "導演 AI 編排",
    description:
      "智慧腳本分析與多媒體編排，自動拆解段落並生成對應的圖、影、音。",
    longDescription:
      "把一份腳本丟進來，導演 AI 會幫你拆解場景、分配鏡頭、挑選配樂，並呼叫對應的生成引擎組合出完整作品。",
    features: [
      "腳本自動分鏡：段落 → 場景 → shot list",
      "跨模態編排：圖、影、音、字幕一次到位",
      "節奏調校：自動對齊時間軸與敘事張力",
      "一鍵重跑：單一場景可獨立重新生成",
    ],
    tag: "導演",
    color: "rgba(34,197,94,0.10)",
    borderColor: "rgba(34,197,94,0.20)",
    accentColor: "rgb(34,197,94)",
  },
  {
    id: "voice-clone",
    icon: Users,
    title: "語音克隆",
    description: "上傳語音樣本，精確複製說話風格與音色，適用於配音與旁白製作。",
    longDescription:
      "只需 30 秒的聲音樣本，即可建立專屬語音模型。支援多語言、多情緒演繹，適合 podcast、旁白、有聲書與角色配音。",
    features: [
      "低樣本建模：30 秒樣本即可開始",
      "多語言輸出：中英日韓自然切換",
      "情緒控制：平靜、激昂、溫柔、嚴肅",
      "倫理保護：需本人授權 + 浮水印追溯",
    ],
    tag: "語音",
    color: "rgba(249,115,22,0.10)",
    borderColor: "rgba(249,115,22,0.20)",
    accentColor: "rgb(249,115,22)",
  },
  {
    id: "lora-training",
    icon: Shield,
    title: "角色訓練 LoRA",
    description: "訓練專屬角色模型，確保跨作品的視覺風格一致性與角色辨識度。",
    longDescription:
      "為你的 IP 角色或個人風格訓練專屬 LoRA 模型，在後續所有生成任務中保持一致的視覺特徵，不再為「角色又不像」煩惱。",
    features: [
      "少量樣本訓練：10–20 張即可開始",
      "跨媒介一致：圖、影、3D 全部通用",
      "版本管理：可保留多個風格 checkpoint",
      "私有部署：訓練資料不外流",
    ],
    tag: "訓練",
    color: "rgba(14,165,233,0.10)",
    borderColor: "rgba(14,165,233,0.20)",
    accentColor: "rgb(14,165,233)",
  },
];

// ─── Scene Badge ────────────────────────────────────────────────────────────

function SceneBadge({
  sceneId,
  isDark,
}: {
  sceneId: SceneId;
  isDark: boolean;
}) {
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
      className="flex flex-col items-center gap-2 sm:gap-3 mt-12 sm:mt-16"
    >
      <span
        className={`text-[10px] tracking-[0.2em] uppercase ${isDark ? "text-white/25" : "text-black/20"}`}
      >
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
          <rect
            x="1"
            y="1"
            width="14"
            height="26"
            rx="7"
            stroke="currentColor"
            strokeWidth="1"
          />
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
  const ambient = useAmbient();
  const { sceneId, isDark, override, setOverride, allScenes } = ambient;
  const s = useMemo(() => SCENE_STYLES[sceneId], [sceneId]);

  // ─── Feature Detail Dialog State ─────────────────────────────────
  const [activeFeature, setActiveFeature] = useState<FeatureDetail | null>(
    null
  );
  const [featureDialogOpen, setFeatureDialogOpen] = useState(false);

  const openFeature = useCallback((feature: FeatureDetail) => {
    setActiveFeature(feature);
    setFeatureDialogOpen(true);
  }, []);

  // ─── Sense Engine + Intent Inference ─────────────────────────────
  const senseEngine = useSenseEngine({ enabled: true });
  const { result: intentResult, isInferring: isIntentInferring } =
    useIntentInference(senseEngine, {
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
  useMotionValueEvent(ambientOpacity, "change", latest => {
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
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center">
            <VisualSoul state="thinking" />
          </div>
        }
      >
        <OnboardingFlow
          onComplete={() => {
            setShowOnboarding(false);
            navigate("/studio");
          }}
          onSkip={() => {
            setShowOnboarding(false);
            navigate("/studio");
          }}
        />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen relative overflow-x-hidden flex flex-col">
      {/* ── Full-page gradient background (scene-adaptive, covers entire scroll height) ── */}
      <div
        className="fixed inset-0 w-full h-full -z-20 pointer-events-none"
        style={{
          background: s.pageBg,
          transition: "background 1s ease",
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
            <AmbientVideo src="" overlayOpacity={0.35} fadeInDuration={1200} />
            <AmbientEnvironment forceScene={sceneId} />
          </>
        )}
      </motion.div>

      {/* ── Navigation — healing glass nav ── */}
      <motion.nav
        className="fixed top-0 left-0 right-0 z-50 h-16 transition-all duration-1000"
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
            <span
              className={`font-semibold tracking-tight transition-colors duration-1000 ${s.textPrimary}`}
            >
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
              <SoundControl controls={ambient} isDark={isDark} />
            </div>
            <div className="flex sm:hidden">
              <SoundControl controls={ambient} isDark={isDark} compact />
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
                onClick={() => {
                  window.location.href = getLoginUrl();
                }}
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
        className="pt-24 sm:pt-36 lg:pt-44 pb-20 sm:pb-28 lg:pb-36 px-4 sm:px-6 relative z-10 min-h-[85vh] sm:min-h-[90vh] flex items-center"
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
              className="flex justify-center mb-8 sm:mb-10"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.8,
                delay: 0.2,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <SceneBadge sceneId={sceneId} isDark={isDark} />
            </motion.div>

            {/* Central Orb — ethereal, scene-adaptive glow */}
            <div className="flex flex-col items-center mb-8 sm:mb-12">
              {/* Ambient glow ring behind orb — soft, scene-linked, smaller on mobile */}
              <motion.div
                className="absolute w-32 h-32 sm:w-48 sm:h-48 lg:w-56 lg:h-56 rounded-full pointer-events-none"
                style={{
                  background: `radial-gradient(circle, ${s.glowColor} 0%, transparent 70%)`,
                }}
                animate={{
                  scale: [1, 1.08, 1],
                  opacity: [0.25, 0.4, 0.25],
                }}
                transition={{
                  duration: 8,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
              {/* Orb with subtle scene-matched aura */}
              <motion.div
                className="relative"
                animate={{
                  filter: [
                    `drop-shadow(0 0 16px ${s.glowColor})`,
                    `drop-shadow(0 0 28px ${s.glowColor})`,
                    `drop-shadow(0 0 16px ${s.glowColor})`,
                  ],
                }}
                transition={{
                  duration: 6,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              >
                <VisualSoul
                  size="md"
                  personality={personality}
                  className="sm:!w-16 sm:!h-16"
                />
              </motion.div>
            </div>

            {/* OARS Contextual Greeting — replaces static title */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.8,
                delay: 0.4,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <OarsGreeting
                sceneId={sceneId}
                textPrimary={`transition-colors duration-1000 heading-healing ${s.textPrimary}`}
                textMuted={`transition-colors duration-1000 body-healing ${s.textMuted}`}
              />
            </motion.div>

            <motion.div
              className="mt-10 sm:mt-14 flex items-center justify-center gap-4"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.7,
                delay: 0.6,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              {isAuthenticated ? (
                <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto px-4 sm:px-0">
                  <Button
                    size="lg"
                    onClick={() => navigate("/studio")}
                    className={`rounded-2xl h-11 sm:h-12 px-6 sm:px-8 gap-2 text-sm shadow-lg hover:shadow-xl btn-healing w-full sm:w-auto ${s.btnPrimary} ${s.btnPrimaryText}`}
                  >
                    <Sparkles className="w-4 h-4" />
                    開始創作
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => navigate("/director")}
                    className={`rounded-2xl h-11 sm:h-12 px-6 sm:px-8 gap-2 text-sm btn-healing w-full sm:w-auto ${s.btnOutline} ${s.btnOutlineText}`}
                  >
                    <Clapperboard className="w-4 h-4" />
                    導演 AI
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto px-4 sm:px-0">
                  <Button
                    size="lg"
                    onClick={() => {
                      window.location.href = getLoginUrl();
                    }}
                    className={`rounded-2xl h-11 sm:h-12 px-6 sm:px-10 gap-2 text-sm shadow-lg hover:shadow-xl btn-healing ${s.btnPrimary} ${s.btnPrimaryText}`}
                  >
                    立即開始
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => {
                      window.location.href = getDemoLoginUrl();
                    }}
                    className={`rounded-2xl h-11 sm:h-12 px-6 sm:px-8 gap-2 text-sm border-dashed btn-healing ${s.btnOutline} ${s.btnOutlineText}`}
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
          background: `linear-gradient(90deg, transparent, ${s.dividerColor}, transparent)`,
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
            className="text-center mb-16"
          >
            <motion.div
              className={`inline-flex items-center gap-2 px-3 sm:px-4 py-1 sm:py-1.5 rounded-full text-[9px] sm:text-[10px] tracking-[0.15em] uppercase mb-5 sm:mb-6 ${
                isDark ? "bg-white/6 text-white/40" : "bg-black/3 text-black/30"
              }`}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              <Package className="w-3 h-3" />
              Core Capabilities
            </motion.div>
            <h2
              className={`hs-h2 !mb-0 transition-colors duration-1000 ${s.textPrimary}`}
            >
              多模態 AI 創作引擎
            </h2>
            <p
              className={`mt-4 sm:mt-5 hs-p !mb-0 max-w-lg mx-auto transition-colors duration-1000 ${s.textMuted}`}
            >
              從圖片、影片到音樂與配音，一站式覆蓋你的所有創作需求
            </p>
            {/* Healing divider */}
            <div
              className="mx-auto mt-8 w-16 h-[1px] rounded-full"
              style={{
                background: `linear-gradient(90deg, transparent, ${s.dividerColor}, transparent)`,
              }}
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6"
          >
            {VIDEO_DEMOS.map((demo, idx) => (
              <motion.button
                key={demo.id}
                type="button"
                onClick={() => openFeature(demo)}
                aria-label={`查看 ${demo.title} 詳情`}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{
                  duration: 0.6,
                  delay: idx * 0.06,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="group relative text-left h-full rounded-2xl overflow-hidden card-feature-refined focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={
                  {
                    background: s.cardBg,
                    border: `1px solid ${s.cardBorder}`,
                    ["--accent" as any]: demo.accentColor,
                  } as React.CSSProperties
                }
              >
                {/* Preview area */}
                <div
                  className="relative aspect-[16/10] flex items-center justify-center overflow-hidden"
                  style={{ background: demo.color }}
                >
                  <motion.div
                    className="absolute inset-0"
                    style={{
                      background: `radial-gradient(circle at 30% 30%, ${demo.accentColor}18 0%, transparent 55%), radial-gradient(circle at 70% 70%, ${demo.accentColor}0c 0%, transparent 55%)`,
                    }}
                    animate={{ opacity: [0.45, 0.85, 0.45] }}
                    transition={{
                      duration: 6 + idx * 0.5,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                  {/* Sheen sweep on hover */}
                  <div
                    className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-[1400ms] ease-out"
                    style={{
                      background: `linear-gradient(115deg, transparent 30%, ${demo.accentColor}18 50%, transparent 70%)`,
                    }}
                  />
                  {/* Center icon */}
                  <div className="relative z-10 flex flex-col items-center gap-3">
                    <motion.div
                      className="w-14 h-14 rounded-xl flex items-center justify-center transition-transform duration-500 group-hover:scale-110 group-hover:rotate-2"
                      style={{
                        background: `${demo.accentColor}18`,
                        border: `1px solid ${demo.accentColor}22`,
                        backdropFilter: "blur(16px)",
                      }}
                    >
                      <demo.icon
                        className="w-6 h-6"
                        style={{ color: demo.accentColor }}
                      />
                    </motion.div>
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                      style={{
                        background: `${demo.accentColor}12`,
                        border: `1px solid ${demo.accentColor}20`,
                        backdropFilter: "blur(12px)",
                      }}
                    >
                      <Play
                        className="w-3.5 h-3.5 ml-0.5"
                        style={{ color: demo.accentColor }}
                      />
                    </div>
                  </div>
                  {/* Tag badge */}
                  <div
                    className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full text-[9px] font-medium tracking-wider uppercase"
                    style={{
                      background: `${demo.accentColor}12`,
                      color: demo.accentColor,
                      border: `1px solid ${demo.accentColor}20`,
                      backdropFilter: "blur(12px)",
                    }}
                  >
                    {demo.tag}
                  </div>
                </div>
                {/* Text content */}
                <div className="px-5 py-5 sm:px-6 sm:py-6">
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="w-1 h-4 rounded-full"
                      style={{ background: `${demo.accentColor}55` }}
                    />
                    <h3
                      className={`hs-h3 !mb-0 transition-colors duration-1000 ${s.textPrimary}`}
                    >
                      {demo.title}
                    </h3>
                  </div>
                  <p
                    className={`hs-small !mb-0 leading-relaxed transition-colors duration-1000 ${s.textMuted}`}
                  >
                    {demo.description}
                  </p>
                  {/* Dual CTA footer */}
                  <div
                    className={`mt-4 pt-4 flex items-center justify-between gap-2 border-t ${
                      isDark ? "border-white/8" : "border-black/5"
                    }`}
                  >
                    <span
                      className={`text-[11px] tracking-wide flex items-center gap-1 ${s.textMuted}`}
                    >
                      查看詳情
                      <ArrowRight className="w-3 h-3 transition-transform duration-500 group-hover:translate-x-0.5" />
                    </span>
                    <span
                      onClick={e => {
                        e.stopPropagation();
                        if (!isAuthenticated) {
                          window.location.href = getLoginUrl();
                        } else {
                          navigate(demo.ctaHref ?? "/studio");
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!isAuthenticated) {
                            window.location.href = getLoginUrl();
                          } else {
                            navigate(demo.ctaHref ?? "/studio");
                          }
                        }
                      }}
                      className="text-[11px] font-medium px-2.5 py-1 rounded-full flex items-center gap-1 transition-all hover:shadow-md cursor-pointer"
                      style={{
                        background: `${demo.accentColor}18`,
                        color: demo.accentColor,
                        border: `1px solid ${demo.accentColor}30`,
                      }}
                    >
                      <Play className="w-2.5 h-2.5 fill-current" />
                      試用
                    </span>
                  </div>
                </div>
              </motion.button>
            ))}
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
              className="rounded-2xl px-6 py-5 backdrop-blur-md transition-all duration-1000"
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
                  <Sparkles
                    className={`w-4 h-4 transition-colors duration-1000 ${s.textSecondary}`}
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-xs font-medium transition-colors duration-1000 ${s.textSecondary}`}
                    >
                      {intentResult.intentLabel}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full transition-colors duration-1000 ${s.textMuted}`}
                      style={{ background: s.featureBg }}
                    >
                      {Math.round(intentResult.confidence * 100)}% 信心度
                    </span>
                  </div>
                  <p
                    className={`hs-p !mb-0 leading-relaxed transition-colors duration-1000 ${s.textPrimary}`}
                  >
                    {intentResult.psychologicalInsight}
                  </p>
                  <p
                    className={`hs-small !mb-0 mt-2 transition-colors duration-1000 ${s.textMuted}`}
                  >
                    {intentResult.actionDetail}
                  </p>
                  {intentResult.detectedAesthetics.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {intentResult.detectedAesthetics.map(tag => (
                        <span
                          key={tag}
                          className={`text-[10px] px-2 py-0.5 rounded-full transition-colors duration-1000 ${s.textMuted}`}
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
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        }
      >
        <IntelBentoGrid sceneId={sceneId} />
      </Suspense>

      {/* ── Showcase Masonry (精選作品瀑布流) ── */}
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        }
      >
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
          background: `linear-gradient(90deg, transparent, ${s.dividerColor}, transparent)`,
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
              className="relative text-center py-12 sm:py-16 lg:py-24 px-5 sm:px-8 lg:px-12 rounded-2xl sm:rounded-3xl card-healing overflow-hidden"
              style={{
                background: s.cardBg,
                border: `1px solid ${s.cardBorder}`,
              }}
            >
              {/* Subtle ambient glow — scene-adaptive, no orb */}
              <motion.div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: `radial-gradient(ellipse at 50% 0%, ${s.glowColor} 0%, transparent 55%)`,
                }}
                animate={{ opacity: [0.2, 0.35, 0.2] }}
                transition={{
                  duration: 8,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
              {/* Decorative top accent line */}
              <div
                className="absolute top-0 left-1/2 -translate-x-1/2 h-[1px] w-1/2 rounded-full"
                style={{
                  background: `linear-gradient(90deg, transparent, ${s.glowColor}, transparent)`,
                }}
              />
              <div className="relative z-10">
                <motion.div
                  className={`inline-flex items-center gap-2 px-3 sm:px-4 py-1 sm:py-1.5 rounded-full text-[9px] sm:text-[10px] tracking-[0.15em] uppercase mb-6 sm:mb-8 ${
                    isDark
                      ? "bg-white/6 text-white/40"
                      : "bg-black/3 text-black/30"
                  }`}
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                >
                  <Sparkles className="w-3 h-3" />
                  Healing Studio
                </motion.div>
                <h2
                  className={`hs-h2 !mb-0 transition-colors duration-1000 ${s.textPrimary}`}
                >
                  準備好開始創作了嗎？
                </h2>
                <p
                  className={`mt-4 sm:mt-5 hs-p !mb-0 max-w-lg mx-auto transition-colors duration-1000 ${s.textMuted}`}
                >
                  登入後即可使用所有功能，每位使用者享有初始免費配額
                </p>
                {/* Healing divider */}
                <div
                  className="mx-auto mt-6 sm:mt-8 mb-8 sm:mb-10 w-12 h-[1px] rounded-full"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${s.dividerColor}, transparent)`,
                  }}
                />
                <div>
                  {isAuthenticated ? (
                    <Button
                      size="lg"
                      onClick={() => navigate("/studio")}
                      className={`rounded-2xl h-11 sm:h-12 px-8 sm:px-10 gap-2 text-sm btn-healing ${s.btnPrimary} ${s.btnPrimaryText}`}
                    >
                      進入工作室
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      onClick={() => {
                        window.location.href = getLoginUrl();
                      }}
                      className={`rounded-2xl h-11 sm:h-12 px-8 sm:px-10 gap-2 text-sm btn-healing ${s.btnPrimary} ${s.btnPrimaryText}`}
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
      <footer className="py-10 sm:py-12 lg:py-14 px-4 sm:px-6 transition-colors duration-1000 relative z-10 mt-auto">
        {/* Breathing divider line */}
        <div
          className="max-w-4xl mx-auto mb-8 sm:mb-10 h-px"
          style={{
            background: `linear-gradient(90deg, transparent, ${s.footerBorder}, transparent)`,
          }}
        />
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-0 text-xs">
          <div className="flex items-center gap-3">
            <VisualSoul size="sm" personality={personality} />
            <span
              className={`transition-colors duration-1000 tracking-wide ${s.textMuted}`}
            >
              AI Director
            </span>
          </div>
          <span
            className={`transition-colors duration-1000 tracking-wide ${s.textMuted}`}
          >
            Healing Creative Platform
          </span>
        </div>
      </footer>

      <FeatureDetailDialog
        feature={activeFeature}
        open={featureDialogOpen}
        onOpenChange={setFeatureDialogOpen}
        isAuthenticated={isAuthenticated}
        isDark={isDark}
      />
    </div>
  );
}
