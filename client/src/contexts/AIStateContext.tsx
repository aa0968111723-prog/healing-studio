import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import type { AIState } from "@/components/VisualSoul";

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
    // User idle for 30+ seconds → suggest calm guidance
    condition: (m) => m.idleSeconds >= 30 && m.failCount === 0,
    message: () => "看起來你在思考中...需要我幫你從一個關鍵詞開始構建畫面嗎？試試描述一個場景或情緒。",
    switchTo: "calm",
  },
  {
    // User typing very fast → switch to creative mode
    condition: (m, p) => m.typingSpeed > 5 && p !== "creative",
    message: () => "靈感湧現！我切換到創意模式，幫你捕捉更多想像力。",
    switchTo: "creative",
  },
  {
    // 2+ consecutive failures → switch to technical
    condition: (m) => m.failCount >= 2,
    message: () => "連續生成未達預期，我切換到技術模式，幫你精確調整參數。建議檢查提示詞的具體性和排除描述。",
    switchTo: "technical",
  },
  {
    // Idle 60+ seconds → stronger nudge
    condition: (m) => m.idleSeconds >= 60,
    message: () => "我注意到你暫停了一會兒。要不要試試「光球引導」？我可以根據你的風格偏好推薦創作方向。",
  },
];

// ─── Provider ──────────────────────────────────────────────────────────────

export function AIStateProvider({ children }: { children: ReactNode }) {
  const [aiState, setAIState] = useState<AIState>("idle");
  const [personality, setPersonality] = useState<Personality>("creative");
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
    setMetrics((prev) => ({ ...prev, idleSeconds: 0, lastActivity: Date.now() }));
  }, []);

  const dismissProactive = useCallback(() => {
    setProactiveMessage(null);
  }, []);

  // Idle timer: increment idleSeconds every second
  useEffect(() => {
    idleTimerRef.current = setInterval(() => {
      setMetrics((prev) => ({
        ...prev,
        idleSeconds: prev.idleSeconds + 1,
      }));
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
