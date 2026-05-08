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
  ChevronRight,
  GitBranch,
  Workflow,
  Network,
  Brain,
  Route,
  AlertTriangle,
  RefreshCw,
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
    meta: "輸出 5 秒短片 · 約 60-120 秒",
    tool: "videoStudio.klingTextToVideo",
    liveGenerate: true,
  },
  {
    id: "music",
    label: "音樂",
    icon: Music,
    tint: "rgba(236,72,153,0.85)",
    glow: "rgba(236,72,153,0.55)",
    prompt: "冷冽雨夜，慢板鋼琴主旋律 + 弦樂氛圍墊底，BPM 72",
    meta: "輸出原創曲 · 約 30-60 秒",
    tool: "proStudio.textToMusic",
    liveGenerate: true,
  },
  {
    id: "voice",
    label: "配音",
    icon: Mic,
    tint: "rgba(249,115,22,0.85)",
    glow: "rgba(249,115,22,0.5)",
    prompt: "在每一次的呼吸之間，世界都重新誕生一次。",
    meta: "輸出 1 段配音 · 約 10-20 秒",
    tool: "proStudio.qwenTTS",
    liveGenerate: true,
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
  demoForm: "quick" | "multimodal" | "multi-step" | "style";
  label: string;
  eta: string;
  summary: string;
  prompt: string;
  runbook: {
    perceive: string;
    plan: string;
    tools: string;
    output: string;
  };
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: "brand-short-film",
    modeId: "director",
    demoForm: "multimodal",
    label: "品牌形象短片",
    eta: "20-30 分鐘",
    summary: "代理拆鏡 + 配樂 + 字幕一次到位",
    prompt:
      "幫我做一支 20 秒品牌形象短片，溫暖療癒、自動分鏡、配樂、繁中字幕。",
    runbook: {
      perceive: "辨識品牌調性、受眾與投放平台，先判斷是導演多模態流程。",
      plan: "拆成分鏡、主視覺、配樂、字幕四段任務，依相依順序排程。",
      tools: "先呼叫導演規劃，再串圖片/影片/音樂/配音工具並追蹤 queue。",
      output: "回傳可重跑版本、素材清單、每段耗時與下一步微調建議。",
    },
  },
  {
    id: "product-key-visual",
    modeId: "image",
    demoForm: "quick",
    label: "商品主視覺",
    eta: "8-12 分鐘",
    summary: "代理產出多版可比較設計稿",
    prompt:
      "極簡質感商品攝影，純色背景、柔光、淺景深、4K，產出 4 版差異稿。",
    runbook: {
      perceive: "解析產品類型與風格關鍵詞，判定以圖片模式為主。",
      plan: "建立 4 組風格差異（構圖、光線、鏡頭語言）快速並行。",
      tools: "呼叫圖片生成工具，失敗自動重試並保留最佳候選。",
      output: "輸出可比較版本與推薦首選，附下一輪優化提示詞。",
    },
  },
  {
    id: "social-short",
    modeId: "video",
    demoForm: "quick",
    label: "社群短影音",
    eta: "10-15 分鐘",
    summary: "9:16 直式，自動節奏點與字幕",
    prompt:
      "15 秒 9:16 社群短影音，霓虹城市夜景慢推軌，自動節奏點切換、配字幕。",
    runbook: {
      perceive: "判斷社群平台與直式比例，映射到短影音模板。",
      plan: "先做節奏與分鏡，再進入單支 15 秒影片生成與字幕對齊。",
      tools: "呼叫影片生成並輪詢 fal queue，完成後補字幕節點。",
      output: "交付可直接發佈短片與字幕稿，含下一版節奏調整建議。",
    },
  },
  {
    id: "podcast-music",
    modeId: "music",
    demoForm: "multimodal",
    label: "Podcast 配樂與旁白",
    eta: "10-15 分鐘",
    summary: "原創配樂 + 語音克隆旁白",
    prompt:
      "Podcast 開場 30 秒原創配樂，BPM 76、慢板鋼琴 + 弦樂氛圍，搭配溫暖女聲旁白。",
    runbook: {
      perceive: "辨識音樂 + 配音雙模態，先做風格一致性約束。",
      plan: "先生成配樂情緒曲線，再套旁白語速與停頓。",
      tools: "依序呼叫 text-to-music 與 qwenTTS，最後做音量平衡。",
      output: "輸出混音結果與分軌素材，方便後續剪輯。",
    },
  },
  {
    id: "character-series",
    modeId: "lora",
    demoForm: "style",
    label: "角色一致系列圖",
    eta: "25-40 分鐘",
    summary: "LoRA 鎖風格，跨作品一致",
    prompt:
      "上傳 12 張參考圖，訓練專屬角色 LoRA，後續以同一造型產出 6 張系列圖。",
    runbook: {
      perceive: "檢查參考圖品質與角色一致性，評估可訓練性。",
      plan: "先訓練 LoRA，再建立系列圖任務與風格約束。",
      tools: "呼叫 LoRA 訓練流程，完成後回切圖片生成批次出圖。",
      output: "交付模型代碼、最佳觸發詞與系列圖結果。",
    },
  },
  {
    id: "campaign-pack",
    modeId: "director",
    demoForm: "multi-step",
    label: "完整行銷素材包",
    eta: "30-45 分鐘",
    summary: "主視覺 + 短片 + 配樂 + 旁白",
    prompt:
      "產出完整行銷素材包：主視覺、15 秒短片、30 秒配樂、繁中旁白，跨格式同步。",
    runbook: {
      perceive: "判斷是跨工具多步驟專案，需先建立里程碑與依賴。",
      plan: "先主視覺、再短片、再配樂與旁白，最後做跨素材一致性檢查。",
      tools: "混合呼叫導演、圖片、影片、音樂與配音工具並集中追蹤狀態。",
      output: "回傳完整素材包、交付清單、風險與重跑入口。",
    },
  },
] as const;

interface DemoForm {
  id: "quick" | "multimodal" | "multi-step" | "style";
  label: string;
  description: string;
  layers: { name: string; detail: string }[];
}

