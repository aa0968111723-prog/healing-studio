import { z } from "zod";
import { router, protectedProcedure, brainProcedure } from "../_core/trpc";
import { isDemoMode } from "../_core/googleAuth";
import * as db from "../db";
import {
  invokeLLM,
  extractMessageText,
  extractMessageJson,
  LLMPermanentError,
  type Message,
} from "../_core/llm";
import { serverEnv } from "../_core/env.validated";
import { isFlagEnabled } from "../_core/flags";
import {
  ensureFalApiKeyConfigured,
  ensureGeminiApiKeyConfigured,
  isGeminiEngine,
} from "../_core/apiGuards";
import { featureFlags } from "../_core/featureFlags";
import { tryConsumeChatToken } from "../_core/rateLimiter";
import { signWebhookToken } from "../_core/webhookTokens";
import { TRPCError } from "@trpc/server";
import { buildMemoryContext, upsertMemory } from "../services/ragMemory";
import {
  guardCreativeMemoryContext,
  guardOrbMemorySummary,
} from "../services/security/ragInjectionGuard";
import { buildOrbSystemPrompt, type OrbPromptExtras } from "../services/siteKnowledge";
import { parseOrbReply } from "../services/orbReplyParser";
import { executeGenerateImage, executeOrbTask } from "../services/orbTaskExecutor";
import { sanitizeOrbMessages } from "../../shared/orb-prompt-defense";
import { moderateOrbContent } from "../../shared/orb-content-moderation";
import { executeOrbToolCalls } from "../services/agentToolExecutor";
import { getOrbToolRegistry } from "../config/orbToolRegistry";
import { orbTaskRepository } from "../repositories/orbTaskRepository";
import { executeCurrentStepTools, runOrbTaskToCompletion } from "../services/orbTaskOrchestrator";
import { loadAgentPreferencesForUser } from "../services/agentPreferenceService";
import { orbToolCallLogStore } from "../services/orbToolCallLogStore";
import {
  runSchemaFirstAgentPlanner,
  runSchemaFirstAgentPlannerWithCritique,
  type AgentPlannerInput,
} from "../services/agentPlanner";
import { runOrbTaskWithContinuationLoop } from "../services/orbTaskChainRunner";
import { runOrbTaskWithOptionalMultiAgent, isMultiAgentRoutingEnabled } from "../services/multiAgentIntegration";
import { getOrbTaskPlannerContext } from "../services/orbTaskPlannerContextStore";
import { setOrbTaskPlannerContext } from "../services/orbTaskPlannerContextStore";
import { appendOrbTaskPageState } from "../services/orbTaskPageStateStore";
import { orbTaskTracer } from "../services/orbTaskTracer";
import { createReplanCallback, type ReplanCallbackContext } from "../services/orbTaskReplanIntegration";
import {
  getRecentSpecialistTools,
  getSpecialistMemoryHints,
  recordToolAuditAsSpecialistInteraction,
} from "../services/specializedAgentMemoryStore";
import { getAggregatedPicksForPrompt } from "../services/agentModelPicks";
import { getOrbMemorySummary, upsertOrbMemory } from "../services/orbUserMemory";
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
} from "../services/orbTaskStateMachine";
import {
  getRecentOrbTaskMemory,
  summarizeRecentOrbTaskMemoryForPlanner,
} from "../services/orbTaskMemory";
import {
  buildOrbMemorySummaryForPlanner,
  clearOrbMemoryForUser,
  deleteOrbMemory,
  getRecentOrbMemories,
  recordOrbMemory,
  searchOrbMemoriesWithRag,
  summarizeOrbMemoriesForPlanner,
} from "../services/orbMemory";
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
} from "../services/orbCodeTask";
import {
  buildClaudeCodeTaskPrompt,
  buildCodexTaskPrompt,
} from "../../shared/orb-code-task";
import {
  aggregatePreferenceProfile,
  extractOrbPreferencesFromConversation,
  summarizeSiteKnowledgeForPlanner,
  summarizeRecentMemoryForPlanner,
} from "../../shared/orb-memory";
import {
  OrbStartTaskInputSchema,
  OrbApproveTaskInputSchema,
  OrbApproveStepInputSchema,
  OrbStepReportInputSchema,
} from "../../shared/orb-agent-contract";
import {
  mergeFeedbackHistories,
  type AgentFeedbackEvent,
  type PageAgentSnapshot,
} from "../../shared/agent-actions";
import { extractJsonObjectFromText } from "../../shared/agent-plan-adapter";
import { OrbChatRouterMessageSchema } from "../../shared/orb-chat-multimodal";
import {
  buildOrbReasoningChain,
  type OrbReasoningChain,
} from "../../shared/orb-reasoning";
import { selectProvider, type ProviderRouteIntent } from "../services/providerRouter";
import {
  selectRoleForIntent,
  getPreferredProviderForRole,
  composeRoleChain,
  getPrimaryNicknameForRole,
  pickDefaultPathForRole,
  type AgentRole,
} from "../../shared/orb-agent-roles";
import {
  getProviderHealth,
  markProviderFailure,
  markProviderRecovered,
} from "../services/providerHealth";
import { estimateOrbTaskCost } from "../services/orbCostGuard";
import { checkAndConsumeQuota, getOrbQuotaSnapshot } from "../services/orbQuota";
import {
  buildOrbIdempotencyKey,
  checkAndLock,
  findDuplicateTask,
  getResult,
  releaseRequestLock,
  rememberTaskKey,
  storeResult,
} from "../services/orbIdempotency";
import {
  clearOrbChatProgress,
  emitOrbChatProgress,
  readOrbChatProgress,
} from "../services/orbChatProgress";
import { validateAttachmentGuards } from "../services/orbAttachmentGuard";
import {
  countPdfAttachments,
  extractPdfAttachmentsToText,
} from "../services/orbAttachmentExtraction";
import {
  runOrbWebResearch,
  runOrbDeepSearch,
  classifyOrbResearchIntent,
} from "../services/orbWebResearch";
import { analyzeOrbPromptForContextLookup } from "../services/orbContextLookup";
import { buildCreativeModelHintsBlock } from "../services/orbCreativeModelHints";
import {
  deriveOrbArcState,
  serializeArcStateForPrompt,
} from "../../shared/orb-arc-state";
import { inferModalityFromText } from "../../shared/orb-clarification-options";
import { getOrchestrator } from "../services/modelClients";
import { normalizeEngineModelId } from "../../shared/engineModelIds";
import {
  estimatePoints,
  getModelPricing,
} from "../services/modelPricing";
import {
  dispatchImageGeneration,
  dispatchVideoGeneration,
  dispatchAudioGeneration,
  dispatchTTS,
  resolveFalEnginesFromRow,
  dispatchFalQueueTask,
} from "../services/falDispatcher";
import { withTimeout } from "../services/director/templates";
import { orbMemoryRouter } from "./orbMemory";
import {
  ORB_AUTO_DRIVER_STALE_MS,
  orbAutoDriverInFlight,
  TASK_TYPE_LABEL,
  isOrbAutoDriverInFlight,
  driveOrbTaskInBackground,
  pickReasoningSlotForOrbChat,
  applyDisabledActionsByPage,
  sanitizeTelemetryValue,
  appendTelemetryEvent,
  classifyOrbChatErrorReply,
} from "./_aiHelpers";

