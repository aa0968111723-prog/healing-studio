/**
 * orbTaskChainRunner.ts — Agent loop v2 ("continue" half).
 *
 * Wraps `runOrbTaskToCompletion` + `observeOrbTaskOutcome` in a bounded
 * loop. When the post-mortem observer says `kind: "continue"`, we
 * re-invoke the planner with the original conversation + a synthetic
 * "previous attempt" recap, materialise the new plan as a fresh
 * OrbAgentTask + legacy OrbTask, link it back to the predecessor, and
 * drive it. Capped at `maxIterations` (default 2) so a flaky LLM cannot
 * recurse forever.
 *
 * Why a wrapper instead of folding into `runOrbTaskToCompletion`:
 *   - The orchestrator is deterministic step execution; mixing planner
 *     calls in there blurs the layer boundary and would force the
 *     planner inputs (Message[], preferences, page snapshot…) into the
 *     orchestrator's signature.
 *   - The chain runner is the natural home for cross-task concerns:
 *     observation, replan budget, predecessor linking, audit events.
 *
 * Off by default — wired in via `driveOrbTaskInBackground` behind the
 * `ORB_OBSERVATION_LOOP=1` env flag.
 */

import type { Message } from "../_core/llm";
import type { OrbApiTool } from "./agentToolExecutor";
import type { AgentPreferences } from "../../shared/agent-preferences";
import type {
  RunOrbTaskInput,
  RunOrbTaskResult,
} from "./orbTaskOrchestrator";
import { runOrbTaskToCompletion } from "./orbTaskOrchestrator";
import {
  observeOrbTaskOutcome,
  observationToAuditMessage,
  observationToAuditMetadata,
  type TaskObservation,
} from "./orbTaskObserver";
import {
  appendOrbAgentTaskAuditEvent,
  createOrbAgentTaskFromPlanner,
  getOrbAgentTask,
  linkOrbAgentTaskPredecessor,
} from "./orbTaskStateMachine";
import {
  deleteOrbTaskPlannerContext,
  getOrbTaskPlannerContext,
  setOrbTaskPlannerContext,
  type StoredOrbTaskPlannerContext,
} from "./orbTaskPlannerContextStore";
import {
  deleteOrbTaskPageState,
  getOrbTaskPageState,
} from "./orbTaskPageStateStore";
import { runSchemaFirstAgentPlanner } from "./agentPlanner";
import type { AgentPlannerInput } from "./agentPlanner";
import { orbTaskRepository } from "../repositories/orbTaskRepository";
import { emitGenerationEvent } from "../generationEvents";
import { recordOrbTaskMemory } from "./orbTaskMemory";

// ─── Types ────────────────────────────────────────────────────────────────

export type OrbTaskChainStopReason =
  | "completed"
  | "abort"
  | "needs_user"
  | "no_continuation_context"
  | "planner_no_task"
  | "max_iterations";

export interface OrbTaskChainIteration {
  taskId: string;
  iterationIndex: number;
  runResult: RunOrbTaskResult;
  observation: TaskObservation | null;
  /** When this iteration was created from a replan, the planner gating
   *  status that produced it. */
  plannerStatus?: string;
}

export interface OrbTaskChainResult {
  iterations: OrbTaskChainIteration[];
  finalTaskId: string;
  stopReason: OrbTaskChainStopReason;
}