const DEMO_FORMS: readonly DemoForm[] = [
  {
    id: "quick",
    label: "快啟演示",
    description: "一句話 → 直送單一工具 → 8 秒內出第一版可用素材。",
    layers: [
      { name: "感應層", detail: "解析輸入語意，鎖定唯一模態（圖／影／音）。" },
      { name: "派工層", detail: "直送對應工具，省去跨工具編排成本。" },
      { name: "回收層", detail: "輪詢 fal queue → 取回成品與可重跑 seed。" },
    ],
  },
  {
    id: "multimodal",
    label: "多模態演示",
    description: "同時處理圖／影／音／配音 — 跨模態風格與情緒一致。",
    layers: [
      { name: "感應層", detail: "辨識多模態需求，先建立風格與情緒錨點。" },
      { name: "規劃層", detail: "依模態相依排程：先主視覺 → 短片 → 音樂 → 旁白。" },
      { name: "派工層", detail: "並行呼叫圖片、影片、音樂、配音工具。" },
      { name: "對齊層", detail: "字幕節拍、色票、人聲音量自動對齊主視覺。" },
      { name: "交付層", detail: "回傳整包素材 + 跨模態一致性報告。" },
    ],
  },
  {
    id: "multi-step",
    label: "多步驟演示",
    description: "拆解里程碑 → 多階段 DAG → 失敗自動重試與恢復。",
    layers: [
      { name: "感應層", detail: "識別跨工具專案，估算總時長與成本守門。" },
      { name: "規劃層", detail: "建立有向相依（DAG）與里程碑檢核點。" },
      { name: "派工層", detail: "依序呼叫導演、圖片、影片、音樂、配音。" },
      { name: "監看層", detail: "監看每段 queue，失敗自動重試並保留最佳候選。" },
      { name: "交付層", detail: "回傳成品包 + 重跑配方 + 風險與下一步建議。" },
    ],
  },
  {
    id: "style",
    label: "風格一致演示",
    description: "用 LoRA 鎖角色與風格 — 跨作品同一造型不走鐘。",
    layers: [
      { name: "感應層", detail: "讀取參考圖集，量化角色／風格一致性指標。" },
      { name: "規劃層", detail: "決定 rank / steps / 觸發詞與訓練預算。" },
      { name: "訓練層", detail: "監看 loss 曲線並自動取樣驗證收斂。" },
      { name: "驗證層", detail: "跨景測試臉部、服裝與光線一致性。" },
      { name: "交付層", detail: "輸出 LoRA 權重 + 觸發詞 + 推薦 prompt。" },
    ],
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
  // Each card represents a different cinematographic interpretation that the
  // agent would dispatch in parallel — shot type, lens, palette, subject pos.
  const variants = [
    {
      shot: "CU",
      lens: "85mm f/1.4",
      mood: "戲劇",
      subject: { x: 32, y: 48 },
      palette: ["#1f1535", "#7e3ad6", "#fde7c1"],
    },
    {
      shot: "MS",
      lens: "50mm f/1.8",
      mood: "情緒",
      subject: { x: 65, y: 58 },
      palette: ["#231a3a", "#a85cd8", "#fdb1a7"],
    },
    {
      shot: "WS",
      lens: "35mm f/2.0",
      mood: "氛圍",
      subject: { x: 50, y: 70 },
      palette: ["#3a2255", "#c478e8", "#fdf0d7"],
    },
    {
      shot: "OTS",
      lens: "24mm f/2.8",
      mood: "敘事",
      subject: { x: 38, y: 60 },
      palette: ["#101a3a", "#5a8de8", "#cfe1ff"],
    },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-1.5 w-full h-full p-1">
      {variants.map((v, i) => (
        <motion.div
          key={i}
          className="rounded-lg relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${v.palette[0]} 0%, ${v.palette[1]} 60%, ${v.palette[2]} 100%)`,
            border: `1px solid ${tint}`,
          }}
          initial={{ opacity: 0, scale: 0.9, filter: "blur(8px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          transition={{ delay: 0.15 + i * 0.12, duration: 0.5 }}
        >
          {/* Rule-of-thirds composition guide */}
          <div
            className="absolute inset-0 pointer-events-none opacity-30"
            style={{
              backgroundImage:
                "linear-gradient(to right, transparent 32.66%, rgba(255,255,255,0.5) 32.66%, rgba(255,255,255,0.5) 33.33%, transparent 33.33%, transparent 66%, rgba(255,255,255,0.5) 66%, rgba(255,255,255,0.5) 66.66%, transparent 66.66%), linear-gradient(to bottom, transparent 32.66%, rgba(255,255,255,0.5) 32.66%, rgba(255,255,255,0.5) 33.33%, transparent 33.33%, transparent 66%, rgba(255,255,255,0.5) 66%, rgba(255,255,255,0.5) 66.66%, transparent 66.66%)",
            }}
          />
          {/* Subject silhouette — positioned per rule-of-thirds intersection */}
          <div
            className="absolute rounded-full pointer-events-none"
            style={{
              left: `${v.subject.x}%`,
              top: `${v.subject.y}%`,
              width: "32%",
              height: "38%",
              background: `radial-gradient(circle, rgba(255,255,255,0.9) 0%, ${v.palette[2]}88 55%, transparent 100%)`,
              transform: "translate(-50%, -50%)",
              filter: "blur(3px)",
            }}
          />
          {/* Shot label */}
          <div
            className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[8px] font-mono font-semibold tracking-wider"
            style={{
              background: "rgba(0,0,0,0.65)",
              color: "#fff",
              border: `1px solid ${tint}`,
              backdropFilter: "blur(4px)",
            }}
          >
            {v.shot}
          </div>
          {/* Variant badge */}
          <div
            className="absolute top-1 right-1 px-1.5 py-0.5 rounded-full text-[8px] font-semibold"
            style={{ background: tint, color: "#fff" }}
          >
            V{i + 1}
          </div>
          {/* Bottom info: lens, mood, palette dots */}
          <div className="absolute left-1 right-1 bottom-1 flex items-center gap-1 text-[7.5px]">
            <span
              className="px-1 py-0.5 rounded font-mono"
              style={{
                background: "rgba(0,0,0,0.6)",
                color: "rgba(255,255,255,0.95)",
                border: `1px solid ${tint}`,
                backdropFilter: "blur(4px)",
              }}
            >
              {v.lens}
            </span>
            <span
              className="px-1 py-0.5 rounded"
              style={{
                background: "rgba(0,0,0,0.6)",
                color: "rgba(255,255,255,0.95)",
                border: `1px solid ${tint}`,
                backdropFilter: "blur(4px)",
              }}
            >
              {v.mood}
            </span>
            <span className="ml-auto flex items-center gap-0.5">
              {v.palette.map((c, j) => (
                <span
                  key={j}
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background: c,
                    boxShadow: "0 0 0 1px rgba(255,255,255,0.5)",
                  }}
                />
              ))}
            </span>
          </div>
          {/* Shimmer */}
          <motion.div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.22) 50%, transparent 70%)",
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
  // Storyboard frames — each frame has a timecode, motion hint, and tone tint
  // so the preview reads as a real shot list rather than empty boxes.
  const frames = [
    { tc: "00:00", motion: "fade-in", palette: ["#0d1230", "#3b82f6"] },
    { tc: "00:01", motion: "push-in", palette: ["#142048", "#60a5fa"] },
    { tc: "00:02", motion: "tilt-up", palette: ["#1c2c5e", "#93c5fd"] },
    { tc: "00:03", motion: "track-L", palette: ["#0f1d4a", "#3b82f6"] },
    { tc: "00:04", motion: "hold", palette: ["#0a1532", "#1d4ed8"] },
  ] as const;
  return (
    <div className="flex flex-col gap-1.5 w-full h-full p-2 justify-center">
      <div className="flex gap-1.5">
        {frames.map((f, i) => (
          <motion.div
            key={i}
            className="flex-1 aspect-[3/4] rounded-md relative overflow-hidden"
            style={{
              background: `linear-gradient(160deg, ${f.palette[0]}, ${f.palette[1]})`,
              border: `1px solid ${tint}`,
            }}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
          >
            {/* subject silhouette */}
            <div
              className="absolute rounded-full"
              style={{
                left: `${30 + i * 10}%`,
                top: "55%",
                width: "38%",
                height: "30%",
                background: `radial-gradient(circle, rgba(255,255,255,0.85), ${f.palette[1]}66 60%, transparent)`,
                transform: "translate(-50%, -50%)",
                filter: "blur(2px)",
              }}
            />
            {/* timecode */}
            <span
              className="absolute top-0.5 left-0.5 text-[7.5px] font-mono px-1 py-[1px] rounded"
              style={{
                background: "rgba(0,0,0,0.6)",
                color: "#fff",
                border: `1px solid ${tint}`,
              }}
            >
              {f.tc}
            </span>
            {/* frame number */}
            <span
              className="absolute top-0.5 right-0.5 text-[7.5px] font-semibold px-1 py-[1px] rounded-full"
              style={{ background: tint, color: "#fff" }}
            >
              F{i + 1}
            </span>
            {/* motion label */}
            <span
              className="absolute left-0.5 right-0.5 bottom-0.5 text-[7.5px] font-mono text-center px-0.5 py-[1px] rounded"
              style={{
                background: "rgba(0,0,0,0.6)",
                color: "rgba(255,255,255,0.95)",
                border: `1px solid ${tint}`,
              }}
            >
              {f.motion}
            </span>
          </motion.div>
        ))}
      </div>
      {/* Timeline ruler */}
      <div className="flex items-center gap-1 mt-1 text-[8px] font-mono">
        <span style={{ color: tint }}>00:00</span>
        <div
          className="flex-1 h-1.5 rounded-full overflow-hidden relative"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              background: `linear-gradient(90deg, ${tint}, rgba(255,255,255,0.85))`,
              boxShadow: `0 0 8px ${tint}`,
            }}
            animate={{ width: ["0%", "100%"] }}
            transition={{ duration: 3.0, repeat: Infinity, ease: "linear" }}
          />
          {/* frame markers */}
          {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
            <span
              key={i}
              className="absolute top-0 bottom-0 w-px"
              style={{ left: `${p * 100}%`, background: "rgba(255,255,255,0.4)" }}
            />
          ))}
        </div>
        <span style={{ color: tint }}>00:05</span>
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
  // 5 scenes + 1 deliverables panel — each card declares its scene type so
  // viewers can read the director's plan at a glance.
  const scenes = [
    { tag: "S1", role: "開場", detail: "品牌主題", dur: "4s" },
    { tag: "S2", role: "鋪陳", detail: "情緒鋪墊", dur: "6s" },
    { tag: "S3", role: "高潮", detail: "產品特寫", dur: "5s" },
    { tag: "S4", role: "轉折", detail: "使用情境", dur: "5s" },
    { tag: "S5", role: "收束", detail: "標語+LOGO", dur: "4s" },
    { tag: "✓", role: "成品包", detail: "影 + 樂 + 字", dur: "24s" },
  ] as const;
  return (
    <div className="grid grid-cols-3 gap-1.5 w-full h-full p-2">
      {scenes.map((s, i) => (
        <motion.div
          key={i}
          className="rounded-md relative overflow-hidden p-1.5 flex flex-col"
          style={{
            background: `linear-gradient(135deg, ${tint}, rgba(255,255,255,0.06))`,
            border: `1px solid ${tint}`,
          }}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.08, duration: 0.4 }}
        >
          <div className="flex items-center justify-between mb-0.5">
            <span
              className="text-[8px] font-mono font-semibold px-1 py-[1px] rounded"
              style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }}
            >
              {s.tag}
            </span>
            <span
              className="text-[8px] font-mono px-1 py-[1px] rounded-full"
              style={{ background: tint, color: "#fff" }}
            >
              {s.dur}
            </span>
          </div>
          <span className="text-[10px] font-semibold leading-tight text-white">
            {s.role}
          </span>
          <span className="text-[8.5px] font-mono mt-0.5 leading-tight text-white/85">
            {s.detail}
          </span>
          {/* Arrow connector to next scene (skip last) */}
          {i < scenes.length - 1 && (i + 1) % 3 !== 0 && (
            <span
              className="absolute right-[-7px] top-1/2 -translate-y-1/2 text-[10px]"
              style={{ color: tint }}
              aria-hidden="true"
            >
              ›
            </span>
          )}
        </motion.div>
      ))}
    </div>
  );
}

