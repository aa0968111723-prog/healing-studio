/**
 * OrbWorkflowDAG.tsx — Workflow execution visualized as a flowing graph.
 *
 * Existing `WorkflowExecutionFloatingPanel` shows the steps as a bullet list.
 * For longer workflows (5+ steps that hop between studios) the linear list
 * loses the spatial sense of "we're in the middle of a 9-step quest".
 *
 * This component renders the same `WorkflowExecutionState` as a vertical
 * chain of nodes via @xyflow/react, with:
 *   - pending nodes faded
 *   - running node pulsing cyan
 *   - completed nodes solid green with checkmark
 *   - failed nodes red with X icon
 *   - edges animated forward when both endpoints are completed
 *
 * Pure visual — no DOM events besides hover. The list view stays the
 * primary entry point; users opt into this when steps > 4 or via a toggle.
 */

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  type Edge,
  type Node,
  type NodeProps,
  Position,
  Handle,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Check, Clock, Loader2, X, MapPin } from "lucide-react";
import type {
  WorkflowExecutionState,
  WorkflowExecutionStepState,
  WorkflowExecutionStepStatus,
} from "@/contexts/GlobalOrbChatContext";

interface NodeData extends Record<string, unknown> {
  label: string;
  index: number;
  total: number;
  status: WorkflowExecutionStepStatus;
  path?: string;
  actionType?: string;
}

const STATUS_TONE: Record<
  WorkflowExecutionStepStatus,
  { ring: string; bg: string; text: string; icon: typeof Check }
> = {
  pending: {
    ring: "ring-1 ring-border/40",
    bg: "bg-muted/70",
    text: "text-muted-foreground/70",
    icon: Clock,
  },
  running: {
    ring: "ring-2 ring-cyan-300",
    bg: "bg-cyan-500/30",
    text: "text-cyan-50",
    icon: Loader2,
  },
  completed: {
    ring: "ring-1 ring-emerald-300/70",
    bg: "bg-emerald-500/30",
    text: "text-emerald-50",
    icon: Check,
  },
  failed: {
    ring: "ring-2 ring-rose-300",
    bg: "bg-rose-500/30",
    text: "text-rose-50",
    icon: X,
  },
};

function StepNode({ data }: NodeProps<Node<NodeData>>) {
  const tone = STATUS_TONE[data.status];
  const Icon = tone.icon;
  const spinning = data.status === "running";
  return (
    <div
      data-testid="orb-workflow-dag-node"
      data-status={data.status}
      className={`group rounded-2xl px-3 py-2 ${tone.bg} ${tone.ring} backdrop-blur-md transition-all`}
      style={{
        minWidth: 220,
        boxShadow:
          data.status === "running"
            ? "0 0 24px rgba(34, 211, 238, 0.45)"
            : data.status === "failed"
            ? "0 0 16px rgba(244, 114, 128, 0.35)"
            : data.status === "completed"
            ? "0 0 14px rgba(52, 211, 153, 0.3)"
            : "none",
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-white/30 !border-0" />
      <div className="flex items-start gap-2">
        <span
          className={`shrink-0 mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-md ${tone.bg} ${tone.text}`}
        >
          <Icon className={`w-3.5 h-3.5 ${spinning ? "animate-spin" : ""}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-white/60">
              {data.index + 1}/{data.total}
            </span>
            {data.path ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] text-white/70">
                <MapPin className="w-2.5 h-2.5" />
                {data.path}
              </span>
            ) : null}
          </div>
          <div className={`mt-0.5 text-xs font-medium ${tone.text}`}>{data.label}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-white/30 !border-0" />
    </div>
  );
}

const nodeTypes = { step: StepNode };

interface Props {
  workflowExecution: WorkflowExecutionState;
  /** Compact = lower visual height, used inside floating panel. */
  compact?: boolean;
}

function OrbWorkflowDAGInner({ workflowExecution, compact }: Props) {
  const { nodes, edges } = useMemo(() => {
    const ySpacing = compact ? 64 : 88;
    const builtNodes: Node<NodeData>[] = workflowExecution.steps.map(
      (step: WorkflowExecutionStepState) => ({
        id: `step-${step.index}`,
        type: "step",
        position: { x: 0, y: step.index * ySpacing },
        data: {
          label: step.label,
          index: step.index,
          total: workflowExecution.total,
          status: step.status,
          path: step.path,
          actionType: step.actionType,
        },
        draggable: false,
        selectable: false,
      })
    );
    const builtEdges: Edge[] = [];
    for (let i = 1; i < workflowExecution.steps.length; i += 1) {
      const prev = workflowExecution.steps[i - 1];
      const cur = workflowExecution.steps[i];
      const flowing = prev.status === "completed" && cur.status === "running";
      const done = prev.status === "completed" && cur.status === "completed";
      const failed = cur.status === "failed";
      builtEdges.push({
        id: `edge-${i - 1}-${i}`,
        source: `step-${i - 1}`,
        target: `step-${i}`,
        animated: flowing,
        style: {
          stroke: failed
            ? "#fb7185"
            : done
            ? "#34d399"
            : flowing
            ? "#22d3ee"
            : "rgba(255,255,255,0.2)",
          strokeWidth: flowing || done || failed ? 2 : 1.2,
        },
      });
    }
    return { nodes: builtNodes, edges: builtEdges };
  }, [workflowExecution, compact]);

  const height = compact
    ? Math.min(360, 96 + workflowExecution.steps.length * 64)
    : 480;

  return (
    <div
      className="rounded-2xl border border-white/10 bg-muted/40 overflow-hidden"
      style={{ height }}
      data-testid="orb-workflow-dag"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1, minZoom: 0.4 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnScroll={false}
        zoomOnDoubleClick={false}
        panOnDrag
        minZoom={0.3}
        maxZoom={1.4}
      >
        <Background gap={16} size={1} color="rgba(255,255,255,0.08)" />
      </ReactFlow>
    </div>
  );
}

export default function OrbWorkflowDAG(props: Props) {
  return (
    <ReactFlowProvider>
      <OrbWorkflowDAGInner {...props} />
    </ReactFlowProvider>
  );
}
