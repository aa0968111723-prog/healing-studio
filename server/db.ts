import { eq, desc, and, sql, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import {
  InsertUser,
  users,
  fineTunedModels,
  InsertFineTunedModel,
  digitalAssetLibrary,
  InsertDigitalAsset,
  projectNotesCalendar,
  InsertProjectNote,
  userFeedbackReports,
  InsertUserFeedback,
  apiUsageLogs,
  InsertApiUsageLog,
  backgroundJobs,
  InsertBackgroundJob,
  consistencyVault,
  InsertConsistencyVaultItem,
  subscriptionPlans,
  aiDirectorPreferences,
  InsertAiDirectorPreference,
  generationHistory,
  InsertGenerationHistoryItem,
  customBlocks,
  InsertCustomBlock,
  blockCombos,
  InsertBlockCombo,
  systemSettings,
  InsertSystemSetting,
  orbFeedbackEvents,
  InsertOrbFeedbackEvent,
  OrbFeedbackEvent,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

/**
 * 檢查 email 是否在管理員信箱清單中（ADMIN_EMAILS 環境變數，逗號分隔）
 */
/** Hard-coded super-admin email — always treated as admin regardless of ADMIN_EMAILS env var */
const SUPER_ADMIN_EMAILS = ["aa0968111723@gmail.com"];

let _adminEmailsCache: string[] | null = null;

function getAdminEmails(): string[] {
  if (_adminEmailsCache === null) {
    const raw = ENV.adminEmails;
    const fromEnv = raw
      ? raw
          .split(",")
          .map(e => e.trim().toLowerCase())
          .filter(Boolean)
      : [];
    // Merge hard-coded super-admins with env-configured admins (deduplicated)
    const merged = Array.from(
      new Set([...SUPER_ADMIN_EMAILS.map(e => e.toLowerCase()), ...fromEnv])
    );
    _adminEmailsCache = merged;
  }
  return _adminEmailsCache;
}

function isAdminEmail(email: string): boolean {
  return getAdminEmails().includes(email.toLowerCase());
}

let _db: ReturnType<typeof drizzle> | null = null;
let _migrationsDone = false;

/**
 * Runs any pending Drizzle migrations against the connected database.
 * Uses drizzle-orm/mysql2/migrator which tracks applied migrations in the
 * `__drizzle_migrations` table, so only unapplied entries from the journal
 * are executed. Safe to call on every startup.
 */
async function runMigrations(db: ReturnType<typeof drizzle>): Promise<void> {
  if (_migrationsDone) return;
  try {
    console.info("[Database] Checking for pending migrations…");
    await migrate(db, { migrationsFolder: "./drizzle" });
    _migrationsDone = true;
    console.info("[Database] Migrations applied successfully.");
  } catch (error) {
    console.error("[Database] Migration failed:", error);
    // Do not set _migrationsDone — allow a retry on the next getDb() call.
  }
}

export async function getDb() {
  if (_db) {
    if (!_migrationsDone) await runMigrations(_db);
    return _db;
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    if (process.env.NODE_ENV !== "test") {
      console.error(
        "[Database] Missing DATABASE_URL. Skipping mysql2 connection initialization."
      );
    }
    return null;
  }

  if (!_db) {
    try {
      // Use drizzle's built-in connection pooling with explicit pool configuration
      _db = drizzle({
        connection: {
          uri: databaseUrl,
          waitForConnections: true,
          connectionLimit: 10,
          maxIdle: 5,
          idleTimeout: 60_000, // Close idle connections after 60s
          enableKeepAlive: true,
          keepAliveInitialDelay: 30_000,
        },
      });
      await runMigrations(_db);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

/**
 * Gracefully close the database connection pool.
 * Call this during server shutdown to release all connections.
 */
export async function closeDb(): Promise<void> {
  if (_db) {
    try {
      // Access the underlying mysql2 pool via $client and end it
      const client = (_db as any).$client;
      if (client && typeof client.end === "function") {
        await client.end();
        console.info("[Database] Connection pool closed gracefully.");
      }
    } catch (error) {
      console.warn("[Database] Error closing connection pool:", error);
    } finally {
      _db = null;
    }
  }
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

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

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    } else if (user.email && isAdminEmail(user.email)) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0)
      updateSet.lastSignedIn = new Date();

    await db
      .insert(users)
      .values(values)
      .onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
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
  await db
    .update(users)
    .set({ remainingGenerations: amount })
    .where(eq(users.id, userId));
}

export async function updateUserAutoCreditPolicy(input: {
  userId: number;
  enabled: boolean;
  amount: number;
  intervalDays: number;
  nextAt?: Date | null;
}) {
  const db = await getDb();
  if (!db) return;

  const intervalDays = Math.max(1, Math.floor(input.intervalDays || 1));
  const now = Date.now();
  const defaultNextAt = new Date(now + intervalDays * 24 * 60 * 60 * 1000);
  const nextAt =
    input.enabled && input.amount > 0
      ? (input.nextAt ?? defaultNextAt)
      : null;

  await db
    .update(users)
    .set({
      autoCreditEnabled: input.enabled,
      autoCreditAmount: input.amount,
      autoCreditIntervalDays: intervalDays,
      autoCreditNextAt: nextAt,
      ...(input.enabled ? {} : { autoCreditLastAt: null }),
    })
    .where(eq(users.id, input.userId));
}

export async function runDueAutoCreditGrant(limit = 200): Promise<{
  processedUsers: number;
  totalGranted: number;
}> {
  const db = await getDb();
  if (!db) return { processedUsers: 0, totalGranted: 0 };

  return db.transaction(async tx => {
    const lockedRows = (await tx.execute(sql`
      SELECT id, autoCreditAmount, autoCreditIntervalDays, autoCreditNextAt
      FROM users
      WHERE autoCreditEnabled = 1
        AND autoCreditAmount > 0
        AND autoCreditNextAt IS NOT NULL
        AND autoCreditNextAt <= NOW()
      ORDER BY autoCreditNextAt ASC
      LIMIT ${limit}
      FOR UPDATE
    `)) as any[];

    const rows = Array.isArray(lockedRows?.[0]) ? lockedRows[0] : lockedRows;
    if (!rows?.length) return { processedUsers: 0, totalGranted: 0 };

    const now = Date.now();
    let processedUsers = 0;
    let totalGranted = 0;
    for (const row of rows) {
      const userId = Number(row.id);
      const amount = Math.max(0, Number(row.autoCreditAmount ?? 0));
      const intervalDays = Math.max(1, Number(row.autoCreditIntervalDays ?? 7));
      if (amount <= 0) continue;
      processedUsers += 1;

      const intervalMs = intervalDays * 24 * 60 * 60 * 1000;
      const lastScheduledTs = row.autoCreditNextAt
        ? new Date(row.autoCreditNextAt).getTime()
        : now;
      let nextTs = lastScheduledTs + intervalMs;
      while (nextTs <= now) {
        nextTs += intervalMs;
      }
      const nextAt = new Date(nextTs);

      await tx
        .update(users)
        .set({
          remainingGenerations: sql`${users.remainingGenerations} + ${amount}`,
          autoCreditLastAt: sql`NOW()`,
          autoCreditNextAt: nextAt,
        })
        .where(eq(users.id, userId));
      totalGranted += amount;
    }

    return { processedUsers, totalGranted };
  });
}

/**
 * Atomic quota deduction with pessimistic locking (SELECT ... FOR UPDATE).
 * Uses MySQL transaction + row-level lock to prevent race conditions.
 * Flow: BEGIN → SELECT FOR UPDATE → check quota → UPDATE → COMMIT
 * On failure: ROLLBACK automatically via Drizzle transaction wrapper.
 * Returns true only if quota was sufficient and deduction committed.
 */
export async function deductUserQuota(
  userId: number,
  amount: number = 1
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  try {
    const success = await db.transaction(async tx => {
      // Step 1: Pessimistic lock — SELECT ... FOR UPDATE
      const [lockedRow] = (await tx.execute(
        sql`SELECT ${users.id}, ${users.remainingGenerations} FROM ${users} WHERE ${users.id} = ${userId} FOR UPDATE`
      )) as any;
      const rows = Array.isArray(lockedRow) ? lockedRow : [lockedRow];
      const userRow = rows[0];

      if (!userRow) {
        console.warn(`[QuotaLock] User ${userId} not found during FOR UPDATE`);
        return false;
      }

      const currentQuota = Number(
        userRow.remainingGenerations ?? userRow.remaining_generations ?? 0
      );

      // Step 2: Check quota sufficiency
      if (currentQuota < amount) {
        console.warn(
          `[QuotaLock] User ${userId} insufficient quota: ${currentQuota} < ${amount}`
        );
        return false; // Transaction will rollback
      }

      // Step 3: Deduct within the same transaction (row is still locked)
      await tx
        .update(users)
        .set({
          remainingGenerations: sql`${users.remainingGenerations} - ${amount}`,
        })
        .where(eq(users.id, userId));

      console.log(
        `[QuotaLock] ✅ User ${userId} deducted ${amount} (${currentQuota} → ${currentQuota - amount})`
      );
      return true;
    });

    return success;
  } catch (error) {
    // Transaction automatically rolled back by Drizzle on throw
    console.error(
      `[QuotaLock] ❌ Transaction failed for user ${userId}:`,
      error
    );
    return false;
  }
}

/**
 * Refund quota with pessimistic lock to ensure consistency.
 * Uses transaction + FOR UPDATE to prevent concurrent refund anomalies.
 */
export async function refundUserQuota(userId: number, amount: number = 1) {
  const db = await getDb();
  if (!db) return;

  try {
    await db.transaction(async tx => {
      // Lock the row first
      await tx.execute(
        sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${userId} FOR UPDATE`
      );

      // Refund within locked transaction
      await tx
        .update(users)
        .set({
          remainingGenerations: sql`${users.remainingGenerations} + ${amount}`,
        })
        .where(eq(users.id, userId));

      console.log(`[QuotaLock] 🔄 User ${userId} refunded ${amount}`);
    });
  } catch (error) {
    console.error(
      `[QuotaLock] ❌ Refund transaction failed for user ${userId}:`,
      error
    );
  }
}

/**
 * Deduct points based on actual model cost (for model-based billing).
 * Falls back to deducting `amount` generation units if points system not used.
 *
 * The `pointsAmount` is the integer points to deduct (1 point = 1 generation unit base).
 * Since remainingGenerations already acts as "credits", we deduct pointsAmount units.
 * Minimum deduction is 1 (never deduct 0).
 *
 * Returns: { success, actualDeducted, remainingBefore, remainingAfter }
 */
export async function deductUserPoints(
  userId: number,
  pointsAmount: number
): Promise<{
  success: boolean;
  actualDeducted: number;
  remainingBefore: number;
  remainingAfter: number;
}> {
  const db = await getDb();
  if (!db)
    return {
      success: false,
      actualDeducted: 0,
      remainingBefore: 0,
      remainingAfter: 0,
    };

  // Minimum 1 point, maximum safety cap of 500
  const toDeduct = Math.max(1, Math.min(500, Math.round(pointsAmount)));

  try {
    const result = await db.transaction(async tx => {
      const [lockedRow] = (await tx.execute(
        sql`SELECT ${users.id}, ${users.remainingGenerations} FROM ${users} WHERE ${users.id} = ${userId} FOR UPDATE`
      )) as any;
      const rows = Array.isArray(lockedRow) ? lockedRow : [lockedRow];
      const userRow = rows[0];

      if (!userRow) {
        console.warn(`[PointsLock] User ${userId} not found during FOR UPDATE`);
        return {
          success: false,
          actualDeducted: 0,
          remainingBefore: 0,
          remainingAfter: 0,
        };
      }

      const currentCredits = Number(
        userRow.remainingGenerations ?? userRow.remaining_generations ?? 0
      );

      if (currentCredits < toDeduct) {
        console.warn(
          `[PointsLock] User ${userId} insufficient credits: ${currentCredits} < ${toDeduct}`
        );
        return {
          success: false,
          actualDeducted: 0,
          remainingBefore: currentCredits,
          remainingAfter: currentCredits,
        };
      }

      await tx
        .update(users)
        .set({
          remainingGenerations: sql`${users.remainingGenerations} - ${toDeduct}`,
        })
        .where(eq(users.id, userId));

      console.log(
        `[PointsLock] ✅ User ${userId} deducted ${toDeduct} pts (${currentCredits} → ${currentCredits - toDeduct})`
      );
      return {
        success: true,
        actualDeducted: toDeduct,
        remainingBefore: currentCredits,
        remainingAfter: currentCredits - toDeduct,
      };
    });
    return result;
  } catch (error) {
    console.error(
      `[PointsLock] ❌ Points deduction failed for user ${userId}:`,
      error
    );
    return {
      success: false,
      actualDeducted: 0,
      remainingBefore: 0,
      remainingAfter: 0,
    };
  }
}

/**
 * Refund points (reverse of deductUserPoints).
 */
export async function refundUserPoints(userId: number, pointsAmount: number) {
  const db = await getDb();
  if (!db) return;
  const toRefund = Math.max(1, Math.min(500, Math.round(pointsAmount)));
  try {
    await db.transaction(async tx => {
      await tx.execute(
        sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${userId} FOR UPDATE`
      );
      await tx
        .update(users)
        .set({
          remainingGenerations: sql`${users.remainingGenerations} + ${toRefund}`,
        })
        .where(eq(users.id, userId));
      console.log(`[PointsLock] 🔄 User ${userId} refunded ${toRefund} pts`);
    });
  } catch (error) {
    console.error(
      `[PointsLock] ❌ Points refund failed for user ${userId}:`,
      error
    );
  }
}

export async function updateUserOnboarding(userId: number, done: boolean) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(users)
    .set({ onboardingDone: done })
    .where(eq(users.id, userId));
}

export async function updateUserQuotaJson(
  userId: number,
  quotaJson: { image: number; video: number; audio: number; voice: number }
) {
  const db = await getDb();
  if (!db) return;
  const total =
    quotaJson.image + quotaJson.video + quotaJson.audio + quotaJson.voice;
  await db
    .update(users)
    .set({ quotaJson, remainingGenerations: total })
    .where(eq(users.id, userId));
}

// ─── Fine-Tuned Models ──────────────────────────────────────────────────────

export async function createFineTunedModel(data: InsertFineTunedModel) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(fineTunedModels).values(data);
  return result[0].insertId;
}

export async function getFineTunedModel(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(fineTunedModels)
    .where(eq(fineTunedModels.id, id))
    .limit(1);
  return rows[0] || null;
}

export async function getFineTunedModelsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(fineTunedModels)
    .where(eq(fineTunedModels.userId, userId))
    .orderBy(desc(fineTunedModels.createdAt));
}

