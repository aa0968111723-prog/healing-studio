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
import {
  agentEventBus,
  type AgentProjectEvent,
  type AgentTaskStatusEvent,
} from "./services/agentEventBus";

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

// AIDV-467 Issue 6: agent_task_status events on the per-project SSE channel
describe("AIDV-467 agentEventBus — agent_task_status events", () => {
  it("emitForProject broadcasts agent_task_status: assigned with agentId", () => {
    const received: AgentProjectEvent[] = [];
    const unsub = agentEventBus.subscribeToProject(77, e => received.push(e));

    const ev: AgentTaskStatusEvent = {
      type: "agent_task_status",
      projectId: 77,
      status: "assigned",
      agentId: "agent-007",
    };
    agentEventBus.emitForProject(ev);
    unsub();

    expect(received).toHaveLength(1);
    const got = received[0] as AgentTaskStatusEvent;
    expect(got.type).toBe("agent_task_status");
    expect(got.status).toBe("assigned");
    expect(got.agentId).toBe("agent-007");
    expect(got.projectId).toBe(77);
  });

  it("agent_task_status with queued status has no agentId required", () => {
    const received: AgentProjectEvent[] = [];
    const unsub = agentEventBus.subscribeToProject(88, e => received.push(e));

    const ev: AgentTaskStatusEvent = {
      type: "agent_task_status",
      projectId: 88,
      status: "queued",
      runId: 42,
    };
    agentEventBus.emitForProject(ev);
    unsub();

    expect(received).toHaveLength(1);
    const got = received[0] as AgentTaskStatusEvent;
    expect(got.status).toBe("queued");
    expect(got.runId).toBe(42);
    expect(got.agentId).toBeUndefined();
  });

  it("agent_task_status events are isolated by projectId", () => {
    const got77: AgentProjectEvent[] = [];
    const got88: AgentProjectEvent[] = [];
    const unsub77 = agentEventBus.subscribeToProject(77, e => got77.push(e));
    const unsub88 = agentEventBus.subscribeToProject(88, e => got88.push(e));

    agentEventBus.emitForProject({
      type: "agent_task_status",
      projectId: 77,
      status: "assigned",
      agentId: "agent-A",
    });

    unsub77();
    unsub88();

    expect(got77).toHaveLength(1);
    expect(got88).toHaveLength(0);
  });
});
