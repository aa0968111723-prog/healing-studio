/**
 * client/src/components/orb-agent/PerceptionVerdictCard.tsx
 *
 * Renders an `evaluateStepOutcome` verdict as an interactive recovery
 * card when the perception loop detects "no effect" or "diverged". The
 * card surfaces the recommended action (retry / replan / abort) with
 * "looks fine, continue" as the always-available override so the user
 * never feels trapped by an over-eager perception heuristic.
 *
 * Pure presentation; no orchestrator calls. The page agent layer
 * resolves a Promise based on which button the user pressed.
 */
import type { PerceptionVerdict } from "@shared/orb-perception-loop";

export interface PerceptionVerdictCardProps {
  verdict: PerceptionVerdict;
  /** Step label (so the user knows which step the verdict is about). */
  stepLabel: string;
  isBusy?: boolean;
  /** "proceed" — override the verdict and continue with the next step. */
  onProceed: () => void;
  /** "retry" — re-run the same step once. */
  onRetry: () => void;
  /** "replan" — synthesise a no-effect failure so the planner can react. */
  onReplan: () => void;
  /** "abort" — stop the workflow with a typed reason. */
  onAbort: () => void;
}

function outcomeTone(outcome: PerceptionVerdict["outcome"]): {
  label: string;
  className: string;
  emoji: string;
} {
  switch (outcome) {
    case "succeeded":
      return {
        label: "成功",
        className: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200",
        emoji: "✅",
      };
    case "no-effect":
      return {
        label: "似乎沒生效",
        className: "border-amber-400/40 bg-amber-500/15 text-amber-200",
        emoji: "⚠",
      };
    case "diverged":
      return {
        label: "結果偏離預期",
        className: "border-rose-400/40 bg-rose-500/15 text-rose-200",
        emoji: "✗",
      };
    case "unknown":
    default:
      return {
        label: "無法判斷",
        className: "border-white/20 bg-card/10 text-white/70",
        emoji: "?",
      };
  }
}

function deltaSummary(verdict: PerceptionVerdict): string[] {
  const lines: string[] = [];
  const d = verdict.delta;
  if (d.pageChanged) lines.push("頁面已切換");
  if (d.modelChanged) lines.push("模型已切換");
  if (d.modeChanged) lines.push("模式已切換");
  if (d.modalityChanged) lines.push("創作類型已切換");
  if (d.promptChanged) lines.push("提示詞有變化");
  if (d.presetChanged) lines.push("已套用預設");
  if (d.newWarnings.length > 0) lines.push(`新警告：${d.newWarnings.slice(0, 2).join("；")}`);
  if (d.resolvedWarnings.length > 0) lines.push(`已清除警告：${d.resolvedWarnings.slice(0, 2).join("；")}`);
  if (d.changedStateKeys.length > 0) {
    lines.push(`狀態變化：${d.changedStateKeys.slice(0, 4).join("、")}`);
  }
  if (lines.length === 0) lines.push("頁面與動作前後沒有可觀察的差異");
  return lines;
}

export function PerceptionVerdictCard(props: PerceptionVerdictCardProps) {
  const { verdict, stepLabel, isBusy, onProceed, onRetry, onReplan, onAbort } = props;
  const tone = outcomeTone(verdict.outcome);
  const lines = deltaSummary(verdict);
  const recommendation = verdict.recommendation;

  // Highlight the recommended button so the user knows what the perception
  // layer thinks should happen, while keeping all four available.
  const isRecommended = (key: "proceed" | "retry" | "replan" | "abort") =>
    recommendation === key;

  return (
    <div
      className="fixed bottom-24 right-5 z-[87] w-[420px] max-w-[calc(100vw-2rem)] rounded-3xl border border-amber-200/20 bg-muted/95 p-4 text-white shadow-2xl backdrop-blur-xl"
      role="dialog"
      aria-label="光球：執行驗證"
      data-testid="orb-perception-verdict-card"
    >
      <div className="text-xs uppercase tracking-[0.2em] text-amber-200/70">
        執行驗證
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${tone.className}`}
          data-testid={`perception-outcome-${verdict.outcome}`}
        >
          <span>{tone.emoji}</span>
          <span>{tone.label}</span>
        </span>
        <span className="text-sm font-medium">{stepLabel}</span>
      </div>

      <div className="mt-3 rounded-2xl bg-card/5 p-3 text-sm leading-6 text-white/80">
        {verdict.reason}
      </div>

      <ul className="mt-3 space-y-1 text-xs text-white/60">
        {lines.map((line, i) => (
          <li key={i}>· {line}</li>
        ))}
      </ul>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onProceed}
          disabled={isBusy}
          className={`rounded-2xl px-3 py-2 text-xs hover:opacity-90 disabled:opacity-50 ${
            isRecommended("proceed")
              ? "bg-cyan-300 font-semibold text-foreground"
              : "bg-card/10 text-white/80"
          }`}
          data-testid="perception-proceed"
        >
          看起來沒事，繼續
        </button>
        <button
          type="button"
          onClick={onRetry}
          disabled={isBusy}
          className={`rounded-2xl px-3 py-2 text-xs hover:opacity-90 disabled:opacity-50 ${
            isRecommended("retry")
              ? "bg-cyan-300 font-semibold text-foreground"
              : "bg-card/10 text-white/80"
          }`}
          data-testid="perception-retry"
        >
          重試此步
        </button>
        <button
          type="button"
          onClick={onReplan}
          disabled={isBusy}
          className={`rounded-2xl px-3 py-2 text-xs hover:opacity-90 disabled:opacity-50 ${
            isRecommended("replan")
              ? "bg-amber-300 font-semibold text-foreground"
              : "bg-card/10 text-white/80"
          }`}
          data-testid="perception-replan"
        >
          重新規劃
        </button>
        <button
          type="button"
          onClick={onAbort}
          disabled={isBusy}
          className={`rounded-2xl px-3 py-2 text-xs hover:opacity-90 disabled:opacity-50 ${
            isRecommended("abort")
              ? "bg-rose-500/30 font-semibold text-rose-100"
              : "bg-card/10 text-white/80"
          }`}
          data-testid="perception-abort"
        >
          中止
        </button>
      </div>
    </div>
  );
}
