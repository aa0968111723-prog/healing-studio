import { describe, it, expect } from "vitest";
import {
  SIDEBAR_GROUPS,
  VISIBLE_DOCK_PAGE_IDS,
  getSidebarTree,
  type SidebarTreeLeaf,
} from "./appRegistry";

describe("appRegistry sidebar grouping", () => {
  it("registers no sidebar groups (everything renders as a standalone leaf)", () => {
    expect(SIDEBAR_GROUPS).toEqual([]);
  });

  it("dock top level shows exactly the 4 user-selected entries", () => {
    const tree = getSidebarTree();
    const topLabels = tree.map(node => node.label);
    // 用戶指定：只保留 創作作業系統、數位資產庫、導演 AI、個人資料庫
    expect(topLabels).toEqual([
      "創作作業系統",
      "數位資產庫",
      "導演 AI",
      "個人資料庫",
    ]);
  });

  it("top-level entries are all standalone leaves", () => {
    const tree = getSidebarTree();
    const leaves = tree.filter(
      (node): node is SidebarTreeLeaf => node.kind === "page",
    );
    expect(leaves.length).toBe(tree.length);
    const leafIds = leaves.map(leaf => leaf.pageId);
    expect(leafIds).toEqual(["create", "assets", "director", "teaching-archive"]);
  });

  it("VISIBLE_DOCK_PAGE_IDS matches the 4 keepers (影片世界觀 已移除)", () => {
    expect(VISIBLE_DOCK_PAGE_IDS).toEqual(
      new Set(["create", "assets", "director", "teaching-archive"]),
    );
  });
});
