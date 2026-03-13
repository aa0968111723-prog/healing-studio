import { eq, desc, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser, users,
  fineTunedModels, InsertFineTunedModel,
  digitalAssetLibrary, InsertDigitalAsset,
  projectNotesCalendar, InsertProjectNote,
  userFeedbackReports, InsertUserFeedback,
  apiUsageLogs, InsertApiUsageLog,
  backgroundJobs, InsertBackgroundJob,
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }

    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(desc(users.createdAt));
}

export async function updateUserQuota(userId: number, amount: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ remainingGenerations: amount }).where(eq(users.id, userId));
}

export async function deductUserQuota(userId: number, amount: number = 1) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.update(users)
    .set({ remainingGenerations: sql`GREATEST(${users.remainingGenerations} - ${amount}, 0)` })
    .where(and(eq(users.id, userId), sql`${users.remainingGenerations} >= ${amount}`));
  return true;
}

export async function refundUserQuota(userId: number, amount: number = 1) {
  const db = await getDb();
  if (!db) return;
  await db.update(users)
    .set({ remainingGenerations: sql`${users.remainingGenerations} + ${amount}` })
    .where(eq(users.id, userId));
}

// ─── Fine-Tuned Models ──────────────────────────────────────────────────────

export async function createFineTunedModel(data: InsertFineTunedModel) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(fineTunedModels).values(data);
  return result[0].insertId;
}

export async function getFineTunedModelsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(fineTunedModels).where(eq(fineTunedModels.userId, userId)).orderBy(desc(fineTunedModels.createdAt));
}

export async function getTeamSharedModels() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(fineTunedModels).where(eq(fineTunedModels.visibility, "team_shared")).orderBy(desc(fineTunedModels.createdAt));
}

export async function updateFineTunedModel(id: number, data: Partial<InsertFineTunedModel>) {
  const db = await getDb();
  if (!db) return;
  await db.update(fineTunedModels).set(data).where(eq(fineTunedModels.id, id));
}

export async function deleteFineTunedModel(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(fineTunedModels).where(eq(fineTunedModels.id, id));
}

// ─── Digital Asset Library ───────────────────────────────────────────────────

export async function createDigitalAsset(data: InsertDigitalAsset) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(digitalAssetLibrary).values(data);
  return result[0].insertId;
}

export async function getDigitalAssetsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(digitalAssetLibrary).where(eq(digitalAssetLibrary.userId, userId)).orderBy(desc(digitalAssetLibrary.createdAt));
}

export async function getTeamSharedAssets() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(digitalAssetLibrary).where(eq(digitalAssetLibrary.visibility, "team_shared")).orderBy(desc(digitalAssetLibrary.createdAt));
}

export async function updateDigitalAsset(id: number, data: Partial<InsertDigitalAsset>) {
  const db = await getDb();
  if (!db) return;
  await db.update(digitalAssetLibrary).set(data).where(eq(digitalAssetLibrary.id, id));
}

export async function deleteDigitalAsset(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(digitalAssetLibrary).where(eq(digitalAssetLibrary.id, id));
}

// ─── Project Notes Calendar ─────────────────────────────────────────────────

export async function createProjectNote(data: InsertProjectNote) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectNotesCalendar).values(data);
  return result[0].insertId;
}

export async function getProjectNotesByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projectNotesCalendar).where(eq(projectNotesCalendar.userId, userId)).orderBy(desc(projectNotesCalendar.createdAt));
}

export async function updateProjectNote(id: number, data: Partial<InsertProjectNote>) {
  const db = await getDb();
  if (!db) return;
  await db.update(projectNotesCalendar).set(data).where(eq(projectNotesCalendar.id, id));
}

export async function deleteProjectNote(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectNotesCalendar).where(eq(projectNotesCalendar.id, id));
}

// ─── User Feedback Reports ───────────────────────────────────────────────────

export async function createFeedbackReport(data: InsertUserFeedback) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(userFeedbackReports).values(data);
  return result[0].insertId;
}

export async function getFeedbacksByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(userFeedbackReports).where(eq(userFeedbackReports.userId, userId)).orderBy(desc(userFeedbackReports.createdAt));
}

export async function getAllFeedbacks() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(userFeedbackReports).orderBy(desc(userFeedbackReports.createdAt));
}

export async function updateFeedbackStatus(id: number, status: "open" | "in_progress" | "resolved" | "closed") {
  const db = await getDb();
  if (!db) return;
  await db.update(userFeedbackReports).set({ status }).where(eq(userFeedbackReports.id, id));
}

// ─── API Usage Logs ──────────────────────────────────────────────────────────

export async function createApiUsageLog(data: InsertApiUsageLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(apiUsageLogs).values(data);
  return result[0].insertId;
}

export async function getUsageLogsByUser(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(apiUsageLogs).where(eq(apiUsageLogs.userId, userId)).orderBy(desc(apiUsageLogs.createdAt)).limit(limit);
}

export async function getAllUsageLogs(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(apiUsageLogs).orderBy(desc(apiUsageLogs.createdAt)).limit(limit);
}

export async function getUserCostSummary(userId: number) {
  const db = await getDb();
  if (!db) return { totalCost: 0, totalRequests: 0 };
  const result = await db.select({
    totalCost: sql<string>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
    totalRequests: sql<number>`COUNT(*)`,
  }).from(apiUsageLogs).where(eq(apiUsageLogs.userId, userId));
  return { totalCost: parseFloat(result[0]?.totalCost || "0"), totalRequests: result[0]?.totalRequests || 0 };
}

export async function getTeamCostSummary() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    userId: apiUsageLogs.userId,
    totalCost: sql<string>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
    totalRequests: sql<number>`COUNT(*)`,
    totalTokens: sql<number>`COALESCE(SUM(${apiUsageLogs.tokensUsed}), 0)`,
  }).from(apiUsageLogs).groupBy(apiUsageLogs.userId);
}

// ─── Background Jobs ─────────────────────────────────────────────────────────

export async function createBackgroundJob(data: InsertBackgroundJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(backgroundJobs).values(data);
  return result[0].insertId;
}

export async function updateBackgroundJob(id: number, data: Partial<InsertBackgroundJob>) {
  const db = await getDb();
  if (!db) return;
  await db.update(backgroundJobs).set(data).where(eq(backgroundJobs.id, id));
}

export async function getBackgroundJob(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, id)).limit(1);
  return result[0];
}

export async function getJobsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(backgroundJobs).where(eq(backgroundJobs.userId, userId)).orderBy(desc(backgroundJobs.createdAt)).limit(20);
}
