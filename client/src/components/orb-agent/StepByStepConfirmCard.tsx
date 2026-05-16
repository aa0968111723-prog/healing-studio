/**
 * client/src/components/orb-agent/StepByStepConfirmCard.tsx
 *
 * Renders the orchestrator's `ctx.confirmStep(step, index, total)` request
 * as a per-step confirmation card. Pure presentation: caller is the page
 * agent layer, which opens this card via a Promise and resolves with the
 * user's decision.
 *
 * Uses the same overlay style as the workflow / cost cards so they stack
 * without UI mismatch when more than one is visible (rare; orchestrator
 * serialises confirms).
 */
import type { AgentWorkflowStep } from "@shared/agent-actions";

export interface StepByStepConfirmCardProps {
  step: AgentWorkflowStep;
  index: number;
  total: number;
  isBusy?: boolean;
  /** "proceed" → orchestrator dispatches this step. */
  onProceed: () => void;
  /** "skip" → orchestrator marks step as skipped, continues with the next. */
  onSkip: () => void;
  /** "abort" → orchestrator stops with a typed reason. */
  onAbort: () => void;
}

function describeStep(step: AgentWorkflowStep): string {
  if (step.toolName) {
    const argPreview =
      step.toolArgs && Object.keys(step.toolArgs).length > 0
        ? `（${Object.keys(step.toolArgs).slice(0, 3).join(", ")}…）`
        : "";
    return `工具呼叫：${step.toolName}${argPreview}`;
  }
  if (step.actionType === "navigate") return `跳到 ${step.payload || "<unknown>"}`;
  if (step.actionType === "fillPrompt") {
    const text = step.payload || "";
    return `填入提示詞：「${text.length > 36 ? text.slice(0, 36) + "…" : text}」`;
  }
  if (step.actionType === "submit") return "送出生成";
  if (step.actionType === "applyPreset") return `套用預設：${step.payload}`;
  if (step.actionType === "setModel") return `切換模型：${step.payload}`;
  if (step.actionType === "setMode") return `切換模式：${step.payload}`;
  if (step.actionType === "setModality") return `切換創作類型：${step.payload}`;
  return `${step.actionType} → ${step.payload}`;
}

export function StepByStepConfirmCard(props: StepByStepConfirmCardProps) {
  const { step, index, total, isBusy, onProceed, onSkip, onAbort } = props;
  const desc = describeStep(step);
  const progress = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;

  return (
    <div
      className="fixed bottom-24 right-5 z-[86] w-[400px] max-w-[calc(100vw-2rem)] rounded-3xl border border-cyan-200/20 bg-muted/95 p-4 text-white shadow-2xl backdrop-blur-xl"
      role="dialog"
      aria-label="光球：步驟確認"
      data-testid="orb-step-by-step-confirm"
    >
      <div className="flex items-center justify-between text-xs">
        <span className="uppercase tracking-[0.2em] text-cyan-200/70">
          逐步確認
        </span>
        <span className="text-white/60 tabular-nums">
          {index + 1} / {total}
        </span>
      </div>

      <div className="mt-2 h-1 overflow-hidden rounded-full bg-card/10">
        <div
          className="h-full bg-cyan-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mt-3 text-base font-semibold">{step.label}</div>
      <div className="mt-2 rounded-2xl bg-card/5 p-3 text-sm leading-6 text-white/80">
        {desc}
      </div>
      {step.path && (
        <div className="mt-2 text-xs text-white/50">
          目的頁面：<code className="rounded bg-card/10 px-1.5 py-0.5">{step.path}</code>
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={onAbort}
          disabled={isBusy}
          className="rounded-2xl bg-rose-500/20 px-3 py-2 text-xs font-medium text-rose-100 hover:bg-rose-500/30 disabled:opacity-50"
          data-testid="step-confirm-abort"
        >
          中止
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={isBusy}
          className="rounded-2xl bg-card/10 px-3 py-2 text-xs text-white/80 hover:bg-card/15 disabled:opacity-50"
          data-testid="step-confirm-skip"
        >
          跳過此步
        </button>
        <button
          type="button"
          onClick={onProceed}
          disabled={isBusy}
          className="rounded-2xl bg-cyan-300 px-3 py-2 text-xs font-semibold text-foreground hover:bg-cyan-200 disabled:opacity-50"
          data-testid="step-confirm-proceed"
        >
          繼續
        </button>
      </div>
    </div>
  );
}
