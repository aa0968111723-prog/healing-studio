-- 0032: Add specialist agent columns to `agent_preferences`.
-- MySQL does NOT support `ADD COLUMN IF NOT EXISTS`, so each column is added
-- via a dynamic SQL statement that no-ops when the column already exists
-- (e.g. environments where the runtime backfill in
-- `server/routers/agentPreferencesRouter.ts` already added it).
-- Each statement is its own breakpoint because the connection pool does
-- not enable `multipleStatements`; Drizzle's mysql2 migrator runs the
-- whole file in one transaction, so the session-scoped `@stmt` and
-- prepared statement names persist across breakpoints.

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'agent_preferences' AND column_name = 'preferredSpecialistAgent'), 'SELECT 1', 'ALTER TABLE `agent_preferences` ADD COLUMN `preferredSpecialistAgent` VARCHAR(64) NULL');
--> statement-breakpoint
PREPARE add_specialist_col FROM @stmt;
--> statement-breakpoint
EXECUTE add_specialist_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_specialist_col;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'agent_preferences' AND column_name = 'specialistAutoActivate'), 'SELECT 1', 'ALTER TABLE `agent_preferences` ADD COLUMN `specialistAutoActivate` BOOLEAN NOT NULL DEFAULT TRUE');
--> statement-breakpoint
PREPARE add_specialist_col FROM @stmt;
--> statement-breakpoint
EXECUTE add_specialist_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_specialist_col;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'agent_preferences' AND column_name = 'specialistProactiveMode'), 'SELECT 1', 'ALTER TABLE `agent_preferences` ADD COLUMN `specialistProactiveMode` BOOLEAN NOT NULL DEFAULT TRUE');
--> statement-breakpoint
PREPARE add_specialist_col FROM @stmt;
--> statement-breakpoint
EXECUTE add_specialist_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_specialist_col;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'agent_preferences' AND column_name = 'specialistLearningEnabled'), 'SELECT 1', 'ALTER TABLE `agent_preferences` ADD COLUMN `specialistLearningEnabled` BOOLEAN NOT NULL DEFAULT TRUE');
--> statement-breakpoint
PREPARE add_specialist_col FROM @stmt;
--> statement-breakpoint
EXECUTE add_specialist_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_specialist_col;
--> statement-breakpoint

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'agent_preferences' AND column_name = 'disabledSpecialistAgents'), 'SELECT 1', 'ALTER TABLE `agent_preferences` ADD COLUMN `disabledSpecialistAgents` JSON NOT NULL DEFAULT (CAST(''[]'' AS JSON))');
--> statement-breakpoint
PREPARE add_specialist_col FROM @stmt;
--> statement-breakpoint
EXECUTE add_specialist_col;
--> statement-breakpoint
DEALLOCATE PREPARE add_specialist_col;
--> statement-breakpoint

UPDATE `agent_preferences` SET `disabledSpecialistAgents` = JSON_ARRAY() WHERE `disabledSpecialistAgents` IS NULL;
