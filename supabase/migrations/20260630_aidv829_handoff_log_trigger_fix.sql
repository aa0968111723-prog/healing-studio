-- AIDV-829: agent_handoff_log write trigger fix
--
-- 問題雙重根因：
-- ①  write_handoff_from_task_dispatch() 在 parent_task_id IS NULL 時直接 RETURN NEW，
--     但 dispatch_task() 創建的任務永遠不帶 parent_task_id（函式簽名無此參數），
--     導致所有派工皆被 early-return 略過，agent_handoff_log 永遠 0 行。
-- ②  函式的 INSERT 遺漏 handoff_at（timestamptz NOT NULL）和 status（text NOT NULL）兩個
--     必填欄位，即使 parent_task_id 有值也會以 NOT NULL 違規失敗。
--
-- 修法：
-- ①  移除 parent_task_id IS NULL 的 early-return——改為直接寫入，
--     from_task_id = NEW.parent_task_id（NULL = 初始派工，可接受）。
--     每一次 dispatch_task() INSERT 都產生一筆 handoff log，涵蓋完整派工鏈。
-- ②  INSERT 補上 handoff_at = now(), status = 'dispatched'。
--
-- 回滾：
--   RESTORE 舊函式即可；trigger 不動。

CREATE OR REPLACE FUNCTION public.write_handoff_from_task_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_creator_id    uuid;
  v_from_agent    text;
  v_payload_hash  text;
BEGIN
  -- Resolve project owner (needed for creator_id NOT NULL constraint).
  -- If project doesn't exist, skip silently — ownership guard in dispatch_task
  -- already rejected unknown projects before the INSERT reached this trigger.
  SELECT creator_id INTO v_creator_id
  FROM public.video_projects
  WHERE id = NEW.project_id;

  IF v_creator_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- If this is a child task, look up the parent agent and its result hash.
  -- For initial dispatches (parent_task_id IS NULL), from_agent stays NULL —
  -- that's valid since agent_handoff_log.from_agent is nullable.
  IF NEW.parent_task_id IS NOT NULL THEN
    SELECT
      assigned_agent,
      md5(result::text)
    INTO v_from_agent, v_payload_hash
    FROM public.agent_tasks
    WHERE id = NEW.parent_task_id;
  END IF;

  INSERT INTO public.agent_handoff_log (
    project_id,
    from_task_id,
    to_task_id,
    from_agent,
    to_agent,
    payload_hash,
    handoff_at,
    status,
    creator_id
  ) VALUES (
    NEW.project_id,
    NEW.parent_task_id,   -- NULL for initial dispatch, non-null for chained tasks
    NEW.id,
    v_from_agent,
    NEW.assigned_agent,
    v_payload_hash,
    now(),
    'dispatched',
    v_creator_id
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;
