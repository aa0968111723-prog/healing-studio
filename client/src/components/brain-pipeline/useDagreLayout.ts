import { useMemo } from "react";
import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 88;

/**
 * Auto-layout React Flow nodes top-to-bottom (swimlane style) using Dagre.
 * Nodes are layered by their `data.layer` field (frontend → backend → ai-brain → external).
 */
export function useDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB"
): { layoutedNodes: Node[]; layoutedEdges: Edge[] } {
  return useMemo(() => {
    if (nodes.length === 0) {
      return { layoutedNodes: nodes, layoutedEdges: edges };
    }

    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: direction, nodesep: 40, ranksep: 80, marginx: 30, marginy: 30 });

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

    const layoutedNodes: Node[] = nodes.map(node => {
      const pos = g.node(node.id);
      return {
        ...node,
        targetPosition: direction === "TB" ? "top" : "left",
        sourcePosition: direction === "TB" ? "bottom" : "right",
        position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
      } as Node;
    });

    return { layoutedNodes, layoutedEdges: edges };
  }, [nodes, edges, direction]);
}
