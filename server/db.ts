import { eq, ne, desc, asc, and, or, like, sql, lt, inArray, isNull, type SQL } from "drizzle-orm";
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
  promptLibrary,
  promptAssets,
  InsertPromptAssetLink,
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
  worldbuildingFrameworks,
  InsertWorldbuildingFramework,
  WorldbuildingFramework,
  worldStoryboards,
  InsertWorldStoryboard,
  WorldStoryboard as WorldStoryboardRow,
  creativeProjects,
  InsertCreativeProject,
  CreativeProject,
  orchestrationRuns,
  InsertOrchestrationRun,
  OrchestrationRun,
  contextPackets,
  InsertContextPacket,
  ContextPacket,
  projectDataAccessRules,
  InsertProjectDataAccessRule,
  ProjectDataAccessRule,
  dataSourceConnections,
  InsertDataSourceConnection,
  DataSourceConnection,
  teachingMaterials,
  InsertTeachingMaterial,
  TeachingMaterial,
  teams,
  InsertTeam,
  Team,
  teamMemberships,
  InsertTeamMembership,
  TeamMembership,
  teachingMaterialAccessLog,
  InsertTeachingMaterialAccessLog,
  TeachingMaterialAccessLog,
  modelWishes,
  InsertModelWish,
  modelWishVotes,
  realEarthEntries,
  type RealEarthEntry,
  type InsertRealEarthEntry,
  resourceShares,
  type ResourceShare,
  type InsertResourceShare,
  refreshTokens,
  type RefreshToken,
  userWorkflows,
  type UserWorkflow,
  type InsertUserWorkflow,
  loginHistory,
  timelineFrames,
  type TimelineFrameRow,
  type InsertTimelineFrame,
  sceneCompositions,
  type SceneCompositionRow,
  type InsertSceneComposition,
  videoProjects,
  type VideoProject,
  type InsertVideoProject,
  projectSnapshots,
  type ProjectSnapshot,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { serverEnv } from "./_core/env.validated";
import { getDatabaseManager } from "./_core/DatabaseManager";
import type { UserRole } from "@shared/const";

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
 * AIDV-61（H6）：Migration fail-closed 開機門判定 — 純函式以利測試。
 *
 * 預設 OFF（fail-open，維持現狀）：只接受明確的 truthy 字串才開啟。
 *   ON  = "true" / "1" / "on" / "yes"（大小寫不拘、前後空白不拘）。
 *   其餘（含空字串、未設定、"false"/"0"）= OFF。
 *
 * 此判定不碰 DB、不看 DATABASE_URL：是否「真的嘗試套用 migration」由
 * applyMigrations 的執行路徑決定（demo / 無 DATABASE_URL 根本不會走到
 * 套用流程，故 ON/OFF 都不影響 demo 開機）。fail-closed 僅在「真實 apply
 * 失敗」的 catch 內被諮詢。
 */
export function isMigrationFailClosed(): boolean {
  const raw = (serverEnv.MIGRATION_FAIL_CLOSED ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "on" || raw === "yes";
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
      // AIDV-61（H6）：fail-closed 開機門。預設 OFF＝維持上一行的「log 後照常
      // 服務」現狀（對現有 prod 零行為改變）。設 MIGRATION_FAIL_CLOSED=true 時，
      // 印出清楚的致命 log（含底層錯誤）後 rethrow，讓錯誤一路傳到 bootstrap
      // 的 fatal handler（runMigrations → getDb → applyMigrations 都會把這個
      // rejection 往上拋），由其 process.exit(1) 擋啟動、令 /api/health 失敗、
      // Railway 偵測不健康後自動重啟或人工回滾。
      // 注意：此 catch 只在 migrate() 真的拋錯（真實 apply 失敗）時進入；冪等
      // 重跑 / 已套用不會進來，故 fail-closed 不會誤判既有已套用的 migration。
      if (isMigrationFailClosed()) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(
          "[Database][FATAL] Migration apply failed and MIGRATION_FAIL_CLOSED is enabled — " +
            "refusing to start. Roll back to the last healthy deploy and inspect the failing " +
            "migration in drizzle/ before redeploying. See docs/guides/MIGRATION_FAILURE_SOP.md. " +
            `Underlying error: ${detail}`
        );
        // rethrow synchronously inside the IIFE so the awaited promise rejects.
        throw error instanceof Error
          ? error
          : new Error(`[Database] Migration apply failed (fail-closed): ${detail}`);
      }
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
    // Connection establishment is best-effort: a transient connect failure
    // must NOT be treated as a fail-closed migration failure — it leaves _db
    // null and the next request retries. Keep this catch scoped to connect only.
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
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }

  // AIDV-61（H6）：applyMigrations 刻意放在連線 try/catch **之外**。
  // 連線成功後若 migration 真的套用失敗，且 MIGRATION_FAIL_CLOSED=ON，
  // applyMigrations 會 reject——必須讓它一路傳出 getDb()（→ runMigrations →
  // bootstrap fatal handler process.exit(1)），不能被「連線失敗」的 catch 吞掉。
  // OFF（預設）時 applyMigrations 不會 reject（catch 吞掉），此處等同舊行為。
  if (_db) {
    await applyMigrations(_db);
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

export async function softDeleteUser(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const anonymizedOpenId = `deleted-${userId}-${Date.now()}`;
  await db
    .update(users)
    .set({
      deletedAt: sql`NOW()`,
      name: null,
      email: null,
      passwordHash: null,
      twoFactorSecret: null,
      orbMemorySummary: null,
      avatarUrl: null,
      openId: anonymizedOpenId,
    })
    .where(eq(users.id, userId));
}

export async function purgeOldLoginHistory(daysToKeep = 90): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.execute(
    sql`DELETE FROM login_history WHERE createdAt < DATE_SUB(NOW(), INTERVAL ${daysToKeep} DAY)`
  );
  return (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
}

export async function purgeOldAuditLog(daysToKeep = 90): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.execute(
    sql`DELETE FROM global_audit_log WHERE createdAt < DATE_SUB(NOW(), INTERVAL ${daysToKeep} DAY)`
  );
  return (result as unknown as { affectedRows?: number }).affectedRows ?? 0;
}

export async function getUsersByIds(ids: number[]) {
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      role: users.role,
    })
    .from(users)
    .where(inArray(users.id, ids));
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

/**
 * AIDV-609 — 依 Replicate trainingId（存於 replicatePredictionId 欄）取本人擁有的訓練模型。
 * WHERE 同時鎖 userId，用於 loraTrainer.replicateTrainingStatus 的擁有權守門，
 * 避免任何登入者拿他人 trainingId 查訓練狀態。命中 0 回 null（呼叫端轉 NOT_FOUND）。
 */
export async function getFineTunedModelByReplicateId(
  replicatePredictionId: string,
  userId: number
) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(fineTunedModels)
    .where(
      and(
        eq(fineTunedModels.replicatePredictionId, replicatePredictionId),
        eq(fineTunedModels.userId, userId)
      )
    )
    .limit(1);
  return rows[0] || null;
}

/** 列出某團隊的 team_shared 模型（M 訓練 track）。 */
export async function getFineTunedModelsByTeam(teamId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(fineTunedModels)
    .where(
      and(
        eq(fineTunedModels.teamId, teamId),
        eq(fineTunedModels.visibility, "team_shared")
      )
    )
    .orderBy(desc(fineTunedModels.createdAt));
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

export async function getDigitalAssetsByUser(userId: number, limit?: number) {
  const db = await getDb();
  if (!db) return [];
  const q = db
    .select()
    .from(digitalAssetLibrary)
    .where(eq(digitalAssetLibrary.userId, userId))
    .orderBy(desc(digitalAssetLibrary.createdAt));
  return typeof limit === "number" && limit > 0 ? q.limit(limit) : q;
}

/**
 * AIDV-581：SQL 過濾版本，解決全量載入卡頓。
 * 把 assetType / sourceStudio / search 下推到 WHERE，避免把整張表撈進記憶體
 * 再用 JS filter。萬用字元已跳脫（`escapeLikePattern`）。
 * 預設 limit 200 防 OOM；呼叫端可覆寫。
 */
export async function getDigitalAssetsByUserFiltered(opts: {
  userId: number;
  assetType?: string;
  sourceStudio?: string;
  search?: string;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [eq(digitalAssetLibrary.userId, opts.userId)];

  if (opts.assetType && opts.assetType !== "all") {
    conditions.push(
      eq(digitalAssetLibrary.assetType, opts.assetType as "image" | "video" | "audio" | "voice" | "script" | "zip_bundle")
    );
  }

  if (opts.sourceStudio && opts.sourceStudio !== "all") {
    if (opts.sourceStudio === "unknown") {
      conditions.push(isNull(digitalAssetLibrary.sourceStudio));
    } else {
      conditions.push(eq(digitalAssetLibrary.sourceStudio, opts.sourceStudio));
    }
  }

  if (opts.search) {
    const trimmed = opts.search.trim();
    if (trimmed) {
      const escaped = escapeLikePattern(trimmed);
      const pattern = `%${escaped}%`;
      conditions.push(
        or(
          like(digitalAssetLibrary.title, pattern),
          like(digitalAssetLibrary.description, pattern),
          like(digitalAssetLibrary.promptUsed, pattern)
        )!
      );
    }
  }

  return db
    .select()
    .from(digitalAssetLibrary)
    .where(and(...conditions))
    .orderBy(desc(digitalAssetLibrary.createdAt))
    .limit(opts.limit ?? 200);
}

// ─── Prompt ↔ Asset 關聯（prompt_assets junction, migration 0075）────────────

/**
 * 建一條 prompt ↔ asset 邊。(promptId, assetId, relation) 有唯一鍵 —
 * 重複建邊（生成鏈 webhook+polling 雙路徑、backfill 重跑）視為成功回 0，
 * 其他錯誤照拋。
 */
export async function createPromptAssetLink(data: InsertPromptAssetLink) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    const result = await db.insert(promptAssets).values(data);
    return Number(result[0].insertId);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code ?? "";
    if (code === "ER_DUP_ENTRY") return 0; // 冪等：邊已存在
    throw err;
  }
}

/**
 * 某 prompt 衍生了哪些資產。join digital_asset_library 並以資產的 userId
 * 限縮（呼叫端 router 另檢查 prompt 本身的所有權 — 雙層防護）。
 */
export async function getLinkedAssetsForPrompt(userId: number, promptId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      relation: promptAssets.relation,
      linkedAt: promptAssets.createdAt,
      asset: {
        id: digitalAssetLibrary.id,
        title: digitalAssetLibrary.title,
        assetType: digitalAssetLibrary.assetType,
        fileUrl: digitalAssetLibrary.fileUrl,
        thumbnailUrl: digitalAssetLibrary.thumbnailUrl,
        sourceStudio: digitalAssetLibrary.sourceStudio,
        modelId: digitalAssetLibrary.modelId,
        createdAt: digitalAssetLibrary.createdAt,
      },
    })
    .from(promptAssets)
    .innerJoin(
      digitalAssetLibrary,
      eq(promptAssets.assetId, digitalAssetLibrary.id)
    )
    .where(
      and(
        eq(promptAssets.promptId, promptId),
        eq(digitalAssetLibrary.userId, userId)
      )
    )
    .orderBy(desc(promptAssets.createdAt));
}

