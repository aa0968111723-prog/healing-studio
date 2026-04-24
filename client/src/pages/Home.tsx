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
  ChevronsUpDown,
  Compass,
  Rocket,
  CircleCheck,
  MessageCircle,
  Gauge,
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
import VisualSoulInvitation from "@/components/VisualSoulInvitation";
import LocalAuthForm from "@/components/LocalAuthForm";
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

const NEW_USER_JOURNEY = [
  {
    id: "orb-agent",
    title: "先用全站光球代理帶路",
    description:
      "先從光球代理開始，直接用對話告訴它你的目標，系統會帶你到對應工作室並推薦下一步。",
  },
  {
    id: "first-output",
    title: "10 分鐘做出第一個作品",
    description:
      "先選一個工作室（建議圖片或影片），使用範本與預設參數快速生成第一版。",
  },
  {
    id: "iterate",
    title: "再做精修與版本管理",
    description: "回到模型/素材/歷史頁面做迭代，逐步把草稿升級成可發佈成品。",
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

  const openFeature = useCallback((feature: FeatureDetail) => {
    setActiveFeature(feature);
    setFeatureDialogOpen(true);
  }, []);

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
      await navigator.clipboard.writeText(prompt);
    } catch {
      // ignore clipboard permission errors
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

  const startOrbGuidedOnboarding = useCallback(() => {
    const kickoffPrompt =
      "我是新手，請你從全站導覽開始，先帶我到最適合的創作工作室完成第一版。";
    void copyOrbPrompt(kickoffPrompt);
    if (!isAuthenticated) {
      window.location.href = getDemoLoginUrl();
      return;
    }
    navigate("/agent?mode=onboarding&entry=home");
  }, [copyOrbPrompt, isAuthenticated, navigate]);

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
        hint: "navigate path='/studio' | '/director' | '/image-studio' | '/video-studio' | '/pro-studio' | '/lora-trainer' | '/learn' | '/dashboard' | '/history' | '/notes' | '/prompt-library' | '/assets' | '/shared'",
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
                <span className="hidden sm:inline">啟動光球代理</span>
                <span className="sm:hidden">光球</span>
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
                    onClick={() => navigate("/agent")}
                    className={`rounded-2xl h-11 sm:h-12 px-6 sm:px-8 gap-2 text-sm shadow-lg hover:shadow-xl btn-healing w-full sm:w-auto ${s.btnPrimary} ${s.btnPrimaryText}`}
                  >
                    <Sparkles className="w-4 h-4" />
                    開始創作（光球帶路）
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
                <div className="w-full px-4 sm:px-0 max-w-xl">
                  <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
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
                  <div
                    className="mt-4 rounded-2xl border p-3 text-left"
                    style={{ background: s.cardBg, borderColor: s.cardBorder }}
                  >
                    <LocalAuthForm hideTitle redirectTo="/agent" />
                  </div>
                </div>
              )}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.7,
                delay: 0.75,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="mt-5 sm:mt-6 px-4 sm:px-0"
            >
              <div
                className="max-w-3xl mx-auto rounded-2xl border p-4 sm:p-5 text-left"
                style={{ background: s.cardBg, borderColor: s.cardBorder }}
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <p
                    className={`text-sm sm:text-base font-semibold transition-colors duration-1000 ${s.textPrimary}`}
                  >
                    新手入口：第一次來，先走這條路
                  </p>
                  <span
                    className={`text-[10px] sm:text-xs px-2 py-1 rounded-full ${s.textSecondary}`}
                    style={{ background: s.featureBg }}
                  >
                    3 steps
                  </span>
                </div>
                <div className="space-y-2.5">
                  {NEW_USER_JOURNEY.map((step, idx) => (
                    <div key={step.id} className="flex items-start gap-2.5">
                      <span
                        className={`mt-0.5 inline-flex w-5 h-5 items-center justify-center rounded-full text-[11px] font-semibold ${s.textPrimary}`}
                        style={{ background: s.featureBg }}
                      >
                        {idx + 1}
                      </span>
                      <div>
                        <p
                          className={`text-xs sm:text-sm font-medium transition-colors duration-1000 ${s.textPrimary}`}
                        >
                          {step.title}
                        </p>
                        <p
                          className={`text-xs sm:text-sm mt-0.5 transition-colors duration-1000 ${s.textMuted}`}
                        >
                          {step.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-col sm:flex-row gap-2.5">
                  {isAuthenticated ? (
                    <Button
                      size="sm"
                      onClick={() => navigate("/agent")}
                      className={`rounded-xl text-xs sm:text-sm gap-1.5 ${s.btnPrimary} ${s.btnPrimaryText}`}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      先用全站光球代理
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => {
                        window.location.href = getDemoLoginUrl();
                      }}
                      className={`rounded-xl text-xs sm:text-sm gap-1.5 ${s.btnPrimary} ${s.btnPrimaryText}`}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      先體驗光球代理
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={scrollToQuickStart}
                    className={`rounded-xl text-xs sm:text-sm gap-1.5 ${s.btnOutline} ${s.btnOutlineText}`}
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    看完整新手教學
                  </Button>
                  {isAuthenticated ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowOnboarding(true)}
                      className={`rounded-xl text-xs sm:text-sm ${s.btnOutline} ${s.btnOutlineText}`}
                    >
                      再看互動式導覽
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate("/learn")}
                      className={`rounded-xl text-xs sm:text-sm ${s.btnOutline} ${s.btnOutlineText}`}
                    >
                      先看入門教學文章
                    </Button>
                  )}
                </div>
              </div>
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

      {/* ── Home quickstart guide (collapsible) ── */}
      <section
        ref={quickStartRef}
        className="pt-8 sm:pt-10 px-4 sm:px-6 relative z-10"
      >
        <div className="max-w-5xl mx-auto">
          <div
            className="rounded-2xl sm:rounded-3xl p-4 sm:p-6 backdrop-blur-md"
            style={{
              background: s.cardBg,
              border: `1px solid ${s.cardBorder}`,
            }}
          >
            <div className="flex items-center justify-between gap-3 mb-3 sm:mb-4">
              <div>
                <h2
                  className={`text-base sm:text-lg font-semibold transition-colors duration-1000 ${s.textPrimary}`}
                >
                  首頁快速導覽
                </h2>
                <p
                  className={`text-xs sm:text-sm mt-1 transition-colors duration-1000 ${s.textMuted}`}
                >
                  已升級為「逐站深入」光球互動式導覽：每一站都會先提問、再帶做、最後銜接下一站。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] sm:text-xs px-2 py-1 rounded-full ${s.textSecondary}`}
                  style={{ background: s.featureBg }}
                >
                  UIUX
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={toggleQuickGuideVisibility}
                  className={`h-7 rounded-lg px-2.5 text-[11px] ${s.btnOutline} ${s.btnOutlineText}`}
                >
                  {quickGuideHidden ? "顯示導覽" : "隱藏導覽"}
                </Button>
              </div>
            </div>

            {quickGuideHidden ? (
              <div
                className="rounded-xl border p-3.5 sm:p-4"
                style={{ borderColor: s.cardBorder, background: s.featureBg }}
              >
                <p className={`text-xs sm:text-sm ${s.textMuted}`}>
                  已隱藏首頁快速導覽。你仍可隨時透過右下角光球代理開始對話：
                  <span className="font-medium">「帶我快速上手」</span>。
                </p>
              </div>
            ) : (
              <>
                <div
                  className="rounded-xl border p-3 sm:p-4 mb-3"
                  style={{ borderColor: s.cardBorder, background: s.featureBg }}
                >
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <p className={`text-sm font-semibold ${s.textPrimary}`}>
                      全頁子頁面教學總覽
                    </p>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                        style={{ background: s.cardBg }}
                      >
                        All Subpages
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className={`h-7 px-2.5 text-[11px] ${s.btnOutline} ${s.btnOutlineText}`}
                        onClick={() =>
                          startInteractiveOrbStep({
                            tutorialId: "all-subpages-deep-dive",
                            stepId: "station-sequence",
                            stepTitle: "全站逐站深入互動導覽",
                            stepDescription:
                              "由光球依序帶我跑完核心頁面，每站都要有任務與驗收點",
                            sectionLabel: "全頁子頁面教學總覽",
                            customPrompt:
                              "請啟動全站逐站深入互動導覽，依序帶我走 Learn、Notes、Dashboard、Studio、Director、Image、Video、History、Assets。每一站都要先提問、指定一個可執行任務、給驗收標準，完成後再銜接下一站。",
                          })
                        }
                      >
                        全站逐站導覽
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3 mb-2">
                    {ALL_SUBPAGE_TUTORIALS.slice(0, 3).map(item => (
                      <div
                        key={item.id}
                        className="rounded-lg border p-2.5"
                        style={{
                          borderColor: s.cardBorder,
                          background: s.cardBg,
                        }}
                      >
                        <p className={`text-xs font-medium ${s.textPrimary}`}>
                          {item.title}
                        </p>
                        <p className={`text-[11px] mt-1 ${s.textMuted}`}>
                          {item.category}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div
                    className="rounded-lg border p-2.5 mb-2"
                    style={{ borderColor: s.cardBorder, background: s.cardBg }}
                  >
                    <p
                      className={`text-[11px] font-medium mb-2 ${s.textPrimary}`}
                    >
                      逐站導覽可視化流程
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-3">
                      {STATION_VISUAL_STEPS.map(step => (
                        <div
                          key={step}
                          className="rounded-md px-2 py-1.5 text-[11px]"
                          style={{ background: s.featureBg }}
                        >
                          <span className={s.textSecondary}>{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div
                    className="rounded-lg border p-2.5 mb-2"
                    style={{ borderColor: s.cardBorder, background: s.cardBg }}
                  >
                    <p
                      className={`text-[11px] font-medium mb-2 ${s.textPrimary}`}
                    >
                      先設定你的互動教學模式（光球會照這個節奏帶你）
                    </p>
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        {INTERACTIVE_TEACHING_OPTIONS.goal.map(option => (
                          <Button
                            key={option.id}
                            size="sm"
                            variant={
                              teachingGoal === option.id ? "default" : "outline"
                            }
                            className={`h-7 px-2 text-[11px] ${teachingGoal === option.id ? `${s.btnPrimary} ${s.btnPrimaryText}` : `${s.btnOutline} ${s.btnOutlineText}`}`}
                            onClick={() => setTeachingGoal(option.id)}
                          >
                            🎯 {option.label}
                          </Button>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {INTERACTIVE_TEACHING_OPTIONS.pace.map(option => (
                          <Button
                            key={option.id}
                            size="sm"
                            variant={
                              teachingPace === option.id ? "default" : "outline"
                            }
                            className={`h-7 px-2 text-[11px] ${teachingPace === option.id ? `${s.btnPrimary} ${s.btnPrimaryText}` : `${s.btnOutline} ${s.btnOutlineText}`}`}
                            onClick={() => setTeachingPace(option.id)}
                          >
                            ⏱ {option.label}
                          </Button>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {INTERACTIVE_TEACHING_OPTIONS.level.map(option => (
                          <Button
                            key={option.id}
                            size="sm"
                            variant={
                              teachingLevel === option.id
                                ? "default"
                                : "outline"
                            }
                            className={`h-7 px-2 text-[11px] ${teachingLevel === option.id ? `${s.btnPrimary} ${s.btnPrimaryText}` : `${s.btnOutline} ${s.btnOutlineText}`}`}
                            onClick={() => setTeachingLevel(option.id)}
                          >
                            🧭 {option.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div
                    className="rounded-lg border p-2.5 mb-2"
                    style={{
                      borderColor: s.cardBorder,
                      background: s.featureBg,
                    }}
                  >
                    <p className={`text-[11px] ${s.textPrimary}`}>
                      目前選擇站點：
                      <span className="font-semibold">
                        {" "}
                        {
                          ALL_SUBPAGE_TUTORIALS.find(
                            item => item.id === selectedStationId
                          )?.title
                        }
                      </span>
                    </p>
                    <p className={`text-[11px] mt-1 ${s.textMuted}`}>
                      點任一站卡片就會切換目標站，光球會依你上方的設定自動調整提問深度與教學節奏。
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {ALL_SUBPAGE_TUTORIALS.map(item => (
                      <div
                        key={item.id}
                        className="rounded-lg border p-3 transition-all cursor-pointer"
                        style={{
                          borderColor: s.cardBorder,
                          background: s.cardBg,
                        }}
                        onClick={() => setSelectedStationId(item.id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={`text-xs sm:text-sm font-medium ${s.textPrimary}`}
                          >
                            {item.title}
                          </p>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded ${s.textSecondary}`}
                            style={{ background: s.featureBg }}
                          >
                            {item.category}
                          </span>
                        </div>
                        {selectedStationId === item.id ? (
                          <div
                            className="mt-1 rounded-md px-2 py-1 text-[10px] font-medium"
                            style={{ background: s.featureBg }}
                          >
                            <span className={s.textSecondary}>
                              正在準備這一站的互動教學
                            </span>
                          </div>
                        ) : null}
                        <div className="mt-2 grid grid-cols-3 gap-1.5">
                          <div
                            className="rounded-md px-2 py-1 text-[10px]"
                            style={{ background: s.featureBg }}
                          >
                            <span className={s.textSecondary}>
                              {CATEGORY_VISUAL_META[item.category].emoji} 焦點
                            </span>
                            <p className={`mt-0.5 ${s.textPrimary}`}>
                              {CATEGORY_VISUAL_META[item.category].focus}
                            </p>
                          </div>
                          <div
                            className="rounded-md px-2 py-1 text-[10px]"
                            style={{ background: s.featureBg }}
                          >
                            <span className={s.textSecondary}>⏱ 預估</span>
                            <p className={`mt-0.5 ${s.textPrimary}`}>
                              {CATEGORY_VISUAL_META[item.category].eta}
                            </p>
                          </div>
                          <div
                            className="rounded-md px-2 py-1 text-[10px]"
                            style={{ background: s.featureBg }}
                          >
                            <span className={s.textSecondary}>✅ 完成標準</span>
                            <p className={`mt-0.5 ${s.textPrimary}`}>
                              做完一個站內任務
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-col sm:flex-row gap-2">
                          <Button
                            size="sm"
                            className={`h-7 px-2.5 text-[11px] ${s.btnPrimary} ${s.btnPrimaryText}`}
                            onClick={() =>
                              startGlobalSubpageTutorial(
                                item.id,
                                item.path,
                                item.prompt
                              )
                            }
                          >
                            深入互動導覽
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className={`h-7 px-2.5 text-[11px] ${s.btnOutline} ${s.btnOutlineText}`}
                            onClick={() => {
                              startInteractiveOrbStep({
                                tutorialId: item.id,
                                stepId: `${item.id}-goto`,
                                stepTitle: `帶我前往 ${item.title}`,
                                stepDescription:
                                  "先快速介紹這一頁的用途，再帶我前往並指出第一個建議操作",
                                targetPath: item.path,
                                sectionLabel: "全頁子頁面教學總覽",
                                customPrompt: `請啟動「${item.title}」逐站深入導覽。先問我目前目標與時程，再帶我進入頁面 ${item.path}，並指定第一個要完成的操作與驗收標準。`,
                              });
                            }}
                          >
                            光球帶我進站
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-2 mb-3">
                  <div
                    className="rounded-xl border p-3 sm:p-4"
                    style={{
                      borderColor: s.cardBorder,
                      background: s.featureBg,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className={`text-sm font-semibold ${s.textPrimary}`}>
                        創作工作室捷徑
                      </p>
                      <span
                        className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                        style={{ background: s.cardBg }}
                      >
                        Studio Launchpad
                      </span>
                    </div>
                    <p className={`text-xs mb-3 ${s.textMuted}`}>
                      把首頁導覽先整理成四個最常用入口，先啟動再深入細節。
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        className={`h-8 text-[11px] ${s.btnPrimary} ${s.btnPrimaryText}`}
                        onClick={startDirectorAITutorial}
                      >
                        導演 AI
                      </Button>
                      <Button
                        size="sm"
                        className={`h-8 text-[11px] ${s.btnPrimary} ${s.btnPrimaryText}`}
                        onClick={startMusicVoiceStudioTutorial}
                      >
                        音樂配音
                      </Button>
                      <Button
                        size="sm"
                        className={`h-8 text-[11px] ${s.btnPrimary} ${s.btnPrimaryText}`}
                        onClick={startVideoStudioTutorial}
                      >
                        影片工作室
                      </Button>
                      <Button
                        size="sm"
                        className={`h-8 text-[11px] ${s.btnPrimary} ${s.btnPrimaryText}`}
                        onClick={startImageStudioTutorial}
                      >
                        圖片工作室
                      </Button>
                    </div>
                  </div>

                  <div
                    className="rounded-xl border p-3 sm:p-4"
                    style={{
                      borderColor: s.cardBorder,
                      background: s.featureBg,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className={`text-sm font-semibold ${s.textPrimary}`}>
                        光球新手路徑
                      </p>
                      <span
                        className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                        style={{ background: s.cardBg }}
                      >
                        Agent First
                      </span>
                    </div>
                    <p className={`text-xs mb-3 ${s.textMuted}`}>
                      先用光球代理建立目標與任務，再進工作室執行會更順。
                    </p>
                    <div className="space-y-2">
                      <Button
                        size="sm"
                        className={`w-full h-8 justify-start text-[11px] ${s.btnPrimary} ${s.btnPrimaryText}`}
                        onClick={startOrbGuidedOnboarding}
                      >
                        啟動光球新手帶路
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className={`w-full h-8 justify-start text-[11px] ${s.btnOutline} ${s.btnOutlineText}`}
                        onClick={() =>
                          startOrbBootcamp(
                            ORB_BOOTCAMP_PLANS[0].prompt,
                            ORB_BOOTCAMP_PLANS[0].id
                          )
                        }
                      >
                        啟動代理 Bootcamp
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className={`w-full h-8 justify-start text-[11px] ${s.btnOutline} ${s.btnOutlineText}`}
                        onClick={() =>
                          copyOrbPrompt(
                            "帶我快速上手，先幫我拆成 3 個今天可完成的任務。"
                          )
                        }
                      >
                        複製通用上手指令
                      </Button>
                    </div>
                  </div>

                  <div
                    className="rounded-xl border p-3 sm:p-4"
                    style={{
                      borderColor: s.cardBorder,
                      background: s.featureBg,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className={`text-sm font-semibold ${s.textPrimary}`}>
                        上手模式
                      </p>
                      <span
                        className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                        style={{ background: s.cardBg }}
                      >
                        {selectedTrack.eta}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                      {HOME_CREATIVE_TRACKS.map(track => {
                        const isSelected = selectedTrack.id === track.id;
                        return (
                          <button
                            key={track.id}
                            type="button"
                            onClick={() => {
                              setSelectedTrackId(track.id);
                              localStorage.setItem(
                                "home-onboarding-track-v1",
                                track.id
                              );
                            }}
                            className={`rounded-md border px-2 py-1.5 text-left text-[11px] transition-all ${isSelected ? "ring-1 ring-current" : ""} ${s.textPrimary}`}
                            style={{
                              borderColor: s.cardBorder,
                              background: s.cardBg,
                            }}
                          >
                            <p className="font-medium">{track.title}</p>
                            <p className={`mt-0.5 ${s.textMuted}`}>
                              {track.summary}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div
                    className="rounded-xl border p-3 sm:p-4"
                    style={{
                      borderColor: s.cardBorder,
                      background: s.featureBg,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className={`text-sm font-semibold ${s.textPrimary}`}>
                        任務進度摘要
                      </p>
                      <span
                        className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                        style={{ background: s.cardBg }}
                      >
                        {completedMissions.length}/
                        {HOME_ONBOARDING_MISSIONS.length}
                      </span>
                    </div>
                    <div
                      className="h-2 rounded-full overflow-hidden mb-2"
                      style={{ background: s.cardBg }}
                    >
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${onboardingProgressPercent}%`,
                          background: s.glowColor,
                        }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      {HOME_ONBOARDING_MISSIONS.slice(0, 3).map(
                        (mission, index) => {
                          const done = completedMissions.includes(mission.id);
                          return (
                            <div
                              key={mission.id}
                              className="rounded-md border px-2 py-1.5 flex items-center justify-between gap-2"
                              style={{
                                borderColor: s.cardBorder,
                                background: s.cardBg,
                              }}
                            >
                              <p className={`text-[11px] ${s.textPrimary}`}>
                                {done ? "✅" : `0${index + 1}`} ·{" "}
                                {mission.title}
                              </p>
                              <Button
                                size="sm"
                                variant={done ? "outline" : "default"}
                                className={`h-6 px-2 text-[10px] ${done ? `${s.btnOutline} ${s.btnOutlineText}` : `${s.btnPrimary} ${s.btnPrimaryText}`}`}
                                onClick={() => {
                                  completeMission(mission.id);
                                  if (!isAuthenticated) {
                                    window.location.href = getDemoLoginUrl();
                                    return;
                                  }
                                  navigate(mission.path);
                                }}
                              >
                                {done ? "再前往" : "前往"}
                              </Button>
                            </div>
                          );
                        }
                      )}
                    </div>
                  </div>
                </div>

                <Collapsible
                  open={advancedQuickGuideOpen}
                  onOpenChange={setAdvancedQuickGuideOpen}
                  className="mb-3 rounded-xl border"
                  style={{ borderColor: s.cardBorder, background: s.featureBg }}
                >
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="w-full px-3 sm:px-4 py-3 text-left flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold ${s.textPrimary}`}>
                          進階導覽模組（可折疊）
                        </p>
                        <p className={`text-xs mt-1 ${s.textMuted}`}>
                          收納導演
                          AI、影音工作室、新手任務與上手模式，避免首頁資訊過載。
                        </p>
                      </div>
                      <ChevronsUpDown
                        className={`w-4 h-4 shrink-0 ${s.textMuted}`}
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-3 sm:px-4 pb-3 sm:pb-4">
                    <div
                      className="rounded-xl border p-3 sm:p-4 mb-3"
                      style={{
                        borderColor: s.cardBorder,
                        background: s.featureBg,
                      }}
                    >
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className={`text-sm font-semibold ${s.textPrimary}`}>
                          導演 AI 教學
                        </p>
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                          style={{ background: s.cardBg }}
                        >
                          Director AI
                        </span>
                      </div>
                      <div className="space-y-2">
                        {DIRECTOR_AI_TUTORIAL.map(step => (
                          <div
                            key={step.id}
                            className="rounded-lg border p-2.5"
                            style={{
                              borderColor: s.cardBorder,
                              background: s.cardBg,
                            }}
                          >
                            <p
                              className={`text-xs sm:text-sm font-medium ${s.textPrimary}`}
                            >
                              {step.title}
                            </p>
                            <p className={`text-xs mt-1 ${s.textMuted}`}>
                              {step.description}
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className={`h-7 px-2.5 mt-2 text-[11px] ${s.btnOutline} ${s.btnOutlineText}`}
                              onClick={() =>
                                startInteractiveOrbStep({
                                  tutorialId: "director-ai",
                                  stepId: step.id,
                                  stepTitle: step.title,
                                  stepDescription: step.description,
                                  targetPath: "/director",
                                  sectionLabel: "導演 AI 教學",
                                })
                              }
                            >
                              互動式導覽這一步
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-col sm:flex-row gap-2">
                        <Button
                          size="sm"
                          className={`rounded-xl text-xs sm:text-sm gap-1.5 ${s.btnPrimary} ${s.btnPrimaryText}`}
                          onClick={startDirectorAITutorial}
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          啟動導演 AI 教學
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className={`rounded-xl text-xs sm:text-sm gap-1.5 ${s.btnOutline} ${s.btnOutlineText}`}
                          onClick={() =>
                            copyOrbPrompt(
                              "請把我的需求拆成導演 AI 任務：分鏡、素材、配樂、旁白、字幕與時間軸。"
                            )
                          }
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          複製導演 AI 指令
                        </Button>
                      </div>
                    </div>

                    <div
                      className="rounded-xl border p-3 sm:p-4 mb-3"
                      style={{
                        borderColor: s.cardBorder,
                        background: s.featureBg,
                      }}
                    >
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className={`text-sm font-semibold ${s.textPrimary}`}>
                          音樂配音工作室教學
                        </p>
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                          style={{ background: s.cardBg }}
                        >
                          Music & Voice
                        </span>
                      </div>
                      <div className="space-y-2">
                        {MUSIC_VOICE_STUDIO_TUTORIAL.map(step => (
                          <div
                            key={step.id}
                            className="rounded-lg border p-2.5"
                            style={{
                              borderColor: s.cardBorder,
                              background: s.cardBg,
                            }}
                          >
                            <p
                              className={`text-xs sm:text-sm font-medium ${s.textPrimary}`}
                            >
                              {step.title}
                            </p>
                            <p className={`text-xs mt-1 ${s.textMuted}`}>
                              {step.description}
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className={`h-7 px-2.5 mt-2 text-[11px] ${s.btnOutline} ${s.btnOutlineText}`}
                              onClick={() =>
                                startInteractiveOrbStep({
                                  tutorialId: "music-voice-studio",
                                  stepId: step.id,
                                  stepTitle: step.title,
                                  stepDescription: step.description,
                                  targetPath: "/studio?tab=audio",
                                  sectionLabel: "音樂配音工作室教學",
                                })
                              }
                            >
                              互動式導覽這一步
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-col sm:flex-row gap-2">
                        <Button
                          size="sm"
                          className={`rounded-xl text-xs sm:text-sm gap-1.5 ${s.btnPrimary} ${s.btnPrimaryText}`}
                          onClick={startMusicVoiceStudioTutorial}
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          啟動音樂配音教學
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className={`rounded-xl text-xs sm:text-sm gap-1.5 ${s.btnOutline} ${s.btnOutlineText}`}
                          onClick={() =>
                            copyOrbPrompt(
                              "請幫我生成配樂與旁白指令，含 BPM、情緒、語速、段落與轉折。"
                            )
                          }
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          複製音樂配音指令
                        </Button>
                      </div>
                    </div>

                    <div
                      className="rounded-xl border p-3 sm:p-4 mb-3"
                      style={{
                        borderColor: s.cardBorder,
                        background: s.featureBg,
                      }}
                    >
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className={`text-sm font-semibold ${s.textPrimary}`}>
                          影片工作室教學
                        </p>
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                          style={{ background: s.cardBg }}
                        >
                          Video Studio
                        </span>
                      </div>
                      <div className="space-y-2">
                        {VIDEO_STUDIO_TUTORIAL.map(step => (
                          <div
                            key={step.id}
                            className="rounded-lg border p-2.5"
                            style={{
                              borderColor: s.cardBorder,
                              background: s.cardBg,
                            }}
                          >
                            <p
                              className={`text-xs sm:text-sm font-medium ${s.textPrimary}`}
                            >
                              {step.title}
                            </p>
                            <p className={`text-xs mt-1 ${s.textMuted}`}>
                              {step.description}
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className={`h-7 px-2.5 mt-2 text-[11px] ${s.btnOutline} ${s.btnOutlineText}`}
                              onClick={() =>
                                startInteractiveOrbStep({
                                  tutorialId: "video-studio",
                                  stepId: step.id,
                                  stepTitle: step.title,
                                  stepDescription: step.description,
                                  targetPath: "/video-studio",
                                  sectionLabel: "影片工作室教學",
                                })
                              }
                            >
                              互動式導覽這一步
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-col sm:flex-row gap-2">
                        <Button
                          size="sm"
                          className={`rounded-xl text-xs sm:text-sm gap-1.5 ${s.btnPrimary} ${s.btnPrimaryText}`}
                          onClick={startVideoStudioTutorial}
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          啟動影片工作室教學
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className={`rounded-xl text-xs sm:text-sm gap-1.5 ${s.btnOutline} ${s.btnOutlineText}`}
                          onClick={() =>
                            copyOrbPrompt(
                              "請幫我生成影片 prompt 與 3 鏡分鏡，含鏡頭運動、轉場、字幕語氣。"
                            )
                          }
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          複製影片 prompt 指令
                        </Button>
                      </div>
                    </div>

                    <div
                      className="rounded-xl border p-3 sm:p-4 mb-3"
                      style={{
                        borderColor: s.cardBorder,
                        background: s.featureBg,
                      }}
                    >
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className={`text-sm font-semibold ${s.textPrimary}`}>
                          圖片創作室教學
                        </p>
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                          style={{ background: s.cardBg }}
                        >
                          Image Studio
                        </span>
                      </div>
                      <div className="space-y-2">
                        {IMAGE_STUDIO_TUTORIAL.map(step => (
                          <div
                            key={step.id}
                            className="rounded-lg border p-2.5"
                            style={{
                              borderColor: s.cardBorder,
                              background: s.cardBg,
                            }}
                          >
                            <p
                              className={`text-xs sm:text-sm font-medium ${s.textPrimary}`}
                            >
                              {step.title}
                            </p>
                            <p className={`text-xs mt-1 ${s.textMuted}`}>
                              {step.description}
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className={`h-7 px-2.5 mt-2 text-[11px] ${s.btnOutline} ${s.btnOutlineText}`}
                              onClick={() =>
                                startInteractiveOrbStep({
                                  tutorialId: "image-studio",
                                  stepId: step.id,
                                  stepTitle: step.title,
                                  stepDescription: step.description,
                                  targetPath: "/image-studio",
                                  sectionLabel: "圖片創作室教學",
                                })
                              }
                            >
                              互動式導覽這一步
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-col sm:flex-row gap-2">
                        <Button
                          size="sm"
                          className={`rounded-xl text-xs sm:text-sm gap-1.5 ${s.btnPrimary} ${s.btnPrimaryText}`}
                          onClick={startImageStudioTutorial}
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          啟動圖片創作室教學
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className={`rounded-xl text-xs sm:text-sm gap-1.5 ${s.btnOutline} ${s.btnOutlineText}`}
                          onClick={() =>
                            copyOrbPrompt(
                              "請幫我產生圖片創作 prompt，含主體、風格、構圖、光線四要素。"
                            )
                          }
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          複製圖片 prompt 指令
                        </Button>
                      </div>
                    </div>

                    <div
                      className="rounded-xl border p-3 sm:p-4 mb-3"
                      style={{
                        borderColor: s.cardBorder,
                        background: s.featureBg,
                      }}
                    >
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className={`text-sm font-semibold ${s.textPrimary}`}>
                          光球代理啟動教學（全站 & 建立工作室）
                        </p>
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                          style={{ background: s.cardBg }}
                        >
                          Bootcamp
                        </span>
                      </div>
                      <div className="space-y-2">
                        {ORB_BOOTCAMP_PLANS.map(plan => (
                          <div
                            key={plan.id}
                            className="rounded-lg border p-3"
                            style={{
                              borderColor: s.cardBorder,
                              background: s.cardBg,
                            }}
                          >
                            <p
                              className={`text-xs sm:text-sm font-medium ${s.textPrimary}`}
                            >
                              {plan.title}
                            </p>
                            <p className={`text-xs mt-1 ${s.textMuted}`}>
                              {plan.description}
                            </p>
                            <div className="mt-2 flex flex-col sm:flex-row gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className={`h-7 px-2.5 text-[11px] ${s.btnOutline} ${s.btnOutlineText}`}
                                onClick={() => copyOrbPrompt(plan.prompt)}
                              >
                                <MessageCircle className="w-3.5 h-3.5 mr-1" />
                                複製教學指令
                              </Button>
                              <Button
                                size="sm"
                                className={`h-7 px-2.5 text-[11px] ${s.btnPrimary} ${s.btnPrimaryText}`}
                                onClick={() =>
                                  startOrbBootcamp(plan.prompt, plan.id)
                                }
                              >
                                啟動這個教學
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div
                      className="rounded-xl border p-3 sm:p-4 mb-3"
                      style={{
                        borderColor: s.cardBorder,
                        background: s.featureBg,
                      }}
                    >
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className={`text-sm font-semibold ${s.textPrimary}`}>
                          光球帶路新手流程（先代理、再工作室）
                        </p>
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                          style={{ background: s.cardBg }}
                        >
                          Agent → Studio
                        </span>
                      </div>
                      <div className="space-y-2">
                        {ORB_GUIDED_ONBOARDING_FLOW.map(flow => (
                          <div
                            key={flow.id}
                            className="rounded-lg border p-2.5"
                            style={{
                              borderColor: s.cardBorder,
                              background: s.cardBg,
                            }}
                          >
                            <p
                              className={`text-xs sm:text-sm font-medium ${s.textPrimary}`}
                            >
                              {flow.title}
                            </p>
                            <p className={`text-xs mt-1 ${s.textMuted}`}>
                              {flow.description}
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              className={`h-7 px-2.5 mt-2 text-[11px] ${s.btnOutline} ${s.btnOutlineText}`}
                              onClick={() =>
                                startInteractiveOrbStep({
                                  tutorialId: "orb-guided-onboarding",
                                  stepId: flow.id,
                                  stepTitle: flow.title,
                                  stepDescription: flow.description,
                                  sectionLabel: "光球帶路新手流程",
                                })
                              }
                            >
                              互動式導覽這一步
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-col sm:flex-row gap-2">
                        <Button
                          size="sm"
                          className={`rounded-xl text-xs sm:text-sm gap-1.5 ${s.btnPrimary} ${s.btnPrimaryText}`}
                          onClick={startOrbGuidedOnboarding}
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          啟動光球新手帶路
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className={`rounded-xl text-xs sm:text-sm gap-1.5 ${s.btnOutline} ${s.btnOutlineText}`}
                          onClick={() => {
                            if (!isAuthenticated) {
                              window.location.href = getDemoLoginUrl();
                              return;
                            }
                            navigate("/image-studio");
                          }}
                        >
                          直接去創作工作室
                        </Button>
                      </div>
                    </div>

                    <div
                      className="rounded-xl border p-3 sm:p-4 mb-3"
                      style={{
                        borderColor: s.cardBorder,
                        background: s.featureBg,
                      }}
                    >
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className={`text-sm font-semibold ${s.textPrimary}`}>
                          全站光球代理優先教學（先學這塊）
                        </p>
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                          style={{ background: s.cardBg }}
                        >
                          進度 {completedOrbLessons.length}/
                          {ORB_AGENT_LESSONS.length}
                        </span>
                      </div>
                      <div className="mb-3">
                        <div
                          className="h-2 rounded-full overflow-hidden"
                          style={{ background: s.cardBg }}
                        >
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${orbLessonProgress}%`,
                              background: s.glowColor,
                            }}
                          />
                        </div>
                        <p className={`text-[11px] mt-1 ${s.textMuted}`}>
                          完成這 3 步後，再進入工作室會更順：目前{" "}
                          {orbLessonProgress}%。
                        </p>
                      </div>
                      <div className="space-y-2">
                        {ORB_AGENT_LESSONS.map((lesson, index) => {
                          const done = completedOrbLessons.includes(lesson.id);
                          return (
                            <div
                              key={lesson.id}
                              className="rounded-lg border p-3"
                              style={{
                                borderColor: s.cardBorder,
                                background: s.cardBg,
                              }}
                            >
                              <p
                                className={`text-xs sm:text-sm font-medium ${s.textPrimary}`}
                              >
                                {done ? "✅" : `0${index + 1}`} · {lesson.title}
                              </p>
                              <p className={`text-xs mt-1 ${s.textMuted}`}>
                                {lesson.description}
                              </p>
                              <div
                                className="rounded-md border px-2.5 py-2 mt-2"
                                style={{
                                  borderColor: s.cardBorder,
                                  background: s.featureBg,
                                }}
                              >
                                <p className={`text-[11px] ${s.textMuted}`}>
                                  練習句型：{lesson.example}
                                </p>
                              </div>
                              <div className="mt-2 flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className={`h-7 px-2.5 text-[11px] ${s.btnOutline} ${s.btnOutlineText}`}
                                  onClick={() => copyOrbPrompt(lesson.example)}
                                >
                                  <MessageCircle className="w-3.5 h-3.5 mr-1" />
                                  複製句型
                                </Button>
                                <Button
                                  size="sm"
                                  className={`h-7 px-2.5 text-[11px] ${s.btnPrimary} ${s.btnPrimaryText}`}
                                  onClick={() => {
                                    completeOrbLesson(lesson.id);
                                    if (!isAuthenticated) {
                                      window.location.href = getDemoLoginUrl();
                                      return;
                                    }
                                    navigate("/agent");
                                  }}
                                >
                                  {done ? "再用光球練習" : "用光球練習"}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div
                      className="rounded-xl border p-3 sm:p-4 mb-3"
                      style={{
                        borderColor: s.cardBorder,
                        background: s.featureBg,
                      }}
                    >
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className={`text-sm font-semibold ${s.textPrimary}`}>
                          先選你的上手模式
                        </p>
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                          style={{ background: s.cardBg }}
                        >
                          深度整合光球代理
                        </span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {HOME_CREATIVE_TRACKS.map(track => {
                          const isSelected = selectedTrack.id === track.id;
                          return (
                            <button
                              key={track.id}
                              type="button"
                              onClick={() => {
                                setSelectedTrackId(track.id);
                                localStorage.setItem(
                                  "home-onboarding-track-v1",
                                  track.id
                                );
                              }}
                              className={`text-left rounded-lg border p-3 transition-all ${
                                isSelected ? "ring-1 ring-current" : ""
                              } ${s.textPrimary}`}
                              style={{
                                borderColor: s.cardBorder,
                                background: s.cardBg,
                              }}
                            >
                              <p className="text-sm font-medium">
                                {track.title}
                              </p>
                              <p className={`text-xs mt-1 ${s.textMuted}`}>
                                {track.summary}
                              </p>
                              <p
                                className={`text-[11px] mt-2 inline-flex items-center gap-1 ${s.textSecondary}`}
                              >
                                <Gauge className="w-3 h-3" />
                                {track.eta}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                      <div
                        className="rounded-lg border p-3 mt-3"
                        style={{
                          borderColor: s.cardBorder,
                          background: s.featureBg,
                        }}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <p className={`text-xs sm:text-sm ${s.textMuted}`}>
                            建議你先對光球代理說：
                            <span
                              className={`font-medium ml-1 ${s.textPrimary}`}
                            >
                              「{selectedTrack.orbPrompt}」
                            </span>
                          </p>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className={`h-7 px-2.5 text-[11px] ${s.btnOutline} ${s.btnOutlineText}`}
                              onClick={() =>
                                copyOrbPrompt(selectedTrack.orbPrompt)
                              }
                            >
                              <MessageCircle className="w-3.5 h-3.5 mr-1" />
                              複製對話
                            </Button>
                            <Button
                              size="sm"
                              className={`h-7 px-2.5 text-[11px] ${s.btnPrimary} ${s.btnPrimaryText}`}
                              onClick={() => {
                                if (!isAuthenticated) {
                                  window.location.href = getDemoLoginUrl();
                                  return;
                                }
                                navigate(selectedTrack.recommendedPath);
                              }}
                            >
                              依此模式開始
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      className="rounded-xl border p-3 sm:p-4 mb-3"
                      style={{
                        borderColor: s.cardBorder,
                        background: s.featureBg,
                      }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-xs font-medium ${s.textPrimary}`}
                        >
                          平台現況：
                        </span>
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                          style={{ background: s.cardBg }}
                        >
                          {isAuthenticated
                            ? "已登入，可直接啟動全站光球代理"
                            : "未登入，建議先用訪客體驗"}
                        </span>
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                          style={{ background: s.cardBg }}
                        >
                          {intentResult?.intentType
                            ? `目前意圖：${intentResult.intentType}`
                            : isIntentInferring
                              ? "正在分析你的探索意圖…"
                              : "尚未偵測到明確意圖"}
                        </span>
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                          style={{ background: s.cardBg }}
                        >
                          推薦下一步：
                          {isAuthenticated
                            ? "先跟光球說你的創作目標"
                            : "先按「先體驗光球代理」"}
                        </span>
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                          style={{ background: s.cardBg }}
                        >
                          你的上手模式：{selectedTrack.title}
                        </span>
                      </div>
                    </div>

                    <div
                      className="rounded-xl border p-3 sm:p-4 mb-3"
                      style={{
                        borderColor: s.cardBorder,
                        background: s.featureBg,
                      }}
                    >
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className={`text-sm font-semibold ${s.textPrimary}`}>
                          新手任務清單（操作導向）
                        </p>
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full ${s.textSecondary}`}
                          style={{ background: s.cardBg }}
                        >
                          完成 {completedMissions.length}/
                          {HOME_ONBOARDING_MISSIONS.length}
                        </span>
                      </div>
                      <div className="mb-3">
                        <div
                          className="h-2 rounded-full overflow-hidden"
                          style={{ background: s.cardBg }}
                          aria-label="onboarding-progress"
                        >
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${onboardingProgressPercent}%`,
                              background: s.glowColor,
                            }}
                          />
                        </div>
                        <p className={`text-[11px] mt-1 ${s.textMuted}`}>
                          目前進度 {onboardingProgressPercent}%：完成 3
                          個任務後，建議開始建立個人模板。
                        </p>
                      </div>
                      <div className="space-y-2">
                        {HOME_ONBOARDING_MISSIONS.map((mission, index) => {
                          const done = completedMissions.includes(mission.id);
                          return (
                            <div
                              key={mission.id}
                              className="rounded-lg border p-2.5 sm:p-3"
                              style={{
                                borderColor: s.cardBorder,
                                background: s.cardBg,
                              }}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p
                                    className={`text-xs sm:text-sm font-medium ${s.textPrimary}`}
                                  >
                                    {done ? "✅" : `0${index + 1}`} ·{" "}
                                    {mission.title}
                                  </p>
                                  <p className={`text-xs mt-1 ${s.textMuted}`}>
                                    {mission.description}
                                  </p>
                                </div>
                                <Button
                                  size="sm"
                                  variant={done ? "outline" : "default"}
                                  className={`h-7 px-2.5 text-[11px] shrink-0 ${done ? `${s.btnOutline} ${s.btnOutlineText}` : `${s.btnPrimary} ${s.btnPrimaryText}`}`}
                                  onClick={() => {
                                    completeMission(mission.id);
                                    if (!isAuthenticated) {
                                      window.location.href = getDemoLoginUrl();
                                      return;
                                    }
                                    navigate(mission.path);
                                  }}
                                >
                                  {done ? "再前往" : "立即前往"}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <div className="space-y-2">
                  {HOME_QUICKSTART_GUIDE.map(block => {
                    const isOpen = openGuideId === block.id;
                    const Icon = block.icon;
                    return (
                      <Collapsible
                        key={block.id}
                        open={isOpen}
                        onOpenChange={open =>
                          setOpenGuideId(open ? block.id : null)
                        }
                        className="rounded-xl overflow-hidden"
                        style={{
                          border: `1px solid ${s.cardBorder}`,
                          background: s.featureBg,
                        }}
                      >
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="w-full px-3 sm:px-4 py-3 text-left flex items-center justify-between gap-3"
                          >
                            <div className="flex items-start gap-2.5 sm:gap-3 min-w-0">
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-black/10">
                                <Icon
                                  className={`w-4 h-4 ${s.textSecondary}`}
                                />
                              </div>
                              <div className="min-w-0">
                                <p
                                  className={`text-sm font-medium transition-colors duration-1000 ${s.textPrimary}`}
                                >
                                  {block.title}
                                </p>
                                <p
                                  className={`text-xs mt-0.5 transition-colors duration-1000 ${s.textMuted}`}
                                >
                                  {block.description}
                                </p>
                              </div>
                            </div>
                            <ChevronsUpDown
                              className={`w-4 h-4 shrink-0 transition-colors duration-1000 ${s.textMuted}`}
                            />
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="px-4 pb-3 sm:pb-4">
                          <ul
                            className={`list-disc pl-5 space-y-1.5 text-xs sm:text-sm transition-colors duration-1000 ${s.textMuted}`}
                          >
                            {block.items.map(item => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

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
                      onClick={() => navigate("/agent")}
                      className={`rounded-2xl h-11 sm:h-12 px-8 sm:px-10 gap-2 text-sm btn-healing ${s.btnPrimary} ${s.btnPrimaryText}`}
                    >
                      啟動全站光球代理
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
