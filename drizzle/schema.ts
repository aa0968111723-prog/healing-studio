import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  json,
  boolean,
  decimal,
  bigint,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

// ─── Users ─────────────────────────────────────────────────────────────────
export const users = mysqlTable(
  "users",
  {
    id: int("id").autoincrement().primaryKey(),
    openId: varchar("openId", { length: 64 }).notNull().unique(),
    name: text("name"),
    email: varchar("email", { length: 320 }),
    loginMethod: varchar("loginMethod", { length: 64 }),
    passwordHash: varchar("passwordHash", { length: 255 }),
    /** Base32-encoded TOTP secret (RFC 6238). Null when 2FA is not configured. */
    twoFactorSecret: varchar("twoFactorSecret", { length: 64 }),
    /** Whether 2FA verification is required at login. */
    twoFactorEnabled: boolean("twoFactorEnabled").default(false).notNull(),
    emailVerified: boolean("emailVerified").default(false).notNull(),
    emailVerifiedAt: timestamp("emailVerifiedAt"),
    role: mysqlEnum("role", ["user", "leader", "admin"])
      .default("user")
      .notNull(),
    /** Per-modality quota JSON */
    quotaJson: json("quotaJson").$type<{
      image: number;
      video: number;
      audio: number;
      voice: number;
    }>(),
    autoCreditEnabled: boolean("autoCreditEnabled").default(false).notNull(),
    autoCreditAmount: int("autoCreditAmount").default(0).notNull(),
    autoCreditIntervalDays: int("autoCreditIntervalDays").default(7).notNull(),
    autoCreditNextAt: timestamp("autoCreditNextAt"),
    autoCreditLastAt: timestamp("autoCreditLastAt"),
    remainingGenerations: int("remainingGenerations").default(50).notNull(),
    onboardingDone: boolean("onboardingDone").default(false).notNull(),
    /** User-controlled avatar (preset id, AI-generated URL, or data URL ≤ 64 KB). Null = use initials. */
    avatarUrl: text("avatarUrl"),
    /** Opaque token for the public ICS feed at /api/ics/<token>.ics. Rotating revokes existing subscriptions. */
    icsFeedToken: varchar("icsFeedToken", { length: 64 }),
    /** Global orb condensed conversation memory (latest summary). */
    orbMemorySummary: text("orbMemorySummary"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  },
  table => ({
    // Email lookup index — used by local auth login and admin queries
    emailIdx: index("users_email_idx").on(table.email),
    // Role index — used by admin user listing queries
    roleIdx: index("users_role_idx").on(table.role),
    // Auto-credit scheduling index — used by the auto-credit cron job
    autoCreditNextAtIdx: index("users_autoCreditNextAt_idx").on(table.autoCreditNextAt),
    icsFeedTokenIdx: uniqueIndex("users_icsFeedToken_idx").on(table.icsFeedToken),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const agentPreferences = mysqlTable(
  "agent_preferences",
  {
    userId: int("userId").notNull().primaryKey(),
    confirmationPolicy: mysqlEnum("confirmationPolicy", [
      "always_approve",
      "confirm_high_risk",
      "confirm_all",
      "manual",
    ]).default("confirm_high_risk").notNull(),
    allowedRiskLevels: json("allowedRiskLevels").$type<string[]>().notNull(),
    autoApproveTools: json("autoApproveTools").$type<string[]>().notNull(),
    blockedTools: json("blockedTools").$type<string[]>().notNull(),
    maxAutoStepsPerTask: int("maxAutoStepsPerTask").default(5).notNull(),
    notifyOnCompletion: boolean("notifyOnCompletion").default(true).notNull(),
    notifyOnError: boolean("notifyOnError").default(true).notNull(),
    // ── Voice (光球助手語音) ──────────────────────────────────────────
    voiceEnabled: boolean("voiceEnabled").default(false).notNull(),
    preferredVoiceName: mysqlEnum("preferredVoiceName", [
      "Puck",
      "Charon",
      "Kore",
      "Fenrir",
      "Aoede",
    ]).default("Puck").notNull(),
    voiceAutoActivate: boolean("voiceAutoActivate").default(false).notNull(),
    // ── Per-user kill switch / workflow override ──────────────────────
    // null = follow env flag; true/false = explicit user override.
    orbAgentEnabled: boolean("orbAgentEnabled"),
    workflowsEnabled: boolean("workflowsEnabled"),
    // ── Per-page agent disable list (json array of pageIds) ──────────
    disabledPageAgents: json("disabledPageAgents").$type<string[]>().default([]).notNull(),
    // ── Per-page × per-action 細模許可 (Record<pageId, string[]>) ──
    disabledActionsByPage: json("disabledActionsByPage")
      .$type<Record<string, string[]>>()
      .default({})
      .notNull(),
    // ── Orb assistant UI prefs ───────────────────────────────────────
    orbWidgetCorner: mysqlEnum("orbWidgetCorner", [
      "bottom-right",
      "bottom-left",
      "top-right",
      "top-left",
    ]).default("bottom-right").notNull(),
    orbWelcomeMessage: text("orbWelcomeMessage"),
    orbShortcutEnabled: boolean("orbShortcutEnabled").default(true).notNull(),
    orbProactiveSuggestions: boolean("orbProactiveSuggestions").default(true).notNull(),
    // ── Phase D: cost / perception / critic / pacing / onboarding ──
    costBudget: json("costBudget").$type<{
      perWorkflowCap?: number | null;
      remainingCredits?: number | null;
      confirmAtTierOrAbove?: "free" | "cheap" | "medium" | "expensive" | "premium" | null;
      alwaysAllow?: boolean | null;
    } | null>().default(null),
    perceptionEnabled: boolean("perceptionEnabled").default(true).notNull(),
    perceptionStrictness: mysqlEnum("perceptionStrictness", [
      "lenient",
      "balanced",
      "strict",
    ]).default("balanced").notNull(),
    criticEnabled: boolean("criticEnabled").default(false).notNull(),
    criticRefineBelow: int("criticRefineBelow").default(75).notNull(),
    roleAutoSwitch: boolean("roleAutoSwitch").default(true).notNull(),
    pacingOverride: mysqlEnum("pacingOverride", [
      "auto",
      "patient",
      "balanced",
      "impatient",
    ]).default("auto").notNull(),
    onboardingCompletedAt: timestamp("onboardingCompletedAt"),
    // ── Specialized Agent Preferences ─────────────────────────────────
    preferredSpecialistAgent: varchar("preferredSpecialistAgent", { length: 64 }),
    specialistAutoActivate: boolean("specialistAutoActivate").default(true).notNull(),
    specialistProactiveMode: boolean("specialistProactiveMode").default(true).notNull(),
    specialistLearningEnabled: boolean("specialistLearningEnabled").default(true).notNull(),
    disabledSpecialistAgents: json("disabledSpecialistAgents").$type<string[]>().default([]).notNull(),
    // ── 15 精靈關係偏好 ───────────────────────────────────────────────
    // Spirits the user has muted (skipped during selectRoleForIntent
    // routing) and the ones they've starred. Both are AgentRole id arrays
    // (e.g. ["accountant", "inspector"]). Empty defaults — feature is
    // additive, existing rows keep working without migration backfill.
    mutedSpirits: json("mutedSpirits").$type<string[]>().default([]).notNull(),
    favoriteSpirits: json("favoriteSpirits").$type<string[]>().default([]).notNull(),
    // ── Phase 3: stay-on-page execution mode ─────────────────────────
    // When true the orb auto-approves tasked plans and drives them
    // entirely server-side instead of navigating the user. Defaults to
    // false so existing rows keep the legacy navigate-and-fillPrompt UX.
    stayOnPageMode: boolean("stayOnPageMode").default(false).notNull(),
    // 主動精靈通知設定 — 每個 ProactiveTriggerEvent 的 enable / interval /
    // requireAck override；空 object 等於每個事件都套 DEFAULT_PROACTIVE_TRIGGER_SETTINGS
    // （全開、5 分鐘間隔、需要打勾才消失）。新增 trigger event 不需 migrate。
    proactiveTriggerSettings: json("proactiveTriggerSettings")
      .$type<Record<string, { enabled?: boolean; minIntervalMs?: number; requireAck?: boolean }>>()
      .default({})
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("agent_preferences_user_id_idx").on(table.userId),
  })
);

// ─── Orb Scheduled Jobs ─────────────────────────────────────────────────
// User-defined cron jobs for the global orb agent. Persisted so that
// schedules survive server restarts and multi-instance deployments —
// the in-process node-cron registry is rebuilt from this table on boot.
export const orbScheduledJobs = mysqlTable(
  "orb_scheduled_jobs",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    userId: int("userId").notNull(),
    cronExpression: varchar("cronExpression", { length: 128 }).notNull(),
    taskDescription: text("taskDescription").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    lastRunAt: timestamp("lastRunAt"),
    lastError: text("lastError"),
    lastResult: text("lastResult"),
    lastRunStatus: varchar("lastRunStatus", { length: 32 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("orb_scheduled_jobs_user_id_idx").on(table.userId),
  })
);

export type OrbScheduledJobRow = typeof orbScheduledJobs.$inferSelect;
export type InsertOrbScheduledJob = typeof orbScheduledJobs.$inferInsert;

// ─── Password Reset Tokens ───────────────────────────────────────────────
export const passwordResetTokens = mysqlTable(
  "password_reset_tokens",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
    expiresAt: timestamp("expiresAt").notNull(),
    used: boolean("used").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("prt_userId_idx").on(table.userId),
    tokenHashIdx: index("prt_tokenHash_idx").on(table.tokenHash),
    expiresAtIdx: index("prt_expiresAt_idx").on(table.expiresAt),
  })
);

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;

// ─── Email Verification Tokens ───────────────────────────────────────────
export const emailVerificationTokens = mysqlTable(
  "email_verification_tokens",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    newEmail: varchar("newEmail", { length: 320 }).notNull(),
    tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
    expiresAt: timestamp("expiresAt").notNull(),
    used: boolean("used").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("evt_userId_idx").on(table.userId),
    tokenHashIdx: index("evt_tokenHash_idx").on(table.tokenHash),
    expiresAtIdx: index("evt_expiresAt_idx").on(table.expiresAt),
  })
);

export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type InsertEmailVerificationToken = typeof emailVerificationTokens.$inferInsert;

// ─── Login History ────────────────────────────────────────────────────────
export const loginHistory = mysqlTable(
  "login_history",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    email: varchar("email", { length: 320 }),
    success: boolean("success").default(true).notNull(),
    ipAddress: varchar("ipAddress", { length: 45 }),
    userAgent: text("userAgent"),
    device: varchar("device", { length: 100 }),
    browser: varchar("browser", { length: 100 }),
    os: varchar("os", { length: 100 }),
    country: varchar("country", { length: 100 }),
    city: varchar("city", { length: 100 }),
    failureReason: varchar("failureReason", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("lh_userId_idx").on(table.userId),
    userIdCreatedAtIdx: index("lh_userId_createdAt_idx").on(
      table.userId,
      table.createdAt
    ),
    emailIdx: index("lh_email_idx").on(table.email),
  })
);

export type LoginHistory = typeof loginHistory.$inferSelect;
export type InsertLoginHistory = typeof loginHistory.$inferInsert;

// ─── Background Jobs ─────────────────────────────────────────────────────
export const backgroundJobs = mysqlTable(
  "background_jobs",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    jobType: mysqlEnum("jobType", [
      "image",
      "video",
      "audio",
      "voice",
      "zip_export",
      "multimodal",
      "model_training",
    ]).notNull(),
    status: mysqlEnum("status", [
      "queued",
      "processing",
      "completed",
      "failed",
      "cancelled",
    ])
      .default("queued")
      .notNull(),
    progress: int("progress").default(0).notNull(),
    progressMessage: text("progressMessage"),
    resultJson: json("resultJson"),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdStatusIdx: index("userId_status_idx").on(table.userId, table.status),
    userIdCreatedAtIdx: index("userId_createdAt_idx").on(
      table.userId,
      table.createdAt
    ),
  })
);

export type BackgroundJob = typeof backgroundJobs.$inferSelect;
export type InsertBackgroundJob = typeof backgroundJobs.$inferInsert;

// ─── Digital Asset Library ───────────────────────────────────────────────
export const digitalAssetLibrary = mysqlTable(
  "digital_asset_library",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    assetType: mysqlEnum("assetType", [
      "image",
      "video",
      "audio",
      "voice",
      "script",
      "zip_bundle",
    ]).notNull(),
    fileUrl: text("fileUrl"),
    fileKey: text("fileKey"),
    thumbnailUrl: text("thumbnailUrl"),
    mimeType: varchar("mimeType", { length: 128 }),
    fileSizeBytes: int("fileSizeBytes"),
    promptUsed: text("promptUsed"),
    isPublicRecycled: boolean("isPublicRecycled").default(false).notNull(),
    visibility: mysqlEnum("visibility", ["private", "team_shared"])
      .default("private")
      .notNull(),
    rewardCredits: int("rewardCredits").default(0).notNull(),
    // 0045: notes-curator (記記) tagging / category — both nullable to keep
    // existing rows valid; populated through notesCurator.tagAssets and
    // notesCurator.categorizeAsset.
    tags: json("tags").$type<string[]>(),
    category: varchar("category", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("dal_userId_idx").on(table.userId),
    userIdAssetTypeIdx: index("dal_userId_assetType_idx").on(
      table.userId,
      table.assetType
    ),
    userIdCreatedAtIdx: index("dal_userId_createdAt_idx").on(
      table.userId,
      table.createdAt
    ),
    userIdCategoryIdx: index("dal_userId_category_idx").on(
      table.userId,
      table.category
    ),
  })
);

export type DigitalAsset = typeof digitalAssetLibrary.$inferSelect;
export type InsertDigitalAsset = typeof digitalAssetLibrary.$inferInsert;

