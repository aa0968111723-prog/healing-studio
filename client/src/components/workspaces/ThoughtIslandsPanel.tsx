import { useState } from "react";
import { type ThoughtIsland } from "@/stores/workspaceStore";
import { Textarea } from "@/components/ui/textarea";
import {
  Lightbulb,
  Target,
  Palette,
  ShieldAlert,
  FileOutput,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

// ─── Category metadata ────────────────────────────────────────────────────

type CategoryMeta = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  emoji: string;
};

const CATEGORY_META: Record<ThoughtIsland["category"], CategoryMeta> = {
  goal: { icon: Target, label: "目標", emoji: "🎯" },
  subject: { icon: Lightbulb, label: "主題", emoji: "💡" },
  style: { icon: Palette, label: "風格", emoji: "🎨" },
  constraints: { icon: ShieldAlert, label: "限制", emoji: "🛡️" },
  output: { icon: FileOutput, label: "輸出", emoji: "📤" },
};

const CATEGORY_ORDER: ThoughtIsland["category"][] = [
  "goal",
  "subject",
  "style",
  "constraints",
  "output",
];

// ─── Props ────────────────────────────────────────────────────────────────

type ThoughtIslandsPanelProps = {
  islands: ThoughtIsland[];
  onChange: (islands: ThoughtIsland[]) => void;
  modality: string;
};

// ─── Component ────────────────────────────────────────────────────────────

export function ThoughtIslandsPanel({
  islands,
  onChange,
  modality,
}: ThoughtIslandsPanelProps) {
  const [open, setOpen] = useState(false);

  const sortedIslands = CATEGORY_ORDER.reduce<ThoughtIsland[]>((acc, cat) => {
    const island = islands.find((i) => i.category === cat);
    if (island) acc.push(island);
    return acc;
  }, []);

  function handleContentChange(id: string, content: string) {
    onChange(islands.map((i) => (i.id === id ? { ...i, content } : i)));
  }

  return (
    <div className="space-y-2">
      {/* Toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between rounded-lg px-3 py-2",
          "bg-white/30 backdrop-blur-sm border border-white/50",
          "text-xs font-medium text-muted-foreground",
          "hover:bg-white/40 transition-colors",
        )}
      >
        <span>思維島鏈 — {modality}</span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Collapsible body */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="thought-islands"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="space-y-2 pt-1">
              {sortedIslands.map((island) => {
                const meta = CATEGORY_META[island.category];
                const Icon = meta.icon;

                return (
                  <div
                    key={island.id}
                    className={cn(
                      "bg-white/30 backdrop-blur-sm border border-white/50 rounded-xl",
                      "p-3 space-y-1.5",
                    )}
                  >
                    {/* Header */}
                    <div className="flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium">
                        {meta.emoji} {meta.label}
                      </span>
                    </div>

                    {/* Textarea */}
                    <Textarea
                      placeholder={island.hint}
                      value={island.content}
                      onChange={(e) =>
                        handleContentChange(island.id, e.target.value)
                      }
                      rows={2}
                      className={cn(
                        "resize-none text-xs",
                        "placeholder:text-[10px] placeholder:text-muted-foreground/60",
                      )}
                    />
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
