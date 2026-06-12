// ============================================================================
// shells/video/console/ReadinessChip.tsx — 共用 readiness chip（確認門三態徽章）
// ----------------------------------------------------------------------------
// 每張 shot/scene/角色/素材卡都掛這顆 chip，點了 deep-link 到修復點（onClick）。
// 色彩語意對映真實 token（沿用 ConfirmGate 既有 Tailwind 慣例，非 doc theme.css）：
//   ready 可量產 = sage/emerald · partial 部分待補 = amber · blocked 全待補 = destructive。
//   approved 已核准 = lavender/accent。
// ============================================================================
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GateState } from "@/spine/types";
import { GATE_STATE_LABEL } from "@/spine/gate";

const TONE: Record<GateState, string> = {
  ready: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  partial: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  blocked: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function ReadinessChip({
  state,
  label,
  onClick,
  className,
  title,
}: {
  state: GateState;
  /** 覆寫文案（預設用 GATE_STATE_LABEL）。 */
  label?: string;
  onClick?: () => void;
  className?: string;
  title?: string;
}) {
  const content = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        TONE[state],
        onClick && "transition-healing hover:brightness-95 cursor-pointer",
        className,
      )}
    >
      {label ?? GATE_STATE_LABEL[state]}
    </span>
  );
  if (!onClick) return content;
  return (
    <button type="button" onClick={onClick} title={title ?? "前往修復點"} className="inline-flex">
      {content}
    </button>
  );
}

/** 已核准徽章（lavender/accent 語意）。 */
export function ApprovedChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-accent/50 bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent-foreground",
        className,
      )}
    >
      <Check className="size-2.5" /> 已核准
    </span>
  );
}

export default ReadinessChip;
