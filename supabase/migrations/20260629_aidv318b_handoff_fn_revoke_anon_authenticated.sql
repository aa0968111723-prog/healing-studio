-- AIDV-318 follow-up: revoke anon/authenticated EXECUTE on write_handoff_from_task_dispatch()
--
-- Security advisors flagged the function after the initial AIDV-318 migration:
--   anon_security_definer_function_executable  (WARN)
--   authenticated_security_definer_function_executable  (WARN)
-- Same pattern as AIDV-721/722 for detect_pipeline_stall(). REVOKE ALL FROM PUBLIC
-- in the original migration leaves implicit grants; explicit role revocation required.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'write_handoff_from_task_dispatch'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.write_handoff_from_task_dispatch() FROM anon, authenticated';
  END IF;
END $$;
