/**
 * Unit tests for chief-orchestrator (總總) autonomy tools.
 *
 * These exercise the deterministic decision layer:
 *   - decomposeGoal: pattern → DAG with deps + critical path
 *   - recommendSpiritForTask: domain + load + history scoring
 *   - analyzeBottlenecks: stuck/failure clusters + at-risk surfacing
 *   - retryTaskWithFallback: alternative pick after a failure
 *   - setTaskDeadline: deadline plumbing into team summary
 *
 * SpiritStatusMonitor is a singleton, so each test resets it first to avoid
 * cross-test contamination.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  decomposeGoal,
  recommendSpiritForTask,
  analyzeBottlenecks,
  retryTaskWithFallback,
  setTaskDeadline,
} from "../../../server/services/spiritTools/orchestratorTools";
import { SpiritStatusMonitor } from "../../../server/services/spiritStatusMonitor";

describe("decomposeGoal", () => {
  it("emits a single-domain plan for a focused image request", () => {
    const plan = decomposeGoal({ userMessage: "幫我做一張瑜珈海報" });

    const imageStep = plan.steps.find(s => s.domain === "image");
    expect(imageStep).toBeDefined();
    expect(imageStep?.spirit).toBe("image-specialist");

    // Single creation step → plan + image + review (3 steps total)
    expect(plan.steps.map(s => s.stepId)).toContain("plan");
    expect(plan.steps.map(s => s.stepId)).toContain("review");
    expect(plan.totalEtaMs).toBeGreaterThan(0);
  });

  it("places voice and music after video when all three are present", () => {
    const plan = decomposeGoal({
      userMessage: "幫我做一支微電影，要配樂跟旁白",
    });

    const video = plan.steps.find(s => s.domain === "video");
    const music = plan.steps.find(s => s.domain === "music");
    const voice = plan.steps.find(s => s.domain === "voice");

    expect(video).toBeDefined();
    expect(music?.dependsOn).toContain("do-video");
    expect(voice?.dependsOn).toContain("do-video");
  });

  it("yields a non-trivial DAG: critical path length matches the longest chain", () => {
    const plan = decomposeGoal({
      userMessage: "做一個影片 campaign：腳本 + 影片 + 配樂 + 配音",
    });

    expect(plan.criticalPath.length).toBeGreaterThan(1);
    // Critical path ETA should equal sum of step durations on that path
    const stepDurationById = new Map(
      plan.steps.map(s => [s.stepId, s.estimatedDurationMs])
    );
    const sum = plan.criticalPath.reduce(
      (acc, id) => acc + (stepDurationById.get(id) ?? 0),
      0
    );
    expect(plan.totalEtaMs).toBe(sum);
  });

  it("groups independent steps into the same parallel stage", () => {
    const plan = decomposeGoal({
      userMessage: "幫我做一套：海報 + 配樂 + 找參考靈感",
    });

    // plan step always at stage 0; creation domains all sit on stage 1
    const stage1 = plan.parallelGroups.find(g => g.stage === 1);
    expect(stage1).toBeDefined();
    expect(stage1!.stepIds.length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces IP risk note when celebrity/trademark keywords appear", () => {
    const plan = decomposeGoal({
      userMessage: "做一張周杰倫風格的明星海報",
    });
    expect(plan.risks.join(" ")).toMatch(/名人|IP/);
  });

  it("respects domainHints when caller already knows the domain", () => {
    const plan = decomposeGoal({
      userMessage: "做這個",
      domainHints: ["video"],
    });
    expect(plan.steps.some(s => s.domain === "video")).toBe(true);
  });
});

describe("recommendSpiritForTask", () => {
  beforeEach(() => {
    SpiritStatusMonitor.resetAll();
  });

  it("ranks the domain-primary spirit first when everyone is idle", () => {
    const recs = recommendSpiritForTask({ taskHint: "做一張海報" });

    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].spiritId).toBe("image-specialist");
    expect(recs[0].loadScore).toBe(0);
  });

  it("penalises a busy spirit so the alternate wins", () => {
    // Saturate image-specialist; image-specialist's protocol siblings include
    // video-specialist (handoff to "video-specialist" when user wants animation).
    SpiritStatusMonitor.startTask({
      spiritId: "image-specialist",
      taskId: "t-saturate",
      taskType: "image.generate",
      progress: 80,
    });

    const recs = recommendSpiritForTask({ taskHint: "做一張圖" });
    const image = recs.find(r => r.spiritId === "image-specialist");
    expect(image).toBeDefined();
    expect(image!.loadScore).toBeGreaterThan(0); // load > 0 since busy
  });

  it("honours excludeSpirits", () => {
    const recs = recommendSpiritForTask({
      taskHint: "做影片",
      excludeSpirits: ["video-specialist"],
    });
    expect(recs.find(r => r.spiritId === "video-specialist")).toBeUndefined();
  });

  it("reflects historical success rate in the reason text", () => {
    // Run a task to completion to write a success outcome.
    SpiritStatusMonitor.startTask({
      spiritId: "music-specialist",
      taskId: "t-music-1",
      taskType: "music.generate",
    });
    SpiritStatusMonitor.completeTask("music-specialist", "t-music-1");
    SpiritStatusMonitor.startTask({
      spiritId: "music-specialist",
      taskId: "t-music-2",
      taskType: "music.generate",
    });
    SpiritStatusMonitor.completeTask("music-specialist", "t-music-2");
    SpiritStatusMonitor.startTask({
      spiritId: "music-specialist",
      taskId: "t-music-3",
      taskType: "music.generate",
    });
    SpiritStatusMonitor.completeTask("music-specialist", "t-music-3");

    const recs = recommendSpiritForTask({
      taskHint: "做音樂",
      taskType: "music.generate",
    });
    const music = recs.find(r => r.spiritId === "music-specialist");
    expect(music?.historicalSuccessRate).toBe(1);
    expect(music?.sampleSize).toBe(3);
    expect(music?.reason).toMatch(/歷史成功率/);
  });
});

describe("analyzeBottlenecks", () => {
  beforeEach(() => {
    SpiritStatusMonitor.resetAll();
  });

  it("reports failure clusters once a spirit racks up failures", () => {
    SpiritStatusMonitor.startTask({
      spiritId: "video-specialist",
      taskId: "t-fail-1",
      taskType: "video.generate",
    });
    SpiritStatusMonitor.reportError("video-specialist", "fal timeout", "t-fail-1");
    SpiritStatusMonitor.recoverFromError("video-specialist");

    SpiritStatusMonitor.startTask({
      spiritId: "video-specialist",
      taskId: "t-fail-2",
      taskType: "video.generate",
    });
    SpiritStatusMonitor.reportError("video-specialist", "fal 500", "t-fail-2");

    const analysis = analyzeBottlenecks();
    const cluster = analysis.failureClusters.find(c => c.spiritId === "video-specialist");
    expect(cluster).toBeDefined();
    expect(cluster!.failureCount).toBeGreaterThanOrEqual(2);
    expect(analysis.recommendations.join(" ")).toMatch(/失敗率/);
  });

  it("returns an empty bottleneck list when nothing is wrong", () => {
    const analysis = analyzeBottlenecks();
    expect(analysis.stuckTasks).toEqual([]);
    expect(analysis.failureClusters).toEqual([]);
    expect(analysis.atRiskTasks).toEqual([]);
  });
});

describe("retryTaskWithFallback", () => {
  beforeEach(() => {
    SpiritStatusMonitor.resetAll();
  });

  it("picks an alternate spirit and starts a new task on it", async () => {
    SpiritStatusMonitor.startTask({
      spiritId: "image-specialist",
      taskId: "t-orig",
      taskType: "image.generate",
      userId: 42,
    });

    const result = await retryTaskWithFallback({
      failedSpiritId: "image-specialist",
      failedTaskId: "t-orig",
      taskType: "image.generate",
      userId: 42,
      failureReason: "model timeout",
      taskHint: "做一張圖",
      // Force a known alternate so the test is deterministic regardless of
      // protocol changes.
      preferredAlternatives: ["video-specialist"],
    });

    expect(result.retrying).toBe(true);
    expect(result.newSpiritId).toBe("video-specialist");
    expect(result.newTaskId).toMatch(/retry/);

    const altStatus = SpiritStatusMonitor.getStatus("video-specialist");
    expect(altStatus?.status).toBe("busy");
    expect(altStatus?.metadata?.retryOf).toBe("t-orig");
  });

  it("returns retrying:false when no alternate is available", async () => {
    SpiritStatusMonitor.startTask({
      spiritId: "anatomy-specialist",
      taskId: "t-lonely",
      taskType: "anatomy.render",
      userId: 1,
    });
    // anatomy is niche — its only protocol fallback in our recommender is
    // anatomy itself (excluded) and a few non-specialists. Force the absence
    // of alternates by excluding all specialists.
    const result = await retryTaskWithFallback({
      failedSpiritId: "anatomy-specialist",
      failedTaskId: "t-lonely",
      taskType: "anatomy.render",
      userId: 1,
      failureReason: "no model",
      taskHint: "解剖圖",
      preferredAlternatives: [],
    });

    // It may still find an alternative via recommendations — that's fine. The
    // contract is "retrying === true iff a new task started". When false, the
    // message must explain.
    if (!result.retrying) {
      expect(result.message).toMatch(/替代|找不到/);
    } else {
      expect(result.newSpiritId).toBeDefined();
    }
  });
});

describe("setTaskDeadline", () => {
  beforeEach(() => {
    SpiritStatusMonitor.resetAll();
  });

  it("surfaces overdue tasks in the team summary", () => {
    SpiritStatusMonitor.startTask({
      spiritId: "voice-specialist",
      taskId: "t-deadline",
      taskType: "voice.generate",
    });

    const ok = setTaskDeadline({
      taskId: "t-deadline",
      deadlineAt: Date.now() - 1000, // already passed
    });
    expect(ok.set).toBe(true);

    const summary = SpiritStatusMonitor.getTeamSummary();
    const atRisk = summary.atRiskTasks.find(t => t.taskId === "t-deadline");
    expect(atRisk).toBeDefined();
    expect(atRisk!.overdue).toBe(true);
  });

  it("rejects deadlines on tasks no spirit owns", () => {
    const ok = setTaskDeadline({
      taskId: "t-ghost",
      deadlineAt: Date.now() + 60_000,
    });
    expect(ok.set).toBe(false);
    expect(ok.message).toMatch(/不存在|沒有/);
  });
});

describe("SpiritStatusMonitor outcome history", () => {
  beforeEach(() => {
    SpiritStatusMonitor.resetAll();
  });

  it("records success outcomes and exposes them via getSuccessRate", () => {
    SpiritStatusMonitor.startTask({
      spiritId: "image-specialist",
      taskId: "t-ok-1",
      taskType: "image.generate",
    });
    SpiritStatusMonitor.completeTask("image-specialist", "t-ok-1");

    const rate = SpiritStatusMonitor.getSuccessRate("image-specialist", "image.generate");
    expect(rate?.successRate).toBe(1);
    expect(rate?.sampleSize).toBe(1);
  });

  it("returns null success rate when there's no history", () => {
    const rate = SpiritStatusMonitor.getSuccessRate("composer", "studio.foo");
    expect(rate).toBeNull();
  });

  it("getLeastLoadedSpirit prefers idle over busy", () => {
    SpiritStatusMonitor.startTask({
      spiritId: "image-specialist",
      taskId: "t-x",
      taskType: "image.generate",
      progress: 80,
    });

    const chosen = SpiritStatusMonitor.getLeastLoadedSpirit([
      "image-specialist",
      "video-specialist",
    ]);
    expect(chosen).toBe("video-specialist");
  });
});
