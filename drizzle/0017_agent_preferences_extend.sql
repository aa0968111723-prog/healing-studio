-- Extend `agent_preferences` with the full settings panel surface.
-- Run via `npm run db:push` (drizzle-kit migrate) or apply manually.
-- All new columns are nullable or have safe defaults so existing rows stay valid.

ALTER TABLE `agent_preferences`
  ADD COLUMN `voiceEnabled` boolean NOT NULL DEFAULT false,
  ADD COLUMN `preferredVoiceName` enum('Puck','Charon','Kore','Fenrir','Aoede') NOT NULL DEFAULT 'Puck',
  ADD COLUMN `voiceAutoActivate` boolean NOT NULL DEFAULT false,
  ADD COLUMN `orbAgentEnabled` boolean NULL,
  ADD COLUMN `workflowsEnabled` boolean NULL,
  ADD COLUMN `disabledPageAgents` json NOT NULL,
  ADD COLUMN `orbWidgetCorner` enum('bottom-right','bottom-left','top-right','top-left') NOT NULL DEFAULT 'bottom-right',
  ADD COLUMN `orbWelcomeMessage` text NULL,
  ADD COLUMN `orbShortcutEnabled` boolean NOT NULL DEFAULT true,
  ADD COLUMN `orbProactiveSuggestions` boolean NOT NULL DEFAULT true;

-- Backfill the new json column for existing rows.
UPDATE `agent_preferences` SET `disabledPageAgents` = JSON_ARRAY();
