-- 0033: Add `status` to project_notes_calendar so notes / schedule entries
-- can be tracked as actionable tasks (todo / in_progress / done).
-- Powers the today/upcoming view and the "mark done" workflow on /notes.

ALTER TABLE `project_notes_calendar`
  ADD COLUMN `status` enum('todo','in_progress','done') NOT NULL DEFAULT 'todo';
--> statement-breakpoint

CREATE INDEX `pnc_userId_status_idx`
  ON `project_notes_calendar` (`userId`, `status`);
