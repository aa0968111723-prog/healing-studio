import { describe, it, expect } from "vitest";
import {
  APP_PAGE_REGISTRY,
  SIDEBAR_GROUPS,
  getSidebarTree,
  type SidebarTreeBranch,
} from "./appRegistry";

describe("appRegistry sidebar grouping", () => {
  it("contains exactly the four top-level sidebar groups", () => {
    const labels = SIDEBAR_GROUPS.map(g => g.label);
    expect(labels).toEqual(["創作中樞", "六大系統", "模型樂園", "管理"]);
  });

  it("dock top-level branches match the four configured groups", () => {
    const tree = getSidebarTree();
    const groupLabels = tree
      .filter((node): node is SidebarTreeBranch => node.kind === "group")
      .map(node => node.label);
    // Step 1 ships every sidebar page inside one of the four groups — no
    // standalone leaves should sneak in at the dock's top level.
    expect(groupLabels).toEqual(["創作中樞", "六大系統", "模型樂園", "管理"]);
    expect(tree.every(node => node.kind === "group")).toBe(true);
  });

  it("六大系統 does NOT include single-model studio tools", () => {
    const tree = getSidebarTree();
    const sixSystems = tree.find(
      (node): node is SidebarTreeBranch =>
        node.kind === "group" && node.id === "six-systems",
    );
    expect(sixSystems).toBeTruthy();
    const childLabels = sixSystems!.children.map(child => child.label);
    for (const banned of [
      "圖片創作室",
      "影片創作室",
      "音樂配音創作室",
      "模型訓練中心",
    ]) {
      expect(childLabels, `${banned} must not appear in 六大系統`).not.toContain(banned);
    }
  });

  it("模型樂園 includes every single-model studio + trainer", () => {
    const tree = getSidebarTree();
    const playground = tree.find(
      (node): node is SidebarTreeBranch =>
        node.kind === "group" && node.id === "model-playground",
    );
    expect(playground).toBeTruthy();
    const childLabels = playground!.children.map(child => child.label);
    for (const required of [
      "圖片創作室",
      "影片創作室",
      "音樂配音創作室",
      "模型訓練中心",
    ]) {
      expect(childLabels, `${required} must appear in 模型樂園`).toContain(required);
    }
  });

  it("every sidebar page has complete sidebar metadata", () => {
    const sidebarPages = APP_PAGE_REGISTRY.filter(page => page.showInSidebar);
    expect(sidebarPages.length).toBeGreaterThan(0);
    for (const page of sidebarPages) {
      expect(page.sidebarGroup, `${page.id} missing sidebarGroup`).toBeTruthy();
      expect(page.sidebarOrder, `${page.id} missing sidebarOrder`).toBeTypeOf("number");
      expect(page.sidebarIcon, `${page.id} missing sidebarIcon`).toBeTruthy();
      expect(page.description, `${page.id} missing description`).toBeTruthy();
    }
  });
});
