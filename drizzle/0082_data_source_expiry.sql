-- 0082: data_source_connections 到期欄位（AIDV-68 M5 externalServices 到期提醒）
--
-- 為 data_source_connections 表新增兩個欄位：
--   expiresAt       → API key 或憑證的到期時間（null = 永不到期）
--   expireWarnedAt  → 最後一次發出到期警告的時間（避免重複告警）
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一「statement-breakpoint」標記；
-- ALTER TABLE 走 information_schema 守門（可安全重跑）。
--
-- 回滾（rollback）：
--   ALTER TABLE `data_source_connections`
--     DROP COLUMN `expiresAt`,
--     DROP COLUMN `expireWarnedAt`;

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'data_source_connections'
      AND column_name = 'expiresAt'
  ),
  'SELECT 1',
  'ALTER TABLE `data_source_connections` ADD COLUMN `expiresAt` timestamp NULL'
);
--> statement-breakpoint
PREPARE dsc_exp1 FROM @stmt;
--> statement-breakpoint
EXECUTE dsc_exp1;
--> statement-breakpoint
DEALLOCATE PREPARE dsc_exp1;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'data_source_connections'
      AND column_name = 'expireWarnedAt'
  ),
  'SELECT 1',
  'ALTER TABLE `data_source_connections` ADD COLUMN `expireWarnedAt` timestamp NULL'
);
--> statement-breakpoint
PREPARE dsc_exp2 FROM @stmt;
--> statement-breakpoint
EXECUTE dsc_exp2;
--> statement-breakpoint
DEALLOCATE PREPARE dsc_exp2;
