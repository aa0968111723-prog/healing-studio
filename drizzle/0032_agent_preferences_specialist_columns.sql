-- 0032: Specialized agent preferences columns.
-- Adds the specialist agent settings surfaced in /settings/agent so the orb
-- can pick a preferred specialist, auto-activate it, and persist a per-user
-- disable list. Defaults match the runtime defaults so existing rows behave
-- identically until the user changes anything.
--
-- MySQL does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and the
-- router's runtime `ensureAgentPreferencesSchema` may have already added some
-- of these columns on environments where an earlier (broken) version of this
-- migration silently failed. To stay idempotent we wrap each ADD COLUMN in an
-- INFORMATION_SCHEMA existence check via a temporary stored procedure.

DROP PROCEDURE IF EXISTS healing_studio_migrate_0032;
--> statement-breakpoint
CREATE PROCEDURE healing_studio_migrate_0032()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'agent_preferences'
      AND column_name = 'preferredSpecialistAgent'
  ) THEN
    ALTER TABLE `agent_preferences`
      ADD COLUMN `preferredSpecialistAgent` varchar(64) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'agent_preferences'
      AND column_name = 'specialistAutoActivate'
  ) THEN
    ALTER TABLE `agent_preferences`
      ADD COLUMN `specialistAutoActivate` boolean NOT NULL DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'agent_preferences'
      AND column_name = 'specialistProactiveMode'
  ) THEN
    ALTER TABLE `agent_preferences`
      ADD COLUMN `specialistProactiveMode` boolean NOT NULL DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'agent_preferences'
      AND column_name = 'specialistLearningEnabled'
  ) THEN
    ALTER TABLE `agent_preferences`
      ADD COLUMN `specialistLearningEnabled` boolean NOT NULL DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'agent_preferences'
      AND column_name = 'disabledSpecialistAgents'
  ) THEN
    ALTER TABLE `agent_preferences`
      ADD COLUMN `disabledSpecialistAgents` json NOT NULL DEFAULT (CAST('[]' AS JSON));
  END IF;
END;
--> statement-breakpoint
CALL healing_studio_migrate_0032();
--> statement-breakpoint
DROP PROCEDURE healing_studio_migrate_0032;
