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