export interface RunOrbTaskChainInput {
  initialTaskId: string;
  userId: number;
  userRole: string;
  tools: OrbApiTool[];
  agentPreferences?: AgentPreferences;
  /** Total chain iterations including the initial task. Default 2 — i.e.
   *  one replan attempt at most. Hard-capped to 4 so a misconfigured
   *  caller still cannot runaway. */
  maxIterations?: number;
  onToolAuditEvent?: RunOrbTaskInput["onToolAuditEvent"];
  /** Test seam — replaces `runSchemaFirstAgentPlanner`. */
  invokePlanner?: typeof runSchemaFirstAgentPlanner;
  /** Test seam — replaces `observeOrbTaskOutcome`. */
  invokeObserver?: typeof observeOrbTaskOutcome;
  /** Test seam — replaces `runOrbTaskToCompletion`. */
  runTask?: typeof runOrbTaskToCompletion;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const HARD_CAP_ITERATIONS = 4;

function clampMaxIterations(n: number | undefined): number {
  const raw = typeof n === "number" && n > 0 ? n : 2;
  return Math.min(Math.max(1, Math.floor(raw)), HARD_CAP_ITERATIONS);
}

/**
 * Build a synthetic user message that recaps the previous attempt for
 * the replan call. The planner sees the original conversation plus this
 * recap; the system prompt already tells it to ground every step in the
 * user's intent so a clean recap is the most-leverage signal.
 */
function buildReplanRecapMessage(
  observation: Extract<TaskObservation, { kind: "continue" }>,
  prevRunResult: RunOrbTaskResult
): string {
  const lines: string[] = [
    "上一輪自動執行已結束，但結果不算完整。請基於之前的對話與下方執行紀錄，",
    "提出一個能延續完成原始目標的新計畫（不要從頭重來，要接著上一輪的成果繼續）。",
    "",
    `先前 outcome：${prevRunResult.outcome}${prevRunResult.reason ? ` (${prevRunResult.reason})` : ""}`,
    `先前實際跑完步驟：${prevRunResult.stepsRun}`,
    `光球觀察員的分析：${observation.reason}`,
    `光球建議的下一步方向：${observation.suggestedNextAction}`,
    "",
    "請輸出一份新的 agent-plan-v3，可以引用上一輪步驟的結果（用 ${stepN.x} 語法）；",
    "若上一輪已經產生 video_url / image_url / 等可重用輸出，務必接著用而不是重做。",
  ];
  return lines.join("\n");
}

interface ReplanResult {
  ok: boolean;
  newTaskId?: string;
  plannerStatus?: string;
  reason?: string;
}

async function tryReplanAndCreateTask(args: {
  prevTaskId: string;
  prevRunResult: RunOrbTaskResult;
  observation: Extract<TaskObservation, { kind: "continue" }>;
  context: StoredOrbTaskPlannerContext;
  userId: number;
  iterationIndex: number;
  invokePlanner: typeof runSchemaFirstAgentPlanner;
}): Promise<ReplanResult> {
  const recap = buildReplanRecapMessage(args.observation, args.prevRunResult);
  const replanMessages: Message[] = [
    ...args.context.messages,
    { role: "user", content: recap } as Message,
  ];

  const plannerInput: AgentPlannerInput = {
    messages: replanMessages,
    context: args.context.context,
    personality: args.context.personality,
    pageSnapshot: args.context.pageSnapshot,
    recentFeedback: args.context.recentFeedback,
    recentTaskMemorySummary: args.context.recentTaskMemorySummary,
    recentOrbMemorySummary: args.context.recentOrbMemorySummary,
    siteKnowledgeSummary: args.context.siteKnowledgeSummary,
    preferences: args.context.preferences,
  };

  let plannerResult;
  try {
    plannerResult = await args.invokePlanner(plannerInput);
  } catch (err) {
    return {
      ok: false,
      reason: `replan-planner-threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (plannerResult.status !== "tasked" || !plannerResult.task) {
    return {
      ok: false,
      plannerStatus: plannerResult.status,
      reason: `replan-not-tasked: ${plannerResult.status}`,
    };
  }

  // Materialise FSM task. createOrbAgentTaskFromPlanner internally drops
  // claudeCode / approval-required plans into a paused state; that's the
  // correct behaviour even on the continuation path.
  const stateMachineTask = createOrbAgentTaskFromPlanner(plannerResult);
  if (!stateMachineTask) {
    return {
      ok: false,
      plannerStatus: plannerResult.status,
      reason: "replan-fsm-create-failed",
    };
  }

  // Mirror into the legacy store so the orchestrator can drive it. Same
  // pattern as the brain router after first-time plan creation.
  try {
    orbTaskRepository.create({
      taskId: stateMachineTask.taskId,
      userId: args.userId,
      intent: plannerResult.task.intent,
      needsApproval: plannerResult.task.needsApproval,
      steps: plannerResult.task.steps.map(step => ({
        id: step.id,
        label: step.label,
        pagePath: step.pagePath,
        uiActions: step.uiActions,
        toolCalls: step.toolCalls,
      })),
    });
  } catch (err) {
    return {
      ok: false,
      plannerStatus: plannerResult.status,
      reason: `replan-legacy-mirror-failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Link continuation chain.
  linkOrbAgentTaskPredecessor(
    stateMachineTask.taskId,
    args.prevTaskId,
    args.iterationIndex
  );

  // Carry the planner context onto the new taskId so subsequent
  // iterations can also replan if needed.
  setOrbTaskPlannerContext(stateMachineTask.taskId, {
    userId: args.context.userId,
    userRole: args.context.userRole,
    messages: replanMessages,
    context: args.context.context,
    personality: args.context.personality,
    pageSnapshot: args.context.pageSnapshot,
    recentFeedback: args.context.recentFeedback,
    recentTaskMemorySummary: args.context.recentTaskMemorySummary,
    recentOrbMemorySummary: args.context.recentOrbMemorySummary,
    siteKnowledgeSummary: args.context.siteKnowledgeSummary,
    preferences: args.context.preferences,
  });

  // Audit-event on the predecessor: explains why the chain extended.
  appendOrbAgentTaskAuditEvent(
    args.prevTaskId,
    "task.continuation_started",
    `Continuation task created: ${stateMachineTask.taskId} (iteration ${args.iterationIndex})`,
    {
      successorTaskId: stateMachineTask.taskId,
      iterationIndex: args.iterationIndex,
      observation: args.observation,
    }
  );

  return {
    ok: true,
    newTaskId: stateMachineTask.taskId,
    plannerStatus: plannerResult.status,
  };
}

// ─── Main entry ───────────────────────────────────────────────────────────

/**
 * Drive a task through the bounded continuation loop:
 *   iteration 0 → run orchestrator → observe → exit OR replan → new task
 *   iteration 1 → ... (until terminal observation OR maxIterations OR replan fails)
 *
 * Always returns; never throws. Even when the planner / observer fail
 * the result includes the iteration log so callers can render meaningful
 * audit + telemetry.
 */
export async function runOrbTaskWithContinuationLoop(
  input: RunOrbTaskChainInput
): Promise<OrbTaskChainResult> {
  const maxIterations = clampMaxIterations(input.maxIterations);
  const runTask = input.runTask ?? runOrbTaskToCompletion;
  const invokeObserver = input.invokeObserver ?? observeOrbTaskOutcome;
  const invokePlanner = input.invokePlanner ?? runSchemaFirstAgentPlanner;

  const iterations: OrbTaskChainIteration[] = [];
  let currentTaskId = input.initialTaskId;
  let stopReason: OrbTaskChainStopReason = "max_iterations";

  const startedAt = Date.now();
  // Best-effort telemetry; emit failures shouldn't break the loop.
  try {
    emitGenerationEvent({
      type: "chain_started",
      taskId: input.initialTaskId,
      userId: input.userId,
      maxIterations,
      at: startedAt,
    });
  } catch {
    // ignore — pure observability event
  }

  for (let iter = 0; iter < maxIterations; iter += 1) {
    const runResult = await runTask({
      taskId: currentTaskId,
      userId: input.userId,
      userRole: input.userRole,
      tools: input.tools,
      agentPreferences: input.agentPreferences,
      requestId: `orb_chain_${currentTaskId}_${Date.now()}`,
      onToolAuditEvent: input.onToolAuditEvent,
    });

    let observation: TaskObservation | null = null;
    try {
      observation = await invokeObserver({
        intent:
          getOrbAgentTask(currentTaskId)?.intent ??
          runResult.finalTask?.intent ??
          "",
        runResult,
        agentTask: getOrbAgentTask(currentTaskId),
        // Agent loop v5 — observer auto-pulls page-state snapshots
        // posted by the client during this task's run.
        taskId: currentTaskId,
      });
      // Persist observation as audit event on the current task.
      appendOrbAgentTaskAuditEvent(
        currentTaskId,
        "task.observed",
        observationToAuditMessage(observation),
        observationToAuditMetadata(observation)
      );
    } catch (err) {
      // Observer failure is non-fatal: record iteration without observation
      // and exit the chain; surface as a `task.observed` row so it's visible.
      appendOrbAgentTaskAuditEvent(
        currentTaskId,
        "task.observed",
        `Observer crashed: ${err instanceof Error ? err.message : String(err)}`,
        { error: true }
      );
    }

    iterations.push({
      taskId: currentTaskId,
      iterationIndex: iter,
      runResult,
      observation,
    });

    // Terminal observation kinds — stop here.
    if (!observation) {
      stopReason = "abort";
      break;
    }
    if (observation.kind === "complete") {
      stopReason = "completed";
      break;
    }
    if (observation.kind === "abort") {
      stopReason = "abort";
      break;
    }
    if (observation.kind === "needs_user") {
      stopReason = "needs_user";
      break;
    }

    // observation.kind === "continue" — try to replan.
    if (iter + 1 >= maxIterations) {
      stopReason = "max_iterations";
      break;
    }

    const ctx = getOrbTaskPlannerContext(currentTaskId);
    if (!ctx) {
      stopReason = "no_continuation_context";
      break;
    }

    const replan = await tryReplanAndCreateTask({
      prevTaskId: currentTaskId,
      prevRunResult: runResult,
      observation,
      context: ctx,
      userId: input.userId,
      iterationIndex: iter + 1,
      invokePlanner,
    });

    if (!replan.ok || !replan.newTaskId) {
      // Record why the replan failed so dashboards can surface this
      // separately from "model decided to abort".
      appendOrbAgentTaskAuditEvent(
        currentTaskId,
        "task.observed",
        `Continuation replan failed: ${replan.reason ?? "unknown"}`,
        { plannerStatus: replan.plannerStatus, reason: replan.reason }
      );
      stopReason = "planner_no_task";
      break;
    }

    // Hand off: predecessor's planner context + page state can be
    // dropped; successor already carries its own copy and will produce
    // its own snapshots once UI dispatches happen on the next iteration.
    deleteOrbTaskPlannerContext(currentTaskId);
    deleteOrbTaskPageState(currentTaskId);
    currentTaskId = replan.newTaskId;

    // Record on the iteration we're about to push for the new task.
    iterations[iterations.length - 1] = {
      ...iterations[iterations.length - 1],
      plannerStatus: replan.plannerStatus,
    };
  }

  // Snapshot the final task's page state BEFORE the cleanup below so
  // the chain memory entry can carry a compact "what the page looked
  // like when the chain ended" summary forward to the planner.
  const finalPageSnapshots = getOrbTaskPageState(currentTaskId);

  // Final cleanup of context for whichever task ended the chain.
  deleteOrbTaskPlannerContext(currentTaskId);
  deleteOrbTaskPageState(currentTaskId);

  try {
    emitGenerationEvent({
      type: "chain_completed",
      taskId: input.initialTaskId,
      finalTaskId: currentTaskId,
      userId: input.userId,
      iterations: iterations.length,
      stopReason,
      durationMs: Date.now() - startedAt,
      at: Date.now(),
    });
  } catch {
    // ignore — pure observability event
  }

  // Record one chain-level memory entry so the planner's
  // `recentTaskMemorySummary` context shows past chain outcomes when
  // making the next plan. This is what lets the agent eventually
  // "learn" — e.g. avoid retrying with the same failing model after
  // it failed last time.
  try {
    const initialAgent = getOrbAgentTask(input.initialTaskId);
    const finalAgent = getOrbAgentTask(currentTaskId);
    const memoryOutcome: "success" | "failure" | "cancelled" | "blocked" =
      stopReason === "completed"
        ? "success"
        : stopReason === "needs_user"
        ? "blocked"
        : "failure";
    const allActionTypes: string[] = [];
    for (const it of iterations) {
      const fsm = getOrbAgentTask(it.taskId);
      if (!fsm) continue;
      for (const s of fsm.steps) {
        if (s.actionType && !allActionTypes.includes(s.actionType)) {
          allActionTypes.push(s.actionType);
        }
      }
    }
    const failedReasonParts: string[] = [];
    if (stopReason !== "completed" && stopReason !== "needs_user") {
      failedReasonParts.push(`chain.${stopReason}`);
    }
    if (finalAgent?.failedReason) failedReasonParts.push(finalAgent.failedReason);
    const lastObservation = iterations[iterations.length - 1]?.observation;
    if (lastObservation && lastObservation.kind === "abort") {
      failedReasonParts.push(`observer:${lastObservation.failureCategory}`);
    }
    // Add a tiny "page-state at chain end" hint so a planner that sees
    // this memory next time can recognise the same trap (e.g. prompt
    // queued but never landed because tab switch never happened).
    // Bounded length so the memory summary stays compact for LLM
    // context budgets.
    if (finalPageSnapshots.length > 0) {
      const last = finalPageSnapshots[finalPageSnapshots.length - 1];
      const stateHint = JSON.stringify(last.state).slice(0, 80);
      const pageBit = last.pageId ? `${last.pageId}:` : "";
      const actionBit = last.actionType ? `${last.actionType} ` : "";
      failedReasonParts.push(`page:${pageBit}${actionBit}${stateHint}`);
    }
    recordOrbTaskMemory({
      taskId: input.initialTaskId,
      planId: initialAgent?.planId ?? input.initialTaskId,
      traceId: initialAgent?.traceId ?? input.initialTaskId,
      userIntent: initialAgent?.intent ?? finalAgent?.intent ?? "",
      outcome: memoryOutcome,
      failedReason: failedReasonParts.length > 0 ? failedReasonParts.join(" / ") : undefined,
      usedEngine: finalAgent?.preferredEngine ?? initialAgent?.preferredEngine ?? null,
      usedMultimodalPlanner: !!(initialAgent?.usedMultimodalPlanner ?? finalAgent?.usedMultimodalPlanner),
      actionTypes: allActionTypes,
      createdAt: Date.now(),
    });
  } catch (memError) {
    // recordOrbTaskMemory is in-memory only and should never throw, but
    // wrap defensively — chain memory is observability-only, never
    // critical to chain completion.
    console.warn(
      "[orbTaskChainRunner] recordOrbTaskMemory failed:",
      memError instanceof Error ? memError.message : String(memError)
    );
  }

  return {
    iterations,
    finalTaskId: currentTaskId,
    stopReason,
  };
}
