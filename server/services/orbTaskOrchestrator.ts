import type { OrbTask } from "../../shared/orb-agent-contract";
import type {
  OrbAgentTask,
  OrbTaskAuditEvent,
} from "../../shared/orb-task-state-machine";
import type { OrbApiTool, OrbToolCallResult } from "./agentToolExecutor";
import { executeOrbToolCalls } from "./agentToolExecutor";
import {
  completeOrbAgentStep,
  failOrbAgentStep,
  getOrbAgentTask,
} from "./orbTaskStateMachine";
import { orbTaskStore as defaultOrbTaskStore } from "./orbTaskStore";
import type { OrbTaskStore } from "./orbTaskStore";
import type { AgentPreferences } from "../../shared/agent-preferences";

// ─── Single-step executor (existing public contract) ──────────────────────

export interface ExecuteStepToolsInput {
  task: OrbTask;
  userId: number;
  userRole: string;
  tools: OrbApiTool[];
  approved: boolean;
  requestId?: string;
  onAuditEvent?: (event: {
    requestId: string;
    userId: number;
    userRole: string;
    taskId?: string;
    stepId?: string;
    toolName: string;
    usedTool?: string;
    ok: boolean;
    status?: number;
    error?: string;
    attempts?: number;
    startedAt: number;
    endedAt: number;
  }) => void;
  agentPreferences?: AgentPreferences;
  autoApprovedStepsInRun?: number;
}

export interface ExecuteStepToolsResult {
  attempted: boolean;
  toolResults: OrbToolCallResult[];
  ok: boolean;
  blockedByApproval?: boolean;
}

export async function executeCurrentStepTools(
  input: ExecuteStepToolsInput
): Promise<ExecuteStepToolsResult> {
  const step = input.task.steps[input.task.currentStepIndex];
  if (!step || step.toolCalls.length === 0) {
    return { attempted: false, toolResults: [], ok: true };
  }

  const registryByName = new Map(input.tools.map(t => [t.name, t]));
  const stepNeedsApproval = step.toolCalls.some(call => {
    const fromStep = Boolean(call.requiresApproval);
    const fromRegistry = Boolean(registryByName.get(call.name)?.requireConfirmation);
    return fromStep || fromRegistry;
  });
  const blockedTools = new Set(input.agentPreferences?.blockedTools ?? []);
  const blockedCall = step.toolCalls.find(call => blockedTools.has(call.name));
  if (blockedCall) {
    return {
      attempted: true,
      toolResults: [{ name: blockedCall.name, ok: false, error: "tool-blocked-by-user" }],
      ok: false,
      blockedByApproval: false,
    };
  }
  const policy = input.agentPreferences?.confirmationPolicy ?? "confirm_high_risk";
  const maxAuto = Math.max(1, input.agentPreferences?.maxAutoStepsPerTask ?? 5);
  const stepRisk = (step as unknown as { riskLevel?: string }).riskLevel ?? "low";
  const autoApproveTools = new Set(input.agentPreferences?.autoApproveTools ?? []);
  const hasAutoApprovedTool = step.toolCalls.some(call => autoApproveTools.has(call.name));
  const shouldForceApprove =
    policy === "always_approve" ||
    hasAutoApprovedTool ||
    (policy === "confirm_high_risk" && (input.agentPreferences?.allowedRiskLevels ?? ["low", "medium"]).includes(stepRisk));
  const shouldForceManual = policy === "confirm_all" || policy === "manual";
  const autoStepLimitReached = (input.autoApprovedStepsInRun ?? 0) >= maxAuto;
  const isStepApproved = input.task.approvedStepIds.includes(step.id);
  const effectiveApproved = shouldForceManual ? false : (shouldForceApprove ? true : input.approved);
  if ((stepNeedsApproval && !(effectiveApproved || isStepApproved)) || autoStepLimitReached) {
    return {
      attempted: false,
      toolResults: [
        {
          name: step.toolCalls[0]?.name ?? "unknown",
          ok: false,
          error: "step-approval-required",
        },
      ],
      ok: false,
      blockedByApproval: true,
    };
  }

  const calls = step.toolCalls.map(call => ({
    name: call.name,
    args: call.args,
  }));

  const toolResults = await executeOrbToolCalls({
    tools: input.tools,
    calls,
    userId: input.userId,
    userRole: input.userRole,
    approved: input.approved,
    blockedTools: Array.from(blockedTools),
    requestId: input.requestId,
    taskId: input.task.taskId,
    stepId: step.id,
    onAuditEvent: input.onAuditEvent,
  });

  return {
    attempted: true,
    toolResults,
    ok: toolResults.every(r => r.ok),
    blockedByApproval: false,
  };
}

