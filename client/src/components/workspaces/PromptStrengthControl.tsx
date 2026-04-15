import {
  type PromptStrengthLevel,
  type Modality,
} from "@/stores/workspaceStore";
import { cn } from "@/lib/utils";
import { Gauge, Lock } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Level metadata ───────────────────────────────────────────────────────
type LevelMeta = {
  key: PromptStrengthLevel;
  label: string;
  indicator: string;
  activeBg: string;
  activeShadow: string;
  tooltip: string;
};

const LEVELS: LevelMeta[] = [
  {
    key: "low",
    label: "輕度",
    indicator: "bg-emerald-400",
    activeBg: "bg-emerald-500/15 text-emerald-700",
    activeShadow: "shadow-[0_0_10px_rgba(52,211,153,0.2)]",
    tooltip: "AI 擁有最大創作自由，僅保留核心意圖",
  },
  {
    key: "medium",
    label: "中度",
    indicator: "bg-blue-400",
    activeBg: "bg-blue-500/15 text-blue-700",
    activeShadow: "shadow-[0_0_10px_rgba(59,130,246,0.2)]",
    tooltip: "AI 遵守主要方向，細節可自由發揮",
  },
  {
    key: "high",
    label: "強烈",
    indicator: "bg-amber-400",
    activeBg: "bg-amber-500/15 text-amber-700",
    activeShadow: "shadow-[0_0_10px_rgba(245,158,11,0.2)]",
    tooltip: "AI 嚴格遵守所有提示詞細節",
  },
  {
    key: "locked",
    label: "鎖定",
    indicator: "bg-red-400",
    activeBg: "bg-red-500/15 text-red-700",
    activeShadow: "shadow-[0_0_10px_rgba(239,68,68,0.2)]",
    tooltip: "完全鎖定，AI 不可偏離任何指令",
  },
];

// ─── Per-modality descriptions ────────────────────────────────────────────
const MODALITY_DESCRIPTIONS: Record<
  Modality,
  Record<PromptStrengthLevel, string>
> = {
  image: {
    low: "自由發揮構圖與風格",
    medium: "遵守主體與風格",
    high: "嚴格遵守構圖、主體、風格、負面提示",
    locked: "完全鎖定所有指令",
  },
  video: {
    low: "自由發揮動作與鏡頭",
    medium: "遵守動作與鏡頭方向",
    high: "嚴格遵守動作、鏡頭、時長、連續性",
    locked: "完全鎖定所有指令",
  },
  music: {
    low: "自由發揮情緒與配器",
    medium: "遵守情緒與BPM",
    high: "嚴格遵守情緒、BPM、樂器配置",
    locked: "完全鎖定所有指令",
  },
  voice: {
    low: "自由發揮語氣",
    medium: "遵守語氣與語速",
    high: "嚴格遵守語氣、語速、情緒、發音",
    locked: "完全鎖定所有指令",
  },
};

// ─── Props ────────────────────────────────────────────────────────────────
type PromptStrengthControlProps = {
  value: PromptStrengthLevel;
  onChange: (level: PromptStrengthLevel) => void;
  modality: Modality;
};

// ─── Component ────────────────────────────────────────────────────────────
export function PromptStrengthControl({
  value,
  onChange,
  modality,
}: PromptStrengthControlProps) {
  const description = MODALITY_DESCRIPTIONS[modality][value];

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Gauge className="w-3.5 h-3.5" />
        <span>提示詞強度</span>
      </div>

      {/* Level buttons */}
      <div className="flex items-center gap-1.5">
        {LEVELS.map(level => {
          const isActive = value === level.key;
          return (
            <Tooltip key={level.key}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onChange(level.key)}
                  className={cn(
                    "rounded-lg text-[11px] font-medium px-3 py-1.5 transition-all",
                    "flex items-center gap-1.5",
                    isActive
                      ? cn(level.activeBg, level.activeShadow)
                      : "bg-white/40 text-muted-foreground hover:bg-white/60"
                  )}
                >
                  {level.key === "locked" ? (
                    <Lock className="w-3 h-3" />
                  ) : (
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        level.indicator
                      )}
                    />
                  )}
                  {level.label}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {level.tooltip}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Description */}
      <p className="text-[10px] text-muted-foreground">{description}</p>
    </div>
  );
}
