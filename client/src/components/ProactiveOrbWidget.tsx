import { motion, AnimatePresence } from "framer-motion";
import { useAIState } from "@/contexts/AIStateContext";
import VisualSoul from "./VisualSoul";
import { X, Sparkles, RotateCcw } from "lucide-react";

type Props = {
  className?: string;
};

/**
 * Floating orb widget with proactive intervention bubble.
 * Shows in the bottom-right of Studio when the DirectorEngine
 * detects user needs guidance (idle, failing, etc.)
 */
export default function ProactiveOrbWidget({ className = "" }: Props) {
  const { aiState, personality, proactiveMessage, dismissProactive } = useAIState();

  const personalityLabels = {
    calm: "沉穩模式",
    creative: "創意模式",
    technical: "技術模式",
  };

  const personalityColors = {
    calm: "border-blue-900/30 bg-blue-950/10",
    creative: "border-orange-400/30 bg-orange-50/10",
    technical: "border-purple-600/30 bg-purple-50/10",
  };

  return (
    <div className={`fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3 ${className}`}>
      {/* Proactive message bubble */}
      <AnimatePresence>
        {proactiveMessage && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className={`max-w-xs rounded-2xl border p-4 shadow-lg backdrop-blur-md ${personalityColors[personality]}`}
          >
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
              <div className="flex-1">
                <p className="text-xs font-medium text-foreground/90 mb-1">
                  {personalityLabels[personality]}
                </p>
                <p className="text-xs text-foreground/70 leading-relaxed">
                  {proactiveMessage}
                </p>
              </div>
              <button
                onClick={dismissProactive}
                className="shrink-0 p-0.5 rounded-full hover:bg-foreground/10 transition-colors"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating orb */}
      <motion.div
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        className="relative cursor-pointer"
        title={`AI Director - ${personalityLabels[personality]}`}
      >
        <VisualSoul
          state={aiState}
          personality={personality}
          size="md"
          className="!w-12 !h-12"
        />
        {/* Personality indicator dot */}
        <div
          className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background"
          style={{
            backgroundColor:
              personality === "calm" ? "#0D1B2A" :
              personality === "creative" ? "#FF6F61" :
              "#7B2CBF",
          }}
        />
      </motion.div>
    </div>
  );
}
