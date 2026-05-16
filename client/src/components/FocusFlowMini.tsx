/**
 * FocusFlowMini — 嵌入光球面板的迷你專注流控件
 *
 * 包含：
 *   - 迷你番茄鐘計時器
 *   - 迷你療癒呼吸計時器
 *   - 快速想法記錄
 *
 * 所有狀態來自 FocusFlowContext，導航不會中斷計時。
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useFocusFlow, BREATHING_PHASES } from "@/contexts/FocusFlowContext";
import {
  Timer,
  Heart,
  Target,
  Play,
  Pause,
  RotateCcw,
  Plus,
  Trash2,
  Coffee,
  Wind,
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// ─── Mini Pomodoro ──────────────────────────────────────────────────────────

function MiniPomodoro() {
  const {
    pomodoroPhase,
    pomodoroRemaining,
    pomodoroRunning,
    pomodoroRounds,
    pomodoroWorkMin,
    pomodoroBreakMin,
    togglePomodoro,
    resetPomodoro,
  } = useFocusFlow();

  const totalSeconds =
    pomodoroPhase === "work" ? pomodoroWorkMin * 60 : pomodoroBreakMin * 60;
  const progress =
    totalSeconds > 0
      ? ((totalSeconds - pomodoroRemaining) / totalSeconds) * 100
      : 0;

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      {/* Phase + rounds */}
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full"
          style={{
            background:
              pomodoroPhase === "work"
                ? "rgba(239,68,68,0.1)"
                : "rgba(34,197,94,0.1)",
            color:
              pomodoroPhase === "work" ? "rgb(239,68,68)" : "rgb(34,197,94)",
          }}
        >
          {pomodoroPhase === "work" ? "🍅 專注" : "☕ 休息"}
        </span>
        <span className="text-[10px] text-muted-foreground/70">{pomodoroRounds} 輪</span>
      </div>

      {/* Compact circular timer */}
      <div className="relative w-20 h-20 flex items-center justify-center">
        <svg
          className="absolute inset-0 w-full h-full -rotate-90"
          viewBox="0 0 100 100"
        >
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="text-gray-100"
          />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 42}`}
            strokeDashoffset={`${2 * Math.PI * 42 * (1 - progress / 100)}`}
            className={
              pomodoroPhase === "work"
                ? "text-red-400 transition-all duration-1000"
                : "text-green-400 transition-all duration-1000"
            }
          />
        </svg>
        <span className="text-base font-bold tabular-nums text-foreground">
          {formatTime(pomodoroRemaining)}
        </span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={resetPomodoro}
          className="p-1.5 rounded-full hover:bg-muted transition-colors"
          aria-label="重置"
        >
          <RotateCcw className="h-3.5 w-3.5 text-muted-foreground/70" />
        </button>
        <button
          onClick={togglePomodoro}
          className="p-2 rounded-full bg-muted text-white hover:bg-gray-700 transition-colors shadow-sm"
          aria-label={pomodoroRunning ? "暫停" : "開始"}
        >
          {pomodoroRunning ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5 ml-0.5" />
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Mini Healing ───────────────────────────────────────────────────────────

function MiniHealing() {
  const {
    healingRemaining,
    healingRunning,
    healingMin,
    breathPhaseIdx,
    breathLabel,
    toggleHealing,
    resetHealing,
  } = useFocusFlow();

  const currentBreathPhase = BREATHING_PHASES[breathPhaseIdx];
  const healingSec = healingMin * 60;
  const progress =
    healingSec > 0 ? ((healingSec - healingRemaining) / healingSec) * 100 : 0;

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <span className="text-[10px] text-muted-foreground/70">深呼吸，放鬆身心</span>

      {/* Breathing orb */}
      <div className="relative w-20 h-20 flex items-center justify-center">
        <motion.div
          className="absolute rounded-full"
          animate={{
            scale: healingRunning ? currentBreathPhase.scale : 1,
          }}
          transition={{
            scale: {
              duration: currentBreathPhase.duration / 1000,
              ease: "easeInOut",
            },
          }}
          style={{
            width: 56,
            height: 56,
            background:
              "radial-gradient(circle at 35% 35%, rgba(236,180,198,0.6), rgba(212,197,226,0.4), rgba(200,213,224,0.2))",
          }}
        />
        <div className="flex flex-col items-center z-10">
          <AnimatePresence mode="wait">
            <motion.span
              key={breathLabel}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="text-[11px] font-medium text-foreground/90"
            >
              {healingRunning ? breathLabel : "準備"}
            </motion.span>
          </AnimatePresence>
          <span className="text-base font-bold tabular-nums text-foreground mt-0.5">
            {formatTime(healingRemaining)}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-pink-300 transition-all duration-1000"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={resetHealing}
          className="p-1.5 rounded-full hover:bg-muted transition-colors"
          aria-label="重置"
        >
          <RotateCcw className="h-3.5 w-3.5 text-muted-foreground/70" />
        </button>
        <button
          onClick={toggleHealing}
          className="p-2 rounded-full bg-muted text-white hover:bg-gray-700 transition-colors shadow-sm"
          aria-label={healingRunning ? "暫停" : "開始"}
        >
          {healingRunning ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5 ml-0.5" />
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Mini Thought Collector ─────────────────────────────────────────────────

function MiniThoughts() {
  const { thoughts, addThought, removeThought, clearThoughts } = useFocusFlow();
  const [draft, setDraft] = useState("");

  const handleAdd = () => {
    if (!draft.trim()) return;
    addThought(draft);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-2 py-2">
      <span className="text-[10px] text-muted-foreground/70 text-center">
        快速記下想法
      </span>

      {/* Input */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="腦中浮現什麼..."
          className="flex-1 min-w-0 text-xs bg-muted/60 border border-border rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-300 transition-colors placeholder:text-muted-foreground"
        />
        <button
          onClick={handleAdd}
          disabled={!draft.trim()}
          className="p-1.5 rounded-lg bg-indigo-500 text-white hover:bg-indigo-400 transition-colors disabled:opacity-30 shrink-0"
          aria-label="記錄"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Thought list (max 3 visible) */}
      <div className="max-h-24 overflow-y-auto space-y-1">
        {thoughts.slice(-3).map(t => (
          <div key={t.id} className="flex items-center gap-1.5 group">
            <span className="text-[10px] text-muted-foreground flex-1 truncate">
              {t.text}
            </span>
            <button
              onClick={() => removeThought(t.id)}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-all shrink-0"
              aria-label="刪除"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Count + clear */}
      {thoughts.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground/70">
            {thoughts.length} 則想法
          </span>
          <button
            onClick={clearThoughts}
            className="text-[10px] text-muted-foreground/70 hover:text-red-400 transition-colors"
          >
            清除全部
          </button>
        </div>
      )}

      {thoughts.length === 0 && (
        <p className="text-[10px] text-muted-foreground/60 text-center py-1">
          還沒有想法，寫下第一個吧 ✨
        </p>
      )}
    </div>
  );
}

// ─── Main Mini Widget ───────────────────────────────────────────────────────

type FocusMiniTab = "pomodoro" | "healing" | "focus";

export default function FocusFlowMini() {
  const { isAnyTimerRunning, activeMode } = useFocusFlow();
  const [tab, setTab] = useState<FocusMiniTab>(() => {
    if (activeMode === "pomodoro") return "pomodoro";
    if (activeMode === "healing") return "healing";
    return "pomodoro";
  });

  const tabs: { key: FocusMiniTab; icon: typeof Timer; label: string }[] = [
    { key: "pomodoro", icon: Timer, label: "番茄鐘" },
    { key: "healing", icon: Heart, label: "療癒" },
    { key: "focus", icon: Target, label: "想法" },
  ];

  return (
    <div className="px-4 pb-4">
      {/* Tab bar */}
      <div className="flex rounded-lg bg-muted/60 p-0.5 mb-3">
        {tabs.map(t => {
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                isActive
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground/70 hover:text-foreground/90"
              }`}
            >
              <t.icon className="h-3 w-3" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
        >
          {tab === "pomodoro" && <MiniPomodoro />}
          {tab === "healing" && <MiniHealing />}
          {tab === "focus" && <MiniThoughts />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
