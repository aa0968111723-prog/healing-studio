-- 0100: video_analytics 影片播放事件追蹤表 — AIDV-272
-- 匿名訪客透過 visitorId（SHA-256，無 PII），已登入用戶透過 userId（可 null 退出追蹤）。
-- 90 天滾動視窗：created_at 索引支援定期清除舊資料。
-- 三鐵則：CREATE TABLE IF NOT EXISTS；CREATE INDEX 走 information_schema.statistics 守門；
--         一 breakpoint 一句；禁 CREATE INDEX IF NOT EXISTS。
CREATE TABLE IF NOT EXISTS `video_analytics` (
  `id`               bigint          NOT NULL AUTO_INCREMENT,
  `video_project_id` int             NOT NULL,
  `user_id`          int             NULL,
  `visitor_id`       varchar(64)     NULL,
  `event_type`       enum('play','pause','pct25','pct50','pct75','complete') NOT NULL,
  `duration_watched` int             NOT NULL DEFAULT 0,
  `created_at`       timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `va_id` PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
--> statement-breakpoint
SET @va_vp_idx := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'video_analytics'
      AND index_name   = 'va_video_project_id_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `va_video_project_id_idx` ON `video_analytics` (`video_project_id`)'
);
--> statement-breakpoint
PREPARE va_vp_idx_stmt FROM @va_vp_idx;
--> statement-breakpoint
EXECUTE va_vp_idx_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE va_vp_idx_stmt;
--> statement-breakpoint
SET @va_ca_idx := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'video_analytics'
      AND index_name   = 'va_created_at_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `va_created_at_idx` ON `video_analytics` (`created_at`)'
);
--> statement-breakpoint
PREPARE va_ca_idx_stmt FROM @va_ca_idx;
--> statement-breakpoint
EXECUTE va_ca_idx_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE va_ca_idx_stmt;
