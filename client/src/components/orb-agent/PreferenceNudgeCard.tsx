/**
 * client/src/components/orb-agent/PreferenceNudgeCard.tsx
 *
 * Periodic surface that shows the user one observation the distiller has
 * made (e.g., "光球觀察到你最近 80% 都接受 fillPrompt — 要不要把它加到自動接受清單？").
 * Pure presentation; the parent controls visibility cadence (e.g.,
 * "show at most once per 24h", "only when confidence >= 0.6").
 *
 * The card surfaces ONE actionable observation at a time so the user
 * doesn't get overwhelmed; the rest of the profile lives in
 * /settings/agent → 角色 / 節奏 → 偏好檢視卡.
 */
import { Button } from "@/components/ui/button";

export type PreferenceNudgeKind =
  | "auto-approve-suggestion"  // user accepts X consistently → suggest auto-approve
  | "preferred-model-noticed"  // saw a preferred model emerge → confirm
  | "pacing-shift"             // pacing changed → ask if user wants to update override
  | "low-confidence-prompt";   // very few signals → invite more interaction

export interface PreferenceNudgeCardProps {
  kind: PreferenceNudgeKind;
  /** Headline ("光球觀察到…"). */
  headline: string;
  /** Body text — keep under 2 lines. */
  body: string;
  /** Primary CTA label (e.g., "好，加入自動接受"). */
  primaryLabel: string;
  /** Secondary CTA label (defaults to "再想想"). */
  secondaryLabel?: string;
  /** "也別再問了" — dismiss this nudge kind for the long term. */
  showSnoozeForever?: boolean;
  /** Visual emphasis. */
  tone?: "neutral" | "positive" | "warning";
  /** When false the entire card hides itself. */
  open: boolean;
  onPrimary: () => void;
  onSecondary: () => void;
  onSnoozeForever?: () => void;
}

const TONE_CLASSES: Record<NonNullable<PreferenceNudgeCardProps["tone"]>, string> = {
  neutral: "border-cyan-200/30 bg-muted/95 text-white",
  positive: "border-emerald-300/40 bg-emerald-950/85 text-emerald-50",
  warning: "border-amber-300/40 bg-amber-950/85 text-amber-50",
};

export function PreferenceNudgeCard(props: PreferenceNudgeCardProps) {
  const {
    kind,
    open,
    headline,
    body,
    primaryLabel,
    secondaryLabel = "再想想",
    showSnoozeForever,
    tone = "neutral",
    onPrimary,
    onSecondary,
    onSnoozeForever,
  } = props;

  if (!open) return null;

  return (
    <div
      className={`fixed bottom-24 right-5 z-[80] w-[360px] max-w-[calc(100vw-2rem)] rounded-3xl border p-4 shadow-2xl backdrop-blur-xl ${TONE_CLASSES[tone]}`}
      role="status"
      aria-label="光球：觀察到一件事"
      data-testid={`preference-nudge-${kind}`}
    >
      <div className="text-xs uppercase tracking-[0.2em] opacity-70">
        光球的觀察
      </div>
      <div className="mt-1 text-base font-semibold">{headline}</div>
      <p className="mt-2 text-sm leading-6 opacity-85">{body}</p>

      <div className="mt-4 flex items-center justify-between gap-2">
        {showSnoozeForever && onSnoozeForever ? (
          <button
            type="button"
            onClick={onSnoozeForever}
            className="text-[11px] underline opacity-60 hover:opacity-90"
            data-testid="nudge-snooze-forever"
          >
            別再問這個
          </button>
        ) : (
          <span />
        )}

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onSecondary} data-testid="nudge-secondary">
            {secondaryLabel}
          </Button>
          <Button size="sm" onClick={onPrimary} data-testid="nudge-primary">
            {primaryLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
