-- 0043: Orb 系統監控與分析
-- orb_spirit_collaboration_metrics 記錄精靈之間的協作效能
-- orb_system_health_metrics 追蹤系統整體健康狀態
-- orb_cost_attribution 分析成本歸屬與優化機會

CREATE TABLE IF NOT EXISTS `orb_spirit_collaboration_metrics` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `fromSpiritId` varchar(64) NOT NULL,
  `toSpiritId` varchar(64) NOT NULL,
  `handoffCount` int NOT NULL DEFAULT 0,
  `avgHandoffTime` float NULL COMMENT 'Average time in seconds',
  `successfulHandoffs` int NOT NULL DEFAULT 0,
  `failedHandoffs` int NOT NULL DEFAULT 0,
  `userSatisfactionScore` float NULL COMMENT '0.0-5.0 from feedback',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `orb_collab_metrics_uk` (`date`, `fromSpiritId`, `toSpiritId`),
  KEY `orb_collab_metrics_date_idx` (`date`),
  KEY `orb_collab_metrics_from_idx` (`fromSpiritId`),
  KEY `orb_collab_metrics_to_idx` (`toSpiritId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `orb_system_health_metrics` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `metricType` ENUM(
    'response_time',
    'error_rate',
    'tool_success_rate',
    'user_satisfaction',
    'memory_usage',
    'api_latency',
    'clarification_rate'
  ) NOT NULL,
  `spiritId` varchar(64) NULL COMMENT 'NULL for system-wide metrics',
  `value` float NOT NULL,
  `unit` varchar(32) NOT NULL COMMENT 'e.g., ms, percentage, count',
  `threshold` float NULL COMMENT 'Alert threshold if exists',
  `isHealthy` boolean NOT NULL DEFAULT true,
  `metadata` json NULL,
  PRIMARY KEY (`id`),
  KEY `orb_health_timestamp_idx` (`timestamp`),
  KEY `orb_health_type_idx` (`metricType`, `timestamp`),
  KEY `orb_health_spirit_idx` (`spiritId`, `timestamp`),
  KEY `orb_health_unhealthy_idx` (`isHealthy`, `timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `orb_cost_attribution` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `date` date NOT NULL,
  `userId` int NOT NULL,
  `spiritId` varchar(64) NOT NULL,
  `toolName` varchar(128) NOT NULL,
  `usageCount` int NOT NULL DEFAULT 0,
  `totalTokens` bigint NULL COMMENT 'For LLM calls',
  `totalApiCalls` int NULL COMMENT 'For external API usage',
  `estimatedCostUsd` decimal(10, 4) NULL,
  `avgDuration` float NULL COMMENT 'Average execution time in seconds',
  `metadata` json NULL COMMENT 'Provider-specific cost data',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `orb_cost_attr_uk` (`date`, `userId`, `spiritId`, `toolName`),
  KEY `orb_cost_date_idx` (`date`),
  KEY `orb_cost_user_idx` (`userId`, `date`),
  KEY `orb_cost_spirit_idx` (`spiritId`, `date`),
  KEY `orb_cost_amount_idx` (`estimatedCostUsd` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
