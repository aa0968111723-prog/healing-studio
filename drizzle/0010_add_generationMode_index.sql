-- Add index on generationMode column for better query performance
-- This improves filtering performance when users search prompts by generation mode

CREATE INDEX `pl_generationMode_idx` ON `prompt_library` (`generationMode`);
