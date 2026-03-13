import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json, decimal } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extended with remaining_generations quota for the Healing Studio.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  remainingGenerations: int("remainingGenerations").default(50).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Fine-tuned models uploaded by users (subject images for Vertex AI, voice clones, etc.)
 */
export const fineTunedModels = mysqlTable("fine_tuned_models", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  modelType: mysqlEnum("modelType", ["image_subject", "voice_clone", "style_lora"]).notNull(),
  status: mysqlEnum("status", ["pending", "training", "ready", "failed"]).default("pending").notNull(),
  fileUrl: text("fileUrl"),
  fileKey: text("fileKey"),
  configJson: json("configJson"),
  visibility: mysqlEnum("visibility", ["private", "team_shared"]).default("private").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FineTunedModel = typeof fineTunedModels.$inferSelect;
export type InsertFineTunedModel = typeof fineTunedModels.$inferInsert;

/**
 * Digital asset library for generated/uploaded assets
 */
export const digitalAssetLibrary = mysqlTable("digital_asset_library", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  assetType: mysqlEnum("assetType", ["image", "video", "audio", "voice", "script", "zip_bundle"]).notNull(),
  fileUrl: text("fileUrl"),
  fileKey: text("fileKey"),
  thumbnailUrl: text("thumbnailUrl"),
  mimeType: varchar("mimeType", { length: 128 }),
  fileSizeBytes: int("fileSizeBytes"),
  promptUsed: text("promptUsed"),
  isPublicRecycled: boolean("isPublicRecycled").default(false).notNull(),
  visibility: mysqlEnum("visibility", ["private", "team_shared"]).default("private").notNull(),
  rewardCredits: int("rewardCredits").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DigitalAsset = typeof digitalAssetLibrary.$inferSelect;
export type InsertDigitalAsset = typeof digitalAssetLibrary.$inferInsert;

/**
 * Project notes and calendar for script planning
 */
export const projectNotesCalendar = mysqlTable("project_notes_calendar", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content"),
  scriptJson: json("scriptJson"),
  noteType: mysqlEnum("noteType", ["note", "script", "calendar_event"]).default("note").notNull(),
  scheduledDate: timestamp("scheduledDate"),
  tags: json("tags"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProjectNote = typeof projectNotesCalendar.$inferSelect;
export type InsertProjectNote = typeof projectNotesCalendar.$inferInsert;

/**
 * User feedback reports
 */
export const userFeedbackReports = mysqlTable("user_feedback_reports", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  category: mysqlEnum("category", ["bug", "feature_request", "quality_issue", "general"]).default("general").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: mysqlEnum("status", ["open", "in_progress", "resolved", "closed"]).default("open").notNull(),
  priority: mysqlEnum("priority", ["low", "medium", "high", "critical"]).default("medium").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserFeedback = typeof userFeedbackReports.$inferSelect;
export type InsertUserFeedback = typeof userFeedbackReports.$inferInsert;

/**
 * API usage logs for cost tracking
 */
export const apiUsageLogs = mysqlTable("api_usage_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  requestType: mysqlEnum("requestType", [
    "image_generation", "video_generation", "audio_generation",
    "voice_dubbing", "prompt_expansion", "safety_check", "director_ai"
  ]).notNull(),
  apiProvider: varchar("apiProvider", { length: 64 }).notNull(),
  tokensUsed: int("tokensUsed").default(0),
  videoSeconds: int("videoSeconds").default(0),
  audioCharacters: int("audioCharacters").default(0),
  sunoCredits: int("sunoCredits").default(0),
  estimatedCostUsd: decimal("estimatedCostUsd", { precision: 10, scale: 6 }).default("0"),
  requestPayload: json("requestPayload"),
  responseStatus: mysqlEnum("responseStatus", ["success", "failed", "timeout", "blocked"]).default("success").notNull(),
  errorMessage: text("errorMessage"),
  generationsDeducted: int("generationsDeducted").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ApiUsageLog = typeof apiUsageLogs.$inferSelect;
export type InsertApiUsageLog = typeof apiUsageLogs.$inferInsert;

/**
 * Background job queue tracking (for SSE progress)
 */
export const backgroundJobs = mysqlTable("background_jobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  jobType: mysqlEnum("jobType", ["image", "video", "audio", "voice", "zip_export", "multimodal"]).notNull(),
  status: mysqlEnum("status", ["queued", "processing", "completed", "failed", "cancelled"]).default("queued").notNull(),
  progress: int("progress").default(0).notNull(),
  progressMessage: text("progressMessage"),
  resultJson: json("resultJson"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BackgroundJob = typeof backgroundJobs.$inferSelect;
export type InsertBackgroundJob = typeof backgroundJobs.$inferInsert;
