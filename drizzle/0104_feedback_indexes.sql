-- 0104: user_feedback_reports — AIDV-903 feedback 查詢索引補建
-- 為 feature_area 與 screenshot_key 欄位建立索引，防全表掃描。
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一 statement-breakpoint；
-- CREATE INDEX 走 information_schema.statistics 守門。
-- 可安全重跑：索引已存在 → IF 走 SELECT 1。

SET @ufr_fa_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'user_feedback_reports'
      AND index_name   = 'ufr_feature_area_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `ufr_feature_area_idx` ON `user_feedback_reports` (`feature_area`)'
);
--> statement-breakpoint
PREPARE ufr_fa FROM @ufr_fa_stmt;
--> statement-breakpoint
EXECUTE ufr_fa;
--> statement-breakpoint
DEALLOCATE PREPARE ufr_fa;
--> statement-breakpoint
SET @ufr_sk_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'user_feedback_reports'
      AND index_name   = 'ufr_screenshot_key_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `ufr_screenshot_key_idx` ON `user_feedback_reports` (`screenshot_key`)'
);
--> statement-breakpoint
PREPARE ufr_sk FROM @ufr_sk_stmt;
--> statement-breakpoint
EXECUTE ufr_sk;
--> statement-breakpoint
DEALLOCATE PREPARE ufr_sk;
