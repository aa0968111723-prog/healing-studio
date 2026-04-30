-- Extend `agent_preferences` with the full settings panel surface.
-- Run via `npm run db:push` (drizzle-kit migrate) or apply manually.
-- All new columns are nullable or have safe defaults so existing rows stay valid.

-- Bootstrap: an earlier patch shipped the schema definition before the
-- backing CREATE TABLE migration was added to `drizzle/`, so production
-- never saw the table created. Create it idempotently with the base
-- columns so the ALTER TABLE below works on environments that lack it.
CREATE TABLE IF NOT EXISTS `agent_preferences` (
  `userId` int NOT NULL,
  `confirmationPolicy` enum('always_approve','confirm_high_risk','confirm_all','manual') NOT NULL DEFAULT 'confirm_high_risk',
  `allowedRiskLevels` json NOT NULL,
  `autoApproveTools` json NOT NULL,
  `blockedTools` json NOT NULL,
  `maxAutoStepsPerTask` int NOT NULL DEFAULT 5,
  `notifyOnCompletion` boolean NOT NULL DEFAULT true,
  `notifyOnError` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`userId`)
);
--> statement-breakpoint

ALTER TABLE `agent_preferences`
  ADD COLUMN `voiceEnabled` boolean NOT NULL DEFAULT false,
  ADD COLUMN `preferredVoiceName` enum('Puck','Charon','Kore','Fenrir','Aoede') NOT NULL DEFAULT 'Puck',
  ADD COLUMN `voiceAutoActivate` boolean NOT NULL DEFAULT false,
  ADD COLUMN `orbAgentEnabled` boolean NULL,
  ADD COLUMN `workflowsEnabled` boolean NULL,
  ADD COLUMN `disabledPageAgents` json NOT NULL DEFAULT (CAST('[]' AS JSON)),
  ADD COLUMN `orbWidgetCorner` enum('bottom-right','bottom-left','top-right','top-left') NOT NULL DEFAULT 'bottom-right',
  ADD COLUMN `orbWelcomeMessage` text NULL,
  ADD COLUMN `orbShortcutEnabled` boolean NOT NULL DEFAULT true,
  ADD COLUMN `orbProactiveSuggestions` boolean NOT NULL DEFAULT true;
