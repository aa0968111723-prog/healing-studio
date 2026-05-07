/**
 * OrbStateContext.tsx — 全站光球狀態廣播。
 *
 * 把光球目前在做什麼（思考 / 搜尋 / 執行工作流 / 完成 / 失敗）廣播給所有想
 * 反應的 UI 元件。最常見的消費者是 ProactiveOrbWidget（光球本體會依狀態
 * 改變顏色／呼吸／粒子），但 OrbGuidePanel、AgentChat header 也都可以
 * 訂閱，達到「全站視覺一致性」。
 *
 * 設計原則：
 *   - 永不 throw、永不 block — 寫狀態只是視覺提示，失敗無關功能
 *   - 自動 timeout — `success` / `error` 狀態 4 秒後自動回到 idle
 *   - 不做 DOM 操作，純 React state；任何 framer-motion 動畫由消費者決定
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type OrbState =
  | "idle"
  | "thinking"
  | "searching"
  | "executing"
  | "listening"
  | "success"
  | "error";

export interface OrbStateValue {
  state: OrbState;
  /** 最近一次狀態變更的時間（ms）。配 framer-motion 的 key 讓動畫重播。 */
  changedAt: number;
  /** 可選：給狀態一句說明（hover tooltip / aria-label 用） */
  message?: string;
  /** 切換到給定狀態。`success` / `error` 4 秒後自動回 idle。 */
  setState: (next: OrbState, message?: string) => void;
  /** 把狀態強制重設為 idle，並清掉 message。 */
  reset: () => void;
}

const FALLBACK: OrbStateValue = {
  state: "idle",
  changedAt: 0,
  setState: () => {},
  reset: () => {},
};

const OrbStateContext = createContext<OrbStateValue>(FALLBACK);

const TRANSIENT_STATES: OrbState[] = ["success", "error"];
const TRANSIENT_TIMEOUT_MS = 4000;

export function OrbStateProvider({ children }: { children: ReactNode }) {
  const [state, setStateInternal] = useState<OrbState>("idle");
  const [changedAt, setChangedAt] = useState<number>(0);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setState = useCallback((next: OrbState, msg?: string) => {
    setStateInternal(next);
    setChangedAt(Date.now());
    setMessage(msg);
  }, []);

  const reset = useCallback(() => {
    setStateInternal("idle");
    setChangedAt(Date.now());
    setMessage(undefined);
  }, []);

  // Auto-clear transient states. Cancellable via the ref so rapid-fire
  // updates don't fight each other.
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (TRANSIENT_STATES.includes(state)) {
      timerRef.current = setTimeout(() => {
        setStateInternal("idle");
        setChangedAt(Date.now());
        setMessage(undefined);
      }, TRANSIENT_TIMEOUT_MS);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [state]);

  const value = useMemo<OrbStateValue>(
    () => ({ state, changedAt, message, setState, reset }),
    [state, changedAt, message, setState, reset]
  );

  return <OrbStateContext.Provider value={value}>{children}</OrbStateContext.Provider>;
}

export function useOrbState(): OrbStateValue {
  return useContext(OrbStateContext);
}

// ─── 視覺對應表 — 共享給任何想要染色的 orb 元件用 ────────────────────

export interface OrbStateVisual {
  /** TailwindCSS 顏色 token，可餵進 className */
  ringClass: string;
  /** 主色 hex，用於 framer-motion 動畫顏色內插 */
  hex: string;
  /** 透明度層級 0..1，給粒子用 */
  particleStrength: number;
  /** 描述（aria + tooltip） */
  description: string;
}

export const ORB_STATE_VISUAL: Record<OrbState, OrbStateVisual> = {
  idle: {
    ringClass: "ring-cyan-300/40",
    hex: "#67e8f9",
    particleStrength: 0.25,
    description: "光球待命中",
  },
  thinking: {
    ringClass: "ring-indigo-400/60",
    hex: "#818cf8",
    particleStrength: 0.55,
    description: "光球正在想",
  },
  searching: {
    ringClass: "ring-amber-400/60",
    hex: "#fbbf24",
    particleStrength: 0.7,
    description: "光球正在翻找全站資料",
  },
  executing: {
    ringClass: "ring-emerald-400/70",
    hex: "#34d399",
    particleStrength: 0.85,
    description: "光球正在執行工作流程",
  },
  listening: {
    ringClass: "ring-rose-300/60",
    hex: "#fda4af",
    particleStrength: 0.4,
    description: "光球正在聽你說",
  },
  success: {
    ringClass: "ring-lime-400/80",
    hex: "#a3e635",
    particleStrength: 0.95,
    description: "完成",
  },
  error: {
    ringClass: "ring-red-400/80",
    hex: "#f87171",
    particleStrength: 1,
    description: "出錯了",
  },
};
