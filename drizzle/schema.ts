import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  mediumtext,
  timestamp,
  varchar,
  json,
  boolean,
  decimal,
  bigint,
  date,
  index,
  uniqueIndex,
  tinyint,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
// AIDV-270: 多模態輸入素材契約型別（type-only，編譯期抹除，不影響 drizzle-kit / 前端 bundle）。
import type { VideoInputAsset } from "../shared/video-input-assets";

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
    /** Soft-delete marker. Non-null = account has been deleted by the user. */
    deletedAt: timestamp("deletedAt"),
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
      "teaching_archive_ingestion",
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
    expiresAt: timestamp("expiresAt"),
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
    // 0047: AI 生成來源追蹤 — sourceStudio / modelId 標註資產來自哪個工作室
    // 與哪個 AI 模型，讓「我的資產」可依工作室分類；backgroundJobId 連回原
    // 始任務記錄。皆為 nullable 以相容手動上傳與舊資料。
    sourceStudio: varchar("sourceStudio", { length: 32 }),
    modelId: varchar("modelId", { length: 128 }),
    backgroundJobId: int("backgroundJobId"),
    // 0058: archival / source provenance tracking — sourceUrl 保留原始外部
    // URL（從第三方匯入時用）、provider 標註資產實際儲存供應商（s3 / r2
    // / gcs 等），archivedAt / expiresAt 支援冷儲存與保留期管理，
    // archivalChecksum 存歸檔當下的 sha256 hash，回溯校驗用。
    sourceUrl: text("sourceUrl"),
    provider: varchar("provider", { length: 32 }),
    archivedAt: timestamp("archivedAt"),
    expiresAt: timestamp("expiresAt"),
    archivalChecksum: varchar("archivalChecksum", { length: 64 }),
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
    userIdSourceStudioIdx: index("dal_userId_sourceStudio_idx").on(
      table.userId,
      table.sourceStudio
    ),
    // 0058: functional index on (archivedAt IS NULL, createdAt) —
    // 加速「未歸檔資產依建立時間排序」這個熱路徑（資產庫預設視圖）。
    archivedNullCreatedAtIdx: index("dal_archivedNull_createdAt_idx").on(
      sql`(\`archivedAt\` IS NULL)`,
      table.createdAt
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
    /** team_shared 模型所屬團隊；個人模型為 null。M（訓練 track）。 */
    teamId: int("teamId"),
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
    teamIdIdx: index("ftm_teamId_idx").on(table.teamId),
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
    // AIDV-864: 快速情境回饋擴充欄位（PR①）
    featureArea: varchar("feature_area", { length: 120 }),
    pageContext: json("page_context").$type<{
      route?: string;
      url?: string;
      shell?: string;
      viewport?: string;
      appVersion?: string;
    }>(),
    landmark: json("landmark").$type<{
      selector?: string;
      label?: string;
      rect?: { x?: number; y?: number; w?: number; h?: number };
      textSnippet?: string;
    }>(),
    screenshotKey: varchar("screenshot_key", { length: 512 }),
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
    // 0058: archival / source provenance tracking — 同 digital_asset_library
    // 的設計：sourceUrl 紀錄原始外部來源、provider 為實際儲存供應商、
    // archivedAt / expiresAt 支援冷儲存與保留期、archivalChecksum 為歸檔
    // 當下的 sha256 hash。
    sourceUrl: text("sourceUrl"),
    provider: varchar("provider", { length: 32 }),
    archivedAt: timestamp("archivedAt"),
    expiresAt: timestamp("expiresAt"),
    archivalChecksum: varchar("archivalChecksum", { length: 64 }),
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
    // 0058: functional index on (archivedAt IS NULL, createdAt) —
    // 加速「未歸檔生成紀錄依建立時間排序」的列表 query。
    archivedNullCreatedAtIdx: index("gh_archivedNull_createdAt_idx").on(
      sql`(\`archivedAt\` IS NULL)`,
      table.createdAt
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

// ─── Prompt ↔ Asset 關聯（junction）────────────────────────────────────────
// 已拍板採 junction 而非在資產表上加單一 promptId 欄：一個 prompt 會衍生多個
// 資產（重生成/變體/延長），一個資產也可能被多個 prompt 觸及（rewrite 鏈）。
// relation 記這條邊的語意：
//   derived  = 生成完成鏈自動建立（資產由該 prompt 直接生成；backfill 也用此值）
//   variant  = 同 prompt 重骰的變體
//   rewrite  = prompt 改寫後再生成的承接關係
//   extended = 延長（影片續段等）
// 不在 schema 掛 references()（全檔慣例：schema 無 FK 宣告）；DB 層 FK 由
// migration 0075 用 ALTER TABLE ADD CONSTRAINT 補（同 0055 teaching_archive_fk
// 模式），兩側 ON DELETE CASCADE — 任一端刪除時關聯邊自動清除。
export const promptAssets = mysqlTable(
  "prompt_assets",
  {
    id: int("id").autoincrement().primaryKey(),
    promptId: int("promptId").notNull(), // → prompt_library.id
    assetId: int("assetId").notNull(), // → digital_asset_library.id
    relation: mysqlEnum("relation", ["derived", "variant", "rewrite", "extended"])
      .default("derived")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    promptIdIdx: index("pa_promptId_idx").on(table.promptId),
    assetIdIdx: index("pa_assetId_idx").on(table.assetId),
    // 冪等去重：同一條 (prompt, asset, relation) 邊只存一次 — 生成鏈重跑
    // （webhook + polling 雙路徑）與 backfill 重跑都靠它擋重複。
    promptAssetRelUnique: uniqueIndex("pa_prompt_asset_rel_unique").on(
      table.promptId,
      table.assetId,
      table.relation
    ),
  })
);

export type PromptAssetLink = typeof promptAssets.$inferSelect;
export type InsertPromptAssetLink = typeof promptAssets.$inferInsert;

// ─── Prompt Collection（個人提示詞收集，可團隊共享）────────────────────────
// 比照 digital_asset_library 的 private / team_shared visibility 模型。
// 收集標的：站內任何可重用的提示詞（25 位精靈的 system slice、18 條精靈
// 主動觸發句、模型 prompt 樣板、ImageStudio 內建模板、使用者手動輸入）。
// 詳見 drizzle/0063_prompt_collection.sql 的設計理由。
export const promptCollection = mysqlTable(
  "prompt_collection",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    content: text("content").notNull(),
    category: varchar("category", { length: 64 }).default("general").notNull(),
    tags: json("tags").$type<string[]>(),
    /** 使用者收集時加註的「為何想保留 / 想怎麼用」。 */
    notes: text("notes"),
    /**
     * 來源類型 — 決定收藏條目要怎麼回連到站內：
     *   • agent_role        — 25 位精靈的 system prompt slice
     *   • proactive_trigger — 18 條精靈主動觸發 default prompt
     *   • model_template    — modelPromptTemplates.ts 內的 prompt 樣板
     *   • image_studio      — ImageStudio (t2i / sd) 內建模板
     *   • site_prompt       — 其他站內系統內建片段
     *   • manual            — 使用者完全自輸入
     */
    sourceType: varchar("sourceType", { length: 32 })
      .default("manual")
      .notNull(),
    /** 來源唯一識別（AgentRole / event id / model prefix / template id）。 */
    sourceRef: varchar("sourceRef", { length: 128 }),
    /** 顯示用標籤（例「圖圖 image-specialist」、「FLUX Pro 樣板」）。 */
    sourceLabel: varchar("sourceLabel", { length: 256 }),
    visibility: mysqlEnum("visibility", ["private", "team_shared"])
      .default("private")
      .notNull(),
    /**
     * 若 visibility=team_shared，必須指向一個 team；該 team 的成員可讀。
     * private 時為 NULL。
     */
    teamId: int("teamId"),
    isFavorite: boolean("isFavorite").default(false).notNull(),
    useCount: int("useCount").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("pc_userId_idx").on(table.userId),
    userVisibilityIdx: index("pc_userId_visibility_idx").on(
      table.userId,
      table.visibility
    ),
    teamVisibilityIdx: index("pc_teamId_visibility_idx").on(
      table.teamId,
      table.visibility
    ),
    sourceTypeIdx: index("pc_sourceType_idx").on(table.sourceType),
    userSourceUk: uniqueIndex("pc_user_source_uk").on(
      table.userId,
      table.sourceType,
      table.sourceRef
    ),
  })
);

export type PromptCollectionItem = typeof promptCollection.$inferSelect;
export type InsertPromptCollectionItem = typeof promptCollection.$inferInsert;

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

