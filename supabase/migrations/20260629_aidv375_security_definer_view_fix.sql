-- AIDV-375: Security C13 fixes
--
-- P0: public.agent_task_dlq VIEW was SECURITY DEFINER — queried with the
--     owner's (postgres) permissions, bypassing RLS on agent_tasks entirely.
--     Any user who can SELECT the view could read dead-letter tasks for all
--     other creators.
-- P2: public.set_updated_at() had a mutable search_path — injection vector.
-- P3: Missing FK indexes on agent_tasks, video_projects, video_segments degrade
--     JOIN query performance.
-- P3: RLS policies calling auth.uid() per-row; rewrite as (select auth.uid())
--     to evaluate once per query.
--
-- Rollback P0: recreate view with SECURITY DEFINER (not recommended).
-- Rollback P2: ALTER FUNCTION public.set_updated_at() RESET search_path;

-- P0: Recreate agent_task_dlq VIEW as SECURITY INVOKER (Postgres default)
DROP VIEW IF EXISTS public.agent_task_dlq;

CREATE VIEW public.agent_task_dlq AS
  SELECT id, project_id, assigned_agent, task_type, capability_required,
         status, priority, payload, result, retry_count, max_retries,
         error_message, created_at, updated_at, started_at, completed_at
  FROM public.agent_tasks
  WHERE status = 'dead_letter'
  ORDER BY created_at DESC;

-- P2: Pin search_path on set_updated_at to prevent schema-injection
ALTER FUNCTION public.set_updated_at() SET search_path = public, pg_catalog;

-- P3a: FK index — agent_tasks(assigned_agent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'agent_tasks'
      AND indexname = 'idx_agent_tasks_assigned_agent'
  ) THEN
    CREATE INDEX idx_agent_tasks_assigned_agent ON public.agent_tasks (assigned_agent);
  END IF;
END $$;

-- P3b: FK index — video_projects(creator_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'video_projects'
      AND indexname = 'idx_video_projects_creator_id'
  ) THEN
    CREATE INDEX idx_video_projects_creator_id ON public.video_projects (creator_id);
  END IF;
END $$;

-- P3c: FK index — video_segments(project_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'video_segments'
      AND indexname = 'idx_video_segments_project_id'
  ) THEN
    CREATE INDEX idx_video_segments_project_id ON public.video_segments (project_id);
  END IF;
END $$;

-- P3d: Fix RLS auth() per-row evaluation on video_projects
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'video_projects'
      AND policyname = 'creators_own_projects'
  ) THEN
    DROP POLICY creators_own_projects ON public.video_projects;
  END IF;
END $$;

CREATE POLICY creators_own_projects ON public.video_projects
  USING ((select auth.uid()) = creator_id);

-- P3e: Fix RLS auth() per-row evaluation on video_segments
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'video_segments'
      AND policyname = 'creators_own_segments'
  ) THEN
    DROP POLICY creators_own_segments ON public.video_segments;
  END IF;
END $$;

CREATE POLICY creators_own_segments ON public.video_segments
  USING ((select auth.uid()) = creator_id);

-- P3f: Fix RLS auth() per-row evaluation on agent_tasks
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'agent_tasks'
      AND policyname = 'creators_read_own_tasks'
  ) THEN
    DROP POLICY creators_read_own_tasks ON public.agent_tasks;
  END IF;
END $$;

CREATE POLICY creators_read_own_tasks ON public.agent_tasks
  FOR SELECT
  USING (
    (select auth.uid()) IN (
      SELECT creator_id FROM public.video_projects
      WHERE id = agent_tasks.project_id
    )
  );