/**
 * 某資產用過哪些 prompt。join prompt_library 並以 prompt 的 userId 限縮
 * （呼叫端 router 另檢查資產本身的所有權 — 雙層防護）。
 */
export async function getLinkedPromptsForAsset(userId: number, assetId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      relation: promptAssets.relation,
      linkedAt: promptAssets.createdAt,
      prompt: {
        id: promptLibrary.id,
        title: promptLibrary.title,
        content: promptLibrary.content,
        category: promptLibrary.category,
        modelHint: promptLibrary.modelHint,
        createdAt: promptLibrary.createdAt,
      },
    })
    .from(promptAssets)
    .innerJoin(promptLibrary, eq(promptAssets.promptId, promptLibrary.id))
    .where(
      and(
        eq(promptAssets.assetId, assetId),
        eq(promptLibrary.userId, userId)
      )
    )
    .orderBy(desc(promptAssets.createdAt));
}

/** W3-F 血統檢視：最近 N 個有 prompt 連結的資產（一次 join，不做 N+1）。 */
export async function getRecentAssetLineage(userId: number, limit = 5) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      assetId: digitalAssetLibrary.id,
      assetTitle: digitalAssetLibrary.title,
      assetType: digitalAssetLibrary.assetType,
      sourceStudio: digitalAssetLibrary.sourceStudio,
      modelId: digitalAssetLibrary.modelId,
      assetCreatedAt: digitalAssetLibrary.createdAt,
      relation: promptAssets.relation,
      promptId: promptLibrary.id,
      promptTitle: promptLibrary.title,
      promptContent: promptLibrary.content,
    })
    .from(digitalAssetLibrary)
    .innerJoin(promptAssets, eq(promptAssets.assetId, digitalAssetLibrary.id))
    .innerJoin(promptLibrary, eq(promptAssets.promptId, promptLibrary.id))
    .where(
      and(
        eq(digitalAssetLibrary.userId, userId),
        eq(promptLibrary.userId, userId),
      )
    )
    .orderBy(desc(digitalAssetLibrary.createdAt))
    .limit(limit);
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

/**
 * AIDV-601：SQL 過濾版本（getTeamSharedAssets 的孿生加固，比照 AIDV-581 的
 * getDigitalAssetsByUserFiltered）。把 assetType / sourceStudio / search 下推到
 * WHERE，避免把整個全站 team_shared 池撈進記憶體再用 JS filter（規模大時 OOM）。
 * 萬用字元已跳脫（`escapeLikePattern`）。預設 limit 200 防 OOM；呼叫端可覆寫。
 *
 * 注意：本函式只負責 team_shared 池的 SQL 過濾。AIDV-121 旗標 ON 時的逐筆
 * canAccessResource 權限過濾仍由 router 在本結果上執行（見 assets.teamAssets）。
 */
export async function getTeamSharedAssetsFiltered(opts: {
  assetType?: string;
  sourceStudio?: string;
  search?: string;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [
    eq(digitalAssetLibrary.visibility, "team_shared"),
  ];

  if (opts.assetType && opts.assetType !== "all") {
    conditions.push(
      eq(digitalAssetLibrary.assetType, opts.assetType as "image" | "video" | "audio" | "voice" | "script" | "zip_bundle")
    );
  }

  if (opts.sourceStudio && opts.sourceStudio !== "all") {
    if (opts.sourceStudio === "unknown") {
      conditions.push(isNull(digitalAssetLibrary.sourceStudio));
    } else {
      conditions.push(eq(digitalAssetLibrary.sourceStudio, opts.sourceStudio));
    }
  }

  if (opts.search) {
    const trimmed = opts.search.trim();
    if (trimmed) {
      const escaped = escapeLikePattern(trimmed);
      const pattern = `%${escaped}%`;
      conditions.push(
        or(
          like(digitalAssetLibrary.title, pattern),
          like(digitalAssetLibrary.description, pattern),
          like(digitalAssetLibrary.promptUsed, pattern)
        )!
      );
    }
  }

  return db
    .select()
    .from(digitalAssetLibrary)
    .where(and(...conditions))
    .orderBy(desc(digitalAssetLibrary.createdAt))
    .limit(opts.limit ?? 200);
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

/**
 * 數出「除了 excludeId 之外」還有幾列共用同一個 fileKey（AIDV-67）。
 * 用途：刪資產要連動刪 R2 物件前，先確認沒有其他資產（例如公開回收複製、團隊
 * 共享複製）仍指向同一個 storage key——有就不刪物件，免得刪一列害其他列壞圖。
 * fileKey 空字串一律回 0（無 key 無從共用）。
 */
export async function countOtherDigitalAssetsByFileKey(
  fileKey: string,
  excludeId: number
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  if (!fileKey || !fileKey.trim()) return 0;
  const rows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(digitalAssetLibrary)
    .where(
      and(
        eq(digitalAssetLibrary.fileKey, fileKey),
        ne(digitalAssetLibrary.id, excludeId)
      )
    );
  return Number(rows[0]?.count ?? 0);
}

/**
 * 取出已過保留期（expiresAt < asOf）的資產，給 TTL 清理 job 用（AIDV-67）。
 * 只選清理需要的欄位（id / fileKey）。expiresAt 為 NULL（無到期）的列因
 * `NULL < x` 在 SQL 為 unknown 而天然被排除，不會被選到。
 */
export async function listExpiredDigitalAssets(
  limit: number,
  asOf: Date = new Date()
): Promise<Array<{ id: number; fileKey: string | null }>> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: digitalAssetLibrary.id,
      fileKey: digitalAssetLibrary.fileKey,
    })
    .from(digitalAssetLibrary)
    .where(lt(digitalAssetLibrary.expiresAt, asOf))
    .orderBy(asc(digitalAssetLibrary.expiresAt))
    .limit(limit);
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

export async function getProjectNotesByUser(userId: number, limit?: number) {
  const db = await getDb();
  if (!db) return [];
  const q = db
    .select()
    .from(projectNotesCalendar)
    .where(eq(projectNotesCalendar.userId, userId))
    .orderBy(desc(projectNotesCalendar.createdAt));
  return typeof limit === "number" && limit > 0 ? q.limit(limit) : q;
}

/**
 * List director-AI session snapshots for a user without loading the (often
 * large) `content` blob. Filters by `noteType = "script"` at the DB layer
 * using the `pnc_userId_noteType_idx` index, and projects only the columns
 * the sessions list UI actually renders.
 */
export async function getDirectorSessionsByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: projectNotesCalendar.id,
      title: projectNotesCalendar.title,
      tags: projectNotesCalendar.tags,
      createdAt: projectNotesCalendar.createdAt,
      updatedAt: projectNotesCalendar.updatedAt,
    })
    .from(projectNotesCalendar)
    .where(
      and(
        eq(projectNotesCalendar.userId, userId),
        eq(projectNotesCalendar.noteType, "script")
      )
    )
    .orderBy(desc(projectNotesCalendar.updatedAt));
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

export async function getRecentApiEventsForModel(
  userId: number,
  modelId: string,
  windowSec: number
) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      provider: apiUsageLogs.apiProvider,
      endpoint: apiUsageLogs.model,
      status: apiUsageLogs.responseStatus,
      costUsd: apiUsageLogs.estimatedCostUsd,
      latencyMs: apiUsageLogs.durationMs,
      userId: apiUsageLogs.userId,
      createdAt: apiUsageLogs.createdAt,
    })
    .from(apiUsageLogs)
    .where(
      and(
        eq(apiUsageLogs.userId, userId),
        eq(apiUsageLogs.model, modelId),
        sql`${apiUsageLogs.createdAt} >= DATE_SUB(NOW(), INTERVAL ${windowSec} SECOND)`
      )
    )
    .orderBy(asc(apiUsageLogs.createdAt));
  return rows.map(r => ({
    provider: r.provider,
    endpoint: r.endpoint ?? modelId,
    status: r.status as "success" | "failed" | "timeout" | "blocked",
    costUsd: parseFloat(r.costUsd as unknown as string || "0"),
    latencyMs: r.latencyMs ?? undefined,
    userId: r.userId,
    createdAt: r.createdAt,
  }));
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
      // 站內公定積分 — 直接從寫帳時 deduct 的點數加總，比 USD × 100 推估更
      // 貼近真實扣帳（因為 generationsDeducted 可能套過最低/封頂 clamp）。
      totalCredits: sql<number>`COALESCE(SUM(${apiUsageLogs.generationsDeducted}), 0)`,
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

/**
 * AIDV-577: CAS 原子退款鎖——先在 DB 設 refunded=true，再做真實退款。
 *
 * 同一 job 的多條失敗路徑可能並發呼叫退款；`UPDATE ... WHERE NOT refunded`
 * 只有第一條能更新（affectedRows=1），其餘回傳 false，避免重複退款。
 * 把旗標寫在退款**之前**：若信用回補失敗可由審計日誌對帳，
 * 比把退款寫在前（舊做法）可能雙退積分更安全。
 *
 * 回傳：true = 此次呼叫搶到鎖（可繼續退款）；false = 已被其他呼叫搶先。
 */
export async function atomicClaimJobRefund(
  jobId: number,
  points: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.execute(
    sql`UPDATE background_jobs
        SET resultJson = JSON_SET(
          COALESCE(resultJson, '{}'),
          '$.refunded', CAST('true' AS JSON),
          '$.refundedPoints', CAST(${points} AS SIGNED)
        )
        WHERE id = ${jobId}
          AND (
            resultJson IS NULL
            OR JSON_UNQUOTE(JSON_EXTRACT(resultJson, '$.refunded')) IS NULL
            OR JSON_UNQUOTE(JSON_EXTRACT(resultJson, '$.refunded')) != 'true'
          )`
  );
  return ((result as unknown as { affectedRows?: number }).affectedRows ?? 0) > 0;
}

/**
 * AIDV-577: 部分合併 resultJson 旗標，避免並發寫入互蓋整包 JSON。
 *
 * 舊做法 `{ ...meta, flag: true }` 會帶入函式開頭讀到的過期 meta；
 * 若 doPostGenComplete 與 refundJobIfBilled 幾乎同時跑，後寫者會把
 * 前者剛設的旗標蓋掉。`JSON_MERGE_PATCH` 只更新指定欄位，不動其餘。
 */
