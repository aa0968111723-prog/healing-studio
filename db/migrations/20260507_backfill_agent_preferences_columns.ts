import { sql } from "drizzle-orm";

// Backfill columns that were added after the initial `agent_preferences`
// migration so older environments can read/write full settings without
// failing on "Unknown column" errors.
export const up = sql`
SET @db := DATABASE();

SET @stmt := IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'voiceEnabled'),
  'SELECT 1',
  'ALTER TABLE agent_preferences ADD COLUMN voiceEnabled boolean NOT NULL DEFAULT false AFTER notifyOnError'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'preferredVoiceName'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN preferredVoiceName enum(\'Puck\',\'Charon\',\'Kore\',\'Fenrir\',\'Aoede\') NOT NULL DEFAULT \'Puck\' AFTER voiceEnabled');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'voiceAutoActivate'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN voiceAutoActivate boolean NOT NULL DEFAULT false AFTER preferredVoiceName');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'orbAgentEnabled'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN orbAgentEnabled boolean NULL AFTER voiceAutoActivate');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'workflowsEnabled'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN workflowsEnabled boolean NULL AFTER orbAgentEnabled');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'disabledPageAgents'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN disabledPageAgents json NOT NULL AFTER workflowsEnabled');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;
UPDATE agent_preferences SET disabledPageAgents = JSON_ARRAY() WHERE disabledPageAgents IS NULL;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'disabledActionsByPage'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN disabledActionsByPage json NOT NULL AFTER disabledPageAgents');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;
UPDATE agent_preferences SET disabledActionsByPage = JSON_OBJECT() WHERE disabledActionsByPage IS NULL;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'orbWidgetCorner'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN orbWidgetCorner enum(\'bottom-right\',\'bottom-left\',\'top-right\',\'top-left\') NOT NULL DEFAULT \'bottom-right\' AFTER disabledActionsByPage');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'orbWelcomeMessage'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN orbWelcomeMessage text NULL AFTER orbWidgetCorner');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'orbShortcutEnabled'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN orbShortcutEnabled boolean NOT NULL DEFAULT true AFTER orbWelcomeMessage');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'orbProactiveSuggestions'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN orbProactiveSuggestions boolean NOT NULL DEFAULT true AFTER orbShortcutEnabled');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'costBudget'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN costBudget json NULL AFTER orbProactiveSuggestions');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'perceptionEnabled'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN perceptionEnabled boolean NOT NULL DEFAULT true AFTER costBudget');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'perceptionStrictness'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN perceptionStrictness enum(\'lenient\',\'balanced\',\'strict\') NOT NULL DEFAULT \'balanced\' AFTER perceptionEnabled');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'criticEnabled'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN criticEnabled boolean NOT NULL DEFAULT false AFTER perceptionStrictness');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'criticRefineBelow'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN criticRefineBelow int NOT NULL DEFAULT 75 AFTER criticEnabled');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'roleAutoSwitch'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN roleAutoSwitch boolean NOT NULL DEFAULT true AFTER criticRefineBelow');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'pacingOverride'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN pacingOverride enum(\'auto\',\'patient\',\'balanced\',\'impatient\') NOT NULL DEFAULT \'auto\' AFTER roleAutoSwitch');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'onboardingCompletedAt'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN onboardingCompletedAt timestamp NULL AFTER pacingOverride');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'preferredSpecialistAgent'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN preferredSpecialistAgent varchar(64) NULL AFTER onboardingCompletedAt');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'specialistAutoActivate'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN specialistAutoActivate boolean NOT NULL DEFAULT true AFTER preferredSpecialistAgent');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'specialistProactiveMode'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN specialistProactiveMode boolean NOT NULL DEFAULT true AFTER specialistAutoActivate');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'specialistLearningEnabled'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN specialistLearningEnabled boolean NOT NULL DEFAULT true AFTER specialistProactiveMode');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

SET @stmt := IF(EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = @db AND table_name = 'agent_preferences' AND column_name = 'disabledSpecialistAgents'),'SELECT 1','ALTER TABLE agent_preferences ADD COLUMN disabledSpecialistAgents json NOT NULL AFTER specialistLearningEnabled');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;
UPDATE agent_preferences SET disabledSpecialistAgents = JSON_ARRAY() WHERE disabledSpecialistAgents IS NULL;
`;
