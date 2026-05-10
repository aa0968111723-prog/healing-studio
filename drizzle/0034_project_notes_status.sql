-- 0033: Add `status` to project_notes_calendar so notes / schedule entries
-- can be tracked as actionable tasks (todo / in_progress / done).
-- Powers the today/upcoming view and the "mark done" workflow on /notes.
--
-- Idempotent: safe to run more than once; checks INFORMATION_SCHEMA before
-- altering. Works on MySQL 5.7 + 8.x (does not require `IF NOT EXISTS` syntax
-- for ALTER, which only landed in 8.0.29).

DROP PROCEDURE IF EXISTS `__pnc_add_status_column`;
--> statement-breakpoint

CREATE PROCEDURE `__pnc_add_status_column`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'project_notes_calendar'
      AND COLUMN_NAME = 'status'
  ) THEN
    ALTER TABLE `project_notes_calendar`
      ADD COLUMN `status` enum('todo','in_progress','done')
        NOT NULL DEFAULT 'todo';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'project_notes_calendar'
      AND INDEX_NAME = 'pnc_userId_status_idx'
  ) THEN
    CREATE INDEX `pnc_userId_status_idx`
      ON `project_notes_calendar` (`userId`, `status`);
  END IF;
END;
--> statement-breakpoint

CALL `__pnc_add_status_column`();
--> statement-breakpoint

DROP PROCEDURE IF EXISTS `__pnc_add_status_column`;