export async function getTeamSharedModels() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(fineTunedModels)
    .where(eq(fineTunedModels.visibility, "team_shared"))
    .orderBy(desc(fineTunedModels.createdAt));
}

export async function updateFineTunedModel(
  id: number,
  data: Partial<InsertFineTunedModel>
) {
  const db = await getDb();
  if (!db) return;
  await db.update(fineTunedModels).set(data).where(eq(fineTunedModels.id, id));
}

export async function deleteFineTunedModel(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(fineTunedModels).where(eq(fineTunedModels.id, id));
}

/** 增加模型使用計數 */
export async function incrementModelUsage(id: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(fineTunedModels)
    .set({ usageCount: sql`${fineTunedModels.usageCount} + 1` })
    .where(eq(fineTunedModels.id, id));
}

/** 取得特定模型的訓練任務歷史 */
export async function getTrainingJobsByModelId(modelId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.jobType, "model_training"),
        sql`JSON_EXTRACT(${backgroundJobs.resultJson}, '$.modelId') = ${modelId}`
      )
    )
    .orderBy(desc(backgroundJobs.createdAt))
    .limit(20);
  return rows;
}

// ─── Digital Asset Library ───────────────────────────────────────────────────

export async function createDigitalAsset(data: InsertDigitalAsset) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(digitalAssetLibrary).values(data);
  return result[0].insertId;
}

