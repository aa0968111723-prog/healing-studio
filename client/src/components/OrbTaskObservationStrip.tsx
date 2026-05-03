/**
 * OrbTaskObservationStrip.tsx — chain audit log surface for the user.
 *
 * Renders the structured `task.observed` / `task.continuation_started`
 * events the agent loop writes to the FSM into a compact strip of
 * cards. Mounted next to the chat overlay so the user sees:
 *   - 「光球做完了」when the chain reaches a complete observation
 *   - 「上一步沒拿到影片網址，要不要改用 Veo？」when the observer
 *     produces an actionable failure narrative
 *   - 「換個方法繼續：第 2 輪」chips between iterations so the chain
 *     itself is legible
 *
 * The hook handles auto-following continuations; this component only
 * renders. Returns null when no rootTaskId is supplied so the caller
 * can mount it unconditionally.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { CheckCircle2, AlertCircle, HelpCircle, ArrowRight, Sparkles, X, StopCircle } from "lucide-react";
import { useOrbTaskObservations, type OrbTaskObservationItem } from "@/hooks/useOrbTaskObservations";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

interface Props {
  rootTaskId: string | null;
  /** Optional callback when the user clicks a `needs_user` suggestion
   *  pill — callers can pipe it into their chat send flow. */
  onSuggestionPick?: (suggestion: string, observation: OrbTaskObservationItem) => void;
  /** Dismiss callback — called when the user clicks the close button.
   *  When omitted the strip stays visible until the parent unmounts it. */
  onDismiss?: () => void;
  className?: string;
}

function ObservationIcon({ kind }: { kind: OrbTaskObservationItem["kind"] }) {
  switch (kind) {
    case "complete":
      return <CheckCircle2 className="w-4 h-4 text-emerald-300" />;
    case "abort":
      return <AlertCircle className="w-4 h-4 text-rose-300" />;
    case "needs_user":
      return <HelpCircle className="w-4 h-4 text-amber-300" />;
    case "continue":
      return <ArrowRight className="w-4 h-4 text-cyan-300" />;
    case "continuation_started":
      return <Sparkles className="w-4 h-4 text-violet-300" />;
  }
}

function kindLabel(kind: OrbTaskObservationItem["kind"]): string {
  switch (kind) {
    case "complete":
      return "完成";
    case "abort":
      return "暫停";
    case "needs_user":
      return "需要你";
    case "continue":
      return "繼續中";
    case "continuation_started":
      return "換個方法";
  }
}

export default function OrbTaskObservationStrip({
  rootTaskId,
  onSuggestionPick,
  onDismiss,
  className,
}: Props) {
  const { observations, isPolling, currentTaskId } = useOrbTaskObservations(rootTaskId);
  const cancelMutation = trpc.ai.orbTask.cancel.useMutation();
  const [isCancelling, setIsCancelling] = useState(false);

  if (!rootTaskId || observations.length === 0) return null;

  // Show only the most recent 4 to keep the strip compact; older
  // observations live in the audit log.
  const visible = observations.slice(-4);

  // Only offer cancel while the chain is still running. Once an
  // observation reaches a terminal kind the polling stops anyway and
  // there is nothing left to cancel.
  const canCancel = isPolling && !!currentTaskId;
  const handleCancel = async () => {
    if (!currentTaskId || isCancelling) return;
    setIsCancelling(true);
    try {
      await cancelMutation.mutateAsync({
        taskId: currentTaskId,
        reason: "cancelled by user from observation strip",
      });
    } catch {
      // best-effort — even if the mutation fails the strip still
      // stops polling once the next terminal observation lands.
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className={cn(
        "rounded-2xl border border-white/15 bg-slate-950/85 backdrop-blur-xl",
        "p-3 space-y-2 shadow-xl shadow-black/30",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-white/50">
          <span>光球觀察</span>
          {isPolling && (
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
          )}
          {currentTaskId && currentTaskId !== rootTaskId && (
            <span className="text-violet-200/80 normal-case">（chain）</span>
          )}
          {/* Iteration progress — visible once we've actually hopped at
              least once. Shows how many tasks deep into the bounded
              continuation chain we are; chain runner caps at 2 by
              default so the worst case is "第 2/2 輪". */}
          {(() => {
            const last = visible[visible.length - 1];
            const iter = last?.iterationIndex ?? 0;
            if (iter > 0) {
              return (
                <span className="rounded-full border border-violet-300/30 bg-violet-300/10 px-1.5 py-0.5 text-violet-100 normal-case">
                  第 {iter + 1} 輪
                </span>
              );
            }
            return null;
          })()}
        </div>
        <div className="flex items-center gap-1">
          {canCancel && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={isCancelling}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition-colors",
                "border border-rose-300/30 bg-rose-300/10 text-rose-100 hover:bg-rose-300/20",
                "disabled:opacity-50"
              )}
              title="停止代理"
            >
              <StopCircle className="w-3 h-3" />
              <span>{isCancelling ? "停中…" : "停止"}</span>
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-full p-1 text-white/40 hover:bg-white/10 hover:text-white/70 transition-colors"
              title="收掉"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {visible.map(item => (
          <motion.div
            key={item.eventId}
            layout
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.22 }}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2"
          >
            <div className="flex items-start gap-2">
              <ObservationIcon kind={item.kind} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/45">
                  <span>{kindLabel(item.kind)}</span>
                  {item.iterationIndex > 0 && (
                    <span className="rounded-full bg-violet-300/15 border border-violet-300/30 px-1.5 py-0.5 text-violet-100 normal-case">
                      第 {item.iterationIndex + 1} 輪
                    </span>
                  )}
                  {item.kind === "abort" && item.failureCategory && (
                    <span className="rounded-full bg-rose-300/10 border border-rose-300/30 px-1.5 py-0.5 text-rose-100 normal-case">
                      {item.failureCategory}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-white/85 leading-relaxed">{item.message}</p>
                {item.kind === "needs_user" && item.suggestions && item.suggestions.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {item.suggestions.map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => onSuggestionPick?.(s, item)}
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[11px] transition-all",
                          "bg-white/10 hover:bg-white/18 text-white/90 border border-white/15"
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
