import { LLMPermanentError } from "../_core/llm";
import { TRPCError } from "@trpc/server";
import { tryAcquireCreatorSlot, releaseCreatorSlot } from "../_core/agentCreatorQuota";
import { getOrbToolRegistry } from "../config/orbToolRegistry";
import { loadAgentPreferencesForUser } from "../services/agentPreferenceService";
import { orbToolCallLogStore } from "../services/orbToolCallLogStore";
import { getOrbTaskPlannerContext } from "../services/orbTaskPlannerContextStore";
import { isMultiAgentRoutingEnabled, runOrbTaskWithOptionalMultiAgent } from "../services/multiAgentIntegration";
import { runOrbTaskWithContinuationLoop } from "../services/orbTaskChainRunner";
import { orbTaskTracer } from "../services/orbTaskTracer";
import {
  getOrbAgentTask,
  getOrbAgentTaskEvents,
  failOrbAgentStep,
} from "../services/orbTaskStateMachine";
import { runOrbTaskToCompletion } from "../services/orbTaskOrchestrator";
import { createReplanCallback, type ReplanCallbackContext } from "../services/orbTaskReplanIntegration";

/**
 * Tracks the task IDs whose orchestrator loop is currently running, so two
 * approve clicks (or approve+retry) don't double-fire the executor.
 *
 * Each entry stores the timestamp the driver started so we can self-heal
 * when an unhandled rejection slips past the try/finally (rare but
 * possible in some Node async contexts). Without the TTL, a single
 * crashed driver would lock the user out of retrying the task forever.
 */
export const ORB_AUTO_DRIVER_STALE_MS = 10 * 60_000; // 10 minutes
export const orbAutoDriverInFlight = new Map<string, number>();

// execute_task action 失敗時要顯示給使用者的中文 label。type 是英文 enum,
// 直接把 "generate_image" 露出來不是給使用者看的。對應 fallDispatcher
// 收的三個 task type。
export const TASK_TYPE_LABEL: Record<"generate_image" | "generate_music" | "generate_video", string> = {
  generate_image: "圖像生成",
  generate_music: "音樂生成",
  generate_video: "影片生成",
};

export function isOrbAutoDriverInFlight(taskId: string): boolean {
  const startedAt = orbAutoDriverInFlight.get(taskId);
  if (startedAt === undefined) return false;
  if (Date.now() - startedAt > ORB_AUTO_DRIVER_STALE_MS) {
    // Stale entry — assume the previous driver crashed without cleanup
    // and let the next caller re-enter.
    orbAutoDriverInFlight.delete(taskId);
    return false;
  }
  return true;
}

/**
 * Fire-and-forget: drive a multi-step orb task to completion in the
 * background. Honours every safety / approval gate — if the orchestrator
 * hits an `awaiting_approval` step it exits cleanly, the front-end's
 * approval card shows up, and the loop resumes when the user approves.
 *
 * Without this, every multi-step plan stalled at step 0 because nothing
 * actually called the orchestrator after the chat router created the
 * task. The orb was effectively a planner-only "draft generator" instead
 * of a real executable agent.
 */
