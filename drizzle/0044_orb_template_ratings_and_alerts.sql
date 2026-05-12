-- 0044: Orb 工作流程評分與系統告警
-- orb_workflow_template_ratings 儲存使用者對模板的個別評分
-- orb_system_alerts 記錄系統健康告警

CREATE TABLE IF NOT EXISTS `orb_workflow_template_ratings` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `templateId` int NOT NULL,
  `userId` int NOT NULL,
  `rating` int NOT NULL COMMENT '1-5 stars',
  `comment` text NULL,
  `wasHelpful` boolean NULL COMMENT 'Did workflow help user',
  `completedSuccessfully` boolean NULL COMMENT 'Did workflow complete without errors',
  `metadata` json NULL COMMENT 'Additional feedback data',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `orb_tmpl_rating_uk` (`templateId`, `userId`),
  KEY `orb_tmpl_rating_template_idx` (`templateId`, `rating` DESC),
  KEY `orb_tmpl_rating_user_idx` (`userId`),
  KEY `orb_tmpl_rating_created_idx` (`createdAt` DESC),
  CONSTRAINT `orb_tmpl_rating_template_fk` FOREIGN KEY (`templateId`)
    REFERENCES `orb_workflow_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `orb_system_alerts` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `alertType` ENUM('health_critical', 'health_warning', 'cost_spike', 'performance_degradation', 'error_rate_high', 'system_overload') NOT NULL,
  `severity` ENUM('low', 'medium', 'high', 'critical') NOT NULL,
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `spiritId` varchar(64) NULL COMMENT 'Affected spirit if applicable',
  `metricType` varchar(64) NULL COMMENT 'Related metric type',
  `metricValue` float NULL,
  `threshold` float NULL,
  `metadata` json NULL COMMENT 'Additional alert context',
  `isResolved` boolean NOT NULL DEFAULT false,
  `resolvedAt` timestamp NULL,
  `resolvedBy` int NULL COMMENT 'Admin user who resolved',
  `resolutionNotes` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `orb_alert_type_idx` (`alertType`, `severity`, `createdAt` DESC),
  KEY `orb_alert_resolved_idx` (`isResolved`, `createdAt` DESC),
  KEY `orb_alert_spirit_idx` (`spiritId`),
  KEY `orb_alert_metric_idx` (`metricType`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
