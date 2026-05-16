import { eq, desc, and, sql, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import fs from "fs";
import path from "path";
import {
  InsertUser,
  users,
  fineTunedModels,
  InsertFineTunedModel,
  digitalAssetLibrary,
  InsertDigitalAsset,
  projectNotesCalendar,
  InsertProjectNote,
  userGoogleOauthTokens,
  type UserGoogleOauthToken,
  driveAssetLibraries,
  type DriveAssetLibrary,
  type InsertDriveAssetLibrary,
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
  studioRecipes,
  InsertStudioRecipe,
  studioVersions,
  InsertStudioVersion,
  systemSettings,
  InsertSystemSetting,
  orbFeedbackEvents,
  InsertOrbFeedbackEvent,
  OrbFeedbackEvent,
  modelTrainingConsents,
  InsertModelTrainingConsent,
  fineTunedModelConsents,
  InsertFineTunedModelConsent,
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
let _migrationsInFlight: Promise<void> | null = null;
let _migrationsLastFailedAt = 0;
// Backoff after a failed migration so per-request retries don't spam logs
// or hammer the DB. Resolved successfully on the next successful run.
const MIGRATION_RETRY_COOLDOWN_MS = 30_000;

/**
 * Warn at boot when a numbered SQL file exists in `drizzle/` but is not
 * registered in `_journal.json`. The avatar PR (commit 6e08723) appended
 * 0028's journal entry while skipping 0024–0027, so the underlying tables
 * (`specialized_agent_interactions`, `agent_collaboration_*`, plus
 * `orb_scheduled_jobs.lastResult`) never got created in production and
 * every chat request logged `specialist_*_failed`. Surface that mismatch
 * loudly so the next time someone forgets a journal entry it's caught
 * immediately instead of after deploy.
 *
 * This is best-effort: if reading the journal fails we just log and
 * continue, never block startup.
 */
function logOrphanedMigrationFiles(): void {
  try {
    const dir = path.join(process.cwd(), "drizzle");
    const journalPath = path.join(dir, "meta", "_journal.json");
    if (!fs.existsSync(journalPath)) return;
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
      entries?: Array<{ tag?: string }>;
    };
    const registered = new Set(
      (journal.entries ?? [])
        .map(entry => entry.tag)
        .filter((tag): tag is string => typeof tag === "string")
    );
    const sqlFiles = fs
      .readdirSync(dir)
      .filter(name => /^\d{4}_.+\.sql$/.test(name))
      .map(name => name.replace(/\.sql$/, ""));
    const orphans = sqlFiles.filter(tag => !registered.has(tag));
    if (orphans.length > 0) {
      console.warn(
        "[Database] orphaned migration SQL files (not registered in drizzle/meta/_journal.json — drizzle migrate will skip them):",
        orphans.join(", ")
      );
    }
  } catch (error) {
    console.warn(
      "[Database] failed to scan for orphaned migration files:",
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Internal: applies pending migrations against an already-connected db.
 * Uses a singleton in-flight promise so concurrent callers wait for the
 * same run rather than triggering multiple simultaneous migrations.
 * Does NOT call getDb() — avoids circular dependency.
 */
async function applyMigrations(db: ReturnType<typeof drizzle>): Promise<void> {
  if (_migrationsDone) return;
  // Concurrent caller: wait for the in-progress run instead of starting another.
  if (_migrationsInFlight) {
    await _migrationsInFlight;
    return;
  }
  // After a failure, suppress retries for a short cooldown window so a broken
  // migration does not produce a flood of identical errors on every request.
  if (
    _migrationsLastFailedAt > 0 &&
    Date.now() - _migrationsLastFailedAt < MIGRATION_RETRY_COOLDOWN_MS
  ) {
    return;
  }
  // Assign synchronously so any concurrent caller entering this function
  // after the first await sees _migrationsInFlight as set.
  _migrationsInFlight = (async () => {
    try {
      console.info("[Database] Checking for pending migrations…");
      logOrphanedMigrationFiles();
      // Absolute path so the folder resolves correctly regardless of cwd.
      await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
      _migrationsDone = true;
      _migrationsLastFailedAt = 0;
      console.info("[Database] Migrations applied successfully.");
    } catch (error) {
      _migrationsLastFailedAt = Date.now();
      console.error("[Database] Migration failed:", error);
      // Leave _migrationsDone false so the next startup attempt will retry.
    } finally {
      _migrationsInFlight = null;
    }
  })();
  await _migrationsInFlight;
}

export async function getDb() {
  if (_db) {
    // Retry migrations if a previous attempt failed (e.g. transient DB error).
    if (!_migrationsDone) await applyMigrations(_db);
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
          connectionLimit: 20,
          maxIdle: 10,
          idleTimeout: 60_000, // Close idle connections after 60s
          enableKeepAlive: true,
          keepAliveInitialDelay: 30_000,
        },
      });
      await applyMigrations(_db);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

/**
 * Runs pending Drizzle migrations eagerly.
 * Call this at server startup before accepting requests so that tables like
 * `login_history` exist even when the first request hits a route that uses
 * DatabaseManager (raw mysql2) rather than getDb().
 */
export async function runMigrations(): Promise<void> {
  // Trigger getDb() which initialises the connection and calls applyMigrations.
  await getDb();
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

// ─── Pool stats & health ──────────────────────────────────────────────────────

export interface DrizzlePoolStats {
  active: number;
  idle: number;
  queued: number;
  total: number;
}

/**
 * Return live connection pool statistics from the underlying mysql2 pool
 * that Drizzle manages internally. Returns null when the pool is not yet
 * initialised (e.g. DATABASE_URL is missing).
 */
export function getDrizzlePoolStats(): DrizzlePoolStats | null {
  if (!_db) return null;
  const pool = (_db as any).$client as any;
  if (!pool) return null;
  const total: number = pool._allConnections?.length ?? 0;
  const idle: number = pool._freeConnections?.length ?? 0;
  const queued: number = pool._connectionQueue?.length ?? 0;
  const active = Math.max(0, total - idle);
  return { active, idle, queued, total };
}

/**
 * Run a lightweight `SELECT 1` health check against the Drizzle pool.
 * Returns true when the database is reachable, false otherwise.
 */
export async function checkDrizzleHealth(): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
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
    // Explicitly exclude id from values — it's auto-increment and must never appear in INSERT.
    // openId has already been validated to be non-empty above, so the cast is safe.
    const { id: _id, ...userWithoutId } = user as InsertUser & { id?: number };
    const values: Omit<InsertUser, "id"> & { openId: string } = {
      openId: user.openId as string,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = userWithoutId[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);

    if (userWithoutId.lastSignedIn !== undefined) {
      values.lastSignedIn = userWithoutId.lastSignedIn;
      updateSet.lastSignedIn = userWithoutId.lastSignedIn;
    }
    if (userWithoutId.role !== undefined) {
      values.role = userWithoutId.role;
      updateSet.role = userWithoutId.role;
    } else if (userWithoutId.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    } else if (userWithoutId.email && isAdminEmail(userWithoutId.email)) {
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

export async function updateUserAvatar(
  userId: number,
  avatarUrl: string | null
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(users)
    .set({ avatarUrl })
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
  // configJson is stored as a single JSON column; SQL UPDATE replaces it
  // wholesale. Merge with the existing config so partial patches from the
  // training pipeline (e.g. predictionId, completedAt) don't wipe out
  // fields written at create time (datasetImages, batchSize, isStyle, …).
  let payload = data;
  if (data.configJson !== undefined && data.configJson !== null) {
    const rows = await db
      .select({ configJson: fineTunedModels.configJson })
      .from(fineTunedModels)
      .where(eq(fineTunedModels.id, id))
      .limit(1);
    const existing = (rows[0]?.configJson ?? {}) as Record<string, unknown>;
    payload = {
      ...data,
      configJson: {
        ...existing,
        ...(data.configJson as Record<string, unknown>),
      },
    } as Partial<InsertFineTunedModel>;
  }
  await db.update(fineTunedModels).set(payload).where(eq(fineTunedModels.id, id));
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

// ─── Model Training Consents ────────────────────────────────────────────────

export async function createModelTrainingConsent(
  data: InsertModelTrainingConsent
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(modelTrainingConsents).values(data);
  return result[0].insertId;
}

export async function getModelTrainingConsent(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(modelTrainingConsents)
    .where(eq(modelTrainingConsents.id, id))
    .limit(1);
  return rows[0] || null;
}

export async function getModelTrainingConsentsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(modelTrainingConsents)
    .where(eq(modelTrainingConsents.userId, userId))
    .orderBy(desc(modelTrainingConsents.createdAt));
}

export async function revokeModelTrainingConsent(
  id: number,
  reason: string | null
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(modelTrainingConsents)
    .set({ revokedAt: new Date(), revokeReason: reason ?? null })
    .where(eq(modelTrainingConsents.id, id));
}

/**
 * Whether a consent is currently usable for a new training job:
 * not revoked, validFrom in the past, validUntil null or in the future.
 */
export function isConsentActive(c: {
  revokedAt: Date | null;
  validFrom: Date;
  validUntil: Date | null;
}): boolean {
  if (c.revokedAt) return false;
  const now = Date.now();
  if (c.validFrom.getTime() > now) return false;
  if (c.validUntil && c.validUntil.getTime() < now) return false;
  return true;
}

export async function linkConsentsToModel(
  modelId: number,
  consentIds: number[]
): Promise<void> {
  if (consentIds.length === 0) return;
  const db = await getDb();
  if (!db) return;
  const rows: InsertFineTunedModelConsent[] = consentIds.map(consentId => ({
    modelId,
    consentId,
  }));
  await db.insert(fineTunedModelConsents).values(rows);
}

export async function getConsentsForModel(modelId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      consent: modelTrainingConsents,
    })
    .from(fineTunedModelConsents)
    .innerJoin(
      modelTrainingConsents,
      eq(fineTunedModelConsents.consentId, modelTrainingConsents.id)
    )
    .where(eq(fineTunedModelConsents.modelId, modelId));
  return rows.map(r => r.consent);
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

export async function getCalendarEventsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projectNotesCalendar)
    .where(
      and(
        eq(projectNotesCalendar.userId, userId),
        eq(projectNotesCalendar.noteType, "calendar_event")
      )
    )
    .orderBy(projectNotesCalendar.scheduledDate);
}

export async function getUserIcsFeedToken(userId: number): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ token: users.icsFeedToken })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.token ?? null;
}

