import { memo } from "react";
import { Sparkles } from "lucide-react";
import type { QuickAction } from "@shared/types";
import { cn } from "@/lib/utils";
import {
  QUICK_ACTION_ICONS,
  QUICK_ACTION_CATEGORY_LABELS,
} from "./constants";

export const QuickActionChip = memo(function QuickActionChip({
  action,
  onClick,
  disabled,
}: {
  action: QuickAction;
  onClick: (action: QuickAction) => void;
  disabled?: boolean;
}) {
  const IconComp = QUICK_ACTION_ICONS[action.icon] ?? Sparkles;
  const catConfig = QUICK_ACTION_CATEGORY_LABELS[action.category];

  return (
    <button
      onClick={() => onClick(action)}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-medium transition-all",
        "hover:shadow-sm hover:scale-[1.02] active:scale-[0.98]",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        catConfig?.color ?? "bg-gray-100 text-gray-700",
        "border-current/10"
      )}
      title={action.promptTemplate}
    >
      <IconComp className="w-3 h-3" />
      {action.labelZh}
    </button>
  );
});
