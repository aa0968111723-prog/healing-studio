import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  Suspense,
} from "react";
import { lazyWithRetry as lazy } from "@/lib/lazyWithRetry";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getLoginUrl, getDemoLoginUrl } from "@/const";
import { useLocation } from "wouter";
import { GlassCard } from "@/components/ZenCoPilot";
import VisualSoul from "@/components/VisualSoul";
const OnboardingFlow = lazy(() => import("@/components/OnboardingFlow"));
import { useSiteOnboarding } from "@/contexts/SiteOnboardingContext";
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  useMotionValueEvent,
  useReducedMotion,
} from "framer-motion";
import {
  ArrowRight,
  Sparkles,
  Moon,
  Sun,
  Coffee,
  Waves,
  Pause,
  Volume2,
  VolumeX,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Compass,
  Rocket,
  CircleCheck,
  MessageCircle,
  Gauge,
  Mic,
} from "lucide-react";
import { useAIState } from "@/contexts/AIStateContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";
import { AmbientEnvironment } from "@/components/AmbientEnvironment";
import type { SceneId } from "@/components/AmbientEnvironment";
import SceneSwitcher from "@/components/SceneSwitcher";
import {
  SoundControl,
  SCENE_SOUND_LABELS,
} from "@/components/AmbientSoundEngine";
import { useAmbient } from "@/contexts/AmbientSoundContext";
import OarsGreeting from "@/components/OarsGreeting";
import { AmbientVideo } from "@/components/AmbientVideo";
import { useSenseEngine } from "@/hooks/useSenseEngine";
import { useIntentInference } from "@/hooks/useIntentInference";
import { IntentOnboardingNudge } from "@/components/home/IntentOnboardingNudge";
import { LANDING_COSMIC_MOBILE_ENABLED, LANDING_AURORA_MOBILE_ENABLED } from "@/components/home/landingFlags";
import VisualSoulInvitation from "@/components/VisualSoulInvitation";
import OrbCreationStage from "@/components/home/OrbCreationStage";
import HeroMagneticSpotlight from "@/components/home/HeroMagneticSpotlight";
import { copyToClipboard } from "@/lib/clipboard";
import PointerAura from "@/components/home/PointerAura";
import MagneticTilt from "@/components/home/MagneticTilt";
import ShimmerDivider from "@/components/home/ShimmerDivider";
import PageRevealVeil from "@/components/home/PageRevealVeil";
import AuroraBlobs from "@/components/home/AuroraBlobs";
import GrainOverlay from "@/components/home/GrainOverlay";
import SceneVignette from "@/components/home/SceneVignette";
import CosmicBackdrop from "@/components/home/CosmicBackdrop";
import JewelOrbStage from "@/components/home/JewelOrbStage";
import ScrollProgressBar from "@/components/home/ScrollProgressBar";
import SectionShimmerSkeleton from "@/components/home/SectionShimmerSkeleton";
import { useIsMobile } from "@/hooks/useMobile";

// ─── Heavy components: lazy load to reduce initial bundle ───────────────────
const IntelBentoGrid = lazy(() => import("@/components/IntelBentoGrid"));
const ShowcaseMasonry = lazy(() => import("@/components/ShowcaseMasonry"));
const SHOW_BOTTOM_CTA = false;

// ─── Step 3: Creation Hub feature flags ─────────────────────────────────────
// 旗艦版景觀 / 行銷向 section 暫時隱藏（不刪除），讓首頁作為「創作中樞」呈現。
// 想要恢復舊版動畫劇場、情報站、瀑布流、行動邀約等只需把這些旗標打開即可，
// 對應的元件 import 都還保留在最上方。
const HOME_FEATURE_FLAGS = {
  /** 上方頂部 nav（場景切換 / 聲音 / 開始創作）。登入後 Dock 已負責導覽，
   *  這個 nav 在創作中樞情境下會重複，所以預設關閉。 */
  showLegacyTopNav: false,
  /** Scene badge greeting（夜深了…）。視覺裝飾，留作 future 使用。 */
  showSceneBadge: false,
  /** OARS 多段 hero 文案。已被「今天想創作什麼？」取代。 */
  showOarsGreeting: false,
  /** Hero 區下方的「進入創作作業系統」CTA。Phase 2c 起首頁瘦身成「動畫 +
   *  單 CTA」，CTA 內容由下方 hero block 渲染（一顆按鈕導到 /create）。 */
  showHeroCtaButtons: true,
  /** 「向下探索」滑鼠 icon。內容已縮短，不再需要。 */
  showScrollIndicator: false,
  /** 滾動驅動的 hero 視差（heroY / heroOrbScale / heroOrbDrift / nav opacity
   *  boost）。一旦回開行銷版面再打開。 */
  enableHeroScrollAnimations: false,
  /** OrbCreationStage：互動式創作劇場。占螢幕高，創作中樞模式下隱藏。 */
  showOrbCreationStage: false,
  /** Intent inference 低語卡。資訊量太密，先隱藏。 */
  showIntentWhisper: false,
  /** I-9 意圖個人化引導卡（AIDV-87）：依推論意圖給「下一步去哪」CTA。預設 OFF＝零行為改變。 */
  showIntentOnboarding: false,
  /** IntelBentoGrid（情報站）。 */
  showIntelBento: false,
  /** ShowcaseMasonry（精選作品瀑布流）。 */
  showShowcaseMasonry: false,
  /** VisualSoulInvitation（光球行動 + 邀約）。 */
  showVisualSoulInvitation: false,
  /** Footer 區塊。Dock 已涵蓋品牌資訊，創作中樞模式下不再需要重複。 */
  showLegacyFooter: false,
} as const;

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
    textSecondary: "text-slate-200",
    textMuted: "text-slate-200/90",
    cardBg: "rgba(20,25,60,0.45)",
    cardBorder: "rgba(100,120,200,0.12)",
    btnPrimary: "bg-indigo-600 hover:bg-indigo-500 hover:shadow-lg",
    btnPrimaryText: "text-white",
    btnOutline: "bg-slate-900/25 border-slate-500/50 hover:bg-slate-700/35 hover:shadow-md",
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
    textSecondary: "text-amber-900",
    textMuted: "text-amber-900/90",
    cardBg: "rgba(255,245,235,0.5)",
    cardBorder: "rgba(220,180,140,0.2)",
    btnPrimary: "bg-amber-700 hover:bg-amber-600 hover:shadow-lg",
    btnPrimaryText: "text-white",
    btnOutline: "bg-amber-50/70 border-amber-500/50 hover:bg-amber-100/80 hover:shadow-md",
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
    textSecondary: "text-stone-800",
    textMuted: "text-stone-700",
    cardBg: "rgba(245,235,220,0.5)",
    cardBorder: "rgba(200,180,150,0.2)",
    btnPrimary: "bg-stone-800 hover:bg-stone-700 hover:shadow-lg",
    btnPrimaryText: "text-white",
    btnOutline: "bg-stone-100/75 border-stone-500/50 hover:bg-stone-200/85 hover:shadow-md",
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
    textSecondary: "text-cyan-100",
    textMuted: "text-cyan-100/90",
    cardBg: "rgba(10,40,70,0.45)",
    cardBorder: "rgba(60,140,180,0.12)",
    btnPrimary: "bg-cyan-700 hover:bg-cyan-600 hover:shadow-lg",
    btnPrimaryText: "text-white",
    btnOutline: "bg-cyan-950/30 border-cyan-500/50 hover:bg-cyan-800/35 hover:shadow-md",
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

