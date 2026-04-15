import { useState, useCallback } from "react";
import type { Modality } from "@/stores/workspaceStore";
import { cn } from "@/lib/utils";
import { Zap } from "lucide-react";
import { motion } from "framer-motion";

interface BlockUpdate {
  fieldKey: string;
  instruction: string;
}

interface RefineAction {
  emoji: string;
  label: string;
  updates: BlockUpdate[];
}

interface RefineQuickActionsProps {
  modality: Modality;
  onApplyRefine: (blockUpdates: BlockUpdate[]) => void;
}

const IMAGE_ACTIONS: RefineAction[] = [
  {
    emoji: "🏞️",
    label: "保留角色，換背景",
    updates: [{ fieldKey: "scene", instruction: "keep character, change background" }],
  },
  {
    emoji: "🎨",
    label: "保留構圖，換風格",
    updates: [{ fieldKey: "style", instruction: "keep composition, change style" }],
  },
  {
    emoji: "💡",
    label: "保留角色，換光線",
    updates: [{ fieldKey: "lighting", instruction: "keep character, change lighting" }],
  },
  {
    emoji: "🔍",
    label: "提升細節",
    updates: [{ fieldKey: "style", instruction: "enhance details, 8K resolution" }],
  },
  {
    emoji: "⬆️",
    label: "放大 / 超解析",
    updates: [{ fieldKey: "style", instruction: "upscale, super resolution" }],
  },
];

const VIDEO_ACTIONS: RefineAction[] = [
  {
    emoji: "🎥",
    label: "保留場景，換鏡頭運動",
    updates: [{ fieldKey: "cameraMovement", instruction: "keep scene, change camera movement" }],
  },
  {
    emoji: "🏃",
    label: "保留主體，換動作節奏",
    updates: [{ fieldKey: "motionPacing", instruction: "keep subject, change motion pacing" }],
  },
  {
    emoji: "📷",
    label: "降低晃動",
    updates: [{ fieldKey: "cameraMovement", instruction: "steady, stabilized" }],
  },
  {
    emoji: "🔒",
    label: "固定鏡頭",
    updates: [{ fieldKey: "cameraMovement", instruction: "static camera, fixed shot" }],
  },
  {
    emoji: "🔗",
    label: "增加連續性",
    updates: [{ fieldKey: "continuity", instruction: "improve continuity between shots" }],
  },
];

const MUSIC_ACTIONS: RefineAction[] = [
  {
    emoji: "🎸",
    label: "保留節奏，換樂器",
    updates: [{ fieldKey: "instrumentation", instruction: "keep rhythm, change instruments" }],
  },
  {
    emoji: "🎵",
    label: "保留情緒，換曲風",
    updates: [{ fieldKey: "genre", instruction: "keep mood, change genre" }],
  },
  {
    emoji: "🔉",
    label: "降低能量",
    updates: [{ fieldKey: "energyCurve", instruction: "low energy, gentle" }],
  },
  {
    emoji: "🎤",
    label: "移除人聲",
    updates: [{ fieldKey: "vocalInstrumental", instruction: "instrumental only" }],
  },
  {
    emoji: "⏩",
    label: "縮短前奏",
    updates: [{ fieldKey: "structure", instruction: "short intro" }],
  },
];

const VOICE_ACTIONS: RefineAction[] = [
  {
    emoji: "🎭",
    label: "保留聲線，換情緒",
    updates: [{ fieldKey: "tone", instruction: "keep voice character, change emotion" }],
  },
  {
    emoji: "🐢",
    label: "放慢語速",
    updates: [{ fieldKey: "pace", instruction: "slow pace" }],
  },
  {
    emoji: "☀️",
    label: "更溫暖",
    updates: [{ fieldKey: "tone", instruction: "warmer, softer" }],
  },
  {
    emoji: "🔤",
    label: "更清晰",
    updates: [{ fieldKey: "deliveryStyle", instruction: "clearer enunciation" }],
  },
  {
    emoji: "🎬",
    label: "降低戲劇感",
    updates: [{ fieldKey: "tone", instruction: "less dramatic, more natural" }],
  },
];

const ACTIONS_BY_MODALITY: Record<Modality, RefineAction[]> = {
  image: IMAGE_ACTIONS,
  video: VIDEO_ACTIONS,
  music: MUSIC_ACTIONS,
  voice: VOICE_ACTIONS,
};

export function RefineQuickActions({ modality, onApplyRefine }: RefineQuickActionsProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const actions = ACTIONS_BY_MODALITY[modality];

  const handleClick = useCallback(
    (action: RefineAction, index: number) => {
      setActiveIndex(index);
      onApplyRefine(action.updates);
      // Reset active state after animation
      setTimeout(() => setActiveIndex(null), 300);
    },
    [onApplyRefine],
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground font-medium px-1">
        <Zap className="w-3 h-3" />
        <span>⚡ 快速精修</span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {actions.map((action, index) => (
          <motion.button
            key={action.label}
            type="button"
            className={cn(
              "px-3 py-1.5 rounded-full text-[11px] font-medium",
              "bg-white/40 border border-white/60",
              "hover:bg-primary/10 hover:border-primary/30",
              "transition-all whitespace-nowrap shrink-0",
              "cursor-pointer select-none",
            )}
            animate={activeIndex === index ? { scale: [1, 0.92, 1.05, 1] } : { scale: 1 }}
            transition={{ duration: 0.3 }}
            onClick={() => handleClick(action, index)}
          >
            <span className="mr-1">{action.emoji}</span>
            {action.label}
          </motion.button>
        ))}
      </div>
    </div>
  );
}
