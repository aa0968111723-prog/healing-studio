-- 0021_align_voice_engine_default.sql
-- Align voiceEngine + falTextToSpeechEngine defaults to ElevenLabs Turbo V2.5,
-- matching DEFAULT_GENERATION_ENGINES.voiceEngine and DEFAULT_FAL_ENGINES.textToSpeech.
-- Previous default was fal-ai/metavoice-v1 (API has changed; returns 422).
-- Statements are separated by Drizzle breakpoint markers so the mysql2
-- driver receives each query individually (multi-statement is disabled).

ALTER TABLE `user_ai_brain`
  MODIFY COLUMN `voiceEngine` varchar(128) NOT NULL DEFAULT 'fal-ai/elevenlabs/tts/turbo-v2.5';
--> statement-breakpoint

ALTER TABLE `user_ai_brain`
  MODIFY COLUMN `falTextToSpeechEngine` varchar(128) DEFAULT 'fal-ai/elevenlabs/tts/turbo-v2.5';
--> statement-breakpoint

-- Migrate existing rows that still hold the deprecated default.
UPDATE `user_ai_brain`
   SET `voiceEngine` = 'fal-ai/elevenlabs/tts/turbo-v2.5'
 WHERE `voiceEngine` = 'fal-ai/metavoice-v1';
--> statement-breakpoint

UPDATE `user_ai_brain`
   SET `falTextToSpeechEngine` = 'fal-ai/elevenlabs/tts/turbo-v2.5'
 WHERE `falTextToSpeechEngine` = 'fal-ai/metavoice-v1';
