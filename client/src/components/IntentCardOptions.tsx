/**
 * IntentCardOptions.tsx — Render a parsed intent-option group as clickable
 * cards. Used inline by ChatMessageText whenever the AI message contains a
 * `**選項 X：…**` pattern. Clicking a card hands the option's pick-text back
 * to the chat layer (which decides whether to send or to fill the input).
 */

import { ArrowRight } from "lucide-react";
import type { IntentOption } from "@/lib/intentOptions";
import { cn } from "@/lib/utils";

interface Props {
  options: IntentOption[];
  onSelect: (option: IntentOption) => void;
  /** Optional compact variant for tight spaces (mini orb panel). */
  compact?: boolean;
  /** Disable while a request is in-flight. */
  disabled?: boolean;
}

export default function IntentCardOptions({ options, onSelect, compact = false, disabled = false }: Props) {
  if (options.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="意圖選項"
      className={cn(
        "not-prose my-2 grid gap-2",
        // Single-column on mobile keeps the description readable. Two columns
        // on wider widths so 2-3 options sit side by side.
        compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2",
      )}
    >
      {options.map((opt, idx) => (
        <button
          key={`${opt.key}-${idx}`}
          type="button"
          onClick={() => !disabled && onSelect(opt)}
          disabled={disabled}
          className={cn(
            "group relative flex items-start gap-2.5 rounded-2xl border text-left transition-all",
            "border-emerald-200/60 bg-gradient-to-br from-white to-emerald-50/40",
            "hover:border-emerald-300 hover:from-emerald-50/60 hover:to-emerald-100/40 hover:shadow-md",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300",
            "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none",
            compact ? "px-2.5 py-2" : "px-3 py-2.5",
          )}
        >
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full bg-emerald-500/90 font-semibold text-white shadow-sm",
              compact ? "w-5 h-5 text-[10px]" : "w-6 h-6 text-xs",
            )}
            aria-hidden="true"
          >
            {opt.key}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block font-medium text-emerald-900 group-hover:text-emerald-950",
                compact ? "text-xs leading-snug" : "text-sm leading-snug",
              )}
            >
              {opt.title}
            </span>
            {opt.description && (
              <span
                className={cn(
                  "mt-0.5 block text-emerald-700/80 group-hover:text-emerald-800",
                  compact ? "text-[10px] leading-snug" : "text-[11px] leading-snug",
                )}
              >
                {opt.description}
              </span>
            )}
          </span>
          <ArrowRight
            className={cn(
              "shrink-0 text-emerald-400 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100",
              compact ? "w-3 h-3 mt-0.5" : "w-3.5 h-3.5 mt-1",
            )}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
}
