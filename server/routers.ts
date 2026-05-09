import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import {
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  brainProcedure,
  router,
} from "./_core/trpc";
import { isDemoMode } from "./_core/googleAuth";
import { z } from "zod";
import * as db from "./db";
import {
  invokeLLM,
  extractMessageText,
  extractMessageJson,
  type Message,
} from "./_core/llm";
import { serverEnv } from "./_core/env.validated";
import { featureFlags } from "./_core/featureFlags";
// imageGeneration.ts no longer used directly — all 4 modalities go through falDispatcher
import { storagePut } from "./storage";
import { TRPCError } from "@trpc/server";
import { generationBus } from "./generationEvents";
import { newsRouter } from "./routers/news";
import { showcaseRouter } from "./routers/showcase";
import { senseRouter } from "./routers/sense";
import { brainRouter } from "./routers/brain";
import { brainPipelineRouter } from "./routers/brainPipeline";
import { proStudioRouter } from "./routers/proStudio";
import { imageStudioRouter } from "./routers/imageStudio";
import { videoStudioRouter } from "./routers/videoStudio";
import { learnHubRouter } from "./routers/learnHub";
import { loraTrainerRouter } from "./routers/loraTrainer";
import { modelConsentsRouter } from "./routers/modelConsents";
import { directorRouter } from "./routers/director";
import { langsmithRouter } from "./routers/langsmith";
import { promptLibraryRouter } from "./routers/promptLibrary";
import { externalServicesRouter } from "./routers/externalServices";
import { apiUsageRouter } from "./routers/apiUsage";
import { orbSchedulerRouter } from "./routers/orbSchedulerRouter";
import { agentPreferencesRouter } from "./routers/agentPreferencesRouter";
import { orbCapabilitiesRouter } from "./routers/orbCapabilitiesRouter";
import { orbProxyRouter } from "./routers/orbProxyRouter";
import { orbConversationsRouter } from "./routers/orbConversationsRouter";
import { adminRouter } from "./routers/adminRouter";
import { agentCollaborationRouter } from "./routers/agentCollaborationRouter";
import { getOrchestrator } from "./services/modelClients";
// voiceCompiler, audioCompiler, videoCompiler are no longer used — all modalities route through falDispatcher
import { buildMemoryContext, upsertMemory } from "./services/ragMemory";
import { buildOrbSystemPrompt, type OrbPromptExtras } from "./services/siteKnowledge";
import { parseOrbReply } from "./services/orbReplyParser";
import { sanitizeOrbMessages } from "../shared/orb-prompt-defense";
import { computeDashboardInsights } from "../shared/dashboard-insights";
import { moderateOrbContent } from "../shared/orb-content-moderation";
import { executeOrbToolCalls } from "./services/agentToolExecutor";
import { getOrbToolRegistry } from "./config/orbToolRegistry";
import { orbTaskRepository } from "./repositories/orbTaskRepository";
import { executeCurrentStepTools, runOrbTaskToCompletion } from "./services/orbTaskOrchestrator";
import { loadAgentPreferencesForUser } from "./services/agentPreferenceService";
import { orbToolCallLogStore } from "./services/orbToolCallLogStore";
import { runSchemaFirstAgentPlanner, type AgentPlannerInput } from "./services/agentPlanner";
import { runOrbTaskWithContinuationLoop } from "./services/orbTaskChainRunner";
import { runOrbTaskWithOptionalMultiAgent, isMultiAgentRoutingEnabled } from "./services/multiAgentIntegration";
import { getOrbTaskPlannerContext } from "./services/orbTaskPlannerContextStore";
import { setOrbTaskPlannerContext } from "./services/orbTaskPlannerContextStore";
import { appendOrbTaskPageState } from "./services/orbTaskPageStateStore";
import { orbTaskTracer } from "./services/orbTaskTracer";
import { createReplanCallback, type ReplanCallbackContext } from "./services/orbTaskReplanIntegration";
import {
  getRecentSpecialistTools,
  getSpecialistMemoryHints,
  recordToolAuditAsSpecialistInteraction,
} from "./services/specializedAgentMemoryStore";
import {
  approveOrbAgentTask,
  cancelOrbAgentTask,
  completeOrbAgentStep,
  createOrbAgentTaskFromPlanner,
  failOrbAgentStep,
  getOrbAgentTask,
  getOrbAgentTaskEvents,
  listRecentOrbAgentTasks,
  retryOrbAgentTask,
} from "./services/orbTaskStateMachine";
import {
  getRecentOrbTaskMemory,
  summarizeRecentOrbTaskMemoryForPlanner,
} from "./services/orbTaskMemory";
import {
  buildOrbMemorySummaryForPlanner,
  clearOrbMemoryForUser,
  deleteOrbMemory,
  getRecentOrbMemories,
  recordOrbMemory,
  searchOrbMemoriesWithRag,
  summarizeOrbMemoriesForPlanner,
} from "./services/orbMemory";
import {
  approveCodeTask,
  attachCodeTaskPr,
  cancelCodeTask,
  createOrbCodeTask,
  getCodeTask,
  getCodeTaskTelemetry,
  listRecentCodeTasks,
  markCodeTaskFailed,
  markCodeTaskMerged,
  markCodeTaskReviewRequired,
  markCodeTaskRunning,
} from "./services/orbCodeTask";
import {
  buildClaudeCodeTaskPrompt,
  buildCodexTaskPrompt,
} from "../shared/orb-code-task";
import {
  aggregatePreferenceProfile,
  extractOrbPreferencesFromConversation,
  summarizeSiteKnowledgeForPlanner,
  summarizeRecentMemoryForPlanner,
} from "../shared/orb-memory";
import {
  OrbStartTaskInputSchema,
  OrbApproveTaskInputSchema,
  OrbApproveStepInputSchema,
  OrbStepReportInputSchema,
} from "../shared/orb-agent-contract";
import {
  mergeFeedbackHistories,
  buildOrbGuideStepPrompt,
  parseOrbGuideStepReply,
  type AgentFeedbackEvent,
  type OrbGuideStepContext,
  type PageAgentSnapshot,
} from "../shared/agent-actions";
import { extractJsonObjectFromText } from "../shared/agent-plan-adapter";
import { OrbChatRouterMessageSchema } from "../shared/orb-chat-multimodal";
import {
  estimatePoints,
  getModelPricing,
  checkModelAvailability,
  getAllPricingByCategory,
} from "./services/modelPricing";
import {
  dispatchImageGeneration,
  dispatchVideoGeneration,
  dispatchAudioGeneration,
  dispatchTTS,
  resolveFalEnginesFromRow,
  DEFAULT_FAL_ENGINES,
  estimateGenerationPoints,
  dispatchFalQueueTask,
} from "./services/falDispatcher";
import { getGeminiMediaClient } from "./services/geminiMedia";
import {
  localizeResultUrls,
  persistExternalMediaUrl,
} from "./services/internalMedia";
import { eq } from "drizzle-orm";
import { userAiBrain, promptLibrary } from "../drizzle/schema";
import { getDb, getSiteWideModelUsageSnapshot } from "./db";
import { normalizeEngineModelId } from "../shared/engineModelIds";
import { selectProvider, type ProviderRouteIntent } from "./services/providerRouter";
import {
  selectRoleForIntent,
  getPreferredProviderForRole,
  type AgentRole,
} from "../shared/orb-agent-roles";
import {
  getProviderHealth,
  markProviderFailure,
  markProviderRecovered,
} from "./services/providerHealth";
import { estimateOrbTaskCost } from "./services/orbCostGuard";
import { checkAndConsumeQuota, getOrbQuotaSnapshot } from "./services/orbQuota";
import {
  buildOrbIdempotencyKey,
  checkAndLock,
  findDuplicateTask,
  getResult,
  rememberTaskKey,
  storeResult,
} from "./services/orbIdempotency";
import { validateAttachmentGuards } from "./services/orbAttachmentGuard";
import { runOrbWebResearch } from "./services/orbWebResearch";
import {
  doPostGenComplete,
  runPostGenForJob,
} from "./services/postGenActions";

// ─── Dev-only debug logger (no-ops in production) ─────────────────────────
const isDev = process.env.NODE_ENV !== "production";
const debug = isDev ? console.log : () => {}; // eslint-disable-line no-console

// ─── Timeout Utility ────────────────────────────────────────────────────────

/**
 * Wraps a promise with a timeout. If the promise doesn't resolve within
 * the specified duration, it rejects with a descriptive timeout error.
 * This ensures external API calls (LLM, image gen, etc.) don't hang forever.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "API"
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`${label} 回應超時（${Math.round(ms / 1000)}秒），請稍後再試`)
      );
    }, ms);
    promise
      .then(val => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function ensureFalApiKeyConfigured(): void {
  if (serverEnv.FAL_API_KEY?.trim()) return;
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message:
      "創作工作室四模態共用 Fal.ai；目前尚未設定 FAL_API_KEY。請到 /admin/api-usage 檢查 providerReadiness，設定後重啟服務。",
  });
}

function ensureGeminiApiKeyConfigured(): void {
  if (serverEnv.GEMINI_API_KEY?.trim()) return;
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message:
      "目前選用 Gemini 系列生成引擎，但尚未設定 GEMINI_API_KEY。請到 /admin/api-usage 檢查 providerReadiness，設定後重啟服務。",
  });
}

function isGeminiEngine(modelId: string | undefined): boolean {
  return typeof modelId === "string" && modelId.startsWith("gemini/");
}

/**
 * fal-ai/lora 使用 image_size 而非 aspect_ratio。
 * 對應前端工作室的 aspectRatio 選項到 fal-ai/lora 的 enum。
 */
function aspectRatioToImageSize(
  aspectRatio: string | undefined
): string {
  switch (aspectRatio) {
    case "1:1":
      return "square_hd";
    case "16:9":
      return "landscape_16_9";
    case "9:16":
      return "portrait_16_9";
    case "4:3":
      return "landscape_4_3";
    case "3:4":
      return "portrait_4_3";
    default:
      return "square_hd";
  }
}

function isFlagEnabled(value: string | undefined, defaultEnabled: boolean): boolean {
  if (value === undefined || value === null || value.trim() === "") return defaultEnabled;
  const normalized = value.trim().toLowerCase();
  return !["0", "false", "off", "no", "disabled"].includes(normalized);
}

/**
 * Tracks the task IDs whose orchestrator loop is currently running, so two
 * approve clicks (or approve+retry) don't double-fire the executor.
 *
 * Each entry stores the timestamp the driver started so we can self-heal
 * when an unhandled rejection slips past the try/finally (rare but
 * possible in some Node async contexts). Without the TTL, a single
 * crashed driver would lock the user out of retrying the task forever.
 */
const ORB_AUTO_DRIVER_STALE_MS = 10 * 60_000; // 10 minutes
const orbAutoDriverInFlight = new Map<string, number>();

function isOrbAutoDriverInFlight(taskId: string): boolean {
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
async function driveOrbTaskInBackground(input: {
  taskId: string;
  userId: number;
  userRole: string;
}): Promise<void> {
  if (isOrbAutoDriverInFlight(input.taskId)) return;
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
function pickReasoningSlotForOrbChat(input: {
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
function applyDisabledActionsByPage<T extends { type: string }>(
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

function sanitizeTelemetryValue(input: unknown): unknown {
  if (typeof input !== "string") return input;
  return input
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/sk-[a-z0-9]{8,}/gi, "sk-[REDACTED]")
    .replace(/^data:[^;]+;base64,[a-z0-9+/=\s]+$/i, "[BASE64_REDACTED]");
}

function appendTelemetryEvent(
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

function getBrainSelectedEngine(
  brainRow: Record<string, unknown> | null,
  key: "imageEngine" | "videoEngine" | "audioEngine" | "voiceEngine"
): string | undefined {
  const value = brainRow?.[key];
  if (typeof value !== "string" || !value.trim()) return undefined;
  return normalizeEngineModelId(value.trim());
}

function extFromMime(mimeType: string, fallback: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes("png")) return "png";
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (lower.includes("webp")) return "webp";
  if (lower.includes("wav")) return "wav";
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  if (lower.includes("ogg")) return "ogg";
  return fallback;
}

async function storeBase64Media(params: {
  base64: string;
  mimeType: string;
  prefix: string;
  fallbackExt: string;
}): Promise<string> {
  const ext = extFromMime(params.mimeType, params.fallbackExt);
  const key = `${params.prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buffer = Buffer.from(params.base64, "base64");
  const stored = await storagePut(key, buffer, params.mimeType || "application/octet-stream");
  return stored.url;
}

// ─── Post-Generation Completion Helper ───────────────────────────────────────
// Implementation moved to ./services/postGenActions so it can be called from
// webhookFal too — webhook completion previously skipped library/history.

// ─── Safety Moderation Middleware ────────────────────────────────────────────

async function checkSafety(
  text: string
): Promise<{ safe: boolean; reason?: string }> {
  try {
    const result = await withTimeout(
      invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一個內容安全審核助手。請判斷以下內容是否安全、適當。
如果內容包含 NSFW、暴力、仇恨言論或其他不當內容，回覆 JSON: {"safe": false, "reason": "原因"}
如果內容安全，回覆 JSON: {"safe": true}
只回覆 JSON，不要其他文字。`,
          },
          { role: "user", content: text },
        ],
        runName: "safety-moderation",
        maxTokens: 256,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "safety_check",
            strict: true,
            schema: {
              type: "object",
              properties: {
                safe: { type: "boolean" },
                reason: { type: "string", description: "Reason if not safe" },
              },
              required: ["safe", "reason"],
              additionalProperties: false,
            },
          },
        },
      }),
      15_000,
      "安全檢查"
    );
    // Fence-tolerant parse — Gemini json_object mode occasionally wraps
    // the response in ```json fences. A naive JSON.parse there throws,
    // the catch defaults to { safe: true }, and the safety gate becomes
    // permanently no-op without the operator noticing. Also handle
    // array-form content via extractMessageJson.
    const parsed = extractMessageJson(
      result.choices[0]?.message?.content,
      extractJsonObjectFromText
    ) as { safe?: unknown; reason?: unknown } | null;
    if (parsed && typeof parsed === "object") {
      return {
        safe: parsed.safe !== false,
        ...(typeof parsed.reason === "string"
          ? { reason: parsed.reason }
          : {}),
      };
    }
    return { safe: true };
  } catch {
    // On timeout or error, default to safe to avoid blocking user
    return { safe: true };
  }
}

// ─── Elite Prompt Compiler ───────────────────────────────────────────────────

