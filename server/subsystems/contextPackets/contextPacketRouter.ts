/**
 * contextPackets / routers — M4 團隊內部資料接入創作上下文
 * ────────────────────────────────────────────────────────────────────────────
 * 兩個 namespace：
 *   - contextPacket：compileProject（編譯/重用 packet）、getLatest（讀最新）
 *   - teamData：set/listProjectAccessRules（資料來源存取規則）
 * 全 protected；權限檢查在 service 內，typed error → TRPCError。
 */

import { z } from "zod";
import { router, protectedProcedure } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  compileProjectContextPacket,
  getLatestProjectPacket,
  setProjectAccessRules,
  listProjectAccessRules,
} from "./contextPacketService";
import {
  ContextPacketAccessError,
  COMPILE_MODES,
  ACCESS_LEVELS,
} from "./contracts";

function mapAccessError(error: unknown): never {
  if (error instanceof ContextPacketAccessError) {
    throw new TRPCError({
      code: error.reason === "forbidden" ? "FORBIDDEN" : "NOT_FOUND",
      message: error.message,
    });
  }
  throw error;
}

export const contextPacketRouter = router({
  /** 編譯（或重用）某 project 的 context packet。會寫一筆 packet + 稽核。 */
  compileProject: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        mode: z.enum(COMPILE_MODES),
        query: z.string().trim().min(1).max(255).optional(),
        forceRefresh: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await compileProjectContextPacket({
          userId: ctx.user.id,
          projectId: input.projectId,
          mode: input.mode,
          query: input.query,
          forceRefresh: input.forceRefresh,
        });
      } catch (error) {
        mapAccessError(error);
      }
    }),

  /** 讀某 project 最新一筆 packet（不重算；過期也回，reused 標示是否新鮮）。 */
  getLatest: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        return await getLatestProjectPacket(ctx.user.id, input.projectId);
      } catch (error) {
        mapAccessError(error);
      }
    }),
});

const accessRuleSchema = z.object({
  materialId: z.number().int().positive().nullable(),
  accessLevel: z.enum(ACCESS_LEVELS),
  allowedModes: z.array(z.enum(COMPILE_MODES)).nullable().optional(),
});

export const teamDataRouter = router({
  /** 設定（upsert）資料來源存取規則；需 owner / admin。 */
  setProjectAccessRules: protectedProcedure
    .input(
      z.object({
        teamId: z.number().int().positive(),
        projectId: z.number().int().positive().nullable(),
        rules: z.array(accessRuleSchema).max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await setProjectAccessRules(ctx.user.id, {
          teamId: input.teamId,
          projectId: input.projectId,
          rules: input.rules,
        });
      } catch (error) {
        mapAccessError(error);
      }
    }),

  /** 列出某 team / project 的資料存取規則；任一成員可讀。 */
  listProjectAccessRules: protectedProcedure
    .input(
      z.object({
        teamId: z.number().int().positive(),
        projectId: z.number().int().positive().nullable(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        return await listProjectAccessRules(ctx.user.id, {
          teamId: input.teamId,
          projectId: input.projectId,
        });
      } catch (error) {
        mapAccessError(error);
      }
    }),
});
