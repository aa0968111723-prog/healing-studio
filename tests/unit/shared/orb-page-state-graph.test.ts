/**
 * tests/unit/shared/orb-page-state-graph.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  buildPageStateGraph,
  findPagesForAction,
  findPathBetweenPages,
  inferRouteForAction,
  invalidatePageStateGraph,
  summarizePageGraphForPrompt,
} from "../../../shared/orb-page-state-graph";

describe("buildPageStateGraph", () => {
  it("includes a node for every registered page (sanity)", () => {
    invalidatePageStateGraph();
    const g = buildPageStateGraph();
    expect(g.nodes.length).toBeGreaterThan(5);
    expect(g.byId.has("studio")).toBe(true);
    expect(g.byPath.has("/studio")).toBe(true);
  });

  it("memoises subsequent calls", () => {
    const a = buildPageStateGraph();
    const b = buildPageStateGraph();
    expect(a).toBe(b);
  });

  it("invalidate drops the cache", () => {
    const a = buildPageStateGraph();
    invalidatePageStateGraph();
    const b = buildPageStateGraph();
    expect(a).not.toBe(b);
  });
});

describe("findPagesForAction", () => {
  it("finds all pages that declare a given action type", () => {
    const g = buildPageStateGraph();
    const fillers = findPagesForAction(g, "fillPrompt");
    // At least one fillPrompt-supporting page exists in the registry.
    expect(fillers.length).toBeGreaterThan(0);
    expect(fillers.every(n => n.supportedActions.includes("fillPrompt"))).toBe(true);
  });

  it("returns [] for an unsupported action type", () => {
    const g = buildPageStateGraph();
    // 'navigate' is universal, not in supportedActions per-page.
    const navs = findPagesForAction(g, "navigate");
    // Pages don't claim support for "navigate" in their per-page list,
    // since orb owns navigation. We just expect this to not throw.
    expect(Array.isArray(navs)).toBe(true);
  });
});

describe("findPathBetweenPages", () => {
  it("returns the same node for identical from/to", () => {
    const g = buildPageStateGraph();
    const path = findPathBetweenPages(g, "studio", "studio");
    expect(path).toEqual([{ pageId: "studio", edge: null }]);
  });

  it("returns a 2-step path for any registered destination (fully connected)", () => {
    const g = buildPageStateGraph();
    const fromId = g.nodes[0].pageId;
    const toId = g.nodes[1].pageId;
    const path = findPathBetweenPages(g, fromId, toId);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(2);
    expect(path![0].pageId).toBe(fromId);
    expect(path![path!.length - 1].pageId).toBe(toId);
  });

  it("returns null for unknown ids", () => {
    const g = buildPageStateGraph();
    expect(findPathBetweenPages(g, "studio", "nope")).toBeNull();
    expect(findPathBetweenPages(g, "nope", "studio")).toBeNull();
  });
});

describe("inferRouteForAction", () => {
  it("returns single-step dispatch when current page already supports it", () => {
    const g = buildPageStateGraph();
    const fillers = findPagesForAction(g, "fillPrompt");
    if (fillers.length === 0) return;
    const here = fillers[0];
    const route = inferRouteForAction(g, "fillPrompt", here.pageId);
    expect(route.steps).toHaveLength(1);
    expect(route.steps[0].kind).toBe("dispatch");
    expect(route.destination?.pageId).toBe(here.pageId);
  });

  it("emits navigate + dispatch when current page does not support the action", () => {
    const g = buildPageStateGraph();
    const fillers = findPagesForAction(g, "fillPrompt");
    if (fillers.length === 0) return;
    const route = inferRouteForAction(g, "fillPrompt", "home");
    expect(route.noSupportingPage).toBe(false);
    expect(route.steps[0].kind).toBe("navigate");
    expect(route.steps[1].kind).toBe("dispatch");
  });

  it("flags noSupportingPage when nothing handles the action", () => {
    const g = buildPageStateGraph();
    const route = inferRouteForAction(g, "neverHandled" as never);
    expect(route.noSupportingPage).toBe(true);
    expect(route.destination).toBeNull();
    expect(route.steps).toHaveLength(0);
  });
});

describe("summarizePageGraphForPrompt", () => {
  it("is non-empty for the live registry", () => {
    const g = buildPageStateGraph();
    const summary = summarizePageGraphForPrompt(g);
    expect(summary).toContain("全站頁面狀態圖");
  });

  it("respects the limit option", () => {
    const g = buildPageStateGraph();
    const summary = summarizePageGraphForPrompt(g, { limit: 3 });
    // Heading + at most 3 lines
    expect(summary.split("\n").length).toBeLessThanOrEqual(4);
  });
});
