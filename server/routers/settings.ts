import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";

// ─── System Settings ──────────────────────────────────────────────────────────

export const settingsRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const settings = await db.getSystemSettings(ctx.user.id);
    if (!settings) {
      return {
        uiTheme: "system" as const,
        accentColor: "violet",
        fontScale: "medium" as const,
        reducedMotion: false,
        sidebarCollapsed: false,
        analyticsConsent: false,
        crashReportConsent: false,
        shareUsageData: false,
        showProfilePublicly: false,
        autoBackupEnabled: true,
        backupFrequency: "weekly" as const,
        backupRetentionDays: 30,
        lastBackupAt: null,
        defaultModality: "image" as const,
        defaultCreativeMode: "balanced" as const,
        autoSaveHistory: true,
        nsfwFilter: true,
        emailNotifications: true,
        generationCompleteNotify: true,
        weeklyDigestEnabled: false,
        locale: "zh-TW",
        timezone: "Asia/Taipei",
        extraSettings: null,
      };
    }
    return settings;
  }),

  update: protectedProcedure
    .input(
      z.object({
        uiTheme: z.enum(["system", "light", "dark"]).optional(),
        accentColor: z.string().max(32).optional(),
        fontScale: z.enum(["small", "medium", "large"]).optional(),
        reducedMotion: z.boolean().optional(),
        sidebarCollapsed: z.boolean().optional(),
        analyticsConsent: z.boolean().optional(),
        crashReportConsent: z.boolean().optional(),
        shareUsageData: z.boolean().optional(),
        showProfilePublicly: z.boolean().optional(),
        autoBackupEnabled: z.boolean().optional(),
        backupFrequency: z.enum(["daily", "weekly", "monthly"]).optional(),
        backupRetentionDays: z.number().min(1).max(365).optional(),
        defaultModality: z
          .enum(["image", "video", "audio", "voice"])
          .optional(),
        defaultCreativeMode: z
          .enum(["balanced", "creative", "precise"])
          .optional(),
        autoSaveHistory: z.boolean().optional(),
        nsfwFilter: z.boolean().optional(),
        emailNotifications: z.boolean().optional(),
        generationCompleteNotify: z.boolean().optional(),
        weeklyDigestEnabled: z.boolean().optional(),
        locale: z.string().max(16).optional(),
        timezone: z.string().max(64).optional(),
        extraSettings: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await db.upsertSystemSettings(ctx.user.id, input);
      return { id, success: true };
    }),
});
