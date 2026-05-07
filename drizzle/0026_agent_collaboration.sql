-- Agent Collaboration Tables
-- Supports inter-agent communication, collaboration sessions, and shared knowledge

-- Agent Collaboration Sessions
-- Tracks multi-agent collaboration sessions for complex tasks
CREATE TABLE IF NOT EXISTS `agent_collaboration_sessions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `collaborationId` VARCHAR(128) NOT NULL UNIQUE,
  `userId` INT NULL,
  `sessionId` VARCHAR(128) NOT NULL,
  `taskDescription` TEXT NOT NULL,
  `currentAgent` VARCHAR(64) NOT NULL COMMENT 'Currently active agent',
  `participatingAgents` JSON NOT NULL COMMENT 'Array of agent IDs involved',
  `sharedContext` JSON NULL COMMENT 'Shared execution context',
  `status` ENUM('active', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'active',
  `completedSteps` JSON NULL COMMENT 'Array of completed step descriptions',
  `resultData` JSON NULL COMMENT 'Final collaboration result',
  `startedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `completedAt` TIMESTAMP NULL,
  `durationMs` INT NULL COMMENT 'Total duration in milliseconds',
  INDEX `idx_user_session` (`userId`, `sessionId`),
  INDEX `idx_status` (`status`),
  INDEX `idx_started_at` (`startedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Message History
-- Records all inter-agent messages for debugging and analytics
CREATE TABLE IF NOT EXISTS `agent_message_history` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `messageId` VARCHAR(128) NOT NULL UNIQUE,
  `collaborationId` VARCHAR(128) NULL,
  `correlationId` VARCHAR(128) NULL,
  `fromAgent` VARCHAR(64) NOT NULL,
  `toAgent` VARCHAR(255) NOT NULL COMMENT 'Single agent, multiple, or broadcast',
  `messageType` ENUM('request', 'response', 'notification', 'handoff', 'broadcast', 'query', 'share_context') NOT NULL,
  `priority` ENUM('low', 'normal', 'high', 'urgent') NOT NULL DEFAULT 'normal',
  `action` VARCHAR(128) NULL,
  `contentData` JSON NULL COMMENT 'Message content and payload',
  `inReplyTo` VARCHAR(128) NULL,
  `timestamp` BIGINT NOT NULL COMMENT 'Unix timestamp in milliseconds',
  `expiresAt` BIGINT NULL,
  INDEX `idx_collaboration` (`collaborationId`),
  INDEX `idx_correlation` (`correlationId`),
  INDEX `idx_from_agent` (`fromAgent`),
  INDEX `idx_message_type` (`messageType`),
  INDEX `idx_timestamp` (`timestamp`),
  INDEX `idx_reply_thread` (`inReplyTo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Shared Knowledge Base
-- Stores knowledge that can be shared across all agents
CREATE TABLE IF NOT EXISTS `agent_shared_knowledge` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `knowledgeId` VARCHAR(128) NOT NULL UNIQUE,
  `contributingAgent` VARCHAR(64) NOT NULL COMMENT 'Agent that contributed this knowledge',
  `knowledgeType` ENUM('best_practice', 'failure_case', 'parameter_combination', 'workflow_template', 'user_pattern', 'optimization') NOT NULL,
  `domain` VARCHAR(128) NULL COMMENT 'Knowledge domain (e.g., image, video, audio)',
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NOT NULL,
  `knowledgeData` JSON NOT NULL COMMENT 'Structured knowledge content',
  `confidence` DECIMAL(3,2) DEFAULT 0.70 COMMENT 'Confidence score 0.00-1.00',
  `usageCount` INT DEFAULT 0 COMMENT 'Number of times this knowledge was used',
  `successRate` DECIMAL(3,2) NULL COMMENT 'Success rate when applied',
  `tags` JSON NULL COMMENT 'Tags for searching',
  `applicableAgents` JSON NULL COMMENT 'Array of agent IDs that can use this knowledge',
  `lastUsedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_contributing_agent` (`contributingAgent`),
  INDEX `idx_knowledge_type` (`knowledgeType`),
  INDEX `idx_domain` (`domain`),
  INDEX `idx_confidence` (`confidence`),
  FULLTEXT INDEX `ft_title_desc` (`title`, `description`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Handoff History
-- Tracks when control is transferred from one agent to another
CREATE TABLE IF NOT EXISTS `agent_handoff_history` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `handoffId` VARCHAR(128) NOT NULL UNIQUE,
  `collaborationId` VARCHAR(128) NOT NULL,
  `fromAgent` VARCHAR(64) NOT NULL,
  `toAgent` VARCHAR(64) NOT NULL,
  `reason` TEXT NOT NULL,
  `completedSteps` JSON NULL,
  `remainingSteps` JSON NULL,
  `nextAction` VARCHAR(255) NULL,
  `contextData` JSON NULL COMMENT 'Shared context at handoff',
  `handoffAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_collaboration` (`collaborationId`),
  INDEX `idx_from_to` (`fromAgent`, `toAgent`),
  INDEX `idx_handoff_at` (`handoffAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Performance Metrics
-- Tracks performance and success metrics for each agent
CREATE TABLE IF NOT EXISTS `agent_performance_metrics` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `agentId` VARCHAR(64) NOT NULL,
  `metricDate` DATE NOT NULL,
  `totalTasks` INT DEFAULT 0,
  `successfulTasks` INT DEFAULT 0,
  `failedTasks` INT DEFAULT 0,
  `averageDurationMs` INT NULL,
  `collaborationCount` INT DEFAULT 0 COMMENT 'Number of collaborative sessions',
  `handoffReceived` INT DEFAULT 0 COMMENT 'Times received control via handoff',
  `handoffGiven` INT DEFAULT 0 COMMENT 'Times gave control via handoff',
  `knowledgeContributions` INT DEFAULT 0,
  `knowledgeUsages` INT DEFAULT 0,
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_agent_date` (`agentId`, `metricDate`),
  INDEX `idx_metric_date` (`metricDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