export async function setUserIcsFeedToken(userId: number, token: string | null) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ icsFeedToken: token }).where(eq(users.id, userId));
}

export async function getUserByIcsFeedToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.icsFeedToken, token))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Google OAuth Tokens (incremental scopes) ──────────────────────────────

export async function getGoogleOauthToken(
  userId: number,
  purpose: string
): Promise<UserGoogleOauthToken | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(userGoogleOauthTokens)
    .where(
      and(
        eq(userGoogleOauthTokens.userId, userId),
        eq(userGoogleOauthTokens.purpose, purpose)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertGoogleOauthToken(token: {
  userId: number;
  purpose: string;
  accessToken: string;
  refreshToken?: string | null;
  scope: string;
  tokenType?: string;
  expiresAt?: Date | null;
}) {
  const db = await getDb();
  if (!db) return;
  const existing = await getGoogleOauthToken(token.userId, token.purpose);
  if (existing) {
    await db
      .update(userGoogleOauthTokens)
      .set({
        accessToken: token.accessToken,
        // Only overwrite refreshToken when Google actually issued a new one;
        // re-auth without `prompt=consent` typically omits it.
        ...(token.refreshToken
          ? { refreshToken: token.refreshToken }
          : {}),
        scope: token.scope,
        tokenType: token.tokenType ?? "Bearer",
        expiresAt: token.expiresAt ?? null,
      })
      .where(eq(userGoogleOauthTokens.id, existing.id));
    return existing.id;
  }
  const result = await db.insert(userGoogleOauthTokens).values({
    userId: token.userId,
    purpose: token.purpose,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? null,
    scope: token.scope,
    tokenType: token.tokenType ?? "Bearer",
    expiresAt: token.expiresAt ?? null,
  });
  return result[0].insertId;
}

export async function deleteGoogleOauthToken(userId: number, purpose: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(userGoogleOauthTokens)
    .where(
      and(
        eq(userGoogleOauthTokens.userId, userId),
        eq(userGoogleOauthTokens.purpose, purpose)
      )
    );
}

// ─── Drive Asset Libraries ─────────────────────────────────────────────────

export async function getDriveLibrariesByUser(
  userId: number
): Promise<DriveAssetLibrary[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(driveAssetLibraries)
    .where(eq(driveAssetLibraries.userId, userId))
    .orderBy(desc(driveAssetLibraries.createdAt));
}

export async function createDriveLibrary(data: InsertDriveAssetLibrary) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(driveAssetLibraries).values(data);
  return result[0].insertId;
}

export async function deleteDriveLibrary(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(driveAssetLibraries)
    .where(
      and(eq(driveAssetLibraries.id, id), eq(driveAssetLibraries.userId, userId))
    );
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

export async function getUserCostSummary(
  userId: number,
  args?: { days?: number }
) {
  const db = await getDb();
  if (!db) return { totalCost: 0, totalRequests: 0, totalCreditsConsumed: 0 };
  // days = undefined → all-time (existing dashboard / admin behaviour).
  // days >= 1 → trailing window. 財財 (accountant) passes 30 here so its
  // "近 30 天用量" summary actually reflects 30 days instead of all-time.
  const days =
    typeof args?.days === "number" && Number.isFinite(args.days)
      ? Math.max(1, Math.min(90, Math.trunc(args.days)))
      : undefined;
  const whereClause = days
    ? and(
        eq(apiUsageLogs.userId, userId),
        sql`${apiUsageLogs.createdAt} >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`
      )
    : eq(apiUsageLogs.userId, userId);
  const result = await db
    .select({
      totalCost: sql<string>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
      totalRequests: sql<number>`COUNT(*)`,
      totalCreditsConsumed: sql<number>`COALESCE(SUM(${apiUsageLogs.generationsDeducted}), 0)`,
    })
    .from(apiUsageLogs)
    .where(whereClause);
  return {
    totalCost: parseFloat(result[0]?.totalCost || "0"),
    totalRequests: result[0]?.totalRequests || 0,
    totalCreditsConsumed: Number(result[0]?.totalCreditsConsumed || 0),
  };
}

/** 按模態分類的生成次數統計（用於 Dashboard 圓餅圖、財財近 30 天摘要） */
export async function getUserModalityBreakdown(
  userId: number,
  args?: { days?: number }
) {
  const db = await getDb();
  if (!db) return [];
  const days =
    typeof args?.days === "number" && Number.isFinite(args.days)
      ? Math.max(1, Math.min(90, Math.trunc(args.days)))
      : undefined;
  const whereClause = days
    ? and(
        eq(apiUsageLogs.userId, userId),
        sql`${apiUsageLogs.createdAt} >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`
      )
    : eq(apiUsageLogs.userId, userId);
  return db
    .select({
      requestType: apiUsageLogs.requestType,
      count: sql<number>`COUNT(*)`,
      totalCost: sql<string>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
    })
    .from(apiUsageLogs)
    .where(whereClause)
    .groupBy(apiUsageLogs.requestType);
}

/** 按 API 提供商分類的成本/次數統計（用於 Dashboard AI 洞察） */
export async function getUserProviderBreakdown(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      apiProvider: apiUsageLogs.apiProvider,
      count: sql<number>`COUNT(*)`,
      totalCost: sql<string>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
      successCount: sql<number>`SUM(CASE WHEN ${apiUsageLogs.responseStatus} = 'success' THEN 1 ELSE 0 END)`,
      failedCount: sql<number>`SUM(CASE WHEN ${apiUsageLogs.responseStatus} = 'failed' THEN 1 ELSE 0 END)`,
    })
    .from(apiUsageLogs)
    .where(eq(apiUsageLogs.userId, userId))
    .groupBy(apiUsageLogs.apiProvider);
}