export async function getDigitalAsset(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(digitalAssetLibrary)
    .where(eq(digitalAssetLibrary.id, id))
    .limit(1);
  return rows[0] || null;
}

export async function getDigitalAssetsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(digitalAssetLibrary)
    .where(eq(digitalAssetLibrary.userId, userId))
    .orderBy(desc(digitalAssetLibrary.createdAt));
}

export async function getTeamSharedAssets() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(digitalAssetLibrary)
    .where(eq(digitalAssetLibrary.visibility, "team_shared"))
    .orderBy(desc(digitalAssetLibrary.createdAt));
}

export async function updateDigitalAsset(
  id: number,
  data: Partial<InsertDigitalAsset>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(digitalAssetLibrary)
    .set(data)
    .where(eq(digitalAssetLibrary.id, id));
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

export async function getProjectNote(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(projectNotesCalendar)
    .where(eq(projectNotesCalendar.id, id))
    .limit(1);
  return rows[0] || null;
}

export async function getProjectNotesByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projectNotesCalendar)
    .where(eq(projectNotesCalendar.userId, userId))
    .orderBy(desc(projectNotesCalendar.createdAt));
}

export async function updateProjectNote(
  id: number,
  data: Partial<InsertProjectNote>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(projectNotesCalendar)
    .set(data)
    .where(eq(projectNotesCalendar.id, id));
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
  return db
    .select()
    .from(userFeedbackReports)
    .where(eq(userFeedbackReports.userId, userId))
    .orderBy(desc(userFeedbackReports.createdAt));
}

