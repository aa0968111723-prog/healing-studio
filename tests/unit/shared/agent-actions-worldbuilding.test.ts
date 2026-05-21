import { describe, it, expect } from "vitest";
import { coerceAgentAction, isDestructiveAction } from "../../../shared/agent-actions";

describe("agent actions worldbuilding", () => {
  it("coerces batch action", () => {
    const action = coerceAgentAction({ type: "execute_worldbuilding_task_batch", tasks: [], mode: "dry_run" });
    expect(action?.type).toBe("execute_worldbuilding_task_batch");
  });
  it("marks as destructive", () => {
    expect(isDestructiveAction({ type: "execute_worldbuilding_task", task: {}, mode: "dry_run" } as any)).toBe(true);
  });
});
