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

// ─── Page Context for site-wide AI agent awareness ─────────────────────────

export type PageContext = {
  pageId: string;            // e.g. "image-studio", "video-studio", "pro-studio"
  pageLabel: string;         // e.g. "圖片創作室"
  activeModel?: string;      // currently selected model name
  activeTab?: string;        // current sub-tab within the page
  generationCount?: number;  // number of generations this session
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
  // Page-aware context for site-wide AI agent
  pageContext: PageContext | null;
  setPageContext: (ctx: PageContext | null) => void;
  // Quiet mode — suppresses all proactive messages
  quietMode: boolean;
  setQuietMode: (q: boolean) => void;
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
  pageContext: null,
  setPageContext: () => {},
  quietMode: false,
  setQuietMode: () => {},
});

// ─── Proactive Intervention Rules ──────────────────────────────────────────

const PROACTIVE_RULES: Array<{
  condition: (m: DirectorEngineMetrics, personality: Personality, page?: PageContext | null) => boolean;
  message: (personality: Personality, page?: PageContext | null) => string;
  switchTo?: Personality;
}> = [
  {
    // User idle for 90+ seconds on studio pages → warm, healing-tone nudge (no pressure)
    condition: (m, _p, page) => m.idleSeconds >= 90 && m.idleSeconds < 180 && m.failCount === 0 && !!page,
    message: (_p, page) => {
      const hints: Record<string, string> = {
        "image-studio": "🌿 想到什麼畫面了嗎？不急，靈感會在放鬆的時候來。",
        "video-studio": "✨ 影片創作需要想像力——試著閉眼想像你要的畫面。",
        "pro-studio": "🎵 音樂是心靈的語言，隨時可以開始嘗試。",
        "lora-trainer": "🌸 訓練需要耐心，就像種一棵樹一樣。",
      };
      return hints[page?.pageId ?? ""] ?? "🌿 我在這裡陪你，需要的時候隨時點我。";
    },
  },
  {
    // User idle for 90+ seconds on non-studio pages → gentle presence reminder
    condition: (m, _p, page) => m.idleSeconds >= 90 && m.idleSeconds < 180 && m.failCount === 0 && !page,
    message: (p) => p === "calm"
      ? "🌿 慢慢來，享受這個安靜的時刻。"
      : p === "technical"
      ? "🔧 想到什麼了嗎？我隨時在這。"
      : "✨ 放鬆一下，靈感不會消失的。",
  },
  {
    // User typing very fast → gently affirm momentum (no personality switch to avoid disruption)
    condition: (m, _p) => m.typingSpeed > 6,
    message: () => "✨ 感覺你很有靈感呢！繼續加油。",
    // No personality switch — don't disrupt flow
  },
  {
    // 3+ consecutive failures → healing empathy + gentle help offer
    condition: (m) => m.failCount >= 3,
    message: (_p, page) => {
      const tips: Record<string, string> = {
        "image-studio": "🌸 沒關係的，生成有時候需要嘗試。要不要我幫你調整看看？",
        "video-studio": "🌸 影片生成比較費時，這很正常。我來幫你想想其他方法？",
        "pro-studio": "🌸 音訊處理有時候會挑剔，我來幫你排查一下？",
      };
      return tips[page?.pageId ?? ""] ?? "🌸 每次嘗試都是學習的機會。讓我幫你看看有沒有更順暢的方式？";
    },
    switchTo: "technical",
  },
  {
    // Idle 180+ seconds → acknowledge rest, no pressure to return
    condition: (m) => m.idleSeconds >= 180 && m.idleSeconds < 300,
    message: () => "🌿 休息是創作的一部分。你的光球會一直在這裡等你。",
  },
];

// ─── Provider ──────────────────────────────────────────────────────────────

export function AIStateProvider({ children }: { children: ReactNode }) {
  const [aiState, setAIState] = useState<AIState>("idle");
  // Read from localStorage on mount so personality survives page refreshes
  const [personality, setPersonalityState] = useState<Personality>(readPersistedPersonality);
  const [proactiveMessage, setProactiveMessage] = useState<string | null>(null);
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [quietMode, setQuietModeState] = useState<boolean>(() => {
    try { return localStorage.getItem("orb-quiet-mode") === "true"; } catch { return false; }
  });
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

  const setQuietMode = useCallback((q: boolean) => {
    setQuietModeState(q);
    try { localStorage.setItem("orb-quiet-mode", q ? "true" : "false"); } catch { /* ignore */ }
    if (q) setProactiveMessage(null); // Clear any active proactive when entering quiet mode
  }, []);

  // Idle timer: track idle time via ref, only update state at key thresholds
  // This avoids triggering a global re-render every second for all useAIState() consumers.
  const idleSecondsRef = useRef(0);

  useEffect(() => {
    // Thresholds at which proactive rules fire (from PROACTIVE_RULES conditions)
    const THRESHOLDS = [5, 90, 180, 300];
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
    // Only evaluate when not generating and not in quiet mode
    if (aiState === "generating" || quietMode) return;

    for (const rule of PROACTIVE_RULES) {
      const ruleKey = rule.message(personality, pageContext);
      if (rule.condition(metrics, personality, pageContext) && !proactiveShownRef.current.has(ruleKey)) {
        setProactiveMessage(rule.message(personality, pageContext));
        proactiveShownRef.current.add(ruleKey);
        if (rule.switchTo && rule.switchTo !== personality) {
          setPersonality(rule.switchTo);
        }
        break;
      }
    }
  }, [metrics.idleSeconds, metrics.failCount, metrics.typingSpeed, aiState, personality, pageContext, quietMode]);

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
        pageContext,
        setPageContext,
        quietMode,
        setQuietMode,
      }}
    >
      {children}
    </AIStateContext.Provider>
  );
}

export function useAIState() {
  return useContext(AIStateContext);
}
