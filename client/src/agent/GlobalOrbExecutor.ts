import { hasCapabilityForPage } from "../../../shared/global-agent-capabilities";
import { coerceAgentAction, isDestructiveAction, type AgentAction, type AgentActionResult } from "../../../shared/agent-actions";

export type GlobalOrbExecutorStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "awaiting_approval";

export interface GlobalOrbExecutorStep {
  id: string;
  label: string;
  pagePath?: string;
  uiActions: Array<{ type: string; payload?: unknown }>;
  toolCalls?: Array<{ name: string; args?: Record<string, unknown>; requiresApproval?: boolean }>;
  requiresApproval?: boolean;
  expectedOutput?: string;
}

export interface GlobalOrbExecutorTask {
  taskId: string;
  traceId?: string | null;
  summaryForUser: string;
  status?: string;
  isolation?: "ui" | "tool" | "code";
  preferredEngine?: string | null;
  riskLevel?: string | null;
  requiresHumanReason?: string;
  confidence?: number;
  confidenceSource?: "planner" | "verifier" | "rule";
  retryBudget?: number;
  retryCount?: number;
  steps: GlobalOrbExecutorStep[];
}

export interface GlobalOrbExecutorState {
  taskId: string | null;
  traceId: string | null;
  status: "idle" | "running" | "paused" | "cancelled" | "failed" | "completed" | "blocked";
  currentStepId: string | null;
  failReason: string | null;
  retryBudget: number;
  retryCount: number;
  steps: Array<GlobalOrbExecutorStep & { status: GlobalOrbExecutorStepStatus; failReason?: string }>;
}

interface ExecutorTelemetryEvent {
  event: string;
  taskId?: string;
  traceId?: string | null;
  stepId?: string;
  metadata?: Record<string, unknown>;
}

export interface GlobalOrbExecutorDeps {
  enabled: boolean;
  dispatchAction: (action: AgentAction) => Promise<AgentActionResult>;
  navigate: (path: string) => Promise<void>;
  getCurrentPagePath: () => string | null;
  waitForPageReady: (path: string, timeoutMs: number) => Promise<boolean>;
  timeoutMs: number;
  onTelemetry?: (event: ExecutorTelemetryEvent) => void;
  onStateChange?: (state: GlobalOrbExecutorState) => void;
  api?: {
    approve?: (taskId: string) => Promise<unknown>;
    cancel?: (taskId: string, reason?: string) => Promise<unknown>;
    retry?: (taskId: string) => Promise<unknown>;
    updateStepStatus?: (input: { taskId: string; stepId: string; status: "completed" | "failed"; reason?: string }) => Promise<unknown>;
    completeStep?: (input: { taskId: string; stepId: string }) => Promise<unknown>;
    failStep?: (input: { taskId: string; stepId: string; reason: string }) => Promise<unknown>;
  };
}

const HIGH_RISK_ACTIONS = new Set(["submit", "reset", "applyPreset"]);
const EXTERNAL_TOOL_PREFIX = ["github.", "deploy.", "code."];

/**
 * UI actions that swap the visible workspace inside a single page (tab,
 * modality, mode, preset). React commits the new state asynchronously, so
 * a follow-up dispatch landing on the SAME page would race against the
 * destination child re-mount and end up writing to the previous bridge —
 * the empty-prompt symptom users see in the multi-step orb. We pause
 * briefly between same-page steps when the previous step's action is in
 * this set.
 */
const STATE_MUTATING_UI_ACTIONS = new Set<string>([
  "setTab",
  "setModality",
  "setMode",
  "applyPreset",
]);
const SAME_PAGE_STATE_MUTATION_SETTLE_MS = 120;

