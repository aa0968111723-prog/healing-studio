/**
 * OrbClarificationDialog.tsx - Interactive dialog for Orb to ask clarifying questions
 *
 * When the user's request is ambiguous, Orb can generate structured clarification
 * questions to gather more specific information before proceeding.
 */

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Sparkles, Send } from "lucide-react";
import { cn } from "@/lib/utils";

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

  // Initialize answers with defaults
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

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};

    // Validate required fields
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
          <div className="space-y-3">
            <RadioGroup
              value={value}
              onValueChange={(val) =>
                setAnswers((prev) => ({ ...prev, [question.questionId]: val }))
              }
            >
              {question.options?.map((option) => (
                <div key={option} className="flex items-center space-x-2">
                  <RadioGroupItem value={option} id={`${question.questionId}-${option}`} />
                  <Label
                    htmlFor={`${question.questionId}-${option}`}
                    className="font-normal cursor-pointer"
                  >
                    {option}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        );

      case "confirm":
        return (
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id={question.questionId}
                checked={value === true}
                onCheckedChange={(checked) =>
                  setAnswers((prev) => ({ ...prev, [question.questionId]: checked }))
                }
              />
              <Label htmlFor={question.questionId} className="font-normal cursor-pointer">
                是的，我確認
              </Label>
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        );

      case "parameter":
        if (question.min !== undefined && question.max !== undefined) {
          // Slider for numeric range
          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {question.min} {question.hint && `(${question.hint})`}
                </span>
                <span className="font-medium">{value ?? question.default ?? question.min}</span>
                <span className="text-muted-foreground">{question.max}</span>
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
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
          );
        } else {
          // Text input for general parameter
          return (
            <div className="space-y-2">
              <Input
                type="text"
                value={value ?? ""}
                onChange={(e) =>
                  setAnswers((prev) => ({ ...prev, [question.questionId]: e.target.value }))
                }
                placeholder={question.hint || "請輸入..."}
                className={cn(error && "border-red-500")}
              />
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>
          );
        }

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
              className={cn(error && "border-red-500")}
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
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
              className={cn(error && "border-red-500")}
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        );
    }
  };

  const urgencyColor = {
    blocking: "text-orange-600",
    optional: "text-blue-600",
    background: "text-gray-600",
  }[request.urgency];

  const urgencyLabel = {
    blocking: "需要回答",
    optional: "可選回答",
    background: "背景資訊",
  }[request.urgency];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-500" />
            <DialogTitle className="text-lg">
              {request.spiritName || "光球"} 需要更多資訊
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm">
            {request.context}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Urgency badge */}
          <div className="flex items-center gap-2">
            <AlertCircle className={cn("w-4 h-4", urgencyColor)} />
            <span className={cn("text-sm font-medium", urgencyColor)}>{urgencyLabel}</span>
          </div>

          {/* Questions */}
          {request.questions.map((question, index) => (
            <div key={question.questionId} className="space-y-3">
              <div className="flex items-start gap-2">
                <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                  {index + 1}
                </span>
                <div className="flex-1 space-y-2">
                  <Label className="text-base font-medium flex items-center gap-2">
                    {question.question}
                    {question.required && <span className="text-red-500">*</span>}
                  </Label>
                  {question.hint && !["parameter", "context"].includes(question.type) && (
                    <p className="text-xs text-muted-foreground">{question.hint}</p>
                  )}
                  {renderQuestionInput(question)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          {request.urgency !== "blocking" && (
            <Button variant="ghost" onClick={onClose}>
              稍後回答
            </Button>
          )}
          <Button onClick={handleSubmit} className="gap-2">
            <Send className="w-4 h-4" />
            送出回答
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
