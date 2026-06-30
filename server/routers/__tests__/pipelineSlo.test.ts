/**
 * pipelineSlo.test.ts — AIDV-482 /video pipeline latency SLO baselines
 *
 * 純 TypeScript 邏輯，鏡射 Supabase migration 中的三支函式：
 *   detect_stalled_tasks()  → isStalled()
 *   get_task_slo_status()   → getSloState() + estimateEtaSeconds()
 *   get_project_slo_report() → buildProjectSloReport()
 *
 * 測試場景：
 *   1. on_track：剛啟動任務不算超時
 *   2. alerting：超過 target_seconds 但未達 alert_seconds
 *   3. stalled：超過 alert_seconds
 *   4. queued：started_at 為 null
 *   5. 未知 agent_type 使用預設 SLO（600s/900s）
 *   6. isStalled 正確過濾
 *   7. estimateEtaSeconds on_track / alerting / stalled / queued
 *   8. buildProjectSloReport 摘要計數正確
 *   9. 全已完成專案報告
 */

import { describe, it, expect } from "vitest";

// ── SLO 設定（鏡射 migration seeds）────────────────────────────────────────────

type SloConfig = { target_seconds: number; alert_seconds: number };
type SloMap = Record<string, SloConfig>;

const DEFAULT_SLO: SloMap = {
  "scene-composer-v1":  { target_seconds: 180,  alert_seconds: 300  },
  "script-analyzer-v1": { target_seconds: 120,  alert_seconds: 240  },
  "video-processor-v1": { target_seconds: 600,  alert_seconds: 900  },
  "__total_pipeline__":  { target_seconds: 900,  alert_seconds: 1500 },
};

const FALLBACK_SLO: SloConfig = { target_seconds: 600, alert_seconds: 900 };

function getSlo(agentType: string, sloMap: SloMap): SloConfig {
  return sloMap[agentType] ?? FALLBACK_SLO;
}

// ── 鏡射 get_task_slo_status() 的核心邏輯 ───────────────────────────────────────

type SloState = "on_track" | "alerting" | "stalled" | "queued" | "completed";

function getSloState(
  status: string,
  startedAt: Date | null,
  agentType: string,
  sloMap: SloMap,
  now = new Date()
): SloState {
  if (["completed", "dead_letter", "failed"].includes(status)) return "completed";
  if (!startedAt) return "queued";
  const elapsed = (now.getTime() - startedAt.getTime()) / 1000;
  const slo = getSlo(agentType, sloMap);
  if (elapsed >= slo.alert_seconds)  return "stalled";
  if (elapsed >= slo.target_seconds) return "alerting";
  return "on_track";
}

function estimateEtaSeconds(
  status: string,
  startedAt: Date | null,
  agentType: string,
  sloMap: SloMap,
  now = new Date()
): number {
  if (["completed", "dead_letter", "failed"].includes(status)) return 0;
  const slo = getSlo(agentType, sloMap);
  if (!startedAt) return slo.target_seconds;
  const elapsed = (now.getTime() - startedAt.getTime()) / 1000;
  if (elapsed >= slo.alert_seconds)  return 0;
  if (elapsed >= slo.target_seconds) return Math.round(slo.alert_seconds - elapsed);
  return Math.round(slo.target_seconds - elapsed);
}

// ── 鏡射 detect_stalled_tasks()：elapsed > alert_seconds ─────────────────────────

function isStalled(
  status: string,
  startedAt: Date | null,
  agentType: string,
  sloMap: SloMap,
  now = new Date()
): boolean {
  if (status !== "in_progress" || !startedAt) return false;
  const elapsed = (now.getTime() - startedAt.getTime()) / 1000;
  return elapsed > getSlo(agentType, sloMap).alert_seconds;
}

// ── 鏡射 get_project_slo_report() ───────────────────────────────────────────────

type TaskRow = {
  id: string;
  status: string;
  assigned_agent: string;
  started_at: Date | null;
};

type SloReport = {
  task_count: number;
  summary: Record<SloState, number>;
  tasks: Array<{ task_id: string; slo_state: SloState; eta_seconds: number }>;
};