export async function mergeBackgroundJobResultJson(
  jobId: number,
  patch: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const patchJson = JSON.stringify(patch);
  await db.execute(
    sql`UPDATE background_jobs
        SET resultJson = JSON_MERGE_PATCH(COALESCE(resultJson, '{}'), CAST(${patchJson} AS JSON))
        WHERE id = ${jobId}`
  );
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

/** AIDV-651: 批次取得多個 background job（WHERE id IN (...)），避免逐筆 N+1。 */
export async function getBackgroundJobsByIds(ids: number[]) {
  const db = await getDb();
  if (!db || ids.length === 0) return [];
  return db.select().from(backgroundJobs).where(inArray(backgroundJobs.id, ids));
}

/**
 * AIDV-244：透過 fal.ai request_id 反查任意狀態的 backgroundJob（用於 ownership 驗證）。
 * 與 findProcessingJobByRequestId 的差異：不限制 status，適用於 checkVideoStatus 查詢已完成的 job。
 */
export async function getBackgroundJobByRequestId(requestId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(backgroundJobs)
    .where(
      sql`JSON_UNQUOTE(JSON_EXTRACT(${backgroundJobs.resultJson}, '$.requestId')) = ${requestId}`
    )
    .orderBy(desc(backgroundJobs.createdAt))
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

export async function getHistoryEntry(id: number, userId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(generationHistory)
    .where(and(eq(generationHistory.id, id), eq(generationHistory.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Custom Blocks ─────────────────────────────────────────────────────────────

export async function createCustomBlock(data: InsertCustomBlock) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(customBlocks).values(data);
  return result[0].insertId;
}

export async function getCustomBlocksByUser(
  userId: number,
  modality?: typeof customBlocks.$inferSelect["modality"]
) {
  const db = await getDb();
  if (!db) return [];
  if (modality) {
    return db
      .select()
      .from(customBlocks)
      .where(
        and(
          eq(customBlocks.userId, userId),
          eq(customBlocks.modality, modality)
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

export async function getBlockCombosByUser(
  userId: number,
  modality?: typeof blockCombos.$inferSelect["modality"]
) {
  const db = await getDb();
  if (!db) return [];
  if (modality) {
    return db
      .select()
      .from(blockCombos)
      .where(
        and(
          eq(blockCombos.userId, userId),
          eq(blockCombos.modality, modality)
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
export async function getQueuedJobsByType(
  jobType: typeof backgroundJobs.$inferSelect["jobType"],
  limit = 10
) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(backgroundJobs)
    .where(
      and(
        eq(backgroundJobs.jobType, jobType),
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
  jobType: typeof backgroundJobs.$inferSelect["jobType"],
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
        eq(backgroundJobs.jobType, jobType),
        eq(backgroundJobs.status, "processing"),
        sql`${backgroundJobs.updatedAt} < ${cutoff}`
      )
    )
    .orderBy(backgroundJobs.createdAt)
    .limit(limit);
}

// ─── Admin: Extended Queries ────────────────────────────────────────────────

/** Admin: Update a user's role (protects super-admin emails from demotion) */
export async function updateUserRole(userId: number, role: UserRole) {
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

// ─── Worldbuilding Frameworks ───────────────────────────────────────────────

export async function createWorldbuildingFramework(
  data: InsertWorldbuildingFramework
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(worldbuildingFrameworks).values(data);
  return result[0].insertId;
}

export async function getWorldbuildingFramework(
  id: number
): Promise<WorldbuildingFramework | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(worldbuildingFrameworks)
    .where(eq(worldbuildingFrameworks.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getWorldbuildingFrameworksByUser(
  userId: number
): Promise<WorldbuildingFramework[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(worldbuildingFrameworks)
    .where(eq(worldbuildingFrameworks.userId, userId))
    .orderBy(desc(worldbuildingFrameworks.updatedAt));
}

export async function updateWorldbuildingFramework(
  id: number,
  data: Partial<InsertWorldbuildingFramework>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(worldbuildingFrameworks)
    .set(data)
    .where(eq(worldbuildingFrameworks.id, id));
}

export async function deleteWorldbuildingFramework(id: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(worldbuildingFrameworks)
    .where(eq(worldbuildingFrameworks.id, id));
}

// ─── World Storyboards（動畫分鏡時間軸） ───────────────────────────────────

export async function createWorldStoryboard(
  data: InsertWorldStoryboard
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(worldStoryboards).values(data);
  return result[0].insertId;
}

export async function getWorldStoryboard(
  id: number
): Promise<WorldStoryboardRow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(worldStoryboards)
    .where(eq(worldStoryboards.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getWorldStoryboardsByUser(
  userId: number
): Promise<WorldStoryboardRow[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(worldStoryboards)
    .where(eq(worldStoryboards.userId, userId))
    .orderBy(desc(worldStoryboards.updatedAt));
}

export async function getWorldStoryboardsByWorld(
  worldId: number
): Promise<WorldStoryboardRow[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(worldStoryboards)
    .where(eq(worldStoryboards.worldId, worldId))
    .orderBy(desc(worldStoryboards.updatedAt));
}

export async function updateWorldStoryboard(
  id: number,
  data: Partial<InsertWorldStoryboard>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(worldStoryboards)
    .set(data)
    .where(eq(worldStoryboards.id, id));
}

export async function updateWorldStoryboardJobAtomic(
  id: number,
  stepId: string,
  jobData: Record<string, unknown>
) {
  const db = await getDb();
  if (!db) return;
  const jsonPath = `$.${stepId}`;
  const jsonValue = JSON.stringify(jobData);
  await db.execute(
    sql`UPDATE world_storyboards SET jobsJson = JSON_SET(COALESCE(jobsJson, '{}'), ${jsonPath}, CAST(${jsonValue} AS JSON)) WHERE id = ${id}`
  );
}

export async function deleteWorldStoryboard(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(worldStoryboards).where(eq(worldStoryboards.id, id));
}

// ─── Timeline Frames (AIDV-433) ────────────────────────────────────────────

export async function listTimelineFramesByStoryboard(
  storyboardId: number,
  userId: number
): Promise<TimelineFrameRow[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(timelineFrames)
    .where(
      and(
        eq(timelineFrames.storyboardId, storyboardId),
        eq(timelineFrames.userId, userId)
      )
    )
    .orderBy(asc(timelineFrames.timeOffsetSec));
}

export async function createTimelineFrame(
  data: InsertTimelineFrame
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(timelineFrames).values(data);
  return result[0].insertId;
}

export async function getTimelineFrame(
  frameId: number
): Promise<TimelineFrameRow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(timelineFrames)
    .where(eq(timelineFrames.id, frameId))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteTimelineFrame(
  frameId: number,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(timelineFrames)
    .where(and(eq(timelineFrames.id, frameId), eq(timelineFrames.userId, userId)));
}

export async function updateTimelineFrameConsistency(
  frameId: number,
  result: Record<string, unknown>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(timelineFrames)
    .set({ consistencyCheckJson: result, updatedAt: new Date() })
    .where(eq(timelineFrames.id, frameId));
}

// ─── Scene Compositions (AIDV-433) ─────────────────────────────────────────

export async function listSceneCompositions(
  worldId: number,
  userId: number
): Promise<SceneCompositionRow[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(sceneCompositions)
    .where(
      and(
        eq(sceneCompositions.worldId, worldId),
        eq(sceneCompositions.userId, userId)
      )
    )
    .orderBy(desc(sceneCompositions.updatedAt));
}

export async function createSceneComposition(
  data: InsertSceneComposition
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(sceneCompositions).values(data);
  return result[0].insertId;
}

export async function deleteSceneComposition(
  compositionId: number,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(sceneCompositions)
    .where(
      and(
        eq(sceneCompositions.id, compositionId),
        eq(sceneCompositions.userId, userId)
      )
    );
}

// ─── Creative Projects（創作專案）─────────────────────────────────────────

export async function createCreativeProject(
  data: InsertCreativeProject
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(creativeProjects).values(data);
  return result[0].insertId;
}

export async function getCreativeProject(
  id: number
): Promise<CreativeProject | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(creativeProjects)
    .where(eq(creativeProjects.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getCreativeProjectsByUser(
  userId: number
): Promise<CreativeProject[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(creativeProjects)
    .where(eq(creativeProjects.userId, userId))
    .orderBy(desc(creativeProjects.updatedAt));
}

// AIDV-314: cursor-based paginated variant. Cursor = last seen row id.
// Ordered by id DESC (stable; uses primary key index with cp_userId_idx).
export async function getCreativeProjectsByUserPaginated(
  userId: number,
  opts: {
    cursor?: number;
    limit: number;
    search?: string;
    status?: "concept" | "production" | "review" | "complete";
  }
): Promise<CreativeProject[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions: ReturnType<typeof eq>[] = [
    eq(creativeProjects.userId, userId),
  ];
  if (opts.cursor) {
    conditions.push(lt(creativeProjects.id, opts.cursor));
  }
  if (opts.search) {
    conditions.push(like(creativeProjects.title, `%${escapeLikePattern(opts.search)}%`));
  }
  if (opts.status) {
    conditions.push(eq(creativeProjects.status, opts.status));
  }
  return db
    .select()
    .from(creativeProjects)
    .where(and(...conditions))
    .orderBy(desc(creativeProjects.id))
    .limit(opts.limit);
}

export async function updateCreativeProject(
  id: number,
  data: Partial<InsertCreativeProject>,
  opts?: { expectedVersion?: number }
): Promise<{ updated: boolean }> {
  const db = await getDb();
  if (!db) return { updated: false };
  const setData = { ...data, version: sql`\`version\` + 1` };
  const whereClause =
    opts?.expectedVersion !== undefined
      ? and(eq(creativeProjects.id, id), eq(creativeProjects.version, opts.expectedVersion))
      : eq(creativeProjects.id, id);
  const result = await db.update(creativeProjects).set(setData).where(whereClause);
  const affected = (result as unknown as { affectedRows: number }).affectedRows;
  return { updated: affected > 0 };
}

export async function deleteCreativeProject(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(creativeProjects).where(eq(creativeProjects.id, id));
}

// ─── Orchestration Runs（M1-B 任務總指揮入口紀錄）─────────────────────────────

export async function createOrchestrationRun(
  data: InsertOrchestrationRun
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(orchestrationRuns).values(data);
  return result[0].insertId;
}

export async function getOrchestrationRun(
  id: number
): Promise<OrchestrationRun | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(orchestrationRuns)
    .where(eq(orchestrationRuns.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getOrchestrationRunsByProject(
  projectId: number,
  limit?: number
): Promise<OrchestrationRun[]> {
  const db = await getDb();
  if (!db) return [];
  const q = db
    .select()
    .from(orchestrationRuns)
    .where(eq(orchestrationRuns.projectId, projectId))
    .orderBy(desc(orchestrationRuns.createdAt));
  return typeof limit === "number" && limit > 0 ? q.limit(limit) : q;
}

export async function getOrchestrationRunsByUser(
  userId: number,
  limit?: number
): Promise<OrchestrationRun[]> {
  const db = await getDb();
  if (!db) return [];
  const q = db
    .select()
    .from(orchestrationRuns)
    .where(eq(orchestrationRuns.userId, userId))
    .orderBy(desc(orchestrationRuns.createdAt));
  return typeof limit === "number" && limit > 0 ? q.limit(limit) : q;
}

// ─── Context Packets（M4 可重用創作上下文包）────────────────────────────────

export async function createContextPacket(
  data: InsertContextPacket
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(contextPackets).values(data);
  return result[0].insertId;
}

export async function getContextPacket(
  id: number
): Promise<ContextPacket | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(contextPackets)
    .where(eq(contextPackets.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** 取某 project 最新一筆 context packet（可選 scope）；給 reuseOrRefreshPacket 用。 */
export async function getLatestContextPacketForProject(
  projectId: number,
  scope?: string
): Promise<ContextPacket | null> {
  const db = await getDb();
  if (!db) return null;
  const condition = scope
    ? and(
        eq(contextPackets.projectId, projectId),
        eq(contextPackets.scope, scope as ContextPacket["scope"])
      )
    : eq(contextPackets.projectId, projectId);
  const rows = await db
    .select()
    .from(contextPackets)
    .where(condition)
    .orderBy(desc(contextPackets.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Project Data Access Rules（M4 資料來源存取規則）─────────────────────────

/**
 * 列出某 project 適用的存取規則：team-wide 預設（projectId IS NULL）+ 該 project
 * 專屬規則。caller 端再讓 project 專屬覆寫 team-wide。
 */
export async function listProjectDataAccessRules(
  teamId: number,
  projectId: number | null
): Promise<ProjectDataAccessRule[]> {
  const db = await getDb();
  if (!db) return [];
  const projectCond =
    projectId == null
      ? sql`${projectDataAccessRules.projectId} IS NULL`
      : or(
          eq(projectDataAccessRules.projectId, projectId),
          sql`${projectDataAccessRules.projectId} IS NULL`
        );
  return db
    .select()
    .from(projectDataAccessRules)
    .where(and(eq(projectDataAccessRules.teamId, teamId), projectCond))
    .orderBy(desc(projectDataAccessRules.updatedAt));
}

/**
 * Upsert 一條存取規則。自然鍵 = (teamId, projectId, materialId)；存在就更新，
 * 不存在才插入（service 層維護「一個目標一條規則」，DB 不加 NULL-distinct UNIQUE）。
 */
export async function upsertProjectDataAccessRule(
  data: InsertProjectDataAccessRule
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const matCond =
    data.materialId == null
      ? sql`${projectDataAccessRules.materialId} IS NULL`
      : eq(projectDataAccessRules.materialId, data.materialId);
  const projCond =
    data.projectId == null
      ? sql`${projectDataAccessRules.projectId} IS NULL`
      : eq(projectDataAccessRules.projectId, data.projectId);

  const existing = await db
    .select()
    .from(projectDataAccessRules)
    .where(and(eq(projectDataAccessRules.teamId, data.teamId), projCond, matCond))
    .limit(1);

  if (existing[0]) {
    await db
      .update(projectDataAccessRules)
      .set({
        accessLevel: data.accessLevel,
        allowedModesJson: data.allowedModesJson ?? null,
        connectionId: data.connectionId ?? null,
        collectionId: data.collectionId ?? null,
      })
      .where(eq(projectDataAccessRules.id, existing[0].id));
    return existing[0].id;
  }

  const result = await db.insert(projectDataAccessRules).values(data);
  return result[0].insertId;
}

export async function deleteProjectDataAccessRule(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(projectDataAccessRules)
    .where(eq(projectDataAccessRules.id, id));
}

// ─── Data Source Connections（M4/M5 外部資料來源連接）───────────────────────

export async function createDataSourceConnection(
  data: InsertDataSourceConnection
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(dataSourceConnections).values(data);
  return result[0].insertId;
}

export async function getDataSourceConnection(
  id: number
): Promise<DataSourceConnection | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(dataSourceConnections)
    .where(eq(dataSourceConnections.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** 列出使用者的連接；可選用 project 過濾（含未綁 project 的個人連接）。 */
export async function listDataSourceConnectionsForUser(
  userId: number,
  projectId?: number | null
): Promise<DataSourceConnection[]> {
  const db = await getDb();
  if (!db) return [];
  const base = eq(dataSourceConnections.ownerUserId, userId);
  const condition =
    projectId == null
      ? base
      : and(
          base,
          or(
            eq(dataSourceConnections.projectId, projectId),
            sql`${dataSourceConnections.projectId} IS NULL`
          )
        );
  return db
    .select()
    .from(dataSourceConnections)
    .where(condition)
    .orderBy(desc(dataSourceConnections.updatedAt));
}

export async function updateDataSourceConnection(
  id: number,
  patch: Partial<InsertDataSourceConnection>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(dataSourceConnections)
    .set(patch)
    .where(eq(dataSourceConnections.id, id));
}

export async function deleteDataSourceConnection(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(dataSourceConnections)
    .where(eq(dataSourceConnections.id, id));
}

// ─── Model Wishlist（模型許願池）──────────────────────────────────────────

export interface ModelWishListItem {
  id: number;
  userId: number;
  modelName: string;
  provider: string | null;
  modality:
    | "text"
    | "image"
    | "video"
    | "audio"
    | "voice"
    | "3d"
    | "multimodal"
    | "embedding"
    | "other";
  reason: string | null;
  referenceUrl: string | null;
  voteCount: number;
  status: "pending" | "under_review" | "planned" | "added" | "rejected";
  adminNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** 顯示用：許願者名稱（從 users 表 join） */
  userName: string | null;
  /** 目前查詢使用者是否已投票 */
  hasVoted: boolean;
}

export interface ModelWishListOptions {
  /** 目前查詢者 userId — 用來計算 hasVoted；未登入時傳 null */
  viewerId: number | null;
  modality?: typeof modelWishes.$inferSelect["modality"] | "all";
  status?: typeof modelWishes.$inferSelect["status"] | "all";
  /** 排序：votes（依票數，預設）｜ latest（依建立時間） */
  sort?: "votes" | "latest";
  limit?: number;
}

export async function listModelWishes(
  options: ModelWishListOptions
): Promise<ModelWishListItem[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (options.modality && options.modality !== "all") {
    conditions.push(eq(modelWishes.modality, options.modality));
  }
  if (options.status && options.status !== "all") {
    conditions.push(eq(modelWishes.status, options.status));
  }
  const orderClause =
    options.sort === "latest"
      ? [desc(modelWishes.createdAt)]
      : [desc(modelWishes.voteCount), desc(modelWishes.createdAt)];

  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);

  const rows = await db
    .select({
      id: modelWishes.id,
      userId: modelWishes.userId,
      modelName: modelWishes.modelName,
      provider: modelWishes.provider,
      modality: modelWishes.modality,
      reason: modelWishes.reason,
      referenceUrl: modelWishes.referenceUrl,
      voteCount: modelWishes.voteCount,
      status: modelWishes.status,
      adminNote: modelWishes.adminNote,
      createdAt: modelWishes.createdAt,
      updatedAt: modelWishes.updatedAt,
      userName: users.name,
    })
    .from(modelWishes)
    .leftJoin(users, eq(modelWishes.userId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...orderClause)
    .limit(limit);

  if (rows.length === 0) return [];

  // 計算 hasVoted —— 一次查詢取所有當前使用者的投票，不要 N+1
  let votedSet = new Set<number>();
  if (options.viewerId != null) {
    const wishIds = rows.map(r => r.id);
    const voteRows = await db
      .select({ wishId: modelWishVotes.wishId })
      .from(modelWishVotes)
      .where(
        and(
          eq(modelWishVotes.userId, options.viewerId),
          sql`${modelWishVotes.wishId} IN (${sql.join(
            wishIds.map(id => sql`${id}`),
            sql`, `
          )})`
        )
      );
    votedSet = new Set(voteRows.map(v => v.wishId));
  }

  return rows.map(r => ({
    ...r,
    hasVoted: votedSet.has(r.id),
  })) as ModelWishListItem[];
}

export async function createModelWish(data: InsertModelWish): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(modelWishes).values(data);
  return result[0].insertId;
}

export async function getModelWishById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(modelWishes)
    .where(eq(modelWishes.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteModelWish(id: number) {
  const db = await getDb();
  if (!db) return;
  // 包在 transaction 裡，搭配 voteModelWish 內部的 wish 鎖定，避免投票與
  // 刪除互相穿插造成孤兒票。
  await db.transaction(async tx => {
    await tx.delete(modelWishVotes).where(eq(modelWishVotes.wishId, id));
    await tx.delete(modelWishes).where(eq(modelWishes.id, id));
  });
}

export async function updateModelWishStatus(
  id: number,
  patch: {
    status?: "pending" | "under_review" | "planned" | "added" | "rejected";
    /** undefined = 保持原值；null = 清除站方回覆；string = 設定回覆 */
    adminNote?: string | null;
  }
) {
  const db = await getDb();
  if (!db) return;
  const update: Record<string, unknown> = {};
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.adminNote !== undefined) update.adminNote = patch.adminNote;
  if (Object.keys(update).length === 0) return;
  await db.update(modelWishes).set(update).where(eq(modelWishes.id, id));
}

/**
 * 投票（idempotent）：若使用者已投過票則不變；同時同步更新 voteCount。
 * 整段包在 transaction 裡並對許願列 `SELECT ... FOR UPDATE`，這樣即使
 * 跟刪除許願同時發生，也不會留下孤兒票（要嘛投票先成立、刪除等到能刪
 * 投票；要嘛刪除先進行、投票看到許願不存在直接 NOT_FOUND）。
 * 回傳 { voted: true, voteCount } 表示動作後狀態；
 * 若許願已被刪除則丟出 Error("WISH_NOT_FOUND")。
 */
export async function voteModelWish(
  wishId: number,
  userId: number
): Promise<{ voted: boolean; voteCount: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const locked = (await tx.execute(
      sql`SELECT id, voteCount FROM model_wishes WHERE id = ${wishId} FOR UPDATE`
    )) as any[];
    const rows = Array.isArray(locked?.[0]) ? locked[0] : locked;
    if (!rows?.length) {
      throw new Error("WISH_NOT_FOUND");
    }
    try {
      await tx.insert(modelWishVotes).values({ wishId, userId });
      await tx
        .update(modelWishes)
        .set({ voteCount: sql`${modelWishes.voteCount} + 1` })
        .where(eq(modelWishes.id, wishId));
    } catch (e: any) {
      // ER_DUP_ENTRY — 已投過票，視為成功（idempotent）
      if (!String(e?.code ?? "").includes("ER_DUP_ENTRY")) {
        throw e;
      }
    }
    const refreshed = (await tx.execute(
      sql`SELECT voteCount FROM model_wishes WHERE id = ${wishId}`
    )) as any[];
    const refreshedRows = Array.isArray(refreshed?.[0])
      ? refreshed[0]
      : refreshed;
    return {
      voted: true,
      voteCount: Number(refreshedRows?.[0]?.voteCount ?? 0),
    };
  });
}

export async function unvoteModelWish(
  wishId: number,
  userId: number
): Promise<{ voted: boolean; voteCount: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const locked = (await tx.execute(
      sql`SELECT id FROM model_wishes WHERE id = ${wishId} FOR UPDATE`
    )) as any[];
    const rows = Array.isArray(locked?.[0]) ? locked[0] : locked;
    if (!rows?.length) {
      throw new Error("WISH_NOT_FOUND");
    }
    const result = await tx
      .delete(modelWishVotes)
      .where(
        and(
          eq(modelWishVotes.wishId, wishId),
          eq(modelWishVotes.userId, userId)
        )
      );
    const removed = Number(result[0]?.affectedRows ?? 0);
    if (removed > 0) {
      // voteCount - 1，但不允許掉到負數
      await tx
        .update(modelWishes)
        .set({
          voteCount: sql`GREATEST(${modelWishes.voteCount} - 1, 0)`,
        })
        .where(eq(modelWishes.id, wishId));
    }
    const refreshed = (await tx.execute(
      sql`SELECT voteCount FROM model_wishes WHERE id = ${wishId}`
    )) as any[];
    const refreshedRows = Array.isArray(refreshed?.[0])
      ? refreshed[0]
      : refreshed;
    return {
      voted: false,
      voteCount: Number(refreshedRows?.[0]?.voteCount ?? 0),
    };
  });
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

// ─── Teaching Materials (法脈傳承教材庫) ─────────────────────────────────────

export type TeachingMaterialListFilters = {
  mediaType?: TeachingMaterial["mediaType"];
  sourceType?: TeachingMaterial["sourceType"];
  lineage?: string;
  topic?: string;
  search?: string;
};

export async function createTeachingMaterial(
  data: InsertTeachingMaterial
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(teachingMaterials).values(data);
  return result[0].insertId;
}

export async function getTeachingMaterial(
  id: number
): Promise<TeachingMaterial | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(teachingMaterials)
    .where(eq(teachingMaterials.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 列出 user 看得到的所有教材，套上「擁有 / 團隊共享 / 全 workspace 公開」的
 * 三層 visibility 規則：
 *
 *   1. 自己 (userId === currentUserId) — 不分 visibility 都看得到
 *   2. team_shared 且 teamId 是自己有 membership 的團隊
 *   3. public_disciples — 任何已登入使用者都看得到（admin 也走這條）
 *
 * filters.scope 可以選擇只看「我的 / 某團隊 / 全部」三種視圖，但 server 端
 * 永遠不會放寬到沒有授權的素材；scope 只是 narrow，不能 widen。
 */
/**
 * 給卡片列表 / 搜尋用的精簡欄位 — 不含 textContent（可能是 MB 等級的長字串），
 * 不含描述全文（前端只顯示前兩行 line-clamp，不需要完整 description 送過來
 * 也行，但這裡保留方便細項過濾顯示）。
 *
 * 跟 TeachingMaterial 主型別保持結構相容，避免前端兩套 type 並存。
 */
export type TeachingMaterialSummary = Omit<
  TeachingMaterial,
  "textContent" | "fileKey"
>;

const TEACHING_MATERIAL_SUMMARY_COLUMNS = {
  id: teachingMaterials.id,
  userId: teachingMaterials.userId,
  teamId: teachingMaterials.teamId,
  title: teachingMaterials.title,
  description: teachingMaterials.description,
  mediaType: teachingMaterials.mediaType,
  fileUrl: teachingMaterials.fileUrl,
  fileName: teachingMaterials.fileName,
  mimeType: teachingMaterials.mimeType,
  fileSizeBytes: teachingMaterials.fileSizeBytes,
  thumbnailUrl: teachingMaterials.thumbnailUrl,
  durationSeconds: teachingMaterials.durationSeconds,
  pageCount: teachingMaterials.pageCount,
  transcriptionStatus: teachingMaterials.transcriptionStatus,
  lineage: teachingMaterials.lineage,
  sourceType: teachingMaterials.sourceType,
  sourceDate: teachingMaterials.sourceDate,
  sourceLocation: teachingMaterials.sourceLocation,
  topic: teachingMaterials.topic,
  speaker: teachingMaterials.speaker,
  tags: teachingMaterials.tags,
  realEarthRefs: teachingMaterials.realEarthRefs,
  visibility: teachingMaterials.visibility,
  isFeatured: teachingMaterials.isFeatured,
  sortOrder: teachingMaterials.sortOrder,
  createdAt: teachingMaterials.createdAt,
  updatedAt: teachingMaterials.updatedAt,
} as const;

export async function listTeachingMaterialsForUser(
  userId: number,
  filters: TeachingMaterialListFilters = {},
  scope: {
    teamIds?: number[];
    only?: "mine" | "team" | "public";
    limit?: number;
  } = {}
): Promise<TeachingMaterialSummary[]> {
  const db = await getDb();
  if (!db) return [];

  const myTeamIds = scope.teamIds ?? [];

  // ── 組 visibility OR 子句 ────────────────────────────────────────────
  const visibilityClauses = [];
  if (scope.only === undefined || scope.only === "mine") {
    visibilityClauses.push(eq(teachingMaterials.userId, userId));
  }
  if ((scope.only === undefined || scope.only === "team") && myTeamIds.length > 0) {
    visibilityClauses.push(
      and(
        eq(teachingMaterials.visibility, "team_shared"),
        inArray(teachingMaterials.teamId, myTeamIds)
      )!
    );
  }
  if (scope.only === undefined || scope.only === "public") {
    visibilityClauses.push(
      eq(teachingMaterials.visibility, "public_disciples")
    );
  }
  if (visibilityClauses.length === 0) {
    // 例如 scope="team" 但 user 沒有任何 team membership — 一定空集合
    return [];
  }

  const visibilityOr =
    visibilityClauses.length === 1 ? visibilityClauses[0] : or(...visibilityClauses)!;

  const conditions = [visibilityOr];
  if (filters.mediaType) {
    conditions.push(eq(teachingMaterials.mediaType, filters.mediaType));
  }
  if (filters.sourceType) {
    conditions.push(eq(teachingMaterials.sourceType, filters.sourceType));
  }
  if (filters.lineage) {
    conditions.push(eq(teachingMaterials.lineage, filters.lineage));
  }
  if (filters.topic) {
    conditions.push(eq(teachingMaterials.topic, filters.topic));
  }
  if (filters.search) {
    const like = `%${escapeLikePattern(filters.search)}%`;
    conditions.push(
      sql`(${teachingMaterials.title} LIKE ${like} OR ${teachingMaterials.description} LIKE ${like} OR ${teachingMaterials.textContent} LIKE ${like})`
    );
  }
  // Projection：明確列欄位、不抓 textContent / fileKey，避免把整篇逐字稿
  // 透過 list / search 拉回前端（卡片 UI 用不到，且檔案路徑屬內部 metadata）。
  const baseQuery = db
    .select(TEACHING_MATERIAL_SUMMARY_COLUMNS)
    .from(teachingMaterials)
    .where(and(...conditions))
    .orderBy(
      desc(teachingMaterials.isFeatured),
      desc(teachingMaterials.sortOrder),
      desc(teachingMaterials.createdAt)
    );
  if (scope.limit !== undefined) {
    return baseQuery.limit(scope.limit);
  }
  return baseQuery;
}

/**
 * 給 AI 助理 / search 端點用的「完整 row + 限筆數」版本。跟
 * listTeachingMaterialsForUser 同樣的 visibility 規則，但保留 textContent
 * 讓 buildSnippet 能截出引言句。LIMIT 一定要下，否則命中常見字串時可能
 * 把整個資料庫的逐字稿都拉回來。
 */
export async function searchTeachingMaterialsForUser(
  userId: number,
  filters: TeachingMaterialListFilters,
  scope: { teamIds?: number[]; limit: number }
): Promise<TeachingMaterial[]> {
  const db = await getDb();
  if (!db) return [];

  const myTeamIds = scope.teamIds ?? [];
  const visibilityClauses = [eq(teachingMaterials.userId, userId)];
  if (myTeamIds.length > 0) {
    visibilityClauses.push(
      and(
        eq(teachingMaterials.visibility, "team_shared"),
        inArray(teachingMaterials.teamId, myTeamIds)
      )!
    );
  }
  visibilityClauses.push(eq(teachingMaterials.visibility, "public_disciples"));
  const visibilityOr = or(...visibilityClauses)!;

  const conditions = [visibilityOr];
  if (filters.mediaType) {
    conditions.push(eq(teachingMaterials.mediaType, filters.mediaType));
  }
  if (filters.sourceType) {
    conditions.push(eq(teachingMaterials.sourceType, filters.sourceType));
  }
  if (filters.lineage) {
    conditions.push(eq(teachingMaterials.lineage, filters.lineage));
  }
  if (filters.topic) {
    conditions.push(eq(teachingMaterials.topic, filters.topic));
  }
  if (filters.search) {
    const like = `%${escapeLikePattern(filters.search)}%`;
    conditions.push(
      sql`(${teachingMaterials.title} LIKE ${like} OR ${teachingMaterials.description} LIKE ${like} OR ${teachingMaterials.textContent} LIKE ${like})`
    );
  }

  return db
    .select()
    .from(teachingMaterials)
    .where(and(...conditions))
    .orderBy(
      desc(teachingMaterials.isFeatured),
      desc(teachingMaterials.sortOrder),
      desc(teachingMaterials.createdAt)
    )
    .limit(scope.limit);
}

/**
 * @deprecated 改用 `listTeachingMaterialsForUser`，會自動帶上團隊與
 * public_disciples 的 visibility 規則。保留是因為現有測試還在引用，
 * 行為等同於 only=mine。
 */
export async function listTeachingMaterialsByUser(
  userId: number,
  filters: TeachingMaterialListFilters = {}
): Promise<TeachingMaterialSummary[]> {
  return listTeachingMaterialsForUser(userId, filters, { only: "mine" });
}

/**
 * 給「向量搜尋拿到 ids 後回查」用的批次取得。同樣套 visibility 規則，
 * 確保 RAG 結果不會洩漏使用者本來看不到的素材。
 */
export async function getVisibleTeachingMaterialsByIds(
  userId: number,
  ids: number[],
  teamIds: number[] = []
): Promise<TeachingMaterial[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) return [];

  const visibilityClauses = [eq(teachingMaterials.userId, userId)];
  if (teamIds.length > 0) {
    visibilityClauses.push(
      and(
        eq(teachingMaterials.visibility, "team_shared"),
        inArray(teachingMaterials.teamId, teamIds)
      )!
    );
  }
  visibilityClauses.push(eq(teachingMaterials.visibility, "public_disciples"));
  const visibilityOr = or(...visibilityClauses)!;

  return db
    .select()
    .from(teachingMaterials)
    .where(and(inArray(teachingMaterials.id, ids), visibilityOr));
}

export async function updateTeachingMaterial(
  id: number,
  data: Partial<InsertTeachingMaterial>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(teachingMaterials)
    .set(data)
    .where(eq(teachingMaterials.id, id));
}

export async function deleteTeachingMaterial(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(teachingMaterials).where(eq(teachingMaterials.id, id));
}

/** 取得使用者所有教材中出現過的 distinct lineage 值，給前端下拉選單使用。 */
/**
 * 共用的 visibility 限制：跟 listTeachingMaterialsForUser 用一樣的條件，
 * 讓 distinct facets（lineages / topics）跟列表結果集對齊。
 */
function visibilityScopedTeachingMaterialsClause(
  userId: number,
  teamIds: number[]
) {
  const ors = [eq(teachingMaterials.userId, userId)];
  if (teamIds.length > 0) {
    ors.push(
      and(
        eq(teachingMaterials.visibility, "team_shared"),
        inArray(teachingMaterials.teamId, teamIds)
      )!
    );
  }
  ors.push(eq(teachingMaterials.visibility, "public_disciples"));
  return ors.length === 1 ? ors[0] : or(...ors)!;
}

export async function listTeachingMaterialLineages(
  userId: number,
  teamIds: number[] = []
): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .selectDistinct({ lineage: teachingMaterials.lineage })
    .from(teachingMaterials)
    .where(visibilityScopedTeachingMaterialsClause(userId, teamIds));
  return rows
    .map(r => r.lineage)
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .sort();
}

/** 取得使用者可見的所有教材中出現過的 distinct topic 值，給前端下拉選單使用。 */
export async function listTeachingMaterialTopics(
  userId: number,
  teamIds: number[] = []
): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .selectDistinct({ topic: teachingMaterials.topic })
    .from(teachingMaterials)
    .where(visibilityScopedTeachingMaterialsClause(userId, teamIds));
  return rows
    .map(r => r.topic)
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .sort();
}

// ─── Teams（0051）─────────────────────────────────────────────────────────

export async function createTeam(data: InsertTeam): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(teams).values(data);
  return result[0].insertId;
}

export async function getTeam(id: number): Promise<Team | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(teams).where(eq(teams.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateTeam(id: number, data: Partial<InsertTeam>) {
  const db = await getDb();
  if (!db) return;
  await db.update(teams).set(data).where(eq(teams.id, id));
}

export async function deleteTeam(id: number) {
  const db = await getDb();
  if (!db) return;
  // AIDV-629: 三步包進 transaction，部分失敗全回滾，不留孤兒 membership 或脫鉤素材。
  // 順序：先退材料 teamId → 再刪 membership → 再刪 team row（素材保留，無 FK CASCADE）。
  await db.transaction(async (tx) => {
    await tx
      .update(teachingMaterials)
      .set({ teamId: null, visibility: "private" })
      .where(eq(teachingMaterials.teamId, id));
    await tx.delete(teamMemberships).where(eq(teamMemberships.teamId, id));
    await tx.delete(teams).where(eq(teams.id, id));
  });
}

/** 列出 user 加入的所有團隊（含 owner 自己建的）。 */
export async function listTeamsForUser(
  userId: number
): Promise<Array<Team & { role: TeamMembership["role"] }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: teams.id,
      name: teams.name,
      description: teams.description,
      ownerId: teams.ownerId,
      createdAt: teams.createdAt,
      updatedAt: teams.updatedAt,
      role: teamMemberships.role,
    })
    .from(teamMemberships)
    .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
    .where(eq(teamMemberships.userId, userId))
    .orderBy(desc(teams.createdAt));
  return rows;
}

/** 列出 user 加入的所有 team IDs（給 listTeachingMaterialsForUser 用）。 */
export async function listTeamIdsForUser(userId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ teamId: teamMemberships.teamId })
    .from(teamMemberships)
    .where(eq(teamMemberships.userId, userId));
  return rows.map(r => r.teamId);
}

export async function addTeamMember(
  data: InsertTeamMembership
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(teamMemberships).values(data);
  return result[0].insertId;
}

/** AIDV-629: createTeam + addTeamMember (owner) 包進單一 transaction。
 *  addTeamMember 失敗時整個 team row 一起回滾，不留沒成員的孤兒 team。 */
export async function createTeamWithOwner(data: InsertTeam): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async (tx) => {
    const [{ insertId: teamId }] = await tx.insert(teams).values(data);
    await tx.insert(teamMemberships).values({
      teamId,
      userId: data.ownerId,
      role: "owner",
      invitedBy: data.ownerId,
    });
    return teamId;
  });
}

export async function removeTeamMember(teamId: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(teamMemberships)
    .where(
      and(
        eq(teamMemberships.teamId, teamId),
        eq(teamMemberships.userId, userId)
      )
    );
}

export async function getTeamMembership(
  teamId: number,
  userId: number
): Promise<TeamMembership | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.teamId, teamId),
        eq(teamMemberships.userId, userId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listTeamMembers(
  teamId: number
): Promise<TeamMembership[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(teamMemberships)
    .where(eq(teamMemberships.teamId, teamId))
    .orderBy(teamMemberships.joinedAt);
}

export async function updateTeamMemberRole(
  teamId: number,
  userId: number,
  newRole: "owner" | "admin" | "member"
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(teamMemberships)
    .set({ role: newRole })
    .where(
      and(
        eq(teamMemberships.teamId, teamId),
        eq(teamMemberships.userId, userId)
      )
    );
}

/** 原子化轉移 owner：同一 tx 內更新 teams.ownerId + 新 owner 升為 owner + 舊 owner 降為 member。 */
export async function transferTeamOwnership(
  teamId: number,
  oldOwnerId: number,
  newOwnerId: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.transaction(async (tx) => {
    await tx
      .update(teams)
      .set({ ownerId: newOwnerId })
      .where(and(eq(teams.id, teamId), eq(teams.ownerId, oldOwnerId)));

    await tx
      .update(teamMemberships)
      .set({ role: "owner" })
      .where(
        and(
          eq(teamMemberships.teamId, teamId),
          eq(teamMemberships.userId, newOwnerId)
        )
      );

    await tx
      .update(teamMemberships)
      .set({ role: "member" })
      .where(
        and(
          eq(teamMemberships.teamId, teamId),
          eq(teamMemberships.userId, oldOwnerId)
        )
      );
  });
}

// ─── Resource shares — 顯式共享 SSOT（AIDV-121 RBAC）─────────────────────────
//
// 純 CRUD helper，全部 demo/無 DB 安全（getDb()===null 時讀回空、寫 throw）。
// canAccess 的「使用者側事實」由 resourceAccessResolver.ts 用這些 helper 組裝。

type ResourceShareType = ResourceShare["resourceType"];
type ResourceShareWith = ResourceShare["sharedWithType"];
type ResourceShareRole = ResourceShare["role"];

/** 列出某資源被分享給誰（資源 owner 的「共享管理」面板用）。 */
export async function listSharesForResource(
  resourceType: ResourceShareType,
  resourceId: number
): Promise<ResourceShare[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(resourceShares)
    .where(
      and(
        eq(resourceShares.resourceType, resourceType),
        eq(resourceShares.resourceId, resourceId)
      )
    )
    .orderBy(desc(resourceShares.createdAt));
}

/**
 * 取某使用者對「某資源」命中的所有顯式共享記錄（user 直接共享 + 其所屬 team
 * 共享）。canAccess resolver 會把這些合併取最高權限。
 */
export async function getSharesForUserOnResource(
  resourceType: ResourceShareType,
  resourceId: number,
  userId: number,
  userTeamIds: number[]
): Promise<ResourceShare[]> {
  const db = await getDb();
  if (!db) return [];
  const targetConds = [
    and(
      eq(resourceShares.sharedWithType, "user"),
      eq(resourceShares.sharedWithId, userId)
    ),
  ];
  if (userTeamIds.length > 0) {
    targetConds.push(
      and(
        eq(resourceShares.sharedWithType, "team"),
        inArray(resourceShares.sharedWithId, userTeamIds)
      )
    );
  }
  return db
    .select()
    .from(resourceShares)
    .where(
      and(
        eq(resourceShares.resourceType, resourceType),
        eq(resourceShares.resourceId, resourceId),
        or(...targetConds)
      )
    );
}

/** AIDV-651: 批次版 getSharesForUserOnResource，一次查詢多個 resourceId。
 *  回傳 Map<resourceId, ResourceShare[]>，未命中的 id 不在 map 內（視為 []）。 */
export async function getSharesForUserOnManyResources(
  resourceType: ResourceShareType,
  resourceIds: number[],
  userId: number,
  userTeamIds: number[]
): Promise<Map<number, ResourceShare[]>> {
  const db = await getDb();
  const out = new Map<number, ResourceShare[]>();
  if (!db || resourceIds.length === 0) return out;
  const targetConds = [
    and(
      eq(resourceShares.sharedWithType, "user"),
      eq(resourceShares.sharedWithId, userId)
    ),
  ];
  if (userTeamIds.length > 0) {
    targetConds.push(
      and(
        eq(resourceShares.sharedWithType, "team"),
        inArray(resourceShares.sharedWithId, userTeamIds)
      )
    );
  }
  const rows = await db
    .select()
    .from(resourceShares)
    .where(
      and(
        eq(resourceShares.resourceType, resourceType),
        inArray(resourceShares.resourceId, resourceIds),
        or(...targetConds)
      )
    );
  for (const row of rows) {
    const list = out.get(row.resourceId) ?? [];
    list.push(row);
    out.set(row.resourceId, list);
  }
  return out;
}

/**
 * 列出某使用者（含其團隊）被顯式共享的「某型別資源 id 集合」。清單過濾用
 * （旗標 ON 時：A 的清單 = 自己的 ∪ 被共享給 A 的）。
 */
export async function listSharedResourceIdsForUser(
  resourceType: ResourceShareType,
  userId: number,
  userTeamIds: number[]
): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const targetConds = [
    and(
      eq(resourceShares.sharedWithType, "user"),
      eq(resourceShares.sharedWithId, userId)
    ),
  ];
  if (userTeamIds.length > 0) {
    targetConds.push(
      and(
        eq(resourceShares.sharedWithType, "team"),
        inArray(resourceShares.sharedWithId, userTeamIds)
      )
    );
  }
  const rows = await db
    .select({ resourceId: resourceShares.resourceId })
    .from(resourceShares)
    .where(
      and(eq(resourceShares.resourceType, resourceType), or(...targetConds))
    );
  return [...new Set(rows.map(r => r.resourceId))];
}

/**
 * 建立或更新一筆共享（同一對象對同一資源 upsert role）。回傳影響筆數無意義，
 * 用 unique key 衝突即更新 role。
 */
export async function upsertResourceShare(
  data: InsertResourceShare
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .insert(resourceShares)
    .values(data)
    .onDuplicateKeyUpdate({
      set: { role: data.role, sharedByUserId: data.sharedByUserId },
    });
}

/** 撤銷一筆共享（依資源 + 對象）。找不到視為 no-op。 */
export async function revokeResourceShare(
  resourceType: ResourceShareType,
  resourceId: number,
  sharedWithType: ResourceShareWith,
  sharedWithId: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(resourceShares)
    .where(
      and(
        eq(resourceShares.resourceType, resourceType),
        eq(resourceShares.resourceId, resourceId),
        eq(resourceShares.sharedWithType, sharedWithType),
        eq(resourceShares.sharedWithId, sharedWithId)
      )
    );
}

/** 刪除某資源的全部共享記錄（資源被刪除 / 移轉清理時用，避免孤兒）。 */
export async function deleteAllSharesForResource(
  resourceType: ResourceShareType,
  resourceId: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(resourceShares)
    .where(
      and(
        eq(resourceShares.resourceType, resourceType),
        eq(resourceShares.resourceId, resourceId)
      )
    );
}

/** 移轉某資源擁有權（更新 owner 欄位）。各資源表 owner 欄位皆為 userId。 */
export async function transferResourceOwnership(
  resourceType: ResourceShareType,
  resourceId: number,
  newOwnerUserId: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  switch (resourceType) {
    case "project":
      await db
        .update(creativeProjects)
        .set({ userId: newOwnerUserId })
        .where(eq(creativeProjects.id, resourceId));
      return;
    case "asset":
      await db
        .update(digitalAssetLibrary)
        .set({ userId: newOwnerUserId })
        .where(eq(digitalAssetLibrary.id, resourceId));
      return;
    case "prompt":
      await db
        .update(promptLibrary)
        .set({ userId: newOwnerUserId })
        .where(eq(promptLibrary.id, resourceId));
      return;
    case "material":
      await db
        .update(teachingMaterials)
        .set({ userId: newOwnerUserId })
        .where(eq(teachingMaterials.id, resourceId));
      return;
    default: {
      const _exhaustive: never = resourceType;
      throw new Error(`未知資源型別: ${String(_exhaustive)}`);
    }
  }
}

/**
 * 讀某資源的 owner facts（{ ownerId, visibility, teamId }），給 canAccess /
 * share/transfer 的擁有權驗證用。找不到回 null。不同資源表欄位略異，這裡
 * 投影成統一形狀（沒有 visibility/teamId 的型別回 null）。
 */
export async function getResourceOwnerFacts(
  resourceType: ResourceShareType,
  resourceId: number
): Promise<{ ownerId: number; visibility: string | null; teamId: number | null } | null> {
  const db = await getDb();
  if (!db) return null;
  switch (resourceType) {
    case "project": {
      const rows = await db
        .select({ ownerId: creativeProjects.userId })
        .from(creativeProjects)
        .where(eq(creativeProjects.id, resourceId))
        .limit(1);
      return rows[0]
        ? { ownerId: rows[0].ownerId, visibility: null, teamId: null }
        : null;
    }
    case "asset": {
      const rows = await db
        .select({
          ownerId: digitalAssetLibrary.userId,
          visibility: digitalAssetLibrary.visibility,
        })
        .from(digitalAssetLibrary)
        .where(eq(digitalAssetLibrary.id, resourceId))
        .limit(1);
      return rows[0]
        ? { ownerId: rows[0].ownerId, visibility: rows[0].visibility, teamId: null }
        : null;
    }
    case "prompt": {
      const rows = await db
        .select({ ownerId: promptLibrary.userId })
        .from(promptLibrary)
        .where(eq(promptLibrary.id, resourceId))
        .limit(1);
      return rows[0]
        ? { ownerId: rows[0].ownerId, visibility: null, teamId: null }
        : null;
    }
    case "material": {
      const rows = await db
        .select({
          ownerId: teachingMaterials.userId,
          visibility: teachingMaterials.visibility,
          teamId: teachingMaterials.teamId,
        })
        .from(teachingMaterials)
        .where(eq(teachingMaterials.id, resourceId))
        .limit(1);
      return rows[0]
        ? {
            ownerId: rows[0].ownerId,
            visibility: rows[0].visibility,
            teamId: rows[0].teamId,
          }
        : null;
    }
    default: {
      const _exhaustive: never = resourceType;
      throw new Error(`未知資源型別: ${String(_exhaustive)}`);
    }
  }
}

// ─── Teaching material access — audit log ────────────────────────────────

/**
 * 寫一筆讀取 / 修改的稽核日誌。失敗不會 throw — log 寫不出來不應該擋
 * 真正的業務邏輯。呼叫端用 `.catch(...)` 或 fire-and-forget 即可。
 */
export async function logTeachingMaterialAccess(
  data: InsertTeachingMaterialAccessLog
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(teachingMaterialAccessLog).values(data);
  } catch (err) {
    console.error("[teachingMaterialAccessLog] insert failed:", err);
  }
}

export async function listTeachingMaterialAccessLogs(
  materialId: number,
  limit = 50
): Promise<TeachingMaterialAccessLog[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(teachingMaterialAccessLog)
    .where(eq(teachingMaterialAccessLog.materialId, materialId))
    .orderBy(desc(teachingMaterialAccessLog.createdAt))
    .limit(limit);
}

// ═══════════════════════════════════════════════════════════════════════════
// Real Earth Information System（真實地球資訊系統）
// ═══════════════════════════════════════════════════════════════════════════

export async function getRealEarthEntry(id: number): Promise<RealEarthEntry | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(realEarthEntries)
    .where(eq(realEarthEntries.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getRealEarthEntries(params: {
  category?: string;
  taiwanOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<RealEarthEntry[]> {
  const db = await getDb();
  if (!db) return [];

  let query = db.select().from(realEarthEntries);

  const conditions: any[] = [];
  if (params.category) {
    conditions.push(eq(realEarthEntries.category, params.category as any));
  }
  if (params.taiwanOnly) {
    conditions.push(eq(realEarthEntries.isTaiwanFocused, true));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  query = query
    .orderBy(desc(realEarthEntries.createdAt))
    .limit(params.limit ?? 50)
    .offset(params.offset ?? 0) as any;

  return query;
}

export async function searchRealEarthEntries(params: {
  query?: string;
  categories?: string[];
  regions?: string[];
  historicalPeriods?: string[];
  yearRange?: { start?: number; end?: number };
  tags?: string[];
  taiwanOnly?: boolean;
  minCredibility?: string;
  sortBy?: string;
  limit: number;
  offset: number;
}): Promise<{ rows: RealEarthEntry[]; total: number }> {
  const db = await getDb();
  if (!db) return { rows: [], total: 0 };

  const conditions: any[] = [];

  // 搜尋關鍵字（使用 LIKE）
  if (params.query) {
    const searchTerm = `%${escapeLikePattern(params.query)}%`;
    conditions.push(
      or(
        like(realEarthEntries.title, searchTerm),
        like(realEarthEntries.summary, searchTerm),
        like(realEarthEntries.content, searchTerm)
      )
    );
  }

  // 類別篩選
  if (params.categories && params.categories.length > 0) {
    conditions.push(
      or(...params.categories.map(cat => eq(realEarthEntries.category, cat as any)))
    );
  }

  // 台灣重點資料
  if (params.taiwanOnly) {
    conditions.push(eq(realEarthEntries.isTaiwanFocused, true));
  }

  // 歷史時期篩選
  if (params.historicalPeriods && params.historicalPeriods.length > 0) {
    conditions.push(
      or(...params.historicalPeriods.map(period =>
        eq(realEarthEntries.historicalPeriod, period)
      ))
    );
  }

  // 構建查詢
  let query = db.select().from(realEarthEntries);

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  // 排序
  if (params.sortBy === "date_desc") {
    query = query.orderBy(desc(realEarthEntries.createdAt)) as any;
  } else if (params.sortBy === "date_asc") {
    query = query.orderBy(asc(realEarthEntries.createdAt)) as any;
  } else if (params.sortBy === "title") {
    query = query.orderBy(asc(realEarthEntries.title)) as any;
  } else {
    // 預設相關性排序（創建時間倒序）
    query = query.orderBy(desc(realEarthEntries.createdAt)) as any;
  }

  // 分頁
  const rows = await query.limit(params.limit).offset(params.offset);

  // 計算總數
  const countQuery = db
    .select({ count: sql<number>`count(*)` })
    .from(realEarthEntries);

  const countConditions: any[] = [];
  if (conditions.length > 0) {
    // 重複應用相同的條件
    if (params.query) {
      const searchTerm = `%${escapeLikePattern(params.query)}%`;
      countConditions.push(
        or(
          like(realEarthEntries.title, searchTerm),
          like(realEarthEntries.summary, searchTerm),
          like(realEarthEntries.content, searchTerm)
        )
      );
    }
    if (params.categories && params.categories.length > 0) {
      countConditions.push(
        or(...params.categories.map(cat => eq(realEarthEntries.category, cat as any)))
      );
    }
    if (params.taiwanOnly) {
      countConditions.push(eq(realEarthEntries.isTaiwanFocused, true));
    }
    if (params.historicalPeriods && params.historicalPeriods.length > 0) {
      countConditions.push(
        or(...params.historicalPeriods.map(period =>
          eq(realEarthEntries.historicalPeriod, period)
        ))
      );
    }
  }

  const countResult = await (countConditions.length > 0
    ? countQuery.where(and(...countConditions))
    : countQuery);

  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function createRealEarthEntry(
  data: InsertRealEarthEntry
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(realEarthEntries).values(data);
  return result[0].insertId;
}

export async function updateRealEarthEntry(
  id: number,
  data: Partial<InsertRealEarthEntry>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(realEarthEntries)
    .set(data)
    .where(eq(realEarthEntries.id, id));
}

export async function deleteRealEarthEntry(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(realEarthEntries).where(eq(realEarthEntries.id, id));
}

export async function getRealEarthStats(): Promise<{
  total: number;
  taiwanFocused: number;
  byCategory: Record<string, number>;
}> {
  const db = await getDb();
  if (!db) return { total: 0, taiwanFocused: 0, byCategory: {} };

  // 總數
  const totalResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(realEarthEntries);
  const total = totalResult[0]?.count ?? 0;

  // 台灣重點資料數
  const taiwanResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(realEarthEntries)
    .where(eq(realEarthEntries.isTaiwanFocused, true));
  const taiwanFocused = taiwanResult[0]?.count ?? 0;

  // 按類別統計
  const categoryResult = await db
    .select({
      category: realEarthEntries.category,
      count: sql<number>`count(*)`,
    })
    .from(realEarthEntries)
    .groupBy(realEarthEntries.category);

  const byCategory: Record<string, number> = {};
  for (const row of categoryResult) {
    byCategory[row.category] = row.count;
  }

  return { total, taiwanFocused, byCategory };
}

export async function findSimilarRealEarthEntries(params: {
  excludeId: number;
  category: string;
  tags: string[];
  limit: number;
}): Promise<RealEarthEntry[]> {
  const db = await getDb();
  if (!db) return [];

  // 查找相同類別的條目
  const rows = await db
    .select()
    .from(realEarthEntries)
    .where(
      and(
        eq(realEarthEntries.category, params.category as any),
        ne(realEarthEntries.id, params.excludeId)
      )
    )
    .orderBy(desc(realEarthEntries.createdAt))
    .limit(params.limit);

  return rows;
}

/**
 * 根據真實地球條目 ID 查找關聯的教材
 */
export async function findTeachingMaterialsByRealEarthRef(
  realEarthId: number
): Promise<TeachingMaterial[]> {
  const db = await getDb();
  if (!db) return [];

  // 使用 JSON_CONTAINS 查詢包含特定 ID 的教材
  const rows = await db
    .select()
    .from(teachingMaterials)
    .where(
      sql`JSON_CONTAINS(${teachingMaterials.realEarthRefs}, ${JSON.stringify(realEarthId)})`
    )
    .orderBy(desc(teachingMaterials.createdAt));

  return rows;
}

// ─── Refresh Tokens (AIDV-230) ─────────────────────────────────────────────

export async function insertRefreshToken(data: {
  tokenHash: string;
  userId: number;
  expiresAt: Date;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(refreshTokens).values({
    tokenHash: data.tokenHash,
    userId: data.userId,
    status: "active",
    expiresAt: data.expiresAt,
  });
}

export async function revokeRefreshToken(tokenHash: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(refreshTokens)
    .set({ status: "revoked" })
    .where(eq(refreshTokens.tokenHash, tokenHash));
}

export async function revokeAllUserRefreshTokens(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(refreshTokens)
    .set({ status: "revoked" })
    .where(
      and(
        eq(refreshTokens.userId, userId),
        eq(refreshTokens.status, "active")
      )
    );
}

/** Returns true if the token exists and is active (not revoked, not expired). */
export async function isRefreshTokenActive(tokenHash: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return true; // fail-open when DB unavailable so we don't lock everyone out
  const rows = await db
    .select({ status: refreshTokens.status, expiresAt: refreshTokens.expiresAt })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  if (rows.length === 0) return false;
  const row = rows[0];
  if (row.status !== "active") return false;
  if (row.expiresAt < new Date()) return false;
  return true;
}

export type { RefreshToken };

// ─── User Workflows (AIDV-43) ──────────────────────────────────────────────

export async function getUserWorkflow(userId: number): Promise<UserWorkflow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(userWorkflows)
    .where(eq(userWorkflows.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertUserWorkflow(
  userId: number,
  stepsJson: InsertUserWorkflow["stepsJson"]
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(userWorkflows)
    .values({ userId, stepsJson })
    .onDuplicateKeyUpdate({ set: { stepsJson, updatedAt: new Date() } });
}

export type { UserWorkflow };

// ─── Account Deletion (AIDV-63) ────────────────────────────────────────────

// Tables that carry personal data and must be wiped before (or alongside)
// the users row. Order does not matter because we disable FK checks for the
// duration of the transaction; the list covers every table with a userId FK.
const USER_OWNED_TABLES = [
  "login_history",
  "agent_preferences",
  "orb_scheduled_jobs",
  "password_reset_tokens",
  "email_verification_tokens",
  "background_jobs",
  "digital_asset_library",
  "fine_tuned_models",
  "project_notes_calendar",
  "user_google_oauth_tokens",
  "drive_asset_libraries",
  "user_feedback_reports",
  "api_usage_logs",
  "ai_director_preferences",
  "specialized_agent_memory",
  "specialized_agent_interactions",
  "agent_model_picks",
  "generation_history",
  "custom_blocks",
  "block_combos",
  "system_settings",
  "user_ai_brain",
  "user_model_switch_logs",
  "custom_blocks_combo",
  "prompt_library",
  "prompt_assets",
  "prompt_collection",
  "external_service_subscriptions",
  "user_subscriptions",
  "orb_feedback_events",
  "ai_usage_events",
  "cost_aggregations",
  "cost_ledger",
  "cost_attribution_outbox",
  "alert_configs",
  "model_training_consents",
  "fine_tuned_model_consents",
  "agent_collaboration_sessions",
  "orb_conversations",
  "orb_long_term_memories",
  "orb_intent_logs",
  "orb_clarification_history",
  "orb_user_answer_patterns",
  "orb_feature_usage_stats",
  "orb_feature_discovery_paths",
  "orb_feature_recommendations",
  "orb_workflow_executions",
  "orb_spirit_collaboration_metrics",
  "orb_cost_attribution",
  "orb_system_alerts",
  "worldbuilding_frameworks",
  "world_storyboards",
  "creative_projects",
  "orchestration_runs",
  "context_packets",
  "data_source_connections",
  "team_memberships",
  "real_earth_entries",
  "refresh_tokens",
  "user_workflows",
  "studio_recipes",
] as const;

/**
 * Hard-delete a user and all their personal data (GDPR right to erasure).
 *
 * Disables FK checks for the duration of the transaction so children can be
 * deleted in any order and so the users row itself can be removed without
 * having to enumerate every possible child relationship first.
 */
export async function deleteUserAccount(userId: number): Promise<void> {
  const manager = getDatabaseManager();
  await manager.executeTransaction(async (conn) => {
    // Disable FK checks for this connection only
    await conn.execute("SET FOREIGN_KEY_CHECKS = 0");
    try {
      // Delete personal data from every owned table
      for (const table of USER_OWNED_TABLES) {
        await conn.execute(`DELETE FROM \`${table}\` WHERE userId = ?`, [userId]);
      }
      // Delete the user row itself
      await conn.execute("DELETE FROM users WHERE id = ?", [userId]);
    } finally {
      await conn.execute("SET FOREIGN_KEY_CHECKS = 1");
    }
  });
}

// ─── Data Export (AIDV-63) ─────────────────────────────────────────────────

/**
 * Collect the user's personal data for a GDPR data-export download.
 * Returns a plain object that can be serialised to JSON.
 */
export async function exportUserData(userId: number): Promise<Record<string, unknown>> {
  const drizzleDb = await getDb();
  if (!drizzleDb) return { error: "database_unavailable" };

  const [profileRows, generationRows, loginRows, assetRows] = await Promise.all([
    drizzleDb
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        loginMethod: users.loginMethod,
        role: users.role,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        lastSignedIn: users.lastSignedIn,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),

    drizzleDb
      .select({
        id: generationHistory.id,
        modality: generationHistory.modality,
        prompt: generationHistory.prompt,
        createdAt: generationHistory.createdAt,
      })
      .from(generationHistory)
      .where(eq(generationHistory.userId, userId))
      .orderBy(desc(generationHistory.createdAt))
      .limit(200),

    drizzleDb
      .select({
        success: loginHistory.success,
        ipAddress: loginHistory.ipAddress,
        device: loginHistory.device,
        browser: loginHistory.browser,
        os: loginHistory.os,
        createdAt: loginHistory.createdAt,
      })
      .from(loginHistory)
      .where(eq(loginHistory.userId, userId))
      .orderBy(desc(loginHistory.createdAt))
      .limit(100),

    drizzleDb
      .select({ id: digitalAssetLibrary.id, title: digitalAssetLibrary.title, createdAt: digitalAssetLibrary.createdAt })
      .from(digitalAssetLibrary)
      .where(eq(digitalAssetLibrary.userId, userId))
      .orderBy(desc(digitalAssetLibrary.createdAt))
      .limit(200),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    profile: profileRows[0] ?? null,
    generations: generationRows,
    loginHistory: loginRows,
    assets: assetRows,
  };
}

// ─── Video Projects (AIDV-252) ─────────────────────────────────────────────────

export async function createVideoProject(data: InsertVideoProject): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(videoProjects).values(data);
  return result[0].insertId;
}

export async function getVideoProject(id: number): Promise<VideoProject | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(videoProjects)
    .where(eq(videoProjects.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getVideoProjectsByUser(userId: number): Promise<VideoProject[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(videoProjects)
    .where(eq(videoProjects.userId, userId))
    .orderBy(desc(videoProjects.updatedAt));
}

/**
 * AIDV-307：跳脫 MySQL LIKE 萬用字元（`%` `_` `\`），讓使用者輸入只做「字面包含」搭配，
 * 不會被當成萬用字元（例如搜尋「%」時不該命中全部）。SQL 注入由 drizzle 參數化負責，
 * 此處僅處理萬用字元語意。
 */
export function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, ch => `\\${ch}`);
}

export interface VideoProjectsPage {
  items: VideoProject[];
  /** 下一頁游標（最後一筆 id）；無更多資料時為 null。 */
  nextCursor: number | null;
}

/**
 * AIDV-307：純函式 — 從「多取一筆」的查詢結果切出本頁與 nextCursor。
 * 抽出便於單元測試邊界（剛好 limit 筆 / 多一筆 / 空）。
 */
export function sliceVideoProjectsPage(
  rows: VideoProject[],
  limit: number,
): VideoProjectsPage {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]!.id : null;
  return { items, nextCursor };
}

/**
 * AIDV-307：游標分頁版的使用者影片專案列表。
 * - 以 `id` 遞減排序（id 為 autoincrement，等同建立順序「最新在前」且穩定唯一，適合做游標）。
 * - `cursor` 帶上一頁最後一筆 id，回傳 `id < cursor` 的下一批，避免 offset 漂移。
 * - `search` 對 title 做字面包含（萬用字元已跳脫）。
 * - 多取一筆判斷是否還有下一頁，回傳 nextCursor。
 */
export async function getVideoProjectsByUserPaged(opts: {
  userId: number;
  limit: number;
  cursor?: number | null;
  search?: string | null;
}): Promise<VideoProjectsPage> {
  const db = await getDb();
  if (!db) return { items: [], nextCursor: null };

  const conditions: SQL[] = [eq(videoProjects.userId, opts.userId)];
  if (opts.cursor != null) conditions.push(lt(videoProjects.id, opts.cursor));
  const trimmed = opts.search?.trim();
  if (trimmed) {
    conditions.push(like(videoProjects.title, `%${escapeLikePattern(trimmed)}%`));
  }

  const rows = await db
    .select()
    .from(videoProjects)
    .where(and(...conditions))
    .orderBy(desc(videoProjects.id))
    .limit(opts.limit + 1);

  return sliceVideoProjectsPage(rows, opts.limit);
}

export async function updateVideoProject(
  id: number,
  data: Partial<InsertVideoProject>,
  opts?: { expectedVersion?: number }
): Promise<{ updated: boolean }> {
  const db = await getDb();
  if (!db) return { updated: false };
  const setData = { ...data, version: sql`\`version\` + 1` };
  const whereClause =
    opts?.expectedVersion !== undefined
      ? and(eq(videoProjects.id, id), eq(videoProjects.version, opts.expectedVersion))
      : eq(videoProjects.id, id);
  const result = await db.update(videoProjects).set(setData).where(whereClause);
  const affected = (result as unknown as { affectedRows: number }).affectedRows;
  return { updated: affected > 0 };
}

// ─── Project Snapshots (AIDV-253) ─────────────────────────────────────────────

export async function createProjectSnapshot(
  projectId: number,
  snapshot: Record<string, unknown>,
  // `source` 對應 projectSnapshots.source（varchar(20) 自由字串）。慣用值
  // "auto"/"manual"/"pre-restore"，AIDV-345 代理稽核另帶 `agent:<id>`。注意：呼叫端
  // 以模板字串組成的值型別為 string（非 `agent:${string}` 字面型別），故參數放寬為
  // string 才能接受；欄位本即自由字串、無 enum 約束。 — AIDV-345 tsc 紅燈最小修補
  source: string = "auto"
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projectSnapshots).values({ projectId, snapshot, source });
  return result[0].insertId;
}

export async function listProjectSnapshots(
  projectId: number,
  limit = 10
): Promise<ProjectSnapshot[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(projectSnapshots)
    .where(eq(projectSnapshots.projectId, projectId))
    .orderBy(desc(projectSnapshots.createdAt))
    .limit(limit);
}

export async function getProjectSnapshot(id: number): Promise<ProjectSnapshot | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(projectSnapshots)
    .where(eq(projectSnapshots.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function duplicateVideoProject(
  sourceId: number,
  userId: number,
  newTitle?: string
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const source = await getVideoProject(sourceId);
  if (!source) throw new Error("Source project not found");
  const result = await db.insert(videoProjects).values({
    userId,
    title: newTitle ?? `${source.title} (複本)`,
    aspectRatio: source.aspectRatio,
    outputSpec: source.outputSpec ?? undefined,
    creativeProjectId: source.creativeProjectId ?? undefined,
    version: 0,
  });
  return result[0].insertId;
}
