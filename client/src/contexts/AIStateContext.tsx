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
    // User idle for 60+ seconds → page-aware gentle nudge (was 20s, now 60s to be less intrusive)
    condition: (m, _p, page) => m.idleSeconds >= 60 && m.idleSeconds < 120 && m.failCount === 0 && !!page,
    message: (_p, page) => {
      const hints: Record<string, string> = {
        "image-studio": "需要靈感嗎？點我可以幫你推薦風格或優化提詞。",
        "video-studio": "影片提詞小技巧：描述「動態」和「鏡頭運動」可以大幅提升效果。",
        "pro-studio": "想要快速開始？可以先試試模板。",
        "lora-trainer": "訓練圖片的品質比數量重要——清晰、光線好的圖片效果最佳。",
      };
      return hints[page?.pageId ?? ""] ?? "有什麼需要幫忙的嗎？點我開始對話。";
    },
  },
  {
    // User idle for 60+ seconds on non-studio pages → gentle nudge (was 20s)
    condition: (m, _p, page) => m.idleSeconds >= 60 && m.idleSeconds < 120 && m.failCount === 0 && !page,
    message: (p) => p === "calm"
      ? "慢慢來，不急。需要的時候隨時點我。"
      : p === "technical"
      ? "需要技術建議嗎？我隨時在。"
      : "需要靈感的話，隨時點我聊聊。",
  },
  {
    // User typing very fast → affirm and switch to creative mode
    condition: (m, p) => m.typingSpeed > 5 && p !== "creative",
    message: () => "靈感湧現了！切換到創意模式。",
    switchTo: "creative",
  },
  {
    // 3+ consecutive failures → empathetic switch to technical (was 2, now 3 for less interruption)
    condition: (m) => m.failCount >= 3,
    message: (_p, page) => {
      const tips: Record<string, string> = {
        "image-studio": "連續幾次沒成功——試試降低解析度或換一個模型？",
        "video-studio": "影片生成較複雜，試試縮短時長或降低畫質再重試。",
        "pro-studio": "確認音頻 URL 是否正確，或換一個備選模型。",
      };
      return tips[page?.pageId ?? ""] ?? "遇到困難了嗎？我切換到技術模式，幫你排查問題。";
    },
    switchTo: "technical",
  },
  {
    // Idle 120+ seconds → single warm nudge (was 45s)
    condition: (m) => m.idleSeconds >= 120 && m.idleSeconds < 180,
    message: () => "休息也是創作的一部分。準備好了隨時點我。",
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
    const THRESHOLDS = [5, 60, 120, 180];
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