function waitMs(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function stepNeedsSamePageSettle(
  prev: GlobalOrbExecutorStep | undefined,
  next: GlobalOrbExecutorStep | undefined
): boolean {
  if (!prev || !next) return false;
  if (!prev.pagePath || !next.pagePath) return false;
  if (prev.pagePath !== next.pagePath) return false;
  return (prev.uiActions ?? []).some(action =>
    STATE_MUTATING_UI_ACTIONS.has(action.type)
  );
}

function isSecretLike(key: string, value: unknown): boolean {
  const lower = key.toLowerCase();
  if (lower.includes("key") || lower.includes("token") || lower.includes("secret") || lower.includes("password")) return true;
  if (typeof value === "string" && value.length > 200 && value.includes("base64")) return true;
  if (typeof value === "string" && /^data:[^;]+;base64,/i.test(value)) return true;
  return false;
}

export function sanitizeTelemetryMetadata(input?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isSecretLike(key, value)) continue;
    if (typeof value === "string" && value.length > 500) {
      output[key] = `${value.slice(0, 120)}…(redacted)`;
      continue;
    }
    output[key] = value;
  }
  return output;
}

function toInitialState(task?: GlobalOrbExecutorTask): GlobalOrbExecutorState {
  return {
    taskId: task?.taskId ?? null,
    traceId: task?.traceId ?? null,
    status: "idle",
    currentStepId: null,
    failReason: null,
    retryBudget: task?.retryBudget ?? 2,
    retryCount: task?.retryCount ?? 0,
    steps: (task?.steps ?? []).map(step => ({ ...step, status: "pending" })),
  };
}

