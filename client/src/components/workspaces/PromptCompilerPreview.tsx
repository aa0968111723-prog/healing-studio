import { useState, useMemo } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import {
  Code,
  AlertTriangle,
  Info,
  XCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { PromptWarning } from "@/components/workspaces/PromptCompiler";
import { Button } from "@/components/ui/button";

interface PromptCompilerPreviewProps {
  compiledPrompt: string;
  warnings: PromptWarning[];
  changedFields: string[];
  summary: string;
}

const warningConfig = {
  info: { icon: Info, color: "text-blue-500", bg: "bg-blue-500/10" },
  warning: {
    icon: AlertTriangle,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
  },
  error: { icon: XCircle, color: "text-red-500", bg: "bg-red-500/10" },
} as const;

export function PromptCompilerPreview({
  compiledPrompt,
  warnings,
  changedFields,
  summary,
}: PromptCompilerPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const warningCount = useMemo(() => warnings.length, [warnings]);

  const handleCopy = async () => {
    await copyToClipboard(compiledPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-card/30 backdrop-blur-sm border border-white/50 rounded-xl p-3 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Code className="h-3.5 w-3.5 text-foreground/60" />
          <span className="text-xs font-medium text-foreground/80">
            編譯預覽
          </span>
          {warningCount > 0 && (
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 font-medium">
              {warningCount}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={copied ? "已複製" : "複製"}
          className="h-6 w-6"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-500" aria-hidden />
          ) : (
            <Copy className="h-3 w-3 text-foreground/50" aria-hidden />
          )}
        </Button>
      </div>

      {/* Summary */}
      <p className="text-[11px] text-muted-foreground leading-snug">
        {summary}
      </p>

      {/* Changed fields tags */}
      {changedFields.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {changedFields.map(field => (
            <span
              key={field}
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-700"
            >
              {field}
            </span>
          ))}
        </div>
      )}

      {/* Compiled prompt preview */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          className="w-full text-left"
        >
          <pre
            className={cn(
              "font-mono text-[11px] text-foreground/80 whitespace-pre-wrap break-words",
              !expanded && "line-clamp-2"
            )}
          >
            {compiledPrompt}
          </pre>
        </button>
        {compiledPrompt.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(prev => !prev)}
            className="mt-1 flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground/70 transition-colors"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" />
                收合
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" />
                展開
              </>
            )}
          </button>
        )}
      </div>

      {/* Warnings section */}
      {warningCount > 0 && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setWarningsOpen(prev => !prev)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground/70 transition-colors"
          >
            {warningsOpen ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            <span>警告 ({warningCount})</span>
          </button>

          <AnimatePresence>
            {warningsOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden space-y-1"
              >
                {warnings.map((warning, idx) => {
                  const config = warningConfig[warning.level];
                  const IconComponent = config.icon;
                  return (
                    <div
                      key={`${warning.level}-${warning.message}-${idx}`}
                      className={cn(
                        "text-[11px] p-2 rounded-lg flex items-start gap-1.5",
                        config.bg
                      )}
                    >
                      <IconComponent
                        className={cn(
                          "h-3.5 w-3.5 mt-px shrink-0",
                          config.color
                        )}
                      />
                      <div className="min-w-0">
                        <span className="text-foreground/80">
                          {warning.message}
                        </span>
                        {warning.field && (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            ({warning.field})
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
