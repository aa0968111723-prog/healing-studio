/**
 * Unit tests for AgentCollaborationOrchestrator's protocol-handoff support.
 * 驗證 SPIRIT_COLLAB_PROTOCOL 真的接進 orchestrator，而不是只在 shared 裡躺著。
 *
 * Note: executeProtocolHandoff 需要 active session — 這支不跑 DB 呼叫，只
 * 測 read-only 的 getProtocolHandoffsFor（不需要 session）。executeHandoff
 * 的 DB 路徑由既有測試 + integration 覆蓋。
 */
import { describe, expect, it } from "vitest";
import { AgentCollaborationOrchestrator } from "../../../server/services/agentCollaborationOrchestrator";

describe("AgentCollaborationOrchestrator.getProtocolHandoffsFor", () => {
  it("returns handoffs for director (planning role)", () => {
    const handoffs = AgentCollaborationOrchestrator.getProtocolHandoffsFor("director");
    expect(handoffs.length).toBeGreaterThan(0);
    // director 第一棒應該交給 composer (在當頁套用每一步)
    expect(handoffs[0].to).toBe("composer");
    // 全部目標都不該是 director 自己
    for (const h of handoffs) {
      expect(h.to).not.toBe("director");
    }
  });

  it("returns handoffs for accountant (proactive)", () => {
    const handoffs = AgentCollaborationOrchestrator.getProtocolHandoffsFor("accountant");
    expect(handoffs.length).toBeGreaterThan(0);
    // accountant 通常交給 researcher (列省錢替代方案) 或 composer (切換模型)
    const targets = handoffs.map(h => h.to);
    expect(targets.some(t => t === "researcher" || t === "composer")).toBe(true);
  });

  it("filters out muted roles", () => {
    const all = AgentCollaborationOrchestrator.getProtocolHandoffsFor("director");
    const filtered = AgentCollaborationOrchestrator.getProtocolHandoffsFor("director", {
      mutedRoles: [all[0].to],
    });
    // 第一棒被靜音後剩下的清單一定比原本短
    expect(filtered.length).toBe(all.length - 1);
    // 靜音的 target 不該再出現
    expect(filtered.map(h => h.to)).not.toContain(all[0].to);
  });

  it("returns empty array for an unknown agent (defensive)", () => {
    // 把 unknown id 強轉成 AgentRole 模擬髒資料 — 不該炸，回 [].
    const handoffs = AgentCollaborationOrchestrator.getProtocolHandoffsFor(
      "made-up-role" as never
    );
    expect(handoffs).toEqual([]);
  });

  it("returns empty array if every handoff is muted", () => {
    const all = AgentCollaborationOrchestrator.getProtocolHandoffsFor("companion");
    const allMuted = AgentCollaborationOrchestrator.getProtocolHandoffsFor("companion", {
      mutedRoles: all.map(h => h.to),
    });
    expect(allMuted).toEqual([]);
  });
});