/**
 * 近 N 天每日請求數量趨勢（用於 Dashboard 折線圖 / 財財月底預測）。
 *
 * days 預設 7（既有 Dashboard caller 行為不變）；clamp 到 1..90 避免
 * 誤傳大數爆 query。注意 rows 只包含「有記錄的天」— 沒跑任務的日期會被
 * SQL 的 GROUP BY 過濾掉，呼叫者要算日均時請除以 days 參數而非 rows.length。
 */
export async function getUserDailyTrend(userId: number, opts?: { days?: number }) {
  const db = await getDb();
  if (!db) return [];
  const days = Math.max(1, Math.min(90, Math.trunc(opts?.days ?? 7)));
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
        sql`${apiUsageLogs.createdAt} >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(days))} DAY)`
      )
    )
    .groupBy(sql`DATE(${apiUsageLogs.createdAt})`)
    .orderBy(sql`DATE(${apiUsageLogs.createdAt})`);
}

/**
 * 取得使用者「過去 N 天每日成本」明細 — 給 accountant 算 burn rate 與
 * 簡單異常偵測用。和 getUserDailyTrend (7 天固定) 的差別是允許 1-90 天範圍。
 */
export async function getUserDailyTrendRange(
  userId: number,
  args?: { days?: number }
) {
  const db = await getDb();
  if (!db) return [];
  const days = Math.max(1, Math.min(90, Math.trunc(args?.days ?? 14)));
  return db
    .select({
      date: sql<string>`DATE(${apiUsageLogs.createdAt})`,
      count: sql<number>`COUNT(*)`,
      totalCost: sql<string>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
    })
    .from(apiUsageLogs)
    .where(
      and(
        eq(apiUsageLogs.userId, userId),
        sql`${apiUsageLogs.createdAt} >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`
      )
    )
    .groupBy(sql`DATE(${apiUsageLogs.createdAt})`)
    .orderBy(sql`DATE(${apiUsageLogs.createdAt})`);
}

