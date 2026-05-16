/**
 * client/src/components/orb-agent/CostGateCard.tsx
 *
 * Renders the orchestrator's `ctx.estimateAndConfirmBudget` decision as a
 * floating confirmation card. Pure presentation: callers hand over the
 * `WorkflowCostEstimate` from `estimateWorkflowCost()` plus three
 * callbacks; this component never calls the cost-governor itself.
 *
 * Visual style mirrors the existing `WorkflowConfirmationCard` in
 * `GlobalOrbChatContext` (slate-950 / cyan accent / fixed-position
 * overlay) so the orb's confirmation UI feels consistent across cards.
 */
import type {
  CostRiskTier,
  WorkflowCostEstimate,
} from "@shared/orb-cost-governor";

const TIER_LABELS: Record<CostRiskTier, string> = {
  free: "免費",
  cheap: "便宜",
  medium: "中等",
  expensive: "昂貴",
  premium: "高階",
};

const TIER_TONES: Record<CostRiskTier, string> = {
  free: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
  cheap: "bg-cyan-500/15 text-cyan-200 border-cyan-400/30",
  medium: "bg-amber-500/15 text-amber-200 border-amber-400/30",
  expensive: "bg-orange-500/15 text-orange-200 border-orange-400/30",
  premium: "bg-rose-500/20 text-rose-200 border-rose-400/40",
};

export interface CostGateCardProps {
  workflowName: string;
  estimate: WorkflowCostEstimate;
  /** Free-text reason from `shouldRequireBudgetConfirm` (e.g., "超過剩餘 30 點"). */
  reason?: string;
  /** Disable buttons while the user's choice is being processed. */
  isBusy?: boolean;
  /**
   * "proceed" runs the workflow as planned. The card hides itself.
   */
  onProceed: () => void;
  /**
   * "confirm-step-by-step" promotes the workflow to step-by-step
   * confirmation so the user can pull the brake at any specific step.
   */
  onConfirmStepByStep: () => void;
  /** "abort" cancels the workflow; nothing runs. */
  onAbort: () => void;
}

export function CostGateCard(props: CostGateCardProps) {
  const { estimate, reason, workflowName, isBusy, onProceed, onConfirmStepByStep, onAbort } = props;
  const minutes = Math.round((estimate.totalDurationMs / 60_000) * 10) / 10;
  const tierTone = TIER_TONES[estimate.maxTier];
  const previewRows = estimate.breakdown.slice(0, 4);
  const remaining = Math.max(estimate.breakdown.length - previewRows.length, 0);

  return (
    <div
      className="fixed bottom-24 right-5 z-[85] w-[400px] max-w-[calc(100vw-2rem)] rounded-3xl border border-amber-200/20 bg-muted/95 p-4 text-white shadow-2xl backdrop-blur-xl"
      role="dialog"
      aria-label="光球：成本確認"
      data-testid="orb-cost-gate-card"
    >
      <div className="text-xs uppercase tracking-[0.2em] text-amber-200/80">
        成本守門員
      </div>
      <div className="mt-1 text-base font-semibold">{workflowName}</div>
      {reason && (
        <div className="mt-1 text-xs text-amber-200/80">{reason}</div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-white/15 bg-card/5 px-2 py-0.5">
          {estimate.totalCredits} 點
        </span>
        <span className="rounded-full border border-white/15 bg-card/5 px-2 py-0.5">
          約 {minutes} 分鐘
        </span>
        <span className={`rounded-full border px-2 py-0.5 ${tierTone}`}>
          {TIER_LABELS[estimate.maxTier]}
        </span>
      </div>

      <div className="mt-3 max-h-40 space-y-1 overflow-auto rounded-2xl bg-card/5 p-3 text-xs">
        {previewRows.map(row => (
          <div
            key={row.stepIndex}
            className="flex items-center justify-between gap-2"
            data-testid={`cost-row-${row.stepIndex}`}
          >
            <span className="min-w-0 flex-1 truncate text-white/75">
              <span className="text-white/50">{row.stepIndex + 1}.</span> {row.stepLabel}
            </span>
            <span className="text-white/60">
              {row.toolName ?? row.source}
            </span>
            <span className="w-12 text-right tabular-nums text-white/80">
              {row.cost.credits} 點
            </span>
          </div>
        ))}
        {remaining > 0 && (
          <div className="text-[10px] text-white/45">…還有 {remaining} 步</div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={onAbort}
          disabled={isBusy}
          className="rounded-2xl bg-card/10 px-3 py-2 text-xs text-white/70 hover:bg-card/15 disabled:opacity-50"
          data-testid="cost-gate-abort"
        >
          先取消
        </button>
        <button
          type="button"
          onClick={onConfirmStepByStep}
          disabled={isBusy}
          className="rounded-2xl bg-card/10 px-3 py-2 text-xs text-white/80 hover:bg-card/15 disabled:opacity-50"
          data-testid="cost-gate-step-by-step"
        >
          逐步審查
        </button>
        <button
          type="button"
          onClick={onProceed}
          disabled={isBusy}
          className="rounded-2xl bg-amber-300 px-3 py-2 text-xs font-semibold text-foreground hover:bg-amber-200 disabled:opacity-50"
          data-testid="cost-gate-proceed"
        >
          直接執行
        </button>
      </div>
    </div>
  );
}
