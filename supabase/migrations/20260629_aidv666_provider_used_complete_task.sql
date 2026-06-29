-- AIDV-666: Fix provider_used=NULL regression — complete_task & dispatch_task
--
-- Root cause:
--   complete_task() transitions agent_tasks.status → 'completed' but never
--   wrote provider_used. AIDV-550 patched dispatch_task() but complete_task()
--   was the live completion path; all 3 completed tasks have provider_used=NULL.
--
-- This migration:
--   1. Replaces complete_task() to accept p_provider_used (DEFAULT NULL for
--      backward-compat) and COALESCE-write it so existing callers still work.
--   2. Replaces dispatch_task() to accept and persist p_provider_used at
--      dispatch time (fills it early so complete_task() can inherit it).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.complete_task(uuid, text);
--   DROP FUNCTION IF EXISTS public.dispatch_task(uuid, text, uuid, text);
--   -- recreate without provider_used from backup/original definition

-- 1. complete_task(): add p_provider_used, COALESCE-write on completion
--    Drop old 1-arg overload first so we don't leave a ghost.
DROP FUNCTION IF EXISTS public.complete_task(uuid);

CREATE OR REPLACE FUNCTION public.complete_task(
  p_task_id       uuid,
  p_provider_used text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.agent_tasks
  SET
    status        = 'completed',
    provider_used = COALESCE(p_provider_used, provider_used),
    updated_at    = now()
  WHERE id = p_task_id
    AND status NOT IN ('completed', 'failed', 'dead_letter');
END;
$$;

-- Grant execution rights to service_role (Supabase agent callers use service role)
GRANT EXECUTE ON FUNCTION public.complete_task(uuid, text) TO service_role;

-- 2. dispatch_task(): persist provider_used at dispatch time
--    Agent knows which provider it will use at dispatch; store it early.
--    COALESCE so a re-dispatch doesn't wipe an already-set value.
DROP FUNCTION IF EXISTS public.dispatch_task(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.dispatch_task(
  p_task_id       uuid,
  p_task_type     text,
  p_project_id    uuid,
  p_provider_used text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO public.agent_tasks (
    id, task_type, project_id, status, provider_used, created_at, updated_at
  )
  VALUES (
    p_task_id, p_task_type, p_project_id, 'pending', p_provider_used, now(), now()
  )
  ON CONFLICT (id) DO UPDATE
    SET
      status        = EXCLUDED.status,
      provider_used = COALESCE(EXCLUDED.provider_used, public.agent_tasks.provider_used),
      updated_at    = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.dispatch_task(uuid, text, uuid, text) TO service_role;