export const aiRouter = router({
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
            // Phase 3: stay-on-page execution mode. When true the client
            // auto-approves tasked plans whose risk fits the user's
            // allowedRiskLevels and lets `orbTask.approve` drive the
            // generation server-side; the user keeps their current page.
            stayOnPageMode: z.boolean().optional(),
            // Phase D wiring — the agent-preferences page has had these
            // toggles for a while but nothing read them. Threading them
            // through here lets `runSchemaFirstAgentPlannerWithCritique`
            // actually fire when the user opts in.
            criticEnabled: z.boolean().optional(),
            criticRefineBelow: z.number().int().min(0).max(100).optional(),
            // Phase D — when false the chat router skips
            // selectRoleForIntent + skill-block injection. Defaults to
            // true matching DEFAULT_AGENT_PREFERENCES.
            roleAutoSwitch: z.boolean().optional(),
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
      const chatStartedAt = Date.now();
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

      // AIDV-215: per-user 20 RPM guard — express-rate-limit can't see
      // ctx.user at the Express middleware layer for tRPC routes, so we
      // enforce the limit here, after brainProcedure has authenticated.
      if (!tryConsumeChatToken(ctx.user.id)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many chat requests. Please wait 1 minute before sending more messages.",
        });
      }

      // 進度時間軸的第一站。需要在精靈挑選 / 網路研究之前就發,否則時間
      // 軸看起來會像「網路研究做完才開始收訊」— 從使用者角度看是亂序。
      emitOrbChatProgress(idempKey, "received", "收到請求");

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
                .filter(
                  (part): part is { type: "text"; text: string } =>
                    part.type === "text"
                )
                .map(part => part.text)
                .join("\n")
            : "";
      // 使用者靜音的精靈 — 從 preferences 拿，selectRoleForIntent 會跳過。
      const mutedSpiritsForSelection = (
        (input.preferences as { mutedSpirits?: string[] } | undefined)?.mutedSpirits ?? []
      ).filter((s): s is string => typeof s === "string") as readonly AgentRole[];
      // `roleAutoSwitch=false` lets a user lock the orb to its default
      // companion persona — useful for users who find the spirit chip
      // hopping around distracting. Defaults to true (matches
      // DEFAULT_AGENT_PREFERENCES) so no behaviour change for users who
      // have not visited the settings page.
      const roleAutoSwitchEnabled =
        (input.preferences as { roleAutoSwitch?: boolean } | undefined)?.roleAutoSwitch !== false;
      const spiritSelection =
        roleAutoSwitchEnabled && lastUserTextForSpirit
          ? selectRoleForIntent({
              text: lastUserTextForSpirit,
              // zod 推出的 capability.action 是 string，PageAgentSnapshot
              // 期望 AgentActionType union — 與既有 6509 / 6873 等呼叫處
              // 相同處理，cast 一次即可。
              snapshot: (input.pageSnapshot ?? null) as
                | PageAgentSnapshot
                | null,
              turnCount: input.messages.length,
              mutedRoles: mutedSpiritsForSelection,
            })
          : null;
      // 「協作團隊」：除了當回合領頭精靈以外，後續會接手的角色（例：
      // 導導 → 編編 → 品品）。前端 OrbThinkingStepsPanel 把這份名單渲染成
      // 多顆 chip，讓使用者看到 15 精靈不是一個人在思考，是團隊在排隊接手。
      // 沒選到精靈時就空陣列，panel 自動省略。
      const spiritTeam: AgentRole[] =
        roleAutoSwitchEnabled && lastUserTextForSpirit
          ? composeRoleChain({
              text: lastUserTextForSpirit,
              // 與上方 selectRoleForIntent 同步使用同一份 snapshot；型別在這層
              // 寬鬆，TS 無感報 mismatch（同 5637 的 pre-existing 警告），
              // 因為共享層宣告比 trpc input 嚴格。執行時兩邊一致。
              snapshot: (input.pageSnapshot ?? null) as PageAgentSnapshot | null,
              turnCount: input.messages.length,
              mutedRoles: mutedSpiritsForSelection,
            })
          : [];
      const spiritTeamNicknames = spiritTeam
        .map(role => getPrimaryNicknameForRole(role))
        .join(" → ");

      // 精靈派工進度。spiritSelection 為 null 時(roleAutoSwitch=false 或
      // 抓不到 lastUserText)就不發 — 不要顯示「召喚 default」這種空字。
      // M4: 只顯示 lead spirit 的召喚事件。chain 純粹是 UI suggestion,
      // 顯示「召喚 導導→編編→品品」會讓使用者誤以為 3 位精靈會輪流真
      // 接手,事實上 executor 只跑 lead。
      if (spiritSelection) {
        const leadNickname = getPrimaryNicknameForRole(spiritSelection.role);
        emitOrbChatProgress(
          idempKey,
          "calling_specialist",
          `召喚 ${leadNickname}`,
          {
            role: spiritSelection.role,
            confidence: spiritSelection.confidence,
            teamSize: spiritTeam.length,
            // 建議協作鏈進 detail,監控可看「使用者實際走完整 chain 的比例」
            suggestedChain: spiritTeam.length > 1 ? spiritTeamNicknames : undefined,
          }
        );
      }

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
          // 思考步驟 fallback intent 用：當 schema-first planner 失敗時，
          // 從這條使用者訊息合成「使用者訊息：…」一行，避免「辨識脈絡」整段空白。
          if (
            typeof latestUserTextForRouting === "string" &&
            latestUserTextForRouting.trim() &&
            r.userMessage === undefined
          ) {
            r.userMessage = latestUserTextForRouting;
          }
          // 「協作團隊」一併掛上：思考步驟面板在 sections 增加一條
          // 「召喚協作精靈」section 用這個欄位，多精靈協作不再只是文件描述。
          if (spiritTeam.length > 0 && r.spiritTeam === undefined) {
            r.spiritTeam = spiritTeam;
            r.spiritTeamLabel = spiritTeamNicknames;
          }
          // 思考步驟：把 planner artefacts + 進度 ring buffer 合成「思考步驟」面板需要的結構，
          // 讓客戶端 OrbThinkingStepsPanel 不必再去 reverse-engineer 回應的 shape。
          // 任何 return 路徑（converted / clarification / fallback-llm / fallback-error）
          // 只要還沒手動塞 reasoningChain，這裡都會自動補上。
          if (r.reasoningChain === undefined) {
            const reasoningPayload = buildOrbReasoningChainFromResult(
              r,
              idempKey,
              chatStartedAt
            );
            if (reasoningPayload) r.reasoningChain = reasoningPayload;
          }
          enriched = r;
        }
        if (idempKey) {
          storeResult(idempKey, enriched);
          idempotencyFinalized = true;
          // Final progress beacon so the client's polling loop sees a
          // terminal event before clearOrbChatProgress wipes the bucket.
          emitOrbChatProgress(idempKey, "finalizing", "整理回應…");
        }
        void (async () => {
          try {
            // 每次 ai.chat 回覆後，把最近 5 條訊息 + 本次回覆濃縮成短摘要，存入 users.orbMemorySummary。
            // 這份摘要會在下一次請求時注入 buildOrbSystemPrompt 的 context。
            const replyText =
              result &&
              typeof result === "object" &&
              "reply" in result &&
              typeof (result as { reply?: unknown }).reply === "string"
                ? ((result as { reply: string }).reply ?? "").trim()
                : "";
            if (!replyText) return;
            const recentMessages = input.messages.slice(-5).map(message => {
              const text =
                typeof message.content === "string"
                  ? message.content
                  : Array.isArray(message.content)
                    ? message.content
                        .filter(part => part.type === "text")
                        .map(part => part.text)
                        .join("\n")
                    : "";
              return `${message.role}: ${text}`;
            });
            recentMessages.push(`orb: ${replyText}`);
            const summaryResult = await invokeLLM({
              model: "gpt-4o-mini",
              temperature: 0.2,
              preferEngine: "auto",
              messages: [
                {
                  role: "system",
                  content: "請將對話濃縮成繁體中文 50 字內摘要，只輸出摘要文字。",
                },
                { role: "user", content: recentMessages.join("\n") },
              ],
              runName: "orb-user-memory-summary",
              timeoutMs: 6_000,
            });
            const summary = extractMessageText(summaryResult.choices[0]?.message?.content).trim();
            if (summary) await upsertOrbMemory(ctx.user.id, summary);
          } catch (error) {
            // L7 修復:長期 memory summary 失敗只 console.warn,跨會話偷
            // 偷壞掉很難察覺。發 telemetry 讓監控可以 alert。
            console.warn("[Orb] failed to update user memory summary:", error);
            appendTelemetryEvent(telemetryEvents, "orb.memory.summary_failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })();
        return enriched;
      };

      /**
       * Walks a chat-handler result object and pulls out the
       * planner-y bits (intent, plan steps, warnings, summaryForUser, …)
       * we need to feed `buildOrbReasoningChain`. Tolerates every shape
       * the various return paths emit — converted, clarification,
       * fallback-llm, fallback-error.
       */
      const buildOrbReasoningChainFromResult = (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        r: any,
        requestId: string | undefined,
        startedAt: number
      ): OrbReasoningChain | null => {
        const planRecord =
          r?.plan && typeof r.plan === "object"
            ? (r.plan as Record<string, unknown>)
            : r?.plannerOutput && typeof r.plannerOutput === "object"
              ? (r.plannerOutput as Record<string, unknown>)
              : null;
        // Schema-first 計畫成功 → 直接拿 plan.intent；fallback 路徑 LLM
        // 沒帶 [INTENT:...] 時 intent 會是 null，這時 panel 的「辨識脈絡」
        // 整段就會被 buildReasoningSectionsFromPlan 跳過，使用者看不到任何
        // 真實思考線索。退而求其次，從 spiritSelection rationale + 最近的
        // user prompt 合成一條，至少讓「為什麼挑這位精靈接手」可見。
        const rationaleStr =
          typeof r?.agentRoleRationale === "string" && r.agentRoleRationale.trim()
            ? r.agentRoleRationale.trim()
            : null;
        const userMessageStr =
          typeof r?.userMessage === "string" && r.userMessage.trim()
            ? r.userMessage.trim()
            : null;
        const synthesizedIntent =
          rationaleStr || userMessageStr
            ? [
                userMessageStr ? `使用者訊息：「${userMessageStr.slice(0, 120)}${userMessageStr.length > 120 ? "…" : ""}」` : null,
                rationaleStr ? `判定原因：${rationaleStr}` : null,
              ]
                .filter(Boolean)
                .join("\n")
            : null;
        const intent =
          typeof r?.intent === "string" && r.intent.trim()
            ? r.intent
            : typeof planRecord?.intent === "string" && (planRecord.intent as string).trim()
              ? (planRecord.intent as string)
              : synthesizedIntent;
        const summaryForUser =
          typeof planRecord?.summaryForUser === "string"
            ? (planRecord.summaryForUser as string)
            : typeof r?.reply === "string"
              ? r.reply
              : null;
        const rawSteps = Array.isArray(planRecord?.steps)
          ? (planRecord!.steps as Array<Record<string, unknown>>)
          : [];
        const steps = rawSteps
          .map(s => ({
            label: typeof s?.label === "string" ? (s.label as string) : "",
            rationale:
              typeof s?.rationale === "string" ? (s.rationale as string) : null,
          }))
          .filter(s => s.label.trim().length > 0);
        const warnings = Array.isArray(r?.warnings)
          ? (r.warnings as unknown[]).filter(
              (w): w is string => typeof w === "string" && w.trim().length > 0
            )
          : Array.isArray(planRecord?.warnings)
            ? (planRecord.warnings as unknown[]).filter(
                (w): w is string => typeof w === "string" && w.trim().length > 0
              )
            : [];
        const events = requestId ? readOrbChatProgress(requestId, 0) : [];
        const preferredEngine =
          typeof r?.preferredEngine === "string"
            ? (r.preferredEngine as string)
            : typeof r?.telemetry?.preferredEngine === "string"
              ? (r.telemetry.preferredEngine as string)
              : null;
        const modelLabel = preferredEngine
          ? `引擎：${preferredEngine}`
          : undefined;
        // 「召喚協作精靈」— composeRoleChain 算出來的建議協作順序。
        // M4 修正(部分):原本寫成「接手團隊:A→B→C(共 N 位精靈接力)」
        // 這個措辭隱含「執行端會輪流叫每位精靈」,但事實上 executor 只
        // 跑 head spirit;chain 純粹是 UI 顯示,後續 spirit 不會真接手。
        // 改成「建議協作順序」+「目前由 X 主答」明示「這是建議流程,不
        // 是會自動接力」,使用者不會誤以為被代理。
        // 真正的多 spirit 接力需要 plan-step / per-step owner 改造,
        // 列在 H6+M4 architectural backlog,本回不做。
        const teamLabel =
          typeof r?.spiritTeamLabel === "string" && r.spiritTeamLabel.trim()
            ? r.spiritTeamLabel.trim()
            : null;
        const teamMemberCount = Array.isArray(r?.spiritTeam)
          ? r.spiritTeam.length
          : 0;
        const leadNickname = spiritSelection
          ? getPrimaryNicknameForRole(spiritSelection.role)
          : null;
        const enrichedWarnings =
          teamLabel && teamMemberCount > 1
            ? [
                `建議協作順序:${teamLabel}${leadNickname ? `(目前由 ${leadNickname} 主答,其他精靈待你呼叫)` : "(僅作建議)"}`,
                ...warnings,
              ]
            : warnings;
        return buildOrbReasoningChain({
          plan: {
            intent,
            summaryForUser,
            steps,
            warnings: enrichedWarnings,
            reply: r?.reply,
          },
          events,
          modelLabel,
          durationMs: Date.now() - startedAt,
          plannerStatus:
            typeof r?.plannerStatus === "string" ? r.plannerStatus : null,
        });
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
      // AIDV-69：memoryContext.summary 由 buildOrbMemorySummaryForPlanner 從 RAG
      // 檢索的歷史記憶序列化而成（使用者衍生、untrusted、可能被注入污染後回灌）。
      // 此值同源於 orbTaskChainRunner.ts 的 replan 路徑（已接 guard），但這是**主**
      // per-turn planner 路徑：下方傳入 runSchemaFirstAgentPlanner / ...WithCritique
      // （routers.ts:7711）並 stash 給後續 continuation（8143），最終於
      // agentPlanner.ts contextBlock 以 role:'system' 注入 LLM。旗標 ON 時先過 guard
      // 包裹（與 orbTaskChainRunner.ts label「歷史記憶」一致）；旗標 OFF＝賦值與
      // 現狀**位元相同**。
      const recentOrbMemorySummary = guardOrbMemorySummary(
        memoryContext.summary
      );
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
          // L7 修復:recordOrbMemory 內部會 OrbMemorySchema.parse,parse
          // 失敗會 throw,沒 try/catch 會冒泡到外層 catch 讓整個聊天回應
          // 退化為 fallback-error。包起來確保 schema 漂移不影響使用者
          // 看到實際回覆。
          try {
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
          } catch (error) {
            console.warn("[Orb] recordOrbMemory failed:", error);
            appendTelemetryEvent(telemetryEvents, "orb.memory.record_failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
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
      // 同時拉 agent_model_picks 的聚合（讓導演 / 工作室寫過的 modelId
      // 出現在 planner 的偏好模型區塊）。三者並行，每一支回傳空值都合法。
      const [recentSpecialistTools, specialistHints, agentModelPicks] =
        await Promise.all([
          getRecentSpecialistTools(ctx.user.id, 5),
          getSpecialistMemoryHints(ctx.user.id),
          getAggregatedPicksForPrompt(ctx.user.id),
        ]);

      const persistedOrbMemorySummary = await getOrbMemorySummary(ctx.user.id);

      // 全站光球世界觀感知：若前端在 pageSnapshot.state 帶來
      // currentCreativeProjectId / currentWorldFrameworkId，拉取對應
      // 世界觀的壓縮摘要注入系統提示，讓光球能基於該專案個人化回應。
      let worldContextBlock: string | undefined;
      try {
        const snapshotState = (input.pageSnapshot?.state ?? null) as
          | Record<string, unknown>
          | null;
        const worldFrameworkId = snapshotState?.currentWorldFrameworkId;
        if (typeof worldFrameworkId === "number" && worldFrameworkId > 0) {
          const wb = await db.getWorldbuildingFramework(worldFrameworkId);
          if (wb && wb.userId === ctx.user.id) {
            const projectName =
              typeof snapshotState?.currentWorldFrameworkName === "string"
                ? snapshotState.currentWorldFrameworkName
                : wb.name;
            const charSummary = Array.isArray(wb.charactersJson)
              ? (wb.charactersJson as Array<Record<string, unknown>>)
                  .slice(0, 8)
                  .map(c => {
                    const name = typeof c.name === "string" ? c.name : null;
                    const role = typeof c.role === "string" ? c.role : null;
                    return name
                      ? role
                        ? `${name}（${role}）`
                        : name
                      : null;
                  })
                  .filter(Boolean)
                  .join("、")
              : "";
            const sceneSummary = Array.isArray(wb.scenesJson)
              ? (wb.scenesJson as Array<Record<string, unknown>>)
                  .slice(0, 6)
                  .map(s => (typeof s.name === "string" ? s.name : null))
                  .filter(Boolean)
                  .join("、")
              : "";
            worldContextBlock = [
              `【當前世界觀：${projectName}】`,
              wb.description ? wb.description : null,
              charSummary ? `主要角色：${charSummary}` : null,
              sceneSummary ? `主要場景：${sceneSummary}` : null,
              wb.globalNegativePrompt
                ? `全域 negative prompt：${wb.globalNegativePrompt}`
                : null,
            ]
              .filter((s): s is string => Boolean(s && s.trim()))
              .join("\n");
          }
        }
      } catch {
        // 世界觀摘要拉取失敗不應該阻擋對話 — 安靜略過。
      }

      const mergedPromptContext = [
        input.context,
        worldContextBlock,
        persistedOrbMemorySummary
          ? `【使用者短期記憶摘要】\n${persistedOrbMemorySummary}`
          : undefined,
      ]
        .filter((s): s is string => Boolean(s && s.trim()))
        .join("\n\n");
      const stayOnPageModeFromInput = Boolean(
        (input.preferences as { stayOnPageMode?: boolean } | undefined)?.stayOnPageMode
      );
      const systemPrompt = buildOrbSystemPrompt(
        input.personality,
        mergedPromptContext || undefined,
        {
          pageSnapshot: input.pageSnapshot,
          recentFeedback: mergedFeedback,
          alwaysConfirm: input.alwaysConfirm,
          stayOnPageMode: stayOnPageModeFromInput,
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
          agentModelPicks,
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
      // 「搜尋網路中…」只在真的會搜尋時才發。flag 開但 intent classifier
      // 判定 skipped (空 / 太長 / in-app 命令 / 不像查詢) 時不發,
      // 否則使用者看到 emoji 但 server 其實沒搜,是誤導。
      if (webResearchEnabled) {
        const intent = classifyOrbResearchIntent(latestUserTextForRouting);
        if (intent.shouldSearch) {
          emitOrbChatProgress(idempKey, "researching_web", "搜尋網路中…", {
            intent: intent.reason,
            explicit: intent.isExplicitSearch,
          });
        }
      }

      // ── Proper-noun context lookup ────────────────────────────────────
      // Before the classifier-based web research fires, ask a fast LLM
      // whether the user message contains niche proper nouns (school
      // clubs, local brands, niche events) that warrant a background
      // lookup — covers the "淡大禪學社" case where the user wants help
      // brainstorming a video for a subject the planner has no prior on.
      // Runs in parallel with the existing research call so latency is
      // bounded by the slower path, not the sum of both.
      //
      // Skip when the latest user text is a wizard answer ([使用者澄清/X]:
      // markers): the analysis re-detects the original proper noun anyway
      // (which we already searched on turn 1) and the in-memory cache
      // would dedupe but only when the exact prompt repeats — wizard
      // answers are different strings, so the cache misses. Cheap regex
      // guard saves the 4s LLM call on every clarification round.
      const isFollowupClarificationAnswer = /\[使用者澄清/.test(
        latestUserTextForRouting
      );
      const shouldRunContextLookup =
        webResearchEnabled &&
        Boolean(latestUserTextForRouting?.trim()) &&
        !isFollowupClarificationAnswer;
      if (shouldRunContextLookup) {
        emitOrbChatProgress(idempKey, "analyzing_terms", "辨識專有名詞中…");
      }
      const contextLookupAnalysisPromise = shouldRunContextLookup
        ? analyzeOrbPromptForContextLookup(latestUserTextForRouting, {
            userId: ctx.user.id,
          })
        : Promise.resolve(null);
      const webResearchOutcomePromise = runOrbWebResearch(
        latestUserTextForRouting,
        {
          enabled: webResearchEnabled,
          // Planner-driven path (schema-first agent planner): use the
          // lean "agent" formatting so the LLM does not collapse the
          // reply into a "步驟 1 / 步驟 2 ... 從哪步開始？" wall of text
          // that conflicts with the planner's clarification / tasked
          // commitment. Legacy fallback can still call the qna shape.
          mode: "agent",
          // H2 修復:沒帶 userId 時 perplexity / brave 節流會以全站 bucket
          // 計算,單一惡意帳號連發「幫我搜尋 X」可把全站額度燒光。帶上
          // ctx.user.id 後節流改為 per-user,惡意者只能燒自己那份。
          userId: ctx.user.id,
        }
      );
      const [contextLookupAnalysis, webResearchOutcome] = await Promise.all([
        contextLookupAnalysisPromise,
        webResearchOutcomePromise,
      ]);

      // Fire a deep search using the detected proper nouns when the
      // analysis matched. This is only used when the classifier-based
      // research did NOT already pick up the topic — we treat it as a
      // complementary background block (separate header), never as a
      // replacement.
      // Telemetry every outcome so we can dashboard hit / miss / cache /
      // error rates instead of inferring from request volume.
      if (contextLookupAnalysis) {
        appendTelemetryEvent(telemetryEvents, "orb.context_lookup.outcome", {
          reason: contextLookupAnalysis.reason,
          terms: contextLookupAnalysis.terms,
          shouldLookup: contextLookupAnalysis.shouldLookup,
        });
      } else if (isFollowupClarificationAnswer) {
        appendTelemetryEvent(telemetryEvents, "orb.context_lookup.outcome", {
          reason: "skipped:followup_clarification",
          terms: [],
          shouldLookup: false,
        });
      }
      let contextLookupResearch: Awaited<ReturnType<typeof runOrbDeepSearch>> | null = null;
      if (
        contextLookupAnalysis?.shouldLookup &&
        contextLookupAnalysis.terms.length > 0
      ) {
        appendTelemetryEvent(telemetryEvents, "orb.context_lookup.matched", {
          terms: contextLookupAnalysis.terms,
          rationale: contextLookupAnalysis.rationale,
        });
        emitOrbChatProgress(
          idempKey,
          "researching_web",
          `搜尋背景：${contextLookupAnalysis.terms.join("、")}`,
          {
            intent: "context_lookup",
            terms: contextLookupAnalysis.terms,
          }
        );
        try {
          contextLookupResearch = await runOrbDeepSearch(
            contextLookupAnalysis.terms.join(" "),
            {
              userId: ctx.user.id,
              maxResults: 5,
              mode: "agent",
            }
          );
        } catch (err) {
          console.warn("[orb] context-lookup deep search failed:", err);
          contextLookupResearch = null;
        }
      }
      if (webResearchOutcome.reason === "matched" || webResearchOutcome.reason === "matched:explicit_search" || webResearchOutcome.reason === "matched:deep_search") {
        appendTelemetryEvent(telemetryEvents, "orb.web_research.hit", {
          results: webResearchOutcome.results.length,
          reason: webResearchOutcome.reason,
          hasDeepSearch: !!webResearchOutcome.deepSearchResult,
        });
      } else if (webResearchOutcome.reason === "error") {
        appendTelemetryEvent(telemetryEvents, "orb.web_research.error", {});
      }
      // Merge: context-lookup block goes FIRST (it primes the planner with
      // "you saw 淡大禪學社, here's what it is"); classifier-based block
      // follows. When neither produced a block, this stays empty.
      const contextLookupPromptBlock =
        contextLookupResearch?.promptBlock && contextLookupAnalysis
          ? [
              `【主題背景研究 / Context Lookup】偵測到使用者提到「${contextLookupAnalysis.terms.join("、")}」— ${contextLookupAnalysis.rationale || "已即時抓取背景"}。`,
              "請在回覆開頭用 1-2 句中文確認你理解的主題（不要照抄事實/維基條目），再進入下一個澄清問題。",
              contextLookupResearch.promptBlock,
            ].join("\n")
          : "";
      const webResearchPromptBlock = [
        contextLookupPromptBlock,
        webResearchOutcome.promptBlock ?? "",
      ]
        .filter(s => s && s.trim().length > 0)
        .join("\n\n");
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
      const webResearchSources = [
        ...(contextLookupResearch?.results ?? []),
        ...webResearchOutcome.results,
      ].map(r => ({
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

      // F1 fix: track whether finalizeIdempotentResponse ever ran so the
      // outer finally can release the in-progress lock for early-return
      // paths (attachment too large, quota limited, provider unavailable,
      // agent disabled, etc.). Without this release, a retry with the
      // same x-request-id was stuck on "in-progress" for 60 s.
      let idempotencyFinalized = false;

      // Phase-1 multi-step thinking UX: emit milestones to a per-request
      // ring buffer so the client can poll `ai.chatProgress` and render
      // an inline timeline during the otherwise-opaque planning window.
      // `received` 已經在 handler 前段(精靈/網路研究之前)發過了,這裡
      // 不重發以免時間軸出現兩顆「收到請求」。

      try {
        emitOrbChatProgress(idempKey, "sanitizing", "檢查訊息中…");
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
        let plannerMessages = sanitizationResult.messages;
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

        emitOrbChatProgress(idempKey, "guarding_attachments", "檢查附件中…");
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
          return finalizeIdempotentResponse({
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
          });
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
            return finalizeIdempotentResponse({
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
            });
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
            return finalizeIdempotentResponse({
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
            });
          }
        }

        // PDF wins (needs supportsPdf), then any image/audio/video forces
        // multimodal. Text-kind attachments (legacy docx file_url replayed
        // from history) don't need a multimodal model — they route through
        // the regular text planner because their bytes can be inlined.
        const hasBinaryKind = attachmentGuard.kinds.some(
          kind => kind === "image" || kind === "audio" || kind === "video"
        );
        let routeIntent: ProviderRouteIntent = attachmentGuard.kinds.includes("pdf")
          ? "planner_pdf"
          : hasBinaryKind
          ? "planner_multimodal"
          : "planner_text";
        // 15 精靈 (6 通用 + 6 專精 + 3 主動)：spiritSelection 已在 handler 頂部算好（finalize 也會用），
        // 這裡只把它對應的 preferredProvider 餵給 selectProvider。
        const spiritPreferredProvider = spiritSelection
          ? getPreferredProviderForRole(spiritSelection.role)
          : undefined;
        if (providerRouterEnabled) {
          emitOrbChatProgress(idempKey, "selecting_provider", "選擇模型中…", {
            routeIntent,
            spirit: spiritSelection?.role,
            // M4: 建議協作順序(暱稱串)— 注意這是顯示用建議,executor
            // 目前只跑 head spirit,後續 spirit 不會自動接手。
            ...(spiritTeam.length > 0
              ? { 建議協作順序: spiritTeamNicknames }
              : {}),
          });
          let selection = selectProvider({
            intent: routeIntent,
            riskLevel: "low",
            preferredProviderId: spiritPreferredProvider,
          });
          // Server-side fallback: when no multimodal provider is healthy
          // (typically GEMINI_API_KEY missing) but the user only attached
          // PDF(s), extract the text ourselves so a plain text-only LLM
          // (default_llm) can still answer about the script. This is the
          // difference between "all features work" and "please paste it".
          if (
            !selection.provider &&
            routeIntent === "planner_pdf" &&
            countPdfAttachments(plannerMessages as Message[]) > 0
          ) {
            emitOrbChatProgress(idempKey, "extracting_pdf", "讀取 PDF 內文中…");
            const extraction = await extractPdfAttachmentsToText(
              plannerMessages as Message[]
            );
            appendTelemetryEvent(telemetryEvents, "pdf_attachment.server_extracted", {
              extractedCount: extraction.extractedCount,
              failedCount: extraction.failedCount,
              hasUnextractableBinary: extraction.hasUnextractableBinary,
            });
            if (extraction.injectionTriggers.length > 0) {
              appendTelemetryEvent(
                telemetryEvents,
                "pdf_attachment.injection_redacted",
                { triggers: extraction.injectionTriggers.join(",") }
              );
            }
            // Surface partial failures as a separate warning event so
            // ops dashboards can alert on a sustained `failed_count`
            // climb (e.g. unpdf regression, scanned-PDF spike).
            if (extraction.failedCount > 0) {
              appendTelemetryEvent(
                telemetryEvents,
                "pdf_attachment.extract_failed",
                {
                  failedCount: extraction.failedCount,
                  extractedCount: extraction.extractedCount,
                }
              );
            }
            if (extraction.extractedCount > 0 && !extraction.hasUnextractableBinary) {
              plannerMessages = extraction.messages as unknown as typeof plannerMessages;
              routeIntent = "planner_text";
              selection = selectProvider({
                intent: routeIntent,
                riskLevel: "low",
                preferredProviderId: spiritPreferredProvider,
              });
            }
          }
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
            return finalizeIdempotentResponse({
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
            });
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
            agentModelPicks,
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
          return finalizeIdempotentResponse({
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
          });
        }

        // Track planner-level failures so the legacy fallback meta can surface
        // a clear reason (instead of silently falling through). This lets ops
        // distinguish "planner threw" vs "planner returned invalid" vs
        // "planner gating disabled" from telemetry.
        let plannerExceptionReason: string | null = null;
        let plannerInvalidWarnings: string[] = [];

        if (schemaFirstPlannerEnabled && capabilityRegistryEnabled && toolRegistryEnabled) {
          emitOrbChatProgress(idempKey, "planning", "規劃步驟中…", {
            spirit: spiritSelection?.role,
            // 同 selecting_provider — 把整條接手鏈帶過來，panel 上就能看到
            // 「導導 → 編編 → 品品」這種多精靈協作時序。
            ...(spiritTeam.length > 0
              ? { 接手團隊: spiritTeamNicknames }
              : {}),
          });
          let plannerResult: Awaited<ReturnType<typeof runSchemaFirstAgentPlanner>> | null = null;
          try {
            // ── Brainstorming arc state ────────────────────────────────
            // For creative projects (video / script), derive which of the
            // 6 arc steps we're at from the conversation so far, and
            // serialize it into a short prompt block. This gives the
            // planner a deterministic "you're at step 3, ask modality
            // bundle next" anchor — the LLM otherwise tends to skip
            // ahead or re-ask dimensions on every turn.
            // Image / audio / lora / research / unknown skip the block;
            // their flows don't benefit from the arc.
            // Infer modality from the WHOLE conversation, not just the
            // latest message. A wizard answer like "30 秒" or "招生宣傳"
            // doesn't carry modality keywords on its own, so reading only
            // the latest message would flip arcModality to "unknown" and
            // silently drop the arc mid-conversation. Concatenating all
            // user turns preserves the original "影片 / video / 短片"
            // signal until the user explicitly switches topic.
            const aggregatedUserTextForArc = input.messages
              .filter(m => m.role === "user")
              .map(m => {
                if (typeof m.content === "string") return m.content;
                if (!Array.isArray(m.content)) return "";
                return m.content
                  .filter((part): part is { type: "text"; text: string } =>
                    part.type === "text"
                  )
                  .map(part => part.text)
                  .join(" ");
              })
              .filter(Boolean)
              .join(" ");
            const arcModality = inferModalityFromText(
              aggregatedUserTextForArc || latestUserTextForRouting
            );
            // Filter to the three roles deriveOrbArcState understands.
            // The orb chat schema also carries tool / function frames
            // in advanced cases; without the filter their content shape
            // would leak into extractText and corrupt gate detection.
            const arcMessages = input.messages
              .filter(m => m.role === "user" || m.role === "assistant" || m.role === "system")
              .map(m => ({
                role: m.role as "user" | "assistant" | "system",
                content: m.content,
              }));
            const arcStateBlock =
              arcModality === "video" || arcModality === "script"
                ? serializeArcStateForPrompt(
                    deriveOrbArcState({
                      messages: arcMessages,
                      modality: arcModality,
                      hasContextBlock: Boolean(contextLookupResearch?.promptBlock),
                    })
                  )
                : "";
            // ── Creative model hints ───────────────────────────────────
            // Pin the planner's step-6 recommendation to real catalog
            // entries (no Veo 17 hallucinations). Static block; could be
            // cached at module init but it's cheap to rebuild and lets
            // us evolve the catalog without restart.
            const creativeModelHintsBlock = buildCreativeModelHintsBlock();
            const plannerContextWithResearch = [
              input.context,
              webResearchPromptBlock || undefined,
              siteModelUsagePromptBlock || undefined,
              arcStateBlock || undefined,
              creativeModelHintsBlock || undefined,
            ]
              .filter((s): s is string => Boolean(s && s.trim()))
              .join("\n\n");
            if (arcStateBlock) {
              appendTelemetryEvent(telemetryEvents, "orb.arc_state.injected", {
                modality: arcModality,
              });
            }
            // Honour the user's saved `criticEnabled` / `criticRefineBelow`
            // preferences. When critic is enabled, we switch to the
            // critique-aware planner — it runs the regular planner first,
            // scores the draft, and (when score < refineBelow OR there are
            // hard blockers) issues a single refine pass before returning.
            // Defaults preserved when prefs are absent: critic OFF, refine
            // threshold 75 — same numbers as `DEFAULT_AGENT_PREFERENCES`.
            const criticEnabledFromPrefs = Boolean(
              (input.preferences as { criticEnabled?: boolean } | undefined)?.criticEnabled
            );
            const criticRefineBelowFromPrefs =
              (input.preferences as { criticRefineBelow?: number } | undefined)?.criticRefineBelow;
            const plannerEntry = criticEnabledFromPrefs
              ? runSchemaFirstAgentPlannerWithCritique
              : runSchemaFirstAgentPlanner;
            plannerResult = await withTimeout(
            plannerEntry({
              enableCritique: criticEnabledFromPrefs,
              critiqueRefineBelow:
                typeof criticRefineBelowFromPrefs === "number" ? criticRefineBelowFromPrefs : undefined,
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
            let convertedReply = moderatedReply;
            let convertedActions = perPageFiltered.actions;
            const generateAction = convertedActions.find(
              action => (action as { type?: string }).type === "execute_generate_image"
            ) as { type: string; payload?: string; prompt?: string; model?: string } | undefined;
            if (generateAction) {
              // M12: 圖像生成可能跑數十秒,執行前 emit milestone 讓使用者
              // 看得到「不是卡住,正在執行」。沒這個的話,materializing_task
              // 之後到 finalizing 之間時間軸完全靜默。
              emitOrbChatProgress(idempKey, "executing_tool", "執行圖像生成…", {
                tool: "execute_generate_image",
                model:
                  typeof generateAction.model === "string"
                    ? generateAction.model
                    : undefined,
              });
              try {
                const imagePrompt =
                  (typeof generateAction.prompt === "string" && generateAction.prompt.trim()) ||
                  (typeof generateAction.payload === "string" && generateAction.payload.trim()) ||
                  latestUserTextForRouting;
                const imageUrl = await executeGenerateImage(
                  String(ctx.user.id),
                  imagePrompt,
                  typeof generateAction.model === "string" ? generateAction.model : undefined
                );
                convertedReply = `${convertedReply}

🖼️ 已幫你生成圖片：${imageUrl}`.trim();
              } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                convertedReply = `${convertedReply}

⚠️ 生成圖片失敗：${msg}`.trim();
              }
              convertedActions = convertedActions.filter(
                action => (action as { type?: string }).type !== "execute_generate_image"
              );
            }
            for (const action of convertedActions) {
              if ((action as { type?: string }).type !== "execute_task") continue;
              const taskAction = action as { type: string; task: { type: "generate_image" | "generate_music" | "generate_video"; params: Record<string, unknown> }; resultUrl?: string; error?: string };
              // M12: 同上,執行前 emit。TASK_TYPE_LABEL 把英文 enum 翻
              // 成中文(圖像生成 / 音樂生成 / 影片生成)。
              emitOrbChatProgress(
                idempKey,
                "executing_tool",
                `執行${TASK_TYPE_LABEL[taskAction.task.type] ?? "任務"}…`,
                { tool: "execute_task", taskType: taskAction.task.type }
              );
              try {
                taskAction.resultUrl = await executeOrbTask(ctx.user.id, taskAction.task);
              } catch (err) {
                // H5 修復:executeOrbTask 失敗時 resultUrl 仍是 undefined,
                // 原本只 console.warn,前端拿到 action 但沒 resultUrl,reply
                // 還是「✅ 已完成」— 對使用者是赤裸的謊。
                // 改成:1) 標記 action.error 讓前端知道這條失敗;2) 附帶
                // 使用者可讀的失敗訊息到 reply;3) 發 telemetry 給可觀測。
                const msg = err instanceof Error ? err.message : String(err);
                const label = TASK_TYPE_LABEL[taskAction.task.type] ?? "任務";
                taskAction.error = msg;
                convertedReply = `${convertedReply}

⚠️ ${label}執行失敗:${msg}`.trim();
                appendTelemetryEvent(telemetryEvents, "execute_task.failed", {
                  taskType: taskAction.task.type,
                  error: msg,
                });
              }
            }
            return finalizeIdempotentResponse({
              reply: convertedReply,
              actions: convertedActions,
              intent: plannerResult.intent ?? null,
              askBeforeAct:
                perPageFiltered.actions.length > 0 &&
                (plannerResult.askBeforeAct ||
                  Boolean(input.alwaysConfirm && perPageFiltered.actions.length > 0)),
              suggestions: [],
              toolCalls: [],
              plannerOutput: plannerResult.rawContent ?? plannerResult.plan,
              plan: plannerResult.plan,
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
            });
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
            return finalizeIdempotentResponse({
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
              plan: plannerResult.plan,
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
            });
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
            return finalizeIdempotentResponse({
              reply:
                plannerResult.reply ??
                "我已建立計畫，但因安全檢查暫停執行，請先確認需求後再繼續。",
              actions: [],
              intent: plannerResult.intent ?? null,
              askBeforeAct: true,
              suggestions: [],
              toolCalls: [],
              plannerOutput: plannerResult.rawContent ?? plannerResult.plan,
              plan: plannerResult.plan,
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
            });
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
            if (taskDraft) {
              emitOrbChatProgress(idempKey, "materializing_task", "整理任務步驟…", {
                steps: taskDraft.steps.length,
              });
            }
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
            // gets attempted before the outer wrapper times out. 8s was too
            // aggressive in production and frequently tripped global chat
            // timeouts during transient provider latency spikes.
            timeoutMs: 12_000,
          }),
          35_000,
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
        let legacyActions = legacyPerPage.actions as typeof legacy.actions;
        const legacyGenerateAction = legacyActions.find(
          action => (action as { type?: string }).type === "execute_generate_image"
        ) as { type: string; payload?: string; prompt?: string; model?: string } | undefined;
        if (legacyGenerateAction) {
          // M12: legacy fallback 也要發 milestone 才完整。
          emitOrbChatProgress(idempKey, "executing_tool", "執行圖像生成…", {
            tool: "execute_generate_image",
            model:
              typeof legacyGenerateAction.model === "string"
                ? legacyGenerateAction.model
                : undefined,
          });
          try {
            const imagePrompt =
              (typeof legacyGenerateAction.prompt === "string" && legacyGenerateAction.prompt.trim()) ||
              (typeof legacyGenerateAction.payload === "string" && legacyGenerateAction.payload.trim()) ||
              latestUserTextForRouting;
            const imageUrl = await executeGenerateImage(
              String(ctx.user.id),
              imagePrompt,
              typeof legacyGenerateAction.model === "string" ? legacyGenerateAction.model : undefined
            );
            legacy.reply = `${legacy.reply ?? ""}

🖼️ 已幫你生成圖片：${imageUrl}`.trim();
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            legacy.reply = `${legacy.reply ?? ""}

⚠️ 生成圖片失敗：${msg}`.trim();
          }
          legacyActions = legacyActions.filter(
            action => (action as { type?: string }).type !== "execute_generate_image"
          ) as typeof legacy.actions;
        }
        for (const action of legacyActions) {
          if (!action || typeof action !== "object" || (action as { type?: string }).type !== "execute_task") continue;
          const typed = action as {
            type: "execute_task";
            task: { type: "generate_image" | "generate_music" | "generate_video"; params: Record<string, unknown> };
            resultUrl?: string;
            error?: string;
          };
          // M12: legacy fallback execute_task milestone。
          emitOrbChatProgress(
            idempKey,
            "executing_tool",
            `執行${TASK_TYPE_LABEL[typed.task.type] ?? "任務"}…`,
            { tool: "execute_task", taskType: typed.task.type }
          );
          try {
            typed.resultUrl = await executeOrbTask(ctx.user.id, typed.task);
          } catch (err) {
            // H5 修復:同 planner 分支(7405-7427 行的 catch 區塊)。
            // legacy fallback 也要誠實回報失敗,不能讓使用者看到「✅
            // 已完成」但 action 沒 resultUrl 的詭異狀態。
            const msg = err instanceof Error ? err.message : String(err);
            const label = TASK_TYPE_LABEL[typed.task.type] ?? "任務";
            typed.error = msg;
            legacy.reply = `${legacy.reply ?? ""}

⚠️ ${label}執行失敗:${msg}`.trim();
            appendTelemetryEvent(telemetryEvents, "execute_task.failed", {
              taskType: typed.task.type,
              error: msg,
            });
          }
        }
        // ── Fallback navigate synthesis ─────────────────────────────────
        // Schema-first planner 失敗 + LLM 用文字承諾「我帶你過去 X」但忘了
        // emit `[ACTION:navigate:...]` marker = 使用者看到光球說「帶你去」
        // 卻沒真的跳頁，這是「直接跳頁沒對話框」回報的最後一里。
        //
        // 補強條件（每一條都要成立才補打 navigate，避免誤跳）：
        //   1. 沒有任何 actions（所以不是 LLM 自己想停在當頁）
        //   2. spiritSelection 落在「有專屬頁面」的角色（director / 各 specialist /
        //      accountant / researcher 等；composer/critic/companion 沒對應頁面）
        //   3. 該頁面跟使用者目前所在頁不同（避免原地跳）
        //   4. LLM reply 真的有「帶你過去 / 帶你到 / 帶過去 / 跳到」這類動詞
        //      （只要 reply 帶了承諾，就符合使用者的期待）
        if (
          legacyActions.length === 0 &&
          spiritSelection &&
          legacy.needsClarification !== true
        ) {
          const targetPath = pickDefaultPathForRole(spiritSelection.role);
          const currentPath = input.pageSnapshot?.pagePath ?? "";
          const replyText = legacy.reply ?? "";
          const hasNavPromise =
            /帶你(過|去|到)|帶過去|跳到|帶到|前往|為你打開|去到/.test(replyText);
          if (
            targetPath &&
            targetPath !== currentPath &&
            hasNavPromise
          ) {
            const synthesizedNavigate = {
              type: "navigate" as const,
              path: targetPath,
              payload: targetPath,
            };
            legacyActions = [
              synthesizedNavigate,
              ...legacyActions,
            ] as typeof legacy.actions;
            appendTelemetryEvent(telemetryEvents, "orb.fallback.synthesized_navigate", {
              role: spiritSelection.role,
              targetPath,
              currentPath,
            });
          }
        }
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
              ? [
                  (() => {
                    const rawReason = String(plannerExceptionReason).trim();
                    const compactReason = rawReason.replace(/\s+/g, " ");
                    const isNvidiaForbidden =
                      /NVIDIA NIM/i.test(compactReason) &&
                      /403\s*Forbidden/i.test(compactReason);
                    const safeReason = isNvidiaForbidden
                      ? "[NVIDIA NIM (MiniMax M2.7)] 403 Forbidden（Authorization failed）"
                      : compactReason;
                    return `Schema-first planner 失敗，已改用 legacy fallback：${safeReason}`;
                  })(),
                ]
              : []),
            ...plannerInvalidWarnings.map(w => `Planner invalid：${w}`),
          ],
          usedMultimodalPlanner: false,
        });
        // legacy.needsClarification was added by orbReplyParser; force askBeforeAct
        // when set so the front-end opens the ClarificationCard.
        const fallbackNeedsClarification = legacy.needsClarification === true;
        // LLM 可能只回 marker(例:[ACTION:navigate:/x])沒有敘述,parseOrbReply
        // strip 完 markers 後 reply 變空字串。直接 spread 會讓 UI 出現「空白氣泡
        // + 自動跳頁」這種很驚悚的體驗,補一句中性回覆當保底。
        const fallbackReply =
          typeof legacy.reply === "string" && legacy.reply.trim()
            ? legacy.reply
            : legacyActions.length > 0
              ? "好的,我來處理。"
              : "我在這裡,隨時可以聊天!";
        return finalizeIdempotentResponse({
          ...legacy,
          reply: fallbackReply,
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
        emitOrbChatProgress(idempKey, "error", "發生錯誤…", {
          reason: errorMsg.slice(0, 240),
        });
        // Classify the failure so the user gets an actionable healing-tone
        // message instead of the generic "去設定頁檢查 API 設定" line.
        // The previous classifier only matched TRPCError SERVICE_UNAVAILABLE,
        // but invokeLLM throws plain Error / LLMPermanentError, so every API
        // outage was masked behind the same vague reply.
        const fallbackReply = classifyOrbChatErrorReply(err, errorMsg);
        // Return healing-style fallback rather than crashing
        const meta = makePlannerMeta({
          plannerStatus: "fallback-error",
          preferredEngine: enginePreference,
          warnings: [errorMsg.slice(0, 240)],
          usedMultimodalPlanner: false,
        });
        return finalizeIdempotentResponse({
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
        });
      } finally {
        // F1 fix: any return path (early-exit guards, planner-throw catch,
        // agent_disabled, provider_unavailable, …) that did not call
        // `finalizeIdempotentResponse` left the in-progress lock alive
        // for 60 s. Drop it here so the user's retry runs normally.
        if (idempKey && !idempotencyFinalized) {
          releaseRequestLock(idempKey);
        }
        // Drop the progress bucket. The client should already have
        // pulled the terminal event by the time the chat mutation
        // resolves; a small delay is acceptable since the bucket also
        // self-expires via TTL.
        if (idempKey) {
          // Small grace period: clear after 2 s so a client that polled
          // right before resolution still sees the final event.
          setTimeout(() => clearOrbChatProgress(idempKey), 2_000).unref();
        }
      }
    }),

  /**
   * Poll progress milestones emitted by an in-flight `ai.chat` request.
   * Pass the same `requestId` you sent on the chat mutation. The client
   * uses this to render the inline thinking timeline so the otherwise-
   * opaque planning window (≤ 20 s) is legible to the user.
   */
  chatProgress: protectedProcedure
    .input(
      z.object({
        requestId: z.string().min(1).max(128),
        sinceSeq: z.number().int().nonnegative().optional(),
      })
    )
    .query(({ input }) => {
      const events = readOrbChatProgress(input.requestId, input.sinceSeq ?? 0);
      return {
        events,
        // The client uses this to advance its cursor without scanning.
        lastSeq: events.length > 0 ? events[events.length - 1].seq : input.sinceSeq ?? 0,
      };
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

  orbMemory: orbMemoryRouter,
});
