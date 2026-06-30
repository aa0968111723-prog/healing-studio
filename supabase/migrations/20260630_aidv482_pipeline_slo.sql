-- AIDV-482: /video pipeline latency SLO baselines
--
-- 問題：agent_tasks 已有 started_at / completed_at 欄位，但無 SLO 定義，
-- 無法區分「處理中」與「卡住」，無法提供創作者預估完成時間。
--
-- 本 migration 做三件事：
--   1. 建立 video_pipeline_slo 設定表（agent_type → target / alert 秒數）
--   2. 為三個創作者代理種入初始 SLO 目標（pre-launch 預估值）
--   3. 建立 detect_stalled_tasks() 與 get_project_slo_report() 函式
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.detect_stalled_tasks();
--   DROP FUNCTION IF EXISTS public.get_project_slo_report(uuid);
--   DROP FUNCTION IF EXISTS public.get_task_slo_status(uuid);
--   DROP TABLE IF EXISTS public.video_pipeline_slo;
--   DROP INDEX IF EXISTS idx_agent_tasks_started_at;

-- 1. SLO 設定表 ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.video_pipeline_slo (
  agent_type          TEXT        PRIMARY KEY,
  target_seconds      INT         NOT NULL CHECK (target_seconds > 0),
  alert_seconds       INT         NOT NULL CHECK (alert_seconds > target_seconds),
  description         TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.video_pipeline_slo IS
  'Per-agent SLO targets for the /video pipeline. target_seconds = nominal completion time; alert_seconds = threshold to surface stall to creator / move to DLQ.';

-- Row-level security: allow authenticated to read; only service_role can write.
ALTER TABLE public.video_pipeline_slo ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'video_pipeline_slo'
      AND policyname = 'slo_read_authenticated'
  ) THEN
    CREATE POLICY slo_read_authenticated ON public.video_pipeline_slo
      FOR SELECT USING (true);
  END IF;
END $$;

-- 2. 初始 SLO 種子（預估值，正式上線後依觀測數據調整）────────────────────

INSERT INTO public.video_pipeline_slo (agent_type, target_seconds, alert_seconds, description)
VALUES
  ('scene-composer-v1',  180,  300, '場景構圖代理：目標 3 分鐘，警戒 5 分鐘'),
  ('script-analyzer-v1', 120,  240, '腳本分析代理：目標 2 分鐘，警戒 4 分鐘'),
  ('video-processor-v1', 600,  900, '影片渲染代理：目標 10 分鐘，警戒 15 分鐘'),
  ('__total_pipeline__',  900, 1500, '全流程合計：目標 15 分鐘，警戒 25 分鐘')
ON CONFLICT (agent_type) DO UPDATE
  SET target_seconds = EXCLUDED.target_seconds,
      alert_seconds  = EXCLUDED.alert_seconds,
      description    = EXCLUDED.description,
      updated_at     = now();

-- 3. 索引：加速卡住任務偵測（started_at 範圍掃描）────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'agent_tasks'
      AND indexname = 'idx_agent_tasks_started_at'
  ) THEN
    CREATE INDEX idx_agent_tasks_started_at
      ON public.agent_tasks (started_at)
      WHERE started_at IS NOT NULL;
  END IF;
END $$;

-- 4. detect_stalled_tasks() — 找出已超過 alert_seconds 的 in_progress 任務 ─