// ─── R2 Object Catalog（AIDV-66 M3 媒體快照：per-object 記錄）────────────────
export const r2ObjectCatalog = mysqlTable(
  "r2_object_catalog",
  {
    id: int("id").autoincrement().primaryKey(),
    snapshotId: int("snapshotId").notNull(),
    objectKey: varchar("objectKey", { length: 1024 }).notNull(),
    fileSizeBytes: bigint("fileSizeBytes", { mode: "number" }).notNull().default(0),
    etag: varchar("etag", { length: 64 }),
    category: varchar("category", { length: 32 }),
    lastModified: timestamp("lastModified"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    snapshotIdIdx: index("r2oc_snapshotId_idx").on(table.snapshotId),
    objectKeyIdx: index("r2oc_objectKey_idx").on(table.objectKey),
  })
);

export type R2ObjectCatalogEntry = typeof r2ObjectCatalog.$inferSelect;
export type InsertR2ObjectCatalogEntry = typeof r2ObjectCatalog.$inferInsert;

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

// ─── Stripe Webhook Events（AIDV-167：事件級冪等 + 重放安全 + 人審軌跡）────────
//
// 每一顆進站的 Stripe 事件（僅本服務接手的類型）在處理前先「claim」一列：
//   eventId UNIQUE ＝事件級冪等鍵（Stripe evt_...；重送/重放同事件只落地一次）。
//   status 生命週期：processing →（processed | held | skipped | failed）。
//     - processed：已成功落地（開通/續期/降級已寫入 user_subscriptions）。
//     - held     ：裁決從嚴——資訊不足（無法解析 user / 方案 / 未知狀態）不自動
//                  變更權益，凍結轉人審（holdReason 說明原因，payload 供人審）。
//     - skipped  ：安全略過（out-of-order 舊事件、訂閱已終結）。
//     - failed   ：處理拋錯；webhook 回 5xx 讓 Stripe 重試，重試時可 re-claim。
//   eventCreated（Stripe event.created）用於同訂閱事件的亂序防護：
//     已存在「更新的 processed 事件」→ 舊事件直接 skipped，不倒退狀態。
export const stripeWebhookEvents = mysqlTable(
  "stripe_webhook_events",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Stripe 事件 id（evt_...）；payload 無 id 時為 payload 雜湊衍生鍵。 */
    eventId: varchar("eventId", { length: 191 }).notNull(),
    eventType: varchar("eventType", { length: 64 }).notNull(),
    /** data.object.id（cs_... / in_... / sub_...），供追查。 */
    objectId: varchar("objectId", { length: 191 }),
    /** 關聯的 Stripe subscription id（亂序防護的分組鍵）。 */
    subscriptionId: varchar("subscriptionId", { length: 64 }),
    /** Stripe event.created（事件產生時間，非收到時間）。 */
    eventCreated: timestamp("eventCreated"),
    status: mysqlEnum("status", [
      "processing",
      "processed",
      "held",
      "skipped",
      "failed",
    ])
      .default("processing")
      .notNull(),
    /** held/skipped 的原因（人審依據）。 */
    holdReason: text("holdReason"),
    /** failed 的錯誤摘要。 */
    error: text("error"),
    /** 處理嘗試次數（failed 後 Stripe 重試會 +1）。 */
    attempts: int("attempts").default(1).notNull(),
    /** data.object 快照（人審/重放依據）。 */
    payload: json("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    // 事件級冪等的最終真相：同 eventId 併發雙寫其一撞 ER_DUP_ENTRY。
    eventIdUnique: uniqueIndex("swe_eventId_unique").on(table.eventId),
    // 亂序防護查詢：同 subscription 是否已有更新的 processed 事件。
    subscriptionIdx: index("swe_subscription_idx").on(
      table.subscriptionId,
      table.status
    ),
    // 人審清單查詢（status=held）。
    statusIdx: index("swe_status_idx").on(table.status),
    createdAtIdx: index("swe_createdAt_idx").on(table.createdAt),
  })
);

export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
export type InsertStripeWebhookEvent = typeof stripeWebhookEvents.$inferInsert;

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
    // ── AIDV-14（migration 0079）：彙總的 TWD 呈現 + 稽核匯率 ────────────────────
    // totalCostTwd = totalCostUsd × exchangeRate（聚合 job 換算時凍結匯率以利回溯）。
    totalCostTwd: decimal("totalCostTwd", { precision: 16, scale: 4 }).default("0"),
    exchangeRate: decimal("exchangeRate", { precision: 12, scale: 6 }),
  },
  table => ({
    providerDateIdx: index("ca_provider_date_idx").on(table.provider, table.date),
    dateIdx: index("ca_date_idx").on(table.date),
  })
);

export type CostAggregation = typeof costAggregations.$inferSelect;
export type InsertCostAggregation = typeof costAggregations.$inferInsert;

// ─── Cost Ledger（AIDV-153 append-only 雙分錄成本帳本）────────────────────────
//
// 現況（待升級的反型樣）：餘額＝users.remainingGenerations 單一可變整數，扣款/
// 退款都「就地 mutate」（server/db.ts deductUserPoints/refundUserPoints），無不可
// 變交易 log；cost_aggregations 由 SUM(ai_usage_events.costUsd) 聚合、某些路徑偶現
// $0.00。本表是「基礎版」：一張 append-only（只 INSERT，永不 UPDATE/DELETE 既有列）
// 的雙分錄帳本，餘額由 log 加總「算出來」、不就地改任何欄位。
//
// 設計（基礎版，旗標 ENABLE_COST_LEDGER 預設 OFF＝零行為變化、純並行寫）：
//   accountKey     : 帳戶鍵（科目維度），格式 "<type>:<id>"，type ∈ project/member/
//                    workflow（雙分錄科目定義待 Bruce 拍板，故先存自由字串鍵）。
//   entryType      : debit（借）/ credit（貸）。基礎版約定：消耗成本記 debit、
//                    退款/沖銷記 credit；computeBalance = SUM(credit) - SUM(debit)。
//   amount         : DECIMAL(12,6) 正值（方向由 entryType 表達，金額本身永遠 ≥ 0）。
//   status         : pending（hold 預留）→ posted（正式入帳）/ archived（沖銷作廢）。
//                    hold 生命週期：先以 pending 預留額度，成功轉 posted、失敗轉
//                    archived（不計入餘額）。
//   idempotencyKey : 唯一鍵。同一 key 重複 postEntry 不重複入帳（冪等保證）。
//   refType/refId  : 來源憑證（如 ai_usage_event / generation_job），供對帳追溯。
//
// 並行於現有 cost_aggregations、不取代、不改既有餘額寫法（HARD SAFETY ②純加法）。
const LEDGER_ENTRY_TYPES = ["debit", "credit"] as const;
const LEDGER_STATUSES = ["pending", "posted", "archived"] as const;

