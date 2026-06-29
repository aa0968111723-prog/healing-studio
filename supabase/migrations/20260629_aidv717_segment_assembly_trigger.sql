-- AIDV-717: Segment assembly trigger — write video_segments from completed agent_tasks
--
-- Root cause (confirmed by DB scan + codebase search):
--   complete_task() sets agent_tasks.status → 'completed' but ZERO application
--   or DB code ever inserts into video_segments. Consequently:
--     • trg_auto_close_video_project fires, finds 0 segments
--     • enforce_segment_before_completion (BEFORE UPDATE on video_projects) raises
--       check_violation when status → 'completed'
--     • auto_close_video_project() catches exception → sets project 'failed'
--   Creator gets a failed project with no deliverable and no explanation.
--
-- Fix:
--   1. write_segment_from_completed_task(): SECURITY DEFINER trigger function that
--      fires AFTER UPDATE OF status ON agent_tasks. On every status → 'completed'
--      transition it inserts one video_segments row, mapping task_type → content_type
--      (script/voice/visual/final). Trigger name 'trg_assemble_video_segment' sorts
--      before 'trg_auto_close_video_project' → segments exist before the close check.
--   2. Back-fill: insert missing segments for the 3 existing completed tasks.
--   3. Recover: UPDATE the existing 'failed' project to 'completed' now that segments
--      exist and all tasks are terminal-success.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_assemble_video_segment ON public.agent_tasks;
--   DROP FUNCTION IF EXISTS public.write_segment_from_completed_task();
--   (segment rows created by back-fill cannot be auto-deleted; delete manually if needed)

-- ─── 1. Trigger function: write segment on task completion ────────────────────────

CREATE OR REPLACE FUNCTION public.write_segment_from_completed_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_creator_id   uuid;
  v_content_type text;
  v_seg_index    int;
BEGIN
  -- Only act on status → 'completed' transitions
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  -- Fetch creator_id from parent project (required NOT NULL on video_segments)
  SELECT creator_id INTO v_creator_id
  FROM public.video_projects
  WHERE id = NEW.project_id;

  IF v_creator_id IS NULL THEN
    RETURN NEW;  -- orphaned task — skip without error
  END IF;

  -- Map task_type → content_type CHECK constraint values: script|voice|visual|final
  v_content_type := CASE
    WHEN NEW.task_type ILIKE '%script%'   THEN 'script'
    WHEN NEW.task_type ILIKE '%voice%'
      OR  NEW.task_type ILIKE '%audio%'   THEN 'voice'
    WHEN NEW.task_type ILIKE '%final%'
      OR  NEW.task_type ILIKE '%export%'
      OR  NEW.task_type ILIKE '%render%'  THEN 'final'
    ELSE 'visual'  -- video-processing, scene-composition, lip-sync, etc.
  END;

  -- Next sequential segment_index for this project (gaps are OK)
  SELECT COALESCE(MAX(segment_index) + 1, 0) INTO v_seg_index
  FROM public.video_segments
  WHERE project_id = NEW.project_id;

  INSERT INTO public.video_segments (
    project_id,
    segment_index,
    content_type,
    content,
    created_by_agent,
    creator_id
  ) VALUES (
    NEW.project_id,
    v_seg_index,
    v_content_type,
    CASE WHEN NEW.result IS NOT NULL THEN NEW.result::text ELSE NULL END,
    NEW.assigned_agent,
    v_creator_id
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.write_segment_from_completed_task() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_segment_from_completed_task() TO service_role;

-- ─── 2. Attach trigger (fires BEFORE trg_auto_close_video_project alphabetically) ─

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname  = 'agent_tasks'
      AND t.tgname   = 'trg_assemble_video_segment'
  ) THEN
    CREATE TRIGGER trg_assemble_video_segment
      AFTER UPDATE OF status ON public.agent_tasks
      FOR EACH ROW
      EXECUTE FUNCTION public.write_segment_from_completed_task();
  END IF;
END $$;

-- ─── 3. Back-fill: segments for existing completed tasks that have no segments ────
--    Runs as the migration user (postgres superuser), so RLS does not apply.

DO $$
DECLARE
  r            RECORD;
  v_seg_index  int;
  v_ctype      text;
BEGIN
  FOR r IN
    SELECT
      at.id            AS task_id,
      at.project_id,
      at.task_type,
      at.result,
      at.assigned_agent,
      at.created_at    AS task_created_at,
      vp.creator_id
    FROM public.agent_tasks at
    JOIN public.video_projects vp ON vp.id = at.project_id
    WHERE at.status = 'completed'
      AND NOT EXISTS (
        SELECT 1 FROM public.video_segments vs
        WHERE vs.project_id = at.project_id
      )
    ORDER BY at.created_at
  LOOP
    v_ctype := CASE
      WHEN r.task_type ILIKE '%script%'   THEN 'script'
      WHEN r.task_type ILIKE '%voice%'
        OR  r.task_type ILIKE '%audio%'   THEN 'voice'
      WHEN r.task_type ILIKE '%final%'
        OR  r.task_type ILIKE '%export%'
        OR  r.task_type ILIKE '%render%'  THEN 'final'
      ELSE 'visual'
    END;

    SELECT COALESCE(MAX(segment_index) + 1, 0) INTO v_seg_index
    FROM public.video_segments
    WHERE project_id = r.project_id;

    INSERT INTO public.video_segments (
      project_id,
      segment_index,
      content_type,
      content,
      created_by_agent,
      creator_id
    ) VALUES (
      r.project_id,
      v_seg_index,
      v_ctype,
      CASE WHEN r.result IS NOT NULL THEN r.result::text ELSE NULL END,
      r.assigned_agent,
      r.creator_id
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- ─── 4. Recover: mark 'failed' projects 'completed' where segments now exist ──────
--    Condition: all tasks terminal, none failed/dead_letter, segments present.

DO $$
BEGIN
  UPDATE public.video_projects vp
  SET status = 'completed', updated_at = now()
  WHERE vp.status = 'failed'
    AND EXISTS (
      SELECT 1 FROM public.video_segments vs
      WHERE vs.project_id = vp.id
      LIMIT 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.agent_tasks at
      WHERE at.project_id = vp.id
        AND at.status NOT IN ('completed', 'failed', 'dead_letter')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.agent_tasks at
      WHERE at.project_id = vp.id
        AND at.status IN ('failed', 'dead_letter')
    );
EXCEPTION
  WHEN check_violation THEN
    -- guard_video_project_completion rejected — segment data insufficient; leave as-is
    NULL;
END $$;