export async function driveOrbTaskInBackground(input: {
  taskId: string;
  userId: number;
  userRole: string;
}): Promise<void> {
  if (isOrbAutoDriverInFlight(input.taskId)) return;

  // AIDV-878: per-user concurrent task quota — prevent one user from
  // monopolising the agent executor pool
  const maxConcurrentTasks = Number(process.env.ORB_MAX_CONCURRENT_TASKS ?? 3);
  if (!tryAcquireCreatorSlot(input.userId, maxConcurrentTasks)) {
    const reason = `agent creator quota exceeded (max ${maxConcurrentTasks} concurrent tasks per user)`;
    console.warn(`[Orb] ${reason} taskId=${input.taskId} userId=${input.userId}`);
    try {
      const fsmTask = getOrbAgentTask(input.taskId);
      if (fsmTask) {
        const failingStepId = fsmTask.currentStepId ?? fsmTask.steps[0]?.id;
        if (failingStepId) failOrbAgentStep(input.taskId, failingStepId, reason);
      }
    } catch { /* best-effort */ }
    return;
  }

  orbAutoDriverInFlight.set(input.taskId, Date.now());
  try {
    const tools = getOrbToolRegistry();
    const agentPreferences = await loadAgentPreferencesForUser(input.userId);
    const onToolAuditEvent = (event: Parameters<typeof orbToolCallLogStore.append>[0]) => {
      try {
        orbToolCallLogStore.append(event);
      } catch {
        // best-effort
      }
    };

    // ─── Multi-agent routing path (NEW) ────────────────────────────────
    // When ORB_MULTI_AGENT_ENABLED=1, detect task complexity and route to
    // multi-agent collaboration if needed. Falls back gracefully to
    // single-agent on failure or if task is simple.
    const plannerContext = getOrbTaskPlannerContext(input.taskId);

    if (isMultiAgentRoutingEnabled() && plannerContext) {
      // Extract user message from conversation
      const userMessage = plannerContext.messages
        .filter(m => m.role === "user")
        .map(m => m.content)
        .join(" ");

      const task = getOrbAgentTask(input.taskId);

      const multiAgentResult = await runOrbTaskWithOptionalMultiAgent({
        initialTaskId: input.taskId,
        userId: input.userId,
        userRole: input.userRole,
        tools,
        agentPreferences,
        userMessage,
        pageSnapshot: plannerContext.pageSnapshot,
        // OrbAgentTask doesn't carry an assignedRole field — the multi-
        // agent integration layer derives the primary role from the
        // userMessage when this is undefined.
        primaryRole: undefined,
        sessionId: `session_${Date.now()}_${input.userId}`,
        onToolAuditEvent,
      });

      if (multiAgentResult.mode === "multi-agent-collaboration") {
        console.log(
          `[Orb] multi-agent collaboration completed: taskId=${input.taskId} collaborationId=${multiAgentResult.collaborationSession?.collaborationId}`
        );
      } else if (multiAgentResult.chainResult) {
        const last = multiAgentResult.chainResult.iterations[multiAgentResult.chainResult.iterations.length - 1];
        if (last?.runResult.outcome === "failed") {
          console.warn(
            `[Orb] single-agent fallback finished with failure: taskId=${input.taskId} reason=${multiAgentResult.detectionResult.reason}`
          );
        }
      }
    }
    // ─── Agent loop v1 + v2 (continuation loop) ────────────────────────
    // When ORB_OBSERVATION_LOOP=1 the chain runner wraps the orchestrator
    // with post-mortem observation AND bounded continuation: if the
    // observer says "continue", the planner is re-invoked with the
    // original conversation + an execution recap and a fresh task is
    // materialised + driven. Capped at 2 iterations (1 replan max).
    // Off by default — preserves the legacy single-shot path so behaviour
    // and cost don't change for production until explicitly opted in.
    else if (process.env.ORB_OBSERVATION_LOOP === "1") {
      const chain = await runOrbTaskWithContinuationLoop({
        initialTaskId: input.taskId,
        userId: input.userId,
        userRole: input.userRole,
        tools,
        agentPreferences,
        onToolAuditEvent,
      });
      const last = chain.iterations[chain.iterations.length - 1];
      if (last?.runResult.outcome === "failed") {
        console.warn(
          `[Orb] chain finished with failure: finalTaskId=${chain.finalTaskId} stopReason=${chain.stopReason}`
        );
      }
    } else {
      // Start trace for observability
      const traceId = orbTaskTracer.generateTraceId();
      const task = getOrbAgentTask(input.taskId);
      if (task) {
        orbTaskTracer.startTrace({
          traceId,
          userId: input.userId,
          taskId: input.taskId,
          // OrbAgentTask uses `intent` (not `objective`); the field
          // populated by the planner.
          taskIntent: task.intent || "Orb task execution",
        });
      }

      // Create replanning callback for ReAct loop. createReplanCallback
      // takes an OrbTask + AgentWorkflowStep — we have an OrbAgentTask
      // here whose shape only partly overlaps. Cast through `unknown`
      // because the orchestrator only reads identifying fields
      // (taskId / intent / userId) from the context, never the
      // specific shape; the failedStep is overwritten by the
      // orchestrator on the actual call.
      const onRequestReplan = task
        ? createReplanCallback({
            task: task as unknown as ReplanCallbackContext["task"],
            userId: input.userId,
            failedStep: task.steps[0] as unknown as ReplanCallbackContext["failedStep"],
            observation: {
              toolName: "",
              errorCode: "",
              issues: [],
              toolArgs: {},
            },
            traceId,
          })
        : undefined;

      const result = await runOrbTaskToCompletion({
        taskId: input.taskId,
        userId: input.userId,
        userRole: input.userRole,
        tools,
        agentPreferences,
        requestId: `orb_auto_${input.taskId}_${Date.now()}`,
        traceId,
        onToolAuditEvent,
        onRequestReplan,
      });

      // End trace
      if (task) {
        orbTaskTracer.endTrace(traceId, {
          status: result.outcome === "completed" ? "success" :
                  result.outcome === "cancelled" ? "cancelled" : "failed",
          finalReason: result.reason,
        });
      }

      if (result.outcome === "failed") {
        console.warn(
          `[Orb] auto-driver finished with failure: taskId=${input.taskId} reason=${result.reason ?? "unknown"}`
        );
      }
    }
  } catch (error) {
    // The auto-driver crashed before runOrbTaskToCompletion could write
    // a terminal state itself (e.g., tool registry threw during init,
    // preferences load failed, network error reaching the FSM store).
    // Without this branch the task would sit in `running` / `waiting_human`
    // forever and the user would see a spinner with no error message.
    // Mirror the crash into both the FSM (so the UI surfaces "task
    // failed: <reason>") and the audit log (so ops can see what blew up).
    const reason =
      error instanceof Error
        ? `auto-driver crashed: ${error.message}`
        : `auto-driver crashed: ${String(error)}`;
    console.error(`[Orb] auto-driver crashed for taskId=${input.taskId}:`, reason);
    try {
      const fsmTask = getOrbAgentTask(input.taskId);
      if (fsmTask) {
        const failingStepId = fsmTask.currentStepId ?? fsmTask.steps[0]?.id;
        if (failingStepId) {
          failOrbAgentStep(input.taskId, failingStepId, reason);
        }
      }
    } catch (mirrorError) {
      console.error(
        `[Orb] failed to mirror auto-driver crash to FSM for taskId=${input.taskId}:`,
        mirrorError instanceof Error ? mirrorError.message : String(mirrorError)
      );
    }
    try {
      const at = Date.now();
      orbToolCallLogStore.append({
        requestId: `orb_auto_${input.taskId}_${at}`,
        userId: input.userId,
        userRole: input.userRole,
        taskId: input.taskId,
        stepId: "auto-driver",
        toolName: "auto-driver",
        ok: false,
        error: reason,
        startedAt: at,
        endedAt: at,
      });
    } catch {
      // best-effort
    }
  } finally {
    orbAutoDriverInFlight.delete(input.taskId);
    releaseCreatorSlot(input.userId); // AIDV-878
  }
}