export const costLedger = mysqlTable(
  "cost_ledger",
  {
    id: int("id").autoincrement().primaryKey(),
    accountKey: varchar("accountKey", { length: 128 }).notNull(),
    entryType: mysqlEnum("entryType", LEDGER_ENTRY_TYPES).notNull(),
    // amount：保留為「原始幣別」金額（預設 USD，真實呼叫價）。AIDV-14 不改其語義
    // 與既有 #940 寫法，故 sourceCurrency 預設 USD、amount 仍是 USD（向後相容）。
    amount: decimal("amount", { precision: 12, scale: 6 }).default("0").notNull(),
    status: mysqlEnum("status", LEDGER_STATUSES).default("posted").notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    refType: varchar("refType", { length: 64 }),
    refId: varchar("refId", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    // ── AIDV-14 內部成本歸屬可視（migration 0079）───────────────────────────────
    // 歸屬維度（拿不到的誠實留 null）：member 由 accountKey 承載；project/workflow
    // 額外存欄位以利彙總查詢與多維歸屬。
    projectId: varchar("projectId", { length: 128 }),
    workflowId: varchar("workflowId", { length: 128 }),
    // 稽核回溯（不可只存換完數字而丟來源）：原始幣別 + 所用匯率 + 換算後 TWD。
    // amount=原始幣別金額（預設 USD 真實價）；sourceCurrency 標示其幣別；
    // exchangeRate=所用 TWD/USD 匯率；amountTwd=amount×exchangeRate（落帳當下凍結）。
    sourceCurrency: varchar("sourceCurrency", { length: 8 }).default("USD"),
    exchangeRate: decimal("exchangeRate", { precision: 12, scale: 6 }),
    amountTwd: decimal("amountTwd", { precision: 14, scale: 4 }),
    // provider / model（誰花的成本來自哪個供應商/模型，供成本拆解）。
    provider: varchar("provider", { length: 32 }),
    model: varchar("model", { length: 128 }),
    // costSource：成本數字的來源標記，供稽核區分。
    //   "provider"＝上游回應實際計費（usage.cost，最準）；
    //   "catalog" ＝modelPricing 目錄真實單位價後援（次準，線上四家供應商無 usage.cost
    //               時用以讓成本可視）。null＝舊資料/未標。
    costSource: varchar("costSource", { length: 16 }),
    // ── AIDV-130 S-5（migration 0086）：Skill 成本維度 ──────────────────────────
    // 每筆 Skill 執行的分錄帶上 skillId@skillVersion，支援依 Skill 彙總成本。
    skillId: varchar("skillId", { length: 128 }),
    skillVersion: varchar("skillVersion", { length: 32 }),
  },
  table => ({
    idempotencyKeyUnique: uniqueIndex("cl_idempotencyKey_unique").on(
      table.idempotencyKey
    ),
    accountKeyStatusIdx: index("cl_accountKey_status_idx").on(
      table.accountKey,
      table.status
    ),
    refIdx: index("cl_ref_idx").on(table.refType, table.refId),
    createdAtIdx: index("cl_createdAt_idx").on(table.createdAt),
    projectIdx: index("cl_projectId_idx").on(table.projectId),
    workflowIdx: index("cl_workflowId_idx").on(table.workflowId),
    skillIdx: index("cl_skillId_idx").on(table.skillId),
  })
);

export type CostLedgerEntry = typeof costLedger.$inferSelect;
export type InsertCostLedgerEntry = typeof costLedger.$inferInsert;

// ─── Cost Attribution Outbox（AIDV-14 不漏帳 outbox）──────────────────────────
//
// 為什麼需要 outbox：#940 在 aiProxy 的 setImmediate 內「best-effort」寫 ledger，
// 失敗只 console.warn 吞掉 → ledger 缺一筆、無重試＝漏帳。AIDV-14 改成：成本歸屬
// 落帳前先把「落帳意圖（payload）」原子寫入本 outbox（pending），再由 drain 流程
// 重試 postTransaction，成功才標 done。drain 失敗會留 pending 等下輪重試（attempts++），
// 故 ledger 不漏帳；冪等鍵（idempotencyKey）確保重送不雙重入帳。
//
// status：pending（待落帳）→ done（已落帳）/ dead（重試上限放棄，留人工查）。
// payloadJson：postTransaction 所需的完整參數快照（幣別/匯率/維度一併凍結）。
// HARD SAFETY：旗標 ENABLE_COST_ATTRIBUTION 預設 ON、demo/無 DB（getDb()===null）跳過；
// 寫入與 drain 皆 try/catch 不阻塞生成熱路徑（比照 #940 ledger/audit log 型樣）。
const ATTRIBUTION_OUTBOX_STATUSES = ["pending", "done", "dead"] as const;

export const costAttributionOutbox = mysqlTable(
  "cost_attribution_outbox",
  {
    id: int("id").autoincrement().primaryKey(),
    // 冪等基準鍵（通常 = aue:<usageEventId>）；UNIQUE 擋同一事件重複入 outbox。
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    status: mysqlEnum("status", ATTRIBUTION_OUTBOX_STATUSES)
      .default("pending")
      .notNull(),
    // postAttributedCost 所需參數快照（JSON）。drain 時據此重放落帳。
    payloadJson: json("payloadJson").$type<Record<string, unknown>>().notNull(),
    attempts: int("attempts").default(0).notNull(),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    idempotencyKeyUnique: uniqueIndex("cao_idempotencyKey_unique").on(
      table.idempotencyKey
    ),
    statusCreatedAtIdx: index("cao_status_createdAt_idx").on(
      table.status,
      table.createdAt
    ),
  })
);

export type CostAttributionOutbox = typeof costAttributionOutbox.$inferSelect;
export type InsertCostAttributionOutbox =
  typeof costAttributionOutbox.$inferInsert;

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
    /** 樂觀鎖：多代理並行更新時 WHERE id=? AND version=? 確保唯一寫入者（AIDV-323/316） */
    version: int("version").notNull().default(0),
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

// ─── Agent Dynamic Registry（動態代理能力登記）──────────────────────────────
// AIDV-323/317：外部代理上線登記 capabilities + costPerToken；
// heartbeat 更新 currentLoad；assign 依 capability match + load 最低選派。
// 與 agentCollaborationOrchestrator 的靜態 in-memory registry 互補：
// 前者用於外部/長期代理，後者用於本地 session 內的角色派送。
export const agentDynamicRegistry = mysqlTable(
  "agent_dynamic_registry",
  {
    id: int("id").autoincrement().primaryKey(),
    agentId: varchar("agentId", { length: 64 }).notNull().unique(),
    capabilities: json("capabilities").notNull().$type<string[]>(),
    /** Agent Scope allowlist（AIDV-331）：允許的端點 scope，e.g. ["read:project","write:script"] */
    allowedEndpoints: json("allowedEndpoints").$type<string[]>(),
    costPerToken: decimal("costPerToken", { precision: 16, scale: 10 }).notNull().default("0"),
    currentLoad: decimal("currentLoad", { precision: 5, scale: 4 }).notNull().default("0"),
    /** 並發容量上限（AIDV-496）：currentLoad 達到此值時不再派工，預設 1.0（即任何負載皆可接）。 */
    maxLoad: decimal("maxLoad", { precision: 5, scale: 4 }).notNull().default("1.0000"),
    isActive: boolean("isActive").notNull().default(true),
    lastHeartbeatAt: timestamp("lastHeartbeatAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    isActiveLoadIdx: index("adr_isActive_load_idx").on(table.isActive, table.currentLoad),
  })
);

export type AgentDynamicRegistry = typeof agentDynamicRegistry.$inferSelect;
export type InsertAgentDynamicRegistry = typeof agentDynamicRegistry.$inferInsert;

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

// ─── Agent DLQ ─────────────────────────────────────────────────────────────
// Dead-letter queue for validation gate failures (AIDV-346).
// lint/build failures → retry; test/unknown → decision; max-retry → escalate.

export const agentDlq = mysqlTable(
  "agent_dlq",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    issueKey: varchar("issue_key", { length: 64 }).notNull(),
    agentId: varchar("agent_id", { length: 64 }),
    userId: int("user_id").notNull(),
    failureType: mysqlEnum("failure_type", [
      "lint",
      "test",
      "build",
      "unknown",
    ]).notNull(),
    routingAction: mysqlEnum("routing_action", [
      "retry",
      "decision",
      "escalate",
    ]).notNull(),
    failureReason: text("failure_reason"),
    payload: json("payload").$type<Record<string, unknown>>(),
    retryCount: int("retry_count").notNull().default(0),
    /** AIDV-926: 跨日誌追蹤用——同一次驗證門失敗請求的 server log 與 DLQ row 共用同一個 ID。 */
    correlationId: varchar("correlation_id", { length: 64 }),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: varchar("resolved_by", { length: 64 }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    issueKeyIdx: index("adlq_issue_key_idx").on(table.issueKey),
    pendingIdx: index("adlq_pending_idx").on(
      table.routingAction,
      table.resolvedAt
    ),
    correlationIdx: index("adlq_correlation_idx").on(table.correlationId),
  })
);

export type AgentDlqEntry = typeof agentDlq.$inferSelect;
export type InsertAgentDlqEntry = typeof agentDlq.$inferInsert;

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
    /** Skill manifest id backing this step (null for non-Skill steps). AIDV-126. */
    skillId: varchar("skillId", { length: 128 }),
    /** Pinned skill version (semver). Null for non-Skill steps. */
    skillVersion: varchar("skillVersion", { length: 32 }),
    /** Input values snapshot at execution time (audit trail). */
    inputSnapshot: json("inputSnapshot").$type<Record<string, unknown>>(),
    /** Effective permissions granted to this skill instance. */
    permissionSnapshot: json("permissionSnapshot").$type<Record<string, unknown>>(),
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
    skillIdx: index("orb_workflow_step_skill_idx").on(table.skillId),
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

// MYSQL LEGACY — not used in Postgres/Supabase prod.
// The live production table is "system_alerts" (Supabase public schema, created via
// supabase/migrations/). providerHealthProbeJob writes there via Supabase client SDK,
// not via this Drizzle object. Any code reading `orbSystemAlerts` from this file is
// reading the MySQL schema only. New monitoring code must target Supabase "system_alerts".
// AIDV-726, AIDV-730: naming gap documented to prevent future confusion.
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
    /** 動畫擴充：畫面風格設定陣列 — 結構見 WorldStyleProfile */
    styleProfilesJson: json("styleProfilesJson").$type<
      Array<Record<string, unknown>>
    >(),
    /** 動畫擴充：配樂主題陣列 — 結構見 WorldMusicTheme */
    musicThemesJson: json("musicThemesJson").$type<
      Array<Record<string, unknown>>
    >(),
    /** 動畫擴充：預設使用的 styleProfile id */
    defaultStyleProfileId: varchar("defaultStyleProfileId", { length: 64 }),
    /** 動畫擴充：全域 negative prompt */
    globalNegativePrompt: text("globalNegativePrompt"),
    /** 動畫擴充：製作目標（格式、目標時長、受眾、平台） */
    productionTargetsJson: json("productionTargetsJson").$type<Record<
      string,
      unknown
    >>(),
    /** v4：世界研究資料庫條目陣列 */
    researchEntriesJson: json("researchEntriesJson").$type<
      Array<Record<string, unknown>>
    >(),
    /** v4：世界共用音效 / 環境音庫 */
    soundLibraryJson: json("soundLibraryJson").$type<
      Array<Record<string, unknown>>
    >(),
    /** v4：世界共用上傳資產引用清單 */
    uploadedAssetsJson: json("uploadedAssetsJson").$type<
      Array<Record<string, unknown>>
    >(),
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

