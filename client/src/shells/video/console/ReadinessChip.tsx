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
// U-2（AIDV-92）逐殼採用 · /video：旗標 ON 時改用 design-kit 亮色暖光 ReadinessChip / Pill
// （與 chrome 同一個 ENABLE_AIDV_CHROME 開關）；OFF（預設）＝沿用既有 Tailwind 版＝零變化。
// 設計門依 ui-ux-pro-max「色彩非唯一資訊（High）」：兩版皆保留文字標籤、design-kit 於 .aidv-kit 內解析 AA 對比。
import { ENABLE_AIDV_CHROME } from "@/config/featureFlags";
import { AidvKit, ReadinessChip as DkReadinessChip, Pill as DkPill } from "@/components/design-kit";

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
  // 旗標 ON：design-kit 版（state 字面值與 DkGateState 同：ready/partial/blocked，可直傳）。
  // 以 <AidvKit as="span"> 維持 inline 版面並把 className 帶上；onClick 由 design-kit 自帶按鈕與焦點環。
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit as="span" className={className}>
        <DkReadinessChip state={state} label={label} onClick={onClick} />
      </AidvKit>
    );
  }
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
  // 旗標 ON：design-kit Pill（kind="info" 帶狀態點＋文字，不用 emoji 圖示＝符 ui-ux-pro-max no-emoji-icons）。
  if (ENABLE_AIDV_CHROME) {
    return (
      <AidvKit as="span" className={className}>
        <DkPill kind="info" dot>已核准</DkPill>
      </AidvKit>
    );
  }
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