// ─── Multi-step coordinator ────────────────────────────────────────────────
//
// Real orchestration that walks the entire OrbTask, advancing both the
// persistent OrbTaskStore (legacy, per-step persistence) and the in-memory
// OrbAgentTask FSM (memory + claudeCode lifecycle hooks) on every transition.
//
// Why two state holders?
//   - OrbTaskStore is the long-lived per-step report store that the front-end
//     polls/SSE-streams via routers.ts; it owns step approvals + timeline.
//   - OrbAgentTask FSM (orbTaskStateMachine.ts) is the rich audit-event +
//     memory layer that records `task.completed` / `task.failed` and pushes
//     entries into orbTaskMemory / orbMemory.
// Previously these two were never linked; the orchestrator now keeps them
// in lock-step so multi-step flows (subtitles → dubbing → render) actually
// advance from one step to the next instead of stalling on step 0.

export type OrbOrchestratorOutcome =
  | "completed"
  | "failed"
  | "cancelled"
  | "awaiting_approval";

export interface RunOrbTaskInput {
  taskId: string;
  userId: number;
  userRole: string;
  tools: OrbApiTool[];
  /**
   * Per-step approval token map. When a step requires approval, the caller
   * supplies the token previously issued by `orbTaskStore.approveStep`. Steps
   * absent from the map but already in `task.approvedStepIds` are accepted.
   */
  approvalTokensByStepId?: Record<string, string>;
  /**
   * Hard ceiling on total steps run by this driver invocation. Defaults to
   * `task.steps.length` so a runaway plan can't loop forever.
   */
  maxSteps?: number;
  requestId?: string;
  /** Streamed for every state-machine audit event (for SSE). */
  onStateMachineEvent?: (event: OrbTaskAuditEvent) => void;
  /** Streamed for every tool-level audit event (forwarded from agentToolExecutor). */
  onToolAuditEvent?: ExecuteStepToolsInput["onAuditEvent"];
  /** Pluggable store for tests; defaults to the singleton. */
  store?: OrbTaskStore;
  /** Pluggable clock for tests. */
  now?: () => number;
  agentPreferences?: AgentPreferences;
}

export interface RunOrbTaskResult {
  taskId: string;
  outcome: OrbOrchestratorOutcome;
  stepsRun: number;
  /** Tool results indexed by step id, in execution order. */
  perStepToolResults: Array<{
    stepId: string;
    toolResults: OrbToolCallResult[];
    ok: boolean;
    blockedByApproval?: boolean;
  }>;
  /** Final task snapshot after the run (may be null if store dropped it). */
  finalTask: OrbTask | null;
  /** Final FSM snapshot (only present when the FSM has a matching record). */
  finalAgentTask: OrbAgentTask | null;
  /** Reason for non-completed outcomes. */
  reason?: string;
}

/**
 * Drive a multi-step OrbTask to completion (or first failure / approval gate).
 *
 * Loop invariant per iteration:
 *   1. Re-fetch latest persisted task from the store.
 *   2. If terminal (done/failed/cancelled) → exit with matching outcome.
 *   3. If `waiting_human` and current step lacks an approval token → exit
 *      with `awaiting_approval` (caller must approve, then re-invoke).
 *   4. Run current step's tools via `executeCurrentStepTools`.
 *   5. On `blockedByApproval` → exit `awaiting_approval`.
 *   6. On tool failure → `store.reportStep(ok=false)` + FSM `failOrbAgentStep`,
 *      exit `failed`.
 *   7. On success → `store.reportStep(ok=true)` (advances currentStepIndex)
 *      + FSM `completeOrbAgentStep` (advances currentStepId / completes task),
 *      then loop.
 */
