import { VIBE_CARDS } from "@shared/types";
import { motion } from "framer-motion";
import { Cloud, Sun, Moon, Leaf, Camera, Square, Sparkles, Star } from "lucide-react";
import { cn } from "@/lib/utils";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  cloud: Cloud,
  sun: Sun,
  moon: Moon,
  leaf: Leaf,
  camera: Camera,
  square: Square,
  sparkles: Sparkles,
  star: Star,
};

type VibeCardWizardProps = {
  selectedIds: string[];
  onToggle: (id: string) => void;
};

export function VibeCardWizard({ selectedIds, onToggle }: VibeCardWizardProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">氛圍卡片精靈</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {VIBE_CARDS.map((card) => {
          const isSelected = selectedIds.includes(card.id);
          const Icon = iconMap[card.icon] || Sparkles;
          return (
            <motion.button
              key={card.id}
              whileTap={{ scale: 0.95 }}
              onClick={() => onToggle(card.id)}
              className={cn(
                "relative p-3 sm:p-4 rounded-[25px] border-2 transition-all text-left",
                "hover:shadow-lg active:scale-95",
                isSelected
                  ? "vibe-card-selected border-primary/40"
                  : "border-transparent hover:border-border"
              )}
              style={{
                backgroundColor: card.color + "30",
              }}
            >
              <div className="flex flex-col gap-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: card.color + "60" }}
                >
                  <Icon className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{card.labelZh}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 hidden sm:block">{card.description}</p>
                </div>
              </div>
              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center"
                >
                  <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
