import { describe, expect, it, vi } from "vitest";
import {
  isValidCronExpression,
  runDirectLlmFallback,
  runScheduledOrbJob,
  scheduleOrbJob,
  setOrbJobEnabled,
  unscheduleOrbJob,
  type OrbScheduledJob,
} from "../orbScheduler";
import type { AgentPlannerResult } from "../agentPlanner";
import type { InvokeResult } from "../../_core/llm";

describe("orbScheduler.isValidCronExpression", () => {
  it("accepts standard 5-field cron expressions", () => {
    expect(isValidCronExpression("0 9 * * *")).toBe(true);
    expect(isValidCronExpression("*/15 * * * *")).toBe(true);
    expect(isValidCronExpression("0 0 1 * *")).toBe(true);
    expect(isValidCronExpression("0 9 * * 1-5")).toBe(true);
  });

  it("rejects obviously bad input", () => {
    expect(isValidCronExpression("not a cron")).toBe(false);
    expect(isValidCronExpression("")).toBe(false);
    expect(isValidCronExpression("99 99 99 99 99")).toBe(false);
  });
});

function makeInvokeResult(text: string): InvokeResult {
  return {
    id: "test",
    created: 0,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
  };
}

describe("orbScheduler.runDirectLlmFallback", () => {
  it("returns the LLM completion text trimmed", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue(makeInvokeResult("  整理結果如下 …  "));
    const text = await runDirectLlmFallback("整理昨天的生成紀錄", invoke);
    expect(text).toBe("整理結果如下 …");
    expect(invoke).toHaveBeenCalledTimes(1);
    const call = invoke.mock.calls[0]?.[0];
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[1].role).toBe("user");
    expect(call.messages[1].content).toBe("整理昨天的生成紀錄");
    expect(call.runName).toBe("orb-scheduler-direct-fallback");
  });

  it("returns a placeholder when the LLM returns empty text", async () => {
    const invoke = vi.fn().mockResolvedValue(makeInvokeResult(""));
    const text = await runDirectLlmFallback("任務", invoke);
    expect(text).toContain("模型未回傳");
  });
});

function makeJob(overrides: Partial<OrbScheduledJob> = {}): OrbScheduledJob {
  return {
    id: "test-job",
    userId: 1,
    cronExpression: "0 9 * * *",
    taskDescription: "整理昨天的生成紀錄成短報告",
    enabled: true,
    ...overrides,
  };
}

function makeInvalidPlannerResult(): AgentPlannerResult {
  return {
    status: "invalid",
    ok: false,
    version: "agent-plan.v3",
    actions: [],
    askBeforeAct: false,
    warnings: [],
    blockers: [],
    issues: ["no executable step"],
    plannerUsed: true,
  } as AgentPlannerResult;
}

