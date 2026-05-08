CREATE TABLE IF NOT EXISTS `specialized_agent_interactions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `userId` INT NOT NULL,
  `agentId` VARCHAR(64) NOT NULL,
  `sessionId` VARCHAR(128) NULL,
  `interactionType` ENUM('activated', 'tool_used', 'suggestion_accepted', 'suggestion_rejected', 'error') NOT NULL,
  `toolName` VARCHAR(128) NULL,
  `contextData` JSON NULL,
  `userSatisfaction` ENUM('positive', 'neutral', 'negative') NULL,
  `durationMs` INT NULL,
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `user_agent_idx` (`userId`, `agentId`),
  INDEX `session_idx` (`sessionId`),
  INDEX `created_at_idx` (`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
