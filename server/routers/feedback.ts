import { z } from "zod";
import { router, adminProcedure, protectedProcedure } from "../_core/trpc";
import * as db from "../db";

// ─── Feedback ─────────────────────────────────────────────────────────────────

export const feedbackRouter = router({
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
        // AIDV-864: 快速情境回饋擴充（PR①）— 皆 optional
        featureArea: z.string().max(120).optional(),
        pageContext: z.object({
          route: z.string().optional(),
          url: z.string().optional(),
          shell: z.string().optional(),
          viewport: z.string().optional(),
          appVersion: z.string().optional(),
        }).optional(),
        landmark: z.object({
          selector: z.string().max(2000).optional(),
          label: z.string().max(300).optional(),
          rect: z.object({
            x: z.number().optional(),
            y: z.number().optional(),
            w: z.number().optional(),
            h: z.number().optional(),
          }).optional(),
          textSnippet: z.string().max(500).optional(),
        }).optional(),
        screenshotKey: z.string().max(512).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await db.createFeedbackReport({
        userId: ctx.user.id,
        ...input,
      });
      const categoryLabels: Record<string, string> = {
        bug: "錯誤回報",
        feature_request: "功能詢問",
        quality_issue: "品質問題",
        general: "一般意見",
      };
      try {
        const { notifyOwner } = await import("../_core/notification");
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
});
