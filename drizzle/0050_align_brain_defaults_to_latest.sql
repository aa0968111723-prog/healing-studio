-- 0050_align_brain_defaults_to_latest.sql
--
-- Align user_ai_brain DB column defaults with DEFAULT_REASONING_BRAINS and
-- DEFAULT_GENERATION_ENGINES in server/middleware/brainContext.ts.
--
-- Background:
--   - Middleware defaults used Claude Opus 4.7 (latest Anthropic frontier)
--     for director / storyteller / technician / curator and Perplexity
--     Sonar Pro for analyst, while DB column defaults still seeded
--     google/gemini-2.5-pro and google/gemini-2.5-flash. New user_ai_brain
--     rows therefore landed on older Gemini 2.5 instead of the intended
--     Claude Opus 4.7.
--   - videoEngine column default was fal-ai/kling-video/v2.1/pro/text-to-video,
--     but middleware degraded to fal-ai/wan-t2v after Kling upstream broke
--     (see brainContext.ts:172-175). audioEngine column default was
--     fal-ai/stable-audio while middleware default was fal-ai/ace-step.
--
-- Statements separated by Drizzle breakpoint markers (mysql2 driver has
-- multi-statement disabled).

ALTER TABLE `user_ai_brain`
  MODIFY COLUMN `directorModel` varchar(128) NOT NULL DEFAULT 'anthropic/claude-opus-4.7';
--> statement-breakpoint

ALTER TABLE `user_ai_brain`
  MODIFY COLUMN `directorTemperature` decimal(3,2) NOT NULL DEFAULT '0.4';
--> statement-breakpoint

ALTER TABLE `user_ai_brain`
  MODIFY COLUMN `analystModel` varchar(128) NOT NULL DEFAULT 'perplexity/sonar-pro';
--> statement-breakpoint

ALTER TABLE `user_ai_brain`
  MODIFY COLUMN `storytellerModel` varchar(128) NOT NULL DEFAULT 'anthropic/claude-opus-4.7';
--> statement-breakpoint

ALTER TABLE `user_ai_brain`
  MODIFY COLUMN `technicianModel` varchar(128) NOT NULL DEFAULT 'anthropic/claude-opus-4.7';
--> statement-breakpoint

ALTER TABLE `user_ai_brain`
  MODIFY COLUMN `curatorModel` varchar(128) NOT NULL DEFAULT 'anthropic/claude-opus-4.7';
--> statement-breakpoint

ALTER TABLE `user_ai_brain`
  MODIFY COLUMN `videoEngine` varchar(128) NOT NULL DEFAULT 'fal-ai/wan-t2v';
--> statement-breakpoint

ALTER TABLE `user_ai_brain`
  MODIFY COLUMN `audioEngine` varchar(128) NOT NULL DEFAULT 'fal-ai/ace-step';
--> statement-breakpoint

-- Migrate existing rows that still hold the deprecated defaults. We only
-- touch rows that match the OLD default exactly — users who explicitly
-- chose google/gemini-2.5-* keep their selection (we cannot distinguish
-- "set by default" from "set by user" at this point, but matching the
-- previous default is the standard pattern used by 0021).

UPDATE `user_ai_brain`
   SET `directorModel` = 'anthropic/claude-opus-4.7'
 WHERE `directorModel` = 'google/gemini-2.5-pro';
--> statement-breakpoint

UPDATE `user_ai_brain`
   SET `analystModel` = 'perplexity/sonar-pro'
 WHERE `analystModel` = 'google/gemini-2.5-flash';
--> statement-breakpoint

UPDATE `user_ai_brain`
   SET `storytellerModel` = 'anthropic/claude-opus-4.7'
 WHERE `storytellerModel` = 'google/gemini-2.5-pro';
--> statement-breakpoint

UPDATE `user_ai_brain`
   SET `technicianModel` = 'anthropic/claude-opus-4.7'
 WHERE `technicianModel` = 'google/gemini-2.5-flash';
--> statement-breakpoint

UPDATE `user_ai_brain`
   SET `curatorModel` = 'anthropic/claude-opus-4.7'
 WHERE `curatorModel` = 'google/gemini-2.5-flash';
--> statement-breakpoint

UPDATE `user_ai_brain`
   SET `videoEngine` = 'fal-ai/wan-t2v'
 WHERE `videoEngine` = 'fal-ai/kling-video/v2.1/pro/text-to-video';
--> statement-breakpoint

UPDATE `user_ai_brain`
   SET `audioEngine` = 'fal-ai/ace-step'
 WHERE `audioEngine` = 'fal-ai/stable-audio';
