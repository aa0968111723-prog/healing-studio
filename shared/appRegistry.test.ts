import { describe, it, expect } from "vitest";
import {
  SIDEBAR_GROUPS,
  VISIBLE_DOCK_PAGE_IDS,
  getSidebarTree,
  type SidebarTreeBranch,
  type SidebarTreeLeaf,
} from "./appRegistry";

describe("appRegistry sidebar grouping", () => {
  it("only emits the film-director group at the top level", () => {
    const labels = SIDEBAR_GROUPS.map(g => g.label);
    expect(labels).toEqual(["影片世界觀+導演ai"]);
  });

  it("dock top level shows exactly the 4 user-selected entries", () => {
    const tree = getSidebarTree();
    const topLabels = tree.map(node => node.label);
    // 用戶指定：只保留 創作作業系統、數位資產庫、影片世界觀+導演ai、個人資料庫
    expect(topLabels).toEqual([
      "創作作業系統",
      "數位資產庫",
      "影片世界觀+導演ai",
      "個人資料庫",
    ]);
  });

  it("film-director group expands to 影片世界觀 + 導演AI", () => {
    const tree = getSidebarTree();
    const filmDirector = tree.find(
      (node): node is SidebarTreeBranch =>
        node.kind === "group" && node.id === "film-director",
    );
    expect(filmDirector).toBeTruthy();
    const childLabels = filmDirector!.children.map(child => child.label);
    expect(childLabels).toEqual(["影片世界觀", "導演 AI"]);
  });

  it("top-level standalone leaves are the non-grouped keepers", () => {
    const tree = getSidebarTree();
    const leaves = tree.filter(
      (node): node is SidebarTreeLeaf => node.kind === "page",
    );
    const leafIds = leaves.map(leaf => leaf.pageId);
    expect(leafIds).toEqual(["create", "assets", "teaching-archive"]);
  });

  it("VISIBLE_DOCK_PAGE_IDS matches the 5 keepers (2 of which sit under a group)", () => {
    expect(VISIBLE_DOCK_PAGE_IDS).toEqual(
      new Set(["create", "assets", "animation-studio", "director", "teaching-archive"]),
    );
  });
});
