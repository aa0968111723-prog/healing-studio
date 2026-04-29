/**
 * PageAgentContext.tsx — Phase 1 基礎
 * ────────────────────────────────────────────────────────────────────────────
 * 光球 AI 代理人的「頁面能力註冊 / 動作派送」雙向橋。
 *
 * 目的：
 *   - 每個頁面可用 `useRegisterPageAgent({...})` 宣告自己能做什麼（模型、分頁、
 *     模式、填入提示詞、送出生成⋯），並提供實際執行這些動作的 handler。
 *   - 光球（ProactiveOrbWidget / OrbGuide / ai.chat LLM）可以透過
 *     `usePageAgent().dispatch(action)` 真正驅動頁面內部狀態。
 *   - 若頁面尚未 register（例如光球剛 navigate 過去，目標頁還在載入），
 *     動作會進入 pending queue，頁面 register 時自動 drain。
 *
 * 設計原則：
 *   - 不侵入任何既有 Context（AIState / Personality / FocusFlow / OrbGuide
 *     都保持原樣），只新增一層。
 *   - 純 TypeScript；不需要頁面改動即可安全掛上 Provider。
 *   - 番茄鐘、聊天、引導面板的行為一個字都不動。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { globalAgentRegistry } from "../../../shared/global-agent-registry";
import {
  AGENT_FEEDBACK_HISTORY_CAP,
  coerceAgentAction,
  adaptAgentPlanToActions,
  drainActionsForPage,
  enqueueAction,
  isDestructiveAction,
  parseLLMActions,
  pushFeedback,
  summarizeAction,
  type AgentAction,
  type AgentActionResult,
  type AgentActionType,
  type AgentCapability,
  type AgentFeedbackEvent,
  type AgentFeedbackStatus,
  type AgentIntent,
  type PageAgentSnapshot,
  type PendingAction,
} from "../../../shared/agent-actions";

// 再匯出，讓頁面端只需 import 這個 context 即可
export type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
  AgentFeedbackEvent,
  AgentIntent,
  PageAgentSnapshot,
} from "../../../shared/agent-actions";
export {
  parseLLMActions,
  adaptAgentPlanToActions,
  coerceAgentAction,
  summarizeAction,
  isDestructiveAction,
} from "../../../shared/agent-actions";

// ─── 內部型別 ─────────────────────────────────────────────────────────────

type AgentActionHandler = (
  action: AgentAction
) => Promise<AgentActionResult> | AgentActionResult;

interface RegisteredPage {
  snapshot: PageAgentSnapshot;
  handle: AgentActionHandler;
}

interface DispatchOptions {
  targetPageId?: string;
  enqueueIfNoHandler?: boolean;
  requireConfirmation?: boolean;
  intentSummary?: string;
  source?: "ai-chat" | "orb-guide" | "manual";
}

export type AgentExecutionErrorCode =
  | "NOT_APPROVED"
  | "NO_PAGE_HANDLER"
  | "ACTION_REJECTED"
  | "ACTION_EXCEPTION"
  | "TIMEOUT";

export interface ApprovedTask {
  taskId: string;
  approvedByB: boolean;
  source: "B";
  pageId?: string;
  actions: AgentAction[];
}

export type AgentExecutionStepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped";

export interface AgentExecutionStep {
  index: number;
  actionType: AgentAction["type"];
  summary: string;
  status: AgentExecutionStepStatus;
  reason?: string;
}

export interface AgentTaskExecutionState {
  taskId: string;
  totalSteps: number;
  currentStep: number;
  status: "idle" | "running" | "completed" | "failed";
  successCount: number;
  failCount: number;
  skippedCount: number;
  steps: AgentExecutionStep[];
}

export interface AgentFailureContext {
  taskId: string;
  pageId?: string;
  actionType: string;
  actionSummary?: string;
  stepIndex: number;
  totalSteps: number;
  reason?: string;
  at: number;
}

export interface PendingConfirmation {
  id: string;
  action: AgentAction;
  summary: string;
  intentSummary?: string;
  source?: DispatchOptions["source"];
  createdAt: number;
}

export interface AgentSpotlight {
  id: string;
  elementId: string;
  message?: string;
  autoHideMs?: number;
  source?: DispatchOptions["source"];
  createdAt: number;
}

export const AGENT_SPOTLIGHT_DEFAULT_MS = 4500;

interface PageAgentContextValue {
  hasHandler: boolean;
  snapshot: PageAgentSnapshot | null;
  dispatch: (
    action: AgentAction,
    opts?: DispatchOptions
  ) => Promise<AgentActionResult>;
  dispatchMany: (
    actions: AgentAction[],
    opts?: DispatchOptions
  ) => Promise<AgentActionResult[]>;
  registerPage: (page: RegisteredPage) => () => void;
  pendingCount: number;
  pendingConfirmation: PendingConfirmation | null;
  confirmPending: () => Promise<AgentActionResult | null>;
  cancelPending: (note?: string) => void;
  reportFeedback: (event: Partial<AgentFeedbackEvent> & {
    status: AgentFeedbackStatus;
    actionType: AgentActionType | string;
  }) => void;
  recentFeedback: AgentFeedbackEvent[];
  spotlight: AgentSpotlight | null;
  showSpotlight: (
    elementId: string,
    message?: string,
    opts?: { autoHideMs?: number; source?: DispatchOptions["source"] }
  ) => void;
  dismissSpotlight: () => void;
  taskExecution: AgentTaskExecutionState | null;
  executeApprovedTask: (
    task: ApprovedTask,
    opts?: {
      timeoutMsPerAction?: number;
      onFailure?: (payload: {
        errorCode: AgentExecutionErrorCode;
        context: AgentFailureContext;
      }) => void;
      source?: DispatchOptions["source"];
    }
  ) => Promise<{
    ok: boolean;
    errorCode?: AgentExecutionErrorCode;
    context?: AgentFailureContext;
  }>;
}

const noop: PageAgentContextValue = {
  hasHandler: false,
  snapshot: null,
  dispatch: async () => ({ ok: false, reason: "no-provider" }),
  dispatchMany: async () => [],
  registerPage: () => () => {},
  pendingCount: 0,
  pendingConfirmation: null,
  confirmPending: async () => null,
  cancelPending: () => {},
  reportFeedback: () => {},
  recentFeedback: [],
  spotlight: null,
  showSpotlight: () => {},
  dismissSpotlight: () => {},
  taskExecution: null,
  executeApprovedTask: async () => ({ ok: false, errorCode: "NO_PAGE_HANDLER" }),
};

const PageAgentContext = createContext<PageAgentContextValue>(noop);

export function PageAgentProvider({ children }: { children: ReactNode }) {
  const pageRef = useRef<RegisteredPage | null>(null);
  const [snapshot, setSnapshot] = useState<PageAgentSnapshot | null>(null);
  const queueRef = useRef<PendingAction[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const syncPending = useCallback(() => {
    setPendingCount(queueRef.current.length);
  }, []);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [recentFeedback, setRecentFeedback] = useState<AgentFeedbackEvent[]>([]);
  const [spotlight, setSpotlight] = useState<AgentSpotlight | null>(null);
  const [taskExecution, setTaskExecution] = useState<AgentTaskExecutionState | null>(null);
  const spotlightTimerRef = useRef<number | null>(null);

  const clearSpotlightTimer = useCallback(() => {
    if (spotlightTimerRef.current !== null) {
      window.clearTimeout(spotlightTimerRef.current);
      spotlightTimerRef.current = null;
    }
  }, []);

  const dismissSpotlight = useCallback(() => {
    clearSpotlightTimer();
    setSpotlight(null);
  }, [clearSpotlightTimer]);

  const showSpotlight = useCallback(
    (elementId: string, message?: string, opts?: { autoHideMs?: number; source?: DispatchOptions["source"] }) => {
      if (!elementId) return;
      clearSpotlightTimer();
      const autoHide = opts?.autoHideMs ?? AGENT_SPOTLIGHT_DEFAULT_MS;
      setSpotlight({
        id: `sp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        elementId,
        message,
        autoHideMs: autoHide,
        source: opts?.source,
        createdAt: Date.now(),
      });
      if (autoHide > 0) {
        spotlightTimerRef.current = window.setTimeout(() => {
          setSpotlight(null);
          spotlightTimerRef.current = null;
        }, autoHide);
      }
    },
    [clearSpotlightTimer]
  );

  useEffect(() => () => clearSpotlightTimer(), [clearSpotlightTimer]);

  const runDispatchRef = useRef<((action: AgentAction, opts: DispatchOptions) => Promise<AgentActionResult>) | null>(null);
  const [locationPath, setLocation] = useLocation();
  const locationPathRef = useRef(locationPath);
  locationPathRef.current = locationPath;
  const persistMemory = trpc.orbMemory.append.useMutation();

  const reportFeedback = useCallback(
    (event: Partial<AgentFeedbackEvent> & { status: AgentFeedbackStatus; actionType: AgentActionType | string }) => {
      const resolvedPageId = event.pageId ?? pageRef.current?.snapshot.pageId;
      setRecentFeedback(prev => pushFeedback(prev, {
        at: event.at ?? Date.now(),
        status: event.status,
        actionType: event.actionType as AgentActionType,
        note: event.note,
        pageId: resolvedPageId,
      }, AGENT_FEEDBACK_HISTORY_CAP));
      persistMemory.mutate({
        status: event.status,
        actionType: String(event.actionType).slice(0, 32),
        pageId: resolvedPageId ? String(resolvedPageId).slice(0, 64) : undefined,
        note: event.note ? String(event.note).slice(0, 512) : undefined,
      }, { onError: () => {} });
    },
    [persistMemory]
  );

  const runDispatch = useCallback(
    async (action: AgentAction, opts: DispatchOptions = {}): Promise<AgentActionResult> => {
      const { targetPageId, enqueueIfNoHandler = true } = opts;
      const page = pageRef.current;
      if (action.type === "navigate") {
        // Direct navigate dispatch (e.g., OrbGuidePanel "直接帶我去" button, or
        // when the orchestrator passes a navigate action through this layer):
        // route via wouter so the URL actually changes. The orchestrator's
        // own ctx.navigate() call already updates location for orb-driven
        // workflows, so this becomes a no-op when paths match.
        const targetPath = action.path;
        if (targetPath && targetPath !== locationPathRef.current) {
          setLocation(targetPath);
        }
        reportFeedback({ status: "completed", actionType: "navigate" });
        return { ok: true, message: `navigated to ${targetPath}` };
      }
      if (action.type === "focusElement") {
        showSpotlight(action.elementId, action.message, { source: opts.source });
        if (!page) {
          reportFeedback({ status: "completed", actionType: "focusElement" });
          return { ok: true, message: "spotlight shown without page handler" };
        }
      }
      const pageMatches = page && (!targetPageId || page.snapshot.pageId === targetPageId);
      if (pageMatches && page) {
        try {
          const result = await page.handle(action);
          const norm = result ?? { ok: true };
          reportFeedback({
            status: norm.ok ? "completed" : "failed",
            actionType: action.type,
            note: norm.ok ? undefined : (norm as { reason: string }).reason,
          });
          return norm;
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : "handler threw unknown error";
          reportFeedback({ status: "failed", actionType: action.type, note: reason });
          return { ok: false, reason };
        }
      }
      if (enqueueIfNoHandler) {
        queueRef.current = enqueueAction(queueRef.current, { targetPageId, action, createdAt: Date.now() });
        syncPending();
        return { ok: true, message: "queued for next page" };
      }
      return { ok: false, reason: "no matching page handler" };
    },
    [syncPending, reportFeedback, showSpotlight, setLocation]
  );
  runDispatchRef.current = runDispatch;

  const dispatch = useCallback(async (action: AgentAction, opts: DispatchOptions = {}): Promise<AgentActionResult> => {
    const needConfirm = opts.requireConfirmation ?? (isDestructiveAction(action) && pageRef.current !== null);
    if (needConfirm) {
      setPendingConfirmation({
        id: `pc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        action,
        summary: summarizeAction(action),
        intentSummary: opts.intentSummary,
        source: opts.source,
        createdAt: Date.now(),
      });
      return { ok: true, message: "awaiting user confirmation" };
    }
    return runDispatch(action, opts);
  }, [runDispatch]);

  const confirmPending = useCallback(async () => {
    const pc = pendingConfirmation;
    if (!pc) return null;
    setPendingConfirmation(null);
    reportFeedback({ status: "accepted", actionType: pc.action.type, note: pc.intentSummary });
    const run = runDispatchRef.current;
    if (!run) return null;
    return run(pc.action, { source: pc.source });
  }, [pendingConfirmation, reportFeedback]);

  const cancelPending = useCallback((note?: string) => {
    const pc = pendingConfirmation;
    if (!pc) return;
    setPendingConfirmation(null);
    reportFeedback({ status: "cancelled", actionType: pc.action.type, note });
  }, [pendingConfirmation, reportFeedback]);

  const dispatchMany = useCallback(async (actions: AgentAction[], opts: DispatchOptions = {}): Promise<AgentActionResult[]> => {
    const results: AgentActionResult[] = [];
    for (const action of actions) results.push(await dispatch(action, opts));
    return results;
  }, [dispatch]);

  const runWithTimeout = useCallback(async (promise: Promise<AgentActionResult>, timeoutMs: number): Promise<AgentActionResult> => {
    if (timeoutMs <= 0) return promise;
    return await Promise.race([
      promise,
      new Promise<AgentActionResult>(resolve => window.setTimeout(() => resolve({ ok: false, reason: "timeout waiting action result" }), timeoutMs)),
    ]);
  }, []);

  const executeApprovedTask = useCallback(async (task: ApprovedTask, opts?: {
    timeoutMsPerAction?: number;
    onFailure?: (payload: { errorCode: AgentExecutionErrorCode; context: AgentFailureContext }) => void;
    source?: DispatchOptions["source"];
  }) => {
    const totalSteps = task.actions.length;
    const initialSteps: AgentExecutionStep[] = task.actions.map((action, i) => ({ index: i, actionType: action.type, summary: summarizeAction(action), status: "pending" }));
    setTaskExecution({ taskId: task.taskId, totalSteps, currentStep: 0, status: "running", successCount: 0, failCount: 0, skippedCount: 0, steps: initialSteps });

    const fail = (errorCode: AgentExecutionErrorCode, context: AgentFailureContext) => {
      opts?.onFailure?.({ errorCode, context });
      setTaskExecution(prev => {
        if (!prev) return prev;
        const nextSteps = prev.steps.map(step => step.index === context.stepIndex ? { ...step, status: "failed" as const, reason: context.reason } : step);
        return { ...prev, status: "failed", currentStep: Math.min(context.stepIndex + 1, prev.totalSteps), failCount: prev.failCount + 1, steps: nextSteps };
      });
      return { ok: false as const, errorCode, context };
    };

    if (!task.approvedByB || task.source !== "B") {
      return fail("NOT_APPROVED", { taskId: task.taskId, pageId: task.pageId, actionType: "taskGate", actionSummary: "Task missing B approval gate", stepIndex: 0, totalSteps, reason: "approvedByB must be true and source must be B", at: Date.now() });
    }

    for (let i = 0; i < task.actions.length; i += 1) {
      const action = task.actions[i];
      setTaskExecution(prev => {
        if (!prev) return prev;
        const nextSteps = prev.steps.map(step => step.index === i ? { ...step, status: "running" as const } : step);
        return { ...prev, currentStep: i + 1, steps: nextSteps };
      });
      const result = await runWithTimeout(dispatch(action, { targetPageId: task.pageId, enqueueIfNoHandler: false, requireConfirmation: false, source: opts?.source ?? "ai-chat" }), opts?.timeoutMsPerAction ?? 15_000);
      if (!result.ok) {
        const reason = result.reason ?? "unknown action failure";
        const errorCode: AgentExecutionErrorCode = reason.includes("timeout") ? "TIMEOUT" : reason.includes("threw") ? "ACTION_EXCEPTION" : reason === "no matching page handler" ? "NO_PAGE_HANDLER" : "ACTION_REJECTED";
        return fail(errorCode, { taskId: task.taskId, pageId: task.pageId, actionType: action.type, actionSummary: summarizeAction(action), stepIndex: i, totalSteps, reason, at: Date.now() });
      }
      setTaskExecution(prev => {
        if (!prev) return prev;
        const nextSteps = prev.steps.map(step => step.index === i ? { ...step, status: "success" as const } : step);
        return { ...prev, successCount: prev.successCount + 1, steps: nextSteps };
      });
    }
    setTaskExecution(prev => prev ? { ...prev, status: "completed" } : prev);
    return { ok: true as const };
  }, [dispatch, runWithTimeout]);

  const registerPage = useCallback((page: RegisteredPage) => {
    pageRef.current = page;
    setSnapshot(page.snapshot);
    globalAgentRegistry.register(page.snapshot);

    const pageId = page.snapshot.pageId;
    const { drained, rest } = drainActionsForPage(queueRef.current, pageId);
    queueRef.current = rest;
    syncPending();
    if (drained.length > 0) {
      queueMicrotask(() => {
        for (const action of drained) void page.handle(action);
      });
    }

    return () => {
      globalAgentRegistry.unregister(page.snapshot.pageId);
      if (pageRef.current === page) {
        pageRef.current = null;
        setSnapshot(null);
      }
    };
  }, [syncPending]);

  const value = useMemo<PageAgentContextValue>(() => ({
    hasHandler: snapshot !== null,
    snapshot,
    dispatch,
    dispatchMany,
    registerPage,
    pendingCount,
    pendingConfirmation,
    confirmPending,
    cancelPending,
    reportFeedback,
    recentFeedback,
    spotlight,
    showSpotlight,
    dismissSpotlight,
    taskExecution,
    executeApprovedTask,
  }), [snapshot, dispatch, dispatchMany, registerPage, pendingCount, pendingConfirmation, confirmPending, cancelPending, reportFeedback, recentFeedback, spotlight, showSpotlight, dismissSpotlight, taskExecution, executeApprovedTask]);

  return <PageAgentContext.Provider value={value}>{children}</PageAgentContext.Provider>;
}

export function usePageAgent(): PageAgentContextValue {
  return useContext(PageAgentContext);
}

interface UseRegisterPageAgentArgs {
  pageId: string;
  pageLabel: string;
  pagePath: string;
  capabilities: AgentCapability[];
  state?: Record<string, unknown>;
  handle: AgentActionHandler;
  enabled?: boolean;
}

export function useRegisterPageAgent(args: UseRegisterPageAgentArgs) {
  const { pageId, pageLabel, pagePath, capabilities, state, handle, enabled = true } = args;
  const { registerPage } = usePageAgent();
  const handleRef = useRef(handle);
  handleRef.current = handle;
  const capsKey = useMemo(() => capabilities.map(c => `${c.action}:${c.label}:${c.currentId ?? ""}:${(c.options ?? []).length}`).join("|"), [capabilities]);
  const stateKey = useMemo(() => (state ? safeStringify(state) : ""), [state]);

  useEffect(() => {
    if (!enabled) return undefined;
    const unregister = registerPage({ snapshot: { pageId, pageLabel, pagePath, capabilities, state }, handle: action => handleRef.current(action) });
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerPage, pageId, pageLabel, pagePath, capsKey, stateKey, enabled]);
}

function safeStringify(v: Record<string, unknown>): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}
