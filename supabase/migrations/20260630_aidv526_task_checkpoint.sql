-- AIDV-526: 任務段落 checkpoint — 部分失敗後從中斷點恢復
--
-- 問題：代理任務完成 2/5 段後失敗，dispatcher 無從恢復，只能從頭重試。
-- 這樣既浪費已成功段落的 API 花費，也因提示鏈不同而產生前後不一致的輸出。
--
-- 本次變更：
--   1. agent_tasks 加 checkpoint_data JSONB 欄位（idempotent DO 塊守門）
--   2. update_task_checkpoint() — 代理每完成一個段落呼叫，寫入 checkpoint_data
--      並透過 pg_notify('video_task_progress') 發出 segment_completed 事件供 SSE 轉發
--   3. get_task_checkpoint() — dispatcher retry 前呼叫，讀取已完成段落清單
--   4. emit_segment_resume_events() — retry 時對已完成段落逐條發出 segment_resumed SSE 事件
--
-- 回滾：
--   DROP FUNCTION IF EXISTS public.emit_segment_resume_events(uuid);
--   DROP FUNCTION IF EXISTS public.get_task_checkpoint(uuid);
--   DROP FUNCTION IF EXISTS public.update_task_checkpoint(uuid, int, text, int);
--   ALTER TABLE public.agent_tasks DROP COLUMN IF EXISTS checkpoint_data;

-- 1. checkpoint_data 欄位（冪等：已存在則跳過）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'agent_tasks'
      AND column_name  = 'checkpoint_data'
  ) THEN
    ALTER TABLE public.agent_tasks
      ADD COLUMN checkpoint_data JSONB;
  END IF;
END $$;

-- 2. update_task_checkpoint() — 代理每完成一個段落就呼叫
--    以 JSONB merge 方式保存：
--      completed_segments: [1, 2, ...]   (已完成段落索引，1-based，自動去重排序)
--      segment_uris: {"1": "https://...", "2": "..."}  (各段落儲存 URI)
--      total_segments: N                 (任務總段落數)
--      last_updated: "2026-06-30T..."
--    同時透過 pg_notify 觸發 SSE segment_completed 事件。
CREATE OR REPLACE FUNCTION public.update_task_checkpoint(
  p_task_id        uuid,
  p_segment_index  int,   -- 1-based，剛完成的段落編號
  p_segment_uri    text,  -- 已完成段落的媒體儲存 URI
  p_total_segments int    -- 任務的總段落數（用於 SSE of 欄位）
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_checkpoint jsonb;
BEGIN
  UPDATE public.agent_tasks
  SET
    checkpoint_data = jsonb_build_object(
      'completed_segments',
      (
        SELECT jsonb_agg(DISTINCT seg ORDER BY seg)
        FROM (
          SELECT (elem::text)::int AS seg
          FROM jsonb_array_elements_text(
            COALESCE(checkpoint_data -> 'completed_segments', '[]'::jsonb)
          ) AS elem
          UNION ALL
          SELECT p_segment_index
        ) combined
      ),
      'segment_uris',
      COALESCE(checkpoint_data -> 'segment_uris', '{}'::jsonb)
        || jsonb_build_object(p_segment_index::text, p_segment_uri),
      'total_segments', p_total_segments,
      'last_updated', to_json(now())
    ),
    updated_at = now()
  WHERE id = p_task_id
  RETURNING checkpoint_data INTO v_checkpoint;

  -- SSE：通知 segment_completed，讓 Realtime proxy 推播給創作者
  PERFORM pg_notify(
    'video_task_progress',
    json_build_object(
      'event',   'segment_completed',
      'task_id', p_task_id,
      'segment', p_segment_index,
      'of',      p_total_segments,
      'uri',     p_segment_uri
    )::text
  );

  RETURN v_checkpoint;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_task_checkpoint(uuid, int, text, int)
  TO service_role;

-- 3. get_task_checkpoint() — dispatcher retry 前讀取，知道哪些段落已完成可跳過
CREATE OR REPLACE FUNCTION public.get_task_checkpoint(p_task_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    checkpoint_data,
    '{"completed_segments":[],"segment_uris":{},"total_segments":0}'::jsonb
  )
  FROM public.agent_tasks
  WHERE id = p_task_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_task_checkpoint(uuid)
  TO service_role;

-- 4. emit_segment_resume_events() — retry 時對已完成段落逐條發出 segment_resumed 事件
--    讓創作者端 SSE 知道「這些段落不需要重新生成，已從 checkpoint 恢復」
--    返回發出的事件數（等於已完成段落數）
CREATE OR REPLACE FUNCTION public.emit_segment_resume_events(p_task_id uuid)
RETURNS int
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_checkpoint    jsonb;
  v_total         int;
  v_seg_idx       int;
  v_count         int := 0;
BEGIN
  SELECT COALESCE(checkpoint_data, '{}'::jsonb)
  INTO v_checkpoint
  FROM public.agent_tasks
  WHERE id = p_task_id;

  v_total := COALESCE((v_checkpoint ->> 'total_segments')::int, 0);

  FOR v_seg_idx IN
    SELECT (elem::text)::int
    FROM jsonb_array_elements_text(
      COALESCE(v_checkpoint -> 'completed_segments', '[]'::jsonb)
    ) AS elem
    ORDER BY 1
  LOOP
    PERFORM pg_notify(
      'video_task_progress',
      json_build_object(
        'event',   'segment_resumed',
        'task_id', p_task_id,
        'segment', v_seg_idx,
        'of',      v_total
      )::text
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.emit_segment_resume_events(uuid)
  TO service_role;