// ─── Fine-Tuned Models ──────────────────────────────────────────────────
export const fineTunedModels = mysqlTable(
  "fine_tuned_models",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    modelType: mysqlEnum("modelType", [
      "image_subject",
      "voice_clone",
      "style_lora",
      "scene_lora",
      "video_lora",
      "portrait_lora",
    ]).notNull(),
    status: mysqlEnum("status", ["pending", "training", "ready", "failed"])
      .default("pending")
      .notNull(),
    fileUrl: text("fileUrl"), // 訓練資料 ZIP 或原始資料集 URL
    fileKey: text("fileKey"),
    /** 訓練完成後由 Replicate / Fal.ai 回傳的 LoRA weights URL (.safetensors / .tar) */
    trainedLoraUrl: text("trainedLoraUrl"),
    /** Replicate prediction ID 或 Fal.ai request ID，用於狀態追蹤 */
    replicatePredictionId: varchar("replicatePredictionId", { length: 128 }),
    /** 訓練引擎：replicate 或 fal（新增以區分不同 API 來源） */
    trainingEngine: mysqlEnum("trainingEngine", ["replicate", "fal"]).default(
      "replicate"
    ),
    configJson: json("configJson").$type<{
      triggerWord?: string;
      epochs?: number;
      learningRate?: number;
      batchSize?: number;
      steps?: number;
      zipUrl?: string;
      predictionId?: string;
      falRequestId?: string;
      falModelId?: string;
      isStyle?: boolean;
      submittedAt?: number;
      completedAt?: number;
      datasetImages?: Array<{
        url: string;
        fileKey: string;
        angle: string;
        caption?: string;
      }>;
      datasetVideos?: Array<{ url: string; fileKey: string; caption?: string }>;
    }>(),
    /** 使用計數（被引用生成幾次） */
    usageCount: int("usageCount").default(0).notNull(),
    visibility: mysqlEnum("visibility", ["private", "team_shared"])
      .default("private")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdStatusIdx: index("ftm_userId_status_idx").on(
      table.userId,
      table.status
    ),
    userIdCreatedAtIdx: index("ftm_userId_createdAt_idx").on(
      table.userId,
      table.createdAt
    ),
  })
);

export type FineTunedModel = typeof fineTunedModels.$inferSelect;
export type InsertFineTunedModel = typeof fineTunedModels.$inferInsert;

// ─── Project Notes & Calendar ────────────────────────────────────────────
export const projectNotesCalendar = mysqlTable(
  "project_notes_calendar",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    content: text("content"),
    scriptJson: json("scriptJson"),
    noteType: mysqlEnum("noteType", ["note", "script", "calendar_event"])
      .default("note")
      .notNull(),
    status: mysqlEnum("status", ["todo", "in_progress", "done"])
      .default("todo")
      .notNull(),
    scheduledDate: timestamp("scheduledDate"),
    endDate: timestamp("endDate"),
    reminderMinutes: int("reminderMinutes"),
    location: json("location").$type<{
      name: string;
      address?: string;
      lat?: number;
      lng?: number;
      placeId?: string;
    }>(),
    meetingUrl: varchar("meetingUrl", { length: 512 }),
    tags: json("tags").$type<string[]>(),
    // 0045: 記記 categorisation — orthogonal to noteType (生活 / 工作 /
    // 創作 etc.). Nullable so legacy rows remain valid.
    category: varchar("category", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("pnc_userId_idx").on(table.userId),
    userIdNoteTypeIdx: index("pnc_userId_noteType_idx").on(
      table.userId,
      table.noteType
    ),
    userIdScheduledDateIdx: index("pnc_userId_scheduledDate_idx").on(
      table.userId,
      table.scheduledDate
    ),
    userIdStatusIdx: index("pnc_userId_status_idx").on(
      table.userId,
      table.status
    ),
    userIdCategoryIdx: index("pnc_userId_category_idx").on(
      table.userId,
      table.category
    ),
  })
);

export type ProjectNote = typeof projectNotesCalendar.$inferSelect;
export type InsertProjectNote = typeof projectNotesCalendar.$inferInsert;

// ─── Google OAuth Tokens (per scope/purpose) ────────────────────────────
// Login uses openid/email/profile only. Optional scopes (Drive, Calendar
// API) are obtained via incremental OAuth and stored here keyed by
// `(userId, purpose)`. The Drive client refreshes `accessToken` against
// `refreshToken` when `expiresAt` passes.
export const userGoogleOauthTokens = mysqlTable(
  "user_google_oauth_tokens",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    purpose: varchar("purpose", { length: 32 }).default("drive").notNull(),
    accessToken: text("accessToken").notNull(),
    refreshToken: text("refreshToken"),
    scope: text("scope").notNull(),
    tokenType: varchar("tokenType", { length: 32 }).default("Bearer").notNull(),
    expiresAt: timestamp("expiresAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdx: index("user_google_oauth_tokens_user_idx").on(table.userId),
    userPurposeUk: uniqueIndex("user_google_oauth_tokens_user_purpose_uk").on(
      table.userId,
      table.purpose
    ),
  })
);

export type UserGoogleOauthToken = typeof userGoogleOauthTokens.$inferSelect;
export type InsertUserGoogleOauthToken = typeof userGoogleOauthTokens.$inferInsert;

// ─── Drive Asset Libraries ──────────────────────────────────────────────
// Pinned Google Drive folders that the user wants treated as a "shoot"
// or "personal" asset library. We only store metadata; the actual files
// are fetched live from Drive via the user's stored OAuth token.
export const driveAssetLibraries = mysqlTable(
  "drive_asset_libraries",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    label: varchar("label", { length: 128 }).notNull(),
    kind: mysqlEnum("kind", ["shoot", "personal", "other"]).default("shoot").notNull(),
    driveFolderId: varchar("driveFolderId", { length: 128 }).notNull(),
    driveFolderName: varchar("driveFolderName", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdx: index("drive_asset_libraries_user_idx").on(table.userId),
    userKindIdx: index("drive_asset_libraries_user_kind_idx").on(
      table.userId,
      table.kind
    ),
  })
);

export type DriveAssetLibrary = typeof driveAssetLibraries.$inferSelect;
export type InsertDriveAssetLibrary = typeof driveAssetLibraries.$inferInsert;

// ─── User Feedback Reports ───────────────────────────────────────────────
export const userFeedbackReports = mysqlTable(
  "user_feedback_reports",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    category: mysqlEnum("category", [
      "bug",
      "feature_request",
      "quality_issue",
      "general",
    ])
      .default("general")
      .notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    status: mysqlEnum("status", ["open", "in_progress", "resolved", "closed"])
      .default("open")
      .notNull(),
    priority: mysqlEnum("priority", ["low", "medium", "high", "critical"])
      .default("medium")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdStatusIdx: index("userId_status_idx").on(table.userId, table.status),
    userIdCreatedAtIdx: index("userId_createdAt_idx").on(
      table.userId,
      table.createdAt
    ),
  })
);

export type UserFeedback = typeof userFeedbackReports.$inferSelect;
export type InsertUserFeedback = typeof userFeedbackReports.$inferInsert;

// ─── API Usage Logs ──────────────────────────────────────────────────────
export const apiUsageLogs = mysqlTable(
  "api_usage_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    requestType: mysqlEnum("requestType", [
      "image_generation",
      "video_generation",
      "audio_generation",
      "voice_dubbing",
      "prompt_expansion",
      "safety_check",
      "director_ai",
    ]).notNull(),
    apiProvider: varchar("apiProvider", { length: 64 }).notNull(),
    tokensUsed: int("tokensUsed").default(0),
    videoSeconds: int("videoSeconds").default(0),
    audioCharacters: int("audioCharacters").default(0),
    sunoCredits: int("sunoCredits").default(0),
    estimatedCostUsd: decimal("estimatedCostUsd", {
      precision: 10,
      scale: 6,
    }).default("0"),
    requestPayload: json("requestPayload"),
    responseStatus: mysqlEnum("responseStatus", [
      "success",
      "failed",
      "timeout",
      "blocked",
    ])
      .default("success")
      .notNull(),
    errorMessage: text("errorMessage"),
    generationsDeducted: int("generationsDeducted").default(0),
    model: varchar("model", { length: 128 }),
    inputTokens: int("inputTokens"),
    outputTokens: int("outputTokens"),
    modalityParams: json("modalityParams").$type<Record<string, unknown>>(),
    costCredits: int("costCredits").default(1).notNull(),
    durationMs: int("durationMs"),
    success: boolean("success").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdCreatedAtIdx: index("aul_userId_createdAt_idx").on(
      table.userId,
      table.createdAt
    ),
    userIdProviderIdx: index("aul_userId_provider_idx").on(
      table.userId,
      table.apiProvider
    ),
  })
);

export type ApiUsageLog = typeof apiUsageLogs.$inferSelect;
export type InsertApiUsageLog = typeof apiUsageLogs.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// NEW TABLES — Phase 1 Foundation Repair
// ═══════════════════════════════════════════════════════════════════════════

// ─── Consistency Vault ───────────────────────────────────────────────────
export const consistencyVault = mysqlTable(
  "consistency_vault",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    itemType: mysqlEnum("itemType", ["character", "scene"]).notNull(),
    imageUrl: text("imageUrl").notNull(),
    fileKey: text("fileKey"),
    tags: json("tags").$type<string[]>(),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("cv_userId_idx").on(table.userId),
    userIdItemTypeIdx: index("cv_userId_itemType_idx").on(
      table.userId,
      table.itemType
    ),
  })
);

export type ConsistencyVaultItem = typeof consistencyVault.$inferSelect;
export type InsertConsistencyVaultItem = typeof consistencyVault.$inferInsert;

// ─── Subscription Plans ──────────────────────────────────────────────────
export const subscriptionPlans = mysqlTable("subscription_plans", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  tier: mysqlEnum("tier", ["free", "starter", "pro", "enterprise"])
    .default("free")
    .notNull(),
  priceMonthly: int("priceMonthly").default(0).notNull(),
  quotaAllocation: json("quotaAllocation")
    .$type<{
      image: number;
      video: number;
      audio: number;
      voice: number;
    }>()
    .notNull(),
  features: json("features").$type<Record<string, boolean>>(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type InsertSubscriptionPlan = typeof subscriptionPlans.$inferInsert;

// ─── AI Director Preferences ────────────────────────────────────────────
export const aiDirectorPreferences = mysqlTable(
  "ai_director_preferences",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    personality: mysqlEnum("personality", ["calm", "creative", "technical"])
      .default("creative")
      .notNull(),
    preferredFormat: mysqlEnum("preferredFormat", [
      "co-star",
      "sslcm",
      "selcm",
      "free",
    ])
      .default("co-star")
      .notNull(),
    customSystemPrompt: text("customSystemPrompt"),
    preferencesJson: json("preferencesJson").$type<Record<string, unknown>>(),
    onboardingSteps: json("onboardingSteps").$type<string[]>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    // userId lookup — primary access pattern for AI director preferences
    userIdIdx: index("adp_userId_idx").on(table.userId),
  })
);

export type AiDirectorPreference = typeof aiDirectorPreferences.$inferSelect;
export type InsertAiDirectorPreference =
  typeof aiDirectorPreferences.$inferInsert;

// ─── Specialized Agent Memory ────────────────────────────────────────────
// Stores agent-specific context, preferences, and learned patterns for each user
export const specializedAgentMemory = mysqlTable(
  "specialized_agent_memory",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    agentId: varchar("agentId", { length: 64 }).notNull(),
    memoryType: mysqlEnum("memoryType", [
      "preference",
      "pattern",
      "context",
      "feedback",
    ]).default("preference").notNull(),
    memoryKey: varchar("memoryKey", { length: 128 }).notNull(),
    memoryValue: json("memoryValue").$type<Record<string, unknown>>().notNull(),
    confidence: decimal("confidence", { precision: 3, scale: 2 }).default("0.50"),
    usageCount: int("usageCount").default(1),
    lastUsedAt: timestamp("lastUsedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userAgentIdx: index("sam_user_agent_idx").on(table.userId, table.agentId),
    userAgentTypeIdx: index("sam_user_agent_type_idx").on(
      table.userId,
      table.agentId,
      table.memoryType
    ),
    memoryKeyIdx: index("sam_memory_key_idx").on(table.memoryKey),
  })
);

export type SpecializedAgentMemory = typeof specializedAgentMemory.$inferSelect;
export type InsertSpecializedAgentMemory = typeof specializedAgentMemory.$inferInsert;

// ─── Specialized Agent Interactions ──────────────────────────────────────
// Tracks user interactions with specialized agents for analytics and improvement
export const specializedAgentInteractions = mysqlTable(
  "specialized_agent_interactions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    agentId: varchar("agentId", { length: 64 }).notNull(),
    sessionId: varchar("sessionId", { length: 128 }),
    interactionType: mysqlEnum("interactionType", [
      "activated",
      "tool_used",
      "suggestion_accepted",
      "suggestion_rejected",
      "error",
    ]).notNull(),
    toolName: varchar("toolName", { length: 128 }),
    contextData: json("contextData").$type<Record<string, unknown>>(),
    userSatisfaction: mysqlEnum("userSatisfaction", [
      "positive",
      "neutral",
      "negative",
    ]),
    durationMs: int("durationMs"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userAgentIdx: index("sai_user_agent_idx").on(table.userId, table.agentId),
    sessionIdx: index("sai_session_idx").on(table.sessionId),
    createdAtIdx: index("sai_created_at_idx").on(table.createdAt),
  })
);

export type SpecializedAgentInteraction = typeof specializedAgentInteractions.$inferSelect;
export type InsertSpecializedAgentInteraction = typeof specializedAgentInteractions.$inferInsert;


