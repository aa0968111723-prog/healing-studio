import { sql } from "drizzle-orm";

// Add orbMemorySummary TEXT column to the users table so that the Drizzle ORM
// schema definition is in sync with the database, preventing
// ER_BAD_FIELD_ERROR (1054) during OAuth user upsert operations.
//
// Uses a plain ALTER TABLE statement. Drizzle's `sql` template executes each
// tagged template as a single statement, so PREPARE/EXECUTE blocks are not
// supported here. The column is nullable so re-running on an environment
// where it already exists will produce a benign "Duplicate column" error
// that the migration runner logs and ignores.
export const up = sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS orbMemorySummary TEXT NULL DEFAULT NULL`;
