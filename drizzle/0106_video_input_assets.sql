-- 0106: video_projects 加 input_assets JSON 欄位（冪等 — information_schema 守門）
-- AIDV-270: /video 多模態輸入素材 — [{type:image|audio, url, role}]。
-- null 表未提供（既有純文字生成路徑不變，純加性）。

SET @vp_ia_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'video_projects'
      AND column_name  = 'input_assets'
  ),
  'SELECT 1',
  'ALTER TABLE `video_projects` ADD COLUMN `input_assets` json NULL'
);
--> statement-breakpoint
PREPARE vp_ia FROM @vp_ia_stmt;
--> statement-breakpoint
EXECUTE vp_ia;
--> statement-breakpoint
DEALLOCATE PREPARE vp_ia;
