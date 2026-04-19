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
import {
  coerceAgentAction,
  drainActionsForPage,
  enqueueAction,
  parseLLMActions,
  type AgentAction,
  type AgentActionResult,
  type AgentCapability,
  type PageAgentSnapshot,
  type PendingAction,
} from "../../../shared/agent-actions";

// 再匯出，讓頁面端只需 import 這個 context 即可
export type {
  AgentAction,
  AgentActionResult,
  AgentCapability,
  PageAgentSnapshot,
} from "../../../shared/agent-actions";
export { parseLLMActions, coerceAgentAction } from "../../../shared/agent-actions";

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
}

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
}

const noop: PageAgentContextValue = {
  hasHandler: false,
  snapshot: null,
  dispatch: async () => ({ ok: false, reason: "no-provider" }),
  dispatchMany: async () => [],
  registerPage: () => () => {},
  pendingCount: 0,
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

  // ─── dispatch：真正執行動作 ─────────────────────────────────────────
  const dispatch = useCallback(
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

      const pageMatches =
        page && (!targetPageId || page.snapshot.pageId === targetPageId);

      if (pageMatches && page) {
        try {
          const result = await page.handle(action);
          return result ?? { ok: true };
        } catch (err: unknown) {
          const reason =
            err instanceof Error ? err.message : "handler threw unknown error";
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
    [syncPending]
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
    }),
    [snapshot, dispatch, dispatchMany, registerPage, pendingCount]
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
