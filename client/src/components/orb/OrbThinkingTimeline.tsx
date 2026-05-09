/**
 * OrbThinkingTimeline — inline progress UI for the orb's chat planning
 * window. The orb chat handler emits milestone events to a per-request
 * ring buffer; the context polls them every 400 ms and feeds them here.
 *
 * Phase-1 of the multi-step thinking UX. Without this the user sees a
 * silent 20 s wait while the planner runs; with it they see "檢查訊息中
 * → 規劃步驟中 → 整理回應" tick by, plus any specialist hand-off the
 * planner picked.
 */
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import type { OrbChatProgressEvent } from "@/contexts/GlobalOrbChatContext";

const STAGE_EMOJI: Record<OrbChatProgressEvent["stage"], string> = {
  received: "🌟",
  sanitizing: "🧹",
  guarding_attachments: "📎",
  extracting_pdf: "📄",
  selecting_provider: "🧭",
  researching_web: "🔍",
  planning: "🧠",
  calling_specialist: "🎨",
  materializing_task: "📋",
  finalizing: "✨",
  error: "⚠️",
};

function eventKey(event: OrbChatProgressEvent): string {
  return `${event.seq}-${event.stage}`;
}

export interface OrbThinkingTimelineProps {
  events: OrbChatProgressEvent[];
  /** Falls back to "光球思考中…" when no events have arrived yet. */
  fallbackLabel?: string;
  reduceMotion?: boolean;
}

export function OrbThinkingTimeline({
  events,
  fallbackLabel = "光球思考中…",
  reduceMotion = false,
}: OrbThinkingTimelineProps) {
  // Show at most the latest 6 milestones so a long planner trace doesn't
  // shove the conversation off-screen on small viewports.
  const visible = events.slice(-6);
  const isEmpty = visible.length === 0;

  return (
    <div className="flex justify-start">
      <div
        className="bg-gradient-to-br from-gray-50 to-gray-100/80 rounded-2xl rounded-bl-md px-4 py-2.5 border border-gray-100/60 max-w-[88%]"
        role="status"
        aria-live="polite"
        aria-label="光球正在思考"
      >
        {isEmpty ? (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            <span>{fallbackLabel}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <AnimatePresence initial={false}>
              {visible.map((event, idx) => {
                const isLatest = idx === visible.length - 1;
                return (
                  <motion.div
                    key={eventKey(event)}
                    initial={
                      reduceMotion ? { opacity: 1 } : { opacity: 0, y: 4 }
                    }
                    animate={{ opacity: isLatest ? 1 : 0.55, y: 0 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                    transition={
                      reduceMotion
                        ? { duration: 0.1 }
                        : { duration: 0.2, ease: "easeOut" }
                    }
                    className="flex items-center gap-1.5 text-xs leading-snug"
                  >
                    <span
                      aria-hidden="true"
                      className="select-none w-4 text-center"
                    >
                      {STAGE_EMOJI[event.stage] ?? "·"}
                    </span>
                    <span
                      className={
                        isLatest
                          ? "text-gray-700 font-medium"
                          : "text-gray-400"
                      }
                    >
                      {event.label}
                      {isLatest && event.stage !== "finalizing" && event.stage !== "error" ? (
                        <Loader2
                          className="inline-block w-3 h-3 ml-1 animate-spin text-gray-400"
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
