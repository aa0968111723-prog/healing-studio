import { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
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
  Moon, Sun, Coffee, Waves,
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

// ─── Features ───────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Wand2,
    title: "AI 智慧創作引擎",
    description: "圖片、影片、音樂、語音一站式 AI 生成，搭配專業提示詞編譯器",
  },
  {
    icon: Clapperboard,
    title: "導演 AI 雙引擎",
    description: "事實研究 + CO-STAR 創意編排，自動生成結構化多媒體腳本",
  },
  {
    icon: Cpu,
    title: "角色鍛造所",
    description: "多角度資料集訓練，確保跨場景角色一致性，支援 LoRA 權重控制",
  },
  {
    icon: Package,
    title: "數位資產庫",
    description: "團隊共享數位資產，標籤管理，分享獎勵配額機制",
  },
  {
    icon: Shield,
    title: "安全可靠",
    description: "RBAC 權限控制、內容安全預檢、S3 預簽名 URL 保護",
  },
  {
    icon: Users,
    title: "共享空間",
    description: "社群互動與種子庫，探索他人的創作靈感，分享你的作品獲得配額獎勵",
  },
];

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
      transition={{ delay: 1.5, duration: 0.8 }}
      className="flex flex-col items-center gap-2 mt-12"
    >
      <span className={`text-[10px] tracking-widest uppercase ${isDark ? "text-white/30" : "text-black/25"}`}>
        向下探索
      </span>
      <motion.div
        animate={{ y: [0, 6, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      >
        <svg
          width="16"
          height="24"
          viewBox="0 0 16 24"
          fill="none"
          className={isDark ? "text-white/25" : "text-black/20"}
        >
          <rect x="1" y="1" width="14" height="22" rx="7" stroke="currentColor" strokeWidth="1.5" />
          <motion.circle
            cx="8"
            cy="8"
            r="2"
            fill="currentColor"
            animate={{ cy: [7, 14, 7] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
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

      {/* ── Navigation ── */}
      <motion.nav
        className="fixed top-0 left-0 right-0 z-50 h-16 transition-colors duration-700"
        style={{
          background: s.navBg,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: `1px solid ${s.navBorder}`,
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 h-full flex items-center justify-between">
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
                className={`rounded-xl gap-1.5 text-sm h-10 px-4 sm:px-6 ${s.btnPrimary} ${s.btnPrimaryText}`}
              >
                <span className="hidden sm:inline">進入工作室</span>
                <span className="sm:hidden">工作室</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button
                onClick={() => { window.location.href = getLoginUrl(); }}
                className={`rounded-xl text-sm h-10 px-4 sm:px-6 ${s.btnPrimary} ${s.btnPrimaryText}`}
              >
                登入
              </Button>
            )}
          </div>
        </div>
      </motion.nav>

      {/* ── Hero Section (Scrollytelling anchor) ── */}
      <motion.section
        ref={heroRef}
        className="pt-24 sm:pt-32 pb-16 sm:pb-20 px-4 relative z-10 min-h-[85vh]"
        style={{ y: heroY }}
      >
        <motion.div
          className="max-w-4xl mx-auto text-center"
          style={{ opacity: heroContentOpacity }}
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            {/* Scene Badge */}
            <div className="flex justify-center mb-6">
              <SceneBadge sceneId={sceneId} isDark={isDark} />
            </div>

            {/* Central Orb */}
            <div className="flex justify-center mb-8">
              <VisualSoul size="lg" personality={personality} className="!w-20 !h-20" />
            </div>

            {/* OARS Contextual Greeting — replaces static title */}
            <OarsGreeting
              sceneId={sceneId}
              textPrimary={`transition-colors duration-700 ${s.textPrimary}`}
              textMuted={`transition-colors duration-700 ${s.textMuted}`}
            />

            <div className="mt-10 flex items-center justify-center gap-4">
              {isAuthenticated ? (
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <Button
                    size="lg"
                    onClick={() => navigate("/studio")}
                    className={`rounded-xl h-12 px-6 sm:px-8 gap-2 text-sm shadow-lg hover:shadow-xl transition-all w-full sm:w-auto ${s.btnPrimary} ${s.btnPrimaryText}`}
                  >
                    <Sparkles className="w-4 h-4" />
                    開始創作
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => navigate("/director")}
                    className={`rounded-xl h-12 px-6 sm:px-8 gap-2 text-sm transition-all w-full sm:w-auto ${s.btnOutline} ${s.btnOutlineText}`}
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
                    className={`rounded-xl h-12 px-6 sm:px-10 gap-2 text-sm shadow-lg hover:shadow-xl transition-all ${s.btnPrimary} ${s.btnPrimaryText}`}
                  >
                    立即開始
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => { window.location.href = getDemoLoginUrl(); }}
                    className={`rounded-xl h-12 px-6 sm:px-8 gap-2 text-sm border-dashed transition-all ${s.btnOutline} ${s.btnOutlineText}`}
                  >
                    ✨ 訪客體驗
                  </Button>
                </div>
              )}
            </div>

            {/* Scroll indicator — invites user to scroll down */}
            <ScrollIndicator isDark={isDark} />
          </motion.div>
        </motion.div>
      </motion.section>

      {/* ── Features Grid (情報站 — visual focus handoff target) ── */}
      <section className="py-14 sm:py-20 px-4 relative z-10">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
            className="text-center mb-14"
          >
            <h2 className={`text-2xl sm:text-3xl font-bold transition-colors duration-700 ${s.textPrimary}`}>
              專為創作者打造
            </h2>
            <p className={`mt-3 text-sm max-w-lg mx-auto transition-colors duration-700 ${s.textMuted}`}>
              從創意構思到成品輸出，完整覆蓋多媒體內容生產流程
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((feature, idx) => (
              <motion.div
                key={feature.title}
                initial={{ opacity: 0, y: 25 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.5, delay: idx * 0.08 }}
              >
                <div
                  className="h-full rounded-2xl p-6 backdrop-blur-md transition-all duration-700 hover:scale-[1.02]"
                  style={{
                    background: s.cardBg,
                    border: `1px solid ${s.cardBorder}`,
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                    style={{ background: s.featureBg }}
                  >
                    <feature.icon className={`w-5 h-5 transition-colors duration-700 ${s.textSecondary}`} />
                  </div>
                  <h3 className={`text-sm font-semibold mb-2 transition-colors duration-700 ${s.textPrimary}`}>
                    {feature.title}
                  </h3>
                  <p className={`text-xs leading-relaxed transition-colors duration-700 ${s.textMuted}`}>
                    {feature.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
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

      {/* ── CTA Section ── */}
      <section className="py-14 sm:py-20 px-4 relative z-10">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.6 }}
          >
            <div
              className="text-center py-10 sm:py-14 px-6 sm:px-8 rounded-3xl backdrop-blur-md transition-all duration-700"
              style={{
                background: s.cardBg,
                border: `1px solid ${s.cardBorder}`,
              }}
            >
              <VisualSoul size="md" personality={personality} />
              <h2 className={`text-2xl font-bold mt-6 transition-colors duration-700 ${s.textPrimary}`}>
                準備好開始創作了嗎？
              </h2>
              <p className={`mt-3 text-sm max-w-md mx-auto transition-colors duration-700 ${s.textMuted}`}>
                登入後即可使用所有功能，每位使用者享有初始免費配額
              </p>
              <div className="mt-8">
                {isAuthenticated ? (
                  <Button
                    size="lg"
                    onClick={() => navigate("/studio")}
                    className={`rounded-xl h-12 px-10 gap-2 text-sm ${s.btnPrimary} ${s.btnPrimaryText}`}
                  >
                    進入工作室
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    onClick={() => { window.location.href = getLoginUrl(); }}
                    className={`rounded-xl h-12 px-10 gap-2 text-sm ${s.btnPrimary} ${s.btnPrimaryText}`}
                  >
                    免費開始
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                )}
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

      {/* ── Footer ── */}
      <footer
        className="py-8 px-4 transition-colors duration-700 relative z-10 mt-auto"
        style={{ borderTop: `1px solid ${s.footerBorder}` }}
      >
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <VisualSoul size="sm" personality={personality} />
            <span className={`transition-colors duration-700 ${s.textMuted}`}>AI Director</span>
          </div>
          <span className={`transition-colors duration-700 ${s.textMuted}`}>
            Intelligent Creation Platform
          </span>
        </div>
      </footer>
    </div>
  );
}
