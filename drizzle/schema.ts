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
} from "drizzle-orm/mysql-core";

// ─── Users ─────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  emailVerified: boolean("emailVerified").default(false).notNull(),
  emailVerifiedAt: timestamp("emailVerifiedAt"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

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
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("agent_preferences_user_id_idx").on(table.userId),
  })
);

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
    scheduledDate: timestamp("scheduledDate"),
    tags: json("tags").$type<string[]>(),
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
  })
);

export type ProjectNote = typeof projectNotesCalendar.$inferSelect;
export type InsertProjectNote = typeof projectNotesCalendar.$inferInsert;

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
export const aiDirectorPreferences = mysqlTable("ai_director_preferences", {
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
});

export type AiDirectorPreference = typeof aiDirectorPreferences.$inferSelect;
export type InsertAiDirectorPreference =
  typeof aiDirectorPreferences.$inferInsert;

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
export const blockCombos = mysqlTable("block_combos", {
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
});

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
export const newsArticles = mysqlTable("news_articles", {
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
});

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
    .default("gpt-4o")
    .notNull(),
  directorTemperature: decimal("directorTemperature", {
    precision: 3,
    scale: 2,
  })
    .default("0.7")
    .notNull(),
  directorTopP: decimal("directorTopP", { precision: 3, scale: 2 })
    .default("0.9")
    .notNull(),
  directorSystemPrompt: text("directorSystemPrompt"),
  directorEnabled: boolean("directorEnabled").default(true).notNull(),

  /** 分析師大腦 — 數據分析、趨勢洞察、品質評估 */
  analystModel: varchar("analystModel", { length: 128 })
    .default("gpt-4o")
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
    .default("gpt-4o")
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
    .default("gpt-4o")
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
    .default("gpt-4o")
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

  /** 影片生成引擎 */
  videoEngine: varchar("videoEngine", { length: 128 })
    .default("fal-ai/kling-video/v2.1/pro/text-to-video")
    .notNull(),
  videoEngineParams: json("videoEngineParams").$type<{
    duration?: number;
    fps?: number;
    resolution?: string;
    motionStrength?: number;
    seed?: number | null;
  }>(),
  videoEngineEnabled: boolean("videoEngineEnabled").default(true).notNull(),

  /** 音樂/音效生成引擎 */
  audioEngine: varchar("audioEngine", { length: 128 })
    .default("fal-ai/stable-audio")
    .notNull(),
  audioEngineParams: json("audioEngineParams").$type<{
    duration?: number;
    genre?: string;
    tempo?: number;
    instrumental?: boolean;
  }>(),
  audioEngineEnabled: boolean("audioEngineEnabled").default(true).notNull(),

  /** 語音合成引擎 */
  voiceEngine: varchar("voiceEngine", { length: 128 })
    .default("fal-ai/metavoice-v1")
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
  /** 2-11 文字轉語音 */
  falTextToSpeechEngine: varchar("falTextToSpeechEngine", {
    length: 128,
  }).default("fal-ai/metavoice-v1"),
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
export const userModelSwitchLogs = mysqlTable("user_model_switch_logs", {
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
});

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
});

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
export const userSubscriptions = mysqlTable("user_subscriptions", {
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
});

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
