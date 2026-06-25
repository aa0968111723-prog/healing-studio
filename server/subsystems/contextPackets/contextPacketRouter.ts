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
  createConnection,
  listConnections,
  testConnection,
  setConnectionStatus,
  deleteConnection,
} from "./connectionService";
import {
  ContextPacketAccessError,
  COMPILE_MODES,
  ACCESS_LEVELS,
  CONNECTION_KINDS,
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

export const dataConnectionsRouter = router({
  /** 建立外部資料來源連接（Notion 需 credential；Drive 走既有 OAuth）。 */
  create: protectedProcedure
    .input(
      z.object({
        kind: z.enum(CONNECTION_KINDS),
        provider: z.string().trim().min(1).max(64),
        teamId: z.number().int().positive().nullable().optional(),
        projectId: z.number().int().positive().nullable().optional(),
        credential: z.string().trim().min(1).max(4096).nullable().optional(),
        config: z.record(z.string(), z.unknown()).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createConnection(ctx.user.id, {
          kind: input.kind,
          provider: input.provider,
          teamId: input.teamId ?? null,
          projectId: input.projectId ?? null,
          credential: input.credential ?? null,
          config: input.config ?? null,
        });
      } catch (error) {
        mapAccessError(error);
      }
    }),

  /** 列出使用者的連接（不含 credential）；可選 project 過濾。 */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive().nullable().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return listConnections(ctx.user.id, input.projectId ?? null);
    }),

  /** 健檢一個連接，更新 status。 */
  test: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await testConnection(ctx.user.id, input.id);
      } catch (error) {
        mapAccessError(error);
      }
    }),

  /** 啟用 / 停用一個連接。 */
  setStatus: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["pending", "active", "disabled", "error"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await setConnectionStatus(ctx.user.id, input.id, input.status);
      } catch (error) {
        mapAccessError(error);
      }
    }),

  /** AIDV-185: 刪除連接（含 encryptedCredentialRef），解決 secret-retention 缺口。 */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await deleteConnection(ctx.user.id, input.id);
        return { deleted: true };
      } catch (error) {
        mapAccessError(error);
      }
    }),
});
