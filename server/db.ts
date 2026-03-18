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
  consistencyVault, InsertConsistencyVaultItem,
  subscriptionPlans,
  aiDirectorPreferences, InsertAiDirectorPreference,
  generationHistory, InsertGenerationHistoryItem,
  customBlocks, InsertCustomBlock,
  blockCombos, InsertBlockCombo,
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
  await db.update(users)
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

export async function updateUserOnboarding(userId: number, done: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ onboardingDone: done }).where(eq(users.id, userId));
}

export async function updateUserQuotaJson(userId: number, quotaJson: { image: number; video: number; audio: number; voice: number }) {
  const db = await getDb();
  if (!db) return;
  const total = quotaJson.image + quotaJson.video + quotaJson.audio + quotaJson.voice;
  await db.update(users).set({ quotaJson, remainingGenerations: total }).where(eq(users.id, userId));
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

// ═══════════════════════════════════════════════════════════════════════════
// NEW — Phase 1 Foundation Repair
// ═══════════════════════════════════════════════════════════════════════════

// ─── Consistency Vault ───────────────────────────────────────────────────────

export async function createVaultItem(data: InsertConsistencyVaultItem) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(consistencyVault).values(data);
  return result[0].insertId;
}

export async function getVaultItemsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(consistencyVault).where(eq(consistencyVault.userId, userId)).orderBy(desc(consistencyVault.createdAt));
}

export async function getVaultItemsByType(userId: number, itemType: "character" | "scene") {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(consistencyVault)
    .where(and(eq(consistencyVault.userId, userId), eq(consistencyVault.itemType, itemType)))
    .orderBy(desc(consistencyVault.createdAt));
}

export async function updateVaultItem(id: number, data: Partial<InsertConsistencyVaultItem>) {
  const db = await getDb();
  if (!db) return;
  await db.update(consistencyVault).set(data).where(eq(consistencyVault.id, id));
}

export async function deleteVaultItem(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(consistencyVault).where(eq(consistencyVault.id, id));
}

// ─── Subscription Plans ──────────────────────────────────────────────────────

export async function getActivePlans() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(subscriptionPlans).where(eq(subscriptionPlans.isActive, true));
}

export async function getPlanById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, id)).limit(1);
  return result[0];
}

// ─── AI Director Preferences ────────────────────────────────────────────────

export async function getDirectorPreferences(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(aiDirectorPreferences).where(eq(aiDirectorPreferences.userId, userId)).limit(1);
  return result[0];
}

export async function upsertDirectorPreferences(userId: number, data: Partial<InsertAiDirectorPreference>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getDirectorPreferences(userId);
  if (existing) {
    await db.update(aiDirectorPreferences).set(data).where(eq(aiDirectorPreferences.userId, userId));
    return existing.id;
  } else {
    const result = await db.insert(aiDirectorPreferences).values({ userId, ...data });
    return result[0].insertId;
  }
}

// ─── Generation History ──────────────────────────────────────────────────────

export async function createHistoryEntry(data: InsertGenerationHistoryItem) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(generationHistory).values(data);
  return result[0].insertId;
}

export async function getHistoryByUser(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(generationHistory).where(eq(generationHistory.userId, userId)).orderBy(desc(generationHistory.createdAt)).limit(limit);
}

export async function getBookmarkedHistory(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(generationHistory)
    .where(and(eq(generationHistory.userId, userId), eq(generationHistory.isBookmarked, true)))
    .orderBy(desc(generationHistory.createdAt));
}

export async function updateHistoryEntry(id: number, data: Partial<InsertGenerationHistoryItem>) {
  const db = await getDb();
  if (!db) return;
  await db.update(generationHistory).set(data).where(eq(generationHistory.id, id));
}

export async function deleteHistoryEntry(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(generationHistory).where(eq(generationHistory.id, id));
}

// ─── Custom Blocks ─────────────────────────────────────────────────────────────

export async function createCustomBlock(data: InsertCustomBlock) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(customBlocks).values(data);
  return result[0].insertId;
}

export async function getCustomBlocksByUser(userId: number, modality?: string) {
  const db = await getDb();
  if (!db) return [];
  if (modality) {
    return db.select().from(customBlocks)
      .where(and(eq(customBlocks.userId, userId), eq(customBlocks.modality, modality as any)))
      .orderBy(desc(customBlocks.createdAt));
  }
  return db.select().from(customBlocks)
    .where(eq(customBlocks.userId, userId))
    .orderBy(desc(customBlocks.createdAt));
}

export async function deleteCustomBlock(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(customBlocks).where(and(eq(customBlocks.id, id), eq(customBlocks.userId, userId)));
}

// ─── Block Combos ─────────────────────────────────────────────────────────────

export async function createBlockCombo(data: InsertBlockCombo) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(blockCombos).values(data);
  return result[0].insertId;
}

export async function getBlockCombosByUser(userId: number, modality?: string) {
  const db = await getDb();
  if (!db) return [];
  if (modality) {
    return db.select().from(blockCombos)
      .where(and(eq(blockCombos.userId, userId), eq(blockCombos.modality, modality as any)))
      .orderBy(desc(blockCombos.updatedAt));
  }
  return db.select().from(blockCombos)
    .where(eq(blockCombos.userId, userId))
    .orderBy(desc(blockCombos.updatedAt));
}

export async function renameBlockCombo(id: number, userId: number, name: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(blockCombos).set({ name }).where(and(eq(blockCombos.id, id), eq(blockCombos.userId, userId)));
}

export async function deleteBlockCombo(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(blockCombos).where(and(eq(blockCombos.id, id), eq(blockCombos.userId, userId)));
}
