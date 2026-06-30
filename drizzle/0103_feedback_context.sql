-- 0103: user_feedback_reports — AIDV-864 快速情境回饋 schema 擴充
-- 加 4 個 NULL 欄位：feature_area / page_context / landmark / screenshot_key
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一 statement-breakpoint；
-- ALTER TABLE / CREATE INDEX 走 information_schema 守門。
-- 可安全重跑：欄已存在 → IF 走 SELECT 1。

SET @fb_fa_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'user_feedback_reports'
      AND column_name  = 'feature_area'
  ),
  'SELECT 1',
  'ALTER TABLE `user_feedback_reports` ADD COLUMN `feature_area` varchar(120) NULL'
);
--> statement-breakpoint
PREPARE fb_fa FROM @fb_fa_stmt;
--> statement-breakpoint
EXECUTE fb_fa;
--> statement-breakpoint
DEALLOCATE PREPARE fb_fa;
--> statement-breakpoint
SET @fb_pc_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'user_feedback_reports'
      AND column_name  = 'page_context'
  ),
  'SELECT 1',
  'ALTER TABLE `user_feedback_reports` ADD COLUMN `page_context` json NULL'
);
--> statement-breakpoint
PREPARE fb_pc FROM @fb_pc_stmt;
--> statement-breakpoint
EXECUTE fb_pc;
--> statement-breakpoint
DEALLOCATE PREPARE fb_pc;
--> statement-breakpoint
SET @fb_lm_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'user_feedback_reports'
      AND column_name  = 'landmark'
  ),
  'SELECT 1',
  'ALTER TABLE `user_feedback_reports` ADD COLUMN `landmark` json NULL'
);
--> statement-breakpoint
PREPARE fb_lm FROM @fb_lm_stmt;
--> statement-breakpoint
EXECUTE fb_lm;
--> statement-breakpoint
DEALLOCATE PREPARE fb_lm;
--> statement-breakpoint
SET @fb_sk_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'user_feedback_reports'
      AND column_name  = 'screenshot_key'
  ),
  'SELECT 1',
  'ALTER TABLE `user_feedback_reports` ADD COLUMN `screenshot_key` varchar(512) NULL'
);
--> statement-breakpoint
PREPARE fb_sk FROM @fb_sk_stmt;
--> statement-breakpoint
EXECUTE fb_sk;
--> statement-breakpoint
DEALLOCATE PREPARE fb_sk;
