import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { agentPreferences } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getRecentOrbFeedback } from "../db";
import { DEFAULT_AGENT_PREFERENCES } from "../../shared/agent-preferences";
import { distillPreferenceProfile } from "../../shared/orb-preference-distiller";
import { getRecentOrbMemories } from "../services/orbMemory";
import { getOrbToolRegistry } from "../config/orbToolRegistry";

const CostBudgetSchema = z
  .object({
    perWorkflowCap: z.number().int().min(0).max(100_000).nullable().optional(),
    remainingCredits: z.number().int().min(0).max(1_000_000).nullable().optional(),
    confirmAtTierOrAbove: z
      .enum(["free", "cheap", "medium", "expensive", "premium"])
      .nullable()
      .optional(),
    alwaysAllow: z.boolean().nullable().optional(),
  })
  .nullable();

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
  // Per-page × per-action: { pageId: ["submit", "applyPreset", ...] }
  disabledActionsByPage: z
    .record(z.string().max(64), z.array(z.string().max(40)).max(20))
    .optional(),
  // Orb widget UI prefs
  orbWidgetCorner: z
    .enum(["bottom-right", "bottom-left", "top-right", "top-left"])
    .optional(),
  orbWelcomeMessage: z.string().max(280).nullable().optional(),
  orbShortcutEnabled: z.boolean().optional(),
  orbProactiveSuggestions: z.boolean().optional(),
  // ── Phase D ──────────────────────────────────────────────────────────
  costBudget: CostBudgetSchema.optional(),
  perceptionEnabled: z.boolean().optional(),
  perceptionStrictness: z.enum(["lenient", "balanced", "strict"]).optional(),
  criticEnabled: z.boolean().optional(),
  criticRefineBelow: z.number().int().min(0).max(100).optional(),
  roleAutoSwitch: z.boolean().optional(),
  pacingOverride: z.enum(["auto", "patient", "balanced", "impatient"]).optional(),
  /**
   * Acceptance: pass a Date (server-side) or an ISO string (client) — the
   * router coerces strings before persisting. `null` resets the flag.
   */
  onboardingCompletedAt: z
    .union([z.date(), z.string().datetime(), z.null()])
    .optional(),
  // 15 精靈關係偏好 — 兩個都是 AgentRole id 陣列。空陣列 = 沒人靜音 / 沒人加最愛。
  // 上限 15（總共也只有 15 位）— 防止使用者塞無關 id 進來把資料庫 bloat 起來。
  mutedSpirits: z.array(z.string().max(40)).max(15).optional(),
  favoriteSpirits: z.array(z.string().max(40)).max(15).optional(),
  // Phase 3: stay-on-page execution mode (auto-approve + server-side run).
  stayOnPageMode: z.boolean().optional(),

  // 主動精靈通知設定 — 每個 ProactiveTriggerEvent 一筆 entry。少寫的 event
  // 自動套 DEFAULT_PROACTIVE_TRIGGER_SETTINGS（全開、5 分鐘、需打勾）。
  // 上限 32 個 key 防止使用者塞奇怪 event 把 row 撐爆；單筆 minIntervalMs
  // 5 秒至 24 小時。
  proactiveTriggerSettings: z
    .record(
      z.string().max(64),
      z.object({
        enabled: z.boolean().optional(),
        minIntervalMs: z.number().int().min(5_000).max(86_400_000).optional(),
        requireAck: z.boolean().optional(),
      }),
    )
    .refine(map => Object.keys(map).length <= 32, "too many entries")
    .optional(),
});

async function ensurePreferences(userId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  await ensureAgentPreferencesSchema(db);
  const existing = await db.select().from(agentPreferences).where(eq(agentPreferences.userId, userId)).limit(1);
  if (existing[0]) return existing[0];

  await db.insert(agentPreferences).values({ userId, ...DEFAULT_AGENT_PREFERENCES });
  const created = await db.select().from(agentPreferences).where(eq(agentPreferences.userId, userId)).limit(1);
  return created[0];
}

let ensureSchemaOnce: Promise<void> | null = null;
async function ensureAgentPreferencesSchema(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  if (ensureSchemaOnce) return ensureSchemaOnce;
  ensureSchemaOnce = (async () => {
    const addColumnIfMissing = async (columnName: string, definitionSql: string) => {
      const existsRows = (await db.execute(sql`
        SELECT EXISTS(
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = DATABASE()
            AND table_name = 'agent_preferences'
            AND column_name = ${columnName}
        ) AS existsFlag
      `)) as unknown as Array<{ existsFlag: number }>;
      const existsFlag = Number(existsRows[0]?.existsFlag ?? 0);
      if (existsFlag === 1) return;
      await db.execute(sql.raw(`ALTER TABLE agent_preferences ADD COLUMN ${definitionSql}`));
    };

    await addColumnIfMissing("preferredSpecialistAgent", "preferredSpecialistAgent varchar(64) NULL");
    await addColumnIfMissing("specialistAutoActivate", "specialistAutoActivate boolean NOT NULL DEFAULT true");
    await addColumnIfMissing("specialistProactiveMode", "specialistProactiveMode boolean NOT NULL DEFAULT true");
    await addColumnIfMissing("specialistLearningEnabled", "specialistLearningEnabled boolean NOT NULL DEFAULT true");
    await addColumnIfMissing("disabledSpecialistAgents", "disabledSpecialistAgents json NOT NULL");
    // 15 精靈關係偏好欄位（mute / favorite）— 比 disabledSpecialistAgents 後加。
    // 預設 NULL，下面 UPDATE 把 NULL 補成空陣列，避免 ORM 拿到 null 拋型別錯誤。
    await addColumnIfMissing("mutedSpirits", "mutedSpirits json NULL");
    await addColumnIfMissing("favoriteSpirits", "favoriteSpirits json NULL");
    // Phase 3: stay-on-page execution mode (auto-approve tasks + run them
    // server-side instead of routing the user away). Defaults false so
    // existing rows keep the legacy navigate-and-fillPrompt UX.
    await addColumnIfMissing(
      "stayOnPageMode",
      "stayOnPageMode boolean NOT NULL DEFAULT false"
    );
    // 主動精靈通知偏好（per-event enable / interval / requireAck），同樣 NULL→{}。
    await addColumnIfMissing("proactiveTriggerSettings", "proactiveTriggerSettings json NULL");

    await db.execute(sql`
      UPDATE agent_preferences
      SET disabledSpecialistAgents = JSON_ARRAY()
      WHERE disabledSpecialistAgents IS NULL
    `);
    await db.execute(sql`
      UPDATE agent_preferences
      SET mutedSpirits = JSON_ARRAY()
      WHERE mutedSpirits IS NULL
    `);
    await db.execute(sql`
      UPDATE agent_preferences
      SET favoriteSpirits = JSON_ARRAY()
      WHERE favoriteSpirits IS NULL
    `);
    await db.execute(sql`
      UPDATE agent_preferences
      SET proactiveTriggerSettings = JSON_OBJECT()
      WHERE proactiveTriggerSettings IS NULL
    `);
  })().catch(err => {
    ensureSchemaOnce = null;
    throw err;
  });
  return ensureSchemaOnce;
}

