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
import { trpc } from "@/lib/trpc";
import {
  AGENT_FEEDBACK_HISTORY_CAP,
  coerceAgentAction,
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
  /** 指定要派送給哪個 pageId；省略則送到目前註冊的頁面 */
  targetPageId?: string;
  /**
   * 若目前沒有任何頁面註冊，預設會 enqueue。
   * 設為 false 會直接回傳 ok:false。
   */
  enqueueIfNoHandler?: boolean;
  /**
   * Phase 1.5：是否在執行前走「意圖預覽」確認流程。
   *   - undefined（預設）→ 破壞性動作自動開啟（isDestructiveAction 判定）
   *   - true              → 強制要求確認
   *   - false             → 跳過確認，直接執行
   */
  requireConfirmation?: boolean;
  /** 顯示在確認卡片上的 LLM 意圖摘要（可選） */
  intentSummary?: string;
  /** 動作來源，僅作紀錄 */
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

/** 正在等待使用者確認的單筆動作 */
export interface PendingConfirmation {
  id: string;
  action: AgentAction;
  summary: string;
  intentSummary?: string;
  source?: DispatchOptions["source"];
  createdAt: number;
}

/** Phase 3b：光球「看這裡」視覺聚焦的當前目標 */
export interface AgentSpotlight {
  id: string;
  elementId: string;
  message?: string;
  /** 自動關閉時間（ms），0/undefined = 不自動關閉 */
  autoHideMs?: number;
  source?: DispatchOptions["source"];
  createdAt: number;
}

/** focusElement 預設視覺聚焦保留時間（ms） */
export const AGENT_SPOTLIGHT_DEFAULT_MS = 4500;

interface PageAgentContextValue {
  /** 目前有頁面註冊 agent handler 嗎 */
  hasHandler: boolean;
  /** 當前（最近）註冊的頁面快照 */
  snapshot: PageAgentSnapshot | null;
  /** 光球用：派送一個結構化動作 */
  dispatch: (
    action: AgentAction,
    opts?: DispatchOptions
  ) => Promise<AgentActionResult>;
  /** 光球用：批次派送（LLM 回傳 actions[] / OrbGuide queuedActions） */
  dispatchMany: (
    actions: AgentAction[],
    opts?: DispatchOptions
  ) => Promise<AgentActionResult[]>;
  /** 頁面用：註冊自己能做什麼。回傳 unregister 函式 */
  registerPage: (page: RegisteredPage) => () => void;
  /** 目前 pending queue 長度（debug / 測試用） */
  pendingCount: number;
  // ── Phase 1.5：確認 + 回饋基建 ───────────────────────────────
  /** 目前等待使用者確認的動作（null 代表沒有）*/
  pendingConfirmation: PendingConfirmation | null;
  /** 使用者按下「好」→ 真正執行 pending 動作 */
  confirmPending: () => Promise<AgentActionResult | null>;
  /** 使用者按下「先不要」→ 丟掉 pending 動作，並記錄 cancelled feedback */
  cancelPending: (note?: string) => void;
  /** 由頁面或光球主動回報「執行完 / 失敗了 / 使用者改了」 */
  reportFeedback: (event: Partial<AgentFeedbackEvent> & {
    status: AgentFeedbackStatus;
    actionType: AgentActionType | string;
  }) => void;
  /** 最近的使用者回饋（最多 AGENT_FEEDBACK_HISTORY_CAP 筆）*/
  recentFeedback: AgentFeedbackEvent[];
  // ── Phase 3b：視覺聚焦 bus（focusElement 的畫面層） ─────────
  /** 目前要視覺聚焦的元素（null 代表沒有） */
  spotlight: AgentSpotlight | null;
  /** 光球/頁面用：主動要求聚焦某個元素（elementId 必填） */
  showSpotlight: (
    elementId: string,
    message?: string,
    opts?: { autoHideMs?: number; source?: DispatchOptions["source"] }
  ) => void;
  /** 使用者點背景或等待超時都會呼叫 */
  dismissSpotlight: () => void;
  /** A 線執行狀態（供 UI 顯示步驟條 / 成功失敗統計） */
  taskExecution: AgentTaskExecutionState | null;
  /** 僅接收 B 已批准任務，逐步 dispatch 到 PageAgent bus */
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
  executeApprovedTask: async () => ({
    ok: false,
    errorCode: "NO_PAGE_HANDLER",
  }),
};

const PageAgentContext = createContext<PageAgentContextValue>(noop);

// ─── Provider ─────────────────────────────────────────────────────────────

export function PageAgentProvider({ children }: { children: ReactNode }) {
  /**
   * 目前註冊的頁面。通常只有一個頁面 active（route 切換時舊頁會 unmount、
   * 觸發 unregister），但我們仍用 ref 保險起見，避免因 React 18/19 的
   * Strict Mode 雙次渲染造成註冊漂移。
   */
  const pageRef = useRef<RegisteredPage | null>(null);
  const [snapshot, setSnapshot] = useState<PageAgentSnapshot | null>(null);

  /** pending queue：光球 navigate 後、頁面還沒 register 時暫存動作 */
  const queueRef = useRef<PendingAction[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  const syncPending = useCallback(() => {
    setPendingCount(queueRef.current.length);
  }, []);

  // ── Phase 1.5：確認閘 + 回饋 bus ────────────────────────────────
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);
  const [recentFeedback, setRecentFeedback] = useState<AgentFeedbackEvent[]>(
    []
  );

  // ── Phase 3b：focusElement 視覺聚焦 bus ─────────────────────────
  const [spotlight, setSpotlight] = useState<AgentSpotlight | null>(null);
  const [taskExecution, setTaskExecution] =
    useState<AgentTaskExecutionState | null>(null);
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
    (
      elementId: string,
      message?: string,
      opts?: { autoHideMs?: number; source?: DispatchOptions["source"] }
    ) => {
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
  // 元件卸載時把計時器清掉，避免 memory leak / 漏到下一個 route
  useEffect(() => () => clearSpotlightTimer(), [clearSpotlightTimer]);
  /** dispatch 真正執行的內部核心，不走確認閘 */
  const runDispatchRef = useRef<
    ((action: AgentAction, opts: DispatchOptions) => Promise<AgentActionResult>)
    | null
  >(null);

  // Phase 3c：把 feedback 事件同步寫進 DB。fire-and-forget，失敗不影響 UX。
  const persistMemory = trpc.orbMemory.append.useMutation();

  const reportFeedback = useCallback(
    (event: Partial<AgentFeedbackEvent> & {
      status: AgentFeedbackStatus;
      actionType: AgentActionType | string;
    }) => {
      const resolvedPageId =
        event.pageId ?? pageRef.current?.snapshot.pageId;
      setRecentFeedback(prev =>
        pushFeedback(
          prev,
          {
            at: event.at ?? Date.now(),
            status: event.status,
            actionType: event.actionType as AgentActionType,
            note: event.note,
            pageId: resolvedPageId,
          },
          AGENT_FEEDBACK_HISTORY_CAP
        )
      );
      // 非阻塞寫入 DB，錯誤吞掉以免汙染 console
      persistMemory.mutate(
        {
          status: event.status,
          actionType: String(event.actionType).slice(0, 32),
          pageId: resolvedPageId ? String(resolvedPageId).slice(0, 64) : undefined,
          note: event.note ? String(event.note).slice(0, 512) : undefined,
        },
        { onError: () => {} }
      );
    },
    [persistMemory]
  );

  // ─── dispatch 核心：真正執行動作（不含確認閘）──────────────────────
  const runDispatch = useCallback(
    async (
      action: AgentAction,
      opts: DispatchOptions = {}
    ): Promise<AgentActionResult> => {
      const { targetPageId, enqueueIfNoHandler = true } = opts;
      const page = pageRef.current;

      // 導航不交給頁面 handler；由光球層自己消化，這裡只記下來以免頁面誤收
      if (action.type === "navigate") {
        return { ok: false, reason: "navigate handled by orb layer" };
      }

      // Phase 3b：focusElement 在 bus 層先點亮畫面 spotlight，再交給頁面
      // handler（頁面可以額外做自己的事，像展開收合、滾動列表）。
      // 若沒頁面註冊，spotlight 仍然成立（純視覺 hint，不進 pending queue）。
      if (action.type === "focusElement") {
        showSpotlight(action.elementId, action.message, { source: opts.source });
        if (!page) {
          reportFeedback({ status: "completed", actionType: "focusElement" });
          return { ok: true, message: "spotlight shown without page handler" };
        }
      }

      const pageMatches =
        page && (!targetPageId || page.snapshot.pageId === targetPageId);

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
          const reason =
            err instanceof Error ? err.message : "handler threw unknown error";
          reportFeedback({
            status: "failed",
            actionType: action.type,
            note: reason,
          });
          return { ok: false, reason };
        }
      }

      if (enqueueIfNoHandler) {
        queueRef.current = enqueueAction(queueRef.current, {
          targetPageId,
          action,
          createdAt: Date.now(),
        });
        syncPending();
        return { ok: true, message: "queued for next page" };
      }

      return { ok: false, reason: "no matching page handler" };
    },
    [syncPending, reportFeedback, showSpotlight]
  );
  runDispatchRef.current = runDispatch;

  /** 對外的 dispatch：破壞性動作會先走確認閘 */
  const dispatch = useCallback(
    async (
      action: AgentAction,
      opts: DispatchOptions = {}
    ): Promise<AgentActionResult> => {
      const needConfirm =
        opts.requireConfirmation ??
        (isDestructiveAction(action) && pageRef.current !== null);
      if (needConfirm) {
        // 若已經有一張等待中的卡片，後到的直接覆蓋（last-write-wins）
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
    },
    [runDispatch]
  );

  const confirmPending = useCallback(async () => {
    const pc = pendingConfirmation;
    if (!pc) return null;
    setPendingConfirmation(null);
    reportFeedback({
      status: "accepted",
      actionType: pc.action.type,
      note: pc.intentSummary,
    });
    const run = runDispatchRef.current;
    if (!run) return null;
    return run(pc.action, { source: pc.source });
  }, [pendingConfirmation, reportFeedback]);

  const cancelPending = useCallback(
    (note?: string) => {
      const pc = pendingConfirmation;
      if (!pc) return;
      setPendingConfirmation(null);
      reportFeedback({
        status: "cancelled",
        actionType: pc.action.type,
        note,
      });
    },
    [pendingConfirmation, reportFeedback]
  );

  const dispatchMany = useCallback(
    async (
      actions: AgentAction[],
      opts: DispatchOptions = {}
    ): Promise<AgentActionResult[]> => {
      const results: AgentActionResult[] = [];
      for (const action of actions) {
        results.push(await dispatch(action, opts));
      }
      return results;
    },
    [dispatch]
  );

  const runWithTimeout = useCallback(
    async (
      promise: Promise<AgentActionResult>,
      timeoutMs: number
    ): Promise<AgentActionResult> => {
      if (timeoutMs <= 0) return promise;
      return await Promise.race([
        promise,
        new Promise<AgentActionResult>(resolve =>
          window.setTimeout(
            () => resolve({ ok: false, reason: "timeout waiting action result" }),
            timeoutMs
          )
        ),
      ]);
    },
    []
  );

  const executeApprovedTask = useCallback(
    async (
      task: ApprovedTask,
      opts?: {
        timeoutMsPerAction?: number;
        onFailure?: (payload: {
          errorCode: AgentExecutionErrorCode;
          context: AgentFailureContext;
        }) => void;
        source?: DispatchOptions["source"];
      }
    ) => {
      const totalSteps = task.actions.length;
      const initialSteps: AgentExecutionStep[] = task.actions.map((action, i) => ({
        index: i,
        actionType: action.type,
        summary: summarizeAction(action),
        status: "pending",
      }));
      setTaskExecution({
        taskId: task.taskId,
        totalSteps,
        currentStep: 0,
        status: "running",
        successCount: 0,
        failCount: 0,
        skippedCount: 0,
        steps: initialSteps,
      });

      const fail = (
        errorCode: AgentExecutionErrorCode,
        context: AgentFailureContext
      ) => {
        opts?.onFailure?.({ errorCode, context });
        setTaskExecution(prev => {
          if (!prev) return prev;
          const nextSteps = prev.steps.map(step =>
            step.index === context.stepIndex
              ? {
                  ...step,
                  status: "failed" as const,
                  reason: context.reason,
                }
              : step
          );
          return {
            ...prev,
            status: "failed",
            currentStep: Math.min(context.stepIndex + 1, prev.totalSteps),
            failCount: prev.failCount + 1,
            steps: nextSteps,
          };
        });
        return { ok: false as const, errorCode, context };
      };

      if (!task.approvedByB || task.source !== "B") {
        return fail("NOT_APPROVED", {
          taskId: task.taskId,
          pageId: task.pageId,
          actionType: "taskGate",
          actionSummary: "Task missing B approval gate",
          stepIndex: 0,
          totalSteps,
          reason: "approvedByB must be true and source must be B",
          at: Date.now(),
        });
      }

      for (let i = 0; i < task.actions.length; i += 1) {
        const action = task.actions[i];
        setTaskExecution(prev => {
          if (!prev) return prev;
          const nextSteps = prev.steps.map(step =>
            step.index === i ? { ...step, status: "running" as const } : step
          );
          return { ...prev, currentStep: i + 1, steps: nextSteps };
        });

        const result = await runWithTimeout(
          dispatch(action, {
            targetPageId: task.pageId,
            enqueueIfNoHandler: false,
            requireConfirmation: false,
            source: opts?.source ?? "ai-chat",
          }),
          opts?.timeoutMsPerAction ?? 15_000
        );

        if (!result.ok) {
          const reason = result.reason ?? "unknown action failure";
          const errorCode: AgentExecutionErrorCode =
            reason.includes("timeout")
              ? "TIMEOUT"
              : reason.includes("threw")
                ? "ACTION_EXCEPTION"
                : reason === "no matching page handler"
                  ? "NO_PAGE_HANDLER"
                  : "ACTION_REJECTED";
          return fail(errorCode, {
            taskId: task.taskId,
            pageId: task.pageId,
            actionType: action.type,
            actionSummary: summarizeAction(action),
            stepIndex: i,
            totalSteps,
            reason,
            at: Date.now(),
          });
        }

        setTaskExecution(prev => {
          if (!prev) return prev;
          const nextSteps = prev.steps.map(step =>
            step.index === i ? { ...step, status: "success" as const } : step
          );
          return {
            ...prev,
            successCount: prev.successCount + 1,
            steps: nextSteps,
          };
        });
      }

      setTaskExecution(prev => {
        if (!prev) return prev;
        return { ...prev, status: "completed" };
      });
      return { ok: true as const };
    },
    [dispatch, runWithTimeout]
  );

  // ─── 頁面註冊 ───────────────────────────────────────────────────────
  const registerPage = useCallback(
    (page: RegisteredPage) => {
      pageRef.current = page;
      setSnapshot(page.snapshot);

      // Drain queue：把原本等這個 pageId（或不指定）的動作交給剛註冊的 handler
      const pageId = page.snapshot.pageId;
      const { drained, rest } = drainActionsForPage(
        queueRef.current,
        pageId
      );
      queueRef.current = rest;
      syncPending();
      if (drained.length > 0) {
        // 讓目標頁面完成 mount + 第一次 paint 再派送；不阻塞註冊
        queueMicrotask(() => {
          for (const action of drained) {
            // 忽略結果；頁面若失敗，頁面端自行處理錯誤回饋
            void page.handle(action);
          }
        });
      }

      return () => {
        if (pageRef.current === page) {
          pageRef.current = null;
          setSnapshot(null);
        }
      };
    },
    [syncPending]
  );

  const value = useMemo<PageAgentContextValue>(
    () => ({
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
    }),
    [
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
    ]
  );

  return (
    <PageAgentContext.Provider value={value}>
      {children}
    </PageAgentContext.Provider>
  );
}

// ─── Hook：光球端使用 ─────────────────────────────────────────────────────

export function usePageAgent(): PageAgentContextValue {
  return useContext(PageAgentContext);
}

// ─── Hook：頁面端註冊 agent 能力 ─────────────────────────────────────────

interface UseRegisterPageAgentArgs {
  pageId: string;
  pageLabel: string;
  pagePath: string;
  capabilities: AgentCapability[];
  state?: Record<string, unknown>;
  handle: AgentActionHandler;
  /** 當 handle 或 capabilities 改變時是否重新註冊；預設 true */
  enabled?: boolean;
}

/**
 * 頁面端 API：呼叫一次即可暴露「這頁能做什麼」。
 *
 * Phase 1 尚未有任何頁面使用此 hook；Phase 2 起各 Studio 頁會依序接入。
 */
export function useRegisterPageAgent(args: UseRegisterPageAgentArgs) {
  const {
    pageId,
    pageLabel,
    pagePath,
    capabilities,
    state,
    handle,
    enabled = true,
  } = args;
  const { registerPage } = usePageAgent();

  // 保留最新的 handle / state / capabilities，避免每次 render 重新 register
  const handleRef = useRef(handle);
  handleRef.current = handle;

  const capsKey = useMemo(
    () =>
      capabilities
        .map(c => `${c.action}:${c.label}:${c.currentId ?? ""}:${(c.options ?? []).length}`)
        .join("|"),
    [capabilities]
  );

  const stateKey = useMemo(
    () => (state ? safeStringify(state) : ""),
    [state]
  );

  useEffect(() => {
    if (!enabled) return undefined;
    const unregister = registerPage({
      snapshot: { pageId, pageLabel, pagePath, capabilities, state },
      handle: action => handleRef.current(action),
    });
    return unregister;
    // 刻意用 capsKey / stateKey 做穩定比較，避免每次 render 觸發 re-register
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
