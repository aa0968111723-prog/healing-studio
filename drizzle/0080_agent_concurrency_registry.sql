-- 0080: agent_concurrency_registry — AIDV-323 多代理路由基礎層
--
-- 目標：收斂 AIDV-316（並發控制缺失）+ AIDV-317（路由盲派）
--   (A) agent_collaboration_sessions 加樂觀鎖 `version` 欄位
--       多代理並行更新同一 session 時，WHERE id=? AND version=? 確保唯一寫入者，
--       衝突回傳 409 CONFLICT。
--   (B) 新建 agent_dynamic_registry 表（全新表，不改既有行為）
--       代理上線登記 capabilities + costPerToken；heartbeat 更新 currentLoad；
--       assign 依 capability match + load 最低選派。
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一 breakpoint；
-- ALTER 走 information_schema 守門；CREATE TABLE IF NOT EXISTS。
-- 可安全重跑。
--
-- 回滾：
--   ALTER TABLE `agent_collaboration_sessions` DROP COLUMN `version`;
--   DROP TABLE IF EXISTS `agent_dynamic_registry`;

-- ── (A) agent_collaboration_sessions：加樂觀鎖 version 欄位 ─────────────────

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'agent_collaboration_sessions'
      AND column_name = 'version'
  ),
  'SELECT 1',
  'ALTER TABLE `agent_collaboration_sessions` ADD COLUMN `version` int NOT NULL DEFAULT 0'
);
--> statement-breakpoint
PREPARE acs_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE acs_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE acs_stmt;
--> statement-breakpoint

-- ── (B) agent_dynamic_registry：動態代理能力登記表 ──────────────────────────

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'agent_dynamic_registry'
  ),
  'SELECT 1',
  'CREATE TABLE `agent_dynamic_registry` (
    `id` int AUTO_INCREMENT NOT NULL,
    `agentId` varchar(64) NOT NULL,
    `capabilities` json NOT NULL,
    `costPerToken` decimal(16,10) NOT NULL DEFAULT ''0'',
    `currentLoad` decimal(5,4) NOT NULL DEFAULT ''0'',
    `isActive` tinyint(1) NOT NULL DEFAULT 1,
    `lastHeartbeatAt` timestamp NOT NULL DEFAULT (now()),
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `adr_id` PRIMARY KEY(`id`)
  )'
);
--> statement-breakpoint
PREPARE adr_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE adr_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE adr_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'agent_dynamic_registry'
      AND index_name = 'adr_agentId_unique'
  ),
  'SELECT 1',
  'CREATE UNIQUE INDEX `adr_agentId_unique` ON `agent_dynamic_registry` (`agentId`)'
);
--> statement-breakpoint
PREPARE adr_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE adr_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE adr_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'agent_dynamic_registry'
      AND index_name = 'adr_isActive_load_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `adr_isActive_load_idx` ON `agent_dynamic_registry` (`isActive`, `currentLoad`)'
);
--> statement-breakpoint
PREPARE adr_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE adr_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE adr_stmt;
