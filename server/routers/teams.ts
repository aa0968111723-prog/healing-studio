/**
 * teams.ts — 多人協作的團隊管理 Router
 *
 * Phase 2 of the training-data feature. 教材庫 (teachingArchive) 引入了
 * teamId 欄位之後，需要 CRUD 用來管理「誰跟誰是同一隊」。
 *
 * 角色矩陣：
 *   owner  — 建立者，唯一能解散團隊 / 轉移擁有權
 *   admin  — 可邀請 / 移除其他 member、可編輯團隊任何素材
 *   member — 可讀寫團隊的 team_shared 素材
 *
 * 邀請目前是「直接加 userId」的內部用法 — 沒有 email 邀請信，假設使用者
 * 都已經是 workspace 內部成員。未來要做 email invite，再加一張
 * pending_invitations table。
 */

import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

const ROLE_VALUES = ["owner", "admin", "member"] as const;

async function getRequireMembership(teamId: number, userId: number) {
  const m = await db.getTeamMembership(teamId, userId);
  if (!m) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "你不是這個團隊的成員",
    });
  }
  return m;
}

function requireRole(
  role: (typeof ROLE_VALUES)[number],
  minimum: "owner" | "admin"
) {
  const rank = { owner: 3, admin: 2, member: 1 } as const;
  if (rank[role] < rank[minimum]) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `此操作需要 ${minimum} 以上的角色`,
    });
  }
}

export const teamsRouter = router({
  /** 建立新團隊 — 建立者自動成為 owner */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(128),
        description: z.string().max(2_000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await db.createTeam({
        name: input.name,
        description: input.description,
        ownerId: ctx.user.id,
      });
      await db.addTeamMember({
        teamId,
        userId: ctx.user.id,
        role: "owner",
        invitedBy: ctx.user.id,
      });
      return { id: teamId };
    }),

  /** 列出當前使用者參加的所有團隊（含角色） */
  list: protectedProcedure.query(async ({ ctx }) => {
    return db.listTeamsForUser(ctx.user.id);
  }),

  /** 取得單一團隊資訊 — 必須是成員 */
  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const team = await db.getTeam(input.id);
      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "團隊不存在" });
      }
      await getRequireMembership(input.id, ctx.user.id);
      return team;
    }),

  /** 列出團隊成員（含角色 / 加入時間） */
  members: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await getRequireMembership(input.id, ctx.user.id);
      const memberships = await db.listTeamMembers(input.id);
      // 一起把 user 基本資料 join 進來，前端比較好顯示
      const userIds = memberships.map(m => m.userId);
      const users = userIds.length > 0 ? await db.getUsersByIds(userIds) : [];
      const userMap = new Map(users.map(u => [u.id, u]));
      return memberships.map(m => ({
        ...m,
        user: userMap.get(m.userId) ?? null,
      }));
    }),

  /** 邀請 / 加入新成員（須 owner 或 admin） */
  addMember: protectedProcedure
    .input(
      z.object({
        teamId: z.number().int().positive(),
        userId: z.number().int().positive(),
        role: z.enum(["admin", "member"]).default("member"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = await getRequireMembership(input.teamId, ctx.user.id);
      requireRole(me.role, "admin");

      // 自己加自己當別的角色 — 沒意義
      if (input.userId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "不能用 addMember 修改自己的角色",
        });
      }

      // 重複邀請：直接擋
      const existing = await db.getTeamMembership(input.teamId, input.userId);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "此使用者已經是團隊成員",
        });
      }

      // 防止 phantom membership — DB 沒掛 FK 約束（待 0054 migration），
      // 應用層必須先確認 userId 真的存在於 users 表。
      const targetUsers = await db.getUsersByIds([input.userId]);
      if (targetUsers.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `找不到 userId=${input.userId} 的使用者`,
        });
      }

      await db.addTeamMember({
        teamId: input.teamId,
        userId: input.userId,
        role: input.role,
        invitedBy: ctx.user.id,
      });
      return { ok: true };
    }),

  /** 移除成員（須 owner 或 admin；不能移除 owner） */
  removeMember: protectedProcedure
    .input(
      z.object({
        teamId: z.number().int().positive(),
        userId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = await getRequireMembership(input.teamId, ctx.user.id);
      requireRole(me.role, "admin");

      const target = await db.getTeamMembership(input.teamId, input.userId);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "此成員不存在" });
      }
      if (target.role === "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "不能移除團隊 owner，請先轉移擁有權",
        });
      }
      // admin 移除 admin：先擋掉，避免互相踢來踢去
      if (target.role === "admin" && me.role !== "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "只有 owner 可以移除其他 admin",
        });
      }

      await db.removeTeamMember(input.teamId, input.userId);
      return { ok: true };
    }),

  /** 自己離開團隊（owner 不可離開，要先轉移） */
  leave: protectedProcedure
    .input(z.object({ teamId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = await getRequireMembership(input.teamId, ctx.user.id);
      if (me.role === "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "團隊 owner 不可直接離開，請先解散或轉移擁有權",
        });
      }
      await db.removeTeamMember(input.teamId, ctx.user.id);
      return { ok: true };
    }),

  /** 轉移 owner 身份（僅 owner 可執行；新 owner 必須已是成員） */
  transferOwnership: protectedProcedure
    .input(
      z.object({
        teamId: z.number().int().positive(),
        newOwnerId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = await getRequireMembership(input.teamId, ctx.user.id);
      requireRole(me.role, "owner");

      if (input.newOwnerId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "不能把擁有權轉移給自己",
        });
      }

      const target = await db.getTeamMembership(input.teamId, input.newOwnerId);
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "指定的新 owner 不是本團隊成員，請先邀請後再轉移",
        });
      }

      await db.transferTeamOwnership(input.teamId, ctx.user.id, input.newOwnerId);
      return { ok: true };
    }),

  /** 更新成員角色（僅 owner 可執行；owner 角色轉移請用 transferOwnership） */
  updateMemberRole: protectedProcedure
    .input(
      z.object({
        teamId: z.number().int().positive(),
        memberId: z.number().int().positive(),
        newRole: z.enum(["admin", "member"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = await getRequireMembership(input.teamId, ctx.user.id);
      requireRole(me.role, "owner");

      if (input.memberId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "不能修改自己的角色；若要轉移 owner 身份請用 transferOwnership",
        });
      }

      const target = await db.getTeamMembership(input.teamId, input.memberId);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "此成員不存在" });
      }
      if (target.role === "owner") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "不能直接修改 owner 的角色，請使用 transferOwnership",
        });
      }

      await db.updateTeamMemberRole(input.teamId, input.memberId, input.newRole);
      return { ok: true };
    }),

  /** 解散團隊（僅 owner 可執行）— 團隊素材會退回個人池 */
  delete: protectedProcedure
    .input(z.object({ teamId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = await getRequireMembership(input.teamId, ctx.user.id);
      requireRole(me.role, "owner");
      await db.deleteTeam(input.teamId);
      return { ok: true };
    }),
});

export type TeamsRouter = typeof teamsRouter;
