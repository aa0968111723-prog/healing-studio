-- AIDV-428: agent-heartbeat pg_cron auth fix
--
-- Root cause: pg_cron scheduled the heartbeat HTTP call without an
-- Authorization header, so the Edge Function (application-level auth)
-- rejected every tick → agent_capability_registry has 0 rows →
-- entire multi-agent pipeline is dead.
--
-- This migration:
--   1. Ensures agent_capability_registry table exists (idempotent).
--   2. Drops the old unauthenticated cron job (if present).
--   3. Re-creates the cron job passing x-agent-secret from the database
--      setting app.settings.service_role_key (set this value once via:
--
--        ALTER DATABASE postgres
--          SET "app.settings.service_role_key" = '<your-service-role-key>';
--
--      or via Supabase Vault — see comments below).
--
-- Prerequisites:
--   • pg_cron extension enabled
--   • pg_net  extension enabled
--   • "app.settings.supabase_function_url" set to e.g.
--       https://<project-ref>.supabase.co/functions/v1
--   • "app.settings.service_role_key" set to the Supabase service role JWT
--
-- Rollback:
--   SELECT cron.unschedule('agent-heartbeat');
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. agent_capability_registry table (Supabase/PostgreSQL)
CREATE TABLE IF NOT EXISTS agent_capability_registry (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id    text        NOT NULL UNIQUE,
  capabilities jsonb      NOT NULL DEFAULT '[]',
  current_load int        NOT NULL DEFAULT 0,
  max_load    int         NOT NULL DEFAULT 5,
  status      text        NOT NULL DEFAULT 'idle',
  last_seen   timestamptz NOT NULL DEFAULT now(),
  metadata    jsonb       NOT NULL DEFAULT '{}'
);

-- Index for "find idle agents by load" query
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'agent_capability_registry'
      AND indexname  = 'idx_acr_last_seen'
  ) THEN
    CREATE INDEX idx_acr_last_seen ON agent_capability_registry (last_seen DESC);
  END IF;
END $$;

-- 2. Remove the old unauthenticated job (if it exists)
SELECT cron.unschedule('agent-heartbeat')
WHERE  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-heartbeat');

-- 3. Re-schedule with x-agent-secret header pulled from database setting.
--    The Edge Function accepts x-agent-secret == AGENT_SECRET env var
--    (falls back to SUPABASE_SERVICE_ROLE_KEY), so sending the service
--    role key here satisfies both the Supabase gateway (verify_jwt=true
--    is bypassed by x-agent-secret at app layer) and the function's own
--    application-level auth check.
--
--    NOTE: set app.settings.service_role_key BEFORE running this migration:
--      ALTER DATABASE postgres
--        SET "app.settings.service_role_key" = '<service-role-jwt>';
--      ALTER DATABASE postgres
--        SET "app.settings.supabase_function_url" =
--          'https://<project-ref>.supabase.co/functions/v1';
--
--    Alternatively, use Supabase Vault:
--      Replace current_setting(...) calls below with:
--        (SELECT decrypted_secret FROM vault.decrypted_secrets
--          WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1)
SELECT cron.schedule(
  'agent-heartbeat',
  '*/1 * * * *',
  $$
    SELECT net.http_post(
      url     := current_setting('app.settings.supabase_function_url')
                 || '/agent-heartbeat',
      body    := '{"agent_id":"pg-cron-heartbeat","capabilities":["scheduling","cron"],"current_load":0,"max_load":1}'::jsonb,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-agent-secret',
                   current_setting('app.settings.service_role_key', true)
                 )
    ) AS request_id;
  $$
);