// ─── Agent Model Picks (shared between Director AI + Global Orb Agent) ──
// Single source of truth for "the user picked model X for modality Y from
// surface Z". Both 導演 AI 規劃 + 發送工作室 and the global orb's
// recommendation pipeline read/write this table so picks made anywhere on
// the site contribute to the same preference signal — answering the
// product brief: 「跟全站光球代理共用資料庫，一起持續學習如何選模型」.
export const agentModelPicks = mysqlTable(
  "agent_model_picks",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    // image / video / audio / voice / sfx / text — kept loose because the
    // studio surfaces add new modalities (e.g. "music") faster than schema
    // migrations can ship. Read-side defensively normalizes.
    modality: varchar("modality", { length: 32 }).notNull(),
    modelId: varchar("modelId", { length: 128 }).notNull(),
    // Where the pick happened so the distiller can weight by surface
    // (director picks usually carry more intent than a one-click history
    // re-run).
    source: mysqlEnum("source", [
      "director_ai",
      "global_orb",
      "image_studio",
      "video_studio",
      "pro_studio",
      "studio",
      "history",
      "shared_space",
      "other",
    ])
      .default("other")
      .notNull(),
    // Tracks whether the pick led to an accepted generation. Updated
    // post-hoc when the studio records success/failure so we can
    // demote models with high reject ratios.
    accepted: boolean("accepted"),
    // Optional context — prompt fingerprint, page id, batch size — kept
    // small so the table doesn't grow into a generation log.
    context: json("context").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    // Primary read pattern: "what's the user's preferred model for image?"
    userModalityIdx: index("amp_user_modality_idx").on(
      table.userId,
      table.modality
    ),
    // Secondary: aggregate by (userId, modelId) to compute pick counts.
    userModelIdx: index("amp_user_model_idx").on(table.userId, table.modelId),
    // Recency sort.
    createdAtIdx: index("amp_created_at_idx").on(table.createdAt),
  })
);

export type AgentModelPick = typeof agentModelPicks.$inferSelect;
export type InsertAgentModelPick = typeof agentModelPicks.$inferInsert;


// ─── Generation History ──────────────────────────────────────────────────
export const generationHistory = mysqlTable(
  "generation_history",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    requestId: int("requestId"),
    modality: mysqlEnum("modality", [
      "image",
      "video",
      "audio",
      "voice",
    ]).notNull(),
    prompt: text("prompt"),
    compiledPrompt: text("compiledPrompt"),
    parameterSnapshot:
      json("parameterSnapshot").$type<Record<string, unknown>>(),
    resultUrl: text("resultUrl"),
    thumbnailUrl: text("thumbnailUrl"),
    userRating: int("userRating"),
    isBookmarked: boolean("isBookmarked").default(false).notNull(),
    costCredits: int("costCredits").default(1).notNull(),
    durationMs: int("durationMs"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdCreatedAtIdx: index("userId_createdAt_idx").on(
      table.userId,
      table.createdAt
    ),
    // userId + modality — used when filtering history by content type
    userIdModalityIdx: index("gh_userId_modality_idx").on(
      table.userId,
      table.modality
    ),
    // isBookmarked — used when fetching bookmarked items
    userIdBookmarkedIdx: index("gh_userId_isBookmarked_idx").on(
      table.userId,
      table.isBookmarked
    ),
  })
);

export type GenerationHistoryItem = typeof generationHistory.$inferSelect;
export type InsertGenerationHistoryItem = typeof generationHistory.$inferInsert;

// ─── Custom Blocks ─────────────────────────────────────────────────────
export const customBlocks = mysqlTable(
  "custom_blocks",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    modality: mysqlEnum("modality", [
      "image",
      "video",
      "audio",
      "voice",
    ]).notNull(),
    category: varchar("category", { length: 64 }).notNull(),
    label: varchar("label", { length: 128 }).notNull(),
    prompt: varchar("prompt", { length: 512 }).notNull(),
    emoji: varchar("emoji", { length: 8 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdModalityIdx: index("cb_userId_modality_idx").on(
      table.userId,
      table.modality
    ),
  })
);

export type CustomBlock = typeof customBlocks.$inferSelect;
export type InsertCustomBlock = typeof customBlocks.$inferInsert;

// ─── Block Combos (Saved Inspiration Presets) ───────────────────────────
export const blockCombos = mysqlTable(
  "block_combos",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    modality: mysqlEnum("modality", [
      "image",
      "video",
      "audio",
      "voice",
    ]).notNull(),
    blockIds: json("blockIds").$type<string[]>().notNull(),
    customBlockIds: json("customBlockIds").$type<number[]>(),
    vibeCardIds: json("vibeCardIds").$type<string[]>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    // userId lookup — primary access pattern for block combos
    userIdIdx: index("bc_userId_idx").on(table.userId),
    // userId + modality — used when filtering combos by modality
    userIdModalityIdx: index("bc_userId_modality_idx").on(table.userId, table.modality),
  })
);

export type BlockCombo = typeof blockCombos.$inferSelect;
export type InsertBlockCombo = typeof blockCombos.$inferInsert;

// ─── System Settings (per-user global preferences) ─────────────────────
export const systemSettings = mysqlTable("system_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),

  // ── UI Theme Preferences ──────────────────────────────────────────────
  uiTheme: mysqlEnum("uiTheme", ["system", "light", "dark"])
    .default("system")
    .notNull(),
  accentColor: varchar("accentColor", { length: 32 }).default("violet"),
  fontScale: mysqlEnum("fontScale", ["small", "medium", "large"])
    .default("medium")
    .notNull(),
  reducedMotion: boolean("reducedMotion").default(false).notNull(),
  sidebarCollapsed: boolean("sidebarCollapsed").default(false).notNull(),

  // ── Privacy & Tracking Consent ────────────────────────────────────────
  analyticsConsent: boolean("analyticsConsent").default(false).notNull(),
  crashReportConsent: boolean("crashReportConsent").default(false).notNull(),
  shareUsageData: boolean("shareUsageData").default(false).notNull(),
  showProfilePublicly: boolean("showProfilePublicly").default(false).notNull(),

  // ── Auto-Backup Settings ──────────────────────────────────────────────
  autoBackupEnabled: boolean("autoBackupEnabled").default(true).notNull(),
  backupFrequency: mysqlEnum("backupFrequency", ["daily", "weekly", "monthly"])
    .default("weekly")
    .notNull(),
  backupRetentionDays: int("backupRetentionDays").default(30).notNull(),
  lastBackupAt: timestamp("lastBackupAt"),

  // ── Generation Defaults ───────────────────────────────────────────────
  defaultModality: mysqlEnum("defaultModality", [
    "image",
    "video",
    "audio",
    "voice",
  ])
    .default("image")
    .notNull(),
  defaultCreativeMode: mysqlEnum("defaultCreativeMode", [
    "balanced",
    "creative",
    "precise",
  ])
    .default("balanced")
    .notNull(),
  autoSaveHistory: boolean("autoSaveHistory").default(true).notNull(),
  nsfwFilter: boolean("nsfwFilter").default(true).notNull(),

  // ── Notification Preferences ──────────────────────────────────────────
  emailNotifications: boolean("emailNotifications").default(true).notNull(),
  generationCompleteNotify: boolean("generationCompleteNotify")
    .default(true)
    .notNull(),
  weeklyDigestEnabled: boolean("weeklyDigestEnabled").default(false).notNull(),

  // ── Locale & Accessibility ────────────────────────────────────────────
  locale: varchar("locale", { length: 16 }).default("zh-TW"),
  timezone: varchar("timezone", { length: 64 }).default("Asia/Taipei"),

  // ── Extensible JSON for future settings ───────────────────────────────
  extraSettings: json("extraSettings").$type<Record<string, unknown>>(),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = typeof systemSettings.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// NEW TABLES — Homepage Ecosystem
// ═══════════════════════════════════════════════════════════════════════════

// ─── News Articles (首頁新聞動態) ──────────────────────────────────────────
export const newsArticles = mysqlTable(
  "news_articles",
  {
    id: int("id").autoincrement().primaryKey(),

    /** 文章標題 */
    title: varchar("title", { length: 512 }).notNull(),

    /** OARS 柔化摘要 (TL;DR) — 以溫暖、低焦慮語氣撰寫的精簡摘要 */
    oarsSummary: text("oarsSummary").notNull(),

    /** 完整內容（Markdown 格式，可選） */
    bodyMarkdown: text("bodyMarkdown"),

    /** 來源名稱（如「AI Director 官方」、「社群精選」） */
    sourceName: varchar("sourceName", { length: 256 }).notNull(),

    /** 來源 URL（外部連結，可選） */
    sourceUrl: text("sourceUrl"),

    /** 封面圖片 CDN URL */
    coverImageUrl: text("coverImageUrl"),

    /** 文章分類 */
    category: mysqlEnum("category", [
      "product_update",
      "community_highlight",
      "tutorial",
      "industry_news",
      "tips_and_tricks",
    ])
      .default("product_update")
      .notNull(),

    /** 標籤（用於篩選與推薦） */
    tags: json("tags").$type<string[]>(),

    /** 是否置頂 */
    isPinned: boolean("isPinned").default(false).notNull(),

    /** 是否已發布（草稿 vs 公開） */
    isPublished: boolean("isPublished").default(false).notNull(),

    /** 發布時間（可排程未來發布） */
    publishedAt: timestamp("publishedAt"),

    /** 作者 userId（可選，null 表示系統發布） */
    authorUserId: int("authorUserId"),

    /** 閱讀次數 */
    viewCount: int("viewCount").default(0).notNull(),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    // Published + pinned listing — primary homepage query
    isPublishedPinnedIdx: index("na_isPublished_isPinned_idx").on(
      table.isPublished,
      table.isPinned,
      table.publishedAt
    ),
    // Category filter — used when browsing by category
    categoryIdx: index("na_category_idx").on(table.category),
    // publishedAt ordering — used for chronological feeds
    publishedAtIdx: index("na_publishedAt_idx").on(table.publishedAt),
  })
);

export type NewsArticle = typeof newsArticles.$inferSelect;
export type InsertNewsArticle = typeof newsArticles.$inferInsert;

// ─── Featured Showcase (首頁精選展示) ──────────────────────────────────────
export const featuredShowcase = mysqlTable(
  "featured_showcase",
  {
    id: int("id").autoincrement().primaryKey(),

    /** 關聯的生成歷史紀錄 ID（可選，null 表示手動上傳的展示作品） */
    generatedItemId: int("generatedItemId"),

    /** 展示標題 */
    title: varchar("title", { length: 512 }).notNull(),

    /** 展示描述（OARS 柔化語氣） */
    description: text("description"),

    /** 作品圖片 CDN 網址 */
    imageUrl: text("imageUrl").notNull(),

    /** 縮圖 CDN 網址（用於網格預覽） */
    thumbnailUrl: text("thumbnailUrl"),

    /** 情緒矩陣 — 多維度情緒向量，用於推薦與篩選 */
    vibeParameters: json("vibeParameters").$type<{
      warmth: number; // 溫暖度 0-1
      energy: number; // 能量感 0-1
      mystery: number; // 神秘感 0-1
      serenity: number; // 寧靜度 0-1
      whimsy: number; // 奇幻感 0-1
      intensity: number; // 強烈度 0-1
      dominantMood: string; // 主導情緒標籤
    }>(),

    /**
     * 完全解構積木 JSON 組合 — 記錄生成此作品時使用的所有積木選擇，
     * 讓使用者可以「一鍵複製配方」重現 or 微調此風格
     */
    completelyDeconstructedBlocks: json("completelyDeconstructedBlocks").$type<{
      modality: "image" | "video" | "audio" | "voice";
      vibeCards: string[]; // 選中的 Vibe Card ID 列表
      selectedBlocks: Array<{
        category: string; // 積木分類（subject, action, environment, lighting, camera）
        blockId: string; // 積木 ID
        label: string; // 積木顯示名稱
        prompt: string; // 積木對應的提示詞片段
      }>;
      customBlockIds: number[]; // 自訂積木 ID 列表
      freeformPrompt: string; // 使用者自由輸入的提示詞
      negativePrompt: string; // 排除描述
      compiledPrompt: string; // 最終編譯後的完整提示詞
      parameters: Record<string, unknown>; // 所有技術參數快照（seed, cfg, steps 等）
    }>(),

    /** 原始提示詞（方便搜尋） */
    originalPrompt: text("originalPrompt"),

    /** 作品模態 */
    modality: mysqlEnum("modality", ["image", "video", "audio", "voice"])
      .default("image")
      .notNull(),

    /** 提交者 userId */
    curatorUserId: int("curatorUserId"),

    /** 展示排序權重（越大越靠前） */
    sortWeight: int("sortWeight").default(0).notNull(),

    /** 是否啟用（管理員控制） */
    isActive: boolean("isActive").default(true).notNull(),

    /** 按讚數 */
    likeCount: int("likeCount").default(0).notNull(),

    /** 被複製配方次數 */
    forkCount: int("forkCount").default(0).notNull(),

    /** 評論數（denormalised from featured_showcase_comments） */
    commentCount: int("commentCount").default(0).notNull(),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    // Composite index for the main listing query: WHERE isActive = true ORDER BY sortWeight, likeCount, id
    isActiveSortIdx: index("fs_isActive_sort_idx").on(
      table.isActive,
      table.sortWeight,
      table.likeCount
    ),
    // Index for modality filtering (used when filtering by image/video/audio/voice)
    modalityIdx: index("fs_modality_idx").on(table.modality),
    // Index for curator lookups
    curatorIdx: index("fs_curator_idx").on(table.curatorUserId),
  })
);

export type FeaturedShowcaseItem = typeof featuredShowcase.$inferSelect;
export type InsertFeaturedShowcaseItem = typeof featuredShowcase.$inferInsert;

// ─── Featured Showcase Comments ────────────────────────────────────────────
export const featuredShowcaseComments = mysqlTable(
  "featured_showcase_comments",
  {
    id: int("id").autoincrement().primaryKey(),
    showcaseId: int("showcaseId").notNull(),
    userId: int("userId").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    showcaseCreatedIdx: index("fsc_showcase_created_idx").on(
      table.showcaseId,
      table.createdAt
    ),
    userIdx: index("fsc_user_idx").on(table.userId),
  })
);

export type FeaturedShowcaseComment =
  typeof featuredShowcaseComments.$inferSelect;
export type InsertFeaturedShowcaseComment =
  typeof featuredShowcaseComments.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// NEW TABLES — AI Brain Configuration Database (大腦組態資料庫)
// ═══════════════════════════════════════════════════════════════════════════

// ─── User AI Brain (使用者 AI 大腦組態) ──────────────────────────────────────
/**
 * 每位使用者的 AI 大腦組態：
 * - 5 種推理大腦 (Reasoning Brains): director, analyst, storyteller, technician, curator
 * - 4 種生成引擎 (Generation Engines): image, video, audio, voice
 *
 * 每個大腦/引擎儲存：模型 ID、溫度、top_p、自訂系統提示、啟用狀態。
 * 一位使用者只有一筆記錄（upsert 模式）。
 */
