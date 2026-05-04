/**
 * FocusFlowPage.tsx — 專注流（番茄鐘 × 療癒時間 × 聚焦時間）
 *
 * 三合一工作流：
 *   1. 番茄鐘 — 經典 25/5 番茄工作法計時器
 *   2. 療癒時間 — 放鬆呼吸引導 + 環境音效
 *   3. 聚焦時間 — 專注寫下零散想法，最終彙整
 *
 * 設計概念：放鬆 → 專注 → 聚焦想法
 *
 * 狀態由 FocusFlowContext 全域管理，導航不會中斷計時器。
 * 也可透過光球 (ProactiveOrbWidget) 的迷你面板使用。
 */

import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { usePageTour } from "@/contexts/SiteOnboardingContext";
import { useRegisterPageAgent } from "@/contexts/PageAgentContext";
import type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
} from "../../../shared/agent-actions";
import { GlassCard } from "@/components/ZenCoPilot";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Timer,
  Heart,
  Target,
  Play,
  Pause,
  RotateCcw,
  Plus,
  Trash2,
  Sparkles,
  ChevronRight,
  Coffee,
  Brain,
  Wind,
  ListChecks,
  Clock,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import {
  useFocusFlow,
  POMODORO_WORK_PRESETS,
  POMODORO_BREAK_PRESETS,
  HEALING_PRESETS,
  BREATHING_PHASES,
  type FlowMode,
} from "@/contexts/FocusFlowContext";

// ─── Constants ──────────────────────────────────────────────────────────────

const MODE_CONFIG: Record<
  FlowMode,
  { icon: typeof Timer; label: string; color: string; description: string }
