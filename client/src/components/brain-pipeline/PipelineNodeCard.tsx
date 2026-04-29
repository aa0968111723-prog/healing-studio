import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type {
  PipelineNode,
  PipelineNodeStatus,
} from "@shared/brain-pipeline";

const STATUS_RING: Record<PipelineNodeStatus, string> = {
  healthy: "ring-emerald-400/70 bg-emerald-50/80 dark:bg-emerald-950/50",
  needs_optimization: "ring-yellow-400/70 bg-yellow-50/80 dark:bg-yellow-950/50",
  broken: "ring-red-400/70 bg-red-50/80 dark:bg-red-950/50",
  abnormal: "ring-orange-400/70 bg-orange-50/80 dark:bg-orange-950/50",
};

const STATUS_DOT: Record<PipelineNodeStatus, string> = {
  healthy: "bg-emerald-500",
  needs_optimization: "bg-yellow-500",
  broken: "bg-red-500",
  abnormal: "bg-orange-500",
};

const KIND_ICON: Record<PipelineNode["kind"], string> = {
  page: "📄",
  "page-group": "📱",
  router: "🔌",
  "brain-slot": "🧠",
  "engine-slot": "⚙️",
  "orb-agent": "🌐",
  "orb-assistant": "💫",
  director: "🎬",
  provider: "☁️",
};

export type PipelineNodeData = {
  node: PipelineNode;
};

function PipelineNodeCardImpl({ data, selected }: NodeProps) {
  const { node } = data as PipelineNodeData;
  return (
    <div
      className={cn(
        "rounded-2xl px-3 py-2 ring-2 shadow-md backdrop-blur transition-all",
        "min-w-[200px] max-w-[240px] cursor-pointer hover:scale-[1.02]",
        STATUS_RING[node.status],
        selected && "ring-4 scale-[1.03]"
      )}
      data-testid={`pipeline-node-${node.id}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />
      <div className="flex items-center gap-2 mb-1">
        <span aria-hidden className="text-lg leading-none">
          {KIND_ICON[node.kind] ?? "•"}
        </span>
        <span className="font-medium text-sm truncate flex-1 text-slate-900 dark:text-slate-100">
          {node.label}
        </span>
        <span
          aria-label={`狀態：${node.status}`}
          className={cn("h-2.5 w-2.5 rounded-full shrink-0", STATUS_DOT[node.status])}
        />
      </div>
      {node.description && (
        <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-400 line-clamp-2">
          {node.description}
        </p>
      )}
      {node.reason && node.status !== "healthy" && (
        <p className="text-[11px] mt-1 text-slate-700 dark:text-slate-300 line-clamp-2 italic">
          ⚠ {node.reason}
        </p>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
    </div>
  );
}

export const PipelineNodeCard = memo(PipelineNodeCardImpl);
