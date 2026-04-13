/**
 * FocusFlowContext — 全站共用的專注流狀態管理
 *
 * 讓番茄鐘、療癒計時、想法收集可以在任何頁面使用（透過光球或專注流頁面）。
 * 導航不會中斷計時器。
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PomodoroPhase = "work" | "break";
export type FlowMode = "pomodoro" | "healing" | "focus";

export interface ThoughtEntry {
  id: string;
  text: string;
  createdAt: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const POMODORO_WORK_SECONDS = 25 * 60;
export const POMODORO_BREAK_SECONDS = 5 * 60;
export const HEALING_SECONDS = 5 * 60;

export const BREATHING_PHASES = [
  { label: "吸氣", duration: 4000, scale: 1.3 },
  { label: "屏息", duration: 4000, scale: 1.3 },
  { label: "吐氣", duration: 6000, scale: 1.0 },
  { label: "放鬆", duration: 2000, scale: 1.0 },
] as const;

// ─── Context Type ───────────────────────────────────────────────────────────

interface FocusFlowContextType {
  // Pomodoro
  pomodoroPhase: PomodoroPhase;
  pomodoroRemaining: number;
  pomodoroRunning: boolean;
  pomodoroRounds: number;
  startPomodoro: () => void;
  pausePomodoro: () => void;
  togglePomodoro: () => void;
  resetPomodoro: () => void;

  // Healing
  healingRemaining: number;
  healingRunning: boolean;
  breathPhaseIdx: number;
  breathLabel: string;
  startHealing: () => void;
  pauseHealing: () => void;
  toggleHealing: () => void;
  resetHealing: () => void;

  // Thoughts
  thoughts: ThoughtEntry[];
  addThought: (text: string) => void;
  removeThought: (id: string) => void;
  clearThoughts: () => void;

  // Global state
  isAnyTimerRunning: boolean;
  activeMode: FlowMode | null;
}

const FocusFlowContext = createContext<FocusFlowContextType | null>(null);

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadThoughts(): ThoughtEntry[] {
  try {
    const saved = localStorage.getItem("focus-flow-thoughts");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

// ─── Provider ───────────────────────────────────────────────────────────────

export function FocusFlowProvider({ children }: { children: ReactNode }) {
  // ── Pomodoro State ──────────────────────────────────────────────────────
  const [pomodoroPhase, setPomodoroPhase] = useState<PomodoroPhase>("work");
  const [pomodoroRemaining, setPomodoroRemaining] = useState(POMODORO_WORK_SECONDS);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroRounds, setPomodoroRounds] = useState(0);
  const pomodoroRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Healing State ───────────────────────────────────────────────────────
  const [healingRemaining, setHealingRemaining] = useState(HEALING_SECONDS);
  const [healingRunning, setHealingRunning] = useState(false);
  const [breathPhaseIdx, setBreathPhaseIdx] = useState(0);
  const [breathLabel, setBreathLabel] = useState<string>(BREATHING_PHASES[0].label);
  const healingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const breathRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Thoughts State ──────────────────────────────────────────────────────
  const [thoughts, setThoughts] = useState<ThoughtEntry[]>(loadThoughts);

  // Persist thoughts to localStorage
  useEffect(() => {
    localStorage.setItem("focus-flow-thoughts", JSON.stringify(thoughts));
  }, [thoughts]);

  // ── Pomodoro Timer Effect ──────────────────────────────────────────────
  useEffect(() => {
    if (!pomodoroRunning) {
      if (pomodoroRef.current) {
        clearInterval(pomodoroRef.current);
        pomodoroRef.current = null;
      }
      return;
    }

    pomodoroRef.current = setInterval(() => {
      setPomodoroRemaining((prev) => {
        if (prev <= 1) {
          if (pomodoroRef.current) {
            clearInterval(pomodoroRef.current);
            pomodoroRef.current = null;
          }
          setPomodoroRunning(false);

          if (pomodoroPhase === "work") {
            setPomodoroRounds((r) => r + 1);
            toast.success("🍅 專注時間結束！休息一下吧");
            setPomodoroPhase("break");
            return POMODORO_BREAK_SECONDS;
          } else {
            toast.success("☕ 休息結束！準備進入下一輪");
            setPomodoroPhase("work");
            return POMODORO_WORK_SECONDS;
          }
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (pomodoroRef.current) {
        clearInterval(pomodoroRef.current);
        pomodoroRef.current = null;
      }
    };
  }, [pomodoroRunning, pomodoroPhase]);

  // ── Healing Timer Effect ──────────────────────────────────────────────
  useEffect(() => {
    if (!healingRunning) {
      if (healingRef.current) {
        clearInterval(healingRef.current);
        healingRef.current = null;
      }
      return;
    }

    healingRef.current = setInterval(() => {
      setHealingRemaining((prev) => {
        if (prev <= 1) {
          if (healingRef.current) {
            clearInterval(healingRef.current);
            healingRef.current = null;
          }
          setHealingRunning(false);
          toast.success("🌿 療癒時間結束，感覺如何？");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (healingRef.current) {
        clearInterval(healingRef.current);
        healingRef.current = null;
      }
    };
  }, [healingRunning]);

  // ── Breathing Cycle Effect ─────────────────────────────────────────────
  useEffect(() => {
    if (!healingRunning) {
      if (breathRef.current) {
        clearTimeout(breathRef.current);
        breathRef.current = null;
      }
      return;
    }

    const currentPhase = BREATHING_PHASES[breathPhaseIdx];
    breathRef.current = setTimeout(() => {
      setBreathPhaseIdx((prev) => {
        const next = (prev + 1) % BREATHING_PHASES.length;
        setBreathLabel(BREATHING_PHASES[next].label);
        return next;
      });
    }, currentPhase.duration);

    return () => {
      if (breathRef.current) {
        clearTimeout(breathRef.current);
        breathRef.current = null;
      }
    };
  }, [healingRunning, breathPhaseIdx]);

  // ── Actions ────────────────────────────────────────────────────────────

  const startPomodoro = useCallback(() => setPomodoroRunning(true), []);
  const pausePomodoro = useCallback(() => setPomodoroRunning(false), []);
  const togglePomodoro = useCallback(() => setPomodoroRunning((r) => !r), []);
  const resetPomodoro = useCallback(() => {
    setPomodoroRunning(false);
    setPomodoroPhase("work");
    setPomodoroRemaining(POMODORO_WORK_SECONDS);
  }, []);

  const startHealing = useCallback(() => setHealingRunning(true), []);
  const pauseHealing = useCallback(() => setHealingRunning(false), []);
  const toggleHealing = useCallback(() => setHealingRunning((r) => !r), []);
  const resetHealing = useCallback(() => {
    setHealingRunning(false);
    setHealingRemaining(HEALING_SECONDS);
    setBreathPhaseIdx(0);
    setBreathLabel(BREATHING_PHASES[0].label);
  }, []);

  const addThought = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setThoughts((prev) => [
      ...prev,
      { id: generateId(), text: trimmed, createdAt: Date.now() },
    ]);
    toast.success("💡 想法已記錄");
  }, []);

  const removeThought = useCallback((id: string) => {
    setThoughts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearThoughts = useCallback(() => {
    setThoughts([]);
    toast("已清除所有想法");
  }, []);

  const isAnyTimerRunning = pomodoroRunning || healingRunning;
  const activeMode: FlowMode | null = pomodoroRunning
    ? "pomodoro"
    : healingRunning
      ? "healing"
      : null;

  return (
    <FocusFlowContext.Provider
      value={{
        pomodoroPhase,
        pomodoroRemaining,
        pomodoroRunning,
        pomodoroRounds,
        startPomodoro,
        pausePomodoro,
        togglePomodoro,
        resetPomodoro,

        healingRemaining,
        healingRunning,
        breathPhaseIdx,
        breathLabel,
        startHealing,
        pauseHealing,
        toggleHealing,
        resetHealing,

        thoughts,
        addThought,
        removeThought,
        clearThoughts,

        isAnyTimerRunning,
        activeMode,
      }}
    >
      {children}
    </FocusFlowContext.Provider>
  );
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useFocusFlow(): FocusFlowContextType {
  const ctx = useContext(FocusFlowContext);
  if (!ctx) throw new Error("useFocusFlow must be used within FocusFlowProvider");
  return ctx;
}