export const userAiBrain = mysqlTable("user_ai_brain", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),

  // ── 5 種推理大腦 (Reasoning Brains) ──────────────────────────────────────

  /** 導演大腦 — 統籌創作流程、分鏡、敘事結構 */
  directorModel: varchar("directorModel", { length: 128 })
    .default("anthropic/claude-opus-4.7")
    .notNull(),
  directorTemperature: decimal("directorTemperature", {
    precision: 3,
    scale: 2,
  })
    .default("0.4")
    .notNull(),
  directorTopP: decimal("directorTopP", { precision: 3, scale: 2 })
    .default("0.9")
    .notNull(),
  directorSystemPrompt: text("directorSystemPrompt"),
  directorEnabled: boolean("directorEnabled").default(true).notNull(),

  /** 分析師大腦 — 數據分析、趨勢洞察、品質評估 */
  analystModel: varchar("analystModel", { length: 128 })
    .default("perplexity/sonar-pro")
    .notNull(),
  analystTemperature: decimal("analystTemperature", { precision: 3, scale: 2 })
    .default("0.3")
    .notNull(),
  analystTopP: decimal("analystTopP", { precision: 3, scale: 2 })
    .default("0.8")
    .notNull(),
  analystSystemPrompt: text("analystSystemPrompt"),
  analystEnabled: boolean("analystEnabled").default(true).notNull(),

  /** 說書人大腦 — 文案撰寫、故事展開、情感渲染 */
  storytellerModel: varchar("storytellerModel", { length: 128 })
    .default("anthropic/claude-opus-4.7")
    .notNull(),
  storytellerTemperature: decimal("storytellerTemperature", {
    precision: 3,
    scale: 2,
  })
    .default("0.9")
    .notNull(),
  storytellerTopP: decimal("storytellerTopP", { precision: 3, scale: 2 })
    .default("0.95")
    .notNull(),
  storytellerSystemPrompt: text("storytellerSystemPrompt"),
  storytellerEnabled: boolean("storytellerEnabled").default(true).notNull(),

  /** 技師大腦 — 提示詞工程、參數優化、技術翻譯 */
  technicianModel: varchar("technicianModel", { length: 128 })
    .default("anthropic/claude-opus-4.7")
    .notNull(),
  technicianTemperature: decimal("technicianTemperature", {
    precision: 3,
    scale: 2,
  })
    .default("0.2")
    .notNull(),
  technicianTopP: decimal("technicianTopP", { precision: 3, scale: 2 })
    .default("0.7")
    .notNull(),
  technicianSystemPrompt: text("technicianSystemPrompt"),
  technicianEnabled: boolean("technicianEnabled").default(true).notNull(),

  /** 策展人大腦 — 風格推薦、美學判斷、靈感策展 */
  curatorModel: varchar("curatorModel", { length: 128 })
    .default("anthropic/claude-opus-4.7")
    .notNull(),
  curatorTemperature: decimal("curatorTemperature", { precision: 3, scale: 2 })
    .default("0.8")
    .notNull(),
  curatorTopP: decimal("curatorTopP", { precision: 3, scale: 2 })
    .default("0.9")
    .notNull(),
  curatorSystemPrompt: text("curatorSystemPrompt"),
  curatorEnabled: boolean("curatorEnabled").default(true).notNull(),

  // ── 4 種生成引擎 (Generation Engines) ────────────────────────────────────

  /** 圖像生成引擎 */
  imageEngine: varchar("imageEngine", { length: 128 })
    .default("fal-ai/flux-pro/v1.1")
    .notNull(),
  imageEngineParams: json("imageEngineParams").$type<{
    steps?: number;
    cfgScale?: number;
    seed?: number | null;
    scheduler?: string;
    width?: number;
    height?: number;
    negativePrompt?: string;
  }>(),
  imageEngineEnabled: boolean("imageEngineEnabled").default(true).notNull(),

  /** 影片生成引擎 — 對齊 DEFAULT_GENERATION_ENGINES.videoEngine
   * (Kling t2v 上游壞掉，middleware 改用 fal-ai/wan-t2v) */
  videoEngine: varchar("videoEngine", { length: 128 })
    .default("fal-ai/wan-t2v")
    .notNull(),
  videoEngineParams: json("videoEngineParams").$type<{
    duration?: number;
    fps?: number;
    resolution?: string;
    motionStrength?: number;
    seed?: number | null;
  }>(),
  videoEngineEnabled: boolean("videoEngineEnabled").default(true).notNull(),

  /** 音樂/音效生成引擎 — 對齊 DEFAULT_GENERATION_ENGINES.audioEngine */
  audioEngine: varchar("audioEngine", { length: 128 })
    .default("fal-ai/ace-step")
    .notNull(),
  audioEngineParams: json("audioEngineParams").$type<{
    duration?: number;
    genre?: string;
    tempo?: number;
    instrumental?: boolean;
  }>(),
  audioEngineEnabled: boolean("audioEngineEnabled").default(true).notNull(),

  /** 語音合成引擎 — 對齊 DEFAULT_GENERATION_ENGINES.voiceEngine */
  voiceEngine: varchar("voiceEngine", { length: 128 })
    .default("fal-ai/elevenlabs/tts/turbo-v2.5")
    .notNull(),
  voiceEngineParams: json("voiceEngineParams").$type<{
    voiceId?: string;
    stability?: number;
    similarityBoost?: number;
    speed?: number;
    language?: string;
  }>(),
  voiceEngineEnabled: boolean("voiceEngineEnabled").default(true).notNull(),

  // ── Fal.ai 16大類任務引擎 ────────────────────────────────────────────────

  /** 2-1 影像轉3D */
  falImageTo3dEngine: varchar("falImageTo3dEngine", { length: 128 }).default(
    "fal-ai/trellis"
  ),
  /** 2-2 影像到影像 */
  falImageToImageEngine: varchar("falImageToImageEngine", {
    length: 128,
  }).default("fal-ai/flux/dev/image-to-image"),
  /** 2-3 圖像轉JSON */
  falImageToJsonEngine: varchar("falImageToJsonEngine", {
    length: 128,
  }).default("fal-ai/any-llm"),
  /** 2-4 圖片轉視頻 */
  falImageToVideoEngine: varchar("falImageToVideoEngine", {
    length: 128,
  }).default("fal-ai/kling-video/v2.1/pro/image-to-video"),
  /** 2-5 JSON 結構化輸出 */
  falJsonEngine: varchar("falJsonEngine", { length: 128 }).default(
    "fal-ai/any-llm"
  ),
  /** 2-6 大型語言模型 */
  falLlmEngine: varchar("falLlmEngine", { length: 128 }).default(
    "fal-ai/any-llm"
  ),
  /** 2-7 文字轉3D */
  falTextTo3dEngine: varchar("falTextTo3dEngine", { length: 128 }).default(
    "fal-ai/hyper3d/rodin"
  ),
  /** 2-8 文字轉音頻 */
  falTextToAudioEngine: varchar("falTextToAudioEngine", {
    length: 128,
  }).default("fal-ai/stable-audio"),
  /** 2-9 文字轉圖像 */
  falTextToImageEngine: varchar("falTextToImageEngine", {
    length: 128,
  }).default("fal-ai/flux-pro/v1.1"),
  /** 2-10 文字轉JSON */
  falTextToJsonEngine: varchar("falTextToJsonEngine", { length: 128 }).default(
    "fal-ai/any-llm"
  ),
  /** 2-11 文字轉語音 — 對齊 DEFAULT_FAL_ENGINES.textToSpeech */
  falTextToSpeechEngine: varchar("falTextToSpeechEngine", {
    length: 128,
  }).default("fal-ai/elevenlabs/tts/turbo-v2.5"),
  /** 2-12 文字轉視頻 */
  falTextToVideoEngine: varchar("falTextToVideoEngine", {
    length: 128,
  }).default("fal-ai/kling-video/v2.1/pro/text-to-video"),
  /** 2-13 訓練 */
  falTrainingEngine: varchar("falTrainingEngine", { length: 128 }).default(
    "fal-ai/flux-lora-fast-training"
  ),
  /** 2-14 視訊轉音訊 */
  falVideoToAudioEngine: varchar("falVideoToAudioEngine", {
    length: 128,
  }).default("fal-ai/mmaudio-v2/video-to-audio"),
  /** 2-15 影片轉文字 */
  falVideoToTextEngine: varchar("falVideoToTextEngine", {
    length: 128,
  }).default("fal-ai/whisper"),
  /** 2-16 影片對影片 */
  falVideoToVideoEngine: varchar("falVideoToVideoEngine", {
    length: 128,
  }).default("fal-ai/kling-video/v2.1/standard/video-to-video"),

  // ── Meta ──────────────────────────────────────────────────────────────────

  /** 全局偏好 JSON（擴展用） */
  globalPreferences: json("globalPreferences").$type<Record<string, unknown>>(),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserAiBrain = typeof userAiBrain.$inferSelect;
export type InsertUserAiBrain = typeof userAiBrain.$inferInsert;

// ─── User Model Switch Logs (模型切換日誌) ─────────────────────────────────
/**
 * 記錄使用者每次切換推理大腦 or 生成引擎的操作：
 * - 誰 (userId) 在什麼時候 (switchedAt)
 * - 切換了哪個腦/引擎 (brainSlot)
 * - 從哪個模型 (fromModel) 切到哪個模型 (toModel)
 * - 切換原因 (reason) — 可選，用於分析使用者偏好趨勢
 */
export const userModelSwitchLogs = mysqlTable(
  "user_model_switch_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),

    /** 切換的腦/引擎插槽名稱 */
    brainSlot: mysqlEnum("brainSlot", [
      "director",
      "analyst",
      "storyteller",
      "technician",
      "curator",
      "imageEngine",
      "videoEngine",
      "audioEngine",
      "voiceEngine",
    ]).notNull(),

    /** 切換前的模型 ID */
    fromModel: varchar("fromModel", { length: 128 }).notNull(),

    /** 切換後的模型 ID */
    toModel: varchar("toModel", { length: 128 }).notNull(),

    /** 切換前的參數快照 */
    fromParams: json("fromParams").$type<Record<string, unknown>>(),

    /** 切換後的參數快照 */
    toParams: json("toParams").$type<Record<string, unknown>>(),

    /** 切換原因（使用者自述或系統推薦） */
    reason: text("reason"),

    /** 切換來源 */
    switchSource: mysqlEnum("switchSource", [
      "manual", // 使用者手動切換
      "soul_recommendation", // 光球推薦
      "auto_fallback", // 自動降級（模型不可用時）
      "ab_test", // A/B 測試
    ])
      .default("manual")
      .notNull(),

    /** 切換時間 */
    switchedAt: timestamp("switchedAt").defaultNow().notNull(),
  },
  table => ({
    // userId + switchedAt — primary access pattern for user switch history
    userIdSwitchedAtIdx: index("umsl_userId_switchedAt_idx").on(
      table.userId,
      table.switchedAt
    ),
    // userId + brainSlot — used when querying history for a specific brain
    userIdBrainSlotIdx: index("umsl_userId_brainSlot_idx").on(
      table.userId,
      table.brainSlot
    ),
  })
);

export type UserModelSwitchLog = typeof userModelSwitchLogs.$inferSelect;
export type InsertUserModelSwitchLog = typeof userModelSwitchLogs.$inferInsert;

// ─── Custom Blocks Combo (S-S-L-C-M 積木組合存檔) ──────────────────────────
/**
 * 使用者自訂的「S-S-L-C-M 積木 JSON 結構」完整存檔：
 * S = Subject（主體）
 * S = Style（風格）
 * L = Lighting（光線）
 * C = Camera（鏡頭）
 * M = Mood（情緒）
 *
 * 可供日後重現、分享、或設為精選（管理員 curated）。
 * 與 blockCombos 的差異：此表儲存完整的積木 JSON 結構（含 prompt 片段），
 * 而非僅儲存 blockIds 參照。
 */
export const customBlocksCombo = mysqlTable("custom_blocks_combo", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),

  /** 組合名稱 */
  name: varchar("name", { length: 255 }).notNull(),

  /** 組合描述 */
  description: text("description"),

  /** 適用模態 */
  modality: mysqlEnum("modality", [
    "image",
    "video",
    "audio",
    "voice",
  ]).notNull(),

  /** Subject 積木 JSON */
  subjectBlock: json("subjectBlock").$type<{
    blockId: string;
    label: string;
    prompt: string;
    emoji?: string;
    isCustom: boolean;
    customBlockId?: number;
  }>(),

  /** Style 積木 JSON */
  styleBlock: json("styleBlock").$type<{
    blockId: string;
    label: string;
    prompt: string;
    emoji?: string;
    isCustom: boolean;
    customBlockId?: number;
  }>(),

  /** Lighting 積木 JSON */
  lightingBlock: json("lightingBlock").$type<{
    blockId: string;
    label: string;
    prompt: string;
    emoji?: string;
    isCustom: boolean;
    customBlockId?: number;
  }>(),

  /** Camera 積木 JSON */
  cameraBlock: json("cameraBlock").$type<{
    blockId: string;
    label: string;
    prompt: string;
    emoji?: string;
    isCustom: boolean;
    customBlockId?: number;
  }>(),

  /** Mood 積木 JSON */
  moodBlock: json("moodBlock").$type<{
    blockId: string;
    label: string;
    prompt: string;
    emoji?: string;
    isCustom: boolean;
    customBlockId?: number;
  }>(),

  /** 額外積木（不在 S-S-L-C-M 五大類的補充積木） */
  extraBlocks: json("extraBlocks").$type<
    Array<{
      category: string;
      blockId: string;
      label: string;
      prompt: string;
      emoji?: string;
      isCustom: boolean;
      customBlockId?: number;
    }>
  >(),

  /** 關聯的 Vibe Card IDs */
  vibeCardIds: json("vibeCardIds").$type<string[]>(),

  /** 自由輸入提示詞 */
  freeformPrompt: text("freeformPrompt"),

  /** 排除描述 */
  negativePrompt: text("negativePrompt"),

  /** 編譯後的完整提示詞（快照） */
  compiledPrompt: text("compiledPrompt"),

  /** 技術參數快照 */
  parameterSnapshot: json("parameterSnapshot").$type<Record<string, unknown>>(),

  /** 使用的 AI 大腦組態快照（記錄當時的大腦設定） */
  brainConfigSnapshot: json("brainConfigSnapshot").$type<{
    reasoningBrain?: string;
    generationEngine?: string;
    temperature?: number;
    topP?: number;
  }>(),

  /** 預覽圖 URL（用此組合生成的代表作品） */
  previewImageUrl: text("previewImageUrl"),

  /** 是否為精選（管理員策展） */
  isCurated: boolean("isCurated").default(false).notNull(),

  /** 是否公開分享 */
  isPublic: boolean("isPublic").default(false).notNull(),

  /** 被 fork 次數 */
  forkCount: int("forkCount").default(0).notNull(),

  /** 按讚數 */
  likeCount: int("likeCount").default(0).notNull(),

  /** 使用次數 */
  useCount: int("useCount").default(0).notNull(),

  /** 標籤 */
  tags: json("tags").$type<string[]>(),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
},
table => ({
  // userId lookup — primary access pattern for user's combos
  userIdIdx: index("cbc_userId_idx").on(table.userId),
  // userId + modality — used when filtering combos by modality
  userIdModalityIdx: index("cbc_userId_modality_idx").on(table.userId, table.modality),
  // Public curated combos — used for community gallery queries
  isCuratedPublicIdx: index("cbc_isCurated_isPublic_idx").on(
    table.isCurated,
    table.isPublic
  ),
}));