function PlaceholderLora({ tint }: { tint: string }) {
  // Each card represents an angle of the same character — together they show
  // cross-shot consistency, which is the entire point of LoRA training.
  const looks = [
    { name: "正面", angle: "front · 0°", consistency: 96 },
    { name: "3/4", angle: "3-quarter · 30°", consistency: 94 },
    { name: "側臉", angle: "profile · 90°", consistency: 92 },
  ] as const;
  return (
    <div className="flex items-center justify-center gap-2 w-full h-full px-2">
      {looks.map((l, i) => (
        <motion.div
          key={i}
          className="flex-1 max-w-[34%] rounded-xl relative overflow-hidden p-1.5"
          style={{
            background: `linear-gradient(160deg, #082c3d 0%, ${tint} 70%, rgba(255,255,255,0.12))`,
            border: `1px solid ${tint}`,
          }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: [0, -3, 0] }}
          transition={{
            opacity: { delay: i * 0.12, duration: 0.4 },
            y: { duration: 2.4, delay: i * 0.3, repeat: Infinity, ease: "easeInOut" },
          }}
        >
          {/* face / hair silhouette */}
          <div
            className="absolute left-1/2 top-[28%] -translate-x-1/2 rounded-full"
            style={{
              width: "55%",
              aspectRatio: "1 / 1.2",
              background: `radial-gradient(ellipse at 50% 30%, rgba(255,235,210,0.95), rgba(120,80,60,0.6) 60%, transparent 90%)`,
              filter: "blur(2px)",
            }}
          />
          {/* name + angle */}
          <div className="absolute left-1 right-1 top-1 flex items-center justify-between">
            <span
              className="text-[8.5px] font-semibold px-1 py-[1px] rounded"
              style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }}
            >
              {l.name}
            </span>
            <span
              className="text-[7.5px] font-mono px-1 py-[1px] rounded"
              style={{ background: tint, color: "#fff" }}
            >
              v{i + 1}
            </span>
          </div>
          {/* consistency bar */}
          <div className="absolute left-1 right-1 bottom-1.5">
            <div className="flex justify-between text-[7.5px] font-mono mb-0.5 text-white/95">
              <span>{l.angle}</span>
              <span style={{ color: tint }}>{l.consistency}%</span>
            </div>
            <div
              className="h-1 rounded-full overflow-hidden"
              style={{ background: "rgba(255,255,255,0.18)" }}
            >
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: `linear-gradient(90deg, ${tint}, rgba(255,255,255,0.85))`,
                }}
                animate={{ width: [`${l.consistency - 10}%`, `${l.consistency}%`] }}
                transition={{
                  duration: 2.0,
                  delay: i * 0.2,
                  repeat: Infinity,
                  repeatType: "reverse",
                  ease: "easeInOut",
                }}
              />
            </div>
          </div>
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

type DispatchStep = "parse" | "plan" | "call" | "stream" | "done";

interface DispatchState {
  tool: string;
  step: DispatchStep;
  /** When true, this dispatch is a real backend call (image only). */
  live: boolean;
}

