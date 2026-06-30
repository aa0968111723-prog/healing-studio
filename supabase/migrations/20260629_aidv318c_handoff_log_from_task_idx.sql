-- AIDV-318 follow-up: add covering index on agent_handoff_log.from_task_id
--
-- Supabase performance advisor flagged FK agent_handoff_log_from_task_id_fkey
-- as lacking a covering index (unindexed_foreign_keys lint).
-- from_task_id is nullable so the index uses WHERE from_task_id IS NOT NULL
-- to avoid storing null entries (same pattern as the existing idx_ahl_to_task_id
-- would have used had it been partial).

CREATE INDEX IF NOT EXISTS idx_ahl_from_task_id
  ON public.agent_handoff_log (from_task_id)
  WHERE from_task_id IS NOT NULL;