export type CustomBlocksComboItem = typeof customBlocksCombo.$inferSelect;
export type InsertCustomBlocksComboItem = typeof customBlocksCombo.$inferInsert;

// ─── Prompt Library（提示詞庫）────────────────────────────────────────────
export const promptLibrary = mysqlTable(
  "prompt_library",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    content: text("content").notNull(),           // 完整提示詞內容
    category: varchar("category", { length: 64 }).default("general").notNull(), // image/video/audio/voice/general
    tags: json("tags").$type<string[]>(),
    isFavorite: boolean("isFavorite").default(false).notNull(),
    isPublic: boolean("isPublic").default(false).notNull(),
    useCount: int("useCount").default(0).notNull(),
    modelHint: varchar("modelHint", { length: 128 }),  // 建議使用的模型 ID
    language: varchar("language", { length: 8 }).default("zh").notNull(),
    generationMode: varchar("generationMode", { length: 32 }),  // "lightning" | "deep_precision" | null
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("pl_userId_idx").on(table.userId),
    categoryIdx: index("pl_category_idx").on(table.category),
    generationModeIdx: index("pl_generationMode_idx").on(table.generationMode),
  })
);

export type PromptLibraryItem = typeof promptLibrary.$inferSelect;
export type InsertPromptLibraryItem = typeof promptLibrary.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// NEW TABLES — Roadmap (外部服務訂閱 / R2 快照 / 用戶訂閱)
// ═══════════════════════════════════════════════════════════════════════════

// ─── External Service Subscriptions（外部服務訂閱管理）──────────────────────
export const externalServiceSubscriptions = mysqlTable("external_service_subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  serviceName: varchar("serviceName", { length: 64 }).notNull(),
  planName: varchar("planName", { length: 128 }),
  monthlyCostUsd: decimal("monthlyCostUsd", { precision: 10, scale: 2 }),
  billingCycle: mysqlEnum("billingCycle", ["monthly", "annual", "pay-as-you-go"]),
  nextRenewalDate: date("nextRenewalDate"),
  apiKeyEnvVar: varchar("apiKeyEnvVar", { length: 64 }),
  apiKeyStatus: mysqlEnum("apiKeyStatus", ["valid", "invalid", "unknown"]).default("unknown"),
  workspaceName: varchar("workspaceName", { length: 128 }),
  ownerEmail: varchar("ownerEmail", { length: 320 }),
  riskLevel: mysqlEnum("riskLevel", ["low", "medium", "high"]).default("medium"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ExternalServiceSubscription = typeof externalServiceSubscriptions.$inferSelect;
export type InsertExternalServiceSubscription = typeof externalServiceSubscriptions.$inferInsert;

// ─── R2 Storage Snapshots（R2 儲存空間每日快照）────────────────────────────
export const r2StorageSnapshots = mysqlTable("r2_storage_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  snapshotDate: date("snapshotDate").notNull(),
  totalBytes: bigint("totalBytes", { mode: "number" }).default(0),
  totalObjects: int("totalObjects").default(0),
  bytesByType: json("bytesByType").$type<Record<string, number>>(),
  objectsByType: json("objectsByType").$type<Record<string, number>>(),
  estimatedMonthlyCostUsd: decimal("estimatedMonthlyCostUsd", { precision: 10, scale: 4 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type R2StorageSnapshot = typeof r2StorageSnapshots.$inferSelect;
export type InsertR2StorageSnapshot = typeof r2StorageSnapshots.$inferInsert;

// ─── User Subscriptions（用戶訂閱，Stripe 用）────────────────────────────────
export const userSubscriptions = mysqlTable(
  "user_subscriptions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().unique(),
    stripeCustomerId: varchar("stripeCustomerId", { length: 64 }),
    stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 64 }),
    planId: varchar("planId", { length: 64 }).default("free").notNull(),
    status: mysqlEnum("status", ["active", "past_due", "cancelled", "trialing"]).default("active"),
    currentPeriodStart: timestamp("currentPeriodStart"),
    currentPeriodEnd: timestamp("currentPeriodEnd"),
    cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").default(false),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    // Stripe customer ID lookup — used by Stripe webhook handlers
    stripeCustomerIdIdx: index("us_stripeCustomerId_idx").on(table.stripeCustomerId),
    // Stripe subscription ID lookup — used by Stripe webhook handlers
    stripeSubscriptionIdIdx: index("us_stripeSubscriptionId_idx").on(table.stripeSubscriptionId),
    // Status filter — used when querying active subscriptions
    statusIdx: index("us_status_idx").on(table.status),
  })
);

export type UserSubscription = typeof userSubscriptions.$inferSelect;
export type InsertUserSubscription = typeof userSubscriptions.$inferInsert;

// ─── Orb Feedback Events（Phase 3c：光球跨 session 長期記憶）────────────────
//
// 使用者對光球建議的每一筆反應都寫進來（accepted / edited / cancelled /
// completed / failed），LLM 下輪對話可讀回去，學會使用者的偏好。
//
// 設計上刻意輕量：一筆 reaction 只有 1 row，不做複雜的聚合 / 向量搜尋；
// 讀取時 LIMIT 最新 N 筆，壓成繁中給 system prompt。
export const orbFeedbackEvents = mysqlTable(
  "orb_feedback_events",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /** 來自哪一頁（ImageStudio / VideoStudio /…）；空代表全站情境 */
    pageId: varchar("pageId", { length: 64 }),
    /** 動作類型（setModel / applyPreset / submit …） */
    actionType: varchar("actionType", { length: 32 }).notNull(),
    /** accepted / edited / cancelled / completed / failed */
    status: mysqlEnum("status", [
      "accepted",
      "edited",
      "cancelled",
      "completed",
      "failed",
    ]).notNull(),
    /** 使用者的一句話（若有從聊天擷取）或 LLM 的意圖摘要 */
    note: varchar("note", { length: 512 }),
    /** 動作本身的 payload 摘要（modelId、presetId 之類的） */
    actionSummary: varchar("actionSummary", { length: 256 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdCreatedAtIdx: index("ofe_userId_createdAt_idx").on(
      table.userId,
      table.createdAt
    ),
    userIdActionTypeIdx: index("ofe_userId_actionType_idx").on(
      table.userId,
      table.actionType
    ),
  })
);

export type OrbFeedbackEvent = typeof orbFeedbackEvents.$inferSelect;
export type InsertOrbFeedbackEvent = typeof orbFeedbackEvents.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// NEW TABLES — Admin API Usage & Cost Management
// ═══════════════════════════════════════════════════════════════════════════

/** AI Provider enum values — easy to extend with new providers */
export const AI_PROVIDERS = ["fal_ai", "gemini", "elevenlabs", "suno"] as const;
const USAGE_STATUSES = ["success", "failed", "timeout", "rate_limited"] as const;
const UNIT_TYPES = ["token", "character", "credit", "second", "image", "request"] as const;

// ─── AI Usage Events（AI API 呼叫事件紀錄）─────────────────────────────────────
export const aiUsageEvents = mysqlTable(
  "ai_usage_events",
  {
    id: int("id").autoincrement().primaryKey(),
    provider: mysqlEnum("provider", AI_PROVIDERS).notNull(),
    endpoint: varchar("endpoint", { length: 256 }).notNull(),
    userId: int("userId"),
    apiKeyId: varchar("apiKeyId", { length: 128 }),
    status: mysqlEnum("status", USAGE_STATUSES).default("success").notNull(),
    units: decimal("units", { precision: 12, scale: 4 }).default("0"),
    unitType: mysqlEnum("unitType", UNIT_TYPES).default("request"),
    costUsd: decimal("costUsd", { precision: 12, scale: 6 }).default("0"),
    latencyMs: int("latencyMs"),
    requestMeta: json("requestMeta").$type<Record<string, unknown>>(),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    providerCreatedAtIdx: index("aue_provider_createdAt_idx").on(table.provider, table.createdAt),
    userIdCreatedAtIdx: index("aue_userId_createdAt_idx").on(table.userId, table.createdAt),
    statusCreatedAtIdx: index("aue_status_createdAt_idx").on(table.status, table.createdAt),
  })
);

export type AiUsageEvent = typeof aiUsageEvents.$inferSelect;
export type InsertAiUsageEvent = typeof aiUsageEvents.$inferInsert;

// ─── Provider Snapshots（每小時供應商狀態快照）─────────────────────────────────
export const providerSnapshots = mysqlTable(
  "provider_snapshots",
  {
    id: int("id").autoincrement().primaryKey(),
    provider: mysqlEnum("provider", AI_PROVIDERS).notNull(),
    tier: varchar("tier", { length: 64 }),
    quota: decimal("quota", { precision: 14, scale: 2 }),
    remaining: decimal("remaining", { precision: 14, scale: 2 }),
    nextInvoice: json("nextInvoice").$type<{ amountUsd?: number; dueDate?: string }>(),
    balanceUsd: decimal("balanceUsd", { precision: 12, scale: 2 }),
    concurrency: int("concurrency"),
    extraData: json("extraData").$type<Record<string, unknown>>(),
    snapshotAt: timestamp("snapshotAt").defaultNow().notNull(),
  },
  table => ({
    providerSnapshotAtIdx: index("ps_provider_snapshotAt_idx").on(table.provider, table.snapshotAt),
  })
);

export type ProviderSnapshot = typeof providerSnapshots.$inferSelect;
export type InsertProviderSnapshot = typeof providerSnapshots.$inferInsert;

// ─── Cost Aggregations（每日費用聚合）────────────────────────────────────────
export const costAggregations = mysqlTable(
  "cost_aggregations",
  {
    id: int("id").autoincrement().primaryKey(),
    provider: mysqlEnum("provider", AI_PROVIDERS).notNull(),
    endpoint: varchar("endpoint", { length: 256 }).notNull(),
    date: date("date").notNull(),
    callCount: int("callCount").default(0).notNull(),
    totalUnits: decimal("totalUnits", { precision: 14, scale: 4 }).default("0"),
    totalCostUsd: decimal("totalCostUsd", { precision: 14, scale: 6 }).default("0"),
  },
  table => ({
    providerDateIdx: index("ca_provider_date_idx").on(table.provider, table.date),
    dateIdx: index("ca_date_idx").on(table.date),
  })
);

export type CostAggregation = typeof costAggregations.$inferSelect;
export type InsertCostAggregation = typeof costAggregations.$inferInsert;

