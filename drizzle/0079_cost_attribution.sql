-- 0079: cost_attribution — AIDV-14 內部成本歸屬可視（建在 #940 cost_ledger 上）
--
-- 目標（內部用、不對使用者收費）：知道哪個 project / member / workflow 花了多少 API
-- 成本，以「真實呼叫價（USD）」換算「台幣 TWD」呈現，並保留原始幣別＋所用匯率以利
-- 稽核回溯。本 migration 做三件事：
--   (A) cost_ledger 加歸屬維度欄（projectId/workflowId）＋稽核欄（sourceCurrency/
--       exchangeRate/amountTwd）＋拆解欄（provider/model）＋成本來源欄（costSource）
--       ＋兩條索引。
--   (B) cost_aggregations 加 TWD 呈現欄（totalCostTwd）＋稽核匯率欄（exchangeRate）。
--   (C) 新建 cost_attribution_outbox 表（不漏帳 outbox）＋兩條索引。
--
-- 三鐵則：禁 CREATE INDEX IF NOT EXISTS；一句一「statement-breakpoint」標記；
-- ALTER/CREATE INDEX 走 information_schema 守門、CREATE TABLE 用 IF NOT EXISTS。
-- 可安全重跑（欄位/索引/表已存在則 SELECT 1）。
--
-- HARD SAFETY：旗標 ENABLE_COST_ATTRIBUTION 預設 ON、demo/無 DB 跳過；本 migration 純
-- 加欄/加表，不改既有資料/語義（amount 仍是 USD），先跑 migration 後開旗標安全。
--
-- 回滾（rollback）：
--   ALTER TABLE `cost_ledger`
--     DROP COLUMN `projectId`, DROP COLUMN `workflowId`, DROP COLUMN `sourceCurrency`,
--     DROP COLUMN `exchangeRate`, DROP COLUMN `amountTwd`, DROP COLUMN `provider`,
--     DROP COLUMN `model`, DROP COLUMN `costSource`;
--   ALTER TABLE `cost_aggregations`
--     DROP COLUMN `totalCostTwd`, DROP COLUMN `exchangeRate`;
--   DROP TABLE IF EXISTS `cost_attribution_outbox`;

-- ── (A) cost_ledger：歸屬 + 稽核 + 拆解欄 ─────────────────────────────────────

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_ledger'
      AND column_name = 'projectId'
  ),
  'SELECT 1',
  'ALTER TABLE `cost_ledger` ADD COLUMN `projectId` varchar(128)'
);
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_ledger'
      AND column_name = 'workflowId'
  ),
  'SELECT 1',
  'ALTER TABLE `cost_ledger` ADD COLUMN `workflowId` varchar(128)'
);
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_ledger'
      AND column_name = 'sourceCurrency'
  ),
  'SELECT 1',
  'ALTER TABLE `cost_ledger` ADD COLUMN `sourceCurrency` varchar(8) DEFAULT ''USD'''
);
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_ledger'
      AND column_name = 'exchangeRate'
  ),
  'SELECT 1',
  'ALTER TABLE `cost_ledger` ADD COLUMN `exchangeRate` decimal(12,6)'
);
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_ledger'
      AND column_name = 'amountTwd'
  ),
  'SELECT 1',
  'ALTER TABLE `cost_ledger` ADD COLUMN `amountTwd` decimal(14,4)'
);
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_ledger'
      AND column_name = 'provider'
  ),
  'SELECT 1',
  'ALTER TABLE `cost_ledger` ADD COLUMN `provider` varchar(32)'
);
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_ledger'
      AND column_name = 'model'
  ),
  'SELECT 1',
  'ALTER TABLE `cost_ledger` ADD COLUMN `model` varchar(128)'
);
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_ledger'
      AND column_name = 'costSource'
  ),
  'SELECT 1',
  'ALTER TABLE `cost_ledger` ADD COLUMN `costSource` varchar(16)'
);
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_ledger'
      AND index_name = 'cl_projectId_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `cl_projectId_idx` ON `cost_ledger` (`projectId`)'
);
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_ledger'
      AND index_name = 'cl_workflowId_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `cl_workflowId_idx` ON `cost_ledger` (`workflowId`)'
);
--> statement-breakpoint
PREPARE cl_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cl_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cl_stmt;
--> statement-breakpoint

-- ── (B) cost_aggregations：TWD 呈現 + 稽核匯率欄 ─────────────────────────────

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_aggregations'
      AND column_name = 'totalCostTwd'
  ),
  'SELECT 1',
  'ALTER TABLE `cost_aggregations` ADD COLUMN `totalCostTwd` decimal(16,4) DEFAULT ''0'''
);
--> statement-breakpoint
PREPARE ca_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE ca_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE ca_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_aggregations'
      AND column_name = 'exchangeRate'
  ),
  'SELECT 1',
  'ALTER TABLE `cost_aggregations` ADD COLUMN `exchangeRate` decimal(12,6)'
);
--> statement-breakpoint
PREPARE ca_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE ca_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE ca_stmt;
--> statement-breakpoint

-- ── (C) cost_attribution_outbox：不漏帳 outbox 表 ────────────────────────────

SET @stmt := IF(
  EXISTS(
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_attribution_outbox'
  ),
  'SELECT 1',
  'CREATE TABLE `cost_attribution_outbox` (
    `id` int AUTO_INCREMENT NOT NULL,
    `idempotencyKey` varchar(191) NOT NULL,
    `status` enum(''pending'',''done'',''dead'') NOT NULL DEFAULT ''pending'',
    `payloadJson` json NOT NULL,
    `attempts` int NOT NULL DEFAULT 0,
    `lastError` text,
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT `cost_attribution_outbox_id` PRIMARY KEY(`id`)
  )'
);
--> statement-breakpoint
PREPARE cao_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cao_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cao_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_attribution_outbox'
      AND index_name = 'cao_idempotencyKey_unique'
  ),
  'SELECT 1',
  'CREATE UNIQUE INDEX `cao_idempotencyKey_unique` ON `cost_attribution_outbox` (`idempotencyKey`)'
);
--> statement-breakpoint
PREPARE cao_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cao_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cao_stmt;
--> statement-breakpoint

SET @stmt := IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'cost_attribution_outbox'
      AND index_name = 'cao_status_createdAt_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `cao_status_createdAt_idx` ON `cost_attribution_outbox` (`status`,`createdAt`)'
);
--> statement-breakpoint
PREPARE cao_stmt FROM @stmt;
--> statement-breakpoint
EXECUTE cao_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE cao_stmt;