function buildProjectSloReport(tasks: TaskRow[], sloMap: SloMap, now = new Date()): SloReport {
  const summary: Record<SloState, number> = {
    on_track: 0, alerting: 0, stalled: 0, completed: 0, queued: 0,
  };
  const taskDetails = tasks.map(t => {
    const slo_state = getSloState(t.status, t.started_at, t.assigned_agent, sloMap, now);
    const eta_seconds = estimateEtaSeconds(t.status, t.started_at, t.assigned_agent, sloMap, now);
    summary[slo_state] += 1;
    return { task_id: t.id, slo_state, eta_seconds };
  });
  return { task_count: tasks.length, summary, tasks: taskDetails };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AIDV-482 SLO helpers", () => {
  const NOW = new Date("2026-06-30T12:00:00Z");

  function secsAgo(s: number): Date {
    return new Date(NOW.getTime() - s * 1000);
  }

  // 1. on_track
  it("on_track：任務剛啟動，elapsed < target_seconds", () => {
    const started = secsAgo(60); // 60s ago, target=180s
    expect(getSloState("in_progress", started, "scene-composer-v1", DEFAULT_SLO, NOW)).toBe("on_track");
  });

  // 2. alerting
  it("alerting：elapsed >= target_seconds 但 < alert_seconds", () => {
    const started = secsAgo(200); // 200s, target=180s, alert=300s
    expect(getSloState("in_progress", started, "scene-composer-v1", DEFAULT_SLO, NOW)).toBe("alerting");
  });

  // 3. stalled
  it("stalled：elapsed >= alert_seconds", () => {
    const started = secsAgo(400); // 400s, alert=300s
    expect(getSloState("in_progress", started, "scene-composer-v1", DEFAULT_SLO, NOW)).toBe("stalled");
  });

  // 4. queued
  it("queued：started_at = null", () => {
    expect(getSloState("in_progress", null, "scene-composer-v1", DEFAULT_SLO, NOW)).toBe("queued");
  });

  // 5. completed
  it("completed：status=completed → slo_state=completed", () => {
    const started = secsAgo(50);
    expect(getSloState("completed", started, "scene-composer-v1", DEFAULT_SLO, NOW)).toBe("completed");
    expect(getSloState("dead_letter", started, "video-processor-v1", DEFAULT_SLO, NOW)).toBe("completed");
    expect(getSloState("failed", started, "script-analyzer-v1", DEFAULT_SLO, NOW)).toBe("completed");
  });

  // 6. 未知 agent_type 使用預設 SLO（600s/900s）
  it("未知 agent_type 使用 fallback SLO（600s/900s）", () => {
    const started600 = secsAgo(601); // > 600s target, < 900s alert
    expect(getSloState("in_progress", started600, "unknown-agent-v99", DEFAULT_SLO, NOW)).toBe("alerting");
    const started901 = secsAgo(901); // > 900s alert
    expect(getSloState("in_progress", started901, "unknown-agent-v99", DEFAULT_SLO, NOW)).toBe("stalled");
  });

  // 7a. estimateEtaSeconds on_track
  it("estimateEtaSeconds on_track：剩餘時間約等於 target - elapsed", () => {
    const started = secsAgo(60);
    const eta = estimateEtaSeconds("in_progress", started, "scene-composer-v1", DEFAULT_SLO, NOW);
    expect(eta).toBeGreaterThanOrEqual(119);
    expect(eta).toBeLessThanOrEqual(121); // ~120s remaining
  });

  // 7b. estimateEtaSeconds alerting
  it("estimateEtaSeconds alerting：剩餘時間為 alert - elapsed", () => {
    const started = secsAgo(200);
    const eta = estimateEtaSeconds("in_progress", started, "scene-composer-v1", DEFAULT_SLO, NOW);
    expect(eta).toBeGreaterThanOrEqual(99);
    expect(eta).toBeLessThanOrEqual(101); // alert(300) - elapsed(200) = 100
  });

  // 7c. estimateEtaSeconds stalled
  it("estimateEtaSeconds stalled：eta=0", () => {
    const started = secsAgo(400);
    const eta = estimateEtaSeconds("in_progress", started, "scene-composer-v1", DEFAULT_SLO, NOW);
    expect(eta).toBe(0);
  });

  // 7d. estimateEtaSeconds queued
  it("estimateEtaSeconds queued：eta = target_seconds", () => {
    const eta = estimateEtaSeconds("in_progress", null, "scene-composer-v1", DEFAULT_SLO, NOW);
    expect(eta).toBe(180);
  });

  // 7e. estimateEtaSeconds completed
  it("estimateEtaSeconds completed：eta=0", () => {
    const eta = estimateEtaSeconds("completed", secsAgo(50), "scene-composer-v1", DEFAULT_SLO, NOW);
    expect(eta).toBe(0);
  });

  // 8. isStalled 過濾
  it("isStalled：僅 in_progress 且 elapsed > alert_seconds 才回 true", () => {
    expect(isStalled("in_progress", secsAgo(400), "scene-composer-v1", DEFAULT_SLO, NOW)).toBe(true);
    expect(isStalled("in_progress", secsAgo(200), "scene-composer-v1", DEFAULT_SLO, NOW)).toBe(false);
    expect(isStalled("completed",   secsAgo(400), "scene-composer-v1", DEFAULT_SLO, NOW)).toBe(false);
    expect(isStalled("in_progress", null,          "scene-composer-v1", DEFAULT_SLO, NOW)).toBe(false);
  });

  // 9. buildProjectSloReport 摘要計數
  it("buildProjectSloReport：摘要計數正確（on_track + alerting + stalled + queued）", () => {
    const tasks: TaskRow[] = [
      { id: "t1", status: "in_progress", assigned_agent: "scene-composer-v1",  started_at: secsAgo(60)  }, // on_track
      { id: "t2", status: "in_progress", assigned_agent: "scene-composer-v1",  started_at: secsAgo(200) }, // alerting
      { id: "t3", status: "in_progress", assigned_agent: "scene-composer-v1",  started_at: secsAgo(400) }, // stalled
      { id: "t4", status: "in_progress", assigned_agent: "script-analyzer-v1", started_at: null         }, // queued
      { id: "t5", status: "completed",   assigned_agent: "video-processor-v1", started_at: secsAgo(700) }, // completed
    ];
    const report = buildProjectSloReport(tasks, DEFAULT_SLO, NOW);
    expect(report.task_count).toBe(5);
    expect(report.summary.on_track).toBe(1);
    expect(report.summary.alerting).toBe(1);
    expect(report.summary.stalled).toBe(1);
    expect(report.summary.queued).toBe(1);
    expect(report.summary.completed).toBe(1);
  });

  // 10. 全已完成專案
  it("全已完成專案：所有任務 slo_state=completed", () => {
    const tasks: TaskRow[] = [
      { id: "t1", status: "completed",   assigned_agent: "scene-composer-v1",  started_at: secsAgo(100) },
      { id: "t2", status: "dead_letter", assigned_agent: "script-analyzer-v1", started_at: secsAgo(200) },
    ];
    const report = buildProjectSloReport(tasks, DEFAULT_SLO, NOW);
    expect(report.summary.completed).toBe(2);
    expect(report.summary.stalled).toBe(0);
    expect(report.tasks.every(t => t.slo_state === "completed")).toBe(true);
    expect(report.tasks.every(t => t.eta_seconds === 0)).toBe(true);
  });

  // 11. 空專案
  it("空專案：task_count=0，摘要全 0", () => {
    const report = buildProjectSloReport([], DEFAULT_SLO, NOW);
    expect(report.task_count).toBe(0);
    expect(Object.values(report.summary).every(n => n === 0)).toBe(true);
    expect(report.tasks).toHaveLength(0);
  });

  // 12. __total_pipeline__ 的 SLO 目標值正確
  it("__total_pipeline__ target=900s / alert=1500s", () => {
    const slo = getSlo("__total_pipeline__", DEFAULT_SLO);
    expect(slo.target_seconds).toBe(900);
    expect(slo.alert_seconds).toBe(1500);
  });

  // 13. video-processor-v1 大型任務 SLO 邊界
  it("video-processor-v1：599s → on_track，601s → alerting，901s → stalled", () => {
    const agent = "video-processor-v1";
    expect(getSloState("in_progress", secsAgo(599), agent, DEFAULT_SLO, NOW)).toBe("on_track");
    expect(getSloState("in_progress", secsAgo(601), agent, DEFAULT_SLO, NOW)).toBe("alerting");
    expect(getSloState("in_progress", secsAgo(901), agent, DEFAULT_SLO, NOW)).toBe("stalled");
  });
});
