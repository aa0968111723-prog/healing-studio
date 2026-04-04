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
} from "drizzle-orm/mysql-core";

// ─── Users ─────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  /** Per-modality quota JSON */
  quotaJson: json("quotaJson").$type<{
    image: number;
    video: number;
    audio: number;
    voice: number;
  }>(),
  remainingGenerations: int("remainingGenerations").default(50).notNull(),
  onboardingDone: boolean("onboardingDone").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Background Jobs ─────────────────────────────────────────────────────
export const backgroundJobs = mysqlTable("background_jobs", {
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
});

export type BackgroundJob = typeof backgroundJobs.$inferSelect;
export type InsertBackgroundJob = typeof backgroundJobs.$inferInsert;

// ─── Digital Asset Library ───────────────────────────────────────────────
export const digitalAssetLibrary = mysqlTable("digital_asset_library", {
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
});

export type DigitalAsset = typeof digitalAssetLibrary.$inferSelect;
export type InsertDigitalAsset = typeof digitalAssetLibrary.$inferInsert;

// ─── Fine-Tuned Models ──────────────────────────────────────────────────
export const fineTunedModels = mysqlTable("fine_tuned_models", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  modelType: mysqlEnum("modelType", [
    "image_subject",
    "voice_clone",
    "style_lora",
  ]).notNull(),
  status: mysqlEnum("status", ["pending", "training", "ready", "failed"])
    .default("pending")
    .notNull(),
  fileUrl: text("fileUrl"),
  fileKey: text("fileKey"),
  configJson: json("configJson").$type<Record<string, unknown>>(),
  visibility: mysqlEnum("visibility", ["private", "team_shared"])
    .default("private")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FineTunedModel = typeof fineTunedModels.$inferSelect;
export type InsertFineTunedModel = typeof fineTunedModels.$inferInsert;

// ─── Project Notes & Calendar ────────────────────────────────────────────
export const projectNotesCalendar = mysqlTable("project_notes_calendar", {
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
});

export type ProjectNote = typeof projectNotesCalendar.$inferSelect;
export type InsertProjectNote = typeof projectNotesCalendar.$inferInsert;

// ─── User Feedback Reports ───────────────────────────────────────────────
export const userFeedbackReports = mysqlTable("user_feedback_reports", {
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
});

export type UserFeedback = typeof userFeedbackReports.$inferSelect;
export type InsertUserFeedback = typeof userFeedbackReports.$inferInsert;

// ─── API Usage Logs ──────────────────────────────────────────────────────
export const apiUsageLogs = mysqlTable("api_usage_logs", {
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
});

export type ApiUsageLog = typeof apiUsageLogs.$inferSelect;
export type InsertApiUsageLog = typeof apiUsageLogs.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════
// NEW TABLES — Phase 1 Foundation Repair
// ═══════════════════════════════════════════════════════════════════════════

// ─── Consistency Vault ───────────────────────────────────────────────────
export const consistencyVault = mysqlTable("consistency_vault", {
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
});

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
export const generationHistory = mysqlTable("generation_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  requestId: int("requestId"),
  modality: mysqlEnum("modality", ["image", "video", "audio", "voice"]).notNull(),
  prompt: text("prompt"),
  compiledPrompt: text("compiledPrompt"),
  parameterSnapshot: json("parameterSnapshot").$type<Record<string, unknown>>(),
  resultUrl: text("resultUrl"),
  thumbnailUrl: text("thumbnailUrl"),
  userRating: int("userRating"),
  isBookmarked: boolean("isBookmarked").default(false).notNull(),
  costCredits: int("costCredits").default(1).notNull(),
  durationMs: int("durationMs"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GenerationHistoryItem = typeof generationHistory.$inferSelect;
export type InsertGenerationHistoryItem =
  typeof generationHistory.$inferInsert;

// ─── Custom Blocks ─────────────────────────────────────────────────────
export const customBlocks = mysqlTable("custom_blocks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  modality: mysqlEnum("modality", ["image", "video", "audio", "voice"]).notNull(),
  category: varchar("category", { length: 64 }).notNull(),
  label: varchar("label", { length: 128 }).notNull(),
  prompt: varchar("prompt", { length: 512 }).notNull(),
  emoji: varchar("emoji", { length: 8 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CustomBlock = typeof customBlocks.$inferSelect;
export type InsertCustomBlock = typeof customBlocks.$inferInsert;

// ─── Block Combos (Saved Inspiration Presets) ───────────────────────────
export const blockCombos = mysqlTable("block_combos", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  modality: mysqlEnum("modality", ["image", "video", "audio", "voice"]).notNull(),
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
