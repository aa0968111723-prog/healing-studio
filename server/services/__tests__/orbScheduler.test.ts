import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __unsafe_resetScheduledJobLocksForTests,
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

// ── H7: per-job in-flight lock ─────────────────────────────────────────────
// 沒這個鎖時 cron 1 分鐘觸發但 LLM 任務跑 90 秒,下一 tick 直接再 fire,
// 兩個 runner 同時改寫同 job 的 lastResult/lastRunAt、向 fal 雙扣計費。
describe("orbScheduler.runScheduledOrbJob in-flight lock (H7)", () => {
  beforeEach(() => {
    __unsafe_resetScheduledJobLocksForTests();
  });
  afterEach(() => {
    __unsafe_resetScheduledJobLocksForTests();
  });

  it("第二次並發呼叫被跳過,planner 只跑一次", async () => {
    const job = makeJob();
    // 慢 planner:用 deferred promise 控制 resolve 時機,確保第二個呼叫
    // 進來時第一個還沒結束。
    let resolveFirst: ((value: AgentPlannerResult) => void) | undefined;
    const firstCallPromise = new Promise<AgentPlannerResult>(resolve => {
      resolveFirst = resolve;
    });
    const runPlanner = vi.fn().mockReturnValue(firstCallPromise);
    const runFallback = vi.fn().mockResolvedValue("OK");

    // 第一個 fire 但不 await — 模擬 cron 觸發後 LLM 還沒跑完。
    const firstRun = runScheduledOrbJob(job, { runPlanner, runFallback });
    // 同步等下一個 microtask 確保 lock 已 acquire。
    await Promise.resolve();
    // 第二個並發 fire,應該被跳過。
    const secondRun = runScheduledOrbJob(job, { runPlanner, runFallback });
    await secondRun; // 第二個會立刻 return(被跳過)

    expect(runPlanner).toHaveBeenCalledTimes(1); // 第二個沒進 planner
    expect(job.lastRunStatus).toBe("skipped:in_flight");

    // 收尾:讓第一個跑完,避免 promise leak。
    resolveFirst!(makeInvalidPlannerResult());
    await firstRun;
  });

  it("第一個跑完後,第三個呼叫不再被跳過", async () => {
    const job = makeJob();
    const runPlanner = vi.fn().mockResolvedValue(makeInvalidPlannerResult());
    const runFallback = vi.fn().mockResolvedValue("第一輪結果");

    await runScheduledOrbJob(job, { runPlanner, runFallback });
    expect(job.lastRunStatus).toBe("fallback:invalid");

    // 第二輪改 fallback 回應,確認真的跑了第二次而不是延用第一次。
    runFallback.mockResolvedValueOnce("第二輪結果");
    await runScheduledOrbJob(job, { runPlanner, runFallback });
    expect(runPlanner).toHaveBeenCalledTimes(2);
    expect(job.lastResult).toContain("第二輪");
  });

  it("第一個 throw 後 lock 也會釋放,後續可以重跑", async () => {
    const job = makeJob();
    const failingPlanner = vi.fn().mockRejectedValue(new Error("network blip"));
    const okPlanner = vi.fn().mockResolvedValue(makeInvalidPlannerResult());
    const runFallback = vi.fn().mockResolvedValue("恢復後的結果");

    await runScheduledOrbJob(job, { runPlanner: failingPlanner, runFallback });
    expect(job.lastRunStatus).toBe("error");

    // try/finally 釋放 lock 後,新 runner 必須能進去。
    await runScheduledOrbJob(job, { runPlanner: okPlanner, runFallback });
    expect(job.lastRunStatus).toBe("fallback:invalid");
    expect(okPlanner).toHaveBeenCalledOnce();
  });

  it("不同 jobId 的並發互不影響,各跑各的", async () => {
    const jobA = makeJob({ id: "job-a" });
    const jobB = makeJob({ id: "job-b" });
    const runPlanner = vi.fn().mockResolvedValue(makeInvalidPlannerResult());
    const runFallback = vi.fn().mockResolvedValue("OK");

    await Promise.all([
      runScheduledOrbJob(jobA, { runPlanner, runFallback }),
      runScheduledOrbJob(jobB, { runPlanner, runFallback }),
    ]);

    // 兩個不同 job 各自走完整 flow,共 2 次 planner。
    expect(runPlanner).toHaveBeenCalledTimes(2);
    expect(jobA.lastRunStatus).toBe("fallback:invalid");
    expect(jobB.lastRunStatus).toBe("fallback:invalid");
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
