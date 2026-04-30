-- 0018: per-page × per-action allowlist for the orb agent.
-- Adds a single JSON column to `agent_preferences`. Existing rows get an
-- empty object backfill so the agent's behaviour is unchanged until the user
-- explicitly disables an action on a page in /settings/agent.

ALTER TABLE `agent_preferences`
  ADD COLUMN `disabledActionsByPage` json NOT NULL DEFAULT (CAST('{}' AS JSON));
