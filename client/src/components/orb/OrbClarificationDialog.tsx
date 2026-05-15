/**
 * OrbClarificationDialog.tsx - Interactive dialog for Orb to ask clarifying questions
 *
 * When the user's request is ambiguous, Orb can generate structured clarification
 * questions to gather more specific information before proceeding.
 *
 * Visual: aligned with .apple-dock-glass sidebar + .card-healing homepage via
 * the shared `healing-*` utilities defined in client/src/index.css.
 */

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Sparkles, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { getSpiritVisual } from "@/lib/spiritsVisual";

export interface ClarificationQuestion {
  questionId: string;
  question: string;
  type: "choice" | "confirm" | "parameter" | "constraint" | "preference" | "context";
  options?: string[];
  default?: any;
  required: boolean;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface ClarificationRequest {
  spiritId: string;
  spiritName?: string;
  taskId: string;
  questions: ClarificationQuestion[];
  context: string;
  urgency: "blocking" | "optional" | "background";
}

interface OrbClarificationDialogProps {
  request: ClarificationRequest | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (answers: Record<string, any>) => void;
}

export default function OrbClarificationDialog({
  request,
  isOpen,
  onClose,
  onSubmit,
}: OrbClarificationDialogProps) {
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (request) {
      const initialAnswers: Record<string, any> = {};
      request.questions.forEach((q) => {
        if (q.default !== undefined) {
          initialAnswers[q.questionId] = q.default;
        }
      });
      setAnswers(initialAnswers);
      setErrors({});
    }
  }, [request]);

  if (!request) return null;

  const spirit = getSpiritVisual(request.spiritId);

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};

    request.questions.forEach((q) => {
      if (q.required && (answers[q.questionId] === undefined || answers[q.questionId] === "")) {
        newErrors[q.questionId] = "此問題必須回答";
      }
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSubmit(answers);
    onClose();
  };

  const renderQuestionInput = (question: ClarificationQuestion) => {
    const value = answers[question.questionId];
    const error = errors[question.questionId];

    switch (question.type) {
      case "choice":
        return (
          <div className="space-y-2.5">
            <RadioGroup
              value={value}
              onValueChange={(val) =>
                setAnswers((prev) => ({ ...prev, [question.questionId]: val }))
              }
              className="space-y-1.5"
            >
              {question.options?.map((option) => {
                const isSelected = value === option;
                return (
                  <label
                    key={option}
                    htmlFor={`${question.questionId}-${option}`}
                    className={cn(
                      "flex items-center gap-3 px-3.5 py-2.5 rounded-2xl cursor-pointer transition-all healing-inner-card",
                      isSelected && "ring-2 ring-[oklch(0.78_0.08_300_/_0.55)] border-[oklch(0.78_0.08_300_/_0.6)]",
                    )}
                  >
                    <RadioGroupItem
                      value={option}
                      id={`${question.questionId}-${option}`}
                      className="shrink-0"
                    />
                    <span className="text-sm text-glass-strong leading-relaxed">{option}</span>
                  </label>
                );
              })}
            </RadioGroup>
            {error && <p className="text-xs text-rose-500 pl-1">{error}</p>}
          </div>
        );

      case "confirm":
        return (
          <div className="space-y-2">
            <label
              htmlFor={question.questionId}
              className="flex items-center gap-3 px-3.5 py-2.5 rounded-2xl cursor-pointer healing-inner-card"
            >
              <Checkbox
                id={question.questionId}
                checked={value === true}
                onCheckedChange={(checked) =>
                  setAnswers((prev) => ({ ...prev, [question.questionId]: checked }))
                }
              />
              <span className="text-sm text-glass-strong">是的，我確認</span>
            </label>
            {error && <p className="text-xs text-rose-500 pl-1">{error}</p>}
          </div>
        );

      case "parameter":
        if (question.min !== undefined && question.max !== undefined) {
          return (
            <div className="space-y-3 px-3.5 py-3 rounded-2xl healing-inner-card">
              <div className="flex items-center justify-between text-xs text-glass-soft">
                <span>
                  {question.min}
                  {question.hint && <span className="ml-1 opacity-70">{question.hint}</span>}
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-[oklch(0.94_0.08_300_/_0.55)] text-[oklch(0.3_0.07_300)] font-semibold text-sm">
                  {value ?? question.default ?? question.min}
                </span>
                <span>{question.max}</span>
              </div>
              <Slider
                value={[value ?? question.default ?? question.min]}
                onValueChange={([val]) =>
                  setAnswers((prev) => ({ ...prev, [question.questionId]: val }))
                }
                min={question.min}
                max={question.max}
                step={question.step ?? 1}
                className="w-full"
              />
              {error && <p className="text-xs text-rose-500">{error}</p>}
            </div>
          );
        }
        return (
          <div className="space-y-2">
            <Input
              type="text"
              value={value ?? ""}
              onChange={(e) =>
                setAnswers((prev) => ({ ...prev, [question.questionId]: e.target.value }))
              }
              placeholder={question.hint || "請輸入..."}
              className={cn(
                "rounded-2xl border-[oklch(0.9_0.04_300_/_0.5)] bg-white/70 backdrop-blur focus-visible:ring-2 focus-visible:ring-[oklch(0.82_0.04_300_/_0.55)]",
                error && "border-rose-400",
              )}
            />
            {error && <p className="text-xs text-rose-500 pl-1">{error}</p>}
          </div>
        );

      case "context":
        return (
          <div className="space-y-2">
            <Textarea
              value={value ?? ""}
              onChange={(e) =>
                setAnswers((prev) => ({ ...prev, [question.questionId]: e.target.value }))
              }
              placeholder={question.hint || "請提供更多細節..."}
              rows={3}
              className={cn(
                "rounded-2xl border-[oklch(0.9_0.04_300_/_0.5)] bg-white/70 backdrop-blur focus-visible:ring-2 focus-visible:ring-[oklch(0.82_0.04_300_/_0.55)] resize-none leading-relaxed",
                error && "border-rose-400",
              )}
            />
            {error && <p className="text-xs text-rose-500 pl-1">{error}</p>}
          </div>
        );

      default:
        return (
          <div className="space-y-2">
            <Input
              type="text"
              value={value ?? ""}
              onChange={(e) =>
                setAnswers((prev) => ({ ...prev, [question.questionId]: e.target.value }))
              }
              placeholder={question.hint || "請輸入..."}
              className={cn(
                "rounded-2xl border-[oklch(0.9_0.04_300_/_0.5)] bg-white/70 backdrop-blur",
                error && "border-rose-400",
              )}
            />
            {error && <p className="text-xs text-rose-500 pl-1">{error}</p>}
          </div>
        );
    }
  };

  const urgencyLabel = {
    blocking: "需要回答",
    optional: "可選回答",
    background: "背景資訊",
  }[request.urgency];

  const headerName = spirit?.label || request.spiritName || "光球";
  const headerNickname = spirit?.nickname;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="healing-dialog-content max-w-2xl max-h-[85vh] overflow-y-auto p-0 gap-0">
        {/* Header — spirit avatar + name + urgency */}
        <DialogHeader className="px-6 pt-6 pb-4 space-y-3">
          <div className="flex items-start gap-3.5">
            <div
              className={cn(
                "healing-spirit-disc shrink-0 w-12 h-12 rounded-2xl text-2xl shadow-md",
                spirit
                  ? `bg-gradient-to-br ${spirit.gradient}`
                  : "bg-gradient-to-br from-[oklch(0.94_0.08_300)] to-[oklch(0.86_0.12_320)]",
              )}
              aria-hidden
            >
              {spirit?.emoji ?? "✨"}
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center flex-wrap gap-2">
                <DialogTitle className="text-lg font-semibold text-glass-strong leading-tight">
                  {headerNickname ? `${headerNickname} 想再問你一下` : `${headerName} 需要更多資訊`}
                </DialogTitle>
                <span
                  className="healing-urgency-badge"
                  data-urgency={request.urgency}
                  title={urgencyLabel}
                >
                  <AlertCircle className="w-3 h-3" aria-hidden />
                  {urgencyLabel}
                </span>
              </div>
              {(spirit?.vibe || request.context) && (
                <DialogDescription className="text-sm text-glass-soft leading-relaxed">
                  {request.context || spirit?.vibe}
                </DialogDescription>
              )}
            </div>
          </div>
          <div className="healing-hairline mt-2" aria-hidden />
        </DialogHeader>

        {/* Questions */}
        <div className="px-6 py-2 space-y-5">
          {request.questions.map((question, index) => (
            <div key={question.questionId} className="space-y-2.5">
              <div className="flex items-start gap-3">
                <span className="healing-pill-num mt-0.5" aria-label={`第 ${index + 1} 題`}>
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0 space-y-2">
                  <Label className="text-sm sm:text-[15px] font-semibold text-glass-strong flex items-center gap-1.5 leading-snug">
                    {question.question}
                    {question.required && (
                      <span className="text-rose-500" aria-label="必填">
                        *
                      </span>
                    )}
                  </Label>
                  {question.hint && !["parameter", "context"].includes(question.type) && (
                    <p className="text-xs text-glass-soft leading-relaxed">{question.hint}</p>
                  )}
                  {renderQuestionInput(question)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 mt-2">
          <div className="healing-hairline mb-4" aria-hidden />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-xs text-glass-soft">
              <Sparkles className="w-3.5 h-3.5 text-[oklch(0.74_0.12_300)]" aria-hidden />
              <span>填好就送，沒填的會用預設值</span>
            </div>
            <div className="flex items-center gap-2">
              {request.urgency !== "blocking" && (
                <button type="button" onClick={onClose} className="healing-ghost-btn">
                  稍後回答
                </button>
              )}
              <button type="button" onClick={handleSubmit} className="healing-send-btn">
                <Send className="w-4 h-4" aria-hidden />
                送出回答
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
