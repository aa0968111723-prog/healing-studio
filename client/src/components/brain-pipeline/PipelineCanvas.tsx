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

const nodeTypes: NodeTypes = {
  pipelineNode: PipelineNodeCard,
};

const EDGE_COLOR: Record<PipelineNodeStatus, string> = {
  healthy: "#10b981",
  needs_optimization: "#eab308",
  broken: "#ef4444",
  abnormal: "#f97316",
};

interface Props {
  graph: PipelineGraph;
  expandPageGroup?: boolean;
}

export function PipelineCanvas({ graph, expandPageGroup = false }: Props) {
  const [selectedNode, setSelectedNode] = useState<PipelineNode | null>(null);
  const [groupExpanded, setGroupExpanded] = useState(expandPageGroup);

  // Filter out individual page nodes when group is collapsed
  const visibleNodes = useMemo(() => {
    if (groupExpanded) return graph.nodes;
    return graph.nodes.filter(n => n.kind !== "page");
  }, [graph.nodes, groupExpanded]);

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
