import { motion } from "framer-motion";
import { Leaf, Sparkles, Focus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CreativeMode } from "@/stores/workspaceStore";

const CREATIVE_MODE_KEY = "hs-creative-mode";

export function loadCreativeMode(): CreativeMode {
  try {
    const stored = localStorage.getItem(CREATIVE_MODE_KEY);
    if (stored === "simple" || stored === "standard" || stored === "pro")
      return stored;
  } catch {
    /* ignore */
  }
  return "simple";
}

export function saveCreativeMode(mode: CreativeMode) {
  try {
    localStorage.setItem(CREATIVE_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

interface CreativeModeSelectorProps {
  value: CreativeMode;
  onChange: (mode: CreativeMode) => void;
}

const modes: {
  mode: CreativeMode;
  label: string;
  labelZh: string;
  Icon: typeof Leaf;
  description: string;
}[] = [
  {
    mode: "simple",
    label: "Simple",
    labelZh: "靈感",
    Icon: Leaf,
    description: "極簡直覺，放鬆探索",
  },
  {
    mode: "standard",
    label: "Standard",
    labelZh: "標準",
    Icon: Sparkles,
    description: "模態工作區與積木",
  },
  {
    mode: "pro",
    label: "Pro",
    labelZh: "專業",
    Icon: Focus,
    description: "完整控制與進階編輯",
  },
];

export function CreativeModeSelector({
  value,
  onChange,
}: CreativeModeSelectorProps) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-xl p-0.5"
      style={{
        background: "rgba(255,255,255,0.35)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(255,255,255,0.4)",
      }}
    >
      {modes.map(({ mode, labelZh, Icon }) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            onClick={() => {
              onChange(mode);
              saveCreativeMode(mode);
            }}
            className={cn(
              "relative flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all",
              active
                ? "text-foreground"
                : "text-muted-foreground/70 hover:text-foreground/80"
            )}
          >
            {active && (
              <motion.div
                layoutId="creative-mode-pill"
                className="absolute inset-0 rounded-lg bg-white shadow-sm"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1">
              <Icon className="w-3 h-3" />
              {labelZh}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Descriptive subtitle for the current creative mode */
export function CreativeModeDescription({ mode }: { mode: CreativeMode }) {
  const m = modes.find(m => m.mode === mode);
  if (!m) return null;
  return (
    <p className="text-[10px] text-muted-foreground/60 text-center mt-1">
      {m.description}
    </p>
  );
}
