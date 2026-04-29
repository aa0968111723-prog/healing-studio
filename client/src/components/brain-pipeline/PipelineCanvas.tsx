import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type {
  PipelineGraph,
  PipelineNode,
  PipelineNodeStatus,
} from "@shared/brain-pipeline";
import { PipelineNodeCard, type PipelineNodeData } from "./PipelineNodeCard";
import { useDagreLayout } from "./useDagreLayout";
import { NodeDetailSheet } from "./NodeDetailSheet";
import { Legend } from "./Legend";
import type { StatusFilter } from "./SummaryBar";

const nodeTypes: NodeTypes = {
  pipelineNode: PipelineNodeCard,
};

const EDGE_COLOR: Record<PipelineNodeStatus, string> = {
  healthy: "#10b981",
  needs_optimization: "#eab308",
  broken: "#ef4444",
  abnormal: "#f97316",
};

const ISSUE_STATUSES: ReadonlySet<PipelineNodeStatus> = new Set<PipelineNodeStatus>([
  "needs_optimization",
  "broken",
  "abnormal",
]);

interface Props {
  graph: PipelineGraph;
  expandPageGroup?: boolean;
  /** 由 SummaryBar 控制的狀態篩選；不傳就顯示全部。 */
  statusFilter?: StatusFilter;
}

export function PipelineCanvas({
  graph,
  expandPageGroup = false,
  statusFilter = "all",
}: Props) {
  const [selectedNode, setSelectedNode] = useState<PipelineNode | null>(null);
  const [groupExpanded, setGroupExpanded] = useState(expandPageGroup);

  // 先依 page-group 折疊規則過濾，再套用 status filter。
  // 篩選時保留：被選中的節點本身、page-group 容器（避免變空圖）。
  const visibleNodes = useMemo(() => {
    const base = groupExpanded
      ? graph.nodes
      : graph.nodes.filter(n => n.kind !== "page");
    if (statusFilter === "all") return base;
    return base.filter(n => {
      if (n.kind === "page-group") return true;
      if (statusFilter === "issues") return ISSUE_STATUSES.has(n.status);
      return n.status === statusFilter;
    });
  }, [graph.nodes, groupExpanded, statusFilter]);

  // 一次走訪建出 Set + status 表，避免 visibleEdges/rfEdges 各自掃一輪
  const { visibleIdSet, statusById } = useMemo(() => {
    const ids = new Set<string>();
    const status = new Map<string, PipelineNodeStatus>();
    for (const n of visibleNodes) {
      ids.add(n.id);
      status.set(n.id, n.status);
    }
    return { visibleIdSet: ids, statusById: status };
  }, [visibleNodes]);

  const visibleEdges = useMemo(
    () =>
      graph.edges.filter(
        e => visibleIdSet.has(e.source) && visibleIdSet.has(e.target)
      ),
    [graph.edges, visibleIdSet]
  );

  // Map domain nodes → React Flow nodes
  const rfNodes: Node[] = useMemo(
    () =>
      visibleNodes.map(node => ({
        id: node.id,
        type: "pipelineNode",
        data: { node } as PipelineNodeData,
        position: { x: 0, y: 0 }, // overwritten by dagre
      })),
    [visibleNodes]
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      visibleEdges.map(e => {
        const status = statusById.get(e.source) ?? "healthy";
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          animated: status === "needs_optimization" || status === "broken",
          style: {
            stroke: EDGE_COLOR[status],
            strokeWidth: 1.5,
            strokeDasharray: e.style === "dashed" ? "6 3" : undefined,
          },
          labelStyle: { fontSize: 10 },
        };
      }),
    [visibleEdges, statusById]
  );

  const { layoutedNodes, layoutedEdges } = useDagreLayout(
    rfNodes,
    rfEdges,
    "TB"
  );

  const handleNodeClick = useCallback(
    (_: unknown, rfNode: Node) => {
      const data = rfNode.data as PipelineNodeData;
      const node = data.node;
      if (node.kind === "page-group") {
        setGroupExpanded(prev => !prev);
        return;
      }
      setSelectedNode(node);
    },
    []
  );

  return (
    <div className="relative w-full h-full">
      <ReactFlow
        nodes={layoutedNodes}
        edges={layoutedEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-white/80 dark:!bg-slate-900/80" />
      </ReactFlow>

      <Legend legend={graph.legend} />

      {statusFilter !== "all" && layoutedNodes.length === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="rounded-xl bg-white/90 dark:bg-slate-900/90 backdrop-blur border px-4 py-3 text-sm shadow text-slate-600 dark:text-slate-300 pointer-events-auto">
            🎉 此狀態下沒有節點，全部健康。
          </div>
        </div>
      )}

      {!groupExpanded && graph.nodes.some(n => n.kind === "page-group") && (
        <div className="absolute top-4 left-4 z-10 rounded-lg bg-white/90 dark:bg-slate-900/90 backdrop-blur border px-3 py-1.5 text-xs shadow">
          💡 點擊「📱 前端頁面」群組可展開查看每頁的助手狀態
        </div>
      )}

      <NodeDetailSheet
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
      />
    </div>
  );
}
