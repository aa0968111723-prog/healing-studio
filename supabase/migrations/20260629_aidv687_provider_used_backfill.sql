-- AIDV-687: provider_used NULL backfill + column hardening
--
-- Context:
--   AIDV-550/666 fixed complete_task() to preserve provider_used via COALESCE.
--   dispatch_task() already reads provider from agent_capability_registry and
--   stores it in provider_used. However, when no agent has provider_capabilities
--   configured the INSERT still lands NULL. Historical rows (pre-fix) also have
--   provider_used=NULL.
--
-- This migration:
--   1. Backfills all existing NULL rows → 'unknown'.
--   2. Sets DEFAULT 'unknown' so plain INSERTs without the column get a value.
--   3. Creates coerce_provider_used_not_null() BEFORE INSERT/UPDATE trigger so
--      any future explicit NULL (from dispatch_task when provider is unresolved)
--      is silently coerced — no caller changes required.
--   4. Adds NOT NULL constraint (safe because trigger fires before constraint
--      check and the backfill covers all existing rows).
--
-- Rollback:
--   ALTER TABLE public.agent_tasks ALTER COLUMN provider_used DROP NOT NULL;
--   ALTER TABLE public.agent_tasks ALTER COLUMN provider_used DROP DEFAULT;
--   DROP TRIGGER IF EXISTS trg_coerce_provider_used ON public.agent_tasks;
--   DROP FUNCTION IF EXISTS public.coerce_provider_used_not_null();
--   -- (data cannot be rolled back; 'unknown' rows stay 'unknown')

-- 1. Backfill
UPDATE public.agent_tasks
SET provider_used = 'unknown'
WHERE provider_used IS NULL;

-- 2. Column default
ALTER TABLE public.agent_tasks
  ALTER COLUMN provider_used SET DEFAULT 'unknown';

-- 3. Trigger: coerce NULL → 'unknown' on every INSERT or explicit NULL UPDATE
CREATE OR REPLACE FUNCTION public.coerce_provider_used_not_null()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.provider_used IS NULL THEN
    NEW.provider_used := 'unknown';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public' AND c.relname = 'agent_tasks'
      AND t.tgname = 'trg_coerce_provider_used'
  ) THEN
    CREATE TRIGGER trg_coerce_provider_used
      BEFORE INSERT OR UPDATE OF provider_used ON public.agent_tasks
      FOR EACH ROW
      EXECUTE FUNCTION public.coerce_provider_used_not_null();
  END IF;
END $$;

-- 4. NOT NULL constraint (trigger fires first, so no INSERT/UPDATE can land NULL)
ALTER TABLE public.agent_tasks
  ALTER COLUMN provider_used SET NOT NULL;