// ─── World Storyboards（動畫分鏡時間軸） ──────────────────────────────────
// 一個世界觀可有多個動畫分鏡（短片 / 預告 / MV），每個分鏡是一條時間軸：
//   - scenesJson：每場 sequence、起訖秒數、登場角色 beats、圖楨陣列、音軌片段
//   - 與 worldbuilding_frameworks 多對一：刪除 framework 時級聯刪除
//   - 動畫管線 plan 步驟存 jobsJson；最終影片 URL 存 finalVideoUrl
//
// 結構詳見 shared/worldbuilding-animation.ts WorldStoryboard。
export const worldStoryboards = mysqlTable(
  "world_storyboards",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /** 關聯 worldbuilding_frameworks.id */
    worldId: int("worldId").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    totalDurationSec: int("totalDurationSec").notNull(),
    fps: int("fps").notNull().default(24),
    aspectRatio: varchar("aspectRatio", { length: 16 })
      .notNull()
      .default("16:9"),
    /** 整個 storyboard.scenes 陣列 — 結構見 WorldStoryboard.scenes */
    scenesJson: json("scenesJson")
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    /** 與原始長腳本的關聯（如有） */
    sourceScriptId: varchar("sourceScriptId", { length: 64 }),
    narration: text("narration"),
    productionStatus: varchar("productionStatus", { length: 32 })
      .notNull()
      .default("planning"),
    finalVideoUrl: varchar("finalVideoUrl", { length: 2048 }),
    estimatedCostUsd: varchar("estimatedCostUsd", { length: 32 }),
    /** 動畫管線執行計畫快照（最近一次 planAnimationPipeline 的輸出） */
    pipelinePlanJson: json("pipelinePlanJson").$type<Record<string, unknown>>(),
    /** 各 step 的執行狀態（stepId → { status, output, error, ... }） */
    jobsJson: json("jobsJson").$type<Record<string, Record<string, unknown>>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("ws_userId_idx").on(table.userId),
    worldIdIdx: index("ws_worldId_idx").on(table.worldId),
    userIdCreatedAtIdx: index("ws_userId_createdAt_idx").on(
      table.userId,
      table.createdAt
    ),
  })
);

export type WorldStoryboard = typeof worldStoryboards.$inferSelect;
export type InsertWorldStoryboard = typeof worldStoryboards.$inferInsert;

// ─── Timeline Frames（時間軸圖幀） ─────────────────────────────────────────
// migration: drizzle/0064_timeline_frames_and_compositions.sql
// 與 world_storyboards 多對一；一致性檢查結果存 consistency_check_json
export const timelineFrames = mysqlTable(
  "timeline_frames",
  {
    id: int("id").autoincrement().primaryKey(),
    storyboardId: int("storyboard_id").notNull(),
    sceneId: varchar("scene_id", { length: 64 }).notNull(),
    userId: int("user_id").notNull(),
    timeOffsetSec: decimal("time_offset_sec", { precision: 10, scale: 2 }).notNull(),
    imageUrl: varchar("image_url", { length: 2048 }).notNull(),
    frameType: mysqlEnum("frame_type", [
      "keyframe",
      "concept_art",
      "reference",
      "storyboard_sketch",
      "final_render",
    ])
      .notNull()
      .default("keyframe"),
    title: varchar("title", { length: 255 }),
    description: text("description"),
    tags: json("tags").$type<string[]>(),
    consistencyCheckJson: json("consistency_check_json").$type<
      Record<string, unknown>
    >(),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    storyboardIdx: index("tf_storyboard_idx").on(table.storyboardId),
    sceneIdx: index("tf_scene_idx").on(table.sceneId),
    userIdx: index("tf_user_idx").on(table.userId),
    timeIdx: index("tf_time_idx").on(table.timeOffsetSec),
  })
);

export type TimelineFrameRow = typeof timelineFrames.$inferSelect;
export type InsertTimelineFrame = typeof timelineFrames.$inferInsert;

// ─── Scene Compositions（多角色多場景構圖） ────────────────────────────────
// migration: drizzle/0064_timeline_frames_and_compositions.sql
// elements_json 存合成元素陣列；ai_suggestions_json 存 AI 構圖建議
export const sceneCompositions = mysqlTable(
  "scene_compositions",
  {
    id: int("id").autoincrement().primaryKey(),
    worldId: int("world_id").notNull(),
    storyboardId: int("storyboard_id"),
    userId: int("user_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    canvasWidth: int("canvas_width").notNull().default(1920),
    canvasHeight: int("canvas_height").notNull().default(1080),
    backgroundSceneId: varchar("background_scene_id", { length: 64 }),
    backgroundImageUrl: varchar("background_image_url", { length: 2048 }),
    elementsJson: json("elements_json")
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    aiSuggestionsJson: json("ai_suggestions_json").$type<
      Array<Record<string, unknown>>
    >(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    worldIdx: index("sc_world_idx").on(table.worldId),
    storyboardIdx: index("sc_storyboard_idx").on(table.storyboardId),
    userIdx: index("sc_user_idx").on(table.userId),
  })
);

export type SceneCompositionRow = typeof sceneCompositions.$inferSelect;
export type InsertSceneComposition = typeof sceneCompositions.$inferInsert;

// ─── Creative Projects（創作專案）─────────────────────────────────────────
// 把 Director session + Worldbuilding framework + World Storyboard 三者綁定
// 成一個有意義的創作單位，讓全站光球與各 Studio 頁面可以共享上下文。
//
// References（刻意不用 FK，方便重新綁定）：
//   directorSessionId  → project_notes_calendar.id（導演對話存在 project_notes
//                        裡，noteType = "script" + tag "director-session"）
//   worldFrameworkId   → worldbuilding_frameworks.id
//   worldStoryboardId  → world_storyboards.id
export const creativeProjects = mysqlTable(
  "creative_projects",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    /** 連結 project_notes_calendar.id（導演對話 session） */
    directorSessionId: int("directorSessionId"),
    /** Phase 1 alias: 連結世界觀主資料（nullable） */
    worldviewId: int("worldviewId"),
    /** Phase 1 alias: 連結腳本資料（nullable） */
    scriptId: int("scriptId"),
    /** 連結 worldbuilding_frameworks.id */
    worldFrameworkId: int("worldFrameworkId"),
    /** 連結 world_storyboards.id */
    worldStoryboardId: int("worldStoryboardId"),
    status: mysqlEnum("status", [
      "concept",
      "production",
      "review",
      "complete",
    ])
      .default("concept")
      .notNull(),
    coverImageUrl: varchar("coverImageUrl", { length: 2048 }),
    tags: json("tags").$type<string[]>(),
    /** 預留擴充欄位（例如未來的設計案連結、品牌設定 id 等） */
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
    /** AIDV-316 樂觀鎖：多代理並行更新時 WHERE id=? AND version=? 確保唯一寫入者，衝突回傳 409。 */
    version: int("version").notNull().default(0),
  },
  table => ({
    userIdIdx: index("cp_userId_idx").on(table.userId),
    userIdUpdatedAtIdx: index("cp_userId_updatedAt_idx").on(
      table.userId,
      table.updatedAt
    ),
    worldFrameworkIdIdx: index("cp_worldFrameworkId_idx").on(
      table.worldFrameworkId
    ),
    worldStoryboardIdIdx: index("cp_worldStoryboardId_idx").on(
      table.worldStoryboardId
    ),
  })
);

export type CreativeProject = typeof creativeProjects.$inferSelect;
export type InsertCreativeProject = typeof creativeProjects.$inferInsert;

