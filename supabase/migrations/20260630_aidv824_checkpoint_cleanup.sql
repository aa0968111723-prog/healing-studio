-- AIDV-824: checkpoint_data TTL — 清除已完成/失敗任務的 JSONB 累積
--
-- 問題：AIDV-526 加入的 checkpoint_data JSONB 欄位在任務進入終態
-- （completed / failed / dead_letter）後從未清零，導致每個分鏡段落的
-- URI 陣列（~1-2 KB/段）永久留存於 agent_tasks。50+ 段的大型影片專案
-- 每次恢復後持續累積，無任何上界。
--
-- 修法：BEFORE UPDATE OF status 觸發器——當 status 從非終態轉入終態
-- 時，在同一次 UPDATE 內把 checkpoint_data 設為 NULL，不需額外寫入。
-- BEFORE 觸發器直接改 NEW，比 AFTER 觸發器額外發一次 UPDATE 更輕量。
--
-- 覆蓋路徑：
--   - complete_task()  → status='completed'
--   - 任何直接 UPDATE agent_tasks SET status='failed'
--   - auto_close_video_project() 觸發器（AIDV-665）→ status='failed'
--   - dead_letter 升格路徑
--
-- 回滾：
--   DROP TRIGGER IF EXISTS trg_clear_checkpoint_on_terminal ON public.agent_tasks;
--   DROP FUNCTION IF EXISTS public.clear_checkpoint_on_terminal();

CREATE OR REPLACE FUNCTION public.clear_checkpoint_on_terminal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Only clear when transitioning INTO a terminal state to avoid
  -- wiping checkpoint_data on unrelated column updates.
  IF NEW.status IN ('completed', 'failed', 'dead_letter')
     AND OLD.status NOT IN ('completed', 'failed', 'dead_letter') THEN
    NEW.checkpoint_data := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_checkpoint_on_terminal ON public.agent_tasks;

CREATE TRIGGER trg_clear_checkpoint_on_terminal
  BEFORE UPDATE OF status ON public.agent_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_checkpoint_on_terminal();