/**
 * Pick which of the 5 reasoning brain slots best fits a single orb-chat turn.
 *
 * Default: `director` (matches legacy behaviour). Heuristics only override
 * when the user's intent is unmistakable, so existing tests that mock the
 * director slot keep passing for normal conversations.
 *
 *   technician  — coding / deploy / DevOps / debugging keywords
 *   storyteller — script / 分鏡 / dialogue / narrative authoring
 *   analyst     — data lookup / 統計 / metrics / 比較 / 比例 / 分析報告
 *   curator     — preferences / memory / "上次" / "之前" / personal history
 *   director    — everything else (multimodal planning, generic creative)
 */
export function pickReasoningSlotForOrbChat(input: {
  userText: string;
  pageSnapshot?: { pageId?: string; pagePath?: string } | null | undefined;
}): "director" | "analyst" | "storyteller" | "technician" | "curator" {
  const text = (input.userText ?? "").toLowerCase();
  if (!text) return "director";
  const has = (...keywords: string[]) =>
    keywords.some(keyword => text.includes(keyword.toLowerCase()));

  // Hard signals that should win regardless of page context.
  if (
    has(
      "code",
      "代碼",
      "程式",
      "python",
      "typescript",
      "javascript",
      "bug",
      "deploy",
      "github",
      "api error",
      "stack trace",
      "exception",
      "終端",
      "shell",
      "docker",
      "ci/cd"
    )
  ) {
    return "technician";
  }

  if (
    has(
      "腳本",
      "分鏡",
      "對白",
      "對話",
      "story",
      "storyboard",
      "script",
      "narrative",
      "短篇",
      "電影感",
      "詩",
      "歌詞",
      "lyric"
    )
  ) {
    return "storyteller";
  }

  if (
    has(
      "統計",
      "比例",
      "數據",
      "報表",
      "metrics",
      "analytics",
      "用量",
      "成本",
      "cost",
      "kpi",
      "比較",
      "差異",
      "trend",
      "dashboard",
      // Explicit web-search / lookup intents — analyst slot defaults to
      // Perplexity Sonar (web grounding), so routing search intents here
      // gives the orb live citations instead of guessing from training data.
      "上網",
      "查一下",
      "查詢",
      "搜尋",
      "search the web",
      "look up",
      "find latest",
      "最新消息",
      "新聞",
      "news",
      "現在",
      "今天的",
      "即時"
    )
  ) {
    return "analyst";
  }

  if (
    has(
      "上次",
      "之前",
      "我習慣",
      "我喜歡",
      "memory",
      "記得",
      "偏好",
      "preference",
      "history of",
      "我做過"
    )
  ) {
    return "curator";
  }

  // Page-derived hints (only used when text gives no signal).
  const pageId = input.pageSnapshot?.pageId ?? "";
  const pagePath = input.pageSnapshot?.pagePath ?? "";
  if (
    pageId === "admin" ||
    pageId === "admin-api-usage" ||
    pageId === "admin-brain-pipeline" ||
    pagePath.startsWith("/admin")
  ) {
    return "analyst";
  }
  if (pageId === "director" || pagePath === "/director") {
    return "storyteller";
  }

  return "director";
}

