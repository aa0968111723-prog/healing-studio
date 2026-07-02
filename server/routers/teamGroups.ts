/**
 * teamGroups.ts — 組別（team_groups）生命週期 Router（AIDV-297 T-1 · Wave T 地基）
 * ──────────────────────────────────────────────────────────────────────────
 *
 * 「組別」是 AIDV-121 RBAC 的強制範圍單位（組間預設隔離；enforcement 在
 * resourceAccessResolver ＋ ENABLE_GROUP_SCOPE 旗標），與 teams（共享池）正交。
 * 本 router 提供組別實體的生命週期：
 *
 *   createGroup / updateGroup / deleteGroup — 組別 CRUD。建立/刪除是 Admin
 *       能力（ADMIN_PERMISSION_MATRIX.group_management）；更新開放組長（lead）。
 *   addMember / updateMemberRole / removeMember — 成員增刪改組。Admin 或該組
 *       lead 可（canManageGroup）；removeMember 額外允許**本人自行離開**。
 *       離開/移除時自動把「該成員擁有且掛在此組」的資源摘組（歸屬處理，
 *       見 db.removeTeamGroupMemberAndDetachOwnedResources）；要留下資源請先走
 *       AIDV-121 rbac.transferOwnership 交接。
 *   assignResource — 把 project/asset/prompt/material 掛進組別（或摘組）。
 *       掛組：Admin，或「資源 owner 且為目標組組員」（把自己的資源帶進自己的組；
 *       lead 不能把**別人的**資源掛進組——那等於未經 owner 同意就把資源曝光給
 *       全組）。摘組：Admin、資源 owner、或該組 lead（摘組只縮小曝光面，安全）。
 *   listMyGroups / listAllGroups / listMembers — 唯讀查詢。
 *
 * ── 與旗標的關係（比照 rbac.ts 的解耦哲學）─────────────────────────────────
 *   本 router 全部是**純加法的資料寫入**：ENABLE_GROUP_SCOPE=OFF（預設）時
 *   沒有任何讀取端會看 groupId / 組別會員，故建組、加成員、掛組別都不改變
 *   任何既有讀取行為（HARD SAFETY：旗標 OFF＝與現狀位元相同）。先累積資料、
 *   拍板後開旗標即生效——不需要把 mutation 也鎖在旗標後。
 *
 * ── Admin 定義（卡上「誰能」的落地）───────────────────────────────────────
 *   跨組別 Admin＝users.role='admin'（小團隊先 Bruce 單一 Admin）。能力矩陣
 *   SSOT 在 services/authz/groupAccess.ts 的 ADMIN_PERMISSION_MATRIX（Skill
 *   信任放行 AIDV-129、配額調整 T-4、資料調閱 AIDV-122/123、成員增刪改組、
 *   組別管理、delegate_admin）。委派：admin 用既有 admin.updateRole 把另一
 *   帳號升為 admin（delegate_admin 保留擴編路徑，矩陣不用改）。
 *
 *   稽核：所有 mutation 皆 recordAuditEvent（沿用 AIDV-123 best-effort
 *   append-only 稽核，不阻塞）。
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";
import {
  recordAuditEvent,
  extractRequestSource,
} from "../services/audit/auditLog";
import {
  canManageGroup,
  isSystemAdmin,
  systemRoleCan,
} from "../services/authz/groupAccess";

const resourceTypeSchema = z.enum(["project", "asset", "prompt", "material"]);
const groupRoleSchema = z.enum(["lead", "member"]);
const groupIdSchema = z.number().int().positive();

/** 組別必須存在，否則 NOT_FOUND。 */
async function requireGroup(groupId: number) {
  const group = await db.getTeamGroup(groupId);
  if (!group) {
    throw new TRPCError({ code: "NOT_FOUND", message: "組別不存在" });
  }
  return group;
}

/**
 * 驗證 actor 可管理此組別（系統 Admin 或該組 lead），否則 FORBIDDEN。
 * 回傳 actor 在該組的會員紀錄（Admin 可能為 null）。
 */
async function requireGroupManager(groupId: number, user: { id: number; role: string }) {
  const membership = await db.getTeamGroupMembership(groupId, user.id);
  if (!canManageGroup(user.role, membership?.role ?? null)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "只有系統管理員或該組組長可以執行此操作",
    });
  }
  return membership;
}

