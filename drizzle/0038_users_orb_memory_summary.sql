-- 0038: Add orbMemorySummary column to users for Orb global condensed memory.
-- Each statement is separated by a breakpoint so Drizzle's mysql2 migrator
-- sends them individually (the connection pool does not enable multipleStatements).
SET @stmt := IF(
  EXISTS(
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND column_name = 'orbMemorySummary'
  ),
  'SELECT 1',
  'ALTER TABLE `users` ADD COLUMN `orbMemorySummary` text'
);
--> statement-breakpoint
PREPARE add_orb_memory_col FROM @stmt;
--> statement-breakpoint
EXECUTE add_orb_memory_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_orb_memory_col;
