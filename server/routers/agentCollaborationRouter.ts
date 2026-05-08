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
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
import { getDb } from "../db";
import { agentCollaborationSessions } from "../../drizzle/schema";
import type { AgentRole } from "../../shared/orb-agent-roles";

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
            message: "無權存取此協作 session",
          });
        }

        // Get messages from communication bus
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
});
