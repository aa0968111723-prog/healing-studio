import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import type { AIState } from "@/components/VisualSoul";

// ─── Personality localStorage persistence key ──────────────────────────────
const PERSONALITY_STORAGE_KEY = "ai-director-personality";

function readPersistedPersonality(): Personality {
  try {
    const v = localStorage.getItem(PERSONALITY_STORAGE_KEY);
    if (v === "calm" || v === "creative" || v === "technical") return v;
  } catch { /* ignore */ }
  return "creative";
}

// ─── Personality Types ─────────────────────────────────────────────────────

export type Personality = "calm" | "creative" | "technical";

export type DirectorEngineMetrics = {
  typingSpeed: number;       // chars per second (rolling average)
  idleSeconds: number;       // seconds since last input
  failCount: number;         // consecutive generation failures
  lastActivity: number;      // timestamp of last user activity
};

type AIStateContextType = {
  aiState: AIState;
  setAIState: (state: AIState) => void;
  flashThinking: (ms?: number) => void;
  flashGenerating: (ms?: number) => void;
  // Personality system
  personality: Personality;
  setPersonality: (p: Personality) => void;
  // DirectorEngine metrics
  metrics: DirectorEngineMetrics;
  reportTyping: (charCount: number) => void;
  reportFailure: () => void;
  reportSuccess: () => void;
  resetIdle: () => void;
  // Proactive intervention
  proactiveMessage: string | null;
  dismissProactive: () => void;
};

const AIStateContext = createContext<AIStateContextType>({
  aiState: "idle",
  setAIState: () => {},
  flashThinking: () => {},
  flashGenerating: () => {},
  personality: "creative",
  setPersonality: () => {},
  metrics: { typingSpeed: 0, idleSeconds: 0, failCount: 0, lastActivity: Date.now() },
  reportTyping: () => {},
  reportFailure: () => {},
  reportSuccess: () => {},
  resetIdle: () => {},
  proactiveMessage: null,
  dismissProactive: () => {},
});

// ─── Proactive Intervention Rules ──────────────────────────────────────────

const PROACTIVE_RULES: Array<{
  condition: (m: DirectorEngineMetrics, personality: Personality) => boolean;
  message: (personality: Personality) => string;
  switchTo?: Personality;
}> = [
  {
    // User idle for 20+ seconds → gentle warm nudge
    condition: (m) => m.idleSeconds >= 20 && m.idleSeconds < 45 && m.failCount === 0,
    message: (p) => p === "calm"
      ? "慢慢來，沒有壓力。如果需要靈感，試試閉上眼睛想像一個讓你安心的場景，然後把它描述出來。"
      : p === "technical"
      ? "有時候從技術參數開始反而更容易——試試先選擇一個風格或解析度，讓創作自然展開。"
      : "看起來你在思考中...試試從一個情緒或顏色開始，比如「溫暖的金色光線」或「雨後的寧靜」。",
  },
  {
    // User typing very fast → affirm and switch to creative mode
    condition: (m, p) => m.typingSpeed > 5 && p !== "creative",
    message: () => "靈感湧現了！我切換到創意模式，讓你的想法自由流動。",
    switchTo: "creative",
  },
  {
    // 2+ consecutive failures → empathetic switch to technical
    condition: (m) => m.failCount >= 2,
    message: () => "創作過程中的嘗試都是有價值的。我切換到技術模式，幫你微調參數——有時候一個小調整就能帶來大不同。",
    switchTo: "technical",
  },
  {
    // Idle 45+ seconds → warmer, more personal nudge
    condition: (m) => m.idleSeconds >= 45 && m.idleSeconds < 90,
    message: () => "休息也是創作的一部分。如果你準備好了，可以試試告訴我你今天的心情，我來幫你轉化成創作靈感。",
  },
  {
    // Idle 90+ seconds → offer guided exploration
    condition: (m) => m.idleSeconds >= 90,
    message: () => "要不要讓我帶你看看其他人的作品？有時候別人的創作會點燃意想不到的靈感。",
  },
  {
    // First success after failure → celebrate
    condition: (m) => m.failCount === 0 && m.typingSpeed > 0 && m.idleSeconds < 5,
    message: () => "太棒了！繼續保持這個節奏，你的創作正在成形中。",
  },
];

// ─── Provider ──────────────────────────────────────────────────────────────

