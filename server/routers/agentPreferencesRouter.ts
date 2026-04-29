import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { agentPreferences } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { DEFAULT_AGENT_PREFERENCES } from "../../shared/agent-preferences";

const UpdateSchema = z.object({
  confirmationPolicy: z.enum(["always_approve", "confirm_high_risk", "confirm_all", "manual"]).optional(),
  allowedRiskLevels: z.array(z.string()).optional(),
  autoApproveTools: z.array(z.string()).optional(),
  blockedTools: z.array(z.string()).optional(),
  maxAutoStepsPerTask: z.number().int().min(1).max(20).optional(),
  notifyOnCompletion: z.boolean().optional(),
  notifyOnError: z.boolean().optional(),
  // Voice (orb 助手)
  voiceEnabled: z.boolean().optional(),
  preferredVoiceName: z.enum(["Puck", "Charon", "Kore", "Fenrir", "Aoede"]).optional(),
  voiceAutoActivate: z.boolean().optional(),
  // Per-user env-flag overrides (null = follow env)
  orbAgentEnabled: z.boolean().nullable().optional(),
  workflowsEnabled: z.boolean().nullable().optional(),
  // Per-page agent disable list
  disabledPageAgents: z.array(z.string().max(64)).max(64).optional(),
  // Orb widget UI prefs
  orbWidgetCorner: z
    .enum(["bottom-right", "bottom-left", "top-right", "top-left"])
    .optional(),
  orbWelcomeMessage: z.string().max(280).nullable().optional(),
  orbShortcutEnabled: z.boolean().optional(),
  orbProactiveSuggestions: z.boolean().optional(),
});

async function ensurePreferences(userId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  const existing = await db.select().from(agentPreferences).where(eq(agentPreferences.userId, userId)).limit(1);
  if (existing[0]) return existing[0];

  await db.insert(agentPreferences).values({ userId, ...DEFAULT_AGENT_PREFERENCES });
  const created = await db.select().from(agentPreferences).where(eq(agentPreferences.userId, userId)).limit(1);
  return created[0];
}

export const agentPreferencesRouter = router({
  getPreferences: protectedProcedure.query(async ({ ctx }) => ensurePreferences(ctx.user.id)),
  updatePreferences: protectedProcedure.input(UpdateSchema).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    await ensurePreferences(ctx.user.id);
    await db.update(agentPreferences).set({ ...input }).where(and(eq(agentPreferences.userId, ctx.user.id)));
    const rows = await db.select().from(agentPreferences).where(eq(agentPreferences.userId, ctx.user.id)).limit(1);
    return rows[0];
  }),
});
