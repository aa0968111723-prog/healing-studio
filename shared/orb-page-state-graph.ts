/**
 * shared/orb-page-state-graph.ts
 *
 * A minimal cross-page state graph derived from `APP_PAGE_REGISTRY`. Lets
 * the planner answer two practical questions:
 *
 *   1. "Which page can handle this action type?" — for actions like
 *      `setModality` that only exist on /studio, or `setTab=tts` that
 *      only exists on /pro-studio.
 *   2. "What's the shortest route from the current page to a target?" —
 *      always 1 navigate hop today (the SPA is fully connected via
 *      `navigate`), but expressed as a graph so future preconditions
 *      (e.g., must-be-logged-in, must-have-asset-uploaded) can be
 *      modelled without a rewrite.
 *
 * Pure functions; the registry import is the only dependency. Builds the
 * graph lazily on first use and memoises it.
 */
import type { AgentActionType } from "./agent-actions";
import {
  APP_PAGE_REGISTRY,
  type AppPageRegistryItem,
} from "./appRegistry";

export interface PageNode {
  pageId: string;
  path: string;
  label: string;
  /** Action types this page's PageAgent handler responds to. */
  supportedActions: AgentActionType[];
  /** Free-form precondition tags surfaced by the page (asset-required, …). */
  preconditions: string[];
}

export interface PageEdge {
  fromPageId: string;
  toPageId: string;
  /** Why this edge exists — currently always "navigate". */
  via: "navigate";
  /** When non-empty, the destination requires upstream state (rare today). */
  requires: string[];
}

export interface PageStateGraph {
  nodes: PageNode[];
  edges: PageEdge[];
  byId: Map<string, PageNode>;
  byPath: Map<string, PageNode>;
}

let cachedGraph: PageStateGraph | null = null;

function inferPreconditions(item: AppPageRegistryItem): string[] {
  const tags: string[] = [];
  if (item.path.includes("/assets")) tags.push("requires-account");
  if (item.path.includes("/admin")) tags.push("requires-admin");
  if (item.path.includes("/training-jobs")) tags.push("requires-account");
  if (
    item.supportedActions.includes("submit") ||
    item.supportedActions.includes("applyPreset")
  ) {
    tags.push("can-execute");
  }
  return tags;
}

/**
 * Build the static page-state graph from `APP_PAGE_REGISTRY`. Lazy +
 * memoised so repeated calls per request are O(1) after the first.
 */
export function buildPageStateGraph(): PageStateGraph {
  if (cachedGraph) return cachedGraph;

  const nodes: PageNode[] = APP_PAGE_REGISTRY.map(item => ({
    pageId: item.id,
    path: item.path,
    label: item.label,
    supportedActions: [...item.supportedActions],
    preconditions: inferPreconditions(item),
  }));

  // Today every page is reachable from every page via plain `navigate`.
  // We still encode this as an explicit edge list so the path-finding
  // helper has something concrete to walk and so future "must be logged
  // in to land here" rules can attach as edge requirements.
  const edges: PageEdge[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = 0; j < nodes.length; j += 1) {
      if (i === j) continue;
      const target = nodes[j];
      edges.push({
        fromPageId: nodes[i].pageId,
        toPageId: target.pageId,
        via: "navigate",
        requires: target.preconditions.filter(p => p.startsWith("requires-")),
      });
    }
  }

  const byId = new Map<string, PageNode>();
  const byPath = new Map<string, PageNode>();
  for (const n of nodes) {
    byId.set(n.pageId, n);
    byPath.set(n.path, n);
  }

  cachedGraph = { nodes, edges, byId, byPath };
  return cachedGraph;
}

/** Test seam: drop the memoised graph (use after registry hot-edits). */
export function invalidatePageStateGraph(): void {
  cachedGraph = null;
}

/**
 * Find pages that can dispatch a specific AgentActionType. Returns ALL
 * matches sorted by `agentEntryPriority` (which the registry preserves
 * via the supportedActions order). The planner uses this to convert a
 * bare action like `setModality:image` into a `path` + `targetPageId`.
 */
export function findPagesForAction(
  graph: PageStateGraph,
  actionType: AgentActionType
): PageNode[] {
  return graph.nodes.filter(n => n.supportedActions.includes(actionType));
}

export interface PathStep {
  pageId: string;
  /** The edge we used to reach this node (null for the start). */
  edge: PageEdge | null;
}

