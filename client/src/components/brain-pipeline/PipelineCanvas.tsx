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
  PipelineNodeKind,
  PipelineNodeStatus,
} from "@shared/brain-pipeline";
import { PipelineNodeCard, type PipelineNodeData } from "./PipelineNodeCard";
import { useDagreLayout } from "./useDagreLayout";
import { NodeDetailSheet } from "./NodeDetailSheet";
import { Legend } from "./Legend";
import type { StatusFilter, ViewMode } from "./SummaryBar";

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

/**
 * 視圖模式對應的可見 kind 集合。
 * - site：純站點關係圖（page + page-group），用於「全站關係圖」場景
 * - brain：原本的 admin 監控視圖，隱藏 frontend 節點
 * - full：六層完整圖（browser → page → api/router → brain/engine → provider → infra/data）
 * - infra：對主管 / 新成員的「網站如何運作」視圖（強調 client / api / data / infrastructure）
 */
const VIEW_MODE_KINDS: Record<ViewMode, ReadonlySet<PipelineNodeKind>> = {
  site: new Set<PipelineNodeKind>(["page", "page-group", "studio"]),
  brain: new Set<PipelineNodeKind>([
    "router",
    "brain-slot",
    "engine-slot",
    "orb-agent",
    "orb-assistant",
    "director",
    "studio",
    "provider",
    "service",
    // 「我的腦組態」也想看 LangSmith / DB 對應（讓 AI 路徑完整）
    "observability",
    "vector-store",
    "search-provider",
  ]),
  full: new Set<PipelineNodeKind>([
    "browser",
    "page",
    "page-group",
    "api-endpoint",
    "webhook",
    "websocket",
    "middleware",
    "service",
    "repository",
    "router",
    "brain-slot",
    "engine-slot",
    "orb-agent",
    "orb-assistant",
    "director",
    "studio",
    "provider",
    "database",
    "db-table",
    "storage",
    "vector-store",
    "search-provider",
    "cron-job",
    "build-artifact",
    "eval-runner",
    "deployment",
    "observability",
    "auth-provider",
    "notification",
    "payment",
  ]),
  infra: new Set<PipelineNodeKind>([
    "browser",
    "page-group",
    "api-endpoint",
    "webhook",
    "websocket",
    "middleware",
    "database",
    "storage",
    "vector-store",
    "search-provider",
    "cron-job",
    "build-artifact",
    "deployment",
    "observability",
    "auth-provider",
    "notification",
    "payment",
    "provider",
    "studio",
  ]),
  data: new Set<PipelineNodeKind>([
    "router",
    "service",
    "repository",
    "database",
    "db-table",
    "storage",
    "vector-store",
    "cron-job",
  ]),
};

interface Props {
  graph: PipelineGraph;
  expandPageGroup?: boolean;
  /** 由 SummaryBar 控制的狀態篩選；不傳就顯示全部。 */
  statusFilter?: StatusFilter;
  /** 視圖模式；不傳預設為 brain（向後相容 MyBrainPage 等舊呼叫端） */
  viewMode?: ViewMode;
}

export function PipelineCanvas({
  graph,
  expandPageGroup = false,
  statusFilter = "all",
  viewMode = "brain",
}: Props) {
  const [selectedNode, setSelectedNode] = useState<PipelineNode | null>(null);
  const [groupExpanded, setGroupExpanded] = useState(expandPageGroup);

  // 過濾順序：viewMode → 群組折疊（page-group / database）→ status filter。
  // page-group / database 容器本身不被 status 篩走，避免變空圖。
  const visibleNodes = useMemo(() => {
    const allowedKinds = VIEW_MODE_KINDS[viewMode];
    let base = graph.nodes.filter(n => allowedKinds.has(n.kind));
    // 折疊時：full 視圖隱藏 page；data / full 視圖隱藏 db-table（保留 db:main bubble）
    if (!groupExpanded) {
      if (viewMode === "full") {
        base = base.filter(n => n.kind !== "page" && n.kind !== "db-table");
      } else if (viewMode === "data") {
        base = base.filter(n => n.kind !== "db-table");
      }
    }
    if (statusFilter === "all") return base;
    return base.filter(n => {
      if (n.kind === "page-group" || n.kind === "database") return true;
      if (statusFilter === "issues") return ISSUE_STATUSES.has(n.status);
      return n.status === statusFilter;
    });
  }, [graph.nodes, groupExpanded, statusFilter, viewMode]);

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
      // page-group 與 database（含 children 的容器）— 點擊切換展開/折疊
      if (
        node.kind === "page-group" ||
        (node.kind === "database" && node.children && node.children.length > 0)
      ) {
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
          <div className="rounded-xl bg-white/90 dark:bg-slate-900/90 backdrop-blur border px-4 py-3 text-sm shadow text-foreground/90 pointer-events-auto">
            🎉 此狀態下沒有節點，全部健康。
          </div>
        </div>
      )}

      {viewMode === "full" &&
        !groupExpanded &&
        graph.nodes.some(n => n.kind === "page-group") && (
          <div className="absolute top-4 left-4 z-10 rounded-lg bg-white/90 dark:bg-slate-900/90 backdrop-blur border px-3 py-1.5 text-xs shadow">
            💡 點擊任一「📱 …」群組可展開查看頁面與助手狀態
          </div>
        )}

      <NodeDetailSheet
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
      />
    </div>
  );
}
