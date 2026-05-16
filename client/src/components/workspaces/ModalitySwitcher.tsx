import { type Modality } from "@/stores/workspaceStore";
import { cn } from "@/lib/utils";
import { Image, Video, Music, Mic } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ─── Tab metadata ─────────────────────────────────────────────────────────
type TabMeta = {
  key: Modality;
  label: string;
  icon: LucideIcon;
};

const TABS: TabMeta[] = [
  { key: "image", label: "圖片", icon: Image },
  { key: "video", label: "影片", icon: Video },
  { key: "music", label: "音樂", icon: Music },
  { key: "voice", label: "語音", icon: Mic },
];

// ─── Props ────────────────────────────────────────────────────────────────
type ModalitySwitcherProps = {
  value: Modality;
  onChange: (m: Modality) => void;
};

// ─── Component ────────────────────────────────────────────────────────────
export function ModalitySwitcher({ value, onChange }: ModalitySwitcherProps) {
  return (
    <div className="grid grid-cols-4 h-auto rounded-xl p-1 bg-card/40 border border-white/50 backdrop-blur-sm">
      {TABS.map(tab => {
        const isActive = value === tab.key;
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={cn(
              "rounded-lg flex items-center justify-center gap-1.5 text-xs py-2.5 transition-all cursor-pointer",
              isActive
                ? "bg-card shadow-sm text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-card/30 dark:hover:bg-white/5"
            )}
          >
            <Icon className="w-4 h-4" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