// ─── Orchestration Runs（任務總指揮入口紀錄）─────────────────────────────────
// M1-B：記錄使用者每次創作意圖。第一版 createIntent 只建立 pending run，不呼叫
// 任何外部模型 / Perplexity / SubQ / MCP。projectId 可為 null（無 project
// context 時仍可建立 run）。成本與 plan / tool / citation 欄位先保留結構，由後續
// M5（commander adapter）與 M6（cost ledger）填入。
export const orchestrationRuns = mysqlTable(
  "orchestration_runs",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /** 可為 null：未選專案時仍可建立 run（標記為無 project context）。 */
    projectId: int("projectId"),
    teamId: int("teamId"),
    mode: mysqlEnum("mode", [
      "create",
      "director",
      "video",
      "assets",
      "database",
    ]).notNull(),
    intent: text("intent").notNull(),
    status: mysqlEnum("status", [
      "pending",
      "planned",
      "waiting_confirmation",
      "running",
      "completed",
      "failed",
      "cancelled",
    ])
      .default("pending")
      .notNull(),
    /** 指揮層（fallback / perplexity / subq / orb / codex / claude）；第一版為 null。 */
    commander: mysqlEnum("commander", [
      "fallback",
      "perplexity",
      "subq",
      "orb",
      "codex",
      "claude",
    ]),
    planJson: json("planJson"),
    contextPacketIdsJson: json("contextPacketIdsJson").$type<number[]>(),
    toolCallsJson: json("toolCallsJson"),
    citationsJson: json("citationsJson"),
    searchResultsJson: json("searchResultsJson"),
    /** 任務優先序（AIDV-331 Priority Queue）：urgent = 插隊、background = 低優先 */
    priority: mysqlEnum("priority", ["urgent", "normal", "background"]).notNull().default("normal"),
    /** 預估成本（USD）；第一版為 null，欄位先保留。 */
    estimatedCostUsd: decimal("estimatedCostUsd", { precision: 10, scale: 6 }),
    actualCostUsd: decimal("actualCostUsd", { precision: 10, scale: 6 }),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("orun_userId_idx").on(table.userId),
    projectIdIdx: index("orun_projectId_idx").on(table.projectId),
    projectCreatedAtIdx: index("orun_projectId_createdAt_idx").on(
      table.projectId,
      table.createdAt
    ),
    userCreatedAtIdx: index("orun_userId_createdAt_idx").on(
      table.userId,
      table.createdAt
    ),
  })
);

export type OrchestrationRun = typeof orchestrationRuns.$inferSelect;
export type InsertOrchestrationRun = typeof orchestrationRuns.$inferInsert;

// ─── Context Packets（可重用的創作上下文包）─────────────────────────────────
// M4：把 project + 團隊資料 + 外部來源摘成可重用、有 TTL 的小上下文包。
// sourceRefsJson 存 ContextSourceRef[]（source-agnostic；schema 端用 unknown[]
// 避免 server→schema 依賴循環，service 端再轉型）。
export const contextPackets = mysqlTable(
  "context_packets",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("projectId").notNull(),
    teamId: int("teamId"),
    userId: int("userId").notNull(),
    scope: mysqlEnum("scope", ["project", "team", "user"])
      .default("project")
      .notNull(),
    sourceRefsJson: json("sourceRefsJson").$type<unknown[]>(),
    summaryMarkdown: mediumtext("summaryMarkdown"),
    tokenEstimate: int("tokenEstimate"),
    /** 產生摘要的模型；deterministic 拼接時為 null。 */
    createdByModel: varchar("createdByModel", { length: 64 }),
    /** TTL：過期後 reuseOrRefreshPacket 會重算。 */
    expiresAt: timestamp("expiresAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    projectIdIdx: index("cp_projectId_idx").on(table.projectId),
    projectCreatedAtIdx: index("cp_projectId_createdAt_idx").on(
      table.projectId,
      table.createdAt
    ),
    userIdIdx: index("cp_userId_idx").on(table.userId),
    teamIdIdx: index("cp_teamId_idx").on(table.teamId),
    expiresAtIdx: index("cp_expiresAt_idx").on(table.expiresAt),
  })
);

export type ContextPacket = typeof contextPackets.$inferSelect;
export type InsertContextPacket = typeof contextPackets.$inferInsert;

// ─── Project Data Access Rules（資料來源存取規則）───────────────────────────
// M4：控制哪個 team / project 可用哪些內部 material 或外部 connection，
// 以及 accessLevel 與可用 mode。projectId 為 null 代表 team-wide 預設規則。
export const projectDataAccessRules = mysqlTable(
  "project_data_access_rules",
  {
    id: int("id").autoincrement().primaryKey(),
    teamId: int("teamId").notNull(),
    /** null = team-wide 預設；有值 = project 專屬覆寫。 */
    projectId: int("projectId"),
    /** 單筆 teaching_materials。 */
    materialId: int("materialId"),
    /** 外部來源連接（cloud / notes / mcp）。 */
    connectionId: int("connectionId"),
    /** 未來：material 的集合分組。 */
    collectionId: int("collectionId"),
    accessLevel: mysqlEnum("accessLevel", [
      "none",
      "summary_only",
      "chunk_access",
      "full_reference",
    ])
      .default("summary_only")
      .notNull(),
    /** 可用 mode 陣列；null = 全部 mode。 */
    allowedModesJson: json("allowedModesJson").$type<string[]>(),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    teamIdIdx: index("pdar_teamId_idx").on(table.teamId),
    projectIdIdx: index("pdar_projectId_idx").on(table.projectId),
    materialIdIdx: index("pdar_materialId_idx").on(table.materialId),
    teamProjectIdx: index("pdar_teamId_projectId_idx").on(
      table.teamId,
      table.projectId
    ),
  })
);

export type ProjectDataAccessRule = typeof projectDataAccessRules.$inferSelect;
export type InsertProjectDataAccessRule =
  typeof projectDataAccessRules.$inferInsert;

// ─── Data Source Connections（外部資料來源連接 / 創作加速層）─────────────────
// M4/M5：使用者 / 團隊連結的外部來源（cloud Drive、notes Notion，未來 mcp）。
// Drive 走既有 OAuth（encryptedCredentialRef = null）；Notion 用後端加密 token。
// credential 一律不進前端 / log / prompt。第一版只 read-only。
export const dataSourceConnections = mysqlTable(
  "data_source_connections",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("ownerUserId").notNull(),
    teamId: int("teamId"),
    projectId: int("projectId"),
    kind: mysqlEnum("kind", [
      "cloud",
      "notes",
      "mcp",
      "external_api",
    ]).notNull(),
    /** 供應商：google_drive / notion / ... */
    provider: varchar("provider", { length: 64 }).notNull(),
    authType: mysqlEnum("authType", ["oauth", "api_key", "none"])
      .default("api_key")
      .notNull(),
    /** 後端加密後的憑證；OAuth（如 Drive）為 null（憑證另存 userGoogleOauthTokens）。 */
    encryptedCredentialRef: text("encryptedCredentialRef"),
    /** 非敏感設定：Notion database/page ids、Drive folder ids 等。 */
    configJson: json("configJson"),
    status: mysqlEnum("status", ["pending", "active", "disabled", "error"])
      .default("pending")
      .notNull(),
    lastHealthCheckAt: timestamp("lastHealthCheckAt"),
    /** AIDV-68: API key / credential 到期時間（null = 永不到期）。 */
    expiresAt: timestamp("expiresAt"),
    /** AIDV-68: 最後一次發出到期警告的時間（防重複告警）。 */
    expireWarnedAt: timestamp("expireWarnedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerUserIdIdx: index("dsc_ownerUserId_idx").on(table.ownerUserId),
    teamIdIdx: index("dsc_teamId_idx").on(table.teamId),
    projectIdIdx: index("dsc_projectId_idx").on(table.projectId),
    ownerProviderIdx: index("dsc_ownerUserId_provider_idx").on(
      table.ownerUserId,
      table.provider
    ),
  })
);

export type DataSourceConnection = typeof dataSourceConnections.$inferSelect;
export type InsertDataSourceConnection =
  typeof dataSourceConnections.$inferInsert;

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