/**
 * Shortest path between two pages. Returns `null` when no path exists
 * (shouldn't happen with the current fully-connected graph, but the
 * planner should still handle null defensively). Uses BFS — the cost
 * model is uniform today (one navigate hop per edge) so BFS is optimal.
 */
export function findPathBetweenPages(
  graph: PageStateGraph,
  fromPageId: string,
  toPageId: string
): PathStep[] | null {
  if (fromPageId === toPageId) return [{ pageId: fromPageId, edge: null }];
  if (!graph.byId.has(fromPageId) || !graph.byId.has(toPageId)) return null;

  const visited = new Set<string>([fromPageId]);
  const queue: Array<{ pageId: string; path: PathStep[] }> = [
    { pageId: fromPageId, path: [{ pageId: fromPageId, edge: null }] },
  ];
  while (queue.length > 0) {
    const { pageId, path } = queue.shift()!;
    const outgoing = graph.edges.filter(e => e.fromPageId === pageId);
    for (const edge of outgoing) {
      if (visited.has(edge.toPageId)) continue;
      visited.add(edge.toPageId);
      const nextPath = path.concat([{ pageId: edge.toPageId, edge }]);
      if (edge.toPageId === toPageId) return nextPath;
      queue.push({ pageId: edge.toPageId, path: nextPath });
    }
  }
  return null;
}

/**
 * Given an action the planner wants to dispatch and the user's current
 * page, return a minimal step list:
 *   - if the current page already supports the action → [] (caller
 *     dispatches in place).
 *   - else, [{ navigate to the highest-priority supporting page }]
 *     followed by a marker `{ kind: "dispatch", pageId }` so the caller
 *     knows where to land.
 *
 * This is intentionally a step LIST rather than an `AgentWorkflowStep[]`
 * because the planner already owns the conversion to that shape and may
 * want to insert intermediate fillPrompt/setParam steps; we just tell it
 * where to go.
 */
export interface InferredRoute {
  steps: Array<
    | { kind: "navigate"; pageId: string; path: string; reason: string }
    | { kind: "dispatch"; pageId: string; path: string; reason: string }
  >;
  /** The destination — page that ultimately handles the action. */
  destination: PageNode | null;
  /** True when the action type isn't supported by ANY known page. */
  noSupportingPage: boolean;
}

export function inferRouteForAction(
  graph: PageStateGraph,
  actionType: AgentActionType,
  currentPageId?: string
): InferredRoute {
  const candidates = findPagesForAction(graph, actionType);
  if (candidates.length === 0) {
    return { steps: [], destination: null, noSupportingPage: true };
  }
  // Prefer the current page if it already supports the action (no nav).
  const currentMatch =
    currentPageId && candidates.find(c => c.pageId === currentPageId);
  if (currentMatch) {
    return {
      steps: [
        {
          kind: "dispatch",
          pageId: currentMatch.pageId,
          path: currentMatch.path,
          reason: "current page supports this action — dispatch in place",
        },
      ],
      destination: currentMatch,
      noSupportingPage: false,
    };
  }
  // Fall back to the FIRST candidate (registry order encodes priority).
  const target = candidates[0];
  return {
    steps: [
      {
        kind: "navigate",
        pageId: target.pageId,
        path: target.path,
        reason: `${actionType} is handled by ${target.label}`,
      },
      {
        kind: "dispatch",
        pageId: target.pageId,
        path: target.path,
        reason: "dispatch on arrival",
      },
    ],
    destination: target,
    noSupportingPage: false,
  };
}

/**
 * Compact prompt block describing the graph for the LLM. Intentionally
 * limits output to "page → supported actions" so we don't blow the
 * prompt budget; full edge enumeration would be O(N²) and add no signal
 * (the LLM already knows pages are reachable).
 */
export function summarizePageGraphForPrompt(
  graph: PageStateGraph,
  options: { limit?: number } = {}
): string {
  const limit = options.limit ?? 14;
  const filtered = graph.nodes
    .filter(n => n.supportedActions.length > 0)
    .slice(0, limit);
  if (filtered.length === 0) return "";
  const lines = filtered.map(n => {
    const acts = n.supportedActions.slice(0, 8).join(", ");
    return `- ${n.label} (${n.path}): ${acts}`;
  });
  return ["【全站頁面狀態圖（pageId · path · 該頁能執行的 action）】", ...lines].join("\n");
}