export function createGlobalOrbExecutor(deps: GlobalOrbExecutorDeps) {
  let state: GlobalOrbExecutorState = toInitialState();
  let paused = false;
  let cancelled = false;
  let approvedSteps = new Set<string>();

  const emitState = () => deps.onStateChange?.(state);
  const emitTelemetry = (event: ExecutorTelemetryEvent) => {
    deps.onTelemetry?.({ ...event, metadata: sanitizeTelemetryMetadata(event.metadata) });
  };

  const setState = (updater: (prev: GlobalOrbExecutorState) => GlobalOrbExecutorState) => {
    state = updater(state);
    emitState();
  };

  const shouldBlockTask = (task: GlobalOrbExecutorTask): string | null => {
    if (!deps.enabled) return "workflow disabled";
    if (task.status === "blocked") return "blocked task cannot execute";
    if (task.status === "cancelled") return "cancelled task cannot execute";
    if (task.isolation === "code") {
      return "claude code handoff required";
    }
    // preferredEngine === "claudeCode" alone is an LLM routing hint and
    // does not justify blocking a plan whose steps are all server-side
    // media calls. The per-step EXTERNAL_TOOL_PREFIX gate below still
    // catches any actual code./github./deploy. tool call.
    if (
      task.preferredEngine === "claudeCode" &&
      task.steps.some(step =>
        (step.toolCalls ?? []).some(tool =>
          EXTERNAL_TOOL_PREFIX.some(prefix => tool.name.startsWith(prefix))
        )
      )
    ) {
      return "claude code handoff required";
    }
    return null;
  };

  const needsExplicitApproval = (step: GlobalOrbExecutorStep): boolean => {
    if (step.requiresApproval) return true;
    if (step.uiActions.some(action => HIGH_RISK_ACTIONS.has(action.type))) return true;
    if (step.uiActions.some(action => HIGH_RISK_ACTIONS.has(action.type) || action.type === "submit")) return true;
    if ((step.toolCalls ?? []).some(tool => tool.requiresApproval || EXTERNAL_TOOL_PREFIX.some(prefix => tool.name.startsWith(prefix)))) {
      return true;
    }
    return false;
  };

  const runStep = async (task: GlobalOrbExecutorTask, index: number) => {
    const step = task.steps[index];
    if (!step) return;
    if (cancelled) throw new Error("task cancelled");

    if (needsExplicitApproval(step) && !approvedSteps.has(step.id)) {
      setState(prev => ({
        ...prev,
        status: "paused",
        currentStepId: step.id,
        steps: prev.steps.map(s => (s.id === step.id ? { ...s, status: "awaiting_approval" } : s)),
      }));
      emitTelemetry({ event: "executor.paused", taskId: task.taskId, traceId: task.traceId, stepId: step.id, metadata: { reason: "awaiting_approval" } });
      return;
    }

    const unsafeTool = (step.toolCalls ?? []).find(tool => EXTERNAL_TOOL_PREFIX.some(prefix => tool.name.startsWith(prefix)));
    if (unsafeTool) {
      throw new Error(`external tool requires handoff: ${unsafeTool.name}`);
    }

    if (step.pagePath && step.pagePath !== deps.getCurrentPagePath()) {
      await deps.navigate(step.pagePath);
      const ready = await deps.waitForPageReady(step.pagePath, deps.timeoutMs);
      if (!ready) throw new Error(`page not ready: ${step.pagePath}`);
    }

    for (const uiAction of step.uiActions) {
      if (!hasCapabilityForPage(step.pagePath ?? deps.getCurrentPagePath() ?? undefined, uiAction.type)) {
        throw new Error(`page capability missing: ${uiAction.type}`);
      }
      const action = coerceAgentAction({ type: uiAction.type, ...((typeof uiAction.payload === "object" && uiAction.payload !== null) ? uiAction.payload as Record<string, unknown> : uiAction.type === "setModel" ? { modelId: String(uiAction.payload ?? "") } : uiAction.type === "setMode" ? { modeId: String(uiAction.payload ?? "") } : uiAction.type === "setParam" ? (uiAction.payload as Record<string, unknown>) : uiAction.type === "fillPrompt" ? { text: String((uiAction.payload as { text?: string } | undefined)?.text ?? uiAction.payload ?? "") } : uiAction.type === "navigate" ? { path: String(uiAction.payload ?? "/") } : uiAction.type === "applyPreset" ? { presetId: String(uiAction.payload ?? "") } : uiAction.type === "openDialog" ? { dialogId: String((uiAction.payload as { dialogId?: string } | undefined)?.dialogId ?? uiAction.payload ?? "") } : uiAction.type === "search" ? { query: String(uiAction.payload ?? "") } : uiAction.type === "toggleSetting" ? { key: String((uiAction.payload as { key?: string } | undefined)?.key ?? "") } : {}), });
      if (!action) {
        throw new Error(`invalid action payload: ${uiAction.type}`);
      }
      if (isDestructiveAction(action) && !approvedSteps.has(step.id)) {
        throw new Error(`destructive action requires approval: ${action.type}`);
      }
      const res = await deps.dispatchAction(action);
      if (!res.ok) throw new Error(res.reason ?? `action failed: ${action.type}`);
    }
  };

  const start = async (task: GlobalOrbExecutorTask) => {
    const blockedReason = shouldBlockTask(task);
    state = toInitialState(task);
    emitState();
    emitTelemetry({ event: "executor.started", taskId: task.taskId, traceId: task.traceId });

    if (blockedReason) {
      setState(prev => ({ ...prev, status: blockedReason.includes("disabled") ? "blocked" : "failed", failReason: blockedReason }));
      emitTelemetry({ event: "executor.step.failed", taskId: task.taskId, traceId: task.traceId, metadata: { reason: blockedReason } });
      return state;
    }

    cancelled = false;
    paused = false;
    if (task.steps.length === 0) {
      setState(prev => ({ ...prev, status: "completed" }));
      emitTelemetry({ event: "executor.completed", taskId: task.taskId, traceId: task.traceId });
      return state;
    }

    if (task.status === "awaiting_approval") {
      await deps.api?.approve?.(task.taskId);
    }

    setState(prev => ({ ...prev, status: "running" }));

    for (let i = 0; i < task.steps.length; i += 1) {
      const step = task.steps[i];
      if (cancelled) break;
      if (paused) break;

      // Same-page state-mutation settle: when the previous step changed the
      // visible workspace (setTab / setModality / setMode / applyPreset)
      // and this step targets the same page, give React a chance to commit
      // before the next dispatch lands on the new bridge.
      if (i > 0 && stepNeedsSamePageSettle(task.steps[i - 1], step)) {
        await waitMs(SAME_PAGE_STATE_MUTATION_SETTLE_MS);
      }

      setState(prev => ({
        ...prev,
        currentStepId: step.id,
        steps: prev.steps.map(s => (s.id === step.id ? { ...s, status: "running", failReason: undefined } : s)),
      }));
      emitTelemetry({ event: "executor.step.started", taskId: task.taskId, traceId: task.traceId, stepId: step.id });

      try {
        await runStep(task, i);
        if (state.status === "paused") return state;
        await deps.api?.completeStep?.({ taskId: task.taskId, stepId: step.id });
        await deps.api?.updateStepStatus?.({ taskId: task.taskId, stepId: step.id, status: "completed" });
        setState(prev => ({
          ...prev,
          steps: prev.steps.map(s => (s.id === step.id ? { ...s, status: "completed" } : s)),
        }));
        emitTelemetry({ event: "executor.step.completed", taskId: task.taskId, traceId: task.traceId, stepId: step.id });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await deps.api?.failStep?.({ taskId: task.taskId, stepId: step.id, reason });
        await deps.api?.updateStepStatus?.({ taskId: task.taskId, stepId: step.id, status: "failed", reason });
        setState(prev => ({
          ...prev,
          status: cancelled ? "cancelled" : "failed",
          failReason: reason,
          steps: prev.steps.map(s => (s.id === step.id ? { ...s, status: "failed", failReason: reason } : s)),
        }));
        emitTelemetry({ event: "executor.step.failed", taskId: task.taskId, traceId: task.traceId, stepId: step.id, metadata: { reason } });
        return state;
      }
    }

    if (!cancelled && state.status === "running") {
      setState(prev => ({ ...prev, status: "completed", currentStepId: null }));
      emitTelemetry({ event: "executor.completed", taskId: task.taskId, traceId: task.traceId });
    }
    return state;
  };

  const approveStep = async (stepId: string) => {
    approvedSteps.add(stepId);
    paused = false;
  };

  const pause = () => {
    paused = true;
    setState(prev => ({ ...prev, status: "paused" }));
    emitTelemetry({ event: "executor.paused", taskId: state.taskId ?? undefined, traceId: state.traceId });
  };

  const cancel = async (reason = "cancelled by user") => {
    cancelled = true;
    paused = false;
    if (state.taskId) await deps.api?.cancel?.(state.taskId, reason);
    setState(prev => ({ ...prev, status: "cancelled", failReason: reason }));
    emitTelemetry({ event: "executor.cancelled", taskId: state.taskId ?? undefined, traceId: state.traceId, metadata: { reason } });
  };

  const retry = async (task: GlobalOrbExecutorTask) => {
    if (state.retryBudget <= state.retryCount) return state;
    if (task.taskId) await deps.api?.retry?.(task.taskId);
    const nextRetryCount = state.retryCount + 1;
    setState(prev => ({ ...prev, retryCount: nextRetryCount, failReason: null }));
    return await start({ ...task, retryCount: nextRetryCount });
  };

  const requestRecovery = (task: GlobalOrbExecutorTask) => {
    const failed = state.steps.find(step => step.status === "failed");
    emitTelemetry({
      event: "executor.recovery.requested",
      taskId: task.taskId,
      traceId: task.traceId,
      stepId: failed?.id,
      metadata: { reason: failed?.failReason ?? state.failReason ?? "unknown" },
    });
    return {
      failedStepId: failed?.id,
      failedReason: failed?.failReason ?? state.failReason ?? "unknown",
    };
  };

  return {
    getState: () => state,
    start,
    pause,
    cancel,
    retry,
    approveStep,
    requestRecovery,
  };
}
