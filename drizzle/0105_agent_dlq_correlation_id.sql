-- 0105: agent_dlq — AIDV-926 correlation_id 欄位（跨日誌追蹤）
-- 為 agent_dlq 加 correlation_id 欄位 + 索引，讓同一次驗證門失敗的請求
-- 可在 server log／agent_dlq 之間用同一個 correlationId 串起來追蹤。
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一 statement-breakpoint；
-- ALTER TABLE / CREATE INDEX 走 information_schema 守門。
-- 可安全重跑：欄位/索引已存在 → IF 走 SELECT 1。
--
-- 回滾：ALTER TABLE `agent_dlq` DROP INDEX `adlq_correlation_idx`, DROP COLUMN `correlation_id`;

-- ── (A) 欄位: correlation_id ─────────────────────────────────────────────────
SET @adlq_corr_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'agent_dlq'
      AND column_name  = 'correlation_id'
  ),
  'SELECT 1',
  'ALTER TABLE `agent_dlq` ADD COLUMN `correlation_id` VARCHAR(64) NULL'
);
--> statement-breakpoint
PREPARE adlq_corr FROM @adlq_corr_stmt;
--> statement-breakpoint
EXECUTE adlq_corr;
--> statement-breakpoint
DEALLOCATE PREPARE adlq_corr;
--> statement-breakpoint

-- ── (B) idx: correlation_id（跨日誌查詢用）───────────────────────────────────
SET @adlq_corr_idx_stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'agent_dlq'
      AND index_name   = 'adlq_correlation_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `adlq_correlation_idx` ON `agent_dlq` (`correlation_id`)'
);
--> statement-breakpoint
PREPARE adlq_corr_idx FROM @adlq_corr_idx_stmt;
--> statement-breakpoint
EXECUTE adlq_corr_idx;
--> statement-breakpoint
DEALLOCATE PREPARE adlq_corr_idx;
