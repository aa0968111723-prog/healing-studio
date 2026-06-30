-- AIDV-834: system_alerts agent dedup unique index
--
-- 問題（R53 aidv-optimize-hourly 發現）：
--   pg_cron 心跳偵測每 5 分鐘為 tts-synthesizer-v1 插入一筆 CRITICAL agent_offline 警示，
--   沒有去重，60+ 筆積累（18 條/小時），形成警示疲勞並增加不必要的 DB 寫入。
--
-- 修法：
--   在 system_alerts 加入局部唯一索引，確保同一 (alert_type, agent_id) 每次只有一筆
--   未解決（resolved_at IS NULL）的警示存在；新插入相同組合時會觸發衝突，
--   讓呼叫方改用 UPSERT（ON CONFLICT DO UPDATE）模式來更新 last_seen 而非反覆 INSERT。
--
-- 注意：PostgreSQL UNIQUE index 把 NULL 視為互不相等，所以 details->>'agent_id'
--   為 NULL 的警示（如 heartbeat_silence 類型）不受影響，仍可多筆並存。
--
-- 已套用說明：
--   本索引已於 2026-06-30 R53 循環由 aidv-autodev-hourly 直接透過 Supabase MCP 套用
--   到 prod DB（見 AIDV-835），本文件補充入版控，確保未來 DB 重建或新環境遷移時
--   能自動重現。使用 pg_indexes 守門確保重跑冪等。
--
-- 回滾：
--   DROP INDEX IF EXISTS public.idx_system_alerts_active_agent_dedup;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'system_alerts'
      AND indexname  = 'idx_system_alerts_active_agent_dedup'
  ) THEN
    CREATE UNIQUE INDEX idx_system_alerts_active_agent_dedup
      ON public.system_alerts (alert_type, (details->>'agent_id'))
      WHERE resolved_at IS NULL;
  END IF;
END $$;
