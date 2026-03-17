import { useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  Sparkles, ChevronDown, ChevronUp, Zap, Lightbulb,
  AlertTriangle, CheckCircle2, ArrowUpRight,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

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
  suggestions: string[];
  optimizedPrompt: string;
};

type PromptStrengthBarProps = {
  prompt: string;
  modality: "image" | "video" | "audio" | "voice";
  onApplyOptimized?: (optimizedPrompt: string) => void;
};

// ─── Dimension Config ──────────────────────────────────────────────────────

const DIMENSIONS = [
  { key: "subjectClarity" as const, label: "主體清晰度", icon: "👤" },
  { key: "actionNarrative" as const, label: "動作與敘事", icon: "🎬" },
  { key: "environment" as const, label: "環境與場景", icon: "🌍" },
  { key: "lightingTone" as const, label: "光影與色調", icon: "💡" },
  { key: "technicalSpecs" as const, label: "技術參數", icon: "📐" },
];

// ─── Score Color ───────────────────────────────────────────────────────────

function getScoreColor(score: number): string {
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-blue-600";
  if (score >= 40) return "text-amber-600";
  return "text-red-500";
}

function getScoreGradient(score: number): string {
  if (score >= 80) return "from-emerald-500 to-teal-500";
  if (score >= 60) return "from-blue-500 to-indigo-500";
  if (score >= 40) return "from-amber-500 to-orange-500";
  return "from-red-500 to-rose-500";
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
  if (score >= 40) return <AlertTriangle className="w-3.5 h-3.5" />;
  return <AlertTriangle className="w-3.5 h-3.5" />;
}

// ─── Dimension Bar ─────────────────────────────────────────────────────────

function DimensionBar({ label, icon, score }: { label: string; icon: string; score: number }) {
  const pct = Math.min(100, Math.max(0, score * 5)); // 0-20 → 0-100%
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-5 text-center">{icon}</span>
      <span className="text-[10px] text-muted-foreground w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className={cn(
            "h-full rounded-full bg-gradient-to-r",
            pct >= 80 ? "from-emerald-400 to-teal-400" :
            pct >= 60 ? "from-blue-400 to-indigo-400" :
            pct >= 40 ? "from-amber-400 to-orange-400" :
            "from-red-400 to-rose-400",
          )}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground w-6 text-right">
        {score}
      </span>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export function PromptStrengthBar({ prompt, modality, onApplyOptimized }: PromptStrengthBarProps) {
  const [result, setResult] = useState<EvalResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEvaluatedRef = useRef<string>("");

  const evaluateMutation = trpc.evaluate.prompt.useMutation({
    onSuccess: (data) => {
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
              cx="18" cy="18" r="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-muted/20"
            />
            <motion.circle
              cx="18" cy="18" r="15"
              fill="none"
              stroke="url(#scoreGrad)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${(result?.score || 0) * 0.942} 94.2`}
              initial={{ strokeDasharray: "0 94.2" }}
              animate={{ strokeDasharray: `${(result?.score || 0) * 0.942} 94.2` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
            <defs>
              <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" className={cn(
                  result && result.score >= 60 ? "text-emerald-500" : "text-amber-500"
                )} stopColor="currentColor" />
                <stop offset="100%" className={cn(
                  result && result.score >= 60 ? "text-teal-500" : "text-orange-500"
                )} stopColor="currentColor" />
              </linearGradient>
            </defs>
          </svg>
          <span className={cn(
            "absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums",
            result ? getScoreColor(result.score) : "text-muted-foreground",
          )}>
            {evaluateMutation.isPending ? "..." : (result?.score ?? "—")}
          </span>
        </div>

        {/* Score Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {result && getScoreIcon(result.score)}
            <span className={cn(
              "text-xs font-semibold",
              result ? getScoreColor(result.score) : "text-muted-foreground",
            )}>
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
                {DIMENSIONS.map((d) => (
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

              {/* Suggestions as clickable chips */}
              {result.suggestions && result.suggestions.length > 0 && (
                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Lightbulb className="w-3 h-3 text-blue-500" />
                    優化建議（點擊套用）
                  </span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {result.suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => onApplyOptimized?.(s)}
                        className="text-xs text-foreground/80 px-2.5 py-1 rounded-lg bg-muted/20 border border-border/30 hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-all cursor-pointer flex items-center gap-1.5 group"
                      >
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 group-hover:text-primary/60">
                          {i + 1}.
                        </span>
                        <span className="line-clamp-1">{s}</span>
                        <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </button>
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
