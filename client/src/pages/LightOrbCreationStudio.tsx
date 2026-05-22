// 光球創作場 · PHASE 01 · 02
//
// 一個「視覺模擬」頁:在不打 fal.ai 的情況下，把「使用者打提示詞 → 全站光球代理
// 路由 → 25 精靈協作 → 4 個鏡頭參數變體生成」整條 pipeline 演給人看。
//
// 互動：在最上方輸入框打字後按「即時生成」，光球會：
//   1) phase 0「感應提示詞」— 群眾精靈微微閃爍
//   2) phase 1「路由模態」— 導 / 編 / 圖 / 群 同步打亮，timeline 推進
//   3) phase 2「召喚生成工具」— 圖像精靈鎖定，4 張 V2/V3/V4/V5 卡進 shimmer
//   4) phase 3「完成 + 回 fal queue」— 卡片 reveal 成漸層 placeholder
//
// 沒有真實 API 呼叫 — 純前端時間軸驅動，方便 demo / onboarding / 直播用。
// 想升級成真實生成請接 trpc.imageStudio.nanoBanana2 在 phase 2 → 3 之間。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLocation } from "wouter";
import {
  Sparkles,
  Wand2,
  Image as ImageIcon,
  Film,
  Music,
  Megaphone,
  Layers,
  Send,
  Clock,
  Activity,
  Cpu,
  Compass,
  ListTree,
  CircleDot,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

import { SPIRITS, SPIRITS_BY_ID } from "@/lib/spiritsVisual";
import { useRegisterPageAgent, type AgentActionResult } from "@/contexts/PageAgentContext";
import type { AgentRole } from "../../../shared/orb-agent-roles";

/* ─────────────────────────────────────────────────────────────────────────────
 * 演示模式 + 模板卡
 * ────────────────────────────────────────────────────────────────────────── */

type DemoMode = "quick" | "multi-modal" | "multi-step" | "consistent-style";

const DEMO_MODES: ReadonlyArray<{
  id: DemoMode;
  label: string;
  hint: string;
}> = [
  { id: "quick", label: "快做演示", hint: "一句話 → 直送單一工具 → 8 秒內出第一版可用素材" },
  { id: "multi-modal", label: "多模態演示", hint: "圖 + 影 + 音 + 語音同時起跑，現場拼成一段成品" },
  { id: "multi-step", label: "多步驟演示", hint: "導演拆步 → 編編填料 → 步步串起 → 全程回報" },
  { id: "consistent-style", label: "風格一致演示", hint: "鎖住色調 / 鏡頭 / 角色 LoRA，連續 4 張不破風格" },
];

const QUICK_DEMO_LINES = [
  { idx: 1, label: "感應 prompt", desc: "解析輸入提示 → 鎖定模態（圖／影／音）" },
  { idx: 2, label: "派工具", desc: "直送對應工具 → 省去跨平台切換成本" },
  { idx: 3, label: "回收果", desc: "輪詢 fal queue → 取回成品與可重跑 seed" },
];

const DEMO_CARDS: ReadonlyArray<{
  title: string;
  desc: string;
  duration: string;
  pills: ReadonlyArray<{ label: string; tone: "rose" | "violet" | "amber" | "cyan" }>;
  icon: typeof ImageIcon;
}> = [
  {
    title: "商品主視覺",
    desc: "圖像 × 5/5 × 商品 × 多項可比較稿",
    duration: "8-12 分鐘",
    pills: [
      { label: "圖", tone: "rose" },
      { label: "比較", tone: "amber" },
      { label: "輸出", tone: "violet" },
    ],
    icon: ImageIcon,
  },
  {
    title: "社群短影音",
    desc: "影片 × 音樂 × 9:16 × 一刀剪",
    duration: "10-15 分鐘",
    pills: [
      { label: "影", tone: "violet" },
      { label: "音", tone: "cyan" },
      { label: "剪", tone: "rose" },
    ],
    icon: Film,
  },
  {
    title: "活動主視覺海報",
    desc: "圖像 × 編排 × 5/5 × 一句話標題",
    duration: "6-10 分鐘",
    pills: [
      { label: "圖", tone: "rose" },
      { label: "標題", tone: "amber" },
      { label: "排", tone: "violet" },
    ],
    icon: Megaphone,
  },
  {
    title: "廣告文案編劇",
    desc: "文字 × 圖像 × 守守投放教材組",
    duration: "5-8 分鐘",
    pills: [
      { label: "文", tone: "cyan" },
      { label: "圖", tone: "rose" },
      { label: "投", tone: "amber" },
    ],
    icon: Wand2,
  },
];

const PILL_TONES: Record<"rose" | "violet" | "amber" | "cyan", string> = {
  rose: "bg-rose-500/20 text-rose-200 ring-1 ring-rose-300/30",
  violet: "bg-violet-500/20 text-violet-200 ring-1 ring-violet-300/30",
  amber: "bg-amber-500/20 text-amber-100 ring-1 ring-amber-300/30",
  cyan: "bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-300/30",
};

/* ─────────────────────────────────────────────────────────────────────────────
 * 4 個變體鏡頭設定 — V2 / V3 / V4 / V5（對應 mockup 上的 BTS / 50mm / 35mm 框）
 * ────────────────────────────────────────────────────────────────────────── */

type Variant = {
  id: "V2" | "V3" | "V4" | "V5";
  label: string;
  lens: string;
  aperture: string;
  iso: string;
  vibe: string;
  /** 完成後給漸層卡 placeholder 用 */
  tint: string;
  /** 完成後出現的「色彩標籤」 */
  swatch: string;
};

const VARIANTS: ReadonlyArray<Variant> = [
  {
    id: "V2",
    label: "C2",
    lens: "50mm",
    aperture: "f/1.8",
    iso: "ISO 200",
    vibe: "正臉淺景深",
    tint: "from-orange-300/80 via-rose-400/60 to-violet-500/40",
    swatch: "bg-rose-300",
  },
  {
    id: "V3",
    label: "V3",
    lens: "35mm",
    aperture: "f/1.8",
    iso: "ISO 800",
    vibe: "斜側剪影",
    tint: "from-amber-400/80 via-orange-500/55 to-purple-600/45",
    swatch: "bg-amber-300",
  },
  {
    id: "V4",
    label: "V4",
    lens: "35mm",
    aperture: "f/2.0",
    iso: "ISO 800",
    vibe: "夕陽逆光",
    tint: "from-rose-400/80 via-fuchsia-500/55 to-indigo-700/45",
    swatch: "bg-fuchsia-300",
  },
  {
    id: "V5",
    label: "BTS",
    lens: "24mm",
    aperture: "f/2.8",
    iso: "ISO 320",
    vibe: "幕後工作照",
    tint: "from-sky-400/70 via-violet-500/55 to-slate-800/55",
    swatch: "bg-sky-300",
  },
];

/* ─────────────────────────────────────────────────────────────────────────────
 * 模擬時間軸 — 一段使用者 prompt 的 phase 推進
 * ────────────────────────────────────────────────────────────────────────── */

type Phase = 0 | 1 | 2 | 3 | 4;
const PHASE_LABEL: Record<Phase, string> = {
  0: "待命",
  1: "感應提示詞",
  2: "路由模態 + 點名精靈",
  3: "生成中（4 道並行）",
  4: "完成 · 回 fal queue",
};

// 每個 phase 該打亮的精靈（用 role id）— 對齊 mockup「全站光球代理」的決策樹
const PHASE_ACTIVE_ROLES: Record<Phase, ReadonlyArray<AgentRole>> = {
  0: [],
  1: ["companion", "quality-coach"],
  2: ["director", "composer", "researcher", "inspiration-specialist"],
  3: [
    "image-specialist",
    "composer",
    "quality-coach",
    "accountant",
    "anatomy-specialist",
  ],
  4: ["image-specialist", "critic", "notes-curator", "chief-orchestrator"],
};

type TimelineEvent = {
  t: string;
  phase: Phase;
  text: string;
  role?: AgentRole;
};

function buildTimeline(prompt: string): TimelineEvent[] {
  const trimmed = prompt.trim();
  const snippet = trimmed.length > 22 ? `${trimmed.slice(0, 22)}…` : trimmed;
  return [
    { t: "00:00", phase: 1, text: `輸入：「${snippet || "（空提示詞）"}」`, role: "companion" },
    { t: "00:01", phase: 1, text: "巧巧：偵測到鏡頭詞 / 情境詞 → prompt 強度可", role: "quality-coach" },
    { t: "00:02", phase: 2, text: "導導：拆 1 步驟 → 純圖像產出 × 4 變體", role: "director" },
    { t: "00:02", phase: 2, text: "靈靈：給 35mm 底片 / 電影感 / 淺景深 三條參考", role: "inspiration-specialist" },
    { t: "00:03", phase: 2, text: "編編：填 aspect_ratio=3:4、num_images=4", role: "composer" },
    { t: "00:03", phase: 3, text: "圖圖：召喚 fal-ai/nano-banana-2（image_gen_x4）", role: "image-specialist" },
    { t: "00:04", phase: 3, text: "財財:本次預估 4 點數，已預扣（失敗會自動退）", role: "accountant" },
    { t: "00:05", phase: 3, text: "queue: partial.1 → partial.2 → partial.3 …", role: "image-specialist" },
    { t: "00:07", phase: 4, text: "完成 4 / 4 ✓ seed 0xAE2F、預覽就緒", role: "image-specialist" },
    { t: "00:07", phase: 4, text: "品品：第 2 張構圖最穩，第 4 張色溫偏冷可再跑", role: "critic" },
    { t: "00:08", phase: 4, text: "記記：已存到「素材庫 / 今日創作」", role: "notes-curator" },
  ];
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 主元件
 * ────────────────────────────────────────────────────────────────────────── */

const DEFAULT_PROMPT = "夕陽下的少女側臉、電影感、淺景深、35mm 底片質感";
const PROMPT_LIMIT = 400;

export default function LightOrbCreationStudio() {
  const [, navigate] = useLocation();
  const reduceMotion = useReducedMotion();

  const [mode, setMode] = useState<DemoMode>("quick");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [phase, setPhase] = useState<Phase>(0);
  const [eventIdx, setEventIdx] = useState(0);
  const [running, setRunning] = useState(false);

  const timeline = useMemo(() => buildTimeline(prompt), [prompt]);
  const activeRoles = useMemo(
    () => new Set<AgentRole>(PHASE_ACTIVE_ROLES[phase]),
    [phase],
  );

  // 時間軸自動推進 — 約每 700ms 一格，跑完停在 phase 4
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    timerRef.current = window.setInterval(() => {
      setEventIdx((idx) => {
        const next = idx + 1;
        if (next >= timeline.length) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          setRunning(false);
          setPhase(4);
          return timeline.length;
        }
        const ev = timeline[next];
        setPhase(ev.phase);
        return next;
      });
    }, reduceMotion ? 300 : 700);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [running, timeline, reduceMotion]);

  const startRun = useCallback(() => {
    setEventIdx(0);
    setPhase(1);
    setRunning(true);
  }, []);

  const reset = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    setRunning(false);
    setPhase(0);
    setEventIdx(0);
  }, []);

  // 4 張變體卡的狀態 — phase >= 3 才開始 shimmer，phase = 4 全部 reveal
  const variantState = useCallback(
    (i: number): "idle" | "shimmer" | "ready" => {
      if (phase < 3) return "idle";
      if (phase === 4) return "ready";
      // phase 3：依事件 index 漸次點亮
      const progress = (eventIdx - 5) / 4; // 第 5 ~ 8 條事件 = 生成階段
      const threshold = (i + 1) / 4;
      return progress >= threshold ? "ready" : "shimmer";
    },
    [phase, eventIdx],
  );

  const orbState: "idle" | "sensing" | "routing" | "generating" | "done" =
    phase === 0 ? "idle" :
    phase === 1 ? "sensing" :
    phase === 2 ? "routing" :
    phase === 3 ? "generating" : "done";

  const LIGHT_ORB_NAV_ALLOWLIST = useMemo(() => new Set(["/light-orb-studio", "/image-studio", "/agent", "/create"]), []);

  useRegisterPageAgent({
    pageId: "light-orb-studio",
    pageLabel: "光球創作場",
    pagePath: "/light-orb-studio",
    capabilities: [
      {
        action: "navigate",
        label: "前往關聯頁面",
        options: [
          { id: "/light-orb-studio", label: "光球創作場" },
          { id: "/image-studio", label: "圖片工作室" },
          { id: "/agent", label: "光球對話" },
          { id: "/create", label: "創作中心" },
        ],
      },
      {
        action: "setParam",
        label: "切換演示模式",
        options: DEMO_MODES.map((m) => ({ id: m.id, label: m.label })),
      },
      { action: "submit", label: "開始演示" },
      { action: "reset", label: "重設演示" },
    ],
    state: { mode, phase, running, eventIdx },
    handle: async (action): Promise<AgentActionResult> => {
      if (action.type === "navigate" && typeof action.path === "string") {
        if (!LIGHT_ORB_NAV_ALLOWLIST.has(action.path)) {
          return { ok: false, reason: `light-orb-studio: 不在允許跳轉清單：${action.path}` };
        }
        navigate(action.path);
        return { ok: true };
      }
      if (action.type === "setParam" && action.key === "mode" && typeof action.value === "string") {
        if (!DEMO_MODES.some((m) => m.id === action.value)) {
          return { ok: false, reason: `light-orb-studio: unknown mode ${action.value}` };
        }
        setMode(action.value as DemoMode);
        return { ok: true };
      }
      if (action.type === "submit") {
        startRun();
        return { ok: true };
      }
      if (action.type === "reset") {
        reset();
        return { ok: true };
      }
      return { ok: false, reason: `light-orb-studio: unsupported action "${action.type}"` };
    },
  });

  return (
    <div className="relative min-h-screen w-full bg-[#0b0a1c] text-slate-100 overflow-x-hidden">
      {/* 背景星雲 */}
      <BackgroundField />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-10 py-6 sm:py-10 space-y-10">
        <TopBar onJump={() => navigate("/image-studio")} />

        <PhaseHeader />

        <HeroIntro />

        <ModeTabs mode={mode} onChange={setMode} />

        <QuickDemoSteps />

        <DemoCardGrid />

        <PromptComposer
          prompt={prompt}
          setPrompt={setPrompt}
          running={running}
          onSubmit={startRun}
          onReset={reset}
        />

        <OrbStage orbState={orbState} phase={phase} />

        <VariantGrid variantState={variantState} />

        <BottomDashboard
          phase={phase}
          eventIdx={eventIdx}
          timeline={timeline}
          activeRoles={activeRoles}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 子元件
 * ────────────────────────────────────────────────────────────────────────── */

function TopBar({ onJump }: { onJump: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="relative h-7 w-7 rounded-full bg-gradient-to-br from-violet-400 via-fuchsia-500 to-indigo-600 shadow-[0_0_24px_rgba(168,85,247,0.6)]" />
        <span className="text-sm tracking-[0.2em] text-slate-200/80">AI DIRECTOR</span>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="border-violet-300/30 bg-violet-500/10 text-violet-100 text-xs">
          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-violet-300 animate-pulse" />
          深海
        </Badge>
        <Badge variant="outline" className="border-cyan-300/30 bg-cyan-500/10 text-cyan-100 text-xs">
          輕音模式
        </Badge>
        <Button
          size="sm"
          onClick={onJump}
          className="rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 text-slate-900 font-medium hover:opacity-90"
        >
          開始創作
        </Button>
      </div>
    </div>
  );
}

function PhaseHeader() {
  return (
    <div className="flex items-center justify-center gap-3 text-xs tracking-[0.4em] text-violet-200/70">
      <span className="h-px w-12 bg-gradient-to-r from-transparent to-violet-400/50" />
      <span>PHASE 01 · 02 · 光球創作場</span>
      <span className="h-px w-12 bg-gradient-to-l from-transparent to-violet-400/50" />
    </div>
  );
}

function HeroIntro() {
  return (
    <div className="text-center space-y-5">
      <h1 className="text-3xl sm:text-5xl font-light tracking-tight">
        <span className="text-slate-50">從一個提示詞開始</span>
        <span className="mx-3 text-violet-300/70">·</span>
        <span className="bg-gradient-to-r from-violet-200 via-fuchsia-200 to-cyan-200 bg-clip-text text-transparent">
          即時生成
        </span>
      </h1>
      <p className="mx-auto max-w-2xl text-sm sm:text-base leading-relaxed text-slate-300/80">
        寫下你想創作的畫面或情緒 — 光球代理會即時感應、判斷模態，並為你呼叫對應的生成工具：
        <span className="text-violet-200">圖片 / 影片 / 音樂 / 配音 / 導演與角色 LoRA</span>
        ，全部在這個畫面完成。
      </p>
    </div>
  );
}

function ModeTabs({
  mode,
  onChange,
}: {
  mode: DemoMode;
  onChange: (m: DemoMode) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-2 text-xs text-violet-200/60">
        <Sparkles className="h-3 w-3" />
        首頁演示 · 可切換多種模式
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {DEMO_MODES.map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onChange(m.id)}
              className={[
                "rounded-full px-4 py-1.5 text-sm transition-all duration-300",
                active
                  ? "bg-violet-500/30 text-violet-50 ring-1 ring-violet-300/60 shadow-[0_0_20px_rgba(168,85,247,0.35)]"
                  : "bg-white/[0.04] text-slate-300/80 ring-1 ring-white/10 hover:bg-white/[0.08]",
              ].join(" ")}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-slate-300/60">
        {DEMO_MODES.find((m) => m.id === mode)?.hint}
      </p>
    </div>
  );
}

function QuickDemoSteps() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-md">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {QUICK_DEMO_LINES.map((line) => (
          <div
            key={line.idx}
            className="flex items-start gap-3 rounded-xl bg-white/[0.02] px-3 py-2.5 ring-1 ring-white/5"
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/30 text-xs text-violet-100 ring-1 ring-violet-300/50">
              {line.idx}
            </span>
            <div className="min-w-0">
              <div className="text-sm text-slate-100">{line.label}</div>
              <div className="text-xs text-slate-300/70">{line.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoCardGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {DEMO_CARDS.map((card) => {
        const Icon = card.icon;
        return (
          <motion.div
            key={card.title}
            whileHover={{ y: -3 }}
            className="rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.02] p-4 backdrop-blur-md"
          >
            <div className="flex items-center justify-between">
              <Icon className="h-4 w-4 text-violet-300" />
              <span className="text-[10px] text-slate-300/60">{card.duration}</span>
            </div>
            <div className="mt-2 text-sm font-medium text-slate-50">{card.title}</div>
            <div className="text-xs text-slate-300/70 mt-1">{card.desc}</div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {card.pills.map((p, i) => (
                <span
                  key={i}
                  className={`rounded-full px-2 py-0.5 text-[10px] ${PILL_TONES[p.tone]}`}
                >
                  {p.label}
                </span>
              ))}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function PromptComposer({
  prompt,
  setPrompt,
  running,
  onSubmit,
  onReset,
}: {
  prompt: string;
  setPrompt: (v: string) => void;
  running: boolean;
  onSubmit: () => void;
  onReset: () => void;
}) {
  const remaining = PROMPT_LIMIT - prompt.length;
  return (
    <div className="rounded-2xl border border-violet-300/15 bg-gradient-to-br from-violet-900/20 via-indigo-900/10 to-slate-900/30 p-5 sm:p-6 backdrop-blur-xl shadow-[0_0_40px_rgba(99,102,241,0.12)]">
      <div className="flex items-center gap-2 text-xs text-violet-200/70 mb-3">
        <Wand2 className="h-3.5 w-3.5" />
        輸入提示詞 · 即時生成
      </div>
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value.slice(0, PROMPT_LIMIT))}
        placeholder="夕陽下的少女側臉、電影感、淺景深、35mm 底片質感"
        rows={3}
        className="resize-none border-0 bg-white/[0.03] text-slate-100 placeholder:text-slate-400/40 focus-visible:ring-1 focus-visible:ring-violet-300/40 text-base leading-relaxed"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-300/60">
          <span>輸出 1 張 · 約 8 秒</span>
          <span className="text-slate-500/50">·</span>
          <span>{Math.max(0, remaining)}/{PROMPT_LIMIT}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={running}
            className="text-slate-300/80 hover:bg-white/5 hover:text-slate-100"
          >
            重設
          </Button>
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={running || prompt.trim().length === 0}
            className="rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 text-slate-900 font-medium hover:opacity-90"
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            {running ? "光球感應中…" : "即時生成"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 中央光球 — Framer Motion 漣漪 + 多層發光
 * ────────────────────────────────────────────────────────────────────────── */

function OrbStage({
  orbState,
  phase,
}: {
  orbState: "idle" | "sensing" | "routing" | "generating" | "done";
  phase: Phase;
}) {
  const intensity =
    orbState === "idle" ? 0.35 :
    orbState === "sensing" ? 0.55 :
    orbState === "routing" ? 0.8 :
    orbState === "generating" ? 1 : 0.7;

  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <div className="relative h-56 w-56 sm:h-64 sm:w-64 flex items-center justify-center">
        {/* 外層漣漪 */}
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="absolute inset-0 rounded-full border border-violet-300/30"
            animate={{
              scale: [1, 1.5 + i * 0.15],
              opacity: [0.4 * intensity, 0],
            }}
            transition={{
              duration: 2.4,
              ease: "easeOut",
              repeat: Infinity,
              delay: i * 0.8,
            }}
          />
        ))}
        {/* 內球 */}
        <motion.div
          className="relative h-32 w-32 sm:h-36 sm:w-36 rounded-full bg-gradient-to-br from-violet-300 via-fuchsia-500 to-indigo-700"
          animate={{
            boxShadow: [
              `0 0 ${40 * intensity}px rgba(168,85,247,${0.5 * intensity})`,
              `0 0 ${80 * intensity}px rgba(139,92,246,${0.7 * intensity})`,
              `0 0 ${40 * intensity}px rgba(168,85,247,${0.5 * intensity})`,
            ],
            scale: [1, 1.04, 1],
          }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        >
          {/* 高光 */}
          <div className="absolute left-[18%] top-[18%] h-7 w-7 rounded-full bg-white/40 blur-sm" />
          <div className="absolute left-[22%] top-[22%] h-3 w-3 rounded-full bg-white/70" />
        </motion.div>
      </div>
      <div className="text-center space-y-1">
        <div className="flex items-center justify-center gap-2 text-xs text-violet-200/70">
          <CircleDot className="h-3 w-3" />
          光球狀態
        </div>
        <div className="text-sm tracking-wide text-slate-100">
          {PHASE_LABEL[phase]}
          <span className="ml-2 text-slate-400/60">cinematic · film-grain</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 4 張變體預覽卡
 * ────────────────────────────────────────────────────────────────────────── */

function VariantGrid({
  variantState,
}: {
  variantState: (i: number) => "idle" | "shimmer" | "ready";
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 backdrop-blur-md">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs text-violet-200/70">
          <Layers className="h-3.5 w-3.5" />
          代理生成預覽
        </div>
        <span className="text-[10px] text-slate-300/50">4 變體 · 同 prompt · 同 seed 系列</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {VARIANTS.map((v, i) => {
          const state = variantState(i);
          return <VariantCard key={v.id} variant={v} state={state} />;
        })}
      </div>
    </div>
  );
}

function VariantCard({
  variant,
  state,
}: {
  variant: Variant;
  state: "idle" | "shimmer" | "ready";
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-slate-900/40 aspect-[16/9]">
      {/* 底層 — 永遠在的暗紫地 */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-violet-950/60 to-slate-900" />

      {/* shimmer 掃光 */}
      <AnimatePresence>
        {state === "shimmer" && (
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
            className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/8 to-transparent"
          />
        )}
      </AnimatePresence>

      {/* ready — 漸層 placeholder 模擬出圖 */}
      <AnimatePresence>
        {state === "ready" && (
          <motion.div
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className={`absolute inset-0 bg-gradient-to-br ${variant.tint}`}
          >
            {/* 一條地平線 + 一個圓（剪影） */}
            <div className="absolute inset-x-0 bottom-[28%] h-px bg-white/20" />
            <div className="absolute left-1/2 bottom-[30%] h-14 w-14 -translate-x-1/2 rounded-full bg-white/15 blur-sm" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_30%,_rgba(0,0,0,0.5)_100%)]" />
            <div className="absolute inset-0 mix-blend-overlay opacity-30"
                 style={{
                   backgroundImage:
                     "radial-gradient(rgba(255,255,255,.18) 1px, transparent 1px)",
                   backgroundSize: "3px 3px",
                 }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 元資料條 */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-3 py-2 text-[10px] text-slate-200/80">
        <span className="rounded-md bg-black/40 px-1.5 py-0.5 ring-1 ring-white/10">
          {variant.label}
        </span>
        <span className="rounded-md bg-black/40 px-1.5 py-0.5 ring-1 ring-white/10">
          {variant.id}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-3 py-2 text-[10px] text-slate-200/80">
        <span className="rounded-md bg-black/40 px-1.5 py-0.5 ring-1 ring-white/10">
          {variant.lens} {variant.aperture}
        </span>
        <span className="rounded-md bg-black/40 px-1.5 py-0.5 ring-1 ring-white/10">
          {variant.iso}
        </span>
        <span className="rounded-md bg-black/40 px-1.5 py-0.5 ring-1 ring-white/10">
          {variant.vibe}
        </span>
      </div>

      {/* 完成色標 */}
      {state === "ready" && (
        <div className="absolute right-3 top-[55%] flex flex-col gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${variant.swatch} ring-2 ring-white/30`} />
          <span className="h-2.5 w-2.5 rounded-full bg-white/40 ring-2 ring-white/20" />
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 底部三欄 — 全站光球代理 / 25 精靈心智圖 / TIMELINE
 * ────────────────────────────────────────────────────────────────────────── */

function BottomDashboard({
  phase,
  eventIdx,
  timeline,
  activeRoles,
}: {
  phase: Phase;
  eventIdx: number;
  timeline: TimelineEvent[];
  activeRoles: Set<AgentRole>;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/60 to-violet-950/30 p-4 sm:p-5 backdrop-blur-xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4 text-violet-300" />
          <span className="text-slate-100">全站光球代理</span>
          <span className="text-slate-400/60">·</span>
          <span className="text-slate-300/70">25 精靈協作</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-300/60">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE
          </span>
          <span>phase {Math.min(phase + 7, 11)} / 16</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <RouterPanel />
        <SpiritsMindMap activeRoles={activeRoles} />
        <TimelinePanel eventIdx={eventIdx} timeline={timeline} />
      </div>
    </div>
  );
}

function RouterPanel() {
  return (
    <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/5 space-y-3">
      <div className="flex items-center gap-2 text-xs text-violet-200/80">
        <Compass className="h-3 w-3" />
        全站光球代理 · 路由邏輯
      </div>
      <RouterStep n={1} title="提示詞 prompt" desc="上下文擷取 · 約束擷取" />
      <RouterStep n={2} title="模態 router" desc="主模態 + 副模態 + film-grain CFG" active />
      <RouterStep n={3} title="召喚對應精靈" desc="V1 · V2 · V3 · V4" />
      <RouterStep n={4} title="參考圖回收 / 交付" desc="主圖 · 細調 · 出檔" />
    </div>
  );
}

function RouterStep({
  n,
  title,
  desc,
  active,
}: {
  n: number;
  title: string;
  desc: string;
  active?: boolean;
}) {
  return (
    <div
      className={[
        "flex items-start gap-3 rounded-lg px-3 py-2 transition-all",
        active
          ? "bg-violet-500/15 ring-1 ring-violet-300/40 shadow-[0_0_18px_rgba(168,85,247,0.25)]"
          : "bg-white/[0.02] ring-1 ring-white/5",
      ].join(" ")}
    >
      <span
        className={[
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]",
          active
            ? "bg-violet-400 text-slate-900 font-medium"
            : "bg-white/10 text-slate-200",
        ].join(" ")}
      >
        {n}
      </span>
      <div className="min-w-0">
        <div className="text-xs text-slate-100">{title}</div>
        <div className="text-[10px] text-slate-300/60">{desc}</div>
      </div>
    </div>
  );
}

function SpiritsMindMap({ activeRoles }: { activeRoles: Set<AgentRole> }) {
  return (
    <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-violet-200/80">
          <ListTree className="h-3 w-3" />
          25 精靈心智圖
        </div>
        <span className="text-[10px] text-slate-300/50">
          活躍 {activeRoles.size} / 25
        </span>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {SPIRITS.map((s) => {
          const active = activeRoles.has(s.id);
          return (
            <motion.div
              key={s.id}
              animate={
                active
                  ? { scale: [1, 1.08, 1], opacity: 1 }
                  : { scale: 1, opacity: 0.55 }
              }
              transition={{
                duration: 1.6,
                repeat: active ? Infinity : 0,
                ease: "easeInOut",
              }}
              className={[
                "group flex flex-col items-center gap-0.5 rounded-md py-1.5 transition-all",
                active
                  ? `bg-gradient-to-br ${s.gradient} text-slate-900 shadow-[0_0_14px_rgba(168,85,247,0.45)]`
                  : "bg-white/[0.03] ring-1 ring-white/5 text-slate-300/70",
              ].join(" ")}
              title={`${s.label}（${s.nickname}） · ${s.vibe}`}
            >
              <span className="text-base leading-none">{s.emoji}</span>
              <span className="text-[9px] leading-tight">{s.nickname}</span>
            </motion.div>
          );
        })}
      </div>
      <ActiveSpiritsLegend activeRoles={activeRoles} />
    </div>
  );
}

function ActiveSpiritsLegend({ activeRoles }: { activeRoles: Set<AgentRole> }) {
  const list = useMemo(
    () =>
      Array.from(activeRoles)
        .map((id) => SPIRITS_BY_ID[id])
        .filter(Boolean)
        .slice(0, 6),
    [activeRoles],
  );
  if (list.length === 0) {
    return (
      <p className="text-[10px] text-slate-400/60 italic">
        待命中 — 按「即時生成」喚醒對應精靈
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((s) => (
        <span
          key={s.id}
          className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] text-violet-100 ring-1 ring-violet-300/30"
        >
          {s.emoji} {s.nickname}
        </span>
      ))}
    </div>
  );
}

function TimelinePanel({
  eventIdx,
  timeline,
}: {
  eventIdx: number;
  timeline: TimelineEvent[];
}) {
  // 顯示最近 7 條，stream 風格倒序
  const visible = timeline.slice(0, eventIdx + 1).slice(-7);

  return (
    <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-violet-200/80">
          <Clock className="h-3 w-3" />
          TIMELINE
        </div>
        <span className="text-[10px] text-slate-300/50">
          {Math.min(eventIdx + 1, timeline.length)} / {timeline.length}
        </span>
      </div>
      <div className="space-y-1.5 min-h-[200px]">
        <AnimatePresence initial={false}>
          {visible.map((ev, i) => {
            const spirit = ev.role ? SPIRITS_BY_ID[ev.role] : null;
            return (
              <motion.div
                key={`${ev.t}-${i}-${ev.text}`}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="flex items-start gap-2 rounded-md bg-white/[0.02] px-2 py-1.5 ring-1 ring-white/5"
              >
                <span className="font-mono text-[10px] text-slate-400/70 mt-0.5">
                  {ev.t}
                </span>
                {spirit && (
                  <span className="text-xs" title={spirit.label}>
                    {spirit.emoji}
                  </span>
                )}
                <span className="text-[11px] text-slate-200/90 leading-snug">
                  {ev.text}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {visible.length === 0 && (
          <p className="text-[10px] text-slate-400/60 italic">
            尚未開始 — 提交 prompt 後事件會自動流入
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-white/5 text-[10px] text-slate-400/70">
        <Cpu className="h-3 w-3" />
        queue: image_gen_x4 · partial.1 → partial.2 → partial.3 …
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 背景 — 緩慢飄移的星雲漸層 + 微粒
 * ────────────────────────────────────────────────────────────────────────── */

function BackgroundField() {
  return (
    <>
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        animate={{
          background: [
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(124,58,237,0.25), transparent 60%), radial-gradient(ellipse 60% 40% at 80% 60%, rgba(14,165,233,0.18), transparent 60%)",
            "radial-gradient(ellipse 80% 50% at 30% 10%, rgba(168,85,247,0.30), transparent 60%), radial-gradient(ellipse 60% 40% at 70% 70%, rgba(99,102,241,0.20), transparent 60%)",
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(124,58,237,0.25), transparent 60%), radial-gradient(ellipse 60% 40% at 80% 60%, rgba(14,165,233,0.18), transparent 60%)",
          ],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <Separator className="hidden" />
    </>
  );
}
