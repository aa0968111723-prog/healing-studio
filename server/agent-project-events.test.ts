/**
 * agent-project-events.test.ts — AIDV-325
 *
 * 驗收條件：
 *   1. agentEventBus.emitForProject 觸發 subscribeToProject 訂閱者
 *   2. 不同 projectId 的訂閱相互獨立
 *   3. 同一 projectId 的多個訂閱者都收到事件
 *   4. unsubscribe 後不再收到事件
 *   5. 事件欄位（version, updatedFields, triggeredBy）正確傳遞
 *   6. collab 頻道不受 project 頻道影響
 */

import { describe, it, expect, vi } from "vitest";
import { agentEventBus, type AgentProjectEvent } from "./services/agentEventBus";

function makeEvent(projectId: number, overrides: Partial<AgentProjectEvent> = {}): AgentProjectEvent {
  return {
    type: "project_updated",
    projectId,
    version: 1,
    updatedFields: ["title"],
    triggeredBy: "user",
    ...overrides,
  };
}

describe("AIDV-325 agentEventBus.emitForProject", () => {
  it("subscribeToProject 收到 emitForProject 的事件", () => {
    const received: AgentProjectEvent[] = [];
    const unsub = agentEventBus.subscribeToProject(42, e => received.push(e));
    agentEventBus.emitForProject(makeEvent(42, { version: 5, triggeredBy: "agent" }));
    unsub();
    expect(received).toHaveLength(1);
    expect(received[0].version).toBe(5);
    expect(received[0].triggeredBy).toBe("agent");
    expect(received[0].projectId).toBe(42);
  });

  it("不同 projectId 互不影響", () => {
    const got42: AgentProjectEvent[] = [];
    const got99: AgentProjectEvent[] = [];
    const unsub42 = agentEventBus.subscribeToProject(42, e => got42.push(e));
    const unsub99 = agentEventBus.subscribeToProject(99, e => got99.push(e));
    agentEventBus.emitForProject(makeEvent(42));
    unsub42();
    unsub99();
    expect(got42).toHaveLength(1);
    expect(got99).toHaveLength(0);
  });

  it("同一 projectId 的多個訂閱者都收到事件", () => {
    const a: AgentProjectEvent[] = [];
    const b: AgentProjectEvent[] = [];
    const u1 = agentEventBus.subscribeToProject(7, e => a.push(e));
    const u2 = agentEventBus.subscribeToProject(7, e => b.push(e));
    agentEventBus.emitForProject(makeEvent(7, { version: 3, updatedFields: ["title", "aspectRatio"] }));
    u1();
    u2();
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].updatedFields).toEqual(["title", "aspectRatio"]);
  });

  it("unsubscribe 後不再收到事件", () => {
    const received: AgentProjectEvent[] = [];
    const unsub = agentEventBus.subscribeToProject(10, e => received.push(e));
    agentEventBus.emitForProject(makeEvent(10, { version: 1 }));
    unsub();
    agentEventBus.emitForProject(makeEvent(10, { version: 2 }));
    expect(received).toHaveLength(1);
    expect(received[0].version).toBe(1);
  });

  it("collab 頻道不干擾 project 頻道", () => {
    const projectEvents: AgentProjectEvent[] = [];
    const unsub = agentEventBus.subscribeToProject(55, e => projectEvents.push(e));
    agentEventBus.emit({
      type: "project_updated",
      collaborationId: "collab-xyz",
      projectId: 55,
      version: 9,
      updatedFields: ["title"],
    });
    unsub();
    expect(projectEvents).toHaveLength(0);
  });

  it("updatedFields 為空陣列時事件仍正確傳遞", () => {
    const received: AgentProjectEvent[] = [];
    const unsub = agentEventBus.subscribeToProject(20, e => received.push(e));
    agentEventBus.emitForProject(makeEvent(20, { updatedFields: [] }));
    unsub();
    expect(received[0].updatedFields).toEqual([]);
  });
});