export function AIStateProvider({ children }: { children: ReactNode }) {
  const [aiState, setAIState] = useState<AIState>("idle");
  // Read from localStorage on mount so personality survives page refreshes
  const [personality, setPersonalityState] = useState<Personality>(readPersistedPersonality);
  const [proactiveMessage, setProactiveMessage] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<DirectorEngineMetrics>({
    typingSpeed: 0,
    idleSeconds: 0,
    failCount: 0,
    lastActivity: Date.now(),
  });

  const typingBufferRef = useRef<number[]>([]);
  const idleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const proactiveShownRef = useRef<Set<string>>(new Set());

  const flashThinking = useCallback((ms = 3000) => {
    setAIState("thinking");
    setTimeout(() => setAIState("idle"), ms);
  }, []);

  const flashGenerating = useCallback((ms = 5000) => {
    setAIState("generating");
    setTimeout(() => setAIState("idle"), ms);
  }, []);

  // Report typing activity (called from prompt input onChange)
  const reportTyping = useCallback((charCount: number) => {
    const now = Date.now();
    typingBufferRef.current.push(now);
    // Keep only last 10 keystrokes for rolling average
    if (typingBufferRef.current.length > 10) {
      typingBufferRef.current = typingBufferRef.current.slice(-10);
    }
    const buffer = typingBufferRef.current;
    idleSecondsRef.current = 0;
    if (buffer.length >= 2) {
      const elapsed = (buffer[buffer.length - 1] - buffer[0]) / 1000;
      const speed = elapsed > 0 ? charCount / elapsed : 0;
      setMetrics((prev) => ({ ...prev, typingSpeed: speed, idleSeconds: 0, lastActivity: now }));
    } else {
      setMetrics((prev) => ({ ...prev, idleSeconds: 0, lastActivity: now }));
    }
  }, []);

  const reportFailure = useCallback(() => {
    setMetrics((prev) => ({ ...prev, failCount: prev.failCount + 1 }));
  }, []);

  const reportSuccess = useCallback(() => {
    setMetrics((prev) => ({ ...prev, failCount: 0 }));
  }, []);

  const resetIdle = useCallback(() => {
    idleSecondsRef.current = 0;
    setMetrics((prev) => ({ ...prev, idleSeconds: 0, lastActivity: Date.now() }));
  }, []);

  const dismissProactive = useCallback(() => {
    setProactiveMessage(null);
  }, []);

  // Idle timer: track idle time via ref, only update state at key thresholds
  // This avoids triggering a global re-render every second for all useAIState() consumers.
  const idleSecondsRef = useRef(0);

  useEffect(() => {
    // Thresholds at which proactive rules fire (from PROACTIVE_RULES conditions)
    const THRESHOLDS = [5, 20, 45, 90];
    idleTimerRef.current = setInterval(() => {
      idleSecondsRef.current += 1;
      const sec = idleSecondsRef.current;
      // Only update React state when crossing a threshold relevant to proactive rules
      if (THRESHOLDS.includes(sec)) {
        setMetrics((prev) => ({
          ...prev,
          idleSeconds: sec,
        }));
      }
    }, 1000);
    return () => {
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    };
  }, []);

  // DirectorEngine: evaluate proactive rules when metrics change
  useEffect(() => {
    // Only evaluate when not generating
    if (aiState === "generating") return;

    for (const rule of PROACTIVE_RULES) {
      const ruleKey = rule.message(personality);
      if (rule.condition(metrics, personality) && !proactiveShownRef.current.has(ruleKey)) {
        setProactiveMessage(rule.message(personality));
        proactiveShownRef.current.add(ruleKey);
        if (rule.switchTo && rule.switchTo !== personality) {
          setPersonality(rule.switchTo);
        }
        break;
      }
    }
  }, [metrics.idleSeconds, metrics.failCount, metrics.typingSpeed, aiState, personality]);

  // Wrap setPersonality to persist to localStorage
  const setPersonality = useCallback((p: Personality) => {
    setPersonalityState(p);
    try { localStorage.setItem(PERSONALITY_STORAGE_KEY, p); } catch { /* ignore */ }
  }, []);

  // Reset proactive shown set when personality changes manually
  useEffect(() => {
    proactiveShownRef.current.clear();
  }, [personality]);

  return (
    <AIStateContext.Provider
      value={{
        aiState,
        setAIState,
        flashThinking,
        flashGenerating,
        personality,
        setPersonality,
        metrics,
        reportTyping,
        reportFailure,
        reportSuccess,
        resetIdle,
        proactiveMessage,
        dismissProactive,
      }}
    >
      {children}
    </AIStateContext.Provider>
  );
}

export function useAIState() {
  return useContext(AIStateContext);
}
