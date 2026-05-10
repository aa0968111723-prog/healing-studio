import { sql } from "drizzle-orm";

// Add orbMemorySummary TEXT column to the users table so that the Drizzle ORM
// schema definition is in sync with the database, preventing
// ER_BAD_FIELD_ERROR (1054) during OAuth user upsert operations.
export const up = sql`
SET @db := DATABASE();

SET @stmt := IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'users' AND column_name = 'orbMemorySummary'),
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN orbMemorySummary TEXT NULL DEFAULT NULL'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;
`;