/**
 * 取 accountant 算預算 / 自動加值狀況需要的欄位 — 不回傳整個 user row
 * （省記憶體 + 避免外洩 passwordHash / 2FA secret）。任何欄位查不到都
 * 回 null，由 caller 決定要不要 fallback 文案。
 */
export async function getUserAccountInfo(userId: number): Promise<{
  remainingGenerations: number;
  quotaJson: { image: number; video: number; audio: number; voice: number } | null;
  autoCreditEnabled: boolean;
  autoCreditAmount: number;
  autoCreditIntervalDays: number;
  autoCreditNextAt: Date | null;
} | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({
      remainingGenerations: users.remainingGenerations,
      quotaJson: users.quotaJson,
      autoCreditEnabled: users.autoCreditEnabled,
      autoCreditAmount: users.autoCreditAmount,
      autoCreditIntervalDays: users.autoCreditIntervalDays,
      autoCreditNextAt: users.autoCreditNextAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    remainingGenerations: Number(row.remainingGenerations ?? 0),
    quotaJson: row.quotaJson ?? null,
    autoCreditEnabled: !!row.autoCreditEnabled,
    autoCreditAmount: Number(row.autoCreditAmount ?? 0),
    autoCreditIntervalDays: Number(row.autoCreditIntervalDays ?? 0),
    autoCreditNextAt: row.autoCreditNextAt ?? null,
  };
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

/**
 * 透過 fal.ai request_id 反查 processing 中的 backgroundJob。
 * 用於 webhookFal：當 webhook URL 沒帶 ?jobId 時，從 payload.request_id
 * 反查 resultJson.requestId 對應的 job（imageStudio/proStudio 等先送 fal、
 * 後由前端 submitStudioJob 建立 backgroundJob 的流程適用）。
 *
 * 注意：MySQL JSON_EXTRACT 帶引號回傳；用 JSON_UNQUOTE 剝掉。
 */
export async function findProcessingJobByRequestId(requestId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.status, "processing"),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${backgroundJobs.resultJson}, '$.requestId')) = ${requestId}`
      )
    )
    .orderBy(desc(backgroundJobs.createdAt))
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

// ─── Studio Recipes (RecipeLibraryPanel) ───────────────────────────────────
// Backs trpc.studio.recipes.* — see server/routers.ts. Studio.tsx used to
// keep these in component state only, so refresh erased the user's library.

export async function listStudioRecipes(
  userId: number,
  modality?: "image" | "video" | "music" | "voice"
) {
  const db = await getDb();
  if (!db) return [];
  if (modality) {
    return db
      .select()
      .from(studioRecipes)
      .where(
        and(eq(studioRecipes.userId, userId), eq(studioRecipes.modality, modality))
      )
      .orderBy(desc(studioRecipes.updatedAt));
  }
  return db
    .select()
    .from(studioRecipes)
    .where(eq(studioRecipes.userId, userId))
    .orderBy(desc(studioRecipes.updatedAt));
}

export async function createStudioRecipe(data: InsertStudioRecipe) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(studioRecipes).values(data);
  return result[0].insertId;
}

export async function deleteStudioRecipe(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(studioRecipes)
    .where(and(eq(studioRecipes.id, id), eq(studioRecipes.userId, userId)));
}

// ─── Studio Versions (VersionHistoryPanel) ─────────────────────────────────
// Backs trpc.studio.versions.* — Studio.tsx versions[] was in-memory only.

export async function listStudioVersions(
  userId: number,
  modality?: "image" | "video" | "music" | "voice",
  limit = 50
) {
  const db = await getDb();
  if (!db) return [];
  if (modality) {
    return db
      .select()
      .from(studioVersions)
      .where(
        and(
          eq(studioVersions.userId, userId),
          eq(studioVersions.modality, modality)
        )
      )
      .orderBy(desc(studioVersions.createdAt))
      .limit(limit);
  }
  return db
    .select()
    .from(studioVersions)
    .where(eq(studioVersions.userId, userId))
    .orderBy(desc(studioVersions.createdAt))
    .limit(limit);
}

export async function createStudioVersion(data: InsertStudioVersion) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(studioVersions).values(data);
  return result[0].insertId;
}

export async function setStudioVersionPinned(
  userId: number,
  versionKey: string,
  pinned: boolean
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(studioVersions)
    .set({ pinned })
    .where(
      and(
        eq(studioVersions.userId, userId),
        eq(studioVersions.versionKey, versionKey)
      )
    );
}

export async function deleteStudioVersion(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(studioVersions)
    .where(and(eq(studioVersions.id, id), eq(studioVersions.userId, userId)));
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

export interface SiteModelUsageRow {
  model: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalTokens: number;
  totalCostUsd: number;
}

/**
 * Per-user top model by recent spend / call count. Used by the proactive
 * accountant trigger so the "本月已用 X%，剩 Y 點，最近花最多的是 Z" toast
 * actually names the user's heaviest model instead of the "(待接入)"
 * placeholder.
 *
 * Returns null when the DB isn't available or the user has no usage.
 * Ranks by `estimated_cost_usd` first (so a single expensive video weighs
 * more than a thousand cheap chat turns), falling back to call count when
 * cost is missing.
 */
export async function getUserTopModelRecent(
  userId: number,
  args?: { days?: number }
): Promise<{ model: string; totalCalls: number; totalCostUsd: number } | null> {
  const db = await getDb();
  if (!db) return null;
  const days = Math.max(1, Math.min(90, Math.trunc(args?.days ?? 30)));
  const rows = await db
    .select({
      model: apiUsageLogs.model,
      totalCalls: sql<number>`COUNT(*)`,
      totalCostUsd: sql<string>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
    })
    .from(apiUsageLogs)
    .where(
      and(
        eq(apiUsageLogs.userId, userId),
        sql`${apiUsageLogs.createdAt} >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`,
        sql`${apiUsageLogs.model} IS NOT NULL`,
        sql`TRIM(${apiUsageLogs.model}) <> ''`
      )
    )
    .groupBy(apiUsageLogs.model)
    .orderBy(
      sql`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0) DESC`,
      sql`COUNT(*) DESC`
    )
    .limit(1);
  const row = rows[0];
  if (!row || !row.model) return null;
  return {
    model: String(row.model),
    totalCalls: Number(row.totalCalls ?? 0),
    totalCostUsd: parseFloat(String(row.totalCostUsd ?? "0")),
  };
}

/** Admin/Agent: site-wide model usage snapshot from api_usage_logs. */
export async function getSiteWideModelUsageSnapshot(args?: {
  days?: number;
  limit?: number;
}): Promise<SiteModelUsageRow[]> {
  const db = await getDb();
  if (!db) return [];
  const days = Math.max(1, Math.min(90, Math.trunc(args?.days ?? 14)));
  const limit = Math.max(1, Math.min(20, Math.trunc(args?.limit ?? 8)));

  const rows = await db
    .select({
      model: apiUsageLogs.model,
      totalCalls: sql<number>`COUNT(*)`,
      successCalls: sql<number>`SUM(CASE WHEN ${apiUsageLogs.success} = 1 THEN 1 ELSE 0 END)`,
      failedCalls: sql<number>`SUM(CASE WHEN ${apiUsageLogs.success} = 0 THEN 1 ELSE 0 END)`,
      totalTokens: sql<number>`COALESCE(SUM(${apiUsageLogs.tokensUsed}), 0)`,
      totalCostUsd: sql<string>`COALESCE(SUM(${apiUsageLogs.estimatedCostUsd}), 0)`,
    })
    .from(apiUsageLogs)
    .where(
      and(
        sql`${apiUsageLogs.createdAt} >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`,
        sql`${apiUsageLogs.model} IS NOT NULL`,
        sql`TRIM(${apiUsageLogs.model}) <> ''`
      )
    )
    .groupBy(apiUsageLogs.model)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(limit);

  return rows.map(row => ({
    model: String(row.model ?? "unknown"),
    totalCalls: Number(row.totalCalls ?? 0),
    successCalls: Number(row.successCalls ?? 0),
    failedCalls: Number(row.failedCalls ?? 0),
    totalTokens: Number(row.totalTokens ?? 0),
    totalCostUsd: Number(row.totalCostUsd ?? 0),
  }));
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