// Capability cards have moved into the global orb's "✨ 創作能力" view.
// Source data: client/src/data/creativeCapabilities.ts.
// SITE_USE_CASES + SITE_VALUE_HIGHLIGHTS were folded into OrbCreationStage so
// the global orb agent can dispatch every modality in a single panel.

const HOME_QUICKSTART_GUIDE = [
  {
    id: "new-user",
    title: "新手 3 分鐘起步",
    description: "先快速上手，再逐步深入，不需要一次看完全部功能。",
    icon: Rocket,
    items: [
      "先從「訪客體驗」或登入進入，使用預設範本快速出第一版。",
      "先選一個工作室（圖片 / 影片 / 導演 AI），避免多工分散。",
      "完成第一個作品後，再到模型與素材庫做細節優化。",
    ],
  },
  {
    id: "workflow",
    title: "推薦創作動線",
    description: "依照大多數使用者習慣設計，降低卡住機率。",
    icon: Compass,
    items: [
      "首頁選工具 → 生成草稿 → 版本比較 → 匯出發佈。",
      "若要角色一致性，先訓練模型再進入批次生成。",
      "用導演 AI 編排圖、影、音，可大幅縮短製作時間。",
    ],
  },
  {
    id: "quality",
    title: "品質與效率檢查",
    description: "每次輸出前做一次快速檢查，品質更穩定。",
    icon: CircleCheck,
    items: [
      "提示詞是否有主體、風格、構圖、光線四大元素。",
      "只調整 1 個參數重跑，方便比對結果差異。",
      "把可複用設定存入素材庫，避免每次重做。",
    ],
  },
] as const;

const HOME_ONBOARDING_MISSIONS = [
  {
    id: "mission-orb",
    title: "先和全站光球代理說目標",
    description: "輸入一句話需求，讓光球幫你決定從哪個工作室開始。",
    path: "/agent",
  },
  {
    id: "mission-first-draft",
    title: "做出第一個作品草稿",
    description: "到圖片或影片工作室用預設先產出第一版，再逐步微調。",
    path: "/image-studio",
  },
  {
    id: "mission-director",
    title: "用導演 AI 規劃完整流程",
    description: "把點子交給導演 AI，自動拆成圖、影、音可執行任務。",
    path: "/director",
  },
  {
    id: "mission-iterate",
    title: "到歷史頁做版本比較與迭代",
    description: "比對差異、保留最佳版本，建立可重複的創作節奏。",
    path: "/history",
  },
] as const;

const HOME_CREATIVE_TRACKS = [
  {
    id: "track-fast",
    title: "快速出稿",
    eta: "8-12 分鐘",
    summary: "先用光球代理選最短路徑，目標是今天就產出可分享版本。",
    recommendedPath: "/agent",
    orbPrompt: "我想在 10 分鐘內完成第一版，請帶我走最快路徑。",
  },
  {
    id: "track-brand",
    title: "品牌內容",
    eta: "20-30 分鐘",
    summary: "先定調性，再串接圖片、影片與配樂，快速做一套品牌內容。",
    recommendedPath: "/director",
    orbPrompt: "我要做品牌內容，請幫我規劃圖、影、音一致的工作流。",
  },
  {
    id: "track-learning",
    title: "先理解再操作",
    eta: "15-20 分鐘",
    summary: "先看範例與教學，再讓光球代理引導你做第一個任務。",
    recommendedPath: "/learn",
    orbPrompt: "我是新手，先給我最容易上手的教學，再帶我做第一個任務。",
  },
] as const;

const ORB_AGENT_LESSONS = [
  {
    id: "lesson-goal",
    title: "先說目標，不先選工具",
    description: "先告訴光球你要完成什麼（例如：做品牌短片、做商品主視覺）。",
    example: "幫我做一支 20 秒品牌形象短片，風格溫暖療癒。",
  },
  {
    id: "lesson-constraint",
    title: "補上限制條件",
    description: "加上時間、尺寸、語言、素材限制，光球會更精準帶路。",
    example: "今天要交件、9:16、繁中字幕、先用平台預設素材。",
  },
  {
    id: "lesson-next-step",
    title: "要求下一步與原因",
    description: "請光球說明先去哪一頁、為什麼，降低新手迷路風險。",
    example: "請直接告訴我第一步去哪個頁面，並解釋原因。",
  },
] as const;

const ORB_GUIDED_ONBOARDING_FLOW = [
  {
    id: "flow-agent",
    title: "Step 1：先開啟全站光球代理",
    description: "在光球說出你的目標，讓系統自動判斷先去哪個功能頁。",
  },
  {
    id: "flow-clarify",
    title: "Step 2：讓光球幫你定第一個可交付成果",
    description: "請光球先定義『今天要完成什麼』與『最短執行路徑』。",
  },
  {
    id: "flow-studio",
    title: "Step 3：由光球帶你進創作工作室",
    description: "依光球建議進入圖片/影片/導演工作室完成第一版作品。",
  },
] as const;

const ORB_BOOTCAMP_PLANS = [
  {
    id: "site-tour",
    title: "全站深度教學",
    description:
      "由光球代理帶你走完站內核心頁：Agent、Director、Studio、History、Assets。",
    prompt:
      "請啟動全站深度教學，依序帶我認識 Agent、Director、Studio、History、Assets，且每一步都告訴我目的與下一步。",
  },
  {
    id: "studio-setup",
    title: "建立創作工作室教學",
    description:
      "由光球代理帶你從 0 到 1 建立第一個可重複使用的創作工作室流程。",
    prompt:
      "請啟動建立創作工作室教學：先定義創作目標，再建立工作室流程與模板，最後帶我產出第一版並教我如何迭代。",
  },
] as const;

const IMAGE_STUDIO_TUTORIAL = [
  {
    id: "img-step-1",
    title: "設定創作目標",
    description: "先決定用途（廣告、貼文、封面）與輸出尺寸，避免重工。",
  },
  {
    id: "img-step-2",
    title: "請光球生成第一版提示詞",
    description: "把風格、主體、構圖、光線交給光球整理成可用 prompt。",
  },
  {
    id: "img-step-3",
    title: "進圖片創作室產出與迭代",
    description: "先出 2-4 張版本，比較後再微調單一參數。",
  },
] as const;

