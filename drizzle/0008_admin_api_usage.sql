-- Migration: Add AI API Usage & Cost Management tables
-- Required for the /admin/api-usage module

CREATE TABLE IF NOT EXISTS `ai_usage_events` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `provider` enum('fal_ai','gemini','elevenlabs','suno') NOT NULL,
  `endpoint` varchar(256) NOT NULL,
  `userId` int,
  `apiKeyId` varchar(128),
  `status` enum('success','failed','timeout','rate_limited') NOT NULL DEFAULT 'success',
  `units` decimal(12,4) DEFAULT '0',
  `unitType` enum('token','character','credit','second','image','request') DEFAULT 'request',
  `costUsd` decimal(12,6) DEFAULT '0',
  `latencyMs` int,
  `requestMeta` json,
  `errorMessage` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `aue_provider_createdAt_idx` (`provider`, `createdAt`),
  INDEX `aue_userId_createdAt_idx` (`userId`, `createdAt`),
  INDEX `aue_status_createdAt_idx` (`status`, `createdAt`)
);

CREATE TABLE IF NOT EXISTS `provider_snapshots` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `provider` enum('fal_ai','gemini','elevenlabs','suno') NOT NULL,
  `tier` varchar(64),
  `quota` decimal(14,2),
  `remaining` decimal(14,2),
  `nextInvoice` json,
  `balanceUsd` decimal(12,2),
  `concurrency` int,
  `extraData` json,
  `snapshotAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `ps_provider_snapshotAt_idx` (`provider`, `snapshotAt`)
);

CREATE TABLE IF NOT EXISTS `cost_aggregations` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `provider` enum('fal_ai','gemini','elevenlabs','suno') NOT NULL,
  `endpoint` varchar(256) NOT NULL,
  `date` date NOT NULL,
  `callCount` int NOT NULL DEFAULT 0,
  `totalUnits` decimal(14,4) DEFAULT '0',
  `totalCostUsd` decimal(14,6) DEFAULT '0',
  INDEX `ca_provider_date_idx` (`provider`, `date`),
  INDEX `ca_date_idx` (`date`)
);

CREATE TABLE IF NOT EXISTS `rate_limit_rules` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `ruleType` enum('per_user','per_api_key','global') NOT NULL,
  `targetId` varchar(128),
  `provider` varchar(32),
  `dailyCallLimit` int,
  `dailyCostLimitUsd` decimal(10,2),
  `monthlyCostLimitUsd` decimal(10,2),
  `isActive` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS `alert_configs` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `alertType` enum('budget','quota','anomaly') NOT NULL,
  `provider` varchar(32),
  `thresholdPct` decimal(5,2),
  `monthlyBudgetUsd` decimal(10,2),
  `isActive` boolean NOT NULL DEFAULT true,
  `lastTriggeredAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