describe("orbScheduler.runScheduledOrbJob (fallback path)", () => {
  it("falls back to direct LLM when the planner returns invalid and writes lastResult", async () => {
    const job = makeJob();
    const runPlanner = vi.fn().mockResolvedValue(makeInvalidPlannerResult());
    const runFallback = vi
      .fn()
      .mockResolvedValue("摘要：昨天共有 12 次生成，建議刪除其中 3 個未採用的草稿。");

    await runScheduledOrbJob(job, { runPlanner, runFallback });

    expect(runPlanner).toHaveBeenCalledOnce();
    expect(runFallback).toHaveBeenCalledWith("整理昨天的生成紀錄成短報告");
    expect(job.lastError).toBeUndefined();
    expect(job.lastRunStatus).toBe("fallback:invalid");
    expect(job.lastResult).toContain("摘要");
    expect(typeof job.lastRunAt).toBe("number");
  });

  it("clamps very long fallback text and marks truncation", async () => {
    const job = makeJob();
    const longText = "報告內容".repeat(2000); // 8000 chars
    const runPlanner = vi.fn().mockResolvedValue(makeInvalidPlannerResult());
    const runFallback = vi.fn().mockResolvedValue(longText);

    await runScheduledOrbJob(job, { runPlanner, runFallback });

    expect(job.lastResult).toBeDefined();
    expect(job.lastResult!.length).toBeLessThan(longText.length);
    expect(job.lastResult).toContain("已截斷");
  });

  it("sets lastRunStatus=fallback:clarification when planner asks for clarification", async () => {
    const job = makeJob();
    const runPlanner = vi.fn().mockResolvedValue({
      ...makeInvalidPlannerResult(),
      status: "clarification",
      clarificationQuestion: "你想統計哪一週的紀錄？",
    } as AgentPlannerResult);
    const runFallback = vi.fn().mockResolvedValue("假設整理上週紀錄的報告。");

    await runScheduledOrbJob(job, { runPlanner, runFallback });

    expect(job.lastRunStatus).toBe("fallback:clarification");
    expect(job.lastResult).toContain("上週");
    expect(job.lastError).toBeUndefined();
  });

  it("records lastRunStatus=error when the planner throws", async () => {
    const job = makeJob();
    const runPlanner = vi.fn().mockRejectedValue(new Error("LLM down"));
    const runFallback = vi.fn();

    await runScheduledOrbJob(job, { runPlanner, runFallback });

    expect(runFallback).not.toHaveBeenCalled();
    expect(job.lastRunStatus).toBe("error");
    expect(job.lastError).toBe("LLM down");
    expect(job.lastResult).toBeUndefined();
  });

  it("records lastRunStatus=error when the fallback throws", async () => {
    const job = makeJob();
    const runPlanner = vi.fn().mockResolvedValue(makeInvalidPlannerResult());
    const runFallback = vi.fn().mockRejectedValue(new Error("OpenAI 5xx"));

    await runScheduledOrbJob(job, { runPlanner, runFallback });

    expect(job.lastRunStatus).toBe("error");
    expect(job.lastError).toBe("OpenAI 5xx");
  });
});

// ── multi-tenant isolation (自動排程修復 audit finding) ──────────────────────
// `setOrbJobEnabled` learned an `expectedUserId` arg so the DB-lookup
// fallback (used when the in-memory registry hasn't been rebuilt yet)
// refuses to mutate jobs that belong to a different tenant. Without the
// guard, user A could call the setEnabled tRPC route with user B's jobId
// and flip user B's `enabled` flag in the DB before the route's
// post-update userId check fired.
describe("orbScheduler.setOrbJobEnabled tenant isolation", () => {
  it("refuses to mutate an in-memory job that belongs to another user", async () => {
    // Seed the in-memory registry with user 100's job, then have user 200
    // try to disable it. The service must refuse without throwing.
    const seedJob: OrbScheduledJob = {
      id: "tenant-iso-test-1",
      userId: 100,
      // Run yearly so the test never triggers a real cron tick before
      // unschedule fires. The exact value doesn't matter — node-cron
      // accepts it and we tear the task down in `finally`.
      cronExpression: "0 0 1 1 *",
      taskDescription: "owner-100 yearly task",
      enabled: true,
    };
    try {
      await scheduleOrbJob(seedJob);
      const result = await setOrbJobEnabled(seedJob.id, false, 200);
      expect(result).toBeUndefined();
    } finally {
      unscheduleOrbJob(seedJob.id);
    }
  });

  it("still allows the rightful owner to mutate", async () => {
    const seedJob: OrbScheduledJob = {
      id: "tenant-iso-test-2",
      userId: 100,
      cronExpression: "0 0 1 1 *",
      taskDescription: "owner-100 yearly task",
      enabled: true,
    };
    try {
      await scheduleOrbJob(seedJob);
      const result = await setOrbJobEnabled(seedJob.id, false, 100);
      expect(result).toBeDefined();
      expect(result?.enabled).toBe(false);
    } finally {
      unscheduleOrbJob(seedJob.id);
    }
  });
});
