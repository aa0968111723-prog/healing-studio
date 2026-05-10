import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dice5 } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Inspiration Presets (shared with ProactiveOrbWidget) ───────────────────

export interface InspirationBlocks {
  subject?: string;
  style?: string;
  lighting?: string;
  color?: string;
  mood?: string;
}

export interface InspirationPreset {
  label: string;
  emoji: string;
  mood: string;
  blocks: InspirationBlocks;
}

export const INSPIRATION_PRESETS: InspirationPreset[] = [
  {
    label: "寧靜森林",
    emoji: "🌿",
    mood: "平靜",
    blocks: {
      subject: "森林",
      style: "水彩畫",
      lighting: "柔光",
      color: "冷色調",
      mood: "寧靜",
    },
  },
  {
    label: "星空冒險",
    emoji: "✨",
    mood: "期待",
    blocks: {
      subject: "星空",
      style: "賽博龐克",
      lighting: "霓虹燈",
      color: "高飽和",
      mood: "神秘",
    },
  },
  {
    label: "溫暖日落",
    emoji: "🌅",
    mood: "溫暖",
    blocks: {
      subject: "海邊",
      style: "油畫",
      lighting: "黃金時刻",
      color: "暖色調",
      mood: "懷舊",
    },
  },
  {
    label: "夢幻花園",
    emoji: "🌸",
    mood: "浪漫",
    blocks: {
      subject: "花朵",
      style: "浮世繪",
      lighting: "柔光",
      color: "低飽和",
      mood: "夢幻",
    },
  },
  {
    label: "雨天咖啡",
    emoji: "☕",
    mood: "放鬆",
    blocks: {
      subject: "咖啡廳",
      style: "水彩畫",
      lighting: "燭光",
      color: "暖色調",
      mood: "慵懶",
    },
  },
  {
    label: "科幻都市",
    emoji: "🏙️",
    mood: "興奮",
    blocks: {
      subject: "城市",
      style: "賽博龐克",
      lighting: "霓虹燈",
      color: "高飽和",
      mood: "未來感",
    },
  },
  {
    label: "水墨仙境",
    emoji: "🏔️",
    mood: "超然",
    blocks: {
      subject: "山水",
      style: "水墨畫",
      lighting: "薄霧",
      color: "單色",
      mood: "超然",
    },
  },
  {
    label: "童話城堡",
    emoji: "🏰",
    mood: "奇幻",
    blocks: {
      subject: "城堡",
      style: "插畫風",
      lighting: "極光",
      color: "高飽和",
      mood: "奇幻",
    },
  },
];

// ─── Component ──────────────────────────────────────────────────────────────

interface InspirationQuickPanelProps {
  onApply: (blocks: InspirationBlocks) => void;
  className?: string;
}

export function InspirationQuickPanel({
  onApply,
  className,
}: InspirationQuickPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const handleRandom = useCallback(() => {
    const pick =
      INSPIRATION_PRESETS[
        Math.floor(Math.random() * INSPIRATION_PRESETS.length)
      ];
    setActiveId(pick.label);
    onApply(pick.blocks);
    setTimeout(() => setActiveId(null), 800);
  }, [onApply]);

  const handleApply = useCallback(
    (preset: InspirationPreset) => {
      setActiveId(preset.label);
      onApply(preset.blocks);
      setTimeout(() => setActiveId(null), 800);
    },
    [onApply]
  );

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground/80">
          ✨ 靈感快選
        </p>
        <button
          onClick={handleRandom}
          className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary font-medium transition-colors px-2 py-1 rounded-lg hover:bg-primary/5"
        >
          <Dice5 className="w-3 h-3" />
          隨機靈感
        </button>
      </div>

      {/* Horizontal scrollable cards */}
      <div
        ref={scrollRef}
        className="flex gap-2.5 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory scrollbar-none"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {INSPIRATION_PRESETS.map(preset => {
          const isActive = activeId === preset.label;
          return (
            <motion.button
              key={preset.label}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleApply(preset)}
              className={cn(
                "inspiration-preset-tile relative flex-shrink-0 snap-start flex flex-col items-center gap-1.5 w-20 p-3 rounded-2xl transition-all",
                "hover:shadow-md active:scale-95",
                isActive
                  ? "ring-2 ring-primary/40 shadow-md"
                  : "hover:ring-1 hover:ring-border/40"
              )}
              data-state={isActive ? "active" : "idle"}
            >
              {/* Breathing pulse for active */}
              <AnimatePresence>
                {isActive && (
                  <motion.div
                    className="absolute inset-0 rounded-2xl"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 0.3, 0] }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.8 }}
                    style={{
                      background:
                        "radial-gradient(circle, rgba(212,197,226,0.4), transparent)",
                    }}
                  />
                )}
              </AnimatePresence>

              <span className="text-2xl leading-none relative z-10">
                {preset.emoji}
              </span>
              <span className="text-[10px] font-medium text-foreground leading-tight relative z-10 whitespace-nowrap">
                {preset.label}
              </span>
              <span className="text-[9px] text-muted-foreground/60 relative z-10">
                {preset.mood}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
