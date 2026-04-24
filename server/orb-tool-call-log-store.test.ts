import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OrbToolCallLogStore } from "./services/orbToolCallLogStore";

describe("OrbToolCallLogStore", () => {
  it("appends and lists latest events by user", () => {
    const store = new OrbToolCallLogStore();
    store.append({
      requestId: "r1",
      userId: 1,
      userRole: "user",
      toolName: "crm.lookup",
      ok: true,
      startedAt: 1000,
      endedAt: 1100,
    });
    store.append({
      requestId: "r2",
      userId: 2,
      userRole: "admin",
      toolName: "ticket.create",
      ok: false,
      error: "boom",
      startedAt: 1200,
      endedAt: 1300,
    });

    const user1 = store.list({ userId: 1 });
    expect(user1).toHaveLength(1);
    expect(user1[0]?.toolName).toBe("crm.lookup");
  });

  it("supports taskId filter and persistence", () => {
    const dir = mkdtempSync(join(tmpdir(), "orb-tool-log-"));
    const file = join(dir, "logs.json");
    try {
      const store = new OrbToolCallLogStore(file);
      store.append({
        requestId: "r3",
        userId: 1,
        userRole: "user",
        taskId: "task_1",
        stepId: "s1",
        toolName: "crm.lookup",
        ok: true,
        startedAt: 1000,
        endedAt: 1020,
      });
      store.append({
        requestId: "r4",
        userId: 1,
        userRole: "user",
        taskId: "task_2",
        stepId: "s1",
        toolName: "notify.send",
        ok: true,
        startedAt: 1030,
        endedAt: 1050,
      });

      const reloaded = new OrbToolCallLogStore(file);
      const task1 = reloaded.list({ userId: 1, taskId: "task_1" });
      expect(task1).toHaveLength(1);
      expect(task1[0]?.requestId).toBe("r3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
