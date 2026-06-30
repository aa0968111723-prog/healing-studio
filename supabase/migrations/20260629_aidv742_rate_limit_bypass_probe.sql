-- AIDV-742 AC#4: Cron probe — alert when agent_tasks were submitted this hour
-- but creator_job_throttle shows no matching rows (trigger bypassed or missing).
-- Fires every 15 min; deduplicates against unresolved alerts within 6 hours.

SELECT cron.schedule(
  'rate-limit-bypass-probe',
  '*/15 * * * *',
  $$
  INSERT INTO public.system_alerts (alert_type, severity, message, details)
  SELECT
    'rate_limiter_inactive',
    'medium',
    'Rate limiter bypass: agent_tasks exist this hour but creator_job_throttle is empty',
    jsonb_build_object(
      'recent_task_count', (
        SELECT COUNT(*) FROM public.agent_tasks
        WHERE created_at >= date_trunc('hour', now())
      ),
      'throttle_rows_this_hour', (
        SELECT COUNT(*) FROM public.creator_job_throttle
        WHERE window_start = date_trunc('hour', now())
      ),
      'detected_at', now()
    )
  WHERE (
    SELECT COUNT(*) FROM public.agent_tasks
    WHERE created_at >= date_trunc('hour', now())
  ) > 0
  AND (
    SELECT COUNT(*) FROM public.creator_job_throttle
    WHERE window_start = date_trunc('hour', now())
  ) = 0
  AND NOT EXISTS (
    SELECT 1 FROM public.system_alerts
    WHERE alert_type = 'rate_limiter_inactive'
    AND resolved_at IS NULL
    AND created_at > now() - interval '6 hours'
  );
  $$
);
