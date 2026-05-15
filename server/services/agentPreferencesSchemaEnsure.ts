/**
 * agentPreferencesSchemaEnsure — single source of truth for the runtime
 * ALTER TABLE backfill on `agent_preferences`.
 * ────────────────────────────────────────────────────────────────────────────
 * The settings router (`agentPreferencesRouter.updatePreferences`) and the
 * AI-agent runtime loader (`agentPreferenceService.loadAgentPreferencesForUser`)
 * both read the table via `db.select().from(agentPreferences)`. Drizzle
 * derives the column list from `drizzle/schema.ts`, so any column declared
 * there must exist in the DB or the SELECT throws `ER_BAD_FIELD_ERROR`.
 *
 * Migrations under `drizzle/*.sql` are the durable fix, but environments
 * that deploy schema.ts ahead of the migration (or where the migration
 * runner is disabled) still need a runtime fallback. Previously that
 * fallback lived inside the settings router only, which meant the AI-agent
 * runtime path silently swallowed the missing-column error and returned
 * DEFAULT_AGENT_PREFERENCES — drifting the planner from whatever the user
 * thought they had saved.
 *
 * Centralising the ALTER list here lets every caller self-heal once, with
 * a module-scoped promise cache so concurrent callers piggy-back on the
 * same in-flight migration.
 */

import { sql } from "drizzle-orm";
import type { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

let ensureSchemaOnce: Promise<void> | null = null;

/**
 * Best-effort: idempotently add the agent_preferences columns that were
 * introduced after the checked-in `0032_agent_preferences_specialist_columns`
 * migration. Resolves once per process on success; on failure it nulls
 * the cache so the next caller retries (e.g. transient connection
 * blip, lock wait).
 *
 * Callers should treat a thrown error as advisory — log + continue. The
 * actual SELECT/UPDATE that follows is what reports the real problem to
 * the user (missing column = clear "Unknown column 'x'" error).
 */
export function ensureAgentPreferencesSchema(db: Db): Promise<void> {
  if (ensureSchemaOnce) return ensureSchemaOnce;
  ensureSchemaOnce = (async () => {
    const addColumnIfMissing = async (
      columnName: string,
      definitionSql: string,
    ) => {
      const existsRows = (await db.execute(sql`
        SELECT EXISTS(
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = DATABASE()
            AND LOWER(table_name) = LOWER('agent_preferences')
            AND LOWER(column_name) = LOWER(${columnName})
        ) AS existsFlag
      `)) as unknown as Array<{ existsFlag: number }>;
      const existsFlag = Number(existsRows[0]?.existsFlag ?? 0);
      if (existsFlag === 1) return;
      try {
        await db.execute(
          sql.raw(`ALTER TABLE agent_preferences ADD COLUMN ${definitionSql}`),
        );
      } catch (err) {
        // TOCTOU: another process can have added the column between our
        // SELECT and the ALTER. MySQL surfaces that as ER_DUP_FIELDNAME
        // (1060) or SQLSTATE 42S21; some drivers wrap the error and lose
        // the code/errno fields, so we also fall back to the canonical
        // "Duplicate column name" message match. Treat any of these as
        // success — the column exists, which is what we wanted.
        const code = (err as { code?: string } | null)?.code ?? "";
        const errno = Number((err as { errno?: number } | null)?.errno ?? 0);
        const sqlState = (err as { sqlState?: string } | null)?.sqlState ?? "";
        const message = err instanceof Error ? err.message : String(err);
        if (
          code === "ER_DUP_FIELDNAME" ||
          errno === 1060 ||
          sqlState === "42S21" ||
          /duplicate column/i.test(message)
        ) {
          return;
        }
        throw err;
      }
    };

    // Order matches drizzle/schema.ts so a fresh DB ends up with columns
    // appended in the same sequence as the declared type. Anything added
    // here MUST also be present in a checked-in drizzle/*.sql migration.
    await addColumnIfMissing(
      "preferredSpecialistAgent",
      "preferredSpecialistAgent varchar(64) NULL",
    );
    await addColumnIfMissing(
      "specialistAutoActivate",
      "specialistAutoActivate boolean NOT NULL DEFAULT true",
    );
    await addColumnIfMissing(
      "specialistProactiveMode",
      "specialistProactiveMode boolean NOT NULL DEFAULT true",
    );
    await addColumnIfMissing(
      "specialistLearningEnabled",
      "specialistLearningEnabled boolean NOT NULL DEFAULT true",
    );
    await addColumnIfMissing(
      "disabledSpecialistAgents",
      "disabledSpecialistAgents json NOT NULL",
    );
    // 15 精靈關係偏好 (drizzle/0046_*.sql backfills these in deploys).
    await addColumnIfMissing("mutedSpirits", "mutedSpirits json NULL");
    await addColumnIfMissing("favoriteSpirits", "favoriteSpirits json NULL");
    // Phase 3: stay-on-page execution mode (drizzle/0046_*.sql).
    await addColumnIfMissing(
      "stayOnPageMode",
      "stayOnPageMode boolean NOT NULL DEFAULT false",
    );
    // Per-event 主動精靈通知偏好 (drizzle/0046_*.sql).
    await addColumnIfMissing(
      "proactiveTriggerSettings",
      "proactiveTriggerSettings json NULL",
    );

    // Backfill NULL → empty JSON so callers never see `null` for a column
    // typed as Array / Record. Cheap (single UPDATE per column), and
    // idempotent — a no-op once the rows are filled in.
    await db.execute(sql`
      UPDATE agent_preferences
      SET disabledSpecialistAgents = JSON_ARRAY()
      WHERE disabledSpecialistAgents IS NULL
    `);
    await db.execute(sql`
      UPDATE agent_preferences
      SET mutedSpirits = JSON_ARRAY()
      WHERE mutedSpirits IS NULL
    `);
    await db.execute(sql`
      UPDATE agent_preferences
      SET favoriteSpirits = JSON_ARRAY()
      WHERE favoriteSpirits IS NULL
    `);
    await db.execute(sql`
      UPDATE agent_preferences
      SET proactiveTriggerSettings = JSON_OBJECT()
      WHERE proactiveTriggerSettings IS NULL
    `);
  })().catch(err => {
    ensureSchemaOnce = null;
    throw err;
  });
  return ensureSchemaOnce;
}

/**
 * Test hook — clears the singleton so unit tests can re-trigger the migration.
 * Production code should never call this.
 */
export function __resetAgentPreferencesSchemaCacheForTests(): void {
  ensureSchemaOnce = null;
}

/**
 * Detect the "Unknown column" failure pattern that signals a stale schema.
 * Used by callers that want to self-heal once: try → on UnknownColumn,
 * run `ensureAgentPreferencesSchema`, retry once → on second failure,
 * give up and surface the error.
 */
export function isUnknownColumnError(err: unknown): boolean {
  if (!err) return false;
  const code = (err as { code?: string }).code ?? "";
  const errno = Number((err as { errno?: number }).errno ?? 0);
  const sqlState = (err as { sqlState?: string }).sqlState ?? "";
  const message = err instanceof Error ? err.message : String(err);
  return (
    code === "ER_BAD_FIELD_ERROR" ||
    errno === 1054 ||
    sqlState === "42S22" ||
    /unknown column/i.test(message)
  );
}
