-- 0107: creator_usage_events 用量事件記錄表 — AIDV-277（收斂 AIDV-273）
-- 每次影片生成觸發一筆，供 /creator/dashboard 配額透明度與下游 API 配額共用計量。
-- 擁有權以應用層 WHERE userId 過濾（MySQL 無 Postgres RLS，讀取端以 ctx.user.id 為界）。
-- 三鐵則：CREATE TABLE IF NOT EXISTS；CREATE INDEX 走 information_schema.statistics 守門；
--         一 breakpoint 一句；禁 CREATE INDEX IF NOT EXISTS；檔尾不留 statement-breakpoint。
CREATE TABLE IF NOT EXISTS `creator_usage_events` (
  `id`               bigint          NOT NULL AUTO_INCREMENT,
  `userId`           int             NOT NULL,
  `video_project_id` int             NULL,
  `event_type`       enum('video_generated','video_failed') NOT NULL,
  `credits_used`     decimal(10,4)   NOT NULL DEFAULT '1.0000',
  `cost_usd`         decimal(10,6)   NULL,
  `created_at`       timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `cue_id` PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
SET @cue_uc_idx := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'creator_usage_events'
      AND index_name   = 'cue_userId_createdAt_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `cue_userId_createdAt_idx` ON `creator_usage_events` (`userId`, `created_at`)'
);
--> statement-breakpoint
PREPARE cue_uc_idx_stmt FROM @cue_uc_idx;
--> statement-breakpoint
EXECUTE cue_uc_idx_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cue_uc_idx_stmt;
