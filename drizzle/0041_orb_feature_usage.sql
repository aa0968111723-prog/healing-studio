-- 0041: Orb 功能使用統計與推薦系統
-- orb_feature_usage_stats 記錄使用者的功能使用頻率與成功率
-- orb_feature_discovery_paths 追蹤使用者如何發現與學習新功能
-- orb_feature_recommendations 儲存個人化功能推薦記錄

CREATE TABLE IF NOT EXISTS `orb_feature_usage_stats` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `featureId` varchar(128) NOT NULL COMMENT 'e.g., image.generate, video.edit, orb.ask',
  `usageCount` int NOT NULL DEFAULT 0,
  `successCount` int NOT NULL DEFAULT 0,
  `failureCount` int NOT NULL DEFAULT 0,
  `avgDuration` float NULL COMMENT 'Average completion time in seconds',
  `lastUsedAt` timestamp NULL,
  `firstUsedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `proficiencyScore` float NULL COMMENT '0.0-1.0, estimated user skill level',
  `metadata` json NULL COMMENT 'Feature-specific usage data',
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `orb_feature_usage_uk` (`userId`, `featureId`),
  KEY `orb_feature_usage_user_idx` (`userId`),
  KEY `orb_feature_usage_feature_idx` (`featureId`),
  KEY `orb_feature_usage_last_used_idx` (`userId`, `lastUsedAt` DESC),
  KEY `orb_feature_usage_proficiency_idx` (`userId`, `proficiencyScore` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `orb_feature_discovery_paths` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `featureId` varchar(128) NOT NULL,
  `discoveryMethod` ENUM(
    'orb_suggestion',
    'menu_exploration',
    'search',
    'tutorial',
    'friend_share',
    'documentation',
    'accident'
  ) NOT NULL,
  `fromFeatureId` varchar(128) NULL COMMENT 'Previous feature if discovered through workflow',
  `context` text NULL,
  `timeToFirstUse` int NULL COMMENT 'Seconds from discovery to first use',
  `discoveredAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `orb_discovery_user_idx` (`userId`),
  KEY `orb_discovery_feature_idx` (`featureId`),
  KEY `orb_discovery_method_idx` (`discoveryMethod`),
  KEY `orb_discovery_from_idx` (`fromFeatureId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `orb_feature_recommendations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `featureId` varchar(128) NOT NULL,
  `reason` text NOT NULL COMMENT 'Why this feature was recommended',
  `relevanceScore` float NOT NULL COMMENT '0.0-1.0',
  `basedOnFeatures` json NULL COMMENT 'Array of featureIds that led to this recommendation',
  `presentedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `clickedAt` timestamp NULL,
  `usedAt` timestamp NULL,
  `dismissedAt` timestamp NULL,
  `feedbackRating` tinyint NULL COMMENT '1-5 stars if user provided feedback',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `orb_feature_rec_user_idx` (`userId`),
  KEY `orb_feature_rec_feature_idx` (`featureId`),
  KEY `orb_feature_rec_presented_idx` (`presentedAt`),
  KEY `orb_feature_rec_relevance_idx` (`userId`, `relevanceScore` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
