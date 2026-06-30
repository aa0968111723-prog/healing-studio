-- 0105: agent_dlq — AIDV-926 E2E 追蹤 correlationId 欄位
-- 為驗證門失敗路由加 correlation_id，可從 agentPlanner 串到 DLQ，便於跨日誌追蹤。
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一 statement-breakpoint；
-- ALTER TABLE / CREATE INDEX 走 information_schema 守門。
-- 可安全重跑：欄/索引已存在 → IF 走 SELECT 1。

SET @adlq_ci_col := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'agent_dlq'
      AND column_name  = 'correlation_id'
  ),
  'SELECT 1',
  'ALTER TABLE `agent_dlq` ADD COLUMN `correlation_id` varchar(36) NULL'
);
--> statement-breakpoint
PREPARE adlq_ci_col FROM @adlq_ci_col;
--> statement-breakpoint
EXECUTE adlq_ci_col;
--> statement-breakpoint
DEALLOCATE PREPARE adlq_ci_col;
--> statement-breakpoint
SET @adlq_ci_idx := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'agent_dlq'
      AND index_name   = 'adlq_correlation_id_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `adlq_correlation_id_idx` ON `agent_dlq` (`correlation_id`)'
);
--> statement-breakpoint
PREPARE adlq_ci_idx FROM @adlq_ci_idx;
--> statement-breakpoint
EXECUTE adlq_ci_idx;
--> statement-breakpoint
DEALLOCATE PREPARE adlq_ci_idx;
