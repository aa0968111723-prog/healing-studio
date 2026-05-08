CREATE TABLE IF NOT EXISTS `specialized_agent_memory` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `userId` INT NOT NULL,
  `agentId` VARCHAR(64) NOT NULL,
  `memoryType` ENUM('preference', 'pattern', 'context', 'feedback') NOT NULL DEFAULT 'preference',
  `memoryKey` VARCHAR(128) NOT NULL,
  `memoryValue` JSON NOT NULL,
  `confidence` DECIMAL(3,2) DEFAULT 0.50,
  `usageCount` INT DEFAULT 1,
  `lastUsedAt` TIMESTAMP NULL DEFAULT NULL,
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `user_agent_idx` (`userId`, `agentId`),
  INDEX `user_agent_type_idx` (`userId`, `agentId`, `memoryType`),
  INDEX `memory_key_idx` (`memoryKey`),
  UNIQUE KEY `user_agent_key_unique` (`userId`, `agentId`, `memoryKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