async function compileElitePrompt(payload: {
  prompt: string;
  vibeCardIds: string[];
  temperature: number;
  generationType: string;
  referenceImages?: {
    styleUrl?: string | null;
    vibeUrl?: string | null;
    characterUrl?: string | null;
  };
  memoryContext?: string; // Phase 14 RAG 記憶注入
  // ── AI 大腦組態注入（來自 ctx.brain）────────────────────
  brainModel?: string; // storyteller/director model override
  brainTemperature?: number; // storyteller.temperature
  brainTopP?: number; // storyteller.topP
}): Promise<{
  compiledPrompt: string;
  visualWeight: number;
  controlNetParams: Record<string, unknown>;
}> {
  const vibeDescriptions = payload.vibeCardIds.join(", ");

  // ── Visual Weight Calculation ──
  // When reference images are provided, calculate a visual weight factor
  // that adjusts how strongly the reference influences the generation
  const refImages = payload.referenceImages || {};
  const hasStyleRef = !!refImages.styleUrl;
  const hasVibeRef = !!refImages.vibeUrl;
  const hasCharRef = !!refImages.characterUrl;
  const refCount = [hasStyleRef, hasVibeRef, hasCharRef].filter(Boolean).length;

  // Visual weight: 0.0 (no refs) to 1.0 (all refs provided)
  // Each reference type contributes differently:
  //   style: 0.4, vibe: 0.3, character: 0.3
  const visualWeight =
    (hasStyleRef ? 0.4 : 0) + (hasVibeRef ? 0.3 : 0) + (hasCharRef ? 0.3 : 0);

  // ControlNet-compatible parameters for downstream model integration
  const controlNetParams: Record<string, unknown> = {
    enabled: refCount > 0,
    styleWeight: hasStyleRef ? 0.65 : 0,
    vibeWeight: hasVibeRef ? 0.5 : 0,
    characterWeight: hasCharRef ? 0.75 : 0,
    totalVisualWeight: visualWeight,
    referenceMode:
      refCount === 0 ? "none" : refCount === 1 ? "single" : "multi",
  };

  // Build reference context for the LLM
  const refContext =
    refCount > 0
      ? `\n\n參考圖片資訊：\n- 風格參考：${hasStyleRef ? "已提供（權重 0.65）" : "無"}\n- 氛圍參考：${hasVibeRef ? "已提供（權重 0.5）" : "無"}\n- 角色參考：${hasCharRef ? "已提供（權重 0.75）" : "無"}\n- 綜合視覺權重：${visualWeight.toFixed(2)}\n請在提示詞中加入 "maintaining visual consistency with reference" 等指令。`
      : "";

  const memorySection = payload.memoryContext || "";
  // Effective temperature: prefer brain-injected value, fallback to input.temperature
  const effectiveTemperature = payload.brainTemperature ?? payload.temperature;
  try {
    const result = await withTimeout(
      invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一位精英級 AI 提示詞編譯器。你的任務是將使用者的簡短描述擴展為一段優化的、敘事性的提示詞。

規則：
1. 必須使用正面解剖學約束（例如：「完美對稱的解剖結構、無瑕的比例」），絕對不使用負面提示
2. 融入氛圍描述：${vibeDescriptions}
3. 創意溫度：${effectiveTemperature}（0=保守精確，1=大膽創新）
4. 生成類型：${payload.generationType}
5. 輸出必須是一段流暢的英文敘事提示詞
6. 加入光線、構圖、色調等專業攝影/藝術指導
7. 確保人物描述包含：perfectly symmetrical anatomy, flawless proportions, natural pose${refContext}${memorySection}`,
          },
          { role: "user", content: payload.prompt },
        ],
        runName: "prompt-compiler",
        maxTokens: 2048,
        // Inject brain model & parameters when available
        ...(payload.brainModel ? { model: payload.brainModel } : {}),
        ...(payload.brainTemperature !== undefined
          ? { temperature: payload.brainTemperature }
          : {}),
        ...(payload.brainTopP !== undefined ? { topP: payload.brainTopP } : {}),
      }),
      30_000,
      "提示詞編譯"
    );
    const text = extractMessageText(result.choices[0]?.message?.content);
    const compiledPrompt = text || payload.prompt;
    return { compiledPrompt, visualWeight, controlNetParams };
  } catch {
    // LLM unavailable (e.g., no GEMINI_API_KEY in demo mode) — gracefully fall back to original prompt
    return { compiledPrompt: payload.prompt, visualWeight, controlNetParams };
  }
}

// ─── Router Definition ───────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,

  // ─── Homepage Public APIs (Read-only, LOD Pagination) ──────────────────
  news: newsRouter,
  showcase: showcaseRouter,
  sense: senseRouter,
  brain: brainRouter,
  brainPipeline: brainPipelineRouter,
  proStudio: proStudioRouter,
  imageStudio: imageStudioRouter,
  videoStudio: videoStudioRouter,
  learnHub: learnHubRouter,
  loraTrainer: loraTrainerRouter,
  modelConsents: modelConsentsRouter,
  promptLibrary: promptLibraryRouter,
  externalServices: externalServicesRouter,
  apiUsage: apiUsageRouter,
  orbScheduler: orbSchedulerRouter,
  agentPreferences: agentPreferencesRouter,
  orbCapabilities: orbCapabilitiesRouter,
  orbProxy: orbProxyRouter,
  orbConversations: orbConversationsRouter,
  agentCollaboration: agentCollaborationRouter,
  adminEval: adminRouter,

  // ─── Orb Agent Observability ─────────────────────────────────────────────
  orbTraces: router({
    /** Get trace by ID for debugging */
    getTrace: protectedProcedure
      .input(z.object({ traceId: z.string() }))
      .query(({ input }) => {
        return orbTaskTracer.getTrace(input.traceId);
      }),

    /** Get recent traces for user */
    listUserTraces: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(50).optional() }))
      .query(({ ctx, input }) => {
        return orbTaskTracer.getTracesForUser(ctx.user.id, input.limit);
      }),

    /** Get execution timeline for visualization */
    getTimeline: protectedProcedure
      .input(z.object({ traceId: z.string() }))
      .query(({ input }) => {
        return orbTaskTracer.getTimeline(input.traceId);
      }),

    /** Export trace in observability platform format */
    exportTrace: protectedProcedure
      .input(z.object({
        traceId: z.string(),
        format: z.enum(["langfuse", "langsmith", "otlp"]).optional(),
      }))
      .query(({ input }) => {
        return orbTaskTracer.exportTrace(input.traceId, input.format);
      }),

    /** Analyze failure patterns for debugging */
    analyzeFailures: protectedProcedure.query(({ ctx }) => {
      return orbTaskTracer.analyzeFailurePatterns(ctx.user.id);
    }),
  }),

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    updateAvatar: protectedProcedure
      .input(
        z.object({
          // null = clear; "preset:<id>" | http(s) URL | data URL ≤ 64 KB.
          avatarUrl: z
            .string()
            .max(64 * 1024)
            .nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const value = input.avatarUrl;
        if (value !== null) {
          const looksLikePreset = value.startsWith("preset:");
          const looksLikeUrl = /^https?:\/\//i.test(value);
          const looksLikeDataUrl = value.startsWith("data:image/");
          if (!looksLikePreset && !looksLikeUrl && !looksLikeDataUrl) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "avatarUrl must be a preset id, https URL, or data URL",
            });
          }
        }
        await db.updateUserAvatar(ctx.user.id, value);
        return { ok: true as const, avatarUrl: value };
      }),
  }),

  // ─── Credits / Points Info ───────────────────────────────────────────────
  credits: router({
    /** 取得所有模型的定價分類表（公開，無需登入） */
    pricingCatalog: publicProcedure.query(() => {
      const byCategory = getAllPricingByCategory();
      // Transform to serializable format
      const result: Record<
        string,
        Array<{
          modelId: string;
          label: string;
          provider: string;
          tier: string;
          basePoints: number;
          unit: string;
          minPoints: number;
          maxPoints: number;
          pointsPerSecond?: number;
          pointsPer1kChars?: number;
          pointsPerImage?: number;
          pointsPerStep?: number;
        }>
      > = {};
      for (const [cat, models] of Object.entries(byCategory)) {
        result[cat] = models.map(m => ({
          modelId: m.modelId,
          label: m.label,
          provider: m.provider,
          tier: m.tier,
          basePoints: m.basePoints,
          unit: m.unit,
          minPoints: m.minPoints,
          maxPoints: m.maxPoints,
          pointsPerSecond: m.pointsPerSecond,
          pointsPer1kChars: m.pointsPer1kChars,
          pointsPerImage: m.pointsPerImage,
          pointsPerStep: m.pointsPerStep,
        }));
      }
      return result;
    }),

    /** 取得使用者目前積分餘額（需登入） */
    myBalance: protectedProcedure.query(async ({ ctx }) => {
      return {
        remaining: ctx.user.remainingGenerations ?? 0,
      };
    }),
  }),

  // ─── Generation ──────────────────────────────────────────────────────────

  generate: router({
    /**
     * Pre-flight: load brain config → estimate points → deduct → create job
     *
     * 點數計費規則（1 USD ≈ 100 pts）：
     *  - 讀取使用者 AI 大腦組態，取得各模態選定的引擎
     *  - 依 MODEL_PRICING_CATALOG 精確估算本次任務點數
     *  - SELECT FOR UPDATE 原子扣點，不足則拒絕並顯示友善錯誤
     *  - 傳回 jobId、引擎名稱、點數明細供前端顯示
     */
    prepareJob: protectedProcedure
      .input(
        z.object({
          generationType: z.enum([
            "image",
            "video",
            "audio",
            "voice",
            "multimodal",
          ]),
          durationSec: z.number().optional(),
          charCount: z.number().optional(),
          overrideEngine: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        const demoMode = isDemoMode();
        const overrideEngine = input.overrideEngine
          ? normalizeEngineModelId(input.overrideEngine)
          : undefined;

        // ── Step 1: 讀取使用者大腦組態 ──
        let brainRow: Record<string, unknown> | null = null;
        try {
          const database = await getDb();
          if (database) {
            const rows = await database
              .select()
              .from(userAiBrain)
              .where(eq(userAiBrain.userId, userId))
              .limit(1);
            brainRow = (rows[0] ?? null) as Record<string, unknown> | null;
          }
        } catch {
          /* fallback to defaults */
        }

        const falEngines = resolveFalEnginesFromRow(brainRow);
        const brainImageEngine = getBrainSelectedEngine(brainRow, "imageEngine");
        const brainVideoEngine = getBrainSelectedEngine(brainRow, "videoEngine");
        const brainAudioEngine = getBrainSelectedEngine(brainRow, "audioEngine");
        const brainVoiceEngine = getBrainSelectedEngine(brainRow, "voiceEngine");

        // ── Step 2: 選定本次任務的引擎 ──
        const modalityEngineMap: Record<string, string> = {
          image:
            overrideEngine ??
            String(brainRow?.imageEngine ?? falEngines.textToImage),
          video:
            overrideEngine ??
            String(brainRow?.videoEngine ?? falEngines.textToVideo),
          audio:
            overrideEngine ??
            String(brainRow?.audioEngine ?? falEngines.textToAudio),
          voice:
            overrideEngine ??
            String(brainRow?.voiceEngine ?? falEngines.textToSpeech),
          multimodal:
            overrideEngine ??
            String(brainRow?.imageEngine ?? falEngines.textToImage),
        };
        const selectedEngine =
          modalityEngineMap[input.generationType] ?? "gemini/imagen-3";

        // ── Step 3: 按模型成本估算點數 ──
        const estimate = estimatePoints(selectedEngine, {
          durationSec: input.durationSec,
          charCount: input.charCount,
        });
        const pointsCost = estimate.totalPoints; // 最少 1 pt

        // ── Step 4: 原子扣點（Demo 模式跳過） ──
        let deduction = {
          success: true,
          remainingBefore: 999,
          remainingAfter: 999,
        };
        if (!demoMode) {
          deduction = await db.deductUserPoints(userId, pointsCost);
          if (!deduction.success) {
            const remaining = deduction.remainingBefore;
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `積分不足（需要 ${pointsCost} pts，剩餘 ${remaining} pts）。請至設定頁面查看積分或聯繫管理員。`,
            });
          }
        }

        // ── Step 5: 建立背景任務（Demo 模式使用假 jobId） ──
        let jobId: number;
        if (demoMode) {
          jobId = Date.now() % 2147483647; // 用時間戳作為 demo jobId
        } else {
          jobId = await db.createBackgroundJob({
            userId,
            jobType:
              input.generationType === "multimodal"
                ? "multimodal"
                : input.generationType,
            status: "processing",
            progress: 2,
            progressMessage: "準備中...",
          });
        }

        // ── Step 6: 推送初始思維鏈節點（含積分明細） ──
        const modalityLabel =
          input.generationType === "image"
            ? "圖像"
            : input.generationType === "video"
              ? "影片"
              : input.generationType === "audio"
                ? "音樂"
                : "語音";
        const pricing = getModelPricing(selectedEngine);
        const engineLabel = pricing?.label ?? selectedEngine;

        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "safety",
            label: "安全檢查",
            status: "queued",
            detail: "等待中...",
            timestamp: 0,
          },
        });
        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "compile",
            label: "提示詞編譯",
            status: "queued",
            detail: "等待中...",
            timestamp: 0,
          },
        });
        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "weight",
            label: "視覺權重計算",
            status: "queued",
            detail: "等待中...",
            timestamp: 0,
          },
        });
        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "generate",
            label: `${modalityLabel}生成（${engineLabel}）`,
            status: "queued",
            detail: "等待中...",
            timestamp: 0,
          },
        });
        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "quota",
            label: "積分扣除",
            status: "completed",
            detail: `扣除 ${pointsCost} pts ｜ ${estimate.breakdown} ｜ 引擎：${engineLabel} ｜ 剩餘：${deduction.remainingAfter} pts`,
            timestamp: Date.now(),
          },
        });
        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "history",
            label: "歷史紀錄",
            status: "queued",
            detail: "等待中...",
            timestamp: 0,
          },
        });
        generationBus.emit(jobId, {
          type: "progress",
          progress: 2,
          message: `任務已建立 ｜ ${engineLabel} ｜ ${pointsCost} pts`,
        });

        return {
          jobId,
          selectedEngine,
          engineLabel,
          pointsCost,
          pointsBreakdown: estimate.breakdown,
          remainingPoints: deduction.remainingAfter,
        };
      }),

    /**
     * 查詢本次生成的點數預估（不扣點，供前端顯示費用預覽）
     */
    estimateCost: protectedProcedure
      .input(
        z.object({
          generationType: z.enum(["image", "video", "audio", "voice"]),
          durationSec: z.number().optional(),
          charCount: z.number().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        let brainRow: Record<string, unknown> | null = null;
        try {
          const database = await getDb();
          if (database) {
            const rows = await database
              .select()
              .from(userAiBrain)
              .where(eq(userAiBrain.userId, userId))
              .limit(1);
            brainRow = (rows[0] ?? null) as Record<string, unknown> | null;
          }
        } catch {
          /* fallback */
        }

        const falEngines = resolveFalEnginesFromRow(brainRow);
        const modalityEngineMap: Record<string, string> = {
          image: String(brainRow?.imageEngine ?? falEngines.textToImage),
          video: String(brainRow?.videoEngine ?? falEngines.textToVideo),
          audio: String(brainRow?.audioEngine ?? falEngines.textToAudio),
          voice: String(brainRow?.voiceEngine ?? falEngines.textToSpeech),
        };
        const engineId = modalityEngineMap[input.generationType];
        const estimate = estimatePoints(engineId, {
          durationSec: input.durationSec,
          charCount: input.charCount,
        });
        const pricingInfo = getModelPricing(engineId);
        const availability = checkModelAvailability(engineId);

        return {
          generationType: input.generationType,
          engineId,
          engineLabel: pricingInfo?.label ?? engineId,
          provider: pricingInfo?.provider ?? "unknown",
          tier: pricingInfo?.tier ?? "standard",
          pointsCost: estimate.totalPoints,
          pointsBreakdown: estimate.breakdown,
          unit: pricingInfo?.unit ?? "每次",
          available: availability.available,
          availabilityNote: !availability.available
            ? availability.reason
            : undefined,
        };
      }),

    multimodal: brainProcedure
      .input(
        z.object({
          jobId: z.number(), // from prepareJob
          prompt: z.string().min(1),
          generationType: z.enum([
            "image",
            "video",
            "audio",
            "voice",
            "multimodal",
          ]),
          mode: z.enum(["lightning", "deep_precision"]),
          vibeCardIds: z.array(z.string()),
          temperature: z.number().min(0).max(1),
          seed: z.number().optional(),
          // Image workspace params
          aspectRatio: z.string().optional(),
          negativePrompt: z.string().optional(),
          styleReferenceUrl: z.string().nullable().optional(),
          vibeReferenceUrl: z.string().nullable().optional(),
          // Video workspace params
          videoDurationSeconds: z.number().optional(),
          firstFrameUrl: z.string().nullable().optional(),
          lastFrameUrl: z.string().nullable().optional(),
          characterRefUrl: z.string().nullable().optional(),
          cameraMotion: z
            .object({
              pan: z.number(),
              zoom: z.number(),
              tilt: z.number(),
            })
            .optional(),
          // Audio workspace params
          musicStyle: z.string().optional(),
          isInstrumental: z.boolean().optional(),
          lyrics: z.string().optional(),
          audioDuration: z.number().optional(),
          audioEnergy: z.number().optional(),
          // Voice workspace params
          voiceModelId: z.string().optional(),
          voiceText: z.string().optional(),
          voiceSpeed: z.number().optional(),
          voiceStability: z.number().optional(),
          voiceEmotionType: z.string().optional(),
          voiceEmotionIntensity: z.number().optional(),
          // Vault & Model injection params
          vaultCharacterId: z.number().optional(),
          vaultSceneId: z.number().optional(),
          fineTunedModelId: z.number().optional(),
          // LoRA weight for reference-guided generation
          loraWeight: z.number().min(0).max(1).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        const jobId = input.jobId;
        const demoMode = isDemoMode();
        const stepTimestamps: Record<string, number> = { start: Date.now() };
        const modalityLabel =
          input.generationType === "image"
            ? "圖像"
            : input.generationType === "video"
              ? "影片"
              : input.generationType === "audio"
                ? "音樂"
                : "語音";

        // ── Load brain config to get selected engines for this generation ──
        let brainRow: Record<string, unknown> | null = null;
        try {
          const database = await getDb();
          if (database) {
            const rows = await database
              .select()
              .from(userAiBrain)
              .where(eq(userAiBrain.userId, userId))
              .limit(1);
            brainRow = (rows[0] ?? null) as Record<string, unknown> | null;
          }
        } catch {
          /* use defaults */
        }
        const falEngines = resolveFalEnginesFromRow(brainRow);

        // Resolve which engine was selected for this modality (from brain config)
        const brainImageEngine = getBrainSelectedEngine(brainRow, "imageEngine");
        const brainVideoEngine = getBrainSelectedEngine(brainRow, "videoEngine");
        const brainAudioEngine = getBrainSelectedEngine(brainRow, "audioEngine");
        const brainVoiceEngine = getBrainSelectedEngine(brainRow, "voiceEngine");
        const _resolvedImageEngine = isGeminiEngine(brainImageEngine)
          ? brainImageEngine!
          : falEngines.textToImage;
        const _resolvedVideoEngine = isGeminiEngine(brainVideoEngine)
          ? brainVideoEngine!
          : falEngines.textToVideo;
        const _resolvedAudioEngine = isGeminiEngine(brainAudioEngine)
          ? brainAudioEngine!
          : falEngines.textToAudio;
        const _resolvedVoiceEngine = isGeminiEngine(brainVoiceEngine)
          ? brainVoiceEngine!
          : falEngines.textToSpeech;
        const _falTextToImageEngine = falEngines.textToImage;
        const _falTextToVideoEngine = falEngines.textToVideo;
        const _falTextToAudioEngine = falEngines.textToAudio;
        const _falTextToSpeechEngine = falEngines.textToSpeech;

        // Estimate real cost for this generation (for api usage log)
        const _genModelId =
          input.generationType === "video"
            ? _resolvedVideoEngine
            : input.generationType === "audio"
              ? _resolvedAudioEngine
              : input.generationType === "voice"
                ? _resolvedVoiceEngine
                : _resolvedImageEngine;
        const _genEstimate = estimatePoints(_genModelId, {
          durationSec:
            input.videoDurationSeconds ??
            (input.generationType === "audio"
              ? (input as any).audioDuration
              : undefined),
          charCount: input.voiceText?.length,
        });
        const _genPricing = getModelPricing(_genModelId);
        const _genEngineLabel = _genPricing?.label ?? _genModelId;

        // Safety pre-check (points already deducted in prepareJob)
        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "safety",
            label: "安全檢查",
            status: "processing",
            detail: "正在驗證內容安全...",
            timestamp: Date.now(),
          },
        });
        generationBus.emit(jobId, {
          type: "progress",
          progress: 5,
          message: "安全檢查中...",
        });

        const safetyResult = await checkSafety(input.prompt);
        stepTimestamps.safetyDone = Date.now();
        const safetyMs = stepTimestamps.safetyDone - stepTimestamps.start;
        generationBus.emit(jobId, {
          type: "thought-update",
          node: {
            id: "safety",
            label: "安全檢查",
            status: "passed",
            detail: `內容安全檢查通過（${safetyMs}ms）`,
            timestamp: stepTimestamps.safetyDone,
          },
        });
        generationBus.emit(jobId, {
          type: "progress",
          progress: 10,
          message: "安全檢查通過",
        });
        if (!safetyResult.safe) {
          // Emit error via SSE before throwing
          generationBus.emit(jobId, {
            type: "thought-update",
            node: {
              id: "safety",
              label: "安全檢查",
              status: "error",
              detail: safetyResult.reason || "內容不符合安全規範",
              timestamp: Date.now(),
            },
          });
          generationBus.emit(jobId, {
            type: "error",
            message: safetyResult.reason || "內容不符合安全規範",
          });
          setTimeout(() => generationBus.cleanup(jobId), 2000);
          // Refund the points since no generation occurred
          if (!demoMode) {
            await db.refundUserPoints(userId, _genEstimate.totalPoints);
            await db.createApiUsageLog({
              userId,
              requestType: "safety_check",
              apiProvider: "gemini_flash",
              responseStatus: "blocked",
              errorMessage: safetyResult.reason || "內容不符合安全規範",
              generationsDeducted: 0,
            });
          }
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `小兔子提醒你：${safetyResult.reason || "這個內容可能不太適合哦，請試試其他描述吧！"}`,
          });
        }

        if (isGeminiEngine(_genModelId)) {
          ensureGeminiApiKeyConfigured();
        } else {
          ensureFalApiKeyConfigured();
        }

        // ── Vault injection: resolve vault items to image URLs ──
        // 之前用 try/catch 把錯誤吞掉再 console.warn，使用者點「使用此角色」
        // 後送出，看到的結果跟沒選一樣，完全沒辦法分辨「角色找不到」「DB 連
        // 不上」「正常生成」。改成清楚的 BAD_REQUEST，使用者會看到 toast。
        if (input.vaultCharacterId) {
          let vaultChar: Awaited<ReturnType<typeof db.getVaultItem>> | undefined;
          try {
            vaultChar = await db.getVaultItem(input.vaultCharacterId);
          } catch (e) {
            console.warn("[Vault] Failed to load character vault item:", e);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "讀取角色保險庫失敗，請稍後重試",
            });
          }
          if (!vaultChar?.imageUrl) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `保險庫角色 #${input.vaultCharacterId} 找不到或缺少參考圖`,
            });
          }
          debug(
            `[Vault] Injecting character ref from vault #${vaultChar.id}: ${vaultChar.name}`
          );
          // For video: override characterRefUrl; for image: override styleReferenceUrl
          if (input.generationType === "video") {
            input.characterRefUrl =
              input.characterRefUrl || vaultChar.imageUrl;
            input.firstFrameUrl = input.firstFrameUrl || vaultChar.imageUrl;
          } else {
            input.styleReferenceUrl =
              input.styleReferenceUrl || vaultChar.imageUrl;
          }
        }
        if (input.vaultSceneId) {
          let vaultScene: Awaited<ReturnType<typeof db.getVaultItem>> | undefined;
          try {
            vaultScene = await db.getVaultItem(input.vaultSceneId);
          } catch (e) {
            console.warn("[Vault] Failed to load scene vault item:", e);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "讀取場景保險庫失敗，請稍後重試",
            });
          }
          if (!vaultScene?.imageUrl) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `保險庫場景 #${input.vaultSceneId} 找不到或缺少參考圖`,
            });
          }
          debug(
            `[Vault] Injecting scene ref from vault #${vaultScene.id}: ${vaultScene.name}`
          );
          input.vibeReferenceUrl =
            input.vibeReferenceUrl || vaultScene.imageUrl;
        }

        // ── Fine-tuned model injection: append triggerWord + inject LoRA URL ──
        let modelTriggerWord = "";
        let fineTunedLoraUrl: string | undefined;
        if (input.fineTunedModelId) {
          try {
            const ftModel = await db.getFineTunedModel(input.fineTunedModelId);
            if (ftModel) {
              debug(
                `[Model] Injecting fine-tuned model #${ftModel.id}: ${ftModel.name} (status=${ftModel.status})`
              );
              if (ftModel.status !== "ready") {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `模型「${ftModel.name}」尚未訓練完成（狀態：${ftModel.status}），請等待訓練完畢再使用`,
                });
              }
              const config = ftModel.configJson as Record<
                string,
                unknown
              > | null;
              if (
                config &&
                typeof config.triggerWord === "string" &&
                config.triggerWord.trim()
              ) {
                modelTriggerWord = config.triggerWord.trim();
                // Prepend trigger word so it appears prominently in compiled prompt
                input.prompt = `${modelTriggerWord}, ${input.prompt}`;
                debug(
                  `[Model] Prepended triggerWord "${modelTriggerWord}" to prompt`
                );
              }
              // Extract the trained LoRA weights URL (used for fal.ai sdLora endpoint)
              if (ftModel.trainedLoraUrl) {
                fineTunedLoraUrl = ftModel.trainedLoraUrl;
                debug(
                  `[Model] Will inject LoRA weights URL: ${fineTunedLoraUrl}`
                );
              } else if (
                ftModel.fileUrl &&
                (ftModel.fileUrl.endsWith(".safetensors") ||
                  ftModel.fileUrl.endsWith(".tar") ||
                  ftModel.fileUrl.includes("replicate"))
              ) {
                fineTunedLoraUrl = ftModel.fileUrl;
                debug(
                  `[Model] Will inject LoRA fileUrl as weights: ${fineTunedLoraUrl}`
                );
              }
              // Increment usage count asynchronously
              db.incrementModelUsage(ftModel.id).catch(() => {});
            }
          } catch (e) {
            if (e instanceof TRPCError) throw e;
            console.warn("[Model] Failed to load fine-tuned model:", e);
          }
        }

        try {
          // ── Phase 14: RAG 記憶檢索（非阻塞，失敗不影響生成）────────────
          let memoryContext = "";
          try {
            memoryContext = await Promise.race([
              buildMemoryContext(userId, input.prompt),
              new Promise<string>(resolve =>
                setTimeout(() => resolve(""), 3000)
              ), // 3s 超時
            ]);
          } catch {
            // RAG 失敗靜默降級
          }

          // Compile elite prompt with reference image awareness
          // ── Compile step ──
          generationBus.emit(jobId, {
            type: "thought-update",
            node: {
              id: "compile",
              label: "提示詞編譯",
              status: "processing",
              detail: "正在編譯提示詞...",
              timestamp: Date.now(),
            },
          });
          generationBus.emit(jobId, {
            type: "progress",
            progress: 15,
            message: "編譯提示詞中...",
          });
          stepTimestamps.compileStart = Date.now();
          // ── Read AI Brain storyteller config for prompt compilation ──
          const storytellerBrain = ctx.brain?.getBrain?.("storyteller");
          const { compiledPrompt, visualWeight, controlNetParams } =
            await withTimeout(
              compileElitePrompt({
                prompt: input.prompt,
                vibeCardIds: input.vibeCardIds,
                temperature: input.temperature,
                generationType: input.generationType,
                referenceImages: {
                  styleUrl: input.styleReferenceUrl,
                  vibeUrl: input.vibeReferenceUrl,
                  characterUrl: input.characterRefUrl,
                },
                memoryContext, // Phase 14 RAG 記憶注入
                // Inject brain configuration for model & sampling parameters
                brainModel: storytellerBrain?.enabled
                  ? storytellerBrain.model
                  : undefined,
                brainTemperature: storytellerBrain?.enabled
                  ? storytellerBrain.temperature
                  : undefined,
                brainTopP: storytellerBrain?.enabled
                  ? storytellerBrain.topP
                  : undefined,
              }),
              30_000,
              "提示詞編譯"
            );

          stepTimestamps.compileDone = Date.now();
          stepTimestamps.weightDone = Date.now();
          const compileMs =
            stepTimestamps.compileDone - stepTimestamps.compileStart;
          generationBus.emit(jobId, {
            type: "thought-update",
            node: {
              id: "compile",
              label: "提示詞編譯",
              status: "completed",
              detail: `編譯後提示詞長度: ${compiledPrompt.length} 字元（${compileMs}ms）`,
              timestamp: stepTimestamps.compileDone,
              tokens: compiledPrompt.length,
            },
          });
          generationBus.emit(jobId, {
            type: "thought-update",
            node: {
              id: "weight",
              label: "視覺權重計算",
              status: "completed",
              detail: `visualWeight: ${visualWeight.toFixed(2)}, controlNet: ${JSON.stringify(controlNetParams)}`,
              timestamp: stepTimestamps.weightDone,
              confidence: visualWeight,
            },
          });
          generationBus.emit(jobId, {
            type: "progress",
            progress: 30,
            message: "提示詞編譯完成",
          });
          if (!demoMode)
            await db.updateBackgroundJob(jobId, {
              progress: 30,
              progressMessage: "正在生成中...",
            });

          // ── Generate step ──
          generationBus.emit(jobId, {
            type: "thought-update",
            node: {
              id: "generate",
              label: `${modalityLabel}生成`,
              status: "processing",
              detail: `正在生成${modalityLabel}...`,
              timestamp: Date.now(),
            },
          });
          generationBus.emit(jobId, {
            type: "progress",
            progress: 40,
            message: `${modalityLabel}生成中...`,
          });

          // Generate based on type
          let resultUrl: string | undefined;
          let resultData: Record<string, unknown> = {
            visualWeight,
            controlNetParams,
            ...(input.fineTunedModelId && {
              modelUsed: {
                id: input.fineTunedModelId,
                triggerWord: modelTriggerWord,
              },
            }),
            ...(input.vaultCharacterId && {
              vaultCharacterId: input.vaultCharacterId,
            }),
            ...(input.vaultSceneId && { vaultSceneId: input.vaultSceneId }),
          };

          if (
            input.generationType === "image" ||
            input.generationType === "multimodal"
          ) {
            const refImageUrl =
              input.styleReferenceUrl || input.vibeReferenceUrl || undefined;
            let imageUrl: string | undefined;
            const imageEngine = _resolvedImageEngine;
            const imageViaGemini = isGeminiEngine(imageEngine);
            generationBus.emit(jobId, {
              type: "progress",
              progress: 42,
              message: imageViaGemini
                ? "正在呼叫 Gemini 生成圖片..."
                : "正在呼叫 fal.ai 生成圖片...",
            });
            try {
              if (imageViaGemini) {
                const gemini = getGeminiMediaClient();
                const geminiImage = await withTimeout(
                  gemini.generateImage({
                    prompt: compiledPrompt,
                    model:
                      imageEngine === "gemini/imagen-3-fast"
                        ? "imagen-3.0-fast-generate-001"
                        : "imagen-3.0-generate-002",
                    aspectRatio:
                      input.aspectRatio === "1:1" ||
                      input.aspectRatio === "3:4" ||
                      input.aspectRatio === "4:3" ||
                      input.aspectRatio === "9:16" ||
                      input.aspectRatio === "16:9"
                        ? input.aspectRatio
                        : undefined,
                    negativePrompt: input.negativePrompt,
                    seed: input.seed,
                    numImages: 1,
                  }),
                  150_000,
                  "Gemini 圖片生成"
                );
                const firstImage = geminiImage.images?.[0];
                if (firstImage?.base64) {
                  imageUrl = await storeBase64Media({
                    base64: firstImage.base64,
                    mimeType: firstImage.mimeType || "image/png",
                    prefix: `generated/studio/${userId}/image/gemini`,
                    fallbackExt: "png",
                  });
                }
              } else {
                // If user selected a fine-tuned LoRA model and we have the weights URL,
                // route to the sdLora / lora model instead of the standard T2I engine.
                const imageModelId = fineTunedLoraUrl
                  ? "fal-ai/lora"
                  : refImageUrl
                    ? falEngines.imageToImage
                    : falEngines.textToImage;
                const imageDispatch = await withTimeout(
                  dispatchImageGeneration({
                    modelId: imageModelId,
                    prompt: compiledPrompt,
                    negativePrompt: input.negativePrompt,
                    imageUrl: refImageUrl,
                    aspectRatio: input.aspectRatio,
                    seed: input.seed,
                    ...(fineTunedLoraUrl && {
                      loraUrl: fineTunedLoraUrl,
                      loraScale: input.loraWeight ?? 0.8,
                    }),
                  }),
                  150_000,
                  "圖片生成"
                );
                if (imageDispatch.success) {
                  imageUrl =
                    (imageDispatch.data as any)?.images?.[0]?.url ??
                    (imageDispatch.data as any)?.image?.url ??
                    ((imageDispatch.data as any)?.url as string | undefined);
                  if (imageUrl) {
                    imageUrl = await persistExternalMediaUrl(imageUrl, {
                      category: "image",
                      prefix: `generated/studio/${userId}/image`,
                    });
                  }
                } else if (!demoMode) {
                  await db.refundUserPoints(userId, _genEstimate.totalPoints);
                  throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `圖片生成失敗（fal.ai ${imageDispatch.modelId}）：${imageDispatch.error || "未知錯誤"}`,
                  });
                }
              }
            } catch (err) {
              if (!demoMode) throw err;
              debug(`[Demo] Image generation failed: ${err}`);
            }
            if (!imageUrl) {
              if (!demoMode)
                await db.refundUserPoints(userId, _genEstimate.totalPoints);
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "圖片生成未回傳有效 URL，請稍後再試",
              });
            }
            resultUrl = imageUrl;
            resultData.imageUrl = imageUrl;
            resultData.aspectRatio = input.aspectRatio;
            resultData.negativePrompt = input.negativePrompt;
            resultData.styleReferenceUrl = input.styleReferenceUrl;
            resultData.vibeReferenceUrl = input.vibeReferenceUrl;
            resultData.imageModel = imageEngine;
          }

          // ── Video: fal.ai Kling (真實 API，無 Gemini Veo 依賴) ──
          if (
            input.generationType === "video" ||
            input.generationType === "multimodal"
          ) {
            const videoEngine = _resolvedVideoEngine;
            const videoViaGemini = isGeminiEngine(videoEngine);
            generationBus.emit(jobId, {
              type: "progress",
              progress: 45,
              message: videoViaGemini
                ? "正在呼叫 Gemini Veo 生成影片..."
                : "正在呼叫 fal.ai 生成影片...",
            });
            const videoModelId = input.firstFrameUrl
              ? falEngines.imageToVideo
              : falEngines.textToVideo;
            let videoUrl: string | undefined;
            try {
              if (videoViaGemini) {
                const gemini = getGeminiMediaClient();
                const geminiVideo = await withTimeout(
                  gemini.generateVideoSync({
                    prompt: compiledPrompt,
                    model:
                      videoEngine === "gemini/veo-2"
                        ? "veo-2.0-generate-001"
                        : "veo-3.0-generate-preview",
                    imageUrl:
                      input.firstFrameUrl || input.characterRefUrl || undefined,
                    duration: input.videoDurationSeconds || 5,
                    aspectRatio:
                      input.aspectRatio === "9:16" ? "9:16" : "16:9",
                    negativePrompt: input.negativePrompt,
                    seed: input.seed,
                  }),
                  310_000,
                  "Gemini 影片生成"
                );
                videoUrl = geminiVideo.videoUrl;
              } else {
                const videoDispatch = await withTimeout(
                  dispatchVideoGeneration({
                    modelId: videoModelId,
                    prompt: compiledPrompt,
                    imageUrl:
                      input.firstFrameUrl || input.characterRefUrl || undefined,
                    durationSec: input.videoDurationSeconds || 5,
                    aspectRatio: input.aspectRatio || "16:9",
                    seed: input.seed,
                  }),
                  300_000,
                  "影片生成"
                );
                if (videoDispatch.success) {
                  videoUrl =
                    (videoDispatch.data as any)?.video?.url ??
                    (videoDispatch.data as any)?.videos?.[0]?.url ??
                    ((videoDispatch.data as any)?.url as string | undefined);
                  if (videoUrl) {
                    videoUrl = await persistExternalMediaUrl(videoUrl, {
                      category: "video",
                      prefix: `generated/studio/${userId}/video`,
                    });
                  }
                } else if (!demoMode) {
                  await db.refundUserPoints(userId, _genEstimate.totalPoints);
                  throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `影片生成失敗（fal.ai ${videoDispatch.modelId}）：${videoDispatch.error || "未知錯誤"}`,
                  });
                }
              }
            } catch (err) {
              if (!demoMode) throw err;
              debug(`[Demo] Video generation failed: ${err}`);
            }
            if (!videoUrl) {
              if (!demoMode)
                await db.refundUserPoints(userId, _genEstimate.totalPoints);
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "fal.ai 影片生成未回傳有效 URL，請稍後再試",
              });
            }
            resultData.videoUrl = videoUrl;
            resultData.videoStatus = "completed";
            resultData.videoDuration = input.videoDurationSeconds || 5;
            resultData.videoModel = videoViaGemini ? videoEngine : videoModelId;
            resultData.videoPrompt = compiledPrompt;
            resultData.firstFrameUrl = input.firstFrameUrl;
            resultData.lastFrameUrl = input.lastFrameUrl;
            resultData.characterRefUrl = input.characterRefUrl;
            resultData.cameraMotion = input.cameraMotion;
            if (!resultUrl) resultUrl = videoUrl;
          }

          // ── Audio: fal.ai stable-audio (真實 API，無 Gemini Lyria 依賴) ──
          if (
            input.generationType === "audio" ||
            input.generationType === "multimodal"
          ) {
            const audioEngine = _resolvedAudioEngine;
            const audioViaGemini = isGeminiEngine(audioEngine);
            generationBus.emit(jobId, {
              type: "progress",
              progress: 45,
              message: audioViaGemini
                ? "正在呼叫 Gemini 生成音樂..."
                : "正在呼叫 fal.ai 生成音樂...",
            });
            // Build music prompt from style + compiled prompt
            let musicPrompt = compiledPrompt;
            if (input.musicStyle) {
              musicPrompt = `${input.musicStyle}, ${compiledPrompt}`;
            }
            if (input.isInstrumental) {
              musicPrompt += ". Instrumental only, no vocals.";
            }
            if (input.lyrics) {
              musicPrompt += `\n\nLyrics:\n${input.lyrics}`;
            }
            let audioUrl: string | undefined;
            try {
              if (audioViaGemini) {
                const gemini = getGeminiMediaClient();
                const geminiAudio = await withTimeout(
                  gemini.generateAudio({
                    prompt: musicPrompt,
                    model: audioEngine === "gemini/musicfx" ? "musicfx-001" : "lyria-002",
                    duration: input.audioDuration || 30,
                    seed: input.seed,
                  }),
                  180_000,
                  "Gemini 音樂生成"
                );
                if (geminiAudio.audioBase64) {
                  audioUrl = await storeBase64Media({
                    base64: geminiAudio.audioBase64,
                    mimeType: geminiAudio.mimeType || "audio/wav",
                    prefix: `generated/studio/${userId}/audio/gemini`,
                    fallbackExt: "wav",
                  });
                }
              } else {
                const audioDispatch = await withTimeout(
                  dispatchAudioGeneration({
                    modelId: falEngines.textToAudio,
                    prompt: musicPrompt,
                    durationSec: input.audioDuration || 30,
                    seed: input.seed,
                  }),
                  180_000,
                  "音樂生成"
                );
                if (audioDispatch.success) {
                  audioUrl =
                    (audioDispatch.data as any)?.audio?.url ??
                    (audioDispatch.data as any)?.audio_url ??
                    ((audioDispatch.data as any)?.url as string | undefined);
                  if (audioUrl) {
                    audioUrl = await persistExternalMediaUrl(audioUrl, {
                      category: "audio",
                      prefix: `generated/studio/${userId}/audio`,
                    });
                  }
                } else if (!demoMode) {
                  await db.refundUserPoints(userId, _genEstimate.totalPoints);
                  throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `音樂生成失敗（fal.ai ${audioDispatch.modelId}）：${audioDispatch.error || "未知錯誤"}`,
                  });
                }
              }
            } catch (err) {
              if (!demoMode) throw err;
              debug(`[Demo] Audio generation failed: ${err}`);
            }
            if (!audioUrl) {
              if (!demoMode)
                await db.refundUserPoints(userId, _genEstimate.totalPoints);
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "fal.ai 音樂生成未回傳有效 URL，請稍後再試",
              });
            }
            resultData.audioUrl = audioUrl;
            resultData.audioStatus = "completed";
            resultData.audioTitle = input.musicStyle || "Healing Music";
            resultData.audioModel = audioEngine;
            resultData.musicStyle = input.musicStyle || "ambient healing";
            resultData.isInstrumental = input.isInstrumental;
            resultData.lyrics = input.lyrics;
            resultData.audioDuration = input.audioDuration;
            resultData.audioEnergy = input.audioEnergy;
            if (!resultUrl) resultUrl = audioUrl;
          }

          // ── Voice: fal.ai playai-tts (真實 API，無 Gemini TTS 依賴) ──
          if (input.generationType === "voice") {
            const voiceEngine = _resolvedVoiceEngine;
            const voiceViaGemini = isGeminiEngine(voiceEngine);
            generationBus.emit(jobId, {
              type: "progress",
              progress: 50,
              message: voiceViaGemini
                ? "正在呼叫 Gemini TTS 生成語音..."
                : "正在呼叫 fal.ai TTS 生成語音...",
            });
            const ttsText = input.voiceText || input.prompt;
            // Map emotion to fal.ai playai voice IDs
            const voiceIdMap: Record<string, string> = {
              warm: "s3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json",
              calm: "s3://voice-cloning-zero-shot/e5df2eb3-5153-40fa-9f6e-6e27bbb7a38e/original/manifest.json",
              cheerful:
                "s3://voice-cloning-zero-shot/f6594c50-e59b-492c-bac2-047d57f8bdd8/original/manifest.json",
              serious:
                "s3://voice-cloning-zero-shot/820da3d2-3a3b-42e7-8d14-a0e2bed3c4f3/original/manifest.json",
              gentle:
                "s3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json",
              energetic:
                "s3://voice-cloning-zero-shot/f6594c50-e59b-492c-bac2-047d57f8bdd8/original/manifest.json",
            };
            const falVoiceId =
              input.voiceModelId ||
              voiceIdMap[input.voiceEmotionType || ""] ||
              "s3://voice-cloning-zero-shot/e5df2eb3-5153-40fa-9f6e-6e27bbb7a38e/original/manifest.json";
            let voiceUrl: string | undefined;
            try {
              if (voiceViaGemini) {
                const gemini = getGeminiMediaClient();
                const geminiTTS = await withTimeout(
                  gemini.textToSpeech({
                    text: ttsText,
                    model:
                      voiceEngine === "gemini/tts-pro"
                        ? "gemini-2.5-pro-preview-tts"
                        : "gemini-2.5-flash-preview-tts",
                    voiceName: input.voiceModelId || "Zephyr",
                  }),
                  90_000,
                  "Gemini 語音生成"
                );
                if (geminiTTS.audioBase64) {
                  voiceUrl = await storeBase64Media({
                    base64: geminiTTS.audioBase64,
                    mimeType: geminiTTS.mimeType || "audio/wav",
                    prefix: `generated/studio/${userId}/voice/gemini`,
                    fallbackExt: "wav",
                  });
                }
              } else {
                const voiceDispatch = await withTimeout(
                  dispatchTTS({
                    modelId: falEngines.textToSpeech,
                    text: ttsText,
                    voiceId: falVoiceId,
                    speed: input.voiceSpeed,
                    charCount: ttsText.length,
                  }),
                  90_000,
                  "語音生成"
                );
                if (voiceDispatch.success) {
                  voiceUrl =
                    (voiceDispatch.data as any)?.audio?.url ??
                    (voiceDispatch.data as any)?.audio_url ??
                    ((voiceDispatch.data as any)?.url as string | undefined);
                  if (voiceUrl) {
                    voiceUrl = await persistExternalMediaUrl(voiceUrl, {
                      category: "voice",
                      prefix: `generated/studio/${userId}/voice`,
                    });
                  }
                } else if (!demoMode) {
                  await db.refundUserPoints(userId, _genEstimate.totalPoints);
                  throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `語音生成失敗（fal.ai ${voiceDispatch.modelId}）：${voiceDispatch.error || "未知錯誤"}`,
                  });
                }
              }
            } catch (err) {
              if (!demoMode) throw err;
              debug(`[Demo] Voice generation failed: ${err}`);
            }
            if (!voiceUrl) {
              if (!demoMode)
                await db.refundUserPoints(userId, _genEstimate.totalPoints);
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "fal.ai 語音生成未回傳有效 URL，請稍後再試",
              });
            }
            resultData.voiceUrl = voiceUrl;
            resultData.voiceStatus = "completed";
            resultData.voiceEngine = "fal-tts";
            resultData.voiceModel = voiceEngine;
            resultData.voiceModelId = input.voiceModelId;
            resultData.voiceText = input.voiceText;
            resultData.voiceSpeed = input.voiceSpeed;
            resultData.voiceStability = input.voiceStability;
            resultData.voiceEmotionType = input.voiceEmotionType;
            resultData.voiceEmotionIntensity = input.voiceEmotionIntensity;
            if (!resultUrl) resultUrl = voiceUrl;
          }

          // ── Post-generation events ──
          stepTimestamps.generateDone = Date.now();
          const generateMs =
            stepTimestamps.generateDone -
            (stepTimestamps.compileDone || stepTimestamps.start);
          generationBus.emit(jobId, {
            type: "thought-update",
            node: {
              id: "generate",
              label: `${modalityLabel}生成`,
              status: resultUrl ? "completed" : "completed",
              detail: resultUrl
                ? `生成成功（${generateMs}ms）`
                : `已加入佇列（${generateMs}ms）`,
              timestamp: stepTimestamps.generateDone,
            },
          });
          generationBus.emit(jobId, {
            type: "progress",
            progress: 70,
            message: "生成完成，處理後續...",
          });

          // ── Points logging ──
          stepTimestamps.quotaDone = Date.now();
          generationBus.emit(jobId, {
            type: "thought-update",
            node: {
              id: "quota",
              label: "積分扣除",
              status: "completed",
              detail: `扣除 ${_genEstimate.totalPoints} pts | ${_genEstimate.breakdown} | 引擎：${_genEngineLabel}`,
              timestamp: stepTimestamps.quotaDone,
            },
          });
          generationBus.emit(jobId, {
            type: "progress",
            progress: 80,
            message: `積分已扣除 ${_genEstimate.totalPoints} pts`,
          });

          // Points were already atomically deducted in prepareJob.
          // Log real usage with actual model cost.
          if (!demoMode) {
            await db.createApiUsageLog({
              userId,
              requestType:
                input.generationType === "image"
                  ? "image_generation"
                  : input.generationType === "video"
                    ? "video_generation"
                    : input.generationType === "audio"
                      ? "audio_generation"
                      : input.generationType === "voice"
                        ? "voice_dubbing"
                        : "image_generation",
              apiProvider:
                _genPricing?.provider ??
                (input.mode === "lightning" ? "gemini_flash" : "gemini_pro"),
              tokensUsed: _genEstimate.totalPoints * 200,
              estimatedCostUsd: (_genEstimate.totalPoints / 100).toFixed(4),
              responseStatus: "success",
              generationsDeducted: _genEstimate.totalPoints,
            });

            // Save to asset library
            if (resultUrl) {
              await db.createDigitalAsset({
                userId,
                title: input.prompt.substring(0, 100),
                assetType:
                  input.generationType === "multimodal"
                    ? "image"
                    : input.generationType,
                fileUrl: resultUrl,
                promptUsed: input.prompt,
              });
            }

            // Save to generation history
            await db.createHistoryEntry({
              userId,
              modality:
                input.generationType === "multimodal"
                  ? "image"
                  : (input.generationType as
                      | "image"
                      | "video"
                      | "audio"
                      | "voice"),
              prompt: input.prompt,
              compiledPrompt,
              parameterSnapshot: {
                mode: input.mode,
                temperature: input.temperature,
                vibeCardIds: input.vibeCardIds,
                seed: input.seed,
                loraWeight: input.loraWeight,
                visualWeight,
                controlNetParams,
                ...(input.fineTunedModelId && {
                  fineTunedModelId: input.fineTunedModelId,
                }),
                ...(input.vaultCharacterId && {
                  vaultCharacterId: input.vaultCharacterId,
                }),
                ...(input.vaultSceneId && { vaultSceneId: input.vaultSceneId }),
                ...(input.generationType === "image" && {
                  aspectRatio: input.aspectRatio,
                  negativePrompt: input.negativePrompt,
                  styleReferenceUrl: input.styleReferenceUrl,
                  vibeReferenceUrl: input.vibeReferenceUrl,
                }),
                ...(input.generationType === "video" && {
                  videoDurationSeconds: input.videoDurationSeconds,
                  firstFrameUrl: input.firstFrameUrl,
                  lastFrameUrl: input.lastFrameUrl,
                  characterRefUrl: input.characterRefUrl,
                  cameraMotion: input.cameraMotion,
                }),
                ...(input.generationType === "audio" && {
                  musicStyle: input.musicStyle,
                  isInstrumental: input.isInstrumental,
                  lyrics: input.lyrics,
                  audioDuration: input.audioDuration,
                  audioEnergy: input.audioEnergy,
                }),
                ...(input.generationType === "voice" && {
                  voiceModelId: input.voiceModelId,
                  voiceText: input.voiceText,
                  voiceSpeed: input.voiceSpeed,
                  voiceStability: input.voiceStability,
                  voiceEmotionType: input.voiceEmotionType,
                  voiceEmotionIntensity: input.voiceEmotionIntensity,
                }),
              },
              resultUrl: resultUrl || undefined,
              thumbnailUrl: resultUrl || undefined,
              costCredits: _genEstimate.totalPoints,
            });

            // Update job
            await db.updateBackgroundJob(jobId, {
              status: "completed",
              progress: 100,
              progressMessage: "生成完成！",
              resultJson: resultData,
            });
          }

          // ── Phase 14: RAG 記憶向量化（非同步，不阻塞回應）──────────────
          upsertMemory({
            userId,
            generationId: jobId,
            prompt: input.prompt,
            generationType: input.generationType,
            resultSummary: resultUrl
              ? `成功生成 ${input.generationType}`
              : undefined,
            vibeCardIds: input.vibeCardIds,
          }).catch(() => {
            /* 靜默降級 */
          });

          // ── History saved event ──
          stepTimestamps.historyDone = Date.now();
          generationBus.emit(jobId, {
            type: "thought-update",
            node: {
              id: "history",
              label: "歷史紀錄",
              status: "completed",
              detail: "已儲存至生成歷史",
              timestamp: stepTimestamps.historyDone,
            },
          });
          generationBus.emit(jobId, {
            type: "progress",
            progress: 95,
            message: "歷史紀錄已儲存",
          });

          // Build final Chain-of-Thought trace with REAL timestamps from each execution step
          const finalSafetyMs =
            (stepTimestamps.safetyDone || stepTimestamps.start) -
            stepTimestamps.start;
          const finalCompileMs =
            (stepTimestamps.compileDone || stepTimestamps.compileStart || 0) -
            (stepTimestamps.compileStart || stepTimestamps.start);
          const finalGenerateMs =
            stepTimestamps.generateDone -
            (stepTimestamps.compileDone || stepTimestamps.start);
          const thoughtChain = [
            {
              id: "safety",
              label: "安全檢查",
              status: "passed" as const,
              detail: `內容安全檢查通過（${finalSafetyMs}ms）`,
              timestamp: stepTimestamps.safetyDone || stepTimestamps.start,
            },
            {
              id: "compile",
              label: "提示詞編譯",
              status: "completed" as const,
              detail: `編譯後提示詞長度: ${compiledPrompt.length} 字元（${finalCompileMs}ms）`,
              timestamp: stepTimestamps.compileDone || stepTimestamps.start,
            },
            {
              id: "weight",
              label: "視覺權重計算",
              status: "completed" as const,
              detail: `visualWeight: ${visualWeight.toFixed(2)}, controlNet: ${JSON.stringify(controlNetParams)}`,
              timestamp: stepTimestamps.weightDone || stepTimestamps.start,
            },
            {
              id: "generate",
              label: `${modalityLabel}生成`,
              status: resultUrl
                ? ("completed" as const)
                : ("completed" as const),
              detail: resultUrl
                ? `生成成功（${finalGenerateMs}ms）`
                : `已加入佇列（${finalGenerateMs}ms）`,
              timestamp: stepTimestamps.generateDone,
            },
            {
              id: "quota",
              label: "配額扣除",
              status: "completed" as const,
              detail: "扣除 1 次生成配額",
              timestamp: stepTimestamps.quotaDone || Date.now(),
            },
            {
              id: "history",
              label: "歷史紀錄",
              status: "completed" as const,
              detail: "已儲存至生成歷史",
              timestamp: stepTimestamps.historyDone || Date.now(),
            },
          ];

          // Emit final complete event via SSE
          generationBus.emit(jobId, { type: "complete", thoughtChain });
          // Clean up listeners after a short delay
          setTimeout(() => generationBus.cleanup(jobId), 2000);

          return { jobId, resultUrl, resultData, compiledPrompt, thoughtChain };
        } catch (error) {
          // Transactional integrity: refund points on generation failure
          const errMsg = error instanceof Error ? error.message : "生成失敗";
          const isTimeout = /超時|timeout|timed? ?out|ETIMEDOUT|aborted/i.test(
            errMsg
          );
          if (!demoMode) {
            await db.refundUserPoints(userId, _genEstimate.totalPoints);
            await db.updateBackgroundJob(jobId, {
              status: "failed",
              errorMessage: errMsg,
            });
            await db.createApiUsageLog({
              userId,
              requestType: "image_generation",
              apiProvider: "gemini",
              responseStatus: "failed",
              errorMessage: errMsg,
              generationsDeducted: 0,
            });
          }
          // Emit error via SSE so the frontend can update thought chain
          generationBus.emit(jobId, {
            type: "thought-update",
            node: {
              id: "error",
              label: "錯誤",
              status: "error" as const,
              detail: errMsg,
              timestamp: Date.now(),
            },
          });
          generationBus.emit(jobId, { type: "error", message: errMsg });
          setTimeout(() => generationBus.cleanup(jobId), 2000);
          // Zero-Anxiety: friendly message emphasizing no credits were deducted
          const userMessage = isTimeout
            ? "AI 服務回應超時，我們並未扣除您的積分，請稍後重試"
            : "AI 服務連線稍微異常，我們並未扣除您的積分，請稍後重試";
          throw new TRPCError({
            code: isTimeout ? ("TIMEOUT" as any) : "INTERNAL_SERVER_ERROR",
            message: userMessage,
          });
        }
      }),

    jobStatus: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ input }) => {
        return db.getBackgroundJob(input.jobId);
      }),

    myJobs: protectedProcedure.query(async ({ ctx }) => {
      return db.getJobsByUser(ctx.user.id);
    }),

    // ─── Background Studio Job Management ──────────────────────────────

    /**
     * submitMultimodalAsync — 創作工作室四模態「背景任務」模式。
     *
     * 流程：
     *   1. 輕量安全檢查（prompt 審核）
     *   2. 從 AI 大腦組態選定引擎
     *   3. prepareJob 扣點 + 建 backgroundJob 記錄
     *   4. 直接送 fal.ai queue（不等待結果）
     *   5. 回傳 { jobId, request_id, modelId, label }
     *
     * 前端收到後呼叫 submitTask() 登錄到 BackgroundTasksContext，
     * 背景輪詢結果，完成後 toast 通知。
     */
    submitMultimodalAsync: protectedProcedure
      .input(
        z.object({
          prompt: z.string().min(1),
          generationType: z.enum(["image", "video", "audio", "voice"]),
          mode: z.enum(["lightning", "deep_precision"]),
          seed: z.number().optional(),
          // Image params
          aspectRatio: z.string().optional(),
          negativePrompt: z.string().optional(),
          styleReferenceUrl: z.string().nullable().optional(),
          vibeReferenceUrl: z.string().nullable().optional(),
          // Video params
          videoDurationSeconds: z.number().optional(),
          firstFrameUrl: z.string().nullable().optional(),
          lastFrameUrl: z.string().nullable().optional(),
          characterRefUrl: z.string().nullable().optional(),
          // Audio params
          musicStyle: z.string().optional(),
          isInstrumental: z.boolean().optional(),
          audioDuration: z.number().optional(),
          // Voice params
          voiceModelId: z.string().optional(),
          voiceText: z.string().optional(),
          voiceSpeed: z.number().optional(),
          voiceStability: z.number().optional(),
          voiceEmotionType: z.string().optional(),
          voiceEmotionIntensity: z.number().optional(),
          // Vault & Model
          vaultCharacterId: z.number().optional(),
          vaultSceneId: z.number().optional(),
          fineTunedModelId: z.number().optional(),
          loraWeight: z.number().min(0).max(1).optional(),
          // Director AI can override engine model for this request
          overrideModelId: z.string().optional(),
          modelParams: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;

        // ── 1. 安全檢查 ────────────────────────────────────────────────
        const safetyResult = await checkSafety(
          input.generationType === "voice" && input.voiceText
            ? input.voiceText
            : input.prompt
        );
        if (!safetyResult.safe) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: safetyResult.reason || "內容不符合安全規範",
          });
        }

        // ── 2. 讀取 AI 大腦選定引擎 ────────────────────────────────────
        let brainRow: Record<string, unknown> | null = null;
        try {
          const database = await getDb();
          if (database) {
            const rows = await database
              .select()
              .from(userAiBrain)
              .where(eq(userAiBrain.userId, userId))
              .limit(1);
            brainRow = (rows[0] ?? null) as Record<string, unknown> | null;
          }
        } catch { /* use defaults */ }
        const falEngines = resolveFalEnginesFromRow(brainRow);
        const brainImageEngine = getBrainSelectedEngine(brainRow, "imageEngine");
        const brainVideoEngine = getBrainSelectedEngine(brainRow, "videoEngine");
        const brainAudioEngine = getBrainSelectedEngine(brainRow, "audioEngine");
        const brainVoiceEngine = getBrainSelectedEngine(brainRow, "voiceEngine");

        // ── 2.4 Vault 注入：把使用者從寶庫挑的角色 / 場景換成參考圖 URL ──
        // 與同步 generate.multimodal 對齊：用 TRPCError 明確報錯，不再 silent
        // fallback。否則使用者點「使用此角色」、提交後生成完全沒角色，無法
        // 分辨「角色找不到」/「DB 故障」/「忘記注入」。
        if (input.vaultCharacterId) {
          let vaultChar: Awaited<ReturnType<typeof db.getVaultItem>> | undefined;
          try {
            vaultChar = await db.getVaultItem(input.vaultCharacterId);
          } catch (e) {
            console.warn(
              "[submitAsync][Vault] Failed to load character vault item:",
              e
            );
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "讀取角色保險庫失敗，請稍後重試",
            });
          }
          if (!vaultChar?.imageUrl) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `保險庫角色 #${input.vaultCharacterId} 找不到或缺少參考圖`,
            });
          }
          if (input.generationType === "video") {
            input.characterRefUrl =
              input.characterRefUrl || vaultChar.imageUrl;
            input.firstFrameUrl =
              input.firstFrameUrl || vaultChar.imageUrl;
          } else if (input.generationType === "image") {
            input.styleReferenceUrl =
              input.styleReferenceUrl || vaultChar.imageUrl;
          }
        }
        if (input.vaultSceneId) {
          let vaultScene: Awaited<ReturnType<typeof db.getVaultItem>> | undefined;
          try {
            vaultScene = await db.getVaultItem(input.vaultSceneId);
          } catch (e) {
            console.warn(
              "[submitAsync][Vault] Failed to load scene vault item:",
              e
            );
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "讀取場景保險庫失敗，請稍後重試",
            });
          }
          if (!vaultScene?.imageUrl) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `保險庫場景 #${input.vaultSceneId} 找不到或缺少參考圖`,
            });
          }
          if (input.generationType === "image") {
            input.vibeReferenceUrl =
              input.vibeReferenceUrl || vaultScene.imageUrl;
          }
        }

        // ── 2.5 微調模型注入：解析使用者選定的 LoRA / 微調模型 ───────────
        // 與同步 generate.execute（routers.ts:1110-1167）行為一致：
        //  - 驗證 status === "ready"，否則明確拒絕
        //  - prepend triggerWord 到 prompt
        //  - 取出 trainedLoraUrl / fileUrl 作為 LoRA weights URL
        let modelTriggerWord = "";
        let fineTunedLoraUrl: string | undefined;
        if (input.fineTunedModelId) {
          try {
            const ftModel = await db.getFineTunedModel(input.fineTunedModelId);
            if (ftModel) {
              if (ftModel.status !== "ready") {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `模型「${ftModel.name}」尚未訓練完成（狀態：${ftModel.status}），請等待訓練完畢再使用`,
                });
              }
              const config = ftModel.configJson as Record<
                string,
                unknown
              > | null;
              if (
                config &&
                typeof config.triggerWord === "string" &&
                config.triggerWord.trim()
              ) {
                modelTriggerWord = config.triggerWord.trim();
                input.prompt = `${modelTriggerWord}, ${input.prompt}`;
              }
              if (ftModel.trainedLoraUrl) {
                fineTunedLoraUrl = ftModel.trainedLoraUrl;
              } else if (
                ftModel.fileUrl &&
                (ftModel.fileUrl.endsWith(".safetensors") ||
                  ftModel.fileUrl.endsWith(".tar") ||
                  ftModel.fileUrl.includes("replicate"))
              ) {
                fineTunedLoraUrl = ftModel.fileUrl;
              }
              db.incrementModelUsage(ftModel.id).catch(() => {});
            }
          } catch (e) {
            if (e instanceof TRPCError) throw e;
            console.warn("[submitAsync] Failed to load fine-tuned model:", e);
          }
        }

        // ── 3. 決定 modelId 和 fal input ───────────────────────────────
        let modelId: string;
        let falInput: Record<string, unknown> = {};
        const overrideModelId = input.overrideModelId
          ? normalizeEngineModelId(input.overrideModelId)
          : undefined;
        const modalityLabel =
          input.generationType === "image" ? "圖像" :
          input.generationType === "video" ? "影片" :
          input.generationType === "audio" ? "音樂" : "語音";

        if (input.generationType === "image") {
          const refUrl = input.styleReferenceUrl || input.vibeReferenceUrl;
          const preferredImageEngine = isGeminiEngine(brainImageEngine)
            ? brainImageEngine!
            : refUrl
              ? falEngines.imageToImage
              : falEngines.textToImage;
          // 若使用者選了訓練模型且取得 LoRA URL，強制切到 fal-ai/lora
          // （或使用者已用 overrideModelId 指定支援 LoRA 的模型）
          modelId = fineTunedLoraUrl
            ? "fal-ai/lora"
            : overrideModelId ?? preferredImageEngine;
          falInput = {
            prompt: input.prompt,
            ...(input.aspectRatio && { aspect_ratio: input.aspectRatio }),
            ...(input.negativePrompt && { negative_prompt: input.negativePrompt }),
            ...(refUrl && { image_url: refUrl }),
            ...(input.seed != null && { seed: input.seed }),
            ...(fineTunedLoraUrl && {
              loras: [
                {
                  path: fineTunedLoraUrl,
                  scale: input.loraWeight ?? 0.8,
                },
              ],
              // fal-ai/lora 使用 image_size 而非 aspect_ratio
              image_size: aspectRatioToImageSize(input.aspectRatio),
            }),
          };
        } else if (input.generationType === "video") {
          const hasFirstFrame = !!input.firstFrameUrl;
          const preferredVideoEngine = isGeminiEngine(brainVideoEngine)
            ? brainVideoEngine!
            : hasFirstFrame || input.characterRefUrl
              ? falEngines.imageToVideo
              : falEngines.textToVideo;
          modelId =
            overrideModelId ??
            preferredVideoEngine;
          // i2v 來源圖：firstFrameUrl 優先、其次 characterRefUrl（與同步流程
          // routers.ts:1675 / videoStudio.klingImageToVideo 一致）
          const i2vImageUrl = input.firstFrameUrl || input.characterRefUrl;
          falInput = {
            prompt: input.prompt,
            ...(input.videoDurationSeconds && { duration: String(input.videoDurationSeconds) }),
            ...(i2vImageUrl && { image_url: i2vImageUrl }),
            // Kling 結束幀正確欄位是 tail_image_url（見 videoStudio.klingImageToVideo:442）
            ...(input.lastFrameUrl && { tail_image_url: input.lastFrameUrl }),
            ...(input.seed != null && { seed: input.seed }),
          };
        } else if (input.generationType === "audio") {
          const preferredAudioEngine = isGeminiEngine(brainAudioEngine)
            ? brainAudioEngine!
            : falEngines.textToAudio;
          modelId = overrideModelId ?? preferredAudioEngine;
          // ace-step / musicgen / mmaudio 用 duration；style + instrumental 折入
          // prompt（與 proStudio.textToMusic:464-476 一致）。
          const audioPromptParts = [input.prompt];
          if (input.musicStyle) audioPromptParts.push(input.musicStyle);
          if (input.isInstrumental) audioPromptParts.push("instrumental, no vocals");
          falInput = {
            prompt: audioPromptParts.join(", "),
            ...(input.audioDuration && { duration: input.audioDuration }),
            ...(input.seed != null && { seed: input.seed }),
          };
        } else {
          // voice
          const voicePrompt = input.voiceText ?? input.prompt;
          const preferredVoiceEngine = isGeminiEngine(brainVoiceEngine)
            ? brainVoiceEngine!
            : falEngines.textToSpeech;
          modelId = overrideModelId ?? preferredVoiceEngine;
          // ElevenLabs 系列 TTS 用 voice_id + nested voice_settings（見
          // proStudio.elevenLabsTTS:683-690）。speed 為 fal.ai 接受的 top-level 別名。
          const voiceSettings: Record<string, unknown> = {};
          if (input.voiceStability != null) voiceSettings.stability = input.voiceStability;
          falInput = {
            text: voicePrompt,
            ...(input.voiceModelId && { voice_id: input.voiceModelId }),
            ...(input.voiceSpeed != null && { speed: input.voiceSpeed }),
            ...(Object.keys(voiceSettings).length > 0 && { voice_settings: voiceSettings }),
            ...(input.seed != null && { seed: input.seed }),
          };
        }
        falInput = {
          ...falInput,
          ...(input.modelParams ?? {}),
        };

        if (isGeminiEngine(modelId)) {
          ensureGeminiApiKeyConfigured();
        } else {
          ensureFalApiKeyConfigured();
        }

        // ── 4. prepareJob：扣點 + 建 backgroundJob 記錄 ────────────────
        const durationSec =
          input.generationType === "video" ? input.videoDurationSeconds :
          input.generationType === "audio" ? input.audioDuration : undefined;
        const charCount =
          input.generationType === "voice" ? (input.voiceText?.length) : undefined;

        const estimate = estimatePoints(modelId, { durationSec, charCount });
        const points = estimate.totalPoints;

        if (!isDemoMode()) {
          const deductResult = await db.deductUserPoints(userId, points);
          if (!deductResult.success) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `積分不足（需要 ${points} pts，目前 ${deductResult.remainingBefore} pts）`,
            });
          }
        }

        // 建立 background_job 記錄（先 processing，拿到 request_id 後更新）
        const label = `${modalityLabel}生成`;
        const jobId = await db.createBackgroundJob({
          userId,
          jobType: input.generationType as any,
          status: "processing",
          progress: 5,
          progressMessage: `${label} 已提交佇列...`,
          resultJson: {
            studioType: input.generationType,
            label,
            modelId,
            prompt: (input.generationType === "voice" ? input.voiceText : input.prompt) ?? "",
          },
        });

        // ── 5. 依引擎供應商送出任務 ───────────────────────────────────────
        try {
          if (isGeminiEngine(modelId)) {
            const gemini = getGeminiMediaClient();
            let resultUrl: string | undefined;

            if (input.generationType === "image") {
              const imageRes = await gemini.generateImage({
                prompt: input.prompt,
                model:
                  modelId === "gemini/imagen-3-fast"
                    ? "imagen-3.0-fast-generate-001"
                    : "imagen-3.0-generate-002",
                aspectRatio:
                  input.aspectRatio === "1:1" ||
                  input.aspectRatio === "3:4" ||
                  input.aspectRatio === "4:3" ||
                  input.aspectRatio === "9:16" ||
                  input.aspectRatio === "16:9"
                    ? input.aspectRatio
                    : undefined,
                negativePrompt: input.negativePrompt,
                seed: input.seed,
                numImages: 1,
              });
              const firstImage = imageRes.images?.[0];
              if (firstImage?.base64) {
                resultUrl = await storeBase64Media({
                  base64: firstImage.base64,
                  mimeType: firstImage.mimeType || "image/png",
                  prefix: `generated/studio/${userId}/image/gemini-async`,
                  fallbackExt: "png",
                });
              }
            } else if (input.generationType === "video") {
              const videoRes = await gemini.generateVideoSync({
                prompt: input.prompt,
                model:
                  modelId === "gemini/veo-2"
                    ? "veo-2.0-generate-001"
                    : "veo-3.0-generate-preview",
                imageUrl: input.firstFrameUrl || input.characterRefUrl || undefined,
                duration: input.videoDurationSeconds || 5,
                aspectRatio: input.aspectRatio === "9:16" ? "9:16" : "16:9",
                negativePrompt: input.negativePrompt,
                seed: input.seed,
              });
              resultUrl = videoRes.videoUrl;
            } else if (input.generationType === "audio") {
              const audioRes = await gemini.generateAudio({
                prompt: input.prompt,
                model: modelId === "gemini/musicfx" ? "musicfx-001" : "lyria-002",
                duration: input.audioDuration || 30,
                seed: input.seed,
              });
              if (audioRes.audioBase64) {
                resultUrl = await storeBase64Media({
                  base64: audioRes.audioBase64,
                  mimeType: audioRes.mimeType || "audio/wav",
                  prefix: `generated/studio/${userId}/audio/gemini-async`,
                  fallbackExt: "wav",
                });
              }
            } else {
              const ttsRes = await gemini.textToSpeech({
                text: input.voiceText ?? input.prompt,
                model:
                  modelId === "gemini/tts-pro"
                    ? "gemini-2.5-pro-preview-tts"
                    : "gemini-2.5-flash-preview-tts",
                voiceName: input.voiceModelId || "Zephyr",
              });
              if (ttsRes.audioBase64) {
                resultUrl = await storeBase64Media({
                  base64: ttsRes.audioBase64,
                  mimeType: ttsRes.mimeType || "audio/wav",
                  prefix: `generated/studio/${userId}/voice/gemini-async`,
                  fallbackExt: "wav",
                });
              }
            }

            if (!resultUrl) {
              throw new Error("Gemini 生成未回傳可用結果");
            }

            const requestId = `gemini-sync-${jobId}-${Date.now()}`;
            const promptForJob = (input.generationType === "voice" ? input.voiceText : input.prompt) ?? "";
            await db.updateBackgroundJob(jobId, {
              status: "completed",
              progress: 100,
              progressMessage: `${label} 已完成`,
              resultJson: {
                studioType: input.generationType,
                label,
                modelId,
                requestId,
                resultUrl,
                prompt: promptForJob,
              } as any,
            });

            // 後置動作：儲存提示詞庫 + 數位資產 + 生成歷史 + AI 監控室
            void doPostGenComplete({
              userId,
              modality: input.generationType,
              modelId,
              prompt: promptForJob,
              resultUrl,
              label,
              sourceStudio: "creative",
            });

            return {
              jobId,
              request_id: requestId,
              modelId,
              label,
              generationType: input.generationType,
            };
          }

          // 若設定 VITE_SITE_URL，組出帶 jobId 的 webhook URL；fal.ai 完成時
          // 會主動 POST 到 /api/webhook/fal?jobId=<id>，瀏覽器關閉也能持久化結果
          const siteUrl = process.env.VITE_SITE_URL?.trim();
          const falWebhookUrl = siteUrl
            ? `${siteUrl}/api/webhook/fal?jobId=${jobId}`
            : undefined;

          // 使用 dispatchFalQueueTask 而非裸 submitToFalQueue:
          // - 不認識的 modelId 會降級到該分類的 fallback chain 首選
          // - ultra-tier 影片模型送出前先做 preflight 健康探測,避免使用者
          //   等待 5–10 分鐘才發現模型損毀。
          const queueCategory: string =
            input.generationType === "image"
              ? input.styleReferenceUrl || input.vibeReferenceUrl
                ? "image-to-image"
                : "text-to-image"
              : input.generationType === "video"
                ? input.firstFrameUrl || input.characterRefUrl
                  ? "image-to-video"
                  : "text-to-video"
                : input.generationType === "audio"
                  ? "text-to-audio"
                  : "text-to-speech";
          const queueModalityForTrace =
            input.generationType === "image"
              ? "image"
              : input.generationType === "video"
                ? "video"
                : input.generationType === "audio"
                  ? "audio"
                  : "voice";
          const queueResult = await dispatchFalQueueTask({
            modelId,
            category: queueCategory,
            input: falInput,
            webhookUrl: falWebhookUrl,
            route: "trpc.generate.submitMultimodalAsync",
            modality: queueModalityForTrace,
            userId,
          });
          const request_id = queueResult.request_id;
          // 若 dispatcher 因為 modelId 不在 catalog 而降級,以實際送出的模型為準,
          // 確保前端用 checkStudioJob 輪詢時能命中正確的 fal queue endpoint。
          const submittedModelId = queueResult.modelId;

          // 更新 job 記錄，加入 requestId（checkStudioJob 輪詢需要）
          await db.updateBackgroundJob(jobId, {
            resultJson: {
              studioType: input.generationType,
              label,
              modelId: submittedModelId,
              requestId: request_id,
              prompt: (input.generationType === "voice" ? input.voiceText : input.prompt) ?? "",
              ...(queueResult.degraded && queueResult.originalModel
                ? { originalModel: queueResult.originalModel, degraded: true }
                : {}),
            } as any,
          });

          return {
            jobId,
            request_id,
            modelId: submittedModelId,
            label,
            generationType: input.generationType,
            ...(queueResult.degraded && queueResult.originalModel
              ? { degraded: true, originalModel: queueResult.originalModel }
              : {}),
          };
        } catch (err) {
          // queue submit 失敗 → 退款 + 標記失敗
          if (!isDemoMode()) {
            await db.refundUserPoints(userId, points);
          }
          await db.updateBackgroundJob(jobId, {
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "提交失敗",
          });
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `${modalityLabel}生成提交失敗：${err instanceof Error ? err.message : "未知錯誤"}`,
          });
        }
      }),

    /**
     * submitStudioJob — 將專業工作室的非同步任務（Image / Video / Audio）
     * 登錄到 background_jobs 表，使其可在任意頁面追蹤。
     */
    submitStudioJob: protectedProcedure
      .input(
        z.object({
          studioType: z.enum(["image", "video", "audio", "voice"]),
          requestId: z.string().min(1),
          modelId: z.string().min(1),
          label: z.string().max(200).optional(),
          prompt: z.string().max(2000).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const jobId = await db.createBackgroundJob({
          userId: ctx.user.id,
          jobType: input.studioType,
          status: "processing",
          progress: 0,
          progressMessage: `${input.label ?? input.studioType} 生成中...`,
          resultJson: {
            requestId: input.requestId,
            modelId: input.modelId,
            studioType: input.studioType,
            label: input.label,
            prompt: input.prompt ?? "",
          },
        });
        return { jobId };
      }),

    /**
     * checkStudioJob — 檢查已提交的工作室背景任務狀態。
     * 如果任務仍在 processing，會即時向 fal.ai 查詢並更新 DB。
     * ⚠️ 超過 10 分鐘仍未完成的任務會自動標記為失敗。
     */
    checkStudioJob: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await db.getBackgroundJob(input.jobId);
        if (!job) return null;
        // 權限檢查
        if (job.userId !== ctx.user.id) return null;
        // 已完成/失敗 → 直接回傳
        if (job.status !== "processing") return job;

        // ── 超時偵測：超過 30 分鐘未完成 → 自動標記失敗 ─────────
        // 影片、3D、音樂等重型生成任務最多需要 20–25 分鐘，留 30 分鐘緩衝
        const STALE_JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 分鐘
        const createdTime = job.createdAt
          ? new Date(job.createdAt).getTime()
          : 0;
        if (
          createdTime > 0 &&
          Date.now() - createdTime > STALE_JOB_TIMEOUT_MS
        ) {
          const timeoutMsg =
            "任務已超時（超過 30 分鐘），請嘗試更換模型或簡化描述後重試";
          await db.updateBackgroundJob(job.id, {
            status: "failed",
            errorMessage: timeoutMsg,
          });
          return {
            ...job,
            status: "failed" as const,
            errorMessage: timeoutMsg,
          };
        }

        const meta = job.resultJson as Record<string, unknown> | null;
        const requestId = meta?.requestId as string | undefined;
        const modelId = meta?.modelId as string | undefined;
        if (!requestId || !modelId) return job;

        // 向 fal.ai queue 查詢狀態
        const FAL_QUEUE_BASE = "https://queue.fal.run";
        const falKey = process.env.FAL_API_KEY;
        if (!falKey) return job;

        try {
          const statusRes = await fetch(
            `${FAL_QUEUE_BASE}/${modelId}/requests/${requestId}/status`,
            { headers: { Authorization: `Key ${falKey}` } }
          );
          if (!statusRes.ok) return job;
          const statusData = (await statusRes.json()) as Record<
            string,
            unknown
          >;
          const s = (statusData.status ?? statusData.state) as
            | string
            | undefined;

          if (s === "COMPLETED") {
            const resultRes = await fetch(
              `${FAL_QUEUE_BASE}/${modelId}/requests/${requestId}`,
              { headers: { Authorization: `Key ${falKey}` } }
            );
            const resultData = resultRes.ok ? await resultRes.json() : null;

            // 從結果中提取 URL（嘗試所有已知路徑）
            const localizedResult = (await localizeResultUrls(
              resultData,
              `generated/studio/${ctx.user.id}/background/${modelId.replace(/[^\w/-]+/g, "_")}`
            )) as Record<string, unknown> | null;
            const r = localizedResult;
            const resultUrl =
              // 圖片
              (r?.images as any)?.[0]?.url ??
              (r?.image as any)?.url ??
              (r as any)?.image_url ??
              // 影片
              (r?.video as any)?.url ??
              (r as any)?.video_url ??
              (r?.videos as any)?.[0]?.url ??
              // 音訊
              (r?.audio as any)?.url ??
              (r as any)?.audio_url ??
              // 音效（ElevenLabs sound-effects）
              (r?.audio_file as any)?.url ??
              // 音幹分離（demucs：取第一個 stem URL）
              (r?.vocals as any)?.url ??
              // 聲音克隆（speaker_embedding）
              (r?.speaker_embedding as any)?.url ??
              // 其他
              (r?.output as any)?.url ??
              (r?.model_glb as any)?.url ??
              // dubbing 結果
              (r?.dubbed_url as string) ??
              // 語音轉文字（取文字結果）
              (r as any)?.text ??
              (r as any)?.transcript ??
              null;

            await db.updateBackgroundJob(job.id, {
              status: "completed",
              progress: 100,
              progressMessage: "生成完成",
              resultJson: { ...meta, resultUrl, result: localizedResult },
            });

            // 後置動作（idempotent，與 webhookFal 同時抵達也只跑一次）：
            // 儲存提示詞庫 + 數位資產 + 生成歷史 + AI 監控室
            void runPostGenForJob(job.id);

            return {
              ...job,
              status: "completed" as const,
              progress: 100,
              progressMessage: "生成完成",
              resultJson: { ...meta, resultUrl, result: localizedResult },
            };
          }

          if (s === "FAILED") {
            const errMsg = String(
              statusData.error ?? statusData.message ?? "生成失敗"
            );
            await db.updateBackgroundJob(job.id, {
              status: "failed",
              errorMessage: errMsg,
            });
            return { ...job, status: "failed" as const, errorMessage: errMsg };
          }
        } catch {
          // fal.ai 暫時不可用，保持 processing 狀態
        }

        return job;
      }),

    /**
     * activeJobs — 回傳使用者所有進行中的背景任務 + 近 24 小時已完成的任務。
     * 供全域 BackgroundTasksDrawer 使用。
     */
    activeJobs: protectedProcedure.query(async ({ ctx }) => {
      const database = await getDb();
      if (!database) return [];
      const { backgroundJobs } = await import("../drizzle/schema");
      const { eq, and, or, gte, desc } = await import("drizzle-orm");
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return database
        .select()
        .from(backgroundJobs)
        .where(
          and(
            eq(backgroundJobs.userId, ctx.user.id),
            or(
              // 所有進行中的任務
              eq(backgroundJobs.status, "queued"),
              eq(backgroundJobs.status, "processing"),
              // 近 24 小時已完成的任務
              and(
                or(
                  eq(backgroundJobs.status, "completed"),
                  eq(backgroundJobs.status, "failed")
                ),
                gte(backgroundJobs.updatedAt, cutoff)
              )
            )
          )
        )
        .orderBy(desc(backgroundJobs.createdAt))
        .limit(50);
    }),

    /**
     * listCompletedMedia — 回傳使用者所有已完成的生成任務（不限時間）。
     * 供 VaultPage 成品輸出庫使用，支援分頁與媒體類型篩選。
     */
    listCompletedMedia: protectedProcedure
      .input(
        z
          .object({
            jobType: z
              .enum(["image", "video", "audio", "voice", "multimodal"])
              .optional(),
            limit: z.number().min(1).max(100).optional().default(50),
            offset: z.number().min(0).optional().default(0),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        const database = await getDb();
        if (!database) return { items: [], total: 0 };
        const { backgroundJobs } = await import("../drizzle/schema");
        const { eq, and, desc } = await import("drizzle-orm");
        const conditions = [
          eq(backgroundJobs.userId, ctx.user.id),
          eq(backgroundJobs.status, "completed"),
        ];
        if (input?.jobType) {
          conditions.push(
            eq(backgroundJobs.jobType, input.jobType as any)
          );
        }
        const { sql: drizzleSql } = await import("drizzle-orm");
        const [items, countRow] = await Promise.all([
          database
            .select()
            .from(backgroundJobs)
            .where(and(...conditions))
            .orderBy(desc(backgroundJobs.createdAt))
            .limit(input?.limit ?? 50)
            .offset(input?.offset ?? 0),
          database
            .select({ count: drizzleSql<number>`COUNT(*)` })
            .from(backgroundJobs)
            .where(and(...conditions))
            .then(r => r[0]),
        ]);
        return { items, total: Number(countRow?.count ?? 0) };
      }),

    /**
     * recordGenResult — 記錄同步生成結果（無背景任務的情況）。
     * 供 ImageStudio 等直接回傳同步結果的頁面呼叫，執行：
     *   1-2. 儲存提示詞到提示詞庫
     *   1-3. 儲存到數位資產庫 + 生成歷史
     *   1-4. 記錄到 AI 監控室
     */
    recordGenResult: protectedProcedure
      .input(
        z.object({
          modality: z.enum(["image", "video", "audio", "voice"]),
          modelId: z.string().max(200),
          prompt: z.string().max(2000).optional(),
          resultUrl: z.string().url().optional(),
          label: z.string().max(200).optional(),
          sourceStudio: z.string().max(50).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await doPostGenComplete({
          userId: ctx.user.id,
          modality: input.modality,
          modelId: input.modelId,
          prompt: input.prompt,
          resultUrl: input.resultUrl,
          label: input.label,
          sourceStudio: input.sourceStudio ?? "image",
        });
        return { success: true };
      }),
  }),

  // ─── Prompt Evaluation (LLM-as-a-Judge) ──────────────────────────────────

  evaluate: router({
    prompt: protectedProcedure
      .input(
        z.object({
          prompt: z.string().min(1),
          modality: z
            .enum(["image", "video", "audio", "voice"])
            .default("image"),
        })
      )
      .mutation(async ({ input }) => {
        const result = await withTimeout(
          invokeLLM({
            runName: "prompt-judge",
            messages: [
              {
                role: "system",
                content: `你是一位專業的 AI 提示詞評估專家（LLM-as-a-Judge）。你的任務是對使用者的創作提示詞進行多維度評估。

評估維度（每項 0-20 分，總分 0-100）：
1. **主體清晰度 (Subject Clarity)**：主角/物件描述是否具體？
2. **動作與敘事 (Action & Narrative)**：是否有明確的動態或故事性？
3. **環境與場景 (Environment)**：背景場景是否有層次感？
4. **光影與色調 (Lighting & Tone)**：是否指定了光線、色溫或情緒色調？
5. **技術參數 (Technical Specs)**：是否包含鏡頭角度、構圖、解析度等專業指令？

模態：${input.modality}

你必須回傳 JSON，包含：
- score: 總分 (0-100)
- dimensions: 五個維度的個別分數
- strengths: 提示詞的優點（繁體中文，1-2 句）
- weaknesses: 提示詞的不足之處（繁體中文，1-2 句）
- suggestions: 具體的可執行優化建議陣列，每條建議必須包含：
  - label: 建議的簡短標題（繁體中文，6-15字，例如「加入暖色調光線」）
  - actionType: 動作類型，必須是以下之一：
    - "append_prompt": 在現有提示詞後追加內容
    - "replace_prompt": 替換整個提示詞
    - "add_negative": 加入負面提示詞
  - actionPayload: 要套用的實際英文內容（例如 "warm golden hour lighting, soft shadows"）
  - reason: 為什麼這個建議能改善提示詞（繁體中文，10-25字）
- optimizedPrompt: 優化後的完整提示詞（英文）

注意：suggestions 的 actionPayload 必須是可直接套用的英文提示詞片段，不是描述性文字。`,
              },
              { role: "user", content: input.prompt },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "prompt_evaluation",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    score: {
                      type: "integer",
                      description: "Total score 0-100",
                    },
                    dimensions: {
                      type: "object",
                      properties: {
                        subjectClarity: { type: "integer" },
                        actionNarrative: { type: "integer" },
                        environment: { type: "integer" },
                        lightingTone: { type: "integer" },
                        technicalSpecs: { type: "integer" },
                      },
                      required: [
                        "subjectClarity",
                        "actionNarrative",
                        "environment",
                        "lightingTone",
                        "technicalSpecs",
                      ],
                      additionalProperties: false,
                    },
                    strengths: { type: "string" },
                    weaknesses: { type: "string" },
                    suggestions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          label: {
                            type: "string",
                            description:
                              "Short label in Traditional Chinese, 6-15 chars",
                          },
                          actionType: {
                            type: "string",
                            enum: [
                              "append_prompt",
                              "replace_prompt",
                              "add_negative",
                            ],
                            description: "Type of action to apply",
                          },
                          actionPayload: {
                            type: "string",
                            description:
                              "English prompt fragment to apply directly",
                          },
                          reason: {
                            type: "string",
                            description:
                              "Why this improves the prompt, in Traditional Chinese, 10-25 chars",
                          },
                        },
                        required: [
                          "label",
                          "actionType",
                          "actionPayload",
                          "reason",
                        ],
                        additionalProperties: false,
                      },
                    },
                    optimizedPrompt: { type: "string" },
                  },
                  required: [
                    "score",
                    "dimensions",
                    "strengths",
                    "weaknesses",
                    "suggestions",
                    "optimizedPrompt",
                  ],
                  additionalProperties: false,
                },
              },
            },
          }),
          30_000,
          "提示詞評估"
        );
        // Fence-tolerant — see safety check rationale above.
        const parsed = extractMessageJson(
          result.choices[0]?.message?.content,
          extractJsonObjectFromText
        );
        if (parsed && typeof parsed === "object") {
          return parsed as Record<string, unknown>;
        }
        return {
          score: 50,
          dimensions: {
            subjectClarity: 10,
            actionNarrative: 10,
            environment: 10,
            lightingTone: 10,
            technicalSpecs: 10,
          },
          strengths: "",
          weaknesses: "",
          suggestions: [],
          optimizedPrompt: input.prompt,
        };
      }),

    suggestChips: protectedProcedure
      .input(
        z.object({
          partial: z.string().min(1).max(50),
        })
      )
      .mutation(async ({ input }) => {
        const result = await withTimeout(
          invokeLLM({
            runName: "inspiration-chips",
            messages: [
              {
                role: "system",
                content: `你是一位創意靈感助手。使用者正在輸入一個初步的創作靈感，你的任務是根據這個部分輸入，生成 5 個相關但更具體、更有想像力的延展靈感詞彙。

規則：
- 每個建議必須是繁體中文
- 每個建議 4~12 個字，簡潔有畫面感
- 建議應與使用者輸入相關但往不同方向延展
- 包含場景、風格、氛圍、細節等多元角度
- 不要重複使用者已輸入的文字

你必須回傳 JSON，包含一個 chips 陣列。`,
              },
              { role: "user", content: input.partial },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "inspiration_chips",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    chips: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "3-5 creative inspiration suggestions in Traditional Chinese",
                    },
                  },
                  required: ["chips"],
                  additionalProperties: false,
                },
              },
            },
          }),
          15_000,
          "靈感建議"
        );
        // Fence-tolerant — see safety check rationale above.
        const parsed = extractMessageJson(
          result.choices[0]?.message?.content,
          extractJsonObjectFromText
        ) as { chips?: unknown } | null;
        if (parsed && Array.isArray(parsed.chips)) {
          const chips = (parsed.chips as unknown[])
            .filter((c): c is string => typeof c === "string")
            .slice(0, 5);
          return { chips };
        }
        return { chips: [] as string[] };
      }),
  }),

  // ─── Director AI ─────────────────────────────────────────────────────────

  director: directorRouter,

  // ─── Assets ──────────────────────────────────────────────────────────────

  assets: router({
    myAssets: protectedProcedure
      .input(
        z
          .object({
            assetType: z
              .enum([
                "image",
                "video",
                "audio",
                "voice",
                "script",
                "zip_bundle",
                "all",
              ])
              .default("all"),
            search: z.string().optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        try {
          const all = await db.getDigitalAssetsByUser(ctx.user.id);
          let result = all;
          if (input?.assetType && input.assetType !== "all") {
            result = result.filter(a => a.assetType === input.assetType);
          }
          if (input?.search) {
            const q = input.search.toLowerCase();
            result = result.filter(
              a =>
                a.title.toLowerCase().includes(q) ||
                (a.description || "").toLowerCase().includes(q) ||
                (a.promptUsed || "").toLowerCase().includes(q)
            );
          }
          return result;
        } catch {
          return [];
        }
      }),

    teamAssets: protectedProcedure
      .input(
        z
          .object({
            assetType: z
              .enum([
                "image",
                "video",
                "audio",
                "voice",
                "script",
                "zip_bundle",
                "all",
              ])
              .default("all"),
            search: z.string().optional(),
          })
          .optional()
      )
      .query(async ({ ctx: _ctx, input }) => {
        try {
          const all = await db.getTeamSharedAssets();
          let result = all;
          if (input?.assetType && input.assetType !== "all") {
            result = result.filter(a => a.assetType === input.assetType);
          }
          if (input?.search) {
            const q = input.search.toLowerCase();
            result = result.filter(
              a =>
                a.title.toLowerCase().includes(q) ||
                (a.description || "").toLowerCase().includes(q) ||
                (a.promptUsed || "").toLowerCase().includes(q)
            );
          }
          return result;
        } catch {
          return [];
        }
      }),

    // ── 手動上傳資產（已上傳至 S3 後呼叫此端點登記）──────────────────────
    upload: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1).max(255),
          description: z.string().max(500).optional(),
          assetType: z.enum([
            "image",
            "video",
            "audio",
            "voice",
            "script",
            "zip_bundle",
          ]),
          fileUrl: z.string().url(),
          fileKey: z.string(),
          mimeType: z.string().optional(),
          fileSizeBytes: z.number().optional(),
          thumbnailUrl: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const id = await db.createDigitalAsset({
          userId: ctx.user.id,
          title: input.title,
          description: input.description,
          assetType: input.assetType,
          fileUrl: input.fileUrl,
          fileKey: input.fileKey,
          mimeType: input.mimeType,
          fileSizeBytes: input.fileSizeBytes,
          thumbnailUrl: input.thumbnailUrl,
        });
        return { id };
      }),

    // ── 更新資產資訊 ──────────────────────────────────────────────────────
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          title: z.string().min(1).max(255).optional(),
          description: z.string().max(500).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const asset = await db.getDigitalAsset(input.id);
        if (!asset || asset.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "資產不存在" });
        }
        const updates: Record<string, unknown> = {};
        if (input.title) updates.title = input.title;
        if (input.description !== undefined)
          updates.description = input.description;
        await db.updateDigitalAsset(
          input.id,
          updates as Parameters<typeof db.updateDigitalAsset>[1]
        );
        return { success: true };
      }),

    toggleVisibility: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          visibility: z.enum(["private", "team_shared"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const asset = await db.getDigitalAsset(input.id);
        if (!asset || asset.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "資產不存在" });
        }
        await db.updateDigitalAsset(input.id, { visibility: input.visibility });
        // Reward credits for sharing (only on first share — prevent toggle exploit)
        // Skip in demo mode: demo users don't have real quota
        if (
          !isDemoMode() &&
          input.visibility === "team_shared" &&
          asset.visibility !== "team_shared"
        ) {
          const alreadyRewarded = (asset.rewardCredits ?? 0) > 0;
          if (!alreadyRewarded) {
            await db.refundUserQuota(ctx.user.id, 2);
            await db.updateDigitalAsset(input.id, { rewardCredits: 2 });
            console.log(
              `[Reward] User ${ctx.user.id} earned 2 pts for sharing asset ${input.id}`
            );
          }
        }
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const asset = await db.getDigitalAsset(input.id);
        if (!asset || asset.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "資產不存在" });
        }
        await db.deleteDigitalAsset(input.id);
        return { success: true };
      }),
  }),

  // ─── Fine-Tuned Models ────────────────────────────────────────────────────

  models: router({
    myModels: protectedProcedure.query(async ({ ctx }) => {
      return db.getFineTunedModelsByUser(ctx.user.id);
    }),

    teamModels: protectedProcedure.query(async () => {
      try {
        return await db.getTeamSharedModels();
      } catch {
        return [];
      }
    }),

    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const model = await db.getFineTunedModel(input.id);
        if (!model)
          throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
        // Only allow access to own or team-shared models
        if (
          model.userId !== ctx.user.id &&
          model.visibility !== "team_shared"
        ) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無存取權限" });
        }
        return model;
      }),

    // ── 模型詳細分析（訓練配置 + 資料集 + 訓練歷史 + 使用統計）──────────
    getAnalysis: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const model = await db.getFineTunedModel(input.id);
        if (!model)
          throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
        if (
          model.userId !== ctx.user.id &&
          model.visibility !== "team_shared"
        ) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無存取權限" });
        }

        const trainingJobs = await db.getTrainingJobsByModelId(input.id);

        const config = (model.configJson ?? {}) as Record<string, unknown>;
        const datasetImages = (config.datasetImages ?? []) as Array<{
          url: string;
          fileKey?: string;
          angle: string;
          caption?: string;
        }>;

        return {
          model: {
            id: model.id,
            name: model.name,
            description: model.description,
            modelType: model.modelType,
            status: model.status,
            visibility: model.visibility,
            usageCount: model.usageCount,
            trainedLoraUrl: model.trainedLoraUrl,
            replicatePredictionId: model.replicatePredictionId,
            createdAt: model.createdAt,
            updatedAt: model.updatedAt,
          },
          config: {
            triggerWord: (config.triggerWord as string) || "",
            epochs: (config.epochs as number) ?? 0,
            learningRate: (config.learningRate as number) ?? 0,
            batchSize: (config.batchSize as number) ?? 0,
            steps: (config.steps as number) ?? 0,
            submittedAt: (config.submittedAt as number) ?? null,
            completedAt: (config.completedAt as number) ?? null,
          },
          datasetImages,
          trainingJobs: trainingJobs.map(j => ({
            id: j.id,
            status: j.status,
            progress: j.progress,
            progressMessage: j.progressMessage,
            errorMessage: j.errorMessage,
            createdAt: j.createdAt,
            updatedAt: j.updatedAt,
          })),
        };
      }),

    // ── 取得訓練任務狀態（輪詢用）────────────────────────────────────────
    trainingStatus: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await db.getBackgroundJob(input.jobId);
        if (!job)
          throw new TRPCError({ code: "NOT_FOUND", message: "任務不存在" });
        if (job.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無存取權限" });
        }
        return {
          jobId: job.id,
          status: job.status,
          progress: job.progress,
          progressMessage: job.progressMessage,
          resultJson: job.resultJson as Record<string, unknown> | null,
          errorMessage: job.errorMessage,
          updatedAt: job.updatedAt,
        };
      }),

    // ── 同步 Replicate 狀態（主動拉取 Replicate prediction 最新狀態）────
    syncReplicateStatus: protectedProcedure
      .input(z.object({ modelId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const model = await db.getFineTunedModel(input.modelId);
        if (!model || model.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
        }
        if (model.status === "ready" || model.status === "failed") {
          return { status: model.status, message: "已是最終狀態" };
        }

        const predictionId =
          model.replicatePredictionId ||
          ((model.configJson as Record<string, unknown> | null)
            ?.predictionId as string | undefined);

        if (!predictionId) {
          return {
            status: model.status,
            message: "尚無 Replicate prediction ID",
          };
        }

        if (!process.env.REPLICATE_API_TOKEN) {
          return {
            status: model.status,
            message: "REPLICATE_API_TOKEN 未設定",
          };
        }

        try {
          const { getReplicateClient } =
            await import("./services/replicateClient.js");
          const replicate = getReplicateClient();
          const prediction = (await replicate.predictions.get(
            predictionId
          )) as {
            status: string;
            output?: unknown;
            error?: unknown;
          };

          if (prediction.status === "succeeded") {
            const outputUrl =
              typeof prediction.output === "string"
                ? prediction.output
                : Array.isArray(prediction.output)
                  ? (prediction.output as string[])[0]
                  : null;

            await db.updateFineTunedModel(input.modelId, {
              status: "ready",
              trainedLoraUrl: outputUrl || undefined,
              fileUrl: outputUrl || model.fileUrl || undefined,
            });
            return {
              status: "ready",
              loraUrl: outputUrl,
              message: "訓練完成！",
            };
          } else if (
            prediction.status === "failed" ||
            prediction.status === "canceled"
          ) {
            await db.updateFineTunedModel(input.modelId, { status: "failed" });
            return {
              status: "failed",
              message: `Replicate 任務 ${prediction.status}`,
            };
          }
          return {
            status: "training",
            message: `Replicate 狀態：${prediction.status}`,
          };
        } catch (e: any) {
          return { status: model.status, message: `同步失敗：${e.message}` };
        }
      }),

    // ── 重新訓練（重新提交已失敗的模型）──────────────────────────────────
    retrain: protectedProcedure
      .input(z.object({ modelId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const model = await db.getFineTunedModel(input.modelId);
        if (!model || model.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
        }
        if (model.status === "training") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "模型正在訓練中",
          });
        }
        if (!process.env.REPLICATE_API_TOKEN) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "REPLICATE_API_TOKEN 未設定，無法訓練",
          });
        }

        const config = model.configJson as Record<string, unknown> | null;
        const imageUrls =
          (config?.datasetImages as Array<{ url: string }> | undefined)?.map(
            i => i.url
          ) ?? [];
        if (imageUrls.length < 3) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "訓練圖片不足（至少 3 張）",
          });
        }

        // Reset status
        await db.updateFineTunedModel(input.modelId, {
          status: "pending",
          trainedLoraUrl: undefined,
        });

        const jobId = await db.createBackgroundJob({
          userId: ctx.user.id,
          jobType: "model_training",
          status: "queued",
          progress: 0,
          progressMessage: "重新訓練任務已加入佇列",
          resultJson: { modelId: input.modelId, modelName: model.name },
        });

        import("./services/loraTrainer").then(({ runLoraTrainingJob }) => {
          runLoraTrainingJob({
            userId: ctx.user.id,
            modelId: input.modelId,
            jobId,
            modelName: model.name,
            triggerWord: (config?.triggerWord as string) || "",
            epochs: (config?.epochs as number) ?? 20,
            learningRate: (config?.learningRate as number) ?? 0.0001,
            imageUrls,
          }).catch(err => {
            console.error(
              `[LoraTrainer] Retrain job failed for model ${input.modelId}:`,
              err
            );
          });
        });

        return { jobId, message: "重新訓練已啟動" };
      }),

    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1).max(100),
          description: z.string().max(500).optional(),
          modelType: z
            .enum([
              "image_subject",
              "voice_clone",
              "style_lora",
              "scene_lora",
              "video_lora",
              "portrait_lora",
            ])
            .default("image_subject"),
          trainingEngine: z.enum(["replicate", "fal"]).default("replicate"),
          triggerWord: z.string().max(50).optional(),
          epochs: z.number().min(5).max(100).optional(),
          learningRate: z.number().min(0.00001).max(0.01).optional(),
          batchSize: z.number().min(1).max(8).optional(),
          steps: z.number().min(100).max(5000).optional(),
          isStyle: z.boolean().optional(),
          falModelId: z.string().optional(),
          fileUrl: z.string().optional(),
          fileKey: z.string().optional(),
          datasetImages: z
            .array(
              z.object({
                url: z.string(),
                fileKey: z.string(),
                angle: z.enum(["front", "side", "back", "expression", "other"]),
                caption: z.string().optional(),
              })
            )
            .max(50)
            .optional(),
          datasetVideos: z
            .array(
              z.object({
                url: z.string(),
                fileKey: z.string(),
                caption: z.string().optional(),
              })
            )
            .max(20)
            .optional(),
          /**
           * 訓練資料的主體類型。只要不是 `synthetic`，後端就會強制要求至少
           * 一筆有效（未撤回 / 未過期）的 modelTrainingConsents 紀錄。
           * - synthetic：純 AI 生成 / 無辨識性內容
           * - self：本人
           * - real_person：真實他人
           * - copyrighted：第三方版權素材
           */
          subjectType: z
            .enum(["synthetic", "self", "real_person", "copyrighted"])
            .default("synthetic"),
          /** 引用的同意書 ID（必須屬於本人、且為有效狀態） */
          consentIds: z.array(z.number()).max(20).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // ── 同意書門檻：人像 / 第三方版權素材必須提供有效 consent ──────
        const requiresConsent =
          input.subjectType === "self" ||
          input.subjectType === "real_person" ||
          input.subjectType === "copyrighted" ||
          input.modelType === "portrait_lora";

        if (requiresConsent) {
          const ids = input.consentIds ?? [];
          if (ids.length === 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "訓練真實人物或受版權保護的素材，必須先簽署數位肖像權 / 照片使用同意書",
            });
          }
          for (const cid of ids) {
            const c = await db.getModelTrainingConsent(cid);
            if (!c || c.userId !== ctx.user.id) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `同意書 #${cid} 不存在或不屬於目前帳號`,
              });
            }
            if (
              !db.isConsentActive({
                revokedAt: c.revokedAt,
                validFrom: c.validFrom,
                validUntil: c.validUntil,
              })
            ) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `同意書 #${cid}（${c.subjectName}）已撤回或過期，無法用於訓練`,
              });
            }
            // 視訓練類型檢查授權範圍
            if (
              input.modelType === "portrait_lora" &&
              c.consentType === "photo_usage"
            ) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `同意書 #${cid} 僅授權「照片使用」，未涵蓋肖像權，不可用於 portrait_lora`,
              });
            }
          }
        }

        const STEPS_PER_EPOCH = 30;
        const MIN_TRAINING_STEPS = 200;
        const MAX_TRAINING_STEPS = 2000;
        const effectiveSteps =
          input.steps ??
          Math.min(
            Math.max(
              (input.epochs ?? 20) * STEPS_PER_EPOCH,
              MIN_TRAINING_STEPS
            ),
            MAX_TRAINING_STEPS
          );
        const configJson: Record<string, unknown> = {
          triggerWord: input.triggerWord || "",
          epochs: input.epochs ?? 20,
          learningRate: input.learningRate ?? 0.0001,
          batchSize: input.batchSize ?? 4,
          steps: effectiveSteps,
          isStyle: input.isStyle,
          datasetImages: input.datasetImages ?? [],
          datasetVideos: input.datasetVideos ?? [],
        };
        if (input.falModelId) configJson.falModelId = input.falModelId;

        // Create the model record
        const modelId = await db.createFineTunedModel({
          userId: ctx.user.id,
          name: input.name,
          description: input.description,
          modelType: input.modelType,
          fileUrl: input.datasetImages?.[0]?.url || input.fileUrl,
          fileKey: input.datasetImages?.[0]?.fileKey || input.fileKey,
          configJson,
        });

        // Link consents (if any) to the model for audit trail
        if (input.consentIds && input.consentIds.length > 0) {
          await db.linkConsentsToModel(modelId, input.consentIds);
        }

        // Create a background job for training
        const jobId = await db.createBackgroundJob({
          userId: ctx.user.id,
          jobType: "model_training",
          status: "queued",
          progress: 0,
          progressMessage: "訓練任務已加入佇列",
          resultJson: {
            modelId,
            modelName: input.name,
            engine: input.trainingEngine,
          },
        });

        const imageUrls = (input.datasetImages ?? []).map(img => img.url);
        const videoUrls = (input.datasetVideos ?? []).map(v => v.url);
        const totalDataCount = imageUrls.length + videoUrls.length;

        // Dispatch to the correct training engine
        if (input.trainingEngine === "fal") {
          // ── Fal.ai training path ──
          if (!process.env.FAL_API_KEY) {
            console.warn(
              `[FalTrainer] FAL_API_KEY not set — model ${modelId} will remain queued`
            );
          } else if (totalDataCount >= 1) {
            import("./services/falTrainer").then(
              ({ runFalTrainingJob, resolveFalTrainingModel }) => {
                const resolvedFalModel =
                  input.falModelId || resolveFalTrainingModel(input.modelType);
                runFalTrainingJob({
                  userId: ctx.user.id,
                  modelId,
                  jobId,
                  modelName: input.name,
                  modelType: input.modelType,
                  triggerWord: input.triggerWord || "",
                  steps: effectiveSteps,
                  learningRate: input.learningRate ?? 0.0001,
                  isStyle: input.isStyle,
                  imageUrls,
                  videoUrls,
                  falModelId: resolvedFalModel,
                }).catch(err => {
                  console.error(
                    `[FalTrainer] Background job failed for model ${modelId}:`,
                    err
                  );
                });
              }
            );
          }
        } else {
          // ── Replicate training path (existing) ──
          if (!process.env.REPLICATE_API_TOKEN) {
            console.warn(
              `[LoraTrainer] REPLICATE_API_TOKEN not set — model ${modelId} will remain queued`
            );
          } else if (imageUrls.length >= 3) {
            import("./services/loraTrainer").then(({ runLoraTrainingJob }) => {
              runLoraTrainingJob({
                userId: ctx.user.id,
                modelId,
                jobId,
                modelName: input.name,
                triggerWord: input.triggerWord || "",
                epochs: input.epochs ?? 20,
                learningRate: input.learningRate ?? 0.0001,
                imageUrls,
              }).catch(err => {
                console.error(
                  `[LoraTrainer] Background job failed for model ${modelId}:`,
                  err
                );
              });
            });
          }
        }

        return { id: modelId, jobId };
      }),

    captionImages: protectedProcedure
      .input(
        z.object({
          images: z
            .array(
              z.object({
                url: z.string(),
                angle: z.enum(["front", "side", "back", "expression", "other"]),
              })
            )
            .max(30),
        })
      )
      .mutation(async ({ input }) => {
        const captions: string[] = [];
        for (const img of input.images) {
          try {
            const result = await withTimeout(
              invokeLLM({
                runName: "lora-image-captioner",
                messages: [
                  {
                    role: "system",
                    content:
                      "You are a professional image captioner for LoRA training datasets. Generate a concise English description (20-40 words) that captures the subject's appearance, pose, expression, and clothing. Be specific and descriptive. Only output the caption text, nothing else.",
                  },
                  {
                    role: "user",
                    content: [
                      {
                        type: "text" as const,
                        text: `Angle: ${img.angle}. Generate a training caption for this image.`,
                      },
                      {
                        type: "image_url" as const,
                        image_url: { url: img.url },
                      },
                    ],
                  },
                ],
              }),
              20_000,
              "圖片標註"
            );
            const text = extractMessageText(
              result.choices[0]?.message?.content
            ).trim();
            captions.push(text || `${img.angle} view of the subject`);
          } catch {
            captions.push(`${img.angle} view of the subject`);
          }
        }
        return { captions };
      }),

    toggleVisibility: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          visibility: z.enum(["private", "team_shared"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const model = await db.getFineTunedModel(input.id);
        if (!model || model.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
        }
        await db.updateFineTunedModel(input.id, {
          visibility: input.visibility,
        });
        // Reward 3 quota for sharing a ready model (only on first share — prevent toggle exploit)
        // Skip in demo mode: demo users don't have real quota
        // Track reward via configJson.shareRewarded to prevent double-granting
        if (
          !isDemoMode() &&
          input.visibility === "team_shared" &&
          model.visibility !== "team_shared"
        ) {
          const cfg = (model.configJson ?? {}) as Record<string, unknown>;
          const alreadyRewarded = cfg.shareRewarded === true;
          if (model.status === "ready" && !alreadyRewarded) {
            await db.refundUserQuota(ctx.user.id, 3);
            await db.updateFineTunedModel(input.id, {
              configJson: {
                ...cfg,
                shareRewarded: true,
              } as typeof model.configJson,
            });
            console.log(
              `[Reward] User ${ctx.user.id} earned 3 pts for sharing model ${input.id}`
            );
          }
        }
        return { success: true };
      }),

    // ── 更新模型資訊（名稱、描述、觸發詞）──────────────────────────────────
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().min(1).max(100).optional(),
          description: z.string().max(500).optional(),
          triggerWord: z.string().max(50).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const model = await db.getFineTunedModel(input.id);
        if (!model || model.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
        }
        const updates: Record<string, unknown> = {};
        if (input.name) updates.name = input.name;
        if (input.description !== undefined)
          updates.description = input.description;
        if (input.triggerWord !== undefined) {
          // Update triggerWord in configJson
          const config = (model.configJson as Record<string, unknown>) || {};
          updates.configJson = { ...config, triggerWord: input.triggerWord };
        }
        await db.updateFineTunedModel(
          input.id,
          updates as Partial<typeof model>
        );
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const model = await db.getFineTunedModel(input.id);
        if (!model || model.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "模型不存在" });
        }
        await db.deleteFineTunedModel(input.id);
        return { success: true };
      }),

    // ── 增加使用計數（生成時呼叫）────────────────────────────────────────
    incrementUsage: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.incrementModelUsage(input.id);
        return { success: true };
      }),
  }),

  // ─── Director Preferences ────────────────────────────────────────────────

  directorPreferences: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const pref = await db.getDirectorPreferences(ctx.user.id);
      if (pref) return pref;
      return {
        id: 0,
        userId: ctx.user.id,
        personality: "creative" as const,
        preferredFormat: "co-star" as const,
        updatedAt: new Date(),
      };
    }),

    update: protectedProcedure
      .input(
        z.object({
          personality: z.enum(["calm", "creative", "technical"]).optional(),
          preferredFormat: z
            .enum(["co-star", "sslcm", "selcm", "free"])
            .optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const id = await db.upsertDirectorPreferences(ctx.user.id, input);
        return { id };
      }),
  }),

  // ─── Project Notes ────────────────────────────────────────────────────────

  notes: router({
    list: protectedProcedure
      .input(
        z
          .object({
            noteType: z
              .enum(["note", "script", "calendar_event", "all"])
              .default("all"),
            search: z.string().optional(),
            tags: z.array(z.string()).optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        const all = await db.getProjectNotesByUser(ctx.user.id);
        let result = all;
        if (input?.noteType && input.noteType !== "all") {
          result = result.filter(n => n.noteType === input.noteType);
        }
        if (input?.search) {
          const q = input.search.toLowerCase();
          result = result.filter(
            n =>
              n.title.toLowerCase().includes(q) ||
              (n.content || "").toLowerCase().includes(q)
          );
        }
        if (input?.tags && input.tags.length > 0) {
          result = result.filter(n => {
            const noteTags = (n.tags as string[] | null) || [];
            return input.tags!.some(t => noteTags.includes(t));
          });
        }
        return result;
      }),

    create: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1).max(255),
          content: z.string().optional(),
          scriptJson: z.any().optional(),
          noteType: z
            .enum(["note", "script", "calendar_event"])
            .default("note"),
          scheduledDate: z.number().optional(),
          tags: z.array(z.string().max(32)).max(10).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const id = await db.createProjectNote({
          userId: ctx.user.id,
          title: input.title,
          content: input.content,
          scriptJson: input.scriptJson,
          noteType: input.noteType,
          scheduledDate: input.scheduledDate
            ? new Date(input.scheduledDate)
            : undefined,
          tags: input.tags,
        });
        return { id };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          title: z.string().min(1).max(255).optional(),
          content: z.string().optional(),
          scriptJson: z.any().optional(),
          scheduledDate: z.number().nullable().optional(),
          tags: z.array(z.string().max(32)).max(10).optional(),
          noteType: z.enum(["note", "script", "calendar_event"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const note = await db.getProjectNote(input.id);
        if (!note || note.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "筆記不存在" });
        }
        await db.updateProjectNote(input.id, {
          title: input.title,
          content: input.content,
          scriptJson: input.scriptJson,
          noteType: input.noteType,
          tags: input.tags,
          ...(input.scheduledDate !== undefined
            ? {
                scheduledDate: input.scheduledDate
                  ? new Date(input.scheduledDate)
                  : null,
              }
            : {}),
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const note = await db.getProjectNote(input.id);
        if (!note || note.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "筆記不存在" });
        }
        await db.deleteProjectNote(input.id);
        return { success: true };
      }),
  }),

  // ─── Feedback ─────────────────────────────────────────────────────────────

  feedback: router({
    myFeedbacks: protectedProcedure.query(async ({ ctx }) => {
      return db.getFeedbacksByUser(ctx.user.id);
    }),

    create: protectedProcedure
      .input(
        z.object({
          title: z.string().min(1),
          description: z.string().optional(),
          category: z
            .enum(["bug", "feature_request", "quality_issue", "general"])
            .default("general"),
          priority: z
            .enum(["low", "medium", "high", "critical"])
            .default("medium"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const id = await db.createFeedbackReport({
          userId: ctx.user.id,
          ...input,
        });
        // Notify owner about new feedback
        const categoryLabels: Record<string, string> = {
          bug: "錯誤回報",
          feature_request: "功能詢問",
          quality_issue: "品質問題",
          general: "一般意見",
        };
        try {
          const { notifyOwner } = await import("./_core/notification");
          await notifyOwner({
            title: `新${categoryLabels[input.category] || "回饋"}：${input.title}`,
            content: `來自 ${ctx.user.name || "匿名使用者"}\n類別：${categoryLabels[input.category] || input.category}\n優先級：${input.priority}\n\n${input.description || "(無詳細說明)"}`,
          });
        } catch {
          /* notification is best-effort */
        }
        return { id };
      }),

    // Admin only
    all: adminProcedure.query(async () => {
      return db.getAllFeedbacks();
    }),

    updateStatus: adminProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum(["open", "in_progress", "resolved", "closed"]),
        })
      )
      .mutation(async ({ input }) => {
        await db.updateFeedbackStatus(input.id, input.status);
        return { success: true };
      }),
  }),

  // ─── Consistency Vault ──────────────────────────────────────────────────────

  vault: router({
    list: protectedProcedure
      .input(
        z
          .object({
            itemType: z.enum(["character", "scene"]).optional(),
            search: z.string().optional(),
            tags: z.array(z.string()).optional(),
          })
          .optional()
      )
      .query(async ({ ctx, input }) => {
        let items = input?.itemType
          ? await db.getVaultItemsByType(ctx.user.id, input.itemType)
          : await db.getVaultItemsByUser(ctx.user.id);

        if (input?.search) {
          const q = input.search.toLowerCase();
          items = items.filter(
            v =>
              v.name.toLowerCase().includes(q) ||
              ((v.tags as string[] | null) || []).some(t =>
                t.toLowerCase().includes(q)
              )
          );
        }
        if (input?.tags && input.tags.length > 0) {
          items = items.filter(v => {
            const vTags = (v.tags as string[] | null) || [];
            return input.tags!.some(t => vTags.includes(t));
          });
        }
        return items;
      }),

    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1).max(128),
          itemType: z.enum(["character", "scene"]),
          imageUrl: z.string().min(1),
          fileKey: z.string().optional(),
          tags: z.array(z.string().max(32)).max(20).optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const id = await db.createVaultItem({
          userId: ctx.user.id,
          name: input.name,
          itemType: input.itemType,
          imageUrl: input.imageUrl,
          fileKey: input.fileKey,
          tags: input.tags,
          metadata: input.metadata,
        });
        return { id };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().min(1).max(128).optional(),
          tags: z.array(z.string().max(32)).max(20).optional(),
          imageUrl: z.string().optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const item = await db.getVaultItem(input.id);
        if (!item || item.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "保險庫項目不存在",
          });
        }
        await db.updateVaultItem(input.id, {
          name: input.name,
          tags: input.tags,
          imageUrl: input.imageUrl,
          metadata: input.metadata,
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const item = await db.getVaultItem(input.id);
        if (!item || item.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "保險庫項目不存在",
          });
        }
        await db.deleteVaultItem(input.id);
        return { success: true };
      }),

    // ── 同步至資產庫（保存庫項目另存為數位資產）──────────────────────────
    exportToAssets: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const item = await db.getVaultItem(input.id);
        if (!item || item.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "保險庫項目不存在",
          });
        }
        const assetId = await db.createDigitalAsset({
          userId: ctx.user.id,
          title: `[保險庫] ${item.name}`,
          description: `從一致性保險庫匯出 (${item.itemType})`,
          assetType: "image",
          fileUrl: item.imageUrl,
          fileKey: item.fileKey || "",
        });
        return { assetId };
      }),
  }),

  // ─── Generation History ───────────────────────────────────────────────────

  history: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().default(50) }).optional())
      .query(async ({ ctx, input }) => {
        try {
          return await db.getHistoryByUser(ctx.user.id, input?.limit ?? 50);
        } catch {
          return [];
        }
      }),

    bookmarked: protectedProcedure.query(async ({ ctx }) => {
      try {
        return await db.getBookmarkedHistory(ctx.user.id);
      } catch {
        return [];
      }
    }),

    toggleBookmark: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          isBookmarked: z.boolean(),
        })
      )
      .mutation(async ({ input }) => {
        await db.updateHistoryEntry(input.id, {
          isBookmarked: input.isBookmarked,
        });
        return { success: true };
      }),

    rate: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          rating: z.number().min(1).max(5),
        })
      )
      .mutation(async ({ input }) => {
        await db.updateHistoryEntry(input.id, { userRating: input.rating });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteHistoryEntry(input.id);
        return { success: true };
      }),
  }),

  // ─── 創作工作室持久化（RecipeLibraryPanel / VersionHistoryPanel）─────────
  // Studio.tsx 之前把 savedRecipes / versions 放在 useState，重新整理就消失。
  // 兩個 sub-router 把它們搬到 MySQL；schema 見 drizzle/schema.ts
  // studioRecipes / studioVersions（migration 0030）。
  studio: router({
    recipes: router({
      list: protectedProcedure
        .input(
          z
            .object({
              modality: z
                .enum(["image", "video", "music", "voice"])
                .optional(),
            })
            .optional()
        )
        .query(async ({ ctx, input }) => {
          try {
            return await db.listStudioRecipes(ctx.user.id, input?.modality);
          } catch {
            return [];
          }
        }),

      create: protectedProcedure
        .input(
          z.object({
            name: z.string().min(1).max(255),
            modality: z.enum(["image", "video", "music", "voice"]),
            payload: z.record(z.string(), z.unknown()),
          })
        )
        .mutation(async ({ ctx, input }) => {
          const id = await db.createStudioRecipe({
            userId: ctx.user.id,
            name: input.name,
            modality: input.modality,
            payload: input.payload,
          });
          return { id, success: true };
        }),

      delete: protectedProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ ctx, input }) => {
          await db.deleteStudioRecipe(input.id, ctx.user.id);
          return { success: true };
        }),
    }),

    versions: router({
      list: protectedProcedure
        .input(
          z
            .object({
              modality: z
                .enum(["image", "video", "music", "voice"])
                .optional(),
              limit: z.number().min(1).max(200).optional(),
            })
            .optional()
        )
        .query(async ({ ctx, input }) => {
          try {
            return await db.listStudioVersions(
              ctx.user.id,
              input?.modality,
              input?.limit ?? 50
            );
          } catch {
            return [];
          }
        }),

      create: protectedProcedure
        .input(
          z.object({
            modality: z.enum(["image", "video", "music", "voice"]),
            versionKey: z.string().min(1).max(64),
            pinned: z.boolean().optional(),
            payload: z.record(z.string(), z.unknown()),
          })
        )
        .mutation(async ({ ctx, input }) => {
          const id = await db.createStudioVersion({
            userId: ctx.user.id,
            modality: input.modality,
            versionKey: input.versionKey,
            pinned: input.pinned ?? false,
            payload: input.payload,
          });
          return { id, success: true };
        }),

      setPinned: protectedProcedure
        .input(
          z.object({
            versionKey: z.string().min(1).max(64),
            pinned: z.boolean(),
          })
        )
        .mutation(async ({ ctx, input }) => {
          await db.setStudioVersionPinned(
            ctx.user.id,
            input.versionKey,
            input.pinned
          );
          return { success: true };
        }),

      delete: protectedProcedure
        .input(z.object({ id: z.number() }))
        .mutation(async ({ ctx, input }) => {
          await db.deleteStudioVersion(input.id, ctx.user.id);
          return { success: true };
        }),
    }),
  }),

  // ─── AI 全站光球代理（含上下文 + AI 代理人行為） ──────────────────────────────

  ai: router({
    startTask: brainProcedure
      .input(OrbStartTaskInputSchema)
      .mutation(async ({ input, ctx }) => {
        const task = orbTaskRepository.create({
          userId: ctx.user.id,
          intent: input.intent,
          steps: input.steps,
          needsApproval: input.needsApproval,
        });
        return { task };
      }),

    task: brainProcedure
      .input(
        z.object({
          taskId: z.string().min(1).max(72),
          ifNoneMatch: z.string().max(128).optional(),
        })
      )
      .query(async ({ input, ctx }) => {
        const task = orbTaskRepository.get(input.taskId, ctx.user.id);
        const sync = orbTaskRepository.getTaskSyncMeta(input.taskId, ctx.user.id);
        if (input.ifNoneMatch && sync.etag && input.ifNoneMatch === sync.etag) {
          return {
            task: null,
            latestEventId: sync.latestEventId,
            etag: sync.etag,
            notModified: true as const,
          };
        }
        return { task, latestEventId: sync.latestEventId, etag: sync.etag };
      }),

    taskTimeline: brainProcedure
      .input(
        z.object({
          taskId: z.string().min(1).max(72),
          from: z.number().int().optional(),
          to: z.number().int().optional(),
          cursor: z.number().int().optional(),
          limit: z.number().int().min(1).max(500).optional(),
          order: z.enum(["asc", "desc"]).optional(),
          types: z
            .array(z.enum(["task_created", "step_approved", "step_reported"]))
            .max(3)
            .optional(),
        })
      )
      .query(async ({ input, ctx }) => {
        const page = orbTaskRepository.getTimelinePage(input.taskId, ctx.user.id, {
          from: input.from,
          to: input.to,
          cursor: input.cursor,
          limit: input.limit,
          order: input.order,
          types: input.types,
        });
        return page;
      }),

    toolCallLogs: brainProcedure
      .input(
        z
          .object({
            taskId: z.string().min(1).max(72).optional(),
            requestId: z.string().min(1).max(64).optional(),
            limit: z.number().int().min(1).max(500).optional(),
          })
          .optional()
      )
      .query(async ({ input, ctx }) => {
        return orbToolCallLogStore.list({
          userId: ctx.user.id,
          taskId: input?.taskId,
          requestId: input?.requestId,
          limit: input?.limit,
        });
      }),

    approveTask: brainProcedure
      .input(OrbApproveTaskInputSchema)
      .mutation(async ({ input, ctx }) => {
        const task = orbTaskRepository.approve(
          input.taskId,
          ctx.user.id,
          input.approved
        );
        // Mirror approval into the FSM (when the task is also tracked there)
        // and kick the autonomous driver so the rest of the steps run without
        // requiring the client to call reportTaskStep N more times.
        if (input.approved) {
          if (getOrbAgentTask(input.taskId)) {
            try {
              approveOrbAgentTask(input.taskId);
            } catch (error) {
              console.warn(
                "[Orb] FSM approve mirror failed:",
                error instanceof Error ? error.message : String(error)
              );
            }
          }
          void driveOrbTaskInBackground({
            taskId: input.taskId,
            userId: ctx.user.id,
            userRole: ctx.user.role,
          });
        } else if (getOrbAgentTask(input.taskId)) {
          try {
            cancelOrbAgentTask(input.taskId, "cancelled by user");
          } catch {
            // best-effort
          }
        }
        return { task };
      }),

    approveTaskStep: brainProcedure
      .input(OrbApproveStepInputSchema)
      .mutation(async ({ input, ctx }) => {
        const task = orbTaskRepository.approveStep(
          input.taskId,
          ctx.user.id,
          input.stepId,
          input.approved
        );
        const approvalToken = task?.stepApprovals.find(x => x.stepId === input.stepId)?.token;
        const approvalExpiresAt = task?.stepApprovals.find(
          x => x.stepId === input.stepId
        )?.expiresAt;
        return { task, approvalToken, approvalExpiresAt };
      }),

    reportTaskStep: brainProcedure
      .input(OrbStepReportInputSchema)
      .mutation(async ({ input, ctx }) => {
        const currentTask = orbTaskRepository.get(input.taskId, ctx.user.id);
        if (!currentTask) return { task: null, toolResults: [] as const };

        let toolResults: Array<{
          name: string;
          ok: boolean;
          status?: number;
          data?: unknown;
          error?: string;
        }> = [];

        if (input.ok) {
          const tools = getOrbToolRegistry();
          const requestId = `task_${input.taskId}_${Date.now()}`;
          // Load the user's saved agent preferences so confirmation policy,
          // tool allow/blocklist and max-step caps actually take effect at
          // runtime (without this load, the /agent settings panel had no
          // observable effect on real task execution).
          const agentPreferences = await loadAgentPreferencesForUser(ctx.user.id);
          const toolRun = await executeCurrentStepTools({
            task: currentTask,
            userId: ctx.user.id,
            userRole: ctx.user.role,
            tools,
            requestId,
            agentPreferences,
            onAuditEvent: event => {
              orbToolCallLogStore.append(event);
              // 把每一筆 specialist tool 結果寫進 specialized_agent_interactions
              // — 這是在這之前 dead schema 第一次有 production writer。
              recordToolAuditAsSpecialistInteraction(event);
            },
            approved:
              !currentTask.needsApproval ||
              orbTaskRepository.isStepApproved(
                input.taskId,
                ctx.user.id,
                input.stepId,
                input.approvalToken,
                input.at
              ),
          });
          toolResults = toolRun.toolResults;
          if (!toolRun.ok) {
            const failedTask = orbTaskRepository.reportStep(
              {
                taskId: input.taskId,
                stepId: input.stepId,
                ok: false,
                detail: input.detail,
                errorCode: input.errorCode ?? toolResults[0]?.error,
                source: "tool",
                actor: "agent",
                at: input.at,
              },
              ctx.user.id
            );
            return { task: failedTask, toolResults };
          }
        }

        const task = orbTaskRepository.reportStep(
          {
            taskId: input.taskId,
            stepId: input.stepId,
            ok: input.ok,
            detail: input.detail,
            errorCode: input.errorCode,
            source: input.source ?? "ui",
            actor: input.actor ?? "user",
            at: input.at,
          },
          ctx.user.id
        );
        return { task, toolResults };
      }),

    tools: brainProcedure.query(() => {
      const tools = getOrbToolRegistry();
      return tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        method: tool.method,
        version: tool.version ?? "v1",
        riskLevel: tool.riskLevel ?? "medium",
        allowedRoles: tool.allowedRoles ?? [],
        retryPolicy: tool.retryPolicy,
        fallbackTools: tool.fallbackTools ?? [],
        requireConfirmation: Boolean(tool.requireConfirmation),
      }));
    }),

    chat: brainProcedure
      .input(
        z.object({
          messages: z.array(OrbChatRouterMessageSchema),
          personality: z
            .enum(["calm", "creative", "technical"])
            .default("creative"),
          /** 舊版欄位：純文字頁面上下文，保留向後相容 */
          context: z.string().optional(),
          /**
           * 新版：PageAgent 註冊時提供的結構化 snapshot。
           * 帶入後 LLM 才能知道這頁有哪些 modelId / tabId / preset 可以 [ACTION:...]。
           */
          pageSnapshot: z
            .object({
              pageId: z.string(),
              pageLabel: z.string(),
              pagePath: z.string(),
              capabilities: z
                .array(
                  z.object({
                    action: z.string(),
                    label: z.string(),
                    currentId: z.string().optional(),
                    hint: z.string().optional(),
                    options: z
                      .array(
                        z.object({
                          id: z.string(),
                          label: z.string(),
                          description: z.string().optional(),
                        })
                      )
                      .optional(),
                  })
                )
                .default([]),
              state: z.record(z.string(), z.unknown()).optional(),
            })
            .optional(),
          /** 使用者最近對光球建議的反應，給 LLM 學習偏好 */
          recentFeedback: z
            .array(
              z.object({
                at: z.number(),
                status: z.enum([
                  "accepted",
                  "edited",
                  "cancelled",
                  "completed",
                  "failed",
                ]),
                actionType: z.string(),
                note: z.string().optional(),
                pageId: z.string().optional(),
              })
            )
            .optional(),
          /** 強制要求：即使是非破壞性動作也要先確認 */
          alwaysConfirm: z.boolean().optional(),
          /** 使用者代理偏好（confirmationPolicy 影響反問門檻、autoApproveTools / blockedTools 影響白黑名單） */
          preferences: z
            .object({
              confirmationPolicy: z
                .enum(["always_approve", "confirm_high_risk", "confirm_all", "manual"])
                .optional(),
              maxAutoStepsPerTask: z.number().int().min(1).max(20).optional(),
              autoApproveTools: z.array(z.string().max(64)).max(64).optional(),
              blockedTools: z.array(z.string().max(64)).max(64).optional(),
              allowedRiskLevels: z.array(z.string().max(24)).max(8).optional(),
              orbAgentEnabled: z.boolean().nullable().optional(),
              workflowsEnabled: z.boolean().nullable().optional(),
              disabledPageAgents: z.array(z.string().max(64)).max(64).optional(),
              disabledActionsByPage: z
                .record(z.string().max(64), z.array(z.string().max(40)).max(20))
                .optional(),
              // 15 精靈：使用者靜音的精靈 id 清單（最多 15 位）。傳入後
              // selectRoleForIntent 會跳過這些角色的關鍵字規則。
              mutedSpirits: z.array(z.string().max(40)).max(15).optional(),
              favoriteSpirits: z.array(z.string().max(40)).max(15).optional(),
            })
            .optional(),
          /** 客戶端請求去重 ID（可由 x-request-id 同步傳入） */
          requestId: z.string().min(1).max(128).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const headerRequestId = ctx.req.headers["x-request-id"];
        const idempKey =
          (Array.isArray(headerRequestId) ? headerRequestId[0] : headerRequestId) ??
          input.requestId;
        if (idempKey) {
          const status = checkAndLock(idempKey);
          if (status === "duplicate") {
            const cached = getResult(idempKey);
            return cached ?? { status: "duplicate", message: "Request already processed" };
          }
          if (status === "in-progress") {
            return { status: "in-progress", message: "Request is already being processed" };
          }
        }

        // 15 精靈：先把這一輪該由誰接手算出來。這個值有兩個下游：
        //   1) selectProvider() 用 preferredProviderId 切到對應 LLM
        //   2) finalizeIdempotentResponse 把 agentRole 塞進每一條回覆，
        //      讓客戶端 chip / 全站 widget / 對話歷史 metadata 都對得上。
        // 計算放在 handler 早期，就算下游 gate 早退也帶得回去。
        const lastUserMsgForSpirit = [...input.messages]
          .reverse()
          .find(message => message.role === "user");
        const lastUserTextForSpirit =
          typeof lastUserMsgForSpirit?.content === "string"
            ? lastUserMsgForSpirit.content
            : Array.isArray(lastUserMsgForSpirit?.content)
              ? lastUserMsgForSpirit.content
                  .filter((part: { type: string }) => part.type === "text")
                  .map((part: { text?: string }) => part.text ?? "")
                  .join("\n")
              : "";
        // 使用者靜音的精靈 — 從 preferences 拿，selectRoleForIntent 會跳過。
        const mutedSpiritsForSelection = (
          (input.preferences as { mutedSpirits?: string[] } | undefined)?.mutedSpirits ?? []
        ).filter((s): s is string => typeof s === "string") as readonly AgentRole[];
        const spiritSelection = lastUserTextForSpirit
          ? selectRoleForIntent({
              text: lastUserTextForSpirit,
              snapshot: input.pageSnapshot ?? null,
              turnCount: input.messages.length,
              mutedRoles: mutedSpiritsForSelection,
            })
          : null;

        const finalizeIdempotentResponse = <T extends object | null | undefined>(result: T): T => {
          // Inject identity / preference profile for the client. We do it here so
          // every reply path (planner success, gate blocks, empty LLM, legacy
          // fallback…) carries the same context without each call site needing
          // to remember to spread the fields.
          //
          // Closure note: `userIdentity` / `rememberedPreferences` /
          // `webResearchSources` are defined later in the chat handler body,
          // but JS resolves these lookups at call time, by which point they
          // always exist.
          let enriched: T = result;
          if (result && typeof result === "object") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const r = result as any;
            // Only attach when we actually computed them — avoids polluting
            // unrelated early-return shapes ({status: "in-progress"} etc.).
            if (typeof userIdentity !== "undefined" && r.userIdentity === undefined) {
              r.userIdentity = userIdentity;
            }
            if (typeof rememberedPreferences !== "undefined" && r.rememberedPreferences === undefined) {
              r.rememberedPreferences = rememberedPreferences;
            }
            if (
              typeof webResearchSources !== "undefined" &&
              webResearchSources.length > 0 &&
              r.webSources === undefined
            ) {
              r.webSources = webResearchSources;
            }
            // 15 精靈 (6 通用 + 6 專精 + 3 主動)：每條回覆掛上接手精靈，讓所有 UI surface 一致顯示。
            if (spiritSelection && r.agentRole === undefined) {
              r.agentRole = spiritSelection.role;
              r.agentRoleConfidence = spiritSelection.confidence;
              r.agentRoleRationale = spiritSelection.rationale;
            }
            enriched = r;
          }
          if (idempKey) {
            storeResult(idempKey, enriched);
          }
          return enriched;
        };

        const makePlannerMeta = (params: {
          plannerStatus: string;
          plan?: unknown;
          warnings?: string[];
          preferredEngine?: string | null;
          taskId?: string | null;
          usedMultimodalPlanner?: boolean;
          memoryInjected?: boolean;
        }) => {
          const now = Date.now();
          const planRecord =
            params.plan && typeof params.plan === "object"
              ? (params.plan as Record<string, unknown>)
              : null;
          const planId =
            typeof planRecord?.planId === "string" && planRecord.planId.trim()
              ? planRecord.planId
              : `plan_${now}_${Math.random().toString(36).slice(2, 8)}`;
          const traceId =
            typeof planRecord?.traceId === "string" && planRecord.traceId.trim()
              ? planRecord.traceId
              : `trace_${now}_${Math.random().toString(36).slice(2, 8)}`;
          return {
            plannerStatus: params.plannerStatus,
            planId,
            traceId,
            preferredEngine: params.preferredEngine ?? null,
            warnings: params.warnings ?? [],
            taskId: params.taskId ?? null,
            usedMultimodalPlanner: Boolean(params.usedMultimodalPlanner),
            memoryInjected: Boolean(params.memoryInjected),
          };
        };

        const registeredTools = getOrbToolRegistry();

        // Global kill switch + per-user override: env wins when disabled
        // (admin can globally turn the agent off), but if env=on the user can
        // still flip themselves into chat-only mode via agentPreferences.
        const envOrbAgentEnabled = isFlagEnabled(
          process.env.ENABLE_ORB_AGENT ?? (serverEnv as Record<string, string | undefined>).ENABLE_ORB_AGENT,
          true
        );
        const userOrbAgentOverride =
          (input as { preferences?: { orbAgentEnabled?: boolean | null } }).preferences
            ?.orbAgentEnabled ?? null;
        const orbAgentEnabled =
          !envOrbAgentEnabled
            ? false
            : userOrbAgentOverride === false
              ? false
              : true;

        const schemaFirstPlannerEnabled = isFlagEnabled(
          process.env.ENABLE_SCHEMA_FIRST_PLANNER ?? serverEnv.ENABLE_SCHEMA_FIRST_PLANNER,
          true
        );
        const globalWorkflowsEnabled = isFlagEnabled(
          process.env.VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS ?? serverEnv.VITE_ENABLE_GLOBAL_AGENT_WORKFLOWS,
          true
        );
        const orbTaskStateMachineEnabled = isFlagEnabled(
          process.env.ENABLE_ORB_TASK_STATE_MACHINE ?? serverEnv.ENABLE_ORB_TASK_STATE_MACHINE,
          true
        );
        const orbTaskMemoryEnabled = isFlagEnabled(
          process.env.ENABLE_ORB_TASK_MEMORY ?? serverEnv.ENABLE_ORB_TASK_MEMORY,
          true
        );
        const orbLongTermMemoryEnabled = isFlagEnabled(
          process.env.ENABLE_ORB_LONG_TERM_MEMORY ?? serverEnv.ENABLE_ORB_LONG_TERM_MEMORY,
          true
        );
        const capabilityRegistryEnabled = isFlagEnabled(
          process.env.ENABLE_GLOBAL_AGENT_CAPABILITY_REGISTRY ??
            serverEnv.ENABLE_GLOBAL_AGENT_CAPABILITY_REGISTRY,
          true
        );
        const toolRegistryEnabled = isFlagEnabled(
          process.env.ENABLE_GLOBAL_AGENT_TOOL_REGISTRY ??
            serverEnv.ENABLE_GLOBAL_AGENT_TOOL_REGISTRY,
          true
        );
        const providerRouterEnabled = isFlagEnabled(
          process.env.ENABLE_ORB_PROVIDER_ROUTER ?? serverEnv.ENABLE_ORB_PROVIDER_ROUTER,
          true
        );
        const costGuardEnabled = isFlagEnabled(
          process.env.ENABLE_ORB_COST_GUARD ?? serverEnv.ENABLE_ORB_COST_GUARD,
          true
        );
        const quotaGuardEnabled = isFlagEnabled(
          process.env.ENABLE_ORB_QUOTA_GUARD ?? serverEnv.ENABLE_ORB_QUOTA_GUARD,
          false
        );
        const idempotencyGuardEnabled = isFlagEnabled(
          process.env.ENABLE_ORB_IDEMPOTENCY_GUARD ??
            serverEnv.ENABLE_ORB_IDEMPOTENCY_GUARD,
          false
        );
        const telemetryEvents: Array<Record<string, unknown>> = [];
        const recentTaskMemorySummary = orbTaskMemoryEnabled
          ? summarizeRecentOrbTaskMemoryForPlanner(10)
          : "Task memory disabled.";
        const recentOrbMemories = orbLongTermMemoryEnabled
          ? getRecentOrbMemories({ userId: ctx.user.id, limit: 10 })
          : [];
        const memoryCandidate = [...input.messages]
          .reverse()
          .find(message => message.role === "user")?.content;
        const memoryQuery =
          typeof memoryCandidate === "string"
            ? memoryCandidate
            : Array.isArray(memoryCandidate)
              ? memoryCandidate
                  .filter(part => part.type === "text")
                  .map(part => part.text)
                  .join("\n")
              : "";
        const memoryContext = orbLongTermMemoryEnabled
          ? await buildOrbMemorySummaryForPlanner({ userId: ctx.user.id, query: memoryQuery, limit: 10 })
          : { summary: "Long-term memory disabled.", memoryInjected: false };
        const recentOrbMemorySummary = memoryContext.summary;
        // Phase 3c：把 DB 裡的長期記憶跟前端 session 記憶合併給 prompt。
        // 前端剛啟動時 recentFeedback 是空的，但使用者過去的接受/拒絕早已
        // 寫進 orb_feedback_events；這裡讀最近 10 筆補上去。
        const dbMemory = await db
          .getRecentOrbFeedback(ctx.user.id, 10)
          .catch(() => [] as Array<{
            createdAt: Date;
            status: "accepted" | "edited" | "cancelled" | "completed" | "failed";
            actionType: string;
            note: string | null;
            pageId: string | null;
          }>);
        const dbEvents = dbMemory.map(row => ({
          at: row.createdAt.getTime(),
          status: row.status,
          actionType: row.actionType,
          note: row.note ?? undefined,
          pageId: row.pageId ?? undefined,
        }));
        const mergedFeedback = mergeFeedbackHistories(
          input.recentFeedback,
          dbEvents,
          12
        );
        // 讓光球安靜地知道使用者擁有哪些資產，這樣「再做一張類似的」「延伸之前的作品」
        // 之類的請求才接得起來；UI 完全不變，純後端注入。
        type AssetLibrarySummary = NonNullable<OrbPromptExtras["assetLibrary"]>;
        const assetLibrarySummary: OrbPromptExtras["assetLibrary"] = await db
          .getDigitalAssetsByUser(ctx.user.id)
          .then(all => {
            if (!all.length) return undefined;
            const byType: AssetLibrarySummary["byType"] = {};
            for (const a of all) {
              const k = a.assetType as keyof AssetLibrarySummary["byType"];
              byType[k] = (byType[k] ?? 0) + 1;
            }
            return {
              total: all.length,
              byType,
              recent: all.slice(0, 5).map(a => ({
                id: a.id,
                title: a.title,
                assetType: a.assetType,
                promptUsed: a.promptUsed,
              })),
            };
          })
          .catch(() => undefined);
        if (orbLongTermMemoryEnabled) {
          const preferences = extractOrbPreferencesFromConversation({
            messages: input.messages.map(message => ({
              role: message.role,
              content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
            })),
          });
          const hasSignal =
            preferences.styles.length ||
            preferences.outputs.length ||
            preferences.models.length ||
            preferences.platforms.length ||
            preferences.videoLengthHint ||
            preferences.name ||
            preferences.language;
          if (hasSignal) {
            const tags = [
              "preference",
              ...preferences.styles.slice(0, 2).map(s => `style:${s}`),
              ...preferences.outputs.slice(0, 2).map(o => `output:${o}`),
              ...preferences.platforms.slice(0, 2).map(p => `platform:${p}`),
              ...(preferences.videoLengthHint ? [`length:${preferences.videoLengthHint}`] : []),
              ...(preferences.name ? [`name:${preferences.name}`] : []),
            ];
            recordOrbMemory({
              userId: ctx.user.id,
              traceId: `chat_${Date.now()}`,
              type: "user_preference",
              summary: `Preference update: name=${preferences.name ?? "unknown"}, lang=${preferences.language ?? "unknown"}, length=${preferences.videoLengthHint ?? "unknown"}, styles=${preferences.styles.join(",") || "none"}, platforms=${preferences.platforms.join(",") || "none"}, outputs=${preferences.outputs.join(",") || "none"}`,
              source: "ai.chat",
              confidence: 0.72,
              tags,
              metadata: preferences as unknown as Record<string, unknown>,
            });
          }
        }

        // Aggregate the durable preference profile (name / styles / platforms /
        // length tier) from all preference-type memories so the LLM sees one
        // tidy block instead of having to parse JSON snapshots itself. The
        // profile is also returned to the client so the keyword fallback can
        // fill in defaults when the LLM doesn't reply with actions.
        const preferenceProfile = aggregatePreferenceProfile(recentOrbMemories);
        const accountName = ctx.user?.name ?? undefined;
        const userIdentity = preferenceProfile.name || accountName
          ? {
              accountName,
              rememberedName: preferenceProfile.name ?? undefined,
            }
          : undefined;
        const rememberedPreferences = preferenceProfile.evidenceCount > 0
          ? {
              styles: preferenceProfile.styles,
              outputs: preferenceProfile.outputs,
              platforms: preferenceProfile.platforms,
              models: preferenceProfile.models,
              videoLengthHint: preferenceProfile.videoLengthHint,
              evidenceCount: preferenceProfile.evidenceCount,
            }
          : undefined;

        // 找到最近一則 user 訊息，給 buildOrbSystemPrompt 用來決定本回合
        // 的 agent skill（image-specialist / director / ...）。如果取不到
        // 就傳 undefined，serializeSkillBlock 會跳過整個區塊。
        const latestUserMessageContent = [...input.messages]
          .reverse()
          .find(m => m.role === "user")?.content;
        const latestUserMessageText =
          typeof latestUserMessageContent === "string"
            ? latestUserMessageContent
            : Array.isArray(latestUserMessageContent)
            ? latestUserMessageContent
                .filter(part => part.type === "text")
                .map(part => part.text)
                .join("\n")
            : undefined;

        // 從 specialized_agent_interactions 拉最近的 tool 名與專精助手習慣。
        // 兩者並行，回傳空陣列 / 空字串都是合法（DB 不可用時不阻塞 chat）。
        const [recentSpecialistTools, specialistHints] = await Promise.all([
          getRecentSpecialistTools(ctx.user.id, 5),
          getSpecialistMemoryHints(ctx.user.id),
        ]);

        const systemPrompt = buildOrbSystemPrompt(
          input.personality,
          input.context ?? undefined,
          {
            pageSnapshot: input.pageSnapshot,
            recentFeedback: mergedFeedback,
            alwaysConfirm: input.alwaysConfirm,
            assetLibrary: assetLibrarySummary,
            apiTools: registeredTools.map(tool => ({
              name: tool.name,
              description: tool.description,
              method: tool.method,
              riskLevel: tool.riskLevel,
              version: tool.version,
              allowedRoles: tool.allowedRoles,
              retryPolicy: tool.retryPolicy,
              fallbackTools: tool.fallbackTools,
              requireConfirmation: tool.requireConfirmation,
            })),
            userIdentity,
            rememberedPreferences,
            userMessage: latestUserMessageText,
            recentTools: recentSpecialistTools,
            specialistHints,
          }
        );
        const siteKnowledgeSummary = summarizeSiteKnowledgeForPlanner({
          currentPageSummary: input.pageSnapshot
            ? JSON.stringify({
                pageId: input.pageSnapshot.pageId,
                pagePath: input.pageSnapshot.pagePath,
                capabilities: input.pageSnapshot.capabilities.slice(0, 12).map(cap => cap.action),
              })
            : "No page snapshot.",
          memorySummary: summarizeRecentMemoryForPlanner(recentOrbMemories),
          taskOutcomesSummary: recentTaskMemorySummary,
        });

        // 從 AI 大腦取得導演配置（光球預設使用導演大腦），但會依使用者意圖
        // 動態切到 5 個推理槽中最適合的那一個——讓使用者在 AI 大腦頁改的
        // analyst / storyteller / technician / curator 模型都能真正生效。
        const latestUserContent = [...input.messages]
          .reverse()
          .find(m => m.role === "user")?.content;
        const latestUserTextForRouting =
          typeof latestUserContent === "string"
            ? latestUserContent
            : Array.isArray(latestUserContent)
            ? latestUserContent
                .filter(part => part.type === "text")
                .map(part => part.text)
                .join("\n")
            : "";
        const reasoningSlot = pickReasoningSlotForOrbChat({
          userText: latestUserTextForRouting,
          pageSnapshot: input.pageSnapshot,
        });
        let director = ctx.brain.getBrain(reasoningSlot);

        // ── Hybrid brain safeguard ────────────────────────────────────────
        // Perplexity Sonar 系列在原生 chat completions API 不支援 OpenAI 風格
        // 的 function calling；schema-first planner 一旦遇到必須吐 tool_use
        // JSON 的劇本就會退化成 prompt-engineering（成功率掉一截）。
        //
        // 我們的「混合搭配」策略：分析型 slot（analyst）預設走 Sonar 換取
        // 即時 web grounding，其他 slot 走 Claude Opus 4.7 換取原生 tool
        // use。當 Sonar slot 被選中、但 schema-first planner 啟用時，把規劃
        // 階段的大腦改用 director（Claude）— 這樣使用者拿到的回覆既能
        // 帶上 Sonar 的網路引用，又不會卡在 planner 的 JSON 流程上。
        const isPerplexityModel = (m: string | undefined) =>
          typeof m === "string" && /^(perplexity\/|sonar(-|$))/i.test(m);
        if (
          isPerplexityModel(director.model) &&
          schemaFirstPlannerEnabled
        ) {
          const directorBrain = ctx.brain.getBrain("director");
          if (directorBrain && !isPerplexityModel(directorBrain.model)) {
            director = {
              ...director,
              // Use the director slot's tool-use-capable model for planning,
              // but keep the picked slot's temperature / topP / system prompt
              // so the conversational personality stays consistent.
              model: directorBrain.model,
            };
          }
        }

        // ── Web research stage ─────────────────────────────────────────────
        // When the user asks a research-style question ("how to …", "製茶過程",
        // "what is …"), look up real sources via Brave/GitHub fallback so the
        // orb can ground its reply in citable URLs instead of guessing.
        // Skipped silently when the trigger doesn't fire or the search
        // provider is unconfigured.
        // Both ENABLE_ORB_WEB_RESEARCH and ENABLE_RESEARCH_MODE turn this on
        // (the latter is rewritten to FEATURE_RESEARCH_MODE by env self-repair).
        const webResearchEnabled =
          serverEnv.ENABLE_ORB_WEB_RESEARCH !== "false" &&
          featureFlags.isEnabled("RESEARCH_MODE");
        const webResearchOutcome = await runOrbWebResearch(
          latestUserTextForRouting,
          {
            enabled: webResearchEnabled,
            // Planner-driven path (schema-first agent planner): use the
            // lean "agent" formatting so the LLM does not collapse the
            // reply into a "步驟 1 / 步驟 2 ... 從哪步開始？" wall of text
            // that conflicts with the planner's clarification / tasked
            // commitment. Legacy fallback can still call the qna shape.
            mode: "agent",
          }
        );
        if (webResearchOutcome.reason === "matched" || webResearchOutcome.reason === "matched:explicit_search" || webResearchOutcome.reason === "matched:deep_search") {
          appendTelemetryEvent(telemetryEvents, "orb.web_research.hit", {
            results: webResearchOutcome.results.length,
            reason: webResearchOutcome.reason,
            hasDeepSearch: !!webResearchOutcome.deepSearchResult,
          });
        } else if (webResearchOutcome.reason === "error") {
          appendTelemetryEvent(telemetryEvents, "orb.web_research.error", {});
        }
        const webResearchPromptBlock = webResearchOutcome.promptBlock ?? "";
        const siteModelUsageRows = await getSiteWideModelUsageSnapshot({
          days: 14,
          limit: 8,
        });
        const siteModelUsagePromptBlock = siteModelUsageRows.length
          ? [
              "【站內模型使用快照（最近 14 天）】",
              ...siteModelUsageRows.map(
                row =>
                  `- ${row.model}：${row.totalCalls} 次（成功 ${row.successCalls} / 失敗 ${row.failedCalls}，tokens ${row.totalTokens}，成本 $${row.totalCostUsd.toFixed(4)}）`
              ),
              "若使用者要『全站哪些模型/功能最適合』，請優先參考以上活躍模型，再結合需求做分段建議。",
            ].join("\n")
          : "";
        const webResearchSources = webResearchOutcome.results.map(r => ({
          title: r.title,
          url: r.url,
          source: r.source,
        }));
        const augmentSystemPromptWithResearch = (base: string) =>
          webResearchPromptBlock ? `${base}\n\n${webResearchPromptBlock}` : base;

        // 預設依大腦選定的 model 推斷引擎偏好；多模態與 Provider Router
        // 會在後續再做動態決策。Brain 設定改 model 後，光球就會跟著切換引擎。
        // 代理主流程預設走 auto：讓 llmRouter 以 OpenRouter / Perplexity 可用性
        // 做首選與降級，不再把路由鎖死在 Gemini。
        let enginePreference: "auto" = "auto";

        try {
          // Prompt-injection defence: strip well-known role-impersonation /
          // jailbreak phrases from user content before the planner sees it.
          // Triggers are surfaced via telemetry so abuse can be flagged.
          const sanitizationResult = sanitizeOrbMessages(
            input.messages.map(m => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            }))
          );
          if (sanitizationResult.triggers.length > 0) {
            appendTelemetryEvent(telemetryEvents, "orb.prompt_defense.triggered", {
              triggers: sanitizationResult.triggers.join(","),
            });
          }
          const plannerMessages = sanitizationResult.messages;
          const latestUserText = [...input.messages]
            .reverse()
            .find(m => m.role === "user");
          const latestTextContent =
            typeof latestUserText?.content === "string"
              ? latestUserText.content
              : Array.isArray(latestUserText?.content)
              ? latestUserText.content
                  .filter(part => part.type === "text")
                  .map(part => part.text)
                  .join("\n")
              : "";
          const attachmentUrls = input.messages.flatMap(message =>
            Array.isArray(message.content)
              ? message.content.flatMap(part => {
                  if (part.type === "image_url") return [part.image_url.url];
                  if (part.type === "file_url") return [part.file_url.url];
                  return [];
                })
              : []
          );

          const idempotencyCandidate =
            attachmentUrls.length > 0 ||
            /(生成|generate|video|image|audio|code|deploy|github|影片|圖片|配音)/i.test(
              latestTextContent
            );
          if (idempotencyGuardEnabled && idempotencyCandidate) {
            const idempotencyKey = buildOrbIdempotencyKey({
              userId: ctx.user.id,
              sessionId: (ctx as { sessionId?: string }).sessionId,
              text: latestTextContent,
              attachmentUrls,
            });
            const duplicate = findDuplicateTask(idempotencyKey);
            if (duplicate && Date.now() - duplicate.createdAt < 5_000) {
              appendTelemetryEvent(telemetryEvents, "idempotency.duplicate_detected", {
                key: idempotencyKey.slice(0, 16),
                taskId: duplicate.taskId ?? null,
                planId: duplicate.planId ?? null,
              });
              return {
                duplicate: true,
                taskId: duplicate.taskId ?? null,
              };
            }
            rememberTaskKey(idempotencyKey, { taskId: undefined });
          }

          const attachmentGuard = validateAttachmentGuards(plannerMessages as Message[]);
          if (!attachmentGuard.ok) {
            appendTelemetryEvent(telemetryEvents, "attachment.too_large", {
              reason: attachmentGuard.reason,
              totalBytes: attachmentGuard.totalBytes,
            });
            const meta = makePlannerMeta({
              plannerStatus: "attachment_blocked",
              preferredEngine: "gemini",
              warnings: [attachmentGuard.reason ?? "attachment blocked"],
            });
            return {
              reply:
                attachmentGuard.message ??
                "這個檔案太大，我目前無法直接處理。請壓縮後再上傳，或先轉成較短的 MP3 / MP4 / PDF 摘要。",
              actions: [],
              intent: null,
              askBeforeAct: false,
              suggestions: [],
              toolCalls: [],
              telemetry: {
                traceId: meta.traceId,
                planId: meta.planId,
                taskId: null,
                plannerStatus: meta.plannerStatus,
                preferredEngine: meta.preferredEngine,
                decisionMode: null,
                riskLevel: null,
                usedMultimodalPlanner: false,
                durationMs: null,
                outcome: "attachment_blocked",
                events: telemetryEvents,
              },
              ...meta,
              taskDraft: null,
            };
          }

          if (quotaGuardEnabled) {
            const rapid = checkAndConsumeQuota("rapid_click", {
              userId: ctx.user.id,
              sessionId: String(ctx.user.id),
            });
            if (!rapid.allowed) {
              appendTelemetryEvent(telemetryEvents, "quota.blocked", { category: rapid.category, reason: rapid.reason });
              const meta = makePlannerMeta({
                plannerStatus: "quota_limited",
                preferredEngine: "auto",
                warnings: [rapid.reason ?? "quota limited"],
              });
              return {
                reply: "你操作得有點快，我先幫你保護額度。請稍等幾秒再試一次。",
                actions: [],
                intent: null,
                askBeforeAct: false,
                suggestions: [],
                toolCalls: [],
                telemetry: {
                  traceId: meta.traceId,
                  planId: meta.planId,
                  taskId: null,
                  plannerStatus: meta.plannerStatus,
                  preferredEngine: meta.preferredEngine,
                  decisionMode: null,
                  riskLevel: null,
                  usedMultimodalPlanner: false,
                  durationMs: null,
                  outcome: "quota_limited",
                  events: telemetryEvents,
                },
                ...meta,
                taskDraft: null,
              };
            }
            appendTelemetryEvent(telemetryEvents, "quota.allowed", {
              category: "rapid_click",
            });
          }
          if (quotaGuardEnabled) {
            const plannerQuota = checkAndConsumeQuota("planner", {
              userId: ctx.user.id,
              sessionId: String(ctx.user.id),
            });
            if (!plannerQuota.allowed) {
              appendTelemetryEvent(telemetryEvents, "quota.blocked", {
                category: plannerQuota.category,
                reason: plannerQuota.reason,
              });
              const meta = makePlannerMeta({
                plannerStatus: "quota_limited",
                preferredEngine: "auto",
                warnings: [plannerQuota.reason ?? "planner quota limited"],
              });
              return {
                reply: "你今天的此類任務額度已用完，可以改成較小的任務，或明天再試。",
                actions: [],
                intent: null,
                askBeforeAct: false,
                suggestions: [],
                toolCalls: [],
                telemetry: {
                  traceId: meta.traceId,
                  planId: meta.planId,
                  taskId: null,
                  plannerStatus: meta.plannerStatus,
                  preferredEngine: meta.preferredEngine,
                  decisionMode: null,
                  riskLevel: null,
                  usedMultimodalPlanner: false,
                  durationMs: null,
                  outcome: "quota_limited",
                  events: telemetryEvents,
                },
                ...meta,
                taskDraft: null,
              };
            }
          }

          const routeIntent: ProviderRouteIntent = attachmentGuard.kinds.includes("pdf")
            ? "planner_pdf"
            : attachmentGuard.kinds.length > 0
            ? "planner_multimodal"
            : "planner_text";
          // 15 精靈 (6 通用 + 6 專精 + 3 主動)：spiritSelection 已在 handler 頂部算好（finalize 也會用），
          // 這裡只把它對應的 preferredProvider 餵給 selectProvider。
          const spiritPreferredProvider = spiritSelection
            ? getPreferredProviderForRole(spiritSelection.role)
            : undefined;
          if (providerRouterEnabled) {
            const selection = selectProvider({
              intent: routeIntent,
              riskLevel: "low",
              preferredProviderId: spiritPreferredProvider,
            });
            if (!selection.provider) {
              appendTelemetryEvent(telemetryEvents, "provider.unavailable", {
                routeIntent,
              });
              const meta = makePlannerMeta({
                plannerStatus: "provider_unavailable",
                preferredEngine: "auto",
                warnings: ["provider unavailable"],
              });
              // Tailor the message to what the user actually attached so the
              // suggestion is something they can act on (paste text vs. describe
              // the asset) instead of a generic "try again" line.
              const attachmentReply =
                routeIntent === "planner_pdf"
                  ? "我現在沒辦法讀取這個 PDF（多模態服務暫時離線）。請把腳本內容直接貼到對話裡，我就能繼續幫你拆解、改寫或配音。"
                  : routeIntent === "planner_multimodal"
                  ? "我現在沒辦法讀取你上傳的附件（多模態服務暫時離線）。請改用文字描述內容，或稍後再試。"
                  : "目前模型服務暫時不可用，請稍後再試。";
              const attachmentSuggestions =
                routeIntent === "planner_pdf"
                  ? ["把腳本內容貼到這裡", "稍後再試"]
                  : routeIntent === "planner_multimodal"
                  ? ["改用文字描述內容", "稍後再試"]
                  : ["稍後再試"];
              return {
                reply: attachmentReply,
                actions: [],
                intent: null,
                askBeforeAct: false,
                suggestions: attachmentSuggestions,
                toolCalls: [],
                telemetry: {
                  traceId: meta.traceId,
                  planId: meta.planId,
                  taskId: null,
                  plannerStatus: meta.plannerStatus,
                  preferredEngine: meta.preferredEngine,
                  decisionMode: null,
                  riskLevel: null,
                  usedMultimodalPlanner: false,
                  durationMs: null,
                  outcome: "provider_unavailable",
                  events: telemetryEvents,
                },
                ...meta,
                taskDraft: null,
              };
            }
            const providerHealth = getProviderHealth(selection.provider.id).status;
            appendTelemetryEvent(telemetryEvents, "provider.selected", {
              providerId: selection.provider.id,
              routeIntent,
              health: providerHealth,
            });
            enginePreference = "auto";
          }
          if (!orbAgentEnabled) {
            // Kill switch active: skip all planning, return text-only via simple LLM call.
            const meta = makePlannerMeta({ plannerStatus: "agent_disabled", preferredEngine: "auto" });
            const chatOnlySystemPrompt = buildOrbSystemPrompt(input.personality, input.context ?? undefined, {
              pageSnapshot: input.pageSnapshot,
              recentFeedback: mergedFeedback,
              alwaysConfirm: false,
              assetLibrary: assetLibrarySummary,
              apiTools: [],
              userMessage: latestUserMessageText,
              recentTools: recentSpecialistTools,
              specialistHints,
            });
            const chatOnlyResult = await withTimeout(
              invokeLLM({
                messages: [
                  {
                    role: "system",
                    content: augmentSystemPromptWithResearch(chatOnlySystemPrompt),
                  },
                  ...plannerMessages,
                ],
                model: director.model,
                temperature: director.temperature,
                preferEngine: "auto",
                runName: "orb-chat-only",
                // Per-engine cap so that if the first engine hangs, OpenRouter
                // / Anthropic still get a shot before the outer 15s wrapper fires.
                timeoutMs: 6_000,
              }),
              15_000,
              "光球純聊天模式"
            );
            const chatOnlyText = extractMessageText(
              chatOnlyResult.choices[0]?.message?.content
            );
            const chatOnlyReply = chatOnlyText || "我在這裡，隨時可以聊天！";
            return {
              reply: chatOnlyReply,
              actions: [],
              intent: null,
              askBeforeAct: false,
              suggestions: [],
              toolCalls: [],
              telemetry: {
                traceId: meta.traceId,
                planId: meta.planId,
                taskId: null,
                plannerStatus: "agent_disabled",
                preferredEngine: "auto",
                decisionMode: null,
                riskLevel: null,
                usedMultimodalPlanner: false,
                durationMs: null,
                outcome: "agent_disabled",
                events: telemetryEvents,
              },
              ...meta,
              taskDraft: null,
            };
          }

          // Track planner-level failures so the legacy fallback meta can surface
          // a clear reason (instead of silently falling through). This lets ops
          // distinguish "planner threw" vs "planner returned invalid" vs
          // "planner gating disabled" from telemetry.
          let plannerExceptionReason: string | null = null;
          let plannerInvalidWarnings: string[] = [];

          if (schemaFirstPlannerEnabled && capabilityRegistryEnabled && toolRegistryEnabled) {
            let plannerResult: Awaited<ReturnType<typeof runSchemaFirstAgentPlanner>> | null = null;
            try {
              const plannerContextWithResearch = [
                input.context,
                webResearchPromptBlock || undefined,
                siteModelUsagePromptBlock || undefined,
              ]
                .filter((s): s is string => Boolean(s && s.trim()))
                .join("\n\n");
              plannerResult = await withTimeout(
              runSchemaFirstAgentPlanner({
                messages: plannerMessages,
                context: plannerContextWithResearch || undefined,
                personality: input.personality,
                pageSnapshot: (input.pageSnapshot ?? undefined) as
                  | PageAgentSnapshot
                  | undefined,
                recentFeedback: mergedFeedback as AgentFeedbackEvent[],
                recentTaskMemorySummary,
                recentOrbMemorySummary,
                siteKnowledgeSummary,
                preferences: (input.preferences ?? null) as Parameters<typeof runSchemaFirstAgentPlanner>[0]["preferences"],
                // Site-wide model usage snapshot so the planner can budget
                // generation/multimodal/code calls into stages instead of
                // emitting plans the day's quota cannot cover.
                quotaSnapshot: quotaGuardEnabled
                  ? getOrbQuotaSnapshot(ctx.user.id)
                  : null,
                invoke: async plannerInput => {
                  const preferred = plannerInput.preferEngine ?? enginePreference;
                  // Cap each engine attempt so the inner fallback chain (incl.
                  // OpenRouter) actually runs before the outer 20s wrapper fires.
                  const PLANNER_PER_ENGINE_TIMEOUT_MS = 8_000;
                  try {
                    const result = await invokeLLM({
                      ...plannerInput,
                      model: director.model,
                      temperature: director.temperature,
                      topP: director.topP,
                      systemPrompt: director.systemPrompt,
                      preferEngine: preferred,
                      timeoutMs: PLANNER_PER_ENGINE_TIMEOUT_MS,
                    });
                    if (providerRouterEnabled && preferred === "gemini") {
                      if (markProviderRecovered("gemini")) {
                        appendTelemetryEvent(telemetryEvents, "provider.recovered", {
                          providerId: "gemini",
                        });
                      }
                    }
                    return result;
                  } catch (error) {
                    if (providerRouterEnabled && preferred === "gemini") {
                      const marked = markProviderFailure("gemini", error);
                      appendTelemetryEvent(
                        telemetryEvents,
                        marked.reason === "timeout" ? "provider.timeout" : "provider.fallback_used",
                        {
                          providerId: "gemini",
                          status: marked.status,
                          reason: marked.reason ?? "invoke_failed",
                        }
                      );
                      const fallback = selectProvider({
                        intent: routeIntent,
                        riskLevel: "low",
                        preferredProviderId: "default_llm",
                      });
                      if (fallback.provider) {
                        return invokeLLM({
                          ...plannerInput,
                          model: director.model,
                          temperature: director.temperature,
                          topP: director.topP,
                          systemPrompt: director.systemPrompt,
                          preferEngine: "auto",
                          timeoutMs: PLANNER_PER_ENGINE_TIMEOUT_MS,
                        });
                      }
                    }
                    throw error;
                  }
                },
              }),
              20_000,
              "全站光球代理規劃器"
            );
            } catch (plannerError) {
              const reason =
                plannerError instanceof Error
                  ? plannerError.message
                  : String(plannerError);
              plannerExceptionReason = reason.slice(0, 240);
              appendTelemetryEvent(telemetryEvents, "planner.exception", {
                reason: plannerExceptionReason,
              });
              console.warn(
                "[Orb] Schema-first planner threw, falling back to legacy parser:",
                plannerExceptionReason
              );
              plannerResult = null;
            }

            if (plannerResult && plannerResult.status === "converted") {
              // Phase 2: modality coherence + content moderation already
              // ran inside `runSchemaFirstAgentPlanner`. The planner either
              // triggered a single-pass replan (fixing the wrong studio
              // routing) or recorded the residual mismatch in
              // `plannerResult.warnings`. Mirror those warnings into
              // telemetry here so the existing dashboards keep firing.
              for (const warning of plannerResult.warnings) {
                if (warning.startsWith("Modality replan triggered:")) {
                  appendTelemetryEvent(telemetryEvents, "orb.modality.replan", {
                    outcome: "converted",
                  });
                } else if (
                  warning.includes("使用者似乎想做") &&
                  warning.includes("但計畫卻選了")
                ) {
                  appendTelemetryEvent(telemetryEvents, "orb.modality.mismatch", {
                    outcome: "converted",
                  });
                }
              }
              const warnings = globalWorkflowsEnabled
                ? plannerResult.warnings
                : [
                    ...plannerResult.warnings,
                    "Global Agent workflows 已關閉，僅提供文字回覆。",
                  ];
              const actions = globalWorkflowsEnabled ? plannerResult.actions : [];
              const meta = makePlannerMeta({
                plannerStatus: plannerResult.status,
                plan: plannerResult.plan,
                warnings,
                preferredEngine: plannerResult.preferredEngine,
                usedMultimodalPlanner: plannerResult.usedMultimodalPlanner,
                memoryInjected: memoryContext.memoryInjected,
              });
              const moderatedReply = plannerResult.reply ?? "我已幫你整理好下一步。";
              // Gap 9: drop actions blocked for the current page in user prefs.
              const perPageFiltered = applyDisabledActionsByPage(
                actions,
                input.pageSnapshot?.pageId,
                input.preferences?.disabledActionsByPage
              );
              if (perPageFiltered.dropped.length > 0) {
                appendTelemetryEvent(telemetryEvents, "orb.per_page_action.blocked", {
                  pageId: input.pageSnapshot?.pageId ?? "",
                  dropped: perPageFiltered.dropped.join(","),
                });
                warnings.push(
                  `已依使用者頁面權限略過：${perPageFiltered.dropped.join(", ")}`
                );
              }
              return {
                reply: moderatedReply,
                actions: perPageFiltered.actions,
                intent: plannerResult.intent ?? null,
                askBeforeAct:
                  perPageFiltered.actions.length > 0 &&
                  (plannerResult.askBeforeAct ||
                    Boolean(input.alwaysConfirm && perPageFiltered.actions.length > 0)),
                suggestions: [],
                toolCalls: [],
                plannerOutput: plannerResult.rawContent ?? plannerResult.plan,
                telemetry: {
                  traceId: meta.traceId,
                  planId: meta.planId,
                  taskId: null,
                  plannerStatus: meta.plannerStatus,
                  preferredEngine: meta.preferredEngine,
                  decisionMode: plannerResult.decisionMode ?? null,
                  riskLevel: plannerResult.riskEvaluation?.riskLevel ?? null,
                  usedMultimodalPlanner: meta.usedMultimodalPlanner,
                  durationMs: null,
                  outcome: "converted",
                  events: telemetryEvents,
                },
                ...meta,
                taskDraft: null,
              };
            }

            if (plannerResult && plannerResult.status === "clarification") {
              const meta = makePlannerMeta({
                plannerStatus: plannerResult.status,
                plan: plannerResult.plan,
                warnings: plannerResult.warnings,
                preferredEngine: plannerResult.preferredEngine,
                usedMultimodalPlanner: plannerResult.usedMultimodalPlanner,
                memoryInjected: memoryContext.memoryInjected,
              });
              const clarificationQuestion =
                plannerResult.clarificationQuestion ??
                (typeof plannerResult.reply === "string" ? plannerResult.reply : undefined);
              return {
                reply: plannerResult.reply ?? "我需要先確認一個細節，才能繼續執行。",
                actions: [],
                intent: plannerResult.intent ?? null,
                // No actions to gate, just a question to answer — propagate
                // the planner's askBeforeAct verbatim instead of hardcoding.
                askBeforeAct: plannerResult.askBeforeAct ?? false,
                suggestions: [],
                toolCalls: [],
                needsClarification: true,
                clarificationQuestion,
                clarificationOptions: plannerResult.clarificationOptions,
                plannerOutput: plannerResult.rawContent ?? plannerResult.plan,
                telemetry: {
                  traceId: meta.traceId,
                  planId: meta.planId,
                  taskId: null,
                  plannerStatus: meta.plannerStatus,
                  preferredEngine: meta.preferredEngine,
                  decisionMode: plannerResult.decisionMode ?? null,
                  riskLevel: plannerResult.riskEvaluation?.riskLevel ?? null,
                  usedMultimodalPlanner: meta.usedMultimodalPlanner,
                  durationMs: null,
                  outcome: "clarification",
                  events: telemetryEvents,
                },
                ...meta,
                taskDraft: null,
              };
            }

            if (plannerResult && plannerResult.status === "blocked") {
              // Phase 2: surface in-planner moderation block as telemetry so
              // ops dashboards keep firing even when the gate moves upstream.
              for (const warning of plannerResult.warnings) {
                if (warning.startsWith("Content moderation blocked reply")) {
                  const categoriesMatch = warning.match(/categories:\s*([^)]+)/);
                  appendTelemetryEvent(telemetryEvents, "orb.moderation.flagged", {
                    action: "block",
                    categories: categoriesMatch ? categoriesMatch[1].trim() : "",
                    outcome: "blocked",
                  });
                }
              }
              const meta = makePlannerMeta({
                plannerStatus: plannerResult.status,
                plan: plannerResult.plan,
                warnings: plannerResult.warnings,
                preferredEngine: plannerResult.preferredEngine,
                usedMultimodalPlanner: plannerResult.usedMultimodalPlanner,
                memoryInjected: memoryContext.memoryInjected,
              });
              return {
                reply:
                  plannerResult.reply ??
                  "我已建立計畫，但因安全檢查暫停執行，請先確認需求後再繼續。",
                actions: [],
                intent: plannerResult.intent ?? null,
                askBeforeAct: true,
                suggestions: [],
                toolCalls: [],
                plannerOutput: plannerResult.rawContent ?? plannerResult.plan,
                telemetry: {
                  traceId: meta.traceId,
                  planId: meta.planId,
                  taskId: null,
                  plannerStatus: meta.plannerStatus,
                  preferredEngine: meta.preferredEngine,
                  decisionMode: plannerResult.decisionMode ?? null,
                  riskLevel: plannerResult.riskEvaluation?.riskLevel ?? null,
                  usedMultimodalPlanner: meta.usedMultimodalPlanner,
                  durationMs: null,
                  outcome: "blocked",
                  events: telemetryEvents,
                },
                ...meta,
                taskDraft: null,
              };
            }

            if (plannerResult && plannerResult.status === "tasked") {
              const taskDraft = plannerResult.task;
              const planRecordForCost =
                plannerResult.plan && typeof plannerResult.plan === "object"
                  ? (plannerResult.plan as Record<string, unknown>)
                  : null;
              const routingCapabilitiesForCost = Array.isArray(
                (planRecordForCost?.routing as { capabilities?: unknown[] } | undefined)
                  ?.capabilities
              )
                ? ((planRecordForCost?.routing as { capabilities?: string[] }).capabilities ??
                  [])
                : [];
              const outputKind: "text" | "image" | "video" | "audio" | "voice" | "code" | "deploy" =
                routingCapabilitiesForCost.some(cap => String(cap).includes("deploy"))
                  ? "deploy"
                  : routingCapabilitiesForCost.some(cap => String(cap).includes("github") || String(cap).includes("code"))
                  ? "code"
                  : routingCapabilitiesForCost.some(cap => String(cap).includes("video"))
                  ? "video"
                  : routingCapabilitiesForCost.some(cap => String(cap).includes("audio"))
                  ? "audio"
                  : routingCapabilitiesForCost.some(cap => String(cap).includes("image"))
                  ? "image"
                  : "text";
              const costEstimate = costGuardEnabled
                ? estimateOrbTaskCost({
                    providerId: outputKind === "code" || outputKind === "deploy" ? "claudeCode" : enginePreference,
                    modality:
                      attachmentGuard.kinds[0] && attachmentGuard.kinds[0] !== "unknown"
                        ? attachmentGuard.kinds[0]
                        : "text",
                    attachmentBytes: attachmentGuard.totalBytes,
                    attachmentCount: attachmentGuard.kinds.length,
                    expectedOutput: outputKind,
                    estimatedTokens: 9_000,
                    crossPageSteps: taskDraft?.steps.length ?? 0,
                  })
                : null;
              if (costEstimate) {
                appendTelemetryEvent(telemetryEvents, "cost.estimated", {
                  tier: costEstimate.tier,
                  reasons: costEstimate.reasons.join(","),
                });
                if (costEstimate.requiresHuman) {
                  appendTelemetryEvent(telemetryEvents, "cost.approval_required", {
                    tier: costEstimate.tier,
                  });
                }
              }
              let materializedTask: unknown = null;
              let stateMachineTask = null;
              let codeTask: unknown = null;
              let codeTaskPrompt: string | null = null;
              if (globalWorkflowsEnabled && taskDraft && orbTaskStateMachineEnabled) {
                stateMachineTask = createOrbAgentTaskFromPlanner(plannerResult, ctx.user.id);
              }
              // Always materialize a legacy orbTaskRepository record so the
              // existing reportTaskStep flow (which queries the legacy store)
              // can drive steps. When the FSM created a task we reuse its id
              // so both stores point at the same logical task; otherwise we
              // generate a new id. Without this, multi-step plans created via
              // the FSM stalled at "pending" because reportTaskStep saw a
              // missing record under the FSM id.
              if (globalWorkflowsEnabled && taskDraft) {
                try {
                  materializedTask = orbTaskRepository.create({
                    taskId: stateMachineTask?.taskId,
                    userId: ctx.user.id,
                    intent: taskDraft.intent,
                    needsApproval: taskDraft.needsApproval,
                    steps: taskDraft.steps.map(step => ({
                      id: step.id,
                      label: step.label,
                      pagePath: step.pagePath,
                      uiActions: step.uiActions,
                      toolCalls: step.toolCalls,
                    })),
                  });
                } catch (taskError) {
                  console.warn("[Orb] task materialization failed:", taskError instanceof Error ? taskError.message : String(taskError));
                }
                // Agent loop v2 — stash the planner inputs so the
                // continuation chain runner (driven by ORB_OBSERVATION_LOOP)
                // can replan with the same context if the post-mortem
                // observer says "continue". No-op when the loop flag is off.
                if (stateMachineTask?.taskId) {
                  try {
                    setOrbTaskPlannerContext(stateMachineTask.taskId, {
                      userId: ctx.user.id,
                      userRole: ctx.user.role,
                      messages: plannerMessages,
                      context: input.context,
                      personality: input.personality,
                      pageSnapshot: (input.pageSnapshot ?? null) as PageAgentSnapshot | null,
                      recentFeedback: mergedFeedback as AgentFeedbackEvent[],
                      recentTaskMemorySummary,
                      recentOrbMemorySummary,
                      siteKnowledgeSummary,
                      preferences: (input.preferences ?? null) as AgentPlannerInput["preferences"],
                    });
                  } catch (stashError) {
                    console.warn(
                      "[Orb] failed to stash planner context for continuation:",
                      stashError instanceof Error ? stashError.message : String(stashError)
                    );
                  }
                }
              }
              const planRecord =
                plannerResult.plan && typeof plannerResult.plan === "object"
                  ? (plannerResult.plan as Record<string, unknown>)
                  : null;
              const routingCapabilities = Array.isArray((planRecord?.routing as { capabilities?: unknown[] } | undefined)?.capabilities)
                ? ((planRecord?.routing as { capabilities?: string[] }).capabilities ?? [])
                : [];
              const stepToolNames = Array.isArray((planRecord?.steps as Array<{ toolName?: unknown }> | undefined))
                ? (planRecord?.steps as Array<{ toolName?: unknown }>).map(step => String(step.toolName ?? ""))
                : [];
              const codeCapabilityDetected =
                String(plannerResult.preferredEngine ?? taskDraft?.preferredEngine ?? "").toLowerCase().includes("claudecode") ||
                routingCapabilities.some(cap => ["code", "github", "deploy"].includes(String(cap))) ||
                stepToolNames.some(name => ["code.modifyWithClaudeCode", "github.pr.create", "deploy.preview"].includes(name));
              const codeCollabEnabled = isFlagEnabled(
                process.env.ENABLE_ORB_CODE_COLLABORATION ?? serverEnv.ENABLE_ORB_CODE_COLLABORATION,
                true
              );
              if (taskDraft && codeCapabilityDetected && codeCollabEnabled) {
                try {
                  if (quotaGuardEnabled) {
                    const codeQuota = checkAndConsumeQuota("code_task", {
                      userId: ctx.user.id,
                    });
                    if (!codeQuota.allowed) {
                      appendTelemetryEvent(telemetryEvents, "quota.blocked", {
                        category: codeQuota.category,
                        reason: codeQuota.reason,
                      });
                    } else {
                      appendTelemetryEvent(telemetryEvents, "quota.allowed", {
                        category: "code_task",
                      });
                    }
                    if (!codeQuota.allowed) {
                      codeTask = null;
                      codeTaskPrompt = null;
                      throw new Error("code task quota exceeded");
                    }
                  }
                  const highRisk = routingCapabilities.some(cap =>
                    ["auth", "payment", "deploy", "db", "database", "apikey", "secret", "upload", "user-data"].some(keyword =>
                      String(cap).toLowerCase().includes(keyword)
                    )
                  );
                  const provider = String(plannerResult.preferredEngine ?? taskDraft.preferredEngine ?? "claudeCode").toLowerCase().includes("codex")
                    ? "codex"
                    : "claudeCode";
                  codeTask = createOrbCodeTask({
                    taskId:
                      (stateMachineTask as { taskId?: string } | null)?.taskId ??
                      ((materializedTask as { taskId?: string } | null)?.taskId ?? taskDraft.taskId),
                    planId: typeof planRecord?.planId === "string" ? planRecord.planId : taskDraft.taskId,
                    traceId: typeof planRecord?.traceId === "string" ? planRecord.traceId : `trace_${Date.now()}`,
                    provider,
                    repository: process.env.ORB_CODE_REPOSITORY ?? "healing-studio",
                    baseBranch: process.env.ORB_CODE_BASE_BRANCH ?? "main",
                    title: taskDraft.summaryForUser.slice(0, 180),
                    objective: taskDraft.intent,
                    filesAllowed: taskDraft.steps.flatMap(step => step.pagePath ? [step.pagePath] : []),
                    filesForbidden: [".env", ".env.local", "**/secrets/**", "**/credentials/**"],
                    acceptanceCriteria: [
                      "All acceptance criteria in plan are met.",
                      "Required tests pass.",
                      "No secrets added to code/logs/memory/telemetry.",
                    ],
                    testCommands: ["npm run check", "npm test"],
                    riskLevel: highRisk ? "high" : (plannerResult.riskEvaluation?.riskLevel ?? "medium"),
                    summary: taskDraft.summaryForUser,
                    rollbackPlan: taskDraft.rollbackMode === "none" ? "Manual rollback required via git revert." : "Revert branch commits and redeploy previous healthy version.",
                  });
                  if (codeTask) {
                    const codeTaskRecord = codeTask as Parameters<typeof buildClaudeCodeTaskPrompt>[0]["codeTask"];
                    codeTaskPrompt =
                      provider === "codex"
                        ? buildCodexTaskPrompt({
                            agentPlanSummary: taskDraft.summaryForUser,
                            orbTaskSummary: taskDraft.summaryForUser,
                            codeTask: codeTaskRecord,
                            relevantFiles: codeTaskRecord.filesAllowed.slice(0, 20),
                          })
                        : buildClaudeCodeTaskPrompt({
                            agentPlanSummary: taskDraft.summaryForUser,
                            orbTaskSummary: taskDraft.summaryForUser,
                            codeTask: codeTaskRecord,
                            relevantFiles: codeTaskRecord.filesAllowed.slice(0, 20),
                          });
                  }
                } catch (codeTaskError) {
                  console.warn("[Orb] code task creation failed:", codeTaskError instanceof Error ? codeTaskError.message : String(codeTaskError));
                }
              }
              const warnings = globalWorkflowsEnabled
                ? plannerResult.warnings
                : [...plannerResult.warnings, "Global Agent workflows 已關閉，任務僅提供草稿不會執行。"];
              const meta = makePlannerMeta({
                plannerStatus: plannerResult.status,
                plan: plannerResult.plan,
                warnings,
                preferredEngine: plannerResult.preferredEngine ?? taskDraft?.preferredEngine ?? null,
                taskId:
                  (stateMachineTask?.taskId as string | undefined) ??
                  ((materializedTask as { taskId?: string } | null)?.taskId ?? null),
                usedMultimodalPlanner: plannerResult.usedMultimodalPlanner,
                memoryInjected: memoryContext.memoryInjected,
              });

              return finalizeIdempotentResponse({
                reply:
                  costEstimate?.prompt
                    ? `${plannerResult.reply ?? "我已建立任務草稿，待你確認後就可以開始執行。"}\n\n${costEstimate.prompt}`
                    : plannerResult.reply ??
                      "我已建立任務草稿，待你確認後就可以開始執行。",
                actions: [],
                intent: plannerResult.intent ?? null,
                askBeforeAct: true,
                suggestions: [],
                toolCalls: [],
                task: stateMachineTask ?? materializedTask,
                codeTask,
                codeTaskPrompt,
                taskDraft,
                plannerOutput: plannerResult.rawContent ?? plannerResult.plan,
                telemetry: {
                  traceId: meta.traceId,
                  planId: meta.planId,
                  taskId: meta.taskId,
                  plannerStatus: meta.plannerStatus,
                  preferredEngine: meta.preferredEngine,
                  decisionMode: plannerResult.decisionMode ?? null,
                  riskLevel: plannerResult.riskEvaluation?.riskLevel ?? null,
                  usedMultimodalPlanner: meta.usedMultimodalPlanner,
                  durationMs: null,
                  outcome: stateMachineTask ? stateMachineTask.status : "tasked",
                  events: telemetryEvents,
                  estimatedCostTier: costEstimate?.tier ?? null,
                },
                ...meta,
              });
            }

            // status === "invalid"（或 plannerResult 為 null）：保留既有 fallback
            // 行為，但在 telemetry 留下明確紀錄，方便運維辨別「schema-first 為何
            // 沒生效」。把 planner warnings 收集起來，下方 legacy fallback meta
            // 會合併呈現給前端。
            if (plannerResult && plannerResult.status === "invalid") {
              plannerInvalidWarnings = Array.isArray(plannerResult.warnings)
                ? plannerResult.warnings.slice(0, 8)
                : [];
              appendTelemetryEvent(telemetryEvents, "planner.invalid_fallback", {
                warningCount: plannerInvalidWarnings.length,
                rawContentLength:
                  typeof plannerResult.rawContent === "string"
                    ? plannerResult.rawContent.length
                    : 0,
                reason:
                  (plannerResult as { reason?: unknown }).reason !== undefined
                    ? String((plannerResult as { reason?: unknown }).reason).slice(0, 240)
                    : null,
              });
            }
          }

          // invalid / planner exception：維持舊版 fallback parser 流程，兼容既有 marker / JSON reply。
          const fallbackResult = await withTimeout(
            invokeLLM({
              model: director.model,
              temperature: director.temperature,
              topP: director.topP,
              systemPrompt: director.systemPrompt,
              messages: [
                { role: "system", content: augmentSystemPromptWithResearch(systemPrompt) },
                ...plannerMessages,
              ],
              preferEngine: enginePreference,
              runName: "orb-agent-chat",
              // Per-engine cap so the inner fallback chain (incl. OpenRouter)
              // gets attempted before the outer 20s wrapper times out.
              timeoutMs: 8_000,
            }),
            20_000,
            "全站光球代理"
          );
          const rawReply = extractMessageText(
            fallbackResult.choices[0]?.message?.content
          );
          if (!rawReply) {
            console.warn("[Orb] Empty LLM response, using fallback");
            const meta = makePlannerMeta({
              plannerStatus: "fallback-empty",
              preferredEngine: enginePreference,
              usedMultimodalPlanner: false,
            });
            return finalizeIdempotentResponse({
              reply: "✨ 抱歉，我暫時無法回應。稍後再試試看吧～",
              actions: [],
              intent: null,
              askBeforeAct: false,
              suggestions: [],
              toolCalls: [],
              telemetry: {
                traceId: meta.traceId,
                planId: meta.planId,
                taskId: null,
                plannerStatus: meta.plannerStatus,
                preferredEngine: meta.preferredEngine,
                decisionMode: null,
                riskLevel: null,
                usedMultimodalPlanner: false,
                durationMs: null,
                outcome: "fallback-empty",
                events: telemetryEvents,
              },
              ...meta,
              taskDraft: null,
            });
          }
          const legacy = parseOrbReply(rawReply, {
            alwaysConfirm: input.alwaysConfirm,
            userText: latestUserTextForRouting,
          });
          // Gap 17: moderate the LLM reply text before it reaches the user.
          const legacyModeration = moderateOrbContent(legacy.reply ?? "");
          if (legacyModeration.action !== "pass") {
            appendTelemetryEvent(telemetryEvents, "orb.moderation.flagged", {
              action: legacyModeration.action,
              categories: Array.from(
                new Set(legacyModeration.findings.map(f => f.category))
              ).join(","),
            });
            legacy.reply = legacyModeration.text;
            // Block strips actions too — never dispatch when moderation blocks.
            if (legacyModeration.action === "block") {
              legacy.actions = [];
            }
          }
          const legacyActionsRaw = globalWorkflowsEnabled ? legacy.actions : [];
          // Gap 9: drop disabled-for-this-page action types from the legacy
          // fallback path too. Cast: legacy.actions is the loose AgentAction
          // union; only the `type` field matters for filtering.
          const legacyPerPage = applyDisabledActionsByPage(
            legacyActionsRaw as Array<{ type: string }>,
            input.pageSnapshot?.pageId,
            input.preferences?.disabledActionsByPage
          );
          if (legacyPerPage.dropped.length > 0) {
            appendTelemetryEvent(telemetryEvents, "orb.per_page_action.blocked", {
              pageId: input.pageSnapshot?.pageId ?? "",
              dropped: legacyPerPage.dropped.join(","),
              outcome: "fallback",
            });
          }
          const legacyActions = legacyPerPage.actions as typeof legacy.actions;
          // Decide a more precise plannerStatus so ops can tell the four
          // fallback reasons apart in telemetry dashboards:
          //   - fallback-schema-disabled: env flag explicitly off
          //   - fallback-planner-error:   planner threw / timed out
          //   - fallback-legacy:          planner returned status=invalid
          //                               (or no schema-first match)
          const schemaFirstFlagsOn =
            schemaFirstPlannerEnabled && capabilityRegistryEnabled && toolRegistryEnabled;
          const fallbackPlannerStatus = !schemaFirstFlagsOn
            ? "fallback-schema-disabled"
            : plannerExceptionReason
              ? "fallback-planner-error"
              : "fallback-legacy";
          const meta = makePlannerMeta({
            plannerStatus: fallbackPlannerStatus,
            preferredEngine: enginePreference,
            warnings: [
              ...(schemaFirstPlannerEnabled ? [] : ["Schema-first planner 已關閉，使用 legacy fallback。"]),
              ...(capabilityRegistryEnabled ? [] : ["Capability registry 已關閉，使用 legacy fallback。"]),
              ...(toolRegistryEnabled ? [] : ["Tool registry 已關閉，使用 legacy fallback。"]),
              ...(globalWorkflowsEnabled ? [] : ["Global Agent workflows 已關閉，僅保留聊天回覆。"]),
              ...(plannerExceptionReason
                ? [`Schema-first planner 失敗，已改用 legacy fallback：${plannerExceptionReason}`]
                : []),
              ...plannerInvalidWarnings.map(w => `Planner invalid：${w}`),
            ],
            usedMultimodalPlanner: false,
          });
          // legacy.needsClarification was added by orbReplyParser; force askBeforeAct
          // when set so the front-end opens the ClarificationCard.
          const fallbackNeedsClarification = legacy.needsClarification === true;
          return finalizeIdempotentResponse({
            ...legacy,
            actions: fallbackNeedsClarification ? [] : legacyActions,
            askBeforeAct: fallbackNeedsClarification
              ? true
              : legacyActions.length > 0
                ? legacy.askBeforeAct
                : false,
            needsClarification: fallbackNeedsClarification,
            clarificationQuestion: legacy.clarificationQuestion,
            clarificationOptions: legacy.clarificationOptions,
            telemetry: {
              traceId: meta.traceId,
              planId: meta.planId,
              taskId: null,
              plannerStatus: meta.plannerStatus,
              preferredEngine: meta.preferredEngine,
              decisionMode: null,
              riskLevel: null,
              usedMultimodalPlanner: meta.usedMultimodalPlanner,
              durationMs: null,
              outcome: fallbackNeedsClarification ? "clarification" : "fallback",
              events: telemetryEvents,
            },
            ...meta,
            taskDraft: null,
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error("[Orb] Chat error:", errorMsg);
          const isConfigError =
            err instanceof TRPCError &&
            err.code === "SERVICE_UNAVAILABLE" &&
            /API_KEY|未設定|providerReadiness/i.test(errorMsg);
          const fallbackReply = isConfigError
            ? `🌿 ${errorMsg}`
            : "🌿 抱歉，我剛才遇到了一點小狀況。請稍等一下再試試～如果問題持續，可以在設定頁檢查 API 設定唷。";
          // Return healing-style fallback rather than crashing
          const meta = makePlannerMeta({
            plannerStatus: "fallback-error",
            preferredEngine: enginePreference,
            warnings: [errorMsg.slice(0, 240)],
            usedMultimodalPlanner: false,
          });
          return {
            reply: fallbackReply,
            actions: [],
            intent: null,
            askBeforeAct: false,
            suggestions: [],
            toolCalls: [],
            telemetry: {
              traceId: meta.traceId,
              planId: meta.planId,
              taskId: null,
              plannerStatus: meta.plannerStatus,
              preferredEngine: meta.preferredEngine,
              decisionMode: null,
              riskLevel: null,
              usedMultimodalPlanner: false,
              durationMs: null,
              outcome: "error",
              safeErrorReason: errorMsg.slice(0, 240),
              events: telemetryEvents,
            },
            ...meta,
            taskDraft: null,
          };
        }
      }),

    executeTools: brainProcedure
      .input(
        z.object({
          calls: z.array(
            z.object({
              name: z.string().min(2).max(64),
              args: z.record(z.string(), z.unknown()).optional(),
            })
          ).max(5),
          approved: z.boolean().default(false),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const tools = getOrbToolRegistry();
        const results = await executeOrbToolCalls({
          tools,
          calls: input.calls,
          userId: ctx.user.id,
          userRole: ctx.user.role,
          approved: input.approved,
          requestId: `adhoc_${ctx.user.id}_${Date.now()}`,
          onAuditEvent: event => {
            orbToolCallLogStore.append(event);
            recordToolAuditAsSpecialistInteraction(event);
          },
        });
        return { results };
      }),

    orbTask: router({
      get: brainProcedure
        .input(z.object({ taskId: z.string().min(1) }))
        .query(({ input }) => {
          return getOrbAgentTask(input.taskId);
        }),

      listRecent: brainProcedure
        .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }).optional())
        .query(({ input }) => {
          return listRecentOrbAgentTasks(input?.limit ?? 20);
        }),

      approve: brainProcedure
        .input(z.object({ taskId: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
          const executorEnabled = isFlagEnabled(
            process.env.ENABLE_ORB_TASK_EXECUTOR ?? serverEnv.ENABLE_ORB_TASK_EXECUTOR,
            true
          );
          if (!executorEnabled) return null;
          // Reject approve calls on terminal tasks. Without this guard, a
          // double-clicked approve (or a stale tab) would re-fire the
          // background driver against a `completed` / `failed` /
          // `cancelled` task — harmless to the FSM, but it confuses the
          // user-facing retry flow because the second approve "succeeds"
          // and then the retry button gets stuck (the task is already
          // terminal so no more steps run).
          const existing = getOrbAgentTask(input.taskId);
          if (existing && (
            existing.status === "completed" ||
            existing.status === "failed" ||
            existing.status === "cancelled"
          )) {
            return existing;
          }
          const fsmTask = approveOrbAgentTask(input.taskId);
          // Sync legacy store so the orchestrator (which reads task.status
          // there) sees `running` instead of `waiting_human` and can advance
          // currentStepIndex on each successful step.
          orbTaskRepository.approve(input.taskId, ctx.user.id, true);
          // Drive the whole multi-step task autonomously. We fire-and-forget
          // so the HTTP response returns the approval ack immediately while
          // the orchestrator chains studio.* / director.* tool calls in the
          // background. Front-end SSE / orbTask.events streaming surfaces
          // step progress to the UI without further user clicks — this is
          // what makes the orb a real multi-step agent instead of a per-step
          // remote control.
          void driveOrbTaskInBackground({
            taskId: input.taskId,
            userId: ctx.user.id,
            userRole: ctx.user.role,
          });
          return fsmTask;
        }),

      cancel: brainProcedure
        .input(z.object({ taskId: z.string().min(1), reason: z.string().max(240).optional() }))
        .mutation(({ input, ctx }) => {
          const executorEnabled = isFlagEnabled(
            process.env.ENABLE_ORB_TASK_EXECUTOR ?? serverEnv.ENABLE_ORB_TASK_EXECUTOR,
            true
          );
          if (!executorEnabled) return null;
          // Mirror cancellation into the legacy store so any running
          // orchestrator loop exits on its next status check.
          orbTaskRepository.approve(input.taskId, ctx.user.id, false);
          return cancelOrbAgentTask(input.taskId, input.reason ?? "cancelled by user");
        }),

      retry: brainProcedure
        .input(z.object({ taskId: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
          const executorEnabled = isFlagEnabled(
            process.env.ENABLE_ORB_TASK_EXECUTOR ?? serverEnv.ENABLE_ORB_TASK_EXECUTOR,
            true
          );
          if (!executorEnabled) return { task: null, recoveryPlan: null };
          const enableRecovery = isFlagEnabled(
            process.env.ENABLE_ORB_TASK_RECOVERY ?? serverEnv.ENABLE_ORB_TASK_RECOVERY,
            true
          );
          const result = retryOrbAgentTask(input.taskId, { enableRecovery });
          // Re-arm the autonomous driver after retry too.
          orbTaskRepository.approve(input.taskId, ctx.user.id, true);
          void driveOrbTaskInBackground({
            taskId: input.taskId,
            userId: ctx.user.id,
            userRole: ctx.user.role,
          });
          return result;
        }),

      events: brainProcedure
        .input(z.object({ taskId: z.string().min(1) }))
        .query(({ input }) => {
          return getOrbAgentTaskEvents(input.taskId);
        }),

      // Agent loop v5 — client posts a structured page-state snapshot
      // here whenever a PageAgent action handler returns `data` while a
      // task is being followed. The observer reads the buffer at
      // post-mortem time so its prompt sees what the destination page
      // actually looks like (was the prompt filled? which model? did
      // generation succeed?). Off-band from the FSM audit log on
      // purpose: this is a "what does the world look like" snapshot,
      // not a "what did I do" event.
      //
      // Agent loop v10 — verify caller owns the taskId before
      // accepting the snapshot. Without this a malicious user could
      // pollute another user's task state (taskIds are guessable in
      // shape `orb_task_<ts>_<rand>`). We allow legacy tasks without a
      // recorded userId through unchanged so existing flows that
      // pre-date user scoping don't suddenly start failing.
      reportPageState: brainProcedure
        .input(
          z.object({
            taskId: z.string().min(1).max(72),
            pageId: z.string().min(1).max(64).optional(),
            actionType: z.string().min(1).max(48).optional(),
            summary: z.string().max(240).optional(),
            // Cap the JSON payload defensively so a chatty page
            // handler can't blow up the in-memory buffer.
            state: z
              .record(z.string(), z.unknown())
              .refine(v => JSON.stringify(v).length <= 4_000, {
                message: "page state payload exceeds 4 kB",
              }),
          })
        )
        .mutation(({ input, ctx }) => {
          const fsmTask = getOrbAgentTask(input.taskId);
          if (
            fsmTask &&
            typeof fsmTask.userId === "number" &&
            fsmTask.userId !== ctx.user.id
          ) {
            return { ok: false as const, reason: "not-your-task" };
          }
          appendOrbTaskPageState(input.taskId, {
            at: Date.now(),
            pageId: input.pageId,
            actionType: input.actionType,
            summary: input.summary,
            state: input.state,
          });
          return { ok: true as const };
        }),

      completeStep: brainProcedure
        .input(z.object({ taskId: z.string().min(1), stepId: z.string().min(1) }))
        .mutation(({ input }) => {
          const executorEnabled = isFlagEnabled(
            process.env.ENABLE_ORB_TASK_EXECUTOR ?? serverEnv.ENABLE_ORB_TASK_EXECUTOR,
            true
          );
          if (!executorEnabled) return null;
          return completeOrbAgentStep(input.taskId, input.stepId);
        }),

      failStep: brainProcedure
        .input(z.object({ taskId: z.string().min(1), stepId: z.string().min(1), reason: z.string().min(1).max(240) }))
        .mutation(({ input }) => {
          const executorEnabled = isFlagEnabled(
            process.env.ENABLE_ORB_TASK_EXECUTOR ?? serverEnv.ENABLE_ORB_TASK_EXECUTOR,
            true
          );
          if (!executorEnabled) return null;
          return failOrbAgentStep(input.taskId, input.stepId, input.reason);
        }),


      updateStepStatus: brainProcedure
        .input(
          z.object({
            taskId: z.string().min(1),
            stepId: z.string().min(1),
            status: z.enum(["completed", "failed"]),
            reason: z.string().max(240).optional(),
          })
        )
        .mutation(({ input }) => {
          const executorEnabled = isFlagEnabled(
            process.env.ENABLE_ORB_TASK_EXECUTOR ?? serverEnv.ENABLE_ORB_TASK_EXECUTOR,
            true
          );
          if (!executorEnabled) return null;
          if (input.status === "completed") {
            return completeOrbAgentStep(input.taskId, input.stepId);
          }
          return failOrbAgentStep(input.taskId, input.stepId, input.reason ?? "step failed");
        }),

      memoryRecent: brainProcedure
        .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }).optional())
        .query(({ input }) => getRecentOrbTaskMemory(input?.limit ?? 10)),
      traceDebug: brainProcedure
        .input(z.object({ taskId: z.string().min(1), limit: z.number().int().min(1).max(500).default(200) }))
        .query(({ input }) => {
          const task = getOrbAgentTask(input.taskId);
          if (!task) return { task: null, events: [], chainEvents: [] };
          const events = getOrbAgentTaskEvents(input.taskId).slice(-input.limit);
          const traceId = task.traceId;
          const chainEvents = getRecentOrbTaskMemory(500)
            .filter(evt => evt.traceId === traceId || evt.taskId === input.taskId)
            .slice(0, input.limit);
          return { task, events, chainEvents };
        }),
    }),

    orbMemory: router({
      recent: brainProcedure
        .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }).optional())
        .query(({ input, ctx }) => {
          const enabled = isFlagEnabled(
            process.env.ENABLE_ORB_LONG_TERM_MEMORY ?? serverEnv.ENABLE_ORB_LONG_TERM_MEMORY,
            true
          );
          if (!enabled) return [];
          return getRecentOrbMemories({ userId: ctx.user.id, limit: input?.limit ?? 10 });
        }),
      search: brainProcedure
        .input(z.object({ query: z.string().min(1).max(120), limit: z.number().int().min(1).max(50).default(10) }))
        .query(({ input, ctx }) => {
          const enabled = isFlagEnabled(
            process.env.ENABLE_ORB_LONG_TERM_MEMORY ?? serverEnv.ENABLE_ORB_LONG_TERM_MEMORY,
            true
          );
          if (!enabled) return [];
          return searchOrbMemoriesWithRag({ userId: ctx.user.id, query: input.query, limit: input.limit });
        }),
      clearForUser: brainProcedure
        .mutation(({ ctx }) => {
          const enabled = isFlagEnabled(
            process.env.ENABLE_ORB_LONG_TERM_MEMORY ?? serverEnv.ENABLE_ORB_LONG_TERM_MEMORY,
            true
          );
          if (!enabled) return { removed: 0 };
          return { removed: clearOrbMemoryForUser({ userId: ctx.user.id }) };
        }),
      deleteOne: brainProcedure
        .input(z.object({ memoryId: z.string().min(1) }))
        .mutation(({ input, ctx }) => {
          const enabled = isFlagEnabled(
            process.env.ENABLE_ORB_LONG_TERM_MEMORY ?? serverEnv.ENABLE_ORB_LONG_TERM_MEMORY,
            true
          );
          if (!enabled) return { ok: false };
          return { ok: deleteOrbMemory(input.memoryId, { userId: ctx.user.id }) };
        }),
      plannerSummary: brainProcedure
        .query(({ ctx }) => {
          const enabled = isFlagEnabled(
            process.env.ENABLE_ORB_LONG_TERM_MEMORY ?? serverEnv.ENABLE_ORB_LONG_TERM_MEMORY,
            true
          );
          if (!enabled) return "Long-term memory disabled.";
          return summarizeOrbMemoriesForPlanner({ userId: ctx.user.id, limit: 10 });
        }),
    }),

    codeTask: router({
      get: brainProcedure
        .input(z.object({ codeTaskId: z.string().min(1) }))
        .query(({ input }) => getCodeTask(input.codeTaskId)),
      listRecent: brainProcedure
        .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }).optional())
        .query(({ input }) => listRecentCodeTasks(input?.limit ?? 20)),
      approve: brainProcedure
        .input(z.object({ codeTaskId: z.string().min(1) }))
        .mutation(({ input }) => approveCodeTask(input.codeTaskId)),
      cancel: brainProcedure
        .input(z.object({ codeTaskId: z.string().min(1), reason: z.string().max(240).optional() }))
        .mutation(({ input }) => cancelCodeTask(input.codeTaskId, input.reason)),
      attachPr: brainProcedure
        .input(z.object({ codeTaskId: z.string().min(1), prUrl: z.string().url() }))
        .mutation(({ input }) => attachCodeTaskPr(input.codeTaskId, input.prUrl)),
      markRunning: brainProcedure
        .input(z.object({ codeTaskId: z.string().min(1) }))
        .mutation(({ input }) => markCodeTaskRunning(input.codeTaskId)),
      markReviewRequired: brainProcedure
        .input(z.object({ codeTaskId: z.string().min(1), testsSummary: z.string().max(500).optional() }))
        .mutation(({ input }) => markCodeTaskReviewRequired(input.codeTaskId, input.testsSummary)),
      markMerged: brainProcedure
        .input(z.object({ codeTaskId: z.string().min(1), commitSha: z.string().max(64).optional() }))
        .mutation(({ input }) => markCodeTaskMerged(input.codeTaskId, input.commitSha)),
      markFailed: brainProcedure
        .input(z.object({ codeTaskId: z.string().min(1), reason: z.string().min(1).max(500) }))
        .mutation(({ input }) => markCodeTaskFailed(input.codeTaskId, input.reason)),
      buildHandoffPrompt: brainProcedure
        .input(
          z.object({
            codeTaskId: z.string().min(1),
            plannerSummary: z.string().max(2000).default(""),
            orbTaskSummary: z.string().max(2000).default(""),
            relevantFiles: z.array(z.string().max(240)).max(100).optional(),
          })
        )
        .query(({ input }) => {
          const codeTask = getCodeTask(input.codeTaskId);
          if (!codeTask) return null;
          if (codeTask.provider === "codex") {
            return buildCodexTaskPrompt({
              agentPlanSummary: input.plannerSummary,
              orbTaskSummary: input.orbTaskSummary,
              codeTask,
              relevantFiles: input.relevantFiles,
            });
          }
          return buildClaudeCodeTaskPrompt({
            agentPlanSummary: input.plannerSummary,
            orbTaskSummary: input.orbTaskSummary,
            codeTask,
            relevantFiles: input.relevantFiles,
          });
        }),
      telemetryRecent: brainProcedure
        .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
        .query(({ input }) => getCodeTaskTelemetry(input?.limit ?? 100)),
    }),
  }),

  // ─── Orb Memory（Phase 3c：光球跨 session 長期記憶） ──────────────────────
  //
  // 前端 `PageAgentContext.reportFeedback` 會把使用者對光球建議的反應
  // （accepted / edited / cancelled / completed / failed）寫進 DB，
  // 下一次 ai.chat 會把這些記憶補進 system prompt，讓 LLM 學偏好。
  orbMemory: router({
    append: brainProcedure
      .input(
        z.object({
          status: z.enum([
            "accepted",
            "edited",
            "cancelled",
            "completed",
            "failed",
          ]),
          actionType: z.string().max(32),
          pageId: z.string().max(64).optional(),
          note: z.string().max(512).optional(),
          actionSummary: z.string().max(256).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        await db.appendOrbFeedback({
          userId: ctx.user.id,
          status: input.status,
          actionType: input.actionType,
          pageId: input.pageId ?? null,
          note: input.note ?? null,
          actionSummary: input.actionSummary ?? null,
        });
        return { ok: true as const };
      }),

    recent: protectedProcedure
      .input(
        z
          .object({
            limit: z.number().int().min(1).max(50).default(20),
          })
          .optional()
      )
      .query(async ({ input, ctx }) => {
        const rows = await db.getRecentOrbFeedback(
          ctx.user.id,
          input?.limit ?? 20
        );
        return rows.map(r => ({
          id: r.id,
          at: r.createdAt.getTime(),
          status: r.status,
          actionType: r.actionType,
          note: r.note ?? undefined,
          pageId: r.pageId ?? undefined,
          actionSummary: r.actionSummary ?? undefined,
        }));
      }),

    delete: brainProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const deleted = await db.deleteOrbFeedbackEvent(ctx.user.id, input.id);
        return { ok: deleted > 0, deleted };
      }),

    clear: brainProcedure
      .input(
        z
          .object({
            pageId: z.string().max(64).optional(),
            actionType: z.string().max(32).optional(),
            beforeAt: z.number().int().optional(),
          })
          .optional()
      )
      .mutation(async ({ input, ctx }) => {
        const deleted = await db.clearOrbFeedbackEvents(ctx.user.id, {
          pageId: input?.pageId,
          actionType: input?.actionType,
          beforeAt: input?.beforeAt ? new Date(input.beforeAt) : undefined,
        });
        return { ok: true as const, deleted };
      }),
  }),

  // ─── OrbGuide（Phase 3d-hybrid：規則 skeleton + LLM 軟化/補選項/跳題） ────
  //
  // OrbGuidePanel 每走到一題就呼叫 step 一次，讓 MiniMax M2.7 把開場白
  // 軟化、視情境補選項、必要時建議跳題。LLM 任何異常 → 回空，前端就會
  // 繼續用規則端的 stock text，不影響流程。
  orbGuide: router({
    step: protectedProcedure
      .input(
        z.object({
          intent: z.string().min(1).max(32),
          intentLabel: z.string().min(1).max(40),
          targetLabel: z.string().min(1).max(40),
          personality: z
            .enum(["calm", "creative", "technical"])
            .default("creative"),
          answeredSoFar: z
            .array(
              z.object({
                questionId: z.string().max(32),
                value: z.string().max(64),
                label: z.string().max(32).optional(),
              })
            )
            .max(8)
            .default([]),
          currentQuestion: z
            .object({
              id: z.string().max(32),
              stockText: z.string().max(120),
              stockOptions: z
                .array(
                  z.object({
                    label: z.string().max(24),
                    value: z.string().max(64),
                    emoji: z.string().max(4),
                  })
                )
                .max(8),
            })
            .optional(),
          isFinalStep: z.boolean().default(false),
          stockOrbMessage: z.string().max(160).optional(),
          stockPromptHint: z.string().max(320).optional(),
        })
      )
      .mutation(async ({ input }) => {
        // 需求調整：光球助手優先走 Gemini API，失敗或未設定則自動降級。
        const enginePreference = "gemini" as const;

        const ctx: OrbGuideStepContext = {
          intent: input.intent,
          intentLabel: input.intentLabel,
          targetLabel: input.targetLabel,
          personality: input.personality,
          answeredSoFar: input.answeredSoFar,
          currentQuestion: input.currentQuestion,
          isFinalStep: input.isFinalStep,
          stockOrbMessage: input.stockOrbMessage,
          stockPromptHint: input.stockPromptHint,
        };

        const systemPrompt = buildOrbGuideStepPrompt(ctx);

        try {
          const result = await withTimeout(
            invokeLLM({
              messages: [
                { role: "system", content: systemPrompt },
                {
                  role: "user",
                  content: "請只回 JSON，欄位照規格。",
                },
              ],
              preferEngine: enginePreference,
              runName: "orb-guide-step",
              maxTokens: 512,
              response_format: { type: "json_object" },
            }),
            8_000,
            "光球引導"
          );
          const raw = extractMessageText(result.choices[0]?.message?.content);
          return parseOrbGuideStepReply(raw, ctx);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn("[OrbGuide] step rewrite failed, falling back:", msg);
          // 回空物件 → 前端會沿用 stock
          return {};
        }
      }),
  }),

  // ─── Subscription Plans ───────────────────────────────────────────────────

  plans: router({
    list: publicProcedure.query(async () => {
      return db.getActivePlans();
    }),

    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return db.getPlanById(input.id);
      }),
  }),
  // ─── Custom Blocks ─────────────────────────────────────────────────────────

  customBlocks: router({
    list: protectedProcedure
      .input(z.object({ modality: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        return db.getCustomBlocksByUser(ctx.user.id, input?.modality);
      }),

    create: protectedProcedure
      .input(
        z.object({
          modality: z.enum(["image", "video", "audio", "voice"]),
          category: z.string().min(1),
          label: z.string().min(1).max(128),
          prompt: z.string().min(1).max(512),
          emoji: z.string().max(8).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const id = await db.createCustomBlock({
          userId: ctx.user.id,
          modality: input.modality,
          category: input.category,
          label: input.label,
          prompt: input.prompt,
          emoji: input.emoji,
        });
        return { id };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.deleteCustomBlock(input.id, ctx.user.id);
        return { success: true };
      }),
  }),

  // ─── Block Combos ──────────────────────────────────────────────────────────

  blockCombos: router({
    list: protectedProcedure
      .input(z.object({ modality: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        return db.getBlockCombosByUser(ctx.user.id, input?.modality);
      }),

    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1).max(255),
          modality: z.enum(["image", "video", "audio", "voice"]),
          blockIds: z.array(z.string()),
          customBlockIds: z.array(z.number()).optional(),
          vibeCardIds: z.array(z.string()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const id = await db.createBlockCombo({
          userId: ctx.user.id,
          name: input.name,
          modality: input.modality,
          blockIds: input.blockIds,
          customBlockIds: input.customBlockIds,
          vibeCardIds: input.vibeCardIds,
        });
        return { id };
      }),

    rename: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().min(1).max(255),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await db.renameBlockCombo(input.id, ctx.user.id, input.name);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.deleteBlockCombo(input.id, ctx.user.id);
        return { success: true };
      }),
  }),

  // ─── Admin Dashboard ────────────────────────────────────────────────────────

  admin: router({
    allUsers: adminProcedure.query(async () => {
      return db.getAllUsers();
    }),

    updateQuota: adminProcedure
      .input(
        z.object({
          userId: z.number(),
          amount: z.number().min(0),
        })
      )
      .mutation(async ({ input }) => {
        await db.updateUserQuota(input.userId, input.amount);
        return { success: true };
      }),

    updateAutoCreditPolicy: adminProcedure
      .input(
        z.object({
          userId: z.number(),
          enabled: z.boolean(),
          amount: z.number().int().min(0).max(100000),
          intervalDays: z.number().int().min(1).max(365),
          nextAt: z.coerce.date().optional(),
        })
      )
      .mutation(async ({ input }) => {
        await db.updateUserAutoCreditPolicy({
          userId: input.userId,
          enabled: input.enabled,
          amount: input.amount,
          intervalDays: input.intervalDays,
          nextAt: input.nextAt,
        });
        return { success: true };
      }),

    runAutoCreditNow: adminProcedure.mutation(async () => {
      const result = await db.runDueAutoCreditGrant(500);
      return { success: true, ...result };
    }),

    usageLogs: adminProcedure
      .input(z.object({ limit: z.number().default(100) }))
      .query(async ({ input }) => {
        return db.getAllUsageLogs(input.limit);
      }),

    teamCostSummary: adminProcedure.query(async () => {
      return db.getTeamCostSummary();
    }),

    // ── New Admin Endpoints ──────────────────────────────────────────────────

    /** System-wide statistics overview */
    systemStats: adminProcedure.query(async () => {
      return db.getSystemStats();
    }),

    /** Update user role (admin/user) */
    updateRole: adminProcedure
      .input(
        z.object({
          userId: z.number(),
          role: z.enum(["user", "admin"]),
        })
      )
      .mutation(async ({ input }) => {
        await db.updateUserRole(input.userId, input.role);
        return { success: true };
      }),

    /** All generation history across all users */
    allGenerationHistory: adminProcedure
      .input(z.object({ limit: z.number().default(200) }))
      .query(async ({ input }) => {
        return db.getAllGenerationHistory(input.limit);
      }),

    /** Per-user activity summary */
    userActivity: adminProcedure.query(async () => {
      return db.getUserActivitySummary();
    }),

    /** API provider usage breakdown */
    apiProviderBreakdown: adminProcedure.query(async () => {
      return db.getApiProviderBreakdown();
    }),

    /** Daily system usage trend (last 30 days) */
    systemDailyTrend: adminProcedure
      .input(z.object({ days: z.number().default(30) }))
      .query(async ({ input }) => {
        return db.getSystemDailyTrend(input.days);
      }),

    /** All background jobs for monitoring */
    allBackgroundJobs: adminProcedure
      .input(z.object({ limit: z.number().default(100) }))
      .query(async ({ input }) => {
        return db.getAllBackgroundJobs(input.limit);
      }),

    /** API keys configuration status (no secrets exposed — only boolean isSet) */
    apiKeysStatus: adminProcedure.query(async () => {
      // SECURITY: Only report whether keys are set via boolean flag.
      // NEVER return env[k.name] values directly — only Boolean(truthy check).
      const env = process.env;
      const keys = [
        { name: "GEMINI_API_KEY", label: "Gemini LLM", module: "LLM 主引擎" },
        { name: "FAL_API_KEY", label: "Fal.ai", module: "圖片/影片生成" },
        {
          name: "REPLICATE_API_TOKEN",
          label: "Replicate",
          module: "LoRA 模型訓練",
        },
        { name: "ELEVENLABS_API_KEY", label: "ElevenLabs", module: "語音合成" },
        { name: "SUNO_API_KEY", label: "Suno", module: "音樂生成" },
        { name: "PINECONE_API_KEY", label: "Pinecone", module: "RAG 記憶系統" },
        { name: "NEWS_API_KEY", label: "NewsAPI", module: "新聞資料" },
        { name: "NEWSDATA_API_KEY", label: "NewsData.io", module: "新聞資料" },
        { name: "LANGSMITH_API_KEY", label: "LangSmith", module: "AI 監控" },
        { name: "GCS_BUCKET_NAME", label: "GCS Storage", module: "媒體儲存" },
        { name: "S3_ENDPOINT", label: "S3/R2 Storage", module: "S3 儲存" },
        { name: "GOOGLE_CLIENT_ID", label: "Google OAuth", module: "登入認證" },
        { name: "DATABASE_URL", label: "MySQL Database", module: "資料庫" },
      ];
      return keys.map(k => ({
        name: k.name,
        label: k.label,
        module: k.module,
        isSet: Boolean(env[k.name] && env[k.name]!.trim().length > 0),
      }));
    }),
  }),

  // ─── User Profile & Settings ───────────────────────────────────────────────

  profile: router({
    updateQuotaJson: protectedProcedure
      .input(
        z.object({
          image: z.number().min(0),
          video: z.number().min(0),
          audio: z.number().min(0),
          voice: z.number().min(0),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await db.updateUserQuotaJson(ctx.user.id, input);
        return { success: true };
      }),

    updateOnboarding: protectedProcedure
      .input(z.object({ done: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await db.updateUserOnboarding(ctx.user.id, input.done);
        return { success: true };
      }),
  }),

  // ─── System Settings ──────────────────────────────────────────────────────

  settings: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const settings = await db.getSystemSettings(ctx.user.id);
      if (!settings) {
        // Return sensible defaults if no row exists yet
        return {
          uiTheme: "system" as const,
          accentColor: "violet",
          fontScale: "medium" as const,
          reducedMotion: false,
          sidebarCollapsed: false,
          analyticsConsent: false,
          crashReportConsent: false,
          shareUsageData: false,
          showProfilePublicly: false,
          autoBackupEnabled: true,
          backupFrequency: "weekly" as const,
          backupRetentionDays: 30,
          lastBackupAt: null,
          defaultModality: "image" as const,
          defaultCreativeMode: "balanced" as const,
          autoSaveHistory: true,
          nsfwFilter: true,
          emailNotifications: true,
          generationCompleteNotify: true,
          weeklyDigestEnabled: false,
          locale: "zh-TW",
          timezone: "Asia/Taipei",
          extraSettings: null,
        };
      }
      return settings;
    }),

    update: protectedProcedure
      .input(
        z.object({
          uiTheme: z.enum(["system", "light", "dark"]).optional(),
          accentColor: z.string().max(32).optional(),
          fontScale: z.enum(["small", "medium", "large"]).optional(),
          reducedMotion: z.boolean().optional(),
          sidebarCollapsed: z.boolean().optional(),
          analyticsConsent: z.boolean().optional(),
          crashReportConsent: z.boolean().optional(),
          shareUsageData: z.boolean().optional(),
          showProfilePublicly: z.boolean().optional(),
          autoBackupEnabled: z.boolean().optional(),
          backupFrequency: z.enum(["daily", "weekly", "monthly"]).optional(),
          backupRetentionDays: z.number().min(1).max(365).optional(),
          defaultModality: z
            .enum(["image", "video", "audio", "voice"])
            .optional(),
          defaultCreativeMode: z
            .enum(["balanced", "creative", "precise"])
            .optional(),
          autoSaveHistory: z.boolean().optional(),
          nsfwFilter: z.boolean().optional(),
          emailNotifications: z.boolean().optional(),
          generationCompleteNotify: z.boolean().optional(),
          weeklyDigestEnabled: z.boolean().optional(),
          locale: z.string().max(16).optional(),
          timezone: z.string().max(64).optional(),
          extraSettings: z.record(z.string(), z.unknown()).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const id = await db.upsertSystemSettings(ctx.user.id, input);
        return { id, success: true };
      }),
  }),

  // ─── User Dashboard ───────────────────────────────────────────────────────

  dashboard: router({
    myStats: protectedProcedure.query(async ({ ctx }) => {
      const [costSummary, recentLogs, modalityBreakdown, dailyTrend] =
        await Promise.all([
          db.getUserCostSummary(ctx.user.id),
          db.getUsageLogsByUser(ctx.user.id, 10),
          db.getUserModalityBreakdown(ctx.user.id),
          db.getUserDailyTrend(ctx.user.id),
        ]);
      return {
        remainingGenerations: ctx.user.remainingGenerations,
        ...costSummary,
        recentLogs,
        modalityBreakdown: modalityBreakdown.map(r => ({
          requestType: r.requestType,
          count: r.count,
          totalCost: parseFloat(r.totalCost || "0"),
        })),
        dailyTrend: dailyTrend.map(r => ({
          date: r.date,
          count: r.count,
          totalCost: parseFloat(r.totalCost || "0"),
          totalTokens: r.totalTokens,
        })),
      };
    }),

    myUsageLogs: protectedProcedure
      .input(z.object({ limit: z.number().default(50) }))
      .query(async ({ ctx, input }) => {
        return db.getUsageLogsByUser(ctx.user.id, input.limit);
      }),

    /**
     * Phase 4b — AI insights derived from the same usage data myStats returns.
     * Pure logic lives in shared/dashboard-insights.ts so it's identical when
     * surfaced in the UI card and when fed into the Orb assistant context.
     */
    insights: protectedProcedure.query(async ({ ctx }) => {
      const [costSummary, modalityBreakdown, providerBreakdown, dailyTrend] =
        await Promise.all([
          db.getUserCostSummary(ctx.user.id),
          db.getUserModalityBreakdown(ctx.user.id),
          db.getUserProviderBreakdown(ctx.user.id),
          db.getUserDailyTrend(ctx.user.id),
        ]);
      return computeDashboardInsights({
        remainingGenerations: ctx.user.remainingGenerations,
        totalRequests: costSummary.totalRequests,
        totalCost: costSummary.totalCost,
        modalityBreakdown: modalityBreakdown.map(r => ({
          requestType: r.requestType,
          count: r.count,
          totalCost: parseFloat(r.totalCost || "0"),
        })),
        providerBreakdown: providerBreakdown.map(r => ({
          apiProvider: r.apiProvider,
          count: r.count,
          totalCost: parseFloat(r.totalCost || "0"),
          successCount: r.successCount,
          failedCount: r.failedCount,
        })),
        dailyTrend: dailyTrend.map(r => ({
          date: r.date,
          count: r.count,
          totalCost: parseFloat(r.totalCost || "0"),
          totalTokens: r.totalTokens,
        })),
      });
    }),
  }),

  // ─── LangSmith 深度整合（AI 監控儀表板）─────────────────────────────────────
  langsmith: langsmithRouter,
});

export type AppRouter = typeof appRouter;
