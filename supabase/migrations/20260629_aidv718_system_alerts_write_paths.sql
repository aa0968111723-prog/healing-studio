-- AIDV-718: Activate system_alerts write paths (observability layer was silent)
--
-- Three root causes found:
--
--   1. detect_pipeline_stall() queried `agent_registry_live` (a TTL-filtered view)
--      for rows WHERE status='idle' AND last_seen < 1h. These conditions are mutually
--      exclusive: agents in the live view have last_seen within their TTL (≤120s), so
--      `last_seen < 1h` is never true. v_idle_agent_count was always 0 → alert never
--      fires even when projects are stuck.
--      Fix: replace with agent_capability_registry check for silence > 5 min; fire
--      alert on stuck projects alone (silence affects severity, not gating).
--
--   2. check-heartbeat-liveness pg_cron job emitted pg_notify only — never wrote
--      to system_alerts.
--      Fix: reschedule with an INSERT into system_alerts (deduplicated, 30 min window).
--
--   3. system_alerts has only a SELECT RLS policy; no INSERT policy for service_role.
--      (pg_cron / SECURITY DEFINER functions bypass RLS as postgres superuser, but
--      any direct service_role RPC call would be blocked.)
--      Fix: add INSERT policy for service_role WITH CHECK (true).
--
-- Rollback:
--   DROP POLICY IF EXISTS system_alerts_service_role_insert ON public.system_alerts;
--   -- restore detect_pipeline_stall() to original body (see git history)
--   SELECT cron.unschedule('check-heartbeat-liveness');
--   SELECT cron.schedule('check-heartbeat-liveness', '*/5 * * * *', '<original command>');
--   DELETE FROM public.system_alerts WHERE alert_type = 'self_test';


-- ─── 1. INSERT RLS policy for service_role ───────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    JOIN pg_class ON pg_class.oid = pg_policy.polrelid
    WHERE pg_class.relname = 'system_alerts'
      AND pg_class.relnamespace = 'public'::regnamespace
      AND polname = 'system_alerts_service_role_insert'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY system_alerts_service_role_insert
        ON public.system_alerts
        FOR INSERT
        TO service_role
        WITH CHECK (true)
    $pol$;
  END IF;
END $$;


-- ─── 2. Fix detect_pipeline_stall() ──────────────────────────────────────────────
-- Old logic: queried agent_registry_live WHERE last_seen < 1h (always 0 — view TTL
-- makes this self-contradictory). New logic: check agent_capability_registry for
-- silence > 5 min; fire on stuck projects with silence controlling severity.

CREATE OR REPLACE FUNCTION public.detect_pipeline_stall()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_silent_agent_count  BIGINT;
  v_total_agent_count   BIGINT;
  v_stuck_proj_count    BIGINT;
  v_recent_alert_count  BIGINT;
BEGIN
  -- Agents silent for > 5 min (heartbeat gap — use raw table, not TTL-filtered view)
  SELECT COUNT(*) INTO v_silent_agent_count
  FROM public.agent_capability_registry
  WHERE last_seen < now() - interval '5 minutes';

  SELECT COUNT(*) INTO v_total_agent_count
  FROM public.agent_capability_registry;

  -- Non-terminal video_projects (something is waiting to be processed)
  SELECT COUNT(*) INTO v_stuck_proj_count
  FROM public.video_projects
  WHERE status NOT IN ('completed', 'failed');

  -- Deduplicate: no pipeline_stall alert in the last 30 min (matches cron schedule)
  SELECT COUNT(*) INTO v_recent_alert_count
  FROM public.system_alerts
  WHERE alert_type = 'pipeline_stall'
    AND created_at > now() - interval '30 minutes';

  -- Fire when projects are stuck; agent silence determines severity
  IF v_stuck_proj_count > 0 AND v_recent_alert_count = 0 THEN
    INSERT INTO public.system_alerts (alert_type, severity, message, details)
    VALUES (
      'pipeline_stall',
      CASE
        WHEN v_total_agent_count = 0     THEN 'CRITICAL'
        WHEN v_silent_agent_count > 0    THEN 'HIGH'
        ELSE                                  'WARNING'
      END,
      format(
        'Pipeline stall: %s video_project(s) non-terminal; %s/%s agent(s) silent >5m',
        v_stuck_proj_count,
        v_silent_agent_count,
        v_total_agent_count
      ),
      jsonb_build_object(
        'silent_agent_count',  v_silent_agent_count,
        'total_agent_count',   v_total_agent_count,
        'stuck_project_count', v_stuck_proj_count,
        'detected_at',         now()
      )
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.detect_pipeline_stall() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detect_pipeline_stall() TO service_role;


-- ─── 3. Reschedule check-heartbeat-liveness to also write system_alerts ──────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-heartbeat-liveness') THEN
    PERFORM cron.unschedule('check-heartbeat-liveness');
  END IF;
END $$;

SELECT cron.schedule(
  'check-heartbeat-liveness',
  '*/5 * * * *',
  $jobcmd$
  DO $inner$
  DECLARE
    v_active_count  INT;
    v_recent_count  INT;
  BEGIN
    SELECT COUNT(*) INTO v_active_count
    FROM public.agent_capability_registry
    WHERE last_seen > NOW() - INTERVAL '10 minutes';

    IF v_active_count = 0 THEN
      -- Deduplicate: no heartbeat_silence alert in last 30 min
      SELECT COUNT(*) INTO v_recent_count
      FROM public.system_alerts
      WHERE alert_type = 'heartbeat_silence'
        AND created_at > NOW() - INTERVAL '30 minutes';

      IF v_recent_count = 0 THEN
        INSERT INTO public.system_alerts (alert_type, severity, message, details)
        VALUES (
          'heartbeat_silence',
          'CRITICAL',
          'No agent heartbeats received in the last 10 minutes',
          jsonb_build_object(
            'checked_at', NOW()::text,
            'window_minutes', 10,
            'aidv', 'AIDV-718'
          )
        );
      END IF;

      PERFORM pg_notify(
        'security_alert',
        json_build_object(
          'type',     'heartbeat_silence',
          'duration', '10m',
          'severity', 'CRITICAL',
          'ts',       NOW()::text,
          'message',  'No agent heartbeats received in the last 10 minutes'
        )::text
      );
    END IF;
  END;
  $inner$
  $jobcmd$
);


-- ─── 4. Seed verification: confirm INSERT path works, alert resolved immediately ──

INSERT INTO public.system_alerts (alert_type, severity, message, details, resolved_at)
VALUES (
  'self_test',
  'INFO',
  'AIDV-718: system_alerts INSERT path verified by migration',
  jsonb_build_object(
    'migration',     'AIDV-718',
    'fixed',         ARRAY['detect_pipeline_stall logic', 'check-heartbeat-liveness INSERT', 'service_role RLS policy'],
    'verified_at',   now()::text
  ),
  now()  -- immediately resolved — this is a diagnostic marker, not an active alert
);