/**
 * Drop any planner action whose type is disabled for the current page in the
 * user's `disabledActionsByPage` map. Returns the filtered actions plus the
 * list of dropped action types so the caller can surface that in warnings /
 * telemetry. Workflows are recursed: any inner step matching a disabled
 * action type is removed from the workflow's `steps[]`.
 */
export function applyDisabledActionsByPage<T extends { type: string }>(
  actions: T[],
  pageId: string | undefined,
  disabledActionsByPage: Record<string, string[]> | undefined
): { actions: T[]; dropped: string[] } {
  if (!actions || actions.length === 0) {
    return { actions: actions ?? [], dropped: [] };
  }
  const map = disabledActionsByPage ?? {};
  const disabledForPage = new Set(
    [
      ...(pageId ? map[pageId] ?? [] : []),
      ...(map["*"] ?? []), // wildcard for "every page"
    ].map(s => String(s).toLowerCase())
  );
  if (disabledForPage.size === 0) {
    return { actions, dropped: [] };
  }
  const dropped: string[] = [];
  const filtered = actions
    .map(action => {
      if (disabledForPage.has(action.type.toLowerCase())) {
        dropped.push(action.type);
        return null;
      }
      // For runWorkflow, also strip inner steps with disabled actionType.
      if (action.type === "runWorkflow") {
        const wf = action as unknown as {
          type: "runWorkflow";
          name: string;
          steps: Array<{ actionType: string }>;
        };
        const keptSteps = wf.steps.filter(step => {
          const blocked = disabledForPage.has(String(step.actionType).toLowerCase());
          if (blocked) dropped.push(`runWorkflow.${step.actionType}`);
          return !blocked;
        });
        if (keptSteps.length === 0) {
          dropped.push("runWorkflow");
          return null;
        }
        return { ...wf, steps: keptSteps } as unknown as T;
      }
      return action;
    })
    .filter((a): a is T => a !== null);
  return { actions: filtered, dropped };
}

