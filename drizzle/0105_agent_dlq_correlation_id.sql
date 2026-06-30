-- 0105: agent_dlq.correlation_id — AIDV-926 跨閘追蹤欄位
-- 為 DLQ 條目加入 correlation_id（UUID），讓 agentPlanner→DLQ 全鏈可追蹤。
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一 statement-breakpoint；
-- ALTER TABLE / CREATE INDEX 走 information_schema 守門。
-- 可安全重跑：欄位/索引已存在 → IF 走 SELECT 1。

-- ── (A) ADD COLUMN correlation_id ────────────────────────────────────────────
SET @dlq_col := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'agent_dlq'
      AND column_name  = 'correlation_id'
  ),
  'SELECT 1',
  'ALTER TABLE `agent_dlq` ADD COLUMN `correlation_id` VARCHAR(36) NULL'
);
--> statement-breakpoint
PREPARE dlq_col FROM @dlq_col;
--> statement-breakpoint
EXECUTE dlq_col;
--> statement-breakpoint
DEALLOCATE PREPARE dlq_col;
--> statement-breakpoint

-- ── (B) idx: correlation_id (sparse — only non-NULL rows need lookup) ─────────
SET @dlq_cidx := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'agent_dlq'
      AND index_name   = 'adlq_correlation_id_idx'
  ),
  'SELECT 1',
  'ALTER TABLE `agent_dlq` ADD INDEX `adlq_correlation_id_idx` (`correlation_id`)'
);
--> statement-breakpoint
PREPARE dlq_cidx FROM @dlq_cidx;
--> statement-breakpoint
EXECUTE dlq_cidx;
--> statement-breakpoint
DEALLOCATE PREPARE dlq_cidx;