// ─── Rate Limit Rules（速率限制規則）───────────────────────────────────────
export const rateLimitRules = mysqlTable("rate_limit_rules", {
  id: int("id").autoincrement().primaryKey(),
  ruleType: mysqlEnum("ruleType", ["per_user", "per_api_key", "global"]).notNull(),
  targetId: varchar("targetId", { length: 128 }),
  provider: varchar("provider", { length: 32 }),
  dailyCallLimit: int("dailyCallLimit"),
  dailyCostLimitUsd: decimal("dailyCostLimitUsd", { precision: 10, scale: 2 }),
  monthlyCostLimitUsd: decimal("monthlyCostLimitUsd", { precision: 10, scale: 2 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RateLimitRule = typeof rateLimitRules.$inferSelect;
export type InsertRateLimitRule = typeof rateLimitRules.$inferInsert;

// ─── Alert Configs（告警設定）──────────────────────────────────────────────
export const alertConfigs = mysqlTable("alert_configs", {
  id: int("id").autoincrement().primaryKey(),
  alertType: mysqlEnum("alertType", ["budget", "quota", "anomaly"]).notNull(),
  provider: varchar("provider", { length: 32 }),
  thresholdPct: decimal("thresholdPct", { precision: 5, scale: 2 }),
  monthlyBudgetUsd: decimal("monthlyBudgetUsd", { precision: 10, scale: 2 }),
  isActive: boolean("isActive").default(true).notNull(),
  lastTriggeredAt: timestamp("lastTriggeredAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AlertConfig = typeof alertConfigs.$inferSelect;
export type InsertAlertConfig = typeof alertConfigs.$inferInsert;

// ─── Model Training Consents (肖像權 / 照片使用同意書)──────────────────────
//
// 訓練資料若包含真實人類或第三方版權素材，必須由本人 / 法定代理人 / 著作權
// 持有人簽署數位同意書，記錄主體姓名、簽署人身分、授權範圍、有效期間與
// 數位簽名（Base64 PNG）等欄位，並與訓練模型 (fineTunedModels) 連結。
//
// 一筆 consent 可保護多次訓練（複用），但每次 models.create 必須引用至少一筆
// 有效（未撤回、未過期）的 consent，否則後端拒絕訓練。

export const modelTrainingConsents = mysqlTable(
  "model_training_consents",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 上傳訓練資料、發起此同意書的使用者 */
    userId: int("userId").notNull(),

    /** 主體類型：本人 / 真實他人 / 第三方版權素材 */
    subjectType: mysqlEnum("subjectType", [
      "self",
      "real_person",
      "copyrighted",
    ]).notNull(),

    /** 同意書類型：肖像權 / 照片使用 / 兩者皆有 */
    consentType: mysqlEnum("consentType", [
      "portrait",
      "photo_usage",
      "both",
    ])
      .default("both")
      .notNull(),

    // ── 主體 / 被授權人資訊 ──────────────────────────────────────────────
    /** 主體 (被拍攝者 / 著作權人) 姓名 */
    subjectName: varchar("subjectName", { length: 128 }).notNull(),
    /** 主體聯絡 Email（可選，用於通知與撤回驗證） */
    subjectEmail: varchar("subjectEmail", { length: 320 }),
    /** 主體身分證件後 4 碼 / 護照尾碼 / 統編後 4 碼（不存全碼） */
    subjectIdLast4: varchar("subjectIdLast4", { length: 8 }),

    // ── 簽署人資訊（可能為主體本人、法定代理人、或著作權代表） ──────────
    signerName: varchar("signerName", { length: 128 }).notNull(),
    signerEmail: varchar("signerEmail", { length: 320 }).notNull(),
    /** 簽署人與主體的關係：本人 / 法定代理人 / 著作權持有人 / 授權代表 */
    signerRelation: mysqlEnum("signerRelation", [
      "self",
      "guardian",
      "copyright_holder",
      "authorized_representative",
    ]).notNull(),

    // ── 授權範圍 ─────────────────────────────────────────────────────────
    /** 授權使用範圍：僅內部訓練 / 內部 + 個人輸出 / 公開展示 / 商業使用 */
    usageScope: mysqlEnum("usageScope", [
      "training_only",
      "personal_output",
      "public_display",
      "commercial",
    ])
      .default("training_only")
      .notNull(),
    /** 是否允許衍生作品再分享 */
    allowDerivative: boolean("allowDerivative").default(false).notNull(),

    /** 有效期間起始 */
    validFrom: timestamp("validFrom").defaultNow().notNull(),
    /** 有效期間截止 (NULL = 無限期) */
    validUntil: timestamp("validUntil"),

    // ── 同意書內容快照 / 法律條款版本 ───────────────────────────────────
    /** 條款版本編號 (e.g. "v1.0-2026-05") */
    termsVersion: varchar("termsVersion", { length: 32 }).notNull(),
    /** 完整條款 plain text 快照（供日後爭議比對） */
    termsSnapshot: text("termsSnapshot").notNull(),

    // ── 數位簽名 ─────────────────────────────────────────────────────────
    /** 數位簽名圖檔 (Base64 PNG, data URL) */
    signatureDataUrl: text("signatureDataUrl").notNull(),
    /** 簽署當下的 IP（可選，用於驗證） */
    signedIp: varchar("signedIp", { length: 64 }),
    /** 簽署當下的 User-Agent（可選） */
    signedUserAgent: text("signedUserAgent"),
    signedAt: timestamp("signedAt").defaultNow().notNull(),

    // ── 證明文件 / 照片授權清單 ─────────────────────────────────────────
    /** 主體身分證明檔案 URL（如有上傳，e.g. ID 卡照片） */
    proofFileUrl: text("proofFileUrl"),
    proofFileKey: text("proofFileKey"),
    /** 此同意書授權的照片 / 影片 URL 清單（與訓練資料對應） */
    coveredAssets: json("coveredAssets").$type<
      Array<{
        url: string;
        fileKey?: string;
        kind: "image" | "video";
        sha256?: string;
      }>
    >(),

    // ── 撤回 ─────────────────────────────────────────────────────────────
    revokedAt: timestamp("revokedAt"),
    revokeReason: text("revokeReason"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("mtc_userId_idx").on(table.userId),
    userSubjectIdx: index("mtc_userId_subjectName_idx").on(
      table.userId,
      table.subjectName
    ),
    revokedIdx: index("mtc_revokedAt_idx").on(table.revokedAt),
  })
);

export type ModelTrainingConsent = typeof modelTrainingConsents.$inferSelect;
export type InsertModelTrainingConsent =
  typeof modelTrainingConsents.$inferInsert;

// ─── Consent ↔ Fine-Tuned Model 關聯（多對多）──────────────────────────────
export const fineTunedModelConsents = mysqlTable(
  "fine_tuned_model_consents",
  {
    id: int("id").autoincrement().primaryKey(),
    modelId: int("modelId").notNull(),
    consentId: int("consentId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    modelIdIdx: index("ftmc_modelId_idx").on(table.modelId),
    consentIdIdx: index("ftmc_consentId_idx").on(table.consentId),
  })
);

export type FineTunedModelConsent = typeof fineTunedModelConsents.$inferSelect;
export type InsertFineTunedModelConsent =
  typeof fineTunedModelConsents.$inferInsert;

// ─── Agent Collaboration (Multi-Agent System) ──────────────────────────────

export const agentCollaborationSessions = mysqlTable(
  "agent_collaboration_sessions",
  {
    collaborationId: varchar("collaboration_id", { length: 64 }).primaryKey(),
    userId: int("user_id").notNull(),
    sessionId: varchar("session_id", { length: 64 }).notNull(),
    taskDescription: text("task_description").notNull(),
    status: mysqlEnum("status", ["active", "completed", "failed", "cancelled"])
      .notNull()
      .default("active"),
    initiatingAgent: varchar("initiating_agent", { length: 32 }).notNull(),
    currentAgent: varchar("current_agent", { length: 32 }),
    participatingAgents: json("participating_agents")
      .notNull()
      .$type<string[]>(),
    requiredCapabilities: json("required_capabilities").$type<string[]>(),
    sharedContext: json("shared_context").$type<Record<string, unknown>>(),
    result: json("result").$type<Record<string, unknown>>(),
    planStatus: mysqlEnum("planStatus", ["no_plan", "planning", "plan_approved", "executing", "completed"])
      .default("no_plan"),
    planData: json("planData").$type<Record<string, unknown>>(),
    startedAt: bigint("started_at", { mode: "number" }).notNull(),
    completedAt: bigint("completed_at", { mode: "number" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userStatusIdx: index("acs_user_status_idx").on(table.userId, table.status),
    sessionIdx: index("acs_session_idx").on(table.sessionId),
    startedAtIdx: index("acs_started_at_idx").on(table.startedAt),
    statusIdx: index("acs_status_idx").on(table.status),
    planStatusIdx: index("plan_status_idx").on(table.planStatus),
  })
);

export type AgentCollaborationSession =
  typeof agentCollaborationSessions.$inferSelect;
export type InsertAgentCollaborationSession =
  typeof agentCollaborationSessions.$inferInsert;

export const agentCollaborationSteps = mysqlTable(
  "agent_collaboration_steps",
  {
    stepId: varchar("step_id", { length: 64 }).primaryKey(),
    collaborationId: varchar("collaboration_id", { length: 64 }).notNull(),
    stepOrder: int("step_order").notNull(),
    agentRole: varchar("agent_role", { length: 32 }).notNull(),
    stepDescription: text("step_description"),
    toolName: varchar("tool_name", { length: 64 }),
    toolArgs: json("tool_args").$type<Record<string, unknown>>(),
    dependencies: json("dependencies").$type<string[]>(),
    stepResult: json("step_result").$type<Record<string, unknown>>(),
    status: mysqlEnum("status", [
      "pending",
      "in_progress",
      "completed",
      "failed",
      "skipped",
    ])
      .notNull()
      .default("pending"),
    errorMessage: text("error_message"),
    retryCount: int("retry_count").notNull().default(0),
    maxRetries: int("max_retries").notNull().default(3),
    startedAt: bigint("started_at", { mode: "number" }),
    completedAt: bigint("completed_at", { mode: "number" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    collabOrderIdx: index("acst_collab_order_idx").on(
      table.collaborationId,
      table.stepOrder
    ),
    collabStatusIdx: index("acst_collab_status_idx").on(
      table.collaborationId,
      table.status
    ),
    agentRoleIdx: index("acst_agent_role_idx").on(table.agentRole),
    statusIdx: index("acst_status_idx").on(table.status),
  })
);

export type AgentCollaborationStep =
  typeof agentCollaborationSteps.$inferSelect;
export type InsertAgentCollaborationStep =
  typeof agentCollaborationSteps.$inferInsert;

export const agentCollaborationMessages = mysqlTable(
  "agent_collaboration_messages",
  {
    messageId: varchar("message_id", { length: 64 }).primaryKey(),
    collaborationId: varchar("collaboration_id", { length: 64 }),
    fromAgent: varchar("from_agent", { length: 32 }).notNull(),
    toAgent: varchar("to_agent", { length: 255 }).notNull(),
    messageType: mysqlEnum("message_type", [
      "request",
      "response",
      "notification",
      "handoff",
      "broadcast",
      "query",
      "share_context",
    ]).notNull(),
    priority: mysqlEnum("priority", ["low", "normal", "high", "urgent"])
      .notNull()
      .default("normal"),
    content: json("content").notNull().$type<Record<string, unknown>>(),
    correlationId: varchar("correlation_id", { length: 64 }),
    timestamp: bigint("timestamp", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    collabTimestampIdx: index("acm_collab_timestamp_idx").on(
      table.collaborationId,
      table.timestamp
    ),
    correlationIdx: index("acm_correlation_idx").on(table.correlationId),
    fromAgentIdx: index("acm_from_agent_idx").on(table.fromAgent),
    toAgentIdx: index("acm_to_agent_idx").on(table.toAgent),
    timestampIdx: index("acm_timestamp_idx").on(table.timestamp),
  })
);

export type AgentCollaborationMessage =
  typeof agentCollaborationMessages.$inferSelect;
export type InsertAgentCollaborationMessage =
  typeof agentCollaborationMessages.$inferInsert;

export const agentCollaborationHandoffs = mysqlTable(
  "agent_collaboration_handoffs",
  {
    handoffId: varchar("handoff_id", { length: 64 }).primaryKey(),
    collaborationId: varchar("collaboration_id", { length: 64 }).notNull(),
    fromAgent: varchar("from_agent", { length: 32 }).notNull(),
    toAgent: varchar("to_agent", { length: 32 }).notNull(),
    handoffReason: text("handoff_reason"),
    contextTransferred: json("context_transferred").$type<
      Record<string, unknown>
    >(),
    timestamp: bigint("timestamp", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    collabTimestampIdx: index("ach_collab_timestamp_idx").on(
      table.collaborationId,
      table.timestamp
    ),
    fromToIdx: index("ach_from_to_idx").on(table.fromAgent, table.toAgent),
  })
);

export type AgentCollaborationHandoff =
  typeof agentCollaborationHandoffs.$inferSelect;
export type InsertAgentCollaborationHandoff =
  typeof agentCollaborationHandoffs.$inferInsert;

export const agentPerformanceMetrics = mysqlTable(
  "agent_performance_metrics",
  {
    metricId: bigint("metric_id", { mode: "number" })
      .autoincrement()
      .primaryKey(),
    agentRole: varchar("agent_role", { length: 32 }).notNull(),
    metricDate: date("metric_date").notNull(),
    totalCollaborations: int("total_collaborations").notNull().default(0),
    successfulSteps: int("successful_steps").notNull().default(0),
    failedSteps: int("failed_steps").notNull().default(0),
    avgStepDurationMs: bigint("avg_step_duration_ms", { mode: "number" }),
    totalToolInvocations: int("total_tool_invocations").notNull().default(0),
    toolSuccessRate: decimal("tool_success_rate", {
      precision: 5,
      scale: 2,
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    agentDateIdx: index("apm_agent_date_idx").on(
      table.agentRole,
      table.metricDate
    ),
  })
);

export type AgentPerformanceMetric =
  typeof agentPerformanceMetrics.$inferSelect;
export type InsertAgentPerformanceMetric =
  typeof agentPerformanceMetrics.$inferInsert;

// ─── Orb Multi-Session Conversations ───────────────────────────────────────
// Stores user-facing chat sessions so a single user can keep several parallel
// conversations open in tabs. The chat itself stays stateless on the server
// (`ai.chat` doesn't read from these tables); the client persists each turn
// here so history survives device switches and a tab list is available on
// reload.

export const orbConversations = mysqlTable(
  "orb_conversations",
  {
    conversationId: varchar("conversation_id", { length: 48 }).primaryKey(),
    userId: int("user_id").notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    pinned: boolean("pinned").default(false).notNull(),
    archivedAt: timestamp("archived_at"),
    lastMessageAt: timestamp("last_message_at"),
    messageCount: int("message_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userUpdatedIdx: index("orbc_user_updated_idx").on(
      table.userId,
      table.updatedAt
    ),
    userArchivedIdx: index("orbc_user_archived_idx").on(
      table.userId,
      table.archivedAt
    ),
  })
);

export type OrbConversation = typeof orbConversations.$inferSelect;
export type InsertOrbConversation = typeof orbConversations.$inferInsert;

export const orbConversationMessages = mysqlTable(
  "orb_conversation_messages",
  {
    messageId: bigint("message_id", { mode: "number" })
      .autoincrement()
      .primaryKey(),
    conversationId: varchar("conversation_id", { length: 48 }).notNull(),
    userId: int("user_id").notNull(),
    role: mysqlEnum("role", ["user", "orb"]).notNull(),
    text: text("text").notNull(),
    /** Client-side message timestamp (ms since epoch) — used for ordering. */
    at: bigint("at", { mode: "number" }).notNull(),
    /** Optional structured metadata: attachments, intent, actions, sources. */
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    convAtIdx: index("orbcm_conv_at_idx").on(
      table.conversationId,
      table.at
    ),
    userConvIdx: index("orbcm_user_conv_idx").on(
      table.userId,
      table.conversationId
    ),
  })
);

export type OrbConversationMessage =
  typeof orbConversationMessages.$inferSelect;
export type InsertOrbConversationMessage =
  typeof orbConversationMessages.$inferInsert;

// ─── Studio Recipes ─────────────────────────────────────────────────────
// Persists 創作工作室 RecipeLibraryPanel SavedRecipe[] across sessions / devices.
// Was previously kept only in component state (Studio.tsx:686), so a refresh
// wiped every saved recipe — that defeats the "library" promise.
export const studioRecipes = mysqlTable(
  "studio_recipes",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    modality: mysqlEnum("modality", ["image", "video", "music", "voice"]).notNull(),
    /** Full SavedRecipe payload — blocks / thoughtIslands / advancedPrompt /
     *  references / promptStrength / generationParams. We keep it as JSON
     *  rather than splitting into columns because the shape is owned by
     *  client/src/stores/workspaceStore.ts and may evolve faster than the
     *  schema migration cadence. */
    payload: json("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("sr_userId_idx").on(table.userId),
    userIdModalityIdx: index("sr_userId_modality_idx").on(
      table.userId,
      table.modality
    ),
  })
);

export type StudioRecipe = typeof studioRecipes.$inferSelect;
export type InsertStudioRecipe = typeof studioRecipes.$inferInsert;

// ─── Studio Versions ────────────────────────────────────────────────────
// Persists 創作工作室 VersionHistoryPanel VersionEntry[] across sessions.
// Previously also in-memory only — versions disappeared on refresh, so the
// "回到上一版" UX was broken across sessions.
export const studioVersions = mysqlTable(
  "studio_versions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    modality: mysqlEnum("modality", ["image", "video", "music", "voice"]).notNull(),
    /** Client-supplied stable id (matches VersionEntry.id) so the frontend's
     *  pinnedVersionId / restore flow keeps working without a server round-trip. */
    versionKey: varchar("versionKey", { length: 64 }).notNull(),
    pinned: boolean("pinned").default(false).notNull(),
    /** Full VersionEntry payload (blocks / thoughtIslands / compiledPrompt /
     *  changedFields / generationSettings / outputUrl / actionMode). */
    payload: json("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("sv_userId_idx").on(table.userId),
    userIdModalityIdx: index("sv_userId_modality_idx").on(
      table.userId,
      table.modality
    ),
    userIdVersionKeyIdx: index("sv_userId_versionKey_idx").on(
      table.userId,
      table.versionKey
    ),
  })
);

export type StudioVersion = typeof studioVersions.$inferSelect;
export type InsertStudioVersion = typeof studioVersions.$inferInsert;

// ─── Orb Long-Term Memory ───────────────────────────────────────────────
export const orbLongTermMemories = mysqlTable(
  "orb_long_term_memories",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    memoryType: mysqlEnum("memoryType", [
      "user_fact",
      "user_preference",
      "skill_learned",
      "workflow_pattern",
      "error_solution",
      "success_recipe",
      "context_snippet",
    ]).notNull(),
    content: text("content").notNull(),
    importanceScore: decimal("importanceScore", { precision: 3, scale: 2 })
      .notNull()
      .default("0.50"),
    embeddingVector: json("embeddingVector").$type<number[]>(),
    sourceType: mysqlEnum("sourceType", [
      "conversation",
      "action",
      "observation",
      "inference",
    ])
      .notNull()
      .default("conversation"),
    sourceId: varchar("sourceId", { length: 128 }),
    spiritId: varchar("spiritId", { length: 64 }),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    accessCount: int("accessCount").notNull().default(0),
    lastAccessedAt: timestamp("lastAccessedAt"),
    expiresAt: timestamp("expiresAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdx: index("orb_ltm_user_idx").on(table.userId),
    userTypeIdx: index("orb_ltm_user_type_idx").on(table.userId, table.memoryType),
    importanceIdx: index("orb_ltm_importance_idx").on(
      table.userId,
      table.importanceScore
    ),
    spiritIdx: index("orb_ltm_spirit_idx").on(table.spiritId),
    accessedIdx: index("orb_ltm_accessed_idx").on(table.lastAccessedAt),
    expiresIdx: index("orb_ltm_expires_idx").on(table.expiresAt),
  })
);

export type OrbLongTermMemory = typeof orbLongTermMemories.$inferSelect;
export type InsertOrbLongTermMemory = typeof orbLongTermMemories.$inferInsert;

export const orbMemoryAssociations = mysqlTable(
  "orb_memory_associations",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    fromMemoryId: bigint("fromMemoryId", { mode: "number" }).notNull(),
    toMemoryId: bigint("toMemoryId", { mode: "number" }).notNull(),
    associationType: mysqlEnum("associationType", [
      "related_to",
      "caused_by",
      "part_of",
      "similar_to",
      "contradicts",
      "supersedes",
    ])
      .notNull()
      .default("related_to"),
    strength: decimal("strength", { precision: 3, scale: 2 })
      .notNull()
      .default("0.50"),
    createdBy: varchar("createdBy", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    uniqueAssoc: uniqueIndex("orb_memory_assoc_uk").on(
      table.fromMemoryId,
      table.toMemoryId,
      table.associationType
    ),
    fromIdx: index("orb_memory_assoc_from_idx").on(table.fromMemoryId),
    toIdx: index("orb_memory_assoc_to_idx").on(table.toMemoryId),
    strengthIdx: index("orb_memory_assoc_strength_idx").on(table.strength),
  })
);

export type OrbMemoryAssociation = typeof orbMemoryAssociations.$inferSelect;
export type InsertOrbMemoryAssociation = typeof orbMemoryAssociations.$inferInsert;

// ─── Orb Intent Clarification ───────────────────────────────────────────
export const orbIntentLogs = mysqlTable(
  "orb_intent_logs",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    conversationId: varchar("conversationId", { length: 128 }).notNull(),
    userInput: text("userInput").notNull(),
    detectedIntents: json("detectedIntents")
      .$type<Array<{ intent: string; confidence: number; category: string }>>()
      .notNull(),
    primaryIntent: varchar("primaryIntent", { length: 128 }),
    intentConfidence: decimal("intentConfidence", { precision: 3, scale: 2 }),
    ambiguityScore: decimal("ambiguityScore", { precision: 3, scale: 2 }),
    needsClarification: boolean("needsClarification").notNull().default(false),
    context: json("context").$type<Record<string, unknown>>(),
    spiritAssigned: varchar("spiritAssigned", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdx: index("orb_intent_user_idx").on(table.userId),
    convIdx: index("orb_intent_conv_idx").on(table.conversationId),
    primaryIdx: index("orb_intent_primary_idx").on(table.primaryIntent),
    needsClarificationIdx: index("orb_intent_needs_clarification_idx").on(
      table.needsClarification
    ),
    createdIdx: index("orb_intent_created_idx").on(table.createdAt),
  })
);

export type OrbIntentLog = typeof orbIntentLogs.$inferSelect;
export type InsertOrbIntentLog = typeof orbIntentLogs.$inferInsert;

export const orbClarificationHistory = mysqlTable(
  "orb_clarification_history",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    intentLogId: bigint("intentLogId", { mode: "number" }).notNull(),
    userId: int("userId").notNull(),
    conversationId: varchar("conversationId", { length: 128 }).notNull(),
    clarificationQuestion: text("clarificationQuestion").notNull(),
    questionType: mysqlEnum("questionType", [
      "choice",
      "confirm",
      "parameter",
      "constraint",
      "preference",
      "context",
    ]).notNull(),
    options: json("options").$type<
      Array<{ value: string; label: string; description?: string }>
    >(),
    userAnswer: text("userAnswer"),
    answeredAt: timestamp("answeredAt"),
    resolvedIntent: varchar("resolvedIntent", { length: 128 }),
    resolutionConfidence: decimal("resolutionConfidence", {
      precision: 3,
      scale: 2,
    }),
    spiritAsked: varchar("spiritAsked", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    intentIdx: index("orb_clarif_intent_idx").on(table.intentLogId),
    userIdx: index("orb_clarif_user_idx").on(table.userId),
    convIdx: index("orb_clarif_conv_idx").on(table.conversationId),
    typeIdx: index("orb_clarif_type_idx").on(table.questionType),
    answeredIdx: index("orb_clarif_answered_idx").on(table.answeredAt),
  })
);

export type OrbClarificationHistory = typeof orbClarificationHistory.$inferSelect;
export type InsertOrbClarificationHistory = typeof orbClarificationHistory.$inferInsert;

export const orbUserAnswerPatterns = mysqlTable(
  "orb_user_answer_patterns",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    questionType: varchar("questionType", { length: 64 }).notNull(),
    contextPattern: text("contextPattern"),
    commonAnswers: json("commonAnswers")
      .$type<Array<{ answer: string; frequency: number; lastUsed: string }>>()
      .notNull(),
    defaultPreference: text("defaultPreference"),
    confidenceScore: decimal("confidenceScore", { precision: 3, scale: 2 })
      .notNull()
      .default("0.50"),
    sampleCount: int("sampleCount").notNull().default(0),
    lastUpdatedAt: timestamp("lastUpdatedAt").defaultNow().onUpdateNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdx: index("orb_answer_user_idx").on(table.userId),
    confidenceIdx: index("orb_answer_confidence_idx").on(
      table.userId,
      table.confidenceScore
    ),
  })
);

