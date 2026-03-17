import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { useAIState } from "@/contexts/AIStateContext";
import VisualSoul from "./VisualSoul";
import { X, Sparkles } from "lucide-react";

type Props = {
  className?: string;
};

const STORAGE_KEY = "proactive-orb-position";

function loadPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        return parsed;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function savePosition(x: number, y: number) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ x, y }));
  } catch { /* ignore */ }
}

/**
 * Floating orb widget with proactive intervention bubble.
 * Fully draggable across the viewport with localStorage position persistence.
 */
export default function ProactiveOrbWidget({ className = "" }: Props) {
  const { aiState, personality, proactiveMessage, dismissProactive } = useAIState();
  const constraintsRef = useRef<HTMLDivElement>(null);

  // Load persisted position on mount
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    return loadPosition() || { x: 0, y: 0 };
  });

  // Track if user has ever dragged (to avoid overwriting default)
  const [hasDragged, setHasDragged] = useState(() => !!loadPosition());

  const personalityLabels = {
    calm: "沉穩模式",
    creative: "創意模式",
    technical: "技術模式",
  };

  // Updated to neon high-brightness colors
  const personalityBubbleColors = {
    calm: "border-cyan-400/40 bg-cyan-950/20 shadow-cyan-400/20",
    creative: "border-pink-400/40 bg-pink-950/20 shadow-pink-400/20",
    technical: "border-emerald-400/40 bg-emerald-950/20 shadow-emerald-400/20",
  };

  const personalityDotColors = {
    calm: "rgb(0,210,255)",       // 電藍光
    creative: "rgb(255,80,180)",  // 霓虹粉
    technical: "rgb(80,255,180)", // 螢光綠
  };

  const personalityGlowColors = {
    calm: "rgba(0,210,255,0.8)",
    creative: "rgba(255,80,180,0.8)",
    technical: "rgba(80,255,180,0.8)",
  };

  function handleDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    const newX = position.x + info.offset.x;
    const newY = position.y + info.offset.y;

    // Clamp to viewport bounds (with 60px margin for the orb size)
    const clampedX = Math.max(-(window.innerWidth - 80), Math.min(0, newX));
    const clampedY = Math.max(-(window.innerHeight - 80), Math.min(0, newY));

    setPosition({ x: clampedX, y: clampedY });
    savePosition(clampedX, clampedY);
    setHasDragged(true);
  }

  // Re-clamp on window resize
  useEffect(() => {
    function handleResize() {
      setPosition((prev) => ({
        x: Math.max(-(window.innerWidth - 80), Math.min(0, prev.x)),
        y: Math.max(-(window.innerHeight - 80), Math.min(0, prev.y)),
      }));
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div ref={constraintsRef} className={`fixed inset-0 pointer-events-none z-50 ${className}`}>
      {/* Draggable orb container — anchored bottom-right, offset by drag position */}
      <motion.div
        drag
        dragElastic={0.1}
        dragMomentum={false}
        dragConstraints={{
          left: -(window.innerWidth * 0.9),
          right: 0,
          top: -(window.innerHeight * 0.9),
          bottom: 0,
        }}
        onDragEnd={handleDragEnd}
        whileDrag={{
          scale: 1.15,
          boxShadow: `0 0 40px ${personalityGlowColors[personality]}`,
        }}
        initial={hasDragged ? position : { x: 0, y: 0 }}
        animate={position}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="absolute bottom-6 right-6 pointer-events-auto flex flex-col items-end gap-3"
        style={{ cursor: "grab", touchAction: "none" }}
      >
        {/* Proactive message bubble */}
        <AnimatePresence>
          {proactiveMessage && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className={`max-w-xs rounded-2xl border p-4 shadow-lg backdrop-blur-md ${personalityBubbleColors[personality]}`}
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
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissProactive();
                  }}
                  className="shrink-0 p-0.5 rounded-full hover:bg-foreground/10 transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Floating orb with neon glow */}
        <motion.div
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95, cursor: "grabbing" }}
          className="relative"
          title={`AI Director - ${personalityLabels[personality]} (可拖曳)`}
        >
          {/* Neon glow ring behind the orb */}
          <motion.div
            className="absolute inset-0 rounded-full"
            animate={{
              boxShadow: [
                `0 0 12px ${personalityGlowColors[personality]}, 0 0 24px ${personalityGlowColors[personality].replace("0.8", "0.3")}`,
                `0 0 20px ${personalityGlowColors[personality]}, 0 0 40px ${personalityGlowColors[personality].replace("0.8", "0.5")}`,
                `0 0 12px ${personalityGlowColors[personality]}, 0 0 24px ${personalityGlowColors[personality].replace("0.8", "0.3")}`,
              ],
            }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            style={{ margin: "-4px", borderRadius: "50%" }}
          />

          <VisualSoul
            state={aiState}
            personality={personality}
            size="md"
            className="!w-12 !h-12"
          />

          {/* Personality indicator dot — now neon colored */}
          <motion.div
            className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background"
            animate={{
              boxShadow: [
                `0 0 4px ${personalityDotColors[personality]}`,
                `0 0 8px ${personalityDotColors[personality]}`,
                `0 0 4px ${personalityDotColors[personality]}`,
              ],
            }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            style={{ backgroundColor: personalityDotColors[personality] }}
          />
        </motion.div>
      </motion.div>
    </div>
  );
}
