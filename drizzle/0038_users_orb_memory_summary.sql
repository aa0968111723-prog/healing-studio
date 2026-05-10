-- 0038: Add orbMemorySummary column to users for Orb global condensed memory.
-- MySQL does not support ADD COLUMN IF NOT EXISTS in older versions, so gate with information_schema.
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
PREPARE s FROM @stmt;
EXECUTE s;
DEALLOCATE PREPARE s;