const VIDEO_STUDIO_TUTORIAL = [
  {
    id: "video-step-1",
    title: "定義影片目標與時長",
    description: "先決定用途（廣告/短影音/敘事）與秒數，讓分鏡更聚焦。",
  },
  {
    id: "video-step-2",
    title: "請光球輸出分鏡與影片 prompt",
    description: "請光球整理主題、鏡頭運動、轉場節奏與字幕語氣。",
  },
  {
    id: "video-step-3",
    title: "進影片工作室生成首版",
    description: "先生成 1-2 個版本，再調整單一參數做二次迭代。",
  },
] as const;

const MUSIC_VOICE_STUDIO_TUTORIAL = [
  {
    id: "audio-step-1",
    title: "定義音樂與配音目標",
    description: "先決定用途（影片配樂、旁白、角色配音）與情緒節奏。",
  },
  {
    id: "audio-step-2",
    title: "請光球生成音樂/配音指令",
    description: "請光球整理 BPM、樂器、語氣、語速、情緒與段落結構。",
  },
  {
    id: "audio-step-3",
    title: "進音樂與語音工作室產出首版",
    description: "先做一版配樂與一版配音，再同步微調情緒與節奏。",
  },
] as const;

const DIRECTOR_AI_TUTORIAL = [
  {
    id: "director-step-1",
    title: "輸入主題與目標成品",
    description: "先告訴導演 AI 你要做什麼內容與交付格式（短片/廣告/企劃）。",
  },
  {
    id: "director-step-2",
    title: "讓光球拆解成圖影音任務",
    description: "請光球把需求轉成分鏡、素材、配樂、旁白等可執行任務。",
  },
  {
    id: "director-step-3",
    title: "在導演 AI 工作室執行與迭代",
    description: "先跑一版流程，再針對單一段落重跑優化品質。",
  },
] as const;

const ALL_SUBPAGE_TUTORIALS = [
  {
    id: "learn-center",
    title: "學習文件中心",
    path: "/learn",
    prompt: "請教我學習文件中心怎麼快速找到新手到進階的學習路徑。",
    category: "Learning",
  },
  {
    id: "notes-planning",
    title: "規劃筆記",
    path: "/notes",
    prompt: "請教我如何用規劃筆記建立可執行的創作計畫與里程碑。",
    category: "Planning",
  },
  {
    id: "dashboard-insights",
    title: "數據洞察",
    path: "/dashboard",
    prompt: "請教我數據洞察頁怎麼看關鍵指標，並給我下一步優化建議。",
    category: "Insights",
  },
  {
    id: "studio",
    title: "創作總工作室",
    path: "/studio",
    prompt: "請帶我了解創作總工作室的主流程與各模組用途。",
    category: "Studio",
  },
  {
    id: "director",
    title: "導演 AI",
    path: "/director",
    prompt: "請教我導演 AI 的完整工作流，從需求拆解到輸出成品。",
    category: "Studio",
  },
  {
    id: "image-studio",
    title: "圖片工作室",
    path: "/image-studio",
    prompt: "請教我圖片工作室從 prompt 到迭代的完整流程。",
    category: "Studio",
  },
  {
    id: "video-studio",
    title: "影片工作室",
    path: "/video-studio",
    prompt: "請教我影片工作室從分鏡到輸出的完整流程。",
    category: "Studio",
  },
  {
    id: "pro-studio-all",
    title: "專業工作室",
    path: "/pro-studio",
    prompt: "請教我專業工作室的進階參數與模型搭配策略。",
    category: "Studio",
  },
  {
    id: "history-all",
    title: "歷史版本",
    path: "/history",
    prompt: "請教我在歷史版本頁做比較、回溯與迭代決策。",
    category: "Ops",
  },
  {
    id: "prompt-library-all",
    title: "提示詞庫",
    path: "/prompt-library",
    prompt: "請教我如何建立可重用提示詞庫與版本策略。",
    category: "Ops",
  },
  {
    id: "assets-all",
    title: "素材中心",
    path: "/assets",
    prompt: "請教我素材中心上傳、分類與複用最佳實務。",
    category: "Ops",
  },
  {
    id: "teaching-archive",
    title: "資料庫",
    path: "/teaching-archive",
    prompt: "請教我資料庫怎麼上傳 PDF、文件、圖片、影片、語音，並用光球搜尋既有內容。",
    category: "Ops",
  },
  {
    id: "shared-all",
    title: "共享素材",
    path: "/shared",
    prompt: "請教我共享素材與協作權限設定方式。",
    category: "Ops",
  },
  {
    id: "lora-all",
    title: "模型訓練",
    path: "/lora-trainer",
    prompt: "請教我模型訓練資料準備、訓練與驗證流程。",
    category: "Model",
  },
] as const;

const STATION_VISUAL_STEPS = [
  "1. 先懂這站在做什麼",
  "2. 完成一個實際操作",
  "3. 達成可驗收結果",
] as const;

const CATEGORY_VISUAL_META: Record<
  (typeof ALL_SUBPAGE_TUTORIALS)[number]["category"],
  { emoji: string; eta: string; focus: string }
> = {
  Learning: { emoji: "📘", eta: "3-5 分鐘", focus: "理解學習路徑" },
  Planning: { emoji: "🗒️", eta: "4-6 分鐘", focus: "建立可執行計畫" },
  Insights: { emoji: "📈", eta: "4-6 分鐘", focus: "看懂關鍵指標" },
  Studio: { emoji: "🎬", eta: "6-10 分鐘", focus: "完成第一版作品" },
  Ops: { emoji: "🧩", eta: "3-6 分鐘", focus: "建立可重複流程" },
  Model: { emoji: "🧠", eta: "8-12 分鐘", focus: "訓練與驗證模型" },
};

