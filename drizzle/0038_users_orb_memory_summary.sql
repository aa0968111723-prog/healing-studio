-- 0038: Add orbMemorySummary column to users for Orb global condensed memory.
-- MySQL does not support ADD COLUMN IF NOT EXISTS in older versions, so gate with information_schema.
-- Each statement is its own breakpoint because the connection pool does
-- not enable `multipleStatements`; Drizzle's mysql2 migrator runs the
-- whole file in one transaction, so the session-scoped @stmt and
-- prepared statement names persist across breakpoints.
SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'orbMemorySummary'), 'SELECT 1', 'ALTER TABLE `users` ADD COLUMN `orbMemorySummary` text');
--> statement-breakpoint
PREPARE add_orb_memory_summary FROM @stmt;
--> statement-breakpoint
EXECUTE add_orb_memory_summary;
--> statement-breakpoint
DEALLOCATE PREPARE add_orb_memory_summary;
