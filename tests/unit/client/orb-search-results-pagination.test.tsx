// @vitest-environment jsdom
/**
 * orb-search-results-pagination.test.tsx
 *
 * Verifies the pagination behavior layered on top of the existing chip /
 * sort / week-toggle refinement in OrbSearchResultsCard:
 *   - Splits results into pages of ORB_SEARCH_PAGE_SIZE
 *   - Renders no pagination when refined.length <= page size
 *   - Page → 1 reset whenever the refinement input shrinks
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
import OrbSearchResultsCard, {
  ORB_SEARCH_PAGE_SIZE,
} from "../../../client/src/components/orb/OrbSearchResultsCard";
import type { ChatSearchResultItem } from "../../../client/src/contexts/GlobalOrbChatContext";

function makeItems(
  count: number,
  overrides: (i: number) => Partial<ChatSearchResultItem> = () => ({})
): ChatSearchResultItem[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: "asset" as const,
    id: `item-${i}`,
    title: `Item ${i}`,
    snippet: `snippet ${i}`,
    path: `/items/${i}`,
    score: 1 - i * 0.01,
    ...overrides(i),
  }));
}

function visibleResultIds(): string[] {
  return screen
    .getAllByTestId("orb-search-result-link")
    .map(el => el.querySelector(".truncate")?.textContent ?? "");
}

describe("OrbSearchResultsCard pagination", () => {
  it("paginates 12 results into two pages of 6", () => {
    render(<OrbSearchResultsCard items={makeItems(12)} />);

    // First page renders the first 6 items.
    expect(visibleResultIds()).toEqual([
      "Item 0",
      "Item 1",
      "Item 2",
      "Item 3",
      "Item 4",
      "Item 5",
    ]);

    // Two numbered page buttons are present.
    const pageButtons = screen.getAllByTestId("orb-search-pagination-page");
    expect(pageButtons.map(b => b.getAttribute("data-page-index"))).toEqual([
      "1",
      "2",
    ]);
    expect(pageButtons[0].getAttribute("data-active")).toBe("true");
    expect(pageButtons[1].getAttribute("data-active")).toBe("false");
  });

  it("clicking page 2 reveals the next slice and toggles prev/next disabled state", () => {
    render(<OrbSearchResultsCard items={makeItems(12)} />);

    // Prev should start disabled, next enabled.
    expect(
      screen.getByTestId("orb-search-pagination-prev").getAttribute("aria-disabled")
    ).toBe("true");
    expect(
      screen.getByTestId("orb-search-pagination-next").getAttribute("aria-disabled")
    ).toBe("false");

    fireEvent.click(
      screen
        .getAllByTestId("orb-search-pagination-page")
        .find(b => b.getAttribute("data-page-index") === "2")!
    );

    expect(visibleResultIds()).toEqual([
      "Item 6",
      "Item 7",
      "Item 8",
      "Item 9",
      "Item 10",
      "Item 11",
    ]);

    // Roles flip on the last page.
    expect(
      screen.getByTestId("orb-search-pagination-prev").getAttribute("aria-disabled")
    ).toBe("false");
    expect(
      screen.getByTestId("orb-search-pagination-next").getAttribute("aria-disabled")
    ).toBe("true");
  });

  it("hides pagination and resets to page 1 when a chip filters results below page size", () => {
    // 8 assets + 4 notes = 12 total. Filtering to "note" leaves 4 items.
    const items = [
      ...makeItems(8, () => ({ kind: "asset" as const })),
      ...makeItems(4, i => ({ kind: "note" as const, id: `note-${i}`, title: `Note ${i}` })),
    ];
    render(<OrbSearchResultsCard items={items} />);

    // Move to page 2 first so we can prove the reset.
    fireEvent.click(
      screen
        .getAllByTestId("orb-search-pagination-page")
        .find(b => b.getAttribute("data-page-index") === "2")!
    );

    // Click the "筆記" chip to filter down to 4 items.
    const noteChip = screen
      .getAllByTestId("orb-search-filter-chip")
      .find(b => b.getAttribute("data-chip-kind") === "note");
    fireEvent.click(noteChip!);

    // Pagination control should be gone (4 items < page size).
    expect(screen.queryByTestId("orb-search-pagination")).toBeNull();

    // And the 4 note items render in their original order (page 1, not stale page 2).
    const titles = visibleResultIds();
    expect(titles).toEqual(["Note 0", "Note 1", "Note 2", "Note 3"]);
  });

  it("renders no pagination when refined results fit on a single page", () => {
    render(<OrbSearchResultsCard items={makeItems(ORB_SEARCH_PAGE_SIZE)} />);
    expect(screen.queryByTestId("orb-search-pagination")).toBeNull();
    expect(within(document.body).getAllByTestId("orb-search-result-link")).toHaveLength(
      ORB_SEARCH_PAGE_SIZE
    );
  });
});