export type OrbUserAnswerPattern = typeof orbUserAnswerPatterns.$inferSelect;
export type InsertOrbUserAnswerPattern = typeof orbUserAnswerPatterns.$inferInsert;

// ─── Orb Feature Discovery ──────────────────────────────────────────────
export const orbFeatureUsageStats = mysqlTable(
  "orb_feature_usage_stats",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    featureId: varchar("featureId", { length: 128 }).notNull(),
    usageCount: int("usageCount").notNull().default(0),
    successCount: int("successCount").notNull().default(0),
    failureCount: int("failureCount").notNull().default(0),
    avgDuration: decimal("avgDuration", { precision: 10, scale: 2 }),
    lastUsedAt: timestamp("lastUsedAt"),
    firstUsedAt: timestamp("firstUsedAt").defaultNow().notNull(),
    proficiencyScore: decimal("proficiencyScore", { precision: 3, scale: 2 }),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    uniqueUserFeature: uniqueIndex("orb_feature_usage_uk").on(
      table.userId,
      table.featureId
    ),
    userIdx: index("orb_feature_usage_user_idx").on(table.userId),
    featureIdx: index("orb_feature_usage_feature_idx").on(table.featureId),
    lastUsedIdx: index("orb_feature_usage_last_used_idx").on(
      table.userId,
      table.lastUsedAt
    ),
    proficiencyIdx: index("orb_feature_usage_proficiency_idx").on(
      table.userId,
      table.proficiencyScore
    ),
  })
);

export type OrbFeatureUsageStat = typeof orbFeatureUsageStats.$inferSelect;
export type InsertOrbFeatureUsageStat = typeof orbFeatureUsageStats.$inferInsert;

export const orbFeatureDiscoveryPaths = mysqlTable(
  "orb_feature_discovery_paths",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    featureId: varchar("featureId", { length: 128 }).notNull(),
    discoveryMethod: mysqlEnum("discoveryMethod", [
      "orb_suggestion",
      "menu_exploration",
      "search",
      "tutorial",
      "friend_share",
      "documentation",
      "accident",
    ]).notNull(),
    fromFeatureId: varchar("fromFeatureId", { length: 128 }),
    context: text("context"),
    timeToFirstUse: int("timeToFirstUse"),
    discoveredAt: timestamp("discoveredAt").defaultNow().notNull(),
  },
  table => ({
    userIdx: index("orb_discovery_user_idx").on(table.userId),
    featureIdx: index("orb_discovery_feature_idx").on(table.featureId),
    methodIdx: index("orb_discovery_method_idx").on(table.discoveryMethod),
    fromIdx: index("orb_discovery_from_idx").on(table.fromFeatureId),
  })
);

export type OrbFeatureDiscoveryPath = typeof orbFeatureDiscoveryPaths.$inferSelect;
export type InsertOrbFeatureDiscoveryPath = typeof orbFeatureDiscoveryPaths.$inferInsert;

export const orbFeatureRecommendations = mysqlTable(
  "orb_feature_recommendations",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    featureId: varchar("featureId", { length: 128 }).notNull(),
    reason: text("reason").notNull(),
    relevanceScore: decimal("relevanceScore", { precision: 3, scale: 2 }).notNull(),
    basedOnFeatures: json("basedOnFeatures").$type<string[]>(),
    presentedAt: timestamp("presentedAt").defaultNow().notNull(),
    clickedAt: timestamp("clickedAt"),
    usedAt: timestamp("usedAt"),
    dismissedAt: timestamp("dismissedAt"),
    feedbackRating: int("feedbackRating"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdx: index("orb_feature_rec_user_idx").on(table.userId),
    featureIdx: index("orb_feature_rec_feature_idx").on(table.featureId),
    presentedIdx: index("orb_feature_rec_presented_idx").on(table.presentedAt),
    relevanceIdx: index("orb_feature_rec_relevance_idx").on(
      table.userId,
      table.relevanceScore
    ),
  })
);

export type OrbFeatureRecommendation = typeof orbFeatureRecommendations.$inferSelect;
export type InsertOrbFeatureRecommendation = typeof orbFeatureRecommendations.$inferInsert;

// ─── Orb Workflow Automation ────────────────────────────────────────────
export const orbWorkflowTemplates = mysqlTable(
  "orb_workflow_templates",
  {
    id: int("id").autoincrement().primaryKey(),
    creatorUserId: int("creatorUserId"),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    category: varchar("category", { length: 64 }).notNull(),
    isPublic: boolean("isPublic").notNull().default(false),
    isVerified: boolean("isVerified").notNull().default(false),
    steps: json("steps")
      .$type<
        Array<{
          stepId: string;
          spiritId: string;
          toolName: string;
          parameters: Record<string, unknown>;
          conditions?: {
            skipIf?: string;
            retryOn?: string[];
            maxRetries?: number;
          };
          description?: string;
        }>
      >()
      .notNull(),
    inputSchema: json("inputSchema").$type<Record<string, unknown>>(),
    outputSchema: json("outputSchema").$type<Record<string, unknown>>(),
    estimatedDuration: int("estimatedDuration"),
    difficulty: mysqlEnum("difficulty", ["beginner", "intermediate", "advanced"])
      .notNull()
      .default("beginner"),
    tags: json("tags").$type<string[]>(),
    usageCount: int("usageCount").notNull().default(0),
    avgRating: decimal("avgRating", { precision: 3, scale: 2 }),
    ratingCount: int("ratingCount").notNull().default(0),
    version: varchar("version", { length: 32 }).notNull().default("1.0.0"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    creatorIdx: index("orb_workflow_tmpl_creator_idx").on(table.creatorUserId),
    categoryIdx: index("orb_workflow_tmpl_category_idx").on(table.category),
    publicIdx: index("orb_workflow_tmpl_public_idx").on(
      table.isPublic,
      table.avgRating
    ),
    usageIdx: index("orb_workflow_tmpl_usage_idx").on(table.usageCount),
  })
);

