-- 0099: background_jobs 加 expiresAt（冪等 — information_schema 守門）
-- AIDV-231 Gap B: 為已完成/失敗/取消的背景工作加上 TTL 欄位，供每日清理 cron 使用。

SET @bj_exp_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'background_jobs'
      AND column_name  = 'expiresAt'
  ),
  'SELECT 1',
  'ALTER TABLE `background_jobs` ADD COLUMN `expiresAt` timestamp NULL'
);
--> statement-breakpoint
PREPARE bj_exp FROM @bj_exp_stmt;
--> statement-breakpoint
EXECUTE bj_exp;
--> statement-breakpoint
DEALLOCATE PREPARE bj_exp;