const DISPATCH_STEP_ORDER: readonly DispatchStep[] = [
  "parse",
  "plan",
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
    { key: "parse", text: "光球代理 · 解析意圖 / 模態 / 輸出格式" },
    {
      key: "plan",
      text: "→ 建立執行計畫：工具路由、參數補全、成本守門",
    },
    {
      key: "call",
      text: `→ ${state.tool}({ prompt: "${promptPreview}" })`,
    },
    {
      key: "stream",
      text: state.live
        ? "← 串流真實 API：隊列進度、部分結果、重試訊號…"
        : "← 串流模擬預覽：示範代理逐步產生中繼結果…",
    },
    {
      key: "done",
      text: state.live
        ? "✓ 完成：輸出成品 + metadata + 可重跑 seed"
        : "✓ 代理示範完成：顯示流程軌跡與可呼叫工具",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.25 }}
      className="absolute left-2 right-2 bottom-2 rounded-lg backdrop-blur-md px-2.5 py-1.5 font-mono text-[9.5px] sm:text-[10px] leading-relaxed pointer-events-none shadow-[0_0_0_1px_rgba(34,197,94,0.18),0_10px_30px_rgba(16,185,129,0.16)]"
      style={{
        background: "linear-gradient(160deg, rgba(6,14,24,0.86), rgba(5,32,28,0.76))",
        border: `1px solid ${tint}`,
        color: "rgba(229,255,245,0.96)",
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

// ─── Agent blueprint — flowchart / mind map / process timeline ──────────────
//
// The preview card shows what the agent *generates*. The blueprint shows
// what the agent *thinks* — the same way a human would sketch it on a
// whiteboard before pressing run. Three panels:
//
//   1. 流程圖 (flowchart): vertical pipeline from prompt to output variants.
//   2. 心智圖 (mind map): the prompt fans out into concept / style /
//      lens / mood — the agent's parallel reasoning.
//   3. 過程圖 (process timeline): step-by-step execution with timing chips.

interface BlueprintMode {
  id: ModeId;
  tint: string;
  glow: string;
  prompt: string;
  tool: string;
  liveGenerate: boolean;
}

interface BlueprintCopy {
  /** Tool route label shown in the flowchart's "工具" node. */
  toolLabel: string;
  /** Output label shown in the flowchart's terminal node. */
  output: string;
  /** Mind-map branches — 4 clusters around the central prompt. */
  branches: {
    label: string;
    nodes: readonly string[];
    icon: typeof Brain;
  }[];
  /** Process-timeline steps — title + tiny detail + ms hint. */
  steps: { title: string; detail: string; ms: string }[];
}

const BLUEPRINT_COPY: Record<ModeId, BlueprintCopy> = {
  image: {
    toolLabel: "image_generator",
    output: "4 張變體",
    branches: [
      { label: "主體", nodes: ["少女側臉", "夕陽逆光", "情緒留白"], icon: Target },
      { label: "風格", nodes: ["電影感", "film-grain", "淺景深"], icon: Palette },
      { label: "鏡頭", nodes: ["35mm", "85mm CU", "rule-of-thirds"], icon: Eye },
      { label: "氛圍", nodes: ["黃昏暖光", "霓虹冷光", "底片顆粒"], icon: Sparkles },
    ],
    steps: [
      { title: "感知", detail: "意圖 / 模態 / 主體", ms: "120ms" },
      { title: "規劃", detail: "建立 4 變體計畫", ms: "180ms" },
      { title: "派工", detail: "image_generator", ms: "220ms" },
      { title: "串流", detail: "queue → 部分結果", ms: "5.4s" },
      { title: "交付", detail: "成品 + seed", ms: "8.2s" },
    ],
  },
  video: {
    toolLabel: "videoStudio",
    output: "5 秒短片 + 字幕",
    branches: [
      { label: "鏡頭", nodes: ["慢速推軌", "9:16 直式", "手持微震"], icon: Eye },
      { label: "場景", nodes: ["雨後濕地", "霓虹倒影", "夜景街道"], icon: Target },
      { label: "節奏", nodes: ["呼吸感", "5 秒 25fps", "緩入緩出"], icon: Clock },
      { label: "氛圍", nodes: ["賽博龐克", "孤獨感", "電影調光"], icon: Palette },
    ],
    steps: [
      { title: "感知", detail: "判定影片模態", ms: "140ms" },
      { title: "規劃", detail: "鏡頭 + 時長 + 比例", ms: "220ms" },
      { title: "派工", detail: "klingTextToVideo", ms: "260ms" },
      { title: "串流", detail: "queue → 進度回推", ms: "60-120s" },
      { title: "交付", detail: "MP4 + 重跑 seed", ms: "≈2 分鐘" },
    ],
  },
  music: {
    toolLabel: "proStudio.music",
    output: "30-60 秒原創曲",
    branches: [
      { label: "情緒", nodes: ["冷冽", "雨夜", "孤獨"], icon: Brain },
      { label: "編制", nodes: ["鋼琴主旋律", "弦樂墊底", "微氛圍鼓"], icon: Layers },
      { label: "節奏", nodes: ["BPM 72", "4/4", "慢板"], icon: Clock },
      { label: "結構", nodes: ["intro 8s", "verse 12s", "outro 6s"], icon: Workflow },
    ],
    steps: [
      { title: "感知", detail: "解析情緒 / BPM / 編制", ms: "150ms" },
      { title: "規劃", detail: "段落結構 + 配器", ms: "210ms" },
      { title: "派工", detail: "textToMusic", ms: "240ms" },
      { title: "串流", detail: "渲染 → 預覽段", ms: "30-60s" },
      { title: "交付", detail: "WAV + MIDI hint", ms: "≈1 分鐘" },
    ],
  },
  voice: {
    toolLabel: "proStudio.qwenTTS",
    output: "10-20 秒配音",
    branches: [
      { label: "語者", nodes: ["女聲 · 溫柔", "中性低音", "敘事旁白"], icon: Mic },
      { label: "情緒", nodes: ["平靜", "微笑", "沉思"], icon: Brain },
      { label: "節奏", nodes: ["呼吸停頓", "0.92x 語速", "段落間距"], icon: Clock },
      { label: "音場", nodes: ["乾淨人聲", "微殘響", "去口水音"], icon: Sparkles },
    ],
    steps: [
      { title: "感知", detail: "判定語者 / 情緒", ms: "110ms" },
      { title: "規劃", detail: "段落 + 停頓地圖", ms: "160ms" },
      { title: "派工", detail: "qwenTTS", ms: "200ms" },
      { title: "串流", detail: "合成 → 後處理", ms: "10-20s" },
      { title: "交付", detail: "MP3 + SRT 對齊", ms: "≈25s" },
    ],
  },
  director: {
    toolLabel: "director.plan",
    output: "5 鏡 + 配樂 + 字幕",
    branches: [
      { label: "敘事", nodes: ["品牌調性", "情緒弧線", "Call-to-Action"], icon: Brain },
      { label: "分鏡", nodes: ["S1 開場", "S2-3 鋪陳", "S4-5 收束"], icon: Layers },
      { label: "視覺", nodes: ["主視覺", "色票", "字幕風格"], icon: Palette },
      { label: "聲音", nodes: ["配樂", "旁白", "音效層"], icon: Music },
    ],
    steps: [
      { title: "感知", detail: "拆解品牌 / 受眾 / 平台", ms: "180ms" },
      { title: "規劃", detail: "5 鏡 DAG + 相依", ms: "320ms" },
      { title: "派工", detail: "→ 圖片 / 影片 / 音樂", ms: "—" },
      { title: "編排", detail: "監看 queue + 重試", ms: "5-10 分鐘" },
      { title: "交付", detail: "成品包 + 重跑配方", ms: "≈12 分鐘" },
    ],
  },
  lora: {
    toolLabel: "lora_trainer.create",
    output: "專屬角色模型",
    branches: [
      { label: "資料", nodes: ["12 張參考圖", "去背 + 對齊", "風格標註"], icon: Layers },
      { label: "訓練", nodes: ["rank 32", "lr 1e-4", "1200 steps"], icon: Workflow },
      { label: "驗證", nodes: ["臉部一致", "服裝一致", "跨景測試"], icon: Shield },
      { label: "輸出", nodes: ["LoRA .safetensors", "trigger word", "推薦 prompt"], icon: Target },
    ],
    steps: [
      { title: "感知", detail: "讀取參考圖集", ms: "300ms" },
      { title: "規劃", detail: "建議 rank / steps", ms: "400ms" },
      { title: "派工", detail: "lora_trainer.create", ms: "500ms" },
      { title: "訓練", detail: "monitor loss + sample", ms: "≈8 分鐘" },
      { title: "交付", detail: "權重 + 用法說明", ms: "≈8.5 分鐘" },
    ],
  },
};

function FlowchartPanel({
  mode,
  tint,
  isDark,
  cardBorder,
  copy,
}: {
  mode: BlueprintMode;
  tint: string;
  isDark: boolean;
  cardBorder: string;
  copy: BlueprintCopy;
}) {
  const reduce = useReducedMotion();
  const node = (label: string, sub?: string, accent = false) => (
    <div
      className="rounded-md px-2 py-1.5 text-center"
      style={{
        background: accent
          ? `linear-gradient(135deg, ${tint}, ${mode.glow})`
          : isDark
            ? "rgba(255,255,255,0.06)"
            : "rgba(255,255,255,0.55)",
        border: `1px solid ${accent ? tint : cardBorder}`,
        color: accent ? "#fff" : isDark ? "rgba(255,255,255,0.92)" : "rgba(20,20,30,0.85)",
      }}
    >
      <div className="text-[10px] font-semibold leading-tight">{label}</div>
      {sub && (
        <div
          className="text-[8.5px] font-mono mt-0.5 leading-tight opacity-90 truncate"
          style={{ color: accent ? "rgba(255,255,255,0.92)" : tint }}
        >
          {sub}
        </div>
      )}
    </div>
  );
  const arrow = (
    <div className="flex justify-center" aria-hidden="true">
      <motion.div
        animate={reduce ? undefined : { y: [0, 2, 0] }}
        transition={{ duration: 1.6, repeat: Infinity }}
        style={{ color: tint }}
      >
        <svg width="14" height="10" viewBox="0 0 14 10">
          <path
            d="M7 0 V 7 M3 5 L 7 9 L 11 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </motion.div>
    </div>
  );

  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex items-center gap-1 text-[8.5px] tracking-[0.18em] uppercase font-mono"
        style={{ color: tint }}
      >
        <Network className="w-2.5 h-2.5" />
        流程圖 · flowchart
      </div>
      <div className="flex flex-col gap-0.5">
        {node("念頭 prompt", "user input")}
        {arrow}
        {node("解析 · 模態判讀", "intent + modality")}
        {arrow}
        {node("路由 router", copy.toolLabel)}
        {arrow}
        {node(copy.output, mode.tool, true)}
      </div>
    </div>
  );
}

function MindMapPanel({
  tint,
  isDark,
  cardBorder,
  copy,
}: {
  tint: string;
  isDark: boolean;
  cardBorder: string;
  copy: BlueprintCopy;
}) {
  const reduce = useReducedMotion();
  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex items-center gap-1 text-[8.5px] tracking-[0.18em] uppercase font-mono"
        style={{ color: tint }}
      >
        <GitBranch className="w-2.5 h-2.5" />
        心智圖 · mind map
      </div>
      <div
        className="relative rounded-md px-2 py-2"
        style={{
          background: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.45)",
          border: `1px dashed ${cardBorder}`,
        }}
      >
        {/* central node */}
        <div className="flex justify-center mb-1.5">
          <motion.div
            className="inline-flex items-center gap-1 rounded-full px-2 py-1"
            style={{
              background: tint,
              color: "#fff",
              boxShadow: `0 0 16px ${tint}`,
            }}
            animate={reduce ? undefined : { scale: [1, 1.05, 1] }}
            transition={{ duration: 2.4, repeat: Infinity }}
          >
            <Brain className="w-2.5 h-2.5" />
            <span className="text-[9px] font-semibold tracking-wider">prompt</span>
          </motion.div>
        </div>
        <div className="grid grid-cols-2 gap-1">
          {copy.branches.map((b, i) => {
            const Icon = b.icon;
            return (
              <motion.div
                key={b.label}
                className="rounded px-1.5 py-1"
                style={{
                  background: isDark
                    ? "rgba(255,255,255,0.06)"
                    : "rgba(255,255,255,0.6)",
                  border: `1px solid ${cardBorder}`,
                }}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.08, duration: 0.4 }}
              >
                <div
                  className="flex items-center gap-1 text-[9px] font-semibold mb-0.5"
                  style={{ color: tint }}
                >
                  <Icon className="w-2.5 h-2.5" />
                  {b.label}
                </div>
                <div
                  className="flex flex-wrap gap-0.5"
                  style={{
                    color: isDark
                      ? "rgba(255,255,255,0.85)"
                      : "rgba(20,20,30,0.82)",
                  }}
                >
                  {b.nodes.map(n => (
                    <span
                      key={n}
                      className="text-[8.5px] px-1 py-[1px] rounded"
                      style={{
                        background: isDark
                          ? "rgba(255,255,255,0.05)"
                          : "rgba(255,255,255,0.55)",
                        border: `1px solid ${cardBorder}`,
                      }}
                    >
                      {n}
                    </span>
                  ))}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProcessTimelinePanel({
  tint,
  isDark,
  cardBorder,
  copy,
  liveGenerate,
}: {
  tint: string;
  isDark: boolean;
  cardBorder: string;
  copy: BlueprintCopy;
  liveGenerate: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex items-center gap-1 text-[8.5px] tracking-[0.18em] uppercase font-mono"
        style={{ color: tint }}
      >
        <Workflow className="w-2.5 h-2.5" />
        過程圖 · timeline
        <span
          className="ml-auto text-[8px] font-mono px-1 py-[1px] rounded"
          style={{
            background: liveGenerate ? tint : "transparent",
            color: liveGenerate ? "#fff" : tint,
            border: `1px solid ${tint}`,
          }}
        >
          {liveGenerate ? "LIVE" : "AGENT"}
        </span>
      </div>
      <ol className="flex flex-col gap-1">
        {copy.steps.map((s, i) => (
          <motion.li
            key={s.title}
            className="flex items-start gap-1.5 rounded px-1.5 py-1"
            style={{
              background: isDark
                ? "rgba(255,255,255,0.04)"
                : "rgba(255,255,255,0.5)",
              border: `1px solid ${cardBorder}`,
            }}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.05 + i * 0.06, duration: 0.4 }}
          >
            <span
              className="flex items-center justify-center w-3.5 h-3.5 rounded-full text-[8px] font-semibold shrink-0"
              style={{
                background: tint,
                color: "#fff",
                boxShadow: `0 0 8px ${tint}`,
              }}
            >
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div
                className="flex items-center gap-1 text-[9.5px] font-semibold leading-tight"
                style={{
                  color: isDark
                    ? "rgba(255,255,255,0.95)"
                    : "rgba(20,20,30,0.9)",
                }}
              >
                {s.title}
                <span
                  className="ml-auto text-[8px] font-mono px-1 py-[1px] rounded"
                  style={{
                    background: isDark
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(255,255,255,0.55)",
                    border: `1px solid ${cardBorder}`,
                    color: tint,
                  }}
                >
                  {s.ms}
                </span>
              </div>
              <div
                className="text-[8.5px] mt-0.5 leading-tight font-mono opacity-90 truncate"
                style={{
                  color: isDark
                    ? "rgba(255,255,255,0.78)"
                    : "rgba(20,20,30,0.72)",
                }}
              >
                {s.detail}
              </div>
            </div>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

function AgentBlueprint({
  mode,
  isDark,
  cardBg,
  cardBorder,
  textPrimary,
  textMuted,
}: {
  mode: BlueprintMode;
  isDark: boolean;
  cardBg: string;
  cardBorder: string;
  textPrimary: string;
  textMuted: string;
}) {
  const copy = BLUEPRINT_COPY[mode.id];

  return (
    <motion.section
      key={`blueprint-${mode.id}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="relative mt-3 sm:mt-4 rounded-2xl backdrop-blur-md p-3 sm:p-4"
      style={{
        background: cardBg,
        border: `1px solid ${cardBorder}`,
      }}
      aria-label="光球代理推論藍圖"
    >
      <div className="flex items-center gap-2 mb-2 sm:mb-3">
        <div
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
          style={{
            background: mode.tint,
            color: "#fff",
            boxShadow: `0 0 14px ${mode.glow}`,
          }}
        >
          <Route className="w-3 h-3" />
          <span className="text-[10px] tracking-wider font-semibold">
            代理推論藍圖
          </span>
        </div>
        <span className={`text-[10px] sm:text-[11px] ${textMuted}`}>
          流程圖 · 心智圖 · 過程圖（細節同步刷新）
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <FlowchartPanel
          mode={mode}
          tint={mode.tint}
          isDark={isDark}
          cardBorder={cardBorder}
          copy={copy}
        />
        <MindMapPanel
          tint={mode.tint}
          isDark={isDark}
          cardBorder={cardBorder}
          copy={copy}
        />
        <ProcessTimelinePanel
          tint={mode.tint}
          isDark={isDark}
          cardBorder={cardBorder}
          copy={copy}
          liveGenerate={mode.liveGenerate}
        />
      </div>
      <p className={`mt-2 sm:mt-3 text-[10px] sm:text-[11px] ${textMuted}`}>
        <span className={textPrimary}>細節：</span>左側流程圖呈現代理的工具路由，
        中間心智圖列出代理同時思考的概念分支，右側過程圖標出每一步的耗時與動作 — 三者同步隨模態切換。
      </p>
    </motion.section>
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
 * Real APIs wired (live generation, all gated on auth + FAL_API_KEY):
 *   - `imageStudio.nanoBanana2` → image (synchronous fal call)
 *   - `videoStudio.klingTextToVideo` → 5s video; polled via `checkVideoStatus`
 *   - `proStudio.textToMusic` (sonauto) → music; polled via `checkAudioStatus`
 *   - `proStudio.qwenTTS` → AI voiceover; polled via `checkAudioStatus`
 *   - `sense.inferIntent` (public) → "光球感應" the prompt as user types
 *
 * Director and LoRA need full studio flows (multi-turn planning / 12-image
 * upload), so the orb agent dispatches them as a tool-call trace inline and
 * the user can hop into the dedicated studio for the real flow.
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
  type MediaResult = { kind: "image" | "video" | "audio"; url: string; label?: string };
  const [mediaResult, setMediaResult] = useState<MediaResult | null>(null);
  const [pendingVideo, setPendingVideo] = useState<{
    requestId: string;
    modelId: string;
  } | null>(null);
  const [pendingAudio, setPendingAudio] = useState<{
    requestId: string;
    model: string;
    label: "music" | "voice";
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [activeDemoForm, setActiveDemoForm] = useState<(typeof DEMO_FORMS)[number]["id"]>("quick");
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
        setMediaResult({ kind: "image", url });
        setErrorMsg(null);
      } else {
        setErrorMsg("光球暫時沒拿到結果，再試一次。");
      }
    },
    onError: err => {
      setMediaResult(null);
      setErrorMsg(err.message || "生成失敗，請再試一次。");
    },
  });
  const videoGenMut = trpc.videoStudio.klingTextToVideo.useMutation({
    onSuccess: data => {
      const requestId = data?.request_id ?? null;
      const modelId = (data?.raw as { raw_model_id?: string } | null)?.raw_model_id ?? null;
      if (!requestId || !modelId) {
        setErrorMsg("光球代理未拿到 fal queue 任務，請再試一次。");
        setDispatch(null);
        return;
      }
      setPendingVideo({ requestId, modelId });
      setDispatch(d => (d ? { ...d, step: "stream" } : d));
    },
    onError: err => {
      setMediaResult(null);
      setPendingVideo(null);
      setDispatch(null);
      setErrorMsg(err.message || "影片生成失敗，請再試一次。");
    },
  });
  const musicGenMut = trpc.proStudio.textToMusic.useMutation({
    onSuccess: data => {
      const requestId = (data as { request_id?: string } | null)?.request_id ?? null;
      const model = (data as { model?: string } | null)?.model ?? null;
      if (!requestId || !model) {
        setErrorMsg("光球代理未拿到 fal queue 任務，請再試一次。");
        setDispatch(null);
        return;
      }
      setPendingAudio({ requestId, model, label: "music" });
      setDispatch(d => (d ? { ...d, step: "stream" } : d));
    },
    onError: err => {
      setMediaResult(null);
      setPendingAudio(null);
      setDispatch(null);
      setErrorMsg(err.message || "音樂生成失敗，請再試一次。");
    },
  });
  const voiceGenMut = trpc.proStudio.qwenTTS.useMutation({
    onSuccess: data => {
      const requestId = (data as { request_id?: string } | null)?.request_id ?? null;
      const model = (data as { model?: string } | null)?.model ?? null;
      if (!requestId || !model) {
        setErrorMsg("光球代理未拿到 fal queue 任務，請再試一次。");
        setDispatch(null);
        return;
      }
      setPendingAudio({ requestId, model, label: "voice" });
      setDispatch(d => (d ? { ...d, step: "stream" } : d));
    },
    onError: err => {
      setMediaResult(null);
      setPendingAudio(null);
      setDispatch(null);
      setErrorMsg(err.message || "配音生成失敗，請再試一次。");
    },
  });

  // ── Polling: video ──
  const videoStatusQuery = trpc.videoStudio.checkVideoStatus.useQuery(
    {
      requestId: pendingVideo?.requestId ?? "",
      modelId: pendingVideo?.modelId ?? "",
    },
    {
      enabled: !!pendingVideo,
      refetchInterval: q => {
        const s = (q.state.data as { status?: string } | undefined)?.status;
        return s === "COMPLETED" || s === "FAILED" ? false : 3000;
      },
      refetchIntervalInBackground: true,
      retry: 5,
    }
  );
  useEffect(() => {
    const data = videoStatusQuery.data as
      | { status?: string; video_url?: string | null }
      | undefined;
    if (!pendingVideo || !data) return;
    if (data.status === "COMPLETED" && data.video_url) {
      setMediaResult({ kind: "video", url: data.video_url });
      setPendingVideo(null);
      setDispatch(d => (d ? { ...d, step: "done" } : d));
    } else if (data.status === "FAILED") {
      setErrorMsg("影片任務失敗，請再試一次。");
      setPendingVideo(null);
      setDispatch(null);
    }
  }, [videoStatusQuery.data, pendingVideo]);
  useEffect(() => {
    if (videoStatusQuery.isError && pendingVideo) {
      setErrorMsg(videoStatusQuery.error?.message || "影片任務失敗，請再試一次。");
      setPendingVideo(null);
      setDispatch(null);
    }
  }, [videoStatusQuery.isError, videoStatusQuery.error, pendingVideo]);

  // ── Polling: audio (music + voice share the same status endpoint) ──
  const audioStatusQuery = trpc.proStudio.checkAudioStatus.useQuery(
    {
      requestId: pendingAudio?.requestId ?? "",
      model: pendingAudio?.model ?? "",
    },
    {
      enabled: !!pendingAudio,
      refetchInterval: q => {
        const s = (q.state.data as { status?: string } | undefined)?.status;
        return s === "COMPLETED" || s === "FAILED" ? false : 3000;
      },
      refetchIntervalInBackground: true,
      retry: 5,
    }
  );
  useEffect(() => {
    const data = audioStatusQuery.data as
      | { status?: string; audio_url?: string | null }
      | undefined;
    if (!pendingAudio || !data) return;
    if (data.status === "COMPLETED" && data.audio_url) {
      setMediaResult({
        kind: "audio",
        url: data.audio_url,
        label: pendingAudio.label,
      });
      setPendingAudio(null);
      setDispatch(d => (d ? { ...d, step: "done" } : d));
    } else if (data.status === "FAILED") {
      setErrorMsg(
        `${pendingAudio.label === "music" ? "音樂" : "配音"}任務失敗，請再試一次。`
      );
      setPendingAudio(null);
      setDispatch(null);
    }
  }, [audioStatusQuery.data, pendingAudio]);
  useEffect(() => {
    if (audioStatusQuery.isError && pendingAudio) {
      setErrorMsg(audioStatusQuery.error?.message || "音訊任務失敗，請再試一次。");
      setPendingAudio(null);
      setDispatch(null);
    }
  }, [audioStatusQuery.isError, audioStatusQuery.error, pendingAudio]);

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
    setMediaResult(null);
    setPendingVideo(null);
    setPendingAudio(null);
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
    setMediaResult(null);
    setPendingVideo(null);
    setPendingAudio(null);
    setErrorMsg(null);
    setDispatch(null);
    setSimulating(false);
    clearDispatchTimers();
  };

  const filteredScenarios = useMemo(
    () => SCENARIOS.filter((scenario) => scenario.demoForm === activeDemoForm),
    [activeDemoForm]
  );
  const activeScenario = useMemo(
    () => SCENARIOS.find((scenario) => scenario.id === activeScenarioId) ?? null,
    [activeScenarioId]
  );
  const activeDemoFormDef = useMemo(
    () => DEMO_FORMS.find((form) => form.id === activeDemoForm) ?? DEMO_FORMS[0],
    [activeDemoForm]
  );

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
      queue(320, "plan");
      queue(780, "call");
      queue(1360, "stream");
      queue(2360, "done", true);
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
    // Director / LoRA need full studio flows (multi-turn planning or 12-image
    // upload), so the orb agent dispatches them as a tool-call trace inline
    // and the user can open the studio for the real flow.
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
    setMediaResult(null);
    setPendingVideo(null);
    setPendingAudio(null);
    setDispatch({ tool: activeMode.tool, step: "parse", live: true });
    switch (activeMode.id) {
      case "image":
        imageGenMut.mutate({
          prompt: trimmed,
          aspect_ratio: "1:1",
          num_images: 1,
        });
        break;
      case "video":
        videoGenMut.mutate({
          prompt: trimmed,
          aspectRatio: "9:16",
          duration: "5",
          cfgScale: 0.5,
        });
        break;
      case "music":
        musicGenMut.mutate({
          prompt: trimmed,
          model: "sonauto",
        });
        break;
      case "voice":
        voiceGenMut.mutate({
          text: trimmed,
          language: "Auto",
        });
        break;
      default:
        runSimulatedDispatch(activeMode);
    }
  }, [
    prompt,
    activeMode,
    isAuthenticated,
    apiKeyQuery.data,
    imageGenMut,
    videoGenMut,
    musicGenMut,
    voiceGenMut,
    runSimulatedDispatch,
  ]);

  // Drive the LIVE dispatch trace through its phases as the real mutation
  // progresses, so the trace mirrors the actual API call rather than just
  // appearing at completion.
  const anyLiveSubmitPending =
    imageGenMut.isPending ||
    videoGenMut.isPending ||
    musicGenMut.isPending ||
    voiceGenMut.isPending;
  useEffect(() => {
    if (!dispatch?.live) return;
    if (dispatch.step === "parse" && anyLiveSubmitPending) {
      setDispatch(d => (d ? { ...d, step: "plan" } : d));
    } else if (anyLiveSubmitPending) {
      setDispatch(d => (d ? { ...d, step: "call" } : d));
    } else if (imageGenMut.isSuccess && activeMode.id === "image") {
      // Image is synchronous — jump straight to done once the URL is back.
      setDispatch(d => (d ? { ...d, step: "done" } : d));
    }
  }, [
    dispatch?.live,
    anyLiveSubmitPending,
    imageGenMut.isSuccess,
    activeMode.id,
  ]);

  const isBusy =
    anyLiveSubmitPending ||
    !!pendingVideo ||
    !!pendingAudio ||
    simulating;
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
            style={{
              textShadow: isDark
                ? "0 2px 18px rgba(0,0,0,0.55)"
                : "0 1px 12px rgba(255,255,255,0.65)",
            }}
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
          <div
            className="mt-3 sm:mt-5 mx-auto max-w-2xl rounded-2xl px-4 sm:px-5 py-3 sm:py-3.5 backdrop-blur-md transition-all duration-1000"
            style={{
              background: isDark
                ? "linear-gradient(180deg, rgba(8,12,30,0.55), rgba(8,12,30,0.32))"
                : "linear-gradient(180deg, rgba(255,255,255,0.62), rgba(255,255,255,0.42))",
              border: `1px solid ${cardBorder}`,
              boxShadow: isDark
                ? "0 8px 24px rgba(0,0,0,0.25)"
                : "0 8px 24px rgba(120,90,60,0.08)",
            }}
          >
            <p
              className={`text-sm sm:text-base leading-relaxed transition-colors duration-1000 ${textMuted}`}
              style={{
                textShadow: isDark
                  ? "0 1px 8px rgba(0,0,0,0.5)"
                  : "0 1px 4px rgba(255,255,255,0.55)",
              }}
            >
              寫下你想創作的畫面或情緒 — 光球代理會即時感應、判斷模態，
              並為你呼叫對應的生成工具：圖片、影片、音樂、配音、導演與角色 LoRA，全部在這個畫面完成。
            </p>
          </div>
        </motion.div>

        {/* ── Scenario presets — 首頁改為多種形式演示 ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.8, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6 sm:mb-7"
        >
          <div className={`flex items-center justify-center gap-2 mb-3 text-[10px] sm:text-[11px] tracking-[0.2em] uppercase ${textMuted}`}>
            <Layers className="w-3 h-3" style={{ color: activeMode.tint }} />
            <span>首頁演示 · 可切換多種形式</span>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2 mb-2.5 sm:mb-3">
            {DEMO_FORMS.map((form) => {
              const isActive = form.id === activeDemoForm;
              return (
                <button
                  key={form.id}
                  type="button"
                  onClick={() => {
                    setActiveDemoForm(form.id);
                    setActiveScenarioId(null);
                  }}
                  className={`px-2.5 sm:px-3 py-1 rounded-full text-[10px] sm:text-xs font-medium transition-all ${
                    isActive ? "text-white" : textPrimary
                  }`}
                  style={{
                    background: isActive ? activeMode.tint : featureBg,
                    border: `1px solid ${isActive ? activeMode.tint : cardBorder}`,
                    boxShadow: isActive ? `0 4px 14px ${activeMode.glow}` : "none",
                  }}
                  aria-pressed={isActive}
                >
                  {form.label}
                </button>
              );
            })}
          </div>
          {/* ── Layer-by-layer breakdown for the active demo form ── */}
          <motion.div
            key={`demo-layers-${activeDemoFormDef.id}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="mb-3 sm:mb-4 rounded-2xl p-3 sm:p-3.5"
            style={{
              background: featureBg,
              border: `1px solid ${cardBorder}`,
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-semibold tracking-wider"
                style={{
                  background: activeMode.tint,
                  color: "#fff",
                  boxShadow: `0 0 10px ${activeMode.glow}`,
                }}
              >
                <Layers className="w-2.5 h-2.5" />
                {activeDemoFormDef.label}
              </span>
              <span className={`text-[11px] sm:text-xs leading-snug ${textPrimary}`}>
                {activeDemoFormDef.description}
              </span>
            </div>
            <ol className="space-y-1">
              {activeDemoFormDef.layers.map((layer, i) => (
                <li
                  key={layer.name}
                  className="flex items-start gap-2 rounded-lg px-2 py-1.5"
                  style={{
                    background: isDark
                      ? "rgba(255,255,255,0.04)"
                      : "rgba(255,255,255,0.55)",
                    border: `1px solid ${cardBorder}`,
                  }}
                >
                  <span
                    className="flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-semibold shrink-0 mt-[1px]"
                    style={{
                      background: activeMode.tint,
                      color: "#fff",
                      boxShadow: `0 0 8px ${activeMode.glow}`,
                    }}
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-[10.5px] sm:text-[11.5px] font-semibold leading-tight ${textPrimary}`}
                    >
                      {layer.name}
                      <span
                        className="ml-1.5 font-mono text-[9px] sm:text-[10px] tracking-wider"
                        style={{ color: activeMode.tint }}
                      >
                        layer {i + 1}/{activeDemoFormDef.layers.length}
                      </span>
                    </div>
                    <div
                      className={`text-[10px] sm:text-[11px] leading-snug mt-0.5 ${textMuted}`}
                    >
                      {layer.detail}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <p className={`mt-2 text-[10px] sm:text-[11px] ${textMuted}`}>
              <span className={textPrimary}>選一個情境</span> 即可看到對應的代理運行細節（感知 / 規劃 / 派工 / 交付）。
            </p>
          </motion.div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-2.5">
            {filteredScenarios.map(scenario => {
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
          {activeScenario && (
            <div
              className="mt-3 rounded-xl p-3 sm:p-3.5"
              style={{ background: featureBg, border: `1px solid ${cardBorder}` }}
            >
              <p className={`text-[11px] sm:text-xs font-medium mb-2 ${textPrimary}`}>
                代理運行細節（{activeScenario.label}）
              </p>
              <ol className={`list-decimal pl-4 space-y-1 text-[11px] sm:text-xs ${textMuted}`}>
                <li><span className={textPrimary}>感知：</span>{activeScenario.runbook.perceive}</li>
                <li><span className={textPrimary}>規劃：</span>{activeScenario.runbook.plan}</li>
                <li><span className={textPrimary}>派工：</span>{activeScenario.runbook.tools}</li>
                <li><span className={textPrimary}>交付：</span>{activeScenario.runbook.output}</li>
              </ol>
            </div>
          )}
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
                  {mediaResult ? (
                    <motion.div
                      key={`result-${mediaResult.kind}-${mediaResult.url}`}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.4 }}
                      className="w-full h-full p-2 flex items-center justify-center"
                    >
                      {mediaResult.kind === "image" && (
                        <img
                          src={mediaResult.url}
                          alt={prompt}
                          className="w-full h-full object-contain rounded-xl"
                          loading="lazy"
                        />
                      )}
                      {mediaResult.kind === "video" && (
                        <video
                          src={mediaResult.url}
                          className="w-full h-full object-contain rounded-xl bg-black"
                          controls
                          autoPlay
                          loop
                          muted
                          playsInline
                        />
                      )}
                      {mediaResult.kind === "audio" && (
                        <div className="w-full flex flex-col items-center justify-center gap-3 px-3">
                          <div
                            className="text-[10px] tracking-[0.25em] uppercase"
                            style={{ color: activeMode.tint }}
                          >
                            {mediaResult.label === "music" ? "原創音樂" : "AI 配音"}
                          </div>
                          <audio
                            src={mediaResult.url}
                            controls
                            autoPlay
                            className="w-full max-w-xs"
                          />
                        </div>
                      )}
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

          {/* ── Agent blueprint: flowchart / mind map / process timeline ── */}
          <AnimatePresence mode="wait">
            <AgentBlueprint
              key={activeMode.id}
              mode={activeMode}
              isDark={isDark}
              cardBg={cardBg}
              cardBorder={cardBorder}
              textPrimary={textPrimary}
              textMuted={textMuted}
            />
          </AnimatePresence>

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
                  ? activeMode.liveGenerate
                    ? pendingVideo || pendingAudio
                      ? "光球代理輪詢 fal queue…"
                      : "光球代理串流中…"
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
                <div
                  role="alert"
                  className="mx-auto inline-flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 rounded-xl px-3 py-2"
                  style={{
                    background: isDark
                      ? "rgba(248,113,113,0.10)"
                      : "rgba(254,226,226,0.85)",
                    border: "1px solid rgba(248,113,113,0.45)",
                  }}
                >
                  <span className="inline-flex items-center gap-1.5 text-red-400">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-left">
                      {errorMsg.replace(/[，,]?\s*(?:請)?再試一次。?$/u, "")}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleGenerate}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] sm:text-[11px] font-semibold transition-transform hover:-translate-y-0.5 disabled:opacity-60"
                      style={{
                        background: activeMode.tint,
                        color: "#fff",
                        boxShadow: `0 4px 14px ${activeMode.glow}`,
                      }}
                    >
                      <RefreshCw className="w-3 h-3" />
                      再試一次
                    </button>
                    <button
                      type="button"
                      onClick={() => setErrorMsg(null)}
                      className={`text-[10px] sm:text-[11px] underline-offset-2 hover:underline ${textMuted}`}
                    >
                      關閉
                    </button>
                  </span>
                </div>
              ) : isBusy && activeMode.liveGenerate && (pendingVideo || pendingAudio) ? (
                <span>光球代理已提交 fal queue，每 3 秒輪詢 {activeMode.tool}…</span>
              ) : isBusy && activeMode.liveGenerate ? (
                <span>光球代理正在呼叫 {activeMode.tool} 真實 API…</span>
              ) : isBusy ? (
                <span>光球代理示範呼叫 {activeMode.tool}（導演 / LoRA 需於工作室啟動完整流程）。</span>
              ) : activeMode.liveGenerate && !isAuthenticated ? (
                <span>登入後光球代理即可呼叫真實 API；導演與 LoRA 仍以代理示範展示完整流程。</span>
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
