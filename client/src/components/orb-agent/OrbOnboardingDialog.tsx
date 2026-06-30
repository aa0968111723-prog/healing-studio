/**
 * client/src/components/orb-agent/OrbOnboardingDialog.tsx
 *
 * 3-question cold-start dialog shown to users whose
 * `agentPreferences.onboardingCompletedAt` is null. Captures their
 * primary goal + pacing + confirmation style, derives an initial
 * preference patch via `deriveOnboardingPreferences`, and persists via
 * `agentPreferences.updatePreferences` mutation.
 *
 * Pure presentation + minimal mutation glue; the question schema and
 * derive function live in `@shared/orb-onboarding-questions` so backend
 * code can reason about the answers symmetrically.
 *
 * Caller is responsible for visibility (we expose `open` + `onOpenChange`)
 * — typically the orb chat root mounts this when it loads preferences and
 * sees `onboardingCompletedAt === null`.
 */
import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ORB_ONBOARDING_QUESTIONS,
  deriveOnboardingPreferences,
  type OrbOnboardingAnswers,
  type OrbOnboardingQuestionId,
} from "@shared/orb-onboarding-questions";

export interface OrbOnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the answers have been persisted server-side. */
  onCompleted?: (answers: OrbOnboardingAnswers) => void;
}

export function OrbOnboardingDialog({ open, onOpenChange, onCompleted }: OrbOnboardingDialogProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<OrbOnboardingAnswers>({});
  const dismissedRef = useRef(false);
  useEffect(() => {
    if (open) dismissedRef.current = false;
  }, [open]);
  const utils = trpc.useUtils();
  const updateMutation = trpc.agentPreferences.updatePreferences.useMutation({
    onSuccess: () => {
      void utils.agentPreferences.getPreferences.invalidate();
      void utils.agentPreferences.getDistilledProfile.invalidate();
      toast.success("謝謝！光球已記下你的偏好。");
      if (!dismissedRef.current) onCompleted?.(answers);
      onOpenChange(false);
    },
    onError: error => toast.error(`儲存失敗：${error.message ?? "未知錯誤"}`),
  });

  const totalSteps = ORB_ONBOARDING_QUESTIONS.length;
  const question = ORB_ONBOARDING_QUESTIONS[step];

  const select = (questionId: OrbOnboardingQuestionId, optionId: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: optionId }));
  };

  const handleNext = () => {
    if (!answers[question.id]) {
      toast.error("先選一個選項吧");
      return;
    }
    if (step < totalSteps - 1) {
      setStep(step + 1);
      return;
    }
    // Final step → derive + persist.
    const derived = deriveOnboardingPreferences(answers);
    updateMutation.mutate({
      pacingOverride: derived.pacingOverride,
      confirmationPolicy: derived.confirmationPolicy,
      costBudget: derived.costBudget,
      orbWelcomeMessage: derived.welcomeMessageHint ?? null,
      onboardingCompletedAt: new Date().toISOString(),
    });
  };

  const handleSkip = () => {
    // Mark onboarding done so the dialog doesn't reappear, but don't push
    // any opinionated preferences — the user gets the defaults.
    updateMutation.mutate({
      onboardingCompletedAt: new Date().toISOString(),
    });
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) dismissedRef.current = true;
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" data-testid="orb-onboarding-dialog">
        <DialogHeader>
          <DialogTitle>光球初次見面 ✨</DialogTitle>
          <DialogDescription>
            問你三個小問題，幫光球抓到你的節奏。隨時可以在「光球設定」改。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {ORB_ONBOARDING_QUESTIONS.map((_, i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`}
              />
            ))}
            <span className="ml-2 tabular-nums">{step + 1}/{totalSteps}</span>
          </div>

          <div>
            <h3 className="text-base font-semibold">{question.prompt}</h3>
            {question.helper && (
              <p className="mt-1 text-xs text-muted-foreground">{question.helper}</p>
            )}
          </div>

          <div className="space-y-2">
            {question.options.map(option => {
              const active = answers[question.id] === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => select(question.id, option.id)}
                  className={`block w-full rounded-2xl border p-3 text-left text-sm transition ${
                    active
                      ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                      : "border-border hover:border-primary/40"
                  }`}
                  data-testid={`onboarding-option-${question.id}-${option.id}`}
                >
                  <div className="font-medium">{option.label}</div>
                  {option.description && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {option.description}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <DialogFooter className="flex justify-between gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSkip}
            disabled={updateMutation.isPending}
            data-testid="onboarding-skip"
          >
            晚點再說
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep(step - 1)}
                disabled={updateMutation.isPending}
                data-testid="onboarding-back"
              >
                上一題
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleNext}
              disabled={!answers[question.id] || updateMutation.isPending}
              data-testid="onboarding-next"
            >
              {step === totalSteps - 1
                ? updateMutation.isPending
                  ? "儲存中..."
                  : "完成"
                : "下一題"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
