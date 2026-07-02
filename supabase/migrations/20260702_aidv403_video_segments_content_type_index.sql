-- AIDV-403: 固化 video_segments (project_id, content_type) 複合索引
--
-- 背景（更正 AIDV-393 規格書）：
--   AIDV-393 規格書寫「add composite index on (project_id, status)」，但 video_segments
--   實際上沒有 status 欄位（segment 不帶獨立狀態機——狀態在 agent_tasks／video_projects
--   層追蹤）。segment 輪詢熱路徑實際以 project_id ＋ content_type
--   （script|voice|visual|final，見 20260629_aidv717_segment_assembly_trigger.sql 的
--   task_type → content_type 映射）區分段落型別，故正確索引為 (project_id, content_type)。
--
-- prod 實查（2026-07-02，Supabase MCP 唯讀）：
--   * 欄位：id, project_id, segment_index, content_type, content, version,
--     created_by_agent, created_at, updated_at, creator_id — 無 status 欄位。
--   * 索引 idx_video_segments_project_content_type ON (project_id, content_type)
--     已存在於 prod，但 repo 內無任何 migration 建立它（版控缺口）。
--
-- 本檔目的：
--   純固化（idempotent，不改 prod 現況）——把已上線的索引補進版控，確保未來
--   DB 重建或新環境遷移時能自動重現。使用 IF NOT EXISTS 守門確保重跑冪等。
--
-- 回滾：
--   DROP INDEX IF EXISTS public.idx_video_segments_project_content_type;

CREATE INDEX IF NOT EXISTS idx_video_segments_project_content_type
  ON public.video_segments (project_id, content_type);
