import React, { useState, useMemo } from "react";
import type {
  VersionEntry,
  PromptStrengthLevel,
} from "@/stores/workspaceStore";
import { cn } from "@/lib/utils";
import {
  Clock,
  Pin,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  GitBranch,
  RefreshCw,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

// ─── Props ──────────────────────────────────────────────────────────────────────

interface VersionHistoryPanelProps {
  versions: VersionEntry[];
  onPin: (versionId: string) => void;
  onRestore: (versionId: string) => void;
  pinnedVersionId: string | null;
}

// ─── Metadata ───────────────────────────────────────────────────────────────────

const actionModeConfig: Record<
  VersionEntry["actionMode"],
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    colorClass: string;
  }
> = {
  generate: {
    label: "Generate",
    icon: Sparkles,
    colorClass: "bg-emerald-500/20 text-emerald-300 border-emerald-400/30",
  },
  refine: {
    label: "Refine",
    icon: RefreshCw,
    colorClass: "bg-blue-500/20 text-blue-300 border-blue-400/30",
  },
  branch: {
    label: "Branch",
    icon: GitBranch,
    colorClass: "bg-violet-500/20 text-violet-300 border-violet-400/30",
  },
};

const strengthLabels: Record<PromptStrengthLevel, string> = {
  low: "低",
  medium: "中",
  high: "高",
  locked: "鎖定",
};

const strengthColors: Record<PromptStrengthLevel, string> = {
  low: "bg-muted/20 text-muted-foreground/70",
  medium: "bg-amber-400/20 text-amber-300",
  high: "bg-orange-500/20 text-orange-300",
  locked: "bg-red-500/20 text-red-300",
};

const modalityEmoji: Record<VersionEntry["modality"], string> = {
  image: "🖼️",
  video: "🎬",
  music: "🎵",
  voice: "🎙️",
};

// ─── Diff Helpers ───────────────────────────────────────────────────────────────

interface DiffLine {
  type: "added" | "removed" | "unchanged";
  text: string;
}

function computeSimpleDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: DiffLine[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (oldLine === newLine) {
      result.push({ type: "unchanged", text: oldLine ?? "" });
    } else {
      if (oldLine !== undefined) {
        result.push({ type: "removed", text: oldLine });
      }
      if (newLine !== undefined) {
        result.push({ type: "added", text: newLine });
      }
    }
  }
  return result;
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const lines = useMemo(
    () => computeSimpleDiff(oldText, newText),
    [oldText, newText]
  );

  return (
    <div className="mt-2 rounded-lg bg-black/20 p-2 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-48 overflow-y-auto">
      {lines.map((line, idx) => (
        <div
          key={idx}
          className={cn(
            "px-1.5 py-0.5 rounded-sm",
            line.type === "added" && "bg-emerald-500/15 text-emerald-300",
            line.type === "removed" &&
              "bg-red-500/15 text-red-300 line-through",
            line.type === "unchanged" && "text-white/50"
          )}
        >
          <span className="mr-2 select-none opacity-50">
            {line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}
          </span>
          {line.text || "\u00A0"}
        </div>
      ))}
    </div>
  );
}