> = {
  pomodoro: {
    icon: Timer,
    label: "番茄鐘",
    color: "text-red-500",
    description: "自訂專注與休息時長",
  },
  healing: {
    icon: Heart,
    label: "療癒時間",
    color: "text-pink-500",
    description: "呼吸引導 · 放鬆身心",
  },
  focus: {
    icon: Target,
    label: "聚焦時間",
    color: "text-indigo-500",
    description: "收集零散想法 · 釐清方向",
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// ─── Time Preset Picker ─────────────────────────────────────────────────────

function TimePresetPicker({
  label,
  presets,
  value,
  onChange,
  disabled,
  colorClass = "bg-primary",
}: {
  label: string;
  presets: readonly number[];
  value: number;
  onChange: (min: number) => void;
  disabled?: boolean;
  colorClass?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Clock className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map(min => {
          const isActive = value === min;
          return (
            <button
              key={min}
              onClick={() => onChange(min)}
              disabled={disabled}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                isActive
                  ? `${colorClass} text-primary-foreground shadow-sm`
                  : "bg-muted/60 text-muted-foreground hover:bg-muted"
              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              {min} 分
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Pomodoro Timer (reads from FocusFlowContext) ────────────────────────────

function PomodoroTimer() {
  const {
    pomodoroPhase: phase,
    pomodoroRemaining: remaining,
    pomodoroRunning: running,
    pomodoroRounds: rounds,
    pomodoroWorkMin,
    pomodoroBreakMin,
    setPomodoroWorkMin,
    setPomodoroBreakMin,
    togglePomodoro,
    resetPomodoro,
    totalFocusSeconds,
  } = useFocusFlow();

  const [showSettings, setShowSettings] = useState(false);

  const totalSeconds =
    phase === "work" ? pomodoroWorkMin * 60 : pomodoroBreakMin * 60;
  const progress = ((totalSeconds - remaining) / totalSeconds) * 100;

  return (
    <div className="flex flex-col items-center gap-5">
      {/* Phase badge + stats */}
      <div className="flex items-center gap-3">
        <Badge
          variant={phase === "work" ? "default" : "secondary"}
          className="text-sm px-3 py-1"
        >
          {phase === "work" ? "🍅 專注中" : "☕ 休息中"}
        </Badge>
        <span className="text-sm text-muted-foreground">
          已完成 {rounds} 輪
        </span>
        {totalFocusSeconds > 0 && (
          <span className="text-xs text-muted-foreground/70">
            累計 {Math.round(totalFocusSeconds / 60)} 分鐘
          </span>
        )}
      </div>

      {/* Timer circle */}
      <div className="relative w-56 h-56 flex items-center justify-center">
        <svg
          className="absolute inset-0 w-full h-full -rotate-90"
          viewBox="0 0 100 100"
        >
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-border/30"
          />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 45}`}
            strokeDashoffset={`${2 * Math.PI * 45 * (1 - progress / 100)}`}
            className={
              phase === "work"
                ? "text-red-400 transition-all duration-1000"
                : "text-green-400 transition-all duration-1000"
            }
          />
        </svg>
        <div className="flex flex-col items-center">
          <span className="text-4xl font-bold tabular-nums text-foreground">
            {formatTime(remaining)}
          </span>
          <span className="text-xs text-muted-foreground mt-1">
            {phase === "work"
              ? `專注 ${pomodoroWorkMin} 分鐘`
              : `休息 ${pomodoroBreakMin} 分鐘`}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          onClick={resetPomodoro}
          className="rounded-full h-10 w-10"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          size="lg"
          onClick={togglePomodoro}
          className="rounded-full h-14 w-14 shadow-lg"
        >
          {running ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5 ml-0.5" />
          )}
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setShowSettings(s => !s)}
          className={`rounded-full h-10 w-10 transition-colors ${showSettings ? "bg-muted" : ""}`}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Time presets (collapsible) */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="w-full overflow-hidden"
          >
            <div className="flex flex-col gap-3 p-4 rounded-xl bg-muted/30 border border-border/50">
              <TimePresetPicker
                label="專注時長"
                presets={POMODORO_WORK_PRESETS}
                value={pomodoroWorkMin}
                onChange={setPomodoroWorkMin}
                disabled={running}
                colorClass="bg-red-500"
              />
              <TimePresetPicker
                label="休息時長"
                presets={POMODORO_BREAK_PRESETS}
                value={pomodoroBreakMin}
                onChange={setPomodoroBreakMin}
                disabled={running}
                colorClass="bg-green-500"
              />
              {running && (
                <p className="hs-small !mb-0 text-muted-foreground text-center">
                  ⏸ 暫停後才能更改時間設定
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Healing / Breathing Timer (reads from FocusFlowContext) ─────────────────

function HealingTimer() {
  const {
    healingRemaining: remaining,
    healingRunning: running,
    healingMin,
    setHealingMin,
    breathPhaseIdx,
    breathLabel,
    toggleHealing,
    resetHealing,
  } = useFocusFlow();

  const [showSettings, setShowSettings] = useState(false);
  const healingSec = healingMin * 60;
  const progress =
    healingSec > 0 ? ((healingSec - remaining) / healingSec) * 100 : 0;
  const currentBreathPhase = BREATHING_PHASES[breathPhaseIdx];

  return (
    <div className="flex flex-col items-center gap-5">
      <span className="text-sm text-muted-foreground">
        深呼吸，讓自己慢下來
      </span>

      {/* Breathing orb */}
      <div className="relative w-56 h-56 flex items-center justify-center">
        <motion.div
          className="absolute rounded-full"
          animate={{
            scale: running ? currentBreathPhase.scale : 1,
            boxShadow: running
              ? [
                  "0 0 30px rgba(236, 180, 198, 0.3)",
                  "0 0 60px rgba(236, 180, 198, 0.6)",
                  "0 0 30px rgba(236, 180, 198, 0.3)",
                ]
              : "0 0 20px rgba(236, 180, 198, 0.2)",
          }}
          transition={{
            scale: {
              duration: currentBreathPhase.duration / 1000,
              ease: "easeInOut",
            },
            boxShadow: { duration: 3, repeat: Infinity, ease: "easeInOut" },
          }}
          style={{
            width: 140,
            height: 140,
            background:
              "radial-gradient(circle at 35% 35%, rgba(236, 180, 198, 0.7), rgba(212, 197, 226, 0.5), rgba(200, 213, 224, 0.3))",
          }}
        />
        <div className="flex flex-col items-center z-10">
          <AnimatePresence mode="wait">
            <motion.span
              key={breathLabel}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="text-lg font-medium text-foreground"
            >
              {running ? breathLabel : "準備好了嗎？"}
            </motion.span>
          </AnimatePresence>
          <span className="text-3xl font-bold tabular-nums text-foreground mt-2">
            {formatTime(remaining)}
          </span>
          <span className="text-[10px] text-muted-foreground mt-1">
            {healingMin} 分鐘療癒
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-xs">
        <Progress value={progress} className="h-1.5" />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          onClick={resetHealing}
          className="rounded-full h-10 w-10"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          size="lg"
          onClick={toggleHealing}
          className="rounded-full h-14 w-14 shadow-lg"
        >
          {running ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5 ml-0.5" />
          )}
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setShowSettings(s => !s)}
          className={`rounded-full h-10 w-10 transition-colors ${showSettings ? "bg-muted" : ""}`}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Time presets (collapsible) */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="w-full overflow-hidden"
          >
            <div className="flex flex-col gap-3 p-4 rounded-xl bg-muted/30 border border-border/50">
              <TimePresetPicker
                label="療癒時長"
                presets={HEALING_PRESETS}
                value={healingMin}
                onChange={setHealingMin}
                disabled={running}
                colorClass="bg-pink-500"
              />
              {running && (
                <p className="hs-small !mb-0 text-muted-foreground text-center">
                  ⏸ 暫停後才能更改時間設定
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Focus / Thought Collector (reads from FocusFlowContext) ────────────────

function FocusCollector() {
  const { thoughts, addThought, removeThought, clearThoughts } = useFocusFlow();
  const [draft, setDraft] = useState("");
  const [showSummary, setShowSummary] = useState(false);

  const handleAdd = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    addThought(trimmed);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-5 w-full">
      <p className="hs-small !mb-0 text-muted-foreground text-center">
        把腦中零散的想法寫下來，最後一起整理
      </p>

      {/* Input area */}
      <div className="flex gap-2">
        <Textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="現在腦中浮現什麼想法..."
          className="min-h-[80px] resize-none rounded-xl"
          onKeyDown={e => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
      </div>
      <div className="flex gap-2">
        <Button
          onClick={handleAdd}
          disabled={!draft.trim()}
          className="rounded-xl flex-1"
        >
          <Plus className="h-4 w-4 mr-1" /> 記錄想法
        </Button>
        {thoughts.length > 0 && (
          <Button
            variant="outline"
            onClick={() => setShowSummary(!showSummary)}
            className="rounded-xl"
          >
            <ListChecks className="h-4 w-4 mr-1" />{" "}
            {showSummary ? "收起" : "彙整"}
          </Button>
        )}
      </div>

      {/* Thought list */}
      <AnimatePresence>
        {thoughts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="group flex items-start gap-3 rounded-xl p-3"
            style={{
              background: "rgba(255,255,255,0.5)",
              border: "1px solid rgba(255,255,255,0.4)",
            }}
          >
            <Sparkles className="h-4 w-4 text-indigo-400 mt-0.5 shrink-0" />
            <p className="text-sm text-foreground flex-1 whitespace-pre-wrap break-words">
              {t.text}
            </p>
            <button
              onClick={() => removeThought(t.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-destructive"
              aria-label="刪除想法"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Summary view */}
      <AnimatePresence>
        {showSummary && thoughts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <GlassCard className="mt-2">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="h-4 w-4 text-indigo-500" />
                <h4 className="hs-h3 !mb-0 text-foreground">想法彙整</h4>
                <Badge variant="secondary" className="ml-auto text-xs">
                  {thoughts.length} 則
                </Badge>
              </div>
              <ol className="space-y-2 list-decimal list-inside">
                {thoughts.map((t, i) => (
                  <li key={t.id} className="text-sm text-foreground/90">
                    {t.text}
                  </li>
                ))}
              </ol>
              <div className="flex gap-2 mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const text = thoughts
                      .map((t, i) => `${i + 1}. ${t.text}`)
                      .join("\n");
                    navigator.clipboard
                      .writeText(text)
                      .then(() => toast.success("已複製到剪貼簿"));
                  }}
                  className="rounded-lg text-xs"
                >
                  📋 複製全部
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    clearThoughts();
                    setShowSummary(false);
                  }}
                  className="rounded-lg text-xs text-destructive"
                >
                  <Trash2 className="h-3 w-3 mr-1" /> 清除全部
                </Button>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {thoughts.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <Wind className="h-8 w-8 mx-auto mb-2 opacity-40" />
          還沒有記錄任何想法，試著寫下第一個吧 ✨
        </div>
      )}
    </div>
  );
}

// ─── Flow Stepper ───────────────────────────────────────────────────────────

function FlowStepper({
  currentStep,
  onStepClick,
}: {
  currentStep: number;
  onStepClick: (step: number) => void;
}) {
  const steps = [
    { label: "放鬆", icon: Heart, sublabel: "療癒時間" },
    { label: "專注", icon: Timer, sublabel: "番茄鐘" },
    { label: "聚焦", icon: Target, sublabel: "整理想法" },
  ];

  return (
    <div className="flex items-center justify-center gap-2 sm:gap-4 mb-6">
      {steps.map((step, i) => {
        const isActive = currentStep === i;
        const isDone = currentStep > i;
        return (
          <div key={step.label} className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => onStepClick(i)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-md"
                  : isDone
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <step.icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{step.sublabel}</span>
              <span className="sm:hidden">{step.label}</span>
            </button>
            {i < steps.length - 1 && (
              <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function FocusFlowPage() {
  usePageTour("focus-flow");
  const [, navigate] = useLocation();

  const [activeTab, setActiveTab] = useState<FlowMode>("healing");
  const [flowStep, setFlowStep] = useState(0);

  // Map flow steps to tab modes
  const stepToMode: FlowMode[] = ["healing", "pomodoro", "focus"];

  const handleStepClick = (step: number) => {
    setFlowStep(step);
    setActiveTab(stepToMode[step]);
  };

  // ── PageAgent：光球可切換節奏、推進步驟、跳到相關頁面 ─────────────
  const FOCUS_TAB_OPTIONS = useMemo(
    () => [
      { id: "healing", label: "療癒時間", description: "呼吸放鬆" },
      { id: "pomodoro", label: "番茄鐘", description: "25/5 專注" },
      { id: "focus", label: "聚焦時間", description: "整理想法" },
    ],
    []
  );
  const FOCUS_NAV_ALLOWLIST = useMemo<Set<string>>(
    () => new Set(["/notes", "/dashboard", "/calendar", "/studio", "/settings"]),
    []
  );
  const focusAgentCapabilities: AgentCapability[] = useMemo(
    () => [
      {
        action: "setTab",
        label: "切換節奏",
        currentId: activeTab,
        options: FOCUS_TAB_OPTIONS,
        hint: "healing（療癒）| pomodoro（番茄鐘）| focus（聚焦）",
      },
      {
        action: "setParam",
        label: "推進流程步驟",
        hint: "setParam key='flowStep' value=0..2（0=療癒→1=番茄→2=聚焦）",
      },
      {
        action: "navigate",
        label: "前往相關頁面",
        options: [
          { id: "/notes", label: "專案筆記", meta: { bestFor: "記錄靈感", tip: "專注時的想法隨手記" } },
          { id: "/dashboard", label: "儀表板", meta: { bestFor: "看產能", tip: "專注後檢視產出" } },
          { id: "/calendar", label: "行事曆", meta: { bestFor: "排程", tip: "專注時段排入行事曆" } },
          { id: "/studio", label: "創作工作室", meta: { bestFor: "開始創作", tip: "專注後直接進入創作" } },
          { id: "/settings", label: "個人設定", meta: { bestFor: "調整專注偏好", tip: "設定預設專注時長" } },
        ],
        hint: "navigate path='/notes' | '/dashboard' | '/calendar' | '/studio' | '/settings'",
      },
    ],
    [activeTab, FOCUS_TAB_OPTIONS]
  );

  useRegisterPageAgent({
    pageId: "focus-flow",
    pageLabel: "專注流",
    pagePath: "/focus-flow",
    capabilities: focusAgentCapabilities,
    state: { activeTab, flowStep },
    handle: async (action: AgentAction): Promise<AgentActionResult> => {
      switch (action.type) {
        case "setTab": {
          const valid: FlowMode[] = ["healing", "pomodoro", "focus"];
          if (!valid.includes(action.tabId as FlowMode)) {
            return { ok: false, reason: `unknown tab: ${action.tabId}` };
          }
          const next = action.tabId as FlowMode;
          setActiveTab(next);
          const step = stepToMode.indexOf(next);
          if (step >= 0) setFlowStep(step);
          return { ok: true, message: `切到「${next}」` };
        }
        case "setParam": {
          if (action.key === "flowStep") {
            const n = Number(action.value);
            if (!Number.isInteger(n) || n < 0 || n > 2) {
              return { ok: false, reason: "flowStep 必須是 0、1、2" };
            }
            setFlowStep(n);
            setActiveTab(stepToMode[n]);
            return { ok: true, message: `跳到步驟 ${n + 1}` };
          }
          return { ok: false, reason: `unknown param key: ${action.key}` };
        }
        case "navigate": {
          if (!FOCUS_NAV_ALLOWLIST.has(action.path)) {
            return {
              ok: false,
              reason: `navigation blocked: ${action.path}`,
            };
          }
          navigate(action.path);
          return { ok: true, message: `已導航到 ${action.path}` };
        }
        case "reset": {
          setActiveTab("healing");
          setFlowStep(0);
          return { ok: true, message: "已回到療癒起點" };
        }
        default:
          return {
            ok: false,
            reason: `unsupported on focus-flow: ${action.type}`,
          };
      }
    },
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center" id="focus-flow-header">
        <h1 className="hs-h1 !mb-0 text-foreground">專注流</h1>
        <p className="hs-small !mb-0 text-muted-foreground mt-1">
          放鬆 → 專注 → 聚焦想法
        </p>
      </div>

      {/* Flow stepper */}
      <FlowStepper currentStep={flowStep} onStepClick={handleStepClick} />

      {/* Tabs for free switching */}
      <Tabs
        value={activeTab}
        onValueChange={v => setActiveTab(v as FlowMode)}
        className="w-full"
      >
        <TabsList
          className="grid w-full grid-cols-3 rounded-xl h-11"
          id="focus-flow-tabs"
        >
          {(["pomodoro", "healing", "focus"] as FlowMode[]).map(mode => {
            const cfg = MODE_CONFIG[mode];
            const Icon = cfg.icon;
            return (
              <TabsTrigger
                key={mode}
                value={mode}
                className="rounded-lg text-xs sm:text-sm gap-1.5 data-[state=active]:shadow-sm"
              >
                <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                <span>{cfg.label}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <div className="mt-6">
          <TabsContent value="pomodoro">
            <GlassCard hover={false} id="focus-flow-pomodoro">
              <div className="flex items-center gap-2 mb-1">
                <Coffee className="h-4 w-4 text-red-400" />
                <h3 className="hs-h3 !mb-0 text-foreground">番茄鐘</h3>
              </div>
              <p className="hs-small !mb-0 text-muted-foreground mb-6">
                {MODE_CONFIG.pomodoro.description}
              </p>
              <PomodoroTimer />
            </GlassCard>
          </TabsContent>

          <TabsContent value="healing">
            <GlassCard hover={false} id="focus-flow-healing">
              <div className="flex items-center gap-2 mb-1">
                <Wind className="h-4 w-4 text-pink-400" />
                <h3 className="hs-h3 !mb-0 text-foreground">療癒時間</h3>
              </div>
              <p className="hs-small !mb-0 text-muted-foreground mb-6">
                {MODE_CONFIG.healing.description}
              </p>
              <HealingTimer />
            </GlassCard>
          </TabsContent>

          <TabsContent value="focus">
            <GlassCard hover={false} id="focus-flow-focus">
              <div className="flex items-center gap-2 mb-1">
                <Brain className="h-4 w-4 text-indigo-400" />
                <h3 className="hs-h3 !mb-0 text-foreground">聚焦時間</h3>
              </div>
              <p className="hs-small !mb-0 text-muted-foreground mb-6">
                {MODE_CONFIG.focus.description}
              </p>
              <FocusCollector />
            </GlassCard>
          </TabsContent>
        </div>
      </Tabs>

      {/* Suggested flow card */}
      <GlassCard className="text-center">
        <p className="hs-small !mb-0 text-muted-foreground">
          💡 建議流程：先用<strong>療癒時間</strong>放鬆身心，再用
          <strong>番茄鐘</strong>專注工作，最後在<strong>聚焦時間</strong>
          整理想法
        </p>
        <p className="hs-small !mb-0 text-muted-foreground mt-2">
          🌟 計時器已全站同步 — 切換頁面不會中斷，也可透過右下角
          <strong>光球</strong>隨時操作
        </p>
      </GlassCard>
    </div>
  );
}
