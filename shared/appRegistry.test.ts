import { describe, it, expect } from "vitest";
import { APP_PAGE_REGISTRY, SIDEBAR_GROUPS } from "./appRegistry";

describe("appRegistry sidebar grouping", () => {
  it("contains new grouped buckets", () => {
    const labels = SIDEBAR_GROUPS.map(g => g.label);
    expect(labels).toEqual(expect.arrayContaining(["開始", "創作系統", "素材與模型", "管理"]));
  });

  it("every sidebar page has complete sidebar metadata", () => {
    const sidebarPages = APP_PAGE_REGISTRY.filter(page => page.showInSidebar);
    for (const page of sidebarPages) {
      expect(page.sidebarGroup, `${page.id} missing sidebarGroup`).toBeTruthy();
      expect(page.sidebarOrder, `${page.id} missing sidebarOrder`).toBeTypeOf("number");
      expect(page.sidebarIcon, `${page.id} missing sidebarIcon`).toBeTruthy();
      expect(page.description, `${page.id} missing description`).toBeTruthy();
    }
  });
});
