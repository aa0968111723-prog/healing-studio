/**
 * orb-search-refinement.test.ts
 *
 * Pure-function coverage for `applySearchRefinement`, the client-side
 * filter+sort helper used by the new search-result chips. Lives in `server/`
 * so vitest's `server/**` glob picks it up (the helper is browser-side
 * but pure, so import works in node env).
 */

import { describe, expect, it } from "vitest";
import {
  applySearchRefinement,
  type SearchKindFilter,
  type SearchSortMode,
} from "../client/src/components/orb/OrbSearchResultsCard";
import type { ChatSearchResultItem } from "../client/src/contexts/GlobalOrbChatContext";

const NOW = new Date("2026-05-16T12:00:00Z").getTime();
const days = (n: number) => NOW - n * 24 * 60 * 60 * 1000;

const make = (
  override: Partial<ChatSearchResultItem> & Pick<ChatSearchResultItem, "kind" | "id">
): ChatSearchResultItem => ({
  title: override.id,
  snippet: "",
  path: `/x/${override.id}`,
  score: 0.5,
  ...override,
});

const fixture: ChatSearchResultItem[] = [
  make({ kind: "asset", id: "a-old", at: days(40), score: 0.9 }),
  make({ kind: "asset", id: "a-new", at: days(2), score: 0.6 }),
  make({ kind: "note", id: "n-old", at: days(20), score: 0.8 }),
  make({ kind: "note", id: "n-new", at: days(1), score: 0.5 }),
  make({ kind: "history", id: "h-mid", at: days(10), score: 0.7 }),
  make({ kind: "tutorial", id: "t-no-at", score: 0.65 }),
];

const opts = (
  kind: SearchKindFilter,
  thisWeekOnly: boolean,
  sort: SearchSortMode
) => ({ kind, thisWeekOnly, sort });

describe("applySearchRefinement", () => {
  it("kind=all + thisWeekOnly=false + sort=relevance preserves score-desc", () => {
    const out = applySearchRefinement(fixture, opts("all", false, "relevance"), NOW);
    const ids = out.map(i => i.id);
    expect(ids).toEqual(["a-old", "n-old", "h-mid", "t-no-at", "a-new", "n-new"]);
  });

  it("kind=note filters out everything else, score order preserved", () => {
    const out = applySearchRefinement(fixture, opts("note", false, "relevance"), NOW);
    expect(out.map(i => i.id)).toEqual(["n-old", "n-new"]);
  });

  it("thisWeekOnly drops items older than 7 days AND items with no at", () => {
    const out = applySearchRefinement(fixture, opts("all", true, "relevance"), NOW);
    // a-new (2d), n-new (1d) survive; rest drop
    expect(out.map(i => i.id)).toEqual(["a-new", "n-new"]);
  });

  it("sort=recent orders by `at` desc and uses score as tie-break", () => {
    const out = applySearchRefinement(fixture, opts("all", false, "recent"), NOW);
    // Newest first: n-new (1d), a-new (2d), h-mid (10d), n-old (20d), a-old (40d)
    // Tutorials with no at land at the very bottom (at=0).
    expect(out.map(i => i.id)).toEqual([
      "n-new",
      "a-new",
      "h-mid",
      "n-old",
      "a-old",
      "t-no-at",
    ]);
  });

  it("filter + sort + week toggle compose correctly", () => {
    const out = applySearchRefinement(fixture, opts("asset", true, "recent"), NOW);
    // Only assets, only this week → only a-new survives
    expect(out.map(i => i.id)).toEqual(["a-new"]);
  });

  it("returns empty array when no items match", () => {
    const out = applySearchRefinement(
      fixture.filter(i => i.kind !== "asset"),
      opts("asset", false, "relevance"),
      NOW
    );
    expect(out).toHaveLength(0);
  });

  it("does not mutate the input array", () => {
    const before = fixture.slice();
    applySearchRefinement(fixture, opts("all", false, "recent"), NOW);
    expect(fixture).toEqual(before);
  });

  it("breaks score ties by `at` desc on relevance sort", () => {
    const tied: ChatSearchResultItem[] = [
      make({ kind: "asset", id: "old-tie", at: days(30), score: 0.7 }),
      make({ kind: "asset", id: "new-tie", at: days(2), score: 0.7 }),
    ];
    const out = applySearchRefinement(tied, opts("all", false, "relevance"), NOW);
    expect(out.map(i => i.id)).toEqual(["new-tie", "old-tie"]);
  });
});
