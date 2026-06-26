-- 0095: video_projects 加 output_spec（冪等 — information_schema 守門）
-- AIDV-260: 影片輸出規格 resolution/fps/codec 複合欄位，
-- 讓 Fal.ai 派發時從 DB 讀取取代硬編碼 1080p/30fps/h264。

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name  = 'video_projects'
      AND column_name = 'output_spec'
  ),
  'SELECT 1',
  'ALTER TABLE `video_projects` ADD `output_spec` json'
);
--> statement-breakpoint
PREPARE vp_os_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE vp_os_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE vp_os_stmt;