export async function getAllFeedbacks() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(userFeedbackReports)
    .orderBy(desc(userFeedbackReports.createdAt));
}

export async function updateFeedbackStatus(
  id: number,
  status: "open" | "in_progress" | "resolved" | "closed"
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(userFeedbackReports)
    .set({ status })
    .where(eq(userFeedbackReports.id, id));
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
  return db
    .select()
    .from(apiUsageLogs)
    .where(eq(apiUsageLogs.userId, userId))
    .orderBy(desc(apiUsageLogs.createdAt))
    .limit(limit);
}

export async function getAllUsageLogs(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(apiUsageLogs)
    .orderBy(desc(apiUsageLogs.createdAt))
    .limit(limit);
}

export async function getUserCostSummary(userId: number) {
  const db = await getDb();
  if (!db) return { totalCost: 0, totalRequests: 0 };
  const result = await db
    .select({
      totalCost: sql<string>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
      totalRequests: sql<number>`COUNT(*)`,
    })
    .from(apiUsageLogs)
    .where(eq(apiUsageLogs.userId, userId));
  return {
    totalCost: parseFloat(result[0]?.totalCost || "0"),
    totalRequests: result[0]?.totalRequests || 0,
  };
}

/** 按模態分類的生成次數統計（用於 Dashboard 圓餅圖） */
export async function getUserModalityBreakdown(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      requestType: apiUsageLogs.requestType,
      count: sql<number>`COUNT(*)`,
      totalCost: sql<string>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
    })
    .from(apiUsageLogs)
    .where(eq(apiUsageLogs.userId, userId))
    .groupBy(apiUsageLogs.requestType);
}

