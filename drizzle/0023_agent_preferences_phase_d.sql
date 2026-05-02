-- 0023: Phase D — deep agent settings.
-- Adds cost-budget JSON, perception/critic/role/pacing toggles, and an
-- onboarding completion timestamp so the orb can show its first-time
-- 3-question wizard exactly once. All new columns default to values that
-- match today's runtime behaviour, so existing rows behave identically
-- until the user changes anything in /settings/agent.

ALTER TABLE `agent_preferences`
  ADD COLUMN `costBudget` json DEFAULT (CAST(NULL AS JSON)),
  ADD COLUMN `perceptionEnabled` tinyint(1) NOT NULL DEFAULT 1,
  ADD COLUMN `perceptionStrictness` enum('lenient','balanced','strict') NOT NULL DEFAULT 'balanced',
  ADD COLUMN `criticEnabled` tinyint(1) NOT NULL DEFAULT 0,
  ADD COLUMN `criticRefineBelow` int NOT NULL DEFAULT 75,
  ADD COLUMN `roleAutoSwitch` tinyint(1) NOT NULL DEFAULT 1,
  ADD COLUMN `pacingOverride` enum('auto','patient','balanced','impatient') NOT NULL DEFAULT 'auto',
  ADD COLUMN `onboardingCompletedAt` timestamp NULL;
