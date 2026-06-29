-- AIDV-528: Map rate_limit_exceeded → HTTP 429 in dispatch_task
-- Previously: enforce_agent_task_rate_limit trigger (AIDV-742) raised SQLSTATE P0001
-- which propagated as HTTP 500 through PostgREST. Now dispatch_task catches that
-- exception and re-raises as PT429 so PostgREST returns HTTP 429 with a
-- creator-readable message and seconds-until-next-hour as retry_after.
-- CREATE OR REPLACE preserves existing proacl ({postgres=X/postgres,service_role=X/postgres}).

CREATE OR REPLACE FUNCTION public.dispatch_task(
  p_project_id  uuid,
  p_task_type   text,
  p_capability  text    DEFAULT 'general',
  p_priority    integer DEFAULT 5,
  p_payload     jsonb   DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_id          uuid;
  v_project_owner      uuid;
  v_agent_count        int;
  v_selected_agent     text;
  v_task_id            uuid;
  v_provider_used      text;
  v_media_type         text;
  v_failed_providers   text[];
  v_chain_providers    jsonb;
  v_effective_provider text;
  v_retry_after        int;
BEGIN
  -- AIDV-380 OWNERSHIP GUARD: reject if caller does not own the project.
  -- auth.uid() returns NULL for service_role JWT; service_role bypasses ownership check.
  v_caller_id := auth.uid();

  IF v_caller_id IS NOT NULL THEN
    SELECT creator_id INTO v_project_owner
    FROM public.video_projects
    WHERE id = p_project_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'error',   'project_not_found',
        'message', 'Project does not exist or is not accessible',
        'ts',      now()::text
      );
    END IF;

    IF v_project_owner IS DISTINCT FROM v_caller_id THEN
      RETURN jsonb_build_object(
        'error',   'forbidden',
        'message', 'Caller does not own the specified project',
        'ts',      now()::text
      );
    END IF;
  END IF;

  -- GUARD: count available agents with the required capability
  SELECT COUNT(*) INTO v_agent_count
  FROM public.agent_registry_live
  WHERE p_capability = ANY(capabilities)
    AND status != 'busy'
    AND current_load < max_load;

  IF v_agent_count = 0 THEN
    RETURN jsonb_build_object(
      'error',       'no_agents_available',
      'capability',  p_capability,
      'retry_after', 60,
      'message',     'No agents available for capability: ' || p_capability || '. Registry is empty or all agents are busy.',
      'ts',          now()::text
    );
  END IF;

  -- AIDV-522: Collect providers currently flagged as failed in system_alerts
  SELECT COALESCE(
    ARRAY(
      SELECT details->>'provider'
      FROM public.system_alerts
      WHERE resolved_at IS NULL
        AND severity IN ('critical', 'high')
        AND details ? 'provider'
    ),
    ARRAY[]::text[]
  ) INTO v_failed_providers;

  -- AIDV-522: Select best agent — prefer agents whose primary provider is NOT in the failed list
  SELECT agent_id INTO v_selected_agent
  FROM public.agent_registry_live
  WHERE p_capability = ANY(capabilities)
    AND status != 'busy'
    AND current_load < max_load
  ORDER BY
    CASE
      WHEN (
        SELECT acr.provider_capabilities->>'primary'
        FROM public.agent_capability_registry acr
        WHERE acr.agent_id = agent_registry_live.agent_id
      ) = ANY(v_failed_providers) THEN 1
      ELSE 0
    END ASC,
    (current_load::float / NULLIF(max_load, 0)) ASC,
    last_seen DESC
  LIMIT 1;

  -- AIDV-554: Get the selected agent's primary provider and media type
  SELECT
    provider_capabilities->>'primary',
    provider_capabilities->>'media_type'
  INTO v_provider_used, v_media_type
  FROM public.agent_capability_registry
  WHERE agent_id = v_selected_agent
  LIMIT 1;

  -- AIDV-522: If primary provider is failed, resolve next healthy provider from fallback chain
  v_effective_provider := v_provider_used;

  IF v_provider_used = ANY(v_failed_providers) AND v_media_type IS NOT NULL THEN
    SELECT ordered_providers INTO v_chain_providers
    FROM public.provider_fallback_chains
    WHERE media_type = v_media_type
    LIMIT 1;

    IF v_chain_providers IS NOT NULL THEN
      SELECT elem INTO v_effective_provider
      FROM jsonb_array_elements_text(v_chain_providers) AS t(elem)
      WHERE t.elem <> ALL(v_failed_providers)
      LIMIT 1;
    END IF;

    IF v_effective_provider IS NULL OR v_effective_provider = ANY(v_failed_providers) THEN
      RETURN jsonb_build_object(
        'error',            'no_capacity_for_capability',
        'capability',       p_capability,
        'media_type',       v_media_type,
        'failed_providers', v_failed_providers,
        'retry_after',      120,
        'message',          'All providers for capability "' || p_capability || '" are currently unavailable. Retry later.',
        'ts',               now()::text
      );
    END IF;
  END IF;

  -- AIDV-528: Wrap INSERT in a nested block to catch rate-limit exception from
  -- enforce_agent_task_rate_limit trigger (AIDV-742).  Trigger raises P0001 when
  -- creator exceeds 20 agent_tasks/hour; we convert to PT429 so PostgREST
  -- returns HTTP 429 instead of 500.
  BEGIN
    INSERT INTO public.agent_tasks (
      project_id,
      assigned_agent,
      task_type,
      capability_required,
      status,
      priority,
      payload,
      provider_used
    ) VALUES (
      p_project_id,
      v_selected_agent,
      p_task_type,
      p_capability,
      'queued',
      p_priority,
      p_payload,
      v_effective_provider
    )
    RETURNING id INTO v_task_id;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM LIKE 'rate_limit_exceeded%' THEN
        v_retry_after := EXTRACT(EPOCH FROM
          (date_trunc('hour', now()) + interval '1 hour') - now()
        )::int;
        RAISE EXCEPTION 'Creator has exceeded 20 agent_tasks per hour. Retry after % seconds (next clock-hour boundary).', v_retry_after
          USING ERRCODE = 'PT429',
                DETAIL  = format(
                  '{"error":"rate_limit_exceeded","retry_after":%s,"cap":20}',
                  v_retry_after
                );
      ELSE
        RAISE;
      END IF;
  END;

  RETURN jsonb_build_object(
    'task_id',           v_task_id,
    'assigned_agent',    v_selected_agent,
    'provider_used',     v_effective_provider,
    'provider_primary',  v_provider_used,
    'provider_switched', (v_effective_provider IS DISTINCT FROM v_provider_used),
    'status',            'queued',
    'ts',                now()::text
  );
END;
$$;