export async function runOrbTaskToCompletion(
  input: RunOrbTaskInput
): Promise<RunOrbTaskResult> {
  const store = input.store ?? defaultOrbTaskStore;
  const clock = input.now ?? Date.now;
  const perStepToolResults: RunOrbTaskResult["perStepToolResults"] = [];

  // Snapshot existing FSM events so we only forward NEW ones to onStateMachineEvent.
  const seenEventIds = new Set<string>();
  const initialAgent = getOrbAgentTask(input.taskId);
  if (initialAgent) {
    for (const evt of initialAgent.auditEvents) seenEventIds.add(evt.eventId);
  }
  const flushNewFsmEvents = () => {
    if (!input.onStateMachineEvent) return;
    const agent = getOrbAgentTask(input.taskId);
    if (!agent) return;
    for (const evt of agent.auditEvents) {
      if (seenEventIds.has(evt.eventId)) continue;
      seenEventIds.add(evt.eventId);
      input.onStateMachineEvent(evt);
    }
  };

  const maxIterations = Math.max(
    1,
    input.maxSteps ?? store.get(input.taskId, input.userId, clock())?.steps.length ?? 1
  );
  let autoApprovedStepsInRun = 0;

  for (let i = 0; i < maxIterations; i += 1) {
    const task = store.get(input.taskId, input.userId, clock());
    if (!task) {
      return {
        taskId: input.taskId,
        outcome: "failed",
        stepsRun: perStepToolResults.length,
        perStepToolResults,
        finalTask: null,
        finalAgentTask: getOrbAgentTask(input.taskId),
        reason: "task-not-found",
      };
    }

    if (task.status === "done") {
      return {
        taskId: input.taskId,
        outcome: "completed",
        stepsRun: perStepToolResults.length,
        perStepToolResults,
        finalTask: task,
        finalAgentTask: getOrbAgentTask(input.taskId),
      };
    }
    if (task.status === "failed") {
      return {
        taskId: input.taskId,
        outcome: "failed",
        stepsRun: perStepToolResults.length,
        perStepToolResults,
        finalTask: task,
        finalAgentTask: getOrbAgentTask(input.taskId),
        reason:
          task.stepReports.find(r => !r.ok)?.errorCode ??
          task.stepReports.find(r => !r.ok)?.detail ??
          "task-failed",
      };
    }
    if (task.status === "cancelled") {
      return {
        taskId: input.taskId,
        outcome: "cancelled",
        stepsRun: perStepToolResults.length,
        perStepToolResults,
        finalTask: task,
        finalAgentTask: getOrbAgentTask(input.taskId),
        reason: "cancelled",
      };
    }

    if (task.status === "waiting_human") {
      return {
        taskId: input.taskId,
        outcome: "awaiting_approval",
        stepsRun: perStepToolResults.length,
        perStepToolResults,
        finalTask: task,
        finalAgentTask: getOrbAgentTask(input.taskId),
        reason: "task-awaiting-human-approval",
      };
    }

    const step = task.steps[task.currentStepIndex];
    if (!step) {
      // No more steps and not yet `done`: defensive — mark failed via store
      // so callers see a deterministic result.
      const failed = store.reportStep(
        {
          taskId: input.taskId,
          stepId: `synthetic_${task.currentStepIndex}`,
          ok: false,
          errorCode: "no-current-step",
          source: "system",
          actor: "system",
          at: clock(),
        },
        input.userId,
        clock()
      );
      return {
        taskId: input.taskId,
        outcome: "failed",
        stepsRun: perStepToolResults.length,
        perStepToolResults,
        finalTask: failed,
        finalAgentTask: getOrbAgentTask(input.taskId),
        reason: "no-current-step",
      };
    }

    // Pre-flight: if this step requires approval and no token is supplied
    // (and it's not already in approvedStepIds), exit early so the caller
    // can ask the user before any tool side-effects fire.
    const stepRequiresApproval =
      step.toolCalls.some(c => c.requiresApproval) ||
      input.tools.some(
        t =>
          t.requireConfirmation &&
          step.toolCalls.some(c => c.name === t.name)
      );
    const stepAlreadyApproved = task.approvedStepIds.includes(step.id);
    const stepToken = input.approvalTokensByStepId?.[step.id];
    const stepTokenValid =
      stepToken !== undefined &&
      store.isStepApproved(input.taskId, input.userId, step.id, stepToken, clock());
    const approvedForStep = stepAlreadyApproved || stepTokenValid;

    const stepRun = await executeCurrentStepTools({
      task,
      userId: input.userId,
      userRole: input.userRole,
      tools: input.tools,
      approved: approvedForStep,
      requestId: input.requestId
        ? `${input.requestId}_step_${step.id}`
        : `task_${input.taskId}_step_${step.id}_${clock()}`,
      onAuditEvent: input.onToolAuditEvent,
      agentPreferences: input.agentPreferences,
      autoApprovedStepsInRun,
    });
    if (!stepRun.blockedByApproval && stepRun.attempted) autoApprovedStepsInRun += 1;

    perStepToolResults.push({
      stepId: step.id,
      toolResults: stepRun.toolResults,
      ok: stepRun.ok,
      blockedByApproval: stepRun.blockedByApproval,
    });

    if (stepRun.blockedByApproval) {
      // Don't mark the step failed — let the caller surface an approval
      // prompt and re-invoke once the user approves.
      return {
        taskId: input.taskId,
        outcome: "awaiting_approval",
        stepsRun: perStepToolResults.length,
        perStepToolResults,
        finalTask: store.get(input.taskId, input.userId, clock()),
        finalAgentTask: getOrbAgentTask(input.taskId),
        reason: "step-approval-required",
        ...(stepRequiresApproval ? {} : {}),
      };
    }

    if (!stepRun.ok) {
      const failureReason =
        stepRun.toolResults.find(r => !r.ok)?.error ?? "step-failed";
      const updatedTask = store.reportStep(
        {
          taskId: input.taskId,
          stepId: step.id,
          ok: false,
          errorCode: failureReason,
          detail: stepRun.toolResults.find(r => !r.ok)?.error,
          source: "tool",
          actor: "agent",
          at: clock(),
        },
        input.userId,
        clock()
      );
      // Keep FSM in sync — only if the FSM tracks this task.
      if (getOrbAgentTask(input.taskId)) {
        failOrbAgentStep(input.taskId, step.id, failureReason);
        flushNewFsmEvents();
      }
      return {
        taskId: input.taskId,
        outcome: "failed",
        stepsRun: perStepToolResults.length,
        perStepToolResults,
        finalTask: updatedTask,
        finalAgentTask: getOrbAgentTask(input.taskId),
        reason: failureReason,
      };
    }

    // Step succeeded → advance both stores in lock-step.
    store.reportStep(
      {
        taskId: input.taskId,
        stepId: step.id,
        ok: true,
        source: "tool",
        actor: "agent",
        at: clock(),
      },
      input.userId,
      clock()
    );
    if (getOrbAgentTask(input.taskId)) {
      completeOrbAgentStep(input.taskId, step.id);
      flushNewFsmEvents();
    }
  }

  // Loop fell out of maxIterations without reaching a terminal state.
  const finalTask = store.get(input.taskId, input.userId, clock());
  if (finalTask?.status === "done") {
    return {
      taskId: input.taskId,
      outcome: "completed",
      stepsRun: perStepToolResults.length,
      perStepToolResults,
      finalTask,
      finalAgentTask: getOrbAgentTask(input.taskId),
    };
  }
  return {
    taskId: input.taskId,
    outcome: "failed",
    stepsRun: perStepToolResults.length,
    perStepToolResults,
    finalTask,
    finalAgentTask: getOrbAgentTask(input.taskId),
    reason: "max-steps-exceeded",
  };
}
