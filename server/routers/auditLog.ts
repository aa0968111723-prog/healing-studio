/**
 * auditLog.ts — Admin 稽核軌跡查詢 tRPC Router（AIDV-123）
 * ──────────────────────────────────────────────────────────────────────────
 * 全 adminProcedure、**唯讀**。提供：
 *   - events  : 依 actor / action / targetType / 時間過濾 + 分頁查詢
 *   - export  : 同過濾條件、回扁平 rows 給前端組 CSV（無分頁上限放寬）
 *
 * 不可竄改：本 router 沒有任何 mutation（無寫/改/刪稽核的端點）。
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { queryAuditEvents, countAuditEvents } from "../services/audit/auditLog";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const filterSchema = z
  .object({
    actorUserId: z.number().int().positive().optional(),
    action: z.string().min(1).max(100).optional(),
    targetType: z.string().min(1).max(50).optional(),
    startDate: dateStr.optional(),
    endDate: dateStr.optional(),
  })
  .partial();

export const auditLogRouter = router({
  // ── 分頁查詢 ────────────────────────────────────────────────────────────
  events: adminProcedure
    .input(
      filterSchema
        .extend({
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const filter = input ?? { limit: 50, offset: 0 };
      const [events, total] = await Promise.all([
        queryAuditEvents(filter),
        countAuditEvents(filter),
      ]);
      return { events, total };
    }),

  // ── 匯出（CSV 用）──────────────────────────────────────────────────────
  export: adminProcedure
    .input(filterSchema.optional())
    .query(async ({ input }) => {
      // 匯出放寬上限（不分頁），同過濾條件。
      const rows = await queryAuditEvents({
        ...(input ?? {}),
        limit: 10_000,
        offset: 0,
      });
      return {
        rows: rows.map(r => ({
          id: r.id,
          actorUserId: r.actorUserId,
          actorRole: r.actorRole,
          action: r.action,
          targetType: r.targetType,
          targetId: r.targetId,
          result: r.result,
          ipAddress: r.ipAddress,
          userAgent: r.userAgent,
          createdAt: r.createdAt,
        })),
      };
    }),
});