// ─── Teaching Materials（資料庫 — training-data feature）─────────────────────
// Stores uploaded source files (text / PDF / document / image / video / audio /
// presentation) with classification metadata. Text content (`textContent`) is
// populated by a later RAG ingestion pipeline (Phase 2: chunking + embeddings);
// Phase 1 keeps it nullable / not_applicable so authors can upload immediately.
export const teachingMaterials = mysqlTable(
  "teaching_materials",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /**
     * 若不為 null：素材歸屬於某個團隊；visibility=team_shared 時，該 team 的
     * memberships 全員可讀寫。為 null 時表示是上傳者個人的素材（即使設成
     * team_shared 也只有自己看得到 — UI 會在切到 team_shared 時強制要求選 team）。
     */
    teamId: int("teamId"),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),

    /** 媒體類型 — 決定前端如何渲染（播放器/縮圖/閱讀器） */
    mediaType: mysqlEnum("mediaType", [
      "text", // 純文字（textContent 為主，無檔案）
      "pdf", // PDF 文件
      "document", // Word / TXT / Markdown
      "image", // 圖片
      "video", // 影片
      "audio", // 語音、錄音
      "presentation", // PPT / PPTX
    ]).notNull(),

    // ── 檔案參照（純文字時皆可為 null）───────────────────────────────────
    fileUrl: text("fileUrl"),
    fileKey: text("fileKey"),
    fileName: varchar("fileName", { length: 255 }),
    mimeType: varchar("mimeType", { length: 128 }),
    fileSizeBytes: int("fileSizeBytes"),
    thumbnailUrl: text("thumbnailUrl"),
    /** 音檔/影片時長（秒） */
    durationSeconds: int("durationSeconds"),
    /** PDF / PPT 頁數 */
    pageCount: int("pageCount"),

    // ── 抽文 / 轉文字（Phase 2 RAG 用）────────────────────────────────────
    /**
     * OCR / 語音轉文字 / PDF 抽文的結果，給未來的向量檢索使用。
     * 用 MEDIUMTEXT（~16 MB）而不是 TEXT（64 KB）— 一個小時的逐字稿就會
     * 超過 64 KB；TEXT 會在 MySQL strict mode 下噴 Data too long。
     */
    textContent: mediumtext("textContent"),
    transcriptionStatus: mysqlEnum("transcriptionStatus", [
      "not_applicable",
      "pending",
      "processing",
      "completed",
      "failed",
    ])
      .default("not_applicable")
      .notNull(),

    // ── 分類軸 ───────────────────────────────────────────────────────────
    /** 自由分類字串（之前的 lineage 欄位 — 名稱保留避免動 schema） */
    lineage: varchar("lineage", { length: 128 }),
    /** 來源類型 */
    sourceType: mysqlEnum("sourceType", [
      "discourse",
      "group_practice",
      "class",
      "ceremony",
      "publication",
      "interview",
      "other",
    ])
      .default("discourse")
      .notNull(),
    /** 日期 */
    sourceDate: date("sourceDate"),
    /** 地點 */
    sourceLocation: varchar("sourceLocation", { length: 255 }),
    /** 主題 */
    topic: varchar("topic", { length: 128 }),
    /** 講者 */
    speaker: varchar("speaker", { length: 128 }),
    tags: json("tags").$type<string[]>(),

    /** 關聯的真實地球資訊條目 ID（用於深度連結） */
    realEarthRefs: json("realEarthRefs").$type<number[]>(),

    // ── 管理 ─────────────────────────────────────────────────────────────
    visibility: mysqlEnum("visibility", [
      "private",
      "team_shared",
      "public_disciples",
    ])
      .default("private")
      .notNull(),
    isFeatured: boolean("isFeatured").default(false).notNull(),
    sortOrder: int("sortOrder").default(0).notNull(),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("tm_userId_idx").on(table.userId),
    userIdMediaTypeIdx: index("tm_userId_mediaType_idx").on(
      table.userId,
      table.mediaType
    ),
    userIdSourceTypeIdx: index("tm_userId_sourceType_idx").on(
      table.userId,
      table.sourceType
    ),
    userIdLineageIdx: index("tm_userId_lineage_idx").on(
      table.userId,
      table.lineage
    ),
    userIdTopicIdx: index("tm_userId_topic_idx").on(table.userId, table.topic),
    userIdCreatedAtIdx: index("tm_userId_createdAt_idx").on(
      table.userId,
      table.createdAt
    ),
    // ── 0053 新增：團隊池與 visibility 過濾用 ────────────────────────────
    teamIdVisibilityIdx: index("tm_teamId_visibility_idx").on(
      table.teamId,
      table.visibility
    ),
    visibilityIdx: index("tm_visibility_idx").on(table.visibility),
    teamIdCreatedAtIdx: index("tm_teamId_createdAt_idx").on(
      table.teamId,
      table.createdAt
    ),
  })
);

export type TeachingMaterial = typeof teachingMaterials.$inferSelect;
export type InsertTeachingMaterial = typeof teachingMaterials.$inferInsert;

// ─── Teams（0053 新增）────────────────────────────────────────────────────

export const teams = mysqlTable(
  "teams",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    description: text("description"),
    /** 團隊建立者；轉移擁有權需另開 mutation，目前 hardcoded 建立者擁有。 */
    ownerId: int("ownerId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerIdIdx: index("teams_ownerId_idx").on(table.ownerId),
  })
);

export type Team = typeof teams.$inferSelect;
export type InsertTeam = typeof teams.$inferInsert;

export const teamMemberships = mysqlTable(
  "team_memberships",
  {
    id: int("id").autoincrement().primaryKey(),
    teamId: int("teamId").notNull(),
    userId: int("userId").notNull(),
    /**
     * owner — 建立者；唯一能轉移擁有權 / 解散團隊
     * admin — 可邀請 / 移除其他 member、可編輯團隊所有素材（含 public_disciples）
     * member — 可讀寫團隊的 team_shared 素材；對 public_disciples 素材唯讀
     */
    role: mysqlEnum("role", ["owner", "admin", "member"])
      .default("member")
      .notNull(),
    invitedBy: int("invitedBy"),
    joinedAt: timestamp("joinedAt").defaultNow().notNull(),
  },
  table => ({
    // 一個使用者在同一個 team 只能有一筆會員紀錄；application 層也會 guard，
    // DB 這層 UNIQUE 用來防 race condition（drizzle-kit push 也需要這個
    // 才會生成 UNIQUE KEY，而非普通 index）。
    teamUserUk: uniqueIndex("tm_teamId_userId_uk").on(
      table.teamId,
      table.userId
    ),
    userIdIdx: index("tm_userId_idx").on(table.userId),
    teamIdIdx: index("tm_teamId_idx").on(table.teamId),
  })
);

export type TeamMembership = typeof teamMemberships.$inferSelect;
export type InsertTeamMembership = typeof teamMemberships.$inferInsert;

// ─── Access audit log（0053 新增）─────────────────────────────────────────

export const teachingMaterialAccessLog = mysqlTable(
  "teaching_material_access_log",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    materialId: int("materialId").notNull(),
    userId: int("userId").notNull(),
    action: mysqlEnum("action", [
      "view",
      "download",
      "search_hit",
      "reingest",
      "update",
      "delete",
    ]).notNull(),
    /** 附加 context：search query、IP（之後加）、原本 visibility 等 */
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    materialIdCreatedAtIdx: index("tmal_materialId_createdAt_idx").on(
      table.materialId,
      table.createdAt
    ),
    userIdCreatedAtIdx: index("tmal_userId_createdAt_idx").on(
      table.userId,
      table.createdAt
    ),
    actionCreatedAtIdx: index("tmal_action_createdAt_idx").on(
      table.action,
      table.createdAt
    ),
  })
);

export type TeachingMaterialAccessLog =
  typeof teachingMaterialAccessLog.$inferSelect;
export type InsertTeachingMaterialAccessLog =
  typeof teachingMaterialAccessLog.$inferInsert;

// ─── Real Earth Information System（真實地球資訊系統）──────────────────────────
//
// 提供真實歷史、文化、人文、環境資料查驗，特別深化台灣相關資訊，
// 方便使用者研究與撰寫腳本。可被世界觀系統引用、AI 代理查詢。

export const realEarthEntries = mysqlTable(
  "real_earth_entries",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 條目標題 */
    title: varchar("title", { length: 500 }).notNull(),
    /** 資料類別 */
    category: mysqlEnum("category", [
      "history", "culture", "geography", "architecture", "language",
      "cuisine", "clothing", "art", "religion", "society",
      "economy", "politics", "military", "technology", "nature",
      "folklore", "education", "entertainment", "transportation", "people",
    ]).notNull(),
    /** 簡短描述（1-2 句話） */
    summary: text("summary").notNull(),
    /** 詳細內容（支援 markdown） */
    content: mediumtext("content").notNull(),

    /** 地理位置資訊（JSON） */
    locationJson: json("locationJson").$type<{
      region?: string;
      gpsCoords?: { lat: number; lon: number };
      address?: string;
    }>(),

    /** 歷史時期 */
    historicalPeriod: varchar("historicalPeriod", { length: 200 }),

    /** 年份範圍（JSON） */
    yearRangeJson: json("yearRangeJson").$type<{
      start?: number;
      end?: number;
    }>(),

    /** 參考圖片 URL 列表（JSON） */
    imageUrls: json("imageUrls").$type<string[]>(),

    /** 外部連結（JSON） */
    externalLinksJson: json("externalLinksJson").$type<Array<{
      label: string;
      url: string;
      type?: string;
    }>>(),

    /** 學術引用（JSON） */
    citationsJson: json("citationsJson").$type<Array<{
      author?: string;
      title: string;
      source: string;
      year?: number;
      url?: string;
    }>>(),

    /** 標籤 */
    tags: json("tags").$type<string[]>(),

    /** 相關條目 ID（JSON） */
    relatedEntryIds: json("relatedEntryIds").$type<string[]>(),

    /** 資料品質標記（JSON） */
    qualityJson: json("qualityJson").$type<{
      credibility: "low" | "medium" | "high" | "verified";
      sourceType?: string;
      lastVerified?: string;
    }>(),

    /** 是否為台灣重點資料 */
    isTaiwanFocused: boolean("isTaiwanFocused").default(false).notNull(),

    /** 資料語言 */
    language: varchar("language", { length: 10 }).default("zh-TW"),

    /** 額外後設資料（JSON） */
    metadata: json("metadata").$type<Record<string, any>>(),

    /** 建立者 ID（null = 系統預設資料） */
    createdBy: int("createdBy"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    // 類別索引 — 用於分類瀏覽
    categoryIdx: index("ree_category_idx").on(table.category),
    // 台灣重點資料索引 — 用於快速篩選台灣相關資料
    taiwanFocusedIdx: index("ree_taiwanFocused_idx").on(table.isTaiwanFocused),
    // 建立者索引 — 用於查詢使用者建立的資料
    createdByIdx: index("ree_createdBy_idx").on(table.createdBy),
    // 歷史時期索引 — 用於時期篩選
    historicalPeriodIdx: index("ree_historicalPeriod_idx").on(table.historicalPeriod),
    // 建立時間索引 — 用於排序與查詢
    createdAtIdx: index("ree_createdAt_idx").on(table.createdAt),
    // 全文搜索索引 — MySQL FULLTEXT for title and summary
    titleSummaryFulltext: index("ree_title_summary_fulltext").on(table.title, table.summary),
  })
);

