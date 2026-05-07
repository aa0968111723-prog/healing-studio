-- Specialized Agent Memory Table
-- Stores agent-specific context, preferences, and learned patterns for each user
CREATE TABLE IF NOT EXISTS `specialized_agent_memory` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `userId` INT NOT NULL,
  `agentId` VARCHAR(64) NOT NULL COMMENT 'image-specialist|video-specialist|music-specialist|voice-specialist|training-specialist|learning-specialist',
  `memoryType` ENUM('preference', 'pattern', 'context', 'feedback') NOT NULL DEFAULT 'preference',
  `memoryKey` VARCHAR(128) NOT NULL COMMENT 'e.g. preferred_model, style_preference, common_aspect_ratio',
  `memoryValue` JSON NOT NULL COMMENT 'Flexible storage for various data types',
  `confidence` DECIMAL(3,2) DEFAULT 0.50 COMMENT 'Confidence score 0.00-1.00',
  `usageCount` INT DEFAULT 1 COMMENT 'Number of times this memory was applied',
  `lastUsedAt` TIMESTAMP NULL DEFAULT NULL,
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `user_agent_idx` (`userId`, `agentId`),
  INDEX `user_agent_type_idx` (`userId`, `agentId`, `memoryType`),
  INDEX `memory_key_idx` (`memoryKey`),
  UNIQUE KEY `user_agent_key_unique` (`userId`, `agentId`, `memoryKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Specialized Agent Interaction Log
-- Tracks user interactions with specialized agents for analytics and improvement
CREATE TABLE IF NOT EXISTS `specialized_agent_interactions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `userId` INT NOT NULL,
  `agentId` VARCHAR(64) NOT NULL,
  `sessionId` VARCHAR(128) NULL,
  `interactionType` ENUM('activated', 'tool_used', 'suggestion_accepted', 'suggestion_rejected', 'error') NOT NULL,
  `toolName` VARCHAR(128) NULL COMMENT 'Tool name if interaction involves a tool',
  `contextData` JSON NULL COMMENT 'Interaction context and parameters',
  `userSatisfaction` ENUM('positive', 'neutral', 'negative') NULL COMMENT 'User feedback if provided',
  `durationMs` INT NULL COMMENT 'Duration of interaction in milliseconds',
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `user_agent_idx` (`userId`, `agentId`),
  INDEX `session_idx` (`sessionId`),
  INDEX `created_at_idx` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add specialized agent preferences to agent_preferences table
ALTER TABLE `agent_preferences`
ADD COLUMN IF NOT EXISTS `preferredSpecialistAgent` VARCHAR(64) NULL COMMENT 'User preferred default specialist agent',
ADD COLUMN IF NOT EXISTS `specialistAutoActivate` BOOLEAN DEFAULT TRUE NOT NULL COMMENT 'Auto-activate specialist agents based on context',
ADD COLUMN IF NOT EXISTS `specialistProactiveMode` BOOLEAN DEFAULT TRUE NOT NULL COMMENT 'Allow specialists to proactively suggest optimizations',
ADD COLUMN IF NOT EXISTS `specialistLearningEnabled` BOOLEAN DEFAULT TRUE NOT NULL COMMENT 'Allow specialists to learn from user preferences',
ADD COLUMN IF NOT EXISTS `disabledSpecialistAgents` JSON DEFAULT ('[]') NOT NULL COMMENT 'List of disabled specialist agent IDs';
