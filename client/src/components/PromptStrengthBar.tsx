import { useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  Zap,
  Lightbulb,
  AlertTriangle,
  CheckCircle2,
  ArrowUpRight,
  Plus,
  Replace,
  ShieldMinus,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ─────────────────────────────────────────────────────────────────

type ActionableSuggestion = {
  label: string;
  actionType: "append_prompt" | "replace_prompt" | "add_negative";
  actionPayload: string;
  reason: string;
};

type EvalResult = {
  score: number;
  dimensions: {
    subjectClarity: number;
    actionNarrative: number;
    environment: number;
    lightingTone: number;
    technicalSpecs: number;
  };
  strengths: string;
  weaknesses: string;
  suggestions: ActionableSuggestion[];
  optimizedPrompt: string;
};

export type SuggestionAction = {
  actionType: "append_prompt" | "replace_prompt" | "add_negative";
  actionPayload: string;
  label: string;
};

type PromptStrengthBarProps = {
  prompt: string;
  modality: "image" | "video" | "audio" | "voice";
  onApplyOptimized?: (optimizedPrompt: string) => void;
  onApplyAction?: (action: SuggestionAction) => void;
};

// ─── Dimension Config ──────────────────────────────────────────────────────

const DIMENSIONS = [
  { key: "subjectClarity" as const, label: "主體清晰度", icon: "👤" },
  { key: "actionNarrative" as const, label: "動作與敘事", icon: "🎬" },
  { key: "environment" as const, label: "環境與場景", icon: "🌍" },
  { key: "lightingTone" as const, label: "光影與色調", icon: "💡" },
  { key: "technicalSpecs" as const, label: "技術參數", icon: "📐" },
];

// ─── Action Type Config ────────────────────────────────────────────────────

const ACTION_CONFIG = {
  append_prompt: {
    icon: Plus,
    label: "追加",
    color: "text-emerald-600",
    bgColor: "bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30",
    activeBg: "bg-emerald-500/20",
  },
  replace_prompt: {
    icon: Replace,
    label: "替換",
    color: "text-blue-600",
    bgColor: "bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/30",
    activeBg: "bg-blue-500/20",
  },
  add_negative: {
    icon: ShieldMinus,
    label: "負面詞",
    color: "text-amber-600",
    bgColor: "bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30",
    activeBg: "bg-amber-500/20",
  },
};

// ─── Score Color ───────────────────────────────────────────────────────────

function getScoreColor(score: number): string {
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-blue-600";
  if (score >= 40) return "text-amber-600";
  return "text-red-500";
}

function getScoreLabel(score: number): string {
  if (score >= 80) return "優秀";
  if (score >= 60) return "良好";
  if (score >= 40) return "一般";
  return "需改善";
}

function getScoreIcon(score: number) {
  if (score >= 80) return <CheckCircle2 className="w-3.5 h-3.5" />;
  if (score >= 60) return <Lightbulb className="w-3.5 h-3.5" />;
  return <AlertTriangle className="w-3.5 h-3.5" />;
}

// ─── Dimension Bar ─────────────────────────────────────────────────────────

function DimensionBar({
  label,
  icon,
  score,
}: {
  label: string;
  icon: string;
  score: number;
}) {
  const pct = Math.min(100, Math.max(0, score * 5));
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-5 text-center">{icon}</span>
      <span className="text-[10px] text-muted-foreground w-20 shrink-0">
        {label}
      </span>
      <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className={cn(
            "h-full rounded-full bg-gradient-to-r",
            pct >= 80
              ? "from-emerald-400 to-teal-400"
              : pct >= 60
                ? "from-blue-400 to-indigo-400"
                : pct >= 40
                  ? "from-amber-400 to-orange-400"
                  : "from-red-400 to-rose-400"
          )}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground w-6 text-right">
        {score}
      </span>
    </div>
  );
}

// ─── Actionable Chip ───────────────────────────────────────────────────────

