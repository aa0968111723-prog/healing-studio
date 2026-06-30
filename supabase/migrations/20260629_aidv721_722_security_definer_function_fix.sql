-- AIDV-721 + AIDV-722: Security advisor ERROR/WARN hardening
--
-- AIDV-721 (ERROR): agent_task_dlq view ran as SECURITY DEFINER (owner = postgres),
--   bypassing RLS — any authenticated user could read dead-letter tasks for ALL creators.
--   Fix: recreate with explicit security_invoker = true (PostgreSQL 15+).
--
-- AIDV-722 (WARN × 3):
--   a) detect_pipeline_stall() callable by anon + authenticated as SECURITY DEFINER
--      → DoS / task-failure injection via unauthenticated REST calls.
--      Fix: REVOKE EXECUTE from anon, authenticated.
--   b) detect_pipeline_stall() + guard_video_project_completion() have mutable
--      search_path → schema-poisoning vector.
--      Fix: pin search_path = public, pg_catalog on both functions.
--
-- This migration is idempotent; safe to re-run.


-- ─── AIDV-721: agent_task_dlq → SECURITY INVOKER ──────────────────────────────

DROP VIEW IF EXISTS public.agent_task_dlq;

CREATE VIEW public.agent_task_dlq
  WITH (security_invoker = true)
AS
  SELECT
    id,
    project_id,
    assigned_agent,
    task_type,
    capability_required,
    status,
    priority,
    payload,
    result,
    retry_count,
    max_retries,
    error_message,
    created_at,
    updated_at,
    started_at,
    completed_at
  FROM public.agent_tasks
  WHERE status = 'dead_letter'
  ORDER BY created_at DESC;

-- Restrict direct anon access; authenticated access flows through RLS on agent_tasks
REVOKE SELECT ON public.agent_task_dlq FROM anon;
GRANT  SELECT ON public.agent_task_dlq TO authenticated;


-- ─── AIDV-722a: REVOKE anon/authenticated EXECUTE on detect_pipeline_stall ────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'detect_pipeline_stall'
  ) THEN
    -- Only service_role / pg_cron should invoke this function
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.detect_pipeline_stall() FROM anon, authenticated';
  END IF;
END $$;


-- ─── AIDV-722b: Pin search_path on detect_pipeline_stall ──────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'detect_pipeline_stall'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.detect_pipeline_stall() SET search_path = public, pg_catalog';
  END IF;
END $$;


-- ─── AIDV-722b: Pin search_path on guard_video_project_completion ─────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'guard_video_project_completion'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.guard_video_project_completion() SET search_path = public, pg_catalog';
  END IF;
END $$;
