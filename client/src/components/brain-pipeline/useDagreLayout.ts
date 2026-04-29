import { useMemo } from "react";
import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 88;

type Position = { x: number; y: number };

/**
 * Auto-layout React Flow nodes top-to-bottom (swimlane style) using Dagre.
 *
 * Optimization: Dagre 佈局只依賴「拓樸」（節點 id 集合 + 邊集合 + 方向），
 * 與節點狀態（healthy / broken …）無關。因此把佈局拆成兩段 useMemo：
 *   1. positionMap：用 topology key 當 dependency，狀態更新不重新跑佈局
 *   2. layoutedNodes：每次重新合併最新節點資料 + 穩定的位置
 * 在 30 秒輪詢、節點增減罕見的場景下，可避免每次刷新都重算 dagre。
 */
export function useDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB"
): { layoutedNodes: Node[]; layoutedEdges: Edge[] } {
  const topologyKey = useMemo(() => {
    if (nodes.length === 0) return `${direction}::empty`;
    const nodeIds = nodes.map(n => n.id).sort().join("|");
    const edgeIds = edges
      .map(e => `${e.source}>${e.target}`)
      .sort()
      .join("|");
    return `${direction}::${nodeIds}::${edgeIds}`;
  }, [nodes, edges, direction]);

  const positionMap = useMemo(() => {
    const map = new Map<string, Position>();
    if (nodes.length === 0) return map;

    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({
      rankdir: direction,
      nodesep: 40,
      ranksep: 80,
      marginx: 30,
      marginy: 30,
    });

    for (const node of nodes) {
      g.setNode(node.id, {
        width: (node.style?.width as number) ?? NODE_WIDTH,
        height: (node.style?.height as number) ?? NODE_HEIGHT,
      });
    }
    for (const edge of edges) {
      g.setEdge(edge.source, edge.target);
    }

    dagre.layout(g);

    for (const node of nodes) {
      const pos = g.node(node.id);
      if (pos) {
        map.set(node.id, {
          x: pos.x - NODE_WIDTH / 2,
          y: pos.y - NODE_HEIGHT / 2,
        });
      }
    }
    return map;
    // 拓樸沒變就不重跑佈局；status / metrics 變動只走下面那層 memo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topologyKey]);

  const layoutedNodes = useMemo(() => {
    if (nodes.length === 0) return nodes;
    const targetPosition = direction === "TB" ? "top" : "left";
    const sourcePosition = direction === "TB" ? "bottom" : "right";
    return nodes.map(node => ({
      ...node,
      targetPosition,
      sourcePosition,
      position: positionMap.get(node.id) ?? { x: 0, y: 0 },
    })) as Node[];
  }, [nodes, positionMap, direction]);

  return { layoutedNodes, layoutedEdges: edges };
}
