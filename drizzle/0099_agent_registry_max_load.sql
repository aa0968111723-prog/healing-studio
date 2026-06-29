-- 0099: agent_dynamic_registry 加 maxLoad 欄位 — AIDV-496 並發路由容量守門
-- currentLoad >= maxLoad 時，assign 不再派工給此代理，預設 1.0000 = 不限制（向下相容）。
SET @adr_ml := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name   = 'agent_dynamic_registry'
      AND column_name  = 'maxLoad'
  ),
  'SELECT 1',
  'ALTER TABLE `agent_dynamic_registry` ADD COLUMN `maxLoad` decimal(5,4) NOT NULL DEFAULT 1.0000'
);
--> statement-breakpoint
PREPARE adr_ml_stmt FROM @adr_ml;
--> statement-breakpoint
EXECUTE adr_ml_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE adr_ml_stmt;