const INTERACTIVE_TEACHING_OPTIONS = {
  goal: [
    { id: "ship-fast", label: "今天先產出可用版本" },
    { id: "learn-why", label: "先理解每步驟為什麼" },
    { id: "team-ready", label: "建立可交接流程" },
  ],
  pace: [
    { id: "5-min", label: "5 分鐘快節奏" },
    { id: "15-min", label: "15 分鐘標準節奏" },
    { id: "30-min", label: "30 分鐘深度練習" },
  ],
  level: [
    { id: "beginner", label: "新手模式" },
    { id: "intermediate", label: "進階模式" },
    { id: "pro", label: "專家模式" },
  ],
} as const;

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
            r="2"
            fill="currentColor"
            initial={{ cy: 8 }}
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
  const reduceMotion = useReducedMotion();
  const { user, loading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  // 首頁不再自動把已登入使用者轉到 /create —— 保留光球首頁，由使用者自行點
  // 「進入創作作業系統」CTA 進站（避免首頁「閃幾秒就跳走」的體感）。
  const { personality } = useAIState();
  const [showOnboarding, setShowOnboarding] = useState(false);
  // Phase 2c: 三段創作中樞 sections 已搬到 /create，這頁不再需要 useProjects /
  // AskOrb handler — 由 CreationHub 直接消化。
  const {
    activeSurface: onboardingSurface,
    acquireSurface,
    releaseSurface,
  } = useSiteOnboarding();
  const ambient = useAmbient();
  const { sceneId, isDark, override, setOverride, allScenes } = ambient;
  const s = useMemo(() => SCENE_STYLES[sceneId], [sceneId]);
  const isMobile = useIsMobile();

  const ambientOverlayOpacity = useMemo(() => {
    if (sceneId === "nightSky") return 0.16;
    if (sceneId === "deepSea") return 0.18;
    return 0.12;
  }, [sceneId]);

  const [openGuideId, setOpenGuideId] = useState<string | null>("new-user");
  const [quickGuideHidden, setQuickGuideHidden] = useState(false);
  const [advancedQuickGuideOpen, setAdvancedQuickGuideOpen] = useState(false);
  const [completedMissions, setCompletedMissions] = useState<string[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string>(
    ALL_SUBPAGE_TUTORIALS[0].id
  );
  const [teachingGoal, setTeachingGoal] = useState<string>(
    INTERACTIVE_TEACHING_OPTIONS.goal[0].id
  );
  const [teachingPace, setTeachingPace] = useState<string>(
    INTERACTIVE_TEACHING_OPTIONS.pace[1].id
  );
  const [teachingLevel, setTeachingLevel] = useState<string>(
    INTERACTIVE_TEACHING_OPTIONS.level[0].id
  );
  const [selectedTrackId, setSelectedTrackId] = useState<string>(
    HOME_CREATIVE_TRACKS[0].id
  );
  const [completedOrbLessons, setCompletedOrbLessons] = useState<string[]>([]);
  const quickStartRef = useRef<HTMLElement>(null);

  const scrollToQuickStart = useCallback(() => {
    setOpenGuideId("new-user");
    quickStartRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
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

  // Hero orb visual handoff: as the user scrolls past the hero, the
  // central orb shrinks toward the bottom-right corner where the
  // floating ProactiveOrbWidget lives, signalling "the orb is your guide".
  // Mobile uses gentler drift since the orb starts closer to the edge and
  // big translations would overflow the narrow viewport.
  const heroOrbScale = useTransform(
    scrollY,
    [0, 700],
    isMobile ? [1, 0.55] : [1, 0.32]
  );
  const heroOrbDriftY = useTransform(
    scrollY,
    [0, 700],
    isMobile ? [0, 30] : [0, 60]
  );
  const heroOrbDriftX = useTransform(
    scrollY,
    [0, 700],
    isMobile ? [0, 32] : [0, 80]
  );

  // Nav background intensifies as ambient fades (more opaque for readability)
  const navOpacityBoost = useTransform(scrollY, [300, 800], [0, 0.3]);

  // Track scroll state for conditional rendering optimizations
  const [isAmbientVisible, setIsAmbientVisible] = useState(true);
  useMotionValueEvent(ambientOpacity, "change", latest => {
    setIsAmbientVisible(latest > 0.01);
  });

  // Check if user needs onboarding (don't open if any other onboarding
  // surface is already active to avoid stacking overlays)
  useEffect(() => {
    if (!isAuthenticated || loading) return;
    if (localStorage.getItem("ai-director-onboarded")) return;
    if (onboardingSurface && onboardingSurface !== "home-flow") return;
    setShowOnboarding(true);
  }, [isAuthenticated, loading, onboardingSurface]);

  // Hold the onboarding lock while OnboardingFlow is on-screen so site
  // tours / welcome tour can't pop over it.
  useEffect(() => {
    if (!showOnboarding) return;
    if (!acquireSurface("home-flow")) {
      setShowOnboarding(false);
      return;
    }
    return () => releaseSurface("home-flow");
  }, [showOnboarding, acquireSurface, releaseSurface]);

  useEffect(() => {
    const hiddenPref = localStorage.getItem("home-quick-guide-hidden") === "1";
    setQuickGuideHidden(hiddenPref);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("home-onboarding-missions-v1");
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        setCompletedMissions(
          parsed.filter((item): item is string => typeof item === "string")
        );
      }
    } catch {
      // ignore invalid localStorage
    }
  }, []);

  useEffect(() => {
    const savedTrack = localStorage.getItem("home-onboarding-track-v1");
    if (!savedTrack) return;
    const valid = HOME_CREATIVE_TRACKS.some(track => track.id === savedTrack);
    if (valid) {
      setSelectedTrackId(savedTrack);
    }
  }, []);

  useEffect(() => {
    const savedLessons = localStorage.getItem("home-orb-lessons-v1");
    if (!savedLessons) return;
    try {
      const parsed = JSON.parse(savedLessons);
      if (Array.isArray(parsed)) {
        setCompletedOrbLessons(
          parsed.filter((item): item is string => typeof item === "string")
        );
      }
    } catch {
      // ignore invalid localStorage
    }
  }, []);

  const toggleQuickGuideVisibility = useCallback(() => {
    setQuickGuideHidden(prev => {
      const next = !prev;
      localStorage.setItem("home-quick-guide-hidden", next ? "1" : "0");
      return next;
    });
  }, []);

  const completeMission = useCallback((missionId: string) => {
    setCompletedMissions(prev => {
      if (prev.includes(missionId)) return prev;
      const next = [...prev, missionId];
      localStorage.setItem("home-onboarding-missions-v1", JSON.stringify(next));
      return next;
    });
  }, []);

  const selectedTrack = useMemo(
    () =>
      HOME_CREATIVE_TRACKS.find(track => track.id === selectedTrackId) ??
      HOME_CREATIVE_TRACKS[0],
    [selectedTrackId]
  );
  const onboardingProgressPercent = Math.round(
    (completedMissions.length / HOME_ONBOARDING_MISSIONS.length) * 100
  );

  const copyOrbPrompt = useCallback(async (prompt: string) => {
    try {
      await copyToClipboard(prompt);
    } catch {
      // error toast shown by copyToClipboard
    }
  }, []);

  const completeOrbLesson = useCallback((lessonId: string) => {
    setCompletedOrbLessons(prev => {
      if (prev.includes(lessonId)) return prev;
      const next = [...prev, lessonId];
      localStorage.setItem("home-orb-lessons-v1", JSON.stringify(next));
      return next;
    });
  }, []);

  const orbLessonProgress = Math.round(
    (completedOrbLessons.length / ORB_AGENT_LESSONS.length) * 100
  );

  const startOrbBootcamp = useCallback(
    (prompt: string, tutorial: string) => {
      void copyOrbPrompt(prompt);
      if (!isAuthenticated) {
        window.location.href = getDemoLoginUrl();
        return;
      }
      navigate(`/agent?tutorial=${tutorial}&entry=home`);
    },
    [copyOrbPrompt, isAuthenticated, navigate]
  );

  const startImageStudioTutorial = useCallback(() => {
    const imageTutorialPrompt =
      "請啟動圖片創作室教學：先幫我定用途與尺寸，再生成第一版 prompt，最後帶我到 image-studio 出 4 張可比較版本。";
    void copyOrbPrompt(imageTutorialPrompt);
    if (!isAuthenticated) {
      window.location.href = getDemoLoginUrl();
      return;
    }
    navigate("/agent?tutorial=image-studio&entry=home");
  }, [copyOrbPrompt, isAuthenticated, navigate]);

  const startVideoStudioTutorial = useCallback(() => {
    const videoTutorialPrompt =
      "請啟動影片工作室教學：先幫我定義影片目標與時長，再產生分鏡與 prompt，最後帶我到 video-studio 產出第一版。";
    void copyOrbPrompt(videoTutorialPrompt);
    if (!isAuthenticated) {
      window.location.href = getDemoLoginUrl();
      return;
    }
    navigate("/agent?tutorial=video-studio&entry=home");
  }, [copyOrbPrompt, isAuthenticated, navigate]);

  const startMusicVoiceStudioTutorial = useCallback(() => {
    const audioTutorialPrompt =
      "請啟動音樂配音工作室教學：先定義用途與情緒，再生成音樂與配音指令，最後帶我到對應工作室產出第一版。";
    void copyOrbPrompt(audioTutorialPrompt);
    if (!isAuthenticated) {
      window.location.href = getDemoLoginUrl();
      return;
    }
    navigate("/agent?tutorial=music-voice-studio&entry=home");
  }, [copyOrbPrompt, isAuthenticated, navigate]);

  const startDirectorAITutorial = useCallback(() => {
    const directorTutorialPrompt =
      "請啟動導演 AI 教學：先定義成品目標，再把需求拆成圖影音任務，最後帶我到 director 執行第一版流程。";
    void copyOrbPrompt(directorTutorialPrompt);
    if (!isAuthenticated) {
      window.location.href = getDemoLoginUrl();
      return;
    }
    navigate("/agent?tutorial=director-ai&entry=home");
  }, [copyOrbPrompt, isAuthenticated, navigate]);

  const startGlobalSubpageTutorial = useCallback(
    (tutorialId: string, path: string, prompt: string) => {
      const profileSnippet = `使用者教學設定：目標=${teachingGoal}，節奏=${teachingPace}，程度=${teachingLevel}。`;
      const deepDivePrompt = `${prompt}

請用「逐站互動式導覽」模式帶我完成這一站：
1) 先用 2 句話說明這一站的核心價值與適合任務。
2) 先問我 1-2 個問題（目前目標、交付期限）再客製建議。
3) 給我「本頁第一步操作」與「完成判準」。
4) 完成後再給我「下一站建議」與為什麼。
${profileSnippet}`;
      void copyOrbPrompt(deepDivePrompt);
      if (!isAuthenticated) {
        window.location.href = getDemoLoginUrl();
        return;
      }
      navigate(
        `/agent?tutorial=${tutorialId}&target=${encodeURIComponent(path)}&scope=all-pages&interactive=1&depth=station&entry=home`
      );
    },
    [
      copyOrbPrompt,
      isAuthenticated,
      navigate,
      teachingGoal,
      teachingPace,
      teachingLevel,
    ]
  );

  const startInteractiveOrbStep = useCallback(
    ({
      tutorialId,
      stepId,
      stepTitle,
      stepDescription,
      targetPath,
      sectionLabel,
      customPrompt,
    }: {
      tutorialId: string;
      stepId: string;
      stepTitle: string;
      stepDescription: string;
      targetPath?: string;
      sectionLabel: string;
      customPrompt?: string;
    }) => {
      const stepPrompt =
        customPrompt ??
        `請啟動「${sectionLabel}」互動式導覽的這一步：${stepTitle}。${stepDescription}。請先問我 1-2 個必要問題，再帶我完成這一步，最後告訴我下一步。`;
      const profileSnippet = `教學設定：目標=${teachingGoal}，節奏=${teachingPace}，程度=${teachingLevel}。`;
      void copyOrbPrompt(`${stepPrompt}\n${profileSnippet}`);
      if (!isAuthenticated) {
        window.location.href = getDemoLoginUrl();
        return;
      }
      const params = new URLSearchParams({
        tutorial: tutorialId,
        step: stepId,
        interactive: "1",
        entry: "home",
      });
      if (targetPath) {
        params.set("target", targetPath);
      }
      navigate(`/agent?${params.toString()}`);
    },
    [
      copyOrbPrompt,
      isAuthenticated,
      navigate,
      teachingGoal,
      teachingPace,
      teachingLevel,
    ]
  );

  // ─── PageAgent 註冊（Phase 4b：首頁接入光球） ────────────────────────────
  // 首頁主要任務是「把使用者帶進工作室」。光球可做：navigate 到主要分站、
  // 暴露 isAuthenticated / sceneId / intent 讓 LLM 決定下一步。
  const HOME_NAV_ALLOWLIST = useMemo<Set<string>>(
    () =>
      new Set([
        "/studio",
        "/director",
        "/image-studio",
        "/video-studio",
        "/pro-studio",
        "/lora-trainer",
        "/learn",
        "/dashboard",
        "/history",
        "/notes",
        "/prompt-library",
        "/assets",
        "/shared",
      ]),
    []
  );
  const homeAgentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "navigate",
        label: "跳到主要分站",
        hint: "navigate path='/studio' | '/director' | '/image-studio' | '/video-studio' | '/pro-studio' | '/lora-trainer' | '/learn' | '/dashboard' | '/history' | '/notes' | '/prompt-library' | '/assets' | '/shared' | '/teaching-archive' | '/teams'",
      },
    ],
    []
  );

  useRegisterPageAgent({
    pageId: "home",
    pageLabel: "首頁",
    pagePath: "/",
    capabilities: homeAgentCapabilities,
    state: {
      isAuthenticated,
      sceneId,
      isDark,
      inferredIntentType: intentResult?.intentType ?? null,
      inferredConfidence: intentResult?.confidence ?? 0,
    },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      if (action.type === "navigate") {
        const path = String(action.path ?? "");
        if (!HOME_NAV_ALLOWLIST.has(path)) {
          return { ok: false, reason: `不在允許跳轉清單：${path}` };
        }
        if (!isAuthenticated && path !== "/learn") {
          return {
            ok: false,
            reason: "尚未登入，先引導登入再跳轉",
          };
        }
        navigate(path);
        return { ok: true, message: `跳到 ${path}` };
      }
      return { ok: false, reason: `unsupported on home: ${action.type}` };
    },
  });

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
            navigate("/agent");
          }}
          onBranchComplete={(path) => {
            // AIDV-836: navigate straight to the chosen shell in a single push,
            // without the intermediate navigate("/agent") that polluted history
            // (Back button got trapped on /agent instead of returning home).
            setShowOnboarding(false);
            navigate(path);
          }}
          onSkip={() => {
            setShowOnboarding(false);
            navigate("/agent");
          }}
        />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen relative overflow-x-hidden flex flex-col">
      <PageRevealVeil color={isDark ? "rgba(6,8,20,0.55)" : "rgba(252,247,240,0.55)"} />
      <GrainOverlay opacity={isDark ? 0.05 : 0.03} />
      <ScrollProgressBar color={s.glowColor} />
      {/* ── Full-page gradient background (scene-adaptive, covers entire scroll height) ── */}
      <div
        className="fixed inset-0 w-full h-full -z-20 pointer-events-none"
        style={{
          background: s.pageBg,
          transition: "background 1s ease",
        }}
        aria-hidden="true"
      />
      {/* ── Scene-tinted vignette: deepens edges per time-of-day ── */}
      <SceneVignette sceneId={sceneId} />
      {(!isMobile || LANDING_COSMIC_MOBILE_ENABLED) && <CosmicBackdrop glowColor={s.glowColor} />}

      {/* ── Page-wide pointer aura (mouse + touch) — gentle scene-tinted glow
          that follows the cursor / finger across the homepage. */}
      <PointerAura color={s.glowColor} />

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
            <AmbientVideo src="" overlayOpacity={ambientOverlayOpacity} fadeInDuration={1200} />
            <AmbientEnvironment forceScene={sceneId} />
          </>
        )}
      </motion.div>

      {/* ── Navigation — healing glass nav ── */}
      {HOME_FEATURE_FLAGS.showLegacyTopNav && (
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
            <span
              className={`font-semibold tracking-tight transition-colors duration-1000 ${s.textPrimary}`}
            >
              AI Director
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <SceneSwitcher
              currentScene={sceneId}
              override={override}
              allScenes={allScenes}
              onSelect={setOverride}
              isDark={isDark}
            />
            <div className="hidden sm:flex">
              <SoundControl
                controls={ambient}
                isDark={isDark}
                sceneLabel={SCENE_SOUND_LABELS[sceneId]}
              />
            </div>
            <div className="flex sm:hidden">
              <SoundControl
                controls={ambient}
                isDark={isDark}
                compact
                sceneLabel={SCENE_SOUND_LABELS[sceneId]}
              />
            </div>
            {isAuthenticated ? (
              <Button
                onClick={() => navigate("/agent")}
                className={`rounded-2xl gap-1.5 text-sm h-10 px-4 sm:px-6 btn-healing ${s.btnPrimary} ${s.btnPrimaryText}`}
              >
                <span className="hidden sm:inline">開始創作</span>
                <span className="sm:hidden">創作</span>
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
      )}

      {/* ── Hero Section (Scrollytelling anchor) — healing breathing space ── */}
      <motion.section
        ref={heroRef}
        className="pt-4 sm:pt-20 lg:pt-28 pb-10 sm:pb-16 lg:pb-20 px-4 sm:px-6 relative z-10 flex items-center justify-center min-h-[92vh] sm:min-h-[80vh]"
        style={
          HOME_FEATURE_FLAGS.enableHeroScrollAnimations
            ? { y: heroY }
            : undefined
        }
      >
        {(!isMobile || LANDING_AURORA_MOBILE_ENABLED) && <AuroraBlobs sceneId={sceneId} />}
        <HeroMagneticSpotlight color={s.glowColor} />
        <motion.div
          className="max-w-4xl mx-auto text-center w-full relative"
          style={
            HOME_FEATURE_FLAGS.enableHeroScrollAnimations
              ? { opacity: heroContentOpacity }
              : undefined
          }
        >
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.0, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Scene Badge */}
            {HOME_FEATURE_FLAGS.showSceneBadge && (
            <motion.div
              className="flex justify-center mb-5 sm:mb-10"
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
            )}

            {/* Central Orb — wrapped in JewelOrbStage so it becomes a
                scene-aware "光球寶珠" (constellation field on nightSky,
                light caustics + bubbles on deepSea), with cursor tilt
                and click ripple.  Scroll-morphs toward the floating orb
                as the user descends. */}
            <motion.div
              className="flex flex-col items-center mb-2 sm:mb-8"
              style={
                HOME_FEATURE_FLAGS.enableHeroScrollAnimations
                  ? {
                      scale: heroOrbScale,
                      x: heroOrbDriftX,
                      y: heroOrbDriftY,
                    }
                  : undefined
              }
            >
              <JewelOrbStage
                sceneId={sceneId}
                onTap={() =>
                  window.dispatchEvent(new CustomEvent("orb-open-capabilities"))
                }
              >
                {/* Ambient glow ring behind orb — soft, scene-linked.
                    Lower opacity on mobile so it doesn't stack with the
                    JewelOrbStage bloom into a heavy amber ring. */}
                <motion.div
                  className="absolute inset-0 m-auto w-48 h-48 sm:w-52 sm:h-52 lg:w-60 lg:h-60 rounded-full pointer-events-none"
                  style={{
                    background: `radial-gradient(circle, ${s.glowColor} 0%, rgba(255,255,255,0.02) 42%, transparent 78%)`,
                    filter: "blur(18px)",
                  }}
                  animate={
                    reduceMotion
                      ? undefined
                      : {
                          scale: [0.9, 1.08, 0.92, 1],
                          opacity: isMobile
                            ? [0.22, 0.42, 0.26, 0.22]
                            : [0.2, 0.38, 0.23, 0.2],
                        }
                  }
                  transition={{
                    duration: 8.2,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 m-auto w-56 h-56 sm:w-64 sm:h-64 rounded-full"
                  style={{
                    border: "1px solid rgba(226,232,255,0.22)",
                    boxShadow: `0 0 60px ${s.glowColor}`,
                  }}
                  animate={
                    reduceMotion
                      ? undefined
                      : {
                          scale: [0.9, 1.08, 0.94, 0.9],
                          opacity: [0.18, 0.48, 0.28, 0.18],
                          rotate: [0, 8, 16, 24],
                        }
                  }
                  transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 m-auto w-72 h-72 sm:w-80 sm:h-80 rounded-full border"
                  style={{ borderColor: "rgba(191,200,255,0.16)" }}
                  animate={
                    reduceMotion
                      ? undefined
                      : {
                          scale: [0.88, 1.1, 0.92, 0.88],
                          opacity: [0.06, 0.24, 0.12, 0.06],
                          rotate: [0, -6, -14, -22],
                        }
                  }
                  transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
                />
                {/* Orb with subtle scene-matched aura.
                    NOTE: We intentionally animate ONLY `scale` here (a GPU
                    transform), never `filter`. The orb is a WebGL <canvas>
                    (VisualSoul3D); animating drop-shadow/brightness on its
                    wrapper forces the compositor to re-sample the canvas alpha
                    every frame, which makes the orb visibly flicker on mobile
                    (see the matching note in VisualSoul3D.tsx). The breathing
                    glow is already supplied by the sibling radial-gradient
                    aura ring above + VisualSoul3D's own static drop-shadow, so
                    dropping the animated filter loses no visual richness. */}
                <motion.div
                  className="relative"
                  style={{
                    filter: `drop-shadow(0 0 24px ${s.glowColor})`,
                  }}
                  transition={{ duration: 8.4, repeat: Infinity, ease: "easeInOut" }}
                  animate={
                    reduceMotion
                      ? undefined
                      : {
                          scale: [0.9, 1.05, 0.93, 0.9],
                        }
                  }
                >
                  <VisualSoul
                    size="lg"
                    personality={personality}
                    className="!w-16 !h-16 sm:!w-20 sm:!h-20"
                  />
                </motion.div>
              </JewelOrbStage>
            </motion.div>

            {/* ── Poetic title cluster — fills the space between orb and CTA,
                gives the page a clear emotional anchor that matches the
                healing/cosmic backdrop. Always visible; replaces the heavier
                OARS multi-step greeting which is gated off. */}
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.9,
                delay: 0.45,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="text-center px-4 sm:px-0 mb-7 sm:mb-10"
            >
              {/* Brand kicker — a single restrained eyebrow that anchors the
                  whole hero, so the headline below can stand alone instead of
                  competing with a second title block. */}
              <div className="mb-5 sm:mb-7 flex justify-center">
                <span
                  className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[11px] sm:text-xs font-medium tracking-[0.18em] uppercase transition-colors duration-1000 ${s.textSecondary}`}
                  style={{
                    background: s.featureBg,
                    border: `1px solid ${s.cardBorder}`,
                    backdropFilter: "blur(8px)",
                  }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Healing Studio
                  <span aria-hidden className="opacity-40">·</span>
                  Creative OS
                </span>
              </div>

              {/* Headline — single emotional anchor (the brand's signature
                  question), refined tracking + leading for a calmer, more
                  deliberate read. */}
              <h1
                aria-label="今天，想創作什麼"
                className={`heading-healing text-balance text-[32px] sm:text-5xl lg:text-[3.4rem] font-semibold leading-[1.12] tracking-tight transition-colors duration-1000 ${s.textPrimary}`}
                style={{
                  textShadow: isDark
                    ? `0 2px 28px ${s.glowColor}`
                    : "0 1px 2px rgba(0,0,0,0.04)",
                }}
              >
                今天，想創作什麼？
              </h1>

              {/* Subhead — one focused supporting line that absorbs the prior
                  three stacked paragraphs into a clear value proposition. */}
              <p
                className={`mx-auto mt-4 sm:mt-5 max-w-xl text-pretty body-healing text-[15px] sm:text-lg lg:text-xl leading-relaxed transition-colors duration-1000 ${s.textSecondary}`}
              >
                把靈感變成作品。單一入口串起圖片、影片與導演&nbsp;AI，
                用有呼吸感的流程，從一個念頭走到完整成片。
              </p>

              {/* Capability chips — consistent sizing, a leading glow dot, and
                  a single tidy row signalling the three pillars. */}
              <ul role="list" aria-label="創作功能" className="mt-6 sm:mt-7 flex flex-wrap justify-center gap-2 sm:gap-2.5">
                {['圖片生成', '影片分鏡', '導演協作'].map((label) => (
                  <li key={label} className="list-none">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 sm:px-3.5 py-1.5 text-[12px] sm:text-[13px] font-medium transition-colors duration-1000 ${s.textSecondary}`}
                      style={{
                        background: s.cardBg,
                        border: `1px solid ${s.cardBorder}`,
                      }}
                    >
                      <span
                        aria-hidden
                        className="w-1 h-1 rounded-full"
                        style={{
                          background: s.glowColor,
                          boxShadow: `0 0 6px ${s.glowColor}`,
                        }}
                      />
                      {label}
                    </span>
                  </li>
                ))}
              </ul>
            </motion.div>

            {/* OARS Contextual Greeting — replaces static title */}
            {HOME_FEATURE_FLAGS.showOarsGreeting && (
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
            )}

            {/* Phase 2c: 首頁瘦身 — 只留一顆 CTA「進入創作作業系統」直接導到
                /create（CreationHub 已承接快速開始 / 繼續上次專案 / 直接問光球
                三大區塊）。 */}
            {HOME_FEATURE_FLAGS.showHeroCtaButtons && (
            <motion.div
              data-testid="home-enter-os-cta"
              className="mt-2 sm:mt-2 flex items-center justify-center px-3 sm:px-0 relative"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.7,
                delay: 0.6,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <span aria-hidden className="pointer-events-none absolute inset-x-0 -inset-y-3 m-auto h-20 w-72 sm:w-96 rounded-full" style={{ background: `radial-gradient(circle, ${s.glowColor.replace(/0\.\d+\)/, "0.22)")} 0%, transparent 70%)`, filter: "blur(18px)" }} />
              <MagneticTilt strength={10}>
                <Button
                  size="lg"
                  onClick={() => navigate("/create")}
                  className={`group relative overflow-hidden rounded-2xl h-10 sm:h-12 px-5 sm:px-8 gap-2 text-sm btn-healing w-full sm:w-auto max-w-[248px] sm:max-w-none ${s.btnPrimary} ${s.btnPrimaryText}`}
                  style={{
                    boxShadow: `0 8px 32px ${s.glowColor}, 0 0 0 1px rgba(255,255,255,0.06) inset`,
                  }}
                >
                  {/* Sheen sweep on hover */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-[1100ms] ease-out"
                    style={{
                      background:
                        "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)",
                    }}
                  />
                  <Sparkles className="w-4 h-4 transition-transform duration-500 group-hover:rotate-12 group-hover:scale-110" />
                  <span className="relative z-10">進入創作作業系統</span>
                  <ArrowRight className="w-4 h-4 transition-transform duration-500 group-hover:translate-x-1" />
                </Button>
              </MagneticTilt>
            </motion.div>
            )}

            {/* ── Status cluster below the CTA — fills the lower mobile void
                with a calm "光球已就緒" pill + breathing microcopy, signalling
                that the orb is alive and ready to guide. */}
            <motion.div
              className="mt-8 sm:mt-10 flex flex-col items-center gap-3 sm:gap-4"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.8,
                delay: 0.85,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              <div
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md text-[10px] sm:text-[11px] tracking-[0.18em] uppercase ${s.textMuted}`}
                style={{
                  background: s.cardBg,
                  border: `1px solid ${s.cardBorder}`,
                }}
              >
                <motion.span
                  aria-hidden
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: s.glowColor, boxShadow: `0 0 8px ${s.glowColor}` }}
                  animate={
                    reduceMotion
                      ? undefined
                      : { opacity: [0.4, 1, 0.4], scale: [0.85, 1.15, 0.85] }
                  }
                  transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                />
                光球已就緒
              </div>
              <motion.p
                className={`text-[11px] sm:text-xs tracking-wide max-w-[16rem] sm:max-w-sm text-center ${s.textMuted}`}
                animate={reduceMotion ? undefined : { opacity: [0.55, 0.85, 0.55] }}
                transition={{ duration: 5.2, repeat: Infinity, ease: "easeInOut" }}
              >
                點一下進入，光球會帶你走最短路徑
              </motion.p>
            </motion.div>

            {/* Scroll indicator — gentle invitation */}
            {HOME_FEATURE_FLAGS.showScrollIndicator && (
              <ScrollIndicator isDark={isDark} />
            )}
          </motion.div>
        </motion.div>
      </motion.section>

      {/* Phase 2c: 首頁瘦身 — 原本掛在這的「快速開始 / 繼續上次專案 / 直接問
          光球」三段已搬到 /create 頂部，由上面的 hero CTA「進入創作作業系統」
          帶使用者進站。home-hub-glass CSS 保留在 index.css 留作未來重用。 */}

      {/* ── Shimmering hairline divider between Hero and Narrative ── */}
      {HOME_FEATURE_FLAGS.showOrbCreationStage && (
        <ShimmerDivider color={s.dividerColor} />
      )}

      {/* ── Orb Creation Stage — Phase 01 + 02 合併互動劇場 ── */}
      {HOME_FEATURE_FLAGS.showOrbCreationStage && (
      <OrbCreationStage
        textPrimary={s.textPrimary}
        textMuted={s.textMuted}
        cardBg={s.cardBg}
        cardBorder={s.cardBorder}
        featureBg={s.featureBg}
        btnPrimary={s.btnPrimary}
        btnPrimaryText={s.btnPrimaryText}
        isDark={isDark}
      />
      )}

      {/* SITE_VALUE_HIGHLIGHTS + SITE_USE_CASES were merged into the unified
          OrbCreationStage above so the orb agent can dispatch every modality
          in place — no studio detour. */}

      {HOME_FEATURE_FLAGS.showOrbCreationStage && (
        <ShimmerDivider color={s.dividerColor} />
      )}

      {/* 首頁快速導覽已完整移至 /learn/tutorial-overview */}

      {/* OrbCreationStage now subsumes the former OrbNarrativeBridge: the
          merged stage above carries the "從一個念頭開始" narrative AND the
          interactive prompt → live generation experience in one panel. */}

      {/* ── I-9 意圖個人化引導（AIDV-87，旗標 showIntentOnboarding 預設 OFF） ── */}
      {HOME_FEATURE_FLAGS.showIntentOnboarding && (
        <IntentOnboardingNudge intentResult={intentResult} />
      )}

      {/* ── Intent Inference Whisper (意圖推論低語) ── */}
      {HOME_FEATURE_FLAGS.showIntentWhisper && intentResult && intentResult.confidence > 0.4 && (
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

      {/* ── Intel Bento Grid (情報站) — 僅顯示 AI 相關新聞 ── */}
      {HOME_FEATURE_FLAGS.showIntelBento && (
      <Suspense
        fallback={
          <SectionShimmerSkeleton
            height={420}
            color={s.glowColor}
            label="情報站載入中"
          />
        }
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px", amount: 0.05 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          <IntelBentoGrid sceneId={sceneId} />
        </motion.div>
      </Suspense>
      )}

      {/* ── Showcase Masonry (精選作品瀑布流) ── */}
      {HOME_FEATURE_FLAGS.showShowcaseMasonry && (
      <Suspense
        fallback={
          <SectionShimmerSkeleton
            height={520}
            color={s.dividerColor}
            label="作品瀑布流載入中"
          />
        }
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px", amount: 0.05 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
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
        </motion.div>
      </Suspense>
      )}

      {SHOW_BOTTOM_CTA ? (
        <>
          {/* ── Shimmering hairline divider before CTA ── */}
          <ShimmerDivider color={s.dividerColor} />

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
                          onClick={() => navigate("/agent")}
                          className={`rounded-2xl h-11 sm:h-12 px-8 sm:px-10 gap-2 text-sm btn-healing ${s.btnPrimary} ${s.btnPrimaryText}`}
                        >
                          開始創作
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
        </>
      ) : (
        <div className="relative z-10 py-8 sm:py-10 lg:py-12" aria-hidden="true">
          <div
            className="h-px mx-auto max-w-2xl"
            style={{
              background: `linear-gradient(90deg, transparent, ${s.dividerColor}, transparent)`,
            }}
          />
        </div>
      )}

      {/* ── VisualSoul Invitation (光球行動與邀約) ── */}
      {HOME_FEATURE_FLAGS.showVisualSoulInvitation && (
      <VisualSoulInvitation
        sceneId={sceneId}
        personality={personality}
        intentResult={intentResult}
        isInferring={isIntentInferring}
      />
      )}

      {/* ── Footer — healing minimal ── */}
      {HOME_FEATURE_FLAGS.showLegacyFooter && (
      <footer className="py-10 sm:py-12 lg:py-14 px-4 sm:px-6 transition-colors duration-1000 relative z-10 mt-auto">
        {/* Scene-tinted glow seam — soft halo at top of footer */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 right-0 h-24 -translate-y-1/2"
          style={{
            background: `radial-gradient(ellipse 60% 100% at 50% 100%, ${s.glowColor} 0%, transparent 70%)`,
            opacity: 0.45,
          }}
        />
        {/* Breathing shimmer divider line */}
        <div className="mb-8 sm:mb-10">
          <ShimmerDivider
            color={s.footerBorder}
            maxWidthClass="max-w-4xl"
            duration={9}
          />
        </div>
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-0 text-xs">
          <div className="flex items-center gap-3">
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
      )}
    </div>
  );
}
