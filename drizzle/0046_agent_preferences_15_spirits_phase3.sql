-- 0046: Backfill `agent_preferences` with the four columns that previously
-- only existed as a best-effort runtime ALTER inside
-- `server/routers/agentPreferencesRouter.ts::ensureAgentPreferencesSchema`:
--
--   * mutedSpirits              (15 精靈靜音清單)
--   * favoriteSpirits           (15 精靈最愛清單)
--   * stayOnPageMode            (Phase 3 stay-on-page auto-execute)
--   * proactiveTriggerSettings  (per-event 主動通知偏好)
--
-- Without this migration, environments that never hit the settings panel
-- end up with a schema that mismatches `drizzle/schema.ts`. Every
-- `db.select().from(agent_preferences)` call (settings save, chat router,
-- orbScheduler, agentCollaborationRouter, webhooks) then fails with
-- `ER_BAD_FIELD_ERROR` / "Unknown column". The settings UI surfaces it as
-- 儲存失敗; the AI-agent runtime path silently swallows it and falls back to
-- DEFAULT_AGENT_PREFERENCES — meaning the AI agent ignores whatever the
-- user thought they saved (auto vs. semi-auto, perception, critic, …).
--
-- Idempotent: each ADD COLUMN is wrapped in a stored procedure that
-- short-circuits when the column already exists, matching the pattern
-- used by 0034/0036/0045. Safe to re-run on environments where the
-- runtime ALTER already added the column.

DROP PROCEDURE IF EXISTS `__agent_prefs_add_spirits_columns`;
--> statement-breakpoint

CREATE PROCEDURE `__agent_prefs_add_spirits_columns`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'agent_preferences'
      AND COLUMN_NAME = 'mutedSpirits'
  ) THEN
    ALTER TABLE `agent_preferences`
      ADD COLUMN `mutedSpirits` JSON NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'agent_preferences'
      AND COLUMN_NAME = 'favoriteSpirits'
  ) THEN
    ALTER TABLE `agent_preferences`
      ADD COLUMN `favoriteSpirits` JSON NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'agent_preferences'
      AND COLUMN_NAME = 'stayOnPageMode'
  ) THEN
    ALTER TABLE `agent_preferences`
      ADD COLUMN `stayOnPageMode` BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'agent_preferences'
      AND COLUMN_NAME = 'proactiveTriggerSettings'
  ) THEN
    ALTER TABLE `agent_preferences`
      ADD COLUMN `proactiveTriggerSettings` JSON NULL;
  END IF;
END;
--> statement-breakpoint

CALL `__agent_prefs_add_spirits_columns`();
--> statement-breakpoint

DROP PROCEDURE IF EXISTS `__agent_prefs_add_spirits_columns`;
--> statement-breakpoint

-- Backfill NULL → empty JSON so the ORM never hands a `null` to code that
-- expects Array.isArray() / typeof "object". The runtime loader already
-- coerces missing values to defaults, but writing them at the row level
-- keeps SQL inspections accurate too.
UPDATE `agent_preferences`
  SET `mutedSpirits` = JSON_ARRAY()
  WHERE `mutedSpirits` IS NULL;
--> statement-breakpoint

UPDATE `agent_preferences`
  SET `favoriteSpirits` = JSON_ARRAY()
  WHERE `favoriteSpirits` IS NULL;
--> statement-breakpoint

UPDATE `agent_preferences`
  SET `proactiveTriggerSettings` = JSON_OBJECT()
  WHERE `proactiveTriggerSettings` IS NULL;
