-- AIDV-665: Pipeline segment cascade — fix "completed with zero segments" gap
--
-- Root cause:
--   complete_task() transitions agent_tasks.status → 'completed' but never
--   updated video_projects.status. The project ended up in 'completed' state
--   with 0 video_segments rows (set before guard trigger existed).
--
-- This migration:
--   1. auto_close_video_project(): after each task status→terminal, check if
--      ALL project tasks are terminal; if so, attempt 'completed' (guard blocks
--      it if no segments → catch → set 'failed' instead).
--   2. trg_auto_close_video_project on agent_tasks AFTER UPDATE OF status.
--   3. notify_video_project_closed(): AFTER trigger on video_projects; emits
--      pg_notify 'video_project_status' with segment_count; segment_count=0
--      → event_type='job_failed' (acceptance criterion #3).
--   4. trg_notify_video_project_closed on video_projects AFTER UPDATE OF status.
--   5. Data fix: reset existing broken row (status='completed', 0 segments)
--      to 'failed'.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_auto_close_video_project ON public.agent_tasks;
--   DROP TRIGGER IF EXISTS trg_notify_video_project_closed ON public.video_projects;
--   DROP FUNCTION IF EXISTS public.auto_close_video_project();
--   DROP FUNCTION IF EXISTS public.notify_video_project_closed();
--   (restore data: UPDATE public.video_projects SET status='completed' WHERE ...)

-- 1. Cascade function: auto-close project when all tasks reach terminal state
CREATE OR REPLACE FUNCTION public.auto_close_video_project()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_total    int;
  v_terminal int;
  v_failed   int;
BEGIN
  -- Only react when status transitions to a terminal state
  IF NEW.status NOT IN ('completed', 'failed', 'dead_letter') THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Count total, terminal, and failed tasks for this project
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status IN ('completed', 'failed', 'dead_letter')),
    COUNT(*) FILTER (WHERE status IN ('failed', 'dead_letter'))
  INTO v_total, v_terminal, v_failed
  FROM public.agent_tasks
  WHERE project_id = NEW.project_id;

  -- Not all tasks done yet — wait
  IF v_terminal < v_total THEN
    RETURN NEW;
  END IF;

  -- All terminal: any failure → project failed
  IF v_failed > 0 THEN
    UPDATE public.video_projects
      SET status = 'failed', updated_at = now()
    WHERE id = NEW.project_id
      AND status NOT IN ('completed', 'failed');
  ELSE
    -- All tasks completed; attempt 'completed' — guard trigger
    -- (enforce_segment_before_completion) raises check_violation if
    -- video_segments is empty → catch it and mark project failed instead.
    BEGIN
      UPDATE public.video_projects
        SET status = 'completed', updated_at = now()
      WHERE id = NEW.project_id
        AND status NOT IN ('completed', 'failed');
    EXCEPTION
      WHEN check_violation THEN
        UPDATE public.video_projects
          SET status = 'failed', updated_at = now()
        WHERE id = NEW.project_id
          AND status NOT IN ('failed');
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Attach cascade trigger to agent_tasks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' AND c.relname = 'agent_tasks'
      AND t.tgname = 'trg_auto_close_video_project'
  ) THEN
    CREATE TRIGGER trg_auto_close_video_project
      AFTER UPDATE OF status ON public.agent_tasks
      FOR EACH ROW
      EXECUTE FUNCTION public.auto_close_video_project();
  END IF;
END $$;

-- 3. Notification function: emit pg_notify on terminal video_project transition
CREATE OR REPLACE FUNCTION public.notify_video_project_closed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_segment_count int;
  v_event_type    text;
BEGIN
  IF NEW.status NOT IN ('completed', 'failed') THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_segment_count
  FROM public.video_segments
  WHERE project_id = NEW.id;

  -- AC #3: segment_count=0 forces job_failed even if DB status='completed'
  v_event_type := CASE
    WHEN NEW.status = 'completed' AND v_segment_count > 0 THEN 'job_complete'
    ELSE 'job_failed'
  END;

  PERFORM pg_notify(
    'video_project_status',
    json_build_object(
      'event',         v_event_type,
      'project_id',    NEW.id,
      'status',        NEW.status,
      'segment_count', v_segment_count,
      'updated_at',    now()
    )::text
  );

  RETURN NEW;
END;
$$;

-- 4. Attach notification trigger to video_projects
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' AND c.relname = 'video_projects'
      AND t.tgname = 'trg_notify_video_project_closed'
  ) THEN
    CREATE TRIGGER trg_notify_video_project_closed
      AFTER UPDATE OF status ON public.video_projects
      FOR EACH ROW
      EXECUTE FUNCTION public.notify_video_project_closed();
  END IF;
END $$;

-- 5. Data fix: reset the existing broken project to 'failed'
-- (status='completed' with 0 video_segments violates the intended invariant)
UPDATE public.video_projects
SET status = 'failed', updated_at = now()
WHERE status = 'completed'
  AND NOT EXISTS (
    SELECT 1 FROM public.video_segments
    WHERE project_id = video_projects.id
    LIMIT 1
  );