function VersionCard({
  version,
  isPinned,
  previousVersion,
  onPin,
  onRestore,
}: {
  version: VersionEntry;
  isPinned: boolean;
  previousVersion: VersionEntry | undefined;
  onPin: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const mode = actionModeConfig[version.actionMode];
  const ModeIcon = mode.icon;

  const truncatedPrompt =
    version.compiledPrompt.length > 60
      ? `${version.compiledPrompt.slice(0, 60)}…`
      : version.compiledPrompt;

  const strengthChanged =
    previousVersion !== undefined &&
    previousVersion.promptStrength !== version.promptStrength;

  const settingsEntries = Object.entries(version.generationSettings);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "bg-white/30 rounded-xl border border-white/40 p-3 backdrop-blur-sm",
        "cursor-pointer transition-colors hover:bg-white/40",
        isPinned && "ring-1 ring-amber-400/50"
      )}
      onClick={() => setExpanded(v => !v)}
    >
      {/* Top row: timestamp + action badge + modality */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] text-white/50 shrink-0">
            {new Date(version.timestamp).toLocaleString()}
          </span>
          <span className="text-sm" title={version.modality}>
            {modalityEmoji[version.modality]}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
              mode.colorClass
            )}
          >
            <ModeIcon className="size-3" />
            {mode.label}
          </span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
              strengthColors[version.promptStrength]
            )}
          >
            {strengthLabels[version.promptStrength]}
          </span>
        </div>
      </div>

      {/* Compiled prompt preview */}
      <p className="mt-1.5 text-xs text-white/70 leading-snug truncate">
        {truncatedPrompt || "（空白提示詞）"}
      </p>

      {/* Changed fields tags */}
      {version.changedFields.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {version.changedFields.map(field => (
            <span
              key={field}
              className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60"
            >
              {field}
            </span>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6"
            onClick={e => {
              e.stopPropagation();
              onPin(version.id);
            }}
            title={isPinned ? "取消釘選" : "釘選版本"}
          >
            <Pin
              className={cn(
                "size-3.5",
                isPinned ? "fill-amber-400 text-amber-400" : "text-white/50"
              )}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6"
            onClick={e => {
              e.stopPropagation();
              onRestore(version.id);
            }}
            title="還原至此版本"
          >
            <RotateCcw className="size-3.5 text-white/50" />
          </Button>
        </div>

        {expanded ? (
          <ChevronUp className="size-3.5 text-white/40" />
        ) : (
          <ChevronDown className="size-3.5 text-white/40" />
        )}
      </div>

      {/* Expanded detail panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-2 border-t border-white/20 pt-2">
              {/* Full compiled prompt */}
              <div>
                <span className="text-[10px] font-medium text-white/50 uppercase tracking-wider">
                  完整提示詞
                </span>
                <p className="mt-0.5 text-xs text-white/80 whitespace-pre-wrap leading-relaxed">
                  {version.compiledPrompt || "（無）"}
                </p>
              </div>

              {/* Changed blocks summary */}
              {version.blocks.length > 0 && (
                <div>
                  <span className="text-[10px] font-medium text-white/50 uppercase tracking-wider">
                    結構化區塊
                  </span>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {version.blocks
                      .filter(b => b.enabled)
                      .map(block => (
                        <span
                          key={block.id}
                          className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60"
                        >
                          {block.label}: {block.value.slice(0, 30)}
                          {block.value.length > 30 ? "…" : ""}
                        </span>
                      ))}
                  </div>
                </div>
              )}

              {/* Prompt strength change */}
              {strengthChanged && previousVersion && (
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-white/50">提示詞強度</span>
                  <span
                    className={cn(
                      "rounded px-1 py-0.5",
                      strengthColors[previousVersion.promptStrength]
                    )}
                  >
                    {strengthLabels[previousVersion.promptStrength]}
                  </span>
                  <ArrowRight className="size-3 text-white/40" />
                  <span
                    className={cn(
                      "rounded px-1 py-0.5",
                      strengthColors[version.promptStrength]
                    )}
                  >
                    {strengthLabels[version.promptStrength]}
                  </span>
                </div>
              )}

              {/* Reference changes */}
              {version.references.length > 0 && (
                <div>
                  <span className="text-[10px] font-medium text-white/50 uppercase tracking-wider">
                    參考素材
                  </span>
                  <div className="mt-0.5 space-y-0.5">
                    {version.references.map(ref => (
                      <div
                        key={ref.id}
                        className="flex items-center gap-1.5 text-[10px] text-white/60"
                      >
                        <span className="rounded bg-white/10 px-1 py-0.5">
                          {ref.type}
                        </span>
                        <span className="truncate">{ref.purpose}</span>
                        <span className="text-white/30">w:{ref.weight}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Generation settings summary */}
              {settingsEntries.length > 0 && (
                <div>
                  <span className="text-[10px] font-medium text-white/50 uppercase tracking-wider">
                    生成設定
                  </span>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {settingsEntries.map(([key, value]) => (
                      <span
                        key={key}
                        className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60"
                      >
                        {key}: {String(value)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Diff view against previous version */}
              {previousVersion && (
                <div>
                  <span className="text-[10px] font-medium text-white/50 uppercase tracking-wider">
                    與前一版本差異
                  </span>
                  <DiffView
                    oldText={previousVersion.compiledPrompt}
                    newText={version.compiledPrompt}
                  />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export function VersionHistoryPanel({
  versions,
  onPin,
  onRestore,
  pinnedVersionId,
}: VersionHistoryPanelProps) {
  const sortedVersions = useMemo(
    () => [...versions].sort((a, b) => b.timestamp - a.timestamp),
    [versions]
  );

  // Build a map from version id → its chronologically previous version
  const previousVersionMap = useMemo(() => {
    const chronological = [...versions].sort(
      (a, b) => a.timestamp - b.timestamp
    );
    const map = new Map<string, VersionEntry>();
    for (let i = 1; i < chronological.length; i++) {
      map.set(chronological[i].id, chronological[i - 1]);
    }
    return map;
  }, [versions]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-2">
        <div className="flex items-center gap-1.5">
          <Clock className="size-4 text-white/60" />
          <span className="text-sm font-medium text-white/80">版本歷史</span>
        </div>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/50">
          {versions.length}
        </span>
      </div>

      {/* Version list */}
      {sortedVersions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 py-8 text-center">
          <p className="text-xs text-white/40 leading-relaxed">
            尚無版本紀錄，開始創作後版本將自動保存
          </p>
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto pr-1">
          <AnimatePresence initial={false}>
            {sortedVersions.map(version => (
              <VersionCard
                key={version.id}
                version={version}
                isPinned={pinnedVersionId === version.id}
                previousVersion={previousVersionMap.get(version.id)}
                onPin={onPin}
                onRestore={onRestore}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
