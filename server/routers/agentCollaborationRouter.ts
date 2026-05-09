/**
 * agentCollaborationRouter.ts — TRPC router for multi-agent collaboration
 *
 * Provides API endpoints for:
 * - Starting collaboration sessions
 * - Querying collaboration status
 * - Canceling/completing collaborations
 * - Monitoring agent participation
 */

import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { AgentCollaborationOrchestrator } from "../services/agentCollaborationOrchestrator";
import { AgentCommunicationBus } from "../services/agentCommunicationBus";
import { loadAgentPreferencesForUser } from "../services/agentPreferenceService";
import { runAutoDiscussion } from "../services/agentDiscussionRunner";
import {
  selectRoleForIntent,
  type AgentRole,
} from "../../shared/orb-agent-roles";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
import { getDb } from "../db";
import { agentCollaborationSessions } from "../../drizzle/schema";

export const agentCollaborationRouter = router({
  /**
   * Start a new multi-agent collaboration session
   */
  startCollaboration: protectedProcedure
    .input(
      z.object({
        taskDescription: z.string().min(1, "任務描述不能為空"),
        preferredAgents: z.array(z.string()).optional(),
        sessionId: z.string().optional(),
        sharedContext: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        logger.info("collaboration_start_requested", {
          userId: ctx.user.id,
          taskDescription: input.taskDescription.slice(0, 100),

        });

        const session = await AgentCollaborationOrchestrator.startCollaboration({
          userId: ctx.user.id,
          sessionId: input.sessionId || `session_${Date.now()}_${ctx.user.id}`,
          taskDescription: input.taskDescription,
          initiatingAgent: "director",
          requiredCapabilities: (input.preferredAgents as AgentRole[]) || [],
          sharedContext: input.sharedContext || {},
        });

        logger.info("collaboration_session_started", {
          userId: ctx.user.id,
          collaborationId: session.collaborationId,
          participatingAgents: session.participatingAgents,


        });

        return {
          success: true,
          collaborationId: session.collaborationId,
          participatingAgents: session.participatingAgents,
          status: session.status,
        };
      } catch (error) {
        logger.error("collaboration_start_failed", {
          userId: ctx.user.id,
          error: error instanceof Error ? error.message : String(error),

        });

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "啟動協作失敗",
          cause: error,
        });
      }
    }),

  /**
   * Get status of an active collaboration session
   */
  getCollaborationStatus: protectedProcedure
    .input(
      z.object({
        collaborationId: z.string().min(1, "協作 ID 不能為空"),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        // Fast path: in-memory store has the session for active runs and for
        // the first hour after completion (orchestrator cleans up after 1h).
        const session = AgentCollaborationOrchestrator.getSessionStatus(
          input.collaborationId
        );
        if (session) {
          if (session.userId !== ctx.user.id) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "無權存取此協作 session",
            });
          }
          return {
            collaborationId: session.collaborationId,
            status: session.status,
            participatingAgents: session.participatingAgents,
            currentAgent: session.currentAgent,
            taskDescription: session.taskDescription,
            result: session.result,
            startedAt: session.startedAt,
            completedAt: session.completedAt,
          };
        }

        // Fall back to the persisted row so older completed/cancelled
        // sessions don't disappear on the user once the in-memory copy
        // is evicted. Without this they'd see "找不到此協作 session" even
        // though `listUserCollaborations` happily lists the same row.
        const db = await getDb();
        if (!db) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "找不到此協作 session",
          });
        }
        const [row] = await db
          .select()
          .from(agentCollaborationSessions)
          .where(eq(agentCollaborationSessions.collaborationId, input.collaborationId))
          .limit(1);
        if (!row) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "找不到此協作 session",
          });
        }
        if (row.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "無權存取此協作 session",
          });
        }
        return {
          collaborationId: row.collaborationId,
          status: row.status,
          participatingAgents: row.participatingAgents,
          currentAgent: row.currentAgent,
          taskDescription: row.taskDescription,
          result: row.result,
          startedAt: row.startedAt,
          completedAt: row.completedAt,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        logger.error("collaboration_status_query_failed", {
          userId: ctx.user.id,
          collaborationId: input.collaborationId,
          error: error instanceof Error ? error.message : String(error),


        });

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "查詢協作狀態失敗",
          cause: error,
        });
      }
    }),

  /**
   * List recent collaboration sessions for current user
   */
  listUserCollaborations: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
        status: z.enum(["active", "completed", "failed", "cancelled"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        logger.info("collaboration_list_requested", {
          userId: ctx.user.id,
          limit: input.limit,
          status: input.status,

        });

        const db = await getDb();
        if (!db) {
          // DB unavailable: no persisted history yet, return empty so the UI
          // doesn't crash. The orchestrator's in-memory state is ephemeral
          // and not useful for "recent collaborations" anyway.
          return { collaborations: [] };
        }

        const conditions = [
          eq(agentCollaborationSessions.userId, ctx.user.id),
        ];
        if (input.status) {
          conditions.push(eq(agentCollaborationSessions.status, input.status));
        }

        const rows = await db
          .select()
          .from(agentCollaborationSessions)
          .where(and(...conditions))
          .orderBy(desc(agentCollaborationSessions.startedAt))
          .limit(input.limit);

        return { collaborations: rows };
      } catch (error) {
        logger.error("collaboration_list_failed", {
          userId: ctx.user.id,
          error: error instanceof Error ? error.message : String(error),

        });

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "列出協作失敗",
          cause: error,
        });
      }
    }),

  /**
   * Cancel an active collaboration session
   */
  cancelCollaboration: protectedProcedure
    .input(
      z.object({
        collaborationId: z.string().min(1, "協作 ID 不能為空"),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const session = AgentCollaborationOrchestrator.getSessionStatus(
          input.collaborationId
        );

        if (!session) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "找不到此協作 session",
          });
        }

        // Verify user owns this session
        if (session.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "無權取消此協作 session",
          });
        }

        if (session.status !== "active") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "只能取消進行中的協作",
          });
        }

        // Complete collaboration with cancelled status
        const cancelledAt = Date.now();
        AgentCollaborationOrchestrator.completeCollaboration(
          input.collaborationId,
          {
            success: false,
            output: { cancelled: true, reason: input.reason },
            participants: session.participatingAgents,
            completedAt: cancelledAt,
            // session.startedAt is millis since epoch; subtract for the
            // total elapsed time (durationMs is required on the result).
            durationMs: Math.max(0, cancelledAt - session.startedAt),
            completedBy: session.currentAgent,
          }
        );

        logger.info("collaboration_cancelled", {
          userId: ctx.user.id,
          collaborationId: input.collaborationId,
          reason: input.reason,


        });

        return {
          success: true,
          message: "協作已取消",
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        logger.error("collaboration_cancel_failed", {
          userId: ctx.user.id,
          collaborationId: input.collaborationId,
          error: error instanceof Error ? error.message : String(error),


        });

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "取消協作失敗",
          cause: error,
        });
      }
    }),

  /**
   * Get recent messages from collaboration session
   */
  getCollaborationMessages: protectedProcedure
    .input(
      z.object({
        collaborationId: z.string().min(1, "協作 ID 不能為空"),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        // Resolve userId for auth check from in-memory first; fall back to
        // the persisted session row when the orchestrator's 1h cleanup has
        // already evicted it. Without the DB fallback the user gets NOT_FOUND
        // on completed-but-aged sessions even though they appear in
        // listUserCollaborations.
        const liveSession = AgentCollaborationOrchestrator.getSessionStatus(
          input.collaborationId
        );
        let ownerUserId: number | null = liveSession?.userId ?? null;
        if (ownerUserId === null) {
          const db = await getDb();
          if (!db) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "找不到此協作 session",
            });
          }
          const [row] = await db
            .select({ userId: agentCollaborationSessions.userId })
            .from(agentCollaborationSessions)
            .where(eq(agentCollaborationSessions.collaborationId, input.collaborationId))
            .limit(1);
          if (!row) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "找不到此協作 session",
            });
          }
          ownerUserId = row.userId;
        }

        if (ownerUserId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "無權存取此協作 session",
          });
        }

        // Messages still come from the in-memory bus. Once the bus history
        // is rotated out, this returns an empty list — that's accurate
        // (we don't persist per-message rows yet) and better than 404.
        const messages = AgentCommunicationBus.getHistory({
          correlationId: input.collaborationId,
          limit: input.limit,
        });

        return {
          collaborationId: input.collaborationId,
          messages: messages.map(msg => ({
            messageId: msg.messageId,
            fromAgent: msg.fromAgent,
            toAgent: msg.toAgent,
            messageType: msg.messageType,
            timestamp: msg.timestamp,
            content: msg.content,
          })),
          total: messages.length,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        logger.error("collaboration_messages_query_failed", {
          userId: ctx.user.id,
          collaborationId: input.collaborationId,
          error: error instanceof Error ? error.message : String(error),


        });

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "查詢協作訊息失敗",
          cause: error,
        });
      }
    }),

  /**
   * 15 精靈「自動討論」：丟一個 prompt 進去，runner 會建立一個 collaboration
   * session、依 SPIRIT_COLLAB_PROTOCOL 連續派 N 棒精靈各自回一段，每段都 publish
   * 到 AgentCommunicationBus（correlationId = collaborationId），客戶端用既有的
   * `getCollaborationMessages` 輪詢就能看到一輪一輪冒出來的討論。
   *
   * 跟 startCollaboration 的差別：startCollaboration 只建好 session 等 caller 自己
   * 推進；這支會幫你把第一棒精靈挑好（用 selectRoleForIntent）、然後把整輪 LLM
   * 呼叫跑完。runner 在背景跑、本 mutation 立刻回傳 collaborationId 給 client 開
   * 始輪詢，避免 30s 級別的 round-trip。
   */
  startAutoDiscussion: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1, "需求不能為空").max(2000),
        sessionId: z.string().optional(),
        /** 強制指定第一棒；省略就用 selectRoleForIntent 自動挑 */
        initialAgent: z.string().optional(),
        /** 最多跑幾位精靈；預設 3，最大 5 */
        maxRounds: z.number().int().min(1).max(5).optional(),
        /**
         * 顯式白名單：只讓這幾位 AgentRole 出席。空 / 未給 = 不限制。
         * 跟 `allowedFamilies` 是 AND 關係（兩邊都符合才會被考慮）。
         */
        allowedRoles: z.array(z.string().max(40)).max(15).optional(),
        /**
         * 家族白名單：只讓某些家族（specialist / role / proactive）出席。
         * 與 `allowedRoles` 是 AND 關係（兩邊都符合才考慮）。
         */
        allowedFamilies: z
          .array(z.enum(["specialist", "role", "proactive"]))
          .max(3)
          .optional(),
        /**
         * 額外要靜音的精靈（疊加在使用者偏好的 mutedSpirits 上）。給「這次」用，
         * 不會寫回偏好；想永久 mute 還是要去 settings 改。
         */
        extraMutedRoles: z.array(z.string().max(40)).max(15).optional(),
        /** 每位精靈 LLM 呼叫的硬上限（毫秒）。clamp 到 5_000–60_000。 */
        timeoutMsPerTurn: z.number().int().min(5_000).max(60_000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const initialAgent: AgentRole = (() => {
          if (input.initialAgent) return input.initialAgent as AgentRole;
          const selection = selectRoleForIntent({ text: input.prompt });
          return selection.role;
        })();

        const session = await AgentCollaborationOrchestrator.startCollaboration({
          userId: ctx.user.id,
          sessionId:
            input.sessionId || `auto_discussion_${Date.now()}_${ctx.user.id}`,
          taskDescription: input.prompt,
          initiatingAgent: initialAgent,
          requiredCapabilities: [],
          sharedContext: {
            userId: ctx.user.id,
            mode: "auto-discussion",
            originalIntent: input.prompt,
            allowedRoles: input.allowedRoles ?? [],
            allowedFamilies: input.allowedFamilies ?? [],
          },
        });

        // 讀使用者的 mutedSpirits — 被靜音的精靈在 runner 內就會被跳過。
        // extraMutedRoles 疊加在偏好上，只影響「這次」這場討論。
        const prefs = await loadAgentPreferencesForUser(ctx.user.id);
        const prefMuted = (prefs.mutedSpirits ?? []) as AgentRole[];
        const extraMuted = (input.extraMutedRoles ?? []) as AgentRole[];
        const mutedRoles: AgentRole[] = Array.from(
          new Set<AgentRole>([...prefMuted, ...extraMuted])
        );

        // Fire-and-forget：背景跑 runner，本 mutation 立刻回傳 collaborationId。
        // 任何錯誤都記 log 不丟出來 — 失敗的 turn 已經寫進 bus、UI 端 polling 仍
        // 然能看到既有訊息與最後狀態。
        void runAutoDiscussion({
          collaborationId: session.collaborationId,
          userPrompt: input.prompt,
          initialAgent,
          maxRounds: input.maxRounds,
          mutedRoles,
          allowedRoles: (input.allowedRoles as AgentRole[] | undefined),
          allowedFamilies: input.allowedFamilies,
          timeoutMsPerTurn: input.timeoutMsPerTurn,
        }).catch(err => {
          logger.error("auto_discussion_runner_failed", {
            userId: ctx.user.id,
            collaborationId: session.collaborationId,
            error: err instanceof Error ? err.message : String(err),
          });
        });

        logger.info("auto_discussion_kicked_off", {
          userId: ctx.user.id,
          collaborationId: session.collaborationId,
          initialAgent,
          maxRounds: input.maxRounds ?? 3,
          allowedRoles: input.allowedRoles ?? [],
          allowedFamilies: input.allowedFamilies ?? [],
        });

        return {
          collaborationId: session.collaborationId,
          initialAgent,
          maxRounds: input.maxRounds ?? 3,
          allowedRoles: input.allowedRoles ?? [],
          allowedFamilies: input.allowedFamilies ?? [],
        };
      } catch (error) {
        logger.error("auto_discussion_start_failed", {
          userId: ctx.user.id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "啟動多代理討論失敗",
          cause: error,
        });
      }
    }),

  /**
   * 15 精靈：依 SPIRIT_COLLAB_PROTOCOL 把當前 session 的 currentAgent 交給下一棒。
   * - 沒指定 fromAgent 時用 session.currentAgent。
   * - 自動讀使用者的 mutedSpirits，被靜音的精靈會在 candidates 裡被跳過。
   * - whenHint 會嘗試 substring match SpiritHandoff.when（例：「執行完成」 → 找
   *   含 "completed" 的 handoff），找不到就用 protocol 列在最前面的預設。
   *
   * UI 用法：AgentChat 顯示「他做完會交給編編 — 直接交給他」按鈕，按下就 mutate 這支。
   */
  executeProtocolHandoff: protectedProcedure
    .input(
      z.object({
        collaborationId: z.string().min(1),
        fromAgent: z.string().min(1).max(40).optional(),
        whenHint: z.string().max(120).optional(),
        extraContext: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = AgentCollaborationOrchestrator.getSessionStatus(input.collaborationId);
      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到此協作 session" });
      }
      if (session.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "無權操作此協作 session" });
      }
      if (session.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "只能對進行中的協作交棒" });
      }

      // 載偏好抓 mutedSpirits — protocol 篩選候選人時要尊重使用者的靜音清單。
      const prefs = await loadAgentPreferencesForUser(ctx.user.id);
      const mutedRoles = (prefs.mutedSpirits ?? []) as AgentRole[];
      const fromAgent = (input.fromAgent ?? session.currentAgent) as AgentRole;

      const result = await AgentCollaborationOrchestrator.executeProtocolHandoff({
        collaborationId: input.collaborationId,
        fromAgent,
        whenHint: input.whenHint,
        mutedRoles,
        extraContext: input.extraContext,
      });

      logger.info("protocol_handoff_invoked", {
        userId: ctx.user.id,
        collaborationId: input.collaborationId,
        fromAgent,
        toAgent: result.toAgent,
        executed: result.executed,
      });

      return {
        executed: result.executed,
        toAgent: result.toAgent,
        reason: result.handoff?.reason ?? null,
        when: result.handoff?.when ?? null,
      };
    }),

  /**
   * 15 精靈：純 read — 列出某位精靈接下來「按 protocol 通常會交給誰」。
   * 不執行任何動作，給 UI 顯示「他做完會交給 X」chip 用。會套用使用者的 mute。
   */
  getProtocolHandoffsFor: protectedProcedure
    .input(z.object({ fromAgent: z.string().min(1).max(40) }))
    .query(async ({ ctx, input }) => {
      const prefs = await loadAgentPreferencesForUser(ctx.user.id);
      const mutedRoles = (prefs.mutedSpirits ?? []) as AgentRole[];
      const handoffs = AgentCollaborationOrchestrator.getProtocolHandoffsFor(
        input.fromAgent as AgentRole,
        { mutedRoles }
      );
      return { handoffs };
    }),
});