function ActionableChip({
  suggestion,
  index,
  onApply,
}: {
  suggestion: ActionableSuggestion;
  index: number;
  onApply: (action: SuggestionAction) => void;
}) {
  const [showPayload, setShowPayload] = useState(false);
  const config = ACTION_CONFIG[suggestion.actionType];
  const Icon = config.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25, delay: index * 0.06 }}
      className="w-full"
    >
      <div
        className={cn(
          "group rounded-xl border transition-healing overflow-hidden",
          config.bgColor
        )}
      >
        {/* Main chip row */}
        <div className="flex items-center gap-2 px-3 py-2">
          {/* Action type badge */}
          <span
            className={cn(
              "shrink-0 flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md",
              config.activeBg,
              config.color
            )}
          >
            <Icon className="w-3 h-3" />
            {config.label}
          </span>

          {/* Label + reason */}
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium text-foreground/90 block truncate">
              {suggestion.label}
            </span>
            <span className="text-[10px] text-muted-foreground block truncate">
              {suggestion.reason}
            </span>
          </div>

          {/* Preview toggle */}
          <button
            onClick={e => {
              e.stopPropagation();
              setShowPayload(!showPayload);
            }}
            className="shrink-0 p-1 rounded-md hover:bg-white/20 transition-colors"
            title="預覽內容"
          >
            {showPayload ? (
              <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </button>

          {/* Apply button */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "shrink-0 h-7 text-[10px] gap-1 rounded-lg font-semibold",
              config.color,
              "hover:bg-white/30 dark:hover:bg-white/5"
            )}
            onClick={() => {
              onApply({
                actionType: suggestion.actionType,
                actionPayload: suggestion.actionPayload,
                label: suggestion.label,
              });
            }}
          >
            <ArrowUpRight className="w-3 h-3" />
            套用
          </Button>
        </div>

        {/* Expandable payload preview */}
        <AnimatePresence>
          {showPayload && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="px-3 pb-2">
                <code className="text-[10px] text-foreground/70 bg-black/5 dark:bg-white/5 rounded-md px-2 py-1 block font-mono leading-relaxed">
                  {suggestion.actionPayload}
                </code>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export function PromptStrengthBar({
  prompt,
  modality,
  onApplyOptimized,
  onApplyAction,
}: PromptStrengthBarProps) {
  const [result, setResult] = useState<EvalResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEvaluatedRef = useRef<string>("");

  const evaluateMutation = trpc.evaluate.prompt.useMutation({
    onSuccess: data => {
      setResult(data as EvalResult);
    },
  });

  // Auto-evaluate with debounce when prompt changes
  const triggerEvaluate = useCallback(() => {
    const trimmed = prompt.trim();
    if (trimmed.length < 10 || trimmed === lastEvaluatedRef.current) return;
    lastEvaluatedRef.current = trimmed;
    evaluateMutation.mutate({ prompt: trimmed, modality });
  }, [prompt, modality, evaluateMutation]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (prompt.trim().length >= 10) {
      debounceRef.current = setTimeout(triggerEvaluate, 2000);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [prompt, triggerEvaluate]);

  const handleApplyAction = useCallback(
    (action: SuggestionAction) => {
      if (onApplyAction) {
        onApplyAction(action);
      } else if (onApplyOptimized) {
        // Fallback: just append or replace via the old callback
        if (action.actionType === "replace_prompt") {
          onApplyOptimized(action.actionPayload);
        } else {
          onApplyOptimized(prompt.trim() + ", " + action.actionPayload);
        }
      }
      toast.success(`已套用：${action.label}`, {
        description:
          action.actionType === "append_prompt"
            ? "已追加至提示詞"
            : action.actionType === "replace_prompt"
              ? "已替換提示詞"
              : "已加入負面提示詞",
      });
    },
    [onApplyAction, onApplyOptimized, prompt]
  );

  // No prompt yet
  if (prompt.trim().length < 10 && !result) {
    return null;
  }

  return (
    <div className="space-y-2">
      {/* Score Bar */}
      <div className="flex items-center gap-3">
        {/* Score Circle */}
        <div className="relative">
          <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-muted/20"
            />
            <motion.circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke="url(#scoreGrad)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${(result?.score || 0) * 0.942} 94.2`}
              initial={{ strokeDasharray: "0 94.2" }}
              animate={{
                strokeDasharray: `${(result?.score || 0) * 0.942} 94.2`,
              }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
            <defs>
              <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop
                  offset="0%"
                  className={cn(
                    result && result.score >= 60
                      ? "text-emerald-500"
                      : "text-amber-500"
                  )}
                  stopColor="currentColor"
                />
                <stop
                  offset="100%"
                  className={cn(
                    result && result.score >= 60
                      ? "text-teal-500"
                      : "text-orange-500"
                  )}
                  stopColor="currentColor"
                />
              </linearGradient>
            </defs>
          </svg>
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums",
              result ? getScoreColor(result.score) : "text-muted-foreground"
            )}
          >
            {evaluateMutation.isPending ? "..." : (result?.score ?? "—")}
          </span>
        </div>

        {/* Score Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {result && getScoreIcon(result.score)}
            <span
              className={cn(
                "text-xs font-semibold",
                result ? getScoreColor(result.score) : "text-muted-foreground"
              )}
            >
              {evaluateMutation.isPending
                ? "分析中..."
                : result
                  ? `提示詞強度：${getScoreLabel(result.score)}`
                  : "等待輸入..."}
            </span>
          </div>
          {result && (
            <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
              {result.strengths}
            </p>
          )}
        </div>

        {/* Expand Toggle */}
        {result && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg hover:bg-muted/30 transition-colors"
          >
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        )}

        {/* Re-evaluate Button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[10px] gap-1 rounded-lg"
          onClick={triggerEvaluate}
          disabled={evaluateMutation.isPending || prompt.trim().length < 10}
        >
          <Zap className="w-3 h-3" />
          評估
        </Button>
      </div>

      {/* Expanded Details */}
      <AnimatePresence>
        {expanded && result && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-border/40 bg-white/30 p-3.5 space-y-3">
              {/* Dimension Bars */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  五維評估
                </span>
                {DIMENSIONS.map(d => (
                  <DimensionBar
                    key={d.key}
                    label={d.label}
                    icon={d.icon}
                    score={result.dimensions[d.key]}
                  />
                ))}
              </div>

              {/* Weaknesses */}
              {result.weaknesses && (
                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-amber-500" />
                    不足之處
                  </span>
                  <p className="text-xs text-foreground/80 mt-1 leading-relaxed">
                    {result.weaknesses}
                  </p>
                </div>
              )}

              {/* Actionable Suggestion Chips */}
              {result.suggestions && result.suggestions.length > 0 && (
                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1 mb-2">
                    <Lightbulb className="w-3 h-3 text-blue-500" />
                    一鍵優化建議
                  </span>
                  <div className="space-y-1.5">
                    {result.suggestions.map((s, i) => (
                      <ActionableChip
                        key={i}
                        suggestion={s}
                        index={i}
                        onApply={handleApplyAction}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Optimized Prompt */}
              {result.optimizedPrompt && onApplyOptimized && (
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-primary" />
                      AI 優化版本
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] gap-1 rounded-lg text-primary"
                      onClick={() => onApplyOptimized(result.optimizedPrompt)}
                    >
                      <ArrowUpRight className="w-3 h-3" />
                      套用
                    </Button>
                  </div>
                  <p className="text-xs text-foreground/70 mt-1 leading-relaxed bg-muted/10 rounded-lg p-2 border border-border/20">
                    {result.optimizedPrompt}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