export type RealEarthEntry = typeof realEarthEntries.$inferSelect;
export type InsertRealEarthEntry = typeof realEarthEntries.$inferInsert;

// ─── Global Audit Log（AIDV-123 全站操作稽核軌跡）──────────────────────────
//
// Append-only 稽核表：統一記錄全站「關鍵寫入」操作（登入、建立/修改/刪除
// 專案・資產・提示詞・教材、共享/撤銷、生成、連接器授權、成本操作）。
//
// 設計原則：
//   • Append-only / 不可竄改：只有 INSERT，沒有任何 update/delete 的 service
//     或 router 出口；一般使用者沒有任何寫/改本表的端點。
//   • Best-effort：寫入失敗（DB 掛、無 DATABASE_URL）絕不阻斷原操作。
//   • 高頻 log → bigint PK、無 updatedAt（稽核紀錄一旦寫下不再變動）。
//
// 仿 teaching_material_access_log（既有 access-audit-log）形狀 + login_history
// 的 actor/IP/device 欄位。
export const globalAuditLog = mysqlTable(
  "global_audit_log",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    /** 操作者（actor）user id；系統/匿名操作可為 null */
    actorUserId: int("actorUserId"),
    /** 操作者角色快照（admin/leader/user…），方便事後查驗權限脈絡 */
    actorRole: varchar("actorRole", { length: 50 }),
    /**
     * 動作語意。用 varchar 而非 enum：稽核動作會隨功能不斷新增，
     * varchar 讓「接新寫入點」是純加法、不需動 migration 改 enum。
     * 命名慣例：<domain>.<verb>，如 project.create / asset.share / auth.login。
     */
    action: varchar("action", { length: 100 }).notNull(),
    /** 目標物型別（project / asset / prompt / material / consent / user…） */
    targetType: varchar("targetType", { length: 50 }),
    /** 目標物 id（字串以相容 int / uuid / 複合 key） */
    targetId: varchar("targetId", { length: 100 }),
    /** 結果 */
    result: mysqlEnum("result", ["success", "failure"])
      .default("success")
      .notNull(),
    /** 來源 IP（IPv6-safe 長度） */
    ipAddress: varchar("ipAddress", { length: 45 }),
    /** 來源裝置 / User-Agent */
    userAgent: text("userAgent"),
    /** 附加 context（變更前後值、失敗原因、查詢字串等） */
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    // 依成員過濾 + 時間排序
    actorCreatedAtIdx: index("gal_actor_createdAt_idx").on(
      table.actorUserId,
      table.createdAt
    ),
    // 依動作過濾 + 時間排序
    actionCreatedAtIdx: index("gal_action_createdAt_idx").on(
      table.action,
      table.createdAt
    ),
    // 依目標物（專案/資產…）過濾 + 時間排序
    targetCreatedAtIdx: index("gal_target_createdAt_idx").on(
      table.targetType,
      table.targetId,
      table.createdAt
    ),
    // 純時間排序（全站時間軸瀏覽）
    createdAtIdx: index("gal_createdAt_idx").on(table.createdAt),
  })
);

export type GlobalAuditLog = typeof globalAuditLog.$inferSelect;
export type InsertGlobalAuditLog = typeof globalAuditLog.$inferInsert;

// ─── Resource Shares — 跨表「顯式共享」SSOT（AIDV-121 RBAC 基礎版）──────────
//
// 統一記錄「某個資源（專案 / 資產 / 提示詞 / 教材）被顯式共享給誰」的關係表。
// 不在每張資源表硬塞 teamId/sharedWith 欄位（那會碰到 digital_asset_library
// 的 team_shared 孤兒 enum、creative_projects 完全沒共享欄等不一致），而是用
// 一張泛型 junction 表把「擁有權之外的授權」集中表達。
//
//   resourceType    → "project" | "asset" | "prompt" | "material"
//   resourceId      → 對應資源的數字 id（int，本站資源主鍵皆 int）
//   sharedWithType  → "user"（分享給單一成員）| "team"（分享給整個團隊）
//   sharedWithId    → user id 或 team id
//   role            → "viewer"（唯讀）| "editor"（可讀寫，但不可刪/不可移轉）
//   sharedByUserId  → 建立此共享關係的人（通常是資源 owner）
//
// 設計刻意「純加法」：本表存在 ≠ 行為改變。canAccess() 只有在
// ENABLE_DATA_RBAC=ON 時才會去查這張表；旗標 OFF 時各 router 完全不碰它，
// 行為與現狀位元相同。
//
// 唯一鍵 (resourceType, resourceId, sharedWithType, sharedWithId) 確保同一個
// 對象對同一資源只有一筆共享記錄（重複 share 視為更新 role，而非新增）。
export const resourceShares = mysqlTable(
  "resource_shares",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 資源型別：project / asset / prompt / material */
    resourceType: mysqlEnum("resourceType", [
      "project",
      "asset",
      "prompt",
      "material",
    ]).notNull(),
    /** 資源 id（對應各資源表 int 主鍵） */
    resourceId: int("resourceId").notNull(),
    /** 共享對象型別：分享給單一 user 或整個 team */
    sharedWithType: mysqlEnum("sharedWithType", ["user", "team"]).notNull(),
    /** 共享對象 id（user id 或 team id） */
    sharedWithId: int("sharedWithId").notNull(),
    /** 授予的角色：viewer（唯讀）/ editor（可讀寫）。owner/delete/transfer 永遠只屬資源擁有者。 */
    role: mysqlEnum("role", ["viewer", "editor"]).default("viewer").notNull(),
    /** 建立此共享關係的人（稽核用，通常是資源 owner） */
    sharedByUserId: int("sharedByUserId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    // 同一對象對同一資源只一筆（重複 share = upsert role）
    resourceTargetUk: uniqueIndex("rs_resource_target_uk").on(
      table.resourceType,
      table.resourceId,
      table.sharedWithType,
      table.sharedWithId
    ),
    // 「列出某資源被分享給誰」
    resourceIdx: index("rs_resource_idx").on(
      table.resourceType,
      table.resourceId
    ),
    // 「列出某對象（user/team）能看到哪些資源」— canAccess 與清單過濾用
    targetIdx: index("rs_target_idx").on(
      table.sharedWithType,
      table.sharedWithId
    ),
  })
);

export type ResourceShare = typeof resourceShares.$inferSelect;
export type InsertResourceShare = typeof resourceShares.$inferInsert;