export function sanitizeTelemetryValue(input: unknown): unknown {
  if (typeof input !== "string") return input;
  return input
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/sk-[a-z0-9]{8,}/gi, "sk-[REDACTED]")
    .replace(/^data:[^;]+;base64,[a-z0-9+/=\s]+$/i, "[BASE64_REDACTED]");
}

export function appendTelemetryEvent(
  telemetry: Array<Record<string, unknown>>,
  event: string,
  payload: Record<string, unknown>
) {
  telemetry.push({
    event,
    timestamp: Date.now(),
    ...Object.fromEntries(
      Object.entries(payload).map(([k, v]) => [k, sanitizeTelemetryValue(v)])
    ),
  });
}

/**
 * Map an orb-chat exception to a healing-tone reply that actually tells the
 * operator what to fix. Covers the four real-world API-outage shapes:
 *   - LLMPermanentError(auth)   → 金鑰無效 / 401 / 403
 *   - LLMPermanentError(quota)  → 額度耗盡 / 402 / credit balance
 *   - "沒有可用的 LLM 引擎"      → 完全沒設過任何金鑰
 *   - aggregate "金鑰／額度問題" → 整條降級鏈都壞了
 * Anything else falls back to the generic transient line so we don't leak
 * stack traces, but the previous catch silently treated the first three as
 * transient too, which is why the user only ever saw 「去設定頁檢查 API 設定」.
 */
export function classifyOrbChatErrorReply(err: unknown, errorMsg: string): string {
  const lower = errorMsg.toLowerCase();
  const settingsHint = "可以到 /admin/api-usage 檢查 providerReadiness。";

  if (err instanceof LLMPermanentError) {
    if (err.reason === "permanent_auth") {
      return `🌿 抱歉，我連不上 AI 大腦 — 看起來 API 金鑰失效或被拒絕（${err.status}）。請更新 OPENROUTER_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY 後重啟服務。${settingsHint}`;
    }
    if (err.reason === "permanent_quota") {
      return `🌿 抱歉，AI 服務商回報額度／餘額不足（${err.status}）。請到對應供應商儀表板補額度，或先切換到還有額度的引擎。${settingsHint}`;
    }
    if (err.reason === "permanent_model") {
      return `🌿 抱歉，目前選用的模型 ID 不被 AI 服務商接受（${err.status} invalid_model）。請到 /ai-brain-settings 確認各大腦的模型設定為有效值（例如 perplexity/sonar-pro、anthropic/claude-opus-4.7）。${settingsHint}`;
    }
  }

  if (err instanceof TRPCError && err.code === "SERVICE_UNAVAILABLE") {
    return `🌿 ${errorMsg}`;
  }

  // Aggregate from invokeLLM when every engine in the chain hit a permanent error.
  if (errorMsg.includes("所有可用引擎皆因金鑰") || errorMsg.includes("金鑰／額度問題失敗")) {
    return `🌿 抱歉，所有 AI 引擎暫時都連不上（金鑰或額度問題）。請檢查 OPENROUTER_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY 是否仍有效。${settingsHint}`;
  }

  // Thrown from resolveEngineConfig when no provider env var is set at all.
  if (errorMsg.includes("沒有可用的 LLM 引擎") || /no .*llm engine/i.test(errorMsg)) {
    return `🌿 後端尚未設定任何 AI 引擎金鑰。請至少設定 OPENROUTER_API_KEY 或 ANTHROPIC_API_KEY 後重啟服務。${settingsHint}`;
  }

  // Other config-style errors that bubbled up as plain text.
  if (/api[_-]?key|未設定|providerReadiness/i.test(errorMsg)) {
    return `🌿 ${errorMsg}`;
  }

  // Timeout from withTimeout("全站光球代理") — surface a retry hint, not the
  // generic "check settings" line, since this is usually a transient slowdown.
  if (lower.includes("timed out") || errorMsg.includes("全站光球代理")) {
    return "🌿 AI 大腦這次回應有點慢（已超時）。稍等一下再試一次，通常就會恢復。";
  }

  return "🌿 抱歉，我剛才遇到了一點小狀況。請稍等一下再試試～如果問題持續，可以在設定頁檢查 API 設定唷。";
}

