/**
 * PersonalityContext.tsx — XState 人格引擎 (Phase 10)
 *
 * 三種 AI 人格狀態機（by XState 5）：
 *   calm      — 沉穩（深藍）：緩慢呼吸，平靜引導
 *   creative  — 創意（暖橘）：快速脈動，主動建議
 *   technical — 技術（電紫）：精確閃爍，資料呈現
 *
 * 自動切換觸發器：
 *   - 用戶閒置 > 10 秒         → calm
 *   - 打字速度快（WPM > 60）   → creative
 *   - 選擇進階參數             → technical
 *   - 生成失敗 >= 3 次         → calm（降壓模式）
 *   - 手動覆蓋                → manual mode（鎖定人格）
 *
 * 橋接設計：
 *   PersonalityContext 位於 AIStateContext 內部，因此可以讀取 useAIState()
 *   - 從 AIStateContext 讀取 aiState (visual state)
 *   - 將 XState 計算出的 personality 同步回 AIStateContext.setPersonality
 *   - 這樣所有 useAIState() 的消費者也能獲得最新人格
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useMachine } from "@xstate/react";
import { personalityMachine } from "@/lib/personalityMachine";
import { useAIState } from "@/contexts/AIStateContext";

// ─── 人格定義 ──────────────────────────────────────────────────────────────

export type Personality = "calm" | "creative" | "technical";
export type AIState = "idle" | "thinking" | "generating";

export interface PersonalityConfig {
  name: string;
  color: string;          // 3D 光球顏色
  glowColor: string;      // CSS glow 顏色
  breathSpeed: number;    // 呼吸週期（秒）
  pulseIntensity: number; // 脈動強度 0~1
  emissiveIntensity: number;
  description: string;
}

export const PERSONALITY_CONFIGS: Record<Personality, PersonalityConfig> = {
  calm: {
    name: "沉穩",
    color: "#1e40af",
    glowColor: "rgba(30, 64, 175, 0.4)",
    breathSpeed: 6,
    pulseIntensity: 0.3,
    emissiveIntensity: 1.3,
    description: "平靜、引導式的陪伴",
  },
  creative: {
    name: "創意",
    color: "#ea580c",
    glowColor: "rgba(234, 88, 12, 0.5)",
    breathSpeed: 3,
    pulseIntensity: 0.8,
    emissiveIntensity: 1.6,
    description: "充滿活力的創意夥伴",
  },
  technical: {
    name: "技術",
    color: "#7c3aed",
    glowColor: "rgba(124, 58, 237, 0.5)",
    breathSpeed: 1.5,
    pulseIntensity: 0.6,
    emissiveIntensity: 1.5,
    description: "精準、資料驅動的分析",
  },
};

// ─── Context Interface ────────────────────────────────────────────────────

interface PersonalityContextValue {
  /** 目前人格（來自 XState 機器） */
  personality: Personality;
  /** 人格設定 */
  config: PersonalityConfig;
  /** 是否為手動覆蓋模式 */
  isManual: boolean;
  /** AI 視覺狀態（橋接自 AIStateContext） */
  aiState: AIState;
  /** 手動設定人格（鎖定） */
  setPersonality: (p: Personality) => void;
  /** 重置為自動模式 */
  resetToAuto: () => void;
  /** 通知打字事件，讓引擎自動判斷 */
  onTyping: () => void;
  /** 通知進階參數操作 */
  onAdvancedParams: () => void;
  /** 通知生成開始 */
  onGenerationStart: () => void;
  /** 通知生成完成 */
  onGenerationDone: () => void;
  /** 通知生成失敗 */
  onGenerationFail: () => void;
  /** 通知 AI 開始思考 */
  onThinkingStart: () => void;
  /** 通知 AI 思考完成 */
  onThinkingDone: () => void;
}

const PersonalityContext = createContext<PersonalityContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────

