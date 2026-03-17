import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { AIState } from "@/components/VisualSoul";

type AIStateContextType = {
  aiState: AIState;
  setAIState: (state: AIState) => void;
  /** Convenience: set to "thinking" and auto-revert to "idle" after ms */
  flashThinking: (ms?: number) => void;
  /** Convenience: set to "generating" and auto-revert to "idle" after ms */
  flashGenerating: (ms?: number) => void;
};

const AIStateContext = createContext<AIStateContextType>({
  aiState: "idle",
  setAIState: () => {},
  flashThinking: () => {},
  flashGenerating: () => {},
});

export function AIStateProvider({ children }: { children: ReactNode }) {
  const [aiState, setAIState] = useState<AIState>("idle");

  const flashThinking = useCallback((ms = 3000) => {
    setAIState("thinking");
    setTimeout(() => setAIState("idle"), ms);
  }, []);

  const flashGenerating = useCallback((ms = 5000) => {
    setAIState("generating");
    setTimeout(() => setAIState("idle"), ms);
  }, []);

  return (
    <AIStateContext.Provider value={{ aiState, setAIState, flashThinking, flashGenerating }}>
      {children}
    </AIStateContext.Provider>
  );
}

export function useAIState() {
  return useContext(AIStateContext);
}
