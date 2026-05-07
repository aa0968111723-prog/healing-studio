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
import { router, protectedProcedure } from "../_core/trpc";
import { AgentCollaborationOrchestrator } from "../services/agentCollaborationOrchestrator";
import { AgentCommunicationBus } from "../services/agentCommunicationBus";
import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
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
        logger.info("agent collaboration info", {
          event: "collaboration_start_requested",
          userId: ctx.user.id,
          taskDescription: input.taskDescription.slice(0, 100),
        });

        const session = await AgentCollaborationOrchestrator.startCollaboration({
          requestingAgent: "director",
          targetAgents: (input.preferredAgents as AgentRole[]) || "auto",
          task: input.taskDescription,
          taskType: "plan",
          requiredCapabilities: input.preferredAgents,
          context: {
            userId: ctx.user.id,
            sessionId: input.sessionId || `session_${Date.now()}_${ctx.user.id}`,
            ...(input.sharedContext || {}),
          },
        });

        logger.info("agent collaboration info", {
          event: "collaboration_session_started",
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
        logger.error("agent collaboration error", {
          event: "collaboration_start_failed",
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
        const session = AgentCollaborationOrchestrator.getSession(
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
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        logger.error("agent collaboration error", {
          event: "collaboration_status_query_failed",
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
        status: z.enum(["active", "completed", "failed"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        // Note: This would query from database once persistence is added
        // For now, return empty array as in-memory sessions are ephemeral
        logger.info("agent collaboration info", {
          event: "collaboration_list_requested",
          userId: ctx.user.id,
          limit: input.limit,
          status: input.status,
        });

        return {
          collaborations: [],
          message: "協作記錄持久化尚未實作，請等待資料庫 schema 完成",
        };
      } catch (error) {
        logger.error("agent collaboration error", {
          event: "collaboration_list_failed",
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
        const session = AgentCollaborationOrchestrator.getSession(
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
        await AgentCollaborationOrchestrator.completeCollaboration(
          input.collaborationId,
          {
            success: false,
            completedBy: session.currentAgent,
            result: { cancelled: true, reason: input.reason },
            context: session.sharedContext,
            error: input.reason,
            durationMs: Date.now() - session.startedAt,
          }
        );

        logger.info("agent collaboration info", {
          event: "collaboration_cancelled",
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

        logger.error("agent collaboration error", {
          event: "collaboration_cancel_failed",
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
        const session = AgentCollaborationOrchestrator.getSession(
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

        logger.error("agent collaboration error", {
          event: "collaboration_messages_query_failed",
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