export const teamGroupsRouter = router({
  // ── 唯讀查詢 ──────────────────────────────────────────────────────────

  /** 列出我所屬的組別（含組內角色）。 */
  listMyGroups: protectedProcedure.query(async ({ ctx }) => {
    return db.listTeamGroupsForUser(ctx.user.id);
  }),

  /** 列出全部組別（Admin 治理視角；group_management 能力）。 */
  listAllGroups: protectedProcedure.query(async ({ ctx }) => {
    if (!systemRoleCan(ctx.user.role, "group_management")) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "只有系統管理員可以檢視全部組別",
      });
    }
    return db.listAllTeamGroups();
  }),

  /** 列出某組別的成員（該組組員或 Admin 可看）。 */
  listMembers: protectedProcedure
    .input(z.object({ groupId: groupIdSchema }))
    .query(async ({ ctx, input }) => {
      await requireGroup(input.groupId);
      const membership = await db.getTeamGroupMembership(
        input.groupId,
        ctx.user.id
      );
      if (!membership && !isSystemAdmin(ctx.user.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "你不是此組別的成員",
        });
      }
      return db.listTeamGroupMembers(input.groupId);
    }),

  // ── 組別 CRUD ─────────────────────────────────────────────────────────

  /** 建立組別（Admin 能力：group_management）。 */
  createGroup: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(128),
        description: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!systemRoleCan(ctx.user.role, "group_management")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "只有系統管理員可以建立組別",
        });
      }
      const groupId = await db.createTeamGroup({
        name: input.name,
        description: input.description ?? null,
        createdByUserId: ctx.user.id,
      });
      recordAuditEvent({
        actorUserId: ctx.user.id,
        actorRole: ctx.user.role,
        action: "teamGroup.create",
        targetType: "team_group",
        targetId: groupId,
        ...extractRequestSource(ctx.req),
        metadata: { name: input.name },
      });
      return { groupId };
    }),

  /** 更新組別名稱 / 描述（Admin 或該組 lead）。 */
  updateGroup: protectedProcedure
    .input(
      z.object({
        groupId: groupIdSchema,
        name: z.string().trim().min(1).max(128).optional(),
        description: z.string().max(2000).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireGroup(input.groupId);
      await requireGroupManager(input.groupId, ctx.user);
      const patch: { name?: string; description?: string | null } = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined) patch.description = input.description;
      if (Object.keys(patch).length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "沒有任何要更新的欄位",
        });
      }
      await db.updateTeamGroup(input.groupId, patch);
      recordAuditEvent({
        actorUserId: ctx.user.id,
        actorRole: ctx.user.role,
        action: "teamGroup.update",
        targetType: "team_group",
        targetId: input.groupId,
        ...extractRequestSource(ctx.req),
        metadata: patch,
      });
      return { success: true };
    }),

  /**
   * 刪除組別（Admin 能力：group_management）。單一 transaction：清會員 →
   * 掛在此組的資源全部摘組（資源與擁有權不動，回到未歸組＝現狀行為，
   * 失敗安全）→ 刪組別。
   */
  deleteGroup: protectedProcedure
    .input(z.object({ groupId: groupIdSchema }))
    .mutation(async ({ ctx, input }) => {
      if (!systemRoleCan(ctx.user.role, "group_management")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "只有系統管理員可以刪除組別",
        });
      }
      const group = await requireGroup(input.groupId);
      await db.deleteTeamGroupCascade(input.groupId);
      recordAuditEvent({
        actorUserId: ctx.user.id,
        actorRole: ctx.user.role,
        action: "teamGroup.delete",
        targetType: "team_group",
        targetId: input.groupId,
        ...extractRequestSource(ctx.req),
        metadata: { name: group.name },
      });
      return { success: true };
    }),

  // ── 成員增刪改組 ──────────────────────────────────────────────────────

  /** 加成員進組別（Admin 或該組 lead）。重複加＝更新組內角色（upsert）。 */
  addMember: protectedProcedure
    .input(
      z.object({
        groupId: groupIdSchema,
        userId: z.number().int().positive(),
        role: groupRoleSchema.default("member"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireGroup(input.groupId);
      await requireGroupManager(input.groupId, ctx.user);
      // 對象使用者必須存在（防打錯 id 變幽靈會員——旗標 ON 時會員即活的授權）
      const found = await db.getUsersByIds([input.userId]);
      if (found.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "對象使用者不存在",
        });
      }
      await db.upsertTeamGroupMembership({
        groupId: input.groupId,
        userId: input.userId,
        role: input.role,
        addedByUserId: ctx.user.id,
      });
      recordAuditEvent({
        actorUserId: ctx.user.id,
        actorRole: ctx.user.role,
        action: "teamGroup.addMember",
        targetType: "team_group",
        targetId: input.groupId,
        ...extractRequestSource(ctx.req),
        metadata: { userId: input.userId, role: input.role },
      });
      return { success: true };
    }),

  /** 改成員的組內角色（Admin 或該組 lead）。對象必須已是組員。 */
  updateMemberRole: protectedProcedure
    .input(
      z.object({
        groupId: groupIdSchema,
        userId: z.number().int().positive(),
        role: groupRoleSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireGroup(input.groupId);
      await requireGroupManager(input.groupId, ctx.user);
      const target = await db.getTeamGroupMembership(
        input.groupId,
        input.userId
      );
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "對象不是此組別的成員",
        });
      }
      await db.upsertTeamGroupMembership({
        groupId: input.groupId,
        userId: input.userId,
        role: input.role,
        addedByUserId: target.addedByUserId,
      });
      recordAuditEvent({
        actorUserId: ctx.user.id,
        actorRole: ctx.user.role,
        action: "teamGroup.updateMemberRole",
        targetType: "team_group",
        targetId: input.groupId,
        ...extractRequestSource(ctx.req),
        metadata: { userId: input.userId, role: input.role },
      });
      return { success: true };
    }),

  /**
   * 把成員移出組別（Admin / 該組 lead），或**本人自行離開**。
   * 歸屬處理（AIDV-297「成員離開」）：同一 transaction 內，該成員擁有且掛在
   * 此組的資源自動摘組（groupId→NULL）——離開＝把自己的資源帶走；要留給
   * 團隊請先走 AIDV-121 rbac.transferOwnership 交接再離開。
   */
  removeMember: protectedProcedure
    .input(
      z.object({
        groupId: groupIdSchema,
        userId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireGroup(input.groupId);
      const isSelfLeave = input.userId === ctx.user.id;
      if (!isSelfLeave) {
        await requireGroupManager(input.groupId, ctx.user);
      }
      const target = await db.getTeamGroupMembership(
        input.groupId,
        input.userId
      );
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "對象不是此組別的成員",
        });
      }
      await db.removeTeamGroupMemberAndDetachOwnedResources(
        input.groupId,
        input.userId
      );
      recordAuditEvent({
        actorUserId: ctx.user.id,
        actorRole: ctx.user.role,
        action: isSelfLeave ? "teamGroup.leave" : "teamGroup.removeMember",
        targetType: "team_group",
        targetId: input.groupId,
        ...extractRequestSource(ctx.req),
        metadata: { userId: input.userId },
      });
      return { success: true };
    }),

  // ── 資源歸屬 ──────────────────────────────────────────────────────────

  /**
   * 把資源掛進組別（groupId=數字）或摘組（groupId=null）。
   *   掛組：Admin，或「資源 owner 且為目標組組員」。
   *   摘組：Admin、資源 owner、或資源目前所屬組的 lead。
   */
  assignResource: protectedProcedure
    .input(
      z.object({
        resourceType: resourceTypeSchema,
        resourceId: z.number().int().positive(),
        groupId: groupIdSchema.nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const facts = await db.getResourceOwnerFacts(
        input.resourceType,
        input.resourceId
      );
      if (!facts) {
        throw new TRPCError({ code: "NOT_FOUND", message: "資源不存在" });
      }
      const admin = isSystemAdmin(ctx.user.role);
      const isOwner = facts.ownerId === ctx.user.id;

      if (input.groupId != null) {
        // 掛組：組別必須存在；Admin，或 owner 且為目標組組員。
        await requireGroup(input.groupId);
        if (!admin) {
          if (!isOwner) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "只有資源擁有者（或系統管理員）可以把資源掛進組別",
            });
          }
          const membership = await db.getTeamGroupMembership(
            input.groupId,
            ctx.user.id
          );
          if (!membership) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "你不是目標組別的成員，無法把資源掛進該組",
            });
          }
        }
      } else {
        // 摘組：Admin、owner、或資源目前所屬組的 lead。
        if (facts.groupId == null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "資源尚未歸屬任何組別",
          });
        }
        if (!admin && !isOwner) {
          const membership = await db.getTeamGroupMembership(
            facts.groupId,
            ctx.user.id
          );
          if (membership?.role !== "lead") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "只有系統管理員、資源擁有者或該組組長可以把資源摘組",
            });
          }
        }
      }

      await db.setResourceGroup(
        input.resourceType,
        input.resourceId,
        input.groupId
      );
      recordAuditEvent({
        actorUserId: ctx.user.id,
        actorRole: ctx.user.role,
        action: input.groupId != null ? "teamGroup.assignResource" : "teamGroup.unassignResource",
        targetType: input.resourceType,
        targetId: input.resourceId,
        ...extractRequestSource(ctx.req),
        metadata: { groupId: input.groupId, previousGroupId: facts.groupId },
      });
      return { success: true };
    }),
});