export type OrbWorkflowTemplate = typeof orbWorkflowTemplates.$inferSelect;
export type InsertOrbWorkflowTemplate = typeof orbWorkflowTemplates.$inferInsert;

export const orbWorkflowExecutions = mysqlTable(
  "orb_workflow_executions",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    templateId: int("templateId").notNull(),
    userId: int("userId").notNull(),
    conversationId: varchar("conversationId", { length: 128 }),
    status: mysqlEnum("status", [
      "pending",
      "running",
      "paused",
      "completed",
      "failed",
      "cancelled",
    ])
      .notNull()
      .default("pending"),
    inputs: json("inputs").$type<Record<string, unknown>>(),
    outputs: json("outputs").$type<Record<string, unknown>>(),
    currentStepIndex: int("currentStepIndex").notNull().default(0),
    totalSteps: int("totalSteps").notNull(),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    durationSeconds: int("durationSeconds"),
    error: text("error"),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    templateIdx: index("orb_workflow_exec_template_idx").on(table.templateId),
    userIdx: index("orb_workflow_exec_user_idx").on(table.userId),
    statusIdx: index("orb_workflow_exec_status_idx").on(
      table.status,
      table.updatedAt
    ),
    convIdx: index("orb_workflow_exec_conv_idx").on(table.conversationId),
  })
);

export type OrbWorkflowExecution = typeof orbWorkflowExecutions.$inferSelect;
export type InsertOrbWorkflowExecution = typeof orbWorkflowExecutions.$inferInsert;

export const orbWorkflowStepExecutions = mysqlTable(
  "orb_workflow_step_executions",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    executionId: bigint("executionId", { mode: "number" }).notNull(),
    stepIndex: int("stepIndex").notNull(),
    stepId: varchar("stepId", { length: 128 }).notNull(),
    spiritId: varchar("spiritId", { length: 64 }).notNull(),
    toolName: varchar("toolName", { length: 128 }).notNull(),
    status: mysqlEnum("status", [
      "pending",
      "running",
      "completed",
      "failed",
      "skipped",
    ])
      .notNull()
      .default("pending"),
    inputs: json("inputs").$type<Record<string, unknown>>(),
    outputs: json("outputs").$type<Record<string, unknown>>(),
    error: text("error"),
    retryCount: int("retryCount").notNull().default(0),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    durationSeconds: int("durationSeconds"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    uniqueExecutionStep: uniqueIndex("orb_workflow_step_uk").on(
      table.executionId,
      table.stepIndex
    ),
    execIdx: index("orb_workflow_step_exec_idx").on(table.executionId),
    statusIdx: index("orb_workflow_step_status_idx").on(table.status),
    spiritIdx: index("orb_workflow_step_spirit_idx").on(table.spiritId),
  })
);

export type OrbWorkflowStepExecution = typeof orbWorkflowStepExecutions.$inferSelect;
export type InsertOrbWorkflowStepExecution = typeof orbWorkflowStepExecutions.$inferInsert;

export const orbWorkflowTemplateRatings = mysqlTable(
  "orb_workflow_template_ratings",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    templateId: int("templateId").notNull(),
    userId: int("userId").notNull(),
    rating: int("rating").notNull(), // 1-5 stars
    comment: text("comment"),
    wasHelpful: boolean("wasHelpful"),
    completedSuccessfully: boolean("completedSuccessfully"),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    uniqueUserRating: uniqueIndex("orb_tmpl_rating_uk").on(
      table.templateId,
      table.userId
    ),
    templateIdx: index("orb_tmpl_rating_template_idx").on(
      table.templateId,
      table.rating
    ),
    userIdx: index("orb_tmpl_rating_user_idx").on(table.userId),
    createdIdx: index("orb_tmpl_rating_created_idx").on(table.createdAt),
  })
);

export type OrbWorkflowTemplateRating = typeof orbWorkflowTemplateRatings.$inferSelect;
export type InsertOrbWorkflowTemplateRating = typeof orbWorkflowTemplateRatings.$inferInsert;

// ─── Orb System Monitoring ──────────────────────────────────────────────
export const orbSpiritCollaborationMetrics = mysqlTable(
  "orb_spirit_collaboration_metrics",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    date: date("date").notNull(),
    fromSpiritId: varchar("fromSpiritId", { length: 64 }).notNull(),
    toSpiritId: varchar("toSpiritId", { length: 64 }).notNull(),
    handoffCount: int("handoffCount").notNull().default(0),
    avgHandoffTime: decimal("avgHandoffTime", { precision: 10, scale: 2 }),
    successfulHandoffs: int("successfulHandoffs").notNull().default(0),
    failedHandoffs: int("failedHandoffs").notNull().default(0),
    userSatisfactionScore: decimal("userSatisfactionScore", {
      precision: 3,
      scale: 2,
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    uniqueCollabMetric: uniqueIndex("orb_collab_metrics_uk").on(
      table.date,
      table.fromSpiritId,
      table.toSpiritId
    ),
    dateIdx: index("orb_collab_metrics_date_idx").on(table.date),
    fromIdx: index("orb_collab_metrics_from_idx").on(table.fromSpiritId),
    toIdx: index("orb_collab_metrics_to_idx").on(table.toSpiritId),
  })
);

export type OrbSpiritCollaborationMetric = typeof orbSpiritCollaborationMetrics.$inferSelect;
export type InsertOrbSpiritCollaborationMetric = typeof orbSpiritCollaborationMetrics.$inferInsert;

export const orbSystemHealthMetrics = mysqlTable(
  "orb_system_health_metrics",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
    metricType: mysqlEnum("metricType", [
      "response_time",
      "error_rate",
      "tool_success_rate",
      "user_satisfaction",
      "memory_usage",
      "api_latency",
      "clarification_rate",
    ]).notNull(),
    spiritId: varchar("spiritId", { length: 64 }),
    value: decimal("value", { precision: 10, scale: 2 }).notNull(),
    unit: varchar("unit", { length: 32 }).notNull(),
    threshold: decimal("threshold", { precision: 10, scale: 2 }),
    isHealthy: boolean("isHealthy").notNull().default(true),
    metadata: json("metadata").$type<Record<string, unknown>>(),
  },
  table => ({
    timestampIdx: index("orb_health_timestamp_idx").on(table.timestamp),
    typeIdx: index("orb_health_type_idx").on(table.metricType, table.timestamp),
    spiritIdx: index("orb_health_spirit_idx").on(table.spiritId, table.timestamp),
    unhealthyIdx: index("orb_health_unhealthy_idx").on(
      table.isHealthy,
      table.timestamp
    ),
  })
);

export type OrbSystemHealthMetric = typeof orbSystemHealthMetrics.$inferSelect;
export type InsertOrbSystemHealthMetric = typeof orbSystemHealthMetrics.$inferInsert;

export const orbCostAttribution = mysqlTable(
  "orb_cost_attribution",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    date: date("date").notNull(),
    userId: int("userId").notNull(),
    spiritId: varchar("spiritId", { length: 64 }).notNull(),
    toolName: varchar("toolName", { length: 128 }).notNull(),
    usageCount: int("usageCount").notNull().default(0),
    totalTokens: bigint("totalTokens", { mode: "number" }),
    totalApiCalls: int("totalApiCalls"),
    estimatedCostUsd: decimal("estimatedCostUsd", { precision: 10, scale: 4 }),
    avgDuration: decimal("avgDuration", { precision: 10, scale: 2 }),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    uniqueCostAttr: uniqueIndex("orb_cost_attr_uk").on(
      table.date,
      table.userId,
      table.spiritId,
      table.toolName
    ),
    dateIdx: index("orb_cost_date_idx").on(table.date),
    userIdx: index("orb_cost_user_idx").on(table.userId, table.date),
    spiritIdx: index("orb_cost_spirit_idx").on(table.spiritId, table.date),
    amountIdx: index("orb_cost_amount_idx").on(table.estimatedCostUsd),
  })
);

export type OrbCostAttribution = typeof orbCostAttribution.$inferSelect;
export type InsertOrbCostAttribution = typeof orbCostAttribution.$inferInsert;

export const orbSystemAlerts = mysqlTable(
  "orb_system_alerts",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    alertType: mysqlEnum("alertType", [
      "health_critical",
      "health_warning",
      "cost_spike",
      "performance_degradation",
      "error_rate_high",
      "system_overload",
    ]).notNull(),
    severity: mysqlEnum("severity", ["low", "medium", "high", "critical"]).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message").notNull(),
    spiritId: varchar("spiritId", { length: 64 }),
    metricType: varchar("metricType", { length: 64 }),
    metricValue: decimal("metricValue", { precision: 10, scale: 2 }),
    threshold: decimal("threshold", { precision: 10, scale: 2 }),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    isResolved: boolean("isResolved").notNull().default(false),
    resolvedAt: timestamp("resolvedAt"),
    resolvedBy: int("resolvedBy"),
    resolutionNotes: text("resolutionNotes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    typeIdx: index("orb_alert_type_idx").on(
      table.alertType,
      table.severity,
      table.createdAt
    ),
    resolvedIdx: index("orb_alert_resolved_idx").on(
      table.isResolved,
      table.createdAt
    ),
    spiritIdx: index("orb_alert_spirit_idx").on(table.spiritId),
    metricIdx: index("orb_alert_metric_idx").on(table.metricType),
  })
);

export type OrbSystemAlert = typeof orbSystemAlerts.$inferSelect;
export type InsertOrbSystemAlert = typeof orbSystemAlerts.$inferInsert;

// ─── Worldbuilding Frameworks ─────────────────────────────────────────────
// 導演 AI 的自訂世界觀架構器：
//   - 一個 framework 代表一個「世界」，可有多角色（主角/配角/反派）
//     與多場景（環境、植被、物件、氛圍變化）
//   - 角色與場景可選擇性 linkedModelIds 對應到 fine_tuned_models（LoRA），
//     讓導演 AI 在生成圖像/影片時知道要套用哪個訓練模型
//   - 角色與場景內容以 JSON 儲存，schema 由 shared/worldbuilding-types.ts
//     定義，避免反覆 ALTER TABLE
export const worldbuildingFrameworks = mysqlTable(
  "worldbuilding_frameworks",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    /** 整體世界觀基調（例如：賽博龐克、奇幻、療癒小品） */
    genre: varchar("genre", { length: 128 }),
    /** 時代背景（例如：中世紀、近代、未來、架空） — 與 genre 正交 */
    era: varchar("era", { length: 128 }),
    /** 角色卡陣列 — 結構見 shared/worldbuilding-types WorldCharacter */
    charactersJson: json("charactersJson")
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    /** 場景卡陣列 — 結構見 shared/worldbuilding-types WorldScene */
    scenesJson: json("scenesJson")
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    /** 全域物件清單（可被多個場景引用） */
    objectsJson: json("objectsJson").$type<Array<Record<string, unknown>>>(),
    /** 連結到模型訓練中心的 fine_tuned_models.id 陣列 */
    linkedModelIds: json("linkedModelIds").$type<number[]>(),
    tags: json("tags").$type<string[]>(),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("wf_userId_idx").on(table.userId),
    userIdCreatedAtIdx: index("wf_userId_createdAt_idx").on(
      table.userId,
      table.createdAt
    ),
  })
);

export type WorldbuildingFramework =
  typeof worldbuildingFrameworks.$inferSelect;
export type InsertWorldbuildingFramework =
  typeof worldbuildingFrameworks.$inferInsert;

// ─── Model Wishlist（模型許願池）─────────────────────────────────────────
// 使用者許願希望平台支援的 AI 模型；其他人可投票表示需求。
//   * modelWishes：許願主體
//   * modelWishVotes：去重投票，(wishId, userId) 唯一
export const modelWishes = mysqlTable(
  "model_wishes",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    modelName: varchar("modelName", { length: 191 }).notNull(),
    provider: varchar("provider", { length: 128 }),
    modality: mysqlEnum("modality", [
      "text",
      "image",
      "video",
      "audio",
      "voice",
      "3d",
      "multimodal",
      "embedding",
      "other",
    ])
      .default("other")
      .notNull(),
    reason: text("reason"),
    referenceUrl: text("referenceUrl"),
    /** 去正規化的票數計數（同步自 modelWishVotes，避免每次列表 COUNT） */
    voteCount: int("voteCount").default(0).notNull(),
    status: mysqlEnum("status", [
      "pending",
      "under_review",
      "planned",
      "added",
      "rejected",
    ])
      .default("pending")
      .notNull(),
    adminNote: text("adminNote"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    statusIdx: index("mw_status_idx").on(table.status),
    voteCountIdx: index("mw_vote_count_idx").on(table.voteCount),
    userIdIdx: index("mw_user_idx").on(table.userId),
  })
);

export type ModelWish = typeof modelWishes.$inferSelect;
export type InsertModelWish = typeof modelWishes.$inferInsert;

export const modelWishVotes = mysqlTable(
  "model_wish_votes",
  {
    id: int("id").autoincrement().primaryKey(),
    wishId: int("wishId").notNull(),
    userId: int("userId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    wishUserUk: uniqueIndex("mw_votes_wish_user_uk").on(
      table.wishId,
      table.userId
    ),
    userIdx: index("mw_votes_user_idx").on(table.userId),
  })
);

export type ModelWishVote = typeof modelWishVotes.$inferSelect;
export type InsertModelWishVote = typeof modelWishVotes.$inferInsert;
