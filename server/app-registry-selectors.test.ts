import { describe, expect, it } from "vitest";
import {
  getAgentHomeEntries,
  getPrimaryQuickAction,
  getPageById,
  getPageByPath,
  getSidebarGroups,
} from "../shared/appRegistry";

describe("appRegistry selectors", () => {
  it('resolves page by path "/agent"', () => {
    const page = getPageByPath("/agent");
    expect(page?.id).toBe("agent-chat");
  });

  it('resolves page by id "video-studio"', () => {
    const page = getPageById("video-studio");
    expect(page?.path).toBe("/video-studio");
  });

  it("returns grouped sidebar pages", () => {
    const groups = getSidebarGroups();
    const groupIds = groups.map(group => group.groupId);

    expect(groupIds.length).toBeGreaterThan(0);
    expect(groupIds).toContain("create");
    expect(groups.find(group => group.groupId === "create")?.pages.length).toBeGreaterThan(0);
  });

  it("sorts agent home entries by priority", () => {
    const entries = getAgentHomeEntries();
    expect(entries[0]?.id).toBe("agent-chat");
    expect(entries[0]?.agentEntryPriority).toBeLessThanOrEqual(
      entries[1]?.agentEntryPriority ?? Number.MAX_SAFE_INTEGER
    );
  });

  it("reads primary quick action by page id", () => {
    const quickAction = getPrimaryQuickAction("agent-chat");
    expect(quickAction?.id).toBe("start-guided-flow");
  });
});
