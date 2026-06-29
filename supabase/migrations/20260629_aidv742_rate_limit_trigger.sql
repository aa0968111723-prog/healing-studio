-- AIDV-742: Wire check_creator_job_rate_limit into agent_tasks BEFORE INSERT
-- Context: check_creator_job_rate_limit() existed since aidv_501 but was never called.
-- creator_job_throttle stayed at 0 rows across every QA cycle because no INSERT
-- path invoked the function. This trigger closes the gap.
--
-- Design: lookup creator_id from video_projects, then enforce 20 tasks/hour.
-- If project_id references a non-existent project, the row is allowed through
-- (project ownership guard in dispatch_task handles that separately).
-- Limit 20/hr matches the acceptance criteria in AIDV-742 (not 10 = old default).

CREATE OR REPLACE FUNCTION public.enforce_agent_task_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_creator_id uuid;
  v_allowed    boolean;
BEGIN
  SELECT creator_id INTO v_creator_id
  FROM public.video_projects
  WHERE id = NEW.project_id;

  IF v_creator_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_allowed := public.check_creator_job_rate_limit(v_creator_id, 20);

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'rate_limit_exceeded: creator % exceeded 20 agent_tasks/hour', v_creator_id
      USING ERRCODE = 'P0001',
            HINT    = 'Wait until the next clock-hour window or contact support.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_agent_task_rate_limit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_agent_task_rate_limit() FROM anon;
REVOKE EXECUTE ON FUNCTION public.enforce_agent_task_rate_limit() FROM authenticated;

DROP TRIGGER IF EXISTS agent_task_rate_limit_trigger ON public.agent_tasks;

CREATE TRIGGER agent_task_rate_limit_trigger
  BEFORE INSERT ON public.agent_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_agent_task_rate_limit();