CREATE OR REPLACE FUNCTION public.detect_stalled_tasks()
RETURNS TABLE (
  task_id          UUID,
  project_id       UUID,
  assigned_agent   TEXT,
  started_at       TIMESTAMPTZ,
  elapsed_seconds  INT,
  alert_seconds    INT,
  target_seconds   INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT
    t.id                                                           AS task_id,
    t.project_id,
    t.assigned_agent,
    t.started_at,
    EXTRACT(EPOCH FROM (now() - t.started_at))::INT               AS elapsed_seconds,
    COALESCE(s.alert_seconds,  900)                               AS alert_seconds,
    COALESCE(s.target_seconds, 600)                               AS target_seconds
  FROM public.agent_tasks t
  LEFT JOIN public.video_pipeline_slo s ON s.agent_type = t.assigned_agent
  WHERE t.status      = 'in_progress'
    AND t.started_at IS NOT NULL
    AND EXTRACT(EPOCH FROM (now() - t.started_at)) > COALESCE(s.alert_seconds, 900)
  ORDER BY t.started_at ASC;
$$;

COMMENT ON FUNCTION public.detect_stalled_tasks() IS
  'Returns in_progress agent_tasks that have exceeded their SLO alert threshold. Used by monitoring jobs and the creator status endpoint.';

-- 5. get_task_slo_status(task_id) — 回傳單一任務的 SLO 狀態 ───────────────

CREATE OR REPLACE FUNCTION public.get_task_slo_status(p_task_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_task          RECORD;
  v_slo           RECORD;
  v_elapsed       INT;
  v_slo_state     TEXT;
  v_eta_seconds   INT;
BEGIN
  SELECT t.status, t.assigned_agent, t.started_at, t.completed_at
  INTO v_task
  FROM public.agent_tasks t
  WHERE t.id = p_task_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'task_not_found');
  END IF;

  SELECT s.target_seconds, s.alert_seconds
  INTO v_slo
  FROM public.video_pipeline_slo s
  WHERE s.agent_type = v_task.assigned_agent;

  IF NOT FOUND THEN
    v_slo.target_seconds := 600;
    v_slo.alert_seconds  := 900;
  END IF;

  IF v_task.status IN ('completed', 'dead_letter', 'failed') THEN
    v_slo_state   := 'completed';
    v_eta_seconds := 0;
  ELSIF v_task.started_at IS NULL THEN
    v_slo_state   := 'queued';
    v_eta_seconds := v_slo.target_seconds;
  ELSE
    v_elapsed := EXTRACT(EPOCH FROM (now() - v_task.started_at))::INT;
    IF v_elapsed >= v_slo.alert_seconds THEN
      v_slo_state   := 'stalled';
      v_eta_seconds := 0;
    ELSIF v_elapsed >= v_slo.target_seconds THEN
      v_slo_state   := 'alerting';
      v_eta_seconds := v_slo.alert_seconds - v_elapsed;
    ELSE
      v_slo_state   := 'on_track';
      v_eta_seconds := v_slo.target_seconds - v_elapsed;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'task_id',        p_task_id,
    'status',         v_task.status,
    'assigned_agent', v_task.assigned_agent,
    'slo_state',      v_slo_state,
    'elapsed_seconds', CASE
                         WHEN v_task.started_at IS NOT NULL AND v_task.status = 'in_progress'
                         THEN EXTRACT(EPOCH FROM (now() - v_task.started_at))::INT
                         ELSE NULL
                       END,
    'eta_seconds',    v_eta_seconds,
    'target_seconds', v_slo.target_seconds,
    'alert_seconds',  v_slo.alert_seconds
  );
END;
$$;

COMMENT ON FUNCTION public.get_task_slo_status(UUID) IS
  'Returns SLO status for a single task: on_track | alerting | stalled | queued | completed. Used by the creator progress polling endpoint.';

-- 6. get_project_slo_report(project_id) — 全專案 SLO 摘要 ─────────────────

CREATE OR REPLACE FUNCTION public.get_project_slo_report(p_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_tasks      JSONB;
  v_on_track   INT := 0;
  v_alerting   INT := 0;
  v_stalled    INT := 0;
  v_completed  INT := 0;
  v_queued     INT := 0;
  v_row        RECORD;
  v_state      JSONB;
  v_slo_state  TEXT;
BEGIN
  SELECT jsonb_agg(
    get_task_slo_status(t.id)
  )
  INTO v_tasks
  FROM public.agent_tasks t
  WHERE t.project_id = p_project_id;

  IF v_tasks IS NULL THEN
    RETURN jsonb_build_object(
      'project_id',   p_project_id,
      'task_count',   0,
      'summary',      jsonb_build_object('on_track', 0, 'alerting', 0, 'stalled', 0, 'completed', 0, 'queued', 0),
      'tasks',        '[]'::jsonb
    );
  END IF;

  FOR v_state IN SELECT * FROM jsonb_array_elements(v_tasks) LOOP
    v_slo_state := v_state->>'slo_state';
    IF    v_slo_state = 'on_track'  THEN v_on_track  := v_on_track  + 1;
    ELSIF v_slo_state = 'alerting'  THEN v_alerting  := v_alerting  + 1;
    ELSIF v_slo_state = 'stalled'   THEN v_stalled   := v_stalled   + 1;
    ELSIF v_slo_state = 'completed' THEN v_completed := v_completed + 1;
    ELSIF v_slo_state = 'queued'    THEN v_queued    := v_queued    + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'project_id',  p_project_id,
    'task_count',  jsonb_array_length(v_tasks),
    'summary',     jsonb_build_object(
      'on_track',  v_on_track,
      'alerting',  v_alerting,
      'stalled',   v_stalled,
      'completed', v_completed,
      'queued',    v_queued
    ),
    'tasks',       v_tasks
  );
END;
$$;

COMMENT ON FUNCTION public.get_project_slo_report(UUID) IS
  'Returns a full SLO report for all agent_tasks belonging to a video project. Aggregates slo_state counts + per-task detail. Used by the creator task status endpoint.';
