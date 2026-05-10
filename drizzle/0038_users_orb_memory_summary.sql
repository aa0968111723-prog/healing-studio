-- 0038: Add orbMemorySummary column to users for Orb global condensed memory.
-- MySQL does NOT support `ADD COLUMN IF NOT EXISTS` (only added in 8.0.29 and
-- not reliably available in all hosted MySQL versions), so we guard the
-- ALTER via INFORMATION_SCHEMA so re-runs after a partial deploy are no-ops.
--
-- IMPORTANT: each statement must be separated by `--> statement-breakpoint`.
-- Drizzle's mysql2 migrator splits the file on that marker and runs each
-- chunk as its own query — the underlying connection pool does not enable
-- `multipleStatements`, so a single chunk containing multiple `;`-terminated
-- statements is rejected by MySQL with ER_PARSE_ERROR (1064).
-- Session-scoped `@stmt` and the prepared statement name persist across
-- breakpoints because Drizzle wraps the whole file in one transaction.

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'orbMemorySummary'), 'SELECT 1', 'ALTER TABLE `users` ADD COLUMN `orbMemorySummary` text');
--> statement-breakpoint
PREPARE add_orb_memory_summary_col FROM @stmt;
--> statement-breakpoint
EXECUTE add_orb_memory_summary_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_orb_memory_summary_col;
