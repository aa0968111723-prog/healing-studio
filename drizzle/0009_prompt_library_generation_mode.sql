-- Add generationMode column to prompt_library table
-- This allows users to tag prompts with the generation mode they work best with

ALTER TABLE `prompt_library` ADD COLUMN `generationMode` varchar(32);
