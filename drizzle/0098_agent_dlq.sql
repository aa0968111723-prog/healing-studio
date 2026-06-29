-- 0098: agent_dlq — AIDV-346 驗證門失敗路由 DLQ
-- 紀錄驗證門失敗的路由決策，支援 lint/build 自動重試、test/max-retry 人工審查。
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一 statement-breakpoint；
-- ALTER TABLE / CREATE INDEX 走 information_schema 守門。
-- 可安全重跑：表已存在 → IF 走 SELECT 1。
--
-- 回滾：DROP TABLE IF EXISTS `agent_dlq`;

-- ── (A) agent_dlq table ──────────────────────────────────────────────────────
SET @dlq_tbl := IF(
  EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name   = 'agent_dlq'
  ),
  'SELECT 1',
  'CREATE TABLE `agent_dlq` (
    `id`              BIGINT NOT NULL AUTO_INCREMENT,
    `issue_key`       VARCHAR(64) NOT NULL,
    `agent_id`        VARCHAR(64) NULL,
    `user_id`         INT NOT NULL,
    `failure_type`    ENUM(''lint'',''test'',''build'',''unknown'') NOT NULL,
    `routing_action`  ENUM(''retry'',''decision'',''escalate'') NOT NULL,
    `failure_reason`  TEXT NULL,
    `payload`         JSON NULL,
    `retry_count`     INT NOT NULL DEFAULT 0,
    `resolved_at`     TIMESTAMP NULL,
    `resolved_by`     VARCHAR(64) NULL,
    `resolution_note` TEXT NULL,
    `created_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);
--> statement-breakpoint
PREPARE dlq_tbl FROM @dlq_tbl;
--> statement-breakpoint
EXECUTE dlq_tbl;
--> statement-breakpoint
DEALLOCATE PREPARE dlq_tbl;
--> statement-breakpoint

-- ── (B) idx: issue_key ───────────────────────────────────────────────────────
SET @dlq_idx1 := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'agent_dlq'
      AND index_name   = 'adlq_issue_key_idx'
  ),
  'SELECT 1',
  'ALTER TABLE `agent_dlq` ADD INDEX `adlq_issue_key_idx` (`issue_key`)'
);
--> statement-breakpoint
PREPARE dlq_idx1 FROM @dlq_idx1;
--> statement-breakpoint
EXECUTE dlq_idx1;
--> statement-breakpoint
DEALLOCATE PREPARE dlq_idx1;
--> statement-breakpoint

-- ── (C) idx: routing_action + resolved_at（未處理 DLQ poll 用）────────────────
SET @dlq_idx2 := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'agent_dlq'
      AND index_name   = 'adlq_pending_idx'
  ),
  'SELECT 1',
  'ALTER TABLE `agent_dlq` ADD INDEX `adlq_pending_idx` (`routing_action`, `resolved_at`)'
);
--> statement-breakpoint
PREPARE dlq_idx2 FROM @dlq_idx2;
--> statement-breakpoint
EXECUTE dlq_idx2;
--> statement-breakpoint
DEALLOCATE PREPARE dlq_idx2;
