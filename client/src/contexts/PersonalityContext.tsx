/**
 * PersonalityContext.tsx — XState 人格引擎 (Phase 10)
 *
 * 三種 AI 人格狀態機：
 *   calm      — 沉穩（深藍）：緩慢呼吸，平靜引導
 *   creative  — 創意（暖橘）：快速脈動，主動建議
 *   technical — 技術（電紫）：精確閃爍，資料呈現
 *
 * 自動切換觸發器：
 *   - 用戶閒置 > 10 秒 → calm
 *   - 打字速度快（WPM > 60）→ creative
 *   - 選擇進階參數 → technical
 *   - AI 偏好設定覆蓋
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// ─── 人格定義 ──────────────────────────────────────────────────────────────

export type Personality = "calm" | "creative" | "technical";

export interface PersonalityConfig {
  name: string;
  color: string;          // Three.js 光球顏色
  glowColor: string;      // CSS glow 顏色
  breathSpeed: number;    // 呼吸週期（秒）
  pulseIntensity: number; // 脈動強度 0~1
  emissiveIntensity: number;
  description: string;
}

export const PERSONALITY_CONFIGS: Record<Personality, PersonalityConfig> = {
  calm: {
    name: "沉穩",
    color: "#1e40af",         // 深藍
    glowColor: "rgba(30, 64, 175, 0.4)",
    breathSpeed: 6,           // 慢呼吸
    pulseIntensity: 0.3,
    emissiveIntensity: 0.4,
    description: "平靜、引導式的陪伴",
  },
  creative: {
    name: "創意",
    color: "#ea580c",         // 暖橘
    glowColor: "rgba(234, 88, 12, 0.5)",
    breathSpeed: 3,           // 快速脈動
    pulseIntensity: 0.8,
    emissiveIntensity: 0.8,
    description: "充滿活力的創意夥伴",
  },
  technical: {
    name: "技術",
    color: "#7c3aed",         // 電紫
    glowColor: "rgba(124, 58, 237, 0.5)",
    breathSpeed: 1.5,         // 精確閃爍
    pulseIntensity: 0.6,
    emissiveIntensity: 0.9,
    description: "精準、資料驅動的分析",
  },
};

// ─── Context ───────────────────────────────────────────────────────────────

interface PersonalityContextValue {
  personality: Personality;
  config: PersonalityConfig;
  setPersonality: (p: Personality) => void;
  /** 通知打字事件，讓引擎自動判斷人格 */
  onTyping: () => void;
  /** 通知進階參數操作 */
  onAdvancedParams: () => void;
  /** 重置為自動模式 */
  resetToAuto: () => void;
}

const PersonalityContext = createContext<PersonalityContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────

export function PersonalityProvider({ children }: { children: React.ReactNode }) {
  const [personality, setPersonalityState] = useState<Personality>("calm");
  const [isManual, setIsManual] = useState(false);

  // 打字速度追蹤
  const typingTimestamps = useRef<number[]>([]);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setPersonality = useCallback((p: Personality) => {
    setPersonalityState(p);
    setIsManual(true);
  }, []);

  const resetToAuto = useCallback(() => {
    setIsManual(false);
    setPersonalityState("calm");
  }, []);

  const onTyping = useCallback(() => {
    if (isManual) return;

    const now = Date.now();
    typingTimestamps.current.push(now);

    // 只保留過去 5 秒的打字紀錄
    typingTimestamps.current = typingTimestamps.current.filter(
      (t) => now - t < 5000
    );

    // 計算 WPM（假設每 5 字為 1 word）
    const charCount = typingTimestamps.current.length;
    const wpm = (charCount / 5) * 12; // 5秒內的字數換算成分鐘

    if (wpm > 60) {
      setPersonalityState("creative");
    }

    // 清除閒置計時器，重新計時
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      if (!isManual) setPersonalityState("calm");
    }, 10_000);
  }, [isManual]);

  const onAdvancedParams = useCallback(() => {
    if (!isManual) setPersonalityState("technical");
  }, [isManual]);

  // 頁面可見性變化時重置
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && !isManual) {
        setPersonalityState("calm");
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      clearTimeout(idleTimer.current);
    };
  }, [isManual]);

  return (
    <PersonalityContext.Provider
      value={{
        personality,
        config: PERSONALITY_CONFIGS[personality],
        setPersonality,
        onTyping,
        onAdvancedParams,
        resetToAuto,
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
