-- AIDV-747 + AIDV-729: Drop unused indexes confirmed by pg_stat_user_indexes (idx_scan=0)
-- Audit findings (2026-06-30):
--   agent_handoff_log: write_handoff_from_task_dispatch() only INSERTs; no SELECT/WHERE on these cols
--   agent_tasks: no server or DB-function queries use (status,created_at) or (status,started_at)
--   NOT dropped: idx_video_projects_creator_id, idx_video_segments_creator_id (RLS row filtering)
-- DROP INDEX in Postgres does not lock the table; safe for production.

-- agent_handoff_log: 4 unused indexes (AIDV-747)
DROP INDEX IF EXISTS public.idx_ahl_project_id;
DROP INDEX IF EXISTS public.idx_ahl_from_task_id;
DROP INDEX IF EXISTS public.idx_ahl_to_task_id;
DROP INDEX IF EXISTS public.idx_ahl_handoff_at;

-- agent_tasks: 2 unused composite indexes (AIDV-729)
DROP INDEX IF EXISTS public.idx_agent_tasks_status_created;
DROP INDEX IF EXISTS public.idx_agent_tasks_status_started;
