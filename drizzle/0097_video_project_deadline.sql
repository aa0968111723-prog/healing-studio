-- 0097: video_projects 加 deadline_at + priority_class（冪等 — information_schema 守門）
-- AIDV-338: 影片截止時間與優先等級，供派發排程使用。

SET @vp_dl_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'video_projects'
      AND column_name  = 'deadline_at'
  ),
  'SELECT 1',
  'ALTER TABLE `video_projects` ADD COLUMN `deadline_at` timestamp NULL'
);
--> statement-breakpoint
PREPARE vp_dl FROM @vp_dl_stmt;
--> statement-breakpoint
EXECUTE vp_dl;
--> statement-breakpoint
DEALLOCATE PREPARE vp_dl;
--> statement-breakpoint
SET @vp_pc_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'video_projects'
      AND column_name  = 'priority_class'
  ),
  'SELECT 1',
  'ALTER TABLE `video_projects` ADD COLUMN `priority_class` enum(''standard'',''express'',''critical'') NOT NULL DEFAULT ''standard'''
);
--> statement-breakpoint
PREPARE vp_pc FROM @vp_pc_stmt;
--> statement-breakpoint
EXECUTE vp_pc;
--> statement-breakpoint
DEALLOCATE PREPARE vp_pc;
