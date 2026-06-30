-- AIDV-318: agent_handoff_log — formal handoff records for multi-agent pipeline
--
-- Problem (QA探查 R18):
--   When Agent A completes a sub-task and Agent B is dispatched with
--   parent_task_id = A.id, there is zero audit trail of the transfer.
--   Failure retries have no starting point; cost attribution is impossible.
--
-- Solution:
--   1. agent_handoff_log table: captures from_agent → to_agent on every
--      task dispatch that carries a parent_task_id.
--   2. write_handoff_from_task_dispatch(): SECURITY DEFINER trigger function
--      that fires AFTER INSERT ON agent_tasks and writes one log row when
--      parent_task_id IS NOT NULL.
--   3. RLS: SELECT TO authenticated (scoped by creator_id);
--      INSERT TO service_role (triggers run as postgres superuser and bypass
--      RLS, but this covers direct service_role RPC calls).
--
-- Rollback:
--   DROP TRIGGER  IF EXISTS trg_log_agent_handoff ON public.agent_tasks;
--   DROP FUNCTION IF EXISTS public.write_handoff_from_task_dispatch();
--   DROP TABLE    IF EXISTS public.agent_handoff_log;


-- ─── 1. Table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.agent_handoff_log (
  id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id    uuid        NOT NULL REFERENCES public.video_projects(id) ON DELETE CASCADE,
  from_task_id  uuid        REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  to_task_id    uuid        NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  from_agent    text,
  to_agent      text,
  payload_hash  text,       -- md5 of from-task result for integrity tracing
  handoff_at    timestamptz NOT NULL DEFAULT now(),
  status        text        NOT NULL DEFAULT 'initiated'
                  CHECK (status IN ('initiated', 'completed', 'failed')),
  creator_id    uuid        NOT NULL  -- denormalised for RLS; matches video_projects.creator_id
);

CREATE INDEX IF NOT EXISTS idx_ahl_project_id  ON public.agent_handoff_log (project_id);
CREATE INDEX IF NOT EXISTS idx_ahl_to_task_id  ON public.agent_handoff_log (to_task_id);
CREATE INDEX IF NOT EXISTS idx_ahl_handoff_at  ON public.agent_handoff_log (handoff_at DESC);


-- ─── 2. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.agent_handoff_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    JOIN pg_class ON pg_class.oid = pg_policy.polrelid
    WHERE pg_class.relname = 'agent_handoff_log'
      AND pg_class.relnamespace = 'public'::regnamespace
      AND polname = 'ahl_creators_read_own'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY ahl_creators_read_own
        ON public.agent_handoff_log
        FOR SELECT
        TO authenticated
        USING ((SELECT auth.uid()) = creator_id)
    $pol$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    JOIN pg_class ON pg_class.oid = pg_policy.polrelid
    WHERE pg_class.relname = 'agent_handoff_log'
      AND pg_class.relnamespace = 'public'::regnamespace
      AND polname = 'ahl_service_role_insert'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY ahl_service_role_insert
        ON public.agent_handoff_log
        FOR INSERT
        TO service_role
        WITH CHECK (true)
    $pol$;
  END IF;
END $$;


-- ─── 3. Trigger function ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.write_handoff_from_task_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_creator_id    uuid;
  v_from_agent    text;
  v_payload_hash  text;
BEGIN
  -- Only act when the new task has a parent (= a handoff is happening)
  IF NEW.parent_task_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fetch creator_id from parent project (required NOT NULL on handoff log)
  SELECT creator_id INTO v_creator_id
  FROM public.video_projects
  WHERE id = NEW.project_id;

  IF v_creator_id IS NULL THEN
    RETURN NEW;  -- orphaned project — skip without error
  END IF;

  -- Fetch parent task agent + hash its result for payload integrity tracing
  SELECT
    assigned_agent,
    md5(result::text)
  INTO v_from_agent, v_payload_hash
  FROM public.agent_tasks
  WHERE id = NEW.parent_task_id;

  INSERT INTO public.agent_handoff_log (
    project_id,
    from_task_id,
    to_task_id,
    from_agent,
    to_agent,
    payload_hash,
    creator_id
  ) VALUES (
    NEW.project_id,
    NEW.parent_task_id,
    NEW.id,
    v_from_agent,
    NEW.assigned_agent,
    v_payload_hash,
    v_creator_id
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.write_handoff_from_task_dispatch() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_handoff_from_task_dispatch() TO service_role;


-- ─── 4. Attach trigger ────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname  = 'agent_tasks'
      AND t.tgname   = 'trg_log_agent_handoff'
  ) THEN
    CREATE TRIGGER trg_log_agent_handoff
      AFTER INSERT ON public.agent_tasks
      FOR EACH ROW
      EXECUTE FUNCTION public.write_handoff_from_task_dispatch();
  END IF;
END $$;