// ─── Learn Modules — 管理員後台建立的學習文件（AIDV-214）──────────────────────────
export const learnModules = mysqlTable(
  "learn_modules",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    category: varchar("category", { length: 32 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    summary: varchar("summary", { length: 500 }).notNull(),
    content: mediumtext("content").notNull(),
    tags: json("tags").$type<string[]>().notNull(),
    difficulty: mysqlEnum("difficulty", ["beginner", "intermediate", "advanced"])
      .notNull()
      .default("beginner"),
    readingMinutes: int("readingMinutes").notNull().default(5),
    featured: boolean("featured").notNull().default(false),
    authorName: varchar("authorName", { length: 100 }),
    externalUrl: varchar("externalUrl", { length: 500 }),
    attachments: json("attachments")
      .$type<Array<{ type: string; url: string; title?: string }>>()
      .notNull(),
    publishedAt: timestamp("publishedAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    featuredIdx: index("lm_featured_idx").on(table.featured),
  })
);

export type LearnModule = typeof learnModules.$inferSelect;
export type InsertLearnModule = typeof learnModules.$inferInsert;

// ─── Refresh Tokens (AIDV-230) ─────────────────────────────────────────────
// 追蹤已發放的 session JWT（以 SHA-256 hex hash 儲存，不存明文）。
// 配合 ENABLE_REFRESH_TOKEN_ROTATION=true 啟用 server-side revocation + rotation。
export const refreshTokens = mysqlTable(
  "refresh_tokens",
  {
    id: int("id").autoincrement().primaryKey(),
    /** SHA-256 hex digest of the raw JWT string */
    tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
    userId: int("userId").notNull(),
    status: mysqlEnum("status", ["active", "revoked"]).default("active").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    tokenHashUk: uniqueIndex("rt_tokenHash_unique").on(table.tokenHash),
    userStatusIdx: index("rt_userId_status_idx").on(table.userId, table.status),
    expiresAtIdx: index("rt_expiresAt_idx").on(table.expiresAt),
  })
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type InsertRefreshToken = typeof refreshTokens.$inferInsert;

// ─── User Workflows (AIDV-43) ──────────────────────────────────────────────
// 單表設計（D11 建議）：每位使用者只一筆，stepsJson 存整個工作流步驟陣列。
// 跨裝置持久化，不依附任何 spirit/agent。
export const userWorkflows = mysqlTable("user_workflows", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  stepsJson: json("stepsJson").$type<Array<{
    id: string;
    name: string;
    required: boolean;
    enabled: boolean;
    canvasMode?: string;
    pending?: boolean;
  }>>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserWorkflow = typeof userWorkflows.$inferSelect;
export type InsertUserWorkflow = typeof userWorkflows.$inferInsert;

// ─── Skill Registry (Wave S S-4 / AIDV-129) ────────────────────────────────

export const skillRegistry = mysqlTable(
  "skill_registry",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    skillId: varchar("skillId", { length: 128 }).notNull(),
    version: varchar("version", { length: 32 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    trust: mysqlEnum("trust", ["official", "reviewed", "community"])
      .notNull()
      .default("community"),
    grantedConnectors: json("grantedConnectors").$type<string[]>(),
    grantedMaterials: boolean("grantedMaterials").notNull().default(false),
    grantedCrossProject: boolean("grantedCrossProject").notNull().default(false),
    status: mysqlEnum("status", ["active", "disabled"]).notNull().default("active"),
    installedBy: int("installedBy"),
    source: varchar("source", { length: 512 }),
    manifestChecksum: varchar("manifestChecksum", { length: 64 }),
    needsReaudit: tinyint("needsReaudit").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    skillIdUnique: uniqueIndex("skill_registry_skillId_uk").on(table.skillId),
    trustIdx: index("skill_registry_trust_idx").on(table.trust),
    statusIdx: index("skill_registry_status_idx").on(table.status),
  })
);

export type SkillRegistryEntry = typeof skillRegistry.$inferSelect;
export type InsertSkillRegistryEntry = typeof skillRegistry.$inferInsert;

// ─── Video Projects (AIDV-252) ────────────────────────────────────────────────

/** AIDV-260: 影片輸出規格 — resolution/fps/codec 三欄收斂至單一 JSON 欄位。 */
export type VideoOutputSpec = {
  resolution: "720p" | "1080p" | "4K";
  fps: 24 | 30 | 60;
  codec: "h264" | "h265" | "vp9";
};

export const VIDEO_OUTPUT_SPEC_DEFAULT: VideoOutputSpec = {
  resolution: "1080p",
  fps: 30,
  codec: "h264",
};

export const videoProjects = mysqlTable(
  "video_projects",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    creativeProjectId: int("creativeProjectId"),
    title: varchar("title", { length: 255 }).notNull().default("未命名影片"),
    aspectRatio: mysqlEnum("aspect_ratio", ["16:9", "9:16", "1:1"])
      .notNull()
      .default("16:9"),
    outputSpec: json("output_spec").$type<VideoOutputSpec>(),
    // AIDV-270: 多模態輸入素材（image/audio + role）。null = 未提供（既有純文字生成不變）。
    inputAssets: json("input_assets").$type<VideoInputAsset[]>(),
    version: int("version").notNull().default(0),
    deadlineAt: timestamp("deadline_at"),
    priorityClass: mysqlEnum("priority_class", ["standard", "express", "critical"])
      .notNull()
      .default("standard"),
    // AIDV-684: 快取影片輸出位址，避免每次查 digital_asset_library
    outputStoragePath: text("output_storage_path"),
    outputSignedUrl: text("output_signed_url"),
    outputExpiresAt: timestamp("output_expires_at"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("vp_userId_idx").on(table.userId),
  })
);

export type VideoProject = typeof videoProjects.$inferSelect;
export type InsertVideoProject = typeof videoProjects.$inferInsert;

// ─── Project Snapshots (AIDV-253) ─────────────────────────────────────────────

export const projectSnapshots = mysqlTable(
  "project_snapshots",
  {
    id: int("id").autoincrement().primaryKey(),
    projectId: int("project_id").notNull(),
    snapshot: json("snapshot").notNull().$type<Record<string, unknown>>(),
    source: varchar("source", { length: 20 }).notNull().default("auto"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    projectCreatedIdx: index("ps_project_id_created_idx").on(table.projectId, table.createdAt),
  })
);

export type ProjectSnapshot = typeof projectSnapshots.$inferSelect;
export type InsertProjectSnapshot = typeof projectSnapshots.$inferInsert;

// ─── Webhook Subscriptions (AIDV-269) ────────────────────────────────────────

export const webhookSubscriptions = mysqlTable(
  "webhook_subscriptions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    url: varchar("url", { length: 2048 }).notNull(),
    events: json("events").$type<string[]>().notNull(),
    secret: varchar("secret", { length: 64 }).notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("ws_userId_idx").on(table.userId, table.active),
  })
);

export type WebhookSubscription = typeof webhookSubscriptions.$inferSelect;
export type InsertWebhookSubscription = typeof webhookSubscriptions.$inferInsert;

export const webhookDeliveryHistory = mysqlTable(
  "webhook_delivery_history",
  {
    id: int("id").autoincrement().primaryKey(),
    subscriptionId: int("subscriptionId").notNull(),
    event: varchar("event", { length: 64 }).notNull(),
    payload: json("payload").$type<Record<string, unknown>>().notNull(),
    statusCode: int("statusCode"),
    attempt: int("attempt").notNull().default(1),
    succeeded: boolean("succeeded").default(false).notNull(),
    errorMessage: varchar("errorMessage", { length: 512 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    subIdCreatedAtIdx: index("wdh_subId_createdAt_idx").on(table.subscriptionId, table.createdAt),
  })
);

export type WebhookDeliveryRecord = typeof webhookDeliveryHistory.$inferSelect;
export type InsertWebhookDeliveryRecord = typeof webhookDeliveryHistory.$inferInsert;

// ─── API Keys (AIDV-276) ────────────────────────────────────────────────────

export const apiKeys = mysqlTable(
  "api_keys",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
    scopes: json("scopes").$type<string[]>().notNull(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("ak_userId_idx").on(table.userId),
    keyHashIdx: uniqueIndex("ak_keyHash_idx").on(table.keyHash),
  })
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

// ─── Video Analytics (AIDV-272) ───────────────────────────────────────────────
// 影片播放事件追蹤表；匿名觀看者透過 visitorId（SHA-256 hash，無 PII），已登入
// 用戶透過 userId（可為 null 表示退出追蹤）。資料保留 90 天滾動視窗。

export const VIDEO_ANALYTICS_EVENT_TYPES = [
  "play",
  "pause",
  "pct25",
  "pct50",
  "pct75",
  "complete",
] as const;
export type VideoAnalyticsEventType = typeof VIDEO_ANALYTICS_EVENT_TYPES[number];

export const videoAnalytics = mysqlTable(
  "video_analytics",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    videoProjectId: int("video_project_id").notNull(),
    /** null ＝ 匿名訪客或用戶已退出追蹤（GDPR opt-out）*/
    userId: int("user_id"),
    /** 匿名訪客識別符（SHA-256 of sessionToken，無 IP/PII）；已登入時可為 null */
    visitorId: varchar("visitor_id", { length: 64 }),
    eventType: mysqlEnum("event_type", VIDEO_ANALYTICS_EVENT_TYPES).notNull(),
    /** 播放至事件發生時的累計秒數（0 = 不適用，如 pause 時 durationWatched=播放秒數） */
    durationWatched: int("duration_watched").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  table => ({
    videoProjectIdx: index("va_video_project_id_idx").on(table.videoProjectId),
    createdAtIdx: index("va_created_at_idx").on(table.createdAt),
  })
);

export type VideoAnalytic = typeof videoAnalytics.$inferSelect;
export type InsertVideoAnalytic = typeof videoAnalytics.$inferInsert;