/** 近 7 天每日請求數量趨勢（用於 Dashboard 折線圖） */
export async function getUserDailyTrend(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      date: sql<string>`DATE(${apiUsageLogs.createdAt})`,
      count: sql<number>`COUNT(*)`,
      totalCost: sql<string>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
      totalTokens: sql<number>`COALESCE(SUM(${apiUsageLogs.tokensUsed}), 0)`,
    })
    .from(apiUsageLogs)
    .where(
      and(
        eq(apiUsageLogs.userId, userId),
        sql`${apiUsageLogs.createdAt} >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
      )
    )
    .groupBy(sql`DATE(${apiUsageLogs.createdAt})`)
    .orderBy(sql`DATE(${apiUsageLogs.createdAt})`);
}

export async function getTeamCostSummary() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      userId: apiUsageLogs.userId,
      totalCost: sql<string>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
      totalRequests: sql<number>`COUNT(*)`,
      totalTokens: sql<number>`COALESCE(SUM(${apiUsageLogs.tokensUsed}), 0)`,
    })
    .from(apiUsageLogs)
    .groupBy(apiUsageLogs.userId);
}

// ─── Background Jobs ─────────────────────────────────────────────────────────

export async function createBackgroundJob(data: InsertBackgroundJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(backgroundJobs).values(data);
  return result[0].insertId;
}

export async function updateBackgroundJob(
  id: number,
  data: Partial<InsertBackgroundJob>
) {
  const db = await getDb();
  if (!db) return;
  await db.update(backgroundJobs).set(data).where(eq(backgroundJobs.id, id));
}

export async function getBackgroundJob(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.id, id))
    .limit(1);
  return result[0];
}

export async function getJobsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.userId, userId))
    .orderBy(desc(backgroundJobs.createdAt))
    .limit(20);
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

export async function getVaultItem(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(consistencyVault)
    .where(eq(consistencyVault.id, id))
    .limit(1);
  return rows[0] || null;
}

export async function getVaultItemsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(consistencyVault)
    .where(eq(consistencyVault.userId, userId))
    .orderBy(desc(consistencyVault.createdAt));
}

export async function getVaultItemsByType(
  userId: number,
  itemType: "character" | "scene"
) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(consistencyVault)
    .where(
      and(
        eq(consistencyVault.userId, userId),
        eq(consistencyVault.itemType, itemType)
      )
    )
    .orderBy(desc(consistencyVault.createdAt));
}

export async function updateVaultItem(
  id: number,
  data: Partial<InsertConsistencyVaultItem>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(consistencyVault)
    .set(data)
    .where(eq(consistencyVault.id, id));
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
  return db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.isActive, true));
}

export async function getPlanById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, id))
    .limit(1);
  return result[0];
}

// ─── AI Director Preferences ────────────────────────────────────────────────

export async function getDirectorPreferences(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(aiDirectorPreferences)
    .where(eq(aiDirectorPreferences.userId, userId))
    .limit(1);
  return result[0];
}

export async function upsertDirectorPreferences(
  userId: number,
  data: Partial<InsertAiDirectorPreference>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getDirectorPreferences(userId);
  if (existing) {
    await db
      .update(aiDirectorPreferences)
      .set(data)
      .where(eq(aiDirectorPreferences.userId, userId));
    return existing.id;
  } else {
    const result = await db
      .insert(aiDirectorPreferences)
      .values({ userId, ...data });
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
  return db
    .select()
    .from(generationHistory)
    .where(eq(generationHistory.userId, userId))
    .orderBy(desc(generationHistory.createdAt))
    .limit(limit);
}

export async function getBookmarkedHistory(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(generationHistory)
    .where(
      and(
        eq(generationHistory.userId, userId),
        eq(generationHistory.isBookmarked, true)
      )
    )
    .orderBy(desc(generationHistory.createdAt));
}

export async function updateHistoryEntry(
  id: number,
  data: Partial<InsertGenerationHistoryItem>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(generationHistory)
    .set(data)
    .where(eq(generationHistory.id, id));
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
    return db
      .select()
      .from(customBlocks)
      .where(
        and(
          eq(customBlocks.userId, userId),
          eq(customBlocks.modality, modality as any)
        )
      )
      .orderBy(desc(customBlocks.createdAt));
  }
  return db
    .select()
    .from(customBlocks)
    .where(eq(customBlocks.userId, userId))
    .orderBy(desc(customBlocks.createdAt));
}

export async function deleteCustomBlock(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(customBlocks)
    .where(and(eq(customBlocks.id, id), eq(customBlocks.userId, userId)));
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
    return db
      .select()
      .from(blockCombos)
      .where(
        and(
          eq(blockCombos.userId, userId),
          eq(blockCombos.modality, modality as any)
        )
      )
      .orderBy(desc(blockCombos.updatedAt));
  }
  return db
    .select()
    .from(blockCombos)
    .where(eq(blockCombos.userId, userId))
    .orderBy(desc(blockCombos.updatedAt));
}

export async function renameBlockCombo(
  id: number,
  userId: number,
  name: string
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(blockCombos)
    .set({ name })
    .where(and(eq(blockCombos.id, id), eq(blockCombos.userId, userId)));
}

export async function deleteBlockCombo(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(blockCombos)
    .where(and(eq(blockCombos.id, id), eq(blockCombos.userId, userId)));
}

// ─── System Settings ────────────────────────────────────────────────────────

export async function getSystemSettings(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.userId, userId))
    .limit(1);
  return result[0];
}

export async function upsertSystemSettings(
  userId: number,
  data: Partial<InsertSystemSetting>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getSystemSettings(userId);
  if (existing) {
    await db
      .update(systemSettings)
      .set(data)
      .where(eq(systemSettings.userId, userId));
    return existing.id;
  } else {
    const result = await db.insert(systemSettings).values({ userId, ...data });
    return result[0].insertId;
  }
}

// ─── Background Jobs — Worker Queries ────────────────────────────────────────

/**
 * 查詢指定 jobType 且狀態為 queued 的任務列表
 */
export async function getQueuedJobsByType(jobType: string, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.jobType, jobType as any),
        eq(backgroundJobs.status, "queued")
      )
    )
    .orderBy(backgroundJobs.createdAt)
    .limit(limit);
}

/**
 * 查詢指定 jobType 且狀態為 processing 且更新時間超過指定分鐘數的任務（可能卡住）
 */
export async function getStuckJobsByType(
  jobType: string,
  stuckAfterMinutes = 15,
  limit = 5
) {
  const db = await getDb();
  if (!db) return [];
  const cutoff = new Date(Date.now() - stuckAfterMinutes * 60 * 1000);
  return db
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.jobType, jobType as any),
        eq(backgroundJobs.status, "processing"),
        sql`${backgroundJobs.updatedAt} < ${cutoff}`
      )
    )
    .orderBy(backgroundJobs.createdAt)
    .limit(limit);
}

// ─── Admin: Extended Queries ────────────────────────────────────────────────

/** Admin: Update a user's role (protects super-admin emails from demotion) */
export async function updateUserRole(userId: number, role: "user" | "admin") {
  const db = await getDb();
  if (!db) return;
  // Prevent demoting super-admin accounts
  if (role !== "admin") {
    const [target] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (target?.email && isAdminEmail(target.email)) {
      throw new Error("無法變更超級管理員的角色");
    }
  }
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

/** Admin: Get system-wide statistics overview */
export async function getSystemStats() {
  const db = await getDb();
  if (!db)
    return {
      totalUsers: 0,
      totalGenerations: 0,
      totalApiCalls: 0,
      totalCost: "0",
      totalJobs: 0,
      activeJobs: 0,
      failedJobs: 0,
      totalAssets: 0,
      totalFeedbacks: 0,
    };

  const [
    [userCount],
    [genCount],
    [apiStats],
    [jobStats],
    [assetCount],
    [feedbackCount],
  ] = await Promise.all([
    db.select({ count: sql<number>`COUNT(*)` }).from(users),
    db.select({ count: sql<number>`COUNT(*)` }).from(generationHistory),
    db
      .select({
        count: sql<number>`COUNT(*)`,
        totalCost: sql<string>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
      })
      .from(apiUsageLogs),
    db
      .select({
        total: sql<number>`COUNT(*)`,
        active: sql<number>`SUM(CASE WHEN ${backgroundJobs.status} IN ('queued', 'processing') THEN 1 ELSE 0 END)`,
        failed: sql<number>`SUM(CASE WHEN ${backgroundJobs.status} = 'failed' THEN 1 ELSE 0 END)`,
      })
      .from(backgroundJobs),
    db.select({ count: sql<number>`COUNT(*)` }).from(digitalAssetLibrary),
    db.select({ count: sql<number>`COUNT(*)` }).from(userFeedbackReports),
  ]);

  return {
    totalUsers: userCount?.count ?? 0,
    totalGenerations: genCount?.count ?? 0,
    totalApiCalls: apiStats?.count ?? 0,
    totalCost: apiStats?.totalCost ?? "0",
    totalJobs: jobStats?.total ?? 0,
    activeJobs: jobStats?.active ?? 0,
    failedJobs: jobStats?.failed ?? 0,
    totalAssets: assetCount?.count ?? 0,
    totalFeedbacks: feedbackCount?.count ?? 0,
  };
}

/** Admin: Get all generation history across all users */
export async function getAllGenerationHistory(limit = 200) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(generationHistory)
    .orderBy(desc(generationHistory.createdAt))
    .limit(limit);
}

/** Admin: Get per-user activity summary (recent usage, generation count, last active) */
export async function getUserActivitySummary() {
  const db = await getDb();
  if (!db) return [];

  return db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      remainingGenerations: users.remainingGenerations,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
      totalApiCalls: sql<number>`COALESCE((SELECT COUNT(*) FROM api_usage_logs WHERE api_usage_logs.userId = ${users.id}), 0)`,
      totalCost: sql<string>`COALESCE((SELECT SUM(estimatedCostUsd) FROM api_usage_logs WHERE api_usage_logs.userId = ${users.id}), 0)`,
      totalGenerations: sql<number>`COALESCE((SELECT COUNT(*) FROM generation_history WHERE generation_history.userId = ${users.id}), 0)`,
      totalAssets: sql<number>`COALESCE((SELECT COUNT(*) FROM digital_asset_library WHERE digital_asset_library.userId = ${users.id}), 0)`,
    })
    .from(users)
    .orderBy(desc(users.lastSignedIn));
}

/** Admin: Get API usage breakdown by provider */
export async function getApiProviderBreakdown() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      apiProvider: apiUsageLogs.apiProvider,
      requestType: apiUsageLogs.requestType,
      totalCalls: sql<number>`COUNT(*)`,
      totalCost: sql<string>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
      totalTokens: sql<number>`COALESCE(SUM(${apiUsageLogs.tokensUsed}), 0)`,
      successCount: sql<number>`SUM(CASE WHEN ${apiUsageLogs.responseStatus} = 'success' THEN 1 ELSE 0 END)`,
      failedCount: sql<number>`SUM(CASE WHEN ${apiUsageLogs.responseStatus} = 'failed' THEN 1 ELSE 0 END)`,
    })
    .from(apiUsageLogs)
    .groupBy(apiUsageLogs.apiProvider, apiUsageLogs.requestType);
}

/** Admin: Get daily system-wide usage trend (last 30 days) */
export async function getSystemDailyTrend(days = 30) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      date: sql<string>`DATE(${apiUsageLogs.createdAt})`,
      totalCalls: sql<number>`COUNT(*)`,
      totalCost: sql<string>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
      totalTokens: sql<number>`COALESCE(SUM(${apiUsageLogs.tokensUsed}), 0)`,
      uniqueUsers: sql<number>`COUNT(DISTINCT ${apiUsageLogs.userId})`,
    })
    .from(apiUsageLogs)
    .where(
      sql`${apiUsageLogs.createdAt} >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`
    )
    .groupBy(sql`DATE(${apiUsageLogs.createdAt})`)
    .orderBy(sql`DATE(${apiUsageLogs.createdAt})`);
}

/** Admin: Get all background jobs (for monitoring) */
export async function getAllBackgroundJobs(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(backgroundJobs)
    .orderBy(desc(backgroundJobs.createdAt))
    .limit(limit);
}

// ─── Orb Feedback Events（Phase 3c 長期記憶）────────────────────────────────

/** 寫入一筆光球回饋事件；DB 不在時回 null（上層忽略即可） */
export async function appendOrbFeedback(data: InsertOrbFeedbackEvent) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(orbFeedbackEvents).values(data);
  return result[0].insertId;
}

/** 取最近 N 筆（預設 20），依 createdAt 由新到舊 */
export async function getRecentOrbFeedback(
  userId: number,
  limit = 20
): Promise<OrbFeedbackEvent[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(orbFeedbackEvents)
    .where(eq(orbFeedbackEvents.userId, userId))
    .orderBy(desc(orbFeedbackEvents.createdAt))
    .limit(Math.max(1, Math.min(50, limit)));
}

/** 刪除單筆光球記憶事件（僅限事件擁有者） */
export async function deleteOrbFeedbackEvent(userId: number, eventId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db
    .delete(orbFeedbackEvents)
    .where(
      and(eq(orbFeedbackEvents.userId, userId), eq(orbFeedbackEvents.id, eventId))
    );
  return Number(result[0].affectedRows ?? 0);
}

/** 依條件批次刪除光球記憶（支援 pageId/actionType/beforeAt 過濾） */
export async function clearOrbFeedbackEvents(
  userId: number,
  filters?: {
    pageId?: string;
    actionType?: string;
    beforeAt?: Date;
  }
) {
  const db = await getDb();
  if (!db) return 0;
  const conditions = [eq(orbFeedbackEvents.userId, userId)];
  if (filters?.pageId) conditions.push(eq(orbFeedbackEvents.pageId, filters.pageId));
  if (filters?.actionType) {
    conditions.push(eq(orbFeedbackEvents.actionType, filters.actionType));
  }
  if (filters?.beforeAt) conditions.push(lt(orbFeedbackEvents.createdAt, filters.beforeAt));
  const result = await db.delete(orbFeedbackEvents).where(and(...conditions));
  return Number(result[0].affectedRows ?? 0);
}
