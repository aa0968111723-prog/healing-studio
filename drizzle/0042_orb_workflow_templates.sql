-- 0042: Orb 工作流程模板與自動化系統
-- orb_workflow_templates 儲存可重複使用的工作流程模板
-- orb_workflow_executions 記錄工作流程的執行歷史
-- orb_workflow_step_executions 追蹤每個步驟的執行狀態與結果

CREATE TABLE IF NOT EXISTS `orb_workflow_templates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `creatorUserId` int NULL COMMENT 'NULL for system templates',
  `name` varchar(255) NOT NULL,
  `description` text NULL,
  `category` varchar(64) NOT NULL COMMENT 'e.g., image-editing, video-production, learning',
  `isPublic` boolean NOT NULL DEFAULT false,
  `isVerified` boolean NOT NULL DEFAULT false COMMENT 'Verified by platform',
  `steps` json NOT NULL COMMENT 'Array of {stepId, spiritId, toolName, parameters, conditions}',
  `inputSchema` json NULL COMMENT 'JSON schema for required inputs',
  `outputSchema` json NULL COMMENT 'JSON schema for expected outputs',
  `estimatedDuration` int NULL COMMENT 'Estimated completion time in seconds',
  `difficulty` ENUM('beginner', 'intermediate', 'advanced') NOT NULL DEFAULT 'beginner',
  `tags` json NULL COMMENT 'Array of tags for search',
  `usageCount` int NOT NULL DEFAULT 0,
  `avgRating` float NULL COMMENT '0.0-5.0',
  `ratingCount` int NOT NULL DEFAULT 0,
  `version` varchar(32) NOT NULL DEFAULT '1.0.0',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `orb_workflow_tmpl_creator_idx` (`creatorUserId`),
  KEY `orb_workflow_tmpl_category_idx` (`category`),
  KEY `orb_workflow_tmpl_public_idx` (`isPublic`, `avgRating` DESC),
  KEY `orb_workflow_tmpl_usage_idx` (`usageCount` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `orb_workflow_executions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `templateId` int NOT NULL,
  `userId` int NOT NULL,
  `conversationId` varchar(128) NULL,
  `status` ENUM('pending', 'running', 'paused', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'pending',
  `inputs` json NULL COMMENT 'Actual input values for this execution',
  `outputs` json NULL COMMENT 'Final outputs from workflow',
  `currentStepIndex` int NOT NULL DEFAULT 0,
  `totalSteps` int NOT NULL,
  `startedAt` timestamp NULL,
  `completedAt` timestamp NULL,
  `durationSeconds` int NULL,
  `error` text NULL,
  `metadata` json NULL COMMENT 'Execution-specific data',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `orb_workflow_exec_template_idx` (`templateId`),
  KEY `orb_workflow_exec_user_idx` (`userId`),
  KEY `orb_workflow_exec_status_idx` (`status`, `updatedAt` DESC),
  KEY `orb_workflow_exec_conv_idx` (`conversationId`),
  CONSTRAINT `orb_workflow_exec_template_fk` FOREIGN KEY (`templateId`)
    REFERENCES `orb_workflow_templates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `orb_workflow_step_executions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `executionId` bigint NOT NULL,
  `stepIndex` int NOT NULL,
  `stepId` varchar(128) NOT NULL,
  `spiritId` varchar(64) NOT NULL,
  `toolName` varchar(128) NOT NULL,
  `status` ENUM('pending', 'running', 'completed', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
  `inputs` json NULL,
  `outputs` json NULL,
  `error` text NULL,
  `retryCount` int NOT NULL DEFAULT 0,
  `startedAt` timestamp NULL,
  `completedAt` timestamp NULL,
  `durationSeconds` int NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `orb_workflow_step_uk` (`executionId`, `stepIndex`),
  KEY `orb_workflow_step_exec_idx` (`executionId`),
  KEY `orb_workflow_step_status_idx` (`status`),
  KEY `orb_workflow_step_spirit_idx` (`spiritId`),
  CONSTRAINT `orb_workflow_step_exec_fk` FOREIGN KEY (`executionId`)
    REFERENCES `orb_workflow_executions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
