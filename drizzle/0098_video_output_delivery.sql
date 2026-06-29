-- 0098: video_projects 加 output_storage_path / output_signed_url / output_expires_at
-- AIDV-684: 快取影片輸出 URL，讓完成頁不必再查 digital_asset_library。
-- 三欄各自有 information_schema 守門（migration 三鐵則）。

SET @vp_osp_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'video_projects'
      AND column_name  = 'output_storage_path'
  ),
  'SELECT 1',
  'ALTER TABLE `video_projects` ADD COLUMN `output_storage_path` text NULL'
);
--> statement-breakpoint
PREPARE vp_osp FROM @vp_osp_stmt;
--> statement-breakpoint
EXECUTE vp_osp;
--> statement-breakpoint
DEALLOCATE PREPARE vp_osp;
--> statement-breakpoint
SET @vp_osu_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'video_projects'
      AND column_name  = 'output_signed_url'
  ),
  'SELECT 1',
  'ALTER TABLE `video_projects` ADD COLUMN `output_signed_url` text NULL'
);
--> statement-breakpoint
PREPARE vp_osu FROM @vp_osu_stmt;
--> statement-breakpoint
EXECUTE vp_osu;
--> statement-breakpoint
DEALLOCATE PREPARE vp_osu;
--> statement-breakpoint
SET @vp_oea_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'video_projects'
      AND column_name  = 'output_expires_at'
  ),
  'SELECT 1',
  'ALTER TABLE `video_projects` ADD COLUMN `output_expires_at` timestamp NULL'
);
--> statement-breakpoint
PREPARE vp_oea FROM @vp_oea_stmt;
--> statement-breakpoint
EXECUTE vp_oea;
--> statement-breakpoint
DEALLOCATE PREPARE vp_oea;
