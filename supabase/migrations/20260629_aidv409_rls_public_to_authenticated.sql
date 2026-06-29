-- AIDV-409: Tighten RLS role from {public} to {authenticated} on core video tables
--
-- Root cause: Three policies used TO public (the default pseudo-role that includes
-- all roles including anon/unauthenticated connections). The USING condition correctly
-- filters out unauthenticated users (auth.uid() returns NULL for anon), but the policy
-- still runs the check on every anonymous request — semantic mismatch + unnecessary
-- overhead + incorrect role scoping.
--
-- Tables affected:
--   agent_tasks         creators_read_own_tasks  TO public → TO authenticated (SELECT)
--   video_projects      creators_own_projects    TO public → TO authenticated (ALL)
--   video_segments      creators_own_segments    TO public → TO authenticated (ALL)
--
-- Also: video_projects/video_segments FOR ALL policies lacked explicit WITH CHECK
-- clauses. PostgreSQL falls back to USING as WITH CHECK when omitted, so INSERT was
-- already correctly guarded — but explicit WITH CHECK makes the intent unambiguous.
--
-- Rollback:
--   DROP POLICY IF EXISTS creators_read_own_tasks ON public.agent_tasks;
--   CREATE POLICY creators_read_own_tasks ON public.agent_tasks
--     FOR SELECT TO public
--     USING ((SELECT auth.uid()) IN (
--       SELECT video_projects.creator_id FROM public.video_projects
--       WHERE video_projects.id = agent_tasks.project_id));
--   DROP POLICY IF EXISTS creators_own_projects ON public.video_projects;
--   CREATE POLICY creators_own_projects ON public.video_projects
--     FOR ALL TO public USING ((SELECT auth.uid()) = creator_id);
--   DROP POLICY IF EXISTS creators_own_segments ON public.video_segments;
--   CREATE POLICY creators_own_segments ON public.video_segments
--     FOR ALL TO public USING ((SELECT auth.uid()) = creator_id);


-- ─── 1. agent_tasks: SELECT policy  public → authenticated ───────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'agent_tasks'
      AND p.polname = 'creators_read_own_tasks'
  ) THEN
    DROP POLICY creators_read_own_tasks ON public.agent_tasks;
  END IF;
END $$;

CREATE POLICY creators_read_own_tasks
  ON public.agent_tasks
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) IN (
      SELECT video_projects.creator_id
      FROM public.video_projects
      WHERE video_projects.id = agent_tasks.project_id
    )
  );


-- ─── 2. video_projects: ALL policy  public → authenticated + explicit WITH CHECK ─

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'video_projects'
      AND p.polname = 'creators_own_projects'
  ) THEN
    DROP POLICY creators_own_projects ON public.video_projects;
  END IF;
END $$;

CREATE POLICY creators_own_projects
  ON public.video_projects
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = creator_id)
  WITH CHECK ((SELECT auth.uid()) = creator_id);


-- ─── 3. video_segments: ALL policy  public → authenticated + explicit WITH CHECK ─

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'video_segments'
      AND p.polname = 'creators_own_segments'
  ) THEN
    DROP POLICY creators_own_segments ON public.video_segments;
  END IF;
END $$;

CREATE POLICY creators_own_segments
  ON public.video_segments
  FOR ALL
  TO authenticated
  USING ((SELECT auth.uid()) = creator_id)
  WITH CHECK ((SELECT auth.uid()) = creator_id);
