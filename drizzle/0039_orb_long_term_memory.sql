-- 0039: Orb 長期結構化記憶系統
-- orb_long_term_memories 儲存各種類型的長期記憶（使用者事實、偏好、技能、工作流程模式等）
-- orb_memory_associations 記錄記憶之間的關聯關係，用於建構記憶網絡

CREATE TABLE IF NOT EXISTS `orb_long_term_memories` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `memoryType` ENUM(
    'user_fact',
    'user_preference',
    'skill_learned',
    'workflow_pattern',
    'error_solution',
    'success_recipe',
    'context_snippet'
  ) NOT NULL,
  `content` text NOT NULL,
  `importanceScore` float NOT NULL DEFAULT 0.5,
  `embeddingVector` json NULL COMMENT 'Vector embedding for semantic search',
  `sourceType` ENUM('conversation', 'action', 'observation', 'inference') NOT NULL DEFAULT 'conversation',
  `sourceId` varchar(128) NULL COMMENT 'Reference to conversation_id, task_id, etc',
  `spiritId` varchar(64) NULL COMMENT 'Which spirit created this memory',
  `metadata` json NULL COMMENT 'Additional context-specific data',
  `accessCount` int NOT NULL DEFAULT 0,
  `lastAccessedAt` timestamp NULL,
  `expiresAt` timestamp NULL COMMENT 'Optional expiration for time-sensitive memories',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `orb_ltm_user_idx` (`userId`),
  KEY `orb_ltm_user_type_idx` (`userId`, `memoryType`),
  KEY `orb_ltm_importance_idx` (`userId`, `importanceScore` DESC),
  KEY `orb_ltm_spirit_idx` (`spiritId`),
  KEY `orb_ltm_accessed_idx` (`lastAccessedAt`),
  KEY `orb_ltm_expires_idx` (`expiresAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `orb_memory_associations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `fromMemoryId` bigint NOT NULL,
  `toMemoryId` bigint NOT NULL,
  `associationType` ENUM(
    'related_to',
    'caused_by',
    'part_of',
    'similar_to',
    'contradicts',
    'supersedes'
  ) NOT NULL DEFAULT 'related_to',
  `strength` float NOT NULL DEFAULT 0.5 COMMENT 'Association strength 0.0-1.0',
  `createdBy` varchar(64) NULL COMMENT 'Which spirit or process created this link',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `orb_memory_assoc_uk` (`fromMemoryId`, `toMemoryId`, `associationType`),
  KEY `orb_memory_assoc_from_idx` (`fromMemoryId`),
  KEY `orb_memory_assoc_to_idx` (`toMemoryId`),
  KEY `orb_memory_assoc_strength_idx` (`strength` DESC),
  CONSTRAINT `orb_memory_assoc_from_fk` FOREIGN KEY (`fromMemoryId`)
    REFERENCES `orb_long_term_memories` (`id`) ON DELETE CASCADE,
  CONSTRAINT `orb_memory_assoc_to_fk` FOREIGN KEY (`toMemoryId`)
    REFERENCES `orb_long_term_memories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