export function PersonalityProvider({ children }: { children: React.ReactNode }) {
  // XState 狀態機（人格自動切換引擎）
  const [machineState, send] = useMachine(personalityMachine);

  // 橋接：從 AIStateContext 讀取 aiState 和 setPersonality
  // PersonalityProvider 位於 App.tsx 內，AIStateProvider 在 main.tsx 外層
  const aiCtx = useAIState();
  const { aiState, setPersonality: syncPersonalityToAICtx } = aiCtx;

  // 打字速度追蹤
  const typingTimestamps = useRef<number[]>([]);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 從狀態機讀取人格
  const personality = machineState.context.personality;
  const isManual = machineState.context.isManual;

  // ── 同步 XState personality → AIStateContext.personality ───────────────
  // 讓 useAIState() 的消費者也能感知人格變化
  useEffect(() => {
    syncPersonalityToAICtx(personality);
  }, [personality, syncPersonalityToAICtx]);

  // ── 同步 AIStateContext.aiState → XState 機器事件 ──────────────────────
  // 當 AIStateContext 切換到 generating/thinking 時，通知 XState 機器
  const prevAiState = useRef<AIState>(aiState);
  useEffect(() => {
    const prev = prevAiState.current;
    prevAiState.current = aiState;

    if (prev !== "generating" && aiState === "generating") {
      send({ type: "GENERATION_START" });
    } else if (prev === "generating" && aiState === "idle") {
      send({ type: "GENERATION_DONE" });
    } else if (prev !== "thinking" && aiState === "thinking") {
      send({ type: "THINKING_START" });
    } else if (prev === "thinking" && aiState === "idle") {
      send({ type: "THINKING_DONE" });
    }
  }, [aiState, send]);

  // ── 手動設定人格 ────────────────────────────────────────────────────────
  const setPersonality = useCallback((p: Personality) => {
    send({ type: "MANUAL_SET", personality: p });
  }, [send]);

  // ── 重置為自動 ──────────────────────────────────────────────────────────
  const resetToAuto = useCallback(() => {
    send({ type: "MANUAL_RESET" });
  }, [send]);

  // ── 打字事件 ────────────────────────────────────────────────────────────
  const onTyping = useCallback(() => {
    const now = Date.now();
    typingTimestamps.current.push(now);

    // 只保留過去 5 秒的打字記錄
    typingTimestamps.current = typingTimestamps.current.filter(
      (t) => now - t < 5000
    );

    // WPM 估算：5 秒內字數 × 12 換算成每分鐘
    const wpm = (typingTimestamps.current.length / 5) * 12;
    send({ type: "TYPING", wpm });

    // 重設閒置計時器
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      send({ type: "IDLE" });
    }, 10_000);
  }, [send]);

  // ── 進階參數 ────────────────────────────────────────────────────────────
  const onAdvancedParams = useCallback(() => {
    send({ type: "ADVANCED_PARAMS" });
  }, [send]);

  // ── 生成事件（本地觸發，也同步到 AIStateContext） ──────────────────────
  const onGenerationStart = useCallback(() => {
    send({ type: "GENERATION_START" });
  }, [send]);

  const onGenerationDone = useCallback(() => {
    send({ type: "GENERATION_DONE" });
  }, [send]);

  const onGenerationFail = useCallback(() => {
    send({ type: "GENERATION_FAIL" });
  }, [send]);

  // ── 思考事件 ────────────────────────────────────────────────────────────
  const onThinkingStart = useCallback(() => {
    send({ type: "THINKING_START" });
  }, [send]);

  const onThinkingDone = useCallback(() => {
    send({ type: "THINKING_DONE" });
  }, [send]);

  // ── 頁面可見性：隱藏時回到 calm ─────────────────────────────────────────
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        send({ type: "IDLE" });
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      clearTimeout(idleTimer.current);
    };
  }, [send]);

  return (
    <PersonalityContext.Provider
      value={{
        personality,
        config: PERSONALITY_CONFIGS[personality],
        isManual,
        aiState,
        setPersonality,
        resetToAuto,
        onTyping,
        onAdvancedParams,
        onGenerationStart,
        onGenerationDone,
        onGenerationFail,
        onThinkingStart,
        onThinkingDone,
      }}
    >
      {children}
    </PersonalityContext.Provider>
  );
}

export function usePersonality(): PersonalityContextValue {
  const ctx = useContext(PersonalityContext);
  if (!ctx) throw new Error("usePersonality must be used within PersonalityProvider");
  return ctx;
}