export const agentPreferencesRouter = router({
  getPreferences: protectedProcedure.query(async ({ ctx }) => ensurePreferences(ctx.user.id)),
  updatePreferences: protectedProcedure.input(UpdateSchema).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    await ensurePreferences(ctx.user.id);
    // Coerce ISO-string onboarding completion (the only field where the
    // client may send a string instead of Date) — Drizzle's mysql2 driver
    // accepts Date but rejects bare strings.
    const patch: Record<string, unknown> = { ...input };
    if (typeof patch.onboardingCompletedAt === "string") {
      patch.onboardingCompletedAt = new Date(patch.onboardingCompletedAt);
    }
    await db.update(agentPreferences).set(patch).where(and(eq(agentPreferences.userId, ctx.user.id)));
    const rows = await db.select().from(agentPreferences).where(eq(agentPreferences.userId, ctx.user.id)).limit(1);
    return rows[0];
  }),

  /**
   * Surface the registered orb tools so the 代理設定 panel can show users
   * a real picker instead of asking them to type tool names into a
   * textarea. Returns minimal metadata (no headers / endpoints) so the
   * registry's secrets stay server-side.
   */
  listAvailableTools: protectedProcedure.query(() => {
    return getOrbToolRegistry().map(tool => ({
      name: tool.name,
      description: tool.description,
      method: tool.method,
      riskLevel: tool.riskLevel ?? "low",
      requireConfirmation: Boolean(tool.requireConfirmation),
    }));
  }),

  /**
   * Distil the user's feedback + memory history into a single profile so
   * /settings/agent can render an "光球已經記得這些事" inspector card.
   * Wraps the same `distillPreferenceProfile` the chat router uses, so
   * what the user sees in the settings page IS what the planner sees.
   */
  getDistilledProfile: protectedProcedure.query(async ({ ctx }) => {
    const dbFeedback = await getRecentOrbFeedback(ctx.user.id, 30).catch(() => []);
    const feedbackEvents = dbFeedback.map(row => ({
      at: row.createdAt instanceof Date
        ? row.createdAt.getTime()
        : new Date(row.createdAt as unknown as string).getTime(),
      status: row.status,
      actionType: row.actionType,
      note: row.note ?? undefined,
      pageId: row.pageId ?? undefined,
    }));
    // getRecentOrbMemories is sync — wrap in try/catch instead of .catch().
    let memories: Awaited<ReturnType<typeof getRecentOrbMemories>> = [];
    try {
      memories = getRecentOrbMemories({ userId: ctx.user.id, limit: 30 });
    } catch {
      memories = [];
    }
    const profile = distillPreferenceProfile({ feedbackEvents, memories });
    // Return a leaner shape — the inspector only needs the headline
    // numbers, not the entire breakdown structure.
    return {
      totalEvents: profile.totalEvents,
      totalMemoriesConsidered: profile.totalMemoriesConsidered,
      confidence: profile.confidence,
      pacingTier: profile.pacingTier,
      preferredModels: profile.preferredModels,
      avoidedModels: profile.avoidedModels,
      actionAcceptance: Object.entries(profile.actionAcceptance)
        .sort((a, b) => (b[1].accepted + b[1].rejected) - (a[1].accepted + a[1].rejected))
        .slice(0, 8)
        .map(([type, stat]) => ({ type, ...stat })),
    };
  }),

  /**
   * Flat activity feed for the settings-page 概覽 tab. Unlike
   * `getDistilledProfile` (which collapses everything into ratios) this
   * returns one row per event so the user can see what the orb actually
   * did and when. Capped at 50.
   */
  getRecentActivity: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const rows = await getRecentOrbFeedback(ctx.user.id, limit).catch(() => []);
      return {
        events: rows.map(row => ({
          id: row.id,
          at: row.createdAt instanceof Date
            ? row.createdAt.getTime()
            : new Date(row.createdAt as unknown as string).getTime(),
          status: row.status,
          actionType: row.actionType,
          note: row.note ?? null,
          pageId: row.pageId ?? null,
        })),
      };
    }),
});
